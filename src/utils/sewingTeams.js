// 👥 ทีมเย็บ — ผูกชื่อทีม (ที่ล็อตใช้อยู่แล้ว) เข้ากับพนักงานจริง
//
// 🔑 หลักคิด: ล็อตเก็บทีมเป็น "ข้อความ" อยู่แล้ว — lot.machineByStage["เย็บ"] = "ทีม 3"
// เราจึงใช้ข้อความนั้นเป็น key ตรง ๆ → ล็อตเก่าทุกใบใช้ได้ทันที ไม่ต้องย้ายข้อมูล
// ชื่อเล่น (nickname) เป็นแค่ "ป้ายแสดงผล" ไม่เคยถูกเก็บลงล็อต → เปลี่ยนกี่ครั้งก็ไม่พัง
//
// settings/sewingTeams = {
//   teams: {
//     "ทีม 1": { nickname: "ป้าแดง", members: ["empId1","empId2"] },
//     "ทีม 3": { nickname: "",       members: ["empId5"] },
//   }
// }
import { MACHINES_BY_STAGE } from "./productionLots";

export const SEWING_STAGE = "เย็บ";

// รายชื่อทีมมาตรฐาน (ทีม 1..14) — ตรงกับ dropdown ที่ล็อตใช้เลือกอยู่แล้ว
export const SEWING_TEAM_KEYS = MACHINES_BY_STAGE[SEWING_STAGE] || [];

// ดึงข้อมูลทีมหนึ่ง (ปลอดภัยกับ doc ที่ยังไม่มี/ว่าง)
export function teamInfo(teamsMap, key) {
  const t = (teamsMap || {})[key] || {};
  return { nickname: t.nickname || "", members: Array.isArray(t.members) ? t.members : [] };
}

// ป้ายที่ใช้แสดงผล — "ทีม 3 (ป้าแดง)" หรือ "ทีม 3" ถ้ายังไม่ตั้งชื่อเล่น
export function teamLabel(teamsMap, key) {
  const { nickname } = teamInfo(teamsMap, key);
  return nickname ? `${key} (${nickname})` : key;
}

// แปลง member ids → employee objects (ข้ามคนที่ถูกลบไปแล้ว)
export function teamMembers(teamsMap, key, employees = []) {
  const { members } = teamInfo(teamsMap, key);
  return members.map(id => employees.find(e => e.id === id)).filter(Boolean);
}

// คนนี้อยู่ทีมไหน — คืน key ทีมแรกที่เจอ ("" ถ้าไม่ได้อยู่ทีมไหน)
export function findTeamOfEmployee(teamsMap, employeeId) {
  for (const key of Object.keys(teamsMap || {})) {
    if (teamInfo(teamsMap, key).members.includes(employeeId)) return key;
  }
  return "";
}
