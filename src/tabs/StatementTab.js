import { useState, useMemo, useEffect } from "react";
import { db } from "../firebase";
import { collection, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, writeBatch } from "firebase/firestore";
import { T } from "../theme";
import { Modal, MHead, Input, BtnPrimary, BtnGhost, CardBox } from "../components/ui";
import { matchTokens } from "../utils/search";
import { logAudit, AUDIT_ACTIONS } from "../utils/audit";
import { reserveDocNo } from "../utils/docNumber";
import BulkStatementModal from "../components/BulkStatementModal";
import LoadRangeBar from "../components/LoadRangeBar";
import LinkInvoiceCustomers from "../components/LinkInvoiceCustomers";
import { filterInvoicesForStatement, creditsForStatement, sumCredits, nearMissInvoices, paidOf, dueOf, statementedInvoiceIds, statementOfInvoice, parseDDMMYYYY } from "../utils/statement";
import { snapshotReturnItems, returnItemsText } from "../utils/returns";

// ── helpers ────────────────────────────────────────────────
const pad2 = n => String(n).padStart(2, "0");
const now = () => {
  const d = new Date();
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
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

// 📃 การคัดบิลเข้าใบวางบิลย้ายไปอยู่ที่ utils/statement.js แล้ว — หน้านี้กับหน้าออกทั้งเดือน
//    ต้องใช้ตัวเดียวกัน ไม่งั้นสองหน้าให้คนละคำตอบ (ของเดิมที่นี่เทียบชื่อเป๊ะ ๆ บิลจึงหาย
//    และไม่กันบิลที่ถูกรวมเข้าบิลใหม่แล้ว ยอดเลยซ้ำ)

// === Main Component ===
export default function StatementTab({ statements, invoices, returns = [], customers, companyInfo, user, role, printElementById,
  invoicesRange, setInvoicesRange, invoicesCapped }) {
  const [showCreate, setShowCreate] = useState(false);
  const [showBulk, setShowBulk] = useState(false); // 📅 ออกใบวางบิลทั้งเดือนทีเดียว
  // 🖨️ พิมพ์หลายใบรวดเดียว — ออกทั้งเดือนทีนึงได้ 47 ใบ กดพิมพ์ทีละใบไม่ไหว
  const [showBulkPrint, setShowBulkPrint] = useState(false);
  const [bulkPrintRows, setBulkPrintRows] = useState(null);   // ใบที่กำลังพิมพ์ (ค้างไว้ให้ iframe อ่าน)
  const [bpFrom, setBpFrom] = useState(() => { const d = new Date(); return fmtISO(new Date(d.getFullYear(), d.getMonth(), 1)); });
  const [bpTo, setBpTo] = useState(() => { const d = new Date(); return fmtISO(new Date(d.getFullYear(), d.getMonth() + 1, 0)); });
  const [showLink, setShowLink] = useState(false); // 🔗 ซ่อมบิลที่ไม่ผูกทะเบียนลูกค้า
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
    // 🏢 ชื่อบริษัทแสดงเสมอ · ที่เหลือปิดไว้ก่อน เปิดเองได้ตอนสร้างใบ
    showCompanyAddress: false,
    showCompanyPhone: false,
    showCompanyTaxId: false,
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

  // บิลชื่อใกล้เคียงที่คนกด "รวมด้วย" เอง — ต้องประกาศก่อน nearMiss ที่ใช้มัน
  const [includedNearIds, setIncludedNearIds] = useState(() => new Set());

  // === Live preview ใน modal ===
  // 🚫 บิลที่อยู่ในใบวางบิลใบอื่นแล้ว — ตัดออกก่อน ไม่ให้ทวงซ้ำ
  //    เคสจริง: วางบิลไปเมื่อวาน วันนี้ลูกค้าสั่งเพิ่ม แล้วออกใบใหม่ช่วงเดิม
  //    ถ้าไม่ตัด บิลของเมื่อวานจะโดนดึงกลับมาอีกรอบ ลูกค้าจ่ายซ้ำ
  const usedIds = useMemo(() => statementedInvoiceIds(statements), [statements]);
  // ตัวที่ตัดออกเพราะวางบิลไปแล้ว — ต้องเอาไปโชว์ ไม่ให้ยอดหายไปเฉย ๆ โดยไม่มีคำอธิบาย
  const [includedUsedIds, setIncludedUsedIds] = useState(new Set());

  const previewAll = useMemo(() => {
    if (!form.customerId && !form.customerName) return [];
    return filterInvoicesForStatement(
      invoices, form.customerId, form.customerName,
      parseISODate(form.periodStart), parseISODate(form.periodEnd),
      form.filterMode, form.customerPhone
    );
  }, [invoices, form.customerId, form.customerName, form.customerPhone, form.periodStart, form.periodEnd, form.filterMode]);

  const alreadyBilled = useMemo(
    () => previewAll.filter(i => usedIds.has(i.id) && !includedUsedIds.has(i.id)),
    [previewAll, usedIds, includedUsedIds]);
  const previewInvoices = useMemo(
    () => previewAll.filter(i => !usedIds.has(i.id) || includedUsedIds.has(i.id)),
    [previewAll, usedIds, includedUsedIds]);

  // ⚠️ บิลที่ "ชื่อใกล้เคียง" แต่ยังไม่มั่นใจพอจะรวมให้เอง
  //    ตัวนี้แหละที่ทำให้ปัญหา "บางบิลหายไป" มองเห็นได้ แทนที่จะหายเงียบ
  //    ไม่รวมให้อัตโนมัติ เพราะวางบิลผิดคน = ทวงเงินผิดคน แย่กว่าตกหล่นแล้วเห็นค้างอยู่
  const nearMiss = useMemo(() => {
    if (!form.customerId && !form.customerName) return [];
    return nearMissInvoices(
      invoices, form.customerId, form.customerName,
      parseISODate(form.periodStart), parseISODate(form.periodEnd),
      form.filterMode, form.customerPhone
    ).filter(inv => !includedNearIds.has(inv.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoices, form.customerId, form.customerName, form.customerPhone, form.periodStart, form.periodEnd, form.filterMode, includedNearIds]);

  // ☑️ เลือกบิลเองได้ — null = ยังไม่เคยแตะ (เอาทุกใบตามเงื่อนไข)
  //    เก็บเป็น "ใบที่ตัดออก" แทน "ใบที่เลือก" → เปลี่ยนช่วงวันที่แล้วใบใหม่ยังถูกเลือกอัตโนมัติ
  const [excludedIds, setExcludedIds] = useState(new Set());
  // เปลี่ยนลูกค้า/ช่วงเวลา → เริ่มเลือกใหม่ ไม่ให้ค้างของเดิม
  const pickKey = `${form.customerId}|${form.customerName}|${form.periodStart}|${form.periodEnd}|${form.filterMode}`;
  useEffect(() => { setExcludedIds(new Set()); setIncludedNearIds(new Set()); setIncludedUsedIds(new Set()); }, [pickKey]);

  const toggleInvoice = (id) => setExcludedIds(prev => {
    const n = new Set(prev);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

  const pickedInvoices = useMemo(() => {
    const extra = invoices.filter(inv => includedNearIds.has(inv.id));
    return [...previewInvoices, ...extra].filter(inv => !excludedIds.has(inv.id));
  }, [previewInvoices, excludedIds, invoices, includedNearIds]);
  // 💰 เก็บเฉพาะส่วนที่ยังค้าง — บิลที่รับมัดจำมาแล้วต้องไม่ถูกทวงเต็มจำนวน
  const previewGross = pickedInvoices.reduce((s, inv) => s + (Number(inv.total) || 0), 0);
  const previewPaid = pickedInvoices.reduce((s, inv) => s + paidOf(inv), 0);
  const previewTotal = pickedInvoices.reduce((s, inv) => s + dueOf(inv), 0);

  // ↩️ ของที่ลูกค้ารายนี้คืนมาและยังไม่เคยถูกหักในใบวางบิลใบไหน
  //    เก็บเป็น "ใบที่ตัดออก" เหมือนฝั่งบิล — ใบลดหนี้ที่โผล่มาใหม่จะถูกเลือกให้เองเสมอ
  const previewCredits = useMemo(
    () => creditsForStatement(returns, form.customerId, form.customerName, parseISODate(form.periodEnd), form.customerPhone),
    [returns, form.customerId, form.customerName, form.customerPhone, form.periodEnd]
  );
  const [excludedCredits, setExcludedCredits] = useState(() => new Set());
  useEffect(() => { setExcludedCredits(new Set()); }, [pickKey]);
  const toggleCredit = (id) => setExcludedCredits(prev => {
    const n = new Set(prev);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });
  const pickedCredits = useMemo(
    () => previewCredits.filter(r => !excludedCredits.has(r.id)),
    [previewCredits, excludedCredits]
  );
  const creditTotal = sumCredits(pickedCredits);
  const netTotal = Math.max(0, previewTotal - creditTotal);

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
    const q = (form.customerSearch || "").trim();
    if (!q) return [];
    return customers.filter(c => matchTokens(q, c.name, c.phone)).slice(0, 6);
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
    // 🔢 เลขรันแบบเดียวกับบิล — STM6908-0001 คือใบที่ 1 ของเดือน ส.ค. 2569
    //    ของเดิมเป็น "STM-" + Date.now() (เวลาที่กดสร้างเป็นมิลลิวินาที) อ่านไม่ออก
    //    บอกทางโทรศัพท์ไม่ได้ และดูไม่ออกว่าเป็นใบที่เท่าไหร่ของเดือน บัญชีจึงตรวจไม่ได้ว่าครบไหม
    //    reserveDocNo จองเลขใน transaction → หลายเครื่องกดพร้อมกันก็ไม่ได้เลขซ้ำ
    const statementNo = await reserveDocNo(db, "STM", statements, "statementNo");
    const data = {
      statementNo,
      customerId: form.customerId || "",
      customerName: form.customerName,
      customerPhone: form.customerPhone,
      customerAddress: form.customerAddress,
      customerTaxId: form.customerTaxId,
      periodStart: fmtDDMMYYYY(startD),
      periodEnd: fmtDDMMYYYY(endD),
      invoiceIds: pickedInvoices.map(i => i.id),
      invoicesSnapshot: pickedInvoices.map(i => ({
        id: i.id, invoiceNo: i.invoiceNo, date: i.date,
        total: Number(i.total) || 0, status: i.status || "ออกแล้ว",
        docType: i.docType || "receipt",
        paid: paidOf(i), due: dueOf(i),
      })),
      totalAmount: previewTotal,
      grossTotal: previewGross,
      paidTotal: previewPaid,
      // ↩️ ของที่คืนในงวดนี้ (หรือค้างมาจากงวดก่อน) — netAmount คือยอดที่ต้องเก็บจริง
      creditTotal,
      netAmount: netTotal,
      returnIds: pickedCredits.map(r => r.id),
      returnsSnapshot: pickedCredits.map(r => ({
        id: r.id, returnNo: r.returnNo, invoiceNo: r.invoiceNo || "",
        receivedAt: r.receivedAt || "", reason: r.reason || "",
        qty: Number(r.creditQty) || 0, total: Number(r.creditTotal) || 0,
        // 📦 ของที่คืนมาจริง ๆ — ลูกค้าต้องเทียบได้ว่าหักตรงกับที่คืนไปไหม
        items: snapshotReturnItems(r),
      })),
      invoiceCount: pickedInvoices.length,
      filterMode: form.filterMode,
      status: "ออกแล้ว",
      dueDate: form.dueDate,
      note: form.note,
      bankAccount: form.bankAccount || null,
      showCompanyAddress: form.showCompanyAddress === true,
      showCompanyPhone: form.showCompanyPhone === true,
      showCompanyTaxId: form.showCompanyTaxId === true,
      by: user?.name || user?.username || "",
      date: now(),
      createdAt: serverTimestamp(),
    };

    const ref = await addDoc(collection(db, "statements"), data);
    // ปั๊มใบรับคืนว่าถูกหักในใบวางบิลใบนี้แล้ว
    // ถ้าไม่ปั๊ม ใบเดิมจะถูกหักซ้ำทุกครั้งที่วางบิลรอบถัดไป
    if (pickedCredits.length > 0) {
      try {
        for (let i = 0; i < pickedCredits.length; i += 400) {
          const b = writeBatch(db);
          pickedCredits.slice(i, i + 400).forEach(r =>
            b.update(doc(db, "returns", r.id), {
              appliedStatementId: ref.id, appliedStatementNo: data.statementNo, appliedAt: now(),
            }));
          await b.commit();
        }
      } catch (e) {
        console.warn("[statement] ปั๊มใบรับคืนไม่สำเร็จ:", e?.message || e);
        alert("บันทึกใบวางบิลแล้ว แต่ทำเครื่องหมายใบรับคืนไม่สำเร็จ — ตรวจสอบก่อนวางบิลรอบหน้า ไม่งั้นอาจหักซ้ำ");
      }
    }
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
    const rel = (st.returnIds || []).length;
    const extra = rel > 0
      ? String.fromCharCode(10, 10) + `ใบรับคืน ${rel} ใบที่หักไว้จะถูกปล่อยกลับ ไปหักในใบวางบิลรอบหน้าแทน`
      : "";
    if (!window.confirm(`ลบใบวางบิล ${st.statementNo}?` + extra)) return;
    // ปล่อยก่อนลบ — ถ้าลบเอกสารสำเร็จแต่ปล่อยไม่สำเร็จ ใบลดหนี้จะค้างชี้ไปหาใบที่ไม่มีแล้ว
    if (rel > 0) {
      try {
        for (let i = 0; i < st.returnIds.length; i += 400) {
          const b = writeBatch(db);
          st.returnIds.slice(i, i + 400).forEach(rid =>
            b.update(doc(db, "returns", rid), { appliedStatementId: "", appliedStatementNo: "", appliedAt: "" }));
          await b.commit();
        }
      } catch (e) {
        alert("ปล่อยใบรับคืนไม่สำเร็จ จึงยังไม่ลบใบวางบิล: " + (e?.message || e));
        return;
      }
    }
    await deleteDoc(doc(db, "statements", st.id));
  };

  // ── 📅 รอบวางบิลทั้งเดือน ────────────────────────────────
  // ใบที่ออกพร้อมกันจากหน้า "ออกทั้งเดือน" ถูกปั๊ม bulkRunId ตัวเดียวกันไว้
  // มีไว้เพื่อ "ถอยทั้งรอบ" — กดพลาดทีเดียว 70-80 ใบ ถ้าต้องไล่ลบทีละใบคนจะยอมปล่อยผิดไว้แทน
  const bulkRuns = useMemo(() => {
    const m = new Map();
    statements.forEach(s => {
      if (!s.bulkRunId) return;
      const g = m.get(s.bulkRunId) || { id: s.bulkRunId, at: s.bulkRunAt || s.date || "", items: [] };
      g.items.push(s);
      m.set(s.bulkRunId, g);
    });
    return [...m.values()].sort((a, b) => String(b.id).localeCompare(String(a.id)));
  }, [statements]);

  const [undoBusy, setUndoBusy] = useState(null); // { run, done, total }

  // นับบิลที่ยังไม่ผูกทะเบียนในช่วงที่โหลดมา — ตัวเลขนี้คือจำนวนใบวางบิลที่จะออกมาผิดร้าน
  const unlinkedCount = useMemo(() => invoices.filter(inv =>
    !inv.customerId && !inv.mergedInto && !inv.convertedTo && (inv.customerName || "").trim()).length, [invoices]);

  const undoBulkRun = async (run) => {
    if (undoBusy) return;
    // 💰 ใบที่เก็บเงินแล้วห้ามลบยกชุด — เงินเข้าบัญชีไปแล้ว ต้องไปสะสางทีละใบเอง
    const locked = run.items.filter(s => (s.status || "") === "เก็บเงินแล้ว");
    const targets = run.items.filter(s => (s.status || "") !== "เก็บเงินแล้ว");
    if (targets.length === 0) { alert("รอบนี้เก็บเงินไปหมดแล้ว — ถอยทั้งรอบไม่ได้"); return; }
    const sent = targets.filter(s => (s.status || "") === "ส่งแล้ว").length;
    const amt = targets.reduce((a, s) => a + Number(s.netAmount != null ? s.netAmount : s.totalAmount || 0), 0);
    const rel = targets.reduce((a, s) => a + (s.returnIds || []).length, 0);
    const nl = String.fromCharCode(10);
    if (!window.confirm(
      `ถอยรอบวางบิล ${run.at || run.id}?` + nl + nl +
      `• ลบใบวางบิล ${targets.length} ใบ · ฿${amt.toLocaleString("th-TH", { minimumFractionDigits: 2 })}` + nl +
      (locked.length ? `• ข้าม ${locked.length} ใบที่เก็บเงินแล้ว (ลบไม่ได้)` + nl : "") +
      (rel ? `• ใบรับคืน ${rel} ใบที่หักไว้จะถูกปล่อยกลับ ไปหักรอบหน้าแทน` + nl : "") +
      (sent ? `⚠️ มี ${sent} ใบสถานะ "ส่งแล้ว" — ถ้าส่งกระดาษถึงมือลูกค้าไปแล้ว ต้องแจ้งลูกค้าเอง` + nl : "") +
      nl + `ตัวบิลไม่ถูกแตะ — ยอดและสถานะของบิลคงเดิมทุกใบ`
    )) return;
    if (!window.confirm(`ยืนยันอีกครั้ง — ลบใบวางบิล ${targets.length} ใบ (ลบแล้วเรียกคืนไม่ได้)`)) return;

    setUndoBusy({ run: run.id, done: 0, total: targets.length });
    const fails = [];
    for (let i = 0; i < targets.length; i++) {
      const st = targets[i];
      try {
        // ปล่อยใบรับคืนก่อนลบเสมอ — ถ้าลบสำเร็จแต่ปล่อยพลาด ใบลดหนี้จะค้างชี้ใบที่ไม่มีแล้ว
        const rids = st.returnIds || [];
        for (let k = 0; k < rids.length; k += 400) {
          const b = writeBatch(db);
          rids.slice(k, k + 400).forEach(rid =>
            b.update(doc(db, "returns", rid), { appliedStatementId: "", appliedStatementNo: "", appliedAt: "" }));
          await b.commit();
        }
        await deleteDoc(doc(db, "statements", st.id));
      } catch (e) {
        fails.push(`• ${st.statementNo} — ${e?.message || e}`);
      }
      setUndoBusy({ run: run.id, done: i + 1, total: targets.length });
    }
    setUndoBusy(null);
    logAudit(user, {
      action: AUDIT_ACTIONS.DELETE, collection: "statements", targetId: run.id,
      targetLabel: `ถอยรอบวางบิล ${run.at || run.id}`,
      note: `ลบ ${targets.length - fails.length} ใบ` + (locked.length ? ` · ข้ามที่เก็บเงินแล้ว ${locked.length} ใบ` : ""),
    });
    alert(
      `✅ ถอยแล้ว ${targets.length - fails.length} ใบ` +
      (locked.length ? String.fromCharCode(10) + `ข้ามที่เก็บเงินแล้ว ${locked.length} ใบ` : "") +
      (fails.length ? String.fromCharCode(10, 10) + `❌ ลบไม่สำเร็จ ${fails.length} ใบ:` + String.fromCharCode(10) + fails.slice(0, 8).join(String.fromCharCode(10)) : "")
    );
  };

  const handlePrint = (st) => {
    setPrintPreview(st);
    setTimeout(() => {
      if (printElementById) printElementById("statement-print-area");
    }, 200);
  };

  // 🖨️ ใบวางบิลที่จะพิมพ์รวดเดียว — คัดตาม "วันที่ออกใบวางบิล"
  //    ไม่ใช้ช่วงเวลาที่วางบิล (periodStart/End) เพราะใบที่ออกวันเดียวกันอาจคนละงวด
  //    สิ่งที่คนอยากพิมพ์คือ "ที่ออกไปเมื่อกี้/เมื่อวาน" ซึ่งคือวันที่ออก
  //    ใบที่ยกเลิกไม่เอา — พิมพ์ไปก็ส่งลูกค้าไม่ได้
  const bulkPrintList = useMemo(() => {
    const from = parseISODate(bpFrom), to = parseISODate(bpTo);
    const fromMs = from ? from.getTime() : -Infinity;
    const toMs = to ? new Date(to.getFullYear(), to.getMonth(), to.getDate(), 23, 59, 59).getTime() : Infinity;
    return (statements || [])
      .filter(st => (st.status || "ออกแล้ว") !== "ยกเลิก")
      .filter(st => { const d = parseDDMMYYYY(st.date); return d && d.getTime() >= fromMs && d.getTime() <= toMs; })
      .sort((a, b) => String(a.statementNo || "").localeCompare(String(b.statementNo || "")));
  }, [statements, bpFrom, bpTo]);

  const doBulkPrint = () => {
    if (!bulkPrintList.length) return;
    setBulkPrintRows(bulkPrintList);
    // รอให้ React วาดทุกใบเสร็จก่อนค่อยสั่งพิมพ์ — ใบเยอะกว่าปกติจึงรอนานกว่าพิมพ์ใบเดียว
    setTimeout(() => {
      if (printElementById) printElementById("statement-bulk-print-area");
      setShowBulkPrint(false);
    }, 400 + bulkPrintList.length * 20);
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
          <>
            <BtnGhost onClick={() => setShowBulkPrint(true)} style={{marginRight:8}}>🖨️ พิมพ์หลายใบ</BtnGhost>
            <BtnGhost onClick={() => setShowBulk(true)} style={{marginRight:8}}>📅 ออกทั้งเดือน</BtnGhost>
            <BtnPrimary onClick={() => { resetForm(); setShowCreate(true); }}>＋ สร้างใบวางบิลใหม่</BtnPrimary>
          </>
        )}
      </div>

      {/* 📅 หน้านี้คิดยอดจากบิลที่โหลดมาเท่านั้น — ต้องเห็นตลอดว่ากำลังเห็นบิลช่วงไหน
          ไม่งั้นวางบิลย้อนเดือนแล้วยอดขาดโดยไม่รู้ตัว */}
      {setInvoicesRange && (
        <LoadRangeBar label="คิดยอดจากบิล" range={invoicesRange} setRange={setInvoicesRange}
          capped={invoicesCapped} count={invoices.length} />
      )}

      <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 ค้นหาเลขที่ใบวางบิล หรือชื่อลูกค้า..."
        style={{ width: 320, background: T.input, border: `1px solid ${T.inputBorder}`, color: T.text, borderRadius: 8, padding: "8px 12px", fontFamily: "'Sarabun',sans-serif", fontSize: 13, outline: "none", marginBottom: 14 }} />

      {/* 🔗 บิลที่ยังไม่ผูกทะเบียน — ต้องซ่อมก่อนวางบิล ไม่งั้นร้านเดียวได้ใบวางบิล 2 ใบ
          และใบที่ไม่ผูกจะไม่มีที่อยู่ให้พิมพ์ */}
      {unlinkedCount > 0 && role.canAdd !== false && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "9px 14px", marginBottom: 8,
          background: "rgba(184,134,0,0.08)", border: "1px solid rgba(184,134,0,0.35)", borderRadius: 10 }}>
          <span style={{ fontSize: 12, color: "#b45309" }}>
            🔗 มีบิล <b>{unlinkedCount}</b> ใบในช่วงนี้ที่ไม่ได้ผูกทะเบียนลูกค้า — ใบวางบิลจะแยกร้านผิดและไม่มีที่อยู่
          </span>
          <button onClick={() => setShowLink(true)}
            style={{ marginLeft: "auto", padding: "6px 13px", borderRadius: 8, border: "1px solid rgba(184,134,0,0.5)",
              background: "white", color: "#b45309", cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: "'Sarabun',sans-serif" }}>
            ซ่อมเลย
          </button>
        </div>
      )}

      {/* 📅 รอบที่ออกทั้งเดือน — ถอยกลับได้ทั้งรอบถ้ากดผิดช่วง/ผิดเงื่อนไข */}
      {role.canDelete && bulkRuns.slice(0, 3).map(run => {
        const amt = run.items.reduce((a, s) => a + Number(s.netAmount != null ? s.netAmount : s.totalAmount || 0), 0);
        const paid = run.items.filter(s => (s.status || "") === "เก็บเงินแล้ว").length;
        const busyThis = undoBusy && undoBusy.run === run.id;
        return (
          <div key={run.id} style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "9px 14px", marginBottom: 8,
            background: "rgba(59,91,139,0.06)", border: "1px solid rgba(59,91,139,0.25)", borderRadius: 10 }}>
            <span style={{ fontSize: 12, color: T.sub }}>
              📅 ออกทั้งเดือน {run.at ? `· ${run.at}` : ""} · <b style={{ color: T.text }}>{run.items.length}</b> ใบ
              {run.items[0]?.periodStart ? ` · ช่วง ${run.items[0].periodStart}–${run.items[0].periodEnd}` : ""}
              {paid > 0 && <span style={{ color: T.green }}> · เก็บเงินแล้ว {paid} ใบ</span>}
            </span>
            <span style={{ fontSize: 12, fontFamily: "monospace", fontWeight: 700, color: T.green }}>฿{amt.toLocaleString("th-TH", { minimumFractionDigits: 2 })}</span>
            <button onClick={() => undoBulkRun(run)} disabled={!!undoBusy}
              style={{ marginLeft: "auto", padding: "6px 12px", borderRadius: 8, border: "1px solid rgba(185,74,72,0.3)",
                background: undoBusy ? "#f1f3f6" : "rgba(185,74,72,0.08)", color: T.red, cursor: undoBusy ? "default" : "pointer",
                fontSize: 12, fontFamily: "'Sarabun',sans-serif", fontWeight: 600 }}>
              {busyThis ? `กำลังถอย ${undoBusy.done}/${undoBusy.total}…` : "↩️ ถอยทั้งรอบ"}
            </button>
          </div>
        );
      })}

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
        <div className="tbl-x" style={{ "--tbl-min": "900px" }}>
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
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontFamily: "monospace", fontWeight: 700, color: T.green, fontSize: 13 }}>฿{Number(st.netAmount != null ? st.netAmount : st.totalAmount || 0).toLocaleString("th-TH", { minimumFractionDigits: 2 })}</div>
                  {Number(st.creditTotal) > 0 && <div style={{ fontSize: 10, color: "#047857" }}>หักของคืน -฿{Number(st.creditTotal).toLocaleString("th-TH", { minimumFractionDigits: 2 })}</div>}
                </div>
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
        </div>
      )}

      {showLink && (
        <LinkInvoiceCustomers invoices={invoices} customers={customers} user={user}
          onClose={() => setShowLink(false)}/>
      )}

      {showBulk && (
        <BulkStatementModal
          invoices={invoices} customers={customers} statements={statements}
          returns={returns}
          invoicesRange={invoicesRange} setInvoicesRange={setInvoicesRange} invoicesCapped={invoicesCapped}
          companyInfo={companyInfo} user={user}
          onClose={() => setShowBulk(false)}
        />
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
            {/* หัวบริษัทบนใบที่พิมพ์ — ชื่อบริษัทแสดงเสมอ ที่เหลือเลือกได้ */}
            <div style={{ fontSize: 11, color: T.muted, marginBottom: 6 }}>
              🏢 หัวใบ: <b style={{ color: T.text }}>{companyInfo?.name || "CPU"}</b> (แสดงเสมอ) · ติ๊กเพิ่มได้ตามนี้
            </div>
            {[
              { k: "showCompanyAddress", l: "📍 ที่อยู่" },
              { k: "showCompanyPhone", l: "📞 เบอร์โทร" },
              { k: "showCompanyTaxId", l: "🧾 เลขผู้เสียภาษี" },
            ].map(o => {
              const on = form[o.k] === true;
              return (
                <label key={o.k} style={{ display: "inline-flex", alignItems: "center", gap: 8, marginRight: 8, padding: "6px 12px", borderRadius: 8, border: `1px solid ${on ? T.accent : T.border}`, background: on ? "rgba(59,91,139,0.08)" : "transparent", cursor: "pointer", fontSize: 12 }}>
                  <input type="checkbox" checked={on} onChange={e => setForm(f => ({ ...f, [o.k]: e.target.checked }))} />
                  <span style={{ color: on ? T.accent : T.sub, fontWeight: on ? 600 : 400 }}>{o.l}</span>
                </label>
              );
            })}
          </div>

          {/* ↩️ ใบลดหนี้จากการรับคืน — หักออกจากยอดวางบิลงวดนี้ */}
          {previewCredits.length > 0 && (
            <div style={{ marginBottom: 14, background: "rgba(16,185,129,0.05)", borderRadius: 10, border: "1px solid rgba(16,185,129,0.3)", padding: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "#047857" }}>↩️ ของที่คืน — หักออกจากยอด</span>
                <div style={{ display: "flex", gap: 5 }}>
                  <button onClick={() => setExcludedCredits(new Set())}
                    style={{ padding: "3px 10px", borderRadius: 6, border: `1px solid ${T.border}`, background: "white", color: T.sub, cursor: "pointer", fontSize: 10, fontFamily: "inherit" }}>เลือกทั้งหมด</button>
                  <button onClick={() => setExcludedCredits(new Set(previewCredits.map(r => r.id)))}
                    style={{ padding: "3px 10px", borderRadius: 6, border: `1px solid ${T.border}`, background: "white", color: T.sub, cursor: "pointer", fontSize: 10, fontFamily: "inherit" }}>ล้าง</button>
                </div>
              </div>
              <div className="scroll-col" style={{ maxHeight: 160, overflowY: "auto" }}>
                {previewCredits.map(r => {
                  const off = excludedCredits.has(r.id);
                  return (
                    <label key={r.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 7, cursor: "pointer", opacity: off ? 0.45 : 1, background: off ? "transparent" : "rgba(255,255,255,0.7)", marginBottom: 3 }}>
                      <input type="checkbox" checked={!off} onChange={() => toggleCredit(r.id)} style={{ cursor: "pointer" }} />
                      <span style={{ fontFamily: "monospace", fontSize: 11, fontWeight: 700, color: "#047857", textDecoration: off ? "line-through" : "none" }}>{r.returnNo}</span>
                      <span style={{ fontSize: 11, color: T.sub }}>{(r.receivedAt || "").split(" ")[0]}</span>
                      <span style={{ fontSize: 11, color: T.muted }}>{r.invoiceNo ? `จากบิล ${r.invoiceNo}` : ""} · {r.reason || "-"}</span>
                      <span style={{ marginLeft: "auto", fontFamily: "monospace", fontSize: 12, fontWeight: 700, color: "#047857", textDecoration: off ? "line-through" : "none" }}>-฿{Number(r.creditTotal || 0).toLocaleString("th-TH", { minimumFractionDigits: 2 })}</span>
                    </label>
                  );
                })}
              </div>
              <div style={{ fontSize: 10, color: T.muted, marginTop: 6, lineHeight: 1.6 }}>
                💡 ใบที่เลือกจะถูกทำเครื่องหมายว่าหักแล้ว — รอบหน้าจะไม่ถูกหักซ้ำ · ใบที่ตัดออกจะยกไปหักรอบถัดไป
              </div>
            </div>
          )}
          {/* 4. Preview */}
          <div style={{ marginBottom: 14, background: "rgba(241,243,246,0.5)", borderRadius: 10, border: `1px solid ${T.border}`, padding: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: T.text }}>📊 บิลที่จะรวม</span>
              {previewInvoices.length > 0 && (
                <div style={{ display: "flex", gap: 5 }}>
                  <button onClick={() => setExcludedIds(new Set())}
                    style={{ padding: "3px 10px", borderRadius: 6, border: `1px solid ${T.border}`, background: "white", color: T.sub, cursor: "pointer", fontSize: 10, fontFamily: "inherit" }}>เลือกทั้งหมด</button>
                  <button onClick={() => setExcludedIds(new Set(previewInvoices.map(i => i.id)))}
                    style={{ padding: "3px 10px", borderRadius: 6, border: `1px solid ${T.border}`, background: "white", color: T.sub, cursor: "pointer", fontSize: 10, fontFamily: "inherit" }}>ล้าง</button>
                </div>
              )}
              <span style={{ fontSize: 12, color: T.muted, marginLeft: "auto" }}>
                เลือก <b style={{ color: T.text }}>{pickedInvoices.length}</b>/{previewInvoices.length} ใบ · รวม <b style={{ color: T.green }}>฿{previewTotal.toLocaleString("th-TH", { minimumFractionDigits: 2 })}</b>
                {creditTotal > 0 && (
                  <> · หักของคืน <b style={{ color: "#047857" }}>-฿{creditTotal.toLocaleString("th-TH", { minimumFractionDigits: 2 })}</b>
                  {" "}· <b style={{ color: T.text }}>เก็บจริง ฿{netTotal.toLocaleString("th-TH", { minimumFractionDigits: 2 })}</b></>
                )}
              </span>
            </div>
            {nearMiss.length > 0 && (
              <div style={{ padding: "8px 10px", marginBottom: 8, background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.35)", borderRadius: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#92400e", marginBottom: 5 }}>
                  ⚠️ มีบิลชื่อใกล้เคียงอีก {nearMiss.length} ใบ ที่ยังไม่ได้รวม
                  <div style={{ fontWeight: 400, marginTop: 2 }}>ชื่อในบิลพิมพ์ไม่เหมือนในทะเบียน — ตรวจแล้วกด "รวมด้วย" ถ้าเป็นลูกค้ารายเดียวกัน</div>
                </div>
                {nearMiss.slice(0, 12).map(inv => (
                  <div key={inv.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, padding: "3px 0", flexWrap: "wrap" }}>
                    <span style={{ fontFamily: "monospace", color: T.accent }}>{inv.invoiceNo}</span>
                    <span style={{ flex: 1, minWidth: 120, color: T.text }}>{inv.customerName}</span>
                    <span style={{ fontFamily: "monospace", color: T.sub }}>฿{(Number(inv.total) || 0).toLocaleString("th-TH", { minimumFractionDigits: 2 })}</span>
                    <span style={{ color: T.muted }}>{inv.date}</span>
                    <button onClick={() => setIncludedNearIds(prev => new Set(prev).add(inv.id))}
                      style={{ border: "1px solid rgba(59,91,139,0.4)", background: "white", color: T.accent, borderRadius: 6, cursor: "pointer", fontSize: 10, padding: "2px 8px", fontFamily: "inherit", fontWeight: 700 }}>
                      + รวมด้วย
                    </button>
                  </div>
                ))}
                {nearMiss.length > 12 && <div style={{ fontSize: 10, color: T.muted, marginTop: 3 }}>…และอีก {nearMiss.length - 12} ใบ</div>}
              </div>
            )}
            {alreadyBilled.length > 0 && (
              <div style={{ padding: "8px 12px", background: "rgba(184,134,0,0.08)", border: "1px solid rgba(184,134,0,0.35)", borderRadius: 9, fontSize: 12, marginBottom: 8 }}>
                <div style={{ color: T.amber, fontWeight: 700, marginBottom: 5 }}>
                  ℹ️ ตัดออก {alreadyBilled.length} ใบ เพราะวางบิลไปแล้ว — ใบนี้จะมีเฉพาะบิลที่เพิ่มเข้ามาใหม่
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {alreadyBilled.slice(0, 6).map(inv => {
                    const st = statementOfInvoice(statements, inv.id);
                    return (
                      <div key={inv.id} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ fontFamily: "monospace", color: T.sub }}>{inv.invoiceNo}</span>
                        <span style={{ color: T.muted, fontSize: 11 }}>฿{(Number(inv.total) || 0).toLocaleString("th-TH", { minimumFractionDigits: 2 })}</span>
                        <span style={{ color: T.muted, fontSize: 11 }}>→ อยู่ใน {st?.statementNo || "ใบวางบิลอื่น"}</span>
                        <button onClick={() => setIncludedUsedIds(prev => new Set(prev).add(inv.id))}
                          title="ใบวางบิลเดิมยกเลิก/พิมพ์ผิด จึงต้องเอาบิลนี้มาวางใหม่"
                          style={{ background: "#ffffff", border: `1px solid ${T.amber}`, color: T.text, borderRadius: 6, padding: "2px 9px", cursor: "pointer", fontSize: 11, fontFamily: "inherit" }}>
                          + รวมด้วย
                        </button>
                      </div>
                    );
                  })}
                  {alreadyBilled.length > 6 && <div style={{ color: T.muted, fontSize: 11 }}>… และอีก {alreadyBilled.length - 6} ใบ</div>}
                </div>
              </div>
            )}
            {pickedInvoices.length === 0 && previewInvoices.length === 0 ? (
              <div style={{ textAlign: "center", padding: 16, fontSize: 12, color: T.muted }}>
                {!form.customerName ? "เลือกลูกค้าก่อน" : "ไม่มีบิลในช่วงนี้"}
              </div>
            ) : (
              <div className="scroll-col" style={{ display: "flex", flexDirection: "column", maxHeight: 200, overflowY: "auto", background: T.card, borderRadius: 7, border: `1px solid ${T.border}` }}>
                {[...previewInvoices, ...invoices.filter(inv => includedNearIds.has(inv.id))].map((inv, i) => {
                  const on = !excludedIds.has(inv.id);
                  return (
                    <label key={inv.id} title="ติ๊กออกถ้าไม่ต้องการรวมบิลใบนี้"
                      style={{ display: "grid", gridTemplateColumns: "22px 110px 90px 1fr 100px", alignItems: "center", gap: 4, padding: "7px 12px",
                        borderBottom: i < previewInvoices.length - 1 ? `1px solid ${T.border}` : "none", fontSize: 11, cursor: "pointer",
                        background: on ? "transparent" : "rgba(241,243,246,0.7)", opacity: on ? 1 : 0.55 }}>
                      <input type="checkbox" checked={on} onChange={() => toggleInvoice(inv.id)} style={{ width: 14, height: 14, cursor: "pointer" }}/>
                      <span style={{ fontFamily: "monospace", color: T.accent, fontWeight: 700 }}>{inv.invoiceNo}</span>
                      <span style={{ color: T.sub }}>{(inv.date || "").split(" ")[0]}</span>
                      <span style={{ color: T.muted, fontSize: 10 }}>{inv.status || "ออกแล้ว"}</span>
                      <span style={{ textAlign: "right", fontFamily: "monospace", color: on ? T.green : T.muted, fontWeight: 700, textDecoration: on ? "none" : "line-through" }}>฿{Number(inv.total || 0).toLocaleString("th-TH", { minimumFractionDigits: 2 })}</span>
                    </label>
                  );
                })}
              </div>
            )}
            {excludedIds.size > 0 && (
              <div style={{ marginTop: 6, fontSize: 11, color: T.amber }}>
                ⚠️ ตัดออก {excludedIds.size} ใบ — จะไม่รวมในใบวางบิลนี้
              </div>
            )}
          </div>

          {/* 5. Extra fields */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
            <Input label="กำหนดชำระ" type="date" value={form.dueDate} onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))} />
            <Input label="หมายเหตุ" value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} placeholder="ระบุข้อความเพิ่มเติม..." />
          </div>

          {/* 🏦 บัญชีรับชำระ — แสดงบนใบวางบิล */}
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 11, color: T.sub, display: "block", marginBottom: 5, fontWeight: 500 }}>🏦 บัญชีรับชำระ (แสดงบนใบวางบิล)</label>
            <select
              value={form.bankAccount ? String(form.bankAccount.__idx ?? -1) : ""}
              onChange={e => {
                const idx = Number(e.target.value);
                const b = (companyInfo?.bankAccounts || [])[idx];
                setForm(f => ({ ...f, bankAccount: b ? { __idx: idx, bank: b.bankName, bankName: b.bankName, accountNo: b.accountNo, accountName: b.accountName || b.label || "" } : null }));
              }}
              style={{ width: "100%", background: T.input, border: `1px solid ${T.inputBorder}`, color: T.text, borderRadius: 8, padding: "9px 12px", fontFamily: "'Sarabun',sans-serif", fontSize: 13, outline: "none" }}>
              <option value="">— ไม่แสดงบัญชี —</option>
              {(companyInfo?.bankAccounts || []).map((b, i) => (
                <option key={i} value={i}>{b.label ? `${b.label} · ` : ""}{b.bankName} · {b.accountNo}{b.accountName ? ` · ${b.accountName}` : ""}</option>
              ))}
            </select>
            {(!companyInfo?.bankAccounts || companyInfo.bankAccounts.length === 0) && (
              <div style={{ fontSize: 10, color: T.muted, marginTop: 4 }}>ยังไม่มีบัญชี — เพิ่มได้ที่ ⚙️ ตั้งค่า → ข้อมูลบริษัท</div>
            )}
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

      {/* === พิมพ์หลายใบ — ทุกใบต่อกันในงานพิมพ์เดียว ขึ้นหน้าใหม่ทุกใบ === */}
      {bulkPrintRows && (
        <div style={{ position: "fixed", left: -99999, top: 0, width: 800 }}>
          <div id="statement-bulk-print-area">
            {bulkPrintRows.map((st, i) => (
              <div key={st.id} style={{ breakAfter: i < bulkPrintRows.length - 1 ? "page" : "auto",
                                        pageBreakAfter: i < bulkPrintRows.length - 1 ? "always" : "auto" }}>
                {/* ไม่ให้ id ซ้ำกับใบเดี่ยว — ที่พิมพ์จริงคือกล่องนอก */}
                <StatementPrintLayout statement={st} companyInfo={companyInfo} id={null} />
              </div>
            ))}
          </div>
        </div>
      )}

      {showBulkPrint && (
        <Modal onClose={() => setShowBulkPrint(false)} w={480}>
          <MHead title="🖨️ พิมพ์ใบวางบิลหลายใบ" sub="เลือกช่วงวันที่ออกใบวางบิล — พิมพ์ต่อกันในงานเดียว ใบละหน้า" onClose={() => setShowBulkPrint(false)}/>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
            <div>
              <label style={{ fontSize: 11, color: T.muted, display: "block", marginBottom: 4, fontWeight: 600 }}>ออกตั้งแต่วันที่</label>
              <input type="date" value={bpFrom} onChange={e => setBpFrom(e.target.value)}
                style={{ width: "100%", boxSizing: "border-box", background: T.input, border: `1px solid ${T.inputBorder}`, color: T.text, borderRadius: 8, padding: "8px 10px", fontSize: 13, fontFamily: "inherit", outline: "none" }}/>
            </div>
            <div>
              <label style={{ fontSize: 11, color: T.muted, display: "block", marginBottom: 4, fontWeight: 600 }}>ถึงวันที่</label>
              <input type="date" value={bpTo} onChange={e => setBpTo(e.target.value)}
                style={{ width: "100%", boxSizing: "border-box", background: T.input, border: `1px solid ${T.inputBorder}`, color: T.text, borderRadius: 8, padding: "8px 10px", fontSize: 13, fontFamily: "inherit", outline: "none" }}/>
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
            {[
              { l: "วันนี้", f: () => { const d = new Date(); return [fmtISO(d), fmtISO(d)]; } },
              { l: "เดือนนี้", f: () => { const d = new Date(); return [fmtISO(new Date(d.getFullYear(), d.getMonth(), 1)), fmtISO(new Date(d.getFullYear(), d.getMonth() + 1, 0))]; } },
              { l: "เดือนที่แล้ว", f: () => { const d = new Date(); return [fmtISO(new Date(d.getFullYear(), d.getMonth() - 1, 1)), fmtISO(new Date(d.getFullYear(), d.getMonth(), 0))]; } },
            ].map(b => (
              <button key={b.l} onClick={() => { const [a, z] = b.f(); setBpFrom(a); setBpTo(z); }}
                style={{ padding: "5px 12px", borderRadius: 6, border: `1px solid ${T.border}`, background: "rgba(59,91,139,0.06)", color: T.accent, fontSize: 11, cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}>{b.l}</button>
            ))}
          </div>
          <div style={{ padding: "10px 12px", background: "rgba(59,91,139,0.06)", border: "1px solid rgba(59,91,139,0.2)", borderRadius: 9, marginBottom: 12 }}>
            <div style={{ fontSize: 13, color: T.text, fontWeight: 700 }}>
              จะพิมพ์ {bulkPrintList.length} ใบ
              <span style={{ fontSize: 12, fontWeight: 400, color: T.sub, marginLeft: 8 }}>
                รวม ฿{bulkPrintList.reduce((a, x) => a + (Number(x.netAmount ?? x.totalAmount) || 0), 0).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
              </span>
            </div>
            {bulkPrintList.length > 0 && (
              <div style={{ fontSize: 11, color: T.muted, marginTop: 4, maxHeight: 110, overflowY: "auto", lineHeight: 1.7 }}>
                {bulkPrintList.slice(0, 40).map(x => `${x.statementNo} · ${x.customerName}`).join(" · ")}
                {bulkPrintList.length > 40 ? ` … และอีก ${bulkPrintList.length - 40} ใบ` : ""}
              </div>
            )}
            {bulkPrintList.length === 0 && (
              <div style={{ fontSize: 11, color: T.red, marginTop: 4 }}>ไม่มีใบวางบิลที่ออกในช่วงนี้ — ลองขยายช่วงวันที่</div>
            )}
            <div style={{ fontSize: 10, color: T.muted, marginTop: 6 }}>ไม่รวมใบที่ยกเลิก · เรียงตามเลขที่ใบวางบิล</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <BtnGhost onClick={() => setShowBulkPrint(false)} style={{ flex: 1 }}>ปิด</BtnGhost>
            <BtnPrimary onClick={doBulkPrint} disabled={!bulkPrintList.length} style={{ flex: 2, opacity: bulkPrintList.length ? 1 : 0.45 }}>
              🖨️ พิมพ์ {bulkPrintList.length} ใบ
            </BtnPrimary>
          </div>
        </Modal>
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
                          <div style={{ textAlign: "right" }}>
                            <div style={{ fontFamily: "monospace", fontWeight: 700, color: T.text, fontSize: 13 }}>{Number(inv.due != null ? inv.due : inv.total).toLocaleString("th-TH", { minimumFractionDigits: 2 })}</div>
                            {/* บิลที่รับมัดจำมาแล้ว ต้องบอกว่ายอดที่เห็นไม่ใช่ยอดหน้าบิล */}
                            {Number(inv.paid) > 0 && <div style={{ fontSize: 10, color: "#047857" }}>บิล ฿{Number(inv.total).toLocaleString("th-TH", { minimumFractionDigits: 2 })} · รับแล้ว -฿{Number(inv.paid).toLocaleString("th-TH", { minimumFractionDigits: 2 })}</div>}
                          </div>
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
function StatementPrintLayout({ statement, companyInfo, id = "statement-print-area" }) {
  return (
    // id = null ตอนพิมพ์หลายใบ — กัน id ซ้ำกัน ที่พิมพ์จริงคือกล่องนอกที่ครอบทุกใบ
    <div id={id || undefined} style={{ padding: "20px 28px", fontFamily: "'Sarabun',sans-serif", color: "#000", background: "white" }}>
      {/* Header — เล็กลง */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12, paddingBottom: 8, borderBottom: "2px solid #000" }}>
        <div>
          {/* ปิดหัวบริษัทได้ เผื่อพิมพ์ลงกระดาษหัวจดหมายที่มีชื่อร้านอยู่แล้ว */}
          {/* ชื่อบริษัทแสดงเสมอ — ใบวางบิลต้องรู้ว่าใครเป็นคนเรียกเก็บ
              ที่เหลือเลือกเปิด/ปิดได้ทีละอย่างตอนสร้างใบ
              ที่อยู่/เบอร์ ใช้ === true (ใบเก่าไม่มีฟิลด์ = ไม่แสดง ตามที่ร้านใช้ตอนนี้)
              เลขภาษี ใช้ !== false (ใบเก่าเคยแสดงอยู่ พิมพ์ซ้ำต้องได้เหมือนเดิม) */}
          <div style={{ fontSize: 18, fontWeight: 800, color: "#000", letterSpacing: 1.5 }}>{companyInfo?.name || "CPU"}</div>
          {companyInfo?.address && statement.showCompanyAddress === true && <div style={{ fontSize: 10, color: "#000", marginTop: 2 }}>{companyInfo.address}</div>}
          {companyInfo?.phone && statement.showCompanyPhone === true && <div style={{ fontSize: 10, color: "#000" }}>โทร: {companyInfo.phone}{companyInfo.email && `  ·  ${companyInfo.email}`}</div>}
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
      <div style={{overflowX:"auto",WebkitOverflowScrolling:"touch",marginBottom:10}}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 9, minWidth:640 }}>
        <thead>
          <tr style={{ background: "#f1f5f9", color: "#000" }}>
            <th style={{ padding: "4px 6px", textAlign: "left", fontWeight: 700, width: 95, border: "1px solid #000", fontSize: 9 }}>เลขที่บิล</th>
            <th style={{ padding: "4px 6px", textAlign: "center", fontWeight: 700, width: 80, border: "1px solid #000", fontSize: 9 }}>วันที่</th>
            <th style={{ padding: "4px 6px", textAlign: "left", fontWeight: 700, border: "1px solid #000", fontSize: 9 }}>ประเภท / สถานะ</th>
            <th style={{ padding: "4px 6px", textAlign: "right", fontWeight: 700, width: 130, minWidth: 130, border: "1px solid #000", fontSize: 9, whiteSpace: "nowrap" }}>ยอดบิล (฿)</th>
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
                {/* บอกบนกระดาษว่าหักมัดจำไปแล้วเท่าไหร่ ไม่งั้นลูกค้าเทียบยอดกับบิลแล้วไม่ตรง */}
                {Number(inv.paid) > 0 && (
                  <div style={{ fontSize: 8, color: "#000" }}>
                    ยอดบิล {Number(inv.total).toLocaleString("th-TH", { minimumFractionDigits: 2 })} · รับชำระแล้ว -{Number(inv.paid).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                  </div>
                )}
              </td>
              <td style={{ padding: "4px 6px", textAlign: "right", fontFamily: "monospace", fontWeight: 700, color: "#000", border: "1px solid #cbd5e1", fontSize: 10, whiteSpace: "nowrap" }}>{Number(inv.due != null ? inv.due : inv.total).toLocaleString("th-TH", { minimumFractionDigits: 2 })}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          {Number(statement.creditTotal) > 0 ? (
            <>
              <tr style={{ background: "#f8fafc" }}>
                <td colSpan={3} style={{ padding: "5px 8px", textAlign: "right", color: "#000", fontSize: 10, border: "1px solid #000" }}>รวมบิล</td>
                <td style={{ padding: "5px 8px", textAlign: "right", fontFamily: "monospace", fontSize: 11, color: "#000", border: "1px solid #000", whiteSpace: "nowrap" }}>
                  ฿{Number(statement.totalAmount || 0).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                </td>
              </tr>
              {(statement.returnsSnapshot || []).map((r, i) => (
                <tr key={i} style={{ background: "#f8fafc" }}>
                  <td colSpan={3} style={{ padding: "4px 8px", textAlign: "right", color: "#000", fontSize: 9, border: "1px solid #000" }}>
                    หัก รับคืนสินค้า {r.returnNo}{r.invoiceNo ? ` (บิล ${r.invoiceNo})` : ""}{r.qty ? ` · ${r.qty} ชิ้น` : ""}
                    {/* 📦 บอกด้วยว่าคืนของอะไรมา — ไม่งั้นลูกค้าเทียบไม่ได้ว่าหักตรงกับที่คืนไปจริงไหม
                        ใบเก่าที่ออกก่อนมีฟีเจอร์นี้จะไม่มี items ก็ไม่ขึ้นบรรทัดนี้ (ไม่พัง) */}
                    {returnItemsText(r) && (
                      <div style={{ fontSize: 8, color: "#000", fontWeight: 400 }}>{returnItemsText(r)}</div>
                    )}
                  </td>
                  <td style={{ padding: "4px 8px", textAlign: "right", fontFamily: "monospace", fontSize: 10, color: "#000", border: "1px solid #000", whiteSpace: "nowrap" }}>
                    -{Number(r.total || 0).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                  </td>
                </tr>
              ))}
              <tr style={{ background: "#f1f5f9", fontWeight: 800 }}>
                <td colSpan={3} style={{ padding: "6px 8px", textAlign: "right", color: "#000", fontSize: 11, border: "2px solid #000" }}>ยอดที่ต้องชำระ</td>
                <td style={{ padding: "6px 8px", textAlign: "right", fontFamily: "monospace", fontSize: 13, color: "#000", border: "2px solid #000", whiteSpace: "nowrap" }}>
                  ฿{Number(statement.netAmount != null ? statement.netAmount : statement.totalAmount || 0).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                </td>
              </tr>
            </>
          ) : (
            <tr style={{ background: "#f1f5f9", fontWeight: 800 }}>
              <td colSpan={3} style={{ padding: "6px 8px", textAlign: "right", color: "#000", fontSize: 11, border: "2px solid #000" }}>รวมทั้งสิ้น</td>
              <td style={{ padding: "6px 8px", textAlign: "right", fontFamily: "monospace", fontSize: 13, color: "#000", border: "2px solid #000", whiteSpace: "nowrap" }}>
                ฿{Number(statement.totalAmount || 0).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
              </td>
            </tr>
          )}
        </tfoot>
      </table>
      </div>

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
