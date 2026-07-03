// 💰 Payroll Tab — บันทึกเวลา + คำนวณเงินเดือน + พิมพ์ slip
import { useState, useMemo } from "react";
import { db } from "../firebase";
import { collection, addDoc, doc, setDoc, deleteDoc, serverTimestamp } from "firebase/firestore";
import { T } from "../theme";
import { calculatePaySlip, summarizeAttendance, workingDaysInMonth } from "../utils/payroll";
import { logAudit } from "../utils/audit";

const fmt = (n) => Number(n || 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtInt = (n) => Number(n || 0).toLocaleString("th-TH");

const STATUS_LABELS = {
  present:  { label: "มา",       color: "#3a7a52", bg: "#dcfce7", short: "✓" },
  absent:   { label: "ขาด",      color: "#b94a48", bg: "#fee2e2", short: "✕" },
  late:     { label: "สาย",      color: "#b88600", bg: "#fef3c7", short: "L" },
  halfday:  { label: "ครึ่งวัน",  color: "#0891b2", bg: "#cffafe", short: "½" },
  leave:    { label: "ลา",       color: "#7c3aed", bg: "#ede9fe", short: "ล" },
  holiday:  { label: "วันหยุด",   color: "#6b7280", bg: "#f1f5f9", short: "—" },
};

export default function PayrollTab({ employees = [], attendance = [], payrollRuns = [], user, role, printElementById }) {
  const [subtab, setSubtab] = useState("attendance"); // attendance | run | history
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1); // 1-12

  // 📅 Attendance — ติ๊ก mark วันมา/ขาดต่อพนักงาน รายวัน
  const daysInMonth = new Date(year, month, 0).getDate();
  const wdInMonth = useMemo(() => workingDaysInMonth(year, month), [year, month]);
  const monthKey = `${year}-${String(month).padStart(2,"0")}`;

  const monthAttendance = useMemo(() =>
    attendance.filter(r => (r.date||"").startsWith(monthKey)),
  [attendance, monthKey]);

  const setAttendance = async (employeeId, dateStr, patch) => {
    const docId = `${employeeId}_${dateStr}`;
    const existing = attendance.find(r => r.id === docId);
    const payload = {
      employeeId,
      date: dateStr,
      status: "present",
      otHours: 0,
      piecesProduced: 0,
      note: "",
      ...existing,
      ...patch,
      updatedAt: serverTimestamp(),
      updatedBy: user?.name || "",
    };
    delete payload.id;
    try {
      await setDoc(doc(db, "attendance", docId), payload);
    } catch (e) {
      console.error("[attendance] save failed:", e);
      if (String(e.message||"").includes("permission") || String(e.code||"").includes("permission")) {
        alert("⚠️ Firestore Rules ยังไม่อนุญาตให้เขียนใน 'attendance'\n\nวิธีแก้:\n1. ไป Firebase Console → Firestore → Rules\n2. เพิ่มบรรทัด: match /attendance/{doc} { allow read, write: if request.auth != null; }\n3. กด Publish\n4. กลับมาคลิกใหม่");
      } else {
        alert("บันทึกไม่สำเร็จ: " + (e.message||e));
      }
    }
  };

  const clearDay = async (employeeId, dateStr) => {
    const docId = `${employeeId}_${dateStr}`;
    try { await deleteDoc(doc(db, "attendance", docId)); }
    catch (e) { console.error("[attendance] clear failed:", e); }
  };

  // 💰 Run payroll — สร้าง pay slips ทั้งหมดในเดือน
  const [runResult, setRunResult] = useState(null); // [{employee, slip}]
  const [adjustments, setAdjustments] = useState({}); // {empId: {bonus,advance,penalty,...}}
  const [saving, setSaving] = useState(false);

  // 💡 default present mode — ถ้า on, นับวันทำงาน (จ-ศ) ที่ไม่มี record = "มา" auto
  const [usDefaultPresent, setUsDefaultPresent] = useState(true);

  const generatePayslips = () => {
    const slips = employees.map(emp => {
      const summary = summarizeAttendance(monthAttendance, emp.id);
      // 💡 เติมวันมาที่ "นับ default" ให้ — สำหรับวันทำงาน(จ-ศ) ที่ผ่านมาแล้วและไม่มี record
      if (usDefaultPresent) {
        let extraPresent = 0;
        const today = new Date();
        for (let d = 1; d <= new Date(year, month, 0).getDate(); d++) {
          const dt = new Date(year, month-1, d);
          if (dt > today) continue;
          const dow = dt.getDay();
          if (dow === 0 || dow === 6) continue;
          const ds = `${year}-${String(month).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
          const hasRec = monthAttendance.some(r => r.employeeId === emp.id && r.date === ds);
          if (!hasRec) extraPresent++;
        }
        summary.daysPresent += extraPresent;
      }
      const adj = adjustments[emp.id] || {};
      const slip = calculatePaySlip(emp, { ...summary, workDaysInMonth: wdInMonth }, adj);
      return { employee: emp, slip };
    }).filter(r => r.slip.earnings.gross > 0);
    setRunResult(slips);
  };

  const saveRun = async () => {
    if (!runResult || runResult.length === 0) { alert("ยังไม่ได้คำนวณ — กด 'คำนวณ' ก่อน"); return; }
    if (!window.confirm(`บันทึกการจ่ายเงินเดือน ${month}/${year}?\nพนักงาน ${runResult.length} คน\nยอดสุทธิรวม ฿${fmt(runResult.reduce((s,r)=>s+r.slip.net,0))}\n\nบันทึกแล้วจะแก้ไม่ได้ — ต้องการให้แน่ใจ`)) return;
    setSaving(true);
    try {
      const totalGross = runResult.reduce((s,r)=>s+r.slip.earnings.gross, 0);
      const totalNet = runResult.reduce((s,r)=>s+r.slip.net, 0);
      const totalDeductions = runResult.reduce((s,r)=>s+r.slip.deductions.total, 0);
      const ref = await addDoc(collection(db, "payrollRuns"), {
        year, month, monthKey,
        runDate: new Date().toISOString().slice(0,10),
        slips: runResult.map(r => r.slip),
        totalGross, totalNet, totalDeductions,
        employeeCount: runResult.length,
        workDaysInMonth: wdInMonth,
        by: user?.name || "",
        createdAt: serverTimestamp(),
      });
      logAudit(user, {
        action: "PAYROLL_RUN",
        collection: "payrollRuns",
        targetId: ref.id,
        targetLabel: `Payroll ${month}/${year}`,
        note: `${runResult.length} คน · สุทธิ ฿${fmt(totalNet)}`,
      });
      alert(`✅ บันทึกแล้ว ${runResult.length} pay slips`);
      setRunResult(null);
      setAdjustments({});
      setSubtab("history");
    } catch (e) {
      alert("บันทึกล้มเหลว: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: T.text }}>💰 ระบบเงินเดือน</div>
        <div style={{ fontSize: 12, color: T.muted, marginTop: 4 }}>บันทึกเวลา · คำนวณ · พิมพ์ใบเงินเดือน</div>
      </div>

      {/* Sub-tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 16, padding: 4, background: T.card, borderRadius: 12, border: `1px solid ${T.border}`, width: "fit-content", flexWrap: "wrap" }}>
        {[
          { id: "attendance", icon: "📅", label: "บันทึกเวลา" },
          { id: "run",        icon: "💰", label: "จ่ายเงินเดือน" },
          { id: "history",    icon: "📜", label: "ประวัติ" },
        ].map(t => (
          <button key={t.id} onClick={()=>setSubtab(t.id)}
            style={{ padding: "8px 18px", borderRadius: 9, border: "none", cursor: "pointer",
              background: subtab===t.id ? "linear-gradient(135deg,#3b5b8b,#3b5b8b)" : "transparent",
              color: subtab===t.id ? "white" : T.sub,
              fontSize: 13, fontWeight: subtab===t.id ? 700 : 500, fontFamily: "inherit" }}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Year/Month selector — common */}
      <div style={{ display: "flex", gap: 8, marginBottom: 14, alignItems: "center", flexWrap: "wrap", padding: 10, background: T.card, borderRadius: 10, border: `1px solid ${T.border}` }}>
        <span style={{ fontSize: 12, color: T.sub, fontWeight: 600 }}>เดือน:</span>
        <select value={month} onChange={e=>setMonth(Number(e.target.value))}
          style={{ padding: "6px 10px", borderRadius: 7, border: `1px solid ${T.border}`, fontSize: 13, fontFamily: "inherit" }}>
          {Array.from({length:12}).map((_,i) => (
            <option key={i+1} value={i+1}>{["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."][i]}</option>
          ))}
        </select>
        <select value={year} onChange={e=>setYear(Number(e.target.value))}
          style={{ padding: "6px 10px", borderRadius: 7, border: `1px solid ${T.border}`, fontSize: 13, fontFamily: "inherit" }}>
          {[year-2, year-1, year, year+1].map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <span style={{ fontSize: 11, color: T.muted, marginLeft: 8 }}>
          วันทำงาน (จ-ศ): <b style={{ color: T.blue }}>{wdInMonth} วัน</b> · มีพนักงาน <b>{employees.length}</b> คน
        </span>
      </div>

      {/* ── ATTENDANCE ── */}
      {subtab === "attendance" && (
        <AttendanceGrid
          employees={employees}
          monthAttendance={monthAttendance}
          year={year} month={month} daysInMonth={daysInMonth}
          monthKey={monthKey}
          onSet={setAttendance}
          onClear={clearDay}
          user={user}
        />
      )}

      {/* ── RUN PAYROLL ── */}
      {subtab === "run" && (
        <RunPayroll
          employees={employees}
          monthAttendance={monthAttendance}
          wdInMonth={wdInMonth}
          runResult={runResult}
          setRunResult={setRunResult}
          adjustments={adjustments}
          setAdjustments={setAdjustments}
          generatePayslips={generatePayslips}
          saveRun={saveRun}
          saving={saving}
          month={month} year={year}
          printElementById={printElementById}
          usDefaultPresent={usDefaultPresent}
          setUsDefaultPresent={setUsDefaultPresent}
        />
      )}

      {/* ── HISTORY ── */}
      {subtab === "history" && (
        <PayrollHistory
          payrollRuns={payrollRuns}
          printElementById={printElementById}
        />
      )}
    </div>
  );
}

// ── ATTENDANCE GRID ────────────────────────────────────────────
function AttendanceGrid({ employees, monthAttendance, year, month, daysInMonth, monthKey, onSet, onClear, user }) {
  const [filter, setFilter] = useState("");
  const [filterDept, setFilterDept] = useState("");
  const [filterType, setFilterType] = useState("all"); // all | monthly | daily | piecework
  // 💡 Default Present mode — แสดงเป็น "มา" auto สำหรับวันทำงานที่ไม่มี record
  // → admin คลิกแค่คนที่ขาด/สาย (อิงตามนโยบายโรงงาน)
  const [defaultPresent, setDefaultPresent] = useState(true);
  const [pieceMode, setPieceMode] = useState(false); // toggle: show piece count input

  const departments = [...new Set(employees.map(e => e.department).filter(Boolean))].sort();

  const filteredEmps = employees.filter(e => {
    if (filterType !== "all" && (e.salaryType || "monthly") !== filterType) return false;
    if (filterDept && e.department !== filterDept) return false;
    if (!filter) return true;
    const q = filter.toLowerCase();
    return (e.name||"").toLowerCase().includes(q) || (e.department||"").toLowerCase().includes(q);
  });

  const getRecord = (empId, dateStr) => monthAttendance.find(r => r.employeeId === empId && r.date === dateStr);
  const dateStr = (d) => `${monthKey}-${String(d).padStart(2,"0")}`;
  const isWeekend = (d) => {
    const dow = new Date(year, month-1, d).getDay();
    return dow === 0 || dow === 6;
  };
  const isPast = (d) => new Date(year, month-1, d) <= new Date();

  // 🎯 Bulk: mark all "present" for a single day (filtered)
  const markAllPresent = async (d) => {
    const ds = dateStr(d);
    if (!window.confirm(`Mark "มา" ${filteredEmps.length} คนสำหรับวันที่ ${d}/${month}/${year}?`)) return;
    for (const emp of filteredEmps) {
      if (!getRecord(emp.id, ds)) await onSet(emp.id, ds, { status: "present" });
    }
  };

  // 🎯 Bulk: mark entire row (employee) for all weekdays as present
  const markRowPresent = async (emp) => {
    if (!window.confirm(`Mark "มา" ทุกวันทำงาน (จ-ศ) สำหรับ ${emp.name}?`)) return;
    for (let d = 1; d <= daysInMonth; d++) {
      if (isWeekend(d)) continue;
      if (!isPast(d)) continue;
      const ds = dateStr(d);
      if (!getRecord(emp.id, ds)) await onSet(emp.id, ds, { status: "present" });
    }
  };

  // 🚀 Bulk: mark ALL filtered employees ALL weekdays as present
  const markAllMonth = async () => {
    if (!window.confirm(`Mark "มา" ทุกวันทำงาน (จ-ศ) ทั้งเดือนสำหรับ ${filteredEmps.length} คน?\n\nคนที่มี record อยู่แล้วจะไม่ถูกเปลี่ยน — เฉพาะช่องว่าง`)) return;
    let count = 0;
    for (const emp of filteredEmps) {
      for (let d = 1; d <= daysInMonth; d++) {
        if (isWeekend(d) || !isPast(d)) continue;
        const ds = dateStr(d);
        if (!getRecord(emp.id, ds)) { await onSet(emp.id, ds, { status: "present" }); count++; }
      }
    }
    alert(`✅ Mark "มา" สำเร็จ ${count} record`);
  };

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input value={filter} onChange={e=>setFilter(e.target.value)}
          placeholder="🔍 ค้นชื่อ/แผนก..."
          style={{ flex: "1 1 180px", padding: "8px 12px", borderRadius: 8, border: `1px solid ${T.border}`, fontSize: 13, fontFamily: "inherit" }}/>
        {departments.length > 0 && (
          <select value={filterDept} onChange={e=>setFilterDept(e.target.value)}
            style={{ padding: "8px 10px", borderRadius: 8, border: `1px solid ${T.border}`, fontSize: 13, fontFamily: "inherit" }}>
            <option value="">ทุกแผนก</option>
            {departments.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        )}
        <select value={filterType} onChange={e=>setFilterType(e.target.value)}
          style={{ padding: "8px 10px", borderRadius: 8, border: `1px solid ${T.border}`, fontSize: 13, fontFamily: "inherit" }}>
          <option value="all">ทุกประเภท</option>
          <option value="monthly">📆 รายเดือน</option>
          <option value="daily">📅 รายวัน</option>
          <option value="piecework">📊 รายชิ้น</option>
        </select>
      </div>

      {/* Bulk action bar */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12, padding: 10, background: "#eff6ff", border: `1px solid #bfdbfe`, borderRadius: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: T.blue, fontWeight: 700 }}>⚡ Quick Actions:</span>
        <button onClick={markAllMonth}
          style={{ background: T.green, color: "white", border: "none", padding: "7px 14px", borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
          ✓ Mark "มา" ทั้งเดือน ({filteredEmps.length} คน)
        </button>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: T.sub, cursor: "pointer" }}>
          <input type="checkbox" checked={defaultPresent} onChange={e=>setDefaultPresent(e.target.checked)}/>
          💡 ช่องว่าง = "มา" auto (admin คลิกเฉพาะคนขาด)
        </label>
        {filterType === "piecework" && (
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#7c3aed", cursor: "pointer", fontWeight: 700 }}>
            <input type="checkbox" checked={pieceMode} onChange={e=>setPieceMode(e.target.checked)}/>
            📊 โหมดใส่จำนวนชิ้น
          </label>
        )}
      </div>

      <div style={{ fontSize: 11, color: T.muted, marginBottom: 8 }}>
        💡 คลิกช่อง → cycle: <b style={{color:STATUS_LABELS.present.color}}>มา</b> → <b style={{color:STATUS_LABELS.absent.color}}>ขาด</b> → <b style={{color:STATUS_LABELS.late.color}}>สาย</b> → <b style={{color:STATUS_LABELS.halfday.color}}>ครึ่ง</b> → ว่าง · คลิกหัวคอลัมน์ = mark วันนั้นทุกคน · คลิกชื่อพนักงาน = mark ทั้งเดือนคนนั้น
      </div>

      <div className="table-scroll">
        <div style={{ minWidth: 200 + daysInMonth * 36, background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" }}>
          {/* Header row */}
          <div style={{ display: "flex", background: "#f8fafc", borderBottom: `1px solid ${T.border}`, position: "sticky", top: 0, zIndex: 5 }}>
            <div style={{ width: 200, padding: "8px 10px", fontSize: 11, fontWeight: 700, color: T.sub, borderRight: `1px solid ${T.border}` }}>พนักงาน</div>
            {Array.from({length: daysInMonth}).map((_,i) => {
              const d = i + 1;
              const dow = new Date(year, month-1, d).getDay();
              const isWeekend = dow === 0 || dow === 6;
              return (
                <div key={d} onClick={()=>markAllPresent(d)} title={`Mark ทุกคน "มา" วันที่ ${d}`}
                  style={{ width: 36, padding: "6px 0", textAlign: "center", fontSize: 10, fontWeight: 700, color: isWeekend ? T.muted : T.sub, borderRight: `1px solid ${T.border}`, cursor: "pointer", background: isWeekend ? "#f1f5f9" : "transparent" }}>
                  <div>{d}</div>
                  <div style={{ fontSize: 8, color: isWeekend ? "#b94a48" : T.muted }}>{["อา","จ","อ","พ","พฤ","ศ","ส"][dow]}</div>
                </div>
              );
            })}
            <div style={{ width: 50, padding: "8px 6px", textAlign: "center", fontSize: 10, fontWeight: 700, color: T.green }}>มา</div>
          </div>

          {filteredEmps.length === 0 ? (
            <div style={{ padding: 40, textAlign: "center", color: T.muted, fontSize: 13 }}>
              {employees.length === 0 ? "ยังไม่มีพนักงาน — เพิ่มที่ tab 👷 บัตรลูกจ้าง" : "ไม่พบพนักงานตามเงื่อนไข"}
            </div>
          ) : filteredEmps.map((emp, ei) => {
            const isPiecework = (emp.salaryType || "monthly") === "piecework";
            const showPieceInput = pieceMode && isPiecework;
            // นับ "มา" รวม manual + default (สำหรับ weekdays past ที่ defaultPresent on)
            const explicitPresent = monthAttendance.filter(r => r.employeeId === emp.id && (r.status === "present" || r.status === "late")).length;
            const explicitAbsent = monthAttendance.filter(r => r.employeeId === emp.id && (r.status === "absent" || r.status === "leave")).length;
            let displayPresent = explicitPresent;
            if (defaultPresent) {
              for (let d = 1; d <= daysInMonth; d++) {
                if (isWeekend(d) || !isPast(d)) continue;
                const rec = getRecord(emp.id, dateStr(d));
                if (!rec) displayPresent++;
              }
            }
            const totalPieces = monthAttendance.filter(r => r.employeeId === emp.id).reduce((s,r) => s+(Number(r.piecesProduced)||0), 0);
            return (
              <div key={emp.id} style={{ display: "flex", borderBottom: ei < filteredEmps.length - 1 ? `1px solid ${T.border}` : "none" }}>
                <div onClick={()=>markRowPresent(emp)} title="คลิก → mark 'มา' ทั้งเดือน"
                  style={{ width: 200, padding: "8px 10px", fontSize: 12, fontWeight: 600, color: T.text, borderRight: `1px solid ${T.border}`, position: "sticky", left: 0, background: "white", zIndex: 3, cursor: "pointer" }}
                  onMouseEnter={e=>e.currentTarget.style.background="#eff6ff"}
                  onMouseLeave={e=>e.currentTarget.style.background="white"}>
                  {emp.name}
                  <div style={{ fontSize: 10, color: T.muted }}>
                    {emp.department || "—"} · <span style={{color:isPiecework?"#7c3aed":T.muted}}>{isPiecework?"📊 รายชิ้น":(emp.salaryType==="daily"?"📅 รายวัน":"📆 รายเดือน")}</span>
                  </div>
                </div>
                {Array.from({length: daysInMonth}).map((_,i) => {
                  const d = i + 1;
                  const ds = dateStr(d);
                  const rec = getRecord(emp.id, ds);
                  const status = rec?.status;
                  const meta = status ? STATUS_LABELS[status] : null;
                  const isFuture = new Date(year, month-1, d) > new Date();
                  const wkend = isWeekend(d);
                  // 💡 Default present: ถ้าวันทำงาน(จ-ศ) ผ่านมาแล้ว ไม่มี record + defaultPresent on → แสดง ✓ จาง
                  const showDefaultPresent = defaultPresent && !meta && !isFuture && !wkend;

                  // 📊 Piece input mode สำหรับ pieceworker
                  if (showPieceInput && !isFuture) {
                    return (
                      <div key={d} style={{ width: 36, padding: 2, borderRight: `1px solid ${T.border}`, background: wkend ? "#f8fafc" : "white" }}>
                        <input type="number" defaultValue={rec?.piecesProduced || ""} placeholder="—"
                          onFocus={e=>e.target.select()}
                          onBlur={e=>{
                            const v = Number(e.target.value)||0;
                            if (v > 0) onSet(emp.id, ds, { piecesProduced: v, status: status || "present" });
                            else if (rec && !status) onClear(emp.id, ds);
                          }}
                          style={{ width: "100%", padding: "4px 2px", border: "none", background: "transparent", textAlign: "center", fontSize: 11, fontFamily: "monospace", color: "#7c3aed", fontWeight: 700, outline: "none" }}/>
                      </div>
                    );
                  }

                  return (
                    <div key={d} onClick={()=>{
                      if (isFuture) return;
                      const order = [undefined, "present", "absent", "late", "halfday"];
                      const ix = order.indexOf(status);
                      const next = order[(ix + 1) % order.length];
                      if (next === undefined) onClear(emp.id, ds);
                      else onSet(emp.id, ds, { status: next });
                    }}
                      style={{ width: 36, padding: "8px 0", textAlign: "center", borderRight: `1px solid ${T.border}`, cursor: isFuture ? "not-allowed" : "pointer", background: meta?.bg || (isFuture ? "#f1f5f9" : wkend ? "#f8fafc" : "white"), opacity: isFuture ? 0.4 : 1, fontSize: 14, fontWeight: 700, color: meta?.color || (showDefaultPresent ? "#10b98155" : T.muted), transition: "background .1s" }}>
                      {meta?.short || (showDefaultPresent ? "✓" : "")}
                    </div>
                  );
                })}
                <div style={{ width: 50, padding: "8px 6px", textAlign: "center", fontSize: 13, fontWeight: 700, color: T.green }}>
                  {showPieceInput ? <span style={{color:"#7c3aed",fontSize:11}}>{totalPieces}<div style={{fontSize:8,color:T.muted,fontWeight:400}}>ชิ้น</div></span> : displayPresent}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── RUN PAYROLL ────────────────────────────────────────────────
function RunPayroll({ employees, monthAttendance, wdInMonth, runResult, setRunResult, adjustments, setAdjustments, generatePayslips, saveRun, saving, month, year, printElementById, usDefaultPresent, setUsDefaultPresent }) {
  if (!runResult) {
    return (
      <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 20, textAlign: "center" }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>💰</div>
        <div style={{ fontSize: 14, color: T.sub, marginBottom: 14 }}>
          ระบบจะคำนวณเงินเดือนของพนักงาน {employees.length} คน สำหรับเดือน {month}/{year}<br/>
          <span style={{ fontSize: 11, color: T.muted }}>ต้องบันทึกเวลาในแท็บ "📅 บันทึกเวลา" ก่อน</span>
        </div>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12, color: T.sub, marginBottom: 14, padding: "8px 14px", background: "#eff6ff", borderRadius: 7, cursor: "pointer" }}>
          <input type="checkbox" checked={usDefaultPresent} onChange={e=>setUsDefaultPresent(e.target.checked)}/>
          💡 นับวันว่าง (จ-ศ) เป็น "มา" auto
        </label>
        <div>
        <button onClick={generatePayslips} disabled={employees.length === 0}
          style={{ background: T.blue, color: "white", border: "none", padding: "12px 24px", borderRadius: 9, fontSize: 14, fontWeight: 700, cursor: employees.length===0?"not-allowed":"pointer", fontFamily: "inherit", opacity: employees.length===0?0.5:1 }}>
          📊 คำนวณเงินเดือน
        </button>
        </div>
      </div>
    );
  }

  const totalGross = runResult.reduce((s,r) => s + r.slip.earnings.gross, 0);
  const totalDeductions = runResult.reduce((s,r) => s + r.slip.deductions.total, 0);
  const totalNet = runResult.reduce((s,r) => s + r.slip.net, 0);

  const updateAdj = (empId, field, value) => {
    setAdjustments(prev => ({ ...prev, [empId]: { ...(prev[empId]||{}), [field]: value } }));
    // 🔄 recalculate ทันที
    setTimeout(generatePayslips, 0);
  };

  return (
    <div>
      <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: 14, marginBottom: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12 }}>
        <Stat icon="👥" label="พนักงาน" value={`${runResult.length} คน`} color={T.blue}/>
        <Stat icon="💰" label="ยอดรวมก่อนหัก" value={`฿${fmt(totalGross)}`} color={T.green}/>
        <Stat icon="💸" label="ยอดหักรวม" value={`฿${fmt(totalDeductions)}`} color="#b94a48"/>
        <Stat icon="✅" label="ยอดสุทธิ" value={`฿${fmt(totalNet)}`} color={T.green} highlight/>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button onClick={()=>setRunResult(null)} style={{ background: "white", color: T.sub, border: `1px solid ${T.border}`, padding: "9px 16px", borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}>← กลับ</button>
        <button onClick={generatePayslips} style={{ background: "#eff6ff", color: T.blue, border: `1px solid ${T.blue}`, padding: "9px 16px", borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}>🔄 คำนวณใหม่</button>
        <button onClick={saveRun} disabled={saving}
          style={{ marginLeft: "auto", background: T.green, color: "white", border: "none", padding: "9px 20px", borderRadius: 8, cursor: saving?"not-allowed":"pointer", fontFamily: "inherit", fontWeight: 700, fontSize: 14 }}>
          {saving ? "⏳ กำลังบันทึก..." : "💾 บันทึก & ปิดงวด"}
        </button>
      </div>

      <div className="table-scroll" style={{overflowX:"auto",WebkitOverflowScrolling:"touch"}}>
        <table style={{ width: "100%", minWidth: 1200, borderCollapse: "collapse", background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" }}>
          <thead>
            <tr style={{ background: "#f8fafc", fontSize: 11, color: T.sub, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              <th style={{ padding: "10px 12px", textAlign: "left", borderBottom: `1px solid ${T.border}`, minWidth: 140 }}>พนักงาน</th>
              <th style={{ padding: "10px 8px", textAlign: "center", borderBottom: `1px solid ${T.border}` }}>มา/ขาด</th>
              <th style={{ padding: "10px 8px", textAlign: "right", borderBottom: `1px solid ${T.border}` }}>ฐาน</th>
              <th style={{ padding: "10px 8px", textAlign: "right", borderBottom: `1px solid ${T.border}` }}>OT</th>
              <th style={{ padding: "10px 8px", textAlign: "right", borderBottom: `1px solid ${T.border}` }}>โบนัส</th>
              <th style={{ padding: "10px 8px", textAlign: "right", borderBottom: `1px solid ${T.border}`, background: "#dcfce7" }}>รวมรับ</th>
              <th style={{ padding: "10px 8px", textAlign: "right", borderBottom: `1px solid ${T.border}` }}>สังคม</th>
              <th style={{ padding: "10px 8px", textAlign: "right", borderBottom: `1px solid ${T.border}` }}>ภาษี</th>
              <th style={{ padding: "10px 8px", textAlign: "right", borderBottom: `1px solid ${T.border}` }}>เบิก</th>
              <th style={{ padding: "10px 8px", textAlign: "right", borderBottom: `1px solid ${T.border}` }}>ค่าปรับ</th>
              <th style={{ padding: "10px 8px", textAlign: "right", borderBottom: `1px solid ${T.border}`, background: "#fee2e2" }}>รวมหัก</th>
              <th style={{ padding: "10px 8px", textAlign: "right", borderBottom: `1px solid ${T.border}`, background: T.blue, color: "white" }}>สุทธิ</th>
            </tr>
          </thead>
          <tbody>
            {runResult.map((r, i) => {
              const adj = adjustments[r.employee.id] || {};
              return (
                <tr key={r.employee.id} style={{ borderBottom: `1px solid ${T.border}` }}>
                  <td style={{ padding: "8px 12px", fontSize: 12, fontWeight: 600, color: T.text }}>
                    {r.employee.name}
                    <div style={{ fontSize: 10, color: T.muted }}>{r.slip.salaryType === "monthly" ? "รายเดือน" : r.slip.salaryType === "daily" ? "รายวัน" : "รายชิ้น"}</div>
                  </td>
                  <td style={{ padding: "8px 8px", textAlign: "center", fontSize: 12, fontFamily: "monospace" }}>
                    <span style={{ color: T.green }}>{r.slip.attendance.daysPresent}</span>
                    /<span style={{ color: "#b94a48" }}>{r.slip.attendance.daysAbsent}</span>
                  </td>
                  <td style={{ padding: "8px 8px", textAlign: "right", fontFamily: "monospace", fontSize: 12 }}>{fmt(r.slip.earnings.basePay)}</td>
                  <td style={{ padding: "8px 8px", textAlign: "right", fontFamily: "monospace", fontSize: 12, color: T.sub }}>
                    {r.slip.attendance.otHours > 0 ? fmt(r.slip.earnings.otPay) : "—"}
                  </td>
                  <td style={{ padding: "8px 4px" }}>
                    <input type="number" placeholder="0" value={adj.bonus||""} onChange={e=>updateAdj(r.employee.id, "bonus", Number(e.target.value)||0)} onFocus={e=>e.target.select()}
                      style={{ width: 70, padding: "4px 6px", borderRadius: 5, border: `1px solid ${T.border}`, fontSize: 11, textAlign: "right", fontFamily: "monospace" }}/>
                  </td>
                  <td style={{ padding: "8px 8px", textAlign: "right", fontFamily: "monospace", fontSize: 12, fontWeight: 700, color: T.green, background: "#f0fdf4" }}>{fmt(r.slip.earnings.gross)}</td>
                  <td style={{ padding: "8px 8px", textAlign: "right", fontFamily: "monospace", fontSize: 11, color: T.sub }}>{r.slip.deductions.sso > 0 ? fmt(r.slip.deductions.sso) : "—"}</td>
                  <td style={{ padding: "8px 8px", textAlign: "right", fontFamily: "monospace", fontSize: 11, color: T.sub }}>{r.slip.deductions.tax > 0 ? fmt(r.slip.deductions.tax) : "—"}</td>
                  <td style={{ padding: "8px 4px" }}>
                    <input type="number" placeholder="0" value={adj.advance||""} onChange={e=>updateAdj(r.employee.id, "advance", Number(e.target.value)||0)} onFocus={e=>e.target.select()}
                      style={{ width: 70, padding: "4px 6px", borderRadius: 5, border: `1px solid ${T.border}`, fontSize: 11, textAlign: "right", fontFamily: "monospace" }}/>
                  </td>
                  <td style={{ padding: "8px 4px" }}>
                    <input type="number" placeholder="0" value={adj.penalty||""} onChange={e=>updateAdj(r.employee.id, "penalty", Number(e.target.value)||0)} onFocus={e=>e.target.select()}
                      style={{ width: 70, padding: "4px 6px", borderRadius: 5, border: `1px solid ${T.border}`, fontSize: 11, textAlign: "right", fontFamily: "monospace" }}/>
                  </td>
                  <td style={{ padding: "8px 8px", textAlign: "right", fontFamily: "monospace", fontSize: 12, fontWeight: 700, color: "#b94a48", background: "#fef2f2" }}>{fmt(r.slip.deductions.total)}</td>
                  <td style={{ padding: "8px 10px", textAlign: "right", fontFamily: "monospace", fontSize: 14, fontWeight: 800, color: T.blue, background: "#eff6ff" }}>{fmt(r.slip.net)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{ background: "#f1f5f9", fontWeight: 700 }}>
              <td colSpan={5} style={{ padding: "10px 12px", textAlign: "right", fontSize: 12 }}>รวม {runResult.length} คน</td>
              <td style={{ padding: "10px 8px", textAlign: "right", fontFamily: "monospace", color: T.green, fontWeight: 800 }}>{fmt(totalGross)}</td>
              <td colSpan={4}/>
              <td style={{ padding: "10px 8px", textAlign: "right", fontFamily: "monospace", color: "#b94a48", fontWeight: 800 }}>{fmt(totalDeductions)}</td>
              <td style={{ padding: "10px 10px", textAlign: "right", fontFamily: "monospace", color: T.blue, fontWeight: 800, fontSize: 14 }}>{fmt(totalNet)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

// ── HISTORY ──────────────────────────────────────────────────────
function PayrollHistory({ payrollRuns, printElementById }) {
  const [selectedRun, setSelectedRun] = useState(null);

  if (payrollRuns.length === 0) {
    return (
      <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 40, textAlign: "center", color: T.muted }}>
        <div style={{ fontSize: 48, marginBottom: 10 }}>📜</div>
        <div>ยังไม่มีประวัติ — ไปแท็บ "💰 จ่ายเงินเดือน" เพื่อบันทึกครั้งแรก</div>
      </div>
    );
  }

  return (
    <div>
      {!selectedRun ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {payrollRuns.map(run => (
            <div key={run.id} onClick={()=>setSelectedRun(run)} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: 14, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>📅 {run.month}/{run.year}</div>
                <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>บันทึกเมื่อ {run.runDate} · โดย {run.by} · พนักงาน {run.employeeCount} คน</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 11, color: T.sub }}>ยอดสุทธิรวม</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: T.blue, fontFamily: "monospace" }}>฿{fmt(run.totalNet)}</div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div>
          <button onClick={()=>setSelectedRun(null)} style={{ background: "white", color: T.sub, border: `1px solid ${T.border}`, padding: "8px 14px", borderRadius: 8, cursor: "pointer", fontFamily: "inherit", marginBottom: 12 }}>← กลับ</button>
          <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: 16, marginBottom: 12 }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: T.text }}>📅 รอบจ่ายเงินเดือน {selectedRun.month}/{selectedRun.year}</div>
            <div style={{ fontSize: 12, color: T.muted, marginTop: 4 }}>พนักงาน {selectedRun.employeeCount} คน · ยอดรับรวม ฿{fmt(selectedRun.totalGross)} · ยอดหักรวม ฿{fmt(selectedRun.totalDeductions)} · <b style={{color:T.blue}}>สุทธิ ฿{fmt(selectedRun.totalNet)}</b></div>
          </div>
          <div className="table-scroll" style={{overflowX:"auto",WebkitOverflowScrolling:"touch"}}>
            <table style={{ width: "100%", minWidth: 900, borderCollapse: "collapse", background: T.card, border: `1px solid ${T.border}`, borderRadius: 10 }}>
              <thead>
                <tr style={{ background: "#f8fafc", fontSize: 11, color: T.sub }}>
                  <th style={{ padding: "10px 12px", textAlign: "left", borderBottom: `1px solid ${T.border}` }}>พนักงาน</th>
                  <th style={{ padding: "10px 8px", textAlign: "center", borderBottom: `1px solid ${T.border}` }}>มา</th>
                  <th style={{ padding: "10px 8px", textAlign: "right", borderBottom: `1px solid ${T.border}` }}>ฐาน</th>
                  <th style={{ padding: "10px 8px", textAlign: "right", borderBottom: `1px solid ${T.border}` }}>OT</th>
                  <th style={{ padding: "10px 8px", textAlign: "right", borderBottom: `1px solid ${T.border}` }}>โบนัส</th>
                  <th style={{ padding: "10px 8px", textAlign: "right", borderBottom: `1px solid ${T.border}` }}>รวมรับ</th>
                  <th style={{ padding: "10px 8px", textAlign: "right", borderBottom: `1px solid ${T.border}` }}>รวมหัก</th>
                  <th style={{ padding: "10px 8px", textAlign: "right", borderBottom: `1px solid ${T.border}`, background: "#eff6ff" }}>สุทธิ</th>
                </tr>
              </thead>
              <tbody>
                {(selectedRun.slips||[]).map((s, i) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${T.border}` }}>
                    <td style={{ padding: "8px 12px", fontSize: 12, fontWeight: 600 }}>{s.employeeName}</td>
                    <td style={{ padding: "8px 8px", textAlign: "center", fontSize: 12, fontFamily: "monospace" }}>{s.attendance.daysPresent}</td>
                    <td style={{ padding: "8px 8px", textAlign: "right", fontFamily: "monospace", fontSize: 12 }}>{fmt(s.earnings.basePay)}</td>
                    <td style={{ padding: "8px 8px", textAlign: "right", fontFamily: "monospace", fontSize: 12 }}>{fmt(s.earnings.otPay)}</td>
                    <td style={{ padding: "8px 8px", textAlign: "right", fontFamily: "monospace", fontSize: 12 }}>{fmt(s.earnings.bonus)}</td>
                    <td style={{ padding: "8px 8px", textAlign: "right", fontFamily: "monospace", fontSize: 12, color: T.green, fontWeight: 700 }}>{fmt(s.earnings.gross)}</td>
                    <td style={{ padding: "8px 8px", textAlign: "right", fontFamily: "monospace", fontSize: 12, color: "#b94a48" }}>{fmt(s.deductions.total)}</td>
                    <td style={{ padding: "8px 10px", textAlign: "right", fontFamily: "monospace", fontSize: 14, fontWeight: 800, color: T.blue, background: "#eff6ff" }}>{fmt(s.net)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ icon, label, value, color, highlight }) {
  return (
    <div style={{ padding: 12, background: highlight ? `${color}10` : "#f8fafc", borderRadius: 8, border: `1px solid ${highlight ? color : T.border}` }}>
      <div style={{ fontSize: 11, color: T.muted, fontWeight: 600 }}>{icon} {label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color, marginTop: 2, fontFamily: "monospace" }}>{value}</div>
    </div>
  );
}
