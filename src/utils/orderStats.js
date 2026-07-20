// 📊 สถิติที่คำนวณ "ฝั่งเซิร์ฟเวอร์" — ไม่ต้องโหลดเอกสารทั้งหมดมานับเอง
//
// 🔑 ทำไมต้องมีไฟล์นี้:
// ที่ 200-300 ใบ/วัน แอปโหลดใบสั่งของมาแค่ช่วงเวลาหนึ่ง (ดู useFirestore)
// ถ้ารายงานไปนับจาก array ที่โหลดมา → ตัวเลขจะผิดโดยไม่มีใครรู้
// (เช่น ลูกค้าสั่ง 200 ครั้ง แต่ขึ้น 3 ครั้ง เพราะโหลดมาแค่ 7 วัน)
// → ใช้ aggregate query ของ Firestore นับที่เซิร์ฟเวอร์แทน ได้เลขจริงเสมอ
//    และถูกกว่าโหลดเอกสารมาก (คิดค่าอ่านตามจำนวน index ที่สแกน ไม่ใช่จำนวน doc)
//
// ⚠️ ใช้ createdAt (timestamp) เป็นตัวอ้างอิงช่วงเวลา ไม่ใช่ field `date` (ข้อความไทย)
//    เพราะ query ช่วงเวลาต้องใช้ field ที่เรียงลำดับได้จริง
import { collection, query, where, Timestamp, count, sum, getCountFromServer, getAggregateFromServer } from "firebase/firestore";
import { db } from "../firebase";

// ขอบเขตเดือน: [1 ค่ำเดือนนั้น 00:00, 1 ค่ำเดือนถัดไป 00:00)
export function monthBounds(year, month /* 1-12 */) {
  return {
    from: new Date(year, month - 1, 1, 0, 0, 0, 0),
    to: new Date(year, month, 1, 0, 0, 0, 0),
  };
}

function rangeClauses(from, to) {
  return [
    where("createdAt", ">=", Timestamp.fromDate(from)),
    where("createdAt", "<", Timestamp.fromDate(to)),
  ];
}

// นับใบสั่งของในช่วงเวลา
export async function countOrdersInRange(from, to) {
  const q = query(collection(db, "orders"), ...rangeClauses(from, to));
  const snap = await getCountFromServer(q);
  return snap.data().count || 0;
}

// สรุปบิลในช่วงเวลา — จำนวน + ยอดรวม + VAT (ตัดบิลที่ยกเลิกออก)
//
// ⚠️ 2 เรื่องที่ต้องระวัง จึงเขียนแบบนี้:
// 1) ไม่ใช้ where("status","!=","ยกเลิก") เพราะ Firestore จะ "ตัดเอกสารที่ไม่มีฟิลด์ status ทิ้ง"
//    → บิลเก่าที่ยังไม่มีฟิลด์นี้จะหายจากยอดรวม → ใช้วิธีเอายอดทั้งหมด "ลบ" ยอดที่ยกเลิกแทน
// 2) query ที่มี equality (status) + range (createdAt) ต้องมี composite index
//    → ถ้ายังไม่ได้สร้าง ให้ยอมได้ยอดรวมแบบยังไม่หักยกเลิก ดีกว่าพังทั้งหน้า (ดู needsIndex)
export async function summarizeInvoicesInRange(from, to) {
  const base = collection(db, "invoices");
  const allSnap = await getAggregateFromServer(
    query(base, ...rangeClauses(from, to)),
    { count: count(), revenue: sum("total"), vat: sum("vat") }
  );
  const a = allSnap.data();
  const result = {
    invoiceCount: a.count || 0,
    revenue: a.revenue || 0,
    vat: a.vat || 0,
    paidRevenue: 0,
    needsIndex: false,
  };

  try {
    const [cancelled, paid] = await Promise.all([
      getAggregateFromServer(
        query(base, ...rangeClauses(from, to), where("status", "==", "ยกเลิก")),
        { count: count(), revenue: sum("total"), vat: sum("vat") }
      ),
      getAggregateFromServer(
        query(base, ...rangeClauses(from, to), where("status", "==", "ชำระแล้ว")),
        { revenue: sum("total") }
      ),
    ]);
    const c = cancelled.data();
    result.invoiceCount -= c.count || 0;
    result.revenue     -= c.revenue || 0;
    result.vat         -= c.vat || 0;
    result.paidRevenue  = paid.data().revenue || 0;
  } catch (e) {
    // index ยังไม่พร้อม → คืนยอดรวม (ยังไม่หักบิลยกเลิก) + ธงบอกให้ UI เตือน
    // log ไว้ด้วย เพราะ Firestore ใส่ "ลิงก์สร้าง index" มากับ error — กดลิงก์ครั้งเดียวจบ
    console.warn("[orderStats] ต้องสร้าง Firestore index (invoices: status + createdAt) — กดลิงก์ใน error ข้างล่างนี้:", e);
    result.needsIndex = true;
  }
  return result;
}

// สถิติรายเดือนย้อนหลัง N เดือน (รวมเดือนปัจจุบัน)
// คืน [{ key:"2026-07", year, month, invoiceCount, revenue, vat, paidRevenue, orderCount }]
export async function monthlyStats(monthsBack = 12) {
  const today = new Date();
  const targets = [];
  for (let i = monthsBack - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    targets.push({ year: d.getFullYear(), month: d.getMonth() + 1 });
  }
  return Promise.all(targets.map(async ({ year, month }) => {
    const { from, to } = monthBounds(year, month);
    const [inv, orderCount] = await Promise.all([
      summarizeInvoicesInRange(from, to),
      countOrdersInRange(from, to),
    ]);
    return { key: `${year}-${String(month).padStart(2, "0")}`, year, month, ...inv, orderCount };
  }));
}

// นับจำนวนครั้งที่ลูกค้ารายนี้สั่ง (ทั้งหมด ไม่จำกัดช่วงเวลา)
export async function countOrdersByCustomer(customerId) {
  if (!customerId) return 0;
  const q = query(collection(db, "orders"), where("customerId", "==", customerId));
  const snap = await getCountFromServer(q);
  return snap.data().count || 0;
}

// นับหลายลูกค้าพร้อมกัน — จำกัดการยิงพร้อมกันไม่ให้ถล่มเครือข่าย
export async function countOrdersByCustomers(customerIds = [], concurrency = 8) {
  const out = {};
  const queue = [...customerIds];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length > 0) {
      const id = queue.shift();
      try { out[id] = await countOrdersByCustomer(id); }
      catch { out[id] = null; } // นับไม่ได้ → null (แสดงเป็น "—" ดีกว่าโชว์เลขผิด)
    }
  });
  await Promise.all(workers);
  return out;
}
