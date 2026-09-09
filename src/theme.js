// === Professional Light Gray Theme ===
// โทนเทาอ่อน ดูเป็นทางการสำหรับองค์กร
export const T = {
  bg: "#f4f5f7",          // พื้นหลังหลัก เทาอ่อนนวล
  sidebar: "#ffffff",     // sidebar ขาว
  card: "#ffffff",        // card ขาว
  header: "#ffffff",      // header ขาว
  border: "#e2e5ea",      // เส้นเทาอ่อน
  text: "#1f2933",        // ตัวหนังสือหลัก เทาเข้ม (สำหรับพื้นขาว)
  sub: "#52606d",         // ตัวหนังสือรอง เทากลาง
  muted: "#9aa5b1",       // ตัวหนังสือจาง

  navActive: "#eef2f7",                       // bg ของเมนูที่เลือก
  navActiveBorder: "rgba(71,85,105,0.18)",    // เส้นเมนูที่เลือก
  navActiveText: "#1f2933",                   // ตัวหนังสือเมนูที่เลือก

  input: "#ffffff",
  inputBorder: "#cbd2d9",
  overlay: "rgba(15,23,42,0.45)",

  // สีฟังก์ชัน — โทนสุภาพ ไม่ฉูดฉาด
  blue: "#3b5b8b",        // น้ำเงินกรมสุภาพ
  indigo: "#475569",
  green: "#3a7a52",       // เขียวเข้มสุภาพ
  red: "#b94a48",         // แดงเข้มสุภาพ
  amber: "#b88600",       // ทองสุภาพ
  accent: "#3b5b8b",      // accent สีน้ำเงินกรม
  cyan: "#5e7a9e",
};

export const SIZES = ["6","8","10","12","S","M","L","XL","2XL","3XL","4XL","5XL"];
// 👟 ไซส์รองเท้า / อุปกรณ์กีฬา
export const SHOE_SIZES = ["36","37","38","39","40","41","42","43","44","45"];

// 🪡 ลำดับไซส์เสื้อผ้าครบ (สำหรับ offset เผื่อหด: เด็ก → ผู้ใหญ่ → XL ใหญ่สุด 12XL)
export const SIZES_FOR_OFFSET = ["6","8","10","12","S","M","L","XL","2XL","3XL","4XL","5XL","6XL","7XL","8XL","9XL","10XL","11XL","12XL"];

// helper: หา index ของไซส์โดยไม่สนตัวพิมพ์เล็กใหญ่ ("m" / "M" / " m " → idx ของ "M")
function findSizeIdx(s) {
  const norm = String(s || "").trim().toUpperCase();
  if (!norm) return -1;
  return SIZES_FOR_OFFSET.findIndex(x => x.toUpperCase() === norm);
}

// คำนวณ "ไซส์ผลิต" จากไซส์ลูกค้า + offset เผื่อหด (+1 = ใหญ่ขึ้น 1 ไซส์)
export function getProductionSize(customerSize, offset) {
  const off = Number(offset) || 0;
  if (off === 0) return customerSize;
  const idx = findSizeIdx(customerSize);
  if (idx < 0) return customerSize;
  const targetIdx = Math.min(SIZES_FOR_OFFSET.length - 1, Math.max(0, idx + off));
  return SIZES_FOR_OFFSET[targetIdx];
}

// คืน true ถ้าการเลื่อนไซส์ชน cap (เกิน 12XL)
export function isProductionSizeCapped(customerSize, offset) {
  const off = Number(offset) || 0;
  if (off <= 0) return false;
  const idx = findSizeIdx(customerSize);
  if (idx < 0) return false;
  return idx + off > SIZES_FOR_OFFSET.length - 1;
}
// helper: คืน array ของไซส์ที่เหมาะกับ item (ตาม sizeType)
export const getSizesFor = (item) => (item && item.sizeType === "shoe") ? SHOE_SIZES : SIZES;

// 🔤 ชื่อเรียกอื่นของไซส์ — ตั้งครั้งเดียวที่ ⚙️ ตั้งค่า → 📏 จัดการไซส์
//
// ที่ร้านเรียกไซส์เดียวกันหลายชื่อ: งานโปโล ไซส์ 12 ลูกค้าเขียนมาเป็น "XS" บ้าง "SS" บ้าง
// ถ้าปล่อยให้เป็นคนละสตริง ระบบนับเป็นคนละไซส์ทั้งระบบ:
//   · สต๊อกแยกเป็นคนละช่อง ของกระจาย
//   · getPriceForSize หา salePrices["XS"] ไม่เจอ → ตกไปใช้ราคากลางของรุ่น ไม่ใช่ราคากลุ่มเด็ก
//   · sizeRank ดัน XS/SS ไปท้ายตาราง ห่างจาก 12
//   · รับคืน/รอบแพ็ค จับคู่บรรทัดกับบิลไม่ได้เพราะสตริงไม่ตรง
//
// เก็บเป็น registry ระดับโมดูล เพราะ sizeRank / sizeGroupKey / getPriceForSize เป็นฟังก์ชัน
// บริสุทธิ์ที่ถูกเรียกจากทั่วทั้งแอป ส่ง map เข้าไปทีละจุดไม่ไหว — และนี่เป็นเรื่อง "แปลชื่อ"
// ล้วน ๆ ไม่ใช่สถานะธุรกิจ · App.js เรียก setSizeAliases ตอนโหลด settings/sizes
let SIZE_ALIASES = {};   // { "XS": "12", "SS": "12" } — คีย์เก็บเป็นตัวใหญ่เสมอ
export const setSizeAliases = (map) => {
  const next = {};
  Object.entries(map || {}).forEach(([k, v]) => {
    const from = String(k || "").trim().toUpperCase();
    const to = String(v || "").trim();
    // กันชี้กลับหาตัวเอง ซึ่งจะทำให้ canonSize วนไม่จบถ้าเผลอไปต่อสายทีหลัง
    if (from && to && from !== to.toUpperCase()) next[from] = to;
  });
  SIZE_ALIASES = next;
};
export const getSizeAliases = () => ({ ...SIZE_ALIASES });

// 📏 ทำไซส์ให้เหลือรูปเดียว — ใช้ก่อนเทียบ/จัดกลุ่ม/คีย์สต๊อกทุกครั้ง
//   1. ตัดช่องว่างหัวท้ายและช่องว่างซ้ำ
//   2. รูปแบบที่รู้จัก (ตัวเลข / NXL / S,M,L) ทำเป็นตัวใหญ่
//      — ในบิลจริงมี 5xL, 4xL, 4xl, 5xl, 6xl ปนอยู่แล้ว ซึ่งกลายเป็นคนละไซส์กับ 5XL/4XL/6XL
//   3. แปลชื่อเรียกอื่นเป็นไซส์จริง (XS → 12)
//   ไซส์ที่ตั้งชื่อเอง (ฟรีไซส์, รอบอก 40) ไม่แตะตัวพิมพ์ เพราะชื่อเป็นของผู้ใช้
export const canonSize = (sz) => {
  const raw = String(sz ?? "").trim().replace(/\s+/g, " ");
  if (!raw) return "";
  const u = raw.toUpperCase();
  const shaped = (/^\d+$/.test(u) || /^\d*XL$/.test(u) || /^[SML]$/.test(u)) ? u : raw;
  return SIZE_ALIASES[shaped.toUpperCase()] || shaped;
};

// 🔧 รวมไซส์มาตรฐาน + ไซส์ที่ผู้ใช้เพิ่มเอง (custom) แล้วเรียงลำดับให้ถูก
// base = SIZES หรือ SHOE_SIZES, extra = array ไซส์ที่เพิ่มจาก settings/sizes
export const mergeSizes = (base, extra = []) => {
  // เทียบด้วย canonSize — "SS" ที่เป็นชื่อเรียกอื่นของ "12" ต้องไม่โผล่มาเป็นอีกช่องหนึ่ง
  const seen = new Set(base.map(s => canonSize(s).toUpperCase()));
  const add = [];
  (extra || []).forEach(s => {
    const v = String(s || "").trim();
    if (!v) return;
    const k = canonSize(v).toUpperCase();
    if (seen.has(k)) return; // ซ้ำกับ base หรือกับตัวที่เพิ่งเพิ่มไป
    seen.add(k);             // ⚠️ ต้องจำไว้ด้วย ไม่งั้น extra ที่ซ้ำกันเองจะหลุดเข้ามาซ้ำ
    add.push(canonSize(v));
  });
  return [...base, ...add].sort(compareSizes);
};

// กลุ่มไซส์สำหรับตั้งราคา — แต่ละกลุ่มใช้ราคาเดียวกัน
export const SIZE_GROUPS = [
  { key: "kids", label: "ไซส์ 6-12", sizes: ["6","8","10","12"] },
  { key: "reg",  label: "ไซส์ S-XL", sizes: ["S","M","L","XL"] },
  { key: "2XL",  label: "ไซส์ 2XL",  sizes: ["2XL"] },
  { key: "3XL",  label: "ไซส์ 3XL",  sizes: ["3XL"] },
  { key: "4XL",  label: "ไซส์ 4XL",  sizes: ["4XL"] },
  { key: "5XL",  label: "ไซส์ 5XL",  sizes: ["5XL"] },
];

export const sizeGroupKey = (sz) => {
  const c = canonSize(sz);
  const g = SIZE_GROUPS.find(g => g.sizes.includes(c));
  return g ? g.key : null;
};

// 🔢 sizeRank — comparator-friendly. รองรับ 6,8,10,12 / S,M,L,XL / 2XL-9XL / และไซส์ custom
// ตัวเลขล้วน (kids) → 100-149
// S=200, M=210, L=220, XL=230
// 2XL=232, 3XL=233, ..., 9XL=239 (อิงเลขต่อจาก XL=230)
// ไซส์อื่นๆ ที่พิมพ์เองไม่ตรง pattern → 900 + alphabetical
export const sizeRank = (sz) => {
  if (!sz) return 999;
  // ผ่าน canonSize ก่อน — "XS" ต้องได้อันดับเดียวกับ "12" ไม่งั้นไปโผล่ท้ายตาราง
  const s = canonSize(sz).toUpperCase();
  // kids/numeric
  if (/^\d+$/.test(s)) return 100 + Math.min(49, Number(s));
  // standard adult
  if (s === "S") return 200;
  if (s === "M") return 210;
  if (s === "L") return 220;
  if (s === "XL") return 230;
  // plus sizes: NXL where N >= 2
  const m = /^(\d+)XL$/.exec(s);
  if (m) return 230 + Number(m[1]);
  // anything else — push to end alphabetically
  return 900 + (s.charCodeAt(0) || 0);
};
export const compareSizes = (a, b) => sizeRank(a) - sizeRank(b);

// 🧩 splitSizesIntoRows — แบ่ง sizes ออกเป็นแถว
// options.fillPlus = true (default for print) → plus sizes ไปต่อท้าย regs row ถ้ามีที่ว่าง
// options.fillPlus = false (สำหรับ invoice — เพราะ plus มักมีราคาต่างกัน)
export const splitSizesIntoRows = (items, maxPerRow = 4, options = {}) => {
  const { fillPlus = true } = options;
  const sorted = [...items].sort((a, b) => compareSizes(a.size, b.size));
  const isKid = (sz) => /^\d+$/.test(String(sz||""));
  const isReg = (sz) => ["S","M","L","XL"].includes(String(sz||"").toUpperCase());
  const isPlus = (sz) => /^\d+XL$/i.test(String(sz||"")) && !isReg(sz);
  const kids = sorted.filter(i => isKid(i.size));
  const regs = sorted.filter(i => isReg(i.size));
  const plus = sorted.filter(i => isPlus(i.size));
  const other = sorted.filter(i => !isKid(i.size) && !isReg(i.size) && !isPlus(i.size));
  const rows = [];
  // kids 4 ต่อแถว
  for (let i = 0; i < kids.length; i += maxPerRow) rows.push(kids.slice(i, i + maxPerRow));

  if (fillPlus) {
    // 🔗 รวม regs + plus เรียงเป็น 4 ต่อแถว → 2XL จะไปต่อท้าย XL ถ้ามีที่ว่าง
    const merged = [...regs, ...plus];
    for (let i = 0; i < merged.length; i += maxPerRow) rows.push(merged.slice(i, i + maxPerRow));
  } else {
    // โหมดเดิม — regs รวมแถว, plus 1/แถว (สำหรับ invoice form)
    for (let i = 0; i < regs.length; i += maxPerRow) rows.push(regs.slice(i, i + maxPerRow));
    plus.forEach(p => rows.push([p]));
  }

  // other 1 ต่อแถว
  other.forEach(o => rows.push([o]));
  return rows;
};

// 🧾 แถวสำหรับหน้าตั้งราคา — สร้างจาก "ไซส์จริงของรุ่น" ไม่ใช่ชุดมาตรฐานตายตัว
// ไซส์มาตรฐานจับเป็นกลุ่ม (6-12 / S-XL) · ไซส์อื่น (SS, 37-45, ฟรีไซส์) แยกแถวละไซส์
// bySize = true → แยกราคาทีละไซส์ทั้งหมด (เช่น สนับแข้ง S/M/L คนละราคา)
export const priceRowsForSizes = (sizes = [], bySize = false) => {
  if (bySize) return sizes.map(sz => ({ key: String(sz), label: `ไซส์ ${sz}`, sizes: [sz] }));
  const rows = [];
  const seen = new Set();
  sizes.forEach(sz => {
    const g = SIZE_GROUPS.find(gr => gr.sizes.includes(sz));
    const key = g ? g.key : String(sz);
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({
      key,
      label: g ? g.label : `ไซส์ ${sz}`,
      sizes: g ? g.sizes.filter(s => sizes.includes(s)) : [sz],
    });
  });
  return rows;
};

export const getPriceForSize = (col, sz) => {
  if (!col) return 0;
  const sp = col.salePrices || {};
  // ราคาที่ตั้งไว้ตรงตัวไซส์ก่อน (รองรับไซส์นอกมาตรฐาน เช่น 37 / ฟรีไซส์)
  //   ลองชื่อจริงก่อนชื่อที่กรอกมา — ถ้า "SS" เป็นชื่อเรียกอื่นของ "12" ต้องได้ราคาของ 12
  //   แล้วค่อยลองสตริงดิบ เผื่อของเก่าที่เคยตั้งราคาไว้ด้วยชื่อเรียกอื่นตรง ๆ
  const cz = canonSize(sz);
  if (cz && sp[cz] != null && sp[cz] !== "") return Number(sp[cz]) || 0;
  if (sz && sp[sz] != null && sp[sz] !== "") return Number(sp[sz]) || 0;
  const k = sizeGroupKey(sz);
  if (k && sp[k] != null && sp[k] !== "") return Number(sp[k]) || 0;
  return Number(col.salePrice) || 0;
};

export const PRESET_COLORS = [
  {name:"ดำ",hex:"#1a1a1a"},{name:"แดง",hex:"#ef4444"},{name:"ขาว",hex:"#f1f5f9"},
  {name:"ฟ้า",hex:"#38bdf8"},{name:"เขียว",hex:"#22c55e"},{name:"เหลือง",hex:"#fbbf24"},
  {name:"น้ำเงิน",hex:"#1d4ed8"},{name:"ชมพู",hex:"#f472b6"},{name:"ม่วง",hex:"#a855f7"},
  {name:"ส้ม",hex:"#f97316"},
];

export const MASTER_KEY = "CPU@2024";
