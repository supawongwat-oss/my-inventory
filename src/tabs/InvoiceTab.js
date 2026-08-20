import React from "react";
import LoadRangeBar from "../components/LoadRangeBar";
import { invoiceItemsText, matchesTokens, returnSummaryOf } from "../utils/returns";

// 📜 วาดทีละกี่ใบ — กันหน้าค้างตอนมีบิลเป็นพันใบในช่วงที่เลือก
const PAGE_SIZE = 60;

const T = {
  card:"#ffffff", border:"#e3e8ef", text:"#1f2a44", sub:"#5b6b85", muted:"#8a9bb3",
  accent:"#3b5b8b", input:"#f6f8fb", inputBorder:"#d8dee9", red:"#dc2626", amber:"#d97706", green:"#16a34a",
};

const THAI_MONTHS = ["","ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];
export const PAYMENT_STATUSES = ["ออกแล้ว","รอชำระ","ชำระแล้ว","ยกเลิก"];

const paymentStatusStyle = (s) => ({
  "ออกแล้ว":  { bg:"rgba(59,91,139,0.1)",  color:T.accent, border:"1px solid rgba(59,91,139,0.2)"  },
  "รอชำระ":   { bg:"rgba(245,158,11,0.1)", color:T.amber,  border:"1px solid rgba(245,158,11,0.25)"},
  "ชำระแล้ว": { bg:"rgba(16,185,129,0.1)", color:T.green,  border:"1px solid rgba(16,185,129,0.25)"},
  "ยกเลิก":   { bg:"rgba(239,68,68,0.1)",  color:T.red,    border:"1px solid rgba(239,68,68,0.25)" },
}[s] || { bg:"rgba(59,91,139,0.1)", color:T.accent, border:"1px solid rgba(59,91,139,0.2)" });

const docTypeLabel = (type) => ({
  receipt:"ใบเสร็จรับเงิน", tax:"ใบกำกับภาษี", quotation:"ใบเสนอราคา/ใบวางบิล"
}[type] || "ใบเสร็จรับเงิน");

const getPaidTotal = (inv) => (inv?.payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
const getPaidPct = (inv) => {
  const t = Number(inv?.total) || 0;
  if (t <= 0) return 0;
  return Math.min(100, Math.round(getPaidTotal(inv) / t * 100));
};

const norm = (s) => String(s || "").normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();

export default function InvoiceTab({
  invoices, role,
  invoicesRange, setInvoicesRange, invoicesCapped,
  invoiceStatusFilter, setInvoiceStatusFilter,
  invoiceSearch, setInvoiceSearch,
  selectedInvoices, setSelectedInvoices, toggleInvoiceSelect,
  collapsedInvoiceMonths, setCollapsedInvoiceMonths,
  collapsedInvoiceDates, setCollapsedInvoiceDates,
  setInvoiceForm, setInvoiceDocType, setInvoiceVat, setShowNewInvoice,
  handleMergeInvoices,
  setShowPrintInvoice,
  openPaymentModal,
  handleUpdateInvoiceStatus,
  handleConvertQuotation,
  handleUnmergeInvoice,
  handleEditInvoice,
  handleDeleteInvoice,
  returns = [],
}) {
  // 📜 วาดทีละหน้า — รีเซ็ตเมื่อเปลี่ยนคำค้น/สถานะ/ชุดข้อมูล
  const [shown, setShown] = React.useState(PAGE_SIZE);
  React.useEffect(() => { setShown(PAGE_SIZE); }, [invoiceSearch, invoiceStatusFilter, invoices.length]);

  // ⌨️ ช่องค้นหาเก็บค่าไว้ในหน้านี้เอง แล้วค่อยส่งต่อหลังหยุดพิมพ์ 250ms
  // เดิมค่าอยู่ที่ App — พิมพ์ 1 ตัวอักษร App วาดใหม่ทั้งหน้า + กรองบิลใหม่ทั้งหมด
  const [typed, setTyped] = React.useState(invoiceSearch || "");
  React.useEffect(() => { setTyped(invoiceSearch || ""); }, [invoiceSearch]);
  React.useEffect(() => {
    if (typed === (invoiceSearch || "")) return;
    const t = setTimeout(() => setInvoiceSearch(typed), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typed]);

  // 🧮 นับจำนวนตามสถานะ — ทำครั้งเดียวต่อชุดข้อมูล
  // เดิมวนทั้งกองบิล 4 รอบ (ปุ่มละรอบ) ทุกครั้งที่ re-render
  const statusCounts = React.useMemo(() => {
    const m = {};
    invoices.forEach(x => { const s = x.status || "ออกแล้ว"; m[s] = (m[s] || 0) + 1; });
    return m;
  }, [invoices]);

  return (
    <div style={{ animation: "fadeUp 0.4s ease" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {["ทั้งหมด", "ออกแล้ว", "รอชำระ", "ชำระแล้ว", "ยกเลิก"].map(s => {
            const st = paymentStatusStyle(s); const isAll = s === "ทั้งหมด";
            return (
              <button key={s} onClick={() => setInvoiceStatusFilter(s)}
                style={{
                  padding: "5px 14px", borderRadius: 20, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "'Sarabun',sans-serif",
                  border: invoiceStatusFilter === s ? (isAll ? `1px solid ${T.accent}` : st.border) : `1px solid ${T.border}`,
                  background: invoiceStatusFilter === s ? (isAll ? "rgba(59,91,139,0.15)" : st.bg) : "transparent",
                  color: invoiceStatusFilter === s ? (isAll ? T.accent : st.color) : T.muted
                }}>
                {s}{!isAll && <span style={{ marginLeft: 4, fontSize: 10, opacity: 0.7 }}>({statusCounts[s] || 0})</span>}
              </button>
            );
          })}
        </div>
        {role.canIssueInvoice
          ? <button onClick={() => { setInvoiceForm({ customerId: "", customerName: "", customerPhone: "", customerAddress: "", customerTaxId: "", items: [], note: "", dueDate: "", vatRate: 7, discount: 0, discountType: "amount", useShipping: false, shippingFee: 0 }); setInvoiceDocType("receipt"); setInvoiceVat(false); setShowNewInvoice(true); }}
            style={{ padding: "8px 18px", borderRadius: 9, border: "none", cursor: "pointer", background: "linear-gradient(135deg,#3b5b8b,#3b5b8b)", color: "white", fontSize: 12, fontWeight: 600, fontFamily: "'Sarabun',sans-serif", boxShadow: "0 4px 14px rgba(59,91,139,0.3)" }}>＋ ออกบิลใหม่</button>
          : <span style={{ fontSize: 11, color: T.muted, padding: "6px 12px", background: "rgba(241,243,246,0.4)", border: `1px solid ${T.border}`, borderRadius: 8 }}>👁️ โหมดดูเท่านั้น</span>}
      </div>

      {/* 📅 บอกให้ชัดว่ากำลังดูบิลช่วงไหน — บิลเก่ากว่านี้ยังอยู่ครบ แค่ยังไม่ได้โหลด */}
      {setInvoicesRange && (
        <LoadRangeBar label="กำลังดูบิล" range={invoicesRange} setRange={setInvoicesRange}
          capped={invoicesCapped} count={invoices.length} />
      )}

      {/* 🔍 ค้นหาบิล */}
      <div style={{ marginBottom: 12, position: "relative" }}>
        <input value={typed} onChange={e => setTyped(e.target.value)}
          placeholder="🔍 ค้นหาบิล — ลูกค้า / เบอร์ / เลขที่บิล / หรือชื่อรุ่น สี ไซส์ เช่น &quot;k-12 แดง 2xl&quot;"
          style={{ width: "100%", boxSizing: "border-box", background: T.input, border: `1px solid ${typed ? T.accent : T.inputBorder}`, color: T.text, borderRadius: 10, padding: "10px 40px 10px 14px", fontFamily: "'Sarabun',sans-serif", fontSize: 13, outline: "none" }} />
        {typed && <button onClick={() => { setTyped(""); setInvoiceSearch(""); }} title="ล้าง" style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", padding: "3px 9px", borderRadius: 6, border: "none", background: "rgba(59,91,139,0.1)", color: T.sub, cursor: "pointer", fontSize: 12, fontFamily: "inherit" }}>✕</button>}
      </div>

      {/* 🔗 แถบรวมบิล (ลอย) */}
      {selectedInvoices.size > 0 && (() => {
        const sel = invoices.filter(i => selectedInvoices.has(i.id));
        const cname = sel[0]?.customerName;
        const sameCustomer = sel.every(i => i.customerName === cname);
        const total = sel.reduce((s, i) => s + (i.total || 0), 0);
        return (
          <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", zIndex: 200, display: "flex", alignItems: "center", gap: 14, background: T.card, border: `1px solid ${T.amber}`, borderRadius: 14, padding: "12px 18px", boxShadow: "0 10px 40px rgba(0,0,0,0.25)" }}>
            <div style={{ fontSize: 13, color: T.text }}>
              เลือก <b style={{ color: T.amber }}>{sel.length}</b> บิล
              {sameCustomer ? <> · <b>{cname}</b> · รวม ฿{total.toLocaleString("th-TH", { minimumFractionDigits: 2 })}</> : <span style={{ color: T.red, marginLeft: 6 }}>⚠️ คนละลูกค้า</span>}
            </div>
            <button onClick={handleMergeInvoices} disabled={sel.length < 2 || !sameCustomer}
              style={{ padding: "8px 16px", borderRadius: 9, border: "none", cursor: sel.length < 2 || !sameCustomer ? "not-allowed" : "pointer", background: sel.length < 2 || !sameCustomer ? "rgba(184,134,0,0.3)" : T.amber, color: "white", fontSize: 13, fontWeight: 700, fontFamily: "'Sarabun',sans-serif" }}>🔗 รวมเป็นบิลเดียว</button>
            <button onClick={() => setSelectedInvoices(new Set())} style={{ padding: "8px 12px", borderRadius: 9, border: `1px solid ${T.border}`, background: "transparent", color: T.sub, cursor: "pointer", fontSize: 12, fontFamily: "'Sarabun',sans-serif" }}>ยกเลิก</button>
          </div>
        );
      })()}

      {invoices.length === 0 ? (
        <div style={{ textAlign: "center", padding: 60, background: T.card, borderRadius: 16, border: `1px solid ${T.border}` }}>
          <div style={{ fontSize: 48, marginBottom: 12, opacity: 0.3 }}>🧾</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: T.accent, marginBottom: 6 }}>ยังไม่มีบิล</div>
          <div style={{ fontSize: 11, color: T.muted }}>กด "＋ ออกบิลใหม่" เพื่อเริ่มต้น</div>
        </div>
      ) : (() => {
        const q = norm(invoiceSearch);
        let fInv = invoiceStatusFilter === "ทั้งหมด" ? invoices : invoices.filter(x => (x.status || "ออกแล้ว") === invoiceStatusFilter);
        if (q) fInv = fInv.filter(inv =>
          norm(inv.customerName).includes(q)
          || norm(inv.customerPhone).includes(q)
          || norm(inv.invoiceNo).includes(q)
          || norm(inv.customerTaxId).includes(q)
          || norm(inv.customerAddress).includes(q)
          || norm(inv.note).includes(q)
          // 🔎 ค้นเข้าไปในตัวสินค้าด้วย — จำเป็นตอนลูกค้าส่งของคืนมาโดยไม่มีบิล
          //    ทุกคำต้องเจอ พิมพ์ "k-12 แดง 2xl" จึงได้เฉพาะบิลที่มีครบทั้งสาม
          || matchesTokens(invoiceItemsText(inv), q)
        );
        if (fInv.length === 0) return (
          <div style={{ textAlign: "center", padding: 40, color: T.muted, fontSize: 13 }}>
            {q ? `ไม่พบบิลที่ตรงกับ "${invoiceSearch}"` : "ไม่พบบิลตามสถานะนี้"}
            {q && <div style={{ marginTop: 8, fontSize: 12, color: T.amber }}>ค้นเฉพาะบิลในช่วงที่โหลดมาเท่านั้น — ขยายช่วงวันที่ด้านบน หรือใช้ 🔎 ค้นหาทั้งระบบ</div>}
          </div>
        );

        // 📜 วาดทีละหน้า — สถิติด้านบนยังนับจากทุกใบที่ตรงเงื่อนไข
        const totalFound = fInv.length;
        const hasMore = totalFound > shown;
        fInv = fInv.slice(0, shown);

        const groups = fInv.reduce((acc, inv) => {
          const d = (inv.date || "").slice(0, 10) || "ไม่ระบุวันที่";
          if (!acc[d]) acc[d] = [];
          acc[d].push(inv);
          return acc;
        }, {});
        const sortedDates = Object.keys(groups).sort((a, b) => {
          const p = (s) => { const [d, m, y] = s.split("/"); return `${y}${m}${d}`; };
          return p(b).localeCompare(p(a));
        });
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
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {sortedMonths.map(mk => {
              const daysInMonth = monthGroups[mk];
              const monthInvs = daysInMonth.flatMap(d => groups[d]);
              const monthTotal = monthInvs.reduce((s, inv) => s + (inv.mergedInto ? 0 : (inv.total || 0)), 0);
              const monthCollapsed = collapsedInvoiceMonths[mk];
              const [mm, yyyy] = mk.split("/");
              const monthLabel = `${THAI_MONTHS[Number(mm)] || mm} ${yyyy}`;
              return (
                <div key={mk}>
                  <div onClick={() => setCollapsedInvoiceMonths(p => ({ ...p, [mk]: !p[mk] }))} style={{ padding: "8px 14px", background: "linear-gradient(90deg,#3b5b8b,#5b7ba8)", borderRadius: 10, display: "flex", alignItems: "center", gap: 10, cursor: "pointer", userSelect: "none", marginBottom: monthCollapsed ? 0 : 10 }}>
                    <div style={{ width: 20, height: 20, color: "white", fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center", transition: "transform 0.2s", transform: monthCollapsed ? "rotate(-90deg)" : "rotate(0deg)" }}>▼</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "white", letterSpacing: 0.3 }}>📅 {monthLabel}</div>
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.85)" }}>{monthInvs.length} ใบ · {daysInMonth.length} วัน</div>
                    <div style={{ marginLeft: "auto", fontSize: 12, color: "white", fontFamily: "monospace", fontWeight: 700 }}>฿{monthTotal.toLocaleString("th-TH", { minimumFractionDigits: 2 })}</div>
                  </div>
                  {!monthCollapsed && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginLeft: 8 }}>
                      {daysInMonth.map(date => {
                        const list = groups[date];
                        const totalAmount = list.reduce((s, inv) => s + (inv.mergedInto ? 0 : (inv.total || 0)), 0);
                        const collapsed = collapsedInvoiceDates[date];
                        return (
                          <div key={date} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 16, overflow: "hidden" }}>
                            <div onClick={() => setCollapsedInvoiceDates(p => ({ ...p, [date]: !p[date] }))} style={{ padding: "10px 20px", background: "linear-gradient(90deg,rgba(59,91,139,0.12),transparent)", borderBottom: collapsed ? "none" : `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 12, cursor: "pointer", userSelect: "none" }}
                              onMouseEnter={e => e.currentTarget.style.background = "linear-gradient(90deg,rgba(59,91,139,0.2),transparent)"}
                              onMouseLeave={e => e.currentTarget.style.background = "linear-gradient(90deg,rgba(59,91,139,0.12),transparent)"}>
                              <div style={{ width: 22, height: 22, borderRadius: 6, background: "rgba(59,91,139,0.15)", border: "1px solid rgba(59,91,139,0.25)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: T.accent, transition: "transform 0.2s", transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)" }}>▼</div>
                              <div style={{ fontSize: 13, fontWeight: 700, color: T.accent }}>📅 {date}</div>
                              <div style={{ fontSize: 11, color: T.muted }}>{list.length} ใบ</div>
                              <div style={{ marginLeft: "auto", fontSize: 12, color: "#34d399", fontFamily: "monospace", fontWeight: 700 }}>฿{totalAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}</div>
                            </div>
                            {!collapsed && <>
                              <div style={{ display: "grid", gridTemplateColumns: "84px 60px 1fr 108px 96px 104px 168px", alignItems: "center", padding: "8px 20px", background: "rgba(241,243,246,0.5)", borderBottom: `1px solid ${T.border}`, color: T.muted, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                                <div>เลขที่</div><div>ประเภท</div><div>ลูกค้า</div><div style={{ textAlign: "right" }}>ยอดรวม</div><div>วันที่</div><div>สถานะชำระ</div><div style={{ textAlign: "center" }}>จัดการ</div>
                              </div>
                              {list.map((inv, i) => {
                                const st = paymentStatusStyle(inv.status || "ออกแล้ว");
                                return (
                                  <div key={inv.id} onClick={() => setShowPrintInvoice(inv)} title="คลิกเพื่อดูใบบิล"
                                    style={{ display: "grid", gridTemplateColumns: "84px 60px 1fr 108px 96px 104px 168px", alignItems: "center", padding: "13px 20px", borderBottom: i < list.length - 1 ? `1px solid ${T.border}` : "none", transition: "background 0.15s", cursor: "pointer", opacity: inv.mergedInto ? 0.5 : 1, background: selectedInvoices.has(inv.id) ? "rgba(184,134,0,0.08)" : "transparent" }}
                                    onMouseEnter={e => { if (!selectedInvoices.has(inv.id)) e.currentTarget.style.background = "rgba(59,91,139,0.08)"; }}
                                    onMouseLeave={e => { if (!selectedInvoices.has(inv.id)) e.currentTarget.style.background = "transparent"; }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 6 }} onClick={e => e.stopPropagation()}>
                                      {!inv.mergedInto && !inv.convertedTo && (
                                        <input type="checkbox" checked={selectedInvoices.has(inv.id)} onChange={() => toggleInvoiceSelect(inv.id)} title="เลือกเพื่อรวมบิล" style={{ width: 15, height: 15, cursor: "pointer", accentColor: T.amber }} />
                                      )}
                                      <span style={{ fontFamily: "monospace", fontSize: 11, color: T.accent, fontWeight: 700 }}>{inv.invoiceNo}</span>
                                    </div>
                                    <div><span style={{ padding: "2px 8px", borderRadius: 12, fontSize: 10, fontWeight: 600, background: "rgba(59,91,139,0.1)", color: T.accent, border: "1px solid rgba(59,91,139,0.2)" }}>{docTypeLabel(inv.docType)?.slice(0, 4)}</span></div>
                                    <div>
                                      <div style={{ fontWeight: 600, color: T.text, fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>{inv.customerName}
                                        {inv.mergedInto && <span title={`รวมเข้า ${inv.mergedInto.invoiceNo}`} style={{ padding: "1px 6px", fontSize: 9, background: "rgba(184,134,0,0.15)", color: T.amber, borderRadius: 5, fontWeight: 700 }}>🔗 รวมแล้ว</span>}
                                        {inv.mergedFrom?.length > 0 && <span title={`รวมจาก ${inv.mergedFrom.length} บิล`} style={{ padding: "1px 6px", fontSize: 9, background: "rgba(58,122,82,0.15)", color: T.green, borderRadius: 5, fontWeight: 700 }}>🔗 บิลรวม ×{inv.mergedFrom.length}</span>}
                                      </div>
                                      <div style={{ fontSize: 10, color: T.muted }}>{inv.customerPhone}</div>
                                    </div>
                                    <div style={{ textAlign: "right", fontFamily: "monospace", fontWeight: 700, color: "#34d399", fontSize: 13 }}>
                                      ฿{(inv.total || 0).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                                      {/* ↩️ ของที่ลูกค้าคืนแล้ว — บิลต้นฉบับคงยอดเดิม โชว์ยอดสุทธิเพิ่มให้แทน */}
                                      {(() => { const rs = returnSummaryOf(returns, inv.id); if (rs.total <= 0) return null; return (
                                        <div title={`คืน ${rs.qty} ชิ้น จาก ${rs.count} ใบรับคืน`} style={{ fontSize: 9, color: "#b45309", fontWeight: 700, marginTop: 2 }}>
                                          ↩️ -฿{rs.total.toLocaleString("th-TH", { minimumFractionDigits: 2 })} · สุทธิ ฿{Math.max(0, (inv.total || 0) - rs.total).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                                        </div>
                                      ); })()}
                                      {(inv.payments || []).length > 0 && (() => { const paid = getPaidTotal(inv); const pct = getPaidPct(inv); return (
                                        <div style={{ fontSize: 9, color: pct >= 100 ? "#16a34a" : T.amber, fontWeight: 600, marginTop: 2 }}>💵 ฿{paid.toLocaleString("th-TH", { minimumFractionDigits: 2 })} ({pct}%)</div>
                                      ); })()}
                                    </div>
                                    <div style={{ fontSize: 11, color: T.muted }}>{inv.date}</div>
                                    <div onClick={e => e.stopPropagation()}>
                                      <select value={inv.status || "ออกแล้ว"} onChange={e => handleUpdateInvoiceStatus(inv.id, e.target.value)}
                                        style={{ background: st.bg, border: st.border, borderRadius: 10, padding: "4px 8px", fontSize: 10, fontWeight: 600, color: st.color, cursor: "pointer", fontFamily: "'Sarabun',sans-serif", outline: "none" }}>
                                        {PAYMENT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                                      </select>
                                    </div>
                                    <div style={{ display: "flex", gap: 4, justifyContent: "flex-end", flexWrap: "nowrap" }} onClick={e => e.stopPropagation()}>
                                      <button onClick={() => openPaymentModal(inv)} title="จัดการการชำระเงิน" style={{ padding: "4px 7px", borderRadius: 7, border: "1px solid rgba(16,185,129,0.3)", background: "rgba(16,185,129,0.08)", color: T.green, cursor: "pointer", fontSize: 11, fontFamily: "'Sarabun',sans-serif" }}>💵</button>
                                      <button onClick={() => setShowPrintInvoice(inv)} title="พิมพ์" style={{ padding: "4px 7px", borderRadius: 7, border: "1px solid rgba(59,91,139,0.25)", background: "rgba(59,91,139,0.08)", color: T.accent, cursor: "pointer", fontSize: 11, fontFamily: "'Sarabun',sans-serif" }}>🖨️</button>
                                      {role.canIssueInvoice !== false && inv.docType === "quotation" && !inv.convertedTo && (
                                        <button onClick={() => handleConvertQuotation(inv, "receipt")} title="แปลงเป็นใบเสร็จ" style={{ padding: "4px 7px", borderRadius: 7, border: "1px solid rgba(58,122,82,0.3)", background: "rgba(58,122,82,0.08)", color: T.green, cursor: "pointer", fontSize: 11, fontFamily: "'Sarabun',sans-serif" }}>🔄</button>
                                      )}
                                      {inv.convertedTo && (
                                        <span title={`แปลงเป็น ${inv.convertedTo.invoiceNo} แล้ว`} style={{ padding: "4px 6px", borderRadius: 7, background: "rgba(58,122,82,0.06)", color: T.green, fontSize: 10, fontFamily: "'Sarabun',sans-serif" }}>✓ แปลงแล้ว</span>
                                      )}
                                      {inv.mergedFrom?.length > 0 && role.canDelete && (
                                        <button onClick={() => handleUnmergeInvoice(inv)} title="ยกเลิกการรวม — คืนบิลเดิม" style={{ padding: "4px 7px", borderRadius: 7, border: "1px solid rgba(184,134,0,0.3)", background: "rgba(184,134,0,0.08)", color: T.amber, cursor: "pointer", fontSize: 11, fontFamily: "'Sarabun',sans-serif" }}>🔓</button>
                                      )}
                                      {role.canIssueInvoice !== false && <button onClick={() => handleEditInvoice(inv)} title="แก้ไข" style={{ padding: "4px 7px", borderRadius: 7, border: "1px solid rgba(184,134,0,0.3)", background: "rgba(184,134,0,0.08)", color: T.amber, cursor: "pointer", fontSize: 11, fontFamily: "'Sarabun',sans-serif" }}>✏️</button>}
                                      {role.canDelete && <button onClick={() => handleDeleteInvoice(inv)} title="ลบ" style={{ padding: "4px 6px", borderRadius: 7, border: "1px solid rgba(248,113,113,0.25)", background: "rgba(248,113,113,0.08)", color: "#f87171", cursor: "pointer", fontSize: 11 }}>✕</button>}
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
            {/* 📜 โหลดเพิ่ม — วาดทีละ 60 ใบ กันหน้าค้าง */}
            {hasMore && (
              <button onClick={() => setShown(n => n + PAGE_SIZE * 3)}
                style={{ padding: "12px 20px", borderRadius: 12, border: `1px solid ${T.accent}`, background: "rgba(59,91,139,0.06)", color: T.accent, cursor: "pointer", fontSize: 13, fontWeight: 700, fontFamily: "'Sarabun',sans-serif" }}>
                ⬇️ โหลดเพิ่ม — เหลืออีก {(totalFound - fInv.length).toLocaleString("th-TH")} ใบ
              </button>
            )}
          </div>
        );
      })()}
    </div>
  );
}
