// 📥 ดึงบิลเฉพาะที่ต้องใช้ ตอนที่ต้องใช้
//
// ต่างจากการ subscribe ค้างไว้ใน useFirestore: อันนี้อ่านครั้งเดียวแล้วจบ ไม่ค้างในหน่วยความจำ
// ใช้กับงานที่ต้องการข้อมูลกว้างแต่นาน ๆ ใช้ที (ออกใบวางบิล / รายงาน / ประวัติลูกค้า)
// จะได้ไม่ต้องแบกบิลทั้งเดือนไว้ตลอดเวลาแค่เพราะเดือนละครั้งมีคนต้องใช้

import { collection, query, where, orderBy, limit, getDocs, Timestamp } from "firebase/firestore";
import { db } from "../firebase";

// ⚠️ กับดักที่ต้องรู้ก่อนแก้ตรงนี้: บิลมีวันที่ 2 ชุดที่ไม่ตรงกัน
//
//    date      = วันที่บนหน้าบิล (ที่ลูกค้าเห็น) — ย้อนหลังได้ เก็บเป็นข้อความ "DD/MM/YYYY"
//    createdAt = วันที่กดบันทึกจริง — เป็นอันเดียวที่ Firestore ใช้ค้นเป็นช่วงได้
//
//    ใบวางบิลคิดยอดจาก `date` เสมอ (ดู filterInvoicesForStatement)
//    ถ้าดึงด้วย createdAt ตรงขอบงวดเป๊ะ ๆ บิลที่ลงวันที่ย้อนหลังจะหลุด
//    → ลูกค้าได้ใบวางบิลยอดขาด โดยไม่มีอะไรฟ้อง
//
//    ในข้อมูลจริง (ส.ค. 2569) มีบิลลงวันที่ย้อนหลัง 13 ใบ ย้อนมากสุด 6 วัน
//    เช่น INV6908-0040 ลงวันที่ 01/08 แต่บันทึกจริง 07/08
//
//    จึงดึงเผื่อหัวท้ายกว้าง ๆ แล้วให้ตัวกรองเดิมตัดด้วย `date` อีกชั้น
//    Firestore ทำหน้าที่แค่ตัดของที่ไกลเกินออก ความแม่นยำยังเป็นของตัวกรองเดิม
export const DATE_SLACK_DAYS = 30;

const shift = (d, days) => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + days);
  return x;
};

// เพดานกันเผลอเลือกช่วงกว้างเกิน — อ่านครั้งเดียวจึงตั้งสูงได้
// (2,500 ใบ/เดือน + เผื่อหัวท้าย 2 เดือน ≈ 7,500 ใบ)
export const FETCH_CAP = 20000;

/**
 * ดึงบิลที่อาจอยู่ในงวด startDate–endDate
 * คืนมาแบบ "กว้างกว่างวดจริง" — ผู้เรียกต้องกรองด้วย inv.date อีกชั้นเสมอ
 */
export async function fetchInvoicesForPeriod(startDate, endDate) {
  if (!(startDate instanceof Date) || isNaN(startDate)) throw new Error("ช่วงวันที่ไม่ถูกต้อง");
  const from = shift(startDate, -DATE_SLACK_DAYS);
  const to = endDate instanceof Date && !isNaN(endDate) ? shift(endDate, DATE_SLACK_DAYS) : null;
  const clauses = [where("createdAt", ">=", Timestamp.fromDate(from))];
  if (to) clauses.push(where("createdAt", "<=", Timestamp.fromDate(new Date(to.getFullYear(), to.getMonth(), to.getDate(), 23, 59, 59))));
  const snap = await getDocs(query(collection(db, "invoices"), ...clauses, orderBy("createdAt", "desc"), limit(FETCH_CAP)));
  return {
    invoices: snap.docs.map(d => ({ ...d.data(), id: d.id })),
    at: new Date(),
    capped: snap.size >= FETCH_CAP,
    from, to,
  };
}

/**
 * ดึงบิลของลูกค้ารายเดียว — ย้อนได้ไม่จำกัด ไม่ขึ้นกับช่วงที่โหลดค้างไว้
 *
 * ตั้งใจไม่ใส่ orderBy เพื่อไม่ต้องไปสร้าง composite index ใน Firebase Console
 * (index ไม่ deploy อัตโนมัติ ต้องกดเองทั้ง 2 โปรเจกต์ ลืมเมื่อไรหน้านั้นพังทันที)
 * ลูกค้ารายเดียวมีบิลไม่กี่สิบใบ เรียงในเครื่องเองถูกกว่าและไม่มีอะไรให้ลืม
 */
export async function fetchInvoicesOfCustomer(customerId, cap = 500) {
  if (!customerId) return [];
  const snap = await getDocs(query(collection(db, "invoices"), where("customerId", "==", customerId), limit(cap)));
  return snap.docs
    .map(d => ({ ...d.data(), id: d.id }))
    .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
}
