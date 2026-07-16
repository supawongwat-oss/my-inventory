// 👷 ติดตามบัตรลูกจ้าง — Work Permit / Visa / 90-day reporting
import { useState, useMemo } from "react";
import { db } from "../firebase";
import { collection as fsCollection, addDoc, updateDoc, deleteDoc, doc, serverTimestamp } from "firebase/firestore";
import { T } from "../theme";
import { Modal, MHead, BtnPrimary, BtnGhost, CardBox } from "../components/ui";
import { uploadFile, deleteFile, fmtBytes } from "../utils/upload";
import { logAudit, AUDIT_ACTIONS } from "../utils/audit";
import SewingTeamsPanel from "../components/SewingTeamsPanel";

const TODAY = () => { const d=new Date(); d.setHours(0,0,0,0); return d; };
const daysUntil = (dateStr) => {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  d.setHours(0,0,0,0);
  return Math.floor((d - TODAY()) / (1000*60*60*24));
};
const fmtDate = (d) => {
  if (!d) return "—";
  const dt = new Date(d);
  return `${String(dt.getDate()).padStart(2,"0")}/${String(dt.getMonth()+1).padStart(2,"0")}/${dt.getFullYear()+543}`;
};

// urgency level สำหรับวันหมดอายุ
const urgency = (dateStr) => {
  const d = daysUntil(dateStr);
  if (d === null) return { level: "none", color: T.muted, label: "—", bg: "transparent" };
  if (d < 0) return { level: "expired", color: T.red, label: `เลย ${Math.abs(d)} วัน`, bg: "rgba(185,74,72,0.15)" };
  if (d <= 7) return { level: "critical", color: T.red, label: `เหลือ ${d} วัน`, bg: "rgba(185,74,72,0.1)" };
  if (d <= 30) return { level: "warning", color: T.amber, label: `เหลือ ${d} วัน`, bg: "rgba(184,134,0,0.1)" };
  if (d <= 90) return { level: "soon", color: "#d97706", label: `เหลือ ${d} วัน`, bg: "rgba(217,119,6,0.06)" };
  return { level: "safe", color: T.green, label: `${d} วัน`, bg: "transparent" };
};

const EMPTY_FORM = {
  name: "", nameEn: "", department: "", position: "",
  nationality: "", idNumber: "", passportNo: "",
  workPermitNo: "", workPermitIssue: "", workPermitExpiry: "",
  visaType: "", visaExpiry: "",
  lastReport90: "", // last 90-day report date
  startDate: "", phone: "", note: "",
  attachments: [], // [{url, path, name, size, type, label}]
  // 💰 Payroll fields
  salaryType: "monthly", // monthly | daily | piecework
  baseSalary: 0,         // เงินเดือน (รายเดือน) หรือ ค่าจ้าง/วัน (รายวัน)
  pieceRate: 0,          // ค่าจ้าง/ชิ้น (piecework only)
  otRate: 0,             // ค่า OT/ชม.
  hasSSO: true,          // หักประกันสังคม
  bankName: "",          // ธนาคารสำหรับโอนเงินเดือน
  bankAccount: "",       // เลขบัญชี
  extraDeductionAnnual: 0, // ค่าลดหย่อนเพิ่ม/ปี (ลูก ประกัน) — สำหรับคำนวณภาษี
};

export default function EmployeeTab({ employees = [], user, role }) {
  const [view, setView] = useState("cards"); // cards = บัตรลูกจ้าง | teams = ทีมเย็บ
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null); // employee object
  const [form, setForm] = useState(EMPTY_FORM);
  const [filter, setFilter] = useState("ทั้งหมด"); // ทั้งหมด/expired/critical/warning
  const [deptFilter, setDeptFilter] = useState("ทั้งหมด");
  const [search, setSearch] = useState("");
  const [uploading, setUploading] = useState(false);
  const [confirmDel, setConfirmDel] = useState(null);

  // คำนวณ next-90 day deadline
  const next90Date = (lastReport) => {
    if (!lastReport) return null;
    const d = new Date(lastReport);
    d.setDate(d.getDate() + 90);
    return d.toISOString().slice(0, 10);
  };

  // ── enrich employees ด้วย calc ──
  const enriched = useMemo(() => employees.map(e => {
    const next90 = next90Date(e.lastReport90);
    return {
      ...e,
      _wp: urgency(e.workPermitExpiry),
      _visa: urgency(e.visaExpiry),
      _passport: urgency(e.passportExpiry),
      _report90: urgency(next90),
      _next90Date: next90,
      // ระดับ urgent สูงสุด (สำหรับ filter)
      _topUrgency: ["wp","visa","report90","passport"]
        .map(k => urgency(e[k+"Expiry"] || (k==="report90"?next90:null)).level)
        .find(l => ["expired","critical","warning"].includes(l)) || "safe",
    };
  }), [employees]);

  // departments unique
  const departments = useMemo(() => {
    return [...new Set(employees.map(e => e.department).filter(Boolean))].sort();
  }, [employees]);

  // filtered list
  const filtered = useMemo(() => {
    return enriched.filter(e => {
      if (deptFilter !== "ทั้งหมด" && e.department !== deptFilter) return false;
      if (filter === "ใกล้หมดอายุ" && !["expired","critical","warning"].includes(e._topUrgency)) return false;
      if (filter === "หมดอายุแล้ว" && e._topUrgency !== "expired") return false;
      if (search) {
        const q = search.toLowerCase();
        const hay = `${e.name} ${e.nameEn} ${e.idNumber} ${e.passportNo} ${e.workPermitNo} ${e.department} ${e.position}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [enriched, filter, deptFilter, search]);

  // summary cards
  const summary = useMemo(() => {
    let total = enriched.length, expired = 0, critical = 0, warning = 0;
    enriched.forEach(e => {
      const top = e._topUrgency;
      if (top === "expired") expired++;
      else if (top === "critical") critical++;
      else if (top === "warning") warning++;
    });
    return { total, expired, critical, warning };
  }, [enriched]);

  // ── form handlers ──
  const openNew = () => { setEditing(null); setForm({...EMPTY_FORM}); setShowForm(true); };
  const openEdit = (e) => {
    setEditing(e);
    setForm({
      ...EMPTY_FORM,
      ...e,
      attachments: e.attachments || [],
    });
    setShowForm(true);
  };

  const handleUpload = async (file, label = "") => {
    if (!file) return;
    setUploading(true);
    try {
      const meta = await uploadFile(file, `employees/${form.idNumber || form.passportNo || "misc"}`);
      setForm(f => ({ ...f, attachments: [...(f.attachments||[]), { ...meta, label }] }));
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

  const handleSave = async () => {
    if (!form.name.trim()) { alert("กรุณากรอกชื่อ"); return; }
    const data = {
      ...form,
      updatedBy: user.name,
      updatedAt: new Date().toISOString(),
    };
    try {
      if (editing) {
        await updateDoc(doc(db, "employees", editing.id), data);
        logAudit(user, { action: AUDIT_ACTIONS.UPDATE, collection: "employees", targetId: editing.id, targetLabel: form.name });
      } else {
        data.createdAt = serverTimestamp();
        data.createdBy = user.name;
        const ref = await addDoc(fsCollection(db, "employees"), data);
        logAudit(user, { action: AUDIT_ACTIONS.CREATE, collection: "employees", targetId: ref.id, targetLabel: form.name });
      }
      setShowForm(false);
      setEditing(null);
      setForm(EMPTY_FORM);
    } catch (e) {
      alert("บันทึกไม่สำเร็จ: " + (e.message || e));
    }
  };

  const handleDelete = async (emp) => {
    // ลบ attachments ด้วย
    for (const a of (emp.attachments || [])) {
      if (a.path) await deleteFile(a.path);
    }
    await deleteDoc(doc(db, "employees", emp.id));
    logAudit(user, { action: AUDIT_ACTIONS.DELETE, collection: "employees", targetId: emp.id, targetLabel: emp.name });
    setConfirmDel(null);
  };

  // Update 90-day report (one-click)
  const markReport90Done = async (emp) => {
    const today = new Date().toISOString().slice(0, 10);
    await updateDoc(doc(db, "employees", emp.id), { lastReport90: today });
    logAudit(user, { action: AUDIT_ACTIONS.UPDATE, collection: "employees", targetId: emp.id, targetLabel: emp.name, note: "รายงาน 90 วัน — มาร์คเสร็จ" });
  };

  // ────────── RENDER ──────────
  return (
    <div style={{ animation: "fadeUp 0.4s ease" }}>
      {/* Sub-tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 14, padding: 4, background: T.card, borderRadius: 12, border: `1px solid ${T.border}`, width: "fit-content" }}>
        {[
          { id: "cards", icon: "👷", label: "บัตรลูกจ้าง" },
          { id: "teams", icon: "👥", label: "ทีมเย็บ" },
        ].map(t => (
          <button key={t.id} onClick={()=>setView(t.id)}
            style={{ padding: "8px 18px", borderRadius: 9, border: "none", cursor: "pointer",
              background: view===t.id ? "linear-gradient(135deg,#3b5b8b,#3b5b8b)" : "transparent",
              color: view===t.id ? "white" : T.sub,
              fontSize: 13, fontWeight: view===t.id ? 700 : 500, fontFamily: "inherit" }}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {view === "teams" ? (
        <SewingTeamsPanel employees={employees} user={user} role={role}/>
      ) : (
      <>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: T.text }}>👷 ติดตามบัตรลูกจ้าง — Work Permit / Visa / 90-day Report</div>
          <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>ดูสถานะวันหมดอายุของพนักงานต่างชาติ + แจ้งเตือนล่วงหน้า</div>
        </div>
        {role?.canAdd !== false && (
          <BtnPrimary onClick={openNew}>＋ เพิ่มพนักงาน</BtnPrimary>
        )}
      </div>

      {/* Summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 14 }}>
        {[
          { label: "ทั้งหมด", value: summary.total, color: T.accent, bg: "rgba(59,91,139,0.08)" },
          { label: "🚨 หมดอายุ", value: summary.expired, color: T.red, bg: "rgba(185,74,72,0.1)" },
          { label: "⚠️ <7 วัน", value: summary.critical, color: T.red, bg: "rgba(185,74,72,0.06)" },
          { label: "📅 <30 วัน", value: summary.warning, color: T.amber, bg: "rgba(184,134,0,0.08)" },
        ].map((s,i) => (
          <div key={i} style={{ padding: 14, background: s.bg, border: `1px solid ${T.border}`, borderRadius: 10 }}>
            <div style={{ fontSize: 10, color: T.muted, fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: 22, fontWeight: 800, fontFamily: "monospace", color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="🔍 ค้นหาชื่อ/passport/work permit..."
          style={{ flex: 1, minWidth: 200, background: T.input, border: `1px solid ${T.inputBorder}`, color: T.text, borderRadius: 7, padding: "8px 12px", fontFamily: "'Sarabun',sans-serif", fontSize: 13, outline: "none" }}/>
        <select value={deptFilter} onChange={e=>setDeptFilter(e.target.value)}
          style={{ background: T.input, border: `1px solid ${T.inputBorder}`, color: T.text, borderRadius: 7, padding: "8px 10px", fontSize: 12, outline: "none", cursor: "pointer" }}>
          <option>ทั้งหมด</option>
          {departments.map(d => <option key={d}>{d}</option>)}
        </select>
        <div style={{ display: "flex", gap: 4 }}>
          {["ทั้งหมด","ใกล้หมดอายุ","หมดอายุแล้ว"].map(f => (
            <button key={f} onClick={()=>setFilter(f)}
              style={{ padding: "7px 12px", borderRadius: 7, border: `1px solid ${filter===f?T.accent:T.border}`, background: filter===f?"rgba(59,91,139,0.12)":"transparent", color: filter===f?T.accent:T.sub, cursor: "pointer", fontSize: 12, fontWeight: filter===f?700:500 }}>
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* List — wrap ใน .table-scroll → iOS เลื่อนซ้ายขวาได้ */}
      <CardBox style={{ padding: 0, overflow: "hidden" }}>
        <div className="table-scroll" style={{ minWidth: 0 }}>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(180px,1fr) 100px 120px 120px 120px 120px 90px", minWidth: 850, padding: "10px 16px", background: "#f8f9fb", fontSize: 10, color: T.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", borderBottom: `1px solid ${T.border}` }}>
          <div>พนักงาน / แผนก</div>
          <div>สัญชาติ</div>
          <div>Work Permit</div>
          <div>Visa</div>
          <div>90-day</div>
          <div>Passport</div>
          <div style={{textAlign:"center"}}>จัดการ</div>
        </div>
        {filtered.length === 0 ? (
          <div style={{ padding: 30, textAlign: "center", color: T.muted, fontSize: 13 }}>
            {employees.length === 0 ? "ยังไม่มีพนักงาน — กด '+ เพิ่มพนักงาน' เพื่อเริ่ม" : "ไม่พบพนักงานตามเงื่อนไข"}
          </div>
        ) : filtered.map((e, i) => (
          <div key={e.id} style={{ display: "grid", gridTemplateColumns: "minmax(180px,1fr) 100px 120px 120px 120px 120px 90px", minWidth: 850, alignItems: "center", padding: "12px 16px", borderBottom: i<filtered.length-1?`1px solid ${T.border}`:"none", fontSize: 12, background: e._topUrgency === "expired" ? "rgba(185,74,72,0.04)" : e._topUrgency === "critical" ? "rgba(185,74,72,0.02)" : "transparent" }}>
            <div>
              <div style={{ fontWeight: 600, color: T.text, fontSize: 13 }}>{e.name}</div>
              <div style={{ fontSize: 10, color: T.muted }}>
                {e.nameEn && <span>{e.nameEn} · </span>}
                {e.position && <span>{e.position} · </span>}
                {e.department || "—"}
              </div>
            </div>
            <div style={{ fontSize: 11, color: T.sub }}>{e.nationality || "—"}</div>
            <DateCell value={e.workPermitExpiry} urgency={e._wp}/>
            <DateCell value={e.visaExpiry} urgency={e._visa}/>
            <div>
              <DateCell value={e._next90Date} urgency={e._report90}/>
              {e._report90.level !== "none" && (e._report90.level === "expired" || e._report90.level === "critical") && (
                <button onClick={()=>markReport90Done(e)} style={{ marginTop: 3, padding: "2px 8px", borderRadius: 5, border: "1px solid rgba(58,122,82,0.3)", background: "rgba(58,122,82,0.1)", color: T.green, cursor: "pointer", fontSize: 9, fontWeight: 600, fontFamily: "'Sarabun',sans-serif" }}>
                  ✓ ทำแล้ว
                </button>
              )}
            </div>
            <DateCell value={e.passportExpiry} urgency={e._passport}/>
            <div style={{ display: "flex", gap: 4, justifyContent: "center" }}>
              <button onClick={()=>openEdit(e)} title="แก้ไข" style={{ padding: "5px 8px", borderRadius: 6, border: "1px solid rgba(184,134,0,0.3)", background: "rgba(184,134,0,0.08)", color: T.amber, cursor: "pointer", fontSize: 11 }}>✏️</button>
              {role?.canDelete && (
                <button onClick={()=>setConfirmDel(e)} title="ลบ" style={{ padding: "5px 8px", borderRadius: 6, border: "1px solid rgba(185,74,72,0.3)", background: "rgba(185,74,72,0.08)", color: T.red, cursor: "pointer", fontSize: 11 }}>✕</button>
              )}
            </div>
          </div>
        ))}
        </div>
      </CardBox>
      </>
      )}

      {/* ── Form Modal ── */}
      {showForm && (
        <Modal onClose={()=>{setShowForm(false); setEditing(null);}} w={760}>
          <MHead title={editing ? `✏️ แก้ไข — ${editing.name}` : "➕ เพิ่มพนักงาน"} onClose={()=>{setShowForm(false); setEditing(null);}} color={editing?T.amber:T.accent}/>

          {/* Section: ข้อมูลทั่วไป */}
          <Section title="👤 ข้อมูลทั่วไป">
            <Grid2>
              <Field label="ชื่อ (ไทย) *" value={form.name} onChange={v=>setForm(f=>({...f,name:v}))}/>
              <Field label="ชื่อ (อังกฤษ)" value={form.nameEn} onChange={v=>setForm(f=>({...f,nameEn:v}))}/>
              <Field label="แผนก" value={form.department} onChange={v=>setForm(f=>({...f,department:v}))} placeholder="เช่น ผลิต, บัญชี, คลัง"/>
              <Field label="ตำแหน่ง" value={form.position} onChange={v=>setForm(f=>({...f,position:v}))}/>
              <Field label="สัญชาติ" value={form.nationality} onChange={v=>setForm(f=>({...f,nationality:v}))} placeholder="เช่น พม่า, ลาว, กัมพูชา"/>
              <Field label="เบอร์โทร" value={form.phone} onChange={v=>setForm(f=>({...f,phone:v}))}/>
              <Field label="วันเริ่มงาน" type="date" value={form.startDate} onChange={v=>setForm(f=>({...f,startDate:v}))}/>
              <Field label="เลข ID / บัตร 13 หลัก" value={form.idNumber} onChange={v=>setForm(f=>({...f,idNumber:v}))}/>
            </Grid2>
          </Section>

          {/* Section: Passport */}
          <Section title="📕 Passport">
            <Grid2>
              <Field label="เลข Passport" value={form.passportNo} onChange={v=>setForm(f=>({...f,passportNo:v}))}/>
              <Field label="วันหมดอายุ Passport" type="date" value={form.passportExpiry} onChange={v=>setForm(f=>({...f,passportExpiry:v}))}/>
            </Grid2>
          </Section>

          {/* Section: Work Permit */}
          <Section title="🪪 ใบอนุญาตทำงาน (Work Permit)">
            <Grid2>
              <Field label="เลข Work Permit" value={form.workPermitNo} onChange={v=>setForm(f=>({...f,workPermitNo:v}))}/>
              <Field label="ประเภท Visa" value={form.visaType} onChange={v=>setForm(f=>({...f,visaType:v}))} placeholder="เช่น Non-B, Education"/>
              <Field label="วันที่ออก WP" type="date" value={form.workPermitIssue} onChange={v=>setForm(f=>({...f,workPermitIssue:v}))}/>
              <Field label="วันหมดอายุ WP" type="date" value={form.workPermitExpiry} onChange={v=>setForm(f=>({...f,workPermitExpiry:v}))}/>
              <Field label="วันหมดอายุ Visa" type="date" value={form.visaExpiry} onChange={v=>setForm(f=>({...f,visaExpiry:v}))}/>
              <Field label="วันรายงาน 90 วัน ล่าสุด" type="date" value={form.lastReport90} onChange={v=>setForm(f=>({...f,lastReport90:v}))}/>
            </Grid2>
            {form.lastReport90 && (
              <div style={{ marginTop: 8, padding: 10, background: "rgba(59,91,139,0.06)", borderRadius: 7, fontSize: 11, color: T.accent }}>
                📅 ต้องรายงานครั้งถัดไป: <b>{fmtDate(next90Date(form.lastReport90))}</b>
              </div>
            )}
          </Section>

          {/* Section: Attachments */}
          <Section title="📎 ไฟล์แนบ (สแกน Passport, Work Permit, รูป ฯลฯ)">
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

          {/* 💰 Salary — admin เท่านั้น */}
          {user?.role === "admin" && (
          <Section title="💰 เงินเดือน & ค่าจ้าง">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
              <div>
                <label style={{ fontSize: 11, color: T.sub, fontWeight: 600, display: "block", marginBottom: 4 }}>ประเภทค่าจ้าง</label>
                <select value={form.salaryType||"monthly"} onChange={e=>setForm(f=>({...f, salaryType: e.target.value}))}
                  style={{ width: "100%", background: T.input, border: `1px solid ${T.inputBorder}`, borderRadius: 8, padding: "8px 12px", fontSize: 13, fontFamily: "inherit" }}>
                  <option value="monthly">📆 รายเดือน</option>
                  <option value="daily">📅 รายวัน</option>
                  <option value="piecework">📊 รายชิ้น</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: 11, color: T.sub, fontWeight: 600, display: "block", marginBottom: 4 }}>
                  {form.salaryType === "daily" ? "ค่าจ้าง/วัน (฿)" : form.salaryType === "piecework" ? "ฐานเงินเดือน (ถ้ามี, ฿)" : "เงินเดือน (฿)"}
                </label>
                <input type="number" value={form.baseSalary||""} onChange={e=>setForm(f=>({...f, baseSalary: Number(e.target.value)||0}))} onFocus={e=>e.target.select()} placeholder="0"
                  style={{ width: "100%", background: T.input, border: `1px solid ${T.inputBorder}`, borderRadius: 8, padding: "8px 12px", fontSize: 13, fontFamily: "monospace" }}/>
              </div>
              {form.salaryType === "piecework" && (
                <div>
                  <label style={{ fontSize: 11, color: T.sub, fontWeight: 600, display: "block", marginBottom: 4 }}>ค่าจ้าง/ชิ้น (฿)</label>
                  <input type="number" value={form.pieceRate||""} onChange={e=>setForm(f=>({...f, pieceRate: Number(e.target.value)||0}))} onFocus={e=>e.target.select()} placeholder="0"
                    style={{ width: "100%", background: T.input, border: `1px solid ${T.inputBorder}`, borderRadius: 8, padding: "8px 12px", fontSize: 13, fontFamily: "monospace" }}/>
                </div>
              )}
              <div>
                <label style={{ fontSize: 11, color: T.sub, fontWeight: 600, display: "block", marginBottom: 4 }}>ค่า OT/ชม. (฿)</label>
                <input type="number" value={form.otRate||""} onChange={e=>setForm(f=>({...f, otRate: Number(e.target.value)||0}))} onFocus={e=>e.target.select()} placeholder="0"
                  style={{ width: "100%", background: T.input, border: `1px solid ${T.inputBorder}`, borderRadius: 8, padding: "8px 12px", fontSize: 13, fontFamily: "monospace" }}/>
              </div>
              <div>
                <label style={{ fontSize: 11, color: T.sub, fontWeight: 600, display: "block", marginBottom: 4 }}>ธนาคาร</label>
                <input value={form.bankName||""} onChange={e=>setForm(f=>({...f, bankName: e.target.value}))} placeholder="เช่น กสิกรไทย"
                  style={{ width: "100%", background: T.input, border: `1px solid ${T.inputBorder}`, borderRadius: 8, padding: "8px 12px", fontSize: 13 }}/>
              </div>
              <div>
                <label style={{ fontSize: 11, color: T.sub, fontWeight: 600, display: "block", marginBottom: 4 }}>เลขบัญชี (สำหรับโอนเงินเดือน)</label>
                <input value={form.bankAccount||""} onChange={e=>setForm(f=>({...f, bankAccount: e.target.value}))} placeholder="xxx-x-xxxxx-x"
                  style={{ width: "100%", background: T.input, border: `1px solid ${T.inputBorder}`, borderRadius: 8, padding: "8px 12px", fontSize: 13, fontFamily: "monospace" }}/>
              </div>
              <div>
                <label style={{ fontSize: 11, color: T.sub, fontWeight: 600, display: "block", marginBottom: 4 }}>ค่าลดหย่อนเพิ่ม/ปี (฿)</label>
                <input type="number" value={form.extraDeductionAnnual||""} onChange={e=>setForm(f=>({...f, extraDeductionAnnual: Number(e.target.value)||0}))} onFocus={e=>e.target.select()} placeholder="0"
                  style={{ width: "100%", background: T.input, border: `1px solid ${T.inputBorder}`, borderRadius: 8, padding: "8px 12px", fontSize: 13, fontFamily: "monospace" }}/>
              </div>
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
              <input type="checkbox" checked={form.hasSSO !== false} onChange={e=>setForm(f=>({...f, hasSSO: e.target.checked}))}/>
              หักประกันสังคม 5% (สูงสุด ฿750/เดือน)
            </label>
          </Section>
          )}

          {/* Note */}
          <Section title="📝 หมายเหตุ">
            <textarea value={form.note} onChange={e=>setForm(f=>({...f, note: e.target.value}))} rows={3}
              placeholder="ข้อมูลเพิ่มเติม..."
              style={{ width: "100%", background: T.input, border: `1px solid ${T.inputBorder}`, color: T.text, borderRadius: 8, padding: "9px 12px", fontFamily: "'Sarabun',sans-serif", fontSize: 13, outline: "none", resize: "vertical" }}/>
          </Section>

          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            <BtnGhost onClick={()=>{setShowForm(false); setEditing(null);}} style={{ flex: 1 }}>ยกเลิก</BtnGhost>
            <BtnPrimary onClick={handleSave} style={{ flex: 2 }} disabled={!form.name.trim()}>
              💾 บันทึก
            </BtnPrimary>
          </div>
        </Modal>
      )}

      {/* Delete Confirm */}
      {confirmDel && (
        <Modal onClose={()=>setConfirmDel(null)} w={420}>
          <MHead title="⚠️ ลบพนักงาน" onClose={()=>setConfirmDel(null)} color={T.red}/>
          <div style={{ fontSize: 13, color: T.text, marginBottom: 14 }}>
            ลบข้อมูล <b>{confirmDel.name}</b>? <br/>
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

// ────────── helpers ──────────
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

function Field({ label, value, onChange, type = "text", placeholder = "" }) {
  return (
    <div>
      <label style={{ fontSize: 11, color: T.muted, display: "block", marginBottom: 4, fontWeight: 600 }}>{label}</label>
      <input type={type} value={value || ""} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        style={{ width: "100%", background: T.input, border: `1px solid ${T.inputBorder}`, color: T.text, borderRadius: 7, padding: "8px 12px", fontFamily: "'Sarabun',sans-serif", fontSize: 12, outline: "none" }}/>
    </div>
  );
}

function DateCell({ value, urgency }) {
  if (!value) return <div style={{ fontSize: 11, color: T.muted }}>—</div>;
  return (
    <div>
      <div style={{ fontSize: 11, color: T.text, fontFamily: "monospace" }}>{fmtDate(value)}</div>
      <div style={{ fontSize: 9, color: urgency.color, fontWeight: 600, marginTop: 1 }}>{urgency.label}</div>
    </div>
  );
}
