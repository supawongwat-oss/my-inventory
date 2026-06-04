// 📝 Audit Log helper
// บันทึก "ใครทำอะไรเมื่อไหร่" ลง collection `auditLog`
import { collection as fsCollection, addDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase";

export const AUDIT_ACTIONS = {
  CREATE:     "create",     // สร้างใหม่
  UPDATE:     "update",     // แก้ไข
  DELETE:     "delete",     // ลบ
  LOGIN:      "login",      // เข้าสู่ระบบ
  LOGOUT:     "logout",     // ออกจากระบบ
  RESTORE:    "restore",    // กู้คืน backup
  PERMISSION: "permission", // เปลี่ยนสิทธิ์
  PRICE:      "price",      // เปลี่ยนราคา
  STOCK:      "stock",      // รับ/จ่ายสต็อก
  STATUS:     "status",     // เปลี่ยนสถานะ (เช่น invoice payment)
  CLEAR:      "clear",      // ล้างข้อมูล bulk
  PRODUCTION_CREATE: "production_create", // สร้างใบสั่งผลิต
  PRODUCTION_STATUS: "production_status", // เลื่อนสถานะการผลิต
  PRODUCTION_CANCEL: "production_cancel", // ยกเลิกใบสั่งผลิต
  BOM_UPDATE:        "bom_update",        // สร้าง/แก้ BOM
};

// สี/ไอคอนสำหรับแต่ละ action
export const AUDIT_META = {
  create:     { icon: "➕", color: "#3a7a52", label: "สร้าง" },
  update:     { icon: "✏️", color: "#3b5b8b", label: "แก้ไข" },
  delete:     { icon: "🗑️", color: "#b94a48", label: "ลบ" },
  login:      { icon: "🔓", color: "#3b5b8b", label: "เข้าระบบ" },
  logout:     { icon: "🔒", color: "#52606d", label: "ออกระบบ" },
  restore:    { icon: "♻️", color: "#b88600", label: "กู้คืน" },
  permission: { icon: "🛡️", color: "#7c3aed", label: "สิทธิ์" },
  price:      { icon: "💰", color: "#b88600", label: "ราคา" },
  stock:      { icon: "📦", color: "#3b5b8b", label: "สต็อก" },
  status:     { icon: "🔔", color: "#3b5b8b", label: "สถานะ" },
  clear:      { icon: "💥", color: "#b94a48", label: "ล้าง" },
  production_create: { icon: "🏭", color: "#3a7a52", label: "สั่งผลิต" },
  production_status: { icon: "⚙️", color: "#3b5b8b", label: "สถานะผลิต" },
  production_cancel: { icon: "🛑", color: "#b94a48", label: "ยกเลิกผลิต" },
  bom_update:        { icon: "🧪", color: "#7c3aed", label: "แก้ BOM" },
};

/**
 * บันทึก audit log
 * @param {object} user - { id, name, username, role }
 * @param {object} payload
 * @param {string} payload.action - ค่าใน AUDIT_ACTIONS
 * @param {string} [payload.collection] - ชื่อ collection ที่เกี่ยวข้อง
 * @param {string} [payload.targetId] - id ของ document
 * @param {string} [payload.targetLabel] - ข้อความ human-readable เช่น "INV230601 - บริษัท ABC"
 * @param {object} [payload.before] - ข้อมูลก่อนแก้ (optional)
 * @param {object} [payload.after] - ข้อมูลหลังแก้ (optional)
 * @param {string} [payload.note] - หมายเหตุเสริม
 */
export async function logAudit(user, payload = {}) {
  if (!user) return;
  try {
    await addDoc(fsCollection(db, "auditLog"), {
      timestamp: serverTimestamp(),
      userId: String(user.id || ""),
      userName: user.name || "",
      userUsername: user.username || "",
      userRole: user.role || "",
      action: payload.action || "update",
      targetCollection: payload.collection || null,
      targetId: payload.targetId ? String(payload.targetId) : null,
      targetLabel: payload.targetLabel || null,
      before: sanitize(payload.before),
      after: sanitize(payload.after),
      note: payload.note || null,
    });
  } catch (e) {
    // ไม่ throw — audit log ไม่ควรขัด flow หลัก
    console.warn("[audit] failed to log:", e);
  }
}

// ตัด field ที่ใหญ่/ไม่จำเป็นออกจาก before/after
function sanitize(obj) {
  if (!obj || typeof obj !== "object") return obj || null;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    // ตัด field ใหญ่ๆ
    if (k === "image" || k === "logo") continue;
    if (k === "history" && Array.isArray(v) && v.length > 3) {
      out[k] = `[${v.length} entries]`;
      continue;
    }
    // ตัด string ยาว
    if (typeof v === "string" && v.length > 500) {
      out[k] = v.slice(0, 500) + "...";
      continue;
    }
    out[k] = v;
  }
  return out;
}
