// 👥 จัดการทีม/หน่วยงานประจำสายงาน — ระบุว่าแต่ละขั้นตอนมีใครทำบ้าง
// ⚠️ ไม่ยุ่งกับระบบเงินเดือน — เป็นข้อมูลสำหรับ "ดู" อย่างเดียว
import { useState, useEffect, useMemo } from "react";
import { doc, setDoc, onSnapshot, addDoc, collection, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase";
import { T } from "../theme";
import { logAudit, AUDIT_ACTIONS } from "../utils/audit";
import { PRODUCTION_STEPS, STATUS_COLORS, getLots } from "../utils/productionLots";
import { TEAMS_DOC, getStageList, getStageTeams, teamInfo, teamableStages } from "../utils/stageTeams";

export default function StageTeamsPanel({ employees = [], orders = [], user, role }) {
  const [data, setData] = useState({});          // ทั้ง doc
  const [steps, setSteps] = useState(PRODUCTION_STEPS);
  const [stage, setStage] = useState("เย็บ");    // สายงานที่กำลังดู
  const [loaded, setLoaded] = useState(false);
  const [addingTo, setAddingTo] = useState("");  // unit key ที่กำลังเลือกคนเพิ่ม
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const canEdit = !!role?.canManageUsers || user?.role === "admin" || user?.role === "manager";

  useEffect(() => {
    const u1 = onSnapshot(doc(db, "settings", TEAMS_DOC), snap => {
      setData(snap.exists() ? snap.data() : {});
      setLoaded(true);
    }, () => setLoaded(true));
    // สายงานปรับเพิ่ม/ลบได้จากบอร์ด → ต้องตามให้ทัน
    const u2 = onSnapshot(doc(db, "settings", "kanbanSteps"), snap => {
      const stored = snap.exists() && Array.isArray(snap.data().steps) ? snap.data().steps : [];
      const cleaned = stored.filter(s => typeof s === "string" && s.trim());
      if (cleaned.length > 0) setSteps(cleaned);
    }, () => {});
    return () => { u1(); u2(); };
  }, []);

  const stages = useMemo(() => teamableStages(steps), [steps]);
  useEffect(() => { // สายงานที่เลือกอยู่ถูกลบไป → เด้งกลับอันแรก
    if (stages.length > 0 && !stages.includes(stage)) setStage(stages[0]);
  }, [stages, stage]);

  const list = getStageList(data, stage);
  const teams = getStageTeams(data, stage);

  // 🔎 นับว่าแต่ละหน่วยถูกใช้ในล็อตไหนบ้าง (เฉพาะสายงานนี้) — กันลบทิ้งทั้งที่มีงานค้าง
  const usage = useMemo(() => {
    const map = {};
    orders.forEach(o => {
      getLots(o).forEach(l => {
        const t = (l.machineByStage || {})[stage];
        if (t) map[t] = (map[t] || 0) + 1;
      });
    });
    return map;
  }, [orders, stage]);

  // เขียนกลับเฉพาะสายงานนี้ — สายงานอื่นไม่ถูกแตะ
  const persistStage = async (patch, note) => {
    const next = { ...(data.byStage || {}), [stage]: { ...(data.byStage?.[stage] || { list, teams }), ...patch } };
    setData(d => ({ ...d, byStage: next })); // optimistic
    try {
      await setDoc(doc(db, "settings", TEAMS_DOC), { byStage: next }, { merge: true });
      if (note) logAudit(user, { action: AUDIT_ACTIONS.UPDATE, collection: "settings", targetId: TEAMS_DOC, targetLabel: `ทีม ${stage}`, note });
    } catch (e) {
      alert("บันทึกไม่สำเร็จ: " + (e.message || e));
    }
  };

  const saveTeams = (nextTeams, note) => persistStage({ teams: nextTeams }, note);

  const setNickname = (key, nickname) => {
    const cur = teamInfo(teams, key);
    saveTeams({ ...teams, [key]: { ...cur, nickname } }, `ตั้งชื่อเล่น ${key} → "${nickname || "(ล้าง)"}"`);
  };

  const addMember = (key, empId) => {
    const cur = teamInfo(teams, key);
    if (cur.members.includes(empId)) return;
    const emp = employees.find(e => e.id === empId);
    saveTeams({ ...teams, [key]: { ...cur, members: [...cur.members, empId] } }, `เพิ่ม ${emp?.name || empId} เข้า ${key} (${stage})`);
    setAddingTo(""); setSearch("");
  };

  const removeMember = (key, empId) => {
    const cur = teamInfo(teams, key);
    const emp = employees.find(e => e.id === empId);
    saveTeams({ ...teams, [key]: { ...cur, members: cur.members.filter(id => id !== empId) } }, `เอา ${emp?.name || empId} ออกจาก ${key} (${stage})`);
  };

  // ➕ สร้างพนักงานใหม่ + ใส่เข้าหน่วยเลยในก้าวเดียว
  const createAndAdd = async (key, name) => {
    const trimmed = (name || "").trim();
    if (!trimmed || creating) return;
    setCreating(true);
    try {
      const ref = await addDoc(collection(db, "employees"), {
        name: trimmed,
        department: stage,   // จัดเข้าแผนกตามสายงานที่เพิ่ม — แก้ทีหลังได้
        position: "", nameEn: "", nationality: "", phone: "", note: "",
        attachments: [],
        salaryType: "monthly", baseSalary: 0, pieceRate: 0, otRate: 0,
        hasSSO: true, extraDeductionAnnual: 0,
        createdAt: serverTimestamp(),
        createdBy: user?.name || "",
      });
      logAudit(user, { action: AUDIT_ACTIONS.CREATE, collection: "employees", targetId: ref.id, targetLabel: trimmed, note: `สร้างจากหน้าทีม → ${key} (${stage})` });
      const cur = teamInfo(teams, key);
      await saveTeams({ ...teams, [key]: { ...cur, members: [...cur.members, ref.id] } }, `เพิ่ม ${trimmed} (คนใหม่) เข้า ${key} (${stage})`);
      setAddingTo(""); setSearch("");
    } catch (e) {
      alert("สร้างพนักงานไม่สำเร็จ: " + (e.message || e));
    } finally {
      setCreating(false);
    }
  };

  const addUnit = async () => {
    const name = window.prompt(`ชื่อทีม/หน่วยใหม่ของสายงาน "${stage}":`, "");
    const trimmed = (name || "").trim();
    if (!trimmed) return;
    if (list.includes(trimmed)) { alert(`มี "${trimmed}" อยู่แล้วในสายงานนี้`); return; }
    await persistStage({ list: [...list, trimmed] }, `เพิ่ม "${trimmed}" ใน ${stage}`);
  };

  const removeUnit = async (key) => {
    const inUse = usage[key] || 0;
    const { members } = teamInfo(teams, key);
    if (!window.confirm(
      `ลบ "${key}" ออกจากสายงาน "${stage}"?\n\n` +
      (members.length > 0 ? `• มีสมาชิก ${members.length} คน — จะถูกเอาออก (ไม่ได้ลบพนักงาน)\n` : "") +
      (inUse > 0
        ? `\n⚠️ มี ${inUse} ล็อตที่เลือก "${key}" อยู่\n`+
          `ล็อตพวกนั้นจะยังแสดงชื่อเดิม (ข้อมูลเก่าไม่หาย)\n`+
          `แต่จะเลือกให้ล็อตใหม่ไม่ได้อีก\n`
        : `\n✅ ยังไม่มีล็อตไหนใช้ — ลบได้ปลอดภัย\n`)
    )) return;
    const nextTeams = { ...teams }; delete nextTeams[key];
    await persistStage({ list: list.filter(k => k !== key), teams: nextTeams }, `ลบ "${key}" จาก ${stage}${inUse > 0 ? ` (มี ${inUse} ล็อตใช้อยู่)` : ""}`);
  };

  const resetUnits = async () => {
    if (!window.confirm(`กลับไปใช้ค่าเริ่มต้นของสายงาน "${stage}"?\n\nสมาชิกที่จัดไว้จะยังอยู่ครบ — แค่รายชื่อทีม/หน่วยกลับเป็นค่าเริ่มต้น`)) return;
    await persistStage({ list: null }, `รีเซ็ตรายชื่อทีมของ ${stage}`);
  };

  // คนที่ยังไม่ได้อยู่หน่วยไหนเลย "ในสายงานนี้"
  const assignedIds = useMemo(() => {
    const s = new Set();
    list.forEach(k => teamInfo(teams, k).members.forEach(id => s.add(id)));
    return s;
  }, [list, teams]);

  if (!loaded) return <div style={{ padding: 30, textAlign: "center", color: T.muted, fontSize: 13 }}>⏳ กำลังโหลด...</div>;

  const stageColor = STATUS_COLORS[stage] || T.accent;

  return (
    <div>
      <div style={{ padding: "10px 14px", background: "rgba(59,91,139,0.06)", border: `1px solid ${T.border}`, borderRadius: 10, marginBottom: 14, fontSize: 12, color: T.sub, lineHeight: 1.7 }}>
        💡 ทีม/หน่วยพวกนี้คือตัวเลือกเดียวกับช่อง <b>“เครื่อง/ทีม”</b> ในล็อตบนบอร์ดผลิต — จะเป็นเครื่อง (CPU 1) หรือทีมคน (ทีม 3) ก็ได้ ผูกคนเข้าไปได้ทั้งคู่<br/>
        ⚡ กด <b>“+ เพิ่มคนเข้าทีม”</b> แล้วพิมพ์ชื่อได้เลย — ยังไม่มีในระบบก็<b>สร้างใหม่จากตรงนี้</b>ได้ทันที<br/>
        🔒 <b>ยังไม่ยุ่งกับเงินเดือน</b> — เป็นข้อมูลไว้ดูเฉย ๆ ไม่กระทบการคำนวณค่าจ้างใด ๆ
      </div>

      {/* เลือกสายงาน */}
      <div style={{ display: "flex", gap: 5, marginBottom: 12, flexWrap: "wrap" }}>
        {stages.map(s => {
          const c = STATUS_COLORS[s] || T.accent;
          const on = s === stage;
          const n = getStageList(data, s).reduce((sum, k) => sum + teamInfo(getStageTeams(data, s), k).members.length, 0);
          return (
            <button key={s} onClick={() => { setStage(s); setAddingTo(""); setSearch(""); }}
              style={{ padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontSize: 12,
                border: `1px solid ${on ? c : T.border}`, background: on ? `${c}18` : "white",
                color: on ? c : T.sub, fontWeight: on ? 700 : 500 }}>
              {s}{n > 0 && <span style={{ marginLeft: 5, fontSize: 10, opacity: 0.75 }}>· {n} คน</span>}
            </button>
          );
        })}
      </div>

      {/* Toolbar */}
      {canEdit && (
        <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center", flexWrap: "wrap" }}>
          <button onClick={addUnit}
            style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid rgba(16,185,129,0.35)", background: "rgba(16,185,129,0.08)", color: "#059669", cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: "inherit" }}>
            ＋ เพิ่มทีม/หน่วย
          </button>
          <button onClick={resetUnits} title="กลับไปใช้รายชื่อเริ่มต้นของสายงานนี้ (สมาชิกไม่หาย)"
            style={{ padding: "8px 12px", borderRadius: 8, border: `1px solid ${T.border}`, background: "white", color: T.sub, cursor: "pointer", fontSize: 12, fontFamily: "inherit" }}>
            ↺ ค่าเริ่มต้น
          </button>
          <span style={{ fontSize: 11, color: T.muted, marginLeft: 4 }}>
            <b style={{ color: stageColor }}>{stage}</b> — {list.length} ทีม/หน่วย · {assignedIds.size} คน
          </span>
        </div>
      )}

      {list.length === 0 && (
        <div style={{ padding: 30, textAlign: "center", color: T.muted, fontSize: 13, background: T.card, border: `1px dashed ${T.border}`, borderRadius: 10 }}>
          สายงาน “{stage}” ยังไม่มีทีม/หน่วย — กด “＋ เพิ่มทีม/หน่วย” เพื่อสร้าง<br/>
          <span style={{ fontSize: 11 }}>ถ้าสายงานนี้ไม่ต้องระบุคน ปล่อยว่างไว้ได้ — ล็อตจะไม่ขึ้นช่องให้เลือก</span>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))", gap: 10 }}>
        {list.map(key => {
          const { nickname, members } = teamInfo(teams, key);
          const memberEmps = members.map(id => employees.find(e => e.id === id)).filter(Boolean);
          const missing = members.length - memberEmps.length;
          const isAdding = addingTo === key;
          const pickable = employees
            .filter(e => !members.includes(e.id))
            .filter(e => !search || `${e.name} ${e.department || ""} ${e.position || ""}`.toLowerCase().includes(search.toLowerCase()));
          const exactExists = employees.some(e => (e.name || "").trim().toLowerCase() === search.trim().toLowerCase());

          return (
            <div key={key} style={{ background: T.card, border: `1px solid ${memberEmps.length > 0 ? `${stageColor}59` : T.border}`, borderRadius: 10, padding: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: T.text, flexShrink: 0 }}>{key}</span>
                <input value={nickname} onChange={e => setNickname(key, e.target.value)} disabled={!canEdit}
                  placeholder="ชื่อเล่น (ไม่ใส่ก็ได้)"
                  style={{ flex: 1, minWidth: 0, padding: "4px 8px", borderRadius: 6, border: `1px solid ${T.border}`, fontSize: 12, fontFamily: "inherit", outline: "none", background: canEdit ? "white" : "#f8fafc" }}/>
                <span style={{ fontSize: 11, fontWeight: 700, color: memberEmps.length > 0 ? stageColor : T.muted, flexShrink: 0 }}>{memberEmps.length} คน</span>
                {canEdit && (
                  <button onClick={() => removeUnit(key)} title="ลบทีม/หน่วยนี้"
                    style={{ flexShrink: 0, padding: "3px 7px", borderRadius: 6, border: "1px solid rgba(185,74,72,0.3)", background: "rgba(185,74,72,0.08)", color: T.red, cursor: "pointer", fontSize: 11, fontFamily: "inherit" }}>🗑</button>
                )}
              </div>

              {usage[key] > 0 && (
                <div style={{ fontSize: 10, color: T.sub, marginBottom: 6 }}>🏭 มี {usage[key]} ล็อตใช้อยู่</div>
              )}

              {memberEmps.length === 0 && !isAdding && (
                <div style={{ fontSize: 11, color: T.muted, padding: "6px 0" }}>ยังไม่มีคน</div>
              )}

              {memberEmps.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 8 }}>
                  {memberEmps.map(e => (
                    <span key={e.id} title={`${e.position || ""}${e.department ? ` · ${e.department}` : ""}`}
                      style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 8px", background: `${stageColor}14`, color: stageColor, borderRadius: 12, fontSize: 11, fontWeight: 600 }}>
                      {e.name}
                      {canEdit && (
                        <button onClick={() => removeMember(key, e.id)} title="เอาออก"
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
                    style={{ width: "100%", padding: "6px 10px", borderRadius: 6, border: `1px solid ${stageColor}`, fontSize: 12, fontFamily: "inherit", outline: "none", marginBottom: 6 }}/>
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
