// productionLots.js — helpers สำหรับโมเดล lots[] ในใบสั่งผลิต
// แต่ละใบสั่งผลิตมี lots[] หลายล็อต — แต่ละล็อตมีสถานะของตัวเอง
// ใบเก่าที่ยังไม่มี lots[] จะถูก migrate on-the-fly เป็น 1 lot

export const PRODUCTION_STEPS = [
  "พิมพ์ลาย",
  "ตัดผ้า",
  "รีดลงผ้า",
  "เย็บ",
  "รีดให้เรียบ",
  "แพ๊ค/QC",
  "เข้าคลัง",
];

// 🧵 กำลังพิมพ์ต่อ 1 ม้วนกระดาษ (โดยประมาณ) — ใช้ประเมินจำนวนม้วนของล็อต
export const ROLL_CAPACITY = 1800;
export const estimateRolls = (qty) => Math.max(1, Math.ceil((Number(qty) || 0) / ROLL_CAPACITY));

// 🧵 จัดของลงม้วนแบบต่อเนื่อง (sequential bin-packing)
// items เรียงตามลำดับที่จะพิมพ์ → เติมม้วนจนเต็ม capacity แล้วขึ้นม้วนใหม่
// ไซส์เดียวพาดได้หลายม้วน, 1 ม้วนมีได้หลายไซส์/สี
// คืน [{ rollNo, items:[{...it, qty}], total }]
export function packIntoRolls(items, capacity) {
  const cap = Math.max(1, Number(capacity) || ROLL_CAPACITY);
  const rolls = [];
  let cur = { items: [], total: 0 };
  const queue = (items || []).map(it => ({ it, remaining: Number(it.qty) || 0 })).filter(x => x.remaining > 0);
  for (const node of queue) {
    while (node.remaining > 0) {
      const space = cap - cur.total;
      if (space <= 0) { rolls.push(cur); cur = { items: [], total: 0 }; continue; }
      const take = Math.min(space, node.remaining);
      cur.items.push({ ...node.it, qty: take });
      cur.total += take;
      node.remaining -= take;
    }
  }
  if (cur.items.length > 0) rolls.push(cur);
  return rolls.map((r, i) => ({ ...r, rollNo: i + 1 }));
}

export const STATUS_COLORS = {
  "พิมพ์ลาย":   "#0ea5e9",
  "ตัดผ้า":     "#6366f1",
  "รีดลงผ้า":   "#8b5cf6",
  "เย็บ":       "#ec4899",
  "รีดให้เรียบ": "#f59e0b",
  "แพ๊ค/QC":    "#d97706",
  "เข้าคลัง":   "#16a34a",
  "ยกเลิก":     "#dc2626",
};

// 🏭 รายการเครื่อง/ทีม ตาม stage (ขึ้นใน dropdown ของแต่ละม้วน)
// - พิมพ์ลาย: CPU 1-5
// - ตัดผ้า:   ใช้รวม (โต๊ะเดียว) → ไม่ต้องเลือก
// - รีดลงผ้า/รีดให้เรียบ: รีด 1-3
// - เย็บ: 14 ทีม (T1-T14) ไม่บังคับเลือก แก้ทีหลังได้
export const MACHINES_BY_STAGE = {
  "พิมพ์ลาย":   ["CPU 1", "CPU 2", "CPU 3", "CPU 4", "CPU 5"],
  "ตัดผ้า":     [], // ใช้ตัดผ้ารวม — ไม่ต้องเลือก
  "รีดลงผ้า":   ["รีด 1", "รีด 2", "รีด 3"],
  "เย็บ":       Array.from({length:14}, (_,i)=>`ทีม ${i+1}`),
  "รีดให้เรียบ": ["รีด 1", "รีด 2", "รีด 3"],
  "แพ๊ค/QC":    [],
  "เข้าคลัง":   [],
};

// helper: ดึงเครื่องที่ถูก assign สำหรับ stage ปัจจุบันของล็อต
// lot.machineByStage = { "พิมพ์ลาย": "CPU 1", "เย็บ": "ทีม 3", ... }
export function getMachineForCurrentStage(lot) {
  if (!lot) return "";
  const status = lot.status || PRODUCTION_STEPS[0];
  return (lot.machineByStage || {})[status] || "";
}

// ดึง lots ของ order — ถ้าไม่มี lots[] → สร้าง pseudo lot จาก items + status ของใบ (legacy)
export function getLots(order) {
  if (Array.isArray(order.lots) && order.lots.length > 0) return order.lots;
  return [{
    lotId: "L1",
    items: order.items || [],
    status: order.status || PRODUCTION_STEPS[0],
    statusHistory: order.statusHistory || [],
    notes: [],
    finishedStocked: !!order.finishedStocked,
  }];
}

// รวม qty ของ items ในล็อต
export function totalQtyOfLot(lot) {
  return (lot.items || []).reduce((s, it) => s + (Number(it.qty) || 0), 0);
}

// สร้าง lotId ใหม่ที่ไม่ซ้ำ
export function nextLotId(existing) {
  const used = new Set((existing || []).map(l => l.lotId));
  let n = 1;
  while (used.has(`L${n}`)) n++;
  return `L${n}`;
}

// ย่อรายการเลขม้วนเป็นช่วงอ่านง่าย: [1,2,3,5] → "1-3, 5"
// ใช้ตอนรวมม้วน เพื่อจำว่าล็อตที่รวมแล้วมาจากม้วนไหนบ้าง (แทนการล้างทิ้ง)
export function summarizeRollNos(rollNos = []) {
  const nums = [...new Set(
    rollNos.map(r => parseInt(r, 10)).filter(n => Number.isFinite(n))
  )].sort((a, b) => a - b);
  if (nums.length === 0) return "";
  const parts = [];
  let start = nums[0], prev = nums[0];
  for (let i = 1; i <= nums.length; i++) {
    if (nums[i] === prev + 1) { prev = nums[i]; continue; }
    parts.push(start === prev ? `${start}` : `${start}-${prev}`);
    start = prev = nums[i];
  }
  return parts.join(", ");
}

// label ของขั้นถัดไป (null ถ้าเป็นขั้นสุดท้าย) — รับ steps แบบ dynamic
export function nextStep(status, steps = PRODUCTION_STEPS) {
  const idx = steps.indexOf(status);
  if (idx < 0 || idx >= steps.length - 1) return null;
  return steps[idx + 1];
}

// label ขั้นก่อนหน้า
export function prevStep(status, steps = PRODUCTION_STEPS) {
  const idx = steps.indexOf(status);
  if (idx <= 0) return null;
  return steps[idx - 1];
}

// ฟอร์แมตวันที่
export function nowStr() {
  const d = new Date(); const p = n => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ลบล็อต
export function removeLot(lots, lotIdx) {
  return lots.filter((_, i) => i !== lotIdx);
}

// แยกล็อตย่อย: คืน { newLots, splitOk }
//   selections = [{ itemIdx, qty }] — qty ที่จะแยกออกจาก item เดิม
export function splitLot(lots, lotIdx, selections, opts = {}) {
  const oldLot = lots[lotIdx];
  if (!oldLot) return { newLots: lots, splitOk: false };
  const validSels = selections.filter(s => Number(s.qty) > 0 && oldLot.items[s.itemIdx]);
  if (validSels.length === 0) return { newLots: lots, splitOk: false };

  // สร้าง items ของล็อตใหม่ + ลด qty ของล็อตเดิม
  const newItems = [];
  const updatedOldItems = oldLot.items.map((it, idx) => {
    const sel = validSels.find(s => s.itemIdx === idx);
    if (!sel) return it;
    const splitQty = Math.min(Number(sel.qty), Number(it.qty));
    newItems.push({ ...it, qty: splitQty });
    return { ...it, qty: Number(it.qty) - splitQty };
  }).filter(it => Number(it.qty) > 0);

  if (newItems.length === 0) return { newLots: lots, splitOk: false };

  const id = nextLotId(lots);
  const at = nowStr();
  const newLot = {
    lotId: id,
    items: newItems,
    status: opts.targetStatus || oldLot.status,
    statusHistory: [{ status: `แยกจาก ${oldLot.lotId}`, at, by: opts.by || "" }],
    notes: [],
    finishedStocked: false,
    machine: opts.machine || "",   // 🖨️ เครื่องพิมพ์
    rollNo: opts.rollNo || "",     // 🧵 ม้วน/แบตช์
    machineByStage: opts.machineByStage || {}, // 🏭 ทีม/เครื่องต่อขั้น (เช่น เย็บ: ทีม 3)
  };

  // ถ้า old lot ไม่เหลือ items → ลบทิ้ง
  const newLots = lots.map((l, i) => i === lotIdx ? { ...l, items: updatedOldItems } : l)
                      .filter(l => l.items.length > 0);
  newLots.push(newLot);
  return { newLots, splitOk: true };
}

// เลื่อนสถานะของล็อต — return new lots
export function moveLot(lots, lotIdx, targetStatus, by = "", note = "") {
  return lots.map((l, i) => {
    if (i !== lotIdx) return l;
    return {
      ...l,
      status: targetStatus,
      statusHistory: [...(l.statusHistory || []), { status: targetStatus, at: nowStr(), by, note: note || "" }],
    };
  });
}

// เพิ่ม note ในล็อต
export function addLotNote(lots, lotIdx, text, by = "", photoUrls = []) {
  return lots.map((l, i) => {
    if (i !== lotIdx) return l;
    return {
      ...l,
      notes: [...(l.notes || []), { at: nowStr(), by, text: text || "", photoUrls: photoUrls || [] }],
    };
  });
}

// ทุก role ขยับได้ทั้ง 2 ทิศ — โรงงานต้องคล่องตัว
export function canMoveTo(currentStatus, targetStatus, role, steps = PRODUCTION_STEPS) {
  if (!targetStatus) return false;
  const ti = steps.indexOf(targetStatus);
  if (ti < 0) return false;
  return true;
}

// ── ⚖️ แก้รายการในล็อต แล้วยอดต้องไปอยู่ที่ไหนสักแห่ง ──
//
// persistLots คำนวณ order.items / totalQty ใหม่จากล็อตทุกครั้ง — ล็อตคือที่มาของยอดสั่งผลิต
// ในระบบไม่มียอดสั่งเดิมเก็บแยกไว้ ดังนั้นแก้ล็อตหนึ่งให้ลดลง = ยอดสั่งผลิตทั้งใบลดตามเงียบ ๆ
//
// เคสจริง 15/09/2569 PRD6908-0009: แบ่งม้วนแล้วกรอก ฟ้า/L 1,200 ผิด (ที่ถูก 507)
// กดแก้เป็น 507 → 693 ตัวไม่กลับเข้าล็อตใหญ่ (เหลือจาก…) ยอดทั้งใบหายจาก 45,000 เป็น 44,307
// ของ 693 ตัวยังอยู่ในกองที่ยังไม่พิมพ์จริง ๆ แต่ระบบลืมไปแล้ว
//
// ตัวช่วยชุดนี้หาส่วนต่างรายบรรทัด แล้วย้ายไปคืน/ดึงกับล็อตอื่นในการเขียนครั้งเดียว

const trimS = (v) => String(v ?? "").trim();
// กุญแจเดียวกับที่ persistLots / รวมล็อต ใช้ — ตัดช่องว่างด้วย ไม่งั้นบรรทัดเดิมกับที่แก้
// (ตัวแก้ trim ให้) จะกลายเป็นคนละบรรทัด แล้วได้ส่วนต่าง +/− ผี
export const lotItemKey = (it) => [
  trimS(it?.colorIdx), trimS(it?.colorName), trimS(it?.colorHex),
  trimS(it?.size), trimS(it?.variant), trimS(it?.productionSize),
].join("|");

// ส่วนต่างรายบรรทัด (หลัง − ก่อน) → [{ key, delta, tpl }]  · tpl = แบบบรรทัดไว้สร้างบรรทัดใหม่ในล็อตปลายทาง
export function lotItemDeltas(before = [], after = []) {
  const m = new Map();
  const add = (it, sign) => {
    const q = Number(it?.qty) || 0;
    if (!q) return;
    const k = lotItemKey(it);
    const cur = m.get(k) || { key: k, delta: 0, tpl: it };
    cur.delta += sign * q;
    if (sign > 0) cur.tpl = it;
    m.set(k, cur);
  };
  before.forEach(it => add(it, -1));
  after.forEach(it => add(it, +1));
  return [...m.values()].filter(d => d.delta !== 0);
}

// ล็อตใหญ่ที่เหลือจากการแบ่งม้วน/แยกล็อต — ประวัติแรกขึ้นต้นว่า "เหลือจาก"
export const isLeftoverLot = (l) => /^เหลือจาก/.test(String(l?.statusHistory?.[0]?.status || ""));

// ล็อตที่คืน/ดึงยอดด้วยได้
//   ไม่ใช่ล็อตที่แก้ · ไม่ยกเลิก · ยังไม่เข้าคลัง (เข้าคลังแล้วแตะยอดจะทำให้สต๊อกไม่ตรง)
//   ค่าเริ่มต้น = ล็อตใหญ่ "เหลือจาก…" ตัวล่าสุด (ของที่ยังไม่แบ่งอยู่ที่นั่น) ไม่มีก็ล็อตที่ใหญ่ที่สุด
export function balanceTargets(lots = [], editedIdx) {
  const ok = lots.map((_, i) => i).filter(i =>
    i !== editedIdx && lots[i] && (lots[i].status || "") !== "ยกเลิก" && !lots[i].finishedStocked);
  if (!ok.length) return { options: [], def: null };
  const leftovers = ok.filter(i => isLeftoverLot(lots[i]));
  const def = leftovers.length
    ? leftovers[leftovers.length - 1]
    : ok.reduce((b, i) => (totalQtyOfLot(lots[i]) > totalQtyOfLot(lots[b]) ? i : b), ok[0]);
  return { options: ok, def };
}

// ย้ายส่วนต่างไปที่ล็อตปลายทาง — ล็อตที่แก้ลด → ปลายทางเพิ่ม · ล็อตที่แก้เพิ่ม → ปลายทางลด
// ปลายทางมีไม่พอให้ดึง → คืน short ไม่แตะอะไรเลย (ห้ามดึงจนติดลบ)
// ล็อตที่เหลือ 0 ทุกบรรทัดถูกเอาออก — ล็อตเปล่าไม่มีความหมายและทำให้การ์ดรก
export function applyDeltasToLot(lots = [], editedIdx, editedItems = [], targetIdx, deltas = []) {
  const target = lots[targetIdx];
  const items = (target?.items || []).map(it => ({ ...it, qty: Number(it.qty) || 0 }));
  const short = [];
  deltas.forEach(d => {
    const i = items.findIndex(it => lotItemKey(it) === d.key);
    const have = i >= 0 ? items[i].qty : 0;
    const next = have - d.delta;
    if (next < 0) { short.push({ key: d.key, tpl: d.tpl, need: d.delta, have }); return; }
    if (i >= 0) items[i].qty = next;
    else if (next > 0) { const { qty, ...rest } = d.tpl; items.push({ ...rest, qty: next }); }
  });
  if (short.length) return { lots, short, editedRemoved: false, targetRemoved: false };
  const targetItems = items.filter(it => it.qty > 0);
  const editedRemoved = editedItems.length === 0;
  const targetRemoved = targetItems.length === 0;
  const out = lots
    .map((l, i) => (i === editedIdx ? { ...l, items: editedItems } : i === targetIdx ? { ...l, items: targetItems } : l))
    .filter((_, i) => !(i === editedIdx && editedRemoved) && !(i === targetIdx && targetRemoved));
  return { lots: out, short, editedRemoved, targetRemoved };
}
