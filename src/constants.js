import { T } from "./theme";

export const INIT_USERS = [
  { id: 1, username: "admin",   password: "1234", name: "สมชาย ใจดี",    role: "admin",   avatar: "👑" },
  { id: 2, username: "manager", password: "1234", name: "สมหญิง รักงาน", role: "manager", avatar: "🧑‍💼" },
  { id: 3, username: "staff",   password: "1234", name: "วิชัย มานะ",    role: "staff",   avatar: "👷" },
];

export const ROLES = {
  admin:   { label:"ผู้ดูแลระบบ", color:T.amber,  canDelete:true,  canAdd:true,  canClear:true,  canManageUsers:true,  canManageCats:true  },
  manager: { label:"ผู้จัดการ",   color:T.blue,   canDelete:true,  canAdd:true,  canClear:false, canManageUsers:false, canManageCats:true  },
  staff:   { label:"พนักงาน",     color:T.green,  canDelete:false, canAdd:false, canClear:false, canManageUsers:false, canManageCats:false },
};

export const INIT_CATS = ["วัตถุดิบ","สินค้าสำเร็จ","บรรจุภัณฑ์"];
