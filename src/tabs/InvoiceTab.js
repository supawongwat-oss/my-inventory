import React from "react";
import LoadRangeBar from "../components/LoadRangeBar";
import { fetchInvoicesForPeriod } from "../utils/fetchInvoices";
import { invoiceItemsText, matchesTokens, returnSummaryOf, returnsItemsText } from "../utils/returns";
import { duplicateGroups } from "../utils/dupInvoice";
import { BillingBadge } from "../components/ui";

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

// 💸 ใบที่ยัง "มีผลกับเงิน" — ยอดรวมรายวัน/รายเดือนต้องนับเฉพาะพวกนี้
//    ยกเลิกแล้ว = ไม่ได้เก็บเงิน · ถูกรวมเข้าบิลใหม่ / แปลงเป็นเอกสารอื่น = ยอดจริงอยู่ที่ใบปลายทาง
//    เกณฑ์เดียวกับตอนวางบิล (utils/statement.js) ไม่งั้นสองหน้าบอกยอดไม่ตรงกัน
//    ยังแสดงใบพวกนี้ในรายการอยู่ — ยกเลิกดีกว่าลบ เลขที่จะได้ไม่ขาดช่วง แค่ไม่เอามาบวก
const countsToTotal = (inv) => !inv.mergedInto && !inv.convertedTo && (inv.status || "") !== "ยกเลิก";
const sumInvoices = (list) => list.reduce((s, inv) => s + (countsToTotal(inv) ? (Number(inv.total) || 0) : 0), 0);

const getPaidTotal = (inv) => (inv?.payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
const getPaidPct = (inv) => {
  const t = Number(inv?.total) || 0;
  if (t <= 0) return 0;
  return Math.min(100, Math.round(getPaidTotal(inv) / t * 100));
};

const norm = (s) => String(s || "").normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();

// 📅 เดือนของบิล = เดือนตาม "วันที่บนหน้าบิล" (date) ไม่ใช่วันที่กดบันทึก (createdAt)
//    บิลลงวันที่ 31/08 ที่คีย์เข้าจริงวันที่ 5/09 ต้องอยู่เดือน ส.ค. — ใบวางบิลก็นับแบบนี้
//    ทำเลขเดือนเป็น 2 หลักเสมอ ทั้งฝั่งบิลและฝั่งที่เลือก ("8" กับ "08" ต้องเท่ากัน)
const monthKeyOf = (inv) => {
  const p = String(inv?.date || "").slice(0, 10).split("/");
  return p.length >= 3 && p[1] && p[2] ? `${String(Number(p[1])).padStart(2, "0")}/${p[2].slice(0, 4)}` : "";
};
const monthKeyLabel = (mk) => {
  const [mm, yyyy] = String(mk).split("/");
  return `${THAI_MONTHS[Number(mm)] || mm} ${yyyy}`;
};
// เดือนย้อนหลังจากเดือนนี้ — ใช้ทำปุ่มเลือกเดือน
const recentMonths = (n) => {
  const out = [];
  const d = new Date();
  d.setDate(1);
  for (let i = 0; i < n; i++) {
    out.push(`${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`);
    d.setMonth(d.getMonth() - 1);
  }
  return out;
};

export default function InvoiceTab({
  invoices, role,
  statements = [],        // ใช้บอกว่าบิลใบไหนถูกวางบิลไปแล้ว
  invoicesRange, setInvoicesRange, invoicesCapped,
  invoiceStatusFilter, setInvoiceStatusFilter,
  invoiceSearch, setInvoiceSearch,
  selectedInvoices, setSelectedInvoices, toggleInvoiceSelect,
  collapsedInvoiceMonths, setCollapsedInvoiceMonths,
  collapsedInvoiceDates, setCollapsedInvoiceDates,
  setInvoiceForm, setInvoiceDocType, setInvoiceVat, setShowNewInvoice,
  handleMergeInvoices,
  docBusy = false,        // 🔒 กำลังสร้างเอกสารอยู่ — ปิดปุ่มไว้ก่อน กันกดซ้ำได้บิลซ้ำ
  setShowPrintInvoice,
  openPaymentModal,
  handleUpdateInvoiceStatus,
  handleConvertQuotation,
  handleUnmergeInvoice,
  handleEditInvoice,
  handleDeleteInvoice, handleCancelInvoice, handleRejectCancel, user,
  handleBulkCancelInvoices, handleBulkDeleteInvoices,
  returns = [],
  customers = [],
}) {
  // 🗓️ ดูทีละเดือน
  //
  //    ดึงบิลของเดือนนั้นมาเอง (fetchInvoicesForPeriod) — ไม่ไปขยับกองที่โหลดค้าง (invoicesRange)
  //    เพราะกองนั้นไม่ได้มีไว้ให้หน้ารายการอย่างเดียว: ออกเลขบิลสำรองใช้ "เลขสูงสุด+1 จากกองนี้"
  //    ถ้าตั้งกองให้เป็นเดือนเก่า บิลวันนี้หลุดจากกอง → เลขสำรองชนกันได้ และด่านราคาเพี้ยนตาม
  //    (หลักใน CLAUDE.md: กองที่โหลดค้างมีไว้ให้งานประจำวัน ที่เหลือไปขอเอง)
  const [pickMonth, setPickMonth] = React.useState("");            // "08/2026" · "" = ดูตามช่วงวันที่ปกติ
  const [monthData, setMonthData] = React.useState(null);          // { invoices, at, capped }
  const [monthLoading, setMonthLoading] = React.useState(false);
  const [monthErr, setMonthErr] = React.useState("");
  const monthReq = React.useRef(0);   // กันผลของเดือนที่กดก่อนหน้า (ดึงช้า) มาทับเดือนที่เพิ่งกด

  const loadMonth = React.useCallback(async (mk) => {
    const id = ++monthReq.current;
    setMonthErr("");
    if (!mk) { setMonthData(null); setMonthLoading(false); return; }
    setMonthLoading(true);
    const [mm, yyyy] = mk.split("/").map(Number);
    try {
      // ส่งขอบเดือนจริง — ตัวดึงเผื่อหัวท้าย 30 วันตาม createdAt ให้เอง แล้วเรากรองด้วย date อีกชั้น
      const r = await fetchInvoicesForPeriod(new Date(yyyy, mm - 1, 1), new Date(yyyy, mm, 0));
      if (id !== monthReq.current) return;
      setMonthData({ invoices: r.invoices, at: r.at, capped: r.capped });
    } catch (e) {
      if (id !== monthReq.current) return;
      setMonthErr(e?.message || String(e));
      setMonthData(null);
    } finally {
      if (id === monthReq.current) setMonthLoading(false);
    }
  }, []);
  const choosePickMonth = (mk) => { setPickMonth(mk); loadMonth(mk); };

  // 📋 ชุดบิลที่หน้าจอนี้ใช้ทั้งหมด — รายการ ตัวนับสถานะ และปุ่มทำหลายใบ ต้องมาจากชุดเดียวกัน
  //    (ถ้าปุ่ม "เลือก → ยกเลิก" ไปหาจากกองที่โหลดค้าง บิลที่มีแค่ในเดือนที่ดึงมาจะถูกข้ามเงียบ ๆ)
  //    ตัวที่ดึงมาเป็นภาพนิ่ง — ถ้าบิลใบเดียวกันอยู่ในกองสดด้วย ให้กองสดชนะ
  //    กดชำระ/ยกเลิกแล้วสถานะขยับทันที และบิลที่เพิ่งออกวันนี้โผล่ในเดือนนี้เองโดยไม่ต้องดึงใหม่
  const src = React.useMemo(() => {
    if (!pickMonth) return invoices;
    const byId = new Map();
    (monthData?.invoices || []).forEach(i => byId.set(i.id, i));
    invoices.forEach(i => byId.set(i.id, i));
    return [...byId.values()].filter(i => monthKeyOf(i) === pickMonth);
  }, [pickMonth, monthData, invoices]);

  // 📜 วาดทีละหน้า — รีเซ็ตเมื่อเปลี่ยนคำค้น/สถานะ/ชุดข้อมูล
  const [shown, setShown] = React.useState(PAGE_SIZE);
  React.useEffect(() => { setShown(PAGE_SIZE); }, [invoiceSearch, invoiceStatusFilter, src.length, pickMonth]);

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

  // 🔎 ทะเบียนลูกค้าแบบค้นด้วยรหัสได้ — ใช้อ่านประเภทการเก็บเงินมาโชว์ในแถวบิล
  const custById = React.useMemo(() => new Map(customers.map(c => [c.id, c])), [customers]);

  // 🧮 นับจำนวนตามสถานะ — ทำครั้งเดียวต่อชุดข้อมูล
  // เดิมวนทั้งกองบิล 4 รอบ (ปุ่มละรอบ) ทุกครั้งที่ re-render
  const statusCounts = React.useMemo(() => {
    const m = {};
    src.forEach(x => { const s = x.status || "ออกแล้ว"; m[s] = (m[s] || 0) + 1; });
    return m;
  }, [src]);

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
          ? <button onClick={() => { setInvoiceForm({ customerId: "", customerName: "", customerPhone: "", customerAddress: "", customerTaxId: "", items: [], note: "", dueDate: "", vatRate: 7, discount: 0, discountType: "amount", useShipping: false, shippingFee: 0, designFee: 0 }); setInvoiceDocType("receipt"); setInvoiceVat(false); setShowNewInvoice(true); }}
            style={{ padding: "8px 18px", borderRadius: 9, border: "none", cursor: "pointer", background: "linear-gradient(135deg,#3b5b8b,#3b5b8b)", color: "white", fontSize: 12, fontWeight: 600, fontFamily: "'Sarabun',sans-serif", boxShadow: "0 4px 14px rgba(59,91,139,0.3)" }}>＋ ออกบิลใหม่</button>
          : <span style={{ fontSize: 11, color: T.muted, padding: "6px 12px", background: "rgba(241,243,246,0.4)", border: `1px solid ${T.border}`, borderRadius: 8 }}>👁️ โหมดดูเท่านั้น</span>}
      </div>

      {/* 📅 บอกให้ชัดว่ากำลังดูบิลช่วงไหน — บิลเก่ากว่านี้ยังอยู่ครบ แค่ยังไม่ได้โหลด */}
      {setInvoicesRange && !pickMonth && (
        <LoadRangeBar label="กำลังดูบิล" range={invoicesRange} setRange={setInvoicesRange}
          capped={invoicesCapped} count={invoices.length} />
      )}

      {/* 🗓️ เลือกดูทีละเดือน — นับตามวันที่บนหน้าบิล */}
      {(() => {
        const months = recentMonths(24);
        const chips = months.slice(0, 4);
        const chip = (on) => ({
          padding: "4px 12px", borderRadius: 14, cursor: "pointer", fontSize: 11.5, fontFamily: "'Sarabun',sans-serif",
          border: `1px solid ${on ? T.accent : T.border}`, background: on ? "rgba(59,91,139,0.14)" : "white",
          color: on ? T.accent : T.sub, fontWeight: on ? 700 : 500,
        });
        return (
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 12,
            padding: pickMonth ? "8px 14px" : 0, borderRadius: 9,
            background: pickMonth ? "rgba(59,91,139,0.06)" : "transparent", border: pickMonth ? `1px solid ${T.border}` : "none" }}>
            <span style={{ fontSize: 11.5, color: T.sub, fontWeight: 600 }}>🗓️ ดูทีละเดือน:</span>
            {chips.map(mk => (
              <button key={mk} onClick={() => choosePickMonth(pickMonth === mk ? "" : mk)} style={chip(pickMonth === mk)}>
                {monthKeyLabel(mk)}
              </button>
            ))}
            <select value={chips.includes(pickMonth) ? "" : pickMonth} onChange={e => choosePickMonth(e.target.value)}
              style={{ ...chip(!!pickMonth && !chips.includes(pickMonth)), paddingRight: 6, outline: "none" }}>
              <option value="">เดือนอื่น…</option>
              {months.slice(4).map(mk => <option key={mk} value={mk}>{monthKeyLabel(mk)}</option>)}
            </select>
            {pickMonth && (
              <>
                <span style={{ fontSize: 11.5, color: T.sub, marginLeft: 4 }}>
                  {monthLoading
                    ? "⏳ กำลังดึงบิลของเดือนนี้…"
                    : monthErr
                      ? <span style={{ color: T.red }}>ดึงไม่สำเร็จ: {monthErr}</span>
                      : <>กำลังดู <b>{monthKeyLabel(pickMonth)}</b> ({src.length.toLocaleString("th-TH")} ใบ · ตามวันที่บนบิล)</>}
                </span>
                {monthData?.capped && <b style={{ fontSize: 11, color: T.amber }}>⚠️ บิลเยอะเกินกว่าจะดึงหมด</b>}
                <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                  <button onClick={() => loadMonth(pickMonth)} disabled={monthLoading} title="ดึงบิลของเดือนนี้ใหม่"
                    style={{ ...chip(false), opacity: monthLoading ? 0.5 : 1 }}>↻ ดึงใหม่</button>
                  <button onClick={() => choosePickMonth("")} title="กลับไปดูตามช่วงวันที่ที่โหลดไว้" style={chip(false)}>✕ ออกจากดูรายเดือน</button>
                </span>
              </>
            )}
          </div>
        );
      })()}

      {/* 🔍 ค้นหาบิล */}
      <div style={{ marginBottom: 12, position: "relative" }}>
        <input value={typed} onChange={e => setTyped(e.target.value)}
          placeholder="🔍 ค้นหาบิล — ลูกค้า / เบอร์ / เลขที่บิล / หรือชื่อรุ่น สี ไซส์ เช่น &quot;k-12 แดง 2xl&quot;"
          style={{ width: "100%", boxSizing: "border-box", background: T.input, border: `1px solid ${typed ? T.accent : T.inputBorder}`, color: T.text, borderRadius: 10, padding: "10px 40px 10px 14px", fontFamily: "'Sarabun',sans-serif", fontSize: 13, outline: "none" }} />
        {typed && <button onClick={() => { setTyped(""); setInvoiceSearch(""); }} title="ล้าง" style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", padding: "3px 9px", borderRadius: 6, border: "none", background: "rgba(59,91,139,0.1)", color: T.sub, cursor: "pointer", fontSize: 12, fontFamily: "inherit" }}>✕</button>}
      </div>

      {/* 🔗 แถบรวมบิล (ลอย) */}
      {selectedInvoices.size > 0 && (() => {
        const sel = src.filter(i => selectedInvoices.has(i.id));
        const cname = sel[0]?.customerName;
        const sameCustomer = sel.every(i => i.customerName === cname);
        const total = sel.reduce((s, i) => s + (i.total || 0), 0);
        return (
          <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", zIndex: 200, display: "flex", alignItems: "center", gap: 14, background: T.card, border: `1px solid ${T.amber}`, borderRadius: 14, padding: "12px 18px", boxShadow: "0 10px 40px rgba(0,0,0,0.25)" }}>
            <div style={{ fontSize: 13, color: T.text }}>
              เลือก <b style={{ color: T.amber }}>{sel.length}</b> บิล
              {sameCustomer ? <> · <b>{cname}</b> · รวม ฿{total.toLocaleString("th-TH", { minimumFractionDigits: 2 })}</> : <span style={{ color: T.red, marginLeft: 6 }}>⚠️ คนละลูกค้า</span>}
            </div>
            <button onClick={handleMergeInvoices} disabled={docBusy || sel.length < 2 || !sameCustomer}
              style={{ padding: "8px 16px", borderRadius: 9, border: "none", cursor: sel.length < 2 || !sameCustomer ? "not-allowed" : "pointer", background: sel.length < 2 || !sameCustomer ? "rgba(184,134,0,0.3)" : T.amber, color: "white", fontSize: 13, fontWeight: 700, fontFamily: "'Sarabun',sans-serif" }}>🔗 รวมเป็นบิลเดียว</button>
            {/* 🚫 / 🗑 ย้ายมาไว้ตรงนี้ — เดิมกองอยู่ท้ายทุกแถว 5 ปุ่ม จิ้มผิดง่ายและอ่านตารางยาก */}
            <button onClick={() => handleBulkCancelInvoices?.(sel)}
              style={{ padding: "8px 14px", borderRadius: 9, border: "1px solid rgba(217,119,6,0.4)", background: "rgba(217,119,6,0.1)", color: "#b45309", cursor: "pointer", fontSize: 13, fontWeight: 700, fontFamily: "'Sarabun',sans-serif" }}>
              {role.canDelete ? "🚫 ยกเลิกบิล" : "🙋 ขอยกเลิก"}
            </button>
            {role.canDelete && (
              <button onClick={() => handleBulkDeleteInvoices?.(sel)}
                style={{ padding: "8px 12px", borderRadius: 9, border: "1px solid rgba(185,74,72,0.35)", background: "rgba(185,74,72,0.08)", color: T.red, cursor: "pointer", fontSize: 13, fontFamily: "'Sarabun',sans-serif" }}>🗑 ลบ</button>
            )}
            <button onClick={() => setSelectedInvoices(new Set())} style={{ padding: "8px 12px", borderRadius: 9, border: `1px solid ${T.border}`, background: "transparent", color: T.sub, cursor: "pointer", fontSize: 12, fontFamily: "'Sarabun',sans-serif" }}>ล้างที่เลือก</button>
          </div>
        );
      })()}

      {(pickMonth && monthLoading && src.length === 0) ? (
        <div style={{ textAlign: "center", padding: 50, color: T.muted, fontSize: 13 }}>⏳ กำลังดึงบิลของ {monthKeyLabel(pickMonth)}…</div>
      ) : src.length === 0 ? (
        <div style={{ textAlign: "center", padding: 60, background: T.card, borderRadius: 16, border: `1px solid ${T.border}` }}>
          <div style={{ fontSize: 48, marginBottom: 12, opacity: 0.3 }}>🧾</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: T.accent, marginBottom: 6 }}>{pickMonth ? `ไม่มีบิลในเดือน ${monthKeyLabel(pickMonth)}` : "ยังไม่มีบิล"}</div>
          <div style={{ fontSize: 11, color: T.muted }}>{pickMonth ? "นับตามวันที่บนหน้าบิล" : 'กด "＋ ออกบิลใหม่" เพื่อเริ่มต้น'}</div>
        </div>
      ) : (() => {
        const q = norm(invoiceSearch);
        // 🔁 บิลที่ยอด+ลูกค้าตรงกันในช่วงเวลาใกล้กัน — ติดป้ายให้เห็น จะได้ตามไปยกเลิกใบเกิน
        // 📃 บิลใบไหนอยู่ในใบวางบิลแล้ว — คนเก็บเงินต้องรู้ตั้งแต่หน้ารายการบิล
        //    ว่าใบนี้ทวงไปแล้วหรือยัง ไม่งั้นต้องข้ามไปเปิดหน้าใบวางบิลเทียบเองทีละใบ
        //    ใบวางบิลที่ยกเลิกไม่นับ — บิลในนั้นกลับมาวางใหม่ได้
        const stmtMap = new Map();
        (statements || []).forEach(st => {
          if (!st || (st.status || "") === "ยกเลิก") return;
          (st.invoiceIds || []).forEach(id => { if (!stmtMap.has(id)) stmtMap.set(id, st); });
        });
        const dupMap = duplicateGroups(src);
        let fInv = invoiceStatusFilter === "ทั้งหมด" ? src : src.filter(x => (x.status || "ออกแล้ว") === invoiceStatusFilter);
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
            {q && <div style={{ marginTop: 8, fontSize: 12, color: T.amber }}>
              {pickMonth
                ? `ค้นเฉพาะบิลในเดือน ${monthKeyLabel(pickMonth)} — กด ✕ ออกจากดูรายเดือน หรือเลือกเดือนอื่น`
                : "ค้นเฉพาะบิลในช่วงที่โหลดมาเท่านั้น — ขยายช่วงวันที่ด้านบน หรือใช้ 🔎 ค้นหาทั้งระบบ"}
            </div>}
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
              const monthTotal = sumInvoices(monthInvs);
              const monthSkipped = monthInvs.length - monthInvs.filter(countsToTotal).length;
              const monthCollapsed = collapsedInvoiceMonths[mk];
              const [mm, yyyy] = mk.split("/");
              const monthLabel = `${THAI_MONTHS[Number(mm)] || mm} ${yyyy}`;
              return (
                <div key={mk}>
                  <div onClick={() => setCollapsedInvoiceMonths(p => ({ ...p, [mk]: !p[mk] }))} style={{ padding: "8px 14px", background: "linear-gradient(90deg,#3b5b8b,#5b7ba8)", borderRadius: 10, display: "flex", alignItems: "center", gap: 10, cursor: "pointer", userSelect: "none", marginBottom: monthCollapsed ? 0 : 10 }}>
                    <div style={{ width: 20, height: 20, color: "white", fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center", transition: "transform 0.2s", transform: monthCollapsed ? "rotate(-90deg)" : "rotate(0deg)" }}>▼</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "white", letterSpacing: 0.3 }}>📅 {monthLabel}</div>
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.85)" }}>
                      {monthInvs.length} ใบ · {daysInMonth.length} วัน
                      {/* บอกให้ชัดว่ายอดไม่ได้มาจากทุกใบที่เห็น ไม่งั้นเอาไปบวกเองแล้วไม่ตรง นึกว่าระบบเพี้ยน */}
                      {monthSkipped > 0 && <span title="ใบที่ยกเลิก / ถูกรวมเข้าบิลใหม่ / แปลงเป็นเอกสารอื่น — ไม่เอามาบวกในยอดรวม"> · ไม่นับยอด {monthSkipped} ใบ</span>}
                    </div>
                    <div style={{ marginLeft: "auto", fontSize: 12, color: "white", fontFamily: "monospace", fontWeight: 700 }}>฿{monthTotal.toLocaleString("th-TH", { minimumFractionDigits: 2 })}</div>
                  </div>
                  {!monthCollapsed && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginLeft: 8 }}>
                      {daysInMonth.map(date => {
                        const list = groups[date];
                        const totalAmount = sumInvoices(list);
                        const daySkipped = list.length - list.filter(countsToTotal).length;
                        const collapsed = collapsedInvoiceDates[date];
                        return (
                          <div key={date} className="tbl-x" style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 16, overflow: "hidden", "--tbl-min": "820px" }}>
                            <div onClick={() => setCollapsedInvoiceDates(p => ({ ...p, [date]: !p[date] }))} style={{ padding: "10px 20px", background: "linear-gradient(90deg,rgba(59,91,139,0.12),transparent)", borderBottom: collapsed ? "none" : `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 12, cursor: "pointer", userSelect: "none" }}
                              onMouseEnter={e => e.currentTarget.style.background = "linear-gradient(90deg,rgba(59,91,139,0.2),transparent)"}
                              onMouseLeave={e => e.currentTarget.style.background = "linear-gradient(90deg,rgba(59,91,139,0.12),transparent)"}>
                              <div style={{ width: 22, height: 22, borderRadius: 6, background: "rgba(59,91,139,0.15)", border: "1px solid rgba(59,91,139,0.25)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: T.accent, transition: "transform 0.2s", transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)" }}>▼</div>
                              <div style={{ fontSize: 13, fontWeight: 700, color: T.accent }}>📅 {date}</div>
                              <div style={{ fontSize: 11, color: T.muted }}>
                                {list.length} ใบ
                                {daySkipped > 0 && <span title="ใบที่ยกเลิก / ถูกรวมเข้าบิลใหม่ / แปลงเป็นเอกสารอื่น — ไม่เอามาบวกในยอดรวม"> · ไม่นับยอด {daySkipped} ใบ</span>}
                              </div>
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
                                        <input type="checkbox" checked={selectedInvoices.has(inv.id)} onChange={() => toggleInvoiceSelect(inv.id)} title="เลือกไว้ทำหลายใบพร้อมกัน — รวมบิล / ยกเลิก / ลบ" style={{ width: 15, height: 15, cursor: "pointer", accentColor: T.amber }} />
                                      )}
                                      <span style={{ fontFamily: "monospace", fontSize: 11, color: T.accent, fontWeight: 700 }}>{inv.invoiceNo}</span>
                                    </div>
                                    <div><span style={{ padding: "2px 8px", borderRadius: 12, fontSize: 10, fontWeight: 600, background: "rgba(59,91,139,0.1)", color: T.accent, border: "1px solid rgba(59,91,139,0.2)" }}>{docTypeLabel(inv.docType)?.slice(0, 4)}</span></div>
                                    <div>
                                      <div style={{ fontWeight: 600, color: T.text, fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>{inv.customerName}
                                        {/* 💵/📄 ประเภทการเก็บเงิน — โชว์บนจอให้คนเก็บเงินเห็นว่าใบนี้ต้องเก็บสดหรือรอวางบิล
                                            ⚠️ ห้ามเอาไปใส่ในใบที่พิมพ์ (PrintInvoiceModal) เด็ดขาด
                                            เป็นข้อมูลภายในของร้าน ลูกค้าไม่ต้องเห็นว่าเราจัดเขาเป็นประเภทไหน */}
                                        {inv.customerId && <BillingBadge type={custById.get(inv.customerId)?.billingType}/>}
                                        {/* 🏐 บิลที่ถูกแยกออกเป็นคู่ — เห็นในรายการเลยว่าอีกใบคือใบไหน
                                            ไม่งั้นเจอเลขที่ข้ามกันในใบวางบิลแล้วนึกว่าออกซ้ำ */}
                                        {inv.splitSiblingNo && (
                                          <span title={`ออเดอร์นี้แยกเป็น 2 ใบ — อีกใบคือ ${inv.splitSiblingNo}`}
                                            style={{ padding: "1px 6px", fontSize: 9, background: "rgba(245,158,11,0.14)", color: "#b45309", border: "1px solid rgba(217,119,6,0.3)", borderRadius: 5, fontWeight: 700, cursor: "help" }}>
                                            {inv.billGroup === "equipment" ? "🏐 อุปกรณ์กีฬา" : "👕 เสื้อผ้า"} · คู่กับ {inv.splitSiblingNo}
                                          </span>
                                        )}
                                        {inv.mergedInto && <span title={`รวมเข้า ${inv.mergedInto.invoiceNo}`} style={{ padding: "1px 6px", fontSize: 9, background: "rgba(184,134,0,0.15)", color: T.amber, borderRadius: 5, fontWeight: 700 }}>🔗 รวมแล้ว</span>}
                                        {inv.mergedFrom?.length > 0 && <span title={`รวมจาก ${inv.mergedFrom.length} บิล`} style={{ padding: "1px 6px", fontSize: 9, background: "rgba(58,122,82,0.15)", color: T.green, borderRadius: 5, fontWeight: 700 }}>🔗 บิลรวม ×{inv.mergedFrom.length}</span>}
                                        {stmtMap.has(inv.id) && (() => {
                                          const st = stmtMap.get(inv.id);
                                          return (
                                            <span title={`อยู่ในใบวางบิล ${st.statementNo}${st.date ? ` · ออก ${(st.date || "").split(" ")[0]}` : ""}\nวางบิลไปแล้ว จะไม่ถูกดึงเข้าใบวางบิลใบใหม่อีก`}
                                              style={{ padding: "1px 6px", fontSize: 9, background: "rgba(8,145,178,0.12)", color: "#0891b2", border: "1px solid #a5f3fc", borderRadius: 5, fontWeight: 700, cursor: "help" }}>
                                              📃 วางบิลแล้ว {st.statementNo}
                                            </span>
                                          );
                                        })()}
                                        {dupMap.has(inv.id) && (
                                          <span title={`ยอดเท่ากับ: ${dupMap.get(inv.id).map(o => `${o.invoiceNo} (${(o.date || "").split(" ")[0]})`).join(", ")}\nตรวจว่าออกซ้ำหรือไม่ — ถ้าซ้ำให้ยกเลิกใบที่เกิน`}
                                            style={{ padding: "1px 6px", fontSize: 9, background: "rgba(185,74,72,0.15)", color: T.red, borderRadius: 5, fontWeight: 700, cursor: "help" }}>
                                            🔁 ยอดซ้ำ ×{dupMap.get(inv.id).length + 1}
                                          </span>
                                        )}
                                      </div>
                                      <div style={{ fontSize: 10, color: T.muted }}>{inv.customerPhone}</div>
                                    </div>
                                    <div style={{ textAlign: "right", fontFamily: "monospace", fontWeight: 700, color: "#34d399", fontSize: 13 }}>
                                      ฿{(inv.total || 0).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                                      {/* ↩️ ของที่ลูกค้าคืนแล้ว — บิลต้นฉบับคงยอดเดิม โชว์ยอดสุทธิเพิ่มให้แทน */}
                                      {(() => { const rs = returnSummaryOf(returns, inv.id); if (rs.total <= 0) return null; return (
                                        <div style={{ marginTop: 2 }}>
                                          <div style={{ fontSize: 9, color: "#b45309", fontWeight: 700 }}>
                                            ↩️ -฿{rs.total.toLocaleString("th-TH", { minimumFractionDigits: 2 })} · สุทธิ ฿{Math.max(0, (inv.total || 0) - rs.total).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                                          </div>
                                          {/* 📦 คืนของอะไรมา — เดิมซ่อนไว้ใน tooltip ซึ่งบนแท็บเล็ตเปิดดูไม่ได้เลย
                                              เวลาลูกค้าโทรมาถามว่าหักอะไร ต้องตอบได้จากหน้านี้ทันที */}
                                          {returnsItemsText(rs.list, 2) && (
                                            <div style={{ fontSize: 9, color: T.muted, fontWeight: 400 }}>{returnsItemsText(rs.list, 2)}</div>
                                          )}
                                        </div>
                                      ); })()}
                                      {(inv.payments || []).length > 0 && (() => { const paid = getPaidTotal(inv); const pct = getPaidPct(inv); return (
                                        <div style={{ fontSize: 9, color: pct >= 100 ? "#16a34a" : T.amber, fontWeight: 600, marginTop: 2 }}>💵 ฿{paid.toLocaleString("th-TH", { minimumFractionDigits: 2 })} ({pct}%)</div>
                                      ); })()}
                                    </div>
                                    <div style={{ fontSize: 11, color: T.muted }}>
                                      {inv.date}
                                      {/* 👤 คนออกบิล — โชว์บนจอเท่านั้น ให้ตามตัวได้ว่าใบนี้ใครทำ
                                          (เวลามีบิลซ้ำ/ยอดผิด จะได้ถามถูกคน ไม่ต้องไล่เปิดประวัติการใช้งาน)
                                          ⚠️ ห้ามเอาไปใส่ในใบที่พิมพ์ (PrintInvoiceModal) เด็ดขาด
                                          เป็นข้อมูลภายในของร้าน ลูกค้าไม่ต้องรู้ว่าพนักงานคนไหนออกให้ */}
                                      {inv.by && (
                                        <div title={inv.lastEditedBy && inv.lastEditedBy !== inv.by
                                          ? `ออกโดย ${inv.by} · แก้ล่าสุดโดย ${inv.lastEditedBy}${inv.lastEditedAt ? ` (${inv.lastEditedAt})` : ""}`
                                          : `ออกโดย ${inv.by}`}
                                          style={{ fontSize: 10, color: T.sub, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                          👤 {inv.by}
                                          {inv.lastEditedBy && inv.lastEditedBy !== inv.by && <span style={{ color: T.amber }}> ✏️</span>}
                                        </div>
                                      )}
                                    </div>
                                    <div onClick={e => e.stopPropagation()}>
                                      <select value={inv.status || "ออกแล้ว"} onChange={e => handleUpdateInvoiceStatus(inv.id, e.target.value)}
                                        style={{ background: st.bg, border: st.border, borderRadius: 10, padding: "4px 8px", fontSize: 10, fontWeight: 600, color: st.color, cursor: "pointer", fontFamily: "'Sarabun',sans-serif", outline: "none" }}>
                                        {/* "ยกเลิก" ไม่อยู่ในช่องนี้ — ใช้ปุ่ม 🚫 แทน จะได้ผ่านขั้นขออนุมัติของ staff
                                            แต่ถ้าบิลถูกยกเลิกไปแล้วต้องมีตัวเลือกไว้ ไม่งั้น select จะไม่มีค่าที่ตรง */}
                                        {PAYMENT_STATUSES.filter(x => x !== "ยกเลิก" || (inv.status || "") === "ยกเลิก")
                                          .map(s => <option key={s} value={s}>{s}</option>)}
                                      </select>
                                    </div>
                                    <div style={{ display: "flex", gap: 4, justifyContent: "flex-end", flexWrap: "nowrap" }} onClick={e => e.stopPropagation()}>
                                      <button onClick={() => openPaymentModal(inv)} title="จัดการการชำระเงิน" style={{ padding: "4px 7px", borderRadius: 7, border: "1px solid rgba(16,185,129,0.3)", background: "rgba(16,185,129,0.08)", color: T.green, cursor: "pointer", fontSize: 11, fontFamily: "'Sarabun',sans-serif" }}>💵</button>
                                      <button onClick={() => setShowPrintInvoice(inv)} title="พิมพ์" style={{ padding: "4px 7px", borderRadius: 7, border: "1px solid rgba(59,91,139,0.25)", background: "rgba(59,91,139,0.08)", color: T.accent, cursor: "pointer", fontSize: 11, fontFamily: "'Sarabun',sans-serif" }}>🖨️</button>
                                      {role.canIssueInvoice !== false && inv.docType === "quotation" && !inv.convertedTo && (
                                        <button onClick={() => handleConvertQuotation(inv, "receipt")} disabled={docBusy} title="แปลงเป็นใบเสร็จ" style={{ padding: "4px 7px", borderRadius: 7, border: "1px solid rgba(58,122,82,0.3)", background: "rgba(58,122,82,0.08)", color: T.green, cursor: "pointer", fontSize: 11, fontFamily: "'Sarabun',sans-serif" }}>🔄</button>
                                      )}
                                      {inv.convertedTo && (
                                        <span title={`แปลงเป็น ${inv.convertedTo.invoiceNo} แล้ว`} style={{ padding: "4px 6px", borderRadius: 7, background: "rgba(58,122,82,0.06)", color: T.green, fontSize: 10, fontFamily: "'Sarabun',sans-serif" }}>✓ แปลงแล้ว</span>
                                      )}
                                      {inv.mergedFrom?.length > 0 && role.canDelete && (
                                        <button onClick={() => handleUnmergeInvoice(inv)} title="ยกเลิกการรวม — คืนบิลเดิม" style={{ padding: "4px 7px", borderRadius: 7, border: "1px solid rgba(184,134,0,0.3)", background: "rgba(184,134,0,0.08)", color: T.amber, cursor: "pointer", fontSize: 11, fontFamily: "'Sarabun',sans-serif" }}>🔓</button>
                                      )}
                                      {role.canIssueInvoice !== false && <button onClick={() => handleEditInvoice(inv)} title="แก้ไข" style={{ padding: "4px 7px", borderRadius: 7, border: "1px solid rgba(184,134,0,0.3)", background: "rgba(184,134,0,0.08)", color: T.amber, cursor: "pointer", fontSize: 11, fontFamily: "'Sarabun',sans-serif" }}>✏️</button>}
                                      {/* ปุ่ม 🚫 ยกเลิก / 🗑 ลบ ย้ายไปแถบเลือกด้านล่างแล้ว
                                          ติ๊กแถวที่ต้องการ แล้วสั่งทีเดียว — แถวนี้เหลือปุ่มที่ใช้บ่อยจริง */}
                                      {inv.cancelRequest && (role.canDelete ? (
                                        <>
                                          <span title={`${inv.cancelRequest.by} ขอเมื่อ ${inv.cancelRequest.at}${inv.cancelRequest.reason ? ` — ${inv.cancelRequest.reason}` : ""}`}
                                            style={{ padding: "3px 7px", borderRadius: 7, background: "rgba(217,119,6,0.12)", color: "#b45309", fontSize: 10, fontWeight: 700, whiteSpace: "nowrap" }}>
                                            🙋 {inv.cancelRequest.by} ขอยกเลิก
                                          </span>
                                          <button onClick={() => handleCancelInvoice(inv)} title="อนุมัติ — ยกเลิกบิลนี้"
                                            style={{ padding: "4px 7px", borderRadius: 7, border: "1px solid rgba(185,74,72,0.4)", background: "rgba(185,74,72,0.1)", color: T.red, cursor: "pointer", fontSize: 11, fontWeight: 700, fontFamily: "'Sarabun',sans-serif" }}>✔ อนุมัติ</button>
                                          <button onClick={() => handleRejectCancel(inv)} title="ไม่อนุมัติ"
                                            style={{ padding: "4px 7px", borderRadius: 7, border: `1px solid ${T.border}`, background: "white", color: T.sub, cursor: "pointer", fontSize: 11, fontFamily: "'Sarabun',sans-serif" }}>✕</button>
                                        </>
                                      ) : (
                                        <span style={{ padding: "3px 7px", borderRadius: 7, background: "rgba(217,119,6,0.12)", color: "#b45309", fontSize: 10, fontWeight: 700, whiteSpace: "nowrap" }}>⏳ รออนุมัติยกเลิก</span>
                                      ))}
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
