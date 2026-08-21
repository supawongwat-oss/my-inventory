// 📄 ก็อปไฟล์ worker ของ pdf.js เข้า public/ ก่อน build
//
// ทำไมต้องก็อปเอง แทนที่จะให้ webpack จัดการ:
//   เคยใช้ new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url)
//   webpack หยิบไฟล์มาให้จริง แต่ CRA เอาไฟล์ไปผ่าน Babel ด้วย
//   Babel แปลงแล้วใส่ import ของ @babel/runtime เป็น "path เต็มของเครื่องที่ build"
//   (/vercel/path0/node_modules/...) ซึ่งไม่มีอยู่บนเว็บเซิร์ฟเวอร์
//   → worker โหลดไม่ขึ้น แล้ว pdf.js ตกไปใช้ fake worker ซึ่งพังตามกันไปอีก
//
// ไฟล์ใน public/ ไม่ถูกแตะเลย — ถูกก็อปไปตรง ๆ ตอน build จึงยังเป็นไฟล์เดิมที่ใช้งานได้
// (ตัว worker ของ pdfjs เป็นไฟล์เดี่ยวจบในตัว ไม่ import อะไรข้างนอก)
const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "node_modules", "pdfjs-dist", "build", "pdf.worker.min.mjs");
const DEST_DIR = path.join(__dirname, "..", "public");
const DEST = path.join(DEST_DIR, "pdf.worker.min.mjs");

try {
  if (!fs.existsSync(SRC)) {
    console.warn("[copy-pdf-worker] ไม่พบ", SRC, "— ข้าม (อ่านใบปะหน้า PDF จะใช้ไม่ได้)");
    process.exit(0);
  }
  fs.mkdirSync(DEST_DIR, { recursive: true });
  fs.copyFileSync(SRC, DEST);
  const kb = Math.round(fs.statSync(DEST).size / 1024);
  console.log(`[copy-pdf-worker] ✓ public/pdf.worker.min.mjs (${kb} KB)`);
} catch (e) {
  // ไม่ทำให้ build ล้ม — ส่วนอื่นของแอปยังใช้ได้ปกติถึงจะอ่าน PDF ไม่ได้
  console.warn("[copy-pdf-worker] ก็อปไม่สำเร็จ:", e.message);
}
