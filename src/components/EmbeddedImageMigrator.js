// 🖼️ ย้ายรูปที่ฝังอยู่ในเอกสาร ขึ้นไปเก็บบน Storage
//
// ทำไมมีรูปฝังอยู่ในเอกสาร: ตอนแนบรูป ถ้าอัปขึ้น Storage ไม่สำเร็จ ระบบจะเก็บรูป
// เป็นข้อความ base64 ลงในตัวเอกสารแทน — ตั้งใจให้รูปไม่หาย ดีกว่าปล่อยหลุด
// แต่ผลข้างเคียงคือเอกสารบวมมหาศาล
//
// ทำไมต้องย้ายออก:
//   1. Firestore จำกัดเอกสารละ 1 MB — บิลที่บวมจนเฉียดเพดานจะแก้ไม่ได้อีกเลย
//      (ในข้อมูลจริง INV6907-0002 หนัก 768 KB จากรูป 5 รูป = 36% ของข้อมูลบิลทั้งหมด)
//   2. บิลถูกดึงมาทั้งก้อนเสมอ เลือกไม่เอาบางฟิลด์ไม่ได้ — รูปจึงถูกโหลดซ้ำ ๆ
//      ทุกครั้งที่เปิดหน้าที่มีบิลใบนั้น ทั้งที่แทบไม่มีใครเปิดดูรูป
//
// 🔒 กติกา: สแกนอย่างเดียวก่อนเสมอ · โชว์ว่าจะแตะเอกสารไหนบ้าง · ต้องกดยืนยัน
//    อัปโหลดสำเร็จก่อนถึงจะเขียนทับ ถ้าอัปไม่ผ่านจะข้ามใบนั้นไป รูปเดิมไม่ถูกแตะ
import { useState } from "react";
import { collection, getDocs, doc, updateDoc } from "firebase/firestore";
import { db } from "../firebase";
import { T } from "../theme";
import { uploadImage } from "../utils/upload";
import { logAudit, AUDIT_ACTIONS } from "../utils/audit";

// คอลเลกชันที่แนบรูปได้ + โฟลเดอร์ปลายทางบน Storage
const TARGETS = [
  { col: "invoices", folder: "invoiceJobs", labelOf: d => d.invoiceNo || d.id },
  { col: "customOrders", folder: "customOrders", labelOf: d => d.orderNo || d.id },
  { col: "productionOrders", folder: "customOrders", labelOf: d => d.prodNo || d.orderNo || d.id },
  { col: "returns", folder: "returns", labelOf: d => d.returnNo || d.id },
];

const isEmbedded = (v) => typeof v === "string" && v.startsWith("data:image/");
const bytesOf = (o) => JSON.stringify(o == null ? null : o).length;
const fmtKB = (n) => `${(n / 1024).toFixed(0)} KB`;

// นับรูปฝังในเอกสาร โดยไม่แก้อะไร
function countEmbedded(val, depth = 0) {
  if (val == null || depth > 12) return 0;
  if (typeof val === "string") return isEmbedded(val) ? 1 : 0;
  if (Array.isArray(val)) return val.reduce((s, v) => s + countEmbedded(v, depth + 1), 0);
  if (typeof val === "object") return Object.values(val).reduce((s, v) => s + countEmbedded(v, depth + 1), 0);
  return 0;
}

// เดินทั้งก้อน แทนที่รูปฝังด้วย URL ที่อัปขึ้น Storage แล้ว
// คืนของใหม่เสมอ ไม่แก้ของเดิม — ถ้าอัปพลาดกลางทางจะได้ไม่มีอะไรค้างครึ่ง ๆ กลาง ๆ
async function replaceEmbedded(val, folder, stats, depth = 0) {
  if (val == null || depth > 12) return val;
  if (typeof val === "string") {
    if (!isEmbedded(val)) return val;
    const { url, path } = await uploadImage(val, folder);
    stats.moved++;
    stats.freed += val.length;
    stats.paths.push(path);
    return url;
  }
  if (Array.isArray(val)) {
    const out = [];
    for (const v of val) out.push(await replaceEmbedded(v, folder, stats, depth + 1));
    return out;
  }
  if (typeof val === "object") {
    const out = {};
    for (const [k, v] of Object.entries(val)) out[k] = await replaceEmbedded(v, folder, stats, depth + 1);
    // ที่เก็บรูปในระบบนี้เป็นคู่ { dataUrl, path } — ตอนเก็บ base64 ช่อง path จะว่าง
    // เติม path ให้ด้วย ไม่งั้น "🧹 ล้างพื้นที่" จะเห็นไฟล์ที่เพิ่งย้ายมาเป็นไฟล์กำพร้า
    if ("path" in out && !out.path && stats.paths.length) out.path = stats.paths[stats.paths.length - 1];
    return out;
  }
  return val;
}

export default function EmbeddedImageMigrator({ user }) {
  const [phase, setPhase] = useState("idle");   // idle | scanning | done | working
  const [step, setStep] = useState("");
  const [err, setErr] = useState("");
  const [hits, setHits] = useState(null);       // [{ col, folder, id, label, imgs, bytes }]
  const [result, setResult] = useState(null);

  const scan = async () => {
    setPhase("scanning"); setErr(""); setHits(null); setResult(null);
    try {
      const found = [];
      for (const t of TARGETS) {
        setStep(`กำลังอ่าน ${t.col}…`);
        const snap = await getDocs(collection(db, t.col));
        snap.forEach(d => {
          const data = d.data();
          const imgs = countEmbedded(data);
          if (imgs > 0) found.push({ col: t.col, folder: t.folder, id: d.id, label: t.labelOf({ ...data, id: d.id }), imgs, bytes: bytesOf(data) });
        });
      }
      found.sort((a, b) => b.bytes - a.bytes);
      setHits(found); setPhase("done"); setStep("");
    } catch (e) {
      setErr(e?.message || String(e)); setPhase("idle"); setStep("");
    }
  };

  const migrate = async () => {
    if (!hits?.length) return;
    const NL = String.fromCharCode(10);
    const totalImgs = hits.reduce((s, h) => s + h.imgs, 0);
    if (!window.confirm(
      `ย้ายรูป ${totalImgs} รูป จาก ${hits.length} เอกสาร ขึ้น Storage?` + NL + NL +
      hits.slice(0, 8).map(h => `• ${h.label} — ${h.imgs} รูป · ${fmtKB(h.bytes)}`).join(NL) +
      (hits.length > 8 ? NL + `… และอีก ${hits.length - 8} เอกสาร` : "") + NL + NL +
      "รูปยังอยู่ครบเหมือนเดิม แค่ย้ายที่เก็บ — เอกสารจะเล็กลงมาก" + NL +
      "ใบไหนอัปโหลดไม่ผ่านจะถูกข้าม ของเดิมไม่ถูกแตะ"
    )) return;

    setPhase("working");
    const ok = [], fail = [];
    let freed = 0;
    for (let i = 0; i < hits.length; i++) {
      const h = hits[i];
      setStep(`${i + 1}/${hits.length} — ${h.label}`);
      try {
        const snap = await getDocs(collection(db, h.col));
        const found = snap.docs.find(d => d.id === h.id);
        if (!found) { fail.push(`${h.label} — หาเอกสารไม่เจอแล้ว`); continue; }
        const data = found.data();
        const stats = { moved: 0, freed: 0, paths: [] };
        // แทนที่ทีละฟิลด์บนสุด แล้วเขียนกลับเฉพาะฟิลด์ที่เปลี่ยนจริง
        // ไม่เขียนทับทั้งเอกสาร — ถ้ามีคนแก้ฟิลด์อื่นอยู่พร้อมกันจะได้ไม่โดนย้อน
        const patchObj = {};
        for (const [k, v] of Object.entries(data)) {
          if (countEmbedded(v) === 0) continue;
          patchObj[k] = await replaceEmbedded(v, h.folder, stats);
        }
        if (!Object.keys(patchObj).length) continue;
        await updateDoc(doc(db, h.col, h.id), patchObj);
        freed += stats.freed;
        ok.push({ label: h.label, moved: stats.moved, before: h.bytes, after: h.bytes - stats.freed });
        logAudit(user, {
          action: AUDIT_ACTIONS.UPDATE, collection: h.col, targetId: h.id, targetLabel: h.label,
          note: `ย้ายรูปฝัง ${stats.moved} รูปขึ้น Storage · เอกสารเล็กลง ${fmtKB(stats.freed)}`,
        });
      } catch (e) {
        fail.push(`${h.label} — ${e?.message || e}`);
      }
    }
    setResult({ ok, fail, freed });
    setPhase("done"); setStep("");
    await scan();
  };

  const box = { padding: 14, background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, marginBottom: 12 };
  const totalImgs = hits?.reduce((s, h) => s + h.imgs, 0) || 0;
  const totalBytes = hits?.reduce((s, h) => s + h.bytes, 0) || 0;

  return (
    <div>
      <div style={{ fontSize: 16, fontWeight: 800, color: T.text, marginBottom: 4 }}>🖼️ ย้ายรูปที่ฝังในเอกสารขึ้น Storage</div>
      <div style={{ fontSize: 11.5, color: T.muted, marginBottom: 14, lineHeight: 1.8 }}>
        ตอนแนบรูป ถ้าอัปขึ้น Storage ไม่สำเร็จ ระบบจะเก็บรูปลงในตัวเอกสารแทนเพื่อไม่ให้รูปหาย
        — แต่ทำให้เอกสารบวมจนเฉียดเพดาน 1 MB ของ Firestore และถูกโหลดซ้ำทุกครั้งที่เปิดหน้าที่มีเอกสารนั้น
        <br/>เครื่องมือนี้ย้ายรูปออกไปเก็บที่ Storage แล้วให้เอกสารชี้ไปหาแทน <b>รูปยังอยู่ครบ ไม่มีอะไรถูกลบ</b>
      </div>

      <div style={box}>
        <button onClick={scan} disabled={phase === "scanning" || phase === "working"}
          style={{ padding: "9px 18px", borderRadius: 9, border: "none", cursor: phase === "idle" || phase === "done" ? "pointer" : "default",
            background: phase === "scanning" || phase === "working" ? "#cbd5e1" : "linear-gradient(135deg,#3b5b8b,#3b5b8b)",
            color: "white", fontSize: 13, fontWeight: 700, fontFamily: "'Sarabun',sans-serif" }}>
          {phase === "scanning" ? "⏳ กำลังสแกน…" : phase === "working" ? "⏳ กำลังย้าย…" : "🔍 สแกนหารูปที่ฝังอยู่"}
        </button>
        {step && <div style={{ fontSize: 11.5, color: T.accent, marginTop: 8 }}>{step}</div>}
        {err && <div style={{ fontSize: 12, color: T.red, marginTop: 8 }}>🚨 {err}</div>}
      </div>

      {hits && (
        <div style={box}>
          {hits.length === 0 ? (
            <div style={{ fontSize: 13, color: "#047857", fontWeight: 700 }}>✅ ไม่มีรูปฝังในเอกสารแล้ว — ทุกใบชี้ไปที่ Storage หมด</div>
          ) : (
            <>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#b45309", marginBottom: 8 }}>
                พบรูปฝังอยู่ {totalImgs} รูป ใน {hits.length} เอกสาร · รวม {fmtKB(totalBytes)}
              </div>
              <div style={{ maxHeight: 260, overflowY: "auto", marginBottom: 10 }}>
                {hits.map(h => (
                  <div key={`${h.col}/${h.id}`} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "6px 0", borderBottom: `1px solid ${T.border}`, fontSize: 12 }}>
                    <span style={{ fontFamily: "monospace", fontWeight: 700, color: T.accent, minWidth: 130 }}>{h.label}</span>
                    <span style={{ fontSize: 10.5, color: T.muted }}>{h.col}</span>
                    <span style={{ color: T.sub }}>{h.imgs} รูป</span>
                    <span style={{ marginLeft: "auto", fontFamily: "monospace", fontWeight: 700, color: h.bytes > 700 * 1024 ? T.red : T.sub }}>
                      {fmtKB(h.bytes)}{h.bytes > 700 * 1024 ? " ⚠️ เฉียดเพดาน 1 MB" : ""}
                    </span>
                  </div>
                ))}
              </div>
              <button onClick={migrate} disabled={phase === "working"}
                style={{ padding: "9px 18px", borderRadius: 9, border: "none", cursor: phase === "working" ? "default" : "pointer",
                  background: phase === "working" ? "#cbd5e1" : "linear-gradient(135deg,#d97706,#b45309)",
                  color: "white", fontSize: 13, fontWeight: 700, fontFamily: "'Sarabun',sans-serif" }}>
                🖼️ ย้ายรูปทั้งหมดขึ้น Storage
              </button>
            </>
          )}
        </div>
      )}

      {result && (
        <div style={box}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#047857", marginBottom: 6 }}>
            ✅ ย้ายสำเร็จ {result.ok.length} เอกสาร · เอกสารเล็กลงรวม {fmtKB(result.freed)}
          </div>
          {result.ok.map(o => (
            <div key={o.label} style={{ fontSize: 11.5, color: T.sub }}>
              {o.label} — {o.moved} รูป · {fmtKB(o.before)} → <b style={{ color: "#047857" }}>{fmtKB(o.after)}</b>
            </div>
          ))}
          {result.fail.length > 0 && (
            <div style={{ marginTop: 8, fontSize: 11.5, color: T.red }}>
              🚨 ไม่สำเร็จ {result.fail.length} เอกสาร (ของเดิมไม่ถูกแตะ):
              {result.fail.map((x, i) => <div key={i}>• {x}</div>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
