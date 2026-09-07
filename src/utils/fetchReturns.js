// 📥 ดึงใบรับคืนตอนจะออกใบวางบิล — ไม่พึ่งกองที่โหลดค้างไว้
//
// ปัญหาที่แก้: useFirestore โหลดใบรับคืนด้วย "เพดานจำนวน 500 ใบล้วน" ไม่มีช่วงวันที่
// พอของคืนเยอะขึ้นจนเกิน 500 ใบเก่าจะหลุดออกจากกองเงียบ ๆ
// แล้วใบที่ยังไม่เคยถูกหักก็ไม่ถูกนำมาหักในใบวางบิล = เก็บเงินลูกค้าเกินจากของที่คืนไปแล้ว
//
// ผิดคนละทิศกับบิลชนเพดาน (บิลหาย = เก็บขาด) และแย่กว่าเพราะลูกค้าเป็นฝ่ายเสียหาย
//
// ⚠️ ตั้งใจ "ไม่" กรองด้วยช่วงวันที่ ต่างจาก fetchInvoicesForPeriod
//
//    creditsForStatement ไม่มีขอบล่างของช่วงโดยตั้งใจ — ของที่คืนหลังตัดยอดเดือนก่อนไปแล้ว
//    ต้องยกมาหักในงวดถัดไป และใบที่เพิ่งมาจับคู่บิลทีหลังก็อาจเป็นของเก่าหลายเดือน
//    ถ้ากรองด้วยวันที่จะกลับไปสร้างปัญหาเดิมในรูปแบบใหม่
//
//    ใบรับคืนมีจำนวนน้อยกว่าบิลมาก (บิล 2,500 ใบ/เดือน เทียบกับของคืนหลักสิบ)
//    ดึงทั้งกองตอนกดออกใบวางบิลเดือนละครั้งจึงรับได้ ไม่ต้องแบกไว้ตลอดเวลา
//
// ⚠️ ใบที่ไม่มี createdAt จะไม่ติดมาด้วย (orderBy ตัดเอกสารที่ไม่มีฟิลด์นั้นทิ้ง)
//    ตรวจข้อมูลจริงแล้วไม่มีใบแบบนั้น และกองเดิมใน useFirestore ก็ใช้ orderBy ตัวเดียวกัน
//    ถ้าวันหนึ่งมีใบที่เขียนโดยไม่ผ่านฟอร์ม ต้องเติม createdAt ให้ด้วย

import { collection, query, orderBy, limit, startAfter, getDocs } from "firebase/firestore";
import { db } from "../firebase";

const PAGE = 5000;              // Firestore ไม่รับ limit() เกิน 10,000
export const RETURNS_FETCH_CAP = 30000;

/**
 * ดึงใบรับคืนทั้งหมด (ใหม่ก่อน) แบบแบ่งหน้า
 * คืน { returns, at, capped } — capped = ชนเพดาน ยังมีของเก่ากว่านี้อีก ต้องเตือนผู้ใช้ ห้ามเงียบ
 */
export async function fetchReturnsForCredit(cap = RETURNS_FETCH_CAP) {
  const base = [collection(db, "returns"), orderBy("createdAt", "desc")];
  const out = [];
  let cursor = null;
  for (;;) {
    const q = cursor
      ? query(...base, startAfter(cursor), limit(PAGE))
      : query(...base, limit(PAGE));
    const snap = await getDocs(q);
    snap.docs.forEach(d => out.push({ ...d.data(), id: d.id }));
    if (snap.size < PAGE) break;
    if (out.length >= cap) break;
    cursor = snap.docs[snap.docs.length - 1];
  }
  return { returns: out, at: new Date(), capped: out.length >= cap };
}
