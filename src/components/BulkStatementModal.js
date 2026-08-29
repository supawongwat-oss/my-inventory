// 📅 ออกใบวางบิลทั้งเดือน — สแกนบิลในช่วงที่เลือก จัดกลุ่มตามลูกค้า
//    แล้วติ๊กเลือกว่าจะออกให้ใครบ้าง → สร้างทีเดียวทั้งหมด
// (เดิมต้องสร้างทีละราย — 235 ลูกค้า = 2-3 ชม.)
import { useState, useMemo } from "react";
import { collection, addDoc, serverTimestamp, doc, writeBatch } from "firebase/firestore";
import { db } from "../firebase";
import { Modal, MHead, BtnPrimary, BtnGhost, BillingBadge } from "./ui";
import { T } from "../theme";
import { logAudit, AUDIT_ACTIONS } from "../utils/audit";
import { reserveDocNo } from "../utils/docNumber";
import { buildStatementGroups, paidOf, dueOf, fmtISO, fmtDDMMYYYY, parseISODate as parseISO } from "../utils/statement";

const fmtB = (n) => Number(n || 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// 🔢 กันเลขซ้ำภายในรอบเดียวกัน
//    ปกติ reserveDocNo จองเลขผ่าน counter ใน transaction จึงไม่มีทางซ้ำ
//    แต่ถ้าเขียน counters ไม่ได้ มันจะ fallback เป็น "เลขสูงสุดที่โหลดมา + 1" ซึ่งในลูป 70-80 ใบ
//    จะได้เลขเดิมทุกใบ — ตรงนี้เลื่อนเลขต่อเองถ้าชนกับที่เพิ่งออกไปในรอบนี้
const nextUnused = (no, used) => {
  let out = no;
  while (used.has(out)) {
    const m = out.match(/^(.*-)(\d+)$/);
    if (!m) { out = `${out}-2`; break; }
    out = m[1] + String(Number(m[2]) + 1).padStart(m[2].length, "0");
  }
  used.add(out);
  return out;
};
const now = () => { const d=new Date(); const p=n=>String(n).padStart(2,"0"); return `${p(d.getDate())}/${p(d.getMonth()+1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`; };

export default function BulkStatementModal({ invoices = [], customers = [], statements = [], returns = [], companyInfo = {}, user, onClose, onDone,
  invoicesRange, setInvoicesRange, invoicesCapped = false }) {
  const t = new Date();
  const [periodStart, setPeriodStart] = useState(fmtISO(new Date(t.getFullYear(), t.getMonth(), 1)));
  const [periodEnd, setPeriodEnd] = useState(fmtISO(new Date(t.getFullYear(), t.getMonth()+1, 0)));
  const [filterMode, setFilterMode] = useState("unpaid"); // unpaid | all
  // 💳 ลูกค้าเงินสดจ่ายหน้าร้านแล้ว ไม่ต้องวางบิล — คัดออกให้ตั้งแต่แรก
  //    (ตั้งประเภทที่หน้าลูกค้า → แก้ไข · ไม่เคยตั้ง = ถือว่าเครดิต)
  const [onlyCredit, setOnlyCredit] = useState(true);
  const [dueDate, setDueDate] = useState("");
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState(null);   // Set<key> — null = ยังไม่เคยแตะ (เลือกทั้งหมด)
  const [busy, setBusy] = useState(null);       // { done, total }
  const [openKey, setOpenKey] = useState(null); // แถวที่กางรายการบิลอยู่

  const startD = parseISO(periodStart), endD = parseISO(periodEnd);

  // 🚨 บิลที่ยังไม่ได้โหลด = บิลที่จะหายจากใบวางบิลแบบไม่มีอะไรฟ้อง
  //    ระบบโหลดบิลมาเป็นช่วงวันที่ (ค่าเริ่มต้น 30 วันล่าสุด) แต่หน้านี้คิดยอดจากบิล
  //    ที่อยู่ในหน้าจอเท่านั้น — วางบิลเดือน ส.ค. ตอนต้นเดือน ก.ย. บิลต้นเดือน ส.ค.
  //    จะไม่ถูกนับ ลูกค้าได้ใบที่ยอดขาด แล้วไม่มีใครรู้จนกว่าจะมีคนทัก
  const loadedFrom = invoicesRange?.from instanceof Date ? invoicesRange.from : null;
  const notLoadedBefore = loadedFrom && startD && startD.getTime() < new Date(
    loadedFrom.getFullYear(), loadedFrom.getMonth(), loadedFrom.getDate()).getTime() ? loadedFrom : null;

  // 🔍 จัดกลุ่มบิลตามลูกค้า — ใช้ helper ตัวเดียวกับหน้าสร้างทีละใบ (ผลลัพธ์ตรงกันแน่นอน)
  //
  // ⚠️ กับดักที่ทำให้หน้านี้เคยเละ: helper จับคู่ลูกค้าเป็นชั้น ๆ (รหัส → เบอร์ → ชื่อ)
  //    บิลใบเดียวจึงเข้าเงื่อนไขของ "หลายราย" พร้อมกันได้ —
  //      · บิลบางใบไม่ได้ผูกลูกค้า แต่ชื่อตรงกับลูกค้าที่ผูกไว้แล้ว
  //      · บิลผูกรหัสไว้กับรายหนึ่ง แต่ชื่อในบิลดันตรงกับอีกราย (FBT มี 3 บริษัทชื่อคล้ายกัน)
  //    ของเดิมสร้างแถวให้ทุกรายชื่อ → ยอดชุดเดียวกันโผล่ 2 แถว ติ๊กทั้งคู่ = วางบิลซ้ำ ทวงเงิน 2 รอบ
  //    ตอนนี้เลือก "เจ้าของ" ของบิล/ใบลดหนี้แต่ละใบไว้รายเดียว: ชั้นที่แน่นกว่าชนะ
  //    เสมอกันให้ลูกค้าในทะเบียนชนะบิลลอย ๆ (ข้อมูลติดต่อครบกว่า ใบวางบิลจึงถูกต้องกว่า)
  const groups = useMemo(() => buildStatementGroups({
    invoices, customers, statements, returns, startDate: startD, endDate: endD, filterMode, onlyCredit,
  }), [invoices, customers, statements, returns, periodStart, periodEnd, filterMode, onlyCredit]); // eslint-disable-line react-hooks/exhaustive-deps

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? groups.filter(g => (g.customerName||"").toLowerCase().includes(q) || (g.phone||"").includes(q)) : groups;
  }, [groups, search]);

  // ยังไม่เคยแตะ = เลือกทุกรายที่ยังไม่เคยออก (ที่ออกไปแล้วไม่ติ๊กให้ กันซ้ำ)
  const isPicked = (g) => picked ? picked.has(g.key) : !g.dupe;
  const toggle = (g) => {
    const cur = new Set(picked ?? groups.filter(x => !x.dupe).map(x => x.key));
    cur.has(g.key) ? cur.delete(g.key) : cur.add(g.key);
    setPicked(cur);
  };
  const selected = groups.filter(isPicked);
  const selTotal = selected.reduce((s,g) => s + g.total, 0);
  const selCredit = selected.reduce((s,g) => s + (g.creditTotal || 0), 0);
  const selNet = Math.max(0, selTotal - selCredit);
  const selInvCount = selected.reduce((s,g) => s + g.invoices.length, 0);
  const dupeCount = groups.filter(g => g.dupe).length;

  // 📋 คัดลอกรายการบิลของแถวนี้เป็นข้อความ — เอาไปวางในไลน์ถามพนักงานได้
  //    เจ้าของร้านไม่ได้เป็นคนออกบิลเอง เรื่องชื่อ/ที่อยู่ลูกค้าต้องถามคนที่คีย์
  //    ถ้าข้อมูลอยู่แต่ในหน้าจอ ก็ส่งต่อให้ใครดูไม่ได้ กลายเป็นตรวจไม่ได้ทั้งงวด
  const copyRow = (g) => {
    const lines = [
      `${g.customerName || "(ไม่ระบุชื่อ)"}${g.phone ? ` · ${g.phone}` : ""}`,
      `ช่วง ${fmtDDMMYYYY(startD)}–${fmtDDMMYYYY(endD)} · ${g.invoices.length} บิล · ฿${fmtB(g.total)}`,
      "",
      ...g.invoices.map(x => {
        const odd = g.oddNames.some(o => o.id === x.id);
        return `${x.invoiceNo} · ${(x.date || "").split(" ")[0]} · ฿${fmtB(x.total)}`
          + (odd ? `  ⚠️ ชื่อในบิล: ${x.customerName || "(ไม่ระบุ)"}` : "");
      }),
    ];
    if (g.oddNames.length > 0) {
      lines.push("", `⚠️ ช่วยเช็กให้หน่อยว่าบิลที่ทำเครื่องหมายไว้ เป็นของ "${g.customerName}" จริงไหม`);
    }
    const text = lines.join(String.fromCharCode(10));
    // คลิปบอร์ดใช้ไม่ได้ในบางเบราว์เซอร์/บางเครื่อง — ต้องมีทางสำรองให้ลากคัดลอกเองเสมอ
    const fallback = () => window.prompt("คัดลอกข้อความนี้ (Ctrl+C)", text);
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(() => alert("คัดลอกแล้ว — วางในไลน์ได้เลย"), fallback);
    } else fallback();
  };

  const createAll = async () => {
    if (selected.length === 0 || busy) return;
    const dupeSelected = selected.filter(g => g.dupe).length;
    if (!window.confirm(
      `สร้างใบวางบิล ${selected.length} ใบ?\n\n`+
      `• รวมบิล ${selInvCount.toLocaleString("th-TH")} ใบ\n`+
      `• ยอดรวม ฿${fmtB(selTotal)}\n`+
      (selCredit > 0 ? `• หักของที่คืน -฿${fmtB(selCredit)} → เก็บจริง ฿${fmtB(selNet)}\n` : "")+
      `• ช่วง ${fmtDDMMYYYY(startD)} – ${fmtDDMMYYYY(endD)}\n`+
      (dupeSelected > 0 ? `\n⚠️ มี ${dupeSelected} รายที่เคยออกช่วงนี้ไปแล้ว — จะได้ใบซ้ำ\n` : "")
    )) return;

    setBusy({ done: 0, total: selected.length });
    const fails = [];
    // 🔖 ปั๊มรหัสรอบเดียวกันลงทุกใบ — กดพลาดทีเดียว 70-80 ใบ ต้องถอยทั้งรอบได้
    //    ไม่งั้นต้องไล่ลบทีละใบ (ปุ่ม "↩️ ถอยทั้งรอบ" ที่หน้าวางบิลใช้ค่านี้)
    const runId = "run-" + Date.now();
    const runAt = now();
    const usedNos = new Set(statements.map(s => s.statementNo).filter(Boolean));
    for (let i = 0; i < selected.length; i++) {
      const g = selected[i];
      try {
        // เลขรันเรียงต่อกันทั้งเดือนแบบเดียวกับบิล (STM6908-0001, -0002, …)
        const stmtNo = nextUnused(await reserveDocNo(db, "STM", statements, "statementNo"), usedNos);
        const ref = await addDoc(collection(db, "statements"), {
          statementNo: stmtNo,
          customerId: g.customerId || "",
          customerName: g.customerName,
          customerPhone: g.phone || "",
          customerAddress: g.address || "",
          customerTaxId: g.taxId || "",
          periodStart: fmtDDMMYYYY(startD),
          periodEnd: fmtDDMMYYYY(endD),
          invoiceIds: g.invoices.map(x => x.id),
          invoicesSnapshot: g.invoices.map(x => ({
            id: x.id, invoiceNo: x.invoiceNo, date: x.date,
            total: Number(x.total) || 0, status: x.status || "ออกแล้ว",
            docType: x.docType || "receipt",
            paid: paidOf(x), due: dueOf(x),
          })),
          totalAmount: g.total,
          grossTotal: g.grossTotal,
          paidTotal: g.paidTotal,
          creditTotal: g.creditTotal || 0,
          netAmount: g.net != null ? g.net : g.total,
          returnIds: (g.credits || []).map(r => r.id),
          returnsSnapshot: (g.credits || []).map(r => ({
            id: r.id, returnNo: r.returnNo, invoiceNo: r.invoiceNo || "",
            receivedAt: r.receivedAt || "", reason: r.reason || "",
            qty: Number(r.creditQty) || 0, total: Number(r.creditTotal) || 0,
          })),
          invoiceCount: g.invoices.length,
          filterMode,
          bulkRunId: runId,
          bulkRunAt: runAt,
          status: "ออกแล้ว",
          dueDate,
          note: "",
          bankAccount: (companyInfo.bankAccounts || [])[0] || null,
          showCompanyTaxId: true,
          by: user?.name || user?.username || "",
          date: now(),
          createdAt: serverTimestamp(),
        });
        // ปั๊มใบรับคืนของรายนี้ว่าถูกหักไปแล้ว — ไม่งั้นเดือนหน้าจะถูกหักซ้ำ
        const rids = (g.credits || []).map(r => r.id);
        for (let k = 0; k < rids.length; k += 400) {
          const b = writeBatch(db);
          rids.slice(k, k + 400).forEach(rid =>
            b.update(doc(db, "returns", rid), {
              appliedStatementId: ref.id, appliedStatementNo: stmtNo, appliedAt: now(),
            }));
          await b.commit();
        }
      } catch (e) {
        fails.push(`• ${g.customerName} — ${e.message || e}`);
      }
      setBusy({ done: i + 1, total: selected.length });
    }
    setBusy(null);
    logAudit(user, {
      action: AUDIT_ACTIONS.CREATE, collection: "statements", targetId: "bulk",
      targetLabel: `วางบิลรวม ${fmtDDMMYYYY(startD)}–${fmtDDMMYYYY(endD)}`,
      note: `สร้าง ${selected.length - fails.length} ใบ · ฿${fmtB(selTotal)}`,
    });
    alert(
      `✅ สร้างใบวางบิล ${selected.length - fails.length} ใบแล้ว\n` +
      (fails.length > 0 ? `\n❌ ไม่สำเร็จ ${fails.length} ใบ:\n${fails.slice(0,8).join("\n")}` : "")
    );
    onDone && onDone();
    onClose && onClose();
  };

  return (
    <Modal onClose={onClose} w={720}>
      <MHead title="📅 ออกใบวางบิลทั้งเดือน" sub="สแกนบิลตามช่วงที่เลือก → ติ๊กว่าจะออกให้ใคร → สร้างทีเดียว" onClose={onClose} color={T.green}/>

      {/* ตัวกรอง */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <input type="date" value={periodStart} onChange={e=>{setPeriodStart(e.target.value); setPicked(null);}}
          style={{ padding: "8px 10px", borderRadius: 8, border: `1px solid ${T.border}`, fontSize: 13, fontFamily: "inherit" }}/>
        <span style={{ color: T.muted, fontSize: 12 }}>ถึง</span>
        <input type="date" value={periodEnd} onChange={e=>{setPeriodEnd(e.target.value); setPicked(null);}}
          style={{ padding: "8px 10px", borderRadius: 8, border: `1px solid ${T.border}`, fontSize: 13, fontFamily: "inherit" }}/>
        <button onClick={()=>{ const d=new Date(); setPeriodStart(fmtISO(new Date(d.getFullYear(),d.getMonth()-1,1))); setPeriodEnd(fmtISO(new Date(d.getFullYear(),d.getMonth(),0))); setPicked(null); }}
          style={{ padding: "7px 12px", borderRadius: 8, border: `1px solid ${T.border}`, background: "white", color: T.sub, cursor: "pointer", fontSize: 12, fontFamily: "inherit" }}>เดือนที่แล้ว</button>
        <div style={{ display: "flex", gap: 3, background: "#eef2f7", borderRadius: 8, padding: 3 }}>
          {[{k:"unpaid",l:"เฉพาะค้างชำระ"},{k:"all",l:"ทุกบิล"}].map(m=>(
            <button key={m.k} onClick={()=>{setFilterMode(m.k); setPicked(null);}}
              style={{ padding: "5px 12px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 12, fontFamily: "inherit",
                fontWeight: filterMode===m.k?700:500, background: filterMode===m.k?"white":"transparent", color: filterMode===m.k?T.green:T.sub }}>{m.l}</button>
          ))}
        </div>
      </div>

      {/* 💳 คัดลูกค้าเงินสดออก — ไม่ต้องวางบิล */}
      {/* บีบให้เหลือบรรทัดเดียว — คำอธิบายยาว ๆ ย้ายไปอยู่ใน tooltip
          เก็บไว้ในบรรทัดเฉพาะข้อที่มีผลกับยอดจริง (ยังไม่ได้ตั้ง = นับเป็นเครดิต) */}
      <label title={"ตั้งประเภทได้ที่หน้าลูกค้า → ✏️ แก้ไข" + String.fromCharCode(10) +
                    "ลูกค้าที่ยังไม่ได้ตั้ง = นับเป็นเครดิต (จะได้ไม่ตกหล่น)" + String.fromCharCode(10) +
                    "🚫 บิลที่ถูกรวมเข้าบิลใหม่แล้ว ไม่ถูกนับซ้ำ"}
        style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", marginBottom: 10, borderRadius: 9, cursor: "pointer", flexWrap: "wrap",
        background: onlyCredit ? "rgba(59,91,139,0.06)" : "#f8fafc", border: `1px solid ${onlyCredit ? "rgba(59,91,139,0.3)" : T.border}` }}>
        <input type="checkbox" checked={onlyCredit} onChange={e=>{setOnlyCredit(e.target.checked); setPicked(null);}} style={{ width: 16, height: 16, cursor: "pointer" }}/>
        <span style={{ fontSize: 12, fontWeight: 700, color: onlyCredit ? T.accent : T.text }}>📄 เฉพาะลูกค้าเครดิต (ไม่รวมเงินสด)</span>
        <span style={{ fontSize: 11, color: T.muted }}>· ยังไม่ได้ตั้ง = นับเป็นเครดิต</span>
      </label>

      {/* สรุป + ค้นหา */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder={`🔍 ค้นชื่อ/เบอร์ (${groups.length} ราย)`}
          style={{ flex: "1 1 180px", padding: "8px 12px", borderRadius: 8, border: `1px solid ${T.border}`, fontSize: 13, fontFamily: "inherit", outline: "none" }}/>
        <button onClick={()=>setPicked(new Set(groups.map(g=>g.key)))}
          style={{ padding: "7px 12px", borderRadius: 8, border: `1px solid ${T.border}`, background: "white", color: T.sub, cursor: "pointer", fontSize: 12, fontFamily: "inherit" }}>เลือกทั้งหมด</button>
        <button onClick={()=>setPicked(new Set())}
          style={{ padding: "7px 12px", borderRadius: 8, border: `1px solid ${T.border}`, background: "white", color: T.sub, cursor: "pointer", fontSize: 12, fontFamily: "inherit" }}>ล้าง</button>
      </div>

      {/* 🚨 กันใบวางบิลยอดขาด — ห้ามสร้างจนกว่าจะโหลดบิลครบช่วง */}
      {notLoadedBefore && (
        <div style={{ padding: "10px 14px", marginBottom: 10, background: "rgba(185,74,72,0.08)", border: "1px solid rgba(185,74,72,0.4)", borderRadius: 9 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: T.red, marginBottom: 4 }}>
            🚨 บิลยังโหลดมาไม่ครบช่วง — ยอดจะขาด
          </div>
          <div style={{ fontSize: 11, color: T.sub, lineHeight: 1.7 }}>
            ระบบโหลดบิลมาตั้งแต่ <b>{fmtDDMMYYYY(notLoadedBefore)}</b> แต่คุณกำลังวางบิลตั้งแต่ <b>{fmtDDMMYYYY(startD)}</b>
            <br/>บิลก่อนวันที่โหลดจะไม่ถูกนับ ลูกค้าจะได้ใบวางบิลที่ยอดน้อยกว่าความจริง
          </div>
          {setInvoicesRange && (
            <button onClick={() => setInvoicesRange({ from: new Date(startD.getFullYear(), startD.getMonth(), startD.getDate()), to: null })}
              style={{ marginTop: 8, padding: "6px 13px", borderRadius: 8, border: "none", background: T.red, color: "white", cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: "inherit" }}>
              📥 โหลดบิลตั้งแต่ {fmtDDMMYYYY(startD)}
            </button>
          )}
        </div>
      )}

      {/* ชนเพดานโหลด = ข้อมูลถูกตัดทิ้งบางส่วน ยอดเชื่อไม่ได้ */}
      {invoicesCapped && (
        <div style={{ padding: "9px 13px", marginBottom: 10, background: "rgba(217,119,6,0.08)", border: "1px solid rgba(217,119,6,0.35)", borderRadius: 9, fontSize: 11, color: "#b45309", lineHeight: 1.7 }}>
          ⚠️ บิลที่โหลดมาชนเพดาน 3,000 ใบ — อาจมีบิลตกหล่น ให้แคบช่วงวันที่ลงแล้วออกทีละงวด แล้วเทียบยอดก่อนส่งลูกค้า
        </div>
      )}

      {dupeCount > 0 && (
        <div style={{ padding: "8px 12px", marginBottom: 10, background: "rgba(217,119,6,0.08)", border: "1px solid rgba(217,119,6,0.3)", borderRadius: 8, fontSize: 12, color: "#b45309" }}>
          ⚠️ มี {dupeCount} รายที่เคยออกใบวางบิลช่วงนี้ไปแล้ว — ระบบไม่ติ๊กให้ (ติ๊กเองได้ถ้าตั้งใจออกซ้ำ)
        </div>
      )}

      {/* รายชื่อ */}
      {groups.length === 0 ? (
        <div style={{ padding: 40, textAlign: "center", color: T.muted, fontSize: 13 }}>
          <div style={{ fontSize: 40, marginBottom: 8, opacity: 0.3 }}>📭</div>
          ไม่มีบิลในช่วงที่เลือก{filterMode === "unpaid" ? " (ลองเปลี่ยนเป็น \"ทุกบิล\")" : ""}
        </div>
      ) : (
        <div className="scroll-col" style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: "42vh", overflowY: "auto", marginBottom: 12 }}>
          {visible.map(g => {
            const on = isPicked(g);
            const open = openKey === g.key;
            return (
              <div key={g.key} style={{ borderRadius: 9, border: `1px solid ${on ? "rgba(58,122,82,0.4)" : T.border}`, background: on ? "rgba(58,122,82,0.05)" : "white" }}>
                {/* ติ๊กเลือกอยู่ใน label · ปุ่มกางรายละเอียดอยู่นอก label — ไม่งั้นกดดูข้อมูลแล้วติ๊กหลุด */}
                <label style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", cursor: "pointer" }}>
                  <input type="checkbox" checked={on} onChange={()=>toggle(g)} style={{ width: 16, height: 16, cursor: "pointer", flexShrink: 0 }}/>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {g.customerName || "(ไม่ระบุชื่อ)"}
                      {g.customerId && <span style={{ marginLeft: 6 }}><BillingBadge type={g.billingType}/></span>}
                      {g.dupe && <span style={{ marginLeft: 6, fontSize: 10, padding: "1px 7px", background: "#fef3c7", color: "#b45309", borderRadius: 8, fontWeight: 700 }}>เคยออกแล้ว</span>}
                      {!g.customerId && <span style={{ marginLeft: 6, fontSize: 10, color: T.muted }}>· ไม่ผูกลูกค้า</span>}
                    </div>
                    <div style={{ fontSize: 11, color: T.muted }}>
                      {g.invoices.length} บิล{g.phone ? ` · ${g.phone}` : ""}
                      {/* ยอดในใบวางบิลต่างจากหน้าบิลเพราะสองอย่างนี้ — ต้องบอก ไม่งั้นดูเหมือนเงินหาย */}
                      {g.paidTotal > 0 && <span style={{ marginLeft: 6, color: "#047857" }}>· หักรับชำระแล้ว -฿{fmtB(g.paidTotal)}</span>}
                      {g.excluded.length > 0 && <span style={{ marginLeft: 6, color: T.muted }}>· ไม่นับ {g.excluded.length} ใบ (฿{fmtB(g.excludedTotal)})</span>}
                      {/* วางบิลไปแล้วในใบอื่น — ต้องบอก ไม่งั้นยอดหายไปเฉย ๆ แล้วหาสาเหตุไม่ได้ */}
                      {g.alreadyBilled > 0 && <span style={{ marginLeft: 6, color: T.amber }}>· วางบิลไปแล้ว {g.alreadyBilled} ใบ (฿{fmtB(g.alreadyBilledTotal)})</span>}
                      {/* บิลที่ชื่อในตัวบิลต่างจากชื่อแถวนี้ — ต้องเห็นก่อนกด ไม่งั้นวางบิลผิดเจ้าโดยไม่รู้ตัว */}
                      {g.oddNames?.length > 0 && (
                        <span style={{ marginLeft: 6, color: "#b45309" }}>
                          ⚠️ ชื่อในบิลเขียนว่า {g.oddSummary.slice(0, 2).join(" · ")}
                          {g.oddSummary.length > 2 ? ` +อีก ${g.oddSummary.length - 2}` : ""}
                        </span>
                      )}
                    </div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 800, color: T.green, fontFamily: "monospace" }}>฿{fmtB(g.creditTotal > 0 ? g.net : g.total)}</div>
                    {g.creditTotal > 0 && <div style={{ fontSize: 10, color: "#047857" }}>฿{fmtB(g.total)} · หักคืน -฿{fmtB(g.creditTotal)}</div>}
                  </div>
                </label>

                {/* ดูว่ายอดมาจากบิลใบไหนบ้าง — ของเดิมเป็น tooltip ซึ่งบนแท็บเล็ตไม่มี hover จึงเปิดดูไม่ได้เลย */}
                <div style={{ padding: "0 12px 8px 38px", display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button type="button" onClick={() => setOpenKey(open ? null : g.key)}
                    style={{ padding: 0, border: "none", background: "none", color: T.accent, cursor: "pointer", fontSize: 11, fontFamily: "inherit", textDecoration: "underline" }}>
                    {open ? "▲ ซ่อนรายการบิล" : `▼ ดูรายการบิล (${g.invoices.length})`}
                  </button>
                  {open && (
                    <button type="button" onClick={() => copyRow(g)}
                      style={{ padding: 0, border: "none", background: "none", color: T.accent, cursor: "pointer", fontSize: 11, fontFamily: "inherit", textDecoration: "underline" }}>
                      📋 คัดลอกไปถามพนักงาน
                    </button>
                  )}
                </div>

                {open && (
                  <div className="scroll-col" style={{ maxHeight: 200, overflowY: "auto", margin: "0 12px 10px 38px", padding: 8, background: "#f8fafc", border: `1px solid ${T.border}`, borderRadius: 8 }}>
                    {g.invoices.map(x => {
                      const odd = g.oddNames.some(o => o.id === x.id);
                      const paid = paidOf(x);
                      return (
                        <div key={x.id} style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap", padding: "3px 0", fontSize: 11, color: odd ? "#b45309" : T.sub }}>
                          <span style={{ fontFamily: "monospace", fontWeight: 700 }}>{x.invoiceNo}</span>
                          <span style={{ color: T.muted }}>{(x.date || "").split(" ")[0]}</span>
                          {odd && <span style={{ fontWeight: 700 }}>⚠️ ชื่อในบิล: {x.customerName || "(ไม่ระบุ)"}</span>}
                          {paid > 0 && <span style={{ color: "#047857" }}>รับมาแล้ว ฿{fmtB(paid)}</span>}
                          <span style={{ marginLeft: "auto", fontFamily: "monospace" }}>
                            ฿{fmtB(dueOf(x))}
                            {paid > 0 && <span style={{ color: T.muted, fontWeight: 400 }}> (บิล ฿{fmtB(x.total)})</span>}
                          </span>
                        </div>
                      );
                    })}
                    {/* ใบที่ไม่ถูกนับ — ต้องเห็น ไม่งั้นบิลยอด 0 หรือบิลที่ปิดไปแล้วจะหายเงียบ */}
                    {g.excluded.map(x => {
                      const st = x.status || "ออกแล้ว";
                      const why = st === "ชำระแล้ว" ? "ชำระแล้ว" : st === "ยกเลิก" ? "ยกเลิก" : "ยอด 0 — ยังไม่ได้ใส่ราคา?";
                      return (
                        <div key={x.id} style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap", padding: "3px 0", fontSize: 11, color: T.muted, textDecoration: "line-through", textDecorationColor: "rgba(0,0,0,0.25)" }}>
                          <span style={{ fontFamily: "monospace" }}>{x.invoiceNo}</span>
                          <span>{(x.date || "").split(" ")[0]}</span>
                          <span style={{ textDecoration: "none" }}>· ไม่นับ: {why}</span>
                          <span style={{ marginLeft: "auto", fontFamily: "monospace" }}>฿{fmtB(x.total)}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* สรุปที่เลือก */}
      {groups.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "10px 14px", background: "rgba(58,122,82,0.07)", border: "1px solid rgba(58,122,82,0.25)", borderRadius: 10, marginBottom: 12 }}>
          <span style={{ fontSize: 13, color: T.sub }}>
            เลือก <b style={{ color: T.text }}>{selected.length}</b> ราย · รวมบิล <b style={{ color: T.text }}>{selInvCount.toLocaleString("th-TH")}</b> ใบ
          </span>
          <span style={{ marginLeft: "auto", fontSize: 17, fontWeight: 800, color: T.green, fontFamily: "monospace" }}>฿{fmtB(selTotal)}</span>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
        <span style={{ fontSize: 12, color: T.sub }}>ครบกำหนดชำระ</span>
        <input type="date" value={dueDate} onChange={e=>setDueDate(e.target.value)}
          style={{ padding: "7px 10px", borderRadius: 8, border: `1px solid ${T.border}`, fontSize: 13, fontFamily: "inherit" }}/>
        <span style={{ fontSize: 11, color: T.muted }}>(ใส่ครั้งเดียว ใช้กับทุกใบ · ไม่ใส่ก็ได้)</span>
      </div>

      {busy ? (
        <div style={{ padding: "14px", textAlign: "center", background: "#f8fafc", borderRadius: 10 }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: T.green, fontFamily: "monospace" }}>{busy.done} / {busy.total}</div>
          <div style={{ height: 6, background: "#e3e8ef", borderRadius: 3, overflow: "hidden", marginTop: 8 }}>
            <div style={{ width: `${Math.round((busy.done/Math.max(1,busy.total))*100)}%`, height: "100%", background: T.green, transition: "width .2s" }}/>
          </div>
          <div style={{ fontSize: 11, color: T.muted, marginTop: 8 }}>กำลังสร้าง — ห้ามปิดหน้าจอ</div>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 10 }}>
          <BtnGhost onClick={onClose} style={{ flex: 1 }}>ยกเลิก</BtnGhost>
          {/* ล็อกปุ่มไว้ถ้าบิลยังโหลดไม่ครบช่วง — ออกไปแล้วยอดขาด ต้องตามออกใบใหม่ให้ลูกค้าทีละราย */}
          <BtnPrimary onClick={createAll} disabled={selected.length === 0 || !!notLoadedBefore} style={{ flex: 2 }}>
            {notLoadedBefore ? "🚨 โหลดบิลให้ครบช่วงก่อน" : `📄 สร้างใบวางบิล ${selected.length > 0 ? `${selected.length} ใบ` : ""}`}
          </BtnPrimary>
        </div>
      )}
    </Modal>
  );
}
