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

// คำนวณ "ไซส์ผลิต" จากไซส์ลูกค้า + offset เผื่อหด (+1 = ใหญ่ขึ้น 1 ไซส์)
export function getProductionSize(customerSize, offset) {
  const off = Number(offset) || 0;
  if (off === 0) return customerSize;
  const idx = SIZES_FOR_OFFSET.indexOf(String(customerSize || "").trim());
  if (idx < 0) return customerSize;
  const targetIdx = Math.min(SIZES_FOR_OFFSET.length - 1, Math.max(0, idx + off));
  return SIZES_FOR_OFFSET[targetIdx];
}

// คืน true ถ้าการเลื่อนไซส์ชน cap (เกิน 12XL)
export function isProductionSizeCapped(customerSize, offset) {
  const off = Number(offset) || 0;
  if (off <= 0) return false;
  const idx = SIZES_FOR_OFFSET.indexOf(String(customerSize || "").trim());
  if (idx < 0) return false;
  return idx + off > SIZES_FOR_OFFSET.length - 1;
}
// helper: คืน array ของไซส์ที่เหมาะกับ item (ตาม sizeType)
export const getSizesFor = (item) => (item && item.sizeType === "shoe") ? SHOE_SIZES : SIZES;

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
  const g = SIZE_GROUPS.find(g => g.sizes.includes(sz));
  return g ? g.key : null;
};

// 🔢 sizeRank — comparator-friendly. รองรับ 6,8,10,12 / S,M,L,XL / 2XL-9XL / และไซส์ custom
// ตัวเลขล้วน (kids) → 100-149
// S=200, M=210, L=220, XL=230
// 2XL=232, 3XL=233, ..., 9XL=239 (อิงเลขต่อจาก XL=230)
// ไซส์อื่นๆ ที่พิมพ์เองไม่ตรง pattern → 900 + alphabetical
export const sizeRank = (sz) => {
  if (!sz) return 999;
  const s = String(sz).trim().toUpperCase();
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

// 🧩 splitSizesIntoRows — แบ่ง sizes ออกเป็นแถว ตามกฎ:
//  - kids (numeric) ทุกตัวรวมแถวเดียว (max 4)
//  - regular S/M/L/XL รวมแถวเดียว (max 4)
//  - plus sizes (2XL+) ตัวละ 1 แถว
//  - ไซส์ custom string → ตัวละ 1 แถว
// items = [{ size, ...rest }] รับ object อะไรก็ได้ ตราบใดที่มี .size
export const splitSizesIntoRows = (items, maxPerRow = 4) => {
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
  // regs 4 ต่อแถว
  for (let i = 0; i < regs.length; i += maxPerRow) rows.push(regs.slice(i, i + maxPerRow));
  // plus + other ตัวละแถว
  plus.forEach(p => rows.push([p]));
  other.forEach(o => rows.push([o]));
  return rows;
};

export const getPriceForSize = (col, sz) => {
  if (!col) return 0;
  const k = sizeGroupKey(sz);
  if (col.salePrices && k && col.salePrices[k] != null && col.salePrices[k] !== "") {
    return Number(col.salePrices[k]) || 0;
  }
  return Number(col.salePrice) || 0;
};

export const PRESET_COLORS = [
  {name:"ดำ",hex:"#1a1a1a"},{name:"แดง",hex:"#ef4444"},{name:"ขาว",hex:"#f1f5f9"},
  {name:"ฟ้า",hex:"#38bdf8"},{name:"เขียว",hex:"#22c55e"},{name:"เหลือง",hex:"#fbbf24"},
  {name:"น้ำเงิน",hex:"#1d4ed8"},{name:"ชมพู",hex:"#f472b6"},{name:"ม่วง",hex:"#a855f7"},
  {name:"ส้ม",hex:"#f97316"},
];

export const MASTER_KEY = "CPU@2024";
