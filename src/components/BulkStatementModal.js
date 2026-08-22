// 📅 ออกใบวางบิลทั้งเดือน — สแกนบิลในช่วงที่เลือก จัดกลุ่มตามลูกค้า
//    แล้วติ๊กเลือกว่าจะออกให้ใครบ้าง → สร้างทีเดียวทั้งหมด
// (เดิมต้องสร้างทีละราย — 235 ลูกค้า = 2-3 ชม.)
import { useState, useMemo } from "react";
import { collection, addDoc, serverTimestamp, doc, writeBatch } from "firebase/firestore";
import { db } from "../firebase";
import { Modal, MHead, BtnPrimary, BtnGhost } from "./ui";
import { T } from "../theme";
import { logAudit, AUDIT_ACTIONS } from "../utils/audit";
import { reserveDocNo } from "../utils/docNumber";
import { filterInvoicesForStatement, creditsForStatement, sumCredits, matchCustomer, custKey, fmtISO, fmtDDMMYYYY, parseISODate as parseISO } from "../utils/statement";

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

export default function BulkStatementModal({ invoices = [], customers = [], statements = [], returns = [], companyInfo = {}, user, onClose, onDone }) {
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

  const startD = parseISO(periodStart), endD = parseISO(periodEnd);

  // 🔍 จัดกลุ่มบิลตามลูกค้า — ใช้ helper ตัวเดียวกับหน้าสร้างทีละใบ (ผลลัพธ์ตรงกันแน่นอน)
  //
  // ⚠️ กับดักที่ทำให้หน้านี้เคยเละ: helper จับคู่ลูกค้าเป็นชั้น ๆ (รหัส → เบอร์ → ชื่อ)
  //    บิลใบเดียวจึงเข้าเงื่อนไขของ "หลายราย" พร้อมกันได้ —
  //      · บิลบางใบไม่ได้ผูกลูกค้า แต่ชื่อตรงกับลูกค้าที่ผูกไว้แล้ว
  //      · บิลผูกรหัสไว้กับรายหนึ่ง แต่ชื่อในบิลดันตรงกับอีกราย (FBT มี 3 บริษัทชื่อคล้ายกัน)
  //    ของเดิมสร้างแถวให้ทุกรายชื่อ → ยอดชุดเดียวกันโผล่ 2 แถว ติ๊กทั้งคู่ = วางบิลซ้ำ ทวงเงิน 2 รอบ
  //    ตอนนี้เลือก "เจ้าของ" ของบิล/ใบลดหนี้แต่ละใบไว้รายเดียว: ชั้นที่แน่นกว่าชนะ
  //    เสมอกันให้ลูกค้าในทะเบียนชนะบิลลอย ๆ (ข้อมูลติดต่อครบกว่า ใบวางบิลจึงถูกต้องกว่า)
  const groups = useMemo(() => {
    if (!startD || !endD) return [];
    // รวมรายชื่อจากทั้งลูกค้าในระบบ + ชื่อที่โผล่ในบิล (เผื่อบิลที่ไม่ได้ผูกลูกค้า)
    const seen = new Map(); // key → { customerId, customerName, ...ข้อมูลติดต่อ }
    customers.forEach(c => seen.set(`id:${c.id}`, {
      customerId: c.id, customerName: c.name || "", phone: c.phone||"", address: c.address||"", taxId: c.taxId||"",
      billingType: c.billingType || "credit", // ไม่เคยตั้ง = เครดิต (พฤติกรรมเดิม)
    }));
    const knownIds = new Set(customers.map(c => c.id));
    invoices.forEach(inv => {
      // บิลที่ผูกกับลูกค้าที่ยังอยู่ในทะเบียน → ไปรวมที่แถวของลูกค้ารายนั้น
      // แต่ถ้าผูกกับรหัสที่ถูกลบไปแล้ว ต้องมีแถวรับ ไม่งั้นบิลหายเงียบ ๆ ไม่มีอะไรฟ้อง
      if (inv.customerId && knownIds.has(inv.customerId)) return;
      const nm = (inv.customerName || "").trim();
      if (!nm) return;
      const k = `name:${nm}`;
      // บิลที่ไม่ผูกลูกค้า → ไม่รู้ประเภท ถือว่าเครดิตไว้ก่อน (จะได้ไม่ตกหล่น)
      if (!seen.has(k)) seen.set(k, { customerId: "", customerName: nm, phone: inv.customerPhone||"", address: inv.customerAddress||"", taxId: inv.customerTaxId||"", billingType: "credit", unlinked: true });
    });

    const refs = [];
    seen.forEach((c, key) => refs.push({ key, ...c }));

    // 🧮 แจกบิล/ใบลดหนี้ให้เจ้าของรายเดียว
    const RANK = { id: 3, phone: 2, name: 1 };
    const refOf = (r) => ({ customerId: r.customerId, customerName: r.customerName, customerPhone: r.phone });
    const claim = (owners, docLike, r) => {
      const rank = RANK[matchCustomer(docLike, refOf(r))] || 0;
      if (!rank) return;
      const cur = owners.get(docLike.id);
      if (!cur || rank > cur.rank || (rank === cur.rank && !cur.hasId && r.customerId))
        owners.set(docLike.id, { key: r.key, rank, hasId: !!r.customerId });
    };

    const invOwner = new Map(), credOwner = new Map();
    const cand = new Map(); // key → { invs, credits } ที่ "เข้าเงื่อนไข" (ยังไม่ตัดสินเจ้าของ)
    refs.forEach(r => {
      const invs = filterInvoicesForStatement(invoices, r.customerId, r.customerName, startD, endD, filterMode, r.phone);
      const credits = creditsForStatement(returns, r.customerId, r.customerName, endD, r.phone);
      cand.set(r.key, { invs, credits });
      invs.forEach(inv => claim(invOwner, inv, r));
      credits.forEach(cr => claim(credOwner, cr, r));
    });

    const rows = [];
    refs.forEach(r => {
      // 💵 เงินสด — ไม่ต้องวางบิล (ตัดหลังตัดสินเจ้าของแล้ว บิลของรายนี้จึงไม่ไหลไปโผล่ที่แถวชื่อคล้ายกัน)
      if (onlyCredit && r.billingType === "cash") return;
      const c = cand.get(r.key);
      const invs = c.invs.filter(i => invOwner.get(i.id)?.key === r.key);
      if (invs.length === 0) return;
      // ⚠️ เตือนถ้าเคยออกใบวางบิลช่วงเดียวกันไปแล้ว — กันออกซ้ำ
      const dupe = statements.some(s =>
        ((s.customerId && s.customerId === r.customerId) || (!s.customerId && s.customerName === r.customerName)) &&
        s.periodStart === fmtDDMMYYYY(startD) && s.periodEnd === fmtDDMMYYYY(endD) && s.status !== "ยกเลิก"
      );
      // ↩️ ของที่ลูกค้ารายนี้คืนและยังไม่เคยถูกหัก → หักในใบวางบิลรอบนี้
      const credits = c.credits.filter(x => credOwner.get(x.id)?.key === r.key);
      const creditTotal = sumCredits(credits);
      const total = invs.reduce((s,i)=>s+(Number(i.total)||0),0);
      // ⚠️ บิลที่ชื่อในตัวบิลไม่ตรงกับชื่อแถวนี้ (เข้ามาเพราะผูกรหัสลูกค้าไว้)
      //    ชื่อคล้ายกันไม่ได้แปลว่าเจ้าเดียวกัน — เช่น FBT มี 3 บริษัทแยกกัน
      //    วางบิลผิดเจ้า = ทวงเงินผิดคน จึงต้องให้คนดูก่อน ห้ามกลืนเงียบ ๆ
      //    บิลไม่มีชื่อไม่นับ — "ไม่ได้กรอกชื่อ" คนละเรื่องกับ "ชื่อคนอื่น"
      const oddNames = invs.filter(i => { const k = custKey(i.customerName); return k && k !== custKey(r.customerName); });
      // สรุปเป็น "ชื่อ (n ใบ)" ไว้โชว์ตรง ๆ — ต้องอ่านออกโดยไม่ต้องเอาเมาส์ไปจ่อทีละแถว
      // ไม่งั้นเห็นแค่ "ต่างกัน 1 ใบ" ก็ตัดสินใจอะไรไม่ได้ ต้องเดาว่าเป็นชื่อของใคร
      const oddCount = new Map();
      oddNames.forEach(i => { const nm = (i.customerName || "").trim(); oddCount.set(nm, (oddCount.get(nm) || 0) + 1); });
      const oddSummary = [...oddCount.entries()].map(([nm, n]) => `${nm} (${n} ใบ)`);
      const oddTitle = oddNames.length === 0 ? "" : [
        `บิลพวกนี้ผูกรหัส/เบอร์ไว้กับ "${r.customerName}" แต่ชื่อที่พิมพ์ในบิลเป็นอีกชื่อ`,
        `ถ้าเป็นคนละเจ้ากันจริง ให้ไปแก้ลูกค้าในบิลก่อน แล้วค่อยวางบิล`,
        "",
        ...oddNames.map(x => `${x.invoiceNo} · ${x.customerName || "(ไม่ระบุ)"} · ฿${fmtB(x.total)}`),
      ].join(String.fromCharCode(10));
      rows.push({ ...r, invoices: invs, total, credits, creditTotal, net: Math.max(0, total - creditTotal), dupe, oddNames, oddSummary, oddTitle });
    });
    return rows.sort((a,b) => b.total - a.total);
  }, [invoices, customers, statements, returns, periodStart, periodEnd, filterMode, onlyCredit]); // eslint-disable-line react-hooks/exhaustive-deps

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
          })),
          totalAmount: g.total,
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
      <label style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 13px", marginBottom: 12, borderRadius: 9, cursor: "pointer",
        background: onlyCredit ? "rgba(59,91,139,0.06)" : "#f8fafc", border: `1px solid ${onlyCredit ? "rgba(59,91,139,0.3)" : T.border}` }}>
        <input type="checkbox" checked={onlyCredit} onChange={e=>{setOnlyCredit(e.target.checked); setPicked(null);}} style={{ width: 16, height: 16, cursor: "pointer" }}/>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: onlyCredit ? T.accent : T.text }}>📄 เฉพาะลูกค้าเครดิต (ไม่รวมลูกค้าเงินสด)</div>
          <div style={{ fontSize: 11, color: T.muted, marginTop: 2, lineHeight: 1.6 }}>
            ตั้งประเภทได้ที่หน้าลูกค้า → ✏️ แก้ไข · ลูกค้าที่ยังไม่ได้ตั้ง = นับเป็นเครดิต (จะได้ไม่ตกหล่น)<br/>
            🚫 บิลที่ถูกรวมเข้าบิลใหม่แล้ว ไม่ถูกนับซ้ำ
          </div>
        </div>
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
            return (
              <label key={g.key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: 9, cursor: "pointer",
                border: `1px solid ${on ? "rgba(58,122,82,0.4)" : T.border}`, background: on ? "rgba(58,122,82,0.05)" : "white" }}>
                <input type="checkbox" checked={on} onChange={()=>toggle(g)} style={{ width: 16, height: 16, cursor: "pointer", flexShrink: 0 }}/>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {g.customerName || "(ไม่ระบุชื่อ)"}
                    {g.dupe && <span style={{ marginLeft: 6, fontSize: 10, padding: "1px 7px", background: "#fef3c7", color: "#b45309", borderRadius: 8, fontWeight: 700 }}>เคยออกแล้ว</span>}
                    {!g.customerId && <span style={{ marginLeft: 6, fontSize: 10, color: T.muted }}>· ไม่ผูกลูกค้า</span>}
                  </div>
                  <div style={{ fontSize: 11, color: T.muted }}>
                    {g.invoices.length} บิล{g.phone ? ` · ${g.phone}` : ""}
                    {/* บิลที่ชื่อในตัวบิลต่างจากชื่อแถวนี้ — ต้องเห็นก่อนกด ไม่งั้นวางบิลผิดเจ้าโดยไม่รู้ตัว */}
                    {g.oddNames?.length > 0 && (
                      <span title={g.oddTitle}
                        style={{ marginLeft: 6, color: "#b45309", cursor: "help", textDecoration: "underline dotted" }}>
                        ⚠️ ชื่อในบิลเขียนว่า {g.oddSummary.slice(0, 2).join(" · ")}
                        {g.oddSummary.length > 2 ? ` +อีก ${g.oddSummary.length - 2}` : ""}
                      </span>
                    )}
                    {/* ดูเลขที่บิลได้ว่ารวมใบไหนบ้าง — กันงงว่ายอดมาจากไหน */}
                    <span title={g.invoices.map(x => `${x.invoiceNo} · ฿${fmtB(x.total)}`).join("\n")}
                      style={{ marginLeft: 6, color: T.accent, cursor: "help", textDecoration: "underline dotted" }}>
                      ดูเลขบิล
                    </span>
                  </div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: T.green, fontFamily: "monospace" }}>฿{fmtB(g.creditTotal > 0 ? g.net : g.total)}</div>
                  {g.creditTotal > 0 && <div style={{ fontSize: 10, color: "#047857" }}>฿{fmtB(g.total)} · หักคืน -฿{fmtB(g.creditTotal)}</div>}
                </div>
              </label>
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
          <BtnPrimary onClick={createAll} disabled={selected.length === 0} style={{ flex: 2 }}>
            📄 สร้างใบวางบิล {selected.length > 0 ? `${selected.length} ใบ` : ""}
          </BtnPrimary>
        </div>
      )}
    </Modal>
  );
}
