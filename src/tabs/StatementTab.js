import { useState, useMemo } from "react";
import { db } from "../firebase";
import { collection, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, writeBatch } from "firebase/firestore";
import { T } from "../theme";
import { Modal, MHead, Input, BtnPrimary, BtnGhost, CardBox } from "../components/ui";

// ── helpers ────────────────────────────────────────────────
const pad2 = n => String(n).padStart(2, "0");
const now = () => {
  const d = new Date();
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

// แปลง "DD/MM/YYYY HH:mm" (เก็บเป็น ค.ศ.) → Date
// รองรับทั้ง พ.ศ. และ ค.ศ. — ถ้าปี > 2500 ตีว่า พ.ศ. แล้วลบ 543
const parseDDMMYYYY = (s) => {
  if (!s) return null;
  const datePart = s.split(" ")[0];
  const [d, m, y] = datePart.split("/").map(Number);
  if (!d || !m || !y) return null;
  const year = y > 2500 ? y - 543 : y;
  return new Date(year, m - 1, d);
};

// แปลง yyyy-mm-dd (จาก input type=date) → Date 00:00 local
const parseISODate = (s) => {
  if (!s) return null;
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};

// Date → "DD/MM/YYYY"
const fmtDDMMYYYY = (date) => {
  if (!date) return "";
  return `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}/${date.getFullYear()}`;
};

// Date → "yyyy-mm-dd" (สำหรับ input type=date)
const fmtISO = (date) => {
  if (!date) return "";
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
};

const STATUSES = ["ออกแล้ว", "ส่งแล้ว", "เก็บเงินแล้ว", "ยกเลิก"];
const statusStyle = (s) => ({
  "ออกแล้ว":      { bg: "rgba(59,91,139,0.1)",  color: T.accent, border: "1px solid rgba(59,91,139,0.3)" },
  "ส่งแล้ว":      { bg: "rgba(184,134,0,0.1)",  color: T.amber,  border: "1px solid rgba(184,134,0,0.3)" },
  "เก็บเงินแล้ว": { bg: "rgba(58,122,82,0.1)",  color: T.green,  border: "1px solid rgba(58,122,82,0.3)" },
  "ยกเลิก":       { bg: "rgba(185,74,72,0.1)",  color: T.red,    border: "1px solid rgba(185,74,72,0.3)" },
}[s] || { bg: "rgba(59,91,139,0.1)", color: T.accent, border: `1px solid ${T.border}` });

// ── helper: filter invoices for a statement ────────────────
export const filterInvoicesForStatement = (invoices, customerId, customerName, startDate, endDate, mode) => {
  const startMs = startDate ? startDate.getTime() : -Infinity;
  // endDate ตอนกรอง ให้รวมทั้งวัน (end of day)
  const endMs = endDate ? new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate(), 23, 59, 59).getTime() : Infinity;

  return invoices.filter(inv => {
    // 1) match ลูกค้า
    const sameCustomer = (inv.customerId && inv.customerId === customerId)
      || (!inv.customerId && inv.customerName === customerName);
    if (!sameCustomer) return false;

    // 2) date range
    const d = parseDDMMYYYY(inv.date);
    if (!d) return false;
    const t = d.getTime();
    if (t < startMs || t > endMs) return false;

    // 3) status filter
    const status = inv.status || "ออกแล้ว";
    if (mode === "unpaid" && (status === "ชำระแล้ว" || status === "ยกเลิก")) return false;

    return true;
  });
};

// === Main Component ===
export default function StatementTab({ statements, invoices, customers, companyInfo, user, role, printElementById }) {
  const [showCreate, setShowCreate] = useState(false);
  const [statusFilter, setStatusFilter] = useState("ทั้งหมด");
  const [search, setSearch] = useState("");
  const [printPreview, setPrintPreview] = useState(null); // statement object ที่กำลังพิมพ์
  const [viewStatement, setViewStatement] = useState(null); // statement ที่เปิดดู preview

  // === Form state ของหน้าสร้างใหม่ ===
  const today = new Date();
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const lastOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);

  const [form, setForm] = useState({
    customerId: "",
    customerName: "",
    customerPhone: "",
    customerAddress: "",
    customerTaxId: "",
    customerSearch: "",
    periodStart: fmtISO(firstOfMonth),
    periodEnd: fmtISO(lastOfMonth),
    filterMode: "unpaid",
    dueDate: "",
    note: "",
    bankAccount: null,
    showCompanyTaxId: true, // แสดงเลขผู้เสียภาษีของบริษัทในใบวางบิล
  });

  const resetForm = () => {
    const t = new Date();
    setForm({
      customerId: "", customerName: "", customerPhone: "", customerAddress: "", customerTaxId: "",
      customerSearch: "",
      periodStart: fmtISO(new Date(t.getFullYear(), t.getMonth(), 1)),
      periodEnd:   fmtISO(new Date(t.getFullYear(), t.getMonth() + 1, 0)),
      filterMode: "unpaid",
      dueDate: "", note: "", bankAccount: null,
    });
  };

  // === Live preview ใน modal ===
  const previewInvoices = useMemo(() => {
    if (!form.customerId && !form.customerName) return [];
    return filterInvoicesForStatement(
      invoices, form.customerId, form.customerName,
      parseISODate(form.periodStart), parseISODate(form.periodEnd),
      form.filterMode
    );
  }, [invoices, form.customerId, form.customerName, form.periodStart, form.periodEnd, form.filterMode]);

  const previewTotal = previewInvoices.reduce((s, inv) => s + (Number(inv.total) || 0), 0);

  // === Filtered list ของ statements ที่แสดงในหน้าหลัก ===
  const filteredStatements = statements.filter(st => {
    if (statusFilter !== "ทั้งหมด" && (st.status || "ออกแล้ว") !== statusFilter) return false;
    if (!search) return true;
    const q = search.toLowerCase().trim();
    return (st.statementNo || "").toLowerCase().includes(q)
      || (st.customerName || "").toLowerCase().includes(q);
  });

  // === Customer search dropdown (case-insensitive) ===
  const customerMatches = useMemo(() => {
    const q = (form.customerSearch || "").toLowerCase().trim();
    if (!q) return [];
    return customers.filter(c =>
      (c.name || "").toLowerCase().includes(q)
      || (c.phone || "").toLowerCase().includes(q)
    ).slice(0, 6);
  }, [customers, form.customerSearch]);

  const handleSelectCustomer = (c) => {
    setForm(f => ({
      ...f,
      customerId: c.id,
      customerName: c.name || "",
      customerPhone: c.phone || "",
      customerAddress: c.address || "",
      customerTaxId: c.taxId || "",
      customerSearch: c.name || "",
    }));
  };

  const handleClearCustomer = () => {
    setForm(f => ({ ...f, customerId: "", customerName: "", customerPhone: "", customerAddress: "", customerTaxId: "", customerSearch: "" }));
  };

  // === Quick date pickers ===
  const setQuickRange = (mode) => {
    const t = new Date();
    if (mode === "this") {
      setForm(f => ({ ...f, periodStart: fmtISO(new Date(t.getFullYear(), t.getMonth(), 1)), periodEnd: fmtISO(new Date(t.getFullYear(), t.getMonth() + 1, 0)) }));
    } else if (mode === "last") {
      setForm(f => ({ ...f, periodStart: fmtISO(new Date(t.getFullYear(), t.getMonth() - 1, 1)), periodEnd: fmtISO(new Date(t.getFullYear(), t.getMonth(), 0)) }));
    }
  };

  // === บันทึก statement ===
  const handleSave = async (alsoPrint = false) => {
    if (!form.customerId && !form.customerName) {
      alert("กรุณาเลือกลูกค้า");
      return null;
    }
    if (previewInvoices.length === 0) {
      alert("ไม่มีบิลในช่วงเวลาที่เลือก");
      return null;
    }

    const startD = parseISODate(form.periodStart);
    const endD = parseISODate(form.periodEnd);
    const data = {
      statementNo: "STM-" + Date.now(),
      customerId: form.customerId || "",
      customerName: form.customerName,
      customerPhone: form.customerPhone,
      customerAddress: form.customerAddress,
      customerTaxId: form.customerTaxId,
      periodStart: fmtDDMMYYYY(startD),
      periodEnd: fmtDDMMYYYY(endD),
      invoiceIds: previewInvoices.map(i => i.id),
      invoicesSnapshot: previewInvoices.map(i => ({
        id: i.id, invoiceNo: i.invoiceNo, date: i.date,
        total: Number(i.total) || 0, status: i.status || "ออกแล้ว",
        docType: i.docType || "receipt",
      })),
      totalAmount: previewTotal,
      invoiceCount: previewInvoices.length,
      filterMode: form.filterMode,
      status: "ออกแล้ว",
      dueDate: form.dueDate,
      note: form.note,
      bankAccount: form.bankAccount || null,
      showCompanyTaxId: form.showCompanyTaxId !== false,
      by: user?.name || user?.username || "",
      date: now(),
      createdAt: serverTimestamp(),
    };

    const ref = await addDoc(collection(db, "statements"), data);
    setShowCreate(false);
    resetForm();
    if (alsoPrint) {
      const saved = { ...data, id: ref.id };
      setPrintPreview(saved);
      // รอ DOM render เสร็จก่อน print
      setTimeout(() => {
        if (printElementById) printElementById("statement-print-area");
      }, 200);
    }
    return ref.id;
  };

  // === เปลี่ยนสถานะ statement ===
  const handleUpdateStatus = async (st, newStatus) => {
    await updateDoc(doc(db, "statements", st.id), { status: newStatus });
    // ถ้าเปลี่ยนเป็น "เก็บเงินแล้ว" → ถามว่าจะมาร์คบิลย่อยด้วยไหม
    if (newStatus === "เก็บเงินแล้ว" && st.invoiceIds && st.invoiceIds.length > 0) {
      if (window.confirm(`มาร์คบิลย่อย ${st.invoiceIds.length} ใบเป็น "ชำระแล้ว" ด้วยไหม?`)) {
        const batch = writeBatch(db);
        st.invoiceIds.forEach(invId => {
          batch.update(doc(db, "invoices", invId), { status: "ชำระแล้ว" });
        });
        await batch.commit();
      }
    }
  };

  const handleDelete = async (st) => {
    if (window.confirm(`ลบใบวางบิล ${st.statementNo}?`)) {
      await deleteDoc(doc(db, "statements", st.id));
    }
  };

  const handlePrint = (st) => {
    setPrintPreview(st);
    setTimeout(() => {
      if (printElementById) printElementById("statement-print-area");
    }, 200);
  };

  // ── RENDER ──────────────────────────────────────────────
  return (
    <div style={{ animation: "fadeUp 0.4s ease" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {["ทั้งหมด", ...STATUSES].map(s => {
            const st = statusStyle(s);
            const isAll = s === "ทั้งหมด";
            const active = statusFilter === s;
            const count = isAll ? statements.length : statements.filter(x => (x.status || "ออกแล้ว") === s).length;
            return (
              <button key={s} onClick={() => setStatusFilter(s)}
                style={{
                  padding: "5px 14px", borderRadius: 20, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "'Sarabun',sans-serif",
                  border: active ? (isAll ? `1px solid ${T.accent}` : st.border) : `1px solid ${T.border}`,
                  background: active ? (isAll ? "rgba(59,91,139,0.15)" : st.bg) : "transparent",
                  color: active ? (isAll ? T.accent : st.color) : T.muted,
                }}>
                {s} <span style={{ marginLeft: 4, fontSize: 10, opacity: 0.7 }}>({count})</span>
              </button>
            );
          })}
        </div>
        {role.canIssueInvoice !== false && role.canAdd !== false && (
          <BtnPrimary onClick={() => { resetForm(); setShowCreate(true); }}>＋ สร้างใบวางบิลใหม่</BtnPrimary>
        )}
      </div>

      <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 ค้นหาเลขที่ใบวางบิล หรือชื่อลูกค้า..."
        style={{ width: 320, background: T.input, border: `1px solid ${T.inputBorder}`, color: T.text, borderRadius: 8, padding: "8px 12px", fontFamily: "'Sarabun',sans-serif", fontSize: 13, outline: "none", marginBottom: 14 }} />

      {/* List */}
      {statements.length === 0 ? (
        <div style={{ textAlign: "center", padding: 60, background: T.card, borderRadius: 16, border: `1px solid ${T.border}` }}>
          <div style={{ fontSize: 48, marginBottom: 12, opacity: 0.3 }}>📃</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: T.accent, marginBottom: 6 }}>ยังไม่มีใบวางบิล</div>
          <div style={{ fontSize: 11, color: T.muted }}>กด "＋ สร้างใบวางบิลใหม่" เพื่อรวมยอดบิลของลูกค้า</div>
        </div>
      ) : filteredStatements.length === 0 ? (
        <div style={{ textAlign: "center", padding: 40, color: T.muted, fontSize: 13 }}>ไม่พบใบวางบิลตามเงื่อนไข</div>
      ) : (
        <CardBox style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "120px 1fr 160px 120px 80px 130px 90px", alignItems: "center", padding: "10px 16px", background: "rgba(241,243,246,0.8)", borderBottom: `1px solid ${T.border}`, color: T.muted, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            <div>เลขที่</div><div>ลูกค้า</div><div>ช่วงเวลา</div><div style={{ textAlign: "right" }}>ยอดรวม</div><div style={{ textAlign: "center" }}>บิล</div><div>สถานะ</div><div style={{ textAlign: "center" }}>จัดการ</div>
          </div>
          {filteredStatements.map((st, i) => {
            const sStyle = statusStyle(st.status || "ออกแล้ว");
            return (
              <div key={st.id}
                onClick={() => setViewStatement(st)}
                title="คลิกเพื่อดูรายละเอียด"
                style={{ display: "grid", gridTemplateColumns: "120px 1fr 160px 120px 80px 130px 90px", alignItems: "center", padding: "12px 16px", borderBottom: i < filteredStatements.length - 1 ? `1px solid ${T.border}` : "none", transition: "background 0.15s", cursor: "pointer" }}
                onMouseEnter={e => e.currentTarget.style.background = "rgba(59,91,139,0.08)"}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                <div style={{ fontFamily: "monospace", fontSize: 11, color: T.accent, fontWeight: 700 }}>{st.statementNo}</div>
                <div>
                  <div style={{ fontWeight: 600, color: T.text, fontSize: 13 }}>{st.customerName}</div>
                  <div style={{ fontSize: 10, color: T.muted }}>{st.customerPhone || "—"}</div>
                </div>
                <div style={{ fontSize: 11, color: T.sub }}>{st.periodStart} → {st.periodEnd}</div>
                <div style={{ textAlign: "right", fontFamily: "monospace", fontWeight: 700, color: T.green, fontSize: 13 }}>฿{Number(st.totalAmount || 0).toLocaleString("th-TH", { minimumFractionDigits: 2 })}</div>
                <div style={{ textAlign: "center", fontSize: 12, fontFamily: "monospace", color: T.accent, fontWeight: 700 }}>{st.invoiceCount} ใบ</div>
                <div onClick={e => e.stopPropagation()}>
                  <select value={st.status || "ออกแล้ว"} onChange={e => handleUpdateStatus(st, e.target.value)}
                    style={{ background: sStyle.bg, border: sStyle.border, borderRadius: 10, padding: "4px 8px", fontSize: 10, fontWeight: 600, color: sStyle.color, cursor: "pointer", fontFamily: "'Sarabun',sans-serif", outline: "none" }}>
                    {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div onClick={e => e.stopPropagation()} style={{ display: "flex", gap: 5, justifyContent: "center" }}>
                  <button onClick={() => handlePrint(st)} title="พิมพ์" style={{ padding: "5px 10px", borderRadius: 7, border: "1px solid rgba(59,91,139,0.25)", background: "rgba(59,91,139,0.08)", color: T.accent, cursor: "pointer", fontSize: 11, fontFamily: "'Sarabun',sans-serif" }}>🖨️</button>
                  {role.canDelete && <button onClick={() => handleDelete(st)} title="ลบ" style={{ padding: "5px 8px", borderRadius: 7, border: "1px solid rgba(185,74,72,0.25)", background: "rgba(185,74,72,0.08)", color: T.red, cursor: "pointer", fontSize: 11 }}>✕</button>}
                </div>
              </div>
            );
          })}
        </CardBox>
      )}

      {/* === Modal: สร้างใบวางบิลใหม่ === */}
      {showCreate && (
        <Modal onClose={() => setShowCreate(false)} w={720}>
          <MHead title="📃 สร้างใบวางบิลรวม" sub="รวมยอดบิลของลูกค้าในช่วงเวลาที่กำหนด" onClose={() => setShowCreate(false)} />

          {/* 1. เลือกลูกค้า */}
          <div style={{ marginBottom: 14, position: "relative" }}>
            <label style={{ fontSize: 11, color: T.sub, display: "block", marginBottom: 5, fontWeight: 600 }}>ลูกค้า *</label>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input value={form.customerSearch}
                onChange={e => setForm(f => ({ ...f, customerSearch: e.target.value, customerId: "", customerName: e.target.value }))}
                placeholder="🔍 พิมพ์ชื่อหรือเบอร์ลูกค้า..."
                style={{ flex: 1, background: T.input, border: `1px solid ${T.inputBorder}`, color: T.text, borderRadius: 8, padding: "9px 12px", fontFamily: "'Sarabun',sans-serif", fontSize: 13, outline: "none" }} />
              {form.customerId && <button onClick={handleClearCustomer} style={{ padding: "8px 12px", borderRadius: 8, border: `1px solid ${T.border}`, background: "rgba(185,74,72,0.08)", color: T.red, cursor: "pointer", fontSize: 11 }}>ล้าง</button>}
            </div>
            {form.customerSearch && !form.customerId && customerMatches.length > 0 && (
              <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#ffffff", border: `1px solid ${T.border}`, borderRadius: 10, zIndex: 60, maxHeight: 200, overflowY: "auto", boxShadow: "0 8px 24px rgba(0,0,0,0.15)", marginTop: 4 }}>
                {customerMatches.map(c => (
                  <div key={c.id} onClick={() => handleSelectCustomer(c)} style={{ padding: "10px 14px", cursor: "pointer", borderBottom: `1px solid ${T.border}`, transition: "background 0.15s" }}
                    onMouseEnter={e => e.currentTarget.style.background = "rgba(59,91,139,0.08)"}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{c.name}</div>
                    <div style={{ fontSize: 11, color: T.muted }}>📞 {c.phone || "-"} · 📍 {c.address || "-"}</div>
                  </div>
                ))}
              </div>
            )}
            {form.customerId && (
              <div style={{ marginTop: 6, padding: "6px 12px", background: "rgba(58,122,82,0.06)", borderRadius: 7, fontSize: 11, color: T.green }}>
                ✓ เลือก: {form.customerName} {form.customerPhone && `· ${form.customerPhone}`}
              </div>
            )}
          </div>

          {/* 2. ช่วงเวลา */}
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 11, color: T.sub, display: "block", marginBottom: 5, fontWeight: 600 }}>ช่วงเวลา *</label>
            <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
              <button onClick={() => setQuickRange("this")} style={{ padding: "5px 12px", borderRadius: 6, border: `1px solid ${T.border}`, background: "rgba(59,91,139,0.06)", color: T.accent, fontSize: 11, cursor: "pointer", fontFamily: "'Sarabun',sans-serif", fontWeight: 600 }}>เดือนนี้</button>
              <button onClick={() => setQuickRange("last")} style={{ padding: "5px 12px", borderRadius: 6, border: `1px solid ${T.border}`, background: "rgba(59,91,139,0.06)", color: T.accent, fontSize: 11, cursor: "pointer", fontFamily: "'Sarabun',sans-serif", fontWeight: 600 }}>เดือนที่แล้ว</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Input label="ตั้งแต่" type="date" value={form.periodStart} onChange={e => setForm(f => ({ ...f, periodStart: e.target.value }))} />
              <Input label="ถึง" type="date" value={form.periodEnd} onChange={e => setForm(f => ({ ...f, periodEnd: e.target.value }))} />
            </div>
          </div>

          {/* 3. Filter mode */}
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 11, color: T.sub, display: "block", marginBottom: 5, fontWeight: 600 }}>รวมบิล</label>
            <div style={{ display: "flex", gap: 10 }}>
              {[{ k: "unpaid", l: "เฉพาะที่ยังไม่ชำระ" }, { k: "all", l: "ทุกบิล" }].map(opt => (
                <label key={opt.k} style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 8, border: `1px solid ${form.filterMode === opt.k ? T.accent : T.border}`, background: form.filterMode === opt.k ? "rgba(59,91,139,0.06)" : T.input, cursor: "pointer" }}>
                  <input type="radio" name="filterMode" checked={form.filterMode === opt.k} onChange={() => setForm(f => ({ ...f, filterMode: opt.k }))} />
                  <span style={{ fontSize: 12, color: T.text }}>{opt.l}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Toggle: แสดงเลขผู้เสียภาษีบริษัทในใบวางบิล */}
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "6px 12px", borderRadius: 8, border: `1px solid ${form.showCompanyTaxId !== false ? T.accent : T.border}`, background: form.showCompanyTaxId !== false ? "rgba(59,91,139,0.08)" : "transparent", cursor: "pointer", fontSize: 12 }}>
              <input type="checkbox" checked={form.showCompanyTaxId !== false} onChange={e => setForm(f => ({ ...f, showCompanyTaxId: e.target.checked }))} />
              <span style={{ color: form.showCompanyTaxId !== false ? T.accent : T.sub, fontWeight: form.showCompanyTaxId !== false ? 600 : 400 }}>แสดงเลขผู้เสียภาษีของบริษัทบนใบวางบิล</span>
            </label>
          </div>

          {/* 4. Preview */}
          <div style={{ marginBottom: 14, background: "rgba(241,243,246,0.5)", borderRadius: 10, border: `1px solid ${T.border}`, padding: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: T.text }}>📊 บิลที่จะรวม</span>
              <span style={{ fontSize: 12, color: T.muted }}>{previewInvoices.length} ใบ · รวม ฿{previewTotal.toLocaleString("th-TH", { minimumFractionDigits: 2 })}</span>
            </div>
            {previewInvoices.length === 0 ? (
              <div style={{ textAlign: "center", padding: 16, fontSize: 12, color: T.muted }}>
                {!form.customerName ? "เลือกลูกค้าก่อน" : "ไม่มีบิลในช่วงนี้"}
              </div>
            ) : (
              <div style={{ maxHeight: 180, overflowY: "auto", background: T.card, borderRadius: 7, border: `1px solid ${T.border}` }}>
                {previewInvoices.map((inv, i) => (
                  <div key={inv.id} style={{ display: "grid", gridTemplateColumns: "110px 90px 1fr 100px", alignItems: "center", padding: "7px 12px", borderBottom: i < previewInvoices.length - 1 ? `1px solid ${T.border}` : "none", fontSize: 11 }}>
                    <span style={{ fontFamily: "monospace", color: T.accent, fontWeight: 700 }}>{inv.invoiceNo}</span>
                    <span style={{ color: T.sub }}>{(inv.date || "").split(" ")[0]}</span>
                    <span style={{ color: T.muted, fontSize: 10 }}>{inv.status || "ออกแล้ว"}</span>
                    <span style={{ textAlign: "right", fontFamily: "monospace", color: T.green, fontWeight: 700 }}>฿{Number(inv.total || 0).toLocaleString("th-TH", { minimumFractionDigits: 2 })}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 5. Extra fields */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
            <Input label="กำหนดชำระ" type="date" value={form.dueDate} onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))} />
            <Input label="หมายเหตุ" value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} placeholder="ระบุข้อความเพิ่มเติม..." />
          </div>

          {/* Buttons */}
          <div style={{ display: "flex", gap: 10 }}>
            <BtnGhost onClick={() => setShowCreate(false)} style={{ flex: 1 }}>ยกเลิก</BtnGhost>
            <BtnPrimary onClick={() => handleSave(false)} disabled={previewInvoices.length === 0} style={{ flex: 1 }}>💾 บันทึก</BtnPrimary>
            <BtnPrimary onClick={() => handleSave(true)} disabled={previewInvoices.length === 0} style={{ flex: 1 }}>💾 บันทึก + พิมพ์</BtnPrimary>
          </div>
        </Modal>
      )}

      {/* === Print area (hidden in normal view, only used by iframe print) === */}
      {printPreview && (
        <div style={{ position: "fixed", left: -99999, top: 0, width: 800 }}>
          <StatementPrintLayout statement={printPreview} companyInfo={companyInfo} />
        </div>
      )}

      {/* === Preview Modal — คลิกแถวเพื่อดูรายละเอียด === */}
      {viewStatement && (() => {
        const sStyle = statusStyle(viewStatement.status || "ออกแล้ว");
        return (
          <div onClick={() => setViewStatement(null)}
            style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, backdropFilter: "blur(4px)" }}>
            <div onClick={e => e.stopPropagation()}
              style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, width: "100%", maxWidth: 880, maxHeight: "92vh", display: "flex", flexDirection: "column", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
              {/* Header */}
              <div style={{ padding: "16px 20px", borderBottom: `1px solid ${T.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: T.text }}>📃 {viewStatement.statementNo}</div>
                  <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>ใบวางบิลรวมเดือน · ออกเมื่อ {viewStatement.date}</div>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ padding: "4px 12px", borderRadius: 14, fontSize: 11, fontWeight: 700, background: sStyle.bg, border: sStyle.border, color: sStyle.color }}>{viewStatement.status || "ออกแล้ว"}</span>
                  <button onClick={() => { handlePrint(viewStatement); }}
                    style={{ padding: "7px 14px", borderRadius: 8, border: "1px solid rgba(59,91,139,0.3)", background: "rgba(59,91,139,0.1)", color: T.accent, cursor: "pointer", fontSize: 12, fontFamily: "'Sarabun',sans-serif", fontWeight: 600 }}>🖨️ พิมพ์</button>
                  <button onClick={() => setViewStatement(null)}
                    style={{ padding: "7px 12px", borderRadius: 8, border: `1px solid ${T.border}`, background: "transparent", color: T.sub, cursor: "pointer", fontSize: 13 }}>✕</button>
                </div>
              </div>

              {/* Body */}
              <div style={{ padding: 20, overflow: "auto", flex: 1 }}>
                {/* Customer + Period */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 16 }}>
                  <div style={{ padding: 14, background: "rgba(241,243,246,0.6)", border: `1px solid ${T.border}`, borderRadius: 10 }}>
                    <div style={{ fontSize: 10, color: T.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>👤 ลูกค้า</div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: T.text, marginBottom: 4 }}>{viewStatement.customerName}</div>
                    {viewStatement.customerPhone && <div style={{ fontSize: 12, color: T.sub, marginBottom: 2 }}>📞 {viewStatement.customerPhone}</div>}
                    {viewStatement.customerAddress && <div style={{ fontSize: 12, color: T.sub, marginBottom: 2 }}>📍 {viewStatement.customerAddress}</div>}
                    {viewStatement.customerTaxId && <div style={{ fontSize: 11, color: T.muted, fontFamily: "monospace" }}>เลขผู้เสียภาษี: {viewStatement.customerTaxId}</div>}
                  </div>
                  <div style={{ padding: 14, background: "rgba(241,243,246,0.6)", border: `1px solid ${T.border}`, borderRadius: 10 }}>
                    <div style={{ fontSize: 10, color: T.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>📅 ประจำงวด</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: T.accent }}>{viewStatement.periodStart} → {viewStatement.periodEnd}</div>
                    <div style={{ fontSize: 11, color: T.sub, marginTop: 4 }}>{viewStatement.invoiceCount} ใบ · {viewStatement.filterMode === "unpaid" ? "เฉพาะที่ยังไม่ชำระ" : "ทุกบิล"}</div>
                    {viewStatement.dueDate && <div style={{ fontSize: 11, color: T.red, fontWeight: 600, marginTop: 6 }}>⚠️ ครบกำหนด: {viewStatement.dueDate}</div>}
                  </div>
                </div>

                {/* Items table */}
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: T.text, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>📋 รายการบิลที่รวม</div>
                  <div style={{ border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "130px 110px 1fr 130px 130px", padding: "10px 14px", background: "rgba(241,243,246,0.8)", fontSize: 10, color: T.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                      <div>เลขที่บิล</div><div>วันที่</div><div>ประเภท</div><div>สถานะ</div><div style={{ textAlign: "right" }}>ยอดบิล (฿)</div>
                    </div>
                    {(viewStatement.invoicesSnapshot || []).map((inv, i) => {
                      const isLast = i === (viewStatement.invoicesSnapshot || []).length - 1;
                      const isPaid = inv.status === "ชำระแล้ว";
                      const isCancel = inv.status === "ยกเลิก";
                      return (
                        <div key={i} style={{ display: "grid", gridTemplateColumns: "130px 110px 1fr 130px 130px", alignItems: "center", padding: "10px 14px", borderBottom: isLast ? "none" : `1px solid ${T.border}`, background: i % 2 === 0 ? T.card : "rgba(241,243,246,0.3)" }}>
                          <div style={{ fontFamily: "monospace", fontWeight: 700, color: T.accent, fontSize: 12 }}>{inv.invoiceNo}</div>
                          <div style={{ fontSize: 11, color: T.sub }}>{(inv.date || "").split(" ")[0]}</div>
                          <div style={{ fontSize: 11, color: T.sub }}>{inv.docType === "tax" ? "ใบกำกับภาษี" : inv.docType === "quotation" ? "ใบวางบิล" : "ใบเสร็จ"}</div>
                          <div>
                            <span style={{ padding: "2px 10px", borderRadius: 10, fontSize: 10, fontWeight: 600, background: isPaid ? "rgba(58,122,82,0.12)" : isCancel ? "rgba(185,74,72,0.12)" : "rgba(184,134,0,0.12)", color: isPaid ? T.green : isCancel ? T.red : T.amber, border: `1px solid ${isPaid ? "rgba(58,122,82,0.3)" : isCancel ? "rgba(185,74,72,0.3)" : "rgba(184,134,0,0.3)"}` }}>{inv.status}</span>
                          </div>
                          <div style={{ textAlign: "right", fontFamily: "monospace", fontWeight: 700, color: T.text, fontSize: 13 }}>{Number(inv.total).toLocaleString("th-TH", { minimumFractionDigits: 2 })}</div>
                        </div>
                      );
                    })}
                    {/* Total row */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 130px", padding: "12px 14px", background: "rgba(58,122,82,0.08)", borderTop: `2px solid ${T.border}`, fontWeight: 800 }}>
                      <div style={{ textAlign: "right", fontSize: 13, color: T.text }}>รวมทั้งสิ้น</div>
                      <div style={{ textAlign: "right", fontFamily: "monospace", fontSize: 16, color: T.green }}>฿{Number(viewStatement.totalAmount || 0).toLocaleString("th-TH", { minimumFractionDigits: 2 })}</div>
                    </div>
                  </div>
                </div>

                {/* Note */}
                {viewStatement.note && (
                  <div style={{ padding: 12, background: "rgba(184,134,0,0.08)", border: "1px solid rgba(184,134,0,0.25)", borderRadius: 8, fontSize: 12, color: T.amber, marginBottom: 12 }}>
                    📝 <b>หมายเหตุ:</b> {viewStatement.note}
                  </div>
                )}

                {/* Bank account */}
                {viewStatement.bankAccount && viewStatement.bankAccount.accountNo && (
                  <div style={{ padding: 12, background: "rgba(59,91,139,0.08)", border: "1px solid rgba(59,91,139,0.25)", borderRadius: 8, fontSize: 12, color: T.accent, marginBottom: 12 }}>
                    🏦 <b>ชำระผ่านบัญชี:</b> {viewStatement.bankAccount.bank || viewStatement.bankAccount.bankName} · {viewStatement.bankAccount.accountNo} · {viewStatement.bankAccount.accountName}
                  </div>
                )}

                {/* Meta */}
                <div style={{ fontSize: 10, color: T.muted, paddingTop: 12, borderTop: `1px solid ${T.border}`, display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <div>ผู้ออก: {viewStatement.by || "—"}</div>
                  <div>ออกเมื่อ: {viewStatement.date}</div>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// === Print Layout — รายละเอียดเล็กลง + หัวข้อสีดำ ===
function StatementPrintLayout({ statement, companyInfo }) {
  return (
    <div id="statement-print-area" style={{ padding: "20px 28px", fontFamily: "'Sarabun',sans-serif", color: "#000", background: "white" }}>
      {/* Header — เล็กลง */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12, paddingBottom: 8, borderBottom: "2px solid #000" }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#000", letterSpacing: 1.5 }}>{companyInfo?.name || "CPU"}</div>
          {companyInfo?.address && <div style={{ fontSize: 10, color: "#000", marginTop: 2 }}>{companyInfo.address}</div>}
          {companyInfo?.phone && <div style={{ fontSize: 10, color: "#000" }}>โทร: {companyInfo.phone}{companyInfo.email && `  ·  ${companyInfo.email}`}</div>}
          {companyInfo?.taxId && (statement.showCompanyTaxId !== false) && <div style={{ fontSize: 10, color: "#000" }}>เลขประจำตัวผู้เสียภาษี: {companyInfo.taxId}</div>}
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: "#000" }}>ใบวางบิล</div>
          <div style={{ fontSize: 11, color: "#000", fontFamily: "monospace", fontWeight: 700, marginTop: 2 }}>{statement.statementNo}</div>
          <div style={{ fontSize: 10, color: "#000", marginTop: 2 }}>ออกวันที่: {(statement.date || "").split(" ")[0]}</div>
          {statement.dueDate && <div style={{ fontSize: 10, color: "#000", fontWeight: 700 }}>ครบกำหนด: {statement.dueDate}</div>}
        </div>
      </div>

      {/* Customer + period — เล็กลง */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12, padding: 10, background: "#f1f5f9", borderRadius: 6, border: "1px solid #000" }}>
        <div>
          <div style={{ fontSize: 9, color: "#000", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 2 }}>เรียน / Bill To</div>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#000" }}>{statement.customerName}</div>
          {statement.customerPhone && <div style={{ fontSize: 10, color: "#000" }}>โทร: {statement.customerPhone}</div>}
          {statement.customerAddress && <div style={{ fontSize: 10, color: "#000" }}>{statement.customerAddress}</div>}
          {statement.customerTaxId && <div style={{ fontSize: 10, color: "#000" }}>เลขประจำตัว: {statement.customerTaxId}</div>}
        </div>
        <div>
          <div style={{ fontSize: 9, color: "#000", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 2 }}>ประจำงวด / Period</div>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#000" }}>{statement.periodStart} ถึง {statement.periodEnd}</div>
          <div style={{ fontSize: 10, color: "#000", marginTop: 2 }}>
            จำนวน {statement.invoiceCount} ใบ · {statement.filterMode === "unpaid" ? "เฉพาะที่ยังไม่ชำระ" : "ทุกบิล"}
          </div>
        </div>
      </div>

      {/* Items table — ย่อเล็กมาก */}
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 10, fontSize: 9 }}>
        <thead>
          <tr style={{ background: "#f1f5f9", color: "#000" }}>
            <th style={{ padding: "4px 6px", textAlign: "left", fontWeight: 700, width: 95, border: "1px solid #000", fontSize: 9 }}>เลขที่บิล</th>
            <th style={{ padding: "4px 6px", textAlign: "center", fontWeight: 700, width: 80, border: "1px solid #000", fontSize: 9 }}>วันที่</th>
            <th style={{ padding: "4px 6px", textAlign: "left", fontWeight: 700, border: "1px solid #000", fontSize: 9 }}>ประเภท / สถานะ</th>
            <th style={{ padding: "4px 6px", textAlign: "right", fontWeight: 700, width: 100, border: "1px solid #000", fontSize: 9 }}>ยอดบิล (฿)</th>
          </tr>
        </thead>
        <tbody>
          {(statement.invoicesSnapshot || []).map((inv, i) => (
            <tr key={i} style={{ background: i % 2 === 0 ? "white" : "#f8fafc" }}>
              <td style={{ padding: "4px 6px", fontFamily: "monospace", fontWeight: 700, color: "#000", border: "1px solid #cbd5e1", fontSize: 9 }}>{inv.invoiceNo}</td>
              <td style={{ padding: "4px 6px", textAlign: "center", color: "#000", border: "1px solid #cbd5e1", fontSize: 9 }}>{(inv.date || "").split(" ")[0]}</td>
              <td style={{ padding: "4px 6px", color: "#000", border: "1px solid #cbd5e1", fontSize: 9 }}>
                {inv.docType === "tax" ? "ใบกำกับภาษี" : inv.docType === "quotation" ? "ใบวางบิล" : "ใบเสร็จ"}
                <span style={{ marginLeft: 4, fontSize: 8, padding: "0px 4px", borderRadius: 4, background: inv.status === "ชำระแล้ว" ? "#dcfce7" : "#fef3c7", color: "#000", border: "1px solid #000" }}>{inv.status}</span>
              </td>
              <td style={{ padding: "4px 6px", textAlign: "right", fontFamily: "monospace", fontWeight: 700, color: "#000", border: "1px solid #cbd5e1", fontSize: 10 }}>{Number(inv.total).toLocaleString("th-TH", { minimumFractionDigits: 2 })}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style={{ background: "#f1f5f9", fontWeight: 800 }}>
            <td colSpan={3} style={{ padding: "6px 8px", textAlign: "right", color: "#000", fontSize: 11, border: "2px solid #000" }}>รวมทั้งสิ้น</td>
            <td style={{ padding: "6px 8px", textAlign: "right", fontFamily: "monospace", fontSize: 13, color: "#000", border: "2px solid #000" }}>
              ฿{Number(statement.totalAmount || 0).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
            </td>
          </tr>
        </tfoot>
      </table>

      {/* Note + bank — เล็กลง */}
      {statement.note && (
        <div style={{ padding: 8, background: "#fffbeb", border: "1px solid #000", borderRadius: 6, fontSize: 11, color: "#000", marginBottom: 10 }}>
          หมายเหตุ: {statement.note}
        </div>
      )}
      {statement.bankAccount && statement.bankAccount.accountNo && (
        <div style={{ padding: 8, background: "#f0f9ff", border: "1px solid #000", borderRadius: 6, fontSize: 11, color: "#000", marginBottom: 10 }}>
          🏦 ชำระผ่านบัญชี: <b>{statement.bankAccount.bank} · {statement.bankAccount.accountNo} · {statement.bankAccount.accountName}</b>
        </div>
      )}

      {/* Signatures — เล็กลง */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginTop: 28, paddingTop: 12 }}>
        {[{ label: "ผู้รับวางบิล" }, { label: "ผู้วางบิล" }, { label: "ผู้รับเงิน" }].map((s, i) => (
          <div key={i} style={{ textAlign: "center" }}>
            <div style={{ borderTop: "1px solid #000", paddingTop: 4, marginTop: 24 }}>
              <div style={{ fontSize: 10, color: "#000", fontWeight: 600 }}>{s.label}</div>
              <div style={{ fontSize: 9, color: "#000", marginTop: 3 }}>วันที่ ........................</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
