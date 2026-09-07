// 📦 ตามหาว่าพัสดุกล่องนี้มาจากรอบไหน บิลไหน
//
// ปัญหาที่แก้: ลูกค้าขายออนไลน์ ลูกค้าปลายทางตีของกลับมาที่โรงงาน
// ของกล่องนั้นไม่มีอะไรบอกเลยว่ามาจากบิลไหน เพราะ:
//   · รอบแพ็คเก็บเป็นตัวนับ (K-12 ดำ M ออกไป 47 ตัว) ไม่ได้เก็บว่าไปหาใครบ้าง
//   · ปิดรอบแล้วออกบิลใบเดียวทั้งรอบ
//   · รุ่นเดียวกันออกทุกรอบ ทุกวัน — ดูจากตัวสินค้าจึงแยกไม่ออกเลย
// เหลือทางเดียวคือเลขพัสดุที่ติดอยู่บนกล่อง ซึ่งเก็บไว้ตอนนำเข้าใบปะหน้าแล้ว
//
// ตั้งใจใช้เลขพัสดุเป็นชื่อเอกสาร → เปิดตรง ๆ ทีเดียวจบ ไม่ต้อง query ไม่ต้องมี index

import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase";

// ผู้ใช้พิมพ์มาได้หลายแบบ — มีช่องว่าง ขีด ตัวพิมพ์เล็ก หรือก๊อปมาทั้งบรรทัด
// ตัวเลขพัสดุจริงมีแต่ตัวอักษรกับตัวเลข จึงถอดที่เหลือออกให้หมดก่อนเทียบ
export const normTrack = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

// ดึงเลขพัสดุออกจากข้อความยาว ๆ (เช่นก๊อปมาจากแชตลูกค้า หรือสแกนบาร์โค้ดได้ทั้งบรรทัด)
export const pickTrack = (s) => {
  const t = String(s || "").toUpperCase();
  const m = t.match(/\bJTTH\d{10,14}\b/) || t.match(/\bTH\d{12,13}[A-Z]?\b/);
  return m ? m[0] : normTrack(s);
};

/**
 * หาพัสดุจากเลขที่พิมพ์/สแกนมา
 * คืน null ถ้าไม่เจอ — ผู้เรียกต้องบอกผู้ใช้ว่าไม่เจอ ห้ามเงียบ
 */
export async function findParcel(input) {
  const track = pickTrack(input);
  if (!track || track.length < 8) return null;
  try {
    const snap = await getDoc(doc(db, "packParcels", track));
    return snap.exists() ? { ...snap.data(), id: snap.id } : null;
  } catch (e) {
    console.warn("[parcel] ค้นเลขพัสดุไม่สำเร็จ:", e);
    throw e;
  }
}

/**
 * ตามให้สุดสาย: เลขพัสดุ → รอบแพ็ค → บิล
 *
 * ทำไมต้องเปิดรอบตรงจาก id แทนที่จะหาในกองที่แอปโหลดไว้:
 * กองรอบมีแค่ 200 รอบล่าสุด แต่ของคืนมาช้ากว่าวันแพ็คเสมอ (บางทีเป็นเดือน)
 * พอเลย 200 รอบก็หาไม่เจอทั้งที่รอบยังอยู่ในระบบ — เปิดตรงไม่มีเพดานนี้
 *
 * เปิดตรงด้วย id ทั้งสองต่อ = ไม่ต้อง query ไม่ต้องสร้าง index
 * รอบ/บิลหายไปไม่ throw — ยังต้องบอกให้ได้ว่าเจอกล่องนี้แล้วมาจากไหน
 */
export async function findParcelSource(input) {
  const parcel = await findParcel(input);
  if (!parcel) return null;

  let run = null, invoice = null;
  if (parcel.runId) {
    try {
      const s = await getDoc(doc(db, "packRuns", parcel.runId));
      if (s.exists()) run = { ...s.data(), id: s.id };
    } catch (e) { console.warn("[parcel] เปิดรอบแพ็คไม่สำเร็จ:", e); }
  }
  if (run && run.invoiceId) {
    try {
      const s = await getDoc(doc(db, "invoices", run.invoiceId));
      if (s.exists()) invoice = { ...s.data(), id: s.id };
    } catch (e) { console.warn("[parcel] เปิดบิลไม่สำเร็จ:", e); }
  }
  return { parcel, run, invoice };
}
