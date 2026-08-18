// 💾 ร่างอัตโนมัติ — กันของที่กรอกค้างหายตอนสลับแอป
//
// อาการ: กรอกใบสั่งของ/บิลค้างไว้ แล้วสลับไป LINE สักพัก พอกลับมาแอปเริ่มใหม่หมด
// สาเหตุ: มือถือ/แท็บเล็ตเคลียร์หน่วยความจำของแท็บที่ไม่ได้ใช้ → เบราว์เซอร์โหลดหน้าใหม่
//         ข้อมูลในฟอร์มอยู่ในหน่วยความจำล้วน ๆ จึงหายไปพร้อมกัน
// วิธีแก้: เขียนสิ่งที่กรอกลงเครื่อง (localStorage) เป็นระยะ พอกลับเข้ามาก็หยิบกลับมาได้
//
// ทิ้งร่างเมื่อไหร่:
//   · บันทึกสำเร็จ  → เรียก clear()
//   · ปิดหน้าต่างเอง → เรียก clear()  (ปิดเอง = ตั้งใจเลิก)
//   · เกิน 1 วัน     → หมดอายุเอง
// การโหลดหน้าใหม่ไม่ผ่านทั้ง 2 ทางแรก ร่างจึงอยู่รอด — ตรงกับเคสที่ต้องการกู้พอดี
import { useEffect, useRef, useState } from "react";

const PREFIX = "cpuerp.draft.";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const DEBOUNCE_MS = 600;

function readDraft(key) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (!d || typeof d !== "object" || !d.value) return null;
    if (Date.now() - (Number(d.savedAt) || 0) > MAX_AGE_MS) {
      localStorage.removeItem(PREFIX + key);
      return null;
    }
    return d; // { savedAt, value }
  } catch {
    return null;
  }
}

/**
 * @param key    ชื่อร่าง (ต่อท้าย cpuerp.draft.)
 * @param value  ข้อมูลที่จะเก็บ (ต้อง JSON ได้)
 * @param active กำลังกรอกอยู่หรือไม่ — false = ไม่ต้องเก็บ
 * @param empty  ฟอร์มยังว่างอยู่หรือไม่ — true = ไม่ต้องเก็บ (กันร่างเปล่าไปทับของจริง)
 * @returns { saved, clear } — saved คือร่างที่เจอตอนเปิดแอป (อ่านครั้งเดียว ไม่ขยับตามที่พิมพ์)
 */
export function useFormDraft(key, value, { active = false, empty = true } = {}) {
  const [saved, setSaved] = useState(() => readDraft(key));
  const timer = useRef(null);

  useEffect(() => {
    if (!active || empty) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      try {
        localStorage.setItem(PREFIX + key, JSON.stringify({ savedAt: Date.now(), value }));
      } catch (e) {
        // เต็ม/โหมดส่วนตัว → ข้ามไป ไม่ให้ล้มทั้งหน้า
        console.warn("[draft] เก็บร่างไม่สำเร็จ:", e?.message || e);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer.current);
  }, [key, value, active, empty]);

  const clear = () => {
    clearTimeout(timer.current);
    try { localStorage.removeItem(PREFIX + key); } catch {}
    setSaved(null);
  };

  return { saved, clear };
}

// "3 นาทีที่แล้ว" — ใช้บอกว่าร่างเก่าแค่ไหน จะได้ตัดสินใจได้ว่าจะกู้ไหม
export function timeAgoTH(ts) {
  const sec = Math.max(0, Math.floor((Date.now() - (Number(ts) || 0)) / 1000));
  if (sec < 60) return "เมื่อสักครู่";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} นาทีที่แล้ว`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} ชั่วโมงที่แล้ว`;
  return `${Math.floor(hr / 24)} วันที่แล้ว`;
}
