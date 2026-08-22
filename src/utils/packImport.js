// 📥 นำเข้ารายการเข้ารอบแพ็ค — ตรรกะล้วน ไม่มี UI ไม่แตะ Firestore
//
// รับได้ 3 ทาง แต่แปลงเป็น RawRow[] ชุดเดียวกันหมด แล้วเข้าตัวจับคู่ตัวเดียวกัน:
//   1. ไฟล์ใบปะหน้า PDF ที่ลูกค้าส่งมาอยู่แล้ว  ← ทางหลัก (ดู utils/pdfLabels.js)
//   2. ข้อความที่ copy มาวาง (จากแชท LINE)
//   3. ไฟล์ Excel/CSV
//
// ── สิ่งที่เรียนจากใบปะหน้า Shopee ของจริง (9 ใบ) ─────────────────
// ข้อความบนใบเป็นแบบนี้:
//   "CAPPUCCINO เสื้อกีฬาแขนยาว รุ่น K11" + "สีแดง,M (อก38 ยาว26นิ้ว)"
// ส่วนคลังของเราเก็บเป็น "K-11 แขนยาว" สี "แดง" ไซส์ "M"
//
// ความยากที่เจอจริง — แต่ละข้อทำให้จับคู่พลาดได้ทั้งนั้น:
//   · รหัสรุ่นเขียนคนละแบบ  K11 ↔ K-11 · CPU125 ↔ CPU 125     → canonCode()
//   · "แขนยาว/แขนกุด/แขนสั้น" อยู่ในชื่อรุ่นของเรา ไม่ใช่ตัวเลือก
//     ถ้าจับด้วยรหัสอย่างเดียวจะได้ผิดตัว (K-11 กับ K-11 แขนยาว คนละรุ่น)  → sleeveOf()
//     และรุ่นที่ไม่มีคำว่าแขนอะไรเลย = แขนสั้น
//   · วรรณยุกต์หายตอนดึงจาก PDF  ม่วง→มวง · รุ่น→รุน · ท็อป↔ท๊อป      → stripTone()
//   · สระอำแตกเป็น 2 ตัว  ดํา → ต้อง NFC ก่อนถึงจะเท่ากับ ดำ
//   · สีติดกับชื่อสินค้าโดยไม่มีตัวคั่น  "โคตรถูก8ดำ,M"
//     → ไม่ใช้ regex แต่เทียบท้ายข้อความกับ "ชื่อสีที่รุ่นนั้นมีจริง"       → splitTailColor()
//   · ไซส์เขียนคนละระบบ  3L ↔ 3XL · XXL ↔ 2XL · "EUR: 41" / "เบอร์ 47"  → resolveSize()
//
// 🔒 หลักที่ยึด: ให้ "คลังของเรา" เป็นตัวตัดสินเสมอ ไม่ใช่รูปแบบข้อความ
//    และห้ามเดาแล้วลงเงียบ ๆ — แถวที่ไม่มั่นใจต้องโผล่ให้คนแก้ก่อน

// ── ทำข้อความให้เทียบกันได้ ─────────────────────────────────
const ZERO_WIDTH = /[​‌‍﻿]/g;
const THAI_DIGITS = { "๐": "0", "๑": "1", "๒": "2", "๓": "3", "๔": "4", "๕": "5", "๖": "6", "๗": "7", "๘": "8", "๙": "9" };
// วรรณยุกต์ไทยทุกแบบที่เจอจริง — ตัดทิ้งทั้งสองฝั่งตอนเทียบ
//   ็-๎ = วรรณยุกต์/ไม้ไต่คู้/นิคหิต/ทัณฑฆาต ปกติ
//   - = วรรณยุกต์ในย่านใช้ส่วนตัว (PUA) ที่ฟอนต์ไทยเก่าใช้วางวรรณยุกต์เยื้อง
//     ใบปะหน้า Shopee ใช้ย่านนี้จริง — "ม่วง" ออกมาเป็น ม + U+F70A + ว + ง
//     ถ้าไม่ตัด สีจะไม่มีวันตรงกับคลัง และไม่มีอะไรฟ้องให้รู้ด้วย
const TONE_MARKS = /[็-๎-]/g;

export function normText(s) {
  return String(s || "")
    .normalize("NFC")
    // ํ + า → ำ  — Unicode ไม่ประกอบให้ (ไม่ใช่ canonical composition)
    // แต่ใบปะหน้าเขียน "ดํา"/"น้ําเงิน" ซึ่งต้องเท่ากับ "ดำ"/"น้ำเงิน" ในคลัง
    .replace(/ํา/g, "ำ")
    .replace(ZERO_WIDTH, "")
    .replace(/ /g, " ")
    .replace(/[๐-๙]/g, (d) => THAI_DIGITS[d] || d)
    .replace(/[–—−]/g, "-")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// ใช้ตอน "เทียบ" เท่านั้น ไม่ใช้ตอนแสดงผล — ตัดวรรณยุกต์และช่องว่างทิ้งให้หมด
// ตัดวรรณยุกต์ → แล้วยุบสระอำเป็นสระอา
//   PDF เขียน "น้ำเงิน" เป็น น + นิคหิต + ไม้โท + สระอา (สลับลำดับ ประกอบกลับไม่ได้)
//   พอตัดวรรณยุกต์ทิ้งจะเหลือ "นาเงิน" ส่วนคลังเป็น "นำเงิน" → ต้องยุบ ำ→า ทั้งคู่ถึงจะเท่ากัน
// 👁️ ข้อความสำหรับ "ให้คนอ่าน" เท่านั้น — ห้ามใช้เทียบหรือทำกุญแจจำการจับคู่
//
// ใบปะหน้าบางใบฝังฟอนต์แบบตัดเฉพาะตัวที่ใช้ และไม่แนบตารางแปลงกลับเป็นตัวอักษร
// pdf.js จึงคืนรหัสดิบของฟอนต์นั้นมา ซึ่งไม่ใช่ตัวอักษรไทยจริง
// บนจอเลยขึ้นเป็นสี่เหลี่ยม: "รุ่น" → "ร□ุ□น" · "หุ้ม" → "ห□ุ□ม"
//
// ตัวจับคู่ไม่สนใจอยู่แล้ว (looseKey ตัดวรรณยุกต์ทิ้งก่อนเทียบ) แต่คนอ่านแล้วสะดุด
// และทำให้ไม่กล้ากดยืนยัน — ตรงนี้จึงตัดตัวที่แปลไม่ออกทิ้งเฉพาะตอนแสดงผล
// เหลือ "รุน" ซึ่งอ่านรู้เรื่องกว่า และยังเทียบกับของจริงด้วยตาได้
//
// ⚠️ ข้อความดิบยังถูกเก็บไว้ครบ — ใช้ทำกุญแจจำการจับคู่ ถ้าตัดตรงนี้ด้วยจะจำเพี้ยน
const KEEP = /[฀-๿ -~]/;   // ไทย + ASCII ที่พิมพ์ได้
export function displayText(s) {
  return [...String(s || "")]
    .filter(ch => KEEP.test(ch))
    .join("")
    .replace(/s+/g, " ")
    .trim();
}
export const looseKey = (s) =>
  normText(s).replace(TONE_MARKS, "").replace(/ำ/g, "า").replace(/\s+/g, "");

// รหัสรุ่น: ตัดทุกอย่างที่ไม่ใช่ตัวอักษร/ตัวเลข → "K-12" / "K 12" / "k12" ได้ "k12" เท่ากันหมด
export const canonCode = (s) => normText(s).replace(/[^a-z0-9ก-๙]/g, "");

// ── แขนเสื้อ — อยู่ในชื่อรุ่นฝั่งเรา แต่อยู่ในชื่อสินค้าฝั่งแพลตฟอร์ม ──
const SLEEVE_RE = /แขน\s*(ยาว|กุด|สั้น|กด|สน)/g;
export const stripSleeve = (s) => String(s || "").replace(SLEEVE_RE, " ");

const SLEEVES = [
  { id: "แขนยาว", keys: ["แขนยาว"] },
  { id: "แขนกุด", keys: ["แขนกุด", "แขนกด"] },
  { id: "แขนสั้น", keys: ["แขนสั้น", "แขนสน"] },
];
export function sleeveOf(text) {
  const k = looseKey(text);
  for (const s of SLEEVES) if (s.keys.some(x => k.includes(looseKey(x)))) return s.id;
  return "";
}

// ── ไซส์ ───────────────────────────────────────────────────
// แพลตฟอร์มเขียน 3L / XXL / "EUR: 41" / "เบอร์ 47" — ต้องแปลงเป็นของที่คลังมีจริง
const SIZE_ALIASES = {
  xs: "XS", s: "S", m: "M", l: "L", xl: "XL",
  xxl: "2XL", "2l": "2XL", "2xl": "2XL",
  xxxl: "3XL", "3l": "3XL", "3xl": "3XL",
  xxxxl: "4XL", "4l": "4XL", "4xl": "4XL",
  "5l": "5XL", "5xl": "5XL",
  free: "ฟรีไซส์", freesize: "ฟรีไซส์", "ฟรี": "ฟรีไซส์", "ฟรีไซส": "ฟรีไซส์",
};

// ดึงโทเคนไซส์ออกจากข้อความตัวเลือก เช่น "M (อก38 ยาว26นิ้ว)" → "M" · "EUR: 41 (26.5 CM.)" → "41"
export function extractSizeToken(text) {
  const t = normText(text);
  if (!t) return "";
  // รองเท้า: เอาเลข 2 หลักหลัง eur / เบอร์ ก่อน — ตัวเลขในวงเล็บเป็นเซนติเมตร ไม่ใช่ไซส์
  const shoe = t.match(/(?:eur|เบอร)\s*:?\s*(\d{2})/);
  if (shoe) return shoe[1];
  const head = t.split("(")[0].trim();          // ตัดวงเล็บอธิบายรอบอก/ความยาวทิ้ง
  const m = head.match(/\b(\d{1,2}xl|xx?x?x?l|[2-5]l|xs|s|m|l|xl|\d{2,3})\b/i);
  if (m) return m[1];
  if (/ฟรี|free/.test(head)) return "ฟรีไซส์";
  return head.split(/[\s,]+/).pop() || "";
}

// แปลงโทเคน → สตริงที่ "อยู่ใน sizesFor(item) จริง" เท่านั้น ไม่ตรง = null
// 🔒 ประตูสำคัญที่สุด: ตอนปิดรอบ applyPackRunStock เขียน stock[size] ตรง ๆ
//    ถ้าปล่อย "2xl" หรือ "XXL" ผ่านไป จะไปสร้างช่องสต็อกใหม่ข้าง ๆ "2XL" ตัวจริง
//    แล้วตัดสต็อกลงช่องผีโดยไม่มีใครเห็น
export function resolveSize(token, allowed = []) {
  const raw = String(token || "").trim();
  if (!raw || !allowed.length) return null;
  const want = normText(raw);
  const direct = allowed.find(s => normText(s) === want);
  if (direct) return direct;
  const aliased = SIZE_ALIASES[want.replace(/\s+/g, "")];
  if (aliased) {
    const hit = allowed.find(s => normText(s) === normText(aliased));
    if (hit) return hit;
  }
  const loose = allowed.find(s => looseKey(s) === looseKey(raw));
  return loose || null;
}

// ── สี ─────────────────────────────────────────────────────
// สีติดท้ายชื่อสินค้าโดยไม่มีตัวคั่น: "โคตรถูก8ดำ" → { name:"โคตรถูก8", color:"ดำ" }
// ตัดด้วยรายชื่อสีที่รุ่นนั้นมีจริง ไม่ใช่เดาจากรูปแบบข้อความ
export function splitTailColor(text, colorNames = []) {
  const t = String(text || "").trim();
  const k = looseKey(t);
  let best = null;
  for (const c of colorNames) {
    const ck = looseKey(c);
    if (!ck || !k.endsWith(ck)) continue;
    if (!best || ck.length > looseKey(best).length) best = c;   // สีชื่อยาวกว่าชนะ (ขาวทอง > ขาว)
  }
  if (!best) return { name: t, color: "" };
  const cut = looseKey(best).length;
  // ตัดจากข้อความจริงตามจำนวนตัวอักษรที่ตรงกันในรูปแบบ loose
  let i = t.length;
  while (i > 0 && looseKey(t.slice(i)).length < cut) i--;
  return { name: t.slice(0, i).trim(), color: best };
}

// ── ดัชนีคลัง — คำนวณครั้งเดียวตอนเปิดหน้าต่าง ไม่ใช่ต่อแถว ──
export function buildCatalogIndex(clothingItems = [], sizesFor) {
  return clothingItems
    .filter(it => (it.colors || []).length > 0)
    .map(it => {
      const model = it.model || it.name || "";
      return {
        item: it,
        id: it.id,
        model,
        modelKey: looseKey(model),
        // รหัสรุ่นล้วน ตัดคำว่าแขน...ออกแล้ว — "CPU 125 แขนกุด" → "cpu125"
        // ต้องตัด ไม่งั้นไม่มีวันตรงกับ "CPU125" ที่แพลตฟอร์มเขียน
        code: canonCode(stripSleeve(model)),
        sleeve: sleeveOf(model),
        colors: (it.colors || []).map((c, i) => ({ idx: i, name: c.colorName || "", key: looseKey(c.colorName || "") })),
        sizes: sizesFor ? sizesFor(it) : [],
      };
    });
}

// ── ให้คะแนนรุ่น ────────────────────────────────────────────
// ยึดสองอย่างคู่กันเสมอ: รหัสรุ่น + แขน
// รหัสตรงแต่แขนไม่ตรง = คนละรุ่นในคลังเรา ต้องไม่ได้คะแนนเต็ม
export function scoreModel(entry, productText, aliasId) {
  if (aliasId && entry.id === aliasId) return { score: 100, why: ["เคยจับคู่ไว้"], tier: "alias" };
  const pk = looseKey(productText);
  const why = [];
  let score = 0;

  // รหัสรุ่นในข้อความ — เทียบทั้งโทเคน ห้าม includes ดิบ ("k120" มี "k11"? ไม่ แต่ "cpu1250" มี "cpu125")
  const tokens = normText(productText).split(/[\s,()/]+/).filter(Boolean).map(canonCode);
  const codeHit = entry.code && tokens.some(t => t === entry.code);
  let tier = "";
  if (codeHit) { score = 78; tier = "code"; why.push(`รหัส ${entry.model.split(" ")[0]}`); }
  else if (entry.modelKey && pk.includes(entry.modelKey)) { score = 62; tier = "name"; why.push("ชื่อรุ่นอยู่ในข้อความ"); }
  else {
    // ชื่อรุ่นฝั่งเราอาจเป็นไทยล้วน เช่น "โคตรถูก8" — เทียบแบบตัดวรรณยุกต์
    const core = entry.modelKey.replace(/แขน(ยาว|กุด|สั้น|กด|สน)/g, "");
    if (core.length >= 3 && pk.includes(core)) {
      // เจอชื่อรุ่นเราเป็นก้อนย่อยในข้อความ — ยิ่งก้อนยาวยิ่งน่าเชื่อ
      // ("ถูก8" กับ "โคตรถูก8" เจอได้ทั้งคู่ในข้อความเดียว ต้องให้ตัวยาวชนะ)
      score = 52 + Math.min(14, core.length * 2);
      tier = "partial";
      why.push("ชื่อรุ่นใกล้เคียง");
    } else {
      // ชื่อรุ่นยาวและกระจายอยู่ในประโยค เช่น "รองเท้า สตั๊ด basic #1"
      // ↔ "Titan Zone รองเท้าสตั๊ด หุ้มข้อ รุ่น basic (รองท็อป)"
      // นับว่าคำสำคัญของรุ่นเราไปโผล่ในข้อความกี่คำ
      const parts = normText(entry.model).split(/[\s#()/]+/).map(looseKey).filter(x => x.length >= 2);
      if (parts.length < 2) return { score: 0, why: [] };
      const hit = parts.filter(x => pk.includes(x)).length;
      const ratio = hit / parts.length;
      if (ratio < 0.6) return { score: 0, why: [] };
      // ชั้นนี้อ่อนที่สุดเสมอ — คำอย่าง titan/zone เป็นคำแบรนด์ ไม่ได้ชี้ตัวสินค้า
      // ต้องแพ้ชั้น "เจอชื่อรุ่นเป็นก้อน" เสมอ ไม่งั้นแบรนด์เดียวกันจะแย่งกันเอง
      score = Math.round(34 + ratio * 16);
      tier = "tokens";
      why.push(`ตรง ${hit}/${parts.length} คำ`);
    }
  }

  const wantSleeve = sleeveOf(productText);
  const ourSleeve = entry.sleeve;
  // รุ่นที่ชื่อไม่มีคำว่าแขนอะไรเลย ถือเป็นแขนสั้น (คลังตั้งชื่อแบบนี้จริง เช่น "CPU 125")
  const ourEff = ourSleeve || "แขนสั้น";
  if (wantSleeve) {
    if (wantSleeve === ourEff) { score += 22; why.push(wantSleeve); }
    else score -= 30;                                  // รหัสตรงแต่คนละแขน = คนละตัว
  }
  return { score: Math.max(0, Math.min(100, score)), why, tier };
}

// ── จับคู่ 1 แถว ────────────────────────────────────────────
// aliases       = ที่ลูกค้า "รายนี้" เคยจับคู่ไว้      → เชื่อได้ ปล่อยผ่านอัตโนมัติ
// globalAliases = ที่ลูกค้า "รายอื่น" เคยจับคู่ไว้     → เติมให้ล่วงหน้า แต่ยังให้คนกดยืนยัน
//
// ทำไมต้องแยกสองชั้น: ลูกค้าทุกเจ้าขายของจากคลังเดียวกัน ถ้าแยกตามลูกค้าล้วน ๆ
// จะต้องสอนซ้ำทั้ง 10 เจ้าทั้งที่เป็นสินค้าตัวเดียวกัน — เสียเวลาเกินจำเป็น
// แต่จะเอาของรายอื่นมาใช้อัตโนมัติเลยก็ไม่ได้ เพราะคนละร้านอาจเรียกชื่อซ้ำกันแต่หมายถึงคนละตัว
// (เช่นต่างคนต่างเรียกรุ่นขายดีของตัวเองว่า "รุ่นฮิต")
// → รายอื่นสอนไว้ = เติมให้ กดยืนยันทีเดียวจบ · พอยืนยันแล้วครั้งต่อไปของรายนี้จะอัตโนมัติ
export function matchRow(row, index, aliases = {}, globalAliases = {}) {
  const productRaw = row.productText || "";
  const optionRaw = row.optionText || "";
  const pKey = `p:${looseKey(productRaw)}`;
  const aModel = aliases[pKey];
  const gModel = !aModel ? globalAliases[pKey] : null;

  // สีอาจอยู่ท้ายชื่อสินค้า หรืออยู่หน้าคอมมาในช่องตัวเลือก
  const optHead = optionRaw.split(",")[0] || "";
  const sizeToken = row.sizeText || extractSizeToken(optionRaw.includes(",") ? optionRaw.slice(optionRaw.indexOf(",") + 1) : optionRaw);

  const scored = index
    .map(entry => {
      const allColors = entry.colors.map(c => c.name);
      // ลองตัดสีออกจากทั้งสองที่ แล้วใช้อันที่หาสีเจอ
      const fromOpt = splitTailColor(optHead, allColors);
      const fromName = splitTailColor(productRaw, allColors);
      const colorName = row.colorText || fromOpt.color || fromName.color || "";
      const cleanProduct = fromName.color ? fromName.name : productRaw;
      let m = scoreModel(entry, cleanProduct, aModel?.clothingId);
      // รายอื่นเคยสอนไว้ — ดันขึ้นมาเป็นตัวเลือกแรก แต่ติดธง global ไว้ให้ต้องยืนยัน
      if (!aModel && gModel && entry.id === gModel.clothingId) {
        m = { score: 96, why: ["ลูกค้ารายอื่นเคยจับคู่แบบนี้"], tier: "global" };
      }
      if (m.score <= 0) return null;

      // 🔑 กุญแจของสีต้องผูกกับ "ข้อความดิบทั้งแถว" ไม่ใช่ชื่อสีที่แปลได้
      //    เพราะเคสที่ต้องจำที่สุดคือเคสที่แปลไม่ได้ (เช่น "สายรุ้ง/WHTMULTI" ไม่มีในคลัง)
      //    ถ้าใช้ชื่อสีที่แปลได้เป็นกุญแจ เคสนั้นจะได้กุญแจว่างเปล่า = จำไม่ได้ตลอดไป
      //    ใช้ลายเซ็นของแถว ซึ่งเป็นตัวเดียวกับที่ collapseRows ใช้ยุบแถวซ้ำอยู่แล้ว
      const cKey = `pc:${looseKey(productRaw)}##${looseKey(optionRaw)}`;
      const aColor = aliases[cKey] || globalAliases[cKey];
      let color = null, cWhy = "";
      if (aColor && entry.id === aColor.clothingId && entry.colors[aColor.colorIdx]) { color = entry.colors[aColor.colorIdx]; cWhy = "สีที่เคยจับคู่ไว้"; }
      else if (colorName) {
        const ck = looseKey(colorName);
        color = entry.colors.find(c => c.key === ck)
             || entry.colors.find(c => c.key && (ck.includes(c.key) || c.key.includes(ck)))
             || null;
        cWhy = color ? `สี${color.name}` : "";
      } else if (entry.colors.length === 1) { color = entry.colors[0]; cWhy = "รุ่นนี้มีสีเดียว"; }

      const size = resolveSize(sizeToken, entry.sizes);
      const conf = Math.round(m.score * 0.62 + (color ? 100 : 0) * 0.23 + (size ? 100 : 0) * 0.15);
      return {
        clothingId: entry.id, clothingName: entry.model,
        colorIdx: color ? color.idx : null, colorName: color ? color.name : colorName,
        size, sizeToken, confidence: conf,
        why: [...m.why, cWhy].filter(Boolean),
        modelScore: m.score, tier: m.tier,
      };
    })
    .filter(Boolean)
    // เรียงด้วยคะแนน "รุ่น" ก่อนเสมอ — เลือกตัวสินค้าให้ถูกก่อน แล้วค่อยว่ากันเรื่องสี/ไซส์
    // ถ้าเรียงด้วยคะแนนรวม รุ่นผิดที่บังเอิญเจอสีจะแซงรุ่นถูกที่ยังหาสีไม่เจอ
    .sort((a, b) => b.modelScore - a.modelScore || b.confidence - a.confidence);

  const top = scored[0] || null;
  const second = scored[1] || null;
  let status = "ไม่พบ";
  if (top) {
    if (top.colorIdx == null) status = "ต้องเลือกสี";
    else if (!top.size) status = "ต้องเลือกไซส์";
    else if (second && top.modelScore - second.modelScore < 8) status = "กำกวม";
    // ปล่อยผ่านเองได้เฉพาะตอนมีหลักฐานชั้นแข็ง — รหัสรุ่นตรง หรือเคยจับคู่ไว้
    // "ชื่อรุ่นใกล้เคียง" แปลว่าชื่อรุ่นเราเป็นแค่เศษหนึ่งของข้อความเขา ยังไม่พอให้ลงเอง
    // ชั้น global ไม่อยู่ในรายการนี้โดยตั้งใจ — ของรายอื่นต้องให้คนกดยืนยันเสมอ
    else if (top.confidence >= 85 && ["alias", "code", "name"].includes(top.tier)) status = "พร้อมลง";
    else status = "ให้ยืนยัน";
  }
  return { ...row, candidates: scored.slice(0, 6), pick: top, status };
}

// ── ยุบแถวซ้ำก่อนให้คนตรวจ ──────────────────────────────────
// 200 ออเดอร์มักเป็นสินค้าจริงแค่ ~30 แบบ — ยุบแล้วตารางที่ต้องตรวจเหลือ 30 แถว
// นี่คือความต่างระหว่างฟีเจอร์ที่พนักงานใช้จริงกับที่เลิกใช้
export function collapseRows(rows = []) {
  const by = new Map();
  rows.forEach((r, i) => {
    // ⚠️ แถวที่จำนวนอ่านไม่ชัวร์ (qty = null) ต้องอยู่แถวของตัวเอง ห้ามยุบรวมกับใคร
    //    ถ้ายุบ ค่าว่างจะถูกนับเป็น 0 แล้วกลืนหายไปในยอดของแถวที่มีจำนวนจริง
    //    คนตรวจจะไม่มีทางรู้เลยว่าตกไปกี่ชิ้น — ต้องเห็นเป็นแถวแยกเพื่อกรอกเอง
    const k = r.qty == null
      ? `?${i}`
      : `${looseKey(r.productText)}|${looseKey(r.optionText)}|${looseKey(r.colorText)}|${looseKey(r.sizeText)}`;
    if (!by.has(k)) by.set(k, { ...r, qty: r.qty == null ? null : 0, sources: [] });
    const g = by.get(k);
    if (r.qty != null) g.qty += Number(r.qty) || 0;
    g.sources.push(r);
  });
  return [...by.values()];
}

// รวมเป็นรายการสุดท้ายที่จะเขียนลงรอบ — ยุบซ้ำตาม key เดียวกับที่ packRun ใช้
export function toCountEntries(rows = []) {
  const by = new Map();
  rows.forEach(r => {
    const p = r.pick;
    if (!p || p.colorIdx == null || !p.size || r.status === "ข้าม") return;
    if (!(Number(r.qty) > 0)) return;      // จำนวนยังไม่ได้กรอก — ไม่นับ (ปุ่มลงถูกล็อกอยู่แล้ว นี่เป็นด่านสำรอง)
    const k = `${p.clothingId}|${p.colorIdx}|${p.size}`;
    if (!by.has(k)) by.set(k, { clothingId: p.clothingId, clothingName: p.clothingName, colorIdx: p.colorIdx, colorName: p.colorName, size: p.size, qty: 0 });
    by.get(k).qty += Number(r.qty) || 0;
  });
  return [...by.values()].filter(e => e.qty > 0);
}

// ลายนิ้วมือของชุดข้อมูล — ใช้เตือนเมื่อวางข้อความ/ลากไฟล์เดิมซ้ำ
export function fingerprintOf(entries = []) {
  const s = entries.map(e => `${e.clothingId}|${e.colorIdx}|${e.size}:${e.qty}`).sort().join(";");
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return `${entries.length}-${h.toString(36)}`;
}

// ── แกะข้อความที่ copy มาวาง (จากแชท LINE) ───────────────────
// บรรทัดที่เป็นเศษของแชทต้อง "นับแล้วโชว์" ไม่ใช่ทิ้งเงียบ
// ไม่งั้นพนักงานวาง 40 บรรทัดแล้วได้ 12 แถวโดยไม่รู้ว่าอีก 28 หายไปไหน
const JUNK_RE = [
  /^\d{1,2}[:.]\d{2}\s*(น\.|AM|PM)?$/i,
  /^(อ่านแล้ว|read|delivered|ส่งแล้ว)$/i,
  /^\[?(สติกเกอร์|รูปภาพ|ภาพ|photo|sticker|image|ไฟล์|file)\]?$/i,
  /^[\s\-=_.•·]+$/,
];
const QTY_RE = [
  /[x×]\s*(\d{1,3})\s*$/i,
  /จ[ํา]นวน\s*(\d{1,3})/,
  /(\d{1,3})\s*(ชิ้น|ตัว|คู่)\s*$/,
  /,\s*(\d{1,3})\s*$/,
];

export function extractQty(text) {
  for (const re of QTY_RE) {
    const m = String(text || "").match(re);
    if (m) return { qty: Math.max(1, Number(m[1]) || 1), rest: String(text).replace(re, "").trim() };
  }
  return { qty: 1, rest: String(text || "").trim() };
}

export function parsePaste(text) {
  const rows = [];
  let skipped = 0;
  String(text || "").split(/\r?\n/).forEach((lineRaw, i) => {
    const line = lineRaw.trim();
    if (!line) return;
    if (JUNK_RE.some(re => re.test(line)) || line.length < 4) { skipped++; return; }
    const { qty, rest } = extractQty(line);
    // แยกด้วยตัวคั่นที่แรงที่สุดที่มี — แท็บ > | > " - " > คอมมา
    const sep = rest.includes("\t") ? "\t" : rest.includes("|") ? "|" : rest.includes(" - ") ? " - " : "";
    let productText = rest, optionText = "";
    if (sep) {
      const parts = rest.split(sep).map(x => x.trim()).filter(Boolean);
      productText = parts[0] || rest;
      optionText = parts.slice(1).join(",");
    } else if (rest.includes(",")) {
      const i2 = rest.indexOf(",");
      productText = rest.slice(0, i2).trim();
      optionText = rest.slice(i2);
    }
    // ป้ายกำกับชัด ๆ เช่น "สี:แดง ไซส์:2XL" ชนะเสมอ
    const cm = rest.match(/สี\s*[:=]\s*([^\s,|]+)/);
    const sm = rest.match(/(?:ไซส|ไซซ|size|เบอร)\s*[:=]?\s*([^\s,|()]+)/i);
    rows.push({
      i, raw: line, productText, optionText,
      colorText: cm ? cm[1] : "", sizeText: sm ? sm[1] : "",
      qty,
    });
  });
  return { rows, skipped };
}

// ── แกะจากตาราง Excel/CSV (ผลจาก sheet_to_json แบบ header:1) ──
export const PACK_FIELDS = ["product", "option", "color", "size", "qty", "status", "ignore"];
export const PACK_FIELD_LABELS = {
  product: "ชื่อสินค้า", option: "ตัวเลือก (สี/ไซส์)", color: "สี", size: "ไซส์",
  qty: "จำนวน", status: "สถานะออเดอร์", ignore: "ไม่ใช้",
};
const HINTS = {
  product: ["ชื่อสินค้า", "สินค้า", "product", "item", "name", "รายการ"],
  option:  ["ตัวเลือก", "variation", "variant", "option", "sku"],
  color:   ["สี", "color", "colour"],
  size:    ["ไซส", "ไซซ", "size", "เบอร"],
  qty:     ["จำนวน", "จํานวน", "qty", "quantity", "amount", "ชิ้น"],
  status:  ["สถานะ", "status"],
};
export function guessPackField(header) {
  const h = normText(header);
  if (!h) return "ignore";
  for (const f of ["qty", "status", "size", "color", "option", "product"]) {
    if (HINTS[f].some(x => h.includes(normText(x)))) return f;
  }
  return "ignore";
}

// สถานะที่ไม่ควรนับ — ออเดอร์ยกเลิก/คืนเงินปนมาในไฟล์ที่ export ช่วงวันที่
const DEAD_STATUS = ["ยกเลิก", "cancel", "คืนเงิน", "refund", "ตีกลับ", "return", "failed"];
export const isDeadStatus = (s) => {
  const t = normText(s);
  return !!t && DEAD_STATUS.some(x => t.includes(normText(x)));
};

export function rowsFromSheet(aoa = [], mapping = {}) {
  const rows = [];
  let skipped = 0;
  aoa.slice(1).forEach((r, i) => {
    if (!r || r.every(c => String(c || "").trim() === "")) return;
    const get = (f) => {
      const col = Object.keys(mapping).find(k => mapping[k] === f);
      return col == null ? "" : String(r[col] ?? "").trim();
    };
    if (isDeadStatus(get("status"))) { skipped++; return; }
    const productText = get("product");
    if (!productText) { skipped++; return; }
    const qtyRaw = Number(get("qty"));
    rows.push({
      i, raw: r.join(" | "), productText,
      optionText: get("option"), colorText: get("color"), sizeText: get("size"),
      qty: Number.isFinite(qtyRaw) && qtyRaw > 0 ? Math.floor(qtyRaw) : 1,
    });
  });
  return { rows, skipped };
}
