// 🏐 แยก "อุปกรณ์กีฬา" ออกจาก "เสื้อผ้า" ตอนออกบิล
//
// ที่ร้านเปิดบิลอุปกรณ์กีฬาแยกเล่มกับบิลเสื้อผ้ามาตลอด — คนละใบ คนละเลขที่
// ระบบจึงต้องออกให้ 2 ใบเหมือนที่ทำมือ ไม่ใช่ยัดรวมใบเดียวแล้วให้ไปนั่งแยกเอาเอง
// (ในข้อมูลจริงมีบิลที่ของปนกันอยู่ 27 จาก 188 ใบ ส่วนใหญ่เป็นสนับแข้ง/รองเท้าที่ติดมากับออเดอร์เสื้อ)

import { looseKey } from "./search";

export const APPAREL = "apparel";
export const EQUIPMENT = "equipment";

export const GROUP_LABEL = { [APPAREL]: "เสื้อผ้า", [EQUIPMENT]: "อุปกรณ์กีฬา" };
export const GROUP_ICON = { [APPAREL]: "👕", [EQUIPMENT]: "🏐" };

// รุ่นไหนเป็นอุปกรณ์กีฬา — ติ๊กเองรายรุ่นที่หน้าคลัง
//
// รุ่นที่ยังไม่เคยติ๊ก (ไม่มีฟิลด์) เดาจาก sizeType ให้ก่อน เพราะฝั่ง shoe คือ
// รองเท้าสตั๊ด/ฟุตซอล/สนับแข้ง/ถุงเท้า ซึ่งเป็นอุปกรณ์อยู่แล้วทั้งหมด
// ใช้เป็นแค่ค่าตั้งต้นให้ไม่ต้องไล่ติ๊กใหม่ทั้งคลัง — พอมีคนติ๊กหรือเอาติ๊กออก
// ค่าที่คนติ๊กจะชนะการเดาเสมอ (ถุงเท้าบางรุ่นถูกใส่ไว้ฝั่ง apparel จึงเดาไม่ครบ)
export const isEquipmentModel = (c) =>
  c && c.isEquipment != null ? !!c.isEquipment : c?.sizeType === "shoe";

// 🔎 ตัวแปลง "แถวในบิล → หมวด"
//
// แถวส่วนใหญ่มี clothingId ให้เทียบตรง ๆ แต่แถวที่พิมพ์เอง/มาจากงาน custom
// ไม่มี id เลย จึงถอยไปเทียบด้วยชื่อรุ่นแบบทนสระ-วรรณยุกต์ (ชื่อในบิลเป็น snapshot
// ที่พิมพ์ไว้ตอนนั้น สะกดไม่ตรงกับทะเบียนเป๊ะ ๆ ก็มี)
// เทียบไม่ได้ = ให้เป็นเสื้อผ้า ซึ่งเป็นบิลหลัก — ของที่ระบบไม่รู้จักต้องไม่หลุดไปอยู่ใบรอง
export function makeGroupOf(clothingItems = []) {
  const byId = new Map();
  const byName = new Map();
  clothingItems.forEach((c) => {
    const eq = isEquipmentModel(c);
    byId.set(c.id, eq);
    const k = looseKey(c.model);
    // ชื่อซ้ำกันคนละรุ่น → ถือว่าเทียบด้วยชื่อไม่ได้ ตัดทิ้งไม่ให้เดามั่ว
    if (k) byName.set(k, byName.has(k) && byName.get(k) !== eq ? null : eq);
  });
  return (it) => {
    if (it?.clothingId && byId.has(it.clothingId)) return byId.get(it.clothingId) ? EQUIPMENT : APPAREL;
    const k = looseKey(it?.clothingName || it?.description || "");
    const hit = k ? byName.get(k) : undefined;
    return hit === true ? EQUIPMENT : APPAREL;
  };
}

// แบ่งรายการในบิลเป็น 2 กอง — คืนลำดับเดิมไว้ทั้งสองฝั่ง
export function splitItemsByGroup(items = [], clothingItems = []) {
  const groupOf = makeGroupOf(clothingItems);
  const apparel = [], equipment = [];
  items.forEach((it) => (groupOf(it) === EQUIPMENT ? equipment : apparel).push(it));
  return { apparel, equipment, mixed: apparel.length > 0 && equipment.length > 0 };
}

export const countQty = (items = []) =>
  items.reduce((s, it) => s + (Number(it.qty) || 0), 0);
