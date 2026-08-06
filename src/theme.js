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

// 🔧 รวมไซส์มาตรฐาน + ไซส์ที่ผู้ใช้เพิ่มเอง (custom) แล้วเรียงลำดับให้ถูก
// base = SIZES หรือ SHOE_SIZES, extra = array ไซส์ที่เพิ่มจาก settings/sizes
export const mergeSizes = (base, extra = []) => {
  const seen = new Set(base.map(s => String(s).toUpperCase()));
  const add = [];
  (extra || []).forEach(s => {
    const v = String(s || "").trim();
    if (!v) return;
    const k = v.toUpperCase();
    if (seen.has(k)) return; // ซ้ำกับ base หรือกับตัวที่เพิ่งเพิ่มไป
    seen.add(k);             // ⚠️ ต้องจำไว้ด้วย ไม่งั้น extra ที่ซ้ำกันเองจะหลุดเข้ามาซ้ำ
    add.push(v);
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
  // ราคาที่ตั้งไว้ตรงตัวไซส์ก่อน (รองรับไซส์นอกมาตรฐาน เช่น SS / 37 / ฟรีไซส์)
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
