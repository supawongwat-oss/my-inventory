// Token-based fuzzy search — matches when every whitespace-separated token
// appears somewhere in the haystack, in any order.
// พิมพ์ "ดี สม" เจอ "สมชาย ใจดี" ได้เลย
export const norm = (s) =>
  String(s || "")
    .normalize("NFC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

export const tokens = (q) => norm(q).split(" ").filter(Boolean);

// 🇹🇭 ค้นภาษาไทยต้องทนกับสระ/วรรณยุกต์ที่พิมพ์ไม่ตรงกัน
//
// เคสจริง: ลูกค้าชื่อ "สุพล" พิมพ์ "สุพล" แล้วไม่เจอ แต่พิมพ์ "พล" กลับเจอ
// เพราะ ุ (U+0E38) กับ ู (U+0E39) อยู่คนละปุ่มแต่ตาเปล่าแทบแยกไม่ออก
// พลาดสระตัวเดียว = หาลูกค้าไม่เจอทั้งราย แล้วก็ไปสร้างซ้ำในทะเบียน
// (ที่เจอเยอะคือ ิ/ี · ุ/ู · ่/้ และคนพิมพ์ที่อยู่/ชื่อร้านเว้นวรรคไม่เหมือนกัน)
//
// จึงถอดสระบน-ล่าง วรรณยุกต์ และเครื่องหมายวรรคตอนออกให้หมด แล้วค่อยเทียบ
// ใช้เป็น "ตาข่ายชั้นสอง" เท่านั้น — เทียบแบบตรงตัวก่อนเสมอ ผลที่เคยเจอจึงไม่เปลี่ยน
// มีแต่เพิ่มรายการที่เคยหลุด (ค้นหาไม่ใช่การตัดสินใจ คนยังเห็นชื่อแล้วเลือกเองอยู่ดี)
const THAI_MARKS = /[ัิ-ฺ็-๎]/g;
export const looseKey = (s) =>
  norm(s).replace(THAI_MARKS, "").replace(/[\s.,\-_()]/g, "");

export const matchTokens = (query, ...fields) => {
  const toks = tokens(query);
  if (toks.length === 0) return true;
  const hay = fields.map(norm).join(" ");
  if (toks.every((t) => hay.includes(t))) return true;
  // ⚠️ คำสั้นห้ามใช้ตาข่ายชั้นสอง — "สุ" ถอดสระแล้วเหลือ "ส" ตัวเดียว
  //    ซึ่งไปโผล่ในชื่อเกือบทุกราย (ทดสอบแล้วได้ 146 จาก 248 ราย = ใช้งานไม่ได้)
  //    แต่ห้ามให้คำสั้นทำให้ทั้งชุดตกด้วย — พิมพ์ "ช. รุ่งเรือง" คำว่า "ช." เหลือตัวเดียว
  //    ถ้านับว่าไม่ผ่าน ทั้งประโยคก็หาไม่เจอทั้งที่อีกคำตรง → คำสั้นให้ถอยไปเทียบแบบตรงตัว
  const loose = looseKey(fields.join(" "));
  return toks.every((t) => {
    const lt = looseKey(t);
    return lt.length >= 2 ? loose.includes(lt) : hay.includes(t);
  });
};
