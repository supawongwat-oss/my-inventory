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
