// ↩️ รับคืนสินค้า — รายการใบรับคืนทั้งหมด
// กองที่สำคัญที่สุดคือ "รอจับคู่บิล" = ของอยู่ที่ร้านแล้วแต่ยังไม่ได้ลดหนี้ให้ลูกค้า
// จึงดันขึ้นบนสุดและทำให้เห็นชัด ไม่ให้ค้างลืม
import React from "react";
import { T } from "../theme";
import { RETURN_STATUSES, qcStatusOf, needsQC, isCashRefund, norm, matchesTokens } from "../utils/returns";

const money = (n) => Number(n || 0).toLocaleString("th-TH", { minimumFractionDigits: 2 });

const statusStyle = (s) => ({
  "รอจับคู่บิล": { bg: "rgba(245,158,11,0.12)", color: "#b45309", border: "1px solid rgba(245,158,11,0.3)" },
  "จับคู่แล้ว":  { bg: "rgba(16,185,129,0.12)", color: "#047857", border: "1px solid rgba(16,185,129,0.3)" },
  "ยกเลิก":     { bg: "rgba(239,68,68,0.1)",   color: "#b91c1c", border: "1px solid rgba(239,68,68,0.25)" },
}[s] || { bg: "rgba(59,91,139,0.1)", color: T.accent, border: `1px solid ${T.border}` });

export default function ReturnsTab({
  returns = [], role = {}, user,
  onNewReturn, onEditReturn, onCancelReturn, onOpenInvoice, onQcReturn, onCreditNote, onRefundPaid,
}) {
  const [search, setSearch] = React.useState("");
  const [filter, setFilter] = React.useState("ทั้งหมด");

  const list = React.useMemo(() => {
    let l = filter === "ทั้งหมด" ? returns : returns.filter(r => (r.status || RETURN_STATUSES[0]) === filter);
    const q = norm(search);
    if (q) {
      l = l.filter(r => matchesTokens([
        r.returnNo, r.invoiceNo, r.customerName, r.customerPhone, r.trackingNo, r.reason, r.note,
        (r.items || []).map(i => [i.clothingName, i.colorName, i.size].filter(Boolean).join(" ")).join(" "),
      ].filter(Boolean).join(" "), q));
    }
    // รอจับคู่บิลขึ้นก่อนเสมอ แล้วค่อยเรียงตามวันที่รับของ
    return [...l].sort((a, b) => {
      const pa = a.status === "รอจับคู่บิล" ? 0 : 1, pb = b.status === "รอจับคู่บิล" ? 0 : 1;
      if (pa !== pb) return pa - pb;
      return (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0);
    });
  }, [returns, filter, search]);

  const pending = returns.filter(r => r.status === "รอจับคู่บิล");
  const waitingQc = returns.filter(needsQC);
  const waitingQcQty = waitingQc.reduce((a, r) => a + (r.items || []).filter(i => i.restock).reduce((b, i) => b + (Number(i.qty) || 0), 0), 0);
  const pendingQty = pending.reduce((s, r) => s + (Number(r.creditQty) || 0), 0);
  const creditTotal = returns.filter(r => r.status === "จับคู่แล้ว").reduce((s, r) => s + (Number(r.creditTotal) || 0), 0);

  const canEdit = role.canIssueInvoice !== false;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, color: T.text }}>↩️ รับคืนสินค้า</div>
          <div style={{ fontSize: 12, color: T.muted, marginTop: 4 }}>
            ของที่ลูกค้าส่งคืนมา — รับเข้าระบบก่อนได้ แล้วค่อยจับคู่บิลทีหลัง · ทั้งหมด {returns.length} ใบ
          </div>
        </div>
        {canEdit && (
          <button onClick={onNewReturn}
            style={{ padding: "10px 18px", borderRadius: 9, border: "none", background: "linear-gradient(135deg,#d97706,#b45309)", color: "white", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "'Sarabun',sans-serif", boxShadow: "0 4px 14px rgba(217,119,6,0.3)" }}>
            ➕ รับของคืน
          </button>
        )}
      </div>

      {waitingQc.length > 0 && (
        <div style={{ padding: "10px 14px", background: "rgba(59,91,139,0.07)", border: "1px solid rgba(59,91,139,0.3)", borderRadius: 10, marginBottom: 10, fontSize: 12, color: T.accent }}>
          🔍 รอตรวจสภาพ <b>{waitingQc.length}</b> ใบ — ของยังไม่เข้าสต็อกจนกว่าจะกด “ตรวจแล้ว” (จะเข้า <b>{waitingQcQty}</b> ชิ้น)
        </div>
      )}
      {pending.length > 0 && (
        <div style={{ padding: "10px 14px", background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.3)", borderRadius: 10, marginBottom: 14, fontSize: 12, color: "#92400e" }}>
          ⏳ มี <b>{pending.length}</b> ใบที่ยังไม่รู้ว่ามาจากบิลไหน รวม <b>{pendingQty}</b> ชิ้น — ยังไม่ได้ลดหนี้ให้ลูกค้าและยังไม่ได้คืนเข้าสต็อก
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: 14, alignItems: "center", flexWrap: "wrap", padding: 10, background: T.card, borderRadius: 10, border: `1px solid ${T.border}` }}>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="🔍 เลขที่ / ลูกค้า / เลขพัสดุ / ชื่อรุ่น สี ไซส์..."
          style={{ flex: "1 1 240px", padding: "8px 12px", borderRadius: 8, border: `1px solid ${T.border}`, fontSize: 13, fontFamily: "inherit" }}/>
        <select value={filter} onChange={e => setFilter(e.target.value)}
          style={{ padding: "8px 10px", borderRadius: 8, border: `1px solid ${T.border}`, fontSize: 13, fontFamily: "inherit" }}>
          <option value="ทั้งหมด">ทุกสถานะ</option>
          {RETURN_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <div style={{ fontSize: 12, color: T.sub, marginLeft: "auto" }}>
          ลดหนี้รวม <b style={{ fontFamily: "monospace", color: T.green }}>฿{money(creditTotal)}</b>
        </div>
      </div>

      {list.length === 0 ? (
        <div style={{ textAlign: "center", padding: 40, color: T.muted, fontSize: 13 }}>
          {search || filter !== "ทั้งหมด" ? "ไม่พบใบรับคืนที่ตรงกับที่ค้น" : "ยังไม่มีการรับคืนสินค้า"}
        </div>
      ) : list.map(r => {
        const st = statusStyle(r.status);
        const restock = (r.items || []).reduce((s, i) => s + (i.restock ? (Number(i.qty) || 0) : 0), 0);
        return (
          <div key={r.id} style={{ padding: 12, background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, marginBottom: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "baseline" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 13, color: T.accent }}>{r.returnNo}</span>
                <span style={{ padding: "2px 9px", borderRadius: 9, fontSize: 11, fontWeight: 600, background: st.bg, color: st.color, border: st.border }}>{r.status}</span>
                <span style={{ fontSize: 13, color: T.text, fontWeight: 600 }}>{r.customerName || "— ไม่ทราบผู้ส่ง —"}</span>
                {r.customerPhone && <span style={{ fontSize: 11, color: T.muted }}>📞 {r.customerPhone}</span>}
              </div>
              <div style={{ fontSize: 11, color: T.muted, whiteSpace: "nowrap" }}>
                {r.receivedAt || ""} · รับโดย {r.receivedBy || "-"}
              </div>
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 5, margin: "8px 0" }}>
              {(r.items || []).map((it, i) => (
                <span key={i} style={{ padding: "3px 9px", borderRadius: 7, background: it.restock ? "rgba(16,185,129,0.08)" : "rgba(239,68,68,0.07)", border: `1px solid ${it.restock ? "rgba(16,185,129,0.25)" : "rgba(239,68,68,0.2)"}`, fontSize: 11, color: T.text }}>
                  {it.clothingName}{it.colorName ? ` · ${it.colorName}` : ""}{it.size ? ` · ${it.size}` : ""}
                  <b style={{ fontFamily: "monospace" }}> ×{it.qty}</b>
                  <span style={{ color: T.muted, fontSize: 10 }}> · {it.condition}</span>
                </span>
              ))}
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 11, color: T.sub }}>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <span>เหตุผล: {r.reason || "-"}</span>
                {r.trackingNo && <span>📦 {r.trackingNo}</span>}
                {r.invoiceNo
                  ? <button onClick={() => onOpenInvoice?.(r.invoiceId)} style={{ background: "none", border: "none", color: T.accent, cursor: "pointer", fontSize: 11, fontFamily: "inherit", textDecoration: "underline", padding: 0 }}>🧾 {r.invoiceNo}</button>
                  : <span style={{ color: T.amber }}>ยังไม่ผูกกับบิล</span>}
                {qcStatusOf(r) === "ตรวจแล้ว"
                  ? <span style={{ color: T.green }}>✅ ตรวจแล้ว · เข้าสต็อก {restock} ชิ้น</span>
                  : r.status !== "ยกเลิก" && <span style={{ color: T.accent }}>🔍 รอตรวจสภาพ</span>}
                {r.status === "จับคู่แล้ว" && (isCashRefund(r)
                  ? <span style={{ color: r.refundedAt ? T.green : "#b45309", fontWeight: 700 }}>
                      💵 {r.refundedAt ? `จ่ายเงินคืนแล้ว ${(r.refundedAt || "").split(" ")[0]}` : "รอจ่ายเงินคืน"}
                    </span>
                  : <span style={{ color: T.sub }}>📃 {r.appliedStatementNo ? `หักแล้วในใบวางบิล ${r.appliedStatementNo}` : "รอหักในใบวางบิล"}</span>)}
                {(r.images || []).length > 0 && <span>📷 {(r.images || []).length} รูป</span>}
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                {r.status === "จับคู่แล้ว" && (
                  <span style={{ fontSize: 13, fontWeight: 700, color: T.green, fontFamily: "monospace" }}>-฿{money(r.creditTotal)}</span>
                )}
                {canEdit && r.status !== "ยกเลิก" && (
                  <>
                    {needsQC(r) && (
                      <button onClick={() => onQcReturn?.(r)} title="ตรวจสภาพแล้ว → เอาของที่ยังขายต่อได้เข้าสต็อก"
                        style={{ padding: "4px 10px", borderRadius: 7, border: "1px solid rgba(59,91,139,0.4)", background: "rgba(59,91,139,0.1)", color: T.accent, cursor: "pointer", fontSize: 11, fontFamily: "inherit", fontWeight: 700 }}>
                        🔍 ตรวจแล้ว
                      </button>
                    )}
                    {r.status === "จับคู่แล้ว" && isCashRefund(r) && (
                      <button onClick={() => onCreditNote?.(r)} title="ออก/พิมพ์ใบลดหนี้ให้ลูกค้า"
                        style={{ padding: "4px 10px", borderRadius: 7, border: "1px solid rgba(16,185,129,0.4)", background: "rgba(16,185,129,0.1)", color: "#047857", cursor: "pointer", fontSize: 11, fontFamily: "inherit", fontWeight: 700 }}>
                        🧾 ใบลดหนี้{r.creditNoteNo ? ` ${r.creditNoteNo}` : ""}
                      </button>
                    )}
                    {r.status === "จับคู่แล้ว" && isCashRefund(r) && !r.refundedAt && (
                      <button onClick={() => onRefundPaid?.(r)} title="บันทึกว่าจ่ายเงินคืนลูกค้าแล้ว"
                        style={{ padding: "4px 10px", borderRadius: 7, border: "1px solid rgba(217,119,6,0.45)", background: "rgba(217,119,6,0.12)", color: "#b45309", cursor: "pointer", fontSize: 11, fontFamily: "inherit", fontWeight: 700 }}>
                        💵 จ่ายเงินคืนแล้ว
                      </button>
                    )}
                    <button onClick={() => onEditReturn?.(r)} title={r.status === "รอจับคู่บิล" ? "จับคู่บิล" : "แก้ไข"}
                      style={{ padding: "4px 10px", borderRadius: 7, border: `1px solid ${r.status === "รอจับคู่บิล" ? "rgba(245,158,11,0.4)" : T.border}`, background: r.status === "รอจับคู่บิล" ? "rgba(245,158,11,0.1)" : "white", color: r.status === "รอจับคู่บิล" ? "#b45309" : T.sub, cursor: "pointer", fontSize: 11, fontFamily: "inherit", fontWeight: r.status === "รอจับคู่บิล" ? 700 : 400 }}>
                      {r.status === "รอจับคู่บิล" ? "🔗 จับคู่บิล" : "✏️"}
                    </button>
                    {user?.role === "admin" && (
                      <button onClick={() => onCancelReturn?.(r)} title="ยกเลิกใบนี้"
                        style={{ padding: "4px 8px", borderRadius: 7, border: "1px solid rgba(239,68,68,0.25)", background: "rgba(239,68,68,0.06)", color: "#b91c1c", cursor: "pointer", fontSize: 11, fontFamily: "inherit" }}>✕</button>
                    )}
                  </>
                )}
              </div>
            </div>
            {r.note && <div style={{ fontSize: 11, color: T.muted, marginTop: 6 }}>📝 {r.note}</div>}
          </div>
        );
      })}
    </div>
  );
}
