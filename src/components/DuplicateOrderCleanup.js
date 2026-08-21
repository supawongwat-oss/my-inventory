// 👯 หาใบสั่งของซ้ำ — เกิดจากกดปุ่มบันทึกซ้ำก่อนรอบแรกจะจบ
//
// ต้นเหตุแก้ไปแล้ว (ล็อกที่ handler + ปุ่มขึ้น "กำลังบันทึก") แต่ใบที่ซ้ำไปก่อนหน้านั้นยังค้างอยู่
// และใบซ้ำจะไม่มีวันถูกออกบิล เพราะออกบิลจากใบต้นฉบับใบเดียว
// → ค้างอยู่ในรายการ "ยังไม่ออกบิล" ตลอดไป และทำให้ยอดในรายงานเกินจริง
//
// จับซ้ำ 2 แบบ:
//   A. เลขที่เดียวกัน — ผิดแน่นอน เลขที่ใบสั่งต้องไม่ซ้ำ
//      (เกิดตอนจองเลขพลาดพร้อมกัน ทั้งสองรอบเลยคำนวณเลขจากรายการชุดเดียวกัน)
//   B. คนละเลข แต่ลูกค้า+รายการเหมือนกันเป๊ะ และสร้างห่างกันไม่เกินไม่กี่นาที
//      (กดซ้ำแล้วจองเลขสำเร็จทั้งคู่)
//
// 🔒 ความปลอดภัย:
//   · สำรวจอย่างเดียวก่อน ไม่ลบจนกว่าจะกดเอง
//   · ใบที่ออกบิลไปแล้วถูกเลือกให้ "เก็บไว้" เสมอ ลบไม่ได้ — ไม่งั้นบิลจะชี้ไปหาใบที่หายไป
//   · ถ้าใบที่ลบเคยตัดสต๊อก ระบบคืนสต๊อกให้และลงบันทึก "รับ" (ใช้ตรรกะเดียวกับปุ่มยกเลิกใบสั่ง)
//   · เปลี่ยนใบที่จะเก็บเองได้ทุกกลุ่ม ไม่ได้บังคับตามที่ระบบเดา
import { useState } from "react";
import { collection, getDocs, query, where, orderBy, Timestamp } from "firebase/firestore";
import { db } from "../firebase";
import { T } from "../theme";

const DAY = 24 * 60 * 60 * 1000;
// ห่างกันเกินนี้ถือว่าเป็นคนละครั้งที่ตั้งใจสั่ง ไม่ใช่กดซ้ำ
const NEAR_MS = 10 * 60 * 1000;

const tsOf = (o) => (o.createdAt?.seconds ? o.createdAt.seconds * 1000 : Date.parse(o.date || "") || 0);
const qtyOf = (o) => (o.items || []).reduce((s, i) => s + (Number(i.qty) || 0), 0);
const norm = (s) => String(s || "").normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();

// ลายนิ้วมือของ "เนื้อหาใบ" — เรียงก่อนต่อ เพราะลำดับรายการอาจสลับกันได้
const contentKey = (o) => {
  const items = (o.items || [])
    .map(i => [i.clothingId || i.clothingName || "", i.colorIdx ?? "", i.size || "", Number(i.qty) || 0].join("-"))
    .sort()
    .join(",");
  return `${norm(o.customerName)}|${items}`;
};

const fmtTime = (ms) => {
  if (!ms) return "-";
  const d = new Date(ms);
  return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}:${String(d.getSeconds()).padStart(2,"0")}`;
};

// เลือกใบที่ควรเก็บ: ใบที่ออกบิลแล้วมาก่อน ถ้าไม่มีก็เอาใบที่สร้างก่อน
const pickKeeper = (list) => {
  const billed = list.filter(o => o.invoiceId);
  if (billed.length) return billed.sort((a, b) => tsOf(a) - tsOf(b))[0].id;
  return [...list].sort((a, b) => tsOf(a) - tsOf(b))[0].id;
};

export default function DuplicateOrderCleanup({ user, onDeleteOrder }) {
  const [phase, setPhase] = useState("idle");   // idle | scanning | done | deleting
  const [step, setStep] = useState("");
  const [err, setErr] = useState("");
  const [days, setDays] = useState(30);
  const [groups, setGroups] = useState(null);
  const [keep, setKeep] = useState({});          // { groupKey: orderId ที่จะเก็บ }
  const [doneMsg, setDoneMsg] = useState("");

  const isAdmin = user?.role === "admin";

  const scan = async () => {
    setPhase("scanning"); setErr(""); setGroups(null); setDoneMsg("");
    try {
      setStep(`กำลังอ่านใบสั่งของย้อนหลัง ${days} วัน...`);
      const from = new Date(Date.now() - days * DAY);
      from.setHours(0, 0, 0, 0);
      const snap = await getDocs(query(
        collection(db, "orders"),
        where("createdAt", ">=", Timestamp.fromDate(from)),
        orderBy("createdAt", "desc"),
      ));
      const all = snap.docs.map(d => ({ ...d.data(), id: d.id }));

      const found = [];
      const used = new Set();

      // A. เลขที่ซ้ำ
      const byNo = new Map();
      all.forEach(o => {
        if (!o.orderNo) return;
        if (!byNo.has(o.orderNo)) byNo.set(o.orderNo, []);
        byNo.get(o.orderNo).push(o);
      });
      byNo.forEach((list, no) => {
        if (list.length < 2) return;
        list.forEach(o => used.add(o.id));
        found.push({ key: `no:${no}`, kind: "เลขที่ซ้ำ", label: no, list: [...list].sort((a,b)=>tsOf(a)-tsOf(b)) });
      });

      // B. เนื้อหาเหมือนกันและสร้างไล่ ๆ กัน (ใบที่เข้าข้อ A แล้วไม่นับซ้ำ)
      const byContent = new Map();
      all.forEach(o => {
        if (used.has(o.id)) return;
        const k = contentKey(o);
        if (!byContent.has(k)) byContent.set(k, []);
        byContent.get(k).push(o);
      });
      byContent.forEach((list, k) => {
        if (list.length < 2) return;
        // แยกเป็นกระจุก ๆ ตามเวลา — ลูกค้าสั่งของชุดเดิมซ้ำคนละวันไม่ใช่ใบซ้ำ
        const sorted = [...list].sort((a, b) => tsOf(a) - tsOf(b));
        let cluster = [sorted[0]];
        const flush = () => {
          if (cluster.length >= 2) {
            found.push({
              key: `c:${k}:${tsOf(cluster[0])}`, kind: "เนื้อหาเหมือนกัน",
              label: cluster.map(o => o.orderNo).filter(Boolean).join(" / ") || "(ไม่มีเลขที่)",
              list: cluster,
            });
          }
          cluster = [];
        };
        for (let i = 1; i < sorted.length; i++) {
          if (tsOf(sorted[i]) - tsOf(sorted[i - 1]) <= NEAR_MS) cluster.push(sorted[i]);
          else { flush(); cluster = [sorted[i]]; }
        }
        flush();
      });

      found.sort((a, b) => tsOf(b.list[0]) - tsOf(a.list[0]));
      const k0 = {};
      found.forEach(g => { k0[g.key] = pickKeeper(g.list); });
      setKeep(k0);
      setGroups({ found, scanned: all.length });
      setStep("");
      setPhase("done");
    } catch (e) {
      setErr(e?.message || String(e));
      setStep("");
      setPhase("idle");
    }
  };

  const toDelete = groups
    ? groups.found.flatMap(g => g.list.filter(o => o.id !== keep[g.key] && !o.invoiceId))
    : [];

  const runDelete = async () => {
    if (toDelete.length === 0) return;
    const qty = toDelete.reduce((s, o) => s + qtyOf(o), 0);
    const restocking = toDelete.filter(o => !o.deferStockCut && !o.hasPendingMix).length;
    if (!window.confirm(
      `⚠️ ลบใบสั่งของที่ซ้ำ ${toDelete.length} ใบ (รวม ${qty} ชิ้น) ถาวร?\n\n` +
      (restocking ? `📦 ${restocking} ใบเคยตัดสต๊อกไปแล้ว — ระบบจะคืนสต๊อกให้อัตโนมัติ\n\n` : "") +
      `เอาคืนไม่ได้ — แนะนำ Backup ก่อน`
    )) return;
    if (!window.confirm(`ยืนยันอีกครั้ง — ลบ ${toDelete.length} ใบ`)) return;
    setPhase("deleting");
    let ok = 0, fail = 0;
    for (const o of toDelete) {
      try { await onDeleteOrder(o, "ลบใบซ้ำ"); ok++; }
      catch (e) { console.warn("[dupOrders] ลบไม่สำเร็จ:", o.orderNo, e); fail++; }
      setStep(`ลบแล้ว ${ok + fail} / ${toDelete.length} ใบ...`);
    }
    setDoneMsg(`ลบสำเร็จ ${ok} ใบ${fail ? ` · ลบไม่ได้ ${fail} ใบ` : ""} — กดสำรวจอีกครั้งเพื่อดูผลล่าสุด`);
    setGroups(null);
    setStep("");
    setPhase("done");
  };

  if (!isAdmin) return <div style={{ padding: 16, fontSize: 13, color: T.muted }}>🔒 เครื่องมือนี้ใช้ได้เฉพาะ admin</div>;

  return (
    <div>
      <div style={{ fontSize: 15, fontWeight: 700, color: T.text, marginBottom: 4 }}>👯 หาใบสั่งของซ้ำ</div>
      <div style={{ fontSize: 12, color: T.muted, marginBottom: 14, lineHeight: 1.7 }}>
        ใบที่เกิดจากกดบันทึกซ้ำ — ใบซ้ำจะไม่มีวันถูกออกบิล เลยค้างในรายการ "ยังไม่ออกบิล" ตลอดไป
        <br/>สำรวจอย่างเดียวก่อน เลือกได้เองว่าจะเก็บใบไหน · ใบที่ออกบิลแล้วจะถูกเก็บไว้เสมอ
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
        <button onClick={scan} disabled={phase === "scanning" || phase === "deleting"}
          style={{ padding: "9px 18px", borderRadius: 9, border: "none", background: "linear-gradient(135deg,#3b5b8b,#3b5b8b)", color: "white", fontSize: 13, fontWeight: 600, cursor: (phase === "scanning" || phase === "deleting") ? "wait" : "pointer", fontFamily: "'Sarabun',sans-serif", opacity: (phase === "scanning" || phase === "deleting") ? 0.6 : 1 }}>
          {phase === "scanning" ? "⏳ กำลังสำรวจ..." : "🔍 สำรวจใบซ้ำ"}
        </button>
        <label style={{ fontSize: 12, color: T.sub, display: "flex", alignItems: "center", gap: 6 }}>
          ย้อนหลัง
          <input type="number" min="1" value={days} onChange={e => setDays(Math.max(1, Number(e.target.value) || 1))}
            style={{ width: 60, textAlign: "center", padding: "5px 6px", borderRadius: 7, border: `1px solid ${T.border}`, fontFamily: "monospace", fontSize: 12 }}/>
          วัน
        </label>
      </div>

      {step && <div style={{ fontSize: 12, color: T.accent, marginBottom: 12 }}>{step}</div>}
      {err && <div style={{ padding: 10, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, fontSize: 12, color: T.red, marginBottom: 12 }}>
        สำรวจไม่สำเร็จ: {err}<br/><span style={{ fontSize: 11 }}>ยังไม่ได้ลบอะไรทั้งนั้น</span>
      </div>}
      {doneMsg && <div style={{ padding: 10, background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.25)", borderRadius: 8, fontSize: 12, color: T.green, marginBottom: 12 }}>✅ {doneMsg}</div>}

      {groups && (groups.found.length === 0 ? (
        <div style={{ padding: 24, textAlign: "center", color: T.muted, fontSize: 13, background: T.card, border: `1px solid ${T.border}`, borderRadius: 10 }}>
          ✅ ไม่พบใบซ้ำ — ตรวจใบสั่งของ {groups.scanned.toLocaleString("th-TH")} ใบ ย้อนหลัง {days} วัน
        </div>
      ) : (
        <>
          <div style={{ padding: "10px 14px", background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.3)", borderRadius: 10, marginBottom: 12, fontSize: 12, color: "#92400e" }}>
            พบ <b>{groups.found.length}</b> กลุ่มที่ซ้ำ จากใบสั่งของ {groups.scanned.toLocaleString("th-TH")} ใบ
            {" · "}จะลบ <b>{toDelete.length}</b> ใบ (เก็บใบละ 1 ใบต่อกลุ่ม)
          </div>

          {groups.found.map(g => (
            <div key={g.key} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: 10, marginBottom: 8 }}>
              <div style={{ fontSize: 11, color: T.muted, marginBottom: 6 }}>
                <span style={{ padding: "1px 7px", borderRadius: 6, background: g.kind === "เลขที่ซ้ำ" ? "rgba(239,68,68,0.1)" : "rgba(245,158,11,0.1)", color: g.kind === "เลขที่ซ้ำ" ? "#b91c1c" : "#b45309", fontWeight: 700 }}>{g.kind}</span>
                {" "}{g.label} · {g.list.length} ใบ
              </div>
              {g.list.map(o => {
                const keeping = keep[g.key] === o.id;
                const locked = !!o.invoiceId;
                return (
                  <div key={o.id} onClick={() => !locked && setKeep(k => ({ ...k, [g.key]: o.id }))}
                    style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 9px", borderRadius: 8, marginBottom: 4, cursor: locked ? "default" : "pointer",
                      border: keeping ? `2px solid ${T.green}` : `1px solid ${T.border}`,
                      background: keeping ? "rgba(16,185,129,0.06)" : "rgba(239,68,68,0.04)" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, minWidth: 62, color: keeping ? T.green : "#b91c1c" }}>
                      {keeping ? "✅ เก็บ" : "🗑️ ลบ"}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, color: T.text, fontWeight: 600 }}>
                        {o.orderNo || "(ไม่มีเลขที่)"} · {o.customerName}
                      </div>
                      <div style={{ fontSize: 10, color: T.muted }}>
                        {fmtTime(tsOf(o))} · {(o.items || []).length} รายการ · {qtyOf(o)} ชิ้น · โดย {o.by || "-"}
                        {(o.deferStockCut || o.hasPendingMix) ? " · ไม่ตัดสต๊อก" : " · ตัดสต๊อกแล้ว"}
                      </div>
                    </div>
                    {locked && (
                      <div title="ออกบิลไปแล้ว — ลบไม่ได้ ไม่งั้นบิลจะชี้ไปหาใบที่หายไป"
                        style={{ fontSize: 10, padding: "2px 8px", borderRadius: 7, background: "rgba(59,91,139,0.1)", color: T.accent, fontWeight: 700, whiteSpace: "nowrap" }}>
                        🔒 บิล {o.invoiceNo || "แล้ว"}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}

          <button onClick={runDelete} disabled={phase === "deleting" || toDelete.length === 0}
            style={{ marginTop: 4, padding: "9px 18px", borderRadius: 9, border: "none", background: "#dc2626", color: "white", fontSize: 13, fontWeight: 600, cursor: phase === "deleting" ? "wait" : "pointer", fontFamily: "'Sarabun',sans-serif", opacity: (phase === "deleting" || toDelete.length === 0) ? 0.5 : 1 }}>
            {phase === "deleting" ? "⏳ กำลังลบ..." : `🗑️ ลบใบซ้ำ ${toDelete.length} ใบ (คืนสต๊อกให้อัตโนมัติ)`}
          </button>
        </>
      ))}
    </div>
  );
}
