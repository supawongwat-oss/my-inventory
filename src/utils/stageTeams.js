// 👥 ทีม/หน่วยงานประจำสายงาน — ผูก "ใครทำ" เข้ากับแต่ละขั้นตอนการผลิต
//
// 🔑 หลักคิด: ล็อตเก็บค่าได้ "ช่องละค่าเดียว" อยู่แล้ว
//    lot.machineByStage = { "พิมพ์ลาย": "CPU 1", "เย็บ": "ทีม 3" }
// เราจึงมองทุกอย่างเป็น "หน่วยงาน" (unit) เหมือนกันหมด — จะเป็นเครื่อง (CPU 1)
// หรือทีมคน (ทีม 3) ก็ได้ แล้วผูกพนักงานเข้ากับหน่วยนั้น
// → ไม่ต้องแก้โครงสร้างล็อตเลย ล็อตเก่าทุกใบใช้ได้ทันที
//
// settings/sewingTeams  (ชื่อ doc เป็นของเดิม — ตอนนี้เก็บครบทุกสายงานแล้ว)
// {
//   byStage: {
//     "เย็บ":   { list: ["ทีม 1","ทีม 2"], teams: { "ทีม 1": { nickname, members } } },
//     "ตัดผ้า": { list: ["ชุดตัด A"],      teams: { ... } },
//   },
//   list: [...], teams: {...}   // ⬅️ legacy: doc รุ่นก่อนเก็บเฉพาะ "เย็บ" ไว้ระดับบนสุด
// }
import { MACHINES_BY_STAGE, PRODUCTION_STEPS } from "./productionLots";

export const SEWING_STAGE = "เย็บ";
export const TEAMS_DOC = "sewingTeams"; // ชื่อเดิม — ไม่เปลี่ยน เพื่อไม่ให้ข้อมูลที่จัดไว้แล้วหาย

// สายงานที่ไม่ต้องมีคนทำ — ไม่ต้องโชว์ให้จัดทีม
export const NO_TEAM_STAGES = ["เข้าคลัง", "ยกเลิก"];

// ดึงก้อนข้อมูลของสายงานหนึ่ง (รองรับ doc รุ่นเก่าที่มีแต่ "เย็บ")
function stageData(data, stage) {
  const byStage = data?.byStage || {};
  if (byStage[stage]) return byStage[stage];
  if (stage === SEWING_STAGE && (data?.list || data?.teams)) {
    return { list: data.list, teams: data.teams }; // legacy shape
  }
  return {};
}

// รายชื่อหน่วยงานของสายงานนี้ — ยังไม่เคยตั้งเอง → ใช้ค่าเริ่มต้น (CPU 1-5 / ทีม 1-14 ฯลฯ)
// ⚠️ list: [] = ผู้ใช้ลบทิ้งหมดจริง ๆ → ต้องเคารพ ไม่ fallback กลับไปค่าเริ่มต้น
export function getStageList(data, stage) {
  const list = stageData(data, stage).list;
  return Array.isArray(list) ? list : (MACHINES_BY_STAGE[stage] || []);
}

export function getStageTeams(data, stage) {
  return stageData(data, stage).teams || {};
}

export function teamInfo(teamsMap, key) {
  const t = (teamsMap || {})[key] || {};
  return { nickname: t.nickname || "", members: Array.isArray(t.members) ? t.members : [] };
}

export function teamLabel(teamsMap, key) {
  const { nickname } = teamInfo(teamsMap, key);
  return nickname ? `${key} (${nickname})` : key;
}

export function teamMembers(teamsMap, key, employees = []) {
  return teamInfo(teamsMap, key).members
    .map(id => employees.find(e => e.id === id))
    .filter(Boolean);
}

// สายงานที่จัดทีมได้ — ตามลำดับบนบอร์ด (steps ปรับเองได้ → ส่งเข้ามา)
export function teamableStages(steps = PRODUCTION_STEPS) {
  return steps.filter(s => !NO_TEAM_STAGES.includes(s));
}

// ── 📊 ผลงานทีม ──────────────────────────────────────────────
// แกะจากข้อมูลที่ล็อตเก็บไว้อยู่แล้ว — ไม่ต้องบันทึกเพิ่มตอนทำงาน
//   lot.machineByStage[stage] = ทีมที่ทำขั้นนั้น (เก็บแยกรายขั้น ไม่หายตอนย้าย)
//   lot.statusHistory         = เวลาที่เข้าแต่ละขั้น
//   lot.items / producedQty   = จำนวน

// "17/07/2026 14:30" → Date  (รูปแบบจาก nowStr())
export function parseThaiDateTime(s) {
  if (typeof s !== "string") return null;
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/);
  if (!m) return null;
  const [, dd, mm, yyyy, hh = "0", mi = "0"] = m;
  const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(mi));
  return isNaN(d.getTime()) ? null : d;
}

// จำนวนที่ล็อตนี้ผลิต — items ปัจจุบัน + ที่เข้าคลังไปแล้ว (items ถูกล้างตอนเข้าครบ)
export function lotProducedQty(lot) {
  const inHand = (lot?.items || []).reduce((s, it) => s + (Number(it.qty) || 0), 0);
  return inHand + (Number(lot?.producedQty) || 0);
}

// ล็อตนี้เข้าขั้นนี้เมื่อไหร่ (ครั้งแรก)
export function stageEnteredAt(lot, stage) {
  const h = (lot?.statusHistory || []).find(x => x.status === stage);
  return h?.at ? parseThaiDateTime(h.at) : null;
}

// สรุปผลงานของสายงานหนึ่ง → { [teamKey]: { lots:[], qty, count } }
// opts.from / opts.to = ช่วงเวลา (Date) กรองตามวันที่ "เข้าขั้นนั้น"
export function stageOutput(orders = [], stage, opts = {}) {
  const { from, to } = opts;
  const byTeam = {};
  orders.forEach(order => {
    const lots = Array.isArray(order?.lots) && order.lots.length > 0
      ? order.lots
      : [{ lotId: "L1", items: order?.items || [], status: order?.status, statusHistory: order?.statusHistory, machineByStage: order?.machineByStage }];
    lots.forEach(lot => {
      if (lot?.status === "ยกเลิก") return;
      const team = (lot?.machineByStage || {})[stage];
      if (!team) return;                       // ยังไม่ได้ระบุทีมของขั้นนี้
      const at = stageEnteredAt(lot, stage);
      if (from && (!at || at < from)) return;
      if (to && (!at || at > to)) return;
      const qty = lotProducedQty(lot);
      if (!byTeam[team]) byTeam[team] = { lots: [], qty: 0, count: 0 };
      byTeam[team].lots.push({
        lotId: lot.lotId || "—",
        prodNo: order.prodNo || order.orderNo || "",
        clothingName: order.clothingName || "",
        qty, at,
        status: lot.status || "",
      });
      byTeam[team].qty += qty;
      byTeam[team].count += 1;
    });
  });
  Object.values(byTeam).forEach(t => t.lots.sort((a, b) => (b.at?.getTime() || 0) - (a.at?.getTime() || 0)));
  return byTeam;
}
