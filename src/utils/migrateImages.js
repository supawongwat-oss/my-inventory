// 🚚 Migration — ย้ายรูป base64 ที่ฝังใน customOrders ไป Firebase Storage (เก็บแค่ URL)
// รันครั้งเดียวโดยแอดมิน — idempotent (ข้ามใบที่ย้ายแล้ว รันซ้ำได้ปลอดภัย)
import { collection, getDocs, doc, updateDoc } from "firebase/firestore";
import { db } from "../firebase";
import { uploadImage } from "./upload";

const isBase64 = (s) => String(s || "").startsWith("data:");

export async function migrateCustomOrderImages(onProgress) {
  const snap = await getDocs(collection(db, "customOrders"));
  const docs = snap.docs;
  let migrated = 0, imagesMoved = 0, failed = 0;
  for (let i = 0; i < docs.length; i++) {
    const d = docs[i];
    const data = d.data();
    const imgs = Array.isArray(data.clothingImages) ? data.clothingImages : [];
    const needs = imgs.some(im => isBase64(im?.dataUrl)) || isBase64(data.clothingImage);
    onProgress && onProgress({ done: i + 1, total: docs.length, migrated, imagesMoved });
    if (!needs) continue;
    try {
      const newImgs = [];
      for (const im of imgs) {
        if (isBase64(im?.dataUrl)) {
          const { url, path } = await uploadImage(im.dataUrl, "customOrders");
          newImgs.push({ dataUrl: url, path, label: im?.label || "" });
          imagesMoved++;
        } else {
          newImgs.push({ dataUrl: im?.dataUrl || "", path: im?.path || "", label: im?.label || "" });
        }
      }
      await updateDoc(doc(db, "customOrders", d.id), {
        clothingImages: newImgs,
        clothingImage: newImgs[0]?.dataUrl || "",
      });
      migrated++;
    } catch (e) {
      console.warn("[migrateImages] failed for", d.id, e);
      failed++;
    }
  }
  return { total: docs.length, migrated, imagesMoved, failed };
}
