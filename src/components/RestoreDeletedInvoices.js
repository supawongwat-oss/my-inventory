// ♻️ กู้บิลที่ถูกลบ — จากไฟล์สำรองรายวัน กู้ทีละใบ ด้วยรหัสเอกสารเดิม
//
// ทำไมต้องแยกจากปุ่มกู้คืนทั้งระบบ (BackupRestore):
//   · โหมด "แทนที่" ลบบิลทั้งหมดในระบบก่อน
//   · โหมด "เพิ่ม" เขียนทับทุกเอกสารในไฟล์ → ย้อนทุกอย่างที่ทำหลังเวลาสำรอง (ชำระเงิน/แก้บิล)
//   · ไม่แปลงวันที่กลับเป็น Timestamp → บิลที่กู้ไม่โผล่ในรายการ เพราะหน้ารายการค้นด้วย createdAt
// เคสจริงที่เจอ: พนักงานลบ INV6909-0069 ดาวกีฬา ต้องการเอาคืนใบเดียว ไม่ใช่ย้อนทั้งระบบ
//
// กติกาที่ห้ามพัง:
//   · กู้ด้วยรหัสเอกสารเดิมเสมอ — รอบแพ็ค/ใบสั่งของยังชี้รหัสนั้นอยู่ ใช้รหัสเดิมแล้วเชื่อมกลับเอง
//   · เขียนเฉพาะใบที่ "ไม่มีอยู่ในระบบแล้ว" ตรวจใน transaction ณ วินาทีที่เขียน
//     → ต่อให้กดพลาดก็ทับบิลที่ยังใช้งานอยู่ไม่ได้
//   · แปลง {_seconds,_nanoseconds} กลับเป็น Timestamp ทุกชั้น
import React from "react";
import { db } from "../firebase";
import { doc, getDoc, runTransaction, Timestamp, writeBatch } from "firebase/firestore";
import { T } from "../theme";
import { BtnPrimary, BtnGhost } from "./ui";
import { logAudit, AUDIT_ACTIONS } from "../utils/audit";

const money = (n) => Number(n || 0).toLocaleString("th-TH", { minimumFractionDigits: 2 });
const norm = (s) => String(s || "").normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();

// ไฟล์สำรองเก็บ Timestamp เป็น {_seconds,_nanoseconds} (จาก GitHub) หรือ {seconds,nanoseconds} (จากปุ่มในแอป)
// ต้องแปลงกลับทุกชั้น ไม่งั้น createdAt กลายเป็น map ธรรมดา แล้วค้นเป็นช่วงวันที่ไม่เจอ
const reviveTimestamps = (v) => {
  if (Array.isArray(v)) return v.map(reviveTimestamps);
  if (v && typeof v === "object") {
    const keys = Object.keys(v);
    const s = v._seconds ?? v.seconds;
    const ns = v._nanoseconds ?? v.nanoseconds;
    if (typeof s === "number" && typeof ns === "number" && keys.length === 2) return new Timestamp(s, ns);
    const out = {};
    keys.forEach(k => { out[k] = reviveTimestamps(v[k]); });
    return out;
  }
  return v;
};

// รูปที่ตอนลบบิลถูกลบออกจาก Storage ไปด้วย — กู้เอกสารได้ แต่รูปกลับมาไม่ได้ ต้องบอกให้รู้ก่อน
const storagePathsOf = (inv) => (JSON.stringify(inv).match(/firebasestorage\.googleapis\.com[^"]*/g) || []).length;

export default function RestoreDeletedInvoices({ user, role }) {
  const [file, setFile] = React.useState(null);        // { name, invoices }
  const [q, setQ] = React.useState("");
  const [checked, setChecked] = React.useState({});    // _id → "missing" | "exists" | "checking" | "error"
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState(null);

  const pickFile = (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setMsg(null); setChecked({}); setFile(null);
    const r = new FileReader();
    r.onload = () => {
      try {
        const data = JSON.parse(String(r.result || ""));
        const raw = data?.collections?.invoices;
        const invoices = (Array.isArray(raw) ? raw : Object.values(raw || {})).filter(x => x && x._id);
        if (!invoices.length) { setMsg({ err: true, t: "ไฟล์นี้ไม่มีบิล — ต้องเป็นไฟล์สำรองแบบ JSON" }); return; }
        setFile({ name: f.name, invoices, at: data?.metadata?.exportedAt || "" });
      } catch (err) {
        setMsg({ err: true, t: "อ่านไฟล์ไม่ได้: " + (err?.message || err) });
      }
    };
    r.readAsText(f);
  };

  // ค้นก่อนแล้วค่อยเช็คกับระบบจริงเฉพาะที่ค้นเจอ — ไฟล์มีหลายพันใบ เช็คทั้งหมดเปลืองโควตาอ่านเปล่า ๆ
  const matches = React.useMemo(() => {
    if (!file) return [];
    const t = norm(q);
    if (t.length < 2) return [];
    return file.invoices
      .filter(i => [i.invoiceNo, i.customerName, i.customerPhone, i.date].some(x => norm(x).includes(t)))
      .slice(0, 40);
  }, [file, q]);

  const checkLive = async () => {
    const todo = matches.filter(i => !checked[i._id] || checked[i._id] === "error");
    if (!todo.length) return;
    setChecked(c => { const x = { ...c }; todo.forEach(i => { x[i._id] = "checking"; }); return x; });
    for (const i of todo) {
      try {
        const snap = await getDoc(doc(db, "invoices", i._id));
        setChecked(c => ({ ...c, [i._id]: snap.exists() ? "exists" : "missing" }));
      } catch {
        setChecked(c => ({ ...c, [i._id]: "error" }));
      }
    }
  };

  const restoreOne = async (inv) => {
    const NL = String.fromCharCode(10);
    const imgs = storagePathsOf(inv);
    if (!window.confirm(
      `กู้บิล ${inv.invoiceNo} · ${inv.customerName} · ฿${money(inv.total)} กลับเข้าระบบ?` + NL + NL +
      `จากไฟล์สำรอง ${file.name}` + NL +
      `ใช้รหัสเอกสารเดิม — รอบแพ็ค/ใบสั่งของที่เคยผูกจะเชื่อมกลับเอง` + NL +
      `ข้อมูลในบิลจะเป็นตามเวลาที่สำรองไว้ (ถ้าเคยแก้/ชำระหลังเวลานั้น ต้องทำซ้ำ)` +
      (imgs ? NL + NL + `⚠️ บิลนี้มีรูป ${imgs} รูป — ตอนลบบิลรูปถูกลบไปด้วย กู้เอกสารได้แต่รูปจะไม่ขึ้น` : "")
    )) return;
    setBusy(true); setMsg(null);
    const { _id, ...rest } = inv;
    const data = reviveTimestamps(rest);
    try {
      await runTransaction(db, async (tx) => {
        const ref = doc(db, "invoices", _id);
        const snap = await tx.get(ref);
        // 🔒 มีอยู่แล้ว = ห้ามทับ ไม่ว่ากรณีไหน — บิลที่ใช้งานอยู่อาจถูกแก้/ชำระหลังเวลาสำรอง
        if (snap.exists()) throw Object.assign(new Error("บิลนี้ยังอยู่ในระบบ — ไม่กู้ทับ"), { code: "EXISTS" });
        tx.set(ref, data);
      });

      // 🔗 ตอนลบบิล ใบสั่งของที่ผูกไว้ถูกปลดเป็น "ยังไม่ออกบิล" — ผูกกลับเฉพาะใบที่ยังว่างอยู่
      //    ถ้าระหว่างนั้นเอาไปออกบิลใบใหม่แล้ว ห้ามแย่งกลับ
      const linkIds = [...new Set(inv.mergedFromOrderIds || [])];
      let relinked = 0;
      if (linkIds.length) {
        const b = writeBatch(db);
        for (const oid of linkIds) {
          const os = await getDoc(doc(db, "orders", oid));
          if (os.exists() && !os.data().invoiceId) {
            b.update(doc(db, "orders", oid), { invoiceId: _id, invoiceNo: inv.invoiceNo || "", invoicedAt: inv.date || "" });
            relinked++;
          }
        }
        if (relinked) await b.commit();
      }

      logAudit(user, {
        action: AUDIT_ACTIONS.RESTORE, collection: "invoices", targetId: _id,
        targetLabel: `${inv.invoiceNo} · ${inv.customerName}`,
        after: { total: inv.total, status: inv.status },
        note: `กู้บิลที่ถูกลบ จากไฟล์สำรอง ${file.name}` + (relinked ? ` · ผูกใบสั่งของกลับ ${relinked} ใบ` : ""),
      });
      setChecked(c => ({ ...c, [_id]: "exists" }));
      setMsg({ t: `✅ กู้บิล ${inv.invoiceNo} แล้ว` + (relinked ? ` · ผูกใบสั่งของกลับ ${relinked} ใบ` : "") + (imgs ? " · รูปกู้ไม่ได้" : "") });
    } catch (err) {
      if (err?.code === "EXISTS") setChecked(c => ({ ...c, [_id]: "exists" }));
      setMsg({ err: true, t: `กู้ ${inv.invoiceNo} ไม่สำเร็จ: ${err?.message || err}` });
    } finally {
      setBusy(false);
    }
  };

  // เฉพาะ admin — เขียนเอกสารบิลลงระบบจริงด้วยรหัสที่ระบุเอง
  //   (วางไว้หลัง hook ทุกตัว — ถ้า return ก่อน hook จำนวน hook จะไม่เท่ากันทุกรอบ React พัง)
  if (user?.role !== "admin") return null;

  return (
    <div style={{ marginTop: 16, padding: 16, borderRadius: 12, border: `1px solid ${T.border}`, background: T.card || "white" }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: T.text, marginBottom: 4 }}>♻️ กู้บิลที่ถูกลบ</div>
      <div style={{ fontSize: 12, color: T.sub, lineHeight: 1.7, marginBottom: 12 }}>
        กู้ทีละใบจากไฟล์สำรองรายวัน ด้วยรหัสเอกสารเดิม · <b>กู้ได้เฉพาะใบที่ไม่มีอยู่ในระบบแล้ว</b> ทับบิลที่ยังใช้งานไม่ได้<br/>
        ไฟล์สำรองอยู่ในเครื่องที่ <code style={{ fontSize: 11 }}>my-inventory\backups\cpu-erp\ปี-เดือน-วัน.json</code>
        {" "}— เลือกไฟล์ของวันที่ <b>หลังจาก</b>สร้างบิล และ<b>ก่อน</b>ถูกลบ
      </div>

      <label style={{ display: "inline-block", padding: "8px 14px", borderRadius: 9, border: `1px dashed ${T.accent}`, color: T.accent, cursor: "pointer", fontSize: 12.5, fontWeight: 700 }}>
        📂 เลือกไฟล์สำรอง (.json)
        <input type="file" accept=".json,application/json" onChange={pickFile} style={{ display: "none" }}/>
      </label>
      {file && <span style={{ marginLeft: 10, fontSize: 12, color: T.sub }}>{file.name} · บิล {file.invoices.length.toLocaleString("th-TH")} ใบ</span>}

      {file && (
        <>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="ค้นเลขบิล / ชื่อลูกค้า / วันที่ เช่น INV6909-0069 หรือ 12/09/2026"
              style={{ flex: 1, background: T.input, border: `1px solid ${T.inputBorder}`, color: T.text, borderRadius: 8, padding: "8px 12px", fontFamily: "'Sarabun',sans-serif", fontSize: 13, outline: "none" }}/>
            <BtnGhost onClick={checkLive} disabled={!matches.length || busy}>🔎 เช็คกับระบบจริง ({matches.length})</BtnGhost>
          </div>
          {q.trim().length > 0 && q.trim().length < 2 && <div style={{ fontSize: 11, color: T.muted, marginTop: 6 }}>พิมพ์อย่างน้อย 2 ตัวอักษร</div>}
          {matches.length > 0 && (
            <div style={{ marginTop: 10, border: `1px solid ${T.border}`, borderRadius: 9, maxHeight: 340, overflowY: "auto" }}>
              {matches.map((i, n) => {
                const st = checked[i._id];
                return (
                  <div key={i._id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderTop: n ? `1px solid ${T.border}` : "none", fontSize: 12.5, flexWrap: "wrap" }}>
                    <span style={{ fontFamily: "monospace", fontWeight: 700, color: T.accent }}>{i.invoiceNo}</span>
                    <span style={{ fontWeight: 600 }}>{i.customerName}</span>
                    <span style={{ color: T.muted }}>{i.date}</span>
                    <span style={{ fontFamily: "monospace" }}>฿{money(i.total)}</span>
                    <span style={{ color: T.muted }}>{i.status}</span>
                    <span style={{ marginLeft: "auto" }}>
                      {!st && <span style={{ color: T.muted, fontSize: 11 }}>ยังไม่ได้เช็ค</span>}
                      {st === "checking" && <span style={{ color: T.muted, fontSize: 11 }}>กำลังเช็ค…</span>}
                      {st === "error" && <span style={{ color: T.red, fontSize: 11 }}>เช็คไม่ได้</span>}
                      {st === "exists" && <span style={{ color: T.green, fontSize: 11, fontWeight: 700 }}>✅ มีอยู่ในระบบ</span>}
                      {st === "missing" && (
                        <BtnPrimary onClick={() => restoreOne(i)} disabled={busy} style={{ padding: "5px 12px", fontSize: 12 }}>
                          ♻️ ถูกลบแล้ว — กู้ใบนี้
                        </BtnPrimary>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {msg && (
        <div style={{ marginTop: 10, padding: "8px 12px", borderRadius: 8, fontSize: 12.5,
          background: msg.err ? "rgba(220,38,38,0.07)" : "rgba(22,163,74,0.08)", color: msg.err ? T.red : T.green }}>
          {msg.t}
        </div>
      )}
    </div>
  );
}
