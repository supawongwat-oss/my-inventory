// 👥 จัดการทีมเย็บ — ระบุว่าแต่ละทีมมีใครบ้าง + ตั้งชื่อเล่นทีม
// ⚠️ ไม่ยุ่งกับระบบเงินเดือน — เป็นข้อมูลสำหรับ "ดู" อย่างเดียว
import { useState, useEffect, useMemo } from "react";
import { doc, setDoc, onSnapshot, addDoc, collection, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase";
import { T } from "../theme";
import { logAudit, AUDIT_ACTIONS } from "../utils/audit";
import { SEWING_STAGE, getTeamList, teamInfo } from "../utils/sewingTeams";
import { getLots } from "../utils/productionLots";

export default function SewingTeamsPanel({ employees = [], orders = [], user, role }) {
  const [teams, setTeams] = useState({});
  const [teamList, setTeamList] = useState(null); // null = ยังไม่โหลด
  const [loaded, setLoaded] = useState(false);
  const [addingTo, setAddingTo] = useState("");   // team key ที่กำลังเลือกคนเพิ่ม
  const [search, setSearch] = useState("");
  const canEdit = !!role?.canManageUsers || user?.role === "admin" || user?.role === "manager";

  useEffect(() => {
    const unsub = onSnapshot(doc(db, "settings", "sewingTeams"), snap => {
      const data = snap.exists() ? snap.data() : {};
      setTeams(data.teams || {});
      setTeamList(getTeamList(data));
      setLoaded(true);
    }, () => setLoaded(true));
    return () => unsub();
  }, []);

  // 🔎 นับว่าแต่ละทีมถูกใช้ในล็อตไหนบ้าง — กันลบทีมที่ยังมีงานค้าง
  const usageByTeam = useMemo(() => {
    const map = {};
    orders.forEach(o => {
      getLots(o).forEach(l => {
        const t = (l.machineByStage || {})[SEWING_STAGE];
        if (t) map[t] = (map[t] || 0) + 1;
      });
    });
    return map;
  }, [orders]);

  const persist = async (patch, note) => {
    try {
      await setDoc(doc(db, "settings", "sewingTeams"), patch, { merge: true });
      if (note) logAudit(user, { action: AUDIT_ACTIONS.UPDATE, collection: "settings", targetId: "sewingTeams", targetLabel: "ทีมเย็บ", note });
    } catch (e) {
      alert("บันทึกไม่สำเร็จ: " + (e.message || e));
    }
  };

  const save = async (next, note) => {
    setTeams(next); // optimistic — onSnapshot จะยืนยันอีกที
    await persist({ teams: next }, note);
  };

  const list = teamList || [];

  const addTeam = async () => {
    const name = window.prompt("ชื่อทีมใหม่:", `ทีม ${list.length + 1}`);
    const trimmed = (name || "").trim();
    if (!trimmed) return;
    if (list.includes(trimmed)) { alert(`มีทีมชื่อ "${trimmed}" อยู่แล้ว`); return; }
    const next = [...list, trimmed];
    setTeamList(next);
    await persist({ list: next }, `เพิ่มทีม "${trimmed}"`);
  };

  const removeTeam = async (key) => {
    const inUse = usageByTeam[key] || 0;
    const { members } = teamInfo(teams, key);
    const warn =
      `ลบทีม "${key}"?\n\n` +
      (members.length > 0 ? `• มีสมาชิก ${members.length} คน — จะถูกเอาออกจากทีม (ไม่ได้ลบพนักงาน)\n` : "") +
      (inUse > 0
        ? `\n⚠️ มี ${inUse} ล็อตที่เลือกทีมนี้อยู่\n`+
          `ล็อตพวกนั้นจะยังแสดง "${key}" เหมือนเดิม (ข้อมูลเก่าไม่หาย)\n`+
          `แต่จะเลือกทีมนี้ให้ล็อตใหม่ไม่ได้อีก\n`
        : `\n✅ ยังไม่มีล็อตไหนใช้ทีมนี้ — ลบได้ปลอดภัย\n`);
    if (!window.confirm(warn)) return;
    const nextList = list.filter(k => k !== key);
    const nextTeams = { ...teams };
    delete nextTeams[key];
    setTeamList(nextList);
    setTeams(nextTeams);
    await persist({ list: nextList, teams: nextTeams }, `ลบทีม "${key}"${inUse > 0 ? ` (มี ${inUse} ล็อตใช้อยู่)` : ""}`);
  };

  const resetTeams = async () => {
    if (!window.confirm("กลับไปใช้ทีมเริ่มต้น (ทีม 1-14)?\n\nสมาชิกที่จัดไว้จะยังอยู่ครบ — แค่รายชื่อทีมกลับเป็นค่าเริ่มต้น")) return;
    setTeamList(null);
    await persist({ list: null }, "รีเซ็ตรายชื่อทีมกลับค่าเริ่มต้น");
  };

  const setNickname = (key, nickname) => {
    const cur = teamInfo(teams, key);
    save({ ...teams, [key]: { ...cur, nickname } }, `ตั้งชื่อเล่น ${key} → "${nickname || "(ล้าง)"}"`);
  };

  const addMember = (key, empId) => {
    const cur = teamInfo(teams, key);
    if (cur.members.includes(empId)) return;
    const emp = employees.find(e => e.id === empId);
    save({ ...teams, [key]: { ...cur, members: [...cur.members, empId] } }, `เพิ่ม ${emp?.name || empId} เข้า ${key}`);
    setAddingTo("");
    setSearch("");
  };

  // ➕ สร้างพนักงานใหม่ + ใส่เข้าทีมเลยในก้าวเดียว
  // (ไม่ต้องเดินไปแท็บบัตรลูกจ้าง — ที่นั่นบังคับแค่ "ชื่อ" อยู่แล้ว
  //  ข้อมูลอื่น เช่น passport/work permit ค่อยไปเติมทีหลังได้ถ้าจำเป็น)
  const [creating, setCreating] = useState(false);
  const createAndAdd = async (key, name) => {
    const trimmed = (name || "").trim();
    if (!trimmed || creating) return;
    setCreating(true);
    try {
      const ref = await addDoc(collection(db, "employees"), {
        name: trimmed,
        department: SEWING_STAGE,   // จัดเข้าแผนก "เย็บ" ให้เลย — แก้ทีหลังได้
        position: "", nameEn: "", nationality: "", phone: "", note: "",
        attachments: [],
        salaryType: "monthly", baseSalary: 0, pieceRate: 0, otRate: 0,
        hasSSO: true, extraDeductionAnnual: 0,
        createdAt: serverTimestamp(),
        createdBy: user?.name || "",
      });
      logAudit(user, { action: AUDIT_ACTIONS.CREATE, collection: "employees", targetId: ref.id, targetLabel: trimmed, note: `สร้างจากหน้าทีมเย็บ → ${key}` });
      const cur = teamInfo(teams, key);
      await save({ ...teams, [key]: { ...cur, members: [...cur.members, ref.id] } }, `เพิ่ม ${trimmed} (คนใหม่) เข้า ${key}`);
      setAddingTo("");
      setSearch("");
    } catch (e) {
      alert("สร้างพนักงานไม่สำเร็จ: " + (e.message || e));
    } finally {
      setCreating(false);
    }
  };

  const removeMember = (key, empId) => {
    const cur = teamInfo(teams, key);
    const emp = employees.find(e => e.id === empId);
    save({ ...teams, [key]: { ...cur, members: cur.members.filter(id => id !== empId) } }, `เอา ${emp?.name || empId} ออกจาก ${key}`);
  };

  // คนที่ยังไม่ได้อยู่ทีมไหนเลย — ไว้เตือนว่ายังเหลือใครไม่ได้จัดทีม
  const assignedIds = useMemo(() => {
    const s = new Set();
    Object.keys(teams).forEach(k => teamInfo(teams, k).members.forEach(id => s.add(id)));
    return s;
  }, [teams]);
  const unassigned = employees.filter(e => !assignedIds.has(e.id));

  if (!loaded) return <div style={{ padding: 30, textAlign: "center", color: T.muted, fontSize: 13 }}>⏳ กำลังโหลดทีม...</div>;

  return (
    <div>
      <div style={{ padding: "10px 14px", background: "rgba(59,91,139,0.06)", border: `1px solid ${T.border}`, borderRadius: 10, marginBottom: 14, fontSize: 12, color: T.sub, lineHeight: 1.7 }}>
        💡 ทีมพวกนี้คือทีมเดียวกับที่เลือกในช่อง <b>“เย็บ”</b> บนบอร์ดผลิต — ระบุว่าใครอยู่ทีมไหนไว้ตรงนี้ แล้วเปิดล็อตดูจะเห็นชื่อคนในทีมทันที<br/>
        ⚡ กด <b>“+ เพิ่มคนเข้าทีม”</b> แล้วพิมพ์ชื่อได้เลย — ยังไม่มีในระบบก็<b>สร้างใหม่จากตรงนี้</b>ได้ทันที ไม่ต้องไปแท็บบัตรลูกจ้าง<br/>
        🔒 <b>ยังไม่ยุ่งกับเงินเดือน</b> — เป็นข้อมูลไว้ดูเฉย ๆ ไม่กระทบการคำนวณค่าจ้างใด ๆ
      </div>


      {employees.length > 0 && unassigned.length > 0 && (
        <div style={{ padding: "8px 14px", background: "rgba(217,119,6,0.08)", border: "1px solid rgba(217,119,6,0.3)", borderRadius: 8, marginBottom: 12, fontSize: 12, color: "#b45309" }}>
          ⚠️ ยังไม่ได้จัดทีม {unassigned.length} คน: {unassigned.slice(0, 8).map(e => e.name).join(", ")}{unassigned.length > 8 ? ` และอีก ${unassigned.length - 8} คน` : ""}
        </div>
      )}

      {/* Toolbar */}
      {canEdit && (
        <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center", flexWrap: "wrap" }}>
          <button onClick={addTeam}
            style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid rgba(16,185,129,0.35)", background: "rgba(16,185,129,0.08)", color: "#059669", cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: "inherit" }}>
            ＋ เพิ่มทีม
          </button>
          <button onClick={resetTeams} title="กลับไปใช้ทีม 1-14 (สมาชิกไม่หาย)"
            style={{ padding: "8px 12px", borderRadius: 8, border: `1px solid ${T.border}`, background: "white", color: T.sub, cursor: "pointer", fontSize: 12, fontFamily: "inherit" }}>
            ↺ ทีมเริ่มต้น
          </button>
          <span style={{ fontSize: 11, color: T.muted, marginLeft: 4 }}>ทั้งหมด <b style={{ color: T.accent }}>{list.length}</b> ทีม</span>
        </div>
      )}

      {list.length === 0 && (
        <div style={{ padding: 30, textAlign: "center", color: T.muted, fontSize: 13, background: T.card, border: `1px dashed ${T.border}`, borderRadius: 10 }}>
          ยังไม่มีทีม — กด “＋ เพิ่มทีม” เพื่อสร้างทีมแรก
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))", gap: 10 }}>
        {list.map(key => {
          const { nickname, members } = teamInfo(teams, key);
          const memberEmps = members.map(id => employees.find(e => e.id === id)).filter(Boolean);
          const missing = members.length - memberEmps.length; // คนที่ถูกลบออกจากระบบไปแล้ว
          const isAdding = addingTo === key;
          const pickable = employees
            .filter(e => !members.includes(e.id))
            .filter(e => !search || `${e.name} ${e.department || ""} ${e.position || ""}`.toLowerCase().includes(search.toLowerCase()));
          // มีคนชื่อนี้อยู่แล้วไหม (นับคนที่อยู่ทีมนี้ด้วย) — กันสร้างชื่อซ้ำ
          const exactExists = employees.some(e => (e.name || "").trim().toLowerCase() === search.trim().toLowerCase());

          return (
            <div key={key} style={{ background: T.card, border: `1px solid ${memberEmps.length > 0 ? "rgba(59,91,139,0.35)" : T.border}`, borderRadius: 10, padding: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: T.text, flexShrink: 0 }}>{key}</span>
                <input value={nickname} onChange={e => setNickname(key, e.target.value)} disabled={!canEdit}
                  placeholder="ชื่อเล่นทีม (ไม่ใส่ก็ได้)"
                  style={{ flex: 1, minWidth: 0, padding: "4px 8px", borderRadius: 6, border: `1px solid ${T.border}`, fontSize: 12, fontFamily: "inherit", outline: "none", background: canEdit ? "white" : "#f8fafc" }}/>
                <span style={{ fontSize: 11, fontWeight: 700, color: memberEmps.length > 0 ? T.accent : T.muted, flexShrink: 0 }}>{memberEmps.length} คน</span>
                {canEdit && (
                  <button onClick={() => removeTeam(key)} title="ลบทีมนี้"
                    style={{ flexShrink: 0, padding: "3px 7px", borderRadius: 6, border: "1px solid rgba(185,74,72,0.3)", background: "rgba(185,74,72,0.08)", color: T.red, cursor: "pointer", fontSize: 11, fontFamily: "inherit" }}>🗑</button>
                )}
              </div>

              {usageByTeam[key] > 0 && (
                <div style={{ fontSize: 10, color: T.sub, marginBottom: 6 }}>🏭 มี {usageByTeam[key]} ล็อตใช้ทีมนี้อยู่</div>
              )}

              {memberEmps.length === 0 && !isAdding && (
                <div style={{ fontSize: 11, color: T.muted, padding: "6px 0" }}>ยังไม่มีคนในทีมนี้</div>
              )}

              {memberEmps.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 8 }}>
                  {memberEmps.map(e => (
                    <span key={e.id} title={`${e.position || ""}${e.department ? ` · ${e.department}` : ""}`}
                      style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 8px", background: "rgba(59,91,139,0.08)", color: T.accent, borderRadius: 12, fontSize: 11, fontWeight: 600 }}>
                      {e.name}
                      {canEdit && (
                        <button onClick={() => removeMember(key, e.id)} title="เอาออกจากทีม"
                          style={{ border: "none", background: "transparent", color: T.muted, cursor: "pointer", fontSize: 12, lineHeight: 1, padding: 0 }}>✕</button>
                      )}
                    </span>
                  ))}
                </div>
              )}

              {missing > 0 && (
                <div style={{ fontSize: 10, color: T.red, marginBottom: 6 }}>⚠️ มี {missing} คนที่ถูกลบออกจากระบบแล้ว</div>
              )}

              {canEdit && (isAdding ? (
                <div>
                  <input autoFocus value={search} onChange={e => setSearch(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter" && search.trim() && !exactExists) createAndAdd(key, search); }}
                    placeholder="🔍 พิมพ์ชื่อ — มีอยู่แล้วก็เลือก / ยังไม่มีก็สร้างใหม่"
                    style={{ width: "100%", padding: "6px 10px", borderRadius: 6, border: `1px solid ${T.accent}`, fontSize: 12, fontFamily: "inherit", outline: "none", marginBottom: 6 }}/>
                  <div style={{ maxHeight: 150, overflowY: "auto", border: `1px solid ${T.border}`, borderRadius: 6 }}>
                    {pickable.map(e => (
                      <div key={e.id} onClick={() => addMember(key, e.id)}
                        style={{ padding: "6px 10px", fontSize: 12, cursor: "pointer", borderBottom: `1px solid ${T.border}` }}
                        onMouseEnter={ev => ev.currentTarget.style.background = "#eff6ff"}
                        onMouseLeave={ev => ev.currentTarget.style.background = "transparent"}>
                        {e.name}
                        <span style={{ fontSize: 10, color: T.muted, marginLeft: 6 }}>{e.department || "—"}</span>
                      </div>
                    ))}
                    {/* พิมพ์ชื่อที่ยังไม่มีในระบบ → สร้างคนใหม่ + ใส่เข้าทีมเลย */}
                    {search.trim() && !exactExists && (
                      <div onClick={() => createAndAdd(key, search)}
                        style={{ padding: "8px 10px", fontSize: 12, cursor: creating ? "wait" : "pointer", background: "rgba(16,185,129,0.08)", color: "#059669", fontWeight: 700 }}>
                        {creating ? "⏳ กำลังสร้าง..." : <>➕ สร้าง “{search.trim()}” เป็นพนักงานใหม่ → ใส่เข้า {key}</>}
                      </div>
                    )}
                    {pickable.length === 0 && !search.trim() && (
                      <div style={{ padding: 10, fontSize: 11, color: T.muted, textAlign: "center" }}>พิมพ์ชื่อเพื่อค้นหา หรือสร้างคนใหม่</div>
                    )}
                  </div>
                  <button onClick={() => { setAddingTo(""); setSearch(""); }}
                    style={{ marginTop: 6, width: "100%", padding: "5px", borderRadius: 6, border: `1px solid ${T.border}`, background: "white", color: T.sub, cursor: "pointer", fontSize: 11, fontFamily: "inherit" }}>ปิด</button>
                </div>
              ) : (
                <button onClick={() => { setAddingTo(key); setSearch(""); }}
                  style={{ width: "100%", padding: "5px", borderRadius: 6, border: `1px dashed ${T.border}`, background: "transparent", color: T.sub, cursor: "pointer", fontSize: 11, fontFamily: "inherit" }}>+ เพิ่มคนเข้าทีม</button>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
