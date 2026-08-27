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

// 💰 เงินที่ลูกค้าจ่ายมาแล้วกับบิลใบนี้ (มัดจำ หรือจ่ายบางส่วน)
//    ใบวางบิลต้องเก็บเฉพาะส่วนที่ยังค้าง ไม่ใช่ยอดหน้าบิล
//    ของเดิมคิดยอดหน้าบิลเต็ม ๆ — บิลที่รับมัดจำมาแล้วจึงถูกทวงซ้ำในส่วนที่จ่ายไปแล้ว
export const paidOf = (inv) => (inv?.payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
export const dueOf = (inv) => Math.max(0, (Number(inv?.total) || 0) - paidOf(inv));

// บิลใบนี้ยังต้องเก็บเงินอยู่ไหม (ใช้ตัดสินว่าจะเข้าใบวางบิลรอบนี้หรือไม่)
export const isOutstanding = (inv) => {
  const st = inv?.status || "ออกแล้ว";
  if (st === "ชำระแล้ว" || st === "ยกเลิก") return false;
  return dueOf(inv) > 0;   // จ่ายครบแล้วแต่ลืมเปลี่ยนสถานะ ก็ไม่ต้องทวงอีก
};

// คัดบิลที่จะเข้าใบวางบิลของลูกค้ารายหนึ่ง
//   mode "unpaid" = เอาเฉพาะที่ยังไม่ชำระ (ตัดที่ชำระแล้ว/ยกเลิกออก)
//   mode "all"    = เอาทุกใบในช่วง
// 🚫 บิลที่อยู่ในใบวางบิลใบอื่นแล้ว — ห้ามเอามาวางซ้ำ
//
// ใบวางบิลที่ออกไปแล้วคือเอกสารที่ส่งถึงลูกค้าแล้ว แก้ย้อนหลังไม่ได้
// เวลาลูกค้าสั่งเพิ่มทีหลัง วิธีที่ถูกคือออกใบใหม่เฉพาะบิลที่เพิ่มเข้ามา
// ถ้าไม่กันไว้ ช่วงวันที่ที่คาบเกี่ยวกันจะดึงบิลเดิมกลับมาอีกรอบ = ทวงเงินซ้ำ
// (ใบที่ยกเลิกไปแล้วไม่นับ — บิลในนั้นกลับมาวางใหม่ได้)
export const statementedInvoiceIds = (statements = [], exceptId = null) => {
  const out = new Set();
  (statements || []).forEach(st => {
    if (!st || (st.status || "") === "ยกเลิก") return;
    if (exceptId && st.id === exceptId) return;
    (st.invoiceIds || []).forEach(id => out.add(id));
  });
  return out;
};

// หาว่าบิลใบนี้ไปอยู่ในใบวางบิลไหน — ใช้บอกคนดูว่าทำไมถึงไม่ขึ้น
export const statementOfInvoice = (statements = [], invoiceId) =>
  (statements || []).find(st => st && (st.status || "") !== "ยกเลิก" && (st.invoiceIds || []).includes(invoiceId)) || null;

export const filterInvoicesForStatement = (invoices, customerId, customerName, startDate, endDate, mode, customerPhone, usedIds = null) => {
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
    // 🚫 วางบิลไปแล้วในใบอื่น — ไม่เอามาซ้ำ
    if (usedIds && usedIds.has(inv.id)) return false;

    const d = parseDDMMYYYY(inv.date);
    if (!d) return false;
    const t = d.getTime();
    if (t < startMs || t > endMs) return false;

    if (mode === "unpaid" && !isOutstanding(inv)) return false;

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

// 🧾 จัดกลุ่มบิลเป็น "ใบวางบิลรายลูกค้า" — ใช้โดยหน้าออกทั้งเดือน
//    แยกออกมาเป็นฟังก์ชันล้วน (ไม่พึ่ง React) เพราะเป็นตัวที่ตัดสินว่าใครจะโดนเก็บเงินเท่าไหร่
//    ต้องเอาไปรันทดสอบกับข้อมูลจริงนอกเบราว์เซอร์ได้ ก่อนออกใบจริงส่งลูกค้า
export function buildStatementGroups({
  invoices = [], customers = [], statements = [], returns = [],
  startDate, endDate, filterMode = "unpaid", onlyCredit = true,
}) {
  if (!startDate || !endDate) return [];
  // บิลที่ถูกวางบิลไปแล้ว ตัดออกตั้งแต่ต้นทาง — ออกทั้งเดือนซ้ำจะได้เหลือเฉพาะใบใหม่
  const usedIds = statementedInvoiceIds(statements);
  // รวมรายชื่อจากทั้งลูกค้าในระบบ + ชื่อที่โผล่ในบิล (เผื่อบิลที่ไม่ได้ผูกลูกค้า)
  const seen = new Map(); // key → { customerId, customerName, ...ข้อมูลติดต่อ }
  customers.forEach(c => seen.set(`id:${c.id}`, {
    customerId: c.id, customerName: c.name || "", phone: c.phone||"", address: c.address||"", taxId: c.taxId||"",
    // เก็บค่าดิบ — "ยังไม่ตั้ง" ต้องแยกจาก "ตั้งเป็นเครดิต" ให้ได้ ไม่งั้นบนหน้าจอจะดูเหมือน
    // ตั้งค่าครบแล้วทั้งที่ยังไม่มีใครเคยตั้ง (ตอนนี้ตั้งจริงแค่ 2 จาก 248 ราย)
    // ส่วนการคัดออกยังยึด "เฉพาะที่ตั้งเป็นเงินสด" เหมือนเดิม ยังไม่ตั้ง = ยังวางบิลให้
    billingType: c.billingType || "",
  }));
  const knownIds = new Set(customers.map(c => c.id));
  invoices.forEach(inv => {
    // บิลที่ผูกกับลูกค้าที่ยังอยู่ในทะเบียน → ไปรวมที่แถวของลูกค้ารายนั้น
    // แต่ถ้าผูกกับรหัสที่ถูกลบไปแล้ว ต้องมีแถวรับ ไม่งั้นบิลหายเงียบ ๆ ไม่มีอะไรฟ้อง
    if (inv.customerId && knownIds.has(inv.customerId)) return;
    const nm = (inv.customerName || "").trim();
    if (!nm) return;
    const k = `name:${nm}`;
    // บิลที่ไม่ผูกลูกค้า → ไม่รู้ประเภท ถือว่าเครดิตไว้ก่อน (จะได้ไม่ตกหล่น)
    if (!seen.has(k)) seen.set(k, { customerId: "", customerName: nm, phone: inv.customerPhone||"", address: inv.customerAddress||"", taxId: inv.customerTaxId||"", billingType: "", unlinked: true });
  });

  const refs = [];
  seen.forEach((c, key) => refs.push({ key, ...c }));

  // 🧮 แจกบิล/ใบลดหนี้ให้เจ้าของรายเดียว
  const RANK = { id: 3, phone: 2, name: 1 };
  const refOf = (r) => ({ customerId: r.customerId, customerName: r.customerName, customerPhone: r.phone });
  const claim = (owners, docLike, r) => {
    const rank = RANK[matchCustomer(docLike, refOf(r))] || 0;
    if (!rank) return;
    const cur = owners.get(docLike.id);
    if (!cur || rank > cur.rank || (rank === cur.rank && !cur.hasId && r.customerId))
      owners.set(docLike.id, { key: r.key, rank, hasId: !!r.customerId });
  };

  const invOwner = new Map(), credOwner = new Map();
  const cand = new Map(); // key → { invs, credits } ที่ "เข้าเงื่อนไข" (ยังไม่ตัดสินเจ้าของ)
  refs.forEach(r => {
    // ดึงมาทั้งหมดก่อนเสมอ (ไม่กรองสถานะ) — ต้องรู้ว่ามีบิลอะไรถูกตัดออกบ้าง
    // ไม่งั้นยอดในใบวางบิลต่างจากหน้าบิลลิบลับโดยไม่มีอะไรอธิบาย คนดูก็นึกว่าเงินหาย
    const invs = filterInvoicesForStatement(invoices, r.customerId, r.customerName, startDate, endDate, "all", r.phone, usedIds);
    // ที่ตัดออกเพราะวางบิลไปแล้ว — ต้องนับไว้บอกคนดู ไม่ให้เงียบ
    const billed = filterInvoicesForStatement(invoices, r.customerId, r.customerName, startDate, endDate, "all", r.phone)
      .filter(i => usedIds.has(i.id));
    const credits = creditsForStatement(returns, r.customerId, r.customerName, endDate, r.phone);
    cand.set(r.key, { invs, credits, billed });
    invs.forEach(inv => claim(invOwner, inv, r));
    credits.forEach(cr => claim(credOwner, cr, r));
  });

  const rows = [];
  refs.forEach(r => {
    // 💵 เงินสด — ไม่ต้องวางบิล (ตัดหลังตัดสินเจ้าของแล้ว บิลของรายนี้จึงไม่ไหลไปโผล่ที่แถวชื่อคล้ายกัน)
    if (onlyCredit && r.billingType === "cash") return;
    const c = cand.get(r.key);
    const owned = c.invs.filter(i => invOwner.get(i.id)?.key === r.key);
    // แยกใบที่ยังต้องเก็บเงินจริง ออกจากใบที่ชำระ/ยกเลิกไปแล้ว — เก็บทั้งสองฝั่งไว้
    const invs = filterMode === "unpaid" ? owned.filter(isOutstanding) : owned;
    const excluded = owned.filter(i => !invs.includes(i));
    const excludedTotal = excluded.reduce((s, i) => s + (Number(i.total) || 0), 0);
    if (invs.length === 0) return;
    // ⚠️ เตือนถ้าเคยออกใบวางบิลช่วงเดียวกันไปแล้ว — กันออกซ้ำ
    const dupe = statements.some(s =>
      ((s.customerId && s.customerId === r.customerId) || (!s.customerId && s.customerName === r.customerName)) &&
      s.periodStart === fmtDDMMYYYY(startDate) && s.periodEnd === fmtDDMMYYYY(endDate) && s.status !== "ยกเลิก"
    );
    // ↩️ ของที่ลูกค้ารายนี้คืนและยังไม่เคยถูกหัก → หักในใบวางบิลรอบนี้
    const credits = c.credits.filter(x => credOwner.get(x.id)?.key === r.key);
    const creditTotal = sumCredits(credits);
    // 💰 ยอดที่เก็บจริง = ยอดหน้าบิล ลบเงินที่รับมาแล้ว (มัดจำ/จ่ายบางส่วน)
    const grossTotal = invs.reduce((s,i)=>s+(Number(i.total)||0),0);
    const paidTotal = invs.reduce((s,i)=>s+paidOf(i),0);
    const total = invs.reduce((s,i)=>s+dueOf(i),0);
    // ⚠️ บิลที่ชื่อในตัวบิลไม่ตรงกับชื่อแถวนี้ (เข้ามาเพราะผูกรหัสลูกค้าไว้)
    //    ชื่อคล้ายกันไม่ได้แปลว่าเจ้าเดียวกัน — เช่น FBT มี 3 บริษัทแยกกัน
    //    วางบิลผิดเจ้า = ทวงเงินผิดคน จึงต้องให้คนดูก่อน ห้ามกลืนเงียบ ๆ
    //    บิลไม่มีชื่อไม่นับ — "ไม่ได้กรอกชื่อ" คนละเรื่องกับ "ชื่อคนอื่น"
    const oddNames = invs.filter(i => { const k = custKey(i.customerName); return k && k !== custKey(r.customerName); });
    // สรุปเป็น "ชื่อ (n ใบ)" ไว้โชว์ตรง ๆ — ต้องอ่านออกโดยไม่ต้องเอาเมาส์ไปจ่อทีละแถว
    // ไม่งั้นเห็นแค่ "ต่างกัน 1 ใบ" ก็ตัดสินใจอะไรไม่ได้ ต้องเดาว่าเป็นชื่อของใคร
    const oddCount = new Map();
    oddNames.forEach(i => { const nm = (i.customerName || "").trim(); oddCount.set(nm, (oddCount.get(nm) || 0) + 1); });
    const oddSummary = [...oddCount.entries()].map(([nm, n]) => `${nm} (${n} ใบ)`);
    rows.push({ ...r, invoices: invs, total, grossTotal, paidTotal, excluded, excludedTotal,
      alreadyBilled: c.billed.length, alreadyBilledTotal: c.billed.reduce((s, i) => s + (Number(i.total) || 0), 0),
      credits, creditTotal, net: Math.max(0, total - creditTotal), dupe, oddNames, oddSummary });
  });
  return rows.sort((a,b) => b.total - a.total);
}
