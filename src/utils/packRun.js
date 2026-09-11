// 📦 รอบแพ็ค — ตรรกะกลาง (ไม่มี UI ไม่แตะ Firestore)
//
// โจทย์: ลูกค้าขายบน Shopee/Lazada/TikTok แล้วส่งงานมาให้เราแพ็ค
//   · มาทีละ 1 ชิ้น 1 ออเดอร์ วันหนึ่งเจ้าละ 200 ออเดอร์ · ตอนนี้มี 6-7 เจ้า
//   · ลูกค้าส่ง "ใบปะหน้า" ของแพลตฟอร์มมาให้ เราแค่แปะ — ไม่ต้องรู้ที่อยู่ ไม่ต้องออกเลขพัสดุ
//   · เก็บเงินโดยสรุปเป็นรอบ ออกบิลใบเดียว
//
// ดังนั้นสิ่งที่ระบบต้องรู้จริง ๆ มีแค่ "รอบนี้แพ็คอะไรไปกี่ชิ้น" ไม่ใช่ 200 ใบสั่ง
// ถ้าสร้างใบสั่งของ 200 ใบต่อเจ้าต่อวัน = 1,200-1,400 ใบ/วัน ทุกหน้าจอจะพังซ้ำรอยเดิม
//
// 🔑 เก็บเป็น "ตัวนับ" ไม่ใช่รายการ
//   counts: { "<clothingId>|<colorIdx>|<size>": จำนวน }
//   meta:   { key เดิม: { ชื่อรุ่น สี ไซส์ } }  ← ไว้แสดงผลโดยไม่ต้องไปค้นคลังทุกครั้ง
//
// ทำไมเป็น map ไม่ใช่ array: กด +1 ทีละชิ้นตอนแพ็คจริงเป็นร้อยครั้ง
//   ถ้าเขียนทั้ง array ใหม่ทุกครั้ง = เขียนทับกันเองเมื่อแพ็คพร้อมกัน 2 เครื่อง
//   map + increment เขียนทีละช่อง ชนกันไม่ได้ และแต่ละครั้งเล็กมาก

export const PACK_STATUSES = ["เปิดอยู่", "ปิดแล้ว"];

export const keyOf = (clothingId, colorIdx, size) => `${clothingId}|${colorIdx ?? ""}|${size ?? ""}`;

const num = (v) => Number(v) || 0;

// รวมยอดทั้งรอบ
export const totalOf = (run) =>
  Object.values(run?.counts || {}).reduce((s, v) => s + num(v), 0);

// 📋 จัดกลุ่มเป็นตารางให้คนอ่าน — รุ่น+สี 1 แถว แล้วกางไซส์เป็นช่อง
//    ตัดช่องที่เหลือ 0 ทิ้ง (กด +1 เกินแล้วลดกลับ ไม่ควรค้างเป็นแถวเปล่า)
export function groupRun(run, sizeOrder = []) {
  const counts = run?.counts || {};
  const meta = run?.meta || {};
  const groups = new Map();
  Object.entries(counts).forEach(([k, qtyRaw]) => {
    const qty = num(qtyRaw);
    if (qty <= 0) return;
    const m = meta[k] || {};
    const gk = `${m.clothingId || ""}|${m.colorIdx ?? ""}`;
    if (!groups.has(gk)) {
      groups.set(gk, {
        key: gk,
        clothingId: m.clothingId || "",
        clothingName: m.clothingName || "(ไม่ทราบรุ่น)",
        colorIdx: m.colorIdx ?? null,
        colorName: m.colorName || "",
        colorHex: m.colorHex || "",
        unitPrice: num(m.unitPrice),
        sizes: [],
        qty: 0,
      });
    }
    const g = groups.get(gk);
    g.sizes.push({ key: k, size: m.size || "", qty, unitPrice: num(m.unitPrice) });
    g.qty += qty;
  });
  const rank = (s) => {
    const i = sizeOrder.indexOf(s);
    return i < 0 ? 999 : i;
  };
  const out = [...groups.values()];
  out.forEach(g => g.sizes.sort((a, b) => rank(a.size) - rank(b.size) || String(a.size).localeCompare(String(b.size))));
  out.sort((a, b) => a.clothingName.localeCompare(b.clothingName, "th") || String(a.colorName).localeCompare(String(b.colorName), "th"));
  return out;
}

// แปลงรอบ → รายการสำหรับตัดสต็อก / ออกบิล
// ยุบเป็นบรรทัดละ (รุ่น+สี+ไซส์) เหมือนใบสั่งปกติ ระบบส่วนอื่นจึงใช้ต่อได้เลย
export function runToItems(run) {
  const out = [];
  Object.entries(run?.counts || {}).forEach(([k, qtyRaw]) => {
    const qty = num(qtyRaw);
    if (qty <= 0) return;
    const m = (run.meta || {})[k] || {};
    out.push({
      clothingId: m.clothingId || "",
      clothingName: m.clothingName || "",
      colorIdx: m.colorIdx ?? null,
      colorName: m.colorName || "",
      colorHex: m.colorHex || "",
      size: m.size || "",
      qty,
      unitPrice: num(m.unitPrice),
      unit: "ชิ้น",
      description: `${m.clothingName || ""}${m.colorName ? ` (${m.colorName})` : ""}${m.size ? ` ไซส์ ${m.size}` : ""}`,
    });
  });
  return out;
}

export const runTotalValue = (run) =>
  runToItems(run).reduce((s, i) => s + i.qty * i.unitPrice, 0);

// 🏷️ หาว่าบาร์โค้ดที่สแกนมาเป็นรุ่น+สีไหน
//    บาร์โค้ดในระบบผูกกับ "รุ่น + สี" (ไม่มีไซส์) — สแกนได้ถึงตรงนั้น แล้วค่อยแตะไซส์เอง
//    1 สแกน + 1 แตะ ต่อ 1 กล่อง เร็วกว่าไล่หาในรายการมาก
export function findByBarcode(clothingItems = [], code) {
  const c = String(code || "").trim();
  if (!c) return null;
  for (const item of clothingItems) {
    const idx = (item.colors || []).findIndex(col => String(col.barcode || "").trim() === c);
    if (idx >= 0) return { item, colorIdx: idx };
  }
  return null;
}

// 🔕 ปิดการแสดง "ค้างตัดสต๊อก" ไว้ก่อน
//
//    ตอนนี้ยังไม่ได้กรอกสต๊อกเข้าระบบ ทุกรอบจึงค้างตัดเต็มยอดเสมอ
//    ป้าย ⏳ / แถบสรุป / ปุ่มตัดส่วนที่ค้าง / คำเตือนตอนปิดรอบ จึงขึ้นทุกรอบแต่ไม่มีความหมาย
//
//    ⚠️ ปิดแค่ "หน้าจอ" — ระบบยังจด stockShort ต่อเงียบ ๆ ห้ามเอาออก
//       เปิดรอบกลับ/ลบรอบ คืนสต๊อกจากตัวนี้ (runTakenItems = ยอด − ค้าง)
//       ถ้าไม่จด รอบที่ตัดจริงได้ 0 จะคืนเต็มยอด = ของผีเข้าคลัง
//
//    ⚠️ ก่อนเปิดกลับเป็น true หลังนับสต๊อกเสร็จ: ต้องล้าง stockShort ของรอบเก่าทิ้งก่อน
//       ห้ามกด "ตัดส่วนที่ค้างทั้งหมด" — ยอดที่นับได้ตอนนั้นคือของที่เหลือหลังส่งไปแล้ว
//       ถ้าไปหักค้างเก่าซ้ำ สต๊อกจะติดลบเท่ากับของที่ส่งไปทั้งหมดก่อนนับ
export const STOCK_SHORT_ENABLED = false;

// 📉 ส่วนที่ตัดสต๊อกไม่ได้ตอนปิดรอบ — คลังยังกรอกไม่ครบ ระบบจึงมีของน้อยกว่าที่ส่งจริง
//    stockShort: { key เดียวกับ counts: จำนวนที่ยังค้างตัด }
//    ไล่จาก counts ด้วย key ของมันเอง ไม่ประกอบ key ใหม่จาก meta — ประกอบเองแล้วพลาดนิดเดียว
//    (colorIdx 0 กับ "" / ไซส์มีช่องว่าง) จะจับคู่ไม่ติดแล้วคืนสต๊อกผิดช่อง
const splitRun = (run) => {
  const short = run?.stockShort || {};
  const all = [], taken = [], owed = [];
  Object.entries(run?.counts || {}).forEach(([key, q]) => {
    const qty = num(q);
    if (qty <= 0) return;
    const m = (run.meta || {})[key] || {};
    const base = {
      key, clothingId: m.clothingId || "", clothingName: m.clothingName || "",
      colorIdx: m.colorIdx ?? null, colorName: m.colorName || "", size: m.size || "",
    };
    const s = Math.min(qty, Math.max(0, num(short[key])));
    all.push({ ...base, qty });
    if (qty - s > 0) taken.push({ ...base, qty: qty - s });
    if (s > 0) owed.push({ ...base, qty: s });
  });
  return { all, taken, owed };
};

// ทุกบรรทัดของรอบ (ใช้ตอนตัดครั้งแรก)
export const runStockLines = (run) => splitRun(run).all;
// ที่ "ออกจากคลังไปแล้วจริง" = ยอดรอบ − ส่วนที่ค้าง
//   ใช้ตอนคืนสต๊อก (เปิดรอบกลับ / ลบรอบ) — คืนเต็มยอดทั้งที่ตัดไปได้แค่บางส่วน
//   ของที่ไม่เคยออกจากคลังจะเด้งเข้ามาเป็นของผี
export const runTakenItems = (run) => splitRun(run).taken;
// ที่ยังค้างตัด
export const runShortItems = (run) => splitRun(run).owed;
export const shortOf = (run) => splitRun(run).owed.reduce((a, x) => a + x.qty, 0);

// 🚫 ของไม่เจอตอนจัด — วางแผนว่าตัดออกจากรอบแล้วต้องขยับอะไรบ้าง
//
//    บิลรอบแพ็คสร้างจาก counts ตรง ๆ ของที่ตัดออกจาก counts จึงไม่ไปอยู่ในบิล
//    ส่วนสต๊อก ถ้ารอบนี้ตัดสต๊อกไปแล้ว ต้องแยกให้ถูกว่าชิ้นที่ไม่ได้ส่ง "เคยหักออกจากคลังหรือยัง":
//      · กินส่วนที่ค้างตัด (stockShort) ก่อน — ส่วนนั้นยังไม่เคยหักออก ไม่ต้องคืน
//      · ที่เหลือคือของที่ระบบหักไปแล้วแต่ไม่ได้ส่งจริง → ต้องคืนเข้าคลัง
//    ทำแบบนี้ (หักไปแล้ว + ค้างตัด) = ยอดที่ส่งจริงเสมอ
//
//    marks = { key ใน counts: จำนวนที่ไม่เจอ } → จำกัดไม่เกินยอดในรอบ ติดลบ/ไม่ใช่ตัวเลขข้ามทิ้ง
export function planMissing(run, marks = {}) {
  const counts = run?.counts || {};
  const short = run?.stockShort || {};
  const meta = run?.meta || {};
  const lines = [];
  Object.entries(marks || {}).forEach(([key, raw]) => {
    const have = num(counts[key]);
    const n = Math.min(have, Math.max(0, Math.floor(num(raw))));
    if (n <= 0) return;
    const owedPart = run?.stockCut ? Math.min(n, Math.max(0, num(short[key]))) : 0;
    const restorePart = run?.stockCut ? n - owedPart : 0;
    const m = meta[key] || {};
    lines.push({
      key, n, owedPart, restorePart,
      clothingId: m.clothingId || "", clothingName: m.clothingName || "",
      colorIdx: m.colorIdx ?? null, colorName: m.colorName || "", size: m.size || "",
    });
  });
  const sum = (f) => lines.reduce((a, l) => a + l[f], 0);
  return { lines, total: sum("n"), owedTotal: sum("owedPart"), restoreTotal: sum("restorePart") };
}

// รวมที่เคยตัดออกเพราะหาไม่เจอ (ไว้โชว์ป้าย)
export const missingOf = (run) => Object.values(run?.missing || {}).reduce((a, v) => a + num(v), 0);
