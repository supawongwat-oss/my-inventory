// 🧾 Invoice pure helpers — extracted from App.js

export const PAYMENT_METHODS = ["โอน", "COD", "เงินสด"];

export const docTypeLabel = (type) => ({
  receipt: "ใบเสร็จรับเงิน",
  tax: "ใบกำกับภาษี",
  quotation: "ใบเสนอราคา/ใบวางบิล",
}[type] || "ใบเสร็จรับเงิน");

export const docTypeLabelEn = (type) => ({
  receipt: "Receipt",
  tax: "Tax Invoice",
  quotation: "Quotation",
}[type] || "Receipt");

// คำนวณราคารายรายการ + ส่วนลดต่อรายการ
export const itemLineTotal = (item) => {
  const gross = (Number(item.qty) || 0) * (Number(item.unitPrice) || 0);
  if (!item.discount) return gross;
  if (item.discountType === "percent") {
    return gross * (1 - Math.min(Math.max(Number(item.discount) || 0, 0), 100) / 100);
  }
  return Math.max(0, gross - (Number(item.discount) || 0));
};

// คำนวณยอดรวมใบบิล (subtotal, discount, VAT, shipping, total)
export const calcInvoice = (items, vatRate, useVat, discount = 0, discountType = "amount", useShipping = false, shippingFee = 0, designFee = 0) => {
  // 1) รวมราคาทุกบรรทัด (หลังหักส่วนลดต่อบรรทัด)
  const grossSubtotal = items.reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.unitPrice) || 0), 0);
  const itemsAfterDiscount = items.reduce((s, i) => s + itemLineTotal(i), 0);
  const itemDiscountTotal = grossSubtotal - itemsAfterDiscount;
  // 2) ส่วนลดท้ายบิล
  const billDiscount = discountType === "percent"
    ? itemsAfterDiscount * (Math.min(Math.max(Number(discount) || 0, 0), 100) / 100)
    : Math.max(0, Number(discount) || 0);
  const subtotal = Math.max(0, itemsAfterDiscount - billDiscount);
  // 3) 🎨 ค่าออกแบบ — เป็นค่าบริการของร้าน จึงอยู่ใน "ฐาน VAT" (ต่างจากค่าจัดส่งที่บวกท้ายสุด)
  //    และตั้งใจไม่เอาเข้าฐานส่วนลดท้ายบิล เพื่อไม่ให้ส่วนลด % ไปกินค่าออกแบบโดยไม่ตั้งใจ
  //    บิลเก่าไม่มีฟิลด์นี้ → design = 0 → vatBase = subtotal → ยอดเท่าเดิมเป๊ะ
  const design = Math.max(0, Number(designFee) || 0);
  const vatBase = subtotal + design;
  // 4) VAT คำนวณจากฐานหลังส่วนลด + ค่าออกแบบ (ไม่รวมค่าจัดส่ง)
  const vat = useVat ? vatBase * (vatRate / 100) : 0;
  // 5) ค่าจัดส่ง (บวกท้ายสุด ไม่อยู่ในฐาน VAT)
  const shipping = useShipping ? Math.max(0, Number(shippingFee) || 0) : 0;
  return { grossSubtotal, itemDiscountTotal, itemsAfterDiscount, billDiscount, subtotal, design, vatBase, vat, shipping, total: vatBase + vat + shipping };
};

// 🚨 ราคาที่กรอกน่าจะพิมพ์ผิด
//
// เคสจริง 28 ส.ค. 2569: บิล INV6908-0173 ยอด 1,301,595 บาท
// ราคาต่อตัวที่บันทึกคือ 100115 ทั้งที่ของจริงคือ 115
// = พิมพ์ 115 ต่อท้ายเลข 100 ที่ค้างอยู่ในช่อง แล้วบันทึกผ่านไปเลย
// ไม่มีอะไรทักสักด่าน ทั้งที่ยอดต่างจากปกติเป็นพันเท่า
//
// เทียบกับ "ราคาขายในคลัง" ของรุ่น+สี+ไซส์นั้นโดยตรง แม่นกว่าตั้งเพดานลอย ๆ
// เพราะร้านขายเสื้อหลักร้อย แต่รองเท้าหลักพัน เพดานเดียวใช้ไม่ได้ทั้งร้าน
// เตือนอย่างเดียว ไม่บล็อก — ราคาพิเศษ/งานสั่งทำมีจริง คนตัดสินเองได้
const PRICE_RATIO = 10;      // ต่างกันเกิน 10 เท่า = ไม่ใช่ส่วนลด/บวกเพิ่มปกติแล้ว
const PRICE_CEILING = 20000; // ไม่มีของชิ้นไหนในร้านราคาเกินนี้ต่อตัว

/**
 * @param {Array} items รายการในบิล
 * @param {(item)=>number} priceOf อ่านราคาขายในคลังของรายการนั้น (0 = ไม่มีให้เทียบ)
 */
// 🏭 งานผลิต/สั่งทำไม่มีราคาในคลังให้เทียบ — ด่านต่อไปจึงดูที่ "ยอดรวมทั้งบิล"
//
// ใช้ประวัติของร้านเองเป็นเส้นวัด ไม่ตั้งตัวเลขตายตัว เพราะร้านโตขึ้นเส้นก็ต้องขยับตาม
// ใช้เปอร์เซ็นไทล์ที่ 95 ไม่ใช่ค่าสูงสุด — ค่าสูงสุดจะถูกบิลที่พิมพ์ผิดใบเดียวดึงเส้นให้เพี้ยนถาวร
//
// วัดกับข้อมูลจริง (156 ใบ ณ 28 ส.ค. 2569):
//   กลาง 6,435 · 90% 32,460 · 95% 56,130 · ใบใหญ่สุดที่ถูกต้อง 184,880
//   เส้นเตือน = 56,130 x 5 = 280,650
//   -> บิลที่พิมพ์ผิด 1,301,595 โดนจับ · ใบใหญ่สุดที่ถูกต้องยังผ่านสบาย (ห่าง 1.5 เท่า)
const TOTAL_RATIO = 5;
const MIN_HISTORY = 20;      // ข้อมูลน้อยกว่านี้ยังไม่รู้ว่า "ปกติ" ของร้านคือเท่าไหร่

export function typicalBillTotal(invoices = []) {
  const totals = (invoices || [])
    .filter(i => i && !i.mergedInto && !i.convertedTo && (i.status || "") !== "ยกเลิก")
    .map(i => Number(i.total) || 0)
    .filter(v => v > 0)
    .sort((a, b) => a - b);
  if (totals.length < MIN_HISTORY) return 0;
  return totals[Math.floor((totals.length - 1) * 0.95)];
}

/** คืนจำนวนเท่าที่เกินเส้น (0 = ปกติ) */
export function oddBillTotal(total, reference) {
  const t = Number(total) || 0, ref = Number(reference) || 0;
  if (ref <= 0 || t < ref * TOTAL_RATIO) return 0;
  return t / ref;
}

export function suspiciousPriceLines(items = [], priceOf) {
  const out = [];
  (items || []).forEach((it, idx) => {
    const price = Number(it.unitPrice) || 0;
    if (price <= 0) return;                       // แถมฟรี/ยังไม่ใส่ราคา ไม่ใช่เรื่องผิด
    const ref = Number(priceOf ? priceOf(it) : 0) || 0;
    let why = "";
    if (ref > 0 && price >= ref * PRICE_RATIO) why = `สูงกว่าราคาคลัง ${Math.round(price / ref)} เท่า`;
    else if (ref > 0 && price * PRICE_RATIO <= ref) why = `ต่ำกว่าราคาคลัง ${Math.round(ref / price)} เท่า`;
    else if (price >= PRICE_CEILING) why = "ราคาต่อตัวสูงผิดปกติ";
    if (why) out.push({ idx, price, ref, why, item: it });
  });
  return out;
}

// 🖼️ path ของรูปที่ "บิลใบนี้เป็นเจ้าของ" — ใช้ตอนลบบิล ไม่ให้ไฟล์ค้างกินพื้นที่ Storage
//
// ⚠️ นับเฉพาะรูปที่แนบเข้าบิลเอง (job ที่มี __manual) และอยู่ในโฟลเดอร์ invoiceJobs/ เท่านั้น
//   รูปที่ติดมาจากใบสั่ง custom เป็น "ไฟล์เดียวกัน" กับที่ใบ custom ใช้อยู่ ไม่ใช่สำเนา
//   ถ้าลบตามไปด้วย ใบ custom ที่ยังใช้งานอยู่จะรูปหาย
//   เงื่อนไข 2 ชั้น (__manual + prefix) ตั้งใจให้ซ้ำซ้อน กันข้อมูลเก่าที่ธงไม่ครบ
export const ownedImagePathsOf = (inv) => {
  const out = [];
  ((inv && inv.customDetails && inv.customDetails.jobs) || []).forEach(j => {
    if (!j || !j.__manual) return;
    (j.images || []).forEach(im => {
      const p = im && im.path;
      if (p && String(p).startsWith("invoiceJobs/")) out.push(p);
    });
  });
  return [...new Set(out)];
};

// ── Payment helpers ─────────────────────────────────────────────
export const getPaidTotal = (inv) => (inv?.payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
export const getRemaining = (inv) => Math.max(0, (Number(inv?.total) || 0) - getPaidTotal(inv));
export const getPaidPct = (inv) => {
  const t = Number(inv?.total) || 0;
  if (t <= 0) return 0;
  return Math.min(100, Math.round(getPaidTotal(inv) / t * 100));
};
