import React, { useState, useRef, useEffect, useMemo, useCallback, lazy, Suspense } from "react";
import { db, authReady } from "./firebase";
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, setDoc, getDocs, writeBatch, runTransaction, serverTimestamp, query, orderBy, where, Timestamp, limit } from "firebase/firestore";
import { T, SIZES, SHOE_SIZES, getSizesFor, mergeSizes, PRESET_COLORS, MASTER_KEY, SIZE_GROUPS, priceRowsForSizes, getPriceForSize, compareSizes, splitSizesIntoRows } from "./theme";
import { INIT_USERS, ROLES, INIT_CATS } from "./constants";
import { BarcodeDisplay, Modal, MHead, Toast, Input, BtnPrimary, BtnSuccess, BtnDanger, BtnGhost, Badge, CardBox } from "./components/ui";
import LoginPage, { CompanyEditor } from "./components/LoginPage";
import { useFirestore } from "./hooks/useFirestore";
import { useFormDraft, timeAgoTH } from "./hooks/useFormDraft";
import { qcStatusOf, isCashRefund } from "./utils/returns";
import { findDuplicateInvoices } from "./utils/dupInvoice";
import InstallPWA from "./components/InstallPWA";
import { shouldRemindBackup, getLastBackupDate } from "./utils/backupReminder";
import { logAudit, AUDIT_ACTIONS } from "./utils/audit";
import { PRINT_FONT_SCALE, INVOICE_FONT_SCALE, scaleFontInElement, printElementById, printInvoiceCopies, downloadInvoicePdf } from "./utils/print";
import { PAYMENT_METHODS, docTypeLabel, docTypeLabelEn, itemLineTotal, calcInvoice, getPaidTotal, getRemaining, getPaidPct, ownedImagePathsOf } from "./utils/invoice";
import { compressImage } from "./utils/imageCompress";
import { uploadImage, deleteFile } from "./utils/upload";
import { REGIONS, detectRegion, detectProvince, regionMeta } from "./utils/thaiRegion";
import { reserveDocNo } from "./utils/docNumber";
import { withSearchKeys, withCustomerSearchKeys } from "./utils/searchKeys";

// 🚀 Code splitting — tabs โหลดเฉพาะตอนคลิกใช้งาน (ลด first-load bundle)
const ReportsTab = lazy(() => import("./tabs/ReportsTab"));
const SuppliersTab = lazy(() => import("./tabs/SuppliersTab"));
const StatementTab = lazy(() => import("./tabs/StatementTab"));
const AuditLogTab = lazy(() => import("./tabs/AuditLogTab"));
const StocktakeTab = lazy(() => import("./tabs/StocktakeTab"));
const EmployeeTab = lazy(() => import("./tabs/EmployeeTab"));
const TaxDocsTab = lazy(() => import("./tabs/TaxDocsTab"));
const CatalogInboxTab = lazy(() => import("./tabs/CatalogInboxTab"));
const ShareCatalogModal = lazy(() => import("./components/ShareCatalogModal"));
const ProductCatalogModal = lazy(() => import("./components/ProductCatalogModal"));
const PayrollTab = lazy(() => import("./tabs/PayrollTab"));
const ProductionHistoryTab = lazy(() => import("./tabs/ProductionHistoryTab"));
const OrdersTab = lazy(() => import("./tabs/OrdersTab"));
const InvoiceTab = lazy(() => import("./tabs/InvoiceTab"));
const ClothingInventoryTab = lazy(() => import("./tabs/ClothingInventoryTab"));
const BarcodeTab = lazy(() => import("./tabs/BarcodeTab"));
const CustomersTab = lazy(() => import("./tabs/CustomersTab"));
const ProductionTab = lazy(() => import("./tabs/ProductionTab"));
// 🎨 วงล้อสี — lazy load เฉพาะตอนเปิด modal เพิ่มสี
const HexColorPicker = lazy(() => import("react-colorful").then(m => ({ default: m.HexColorPicker })));

// 🚀 Modal ต่าง ๆ — โหลดตอนกดเปิดจริงเท่านั้น (ทุกตัวเรนเดอร์แบบมีเงื่อนไขอยู่แล้ว)
// ทำไม: เดิม import ตรง ๆ ทั้งหมดจึงถูกมัดรวมอยู่ในโค้ดก้อนหลัก แท็บเล็ตต้องดาวน์โหลด
//       + แปลงทุกครั้งที่เปิดแอป ทั้งที่บาง modal แทบไม่มีใครเปิด
//       ตัวหนักสุดคือ BarcodeScanner (ลาก @zxing มาด้วย) กับ BackupRestore (ลาก xlsx)
const BarcodeScanner = lazy(() => import("./components/BarcodeScanner"));
const BackupRestore = lazy(() => import("./components/BackupRestore"));
// 🧹 ล้างพื้นที่ Storage — ใช้นาน ๆ ครั้ง โหลดเฉพาะตอนเปิดแท็บ
const StorageCleanup = lazy(() => import("./components/StorageCleanup"));
const ReturnsTab = lazy(() => import("./tabs/ReturnsTab"));
const ReturnModal = lazy(() => import("./components/ReturnModal"));
const PrintCreditNoteModal = lazy(() => import("./components/PrintCreditNoteModal"));
const NewInvoiceModal = lazy(() => import("./components/NewInvoiceModal"));
const NewOrderModal = lazy(() => import("./components/NewOrderModal"));
const PrintInvoiceModal = lazy(() => import("./components/PrintInvoiceModal"));
const PrintOrderModal = lazy(() => import("./components/PrintOrderModal"));
const BarcodePrintModal = lazy(() => import("./components/BarcodePrintModal"));
const ImportCustomersModal = lazy(() => import("./components/ImportCustomersModal"));
const CustomerProfile = lazy(() => import("./components/CustomerProfile"));
const GlobalSearchModal = lazy(() => import("./components/GlobalSearchModal"));
const PaymentModal = lazy(() => import("./components/PaymentModal"));
const DeleteClothingConfirm = lazy(() => import("./components/DeleteClothingConfirm"));
// 🧾 ค่าเริ่มต้นการแสดงข้อมูลบริษัทบนบิล — ใช้ทุกที่ที่รีเซ็ต/เปิดฟอร์มออกบิลใหม่
// ตั้งให้ "ปลอดภัยไว้ก่อน" สำหรับลูกค้าที่ไม่รับ VAT — พนักงานกดเปิดเองเมื่อลูกค้าขอ
// 📅 วันที่เอกสาร (ออก/แก้ย้อนหลังได้) — ระบบเก็บเป็น "DD/MM/YYYY HH:mm"
//    ส่วนช่องกรอกใน UI ใช้ <input type="date"> ที่เป็น "YYYY-MM-DD" จึงต้องแปลงกลับไปมา
const pad2 = (n) => String(n).padStart(2, "0");
export const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`; };
// "DD/MM/YYYY HH:mm" → "YYYY-MM-DD" (รองรับปี พ.ศ. ในข้อมูลเก่า)
export const docDateToISO = (s) => {
  const part = String(s || "").split(" ")[0];
  const [d, m, y] = part.split("/").map(Number);
  if (!d || !m || !y) return todayISO();
  return `${y > 2500 ? y - 543 : y}-${pad2(m)}-${pad2(d)}`;
};
// "YYYY-MM-DD" → "DD/MM/YYYY HH:mm" — คงเวลาเดิมไว้ถ้าเป็นการแก้เอกสารเก่า
// วันนี้ = ใช้เวลาจริงตอนกด | ย้อนหลัง = 09:00 (ไม่มีเวลาจริงให้อ้าง)
export const isoToDocDate = (iso, prevDateStr = "") => {
  const [y, m, d] = String(iso || "").split("-").map(Number);
  const t = new Date();
  if (!y || !m || !d) return `${pad2(t.getDate())}/${pad2(t.getMonth()+1)}/${t.getFullYear()} ${pad2(t.getHours())}:${pad2(t.getMinutes())}`;
  const prevTime = String(prevDateStr || "").split(" ")[1];
  const isToday = iso === todayISO();
  const time = prevTime || (isToday ? `${pad2(t.getHours())}:${pad2(t.getMinutes())}` : "09:00");
  return `${pad2(d)}/${pad2(m)}/${y} ${time}`;
};
export const isoToJsDate = (iso) => { const [y, m, d] = String(iso || "").split("-").map(Number); return (y && m && d) ? new Date(y, m - 1, d) : new Date(); };

const INVOICE_DISPLAY_DEFAULTS = {
  showCompanyTaxId: false,  // ไม่ติ๊ก — กดเองถ้าลูกค้าต้องการเลขภาษี
  hideCompanyDetails: true, // ติ๊กไว้ — กดออกเองถ้าลูกค้าต้องการข้อมูลบริษัทเต็ม
  showJobImages: true,      // 🖼️ รูปงาน custom บนบิล — แสดงไว้ก่อน กดปิดเองถ้าไม่ต้องการ
};
// ต้องเป็นฟังก์ชัน — docDate ต้องเป็น "วันนี้" ตอนเปิดฟอร์ม ไม่ใช่ตอนโหลดแอป (เปิดค้างข้ามวันได้)
const invoiceDefaults = () => ({ ...INVOICE_DISPLAY_DEFAULTS, docDate: todayISO() });

// ── MAIN APP ───────────────────────────────────────────────────
export default function App() {
  // ── รอ Firebase Anonymous Auth พร้อมก่อน — เพื่อให้ Security Rules ผ่าน ──
  const [authChecked, setAuthChecked] = useState(false);
  useEffect(() => {
    authReady.then(() => setAuthChecked(true));
  }, []);

  const [activeTab, setActiveTab] = useState("dashboard");
  // 🔗 ลิงก์ภายในถึงเอกสารหนึ่งใบ — /?doc=INVxxxx เปิดแอปมาพร้อมค้นบิลใบนั้นให้เลย
  //    ใช้ส่งลิงก์ให้กันเองในทีมเท่านั้น — บิลที่พิมพ์ให้ลูกค้าไม่มี QR/ลิงก์ใด ๆ แล้ว
  //    พนักงานหาบิลด้วยการพิมพ์เลขที่บิลในช่องค้นหา (Ctrl+K)
  //    อ่านครั้งเดียวตอนโหลด แล้วลบ query ทิ้งจาก address bar ไม่ให้ค้างเวลากด refresh
  const [scannedDoc] = useState(() => {
    if (typeof window === "undefined") return "";
    try {
      const v = new URLSearchParams(window.location.search).get("doc") || "";
      if (v) window.history.replaceState({}, "", window.location.pathname);
      return v;
    } catch (e) { return ""; }
  });

  const { users, setUsers, products, setProducts, transactions, categories, setCategories, clothingItems, orders, ordersRange, setOrdersRange, ordersCapped, customers, invoices, invoicesRange, setInvoicesRange, invoicesCapped, catalogRange, setCatalogRange, catalogCapped, companyInfo, setCompanyInfo, roleLabels, auditLogs, loading, setLoading, suppliers, statements, productionOrders, boms, customOrders, employees, taxDocs, catalogOrders, attendance, payrollRuns, customSizes, pendingMixSales, usersLoaded, returns } = useFirestore(activeTab);
  // 📏 ไซส์ที่ใช้จริง = มาตรฐาน + ที่เพิ่มเอง
  // เปิดมาด้วยลิงก์ ?doc= → เด้งช่องค้นหาพร้อมเลขที่เอกสารให้เลย
  useEffect(() => { if (scannedDoc) setShowGlobalSearch(true); }, [scannedDoc]);
  const apparelSizes = useMemo(() => mergeSizes(SIZES, customSizes?.apparel), [customSizes]);
  const shoeSizes = useMemo(() => mergeSizes(SHOE_SIZES, customSizes?.shoe), [customSizes]);
  // 📏 ไซส์ของรุ่นหนึ่งๆ = ไซส์มาตรฐาน + ไซส์ที่เพิ่มในตั้งค่า (ใช้ทุกรุ่น) + ไซส์เฉพาะรุ่นนี้ (item.extraSizes)
  //    ไซส์เฉพาะรุ่นตั้งชื่อเองได้ เช่น "ฟรีไซส์", "รอบอก 40" — เพิ่มได้จากหน้าคลังเลย
  //    และตัดไซส์ที่ "ซ่อนไว้สำหรับรุ่นนี้" (item.hiddenSizes) ออก เช่น รุ่นผู้ใหญ่ไม่ต้องมีไซส์เด็ก
  const sizesFor = useCallback((item) => {
    const base = (item && item.sizeType === "shoe") ? shoeSizes : apparelSizes;
    const own = Array.isArray(item?.extraSizes) ? item.extraSizes : [];
    const hidden = Array.isArray(item?.hiddenSizes) ? item.hiddenSizes : [];
    const all = own.length ? mergeSizes(base, own) : base;
    return hidden.length ? all.filter(s => !hidden.includes(s)) : all;
  }, [apparelSizes, shoeSizes]);
  // ใช้แทน ROLES[role].label เพื่อให้ admin เปลี่ยนชื่อบทบาทได้
  const rLabel = (key) => roleLabels[key] || ROLES[key]?.label || key;

  // ── Session timeouts (ms) ─────────────────────────────────
  // Default (ไม่ติ๊ก "จำฉันไว้"): inactivity 3 วัน + hard expiry 7 วัน
  // "จำฉันไว้":                  inactivity OFF + hard expiry 90 วัน
  const SESSION_DEFAULT_INACTIVITY = 3 * 24 * 60 * 60 * 1000;  // 3 วัน
  const SESSION_DEFAULT_HARD       = 7 * 24 * 60 * 60 * 1000;  // 7 วัน
  const SESSION_REMEMBER_HARD      = 90 * 24 * 60 * 60 * 1000; // 90 วัน

  const checkSessionValid = () => {
    try {
      const expHard = Number(localStorage.getItem("cpu_erp_session_hard")) || 0;
      if (expHard && Date.now() >= expHard) return false;
      const remember = localStorage.getItem("cpu_erp_remember") === "1";
      if (!remember) {
        const lastAct = Number(localStorage.getItem("cpu_erp_last_activity")) || 0;
        if (lastAct && Date.now() - lastAct > SESSION_DEFAULT_INACTIVITY) return false;
      }
      return true;
    } catch (e) { return false; }
  };

  const clearSession = () => {
    try {
      localStorage.removeItem("cpu_erp_user");
      localStorage.removeItem("cpu_erp_session_hard");
      localStorage.removeItem("cpu_erp_last_activity");
      localStorage.removeItem("cpu_erp_remember");
    } catch (e) {}
  };

  const [user, setUser] = useState(() => {
    try {
      const saved = localStorage.getItem("cpu_erp_user");
      if (saved && checkSessionValid()) return JSON.parse(saved);
      clearSession();
    } catch (e) {}
    return null;
  });

  // เมื่อ login สำเร็จ — รับ rememberMe จาก LoginPage
  const handleLogin = (foundUser, rememberMe = false) => {
    try {
      localStorage.setItem("cpu_erp_user", JSON.stringify(foundUser));
      localStorage.setItem("cpu_erp_remember", rememberMe ? "1" : "0");
      const hardMs = rememberMe ? SESSION_REMEMBER_HARD : SESSION_DEFAULT_HARD;
      localStorage.setItem("cpu_erp_session_hard", String(Date.now() + hardMs));
      localStorage.setItem("cpu_erp_last_activity", String(Date.now()));
    } catch (e) {}
    setUser(foundUser);
    setProfileForm({ name: foundUser.name, username: foundUser.username, oldPass: "", newPass: "", confirmPass: "" });
    logAudit(foundUser, {
      action: AUDIT_ACTIONS.LOGIN,
      note: rememberMe ? "ติ๊กจำฉันไว้" : "session ปกติ",
    });
  };

  // logout — เคลียร์ session
  const handleLogout = () => {
    if (user) logAudit(user, { action: AUDIT_ACTIONS.LOGOUT });
    clearSession();
    setUser(null);
  };

  // sync user → localStorage (ไม่ override hard expiry)
  useEffect(() => {
    if (user) {
      try { localStorage.setItem("cpu_erp_user", JSON.stringify(user)); } catch (e) {}
    }
  }, [user]);

  // 🔄 sync สิทธิ์ของผู้ใช้ที่ล็อกอินอยู่ กับข้อมูลล่าสุดใน users collection (real-time)
  // แอดมินแก้สิทธิ์/เมนู → เครื่องพนักงานอัปเดตเองทันที ไม่ต้อง login ใหม่
  useEffect(() => {
    if (!user || !usersLoaded) return;
    const fresh = users.find(u => String(u.id) === String(user.id));
    if (!fresh) return; // ไม่พบ (เช่น seed admin ที่ไม่ได้อยู่ใน Firestore) → ไม่แตะ
    const keys = ["role", "allowedTabs", "permissions", "name", "avatar", "position", "username"];
    const changed = keys.some(k => JSON.stringify(fresh[k]) !== JSON.stringify(user[k]));
    if (changed) setUser(prev => ({ ...prev, ...Object.fromEntries(keys.map(k => [k, fresh[k]])) }));
  }, [users, usersLoaded, user]);

  // Auto-reload เมื่อมี deploy ใหม่ — เช็คตอน tab กลับมา visible
  // เทียบ hash ของ main JS จาก /asset-manifest.json
  useEffect(() => {
    let initialHash = null;
    const fetchHash = async () => {
      try {
        const res = await fetch("/asset-manifest.json?t=" + Date.now(), { cache: "no-store" });
        if (!res.ok) return null;
        const j = await res.json();
        return (j.files && (j.files["main.js"] || j.files["main.css"])) || null;
      } catch (e) { return null; }
    };
    fetchHash().then(h => { initialHash = h; });

    const onVisible = async () => {
      if (document.visibilityState !== "visible") return;
      if (!initialHash) { initialHash = await fetchHash(); return; }
      const current = await fetchHash();
      if (current && current !== initialHash) {
        // มีเวอร์ชันใหม่ — reload (ผู้ใช้กำลังกลับมาที่ tab พอดี ไม่เสียงานกลางคัน)
        try { window.location.reload(); } catch (e) {}
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  // Activity tracking — อัพเดท last_activity ทุกครั้งที่มี user interaction
  useEffect(() => {
    if (!user) return;
    const updateActivity = () => {
      try { localStorage.setItem("cpu_erp_last_activity", String(Date.now())); } catch (e) {}
    };
    // throttle 5 วิ — ไม่อัพเดททุก event เพราะกินทรัพยากร
    let last = 0;
    const throttled = () => {
      const now = Date.now();
      if (now - last > 5000) { last = now; updateActivity(); }
    };
    window.addEventListener("mousedown", throttled);
    window.addEventListener("keydown", throttled);
    window.addEventListener("touchstart", throttled);
    window.addEventListener("scroll", throttled, { passive: true });
    return () => {
      window.removeEventListener("mousedown", throttled);
      window.removeEventListener("keydown", throttled);
      window.removeEventListener("touchstart", throttled);
      window.removeEventListener("scroll", throttled);
    };
  }, [user]);

  // เช็ค session ทุก 60 วิ — ถ้าหมดอายุ → auto logout (เงียบๆ ไม่มี alert)
  useEffect(() => {
    if (!user) return;
    const t = setInterval(() => {
      if (!checkSessionValid()) {
        clearSession();
        setUser(null);
      }
    }, 60000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);
  const [selectedCat, setSelectedCat] = useState("ทั้งหมด");
  const [search, setSearch] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(typeof window!=="undefined"?window.innerWidth>900:true);
  const [expandedGroups, setExpandedGroups] = useState({ warehouse:true, billing:true, adminhub:true });
  useEffect(()=>{
    const onResize=()=>{ if(window.innerWidth<=900) setSidebarOpen(false); };
    window.addEventListener("resize",onResize);
    return ()=>window.removeEventListener("resize",onResize);
  },[]);




  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [showDeleteUserConfirm, setShowDeleteUserConfirm] = useState(null);
  const [showAllPasswords, setShowAllPasswords] = useState(false);
  const [visiblePasswords, setVisiblePasswords] = useState({});
  const [userRoleFilter, setUserRoleFilter] = useState("ทั้งหมด"); // ทั้งหมด/admin/manager/staff
  const [tabAccessModal, setTabAccessModal] = useState(null); // user object
  const [pwSessionExp, setPwSessionExp] = useState(0); // เวลาหมดอายุ session ดูรหัส
  const [authPrompt, setAuthPrompt] = useState(null); // {action, label}
  const [authInput, setAuthInput] = useState("");
  const [authErr, setAuthErr] = useState("");

  // Re-auth ก่อนเปิดดูรหัสผ่าน — session 5 นาที
  const requireAuth = (action, label="ดูรหัสผ่าน") => {
    if (Date.now() < pwSessionExp) { action(); return; }
    setAuthInput(""); setAuthErr("");
    setAuthPrompt({ action, label });
  };
  const handleAuthConfirm = () => {
    if (authInput !== user.password) { setAuthErr("รหัสผ่านไม่ถูกต้อง"); return; }
    setPwSessionExp(Date.now() + 5*60*1000); // 5 นาที
    const act = authPrompt.action;
    setAuthPrompt(null); setAuthInput(""); setAuthErr("");
    act();
  };
  // 🔒 เมนูที่ต้องใส่รหัสแอดมินก่อนเข้า (จัดการผู้ใช้)
  const LOCKED_TABS = ["users"];
  const guardedSetActiveTab = (id) => {
    if (LOCKED_TABS.includes(id) && user.role === "admin" && Date.now() >= pwSessionExp) {
      requireAuth(() => setActiveTab(id), "ใส่รหัสแอดมินเพื่อเข้า “จัดการผู้ใช้”");
      return;
    }
    setActiveTab(id);
  };
  const [newUser, setNewUser] = useState({ name:"", username:"", password:"", confirmPassword:"" });
  const [addUserErr, setAddUserErr] = useState("");
  const [addUserSuccess, setAddUserSuccess] = useState(false);

  // modals
  // ── Clothing state ───────────────────────────────────────────

  // ── Orders & Customers state ──────────────────────────────────


  const [showNewOrder, setShowNewOrder] = useState(false);
  const [freeItemForm, setFreeItemForm] = useState({ name:"", colorName:"", size:"", qty:"" });
  const [freeItemCutStock, setFreeItemCutStock] = useState(true);
  const [collapsedOrderDates, setCollapsedOrderDates] = useState({});
  const [collapsedOrderMonths, setCollapsedOrderMonths] = useState({}); // 📅 พับเดือน
  const [collapsedInvoiceDates, setCollapsedInvoiceDates] = useState({});
  const [collapsedInvoiceMonths, setCollapsedInvoiceMonths] = useState({});
  const [selectedInvoices, setSelectedInvoices] = useState(new Set()); // 🔗 เลือกบิลเพื่อรวม
  const [selectedOrders, setSelectedOrders] = useState(new Set()); // 🔗 เลือกใบสั่งของเพื่อออกบิลรวม
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [showImportCustomers, setShowImportCustomers] = useState(false);
  const [showShareCatalog, setShowShareCatalog] = useState(false); // 📱 QR/ลิงก์สั่งของให้ลูกค้า
  const [productCatalogItem, setProductCatalogItem] = useState(null); // 🛍️ หน้าร้าน: แบรนด์/รายละเอียด/ไซส์ที่ขาย
  const [brandFilter, setBrandFilter] = useState(""); // "" = ทุกแบรนด์, "__none__" = ยังไม่ตั้ง
  const [showPrintOrder, setShowPrintOrder] = useState(null);
  const [showGlobalSearch, setShowGlobalSearch] = useState(false); // 🔎 ค้นหาทั้งระบบ (Ctrl+K)
  // ⌨️ Ctrl/Cmd + K เปิดค้นหาได้ทุกหน้า — ไม่ต้องเลื่อนหาปุ่ม
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) { e.preventDefault(); setShowGlobalSearch(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const [editingOrderId, setEditingOrderId] = useState(null); // null = สร้างใหม่, string = แก้ไข
  const [orderForm, setOrderForm] = useState({
    customerId: "", customerName: "", customerPhone: "", customerAddress: "",
    shipping: "", note: "", items: [], deferStockCut: false
  });
  const [newCustomerForm, setNewCustomerForm] = useState({ name:"", phone:"", address:"" });
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerRegion, setCustomerRegion] = useState("ทั้งหมด"); // filter ภาค
  const [orderItemForm, setOrderItemForm] = useState({ clothingId:"", colorIdx:"", size:"", qty:"" });


  const [showAddClothing, setShowAddClothing] = useState(false);
  const [showAddColor, setShowAddColor] = useState(null);
  const [sizeEditorItem, setSizeEditorItem] = useState(null); // ⚙️ จัดการรุ่น (สี + ไซส์) จากหน้าคลัง
  const [itemMgrTab, setItemMgrTab] = useState("colors");
  const [newItemSize, setNewItemSize] = useState("");
  const [pickedColors, setPickedColors] = useState([]); // multi-select buffer: [{colorName, hex}]
  const [priceModal, setPriceModal] = useState(null); // {itemId, ci}
  const [priceForm, setPriceForm] = useState({ costPrice:"", kids:"", reg:"", "2XL":"", "3XL":"", "4XL":"", "5XL":"" });
  const [newModel, setNewModel] = useState("");
  const [customColorName, setCustomColorName] = useState("");
  const [newColorCost, setNewColorCost] = useState("");
  const [newColorSale, setNewColorSale] = useState("");
  const [newColorHex, setNewColorHex] = useState("#ffffff");
  const [editingStock, setEditingStock] = useState(null);
  const [collapsedItems, setCollapsedItems] = useState(() => {
    // 💾 restore จาก localStorage — จำสถานะสุดท้ายที่พับไว้
    try { return JSON.parse(localStorage.getItem("cpu_erp_collapsed_clothing") || "{}"); } catch { return {}; }
  });
  const [manageColorMode, setManageColorMode] = useState({}); // 🔧 { [itemId]: true } → แสดง ✕ ลบสี
  const [linkedInvColors, setLinkedInvColors] = useState({}); // 🔗 { [itemId]: {ci: true} } — ผูกสีในตารางสต๊อก
  const toggleLinkInvColor = (itemId, ci) => setLinkedInvColors(m => {
    const cur = { ...(m[itemId]||{}) };
    if (cur[ci]) delete cur[ci]; else cur[ci] = true;
    return { ...m, [itemId]: cur };
  });
  const [clothingSubTab, setClothingSubTab] = useState("all"); // "all" | "sleeveless" | "longsleeve" | "other"
  // 🗂 ค่าเริ่มต้น = "พับ" ทุกรุ่น — รุ่นจะกางก็ต่อเมื่อ collapsedItems[id] === false (กดกางเอง)
  //    → รุ่นใหม่ที่เพิ่มมาก็พับอัตโนมัติ ไม่ต้อง init
  const toggleCollapse = (id) => setCollapsedItems(prev => {
    const isCollapsed = prev[id] !== false; // default = พับ
    const next = { ...prev, [id]: isCollapsed ? false : true }; // สลับ พับ↔กาง
    try { localStorage.setItem("cpu_erp_collapsed_clothing", JSON.stringify(next)); } catch {}
    return next;
  });
  // 🗂 พับทั้งหมด / กางทั้งหมด — ใช้กับ inventoryTab ปัจจุบัน (clothing หรือ sports)
  const collapseAllClothing = (collapse) => {
    const relevant = clothingItems.filter(it => inventoryTab==="sports" ? it.sizeType==="shoe" : it.sizeType!=="shoe");
    setCollapsedItems(prev => {
      const next = { ...prev };
      relevant.forEach(it => { next[it.id] = collapse; });
      try { localStorage.setItem("cpu_erp_collapsed_clothing", JSON.stringify(next)); } catch {}
      return next;
    });
  };
  const clothingImgRef = useRef(null);
  const [uploadingClothingId, setUploadingClothingId] = useState(null);

  const [showAddModal, setShowAddModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [showTxModal, setShowTxModal] = useState(false);
  const [showBarcodeModal, setShowBarcodeModal] = useState(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(null);
  const [deleteClothingTarget, setDeleteClothingTarget] = useState(null); // {item} ยืนยันลบรุ่นเสื้อผ้า/รองเท้า
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [draggingClothingId, setDraggingClothingId] = useState(null); // 🖱️ ลากจัดลำดับรุ่น
  const [dragOverClothingId, setDragOverClothingId] = useState(null);
  // 📐 BOM template modal
  const [bomModal, setBomModal] = useState(null); // {clothingItem, variants, activeVariantIdx, saving}
  const [bomMaterialPickerOpen, setBomMaterialPickerOpen] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(null);
  const [showCatModal, setShowCatModal] = useState(false);
  const [showImgModal, setShowImgModal] = useState(null);
  const [showSettings, setShowSettings] = useState(false);

  // ── Invoice & Company state ───────────────────────────────────
  const [showNewInvoice, setShowNewInvoice] = useState(false);
  // ⏳ กันกดปุ่มออกบิลซ้ำระหว่างที่ยังบันทึกไม่เสร็จ
  //    ต้นเหตุจริงของบิลซ้ำ: บันทึกช้า (จองเลข → เขียนบิล → ปั๊มใบสั่ง) แต่ปุ่มไม่เปลี่ยนสภาพเลย
    //  พนักงานนึกว่าไม่ติด เลยกดย้ำ → ได้บิลคนละเลขแต่ยอดเดียวกัน
    //  ใช้ ref คู่กับ state: state ไว้เปลี่ยนหน้าตาปุ่ม · ref กันการกดรัวซึ่งเร็วกว่า re-render
  const [savingInvoice, setSavingInvoice] = useState(false);
  const savingInvoiceRef = useRef(false);
  const [invoiceOrderPool, setInvoiceOrderPool] = useState([]); // 📋 ใบสั่งของล่าสุดจาก DB (เผื่อเก่ากว่า window ในหน่วยความจำ) สำหรับ dropdown ดึงข้อมูล
  const [editingInvoiceId, setEditingInvoiceId] = useState(null); // ถ้ามี = โหมดแก้ไข
  const [profileCustomer, setProfileCustomer] = useState(null);
  const [editingCustomer, setEditingCustomer] = useState(null); // 📝 customer edit modal
  const [orderSearch, setOrderSearch] = useState("");
  const [orderDateFrom, setOrderDateFrom] = useState("");
  const [orderDateTo, setOrderDateTo] = useState("");
  const [showPrintInvoice, setShowPrintInvoice] = useState(null);
  const [invoiceDocType, setInvoiceDocType] = useState("receipt"); // receipt | tax | quotation
  const [invoiceVat, setInvoiceVat] = useState(false);
  const [invoiceStatusFilter, setInvoiceStatusFilter] = useState("ทั้งหมด");
  const [invoiceSearch, setInvoiceSearch] = useState(""); // 🔍 ค้นหาบิล (ชื่อลูกค้า/เบอร์/เลขที่/เลขภาษี)
  const [invoiceForm, setInvoiceForm] = useState({
    customerId:"", customerName:"", customerPhone:"", customerAddress:"", customerTaxId:"",
    items:[], note:"", dueDate:"", vatRate:7,
    discount:0, discountType:"amount", // ส่วนลดท้ายบิล (amount หรือ percent)
    ...invoiceDefaults(), // showCompanyTaxId / hideCompanyDetails
    useShipping: false, shippingFee: 0, // ค่าจัดส่ง (เลือกเปิด/ปิด)
  });
  const [invoiceItemForm, setInvoiceItemForm] = useState({ description:"", qty:"", unitPrice:"", unit:"ชิ้น" });
  const [addItemCollapsed, setAddItemCollapsed] = useState(true); // พับฟอร์มเพิ่มรายการไว้ก่อน — ช่องหนา กินที่
  const [txType, setTxType] = useState("รับ");
  // 💾 ร่างอัตโนมัติของ "ใบสั่งของ" และ "บิล"
  //    สลับไป LINE แล้วเบราว์เซอร์ล้างแท็บทิ้ง → กลับมาแล้วยังกู้ของที่กรอกค้างได้
  //    (ปิดหน้าต่างเอง/บันทึกสำเร็จ = ทิ้งร่าง — ดู clearOrderDraft / clearInvoiceDraft)
  const orderDraftValue = useMemo(
    () => ({ form: orderForm, editingOrderId }),
    [orderForm, editingOrderId]
  );
  const { saved: orderDraft, clear: clearOrderDraft } = useFormDraft("order", orderDraftValue, {
    active: showNewOrder,
    empty: !(orderForm.customerName || (orderForm.items || []).length > 0),
  });
  const invoiceDraftValue = useMemo(
    () => ({ form: invoiceForm, editingInvoiceId, docType: invoiceDocType, vat: invoiceVat }),
    [invoiceForm, editingInvoiceId, invoiceDocType, invoiceVat]
  );
  const { saved: invoiceDraft, clear: clearInvoiceDraft } = useFormDraft("invoice", invoiceDraftValue, {
    active: showNewInvoice,
    empty: !(invoiceForm.customerName || (invoiceForm.items || []).length > 0),
  });

  // กู้ร่างกลับเข้าฟอร์ม แล้วเปิดหน้าต่างให้ทำต่อจากจุดเดิม
  const resumeOrderDraft = () => {
    const d = orderDraft?.value;
    if (!d?.form) return;
    setOrderForm(d.form);
    setEditingOrderId(d.editingOrderId || null);
    setShowNewOrder(true);
  };
  const resumeInvoiceDraft = () => {
    const d = invoiceDraft?.value;
    if (!d?.form) return;
    setInvoiceForm(d.form);
    setEditingInvoiceId(d.editingInvoiceId || null);
    setInvoiceDocType(d.docType || "receipt");
    setInvoiceVat(!!d.vat);
    setShowNewInvoice(true);
  };


  // forms
  const [newProduct, setNewProduct] = useState({ code:"",name:"",category:"",qty:"",unit:"",minQty:"",location:"",barcode:"",image:"",costPrice:"",salePrice:"" });
  // tx modal — รองรับหลายแถวพร้อมกัน
  const [txRows, setTxRows] = useState([{ productId:"", qty:"" }]);
  const [txNote, setTxNote] = useState("");
  // 📦 bulk stock operations (ตัด/รับสต๊อกหลายรายการพร้อมกัน)
  const [selectedProducts, setSelectedProducts] = useState(new Set());
  const [bulkTxModal, setBulkTxModal] = useState(null); // {type:"รับ"|"จ่าย", items:[{id,code,name,unit,current,qty:""}]}
  const [bulkTxNote, setBulkTxNote] = useState("");
  const [bulkTxSaving, setBulkTxSaving] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [barcodeSearch, setBarcodeSearch] = useState("");
  const [showScanner, setShowScanner] = useState(false); // โหมดสแกนกล้อง
  const [showBarcodePrint, setShowBarcodePrint] = useState(false); // ปริ้น barcode stickers
  const [showTxScanner, setShowTxScanner] = useState(false); // สแกนใน Tx modal
  const [inventoryTab, setInventoryTab] = useState("clothing"); // "clothing" | "sports" | "general"
  const [clothingTxModal, setClothingTxModal] = useState(null); // {item, colorIdx, size}
  const [clothingTxExtraColors, setClothingTxExtraColors] = useState(new Set()); // 🔗 สีเพิ่มเติมที่ทำ tx เดียวกัน
  const [clothingTxType, setClothingTxType] = useState("รับ");
  const [clothingTxQty, setClothingTxQty] = useState("");
  const [clothingTxSizeQty, setClothingTxSizeQty] = useState({}); // {S:"10", M:"5"} จ่าย/รับหลายไซส์พร้อมกัน
  const [mixModal, setMixModal] = useState(null); // 🧺 {item, pendingId?} ขายคละสีคละไซส์
  const [mixQuickQty, setMixQuickQty] = useState(""); // 🚀 ยอดรวมประมาณการ (โหมดบันทึกไว้ก่อน)
  const [pendingMixListOpen, setPendingMixListOpen] = useState(false);
  // 🧺 mix-in-order: adder form
  const [orderMixForm, setOrderMixForm] = useState({ clothingId: "", qty: "" });
  const [orderMixExpanded, setOrderMixExpanded] = useState(false); // พับเก็บ default
  const [orderFreeExpanded, setOrderFreeExpanded] = useState(false); // พับเก็บ default
  // ✏️ modal สำหรับกรอกรายละเอียดใบสั่งของที่ค้าง
  const [fillOrderMix, setFillOrderMix] = useState(null); // { order }
  const [fillRowsByIdx, setFillRowsByIdx] = useState({}); // { [mixItemIdx]: [{colorIdx, size, qty}, ...] }
  const [mixRows, setMixRows] = useState([]); // [{colorIdx, size, qty}]
  const [mixNote, setMixNote] = useState("");
  const [showSizeManager, setShowSizeManager] = useState(false); // 📏 modal จัดการไซส์
  const [showSalesToday, setShowSalesToday] = useState(false); // 📊 modal ขายวันนี้
  const [salesDate, setSalesDate] = useState(() => new Date().toISOString().slice(0,10)); // yyyy-mm-dd
  const [salesMode, setSalesMode] = useState("day"); // 📅 "day" = รายวัน | "month" = รวมทั้งเดือน
  const [salesCell, setSalesCell] = useState(null); // {model,color,size,prefix} ดู/ลบรายการจ่ายของช่องนั้น
  // 🔎 Option A — โหลด transactions ตามช่วงวันที่ (createdAt) แทนพึ่ง rolling window ที่ล้นเร็วเมื่อออกใบเยอะ
  const [salesTx, setSalesTx] = useState([]);            // tx ของวัน salesDate (สำหรับ "ขายวันนี้")
  const [salesTxLoading, setSalesTxLoading] = useState(false);
  const [salesTxNonce, setSalesTxNonce] = useState(0);   // bump เพื่อ refetch หลังลบรายการ
  const [reportTx, setReportTx] = useState([]);          // tx 90 วันล่าสุด (สำหรับหน้ารายงาน)
  const [collapsedSalesModels, setCollapsedSalesModels] = useState({}); // ย่อรุ่นใน "ขายวันนี้"
  const [salesSearch, setSalesSearch] = useState("");       // 🔍 ค้นรุ่นใน "ขายวันนี้"
  const [salesShowCount, setSalesShowCount] = useState(30); // จำนวนรุ่นที่วาด (กันค้างเมื่อมีเป็นร้อยรุ่น)
  const [newApparelSize, setNewApparelSize] = useState("");
  const [newShoeSize, setNewShoeSize] = useState("");
  const [clothingTxNote, setClothingTxNote] = useState("");
  const [clothingTxSuccess, setClothingTxSuccess] = useState(false);
  const [barcodeResult, setBarcodeResult] = useState(null);
  const [barcodeErr, setBarcodeErr] = useState("");

  // settings state
  const [settingsTab, setSettingsTab] = useState("profile");

  // Backup reminder — แสดง banner ถ้าไม่ backup เกิน 7 วัน
  const [backupReminder, setBackupReminder] = useState(false);
  useEffect(() => {
    if (!user) return;
    // เช็คเฉพาะ admin (canClear ⇒ admin) — คนอื่นไม่ต้องสนใจ
    if (!role?.canClear) return;
    // ถ้า snooze ภายใน 24 ชม. ก็ไม่เตือน
    const snoozeUntil = Number(localStorage.getItem("cpu_erp_backup_snooze")) || 0;
    if (Date.now() < snoozeUntil) return;
    setBackupReminder(shouldRemindBackup());
  }, [user]);

  const handleSnoozeBackupReminder = () => {
    localStorage.setItem("cpu_erp_backup_snooze", String(Date.now() + 24 * 60 * 60 * 1000));
    setBackupReminder(false);
  };

  const handleOpenBackup = () => {
    setBackupReminder(false);
    setSettingsTab("backup");
    setShowSettings(true);
  };
  const [profileForm, setProfileForm] = useState({ name:"",username:"",oldPass:"",newPass:"",confirmPass:"" });
  const [profileMsg, setProfileMsg] = useState({ type:"",text:"" });

  // toasts
  const [addSuccess, setAddSuccess] = useState(false);
  const [txSuccess, setTxSuccess] = useState(false);
  const [txSaving, setTxSaving] = useState(false);

  const imageInputRef = useRef(null);
  const productImageRef = useRef(null);
  const imgModalUploadRef = useRef(null);
  const [uploadingForProduct, setUploadingForProduct] = useState(null);

  const handleProductImageUpload = async (e) => {
    const file = e.target.files[0]; if (!file || !uploadingForProduct) return;
    try {
      const dataUrl = await compressImage(file, { maxDim: 1000, quality: 0.75 });
      const { url, path } = await uploadImage(dataUrl, "products");
      const prod = products.find(p => p.id === uploadingForProduct);
      if (prod?.imagePath) deleteFile(prod.imagePath); // ลบรูปเก่าใน Storage
      await updateDoc(doc(db, "products", uploadingForProduct), { image: url, imagePath: path, lastUpdate: now() });
    } catch (err) {
      alert("อัปโหลดรูปไม่สำเร็จ: " + (err?.message || err));
    } finally {
      setUploadingForProduct(null);
      if (e.target) e.target.value = "";
    }
  };
  const barcodeInputRef = useRef(null);

  // ผสาน permission ของ role กับ override ต่อคน (user.permissions)
  const role = user ? { ...ROLES[user.role], ...(user.permissions||{}) } : null;

  const now = () => {
    const d = new Date();
    return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
  };


  // 🏷️ Tab-level filter — รวมหลาย category เป็น 1 tab ได้ (เช่น sports = รองเท้า+อุปกรณ์กีฬา)
  // 🧪 แท็บวัตถุดิบ (top-level) แสดง product ทั้งหมด — กรองด้วย chip หมวด + คำค้นหา
  const filtered = products.filter(p => {
    if (selectedCat !== "ทั้งหมด" && p.category !== selectedCat) return false;
    if (!search) return true;
    const q = search.toLowerCase().trim();
    return (p.name || "").toLowerCase().includes(q) || (p.code || "").toLowerCase().includes(q) || (p.barcode || "").toLowerCase().includes(q);
  });
  const lowStock = products.filter(p => Number(p.qty) < Number(p.minQty));
  const totalQty = products.reduce((s,p) => s + Number(p.qty), 0);
  const statusColor = p => Number(p.qty) < Number(p.minQty) ? T.red : Number(p.qty) < Number(p.minQty) * 1.5 ? T.amber : T.green;
  const statusLabel = p => Number(p.qty) < Number(p.minQty) ? "ต่ำกว่าขั้นต่ำ" : Number(p.qty) < Number(p.minQty) * 1.5 ? "ใกล้หมด" : "ปกติ";

  const handleImageUpload = async e => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const dataUrl = await compressImage(file, { maxDim: 1000, quality: 0.75 });
      const { url, path } = await uploadImage(dataUrl, "products");
      setNewProduct(p => ({...p, image: url, imagePath: path}));
    } catch (err) {
      console.error("[handleImageUpload] upload failed:", err);
      alert("อัปโหลดรูปไม่สำเร็จ: " + (err?.message || err));
    } finally {
      if (e.target) e.target.value = "";
    }
  };

  const [addProductSaving, setAddProductSaving] = useState(false);
  const handleAddProduct = async () => {
    if (addProductSaving) return; // กัน double-submit
    if (!newProduct.code || !newProduct.name || newProduct.qty === "" || !newProduct.unit) return;
    setAddProductSaving(true);
    try {
      const bc = newProduct.barcode || `CPU${Date.now().toString().slice(-8)}`;
      const cat = newProduct.category || categories[0] || "ทั่วไป";
      const data = {
        ...newProduct,
        qty: Number(newProduct.qty),
        minQty: newProduct.minQty === "" ? 0 : Number(newProduct.minQty),
        barcode: bc, category: cat, lastUpdate: now(),
        history: [{ action:"เพิ่มสินค้าใหม่", by: user.name, date: now(), note:`จำนวนเริ่มต้น: ${newProduct.qty} ${newProduct.unit}` }]
      };
      const ref = await addDoc(collection(db, "products"), data);
      logAudit(user, {
        action: AUDIT_ACTIONS.CREATE,
        collection: "products",
        targetId: ref.id,
        targetLabel: `${newProduct.code} · ${newProduct.name}`,
        note: `qty:${newProduct.qty} ${newProduct.unit}`,
      });
      setAddSuccess(true);
      setTimeout(() => { setAddSuccess(false); setShowAddModal(false); setNewProduct({code:"",name:"",category:"",qty:"",unit:"",minQty:"",location:"",barcode:"",image:"",costPrice:"",salePrice:""}); }, 1000);
    } catch (e) {
      console.error("[handleAddProduct] failed:", e);
      alert("บันทึกไม่สำเร็จ: " + (e?.message || e));
    } finally {
      setAddProductSaving(false);
    }
  };

  const handleSaveEditProduct = async () => {
    if (!editingProduct) return;
    const p = editingProduct;
    if (!p.code || !p.name || !p.unit) return;
    const original = products.find(x => x.id === p.id) || {};
    const changes = [];
    ["code","name","category","unit","location","barcode","costPrice","salePrice","minQty","qty","image"].forEach(k => {
      const ov = original[k] ?? "";
      const nv = p[k] ?? "";
      if (String(ov) !== String(nv)) changes.push(`${k}: ${ov||"-"} → ${nv||"-"}`);
    });
    const data = {
      ...p,
      qty: Number(p.qty)||0,
      minQty: p.minQty === "" ? 0 : Number(p.minQty),
      costPrice: p.costPrice === "" ? "" : Number(p.costPrice),
      salePrice: p.salePrice === "" ? "" : Number(p.salePrice),
      lastUpdate: now(),
      history: [
        { action:"แก้ไขรายละเอียด", by: user.name, date: now(), note: changes.length ? changes.join(" · ") : "ไม่มีการเปลี่ยนแปลง" },
        ...(original.history||[])
      ]
    };
    delete data.id;
    await updateDoc(doc(db,"products",p.id), data);
    logAudit(user, {
      action: AUDIT_ACTIONS.UPDATE,
      collection: "products",
      targetId: p.id,
      targetLabel: `${data.code} · ${data.name}`,
      note: changes.length ? changes.join(" · ") : "บันทึกไม่มีการเปลี่ยนแปลง",
    });
    setEditingProduct(null);
  };

  const handleTx = async () => {
    if (txSaving) return; // กัน double-submit
    // process หลายแถวพร้อมกัน — ข้ามแถวที่ว่าง/qty<=0
    const valid = txRows.filter(r => r.productId && Number(r.qty) > 0);
    if (valid.length === 0) return;
    setTxSaving(true);
    try {
      const noteSuffix = txNote ? ` (${txNote})` : "";
      for (const row of valid) {
        const pid = row.productId;
        const qty = Number(row.qty);
        const prod = products.find(p => p.id === pid);
        if (!prod) continue;
        const histEntry = {
          action: txType === "รับ" ? "รับสินค้าเข้าคลัง" : "จ่ายสินค้าออกคลัง",
          by: user.name, date: now(),
          note: `${txType==="รับ"?"+":"-"}${qty} ${prod.unit||""}${noteSuffix}`,
        };
        const oldQty = Number(prod.qty) || 0;
        const newQty = txType === "รับ" ? oldQty + qty : Math.max(0, oldQty - qty);
        await updateDoc(doc(db, "products", pid), {
          qty: newQty, lastUpdate: now(),
          history: [histEntry, ...(prod.history||[])],
        });
        await addDoc(collection(db, "transactions"), {
          type: txType, code: prod.code, name: prod.name, qty,
          by: user.name, date: now(), note: txNote||"",
          createdAt: serverTimestamp(),
        });
        logAudit(user, {
          action: AUDIT_ACTIONS.STOCK,
          collection: "products",
          targetId: pid,
          targetLabel: `${prod.code} ${prod.name}`,
          note: `${txType} ${qty} ${prod.unit||""} (${oldQty}→${newQty})${noteSuffix}${valid.length>1?" [multi]":""}`,
        });
      }
      // ปิด modal + reset
      setTxRows([{productId:"",qty:""}]);
      setTxNote("");
      setShowTxModal(false);
      setTxSuccess(true);
      setTimeout(() => setTxSuccess(false), 1500);
    } catch (e) {
      console.error("[handleTx] failed:", e);
      alert("บันทึกไม่สำเร็จ: " + (e.message || e));
    } finally {
      setTxSaving(false);
    }
  };

  // ── Bulk stock operations ─────────────────────────────────────
  const toggleSelectProduct = (id) => setSelectedProducts(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const openBulkTx = (type, sourceList) => {
    const items = sourceList.filter(p => selectedProducts.has(p.id)).map(p => ({
      id: p.id, code: p.code, name: p.name, unit: p.unit||"", current: Number(p.qty)||0, qty: ""
    }));
    if (items.length === 0) return;
    setBulkTxModal({ type, items });
    setBulkTxNote("");
  };
  const setBulkItemQty = (id, qty) => setBulkTxModal(m => m ? { ...m, items: m.items.map(it => it.id === id ? { ...it, qty } : it) } : m);
  const handleBulkTx = async () => {
    if (bulkTxSaving || !bulkTxModal) return;
    const valid = bulkTxModal.items.filter(it => Number(it.qty) > 0);
    if (valid.length === 0) { alert("กรอกจำนวนอย่างน้อย 1 รายการ"); return; }
    setBulkTxSaving(true);
    try {
      const noteSuffix = bulkTxNote ? ` (${bulkTxNote})` : "";
      for (const it of valid) {
        const prod = products.find(x => x.id === it.id);
        if (!prod) continue;
        const qty = Number(it.qty);
        const oldQty = Number(prod.qty) || 0;
        const newQty = bulkTxModal.type === "รับ" ? oldQty + qty : Math.max(0, oldQty - qty);
        const histEntry = {
          action: bulkTxModal.type === "รับ" ? "รับสินค้าเข้าคลัง (bulk)" : "จ่ายสินค้าออกคลัง (bulk)",
          by: user.name, date: now(),
          note: `${bulkTxModal.type === "รับ" ? "+" : "-"}${qty} ${prod.unit||""}${noteSuffix}`,
        };
        await updateDoc(doc(db, "products", prod.id), {
          qty: newQty, lastUpdate: now(),
          history: [histEntry, ...(prod.history||[])],
        });
        await addDoc(collection(db, "transactions"), {
          type: bulkTxModal.type, code: prod.code, name: prod.name, qty,
          by: user.name, date: now(), note: bulkTxNote||"",
          createdAt: serverTimestamp(),
        });
        logAudit(user, {
          action: AUDIT_ACTIONS.STOCK,
          collection: "products",
          targetId: prod.id,
          targetLabel: `${prod.code} · ${prod.name}`,
          note: `${bulkTxModal.type} ${qty} ${prod.unit||""} (${oldQty}→${newQty})${noteSuffix} [bulk]`,
        });
      }
      setBulkTxModal(null);
      setBulkTxNote("");
      setSelectedProducts(new Set());
      setTxSuccess(true);
      setTimeout(() => setTxSuccess(false), 1500);
    } catch (e) {
      console.error("[handleBulkTx] failed:", e);
      alert("บันทึกไม่สำเร็จ: " + (e?.message || e));
    } finally {
      setBulkTxSaving(false);
    }
  };

  const handleDelete = async id => {
    const prod = products.find(p => p.id === id);
    await deleteDoc(doc(db, "products", id));
    logAudit(user, {
      action: AUDIT_ACTIONS.DELETE,
      collection: "products",
      targetId: id,
      targetLabel: prod ? `${prod.code} ${prod.name}` : id,
      before: prod,
    });
    setShowDeleteConfirm(null);
  };

  const handleClear = async () => {
    const batch = writeBatch(db);
    const pSnap = await getDocs(collection(db, "products"));
    const tSnap = await getDocs(collection(db, "transactions"));
    pSnap.docs.forEach(d => batch.delete(d.ref));
    tSnap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
    logAudit(user, {
      action: AUDIT_ACTIONS.CLEAR,
      collection: "products",
      targetLabel: "ล้างคลังทั้งหมด",
      note: `ลบสินค้า ${pSnap.size} รายการ + transactions ${tSnap.size} รายการ`,
    });
    setShowClearConfirm(false);
  };

  const handleBarcodeSearch = (codeArg) => {
    setBarcodeErr(""); setBarcodeResult(null);
    const code = String(codeArg ?? barcodeSearch ?? "").trim();
    if (!code) return;
    const codeNorm = code.toLowerCase().replace(/\s+/g,"");

    // 1) ค้นใน products — match barcode หรือ code (normalize: trim+lowercase+ลบ space)
    const norm = (s) => String(s||"").trim().toLowerCase().replace(/\s+/g,"");
    const found = products.find(p => norm(p.barcode)===codeNorm || norm(p.code)===codeNorm);
    if (found) { setBarcodeResult(found); return; }

    // 2) ค้นใน clothing
    for (const item of clothingItems) {
      for (let ci = 0; ci < (item.colors||[]).length; ci++) {
        const col = item.colors[ci];
        if (norm(col.barcode) === codeNorm) {
          setBarcodeResult({
            _isClothing: true,
            id: item.id, colorIdx: ci,
            name: `${item.model} / ${col.colorName}`,
            code: item.id?.slice(0,6),
            category: "เสื้อผ้า",
            barcode: col.barcode,
            qty: Object.values(col.stock||{}).reduce((s,v)=>s+(Number(v)||0),0),
            minQty: 0, unit: "ชิ้น",
            image: item.image || "",
          });
          return;
        }
      }
    }

    // ── DEBUG: หาที่ "ใกล้เคียง" → ช่วย user แก้ปัญหา ──
    const closeMatches = products
      .filter(p => norm(p.barcode).includes(codeNorm) || norm(p.code).includes(codeNorm) || codeNorm.includes(norm(p.barcode)) || codeNorm.includes(norm(p.code)))
      .slice(0,3);
    console.log("[scan] not found. code:", JSON.stringify(code), "len:", code.length, "products in db:", products.length, "close matches:", closeMatches);

    let extra = "";
    if (closeMatches.length > 0) {
      extra = "\n\nใกล้เคียง: " + closeMatches.map(p => `${p.code}/${p.barcode}`).join(", ");
    } else {
      // แสดง barcode ที่มีใน DB 3 ตัวแรก
      const sample = products.slice(0,3).map(p => `${p.code}=${p.barcode}`).join(", ");
      if (sample) extra = "\n\nตัวอย่างใน DB: " + sample;
    }
    setBarcodeErr(`ไม่พบสินค้าในระบบ — รหัสที่อ่านได้: "${code}"${extra}`);
  };

  const handleAddCat = async () => {
    if (!newCatName.trim() || categories.includes(newCatName.trim())) return;
    const newList = [...categories, newCatName.trim()];
    await setDoc(doc(db, "settings", "categories"), { list: newList });
    setNewCatName("");
  };

  const handleAddUser = async () => {
    setAddUserErr("");
    if (!newUser.name.trim() || !newUser.username.trim()) { setAddUserErr("กรุณากรอกชื่อและชื่อผู้ใช้"); return; }
    if (newUser.password.length < 4) { setAddUserErr("รหัสผ่านต้องมีอย่างน้อย 4 ตัว"); return; }
    if (newUser.password !== newUser.confirmPassword) { setAddUserErr("รหัสผ่านไม่ตรงกัน"); return; }
    const dup = users.find(u => u.username === newUser.username.trim());
    if (dup) { setAddUserErr("ชื่อผู้ใช้นี้มีในระบบแล้ว"); return; }
    const id = Date.now();
    const userData = { id, username: newUser.username.trim(), password: newUser.password, name: newUser.name.trim(), role: "staff", avatar: "👷" };
    await setDoc(doc(db, "users", String(id)), userData);
    logAudit(user, {
      action: AUDIT_ACTIONS.CREATE,
      collection: "users",
      targetId: id,
      targetLabel: `${userData.name} (@${userData.username})`,
      after: { name: userData.name, username: userData.username, role: userData.role },
    });
    setAddUserSuccess(true);
    setTimeout(() => { setAddUserSuccess(false); setShowAddUserModal(false); setNewUser({name:"",username:"",password:"",confirmPassword:""}); }, 1200);
  };

  const handleDeleteUser = async u => {
    await deleteDoc(doc(db, "users", String(u.id)));
    logAudit(user, {
      action: AUDIT_ACTIONS.DELETE,
      collection: "users",
      targetId: u.id,
      targetLabel: `${u.name} (@${u.username})`,
      before: { name: u.name, username: u.username, role: u.role },
    });
    setShowDeleteUserConfirm(null);
  };

  // ── Profile / Settings Save ──────────────────────────────────
  const openSettings = () => {
    setProfileForm({ name: user.name, username: user.username, oldPass:"", newPass:"", confirmPass:"" });
    setProfileMsg({ type:"", text:"" });
    setSettingsTab("profile"); // 🔒 เริ่มที่โปรไฟล์เสมอ — เข้า "ระบบ" ต้องใส่รหัสผ่านการ์ด
    setShowSettings(true);
  };
  const handleSaveProfile = async () => {
    setProfileMsg({ type:"", text:"" });
    if (!profileForm.name.trim() || !profileForm.username.trim()) { setProfileMsg({type:"err",text:"กรุณากรอกชื่อและชื่อผู้ใช้"}); return; }
    const dupUser = users.find(u => u.username === profileForm.username && String(u.id) !== String(user.id));
    if (dupUser) { setProfileMsg({type:"err",text:"ชื่อผู้ใช้นี้มีในระบบแล้ว"}); return; }
    if (profileForm.newPass) {
      // หา user ตัวจริงใน Firestore — กัน user state ตัวแคชเก่าจาก localStorage
      const liveUser = users.find(u => String(u.id) === String(user.id)) || user;
      if (profileForm.oldPass !== liveUser.password) { setProfileMsg({type:"err",text:"รหัสผ่านเดิมไม่ถูกต้อง"}); return; }
      if (profileForm.newPass.length < 4) { setProfileMsg({type:"err",text:"รหัสผ่านใหม่ต้องมีอย่างน้อย 4 ตัว"}); return; }
      if (profileForm.newPass !== profileForm.confirmPass) { setProfileMsg({type:"err",text:"รหัสผ่านใหม่ไม่ตรงกัน"}); return; }
    }
    try {
      const liveUser = users.find(u => String(u.id) === String(user.id)) || user;
      const updated = { ...liveUser, name: profileForm.name.trim(), username: profileForm.username.trim(), password: profileForm.newPass || liveUser.password };
      await setDoc(doc(db, "users", String(user.id)), updated);
      setUser(updated);
      setProfileMsg({type:"ok",text:"บันทึกสำเร็จ!"});
      setProfileForm(f => ({...f, oldPass:"", newPass:"", confirmPass:""}));
    } catch (err) {
      console.error("Save profile failed:", err);
      setProfileMsg({type:"err",text:`บันทึกไม่ได้: ${err.code || err.message}`});
    }
  };


  // ── Clothing handlers ─────────────────────────────────────────
  const handleAddClothingItem = async () => {
    if (!newModel.trim()) return;
    // 👟 ถ้าอยู่ tab sports → ใส่ sizeType="shoe" ให้รุ่นใหม่ใช้ไซส์ 36-45
    const sizeType = inventoryTab === "sports" ? "shoe" : "apparel";
    const ref = await addDoc(collection(db, "clothing"), { model: newModel.trim(), image: "", colors: [], sizeType, createdAt: serverTimestamp() });
    logAudit(user, {
      action: AUDIT_ACTIONS.CREATE,
      collection: "clothing",
      targetId: ref.id,
      targetLabel: newModel.trim(),
      note: `เพิ่มรุ่นใหม่ (${sizeType==="shoe"?"รองเท้า":"เสื้อผ้า"})`,
    });
    setNewModel(""); setShowAddClothing(false);
  };

  // 📏 เพิ่มไซส์ใหม่ (custom) — kind = "apparel" | "shoe"
  const addCustomSize = async (kind, raw) => {
    const val = String(raw || "").trim();
    if (!val) return;
    const base = kind === "shoe" ? SHOE_SIZES : SIZES;
    const cur = customSizes?.[kind] || [];
    const exists = [...base, ...cur].some(s => String(s).toUpperCase() === val.toUpperCase());
    if (exists) { alert(`มีไซส์ "${val}" อยู่แล้ว`); return; }
    try {
      await setDoc(doc(db, "settings", "sizes"), {
        apparel: customSizes?.apparel || [],
        shoe: customSizes?.shoe || [],
        [kind]: [...cur, val],
      }, { merge: true });
      logAudit(user, { action: AUDIT_ACTIONS.UPDATE, collection: "settings", targetId: "sizes", targetLabel: "ไซส์", note: `เพิ่มไซส์ ${kind==="shoe"?"รองเท้า":"เสื้อผ้า"}: ${val}` });
      if (kind === "shoe") setNewShoeSize(""); else setNewApparelSize("");
    } catch (e) { alert("บันทึกไม่สำเร็จ: " + (e.message || e)); }
  };

  // 📏 ลบไซส์ที่เพิ่มเอง (ลบได้เฉพาะ custom — ไซส์มาตรฐานลบไม่ได้)
  const removeCustomSize = async (kind, val) => {
    if (!window.confirm(`ลบไซส์ "${val}" ออกจากรายการ?\n(สต็อกเดิมที่เคยกรอกไว้จะไม่ถูกลบ แต่จะไม่แสดงช่องไซส์นี้)`)) return;
    try {
      await setDoc(doc(db, "settings", "sizes"), {
        apparel: customSizes?.apparel || [],
        shoe: customSizes?.shoe || [],
        [kind]: (customSizes?.[kind] || []).filter(s => s !== val),
      }, { merge: true });
      logAudit(user, { action: AUDIT_ACTIONS.UPDATE, collection: "settings", targetId: "sizes", targetLabel: "ไซส์", note: `ลบไซส์ ${kind==="shoe"?"รองเท้า":"เสื้อผ้า"}: ${val}` });
    } catch (e) { alert("ลบไม่สำเร็จ: " + (e.message || e)); }
  };

  // 🔧 ลบรายการจ่ายที่กรอกผิด + คืนสต็อกกลับ
  const handleDeleteSaleTx = async (t) => {
    if (txSaving) return;
    const item = clothingItems.find(i => i.id === t.code);
    const parts = (t.name||"").split(" / ");
    const colorName = (parts[1]||"").trim();
    const size = (parts[2]||"").trim();
    if (!window.confirm(`ลบรายการจ่าย "${t.name}" จำนวน ${t.qty} ตัว?\n\nสต็อกจะถูกคืนกลับ +${t.qty} (ถ้ายังมีรุ่น/สีนี้อยู่)`)) return;
    setTxSaving(true);
    try {
      // คืนสต็อก (ถ้ายังหา item/สีเจอ)
      if (item) {
        const ci = (item.colors||[]).findIndex(c => c.colorName === colorName);
        if (ci >= 0) {
          const newColors = item.colors.map((c,i) =>
            i===ci ? { ...c, stock: { ...(c.stock||{}), [size]: (Number((c.stock||{})[size])||0) + (Number(t.qty)||0) } } : c
          );
          await updateDoc(doc(db, "clothing", item.id), { colors: newColors });
        }
      }
      await deleteDoc(doc(db, "transactions", t.id));
      logAudit(user, { action: AUDIT_ACTIONS.DELETE, collection: "transactions", targetId: t.id, targetLabel: t.name, note: `ลบรายการจ่ายผิด · คืนสต็อก +${t.qty}` });
    } catch (e) { alert("ลบไม่สำเร็จ: " + (e.message || e)); }
    finally { setTxSaving(false); }
  };

  // 🔎 Option A — ดึง transactions ตามช่วง createdAt (ไม่พึ่ง rolling window ที่ล้นเร็ว)
  const fetchTxByCreatedRange = async (start, endExclusive) => {
    const clauses = [where("createdAt", ">=", Timestamp.fromDate(start))];
    if (endExclusive) clauses.push(where("createdAt", "<", Timestamp.fromDate(endExclusive)));
    const q = query(collection(db, "transactions"), ...clauses, orderBy("createdAt", "desc"));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ ...d.data(), id: d.id }));
  };

  // "ขายตามวันที่/รายเดือน" — โหลด tx ตามช่วงที่เลือก (วันเดียว หรือ ทั้งเดือน)
  useEffect(() => {
    if (!showSalesToday) return;
    let cancelled = false;
    (async () => {
      setSalesTxLoading(true);
      try {
        const [yy, mm, dd] = salesDate.split("-").map(Number);
        // 📅 month = 1 ถึงสิ้นเดือน · day = 00:00–24:00 ของวันนั้น
        const start = salesMode === "month" ? new Date(yy, mm - 1, 1, 0, 0, 0, 0) : new Date(yy, mm - 1, dd, 0, 0, 0, 0);
        const end   = salesMode === "month" ? new Date(yy, mm, 1, 0, 0, 0, 0)     : new Date(yy, mm - 1, dd + 1, 0, 0, 0, 0);
        const rows = await fetchTxByCreatedRange(start, end);
        if (!cancelled) setSalesTx(rows);
      } catch (e) {
        console.warn("[salesTx] fetch failed:", e);
        if (!cancelled) setSalesTx([]);
      } finally {
        if (!cancelled) setSalesTxLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [showSalesToday, salesDate, salesMode, salesTxNonce]);

  // เปลี่ยนวัน/โหมด/เปิดใหม่ → เริ่มนับใหม่ ไม่ให้ค้างที่จำนวนเดิม
  useEffect(() => { setSalesShowCount(30); setSalesSearch(""); }, [showSalesToday, salesDate, salesMode]);

  // หน้ารายงาน — โหลด tx 90 วันล่าสุด (กราฟรับ/จ่าย + ยอดต่อสินค้า) ไม่ให้ขาดข้อมูลเมื่อออกใบเยอะ
  useEffect(() => {
    if (activeTab !== "reports") return;
    let cancelled = false;
    (async () => {
      try {
        const start = new Date();
        start.setDate(start.getDate() - 90);
        start.setHours(0, 0, 0, 0);
        const rows = await fetchTxByCreatedRange(start, null);
        if (!cancelled) setReportTx(rows);
      } catch (e) {
        console.warn("[reportTx] fetch failed:", e);
      }
    })();
    return () => { cancelled = true; };
  }, [activeTab]);

  // 📋 เปิด modal ออกบิล → ดึงใบสั่งของล่าสุด 300 ใบจาก DB (B) เผื่อเก่ากว่า window ในหน่วยความจำ (A)
  // dropdown "ดึงข้อมูลจากใบสั่งของ" จะได้เห็นใบที่ยังไม่ออกบิลครบ ไม่พลาดใบเก่า
  useEffect(() => {
    if (!showNewInvoice) return;
    let cancelled = false;
    (async () => {
      try {
        const q = query(collection(db, "orders"), orderBy("createdAt", "desc"), limit(300));
        const snap = await getDocs(q);
        if (!cancelled) setInvoiceOrderPool(snap.docs.map(d => ({ ...d.data(), id: d.id })));
      } catch (e) {
        console.warn("[invoiceOrderPool] fetch failed:", e);
      }
    })();
    return () => { cancelled = true; };
  }, [showNewInvoice]);

  // 🧺 เปิด modal ขายคละ
  const openMix = (item) => {
    setMixModal({ item });
    setMixRows([{ colorIdx: 0, size: "", qty: "" }]);
    setMixNote("");
    setMixQuickQty("");
  };
  // 🔓→📦 ตัดสต๊อกทีหลัง สำหรับใบที่ deferStockCut = true
  const handleCutStockNow = async (o) => {
    if (!o || !o.deferStockCut) return;
    const items = (o.items || []).filter(i => !i.isMix && !!clothingItems.find(c => c.id === i.clothingId));
    if (items.length === 0) { alert("ใบนี้ไม่มีรายการที่จะตัดสต๊อกได้ (อาจเป็นรายการอิสระ/custom ทั้งหมด)"); return; }
    const totalQty = items.reduce((s,i)=>s+(Number(i.qty)||0),0);
    if (!window.confirm(`📦 ตัดสต๊อก ${o.orderNo}?\n\nลูกค้า: ${o.customerName}\nจะตัด ${items.length} รายการ · ${totalQty} ตัว\n\n⚠️ สต๊อกอาจติดลบถ้าไม่พอ`)) return;
    // จัดกลุ่ม + ตัด
    const byClothing = new Map();
    for (const oi of items) {
      if (!byClothing.has(oi.clothingId)) byClothing.set(oi.clothingId, []);
      byClothing.get(oi.clothingId).push(oi);
    }
    try {
      for (const [clothingId, ois] of byClothing) {
        const item = clothingItems.find(i => i.id === clothingId);
        const newColors = item.colors.map((c, i) => {
          const cuts = ois.filter(oi => oi.colorIdx === i);
          if (cuts.length === 0) return c;
          const stock = { ...(c.stock || {}) };
          for (const oi of cuts) stock[oi.size] = Math.max(0, (stock[oi.size]||0) - (Number(oi.qty)||0));
          return { ...c, stock };
        });
        await updateDoc(doc(db, "clothing", clothingId), { colors: newColors });
      }
      await updateDoc(doc(db, "orders", o.id), {
        deferStockCut: false,
        stockCutAt: new Date().toISOString(),
        stockCutBy: user?.name || "",
      });
      logAudit(user, {
        action: AUDIT_ACTIONS.STOCK, collection: "orders", targetId: o.id,
        targetLabel: `${o.orderNo} · ${o.customerName}`,
        note: `🔓→📦 ตัดสต๊อกทีหลัง ${items.length} รายการ · ${totalQty} ตัว`,
      });
      alert(`✅ ตัดสต๊อก ${totalQty} ตัวเรียบร้อย`);
    } catch (e) {
      alert("ตัดสต๊อกไม่สำเร็จ: " + (e.message || e));
    }
  };
  // 🕐 เปิด modal ต่อจาก pending — ให้กรอกรายละเอียดที่ค้าง
  const openMixFromPending = (p) => {
    const item = clothingItems.find(i => i.id === p.itemId);
    if (!item) { alert("ไม่พบรุ่นสินค้าเดิม (อาจถูกลบ)"); return; }
    setMixModal({ item, pendingId: p.id });
    setMixRows(p.rows && p.rows.length > 0 ? p.rows : [{ colorIdx: 0, size: "", qty: "" }]);
    setMixNote(p.note || "");
    setMixQuickQty(p.quickQty ? String(p.quickQty) : "");
    setPendingMixListOpen(false);
  };
  // 🚀 บันทึกไว้ก่อน — ยังไม่ตัดสต็อก, ให้กรอกรายละเอียดทีหลัง
  const handleMixQuickSave = async () => {
    if (txSaving || !mixModal) return;
    const item = mixModal.item;
    const qty = Number(mixQuickQty) || 0;
    if (qty <= 0 && mixRows.every(r => !Number(r.qty))) {
      alert("กรุณากรอกยอดรวมประมาณการ หรือใส่รายละเอียดอย่างน้อย 1 แถว");
      return;
    }
    setTxSaving(true);
    try {
      const payload = {
        itemId: item.id,
        itemModel: item.model,
        note: mixNote || "",
        quickQty: qty,
        rows: mixRows.filter(r => r.qty || r.size).map(r => ({ colorIdx: Number(r.colorIdx)||0, size: r.size||"", qty: Number(r.qty)||0 })),
        status: "pending",
        createdBy: user.name || "",
        createdAt: serverTimestamp(),
      };
      if (mixModal.pendingId) {
        await updateDoc(doc(db, "pendingMixSales", mixModal.pendingId), { ...payload, updatedAt: serverTimestamp() });
      } else {
        await addDoc(collection(db, "pendingMixSales"), payload);
      }
      logAudit(user, {
        action: AUDIT_ACTIONS.STOCK, collection: "pendingMixSales", targetId: mixModal.pendingId || "-", targetLabel: item.model,
        note: `🕐 บันทึกขายคละไว้ก่อน · ${qty || "?"} ตัว${mixNote ? ` · ${mixNote}` : ""}`,
      });
      setMixModal(null); setMixRows([]); setMixNote(""); setMixQuickQty("");
      setTxSuccess(true); setTimeout(() => setTxSuccess(false), 1500);
    } catch (e) {
      alert("บันทึกไม่สำเร็จ: " + (e.message || e));
    } finally { setTxSaving(false); }
  };
  // 🗑 ลบ pending
  const handleDeletePending = async (id) => {
    if (!window.confirm("ลบรายการที่รอระบุนี้?")) return;
    try { await deleteDoc(doc(db, "pendingMixSales", id)); } catch (e) { alert("ลบไม่สำเร็จ: " + (e.message || e)); }
  };

  // 🧺 ตัดสต็อกแบบคละสีคละไซส์ (หลายแถวในครั้งเดียว)
  const handleMixDispatch = async () => {
    if (txSaving || !mixModal) return;
    const item = mixModal.item;
    const rows = mixRows
      .map(r => ({ ...r, qty: Number(r.qty) }))
      .filter(r => r.size && r.qty > 0);
    if (rows.length === 0) return;
    // รวมจำนวนที่ต้องตัดต่อ (สี+ไซส์) เผื่อมีแถวซ้ำ
    const need = {};
    rows.forEach(r => { const k = `${r.colorIdx}|${r.size}`; need[k] = (need[k] || 0) + r.qty; });
    // ตรวจสต็อกพอไหม
    for (const k in need) {
      const [ci, sz] = k.split("|");
      const col = item.colors[Number(ci)];
      const stock = (col?.stock || {})[sz] || 0;
      if (need[k] > stock) { alert(`สต็อกไม่พอ: ${col?.colorName} ไซส์ ${sz} มี ${stock} ตัว แต่จะตัด ${need[k]} ตัว`); return; }
    }
    setTxSaving(true);
    try {
      const newColors = item.colors.map((c, ci) => {
        const stock = { ...(c.stock || {}) };
        Object.keys(need).forEach(k => {
          const [kci, ksz] = k.split("|");
          if (Number(kci) === ci) stock[ksz] = Math.max(0, (stock[ksz] || 0) - need[k]);
        });
        return { ...c, stock };
      });
      await updateDoc(doc(db, "clothing", item.id), { colors: newColors });
      const mixGroupId = `MIX-${Date.now()}`;
      for (const r of rows) {
        const col = item.colors[r.colorIdx];
        await addDoc(collection(db, "transactions"), {
          type: "จ่าย", code: item.id,
          name: `${item.model} / ${col.colorName} / ${r.size}`,
          qty: r.qty, by: user.name, date: now(),
          note: `ขายคละ${mixNote ? ` · ${mixNote}` : ""}`, mixGroupId,
          createdAt: serverTimestamp(), category: "เสื้อผ้า",
        });
      }
      const totalQty = rows.reduce((s, r) => s + r.qty, 0);
      logAudit(user, {
        action: AUDIT_ACTIONS.STOCK, collection: "clothing", targetId: item.id, targetLabel: item.model,
        note: `🧺 ขายคละ ${totalQty} ตัว [${rows.map(r => `${item.colors[r.colorIdx].colorName}/${r.size}:${r.qty}`).join(", ")}]${mixNote ? ` · ${mixNote}` : ""}`,
      });
      // 🕐 ถ้ามาจาก pending → ลบทิ้ง (ตัดสต็อกเรียบร้อยแล้ว)
      if (mixModal.pendingId) {
        try { await deleteDoc(doc(db, "pendingMixSales", mixModal.pendingId)); } catch {}
      }
      setMixModal(null); setMixRows([]); setMixNote(""); setMixQuickQty("");
      setTxSuccess(true); setTimeout(() => setTxSuccess(false), 1500);
    } catch (e) {
      alert("บันทึกไม่สำเร็จ: " + (e.message || e));
    } finally { setTxSaving(false); }
  };

  const handleAddColorToItem = async (itemId, colorObj) => {
    const item = clothingItems.find(i => i.id === itemId);
    if (!item) return;
    const initStock = {}; sizesFor(item).forEach(s => initStock[s] = 0);
    const newColors = [...(item.colors||[]), { ...colorObj, stock: initStock, costPrice: colorObj.costPrice||0, salePrice: colorObj.salePrice||0 }];
    await updateDoc(doc(db, "clothing", itemId), { colors: newColors });
    logAudit(user, {
      action: AUDIT_ACTIONS.UPDATE,
      collection: "clothing",
      targetId: itemId,
      targetLabel: `${item.model} · เพิ่มสี ${colorObj.colorName||""}`,
      note: `+ สี ${colorObj.colorName||"-"} (${colorObj.hex||""})`,
    });
    setShowAddColor(null); setCustomColorName(""); setNewColorHex("#ffffff");
    setNewColorCost(""); setNewColorSale("");
  };

  // 🎨 Toggle สีใน buffer (กดเพื่อ select/unselect)
  const togglePickedColor = (color) => setPickedColors(prev => {
    const has = prev.some(p => p.colorName === color.colorName);
    return has ? prev.filter(p => p.colorName !== color.colorName) : [...prev, color];
  });

  // 🎨 เพิ่มสีเองเข้า buffer (จาก custom color input)
  const addPickedFromCustom = () => {
    const name = customColorName.trim();
    if (!name) return;
    if (pickedColors.some(p => p.colorName === name)) {
      setCustomColorName("");
      return;
    }
    setPickedColors(prev => [...prev, { colorName: name, hex: newColorHex }]);
    setCustomColorName("");
    setNewColorHex("#ffffff");
  };

  // 📏 เพิ่มไซส์เฉพาะรุ่น (ตั้งชื่อเองได้ เช่น "ฟรีไซส์") — เพิ่มช่องสต็อก 0 ให้ทุกสีด้วย
  const addItemSize = async (item, raw) => {
    const sz = String(raw || "").trim();
    if (!item || !sz) return;
    const already = sizesFor(item).some(s => String(s).toUpperCase() === sz.toUpperCase());
    if (already) { alert(`ไซส์ "${sz}" มีอยู่แล้วในรุ่นนี้`); return; }
    const extra = [...(item.extraSizes || []), sz];
    const colors = (item.colors || []).map(c => ({ ...c, stock: { ...(c.stock || {}), [sz]: Number(c.stock?.[sz]) || 0 } }));
    await updateDoc(doc(db, "clothing", item.id), { extraSizes: extra, colors });
    logAudit(user, { action: AUDIT_ACTIONS.UPDATE, collection: "clothing", targetId: item.id, targetLabel: `${item.model} · เพิ่มไซส์`, note: `+ ไซส์: ${sz}` });
    setNewItemSize("");
  };

  // 📏 เอาไซส์ออกจากรุ่นนี้ — กันลบทิ้งทั้งที่ยังมีของอยู่
  //    ไซส์ที่เพิ่มเองในรุ่น → ลบทิ้งจริง | ไซส์มาตรฐาน/จากตั้งค่า → ซ่อนเฉพาะรุ่นนี้ (เอากลับมาได้)
  const removeItemSize = async (item, sz) => {
    if (!item) return;
    const inStock = (item.colors || []).reduce((s, c) => s + (Number(c.stock?.[sz]) || 0), 0);
    if (inStock > 0) { alert(`เอาออกไม่ได้ — ไซส์ "${sz}" ยังมีของอยู่ ${inStock} ตัว\nตัดสต็อกให้เหลือ 0 ก่อน`); return; }
    const isOwn = (item.extraSizes || []).includes(sz);
    if (!window.confirm(`เอาไซส์ "${sz}" ออกจากรุ่น ${item.model}?\n\n${isOwn ? "(ไซส์ที่เพิ่มเอง — จะถูกลบทิ้ง)" : "(ไซส์มาตรฐาน — แค่ซ่อนจากรุ่นนี้ กดเอากลับมาได้)"}`)) return;
    const colors = (item.colors || []).map(c => { const st = { ...(c.stock || {}) }; delete st[sz]; return { ...c, stock: st }; });
    const patch = isOwn
      ? { extraSizes: (item.extraSizes || []).filter(s => s !== sz), colors }
      : { hiddenSizes: [...(item.hiddenSizes || []), sz], colors };
    await updateDoc(doc(db, "clothing", item.id), patch);
    logAudit(user, { action: AUDIT_ACTIONS.UPDATE, collection: "clothing", targetId: item.id, targetLabel: `${item.model} · ${isOwn ? "ลบไซส์" : "ซ่อนไซส์"}`, note: `- ไซส์: ${sz}` });
  };

  // 📏 เอาไซส์ที่ซ่อนไว้กลับมาใช้กับรุ่นนี้
  const unhideItemSize = async (item, sz) => {
    if (!item) return;
    const colors = (item.colors || []).map(c => ({ ...c, stock: { ...(c.stock || {}), [sz]: Number(c.stock?.[sz]) || 0 } }));
    await updateDoc(doc(db, "clothing", item.id), { hiddenSizes: (item.hiddenSizes || []).filter(s => s !== sz), colors });
    logAudit(user, { action: AUDIT_ACTIONS.UPDATE, collection: "clothing", targetId: item.id, targetLabel: `${item.model} · เอาไซส์กลับมา`, note: `+ ไซส์: ${sz}` });
  };

  // 🎨 บันทึก buffer ทั้งหมดทีเดียว — update doc ครั้งเดียว
  const handleAddMultipleColors = async () => {
    if (!showAddColor || pickedColors.length === 0) return;
    const item = clothingItems.find(i => i.id === showAddColor);
    if (!item) return;
    const sizesList = sizesFor(item);
    // กรองสีที่ซ้ำกับที่มีอยู่ในรุ่นแล้ว
    const existingNames = new Set((item.colors||[]).map(c => c.colorName));
    const fresh = pickedColors.filter(c => !existingNames.has(c.colorName));
    if (fresh.length === 0) {
      setShowAddColor(null); setPickedColors([]); setCustomColorName(""); setNewColorHex("#ffffff");
      return;
    }
    const newColorObjs = fresh.map(c => {
      const initStock = {}; sizesList.forEach(s => initStock[s] = 0);
      return { colorName: c.colorName, hex: c.hex, stock: initStock, costPrice: 0, salePrice: 0 };
    });
    const newColors = [...(item.colors||[]), ...newColorObjs];
    await updateDoc(doc(db, "clothing", showAddColor), { colors: newColors });
    logAudit(user, {
      action: AUDIT_ACTIONS.UPDATE,
      collection: "clothing",
      targetId: showAddColor,
      targetLabel: `${item.model} · เพิ่ม ${fresh.length} สี`,
      note: `+ สี: ${fresh.map(c=>c.colorName).join(", ")}`,
    });
    setShowAddColor(null); setPickedColors([]); setCustomColorName(""); setNewColorHex("#ffffff");
  };

  const handleUpdateClothingStock = async (itemId, colorIdx, size, val) => {
    const item = clothingItems.find(i => i.id === itemId);
    if (!item) return;
    const col = item.colors?.[colorIdx];
    const oldQty = Number((col?.stock||{})[size]) || 0;
    const newQty = Math.max(0, Number(val)||0);
    // 🔗 ถ้าสีนี้ถูกผูก → ซิงก์ค่าไปยังทุกสีที่ผูกไว้ในไซส์เดียวกัน
    const links = linkedInvColors[itemId] || {};
    const targets = new Set([colorIdx]);
    if (links[colorIdx]) {
      Object.keys(links).forEach(ci => targets.add(Number(ci)));
    }
    const newColors = item.colors.map((c,i) => targets.has(i) ? {...c, stock:{...c.stock,[size]:newQty}} : c);
    await updateDoc(doc(db, "clothing", itemId), { colors: newColors });
    if (oldQty !== newQty) {
      const targetNames = Array.from(targets).map(i => item.colors?.[i]?.colorName || "-").join(", ");
      logAudit(user, {
        action: AUDIT_ACTIONS.STOCK,
        collection: "clothing",
        targetId: itemId,
        targetLabel: `${item.model} / ${targetNames} / ${size}`,
        note: `แก้สต๊อก ${oldQty}→${newQty}${targets.size>1?` · ผูก ${targets.size} สี`:""}`,
      });
    }
    setEditingStock(null);
  };

  const handleDeleteClothingItem = async (itemId) => {
    const item = clothingItems.find(i => i.id === itemId);
    await deleteDoc(doc(db, "clothing", itemId));
    logAudit(user, {
      action: AUDIT_ACTIONS.DELETE,
      collection: "clothing",
      targetId: itemId,
      targetLabel: item?.model || itemId,
      note: `ลบรุ่นเสื้อผ้า · ${(item?.colors||[]).length} สี`,
    });
  };

  // 🖱️ จัดลำดับรุ่นเสื้อผ้า/รองเท้า (drag & drop) → เขียน sortIndex ทุกตัวในแท็บ
  const reorderClothing = async (draggedId, targetId, orderedItems) => {
    if (!draggedId || !targetId || draggedId === targetId) return;
    const ids = orderedItems.map(i => i.id);
    const from = ids.indexOf(draggedId), to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    const arr = [...ids]; arr.splice(from, 1); arr.splice(to, 0, draggedId);
    try {
      const batch = writeBatch(db);
      arr.forEach((id, idx) => batch.update(doc(db, "clothing", id), { sortIndex: idx }));
      await batch.commit();
    } catch (e) { alert("จัดลำดับไม่สำเร็จ: " + (e.message || e)); }
  };

  // 📐 ─── BOM template (สูตรวัตถุดิบต่อรุ่นเสื้อ) ───
  const openBomModal = (clothingItem) => {
    const existing = boms.find(b => b.id === clothingItem.id || b.clothingId === clothingItem.id);
    const sizes = sizesFor(clothingItem) || [];
    const blankVariant = (name="ปกติ") => ({ name, materials: [] });
    const variants = existing?.variants?.length
      ? existing.variants.map(v => ({
          name: v.name || "ปกติ",
          materials: (v.materials||[]).map(m => ({
            productId: m.productId,
            productName: m.productName || "",
            unit: m.unit || "",
            isCostOnly: !!m.isCostOnly,
            mode: m.mode === "flat" ? "flat" : "perSize",
            flat: Number(m.flat)||0,
            perSize: { ...(m.perSize||{}) },
          })),
        }))
      : [blankVariant("ปกติ")];
    setBomModal({ clothingItem, variants, activeVariantIdx: 0, sizes, saving: false });
  };
  const updateBom = (updater) => setBomModal(b => b ? updater({...b}) : b);
  const addBomVariant = () => {
    const name = window.prompt("ชื่อ variant (เช่น แขนสั้น, แขนยาว):");
    if (!name?.trim()) return;
    updateBom(b => { b.variants = [...b.variants, { name: name.trim(), materials: [] }]; b.activeVariantIdx = b.variants.length - 1; return b; });
  };
  const renameBomVariant = (idx) => {
    const cur = bomModal?.variants[idx]?.name || "";
    const name = window.prompt("เปลี่ยนชื่อ variant:", cur);
    if (!name?.trim()) return;
    updateBom(b => { b.variants = b.variants.map((v,i) => i===idx ? {...v, name:name.trim()} : v); return b; });
  };
  const removeBomVariant = (idx) => {
    if (!window.confirm(`ลบ variant "${bomModal.variants[idx].name}"?`)) return;
    updateBom(b => {
      const newVars = b.variants.filter((_,i)=>i!==idx);
      if (newVars.length === 0) newVars.push({ name:"ปกติ", materials:[] });
      b.variants = newVars; b.activeVariantIdx = Math.max(0, Math.min(idx, newVars.length-1));
      return b;
    });
  };
  const addBomMaterial = (product) => {
    updateBom(b => {
      const v = b.variants[b.activeVariantIdx];
      if (v.materials.some(m => m.productId === product.id)) { alert("วัตถุดิบนี้มีในสูตรแล้ว"); return b; }
      const emptyPerSize = {}; (b.sizes||[]).forEach(s => emptyPerSize[s] = 0);
      v.materials = [...v.materials, {
        productId: product.id,
        productName: product.name || "",
        unit: product.unit || "",
        isCostOnly: !!product.isCostOnly,
        mode: "perSize", flat: 0, perSize: emptyPerSize,
      }];
      b.variants = b.variants.map((vv,i) => i===b.activeVariantIdx ? v : vv);
      return b;
    });
    setBomMaterialPickerOpen(false);
  };
  const removeBomMaterial = (matIdx) => {
    updateBom(b => {
      const v = b.variants[b.activeVariantIdx];
      v.materials = v.materials.filter((_,i)=>i!==matIdx);
      b.variants = b.variants.map((vv,i) => i===b.activeVariantIdx ? v : vv);
      return b;
    });
  };
  const setBomMaterialField = (matIdx, field, value) => {
    updateBom(b => {
      const v = b.variants[b.activeVariantIdx];
      v.materials = v.materials.map((m,i) => i===matIdx ? {...m, [field]:value} : m);
      b.variants = b.variants.map((vv,i) => i===b.activeVariantIdx ? v : vv);
      return b;
    });
  };
  const setBomMaterialSizeQty = (matIdx, size, value) => {
    updateBom(b => {
      const v = b.variants[b.activeVariantIdx];
      v.materials = v.materials.map((m,i) => i===matIdx ? {...m, perSize:{...m.perSize, [size]:value}} : m);
      b.variants = b.variants.map((vv,i) => i===b.activeVariantIdx ? v : vv);
      return b;
    });
  };
  // เติมค่าทุกไซส์จากค่าใดค่าหนึ่ง
  const fillBomRow = (matIdx, value) => {
    updateBom(b => {
      const v = b.variants[b.activeVariantIdx];
      const sz = b.sizes || [];
      v.materials = v.materials.map((m,i) => {
        if (i!==matIdx) return m;
        const ps = {}; sz.forEach(s => ps[s] = value);
        return {...m, perSize: ps};
      });
      b.variants = b.variants.map((vv,i) => i===b.activeVariantIdx ? v : vv);
      return b;
    });
  };
  const saveBom = async () => {
    if (!bomModal) return;
    const { clothingItem, variants } = bomModal;
    setBomModal(b => ({...b, saving:true}));
    try {
      const cleanVariants = variants.map(v => ({
        name: v.name || "ปกติ",
        materials: (v.materials||[]).map(m => ({
          productId: m.productId,
          productName: m.productName,
          unit: m.unit,
          isCostOnly: !!m.isCostOnly,
          mode: m.mode,
          flat: Number(m.flat)||0,
          perSize: Object.fromEntries(Object.entries(m.perSize||{}).map(([k,v])=>[k, Number(v)||0])),
        })),
      }));
      await setDoc(doc(db, "boms", clothingItem.id), {
        clothingId: clothingItem.id,
        clothingName: clothingItem.model || "",
        variants: cleanVariants,
        updatedAt: new Date().toISOString(),
        updatedBy: user?.name || "",
      });
      setBomModal(null);
    } catch (e) {
      alert("บันทึกสูตรไม่สำเร็จ: " + (e.message||e));
      setBomModal(b => b ? {...b, saving:false} : b);
    }
  };

  const handleDeleteClothingColor = async (itemId, colorIdx) => {
    const item = clothingItems.find(i => i.id === itemId);
    if (!item) return;
    const removedColor = item.colors[colorIdx];
    const newColors = item.colors.filter((_,i) => i !== colorIdx);
    await updateDoc(doc(db, "clothing", itemId), { colors: newColors });
    logAudit(user, {
      action: AUDIT_ACTIONS.DELETE,
      collection: "clothing",
      targetId: itemId,
      targetLabel: `${item.model} / ${removedColor?.colorName||""}`,
      note: `ลบสี ${removedColor?.colorName||""} ออกจากรุ่น`,
    });
  };


  // ── Order handlers ────────────────────────────────────────────
  const handleAddCustomer = async () => {
    if (!newCustomerForm.name.trim()) return;
    const ref = await addDoc(collection(db, "customers"), withCustomerSearchKeys({ ...newCustomerForm, createdAt: serverTimestamp() }));
    logAudit(user, {
      action: AUDIT_ACTIONS.CREATE,
      collection: "customers",
      targetId: ref.id,
      targetLabel: newCustomerForm.name,
      after: { ...newCustomerForm },
    });
    setNewCustomerForm({ name:"", phone:"", address:"" });
    setShowNewCustomer(false);
    // 🔍 ล้างตัวกรอง/คำค้นหา — กันลูกค้าใหม่หายไปเพราะโดนกรองด้วยภาค/คำค้นเดิมที่ค้างอยู่
    setCustomerRegion("ทั้งหมด");
    setCustomerSearch("");
  };

  const handleSelectCustomer = (cust) => {
    setOrderForm(f => ({ ...f, customerId: cust.id, customerName: cust.name, customerPhone: cust.phone, customerAddress: cust.address }));
    setCustomerSearch("");
  };

  // 🧺 เพิ่มรายการคละใน order (ยังไม่ระบุสี/ไซส์ → รอกรอกทีหลัง)
  const addOrderMixItem = () => {
    const clothingId = orderMixForm.clothingId;
    const qty = Number(orderMixForm.qty) || 0;
    if (!clothingId || qty <= 0) return;
    const item = clothingItems.find(i => i.id === clothingId);
    if (!item) return;
    setOrderForm(f => ({
      ...f,
      items: [...(f.items||[]), {
        clothingId,
        clothingName: item.model || "",
        colorIdx: -1,
        colorName: "— คละ (รอระบุ) —",
        colorHex: "#f59e0b",
        size: "—",
        qty,
        isMix: true,
      }],
    }));
    setOrderMixForm({ clothingId: "", qty: "" });
  };
  // ✏️ เปิด modal กรอกรายละเอียดของ order ที่ค้าง (grid mode)
  const openFillOrderMix = (order) => {
    const init = {};
    (order.items||[]).forEach((it, idx) => {
      if (it.isMix) init[idx] = {}; // { [colorIdx]: { [size]: qtyStr } }
    });
    setFillRowsByIdx(init);
    setFillOrderMix({ order });
  };
  // 🧩 helper: convert grid { [ci]: { [sz]: q } } → rows [{colorIdx, size, qty}]
  const gridToRows = (grid) => {
    const rows = [];
    Object.entries(grid||{}).forEach(([ci, byS]) => {
      Object.entries(byS||{}).forEach(([sz, q]) => {
        const qn = Number(q)||0;
        if (qn > 0) rows.push({ colorIdx: Number(ci), size: sz, qty: qn });
      });
    });
    return rows;
  };
  // 💾 บันทึกรายละเอียดที่กรอก → แทน mix items ด้วยรายการจริง + ตัดสต็อก
  const handleSaveFillOrderMix = async () => {
    if (!fillOrderMix) return;
    const order = fillOrderMix.order;
    const items = [...(order.items||[])];
    // 🧩 แปลง grid → rows แล้วตรวจ
    const rowsByIdx = {};
    for (const [idxStr, grid] of Object.entries(fillRowsByIdx)) {
      rowsByIdx[idxStr] = gridToRows(grid);
    }
    for (const [idxStr, rows] of Object.entries(rowsByIdx)) {
      const idx = Number(idxStr);
      const mixItem = items[idx];
      if (!mixItem || !mixItem.isMix) continue;
      const sum = rows.reduce((s,r)=>s+(Number(r.qty)||0), 0);
      if (rows.length === 0) { alert(`รายการ "${mixItem.clothingName}" ยังไม่ได้กรอกเลย`); return; }
      if (sum !== Number(mixItem.qty)) { alert(`รายการ "${mixItem.clothingName}" ผลรวม ${sum} ≠ ${mixItem.qty} ตัว`); return; }
    }
    // ตรวจสต็อกพอไหม (รวมทุก mix)
    const stockNeed = new Map();
    for (const [idxStr, rows] of Object.entries(rowsByIdx)) {
      const idx = Number(idxStr);
      const mixItem = items[idx];
      for (const r of rows) {
        const k = `${mixItem.clothingId}|${r.colorIdx}|${r.size}`;
        stockNeed.set(k, (stockNeed.get(k)||0) + Number(r.qty));
      }
    }
    for (const [k, need] of stockNeed) {
      const [cid, ci, sz] = k.split("|");
      const cItem = clothingItems.find(x => x.id === cid);
      const stock = ((cItem?.colors?.[Number(ci)]||{}).stock||{})[sz] || 0;
      if (need > stock) {
        const cname = cItem?.colors?.[Number(ci)]?.colorName || "?";
        if (!window.confirm(`⚠️ สต็อก ${cItem?.model}/${cname}/${sz} มี ${stock} แต่ต้องตัด ${need} — ตัดต่อไหม? (สต็อกจะเป็น 0)`)) return;
      }
    }
    // แทน mix items ด้วยรายการจริง
    const newItems = [];
    items.forEach((it, idx) => {
      if (it.isMix && rowsByIdx[idx]) {
        for (const r of rowsByIdx[idx]) {
          const cItem = clothingItems.find(x => x.id === it.clothingId);
          const col = cItem?.colors?.[Number(r.colorIdx)];
          newItems.push({
            clothingId: it.clothingId, clothingName: it.clothingName,
            colorIdx: Number(r.colorIdx),
            colorName: col?.colorName || "?",
            colorHex: col?.colorHex || col?.hex || "#999",
            size: r.size, qty: Number(r.qty),
          });
        }
      } else {
        newItems.push(it);
      }
    });
    // ตัดสต็อก
    const byClothing = new Map();
    for (const [k, need] of stockNeed) {
      const [cid, ci, sz] = k.split("|");
      if (!byClothing.has(cid)) byClothing.set(cid, []);
      byClothing.get(cid).push({ colorIdx: Number(ci), size: sz, qty: need });
    }
    for (const [cid, cuts] of byClothing) {
      const item = clothingItems.find(x => x.id === cid);
      if (!item) continue;
      const newColors = item.colors.map((c, i) => {
        const forThis = cuts.filter(u => u.colorIdx === i);
        if (forThis.length === 0) return c;
        const st = { ...(c.stock || {}) };
        for (const u of forThis) st[u.size] = Math.max(0, (st[u.size]||0) - u.qty);
        return { ...c, stock: st };
      });
      await updateDoc(doc(db, "clothing", cid), { colors: newColors });
    }
    // บันทึก transactions สำหรับรายการที่เพิ่งกรอก
    for (const it of newItems.filter(x => !x.isMix)) {
      const wasMix = !(order.items||[]).some(o => !o.isMix && o.clothingId===it.clothingId && o.colorIdx===it.colorIdx && o.size===it.size && o.qty===it.qty);
      if (!wasMix) continue; // ข้าม normal item เดิม
      try {
        await addDoc(collection(db, "transactions"), {
          type: "จ่าย", code: it.clothingId,
          name: `${it.clothingName} / ${it.colorName} / ${it.size}`,
          qty: it.qty, by: user.name, date: now(),
          note: `ใบสั่งของ (คละ→ระบุ): ${order.customerName}`,
          stockAffected: true,
          createdAt: serverTimestamp(), category: "เสื้อผ้า",
        });
      } catch {}
    }
    // อัพเดต order
    await updateDoc(doc(db, "orders", order.id), {
      items: newItems,
      hasPendingMix: false,
      status: "สำเร็จ",
      filledAt: new Date().toISOString(),
      filledBy: user.name || "",
    });
    logAudit(user, {
      action: AUDIT_ACTIONS.UPDATE, collection: "orders", targetId: order.id, targetLabel: `${order.orderNo} · ${order.customerName}`,
      note: `✏️ กรอกรายละเอียดคละครบ · ${newItems.length} รายการ · ตัดสต็อกเรียบร้อย`,
    });
    setFillOrderMix(null); setFillRowsByIdx({});
  };

  const handleConfirmOrder = async () => {
    if (!orderForm.customerName || orderForm.items.length === 0) return;
    const isEditing = !!editingOrderId;
    const oldOrder = isEditing ? orders.find(o => o.id === editingOrderId) : null;
    if (isEditing && !oldOrder) { alert("ไม่พบใบสั่งของที่จะแก้ไข"); return; }

    // 🧺 แยก mix items (ยังไม่ระบุสี/ไซส์) ออก — ไม่ตัดสต๊อกจนกว่าจะกรอกครบ
    const mixItems = orderForm.items.filter(i => i.isMix);
    const normalItems = orderForm.items.filter(i => !i.isMix);
    const hasPendingMix = mixItems.length > 0;
    const deferStockCut = !!orderForm.deferStockCut;

    // ── EDIT: คืนสต๊อกของ items เก่าก่อน (ถ้าใบเดิมได้ตัดสต๊อกไปแล้ว) ──
    if (isEditing) {
      const oldSkipRestock = !!oldOrder.deferStockCut || !!oldOrder.hasPendingMix;
      if (!oldSkipRestock) {
        const restockByClothing = new Map();
        for (const oi of (oldOrder.items || [])) {
          if (oi.isMix) continue;
          if (!clothingItems.find(i => i.id === oi.clothingId)) continue;
          if (!restockByClothing.has(oi.clothingId)) restockByClothing.set(oi.clothingId, []);
          restockByClothing.get(oi.clothingId).push(oi);
        }
        for (const [clothingId, ois] of restockByClothing) {
          const item = clothingItems.find(i => i.id === clothingId);
          const newColors = item.colors.map((c, i) => {
            const adds = ois.filter(oi => oi.colorIdx === i);
            if (adds.length === 0) return c;
            const newStock = { ...(c.stock || {}) };
            for (const oi of adds) newStock[oi.size] = (newStock[oi.size] || 0) + (Number(oi.qty) || 0);
            return { ...c, stock: newStock };
          });
          await updateDoc(doc(db, "clothing", clothingId), { colors: newColors });
        }
        // log tx "รับ" คืนของเก่า
        for (const oi of (oldOrder.items || [])) {
          const isLinked = !!clothingItems.find(i => i.id === oi.clothingId);
          await addDoc(collection(db, "transactions"), {
            type: "รับ", code: oi.clothingId,
            name: `${oi.clothingName} / ${oi.colorName} / ${oi.size}`,
            qty: Number(oi.qty) || 0, by: user.name, date: now(),
            note: `แก้ไขใบสั่งของ ${oldOrder.orderNo}: คืนของเดิม`,
            stockAffected: isLinked,
            createdAt: serverTimestamp(), category: "เสื้อผ้า"
          });
        }
      }
    }

    // ── ตัดสต๊อกใหม่ ──
    const byClothing = new Map();
    for (const oi of normalItems) {
      if (!clothingItems.find(i => i.id === oi.clothingId)) continue;
      if (!byClothing.has(oi.clothingId)) byClothing.set(oi.clothingId, []);
      byClothing.get(oi.clothingId).push(oi);
    }
    if (!deferStockCut) {
      for (const [clothingId, ois] of byClothing) {
        const item = clothingItems.find(i => i.id === clothingId);
        const newColors = item.colors.map((c, i) => {
          const cuts = ois.filter(oi => oi.colorIdx === i);
          if (cuts.length === 0) return c;
          const newStock = { ...(c.stock || {}) };
          for (const oi of cuts) {
            newStock[oi.size] = Math.max(0, (newStock[oi.size] || 0) - oi.qty);
          }
          return { ...c, stock: newStock };
        });
        await updateDoc(doc(db, "clothing", clothingId), { colors: newColors });
      }
    }
    for (const oi of normalItems) {
      const isLinked = !!clothingItems.find(i => i.id === oi.clothingId);
      const isFree = typeof oi.clothingId === "string" && oi.clothingId.startsWith("free_");
      const isCustom = typeof oi.clothingId === "string" && oi.clothingId.startsWith("custom_");
      const noteSuffix = isFree ? " (รายการอิสระ — ไม่ตัดสต๊อก)" : isCustom ? " (custom order — ไม่ตัดสต๊อก)" : deferStockCut ? " (🔓 ขายก่อน ไม่ตัดสต๊อก)" : "";
      const editPrefix = isEditing ? `แก้ไขใบสั่งของ ${oldOrder.orderNo}: ` : "ใบสั่งของ: ";
      await addDoc(collection(db, "transactions"), {
        type: "จ่าย", code: oi.clothingId,
        name: `${oi.clothingName} / ${oi.colorName} / ${oi.size}`,
        qty: oi.qty, by: user.name, date: now(),
        note: `${editPrefix}${orderForm.customerName}${noteSuffix}`,
        stockAffected: isLinked && !deferStockCut,
        createdAt: serverTimestamp(), category: "เสื้อผ้า"
      });
    }

    const totalQty = orderForm.items.reduce((s,i)=>s+i.qty,0);
    if (isEditing) {
      // updateDoc — คงค่า orderNo/date/by/createdAt เดิม
      await updateDoc(doc(db, "orders", editingOrderId), withSearchKeys({
        ...orderForm,
        status: hasPendingMix ? "รอระบุ" : "สำเร็จ",
        hasPendingMix,
        editedBy: user.name, editedAt: now(),
      }));
      logAudit(user, {
        action: AUDIT_ACTIONS.UPDATE,
        collection: "orders",
        targetId: editingOrderId,
        targetLabel: `${oldOrder.orderNo} · ${orderForm.customerName}`,
        note: `แก้ไข: ${orderForm.items.length} รายการ · ${totalQty} ชิ้น${hasPendingMix?` · 🕐 คละ ${mixItems.length} รายการ (รอระบุ)`:""}`,
      });
    } else {
      const orderNo = await reserveDocNo(db, "ORD", orders, "orderNo");
      const ref = await addDoc(collection(db, "orders"), withSearchKeys({
        orderNo, ...orderForm,
        status: hasPendingMix ? "รอระบุ" : "สำเร็จ",
        hasPendingMix,
        by: user.name, date: now(), createdAt: serverTimestamp()
      }));
      logAudit(user, {
        action: AUDIT_ACTIONS.CREATE,
        collection: "orders",
        targetId: ref.id,
        targetLabel: `${orderNo} · ${orderForm.customerName}`,
        note: `${orderForm.items.length} รายการ · ${totalQty} ชิ้น${hasPendingMix?` · 🕐 คละ ${mixItems.length} รายการ (รอระบุ)`:""}`,
      });
    }
    setOrderForm({ customerId:"", customerName:"", customerPhone:"", customerAddress:"", shipping:"", note:"", items:[], deferStockCut:false });
    setEditingOrderId(null);
    setShowNewOrder(false);
    // 💾 บันทึกลงระบบแล้ว → ไม่ต้องเก็บร่างไว้อีก
    clearOrderDraft();
  };

  // ✏️ เปิดหน้าแก้ไขใบสั่งของ — โหลดข้อมูลลง orderForm แล้วเปิด modal เดียวกับตอนสร้าง
  // ── 📥 แปลงออเดอร์จาก Catalog → ใบสั่งของ ────────────────────
  // แยกออกมาเป็นฟังก์ชันกลาง เพราะใช้ 2 ทาง: กดทีละใบ กับ แปลงเป็นชุด
  // คืน { ok, orderNo?, message? } แทนการ alert เอง — ฝั่งเรียกจัดการเอง
  //   (แปลงเป็นชุดต้องสรุปทีเดียว ไม่ใช่เด้ง alert 235 ครั้ง)
  const convertCatalogOrder = async (co, customerChoice) => {
    // 🔒 จองสิทธิ์แบบ atomic — กันสองคนแปลงใบเดียวกันพร้อมกัน
    try {
      await runTransaction(db, async (tx) => {
        const ref = doc(db, "catalogOrders", co.id);
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error("ORDER_GONE");
        const d = snap.data();
        if (d.status === "converted") throw new Error("ALREADY_CONVERTED");
        const lockAge = d.convertingAt?.toMillis ? Date.now() - d.convertingAt.toMillis() : Infinity;
        if (d.convertingBy && d.convertingBy !== user.name && lockAge < 120000) throw new Error("LOCKED:" + d.convertingBy);
        tx.update(ref, { convertingBy: user.name, convertingAt: serverTimestamp() });
      });
    } catch (e) {
      const m = String(e.message || "");
      if (m === "ALREADY_CONVERTED") return { ok: false, reason: "converted", message: "⚠️ ใบนี้ถูกแปลงเป็นคำสั่งซื้อไปแล้ว\n(อาจมีคนอื่นทำไปพร้อมกัน) — ลองรีเฟรชดู" };
      if (m === "ORDER_GONE") return { ok: false, reason: "gone", message: "⚠️ ไม่พบใบนี้แล้ว — อาจถูกลบไป" };
      if (m.startsWith("LOCKED:")) return { ok: false, reason: "locked", message: `⚠️ ${m.slice(7)} กำลังแปลงใบนี้อยู่\nรอสักครู่แล้วลองใหม่` };
      return { ok: false, reason: "lock-failed", message: "เริ่มแปลงไม่สำเร็จ: " + m };
    }

    const unlock = async () => {
      try { await updateDoc(doc(db, "catalogOrders", co.id), { convertingBy: null, convertingAt: null }); } catch {}
    };

    try {
      // 1) ลูกค้า
      let customerId = "";
      if (customerChoice?.mode === "existing") {
        customerId = customerChoice.existingId || "";
      } else if (customerChoice?.mode === "new") {
        const cref = await addDoc(collection(db, "customers"), withCustomerSearchKeys({
          name: co.customerName || "(ลูกค้าใหม่)",
          phone: co.phone || "",
          address: co.address || "",
          taxId: "",
          note: "จาก Catalog",
          createdAt: serverTimestamp(),
        }));
        customerId = cref.id;
      }
      // mode === "none" → customerId = "" (ขายครั้งเดียว ไม่ผูกลูกค้า)

      // 2) แปลง entries → items (รองรับ multi-item cart + single-item เก่า)
      const items = [];
      const cartEntries = (co.items && co.items.length > 0)
        ? co.items
        : [{ itemId: co.itemId, itemName: co.itemName, lines: co.lines || [] }];
      for (const entry of cartEntries) {
        const ci = clothingItems.find(c => c.id === entry.itemId);
        if (!ci) continue;
        for (const ln of (entry.lines || [])) {
          let colorIdx = (typeof ln.colorIdx === "number" && ln.colorIdx >= 0)
            ? ln.colorIdx
            : (ci.colors || []).findIndex(c => (c.colorName || c.name) === ln.color);
          if (colorIdx < 0 || colorIdx >= (ci.colors || []).length) continue;
          const colorData = ci.colors[colorIdx];
          items.push({
            clothingId: ci.id,
            clothingName: ci.model || ci.name || `สินค้า ${ci.id.slice(0,6)}`,
            colorIdx,
            colorName: colorData.colorName || colorData.name || ln.color || `สี #${colorIdx+1}`,
            size: ln.size,
            qty: Number(ln.qty) || 0,
            unitPrice: getPriceForSize(colorData, ln.size) || 0,
          });
        }
      }
      if (items.length === 0) {
        await unlock();
        return { ok: false, reason: "no-items", message: "⚠️ แปลงไม่ได้ — ไม่พบสินค้า/สี/ไซส์ ที่ตรงกับในระบบ\n(สินค้าอาจถูกลบไปแล้ว)" };
      }

      // 3) สร้างใบสั่งของ (ยังไม่ตัดสต๊อก)
      const orderNo = await reserveDocNo(db, "ORD", orders, "orderNo");
      const oref = await addDoc(collection(db, "orders"), withSearchKeys({
        orderNo, customerId,
        customerName: co.customerName || "",
        customerPhone: co.phone || "",
        customerAddress: co.address || "",
        note: `จาก Catalog Inbox${co.note ? ` · ${co.note}` : ""}`,
        items,
        status: "รอดำเนินการ",
        by: user.name,
        date: now(),
        createdAt: serverTimestamp(),
        fromCatalog: co.id,
      }));

      // 4) ปิดใบใน Inbox + ปลดล็อก
      await updateDoc(doc(db, "catalogOrders", co.id), {
        status: "converted",
        convertedOrderId: oref.id,
        convertedOrderNo: orderNo,
        convertingBy: null,
        convertingAt: null,
      });
      logAudit(user, {
        action: AUDIT_ACTIONS.CREATE, collection: "orders", targetId: oref.id,
        targetLabel: `${orderNo} · ${co.customerName}`,
        note: `แปลงจาก Catalog · ${items.length} รายการ`,
      });
      return { ok: true, orderNo, orderId: oref.id };
    } catch (e) {
      await unlock(); // พังกลางทาง → ปลดล็อก ไม่ให้คนอื่นติด 2 นาที
      return { ok: false, reason: "failed", message: "สร้างคำสั่งซื้อไม่สำเร็จ: " + (e.message || e) };
    }
  };

  // 📦 แปลงเป็นชุด — ทำเฉพาะใบที่ "มั่นใจว่าเป็นลูกค้าคนไหน" ที่เหลือกองไว้ให้ทำมือ
  const [bulkConverting, setBulkConverting] = useState(null); // { done, total } | null
  const handleBulkConvert = async (list) => {
    if (!list?.length || bulkConverting) return;
    const normPhone = (s) => String(s || "").replace(/\D/g, "");
    // มั่นใจ = มาจากลิงก์ส่วนตัว (customerId) หรือเบอร์ตรงกับลูกค้าในระบบ "รายเดียว"
    const decide = (co) => {
      if (co.customerId && customers.some(c => c.id === co.customerId)) return { mode: "existing", existingId: co.customerId };
      const key = normPhone(co.phone);
      if (!key) return null;
      const hits = customers.filter(c => normPhone(c.phone) === key);
      return hits.length === 1 ? { mode: "existing", existingId: hits[0].id } : null; // เบอร์ซ้ำหลายราย = ไม่มั่นใจ
    };

    const ready = [], unsure = [];
    list.forEach(co => { const d = decide(co); (d ? ready : unsure).push({ co, choice: d }); });

    if (ready.length === 0) {
      alert(`ไม่มีใบที่ระบบมั่นใจว่าเป็นลูกค้าคนไหน (${unsure.length} ใบ)\n\nกดแปลงทีละใบเพื่อเลือกลูกค้าเองนะครับ`);
      return;
    }
    if (!window.confirm(
      `แปลง ${ready.length} ใบเป็นใบสั่งของ?\n\n` +
      `✅ จะแปลงเลย ${ready.length} ใบ (รู้แน่ว่าเป็นลูกค้าคนไหน)\n` +
      (unsure.length > 0 ? `⏸ ข้าม ${unsure.length} ใบ (ไม่แน่ใจลูกค้า — ค่อยกดทีละใบ)\n` : "") +
      `\n⚠️ ยังไม่ตัดสต๊อก — ไปยืนยันที่หน้าใบสั่งของอีกที`
    )) return;

    setBulkConverting({ done: 0, total: ready.length });
    const fails = [];
    let okCount = 0;
    for (let i = 0; i < ready.length; i++) {
      const { co, choice } = ready[i];
      const r = await convertCatalogOrder(co, choice);
      if (r.ok) okCount++;
      else fails.push(`• ${co.customerName || "(ไม่ระบุชื่อ)"} — ${r.message.replace(/⚠️\s*/g, "").split("\n")[0]}`);
      setBulkConverting({ done: i + 1, total: ready.length });
    }
    setBulkConverting(null);
    alert(
      `✅ แปลงสำเร็จ ${okCount} ใบ\n` +
      (fails.length > 0 ? `\n❌ ไม่สำเร็จ ${fails.length} ใบ:\n${fails.slice(0, 10).join("\n")}${fails.length > 10 ? `\n... และอีก ${fails.length - 10} ใบ` : ""}\n` : "") +
      (unsure.length > 0 ? `\n⏸ ข้าม ${unsure.length} ใบ (ไม่แน่ใจลูกค้า)` : "")
    );
  };

  const openEditOrder = (o) => {
    if (!o) return;
    // เช็คว่าออกบิลไปแล้วหรือยัง — ดูจากลิงก์จริงเท่านั้น
    // (เดิมเดาจากชื่อลูกค้า+วันที่ → ลูกค้าสั่งหลายใบต่อวันจะเตือนผิดทุกใบ)
    // o.invoiceId = ปั๊มไว้ตอนออกบิล → เตือนได้ถูกแม้บิลใบนั้นอยู่นอกช่วงวันที่ที่โหลดมา
    const invoiced = !!o.invoiceId || invoices.some(inv => (inv.mergedFromOrderIds || []).includes(o.id));
    if (invoiced) {
      if (!window.confirm(`⚠️ ใบสั่งของ ${o.orderNo} ถูกออกบิลไปแล้ว\nการแก้ไขจะไม่กระทบกับใบเสร็จเดิม\n\nยืนยันแก้ไข?`)) return;
    }
    setOrderForm({
      customerId: o.customerId || "",
      customerName: o.customerName || "",
      customerPhone: o.customerPhone || "",
      customerAddress: o.customerAddress || "",
      shipping: o.shipping || "",
      note: o.note || "",
      items: (o.items || []).map(i => ({ ...i })),
      deferStockCut: !!o.deferStockCut,
      depositAmount: o.depositAmount || "",
      depositMethod: o.depositMethod || "โอน",
    });
    setCustomerSearch("");
    setEditingOrderId(o.id);
    setShowNewOrder(true);
  };

  // ยกเลิก/ลบใบสั่งของ — คืนสต๊อกกลับ clothing ก่อนลบ (ข้ามถ้าใบนี้เป็น deferStockCut / hasPendingMix)
  const handleDeleteOrder = async (o) => {
    if (!o) return;
    const totalQty = (o.items || []).reduce((s,i) => s + (Number(i.qty)||0), 0);
    const skipRestock = !!o.deferStockCut || !!o.hasPendingMix;
    if (!window.confirm(`ยกเลิกใบสั่งของ ${o.orderNo}?
ลูกค้า: ${o.customerName}
${(o.items||[]).length} รายการ · ${totalQty} ชิ้น

${skipRestock ? "ℹ️ ใบนี้ยังไม่ได้ตัดสต๊อก — ยกเลิกไม่คืนสต๊อก" : "⚠️ สินค้าจะถูกคืนกลับสต๊อก"}`)) return;

    // 🔓 ถ้าใบนี้ยังไม่ตัดสต๊อก → ไม่ต้องคืน
    if (!skipRestock) {
      // จัดกลุ่ม items ตาม clothingId เพื่อ updateDoc ครั้งเดียวต่อเสื้อ
      const byClothing = new Map();
      for (const oi of (o.items || [])) {
        if (oi.isMix) continue; // ข้าม mix items ที่ยังไม่ระบุ
        if (!clothingItems.find(i => i.id === oi.clothingId)) continue; // ข้าม free_/custom_
        if (!byClothing.has(oi.clothingId)) byClothing.set(oi.clothingId, []);
        byClothing.get(oi.clothingId).push(oi);
      }
      for (const [clothingId, ois] of byClothing) {
        const item = clothingItems.find(i => i.id === clothingId);
        const newColors = item.colors.map((c, i) => {
          const adds = ois.filter(oi => oi.colorIdx === i);
          if (adds.length === 0) return c;
          const newStock = { ...(c.stock || {}) };
          for (const oi of adds) {
            newStock[oi.size] = (newStock[oi.size] || 0) + (Number(oi.qty) || 0);
          }
          return { ...c, stock: newStock };
        });
        await updateDoc(doc(db, "clothing", clothingId), { colors: newColors });
      }
    }
    // บันทึก transaction "รับ" ทีละ item (รวม free_/custom_ — note ว่า no-stock)
    for (const oi of (o.items || [])) {
      const isLinked = !!clothingItems.find(i => i.id === oi.clothingId);
      const isFree = typeof oi.clothingId === "string" && oi.clothingId.startsWith("free_");
      const isCustom = typeof oi.clothingId === "string" && oi.clothingId.startsWith("custom_");
      const noteSuffix = isFree ? " (รายการอิสระ — ไม่คืนสต๊อก)" : isCustom ? " (custom order — ไม่คืนสต๊อก)" : "";
      await addDoc(collection(db, "transactions"), {
        type: "รับ", code: oi.clothingId,
        name: `${oi.clothingName} / ${oi.colorName} / ${oi.size}`,
        qty: Number(oi.qty) || 0, by: user.name, date: now(),
        note: `ยกเลิกใบสั่งของ: ${o.orderNo} · ${o.customerName}${noteSuffix}`,
        stockAffected: isLinked,
        createdAt: serverTimestamp(), category: "เสื้อผ้า"
      });
    }
    await deleteDoc(doc(db, "orders", o.id));
    logAudit(user, {
      action: AUDIT_ACTIONS.DELETE,
      collection: "orders",
      targetId: o.id,
      targetLabel: `${o.orderNo} · ${o.customerName}`,
      note: `ยกเลิก + คืนสต๊อก (${(o.items||[]).length} รายการ · ${totalQty} ชิ้น)`,
    });
  };

  const handleClothingTx = async () => {
    if (txSaving) return; // กัน double-submit (ใช้ flag เดียวกัน)
    if (!clothingTxModal) return;
    // รวมรายการไซส์ที่มีจำนวน > 0 (รองรับหลายไซส์พร้อมกัน)
    const entries = Object.entries(clothingTxSizeQty)
      .map(([sz, q]) => [sz, Number(q)])
      .filter(([, q]) => q > 0);
    if (entries.length === 0) return;
    setTxSaving(true);
    try {
      const { item, colorIdx } = clothingTxModal;
      // 🔗 รวมทุกสีที่เลือก (สีปัจจุบัน + สีที่ติ๊กเพิ่ม)
      const allColorIdxs = new Set([colorIdx, ...clothingTxExtraColors]);
      // คำนวณสต็อกใหม่ทุกไซส์สำหรับทุกสีที่เลือก
      const newColors = item.colors.map((c, i) => {
        if (!allColorIdxs.has(i)) return c;
        const newStock = { ...(c.stock || {}) };
        for (const [sz, q] of entries) {
          const curQty = newStock[sz] || 0;
          const newQty = clothingTxType === "รับ" ? curQty + q : Math.max(0, curQty - q);
          newStock[sz] = newQty;
        }
        return { ...c, stock: newStock };
      });
      await updateDoc(doc(db, "clothing", item.id), { colors: newColors });
      // 1 transaction ต่อ 1 สี × 1 ไซส์
      for (const ci of allColorIdxs) {
        const c = item.colors[ci];
        for (const [sz, q] of entries) {
          await addDoc(collection(db, "transactions"), {
            type: clothingTxType, code: item.id,
            name: `${item.model} / ${c.colorName} / ${sz}`,
            qty: q, by: user.name,
            date: now(), note: clothingTxNote || "", createdAt: serverTimestamp(),
            category: "เสื้อผ้า"
          });
        }
      }
      const totalQty = entries.reduce((s, [, q]) => s + q, 0) * allColorIdxs.size;
      const colorNames = Array.from(allColorIdxs).map(i => item.colors[i]?.colorName).join(", ");
      logAudit(user, {
        action: AUDIT_ACTIONS.STOCK,
        collection: "clothing",
        targetId: item.id,
        targetLabel: `${item.model} / ${colorNames}`,
        note: `${clothingTxType} ${totalQty} ชิ้น [${entries.map(([sz,q]) => `${sz}:${q}`).join(", ")}]${allColorIdxs.size>1?` · ${allColorIdxs.size} สี`:""}${clothingTxNote ? ` · ${clothingTxNote}` : ""}`,
      });
      // ปิด modal + reset ทันที — กันกดซ้ำ
      setClothingTxModal(null);
      setClothingTxQty(""); setClothingTxSizeQty({}); setClothingTxNote("");
      setClothingTxExtraColors(new Set());
      setTxSuccess(true);
      setTimeout(() => setTxSuccess(false), 1500);
    } catch (e) {
      console.error("[handleClothingTx] failed:", e);
      alert("บันทึกไม่สำเร็จ: " + (e.message || e));
    } finally {
      setTxSaving(false);
    }
  };

  const handleClothingImageUpload = async (e) => {
    const file = e.target.files[0]; if (!file || !uploadingClothingId) return;
    try {
      const dataUrl = await compressImage(file, { maxDim: 1200, quality: 0.78 });
      const { url, path } = await uploadImage(dataUrl, "clothing");
      const it = clothingItems.find(c => c.id === uploadingClothingId);
      if (it?.imagePath) deleteFile(it.imagePath); // ลบรูปเก่า
      await updateDoc(doc(db, "clothing", uploadingClothingId), { image: url, imagePath: path });
    } catch (err) {
      alert("อัปโหลดรูปไม่สำเร็จ: " + (err?.message || err));
    } finally {
      setUploadingClothingId(null);
      if (e.target) e.target.value = "";
    }
  };


  // ── Invoice handlers ──────────────────────────────────────────
  const handleSaveCompany = async (data) => {
    await setDoc(doc(db,"settings","company"), data);
  };

  const handleAddInvoiceItem = () => {
    if(!invoiceItemForm.description||!invoiceItemForm.qty||!invoiceItemForm.unitPrice) return;
    const base=invoiceItemForm.description.trim();
    const newItem={
      ...invoiceItemForm,
      description: invoiceItemForm.size
        ? `${base}${invoiceItemForm.colorName?` (${invoiceItemForm.colorName})`:""} ไซส์ ${invoiceItemForm.size}`
        : base,
      clothingName: base, // ใช้สำหรับ group ในตาราง
      qty:Number(invoiceItemForm.qty), unitPrice:Number(invoiceItemForm.unitPrice)
    };
    setInvoiceForm(f=>({...f,items:[...f.items,newItem]}));
    setInvoiceItemForm({description:"",qty:"",unitPrice:"",unit:"ชิ้น",colorName:"",colorHex:"",size:""});
  };

  // 🔗 ดึงรวมหลายใบสั่งของ → เปิด modal ออกบิลพร้อม items ที่รวมแล้ว
  const toggleOrderSelect = (id) => {
    setSelectedOrders(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };
  const handleMergeOrdersToInvoice = () => {
   try {
    const sel = orders.filter(o => selectedOrders.has(o.id));
    // ⚠️ เดิม return เงียบ ๆ — ถ้าใบที่ติ๊กไว้หลุดออกจากรายการที่โหลดอยู่ (เปลี่ยนช่วงวันที่/ตัวกรอง)
    //    จะกดแล้วไม่มีอะไรเกิดขึ้น หาสาเหตุไม่ได้ → บอกให้ชัด
    if (sel.length === 0) {
      alert(`ออกบิลรวมไม่ได้ — ใบสั่งที่ติ๊กไว้ ${selectedOrders.size} ใบ ไม่อยู่ในรายการที่แสดงอยู่ตอนนี้\n\nอาจเพราะเปลี่ยนช่วงวันที่หรือตัวกรองหลังจากติ๊กไปแล้ว\nกด "ยกเลิก" แล้วเลือกใหม่อีกครั้ง`);
      return;
    }
    if (sel.length < selectedOrders.size) {
      const miss = selectedOrders.size - sel.length;
      if (!window.confirm(`⚠️ ติ๊กไว้ ${selectedOrders.size} ใบ แต่ตอนนี้เห็นแค่ ${sel.length} ใบ (หายไป ${miss} ใบ เพราะไม่อยู่ในรายการที่แสดง)\n\nออกบิลรวมเฉพาะ ${sel.length} ใบที่เห็นต่อไหม?`)) return;
    }
    // 🚫 กันออกบิลซ้ำจากใบสั่งเดิม — ต้นเหตุที่ทำให้มีบิลซ้ำหลายใบของยอดเดียวกัน
    //    (ออกทีละใบไปแล้ว แล้วมาเลือกรวมอีกรอบ → ได้บิลซ้อน ยอดเบิ้ล)
    const invoicedIds = new Set();
    invoices.forEach(inv => {
      if (inv.mergedInto || inv.convertedTo) return; // บิลที่ถูกยุบไปแล้ว ไม่นับ
      (inv.mergedFromOrderIds || []).forEach(id => invoicedIds.add(id));
    });
    const dupOrders = sel.filter(o => invoicedIds.has(o.id));
    if (dupOrders.length > 0) {
      const lines = dupOrders.slice(0, 8).map(o => {
        const inv = invoices.find(x => !x.mergedInto && !x.convertedTo && (x.mergedFromOrderIds || []).includes(o.id));
        return `• ${o.orderNo || "(ไม่มีเลขที่)"} → ออกเป็นบิล ${inv?.invoiceNo || "?"} แล้ว`;
      }).join("\n");
      if (!window.confirm(
        `⚠️ มี ${dupOrders.length} ใบสั่งที่ออกบิลไปแล้ว:\n\n${lines}${dupOrders.length > 8 ? `\n... และอีก ${dupOrders.length - 8} ใบ` : ""}\n\n`+
        `ออกบิลอีกครั้ง = ได้บิลซ้ำ ยอดจะเบิ้ล และเก็บเงินเกิน\n\n`+
        `ยืนยันออกบิลซ้ำจริง ๆ?`
      )) return;
    }

    // เตือนถ้าลูกค้าต่างกัน
    // ⚠️ ห้ามตั้งชื่อว่า customers — จะไปทับ state customers (ทะเบียนลูกค้า) ที่ใช้ .find() ด้านล่าง
    const custNames = new Set(sel.map(o => (o.customerName||"").trim()));
    if (custNames.size > 1) {
      if (!window.confirm(`⚠️ ใบสั่งของที่เลือกมีลูกค้าต่างกัน ${custNames.size} ราย:\n${[...custNames].join(", ")}\n\nต้องการรวมเป็นบิลเดียวจริงๆ? (จะใช้ข้อมูลลูกค้าจากใบแรก)`)) return;
    }
    // รวม items: ถ้า (clothingId+colorIdx+size+variant) ตรงกัน → บวก qty
    const merged = new Map();
    sel.forEach(o => {
      (o.items||[]).forEach(i => {
        const clothingItem = clothingItems.find(c=>c.id===i.clothingId);
        const colorData = clothingItem?.colors?.[i.colorIdx];
        const salePrice = getPriceForSize(colorData, i.size);
        const key = [i.clothingId||"", i.colorIdx??"", i.size||"", i.variant||""].join("|");
        if (merged.has(key)) {
          merged.get(key).qty += Number(i.qty)||0;
        } else {
          merged.set(key, {
            description: `${i.clothingName||""}${i.colorName?` (${i.colorName})`:""}${i.size?` ไซส์ ${i.size}`:""}`,
            qty: Number(i.qty)||0, unitPrice: salePrice, unit: "ชิ้น",
            clothingId: i.clothingId, clothingName: i.clothingName,
            colorIdx: i.colorIdx, colorName: i.colorName, colorHex: i.colorHex,
            size: i.size, variant: i.variant||"",
          });
        }
      });
    });
    // 📦 รวมหลายใบที่รายการเยอะ → บิลจะยาวมากและฟอร์มอาจหน่วง เตือนก่อน
    if (merged.size > 400) {
      if (!window.confirm(`บิลรวมนี้จะมี ${merged.size.toLocaleString("th-TH")} แถว (จาก ${sel.length} ใบสั่ง)\n\nฟอร์มออกบิลอาจหน่วงและบิลจะยาวหลายหน้า\nแนะนำให้แบ่งออกเป็นหลายบิล — จะไปต่อไหม?`)) return;
    }
    const first = sel[0];
    const orderNos = sel.map(o => o.orderNo).filter(Boolean).join(", ");
    // 🔎 ดึงเลขภาษี/ข้อมูลลูกค้าจากทะเบียน (ใบสั่งของไม่ได้เก็บ taxId)
    const firstCust = (first.customerId && customers.find(c => c.id === first.customerId))
      || customers.find(c => (c.name||"").trim() === (first.customerName||"").trim());
    // 💰 รวมมัดจำจากทุกใบสั่งที่เลือก → เป็นการชำระในบิลรวม
    const payments = sel.filter(o => Number(o.depositAmount) > 0).map(o => ({
      id: `dep_${o.id}`, amount: Number(o.depositAmount), method: o.depositMethod || "โอน",
      date: o.date || now(), bank: "", note: `มัดจำ (จากใบสั่ง ${o.orderNo})`, receivedBy: o.by || user.name,
    }));
    setInvoiceForm(f => ({
      ...f,
      customerId: first.customerId||firstCust?.id||"",
      customerName: first.customerName||firstCust?.name||"",
      customerPhone: first.customerPhone||firstCust?.phone||"",
      customerAddress: first.customerAddress||firstCust?.address||"",
      customerTaxId: firstCust?.taxId||"",
      items: [...merged.values()],
      payments,
      note: f.note ? `${f.note}\n[รวมจากใบสั่ง: ${orderNos}]` : `รวมจากใบสั่ง: ${orderNos}`,
      mergedFromOrderIds: sel.map(o=>o.id),
    }));
    setSelectedOrders(new Set());
    setShowNewInvoice(true);
    setActiveTab("invoice"); // เด้งไปหน้าออกบิล ให้เห็นว่าเปิดฟอร์มแล้วจริง
   } catch (err) {
    // เดิมไม่มีดักพลาด — พังตรงไหนก็เงียบ หาสาเหตุไม่ได้
    console.error("[mergeOrders] failed:", err);
    alert(`ออกบิลรวมไม่สำเร็จ: ${err?.message || err}\n\nลองลดจำนวนใบที่เลือกลง แล้วรวมทีละชุด`);
   }
  };

  const handleImportFromOrder = (order) => {
    // 🚫 กันออกบิลซ้ำ — ใบสั่งนี้เคยออกบิลไปแล้วหรือยัง (ไม่นับบิลที่ถูกยุบไปแล้ว)
    const already = invoices.find(inv =>
      !inv.mergedInto && !inv.convertedTo && (inv.mergedFromOrderIds || []).includes(order.id)
    );
    if (already && !window.confirm(
      `⚠️ ใบสั่ง ${order.orderNo || ""} ออกเป็นบิล ${already.invoiceNo} ไปแล้ว\n\n`+
      `ออกอีกครั้ง = ได้บิลซ้ำ ยอดจะเบิ้ล และเก็บเงินเกิน\n\nยืนยันออกซ้ำจริง ๆ?`
    )) return;

    const items = (order.items||[]).map(i=>{
      // Try to get sale price from clothing item
      const clothingItem = clothingItems.find(c=>c.id===i.clothingId);
      const colorData = clothingItem?.colors?.[i.colorIdx];
      const salePrice = getPriceForSize(colorData, i.size);
      return {
        description:`${i.clothingName} (${i.colorName}) ไซส์ ${i.size}`,
        qty:i.qty, unitPrice:salePrice, unit:"ชิ้น",
        clothingId:i.clothingId, clothingName:i.clothingName,
        colorIdx:i.colorIdx, colorName:i.colorName, colorHex:i.colorHex,
        size:i.size
      };
    });
    // 🔎 ดึงข้อมูลลูกค้าจากทะเบียน (เลขภาษี/เบอร์/ที่อยู่ล่าสุด) — ใบสั่งของไม่ได้เก็บ taxId
    const cust = (order.customerId && customers.find(c => c.id === order.customerId))
      || customers.find(c => (c.name||"").trim() === (order.customerName||"").trim());
    // 💰 ถ้าใบสั่งมีมัดจำ → ผูกเป็นการชำระในบิลอัตโนมัติ
    const dep = Number(order.depositAmount) || 0;
    const payments = dep > 0 ? [{
      id: `dep_${order.id}`, amount: dep, method: order.depositMethod || "โอน",
      date: order.date || now(), bank: "", note: `มัดจำ (จากใบสั่ง ${order.orderNo})`,
      receivedBy: order.by || user.name,
    }] : [];
    setInvoiceForm(f=>({...f,
      customerId:order.customerId||cust?.id||"",
      customerName:order.customerName||cust?.name||"",
      customerPhone:order.customerPhone||cust?.phone||"",
      customerAddress:order.customerAddress||cust?.address||"",
      customerTaxId:cust?.taxId||"",
      items,
      payments,
      mergedFromOrderIds:[order.id], // 🔗 track ว่ามาจากใบสั่งไหน → order จะได้ mark "ออกบิลแล้ว"
    }));
  };


  const handleConfirmInvoice = async () => {
    if (savingInvoiceRef.current) return;   // กำลังบันทึกอยู่ — กดซ้ำไม่มีผล
    if(!invoiceForm.customerName||invoiceForm.items.length===0) return;
    // 🔒 บังคับเงื่อนไขใบกำกับภาษี
    if (invoiceDocType === "tax") {
      if (!invoiceVat) { alert("ใบกำกับภาษีต้องมี VAT 7%"); return; }
      if (!companyInfo.taxId || !companyInfo.taxId.trim()) {
        alert("⚠️ บริษัทยังไม่ได้กรอกเลขผู้เสียภาษี\nไปที่ ⚙️ ตั้งค่า → ข้อมูลบริษัท เพื่อกรอกก่อน");
        return;
      }
      if (!invoiceForm.customerTaxId || !invoiceForm.customerTaxId.trim()) {
        alert("⚠️ ใบกำกับภาษีต้องระบุเลขผู้เสียภาษีของลูกค้า\nกรอกในช่อง 'เลขผู้เสียภาษี' ของลูกค้า");
        return;
      }
    }
    const calc = calcInvoice(invoiceForm.items, invoiceForm.vatRate, invoiceVat, invoiceForm.discount, invoiceForm.discountType, invoiceForm.useShipping, invoiceForm.shippingFee);
    const beginSave = () => { savingInvoiceRef.current = true; setSavingInvoice(true); };
    const endSave = () => { savingInvoiceRef.current = false; setSavingInvoice(false); };
    const bank = (invoiceForm.bankAccountIdx!=null&&invoiceForm.bankAccountIdx>=0)
      ? (companyInfo.bankAccounts||[])[invoiceForm.bankAccountIdx] : null;

    if (editingInvoiceId) {
      // ── โหมดแก้ไข ──
      const existing = invoices.find(i=>i.id===editingInvoiceId);
      const revisions = (existing?.revisions||0) + 1;
      const updated = {
        ...invoiceForm, ...calc,
        docType:invoiceDocType, useVat:invoiceVat,
        bankAccount: bank,
        // คงค่าเดิม: invoiceNo, by, createdAt, status
        invoiceNo: existing?.invoiceNo,
        by: existing?.by,
        // 📅 วันที่เอกสาร — แก้ย้อนหลังได้ (คงเวลาเดิมของใบไว้) | createdAt คือเวลาบันทึกจริง ไม่แตะ
        date: isoToDocDate(invoiceForm.docDate, existing?.date),
        createdAt: existing?.createdAt,
        status: existing?.status || "ออกแล้ว",
        revisions,
        lastEditedBy: user.name,
        lastEditedAt: now(),
      };
      delete updated.depositAmount; delete updated.depositMethod; // ฟิลด์ชั่วคราวของฟอร์ม (แก้บิลจัดการชำระผ่านปุ่ม 💵)
      delete updated.docDate; // ฟิลด์ของฟอร์มเท่านั้น — ตัวจริงเก็บใน date
      beginSave();
      try {
        await updateDoc(doc(db,"invoices",editingInvoiceId), withSearchKeys(updated));
      } catch (e) {
        endSave();
        alert("บันทึกไม่สำเร็จ: " + (e?.message || e));
        return;
      }
      endSave();
      logAudit(user, {
        action: AUDIT_ACTIONS.UPDATE,
        collection: "invoices",
        targetId: editingInvoiceId,
        targetLabel: `${existing?.invoiceNo} · ${invoiceForm.customerName}`,
        before: { total: existing?.total, items: (existing?.items||[]).length, discount: existing?.discount, date: existing?.date },
        after: { total: calc.total, items: invoiceForm.items.length, discount: invoiceForm.discount, date: updated.date },
        note: `แก้ไขครั้งที่ ${revisions}${updated.date!==existing?.date?` · เปลี่ยนวันที่เอกสาร ${existing?.date||"-"} → ${updated.date}`:""}`,
      });
      setShowPrintInvoice({...updated, id:editingInvoiceId});
      setShowNewInvoice(false);
      // 💾 บันทึกลงระบบแล้ว → ไม่ต้องเก็บร่างไว้อีก
      clearInvoiceDraft();
      setEditingInvoiceId(null);
      setInvoiceForm({customerId:"",customerName:"",customerPhone:"",customerAddress:"",customerTaxId:"",items:[],note:"",dueDate:"",vatRate:7,discount:0,discountType:"amount",useShipping:false,shippingFee:0,...invoiceDefaults()});
      return;
    }

    // ── โหมดสร้างใหม่ ──
    // 📅 ออกบิลย้อนหลังได้ — เลขที่เอกสารจะอยู่ในชุดของเดือนตามวันที่ที่เลือก
    const docDateStr = isoToDocDate(invoiceForm.docDate);

    // 🔁 กันออกบิลซ้ำ — ลูกค้าเดิม ยอดเท่ากัน ในเวลาไล่เลี่ยกัน
    //    เดิมกันเฉพาะบิลที่ออกจากใบสั่งของ ออกมือเปล่าไม่มีอะไรกันเลย
    //    เตือนอย่างเดียว ไม่บล็อก — ลูกค้าสั่งของชุดเดิมซ้ำจริง ๆ ก็มี
    const dups = findDuplicateInvoices(invoices, {
      customerId: invoiceForm.customerId, customerName: invoiceForm.customerName,
      total: calc.total, date: docDateStr,
    });
    if (dups.length > 0) {
      const lines = dups.slice(0, 5).map(d => `  • ${d.invoiceNo} · ${(d.date || "").split(" ")[0]} · ฿${(Number(d.total) || 0).toLocaleString("th-TH", { minimumFractionDigits: 2 })}`);
      const NLx = String.fromCharCode(10);
      const ok = window.confirm([
        `เคยออกบิลยอดนี้ให้ ${invoiceForm.customerName} ไปแล้ว ${dups.length} ใบ`, "",
        ...lines,
        dups.length > 5 ? `  … และอีก ${dups.length - 5} ใบ` : "", "",
        "ออกอีกใบ = ลูกค้าจะโดนเก็บเงิน 2 รอบ", "",
        "ถ้าลูกค้าสั่งของชุดเดิมซ้ำจริง ๆ กดตกลงเพื่อออกต่อ",
      ].filter(x => x !== "").join(NLx));
      if (!ok) return;
    }
    beginSave();
    let invNo;
    try {
      invNo = await reserveDocNo(db, "INV", invoices, "invoiceNo", isoToJsDate(invoiceForm.docDate));
    } catch (e) {
      endSave();
      alert("จองเลขที่บิลไม่สำเร็จ: " + (e?.message || e));
      return;
    }
    // 💰 มัดจำที่กรอกในหน้าออกบิล → เพิ่มเป็นการชำระ (รวมกับมัดจำที่ผูกจากใบสั่ง ถ้ามี)
    const inlineDep = Number(invoiceForm.depositAmount) || 0;
    const finalPayments = [
      ...(invoiceForm.payments || []),
      ...(inlineDep > 0 ? [{ id: `dep_inline_${Date.now()}`, amount: inlineDep, method: invoiceForm.depositMethod || "โอน", date: docDateStr, bank: "", note: "มัดจำ (ตอนออกบิล)", receivedBy: user.name }] : []),
    ];
    const data = {
      ...invoiceForm, ...calc,
      payments: finalPayments,
      invoiceNo:invNo, docType:invoiceDocType, useVat:invoiceVat,
      bankAccount: bank,
      by:user.name, date:docDateStr, createdAt:serverTimestamp(), status:"ออกแล้ว"
    };
    delete data.depositAmount; delete data.depositMethod; // ฟิลด์ชั่วคราวของฟอร์ม ไม่ต้องเก็บลง doc
    delete data.docDate; // ฟิลด์ของฟอร์มเท่านั้น — ตัวจริงเก็บใน date
    // 📦 Firestore จำกัดเอกสารละ 1MB — บิลที่รวมมาจากใบสั่งเยอะ ๆ อาจทะลุแล้วบันทึกไม่ผ่าน
    const invKB = Math.round(JSON.stringify(data).length / 1024);
    if (invKB > 900) {
      endSave();
      alert(`บันทึกไม่ได้ — บิลนี้ใหญ่เกินขีดจำกัด (${invKB} KB / สูงสุด ~1000 KB)\n\nมี ${data.items.length.toLocaleString("th-TH")} แถว — แบ่งออกเป็นหลายบิลก่อนครับ`);
      return;
    }
    let ref;
    try {
      ref = await addDoc(collection(db,"invoices"), withSearchKeys(data));
    } catch (e) {
      endSave();
      alert("บันทึกบิลไม่สำเร็จ: " + (e?.message || e) + String.fromCharCode(10, 10) + "ยังไม่ได้ออกบิล ลองใหม่อีกครั้ง");
      return;
    }

    // 👀 บิลเขียนลงระบบแล้ว — ปิดหน้าต่างและโชว์ใบให้เห็นทันที
    //    งานที่เหลือ (ปั๊มใบสั่ง/ใบ custom) ไม่กระทบตัวบิล ปล่อยทำต่อเบื้องหลังได้
    //    เดิมรอจนครบทุกขั้นถึงจะปิด ทำให้ดูเหมือนค้าง แล้วพนักงานกดปุ่มซ้ำ
    endSave();
    setShowPrintInvoice({...data, id:ref.id});
    setShowNewInvoice(false);
    clearInvoiceDraft();
    setInvoiceForm({customerId:"",customerName:"",customerPhone:"",customerAddress:"",customerTaxId:"",items:[],note:"",dueDate:"",vatRate:7,discount:0,discountType:"amount",useShipping:false,shippingFee:0,...invoiceDefaults()});
    setActiveTab("invoice");
    // 🔗 ปั๊ม "ออกบิลแล้ว" ลงในใบสั่งของโดยตรง
    // ทำไม: บิลโหลดมาแค่ช่วงวันที่ (ไม่ใช่ทั้งหมด) — ถ้าอ่านสถานะจากบิลที่โหลดมาอย่างเดียว
    // ใบสั่งเก่าจะกลับไปขึ้น "ยังไม่ออกบิล" ทั้งที่ออกไปแล้ว → เสี่ยงออกบิลซ้ำ
    const linkIds = [...new Set(invoiceForm.mergedFromOrderIds || [])];
    if (linkIds.length) {
      try {
        for (let i = 0; i < linkIds.length; i += 400) {
          const b = writeBatch(db);
          linkIds.slice(i, i + 400).forEach(oid =>
            b.update(doc(db, "orders", oid), { invoiceId: ref.id, invoiceNo: invNo, invoicedAt: serverTimestamp() }));
          await b.commit();
        }
      } catch (e) { console.warn("[invoice] mark orders invoiced failed:", e); }
    }
    // 🎨 ปั๊ม "ออกบิลแล้ว" ลงใบสั่งผลิต custom ที่บิลนี้มาจาก
    // ทำไม: ก่อนหน้านี้ใบ custom ไม่มีสถานะนี้ ออกบิลไปแล้วใบยังค้างในช่อง "กำลังผลิต"
    // พนักงานจึงเปิดใบใหม่ซ้ำเวลาจะออกบิล → งาน+รูปกองสะสม
    const customIds = [...new Set((invoiceForm.customDetails?.orderIds) || [])];
    if (customIds.length) {
      try {
        for (let i = 0; i < customIds.length; i += 400) {
          const b = writeBatch(db);
          customIds.slice(i, i + 400).forEach(cid =>
            b.update(doc(db, "customOrders", cid), { invoiceId: ref.id, invoiceNo: invNo, invoicedAt: serverTimestamp() }));
          await b.commit();
        }
      } catch (e) { console.warn("[invoice] mark customOrders invoiced failed:", e); }
    }
    logAudit(user, {
      action: AUDIT_ACTIONS.CREATE,
      collection: "invoices",
      targetId: ref.id,
      targetLabel: `${invNo} · ${invoiceForm.customerName}`,
      note: `${docTypeLabel(invoiceDocType)} · ฿${(data.total||0).toLocaleString("th-TH",{minimumFractionDigits:2})}${invoiceVat?" · VAT":""}`,
    });
  };

  // 🔗 toggle เลือกบิล
  const toggleInvoiceSelect = (id) => setSelectedInvoices(s => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  // 🔗 รวมหลายบิลของลูกค้าคนเดียวกัน → บิลเดียว
  const handleMergeInvoices = async () => {
    const sel = invoices.filter(i => selectedInvoices.has(i.id));
    if (sel.length < 2) { alert("เลือกอย่างน้อย 2 บิล"); return; }
    // 👤 เทียบลูกค้าแบบไม่ซีเรียสช่องว่าง/ตัวพิมพ์ — ถ้ามีรหัสลูกค้าให้ใช้รหัสก่อน
    //    (เดิมเทียบชื่อแบบเป๊ะ ๆ ทำให้ชื่อที่ต่างกันแค่เว้นวรรค/จุด รวมไม่ได้)
    const idOf = (i) => i.customerId || `name:${String(i.customerName || "").trim().toLowerCase().replace(/\s+/g, " ")}`;
    const cname = sel[0].customerName;
    const key0 = idOf(sel[0]);
    const otherCust = sel.filter(i => idOf(i) !== key0);
    if (otherCust.length) {
      const names = [...new Set(otherCust.map(i => `${i.invoiceNo} (${i.customerName || "-"})`))].slice(0, 8);
      alert(`รวมได้เฉพาะบิลของลูกค้าคนเดียวกัน\n\nลูกค้าหลัก: ${cname}\nบิลที่เป็นคนละลูกค้า ${otherCust.length} ใบ:\n${names.join("\n")}${otherCust.length > 8 ? "\n..." : ""}`);
      return;
    }
    const alreadyMerged = sel.filter(i => i.mergedInto);
    if (alreadyMerged.length) { alert(`มีบิลที่ถูกรวมไปแล้ว ${alreadyMerged.length} ใบ — เอาออกจากรายการที่เลือกก่อน\n\n${alreadyMerged.map(i => `${i.invoiceNo} → ${i.mergedInto?.invoiceNo || ""}`).slice(0, 10).join("\n")}`); return; }
    const converted = sel.filter(i => i.convertedTo);
    if (converted.length) { alert(`มีบิลที่แปลงเป็นเอกสารอื่นแล้ว ${converted.length} ใบ — รวมไม่ได้\n\n${converted.map(i => i.invoiceNo).slice(0, 10).join(", ")}`); return; }
    const days = new Set(sel.map(i => (i.date || "").slice(0, 10)));
    if (days.size > 1 && !window.confirm("บิลที่เลือกอยู่คนละวัน — ยืนยันรวมต่อไหม?")) return;
    if (!window.confirm(`รวม ${sel.length} บิลของ "${cname}" เป็นบิลเดียว?\n\nบิลเดิมจะถูกทำเครื่องหมาย "รวมแล้ว" (ไม่ถูกลบ — ย้อนได้)`)) return;
    // เรียงตามเวลาออกบิล
    const ordered = [...sel].sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));
    const base = ordered[0];
    const items = ordered.flatMap(i => i.items || []);
    const discount = ordered.reduce((s, i) => s + (Number(i.billDiscount) || 0), 0);
    const shippingFee = ordered.reduce((s, i) => s + (Number(i.shipping) || 0), 0);
    const useShipping = shippingFee > 0;
    const useVat = ordered.some(i => i.useVat || (Number(i.vat) || 0) > 0);
    const vatRate = base.vatRate || 7;
    const payments = ordered.flatMap(i => i.payments || []);
    const calc = calcInvoice(items, vatRate, useVat, discount, "amount", useShipping, shippingFee);
    const invNo = await reserveDocNo(db, "INV", invoices, "invoiceNo");
    const newData = {
      ...base,
      invoiceNo: invNo,
      items, discount, discountType: "amount", useShipping, shippingFee, vatRate, useVat,
      ...calc,
      payments,
      mergedFrom: ordered.map(i => ({ id: i.id, invoiceNo: i.invoiceNo, total: i.total })),
      by: user.name, date: base.date, createdAt: serverTimestamp(),
      status: base.status || "ออกแล้ว",
      note: [base.note, `🔗 รวมจาก ${ordered.map(i => i.invoiceNo).join(", ")}`].filter(Boolean).join(" · "),
    };
    delete newData.id; delete newData.convertedTo; delete newData.mergedInto;
    // 📦 Firestore จำกัดขนาดเอกสาร 1MB — รวมหลายใบที่มีรายการเยอะอาจทะลุ
    const approxKB = Math.round(JSON.stringify(newData).length / 1024);
    if (approxKB > 900) {
      alert(`รวมไม่ได้ — บิลรวมจะใหญ่เกินขีดจำกัด (${approxKB} KB / สูงสุด ~1000 KB)\n\nรวมทีละน้อยใบลงก่อน แล้วค่อยรวมบิลรวมเข้าด้วยกันอีกทีได้`);
      return;
    }
    try {
      const ref = await addDoc(collection(db, "invoices"), newData);
      for (const i of ordered) {
        await updateDoc(doc(db, "invoices", i.id), { mergedInto: { id: ref.id, invoiceNo: invNo } });
      }
      logAudit(user, {
        action: AUDIT_ACTIONS.CREATE, collection: "invoices", targetId: ref.id,
        targetLabel: `${invNo} · ${cname} (รวม ${ordered.length} บิล)`,
        note: `รวมบิล: ${ordered.map(i => i.invoiceNo).join(", ")} → ฿${(calc.total || 0).toLocaleString("th-TH", { minimumFractionDigits: 2 })}`,
      });
      setSelectedInvoices(new Set());
      setShowPrintInvoice({ ...newData, id: ref.id });
    } catch (e) { alert("รวมบิลไม่สำเร็จ: " + (e.message || e)); }
  };

  // 🔗 ยกเลิกการรวม — ปลด flag ออกจากบิลเดิม + ลบบิลรวม
  const handleUnmergeInvoice = async (mergedInv) => {
    if (!mergedInv?.mergedFrom?.length) return;
    if (!window.confirm(`ยกเลิกการรวมบิล ${mergedInv.invoiceNo}?\n\nบิลเดิม ${mergedInv.mergedFrom.length} ใบจะกลับมาแสดง และบิลรวมนี้จะถูกลบ`)) return;
    try {
      for (const src of mergedInv.mergedFrom) {
        await updateDoc(doc(db, "invoices", src.id), { mergedInto: null });
      }
      // 🖼️ ไม่ลบรูปตรงนี้ — บิลรวมถือ path ชุดเดียวกับบิลเดิมที่กำลังจะกลับมาแสดง
      await deleteDoc(doc(db, "invoices", mergedInv.id));
      logAudit(user, { action: AUDIT_ACTIONS.DELETE, collection: "invoices", targetId: mergedInv.id, targetLabel: `${mergedInv.invoiceNo} (ยกเลิกรวมบิล)`, note: `คืน ${mergedInv.mergedFrom.map(s => s.invoiceNo).join(", ")}` });
    } catch (e) { alert("ยกเลิกไม่สำเร็จ: " + (e.message || e)); }
  };

  // แปลงใบวางบิล (quotation) → ใบเสร็จ/ใบกำกับ
  const handleConvertQuotation = async (sourceInv, targetDocType) => {
    if (!sourceInv) return;
    if (!window.confirm(`สร้าง${targetDocType==="tax"?"ใบกำกับภาษี":"ใบเสร็จ"}จาก ${sourceInv.invoiceNo} (${sourceInv.customerName})?`)) return;
    const calc = calcInvoice(sourceInv.items||[], sourceInv.vatRate||7, targetDocType==="tax"||sourceInv.useVat, sourceInv.discount||0, sourceInv.discountType||"amount", !!sourceInv.useShipping, sourceInv.shippingFee||0);
    const invNo = await reserveDocNo(db, "INV", invoices, "invoiceNo");
    const newData = {
      customerId: sourceInv.customerId || "",
      customerName: sourceInv.customerName || "",
      customerPhone: sourceInv.customerPhone || "",
      customerAddress: sourceInv.customerAddress || "",
      customerTaxId: sourceInv.customerTaxId || "",
      items: sourceInv.items || [],
      note: sourceInv.note || "",
      dueDate: sourceInv.dueDate || "",
      vatRate: sourceInv.vatRate || 7,
      discount: sourceInv.discount || 0,
      discountType: sourceInv.discountType || "amount",
      useShipping: !!sourceInv.useShipping,
      shippingFee: sourceInv.shippingFee || 0,
      bankAccount: sourceInv.bankAccount || null,
      ...calc,
      invoiceNo: invNo,
      docType: targetDocType,
      useVat: targetDocType==="tax" ? true : !!sourceInv.useVat,
      by: user.name,
      date: now(),
      createdAt: serverTimestamp(),
      status: "ออกแล้ว",
      convertedFrom: { id: sourceInv.id, invoiceNo: sourceInv.invoiceNo, docType: sourceInv.docType },
    };
    // validation for tax invoice
    if (targetDocType === "tax") {
      if (!companyInfo.taxId || !companyInfo.taxId.trim()) { alert("⚠️ บริษัทยังไม่ได้กรอกเลขผู้เสียภาษี"); return; }
      if (!newData.customerTaxId) { alert("⚠️ ใบกำกับภาษีต้องมีเลขผู้เสียภาษีลูกค้า — กรุณาเปิดบิลต้นทางเพื่อกรอกก่อน"); return; }
    }
    const ref = await addDoc(collection(db,"invoices"), newData);
    // อัพเดต source ให้ track ว่าแปลงไปแล้ว
    await updateDoc(doc(db,"invoices",sourceInv.id), { convertedTo: { id: ref.id, invoiceNo: invNo, docType: targetDocType } });
    logAudit(user, {
      action: AUDIT_ACTIONS.CREATE,
      collection: "invoices",
      targetId: ref.id,
      targetLabel: `${invNo} (จาก ${sourceInv.invoiceNo})`,
      note: `แปลงจาก ${docTypeLabel(sourceInv.docType)} → ${docTypeLabel(targetDocType)}`,
    });
    setShowPrintInvoice({...newData, id:ref.id});
  };

  // เปิดบิลขึ้นมาแก้
  const handleEditInvoice = (inv) => {
    setEditingInvoiceId(inv.id);
    setInvoiceDocType(inv.docType || "receipt");
    setInvoiceVat(!!inv.useVat);
    setInvoiceForm({
      customerId: inv.customerId || "",
      customerName: inv.customerName || "",
      customerPhone: inv.customerPhone || "",
      customerAddress: inv.customerAddress || "",
      customerTaxId: inv.customerTaxId || "",
      items: inv.items || [],
      note: inv.note || "",
      dueDate: inv.dueDate || "",
      vatRate: inv.vatRate || 7,
      discount: inv.discount || 0,
      discountType: inv.discountType || "amount",
      useShipping: !!inv.useShipping,
      shippingFee: inv.shippingFee || 0,
      bankAccountIdx: -1, // ผู้ใช้เลือกใหม่ถ้าต้องการ
      // 🧾 แก้บิลเดิม — คงหน้าตาเดิมของบิลไว้ ไม่ใช้ค่า default ของบิลใหม่
      showCompanyTaxId: inv.showCompanyTaxId !== false,
      hideCompanyDetails: inv.hideCompanyDetails === true,
      showJobImages: inv.showJobImages !== false,
      docDate: docDateToISO(inv.date), // 📅 วันที่เอกสารเดิม — แก้ย้อนหลังได้
      // 📋 รายละเอียดงาน custom (ผ้า/คอ/รูป) — ต้องพกติดมาด้วย ไม่งั้นแก้บิลแล้วรายละเอียดหาย
      ...(inv.customDetails ? { customDetails: inv.customDetails } : {}),
      ...(inv.payments ? { payments: inv.payments } : {}),
    });
    setShowNewInvoice(true);
  };

  const PAYMENT_STATUSES = ["ออกแล้ว","รอชำระ","ชำระแล้ว","ยกเลิก"];
  const paymentStatusStyle = (s) => ({
    "ออกแล้ว":  {bg:"rgba(59,91,139,0.1)",  color:T.accent,  border:"1px solid rgba(59,91,139,0.2)"},
    "รอชำระ":   {bg:"rgba(245,158,11,0.1)", color:T.amber,   border:"1px solid rgba(245,158,11,0.25)"},
    "ชำระแล้ว": {bg:"rgba(16,185,129,0.1)", color:T.green,   border:"1px solid rgba(16,185,129,0.25)"},
    "ยกเลิก":   {bg:"rgba(239,68,68,0.1)",  color:T.red,     border:"1px solid rgba(239,68,68,0.25)"},
  }[s] || {bg:"rgba(59,91,139,0.1)",color:T.accent,border:"1px solid rgba(59,91,139,0.2)"});

  const handleDeleteInvoice = async (inv) => {
    if (!inv) return;
    // 🖼️ รูปที่บิลใบนี้เป็นเจ้าของ — ลบเอกสารอย่างเดียวจะเหลือไฟล์กำพร้าค้างใน Storage ตลอดไป
    //    (รูปที่มาจากใบ custom ไม่ถูกนับ — เป็นไฟล์เดียวกับที่ใบ custom ยังใช้อยู่)
    const ownedImgs = ownedImagePathsOf(inv);
    const imgLine = ownedImgs.length ? `\n🖼️ รูปที่แนบไว้ในบิล ${ownedImgs.length} รูปจะถูกลบด้วย` : "";
    if (!window.confirm(`ลบบิล ${inv.invoiceNo}?${imgLine}\n\nการลบไม่สามารถกู้คืนได้ (ใช้ "แก้ไข" แทนถ้าแค่กรอกผิด)`)) return;
    await deleteDoc(doc(db, "invoices", inv.id));
    // ลบเอกสารสำเร็จก่อนค่อยลบรูป — ถ้าลบรูปพลาด ไม่ให้กระทบผลลัพธ์หลัก
    if (ownedImgs.length) {
      try { await Promise.all(ownedImgs.map(p => deleteFile(p))); }
      catch (e) { console.warn("[invoice] ลบรูปใน Storage ไม่สำเร็จ:", e); }
    }
    // 🔗 คืนสถานะ "ยังไม่ออกบิล" ให้ใบสั่งของที่ผูกไว้ — ไม่งั้นออกบิลใหม่ไม่ได้เพราะขึ้นว่าออกแล้ว
    const linkIds = [...new Set(inv.mergedFromOrderIds || [])];
    if (linkIds.length) {
      try {
        for (let i = 0; i < linkIds.length; i += 400) {
          const b = writeBatch(db);
          linkIds.slice(i, i + 400).forEach(oid => b.update(doc(db, "orders", oid), { invoiceId: null, invoiceNo: null, invoicedAt: null }));
          await b.commit();
        }
      } catch (e) { console.warn("[invoice] unmark orders failed:", e); }
    }
    logAudit(user, { action: AUDIT_ACTIONS.DELETE, collection: "invoices", targetId: inv.id, targetLabel: `${inv.invoiceNo} · ${inv.customerName}`, before: { total: inv.total, status: inv.status, docType: inv.docType } });
  };

  // ── ↩️ รับคืนสินค้า ─────────────────────────────────────────
  const [showReturnModal, setShowReturnModal] = useState(false);
  const [creditNote, setCreditNote] = useState(null); // ใบรับคืนที่กำลังเปิดใบลดหนี้
  const [editingReturn, setEditingReturn] = useState(null);

  // 📦 ปรับสต็อกจากใบรับคืน — sign +1 = ของเข้า, -1 = ย้อนคืน (ตอนยกเลิกใบที่เข้าสต็อกไปแล้ว)
  //    ทำเฉพาะชิ้นที่สภาพยังขายต่อได้ · จับกลุ่มตามรุ่นก่อนเขียน
  //    ไม่งั้นคืนหลายไซส์ของรุ่นเดียวกันจะเขียนทับกันเอง
  const applyReturnStock = async (items, refNo, sign = 1) => {
    const usable = (it) => !!it.restock && it.colorIdx != null && !!clothingItems.find(c => c.id === it.clothingId);
    const byClothing = new Map();
    for (const it of items) {
      if (!usable(it)) continue;                               // ไม่รู้ว่าสีไหนในรุ่น → เติมสต็อกมั่วไม่ได้
      if (!byClothing.has(it.clothingId)) byClothing.set(it.clothingId, []);
      byClothing.get(it.clothingId).push(it);
    }
    for (const [clothingId, its] of byClothing) {
      const item = clothingItems.find(c => c.id === clothingId);
      const newColors = (item.colors || []).map((c, i) => {
        const adds = its.filter(x => x.colorIdx === i);
        if (adds.length === 0) return c;
        const stock = { ...(c.stock || {}) };
        for (const x of adds) {
          const next = (Number(stock[x.size]) || 0) + sign * (Number(x.qty) || 0);
          stock[x.size] = sign < 0 ? Math.max(0, next) : next;   // ย้อนแล้วห้ามติดลบ
        }
        return { ...c, stock };
      });
      await updateDoc(doc(db, "clothing", clothingId), { colors: newColors });
    }
    // ลงบันทึกทุกชิ้น รวมชิ้นที่ไม่ได้เข้าสต็อก — ของเสียก็ต้องมีร่องรอยว่าเคยรับมา
    for (const it of items) {
      await addDoc(collection(db, "transactions"), {
        type: sign > 0 ? "รับ" : "จ่าย", code: it.clothingId || "",
        name: `${it.clothingName}${it.colorName ? " / " + it.colorName : ""}${it.size ? " / " + it.size : ""}`,
        qty: Number(it.qty) || 0, by: user.name, date: now(),
        note: sign > 0
          ? `รับคืนจากลูกค้า ${refNo}${it.restock ? "" : ` (${it.condition} — ไม่เข้าสต็อก)`}`
          : `ย้อนใบรับคืน ${refNo} (ยกเลิกใบ)`,
        stockAffected: usable(it),
        createdAt: serverTimestamp(), category: "เสื้อผ้า",
      });
    }
  };

  const handleSaveReturn = async (data, matchNow) => {
    // อ่านสถานะล่าสุดจาก snapshot — ตัวที่ส่งเข้ามาอาจเก่าถ้ามีคนอื่นแก้ระหว่างเปิดหน้าต่างค้างไว้
    const editing = editingReturn?.id ? (returns.find(r => r.id === editingReturn.id) || editingReturn) : null;
    const wasMatched = editing?.status === "จับคู่แล้ว";
    const payload = {
      ...data,
      receivedAt: editing?.receivedAt || now(),
      // id เป็นของ Firestore ไม่ใช่ข้อมูลในเอกสาร — ติดมากับฟอร์มตอนแก้ใบเดิม
      id: undefined,
      receivedBy: editing?.receivedBy || user.name,
      // เส้นของแยกจากเส้นเงิน — ใบใหม่เริ่มที่ "รอตรวจ" เสมอ แก้ใบเดิมไม่ไปรีเซ็ตสถานะตรวจ
      qcStatus: editing ? (editing.qcStatus || "รอตรวจ") : "รอตรวจ",
      lastEditedBy: user.name, lastEditedAt: now(),
    };
    delete payload.id;
    if (editing) {
      await updateDoc(doc(db, "returns", editing.id), payload);
    } else {
      const retNo = await reserveDocNo(db, "RET", returns, "returnNo", new Date());
      payload.returnNo = retNo;
      payload.createdAt = serverTimestamp();
      await addDoc(collection(db, "returns"), payload);
    }
    const refNo = payload.returnNo || editing?.returnNo || "";
    // ⚠️ ของ "ไม่" เข้าสต็อกตรงนี้ — การจับคู่บิลเป็นเรื่องเงิน ไม่ใช่เรื่องสภาพของ
    //    ของเข้าสต็อกตอนกด "ตรวจแล้ว" ที่หน้ารับคืน (handleQcReturn) เท่านั้น
    logAudit(user, {
      action: editing ? AUDIT_ACTIONS.UPDATE : AUDIT_ACTIONS.CREATE,
      collection: "returns", targetId: editing?.id || refNo,
      targetLabel: `${refNo} · ${payload.customerName || "ไม่ทราบผู้ส่ง"}`,
      after: { status: payload.status, qty: payload.creditQty, credit: payload.creditTotal, invoiceNo: payload.invoiceNo },
      note: matchNow && !wasMatched ? `จับคู่บิล ${payload.invoiceNo} · ลดหนี้ ฿${payload.creditTotal}` : "",
    });
    setEditingReturn(null);
  };

  // 🔍 ตรวจสภาพเสร็จ → ของเข้าสต็อก (เฉพาะชิ้นที่ยัง "ขายต่อได้")
  //    แยกจากการจับคู่บิลโดยตั้งใจ — ของถึงร้านกับรู้ว่าเป็นบิลไหน เกิดคนละเวลากัน
  const handleQcReturn = async (r) => {
    if (!r?.id) return;
    if (qcStatusOf(r) === "ตรวจแล้ว") { alert("ใบนี้ตรวจไปแล้ว"); return; }
    const items = r.items || [];
    const inStock = items.filter(i => i.restock);
    const skipped = items.filter(i => !i.restock);
    const line = (i) => `  • ${i.clothingName}${i.colorName ? " " + i.colorName : ""}${i.size ? " " + i.size : ""} × ${i.qty}`;
    const NL = String.fromCharCode(10);
    const msg = [
      `ยืนยันว่าตรวจสภาพ ${r.returnNo} แล้ว?`, "",
      inStock.length ? `เข้าสต็อก ${inStock.length} รายการ` : "ไม่มีรายการที่เข้าสต็อก",
      ...inStock.map(line),
      "",
      ...(skipped.length ? [`ไม่เข้าสต็อก ${skipped.length} รายการ (ตำหนิ/ชำรุด)`, ""] : []),
      "ถ้าสภาพไม่ตรงกับที่บันทึกไว้ กดยกเลิก แล้วไปแก้สภาพในใบก่อน",
    ].join(NL);
    if (!window.confirm(msg)) return;
    await applyReturnStock(items, r.returnNo || "", 1);
    await updateDoc(doc(db, "returns", r.id), {
      qcStatus: "ตรวจแล้ว", checkedBy: user.name, checkedAt: now(),
    });
    logAudit(user, {
      action: AUDIT_ACTIONS.UPDATE, collection: "returns", targetId: r.id,
      targetLabel: `${r.returnNo} · ${r.customerName || "ไม่ทราบผู้ส่ง"}`,
      note: `ตรวจสภาพแล้ว · เข้าสต็อก ${inStock.reduce((a, i) => a + (Number(i.qty) || 0), 0)} ตัว`,
    });
  };
  // 🧾↩️ เปิดใบลดหนี้ — จองเลขชุด CN ครั้งแรกที่เปิด แล้วเก็บติดใบไว้
  //    เก็บเลขไว้เพราะเอกสารการเงินต้องพิมพ์ซ้ำแล้วได้เลขเดิมเสมอ
  const openCreditNote = async (r) => {
    if (!r?.id) return;
    if ((r.status || "") !== "จับคู่แล้ว") {
      alert("ออกใบลดหนี้ได้เฉพาะใบที่จับคู่บิลแล้ว — ยังไม่รู้บิลต้นทางก็ยังไม่รู้ราคาที่จะลด");
      return;
    }
    // ใบลดหนี้ใช้กับเคส "คืนเป็นเงินสด" เท่านั้น
    // เคสหักในใบวางบิลมีหลักฐานอยู่ในใบวางบิลอยู่แล้ว ออกอีกใบจะกลายเป็นหลักฐานซ้อน
    if (!isCashRefund(r)) {
      alert("ใบนี้ตั้งไว้เป็นแบบหักในใบวางบิล — ยอดจะไปแสดงในใบวางบิลงวดถัดไปแทน" +
        String.fromCharCode(10, 10) + "ถ้าลูกค้าขอรับเงินสดคืน ให้แก้ใบรับคืนเป็น \"คืนเป็นเงินสด\" ก่อน");
      return;
    }
    let withNo = r;
    if (!r.creditNoteNo) {
      try {
        const cnNo = await reserveDocNo(db, "CN", returns, "creditNoteNo", new Date());
        await updateDoc(doc(db, "returns", r.id), { creditNoteNo: cnNo, creditNoteAt: now(), creditNoteBy: user.name });
        withNo = { ...r, creditNoteNo: cnNo };
        logAudit(user, {
          action: AUDIT_ACTIONS.CREATE, collection: "returns", targetId: r.id,
          targetLabel: `${cnNo} · ${r.customerName || ""}`,
          note: `ออกใบลดหนี้ ${cnNo} · อ้างบิล ${r.invoiceNo || "-"} · ฿${r.creditTotal || 0}`,
        });
      } catch (e) {
        console.warn("[creditNote] จองเลขไม่สำเร็จ:", e?.message || e);
      }
    }
    setCreditNote(withNo);
  };
  // 💵 บันทึกว่าจ่ายเงินคืนลูกค้าแล้ว — ปิดวงเรื่องเงินของเคส "คืนเป็นเงินสด"
  //    ใบแบบนี้ถูกกันออกจากใบวางบิลแล้ว (creditsForStatement) จึงไม่หักซ้ำ
  const handleRefundPaid = async (r) => {
    if (!r?.id || r.refundedAt) return;
    const amount = Number(r.creditTotal) || 0;
    const method = window.prompt(
      `จ่ายเงินคืน ${r.customerName || ""} ฿${amount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}` +
      String.fromCharCode(10, 10) + "จ่ายทางไหน? (เงินสด / โอน / อื่น ๆ)", "เงินสด");
    if (method === null) return;
    await updateDoc(doc(db, "returns", r.id), {
      refundedAt: now(), refundedBy: user.name,
      refundMethod: (method || "").trim() || "เงินสด",
      refundAmount: amount,
    });
    logAudit(user, {
      action: AUDIT_ACTIONS.UPDATE, collection: "returns", targetId: r.id,
      targetLabel: `${r.returnNo} · ${r.customerName || ""}`,
      note: `จ่ายเงินคืน ฿${amount} · ${(method || "เงินสด").trim()}${r.creditNoteNo ? ` · ใบลดหนี้ ${r.creditNoteNo}` : ""}`,
    });
  };
  const handleCancelReturn = async (r) => {
    if (user.role !== "admin") { alert("ยกเลิกใบรับคืนได้เฉพาะ admin"); return; }
    if (r.appliedStatementNo) {
      alert(`ยกเลิกไม่ได้ — ใบนี้ถูกหักในใบวางบิล ${r.appliedStatementNo} ไปแล้ว` +
        String.fromCharCode(10, 10) + "ต้องลบใบวางบิลนั้นก่อน แล้วค่อยยกเลิกใบรับคืน");
      return;
    }
    // เคยเข้าสต็อกไปแล้ว (ตรวจผ่าน) → ต้องย้อนออก ไม่ให้สต็อกค้างเกินจริง
    const wasStocked = qcStatusOf(r) === "ตรวจแล้ว";
    const backQty = wasStocked ? (r.items || []).filter(i => i.restock).reduce((a2, i) => a2 + (Number(i.qty) || 0), 0) : 0;
    const warn = backQty > 0
      ? String.fromCharCode(10, 10) + `จะย้อนสต็อกออก ${backQty} ตัว (ที่เคยเติมเข้าไปตอนตรวจ)`
      : "";
    if (!window.confirm(`ยกเลิกใบรับคืน ${r.returnNo}?${warn}`)) return;
    if (wasStocked) await applyReturnStock(r.items || [], r.returnNo || "", -1);
    await updateDoc(doc(db, "returns", r.id), {
      status: "ยกเลิก", cancelledBy: user.name, cancelledAt: now(),
      ...(wasStocked ? { qcStatus: "รอตรวจ", stockReversedAt: now() } : {}),
    });
    logAudit(user, { action: AUDIT_ACTIONS.UPDATE, collection: "returns", targetId: r.id, targetLabel: r.returnNo, note: "ยกเลิกใบรับคืน" });
  };

  const handleUpdateInvoiceStatus = async (invId, newStatus) => {
    const inv = invoices.find(i => i.id === invId);
    const oldStatus = inv?.status || "ออกแล้ว";
    await updateDoc(doc(db,"invoices",invId), { status: newStatus });
    logAudit(user, {
      action: AUDIT_ACTIONS.STATUS,
      collection: "invoices",
      targetId: invId,
      targetLabel: `${inv?.invoiceNo||invId} · ${inv?.customerName||""}`,
      note: `เปลี่ยนสถานะ: ${oldStatus} → ${newStatus}`,
    });
  };

  const [paymentModal, setPaymentModal] = useState(null); // invoice object or null
  const [payForm, setPayForm] = useState({ amount:"", method:"โอน", bank:"", slip:"", slipFileName:"", note:"", date:"" });
  const [paySaving, setPaySaving] = useState(false);

  const openPaymentModal = (inv) => {
    setPaymentModal(inv);
    setPayForm({ amount: String(getRemaining(inv)||""), method:"โอน", bank:"", slip:"", slipFileName:"", note:"", date: now() });
  };
  const closePaymentModal = () => { setPaymentModal(null); setPayForm({ amount:"", method:"โอน", bank:"", slip:"", slipFileName:"", note:"", date:"" }); };

  const handlePaySlipUpload = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    try {
      const dataUrl = await compressImage(file, { maxDim: 1200, quality: 0.78 });
      setPayForm(f => ({ ...f, slip: dataUrl, slipFileName: file.name || "slip.jpg" }));
    } catch (err) {
      alert("อัปโหลดสลิปไม่สำเร็จ: " + (err?.message || err));
    } finally {
      if (e.target) e.target.value = "";
    }
  };

  const handleAddPayment = async () => {
    if (paySaving || !paymentModal) return;
    const amt = Number(payForm.amount) || 0;
    if (amt <= 0) { alert("ระบุจำนวนเงินที่ชำระ"); return; }
    setPaySaving(true);
    try {
      const inv = paymentModal;
      const newPayment = {
        id: `pay_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
        amount: amt,
        method: payForm.method || "โอน",
        bank: (payForm.bank||"").trim(),
        slip: payForm.slip || "",
        slipFileName: payForm.slipFileName || "",
        date: payForm.date || now(),
        note: (payForm.note||"").trim(),
        receivedBy: user?.name || "",
        paidAt: now(),
      };
      const newPayments = [...(inv.payments||[]), newPayment];
      const newPaidTotal = newPayments.reduce((s,p)=>s+(Number(p.amount)||0),0);
      const reachedFull = newPaidTotal >= (Number(inv.total)||0) - 0.01;
      const update = { payments: newPayments };
      // auto-suggest status เปลี่ยนเมื่อยอดถึง total
      if (reachedFull && inv.status !== "ชำระแล้ว" && inv.status !== "ยกเลิก") {
        if (window.confirm(`ยอดชำระครบแล้ว (฿${newPaidTotal.toLocaleString("th-TH",{minimumFractionDigits:2})})\nเปลี่ยนสถานะเป็น "ชำระแล้ว" หรือไม่?`)) {
          update.status = "ชำระแล้ว";
        }
      }
      await updateDoc(doc(db,"invoices",inv.id), update);
      logAudit(user, {
        action: AUDIT_ACTIONS.UPDATE,
        collection: "invoices",
        targetId: inv.id,
        targetLabel: `${inv.invoiceNo} · ${inv.customerName}`,
        note: `+ ชำระ ฿${amt.toLocaleString("th-TH",{minimumFractionDigits:2})} (${newPayment.method})${newPayment.slip?" + สลิป":""}`,
      });
      // refresh paymentModal local state เพื่อให้ลิสต์ใน modal อัพเดตทันที
      setPaymentModal({ ...inv, ...update });
      setPayForm({ amount:"", method:"โอน", bank:"", slip:"", slipFileName:"", note:"", date: now() });
    } catch (e) {
      console.error("[handleAddPayment] failed:", e);
      alert("บันทึกการชำระไม่สำเร็จ: " + (e?.message || e));
    } finally {
      setPaySaving(false);
    }
  };

  const handleRemovePayment = async (payId) => {
    if (!paymentModal) return;
    const p = (paymentModal.payments||[]).find(x => x.id === payId);
    if (!p) return;
    if (!window.confirm(`ลบรายการชำระ ฿${Number(p.amount).toLocaleString("th-TH",{minimumFractionDigits:2})}? — กู้คืนไม่ได้`)) return;
    try {
      const newPayments = (paymentModal.payments||[]).filter(x => x.id !== payId);
      await updateDoc(doc(db,"invoices",paymentModal.id), { payments: newPayments });
      logAudit(user, {
        action: AUDIT_ACTIONS.UPDATE,
        collection: "invoices",
        targetId: paymentModal.id,
        targetLabel: `${paymentModal.invoiceNo} · ${paymentModal.customerName}`,
        note: `- ลบรายการชำระ ฿${Number(p.amount).toLocaleString("th-TH",{minimumFractionDigits:2})} (${p.method})`,
      });
      setPaymentModal({ ...paymentModal, payments: newPayments });
    } catch (e) {
      alert("ลบไม่สำเร็จ: " + (e?.message || e));
    }
  };


  const handleResetPassword = async (username, newPassword) => {
    const u = users.find(u => u.username === username);
    if (!u) return;
    await setDoc(doc(db, "users", String(u.id)), { ...u, password: newPassword });
  };

  // 🚀 ยังไม่ล็อกอิน = ไม่ต้องรอโหลดสินค้า → เด้งหน้า login ทันทีที่ auth พร้อม
  // (เดิมรอ products ทั้ง collection ก่อน ทำให้แท็บเล็ต/เน็ตช้าค้างที่หน้าโลโก้นาน)
  if (!authChecked || (loading && user)) return (
    <div style={{minHeight:"100vh",background:"#f4f5f7",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",fontFamily:"'Sarabun',sans-serif"}}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@700&display=swap');@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <div style={{width:64,height:64,background:"linear-gradient(135deg,#3b5b8b,#3b5b8b)",borderRadius:16,display:"flex",alignItems:"center",justifyContent:"center",fontSize:30,marginBottom:20,boxShadow:"0 8px 32px rgba(59,91,139,0.4)"}}>⚙️</div>
      <div style={{fontSize:20,fontWeight:800,color:"#1f2933",fontFamily:"'Space Mono',monospace",letterSpacing:4,marginBottom:8}}>CPU</div>
      <div style={{width:32,height:32,border:"3px solid rgba(59,91,139,0.2)",borderTop:"3px solid #3b5b8b",borderRadius:"50%",animation:"spin 0.8s linear infinite",marginTop:16}}/>
      <div style={{fontSize:12,color:"#52606d",marginTop:12}}>กำลังเชื่อมต่อฐานข้อมูล...</div>
      <button onClick={()=>setLoading(false)} style={{marginTop:24,padding:"8px 20px",borderRadius:9,border:"1px solid rgba(59,91,139,0.3)",background:"rgba(59,91,139,0.1)",color:"#3b5b8b",fontSize:12,cursor:"pointer",fontFamily:"'Sarabun',sans-serif"}}>
        เข้าใช้งานเลย (ข้ามการโหลด)
      </button>
      <div style={{fontSize:11,color:"#9aa5b1",marginTop:8}}>ถ้าโหลดนานเกินไป กรุณาตรวจสอบ Firebase Rules</div>
    </div>
  );

    const handleRegisterUser = async (newU) => {
    // 🔒 ผู้สมัครใหม่ — ไม่เห็นอะไรเลยจนกว่า Admin จะตั้งสิทธิ์ให้
    const lockedNewU = {
      ...newU,
      role: "staff",                  // บังคับเป็น staff (admin ตั้งให้ทีหลัง)
      allowedTabs: [],                // ไม่เห็นเมนูใด ๆ
      permissions: {                  // ไม่มีสิทธิ์ใด ๆ
        canAdd: false,
        canDelete: false,
        canClear: false,
        canCreateOrder: false,
        canIssueInvoice: false,
      },
      pendingApproval: true,          // flag ให้ admin เห็นว่าเพิ่ง register
      registeredAt: now(),
    };
    await setDoc(doc(db, "users", String(newU.id)), lockedNewU);
  };

  if (!user) return <LoginPage users={users} usersLoaded={usersLoaded} onLogin={(u, rememberMe) => handleLogin(u, rememberMe)} onResetPassword={handleResetPassword} onRegister={handleRegisterUser}/>;

  // 🗂 ลำดับเมนู — เรียงตามลำดับงานที่ใช้จริงต่อวัน (ขาย → เก็บเงิน → หลังบ้าน)
  const navStructure = [
    { type:"item",  id:"dashboard", icon:"📊", label:"ภาพรวม" },
    { type:"group", id:"warehouse", icon:"📦", label:"คลัง & ผลิต", children:[
      { id:"inventory", icon:"📦", label:"สินค้าคงคลัง" },
      { id:"stocktake", icon:"🧮", label:"นับสต็อก" },
      { id:"production",icon:"🏭", label:"การผลิต" },
      { id:"productionHistory",icon:"📜", label:"ประวัติการผลิต" },
    ]},
    { type:"item",  id:"orders",       icon:"📋", label:"ใบสั่งของ" },
    { type:"group", id:"billing", icon:"🧾", label:"บิล & เก็บเงิน", children:[
      { id:"invoice",    icon:"🧾", label:"ออกบิล" },
      { id:"statements", icon:"📃", label:"วางบิลเก็บเงิน" },
      { id:"returns",    icon:"↩️", label:"รับคืนสินค้า", badge: (returns||[]).filter(r=>r.status==="รอจับคู่บิล").length },
    ]},
    { type:"item",  id:"catalogInbox", icon:"📥", label:"Inbox (Catalog)", badge: (catalogOrders||[]).filter(o=>!o.status||o.status==="new").length },
    { type:"item",  id:"customers", icon:"👤", label:"ลูกค้า" },
    { type:"item",  id:"transactions", icon:"🔄", label:"รับ/จ่ายสินค้า" },
    { type:"item",  id:"barcode",      icon:"▦",  label:"สแกนบาร์โค้ด" },
    { type:"item",  id:"materials", icon:"🧪", label:"วัตถุดิบ" },
    { type:"item",  id:"suppliers", icon:"🏭", label:"ซัพพลายเออร์" },
    { type:"group", id:"hrdocs", icon:"📂", label:"เอกสาร & บุคลากร", children:[
      { id:"employees", icon:"👷", label:"บัตรลูกจ้าง" },
      { id:"payroll",   icon:"💰", label:"เงินเดือน", adminOnly:true },
      { id:"taxdocs",   icon:"🧾", label:"คลังเอกสารภาษี" },
    ]},
    { type:"item",  id:"alerts",    icon:"🔔", label:"แจ้งเตือน", badge: lowStock.length },
    { type:"group", id:"adminhub", icon:"⚙️", label:"รายงาน & ผู้ดูแล", children:[
      { id:"reports",  icon:"📊", label:"รายงาน" },
      { id:"users",    icon:"👥", label:"จัดการผู้ใช้",   adminOnly:true },
      { id:"auditlog", icon:"📝", label:"ประวัติการใช้",  adminOnly:true },
    ]},
  ];
  // flat list ของทุก tab (รวม children ของ group) — ใช้สำหรับตั้งสิทธิ์ใน Tab Access modal
  const allNavItems = navStructure.flatMap(entry =>
    entry.type === "item" ? [{ id:entry.id, icon:entry.icon, label:entry.label }]
                          : (entry.children || []).map(c => ({ id:c.id, icon:c.icon, label:c.label }))
  );
  // filter ตาม permission: admin เห็นทุกอย่าง / non-admin เห็นเฉพาะที่อยู่ใน allowedTabs
  const canSee = (id) => user.role === "admin" || !user.allowedTabs || user.allowedTabs.includes(id);
  const navItems = navStructure
    .map(entry => {
      if (entry.type === "item") return canSee(entry.id) ? entry : null;
      // group → filter children
      const children = (entry.children || []).filter(c => (!c.adminOnly || user.role === "admin") && canSee(c.id));
      if (children.length === 0) return null;
      return { ...entry, children };
    })
    .filter(Boolean);

  // 🔒 ผู้ใช้ที่ยังไม่ได้รับสิทธิ์ใด ๆ — แสดงหน้า "รออนุมัติ" แทน
  if (user.role !== "admin" && navItems.length === 0) {
    return (
      <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",fontFamily:"'Sarabun',sans-serif",background:T.bg,padding:20}}>
        <div style={{maxWidth:480,width:"100%",background:T.card,border:`1px solid ${T.border}`,borderRadius:16,padding:"36px 28px",textAlign:"center",boxShadow:"0 8px 32px rgba(0,0,0,0.08)"}}>
          <div style={{fontSize:56,marginBottom:14}}>⏳</div>
          <div style={{fontSize:18,fontWeight:700,color:T.text,marginBottom:8}}>รออนุมัติสิทธิ์เข้าใช้งาน</div>
          <div style={{fontSize:13,color:T.sub,lineHeight:1.6,marginBottom:18}}>
            สวัสดีคุณ <b style={{color:T.accent}}>{user.name}</b> 👋<br/>
            บัญชีของคุณ <code style={{background:"rgba(0,0,0,0.05)",padding:"1px 6px",borderRadius:4,fontFamily:"monospace"}}>@{user.username}</code> สมัครเข้าระบบเรียบร้อยแล้ว<br/>
            กรุณารอผู้ดูแลระบบ (Admin) ตั้งสิทธิ์เมนูให้ก่อนใช้งาน
          </div>
          <div style={{padding:"10px 14px",background:"rgba(217,119,6,0.06)",border:"1px solid rgba(217,119,6,0.25)",borderRadius:10,fontSize:11,color:"#92400e",marginBottom:18}}>
            📩 แจ้ง Admin ให้เปิดสิทธิ์เมนูในหน้า "👥 จัดการผู้ใช้"
          </div>
          <button onClick={() => { clearSession(); setUser(null); }}
            style={{padding:"10px 24px",borderRadius:9,border:`1px solid ${T.border}`,background:"white",color:T.sub,cursor:"pointer",fontSize:13,fontFamily:"inherit",fontWeight:600}}>
            ออกจากระบบ
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{display:"flex",height:"100vh",fontFamily:"'Sarabun',sans-serif",background:T.bg,color:T.text,overflow:"hidden"}}>
      {/* Global toast (เมื่อบันทึก stock ขณะ modal ปิดไปแล้ว) */}
      {txSuccess && (
        <div style={{position:"fixed",top:18,left:"50%",transform:"translateX(-50%)",zIndex:9999,background:"#dcfce7",border:"1px solid #86efac",borderRadius:10,padding:"10px 22px",color:"#166534",fontSize:13,fontWeight:600,boxShadow:"0 8px 24px rgba(0,0,0,0.12)",animation:"fadeUp 0.25s ease"}}>
          ✅ บันทึกรายการสำเร็จ
        </div>
      )}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@300;400;500;600;700&family=Space+Mono:wght@400;700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        /* 🐛 flex column + maxHeight → ลูกถูก "บีบ" ให้แบนแทนที่จะ scroll
           (เป็นค่าเริ่มต้นของ flex: flex-shrink 1) — ทำให้การ์ดในลิสต์ที่ยาว
           แบนจนอ่านไม่ออก เหลือแต่เส้น · ใส่คลาสนี้ที่กล่อง scroll แนวตั้งทุกที่ */
        .scroll-col > *{flex-shrink:0}
        ::-webkit-scrollbar{width:8px;height:8px}::-webkit-scrollbar-track{background:#f4f5f7}::-webkit-scrollbar-thumb{background:#cbd2d9;border-radius:4px}::-webkit-scrollbar-thumb:hover{background:#9aa5b1}
        input::placeholder{color:#475569}
        input:focus{outline:none;border-color:#3b5b8b !important;box-shadow:0 0 0 3px rgba(59,91,139,0.15)}select:focus{outline:none;border-color:#3b5b8b !important}
        select:focus{outline:none;border-color:#93c5fd !important}
        .adot{width:8px;height:8px;border-radius:50%;background:#ef4444;display:inline-block;animation:pulse 1.5s infinite}
        @keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.5;transform:scale(.8)}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
        @keyframes shimmer{0%{background-position:-200% center}100%{background-position:200% center}}
        @media(max-width:768px){
          .sidebar-collapse{width:0!important;overflow:hidden!important}
          .main-content{padding:12px!important}
          .hide-mobile{display:none!important}
        }
        /* === Mobile responsive === */
        @media(max-width:900px){
          /* Dashboard cards 4→2 cols */
          .dash-cards{grid-template-columns:repeat(2,1fr)!important;}
          .form-2cols{grid-template-columns:1fr!important;}
          .scroll-x{overflow-x:auto!important;-webkit-overflow-scrolling:touch;}
          .header-actions{flex-wrap:wrap!important;gap:6px!important;}
          .pad-main{padding:12px!important;}
          /* === iOS Safari: force horizontal scroll on tables === */
          .pad-main [style*="border-radius: 16"]{
            overflow-x:auto!important;
            -webkit-overflow-scrolling:touch;
          }
          /* Grid rows ในตาราง (มี px column) — เก็บขนาดไว้เพื่อให้ scroll-x ทำงาน */
          .pad-main [style*="border-radius: 16"] [style*="display: grid"][style*="px"]{
            min-width:720px;
          }
        }
        @media(max-width:600px){
          .dash-cards{grid-template-columns:1fr!important;}
          .hide-xs{display:none!important;}
          /* ทุกตารางบนมือถือเล็ก scroll แนวนอน */
          table{display:block;overflow-x:auto;max-width:100%;-webkit-overflow-scrolling:touch;}
          /* Grid layouts ในตารางใหญ่ — แสดงเป็น card แทน */
          .table-row-grid{display:flex!important;flex-direction:column!important;gap:4px!important;align-items:flex-start!important;}
          /* Modal เกือบเต็มจอ */
          .modal-card,div[role="dialog"]{max-width:96vw!important;width:96vw!important;max-height:92vh!important;}
        }
        @media print{
          /* กรณี user สั่งพิมพ์จากเมนู Chrome (system print) แทนปุ่มใน app
             → ซ่อน UI ที่ไม่เกี่ยวกับเอกสาร */
          .print-hide{display:none !important;}
          .print-modal-overlay{background:white !important;backdrop-filter:none !important;position:static !important;display:block !important;padding:0 !important;}
          .print-modal-card{box-shadow:none !important;border:none !important;border-radius:0 !important;max-height:none !important;overflow:visible !important;width:100% !important;}
          html,body{background:white !important;}
          /* ซ่อน sidebar + header ของหน้าหลักตอนพิมพ์ */
          .sidebar-collapse,nav,.main-header{display:none !important;}
        }
      `}</style>

      {/* Hidden image upload for existing products */}
      <input ref={productImageRef} type="file" accept="image/*" style={{display:"none"}} onChange={handleProductImageUpload}/>

      {/* SIDEBAR */}
      <div style={{width:sidebarOpen?224:60,background:T.sidebar,borderRight:`1px solid ${T.border}`,transition:"width .28s",display:"flex",flexDirection:"column",flexShrink:0,boxShadow:"2px 0 8px rgba(0,0,0,0.04)"}}>
        <div style={{padding:"18px 16px",borderBottom:`1px solid ${T.border}`,display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:36,height:36,borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,overflow:"hidden"}}>
            <img src={`${process.env.PUBLIC_URL}/cpu-logo.png`} alt="CPU" style={{width:"100%",height:"100%",objectFit:"contain"}}/>
          </div>
          {sidebarOpen&&<div><div style={{fontSize:15,fontWeight:800,color:T.text,fontFamily:"'Space Mono',monospace",letterSpacing:3}}>CPU</div><div style={{fontSize:9,color:T.muted}}>ระบบคลังสินค้า</div></div>}
        </div>

        <nav style={{padding:"10px 8px",flex:1,overflowY:"auto"}}>
          {navItems.map(entry => {
            // ── flat item ──
            if (entry.type === "item") {
              const active = activeTab === entry.id;
              return (
                <div key={entry.id} onClick={() => guardedSetActiveTab(entry.id)}
                  className={active?"nav-active-bar":""}
                  style={{display:"flex",alignItems:"center",gap:10,padding:"9px 14px",borderRadius:10,cursor:"pointer",transition:"all .2s",color:active?T.navActiveText:T.sub,fontWeight:active?600:400,fontSize:13,background:active?T.navActive:"transparent",border:active?`1px solid ${T.navActiveBorder}`:"1px solid transparent",marginBottom:2,justifyContent:sidebarOpen?"flex-start":"center",position:"relative",boxShadow:active?"0 0 12px rgba(59,91,139,0.08)":"none"}}>
                  <span style={{fontSize:15,flexShrink:0}}>{entry.icon}</span>
                  {sidebarOpen&&<span style={{fontFamily:"'DM Sans','Sarabun',sans-serif"}}>{entry.label}</span>}
                  {sidebarOpen&&entry.badge>0&&<span style={{marginLeft:"auto",background:T.red,color:"white",borderRadius:10,padding:"1px 7px",fontSize:10,fontWeight:700}}>{entry.badge}</span>}
                </div>
              );
            }
            // ── group ──
            const isOpen = expandedGroups[entry.id] !== false;
            const hasActiveChild = entry.children.some(c => c.id === activeTab);
            // Sidebar collapsed mode → render children flat as icons
            if (!sidebarOpen) {
              return (
                <div key={entry.id}>
                  {entry.children.map(c => {
                    const active = activeTab === c.id;
                    return (
                      <div key={c.id} onClick={() => guardedSetActiveTab(c.id)} title={c.badge>0?`${c.label} (${c.badge})`:c.label}
                        style={{display:"flex",alignItems:"center",gap:10,padding:"9px 14px",borderRadius:10,cursor:"pointer",transition:"all .2s",color:active?T.navActiveText:T.sub,fontSize:13,background:active?T.navActive:"transparent",border:active?`1px solid ${T.navActiveBorder}`:"1px solid transparent",marginBottom:2,justifyContent:"center",position:"relative"}}>
                        <span style={{fontSize:15}}>{c.icon}</span>
                        {c.badge>0&&<span style={{position:"absolute",top:5,right:9,width:7,height:7,borderRadius:4,background:T.red}}/>}
                      </div>
                    );
                  })}
                </div>
              );
            }
            // Sidebar open → group header + children
            return (
              <div key={entry.id} style={{marginBottom:4}}>
                <div onClick={() => setExpandedGroups(p => ({...p, [entry.id]: !isOpen}))}
                  style={{display:"flex",alignItems:"center",gap:10,padding:"7px 14px",borderRadius:10,cursor:"pointer",color:hasActiveChild?T.accent:T.muted,fontWeight:600,fontSize:11,letterSpacing:"0.06em",textTransform:"uppercase",transition:"background .15s",background:hasActiveChild?"rgba(59,91,139,0.04)":"transparent",marginTop:6,marginBottom:3}}
                  onMouseEnter={e=>e.currentTarget.style.background="rgba(59,91,139,0.06)"}
                  onMouseLeave={e=>e.currentTarget.style.background=hasActiveChild?"rgba(59,91,139,0.04)":"transparent"}>
                  <span style={{fontSize:13,flexShrink:0}}>{entry.icon}</span>
                  <span style={{flex:1,fontFamily:"'DM Sans','Sarabun',sans-serif"}}>{entry.label}</span>
                  <span style={{fontSize:9,opacity:0.6,transition:"transform .2s",transform:isOpen?"rotate(0deg)":"rotate(-90deg)"}}>▼</span>
                </div>
                {isOpen && entry.children.map(c => {
                  const active = activeTab === c.id;
                  return (
                    <div key={c.id} onClick={() => guardedSetActiveTab(c.id)}
                      className={active?"nav-active-bar":""}
                      style={{display:"flex",alignItems:"center",gap:10,padding:"8px 14px 8px 26px",borderRadius:10,cursor:"pointer",transition:"all .2s",color:active?T.navActiveText:T.sub,fontWeight:active?600:400,fontSize:12.5,background:active?T.navActive:"transparent",border:active?`1px solid ${T.navActiveBorder}`:"1px solid transparent",marginBottom:2,position:"relative",boxShadow:active?"0 0 12px rgba(59,91,139,0.08)":"none"}}>
                      <span style={{fontSize:14,flexShrink:0}}>{c.icon}</span>
                      <span style={{fontFamily:"'DM Sans','Sarabun',sans-serif"}}>{c.label}</span>
                      {c.badge>0&&<span style={{marginLeft:"auto",background:T.red,color:"white",borderRadius:10,padding:"1px 7px",fontSize:10,fontWeight:700}}>{c.badge}</span>}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </nav>

        {sidebarOpen && (
          <div style={{padding:"12px 16px",borderTop:`1px solid ${T.border}`}}>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
              <div style={{fontSize:22}}>{user.avatar}</div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:12,fontWeight:600,color:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{user.name}</div>
                <div style={{fontSize:10,color:ROLES[user.role].color,fontWeight:600}}>{rLabel(user.role)}</div>
              </div>
            </div>
            <button onClick={openSettings} style={{width:"100%",padding:"7px",borderRadius:8,border:`1px solid ${T.border}`,background:"transparent",color:T.sub,fontSize:12,cursor:"pointer",marginBottom:6,fontFamily:"'Sarabun',sans-serif",fontWeight:500}}>⚙️ ตั้งค่า</button>
            <button onClick={handleLogout} style={{width:"100%",padding:"7px",borderRadius:8,border:`1px solid ${T.border}`,background:"rgba(239,68,68,0.08)",color:T.red,fontSize:12,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontWeight:500}}>🚪 ออกจากระบบ</button>
          </div>
        )}
        <div style={{padding:"8px",borderTop:sidebarOpen?"none":`1px solid ${T.border}`}}>
          <div onClick={() => setSidebarOpen(!sidebarOpen)} style={{display:"flex",alignItems:"center",justifyContent:"center",padding:"8px",borderRadius:8,cursor:"pointer",color:T.muted,fontSize:12}}>
            {sidebarOpen ? "◀" : "▶"}
          </div>
        </div>
      </div>

      {/* MAIN */}
      <div style={{flex:1,overflow:"auto",display:"flex",flexDirection:"column"}}>
        {/* Header */}
        <div style={{padding:"13px 24px",borderBottom:`1px solid ${T.border}`,display:"flex",alignItems:"center",justifyContent:"space-between",background:T.header,position:"sticky",top:0,zIndex:10,boxShadow:"0 1px 4px rgba(0,0,0,0.04)"}}>
          <div>
            <div style={{fontSize:17,fontWeight:700,color:T.text}}>{navItems.find(n=>n.id===activeTab)?.label}</div>
            <div style={{fontSize:10,color:T.muted}}>CPU ERP — ระบบบริหารคลังสินค้า</div>
          </div>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            {/* 🔎 ค้นหาทั้งระบบ — เจอใบเก่าที่อยู่นอกช่วงวันที่ที่โหลดมา (Ctrl+K) */}
            <button onClick={()=>setShowGlobalSearch(true)} title="ค้นหาทั้งระบบ (Ctrl+K)"
              style={{display:"flex",alignItems:"center",gap:8,padding:"7px 14px",borderRadius:20,border:`1px solid ${T.border}`,background:T.input,color:T.sub,cursor:"pointer",fontSize:12.5,fontFamily:"'Sarabun',sans-serif"}}>
              🔎 <span className="hide-xs">ค้นหาทั้งระบบ</span>
              <span className="hide-xs" style={{fontSize:10,color:T.muted,border:`1px solid ${T.border}`,borderRadius:5,padding:"1px 5px"}}>Ctrl K</span>
            </button>
            {activeTab==="materials"&&role.canManageCats&&<BtnGhost onClick={()=>setShowCatModal(true)}>📦 หมวดหมู่</BtnGhost>}
            {activeTab==="materials"&&role.canAdd&&<BtnPrimary onClick={()=>{setNewProduct(p=>({...p,category:"วัตถุดิบ"}));setShowAddModal(true);}}>️ เพิ่มวัตถุดิบ</BtnPrimary>}
            {activeTab==="inventory"&&(inventoryTab==="clothing"||inventoryTab==="sports")&&<BtnGhost onClick={()=>collapseAllClothing(true)} title="พับทุกรุ่น">▶ พับทั้งหมด</BtnGhost>}
            {activeTab==="inventory"&&(inventoryTab==="clothing"||inventoryTab==="sports")&&<BtnGhost onClick={()=>collapseAllClothing(false)} title="กางทุกรุ่น">▼ กางทั้งหมด</BtnGhost>}
            {activeTab==="inventory"&&(inventoryTab==="clothing"||inventoryTab==="sports")&&<BtnGhost onClick={()=>{setSalesDate(new Date().toISOString().slice(0,10));setShowSalesToday(true);}}>📊 ขายวันนี้</BtnGhost>}
            {activeTab==="inventory"&&(inventoryTab==="clothing"||inventoryTab==="sports")&&role.canAdd&&<BtnGhost onClick={()=>setShowSizeManager(true)}>📏 จัดการไซส์</BtnGhost>}
            {activeTab==="inventory"&&(inventoryTab==="clothing"||inventoryTab==="sports")&&role.canAdd&&<BtnPrimary onClick={()=>setShowAddClothing(true)}>{inventoryTab==="sports"?"👟":"️"} เพิ่มรุ่นใหม่</BtnPrimary>}
            {activeTab==="materials"&&<>
              <BtnSuccess onClick={()=>{setTxType("รับ");setTxRows([{productId:"",qty:""}]);setTxNote("");setShowTxModal(true);}}>⬇ รับวัตถุดิบ</BtnSuccess>
              <BtnDanger onClick={()=>{setTxType("จ่าย");setTxRows([{productId:"",qty:""}]);setTxNote("");setShowTxModal(true);}}>⬆ จ่ายวัตถุดิบ</BtnDanger>
            </>}
            {activeTab==="transactions"&&<>
              <BtnSuccess onClick={()=>{setTxType("รับ");setTxRows([{productId:"",qty:""}]);setTxNote("");setShowTxModal(true);}}>⬇ รับสินค้า</BtnSuccess>
              <BtnDanger onClick={()=>{setTxType("จ่าย");setTxRows([{productId:"",qty:""}]);setTxNote("");setShowTxModal(true);}}>⬆ จ่ายสินค้า</BtnDanger>
            </>}
            {activeTab==="inventory"&&role.canClear&&<button onClick={()=>setShowClearConfirm(true)} style={{padding:"8px 16px",borderRadius:8,border:"1px solid rgba(239,68,68,0.3)",background:"rgba(239,68,68,0.08)",color:T.red,fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"'Sarabun',sans-serif"}}>🗑 ล้างคลัง</button>}
          </div>
        </div>

        <div className="pad-main" style={{padding:24,flex:1}}>

          {/* === 💾 ร่างที่กรอกค้างไว้ — โผล่เมื่อแอปถูกโหลดใหม่ระหว่างกรอก (สลับไป LINE ฯลฯ) === */}
          {[
            orderDraft && !showNewOrder && { d: orderDraft, label: "ใบสั่งของ", resume: resumeOrderDraft, drop: clearOrderDraft },
            invoiceDraft && !showNewInvoice && { d: invoiceDraft, label: "บิล", resume: resumeInvoiceDraft, drop: clearInvoiceDraft },
          ].filter(Boolean).map(({ d, label, resume, drop }) => {
            const f = d.value?.form || {};
            const n = (f.items || []).length;
            return (
              <div key={label} style={{marginBottom:12,padding:"11px 15px",background:"rgba(5,150,105,0.08)",border:"1px solid rgba(5,150,105,0.35)",borderRadius:10,display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
                <div style={{fontSize:20}}>💾</div>
                <div style={{flex:1,minWidth:200}}>
                  <div style={{fontSize:13,fontWeight:700,color:"#047857"}}>มี{label}ที่กรอกค้างไว้</div>
                  <div style={{fontSize:11,color:T.sub,marginTop:2}}>
                    {f.customerName || "(ยังไม่ใส่ชื่อลูกค้า)"} · {n} รายการ · {timeAgoTH(d.savedAt)}
                  </div>
                </div>
                <button onClick={resume}
                  style={{padding:"7px 16px",borderRadius:8,border:"none",cursor:"pointer",background:"#059669",color:"white",fontSize:12,fontWeight:700,fontFamily:"'Sarabun',sans-serif"}}>
                  ↩️ ทำต่อ
                </button>
                <button onClick={() => { if (window.confirm(`ทิ้ง${label}ที่กรอกค้างไว้? กู้กลับไม่ได้`)) drop(); }}
                  style={{padding:"7px 12px",borderRadius:8,border:`1px solid ${T.border}`,cursor:"pointer",background:"white",color:T.sub,fontSize:12,fontFamily:"'Sarabun',sans-serif"}}>
                  ทิ้ง
                </button>
              </div>
            );
          })}

          {/* === Backup Reminder Banner === */}
          {backupReminder && (
            <div style={{marginBottom:16,padding:"12px 16px",background:"rgba(184,134,0,0.1)",border:"1px solid rgba(184,134,0,0.35)",borderRadius:10,display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
              <div style={{fontSize:22}}>⚠️</div>
              <div style={{flex:1,minWidth:200}}>
                <div style={{fontSize:13,fontWeight:600,color:"#b88600",marginBottom:2}}>ยังไม่ได้ Backup เกิน 7 วัน</div>
                <div style={{fontSize:11,color:T.sub}}>
                  แนะนำให้ดาวน์โหลด backup เพื่อป้องกันข้อมูลหาย
                  {getLastBackupDate() === 0 ? " — เครื่องนี้ยังไม่เคย backup" : ""}
                </div>
              </div>
              <button onClick={handleOpenBackup} style={{padding:"7px 14px",borderRadius:8,border:"none",cursor:"pointer",background:"linear-gradient(135deg,#b88600,#8c6600)",color:"white",fontSize:12,fontWeight:600,fontFamily:"'Sarabun',sans-serif"}}>💾 Backup ตอนนี้</button>
              <button onClick={handleSnoozeBackupReminder} title="ปิดเตือน 24 ชม." style={{padding:"7px 12px",borderRadius:8,border:`1px solid ${T.border}`,cursor:"pointer",background:"transparent",color:T.sub,fontSize:12,fontFamily:"'Sarabun',sans-serif"}}>เตือนอีกพรุ่งนี้</button>
            </div>
          )}

          <Suspense fallback={<div style={{padding:"40px",textAlign:"center",color:T.muted,fontSize:14}}>⏳ กำลังโหลด...</div>}>
          {/* DASHBOARD */}
          {activeTab==="dashboard"&&(
            <div>
              <div className="dash-cards" style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:16,marginBottom:24}}>
                {[
                  {label:"สินค้าทั้งหมด",value:products.length,unit:"รายการ",icon:"📦",color:T.blue,accent:"#3b5b8b"},
                  {label:"จำนวนรวม",value:totalQty.toLocaleString(),unit:"หน่วย",icon:"📊",color:T.green,accent:"#10b981"},
                  {label:"ต่ำกว่าขั้นต่ำ",value:lowStock.length,unit:"รายการ",icon:"⚠️",color:T.red,accent:"#ef4444"},
                  {label:"รายการเคลื่อนไหว",value:transactions.length,unit:"ครั้ง",icon:"🔄",color:T.amber,accent:"#f59e0b"},
                ].map((s,i)=>(
                  <div key={i} style={{background:"#ffffff",border:`1px solid ${T.border}`,borderRadius:14,overflow:"hidden",boxShadow:"0 4px 20px rgba(0,0,0,0.15)",transition:"transform .2s,box-shadow .2s"}}
                    onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-2px)";e.currentTarget.style.boxShadow=`0 8px 28px rgba(0,0,0,0.25)`;}}
                    onMouseLeave={e=>{e.currentTarget.style.transform="translateY(0)";e.currentTarget.style.boxShadow="0 4px 20px rgba(0,0,0,0.15)";}}>
                    <div style={{height:3,background:`linear-gradient(90deg,${s.accent},${s.accent}88)`}}/>
                    <div style={{padding:20}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14}}>
                        <div style={{fontSize:11,color:T.sub,fontWeight:500,lineHeight:1.4}}>{s.label}</div>
                        <div style={{width:36,height:36,borderRadius:10,background:`${s.accent}18`,border:`1px solid ${s.accent}30`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:17,flexShrink:0}}>{s.icon}</div>
                      </div>
                      <div style={{fontSize:32,fontWeight:800,color:s.color,fontFamily:"'Space Mono',monospace",letterSpacing:-1}}>{s.value}</div>
                      <div style={{fontSize:10,color:T.muted,marginTop:4,textTransform:"uppercase",letterSpacing:"0.06em"}}>{s.unit}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
                <CardBox>
                  <div style={{fontSize:13,fontWeight:600,color:T.text,marginBottom:14}}>📊 สถานะสต็อก</div>
                  {products.length===0?<div style={{color:T.muted,fontSize:13,textAlign:"center",padding:20}}>ยังไม่มีสินค้า</div>:products.slice(0,6).map(p=>(
                    <div key={p.id} style={{marginBottom:12}}>
                      <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}>
                        <span style={{fontSize:12,color:T.text}}>{p.name}</span>
                        <span style={{fontSize:11,color:statusColor(p),fontWeight:600}}>{p.qty}/{p.minQty}</span>
                      </div>
                      <div style={{height:5,borderRadius:3,background:"#ffffff",overflow:"hidden"}}>
                        <div style={{height:"100%",borderRadius:3,width:`${Math.min((Number(p.qty)/Math.max(Number(p.minQty)*2,1))*100,100)}%`,background:statusColor(p),transition:"width .3s"}}/>
                      </div>
                    </div>
                  ))}
                </CardBox>
                <CardBox>
                  <div style={{fontSize:13,fontWeight:600,color:T.text,marginBottom:14}}>🔄 ความเคลื่อนไหวล่าสุด</div>
                  {transactions.length===0?<div style={{color:T.muted,fontSize:13,textAlign:"center",padding:20}}>ยังไม่มีรายการ</div>:transactions.slice(0,5).map(t=>(
                    <div key={t.id} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0",borderBottom:`1px solid ${T.border}`}}>
                      <div style={{width:30,height:30,borderRadius:8,background:t.type==="รับ"?"#dcfce7":"#fef2f2",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,flexShrink:0}}>{t.type==="รับ"?"⬇️":"⬆️"}</div>
                      <div style={{flex:1}}><div style={{fontSize:12,color:T.text,fontWeight:500}}>{t.name}</div><div style={{fontSize:10,color:T.muted}}>{t.date}</div></div>
                      <div style={{fontSize:13,fontWeight:700,color:t.type==="รับ"?T.green:T.red,fontFamily:"monospace"}}>{t.type==="รับ"?"+":"-"}{t.qty}</div>
                    </div>
                  ))}
                </CardBox>
              </div>
            </div>
          )}

          {/* INVENTORY + วัตถุดิบ (แชร์ view ของ products — วัตถุดิบเป็นแท็บใหญ่แยก) */}
          {(activeTab==="inventory"||activeTab==="materials")&&(
            <div>
              {/* Sub-tabs (เฉพาะคลังสินค้า — เสื้อผ้า/รองเท้า) */}
              {activeTab==="inventory"&&<div style={{display:"flex",gap:6,marginBottom:20,padding:"4px",background:T.card,borderRadius:12,border:`1px solid ${T.border}`,width:"fit-content",flexWrap:"wrap"}}>
                {[
                  {id:"clothing",icon:"👕",label:"เสื้อผ้า"},
                  {id:"sports",icon:"👟",label:"รองเท้า & อุปกรณ์กีฬา",cats:["รองเท้า","อุปกรณ์กีฬา"]},
                ].map(t=>{
                  // นับสินค้าในหมวด (รองรับหลาย cats)
                  const count = t.cats ? products.filter(p=>t.cats.includes(p.category)).length
                    : t.id==="clothing" ? clothingItems.length : 0;
                  return (
                    <button key={t.id} onClick={async()=>{
                      setInventoryTab(t.id);
                      // ถ้าเลือก tab หมวด → set filter พิเศษ (จะ filter ที่ products list)
                      if (t.cats) {
                        setSelectedCat("ทั้งหมด"); // ไม่ใช้ chip filter — ใช้ tab filter แทน
                        // auto-create categories ที่ยังไม่มี
                        const missing = t.cats.filter(c => !categories.includes(c));
                        if (missing.length > 0) {
                          try { await setDoc(doc(db,"settings","categories"),{list:[...categories,...missing]}); }
                          catch(err){ console.warn("[cats] auto-create failed:", err); }
                        }
                      } else {
                        setSelectedCat("ทั้งหมด");
                      }
                    }} style={{padding:"8px 20px",borderRadius:9,border:"none",cursor:"pointer",background:inventoryTab===t.id?"linear-gradient(135deg,#3b5b8b,#3b5b8b)":"transparent",color:inventoryTab===t.id?"white":T.sub,fontSize:13,fontWeight:inventoryTab===t.id?700:500,fontFamily:"'Sarabun',sans-serif",transition:"all 0.2s",boxShadow:inventoryTab===t.id?"0 4px 14px rgba(59,91,139,0.3)":"none"}}>
                      {t.icon} {t.label}
                      {count>0&&<span style={{marginLeft:6,background:inventoryTab===t.id?"rgba(255,255,255,0.2)":"rgba(59,91,139,0.1)",borderRadius:10,padding:"1px 7px",fontSize:10}}>{count}</span>}
                    </button>
                  );
                })}
              </div>}

              {/* วัตถุดิบ — แสดง product ทั้งหมด (แท็บใหญ่แยก) */}
              {activeTab==="materials"&&<div>
              <div style={{display:"flex",gap:10,marginBottom:16,alignItems:"center",flexWrap:"wrap"}}>
                <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="🔍 ค้นหาชื่อ, รหัส, บาร์โค้ด..."
                  style={{width:260,background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:8,padding:"8px 12px",fontFamily:"'Sarabun',sans-serif",fontSize:13,outline:"none"}}/>
                <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                  {["ทั้งหมด",...categories].map(c=>(
                    <div key={c} style={{display:"inline-flex",alignItems:"center",borderRadius:8,border:selectedCat===c?`1px solid #bfdbfe`:`1px solid ${T.border}`,background:selectedCat===c?"#eff6ff":"transparent",overflow:"hidden"}}>
                      <button onClick={()=>setSelectedCat(c)} style={{padding:"6px 14px",border:"none",background:"transparent",color:selectedCat===c?T.blue:T.sub,cursor:"pointer",fontSize:12,fontFamily:"'Sarabun',sans-serif",fontWeight:selectedCat===c?600:400}}>{c}</button>
                      {c!=="ทั้งหมด"&&role.canManageCats&&(
                        <button title={`ลบ ${c}`} onClick={async(e)=>{
                          e.stopPropagation();
                          if(!window.confirm(`ลบหมวดหมู่ "${c}"?`)) return;
                          const newList=categories.filter(x=>x!==c);
                          await setDoc(doc(db,"settings","categories"),{list:newList});
                          if(selectedCat===c) setSelectedCat("ทั้งหมด");
                        }} style={{padding:"6px 8px",border:"none",borderLeft:`1px solid ${T.border}`,background:"transparent",color:T.red,cursor:"pointer",fontSize:12,fontWeight:700}}>×</button>
                      )}
                    </div>
                  ))}
                </div>
                <div style={{marginLeft:"auto",fontSize:12,color:T.muted}}>พบ {filtered.length} รายการ</div>
              </div>

              {/* Bulk action bar — โผล่เมื่อมีรายการที่เลือก */}
              {selectedProducts.size > 0 && (
                <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10,padding:"10px 14px",background:"linear-gradient(135deg,rgba(59,91,139,0.08),rgba(16,185,129,0.06))",border:`1px solid ${T.border}`,borderRadius:10}}>
                  <span style={{fontSize:13,fontWeight:700,color:T.accent}}>✓ เลือก {selectedProducts.size} รายการ</span>
                  <span style={{flex:1}}/>
                  <button onClick={()=>openBulkTx("รับ", filtered)} style={{padding:"7px 16px",borderRadius:8,border:"none",background:"linear-gradient(135deg,#16a34a,#16a34a)",color:"white",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",boxShadow:"0 4px 14px rgba(22,163,74,0.3)"}}>⬇ รับสต๊อก {selectedProducts.size} รายการ</button>
                  <button onClick={()=>openBulkTx("จ่าย", filtered)} style={{padding:"7px 16px",borderRadius:8,border:"none",background:"linear-gradient(135deg,#dc2626,#dc2626)",color:"white",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",boxShadow:"0 4px 14px rgba(220,38,38,0.3)"}}>⬆ จ่ายสต๊อก {selectedProducts.size} รายการ</button>
                  <button onClick={()=>setSelectedProducts(new Set())} style={{padding:"7px 14px",borderRadius:8,border:`1px solid ${T.border}`,background:"white",color:T.sub,cursor:"pointer",fontSize:12,fontFamily:"inherit"}}>✕ ล้าง</button>
                </div>
              )}

              <CardBox style={{padding:0,overflow:"hidden"}}>
                <div className="table-scroll">
                {/* Table header */}
                <div style={{display:"grid",gridTemplateColumns:"32px 44px 90px minmax(180px,1fr) 110px 70px 70px 70px 100px 100px",minWidth:1132,alignItems:"center",padding:"10px 16px",background:"#f8f9fb",borderBottom:`1px solid ${T.border}`,color:T.muted,fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.06em"}}>
                  <div style={{textAlign:"center"}}>
                    <input type="checkbox" title="เลือกทั้งหน้า"
                      checked={filtered.length>0 && filtered.every(p=>selectedProducts.has(p.id))}
                      ref={el => { if (el) el.indeterminate = filtered.some(p=>selectedProducts.has(p.id)) && !filtered.every(p=>selectedProducts.has(p.id)); }}
                      onChange={e=>{
                        if (e.target.checked) setSelectedProducts(prev => { const n=new Set(prev); filtered.forEach(p=>n.add(p.id)); return n; });
                        else setSelectedProducts(prev => { const n=new Set(prev); filtered.forEach(p=>n.delete(p.id)); return n; });
                      }}
                      style={{cursor:"pointer",accentColor:T.accent}}/>
                  </div>
                  <div>รูป</div><div>รหัส</div><div>ชื่อสินค้า</div><div>หมวดหมู่</div><div style={{textAlign:"right"}}>จำนวน</div><div style={{textAlign:"right"}}>ขั้นต่ำ</div><div>สถานะ</div><div>ที่เก็บ</div><div style={{textAlign:"center"}}>จัดการ</div>
                </div>
                {filtered.length===0?(
                  <div style={{padding:40,textAlign:"center",color:T.muted,fontSize:13}}>ยังไม่มีสินค้า — กด "️ เพิ่มสินค้า" เพื่อเริ่มต้น</div>
                ):filtered.map((p,i)=>{
                  const isSelected = selectedProducts.has(p.id);
                  return (
                  <div key={p.id} style={{display:"grid",gridTemplateColumns:"32px 44px 90px minmax(180px,1fr) 110px 70px 70px 70px 100px 100px",minWidth:1132,alignItems:"center",padding:"11px 16px",borderBottom:i<filtered.length-1?`1px solid ${T.border}`:"none",transition:"background .15s",background:isSelected?"rgba(59,91,139,0.06)":"transparent"}}
                    onMouseEnter={e=>{if(!isSelected) e.currentTarget.style.background="rgba(59,91,139,0.05)";}} onMouseLeave={e=>{if(!isSelected) e.currentTarget.style.background="transparent";}}>
                    <div style={{textAlign:"center"}}>
                      <input type="checkbox" checked={isSelected} onChange={()=>toggleSelectProduct(p.id)}
                        style={{cursor:"pointer",accentColor:T.accent}}/>
                    </div>
                    <div style={{position:"relative"}}>
                      {p.image
                        ?<img src={p.image} alt="" style={{width:46,height:46,borderRadius:6,objectFit:"cover",border:`1px solid ${T.border}`,cursor:"pointer"}} onClick={()=>setShowImgModal(p)}/>
                        :<div style={{width:46,height:46,borderRadius:6,background:"#f8f9fb",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",fontSize:12,border:"2px dashed rgba(59,91,139,0.4)",cursor:"pointer",gap:1}} onClick={()=>{setUploadingForProduct(p.id);setTimeout(()=>productImageRef.current?.click(),50);}}>
                          <span style={{fontSize:14}}>📷</span>
                          <span style={{fontSize:8,color:T.blue,fontWeight:600}}>เพิ่มรูป</span>
                        </div>
                      }
                    </div>
                    <div style={{fontFamily:"monospace",fontSize:10,color:T.muted}}>{p.code}</div>
                    <div>
                      <div style={{fontWeight:500,color:T.text,fontSize:13}}>{p.name}</div>
                      <div style={{fontSize:10,color:T.muted,fontFamily:"monospace"}}>{p.barcode}</div>
                    </div>
                    <div><Badge bg="#eff6ff" color={T.blue}>{p.category}</Badge></div>
                    <div style={{textAlign:"right",fontFamily:"monospace",fontWeight:700,color:statusColor(p),fontSize:14}}>{Number(p.qty).toLocaleString()}</div>
                    <div style={{textAlign:"right",fontFamily:"monospace",fontSize:12,color:T.muted}}>{p.minQty}</div>
                    <div>
                      <span style={{display:"inline-flex",alignItems:"center",gap:4,padding:"3px 10px",borderRadius:20,fontSize:11,fontWeight:600,background:`${statusColor(p)}15`,color:statusColor(p)}}>
                        {Number(p.qty)<Number(p.minQty)&&<span className="adot"/>}
                        {statusLabel(p)}
                      </span>
                    </div>
                    <div style={{fontSize:11,color:T.sub,fontFamily:"monospace"}}>{p.location}</div>
                    <div style={{display:"flex",gap:3,justifyContent:"center"}}>
                      <button title="ประวัติ" onClick={()=>setShowHistoryModal(p)} style={{background:"#fffbeb",border:"1px solid #fde68a",borderRadius:6,padding:"4px 7px",cursor:"pointer",fontSize:12}}>📅</button>
                      <button title="บาร์โค้ด" onClick={()=>setShowBarcodeModal(p)} style={{background:"#eff6ff",border:`1px solid ${T.navActiveBorder}`,borderRadius:6,padding:"4px 7px",cursor:"pointer",fontSize:12}}>▦</button>
                      {role.canAdd&&<button title="แก้ไข" onClick={()=>setEditingProduct({...p})} style={{background:"#ecfdf5",border:"1px solid #a7f3d0",borderRadius:6,padding:"4px 7px",cursor:"pointer",fontSize:12,color:"#059669"}}>✏️</button>}
                      {role.canDelete&&<button title="ลบ" onClick={()=>setShowDeleteConfirm(p.id)} style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:6,padding:"4px 7px",cursor:"pointer",fontSize:12,color:T.red}}>✕</button>}
                    </div>
                  </div>
                  );
                })}
                </div>
              </CardBox>
              </div>} {/* end general tab */}

              {/* Clothing tab content */}
              {activeTab==="inventory"&&(inventoryTab==="clothing"||inventoryTab==="sports")&&(
                <ClothingInventoryTab
                  inventoryTab={inventoryTab} clothingItems={clothingItems} boms={boms} role={role} sizesFor={sizesFor}
                  clothingSubTab={clothingSubTab} setClothingSubTab={setClothingSubTab}
                  pendingMixSales={pendingMixSales} setPendingMixListOpen={setPendingMixListOpen}
                  clothingImgRef={clothingImgRef} handleClothingImageUpload={handleClothingImageUpload} setUploadingClothingId={setUploadingClothingId}
                  draggingClothingId={draggingClothingId} setDraggingClothingId={setDraggingClothingId}
                  dragOverClothingId={dragOverClothingId} setDragOverClothingId={setDragOverClothingId} reorderClothing={reorderClothing}
                  collapsedItems={collapsedItems} toggleCollapse={toggleCollapse}
                  setShowAddColor={setShowAddColor} openSizeEditor={setSizeEditorItem} openMix={openMix} openBomModal={openBomModal} openProductCatalog={setProductCatalogItem} brandFilter={brandFilter} setBrandFilter={setBrandFilter}
                  manageColorMode={manageColorMode} setManageColorMode={setManageColorMode}
                  setDeleteClothingTarget={setDeleteClothingTarget} setDeleteConfirmText={setDeleteConfirmText}
                  linkedInvColors={linkedInvColors} toggleLinkInvColor={toggleLinkInvColor}
                  editingStock={editingStock} setEditingStock={setEditingStock} handleUpdateClothingStock={handleUpdateClothingStock}
                  setPriceForm={setPriceForm} setPriceModal={setPriceModal}
                  setClothingTxModal={setClothingTxModal} setClothingTxType={setClothingTxType} setClothingTxQty={setClothingTxQty} setClothingTxSizeQty={setClothingTxSizeQty} setClothingTxNote={setClothingTxNote}
                  handleDeleteClothingColor={handleDeleteClothingColor}
                />
              )}
            </div>
          )}

          {/* TRANSACTIONS */}
          {activeTab==="transactions"&&(
            <CardBox style={{padding:0,overflow:"hidden"}}>
              <div style={{padding:"14px 16px",borderBottom:`1px solid ${T.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div style={{fontSize:13,fontWeight:600,color:T.text}}>ประวัติการเคลื่อนไหว <span style={{color:T.muted,fontWeight:400}}>({transactions.length} รายการ)</span></div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"70px 80px 1fr 80px 160px 170px",alignItems:"center",padding:"10px 16px",background:"#f8f9fb",borderBottom:`1px solid ${T.border}`,color:T.muted,fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.06em"}}>
                <div>#</div><div>ประเภท</div><div>สินค้า</div><div style={{textAlign:"right"}}>จำนวน</div><div>ผู้ดำเนินการ</div><div>วันที่/เวลา</div>
              </div>
              {transactions.length===0?<div style={{padding:40,textAlign:"center",color:T.muted,fontSize:13}}>ยังไม่มีรายการ</div>:transactions.map((t,i)=>(
                <div key={t.id} style={{display:"grid",gridTemplateColumns:"70px 80px 1fr 80px 160px 170px",alignItems:"center",padding:"11px 16px",borderBottom:i<transactions.length-1?`1px solid ${T.border}`:"none"}}
                  onMouseEnter={e=>e.currentTarget.style.background="rgba(59,91,139,0.05)"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                  <div style={{fontFamily:"monospace",fontSize:10,color:T.muted}}>#{String(i+1).padStart(4,"0")}</div>
                  <div><Badge bg={t.type==="รับ"?"#dcfce7":"#fef2f2"} color={t.type==="รับ"?T.green:T.red}>{t.type==="รับ"?"⬇ รับ":"⬆ จ่าย"}</Badge></div>
                  <div><div style={{fontWeight:500,color:T.text,fontSize:13}}>{t.name}</div><div style={{fontSize:10,color:T.muted}}>{t.note||"-"}</div></div>
                  <div style={{textAlign:"right",fontFamily:"monospace",fontWeight:700,color:t.type==="รับ"?T.green:T.red}}>{t.type==="รับ"?"+":"-"}{t.qty}</div>
                  <div style={{fontSize:12,color:T.sub}}>{t.by}</div>
                  <div style={{fontSize:11,color:T.muted,fontFamily:"monospace"}}>{t.date}</div>
                </div>
              ))}
            </CardBox>
          )}

          {/* BARCODE */}
          {activeTab==="barcode"&&(
            <BarcodeTab
              products={products} role={role}
              barcodeInputRef={barcodeInputRef} barcodeSearch={barcodeSearch} setBarcodeSearch={setBarcodeSearch} handleBarcodeSearch={handleBarcodeSearch}
              barcodeErr={barcodeErr} setBarcodeErr={setBarcodeErr} barcodeResult={barcodeResult}
              setShowScanner={setShowScanner} setShowBarcodePrint={setShowBarcodePrint}
              setNewProduct={setNewProduct} setShowAddModal={setShowAddModal}
            />
          )}

          {/* ── INVOICE ── */}
          {activeTab==="invoice"&&(
            <InvoiceTab
              invoices={invoices} role={role}
              invoicesRange={invoicesRange} setInvoicesRange={setInvoicesRange} invoicesCapped={invoicesCapped}
              invoiceStatusFilter={invoiceStatusFilter} setInvoiceStatusFilter={setInvoiceStatusFilter}
              invoiceSearch={invoiceSearch} setInvoiceSearch={setInvoiceSearch}
              returns={returns}
              selectedInvoices={selectedInvoices} setSelectedInvoices={setSelectedInvoices} toggleInvoiceSelect={toggleInvoiceSelect}
              collapsedInvoiceMonths={collapsedInvoiceMonths} setCollapsedInvoiceMonths={setCollapsedInvoiceMonths}
              collapsedInvoiceDates={collapsedInvoiceDates} setCollapsedInvoiceDates={setCollapsedInvoiceDates}
              setInvoiceForm={setInvoiceForm} setInvoiceDocType={setInvoiceDocType} setInvoiceVat={setInvoiceVat} setShowNewInvoice={setShowNewInvoice}
              handleMergeInvoices={handleMergeInvoices}
              setShowPrintInvoice={setShowPrintInvoice}
              openPaymentModal={openPaymentModal}
              handleUpdateInvoiceStatus={handleUpdateInvoiceStatus}
              handleConvertQuotation={handleConvertQuotation}
              handleUnmergeInvoice={handleUnmergeInvoice}
              handleEditInvoice={handleEditInvoice}
              handleDeleteInvoice={handleDeleteInvoice}
            />
          )}


          {/* ── ORDERS ── */}
          {activeTab==="production"&&(
            <ProductionTab
              productionOrders={productionOrders||[]}
              customOrders={customOrders||[]}
              boms={boms||[]}
              products={products}
              clothingItems={clothingItems}
              employees={employees||[]}
              customers={customers}
              companyInfo={companyInfo}
              user={user}
              role={role}
              printElementById={printElementById}
              onCreateInvoiceFromCustom={(orders)=>{
                if (!orders?.length) return;
                const first = orders[0];
                const items = [];
                orders.forEach(o => {
                  (o.items||[]).forEach(it => {
                    items.push({
                      clothingId: `custom_${o.id}`,
                      clothingName: o.clothingName || "",
                      colorIdx: 0,
                      colorName: it.colorName || "",
                      colorHex: it.colorHex || "#999999",
                      size: it.size || "",
                      variant: it.variant || "",
                      // 📋 รายละเอียดผลิตเพิ่ม
                      fabricType: o.fabricType || "",
                      collarType: o.collarType || "",
                      jobDescription: o.jobDescription || "",
                      qty: Number(it.qty) || 0,
                      unitPrice: Number(o.costSnapshot?.totalCostPerPiece) || 0,
                      unit: "ตัว",
                      description: o.clothingName || "",
                      _fromCustom: o.prodNo,
                    });
                  });
                });
                // รวบรวม customDetails จากทุก custom order ที่เลือก
                const customDetails = {
                  prodNos: orders.map(o=>o.prodNo).filter(Boolean),
                  // 🔗 id ของใบ custom — ใช้ปั๊ม "ออกบิลแล้ว" กลับไปที่ใบตอนบันทึกบิล
                  orderIds: orders.map(o=>o.id).filter(Boolean),
                  jobs: orders.map(o => ({
                    prodNo: o.prodNo || "",
                    clothingName: o.clothingName || "",
                    fabricType: o.fabricType || "",
                    collarType: o.collarType || "",
                    jobDescription: o.jobDescription || "",
                    note: o.note || "",
                    images: Array.isArray(o.clothingImages) && o.clothingImages.length>0
                      ? o.clothingImages
                      : (o.clothingImage ? [{ dataUrl: o.clothingImage, label: "" }] : []),
                  })),
                };
                setInvoiceDocType("receipt");
                setInvoiceVat(false);
                setShowNewInvoice(true);
                setActiveTab("invoice");
                const custC = (first.customerId && customers.find(c => c.id === first.customerId))
                  || customers.find(c => (c.name||"").trim() === (first.customerName||"").trim());
                // 💰 รวมมัดจำจากทุก custom order ที่เลือก → ผูกเป็นการชำระในบิล
                const custPayments = orders.filter(o => Number(o.depositAmount) > 0).map(o => ({
                  id: `dep_${o.id}`, amount: Number(o.depositAmount), method: o.depositMethod || "โอน",
                  date: o.date || now(), bank: "", note: `มัดจำ (จาก Custom ${o.prodNo})`, receivedBy: o.by || user.name,
                }));
                setTimeout(() => {
                  setInvoiceForm({
                    customerId: first.customerId||custC?.id||"",
                    customerName: first.customerName||custC?.name||"",
                    customerPhone: first.customerPhone||custC?.phone||"",
                    customerAddress: first.customerAddress||custC?.address||"",
                    customerTaxId: first.customerTaxId||custC?.taxId||"",
                    items,
                    payments: custPayments,
                    note: `จาก Custom Order: ${orders.map(o=>o.prodNo).join(", ")}`,
                    dueDate: "",
                    vatRate: 7,
                    discount: 0,
                    discountType: "amount",
                    useShipping: false, shippingFee: 0,
                    ...invoiceDefaults(),
                    customDetails,
                  });
                }, 50);
              }}
            />
          )}

          {activeTab==="orders"&&(
            <OrdersTab
              orders={orders} invoices={invoices} role={role}
              ordersRange={ordersRange} setOrdersRange={setOrdersRange} ordersCapped={ordersCapped}
              orderSearch={orderSearch} setOrderSearch={setOrderSearch}
              orderDateFrom={orderDateFrom} setOrderDateFrom={setOrderDateFrom}
              orderDateTo={orderDateTo} setOrderDateTo={setOrderDateTo}
              collapsedOrderDates={collapsedOrderDates} setCollapsedOrderDates={setCollapsedOrderDates}
              collapsedOrderMonths={collapsedOrderMonths} setCollapsedOrderMonths={setCollapsedOrderMonths}
              selectedOrders={selectedOrders} setSelectedOrders={setSelectedOrders}
              toggleOrderSelect={toggleOrderSelect}
              handleMergeOrdersToInvoice={handleMergeOrdersToInvoice}
              setOrderForm={setOrderForm} setShowNewOrder={setShowNewOrder}
              setShowPrintOrder={setShowPrintOrder}
              openFillOrderMix={openFillOrderMix}
              handleCutStockNow={handleCutStockNow}
              handleDeleteOrder={handleDeleteOrder}
              openEditOrder={openEditOrder}
            />
          )}


          {/* ── CUSTOMERS ── */}
          {activeTab==="customers"&&(
            <CustomersTab
              customers={customers} orders={orders} role={role} user={user}
              customerRegion={customerRegion} setCustomerRegion={setCustomerRegion}
              customerSearch={customerSearch} setCustomerSearch={setCustomerSearch}
              setShowImportCustomers={setShowImportCustomers} setShowNewCustomer={setShowNewCustomer}
              setProfileCustomer={setProfileCustomer} setEditingCustomer={setEditingCustomer}
            />
          )}

          {/* ALERTS */}
          {activeTab==="alerts"&&(
            <div>
              {lowStock.length===0?(
                <div style={{textAlign:"center",padding:60}}>
                  <div style={{fontSize:52,marginBottom:14}}>✅</div>
                  <div style={{fontSize:16,fontWeight:600,color:T.green}}>สินค้าทุกรายการอยู่ในเกณฑ์ปกติ</div>
                </div>
              ):(
                <>
                  <div style={{marginBottom:16,padding:"12px 16px",background:"rgba(239,68,68,0.08)",border:"1px solid rgba(239,68,68,0.25)",borderRadius:10,display:"flex",alignItems:"center",gap:10}}>
                    <span className="adot"/>
                    <span style={{fontSize:13,color:T.red}}>พบสินค้า {lowStock.length} รายการที่ต่ำกว่าขั้นต่ำ</span>
                  </div>
                  {lowStock.map(p=>(
                    <CardBox key={p.id} style={{display:"flex",alignItems:"center",gap:16,borderColor:"#fecaca",marginBottom:10}}>
                      {p.image?<img src={p.image} alt="" style={{width:62,height:62,borderRadius:8,objectFit:"cover"}}/>:<div style={{fontSize:30}}>⚠️</div>}
                      <div style={{flex:1}}>
                        <div style={{fontWeight:600,color:T.text}}>{p.name}</div>
                        <div style={{fontSize:12,color:T.sub}}>{p.code} · ที่เก็บ: {p.location}</div>
                        <div style={{marginTop:8,height:5,borderRadius:3,background:"#f1f5f9",width:200,overflow:"hidden"}}>
                          <div style={{height:"100%",borderRadius:3,width:`${Math.min((Number(p.qty)/Math.max(Number(p.minQty),1))*100,100)}%`,background:T.red}}/>
                        </div>
                      </div>
                      <div style={{textAlign:"right"}}><div style={{fontSize:24,fontWeight:700,color:T.red,fontFamily:"monospace"}}>{p.qty}</div><div style={{fontSize:11,color:T.muted}}>ขั้นต่ำ: {p.minQty} {p.unit}</div></div>
                      <BtnPrimary onClick={()=>{setTxType("รับ");setTxRows([{productId:String(p.id),qty:""}]);setTxNote("");setShowTxModal(true);}}>+ รับสินค้า</BtnPrimary>
                    </CardBox>
                  ))}
                </>
              )}
            </div>
          )}

          {/* USERS (admin เท่านั้น) */}
          {activeTab==="users"&&user.role==="admin"&&(
            <div style={{maxWidth:1000}}>
              <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14,flexWrap:"wrap"}}>
                <div style={{fontSize:14,fontWeight:600,color:T.text}}>👥 รายชื่อผู้ใช้งาน ({users.length} บัญชี)</div>
                <button onClick={()=>{
                  if(showAllPasswords){setShowAllPasswords(false);return;}
                  requireAuth(()=>setShowAllPasswords(true),"แสดงรหัสผ่านทั้งหมด");
                }} style={{padding:"5px 12px",borderRadius:7,border:`1px solid ${showAllPasswords?T.amber:T.border}`,background:showAllPasswords?"rgba(245,158,11,0.1)":"transparent",color:showAllPasswords?T.amber:T.sub,cursor:"pointer",fontSize:11,fontFamily:"'Sarabun',sans-serif",fontWeight:600}}>
                  {showAllPasswords?"🙈 ซ่อนรหัสผ่านทั้งหมด":"👁️ แสดงรหัสผ่านทั้งหมด"}
                </button>
                {pwSessionExp>Date.now()&&<span style={{fontSize:10,color:T.muted,fontFamily:"monospace"}}>🔓 session {Math.ceil((pwSessionExp-Date.now())/60000)} นาที</span>}
                <button onClick={()=>setTabAccessModal({__bulk:true, id:"__bulk__", name:
                  userRoleFilter==="ทั้งหมด" ? "ทุกคน (ยกเว้น Admin)"
                  : userRoleFilter.startsWith("pos:") ? `ทุกคนตำแหน่ง "${userRoleFilter.slice(4)}"`
                  : `ทุก ${userRoleFilter}`, username:"bulk"})}
                  style={{marginLeft:"auto",padding:"6px 14px",borderRadius:8,border:"1px solid rgba(168,85,247,0.4)",background:"rgba(168,85,247,0.1)",color:"#c084fc",cursor:"pointer",fontSize:12,fontFamily:"'Sarabun',sans-serif",fontWeight:600}}>
                  ⚙️ ตั้งสิทธิ์เมนูทุกคนพร้อมกัน
                </button>
              </div>
              {/* Sub-tabs filter — บทบาท + ตำแหน่ง */}
              <div style={{marginBottom:10}}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                  <div style={{fontSize:10,color:T.muted,textTransform:"uppercase",letterSpacing:"0.05em",fontWeight:700}}>👤 บทบาท</div>
                  <button onClick={async()=>{
                    const a=window.prompt("ชื่อบทบาท Admin:",rLabel("admin"));
                    if(a===null) return;
                    const m=window.prompt("ชื่อบทบาท Manager:",rLabel("manager"));
                    if(m===null) return;
                    const s=window.prompt("ชื่อบทบาท Staff:",rLabel("staff"));
                    if(s===null) return;
                    await setDoc(doc(db,"settings","roleLabels"),{admin:a.trim()||ROLES.admin.label,manager:m.trim()||ROLES.manager.label,staff:s.trim()||ROLES.staff.label});
                  }} style={{padding:"2px 8px",borderRadius:6,border:`1px solid ${T.border}`,background:"transparent",color:T.sub,cursor:"pointer",fontSize:10,fontFamily:"'Sarabun',sans-serif"}}>✏️ เปลี่ยนชื่อ</button>
                </div>
                <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                  {[
                    {key:"ทั้งหมด",label:"ทั้งหมด",icon:"📋",color:T.accent},
                    {key:"admin",label:rLabel("admin"),icon:"👑",color:T.amber},
                    {key:"manager",label:rLabel("manager"),icon:"🧑‍💼",color:T.blue},
                    {key:"staff",label:rLabel("staff"),icon:"👷",color:T.green},
                  ].map(t=>{
                    const count=t.key==="ทั้งหมด"?users.length:users.filter(u=>u.role===t.key).length;
                    const sel=userRoleFilter===t.key;
                    return (
                      <button key={t.key} onClick={()=>setUserRoleFilter(t.key)}
                        style={{padding:"7px 14px",borderRadius:9,border:`1px solid ${sel?t.color:T.border}`,background:sel?`${t.color}20`:"transparent",color:sel?t.color:T.sub,cursor:"pointer",fontSize:12,fontFamily:"'Sarabun',sans-serif",fontWeight:sel?700:500,transition:"all 0.15s"}}>
                        {t.icon} {t.label} <span style={{fontSize:10,opacity:0.7,marginLeft:4}}>({count})</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              {/* Position tabs — สร้างอัตโนมัติจากตำแหน่งที่กรอกไว้ */}
              {(()=>{const positions=[...new Set(users.map(u=>u.position).filter(Boolean))].sort();
              if(positions.length===0) return null;
              return (
                <div style={{marginBottom:14}}>
                  <div style={{fontSize:10,color:T.muted,marginBottom:6,textTransform:"uppercase",letterSpacing:"0.05em",fontWeight:700}}>💼 ตำแหน่งหน้าที่</div>
                  <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                    {positions.map(p=>{
                      const sel=userRoleFilter===`pos:${p}`;
                      const count=users.filter(u=>u.position===p).length;
                      return (
                        <button key={p} onClick={()=>setUserRoleFilter(`pos:${p}`)}
                          style={{padding:"7px 14px",borderRadius:9,border:`1px solid ${sel?"#c084fc":T.border}`,background:sel?"rgba(168,85,247,0.15)":"transparent",color:sel?"#c084fc":T.sub,cursor:"pointer",fontSize:12,fontFamily:"'Sarabun',sans-serif",fontWeight:sel?700:500}}>
                          💼 {p} <span style={{fontSize:10,opacity:0.7,marginLeft:4}}>({count})</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );})()}
              {(()=>{const filteredUsers=
                userRoleFilter==="ทั้งหมด" ? users
                : userRoleFilter.startsWith("pos:") ? users.filter(u=>u.position===userRoleFilter.slice(4))
                : users.filter(u=>u.role===userRoleFilter);
              return (
              <CardBox style={{padding:0,overflowX:"auto",overflowY:"visible",WebkitOverflowScrolling:"touch"}}>
                <div style={{minWidth:820}}>
                <div style={{display:"grid",gridTemplateColumns:"40px 1fr 140px 140px 130px 130px 80px 60px",alignItems:"center",padding:"10px 16px",background:"#f8f9fb",borderBottom:`1px solid ${T.border}`,color:T.muted,fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.06em"}}>
                  <div></div><div>ชื่อ / ผู้ใช้</div><div>ตำแหน่ง</div><div>รหัสผ่าน</div><div>บทบาท</div><div>สิทธิ์</div><div style={{textAlign:"center"}}>เมนู</div><div style={{textAlign:"center"}}>ลบ</div>
                </div>
                {filteredUsers.length===0&&<div style={{padding:30,textAlign:"center",color:T.muted,fontSize:13}}>ไม่มีผู้ใช้ในกลุ่มนี้</div>}
                {filteredUsers.map((u,i)=>(
                  <div key={u.id} style={{display:"grid",gridTemplateColumns:"40px 1fr 140px 140px 130px 130px 80px 60px",alignItems:"center",padding:"12px 16px",borderBottom:i<filteredUsers.length-1?`1px solid ${T.border}`:"none"}}
                    onMouseEnter={e=>e.currentTarget.style.background="rgba(59,91,139,0.05)"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                    <div style={{fontSize:22}}>{u.avatar}</div>
                    <div>
                      <div style={{fontWeight:600,color:T.text,fontSize:13,display:"flex",alignItems:"center",gap:6}}>
                        {u.name}
                        {u.pendingApproval && (!u.allowedTabs || u.allowedTabs.length===0) && (
                          <span style={{padding:"2px 8px",background:"rgba(217,119,6,0.12)",color:"#d97706",border:"1px solid rgba(217,119,6,0.3)",borderRadius:10,fontSize:9,fontWeight:700,letterSpacing:"0.05em"}} title={`สมัครเข้ามาเมื่อ ${u.registeredAt||"-"} — รออนุมัติสิทธิ์`}>⏳ รออนุมัติ</span>
                        )}
                      </div>
                      <div style={{fontSize:11,color:T.muted}}>@{u.username}</div>
                    </div>
                    <div>
                      <input defaultValue={u.position||""} placeholder="เช่น เซลล์, คลัง"
                        onBlur={async e=>{const v=e.target.value.trim();if(v===(u.position||""))return;await setDoc(doc(db,"users",String(u.id)),{...u,position:v});}}
                        onKeyDown={e=>e.key==="Enter"&&e.target.blur()}
                        style={{width:"100%",background:"rgba(168,85,247,0.06)",border:"1px solid rgba(168,85,247,0.25)",color:"#c084fc",borderRadius:6,padding:"5px 8px",fontFamily:"'Sarabun',sans-serif",fontSize:12,outline:"none"}}/>
                    </div>
                    <div style={{display:"flex",alignItems:"center",gap:6}}>
                      {(showAllPasswords||visiblePasswords[u.id])?(
                        <code style={{fontFamily:"monospace",fontSize:12,color:T.amber,background:"rgba(245,158,11,0.1)",padding:"3px 8px",borderRadius:5,border:"1px solid rgba(245,158,11,0.25)",cursor:"pointer"}}
                          onClick={()=>{navigator.clipboard?.writeText(u.password);}}
                          title="คลิกเพื่อ copy">{u.password}</code>
                      ):(
                        <code style={{fontFamily:"monospace",fontSize:12,color:T.muted,letterSpacing:2}}>••••••</code>
                      )}
                      <button onClick={()=>{
                        if(visiblePasswords[u.id]||showAllPasswords){setVisiblePasswords(p=>({...p,[u.id]:false}));return;}
                        requireAuth(()=>setVisiblePasswords(p=>({...p,[u.id]:true})),`ดูรหัสผ่านของ ${u.name}`);
                      }} style={{background:"none",border:"none",cursor:"pointer",fontSize:13,padding:0,color:T.sub}} title={(showAllPasswords||visiblePasswords[u.id])?"ซ่อน":"แสดง"}>
                        {(showAllPasswords||visiblePasswords[u.id])?"🙈":"👁️"}
                      </button>
                      <button onClick={async()=>{
                        const np=window.prompt(`ตั้งรหัสผ่านใหม่ให้ ${u.name} (@${u.username}):`);
                        if(!np||np.length<4){if(np)alert("รหัสผ่านต้องมีอย่างน้อย 4 ตัว");return;}
                        await setDoc(doc(db,"users",String(u.id)),{...u,password:np});
                        logAudit(user,{action:AUDIT_ACTIONS.PERMISSION,collection:"users",targetId:u.id,targetLabel:`${u.name} (@${u.username})`,note:"รีเซ็ตรหัสผ่าน"});
                      }} style={{background:"rgba(59,91,139,0.1)",border:"1px solid rgba(59,91,139,0.25)",borderRadius:5,color:T.accent,cursor:"pointer",fontSize:10,padding:"2px 6px",fontFamily:"'Sarabun',sans-serif"}} title="รีเซ็ตรหัสผ่าน">🔑</button>
                    </div>
                    <div>
                      {user.role==="admin" ? (
                        <select value={u.role} onChange={async e=>{
                          const newRole = e.target.value;
                          const oldRole = u.role;
                          const updated = {...u, role: newRole, avatar: newRole==="admin"?"👑":newRole==="manager"?"🧑‍💼":"👷"};
                          await setDoc(doc(db,"users",String(u.id)),updated);
                          logAudit(user,{action:AUDIT_ACTIONS.PERMISSION,collection:"users",targetId:u.id,targetLabel:`${u.name} (@${u.username})`,note:`เปลี่ยนบทบาท: ${rLabel(oldRole)} → ${rLabel(newRole)}`});
                        }} style={{background:T.input,border:`1px solid ${T.inputBorder}`,color:ROLES[u.role].color,borderRadius:8,padding:"5px 8px",fontFamily:"'Sarabun',sans-serif",fontSize:12,fontWeight:600,outline:"none",cursor:"pointer"}}>
                          <option value="admin">👑 {rLabel("admin")}</option>
                          <option value="manager">🧑‍💼 {rLabel("manager")}</option>
                          <option value="staff">👷 {rLabel("staff")}</option>
                        </select>
                      ) : (
                        <Badge bg={`${ROLES[u.role].color}15`} color={ROLES[u.role].color}>{rLabel(u.role)}</Badge>
                      )}
                    </div>
                    <div style={{display:"flex",flexDirection:"row",gap:10,fontSize:11,flexWrap:"wrap"}}>
                      {(()=>{
                        const eff=(k)=>u.permissions&&k in u.permissions?u.permissions[k]:ROLES[u.role][k];
                        const togglePerm=async(k)=>{
                          const prev=eff(k);
                          const newPerms={...(u.permissions||{}),[k]:!prev};
                          await setDoc(doc(db,"users",String(u.id)),{...u,permissions:newPerms});
                          logAudit(user,{action:AUDIT_ACTIONS.PERMISSION,collection:"users",targetId:u.id,targetLabel:`${u.name} (@${u.username})`,note:`สิทธิ์ ${k}: ${prev?"✓":"✗"} → ${!prev?"✓":"✗"}`});
                        };
                        const overridden=(k)=>u.permissions&&k in u.permissions&&u.permissions[k]!==ROLES[u.role][k];
                        return [
                          {k:"canAdd",l:"เพิ่ม",c:"#34d399"},
                          {k:"canDelete",l:"ลบ",c:"#f87171"},
                          {k:"canClear",l:"ล้าง",c:T.amber},
                          {k:"canCreateOrder",l:"📋 ออกใบสั่ง",c:"#3b5b8b"},
                          {k:"canIssueInvoice",l:"🧾 ออกบิล",c:"#a78bfa"},
                        ].map(p=>{
                          const on=eff(p.k);
                          return (
                            <label key={p.k} onClick={()=>togglePerm(p.k)} style={{display:"flex",alignItems:"center",gap:5,cursor:"pointer",userSelect:"none"}}>
                              <input type="checkbox" checked={!!on} readOnly style={{cursor:"pointer",accentColor:p.c}}/>
                              <span style={{color:on?p.c:T.muted,fontWeight:on?600:400,fontSize:11}}>{p.l}</span>
                              {overridden(p.k)&&<span style={{fontSize:8,color:"#c084fc"}} title="กำหนดเอง (ไม่ใช่ค่าเริ่มต้นของบทบาท)">●</span>}
                            </label>
                          );
                        });
                      })()}
                    </div>
                    <div style={{textAlign:"center"}}>
                      {u.role==="admin"?(
                        <span style={{fontSize:10,color:T.muted}}>ทั้งหมด</span>
                      ):(
                        <button onClick={()=>setTabAccessModal(u)} style={{background:"rgba(59,91,139,0.1)",border:"1px solid rgba(59,91,139,0.25)",borderRadius:6,padding:"4px 10px",cursor:"pointer",fontSize:11,color:T.accent,fontFamily:"'Sarabun',sans-serif",fontWeight:600}}>
                          ⚙️ {u.allowedTabs?`${u.allowedTabs.length}/${allNavItems.length}`:"ทั้งหมด"}
                        </button>
                      )}
                    </div>
                    <div style={{textAlign:"center"}}>
                      {user.role==="admin" && String(u.id)!==String(user.id) && (
                        <button onClick={()=>setShowDeleteUserConfirm(u)} style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:6,padding:"5px 10px",cursor:"pointer",fontSize:13,color:T.red,fontWeight:700}}>✕</button>
                      )}
                    </div>
                  </div>
                ))}
                </div>
              </CardBox>
              );})()}
              <div style={{marginTop:14,padding:12,background:"rgba(59,91,139,0.08)",border:"1px solid rgba(59,91,139,0.2)",borderRadius:10,fontSize:12,color:"#3b5b8b"}}>
                💡 พนักงานใหม่สมัครได้เองที่หน้า Login → "สมัคร Staff ID ใหม่" · Admin กำหนดบทบาท + เมนูที่เห็นได้ที่นี่
              </div>
            </div>
          )}

          {/* ── REPORTS ── */}
          {activeTab==="reports"&&(
            <ReportsTab products={products} transactions={reportTx.length ? reportTx : transactions} invoices={invoices} orders={orders} customers={customers} clothingItems={clothingItems}/>
          )}

          {/* ── SUPPLIERS ── */}
          {activeTab==="suppliers"&&(
            <SuppliersTab suppliers={suppliers} role={role}/>
          )}

          {/* ── AUDIT LOG (admin only) ── */}
          {activeTab==="auditlog"&&user.role==="admin"&&(
            <AuditLogTab auditLogs={auditLogs} users={users}/>
          )}

          {/* ── STOCKTAKE — นับสต็อกจริง ── */}
          {activeTab==="stocktake"&&(
            <StocktakeTab products={products} clothingItems={clothingItems} user={user} role={role}/>
          )}

          {/* ── EMPLOYEES — บัตรลูกจ้าง ── */}
          {activeTab==="employees"&&(
            <EmployeeTab employees={employees} orders={[...(productionOrders||[]), ...(customOrders||[])]} user={user} role={role}/>
          )}

          {/* ── PRODUCTION HISTORY — งานที่ archived จาก Kanban ── */}
          {activeTab==="productionHistory"&&(
            <ProductionHistoryTab
              productionOrders={productionOrders}
              customOrders={customOrders}
              user={user}
              role={role}
            />
          )}

          {/* ── PAYROLL — เงินเดือน (admin เท่านั้น) ── */}
          {activeTab==="payroll"&&user.role==="admin"&&(
            <PayrollTab
              employees={employees}
              attendance={attendance}
              payrollRuns={payrollRuns}
              user={user}
              role={role}
              printElementById={printElementById}
            />
          )}
          {activeTab==="payroll"&&user.role!=="admin"&&(
            <div style={{textAlign:"center",padding:60,background:T.card,borderRadius:14,border:`1px solid ${T.border}`}}>
              <div style={{fontSize:48,marginBottom:12}}>🔒</div>
              <div style={{fontSize:16,fontWeight:700,color:T.red,marginBottom:6}}>เข้าถึงไม่ได้</div>
              <div style={{fontSize:12,color:T.muted}}>ระบบเงินเดือนเข้าถึงได้เฉพาะผู้ดูแลระบบ (admin)</div>
            </div>
          )}

          {/* ── TAX DOCS — คลังเอกสารภาษี ── */}
          {activeTab==="taxdocs"&&(
            <TaxDocsTab taxDocs={taxDocs} suppliers={suppliers} user={user} role={role}/>
          )}

          {/* ── CATALOG INBOX — order จาก /catalog ── */}
          {activeTab==="catalogInbox"&&(
            <>
            <div style={{display:"flex",justifyContent:"flex-end",marginBottom:12}}>
              <button onClick={()=>setShowShareCatalog(true)}
                style={{padding:"9px 18px",borderRadius:9,border:"none",cursor:"pointer",background:"linear-gradient(135deg,#3b5b8b,#3b5b8b)",color:"white",fontSize:12,fontWeight:600,fontFamily:"'Sarabun',sans-serif",boxShadow:"0 4px 14px rgba(59,91,139,0.3)"}}>
                📱 ลิงก์ + QR สั่งของ (ให้ลูกค้า)
              </button>
            </div>
            <CatalogInboxTab
              catalogOrders={catalogOrders}
              catalogRange={catalogRange} setCatalogRange={setCatalogRange} catalogCapped={catalogCapped}
              clothingItems={clothingItems}
              customers={customers}
              companyInfo={companyInfo}
              user={user}
              onConvert={async (co, customerChoice) => {
                const r = await convertCatalogOrder(co, customerChoice);
                if (!r.ok) { alert(r.message); return; }
                alert(`✅ สร้างคำสั่งซื้อ ${r.orderNo} แล้ว
ไปที่ tab "คำสั่งซื้อ" เพื่อยืนยัน/ปริ้น/ตัดสต็อก`);
              }}
              onBulkConvert={handleBulkConvert}
            />
            </>
          )}

          {/* ── STATEMENTS (ใบวางบิลรวมเดือน) ── */}
          {activeTab==="returns"&&(
            <ReturnsTab
              returns={returns} role={role} user={user}
              onNewReturn={()=>{setEditingReturn(null);setShowReturnModal(true);}}
              onEditReturn={(r)=>{setEditingReturn(r);setShowReturnModal(true);}}
              onCancelReturn={handleCancelReturn}
              onQcReturn={handleQcReturn}
              onCreditNote={openCreditNote}
              onRefundPaid={handleRefundPaid}
              onOpenInvoice={(id)=>{const inv=invoices.find(i=>i.id===id); if(inv) setShowPrintInvoice(inv); else alert("บิลใบนี้อยู่นอกช่วงที่โหลดมา — ขยายช่วงวันที่ในแท็บออกบิลก่อน");}}
            />
          )}

          {activeTab==="statements"&&(
            <StatementTab
              statements={statements}
              returns={returns}
              invoices={invoices}
              customers={customers}
              companyInfo={companyInfo}
              user={user}
              role={role}
              printElementById={printElementById}
            />
          )}
          </Suspense>


        </div>
      </div>

      {/* 🚀 โซน modal ทั้งหมด — บางตัวโหลดแบบ lazy ตอนกดเปิดจริง
          fallback={null} เพราะ modal ที่ยังไม่ถูกเปิดไม่ควรวาดอะไรเลย */}
      <Suspense fallback={null}>

      {/* ── MODAL: เพิ่มสินค้า ── */}
      {showAddModal&&(
        <Modal onClose={()=>setShowAddModal(false)} w={640}>
          <MHead title="🆕 เพิ่มสินค้าใหม่" onClose={()=>setShowAddModal(false)}/>
          {addSuccess&&<Toast msg="เพิ่มสินค้าสำเร็จ!"/>}
          <div style={{display:"flex",alignItems:"center",gap:16,marginBottom:18,padding:14,background:"#f8fafc",borderRadius:10,border:`1px solid ${T.border}`}}>
            <div style={{flexShrink:0}}>
              {newProduct.image?<img src={newProduct.image} alt="" style={{width:96,height:96,borderRadius:10,objectFit:"cover",border:`2px solid ${T.blue}`}}/>
                :<div style={{width:96,height:96,borderRadius:10,background:T.input,display:"flex",alignItems:"center",justifyContent:"center",fontSize:28,border:`2px dashed ${T.inputBorder}`,cursor:"pointer"}} onClick={()=>imageInputRef.current?.click()}>📷</div>}
            </div>
            <div>
              <div style={{fontSize:12,color:T.sub,marginBottom:8,fontWeight:500}}>📸 รูปสินค้า</div>
              <BtnGhost onClick={()=>imageInputRef.current?.click()} style={{fontSize:12,padding:"6px 14px"}}>📁 อัปโหลดรูป</BtnGhost>
              {newProduct.image&&<BtnGhost onClick={()=>setNewProduct(p=>({...p,image:""}))} style={{fontSize:12,padding:"6px 14px",marginLeft:6,color:T.red}}>✕ ลบ</BtnGhost>}
              <input ref={imageInputRef} type="file" accept="image/*" style={{display:"none"}} onChange={handleImageUpload}/>
            </div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
            {[{k:"code",l:"รหัสสินค้า *",ph:"เช่น RM-004"},{k:"name",l:"ชื่อสินค้า *",ph:"ชื่อสินค้า"},{k:"unit",l:"หน่วยนับ *",ph:"เช่น ชิ้น, กล่อง"},{k:"location",l:"ตำแหน่งที่เก็บ",ph:"เช่น A-05"},{k:"qty",l:"จำนวนเริ่มต้น *",ph:"0",t:"number"},{k:"minQty",l:"จำนวนขั้นต่ำ",ph:"0",t:"number"},{k:"costPrice",l:"ราคาทุน (฿)",ph:"0.00",t:"number"},{k:"salePrice",l:"ราคาขาย (฿)",ph:"0.00",t:"number"}].map(f=>(
              <Input key={f.k} label={f.l} type={f.t||"text"} placeholder={f.ph} value={newProduct[f.k]} onChange={e=>setNewProduct(p=>({...p,[f.k]:e.target.value}))}/>
            ))}
            {newProduct.costPrice&&newProduct.salePrice&&Number(newProduct.costPrice)>0&&(
              <div style={{gridColumn:"1/-1",padding:"10px 14px",borderRadius:8,background:"rgba(52,211,153,0.08)",border:"1px solid rgba(52,211,153,0.2)"}}>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:12}}>
                  <span style={{color:T.sub}}>กำไรต่อชิ้น</span>
                  <span style={{fontFamily:"monospace",fontWeight:700,color:"#34d399"}}>฿{(Number(newProduct.salePrice)-Number(newProduct.costPrice)).toLocaleString("th-TH",{minimumFractionDigits:2})}</span>
                </div>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:12,marginTop:4}}>
                  <span style={{color:T.sub}}>% กำไร</span>
                  <span style={{fontFamily:"monospace",fontWeight:700,color:"#34d399"}}>{(((Number(newProduct.salePrice)-Number(newProduct.costPrice))/Number(newProduct.costPrice))*100).toFixed(1)}%</span>
                </div>
              </div>
            )}
            <div>
              <label style={{fontSize:11,color:T.sub,display:"block",marginBottom:5,fontWeight:500}}>หมวดหมู่</label>
              <select value={newProduct.category||categories[0]} onChange={e=>setNewProduct(p=>({...p,category:e.target.value}))} style={{width:"100%",background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:8,padding:"9px 12px",fontFamily:"'Sarabun',sans-serif",fontSize:13,outline:"none"}}>
                {categories.map(c=><option key={c}>{c}</option>)}
              </select>
            </div>
            <Input label="บาร์โค้ด (ว่าง = อัตโนมัติ)" placeholder="หรือเว้นว่างไว้" value={newProduct.barcode} onChange={e=>setNewProduct(p=>({...p,barcode:e.target.value}))}/>
          </div>
          {/* 🧱 ใช้เป็นวัตถุดิบ */}
          <div style={{marginTop:14,padding:"12px 14px",background:"#f1f5f9",border:`1px solid ${T.border}`,borderRadius:9}}>
            <div style={{fontSize:11,color:T.muted,fontWeight:600,marginBottom:6,textTransform:"uppercase",letterSpacing:"0.05em"}}>🧱 การใช้งานในการผลิต</div>
            <label style={{display:"flex",alignItems:"center",gap:8,fontSize:13,color:T.text,cursor:"pointer",padding:"4px 0"}}>
              <input type="checkbox" checked={!!newProduct.usedAsMaterial} onChange={e=>setNewProduct(p=>({...p,usedAsMaterial:e.target.checked}))}/>
              <span>🧱 ใช้รายการนี้เป็น "วัตถุดิบ" ในสูตร BOM</span>
            </label>
            {newProduct.usedAsMaterial&&(
              <label style={{display:"flex",alignItems:"center",gap:8,fontSize:12,color:T.sub,cursor:"pointer",padding:"4px 0",marginLeft:24}}>
                <input type="checkbox" checked={!!newProduct.isCostOnly} onChange={e=>setNewProduct(p=>({...p,isCostOnly:e.target.checked}))}/>
                <span>💡 ต้นทุนเท่านั้น — คำนวณค่าใช้จ่ายแต่ไม่ตัดสต็อก (เช่น ค่าไฟ)</span>
              </label>
            )}
          </div>
          <div style={{display:"flex",gap:10,marginTop:20}}>
            <BtnGhost onClick={()=>setShowAddModal(false)} style={{flex:1}}>ยกเลิก</BtnGhost>
            <BtnPrimary onClick={handleAddProduct} disabled={addProductSaving||!newProduct.code||!newProduct.name||newProduct.qty===""||!newProduct.unit} style={{flex:1}}>{addProductSaving?"⏳ กำลังบันทึก...":"✅ บันทึกสินค้า"}</BtnPrimary>
          </div>
        </Modal>
      )}

      {/* ── MODAL: แก้ไขสินค้า ── */}
      {editingProduct&&(
        <Modal onClose={()=>setEditingProduct(null)} w={640}>
          <MHead title="✏️ แก้ไขรายละเอียดสินค้า" sub={`${editingProduct.code} · ${editingProduct.name}`} onClose={()=>setEditingProduct(null)}/>
          <div style={{display:"flex",alignItems:"center",gap:16,marginBottom:18,padding:14,background:"#f8fafc",borderRadius:10,border:`1px solid ${T.border}`}}>
            <div style={{flexShrink:0}}>
              {editingProduct.image
                ? <img src={editingProduct.image} alt="" style={{width:96,height:96,borderRadius:10,objectFit:"cover",border:`2px solid ${T.blue}`}}/>
                : <div style={{width:96,height:96,borderRadius:10,background:T.input,display:"flex",alignItems:"center",justifyContent:"center",fontSize:28,border:`2px dashed ${T.inputBorder}`}}>📷</div>}
            </div>
            <div>
              <div style={{fontSize:12,color:T.sub,marginBottom:8,fontWeight:500}}>📸 รูปสินค้า</div>
              <BtnGhost onClick={()=>{
                const inp=document.createElement("input");inp.type="file";inp.accept="image/*";
                inp.onchange=async (e)=>{const f=e.target.files?.[0];if(!f)return;try{const dataUrl=await compressImage(f,{maxDim:1000,quality:0.75});const {url,path}=await uploadImage(dataUrl,"products");setEditingProduct(p=>{if(p?.imagePath)deleteFile(p.imagePath);return {...p,image:url,imagePath:path};});}catch(err){alert("อัปโหลดรูปไม่สำเร็จ: "+(err?.message||err));}};
                inp.click();
              }} style={{fontSize:12,padding:"6px 14px"}}>📁 เปลี่ยนรูป</BtnGhost>
              {editingProduct.image&&<BtnGhost onClick={()=>setEditingProduct(p=>({...p,image:""}))} style={{fontSize:12,padding:"6px 14px",marginLeft:6,color:T.red}}>✕ ลบรูป</BtnGhost>}
            </div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
            {[{k:"code",l:"รหัสสินค้า *"},{k:"name",l:"ชื่อสินค้า *"},{k:"unit",l:"หน่วยนับ *"},{k:"location",l:"ตำแหน่งที่เก็บ"},{k:"qty",l:"คงเหลือ",t:"number"},{k:"minQty",l:"จำนวนขั้นต่ำ",t:"number"},{k:"costPrice",l:"ราคาทุน (฿)",t:"number"},{k:"salePrice",l:"ราคาขาย (฿)",t:"number"}].map(f=>(
              <Input key={f.k} label={f.l} type={f.t||"text"} value={editingProduct[f.k]??""} onChange={e=>setEditingProduct(p=>({...p,[f.k]:e.target.value}))}/>
            ))}
            <div>
              <label style={{fontSize:11,color:T.sub,display:"block",marginBottom:5,fontWeight:500}}>หมวดหมู่</label>
              <select value={editingProduct.category||categories[0]||""} onChange={e=>setEditingProduct(p=>({...p,category:e.target.value}))} style={{width:"100%",background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:8,padding:"9px 12px",fontFamily:"'Sarabun',sans-serif",fontSize:13,outline:"none"}}>
                {categories.map(c=><option key={c}>{c}</option>)}
              </select>
            </div>
            <Input label="บาร์โค้ด" value={editingProduct.barcode||""} onChange={e=>setEditingProduct(p=>({...p,barcode:e.target.value}))}/>
          </div>
          {/* 🧱 ใช้เป็นวัตถุดิบ */}
          <div style={{marginTop:14,padding:"12px 14px",background:"#f1f5f9",border:`1px solid ${T.border}`,borderRadius:9}}>
            <div style={{fontSize:11,color:T.muted,fontWeight:600,marginBottom:6,textTransform:"uppercase",letterSpacing:"0.05em"}}>🧱 การใช้งานในการผลิต</div>
            <label style={{display:"flex",alignItems:"center",gap:8,fontSize:13,color:T.text,cursor:"pointer",padding:"4px 0"}}>
              <input type="checkbox" checked={!!editingProduct.usedAsMaterial} onChange={e=>setEditingProduct(p=>({...p,usedAsMaterial:e.target.checked}))}/>
              <span>🧱 ใช้รายการนี้เป็น "วัตถุดิบ" ในสูตร BOM</span>
            </label>
            {editingProduct.usedAsMaterial&&(
              <label style={{display:"flex",alignItems:"center",gap:8,fontSize:12,color:T.sub,cursor:"pointer",padding:"4px 0",marginLeft:24}}>
                <input type="checkbox" checked={!!editingProduct.isCostOnly} onChange={e=>setEditingProduct(p=>({...p,isCostOnly:e.target.checked}))}/>
                <span>💡 ต้นทุนเท่านั้น — คำนวณค่าใช้จ่ายแต่ไม่ตัดสต็อก (เช่น ค่าไฟ)</span>
              </label>
            )}
          </div>
          {editingProduct.costPrice&&editingProduct.salePrice&&Number(editingProduct.costPrice)>0&&(
            <div style={{marginTop:12,padding:"10px 14px",borderRadius:8,background:"rgba(52,211,153,0.08)",border:"1px solid rgba(52,211,153,0.2)"}}>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:12}}>
                <span style={{color:T.sub}}>กำไรต่อชิ้น</span>
                <span style={{fontFamily:"monospace",fontWeight:700,color:"#34d399"}}>฿{(Number(editingProduct.salePrice)-Number(editingProduct.costPrice)).toLocaleString("th-TH",{minimumFractionDigits:2})}</span>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:12,marginTop:4}}>
                <span style={{color:T.sub}}>% กำไร</span>
                <span style={{fontFamily:"monospace",fontWeight:700,color:"#34d399"}}>{(((Number(editingProduct.salePrice)-Number(editingProduct.costPrice))/Number(editingProduct.costPrice))*100).toFixed(1)}%</span>
              </div>
            </div>
          )}
          <div style={{display:"flex",gap:10,marginTop:20}}>
            <BtnGhost onClick={()=>setEditingProduct(null)} style={{flex:1}}>ยกเลิก</BtnGhost>
            <BtnPrimary onClick={handleSaveEditProduct} disabled={!editingProduct.code||!editingProduct.name||!editingProduct.unit} style={{flex:1}}>💾 บันทึกการแก้ไข</BtnPrimary>
          </div>
        </Modal>
      )}

      {/* ── MODAL: รับ/จ่าย ── */}
      {showTxModal&&(()=>{
        const validRows = txRows.filter(r => r.productId && Number(r.qty) > 0);
        const totalQty = validRows.reduce((s,r)=>s+Number(r.qty)||0,0);
        return (
        <Modal onClose={()=>setShowTxModal(false)} w={640}>
          <MHead title={txType==="รับ"?"⬇️ รับสินค้าเข้าคลัง":"⬆️ จ่ายสินค้าออกคลัง"} sub={`${txRows.length} แถว${validRows.length!==txRows.length?` (กรอกครบ ${validRows.length})`:""}`} onClose={()=>setShowTxModal(false)} color={txType==="รับ"?T.green:T.red}/>
          {txSuccess&&<Toast msg="บันทึกสำเร็จ!"/>}

          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
            <label style={{fontSize:11,color:T.sub,fontWeight:600}}>รายการสินค้า</label>
            <button onClick={()=>setShowTxScanner(true)} style={{padding:"4px 12px",borderRadius:6,border:"1px solid rgba(124,58,237,0.3)",background:"rgba(124,58,237,0.08)",color:"#7c3aed",cursor:"pointer",fontSize:11,fontWeight:600,fontFamily:"'Sarabun',sans-serif"}}>📸 สแกนเพิ่ม</button>
          </div>

          <div style={{maxHeight:340,overflowY:"auto",border:`1px solid ${T.border}`,borderRadius:10,marginBottom:10}}>
            {txRows.map((row,idx)=>{
              const prod = row.productId ? products.find(x=>x.id===row.productId) : null;
              const q = Number(row.qty)||0;
              const overflow = prod && txType==="จ่าย" && q > Number(prod.qty||0);
              return (
                <div key={idx} style={{display:"grid",gridTemplateColumns:"1fr 100px 32px",alignItems:"center",gap:6,padding:"8px 10px",borderBottom:idx<txRows.length-1?`1px solid ${T.border}`:"none"}}>
                  <div>
                    <select value={row.productId} onChange={e=>setTxRows(prev=>prev.map((r,i)=>i===idx?{...r,productId:e.target.value}:r))}
                      style={{width:"100%",background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:6,padding:"6px 10px",fontFamily:"'Sarabun',sans-serif",fontSize:12,outline:"none"}}>
                      <option value="">-- เลือกสินค้า --</option>
                      {products.map(p=><option key={p.id} value={p.id}>{p.code} — {p.name} (คงเหลือ {p.qty})</option>)}
                    </select>
                    {prod && (
                      <div style={{fontSize:10,color:overflow?T.red:T.muted,marginTop:3}}>
                        คงเหลือ {prod.qty} {prod.unit||""}
                        {q>0 && <span style={{marginLeft:6}}>→ <b style={{color:overflow?T.red:(txType==="รับ"?T.green:T.amber)}}>{txType==="รับ"?Number(prod.qty)+q:Math.max(0,Number(prod.qty)-q)}</b></span>}
                        {overflow && <span style={{marginLeft:6,fontWeight:700,color:T.red}}>⚠️ จ่ายเกิน!</span>}
                      </div>
                    )}
                  </div>
                  <input type="number" min="0" value={row.qty} placeholder="0"
                    onFocus={e=>e.target.select()}
                    onChange={e=>setTxRows(prev=>prev.map((r,i)=>i===idx?{...r,qty:e.target.value}:r))}
                    style={{background:T.input,border:`1px solid ${overflow?T.red:T.inputBorder}`,color:T.text,borderRadius:6,padding:"6px 10px",fontFamily:"monospace",fontSize:13,fontWeight:700,textAlign:"right",outline:"none"}}/>
                  {txRows.length>1
                    ? <button onClick={()=>setTxRows(prev=>prev.filter((_,i)=>i!==idx))} title="ลบแถว" style={{padding:"4px 6px",background:"#fef2f2",border:"1px solid #fecaca",borderRadius:5,color:T.red,fontSize:11,cursor:"pointer"}}>✕</button>
                    : <div/>}
                </div>
              );
            })}
            <button onClick={()=>setTxRows(prev=>[...prev,{productId:"",qty:""}])}
              style={{width:"100%",padding:"8px",background:"rgba(59,91,139,0.06)",border:"none",borderTop:`1px dashed ${T.border}`,color:T.accent,fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>+ เพิ่มแถว</button>
          </div>

          <div style={{marginBottom:10}}>
            <label style={{fontSize:11,color:T.muted,fontWeight:600,display:"block",marginBottom:4}}>หมายเหตุ (ใช้กับทุกแถว)</label>
            <input value={txNote} onChange={e=>setTxNote(e.target.value)} placeholder="ระบุหมายเหตุ (ถ้ามี)"
              style={{width:"100%",background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:8,padding:"8px 12px",fontFamily:"'Sarabun',sans-serif",fontSize:12,outline:"none"}}/>
          </div>

          {validRows.length>0 && (
            <div style={{padding:"8px 12px",background:txType==="รับ"?"rgba(22,163,74,0.06)":"rgba(220,38,38,0.06)",border:`1px solid ${txType==="รับ"?"rgba(22,163,74,0.25)":"rgba(220,38,38,0.25)"}`,borderRadius:8,marginBottom:12,fontSize:12,color:txType==="รับ"?"#15803d":"#991b1b",fontWeight:600}}>
              📊 จะ{txType}สต๊อก <b>{validRows.length} รายการ</b> · รวม <b style={{fontFamily:"monospace"}}>{totalQty.toLocaleString("th-TH")}</b> หน่วย
            </div>
          )}

          <div style={{display:"flex",gap:10}}>
            <BtnGhost onClick={()=>setShowTxModal(false)} disabled={txSaving} style={{flex:1}}>ยกเลิก</BtnGhost>
            {txType==="รับ"
              ? <BtnSuccess onClick={handleTx} disabled={txSaving||validRows.length===0} style={{flex:2}}>{txSaving?"⏳ กำลังบันทึก...":`✅ ยืนยันรับ ${validRows.length} รายการ`}</BtnSuccess>
              : <BtnDanger onClick={handleTx} disabled={txSaving||validRows.length===0} style={{flex:2}}>{txSaving?"⏳ กำลังบันทึก...":`✅ ยืนยันจ่าย ${validRows.length} รายการ`}</BtnDanger>
            }
          </div>
        </Modal>
        );
      })()}

      {/* ── MODAL: ประวัติ ── */}
      {showHistoryModal&&(
        <Modal onClose={()=>setShowHistoryModal(null)} w={620}>
          <MHead title="📅 ประวัติการแก้ไข" sub={`${showHistoryModal.name} · ${showHistoryModal.code}`} onClose={()=>setShowHistoryModal(null)} color={T.amber}/>
          {(!showHistoryModal.history||showHistoryModal.history.length===0)?(
            <div style={{textAlign:"center",padding:30,color:T.muted,fontSize:13}}>ยังไม่มีประวัติ</div>
          ):(
            showHistoryModal.history.map((h,i)=>(
              <div key={i} style={{display:"flex",gap:14,padding:"12px 0",borderBottom:i<showHistoryModal.history.length-1?`1px solid ${T.border}`:"none"}}>
                <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:0,paddingTop:4}}>
                  <div style={{width:10,height:10,borderRadius:"50%",background:T.blue,flexShrink:0}}/>
                  {i<showHistoryModal.history.length-1&&<div style={{width:2,flex:1,background:T.border,minHeight:20,marginTop:3}}/>}
                </div>
                <div style={{flex:1,paddingBottom:4}}>
                  <div style={{fontSize:13,fontWeight:600,color:T.text}}>{h.action}</div>
                  <div style={{fontSize:12,color:T.sub,marginTop:2}}>{h.note}</div>
                  <div style={{display:"flex",gap:14,marginTop:6}}>
                    <span style={{fontSize:11,color:T.muted}}>👤 {h.by}</span>
                    <span style={{fontSize:11,color:T.muted}}>🕐 {h.date}</span>
                  </div>
                </div>
              </div>
            ))
          )}
        </Modal>
      )}

      {/* ── MODAL: หมวดหมู่ ── */}
      {showCatModal&&(
        <Modal onClose={()=>setShowCatModal(false)} w={520}>
          <MHead title="📦 จัดการหมวดหมู่" onClose={()=>setShowCatModal(false)}/>
          <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:16,padding:12,background:"#f8fafc",borderRadius:10,border:`1px solid ${T.border}`,minHeight:48}}>
            {categories.map(c=>(
              <span key={c} style={{display:"inline-flex",alignItems:"center",gap:6,padding:"5px 12px",borderRadius:20,fontSize:12,fontWeight:500,background:"rgba(59,130,246,0.15)",color:"#93c5fd",border:"1px solid rgba(99,179,237,0.3)"}}>
                {c}
                {role.canManageCats&&<span onClick={async()=>{const newList=categories.filter(x=>x!==c);await setDoc(doc(db,"settings","categories"),{list:newList});if(selectedCat===c) setSelectedCat("ทั้งหมด");}} style={{cursor:"pointer",color:T.red,fontWeight:700,fontSize:14,lineHeight:1}}>×</span>}
              </span>
            ))}
            {categories.length===0&&<div style={{fontSize:12,color:T.muted}}>ยังไม่มีหมวดหมู่</div>}
          </div>
          {role.canManageCats&&(
            <div style={{display:"flex",gap:10,marginBottom:12}}>
              <input value={newCatName} onChange={e=>setNewCatName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleAddCat()} placeholder="ชื่อหมวดหมู่ใหม่..."
                style={{flex:1,background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:8,padding:"9px 12px",fontFamily:"'Sarabun',sans-serif",fontSize:13,outline:"none"}}/>
              <BtnPrimary onClick={handleAddCat} disabled={!newCatName.trim()}>+ เพิ่ม</BtnPrimary>
            </div>
          )}
          <div style={{fontSize:11,color:T.muted,marginBottom:16}}>💡 กด × เพื่อลบ · กด Enter หรือปุ่ม + เพื่อเพิ่ม</div>
          <BtnGhost onClick={()=>setShowCatModal(false)} style={{width:"100%"}}>ปิด</BtnGhost>
        </Modal>
      )}

      {/* ── MODAL: ดูรูป ── */}
      {showImgModal&&(
        <Modal onClose={()=>setShowImgModal(null)} w={520}>
          <MHead title={showImgModal.name} sub={showImgModal.code} onClose={()=>setShowImgModal(null)}/>

          {/* รูปสินค้า */}
          {showImgModal.image
            ?<img src={showImgModal.image} alt="" style={{width:"100%",maxHeight:300,objectFit:"contain",borderRadius:10,marginBottom:16,border:`1px solid ${T.border}`}}/>
            :<div style={{height:180,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",color:T.muted,marginBottom:16,background:"#13171f",borderRadius:10,border:`2px dashed ${T.inputBorder}`}}>
              <div style={{fontSize:48,marginBottom:8}}>📷</div>
              <div style={{fontSize:13}}>ยังไม่มีรูปสินค้า</div>
            </div>
          }

          {/* ปุ่มจัดการรูป */}
          <input ref={imgModalUploadRef} type="file" accept="image/*" style={{display:"none"}} onChange={async e=>{
            const file=e.target.files[0]; if(!file) return;
            try {
              const dataUrl = await compressImage(file, { maxDim: 1000, quality: 0.75 });
              const { url, path } = await uploadImage(dataUrl, "products");
              if (showImgModal.imagePath) deleteFile(showImgModal.imagePath);
              await updateDoc(doc(db,"products",showImgModal.id),{image:url,imagePath:path,lastUpdate:now()});
              setShowImgModal(p=>({...p,image:url,imagePath:path}));
            } catch (err) {
              alert("อัปโหลดรูปไม่สำเร็จ: " + (err?.message || err));
            } finally {
              e.target.value="";
            }
          }}/>

          <div style={{display:"flex",gap:10,marginBottom:10}}>
            <button onClick={()=>imgModalUploadRef.current?.click()} style={{flex:1,padding:"9px",borderRadius:8,border:`1px solid ${T.blue}`,background:"#eff6ff",color:T.blue,fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"'Sarabun',sans-serif"}}>
              📁 {showImgModal.image?"เปลี่ยนรูป":"อัปโหลดรูป"}
            </button>
            {showImgModal.image&&(
              <button onClick={async()=>{
                await updateDoc(doc(db,"products",showImgModal.id),{image:"",lastUpdate:now()});
                setShowImgModal(p=>({...p,image:""}));
              }} style={{flex:1,padding:"9px",borderRadius:8,border:"1px solid #fecaca",background:"#fef2f2",color:T.red,fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"'Sarabun',sans-serif"}}>
                🗑️ ลบรูป
              </button>
            )}
          </div>

          <BtnGhost onClick={()=>setShowImgModal(null)} style={{width:"100%"}}>ปิด</BtnGhost>
        </Modal>
      )}

      {/* ── MODAL: บาร์โค้ด ── */}
      {showBarcodeModal&&(
        <Modal onClose={()=>setShowBarcodeModal(null)} w={540}>
          <MHead title="▦ บาร์โค้ดสินค้า" sub={showBarcodeModal.name} onClose={()=>setShowBarcodeModal(null)}/>
          <div style={{display:"flex",justifyContent:"center",marginBottom:16}}><BarcodeDisplay value={showBarcodeModal.barcode}/></div>
          <div style={{fontSize:12,color:T.sub,textAlign:"center",marginBottom:16}}>รหัส: {showBarcodeModal.code} · หมวด: {showBarcodeModal.category}</div>
          <BtnGhost onClick={()=>setShowBarcodeModal(null)} style={{width:"100%"}}>ปิด</BtnGhost>
        </Modal>
      )}

      {/* ── MODAL: ยืนยันลบ ── */}
      {showDeleteConfirm&&(()=>{
        const p = products.find(x=>x.id===showDeleteConfirm);
        const pname = (p?.name||"").trim();
        const pqty = Number(p?.qty)||0;
        const hasStock = pqty > 0;
        const matched = !hasStock || deleteConfirmText.trim() === pname; // มีสต็อก → ต้องพิมพ์ชื่อ
        return (
        <Modal onClose={()=>{setShowDeleteConfirm(null);setDeleteConfirmText("");}} w={440}>
          <div style={{textAlign:"center",marginBottom:6}}>
            <div style={{fontSize:42,marginBottom:8}}>🗑️</div>
            <div style={{fontSize:16,fontWeight:800,color:T.text}}>ลบสินค้า "{p?.name||""}"?</div>
          </div>
          <div style={{padding:"10px 12px",background:hasStock?"#fef2f2":"#fffbeb",border:`1px solid ${hasStock?"#fecaca":"#fde68a"}`,borderRadius:9,marginBottom:14,fontSize:13,color:hasStock?"#991b1b":"#92400e",lineHeight:1.6}}>
            {hasStock
              ? <>⚠️ สินค้านี้ยัง<b>มีสต็อก {pqty.toLocaleString("th-TH")} {p?.unit||"ชิ้น"}</b><br/>ลบแล้วประวัติทั้งหมดหายถาวร — ย้อนคืนไม่ได้</>
              : <>สินค้านี้ไม่มีสต็อกแล้ว — ลบแล้วประวัติหายถาวร ย้อนคืนไม่ได้</>}
          </div>
          {hasStock && (
            <>
              <label style={{fontSize:12,color:T.sub,display:"block",marginBottom:6}}>พิมพ์ชื่อสินค้า <b style={{color:T.text}}>{pname}</b> เพื่อยืนยัน:</label>
              <input value={deleteConfirmText} onChange={e=>setDeleteConfirmText(e.target.value)} placeholder={pname} autoFocus
                style={{width:"100%",boxSizing:"border-box",background:T.input,border:`1px solid ${matched?"#16a34a":T.inputBorder}`,color:T.text,borderRadius:9,padding:"10px 14px",fontFamily:"'Sarabun',sans-serif",fontSize:14,outline:"none",marginBottom:16}}/>
            </>
          )}
          <div style={{display:"flex",gap:10}}>
            <BtnGhost onClick={()=>{setShowDeleteConfirm(null);setDeleteConfirmText("");}} style={{flex:1}}>ยกเลิก</BtnGhost>
            <BtnDanger onClick={()=>{handleDelete(showDeleteConfirm);setDeleteConfirmText("");}} disabled={!matched} style={{flex:1,opacity:matched?1:0.45,cursor:matched?"pointer":"not-allowed"}}>🗑 ลบสินค้า</BtnDanger>
          </div>
        </Modal>
        );
      })()}

      {/* ── MODAL: ยืนยันลบรุ่นเสื้อผ้า/รองเท้า — พิมพ์ชื่อรุ่นเพื่อยืนยัน (กันลบพลาด) ── */}
      {deleteClothingTarget && (
        <DeleteClothingConfirm
          target={deleteClothingTarget}
          deleteConfirmText={deleteConfirmText}
          setDeleteConfirmText={setDeleteConfirmText}
          onClose={() => setDeleteClothingTarget(null)}
          handleDeleteClothingItem={handleDeleteClothingItem}
        />
      )}

      {/* ── 📐 MODAL: ตั้งสูตร BOM (วัตถุดิบต่อรุ่น) ── */}
      {bomModal&&(()=>{
        const { clothingItem, variants, activeVariantIdx, sizes, saving } = bomModal;
        const v = variants[activeVariantIdx];
        const materialProducts = products.filter(p => p.usedAsMaterial).sort((a,b)=>(a.name||"").localeCompare(b.name||""));
        const sizeCount = (sizes||[]).length;
        return (
        <Modal onClose={()=>setBomModal(null)} w={Math.max(720, 380 + sizeCount*68)}>
          <MHead title={`📐 สูตรวัตถุดิบ — ${clothingItem.model}`} sub={`${v.materials.length} วัตถุดิบ · ${variants.length} variant`} onClose={()=>setBomModal(null)} color="#7c3aed"/>

          {/* Variant tabs */}
          <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:14,padding:"6px",background:"#f1f5f9",borderRadius:9,flexWrap:"wrap"}}>
            {variants.map((vv,i)=>(
              <div key={i} style={{display:"flex",alignItems:"center"}}>
                <button onClick={()=>updateBom(b=>{b.activeVariantIdx=i;return b;})} style={{padding:"6px 14px",borderRadius:7,border:"none",background:i===activeVariantIdx?"linear-gradient(135deg,#7c3aed,#7c3aed)":"transparent",color:i===activeVariantIdx?"white":T.sub,fontSize:12,fontWeight:i===activeVariantIdx?700:500,cursor:"pointer",fontFamily:"inherit"}}>{vv.name} <span style={{opacity:0.7,fontSize:10}}>({(vv.materials||[]).length})</span></button>
                {i===activeVariantIdx&&<>
                  <button onClick={()=>renameBomVariant(i)} title="เปลี่ยนชื่อ" style={{padding:"4px 6px",border:"none",background:"transparent",color:"white",cursor:"pointer",fontSize:10,opacity:0.85,marginLeft:-4,position:"relative",top:0}}>✏️</button>
                  {variants.length>1&&<button onClick={()=>removeBomVariant(i)} title="ลบ variant นี้" style={{padding:"4px 6px",border:"none",background:"transparent",color:"white",cursor:"pointer",fontSize:10,opacity:0.85}}>✕</button>}
                </>}
              </div>
            ))}
            <button onClick={addBomVariant} style={{padding:"6px 12px",borderRadius:7,border:`1px dashed ${T.border}`,background:"white",color:T.sub,fontSize:11,cursor:"pointer",fontFamily:"inherit"}}>＋ variant</button>
          </div>

          {/* Materials table */}
          {sizeCount===0&&<div style={{padding:"10px 12px",background:"#fef3c7",border:"1px solid #fde68a",borderRadius:8,fontSize:12,color:"#92400e",marginBottom:10}}>⚠️ รุ่นนี้ยังไม่มีไซส์ — ไปเพิ่มสีก่อนเพื่อกำหนดไซส์</div>}
          <div style={{border:`1px solid ${T.border}`,borderRadius:9,overflow:"auto",maxHeight:"50vh"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
              <thead style={{position:"sticky",top:0,background:"#f8fafc",zIndex:2}}>
                <tr>
                  <th style={{padding:"8px 10px",textAlign:"left",fontWeight:700,color:T.sub,borderBottom:`1px solid ${T.border}`,minWidth:180}}>วัตถุดิบ</th>
                  <th style={{padding:"8px 6px",textAlign:"center",fontWeight:700,color:T.sub,borderBottom:`1px solid ${T.border}`,width:90}}>หน่วย</th>
                  <th style={{padding:"8px 6px",textAlign:"center",fontWeight:700,color:T.sub,borderBottom:`1px solid ${T.border}`,width:90}}>ใช้ทุกไซส์เท่ากัน?</th>
                  {(sizes||[]).map(s=>(
                    <th key={s} style={{padding:"8px 4px",textAlign:"center",fontWeight:700,color:T.accent,borderBottom:`1px solid ${T.border}`,minWidth:56,fontFamily:"monospace"}}>{s}</th>
                  ))}
                  <th style={{padding:"8px 6px",borderBottom:`1px solid ${T.border}`,width:36}}></th>
                </tr>
              </thead>
              <tbody>
                {v.materials.length===0?(
                  <tr><td colSpan={3+sizeCount+1} style={{padding:"30px 20px",textAlign:"center",color:T.muted,fontSize:12}}>— ยังไม่มีวัตถุดิบ — กด "＋ เพิ่มวัตถุดิบ" ด้านล่าง —</td></tr>
                ):v.materials.map((m,mi)=>(
                  <tr key={mi} style={{borderBottom:`1px solid ${T.border}`,background:m.isCostOnly?"#fffbeb":"transparent"}}>
                    <td style={{padding:"8px 10px"}}>
                      <div style={{fontWeight:600,color:T.text,fontSize:12}}>{m.productName}</div>
                      {m.isCostOnly&&<div style={{fontSize:9,color:"#92400e",marginTop:2}}>💡 ต้นทุนเท่านั้น</div>}
                    </td>
                    <td style={{padding:"8px 6px",textAlign:"center",color:T.sub,fontSize:11}}>{m.unit}</td>
                    <td style={{padding:"8px 6px",textAlign:"center"}}>
                      <input type="checkbox" checked={m.mode==="flat"} onChange={e=>setBomMaterialField(mi,"mode",e.target.checked?"flat":"perSize")}/>
                    </td>
                    {m.mode==="flat"?(
                      <td colSpan={sizeCount} style={{padding:"6px 8px",textAlign:"center",background:"rgba(124,58,237,0.04)"}}>
                        <input type="number" step="0.001" value={m.flat} onChange={e=>setBomMaterialField(mi,"flat",e.target.value)} placeholder="0" style={{width:120,padding:"5px 8px",border:`1px solid ${T.inputBorder}`,borderRadius:6,fontSize:13,fontFamily:"monospace",textAlign:"center",outline:"none",fontWeight:700}}/>
                        <span style={{marginLeft:6,fontSize:11,color:T.sub}}>{m.unit}/ตัว · ทุกไซส์</span>
                      </td>
                    ):(sizes||[]).map((s,si)=>(
                      <td key={s} style={{padding:"4px 3px",textAlign:"center"}}>
                        <input type="number" step="0.001" value={m.perSize?.[s]??""} onChange={e=>setBomMaterialSizeQty(mi,s,e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&si===0&&Number(m.perSize?.[s])>0){if(window.confirm(`เติม ${m.perSize[s]} ลงทุกไซส์?`))fillBomRow(mi,m.perSize[s]);}}} placeholder="0" style={{width:54,padding:"5px 4px",border:`1px solid ${T.inputBorder}`,borderRadius:5,fontSize:12,fontFamily:"monospace",textAlign:"center",outline:"none"}}/>
                      </td>
                    ))}
                    <td style={{padding:"4px 6px",textAlign:"center"}}>
                      <button onClick={()=>removeBomMaterial(mi)} title="ลบ" style={{width:24,height:24,padding:0,border:"none",background:"transparent",color:"#dc2626",cursor:"pointer",fontSize:14}}>✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Add material */}
          <div style={{marginTop:10,position:"relative"}}>
            <button onClick={()=>setBomMaterialPickerOpen(o=>!o)} disabled={sizeCount===0} style={{padding:"8px 14px",borderRadius:8,border:`1px dashed ${T.border}`,background:"white",color:T.accent,cursor:sizeCount===0?"not-allowed":"pointer",fontSize:12,fontWeight:600,fontFamily:"inherit",opacity:sizeCount===0?0.4:1}}>＋ เพิ่มวัตถุดิบ</button>
            {bomMaterialPickerOpen&&(
              <div style={{position:"absolute",top:"100%",left:0,marginTop:4,background:"white",border:`1px solid ${T.border}`,borderRadius:9,boxShadow:"0 12px 32px rgba(0,0,0,0.15)",zIndex:10,minWidth:340,maxHeight:280,overflowY:"auto"}}>
                {materialProducts.length===0?(
                  <div style={{padding:"20px",textAlign:"center",fontSize:12,color:T.muted}}>
                    ยังไม่มีสินค้าที่ติ๊ก "🧱 ใช้เป็นวัตถุดิบ"<br/>
                    <span style={{fontSize:10}}>ไปแก้สินค้าทั่วไป → ติ๊กช่อง 🧱</span>
                  </div>
                ):materialProducts.map(p=>{
                  const used = v.materials.some(m=>m.productId===p.id);
                  return (
                    <div key={p.id} onClick={()=>!used&&addBomMaterial(p)} style={{padding:"8px 12px",borderBottom:`1px solid ${T.border}`,cursor:used?"not-allowed":"pointer",opacity:used?0.4:1,fontSize:12}}
                      onMouseEnter={e=>{if(!used)e.currentTarget.style.background="#f1f5f9";}}
                      onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                        <span style={{fontWeight:600,color:T.text}}>{p.name}{p.isCostOnly&&<span style={{marginLeft:6,fontSize:9,padding:"1px 5px",background:"#fef3c7",color:"#92400e",borderRadius:6}}>ต้นทุน</span>}</span>
                        <span style={{fontSize:10,color:T.sub,fontFamily:"monospace"}}>{p.unit} · ฿{Number(p.costPrice||0).toLocaleString("th-TH",{minimumFractionDigits:2})}</span>
                      </div>
                      {used&&<div style={{fontSize:9,color:T.muted,marginTop:2}}>มีในสูตรแล้ว</div>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div style={{marginTop:12,padding:"8px 12px",background:"#eff6ff",border:"1px solid #bfdbfe",borderRadius:8,fontSize:11,color:"#1e40af",lineHeight:1.6}}>
            💡 <b>ใช้ทุกไซส์เท่ากัน?</b> ติ๊กเพื่อกรอกค่าเดียว (เช่น ป้าย, ถุง = 1 ชุด/ตัว)<br/>
            💡 <b>กด Enter</b> ที่ช่องไซส์แรกเพื่อเติมค่านั้นลงทุกไซส์
          </div>

          <div style={{display:"flex",gap:10,marginTop:16}}>
            <BtnGhost onClick={()=>setBomModal(null)} style={{flex:1}} disabled={saving}>ยกเลิก</BtnGhost>
            <BtnPrimary onClick={saveBom} disabled={saving} style={{flex:1}}>{saving?"⏳ กำลังบันทึก...":"💾 บันทึกสูตร"}</BtnPrimary>
          </div>
        </Modal>
        );
      })()}

      {/* ── MODAL: ล้างคลัง ── */}
      {showClearConfirm&&(
        <Modal onClose={()=>setShowClearConfirm(false)} w={540}>
          <div style={{textAlign:"center"}}>
            <div style={{fontSize:42,marginBottom:12}}>⚠️</div>
            <div style={{fontSize:15,fontWeight:700,color:T.red,marginBottom:8}}>ล้างคลังสินค้าทั้งหมด?</div>
            <div style={{fontSize:13,color:T.sub,marginBottom:8}}>สินค้าและประวัติทั้งหมดจะถูกลบออก</div>
            <div style={{fontSize:12,color:T.red,marginBottom:24,padding:"10px",background:"#fef2f2",borderRadius:8}}>⚠️ ไม่สามารถย้อนกลับได้!</div>
            <div style={{display:"flex",gap:10}}><BtnGhost onClick={()=>setShowClearConfirm(false)} style={{flex:1}}>ยกเลิก</BtnGhost><BtnDanger onClick={handleClear} style={{flex:1}}>ล้างคลังทั้งหมด</BtnDanger></div>
          </div>
        </Modal>
      )}

      {/* 📝 Edit Customer Modal */}
      {editingCustomer&&(
        <Modal onClose={()=>setEditingCustomer(null)} w={500}>
          <MHead title={`✏️ แก้ไขลูกค้า — ${editingCustomer.name}`} onClose={()=>setEditingCustomer(null)}/>
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            <div>
              <label style={{fontSize:11,color:T.muted,fontWeight:600,display:"block",marginBottom:4}}>ชื่อ / ร้านค้า *</label>
              <input value={editingCustomer.name||""} onChange={e=>setEditingCustomer(c=>({...c,name:e.target.value}))}
                style={{width:"100%",padding:"9px 12px",border:`1px solid ${T.inputBorder}`,borderRadius:8,fontSize:13,fontFamily:"inherit",boxSizing:"border-box"}}/>
            </div>
            <div>
              <label style={{fontSize:11,color:T.muted,fontWeight:600,display:"block",marginBottom:4}}>เบอร์โทร</label>
              <input value={editingCustomer.phone||""} onChange={e=>setEditingCustomer(c=>({...c,phone:e.target.value}))}
                style={{width:"100%",padding:"9px 12px",border:`1px solid ${T.inputBorder}`,borderRadius:8,fontSize:13,fontFamily:"inherit",boxSizing:"border-box"}}/>
            </div>
            <div>
              <label style={{fontSize:11,color:T.muted,fontWeight:600,display:"block",marginBottom:4}}>ที่อยู่</label>
              <textarea value={editingCustomer.address||""} onChange={e=>setEditingCustomer(c=>({...c,address:e.target.value}))} rows={3}
                placeholder="บ้านเลขที่ ซอย ถนน ตำบล อำเภอ จังหวัด รหัสไปรษณีย์"
                style={{width:"100%",padding:"9px 12px",border:`1px solid ${T.inputBorder}`,borderRadius:8,fontSize:13,fontFamily:"inherit",boxSizing:"border-box",resize:"vertical"}}/>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              <div>
                <label style={{fontSize:11,color:T.muted,fontWeight:600,display:"block",marginBottom:4}}>เลขผู้เสียภาษี (ถ้ามี)</label>
                <input value={editingCustomer.taxId||""} onChange={e=>setEditingCustomer(c=>({...c,taxId:e.target.value}))}
                  style={{width:"100%",padding:"9px 12px",border:`1px solid ${T.inputBorder}`,borderRadius:8,fontSize:13,fontFamily:"monospace",boxSizing:"border-box"}}/>
              </div>
              <div>
                <label style={{fontSize:11,color:T.muted,fontWeight:600,display:"block",marginBottom:4}}>Email</label>
                <input value={editingCustomer.email||""} onChange={e=>setEditingCustomer(c=>({...c,email:e.target.value}))}
                  style={{width:"100%",padding:"9px 12px",border:`1px solid ${T.inputBorder}`,borderRadius:8,fontSize:13,fontFamily:"inherit",boxSizing:"border-box"}}/>
              </div>
            </div>
            {/* 💳 ประเภทลูกค้า — ใช้คัดว่าใครต้องวางบิลสิ้นเดือน */}
            <div>
              <label style={{fontSize:11,color:T.muted,fontWeight:600,display:"block",marginBottom:5}}>ประเภทลูกค้า</label>
              <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                {[
                  {k:"credit", icon:"📄", label:"เครดิต — วางบิลสิ้นเดือน", color:T.accent},
                  {k:"cash",   icon:"💵", label:"เงินสด — จ่ายทันที",       color:T.green},
                ].map(o=>{
                  const cur = editingCustomer.billingType || "credit"; // ไม่เคยตั้ง = เครดิต (พฤติกรรมเดิม)
                  const on = cur === o.k;
                  return (
                    <button key={o.k} onClick={()=>setEditingCustomer(c=>({...c,billingType:o.k}))}
                      style={{flex:"1 1 180px",padding:"9px 12px",borderRadius:9,cursor:"pointer",fontFamily:"inherit",fontSize:12,textAlign:"left",
                        border:`1px solid ${on?o.color:T.inputBorder}`,background:on?`${o.color}14`:"white",color:on?o.color:T.sub,fontWeight:on?700:500}}>
                      {o.icon} {o.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <label style={{fontSize:11,color:T.muted,fontWeight:600,display:"block",marginBottom:4}}>หมายเหตุ</label>
              <input value={editingCustomer.note||""} onChange={e=>setEditingCustomer(c=>({...c,note:e.target.value}))}
                placeholder="ลูกค้า VIP / เครดิต 30 วัน / ฯลฯ"
                style={{width:"100%",padding:"9px 12px",border:`1px solid ${T.inputBorder}`,borderRadius:8,fontSize:13,fontFamily:"inherit",boxSizing:"border-box"}}/>
            </div>
          </div>
          <div style={{display:"flex",gap:10,marginTop:18}}>
            <BtnGhost onClick={()=>setEditingCustomer(null)} style={{flex:1}}>ยกเลิก</BtnGhost>
            <BtnPrimary onClick={async()=>{
              if (!editingCustomer.name?.trim()) { alert("กรุณากรอกชื่อ"); return; }
              try {
                const before = customers.find(x=>x.id===editingCustomer.id) || {};
                // detect region/province ใหม่ถ้าที่อยู่เปลี่ยน
                const updated = {
                  name: editingCustomer.name.trim(),
                  phone: (editingCustomer.phone||"").trim(),
                  address: (editingCustomer.address||"").trim(),
                  taxId: (editingCustomer.taxId||"").trim(),
                  email: (editingCustomer.email||"").trim(),
                  billingType: editingCustomer.billingType || "credit",
                  note: (editingCustomer.note||"").trim(),
                  region: detectRegion(editingCustomer.address||""),
                  province: detectProvince(editingCustomer.address||"") || "",
                };
                await updateDoc(doc(db,"customers",editingCustomer.id), withCustomerSearchKeys(updated));
                logAudit(user,{action:AUDIT_ACTIONS.UPDATE,collection:"customers",targetId:editingCustomer.id,targetLabel:updated.name,
                  before:{name:before.name,phone:before.phone,address:before.address},
                  after:{name:updated.name,phone:updated.phone,address:updated.address}});
                setEditingCustomer(null);
              } catch (e) { alert("บันทึกไม่สำเร็จ: " + e.message); }
            }} style={{flex:2}} disabled={!editingCustomer.name?.trim()}>💾 บันทึก</BtnPrimary>
          </div>
        </Modal>
      )}

      {profileCustomer&&(
        <CustomerProfile
          customer={profileCustomer}
          invoices={invoices}
          orders={orders}
          onClose={()=>setProfileCustomer(null)}
          onNewInvoice={(c)=>{
            setInvoiceForm(f=>({...f,customerId:c.id||"",customerName:c.name||"",customerPhone:c.phone||"",customerAddress:c.address||"",customerTaxId:c.taxId||""}));
            setShowNewInvoice(true);
          }}
        />
      )}

      {/* ── MODAL: รับคืนสินค้า ── */}
      {showReturnModal&&(
        <ReturnModal
          existing={editingReturn}
          customers={customers}
          clothingItems={clothingItems}
          invoices={invoices}
          user={user}
          onSave={handleSaveReturn}
          onClose={()=>{setShowReturnModal(false);setEditingReturn(null);}}
        />
      )}

      {/* 🧾↩️ ใบลดหนี้ — เอกสารแยกใบ อ้างถึงบิลต้นทาง (ไม่แก้ยอดบิลเดิม) */}
      {creditNote && (
        <Suspense fallback={null}>
          <PrintCreditNoteModal
            ret={creditNote}
            invoice={invoices.find(i => i.id === creditNote.invoiceId) || null}
            companyInfo={companyInfo}
            printElementById={printElementById}
            onClose={() => setCreditNote(null)}
          />
        </Suspense>
      )}

      {/* ── MODAL: Settings ── */}
      {showSettings&&(
        <Modal onClose={()=>setShowSettings(false)} w={640}>
          <MHead title="⚙️ ตั้งค่าระบบ" onClose={()=>setShowSettings(false)}/>
          {/* Settings tabs */}
          <div style={{display:"flex",gap:4,marginBottom:20,borderBottom:`1px solid ${T.border}`,paddingBottom:12}}>
            {[{id:"profile",label:"👤 โปรไฟล์"},...(user.role==="admin"?[{id:"system",label:"🏢 ระบบ 🔒"},{id:"backup",label:"💾 Backup"},{id:"storage",label:"🧹 ล้างพื้นที่"}]:[]),{id:"install",label:"📱 ติดตั้งแอป"},{id:"about",label:"ℹ️ เกี่ยวกับ"}].map(t=>(
              <button key={t.id} onClick={()=>{ if(t.id==="system" && user.role==="admin" && Date.now()>=pwSessionExp){ requireAuth(()=>setSettingsTab("system"),"ใส่รหัสแอดมินเพื่อเข้า “ตั้งค่าระบบ”"); } else setSettingsTab(t.id); }} style={{padding:"7px 16px",borderRadius:8,border:settingsTab===t.id?`1px solid ${T.navActiveBorder}`:`1px solid transparent`,background:settingsTab===t.id?"rgba(59,91,139,0.15)":"transparent",color:settingsTab===t.id?"#3b5b8b":T.sub,cursor:"pointer",fontSize:13,fontFamily:"'Sarabun',sans-serif",fontWeight:settingsTab===t.id?600:400}}>{t.label}</button>
            ))}
          </div>

          {settingsTab==="profile"&&(
            <div>
              <div style={{fontSize:13,fontWeight:600,color:T.text,marginBottom:14}}>ข้อมูลส่วนตัว</div>
              {profileMsg.text&&(
                profileMsg.type==="ok"
                  ?<Toast msg={profileMsg.text}/>
                  :<div style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:8,padding:"10px 14px",color:T.red,fontSize:13,marginBottom:14}}>⚠️ {profileMsg.text}</div>
              )}
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:20}}>
                <Input label="ชื่อ-นามสกุล" value={profileForm.name} onChange={e=>setProfileForm(f=>({...f,name:e.target.value}))} placeholder="ชื่อ-นามสกุล"/>
                <Input label="ชื่อผู้ใช้ (username)" value={profileForm.username} onChange={e=>setProfileForm(f=>({...f,username:e.target.value}))} placeholder="username"/>
              </div>
              <div style={{fontSize:13,fontWeight:600,color:T.text,marginBottom:14,paddingTop:14,borderTop:`1px solid ${T.border}`}}>เปลี่ยนรหัสผ่าน <span style={{fontSize:11,color:T.muted,fontWeight:400}}>(เว้นว่างถ้าไม่ต้องการเปลี่ยน)</span></div>
              <div style={{display:"flex",flexDirection:"column",gap:12,marginBottom:20}}>
                <Input label="รหัสผ่านเดิม" type="password" placeholder="รหัสผ่านปัจจุบัน" value={profileForm.oldPass} onChange={e=>setProfileForm(f=>({...f,oldPass:e.target.value}))}/>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
                  <Input label="รหัสผ่านใหม่" type="password" placeholder="อย่างน้อย 4 ตัว" value={profileForm.newPass} onChange={e=>setProfileForm(f=>({...f,newPass:e.target.value}))}/>
                  <Input label="ยืนยันรหัสผ่านใหม่" type="password" placeholder="พิมพ์ซ้ำ" value={profileForm.confirmPass} onChange={e=>setProfileForm(f=>({...f,confirmPass:e.target.value}))}/>
                </div>
              </div>
              <div style={{display:"flex",gap:10}}>
                <BtnGhost onClick={()=>setShowSettings(false)} style={{flex:1}}>ยกเลิก</BtnGhost>
                <BtnPrimary onClick={handleSaveProfile} style={{flex:1}}>💾 บันทึกการเปลี่ยนแปลง</BtnPrimary>
              </div>
            </div>
          )}

          {settingsTab==="system"&&user.role==="admin"&&(
            <div>
              {/* Company Info */}
              <div style={{fontSize:13,fontWeight:600,color:T.text,marginBottom:14}}>🏢 ข้อมูลบริษัท / ร้านค้า</div>
              <CompanyEditor companyInfo={companyInfo} onSave={async(data)=>{setCompanyInfo(data);await handleSaveCompany(data);}}/>
              <div style={{height:1,background:T.border,margin:"20px 0"}}/>
              <div style={{fontSize:13,fontWeight:600,color:T.text,marginBottom:14}}>📊 สถิติระบบ</div>
              {[
                {label:"สินค้าในคลัง",value:`${products.length} รายการ`,icon:"📦"},
                {label:"สินค้าต่ำกว่าขั้นต่ำ",value:`${lowStock.length} รายการ`,icon:"⚠️"},
                {label:"รายการเคลื่อนไหว",value:`${transactions.length} รายการ`,icon:"🔄"},
                {label:"หมวดหมู่",value:`${categories.length} หมวดหมู่`,icon:"🏷️"},
                {label:"ผู้ใช้งาน",value:`${users.length} บัญชี`,icon:"👥"},
              ].map((r,i)=>(
                <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"11px 0",borderBottom:i<4?`1px solid ${T.border}`:"none"}}>
                  <span style={{fontSize:13,color:T.sub}}>{r.icon} {r.label}</span>
                  <span style={{fontSize:13,fontWeight:700,color:T.text}}>{r.value}</span>
                </div>
              ))}
              <div style={{marginTop:16,padding:12,background:"rgba(59,91,139,0.08)",border:"1px solid rgba(59,91,139,0.2)",borderRadius:10,fontSize:12,color:"#3b5b8b"}}>
                💡 จัดการผู้ใช้งานได้ที่เมนู <b>👥 จัดการผู้ใช้</b> ในแถบเมนูซ้าย
              </div>
              {role.canClear&&(
                <div style={{marginTop:16,padding:16,background:"#fef2f2",border:"1px solid #fecaca",borderRadius:10}}>
                  <div style={{fontSize:13,fontWeight:600,color:T.red,marginBottom:4}}>⚠️ โซนอันตราย</div>
                  <div style={{fontSize:12,color:T.sub,marginBottom:12}}>การล้างข้อมูลไม่สามารถย้อนกลับได้</div>
                  <BtnDanger onClick={()=>{setShowSettings(false);setShowClearConfirm(true);}}>🗑 ล้างคลังสินค้าทั้งหมด</BtnDanger>
                </div>
              )}
            </div>
          )}

          {settingsTab==="backup"&&user.role==="admin"&&(
            <BackupRestore
              projectId={(typeof process !== "undefined" && process.env && process.env.REACT_APP_FB_PROJECT_ID) || "cpu-erp"}
              user={user}
              role={role}
            />
          )}

          {settingsTab==="storage"&&user.role==="admin"&&(
            <StorageCleanup user={user}/>
          )}

          {settingsTab==="install"&&(
            <InstallPWA/>
          )}

          {settingsTab==="about"&&(
            <div style={{textAlign:"center",padding:"10px 0"}}>
              <div style={{width:64,height:64,background:"linear-gradient(135deg,#3b5b8b,#3b5b8b)",borderRadius:16,display:"flex",alignItems:"center",justifyContent:"center",fontSize:30,margin:"0 auto 16px",boxShadow:"0 8px 32px rgba(59,91,139,0.4)"}}>⚙️</div>
              <div style={{fontSize:22,fontWeight:800,color:T.text,fontFamily:"'Space Mono',monospace",letterSpacing:3,marginBottom:4}}>CPU ERP</div>
              <div style={{fontSize:12,color:T.muted,marginBottom:20}}>ระบบบริหารคลังสินค้า</div>
              {[{label:"Version",value:"1.0.0"},{label:"โมดูล",value:"คลังสินค้า"},{label:"สถานะ",value:"🟢 Prototype"},{label:"พัฒนาโดย",value:"Claude + CPU Team"}].map((r,i)=>(
                <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"10px 0",borderBottom:i<3?`1px solid ${T.border}`:"none",textAlign:"left"}}>
                  <span style={{fontSize:13,color:T.sub}}>{r.label}</span>
                  <span style={{fontSize:13,fontWeight:600,color:T.text}}>{r.value}</span>
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}

      {/* ── MODAL: สร้างใบสั่งของ ── */}
      {showNewOrder && (
        <NewOrderModal
          onClose={() => { setShowNewOrder(false); setEditingOrderId(null); clearOrderDraft(); }}
          editingOrderId={editingOrderId}
          orderForm={orderForm}
          setOrderForm={setOrderForm}
          orderItemForm={orderItemForm}
          setOrderItemForm={setOrderItemForm}
          orderMixForm={orderMixForm}
          setOrderMixForm={setOrderMixForm}
          orderMixExpanded={orderMixExpanded}
          setOrderMixExpanded={setOrderMixExpanded}
          orderFreeExpanded={orderFreeExpanded}
          setOrderFreeExpanded={setOrderFreeExpanded}
          freeItemForm={freeItemForm}
          setFreeItemForm={setFreeItemForm}
          freeItemCutStock={freeItemCutStock}
          setFreeItemCutStock={setFreeItemCutStock}
          customerSearch={customerSearch}
          setCustomerSearch={setCustomerSearch}
          customers={customers}
          clothingItems={clothingItems}
          handleSelectCustomer={handleSelectCustomer}
          handleConfirmOrder={handleConfirmOrder}
          addOrderMixItem={addOrderMixItem}
        />
      )}

      {/* ⏳ กำลังแปลงเป็นชุด — กันปิดหน้าจอกลางคัน */}
      {bulkConverting && (
        <div style={{ position:"fixed", inset:0, background:"rgba(15,23,42,.6)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:9999 }}>
          <div style={{ background:"white", borderRadius:14, padding:"26px 34px", textAlign:"center", minWidth:280 }}>
            <div style={{ fontSize:34, marginBottom:8 }}>⏳</div>
            <div style={{ fontSize:15, fontWeight:800, color:T.text }}>กำลังแปลงเป็นใบสั่งของ...</div>
            <div style={{ fontSize:22, fontWeight:800, color:T.accent, fontFamily:"monospace", margin:"10px 0" }}>
              {bulkConverting.done} / {bulkConverting.total}
            </div>
            <div style={{ height:6, background:"#f1f5f9", borderRadius:3, overflow:"hidden" }}>
              <div style={{ width:`${Math.round((bulkConverting.done/Math.max(1,bulkConverting.total))*100)}%`, height:"100%", background:T.accent, transition:"width .2s" }}/>
            </div>
            <div style={{ fontSize:11, color:T.muted, marginTop:10 }}>ห้ามปิดหน้าจอจนกว่าจะเสร็จ</div>
          </div>
        </div>
      )}

      {/* ── MODAL: หน้าร้าน (แบรนด์ / รายละเอียด / ไซส์ที่ขาย) ── */}
      {productCatalogItem && (
        <Suspense fallback={null}>
          <ProductCatalogModal item={productCatalogItem} allItems={clothingItems} user={user} onClose={() => setProductCatalogItem(null)}/>
        </Suspense>
      )}

      {/* ── MODAL: ลิงก์ + QR สั่งของสำหรับลูกค้า ── */}
      {showShareCatalog && (
        <Suspense fallback={null}>
          <ShareCatalogModal companyInfo={companyInfo} onClose={() => setShowShareCatalog(false)}/>
        </Suspense>
      )}

      {/* ── MODAL: นำเข้าลูกค้าจาก Excel ── */}
      {showImportCustomers && (
        <ImportCustomersModal
          existingCustomers={customers}
          user={user}
          onClose={() => setShowImportCustomers(false)}
        />
      )}

      {/* ── MODAL: เพิ่มลูกค้าใหม่ ── */}
      {showNewCustomer&&(
        <Modal onClose={()=>setShowNewCustomer(false)} w={520}>
          <MHead title="👤 เพิ่มลูกค้าใหม่" onClose={()=>setShowNewCustomer(false)} color={T.accent}/>
          <div style={{display:"flex",flexDirection:"column",gap:14,marginBottom:20}}>
            {[{k:"name",l:"ชื่อลูกค้า *",ph:"ชื่อ-นามสกุล"},{k:"phone",l:"เบอร์โทรศัพท์",ph:"0812345678"},{k:"address",l:"ที่อยู่จัดส่ง",ph:"บ้านเลขที่ ซอย ถนน อำเภอ จังหวัด"}].map(f=>(
              <div key={f.k}>
                <label style={{fontSize:11,color:T.muted,display:"block",marginBottom:5,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em"}}>{f.l}</label>
                <input value={newCustomerForm[f.k]} onChange={e=>setNewCustomerForm(p=>({...p,[f.k]:e.target.value}))} placeholder={f.ph}
                  style={{width:"100%",background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:9,padding:"9px 14px",fontFamily:"'Sarabun',sans-serif",fontSize:13,outline:"none"}}/>
              </div>
            ))}
          </div>
          <div style={{display:"flex",gap:10}}>
            <BtnGhost onClick={()=>setShowNewCustomer(false)} style={{flex:1}}>ยกเลิก</BtnGhost>
            <BtnPrimary onClick={handleAddCustomer} disabled={!newCustomerForm.name.trim()} style={{flex:1}}>✅ บันทึกลูกค้า</BtnPrimary>
          </div>
        </Modal>
      )}

      {/* ── MODAL: ค้นหาทั้งระบบ (Ctrl+K) ── */}
      {/* กดผลลัพธ์แล้วเปิดเอกสารนั้นได้เลย แม้จะอยู่นอกช่วงวันที่ที่หน้านั้นโหลดมา */}
      {/* ⚠️ ต้องเรนเดอร์แบบมีเงื่อนไข — ถ้าใส่ไว้ตลอด lazy จะโหลดทันทีตั้งแต่เปิดแอป */}
      {showGlobalSearch && (
      <GlobalSearchModal
        open
        initialTerm={scannedDoc}
        customers={customers}
        onClose={() => setShowGlobalSearch(false)}
        onOpenOrder={(o) => setShowPrintOrder(o)}
        onOpenInvoice={(inv) => setShowPrintInvoice(inv)}
        onOpenCustomer={(c) => { setActiveTab("customers"); setCustomerSearch(c.name || ""); }}
      />
      )}

      {/* ── MODAL: ปริ้นใบสั่งของ ── */}
      {showPrintOrder && (
        <PrintOrderModal
          order={showPrintOrder}
          clothingItems={clothingItems}
          onClose={() => setShowPrintOrder(null)}
          printElementById={printElementById}
        />
      )}

      {/* ── MODAL: ออกบิลใหม่ ── */}
      {showNewInvoice && (
        <NewInvoiceModal
          onClose={() => { setShowNewInvoice(false); setEditingInvoiceId(null); clearInvoiceDraft(); }}
          editingInvoiceId={editingInvoiceId}
          invoices={invoices}
          invoiceDocType={invoiceDocType}
          setInvoiceDocType={setInvoiceDocType}
          invoiceVat={invoiceVat}
          setInvoiceVat={setInvoiceVat}
          invoiceForm={invoiceForm}
          setInvoiceForm={setInvoiceForm}
          invoiceItemForm={invoiceItemForm}
          setInvoiceItemForm={setInvoiceItemForm}
          companyInfo={companyInfo}
          orders={orders}
          orderPool={invoiceOrderPool}
          clothingItems={clothingItems}
          addItemCollapsed={addItemCollapsed}
          setAddItemCollapsed={setAddItemCollapsed}
          handleAddInvoiceItem={handleAddInvoiceItem}
          handleConfirmInvoice={handleConfirmInvoice}
          savingInvoice={savingInvoice}
          handleImportFromOrder={handleImportFromOrder}
          docTypeLabel={docTypeLabel}
          calcInvoice={calcInvoice}
          apparelSizes={apparelSizes}
          shoeSizes={shoeSizes}
        />
      )}

      {/* ── MODAL: จัดการการชำระเงิน ── */}
      {paymentModal && (
        <PaymentModal
          invoice={paymentModal}
          payForm={payForm}
          setPayForm={setPayForm}
          paySaving={paySaving}
          role={role}
          closePaymentModal={closePaymentModal}
          getPaidTotal={getPaidTotal}
          handleAddPayment={handleAddPayment}
          handleRemovePayment={handleRemovePayment}
          handlePaySlipUpload={handlePaySlipUpload}
        />
      )}

      {/* ── MODAL: Bulk รับ/จ่ายสต๊อก หลายรายการ ── */}
      {bulkTxModal && (
        <Modal onClose={()=>!bulkTxSaving&&setBulkTxModal(null)} w={720}>
          <MHead title={`${bulkTxModal.type==="รับ"?"⬇ รับสต๊อก":"⬆ จ่ายสต๊อก"} หลายรายการ`} sub={`${bulkTxModal.items.length} รายการที่เลือก`} onClose={()=>!bulkTxSaving&&setBulkTxModal(null)}/>

          <div style={{maxHeight:380,overflowY:"auto",border:`1px solid ${T.border}`,borderRadius:10,marginBottom:12}}>
            <div style={{display:"grid",gridTemplateColumns:"80px 1fr 90px 110px",alignItems:"center",padding:"8px 12px",background:"#f8f9fb",borderBottom:`1px solid ${T.border}`,fontSize:10,fontWeight:700,color:T.muted,textTransform:"uppercase",letterSpacing:"0.05em"}}>
              <div>รหัส</div><div>ชื่อสินค้า</div><div style={{textAlign:"right"}}>คงเหลือ</div><div style={{textAlign:"right"}}>จำนวน{bulkTxModal.type==="รับ"?" + รับ":" - จ่าย"}</div>
            </div>
            {bulkTxModal.items.map((it,i)=>{
              const q = Number(it.qty)||0;
              const newQty = bulkTxModal.type==="รับ" ? it.current + q : Math.max(0, it.current - q);
              const overflow = bulkTxModal.type==="จ่าย" && q > it.current;
              return (
                <div key={it.id} style={{display:"grid",gridTemplateColumns:"80px 1fr 90px 110px",alignItems:"center",padding:"8px 12px",borderBottom:i<bulkTxModal.items.length-1?`1px solid ${T.border}`:"none",gap:6}}>
                  <div style={{fontFamily:"monospace",fontSize:10,color:T.muted}}>{it.code}</div>
                  <div>
                    <div style={{fontSize:12,fontWeight:600,color:T.text}}>{it.name}</div>
                    {q>0 && (
                      <div style={{fontSize:10,color:overflow?T.red:T.muted,marginTop:1}}>
                        {it.current} → <b style={{color:overflow?T.red:(bulkTxModal.type==="รับ"?T.green:T.amber)}}>{newQty}</b> {it.unit}
                        {overflow && <span style={{marginLeft:6,fontWeight:700}}>⚠️ จ่ายเกินสต๊อก!</span>}
                      </div>
                    )}
                  </div>
                  <div style={{textAlign:"right",fontFamily:"monospace",fontSize:12,color:T.sub}}>{it.current} {it.unit}</div>
                  <div>
                    <input type="number" min="0" value={it.qty} onChange={e=>setBulkItemQty(it.id, e.target.value)}
                      placeholder="0"
                      onFocus={e=>e.target.select()}
                      style={{width:"100%",background:T.input,border:`1px solid ${overflow?T.red:T.inputBorder}`,color:T.text,borderRadius:6,padding:"6px 10px",fontFamily:"monospace",fontSize:13,fontWeight:700,textAlign:"right",outline:"none"}}/>
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{marginBottom:12}}>
            <label style={{fontSize:11,color:T.muted,fontWeight:600,display:"block",marginBottom:4}}>หมายเหตุ (ใช้กับทุกรายการ)</label>
            <input value={bulkTxNote} onChange={e=>setBulkTxNote(e.target.value)}
              placeholder={bulkTxModal.type==="รับ"?"เช่น รับจาก supplier ABC":"เช่น ใช้ผลิตงาน CUS-xxxx"}
              style={{width:"100%",background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:8,padding:"8px 12px",fontFamily:"'Sarabun',sans-serif",fontSize:12,outline:"none"}}/>
          </div>

          {(()=>{const valid=bulkTxModal.items.filter(it=>Number(it.qty)>0);const sum=valid.reduce((s,it)=>s+Number(it.qty)||0,0);return(
            <div style={{padding:"8px 12px",background:bulkTxModal.type==="รับ"?"rgba(22,163,74,0.06)":"rgba(220,38,38,0.06)",border:`1px solid ${bulkTxModal.type==="รับ"?"rgba(22,163,74,0.25)":"rgba(220,38,38,0.25)"}`,borderRadius:8,marginBottom:12,fontSize:12,color:bulkTxModal.type==="รับ"?"#15803d":"#991b1b",fontWeight:600}}>
              📊 จะ{bulkTxModal.type}สต๊อก <b>{valid.length} รายการ</b> · รวม <b style={{fontFamily:"monospace"}}>{sum.toLocaleString("th-TH")}</b> หน่วย
            </div>
          );})()}

          <div style={{display:"flex",gap:10}}>
            <BtnGhost onClick={()=>!bulkTxSaving&&setBulkTxModal(null)} disabled={bulkTxSaving} style={{flex:1}}>ยกเลิก</BtnGhost>
            <BtnPrimary onClick={handleBulkTx} disabled={bulkTxSaving||bulkTxModal.items.filter(it=>Number(it.qty)>0).length===0} style={{flex:2}}>
              {bulkTxSaving?"⏳ กำลังบันทึก...":`✅ บันทึก ${bulkTxModal.type}สต๊อก`}
            </BtnPrimary>
          </div>
        </Modal>
      )}

      {/* ── MODAL: พิมพ์บิล ── */}
      {showPrintInvoice && (
        <PrintInvoiceModal
          invoice={showPrintInvoice}
          clothingItems={clothingItems}
          companyInfo={companyInfo}
          docTypeLabel={docTypeLabel}
          onClose={() => setShowPrintInvoice(null)}
          printElementById={printElementById}
          printInvoiceCopies={printInvoiceCopies}
          downloadInvoicePdf={downloadInvoicePdf}
        />
      )}

      {/* ── MODAL: เพิ่มรุ่นเสื้อผ้า ── */}
      {showAddClothing&&(
        <Modal onClose={()=>{setShowAddClothing(false);setNewModel("");}} w={520}>
          <MHead title="️ เพิ่มรุ่นสินค้าใหม่" onClose={()=>{setShowAddClothing(false);setNewModel("");}}/>
          <label style={{fontSize:11,color:T.muted,display:"block",marginBottom:6,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em"}}>ชื่อรุ่น *</label>
          <input value={newModel} onChange={e=>setNewModel(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleAddClothingItem()} placeholder="เช่น รุ่น A Premium, Classic V2..."
            style={{width:"100%",background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:9,padding:"9px 14px",fontFamily:"'Sarabun',sans-serif",fontSize:13,outline:"none",marginBottom:20}}/>
          <div style={{display:"flex",gap:10}}>
            <BtnGhost onClick={()=>{setShowAddClothing(false);setNewModel("");}} style={{flex:1}}>ยกเลิก</BtnGhost>
            <BtnPrimary onClick={handleAddClothingItem} disabled={!newModel.trim()} style={{flex:1}}>✅ สร้างรุ่น</BtnPrimary>
          </div>
        </Modal>
      )}

      {/* ── MODAL: ขายตามวันที่/รายเดือน (สรุปจ่ายออก แยกรุ่น/สี/ไซส์) ── */}
      {showSalesToday&&(()=>{
        const [yy,mm,dd] = salesDate.split("-");
        const prefix = `${dd}/${mm}/${yy}`;      // รูปแบบ transaction.date (ใช้ตอนเปิดรายการรายช่อง)
        const monthPrefix = `${mm}/${yy}`;       // สำหรับโหมดรายเดือน
        // salesTx ถูก query ตามช่วงวัน/เดือนมาแล้ว → กรองแค่ประเภท
        const todays = salesTx.filter(t => t.type==="จ่าย" && t.category==="เสื้อผ้า");
        const byModel = {};
        todays.forEach(t => {
          const parts = String(t.name||"").split(" / ");
          // 🛡️ กันชื่อว่าง/ช่องว่างล้วน → เดิม trim() แล้วได้ "" ทำให้แถวโล่ง มองไม่เห็นอะไรเลย
          const model = (parts[0]||"").trim() || String(t.name||"").trim() || "(ไม่ระบุรุ่น)";
          const color = (parts[1]||"").trim() || "-";
          const size  = (parts[2]||"").trim() || "-";
          if (!byModel[model]) byModel[model] = { total:0, rows:{} };
          byModel[model].total += Number(t.qty)||0;
          const k = `${color}|||${size}`;
          byModel[model].rows[k] = (byModel[model].rows[k]||0) + (Number(t.qty)||0);
        });
        const allModels = Object.keys(byModel).sort((a,b)=>byModel[b].total-byModel[a].total);
        // 🔎 ค้นหา + จำกัดจำนวนที่วาด — ยอดหลักพันมีรุ่นเป็นร้อย วาดหมดทีเดียวเบราว์เซอร์ค้าง
        const q = (salesSearch||"").trim().toLowerCase();
        const matched = q ? allModels.filter(m => m.toLowerCase().includes(q)) : allModels;
        const models = matched.slice(0, salesShowCount);
        const hiddenCount = matched.length - models.length;
        const grandTotal = todays.reduce((s,t)=>s+(Number(t.qty)||0),0);
        const isToday = salesDate === new Date().toISOString().slice(0,10);
        const isMonth = salesMode === "month";
        const THAI_MO = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];
        return (
        <Modal onClose={()=>setShowSalesToday(false)} w={640}>
          <MHead title={isMonth?`📊 ขายรายเดือน · ${THAI_MO[Number(mm)-1]} ${Number(yy)+543}`:`📊 ขาย${isToday?"วันนี้":"ตามวันที่"}`} onClose={()=>setShowSalesToday(false)} color={T.green}/>
          <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:14,flexWrap:"wrap"}}>
            {/* 📅 สลับ วัน / เดือน */}
            <div style={{display:"flex",gap:3,background:"#eef2f7",borderRadius:8,padding:3}}>
              {[{k:"day",l:"รายวัน"},{k:"month",l:"รายเดือน"}].map(m=>(
                <button key={m.k} onClick={()=>setSalesMode(m.k)}
                  style={{padding:"5px 12px",borderRadius:6,border:"none",cursor:"pointer",fontSize:12,fontWeight:salesMode===m.k?700:500,fontFamily:"'Sarabun',sans-serif",background:salesMode===m.k?"white":"transparent",color:salesMode===m.k?T.green:T.sub,boxShadow:salesMode===m.k?"0 1px 3px rgba(0,0,0,0.1)":"none"}}>{m.l}</button>
              ))}
            </div>
            {isMonth ? (
              <input type="month" value={salesDate.slice(0,7)} onChange={e=>{const v=e.target.value; if(v) setSalesDate(`${v}-01`);}}
                style={{background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:9,padding:"8px 12px",fontFamily:"'Sarabun',sans-serif",fontSize:13,outline:"none"}}/>
            ) : (
              <input type="date" value={salesDate} onChange={e=>setSalesDate(e.target.value)}
                style={{background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:9,padding:"8px 12px",fontFamily:"'Sarabun',sans-serif",fontSize:13,outline:"none"}}/>
            )}
            <button onClick={()=>setSalesDate(new Date().toISOString().slice(0,10))} style={{padding:"7px 12px",borderRadius:8,border:`1px solid ${T.border}`,background:"transparent",color:T.sub,cursor:"pointer",fontSize:12,fontFamily:"'Sarabun',sans-serif"}}>{isMonth?"เดือนนี้":"วันนี้"}</button>
            {allModels.length>8&&(
              <input value={salesSearch} onChange={e=>{setSalesSearch(e.target.value); setSalesShowCount(30);}}
                placeholder={`🔍 ค้นรุ่น (${allModels.length} รุ่น)`}
                style={{flex:"1 1 150px",minWidth:130,background:T.input,border:`1px solid ${salesSearch?T.green:T.inputBorder}`,color:T.text,borderRadius:9,padding:"8px 12px",fontFamily:"'Sarabun',sans-serif",fontSize:13,outline:"none"}}/>
            )}
            {models.length>1&&(()=>{const allCollapsed=models.every(mm=>collapsedSalesModels[mm]);return(
              <button onClick={()=>setCollapsedSalesModels(allCollapsed?{}:Object.fromEntries(models.map(mm=>[mm,true])))} style={{padding:"7px 12px",borderRadius:8,border:`1px solid ${T.border}`,background:"transparent",color:T.sub,cursor:"pointer",fontSize:12,fontFamily:"'Sarabun',sans-serif"}}>{allCollapsed?"⊞ กางทั้งหมด":"⊟ ย่อทั้งหมด"}</button>
            );})()}
            <div style={{marginLeft:"auto",fontSize:14,fontWeight:800,color:T.green}}>{salesTxLoading?"⏳ กำลังโหลด...":`รวมทั้งหมด ${grandTotal.toLocaleString("th-TH")} ตัว`}</div>
          </div>

          {models.length===0 ? (
            <div style={{textAlign:"center",padding:40,color:T.muted,fontSize:13}}>
              <div style={{fontSize:40,marginBottom:8,opacity:0.3}}>{salesTxLoading?"⏳":q?"🔍":"📭"}</div>
              {salesTxLoading ? "กำลังโหลด..." : q ? `ไม่พบรุ่นที่ค้น "${salesSearch}"` : (isMonth?"ยังไม่มีการจ่ายออกในเดือนนี้":"ยังไม่มีการจ่ายออกในวันนี้")}
            </div>
          ) : (
            <div className="scroll-col" style={{display:"flex",flexDirection:"column",gap:12,maxHeight:"60vh",overflowY:"auto"}}>
              {models.map(model=>{
                const m = byModel[model];
                // จัดกลุ่มตามสีก่อน → แต่ละสีเรียงไซส์
                const byColor = {};
                Object.entries(m.rows).forEach(([k,qty])=>{
                  const [color,size]=k.split("|||");
                  if(!byColor[color]) byColor[color]={total:0,sizes:[]};
                  byColor[color].total += qty;
                  byColor[color].sizes.push({size,qty});
                });
                const colors = Object.keys(byColor).sort((a,b)=>byColor[b].total-byColor[a].total);
                colors.forEach(c=>byColor[c].sizes.sort((a,b)=>compareSizes(a.size,b.size)));
                // หา hex ของสีจาก clothingItems (ถ้ามี)
                const itemMatch = clothingItems.find(it=>it.model===model);
                const hexOf = (cn)=>(itemMatch?.colors||[]).find(c=>c.colorName===cn)?.hex || "#cbd2d9";
                const mCollapsed = collapsedSalesModels[model];
                return (
                  <div key={model} style={{border:`1px solid ${T.border}`,borderRadius:12,overflow:"hidden"}}>
                    <div onClick={()=>setCollapsedSalesModels(p=>({...p,[model]:!p[model]}))}
                      style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,padding:"10px 14px",minHeight:42,background:"rgba(58,122,82,0.08)",cursor:"pointer",userSelect:"none",lineHeight:1.4}}>
                      <div style={{display:"flex",alignItems:"center",gap:8,minWidth:0}}>
                        <span style={{width:18,height:18,borderRadius:5,background:"rgba(58,122,82,0.15)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,color:T.green,transition:"transform 0.2s",transform:mCollapsed?"rotate(-90deg)":"rotate(0deg)",flexShrink:0}}>▼</span>
                        <div style={{fontSize:14,fontWeight:800,color:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>👕 {model}</div>
                        <span style={{fontSize:11,color:T.muted,flexShrink:0}}>· {colors.length} สี</span>
                      </div>
                      <div style={{fontSize:14,fontWeight:800,color:T.green,fontFamily:"monospace",flexShrink:0}}>{m.total.toLocaleString("th-TH")} ตัว</div>
                    </div>
                    <div style={{display:mCollapsed?"none":"flex",flexDirection:"column"}}>
                      {colors.map((color,ci)=>(
                        <div key={color} style={{display:"flex",alignItems:"flex-start",gap:10,padding:"8px 14px",borderTop:ci>0?`1px solid ${T.border}`:"none"}}>
                          <div style={{display:"flex",alignItems:"center",gap:6,minWidth:96,flexShrink:0,paddingTop:3}}>
                            <span style={{width:14,height:14,borderRadius:4,background:hexOf(color),border:"1px solid rgba(0,0,0,0.15)",flexShrink:0}}/>
                            <span style={{fontSize:13,fontWeight:700,color:T.text}}>{color}</span>
                            <span style={{fontSize:11,color:T.muted,fontFamily:"monospace"}}>({byColor[color].total})</span>
                          </div>
                          <div style={{display:"flex",flexWrap:"wrap",gap:5,flex:1}}>
                            {byColor[color].sizes.map((s,i)=>(
                              <button key={i} onClick={()=>setSalesCell({model,color,size:s.size,prefix:isMonth?monthPrefix:prefix,mode:salesMode})} title="คลิกเพื่อดู/ลบรายการที่กรอกผิด"
                                style={{display:"inline-flex",alignItems:"center",gap:4,padding:"3px 9px",borderRadius:7,background:"rgba(241,243,246,0.8)",border:`1px solid ${T.border}`,fontSize:12,cursor:"pointer",fontFamily:"'Sarabun',sans-serif"}}
                                onMouseEnter={e=>e.currentTarget.style.background="rgba(184,134,0,0.12)"}
                                onMouseLeave={e=>e.currentTarget.style.background="rgba(241,243,246,0.8)"}>
                                <span style={{fontFamily:"monospace",fontWeight:700,color:T.accent}}>{s.size}</span>
                                <span style={{fontFamily:"monospace",fontWeight:700,color:T.text}}>×{s.qty}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
              {hiddenCount>0 && (
                <button onClick={()=>setSalesShowCount(c=>c+30)}
                  style={{padding:"11px",borderRadius:10,border:`1px dashed ${T.border}`,background:"transparent",color:T.sub,cursor:"pointer",fontSize:13,fontFamily:"'Sarabun',sans-serif",fontWeight:600}}>
                  ⬇️ ดูเพิ่ม (เหลืออีก {hiddenCount.toLocaleString("th-TH")} รุ่น)
                </button>
              )}
            </div>
          )}
          <div style={{marginTop:16}}>
            <BtnGhost onClick={()=>setShowSalesToday(false)} style={{width:"100%"}}>ปิด</BtnGhost>
          </div>
        </Modal>
        );
      })()}

      {/* ── MODAL: รายการจ่ายของช่อง (ดู/ลบรายการที่กรอกผิด) ── */}
      {salesCell&&(()=>{
        const { model, color, size, prefix, mode } = salesCell;
        const targetName = `${model} / ${color} / ${size}`;
        // date = "DD/MM/YYYY HH:mm" — รายเดือนเทียบ MM/YYYY, รายวันเทียบ DD/MM/YYYY
        const matchDate = (d) => mode === "month" ? String(d||"").slice(3,10) === prefix : String(d||"").startsWith(prefix);
        const cellTx = salesTx
          .filter(t => t.type==="จ่าย" && t.category==="เสื้อผ้า" && matchDate(t.date) && (t.name||"")===targetName)
          .sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
        const cellTotal = cellTx.reduce((s,t)=>s+(Number(t.qty)||0),0);
        return (
        <Modal onClose={()=>setSalesCell(null)} w={460}>
          <MHead title="🔧 แก้ไขรายการจ่าย" sub={`${model} · ${color} · ไซส์ ${size}`} onClose={()=>setSalesCell(null)} color={T.amber}/>
          <div style={{padding:"10px 12px",background:"rgba(184,134,0,0.06)",borderRadius:9,marginBottom:12,fontSize:12,color:T.sub}}>
            รวมจ่ายช่องนี้ <b style={{color:T.text}}>{cellTotal.toLocaleString("th-TH")} ตัว</b> จาก {cellTx.length} รายการ · กรอกผิดให้กด 🗑 ลบรายการนั้น (สต็อกคืนกลับให้อัตโนมัติ)
          </div>
          {cellTx.length===0 ? (
            <div style={{textAlign:"center",padding:30,color:T.muted,fontSize:13}}>ไม่พบรายการ</div>
          ) : (
            <div className="scroll-col" style={{display:"flex",flexDirection:"column",gap:8,maxHeight:"50vh",overflowY:"auto"}}>
              {cellTx.map(t=>(
                <div key={t.id} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",border:`1px solid ${T.border}`,borderRadius:10}}>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:14,fontWeight:800,color:T.text,fontFamily:"monospace"}}>×{t.qty} ตัว</div>
                    <div style={{fontSize:11,color:T.muted}}>{t.date}{t.by?` · ${t.by}`:""}{t.note?` · ${t.note}`:""}</div>
                  </div>
                  {role.canAdd&&(
                    <button onClick={async()=>{await handleDeleteSaleTx(t); setSalesTxNonce(n=>n+1); if(cellTx.length<=1)setSalesCell(null);}} disabled={txSaving} title="ลบรายการนี้ + คืนสต็อก"
                      style={{padding:"6px 12px",borderRadius:8,border:"1px solid rgba(248,113,113,0.3)",background:"rgba(248,113,113,0.08)",color:T.red,cursor:txSaving?"wait":"pointer",fontSize:12,fontFamily:"'Sarabun',sans-serif",fontWeight:600}}>🗑 ลบ</button>
                  )}
                </div>
              ))}
            </div>
          )}
          <div style={{marginTop:14}}>
            <BtnGhost onClick={()=>setSalesCell(null)} style={{width:"100%"}}>ปิด</BtnGhost>
          </div>
        </Modal>
        );
      })()}

      {/* ── MODAL: จัดการไซส์ (เพิ่ม/ลบ ไซส์เสื้อผ้า + รองเท้า) ── */}
      {showSizeManager&&(
        <Modal onClose={()=>setShowSizeManager(false)} w={540}>
          <MHead title="📏 จัดการไซส์" onClose={()=>setShowSizeManager(false)}/>
          <div style={{fontSize:12,color:T.sub,marginBottom:16,padding:"10px 12px",background:"rgba(59,91,139,0.06)",borderRadius:9,lineHeight:1.6}}>
            เพิ่มไซส์ใหม่ได้เมื่อมีไซส์ใหญ่กว่าเดิม เช่น <b>6XL, 7XL</b> (เสื้อผ้า) หรือ <b>46, 47</b> (รองเท้า)<br/>
            ไซส์ที่เพิ่มจะแสดงในทุกหน้า — ตารางสต็อก, รับ/จ่าย, ออกบิล · ไซส์มาตรฐานลบไม่ได้
          </div>

          {/* เสื้อผ้า */}
          <div style={{marginBottom:18}}>
            <div style={{fontSize:13,fontWeight:700,color:T.text,marginBottom:8}}>👕 ไซส์เสื้อผ้า</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:10}}>
              {SIZES.map(sz=>(
                <span key={sz} style={{padding:"5px 12px",borderRadius:8,border:`1px solid ${T.border}`,background:"rgba(241,243,246,0.7)",color:T.sub,fontFamily:"monospace",fontSize:12,fontWeight:600}}>{sz}</span>
              ))}
              {(customSizes?.apparel||[]).slice().sort(compareSizes).map(sz=>(
                <span key={sz} style={{display:"inline-flex",alignItems:"center",gap:6,padding:"5px 8px 5px 12px",borderRadius:8,border:`1px solid ${T.accent}`,background:"rgba(59,91,139,0.12)",color:T.accent,fontFamily:"monospace",fontSize:12,fontWeight:700}}>
                  {sz}
                  <button onClick={()=>removeCustomSize("apparel",sz)} title="ลบ" style={{border:"none",background:"transparent",color:T.red,cursor:"pointer",fontSize:13,lineHeight:1,padding:0}}>✕</button>
                </span>
              ))}
            </div>
            <div style={{display:"flex",gap:8}}>
              <input value={newApparelSize} onChange={e=>setNewApparelSize(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addCustomSize("apparel",newApparelSize)} placeholder="เช่น 6XL, 7XL"
                style={{flex:1,background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:9,padding:"9px 14px",fontFamily:"'Sarabun',sans-serif",fontSize:13,outline:"none"}}/>
              <BtnPrimary onClick={()=>addCustomSize("apparel",newApparelSize)} disabled={!newApparelSize.trim()}>➕ เพิ่ม</BtnPrimary>
            </div>
          </div>

          {/* รองเท้า */}
          <div style={{marginBottom:6}}>
            <div style={{fontSize:13,fontWeight:700,color:T.text,marginBottom:8}}>👟 ไซส์รองเท้า</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:10}}>
              {SHOE_SIZES.map(sz=>(
                <span key={sz} style={{padding:"5px 12px",borderRadius:8,border:`1px solid ${T.border}`,background:"rgba(241,243,246,0.7)",color:T.sub,fontFamily:"monospace",fontSize:12,fontWeight:600}}>{sz}</span>
              ))}
              {(customSizes?.shoe||[]).slice().sort(compareSizes).map(sz=>(
                <span key={sz} style={{display:"inline-flex",alignItems:"center",gap:6,padding:"5px 8px 5px 12px",borderRadius:8,border:`1px solid ${T.accent}`,background:"rgba(59,91,139,0.12)",color:T.accent,fontFamily:"monospace",fontSize:12,fontWeight:700}}>
                  {sz}
                  <button onClick={()=>removeCustomSize("shoe",sz)} title="ลบ" style={{border:"none",background:"transparent",color:T.red,cursor:"pointer",fontSize:13,lineHeight:1,padding:0}}>✕</button>
                </span>
              ))}
            </div>
            <div style={{display:"flex",gap:8}}>
              <input value={newShoeSize} onChange={e=>setNewShoeSize(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addCustomSize("shoe",newShoeSize)} placeholder="เช่น 46, 47"
                style={{flex:1,background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:9,padding:"9px 14px",fontFamily:"'Sarabun',sans-serif",fontSize:13,outline:"none"}}/>
              <BtnPrimary onClick={()=>addCustomSize("shoe",newShoeSize)} disabled={!newShoeSize.trim()}>➕ เพิ่ม</BtnPrimary>
            </div>
          </div>

          <div style={{marginTop:20}}>
            <BtnGhost onClick={()=>setShowSizeManager(false)} style={{width:"100%"}}>ปิด</BtnGhost>
          </div>
        </Modal>
      )}

      {/* ── MODAL: กรอกรายละเอียดใบสั่งของที่ค้าง (mix items) ── */}
      {fillOrderMix&&(()=>{
        const order = fillOrderMix.order;
        const mixItems = (order.items||[]).map((it,idx)=>({it,idx})).filter(x=>x.it.isMix);
        const setCell = (idx, ci, sz, val) => setFillRowsByIdx(m => ({
          ...m,
          [idx]: { ...(m[idx]||{}), [ci]: { ...((m[idx]||{})[ci]||{}), [sz]: val } }
        }));
        return (
        <Modal onClose={()=>{setFillOrderMix(null);setFillRowsByIdx({});}} w={1000}>
          <MHead title={`✏️ กรอกรายละเอียด — ${order.orderNo}`} sub={`ลูกค้า: ${order.customerName} · รายการคละ ${mixItems.length} รายการ`} onClose={()=>{setFillOrderMix(null);setFillRowsByIdx({});}} color={T.amber}/>
          <div className="scroll-col" style={{display:"flex",flexDirection:"column",gap:16,maxHeight:"72vh",overflowY:"auto"}}>
            {mixItems.map(({it,idx})=>{
              const cItem = clothingItems.find(c=>c.id===it.clothingId);
              const grid = fillRowsByIdx[idx]||{};
              const gridSum = Object.values(grid).reduce((s,byS)=>s+Object.values(byS||{}).reduce((a,q)=>a+(Number(q)||0),0),0);
              const sizes = cItem ? sizesFor(cItem) : [];
              const target = Number(it.qty)||0;
              const done = gridSum===target;
              return (
                <div key={idx} style={{padding:12,background:"#fffbeb",border:`2px solid ${done?"#86efac":"#fde68a"}`,borderRadius:10}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10,flexWrap:"wrap",gap:6}}>
                    <div style={{fontSize:14,fontWeight:700,color:T.text}}>{it.clothingName} <span style={{color:T.amber,marginLeft:6,fontSize:13}}>· เป้าหมาย {target} ตัว</span></div>
                    <div style={{fontSize:12,fontWeight:700,padding:"3px 10px",borderRadius:10,background:done?"#dcfce7":"#fef3c7",color:done?"#059669":T.amber}}>กรอกแล้ว {gridSum}/{target} {done?"✓":""}</div>
                  </div>
                  {!cItem && <div style={{fontSize:11,color:T.red,marginBottom:8}}>⚠️ ไม่พบรุ่นสินค้าเดิม</div>}
                  {cItem && (
                    <div style={{overflowX:"auto"}}>
                      <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,minWidth:520}}>
                        <thead>
                          <tr style={{background:"#f1f5fb"}}>
                            <th style={{position:"sticky",left:0,background:"#f1f5fb",zIndex:2,padding:"7px 10px",textAlign:"left",color:T.sub,fontWeight:700,borderRight:`1px solid ${T.border}`,minWidth:120}}>สี \\ ไซส์</th>
                            {sizes.map(sz=>(
                              <th key={sz} style={{padding:"7px 3px",textAlign:"center",color:T.text,fontWeight:700,fontFamily:"monospace",minWidth:52,borderRight:`1px solid ${T.border}`}}>{sz}</th>
                            ))}
                            <th style={{padding:"7px 8px",textAlign:"center",color:T.accent,fontWeight:700,minWidth:54}}>รวม</th>
                          </tr>
                        </thead>
                        <tbody>
                          {cItem.colors.map((c,ci)=>{
                            const rowByS = grid[ci]||{};
                            const rowTotal = Object.values(rowByS).reduce((a,q)=>a+(Number(q)||0),0);
                            return (
                              <tr key={ci} style={{borderTop:`1px solid ${T.border}`}}>
                                <td style={{position:"sticky",left:0,background:"white",zIndex:1,padding:"5px 10px",borderRight:`1px solid ${T.border}`,whiteSpace:"nowrap"}}>
                                  <span style={{display:"inline-flex",alignItems:"center",gap:6}}>
                                    <span style={{width:12,height:12,borderRadius:3,background:c.colorHex||c.hex||"#999",border:"1px solid rgba(0,0,0,0.15)"}}/>
                                    <span style={{fontWeight:600,color:T.text,fontSize:12}}>{c.colorName}</span>
                                  </span>
                                </td>
                                {sizes.map(sz=>{
                                  const stock = (c.stock||{})[sz]||0;
                                  const v = rowByS[sz] ?? "";
                                  const over = Number(v) > stock;
                                  return (
                                    <td key={sz} style={{padding:"3px",borderRight:`1px solid ${T.border}`}}>
                                      <input type="number" inputMode="numeric" value={v} onChange={e=>setCell(idx,ci,sz,e.target.value)} placeholder="·"
                                        title={`สต็อก ${stock}`}
                                        style={{width:"100%",minWidth:44,boxSizing:"border-box",textAlign:"center",background:over?"#fee2e2":(Number(v)>0?"#eff6ff":"white"),border:`1px solid ${over?"#ef4444":T.inputBorder}`,borderRadius:5,padding:"6px 2px",fontFamily:"monospace",fontSize:13,outline:"none",color:T.text}}/>
                                    </td>
                                  );
                                })}
                                <td style={{textAlign:"center",fontFamily:"monospace",fontWeight:700,color:rowTotal>0?T.accent:T.muted}}>{rowTotal||""}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot>
                          <tr style={{background:"#f8fafc",borderTop:`2px solid ${T.border}`}}>
                            <td style={{position:"sticky",left:0,background:"#f8fafc",padding:"7px 10px",fontWeight:700,color:T.sub,borderRight:`1px solid ${T.border}`}}>รวมไซส์</td>
                            {sizes.map(sz=>{
                              const colSum = cItem.colors.reduce((s,_,ci)=>s+(Number((grid[ci]||{})[sz])||0),0);
                              return <td key={sz} style={{padding:"7px 3px",textAlign:"center",fontFamily:"monospace",fontWeight:700,color:colSum>0?T.accent:T.muted,borderRight:`1px solid ${T.border}`}}>{colSum||"—"}</td>;
                            })}
                            <td style={{padding:"7px 8px",textAlign:"center",fontFamily:"monospace",fontWeight:800,color:done?"#059669":T.amber,fontSize:13}}>{gridSum}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div style={{display:"flex",gap:10,marginTop:14}}>
            <BtnGhost onClick={()=>{setFillOrderMix(null);setFillRowsByIdx({});}} style={{flex:1}}>ยกเลิก</BtnGhost>
            <BtnPrimary onClick={handleSaveFillOrderMix} style={{flex:2}}>✅ บันทึก + ตัดสต็อก</BtnPrimary>
          </div>
        </Modal>
        );
      })()}

      {/* ── MODAL: รายการรอระบุรายละเอียด (pending mix sales) ── */}
      {pendingMixListOpen&&(
        <Modal onClose={()=>setPendingMixListOpen(false)} w={720}>
          <MHead title={`🕐 รายการขายคละที่รอระบุ (${(pendingMixSales||[]).length})`} sub="คลิกรายการ → กรอกสี/ไซส์ → ตัดสต็อกและออกบิลได้" onClose={()=>setPendingMixListOpen(false)} color={T.amber}/>
          {(pendingMixSales||[]).length===0?(
            <div style={{padding:40,textAlign:"center",color:T.muted,fontSize:13}}>ไม่มีรายการค้าง 🎉</div>
          ):(
            <div className="scroll-col" style={{display:"flex",flexDirection:"column",gap:8,maxHeight:"60vh",overflowY:"auto"}}>
              {pendingMixSales.map(p=>{
                const item = clothingItems.find(i=>i.id===p.itemId);
                const total = (p.rows||[]).reduce((s,r)=>s+(Number(r.qty)||0),0);
                const gone = !item;
                return (
                  <div key={p.id} style={{padding:"10px 14px",background:gone?"#fef2f2":"#fffbeb",border:`1px solid ${gone?"#fecaca":"#fde68a"}`,borderRadius:9,display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                    <div style={{flex:"1 1 200px"}}>
                      <div style={{fontSize:13,fontWeight:700,color:T.text}}>{p.itemModel||"?"}{gone&&<span style={{marginLeft:6,fontSize:10,color:T.red}}>· ไม่พบสินค้า</span>}</div>
                      <div style={{fontSize:10,color:T.muted,marginTop:2}}>
                        {p.note && <span>📝 {p.note} · </span>}
                        ~{p.quickQty||total||"?"} ตัว
                        {total>0&&<span> · กรอกแล้ว {total}</span>}
                        · โดย {p.createdBy||"?"}
                      </div>
                    </div>
                    {!gone&&<button onClick={()=>openMixFromPending(p)} style={{padding:"7px 14px",borderRadius:7,border:"none",background:T.accent,color:"white",cursor:"pointer",fontSize:12,fontWeight:600,fontFamily:"'Sarabun',sans-serif"}}>✏️ กรอกต่อ</button>}
                    <button onClick={()=>handleDeletePending(p.id)} title="ลบรายการนี้" style={{padding:"7px 10px",borderRadius:7,border:"1px solid rgba(248,113,113,0.3)",background:"rgba(248,113,113,0.08)",color:"#f87171",cursor:"pointer",fontSize:12}}>🗑</button>
                  </div>
                );
              })}
            </div>
          )}
        </Modal>
      )}

      {/* ── MODAL: ขายคละสีคละไซส์ ── */}
      {mixModal&&(()=>{
        const item = mixModal.item;
        const sizes = sizesFor(item);
        const rows = mixRows;
        const totalQty = rows.reduce((s,r)=>s+(Number(r.qty)||0),0);
        const totalValue = rows.reduce((s,r)=>{
          const col=item.colors[r.colorIdx];
          return s + (Number(r.qty)||0) * getPriceForSize(col, r.size);
        },0);
        const setRow=(i,patch)=>setMixRows(rs=>rs.map((r,idx)=>idx===i?{...r,...patch}:r));
        const stockOf=(ci,sz)=>((item.colors[ci]||{}).stock||{})[sz]||0;
        return (
        <Modal onClose={()=>setMixModal(null)} w={640}>
          <MHead title={mixModal.pendingId?"✏️ กรอกรายละเอียดที่ค้าง":"🧺 ขายคละสีคละไซส์"} onClose={()=>setMixModal(null)} color={T.amber}/>
          {txSuccess&&<Toast msg="ตัดสต็อกคละสำเร็จ!"/>}
          <div style={{padding:12,background:"rgba(184,134,0,0.06)",border:`1px solid rgba(184,134,0,0.2)`,borderRadius:10,marginBottom:14}}>
            <div style={{fontSize:13,fontWeight:700,color:T.text}}>{item.model}{mixModal.pendingId&&<span style={{marginLeft:8,fontSize:10,color:T.amber,fontWeight:600}}>· กำลังกรอกต่อจาก "รอระบุ"</span>}</div>
            <div style={{fontSize:11,color:T.sub,marginTop:2}}>💡 กรอกรายละเอียดครบ = ตัดสต็อก · กรอกไม่ครบ = บันทึกไว้ก่อน กรอกทีหลังได้</div>
          </div>
          <div style={{padding:10,background:"#f8fafc",border:`1px dashed ${T.border}`,borderRadius:9,marginBottom:12,display:"flex",alignItems:"center",gap:10}}>
            <label style={{fontSize:11,color:T.muted,fontWeight:600,whiteSpace:"nowrap"}}>🚀 ยอดรวมประมาณการ:</label>
            <input type="number" placeholder="เช่น 20" value={mixQuickQty} onChange={e=>setMixQuickQty(e.target.value)}
              style={{width:100,background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:7,padding:"6px 10px",fontFamily:"monospace",fontSize:13,outline:"none",textAlign:"center"}}/>
            <span style={{fontSize:10,color:T.muted}}>ตัว · ใช้ตอน "บันทึกไว้ก่อน" — ยังไม่ต้องเลือกสี/ไซส์</span>
          </div>

          <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:12}}>
            <div style={{display:"grid",gridTemplateColumns:"1.4fr 1fr 0.9fr 1fr 32px",gap:8,fontSize:10,color:T.muted,fontWeight:700,textTransform:"uppercase",padding:"0 2px"}}>
              <div>สี</div><div>ไซส์</div><div>จำนวน</div><div>สต็อก/ราคา</div><div></div>
            </div>
            {rows.map((r,i)=>{
              const stock=stockOf(r.colorIdx,r.size);
              const q=Number(r.qty)||0;
              const over=r.size&&q>stock;
              const price=getPriceForSize(item.colors[r.colorIdx], r.size);
              return (
                <div key={i} style={{display:"grid",gridTemplateColumns:"1.4fr 1fr 0.9fr 1fr 32px",gap:8,alignItems:"center"}}>
                  <select value={r.colorIdx} onChange={e=>setRow(i,{colorIdx:Number(e.target.value)})}
                    style={{background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:8,padding:"8px 10px",fontFamily:"'Sarabun',sans-serif",fontSize:13,outline:"none"}}>
                    {item.colors.map((c,ci)=><option key={ci} value={ci}>{c.colorName}</option>)}
                  </select>
                  <select value={r.size} onChange={e=>setRow(i,{size:e.target.value})}
                    style={{background:T.input,border:`1px solid ${r.size?T.inputBorder:"#fbbf24"}`,color:T.text,borderRadius:8,padding:"8px 10px",fontFamily:"'Sarabun',sans-serif",fontSize:13,outline:"none"}}>
                    <option value="">— ไซส์ —</option>
                    {sizes.map(sz=><option key={sz} value={sz}>{sz} ({stockOf(r.colorIdx,sz)})</option>)}
                  </select>
                  <input type="number" placeholder="0" value={r.qty} onChange={e=>setRow(i,{qty:e.target.value})}
                    style={{background:T.input,border:`1px solid ${over?"#ef4444":T.inputBorder}`,color:T.text,borderRadius:8,padding:"8px 10px",fontFamily:"'Sarabun',sans-serif",fontSize:13,outline:"none",width:"100%"}}/>
                  <div style={{fontSize:11,color:over?"#ef4444":T.sub,lineHeight:1.3}}>
                    {r.size?<>คงเหลือ {stock}{over&&" ⚠️"}<br/><span style={{color:T.muted}}>{price?`${price.toLocaleString("th-TH")}฿/ตัว`:"ไม่ตั้งราคา"}</span></>:"—"}
                  </div>
                  <button onClick={()=>setMixRows(rs=>rs.filter((_,idx)=>idx!==i))} title="ลบแถว"
                    style={{border:"none",background:"transparent",color:T.red,cursor:"pointer",fontSize:15,padding:0}}>✕</button>
                </div>
              );
            })}
          </div>

          <button onClick={()=>setMixRows(rs=>[...rs,{colorIdx:0,size:"",qty:""}])}
            style={{width:"100%",padding:"8px",borderRadius:8,border:`1px dashed ${T.accent}`,background:"rgba(59,91,139,0.05)",color:T.accent,cursor:"pointer",fontSize:12,fontWeight:600,fontFamily:"'Sarabun',sans-serif",marginBottom:14}}>➕ เพิ่มแถว</button>

          <div style={{marginBottom:14}}>
            <label style={{fontSize:11,color:T.muted,display:"block",marginBottom:6,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em"}}>หมายเหตุ (ชื่อลูกค้า/เลขบิล)</label>
            <input placeholder="เช่น ร้านกีฬาสมศักดิ์ / บิล #123" value={mixNote} onChange={e=>setMixNote(e.target.value)}
              style={{width:"100%",background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:9,padding:"9px 14px",fontFamily:"'Sarabun',sans-serif",fontSize:13,outline:"none"}}/>
          </div>

          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 14px",background:"rgba(58,122,82,0.08)",borderRadius:9,marginBottom:14}}>
            <div style={{fontSize:13,color:T.text,fontWeight:700}}>รวม {totalQty.toLocaleString("th-TH")} ตัว</div>
            <div style={{fontSize:13,color:T.green,fontWeight:700}}>มูลค่า ~{totalValue.toLocaleString("th-TH")} ฿</div>
          </div>

          <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
            <BtnGhost onClick={()=>setMixModal(null)} disabled={txSaving} style={{flex:"1 1 100px",minWidth:100}}>ยกเลิก</BtnGhost>
            <button onClick={handleMixQuickSave} disabled={txSaving}
              style={{flex:"1 1 180px",minWidth:180,padding:"10px 14px",borderRadius:9,border:"1px solid rgba(184,134,0,0.4)",background:"rgba(184,134,0,0.12)",color:T.amber,cursor:txSaving?"not-allowed":"pointer",fontSize:13,fontWeight:700,fontFamily:"'Sarabun',sans-serif",opacity:txSaving?0.5:1}}>
              🚀 บันทึกไว้ก่อน (กรอกทีหลัง)
            </button>
            <BtnDanger onClick={handleMixDispatch} disabled={txSaving||totalQty<=0} style={{flex:"1 1 180px",minWidth:180}}>{txSaving?"⏳ กำลังบันทึก...":`✅ ตัดสต็อก (${totalQty})`}</BtnDanger>
          </div>
        </Modal>
        );
      })()}

      {/* ── MODAL: ตั้งราคาตามไซส์ ── */}
      {priceModal&&(()=>{
        const item = clothingItems.find(i=>i.id===priceModal.itemId);
        const col = item?.colors?.[priceModal.ci];
        if(!item||!col) return null;
        // 📏 แถวราคาสร้างจากไซส์จริงของรุ่นนี้ (สนับแข้ง/รองเท้า ไม่ได้ใช้ไซส์เสื้อ)
        const itemSizes = sizesFor(item);
        const bySize = !!priceModal.bySize;
        const priceRows = priceRowsForSizes(itemSizes, bySize);
        const handleSavePrices = async () => {
          // คงคีย์เดิมที่ไม่ได้อยู่ในแถวตอนนี้ไว้ (เช่น ไซส์ที่ซ่อนไป — เผื่อเอากลับมา)
          const salePrices = { ...(col.salePrices || {}) };
          priceRows.forEach(r => { salePrices[r.key] = Number(priceForm[r.key]) || 0; });
          const defaultPrice = salePrices.reg || salePrices.kids || priceRows.map(r=>Number(priceForm[r.key])||0).find(v=>v>0) || 0;
          const newColors = item.colors.map((c,i)=>{
            // ถ้าเลือก applyAll = ใช้ราคาเดียวกันกับทุกสีของรุ่นนี้
            if (priceModal.applyAll || i===priceModal.ci) {
              return {
                ...c,
                costPrice: Number(priceForm.costPrice) || 0,
                salePrice: defaultPrice,
                salePrices,
              };
            }
            return c;
          });
          await updateDoc(doc(db,"clothing",priceModal.itemId),{colors:newColors, priceBySize: bySize});
          const oldColor = item.colors[priceModal.ci];
          logAudit(user, {
            action: AUDIT_ACTIONS.PRICE,
            collection: "clothing",
            targetId: priceModal.itemId,
            targetLabel: priceModal.applyAll
              ? `${item.model} · ทุกสี (${item.colors.length})`
              : `${item.model} / ${col.colorName}`,
            before: { costPrice: oldColor?.costPrice, salePrices: oldColor?.salePrices },
            after:  { costPrice: Number(priceForm.costPrice)||0, salePrices },
            note: priceModal.applyAll ? "ใช้กับทุกสี" : null,
          });
          setPriceModal(null);
        };
        return (
          <Modal onClose={()=>setPriceModal(null)} w={580}>
            <MHead title="💰 ตั้งราคาตามไซส์" onClose={()=>setPriceModal(null)}/>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10,padding:"8px 12px",background:"rgba(59,91,139,0.06)",borderRadius:8,border:`1px solid ${T.border}`}}>
              <div style={{width:14,height:14,borderRadius:3,background:col.hex,border:"1px solid rgba(255,255,255,0.15)"}}/>
              <span style={{fontSize:13,color:T.text,fontWeight:600}}>{item.model} · {col.colorName}</span>
            </div>
            {/* ใช้กับทุกสี */}
            {(item.colors||[]).length>1&&(
              <label style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",marginBottom:14,background:priceModal.applyAll?"rgba(245,158,11,0.1)":"rgba(241,243,246,0.4)",border:`1px solid ${priceModal.applyAll?"rgba(245,158,11,0.4)":T.border}`,borderRadius:8,cursor:"pointer",transition:"all 0.15s"}}>
                <input type="checkbox" checked={!!priceModal.applyAll} onChange={e=>setPriceModal(p=>({...p,applyAll:e.target.checked}))} style={{cursor:"pointer",width:16,height:16}}/>
                <div style={{flex:1}}>
                  <div style={{fontSize:12,fontWeight:700,color:priceModal.applyAll?"#fbbf24":T.text}}>📋 ใช้ราคานี้กับทุกสีของรุ่น "{item.model}"</div>
                  <div style={{fontSize:10,color:T.muted,marginTop:2}}>จะเขียนทับราคาของทั้ง {(item.colors||[]).length} สี ({(item.colors||[]).map(c=>c.colorName).join(", ")})</div>
                </div>
              </label>
            )}
            <div style={{marginBottom:12}}>
              <label style={{fontSize:11,color:T.muted,display:"block",marginBottom:5,fontWeight:600}}>ราคาทุน (฿/ชิ้น)</label>
              <input type="number" value={priceForm.costPrice} onFocus={e=>e.target.select()} onChange={e=>setPriceForm(f=>({...f,costPrice:e.target.value}))} placeholder="0"
                style={{width:"100%",background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:8,padding:"8px 12px",fontFamily:"monospace",fontSize:13,outline:"none"}}/>
            </div>
            {/* 🎯 บางสินค้า (เช่น สนับแข้ง) S/M/L คนละราคา — ไม่ควรรวมเป็นกลุ่ม S-XL */}
            <label style={{display:"flex",alignItems:"center",gap:9,padding:"8px 12px",marginBottom:10,cursor:"pointer",borderRadius:8,
              background:bySize?"rgba(124,58,237,0.10)":"rgba(241,243,246,0.5)",border:`1px solid ${bySize?"#8b5cf6":T.border}`}}>
              <input type="checkbox" checked={bySize} style={{cursor:"pointer",width:16,height:16}}
                onChange={e=>{
                  const on=e.target.checked;
                  const rows=priceRowsForSizes(itemSizes,on);
                  const sp=col.salePrices||{};
                  // เติมค่าเริ่มต้นให้แถวใหม่ — ใช้ราคาที่เคยตั้งของไซส์นั้น/กลุ่มนั้น ไม่งั้นเป็นราคาขายหลัก
                  setPriceForm(f=>{
                    const next={...f};
                    rows.forEach(r=>{ if(next[r.key]==null||next[r.key]==="") next[r.key]=sp[r.key] ?? getPriceForSize(col,r.sizes[0]) ?? ""; });
                    return next;
                  });
                  setPriceModal(p=>({...p,bySize:on}));
                }}/>
              <div style={{flex:1}}>
                <div style={{fontSize:12,fontWeight:700,color:bySize?"#7c3aed":T.text}}>🎯 แยกราคาทีละไซส์</div>
                <div style={{fontSize:10,color:T.muted,marginTop:2}}>{bySize?`ตั้งได้ทีละไซส์ (${itemSizes.length} ไซส์)`:"ตอนนี้รวมเป็นกลุ่ม (6-12 / S-XL) — ติ๊กถ้า S, M, L คนละราคา"}</div>
              </div>
            </label>
            <div style={{fontSize:11,color:T.muted,marginBottom:8,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em"}}>ราคาขาย (฿/ชิ้น) ตามไซส์ของรุ่นนี้</div>
            <div className="scroll-col" style={{display:"flex",flexDirection:"column",gap:8,marginBottom:18,maxHeight:340,overflowY:"auto"}}>
              {priceRows.length===0
                ? <div style={{padding:"18px",textAlign:"center",color:T.muted,fontSize:12}}>รุ่นนี้ยังไม่มีไซส์ — เพิ่มไซส์ที่ปุ่ม ⚙️ สี/ไซส์ ก่อน</div>
                : priceRows.map(g=>(
                <div key={g.key} style={{display:"grid",gridTemplateColumns:"130px 1fr",alignItems:"center",gap:10,padding:"6px 10px",background:"rgba(241,243,246,0.5)",borderRadius:7,border:`1px solid ${T.border}`}}>
                  <div style={{display:"flex",flexDirection:"column",lineHeight:1.25}}>
                    <span style={{fontSize:12,color:T.accent,fontWeight:600}}>{g.label}</span>
                    {g.sizes.length>1&&<span style={{fontSize:9,color:T.muted,fontFamily:"monospace"}}>{g.sizes.join(", ")}</span>}
                  </div>
                  <input type="number" value={priceForm[g.key]??""} onFocus={e=>e.target.select()} onChange={e=>setPriceForm(f=>({...f,[g.key]:e.target.value}))} placeholder="0"
                    style={{width:"100%",background:"rgba(52,211,153,0.06)",border:"1px solid rgba(52,211,153,0.2)",color:"#34d399",borderRadius:6,padding:"6px 10px",fontFamily:"monospace",fontSize:13,fontWeight:600,outline:"none",textAlign:"right"}}/>
                </div>
              ))}
            </div>
            <div style={{display:"flex",gap:10}}>
              <BtnGhost onClick={()=>setPriceModal(null)} style={{flex:1}}>ยกเลิก</BtnGhost>
              <BtnPrimary onClick={handleSavePrices} style={{flex:1}}>💾 บันทึก</BtnPrimary>
            </div>
          </Modal>
        );
      })()}

      {/* ── MODAL: เพิ่มสีเสื้อผ้า (multi-select) ── */}
      {/* 🎨📏 จัดการรุ่น — สี + ไซส์ รวมในที่เดียว */}
      {sizeEditorItem&&(()=>{
        const item = clothingItems.find(i=>i.id===sizeEditorItem.id) || sizeEditorItem;
        const own = new Set((item.extraSizes||[]).map(s=>String(s)));
        const all = sizesFor(item);
        const closeMgr = ()=>{setSizeEditorItem(null);setNewItemSize("");setItemMgrTab("colors");};
        const cols = item.colors||[];
        return (
          <Modal onClose={closeMgr} w={600}>
            <MHead title={`⚙️ จัดการรุ่น — ${item.model}`} sub="สี และ ไซส์ ของรุ่นนี้" onClose={closeMgr}/>
            {/* แท็บ */}
            <div style={{display:"flex",gap:6,marginBottom:14}}>
              {[{k:"colors",l:`🎨 สี (${cols.length})`},{k:"sizes",l:`📏 ไซส์ (${all.length})`}].map(t=>(
                <button key={t.k} onClick={()=>setItemMgrTab(t.k)}
                  style={{flex:1,padding:"9px 14px",borderRadius:9,cursor:"pointer",fontSize:13,fontFamily:"'Sarabun',sans-serif",fontWeight:itemMgrTab===t.k?700:500,
                    border:`1px solid ${itemMgrTab===t.k?T.accent:T.border}`,background:itemMgrTab===t.k?"rgba(59,91,139,0.12)":"transparent",color:itemMgrTab===t.k?T.accent:T.sub}}>
                  {t.l}
                </button>
              ))}
            </div>

            {/* ── แท็บ สี ── */}
            {itemMgrTab==="colors"&&(<>
              <div style={{fontSize:12,color:T.sub,marginBottom:12,padding:"10px 12px",background:"rgba(59,91,139,0.06)",borderRadius:9,lineHeight:1.6}}>
                ลบสีได้เมื่อ<b>ไม่มีของเหลือในสต็อก</b>แล้วเท่านั้น — สีที่ยังมีของจะขึ้นรูปกุญแจ 🔒
              </div>
              {cols.length===0
                ? <div style={{padding:"24px",textAlign:"center",color:T.muted,fontSize:12,marginBottom:12}}>ยังไม่มีสีในรุ่นนี้</div>
                : <div className="scroll-col" style={{display:"flex",flexDirection:"column",gap:6,marginBottom:12,maxHeight:300,overflowY:"auto"}}>
                    {cols.map((c,ci)=>{
                      const qty = Object.values(c.stock||{}).reduce((s,q)=>s+(Number(q)||0),0);
                      const locked = qty>0;
                      return (
                        <div key={ci} style={{display:"flex",alignItems:"center",gap:10,padding:"7px 10px",borderRadius:8,border:`1px solid ${T.border}`,background:"rgba(241,243,246,0.5)"}}>
                          <span style={{width:18,height:18,borderRadius:5,background:c.hex||c.colorHex||"#999",border:"1px solid rgba(0,0,0,0.15)",flexShrink:0}}/>
                          <span style={{flex:1,fontSize:13,fontWeight:600,color:T.text}}>{c.colorName}</span>
                          <span style={{fontSize:11,color:qty>0?T.accent:T.muted,fontFamily:"monospace",fontWeight:700}}>{qty} ตัว</span>
                          {role?.canDelete&&(
                            <button onClick={()=>{
                              if(locked){alert(`ลบไม่ได้ — สี "${c.colorName}" ยังมีของอยู่ ${qty} ตัว\nตัดสต็อกให้เหลือ 0 ก่อน`);return;}
                              if(window.confirm(`ลบสี "${c.colorName}" ออกจากรุ่น ${item.model}?`)) handleDeleteClothingColor(item.id,ci);
                            }} title={locked?`ยังมีของ ${qty} ตัว`:`ลบสี ${c.colorName}`}
                              style={{border:"none",background:"transparent",color:locked?T.muted:T.red,cursor:locked?"not-allowed":"pointer",fontSize:14,padding:"0 2px",opacity:locked?0.45:1}}>
                              {locked?"🔒":"✕"}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>}
              {role?.canAdd&&<BtnPrimary onClick={()=>{setSizeEditorItem(null);setShowAddColor(item.id);}} style={{width:"100%"}}>➕ เพิ่มสีใหม่</BtnPrimary>}
            </>)}

            {/* ── แท็บ ไซส์ ── */}
            {itemMgrTab==="sizes"&&(<>
            <div style={{fontSize:12,color:T.sub,marginBottom:14,padding:"10px 12px",background:"rgba(59,91,139,0.06)",borderRadius:9,lineHeight:1.6}}>
              ไซส์ที่เพิ่มตรงนี้ใช้<b>เฉพาะรุ่นนี้</b> — จะขึ้นในตารางสต็อก รับ/จ่าย ใบสั่งของ และบิล<br/>
              ถ้าอยากให้ขึ้นทุกรุ่น ให้เพิ่มที่ <b>⚙️ ตั้งค่า → 📏 จัดการไซส์</b> แทน
            </div>
            <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:12}}>
              {all.map(sz=>{
                const mine = own.has(String(sz));
                const qty = (item.colors||[]).reduce((s,c)=>s+(Number(c.stock?.[sz])||0),0);
                const locked = qty > 0; // ยังมีของ → เอาออกไม่ได้
                return (
                  <span key={sz} style={{display:"inline-flex",alignItems:"center",gap:6,padding:"5px 8px 5px 12px",borderRadius:8,
                    border:`1px solid ${mine?"#7c3aed":T.border}`,background:mine?"rgba(124,58,237,0.10)":"rgba(241,243,246,0.7)",
                    color:mine?"#7c3aed":T.sub,fontFamily:"monospace",fontSize:12,fontWeight:mine?700:600}}>
                    {sz}<span style={{fontSize:9,opacity:0.7}}>({qty})</span>
                    <button onClick={()=>removeItemSize(item,sz)}
                      title={locked?`ยังมีของ ${qty} ตัว — ตัดสต็อกให้เหลือ 0 ก่อน`:(mine?"ลบไซส์นี้ทิ้ง":"ซ่อนไซส์นี้จากรุ่นนี้")}
                      style={{border:"none",background:"transparent",color:locked?T.muted:T.red,cursor:locked?"not-allowed":"pointer",fontSize:13,lineHeight:1,padding:0,opacity:locked?0.45:1}}>
                      {locked?"🔒":"✕"}
                    </button>
                  </span>
                );
              })}
            </div>
            {/* ไซส์ที่ซ่อนไว้ — กดเอากลับมาได้ */}
            {(item.hiddenSizes||[]).length>0&&(
              <div style={{marginBottom:14,padding:"8px 10px",background:"rgba(148,163,184,0.10)",border:`1px dashed ${T.border}`,borderRadius:9}}>
                <div style={{fontSize:10,color:T.muted,fontWeight:700,marginBottom:6}}>🚫 ซ่อนอยู่ในรุ่นนี้ — กดเพื่อเอากลับมา</div>
                <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                  {(item.hiddenSizes||[]).slice().sort(compareSizes).map(sz=>(
                    <button key={sz} onClick={()=>unhideItemSize(item,sz)} title={`เอาไซส์ ${sz} กลับมาใช้`}
                      style={{display:"inline-flex",alignItems:"center",gap:5,padding:"4px 10px",borderRadius:8,border:`1px solid ${T.border}`,background:"white",color:T.sub,fontFamily:"monospace",fontSize:12,fontWeight:600,cursor:"pointer"}}>
                      {sz} <span style={{color:"#16a34a",fontSize:11}}>↩</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div style={{display:"flex",gap:8}}>
              <input value={newItemSize} onChange={e=>setNewItemSize(e.target.value)}
                onKeyDown={e=>e.key==="Enter"&&addItemSize(item,newItemSize)}
                placeholder='พิมพ์ไซส์ เช่น 6XL, ฟรีไซส์, รอบอก 40'
                style={{flex:1,background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:9,padding:"9px 14px",fontFamily:"'Sarabun',sans-serif",fontSize:13,outline:"none"}}/>
              <BtnPrimary onClick={()=>addItemSize(item,newItemSize)} disabled={!newItemSize.trim()}>➕ เพิ่ม</BtnPrimary>
            </div>
            </>)}
          </Modal>
        );
      })()}

      {showAddColor&&(
        <Modal onClose={()=>{setShowAddColor(null);setPickedColors([]);setCustomColorName("");setNewColorHex("#ffffff");}} w={520}>
          <MHead title="🎨 เพิ่มสีใหม่" sub="เลือกได้หลายสีพร้อมกัน" onClose={()=>{setShowAddColor(null);setPickedColors([]);setCustomColorName("");setNewColorHex("#ffffff");}}/>
          <div style={{fontSize:11,color:T.muted,marginBottom:10,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em"}}>เลือกสีที่มี (กดเพื่อเลือก/ยกเลิก)</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:14}}>
            {PRESET_COLORS.map(c=>{
              const item=clothingItems.find(i=>i.id===showAddColor);
              const already=(item?.colors||[]).some(cl=>cl.colorName===c.name);
              const picked = pickedColors.some(p => p.colorName === c.name);
              return (
                <div key={c.name} onClick={()=>!already && togglePickedColor({colorName:c.name,hex:c.hex})}
                  style={{display:"flex",alignItems:"center",gap:6,padding:"6px 12px",borderRadius:20,border:`1px solid ${already?"rgba(203,210,217,0.5)":picked?T.accent:"rgba(59,91,139,0.25)"}`,cursor:already?"not-allowed":"pointer",background:already?"rgba(203,210,217,0.3)":picked?"rgba(59,91,139,0.22)":"rgba(59,91,139,0.08)",opacity:already?0.4:1,transition:"all 0.15s",boxShadow:picked?`0 0 0 2px ${T.accent}30`:"none"}}>
                  <div style={{width:12,height:12,borderRadius:3,background:c.hex,border:"1px solid rgba(0,0,0,0.15)"}}/>
                  <span style={{fontSize:12,color:already?T.muted:T.text,fontFamily:"'Sarabun',sans-serif",fontWeight:picked?700:400}}>{c.name}</span>
                  {already && <span style={{fontSize:9,color:T.muted}}>✓ มีแล้ว</span>}
                  {picked && !already && <span style={{fontSize:11,color:T.accent,fontWeight:800}}>✓</span>}
                </div>
              );
            })}
          </div>

          {/* Custom color → วงล้อสี + เพิ่มเข้า buffer */}
          <div style={{padding:14,background:"#f8fafc",borderRadius:10,border:`1px solid ${T.border}`,marginBottom:14}}>
            <div style={{fontSize:11,color:T.muted,marginBottom:10,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em"}}>🎨 หรือเพิ่มสีเอง — เลื่อนวงล้อ / ใส่รหัส HEX</div>
            <div style={{display:"flex",gap:14,alignItems:"flex-start",flexWrap:"wrap"}}>
              {/* วงล้อสี (lazy load) */}
              <div style={{flexShrink:0}}>
                <Suspense fallback={<div style={{width:180,height:180,borderRadius:8,background:"#f1f5f9",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,color:T.muted}}>⏳ กำลังโหลดวงล้อสี...</div>}>
                  <HexColorPicker color={newColorHex} onChange={setNewColorHex} style={{width:180,height:180}}/>
                </Suspense>
              </div>
              {/* Preview + inputs */}
              <div style={{flex:"1 1 200px",display:"flex",flexDirection:"column",gap:8}}>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <div style={{width:52,height:52,borderRadius:10,background:newColorHex,border:"2px solid rgba(0,0,0,0.15)",boxShadow:"inset 0 2px 4px rgba(0,0,0,0.1)"}}/>
                  <div style={{flex:1}}>
                    <div style={{fontSize:10,color:T.muted,fontWeight:600,marginBottom:3}}>HEX</div>
                    <input value={newColorHex} onChange={e=>{const v=e.target.value.trim(); if(/^#?[0-9a-fA-F]{0,6}$/.test(v)) setNewColorHex(v.startsWith("#")?v:"#"+v);}}
                      style={{width:"100%",background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:8,padding:"7px 10px",fontFamily:"monospace",fontSize:13,fontWeight:700,outline:"none",textTransform:"uppercase"}}/>
                  </div>
                </div>
                <div>
                  <div style={{fontSize:10,color:T.muted,fontWeight:600,marginBottom:3}}>ชื่อสี</div>
                  <input value={customColorName} onChange={e=>setCustomColorName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addPickedFromCustom()} placeholder="เช่น เทาอ่อน, กรมท่า..."
                    style={{width:"100%",boxSizing:"border-box",background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:8,padding:"8px 12px",fontFamily:"'Sarabun',sans-serif",fontSize:13,outline:"none"}}/>
                </div>
                <BtnPrimary onClick={addPickedFromCustom} disabled={!customColorName.trim()} style={{width:"100%"}}>➕ เพิ่มในรายการ</BtnPrimary>
              </div>
            </div>
          </div>

          {/* Selected colors preview */}
          {pickedColors.length>0 && (
            <div style={{padding:"10px 12px",background:"rgba(22,163,74,0.06)",border:"1px solid rgba(22,163,74,0.25)",borderRadius:10,marginBottom:12}}>
              <div style={{fontSize:11,color:"#15803d",fontWeight:700,marginBottom:6}}>✓ เลือกไว้แล้ว {pickedColors.length} สี:</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                {pickedColors.map(p => (
                  <div key={p.colorName} style={{display:"flex",alignItems:"center",gap:5,padding:"3px 9px",background:"white",border:`1px solid ${T.border}`,borderRadius:14,fontSize:11}}>
                    <div style={{width:10,height:10,borderRadius:2,background:p.hex,border:"1px solid rgba(0,0,0,0.15)"}}/>
                    <span>{p.colorName}</span>
                    <button onClick={()=>togglePickedColor(p)} style={{background:"none",border:"none",cursor:"pointer",color:T.red,fontWeight:700,padding:0,marginLeft:2}}>×</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{display:"flex",gap:10}}>
            <BtnGhost onClick={()=>{setShowAddColor(null);setPickedColors([]);setCustomColorName("");setNewColorHex("#ffffff");}} style={{flex:1}}>ปิด</BtnGhost>
            <BtnPrimary onClick={handleAddMultipleColors} disabled={pickedColors.length===0} style={{flex:2}}>
              {pickedColors.length===0 ? "เลือกสีก่อน" : `✅ เพิ่ม ${pickedColors.length} สี`}
            </BtnPrimary>
          </div>
        </Modal>
      )}

      {/* ── MODAL: รับ/จ่ายเสื้อผ้า ── */}
      {clothingTxModal&&(
        <Modal onClose={()=>setClothingTxModal(null)} w={700}>
          <MHead title={clothingTxType==="รับ"?"⬇️ รับเสื้อผ้าเข้าคลัง":"⬆️ จ่ายเสื้อผ้าออกคลัง"} onClose={()=>{setClothingTxModal(null);setClothingTxExtraColors(new Set());}} color={clothingTxType==="รับ"?T.green:T.red}/>
          {clothingTxSuccess&&<Toast msg="บันทึกสำเร็จ! ตัดสต็อกแล้ว"/>}
          <div style={{padding:14,background:"rgba(59,91,139,0.06)",border:`1px solid rgba(59,91,139,0.2)`,borderRadius:10,marginBottom:12}}>
            <div style={{fontSize:12,color:T.accent,fontWeight:600}}>{clothingTxModal.item.model}</div>
            <div style={{fontSize:11,color:T.sub,marginTop:2,display:"flex",alignItems:"center",gap:8}}>
              <div style={{width:10,height:10,borderRadius:2,background:(clothingTxModal.item.colors[clothingTxModal.colorIdx]||{}).hex}}/>
              {(clothingTxModal.item.colors[clothingTxModal.colorIdx]||{}).colorName}
              {clothingTxExtraColors.size > 0 && <span style={{marginLeft:6,fontSize:11,color:T.accent,fontWeight:700}}>+ อีก {clothingTxExtraColors.size} สี</span>}
            </div>
          </div>
          {/* 🔗 เลือกสีเพิ่ม — ทำ tx เดียวกันกับหลายสีพร้อมกัน */}
          {(clothingTxModal.item.colors||[]).length > 1 && (
            <div style={{marginBottom:14,padding:"8px 12px",background:"#fef3c7",border:"1px dashed #fbbf24",borderRadius:9}}>
              <div style={{fontSize:11,fontWeight:700,color:T.amber,marginBottom:6}}>🔗 ทำพร้อมกันกับสีอื่น (คลิกติ๊กเพื่อเพิ่ม)</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                {(clothingTxModal.item.colors||[]).map((c,ci)=>{
                  if (ci === clothingTxModal.colorIdx) return null; // สีปัจจุบันไม่ต้องแสดง (ต้องเลือกอยู่แล้ว)
                  const on = clothingTxExtraColors.has(ci);
                  return (
                    <button key={ci} onClick={()=>setClothingTxExtraColors(s=>{const n=new Set(s); if(on)n.delete(ci);else n.add(ci); return n;})}
                      style={{padding:"4px 10px",borderRadius:7,border:`1px solid ${on?"#d97706":"rgba(0,0,0,0.15)"}`,background:on?"#fef3c7":"white",cursor:"pointer",fontSize:11,fontWeight:on?700:500,color:T.text,display:"inline-flex",alignItems:"center",gap:5}}>
                      <span style={{width:9,height:9,borderRadius:2,background:c.hex,border:"1px solid rgba(0,0,0,0.15)"}}/>
                      {c.colorName}
                      {on && <span style={{fontSize:10,color:T.amber}}>✓</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            <div>
              <label style={{fontSize:11,color:T.muted,display:"block",marginBottom:6,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em"}}>เลือกไซส์ * <span style={{textTransform:"none",fontWeight:400,color:T.muted}}>(กดเพื่อเลือก/ยกเลิก — เลือกได้หลายไซส์)</span></label>
              <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                {sizesFor(clothingTxModal.item).map(sz=>{
                  const stock=((clothingTxModal.item.colors[clothingTxModal.colorIdx]||{}).stock||{})[sz]||0;
                  const selected=clothingTxSizeQty[sz]!==undefined;
                  return (
                    <button key={sz} onClick={()=>setClothingTxSizeQty(p=>{const n={...p}; if(selected){delete n[sz];}else{n[sz]="";} return n;})}
                      style={{padding:"8px 14px",borderRadius:8,border:`2px solid ${selected?"#3b5b8b":"#cbd2d9"}`,background:selected?"#3b5b8b":"#ffffff",color:selected?"#ffffff":"#1f2a44",cursor:"pointer",fontSize:13,fontFamily:"'Sarabun',sans-serif",fontWeight:selected?700:600,transition:"all 0.15s",minWidth:56,textAlign:"center"}}>
                      <div style={{fontWeight:800,fontSize:14}}>{sz}</div>
                      <div style={{fontSize:10,fontWeight:700,color:selected?"#bfdbfe":stock===0?"#9aa5b1":stock<5?"#d97706":"#0891b2",fontFamily:"monospace"}}>{stock}</div>
                    </button>
                  );
                })}
              </div>
            </div>
            {/* จำนวนแยกตามไซส์ที่เลือก */}
            {(() => {
              const chosen = sizesFor(clothingTxModal.item).filter(sz => clothingTxSizeQty[sz] !== undefined);
              if (chosen.length === 0) return (
                <div style={{fontSize:12,color:T.muted,padding:"10px 0"}}>↑ เลือกไซส์ที่ต้องการก่อน แล้วใส่จำนวนแต่ละไซส์</div>
              );
              const totalQty = chosen.reduce((s,sz)=>s+(Number(clothingTxSizeQty[sz])||0),0);
              return (
                <div>
                  <label style={{fontSize:11,color:T.muted,display:"block",marginBottom:6,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em"}}>จำนวนแต่ละไซส์ *</label>
                  <div style={{display:"flex",flexDirection:"column",gap:8}}>
                    {chosen.map(sz=>{
                      const stock=((clothingTxModal.item.colors[clothingTxModal.colorIdx]||{}).stock||{})[sz]||0;
                      const q=Number(clothingTxSizeQty[sz])||0;
                      const over=clothingTxType==="จ่าย"&&q>stock;
                      return (
                        <div key={sz} style={{display:"flex",alignItems:"center",gap:10}}>
                          <div style={{width:48,fontWeight:700,color:T.accent,textAlign:"center",background:"rgba(59,91,139,0.1)",borderRadius:8,padding:"6px 0",fontSize:13}}>{sz}</div>
                          <input type="number" placeholder="0" value={clothingTxSizeQty[sz]} autoFocus={chosen[chosen.length-1]===sz}
                            onChange={e=>setClothingTxSizeQty(p=>({...p,[sz]:e.target.value}))}
                            style={{flex:1,background:T.input,border:`1px solid ${over?"#ef4444":T.inputBorder}`,color:T.text,borderRadius:9,padding:"9px 14px",fontFamily:"'Sarabun',sans-serif",fontSize:13,outline:"none"}}/>
                          <div style={{fontSize:11,color:over?"#ef4444":T.sub,whiteSpace:"nowrap",width:90}}>{over?"⚠️ เกินสต็อก":`สต็อก ${stock}`}</div>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{marginTop:8,fontSize:13,color:T.text,fontWeight:700,textAlign:"right"}}>รวม {totalQty.toLocaleString("th-TH")} ชิ้น</div>
                </div>
              );
            })()}
            <div>
              <label style={{fontSize:11,color:T.muted,display:"block",marginBottom:6,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em"}}>หมายเหตุ</label>
              <input placeholder="ระบุหมายเหตุ (ถ้ามี)" value={clothingTxNote} onChange={e=>setClothingTxNote(e.target.value)}
                style={{width:"100%",background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:9,padding:"9px 14px",fontFamily:"'Sarabun',sans-serif",fontSize:13,outline:"none"}}/>
            </div>
            <div style={{display:"flex",gap:10}}>
              <BtnGhost onClick={()=>setClothingTxModal(null)} disabled={txSaving} style={{flex:1}}>ยกเลิก</BtnGhost>
              {(() => {
                const totalQty = Object.values(clothingTxSizeQty).reduce((s,q)=>s+(Number(q)||0),0);
                const nColors = 1 + clothingTxExtraColors.size;
                const grand = totalQty * nColors;
                const disabled = txSaving || totalQty <= 0;
                const suffix = totalQty > 0 ? ` (${grand}${nColors > 1 ? ` = ${totalQty}×${nColors} สี` : ""})` : "";
                return clothingTxType==="รับ"
                  ?<BtnSuccess onClick={handleClothingTx} disabled={disabled} style={{flex:1}}>{txSaving?"⏳ กำลังบันทึก...":`✅ ยืนยันรับสินค้า${suffix}`}</BtnSuccess>
                  :<BtnDanger onClick={handleClothingTx} disabled={disabled} style={{flex:1}}>{txSaving?"⏳ กำลังบันทึก...":`✅ ยืนยันจ่ายสินค้า${suffix}`}</BtnDanger>;
              })()}
            </div>
          </div>
        </Modal>
      )}

      {/* ── MODAL: ยืนยันลบ User ── */}
      {/* ── MODAL: ตั้งค่าเมนูที่ user เห็น ── */}
      {tabAccessModal&&(()=>{
        const isBulk = tabAccessModal.__bulk;
        // bulk = filter ตาม userRoleFilter ปัจจุบัน (ยกเว้น admin)
        const targets = isBulk
          ? (userRoleFilter==="ทั้งหมด"
              ? users.filter(x=>x.role!=="admin")
              : userRoleFilter.startsWith("pos:")
                ? users.filter(x=>x.position===userRoleFilter.slice(4) && x.role!=="admin")
                : users.filter(x=>x.role===userRoleFilter && x.role!=="admin"))
          : [users.find(x=>x.id===tabAccessModal.id) || tabAccessModal];
        const u = targets[0] || tabAccessModal;
        const current = isBulk ? (tabAccessModal.__pending || allNavItems.map(it=>it.id)) : (u.allowedTabs || allNavItems.map(it=>it.id));
        const applyToAll = async (next) => {
          for (const t of targets) {
            await setDoc(doc(db,"users",String(t.id)),{...t, allowedTabs: next});
          }
        };
        const toggle = async (id) => {
          const next = current.includes(id) ? current.filter(x=>x!==id) : [...current,id];
          if (isBulk) setTabAccessModal(m=>({...m,__pending:next}));
          else await setDoc(doc(db,"users",String(u.id)),{...u, allowedTabs: next});
        };
        const setAll = async (all) => {
          const next = all ? allNavItems.map(it=>it.id) : [];
          if (isBulk) setTabAccessModal(m=>({...m,__pending:next}));
          else await setDoc(doc(db,"users",String(u.id)),{...u, allowedTabs: next});
        };
        return (
          <Modal onClose={()=>setTabAccessModal(null)} w={520}>
            <MHead title={isBulk?`⚙️ ตั้งสิทธิ์เมนู (Bulk)`:`⚙️ สิทธิ์การเข้าถึงเมนู`} sub={isBulk?`จะ apply กับ ${targets.length} คน: ${targets.map(t=>t.name).join(", ")}`:`${u.name} · @${u.username}`} onClose={()=>setTabAccessModal(null)} color={isBulk?"#c084fc":T.accent}/>
            <div style={{display:"flex",gap:8,marginBottom:12}}>
              <button onClick={()=>setAll(true)} style={{flex:1,padding:"7px",borderRadius:7,border:`1px solid ${T.border}`,background:"rgba(52,211,153,0.08)",color:"#34d399",cursor:"pointer",fontSize:11,fontFamily:"'Sarabun',sans-serif",fontWeight:600}}>✓ เปิดทั้งหมด</button>
              <button onClick={()=>setAll(false)} style={{flex:1,padding:"7px",borderRadius:7,border:`1px solid ${T.border}`,background:"rgba(248,113,113,0.08)",color:"#f87171",cursor:"pointer",fontSize:11,fontFamily:"'Sarabun',sans-serif",fontWeight:600}}>✕ ปิดทั้งหมด</button>
            </div>
            <div className="scroll-col" style={{display:"flex",flexDirection:"column",gap:6,marginBottom:14,maxHeight:"50vh",overflowY:"auto"}}>
              {allNavItems.map(it=>{
                const on=current.includes(it.id);
                return (
                  <label key={it.id} onClick={()=>toggle(it.id)} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 14px",borderRadius:8,border:`1px solid ${on?"rgba(59,91,139,0.4)":T.border}`,background:on?"rgba(59,91,139,0.08)":"transparent",cursor:"pointer",transition:"all 0.15s"}}>
                    <input type="checkbox" checked={on} readOnly style={{cursor:"pointer",width:16,height:16}}/>
                    <span style={{fontSize:16}}>{it.icon}</span>
                    <span style={{fontSize:13,color:on?T.text:T.sub,fontWeight:on?600:400,flex:1}}>{it.label}</span>
                    <code style={{fontSize:10,color:T.muted,fontFamily:"monospace"}}>{it.id}</code>
                  </label>
                );
              })}
            </div>
            <div style={{padding:"8px 12px",background:"rgba(245,158,11,0.08)",border:"1px solid rgba(245,158,11,0.2)",borderRadius:7,fontSize:11,color:T.amber,marginBottom:12}}>
              {isBulk
                ? <>⚠️ กด <b>"ใช้กับ {targets.length} คน"</b> เพื่อ apply พร้อมกัน · จะทับค่าเดิมของทุกคน</>
                : "💡 การเปลี่ยนแปลงมีผลทันที — user จะเห็น/ไม่เห็นเมนูเมื่อ refresh"}
            </div>
            {isBulk
              ? <div style={{display:"flex",gap:10}}>
                  <BtnGhost onClick={()=>setTabAccessModal(null)} style={{flex:1}}>ยกเลิก</BtnGhost>
                  <button onClick={async()=>{await applyToAll(current);setTabAccessModal(null);}} disabled={targets.length===0} style={{flex:2,padding:"10px",borderRadius:9,border:"none",cursor:targets.length===0?"not-allowed":"pointer",background:targets.length===0?"#475569":"linear-gradient(135deg,#a855f7,#7c3aed)",color:"white",fontSize:13,fontWeight:700,fontFamily:"'Sarabun',sans-serif",opacity:targets.length===0?0.5:1}}>
                    ✓ ใช้กับ {targets.length} คน
                  </button>
                </div>
              : <BtnPrimary onClick={()=>setTabAccessModal(null)} style={{width:"100%"}}>เสร็จสิ้น</BtnPrimary>
            }
          </Modal>
        );
      })()}

      {/* ── MODAL: ยืนยันตัวตน (re-auth) ── */}
      {/* ── Print Barcode Stickers Modal ── */}
      {showBarcodePrint && (
        <BarcodePrintModal
          products={products}
          clothingItems={clothingItems}
          onClose={() => setShowBarcodePrint(false)}
          printElementById={printElementById}
        />
      )}

      {/* ── Camera Barcode Scanner Modal ── */}
      {showScanner && (
        <BarcodeScanner
          onScan={(code) => {
            const c = String(code).trim();
            setBarcodeSearch(c);
            setShowScanner(false);
            // auto-search ใช้ helper เดียวกัน
            setTimeout(() => handleBarcodeSearch(c), 100);
          }}
          onClose={() => setShowScanner(false)}
        />
      )}

      {/* ── Scanner สำหรับ Tx modal — สแกนเพื่อเลือกสินค้า ── */}
      {showTxScanner && (
        <BarcodeScanner
          title={`📸 สแกน${txType==="รับ"?"รับสินค้า":"จ่ายสินค้า"}`}
          onScan={(code) => {
            const c = String(code).trim();
            const norm = (s) => String(s||"").trim().toLowerCase().replace(/\s+/g,"");
            const cNorm = norm(c);
            const found = products.find(p => norm(p.barcode)===cNorm || norm(p.code)===cNorm);
            setShowTxScanner(false);
            if (found) {
              const pid = String(found.id);
              setTxRows(prev => {
                // ถ้ามีแถวที่เลือกสินค้านี้แล้ว → ข้าม
                if (prev.some(r => r.productId === pid)) return prev;
                // ถ้าแถวสุดท้ายว่าง → ใส่แทน, ไม่งั้น append แถวใหม่
                const last = prev[prev.length-1];
                if (last && !last.productId) {
                  return prev.map((r,i) => i === prev.length-1 ? { productId: pid, qty: "1" } : r);
                }
                return [...prev, { productId: pid, qty: "1" }];
              });
            } else {
              alert(`❌ ไม่พบสินค้าในระบบ\nรหัสที่อ่าน: "${c}"\n\nลองพิมพ์มือ หรือเลือกจาก dropdown`);
            }
          }}
          onClose={() => setShowTxScanner(false)}
        />
      )}

      {authPrompt&&(
        <Modal onClose={()=>{setAuthPrompt(null);setAuthInput("");setAuthErr("");}} w={420}>
          <div style={{textAlign:"center",marginBottom:18}}>
            <div style={{fontSize:42,marginBottom:8}}>🔐</div>
            <div style={{fontSize:15,fontWeight:700,color:T.text,marginBottom:4}}>ยืนยันตัวตน</div>
            <div style={{fontSize:12,color:T.muted}}>{authPrompt.label}</div>
          </div>
          <div style={{marginBottom:14}}>
            <label style={{fontSize:11,color:T.muted,display:"block",marginBottom:6,fontWeight:600}}>รหัสผ่านของคุณ (@{user.username})</label>
            <input type="password" autoFocus value={authInput}
              onChange={e=>{setAuthInput(e.target.value);setAuthErr("");}}
              onKeyDown={e=>e.key==="Enter"&&handleAuthConfirm()}
              placeholder="ใส่รหัสผ่าน admin"
              style={{width:"100%",background:T.input,border:`1px solid ${authErr?T.red:T.inputBorder}`,color:T.text,borderRadius:9,padding:"10px 14px",fontFamily:"monospace",fontSize:14,outline:"none",letterSpacing:2}}/>
            {authErr&&<div style={{fontSize:11,color:T.red,marginTop:6}}>❌ {authErr}</div>}
          </div>
          <div style={{padding:"8px 12px",background:"rgba(59,91,139,0.08)",border:"1px solid rgba(59,91,139,0.2)",borderRadius:7,fontSize:11,color:T.accent,marginBottom:14}}>
            💡 ยืนยันแล้วจะดูรหัสได้ <b>5 นาที</b> ไม่ต้องใส่ซ้ำ
          </div>
          <div style={{display:"flex",gap:10}}>
            <BtnGhost onClick={()=>{setAuthPrompt(null);setAuthInput("");setAuthErr("");}} style={{flex:1}}>ยกเลิก</BtnGhost>
            <BtnPrimary onClick={handleAuthConfirm} disabled={!authInput} style={{flex:1}}>✓ ยืนยัน</BtnPrimary>
          </div>
        </Modal>
      )}

      {showDeleteUserConfirm&&(
        <Modal onClose={()=>setShowDeleteUserConfirm(null)} w={540}>
          <div style={{textAlign:"center"}}>
            <div style={{fontSize:42,marginBottom:12}}>{showDeleteUserConfirm.avatar}</div>
            <div style={{fontSize:15,fontWeight:700,color:T.text,marginBottom:6}}>ลบบัญชีผู้ใช้?</div>
            <div style={{fontSize:13,color:T.sub,marginBottom:4}}>{showDeleteUserConfirm.name}</div>
            <div style={{fontSize:12,color:T.muted,marginBottom:6}}>@{showDeleteUserConfirm.username}</div>
            <div style={{marginBottom:20}}>
              <Badge bg={`${ROLES[showDeleteUserConfirm.role].color}15`} color={ROLES[showDeleteUserConfirm.role].color}>{rLabel(showDeleteUserConfirm.role)}</Badge>
            </div>
            <div style={{padding:10,background:"#fef2f2",borderRadius:8,fontSize:12,color:T.red,marginBottom:20}}>
              ⚠️ บัญชีนี้จะถูกลบออกจากระบบถาวร
            </div>
            <div style={{display:"flex",gap:10}}>
              <BtnGhost onClick={()=>setShowDeleteUserConfirm(null)} style={{flex:1}}>ยกเลิก</BtnGhost>
              <BtnDanger onClick={()=>handleDeleteUser(showDeleteUserConfirm)} style={{flex:1}}>🗑 ลบบัญชี</BtnDanger>
            </div>
          </div>
        </Modal>
      )}

      </Suspense>
    </div>
  );
}


