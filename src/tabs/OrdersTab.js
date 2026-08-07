import React, { useEffect } from "react";
import LoadRangeBar from "../components/LoadRangeBar";

// 📜 วาดทีละกี่ใบ — ที่ 200-400 ใบ/วัน การวาดทุกใบพร้อมกันทำให้หน้าค้าง
const PAGE_SIZE = 60;

const T = {
  card:"#ffffff", border:"#e3e8ef", text:"#1f2a44", sub:"#5b6b85", muted:"#8a9bb3",
  accent:"#3b5b8b", input:"#f6f8fb", inputBorder:"#d8dee9", red:"#dc2626", amber:"#d97706",
};

const THAI_MONTHS = ["","ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];

const parseThaiDate = (s) => {
  if (!s) return null;
  const [d, m, y] = String(s).slice(0, 10).split("/");
  if (!d || !m || !y) return null;
  return new Date(`${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`);
};

const norm = (s) => String(s || "").normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();

// Date → "21/07/2026" (สำหรับบอกช่วงที่กำลังโหลด)
const fmtDMY = (d) => d instanceof Date && !isNaN(d)
  ? `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`
  : "—";

// ตรวจว่าใบสั่งนี้ออกบิลแล้วหรือยัง — ดูจากลิงก์จริงเท่านั้น
// ⚠️ เดิม fallback ด้วย "ชื่อลูกค้า + วันที่ตรงกัน" → ผิดหนัก
//    ลูกค้าคนเดียวสั่ง 5 ใบในวันเดียว ออกบิลใบเดียว → อีก 4 ใบขึ้น "ออกบิลแล้ว" ด้วย
//    ตอนนี้ทุกบิลที่ออกจากใบสั่งของจะมี mergedFromOrderIds เสมอ จึงไม่ต้องเดาแล้ว
// ⚡ สร้าง Set ครั้งเดียวแล้วเช็คแบบ O(1)
//    เดิมวนหาในบิลทุกใบ ต่อใบสั่งทุกใบ = O(ใบสั่ง × บิล)
//    ที่ 300 ใบ/วัน × บิล 1,000 ใบ = สแกน 2 ล้านครั้งทุกครั้งที่ re-render → หน้าค้าง
const invoicedOrderIds = (invoices) => {
  const s = new Set();
  invoices.forEach(inv => (inv.mergedFromOrderIds || []).forEach(id => s.add(id)));
  return s;
};

export default function OrdersTab({
  orders, invoices, role,
  ordersRange, setOrdersRange, ordersCapped,
  orderSearch, setOrderSearch,
  orderDateFrom, setOrderDateFrom,
  orderDateTo, setOrderDateTo,
  collapsedOrderDates, setCollapsedOrderDates,
  collapsedOrderMonths, setCollapsedOrderMonths,
  selectedOrders, setSelectedOrders,
  toggleOrderSelect, handleMergeOrdersToInvoice,
  setOrderForm, setShowNewOrder,
  setShowPrintOrder,
  openFillOrderMix, handleCutStockNow, handleDeleteOrder,
  openEditOrder,
}) {
  const invoicedIds = React.useMemo(() => invoicedOrderIds(invoices), [invoices]);
  const allFilteredOrders = orders.filter(o => {
    if (orderSearch) {
      const q = norm(orderSearch);
      const hit = norm(o.orderNo).includes(q)
        || norm(o.customerName).includes(q)
        || norm(o.customerPhone).includes(q)
        || norm(o.customerAddress).includes(q)
        || norm(o.customerTaxId).includes(q)
        || norm(o.note).includes(q)
        || (o.items || []).some(it => norm(it.clothingName).includes(q) || norm(it.colorName).includes(q) || norm(it.description).includes(q));
      if (!hit) return false;
    }
    const od = parseThaiDate(o.date);
    if (orderDateFrom) { const f = new Date(orderDateFrom); if (!od || od < f) return false; }
    if (orderDateTo)   { const t = new Date(orderDateTo); t.setHours(23, 59, 59); if (!od || od > t) return false; }
    return true;
  });

  // 📜 ยอดรวม/สถิติ นับจาก "ทุกใบที่ตรงเงื่อนไข" — ไม่ใช่แค่ที่วาดอยู่
  const totalQtyAll = allFilteredOrders.reduce((s, o) => s + (o.items || []).reduce((a, i) => a + (Number(i.qty) || 0), 0), 0);
  const isInvoiced = (o) => !!o.invoiceId || invoicedIds.has(o.id);
  const notInvoiced = allFilteredOrders.filter(o => !isInvoiced(o)).length;

  // 📜 วาดทีละหน้า — กดโหลดเพิ่มถ้าอยากเห็นมากกว่านี้
  const [shown, setShown] = React.useState(PAGE_SIZE);
  const filterKey = `${orderSearch}|${orderDateFrom}|${orderDateTo}|${orders.length}`;
  useEffect(() => { setShown(PAGE_SIZE); }, [filterKey]);
  const filteredOrders = allFilteredOrders.slice(0, shown);
  const hasMore = allFilteredOrders.length > filteredOrders.length;

  const setPreset = (preset) => {
    const today = new Date(); const y = today.getFullYear(); const m = today.getMonth();
    const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const back = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d; };
    if (preset === "today") { setOrderDateFrom(fmt(today)); setOrderDateTo(fmt(today)); }
    else if (preset === "7d")  { setOrderDateFrom(fmt(back(7)));  setOrderDateTo(""); }
    else if (preset === "30d") { setOrderDateFrom(fmt(back(30))); setOrderDateTo(""); }
    else if (preset === "month") { setOrderDateFrom(fmt(new Date(y, m, 1))); setOrderDateTo(fmt(new Date(y, m + 1, 0))); }
    else if (preset === "lastmonth") { setOrderDateFrom(fmt(new Date(y, m - 1, 1))); setOrderDateTo(fmt(new Date(y, m, 0))); }
  };
  // ⚠️ ไม่มี "ทั้งหมด" แล้ว — ที่ 200-300 ใบ/วัน การโหลดทุกใบทำให้แอปค้าง
  //    อยากดูเก่ากว่านี้ให้เลือกช่วงวันที่เอง (ระบบจะไปดึงจากฐานข้อมูลให้จริง)
  const presets = [
    { k: "today", l: "วันนี้" }, { k: "7d", l: "7 วัน" }, { k: "30d", l: "30 วัน" },
    { k: "month", l: "เดือนนี้" }, { k: "lastmonth", l: "เดือนที่แล้ว" },
  ];

  // 📡 ช่วงวันที่ที่เลือก → ไปดึงจาก Firestore จริง (ไม่ใช่กรองเฉพาะที่โหลดมาแล้ว)
  useEffect(() => {
    if (!setOrdersRange) return;
    const from = orderDateFrom ? new Date(`${orderDateFrom}T00:00:00`) : null;
    const to = orderDateTo ? new Date(`${orderDateTo}T23:59:59`) : null;
    if (!from && !to) return; // ยังไม่เลือก → คงค่าเริ่มต้น (7 วัน)
    const fallback = new Date(); fallback.setDate(fallback.getDate() - 7); fallback.setHours(0,0,0,0);
    setOrdersRange({ from: from || fallback, to });
  }, [orderDateFrom, orderDateTo, setOrdersRange]);

  // group ตามวันที่
  const groups = filteredOrders.reduce((acc, o) => {
    const d = (o.date || "").slice(0, 10) || "ไม่ระบุวันที่";
    if (!acc[d]) acc[d] = [];
    acc[d].push(o);
    return acc;
  }, {});
  const sortedDates = Object.keys(groups).sort((a, b) => {
    const p = (s) => { const [d, m, y] = s.split("/"); return `${y}${m}${d}`; };
    return p(b).localeCompare(p(a));
  });
  // group by month
  const monthGroups = {};
  sortedDates.forEach(d => {
    const parts = d.split("/");
    const mk = parts.length >= 3 ? `${parts[1]}/${parts[2]}` : d;
    if (!monthGroups[mk]) monthGroups[mk] = [];
    monthGroups[mk].push(d);
  });
  const sortedMonths = Object.keys(monthGroups).sort((a, b) => {
    const p = (s) => { const [m, y] = s.split("/"); return `${y}${m}`; };
    return p(b).localeCompare(p(a));
  });

  return (
    <div style={{ animation: "fadeUp 0.4s ease" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
        <div style={{ fontSize: 12, color: T.sub }}>ใบสั่งของทั้งหมด <b style={{ color: T.accent }}>{orders.length} ใบ</b></div>
        {role.canCreateOrder
          ? <button onClick={() => { setOrderForm({ customerId: "", customerName: "", customerPhone: "", customerAddress: "", shipping: "", note: "", items: [], deferStockCut: false }); setShowNewOrder(true); }} style={{ padding: "8px 18px", borderRadius: 9, border: "none", cursor: "pointer", background: "linear-gradient(135deg,#3b5b8b,#3b5b8b)", color: "white", fontSize: 12, fontWeight: 600, fontFamily: "'Sarabun',sans-serif", boxShadow: "0 4px 14px rgba(59,91,139,0.3)" }}>️ สร้างใบสั่งของ</button>
          : <span style={{ fontSize: 11, color: T.muted, padding: "6px 12px", background: "rgba(241,243,246,0.4)", border: `1px solid ${T.border}`, borderRadius: 8 }}>👁️ โหมดดูเท่านั้น</span>}
      </div>

      {/* 🔗 แถบรวมใบสั่งของ → ออกบิลรวม */}
      {selectedOrders.size > 0 && (() => {
        const sel = orders.filter(o => selectedOrders.has(o.id));
        const cname = sel[0]?.customerName;
        const sameCustomer = sel.every(o => o.customerName === cname);
        const totalQty = sel.reduce((s, o) => s + (o.items || []).reduce((a, i) => a + (Number(i.qty) || 0), 0), 0);
        return (
          <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", zIndex: 200, display: "flex", alignItems: "center", gap: 14, background: T.card, border: `1px solid ${T.accent}`, borderRadius: 14, padding: "12px 18px", boxShadow: "0 10px 40px rgba(0,0,0,0.25)" }}>
            <div style={{ fontSize: 13, color: T.text }}>
              เลือก <b style={{ color: T.accent }}>{sel.length}</b> ใบสั่ง · รวม <b>{totalQty.toLocaleString("th-TH")}</b> ชิ้น
              {sameCustomer ? <> · <b>{cname}</b></> : <span style={{ color: T.red, marginLeft: 6 }}>⚠️ คนละลูกค้า</span>}
            </div>
            <button onClick={handleMergeOrdersToInvoice} disabled={sel.length < 1}
              style={{ padding: "8px 16px", borderRadius: 9, border: "none", cursor: sel.length < 1 ? "not-allowed" : "pointer", background: sel.length < 1 ? "rgba(59,91,139,0.3)" : T.accent, color: "white", fontSize: 13, fontWeight: 700, fontFamily: "'Sarabun',sans-serif" }}>🧾 ออกบิลรวม {sel.length > 1 ? `(${sel.length} ใบ)` : ""}</button>
            <button onClick={() => setSelectedOrders(new Set())} style={{ padding: "8px 12px", borderRadius: 9, border: `1px solid ${T.border}`, background: "transparent", color: T.sub, cursor: "pointer", fontSize: 12, fontFamily: "'Sarabun',sans-serif" }}>ยกเลิก</button>
          </div>
        );
      })()}

      {/* 📅 บอกให้ชัดว่ากำลังดูช่วงไหน — กันเข้าใจผิดว่า "ไม่มีข้อมูล" ทั้งที่แค่ไม่ได้โหลดมา */}
      <LoadRangeBar label="กำลังดูใบสั่งของ" range={ordersRange} capped={ordersCapped} count={orders.length}
        setRange={(r) => { setOrderDateFrom(""); setOrderDateTo(""); setOrdersRange(r); }} />

      {/* ── FILTER BAR ── (อยู่นอกเงื่อนไขเสมอ — ช่วงไหนไม่มีใบก็ยังเปลี่ยนวันที่ได้) */}
          <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, padding: 14, marginBottom: 14 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
              <div style={{ flex: "1 1 240px", position: "relative" }}>
                <input value={orderSearch} onChange={e => setOrderSearch(e.target.value)} placeholder="🔍 ค้นหา — เลขที่ใบ / ชื่อลูกค้า / เบอร์ / ที่อยู่ / เลขภาษี / รายการสินค้า"
                  style={{ width: "100%", boxSizing: "border-box", background: T.input, border: `1px solid ${orderSearch ? T.accent : T.inputBorder}`, color: T.text, borderRadius: 9, padding: "8px 36px 8px 12px", fontFamily: "'Sarabun',sans-serif", fontSize: 13, outline: "none" }} />
                {orderSearch && <button onClick={() => setOrderSearch("")} title="ล้าง" style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", padding: "2px 8px", borderRadius: 6, border: "none", background: "rgba(59,91,139,0.1)", color: T.sub, cursor: "pointer", fontSize: 11, fontFamily: "inherit" }}>✕</button>}
              </div>
              <input type="date" value={orderDateFrom} onChange={e => setOrderDateFrom(e.target.value)}
                style={{ background: T.input, border: `1px solid ${T.inputBorder}`, color: T.text, borderRadius: 9, padding: "8px 10px", fontSize: 12, fontFamily: "'Sarabun',sans-serif" }} />
              <span style={{ alignSelf: "center", color: T.muted, fontSize: 12 }}>ถึง</span>
              <input type="date" value={orderDateTo} onChange={e => setOrderDateTo(e.target.value)}
                style={{ background: T.input, border: `1px solid ${T.inputBorder}`, color: T.text, borderRadius: 9, padding: "8px 10px", fontSize: 12, fontFamily: "'Sarabun',sans-serif" }} />
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              {presets.map(p => (
                <button key={p.k} onClick={() => setPreset(p.k)}
                  style={{ padding: "5px 12px", borderRadius: 14, border: `1px solid ${T.border}`, background: "transparent", color: T.sub, cursor: "pointer", fontSize: 11, fontFamily: "'Sarabun',sans-serif" }}>{p.l}</button>
              ))}
              <div style={{ flex: 1 }} />
              <div style={{ fontSize: 11, color: T.muted }}>
                พบ <b style={{ color: T.accent }}>{allFilteredOrders.length}</b> / {orders.length} ใบ
                {hasMore && <span style={{ color: T.amber }}> (แสดง {filteredOrders.length})</span>}
                {notInvoiced > 0 && <><span style={{ margin: "0 6px", color: T.border }}>·</span>⏳ ยังไม่ออกบิล <b style={{ color: "#dc2626" }}>{notInvoiced}</b> ใบ</>}
                <span style={{ margin: "0 6px", color: T.border }}>·</span>
                รวม <b style={{ color: "#16a34a" }}>{totalQtyAll.toLocaleString("th-TH")}</b> ชิ้น
              </div>
            </div>
          </div>

          {filteredOrders.length === 0 ? (
            <div style={{ textAlign: "center", padding: 40, background: T.card, borderRadius: 14, border: `1px solid ${T.border}` }}>
              <div style={{ fontSize: 36, marginBottom: 8, opacity: 0.3 }}>🔍</div>
              <div style={{ fontSize: 13, color: T.muted }}>ไม่พบใบสั่งของตามที่ค้นหา</div>
              {/* ⚠️ สำคัญ: ค้นเฉพาะช่วงที่โหลดมา — ถ้าไม่บอก ผู้ใช้จะนึกว่าใบนั้นไม่มีอยู่จริง */}
              {orderSearch && ordersRange && (
                <div style={{ marginTop: 10, fontSize: 12, color: "#b45309", lineHeight: 1.7 }}>
                  ค้นเฉพาะช่วง <b>{fmtDMY(ordersRange.from)} – {ordersRange.to ? fmtDMY(ordersRange.to) : "วันนี้"}</b> เท่านั้น<br/>
                  ถ้าใบที่หาเก่ากว่านี้ — กด <b>🔎 ค้นหาทั้งระบบ</b> ด้านบน (หรือ <b>Ctrl+K</b>) จะค้นทุกใบไม่จำกัดวันที่<br/>
                  หรือขยายช่วงวันที่แล้วค้นใหม่
                  <div style={{ marginTop: 8, display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap" }}>
                    <button onClick={() => setPreset("30d")}
                      style={{ padding: "5px 14px", borderRadius: 8, border: `1px solid ${T.accent}`, background: "rgba(59,91,139,0.08)", color: T.accent, cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: "inherit" }}>🔎 ค้นย้อนหลัง 30 วัน</button>
                    <button onClick={() => setPreset("lastmonth")}
                      style={{ padding: "5px 14px", borderRadius: 8, border: `1px solid ${T.border}`, background: "white", color: T.sub, cursor: "pointer", fontSize: 12, fontFamily: "inherit" }}>เดือนที่แล้ว</button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {sortedMonths.map(mk => {
                const daysInMonth = monthGroups[mk];
                const monthOrders = daysInMonth.flatMap(d => groups[d]);
                const monthTotalQty = monthOrders.reduce((s, o) => s + (o.items || []).reduce((a, i) => a + (Number(i.qty) || 0), 0), 0);
                const monthCollapsed = collapsedOrderMonths[mk];
                const [mm, yyyy] = mk.split("/");
                const monthLabel = `${THAI_MONTHS[Number(mm)] || mm} ${yyyy}`;
                return (
                  <div key={mk}>
                    <div onClick={() => setCollapsedOrderMonths(p => ({ ...p, [mk]: !p[mk] }))} style={{ padding: "8px 14px", background: "linear-gradient(90deg,#3b5b8b,#5b7ba8)", borderRadius: 10, display: "flex", alignItems: "center", gap: 10, cursor: "pointer", userSelect: "none", marginBottom: monthCollapsed ? 0 : 10 }}>
                      <div style={{ width: 20, height: 20, color: "white", fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center", transition: "transform 0.2s", transform: monthCollapsed ? "rotate(-90deg)" : "rotate(0deg)" }}>▼</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: "white", letterSpacing: 0.3 }}>📅 {monthLabel}</div>
                      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.85)" }}>{monthOrders.length} ใบ · {monthTotalQty.toLocaleString("th-TH")} ชิ้น · {daysInMonth.length} วัน</div>
                    </div>
                    {!monthCollapsed && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginLeft: 8 }}>
                        {daysInMonth.map(date => {
                          const list = groups[date];
                          const totalQty = list.reduce((s, o) => s + (o.items || []).reduce((a, i) => a + i.qty, 0), 0);
                          const collapsed = collapsedOrderDates[date];
                          return (
                            <div key={date} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 16, overflow: "hidden" }}>
                              <div onClick={() => setCollapsedOrderDates(p => ({ ...p, [date]: !p[date] }))} style={{ padding: "10px 20px", background: "linear-gradient(90deg,rgba(59,91,139,0.12),transparent)", borderBottom: collapsed ? "none" : `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 12, cursor: "pointer", userSelect: "none" }}
                                onMouseEnter={e => e.currentTarget.style.background = "linear-gradient(90deg,rgba(59,91,139,0.2),transparent)"}
                                onMouseLeave={e => e.currentTarget.style.background = "linear-gradient(90deg,rgba(59,91,139,0.12),transparent)"}>
                                <div style={{ width: 22, height: 22, borderRadius: 6, background: "rgba(59,91,139,0.15)", border: "1px solid rgba(59,91,139,0.25)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: T.accent, transition: "transform 0.2s", transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)" }}>▼</div>
                                <div style={{ fontSize: 13, fontWeight: 700, color: T.accent }}>📅 {date}</div>
                                <div style={{ fontSize: 11, color: T.muted }}>{list.length} ใบ · {totalQty} ชิ้น</div>
                              </div>
                              {!collapsed && <>
                                <div style={{ display: "grid", gridTemplateColumns: "88px 1fr 90px 52px 240px 190px", alignItems: "center", padding: "8px 20px", background: "rgba(241,243,246,0.5)", borderBottom: `1px solid ${T.border}`, color: T.muted, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                                  <div>เลขที่</div><div>ลูกค้า</div><div>รายการ</div><div>โดย</div><div>สถานะ</div><div style={{ textAlign: "center" }}>จัดการ</div>
                                </div>
                                {list.map((o, i) => {
                                  const invoiced = isInvoiced(o);
                                  return (
                                    <div key={o.id} onClick={() => setShowPrintOrder(o)} title="คลิกเพื่อดูใบสั่งของ"
                                      style={{ display: "grid", gridTemplateColumns: "88px 1fr 90px 52px 240px 190px", alignItems: "center", padding: "13px 20px", borderBottom: i < list.length - 1 ? `1px solid ${T.border}` : "none", cursor: "pointer", background: selectedOrders.has(o.id) ? "rgba(59,91,139,0.08)" : "transparent" }}
                                      onMouseEnter={e => { if (!selectedOrders.has(o.id)) e.currentTarget.style.background = "rgba(59,91,139,0.05)"; }}
                                      onMouseLeave={e => { if (!selectedOrders.has(o.id)) e.currentTarget.style.background = "transparent"; }}>
                                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                        {role.canCreateOrder && <input type="checkbox" checked={selectedOrders.has(o.id)} onClick={e => e.stopPropagation()} onChange={() => toggleOrderSelect(o.id)} title="เลือกเพื่อออกบิลรวม" style={{ width: 15, height: 15, cursor: "pointer", accentColor: T.accent }} />}
                                        <span style={{ fontFamily: "monospace", fontSize: 11, color: T.accent, fontWeight: 700 }}>{o.orderNo}</span>
                                      </div>
                                      <div>
                                        <div style={{ fontWeight: 600, color: T.text, fontSize: 13 }}>{o.customerName}</div>
                                        <div style={{ fontSize: 10, color: T.muted, marginTop: 1 }}>{o.customerPhone} · {o.date}</div>
                                      </div>
                                      <div style={{ fontSize: 12, color: T.sub }}>{(o.items || []).length} รายการ · {(o.items || []).reduce((s, i) => s + i.qty, 0)} ชิ้น</div>
                                      <div style={{ fontSize: 11, color: T.sub }}>{o.by}</div>
                                      <div style={{ display: "flex", flexDirection: "row", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
                                        {o.hasPendingMix
                                          ? <span title="ยังไม่ได้ระบุสี/ไซส์ของรายการคละ — ยังไม่ตัดสต็อก" style={{ padding: "2px 7px", borderRadius: 20, fontSize: 10, fontWeight: 700, background: "rgba(184,134,0,0.15)", color: T.amber, border: "1px solid rgba(184,134,0,0.4)", whiteSpace: "nowrap" }}>🕐 รอระบุ</span>
                                          : <span style={{ padding: "2px 7px", borderRadius: 20, fontSize: 10, fontWeight: 600, background: "rgba(52,211,153,0.1)", color: "#34d399", border: "1px solid rgba(52,211,153,0.2)", whiteSpace: "nowrap" }}>{o.status}</span>}
                                        {o.deferStockCut && <span title="ขายก่อน ไม่ตัดสต๊อก" style={{ padding: "2px 8px", borderRadius: 20, fontSize: 10, fontWeight: 700, background: "rgba(124,58,237,0.12)", color: "#7c3aed", border: "1px solid rgba(124,58,237,0.35)", whiteSpace: "nowrap" }}>🔓 ไม่ตัด</span>}
                                        {invoiced
                                          ? <span title="ออกบิลแล้ว" style={{ padding: "2px 8px", borderRadius: 20, fontSize: 10, fontWeight: 600, background: "rgba(59,91,139,0.1)", color: T.accent, border: "1px solid rgba(59,91,139,0.25)", whiteSpace: "nowrap" }}>🧾 ออกบิลแล้ว</span>
                                          : <span title="ยังไม่ออกบิล" style={{ padding: "2px 8px", borderRadius: 20, fontSize: 10, fontWeight: 700, background: "rgba(220,38,38,0.08)", color: "#dc2626", border: "1px solid rgba(220,38,38,0.3)", whiteSpace: "nowrap" }}>⏳ ยังไม่ออกบิล</span>}
                                      </div>
                                      <div style={{ display: "flex", gap: 5, justifyContent: "flex-end", flexWrap: "nowrap" }} onClick={e => e.stopPropagation()}>
                                        {o.hasPendingMix && <button onClick={() => openFillOrderMix(o)} title="กรอกรายละเอียดสี/ไซส์" style={{ padding: "4px 7px", borderRadius: 7, border: "1px solid rgba(184,134,0,0.4)", background: "rgba(184,134,0,0.12)", color: T.amber, cursor: "pointer", fontSize: 10, fontWeight: 700, whiteSpace: "nowrap" }}>✏️ กรอก</button>}
                                        {o.deferStockCut && !o.hasPendingMix && <button onClick={() => handleCutStockNow(o)} title="ตัดสต๊อกใบนี้ตอนนี้เลย" style={{ padding: "4px 7px", borderRadius: 7, border: "1px solid rgba(124,58,237,0.4)", background: "rgba(124,58,237,0.12)", color: "#7c3aed", cursor: "pointer", fontSize: 10, fontWeight: 700, whiteSpace: "nowrap" }}>📦 ตัด</button>}
                                        <button onClick={() => setShowPrintOrder(o)} style={{ padding: "4px 7px", borderRadius: 7, border: `1px solid rgba(59,91,139,0.25)`, background: "rgba(59,91,139,0.08)", color: T.accent, cursor: "pointer", fontSize: 10, fontFamily: "'Sarabun',sans-serif", whiteSpace: "nowrap" }}>🖨️ ปริ้น</button>
                                        {role.canCreateOrder && openEditOrder && <button onClick={() => openEditOrder(o)} title="แก้ไขใบสั่งของ" style={{ padding: "4px 7px", borderRadius: 7, border: "1px solid rgba(59,91,139,0.25)", background: "rgba(59,91,139,0.08)", color: T.accent, cursor: "pointer", fontSize: 10, fontFamily: "'Sarabun',sans-serif", whiteSpace: "nowrap" }}>✏️ แก้ไข</button>}
                                        {role.canDelete && <button onClick={() => handleDeleteOrder(o)} title="ยกเลิก + คืนสต๊อก" style={{ padding: "5px 8px", borderRadius: 7, border: "1px solid rgba(248,113,113,0.25)", background: "rgba(248,113,113,0.08)", color: "#f87171", cursor: "pointer", fontSize: 11 }}>✕</button>}
                                      </div>
                                    </div>
                                  );
                                })}
                              </>}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
              {/* 📜 โหลดเพิ่ม — วาดทีละ 60 ใบ กันหน้าค้างตอนมีเป็นพันใบ */}
              {hasMore && (
                <button onClick={() => setShown(n => n + PAGE_SIZE * 3)}
                  style={{ padding: "12px 20px", borderRadius: 12, border: `1px solid ${T.accent}`, background: "rgba(59,91,139,0.06)", color: T.accent, cursor: "pointer", fontSize: 13, fontWeight: 700, fontFamily: "'Sarabun',sans-serif" }}>
                  ⬇️ โหลดเพิ่ม — เหลืออีก {(allFilteredOrders.length - filteredOrders.length).toLocaleString("th-TH")} ใบ
                </button>
              )}
            </div>
          )}
    </div>
  );
}
