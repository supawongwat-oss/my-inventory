// 📥 Catalog Inbox — รับ order ที่มาจาก /catalog (public)
import { useState } from "react";
import { db } from "../firebase";
import { doc, updateDoc, deleteDoc } from "firebase/firestore";
import { T } from "../theme";

// 🎨 hex → ชื่อสีไทย — fallback (sync กับใน Catalog.js)
const HEX_NAMES = { "#000000":"ดำ","#000":"ดำ","#ffffff":"ขาว","#fff":"ขาว","#ff0000":"แดง","#f00":"แดง","#dc2626":"แดง","#ef4444":"แดง","#b94a48":"แดง","#0000ff":"น้ำเงิน","#00f":"น้ำเงิน","#2563eb":"น้ำเงิน","#3b82f6":"น้ำเงิน","#3b5b8b":"น้ำเงิน","#008000":"เขียว","#22c55e":"เขียว","#16a34a":"เขียว","#3a7a52":"เขียว","#ffff00":"เหลือง","#ff0":"เหลือง","#facc15":"เหลือง","#eab308":"เหลือง","#ffa500":"ส้ม","#f97316":"ส้ม","#fb923c":"ส้ม","#800080":"ม่วง","#a855f7":"ม่วง","#7c3aed":"ม่วง","#ffc0cb":"ชมพู","#ec4899":"ชมพู","#f472b6":"ชมพู","#a52a2a":"น้ำตาล","#92400e":"น้ำตาล","#78350f":"น้ำตาล","#808080":"เทา","#6b7280":"เทา","#9ca3af":"เทา","#f5deb3":"ครีม","#fef3c7":"ครีม","#fde68a":"ครีม"};
const guessColor = (hex) => HEX_NAMES[String(hex||"").toLowerCase().trim()] || "";

const STATUS = {
  new:       { label: "ใหม่",        color: "#3b5b8b", bg: "#dbeafe" },
  contacted: { label: "ติดต่อแล้ว",  color: "#b88600", bg: "#fef3c7" },
  confirmed: { label: "ยืนยันแล้ว",  color: "#3a7a52", bg: "#dcfce7" },
  converted: { label: "แปลงเป็น Order แล้ว", color: "#7c3aed", bg: "#ede9fe" },
  cancelled: { label: "ยกเลิก",      color: "#b94a48", bg: "#fee2e2" },
};

export default function CatalogInboxTab({ catalogOrders = [], onConvert, clothingItems = [] }) {
  const [filter, setFilter] = useState("");

  const list = catalogOrders.filter(o => !filter || o.status === filter);
  const counts = catalogOrders.reduce((m, o) => { m[o.status||"new"] = (m[o.status||"new"]||0) + 1; return m; }, {});

  const setStatus = async (id, status) => {
    await updateDoc(doc(db, "catalogOrders", id), { status });
  };
  const remove = async (id) => {
    if (!window.confirm("ลบรายการนี้?")) return;
    await deleteDoc(doc(db, "catalogOrders", id));
  };

  const fmtDate = (ts) => {
    if (!ts) return "—";
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return `${d.getDate()}/${d.getMonth()+1}/${d.getFullYear()} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
  };

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: T.text }}>📥 Inbox — คำสั่งซื้อจาก Catalog</div>
        <div style={{ fontSize: 12, color: T.muted, marginTop: 4 }}>
          คำสั่งซื้อที่ลูกค้าส่งผ่านหน้า <code style={{ background: "#eef2f7", padding: "2px 6px", borderRadius: 4 }}>/catalog</code>
        </div>
      </div>

      {/* Filter chips */}
      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        <Chip active={filter===""} onClick={()=>setFilter("")} label={`ทั้งหมด (${catalogOrders.length})`} color={T.sub} />
        {Object.entries(STATUS).map(([k, s]) => (
          <Chip key={k} active={filter===k} onClick={()=>setFilter(k)} label={`${s.label} (${counts[k]||0})`} color={s.color} bg={s.bg} />
        ))}
      </div>

      {list.length === 0 ? (
        <div style={{ textAlign:"center", padding: 60, color: T.muted, background: T.card, borderRadius: 14, border: `1px solid ${T.border}` }}>
          <div style={{ fontSize: 48 }}>📭</div>
          <div style={{ marginTop: 10 }}>ยังไม่มีคำสั่งซื้อ</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {list.map(o => {
            const s = STATUS[o.status||"new"] || STATUS.new;
            return (
              <div key={o.id} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 10, flexWrap:"wrap" }}>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: T.text }}>{o.customerName} · 📞 {o.phone}</div>
                    <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>{fmtDate(o.createdAt)}</div>
                  </div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ background: s.bg, color: s.color, padding: "4px 10px", borderRadius: 12, fontSize: 11, fontWeight: 700 }}>{s.label}</span>
                    <select value={o.status||"new"} onChange={e=>setStatus(o.id, e.target.value)}
                      style={{ padding: "5px 8px", borderRadius: 6, border: `1px solid ${T.border}`, fontSize: 11, fontFamily:"inherit" }}>
                      {Object.entries(STATUS).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}
                    </select>
                    <button onClick={()=>remove(o.id)} style={{ background: "#fee2e2", border:"none", borderRadius: 6, padding: "5px 9px", color: "#991b1b", cursor: "pointer", fontSize: 12 }}>🗑</button>
                  </div>
                </div>

                {(() => {
                  // 🔄 lookup ชื่อสด จาก clothingItems (กันกรณีตอนสั่งยังไม่ได้กรอกชื่อ)
                  const liveItem = clothingItems.find(c => c.id === o.itemId);
                  const itemName = (liveItem && liveItem.name) || o.itemName || "(ไม่ระบุชื่อสินค้า)";
                  const itemMissing = !liveItem && o.itemId;
                  return (
                    <div style={{ background:"#f8fafc", borderRadius: 8, padding: 10, marginBottom: 8 }}>
                      <div style={{ fontSize: 12, color: T.sub, fontWeight: 600, marginBottom: 6, display:"flex", alignItems:"center", gap:6 }}>
                        📦 {itemName}
                        {itemMissing && <span style={{ fontSize: 10, color: "#b94a48", background: "#fee2e2", padding: "1px 6px", borderRadius: 4 }}>⚠️ สินค้าถูกลบจาก ERP</span>}
                        {!o.itemId && <span style={{ fontSize: 10, color: "#b94a48", background: "#fee2e2", padding: "1px 6px", borderRadius: 4 }}>⚠️ ไม่มี itemId</span>}
                        {o.itemId && <span style={{ fontSize: 9, color: T.muted, fontFamily: "monospace" }}>id: {String(o.itemId).slice(0,8)}…</span>}
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        {(o.lines||[]).map((ln, i) => {
                          // lookup สีสดจาก color index ใน clothing item ปัจจุบัน
                          const liveCol = (liveItem && typeof ln.colorIdx === "number") ? (liveItem.colors||[])[ln.colorIdx] : null;
                          const colorHex = (liveCol && liveCol.hex) || ln.colorHex || "#ddd";
                          const colorName = (liveCol && liveCol.name) || ln.color || guessColor(colorHex) || "(ไม่ระบุสี)";
                          return (
                            <div key={i} style={{ fontSize: 12, color: T.text, display: "flex", gap: 8, alignItems: "center" }}>
                              <span style={{ minWidth: 110, display: "flex", alignItems: "center", gap: 5 }}>
                                <span style={{ width: 12, height: 12, borderRadius: 3, background: colorHex, border: "1px solid rgba(0,0,0,.2)", display: "inline-block" }} />
                                สี: <b>{colorName}</b>
                              </span>
                              <span style={{ minWidth: 80 }}>ไซส์: <b>{ln.size}</b></span>
                              <span>จำนวน: <b style={{ color: T.blue }}>{ln.qty}</b></span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}

                {o.address && <div style={{ fontSize: 12, color: T.sub, marginBottom: 4 }}>📍 {o.address}</div>}
                {o.note && <div style={{ fontSize: 12, color: T.amber, background: "#fffbeb", padding: 6, borderRadius: 6 }}>📝 {o.note}</div>}

                <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
                  <a href={`tel:${o.phone}`} style={{ background: T.blue, color: "white", padding: "6px 12px", borderRadius: 6, textDecoration: "none", fontSize: 12, fontWeight: 600 }}>📞 โทรกลับ</a>
                  {o.status !== "converted" && onConvert && (
                    <button onClick={async () => {
                      if (!window.confirm(`สร้างคำสั่งซื้อจากรายการนี้?\n\nลูกค้า: ${o.customerName}\nรายการ: ${(o.lines||[]).length} แถว · ${(o.lines||[]).reduce((s,l)=>s+(Number(l.qty)||0),0)} ชิ้น\n\nระบบจะ:\n• เพิ่มลูกค้าใหม่ (ถ้ายังไม่มี)\n• สร้าง Order ใน tab คำสั่งซื้อ (สถานะ: รอดำเนินการ)\n• ยังไม่ตัดสต็อก — รอคุณยืนยันใน Order นั้น`)) return;
                      try { await onConvert(o); }
                      catch (e) { alert("เกิดข้อผิดพลาด: " + e.message); }
                    }} style={{ background: T.green, color: "white", border: "none", padding: "6px 12px", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                      ➡️ สร้างเป็นคำสั่งซื้อ
                    </button>
                  )}
                  {o.status === "converted" && o.convertedOrderNo && (
                    <span style={{ background: "#ede9fe", color: "#7c3aed", padding: "6px 12px", borderRadius: 6, fontSize: 12, fontWeight: 600 }}>
                      ✅ Order: {o.convertedOrderNo}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Chip({ active, onClick, label, color, bg }) {
  return (
    <button onClick={onClick}
      style={{
        padding: "6px 14px", borderRadius: 18,
        border: active ? `2px solid ${color}` : `1px solid ${T.border}`,
        background: active ? (bg || `${color}15`) : "white",
        color: active ? color : T.sub,
        fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit"
      }}>{label}</button>
  );
}
