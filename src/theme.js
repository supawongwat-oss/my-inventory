export const T = {
  bg: "#020c1b", sidebar: "#030e20", card: "#061628", border: "#0d2848",
  text: "#cce7ff", sub: "#4a7fa5", muted: "#1e4060",
  header: "#020c1b", navActive: "rgba(14,165,233,0.12)", navActiveBorder: "rgba(56,189,248,0.3)",
  navActiveText: "#38bdf8", input: "#0a1f35", inputBorder: "#0e3058",
  overlay: "rgba(0,8,20,0.85)",
  blue: "#0ea5e9", indigo: "#6366f1", green: "#10b981", red: "#ef4444", amber: "#f59e0b",
  accent: "#38bdf8", cyan: "#22d3ee",
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
