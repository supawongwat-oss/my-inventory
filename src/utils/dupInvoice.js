// 🔁 หาบิลที่น่าจะซ้ำกัน
//
// เคสจริง: พนักงานออกบิลให้ลูกค้าเดิม ยอดเดิม ซ้ำอีกใบ (INV6908-0108 กับ 0115)
// ตอนนี้ระบบกันบิลซ้ำเฉพาะที่ออก "จากใบสั่งของ" เท่านั้น — ออกมือเปล่าไม่มีอะไรกัน
// ยิ่งตอนนี้หลายคนช่วยกันทำงานบัญชี โอกาสที่สองคนออกใบเดียวกันยิ่งสูง
//
// เกณฑ์: ลูกค้าเดียวกัน + ยอดเท่ากัน + รายการสินค้าเหมือนกัน + ออกห่างกันไม่เกิน N วัน
//
// เดิมไม่ดูรายการสินค้า เพราะบิลซ้ำมักถูกพิมพ์ใหม่ทั้งใบ บรรทัดอาจเรียงไม่เหมือนกัน
// และเชื่อว่า "ลูกค้าเดิม + ยอดตรงกันเป๊ะ" แทบไม่มีทางบังเอิญ — ข้อนี้ผิดกับข้อมูลจริง:
//   ดาวกีฬาซื้อรองเท้าราคาเดียว ฿395 ทุกคู่ สั่ง 8 คู่คนละสี/ไซส์ ยอดก็ ฿3,160 ทุกครั้ง
//   INV6909-0069 (12/09) กับ 0071 (14/09) ขึ้นป้ายซ้ำทั้งที่ของข้างในคนละชุด
// ป้ายเตือนผิดบ่อย ๆ คนจะเลิกอ่าน แล้ววันที่ซ้ำจริงก็หลุด
//
// ปัญหาเรื่องลำดับบรรทัดแก้ได้ ไม่ต้องทิ้งการเทียบรายการ: ยุบบรรทัดเป็น
// (ชื่อรุ่น · สี · ไซส์ · ราคาต่อหน่วย) รวมจำนวน แล้วเรียงก่อนเทียบ — เรียงบรรทัดยังไงก็ได้ผลเดียวกัน
// (ตรวจกับข้อมูลจริง: คู่ที่รายการเหมือนกันทุกบรรทัด INV6908-0030 กับ 0167 ยังจับได้)

import { canonSize } from "../theme";

const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");

// 🧾 ลายนิ้วมือของรายการในบิล — ไม่ขึ้นกับลำดับบรรทัด
//   · ชื่อจาก snapshot ในบิล (clothingName/description) ไม่ใช่ id — พิมพ์ใหม่ทั้งใบบางบรรทัดไม่มี id
//   · ไซส์ผ่าน canonSize — "XS" กับ "12" คือไซส์เดียวกัน
//   · บรรทัดซ้ำรุ่น/สี/ไซส์/ราคาเดียวกันรวมจำนวน — แยกกรอก 2 บรรทัดหรือบรรทัดเดียวต้องได้ค่าเท่ากัน
export function itemsSignature(inv) {
  const m = new Map();
  (inv?.items || []).forEach(it => {
    const qty = Number(it?.qty) || 0;
    if (qty === 0) return;
    const k = [
      norm(it?.clothingName || it?.description) || String(it?.clothingId || ""),
      norm(it?.colorName),
      norm(canonSize(it?.size)),
      (Number(it?.unitPrice) || 0).toFixed(2),
    ].join("|");
    m.set(k, (m.get(k) || 0) + qty);
  });
  return [...m.entries()].map(([k, q]) => `${k}#${q}`).sort().join(";");
}

// "DD/MM/YYYY HH:mm" → Date (รองรับ พ.ศ.)
function parseDocDate(s) {
  if (!s) return null;
  const [d, m, y] = String(s).split(" ")[0].split("/").map(Number);
  if (!d || !m || !y) return null;
  return new Date(y > 2500 ? y - 543 : y, m - 1, d);
}

export const sameCustomer = (a, b) => {
  if (a?.customerId && b?.customerId) return a.customerId === b.customerId;
  return !!norm(a?.customerName) && norm(a?.customerName) === norm(b?.customerName);
};

/**
 * บิลที่น่าจะซ้ำกับใบที่กำลังจะออก
 * @param invoices  บิลทั้งหมดที่โหลดมา
 * @param candidate { customerId, customerName, total, date, items }
 *                  ส่ง items มาด้วยเสมอ — ไม่ส่งจะถอยไปเทียบแค่ลูกค้า+ยอดแบบเดิม
 * @param opts.withinDays  ช่วงเวลาที่ถือว่าน่าสงสัย (ค่าเริ่มต้น 30 วัน)
 * @param opts.excludeId   ข้ามใบนี้ (ตอนแก้ไขบิลเดิม)
 */
export function findDuplicateInvoices(invoices = [], candidate, { withinDays = 30, excludeId = null } = {}) {
  const total = Number(candidate?.total) || 0;
  if (total <= 0) return [];
  const base = parseDocDate(candidate?.date) || new Date();
  const sig = Array.isArray(candidate?.items) ? itemsSignature(candidate) : null;

  return invoices.filter(inv => {
    if (excludeId && inv.id === excludeId) return false;
    if (inv.mergedInto || inv.convertedTo) return false;      // ถูกยุบ/แปลงไปแล้ว ไม่ใช่ยอดจริง
    if ((inv.status || "") === "ยกเลิก") return false;
    if (Math.abs((Number(inv.total) || 0) - total) > 0.009) return false;
    if (!sameCustomer(inv, candidate)) return false;
    if (sig !== null && itemsSignature(inv) !== sig) return false;   // ยอดตรงแต่ของคนละชุด = ไม่ซ้ำ
    const d = parseDocDate(inv.date);
    if (!d) return true;                                      // ไม่มีวันที่ → เตือนไว้ก่อน ดีกว่าปล่อยผ่าน
    return Math.abs(base - d) / (1000 * 60 * 60 * 24) <= withinDays;
  });
}

/**
 * จับคู่บิลซ้ำที่ "ออกไปแล้ว" ในกองที่โหลดมา — ใช้ติดป้ายเตือนในหน้ารายการบิล
 * คืน Map: invoiceId → บิลใบอื่นที่ลูกค้า+ยอด+รายการสินค้าตรงกัน
 */
export function duplicateGroups(invoices = [], { withinDays = 30 } = {}) {
  const live = invoices.filter(i =>
    !i.mergedInto && !i.convertedTo && (i.status || "") !== "ยกเลิก" && (Number(i.total) || 0) > 0);

  // จัดกลุ่มด้วย ลูกค้า+ยอด+รายการ ก่อน แล้วค่อยเช็กวันที่ — กัน O(n²) ตอนบิลเยอะ
  const groups = new Map();
  live.forEach(inv => {
    const k = `${inv.customerId || norm(inv.customerName)}|${(Number(inv.total) || 0).toFixed(2)}|${itemsSignature(inv)}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(inv);
  });

  const out = new Map();
  groups.forEach(list => {
    if (list.length < 2) return;
    list.forEach(inv => {
      const others = list.filter(o => {
        if (o.id === inv.id) return false;
        const a = parseDocDate(inv.date), b = parseDocDate(o.date);
        if (!a || !b) return true;
        return Math.abs(a - b) / (1000 * 60 * 60 * 24) <= withinDays;
      });
      if (others.length > 0) out.set(inv.id, others);
    });
  });
  return out;
}
