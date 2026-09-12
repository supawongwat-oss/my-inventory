// 🧯 บันทึกเหตุ "แอปพัง / หน้าค้าง" ไว้ในเครื่อง
//
// ที่ผ่านมาไม่มีอะไรดักเลย — error ที่ไหนสักแห่งทำให้ React ถอดทั้งหน้าเป็นจอขาว
// แล้วไม่เหลือร่องรอยว่าพังตรงไหน ตามทีหลังได้แค่เดา
//
// เก็บลง localStorage เพราะต้องรอดข้ามการรีเฟรช — คนเจอปัญหาจะรีเฟรชทันที
// ถ้าเก็บไว้ในหน่วยความจำอย่างเดียว หลักฐานหายไปพร้อมกับหน้าที่พัง
const KEY = "cpu.crashLog";
const MAX = 20;          // เก็บ 20 เหตุการณ์ล่าสุดพอ — ไว้ดูว่าเกิดซ้ำแบบเดิมไหม
const CUT = 1500;        // ตัด stack ไม่ให้ยาวจน localStorage เต็ม

const nowText = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

export function getCrashLog() {
  try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; }
}

export function clearCrashLog() {
  try { localStorage.removeItem(KEY); } catch { /* โหมดส่วนตัว/ปิด storage — ไม่ต้องพัง */ }
}

export function recordCrash(kind, info = {}) {
  try {
    const list = getCrashLog();
    list.unshift({
      at: nowText(),
      kind,                                   // error | promise | freeze | render
      msg: String(info.msg || "").slice(0, 500),
      src: String(info.src || "").slice(0, 200),
      stack: String(info.stack || "").slice(0, CUT),
      page: (document.title || "").slice(0, 80),
      mem: memText(),
      at_ms: Date.now(),
    });
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch { /* เขียนไม่ได้ก็ต้องไม่ทำให้แอปพังซ้ำ */ }
}

// หน่วยความจำที่แท็บนี้ใช้อยู่ (Chrome เท่านั้น) — อาการค้างมักมาคู่กับตัวเลขนี้พุ่ง
function memText() {
  try {
    const m = performance?.memory;
    if (!m) return "";
    const mb = (v) => Math.round(v / 1048576);
    return `${mb(m.usedJSHeapSize)}/${mb(m.jsHeapSizeLimit)} MB`;
  } catch { return ""; }
}

// ข้อความก้อนเดียวสำหรับคัดลอกส่งให้คนแก้
export function crashLogText() {
  const ua = (navigator.userAgent || "").slice(0, 200);
  return [`CPU ERP — บันทึกข้อผิดพลาด (${getCrashLog().length} รายการ)`, ua, ""]
    .concat(getCrashLog().map((c, i) =>
      [`#${i + 1} [${c.kind}] ${c.at}${c.mem ? ` · หน่วยความจำ ${c.mem}` : ""}`,
       `   หน้า: ${c.page}`,
       `   ${c.msg}`,
       c.src ? `   ที่: ${c.src}` : "",
       c.stack ? `   ${c.stack.split("\n").slice(0, 8).join("\n   ")}` : ""
      ].filter(Boolean).join("\n")))
    .join("\n");
}

// ── ติดตั้งตัวดักทั้งหมด (เรียกครั้งเดียวตอนเปิดแอป) ──
export function installCrashHandlers() {
  window.addEventListener("error", (e) => {
    // error ของแท็ก <img>/<script> ที่โหลดไม่ขึ้นก็เข้ามาทางนี้ — ไม่ใช่แอปพัง ข้ามไป
    if (e?.target && e.target !== window && e.target.tagName) return;
    recordCrash("error", { msg: e.message, src: `${e.filename || ""}:${e.lineno || ""}`, stack: e.error?.stack });
  }, true);

  window.addEventListener("unhandledrejection", (e) => {
    recordCrash("promise", { msg: String(e.reason?.message || e.reason || ""), stack: e.reason?.stack });
  });

  // ⏱️ ตัวจับ "หน้าค้าง"
  //
  //    สองตัวบนดักได้เฉพาะ error ที่ถูกโยนออกมา แต่อาการ "ค้าง" ไม่ใช่ error —
  //    คือ main thread ถูกบล็อกหรือหน่วยความจำไม่พอ ไม่มีใครโยนอะไรทั้งนั้น
  //    จึงต้องวัดเอง: เต้นทุก 2 วิ ถ้ารอบไหนห่างเกิน 6 วิ แปลว่าหน้าไม่ตอบสนองไปนานขนาดนั้น
  //
  //    ที่ต้องกันไม่ให้บันทึกมั่ว:
  //      · เปิดกล่องพิมพ์ — Chrome บล็อกหน้าไว้จนกว่าจะปิดกล่อง ไม่ใช่อาการค้างจริง
  //      · แท็บอยู่เบื้องหลัง — เบราว์เซอร์หรี่ timer เองอยู่แล้ว
  //      · เครื่อง sleep — ช่องว่างจะเป็นนาที ๆ ตัดทิ้งด้วยเพดาน 120 วิ
  let last = Date.now();
  let printing = false;
  let printingSince = 0;
  const stopPrinting = () => { printing = false; last = Date.now(); };
  window.addEventListener("beforeprint", () => { printing = true; printingSince = Date.now(); });
  window.addEventListener("afterprint", stopPrinting);
  // ⚠️ afterprint ไม่ยิงเสมอไป — เคสจริง: เครื่องพิมพ์ไม่ได้เปิด กดยกเลิกตอนหน้าตัวอย่างยังไม่เสร็จ
  //    ถ้าพึ่ง afterprint ทางเดียว ธงนี้จะค้างเป็น true แล้วตัวจับอาการค้างตายไปทั้ง session
  //    จึงปลดธงด้วยทางอื่นด้วย: เลิกอยู่ในโหมดพิมพ์ · หน้าต่างได้โฟกัสกลับ · และเพดานเวลา
  try {
    window.matchMedia("print").addEventListener("change", (e) => { if (!e.matches) stopPrinting(); });
  } catch { /* เบราว์เซอร์เก่า */ }
  window.addEventListener("focus", () => { if (printing) stopPrinting(); });
  document.addEventListener("visibilitychange", () => { last = Date.now(); });
  setInterval(() => {
    const gap = Date.now() - last;
    last = Date.now();
    // กล่องพิมพ์เปิดค้างเกิน 3 นาทีถือว่าไม่ปกติ ปลดธงเองกันตัวจับตายค้าง
    if (printing && Date.now() - printingSince > 180000) stopPrinting();
    if (printing || document.hidden) return;
    if (gap > 6000 && gap < 120000) {
      recordCrash("freeze", { msg: `หน้าค้างไม่ตอบสนอง ${Math.round(gap / 1000)} วินาที` });
    }
  }, 2000);
}
