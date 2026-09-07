// 📦 ขยับสต็อกเสื้อผ้าแบบไม่ทับงานคนอื่น
//
// ปัญหาที่แก้: สต็อกเก็บเป็น colors[] ทั้งก้อนในเอกสารเดียว (รุ่นหนึ่งมี 10 สี × 13 ไซส์)
// ของเดิมอ่านทั้งก้อนมาไว้ในหน้าจอ แก้ในหน่วยความจำ แล้วเขียนกลับทั้งก้อน
//
//   พนักงาน A เปิดหน้าต่าง "รับ" ค้างไว้ 30 วินาที
//   ระหว่างนั้นรอบแพ็คตัดสต็อกสีเขียวไป 200 ตัว
//   A กดยืนยัน → เขียนทั้งก้อนจากภาพที่ค้างอยู่ในจอ → สีเขียวเด้งกลับมา 200 ตัว
//
// ของหายไปเงียบ ๆ ไม่มีอะไรฟ้อง และยิ่งคนทำพร้อมกันเยอะยิ่งเจอบ่อย
// (ทางที่รอบแพ็คใช้คือ FieldPath + increment แต่ใช้กับ colors[] ไม่ได้
//  เพราะ Firestore ชี้เข้าไปใน "สมาชิกของอาเรย์" ด้วย field path ไม่ได้)
//
// จึงใช้ transaction: อ่านของจริง ณ วินาทีที่เขียน แล้วบวก/ลบจากตัวนั้น
// ไม่ใช่จากภาพที่ค้างอยู่ในจอ — ของคนอื่นที่แก้ไประหว่างนั้นจะไม่ถูกทับ

import { doc, runTransaction } from "firebase/firestore";

/**
 * ขยับสต็อกหลายช่องพร้อมกันในรุ่นเดียว
 *
 * deltas = [{ colorIdx, size, delta }]  (delta บวก = รับเข้า, ลบ = จ่ายออก)
 *
 * ของไม่พอ → โยน error พร้อมรายการที่ขาด ไม่ตัดให้เหลือ 0 เงียบ ๆ
 * เพราะการตัดเงียบทำให้สต็อกกับสมุดรับ-จ่ายไม่ตรงกันถาวร แล้วไม่มีใครรู้ว่าเริ่มเพี้ยนตอนไหน
 *
 * คืนค่า { before, after } ของแต่ละช่อง เอาไว้บันทึกลงสมุดว่าจริง ๆ ขยับจากเท่าไหร่เป็นเท่าไหร่
 */
// ส่วนคิดเลขล้วน ๆ แยกออกมาให้เอาไปรันทดสอบนอกเบราว์เซอร์ได้
// เป็นตัวที่ตัดสินว่าสต็อกจะเหลือเท่าไหร่ ต้องพิสูจน์ได้ ไม่ใช่เชื่อว่าถูก
export function computeStockAfter(colorsIn = [], deltas = []) {
  const colors = colorsIn.map(c => ({ ...c, stock: { ...(c.stock || {}) } }));
  const short = [], moves = [];
  deltas.forEach(({ colorIdx, size, delta }) => {
    const c = colors[colorIdx];
    if (!c) { short.push({ colorName: "(ไม่พบสี)", size, have: 0, want: -delta }); return; }
    const before = Number(c.stock[size]) || 0;
    const after = before + Number(delta || 0);
    if (after < 0) { short.push({ colorName: c.colorName, size, have: before, want: -delta }); return; }
    c.stock[size] = after;
    moves.push({ colorIdx, colorName: c.colorName, size, delta, before, after });
  });
  return { colors, moves, short };
}

export async function applyStockDeltas(db, clothingId, deltas = []) {
  if (!clothingId || deltas.length === 0) return { moves: [] };

  return runTransaction(db, async (tx) => {
    const ref = doc(db, "clothing", clothingId);
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("ไม่พบรุ่นนี้ในคลัง — อาจถูกลบไปแล้ว");

    const { colors, moves, short } = computeStockAfter(snap.data().colors || [], deltas);
    if (short.length) {
      const err = new Error("ของในคลังไม่พอ");
      err.code = "SHORT_STOCK";
      err.short = short;
      throw err;
    }

    tx.update(ref, { colors });
    return { moves };
  });
}

// ข้อความบอกว่าขาดอะไรบ้าง — ใช้ตอนโชว์ให้พนักงานอ่านหน้างาน
export const shortStockText = (short = []) =>
  short.map(s => `• ${s.colorName || "(ไม่ทราบสี)"} ${s.size}: มีอยู่ ${s.have} แต่จะจ่าย ${s.want}`).join(String.fromCharCode(10));
