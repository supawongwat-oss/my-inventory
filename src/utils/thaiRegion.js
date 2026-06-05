// 🇹🇭 Thai Region Detection — แยกภาคจากที่อยู่
// ใช้ค้นชื่อจังหวัดในที่อยู่ → ระบุภาค

export const REGIONS = [
  { key: "north",     label: "ภาคเหนือ",          icon: "⛰️", color: "#3b5b8b" },
  { key: "northeast", label: "อีสาน",             icon: "🌾", color: "#b88600" },
  { key: "central",   label: "ภาคกลาง",           icon: "🏙️", color: "#3a7a52" },
  { key: "east",      label: "ตะวันออก",          icon: "🏖️", color: "#0891b2" },
  { key: "west",      label: "ตะวันตก",           icon: "🌅", color: "#d97706" },
  { key: "south",     label: "ภาคใต้",            icon: "🏝️", color: "#7c3aed" },
  { key: "unknown",   label: "ไม่ระบุภาค",        icon: "❓", color: "#52606d" },
];

// 77 จังหวัด แยกตามภาค
const PROVINCES = {
  north: ["เชียงใหม่","เชียงราย","ลำปาง","ลำพูน","แม่ฮ่องสอน","น่าน","พะเยา","แพร่","อุตรดิตถ์"],
  northeast: ["หนองคาย","หนองบัวลำภู","เลย","อุดรธานี","สกลนคร","นครพนม","มุกดาหาร","กาฬสินธุ์","ขอนแก่น","มหาสารคาม","ร้อยเอ็ด","ยโสธร","อำนาจเจริญ","อุบลราชธานี","ศรีสะเกษ","สุรินทร์","บุรีรัมย์","นครราชสีมา","โคราช","ชัยภูมิ","บึงกาฬ"],
  central: ["กรุงเทพ","กรุงเทพมหานคร","กทม","นนทบุรี","ปทุมธานี","สมุทรปราการ","พระนครศรีอยุธยา","อยุธยา","อ่างทอง","สิงห์บุรี","ลพบุรี","สระบุรี","นครนายก","นครปฐม","สุพรรณบุรี","ชัยนาท","ปราจีนบุรี","นครสวรรค์","อุทัยธานี","กำแพงเพชร","ตาก","สุโขทัย","พิษณุโลก","พิจิตร","เพชรบูรณ์","สมุทรสาคร","สมุทรสงคราม"],
  east: ["ชลบุรี","ระยอง","จันทบุรี","ตราด","ฉะเชิงเทรา","สระแก้ว"],
  west: ["กาญจนบุรี","ราชบุรี","เพชรบุรี","ประจวบคีรีขันธ์"],
  south: ["ชุมพร","ระนอง","สุราษฎร์ธานี","พังงา","ภูเก็ต","กระบี่","นครศรีธรรมราช","ตรัง","พัทลุง","สตูล","สงขลา","หาดใหญ่","ปัตตานี","ยะลา","นราธิวาส"],
};

/**
 * detectRegion: หา region key จากที่อยู่
 * @param {string} address
 * @returns {string} region key (north/northeast/central/east/west/south/unknown)
 */
export function detectRegion(address) {
  if (!address) return "unknown";
  const text = String(address).toLowerCase();
  // หาจังหวัดที่ match ในที่อยู่
  for (const [key, provinces] of Object.entries(PROVINCES)) {
    for (const p of provinces) {
      if (text.includes(p.toLowerCase())) return key;
    }
  }
  return "unknown";
}

/**
 * detectProvince: หาชื่อจังหวัดจากที่อยู่
 * @returns {string|null}
 */
export function detectProvince(address) {
  if (!address) return null;
  const text = String(address).toLowerCase();
  for (const provinces of Object.values(PROVINCES)) {
    for (const p of provinces) {
      if (text.includes(p.toLowerCase())) return p;
    }
  }
  return null;
}

// region meta lookup
export const regionMeta = (key) => REGIONS.find(r => r.key === key) || REGIONS[REGIONS.length - 1];
