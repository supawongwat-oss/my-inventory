import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import Catalog from './Catalog';
import reportWebVitals from './reportWebVitals';
import { installCrashHandlers } from './utils/crashLog';
import { ErrorBoundary, CrashWatch } from './components/CrashGuard';
import * as serviceWorkerRegistration from './serviceWorkerRegistration';

// 🛣️ Path-based routing — public catalog แยกจาก ERP
// ลูกค้าพิมพ์สั้น ๆ ได้: /c, /shop, /order (ทางลัดของ /catalog)
const path = window.location.pathname;
const CATALOG_ALIASES = ["/catalog", "/c", "/shop", "/order", "/สั่งของ"];
const norm = decodeURIComponent(path).replace(/\/+$/, "") || "/"; // ตัด / ท้าย
const isCatalog = CATALOG_ALIASES.includes(norm) || norm.startsWith("/catalog/");

// 🧯 ดักเหตุขัดข้องก่อนวาดหน้าแรก — ต้องติดตั้งก่อน ไม่งั้น error ตอนเปิดแอปจะหลุดไปเงียบ ๆ
installCrashHandlers();

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    {/* error ที่ไหนก็ตามเคยทำให้ React ถอดทั้งหน้าเป็นจอขาว — ตอนนี้ค้างไว้บอกสาเหตุแทน */}
    <ErrorBoundary>
      {isCatalog ? <Catalog /> : <App />}
    </ErrorBoundary>
    {/* ป้ายบันทึกเหตุขัดข้องมีไว้ให้คนในร้าน — หน้าสั่งของสาธารณะไม่ต้องเห็น */}
    {!isCatalog && <CrashWatch />}
  </React.StrictMode>
);

// 🚫 ไม่ register service worker — โปรเจกต์นี้ไม่มี workbox/PWA build
//    จึงไม่เคยมีไฟล์ service-worker.js จริง (เบราว์เซอร์ได้ 404 HTML → SyntaxError)
//    unregister() เพื่อล้างตัวเก่าที่อาจค้างในเครื่องผู้ใช้ + ล้าง cache
//    (SW ค้าง = เสิร์ฟไฟล์เก่า → deploy ใหม่ไม่มีผล, หน้าจอแสดงผลเพี้ยน)
serviceWorkerRegistration.unregister();
reportWebVitals();
