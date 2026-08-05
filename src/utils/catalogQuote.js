// 💬 คำนวณยอด + สร้างข้อความแจ้งลูกค้า สำหรับออเดอร์จาก Catalog
//
// 🔑 ทำไมต้องมี: หน้า catalog ไม่แสดงราคา (ตั้งใจ — ไม่อยากให้คู่แข่งเห็น)
//    ทีมจึงต้องแจ้งยอดกลับเอง ซึ่งเดิมต้องโทร → เสียเวลา + ต้องรอลูกค้าว่าง
//    ไฟล์นี้คำนวณยอดให้ แล้วประกอบเป็นข้อความพร้อมส่งไลน์/แชท
//
// ราคาเก็บที่ clothing.colors[idx].salePrices[groupKey] (แยกตามกลุ่มไซส์)
// fallback: colors[idx].salePrice → clothing.salePrice → 0 (ไม่รู้ราคา)
import { SIZE_GROUPS } from "../theme";

const groupKeyOf = (size) => {
  const g = SIZE_GROUPS.find(g => g.sizes.includes(String(size)));
  return g ? g.key : null;
};

// ราคา/ตัว ของสี+ไซส์นี้ — คืน null ถ้าหาไม่เจอ (ต้องบอกผู้ใช้ ไม่ใช่คิดเป็น 0 เงียบ ๆ)
export function unitPriceFor(clothing, colorIdx, size) {
  if (!clothing) return null;
  const color = (clothing.colors || [])[Number(colorIdx) || 0];
  const gk = groupKeyOf(size);
  const fromGroup = gk ? Number(color?.salePrices?.[gk]) : 0;
  if (fromGroup > 0) return fromGroup;
  const fallback = Number(color?.salePrice) || Number(clothing.salePrice) || 0;
  return fallback > 0 ? fallback : null;
}

// รวมยอดทั้งออเดอร์
// คืน { entries, totalQty, totalAmount, unknownCount }
//   unknownCount = จำนวนแถวที่หาราคาไม่เจอ → UI ต้องเตือน ไม่ปล่อยให้ส่งยอดผิด
export function quoteCatalogOrder(order, clothingItems = []) {
  const rawEntries = (order?.items && order.items.length > 0)
    ? order.items
    : [{ itemId: order?.itemId, itemName: order?.itemName, lines: order?.lines || [] }];

  let totalQty = 0, totalAmount = 0, unknownCount = 0;
  const entries = rawEntries.map(entry => {
    const clothing = clothingItems.find(c => c.id === entry.itemId);
    const lines = (entry.lines || []).map(ln => {
      const qty = Number(ln.qty) || 0;
      const unit = unitPriceFor(clothing, ln.colorIdx, ln.size);
      const amount = unit != null ? unit * qty : 0;
      if (unit == null && qty > 0) unknownCount++;
      totalQty += qty;
      totalAmount += amount;
      return { ...ln, qty, unit, amount };
    });
    return {
      itemId: entry.itemId,
      itemName: entry.itemName || clothing?.model || clothing?.name || "(ไม่ระบุรุ่น)",
      lines,
      qty: lines.reduce((s, l) => s + l.qty, 0),
      amount: lines.reduce((s, l) => s + l.amount, 0),
    };
  });

  return { entries, totalQty, totalAmount, unknownCount };
}

const fmtI = (n) => Number(n || 0).toLocaleString("th-TH");

// ประกอบข้อความแจ้งยอด — พร้อมคัดลอกไปวางในไลน์
// สั้น ๆ พอ: ทักทาย → รายการ → รวมกี่ตัว (ยอดเงิน/ที่อยู่ พิมพ์เพิ่มเองได้ในหน้าต่างแก้ไข)
export function buildQuoteMessage(order, clothingItems = []) {
  const { entries, totalQty } = quoteCatalogOrder(order, clothingItems);
  const lines = [];

  lines.push(`สวัสดีค่ะ${order?.customerName ? ` คุณ${order.customerName}` : ""}`);
  lines.push("รับออเดอร์แล้วนะคะ");
  lines.push("");

  entries.forEach(e => {
    // รวมไซส์ของสีเดียวกันไว้บรรทัดเดียว: "สีกรม — S×10, M×15"
    const byColor = new Map();
    e.lines.forEach(l => {
      if (l.qty <= 0) return;
      const key = l.color || "-";
      if (!byColor.has(key)) byColor.set(key, []);
      byColor.get(key).push(`${l.size}×${l.qty}`);
    });
    byColor.forEach((sizes, color) => {
      lines.push(`• ${e.itemName} สี${color} — ${sizes.join(", ")}`);
    });
  });

  lines.push("");
  lines.push(`รวม ${fmtI(totalQty)} ตัว`);
  lines.push("");
  lines.push(`จัดส่ง ${order?.address || ""}`);

  return lines.join("\n");
}
