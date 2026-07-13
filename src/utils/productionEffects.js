// 🏭 Production side-effects — หักวัตถุดิบ + บวกสินค้าสำเร็จเข้าคลัง
// รวมเป็นที่เดียว ให้ทั้ง "ลากบนบอร์ด" (KanbanBoard) และ "กดปุ่มในล็อต" (LotDetailModal)
// ตัดสต๊อกเหมือนกัน — กันบั๊ก "ลากแล้วไม่ตัด กดปุ่มแล้วตัด"
import { collection, addDoc, updateDoc, doc, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase";
import { nowStr } from "./productionLots";

const fmtInt = (n) => Number(n || 0).toLocaleString("th-TH");

// หักวัตถุดิบ (หมึก/กระดาษ ฯลฯ) ตาม costSnapshot ของใบ (ทั้งใบ)
// เรียกครั้งเดียวตอนใบออกจาก "พิมพ์ลาย" ครั้งแรก — คุมด้วย order.materialsConsumed จากฝั่งผู้เรียก
export async function consumeMaterialsForOrder({ order, products = [], user, isCustom = false }) {
  if (!order || isCustom) return;
  const mats = order.costSnapshot?.materials || [];
  for (const m of mats) {
    const prod = products.find(p => p.id === m.productId);
    if (!prod) continue;
    const oldQty = Number(prod.qty) || 0;
    const newQty = oldQty - (Number(m.totalQty) || 0);
    await updateDoc(doc(db, "products", prod.id), {
      qty: newQty,
      lastUpdate: nowStr(),
      history: [
        { action: "ผลิต-ใช้วัตถุดิบ", by: user?.name || "", date: nowStr(), note: `${order.prodNo} · -${fmtInt(m.totalQty)} ${m.unit || prod.unit || ""}` },
        ...(prod.history || [])
      ]
    });
    await addDoc(collection(db, "transactions"), {
      type: "ผลิต-รับวัตถุดิบออก",
      code: prod.code, name: prod.name,
      qty: Number(m.totalQty) || 0,
      by: user?.name || "", date: nowStr(),
      note: `${order.prodNo} · ${order.clothingName}`,
      createdAt: serverTimestamp(),
    });
  }
}

// บวกสินค้าสำเร็จเข้าคลังตามล็อต — เรียกตอนล็อตเข้า "เข้าคลัง" (คุมด้วย lot.finishedStocked จากฝั่งผู้เรียก)
export async function stockFinishedForLot({ order, lot, clothingItems = [], user, isCustom = false }) {
  if (!order || isCustom) return;
  const clothing = clothingItems.find(c => c.id === order.clothingId);
  if (!clothing) return;
  const addMap = {};
  (lot.items || []).forEach(it => {
    const ci = Number(it.colorIdx) || 0;
    if (!addMap[ci]) addMap[ci] = {};
    addMap[ci][it.size] = (addMap[ci][it.size] || 0) + (Number(it.qty) || 0);
  });
  const newColors = (clothing.colors || []).map((c, idx) => {
    const adds = addMap[idx];
    if (!adds) return c;
    const stock = { ...(c.stock || {}) };
    Object.entries(adds).forEach(([size, qty]) => {
      stock[size] = (Number(stock[size]) || 0) + qty;
    });
    return { ...c, stock };
  });
  await updateDoc(doc(db, "clothing", clothing.id), { colors: newColors });
  for (const it of (lot.items || [])) {
    await addDoc(collection(db, "transactions"), {
      type: "ผลิต-รับเข้าคลัง",
      code: clothing.id,
      name: `${clothing.model} / ${it.colorName} / ${it.size}`,
      qty: Number(it.qty) || 0,
      by: user?.name || "", date: nowStr(),
      note: `${order.prodNo} · ${lot.lotId}`,
      category: "เสื้อผ้า",
      createdAt: serverTimestamp(),
    });
  }
}
