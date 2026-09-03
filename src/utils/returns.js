// ↩️ รับคืนสินค้า — ตรรกะกลาง (ไม่มี UI ไม่แตะ Firestore)
//
// โจทย์จริงของร้าน: ลูกค้าอยู่ต่างจังหวัด ส่งของคืนมาทางพัสดุ
// กล่องที่มาถึงมักมีแค่ "ตัวสินค้า" ไม่มีบิล บางทีไม่มีแม้แต่ชื่อคนส่ง
// ระบบจึงต้องรับของเข้ามาก่อนได้ แล้วค่อยจับคู่กับบิลทีหลัง
//
// สถานะของใบรับคืน:
//   รอจับคู่บิล → ของถึงร้านแล้ว แต่ยังไม่รู้ว่ามาจากบิลใบไหน
//   จับคู่แล้ว  → รู้บิลแล้ว คิดยอดลดหนี้และคืนสต็อกเรียบร้อย
//   ยกเลิก      → รับผิด/ตีกลับ

export const RETURN_STATUSES = ["รอจับคู่บิล", "จับคู่แล้ว", "ยกเลิก"];

// 🔍 สภาพของ เป็นคนละเส้นกับเรื่องเงิน
//   เส้นเงิน (status)   : รอจับคู่บิล → จับคู่แล้ว
//   เส้นของ  (qcStatus) : รอตรวจ → ตรวจแล้ว (ค่อยเข้าสต็อกตอนนี้)
// แยกกันเพราะจับคู่บิลได้เร็วไม่ได้แปลว่าตรวจของแล้ว และของดีที่หาบิลไม่เจอ
// ก็ไม่ควรค้างเติมสต็อกไม่ได้
// 💰 คืนเงินให้ลูกค้าทางไหน — เลือกได้ทางเดียวเท่านั้น ห้ามซ้อนกัน
//   statement = หักออกจากใบวางบิลงวดถัดไป (ค่าเริ่มต้น — ลูกค้าเครดิต)
//   cash      = จ่ายเงินคืนหน้าร้าน/โอนคืน แล้วออก "ใบลดหนี้" เป็นหลักฐานให้ลูกค้า
//
// ⚠️ ใบที่เลือก cash ต้องไม่ถูกหักในใบวางบิลอีก ไม่งั้นลูกค้าได้เงินคืน 2 ทาง
//    (creditsForStatement ใน statement.js คัดออกให้แล้ว)
export const SETTLE_MODES = [
  { id: "statement", label: "หักในใบวางบิล", hint: "ลูกค้าเครดิต — ยกไปหักงวดถัดไป" },
  { id: "cash",      label: "คืนเป็นเงินสด",  hint: "จ่ายคืนเลย + ออกใบลดหนี้ให้ลูกค้า" },
];
export const settleModeOf = (r) => (r?.settleMode === "cash" ? "cash" : "statement");
export const isCashRefund = (r) => settleModeOf(r) === "cash";
export const QC_STATUSES = ["รอตรวจ", "ตรวจแล้ว"];

// ใบเก่าก่อนมีขั้นตรวจ: ของถูกเติมสต็อกไปแล้วตอนจับคู่บิล → ถือว่าตรวจแล้ว
// (ถ้าไม่กันไว้ จะกดตรวจซ้ำแล้วสต็อกเด้งเกิน)
export const qcStatusOf = (r) =>
  r?.qcStatus || (r?.status === "จับคู่แล้ว" ? "ตรวจแล้ว" : "รอตรวจ");
export const needsQC = (r) => (r?.status || "") !== "ยกเลิก" && qcStatusOf(r) === "รอตรวจ";

export const RETURN_REASONS = [
  "ไซส์ไม่พอดี",
  "สินค้ามีตำหนิ",
  "ได้ของไม่ตรงที่สั่ง",
  "ลูกค้าเปลี่ยนใจ",
  "งานพิมพ์/ปักไม่ตรงแบบ",
  "อื่น ๆ",
];

// สภาพของที่คืนมา — ตัดสินว่าเอากลับเข้าสต็อกได้ไหม
export const RETURN_CONDITIONS = [
  { id: "ขายต่อได้", restock: true,  hint: "สภาพดี เอากลับเข้าสต็อก" },
  { id: "ตำหนิ",     restock: false, hint: "ขายต่อไม่ได้ ไม่เข้าสต็อก" },
  { id: "ชำรุด",     restock: false, hint: "ทิ้ง ไม่เข้าสต็อก" },
];

export const conditionRestocks = (cond) =>
  (RETURN_CONDITIONS.find(c => c.id === cond) || RETURN_CONDITIONS[0]).restock;

const num = (v) => Number(v) || 0;

export const norm = (s) => String(s || "").normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();

// 🔑 กุญแจเทียบว่า "ของชิ้นนี้" กับ "บรรทัดในบิล" เป็นตัวเดียวกันไหม
//   ใช้ชื่อรุ่นแทน id ด้วย เพราะของที่คืนมาบางทีกรอกจากป้ายบนตัวเสื้อ ไม่ได้เลือกจากระบบ
export const lineKey = (it) => [
  norm(it?.clothingId || it?.clothingName),
  norm(it?.colorName),
  norm(it?.size),
].join("|");

// ยอดลดหนี้ของใบรับคืน — ราคาต่อหน่วยยึดตาม "บิลต้นทาง" ไม่ใช่ราคาป้ายวันนี้
export const calcReturn = (items = []) => {
  const qty = items.reduce((s, i) => s + num(i.qty), 0);
  const total = items.reduce((s, i) => s + num(i.qty) * num(i.unitPrice), 0);
  const restockQty = items.reduce((s, i) => s + (conditionRestocks(i.condition) ? num(i.qty) : 0), 0);
  return { qty, total, restockQty };
};

// ── จับคู่บิล ────────────────────────────────────────────────
// ให้คะแนนว่าบิลใบไหน "น่าจะใช่" ที่สุด แล้วเรียงให้พนักงานเลือก
// ไม่จับคู่อัตโนมัติ — ตัดสินใจเรื่องเงินโดยไม่ให้คนยืนยันก่อนนั้นอันตรายเกินไป
//
// น้ำหนักคะแนน (มาก→น้อย):
//   เบอร์โทรตรง            60   ← ชี้ตัวได้แม่นสุด กล่องพัสดุมักมีเบอร์
//   ชื่อลูกค้าตรง           40
//   ชื่อลูกค้าใกล้เคียง      20
//   ทุกชิ้นที่คืนมีในบิล     50   ← หลักฐานที่หนักที่สุดเมื่อไม่รู้ตัวลูกค้า
//   มีบางชิ้น              15/ชิ้น
//   จำนวนในบิลพอให้คืน      10
//   ออกบิลไม่เกิน 90 วัน     15   ← ของที่คืนมักเป็นของใหม่
const DAY = 24 * 60 * 60 * 1000;

export function scoreInvoiceMatch(inv, ret, nowMs = Date.now()) {
  if (!inv) return { score: 0, reasons: [] };
  const reasons = [];
  let score = 0;

  const digits = (s) => String(s || "").replace(/\D/g, "");
  const retPhone = digits(ret?.customerPhone);
  if (retPhone && retPhone.length >= 9 && digits(inv.customerPhone) === retPhone) {
    score += 60; reasons.push("เบอร์ตรง");
  }

  const rn = norm(ret?.customerName), inm = norm(inv.customerName);
  if (rn && inm) {
    if (rn === inm) { score += 40; reasons.push("ชื่อตรง"); }
    else if (inm.includes(rn) || rn.includes(inm)) { score += 20; reasons.push("ชื่อใกล้เคียง"); }
  }

  // เทียบตัวสินค้า — รวมจำนวนต่อ key เผื่อบิลแตกหลายบรรทัดเป็นไซส์เดียวกัน
  const have = new Map();
  (inv.items || []).forEach(it => {
    const k = lineKey(it);
    have.set(k, (have.get(k) || 0) + num(it.qty));
  });
  const retItems = (ret?.items || []).filter(i => num(i.qty) > 0);
  if (retItems.length) {
    let found = 0, enough = 0;
    retItems.forEach(ri => {
      const avail = have.get(lineKey(ri)) || 0;
      if (avail > 0) { found++; if (avail >= num(ri.qty)) enough++; }
    });
    if (found === retItems.length) { score += 50; reasons.push("มีสินค้าครบทุกชิ้น"); }
    else if (found > 0) { score += found * 15; reasons.push(`มีสินค้า ${found}/${retItems.length} ชิ้น`); }
    if (enough === retItems.length && retItems.length > 0) score += 10;
  }

  const t = inv.createdAt?.seconds ? inv.createdAt.seconds * 1000 : Date.parse(inv.date || "") || 0;
  if (t && nowMs - t <= 90 * DAY) { score += 15; reasons.push("ออกบิลไม่เกิน 90 วัน"); }

  return { score, reasons };
}

// เรียงบิลที่น่าจะใช่ — ตัดใบที่ไม่เข้าเค้าเลยทิ้ง ไม่ให้พนักงานต้องไล่อ่านทั้งกอง
export function suggestInvoices(invoices = [], ret, { limit = 8, minScore = 20 } = {}) {
  const nowMs = Date.now();
  return invoices
    .filter(inv => !inv.mergedInto && !inv.convertedTo && (inv.status || "") !== "ยกเลิก")
    .map(inv => ({ inv, ...scoreInvoiceMatch(inv, ret, nowMs) }))
    .filter(x => x.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// ── สรุปยอดคืนของบิลหนึ่งใบ ──────────────────────────────────
// นับเฉพาะใบที่จับคู่แล้ว — ใบที่ยังรอจับคู่ยังไม่ผูกกับบิลไหน
export function returnSummaryOf(returns = [], invoiceId) {
  const mine = returns.filter(r => r.invoiceId === invoiceId && r.status === "จับคู่แล้ว");
  return {
    count: mine.length,
    qty: mine.reduce((s, r) => s + num(r.creditQty), 0),
    total: mine.reduce((s, r) => s + num(r.creditTotal), 0),
    list: mine,
  };
}

// ยอดสุทธิหลังหักของที่คืน — ตัวเลขที่ควรใช้ตอนทวงเงินและดูยอดค้าง
export const netAfterReturns = (inv, returns = []) =>
  Math.max(0, num(inv?.total) - returnSummaryOf(returns, inv?.id).total);

// 🔎 ค้นหาสินค้าในบิล — ทุกคำต้องเจอ (พิมพ์ "k-12 แดง 2xl" ต้องได้บิลที่มีครบทั้ง 3)
//   เดิมช่องค้นบิลมองแค่ชื่อลูกค้า/เบอร์/เลขที่ ค้นจากตัวสินค้าไม่ได้เลย
export function invoiceItemsText(inv) {
  return (inv?.items || [])
    .map(it => [it.clothingName, it.description, it.colorName, it.variant, it.size].filter(Boolean).join(" "))
    .join(" | ");
}

export function matchesTokens(haystack, query) {
  const tokens = norm(query).split(" ").filter(Boolean);
  if (tokens.length === 0) return true;
  const h = norm(haystack);
  return tokens.every(t => h.includes(t));
}

// ↩️ รายการสินค้าที่คืนมา แบบสั้น ๆ พออ่านในบรรทัดเดียว
//    เช่น "K-12 แดง 2XL ×2 · K-11 ดำ L ×1"
//
// ทำไมต้องมี: เดิมทุกที่โชว์แค่ "คืน 3 ชิ้น -฿1,200" ซึ่งบอกไม่ได้ว่าของอะไร
// ตอนลูกค้าโทรมาถามว่าหักอะไร หรือตอนตรวจใบวางบิลก่อนส่ง ต้องเปิดใบรับคืนทีละใบ
// และใบวางบิลที่ส่งให้ลูกค้าก็ไม่มีรายการ ลูกค้าเลยเทียบไม่ได้ว่าหักตรงกับที่คืนไปไหม
export const returnItemLabel = (it) =>
  [it?.clothingName || it?.description || "(ไม่ระบุรุ่น)", it?.colorName, it?.size]
    .filter(Boolean).join(" ") + (Number(it?.qty) > 0 ? ` ×${Number(it.qty)}` : "");

export const returnItemsText = (r, max = 0) => {
  const items = (r?.items || []).filter(i => Number(i.qty) > 0);
  if (items.length === 0) return "";
  const labels = items.map(returnItemLabel);
  if (max > 0 && labels.length > max) {
    return labels.slice(0, max).join(" · ") + ` +อีก ${labels.length - max}`;
  }
  return labels.join(" · ");
};

// รายการสินค้าของใบรับคืนหลายใบรวมกัน — ใช้ตอนบิลใบเดียวมีของคืนหลายรอบ
export const returnsItemsText = (list = [], max = 0) =>
  returnItemsText({ items: list.flatMap(r => r?.items || []) }, max);

// snapshot รายการสินค้าลงเอกสาร — เก็บชื่อ/สี/ไซส์/ราคา ณ ตอนออกเอกสาร
// (กฎเหล็ก: เปลี่ยนชื่อรุ่นในคลังทีหลัง เอกสารที่ออกไปแล้วต้องไม่ขยับ)
export const snapshotReturnItems = (r) =>
  (r?.items || []).filter(i => Number(i.qty) > 0).map(i => ({
    clothingName: i.clothingName || i.description || "",
    colorName: i.colorName || "",
    size: i.size || "",
    qty: Number(i.qty) || 0,
    unitPrice: Number(i.unitPrice) || 0,
  }));
