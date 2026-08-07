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

// รูปที่ใช้ทำ n-gram — ตัดช่องว่างทิ้งหมด เพราะคนพิมพ์เว้นวรรคไม่เหมือนกัน
export const gramKeyOf = (raw) =>
  String(raw || "").normalize("NFC").toLowerCase().replace(/\s+/g, "");

export const GRAM_LEN = 3;
const MAX_GRAMS = 80; // กันชื่อยาวผิดปกติทำให้เอกสารบวม

// ✂️ ตัดชื่อเป็นชิ้นละ 3 ตัวอักษรทุกตำแหน่ง
//    "ร้านสมชาย" → ร้า, ้าน, านส, นสม, สมช, มชา, ชาย
//    เก็บเป็น array แล้วค้นด้วย array-contains → หาคำที่อยู่ "ตรงกลาง" ชื่อได้
//    (ภาษาไทยไม่เว้นวรรคระหว่างคำ จึงตัดเป็นคำไม่ได้ ต้องตัดเป็นตัวอักษรแบบนี้)
export const nameGramsOf = (raw) => {
  const s = gramKeyOf(raw);
  if (!s) return [];
  if (s.length <= GRAM_LEN) return [s];
  const out = new Set();
  for (let i = 0; i + GRAM_LEN <= s.length && out.size < MAX_GRAMS; i++) {
    out.add(s.slice(i, i + GRAM_LEN));
  }
  return [...out];
};

// ฝังคีย์ลงในเอกสาร (ใบสั่งของ / บิล)
export const withSearchKeys = (data) => ({
  ...data,
  phoneKey: phoneKeyOf(data.customerPhone),
  nameKey: nameKeyOf(data.customerName),
  nameGrams: nameGramsOf(data.customerName),
});

// ฝังคีย์ลงในทะเบียนลูกค้า (ใช้ field ชื่อ name/phone ไม่ใช่ customerName/customerPhone)
export const withCustomerSearchKeys = (data) => ({
  ...data,
  phoneKey: phoneKeyOf(data.phone),
  nameKey: nameKeyOf(data.name),
  nameGrams: nameGramsOf(data.name),
});
