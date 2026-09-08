// ↩️ รับคืนสินค้า — ตรรกะกลาง (ไม่มี UI ไม่แตะ Firestore)
//
// โจทย์จริงของร้าน: ลูกค้าอยู่ต่างจังหวัด ส่งของคืนมาทางพัสดุ
// กล่องที่มาถึงมักมีแค่ "ตัวสินค้า" ไม่มีบิล บางทีไม่มีแม้แต่ชื่อคนส่ง
// ระบบจึงต้องรับของเข้ามาก่อนได้ แล้วค่อยจับคู่กับบิลทีหลัง
//
// สถานะของใบรับคืน:
//   รอจับคู่บิล → ของถึงร้านแล้ว แต่ยังไม่รู้ว่ามาจากบิลใบไหน
//   จับคู่แล้ว  → รู้บิลแล้ว คิดยอดลดหนี้และคืนสต็อกเรียบร้อย
//   ยกเลิก      → รับผิด/ตีกลับ

export const RETURN_STATUSES = ["รอจับคู่บิล", "จับคู่แล้ว", "ยกเลิก"];

// 🔍 สภาพของ เป็นคนละเส้นกับเรื่องเงิน
//   เส้นเงิน (status)   : รอจับคู่บิล → จับคู่แล้ว
//   เส้นของ  (qcStatus) : รอตรวจ → ตรวจแล้ว (ค่อยเข้าสต็อกตอนนี้)
// แยกกันเพราะจับคู่บิลได้เร็วไม่ได้แปลว่าตรวจของแล้ว และของดีที่หาบิลไม่เจอ
// ก็ไม่ควรค้างเติมสต็อกไม่ได้
// 💰 คืนเงินให้ลูกค้าทางไหน — เลือกได้ทางเดียวเท่านั้น ห้ามซ้อนกัน
//   statement = หักออกจากใบวางบิลงวดถัดไป (ค่าเริ่มต้น — ลูกค้าเครดิต)
//   cash      = จ่ายเงินคืนหน้าร้าน/โอนคืน แล้วออก "ใบลดหนี้" เป็นหลักฐานให้ลูกค้า
//
// ⚠️ ใบที่เลือก cash ต้องไม่ถูกหักในใบวางบิลอีก ไม่งั้นลูกค้าได้เงินคืน 2 ทาง
//    (creditsForStatement ใน statement.js คัดออกให้แล้ว)
export const SETTLE_MODES = [
  { id: "statement", label: "หักในใบวางบิล", hint: "ลูกค้าเครดิต — ยกไปหักงวดถัดไป" },
  { id: "cash",      label: "คืนเป็นเงินสด",  hint: "จ่ายคืนเลย + ออกใบลดหนี้ให้ลูกค้า" },
];
export const settleModeOf = (r) => (r?.settleMode === "cash" ? "cash" : "statement");
export const isCashRefund = (r) => settleModeOf(r) === "cash";
export const QC_STATUSES = ["รอตรวจ", "ตรวจแล้ว"];

// ใบเก่าก่อนมีขั้นตรวจ: ของถูกเติมสต็อกไปแล้วตอนจับคู่บิล → ถือว่าตรวจแล้ว
// (ถ้าไม่กันไว้ จะกดตรวจซ้ำแล้วสต็อกเด้งเกิน)
export const qcStatusOf = (r) =>
  r?.qcStatus || (r?.status === "จับคู่แล้ว" ? "ตรวจแล้ว" : "รอตรวจ");
export const needsQC = (r) => (r?.status || "") !== "ยกเลิก" && qcStatusOf(r) === "รอตรวจ";

export const RETURN_REASONS = [
  "ไซส์ไม่พอดี",
  "สินค้ามีตำหนิ",
  "ได้ของไม่ตรงที่สั่ง",
  "ลูกค้าเปลี่ยนใจ",
  "งานพิมพ์/ปักไม่ตรงแบบ",
  "อื่น ๆ",
];

// สภาพของที่คืนมา — ตัดสินว่าเอากลับเข้าสต็อกได้ไหม
export const RETURN_CONDITIONS = [
  { id: "ขายต่อได้", restock: true,  hint: "สภาพดี เอากลับเข้าสต็อก" },
  { id: "ตำหนิ",     restock: false, hint: "ขายต่อไม่ได้ ไม่เข้าสต็อก" },
  { id: "ชำรุด",     restock: false, hint: "ทิ้ง ไม่เข้าสต็อก" },
];

export const conditionRestocks = (cond) =>
  (RETURN_CONDITIONS.find(c => c.id === cond) || RETURN_CONDITIONS[0]).restock;

const num = (v) => Number(v) || 0;

export const norm = (s) => String(s || "").normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();

// 🔑 กุญแจเทียบว่า "ของชิ้นนี้" กับ "บรรทัดในบิล" เป็นตัวเดียวกันไหม
//   ใช้ชื่อรุ่นแทน id ด้วย เพราะของที่คืนมาบางทีกรอกจากป้ายบนตัวเสื้อ ไม่ได้เลือกจากระบบ
export const lineKey = (it) => [
  norm(it?.clothingId || it?.clothingName),
  norm(it?.colorName),
  norm(it?.size),
].join("|");

// กุญแจสำรอง — เทียบด้วย "ชื่อรุ่น" ล้วน ไม่สนใจ id
export const nameLineKey = (it) => [
  norm(it?.clothingName || it?.description),
  norm(it?.colorName),
  norm(it?.size),
].join("|");

// 🔗 แปลง "บรรทัดที่กรอกในใบรับคืน" → "กุญแจของบรรทัดในบิลใบนั้น"
//
// ทำไมต้องมี: lineKey ใช้ clothingId ก่อนถ้ามี และบรรทัดในบิลจริงมี id แทบทั้งหมด
// (4,079 จาก 4,082 บรรทัดในข้อมูลจริง) ส่วนของที่คืนมามักพิมพ์ชื่อเองจากป้ายบนตัวเสื้อ
// ไม่มี id ติดมา เทียบตรง ๆ จึงไม่มีวันตรง → บรรทัดที่พิมพ์เองขึ้น "ไม่มีในบิล" ทุกใบ
// ทั้งที่ของอยู่ในบิลจริง ๆ · พอเตือนผิดทุกครั้งพนักงานก็เลิกอ่าน แล้ววันที่ไม่มีในบิลจริง
// ก็หลุดไปหักเงินในใบวางบิลสิ้นเดือนโดยไม่มีใครทัก
//
// รวมทุกกุญแจของบรรทัดเดียวกันให้ชี้ไป "กุญแจหลัก" อันเดียว โควตาคืนจะได้ไม่ถูกนับแยกกอง
// (ถ้าลงทะเบียนสองกุญแจแยกกัน จะคืนด้วยชื่อ 1 ตัว + คืนด้วย id อีก 1 ตัว = เกินที่ขายไป)
export function invoiceLineResolver(invoice) {
  const canon = new Map();
  (invoice?.items || []).forEach(it => {
    const main = lineKey(it);
    canon.set(main, main);
    const byName = nameLineKey(it);
    if (byName && !canon.has(byName)) canon.set(byName, main);
  });
  return (it) => canon.get(lineKey(it)) || canon.get(nameLineKey(it)) || lineKey(it);
}

// ยอดลดหนี้ของใบรับคืน — ราคาต่อหน่วยยึดตาม "บิลต้นทาง" ไม่ใช่ราคาป้ายวันนี้
export const calcReturn = (items = []) => {
  const qty = items.reduce((s, i) => s + num(i.qty), 0);
  const total = items.reduce((s, i) => s + num(i.qty) * num(i.unitPrice), 0);
  const restockQty = items.reduce((s, i) => s + (conditionRestocks(i.condition) ? num(i.qty) : 0), 0);
  return { qty, total, restockQty };
};

// ── จับคู่บิล ────────────────────────────────────────────────
// ให้คะแนนว่าบิลใบไหน "น่าจะใช่" ที่สุด แล้วเรียงให้พนักงานเลือก
// ไม่จับคู่อัตโนมัติ — ตัดสินใจเรื่องเงินโดยไม่ให้คนยืนยันก่อนนั้นอันตรายเกินไป
//
// น้ำหนักคะแนน (มาก→น้อย):
//   เบอร์โทรตรง            60   ← ชี้ตัวได้แม่นสุด กล่องพัสดุมักมีเบอร์
//   ชื่อลูกค้าตรง           40
//   ชื่อลูกค้าใกล้เคียง      20
//   ทุกชิ้นที่คืนมีในบิล     50   ← หลักฐานที่หนักที่สุดเมื่อไม่รู้ตัวลูกค้า
//   มีบางชิ้น              15/ชิ้น
//   จำนวนในบิลพอให้คืน      10
//   ออกบิลไม่เกิน 90 วัน     15   ← ของที่คืนมักเป็นของใหม่
const DAY = 24 * 60 * 60 * 1000;

export function scoreInvoiceMatch(inv, ret, nowMs = Date.now()) {
  if (!inv) return { score: 0, reasons: [] };
  const reasons = [];
  let score = 0;

  const digits = (s) => String(s || "").replace(/\D/g, "");
  const retPhone = digits(ret?.customerPhone);
  if (retPhone && retPhone.length >= 9 && digits(inv.customerPhone) === retPhone) {
    score += 60; reasons.push("เบอร์ตรง");
  }

  const rn = norm(ret?.customerName), inm = norm(inv.customerName);
  if (rn && inm) {
    if (rn === inm) { score += 40; reasons.push("ชื่อตรง"); }
    else if (inm.includes(rn) || rn.includes(inm)) { score += 20; reasons.push("ชื่อใกล้เคียง"); }
  }

  // เทียบตัวสินค้า — รวมจำนวนต่อ key เผื่อบิลแตกหลายบรรทัดเป็นไซส์เดียวกัน
  const have = new Map();
  (inv.items || []).forEach(it => {
    const k = lineKey(it);
    have.set(k, (have.get(k) || 0) + num(it.qty));
  });
  const retItems = (ret?.items || []).filter(i => num(i.qty) > 0);
  if (retItems.length) {
    let found = 0, enough = 0;
    retItems.forEach(ri => {
      const avail = have.get(lineKey(ri)) || 0;
      if (avail > 0) { found++; if (avail >= num(ri.qty)) enough++; }
    });
    if (found === retItems.length) { score += 50; reasons.push("มีสินค้าครบทุกชิ้น"); }
    else if (found > 0) { score += found * 15; reasons.push(`มีสินค้า ${found}/${retItems.length} ชิ้น`); }
    if (enough === retItems.length && retItems.length > 0) score += 10;
  }

  const t = inv.createdAt?.seconds ? inv.createdAt.seconds * 1000 : Date.parse(inv.date || "") || 0;
  if (t && nowMs - t <= 90 * DAY) { score += 15; reasons.push("ออกบิลไม่เกิน 90 วัน"); }

  return { score, reasons };
}

// เรียงบิลที่น่าจะใช่ — ตัดใบที่ไม่เข้าเค้าเลยทิ้ง ไม่ให้พนักงานต้องไล่อ่านทั้งกอง
export function suggestInvoices(invoices = [], ret, { limit = 8, minScore = 20 } = {}) {
  const nowMs = Date.now();
  return invoices
    .filter(inv => !inv.mergedInto && !inv.convertedTo && (inv.status || "") !== "ยกเลิก")
    .map(inv => ({ inv, ...scoreInvoiceMatch(inv, ret, nowMs) }))
    .filter(x => x.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// ── 🧾 บิลต้นทางผูกที่ "รายบรรทัดสินค้า" ไม่ใช่ที่หัวเอกสาร ──────────
//
// ทำไม: ของคืนไม่ได้มาทีละกล่องแล้วลงบันทึกทันที มันกองรวมกันหลายวันกว่าจะได้เปิดดู
// พอเปิดดูทีเดียว ของในกองมาจากคนละบิลกัน — ของเดิมบังคับให้แยกทำใบละบิล
// กลายเป็นเปิดใบรับคืน 5 ใบสำหรับของกองเดียว แล้วลูกค้าก็เห็นในใบวางบิลเป็น 5 บรรทัดงง ๆ
//
// ใบเก่าที่ทำไว้ก่อนหน้านี้ไม่มีบิลรายบรรทัด → ถอยไปอ่านบิลที่หัวเอกสารเหมือนเดิม
// ทุกฟังก์ชันที่นับของต้องเรียกตัวนี้ ห้ามอ่าน r.invoiceId ตรง ๆ ไม่งั้นใบหลายบิลจะนับผิด
export const lineInvoiceId = (it, r) => it?.invoiceId || r?.invoiceId || "";

// บิลทั้งหมดที่ใบรับคืนใบนี้อ้างถึง — เรียงตามที่เจอในรายการ ไม่ซ้ำ
export function billsOfReturn(r) {
  const out = new Map();
  (r?.items || []).forEach(it => {
    const id = lineInvoiceId(it, r);
    if (!id || out.has(id)) return;
    out.set(id, it?.invoiceNo || (id === r?.invoiceId ? r?.invoiceNo || "" : ""));
  });
  if (out.size === 0 && r?.invoiceId) out.set(r.invoiceId, r.invoiceNo || "");
  return [...out.entries()].map(([id, no]) => ({ id, no }));
}

// เลขบิลอ่านเป็นข้อความ เช่น "INV6909-0016, INV6909-0029"
export const returnBillNosText = (r) => {
  const nos = billsOfReturn(r).map(b => b.no).filter(Boolean);
  return nos.length ? nos.join(", ") : (r?.invoiceNo || "");
};

// ── สรุปยอดคืนของบิลหนึ่งใบ ──────────────────────────────────
// นับเฉพาะใบที่จับคู่แล้ว — ใบที่ยังรอจับคู่ยังไม่ผูกกับบิลไหน
// นับรายบรรทัด: ใบหนึ่งใบอาจมีของของบิลนี้แค่บางบรรทัด ที่เหลือเป็นของบิลอื่น
export function returnSummaryOf(returns = [], invoiceId) {
  if (!invoiceId) return { count: 0, qty: 0, total: 0, list: [] };
  const list = [];
  let qty = 0, total = 0;
  (returns || []).forEach(r => {
    if (!r || (r.status || "") !== "จับคู่แล้ว") return;
    const items = r.items || [];
    const mine = items.filter(it => lineInvoiceId(it, r) === invoiceId);
    if (mine.length === 0) {
      // ใบเก่าที่ไม่ได้เก็บรายการสินค้าไว้ — ยังต้องนับได้จากหัวเอกสาร ไม่งั้นยอดเก่าหาย
      if (items.length === 0 && r.invoiceId === invoiceId) {
        list.push(r); qty += num(r.creditQty); total += num(r.creditTotal);
      }
      return;
    }
    list.push(r);
    // ใบที่ทั้งใบเป็นของบิลนี้ ใช้ยอดที่บันทึกไว้ตรง ๆ ให้ตัวเลขเท่าของเดิมเป๊ะ
    if (mine.length === items.length) { qty += num(r.creditQty); total += num(r.creditTotal); }
    else {
      qty += mine.reduce((s, it) => s + num(it.qty), 0);
      total += mine.reduce((s, it) => s + num(it.qty) * num(it.unitPrice), 0);
    }
  });
  return { count: list.length, qty, total, list };
}

// ยอดสุทธิหลังหักของที่คืน — ตัวเลขที่ควรใช้ตอนทวงเงินและดูยอดค้าง
export const netAfterReturns = (inv, returns = []) =>
  Math.max(0, num(inv?.total) - returnSummaryOf(returns, inv?.id).total);

// 🔎 ค้นหาสินค้าในบิล — ทุกคำต้องเจอ (พิมพ์ "k-12 แดง 2xl" ต้องได้บิลที่มีครบทั้ง 3)
//   เดิมช่องค้นบิลมองแค่ชื่อลูกค้า/เบอร์/เลขที่ ค้นจากตัวสินค้าไม่ได้เลย
export function invoiceItemsText(inv) {
  return (inv?.items || [])
    .map(it => [it.clothingName, it.description, it.colorName, it.variant, it.size].filter(Boolean).join(" "))
    .join(" | ");
}

export function matchesTokens(haystack, query) {
  const tokens = norm(query).split(" ").filter(Boolean);
  if (tokens.length === 0) return true;
  const h = norm(haystack);
  return tokens.every(t => h.includes(t));
}

// ↩️ รายการสินค้าที่คืนมา แบบสั้น ๆ พออ่านในบรรทัดเดียว
//    เช่น "K-12 แดง 2XL ×2 · K-11 ดำ L ×1"
//
// ทำไมต้องมี: เดิมทุกที่โชว์แค่ "คืน 3 ชิ้น -฿1,200" ซึ่งบอกไม่ได้ว่าของอะไร
// ตอนลูกค้าโทรมาถามว่าหักอะไร หรือตอนตรวจใบวางบิลก่อนส่ง ต้องเปิดใบรับคืนทีละใบ
// และใบวางบิลที่ส่งให้ลูกค้าก็ไม่มีรายการ ลูกค้าเลยเทียบไม่ได้ว่าหักตรงกับที่คืนไปไหม
export const returnItemLabel = (it) =>
  [it?.clothingName || it?.description || "(ไม่ระบุรุ่น)", it?.colorName, it?.size]
    .filter(Boolean).join(" ") + (Number(it?.qty) > 0 ? ` ×${Number(it.qty)}` : "");

export const returnItemsText = (r, max = 0) => {
  const items = (r?.items || []).filter(i => Number(i.qty) > 0);
  if (items.length === 0) return "";
  const labels = items.map(returnItemLabel);
  if (max > 0 && labels.length > max) {
    return labels.slice(0, max).join(" · ") + ` +อีก ${labels.length - max}`;
  }
  return labels.join(" · ");
};

// รายการสินค้าของใบรับคืนหลายใบรวมกัน — ใช้ตอนบิลใบเดียวมีของคืนหลายรอบ
export const returnsItemsText = (list = [], max = 0) =>
  returnItemsText({ items: list.flatMap(r => r?.items || []) }, max);

// snapshot รายการสินค้าลงเอกสาร — เก็บชื่อ/สี/ไซส์/ราคา ณ ตอนออกเอกสาร
// (กฎเหล็ก: เปลี่ยนชื่อรุ่นในคลังทีหลัง เอกสารที่ออกไปแล้วต้องไม่ขยับ)
export const snapshotReturnItems = (r) =>
  (r?.items || []).filter(i => Number(i.qty) > 0).map(i => ({
    clothingName: i.clothingName || i.description || "",
    colorName: i.colorName || "",
    size: i.size || "",
    qty: Number(i.qty) || 0,
    unitPrice: Number(i.unitPrice) || 0,
    // เลขบิลของบรรทัดนี้ — ใบรับคืนใบเดียวมีของหลายบิลได้
    // ลูกค้าต้องเทียบได้ว่าที่หักไปนั้นหักจากบิลไหนบ้าง
    invoiceNo: i.invoiceNo || r?.invoiceNo || "",
  }));

// จัดรายการคืนเป็นกลุ่มตามบิล — ใช้ตอนพิมพ์ใบวางบิลให้ลูกค้าเทียบทีละบิล
// คืน [{ no, text }] ; ใบที่มาจากบิลเดียวจะได้กลุ่มเดียว (เหมือนเดิมทุกประการ)
export function returnItemsByBill(r) {
  const groups = new Map();
  (r?.items || []).filter(i => Number(i.qty) > 0).forEach(i => {
    const no = i.invoiceNo || r?.invoiceNo || "";
    if (!groups.has(no)) groups.set(no, []);
    groups.get(no).push(i);
  });
  return [...groups.entries()].map(([no, items]) => ({ no, text: returnItemsText({ items }) }));
}

// 📏 คืนได้ไม่เกินที่ขายไป — คิดเป็นรายบรรทัดสินค้าของบิลต้นทาง
//
// ปัญหาจริงที่เจอ: บิล INV6909-0016 มี "K-11 แขนยาว แดง M" อยู่ 1 ตัว
// แต่หน้ารับคืนให้กรอกคืน 13 ตัวได้ ไม่มีอะไรค้าน ผลคือ
//   · ลดหนี้เกินของที่ขายไป 12 ตัว → ใบวางบิลหักเกิน = เสียเงินฟรี
//   · ของเข้าสต๊อกเกินจริง 12 ตัว → ยอดคลังเพี้ยนตามไปด้วย
//
// นับ "คืนแล้ว" จากใบรับคืนใบอื่นที่จับคู่บิลเดียวกันด้วย ไม่งั้นคืนทีละใบ
// หลาย ๆ ใบก็เกินได้อยู่ดี (ใบที่ยังไม่จับคู่บิลไม่นับ เพราะยังไม่ผูกกับบิลไหน)
export function returnableMap(invoice, returns = [], excludeId = "") {
  const keyOf = invoiceLineResolver(invoice);
  const m = new Map();
  const bump = (k, field, n) => {
    const cur = m.get(k) || { sold: 0, returned: 0 };
    cur[field] += n;
    m.set(k, cur);
  };
  (invoice?.items || []).forEach(it => bump(keyOf(it), "sold", num(it.qty)));
  returns.forEach(r => {
    if (!r || r.id === excludeId) return;          // แก้ใบเดิม ไม่ต้องนับตัวเอง
    // นับเฉพาะใบที่จับคู่บิลแล้ว
    //   · ใบที่ยกเลิก — ของถูกย้อนออกจากสต็อกและไม่มีการลดหนี้แล้ว ถ้ายังนับอยู่
    //     คนที่ยกเลิกใบทดสอบทิ้งจะคืนของชิ้นนั้นไม่ได้อีกเลย
    //   · ใบร่างที่ยังรอจับคู่ — ตอนนี้มีเลขบิลติดมาในรายการได้แล้ว ถ้านับด้วย
    //     จะกินโควตาทั้งที่ยังไม่มีการลดหนี้จริง
    if ((r.status || "") !== "จับคู่แล้ว") return;
    // นับทีละบรรทัด — ใบเดียวมีของหลายบิลได้ บรรทัดของบิลอื่นต้องไม่มากินโควตาบิลนี้
    (r.items || []).forEach(it => {
      if (!invoice?.id || lineInvoiceId(it, r) !== invoice.id) return;
      bump(keyOf(it), "returned", num(it.qty));
    });
  });
  m.forEach(v => { v.left = Math.max(0, v.sold - v.returned); });
  return m;
}

// ตรวจรายการคืน "ทีละบรรทัด กับบิลของบรรทัดนั้นเอง"
//   over      = คืนเกินที่ขายไป (ห้ามบันทึก)
//   notOnBill = ไม่มีบรรทัดนี้ในบิลที่ผูกไว้ (เตือน แต่ไม่ห้าม — ของอาจถูกลงบิลผิดใบจริง ๆ)
//   noBill    = ยังไม่ได้ระบุว่าบรรทัดนี้มาจากบิลไหน (จับคู่ไม่ได้จนกว่าจะระบุ)
//
// offBillTotal = เงินของบรรทัดที่ไม่มีในบิล รวมกัน
//   สิ้นเดือนใบวางบิลหักของคืนด้วย "ยอดเงินรวมระดับลูกค้า" ไม่ได้ไล่ดูรายบรรทัด
//   ยอดนี้จึงจะถูกหักออกจากที่ลูกค้าต้องจ่าย ทั้งที่ของชิ้นนั้นไม่ได้อยู่ในบิลใบไหน
//   ต้องคิดไว้ตั้งแต่ตอนรับของ เพราะหลังจากนั้นไม่มีใครรู้อีกแล้วว่าหักอะไรออกไป
//
// invoiceOf(id) ให้ผู้เรียกส่งมา เพราะบิลต้นทางอยู่คนละกอง (กองที่โหลดไว้ / ที่ดึงมาตามลูกค้า)
//
// สำคัญ: นับของที่กรอกค้างในฟอร์มนี้เข้าไปด้วย — กรอกรุ่นเดียวกันของบิลเดียวกัน 2 บรรทัด
// ถ้าเทียบแยกบรรทัดทั้งคู่จะผ่านทั้งคู่ รวมกันแล้วเกินโควตาโดยไม่มีอะไรค้าน
export function checkReturnLines(items = [], invoiceOf, returns = [], excludeId = "") {
  const maps = new Map();   // invoiceId → โควตาของบิลนั้น
  const keyOfs = new Map(); // invoiceId → ตัวแปลงกุญแจของบิลนั้น
  const used = new Map();   // invoiceId|บรรทัด → จำนวนที่กรอกไปแล้วในฟอร์มนี้
  const rows = items.map(it => {
    if (!(it?.clothingName || it?.clothingId) || !(num(it.qty) > 0)) return null;
    const invId = it.invoiceId || "";
    if (!invId) return { noBill: true };
    const inv = invoiceOf ? invoiceOf(invId) : null;
    if (!inv) return { noBill: true, unknownBill: true, invoiceNo: it.invoiceNo || "" };
    if (!maps.has(invId)) {
      maps.set(invId, returnableMap(inv, returns, excludeId));
      keyOfs.set(invId, invoiceLineResolver(inv));
    }
    const keyOf = keyOfs.get(invId);
    const info = maps.get(invId).get(keyOf(it));
    if (!info) return { notOnBill: true, invoiceNo: inv.invoiceNo || "", amount: num(it.qty) * num(it.unitPrice) };
    const k = invId + "|" + keyOf(it);
    const before = used.get(k) || 0;
    const q = num(it.qty);
    used.set(k, before + q);
    const left = Math.max(0, info.left - before);
    return { ...info, left, qty: q, over: q > left, invoiceNo: inv.invoiceNo || "" };
  });
  const offBillIdx = rows.map((r, i) => (r?.notOnBill ? i : -1)).filter(i => i >= 0);
  return {
    rows,
    hasOver: rows.some(r => r?.over),
    hasNoBill: rows.some(r => r?.noBill),
    offBillIdx,
    offBillTotal: offBillIdx.reduce((a, i) => a + num(items[i].qty) * num(items[i].unitPrice), 0),
  };
}
