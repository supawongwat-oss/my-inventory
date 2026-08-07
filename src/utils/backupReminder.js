// 💾 ตัวเช็คว่าถึงเวลาเตือน backup หรือยัง
//
// ทำไมต้องแยกออกมาจาก BackupRestore.js:
// หน้าแรกต้องเรียก shouldRemindBackup() ทันทีตอน login → ถ้าอยู่ในไฟล์เดียวกับ
// BackupRestore จะลาก xlsx (ใหญ่หลายร้อย KB) เข้ามาในโค้ดก้อนหลักด้วย
// ทั้งที่ตัวหน้า backup แทบไม่มีใครเปิด → แท็บเล็ตต้องโหลดฟรี ๆ ทุกครั้งที่เปิดแอป

export const BACKUP_TS_KEY = "cpu_erp_last_backup";

const daysSince = (ts) => (ts ? Math.floor((Date.now() - ts) / 86400000) : Infinity);

export const getLastBackupDate = () => {
  try { return Number(localStorage.getItem(BACKUP_TS_KEY)) || 0; }
  catch { return 0; }
};

// เช็คตอน login: ถ้า backup เก่ากว่า 7 วัน → return true
export const shouldRemindBackup = () => {
  try { return daysSince(getLastBackupDate()) >= 7; }
  catch { return false; }
};
