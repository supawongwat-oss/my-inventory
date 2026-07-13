// สร้างเลขเอกสารแบบทางการ: PREFIX{ปีพ.ศ.2หลัก}{เดือน2หลัก}-{เลขรัน4หลัก}
// ตัวอย่าง: INV6906-0001 = ใบเสร็จที่ 1 ของเดือน มิ.ย. พ.ศ. 2569
// เลขรัน reset ทุกเดือน

import { doc, runTransaction, serverTimestamp } from "firebase/firestore";

// เลข monthCode ของ "ตอนนี้" (พ.ศ. 2 หลัก + เดือน 2 หลัก)
function monthCodeNow() {
  const now = new Date();
  const yy = String(now.getFullYear() + 543).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  return `${yy}${mm}`;
}

// หาเลขรันสูงสุดของเดือนปัจจุบันจาก docs ที่โหลดมา (ใช้เป็น seed ครั้งแรก / fallback)
function maxRunInMonth(pattern, existingDocs, field) {
  let maxRun = 0;
  existingDocs.forEach((d) => {
    const no = d?.[field] || "";
    if (typeof no === "string" && no.startsWith(pattern)) {
      const run = parseInt(no.slice(pattern.length), 10);
      if (!isNaN(run) && run > maxRun) maxRun = run;
    }
  });
  return maxRun;
}

// [เดิม] คำนวณเลขถัดไปจาก array ที่โหลดมา (max+1) — ไม่ atomic, เสี่ยงซ้ำถ้ากดพร้อมกัน
// ยังใช้เป็น fallback ตอน counter เขียนไม่ได้ (เช่น rules ยังไม่อัปเดต)
export function generateDocNo(prefix, existingDocs = [], field = "invoiceNo") {
  const monthCode = monthCodeNow();
  const pattern = `${prefix}${monthCode}-`;
  const nextRun = String(maxRunInMonth(pattern, existingDocs, field) + 1).padStart(4, "0");
  return `${pattern}${nextRun}`;
}

// [ใหม่] จองเลขเอกสารแบบ atomic ด้วย Firestore counter (กันเลขซ้ำเมื่อออกใบพร้อมกัน)
// - counters/{PREFIX+monthCode}.seq ถูก increment ใน transaction เดียว → ไม่มีทางได้เลขซ้ำ
// - ครั้งแรกของเดือน (counter ยังไม่มี) จะ seed จากเลขสูงสุดใน docs ที่โหลดมา
// - ถ้า transaction ล้มเหลว (เช่น rules ยังไม่อนุญาต counters) → fallback เป็น max+1 แบบเดิม (ไม่แย่กว่าเดิม)
export async function reserveDocNo(db, prefix, existingDocs = [], field = "invoiceNo") {
  const monthCode = monthCodeNow();
  const pattern = `${prefix}${monthCode}-`;
  const seedMax = maxRunInMonth(pattern, existingDocs, field);
  const ref = doc(db, "counters", `${prefix}${monthCode}`);
  try {
    const next = await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      const existingSeq = snap.exists() ? (Number(snap.data().seq) || 0) : 0;
      // ป้องกันเลขต่ำกว่า docs จริง (เช่น counter ยังตามหลังช่วงเปลี่ยนผ่าน) → เอา max
      const base = Math.max(existingSeq, seedMax);
      const n = base + 1;
      tx.set(ref, { seq: n, prefix, monthCode, updatedAt: serverTimestamp() }, { merge: true });
      return n;
    });
    return `${pattern}${String(next).padStart(4, "0")}`;
  } catch (e) {
    console.warn(`[reserveDocNo] counter failed for ${prefix}${monthCode} — fallback to local max+1:`, e);
    return `${pattern}${String(seedMax + 1).padStart(4, "0")}`;
  }
}
