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
export const calcInvoice = (items, vatRate, useVat, discount = 0, discountType = "amount", useShipping = false, shippingFee = 0) => {
  // 1) รวมราคาทุกบรรทัด (หลังหักส่วนลดต่อบรรทัด)
  const grossSubtotal = items.reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.unitPrice) || 0), 0);
  const itemsAfterDiscount = items.reduce((s, i) => s + itemLineTotal(i), 0);
  const itemDiscountTotal = grossSubtotal - itemsAfterDiscount;
  // 2) ส่วนลดท้ายบิล
  const billDiscount = discountType === "percent"
    ? itemsAfterDiscount * (Math.min(Math.max(Number(discount) || 0, 0), 100) / 100)
    : Math.max(0, Number(discount) || 0);
  const subtotal = Math.max(0, itemsAfterDiscount - billDiscount);
  // 3) VAT คำนวณจาก subtotal หลังส่วนลด (ไม่รวมค่าจัดส่ง)
  const vat = useVat ? subtotal * (vatRate / 100) : 0;
  // 4) ค่าจัดส่ง (บวกท้ายสุด ไม่อยู่ในฐาน VAT)
  const shipping = useShipping ? Math.max(0, Number(shippingFee) || 0) : 0;
  return { grossSubtotal, itemDiscountTotal, itemsAfterDiscount, billDiscount, subtotal, vat, shipping, total: subtotal + vat + shipping };
};

// ── Payment helpers ─────────────────────────────────────────────
export const getPaidTotal = (inv) => (inv?.payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
export const getRemaining = (inv) => Math.max(0, (Number(inv?.total) || 0) - getPaidTotal(inv));
export const getPaidPct = (inv) => {
  const t = Number(inv?.total) || 0;
  if (t <= 0) return 0;
  return Math.min(100, Math.round(getPaidTotal(inv) / t * 100));
};
