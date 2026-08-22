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
