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
