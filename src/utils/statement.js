import { settleModeOf } from "./returns";
import { phoneKeyOf } from "./searchKeys";

// ── 👤 จับคู่ลูกค้าของเอกสาร ────────────────────────────────
//
// ปัญหาที่แก้: พนักงานพิมพ์ชื่อลูกค้าในบิลไม่เหมือนกันทุกครั้ง
// (เว้นวรรคต่างกัน มี/ไม่มีคำว่า "ร้าน" สะกดต่างนิดหน่อย)
// ของเดิมเทียบชื่อแบบ "ตรงตัวเป๊ะ" → บางบิลมา บางบิลหายไปเฉย ๆ ตอนวางบิล
//
// และมีบั๊กซ้อนอีกชั้น: เงื่อนไขเดิมเป็น (!inv.customerId && ชื่อตรง)
// แปลว่าถ้าบิลมีรหัสลูกค้าอยู่แล้วแต่เป็นคนละรหัส (เช่นลูกค้าถูกสร้างซ้ำในทะเบียน)
// ระบบจะ "ไม่ลองเทียบชื่อเลย" → บิลนั้นหายถาวร ไม่มีอะไรฟ้อง
// ตอนนี้เทียบต่อกันเป็นชั้น ๆ ไม่ตัดชั้นถัดไปทิ้ง
//
// ชั้นการจับคู่ (แน่นที่สุด → หลวมสุด):
//   id      รหัสลูกค้าตรง            เชื่อได้เต็มที่
//   phone   เบอร์ตรง                 เชื่อได้ — เบอร์ชี้ตัวได้แม่นกว่าชื่อ
//   name    ชื่อตรงแบบไม่ซีเรียสรูป   ตัดช่องว่าง/วรรณยุกต์ก่อนเทียบ
//   similar ชื่อใกล้เคียง             ❗ ไม่รวมให้เอง แต่เอาไปโชว์ให้คนตัดสิน
//
// ที่ไม่รวม similar ให้อัตโนมัติ เพราะวางบิลผิดคน = ทวงเงินผิดคน
// แย่กว่าตกหล่นแล้วเห็นรายการค้างอยู่
const TONE = /[็-๎-]/g;
export const custKey = (s) => String(s || "")
  .normalize("NFC").toLowerCase()
  .replace(TONE, "").replace(/ำ/g, "า")
  .replace(/[\s.,\-_()]/g, "")
  .trim();

export function matchCustomer(docLike, ref) {
  if (!docLike || !ref) return "";
  if (docLike.customerId && ref.customerId && docLike.customerId === ref.customerId) return "id";
  const dp = phoneKeyOf(docLike.customerPhone), rp = phoneKeyOf(ref.customerPhone);
  if (dp && rp && dp.length >= 9 && dp === rp) return "phone";
  const dn = custKey(docLike.customerName), rn = custKey(ref.customerName);
  if (!dn || !rn) return "";
  if (dn === rn) return "name";
  // ชื่อหนึ่งเป็นส่วนหนึ่งของอีกชื่อ เช่น "สมชายสปอร์ต" กับ "ร้านสมชายสปอร์ต"
  if (dn.length >= 4 && rn.length >= 4 && (dn.includes(rn) || rn.includes(dn))) return "similar";
  return "";
}

export const MATCH_SURE = ["id", "phone", "name"];
export const isSureMatch = (m) => MATCH_SURE.includes(m);


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
export const filterInvoicesForStatement = (invoices, customerId, customerName, startDate, endDate, mode, customerPhone) => {
  const ref = { customerId, customerName, customerPhone };
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

    if (!isSureMatch(matchCustomer(inv, ref))) return false;

    const d = parseDDMMYYYY(inv.date);
    if (!d) return false;
    const t = d.getTime();
    if (t < startMs || t > endMs) return false;

    const status = inv.status || "ออกแล้ว";
    if (mode === "unpaid" && (status === "ชำระแล้ว" || status === "ยกเลิก")) return false;

    return true;
  });
};

// ── ↩️ ใบลดหนี้จากการรับคืน ──────────────────────────────────
// ของที่ลูกค้าคืนต้องไปหักตอนวางบิล ไม่งั้นสิ้นเดือนจะเก็บเงินเต็มทั้งที่คืนของแล้ว
//
// เอาใบไหนมาหัก:
//   · จับคู่บิลแล้วเท่านั้น (ยังไม่จับคู่ = ยังไม่รู้ราคา ยังคิดยอดไม่ได้)
//   · ยังไม่เคยถูกหักในใบวางบิลใบไหน (appliedStatementId ว่าง) ← กันหักซ้ำทุกเดือน
//   · วันที่รับของ ≤ วันสิ้นงวด
//
// ไม่กำหนดขอบล่างของช่วงโดยตั้งใจ — ของที่คืนหลังตัดยอดเดือนก่อนไปแล้ว
// จะถูกยกมาหักในใบวางบิลรอบถัดไปเอง ตรงกับที่ร้านทำจริง
export const creditsForStatement = (returns = [], customerId, customerName, endDate, customerPhone) => {
  const endMs = endDate
    ? new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate(), 23, 59, 59).getTime()
    : Infinity;
  return returns.filter(r => {
    if ((r.status || "") !== "จับคู่แล้ว") return false;
    if (r.appliedStatementId) return false;
    // 💵 ใบที่จ่ายเงินคืนไปแล้ว ห้ามมาหักในบิลอีก ไม่งั้นลูกค้าได้คืน 2 ทาง
    if (settleModeOf(r) === "cash") return false;
    if (!(Number(r.creditTotal) > 0)) return false;
    if (!isSureMatch(matchCustomer(r, { customerId, customerName, customerPhone }))) return false;
    const d = parseDDMMYYYY(r.receivedAt) || parseDDMMYYYY(r.checkedAt);
    if (!d) return true;                       // ไม่มีวันที่ → ปล่อยให้หักได้ ดีกว่าตกหล่น
    return d.getTime() <= endMs;
  });
};

export const sumCredits = (list = []) =>
  list.reduce((a, r) => a + (Number(r.creditTotal) || 0), 0);

// 🔎 บิลที่ "ชื่อใกล้เคียง" แต่ไม่ถึงขั้นมั่นใจ — ไม่รวมให้เอง แต่ต้องเอาไปโชว์
//    นี่คือตัวที่ทำให้ปัญหา "บางบิลหายไป" มองเห็นได้ แทนที่จะหายเงียบ
export const nearMissInvoices = (invoices = [], customerId, customerName, startDate, endDate, mode, customerPhone) => {
  const ref = { customerId, customerName, customerPhone };
  const startMs = startDate ? startDate.getTime() : -Infinity;
  const endMs = endDate ? new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate(), 23, 59, 59).getTime() : Infinity;
  return invoices.filter(inv => {
    if (matchCustomer(inv, ref) !== "similar") return false;
    if (inv.mergedInto || inv.convertedTo) return false;
    const d = parseDDMMYYYY(inv.date);
    if (!d) return false;
    const t = d.getTime();
    if (t < startMs || t > endMs) return false;
    const status = inv.status || "ออกแล้ว";
    if (mode === "unpaid" && (status === "ชำระแล้ว" || status === "ยกเลิก")) return false;
    return true;
  });
};
