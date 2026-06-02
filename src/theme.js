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
