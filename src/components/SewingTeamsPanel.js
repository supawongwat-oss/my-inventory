// 👥 จัดการทีมเย็บ — ระบุว่าแต่ละทีมมีใครบ้าง + ตั้งชื่อเล่นทีม
// ⚠️ ไม่ยุ่งกับระบบเงินเดือน — เป็นข้อมูลสำหรับ "ดู" อย่างเดียว
import { useState, useEffect, useMemo } from "react";
import { doc, setDoc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";
import { T } from "../theme";
import { logAudit, AUDIT_ACTIONS } from "../utils/audit";
import { SEWING_TEAM_KEYS, teamInfo } from "../utils/sewingTeams";

export default function SewingTeamsPanel({ employees = [], user, role }) {
  const [teams, setTeams] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [addingTo, setAddingTo] = useState("");   // team key ที่กำลังเลือกคนเพิ่ม
  const [search, setSearch] = useState("");
  const canEdit = !!role?.canManageUsers || user?.role === "admin" || user?.role === "manager";

  useEffect(() => {
    const unsub = onSnapshot(doc(db, "settings", "sewingTeams"), snap => {
      setTeams(snap.exists() && snap.data().teams ? snap.data().teams : {});
      setLoaded(true);
    }, () => setLoaded(true));
    return () => unsub();
  }, []);

  const save = async (next, note) => {
    setTeams(next); // optimistic — onSnapshot จะยืนยันอีกที
    try {
      await setDoc(doc(db, "settings", "sewingTeams"), { teams: next }, { merge: true });
      if (note) logAudit(user, { action: AUDIT_ACTIONS.UPDATE, collection: "settings", targetId: "sewingTeams", targetLabel: "ทีมเย็บ", note });
    } catch (e) {
      alert("บันทึกไม่สำเร็จ: " + (e.message || e));
    }
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
        🔒 <b>ยังไม่ยุ่งกับเงินเดือน</b> — เป็นข้อมูลไว้ดูเฉย ๆ ไม่กระทบการคำนวณค่าจ้างใด ๆ
      </div>

      {employees.length === 0 && (
        <div style={{ padding: 30, textAlign: "center", color: T.muted, fontSize: 13, background: T.card, border: `1px solid ${T.border}`, borderRadius: 10 }}>
          ยังไม่มีพนักงานในระบบ — เพิ่มที่แท็บ “👷 บัตรลูกจ้าง” ก่อน แล้วค่อยกลับมาจัดทีม
        </div>
      )}

      {employees.length > 0 && unassigned.length > 0 && (
        <div style={{ padding: "8px 14px", background: "rgba(217,119,6,0.08)", border: "1px solid rgba(217,119,6,0.3)", borderRadius: 8, marginBottom: 12, fontSize: 12, color: "#b45309" }}>
          ⚠️ ยังไม่ได้จัดทีม {unassigned.length} คน: {unassigned.slice(0, 8).map(e => e.name).join(", ")}{unassigned.length > 8 ? ` และอีก ${unassigned.length - 8} คน` : ""}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))", gap: 10 }}>
        {SEWING_TEAM_KEYS.map(key => {
          const { nickname, members } = teamInfo(teams, key);
          const memberEmps = members.map(id => employees.find(e => e.id === id)).filter(Boolean);
          const missing = members.length - memberEmps.length; // คนที่ถูกลบออกจากระบบไปแล้ว
          const isAdding = addingTo === key;
          const pickable = employees
            .filter(e => !members.includes(e.id))
            .filter(e => !search || `${e.name} ${e.department || ""} ${e.position || ""}`.toLowerCase().includes(search.toLowerCase()));

          return (
            <div key={key} style={{ background: T.card, border: `1px solid ${memberEmps.length > 0 ? "rgba(59,91,139,0.35)" : T.border}`, borderRadius: 10, padding: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: T.text, flexShrink: 0 }}>{key}</span>
                <input value={nickname} onChange={e => setNickname(key, e.target.value)} disabled={!canEdit}
                  placeholder="ชื่อเล่นทีม (ไม่ใส่ก็ได้)"
                  style={{ flex: 1, minWidth: 0, padding: "4px 8px", borderRadius: 6, border: `1px solid ${T.border}`, fontSize: 12, fontFamily: "inherit", outline: "none", background: canEdit ? "white" : "#f8fafc" }}/>
                <span style={{ fontSize: 11, fontWeight: 700, color: memberEmps.length > 0 ? T.accent : T.muted, flexShrink: 0 }}>{memberEmps.length} คน</span>
              </div>

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
                    placeholder="🔍 พิมพ์ชื่อ..."
                    style={{ width: "100%", padding: "6px 10px", borderRadius: 6, border: `1px solid ${T.accent}`, fontSize: 12, fontFamily: "inherit", outline: "none", marginBottom: 6 }}/>
                  <div style={{ maxHeight: 150, overflowY: "auto", border: `1px solid ${T.border}`, borderRadius: 6 }}>
                    {pickable.length === 0 && <div style={{ padding: 10, fontSize: 11, color: T.muted, textAlign: "center" }}>ไม่พบพนักงาน</div>}
                    {pickable.map(e => (
                      <div key={e.id} onClick={() => addMember(key, e.id)}
                        style={{ padding: "6px 10px", fontSize: 12, cursor: "pointer", borderBottom: `1px solid ${T.border}` }}
                        onMouseEnter={ev => ev.currentTarget.style.background = "#eff6ff"}
                        onMouseLeave={ev => ev.currentTarget.style.background = "transparent"}>
                        {e.name}
                        <span style={{ fontSize: 10, color: T.muted, marginLeft: 6 }}>{e.department || "—"}</span>
                      </div>
                    ))}
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
