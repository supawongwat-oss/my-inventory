// firebase.js — อ่าน config จาก .env files
// .env.local       → ใช้ตอน npm start (ส่วนตัว)
// .env.production  → ใช้ตอน npm run build / deploy (บริษัท)
// ถ้าไม่มี env → fallback config (บริษัท)
import { initializeApp } from "firebase/app";
import { getFirestore, enableIndexedDbPersistence } from "firebase/firestore";
import { getAuth, signInAnonymously, onAuthStateChanged } from "firebase/auth";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey:            process.env.REACT_APP_FB_API_KEY            || "AIzaSyA6W7VGiYAjstNkmyKfvPccatH6LWRxtfQ",
  authDomain:        process.env.REACT_APP_FB_AUTH_DOMAIN        || "cpu-erp.firebaseapp.com",
  projectId:         process.env.REACT_APP_FB_PROJECT_ID         || "cpu-erp",
  storageBucket:     process.env.REACT_APP_FB_STORAGE_BUCKET     || "cpu-erp.firebasestorage.app",
  messagingSenderId: process.env.REACT_APP_FB_MESSAGING_SENDER_ID|| "710178681062",
  appId:             process.env.REACT_APP_FB_APP_ID             || "1:710178681062:web:e61902474d003b7bca0b27",
  measurementId:     process.env.REACT_APP_FB_MEASUREMENT_ID     || "G-MLDJ4KE8T4"
};

// แสดงในตอน dev ว่าเชื่อม project ไหน (ป้องกันสับสน)
if (process.env.NODE_ENV === "development") {
  // eslint-disable-next-line no-console
  console.log(`%c🔥 Firebase: ${firebaseConfig.projectId}`, "color:#3b5b8b;font-weight:bold;font-size:14px");
}

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export const storage = getStorage(app);

// เปิด offline persistence — ข้อมูลยังใช้งานได้แม้เน็ตหลุด
enableIndexedDbPersistence(db).catch((err) => {
  if (err.code === 'failed-precondition') {
    // เปิดหลายแท็บพร้อมกัน — persistence ใช้ได้แค่แท็บเดียว
    console.warn('PWA offline: multiple tabs open, persistence disabled.');
  } else if (err.code === 'unimplemented') {
    // browser ไม่รองรับ
    console.warn('PWA offline: browser does not support persistence.');
  }
});

// ── Anonymous Auth ───────────────────────────────────────────
// แอปจะ sign in แบบ anonymous เงียบๆ ทันทีที่โหลดเสร็จ
// → Firestore Security Rules ตรวจ request.auth != null ได้
// → คนที่ไม่ได้เปิดผ่านแอปจริง (เช่นยิง API ตรง) จะถูก block
// ระบบ login UI ของเรา (admin/manager/staff) ยังทำงานเหมือนเดิม
signInAnonymously(auth).catch(err => {
  console.error("⚠️ Anonymous auth failed:", err.code, err.message);
});

// Promise ที่ resolve เมื่อ auth พร้อม — ให้ App.js รอก่อน render
export const authReady = new Promise((resolve) => {
  const unsub = onAuthStateChanged(auth, (u) => {
    if (u) {
      if (process.env.NODE_ENV === "development") {
        // eslint-disable-next-line no-console
        console.log(`%c🔐 Firebase Auth ready (anonymous uid: ${u.uid.slice(0,8)}...)`, "color:#3a7a52;font-weight:bold");
      }
      unsub();
      resolve(u);
    }
  });
  // fallback: ถ้า auth ไม่สำเร็จใน 10 วิ — resolve กับ null ให้ app ทำงานต่อได้
  setTimeout(() => { unsub(); resolve(null); }, 10000);
});
