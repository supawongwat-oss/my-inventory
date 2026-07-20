// 📊 Reports Tab — รายงานเชิงลึก
import { useState, useMemo, useEffect } from "react";
import { T } from "../theme";
import { CardBox } from "../components/ui";
import { matchTokens } from "../utils/search";
import { monthlyStats } from "../utils/orderStats";

// ────────── helpers ──────────
const fmtBaht = (n) => `฿${Number(n||0).toLocaleString("th-TH", { minimumFractionDigits: 2 })}`;
const fmtInt  = (n) => Number(n||0).toLocaleString("th-TH");

// "DD/MM/YYYY HH:mm" → Date (รองรับทั้ง พ.ศ. และ ค.ศ.)
const parseDate = (s) => {
  if (!s) return null;
  const part = s.split(" ")[0];
  const [d, m, y] = part.split("/").map(Number);
  if (!d || !m || !y) return null;
  const year = y > 2500 ? y - 543 : y;
  return new Date(year, m - 1, d);
};

const monthKey = (date) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}`;
const monthLabel = (key) => {
  const [y, m] = key.split("-");
  const months = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];
  return `${months[Number(m)-1]} ${String(Number(y)+543).slice(-2)}`;
};

// CSV export
function exportCSV(filename, rows) {
  if (!rows.length) { alert("ไม่มีข้อมูล export"); return; }
  const headers = Object.keys(rows[0]);
  const bom = "﻿";
  const csv = bom + [headers, ...rows.map(r => headers.map(h => `"${String(r[h]??"").replace(/"/g,'""')}"`))].map(r => r.join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function MiniBar({ label, value, max, color, unit = "", subtext }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: 12, color: T.text, fontWeight: 500 }}>{label}</span>
        <span style={{ fontSize: 12, fontFamily: "monospace", fontWeight: 700, color }}>{typeof value === "number" ? fmtInt(value) : value}{unit}</span>
      </div>
      <div style={{ height: 8, borderRadius: 4, background: "rgba(241,243,246,0.6)", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 4, transition: "width .4s" }} />
      </div>
      {subtext && <div style={{ fontSize: 10, color: T.muted, marginTop: 2 }}>{subtext}</div>}
    </div>
  );
}

// ────────── Main Component ──────────
export default function ReportsTab({ products = [], transactions = [], invoices = [], orders = [], customers = [], clothingItems = [] }) {
  const [tab, setTab] = useState("overview");

  // ============== SHARED DATA ==============
  const totalStockValue = useMemo(() => products.reduce((s, p) => s + (Number(p.qty) * Number(p.costPrice || 0)), 0), [products]);
  const totalSaleValue  = useMemo(() => products.reduce((s, p) => s + (Number(p.qty) * Number(p.salePrice || 0)), 0), [products]);
  const estimatedProfit = totalSaleValue - totalStockValue;

  // ============== TABS ==============
  const tabs = [
    { id: "overview",  icon: "📊", label: "ภาพรวม" },
    { id: "aging",     icon: "⏰", label: "Aging บิลค้าง" },
    { id: "customer",  icon: "👥", label: "ยอดต่อลูกค้า" },
    { id: "product",   icon: "📦", label: "ยอดต่อสินค้า" },
    { id: "trend",     icon: "📈", label: "Trend รายเดือน" },
    { id: "profit",    icon: "💵", label: "กำไร" },
    { id: "vat",       icon: "🧾", label: "VAT" },
  ];

  return (
    <div style={{ animation: "fadeUp 0.4s ease" }}>
      {/* Sub-tabs */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 18, padding: 8, background: T.card, borderRadius: 12, border: `1px solid ${T.border}` }}>
        {tabs.map(t => {
          const active = tab === t.id;
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{
                padding: "7px 14px", borderRadius: 8, border: "none", cursor: "pointer", fontFamily: "'Sarabun',sans-serif", fontSize: 12, fontWeight: active ? 700 : 500,
                background: active ? T.accent : "transparent",
                color: active ? "#fff" : T.sub,
                transition: "all 0.15s",
              }}>
              {t.icon} {t.label}
            </button>
          );
        })}
      </div>

      {tab === "overview"  && <OverviewTab products={products} transactions={transactions} invoices={invoices} orders={orders} totalStockValue={totalStockValue} totalSaleValue={totalSaleValue} estimatedProfit={estimatedProfit}/>}
      {tab === "aging"     && <AgingTab invoices={invoices}/>}
      {tab === "customer"  && <SalesByCustomerTab invoices={invoices} customers={customers}/>}
      {tab === "product"   && <SalesByProductTab transactions={transactions} invoices={invoices} products={products}/>}
      {tab === "trend"     && <MonthlyTrendTab/>}
      {tab === "profit"    && <ProfitTab products={products} clothingItems={clothingItems}/>}
      {tab === "vat"       && <VATTab invoices={invoices}/>}
    </div>
  );
}

// ────────── 1. OVERVIEW (เดิม) ──────────
function OverviewTab({ products, transactions, invoices, orders, totalStockValue, totalSaleValue, estimatedProfit }) {
  // รับ/จ่าย 30 วัน
  const now = new Date();
  const days30 = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(now); d.setDate(d.getDate() - (29 - i));
    return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}`;
  });
  const txByDay = {};
  transactions.forEach(t => {
    if (!t.date) return;
    const parts = t.date.split(" ")[0];
    const [dd, mm] = parts.split("/");
    const key = `${dd}/${mm}`;
    if (!txByDay[key]) txByDay[key] = { in: 0, out: 0 };
    if (t.type === "รับ") txByDay[key].in += Number(t.qty) || 0;
    else txByDay[key].out += Number(t.qty) || 0;
  });
  const chartData = days30.map(d => ({ d, in: txByDay[d]?.in || 0, out: txByDay[d]?.out || 0 }));
  const maxBar = Math.max(...chartData.map(x => Math.max(x.in, x.out)), 1);

  // Top สินค้า (qty)
  const txCount = {};
  transactions.forEach(t => { if (t.name && t.type === "จ่าย") txCount[t.name] = (txCount[t.name] || 0) + (Number(t.qty) || 0); });
  const topProducts = Object.entries(txCount).sort((a, b) => b[1] - a[1]).slice(0, 5);

  // ยอดบิล
  const invoiceTotal = invoices.reduce((s, inv) => s + (Number(inv.total) || 0), 0);
  const paidTotal = invoices.filter(inv => inv.status === "ชำระแล้ว").reduce((s, inv) => s + (Number(inv.total) || 0), 0);
  const pendingTotal = invoices.filter(inv => inv.status === "รอชำระ" || inv.status === "ออกแล้ว").reduce((s, inv) => s + (Number(inv.total) || 0), 0);

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginBottom: 20 }}>
        {[
          { label: "มูลค่าสต็อก (ทุน)", value: fmtBaht(totalStockValue), icon: "📦", color: T.blue },
          { label: "มูลค่าสต็อก (ขาย)", value: fmtBaht(totalSaleValue), icon: "💰", color: T.green },
          { label: "กำไรโดยประมาณ", value: fmtBaht(estimatedProfit), icon: "📈", color: estimatedProfit >= 0 ? T.green : T.red },
          { label: "ยอดบิลทั้งหมด", value: fmtBaht(invoiceTotal), icon: "🧾", color: T.amber },
        ].map((s, i) => (
          <div key={i} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
              <div style={{ fontSize: 11, color: T.sub }}>{s.label}</div>
              <div style={{ fontSize: 18 }}>{s.icon}</div>
            </div>
            <div style={{ fontSize: 18, fontWeight: 800, color: s.color, fontFamily: "monospace" }}>{s.value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        <CardBox>
          <div style={{ fontSize: 13, fontWeight: 600, color: T.text, marginBottom: 14 }}>📊 รับ/จ่ายสินค้า 30 วันล่าสุด</div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 100, overflowX: "auto", paddingBottom: 4 }}>
            {chartData.map((d, i) => (
              <div key={i} style={{ flex: "0 0 auto", display: "flex", flexDirection: "column", alignItems: "center", gap: 1, minWidth: 14 }}>
                <div style={{ width: 6, height: `${(d.in / maxBar) * 90}px`, background: T.green, borderRadius: 2, minHeight: 1 }} title={`${d.d}: รับ ${d.in}`} />
                <div style={{ width: 6, height: `${(d.out / maxBar) * 90}px`, background: T.red, borderRadius: 2, minHeight: 1 }} title={`${d.d}: จ่าย ${d.out}`} />
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 14, marginTop: 8, fontSize: 10, color: T.muted }}>
            <span><span style={{ color: T.green }}>■</span> รับเข้า</span>
            <span><span style={{ color: T.red }}>■</span> จ่ายออก</span>
          </div>
        </CardBox>

        <CardBox>
          <div style={{ fontSize: 13, fontWeight: 600, color: T.text, marginBottom: 14 }}>🏆 สินค้าจ่ายออกมากสุด (Top 5)</div>
          {topProducts.length === 0 ? (
            <div style={{ color: T.muted, fontSize: 12, textAlign: "center", padding: 20 }}>ยังไม่มีข้อมูล</div>
          ) : topProducts.map(([name, qty], i) => (
            <MiniBar key={i} label={name.length > 24 ? name.slice(0, 22) + "…" : name} value={qty} max={topProducts[0][1]} color={[T.blue, T.green, T.amber, T.indigo, T.cyan][i]} unit=" ชิ้น" />
          ))}
        </CardBox>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 16 }}>
        <CardBox>
          <div style={{ fontSize: 13, fontWeight: 600, color: T.text, marginBottom: 14 }}>💳 สถานะการชำระเงิน</div>
          {[
            { label: "ชำระแล้ว", value: paidTotal, color: T.green },
            { label: "รอชำระ / ออกแล้ว", value: pendingTotal, color: T.amber },
            { label: "ยอดรวมทั้งหมด", value: invoiceTotal, color: T.blue },
          ].map((r, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: i < 2 ? `1px solid ${T.border}` : "none" }}>
              <span style={{ fontSize: 13, color: T.sub }}>{r.label}</span>
              <span style={{ fontSize: 14, fontWeight: 700, fontFamily: "monospace", color: r.color }}>{fmtBaht(r.value)}</span>
            </div>
          ))}
        </CardBox>
      </div>
    </>
  );
}

// ────────── 2. AGING (บิลค้างชำระ) ──────────
// helper: รวมลูกค้าชื่อเดียวกัน (ตัด space + lowercase) เป็น key เดียว
const normalizeName = (s) => (s || "—").trim().toLowerCase().replace(/\s+/g, " ");

function AgingTab({ invoices }) {
  const [customerFilter, setCustomerFilter] = useState("ทั้งหมด"); // เก็บเป็น normalized key
  const [customerSearch, setCustomerSearch] = useState("");

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // กรองเฉพาะที่ยังไม่ชำระ + ตามลูกค้าที่เลือก
  const unpaid = useMemo(() => invoices.filter(inv => {
    const st = inv.status || "ออกแล้ว";
    if (st === "ชำระแล้ว" || st === "ยกเลิก") return false;
    if (customerFilter !== "ทั้งหมด" && normalizeName(inv.customerName) !== customerFilter) return false;
    return true;
  }), [invoices, customerFilter]);

  // รายชื่อลูกค้าที่มีบิลค้าง (สำหรับ dropdown) — รวมชื่อซ้ำ (ตัด space + case)
  const customerOptions = useMemo(() => {
    const map = new Map(); // normKey -> { key, displayName, variants, count, total }
    invoices.forEach(inv => {
      const st = inv.status || "ออกแล้ว";
      if (st === "ชำระแล้ว" || st === "ยกเลิก") return;
      const rawName = inv.customerName || "—";
      const key = normalizeName(rawName);
      if (!map.has(key)) map.set(key, { key, displayName: rawName, variants: new Set([rawName]), count: 0, total: 0 });
      const c = map.get(key);
      c.variants.add(rawName);
      c.count++;
      c.total += Number(inv.total) || 0;
    });
    return Array.from(map.values()).sort((a,b) => b.total - a.total);
  }, [invoices]);

  // filter dropdown ตามคำค้น
  const filteredCustomerOptions = useMemo(() => {
    const q = (customerSearch || "").trim();
    if (!q) return customerOptions;
    return customerOptions.filter(c => matchTokens(q, c.displayName));
  }, [customerOptions, customerSearch]);

  // ชื่อ display ของ customer ที่กำลังเลือก
  const selectedCustomerDisplay = useMemo(() => {
    if (customerFilter === "ทั้งหมด") return null;
    const opt = customerOptions.find(c => c.key === customerFilter);
    return opt || null;
  }, [customerFilter, customerOptions]);

  // แบ่งกลุ่มตาม days outstanding
  const buckets = useMemo(() => {
    const groups = {
      "0-30":  { label: "0-30 วัน",   items: [], total: 0, color: T.green,  bg: "rgba(58,122,82,0.08)" },
      "31-60": { label: "31-60 วัน",  items: [], total: 0, color: T.amber,  bg: "rgba(184,134,0,0.08)" },
      "61-90": { label: "61-90 วัน",  items: [], total: 0, color: "#d97706", bg: "rgba(217,119,6,0.08)" },
      "90+":   { label: "90+ วัน",    items: [], total: 0, color: T.red,    bg: "rgba(185,74,72,0.08)" },
    };
    unpaid.forEach(inv => {
      const d = parseDate(inv.date);
      if (!d) return;
      const days = Math.floor((today - d) / (1000*60*60*24));
      const key = days <= 30 ? "0-30" : days <= 60 ? "31-60" : days <= 90 ? "61-90" : "90+";
      groups[key].items.push({ ...inv, days });
      groups[key].total += Number(inv.total) || 0;
    });
    Object.values(groups).forEach(g => g.items.sort((a,b) => b.days - a.days));
    return groups;
  }, [unpaid, today]);

  // รวมตามลูกค้า — รวมชื่อซ้ำเป็นแถวเดียว
  const byCustomer = useMemo(() => {
    const m = new Map(); // normKey -> {key, name, phone, count, total, oldest, buckets, variants}
    unpaid.forEach(inv => {
      const d = parseDate(inv.date);
      if (!d) return;
      const days = Math.floor((today - d) / (1000*60*60*24));
      const rawName = inv.customerName || "—";
      const key = normalizeName(rawName);
      if (!m.has(key)) m.set(key, { key, name: rawName, phone: inv.customerPhone, count: 0, total: 0, oldest: 0, b030: 0, b3160: 0, b6190: 0, b90: 0, variants: new Set([rawName]) });
      const c = m.get(key);
      c.variants.add(rawName);
      if (!c.phone && inv.customerPhone) c.phone = inv.customerPhone; // เติมเบอร์ถ้ายังว่าง
      c.count++;
      c.total += Number(inv.total) || 0;
      c.oldest = Math.max(c.oldest, days);
      if (days <= 30) c.b030 += Number(inv.total) || 0;
      else if (days <= 60) c.b3160 += Number(inv.total) || 0;
      else if (days <= 90) c.b6190 += Number(inv.total) || 0;
      else c.b90 += Number(inv.total) || 0;
    });
    return Array.from(m.values()).sort((a,b) => b.total - a.total);
  }, [unpaid, today]);

  const grandTotal = Object.values(buckets).reduce((s,b) => s + b.total, 0);

  const exportAging = () => {
    exportCSV(`aging-${new Date().toISOString().slice(0,10)}.csv`, byCustomer.map(c => ({
      "ลูกค้า": c.name,
      "เบอร์": c.phone || "",
      "จำนวนบิล": c.count,
      "ยอดรวม (฿)": c.total.toFixed(2),
      "0-30 วัน": c.b030.toFixed(2),
      "31-60 วัน": c.b3160.toFixed(2),
      "61-90 วัน": c.b6190.toFixed(2),
      "90+ วัน": c.b90.toFixed(2),
      "ค้างนานสุด (วัน)": c.oldest,
    })));
  };

  // รายการบิลของลูกค้าที่เลือก (ถ้าเลือกคนใดคนหนึ่ง)
  const customerInvoices = useMemo(() => {
    if (customerFilter === "ทั้งหมด") return [];
    return unpaid.map(inv => {
      const d = parseDate(inv.date);
      const days = d ? Math.floor((today - d) / (1000*60*60*24)) : 0;
      return { ...inv, days };
    }).sort((a,b) => b.days - a.days);
  }, [unpaid, customerFilter, today]);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: T.text }}>
            ⏰ Aging Report — บิลค้างชำระ
            {selectedCustomerDisplay && <span style={{ marginLeft: 8, padding: "2px 10px", borderRadius: 12, background: "rgba(59,91,139,0.12)", color: T.accent, fontSize: 12, border: `1px solid rgba(59,91,139,0.3)` }}>👤 {selectedCustomerDisplay.displayName}{selectedCustomerDisplay.variants.size > 1 ? ` (${selectedCustomerDisplay.variants.size} variants)` : ""}</span>}
          </div>
          <div style={{ fontSize: 11, color: T.muted }}>ทั้งหมด {unpaid.length} ใบ · รวม {fmtBaht(grandTotal)}</div>
        </div>
        <button onClick={exportAging} style={{ padding: "7px 14px", borderRadius: 8, border: `1px solid ${T.border}`, background: "rgba(58,122,82,0.1)", color: T.green, cursor: "pointer", fontSize: 12, fontFamily: "'Sarabun',sans-serif", fontWeight: 600 }}>
          📊 Export CSV
        </button>
      </div>

      {/* Customer Filter */}
      <div style={{ marginBottom: 16, padding: 12, background: T.card, border: `1px solid ${T.border}`, borderRadius: 10 }}>
        <div style={{ fontSize: 11, color: T.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>🔍 กรองตามลูกค้า · ชื่อเหมือนกันถูกรวมแล้ว</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <button onClick={() => { setCustomerFilter("ทั้งหมด"); setCustomerSearch(""); }}
            style={{ padding: "6px 14px", borderRadius: 8, border: customerFilter === "ทั้งหมด" ? `1.5px solid ${T.accent}` : `1px solid ${T.border}`, background: customerFilter === "ทั้งหมด" ? "rgba(59,91,139,0.12)" : "transparent", color: customerFilter === "ทั้งหมด" ? T.accent : T.sub, cursor: "pointer", fontSize: 12, fontFamily: "'Sarabun',sans-serif", fontWeight: customerFilter === "ทั้งหมด" ? 700 : 500 }}>
            👥 ทั้งหมด <span style={{ marginLeft: 4, fontSize: 10, opacity: 0.7 }}>({customerOptions.length})</span>
          </button>
          <input value={customerSearch} onChange={e => setCustomerSearch(e.target.value)}
            placeholder="🔍 พิมพ์ชื่อลูกค้า..."
            style={{ flex: 1, minWidth: 200, maxWidth: 280, background: T.input, border: `1px solid ${T.inputBorder}`, color: T.text, borderRadius: 7, padding: "6px 12px", fontFamily: "'Sarabun',sans-serif", fontSize: 12, outline: "none" }}/>
          <select value={customerFilter} onChange={e => setCustomerFilter(e.target.value)}
            style={{ background: T.input, border: `1px solid ${T.inputBorder}`, color: T.text, borderRadius: 7, padding: "7px 10px", fontSize: 12, outline: "none", cursor: "pointer", minWidth: 220 }}>
            <option value="ทั้งหมด">— เลือกลูกค้า —</option>
            {filteredCustomerOptions.map((c, i) => (
              <option key={i} value={c.key}>{c.displayName} ({c.count} ใบ · ฿{Math.round(c.total).toLocaleString()}){c.variants.size > 1 ? ` · ${c.variants.size} variants` : ""}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Bucket cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 18 }}>
        {Object.entries(buckets).map(([k, b]) => {
          const pct = grandTotal > 0 ? (b.total / grandTotal) * 100 : 0;
          return (
            <div key={k} style={{ padding: 16, background: b.bg, border: `1px solid ${b.color}30`, borderRadius: 12 }}>
              <div style={{ fontSize: 11, color: T.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>{b.label}</div>
              <div style={{ fontSize: 20, fontWeight: 800, fontFamily: "monospace", color: b.color }}>{fmtBaht(b.total)}</div>
              <div style={{ fontSize: 11, color: T.sub, marginTop: 4 }}>{b.items.length} ใบ · {pct.toFixed(1)}%</div>
            </div>
          );
        })}
      </div>

      {customerFilter === "ทั้งหมด" ? (
        <>
          {/* ลูกค้าที่ค้างชำระ */}
          <CardBox style={{ padding: 0, overflow: "hidden", marginBottom: 16 }}>
            <div style={{ padding: "10px 16px", background: "rgba(241,243,246,0.6)", borderBottom: `1px solid ${T.border}`, fontSize: 12, fontWeight: 700, color: T.text }}>👥 สรุปตามลูกค้า ({byCustomer.length} ราย) <span style={{ fontSize: 10, color: T.muted, fontWeight: 400, marginLeft: 6 }}>คลิกชื่อเพื่อดูรายละเอียด</span></div>
            <div style={{ display: "grid", gridTemplateColumns: "1.5fr 60px 100px 100px 100px 100px 100px 90px", padding: "8px 16px", background: "#f8f9fb", fontSize: 10, color: T.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", borderBottom: `1px solid ${T.border}` }}>
              <div>ลูกค้า</div><div style={{textAlign:"right"}}>ใบ</div><div style={{textAlign:"right"}}>0-30</div><div style={{textAlign:"right"}}>31-60</div><div style={{textAlign:"right"}}>61-90</div><div style={{textAlign:"right"}}>90+</div><div style={{textAlign:"right"}}>รวม</div><div style={{textAlign:"center"}}>ค้างนานสุด</div>
            </div>
            {byCustomer.length === 0 ? (
              <div style={{ padding: 30, textAlign: "center", color: T.muted, fontSize: 13 }}>ไม่มีบิลค้างชำระ 🎉</div>
            ) : byCustomer.slice(0, 30).map((c, i) => (
              <div key={i} onClick={() => setCustomerFilter(c.key)}
                style={{ display: "grid", gridTemplateColumns: "1.5fr 60px 100px 100px 100px 100px 100px 90px", alignItems: "center", padding: "9px 16px", borderBottom: i < byCustomer.length-1 ? `1px solid ${T.border}` : "none", fontSize: 12, cursor: "pointer", transition: "background 0.15s" }}
                onMouseEnter={e => e.currentTarget.style.background = "rgba(59,91,139,0.06)"}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                <div>
                  <div style={{ fontWeight: 600, color: T.text }}>{c.name}{c.variants.size > 1 ? <span style={{ marginLeft: 6, fontSize: 9, color: T.accent, fontWeight: 500 }}>+{c.variants.size - 1} variant</span> : null}</div>
                  {c.phone && <div style={{ fontSize: 10, color: T.muted }}>{c.phone}</div>}
                </div>
                <div style={{ textAlign: "right", fontFamily: "monospace", color: T.accent, fontWeight: 600 }}>{c.count}</div>
                <div style={{ textAlign: "right", fontFamily: "monospace", color: c.b030>0?T.green:T.muted }}>{c.b030>0?fmtBaht(c.b030):"—"}</div>
                <div style={{ textAlign: "right", fontFamily: "monospace", color: c.b3160>0?T.amber:T.muted }}>{c.b3160>0?fmtBaht(c.b3160):"—"}</div>
                <div style={{ textAlign: "right", fontFamily: "monospace", color: c.b6190>0?"#d97706":T.muted }}>{c.b6190>0?fmtBaht(c.b6190):"—"}</div>
                <div style={{ textAlign: "right", fontFamily: "monospace", color: c.b90>0?T.red:T.muted, fontWeight: c.b90>0?700:400 }}>{c.b90>0?fmtBaht(c.b90):"—"}</div>
                <div style={{ textAlign: "right", fontFamily: "monospace", fontWeight: 700, color: T.text }}>{fmtBaht(c.total)}</div>
                <div style={{ textAlign: "center", fontSize: 11, fontFamily: "monospace", color: c.oldest>90?T.red:c.oldest>60?"#d97706":c.oldest>30?T.amber:T.green, fontWeight: 600 }}>{c.oldest} วัน</div>
              </div>
            ))}
            {byCustomer.length > 30 && <div style={{ padding: 12, textAlign: "center", color: T.muted, fontSize: 11 }}>แสดง 30/{byCustomer.length} — ดูเต็มได้จาก CSV export</div>}
          </CardBox>

          {/* รายละเอียดบิล 90+ วัน */}
          {buckets["90+"].items.length > 0 && (
            <CardBox style={{ padding: 0, overflow: "hidden", borderColor: T.red }}>
              <div style={{ padding: "10px 16px", background: "rgba(185,74,72,0.08)", borderBottom: `1px solid ${T.border}`, fontSize: 12, fontWeight: 700, color: T.red }}>🚨 บิลค้างเกิน 90 วัน ({buckets["90+"].items.length} ใบ)</div>
              {buckets["90+"].items.slice(0, 15).map((inv, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "110px 1fr 100px 120px 80px", alignItems: "center", padding: "9px 16px", borderBottom: i < buckets["90+"].items.length-1 ? `1px solid ${T.border}` : "none", fontSize: 12 }}>
                  <div style={{ fontFamily: "monospace", color: T.accent, fontWeight: 700 }}>{inv.invoiceNo}</div>
                  <div>{inv.customerName}</div>
                  <div style={{ color: T.sub, fontSize: 11 }}>{(inv.date||"").split(" ")[0]}</div>
                  <div style={{ textAlign: "right", fontFamily: "monospace", fontWeight: 700, color: T.red }}>{fmtBaht(inv.total)}</div>
                  <div style={{ textAlign: "right", fontFamily: "monospace", color: T.red, fontWeight: 700 }}>{inv.days} วัน</div>
                </div>
              ))}
            </CardBox>
          )}
        </>
      ) : (
        // === Single Customer View ===
        <CardBox style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "12px 16px", background: "rgba(59,91,139,0.08)", borderBottom: `1px solid ${T.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>📋 บิลค้างชำระของ {selectedCustomerDisplay?.displayName || customerFilter}</div>
              <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>{customerInvoices.length} ใบ · รวม {fmtBaht(grandTotal)}{selectedCustomerDisplay && selectedCustomerDisplay.variants.size > 1 ? ` · รวมชื่อ ${selectedCustomerDisplay.variants.size} variants: ${Array.from(selectedCustomerDisplay.variants).join(", ")}` : ""}</div>
            </div>
            <button onClick={() => setCustomerFilter("ทั้งหมด")}
              style={{ padding: "6px 12px", borderRadius: 7, border: `1px solid ${T.border}`, background: T.card, color: T.sub, cursor: "pointer", fontSize: 11, fontFamily: "'Sarabun',sans-serif" }}>
              ← กลับไปดูทั้งหมด
            </button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "120px 100px 1fr 100px 130px 100px", padding: "10px 16px", background: "#f8f9fb", fontSize: 10, color: T.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", borderBottom: `1px solid ${T.border}` }}>
            <div>เลขที่บิล</div><div>วันที่</div><div>ประเภท / สถานะ</div><div style={{textAlign:"center"}}>กลุ่ม</div><div style={{textAlign:"right"}}>ยอดบิล</div><div style={{textAlign:"right"}}>ค้าง (วัน)</div>
          </div>
          {customerInvoices.length === 0 ? (
            <div style={{ padding: 30, textAlign: "center", color: T.muted, fontSize: 13 }}>ลูกค้านี้ไม่มีบิลค้างชำระ 🎉</div>
          ) : customerInvoices.map((inv, i) => {
            const bucket = inv.days <= 30 ? "0-30" : inv.days <= 60 ? "31-60" : inv.days <= 90 ? "61-90" : "90+";
            const bucketColor = inv.days <= 30 ? T.green : inv.days <= 60 ? T.amber : inv.days <= 90 ? "#d97706" : T.red;
            return (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "120px 100px 1fr 100px 130px 100px", alignItems: "center", padding: "10px 16px", borderBottom: i < customerInvoices.length-1 ? `1px solid ${T.border}` : "none", fontSize: 12 }}>
                <div style={{ fontFamily: "monospace", color: T.accent, fontWeight: 700 }}>{inv.invoiceNo}</div>
                <div style={{ fontSize: 11, color: T.sub }}>{(inv.date||"").split(" ")[0]}</div>
                <div>
                  <div style={{ color: T.text }}>{inv.docType === "tax" ? "ใบกำกับภาษี" : inv.docType === "quotation" ? "ใบวางบิล" : "ใบเสร็จ"}</div>
                  <div style={{ fontSize: 10, color: T.muted }}>{inv.status || "ออกแล้ว"}</div>
                </div>
                <div style={{ textAlign: "center" }}>
                  <span style={{ padding: "2px 10px", borderRadius: 12, fontSize: 10, fontWeight: 700, background: `${bucketColor}15`, color: bucketColor, border: `1px solid ${bucketColor}30` }}>{bucket}</span>
                </div>
                <div style={{ textAlign: "right", fontFamily: "monospace", fontWeight: 700, color: T.text }}>{fmtBaht(inv.total)}</div>
                <div style={{ textAlign: "right", fontFamily: "monospace", fontWeight: 700, color: bucketColor }}>{inv.days} วัน</div>
              </div>
            );
          })}
          {/* Total row */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 130px 100px", padding: "12px 16px", background: "rgba(185,74,72,0.06)", borderTop: `2px solid ${T.border}`, fontWeight: 800 }}>
            <div style={{ textAlign: "right", fontSize: 13, color: T.text }}>รวมยอดค้างชำระทั้งหมด</div>
            <div style={{ textAlign: "right", fontFamily: "monospace", fontSize: 15, color: T.red }}>{fmtBaht(grandTotal)}</div>
            <div></div>
          </div>
        </CardBox>
      )}
    </div>
  );
}

// ────────── 3. SALES BY CUSTOMER ──────────
function SalesByCustomerTab({ invoices, customers }) {
  const data = useMemo(() => {
    const m = new Map(); // normKey -> {name, phone, count, total, paid, pending, lastDate, variants}
    invoices.forEach(inv => {
      if ((inv.status||"") === "ยกเลิก") return;
      const rawName = inv.customerName || "—";
      const key = normalizeName(rawName);
      if (!m.has(key)) m.set(key, { name: rawName, phone: inv.customerPhone, count: 0, total: 0, paid: 0, pending: 0, lastDate: null, variants: new Set([rawName]) });
      const c = m.get(key);
      c.variants.add(rawName);
      if (!c.phone && inv.customerPhone) c.phone = inv.customerPhone;
      c.count++;
      c.total += Number(inv.total) || 0;
      if (inv.status === "ชำระแล้ว") c.paid += Number(inv.total) || 0;
      else c.pending += Number(inv.total) || 0;
      const d = parseDate(inv.date);
      if (d && (!c.lastDate || d > c.lastDate)) c.lastDate = d;
    });
    return Array.from(m.values()).sort((a,b) => b.total - a.total);
  }, [invoices]);

  const grandTotal = data.reduce((s,c) => s + c.total, 0);
  const topAmount = data[0]?.total || 1;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: T.text }}>👥 ยอดขายต่อลูกค้า</div>
          <div style={{ fontSize: 11, color: T.muted }}>{data.length} ราย · รวม {fmtBaht(grandTotal)}</div>
        </div>
        <button onClick={() => exportCSV(`sales-by-customer-${new Date().toISOString().slice(0,10)}.csv`, data.map(c => ({
          "ลูกค้า": c.name, "เบอร์": c.phone || "", "จำนวนบิล": c.count, "ยอดรวม": c.total.toFixed(2), "ชำระแล้ว": c.paid.toFixed(2), "ค้างชำระ": c.pending.toFixed(2), "วันที่ล่าสุด": c.lastDate ? c.lastDate.toLocaleDateString("th-TH") : "",
        })))} style={{ padding: "7px 14px", borderRadius: 8, border: `1px solid ${T.border}`, background: "rgba(58,122,82,0.1)", color: T.green, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>📊 Export CSV</button>
      </div>

      <CardBox style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "40px 1.5fr 70px 130px 120px 120px 110px", padding: "10px 16px", background: "#f8f9fb", fontSize: 10, color: T.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", borderBottom: `1px solid ${T.border}` }}>
          <div>#</div><div>ลูกค้า</div><div style={{textAlign:"right"}}>บิล</div><div style={{textAlign:"right"}}>ยอดรวม</div><div style={{textAlign:"right"}}>ชำระแล้ว</div><div style={{textAlign:"right"}}>ค้างชำระ</div><div style={{textAlign:"center"}}>ล่าสุด</div>
        </div>
        {data.length === 0 ? (
          <div style={{ padding: 30, textAlign: "center", color: T.muted, fontSize: 13 }}>ยังไม่มีข้อมูล</div>
        ) : data.slice(0, 50).map((c, i) => {
          const pct = (c.total / topAmount) * 100;
          return (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "40px 1.5fr 70px 130px 120px 120px 110px", alignItems: "center", padding: "10px 16px", borderBottom: i < data.length-1 ? `1px solid ${T.border}` : "none", fontSize: 12, position: "relative" }}>
              {/* progress bar background */}
              <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${pct}%`, background: "rgba(59,91,139,0.06)", pointerEvents: "none" }}/>
              <div style={{ fontSize: 11, color: T.muted, fontWeight: 700, position:"relative" }}>{i+1}</div>
              <div style={{position:"relative"}}>
                <div style={{ fontWeight: 600, color: T.text }}>{c.name}{c.variants.size > 1 ? <span style={{ marginLeft: 6, fontSize: 9, color: T.accent, fontWeight: 500 }}>+{c.variants.size - 1} variant</span> : null}</div>
                {c.phone && <div style={{ fontSize: 10, color: T.muted }}>{c.phone}</div>}
              </div>
              <div style={{ textAlign: "right", fontFamily: "monospace", color: T.accent, fontWeight: 600, position:"relative" }}>{c.count}</div>
              <div style={{ textAlign: "right", fontFamily: "monospace", fontWeight: 700, color: T.text, position:"relative" }}>{fmtBaht(c.total)}</div>
              <div style={{ textAlign: "right", fontFamily: "monospace", color: T.green, position:"relative" }}>{c.paid>0?fmtBaht(c.paid):"—"}</div>
              <div style={{ textAlign: "right", fontFamily: "monospace", color: T.amber, position:"relative" }}>{c.pending>0?fmtBaht(c.pending):"—"}</div>
              <div style={{ textAlign: "center", fontSize: 11, color: T.sub, position:"relative" }}>{c.lastDate ? c.lastDate.toLocaleDateString("th-TH") : "—"}</div>
            </div>
          );
        })}
        {data.length > 50 && <div style={{ padding: 12, textAlign: "center", color: T.muted, fontSize: 11 }}>แสดง 50/{data.length} — ดูเต็มได้จาก CSV</div>}
      </CardBox>
    </div>
  );
}

// ────────── 4. SALES BY PRODUCT ──────────
function SalesByProductTab({ transactions, invoices, products }) {
  // จาก transactions (จ่าย) — แยกตามสินค้า
  const fromTx = useMemo(() => {
    const m = new Map();
    transactions.forEach(t => {
      if (t.type !== "จ่าย" || !t.name) return;
      if (!m.has(t.name)) m.set(t.name, { name: t.name, code: t.code, qty: 0, count: 0, category: t.category||"" });
      const r = m.get(t.name);
      r.qty += Number(t.qty) || 0;
      r.count++;
    });
    // เพิ่มราคา/มูลค่าจาก products
    Array.from(m.values()).forEach(r => {
      const p = products.find(pp => pp.name === r.name || pp.code === r.code);
      r.salePrice = Number(p?.salePrice || 0);
      r.costPrice = Number(p?.costPrice || 0);
      r.revenue = r.qty * r.salePrice;
      r.profit = r.qty * (r.salePrice - r.costPrice);
    });
    return Array.from(m.values()).sort((a,b) => b.qty - a.qty);
  }, [transactions, products]);

  const totalQty = fromTx.reduce((s,r) => s + r.qty, 0);
  const totalRevenue = fromTx.reduce((s,r) => s + r.revenue, 0);
  const topQty = fromTx[0]?.qty || 1;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: T.text }}>📦 ยอดขายต่อสินค้า</div>
          <div style={{ fontSize: 11, color: T.muted }}>{fromTx.length} รายการ · จ่ายออกรวม {fmtInt(totalQty)} ชิ้น · รายได้ {fmtBaht(totalRevenue)}</div>
        </div>
        <button onClick={() => exportCSV(`sales-by-product-${new Date().toISOString().slice(0,10)}.csv`, fromTx.map(r => ({
          "รหัส": r.code, "ชื่อสินค้า": r.name, "หมวด": r.category, "จ่ายออก(ชิ้น)": r.qty, "จำนวนครั้ง": r.count, "ราคาขาย": r.salePrice, "ราคาทุน": r.costPrice, "รายได้": r.revenue.toFixed(2), "กำไรประมาณ": r.profit.toFixed(2),
        })))} style={{ padding: "7px 14px", borderRadius: 8, border: `1px solid ${T.border}`, background: "rgba(58,122,82,0.1)", color: T.green, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>📊 Export CSV</button>
      </div>

      <CardBox style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "40px 80px 1fr 90px 80px 110px 110px 110px", padding: "10px 16px", background: "#f8f9fb", fontSize: 10, color: T.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", borderBottom: `1px solid ${T.border}` }}>
          <div>#</div><div>รหัส</div><div>ชื่อสินค้า</div><div style={{textAlign:"right"}}>จ่าย(ชิ้น)</div><div style={{textAlign:"right"}}>ครั้ง</div><div style={{textAlign:"right"}}>ราคาขาย</div><div style={{textAlign:"right"}}>รายได้</div><div style={{textAlign:"right"}}>กำไร</div>
        </div>
        {fromTx.length === 0 ? (
          <div style={{ padding: 30, textAlign: "center", color: T.muted, fontSize: 13 }}>ยังไม่มีรายการจ่ายออก</div>
        ) : fromTx.slice(0, 50).map((r, i) => {
          const pct = (r.qty / topQty) * 100;
          return (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "40px 80px 1fr 90px 80px 110px 110px 110px", alignItems: "center", padding: "10px 16px", borderBottom: i < fromTx.length-1 ? `1px solid ${T.border}` : "none", fontSize: 12, position: "relative" }}>
              <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${pct}%`, background: "rgba(59,91,139,0.06)", pointerEvents: "none" }}/>
              <div style={{ position:"relative", fontSize: 11, color: T.muted, fontWeight: 700 }}>{i+1}</div>
              <div style={{ position:"relative", fontFamily: "monospace", color: T.accent, fontSize: 11 }}>{r.code || "—"}</div>
              <div style={{ position:"relative" }}>
                <div style={{ fontWeight: 600, color: T.text }}>{r.name}</div>
                {r.category && <div style={{ fontSize: 10, color: T.muted }}>{r.category}</div>}
              </div>
              <div style={{ position:"relative", textAlign: "right", fontFamily: "monospace", fontWeight: 700, color: T.red }}>{fmtInt(r.qty)}</div>
              <div style={{ position:"relative", textAlign: "right", fontFamily: "monospace", color: T.sub }}>{r.count}</div>
              <div style={{ position:"relative", textAlign: "right", fontFamily: "monospace", color: T.sub }}>{fmtBaht(r.salePrice)}</div>
              <div style={{ position:"relative", textAlign: "right", fontFamily: "monospace", fontWeight: 700, color: T.green }}>{fmtBaht(r.revenue)}</div>
              <div style={{ position:"relative", textAlign: "right", fontFamily: "monospace", fontWeight: 600, color: r.profit>=0?T.green:T.red }}>{fmtBaht(r.profit)}</div>
            </div>
          );
        })}
        {fromTx.length > 50 && <div style={{ padding: 12, textAlign: "center", color: T.muted, fontSize: 11 }}>แสดง 50/{fromTx.length} — ดูเต็มได้จาก CSV</div>}
      </CardBox>
    </div>
  );
}

// ────────── 5. MONTHLY TREND ──────────
function MonthlyTrendTab() {
  // 📡 ดึงยอดรายเดือนจาก Firestore โดยตรง (aggregate query)
  // เดิมนับจาก invoices/orders ที่โหลดมาในหน่วยความจำ — ซึ่งมีแค่ช่วงเวลาสั้น ๆ
  // ที่ 200-300 ใบ/วัน กราฟย้อนหลัง 12 เดือนจึงผิดหมด (เดือนเก่าขึ้นศูนย์)
  const [stats, setStats] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    setErr("");
    monthlyStats(12)
      .then(rows => { if (alive) setStats(rows.map(r => ({ ...r, label: monthLabel(r.key) }))); })
      .catch(e => { if (alive) setErr(e?.message || String(e)); });
    return () => { alive = false; };
  }, []);

  if (err) return (
    <div style={{ padding: 30, textAlign: "center", background: T.card, border: `1px solid ${T.border}`, borderRadius: 12 }}>
      <div style={{ fontSize: 13, color: T.red, marginBottom: 6 }}>โหลดสถิติไม่สำเร็จ</div>
      <div style={{ fontSize: 11, color: T.muted }}>{err}</div>
    </div>
  );
  if (!stats) return (
    <div style={{ padding: 40, textAlign: "center", color: T.muted, fontSize: 13 }}>⏳ กำลังรวมยอดย้อนหลัง 12 เดือน...</div>
  );

  // index ยังไม่พร้อม → ยอดยังไม่ได้หักบิลที่ยกเลิก ต้องบอก ไม่ปล่อยให้เข้าใจผิด
  const needsIndex = stats.some(s => s.needsIndex);

  const maxRev = Math.max(...stats.map(s => s.revenue), 1);
  const totalRev = stats.reduce((s, x) => s + x.revenue, 0);
  const totalPaid = stats.reduce((s, x) => s + x.paidRevenue, 0);
  const avgMonth = totalRev / 12;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: T.text }}>📈 ยอดขายรายเดือน (12 เดือนล่าสุด)</div>
          <div style={{ fontSize: 11, color: T.muted }}>รวม {fmtBaht(totalRev)} · เฉลี่ย/เดือน {fmtBaht(avgMonth)} · ชำระแล้ว {fmtBaht(totalPaid)} ({totalRev>0?((totalPaid/totalRev)*100).toFixed(0):0}%)</div>
        </div>
        <button onClick={() => exportCSV(`monthly-trend-${new Date().toISOString().slice(0,10)}.csv`, stats.map(s => ({
          "เดือน": s.label, "ใบบิล": s.invoiceCount, "ใบสั่ง": s.orderCount, "ยอดรวม": s.revenue.toFixed(2), "ชำระแล้ว": s.paidRevenue.toFixed(2), "VAT": s.vat.toFixed(2),
        })))} style={{ padding: "7px 14px", borderRadius: 8, border: `1px solid ${T.border}`, background: "rgba(58,122,82,0.1)", color: T.green, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>📊 Export CSV</button>
      </div>

      {needsIndex && (
        <div style={{ padding: "9px 14px", marginBottom: 12, borderRadius: 9, fontSize: 12, lineHeight: 1.7,
          background: "rgba(217,119,6,0.08)", border: "1px solid rgba(217,119,6,0.35)", color: "#b45309" }}>
          ⚠️ ยอดนี้<b>ยังไม่ได้หักบิลที่ยกเลิก</b> และยอด "ชำระแล้ว" ยังไม่ขึ้น<br/>
          เพราะ Firestore ยังไม่มี index สำหรับ <code>invoices (status + createdAt)</code> — เปิด Console (F12) จะเห็นลิงก์สร้าง index กดครั้งเดียวจบ รอสัก 1-2 นาทีแล้วรีเฟรช
        </div>
      )}

      {/* Chart */}
      <CardBox style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 200, padding: "0 8px" }}>
          {stats.map((s, i) => {
            const pct = maxRev > 0 ? (s.revenue / maxRev) * 100 : 0;
            const paidPct = s.revenue > 0 ? (s.paidRevenue / s.revenue) * 100 : 0;
            return (
              <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                <div style={{ fontSize: 9, color: T.muted, fontFamily: "monospace" }}>{s.revenue > 0 ? fmtInt(Math.round(s.revenue/1000)) + "k" : ""}</div>
                <div style={{ width: "100%", height: 160, display: "flex", alignItems: "flex-end", position: "relative" }}>
                  <div style={{ width: "100%", height: `${pct}%`, background: T.accent, borderRadius: "4px 4px 0 0", position: "relative", minHeight: s.revenue > 0 ? 2 : 0, transition: "height 0.4s" }}
                    title={`${s.label}: รายได้ ${fmtBaht(s.revenue)} · ชำระแล้ว ${fmtBaht(s.paidRevenue)}`}>
                    {paidPct > 0 && (
                      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: `${paidPct}%`, background: T.green, borderRadius: "0 0 0 0" }}/>
                    )}
                  </div>
                </div>
                <div style={{ fontSize: 9, color: T.sub, fontFamily: "monospace", textAlign: "center" }}>{s.label}</div>
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 14, marginTop: 12, fontSize: 11, color: T.muted, justifyContent: "center" }}>
          <span><span style={{ display:"inline-block",width:10,height:10,background:T.accent,marginRight:4,verticalAlign:"middle" }}/>ยอดรวม</span>
          <span><span style={{ display:"inline-block",width:10,height:10,background:T.green,marginRight:4,verticalAlign:"middle" }}/>ชำระแล้ว</span>
        </div>
      </CardBox>

      {/* ตาราง */}
      <CardBox style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 80px 80px 130px 130px 110px", padding: "10px 16px", background: "#f8f9fb", fontSize: 10, color: T.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", borderBottom: `1px solid ${T.border}` }}>
          <div>เดือน</div><div style={{textAlign:"right"}}>ใบบิล</div><div style={{textAlign:"right"}}>ใบสั่ง</div><div style={{textAlign:"right"}}>ยอดรวม</div><div style={{textAlign:"right"}}>ชำระแล้ว</div><div style={{textAlign:"right"}}>VAT</div>
        </div>
        {stats.map((s, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 80px 80px 130px 130px 110px", alignItems: "center", padding: "10px 16px", borderBottom: i < stats.length-1 ? `1px solid ${T.border}` : "none", fontSize: 12 }}>
            <div style={{ fontWeight: 600, color: T.text }}>{s.label}</div>
            <div style={{ textAlign: "right", fontFamily: "monospace", color: T.sub }}>{s.invoiceCount}</div>
            <div style={{ textAlign: "right", fontFamily: "monospace", color: T.sub }}>{s.orderCount}</div>
            <div style={{ textAlign: "right", fontFamily: "monospace", fontWeight: 700, color: T.text }}>{fmtBaht(s.revenue)}</div>
            <div style={{ textAlign: "right", fontFamily: "monospace", color: T.green }}>{fmtBaht(s.paidRevenue)}</div>
            <div style={{ textAlign: "right", fontFamily: "monospace", color: T.amber }}>{s.vat>0?fmtBaht(s.vat):"—"}</div>
          </div>
        ))}
      </CardBox>
    </div>
  );
}

// ────────── 6. PROFIT MARGIN ──────────
function ProfitTab({ products, clothingItems }) {
  // จาก products
  const prodList = useMemo(() => products.map(p => {
    const cost = Number(p.costPrice || 0);
    const sale = Number(p.salePrice || 0);
    const margin = sale > 0 ? ((sale - cost) / sale) * 100 : 0;
    const profitPerUnit = sale - cost;
    return { type: "ทั่วไป", code: p.code, name: p.name, qty: Number(p.qty)||0, cost, sale, margin, profitPerUnit, totalProfit: profitPerUnit * Number(p.qty||0) };
  }), [products]);

  // จาก clothing items (รวมทุกสี+ไซส์)
  const clothingList = useMemo(() => {
    const out = [];
    clothingItems.forEach(item => {
      (item.colors||[]).forEach(col => {
        const totalQty = Object.values(col.stock||{}).reduce((s,v) => s+(Number(v)||0), 0);
        const cost = Number(col.costPrice || 0);
        // ใช้ราคา default (reg / kids) เป็นตัวประเมิน
        const sale = Number(col.salePrices?.reg || col.salePrices?.kids || col.salePrice || 0);
        const margin = sale > 0 ? ((sale - cost) / sale) * 100 : 0;
        const profitPerUnit = sale - cost;
        out.push({ type: "เสื้อผ้า", code: item.id?.slice(0,6), name: `${item.model} / ${col.colorName}`, qty: totalQty, cost, sale, margin, profitPerUnit, totalProfit: profitPerUnit * totalQty });
      });
    });
    return out;
  }, [clothingItems]);

  const allList = useMemo(() => [...prodList, ...clothingList].sort((a,b) => b.totalProfit - a.totalProfit), [prodList, clothingList]);

  const totalProfit = allList.reduce((s,r) => s + r.totalProfit, 0);
  const totalCost = allList.reduce((s,r) => s + r.qty * r.cost, 0);
  const totalValue = allList.reduce((s,r) => s + r.qty * r.sale, 0);
  const avgMargin = totalValue > 0 ? ((totalValue - totalCost) / totalValue) * 100 : 0;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: T.text }}>💵 Profit Margin — กำไรต่อสินค้า</div>
          <div style={{ fontSize: 11, color: T.muted }}>กำไรรวม (ถ้าขายหมด) {fmtBaht(totalProfit)} · margin เฉลี่ย {avgMargin.toFixed(1)}%</div>
        </div>
        <button onClick={() => exportCSV(`profit-margin-${new Date().toISOString().slice(0,10)}.csv`, allList.map(r => ({
          "ประเภท": r.type, "รหัส": r.code, "ชื่อ": r.name, "สต็อก": r.qty, "ราคาทุน": r.cost.toFixed(2), "ราคาขาย": r.sale.toFixed(2), "กำไร/ชิ้น": r.profitPerUnit.toFixed(2), "กำไรรวม": r.totalProfit.toFixed(2), "Margin%": r.margin.toFixed(1),
        })))} style={{ padding: "7px 14px", borderRadius: 8, border: `1px solid ${T.border}`, background: "rgba(58,122,82,0.1)", color: T.green, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>📊 Export CSV</button>
      </div>

      {/* Summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 16 }}>
        <div style={{ padding: 14, background: "rgba(59,91,139,0.08)", borderRadius: 10, border: `1px solid ${T.border}` }}>
          <div style={{ fontSize: 10, color: T.muted, fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>มูลค่าทุน</div>
          <div style={{ fontSize: 18, fontWeight: 800, fontFamily: "monospace", color: T.blue }}>{fmtBaht(totalCost)}</div>
        </div>
        <div style={{ padding: 14, background: "rgba(58,122,82,0.08)", borderRadius: 10, border: `1px solid ${T.border}` }}>
          <div style={{ fontSize: 10, color: T.muted, fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>มูลค่าขาย</div>
          <div style={{ fontSize: 18, fontWeight: 800, fontFamily: "monospace", color: T.green }}>{fmtBaht(totalValue)}</div>
        </div>
        <div style={{ padding: 14, background: "rgba(184,134,0,0.08)", borderRadius: 10, border: `1px solid ${T.border}` }}>
          <div style={{ fontSize: 10, color: T.muted, fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>กำไรรวม / Margin</div>
          <div style={{ fontSize: 18, fontWeight: 800, fontFamily: "monospace", color: T.amber }}>{fmtBaht(totalProfit)}</div>
          <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>เฉลี่ย {avgMargin.toFixed(1)}%</div>
        </div>
      </div>

      <CardBox style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "70px 1fr 70px 100px 100px 110px 110px 80px", padding: "10px 16px", background: "#f8f9fb", fontSize: 10, color: T.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", borderBottom: `1px solid ${T.border}` }}>
          <div>ประเภท</div><div>ชื่อ</div><div style={{textAlign:"right"}}>สต็อก</div><div style={{textAlign:"right"}}>ทุน</div><div style={{textAlign:"right"}}>ขาย</div><div style={{textAlign:"right"}}>กำไร/ชิ้น</div><div style={{textAlign:"right"}}>กำไรรวม</div><div style={{textAlign:"right"}}>Margin</div>
        </div>
        {allList.length === 0 ? (
          <div style={{ padding: 30, textAlign: "center", color: T.muted, fontSize: 13 }}>ยังไม่มีข้อมูล</div>
        ) : allList.slice(0, 100).map((r, i) => {
          const marginColor = r.margin >= 30 ? T.green : r.margin >= 15 ? T.amber : r.margin > 0 ? "#d97706" : T.red;
          return (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "70px 1fr 70px 100px 100px 110px 110px 80px", alignItems: "center", padding: "9px 16px", borderBottom: i < allList.length-1 ? `1px solid ${T.border}` : "none", fontSize: 12 }}>
              <div><span style={{ padding: "2px 8px", borderRadius: 10, fontSize: 10, fontWeight: 600, background: r.type === "เสื้อผ้า" ? "rgba(124,58,237,0.1)" : "rgba(59,91,139,0.1)", color: r.type === "เสื้อผ้า" ? "#7c3aed" : T.accent, border: `1px solid ${r.type === "เสื้อผ้า" ? "rgba(124,58,237,0.3)" : "rgba(59,91,139,0.3)"}` }}>{r.type}</span></div>
              <div>
                <div style={{ fontWeight: 600, color: T.text }}>{r.name}</div>
                {r.code && <div style={{ fontSize: 10, color: T.muted, fontFamily: "monospace" }}>{r.code}</div>}
              </div>
              <div style={{ textAlign: "right", fontFamily: "monospace", color: T.sub }}>{r.qty}</div>
              <div style={{ textAlign: "right", fontFamily: "monospace", color: T.muted }}>{r.cost > 0 ? fmtBaht(r.cost) : "—"}</div>
              <div style={{ textAlign: "right", fontFamily: "monospace", color: T.text }}>{r.sale > 0 ? fmtBaht(r.sale) : "—"}</div>
              <div style={{ textAlign: "right", fontFamily: "monospace", fontWeight: 700, color: r.profitPerUnit >= 0 ? T.green : T.red }}>{fmtBaht(r.profitPerUnit)}</div>
              <div style={{ textAlign: "right", fontFamily: "monospace", fontWeight: 700, color: r.totalProfit >= 0 ? T.green : T.red }}>{fmtBaht(r.totalProfit)}</div>
              <div style={{ textAlign: "right", fontFamily: "monospace", fontWeight: 700, color: marginColor }}>{r.sale > 0 ? `${r.margin.toFixed(1)}%` : "—"}</div>
            </div>
          );
        })}
        {allList.length > 100 && <div style={{ padding: 12, textAlign: "center", color: T.muted, fontSize: 11 }}>แสดง 100/{allList.length} — ดูเต็มได้จาก CSV</div>}
      </CardBox>
    </div>
  );
}

// ────────── 7. VAT REPORT ──────────
function VATTab({ invoices }) {
  const [customerFilter, setCustomerFilter] = useState("ทั้งหมด"); // normalized key
  const [customerSearch, setCustomerSearch] = useState("");

  // เฉพาะบิลที่มี VAT
  const allVatInvoices = useMemo(() => invoices.filter(inv => Number(inv.vat||0) > 0 && (inv.status||"") !== "ยกเลิก"), [invoices]);

  // กรองตามลูกค้าที่เลือก
  const vatInvoices = useMemo(() => {
    if (customerFilter === "ทั้งหมด") return allVatInvoices;
    return allVatInvoices.filter(inv => normalizeName(inv.customerName) === customerFilter);
  }, [allVatInvoices, customerFilter]);

  // ลูกค้าทั้งหมดที่มีบิล VAT — รวมชื่อซ้ำ
  const customerOptions = useMemo(() => {
    const map = new Map();
    allVatInvoices.forEach(inv => {
      const rawName = inv.customerName || "—";
      const key = normalizeName(rawName);
      if (!map.has(key)) map.set(key, { key, displayName: rawName, variants: new Set([rawName]), count: 0, vat: 0, total: 0 });
      const c = map.get(key);
      c.variants.add(rawName);
      c.count++;
      c.vat += Number(inv.vat) || 0;
      c.total += Number(inv.total) || 0;
    });
    return Array.from(map.values()).sort((a,b) => b.vat - a.vat);
  }, [allVatInvoices]);

  const filteredCustomerOptions = useMemo(() => {
    const q = (customerSearch || "").trim();
    if (!q) return customerOptions;
    return customerOptions.filter(c => matchTokens(q, c.displayName));
  }, [customerOptions, customerSearch]);

  const selectedCustomerDisplay = useMemo(() => {
    if (customerFilter === "ทั้งหมด") return null;
    return customerOptions.find(c => c.key === customerFilter) || null;
  }, [customerFilter, customerOptions]);

  // รายเดือน (ของบิลที่ผ่าน filter)
  const byMonth = useMemo(() => {
    const m = new Map();
    vatInvoices.forEach(inv => {
      const d = parseDate(inv.date);
      if (!d) return;
      const k = monthKey(d);
      if (!m.has(k)) m.set(k, { key: k, label: monthLabel(k), count: 0, subtotal: 0, vat: 0, total: 0 });
      const r = m.get(k);
      r.count++;
      r.subtotal += Number(inv.subtotal) || 0;
      r.vat      += Number(inv.vat) || 0;
      r.total    += Number(inv.total) || 0;
    });
    return Array.from(m.values()).sort((a,b) => b.key.localeCompare(a.key));
  }, [vatInvoices]);

  const totalVat = byMonth.reduce((s,r) => s + r.vat, 0);
  const totalSubtotal = byMonth.reduce((s,r) => s + r.subtotal, 0);

  const exportVat = () => {
    if (customerFilter === "ทั้งหมด") {
      exportCSV(`vat-report-${new Date().toISOString().slice(0,10)}.csv`, byMonth.map(r => ({
        "เดือน": r.label, "จำนวนใบ": r.count, "ยอดก่อนภาษี": r.subtotal.toFixed(2), "VAT": r.vat.toFixed(2), "ยอดรวม": r.total.toFixed(2),
      })));
    } else {
      exportCSV(`vat-${customerFilter}-${new Date().toISOString().slice(0,10)}.csv`, vatInvoices.map(inv => ({
        "เลขที่บิล": inv.invoiceNo, "วันที่": (inv.date||"").split(" ")[0], "ลูกค้า": inv.customerName, "ยอดก่อนภาษี": Number(inv.subtotal||0).toFixed(2), "VAT": Number(inv.vat||0).toFixed(2), "ยอดรวม": Number(inv.total||0).toFixed(2), "สถานะ": inv.status || "ออกแล้ว",
      })));
    }
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: T.text }}>
            🧾 รายงานภาษีมูลค่าเพิ่ม (VAT)
            {selectedCustomerDisplay && <span style={{ marginLeft: 8, padding: "2px 10px", borderRadius: 12, background: "rgba(184,134,0,0.12)", color: T.amber, fontSize: 12, border: `1px solid rgba(184,134,0,0.3)` }}>👤 {selectedCustomerDisplay.displayName}{selectedCustomerDisplay.variants.size > 1 ? ` (${selectedCustomerDisplay.variants.size} variants)` : ""}</span>}
          </div>
          <div style={{ fontSize: 11, color: T.muted }}>{vatInvoices.length} ใบ · ยอดก่อนภาษีรวม {fmtBaht(totalSubtotal)} · VAT รวม {fmtBaht(totalVat)}</div>
        </div>
        <button onClick={exportVat} style={{ padding: "7px 14px", borderRadius: 8, border: `1px solid ${T.border}`, background: "rgba(58,122,82,0.1)", color: T.green, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>📊 Export CSV</button>
      </div>

      {/* Customer Filter (เหมือน Aging) */}
      {allVatInvoices.length > 0 && (
        <div style={{ marginBottom: 16, padding: 12, background: T.card, border: `1px solid ${T.border}`, borderRadius: 10 }}>
          <div style={{ fontSize: 11, color: T.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>🔍 กรองตามลูกค้า · ชื่อเหมือนกันถูกรวมแล้ว</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <button onClick={() => { setCustomerFilter("ทั้งหมด"); setCustomerSearch(""); }}
              style={{ padding: "6px 14px", borderRadius: 8, border: customerFilter === "ทั้งหมด" ? `1.5px solid ${T.accent}` : `1px solid ${T.border}`, background: customerFilter === "ทั้งหมด" ? "rgba(59,91,139,0.12)" : "transparent", color: customerFilter === "ทั้งหมด" ? T.accent : T.sub, cursor: "pointer", fontSize: 12, fontFamily: "'Sarabun',sans-serif", fontWeight: customerFilter === "ทั้งหมด" ? 700 : 500 }}>
              👥 ทั้งหมด <span style={{ marginLeft: 4, fontSize: 10, opacity: 0.7 }}>({customerOptions.length})</span>
            </button>
            <input value={customerSearch} onChange={e => setCustomerSearch(e.target.value)}
              placeholder="🔍 พิมพ์ชื่อลูกค้า..."
              style={{ flex: 1, minWidth: 200, maxWidth: 280, background: T.input, border: `1px solid ${T.inputBorder}`, color: T.text, borderRadius: 7, padding: "6px 12px", fontFamily: "'Sarabun',sans-serif", fontSize: 12, outline: "none" }}/>
            <select value={customerFilter} onChange={e => setCustomerFilter(e.target.value)}
              style={{ background: T.input, border: `1px solid ${T.inputBorder}`, color: T.text, borderRadius: 7, padding: "7px 10px", fontSize: 12, outline: "none", cursor: "pointer", minWidth: 220 }}>
              <option value="ทั้งหมด">— เลือกลูกค้า —</option>
              {filteredCustomerOptions.map((c, i) => (
                <option key={i} value={c.key}>{c.displayName} ({c.count} ใบ · VAT ฿{Math.round(c.vat).toLocaleString()}){c.variants.size > 1 ? ` · ${c.variants.size} variants` : ""}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {allVatInvoices.length === 0 ? (
        <CardBox>
          <div style={{ padding: 30, textAlign: "center", color: T.muted, fontSize: 13 }}>
            ยังไม่มีบิลที่มี VAT
            <div style={{ fontSize: 11, marginTop: 6 }}>(ติ๊ก VAT 7% ตอนออกบิล แล้วจะเห็นรายงานที่นี่)</div>
          </div>
        </CardBox>
      ) : (
        <>
          {/* Summary */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 16 }}>
            <div style={{ padding: 16, background: T.card, border: `1px solid ${T.border}`, borderRadius: 12 }}>
              <div style={{ fontSize: 10, color: T.muted, fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>ยอดก่อนภาษี</div>
              <div style={{ fontSize: 18, fontWeight: 800, fontFamily: "monospace", color: T.text }}>{fmtBaht(totalSubtotal)}</div>
            </div>
            <div style={{ padding: 16, background: "rgba(184,134,0,0.08)", border: `1px solid ${T.border}`, borderRadius: 12 }}>
              <div style={{ fontSize: 10, color: T.muted, fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>VAT รวม</div>
              <div style={{ fontSize: 18, fontWeight: 800, fontFamily: "monospace", color: T.amber }}>{fmtBaht(totalVat)}</div>
            </div>
            <div style={{ padding: 16, background: "rgba(58,122,82,0.08)", border: `1px solid ${T.border}`, borderRadius: 12 }}>
              <div style={{ fontSize: 10, color: T.muted, fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>ยอดรวม + VAT</div>
              <div style={{ fontSize: 18, fontWeight: 800, fontFamily: "monospace", color: T.green }}>{fmtBaht(totalSubtotal + totalVat)}</div>
            </div>
          </div>

          {customerFilter === "ทั้งหมด" ? (
            <>
              {/* ตารางลูกค้า */}
              <CardBox style={{ padding: 0, overflow: "hidden", marginBottom: 16 }}>
                <div style={{ padding: "10px 16px", background: "rgba(241,243,246,0.6)", borderBottom: `1px solid ${T.border}`, fontSize: 12, fontWeight: 700, color: T.text }}>👥 VAT ตามลูกค้า ({customerOptions.length} ราย) <span style={{ fontSize: 10, color: T.muted, fontWeight: 400, marginLeft: 6 }}>คลิกชื่อเพื่อดูรายละเอียด</span></div>
                <div style={{ display: "grid", gridTemplateColumns: "1.5fr 60px 130px 130px 130px", padding: "8px 16px", background: "#f8f9fb", fontSize: 10, color: T.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", borderBottom: `1px solid ${T.border}` }}>
                  <div>ลูกค้า</div><div style={{textAlign:"right"}}>ใบ</div><div style={{textAlign:"right"}}>ยอดก่อนภาษี</div><div style={{textAlign:"right"}}>VAT</div><div style={{textAlign:"right"}}>รวม</div>
                </div>
                {customerOptions.slice(0, 30).map((c, i) => {
                  const subtotal = c.total - c.vat;
                  return (
                    <div key={i} onClick={() => setCustomerFilter(c.key)}
                      style={{ display: "grid", gridTemplateColumns: "1.5fr 60px 130px 130px 130px", alignItems: "center", padding: "9px 16px", borderBottom: i < customerOptions.length-1 ? `1px solid ${T.border}` : "none", fontSize: 12, cursor: "pointer", transition: "background 0.15s" }}
                      onMouseEnter={e => e.currentTarget.style.background = "rgba(59,91,139,0.06)"}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                      <div style={{ fontWeight: 600, color: T.text }}>{c.displayName}{c.variants.size > 1 ? <span style={{ marginLeft: 6, fontSize: 9, color: T.accent, fontWeight: 500 }}>+{c.variants.size - 1} variant</span> : null}</div>
                      <div style={{ textAlign: "right", fontFamily: "monospace", color: T.accent, fontWeight: 600 }}>{c.count}</div>
                      <div style={{ textAlign: "right", fontFamily: "monospace", color: T.text }}>{fmtBaht(subtotal)}</div>
                      <div style={{ textAlign: "right", fontFamily: "monospace", fontWeight: 700, color: T.amber }}>{fmtBaht(c.vat)}</div>
                      <div style={{ textAlign: "right", fontFamily: "monospace", fontWeight: 700, color: T.green }}>{fmtBaht(c.total)}</div>
                    </div>
                  );
                })}
                {customerOptions.length > 30 && <div style={{ padding: 12, textAlign: "center", color: T.muted, fontSize: 11 }}>แสดง 30/{customerOptions.length} — ดูเต็มได้จาก CSV</div>}
              </CardBox>

              {/* รายเดือน */}
              <CardBox style={{ padding: 0, overflow: "hidden" }}>
                <div style={{ padding: "10px 16px", background: "rgba(241,243,246,0.6)", borderBottom: `1px solid ${T.border}`, fontSize: 12, fontWeight: 700, color: T.text }}>📅 VAT รายเดือน</div>
                <div style={{ display: "grid", gridTemplateColumns: "1.5fr 70px 140px 130px 140px", padding: "8px 16px", background: "#f8f9fb", fontSize: 10, color: T.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", borderBottom: `1px solid ${T.border}` }}>
                  <div>เดือน</div><div style={{textAlign:"right"}}>ใบ</div><div style={{textAlign:"right"}}>ยอดก่อนภาษี</div><div style={{textAlign:"right"}}>VAT</div><div style={{textAlign:"right"}}>รวม</div>
                </div>
                {byMonth.map((r, i) => (
                  <div key={i} style={{ display: "grid", gridTemplateColumns: "1.5fr 70px 140px 130px 140px", alignItems: "center", padding: "10px 16px", borderBottom: i < byMonth.length-1 ? `1px solid ${T.border}` : "none", fontSize: 12 }}>
                    <div style={{ fontWeight: 600, color: T.text }}>{r.label}</div>
                    <div style={{ textAlign: "right", fontFamily: "monospace", color: T.sub }}>{r.count}</div>
                    <div style={{ textAlign: "right", fontFamily: "monospace", color: T.text }}>{fmtBaht(r.subtotal)}</div>
                    <div style={{ textAlign: "right", fontFamily: "monospace", fontWeight: 700, color: T.amber }}>{fmtBaht(r.vat)}</div>
                    <div style={{ textAlign: "right", fontFamily: "monospace", fontWeight: 700, color: T.green }}>{fmtBaht(r.total)}</div>
                  </div>
                ))}
              </CardBox>
            </>
          ) : (
            // === Single Customer VAT view ===
            <CardBox style={{ padding: 0, overflow: "hidden" }}>
              <div style={{ padding: "12px 16px", background: "rgba(184,134,0,0.08)", borderBottom: `1px solid ${T.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>🧾 รายการบิล VAT ของ {selectedCustomerDisplay?.displayName || customerFilter}</div>
                  <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>{vatInvoices.length} ใบ · VAT รวม {fmtBaht(totalVat)}{selectedCustomerDisplay && selectedCustomerDisplay.variants.size > 1 ? ` · รวมชื่อ ${selectedCustomerDisplay.variants.size} variants: ${Array.from(selectedCustomerDisplay.variants).join(", ")}` : ""}</div>
                </div>
                <button onClick={() => setCustomerFilter("ทั้งหมด")}
                  style={{ padding: "6px 12px", borderRadius: 7, border: `1px solid ${T.border}`, background: T.card, color: T.sub, cursor: "pointer", fontSize: 11, fontFamily: "'Sarabun',sans-serif" }}>
                  ← กลับไปดูทั้งหมด
                </button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "120px 100px 1fr 130px 110px 130px", padding: "10px 16px", background: "#f8f9fb", fontSize: 10, color: T.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", borderBottom: `1px solid ${T.border}` }}>
                <div>เลขที่บิล</div><div>วันที่</div><div>ประเภท</div><div style={{textAlign:"right"}}>ยอดก่อนภาษี</div><div style={{textAlign:"right"}}>VAT</div><div style={{textAlign:"right"}}>รวม</div>
              </div>
              {vatInvoices.map((inv, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "120px 100px 1fr 130px 110px 130px", alignItems: "center", padding: "10px 16px", borderBottom: i < vatInvoices.length-1 ? `1px solid ${T.border}` : "none", fontSize: 12 }}>
                  <div style={{ fontFamily: "monospace", color: T.accent, fontWeight: 700 }}>{inv.invoiceNo}</div>
                  <div style={{ fontSize: 11, color: T.sub }}>{(inv.date||"").split(" ")[0]}</div>
                  <div style={{ color: T.text }}>{inv.docType === "tax" ? "ใบกำกับภาษี" : inv.docType === "quotation" ? "ใบวางบิล" : "ใบเสร็จ"}<span style={{ marginLeft: 8, fontSize: 10, color: T.muted }}>{inv.status || "ออกแล้ว"}</span></div>
                  <div style={{ textAlign: "right", fontFamily: "monospace", color: T.text }}>{fmtBaht(inv.subtotal)}</div>
                  <div style={{ textAlign: "right", fontFamily: "monospace", fontWeight: 700, color: T.amber }}>{fmtBaht(inv.vat)}</div>
                  <div style={{ textAlign: "right", fontFamily: "monospace", fontWeight: 700, color: T.green }}>{fmtBaht(inv.total)}</div>
                </div>
              ))}
              {/* Total */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 130px 110px 130px", padding: "12px 16px", background: "rgba(58,122,82,0.06)", borderTop: `2px solid ${T.border}`, fontWeight: 800 }}>
                <div style={{ textAlign: "right", fontSize: 13, color: T.text }}>รวมทั้งสิ้น</div>
                <div style={{ textAlign: "right", fontFamily: "monospace", fontSize: 14, color: T.text }}>{fmtBaht(totalSubtotal)}</div>
                <div style={{ textAlign: "right", fontFamily: "monospace", fontSize: 14, color: T.amber }}>{fmtBaht(totalVat)}</div>
                <div style={{ textAlign: "right", fontFamily: "monospace", fontSize: 15, color: T.green }}>{fmtBaht(totalSubtotal + totalVat)}</div>
              </div>
            </CardBox>
          )}
        </>
      )}
    </div>
  );
}
