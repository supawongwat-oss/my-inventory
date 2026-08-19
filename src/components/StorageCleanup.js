// 🧹 ล้างพื้นที่ Storage — หาไฟล์ "กำพร้า" (ไม่มีเอกสารไหนอ้างถึงแล้ว) แล้วลบทิ้ง
//
// ทำไมต้องมี: หลายทางที่ไฟล์หลุดไปค้างใน Storage โดยไม่มีใครชี้ถึง
//   · แนบรูปเข้าบิลแล้วปิดหน้าต่างโดยไม่บันทึก (ไฟล์ถูกอัปตั้งแต่ตอนแนบ)
//   · ลบเอกสารรุ่นเก่า ๆ ที่ยังไม่ได้ลบรูปตาม
//   · อัปโหลดพลาดแล้วอัปใหม่
//
// 🔒 กติกาความปลอดภัย 4 ชั้น — ตั้งใจให้ซ้ำซ้อน เพราะลบไฟล์จริงแล้วเอาคืนไม่ได้
//   1. อ่าน "ทุกเอกสาร" จาก Firestore โดยตรง ไม่ใช้ข้อมูลที่หน้าจอโหลดไว้
//      (หน้าจอโหลดแค่ช่วงวันที่ที่เลือก ถ้าเอามาใช้จะเห็นบิลเก่าเป็นกำพร้าทั้งกอง)
//   2. เก็บ "ทุกข้อความ" ในเอกสารมาเทียบ ไม่ไล่ทีละฟิลด์ — ฟิลด์ใหม่ที่เพิ่มทีหลังจึงไม่หลุด
//      และเทียบทั้งรูปแบบ path และรูปแบบ URL เต็ม (บางที่เก็บแค่ URL ไม่ได้เก็บ path)
//   3. ลบเฉพาะไฟล์ในโฟลเดอร์ที่แอปอัปรูปเข้าไปเท่านั้น — เอกสารพนักงาน/ภาษี ไม่แตะ
//   4. เว้นไฟล์ที่เพิ่งสร้าง (ค่าเริ่มต้น 7 วัน) — กันไฟล์ของคนที่กำลังกรอกฟอร์มค้างอยู่
//   ถ้าอ่าน Firestore พลาดแม้แต่คอลเลกชันเดียว ปุ่มลบจะไม่เปิดให้กดเลย
import { useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase";
import { T } from "../theme";
import { listAllFiles, deleteFileStrict, fmtBytes } from "../utils/upload";

// คอลเลกชันที่อาจอ้างถึงไฟล์ใน Storage
// (orders / catalogOrders / attendance / auditLog / transactions ไม่เก็บไฟล์ และเป็นชุดที่ใหญ่มาก จึงไม่อ่าน)
const SCAN_COLLECTIONS = [
  "invoices", "customOrders", "productionOrders",
  "clothing", "products", "employees", "taxDocs", "customers", "suppliers",
];

// โฟลเดอร์ที่แอปอัป "รูป" เข้าไป — มีแค่นี้ที่ยอมให้ลบ
const CLEANABLE_PREFIXES = ["invoiceJobs/", "customOrders/", "clothing/", "products/"];

const isCleanable = (path) => CLEANABLE_PREFIXES.some(p => path.startsWith(p));

// 🔎 ดึง "ทุกข้อความ" ในเอกสารออกมา แล้วแปลงเป็น path ของ Storage
//   · ข้อความที่เป็น URL ของ Storage → ถอดส่วน /o/<path ที่ encode ไว้> ออกมา
//   · ข้อความอื่น → ใช้ตรง ๆ (เผื่อเป็น path ที่เก็บไว้)
function collectRefs(val, out, depth = 0) {
  if (val == null || depth > 12) return;
  if (typeof val === "string") {
    if (!val || val.length > 2000) return;
    if (val.startsWith("data:")) return;                 // base64 ฝังในเอกสาร ไม่ใช่ไฟล์ใน Storage
    const m = val.match(/\/o\/([^?]+)/);                 // https://firebasestorage.../o/invoiceJobs%2F123.jpg?alt=...
    if (m) { try { out.add(decodeURIComponent(m[1])); } catch (e) { out.add(m[1]); } return; }
    out.add(val);
    return;
  }
  if (Array.isArray(val)) { val.forEach(v => collectRefs(v, out, depth + 1)); return; }
  if (typeof val === "object") { Object.values(val).forEach(v => collectRefs(v, out, depth + 1)); }
}

const DAY = 24 * 60 * 60 * 1000;

export default function StorageCleanup({ user }) {
  const [phase, setPhase] = useState("idle");     // idle | scanning | done | deleting
  const [step, setStep] = useState("");
  const [err, setErr] = useState("");
  const [minAgeDays, setMinAgeDays] = useState(7);
  const [result, setResult] = useState(null);     // { files, refCount, docCount, byCollection }
  const [deleted, setDeleted] = useState(null);   // { ok, fail }

  const isAdmin = user?.role === "admin";

  const scan = async () => {
    setPhase("scanning"); setErr(""); setResult(null); setDeleted(null);
    try {
      // 1) ไฟล์ทั้งหมดใน Storage
      setStep("กำลังอ่านรายการไฟล์ใน Storage...");
      const files = await listAllFiles("", n => setStep(`อ่านไฟล์ใน Storage แล้ว ${n} ไฟล์...`));

      // 2) ทุกเอกสารในคอลเลกชันที่อาจอ้างถึงไฟล์
      const refs = new Set();
      const byCollection = [];
      let docCount = 0;
      for (const name of SCAN_COLLECTIONS) {
        setStep(`กำลังอ่านเอกสาร ${name}...`);
        const snap = await getDocs(collection(db, name));   // พลาดที่ไหน → throw ออกไป ไม่เปิดปุ่มลบ
        snap.forEach(d => collectRefs(d.data(), refs));
        byCollection.push({ name, count: snap.size });
        docCount += snap.size;
      }

      setStep("");
      setResult({ files, refs, refCount: refs.size, docCount, byCollection });
      setPhase("done");
    } catch (e) {
      setErr(e?.message || String(e));
      setStep("");
      setPhase("idle");
    }
  };

  // จัดกลุ่มไฟล์เป็น 3 พวก
  const classify = () => {
    if (!result) return null;
    const cutoff = Date.now() - minAgeDays * DAY;
    const used = [], tooNew = [], outOfScope = [], orphans = [];
    result.files.forEach(f => {
      if (result.refs.has(f.path)) { used.push(f); return; }
      if (!isCleanable(f.path)) { outOfScope.push(f); return; }
      const t = f.created ? new Date(f.created).getTime() : 0;
      if (t && t > cutoff) { tooNew.push(f); return; }
      orphans.push(f);
    });
    return { used, tooNew, outOfScope, orphans };
  };

  const groups = classify();
  const sum = (list) => list.reduce((s, f) => s + f.size, 0);

  const runDelete = async () => {
    if (!groups || groups.orphans.length === 0) return;
    const n = groups.orphans.length;
    const mb = fmtBytes(sum(groups.orphans));
    if (!window.confirm(`⚠️ ลบไฟล์กำพร้า ${n} ไฟล์ (${mb}) ถาวร?\n\nเอาคืนไม่ได้ — แนะนำ Backup ก่อน`)) return;
    if (!window.confirm(`ยืนยันอีกครั้ง — ลบ ${n} ไฟล์`)) return;
    setPhase("deleting");
    let ok = 0, fail = 0;
    for (let i = 0; i < groups.orphans.length; i += 10) {
      const batch = groups.orphans.slice(i, i + 10);
      // ใช้ deleteFileStrict เพราะ deleteFile กลืน error ทิ้ง ตัวเลขที่รายงานจะไม่ตรงความจริง
      // eslint-disable-next-line no-loop-func
      await Promise.all(batch.map(f => deleteFileStrict(f.path).then(() => { ok++; }, () => { fail++; })));
      setStep(`ลบแล้ว ${ok + fail} / ${n} ไฟล์...`);
    }
    setDeleted({ ok, fail });
    setStep("");
    setPhase("done");
    // ตัดไฟล์ที่ลบแล้วออกจากผลสำรวจ ไม่ให้กดลบซ้ำ
    const gone = new Set(groups.orphans.map(f => f.path));
    setResult(r => ({ ...r, files: r.files.filter(f => !gone.has(f.path)) }));
  };

  const Row = ({ label, list, color, hint }) => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, padding: "8px 0", borderBottom: `1px solid ${T.border}` }}>
      <div>
        <div style={{ fontSize: 13, color: color || T.text, fontWeight: 600 }}>{label}</div>
        {hint && <div style={{ fontSize: 10, color: T.muted, marginTop: 2 }}>{hint}</div>}
      </div>
      <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
        <div style={{ fontSize: 13, fontFamily: "monospace", fontWeight: 700, color: color || T.text }}>{list.length.toLocaleString("th-TH")} ไฟล์</div>
        <div style={{ fontSize: 11, fontFamily: "monospace", color: T.muted }}>{fmtBytes(sum(list))}</div>
      </div>
    </div>
  );

  if (!isAdmin) {
    return <div style={{ padding: 16, fontSize: 13, color: T.muted }}>🔒 เครื่องมือนี้ใช้ได้เฉพาะ admin</div>;
  }

  return (
    <div>
      <div style={{ fontSize: 15, fontWeight: 700, color: T.text, marginBottom: 4 }}>🧹 ล้างพื้นที่ Storage</div>
      <div style={{ fontSize: 12, color: T.muted, marginBottom: 14, lineHeight: 1.7 }}>
        หาไฟล์ที่ไม่มีเอกสารไหนอ้างถึงแล้ว — เกิดจากแนบรูปแล้วไม่บันทึก หรือลบเอกสารเก่าโดยไม่ได้ลบรูปตาม
        <br/>สำรวจอย่างเดียวก่อน ยังไม่ลบอะไร จนกว่าจะกดปุ่มลบเอง
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
        <button onClick={scan} disabled={phase === "scanning" || phase === "deleting"}
          style={{ padding: "9px 18px", borderRadius: 9, border: "none", background: "linear-gradient(135deg,#3b5b8b,#3b5b8b)", color: "white", fontSize: 13, fontWeight: 600, cursor: (phase === "scanning" || phase === "deleting") ? "wait" : "pointer", fontFamily: "'Sarabun',sans-serif", opacity: (phase === "scanning" || phase === "deleting") ? 0.6 : 1 }}>
          {phase === "scanning" ? "⏳ กำลังสำรวจ..." : "🔍 สำรวจพื้นที่"}
        </button>
        <label style={{ fontSize: 12, color: T.sub, display: "flex", alignItems: "center", gap: 6 }}>
          เว้นไฟล์ที่สร้างภายใน
          <input type="number" min="0" value={minAgeDays} onChange={e => setMinAgeDays(Math.max(0, Number(e.target.value) || 0))}
            style={{ width: 54, textAlign: "center", padding: "5px 6px", borderRadius: 7, border: `1px solid ${T.border}`, fontFamily: "monospace", fontSize: 12 }}/>
          วัน
        </label>
      </div>

      {step && <div style={{ fontSize: 12, color: T.accent, marginBottom: 12 }}>{step}</div>}
      {err && <div style={{ padding: 10, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, fontSize: 12, color: T.red, marginBottom: 12 }}>
        สำรวจไม่สำเร็จ: {err}<br/>
        <span style={{ fontSize: 11 }}>ยังไม่ได้ลบอะไรทั้งนั้น — อ่านข้อมูลไม่ครบ ระบบจะไม่ยอมให้ลบ</span>
      </div>}

      {groups && (
        <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: "4px 14px 14px" }}>
          <Row label="✅ ยังใช้งานอยู่" list={groups.used} color={T.green} hint="มีเอกสารอ้างถึง — ไม่แตะ"/>
          <Row label="🔒 นอกขอบเขต" list={groups.outOfScope} color={T.sub} hint="เอกสารพนักงาน/ภาษี และโฟลเดอร์อื่น — เครื่องมือนี้ไม่ลบให้"/>
          <Row label={`🕐 เพิ่งสร้าง (ไม่ถึง ${minAgeDays} วัน)`} list={groups.tooNew} color={T.amber} hint="เว้นไว้ เผื่อมีคนกำลังกรอกฟอร์มค้างอยู่"/>
          <Row label="🗑️ กำพร้า — ลบได้" list={groups.orphans} color={T.red} hint="ไม่มีเอกสารไหนอ้างถึงแล้ว"/>

          <div style={{ fontSize: 11, color: T.muted, marginTop: 12, lineHeight: 1.7 }}>
            อ่านเอกสารจริงจาก Firestore {result.docCount.toLocaleString("th-TH")} ใบ ({result.byCollection.map(c => `${c.name} ${c.count}`).join(" · ")})
            <br/>พบการอ้างถึงไฟล์ {result.refCount.toLocaleString("th-TH")} รายการ
          </div>

          {groups.orphans.length > 0 && (
            <>
              <div style={{ marginTop: 12, maxHeight: 150, overflowY: "auto", background: "white", border: `1px solid ${T.border}`, borderRadius: 8, padding: 8 }}>
                {groups.orphans.slice(0, 200).map(f => (
                  <div key={f.path} style={{ fontSize: 10, fontFamily: "monospace", color: T.sub, display: "flex", justifyContent: "space-between", gap: 8, padding: "2px 0" }}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.path}</span>
                    <span style={{ whiteSpace: "nowrap", color: T.muted }}>{fmtBytes(f.size)} · {(f.created || "").slice(0, 10)}</span>
                  </div>
                ))}
                {groups.orphans.length > 200 && <div style={{ fontSize: 10, color: T.muted, marginTop: 4 }}>...และอีก {groups.orphans.length - 200} ไฟล์</div>}
              </div>
              <button onClick={runDelete} disabled={phase === "deleting"}
                style={{ marginTop: 12, padding: "9px 18px", borderRadius: 9, border: "none", background: "#dc2626", color: "white", fontSize: 13, fontWeight: 600, cursor: phase === "deleting" ? "wait" : "pointer", fontFamily: "'Sarabun',sans-serif", opacity: phase === "deleting" ? 0.6 : 1 }}>
                {phase === "deleting" ? "⏳ กำลังลบ..." : `🗑️ ลบไฟล์กำพร้า ${groups.orphans.length} ไฟล์ (${fmtBytes(sum(groups.orphans))})`}
              </button>
            </>
          )}

          {deleted && (
            <div style={{ marginTop: 12, padding: 10, background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.25)", borderRadius: 8, fontSize: 12, color: T.green }}>
              ✅ ลบสำเร็จ {deleted.ok} ไฟล์{deleted.fail ? ` · ลบไม่ได้ ${deleted.fail} ไฟล์ (อาจถูกลบไปแล้ว)` : ""}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
