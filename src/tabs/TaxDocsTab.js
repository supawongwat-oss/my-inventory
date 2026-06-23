// 🧾 คลังเอกสารภาษี — Tax Document Repository
import { useState, useMemo } from "react";
import { db } from "../firebase";
import { collection as fsCollection, addDoc, updateDoc, deleteDoc, doc, serverTimestamp } from "firebase/firestore";
import { T } from "../theme";
import { Modal, MHead, BtnPrimary, BtnGhost, CardBox } from "../components/ui";
import { uploadFile, deleteFile, fmtBytes } from "../utils/upload";
import { logAudit, AUDIT_ACTIONS } from "../utils/audit";

// ประเภทเอกสาร — ใช้เป็น "folder" + filter
const DOC_TYPES = [
  { key: "purchase_tax", label: "📄 ใบกำกับภาษีซื้อ", color: T.accent, group: "vat" },
  { key: "sales_tax",    label: "📄 ใบกำกับภาษีขาย", color: T.accent, group: "vat" },
  { key: "withholding",  label: "💰 หัก ณ ที่จ่าย",   color: T.amber,  group: "wht" },
  { key: "pnd1",         label: "📋 ภ.ง.ด.1 (เงินเดือน)", color: "#7c3aed", group: "filing" },
  { key: "pnd3",         label: "📋 ภ.ง.ด.3 (บุคคล WHT)", color: "#7c3aed", group: "filing" },
  { key: "pnd53",        label: "📋 ภ.ง.ด.53 (นิติบุคคล WHT)", color: "#7c3aed", group: "filing" },
  { key: "ppor30",       label: "📋 ภ.พ.30 (VAT รายเดือน)", color: "#7c3aed", group: "filing" },
  { key: "pnd50",        label: "📋 ภ.ง.ด.50/51 (ภาษีนิติบุคคล)", color: "#7c3aed", group: "filing" },
  { key: "utility_water",  label: "💧 ค่าน้ำ",              color: "#0891b2", group: "expense" },
  { key: "utility_power",  label: "⚡ ค่าไฟ",              color: "#d97706", group: "expense" },
  { key: "utility_other",  label: "📡 ค่าสาธารณูปโภคอื่น (เน็ต/โทร)", color: "#0891b2", group: "expense" },
  { key: "equipment",      label: "🛠️ ค่าอุปกรณ์/เครื่องมือ", color: "#3a7a52", group: "expense" },
  { key: "material",       label: "🧵 ค่าวัตถุดิบ",          color: "#3a7a52", group: "expense" },
  { key: "rent",           label: "🏢 ค่าเช่า",              color: "#7c3aed", group: "expense" },
  { key: "transport",      label: "🚚 ค่าขนส่ง/น้ำมัน",     color: "#d97706", group: "expense" },
  { key: "other",        label: "🗂️ อื่นๆ",            color: T.muted,  group: "other" },
];

const fmtDate = (d) => {
  if (!d) return "—";
  const dt = new Date(d);
  return `${String(dt.getDate()).padStart(2,"0")}/${String(dt.getMonth()+1).padStart(2,"0")}/${dt.getFullYear()+543}`;
};

const EMPTY_FORM = {
  docType: "purchase_tax",
  docNo: "",
  date: "",
  party: "", // ชื่อคู่ค้า (ขาย/ซื้อ)
  partyTaxId: "",
  amount: "", // ยอดก่อนภาษี
  vat: "",
  whtAmount: "", // ยอดหัก ณ ที่จ่าย
  whtRate: "", // % WHT
  total: "", // ยอดรวม
  note: "",
  attachments: [], // [{url, path, name, size, type}]
};

export default function TaxDocsTab({ taxDocs = [], user, role }) {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [filterType, setFilterType] = useState("ทั้งหมด");
  const [filterYear, setFilterYear] = useState(new Date().getFullYear() + 543);
  const [filterMonth, setFilterMonth] = useState("ทั้งหมด");
  const [search, setSearch] = useState("");
  const [uploading, setUploading] = useState(false);
  const [confirmDel, setConfirmDel] = useState(null);
  const [viewDoc, setViewDoc] = useState(null);

  // เพิ่มข้อมูล type meta
  const enriched = useMemo(() => taxDocs.map(d => {
    const typeMeta = DOC_TYPES.find(t => t.key === d.docType) || DOC_TYPES[DOC_TYPES.length-1];
    return { ...d, _type: typeMeta };
  }), [taxDocs]);

  // years available
  const yearsAvailable = useMemo(() => {
    const set = new Set();
    enriched.forEach(d => {
      if (d.date) set.add(new Date(d.date).getFullYear() + 543);
    });
    set.add(new Date().getFullYear() + 543);
    return [...set].sort((a,b)=>b-a);
  }, [enriched]);

  // filtered
  const filtered = useMemo(() => enriched.filter(d => {
    if (filterType !== "ทั้งหมด" && d.docType !== filterType) return false;
    if (filterYear !== "ทั้งหมด") {
      const y = d.date ? new Date(d.date).getFullYear() + 543 : null;
      if (y !== filterYear) return false;
    }
    if (filterMonth !== "ทั้งหมด") {
      const m = d.date ? new Date(d.date).getMonth() + 1 : null;
      if (m !== filterMonth) return false;
    }
    if (search) {
      const q = search.toLowerCase();
      const hay = `${d.docNo} ${d.party} ${d.partyTaxId} ${d.note}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }), [enriched, filterType, filterYear, filterMonth, search]);

  // summary (ตาม filter)
  const summary = useMemo(() => {
    return filtered.reduce((s, d) => {
      s.count++;
      s.amount += Number(d.amount) || 0;
      s.vat += Number(d.vat) || 0;
      s.wht += Number(d.whtAmount) || 0;
      s.total += Number(d.total) || 0;
      return s;
    }, { count: 0, amount: 0, vat: 0, wht: 0, total: 0 });
  }, [filtered]);

  const openNew = () => { setEditing(null); setForm({...EMPTY_FORM, date: new Date().toISOString().slice(0,10)}); setShowForm(true); };
  const openEdit = (d) => {
    setEditing(d);
    setForm({ ...EMPTY_FORM, ...d, attachments: d.attachments || [] });
    setShowForm(true);
  };

  const handleUpload = async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      const year = form.date ? new Date(form.date).getFullYear() : new Date().getFullYear();
      const meta = await uploadFile(file, `taxdocs/${year}/${form.docType}`);
      setForm(f => ({ ...f, attachments: [...(f.attachments||[]), meta] }));
    } catch (e) {
      alert("อัพโหลดไม่สำเร็จ: " + (e.message || e));
    } finally {
      setUploading(false);
    }
  };

  const removeAttachment = async (idx) => {
    const att = form.attachments[idx];
    if (att?.path) await deleteFile(att.path);
    setForm(f => ({ ...f, attachments: f.attachments.filter((_, i) => i !== idx) }));
  };

  const [savedToast, setSavedToast] = useState("");
  const handleSave = async () => {
    if (!form.docType) { alert("กรุณาเลือกประเภทเอกสาร"); return; }
    if (!form.date) { alert("กรุณากรอกวันที่"); return; }
    // ตรวจ date ให้แน่ใจว่า parse ได้ (กัน case orderBy ทิ้งจาก server)
    const d = new Date(form.date);
    if (isNaN(d.getTime())) { alert("วันที่ไม่ถูกต้อง: " + form.date); return; }

    // ตัด field พิเศษ (เช่น _type จาก enriched) ที่ไม่ควรเขียนกลับ Firestore
    const { _type, id, ...clean } = form;
    const data = {
      ...clean,
      amount: Number(clean.amount) || 0,
      vat: Number(clean.vat) || 0,
      whtAmount: Number(clean.whtAmount) || 0,
      whtRate: Number(clean.whtRate) || 0,
      total: Number(clean.total) || (Number(clean.amount) || 0) + (Number(clean.vat) || 0),
      updatedBy: user.name,
      updatedAt: new Date().toISOString(),
    };
    try {
      if (editing) {
        await updateDoc(doc(db, "taxDocs", editing.id), data);
        logAudit(user, { action: AUDIT_ACTIONS.UPDATE, collection: "taxDocs", targetId: editing.id, targetLabel: `${data.docType} ${data.docNo}` });
        setSavedToast("✅ แก้ไขเอกสารสำเร็จ");
      } else {
        data.createdAt = serverTimestamp();
        data.createdBy = user.name;
        const ref = await addDoc(fsCollection(db, "taxDocs"), data);
        logAudit(user, { action: AUDIT_ACTIONS.CREATE, collection: "taxDocs", targetId: ref.id, targetLabel: `${data.docType} ${data.docNo}` });
        setSavedToast("✅ เพิ่มเอกสารสำเร็จ");
        // 🩹 reset filters ให้รายการใหม่ขึ้นแน่นอน (กัน user หาไม่เจอ)
        const newYear = new Date(form.date).getFullYear() + 543;
        setFilterType("ทั้งหมด");
        setFilterMonth("ทั้งหมด");
        setFilterYear(newYear);
      }
      setShowForm(false);
      setEditing(null);
      setForm(EMPTY_FORM);
      setTimeout(()=>setSavedToast(""), 2500);
    } catch (e) {
      console.error("[taxDocs handleSave] failed:", e);
      alert("บันทึกไม่สำเร็จ: " + (e.message || e));
    }
  };

  const handleDelete = async (d) => {
    for (const a of (d.attachments || [])) {
      if (a.path) await deleteFile(a.path);
    }
    await deleteDoc(doc(db, "taxDocs", d.id));
    logAudit(user, { action: AUDIT_ACTIONS.DELETE, collection: "taxDocs", targetId: d.id, targetLabel: `${d.docType} ${d.docNo}` });
    setConfirmDel(null);
  };

  // ────────── RENDER ──────────
  return (
    <div style={{ animation: "fadeUp 0.4s ease" }}>
      {/* Toast บันทึกสำเร็จ */}
      {savedToast && (
        <div style={{ position: "fixed", top: 18, left: "50%", transform: "translateX(-50%)", zIndex: 9999, background: "#dcfce7", border: "1px solid #86efac", borderRadius: 10, padding: "10px 22px", color: "#166534", fontSize: 13, fontWeight: 600, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", animation: "fadeUp 0.25s ease" }}>
          {savedToast}
        </div>
      )}

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: T.text }}>🧾 คลังเอกสารภาษี</div>
          <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>เก็บใบกำกับภาษี / WHT / ภ.พ.30 / ภ.ง.ด. ทุกประเภท พร้อมไฟล์แนบ</div>
        </div>
        {role?.canAdd !== false && (
          <BtnPrimary onClick={openNew}>＋ เพิ่มเอกสาร</BtnPrimary>
        )}
      </div>

      {/* Summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 10, marginBottom: 14 }}>
        {[
          { label: "จำนวนเอกสาร", value: summary.count, unit: "ใบ", color: T.accent, bg: "rgba(59,91,139,0.08)" },
          { label: "ยอดก่อนภาษี", value: summary.amount, unit: "฿", color: T.text, bg: T.card },
          { label: "VAT", value: summary.vat, unit: "฿", color: T.amber, bg: "rgba(184,134,0,0.08)" },
          { label: "WHT (หัก ณ ที่จ่าย)", value: summary.wht, unit: "฿", color: "#7c3aed", bg: "rgba(124,58,237,0.08)" },
          { label: "ยอดรวม", value: summary.total, unit: "฿", color: T.green, bg: "rgba(58,122,82,0.08)" },
        ].map((s,i) => (
          <div key={i} style={{ padding: 12, background: s.bg, border: `1px solid ${T.border}`, borderRadius: 10 }}>
            <div style={{ fontSize: 10, color: T.muted, fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: 16, fontWeight: 800, fontFamily: "monospace", color: s.color }}>
              {s.unit === "฿" ? `฿${Number(s.value).toLocaleString("th-TH",{minimumFractionDigits:2})}` : `${s.value} ${s.unit}`}
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="🔍 ค้นหา เลขที่/คู่ค้า/หมายเหตุ..."
          style={{ flex: 1, minWidth: 220, background: T.input, border: `1px solid ${T.inputBorder}`, color: T.text, borderRadius: 7, padding: "8px 12px", fontFamily: "'Sarabun',sans-serif", fontSize: 13, outline: "none" }}/>
        <select value={filterType} onChange={e=>setFilterType(e.target.value)}
          style={{ background: T.input, border: `1px solid ${T.inputBorder}`, color: T.text, borderRadius: 7, padding: "8px 10px", fontSize: 12, outline: "none", cursor: "pointer" }}>
          <option>ทั้งหมด</option>
          {DOC_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
        <select value={filterYear} onChange={e=>setFilterYear(e.target.value==="ทั้งหมด"?"ทั้งหมด":Number(e.target.value))}
          style={{ background: T.input, border: `1px solid ${T.inputBorder}`, color: T.text, borderRadius: 7, padding: "8px 10px", fontSize: 12, outline: "none", cursor: "pointer" }}>
          <option>ทั้งหมด</option>
          {yearsAvailable.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <select value={filterMonth} onChange={e=>setFilterMonth(e.target.value==="ทั้งหมด"?"ทั้งหมด":Number(e.target.value))}
          style={{ background: T.input, border: `1px solid ${T.inputBorder}`, color: T.text, borderRadius: 7, padding: "8px 10px", fontSize: 12, outline: "none", cursor: "pointer" }}>
          <option>ทั้งหมด</option>
          {[1,2,3,4,5,6,7,8,9,10,11,12].map(m=><option key={m} value={m}>เดือน {m}</option>)}
        </select>
      </div>

      {/* List */}
      <CardBox style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "150px 110px 1fr 1fr 100px 110px 110px 110px 60px 90px", padding: "10px 12px", background: "#f8f9fb", fontSize: 10, color: T.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", borderBottom: `1px solid ${T.border}` }}>
          <div>ประเภท</div><div>วันที่</div><div>เลขที่</div><div>คู่ค้า</div>
          <div style={{textAlign:"right"}}>ก่อนภาษี</div><div style={{textAlign:"right"}}>VAT</div><div style={{textAlign:"right"}}>WHT</div><div style={{textAlign:"right"}}>รวม</div>
          <div style={{textAlign:"center"}}>ไฟล์</div><div style={{textAlign:"center"}}>จัดการ</div>
        </div>
        {filtered.length === 0 ? (
          <div style={{ padding: 30, textAlign: "center", color: T.muted, fontSize: 13 }}>
            {taxDocs.length === 0 ? "ยังไม่มีเอกสาร — กด '+ เพิ่มเอกสาร'" : "ไม่พบเอกสารตามเงื่อนไข"}
          </div>
        ) : filtered.map((d, i) => (
          <div key={d.id} onClick={()=>setViewDoc(d)} style={{ display: "grid", gridTemplateColumns: "150px 110px 1fr 1fr 100px 110px 110px 110px 60px 90px", alignItems: "center", padding: "11px 12px", borderBottom: i<filtered.length-1?`1px solid ${T.border}`:"none", fontSize: 12, cursor: "pointer", transition: "background 0.15s" }}
            onMouseEnter={e=>e.currentTarget.style.background="rgba(59,91,139,0.04)"}
            onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
            <div><span style={{ padding: "2px 8px", borderRadius: 10, fontSize: 10, fontWeight: 600, background: `${d._type.color}15`, color: d._type.color, border: `1px solid ${d._type.color}30` }}>{d._type.label.slice(0, 20)}</span></div>
            <div style={{ fontSize: 11, color: T.sub, fontFamily: "monospace" }}>{fmtDate(d.date)}</div>
            <div style={{ fontFamily: "monospace", fontWeight: 600, color: T.accent, fontSize: 12 }}>{d.docNo || "—"}</div>
            <div style={{ fontSize: 12, color: T.text }}>{d.party || "—"}</div>
            <div style={{ textAlign: "right", fontFamily: "monospace", color: T.text }}>{Number(d.amount||0).toLocaleString("th-TH",{minimumFractionDigits:2})}</div>
            <div style={{ textAlign: "right", fontFamily: "monospace", color: T.amber }}>{d.vat?Number(d.vat).toLocaleString("th-TH",{minimumFractionDigits:2}):"—"}</div>
            <div style={{ textAlign: "right", fontFamily: "monospace", color: "#7c3aed" }}>{d.whtAmount?Number(d.whtAmount).toLocaleString("th-TH",{minimumFractionDigits:2}):"—"}</div>
            <div style={{ textAlign: "right", fontFamily: "monospace", fontWeight: 700, color: T.green }}>{Number(d.total||0).toLocaleString("th-TH",{minimumFractionDigits:2})}</div>
            <div style={{ textAlign: "center", fontSize: 11, color: T.muted }}>
              {(d.attachments||[]).length > 0 ? <span style={{ color: T.green, fontWeight: 700 }}>📎 {d.attachments.length}</span> : "—"}
            </div>
            <div style={{ display: "flex", gap: 4, justifyContent: "center" }} onClick={e=>e.stopPropagation()}>
              <button onClick={()=>openEdit(d)} title="แก้ไข" style={{ padding: "4px 7px", borderRadius: 5, border: "1px solid rgba(184,134,0,0.3)", background: "rgba(184,134,0,0.08)", color: T.amber, cursor: "pointer", fontSize: 11 }}>✏️</button>
              {role?.canDelete && <button onClick={()=>setConfirmDel(d)} title="ลบ" style={{ padding: "4px 7px", borderRadius: 5, border: "1px solid rgba(185,74,72,0.3)", background: "rgba(185,74,72,0.08)", color: T.red, cursor: "pointer", fontSize: 11 }}>✕</button>}
            </div>
          </div>
        ))}
      </CardBox>

      {/* ── Form Modal ── */}
      {showForm && (
        <Modal onClose={()=>{setShowForm(false); setEditing(null);}} w={680}>
          <MHead title={editing ? "✏️ แก้ไขเอกสาร" : "➕ เพิ่มเอกสารภาษี"} onClose={()=>{setShowForm(false); setEditing(null);}} color={editing?T.amber:T.accent}/>

          <Section title="ประเภท + ข้อมูลพื้นฐาน">
            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 11, color: T.muted, display: "block", marginBottom: 4, fontWeight: 600 }}>ประเภทเอกสาร *</label>
              <select value={form.docType} onChange={e=>setForm(f=>({...f,docType:e.target.value}))}
                style={{ width: "100%", background: T.input, border: `1px solid ${T.inputBorder}`, color: T.text, borderRadius: 7, padding: "8px 12px", fontSize: 13, outline: "none", cursor: "pointer" }}>
                {DOC_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
            </div>
            <Grid2>
              <Field label="เลขที่เอกสาร" value={form.docNo} onChange={v=>setForm(f=>({...f,docNo:v}))}/>
              <Field label="วันที่ *" type="date" value={form.date} onChange={v=>setForm(f=>({...f,date:v}))}/>
              <Field label="คู่ค้า (ชื่อบริษัท/บุคคล)" value={form.party} onChange={v=>setForm(f=>({...f,party:v}))}/>
              <Field label="เลขผู้เสียภาษี คู่ค้า" value={form.partyTaxId} onChange={v=>setForm(f=>({...f,partyTaxId:v}))}/>
            </Grid2>
          </Section>

          <Section title="💰 จำนวนเงิน">
            <Grid2>
              <Field label="ยอดก่อนภาษี (฿)" type="number" value={form.amount} onChange={v=>setForm(f=>({...f,amount:v}))}/>
              <Field label="VAT (฿)" type="number" value={form.vat} onChange={v=>{
                setForm(f=>({...f, vat: v, total: (Number(f.amount)||0) + (Number(v)||0)}));
              }}/>
              <Field label="หัก ณ ที่จ่าย (%)" type="number" value={form.whtRate} onChange={v=>{
                const rate = Number(v) || 0;
                const amount = Number(form.amount) || 0;
                const wht = amount * rate / 100;
                setForm(f=>({...f, whtRate: v, whtAmount: wht.toFixed(2)}));
              }} placeholder="เช่น 3, 5"/>
              <Field label="หัก ณ ที่จ่าย (฿)" type="number" value={form.whtAmount} onChange={v=>setForm(f=>({...f,whtAmount:v}))}/>
              <Field label="ยอดรวมทั้งสิ้น (฿)" type="number" value={form.total} onChange={v=>setForm(f=>({...f,total:v}))}/>
            </Grid2>
          </Section>

          <Section title="📎 ไฟล์แนบ (PDF / รูปสแกน)">
            {(form.attachments || []).length > 0 && (
              <div style={{ marginBottom: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                {form.attachments.map((a, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: "rgba(59,91,139,0.06)", border: `1px solid ${T.border}`, borderRadius: 7 }}>
                    <div style={{ fontSize: 20 }}>{a.type?.includes("pdf") ? "📄" : a.type?.includes("image") ? "🖼️" : "📎"}</div>
                    <div style={{ flex: 1 }}>
                      <a href={a.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, fontWeight: 600, color: T.accent, textDecoration: "none" }}>{a.name}</a>
                      <div style={{ fontSize: 10, color: T.muted }}>{fmtBytes(a.size)}</div>
                    </div>
                    <button onClick={()=>removeAttachment(i)} style={{ padding: "4px 8px", border: "1px solid rgba(185,74,72,0.3)", borderRadius: 5, background: "rgba(185,74,72,0.08)", color: T.red, cursor: "pointer", fontSize: 11 }}>✕</button>
                  </div>
                ))}
              </div>
            )}
            <label style={{ display: "inline-block", padding: "10px 16px", border: `1px dashed ${T.border}`, borderRadius: 8, background: "rgba(59,91,139,0.04)", cursor: uploading ? "not-allowed" : "pointer", fontSize: 12, color: T.accent, fontWeight: 600 }}>
              {uploading ? "⏳ กำลังอัพโหลด..." : "📤 เพิ่มไฟล์ (PDF / รูป)"}
              <input type="file" accept="image/*,application/pdf" disabled={uploading} style={{ display: "none" }}
                onChange={e => { const f = e.target.files[0]; if (f) handleUpload(f); e.target.value=""; }}/>
            </label>
          </Section>

          <Section title="📝 หมายเหตุ">
            <textarea value={form.note} onChange={e=>setForm(f=>({...f, note: e.target.value}))} rows={2}
              placeholder="รายละเอียดเพิ่มเติม..."
              style={{ width: "100%", background: T.input, border: `1px solid ${T.inputBorder}`, color: T.text, borderRadius: 8, padding: "9px 12px", fontFamily: "'Sarabun',sans-serif", fontSize: 13, outline: "none", resize: "vertical" }}/>
          </Section>

          <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
            <BtnGhost onClick={()=>{setShowForm(false); setEditing(null);}} style={{ flex: 1 }}>ยกเลิก</BtnGhost>
            <BtnPrimary onClick={handleSave} style={{ flex: 2 }} disabled={!form.docType || !form.date}>
              💾 บันทึก
            </BtnPrimary>
          </div>
        </Modal>
      )}

      {/* View doc */}
      {viewDoc && (
        <Modal onClose={()=>setViewDoc(null)} w={680}>
          <MHead title={viewDoc._type?.label || "เอกสาร"} sub={`${viewDoc.docNo || "-"} · ${fmtDate(viewDoc.date)}`} onClose={()=>setViewDoc(null)} color={viewDoc._type?.color || T.accent}/>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14, padding: 12, background: "rgba(59,91,139,0.04)", borderRadius: 10 }}>
            <Row label="คู่ค้า" value={viewDoc.party}/>
            <Row label="เลขผู้เสียภาษี" value={viewDoc.partyTaxId}/>
            <Row label="ยอดก่อนภาษี" value={`฿${Number(viewDoc.amount||0).toLocaleString("th-TH",{minimumFractionDigits:2})}`}/>
            <Row label="VAT" value={`฿${Number(viewDoc.vat||0).toLocaleString("th-TH",{minimumFractionDigits:2})}`}/>
            <Row label="WHT" value={viewDoc.whtAmount?`฿${Number(viewDoc.whtAmount).toLocaleString("th-TH",{minimumFractionDigits:2})} (${viewDoc.whtRate||0}%)`:"—"}/>
            <Row label="ยอดรวม" value={`฿${Number(viewDoc.total||0).toLocaleString("th-TH",{minimumFractionDigits:2})}`}/>
          </div>
          {viewDoc.note && <div style={{ marginBottom: 14, padding: 10, background: "rgba(184,134,0,0.08)", borderRadius: 8, fontSize: 12, color: T.amber }}>📝 {viewDoc.note}</div>}
          {(viewDoc.attachments||[]).length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: T.muted, fontWeight: 700, marginBottom: 8 }}>📎 ไฟล์แนบ ({viewDoc.attachments.length})</div>
              {viewDoc.attachments.map((a, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: "rgba(59,91,139,0.06)", border: `1px solid ${T.border}`, borderRadius: 7, marginBottom: 6 }}>
                  <div style={{ fontSize: 20 }}>{a.type?.includes("pdf") ? "📄" : "🖼️"}</div>
                  <a href={a.url} target="_blank" rel="noopener noreferrer" style={{ flex: 1, fontSize: 12, fontWeight: 600, color: T.accent, textDecoration: "none" }}>{a.name}</a>
                  <a href={a.url} target="_blank" rel="noopener noreferrer" style={{ padding: "5px 12px", borderRadius: 6, background: T.accent, color: "white", fontSize: 11, fontWeight: 600, textDecoration: "none" }}>📥 ดู / ดาวน์โหลด</a>
                </div>
              ))}
            </div>
          )}
          <BtnPrimary onClick={()=>{ setViewDoc(null); openEdit(viewDoc); }} style={{ width: "100%" }}>✏️ แก้ไข</BtnPrimary>
        </Modal>
      )}

      {/* Delete Confirm */}
      {confirmDel && (
        <Modal onClose={()=>setConfirmDel(null)} w={420}>
          <MHead title="⚠️ ลบเอกสาร" onClose={()=>setConfirmDel(null)} color={T.red}/>
          <div style={{ fontSize: 13, color: T.text, marginBottom: 14 }}>
            ลบ <b>{confirmDel.docNo || "(ไม่มีเลขที่)"}</b> ของ <b>{confirmDel.party || "(ไม่ระบุ)"}</b>? <br/>
            <span style={{ fontSize: 11, color: T.muted }}>ไฟล์แนบจะถูกลบจาก storage ด้วย — กู้คืนไม่ได้</span>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <BtnGhost onClick={()=>setConfirmDel(null)} style={{ flex: 1 }}>ยกเลิก</BtnGhost>
            <button onClick={()=>handleDelete(confirmDel)} style={{ flex: 1, padding: "10px", borderRadius: 8, border: "none", background: T.red, color: "white", cursor: "pointer", fontSize: 13, fontWeight: 700, fontFamily: "'Sarabun',sans-serif" }}>
              🗑️ ลบ
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// helpers
function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11, color: T.accent, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  );
}
function Grid2({ children }) {
  return <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>{children}</div>;
}
function Field({ label, value, onChange, type="text", placeholder="" }) {
  return (
    <div>
      <label style={{ fontSize: 11, color: T.muted, display: "block", marginBottom: 4, fontWeight: 600 }}>{label}</label>
      <input type={type} value={value||""} onChange={e=>onChange(e.target.value)} placeholder={placeholder} onFocus={e=>type==="number"&&e.target.select()}
        style={{ width: "100%", background: T.input, border: `1px solid ${T.inputBorder}`, color: T.text, borderRadius: 7, padding: "8px 12px", fontFamily: type==="number"?"monospace":"'Sarabun',sans-serif", fontSize: 12, outline: "none", textAlign: type==="number"?"right":"left" }}/>
    </div>
  );
}
function Row({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: T.muted, fontWeight: 700, textTransform: "uppercase", marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 13, color: T.text, fontFamily: "monospace" }}>{value || "—"}</div>
    </div>
  );
}
