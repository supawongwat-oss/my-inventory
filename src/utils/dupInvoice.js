// 🔁 หาบิลที่น่าจะซ้ำกัน
//
// เคสจริง: พนักงานออกบิลให้ลูกค้าเดิม ยอดเดิม ซ้ำอีกใบ (INV6908-0108 กับ 0115)
// ตอนนี้ระบบกันบิลซ้ำเฉพาะที่ออก "จากใบสั่งของ" เท่านั้น — ออกมือเปล่าไม่มีอะไรกัน
// ยิ่งตอนนี้หลายคนช่วยกันทำงานบัญชี โอกาสที่สองคนออกใบเดียวกันยิ่งสูง
//
// เกณฑ์: ลูกค้าเดียวกัน + ยอดเท่ากัน + ออกห่างกันไม่เกิน N วัน
// จงใจไม่ดูรายการสินค้า — บิลซ้ำมักถูกพิมพ์ใหม่ทั้งใบ รายการอาจเรียงไม่เหมือนกัน
// แต่ "ลูกค้าเดิม + ยอดตรงกันเป๊ะ" ในเวลาไล่เลี่ยกันแทบไม่มีทางเป็นเรื่องบังเอิญ

const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");

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
 * @param candidate { customerId, customerName, total, date }
 * @param opts.withinDays  ช่วงเวลาที่ถือว่าน่าสงสัย (ค่าเริ่มต้น 30 วัน)
 * @param opts.excludeId   ข้ามใบนี้ (ตอนแก้ไขบิลเดิม)
 */
export function findDuplicateInvoices(invoices = [], candidate, { withinDays = 30, excludeId = null } = {}) {
  const total = Number(candidate?.total) || 0;
  if (total <= 0) return [];
  const base = parseDocDate(candidate?.date) || new Date();

  return invoices.filter(inv => {
    if (excludeId && inv.id === excludeId) return false;
    if (inv.mergedInto || inv.convertedTo) return false;      // ถูกยุบ/แปลงไปแล้ว ไม่ใช่ยอดจริง
    if ((inv.status || "") === "ยกเลิก") return false;
    if (Math.abs((Number(inv.total) || 0) - total) > 0.009) return false;
    if (!sameCustomer(inv, candidate)) return false;
    const d = parseDocDate(inv.date);
    if (!d) return true;                                      // ไม่มีวันที่ → เตือนไว้ก่อน ดีกว่าปล่อยผ่าน
    return Math.abs(base - d) / (1000 * 60 * 60 * 24) <= withinDays;
  });
}

/**
 * จับคู่บิลซ้ำที่ "ออกไปแล้ว" ในกองที่โหลดมา — ใช้ติดป้ายเตือนในหน้ารายการบิล
 * คืน Map: invoiceId → บิลใบอื่นที่ยอด+ลูกค้าตรงกัน
 */
export function duplicateGroups(invoices = [], { withinDays = 30 } = {}) {
  const live = invoices.filter(i =>
    !i.mergedInto && !i.convertedTo && (i.status || "") !== "ยกเลิก" && (Number(i.total) || 0) > 0);

  // จัดกลุ่มหยาบด้วย ลูกค้า+ยอด ก่อน แล้วค่อยเช็กวันที่ — กัน O(n²) ตอนบิลเยอะ
  const groups = new Map();
  live.forEach(inv => {
    const k = `${inv.customerId || norm(inv.customerName)}|${(Number(inv.total) || 0).toFixed(2)}`;
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
