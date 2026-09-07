import { T } from "./theme";

export const INIT_USERS = [
  { id: 1, username: "admin",   password: "1234", name: "สมชาย ใจดี",    role: "admin",   avatar: "👑" },
  { id: 2, username: "manager", password: "1234", name: "สมหญิง รักงาน", role: "manager", avatar: "🧑‍💼" },
  { id: 3, username: "staff",   password: "1234", name: "วิชัย มานะ",    role: "staff",   avatar: "👷" },
];

export const ROLES = {
  // 📃 canStatement — ออกใบวางบิล แยกออกจาก canIssueInvoice โดยตั้งใจ
  //    ใบวางบิลคือเอกสารที่บอกลูกค้าว่าต้องจ่ายเท่าไหร่ ออกซ้ำ = ทวงเงินสองรอบ
  //    เดิมใครออกบิลได้ก็ออกใบวางบิลได้ด้วยโดยอัตโนมัติ ทั้งที่เป็นงานคนละคนกัน
  //    แยกแล้วจะให้ "ดูได้ พิมพ์ซ้ำได้ แต่ออกใหม่ไม่ได้" ได้ (ปิดทั้งแท็บใช้ allowedTabs แทน)
  admin:   { label:"ผู้ดูแลระบบ", color:T.amber,  canDelete:true,  canAdd:true,  canClear:true,  canManageUsers:true,  canManageCats:true,  canIssueInvoice:true,  canCreateOrder:true,  canProduction:true,  canManageBOM:true,  canStatement:true  },
  manager: { label:"ผู้จัดการ",   color:T.blue,   canDelete:true,  canAdd:true,  canClear:false, canManageUsers:false, canManageCats:true,  canIssueInvoice:true,  canCreateOrder:true,  canProduction:true,  canManageBOM:true,  canStatement:true  },
  staff:   { label:"พนักงาน",     color:T.green,  canDelete:false, canAdd:false, canClear:false, canManageUsers:false, canManageCats:false, canIssueInvoice:false, canCreateOrder:false, canProduction:true,  canManageBOM:false, canStatement:false },
};

export const INIT_CATS = ["วัตถุดิบ","สินค้าสำเร็จ","บรรจุภัณฑ์","รองเท้า","อุปกรณ์กีฬา"];
// 🏷️ Tab → ใช้ filter categories หลายอันรวมเป็น tab เดียว (sync กับ App.js TAB_CATEGORIES)
