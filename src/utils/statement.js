// 📃 ตัวช่วยของใบวางบิล — แยกมาไว้ที่นี่เพราะใช้ทั้งหน้าสร้างทีละใบ (StatementTab)
//    และหน้าออกทั้งเดือน (BulkStatementModal) → กัน circular import
const pad2 = n => String(n).padStart(2, "0");

// "DD/MM/YYYY HH:mm" → Date (รองรับทั้ง พ.ศ. และ ค.ศ.)
export const parseDDMMYYYY = (s) => {
  if (!s) return null;
  const datePart = String(s).split(" ")[0];
  const [d, m, y] = datePart.split("/").map(Number);
  if (!d || !m || !y) return null;
  const year = y > 2500 ? y - 543 : y;
  return new Date(year, m - 1, d);
};

export const fmtDDMMYYYY = (date) =>
  date ? `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}/${date.getFullYear()}` : "";

export const fmtISO = (date) =>
  date ? `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}` : "";

export const parseISODate = (s) => {
  if (!s) return null;
  const [y, m, d] = String(s).split("-").map(Number);
  return (y && m && d) ? new Date(y, m - 1, d) : null;
};

// คัดบิลที่จะเข้าใบวางบิลของลูกค้ารายหนึ่ง
//   mode "unpaid" = เอาเฉพาะที่ยังไม่ชำระ (ตัดที่ชำระแล้ว/ยกเลิกออก)
//   mode "all"    = เอาทุกใบในช่วง
export const filterInvoicesForStatement = (invoices, customerId, customerName, startDate, endDate, mode) => {
  const startMs = startDate ? startDate.getTime() : -Infinity;
  // รวมทั้งวันสุดท้าย (ถึง 23:59:59)
  const endMs = endDate
    ? new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate(), 23, 59, 59).getTime()
    : Infinity;

  return invoices.filter(inv => {
    // 🚫 บิลที่ถูกรวมเข้าบิลใหม่แล้ว — ไม่นับ ไม่งั้นยอดซ้ำ 2 เท่า
    //    (ตัวที่รวมแล้วมี mergedInto · ยอดจริงอยู่ในบิลใหม่ที่รวมมันไป)
    if (inv.mergedInto) return false;
    // 🚫 เอกสารที่แปลงเป็นเอกสารอื่นแล้ว (เช่น ใบเสนอราคา → ใบกำกับภาษี)
    //    ต้นฉบับไม่ใช่ยอดที่ต้องเก็บเงิน
    if (inv.convertedTo) return false;

    const sameCustomer = (inv.customerId && inv.customerId === customerId)
      || (!inv.customerId && inv.customerName === customerName);
    if (!sameCustomer) return false;

    const d = parseDDMMYYYY(inv.date);
    if (!d) return false;
    const t = d.getTime();
    if (t < startMs || t > endMs) return false;

    const status = inv.status || "ออกแล้ว";
    if (mode === "unpaid" && (status === "ชำระแล้ว" || status === "ยกเลิก")) return false;

    return true;
  });
};
