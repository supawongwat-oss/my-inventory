// firebase.js — อ่าน config จาก .env files
// .env.local       → ใช้ตอน npm start (ส่วนตัว)
// .env.production  → ใช้ตอน npm run build / deploy (บริษัท)
// ถ้าไม่มี env → fallback config (บริษัท)
import { initializeApp } from "firebase/app";
import {
  getFirestore, initializeFirestore,
  persistentLocalCache, persistentMultipleTabManager, memoryLocalCache,
} from "firebase/firestore";
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

// 💾 Offline cache — ใช้ API ใหม่ (localCache) แทน enableIndexedDbPersistence
// ⚠️ ตัวเก่า "ค้าง" ใน Safari โหมดส่วนตัว/ปิด storage (IndexedDB เปิดไม่ได้)
//    → หน้า catalog ค้างที่ "กำลังโหลด" ตลอดกาล ไม่มีทั้งข้อมูลและ error
//    ตัวใหม่รองรับหลายแท็บ + ถ้า IndexedDB ใช้ไม่ได้ก็ fallback เป็น memory ให้เอง
function createDb() {
  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch (e) {
    console.warn("[firebase] เปิด offline cache ไม่ได้ → ใช้ memory cache แทน:", e?.message || e);
    try {
      return initializeFirestore(app, { localCache: memoryLocalCache() });
    } catch {
      return getFirestore(app); // ตั้งค่าไปแล้วจากที่อื่น — ใช้ instance เดิม
    }
  }
}
export const db = createDb();
export const auth = getAuth(app);
export const storage = getStorage(app);

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
