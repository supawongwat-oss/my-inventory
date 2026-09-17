// 📏 หาตัวคูณขนาดตัวหนังสือ (--s) ที่ใหญ่ที่สุดที่ยังไม่ล้นดวง — ด้วยการแบ่งครึ่ง
//
// ⚠️ เดิมไล่ลดทีละ 0.04 จาก 1.5/1.8 ลงมา = ลองได้ถึง 35 ครั้งต่อดวง
//    ทุกครั้งที่ลองต้องให้เบราว์เซอร์คำนวณ layout ใหม่ (อ่าน scrollHeight / getBoundingClientRect)
//    เลือกลูกค้าทั้งหมด 261 ราย = หลายพันครั้งรวดเดียว → หน้าค้าง
//    (17/09/2569 16:20 บันทึก "หน้าค้าง 17 วินาที" หลังเปิดตัวขยายตัวหนังสือ — สงสัยว่ามาจากตรงนี้ ยังไม่ยืนยัน
//     วัดซ้ำ 261 ดวงบนหน้าเปล่า: ไล่ทีละขั้น 1.5 วิ · แบบเดิมก่อนขยาย 0.1 วิ)
//
//    แบ่งครึ่ง 6 รอบ = ลองไม่เกิน 7 ครั้งต่อดวง ละเอียด ~0.02 (ละเอียดกว่าขั้น 0.04 เดิม)
//
// tooBig(s) ต้อง "ยิ่ง s ใหญ่ยิ่งล้น" (ทางเดียว) — ตัวหนังสือโตขึ้นไม่มีทางทำให้พอดีขึ้น จึงใช้ได้
export function fitScale(el, tooBig, { max = 1, min = 0.35, rounds = 6 } = {}) {
  const set = (s) => el.style.setProperty("--s", s.toFixed(3));
  set(max);
  if (!tooBig(max)) return max;
  let lo = min, hi = max;
  for (let i = 0; i < rounds; i++) {
    const mid = (lo + hi) / 2;
    set(mid);
    if (tooBig(mid)) hi = mid; else lo = mid;
  }
  set(lo);
  return lo;
}

// ฟอนต์ Sarabun โหลดเสร็จทีหลังได้ — วัดตอนยังเป็นฟอนต์สำรองแล้วไม่วัดซ้ำ ขนาดจะผิด
// (เดิมบังเอิญถูกเพราะวัดใหม่ทุกครั้งที่หน้าต่าง render ตอนนี้วัดเฉพาะตอนข้อมูลเปลี่ยน)
export function whenFontsReady(fn) {
  const fonts = typeof document !== "undefined" ? document.fonts : null;
  if (!fonts || fonts.status === "loaded") return () => {};
  let alive = true;
  fonts.ready.then(() => { if (alive) fn(); });
  return () => { alive = false; };
}
