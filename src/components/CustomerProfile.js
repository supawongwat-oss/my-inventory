import React, { useMemo } from "react";

const fmt = (n) => Number(n || 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtInt = (n) => Number(n || 0).toLocaleString("th-TH");

function dateOf(inv) {
  if (!inv) return null;
  if (inv.date) return new Date(inv.date);
  if (inv.createdAt?.toDate) return inv.createdAt.toDate();
  return null;
}

function monthKey(d) {
  if (!d) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function CustomerProfile({ customer, invoices = [], orders = [], onClose, onNewInvoice }) {
  const c = customer || {};

  const myInvoices = useMemo(
    () => invoices.filter((i) => i.customerId === c.id || i.customerName === c.name),
    [invoices, c.id, c.name]
  );
  const myOrders = useMemo(() => orders.filter((o) => o.customerId === c.id), [orders, c.id]);

  const stats = useMemo(() => {
    const paid = myInvoices.filter((i) => (i.status || "") === "ชำระแล้ว");
    const pending = myInvoices.filter((i) => ["ออกแล้ว", "รอชำระ"].includes(i.status || "ออกแล้ว"));
    const totalSpent = paid.reduce((s, i) => s + Number(i.total || 0), 0);
    const outstanding = pending.reduce((s, i) => s + Number(i.total || 0), 0);
    const avg = myInvoices.length ? myInvoices.reduce((s, i) => s + Number(i.total || 0), 0) / myInvoices.length : 0;

    const sorted = [...myInvoices].sort((a, b) => (dateOf(b)?.getTime() || 0) - (dateOf(a)?.getTime() || 0));
    const lastBuy = sorted[0] ? dateOf(sorted[0]) : null;

    // top products
    const tally = {};
    myInvoices.forEach((inv) => {
      (inv.items || []).forEach((it) => {
        const key = it.name || it.productName || "—";
        tally[key] = (tally[key] || 0) + Number(it.qty || it.quantity || 0);
      });
    });
    const topItems = Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 5);

    // monthly chart (last 6 months)
    const months = {};
    myInvoices.forEach((inv) => {
      const d = dateOf(inv);
      if (!d) return;
      const k = monthKey(d);
      months[k] = (months[k] || 0) + Number(inv.total || 0);
    });
    const sortedMonths = Object.entries(months).sort(([a], [b]) => a.localeCompare(b)).slice(-6);
    const maxM = Math.max(1, ...sortedMonths.map(([, v]) => v));

    return { totalSpent, outstanding, avg, lastBuy, topItems, monthly: sortedMonths, maxM, paidCount: paid.length, pendingCount: pending.length };
  }, [myInvoices]);

  if (!customer) return null;

  const T = { card: "#fff", border: "#e3e8ef", text: "#1f2a44", sub: "#5b6b85", muted: "#8a9bb3", accent: "#3b5b8b" };
  const box = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 14, marginBottom: 12 };
  const label = { fontSize: 11, color: T.muted, marginBottom: 4 };
  const value = { fontSize: 14, color: T.text, fontWeight: 600 };
  const sectionTitle = { fontSize: 13, fontWeight: 700, color: T.accent, marginBottom: 10 };

  const statusColor = (s) => ({
    "ชำระแล้ว": "#16a34a",
    "รอชำระ": "#d97706",
    "ออกแล้ว": "#2563eb",
    "ยกเลิก": "#dc2626",
  }[s || "ออกแล้ว"] || "#6b7280");

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 9999, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: 20, overflowY: "auto" }}>
      <div style={{ background: "#f6f8fb", borderRadius: 16, width: "100%", maxWidth: 720, padding: 20, fontFamily: "'Sarabun',sans-serif" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ width: 56, height: 56, borderRadius: "50%", background: "linear-gradient(135deg,#3b5b8b,#3b5b8b)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, fontWeight: 700 }}>
              {(c.name || "?").charAt(0).toUpperCase()}
            </div>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700, color: T.text }}>{c.name || "-"}</div>
              <div style={{ fontSize: 12, color: T.sub }}>📞 {c.phone || "-"} {c.taxId ? `· เลขผู้เสียภาษี ${c.taxId}` : ""}</div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", fontSize: 22, cursor: "pointer", color: T.muted, padding: 4 }}>✕</button>
        </div>

        {/* Stats */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginBottom: 12 }}>
          <div style={{ ...box, marginBottom: 0 }}>
            <div style={label}>💰 ยอดซื้อรวม (ชำระแล้ว)</div>
            <div style={{ ...value, color: "#16a34a", fontSize: 17 }}>฿{fmt(stats.totalSpent)}</div>
          </div>
          <div style={{ ...box, marginBottom: 0 }}>
            <div style={label}>⏳ ยอดค้างชำระ</div>
            <div style={{ ...value, color: stats.outstanding > 0 ? "#d97706" : T.muted, fontSize: 17 }}>฿{fmt(stats.outstanding)}</div>
          </div>
          <div style={{ ...box, marginBottom: 0 }}>
            <div style={label}>📊 เฉลี่ย/บิล</div>
            <div style={{ ...value, fontSize: 17 }}>฿{fmt(stats.avg)}</div>
          </div>
          <div style={{ ...box, marginBottom: 0 }}>
            <div style={label}>📅 ซื้อล่าสุด</div>
            <div style={{ ...value, fontSize: 13 }}>{stats.lastBuy ? stats.lastBuy.toLocaleDateString("th-TH") : "—"}</div>
          </div>
        </div>

        {/* Quick info */}
        <div style={box}>
          <div style={sectionTitle}>📋 ข้อมูลลูกค้า</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
            <div><div style={label}>ที่อยู่</div><div style={{ ...value, fontSize: 12, fontWeight: 400, color: T.sub }}>{c.address || "—"}</div></div>
            <div><div style={label}>อีเมล</div><div style={{ ...value, fontSize: 12, fontWeight: 400, color: T.sub }}>{c.email || "—"}</div></div>
            <div><div style={label}>จำนวนบิลทั้งหมด</div><div style={value}>{myInvoices.length} ใบ <span style={{ fontSize: 11, color: T.muted, fontWeight: 400 }}>(ชำระ {stats.paidCount} · ค้าง {stats.pendingCount})</span></div></div>
            <div><div style={label}>คำสั่งซื้อ</div><div style={value}>{myOrders.length} ครั้ง</div></div>
          </div>
        </div>

        {/* Monthly chart */}
        {stats.monthly.length > 0 && (
          <div style={box}>
            <div style={sectionTitle}>📈 ยอดซื้อรายเดือน (6 เดือนล่าสุด)</div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 100, padding: "4px 0" }}>
              {stats.monthly.map(([k, v]) => (
                <div key={k} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                  <div style={{ fontSize: 10, color: T.sub }}>฿{fmtInt(Math.round(v))}</div>
                  <div style={{ width: "100%", background: "linear-gradient(180deg,#3b5b8b,#5b7bab)", borderRadius: "6px 6px 0 0", height: `${(v / stats.maxM) * 70}px`, minHeight: 4 }} />
                  <div style={{ fontSize: 10, color: T.muted }}>{k.slice(5)}/{k.slice(2, 4)}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Top products */}
        {stats.topItems.length > 0 && (
          <div style={box}>
            <div style={sectionTitle}>🔥 สินค้าที่ซื้อบ่อย (Top 5)</div>
            {stats.topItems.map(([name, qty], i) => (
              <div key={name} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: i < stats.topItems.length - 1 ? `1px solid ${T.border}` : "none" }}>
                <div style={{ fontSize: 13, color: T.text }}>{i + 1}. {name}</div>
                <div style={{ fontSize: 13, color: T.accent, fontWeight: 600 }}>{fmtInt(qty)} ชิ้น</div>
              </div>
            ))}
          </div>
        )}

        {/* Invoice history */}
        <div style={box}>
          <div style={sectionTitle}>🧾 ประวัติเอกสาร ({myInvoices.length} ใบ)</div>
          {myInvoices.length === 0 ? (
            <div style={{ fontSize: 12, color: T.muted, textAlign: "center", padding: 20 }}>ยังไม่มีประวัติเอกสาร</div>
          ) : (
            <div style={{ maxHeight: 240, overflowY: "auto" }}>
              {[...myInvoices].sort((a, b) => (dateOf(b)?.getTime() || 0) - (dateOf(a)?.getTime() || 0)).map((inv) => (
                <div key={inv.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${T.border}` }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{inv.invoiceNo || "—"}</div>
                    <div style={{ fontSize: 11, color: T.muted }}>{dateOf(inv) ? dateOf(inv).toLocaleDateString("th-TH") : "—"}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>฿{fmt(inv.total)}</div>
                    <div style={{ fontSize: 11, color: statusColor(inv.status), fontWeight: 600 }}>{inv.status || "ออกแล้ว"}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
          {onNewInvoice && (
            <button onClick={() => { onNewInvoice(c); onClose && onClose(); }} style={{ flex: 1, padding: "10px 14px", background: "linear-gradient(135deg,#3b5b8b,#3b5b8b)", color: "#fff", border: 0, borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
              📄 สร้างใบเสร็จใหม่
            </button>
          )}
          {c.phone && (
            <a href={`tel:${c.phone}`} style={{ flex: 1, padding: "10px 14px", background: "#16a34a", color: "#fff", border: 0, borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: "pointer", textAlign: "center", textDecoration: "none", fontFamily: "inherit" }}>
              📞 โทร {c.phone}
            </a>
          )}
          <button onClick={onClose} style={{ padding: "10px 18px", background: "#fff", color: T.sub, border: `1px solid ${T.border}`, borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
            ปิด
          </button>
        </div>
      </div>
    </div>
  );
}
