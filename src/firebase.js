// firebase.js — อ่าน config จาก .env files
// .env.local       → ใช้ตอน npm start (ส่วนตัว)
// .env.production  → ใช้ตอน npm run build / deploy (บริษัท)
// ถ้าไม่มี env → fallback config (บริษัท)
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

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
