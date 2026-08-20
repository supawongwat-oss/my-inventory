// ⏰ ช่วงอายุหนี้ (Aging bands) — ตั้งเองได้ว่าค้างกี่วัน/กี่เดือน ใช้สีอะไร
//
// เดิมช่วงถูกฝังไว้ในโค้ด 0-30 / 31-60 / 61-90 / 90+ แก้ไม่ได้
// แต่ละร้านให้เครดิตไม่เท่ากัน — บางเจ้า 45 วันถือว่าปกติ บางเจ้าเกิน 15 วันก็ต้องโทรแล้ว
// เก็บไว้ที่ settings/aging เพื่อให้พนักงานทุกคนเห็นเกณฑ์เดียวกัน
//
// รูปแบบที่เก็บ: [{ id, upToDays, color }]  เรียงจากน้อยไปมาก
//   upToDays = ขอบบนของช่วง (รวมวันนั้น) · ช่วงสุดท้าย upToDays = null แปลว่า "ขึ้นไป"

export const AGING_DOC = "aging";
export const DAYS_PER_MONTH = 30;

export const DEFAULT_BANDS = [
  { id: "b1", upToDays: 30,   color: "#3a7a52" },
  { id: "b2", upToDays: 60,   color: "#b88600" },
  { id: "b3", upToDays: 90,   color: "#d97706" },
  { id: "b4", upToDays: null, color: "#b94a48" },
];

const isNum = (v) => typeof v === "number" && isFinite(v) && v > 0;

// ทำให้ชุดช่วงใช้งานได้เสมอ — เรียงจากน้อยไปมาก, ตัดค่าซ้ำ/ค่าพัง, ปิดท้ายด้วยช่วง "ขึ้นไป"
// เผื่อข้อมูลใน Firestore ถูกแก้มือหรือมาจากเวอร์ชันเก่า จะได้ไม่ทำหน้าจอพัง
export function normalizeBands(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const finite = list
    .filter(b => b && isNum(Number(b.upToDays)))
    .map(b => ({ id: b.id || `b${Math.random().toString(36).slice(2, 7)}`, upToDays: Math.round(Number(b.upToDays)), color: b.color || "#3a7a52" }))
    .sort((a, b) => a.upToDays - b.upToDays);

  const seen = new Set();
  const uniq = finite.filter(b => (seen.has(b.upToDays) ? false : (seen.add(b.upToDays), true)));
  if (uniq.length === 0) return DEFAULT_BANDS;

  const last = list.find(b => b && (b.upToDays === null || b.upToDays === undefined || b.upToDays === ""));
  uniq.push({ id: last?.id || "last", upToDays: null, color: last?.color || "#b94a48" });
  return uniq;
}

// ขอบล่างของช่วง — คือขอบบนของช่วงก่อนหน้า +1
export const bandFrom = (bands, i) => (i === 0 ? 0 : (bands[i - 1].upToDays || 0) + 1);

// ป้ายกำกับช่วง เช่น "0-30 วัน" / "90 วันขึ้นไป"
export function bandLabel(bands, i) {
  const from = bandFrom(bands, i);
  const to = bands[i].upToDays;
  return to == null ? `${from} วันขึ้นไป` : `${from}-${to} วัน`;
}

// ป้ายรอง — บอกเป็นเดือนให้ด้วย เพราะร้านคิดเป็นเดือน ("เกิน 2 เดือน")
export function bandSubLabel(bands, i) {
  const to = bands[i].upToDays;
  const from = bandFrom(bands, i);
  const m = (d) => Math.round((d / DAYS_PER_MONTH) * 10) / 10;
  if (to == null) return `เกิน ${m(from - 1)} เดือน`;
  if (i === 0) return `ไม่เกิน ${m(to)} เดือน`;
  return `${m(from - 1)}-${m(to)} เดือน`;
}

// ช่วงที่บิลใบนี้ตกอยู่ — คืน index (ช่วงสุดท้ายรับทุกอย่างที่เหลือ)
export function bandIndexFor(days, bands) {
  for (let i = 0; i < bands.length; i++) {
    const to = bands[i].upToDays;
    if (to == null || days <= to) return i;
  }
  return bands.length - 1;
}

export const bandColorFor = (days, bands) => bands[bandIndexFor(days, bands)]?.color || "#64748b";

// สีจาง ๆ สำหรับพื้นการ์ด — รับ hex 6 หลัก
export function tint(hex, alpha = 0.08) {
  const h = String(hex || "").replace("#", "");
  if (h.length !== 6) return "rgba(100,116,139,0.08)";
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
