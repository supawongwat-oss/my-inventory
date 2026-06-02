import { T } from "../theme";
import { CardBox } from "../components/ui";

function exportCSV(filename, rows, headers) {
  const bom = "﻿";
  const csv = bom + [headers, ...rows.map(r => headers.map(h => `"${(r[h]||"").toString().replace(/"/g,'""')}"`))].map(r => r.join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function MiniBar({ label, value, max, color, unit = "" }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: 12, color: T.text, fontWeight: 500 }}>{label}</span>
        <span style={{ fontSize: 12, fontFamily: "monospace", fontWeight: 700, color }}>{value.toLocaleString()}{unit}</span>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: "#ffffff", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 3, transition: "width .4s" }} />
      </div>
    </div>
  );
}

export default function ReportsTab({ products, transactions, invoices, orders }) {
  const totalStockValue = products.reduce((s, p) => s + (Number(p.qty) * Number(p.costPrice || 0)), 0);
  const totalSaleValue = products.reduce((s, p) => s + (Number(p.qty) * Number(p.salePrice || 0)), 0);
  const estimatedProfit = totalSaleValue - totalStockValue;

  // รับ/จ่าย 30 วัน
  const now = new Date();
  const days30 = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(now); d.setDate(d.getDate() - (29 - i));
    return d.toLocaleDateString("th-TH", { day: "2-digit", month: "2-digit" });
  });
  const txByDay = {};
  transactions.forEach(t => {
    if (!t.date) return;
    const parts = t.date.split(" ")[0]; // "DD/MM/YYYY"
    const [dd, mm] = parts.split("/");
    const key = `${dd}/${mm}`;
    if (!txByDay[key]) txByDay[key] = { in: 0, out: 0 };
    if (t.type === "รับ") txByDay[key].in += Number(t.qty) || 0;
    else txByDay[key].out += Number(t.qty) || 0;
  });
  const chartData = days30.map(d => ({ d, in: txByDay[d]?.in || 0, out: txByDay[d]?.out || 0 }));
  const maxBar = Math.max(...chartData.map(x => Math.max(x.in, x.out)), 1);

  // Top สินค้า
  const txCount = {};
  transactions.forEach(t => {
    if (!t.name) return;
    txCount[t.name] = (txCount[t.name] || 0) + (Number(t.qty) || 0);
  });
  const topProducts = Object.entries(txCount).sort((a, b) => b[1] - a[1]).slice(0, 5);

  // ยอดบิล
  const invoiceTotal = invoices.reduce((s, inv) => s + (Number(inv.total) || 0), 0);
  const paidTotal = invoices.filter(inv => inv.status === "ชำระแล้ว").reduce((s, inv) => s + (Number(inv.total) || 0), 0);
  const pendingTotal = invoices.filter(inv => inv.status === "รอชำระ" || inv.status === "ออกแล้ว").reduce((s, inv) => s + (Number(inv.total) || 0), 0);

  return (
    <div style={{ animation: "fadeUp 0.4s ease" }}>
      {/* Summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginBottom: 20 }}>
        {[
          { label: "มูลค่าสต็อก (ทุน)", value: `฿${totalStockValue.toLocaleString("th-TH", { minimumFractionDigits: 0 })}`, icon: "📦", color: T.blue },
          { label: "มูลค่าสต็อก (ขาย)", value: `฿${totalSaleValue.toLocaleString("th-TH", { minimumFractionDigits: 0 })}`, icon: "💰", color: T.green },
          { label: "กำไรโดยประมาณ", value: `฿${estimatedProfit.toLocaleString("th-TH", { minimumFractionDigits: 0 })}`, icon: "📈", color: estimatedProfit >= 0 ? T.green : T.red },
          { label: "ยอดบิลทั้งหมด", value: `฿${invoiceTotal.toLocaleString("th-TH", { minimumFractionDigits: 0 })}`, icon: "🧾", color: T.amber },
        ].map((s, i) => (
          <div key={i} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
              <div style={{ fontSize: 11, color: T.sub }}>{s.label}</div>
              <div style={{ fontSize: 18 }}>{s.icon}</div>
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, color: s.color, fontFamily: "monospace" }}>{s.value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        {/* Bar chart 30 วัน */}
        <CardBox>
          <div style={{ fontSize: 13, fontWeight: 600, color: T.text, marginBottom: 14 }}>📊 รับ/จ่ายสินค้า 30 วันล่าสุด</div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 100, overflowX: "auto", paddingBottom: 4 }}>
            {chartData.map((d, i) => (
              <div key={i} style={{ flex: "0 0 auto", display: "flex", flexDirection: "column", alignItems: "center", gap: 1, minWidth: 14 }}>
                <div style={{ width: 6, height: `${(d.in / maxBar) * 90}px`, background: T.green, borderRadius: 2, minHeight: 1 }} title={`รับ ${d.in}`} />
                <div style={{ width: 6, height: `${(d.out / maxBar) * 90}px`, background: T.red, borderRadius: 2, minHeight: 1 }} title={`จ่าย ${d.out}`} />
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 14, marginTop: 8, fontSize: 10, color: T.muted }}>
            <span><span style={{ color: T.green }}>■</span> รับเข้า</span>
            <span><span style={{ color: T.red }}>■</span> จ่ายออก</span>
          </div>
        </CardBox>

        {/* Top สินค้า */}
        <CardBox>
          <div style={{ fontSize: 13, fontWeight: 600, color: T.text, marginBottom: 14 }}>🏆 สินค้าเคลื่อนไหวมากสุด</div>
          {topProducts.length === 0 ? (
            <div style={{ color: T.muted, fontSize: 12, textAlign: "center", padding: 20 }}>ยังไม่มีข้อมูล</div>
          ) : topProducts.map(([name, qty], i) => (
            <MiniBar key={i} label={name.length > 24 ? name.slice(0, 22) + "…" : name} value={qty} max={topProducts[0][1]} color={[T.blue, T.green, T.amber, T.indigo, T.cyan][i]} unit=" ชิ้น" />
          ))}
        </CardBox>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* สถานะบิล */}
        <CardBox>
          <div style={{ fontSize: 13, fontWeight: 600, color: T.text, marginBottom: 14 }}>💳 สถานะการชำระเงิน</div>
          {[
            { label: "ชำระแล้ว", value: paidTotal, color: T.green },
            { label: "รอชำระ / ออกแล้ว", value: pendingTotal, color: T.amber },
            { label: "ยอดรวมทั้งหมด", value: invoiceTotal, color: T.blue },
          ].map((r, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: i < 2 ? `1px solid ${T.border}` : "none" }}>
              <span style={{ fontSize: 13, color: T.sub }}>{r.label}</span>
              <span style={{ fontSize: 14, fontWeight: 700, fontFamily: "monospace", color: r.color }}>฿{r.value.toLocaleString("th-TH", { minimumFractionDigits: 2 })}</span>
            </div>
          ))}
        </CardBox>

        {/* Export */}
        <CardBox>
          <div style={{ fontSize: 13, fontWeight: 600, color: T.text, marginBottom: 14 }}>📥 Export ข้อมูล</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {[
              {
                label: "🗂 สินค้าคงคลัง (.csv)", desc: "รหัส ชื่อ หมวด จำนวน ทุน ขาย สถานะ",
                onClick: () => exportCSV("products.csv",
                  products.map(p => ({ "รหัส": p.code, "ชื่อสินค้า": p.name, "หมวดหมู่": p.category, "จำนวน": p.qty, "หน่วย": p.unit, "ต่ำสุด": p.minQty, "ราคาทุน": p.costPrice || 0, "ราคาขาย": p.salePrice || 0, "ที่เก็บ": p.location || "" })),
                  ["รหัส", "ชื่อสินค้า", "หมวดหมู่", "จำนวน", "หน่วย", "ต่ำสุด", "ราคาทุน", "ราคาขาย", "ที่เก็บ"])
              },
              {
                label: "🔄 ประวัติรับ/จ่าย (.csv)", desc: "วันที่ ประเภท สินค้า จำนวน โดย",
                onClick: () => exportCSV("transactions.csv",
                  transactions.map(t => ({ "วันที่": t.date, "ประเภท": t.type, "สินค้า": t.name, "รหัส": t.code, "จำนวน": t.qty, "โดย": t.by, "หมายเหตุ": t.note || "" })),
                  ["วันที่", "ประเภท", "สินค้า", "รหัส", "จำนวน", "โดย", "หมายเหตุ"])
              },
              {
                label: "🧾 ประวัติบิล (.csv)", desc: "เลขที่ ลูกค้า ยอดรวม สถานะ วันที่",
                onClick: () => exportCSV("invoices.csv",
                  invoices.map(inv => ({ "เลขที่": inv.invoiceNo, "ประเภท": inv.docType, "ลูกค้า": inv.customerName, "เบอร์": inv.customerPhone || "", "ยอดก่อนภาษี": inv.subtotal || 0, "ภาษี": inv.vat || 0, "ยอดรวม": inv.total || 0, "สถานะ": inv.status || "ออกแล้ว", "วันที่": inv.date, "ออกโดย": inv.by })),
                  ["เลขที่", "ประเภท", "ลูกค้า", "เบอร์", "ยอดก่อนภาษี", "ภาษี", "ยอดรวม", "สถานะ", "วันที่", "ออกโดย"])
              },
            ].map((btn, i) => (
              <button key={i} onClick={btn.onClick}
                style={{ padding: "10px 14px", borderRadius: 10, border: `1px solid ${T.border}`, background: "rgba(59,91,139,0.06)", color: T.text, cursor: "pointer", textAlign: "left", fontFamily: "'Sarabun',sans-serif" }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{btn.label}</div>
                <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>{btn.desc}</div>
              </button>
            ))}
          </div>
        </CardBox>
      </div>
    </div>
  );
}
