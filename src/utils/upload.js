// 📤 Storage Upload helper — Firebase Storage
import { storage } from "../firebase";
import { ref, uploadBytes, getDownloadURL, deleteObject, listAll } from "firebase/storage";

/**
 * Upload file ไปยัง Firebase Storage
 * @param {File} file - File object จาก input[type=file]
 * @param {string} folder - subfolder (เช่น "workpermit", "taxdocs/2026")
 * @param {string} [name] - optional custom filename (default: timestamp + original)
 * @returns {Promise<{url, path, name, size, type}>}
 */
export async function uploadFile(file, folder, name) {
  if (!file) throw new Error("ไม่มีไฟล์");
  const ts = Date.now();
  const safeName = (name || file.name || `file_${ts}`)
    .replace(/[^a-zA-Z0-9._\-฀-๿]/g, "_"); // safe + รองรับภาษาไทย
  const path = `${folder}/${ts}_${safeName}`;
  const fileRef = ref(storage, path);
  const snapshot = await uploadBytes(fileRef, file, {
    contentType: file.type || "application/octet-stream",
  });
  const url = await getDownloadURL(snapshot.ref);
  return {
    url,
    path,
    name: file.name,
    size: file.size,
    type: file.type,
    uploadedAt: ts,
  };
}

/**
 * ลบไฟล์จาก Storage
 * @param {string} path - path ที่เก็บไว้ตอน upload
 */
export async function deleteFile(path) {
  if (!path) return;
  try {
    await deleteObject(ref(storage, path));
  } catch (e) {
    // ไฟล์อาจถูกลบไปแล้ว — ignore
    console.warn("[upload] delete failed:", path, e?.code);
  }
}

/**
 * List ไฟล์ใน folder
 */
export async function listFiles(folder) {
  const folderRef = ref(storage, folder);
  const result = await listAll(folderRef);
  const items = await Promise.all(result.items.map(async (itemRef) => {
    const url = await getDownloadURL(itemRef);
    return { path: itemRef.fullPath, name: itemRef.name, url };
  }));
  return items;
}

// แปลง dataUrl (base64) → Blob เพื่ออัปโหลด
function dataUrlToBlob(dataUrl) {
  const [head, body] = String(dataUrl).split(",");
  const mime = (head.match(/data:(.*?);base64/) || [])[1] || "image/jpeg";
  const bin = atob(body);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

/**
 * อัปโหลดรูป (dataUrl ที่ compress แล้ว) → Firebase Storage
 * คืน { url, path } เพื่อเก็บใน Firestore doc แทน base64 (doc เล็กลง โหลดเร็ว)
 */
export async function uploadImage(dataUrl, folder = "images", { timeoutMs = 20000 } = {}) {
  if (!dataUrl || !String(dataUrl).startsWith("data:")) {
    return { url: dataUrl || "", path: "" }; // ไม่ใช่ base64 → คืนตามเดิม
  }
  const blob = dataUrlToBlob(dataUrl);
  const ext = (blob.type.split("/")[1] || "jpg").replace("jpeg", "jpg");
  const path = `${folder}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const fileRef = ref(storage, path);
  // ⏱️ กัน uploadBytes ค้างตลอดกาล (เช่น Storage ยังไม่เปิด/rules บล็อก/เน็ตหลุด)
  //    เกิน timeout → โยน error ให้ผู้เรียกจัดการ (fallback เก็บ base64 แทน)
  const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error("upload-timeout")), timeoutMs));
  const snap = await Promise.race([uploadBytes(fileRef, blob, { contentType: blob.type }), timeout]);
  const url = await getDownloadURL(snap.ref);
  return { url, path };
}

// format bytes → human readable
export function fmtBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
