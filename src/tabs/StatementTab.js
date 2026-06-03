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
              <div key={st.id} style={{ display: "grid", gridTemplateColumns: "120px 1fr 160px 120px 80px 130px 90px", alignItems: "center", padding: "12px 16px", borderBottom: i < filteredStatements.length - 1 ? `1px solid ${T.border}` : "none", transition: "background 0.15s" }}
                onMouseEnter={e => e.currentTarget.style.background = "rgba(59,91,139,0.04)"}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                <div style={{ fontFamily: "monospace", fontSize: 11, color: T.accent, fontWeight: 700 }}>{st.statementNo}</div>
                <div>
                  <div style={{ fontWeight: 600, color: T.text, fontSize: 13 }}>{st.customerName}</div>
                  <div style={{ fontSize: 10, color: T.muted }}>{st.customerPhone || "—"}</div>
                </div>
                <div style={{ fontSize: 11, color: T.sub }}>{st.periodStart} → {st.periodEnd}</div>
                <div style={{ textAlign: "right", fontFamily: "monospace", fontWeight: 700, color: T.green, fontSize: 13 }}>฿{Number(st.totalAmount || 0).toLocaleString("th-TH", { minimumFractionDigits: 2 })}</div>
                <div style={{ textAlign: "center", fontSize: 12, fontFamily: "monospace", color: T.accent, fontWeight: 700 }}>{st.invoiceCount} ใบ</div>
                <div>
                  <select value={st.status || "ออกแล้ว"} onChange={e => handleUpdateStatus(st, e.target.value)}
                    style={{ background: sStyle.bg, border: sStyle.border, borderRadius: 10, padding: "4px 8px", fontSize: 10, fontWeight: 600, color: sStyle.color, cursor: "pointer", fontFamily: "'Sarabun',sans-serif", outline: "none" }}>
                    {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div style={{ display: "flex", gap: 5, justifyContent: "center" }}>
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
    </div>
  );
}

// === Print Layout ===
function StatementPrintLayout({ statement, companyInfo }) {
  return (
    <div id="statement-print-area" style={{ padding: "32px 40px", fontFamily: "'Sarabun',sans-serif", color: "#1e293b", background: "white" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, paddingBottom: 16, borderBottom: "3px solid #3b5b8b" }}>
        <div>
          <div style={{ fontSize: 28, fontWeight: 800, color: "#3b5b8b", letterSpacing: 3, fontFamily: "monospace" }}>{companyInfo?.name || "CPU"}</div>
          {companyInfo?.address && <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{companyInfo.address}</div>}
          {companyInfo?.phone && <div style={{ fontSize: 11, color: "#64748b" }}>📞 {companyInfo.phone}{companyInfo.email && `  ✉ ${companyInfo.email}`}</div>}
          {companyInfo?.taxId && <div style={{ fontSize: 11, color: "#64748b" }}>เลขประจำตัวผู้เสียภาษี: {companyInfo.taxId}</div>}
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#1e293b" }}>ใบวางบิล</div>
          <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6 }}>Statement of Account</div>
          <div style={{ fontSize: 14, color: "#3b5b8b", fontFamily: "monospace", fontWeight: 700 }}>{statement.statementNo}</div>
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>ออกวันที่: {(statement.date || "").split(" ")[0]}</div>
          {statement.dueDate && <div style={{ fontSize: 11, color: "#b94a48", fontWeight: 600 }}>ครบกำหนด: {statement.dueDate}</div>}
        </div>
      </div>

      {/* Customer + period */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20, padding: 14, background: "#f8fafc", borderRadius: 8, border: "1px solid #e2e8f0" }}>
        <div>
          <div style={{ fontSize: 10, color: "#64748b", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>เรียน / Bill To</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#1e293b" }}>{statement.customerName}</div>
          {statement.customerPhone && <div style={{ fontSize: 11, color: "#475569", marginTop: 2 }}>📞 {statement.customerPhone}</div>}
          {statement.customerAddress && <div style={{ fontSize: 11, color: "#475569" }}>📍 {statement.customerAddress}</div>}
          {statement.customerTaxId && <div style={{ fontSize: 11, color: "#475569" }}>เลขประจำตัว: {statement.customerTaxId}</div>}
        </div>
        <div>
          <div style={{ fontSize: 10, color: "#64748b", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>ประจำงวด / Period</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#3b5b8b" }}>{statement.periodStart} ถึง {statement.periodEnd}</div>
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>
            จำนวน {statement.invoiceCount} ใบ · {statement.filterMode === "unpaid" ? "เฉพาะที่ยังไม่ชำระ" : "ทุกบิล"}
          </div>
        </div>
      </div>

      {/* Items table */}
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 18, fontSize: 12 }}>
        <thead>
          <tr style={{ background: "#3b5b8b", color: "white" }}>
            <th style={{ padding: "10px 12px", textAlign: "left", fontWeight: 600, width: 130 }}>เลขที่บิล</th>
            <th style={{ padding: "10px 12px", textAlign: "center", fontWeight: 600, width: 110 }}>วันที่</th>
            <th style={{ padding: "10px 12px", textAlign: "left", fontWeight: 600 }}>ประเภท / สถานะ</th>
            <th style={{ padding: "10px 12px", textAlign: "right", fontWeight: 600, width: 130 }}>ยอดบิล (฿)</th>
          </tr>
        </thead>
        <tbody>
          {(statement.invoicesSnapshot || []).map((inv, i) => (
            <tr key={i} style={{ borderBottom: "1px solid #e2e8f0", background: i % 2 === 0 ? "white" : "#f8fafc" }}>
              <td style={{ padding: "10px 12px", fontFamily: "monospace", fontWeight: 700, color: "#3b5b8b" }}>{inv.invoiceNo}</td>
              <td style={{ padding: "10px 12px", textAlign: "center", color: "#475569" }}>{(inv.date || "").split(" ")[0]}</td>
              <td style={{ padding: "10px 12px", color: "#475569" }}>
                {inv.docType === "tax" ? "ใบกำกับภาษี" : inv.docType === "quotation" ? "ใบวางบิล" : "ใบเสร็จ"}
                <span style={{ marginLeft: 8, fontSize: 10, padding: "2px 8px", borderRadius: 8, background: inv.status === "ชำระแล้ว" ? "#dcfce7" : "#fef3c7", color: inv.status === "ชำระแล้ว" ? "#166534" : "#92400e" }}>{inv.status}</span>
              </td>
              <td style={{ padding: "10px 12px", textAlign: "right", fontFamily: "monospace", fontWeight: 700, color: "#1e293b" }}>{Number(inv.total).toLocaleString("th-TH", { minimumFractionDigits: 2 })}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style={{ background: "#f1f5f9", fontWeight: 800 }}>
            <td colSpan={3} style={{ padding: "12px 12px", textAlign: "right", color: "#1e293b", fontSize: 14 }}>รวมทั้งสิ้น</td>
            <td style={{ padding: "12px 12px", textAlign: "right", fontFamily: "monospace", fontSize: 16, color: "#3a7a52" }}>
              ฿{Number(statement.totalAmount || 0).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
            </td>
          </tr>
        </tfoot>
      </table>

      {/* Note + bank */}
      {statement.note && (
        <div style={{ padding: 12, background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, fontSize: 12, color: "#92400e", marginBottom: 16 }}>
          📝 หมายเหตุ: {statement.note}
        </div>
      )}
      {statement.bankAccount && statement.bankAccount.accountNo && (
        <div style={{ padding: 12, background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 8, fontSize: 12, color: "#075985", marginBottom: 16 }}>
          🏦 ชำระผ่านบัญชี: {statement.bankAccount.bank} · {statement.bankAccount.accountNo} · {statement.bankAccount.accountName}
        </div>
      )}

      {/* Signatures */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 20, marginTop: 40, paddingTop: 20 }}>
        {[{ label: "ผู้รับวางบิล", sub: "(Authorized Receiver)" }, { label: "ผู้วางบิล", sub: "(Issued By)" }, { label: "ผู้รับเงิน", sub: "(Payment Received)" }].map((s, i) => (
          <div key={i} style={{ textAlign: "center" }}>
            <div style={{ borderTop: "1px solid #94a3b8", paddingTop: 6, marginTop: 30 }}>
              <div style={{ fontSize: 11, color: "#475569", fontWeight: 600 }}>{s.label}</div>
              <div style={{ fontSize: 9, color: "#94a3b8" }}>{s.sub}</div>
              <div style={{ fontSize: 9, color: "#94a3b8", marginTop: 4 }}>วันที่ ........................</div>
            </div>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div style={{ marginTop: 20, paddingTop: 10, borderTop: "1px solid #f1f5f9", display: "flex", justifyContent: "space-between", fontSize: 9, color: "#cbd5e1" }}>
        <div>เอกสารออกโดยระบบ CPU ERP · {statement.statementNo}</div>
        <div>ผู้ออกเอกสาร: {statement.by} · {statement.date}</div>
      </div>
    </div>
  );
}
