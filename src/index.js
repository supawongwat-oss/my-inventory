import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import Catalog from './Catalog';
import reportWebVitals from './reportWebVitals';
import * as serviceWorkerRegistration from './serviceWorkerRegistration';

// 🛣️ Path-based routing — public catalog แยกจาก ERP
// ลูกค้าพิมพ์สั้น ๆ ได้: /c, /shop, /order (ทางลัดของ /catalog)
const path = window.location.pathname;
const CATALOG_ALIASES = ["/catalog", "/c", "/shop", "/order", "/สั่งของ"];
const norm = decodeURIComponent(path).replace(/\/+$/, "") || "/"; // ตัด / ท้าย
const isCatalog = CATALOG_ALIASES.includes(norm) || norm.startsWith("/catalog/");

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    {isCatalog ? <Catalog /> : <App />}
  </React.StrictMode>
);

// 🚫 ไม่ register service worker — โปรเจกต์นี้ไม่มี workbox/PWA build
//    จึงไม่เคยมีไฟล์ service-worker.js จริง (เบราว์เซอร์ได้ 404 HTML → SyntaxError)
//    unregister() เพื่อล้างตัวเก่าที่อาจค้างในเครื่องผู้ใช้ + ล้าง cache
//    (SW ค้าง = เสิร์ฟไฟล์เก่า → deploy ใหม่ไม่มีผล, หน้าจอแสดงผลเพี้ยน)
serviceWorkerRegistration.unregister();
reportWebVitals();
