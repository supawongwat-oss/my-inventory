// 🔎 คีย์ค้นหาที่ฝังลงในเอกสารตอนบันทึก
// ทำไมต้องมี: Firestore ค้นหา "มีคำนี้อยู่ข้างใน" ไม่ได้ — ทำได้แค่ "เท่ากับ" หรือ "ขึ้นต้นด้วย"
// เบอร์โทรที่พิมพ์มาไม่เหมือนกัน (081-234-5678 / 0812345678 / 081 234 5678) จะหาไม่เจอ
// ถ้าไม่เก็บรูปมาตรฐานไว้ → เก็บ phoneKey (ตัวเลขล้วน) ไว้ตอนบันทึกแทน

// "081-234-5678" → "0812345678" · "+66812345678" → "0812345678"
export const phoneKeyOf = (raw) => {
  let d = String(raw || "").replace(/\D/g, "");
  if (d.startsWith("66") && d.length >= 11) d = "0" + d.slice(2);
  return d;
};

// ชื่อที่ใช้เทียบ "ขึ้นต้นด้วย" — ตัดช่องว่างซ้ำ/ตัวพิมพ์ใหญ่ออก
export const nameKeyOf = (raw) =>
  String(raw || "").normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();

// ฝังคีย์ลงในเอกสาร (ใบสั่งของ / บิล / ใบสั่งผลิต custom)
export const withSearchKeys = (data) => ({
  ...data,
  phoneKey: phoneKeyOf(data.customerPhone),
  nameKey: nameKeyOf(data.customerName),
});
