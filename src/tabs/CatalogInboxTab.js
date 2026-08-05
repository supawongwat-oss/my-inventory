// 📥 Catalog Inbox — รับ order ที่มาจาก /catalog (public)
import { useState } from "react";
import { db } from "../firebase";
import { doc, updateDoc, deleteDoc } from "firebase/firestore";
import { T } from "../theme";
import { quoteCatalogOrder, unitPriceFor, buildQuoteMessage } from "../utils/catalogQuote";

const fmtB = (n) => Number(n || 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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

export default function CatalogInboxTab({ catalogOrders = [], onConvert, clothingItems = [], customers = [], companyInfo = {} }) {
  const [filter, setFilter] = useState("");
  const [copiedId, setCopiedId] = useState("");

  // 📋 คัดลอกข้อความแจ้งยอด → วางในไลน์ได้เลย (แทนการโทร)
  const copyQuote = async (o) => {
    const msg = buildQuoteMessage(o, clothingItems, {
      companyName: companyInfo.name || "",
      billingNote: "สิ้นเดือนจะวางบิลรวมให้นะคะ",
    });
    try {
      await navigator.clipboard.writeText(msg);
      setCopiedId(o.id);
      setTimeout(() => setCopiedId(""), 2000);
    } catch {
      window.prompt("คัดลอกข้อความนี้ไปวางในไลน์:", msg);
    }
  };
  const [convertModal, setConvertModal] = useState(null); // { order, suggestedCustomer, mode, existingId, search }

  const list = catalogOrders.filter(o => !filter || o.status === filter);
  const counts = catalogOrders.reduce((m, o) => { m[o.status||"new"] = (m[o.status||"new"]||0) + 1; return m; }, {});

  // 📦 แยก "ที่ต้องทำ" กับ "จบแล้ว" — ใบที่แปลงเป็นใบสั่งของ/ยกเลิกแล้ว ไม่ต้องมาเกะกะ
  const isDone = (o) => o.status === "converted" || o.status === "cancelled";
  const todoList = list.filter(o => !isDone(o));
  const doneList = list.filter(isDone);

  // พับ: กลุ่ม "จบแล้ว" พับไว้ตั้งแต่แรก · การ์ดที่จบแล้วก็พับ (ใบที่ยังไม่ทำ = กางไว้)
  const [doneOpen, setDoneOpen] = useState(false);
  const [expanded, setExpanded] = useState({}); // { [id]: true/false } — override ค่า default
  const isCardOpen = (o) => expanded[o.id] !== undefined ? expanded[o.id] : !isDone(o);
  const toggleCard = (o) => setExpanded(prev => ({ ...prev, [o.id]: !isCardOpen(o) }));

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
          {renderCards(todoList)}
        </div>
      )}

      {/* 📦 กลุ่มที่จบแล้ว — พับไว้ ไม่ให้เกะกะงานที่ต้องทำ */}
      {doneList.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div onClick={()=>setDoneOpen(v=>!v)}
            style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", background: "#f1f5f9", border: `1px solid ${T.border}`, borderRadius: 10, cursor: "pointer", userSelect: "none" }}>
            <span style={{ fontSize: 11, color: T.muted }}>{doneOpen ? "▼" : "▶"}</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: T.sub }}>✅ จบแล้ว</span>
            <span style={{ fontSize: 11, color: T.muted }}>— แปลงเป็นใบสั่งของ/ยกเลิกแล้ว</span>
            <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 700, color: T.sub }}>{doneList.length} ใบ</span>
          </div>
          {doneOpen && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
              {renderCards(doneList)}
            </div>
          )}
        </div>
      )}

      {/* CONVERT MODAL — เลือกการจัดการลูกค้า */}
      {convertModal && (() => {
        const co = convertModal.order;
        const totalQty = (co.lines||[]).reduce((s,l)=>s+(Number(l.qty)||0),0);
        const filteredCustomers = customers.filter(c => {
          if (!convertModal.search) return true;
          const q = convertModal.search.toLowerCase();
          return (c.name||"").toLowerCase().includes(q) || (c.phone||"").includes(q);
        }).slice(0, 30);
        return (
          <div onClick={()=>setConvertModal(null)} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.65)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 12 }}>
            <div onClick={e=>e.stopPropagation()} style={{ background: "white", borderRadius: 14, maxWidth: 520, width: "100%", maxHeight: "92vh", overflowY: "auto" }}>
              <div style={{ padding: 18, borderBottom: `1px solid ${T.border}` }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: T.text }}>➡️ สร้างเป็นคำสั่งซื้อ</div>
                <div style={{ fontSize: 11, color: T.muted, marginTop: 4 }}>{(co.lines||[]).length} รายการ · {totalQty} ชิ้น</div>
              </div>

              <div style={{ padding: 18 }}>
                <div style={{ fontSize: 12, color: T.sub, marginBottom: 4 }}>ข้อมูลที่ลูกค้ากรอก:</div>
                <div style={{ background: "#f8fafc", borderRadius: 8, padding: 10, marginBottom: 14, fontSize: 13 }}>
                  <div><b>{co.customerName}</b> · 📞 {co.phone}</div>
                  {co.address && <div style={{ color: T.sub, marginTop: 2 }}>📍 {co.address}</div>}
                </div>

                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, color: T.text }}>เลือกการจัดการลูกค้า</div>

                {/* OPTION 1 — ใช้ลูกค้าเดิม (suggested if phone matched) */}
                {convertModal.suggestedCustomer && (
                  <label style={{ display: "block", padding: 10, border: `2px solid ${convertModal.mode==="existing" && convertModal.existingId===convertModal.suggestedCustomer.id ? T.green : T.border}`, borderRadius: 10, marginBottom: 8, cursor: "pointer", background: convertModal.mode==="existing" && convertModal.existingId===convertModal.suggestedCustomer.id ? "#f0fdf4" : "white" }}>
                    <input type="radio" name="custmode" checked={convertModal.mode==="existing" && convertModal.existingId===convertModal.suggestedCustomer.id}
                      onChange={()=>setConvertModal({...convertModal, mode:"existing", existingId: convertModal.suggestedCustomer.id})}
                      style={{ marginRight: 8 }} />
                    <span style={{ fontSize: 12, color: T.green, fontWeight: 700 }}>✅ พบลูกค้าเดิม (เบอร์ตรง)</span>
                    <div style={{ marginLeft: 22, fontSize: 13, fontWeight: 700, marginTop: 2 }}>{convertModal.suggestedCustomer.name}</div>
                    <div style={{ marginLeft: 22, fontSize: 11, color: T.muted }}>📞 {convertModal.suggestedCustomer.phone}</div>
                  </label>
                )}

                {/* OPTION 2 — เพิ่มเป็นลูกค้าใหม่ */}
                <label style={{ display: "block", padding: 10, border: `2px solid ${convertModal.mode==="new" ? T.blue : T.border}`, borderRadius: 10, marginBottom: 8, cursor: "pointer", background: convertModal.mode==="new" ? "#eff6ff" : "white" }}>
                  <input type="radio" name="custmode" checked={convertModal.mode==="new"}
                    onChange={()=>setConvertModal({...convertModal, mode:"new"})}
                    style={{ marginRight: 8 }} />
                  <span style={{ fontSize: 13, fontWeight: 700, color: T.blue }}>➕ เพิ่มเป็นลูกค้าใหม่</span>
                  <div style={{ marginLeft: 22, fontSize: 11, color: T.muted, marginTop: 2 }}>เก็บข้อมูลในระบบ → ใช้ครั้งต่อไปได้</div>
                </label>

                {/* OPTION 3 — เลือกลูกค้าอื่นจากระบบ */}
                <label style={{ display: "block", padding: 10, border: `2px solid ${convertModal.mode==="pick" ? "#7c3aed" : T.border}`, borderRadius: 10, marginBottom: 8, cursor: "pointer", background: convertModal.mode==="pick" ? "#faf5ff" : "white" }}>
                  <input type="radio" name="custmode" checked={convertModal.mode==="pick"}
                    onChange={()=>setConvertModal({...convertModal, mode:"pick", existingId: ""})}
                    style={{ marginRight: 8 }} />
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#7c3aed" }}>👤 เลือกลูกค้าจากในระบบ</span>
                  {convertModal.mode==="pick" && (
                    <div style={{ marginTop: 8, marginLeft: 22 }}>
                      <input value={convertModal.search} onChange={e=>setConvertModal({...convertModal, search: e.target.value})}
                        placeholder="🔍 ค้นชื่อ หรือ เบอร์"
                        style={{ width: "100%", padding: "6px 10px", borderRadius: 6, border: `1px solid ${T.border}`, fontSize: 12, fontFamily: "inherit", marginBottom: 6, boxSizing: "border-box" }} />
                      <div style={{ maxHeight: 160, overflowY: "auto", border: `1px solid ${T.border}`, borderRadius: 6 }}>
                        {filteredCustomers.length === 0 ? (
                          <div style={{ padding: 12, textAlign: "center", color: T.muted, fontSize: 11 }}>ไม่พบลูกค้า</div>
                        ) : filteredCustomers.map(c => (
                          <div key={c.id} onClick={()=>setConvertModal({...convertModal, existingId: c.id})}
                            style={{ padding: "6px 10px", borderBottom: `1px solid ${T.border}`, cursor: "pointer", background: convertModal.existingId===c.id ? "#ede9fe" : "white", fontSize: 12 }}>
                            <b>{c.name}</b> · {c.phone}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </label>

                {/* OPTION 4 — ไม่เพิ่มลูกค้า (one-time) */}
                <label style={{ display: "block", padding: 10, border: `2px solid ${convertModal.mode==="none" ? T.amber : T.border}`, borderRadius: 10, marginBottom: 8, cursor: "pointer", background: convertModal.mode==="none" ? "#fffbeb" : "white" }}>
                  <input type="radio" name="custmode" checked={convertModal.mode==="none"}
                    onChange={()=>setConvertModal({...convertModal, mode:"none"})}
                    style={{ marginRight: 8 }} />
                  <span style={{ fontSize: 13, fontWeight: 700, color: T.amber }}>🚫 ไม่เพิ่มลูกค้า (one-time)</span>
                  <div style={{ marginLeft: 22, fontSize: 11, color: T.muted, marginTop: 2 }}>ลูกค้าครั้งเดียว ไม่บันทึกในระบบ</div>
                </label>
              </div>

              <div style={{ padding: 14, borderTop: `1px solid ${T.border}`, display: "flex", gap: 8, background: "#f8fafc", borderRadius: "0 0 14px 14px" }}>
                <button onClick={()=>setConvertModal(null)} style={{ flex: 1, background: "white", border: `1px solid ${T.border}`, padding: 12, borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}>ยกเลิก</button>
                <button onClick={async () => {
                  const choice = {
                    mode: convertModal.mode === "pick" ? "existing" : convertModal.mode,
                    existingId: convertModal.mode === "pick" ? convertModal.existingId : (convertModal.mode === "existing" ? convertModal.existingId : ""),
                  };
                  if ((choice.mode === "existing") && !choice.existingId) { alert("กรุณาเลือกลูกค้า"); return; }
                  try {
                    await onConvert(co, choice);
                    setConvertModal(null);
                  } catch (e) { alert("เกิดข้อผิดพลาด: " + e.message); }
                }} style={{ flex: 2, background: T.green, color: "white", padding: 12, border: "none", borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontWeight: 700 }}>✅ ยืนยัน สร้าง Order</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
  // ── การ์ดออเดอร์ (ใช้ทั้ง 2 กลุ่ม) ──
  function renderCards(arr) {
    return arr.map(o => {
            const s = STATUS[o.status||"new"] || STATUS.new;
            const open = isCardOpen(o);
            const q = quoteCatalogOrder(o, clothingItems);
            return (
              <div key={o.id} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 16, opacity: isDone(o) && !open ? 0.75 : 1 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: open ? 10 : 0, flexWrap:"wrap" }}>
                  <div onClick={()=>toggleCard(o)} style={{ cursor: "pointer", flex: 1, minWidth: 0, display: "flex", alignItems: "flex-start", gap: 8 }}>
                    <span style={{ fontSize: 11, color: T.muted, marginTop: 3 }}>{open ? "▼" : "▶"}</span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 700, color: T.text }}>{o.customerName} · 📞 {o.phone}</div>
                      <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>
                        {fmtDate(o.createdAt)}
                        {/* ตอนพับ — สรุปให้เห็นว่ากี่ตัว กี่บาท โดยไม่ต้องกาง */}
                        {!open && <> · <b style={{color:T.sub}}>{q.totalQty.toLocaleString("th-TH")} ตัว</b> · <b style={{color:T.green}}>฿{fmtB(q.totalAmount)}</b></>}
                        {!open && o.convertedOrderNo && <> · <b style={{color:"#7c3aed"}}>{o.convertedOrderNo}</b></>}
                      </div>
                    </div>
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

                {open && <>
                {(() => {
                  // 🛒 รองรับ 2 format:
                  //  - ใหม่: o.items = [{itemId, itemName, lines:[...]}, ...] — multi-item cart
                  //  - เก่า: o.itemId/itemName + o.lines (single item)
                  const entries = (o.items && o.items.length > 0)
                    ? o.items
                    : [{ itemId: o.itemId, itemName: o.itemName, lines: o.lines || [] }];
                  return entries.map((entry, ei) => {
                    const liveItem = clothingItems.find(c => c.id === entry.itemId);
                    const itemName = (liveItem && (liveItem.model || liveItem.name)) || entry.itemName || "(ไม่ระบุชื่อสินค้า)";
                    const itemMissing = !liveItem && entry.itemId;
                    const entryQty = (entry.lines||[]).reduce((s,l)=>s+(Number(l.qty)||0),0);
                    return (
                      <div key={ei} style={{ background:"#f8fafc", borderRadius: 8, padding: 10, marginBottom: 8 }}>
                        <div style={{ fontSize: 12, color: T.sub, fontWeight: 600, marginBottom: 6, display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
                          📦 {itemName}
                          <span style={{ fontSize: 10, color: T.blue, background: "#dbeafe", padding: "1px 6px", borderRadius: 4 }}>{entryQty} ชิ้น</span>
                          {itemMissing && <span style={{ fontSize: 10, color: "#b94a48", background: "#fee2e2", padding: "1px 6px", borderRadius: 4 }}>⚠️ สินค้าถูกลบจาก ERP</span>}
                          {!entry.itemId && <span style={{ fontSize: 10, color: "#b94a48", background: "#fee2e2", padding: "1px 6px", borderRadius: 4 }}>⚠️ ไม่มี itemId</span>}
                          {entry.itemId && <span style={{ fontSize: 9, color: T.muted, fontFamily: "monospace" }}>id: {String(entry.itemId).slice(0,8)}…</span>}
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          {(entry.lines||[]).map((ln, i) => {
                            const liveCol = (liveItem && typeof ln.colorIdx === "number") ? (liveItem.colors||[])[ln.colorIdx] : null;
                            const colorHex = (liveCol && liveCol.hex) || ln.colorHex || "#ddd";
                            // ⚠️ คลังเก็บชื่อสีที่ field "colorName" (ไม่ใช่ "name")
                            const colorName = (liveCol && (liveCol.colorName || liveCol.name)) || ln.color || guessColor(colorHex) || "(ไม่ระบุสี)";
                            return (
                              <div key={i} style={{ fontSize: 12, color: T.text, display: "flex", gap: 8, alignItems: "center" }}>
                                <span style={{ minWidth: 110, display: "flex", alignItems: "center", gap: 5 }}>
                                  <span style={{ width: 12, height: 12, borderRadius: 3, background: colorHex, border: "1px solid rgba(0,0,0,.2)", display: "inline-block" }} />
                                  สี: <b>{colorName}</b>
                                </span>
                                <span style={{ minWidth: 80 }}>ไซส์: <b>{ln.size}</b></span>
                                <span style={{ minWidth: 78 }}>จำนวน: <b style={{ color: T.blue }}>{ln.qty}</b></span>
                                {/* 💰 ราคา — ดึงจากระบบให้เลย ไม่ต้องเปิดไปดูเอง */}
                                {(() => {
                                  const unit = unitPriceFor(liveItem, ln.colorIdx, ln.size);
                                  if (unit == null) return <span style={{ fontSize: 11, color: "#b45309" }}>· ⚠️ ยังไม่ตั้งราคา</span>;
                                  return <span style={{ fontSize: 11, color: T.sub, fontFamily: "monospace" }}>· ฿{fmtB(unit)} × {ln.qty} = <b style={{ color: T.text }}>฿{fmtB(unit * (Number(ln.qty)||0))}</b></span>;
                                })()}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  });
                })()}

                {/* 💬 สรุปยอด + ปุ่มคัดลอกข้อความแจ้งลูกค้า (แทนการโทร) */}
                {(() => {
                  const q = quoteCatalogOrder(o, clothingItems);
                  return (
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "9px 12px", marginBottom: 8, borderRadius: 9,
                      background: q.unknownCount > 0 ? "rgba(217,119,6,0.08)" : "rgba(22,163,74,0.07)",
                      border: `1px solid ${q.unknownCount > 0 ? "rgba(217,119,6,0.3)" : "rgba(22,163,74,0.25)"}` }}>
                      <span style={{ fontSize: 12, color: T.sub }}>
                        รวม <b style={{ color: T.text }}>{q.totalQty.toLocaleString("th-TH")}</b> ตัว
                      </span>
                      <span style={{ fontSize: 15, fontWeight: 800, color: q.unknownCount > 0 ? "#b45309" : T.green, fontFamily: "monospace" }}>
                        ฿{fmtB(q.totalAmount)}
                      </span>
                      {q.unknownCount > 0 && (
                        <span style={{ fontSize: 11, color: "#b45309" }}>⚠️ มี {q.unknownCount} รายการยังไม่ตั้งราคา — ยอดยังไม่ครบ</span>
                      )}
                      <button onClick={() => copyQuote(o)}
                        style={{ marginLeft: "auto", background: copiedId === o.id ? T.green : "white", color: copiedId === o.id ? "white" : T.accent,
                          border: `1px solid ${copiedId === o.id ? T.green : T.accent}`, padding: "6px 14px", borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                        {copiedId === o.id ? "✅ คัดลอกแล้ว — วางในไลน์ได้เลย" : "📋 คัดลอกข้อความแจ้งยอด"}
                      </button>
                    </div>
                  );
                })()}

                {o.address && <div style={{ fontSize: 12, color: T.sub, marginBottom: 4 }}>📍 {o.address}</div>}
                {o.note && <div style={{ fontSize: 12, color: T.amber, background: "#fffbeb", padding: 6, borderRadius: 6 }}>📝 {o.note}</div>}

                <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
                  <a href={`tel:${o.phone}`} style={{ background: T.blue, color: "white", padding: "6px 12px", borderRadius: 6, textDecoration: "none", fontSize: 12, fontWeight: 600 }}>📞 โทรกลับ</a>
                  {o.status !== "converted" && onConvert && (
                    <button onClick={() => {
                      // หาลูกค้าเดิมที่เบอร์ตรงกัน (suggest)
                      const normPhone = (s) => String(s||"").replace(/\D/g, "");
                      const phoneKey = normPhone(o.phone);
                      const matched = phoneKey ? customers.find(c => normPhone(c.phone) === phoneKey) : null;
                      setConvertModal({
                        order: o,
                        suggestedCustomer: matched,
                        mode: matched ? "existing" : "new",
                        existingId: matched?.id || "",
                        search: "",
                      });
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
                </>}
              </div>
            );
    });
  }
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
