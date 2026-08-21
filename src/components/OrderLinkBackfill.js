// 🔗 ซ่อมตราประทับ "ออกบิลแล้ว" บนใบสั่งของ
//
// ปัญหา: ใบสั่งของบางใบขึ้นว่า "ยังไม่ออกบิล" ทั้งที่ออกบิลไปแล้ว
//
// ระบบรู้ว่าใบไหนออกบิลแล้วจาก 2 ทาง:
//   1. o.invoiceId ที่ปั๊มไว้บนใบสั่งเอง — แน่นอนที่สุด ไม่ขึ้นกับว่าโหลดบิลมาแค่ไหน
//      แต่โค้ดที่ปั๊มเพิ่งมีตั้งแต่ 7 ส.ค. 2026 ใบก่อนหน้านั้นจึงไม่มีตรา
//   2. ไล่ดู mergedFromOrderIds ของบิล "ที่โหลดอยู่ในหน่วยความจำ"
//      ซึ่งเป็นแค่ช่วงวันที่ (ค่าเริ่มต้น 30 วัน) และมีเพดาน 3000 ใบ
//      พอบิลหลุดออกจากช่วง ใบสั่งก็เด้งกลับไปขึ้น "ยังไม่ออกบิล" อีก
//
// เครื่องมือนี้ย้ายข้อมูลจากทาง 2 ไปไว้ที่ทาง 1 ให้ถาวร
//
// 🔒 ไม่เดาเด็ดขาด — ปั๊มเฉพาะใบที่ "มีบิลอ้างถึงอยู่แล้วจริง ๆ" ในข้อมูล
//    ใบที่ไม่มีบิลไหนอ้างถึงเลย จะแค่แสดงให้ดู ไม่แตะ
//    เพราะแยกไม่ออกว่าเป็น "ยังไม่ได้ออกบิลจริง" หรือ "ออกบิลด้วยมือโดยไม่ได้กดดึงจากใบสั่ง"
import { useState } from "react";
import { collection, getDocs, query, where, orderBy, writeBatch, doc, serverTimestamp, Timestamp } from "firebase/firestore";
import { db } from "../firebase";
import { T } from "../theme";

const DAY = 24 * 60 * 60 * 1000;
const tsOf = (o) => (o.createdAt?.seconds ? o.createdAt.seconds * 1000 : Date.parse(o.date || "") || 0);
const qtyOf = (o) => (o.items || []).reduce((s, i) => s + (Number(i.qty) || 0), 0);
const fmtDate = (ms) => {
  if (!ms) return "-";
  const d = new Date(ms);
  return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
};

export default function OrderLinkBackfill({ user }) {
  const [phase, setPhase] = useState("idle");   // idle | scanning | done | fixing
  const [step, setStep] = useState("");
  const [err, setErr] = useState("");
  const [days, setDays] = useState(60);
  const [res, setRes] = useState(null);
  const [doneMsg, setDoneMsg] = useState("");

  if (user?.role !== "admin") return null;

  const scan = async () => {
    setPhase("scanning"); setErr(""); setRes(null); setDoneMsg("");
    try {
      const from = new Date(Date.now() - days * DAY);
      from.setHours(0, 0, 0, 0);
      const ts = Timestamp.fromDate(from);

      setStep("กำลังอ่านบิล...");
      const invSnap = await getDocs(query(collection(db, "invoices"), where("createdAt", ">=", ts), orderBy("createdAt", "desc")));
      // orderId → บิลที่อ้างถึง (ข้ามบิลที่ถูกยุบ/แปลงไปแล้ว ไม่งั้นจะปั๊มบิลที่ตายแล้วลงไป)
      const linkOf = new Map();
      invSnap.forEach(d => {
        const v = d.data();
        if (v.mergedInto || v.convertedTo) return;
        (v.mergedFromOrderIds || []).forEach(oid => {
          if (!linkOf.has(oid)) linkOf.set(oid, { id: d.id, invoiceNo: v.invoiceNo || "" });
        });
      });

      setStep("กำลังอ่านใบสั่งของ...");
      const ordSnap = await getDocs(query(collection(db, "orders"), where("createdAt", ">=", ts), orderBy("createdAt", "desc")));
      const orders = ordSnap.docs.map(d => ({ ...d.data(), id: d.id }));

      const missing = orders.filter(o => !o.invoiceId);
      const fixable = missing.filter(o => linkOf.has(o.id)).map(o => ({ ...o, __link: linkOf.get(o.id) }));
      const unlinked = missing.filter(o => !linkOf.has(o.id));

      setStep("");
      setRes({ orders: orders.length, invoices: invSnap.size, stamped: orders.length - missing.length, fixable, unlinked });
      setPhase("done");
    } catch (e) {
      setErr(e?.message || String(e));
      setStep("");
      setPhase("idle");
    }
  };

  const runFix = async () => {
    if (!res?.fixable?.length) return;
    const n = res.fixable.length;
    if (!window.confirm(`ปั๊ม "ออกบิลแล้ว" ลงใบสั่งของ ${n} ใบ?\n\nปั๊มตามบิลที่อ้างถึงใบเหล่านี้อยู่แล้วจริง ๆ ไม่ได้เดา\nไม่แตะยอดเงินและไม่แตะสต๊อก`)) return;
    setPhase("fixing");
    let ok = 0;
    try {
      for (let i = 0; i < res.fixable.length; i += 400) {
        const chunk = res.fixable.slice(i, i + 400);
        const b = writeBatch(db);
        chunk.forEach(o => b.update(doc(db, "orders", o.id), {
          invoiceId: o.__link.id,
          invoiceNo: o.__link.invoiceNo,
          invoicedAt: serverTimestamp(),
          invoiceLinkBackfilled: true,   // ทำเครื่องหมายไว้ว่ามาจากการซ่อม ไม่ใช่ตอนออกบิลจริง
        }));
        await b.commit();
        ok += chunk.length;
        setStep(`ปั๊มแล้ว ${ok} / ${n} ใบ...`);
      }
      setDoneMsg(`ซ่อมแล้ว ${ok} ใบ — ใบเหล่านี้จะไม่ขึ้นว่า "ยังไม่ออกบิล" อีก ไม่ว่าจะเลื่อนช่วงวันที่ยังไง`);
      setRes(r => ({ ...r, fixable: [] }));
    } catch (e) {
      setErr(`ซ่อมได้ ${ok} ใบแล้วเจอปัญหา: ${e?.message || e}`);
    }
    setStep("");
    setPhase("done");
  };

  const Stat = ({ label, value, color, hint }) => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, padding: "7px 0", borderBottom: `1px solid ${T.border}` }}>
      <div>
        <div style={{ fontSize: 13, color: color || T.text, fontWeight: 600 }}>{label}</div>
        {hint && <div style={{ fontSize: 10, color: T.muted, marginTop: 2 }}>{hint}</div>}
      </div>
      <div style={{ fontSize: 14, fontFamily: "monospace", fontWeight: 700, color: color || T.text, whiteSpace: "nowrap" }}>{value.toLocaleString("th-TH")} ใบ</div>
    </div>
  );

  return (
    <div style={{ marginTop: 26, paddingTop: 20, borderTop: `1px solid ${T.border}` }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: T.text, marginBottom: 4 }}>🔗 ซ่อมตรา "ออกบิลแล้ว"</div>
      <div style={{ fontSize: 12, color: T.muted, marginBottom: 14, lineHeight: 1.7 }}>
        ใบสั่งของที่ออกบิลไปแล้วแต่ยังขึ้นว่า "ยังไม่ออกบิล" — เพราะตราที่ปั๊มบนใบสั่งเพิ่งมีตั้งแต่ 7 ส.ค.
        ใบก่อนหน้านั้นต้องไปไล่ดูจากบิลที่โหลดอยู่ ซึ่งโหลดมาแค่ช่วงวันที่
        <br/>ปั๊มเฉพาะใบที่มีบิลอ้างถึงอยู่แล้วจริง ๆ · ไม่เดา · ไม่แตะยอดเงินและสต๊อก
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
        <button onClick={scan} disabled={phase === "scanning" || phase === "fixing"}
          style={{ padding: "9px 18px", borderRadius: 9, border: "none", background: "linear-gradient(135deg,#3b5b8b,#3b5b8b)", color: "white", fontSize: 13, fontWeight: 600, cursor: (phase === "scanning" || phase === "fixing") ? "wait" : "pointer", fontFamily: "'Sarabun',sans-serif", opacity: (phase === "scanning" || phase === "fixing") ? 0.6 : 1 }}>
          {phase === "scanning" ? "⏳ กำลังตรวจ..." : "🔍 ตรวจใบสั่งของ"}
        </button>
        <label style={{ fontSize: 12, color: T.sub, display: "flex", alignItems: "center", gap: 6 }}>
          ย้อนหลัง
          <input type="number" min="1" value={days} onChange={e => setDays(Math.max(1, Number(e.target.value) || 1))}
            style={{ width: 60, textAlign: "center", padding: "5px 6px", borderRadius: 7, border: `1px solid ${T.border}`, fontFamily: "monospace", fontSize: 12 }}/>
          วัน
        </label>
      </div>

      {step && <div style={{ fontSize: 12, color: T.accent, marginBottom: 12 }}>{step}</div>}
      {err && <div style={{ padding: 10, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, fontSize: 12, color: T.red, marginBottom: 12 }}>{err}</div>}
      {doneMsg && <div style={{ padding: 10, background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.25)", borderRadius: 8, fontSize: 12, color: T.green, marginBottom: 12 }}>✅ {doneMsg}</div>}

      {res && (
        <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: "4px 14px 14px" }}>
          <Stat label="✅ มีตราอยู่แล้ว" value={res.stamped} color={T.green} hint="ไม่ต้องทำอะไร"/>
          <Stat label="🔧 ซ่อมได้" value={res.fixable.length} color={T.amber} hint="มีบิลอ้างถึงอยู่แล้ว แค่ยังไม่ได้ปั๊มลงใบสั่ง"/>
          <Stat label="❓ ไม่มีบิลไหนอ้างถึงเลย" value={res.unlinked.length} color={T.sub} hint="อาจยังไม่ได้ออกบิลจริง หรือออกบิลด้วยมือโดยไม่ได้กดดึงจากใบสั่ง — ไม่แตะ"/>

          <div style={{ fontSize: 11, color: T.muted, marginTop: 10 }}>
            ตรวจใบสั่งของ {res.orders.toLocaleString("th-TH")} ใบ · บิล {res.invoices.toLocaleString("th-TH")} ใบ · ย้อนหลัง {days} วัน
          </div>

          {res.fixable.length > 0 && (
            <>
              <div style={{ marginTop: 12, maxHeight: 160, overflowY: "auto", background: "white", border: `1px solid ${T.border}`, borderRadius: 8, padding: 8 }}>
                {res.fixable.slice(0, 150).map(o => (
                  <div key={o.id} style={{ fontSize: 11, display: "flex", justifyContent: "space-between", gap: 8, padding: "2px 0", color: T.sub }}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      <b style={{ fontFamily: "monospace" }}>{o.orderNo}</b> · {o.customerName} · {fmtDate(tsOf(o))}
                    </span>
                    <span style={{ whiteSpace: "nowrap", color: T.green, fontFamily: "monospace" }}>→ {o.__link.invoiceNo}</span>
                  </div>
                ))}
                {res.fixable.length > 150 && <div style={{ fontSize: 10, color: T.muted, marginTop: 4 }}>...และอีก {res.fixable.length - 150} ใบ</div>}
              </div>
              <button onClick={runFix} disabled={phase === "fixing"}
                style={{ marginTop: 12, padding: "9px 18px", borderRadius: 9, border: "none", background: "linear-gradient(135deg,#d97706,#b45309)", color: "white", fontSize: 13, fontWeight: 600, cursor: phase === "fixing" ? "wait" : "pointer", fontFamily: "'Sarabun',sans-serif", opacity: phase === "fixing" ? 0.6 : 1 }}>
                {phase === "fixing" ? "⏳ กำลังซ่อม..." : `🔧 ปั๊มตราให้ ${res.fixable.length} ใบ`}
              </button>
            </>
          )}

          {res.unlinked.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 11, color: T.muted, marginBottom: 5 }}>
                ใบที่ไม่มีบิลไหนอ้างถึง — เช็คสัก 2-3 ใบว่าออกบิลไปจริงไหม จะได้รู้ว่าต้องทำอะไรต่อ
              </div>
              <div style={{ maxHeight: 140, overflowY: "auto", background: "white", border: `1px solid ${T.border}`, borderRadius: 8, padding: 8 }}>
                {res.unlinked.slice(0, 150).map(o => (
                  <div key={o.id} style={{ fontSize: 11, display: "flex", justifyContent: "space-between", gap: 8, padding: "2px 0", color: T.sub }}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      <b style={{ fontFamily: "monospace" }}>{o.orderNo}</b> · {o.customerName}
                    </span>
                    <span style={{ whiteSpace: "nowrap", color: T.muted }}>{qtyOf(o)} ชิ้น · {fmtDate(tsOf(o))}</span>
                  </div>
                ))}
                {res.unlinked.length > 150 && <div style={{ fontSize: 10, color: T.muted, marginTop: 4 }}>...และอีก {res.unlinked.length - 150} ใบ</div>}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
