import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { db, authReady } from "./firebase";
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, setDoc, getDocs, writeBatch, serverTimestamp, query, orderBy } from "firebase/firestore";
import { T, SIZES, SHOE_SIZES, getSizesFor, mergeSizes, PRESET_COLORS, MASTER_KEY, SIZE_GROUPS, getPriceForSize, compareSizes, splitSizesIntoRows } from "./theme";
import { INIT_USERS, ROLES, INIT_CATS } from "./constants";
import { BarcodeDisplay, Modal, MHead, Toast, Input, BtnPrimary, BtnSuccess, BtnDanger, BtnGhost, Badge, CardBox } from "./components/ui";
import LoginPage, { CompanyEditor } from "./components/LoginPage";
import { useFirestore } from "./hooks/useFirestore";
import ReportsTab from "./tabs/ReportsTab";
import SuppliersTab from "./tabs/SuppliersTab";
import StatementTab from "./tabs/StatementTab";
import AuditLogTab from "./tabs/AuditLogTab";
import StocktakeTab from "./tabs/StocktakeTab";
import EmployeeTab from "./tabs/EmployeeTab";
import TaxDocsTab from "./tabs/TaxDocsTab";
import CatalogInboxTab from "./tabs/CatalogInboxTab";
import PayrollTab from "./tabs/PayrollTab";
import ProductionHistoryTab from "./tabs/ProductionHistoryTab";
import BarcodePrintModal from "./components/BarcodePrintModal";
import ImportCustomersModal from "./components/ImportCustomersModal";
import BackupRestore, { shouldRemindBackup, getLastBackupDate } from "./components/BackupRestore";
import BarcodeScanner from "./components/BarcodeScanner";
import InstallPWA from "./components/InstallPWA";
import CustomerProfile from "./components/CustomerProfile";
import ProductionTab from "./tabs/ProductionTab";
import { logAudit, AUDIT_ACTIONS } from "./utils/audit";
import { compressImage } from "./utils/imageCompress";
import { REGIONS, detectRegion, detectProvince, regionMeta } from "./utils/thaiRegion";
import { generateDocNo } from "./utils/docNumber";
import html2pdf from "html2pdf.js";
// ── MAIN APP ───────────────────────────────────────────────────
export default function App() {
  // ── รอ Firebase Anonymous Auth พร้อมก่อน — เพื่อให้ Security Rules ผ่าน ──
  const [authChecked, setAuthChecked] = useState(false);
  useEffect(() => {
    authReady.then(() => setAuthChecked(true));
  }, []);

  const { users, setUsers, products, setProducts, transactions, categories, setCategories, clothingItems, orders, customers, invoices, companyInfo, setCompanyInfo, roleLabels, auditLogs, loading, setLoading, suppliers, statements, productionOrders, boms, customOrders, employees, taxDocs, catalogOrders, attendance, payrollRuns, customSizes, usersLoaded } = useFirestore();
  // 📏 ไซส์ที่ใช้จริง = มาตรฐาน + ที่เพิ่มเอง
  const apparelSizes = useMemo(() => mergeSizes(SIZES, customSizes?.apparel), [customSizes]);
  const shoeSizes = useMemo(() => mergeSizes(SHOE_SIZES, customSizes?.shoe), [customSizes]);
  const sizesFor = useCallback((item) => (item && item.sizeType === "shoe") ? shoeSizes : apparelSizes, [apparelSizes, shoeSizes]);
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
  const [activeTab, setActiveTab] = useState("dashboard");
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
  const [collapsedInvoiceDates, setCollapsedInvoiceDates] = useState({});
  const [selectedInvoices, setSelectedInvoices] = useState(new Set()); // 🔗 เลือกบิลเพื่อรวม
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [showImportCustomers, setShowImportCustomers] = useState(false);
  const [showPrintOrder, setShowPrintOrder] = useState(null);
  const [orderForm, setOrderForm] = useState({
    customerId: "", customerName: "", customerPhone: "", customerAddress: "",
    note: "", items: []
  });
  const [newCustomerForm, setNewCustomerForm] = useState({ name:"", phone:"", address:"" });
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerRegion, setCustomerRegion] = useState("ทั้งหมด"); // filter ภาค
  const [orderItemForm, setOrderItemForm] = useState({ clothingId:"", colorIdx:"", size:"", qty:"" });


  const [showAddClothing, setShowAddClothing] = useState(false);
  const [showAddColor, setShowAddColor] = useState(null);
  const [pickedColors, setPickedColors] = useState([]); // multi-select buffer: [{colorName, hex}]
  const [priceModal, setPriceModal] = useState(null); // {itemId, ci}
  const [priceForm, setPriceForm] = useState({ costPrice:"", kids:"", reg:"", "2XL":"", "3XL":"", "4XL":"", "5XL":"" });
  const [newModel, setNewModel] = useState("");
  const [customColorName, setCustomColorName] = useState("");
  const [newColorCost, setNewColorCost] = useState("");
  const [newColorSale, setNewColorSale] = useState("");
  const [newColorHex, setNewColorHex] = useState("#ffffff");
  const [editingStock, setEditingStock] = useState(null);
  const [collapsedItems, setCollapsedItems] = useState({});
  const toggleCollapse = (id) => setCollapsedItems(prev => ({...prev, [id]: !prev[id]}));
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
  const [showHistoryModal, setShowHistoryModal] = useState(null);
  const [showCatModal, setShowCatModal] = useState(false);
  const [showImgModal, setShowImgModal] = useState(null);
  const [showSettings, setShowSettings] = useState(false);

  // ── Invoice & Company state ───────────────────────────────────
  const [showNewInvoice, setShowNewInvoice] = useState(false);
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
  const [invoiceForm, setInvoiceForm] = useState({
    customerId:"", customerName:"", customerPhone:"", customerAddress:"", customerTaxId:"",
    items:[], note:"", dueDate:"", vatRate:7,
    discount:0, discountType:"amount", // ส่วนลดท้ายบิล (amount หรือ percent)
    showCompanyTaxId: true, // แสดงเลขผู้เสียภาษีของบริษัทในบิลหรือไม่
    useShipping: false, shippingFee: 0, // ค่าจัดส่ง (เลือกเปิด/ปิด)
  });
  const [invoiceItemForm, setInvoiceItemForm] = useState({ description:"", qty:"", unitPrice:"", unit:"ชิ้น" });
  const [addItemCollapsed, setAddItemCollapsed] = useState(false); // พับฟอร์มเพิ่มรายการ
  const [txType, setTxType] = useState("รับ");

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
  const [inventoryTab, setInventoryTab] = useState("general"); // "general" | "clothing"
  const [clothingTxModal, setClothingTxModal] = useState(null); // {item, colorIdx, size}
  const [clothingTxType, setClothingTxType] = useState("รับ");
  const [clothingTxQty, setClothingTxQty] = useState("");
  const [clothingTxSizeQty, setClothingTxSizeQty] = useState({}); // {S:"10", M:"5"} จ่าย/รับหลายไซส์พร้อมกัน
  const [mixModal, setMixModal] = useState(null); // 🧺 {item} ขายคละสีคละไซส์
  const [mixRows, setMixRows] = useState([]); // [{colorIdx, size, qty}]
  const [mixNote, setMixNote] = useState("");
  const [showSizeManager, setShowSizeManager] = useState(false); // 📏 modal จัดการไซส์
  const [showSalesToday, setShowSalesToday] = useState(false); // 📊 modal ขายวันนี้
  const [salesDate, setSalesDate] = useState(() => new Date().toISOString().slice(0,10)); // yyyy-mm-dd
  const [salesCell, setSalesCell] = useState(null); // {model,color,size,prefix} ดู/ลบรายการจ่ายของช่องนั้น
  const [collapsedSalesModels, setCollapsedSalesModels] = useState({}); // ย่อรุ่นใน "ขายวันนี้"
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
    const r = new FileReader();
    r.onload = async ev => {
      await updateDoc(doc(db, "products", uploadingForProduct), { image: ev.target.result, lastUpdate: now() });
      setUploadingForProduct(null);
    };
    r.readAsDataURL(file);
    e.target.value = "";
  };
  const barcodeInputRef = useRef(null);

  // ผสาน permission ของ role กับ override ต่อคน (user.permissions)
  const role = user ? { ...ROLES[user.role], ...(user.permissions||{}) } : null;

  const now = () => {
    const d = new Date();
    return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
  };


  // 🏷️ Tab-level filter — รวมหลาย category เป็น 1 tab ได้ (เช่น sports = รองเท้า+อุปกรณ์กีฬา)
  const TAB_CATEGORIES = { sports: ["รองเท้า","อุปกรณ์กีฬา"] };
  const filtered = products.filter(p => {
    const tabCats = TAB_CATEGORIES[inventoryTab];
    if (tabCats && !tabCats.includes(p.category)) return false;
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
      setNewProduct(p => ({...p, image: dataUrl}));
    } catch (err) {
      console.error("[handleImageUpload] compress failed:", err);
      alert("โหลดรูปไม่สำเร็จ: " + (err?.message || err));
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

  // 🧺 เปิด modal ขายคละ
  const openMix = (item) => {
    setMixModal({ item });
    setMixRows([{ colorIdx: 0, size: "", qty: "" }]);
    setMixNote("");
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
      setMixModal(null); setMixRows([]); setMixNote("");
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
    const newColors = item.colors.map((c,i) => i===colorIdx ? {...c, stock:{...c.stock,[size]:newQty}} : c);
    await updateDoc(doc(db, "clothing", itemId), { colors: newColors });
    if (oldQty !== newQty) {
      logAudit(user, {
        action: AUDIT_ACTIONS.STOCK,
        collection: "clothing",
        targetId: itemId,
        targetLabel: `${item.model} / ${col?.colorName||"-"} / ${size}`,
        note: `แก้สต๊อก ${oldQty}→${newQty}`,
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
    const ref = await addDoc(collection(db, "customers"), { ...newCustomerForm, createdAt: serverTimestamp() });
    logAudit(user, {
      action: AUDIT_ACTIONS.CREATE,
      collection: "customers",
      targetId: ref.id,
      targetLabel: newCustomerForm.name,
      after: { ...newCustomerForm },
    });
    setNewCustomerForm({ name:"", phone:"", address:"" });
    setShowNewCustomer(false);
  };

  const handleSelectCustomer = (cust) => {
    setOrderForm(f => ({ ...f, customerId: cust.id, customerName: cust.name, customerPhone: cust.phone, customerAddress: cust.address }));
    setCustomerSearch("");
  };

  // handleAddOrderItem removed — items now added via onBlur in multi-size table

  const handleConfirmOrder = async () => {
    if (!orderForm.customerName || orderForm.items.length === 0) return;
    // จัดกลุ่ม items ตาม clothingId เพื่อรวมการตัดสต๊อกใน updateDoc เดียว
    // (กันบั๊กเดิม: loop เขียนทับ colors ทั้งก้อนจาก snapshot เดิม ทำให้รอบหลังลบล้างรอบก่อน)
    const byClothing = new Map();
    for (const oi of orderForm.items) {
      if (!clothingItems.find(i => i.id === oi.clothingId)) continue;
      if (!byClothing.has(oi.clothingId)) byClothing.set(oi.clothingId, []);
      byClothing.get(oi.clothingId).push(oi);
    }
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
    for (const oi of orderForm.items) {
      const isLinked = !!clothingItems.find(i => i.id === oi.clothingId);
      const isFree = typeof oi.clothingId === "string" && oi.clothingId.startsWith("free_");
      const isCustom = typeof oi.clothingId === "string" && oi.clothingId.startsWith("custom_");
      const noteSuffix = isFree ? " (รายการอิสระ — ไม่ตัดสต๊อก)" : isCustom ? " (custom order — ไม่ตัดสต๊อก)" : "";
      await addDoc(collection(db, "transactions"), {
        type: "จ่าย", code: oi.clothingId,
        name: `${oi.clothingName} / ${oi.colorName} / ${oi.size}`,
        qty: oi.qty, by: user.name, date: now(),
        note: `ใบสั่งของ: ${orderForm.customerName}${noteSuffix}`,
        stockAffected: isLinked,
        createdAt: serverTimestamp(), category: "เสื้อผ้า"
      });
    }
    const orderNo = generateDocNo("ORD", orders, "orderNo");
    const ref = await addDoc(collection(db, "orders"), {
      orderNo, ...orderForm, status: "สำเร็จ",
      by: user.name, date: now(), createdAt: serverTimestamp()
    });
    const totalQty = orderForm.items.reduce((s,i)=>s+i.qty,0);
    logAudit(user, {
      action: AUDIT_ACTIONS.CREATE,
      collection: "orders",
      targetId: ref.id,
      targetLabel: `${orderNo} · ${orderForm.customerName}`,
      note: `${orderForm.items.length} รายการ · ${totalQty} ชิ้น`,
    });
    setOrderForm({ customerId:"", customerName:"", customerPhone:"", customerAddress:"", note:"", items:[] });
    setShowNewOrder(false);
  };

  // ยกเลิก/ลบใบสั่งของ — คืนสต๊อกกลับ clothing ก่อนลบ
  const handleDeleteOrder = async (o) => {
    if (!o) return;
    const totalQty = (o.items || []).reduce((s,i) => s + (Number(i.qty)||0), 0);
    if (!window.confirm(`ยกเลิกใบสั่งของ ${o.orderNo}?
ลูกค้า: ${o.customerName}
${(o.items||[]).length} รายการ · ${totalQty} ชิ้น

⚠️ สินค้าจะถูกคืนกลับสต๊อก`)) return;

    // จัดกลุ่ม items ตาม clothingId เพื่อ updateDoc ครั้งเดียวต่อเสื้อ
    const byClothing = new Map();
    for (const oi of (o.items || [])) {
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
      const col = item.colors[colorIdx];
      // คำนวณสต็อกใหม่ทุกไซส์ในครั้งเดียว
      const newStock = { ...(col.stock || {}) };
      const changes = []; // เก็บไว้ทำ transaction + audit
      for (const [sz, q] of entries) {
        const curQty = newStock[sz] || 0;
        const newQty = clothingTxType === "รับ" ? curQty + q : Math.max(0, curQty - q);
        newStock[sz] = newQty;
        changes.push({ sz, q, curQty, newQty });
      }
      const newColors = item.colors.map((c, i) =>
        i === colorIdx ? { ...c, stock: newStock } : c
      );
      await updateDoc(doc(db, "clothing", item.id), { colors: newColors });
      // 1 transaction ต่อ 1 ไซส์ (เพื่อให้รายงานแยกไซส์ได้)
      for (const { sz, q } of changes) {
        await addDoc(collection(db, "transactions"), {
          type: clothingTxType, code: item.id,
          name: `${item.model} / ${col.colorName} / ${sz}`,
          qty: q, by: user.name,
          date: now(), note: clothingTxNote || "", createdAt: serverTimestamp(),
          category: "เสื้อผ้า"
        });
      }
      const totalQty = changes.reduce((s, c) => s + c.q, 0);
      logAudit(user, {
        action: AUDIT_ACTIONS.STOCK,
        collection: "clothing",
        targetId: item.id,
        targetLabel: `${item.model} / ${col.colorName}`,
        note: `${clothingTxType} ${totalQty} ชิ้น [${changes.map(c => `${c.sz}:${c.q}(${c.curQty}→${c.newQty})`).join(", ")}]${clothingTxNote ? ` · ${clothingTxNote}` : ""}`,
      });
      // ปิด modal + reset ทันที — กันกดซ้ำ
      setClothingTxModal(null);
      setClothingTxQty(""); setClothingTxSizeQty({}); setClothingTxNote("");
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
    const r = new FileReader();
    r.onload = async ev => {
      await updateDoc(doc(db, "clothing", uploadingClothingId), { image: ev.target.result });
      setUploadingClothingId(null);
    };
    r.readAsDataURL(file); e.target.value = "";
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

  const handleImportFromOrder = (order) => {
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
    setInvoiceForm(f=>({...f,
      customerId:order.customerId||"",
      customerName:order.customerName||"",
      customerPhone:order.customerPhone||"",
      customerAddress:order.customerAddress||"",
      items
    }));
  };

  // คำนวณราคารายรายการ + ส่วนลดต่อรายการ
  const itemLineTotal = (item) => {
    const gross = (Number(item.qty)||0) * (Number(item.unitPrice)||0);
    if (!item.discount) return gross;
    if (item.discountType === "percent") {
      return gross * (1 - Math.min(Math.max(Number(item.discount)||0, 0), 100) / 100);
    }
    return Math.max(0, gross - (Number(item.discount)||0));
  };

  const calcInvoice = (items, vatRate, useVat, discount = 0, discountType = "amount", useShipping = false, shippingFee = 0) => {
    // 1) รวมราคาทุกบรรทัด (หลังหักส่วนลดต่อบรรทัด)
    const grossSubtotal = items.reduce((s,i)=>s + (Number(i.qty)||0) * (Number(i.unitPrice)||0), 0);
    const itemsAfterDiscount = items.reduce((s,i)=>s + itemLineTotal(i), 0);
    const itemDiscountTotal = grossSubtotal - itemsAfterDiscount;
    // 2) ส่วนลดท้ายบิล
    const billDiscount = discountType === "percent"
      ? itemsAfterDiscount * (Math.min(Math.max(Number(discount)||0,0),100)/100)
      : Math.max(0, Number(discount)||0);
    const subtotal = Math.max(0, itemsAfterDiscount - billDiscount);
    // 3) VAT คำนวณจาก subtotal หลังส่วนลด (ไม่รวมค่าจัดส่ง)
    const vat = useVat ? subtotal*(vatRate/100) : 0;
    // 4) ค่าจัดส่ง (บวกท้ายสุด ไม่อยู่ในฐาน VAT)
    const shipping = useShipping ? Math.max(0, Number(shippingFee)||0) : 0;
    return { grossSubtotal, itemDiscountTotal, itemsAfterDiscount, billDiscount, subtotal, vat, shipping, total: subtotal+vat+shipping };
  };

  const docTypeLabel = (type) => ({
    receipt:"ใบเสร็จรับเงิน", tax:"ใบกำกับภาษี", quotation:"ใบเสนอราคา/ใบวางบิล"
  }[type]||"ใบเสร็จรับเงิน");

  const docTypeLabelEn = (type) => ({
    receipt:"Receipt", tax:"Tax Invoice", quotation:"Quotation"
  }[type]||"Receipt");

  const handleConfirmInvoice = async () => {
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
        // คงค่าเดิม: invoiceNo, by, date, createdAt, status
        invoiceNo: existing?.invoiceNo,
        by: existing?.by,
        date: existing?.date,
        createdAt: existing?.createdAt,
        status: existing?.status || "ออกแล้ว",
        revisions,
        lastEditedBy: user.name,
        lastEditedAt: now(),
      };
      await updateDoc(doc(db,"invoices",editingInvoiceId), updated);
      logAudit(user, {
        action: AUDIT_ACTIONS.UPDATE,
        collection: "invoices",
        targetId: editingInvoiceId,
        targetLabel: `${existing?.invoiceNo} · ${invoiceForm.customerName}`,
        before: { total: existing?.total, items: (existing?.items||[]).length, discount: existing?.discount },
        after: { total: calc.total, items: invoiceForm.items.length, discount: invoiceForm.discount },
        note: `แก้ไขครั้งที่ ${revisions}`,
      });
      setShowPrintInvoice({...updated, id:editingInvoiceId});
      setShowNewInvoice(false);
      setEditingInvoiceId(null);
      setInvoiceForm({customerId:"",customerName:"",customerPhone:"",customerAddress:"",customerTaxId:"",items:[],note:"",dueDate:"",vatRate:7,discount:0,discountType:"amount",useShipping:false,shippingFee:0});
      return;
    }

    // ── โหมดสร้างใหม่ ──
    const invNo = generateDocNo("INV", invoices, "invoiceNo");
    const data = {
      ...invoiceForm, ...calc,
      invoiceNo:invNo, docType:invoiceDocType, useVat:invoiceVat,
      bankAccount: bank,
      by:user.name, date:now(), createdAt:serverTimestamp(), status:"ออกแล้ว"
    };
    const ref = await addDoc(collection(db,"invoices"), data);
    logAudit(user, {
      action: AUDIT_ACTIONS.CREATE,
      collection: "invoices",
      targetId: ref.id,
      targetLabel: `${invNo} · ${invoiceForm.customerName}`,
      note: `${docTypeLabel(invoiceDocType)} · ฿${(data.total||0).toLocaleString("th-TH",{minimumFractionDigits:2})}${invoiceVat?" · VAT":""}`,
    });
    setShowPrintInvoice({...data, id:ref.id});
    setShowNewInvoice(false);
    setInvoiceForm({customerId:"",customerName:"",customerPhone:"",customerAddress:"",customerTaxId:"",items:[],note:"",dueDate:"",vatRate:7,discount:0,discountType:"amount",useShipping:false,shippingFee:0});
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
    const cname = sel[0].customerName;
    if (!sel.every(i => i.customerName === cname)) { alert("รวมได้เฉพาะบิลของลูกค้าคนเดียวกัน"); return; }
    if (sel.some(i => i.mergedInto)) { alert("มีบิลที่ถูกรวมไปแล้วในรายการที่เลือก"); return; }
    if (sel.some(i => i.convertedTo)) { alert("มีบิลที่แปลงเป็นเอกสารอื่นแล้ว — รวมไม่ได้"); return; }
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
    const invNo = generateDocNo("INV", invoices, "invoiceNo");
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
      await deleteDoc(doc(db, "invoices", mergedInv.id));
      logAudit(user, { action: AUDIT_ACTIONS.DELETE, collection: "invoices", targetId: mergedInv.id, targetLabel: `${mergedInv.invoiceNo} (ยกเลิกรวมบิล)`, note: `คืน ${mergedInv.mergedFrom.map(s => s.invoiceNo).join(", ")}` });
    } catch (e) { alert("ยกเลิกไม่สำเร็จ: " + (e.message || e)); }
  };

  // แปลงใบวางบิล (quotation) → ใบเสร็จ/ใบกำกับ
  const handleConvertQuotation = async (sourceInv, targetDocType) => {
    if (!sourceInv) return;
    if (!window.confirm(`สร้าง${targetDocType==="tax"?"ใบกำกับภาษี":"ใบเสร็จ"}จาก ${sourceInv.invoiceNo} (${sourceInv.customerName})?`)) return;
    const calc = calcInvoice(sourceInv.items||[], sourceInv.vatRate||7, targetDocType==="tax"||sourceInv.useVat, sourceInv.discount||0, sourceInv.discountType||"amount", !!sourceInv.useShipping, sourceInv.shippingFee||0);
    const invNo = generateDocNo("INV", invoices, "invoiceNo");
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

  // ── Payment helpers ─────────────────────────────────────────────
  const getPaidTotal = (inv) => (inv?.payments||[]).reduce((s,p) => s + (Number(p.amount)||0), 0);
  const getRemaining = (inv) => Math.max(0, (Number(inv?.total)||0) - getPaidTotal(inv));
  const getPaidPct = (inv) => {
    const t = Number(inv?.total) || 0;
    if (t <= 0) return 0;
    return Math.min(100, Math.round(getPaidTotal(inv) / t * 100));
  };

  const PAYMENT_METHODS = ["โอน","COD","เงินสด"];
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

  // scale fontSize ของทุก element ใน clone (ใช้ก่อนพิมพ์/PDF) — ค่าเริ่มต้น 1.3 = ใหญ่ขึ้น 30%
  const PRINT_FONT_SCALE = 1.3;
  // ใบบิล: ย่อให้พอดี A4 หน้าเดียวเมื่อรายการเยอะ (0.85 = ลด 15% จากขนาดจริง)
  const INVOICE_FONT_SCALE = 0.85;
  const scaleFontInElement = (root, factor = PRINT_FONT_SCALE) => {
    // ต้อง attach root เข้า DOM ชั่วคราวเพื่ออ่าน computed style
    const holder = document.createElement("div");
    holder.style.position = "fixed";
    holder.style.left = "-99999px";
    holder.style.top = "0";
    holder.style.visibility = "hidden";
    holder.appendChild(root);
    document.body.appendChild(holder);
    try {
      const all = [root, ...root.querySelectorAll("*")];
      all.forEach(n => {
        try {
          // ข้าม element ที่ระบุ data-no-scale="true" หรืออยู่ใน subtree data-no-scale-tree
          // (closest คลุม element ตัวเอง + ancestors — ถ้า td เป็น tree-root, td เองและ children ทั้งหมดจะถูกข้าม)
          if (n.getAttribute && n.getAttribute("data-no-scale") === "true") return;
          if (n.closest && n.closest('[data-no-scale-tree="true"]')) return;
          const cs = window.getComputedStyle(n);
          const fs = parseFloat(cs.fontSize);
          if (!isNaN(fs) && fs > 0) n.style.fontSize = (fs * factor).toFixed(2) + "px";
        } catch (e) {}
      });
    } finally {
      holder.removeChild(root);
      document.body.removeChild(holder);
    }
    return root;
  };

  // 🖨️ พิมพ์แบบ same-page isolation — ใช้ได้ทุกอุปกรณ์ (desktop + Samsung/iOS/Android)
  // วิธีนี้ clone เนื้อหาที่จะพิมพ์ไปไว้ที่ body ระดับบนสุด แล้วใช้ @media print ซ่อนทุกอย่างที่เหลือ
  // → ไม่มี sidebar/โลโก้แอป หลุดเข้ามา (เดิม iframe.print() บน Samsung พิมพ์ทั้งหน้าหลัก = โลโก้ซ้ำ)
  const printElementById = (id, pageSize = "A4 portrait", pageMargin = "10mm", fontScale = PRINT_FONT_SCALE) => {
    const el = document.getElementById(id);
    if (!el) return;
    const thermalMatch = /^(\d+(?:\.\d+)?)mm\s+(\d+(?:\.\d+)?)mm$/i.exec(String(pageSize).trim());
    const isThermal = !!thermalMatch;
    const tW = isThermal ? Number(thermalMatch[1]) : null;

    // เก็บกวาดของเก่า (กันค้างถ้ากดซ้ำ)
    document.getElementById("__print_root__")?.remove();
    document.getElementById("__print_style__")?.remove();

    // clone + scale font
    const clone = el.cloneNode(true);
    clone.removeAttribute("id"); // กัน id ซ้ำกับต้นฉบับ
    const finalEl = isThermal ? clone : scaleFontInElement(clone, fontScale);

    const root = document.createElement("div");
    root.id = "__print_root__";
    root.appendChild(finalEl);
    document.body.appendChild(root);

    const extraThermal = isThermal ? `
      #__print_root__ { width: ${tW}mm; }
      #__print_root__ > * { width: ${tW}mm; max-width: ${tW}mm; box-sizing: border-box; }
    ` : "";

    // 🩹 แปลงชื่อขนาดกระดาษเป็น mm (บาง browser/printer ไม่ honor "A5 portrait")
    const sizeMap = {
      "A4 portrait":  "210mm 297mm",
      "A4 landscape": "297mm 210mm",
      "A5 portrait":  "148mm 210mm",
      "A5 landscape": "210mm 148mm",
    };
    const cssPageSize = sizeMap[pageSize] || pageSize;
    // คำนวณ content width = paper width - 2× margin → บังคับ layout จริงๆ
    const marginMm = parseFloat(String(pageMargin).match(/^([\d.]+)/)?.[1] || "10");
    const pageMatch = cssPageSize.match(/^([\d.]+)mm\s+([\d.]+)mm$/);
    const contentWidth = (pageMatch && !isThermal) ? (parseFloat(pageMatch[1]) - 2 * marginMm) + "mm" : "auto";

    const style = document.createElement("style");
    style.id = "__print_style__";
    // 🩹 @page ต้องอยู่ top-level (ไม่ใช่ใน @media print) — บาง browser ไม่ parse
    style.textContent = `
      @page { size: ${cssPageSize}; margin: ${pageMargin}; }
      @media screen { #__print_root__ { position: fixed; left: -99999px; top: 0; width: 1px; height: 1px; overflow: hidden; } }
      @media print {
        html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
        body > *:not(#__print_root__) { display: none !important; }
        #__print_root__ { display: block !important; position: static !important; left: auto !important; top: auto !important; width: ${contentWidth} !important; max-width: ${contentWidth} !important; height: auto !important; overflow: visible !important; box-sizing: border-box; margin: 0 auto; }
        #__print_root__ table { border-collapse: collapse; width: 100%; }
        #__print_root__ tr, #__print_root__ td, #__print_root__ th { page-break-inside: avoid; }
        #__print_root__ thead { display: table-header-group; }
        #__print_root__ tfoot { display: table-footer-group; }
        #__print_root__ img { max-width: 100%; }
        .no-print, [data-no-print="true"], .print-hide { display: none !important; }
        ${extraThermal}
      }
    `;
    document.head.appendChild(style);

    let done = false;
    const cleanup = () => {
      if (done) return; done = true;
      root.remove();
      style.remove();
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup);

    // รอรูป + ฟอนต์โหลดก่อนสั่งพิมพ์
    const imgs = Array.from(root.querySelectorAll("img"));
    const waitImgs = Promise.all(imgs.map(im =>
      (im.complete && im.naturalWidth > 0)
        ? Promise.resolve()
        : new Promise(res => { im.onload = res; im.onerror = res; setTimeout(res, 3000); })
    ));
    const fontsReady = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();

    Promise.all([waitImgs, fontsReady]).then(() => {
      setTimeout(() => {
        try { window.print(); } catch (e) { console.warn("[print] failed:", e); }
        // เผื่อ afterprint ไม่ยิง (บางมือถือ) — เก็บกวาดหลัง 60 วิ
        setTimeout(cleanup, 60000);
      }, 120);
    });
  };

  // พิมพ์เอกสารหลายชุด (ต้นฉบับ + สำเนา) บน A4 — ขึ้นหน้าใหม่ทุกชุด
  const printInvoiceCopies = (id, labels = ["ใบส่งของ/ใบแจ้งหนี้ (ต้นฉบับ)", "ใบส่งของ/ใบแจ้งหนี้ (สำเนา)", "ใบส่งของ/ใบแจ้งหนี้ (สำเนา)"], fontScale = INVOICE_FONT_SCALE, pageSize = "A5 portrait", pageMargin = "8mm") => {
    const el = document.getElementById(id);
    if (!el) return;
    document.getElementById("__print_root__")?.remove();
    document.getElementById("__print_style__")?.remove();

    const root = document.createElement("div");
    root.id = "__print_root__";
    labels.forEach((label, i) => {
      const clone = el.cloneNode(true);
      clone.removeAttribute("id");
      const tag = clone.querySelector("[data-doc-label]");
      if (tag) tag.textContent = label;
      scaleFontInElement(clone, fontScale);
      const wrap = document.createElement("div");
      if (i < labels.length - 1) wrap.style.pageBreakAfter = "always";
      wrap.appendChild(clone);
      root.appendChild(wrap);
    });
    document.body.appendChild(root);

    const sizeMap2 = {
      "A4 portrait":  "210mm 297mm",
      "A4 landscape": "297mm 210mm",
      "A5 portrait":  "148mm 210mm",
      "A5 landscape": "210mm 148mm",
    };
    const cssPageSize2 = sizeMap2[pageSize] || pageSize;
    const marginMm2 = parseFloat(String(pageMargin).match(/^([\d.]+)/)?.[1] || "10");
    const pm2 = cssPageSize2.match(/^([\d.]+)mm\s+([\d.]+)mm$/);
    const contentWidth2 = pm2 ? (parseFloat(pm2[1]) - 2 * marginMm2) + "mm" : "auto";

    const style = document.createElement("style");
    style.id = "__print_style__";
    style.textContent = `
      @page { size: ${cssPageSize2}; margin: ${pageMargin}; }
      @media screen { #__print_root__ { position: fixed; left: -99999px; top: 0; width: 1px; height: 1px; overflow: hidden; } }
      @media print {
        html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
        body > *:not(#__print_root__) { display: none !important; }
        #__print_root__ { display: block !important; position: static !important; left: auto !important; top: auto !important; width: ${contentWidth2} !important; max-width: ${contentWidth2} !important; overflow: visible !important; box-sizing: border-box; margin: 0 auto; }
        #__print_root__ > div { width: ${contentWidth2} !important; max-width: ${contentWidth2} !important; box-sizing: border-box; }
        #__print_root__ table { border-collapse: collapse; width: 100%; }
        #__print_root__ tr, #__print_root__ td, #__print_root__ th { page-break-inside: avoid; }
        #__print_root__ thead { display: table-header-group; }
        #__print_root__ img { max-width: 100%; }
        .no-print, [data-no-print="true"], .print-hide { display: none !important; }
      }
    `;
    document.head.appendChild(style);

    let done = false;
    const cleanup = () => { if (done) return; done = true; root.remove(); style.remove(); window.removeEventListener("afterprint", cleanup); };
    window.addEventListener("afterprint", cleanup);

    const imgs = Array.from(root.querySelectorAll("img"));
    const waitImgs = Promise.all(imgs.map(im => (im.complete && im.naturalWidth > 0) ? Promise.resolve() : new Promise(res => { im.onload = res; im.onerror = res; setTimeout(res, 3000); })));
    const fontsReady = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();
    Promise.all([waitImgs, fontsReady]).then(() => {
      setTimeout(() => { try { window.print(); } catch (e) {} setTimeout(cleanup, 60000); }, 120);
    });
  };

  // ดาวน์โหลดเอกสารเป็น PDF (ใช้ html2pdf.js)
  const downloadInvoicePdf = (inv, copies = false) => {
    const el = document.getElementById("invoice-print-area");
    if (!el || !inv) return;
    const safeName = (inv.customerName || "ลูกค้า").replace(/[\\/:*?"<>|]/g, "_").slice(0, 30);
    const filename = `${inv.invoiceNo || "INV"}_${safeName}.pdf`;
    let source;
    if (copies) {
      const labels = ["ใบส่งของ/ใบแจ้งหนี้ (ต้นฉบับ)", "ใบส่งของ/ใบแจ้งหนี้ (สำเนา)", "ใบส่งของ/ใบแจ้งหนี้ (สำเนา)"];
      const wrap = document.createElement("div");
      labels.forEach((label, i) => {
        const clone = el.cloneNode(true);
        const tag = clone.querySelector("[data-doc-label]");
        if (tag) tag.textContent = label;
        scaleFontInElement(clone);
        const pageWrap = document.createElement("div");
        if (i < labels.length - 1) pageWrap.style.pageBreakAfter = "always";
        pageWrap.appendChild(clone);
        wrap.appendChild(pageWrap);
      });
      source = wrap;
    } else {
      source = scaleFontInElement(el.cloneNode(true));
    }
    html2pdf().set({
      margin: 10,
      filename,
      image: { type: "jpeg", quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
      pagebreak: { mode: ["css", "legacy"] }
    }).from(source).save();
  };

  const handleResetPassword = async (username, newPassword) => {
    const u = users.find(u => u.username === username);
    if (!u) return;
    await setDoc(doc(db, "users", String(u.id)), { ...u, password: newPassword });
  };

  if (loading || !authChecked) return (
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

  // โครงสร้างเมนู: รวมกลุ่มย่อย — คลัง&ผลิต / บิล&เก็บเงิน / เอกสาร&บุคลากร / รายงาน&ผู้ดูแล
  const navStructure = [
    { type:"item",  id:"dashboard", icon:"📊", label:"ภาพรวม" },
    { type:"group", id:"warehouse", icon:"📦", label:"คลัง & ผลิต", children:[
      { id:"inventory", icon:"📦", label:"สินค้าคงคลัง" },
      { id:"stocktake", icon:"🧮", label:"นับสต็อก" },
      { id:"production",icon:"🏭", label:"การผลิต" },
      { id:"productionHistory",icon:"📜", label:"ประวัติการผลิต" },
    ]},
    { type:"item",  id:"transactions", icon:"🔄", label:"รับ/จ่ายสินค้า" },
    { type:"item",  id:"barcode",      icon:"▦",  label:"สแกนบาร์โค้ด" },
    { type:"item",  id:"orders",       icon:"📋", label:"ใบสั่งของ" },
    { type:"group", id:"billing", icon:"🧾", label:"บิล & เก็บเงิน", children:[
      { id:"invoice",    icon:"🧾", label:"ออกบิล" },
      { id:"statements", icon:"📃", label:"วางบิลเก็บเงิน" },
    ]},
    { type:"item",  id:"customers", icon:"👤", label:"ลูกค้า" },
    { type:"item",  id:"suppliers", icon:"🏭", label:"ซัพพลายเออร์" },
    { type:"item",  id:"alerts",    icon:"🔔", label:"แจ้งเตือน", badge: lowStock.length },
    { type:"item",  id:"catalogInbox", icon:"📥", label:"Inbox (Catalog)", badge: (catalogOrders||[]).filter(o=>!o.status||o.status==="new").length },
    { type:"group", id:"hrdocs", icon:"📂", label:"เอกสาร & บุคลากร", children:[
      { id:"employees", icon:"👷", label:"บัตรลูกจ้าง" },
      { id:"payroll",   icon:"💰", label:"เงินเดือน", adminOnly:true },
      { id:"taxdocs",   icon:"🧾", label:"คลังเอกสารภาษี" },
    ]},
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
                <div key={entry.id} onClick={() => setActiveTab(entry.id)}
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
                      <div key={c.id} onClick={() => setActiveTab(c.id)} title={c.label}
                        style={{display:"flex",alignItems:"center",gap:10,padding:"9px 14px",borderRadius:10,cursor:"pointer",transition:"all .2s",color:active?T.navActiveText:T.sub,fontSize:13,background:active?T.navActive:"transparent",border:active?`1px solid ${T.navActiveBorder}`:"1px solid transparent",marginBottom:2,justifyContent:"center"}}>
                        <span style={{fontSize:15}}>{c.icon}</span>
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
                    <div key={c.id} onClick={() => setActiveTab(c.id)}
                      className={active?"nav-active-bar":""}
                      style={{display:"flex",alignItems:"center",gap:10,padding:"8px 14px 8px 26px",borderRadius:10,cursor:"pointer",transition:"all .2s",color:active?T.navActiveText:T.sub,fontWeight:active?600:400,fontSize:12.5,background:active?T.navActive:"transparent",border:active?`1px solid ${T.navActiveBorder}`:"1px solid transparent",marginBottom:2,position:"relative",boxShadow:active?"0 0 12px rgba(59,91,139,0.08)":"none"}}>
                      <span style={{fontSize:14,flexShrink:0}}>{c.icon}</span>
                      <span style={{fontFamily:"'DM Sans','Sarabun',sans-serif"}}>{c.label}</span>
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
            {activeTab==="inventory"&&inventoryTab==="general"&&role.canManageCats&&<BtnGhost onClick={()=>setShowCatModal(true)}>📦 หมวดหมู่</BtnGhost>}
            {activeTab==="inventory"&&inventoryTab==="general"&&role.canAdd&&<BtnPrimary onClick={()=>setShowAddModal(true)}>️ เพิ่มสินค้า</BtnPrimary>}
            {activeTab==="inventory"&&(inventoryTab==="clothing"||inventoryTab==="sports")&&<BtnGhost onClick={()=>{setSalesDate(new Date().toISOString().slice(0,10));setShowSalesToday(true);}}>📊 ขายวันนี้</BtnGhost>}
            {activeTab==="inventory"&&(inventoryTab==="clothing"||inventoryTab==="sports")&&role.canAdd&&<BtnGhost onClick={()=>setShowSizeManager(true)}>📏 จัดการไซส์</BtnGhost>}
            {activeTab==="inventory"&&(inventoryTab==="clothing"||inventoryTab==="sports")&&role.canAdd&&<BtnPrimary onClick={()=>setShowAddClothing(true)}>{inventoryTab==="sports"?"👟":"️"} เพิ่มรุ่นใหม่</BtnPrimary>}
            {activeTab==="inventory"&&inventoryTab==="general"&&<>
              <BtnSuccess onClick={()=>{setTxType("รับ");setTxRows([{productId:"",qty:""}]);setTxNote("");setShowTxModal(true);}}>⬇ รับสินค้า</BtnSuccess>
              <BtnDanger onClick={()=>{setTxType("จ่าย");setTxRows([{productId:"",qty:""}]);setTxNote("");setShowTxModal(true);}}>⬆ จ่ายสินค้า</BtnDanger>
            </>}
            {activeTab==="transactions"&&<>
              <BtnSuccess onClick={()=>{setTxType("รับ");setTxRows([{productId:"",qty:""}]);setTxNote("");setShowTxModal(true);}}>⬇ รับสินค้า</BtnSuccess>
              <BtnDanger onClick={()=>{setTxType("จ่าย");setTxRows([{productId:"",qty:""}]);setTxNote("");setShowTxModal(true);}}>⬆ จ่ายสินค้า</BtnDanger>
            </>}
            {activeTab==="inventory"&&role.canClear&&<button onClick={()=>setShowClearConfirm(true)} style={{padding:"8px 16px",borderRadius:8,border:"1px solid rgba(239,68,68,0.3)",background:"rgba(239,68,68,0.08)",color:T.red,fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"'Sarabun',sans-serif"}}>🗑 ล้างคลัง</button>}
          </div>
        </div>

        <div className="pad-main" style={{padding:24,flex:1}}>

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

          {/* INVENTORY */}
          {activeTab==="inventory"&&(
            <div>
              {/* Sub-tabs */}
              <div style={{display:"flex",gap:6,marginBottom:20,padding:"4px",background:T.card,borderRadius:12,border:`1px solid ${T.border}`,width:"fit-content",flexWrap:"wrap"}}>
                {[
                  {id:"general",icon:"📦",label:"สินค้าทั่วไป"},
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
              </div>

              {/* General products (สินค้าทั่วไปเท่านั้น — sports ใช้ view แบบ clothing แล้ว) */}
              {inventoryTab==="general"&&<div>
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
              {(inventoryTab==="clothing"||inventoryTab==="sports")&&(()=>{
                // 👕 clothing tab → apparel + รุ่นเก่าที่ไม่มี sizeType
                // 👟 sports tab → shoe items only
                const tabItems = clothingItems.filter(it =>
                  inventoryTab==="sports" ? it.sizeType==="shoe" : it.sizeType!=="shoe"
                ).sort((a,b)=>(a.sortIndex??9999)-(b.sortIndex??9999));
                return (
                <div style={{animation:"fadeUp 0.4s ease"}}>
                <input ref={clothingImgRef} type="file" accept="image/*" style={{display:"none"}} onChange={handleClothingImageUpload}/>
                {tabItems.length===0&&(
                  <div style={{textAlign:"center",padding:60,background:T.card,borderRadius:16,border:`1px solid ${T.border}`}}>
                    <div style={{fontSize:48,marginBottom:12,opacity:0.3}}>{inventoryTab==="sports"?"👟":"👕"}</div>
                    <div style={{fontSize:14,fontWeight:600,color:T.accent,marginBottom:6}}>ยังไม่มีรุ่นสินค้า</div>
                    <div style={{fontSize:11,color:T.muted}}>กด "{inventoryTab==="sports"?"👟":"️"} เพิ่มรุ่นใหม่" เพื่อเริ่มต้น</div>
                  </div>
                )}
                {tabItems.map((item,idx)=>(
                  <div key={item.id}
                    onDragOver={role.canAdd?(e=>{e.preventDefault();if(dragOverClothingId!==item.id)setDragOverClothingId(item.id);}):undefined}
                    onDrop={role.canAdd?(e=>{e.preventDefault();reorderClothing(draggingClothingId,item.id,tabItems);setDraggingClothingId(null);setDragOverClothingId(null);}):undefined}
                    style={{background:T.card,border:`1px solid ${dragOverClothingId===item.id&&draggingClothingId&&draggingClothingId!==item.id?T.accent:T.border}`,borderRadius:16,marginBottom:16,overflow:"hidden",boxShadow:"0 8px 32px rgba(0,0,0,0.3)",opacity:draggingClothingId===item.id?0.4:1,transition:"opacity 0.15s"}}>
                    <div onClick={()=>toggleCollapse(item.id)} style={{display:"flex",alignItems:"center",gap:14,padding:"14px 20px",borderBottom:collapsedItems[item.id]?"none":`1px solid ${T.border}`,cursor:"pointer",userSelect:"none",transition:"background 0.2s"}}
                      onMouseEnter={e=>e.currentTarget.style.background="rgba(59,91,139,0.04)"}
                      onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                      {/* 🖱️ Drag handle — จัดลำดับ */}
                      {role.canAdd&&(
                        <div draggable
                          onDragStart={e=>{e.stopPropagation();setDraggingClothingId(item.id);e.dataTransfer.effectAllowed="move";}}
                          onDragEnd={()=>{setDraggingClothingId(null);setDragOverClothingId(null);}}
                          onClick={e=>e.stopPropagation()}
                          title="ลากเพื่อจัดลำดับ"
                          style={{cursor:"grab",color:T.muted,fontSize:16,flexShrink:0,padding:"0 2px",lineHeight:1,userSelect:"none"}}>⠿</div>
                      )}
                      {/* Collapse arrow */}
                      <div style={{width:24,height:24,borderRadius:6,background:"rgba(59,91,139,0.1)",border:"1px solid rgba(59,91,139,0.2)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,transition:"transform 0.2s",transform:collapsedItems[item.id]?"rotate(-90deg)":"rotate(0deg)",fontSize:11,color:T.accent}}>▼</div>
                      <div onClick={e=>{e.stopPropagation();setUploadingClothingId(item.id);setTimeout(()=>clothingImgRef.current?.click(),50);}}
                        title={item.image?"คลิกเพื่อเปลี่ยนรูป":"คลิกเพื่อเพิ่มรูป"}
                        style={{width:65,height:65,borderRadius:10,background:"rgba(59,91,139,0.08)",border:"2px dashed rgba(59,91,139,0.3)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",flexShrink:0,cursor:"pointer",overflow:"hidden",position:"relative"}}
                        onMouseEnter={e=>{const o=e.currentTarget.querySelector(".img-overlay");if(o)o.style.opacity="1";}}
                        onMouseLeave={e=>{const o=e.currentTarget.querySelector(".img-overlay");if(o)o.style.opacity="0";}}>
                        {item.image?<img src={item.image} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/>:<><span style={{fontSize:20}}>👕</span><span style={{fontSize:8,color:T.muted}}>รูป</span></>}
                        {item.image&&(
                          <div className="img-overlay" style={{position:"absolute",inset:0,background:"rgba(0,0,0,0.65)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",opacity:0,transition:"opacity 0.15s",color:"#fff",fontSize:9,fontWeight:600,gap:2}}>
                            <span style={{fontSize:16}}>📷</span>
                            <span>เปลี่ยนรูป</span>
                          </div>
                        )}
                      </div>
                      <div style={{flex:1}}>
                        <div style={{fontSize:14,fontWeight:700,color:T.text}}>{item.model}</div>
                        <div style={{fontSize:11,color:T.muted,marginTop:3,display:"flex",alignItems:"center",gap:10}}>
                          <span>{(item.colors||[]).length} สี</span>
                          <span style={{color:"rgba(59,91,139,0.3)"}}>·</span>
                          <span>รวม <b style={{color:T.accent}}>{(item.colors||[]).reduce((s,c)=>s+Object.values(c.stock||{}).reduce((a,b)=>a+b,0),0)}</b> ชิ้น</span>
                          {collapsedItems[item.id]&&(item.colors||[]).length>0&&(
                            <div style={{display:"flex",gap:4,marginLeft:4}}>
                              {(item.colors||[]).slice(0,5).map((c,i)=>(
                                <div key={i} title={c.colorName} style={{width:10,height:10,borderRadius:2,background:c.hex,border:"1px solid rgba(255,255,255,0.15)"}}/>
                              ))}
                              {(item.colors||[]).length>5&&<span style={{fontSize:10,color:T.muted}}>+{(item.colors||[]).length-5}</span>}
                            </div>
                          )}
                        </div>
                      </div>
                      <div style={{display:"flex",gap:6}} onClick={e=>e.stopPropagation()}>
                        <button onClick={()=>setShowAddColor(item.id)} style={{padding:"7px 14px",borderRadius:8,border:"1px solid rgba(59,91,139,0.25)",background:"rgba(59,91,139,0.08)",color:T.accent,cursor:"pointer",fontSize:12,fontFamily:"'Sarabun',sans-serif",fontWeight:500}}>️ สี</button>
                        {(item.colors||[]).length>0&&<button onClick={()=>openMix(item)} title="ขายคละสีคละไซส์" style={{padding:"7px 14px",borderRadius:8,border:"1px solid rgba(184,134,0,0.3)",background:"rgba(184,134,0,0.08)",color:T.amber,cursor:"pointer",fontSize:12,fontFamily:"'Sarabun',sans-serif",fontWeight:600}}>🧺 ขายคละ</button>}
                        {role.canDelete&&<button onClick={()=>{setDeleteClothingTarget(item);setDeleteConfirmText("");}} style={{padding:"7px 12px",borderRadius:8,border:"1px solid rgba(248,113,113,0.25)",background:"rgba(248,113,113,0.08)",color:"#f87171",cursor:"pointer",fontSize:12}}>✕</button>}
                      </div>
                    </div>

                    {/* Collapsed state */}
                    {collapsedItems[item.id]?null:(item.colors||[]).length===0?(
                      <div style={{padding:"20px",textAlign:"center",color:T.muted,fontSize:12}}>ยังไม่มีสี — กด "️ สี"</div>
                    ):(
                      <div style={{overflowX:"auto"}}>
                        <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                          <thead>
                            <tr style={{background:"rgba(241,243,246,0.8)"}}>
                              <th style={{padding:"10px 14px",textAlign:"left",color:T.sub,fontWeight:700,fontSize:12,textTransform:"uppercase",letterSpacing:"0.06em",width:120,borderRight:`1px solid ${T.border}`}}>สี</th>
                              {sizesFor(item).map(sz=>(
                                <th key={sz} style={{padding:"10px 4px",textAlign:"center",color:T.text,fontWeight:700,fontSize:13,borderRight:"1px solid rgba(203,210,217,0.4)",fontFamily:"monospace",minWidth:46}}>{sz}</th>
                              ))}
                              <th style={{padding:"10px 10px",textAlign:"center",color:T.sub,fontWeight:700,fontSize:12,minWidth:60}}>รวม</th>
                              <th style={{padding:"10px 10px",textAlign:"center",color:T.sub,fontWeight:700,fontSize:12,minWidth:100}}>รับ/จ่าย</th>
                              <th style={{width:30}}/>
                            </tr>
                          </thead>
                          <tbody>
                            {(item.colors||[]).map((col,ci)=>{
                              const total=Object.values(col.stock||{}).reduce((a,b)=>a+b,0);
                              return (
                                <tr key={ci} style={{borderBottom:"1px solid rgba(203,210,217,0.5)"}}
                                  onMouseEnter={e=>e.currentTarget.style.background="rgba(59,91,139,0.04)"}
                                  onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                                  <td style={{padding:"10px 14px",borderRight:`1px solid ${T.border}`}}>
                                    <div style={{display:"flex",alignItems:"center",gap:10}}>
                                      <div style={{width:16,height:16,borderRadius:4,background:col.hex,border:"1px solid rgba(0,0,0,0.1)",flexShrink:0}}/>
                                      <span style={{color:T.text,fontWeight:600,fontSize:14}}>{col.colorName}</span>
                                    </div>
                                  </td>
                                  {sizesFor(item).map(sz=>{
                                    const isEd=editingStock?.itemId===item.id&&editingStock?.ci===ci&&editingStock?.size===sz;
                                    const val=(col.stock||{})[sz]||0;
                                    return (
                                      <td key={sz} style={{padding:"3px 2px",textAlign:"center",borderRight:"1px solid rgba(203,210,217,0.4)"}}>
                                        {isEd?(
                                          <input autoFocus type="number" defaultValue={val}
                                            onFocus={e=>e.target.select()}
                                            onBlur={e=>handleUpdateClothingStock(item.id,ci,sz,e.target.value)}
                                            onKeyDown={e=>{if(e.key==="Enter"||e.key==="Escape")e.target.blur();}}
                                            style={{width:48,textAlign:"center",background:"rgba(59,91,139,0.12)",border:"1.5px solid #3b5b8b",borderRadius:6,color:"#1f2933",fontFamily:"monospace",fontSize:15,fontWeight:700,padding:"5px 4px",outline:"none"}}/>
                                        ):(
                                          <div onClick={()=>setEditingStock({itemId:item.id,ci,size:sz})}
                                            style={{padding:"5px 4px",borderRadius:6,cursor:"pointer",fontFamily:"monospace",fontWeight:700,fontSize:15,color:val===0?"#9aa5b1":val<5?"#b88600":"#1f2933",minWidth:46,display:"inline-block",transition:"all 0.15s"}}
                                            onMouseEnter={e=>{e.currentTarget.style.background="rgba(59,91,139,0.10)";}}
                                            onMouseLeave={e=>{e.currentTarget.style.background="transparent";}}>
                                            {val===0?"—":val}
                                          </div>
                                        )}
                                      </td>
                                    );
                                  })}
                                  <td colSpan={2} style={{padding:"4px 6px",textAlign:"center"}}>
                                    {(() => {
                                      const sp = col.salePrices || {};
                                      const hasAny = SIZE_GROUPS.some(g => sp[g.key] != null && sp[g.key] !== "" && Number(sp[g.key]) > 0) || Number(col.salePrice) > 0;
                                      const cost = Number(col.costPrice) || 0;
                                      return (
                                        <button onClick={() => {
                                          setPriceForm({
                                            costPrice: col.costPrice || "",
                                            kids: sp.kids ?? col.salePrice ?? "",
                                            reg:  sp.reg  ?? col.salePrice ?? "",
                                            "2XL": sp["2XL"] ?? col.salePrice ?? "",
                                            "3XL": sp["3XL"] ?? col.salePrice ?? "",
                                            "4XL": sp["4XL"] ?? col.salePrice ?? "",
                                            "5XL": sp["5XL"] ?? col.salePrice ?? "",
                                          });
                                          setPriceModal({ itemId: item.id, ci });
                                        }}
                                        style={{padding:"4px 8px",borderRadius:6,border:`1px solid ${hasAny?"rgba(52,211,153,0.3)":T.border}`,background:hasAny?"rgba(52,211,153,0.08)":"rgba(59,91,139,0.05)",color:hasAny?"#34d399":T.sub,cursor:"pointer",fontSize:10,fontWeight:600,fontFamily:"'Sarabun',sans-serif",whiteSpace:"nowrap"}}>
                                          💰 {hasAny ? "แก้ไขราคา" : "ตั้งราคา"}
                                          {cost > 0 && <span style={{marginLeft:4,fontSize:9,opacity:0.7,fontFamily:"monospace"}}>ทุน {cost}</span>}
                                        </button>
                                      );
                                    })()}
                                  </td>
                                  <td style={{textAlign:"center",padding:"4px 6px"}}>
                                    <span style={{fontFamily:"monospace",fontWeight:700,fontSize:16,color:T.text}}>{total}</span>
                                  </td>
                                  <td style={{textAlign:"center",padding:"4px 8px"}}>
                                    <div style={{display:"flex",gap:4,justifyContent:"center"}}>
                                      <button onClick={()=>{setClothingTxModal({item,colorIdx:ci,size:null});setClothingTxType("รับ");setClothingTxQty("");setClothingTxSizeQty({});setClothingTxNote("");}} style={{padding:"4px 8px",borderRadius:6,border:"1px solid rgba(52,211,153,0.3)",background:"rgba(52,211,153,0.08)",color:"#34d399",cursor:"pointer",fontSize:10,fontWeight:600,fontFamily:"'Sarabun',sans-serif"}}>⬇ รับ</button>
                                      <button onClick={()=>{setClothingTxModal({item,colorIdx:ci,size:null});setClothingTxType("จ่าย");setClothingTxQty("");setClothingTxSizeQty({});setClothingTxNote("");}} style={{padding:"4px 8px",borderRadius:6,border:"1px solid rgba(248,113,113,0.3)",background:"rgba(248,113,113,0.08)",color:"#f87171",cursor:"pointer",fontSize:10,fontWeight:600,fontFamily:"'Sarabun',sans-serif"}}>⬆ จ่าย</button>
                                    </div>
                                  </td>
                                  <td style={{textAlign:"center",padding:"4px 6px"}}>
                                    {role.canDelete&&<button onClick={()=>handleDeleteClothingColor(item.id,ci)} style={{background:"rgba(248,113,113,0.08)",border:"1px solid rgba(248,113,113,0.2)",borderRadius:5,padding:"2px 6px",cursor:"pointer",fontSize:10,color:"#f87171"}}>✕</button>}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                ))}
              </div>);})()}
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
            <div style={{maxWidth:580}}>
              <CardBox style={{marginBottom:20}}>
                <div style={{fontSize:14,fontWeight:600,color:T.text,marginBottom:16}}>▦ สแกน / ค้นหาบาร์โค้ด</div>
                <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
                  <input ref={barcodeInputRef} value={barcodeSearch} onChange={e=>setBarcodeSearch(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleBarcodeSearch()} placeholder="สแกนหรือพิมพ์บาร์โค้ด / รหัสสินค้า..." autoFocus
                    style={{flex:1,minWidth:200,background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:8,padding:"9px 12px",fontFamily:"'Sarabun',sans-serif",fontSize:13,outline:"none"}}/>
                  <button onClick={()=>setShowScanner(true)} style={{padding:"9px 14px",borderRadius:8,border:"1px solid rgba(124,58,237,0.3)",background:"rgba(124,58,237,0.1)",color:"#7c3aed",cursor:"pointer",fontSize:13,fontWeight:600,fontFamily:"'Sarabun',sans-serif"}}>📸 สแกนกล้อง</button>
                  <button onClick={()=>setShowBarcodePrint(true)} style={{padding:"9px 14px",borderRadius:8,border:"1px solid rgba(58,122,82,0.3)",background:"rgba(58,122,82,0.1)",color:T.green,cursor:"pointer",fontSize:13,fontWeight:600,fontFamily:"'Sarabun',sans-serif"}}>🏷️ ปริ้น sticker</button>
                  <BtnPrimary onClick={handleBarcodeSearch}>ค้นหา</BtnPrimary>
                </div>
                <div style={{fontSize:11,color:T.muted,marginTop:8}}>💡 กด Enter หลังสแกนบาร์โค้ดจากเครื่องสแกน · หรือกด <b>📸 สแกนกล้อง</b> เพื่อใช้กล้องมือถือ/Webcam</div>
                {barcodeErr&&(
                  <div style={{marginTop:14,padding:"12px 14px",background:"#fef2f2",border:"1px solid #fecaca",borderRadius:8,fontSize:13}}>
                    <div style={{color:T.red,marginBottom:role.canAdd?10:0}}>❌ {barcodeErr}</div>
                    {role.canAdd&&(
                      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                        <button onClick={()=>{
                          setNewProduct({code:"",name:"",category:"",qty:"",unit:"",minQty:"",location:"",barcode:barcodeSearch.trim(),image:"",costPrice:"",salePrice:""});
                          setShowAddModal(true);
                        }} style={{padding:"6px 14px",borderRadius:7,border:"1px solid rgba(58,122,82,0.3)",background:"rgba(58,122,82,0.1)",color:T.green,cursor:"pointer",fontSize:12,fontFamily:"'Sarabun',sans-serif",fontWeight:600}}>
                          ➕ เพิ่มสินค้าใหม่ด้วยบาร์โค้ดนี้
                        </button>
                        <button onClick={()=>{setBarcodeSearch("");setBarcodeErr("");}} style={{padding:"6px 12px",borderRadius:7,border:`1px solid ${T.border}`,background:"transparent",color:T.sub,cursor:"pointer",fontSize:12,fontFamily:"'Sarabun',sans-serif"}}>
                          ล้างค่า
                        </button>
                      </div>
                    )}
                  </div>
                )}
                {barcodeResult&&(
                  <div style={{marginTop:14,padding:16,background:"#eff6ff",border:`1px solid ${T.navActiveBorder}`,borderRadius:10}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
                      <div><div style={{fontWeight:700,color:T.text,fontSize:15}}>{barcodeResult.name}</div><div style={{fontSize:12,color:T.sub}}>{barcodeResult.code} · {barcodeResult.category}</div></div>
                      <Badge bg={`${statusColor(barcodeResult)}15`} color={statusColor(barcodeResult)}>{statusLabel(barcodeResult)}</Badge>
                    </div>
                    <div style={{display:"flex",gap:24,marginBottom:14}}>
                      <div><div style={{fontSize:10,color:T.muted}}>คงเหลือ</div><div style={{fontSize:24,fontWeight:700,color:statusColor(barcodeResult),fontFamily:"monospace"}}>{barcodeResult.qty} {barcodeResult.unit}</div></div>
                      <div><div style={{fontSize:10,color:T.muted}}>ขั้นต่ำ</div><div style={{fontSize:24,fontWeight:700,color:T.muted,fontFamily:"monospace"}}>{barcodeResult.minQty} {barcodeResult.unit}</div></div>
                    </div>
                    <BarcodeDisplay value={barcodeResult.barcode}/>
                  </div>
                )}
              </CardBox>
              <CardBox>
                <div style={{fontSize:13,fontWeight:600,color:T.text,marginBottom:14}}>บาร์โค้ดสินค้าทั้งหมด ({products.length})</div>
                {products.length===0?<div style={{color:T.muted,fontSize:13}}>ยังไม่มีสินค้า</div>:products.map(p=>(
                  <div key={p.id} style={{display:"flex",alignItems:"center",gap:14,padding:"10px 0",borderBottom:`1px solid ${T.border}`}}>
                    <div style={{flex:1}}><div style={{fontSize:13,fontWeight:500,color:T.text}}>{p.name}</div><div style={{fontSize:10,color:T.muted}}>{p.code}</div></div>
                    <BarcodeDisplay value={p.barcode}/>
                  </div>
                ))}
              </CardBox>
            </div>
          )}

          {/* CLOTHING MERGED INTO INVENTORY */}
          {false&&(
            <div style={{animation:"fadeUp 0.4s ease"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
                <div style={{fontSize:12,color:T.sub}}>สต็อกเสื้อผ้า <b style={{color:T.accent}}>{clothingItems.length} รุ่น</b> · {clothingItems.reduce((s,i)=>s+(i.colors||[]).length,0)} สี</div>
                <div style={{display:"flex",gap:8,alignItems:"center"}}>
                  <button onClick={()=>setCollapsedItems(clothingItems.reduce((a,i)=>({...a,[i.id]:true}),{}))} style={{padding:"7px 14px",borderRadius:8,border:`1px solid ${T.border}`,background:"transparent",color:T.sub,fontSize:12,cursor:"pointer",fontFamily:"'Sarabun',sans-serif"}}>⊟ พับทั้งหมด</button>
                  <button onClick={()=>setCollapsedItems({})} style={{padding:"7px 14px",borderRadius:8,border:`1px solid ${T.border}`,background:"transparent",color:T.sub,fontSize:12,cursor:"pointer",fontFamily:"'Sarabun',sans-serif"}}>⊞ ขยายทั้งหมด</button>
                  <button onClick={()=>setShowAddClothing(true)} style={{padding:"8px 18px",borderRadius:9,border:"none",cursor:"pointer",background:"linear-gradient(135deg,#3b5b8b,#3b5b8b)",color:"white",fontSize:12,fontWeight:600,fontFamily:"'DM Sans','Sarabun',sans-serif",boxShadow:"0 4px 14px rgba(59,91,139,0.3)"}}>️ เพิ่มรุ่นใหม่</button>
                </div>
              </div>

              <input ref={clothingImgRef} type="file" accept="image/*" style={{display:"none"}} onChange={handleClothingImageUpload}/>

              {clothingItems.length===0&&(
                <div style={{textAlign:"center",padding:60,background:T.card,borderRadius:16,border:`1px solid ${T.border}`}}>
                  <div style={{fontSize:48,marginBottom:12,opacity:0.3}}>👕</div>
                  <div style={{fontSize:14,fontWeight:600,color:T.accent,marginBottom:6}}>ยังไม่มีรุ่นสินค้า</div>
                  <div style={{fontSize:11,color:T.muted}}>กด "️ เพิ่มรุ่นใหม่" เพื่อเริ่มต้น</div>
                </div>
              )}

              {clothingItems.map((item,idx)=>(
                <div key={item.id} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:16,marginBottom:16,overflow:"hidden",boxShadow:"0 8px 32px rgba(0,0,0,0.3)",animation:"fadeUp 0.4s ease both",animationDelay:`${idx*0.06}s`}}>

                  {/* Item header */}
                  <div style={{display:"flex",alignItems:"center",gap:14,padding:"14px 20px",borderBottom:`1px solid ${T.border}`}}>
                    <div onClick={()=>{setUploadingClothingId(item.id);setTimeout(()=>clothingImgRef.current?.click(),50);}} style={{width:65,height:65,borderRadius:10,background:"rgba(59,91,139,0.08)",border:"2px dashed rgba(59,91,139,0.3)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",flexShrink:0,cursor:"pointer",overflow:"hidden"}}>
                      {item.image?<img src={item.image} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/>:<><span style={{fontSize:20}}>👕</span><span style={{fontSize:8,color:T.muted}}>เพิ่มรูป</span></>}
                    </div>
                    <div style={{flex:1}}>
                      <div style={{fontSize:14,fontWeight:700,color:T.text,fontFamily:"'DM Sans','Sarabun',sans-serif"}}>{item.model}</div>
                      <div style={{fontSize:11,color:T.muted,marginTop:2}}>{(item.colors||[]).length} สี · สต็อกรวม {(item.colors||[]).reduce((s,c)=>s+Object.values(c.stock||{}).reduce((a,b)=>a+b,0),0)} ชิ้น</div>
                    </div>
                    <button onClick={()=>setShowAddColor(item.id)} style={{padding:"7px 14px",borderRadius:8,border:"1px solid rgba(59,91,139,0.25)",background:"rgba(59,91,139,0.08)",color:T.accent,cursor:"pointer",fontSize:12,fontFamily:"'DM Sans','Sarabun',sans-serif",fontWeight:500}}>️ เพิ่มสี</button>
                    {role.canDelete&&<button onClick={()=>{setDeleteClothingTarget(item);setDeleteConfirmText("");}} style={{padding:"7px 12px",borderRadius:8,border:"1px solid rgba(248,113,113,0.25)",background:"rgba(248,113,113,0.08)",color:"#f87171",cursor:"pointer",fontSize:12}}>✕</button>}
                  </div>

                  {/* Table */}
                  {(item.colors||[]).length===0?(
                    <div style={{padding:"24px",textAlign:"center",color:T.muted,fontSize:12}}>ยังไม่มีสี — กด "️ เพิ่มสี"</div>
                  ):(
                    <div style={{overflowX:"auto"}}>
                      <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                        <thead>
                          <tr style={{background:"rgba(241,243,246,0.8)"}}>
                            <th style={{padding:"8px 14px",textAlign:"left",color:T.muted,fontWeight:600,fontSize:10,textTransform:"uppercase",letterSpacing:"0.06em",width:110,borderRight:`1px solid ${T.border}`}}>สี</th>
                            {sizesFor(item).map(sz=>(
                              <th key={sz} style={{padding:"8px 5px",textAlign:"center",color:T.accent,fontWeight:700,fontSize:10,borderRight:`1px solid rgba(203,210,217,0.4)`,fontFamily:"'DM Mono',monospace",minWidth:40}}>{sz}</th>
                            ))}
                            <th style={{padding:"8px 10px",textAlign:"center",color:T.muted,fontWeight:600,fontSize:10,textTransform:"uppercase",minWidth:50}}>รวม</th>
                            <th style={{width:30}}/>
                          </tr>
                        </thead>
                        <tbody>
                          {(item.colors||[]).map((col,ci)=>{
                            const total=Object.values(col.stock||{}).reduce((a,b)=>a+b,0);
                            return (
                              <tr key={ci} style={{borderBottom:`1px solid rgba(203,210,217,0.5)`}}
                                onMouseEnter={e=>e.currentTarget.style.background="rgba(59,91,139,0.04)"}
                                onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                                <td style={{padding:"8px 14px",borderRight:`1px solid ${T.border}`}}>
                                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                                    <div style={{width:14,height:14,borderRadius:3,background:col.hex,border:"1px solid rgba(255,255,255,0.15)",flexShrink:0}}/>
                                    <span style={{color:T.text,fontWeight:500,fontSize:11,fontFamily:"'DM Sans','Sarabun',sans-serif"}}>{col.colorName}</span>
                                  </div>
                                </td>
                                {sizesFor(item).map(sz=>{
                                  const isEd=editingStock?.itemId===item.id&&editingStock?.ci===ci&&editingStock?.size===sz;
                                  const val=(col.stock||{})[sz]||0;
                                  return (
                                    <td key={sz} style={{padding:"4px 2px",textAlign:"center",borderRight:"1px solid rgba(203,210,217,0.4)"}}>
                                      {isEd?(
                                        <input autoFocus type="number" defaultValue={val}
                                          onBlur={e=>handleUpdateClothingStock(item.id,ci,sz,e.target.value)}
                                          onKeyDown={e=>{if(e.key==="Enter"||e.key==="Escape")e.target.blur();}}
                                          style={{width:36,textAlign:"center",background:"rgba(59,91,139,0.15)",border:"1px solid #3b5b8b",borderRadius:5,color:"#3b5b8b",fontFamily:"'DM Mono',monospace",fontSize:11,padding:"3px 2px",outline:"none"}}/>
                                      ):(
                                        <div onClick={()=>setEditingStock({itemId:item.id,ci,size:sz})}
                                          style={{padding:"4px 2px",borderRadius:5,cursor:"pointer",fontFamily:"'DM Mono',monospace",fontWeight:600,fontSize:12,color:val===0?"#9aa5b1":val<5?"#fbbf24":"#22d3ee",minWidth:36,display:"inline-block",transition:"all 0.15s"}}
                                          onMouseEnter={e=>{e.currentTarget.style.background="rgba(59,91,139,0.12)";e.currentTarget.style.color="#3b5b8b";}}
                                          onMouseLeave={e=>{e.currentTarget.style.background="transparent";e.currentTarget.style.color=val===0?"#9aa5b1":val<5?"#fbbf24":"#22d3ee";}}>
                                          {val===0?"—":val}
                                        </div>
                                      )}
                                    </td>
                                  );
                                })}
                                <td style={{textAlign:"center",padding:"4px 6px"}}>
                                  <span style={{fontFamily:"'DM Mono',monospace",fontWeight:700,fontSize:12,color:T.accent}}>{total}</span>
                                </td>
                                <td style={{textAlign:"center",padding:"4px 6px"}}>
                                  {role.canDelete&&<button onClick={()=>handleDeleteClothingColor(item.id,ci)} style={{background:"rgba(248,113,113,0.08)",border:"1px solid rgba(248,113,113,0.2)",borderRadius:5,padding:"2px 6px",cursor:"pointer",fontSize:10,color:"#f87171"}}>✕</button>}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ))}

              {/* ── MODAL: เพิ่มรุ่นใหม่ ── */}
              {showAddClothing&&(
                <div style={{position:"fixed",inset:0,background:T.overlay,display:"flex",alignItems:"center",justifyContent:"center",zIndex:300,backdropFilter:"blur(6px)"}}>
                  <div onMouseDown={e=>e.stopPropagation()} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:16,padding:28,width:420,boxShadow:"0 24px 60px rgba(0,0,0,0.6)"}}>
                    <div style={{fontSize:15,fontWeight:700,color:T.accent,marginBottom:20,fontFamily:"'DM Sans','Sarabun',sans-serif"}}>️ เพิ่มรุ่นสินค้าใหม่</div>
                    <label style={{fontSize:11,color:T.muted,display:"block",marginBottom:6,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em"}}>ชื่อรุ่น *</label>
                    <input value={newModel} onChange={e=>setNewModel(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleAddClothingItem()} placeholder="เช่น รุ่น A Premium, Classic V2..."
                      style={{width:"100%",background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:9,padding:"9px 14px",fontFamily:"'DM Sans','Sarabun',sans-serif",fontSize:13,outline:"none",marginBottom:20}}/>
                    <div style={{display:"flex",gap:10}}>
                      <button onClick={()=>{setShowAddClothing(false);setNewModel("");}} style={{flex:1,padding:"9px",borderRadius:9,border:`1px solid ${T.border}`,background:"transparent",color:T.sub,fontSize:13,cursor:"pointer",fontFamily:"'DM Sans','Sarabun',sans-serif"}}>ยกเลิก</button>
                      <button onClick={handleAddClothingItem} disabled={!newModel.trim()} style={{flex:1,padding:"9px",borderRadius:9,border:"none",background:"linear-gradient(135deg,#3b5b8b,#3b5b8b)",color:"white",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"'DM Sans','Sarabun',sans-serif",opacity:!newModel.trim()?0.45:1}}>✅ สร้างรุ่น</button>
                    </div>
                  </div>
                </div>
              )}

              {/* ── MODAL: เพิ่มสี ── (DEPRECATED inline modal — top-level modal ด้านล่างใช้แทน) */}
              {false && showAddColor&&(
                <div style={{position:"fixed",inset:0,background:T.overlay,display:"flex",alignItems:"center",justifyContent:"center",zIndex:300,backdropFilter:"blur(6px)"}}>
                  <div onMouseDown={e=>e.stopPropagation()} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:16,padding:28,width:480,boxShadow:"0 24px 60px rgba(0,0,0,0.6)"}}>
                    <div style={{fontSize:15,fontWeight:700,color:T.accent,marginBottom:20,fontFamily:"'DM Sans','Sarabun',sans-serif"}}>🎨 เพิ่มสีใหม่</div>

                    {/* Preset colors */}
                    <div style={{fontSize:11,color:T.muted,marginBottom:10,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em"}}>เลือกสีที่มี</div>
                    <div style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:18}}>
                      {PRESET_COLORS.map(c=>{
                        const item=clothingItems.find(i=>i.id===showAddColor);
                        const already=(item?.colors||[]).some(cl=>cl.colorName===c.name);
                        return (
                          <div key={c.name} onClick={()=>!already&&handleAddColorToItem(showAddColor,{colorName:c.name,hex:c.hex})}
                            style={{display:"flex",alignItems:"center",gap:6,padding:"6px 12px",borderRadius:20,border:`1px solid ${already?"rgba(203,210,217,0.5)":"rgba(59,91,139,0.25)"}`,cursor:already?"not-allowed":"pointer",background:already?"rgba(203,210,217,0.3)":"rgba(59,91,139,0.08)",opacity:already?0.4:1,transition:"all 0.2s"}}
                            onMouseEnter={e=>{if(!already)e.currentTarget.style.background="rgba(59,91,139,0.18)";}}
                            onMouseLeave={e=>{if(!already)e.currentTarget.style.background="rgba(59,91,139,0.08)";}}>
                            <div style={{width:12,height:12,borderRadius:3,background:c.hex,border:"1px solid rgba(255,255,255,0.2)"}}/>
                            <span style={{fontSize:12,color:already?T.muted:T.text,fontFamily:"'DM Sans','Sarabun',sans-serif"}}>{c.name}</span>
                            {already&&<span style={{fontSize:9,color:T.muted}}>✓</span>}
                          </div>
                        );
                      })}
                    </div>

                    {/* Custom */}
                    <div style={{padding:14,background:"rgba(4,18,44,0.6)",borderRadius:10,border:`1px solid ${T.border}`,marginBottom:16}}>
                      <div style={{fontSize:11,color:T.muted,marginBottom:10,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em"}}>หรือเพิ่มสีเอง</div>
                      <div style={{display:"flex",gap:10,alignItems:"center"}}>
                        <input type="color" value={newColorHex} onChange={e=>setNewColorHex(e.target.value)} style={{width:40,height:36,borderRadius:8,border:`1px solid ${T.border}`,cursor:"pointer",background:"transparent",padding:2}}/>
                        <input value={customColorName} onChange={e=>setCustomColorName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&customColorName.trim()&&handleAddColorToItem(showAddColor,{colorName:customColorName.trim(),hex:newColorHex})} placeholder="ชื่อสี เช่น เทา, กรมท่า..."
                          style={{flex:1,background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:9,padding:"9px 14px",fontFamily:"'DM Sans','Sarabun',sans-serif",fontSize:13,outline:"none"}}/>
                        <button onClick={()=>customColorName.trim()&&handleAddColorToItem(showAddColor,{colorName:customColorName.trim(),hex:newColorHex})} disabled={!customColorName.trim()}
                          style={{padding:"9px 16px",borderRadius:9,border:"none",cursor:"pointer",background:"linear-gradient(135deg,#3b5b8b,#3b5b8b)",color:"white",fontSize:12,fontWeight:600,fontFamily:"'DM Sans','Sarabun',sans-serif",opacity:!customColorName.trim()?0.45:1}}>เพิ่ม</button>
                      </div>
                    </div>

                    <button onClick={()=>{setShowAddColor(null);setCustomColorName("");setNewColorHex("#ffffff");}} style={{width:"100%",padding:"9px",borderRadius:9,border:`1px solid ${T.border}`,background:"transparent",color:T.sub,fontSize:13,cursor:"pointer",fontFamily:"'DM Sans','Sarabun',sans-serif"}}>ปิด</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── INVOICE ── */}
          {activeTab==="invoice"&&(
            <div style={{animation:"fadeUp 0.4s ease"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,flexWrap:"wrap",gap:10}}>
                <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                  {["ทั้งหมด","ออกแล้ว","รอชำระ","ชำระแล้ว","ยกเลิก"].map(s=>{
                    const st=paymentStatusStyle(s); const isAll=s==="ทั้งหมด";
                    return (
                      <button key={s} onClick={()=>setInvoiceStatusFilter(s)}
                        style={{padding:"5px 14px",borderRadius:20,fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",
                          border:invoiceStatusFilter===s?(isAll?`1px solid ${T.accent}`:st.border):`1px solid ${T.border}`,
                          background:invoiceStatusFilter===s?(isAll?"rgba(59,91,139,0.15)":st.bg):"transparent",
                          color:invoiceStatusFilter===s?(isAll?T.accent:st.color):T.muted}}>
                        {s}{!isAll&&<span style={{marginLeft:4,fontSize:10,opacity:0.7}}>({invoices.filter(x=>(x.status||"ออกแล้ว")===s).length})</span>}
                      </button>);
                  })}
                </div>
                {role.canIssueInvoice
                  ? <button onClick={()=>{setInvoiceForm({customerId:"",customerName:"",customerPhone:"",customerAddress:"",customerTaxId:"",items:[],note:"",dueDate:"",vatRate:7,discount:0,discountType:"amount",useShipping:false,shippingFee:0});setInvoiceDocType("receipt");setInvoiceVat(false);setShowNewInvoice(true);}}
                      style={{padding:"8px 18px",borderRadius:9,border:"none",cursor:"pointer",background:"linear-gradient(135deg,#3b5b8b,#3b5b8b)",color:"white",fontSize:12,fontWeight:600,fontFamily:"'Sarabun',sans-serif",boxShadow:"0 4px 14px rgba(59,91,139,0.3)"}}>＋ ออกบิลใหม่</button>
                  : <span style={{fontSize:11,color:T.muted,padding:"6px 12px",background:"rgba(241,243,246,0.4)",border:`1px solid ${T.border}`,borderRadius:8}}>👁️ โหมดดูเท่านั้น</span>}
              </div>
              {/* 🔗 แถบรวมบิล (ลอย) */}
              {selectedInvoices.size>0&&(()=>{
                const sel=invoices.filter(i=>selectedInvoices.has(i.id));
                const cname=sel[0]?.customerName;
                const sameCustomer=sel.every(i=>i.customerName===cname);
                const total=sel.reduce((s,i)=>s+(i.total||0),0);
                return (
                  <div style={{position:"fixed",bottom:24,left:"50%",transform:"translateX(-50%)",zIndex:200,display:"flex",alignItems:"center",gap:14,background:T.card,border:`1px solid ${T.amber}`,borderRadius:14,padding:"12px 18px",boxShadow:"0 10px 40px rgba(0,0,0,0.25)"}}>
                    <div style={{fontSize:13,color:T.text}}>
                      เลือก <b style={{color:T.amber}}>{sel.length}</b> บิล
                      {sameCustomer?<> · <b>{cname}</b> · รวม ฿{total.toLocaleString("th-TH",{minimumFractionDigits:2})}</>:<span style={{color:T.red,marginLeft:6}}>⚠️ คนละลูกค้า</span>}
                    </div>
                    <button onClick={handleMergeInvoices} disabled={sel.length<2||!sameCustomer}
                      style={{padding:"8px 16px",borderRadius:9,border:"none",cursor:sel.length<2||!sameCustomer?"not-allowed":"pointer",background:sel.length<2||!sameCustomer?"rgba(184,134,0,0.3)":T.amber,color:"white",fontSize:13,fontWeight:700,fontFamily:"'Sarabun',sans-serif"}}>🔗 รวมเป็นบิลเดียว</button>
                    <button onClick={()=>setSelectedInvoices(new Set())} style={{padding:"8px 12px",borderRadius:9,border:`1px solid ${T.border}`,background:"transparent",color:T.sub,cursor:"pointer",fontSize:12,fontFamily:"'Sarabun',sans-serif"}}>ยกเลิก</button>
                  </div>
                );
              })()}
              {invoices.length===0?(
                <div style={{textAlign:"center",padding:60,background:T.card,borderRadius:16,border:`1px solid ${T.border}`}}>
                  <div style={{fontSize:48,marginBottom:12,opacity:0.3}}>🧾</div>
                  <div style={{fontSize:14,fontWeight:600,color:T.accent,marginBottom:6}}>ยังไม่มีบิล</div>
                  <div style={{fontSize:11,color:T.muted}}>กด "＋ ออกบิลใหม่" เพื่อเริ่มต้น</div>
                </div>
              ):(()=>{
                const fInv=invoiceStatusFilter==="ทั้งหมด"?invoices:invoices.filter(x=>(x.status||"ออกแล้ว")===invoiceStatusFilter);
                if(fInv.length===0) return <div style={{textAlign:"center",padding:40,color:T.muted,fontSize:13}}>ไม่พบบิลตามสถานะนี้</div>;
                const groups=fInv.reduce((acc,inv)=>{
                  const d=(inv.date||"").slice(0,10)||"ไม่ระบุวันที่";
                  if(!acc[d]) acc[d]=[];
                  acc[d].push(inv);
                  return acc;
                },{});
                const sortedDates=Object.keys(groups).sort((a,b)=>{
                  const p=(s)=>{const [d,m,y]=s.split("/");return `${y}${m}${d}`;};
                  return p(b).localeCompare(p(a));
                });
                return (
                  <div style={{display:"flex",flexDirection:"column",gap:14}}>
                    {sortedDates.map(date=>{
                      const list=groups[date];
                      // ไม่นับยอดบิลที่ถูกรวมไปแล้ว (กันนับซ้ำกับบิลรวม)
                      const totalAmount=list.reduce((s,inv)=>s+(inv.mergedInto?0:(inv.total||0)),0);
                      const collapsed=collapsedInvoiceDates[date];
                      return (
                        <div key={date} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:16,overflow:"hidden"}}>
                          <div onClick={()=>setCollapsedInvoiceDates(p=>({...p,[date]:!p[date]}))} style={{padding:"10px 20px",background:"linear-gradient(90deg,rgba(59,91,139,0.12),transparent)",borderBottom:collapsed?"none":`1px solid ${T.border}`,display:"flex",alignItems:"center",gap:12,cursor:"pointer",userSelect:"none"}}
                            onMouseEnter={e=>e.currentTarget.style.background="linear-gradient(90deg,rgba(59,91,139,0.2),transparent)"}
                            onMouseLeave={e=>e.currentTarget.style.background="linear-gradient(90deg,rgba(59,91,139,0.12),transparent)"}>
                            <div style={{width:22,height:22,borderRadius:6,background:"rgba(59,91,139,0.15)",border:"1px solid rgba(59,91,139,0.25)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,color:T.accent,transition:"transform 0.2s",transform:collapsed?"rotate(-90deg)":"rotate(0deg)"}}>▼</div>
                            <div style={{fontSize:13,fontWeight:700,color:T.accent}}>📅 {date}</div>
                            <div style={{fontSize:11,color:T.muted}}>{list.length} ใบ</div>
                            <div style={{marginLeft:"auto",fontSize:12,color:"#34d399",fontFamily:"monospace",fontWeight:700}}>฿{totalAmount.toLocaleString("th-TH",{minimumFractionDigits:2})}</div>
                          </div>
                          {!collapsed&&<>
                          <div style={{display:"grid",gridTemplateColumns:"90px 80px 1fr 120px 100px 140px 100px",alignItems:"center",padding:"8px 20px",background:"rgba(241,243,246,0.5)",borderBottom:`1px solid ${T.border}`,color:T.muted,fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.06em"}}>
                            <div>เลขที่</div><div>ประเภท</div><div>ลูกค้า</div><div style={{textAlign:"right"}}>ยอดรวม</div><div>วันที่</div><div>สถานะชำระ</div><div style={{textAlign:"center"}}>จัดการ</div>
                          </div>
                          {list.map((inv,i)=>{
                            const st=paymentStatusStyle(inv.status||"ออกแล้ว");
                            return (
                            <div key={inv.id} onClick={()=>setShowPrintInvoice(inv)} title="คลิกเพื่อดูใบบิล"
                              style={{display:"grid",gridTemplateColumns:"90px 80px 1fr 120px 100px 140px 100px",alignItems:"center",padding:"13px 20px",borderBottom:i<list.length-1?`1px solid ${T.border}`:"none",transition:"background 0.15s",cursor:"pointer",opacity:inv.mergedInto?0.5:1,background:selectedInvoices.has(inv.id)?"rgba(184,134,0,0.08)":"transparent"}}
                              onMouseEnter={e=>{if(!selectedInvoices.has(inv.id))e.currentTarget.style.background="rgba(59,91,139,0.08)";}}
                              onMouseLeave={e=>{if(!selectedInvoices.has(inv.id))e.currentTarget.style.background="transparent";}}>
                              <div style={{display:"flex",alignItems:"center",gap:6}} onClick={e=>e.stopPropagation()}>
                                {!inv.mergedInto&&!inv.convertedTo&&(
                                  <input type="checkbox" checked={selectedInvoices.has(inv.id)} onChange={()=>toggleInvoiceSelect(inv.id)} title="เลือกเพื่อรวมบิล" style={{width:15,height:15,cursor:"pointer",accentColor:T.amber}}/>
                                )}
                                <span style={{fontFamily:"monospace",fontSize:11,color:T.accent,fontWeight:700}}>{inv.invoiceNo}</span>
                              </div>
                              <div><span style={{padding:"2px 8px",borderRadius:12,fontSize:10,fontWeight:600,background:"rgba(59,91,139,0.1)",color:T.accent,border:"1px solid rgba(59,91,139,0.2)"}}>{docTypeLabel(inv.docType)?.slice(0,4)}</span></div>
                              <div><div style={{fontWeight:600,color:T.text,fontSize:13,display:"flex",alignItems:"center",gap:6}}>{inv.customerName}
                                {inv.mergedInto&&<span title={`รวมเข้า ${inv.mergedInto.invoiceNo}`} style={{padding:"1px 6px",fontSize:9,background:"rgba(184,134,0,0.15)",color:T.amber,borderRadius:5,fontWeight:700}}>🔗 รวมแล้ว</span>}
                                {inv.mergedFrom?.length>0&&<span title={`รวมจาก ${inv.mergedFrom.length} บิล`} style={{padding:"1px 6px",fontSize:9,background:"rgba(58,122,82,0.15)",color:T.green,borderRadius:5,fontWeight:700}}>🔗 บิลรวม ×{inv.mergedFrom.length}</span>}
                              </div><div style={{fontSize:10,color:T.muted}}>{inv.customerPhone}</div></div>
                              <div style={{textAlign:"right",fontFamily:"monospace",fontWeight:700,color:"#34d399",fontSize:13}}>
                                ฿{(inv.total||0).toLocaleString("th-TH",{minimumFractionDigits:2})}
                                {(inv.payments||[]).length>0&&(()=>{const paid=getPaidTotal(inv);const pct=getPaidPct(inv);return(
                                  <div style={{fontSize:9,color:pct>=100?"#16a34a":T.amber,fontWeight:600,marginTop:2}}>💵 ฿{paid.toLocaleString("th-TH",{minimumFractionDigits:2})} ({pct}%)</div>
                                );})()}
                              </div>
                              <div style={{fontSize:11,color:T.muted}}>{inv.date}</div>
                              <div onClick={e=>e.stopPropagation()}>
                                <select value={inv.status||"ออกแล้ว"} onChange={e=>handleUpdateInvoiceStatus(inv.id,e.target.value)}
                                  style={{background:st.bg,border:st.border,borderRadius:10,padding:"4px 8px",fontSize:10,fontWeight:600,color:st.color,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",outline:"none"}}>
                                  {PAYMENT_STATUSES.map(s=><option key={s} value={s}>{s}</option>)}
                                </select>
                              </div>
                              <div style={{display:"flex",gap:5,justifyContent:"center",flexWrap:"wrap"}} onClick={e=>e.stopPropagation()}>
                                <button onClick={()=>openPaymentModal(inv)} title="จัดการการชำระเงิน" style={{padding:"5px 10px",borderRadius:7,border:"1px solid rgba(16,185,129,0.3)",background:"rgba(16,185,129,0.08)",color:T.green,cursor:"pointer",fontSize:11,fontFamily:"'Sarabun',sans-serif"}}>💵</button>
                                <button onClick={()=>setShowPrintInvoice(inv)} title="พิมพ์" style={{padding:"5px 10px",borderRadius:7,border:"1px solid rgba(59,91,139,0.25)",background:"rgba(59,91,139,0.08)",color:T.accent,cursor:"pointer",fontSize:11,fontFamily:"'Sarabun',sans-serif"}}>🖨️</button>
                                {role.canIssueInvoice!==false&&inv.docType==="quotation"&&!inv.convertedTo&&(
                                  <button onClick={()=>handleConvertQuotation(inv, "receipt")} title="แปลงเป็นใบเสร็จ" style={{padding:"5px 10px",borderRadius:7,border:"1px solid rgba(58,122,82,0.3)",background:"rgba(58,122,82,0.08)",color:T.green,cursor:"pointer",fontSize:11,fontFamily:"'Sarabun',sans-serif"}}>🔄</button>
                                )}
                                {inv.convertedTo&&(
                                  <span title={`แปลงเป็น ${inv.convertedTo.invoiceNo} แล้ว`} style={{padding:"5px 8px",borderRadius:7,background:"rgba(58,122,82,0.06)",color:T.green,fontSize:10,fontFamily:"'Sarabun',sans-serif"}}>✓ แปลงแล้ว</span>
                                )}
                                {inv.mergedFrom?.length>0&&role.canDelete&&(
                                  <button onClick={()=>handleUnmergeInvoice(inv)} title="ยกเลิกการรวม — คืนบิลเดิม" style={{padding:"5px 10px",borderRadius:7,border:"1px solid rgba(184,134,0,0.3)",background:"rgba(184,134,0,0.08)",color:T.amber,cursor:"pointer",fontSize:11,fontFamily:"'Sarabun',sans-serif"}}>🔓</button>
                                )}
                                {role.canIssueInvoice!==false&&<button onClick={()=>handleEditInvoice(inv)} title="แก้ไข" style={{padding:"5px 10px",borderRadius:7,border:"1px solid rgba(184,134,0,0.3)",background:"rgba(184,134,0,0.08)",color:T.amber,cursor:"pointer",fontSize:11,fontFamily:"'Sarabun',sans-serif"}}>✏️</button>}
                                {role.canDelete&&<button onClick={async()=>{
                                  if(!window.confirm(`ลบบิล ${inv.invoiceNo}? — การลบไม่สามารถกู้คืนได้ (ใช้ "แก้ไข" แทนถ้าแค่กรอกผิด)`)) return;
                                  await deleteDoc(doc(db,"invoices",inv.id));
                                  logAudit(user,{action:AUDIT_ACTIONS.DELETE,collection:"invoices",targetId:inv.id,targetLabel:`${inv.invoiceNo} · ${inv.customerName}`,before:{total:inv.total,status:inv.status,docType:inv.docType}});
                                }} title="ลบ" style={{padding:"5px 8px",borderRadius:7,border:"1px solid rgba(248,113,113,0.25)",background:"rgba(248,113,113,0.08)",color:"#f87171",cursor:"pointer",fontSize:11}}>✕</button>}
                              </div>
                            </div>);
                          })}
                          </>}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          )}

          {/* ── ORDERS ── */}
          {activeTab==="production"&&(
            <ProductionTab
              productionOrders={productionOrders||[]}
              customOrders={customOrders||[]}
              boms={boms||[]}
              products={products}
              clothingItems={clothingItems}
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
                setTimeout(() => {
                  setInvoiceForm({
                    customerId: first.customerId||"",
                    customerName: first.customerName||"",
                    customerPhone: first.customerPhone||"",
                    customerAddress: first.customerAddress||"",
                    customerTaxId: first.customerTaxId||"",
                    items,
                    note: `จาก Custom Order: ${orders.map(o=>o.prodNo).join(", ")}`,
                    dueDate: "",
                    vatRate: 7,
                    discount: 0,
                    discountType: "amount",
                    useShipping: false, shippingFee: 0,
                    customDetails,
                  });
                }, 50);
              }}
            />
          )}

          {activeTab==="orders"&&(
            <div style={{animation:"fadeUp 0.4s ease"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
                <div style={{fontSize:12,color:T.sub}}>ใบสั่งของทั้งหมด <b style={{color:T.accent}}>{orders.length} ใบ</b></div>
                {role.canCreateOrder
                  ? <button onClick={()=>{setOrderForm({customerId:"",customerName:"",customerPhone:"",customerAddress:"",note:"",items:[]});setShowNewOrder(true);}} style={{padding:"8px 18px",borderRadius:9,border:"none",cursor:"pointer",background:"linear-gradient(135deg,#3b5b8b,#3b5b8b)",color:"white",fontSize:12,fontWeight:600,fontFamily:"'Sarabun',sans-serif",boxShadow:"0 4px 14px rgba(59,91,139,0.3)"}}>️ สร้างใบสั่งของ</button>
                  : <span style={{fontSize:11,color:T.muted,padding:"6px 12px",background:"rgba(241,243,246,0.4)",border:`1px solid ${T.border}`,borderRadius:8}}>👁️ โหมดดูเท่านั้น</span>}
              </div>

              {orders.length===0?(
                <div style={{textAlign:"center",padding:60,background:T.card,borderRadius:16,border:`1px solid ${T.border}`}}>
                  <div style={{fontSize:48,marginBottom:12,opacity:0.3}}>📋</div>
                  <div style={{fontSize:14,fontWeight:600,color:T.accent,marginBottom:6}}>ยังไม่มีใบสั่งของ</div>
                  <div style={{fontSize:11,color:T.muted}}>กด "️ สร้างใบสั่งของ" เพื่อเริ่มต้น</div>
                </div>
              ):(()=>{
                // ── filter helpers ──
                const parseThaiDate=(s)=>{if(!s)return null;const [d,m,y]=String(s).slice(0,10).split("/");if(!d||!m||!y)return null;return new Date(`${y}-${m.padStart(2,"0")}-${d.padStart(2,"0")}`);};
                const filteredOrders=orders.filter(o=>{
                  if(orderSearch){const q=orderSearch.toLowerCase().trim();const hit=(o.orderNo||"").toLowerCase().includes(q)||(o.customerName||"").toLowerCase().includes(q)||(o.customerPhone||"").toLowerCase().includes(q);if(!hit)return false;}
                  const od=parseThaiDate(o.date);
                  if(orderDateFrom){const f=new Date(orderDateFrom);if(!od||od<f)return false;}
                  if(orderDateTo){const t=new Date(orderDateTo);t.setHours(23,59,59);if(!od||od>t)return false;}
                  return true;
                });
                const totalQtyAll=filteredOrders.reduce((s,o)=>s+(o.items||[]).reduce((a,i)=>a+i.qty,0),0);
                const setPreset=(preset)=>{
                  const today=new Date();const y=today.getFullYear();const m=today.getMonth();
                  const fmt=(d)=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
                  if(preset==="all"){setOrderDateFrom("");setOrderDateTo("");}
                  else if(preset==="today"){setOrderDateFrom(fmt(today));setOrderDateTo(fmt(today));}
                  else if(preset==="month"){setOrderDateFrom(fmt(new Date(y,m,1)));setOrderDateTo(fmt(new Date(y,m+1,0)));}
                  else if(preset==="year"){setOrderDateFrom(fmt(new Date(y,0,1)));setOrderDateTo(fmt(new Date(y,11,31)));}
                  else if(preset==="lastyear"){setOrderDateFrom(fmt(new Date(y-1,0,1)));setOrderDateTo(fmt(new Date(y-1,11,31)));}
                };
                const presets=[{k:"all",l:"ทั้งหมด"},{k:"today",l:"วันนี้"},{k:"month",l:"เดือนนี้"},{k:"year",l:"ปีนี้"},{k:"lastyear",l:"ปีที่แล้ว"}];

                return (<>
                {/* ── FILTER BAR ── */}
                <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:14,padding:14,marginBottom:14}}>
                  <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:10}}>
                    <input value={orderSearch} onChange={e=>setOrderSearch(e.target.value)} placeholder="🔍 ค้นหาเลขที่ใบสั่ง / ชื่อลูกค้า / เบอร์โทร"
                      style={{flex:"1 1 240px",background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:9,padding:"8px 12px",fontFamily:"'Sarabun',sans-serif",fontSize:13,outline:"none"}}/>
                    <input type="date" value={orderDateFrom} onChange={e=>setOrderDateFrom(e.target.value)}
                      style={{background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:9,padding:"8px 10px",fontSize:12,fontFamily:"'Sarabun',sans-serif"}}/>
                    <span style={{alignSelf:"center",color:T.muted,fontSize:12}}>ถึง</span>
                    <input type="date" value={orderDateTo} onChange={e=>setOrderDateTo(e.target.value)}
                      style={{background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:9,padding:"8px 10px",fontSize:12,fontFamily:"'Sarabun',sans-serif"}}/>
                  </div>
                  <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
                    {presets.map(p=>(
                      <button key={p.k} onClick={()=>setPreset(p.k)}
                        style={{padding:"5px 12px",borderRadius:14,border:`1px solid ${T.border}`,background:"transparent",color:T.sub,cursor:"pointer",fontSize:11,fontFamily:"'Sarabun',sans-serif"}}>{p.l}</button>
                    ))}
                    <div style={{flex:1}}/>
                    <div style={{fontSize:11,color:T.muted}}>
                      พบ <b style={{color:T.accent}}>{filteredOrders.length}</b> / {orders.length} ใบ
                      <span style={{margin:"0 6px",color:T.border}}>·</span>
                      รวม <b style={{color:"#16a34a"}}>{totalQtyAll.toLocaleString("th-TH")}</b> ชิ้น
                    </div>
                  </div>
                </div>

                {filteredOrders.length===0?(
                  <div style={{textAlign:"center",padding:40,background:T.card,borderRadius:14,border:`1px solid ${T.border}`}}>
                    <div style={{fontSize:36,marginBottom:8,opacity:0.3}}>🔍</div>
                    <div style={{fontSize:13,color:T.muted}}>ไม่พบใบสั่งของตามที่ค้นหา</div>
                  </div>
                ):(()=>{
                // group ตามวันที่ (10 ตัวแรก = "DD/MM/YYYY")
                const groups=filteredOrders.reduce((acc,o)=>{
                  const d=(o.date||"").slice(0,10)||"ไม่ระบุวันที่";
                  if(!acc[d]) acc[d]=[];
                  acc[d].push(o);
                  return acc;
                },{});
                const sortedDates=Object.keys(groups).sort((a,b)=>{
                  const p=(s)=>{const [d,m,y]=s.split("/");return `${y}${m}${d}`;};
                  return p(b).localeCompare(p(a));
                });
                return (
                  <div style={{display:"flex",flexDirection:"column",gap:14}}>
                    {sortedDates.map(date=>{
                      const list=groups[date];
                      const totalQty=list.reduce((s,o)=>s+(o.items||[]).reduce((a,i)=>a+i.qty,0),0);
                      const collapsed=collapsedOrderDates[date];
                      return (
                        <div key={date} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:16,overflow:"hidden"}}>
                          <div onClick={()=>setCollapsedOrderDates(p=>({...p,[date]:!p[date]}))} style={{padding:"10px 20px",background:"linear-gradient(90deg,rgba(59,91,139,0.12),transparent)",borderBottom:collapsed?"none":`1px solid ${T.border}`,display:"flex",alignItems:"center",gap:12,cursor:"pointer",userSelect:"none"}}
                            onMouseEnter={e=>e.currentTarget.style.background="linear-gradient(90deg,rgba(59,91,139,0.2),transparent)"}
                            onMouseLeave={e=>e.currentTarget.style.background="linear-gradient(90deg,rgba(59,91,139,0.12),transparent)"}>
                            <div style={{width:22,height:22,borderRadius:6,background:"rgba(59,91,139,0.15)",border:"1px solid rgba(59,91,139,0.25)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,color:T.accent,transition:"transform 0.2s",transform:collapsed?"rotate(-90deg)":"rotate(0deg)"}}>▼</div>
                            <div style={{fontSize:13,fontWeight:700,color:T.accent}}>📅 {date}</div>
                            <div style={{fontSize:11,color:T.muted}}>{list.length} ใบ · {totalQty} ชิ้น</div>
                          </div>
                          {!collapsed&&<>
                          <div style={{display:"grid",gridTemplateColumns:"100px 1fr 120px 80px 80px 100px",alignItems:"center",padding:"8px 20px",background:"rgba(241,243,246,0.5)",borderBottom:`1px solid ${T.border}`,color:T.muted,fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.06em"}}>
                            <div>เลขที่</div><div>ลูกค้า</div><div>รายการ</div><div>โดย</div><div>สถานะ</div><div style={{textAlign:"center"}}>จัดการ</div>
                          </div>
                          {list.map((o,i)=>(
                            <div key={o.id} onClick={()=>setShowPrintOrder(o)} title="คลิกเพื่อดูใบสั่งของ"
                              style={{display:"grid",gridTemplateColumns:"100px 1fr 120px 80px 80px 100px",alignItems:"center",padding:"13px 20px",borderBottom:i<list.length-1?`1px solid ${T.border}`:"none",cursor:"pointer"}}
                              onMouseEnter={e=>e.currentTarget.style.background="rgba(59,91,139,0.08)"}
                              onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                              <div style={{fontFamily:"monospace",fontSize:11,color:T.accent,fontWeight:700}}>{o.orderNo}</div>
                              <div>
                                <div style={{fontWeight:600,color:T.text,fontSize:13}}>{o.customerName}</div>
                                <div style={{fontSize:10,color:T.muted,marginTop:1}}>{o.customerPhone} · {o.date}</div>
                              </div>
                              <div style={{fontSize:12,color:T.sub}}>{(o.items||[]).length} รายการ · {(o.items||[]).reduce((s,i)=>s+i.qty,0)} ชิ้น</div>
                              <div style={{fontSize:11,color:T.sub}}>{o.by}</div>
                              <div><span style={{padding:"3px 10px",borderRadius:20,fontSize:11,fontWeight:600,background:"rgba(52,211,153,0.1)",color:"#34d399",border:"1px solid rgba(52,211,153,0.2)"}}>{o.status}</span></div>
                              <div style={{display:"flex",gap:6,justifyContent:"center"}} onClick={e=>e.stopPropagation()}>
                                <button onClick={()=>setShowPrintOrder(o)} style={{padding:"5px 10px",borderRadius:7,border:`1px solid rgba(59,91,139,0.25)`,background:"rgba(59,91,139,0.08)",color:T.accent,cursor:"pointer",fontSize:11,fontFamily:"'Sarabun',sans-serif"}}>🖨️ ปริ้น</button>
                                {role.canDelete&&<button onClick={()=>handleDeleteOrder(o)} title="ยกเลิก + คืนสต๊อก" style={{padding:"5px 8px",borderRadius:7,border:"1px solid rgba(248,113,113,0.25)",background:"rgba(248,113,113,0.08)",color:"#f87171",cursor:"pointer",fontSize:11}}>✕</button>}
                              </div>
                            </div>
                          ))}
                          </>}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
              </>);
              })()}
            </div>
          )}

          {/* ── CUSTOMERS ── */}
          {activeTab==="customers"&&(()=>{
            // จัดกลุ่มลูกค้าตามภาค + filter
            const enriched = customers.map(c => ({ ...c, _region: c.region || detectRegion(c.address), _province: c.province || detectProvince(c.address) }));
            const counts = {};
            REGIONS.forEach(r => counts[r.key] = 0);
            enriched.forEach(c => { counts[c._region] = (counts[c._region]||0) + 1; });
            const filtered = enriched.filter(c => {
              if (customerRegion !== "ทั้งหมด" && c._region !== customerRegion) return false;
              if (customerSearch) {
                // 🔍 normalize — รองรับ Thai vowel/tone marks ที่อาจ encode ต่างกัน + เคาะวรรค
                const norm = (s) => String(s||"").normalize("NFC").toLowerCase().replace(/\s+/g," ").trim();
                const q = norm(customerSearch);
                return norm(c.name).includes(q)
                  || norm(c.phone).includes(q)
                  || norm(c.address).includes(q)
                  || norm(c.email).includes(q)
                  || norm(c._province).includes(q)
                  || norm(c.taxId).includes(q)
                  || norm(c.note).includes(q);
              }
              return true;
            });
            return (
            <div style={{animation:"fadeUp 0.4s ease",maxWidth:1000}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14,flexWrap:"wrap",gap:10}}>
                <div style={{fontSize:12,color:T.sub}}>ลูกค้าทั้งหมด <b style={{color:T.accent}}>{customers.length} ราย</b> · กรองแล้ว {filtered.length}</div>
                <div style={{display:"flex",gap:8}}>
                  {role.canAdd&&<button onClick={()=>setShowImportCustomers(true)} style={{padding:"8px 14px",borderRadius:9,border:`1px solid ${T.border}`,cursor:"pointer",background:"rgba(59,91,139,0.06)",color:T.accent,fontSize:12,fontWeight:600,fontFamily:"'Sarabun',sans-serif"}}>📥 นำเข้า Excel</button>}
                  <button onClick={()=>setShowNewCustomer(true)} style={{padding:"8px 18px",borderRadius:9,border:"none",cursor:"pointer",background:"linear-gradient(135deg,#3b5b8b,#3b5b8b)",color:"white",fontSize:12,fontWeight:600,fontFamily:"'Sarabun',sans-serif",boxShadow:"0 4px 14px rgba(59,91,139,0.3)"}}>＋ เพิ่มลูกค้าใหม่</button>
                </div>
              </div>

              {/* Region filter tabs */}
              <div style={{display:"flex",gap:6,marginBottom:12,flexWrap:"wrap"}}>
                <button onClick={()=>setCustomerRegion("ทั้งหมด")}
                  style={{padding:"7px 14px",borderRadius:9,border:`1px solid ${customerRegion==="ทั้งหมด"?T.accent:T.border}`,background:customerRegion==="ทั้งหมด"?"rgba(59,91,139,0.12)":"transparent",color:customerRegion==="ทั้งหมด"?T.accent:T.sub,cursor:"pointer",fontSize:12,fontWeight:customerRegion==="ทั้งหมด"?700:500,fontFamily:"'Sarabun',sans-serif"}}>
                  🌍 ทั้งหมด <span style={{marginLeft:4,fontSize:10,opacity:0.7}}>({customers.length})</span>
                </button>
                {REGIONS.map(r => {
                  const sel = customerRegion === r.key;
                  const ct = counts[r.key] || 0;
                  if (ct === 0 && r.key !== "unknown") return null; // ซ่อนภาคที่ไม่มีลูกค้า
                  return (
                    <button key={r.key} onClick={()=>setCustomerRegion(r.key)}
                      style={{padding:"7px 14px",borderRadius:9,border:`1px solid ${sel?r.color:T.border}`,background:sel?`${r.color}20`:"transparent",color:sel?r.color:T.sub,cursor:"pointer",fontSize:12,fontWeight:sel?700:500,fontFamily:"'Sarabun',sans-serif"}}>
                      {r.icon} {r.label} <span style={{marginLeft:4,fontSize:10,opacity:0.7}}>({ct})</span>
                    </button>
                  );
                })}
              </div>

              <div style={{marginBottom:14}}>
                <input value={customerSearch} onChange={e=>setCustomerSearch(e.target.value)} placeholder="🔍 ค้นหาชื่อ เบอร์ ที่อยู่ จังหวัด..."
                  style={{width:"100%",background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:9,padding:"9px 14px",fontFamily:"'Sarabun',sans-serif",fontSize:13,outline:"none"}}/>
              </div>

              {customers.length===0?(
                <div style={{textAlign:"center",padding:60,background:T.card,borderRadius:16,border:`1px solid ${T.border}`}}>
                  <div style={{fontSize:48,marginBottom:12,opacity:0.3}}>👤</div>
                  <div style={{fontSize:14,fontWeight:600,color:T.accent,marginBottom:6}}>ยังไม่มีข้อมูลลูกค้า</div>
                  <div style={{fontSize:11,color:T.muted}}>กด "️ เพิ่มลูกค้าใหม่" เพื่อเริ่มต้น</div>
                </div>
              ):filtered.length===0?(
                <div style={{textAlign:"center",padding:40,color:T.muted,fontSize:13}}>ไม่พบลูกค้าตามเงื่อนไข</div>
              ):(
                <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:16,overflow:"hidden"}}>
                  {filtered.map((c,i,arr)=>{
                    const rm = regionMeta(c._region);
                    return (
                    <div key={c.id} style={{display:"flex",alignItems:"center",gap:14,padding:"14px 20px",borderBottom:i<arr.length-1?`1px solid ${T.border}`:"none",cursor:"pointer"}}
                      onClick={()=>setProfileCustomer(c)}
                      onMouseEnter={e=>e.currentTarget.style.background="rgba(59,91,139,0.04)"}
                      onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                      <div style={{width:48,height:48,borderRadius:"50%",background:`linear-gradient(135deg,${rm.color},${rm.color}dd)`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0,boxShadow:`0 4px 10px ${rm.color}55`}}>{rm.icon}</div>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:2,flexWrap:"wrap"}}>
                          <span style={{fontWeight:600,color:T.text,fontSize:13}}>{c.name}</span>
                          <span style={{padding:"1px 8px",borderRadius:10,fontSize:9,fontWeight:700,background:`${rm.color}15`,color:rm.color,border:`1px solid ${rm.color}30`}}>{rm.label}</span>
                          {c._province && <span style={{fontSize:10,color:T.muted}}>{c._province}</span>}
                        </div>
                        <div style={{fontSize:11,color:T.muted}}>📞 {c.phone||"-"}</div>
                        <div style={{fontSize:11,color:T.muted,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>📍 {c.address||"-"}</div>
                      </div>
                      <div style={{fontSize:11,color:T.sub,textAlign:"right"}}>
                        <div>สั่งซื้อ {orders.filter(o=>o.customerId===c.id).length} ครั้ง</div>
                        <div style={{color:T.accent,fontSize:10,marginTop:2}}>👁 ดูโปรไฟล์</div>
                      </div>
                      {role.canAdd&&<button onClick={(e)=>{e.stopPropagation(); setEditingCustomer({...c});}}
                        title="แก้ไขชื่อ/ที่อยู่/เบอร์"
                        style={{padding:"5px 9px",borderRadius:7,border:"1px solid rgba(59,91,139,0.25)",background:"rgba(59,91,139,0.08)",color:T.accent,cursor:"pointer",fontSize:11}}>✏️</button>}
                      {role.canDelete&&<button onClick={async(e)=>{
                        e.stopPropagation();
                        if (!window.confirm(`ลบลูกค้า "${c.name}"?`)) return;
                        await deleteDoc(doc(db,"customers",c.id));
                        logAudit(user,{action:AUDIT_ACTIONS.DELETE,collection:"customers",targetId:c.id,targetLabel:c.name,before:{name:c.name,phone:c.phone}});
                      }} style={{padding:"5px 8px",borderRadius:7,border:"1px solid rgba(248,113,113,0.25)",background:"rgba(248,113,113,0.08)",color:"#f87171",cursor:"pointer",fontSize:11}}>✕</button>}
                    </div>
                  );})}
                </div>
              )}
            </div>
            );
          })()}

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
            <ReportsTab products={products} transactions={transactions} invoices={invoices} orders={orders} customers={customers} clothingItems={clothingItems}/>
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
            <EmployeeTab employees={employees} user={user} role={role}/>
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
            <TaxDocsTab taxDocs={taxDocs} user={user} role={role}/>
          )}

          {/* ── CATALOG INBOX — order จาก /catalog ── */}
          {activeTab==="catalogInbox"&&(
            <CatalogInboxTab
              catalogOrders={catalogOrders}
              clothingItems={clothingItems}
              customers={customers}
              user={user}
              onConvert={async (co, customerChoice) => {
                // customerChoice = { mode: "new" | "existing" | "none", existingId?: string }
                let customerId = "";
                if (customerChoice?.mode === "existing") {
                  customerId = customerChoice.existingId || "";
                } else if (customerChoice?.mode === "new") {
                  const newCust = {
                    name: co.customerName || "(ลูกค้าใหม่)",
                    phone: co.phone || "",
                    address: co.address || "",
                    taxId: "",
                    note: "จาก Catalog",
                    createdAt: serverTimestamp(),
                  };
                  const cref = await addDoc(collection(db, "customers"), newCust);
                  customerId = cref.id;
                }
                // mode === "none" → customerId = "" (one-time)
                // 2) แปลง entries → items (รองรับ multi-item cart + single-item เก่า)
                const items = [];
                const cartEntries = (co.items && co.items.length > 0)
                  ? co.items
                  : [{ itemId: co.itemId, itemName: co.itemName, lines: co.lines || [] }];
                for (const entry of cartEntries) {
                  const ci = clothingItems.find(c => c.id === entry.itemId);
                  if (!ci) continue;
                  for (const ln of (entry.lines||[])) {
                    let colorIdx = (typeof ln.colorIdx === "number" && ln.colorIdx >= 0)
                      ? ln.colorIdx
                      : (ci.colors||[]).findIndex(c => c.name === ln.color);
                    if (colorIdx < 0 || colorIdx >= (ci.colors||[]).length) continue;
                    const colorData = ci.colors[colorIdx];
                    const unitPrice = getPriceForSize(colorData, ln.size) || 0;
                    items.push({
                      clothingId: ci.id,
                      clothingName: ci.model || ci.name || `สินค้า ${ci.id.slice(0,6)}`,
                      colorIdx,
                      colorName: colorData.name || ln.color || `สี #${colorIdx+1}`,
                      size: ln.size,
                      qty: Number(ln.qty)||0,
                      unitPrice,
                    });
                  }
                }
                if (items.length === 0) {
                  alert("⚠️ ไม่สามารถแปลงได้ — ไม่พบสินค้า/สี/ไซส์ ที่ตรงกับในระบบ\n(สินค้าอาจถูกลบไปแล้ว)");
                  return;
                }
                // 3) สร้าง order (status: รอดำเนินการ — ยังไม่ตัดสต็อก)
                const orderNo = generateDocNo("ORD", orders, "orderNo");
                const newOrder = {
                  orderNo,
                  customerId,
                  customerName: co.customerName || "",
                  customerPhone: co.phone || "",
                  customerAddress: co.address || "",
                  note: `จาก Catalog Inbox${co.note?` · ${co.note}`:""}`,
                  items,
                  status: "รอดำเนินการ",
                  by: user.name,
                  date: now(),
                  createdAt: serverTimestamp(),
                  fromCatalog: co.id,
                };
                const oref = await addDoc(collection(db, "orders"), newOrder);
                // 4) อัพเดต catalogOrder = converted
                await updateDoc(doc(db, "catalogOrders", co.id), {
                  status: "converted",
                  convertedOrderId: oref.id,
                  convertedOrderNo: orderNo,
                });
                logAudit(user, {
                  action: AUDIT_ACTIONS.CREATE,
                  collection: "orders",
                  targetId: oref.id,
                  targetLabel: `${orderNo} · ${co.customerName}`,
                  note: `แปลงจาก Catalog · ${items.length} รายการ`,
                });
                alert(`✅ สร้างคำสั่งซื้อ ${orderNo} แล้ว\nไปที่ tab "คำสั่งซื้อ" เพื่อยืนยัน/ปริ้น/ตัดสต็อก`);
              }}
            />
          )}

          {/* ── STATEMENTS (ใบวางบิลรวมเดือน) ── */}
          {activeTab==="statements"&&(
            <StatementTab
              statements={statements}
              invoices={invoices}
              customers={customers}
              companyInfo={companyInfo}
              user={user}
              role={role}
              printElementById={printElementById}
            />
          )}


        </div>
      </div>

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
                inp.onchange=async (e)=>{const f=e.target.files?.[0];if(!f)return;try{const dataUrl=await compressImage(f,{maxDim:1000,quality:0.75});setEditingProduct(p=>({...p,image:dataUrl}));}catch(err){alert("โหลดรูปไม่สำเร็จ: "+(err?.message||err));}};
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
              await updateDoc(doc(db,"products",showImgModal.id),{image:dataUrl,lastUpdate:now()});
              setShowImgModal(p=>({...p,image:dataUrl}));
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
      {deleteClothingTarget&&(()=>{
        const it = deleteClothingTarget;
        const totalStock = (it.colors||[]).reduce((s,c)=>s+Object.values(c.stock||{}).reduce((a,b)=>a+(Number(b)||0),0),0);
        const matched = deleteConfirmText.trim() === (it.model||"").trim();
        const hasStock = totalStock > 0;
        return (
        <Modal onClose={()=>setDeleteClothingTarget(null)} w={460}>
          <div style={{textAlign:"center",marginBottom:6}}>
            <div style={{fontSize:42,marginBottom:8}}>🗑️</div>
            <div style={{fontSize:16,fontWeight:800,color:T.text}}>ลบรุ่น "{it.model}"?</div>
          </div>
          <div style={{padding:"10px 12px",background:hasStock?"#fef2f2":"#fffbeb",border:`1px solid ${hasStock?"#fecaca":"#fde68a"}`,borderRadius:9,marginBottom:14,fontSize:13,color:hasStock?"#991b1b":"#92400e",lineHeight:1.6}}>
            {hasStock
              ? <>⚠️ รุ่นนี้ยัง<b>มีสต็อก {totalStock.toLocaleString("th-TH")} ตัว</b> ({(it.colors||[]).length} สี)<br/>ถ้าลบ ข้อมูลสต็อก + ประวัติทั้งหมดจะหายถาวร — ย้อนคืนไม่ได้</>
              : <>รุ่นนี้ไม่มีสต็อกแล้ว · {(it.colors||[]).length} สี — ลบแล้วย้อนคืนไม่ได้</>}
          </div>
          <label style={{fontSize:12,color:T.sub,display:"block",marginBottom:6}}>พิมพ์ชื่อรุ่น <b style={{color:T.text}}>{it.model}</b> เพื่อยืนยัน:</label>
          <input value={deleteConfirmText} onChange={e=>setDeleteConfirmText(e.target.value)} placeholder={it.model} autoFocus
            style={{width:"100%",boxSizing:"border-box",background:T.input,border:`1px solid ${matched?"#16a34a":T.inputBorder}`,color:T.text,borderRadius:9,padding:"10px 14px",fontFamily:"'Sarabun',sans-serif",fontSize:14,outline:"none",marginBottom:16}}/>
          <div style={{display:"flex",gap:10}}>
            <BtnGhost onClick={()=>setDeleteClothingTarget(null)} style={{flex:1}}>ยกเลิก</BtnGhost>
            <BtnDanger onClick={async()=>{await handleDeleteClothingItem(it.id);setDeleteClothingTarget(null);setDeleteConfirmText("");}} disabled={!matched} style={{flex:1,opacity:matched?1:0.45,cursor:matched?"pointer":"not-allowed"}}>🗑 ลบถาวร</BtnDanger>
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
                  note: (editingCustomer.note||"").trim(),
                  region: detectRegion(editingCustomer.address||""),
                  province: detectProvince(editingCustomer.address||"") || "",
                };
                await updateDoc(doc(db,"customers",editingCustomer.id), updated);
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

      {/* ── MODAL: Settings ── */}
      {showSettings&&(
        <Modal onClose={()=>setShowSettings(false)} w={640}>
          <MHead title="⚙️ ตั้งค่าระบบ" onClose={()=>setShowSettings(false)}/>
          {/* Settings tabs */}
          <div style={{display:"flex",gap:4,marginBottom:20,borderBottom:`1px solid ${T.border}`,paddingBottom:12}}>
            {[{id:"profile",label:"👤 โปรไฟล์"},...(user.role==="admin"?[{id:"system",label:"🏢 ระบบ"},{id:"backup",label:"💾 Backup"}]:[]),{id:"install",label:"📱 ติดตั้งแอป"},{id:"about",label:"ℹ️ เกี่ยวกับ"}].map(t=>(
              <button key={t.id} onClick={()=>setSettingsTab(t.id)} style={{padding:"7px 16px",borderRadius:8,border:settingsTab===t.id?`1px solid ${T.navActiveBorder}`:`1px solid transparent`,background:settingsTab===t.id?"rgba(59,91,139,0.15)":"transparent",color:settingsTab===t.id?"#3b5b8b":T.sub,cursor:"pointer",fontSize:13,fontFamily:"'Sarabun',sans-serif",fontWeight:settingsTab===t.id?600:400}}>{t.label}</button>
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
      {showNewOrder&&(
        <Modal onClose={()=>setShowNewOrder(false)} w={880}>
          <MHead title="📋 สร้างใบสั่งของ" onClose={()=>setShowNewOrder(false)} color={T.accent}/>

          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:20}}>
            {/* Customer section */}
            <div style={{gridColumn:"1/-1"}}>
              <div style={{fontSize:12,fontWeight:700,color:T.accent,marginBottom:10,textTransform:"uppercase",letterSpacing:"0.06em"}}>ข้อมูลลูกค้า</div>
              {/* Search existing customer */}
              <div style={{position:"relative",marginBottom:10}}>
                <input placeholder="🔍 ค้นหาลูกค้าเดิม หรือพิมพ์ชื่อใหม่..."
                  value={orderForm.customerId ? `✓ ${orderForm.customerName}` : customerSearch}
                  onChange={e=>{setCustomerSearch(e.target.value);setOrderForm(f=>({...f,customerId:"",customerName:e.target.value,customerPhone:"",customerAddress:""}));}}
                  style={{width:"100%",background:T.input,border:`1px solid ${orderForm.customerId?"#34d399":T.inputBorder}`,color:T.text,borderRadius:9,padding:"9px 14px",fontFamily:"'Sarabun',sans-serif",fontSize:13,outline:"none"}}/>
                {customerSearch&&!orderForm.customerId&&(()=>{
                  // 🔍 ค้นหาแบบ normalize — NFC unicode + lower + ลบช่องว่าง — รองรับ Thai vowel marks
                  const norm = (s) => String(s||"").normalize("NFC").toLowerCase().replace(/\s+/g," ").trim();
                  const q = norm(customerSearch);
                  const matches = customers.filter(c => {
                    if (!q) return true;
                    return norm(c.name).includes(q)
                      || norm(c.phone).includes(q)
                      || norm(c.address).includes(q)
                      || norm(c.taxId).includes(q);
                  });
                  return (
                  <div style={{position:"absolute",top:"100%",left:0,right:0,background:"#ffffff",border:`1px solid ${T.border}`,borderRadius:10,zIndex:50,maxHeight:280,overflowY:"auto",boxShadow:"0 8px 24px rgba(0,0,0,0.4)"}}>
                    {matches.length > 0 && (
                      <div style={{padding:"6px 14px",background:"#eff6ff",fontSize:10,color:T.blue,fontWeight:700,borderBottom:`1px solid ${T.border}`,position:"sticky",top:0}}>
                        เจอ {matches.length} ราย {matches.length > 30 && "(แสดง 30 รายแรก — พิมพ์เพิ่มเพื่อกรอง)"}
                      </div>
                    )}
                    {matches.slice(0,30).map(c=>(
                      <div key={c.id} onClick={()=>handleSelectCustomer(c)} style={{padding:"10px 14px",cursor:"pointer",borderBottom:`1px solid ${T.border}`,transition:"background 0.15s"}}
                        onMouseEnter={e=>e.currentTarget.style.background="rgba(59,91,139,0.1)"}
                        onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                        <div style={{fontSize:13,fontWeight:600,color:T.text}}>{c.name}</div>
                        <div style={{fontSize:11,color:T.muted}}>📞 {c.phone} · 📍 {c.address}</div>
                      </div>
                    ))}
                    {matches.length===0&&(
                      <div style={{padding:"10px 14px",fontSize:12,color:T.muted}}>ไม่พบลูกค้า — จะสร้างใหม่อัตโนมัติ</div>
                    )}
                  </div>
                  );
                })()}
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                {[{k:"customerPhone",l:"เบอร์โทรศัพท์",ph:"0812345678"},{k:"customerAddress",l:"ที่อยู่จัดส่ง",ph:"บ้านเลขที่ ซอย ถนน..."}].map(f=>(
                  <div key={f.k}>
                    <label style={{fontSize:11,color:T.muted,display:"block",marginBottom:5,fontWeight:600}}>{f.l}</label>
                    <input value={orderForm[f.k]} onChange={e=>setOrderForm(p=>({...p,[f.k]:e.target.value}))} placeholder={f.ph}
                      style={{width:"100%",background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:9,padding:"9px 14px",fontFamily:"'Sarabun',sans-serif",fontSize:13,outline:"none"}}/>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Order items */}
          <div style={{fontSize:12,fontWeight:700,color:T.accent,marginBottom:10,textTransform:"uppercase",letterSpacing:"0.06em"}}>เลือกสินค้า</div>

          {/* Step 1: เลือกรุ่น + สี */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
            <div>
              <label style={{fontSize:11,color:T.muted,display:"block",marginBottom:5,fontWeight:600}}>รุ่นเสื้อ</label>
              <select value={orderItemForm.clothingId} onChange={e=>setOrderItemForm(f=>({...f,clothingId:e.target.value,colorIdx:""}))}
                style={{width:"100%",background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:9,padding:"9px 12px",fontFamily:"'Sarabun',sans-serif",fontSize:13,outline:"none"}}>
                <option value="">-- เลือกรุ่น --</option>
                {clothingItems.map(i=><option key={i.id} value={i.id}>{i.model}</option>)}
              </select>
            </div>
            <div>
              <label style={{fontSize:11,color:T.muted,display:"block",marginBottom:5,fontWeight:600}}>สี</label>
              <select value={orderItemForm.colorIdx} onChange={e=>setOrderItemForm(f=>({...f,colorIdx:e.target.value}))}
                style={{width:"100%",background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:9,padding:"9px 12px",fontFamily:"'Sarabun',sans-serif",fontSize:13,outline:"none"}}>
                <option value="">-- เลือกสี --</option>
                {orderItemForm.clothingId&&(clothingItems.find(i=>i.id===orderItemForm.clothingId)?.colors||[]).map((c,ci)=>(
                  <option key={ci} value={ci}>{c.colorName}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Step 2: ตารางไซส์ */}
          {orderItemForm.clothingId&&orderItemForm.colorIdx!==""&&(()=>{
            const item=clothingItems.find(i=>i.id===orderItemForm.clothingId);
            const col=item?.colors?.[Number(orderItemForm.colorIdx)];
            if(!item||!col) return null;
            return (
              <div style={{marginBottom:14,background:"rgba(241,243,246,0.6)",borderRadius:10,border:"1px solid rgba(59,91,139,0.2)",overflow:"hidden"}}>
                <div style={{padding:"8px 14px",background:"rgba(59,91,139,0.08)",borderBottom:"1px solid rgba(59,91,139,0.15)",display:"flex",alignItems:"center",gap:8}}>
                  <div style={{width:12,height:12,borderRadius:2,background:col.hex,border:"1px solid rgba(255,255,255,0.15)"}}/>
                  <span style={{fontSize:12,color:T.accent,fontWeight:600}}>{item.model} · {col.colorName}</span>
                  <span style={{fontSize:10,color:T.muted,marginLeft:"auto"}}>กรอกจำนวนที่ต้องการสั่ง</span>
                </div>
                <div style={{padding:10,display:"flex",flexDirection:"column",gap:8}}>
                  {[["6","8","10","12"],["S","M","L","XL"],["2XL","3XL","4XL","5XL"]].map((row,ri)=>(
                    <div key={ri} style={{display:"grid",gridTemplateColumns:`repeat(${row.length},1fr)`,gap:6}}>
                      {row.map(sz=>{
                        const stock=(col.stock||{})[sz]||0;
                        const curVal=orderForm.items.find(i=>i.clothingId===orderItemForm.clothingId&&i.colorIdx===Number(orderItemForm.colorIdx)&&i.size===sz)?.qty||0;
                        return (
                          <div key={sz} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 10px",background:stock===0?"rgba(203,210,217,0.25)":"rgba(241,243,246,0.5)",borderRadius:7,border:`1px solid ${stock===0?"rgba(203,210,217,0.5)":"rgba(59,91,139,0.18)"}`}}>
                            <div style={{minWidth:38,display:"flex",flexDirection:"column"}}>
                              <span style={{fontFamily:"monospace",fontWeight:700,fontSize:13,color:stock===0?"#9aa5b1":T.accent}}>{sz}</span>
                              <span style={{fontSize:9,color:stock===0?"#9aa5b1":stock<5?"#fbbf24":"#22d3ee",fontFamily:"monospace"}}>มี {stock}</span>
                            </div>
                            <input type="number" min="0" max={stock}
                              defaultValue={curVal||""}
                              placeholder="0"
                              disabled={stock===0}
                              key={`${orderItemForm.clothingId}-${orderItemForm.colorIdx}-${sz}`}
                              onBlur={e=>{
                                const val=Math.min(Math.max(0,Number(e.target.value)||0),stock);
                                if(val>0){
                                  setOrderForm(f=>{
                                    const idx=f.items.findIndex(i=>i.clothingId===orderItemForm.clothingId&&i.colorIdx===Number(orderItemForm.colorIdx)&&i.size===sz);
                                    const newItem={clothingId:orderItemForm.clothingId,clothingName:item.model,colorIdx:Number(orderItemForm.colorIdx),colorName:col.colorName,colorHex:col.hex,size:sz,qty:val,stock};
                                    const items=[...f.items];
                                    if(idx>=0) items[idx]=newItem; else items.push(newItem);
                                    return {...f,items};
                                  });
                                } else {
                                  setOrderForm(f=>({...f,items:f.items.filter(i=>!(i.clothingId===orderItemForm.clothingId&&i.colorIdx===Number(orderItemForm.colorIdx)&&i.size===sz))}));
                                }
                              }}
                              style={{flex:1,minWidth:0,textAlign:"center",background:stock===0?"rgba(203,210,217,0.3)":"rgba(59,91,139,0.1)",border:`1px solid ${stock===0?"rgba(203,210,217,0.5)":"rgba(59,91,139,0.25)"}`,borderRadius:6,color:stock===0?"#9aa5b1":"#3b5b8b",fontFamily:"monospace",fontSize:13,fontWeight:600,padding:"6px 4px",outline:"none",cursor:stock===0?"not-allowed":"text"}}
                            />
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
                <div style={{padding:"8px 14px",borderTop:"1px solid rgba(203,210,217,0.5)",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <span style={{fontSize:11,color:T.muted}}>💡 กรอกจำนวน แล้วคลิกออกจากช่องเพื่อบันทึก</span>
                  <span style={{fontSize:12,color:T.accent,fontFamily:"monospace",fontWeight:700}}>
                    สั่ง {orderForm.items.filter(i=>i.clothingId===orderItemForm.clothingId&&i.colorIdx===Number(orderItemForm.colorIdx)).reduce((s,i)=>s+i.qty,0)} ชิ้น
                  </span>
                </div>
              </div>
            );
          })()}

          {/* Step 2b: เพิ่มแถวอิสระ — auto-match clothing + checkbox ตัดสต๊อก */}
          {(() => {
            const fname = freeItemForm.name.trim().toLowerCase();
            const fcolor = freeItemForm.colorName.trim().toLowerCase();
            const fsize = freeItemForm.size.trim();
            const fqty = Number(freeItemForm.qty) || 0;
            let matched = null;
            if (fname && fcolor && fsize) {
              for (const it of clothingItems) {
                if ((it.model||"").trim().toLowerCase() !== fname) continue;
                const ci = (it.colors||[]).findIndex(c => (c.colorName||"").trim().toLowerCase() === fcolor);
                if (ci < 0) continue;
                const stock = Number((it.colors[ci].stock||{})[fsize]) || 0;
                matched = { item: it, colorIdx: ci, color: it.colors[ci], stock };
                break;
              }
            }
            const willLink = matched && freeItemCutStock;
            const stockShort = willLink && matched.stock < fqty;
            return (
            <div style={{marginBottom:14,padding:12,background:"rgba(217,119,6,0.04)",border:"1px dashed rgba(217,119,6,0.35)",borderRadius:10}}>
              <div style={{fontSize:11,fontWeight:700,color:"#92400e",marginBottom:8,letterSpacing:"0.04em"}}>✍️ เพิ่มแถวอิสระ (พิมพ์เอง)</div>
              <div style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr 80px 80px",gap:6,alignItems:"end"}}>
                <input value={freeItemForm.name} onChange={e=>setFreeItemForm(f=>({...f,name:e.target.value}))} placeholder="รุ่น / ชื่อสินค้า"
                  style={{background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:7,padding:"7px 10px",fontFamily:"'Sarabun',sans-serif",fontSize:12,outline:"none"}}/>
                <input value={freeItemForm.colorName} onChange={e=>setFreeItemForm(f=>({...f,colorName:e.target.value}))} placeholder="สี"
                  style={{background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:7,padding:"7px 10px",fontFamily:"'Sarabun',sans-serif",fontSize:12,outline:"none"}}/>
                <input value={freeItemForm.size} onChange={e=>setFreeItemForm(f=>({...f,size:e.target.value}))} placeholder="ไซส์ (เช่น XL, 12)"
                  style={{background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:7,padding:"7px 10px",fontFamily:"'Sarabun',sans-serif",fontSize:12,outline:"none",fontWeight:600,textAlign:"center"}}/>
                <input type="number" min="1" value={freeItemForm.qty} onChange={e=>setFreeItemForm(f=>({...f,qty:e.target.value}))} placeholder="จำนวน"
                  style={{background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:7,padding:"7px 10px",fontFamily:"'Sarabun',sans-serif",fontSize:12,outline:"none",fontFamily:"monospace",textAlign:"center"}}/>
                <button onClick={()=>{
                  const name=freeItemForm.name.trim(); const qty=Number(freeItemForm.qty)||0;
                  if(!name||qty<=0) return;
                  if (willLink) {
                    setOrderForm(f=>({...f,items:[...f.items,{
                      clothingId: matched.item.id,
                      clothingName: matched.item.model,
                      colorIdx: matched.colorIdx,
                      colorName: matched.color.colorName,
                      colorHex: matched.color.hex || "#94a3b8",
                      size: fsize, qty,
                      stock: matched.stock
                    }]}));
                  } else {
                    setOrderForm(f=>({...f,items:[...f.items,{
                      freeText:true,
                      clothingId:`free_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
                      clothingName:name,
                      colorIdx:0, colorName:freeItemForm.colorName||"-", colorHex:"#94a3b8",
                      size:freeItemForm.size||"-", qty
                    }]}));
                  }
                  setFreeItemForm({name:"",colorName:"",size:"",qty:""});
                  setFreeItemCutStock(true);
                }} disabled={!freeItemForm.name.trim()||!Number(freeItemForm.qty)}
                  style={{padding:"7px 12px",borderRadius:7,border:"none",background:willLink?"#16a34a":"#d97706",color:"white",fontSize:12,fontWeight:700,cursor:freeItemForm.name.trim()&&Number(freeItemForm.qty)?"pointer":"not-allowed",opacity:freeItemForm.name.trim()&&Number(freeItemForm.qty)?1:0.4,fontFamily:"inherit"}}>{willLink?"+ ตัดสต๊อก":"+ เพิ่ม"}</button>
              </div>
              {matched ? (
                <div style={{marginTop:8,padding:"8px 10px",background:"rgba(22,163,74,0.08)",border:"1px solid rgba(22,163,74,0.25)",borderRadius:7,display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                  <span style={{fontSize:11,color:"#15803d",fontWeight:700}}>✓ พบในระบบ:</span>
                  <span style={{fontSize:11,color:"#1e293b"}}>{matched.item.model} / {matched.color.colorName} / {fsize}</span>
                  <span style={{fontSize:11,color:matched.stock>0?"#15803d":"#dc2626",fontFamily:"monospace",fontWeight:700}}>คงเหลือ {matched.stock} ตัว</span>
                  <label style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:6,cursor:"pointer",fontSize:11,color:"#15803d",fontWeight:700}}>
                    <input type="checkbox" checked={freeItemCutStock} onChange={e=>setFreeItemCutStock(e.target.checked)} style={{cursor:"pointer"}}/>
                    ตัดสต๊อก
                  </label>
                  {stockShort && <div style={{flex:"1 0 100%",fontSize:10,color:"#dc2626",fontWeight:700}}>⚠️ สต๊อกไม่พอ (มี {matched.stock}, สั่ง {fqty}) — จะตัดเหลือ 0</div>}
                </div>
              ) : (
                <div style={{fontSize:10,color:"#92400e",marginTop:6,opacity:0.8}}>💡 กรอกครบ (รุ่น/สี/ไซส์) ระบบจะค้นในคลังให้อัตโนมัติ — ถ้าไม่เจอจะเป็นรายการอิสระ (ไม่ตัดสต๊อก)</div>
              )}
            </div>
            );
          })()}

          {/* Step 3: สรุปรายการ */}
          {orderForm.items.length>0&&(
            <div style={{background:"rgba(241,243,246,0.6)",borderRadius:10,border:`1px solid ${T.border}`,marginBottom:14,overflow:"hidden"}}>
              <div style={{padding:"8px 14px",background:"rgba(241,243,246,0.8)",borderBottom:`1px solid ${T.border}`,fontSize:10,color:T.muted,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.06em"}}>📋 สรุปรายการที่เลือก</div>
              {Object.entries(orderForm.items.reduce((acc,oi)=>{
                const k=`${oi.clothingId||oi.clothingName}-${oi.colorIdx??""}|${oi.colorName||""}|${oi.variant||""}`;
                if(!acc[k]) acc[k]={clothingName:oi.clothingName,colorName:oi.colorName,colorHex:oi.colorHex,clothingId:oi.clothingId,colorIdx:oi.colorIdx,variant:oi.variant||"",fabricType:oi.fabricType||"",collarType:oi.collarType||"",jobDescription:oi.jobDescription||"",sizes:[]};
                acc[k].sizes.push({size:oi.size,qty:oi.qty});
                return acc;
              },{})).map(([k,g],gi,arr)=>(
                <div key={k} style={{padding:"10px 14px",borderBottom:gi<arr.length-1?`1px solid ${T.border}`:"none",display:"flex",alignItems:"center",gap:12}}>
                  <div style={{width:10,height:10,borderRadius:2,background:g.colorHex,border:"1px solid rgba(255,255,255,0.15)",flexShrink:0}}/>
                  <div style={{flex:1}}>
                    <span style={{fontSize:12,fontWeight:600,color:T.text}}>{g.clothingName}</span>
                    <span style={{fontSize:11,color:T.sub,marginLeft:8}}>{g.colorName}</span>
                  </div>
                  <div style={{display:"flex",gap:6,flexWrap:"wrap",justifyContent:"flex-end"}}>
                    {g.sizes.slice().sort((a,b)=>compareSizes(a.size,b.size)).map(s=>(
                      <span key={s.size} style={{background:"rgba(59,91,139,0.1)",border:"1px solid rgba(59,91,139,0.2)",borderRadius:6,padding:"2px 8px",fontSize:11,fontFamily:"monospace",color:T.accent,fontWeight:700}}>
                        {s.size}×{s.qty}
                      </span>
                    ))}
                  </div>
                  <button onClick={()=>setOrderForm(f=>({...f,items:f.items.filter(i=>!(i.clothingId===g.clothingId&&i.colorIdx===g.colorIdx))}))} style={{background:"rgba(248,113,113,0.08)",border:"1px solid rgba(248,113,113,0.2)",borderRadius:5,padding:"2px 8px",cursor:"pointer",fontSize:11,color:"#f87171",flexShrink:0}}>✕</button>
                </div>
              ))}
              <div style={{padding:"8px 14px",borderTop:`1px solid ${T.border}`,display:"flex",justifyContent:"flex-end",fontSize:12,color:T.sub}}>
                รวมทั้งหมด <b style={{color:T.accent,fontFamily:"monospace",marginLeft:6}}>{orderForm.items.reduce((s,i)=>s+i.qty,0)}</b> ชิ้น
              </div>
            </div>
          )}

          <div>
            <label style={{fontSize:11,color:T.muted,display:"block",marginBottom:5,fontWeight:600}}>หมายเหตุ</label>
            <input value={orderForm.note} onChange={e=>setOrderForm(f=>({...f,note:e.target.value}))} placeholder="หมายเหตุเพิ่มเติม..."
              style={{width:"100%",background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:9,padding:"9px 14px",fontFamily:"'Sarabun',sans-serif",fontSize:13,outline:"none",marginBottom:16}}/>
          </div>

          <div style={{display:"flex",gap:10}}>
            <BtnGhost onClick={()=>setShowNewOrder(false)} style={{flex:1}}>ยกเลิก</BtnGhost>
            <BtnPrimary onClick={handleConfirmOrder} disabled={orderForm.items.length===0} style={{flex:2,opacity:orderForm.items.length===0?0.45:1}}>
              {orderForm.items.length===0?"กรุณาเพิ่มสินค้าก่อน":"✅ ยืนยันใบสั่งของ + ตัดสต็อก"}
            </BtnPrimary>
          </div>
        </Modal>
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

      {/* ── MODAL: ปริ้นใบสั่งของ ── */}
      {showPrintOrder&&(
        <div className="print-modal-overlay" style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:400,backdropFilter:"blur(6px)"}}
          onMouseDown={e=>{if(e.target===e.currentTarget)setShowPrintOrder(null);}}>
          <div className="print-modal-card" onMouseDown={e=>e.stopPropagation()} style={{background:"white",borderRadius:16,padding:0,width:680,maxHeight:"90vh",overflowY:"auto",boxShadow:"0 24px 60px rgba(0,0,0,0.6)"}}>
            {/* Print content */}
            <div id="print-area" style={{padding:"32px 40px",fontFamily:"'Sarabun',sans-serif",color:"#1e293b"}}>
              {/* Header */}
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:24,paddingBottom:16,borderBottom:"2px solid #3b5b8b"}}>
                <div>
                  <div style={{fontSize:28,fontWeight:800,color:"#3b5b8b",letterSpacing:3,fontFamily:"monospace"}}>CPU</div>
                  <div style={{fontSize:11,color:"#64748b"}}>ระบบบริหารคลังสินค้า</div>
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontSize:20,fontWeight:700,color:"#1e293b"}}>ใบสั่งของ</div>
                  <div style={{fontSize:14,color:"#3b5b8b",fontFamily:"monospace",fontWeight:700}}>{showPrintOrder.orderNo}</div>
                  <div style={{fontSize:11,color:"#64748b",marginTop:4}}>{showPrintOrder.date}</div>
                </div>
              </div>

              {/* Customer info */}
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:24,padding:18,background:"#f8fafc",borderRadius:10,border:"1px solid #e2e8f0"}}>
                <div>
                  <div style={{fontSize:12,color:"#64748b",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:6}}>ลูกค้า</div>
                  <div style={{fontSize:17,fontWeight:700,color:"#1e293b"}}>{showPrintOrder.customerName}</div>
                  <div style={{fontSize:14,color:"#475569",marginTop:4}}>📞 {showPrintOrder.customerPhone||"-"}</div>
                </div>
                <div>
                  <div style={{fontSize:12,color:"#64748b",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:6}}>ที่อยู่จัดส่ง</div>
                  <div style={{fontSize:14,color:"#475569",lineHeight:1.6}}>{showPrintOrder.customerAddress||"-"}</div>
                </div>
              </div>

              {/* Items table — Model | Color | SIZE+qty ×4 | จำนวน | ราคา(หน้าจอเท่านั้น) */}
              <table style={{width:"100%",borderCollapse:"collapse",marginBottom:20,fontSize:14}}>
                <thead>
                  <tr style={{background:"#3b5b8b",color:"white"}}>
                    <th style={{padding:"9px 10px",textAlign:"left",fontWeight:700,border:"1px solid #0284c7",fontSize:13}}>รุ่น</th>
                    <th style={{padding:"9px 10px",textAlign:"left",fontWeight:700,border:"1px solid #0284c7",fontSize:13}}>สี</th>
                    {[1,2,3,4].flatMap(i=>[
                      <th key={`sh${i}`} style={{padding:"8px 4px",textAlign:"center",fontWeight:700,border:"1px solid #0284c7",background:"#166534",color:"#bbf7d0",minWidth:40,fontSize:12}}>SIZE</th>,
                      <th key={`qh${i}`} style={{padding:"8px 4px",textAlign:"center",fontWeight:700,border:"1px solid #0284c7",minWidth:32,fontSize:12}}></th>
                    ])}
                    <th style={{padding:"9px 10px",textAlign:"center",fontWeight:700,border:"1px solid #0284c7",fontSize:13}}>จำนวน</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.values((showPrintOrder.items||[]).reduce((acc,oi)=>{
                    const k=`${oi.clothingId||oi.clothingName}-${oi.colorIdx??""}|${oi.colorName||""}|${oi.variant||""}`;
                    if(!acc[k]) acc[k]={clothingName:oi.clothingName,colorName:oi.colorName,colorHex:oi.colorHex,clothingId:oi.clothingId,colorIdx:oi.colorIdx,variant:oi.variant||"",fabricType:oi.fabricType||"",collarType:oi.collarType||"",jobDescription:oi.jobDescription||"",items:[]};
                    acc[k].items.push(oi);
                    return acc;
                  },{})).flatMap((group,gi)=>{
                    // ✨ sort + group ด้วย helper (รองรับ 2XL-9XL, 6XL/7XL)
                    const withSize = group.items.filter(i => i.size);
                    const rows = splitSizesIntoRows(withSize, 4, { fillPlus: false });
                    if(rows.length===0) rows.push([]);
                    const totalQty=group.items.reduce((s,i)=>s+i.qty,0);
                    // คำนวณราคารวมของ group นี้ (qty × salePrice ตามไซส์)
                    const clothingItem = clothingItems.find(ci=>ci.id===group.clothingId);
                    const colorData = clothingItem?.colors?.[group.colorIdx];
                    const groupTotalPrice = group.items.reduce((s,oi) => s + oi.qty * (getPriceForSize(colorData, oi.size) || 0), 0);
                    const lastIdx=rows.length-1;
                    return rows.map((chunk,ci)=>(
                      <tr key={`${gi}-${ci}`} style={{borderBottom:"1px solid #e2e8f0",background:gi%2===0?"white":"#f8fafc"}}>
                        <td style={{padding:"9px 10px",fontWeight:600,color:"#1e293b",verticalAlign:"middle",border:"1px solid #e2e8f0",fontSize:14}}>{ci===0&&<div><div>{group.clothingName}</div>{(group.fabricType||group.collarType||group.jobDescription)&&<div style={{fontSize:10,color:"#64748b",fontWeight:400,marginTop:2,display:"flex",flexWrap:"wrap",gap:3}}>{group.fabricType&&<span>🧵 {group.fabricType}</span>}{group.collarType&&<span>· 👔 {group.collarType}</span>}{group.jobDescription&&<span>· {group.jobDescription}</span>}</div>}</div>}</td>
                        <td style={{padding:"9px 10px",verticalAlign:"middle",border:"1px solid #e2e8f0",fontSize:14}}>
                          {ci===0&&<div style={{display:"flex",alignItems:"center",gap:5}}>
                            <div style={{width:12,height:12,borderRadius:2,background:group.colorHex,border:"1px solid rgba(0,0,0,0.15)",flexShrink:0}}/>
                            <span>{group.colorName}{group.variant?` (${group.variant})`:""}</span>
                          </div>}
                        </td>
                        {chunk.map(oi=>[
                          <td key={`s-${oi.size}`} style={{padding:"8px 4px",textAlign:"center",fontFamily:"monospace",fontWeight:700,color:"#3b5b8b",border:"1px solid #e2e8f0",background:"rgba(219,234,254,0.4)",fontSize:14}}>{oi.size}</td>,
                          <td key={`q-${oi.size}`} style={{padding:"8px 4px",textAlign:"center",fontFamily:"monospace",fontWeight:700,color:"#059669",border:"1px solid #e2e8f0",fontSize:14}}>{oi.qty}</td>
                        ])}
                        {Array(4-chunk.length).fill(null).flatMap((_,i)=>[
                          <td key={`e1-${ci}-${i}`} style={{border:"1px solid #e2e8f0",background:"#fafafa"}}/>,
                          <td key={`e2-${ci}-${i}`} style={{border:"1px solid #e2e8f0",background:"#fafafa"}}/>
                        ])}
                        <td style={{padding:"9px 10px",textAlign:"center",fontFamily:"monospace",fontWeight:700,fontSize:16,color:"#3b5b8b",verticalAlign:"middle",border:"1px solid #e2e8f0"}}>{ci===lastIdx?totalQty:""}</td>
                      </tr>
                    ));
                  })}
                </tbody>
                <tfoot>
                  <tr style={{background:"#f1f5f9",fontWeight:700}}>
                    <td colSpan={10} style={{padding:"11px 14px",textAlign:"right",color:"#475569",fontSize:13}}>รวมทั้งหมด</td>
                    <td style={{padding:"11px 14px",textAlign:"center",fontFamily:"monospace",fontSize:16,color:"#3b5b8b",border:"1px solid #e2e8f0"}}>{(showPrintOrder.items||[]).reduce((s,i)=>s+i.qty,0)} ชิ้น</td>
                  </tr>
                </tfoot>
              </table>

              {showPrintOrder.note&&<div style={{padding:12,background:"#fffbeb",border:"1px solid #fde68a",borderRadius:8,fontSize:12,color:"#92400e",marginBottom:16}}>📝 หมายเหตุ: {showPrintOrder.note}</div>}

              <div style={{display:"flex",justifyContent:"space-between",marginTop:32,paddingTop:16,borderTop:"1px solid #e2e8f0",fontSize:11,color:"#94a3b8"}}>
                <div>ผู้สั่ง: {showPrintOrder.by}</div>
                <div>สถานะ: {showPrintOrder.status}</div>
              </div>
            </div>

            {/* Print buttons */}
            <div className="print-hide" style={{padding:"16px 24px",borderTop:"1px solid #e2e8f0",display:"flex",gap:10,justifyContent:"flex-end",background:"#f8fafc",borderRadius:"0 0 16px 16px"}}>
              <button onClick={()=>setShowPrintOrder(null)} style={{padding:"9px 20px",borderRadius:9,border:"1px solid #e2e8f0",background:"white",color:"#64748b",fontSize:13,cursor:"pointer",fontFamily:"'Sarabun',sans-serif"}}>ปิด</button>
              <button onClick={()=>printElementById("print-area")} style={{padding:"9px 20px",borderRadius:9,border:"none",background:"linear-gradient(135deg,#3b5b8b,#3b5b8b)",color:"white",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",boxShadow:"0 4px 14px rgba(59,91,139,0.3)"}}>🖨️ สั่งปริ้น</button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: ออกบิลใหม่ ── */}
      {showNewInvoice&&(
        <Modal onClose={()=>{setShowNewInvoice(false);setEditingInvoiceId(null);}} w={1100}>
          <MHead title={editingInvoiceId?"✏️ แก้ไขบิล":"🧾 ออกบิลใหม่"} sub={editingInvoiceId?`${invoices.find(i=>i.id===editingInvoiceId)?.invoiceNo || ""} · เลขที่บิลคงเดิม`:""} onClose={()=>{setShowNewInvoice(false);setEditingInvoiceId(null);}} color={editingInvoiceId?T.amber:T.accent}/>

          {/* Doc type + VAT selector */}
          <div style={{display:"flex",gap:10,marginBottom:18,flexWrap:"wrap"}}>
            <div style={{flex:1}}>
              <label style={{fontSize:11,color:T.muted,display:"block",marginBottom:6,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em"}}>ประเภทเอกสาร</label>
              <div style={{display:"flex",gap:6}}>
                {[{id:"receipt",label:"🧾 ใบเสร็จ"},{id:"tax",label:"📄 ใบกำกับภาษี"},{id:"quotation",label:"📋 ใบวางบิล"}].map(t=>(
                  <button key={t.id} onClick={()=>{
                    setInvoiceDocType(t.id);
                    // ใบกำกับภาษี → บังคับ VAT 7%
                    if (t.id === "tax") setInvoiceVat(true);
                  }}
                    style={{padding:"7px 14px",borderRadius:8,border:`1px solid ${invoiceDocType===t.id?"#3b5b8b":T.border}`,background:invoiceDocType===t.id?"rgba(59,91,139,0.15)":"transparent",color:invoiceDocType===t.id?T.accent:T.sub,cursor:"pointer",fontSize:12,fontFamily:"'Sarabun',sans-serif",fontWeight:invoiceDocType===t.id?700:400,transition:"all 0.2s"}}>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            <div style={{display:"flex",alignItems:"flex-end",gap:10,flexWrap:"wrap"}}>
              <label style={{display:"flex",alignItems:"center",gap:8,cursor:invoiceDocType==="tax"?"not-allowed":"pointer",padding:"7px 14px",borderRadius:8,border:`1px solid ${invoiceVat?"#3b5b8b":T.border}`,background:invoiceVat?"rgba(59,91,139,0.15)":"transparent",opacity:invoiceDocType==="tax"?0.8:1}}
                title={invoiceDocType==="tax"?"ใบกำกับภาษีต้องมี VAT 7% เสมอ":""}>
                <input type="checkbox" checked={invoiceVat} disabled={invoiceDocType==="tax"} onChange={e=>setInvoiceVat(e.target.checked)} style={{cursor:invoiceDocType==="tax"?"not-allowed":"pointer"}}/>
                <span style={{fontSize:12,color:invoiceVat?T.accent:T.sub,fontWeight:invoiceVat?700:400}}>VAT {invoiceForm.vatRate}% {invoiceDocType==="tax"&&<span style={{color:T.red,fontSize:10,marginLeft:4}}>🔒 บังคับ</span>}</span>
              </label>
              <label style={{display:"flex",alignItems:"center",gap:8,cursor:invoiceDocType==="tax"?"not-allowed":"pointer",padding:"7px 14px",borderRadius:8,border:`1px solid ${invoiceForm.showCompanyTaxId!==false?"#3b5b8b":T.border}`,background:invoiceForm.showCompanyTaxId!==false?"rgba(59,91,139,0.15)":"transparent",opacity:invoiceDocType==="tax"?0.8:1}}
                title={invoiceDocType==="tax"?"ใบกำกับภาษีต้องแสดงเลขผู้เสียภาษีบริษัทเสมอ":"แสดง/ซ่อนเลขผู้เสียภาษีของบริษัทในบิล"}>
                <input type="checkbox" checked={invoiceForm.showCompanyTaxId!==false} disabled={invoiceDocType==="tax"}
                  onChange={e=>setInvoiceForm(f=>({...f,showCompanyTaxId:e.target.checked}))} style={{cursor:invoiceDocType==="tax"?"not-allowed":"pointer"}}/>
                <span style={{fontSize:12,color:invoiceForm.showCompanyTaxId!==false?T.accent:T.sub,fontWeight:invoiceForm.showCompanyTaxId!==false?700:400}}>แสดงเลขผู้เสียภาษีบริษัท {invoiceDocType==="tax"&&<span style={{color:T.red,fontSize:10,marginLeft:4}}>🔒 บังคับ</span>}</span>
              </label>
            </div>
          </div>

          {/* แจ้งเตือนเมื่อเป็นใบกำกับภาษี — ต้องมี taxId */}
          {invoiceDocType==="tax"&&(
            <div style={{marginBottom:14,padding:"10px 14px",background:"rgba(184,134,0,0.08)",border:"1px solid rgba(184,134,0,0.3)",borderRadius:8,fontSize:12,color:T.amber,lineHeight:1.7}}>
              ⚠️ <b>ใบกำกับภาษีต้องมีข้อมูลครบ:</b>
              <ul style={{marginLeft:18,marginTop:4,marginBottom:0}}>
                <li>✓ VAT 7% (บังคับ)</li>
                <li>{companyInfo.taxId ? "✓" : "❌"} เลขผู้เสียภาษีบริษัท {!companyInfo.taxId && <span style={{color:T.red,fontWeight:700}}>(ยังไม่ได้ตั้ง — ไปที่ ⚙️ ตั้งค่า → ข้อมูลบริษัท)</span>}</li>
                <li>{invoiceForm.customerTaxId ? "✓" : "❌"} เลขผู้เสียภาษีลูกค้า {!invoiceForm.customerTaxId && <span style={{color:T.red,fontWeight:700}}>(กรอกในช่องด้านล่าง)</span>}</li>
              </ul>
            </div>
          )}

          {/* บัญชีรับเงิน */}
          <div style={{marginBottom:14}}>
            <label style={{fontSize:11,color:T.muted,display:"block",marginBottom:6,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em"}}>🏦 บัญชีรับชำระเงิน (แสดงบนบิล)</label>
            <select value={invoiceForm.bankAccountIdx??-1} onChange={e=>setInvoiceForm(f=>({...f,bankAccountIdx:Number(e.target.value)}))}
              style={{width:"100%",background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:9,padding:"9px 12px",fontFamily:"'Sarabun',sans-serif",fontSize:13,outline:"none"}}>
              <option value={-1}>— ไม่แสดงบัญชี —</option>
              {(companyInfo.bankAccounts||[]).map((b,i)=>(
                <option key={i} value={i}>{b.label||"บัญชี"} · {b.bankName} · {b.accountNo}</option>
              ))}
            </select>
            {(!companyInfo.bankAccounts||companyInfo.bankAccounts.length===0)&&<div style={{fontSize:10,color:T.muted,marginTop:4}}>ยังไม่มีบัญชี — เพิ่มได้ที่ ⚙️ ตั้งค่า → ข้อมูลบริษัท</div>}
          </div>

          {/* Import from order */}
          {orders.length>0&&(
            <div style={{marginBottom:16,padding:12,background:"rgba(59,91,139,0.06)",border:"1px solid rgba(59,91,139,0.2)",borderRadius:10}}>
              <div style={{fontSize:11,color:T.accent,fontWeight:600,marginBottom:8}}>📋 ดึงข้อมูลจากใบสั่งของ</div>
              <select onChange={e=>{const o=orders.find(x=>x.id===e.target.value);if(o)handleImportFromOrder(o);}}
                style={{width:"100%",background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:9,padding:"9px 12px",fontFamily:"'Sarabun',sans-serif",fontSize:13,outline:"none"}}>
                <option value="">-- เลือกใบสั่งของ (ถ้ามี) --</option>
                {orders.map(o=><option key={o.id} value={o.id}>{o.orderNo} · {o.customerName} · {o.date}</option>)}
              </select>
            </div>
          )}

          {/* Customer info */}
          <div style={{fontSize:11,color:T.muted,marginBottom:8,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.05em"}}>ข้อมูลลูกค้า / ผู้รับ</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:16}}>
            {[
              {k:"customerName",l:"ชื่อลูกค้า *",ph:"ชื่อ-นามสกุล / ชื่อบริษัท"},
              {k:"customerPhone",l:"เบอร์โทร",ph:"0812345678"},
              {k:"customerAddress",l:"ที่อยู่",ph:"บ้านเลขที่ ซอย ถนน..."},
              {k:"customerTaxId",l:"เลขผู้เสียภาษี",ph:"(ถ้ามี)"},
            ].map(f=>(
              <div key={f.k}>
                <label style={{fontSize:11,color:T.muted,display:"block",marginBottom:4,fontWeight:600}}>{f.l}</label>
                <input value={invoiceForm[f.k]} onChange={e=>setInvoiceForm(p=>({...p,[f.k]:e.target.value}))} placeholder={f.ph}
                  style={{width:"100%",background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:9,padding:"8px 12px",fontFamily:"'Sarabun',sans-serif",fontSize:13,outline:"none"}}/>
              </div>
            ))}
          </div>

          {/* Items */}
          <div style={{fontSize:11,color:T.muted,marginBottom:8,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.05em"}}>รายการสินค้า / บริการ</div>
          {invoiceForm.items.length>0&&(()=>{
            const isPlus=(sz)=>/^[2-9]XL$/.test(sz);
            // index-aware items (เก็บ index เดิมไว้ใช้แก้/ลบ)
            const indexed=invoiceForm.items.map((it,idx)=>({...it,__i:idx}));
            // มีชื่อรุ่น = เข้าตาราง group | ไม่มี = แถวเดียว
            const structured=indexed.filter(i=>i.clothingId||i.clothingName);
            const generic=indexed.filter(i=>!(i.clothingId||i.clothingName));
            const groups=Object.values(structured.reduce((acc,it)=>{
              // 🔑 รวม colorName เข้าใน key — กัน legacy data ที่ colorIdx=0 ทุกแถว
              const k=`${it.clothingId||it.clothingName}-${it.colorIdx??""}|${it.colorName||""}|${it.variant||""}`;
              if(!acc[k]) acc[k]={clothingName:it.clothingName,colorName:it.colorName,colorHex:it.colorHex,variant:it.variant||"",fabricType:it.fabricType||"",collarType:it.collarType||"",jobDescription:it.jobDescription||"",items:[]};
              acc[k].items.push(it);
              return acc;
            },{}));
            const updateQty=(i,v)=>setInvoiceForm(f=>({...f,items:f.items.map((x,j)=>j===i?{...x,qty:Math.max(1,Number(v)||1)}:x)}));
            const updatePrice=(i,v)=>setInvoiceForm(f=>({...f,items:f.items.map((x,j)=>j===i?{...x,unitPrice:Math.max(0,Number(v)||0)}:x)}));
            const removeItem=(i)=>setInvoiceForm(f=>({...f,items:f.items.filter((_,j)=>j!==i)}));
            const removeGroup=(items)=>setInvoiceForm(f=>({...f,items:f.items.filter((_,j)=>!items.find(it=>it.__i===j))}));
            return (
              <div style={{background:"rgba(241,243,246,0.5)",borderRadius:10,border:`1px solid ${T.border}`,marginBottom:12,overflow:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:11,color:T.text}}>
                  <thead>
                    <tr style={{background:"rgba(241,243,246,0.85)",color:T.muted,fontSize:10,textTransform:"uppercase",letterSpacing:"0.06em"}}>
                      <th style={{padding:"8px 10px",textAlign:"left",border:`1px solid ${T.border}`,minWidth:90}}>รุ่น</th>
                      <th style={{padding:"8px 10px",textAlign:"left",border:`1px solid ${T.border}`,minWidth:80}}>สี</th>
                      {[1,2,3,4].flatMap(i=>[
                        <th key={`sh${i}`} style={{padding:"6px 4px",textAlign:"center",border:`1px solid ${T.border}`,background:"rgba(22,101,52,0.4)",color:"#bbf7d0",minWidth:36}}>SIZE</th>,
                        <th key={`qh${i}`} style={{padding:"6px 4px",textAlign:"center",border:`1px solid ${T.border}`,minWidth:44}}>จำนวน</th>
                      ])}
                      <th style={{padding:"8px 8px",textAlign:"center",border:`1px solid ${T.border}`,width:70}}>รวม</th>
                      <th style={{padding:"8px 8px",textAlign:"right",border:`1px solid ${T.border}`,width:90}}>ราคา/หน่วย</th>
                      <th style={{padding:"8px 8px",textAlign:"right",border:`1px solid ${T.border}`,width:90}}>ราคารวม</th>
                      <th style={{width:32,border:`1px solid ${T.border}`}}/>
                    </tr>
                  </thead>
                  <tbody>
                    {groups.flatMap((group,gi)=>{
                      // ✨ ใช้ splitSizesIntoRows — sort + split อัตโนมัติ
                      // S/M/L/XL 4 ต่อแถว, 2XL+ และ 6XL/7XL/9XL ต่างๆ 1 ต่อแถว
                      const withSize = group.items.filter(i => i.size);
                      const noSize = group.items.filter(i => !i.size);
                      const rows = splitSizesIntoRows(withSize, 4, { fillPlus: false });
                      noSize.forEach(n => rows.push([n]));
                      if(rows.length===0) rows.push([]);
                      return rows.map((chunk,ci)=>{
                        const rowUnit=chunk[0]?.unitPrice||0;
                        const rowQty=chunk.reduce((s,i)=>s+i.qty,0);
                        const rowSub=chunk.reduce((s,i)=>s+(Number(i.unitPrice)||0)*i.qty,0);
                        return (
                          <tr key={`${gi}-${ci}`} style={{background:gi%2===0?"transparent":"rgba(59,91,139,0.03)"}}>
                            <td style={{padding:"6px 10px",fontWeight:600,verticalAlign:"middle",border:`1px solid ${T.border}`}}>{ci===0&&<div><div>{group.clothingName}</div>{(group.fabricType||group.collarType||group.jobDescription)&&<div style={{fontSize:10,color:"#64748b",fontWeight:400,marginTop:2,display:"flex",flexWrap:"wrap",gap:3}}>{group.fabricType&&<span>🧵 {group.fabricType}</span>}{group.collarType&&<span>· 👔 {group.collarType}</span>}{group.jobDescription&&<span>· {group.jobDescription}</span>}</div>}</div>}</td>
                            <td style={{padding:"6px 10px",verticalAlign:"middle",border:`1px solid ${T.border}`}}>
                              {ci===0&&<div style={{display:"flex",alignItems:"center",gap:6}}>
                                <div style={{width:10,height:10,borderRadius:2,background:group.colorHex,border:"1px solid rgba(255,255,255,0.15)",flexShrink:0}}/>
                                <span>{group.colorName}{group.variant?` (${group.variant})`:""}</span>
                              </div>}
                            </td>
                            {chunk.map(it=>[
                              <td key={`s-${it.size}`} style={{padding:"5px 4px",textAlign:"center",fontFamily:"monospace",fontWeight:700,color:T.accent,border:`1px solid ${T.border}`,background:"rgba(59,91,139,0.06)"}}>{it.size}</td>,
                              <td key={`q-${it.size}`} style={{padding:"4px 4px",textAlign:"center",border:`1px solid ${T.border}`}}>
                                <input type="number" defaultValue={it.qty} min="1"
                                  onFocus={e=>e.target.select()}
                                  onBlur={e=>updateQty(it.__i,e.target.value)}
                                  onKeyDown={e=>e.key==="Enter"&&e.target.blur()}
                                  style={{width:42,textAlign:"center",background:"rgba(59,91,139,0.08)",border:`1px solid ${T.border}`,borderRadius:5,color:T.text,fontFamily:"monospace",fontSize:11,padding:"3px 2px",outline:"none"}}/>
                              </td>
                            ])}
                            {Array(4-chunk.length).fill(null).flatMap((_,i)=>[
                              <td key={`e1-${ci}-${i}`} style={{border:`1px solid ${T.border}`,background:"#fafafa"}}/>,
                              <td key={`e2-${ci}-${i}`} style={{border:`1px solid ${T.border}`,background:"#fafafa"}}/>
                            ])}
                            <td style={{padding:"6px 8px",textAlign:"center",fontFamily:"monospace",fontWeight:700,color:T.accent,verticalAlign:"middle",border:`1px solid ${T.border}`}}>{rowQty}</td>
                            <td style={{padding:"4px 8px",textAlign:"right",verticalAlign:"middle",border:`1px solid ${T.border}`}}>
                              <input type="number" defaultValue={rowUnit} min="0" step="0.01"
                                onFocus={e=>e.target.select()}
                                onBlur={e=>{const v=Math.max(0,Number(e.target.value)||0);const ids=chunk.map(c=>c.__i);setInvoiceForm(f=>({...f,items:f.items.map((x,j)=>ids.includes(j)?{...x,unitPrice:v}:x)}));}}
                                onKeyDown={e=>e.key==="Enter"&&e.target.blur()}
                                style={{width:72,textAlign:"right",background:"rgba(52,211,153,0.08)",border:"1px solid rgba(52,211,153,0.3)",borderRadius:5,color:"#34d399",fontFamily:"monospace",fontSize:11,fontWeight:600,padding:"4px 6px",outline:"none"}}/>
                            </td>
                            <td style={{padding:"6px 8px",textAlign:"right",fontFamily:"monospace",fontWeight:700,color:"#34d399",verticalAlign:"middle",border:`1px solid ${T.border}`}}>
                              ฿{rowSub.toLocaleString("th-TH",{minimumFractionDigits:2})}
                            </td>
                            <td style={{textAlign:"center",border:`1px solid ${T.border}`}}>{ci===0&&<button onClick={()=>removeGroup(group.items)} style={{background:"none",border:"none",color:"#f87171",cursor:"pointer",fontSize:13}}>✕</button>}</td>
                          </tr>
                        );
                      });
                    })}
                    {generic.length>1 && (
                      <tr style={{background:"rgba(217,119,6,0.06)"}}>
                        <td colSpan={13} style={{padding:"6px 10px",border:`1px solid ${T.border}`,fontSize:11}}>
                          <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                            <span style={{color:"#92400e",fontWeight:600}}>🎨 ใส่สีให้ทุกแถว ({generic.length} รายการ):</span>
                            <select onChange={e => {
                              const idx = e.target.value;
                              if (idx === "") return;
                              const p = PRESET_COLORS[idx];
                              if (!p) return;
                              const genericIds = generic.map(g => g.__i);
                              setInvoiceForm(f => ({...f, items: f.items.map((x,j) => genericIds.includes(j) ? {...x, colorName:p.name, colorHex:p.hex} : x)}));
                              e.target.value = "";
                            }} style={{background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:6,padding:"4px 8px",fontSize:11,cursor:"pointer",fontFamily:"inherit"}}>
                              <option value="">เลือกสี...</option>
                              {PRESET_COLORS.map((c,i) => <option key={i} value={i}>{c.name}</option>)}
                            </select>
                            <input type="color" onChange={e => {
                              const hex = e.target.value;
                              const genericIds = generic.map(g => g.__i);
                              setInvoiceForm(f => ({...f, items: f.items.map((x,j) => genericIds.includes(j) ? {...x, colorHex:hex} : x)}));
                            }} style={{width:32,height:24,border:`1px solid ${T.inputBorder}`,borderRadius:4,cursor:"pointer",padding:1}} title="เลือกสีกำหนดเอง"/>
                            <input placeholder="หรือพิมพ์ชื่อสีเอง" onKeyDown={e => {
                              if (e.key === "Enter" && e.target.value.trim()) {
                                const name = e.target.value.trim();
                                const genericIds = generic.map(g => g.__i);
                                setInvoiceForm(f => ({...f, items: f.items.map((x,j) => genericIds.includes(j) ? {...x, colorName:name} : x)}));
                                e.target.value = "";
                              }
                            }} style={{flex:"1 1 140px",background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:6,padding:"4px 8px",fontSize:11,outline:"none",fontFamily:"inherit"}}/>
                          </div>
                        </td>
                      </tr>
                    )}
                    {generic.map(it=>(
                      <tr key={`g-${it.__i}`}>
                        <td colSpan={10} style={{padding:"6px 10px",fontWeight:500,border:`1px solid ${T.border}`}}>
                          <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                            {it.colorHex&&<div style={{width:12,height:12,borderRadius:3,background:it.colorHex,border:"1px solid rgba(0,0,0,0.2)",flexShrink:0}}/>}
                            <span style={{fontWeight:600}}>{it.description}</span>
                            {it.colorName&&<span style={{padding:"1px 6px",background:"rgba(59,91,139,0.08)",color:T.accent,borderRadius:8,fontSize:10,fontWeight:600}}>{it.colorName}</span>}
                            {it.size&&<span style={{padding:"1px 6px",background:"rgba(16,185,129,0.08)",color:T.green,borderRadius:8,fontSize:10,fontFamily:"monospace",fontWeight:700}}>{it.size}</span>}
                            {it.unit&&<span style={{color:T.muted,fontSize:10}}>· {it.unit}</span>}
                          </div>
                        </td>
                        <td style={{padding:"4px 8px",textAlign:"center",border:`1px solid ${T.border}`}}>
                          <input type="number" defaultValue={it.qty} min="1"
                            onFocus={e=>e.target.select()}
                            onBlur={e=>updateQty(it.__i,e.target.value)}
                            onKeyDown={e=>e.key==="Enter"&&e.target.blur()}
                            style={{width:48,textAlign:"center",background:"rgba(59,91,139,0.08)",border:`1px solid ${T.border}`,borderRadius:5,color:T.text,fontFamily:"monospace",fontSize:11,padding:"4px",outline:"none"}}/>
                        </td>
                        <td style={{padding:"4px 8px",textAlign:"right",border:`1px solid ${T.border}`}}>
                          <input type="number" defaultValue={it.unitPrice} min="0" step="0.01"
                            onFocus={e=>e.target.select()}
                            onBlur={e=>updatePrice(it.__i,e.target.value)}
                            onKeyDown={e=>e.key==="Enter"&&e.target.blur()}
                            style={{width:72,textAlign:"right",background:"rgba(52,211,153,0.08)",border:"1px solid rgba(52,211,153,0.3)",borderRadius:5,color:"#34d399",fontFamily:"monospace",fontSize:11,fontWeight:600,padding:"4px 6px",outline:"none"}}/>
                        </td>
                        <td style={{padding:"6px 8px",textAlign:"right",fontFamily:"monospace",fontWeight:700,color:"#34d399",border:`1px solid ${T.border}`}}>฿{(it.qty*it.unitPrice).toLocaleString("th-TH",{minimumFractionDigits:2})}</td>
                        <td style={{textAlign:"center",border:`1px solid ${T.border}`}}><button onClick={()=>removeItem(it.__i)} style={{background:"none",border:"none",color:"#f87171",cursor:"pointer",fontSize:13}}>✕</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {(()=>{const c=calcInvoice(invoiceForm.items,invoiceForm.vatRate,invoiceVat,invoiceForm.discount,invoiceForm.discountType,invoiceForm.useShipping,invoiceForm.shippingFee);return(
                  <div style={{padding:"10px 12px",borderTop:`1px solid ${T.border}`,fontSize:12,display:"flex",justifyContent:"space-between",alignItems:"flex-end",gap:14,flexWrap:"wrap"}}>
                    <div style={{display:"flex",flexDirection:"column",gap:6}}>
                      {/* ส่วนลดท้ายบิล input */}
                      <div style={{display:"flex",alignItems:"center",gap:6}}>
                        <span style={{fontSize:11,color:T.muted,fontWeight:600}}>💸 ส่วนลดท้ายบิล:</span>
                        <input type="number" min="0" step="0.01" value={invoiceForm.discount||0}
                          onFocus={e=>e.target.select()}
                          onChange={e=>setInvoiceForm(f=>({...f,discount:Number(e.target.value)||0}))}
                          style={{width:80,textAlign:"right",background:"rgba(184,134,0,0.08)",border:"1px solid rgba(184,134,0,0.3)",color:T.amber,borderRadius:6,padding:"5px 8px",fontFamily:"monospace",fontSize:12,fontWeight:600,outline:"none"}}/>
                        <select value={invoiceForm.discountType||"amount"} onChange={e=>setInvoiceForm(f=>({...f,discountType:e.target.value}))}
                          style={{background:T.input,border:`1px solid ${T.border}`,color:T.text,borderRadius:6,padding:"5px 8px",fontSize:11,outline:"none",cursor:"pointer"}}>
                          <option value="amount">฿ บาท</option>
                          <option value="percent">% เปอร์เซ็นต์</option>
                        </select>
                      </div>
                      {/* ค่าจัดส่ง (checkbox + input) */}
                      <div style={{display:"flex",alignItems:"center",gap:6}}>
                        <label style={{display:"flex",alignItems:"center",gap:5,cursor:"pointer",fontSize:11,color:T.muted,fontWeight:600}}>
                          <input type="checkbox" checked={!!invoiceForm.useShipping} onChange={e=>setInvoiceForm(f=>({...f,useShipping:e.target.checked}))} style={{cursor:"pointer"}}/>
                          🚚 ค่าจัดส่ง:
                        </label>
                        <input type="number" min="0" step="0.01" value={invoiceForm.shippingFee||0}
                          disabled={!invoiceForm.useShipping}
                          onFocus={e=>e.target.select()}
                          onChange={e=>setInvoiceForm(f=>({...f,shippingFee:Number(e.target.value)||0}))}
                          style={{width:80,textAlign:"right",background:invoiceForm.useShipping?"rgba(59,91,139,0.08)":"rgba(0,0,0,0.04)",border:`1px solid ${invoiceForm.useShipping?"rgba(59,91,139,0.3)":T.border}`,color:invoiceForm.useShipping?T.accent:T.muted,borderRadius:6,padding:"5px 8px",fontFamily:"monospace",fontSize:12,fontWeight:600,outline:"none"}}/>
                        <span style={{fontSize:11,color:T.muted}}>บาท</span>
                      </div>
                    </div>
                    {/* Totals */}
                    <div style={{textAlign:"right"}}>
                      <div style={{color:T.sub,marginBottom:2,fontSize:11}}>ราคารวม: <b style={{fontFamily:"monospace",color:T.text}}>฿{c.grossSubtotal.toLocaleString("th-TH",{minimumFractionDigits:2})}</b></div>
                      {c.itemDiscountTotal>0&&<div style={{color:T.amber,marginBottom:2,fontSize:11}}>ส่วนลดรายการ: <b style={{fontFamily:"monospace"}}>-฿{c.itemDiscountTotal.toLocaleString("th-TH",{minimumFractionDigits:2})}</b></div>}
                      {c.billDiscount>0&&<div style={{color:T.amber,marginBottom:2,fontSize:11}}>ส่วนลดท้ายบิล: <b style={{fontFamily:"monospace"}}>-฿{c.billDiscount.toLocaleString("th-TH",{minimumFractionDigits:2})}</b></div>}
                      <div style={{color:T.sub,marginBottom:2}}>ยอดก่อนภาษี: <b style={{fontFamily:"monospace",color:T.text}}>฿{c.subtotal.toLocaleString("th-TH",{minimumFractionDigits:2})}</b></div>
                      {invoiceVat&&<div style={{color:T.sub,marginBottom:2}}>VAT {invoiceForm.vatRate}%: <b style={{fontFamily:"monospace",color:T.text}}>฿{c.vat.toLocaleString("th-TH",{minimumFractionDigits:2})}</b></div>}
                      {c.shipping>0&&<div style={{color:T.sub,marginBottom:2}}>🚚 ค่าจัดส่ง: <b style={{fontFamily:"monospace",color:T.text}}>฿{c.shipping.toLocaleString("th-TH",{minimumFractionDigits:2})}</b></div>}
                      <div style={{color:"#34d399",fontSize:14,fontWeight:700}}>ยอดรวม: <span style={{fontFamily:"monospace"}}>฿{c.total.toLocaleString("th-TH",{minimumFractionDigits:2})}</span></div>
                    </div>
                  </div>
                )})()}
              </div>
            );
          })()}

          {/* Add item form (พับได้) */}
          <div style={{padding:14,background:"rgba(59,91,139,0.06)",border:"1px solid rgba(59,91,139,0.2)",borderRadius:10,marginBottom:16}}>
            <div onClick={()=>setAddItemCollapsed(c=>!c)}
              style={{display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"pointer",marginBottom:addItemCollapsed?0:10,userSelect:"none"}}>
              <div style={{fontSize:11,color:T.accent,fontWeight:600,display:"flex",alignItems:"center",gap:8}}>
                <span style={{display:"inline-block",width:18,height:18,borderRadius:5,background:"rgba(59,91,139,0.15)",border:"1px solid rgba(59,91,139,0.3)",textAlign:"center",lineHeight:"16px",fontSize:10,color:T.accent,transition:"transform 0.2s",transform:addItemCollapsed?"rotate(-90deg)":"rotate(0deg)"}}>▼</span>
                ➕ เพิ่มรายการสินค้า / บริการ
              </div>
              <span style={{fontSize:10,color:T.muted}}>{addItemCollapsed?"คลิกเพื่อขยาย":"คลิกเพื่อพับ"}</span>
            </div>
            {!addItemCollapsed&&<>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
              <div style={{gridColumn:"1/-1"}}>
                <label style={{fontSize:11,color:T.muted,display:"block",marginBottom:4,fontWeight:600}}>ชื่อรายการ *</label>
                <input value={invoiceItemForm.description} onChange={e=>setInvoiceItemForm(f=>({...f,description:e.target.value}))}
                  onKeyDown={e=>e.key==="Enter"&&handleAddInvoiceItem()}
                  placeholder="เช่น เสื้อยืด รุ่น A ดำ M / ลายพิมพ์โลโก้ DTF / ค่าออกแบบ..."
                  style={{width:"100%",background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:8,padding:"9px 12px",fontFamily:"'Sarabun',sans-serif",fontSize:13,outline:"none"}}/>
              </div>
              <div>
                <label style={{fontSize:11,color:T.muted,display:"block",marginBottom:4,fontWeight:600}}>จำนวน *</label>
                <input type="number" min="1" value={invoiceItemForm.qty} onChange={e=>setInvoiceItemForm(f=>({...f,qty:e.target.value}))} placeholder="0"
                  style={{width:"100%",background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:8,padding:"9px 12px",fontFamily:"monospace",fontSize:13,outline:"none",textAlign:"center"}}/>
              </div>
              <div>
                <label style={{fontSize:11,color:T.muted,display:"block",marginBottom:4,fontWeight:600}}>หน่วย</label>
                <select value={invoiceItemForm.unit} onChange={e=>setInvoiceItemForm(f=>({...f,unit:e.target.value}))}
                  style={{width:"100%",background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:8,padding:"9px 12px",fontFamily:"'Sarabun',sans-serif",fontSize:13,outline:"none"}}>
                  {["ชิ้น","ตัว","โหล","แพ็ค","กล่อง","ชุด","งาน","อัน"].map(u=><option key={u}>{u}</option>)}
                </select>
              </div>
              <div style={{gridColumn:"1/-1"}}>
                <label style={{fontSize:11,color:T.muted,display:"block",marginBottom:4,fontWeight:600}}>ไซส์ (ถ้ามี)</label>
                <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                  {[...apparelSizes, ...shoeSizes.filter(s=>!apparelSizes.includes(s))].map(sz=>{
                    const sel=invoiceItemForm.size===sz;
                    return (
                      <button key={sz} type="button" onClick={()=>setInvoiceItemForm(f=>({...f,size:sel?"":sz}))}
                        style={{padding:"6px 12px",borderRadius:7,border:`1px solid ${sel?"#3b5b8b":T.border}`,background:sel?"rgba(59,91,139,0.15)":"transparent",color:sel?T.accent:T.sub,fontFamily:"monospace",fontWeight:700,fontSize:12,cursor:"pointer"}}>{sz}</button>
                    );
                  })}
                </div>
              </div>
              <div style={{gridColumn:"1/-1"}}>
                <label style={{fontSize:11,color:T.muted,display:"block",marginBottom:4,fontWeight:600}}>สี (ถ้ามี)</label>
                <div style={{display:"flex",gap:8,alignItems:"center"}}>
                  <input type="color" value={invoiceItemForm.colorHex||"#ffffff"} onChange={e=>setInvoiceItemForm(f=>({...f,colorHex:e.target.value}))}
                    style={{width:42,height:38,background:T.input,border:`1px solid ${T.inputBorder}`,borderRadius:8,cursor:"pointer",padding:2}}/>
                  <input value={invoiceItemForm.colorName||""} onChange={e=>setInvoiceItemForm(f=>({...f,colorName:e.target.value}))} placeholder="เช่น ดำ / แดง / กรม (ว่างไว้ได้)"
                    style={{flex:1,background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:8,padding:"9px 12px",fontFamily:"'Sarabun',sans-serif",fontSize:13,outline:"none"}}/>
                  <select onChange={e=>{const p=PRESET_COLORS[e.target.value];if(p){setInvoiceItemForm(f=>({...f,colorName:p.name,colorHex:p.hex}));}e.target.value="";}}
                    style={{background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:8,padding:"9px 10px",fontFamily:"'Sarabun',sans-serif",fontSize:12,outline:"none",cursor:"pointer"}}>
                    <option value="">เลือกสีสำเร็จ...</option>
                    {PRESET_COLORS.map((c,i)=><option key={i} value={i}>{c.name}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label style={{fontSize:11,color:T.muted,display:"block",marginBottom:4,fontWeight:600}}>ราคาต่อหน่วย (฿) *</label>
                <input type="number" min="0" value={invoiceItemForm.unitPrice} onChange={e=>setInvoiceItemForm(f=>({...f,unitPrice:e.target.value}))} placeholder="0.00"
                  style={{width:"100%",background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:8,padding:"9px 12px",fontFamily:"monospace",fontSize:13,outline:"none",textAlign:"right"}}/>
              </div>
              <div style={{display:"flex",alignItems:"flex-end"}}>
                <div style={{padding:"9px 14px",borderRadius:8,background:"rgba(52,211,153,0.1)",border:"1px solid rgba(52,211,153,0.2)",width:"100%",textAlign:"right"}}>
                  <div style={{fontSize:10,color:T.muted,marginBottom:2}}>รวม</div>
                  <div style={{fontFamily:"monospace",fontWeight:700,fontSize:14,color:"#34d399"}}>
                    ฿{((Number(invoiceItemForm.qty)||0)*(Number(invoiceItemForm.unitPrice)||0)).toLocaleString("th-TH",{minimumFractionDigits:2})}
                  </div>
                </div>
              </div>
            </div>
            <button onClick={handleAddInvoiceItem} disabled={!invoiceItemForm.description||!invoiceItemForm.qty||!invoiceItemForm.unitPrice}
              style={{width:"100%",padding:"9px",borderRadius:8,border:"none",cursor:"pointer",background:"linear-gradient(135deg,#3b5b8b,#3b5b8b)",color:"white",fontSize:13,fontWeight:600,fontFamily:"'Sarabun',sans-serif",opacity:(!invoiceItemForm.description||!invoiceItemForm.qty||!invoiceItemForm.unitPrice)?0.45:1,boxShadow:"0 4px 14px rgba(59,91,139,0.25)"}}>
              ✅ เพิ่มรายการนี้
            </button>
            </>}
          </div>

          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:16}}>
            <div>
              <label style={{fontSize:11,color:T.muted,display:"block",marginBottom:4,fontWeight:600}}>วันที่ครบกำหนด</label>
              <input type="date" value={invoiceForm.dueDate} onChange={e=>setInvoiceForm(f=>({...f,dueDate:e.target.value}))}
                style={{width:"100%",background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:9,padding:"8px 12px",fontFamily:"'Sarabun',sans-serif",fontSize:13,outline:"none"}}/>
            </div>
            <div>
              <label style={{fontSize:11,color:T.muted,display:"block",marginBottom:4,fontWeight:600}}>หมายเหตุ</label>
              <input value={invoiceForm.note} onChange={e=>setInvoiceForm(f=>({...f,note:e.target.value}))} placeholder="หมายเหตุเพิ่มเติม..."
                style={{width:"100%",background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:9,padding:"8px 12px",fontFamily:"'Sarabun',sans-serif",fontSize:13,outline:"none"}}/>
            </div>
          </div>

          <div style={{display:"flex",gap:10}}>
            <BtnGhost onClick={()=>{setShowNewInvoice(false);setEditingInvoiceId(null);}} style={{flex:1}}>ยกเลิก</BtnGhost>
            <BtnPrimary onClick={handleConfirmInvoice} disabled={!invoiceForm.customerName||invoiceForm.items.length===0} style={{flex:2,opacity:(!invoiceForm.customerName||invoiceForm.items.length===0)?0.45:1}}>
              {editingInvoiceId ? `💾 บันทึกการแก้ไข ${docTypeLabel(invoiceDocType)}` : `✅ ออก${docTypeLabel(invoiceDocType)} + บันทึก`}
            </BtnPrimary>
          </div>
        </Modal>
      )}

      {/* ── MODAL: จัดการการชำระเงิน ── */}
      {paymentModal&&(()=>{
        const inv = paymentModal;
        const paid = getPaidTotal(inv);
        const total = Number(inv.total)||0;
        const remaining = Math.max(0, total - paid);
        const pct = total>0 ? Math.min(100, Math.round(paid/total*100)) : 0;
        return (
        <Modal onClose={closePaymentModal} w={680}>
          <MHead title={`💵 การชำระเงิน · ${inv.invoiceNo}`} sub={`${inv.customerName} · ${inv.customerPhone||""}`} onClose={closePaymentModal}/>
          {/* สรุปยอด */}
          <div style={{padding:"14px 16px",background:"linear-gradient(135deg,rgba(59,91,139,0.06),rgba(16,185,129,0.04))",border:`1px solid ${T.border}`,borderRadius:10,marginBottom:14,display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12}}>
            <div><div style={{fontSize:10,color:T.muted,fontWeight:600,marginBottom:2}}>ยอดบิล</div><div style={{fontSize:16,fontWeight:800,color:T.text,fontFamily:"monospace"}}>฿{total.toLocaleString("th-TH",{minimumFractionDigits:2})}</div></div>
            <div><div style={{fontSize:10,color:T.muted,fontWeight:600,marginBottom:2}}>ชำระแล้ว</div><div style={{fontSize:16,fontWeight:800,color:T.green,fontFamily:"monospace"}}>฿{paid.toLocaleString("th-TH",{minimumFractionDigits:2})}</div><div style={{fontSize:10,color:T.muted}}>({pct}%)</div></div>
            <div><div style={{fontSize:10,color:T.muted,fontWeight:600,marginBottom:2}}>คงเหลือ</div><div style={{fontSize:16,fontWeight:800,color:remaining>0?T.amber:T.green,fontFamily:"monospace"}}>฿{remaining.toLocaleString("th-TH",{minimumFractionDigits:2})}</div></div>
          </div>
          {/* progress bar */}
          <div style={{height:6,background:T.border,borderRadius:3,overflow:"hidden",marginBottom:16}}>
            <div style={{height:"100%",width:`${pct}%`,background:pct>=100?T.green:T.amber,transition:"width 0.3s"}}/>
          </div>

          {/* รายการชำระที่มีแล้ว */}
          {(inv.payments||[]).length>0&&(
            <div style={{marginBottom:14}}>
              <div style={{fontSize:11,color:T.muted,fontWeight:700,marginBottom:8,letterSpacing:"0.04em"}}>📜 ประวัติการชำระ ({(inv.payments||[]).length} รายการ)</div>
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                {(inv.payments||[]).map(p=>(
                  <div key={p.id} style={{padding:"8px 10px",background:"white",border:`1px solid ${T.border}`,borderRadius:7,display:"grid",gridTemplateColumns:"60px 1fr auto auto 28px",gap:8,alignItems:"center"}}>
                    <span style={{padding:"3px 8px",borderRadius:10,fontSize:10,fontWeight:700,background:p.method==="โอน"?"rgba(59,91,139,0.1)":p.method==="COD"?"rgba(245,158,11,0.1)":"rgba(16,185,129,0.1)",color:p.method==="โอน"?T.accent:p.method==="COD"?T.amber:T.green,textAlign:"center"}}>{p.method}</span>
                    <div>
                      <div style={{fontSize:12,color:T.text,fontWeight:600}}>{p.date}{p.bank?` · ${p.bank}`:""}</div>
                      {p.note&&<div style={{fontSize:10,color:T.muted,marginTop:1}}>{p.note}</div>}
                      <div style={{fontSize:9,color:T.muted,marginTop:1}}>โดย {p.receivedBy||"-"}</div>
                    </div>
                    <span style={{fontSize:13,fontWeight:800,color:T.green,fontFamily:"monospace"}}>฿{Number(p.amount).toLocaleString("th-TH",{minimumFractionDigits:2})}</span>
                    {p.slip ? (
                      <button onClick={()=>window.open(p.slip,"_blank")} title="ดูสลิป" style={{padding:"4px 8px",background:"rgba(59,91,139,0.08)",border:"1px solid rgba(59,91,139,0.25)",borderRadius:5,color:T.accent,fontSize:10,cursor:"pointer",fontFamily:"inherit"}}>🧾 ดู</button>
                    ) : <span style={{fontSize:10,color:T.muted}}>—</span>}
                    {role.canDelete&&<button onClick={()=>handleRemovePayment(p.id)} title="ลบ" style={{padding:"4px 6px",background:"#fef2f2",border:"1px solid #fecaca",borderRadius:5,color:T.red,fontSize:11,cursor:"pointer"}}>✕</button>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ฟอร์มเพิ่มการชำระ */}
          <div style={{padding:14,background:"rgba(16,185,129,0.04)",border:"1px dashed rgba(16,185,129,0.3)",borderRadius:10,marginBottom:10}}>
            <div style={{fontSize:11,color:T.green,fontWeight:700,marginBottom:10,letterSpacing:"0.04em"}}>➕ เพิ่มการชำระเงิน</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:8}}>
              <div>
                <label style={{fontSize:10,color:T.muted,display:"block",marginBottom:3,fontWeight:600}}>จำนวนเงิน (บาท) *</label>
                <input type="number" min="0" step="0.01" value={payForm.amount} onFocus={e=>e.target.select()}
                  onChange={e=>setPayForm(f=>({...f,amount:e.target.value}))}
                  style={{width:"100%",background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:6,padding:"7px 9px",fontFamily:"monospace",fontSize:13,fontWeight:700,outline:"none",textAlign:"right"}}/>
              </div>
              <div>
                <label style={{fontSize:10,color:T.muted,display:"block",marginBottom:3,fontWeight:600}}>ช่องทาง *</label>
                <select value={payForm.method} onChange={e=>setPayForm(f=>({...f,method:e.target.value}))}
                  style={{width:"100%",background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:6,padding:"7px 9px",fontSize:12,outline:"none",cursor:"pointer",fontFamily:"inherit"}}>
                  {PAYMENT_METHODS.map(m=><option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <label style={{fontSize:10,color:T.muted,display:"block",marginBottom:3,fontWeight:600}}>ธนาคาร / หมายเหตุช่องทาง</label>
                <input value={payForm.bank} onChange={e=>setPayForm(f=>({...f,bank:e.target.value}))}
                  placeholder={payForm.method==="โอน"?"เช่น SCB, KBank":payForm.method==="COD"?"Kerry/Flash":""}
                  style={{width:"100%",background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:6,padding:"7px 9px",fontSize:12,outline:"none",fontFamily:"inherit"}}/>
              </div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
              <div>
                <label style={{fontSize:10,color:T.muted,display:"block",marginBottom:3,fontWeight:600}}>วันที่ / เวลาที่ชำระ</label>
                <input value={payForm.date} onChange={e=>setPayForm(f=>({...f,date:e.target.value}))}
                  style={{width:"100%",background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:6,padding:"7px 9px",fontSize:12,outline:"none",fontFamily:"inherit"}}/>
              </div>
              <div>
                <label style={{fontSize:10,color:T.muted,display:"block",marginBottom:3,fontWeight:600}}>หมายเหตุ</label>
                <input value={payForm.note} onChange={e=>setPayForm(f=>({...f,note:e.target.value}))}
                  placeholder="เช่น มัดจำ 50%"
                  style={{width:"100%",background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:6,padding:"7px 9px",fontSize:12,outline:"none",fontFamily:"inherit"}}/>
              </div>
            </div>
            {/* สลิป */}
            <div style={{display:"flex",alignItems:"center",gap:8,padding:8,background:"white",border:`1px dashed ${T.border}`,borderRadius:7}}>
              {payForm.slip ? (
                <>
                  <img src={payForm.slip} alt="slip" style={{width:64,height:64,objectFit:"cover",borderRadius:6,border:`1px solid ${T.border}`}}/>
                  <div style={{flex:1,fontSize:11,color:T.text}}>
                    <div style={{fontWeight:600}}>{payForm.slipFileName||"slip.jpg"}</div>
                    <div style={{color:T.muted,fontSize:10,marginTop:1}}>บีบรูปเรียบร้อย</div>
                  </div>
                  <button onClick={()=>setPayForm(f=>({...f,slip:"",slipFileName:""}))} style={{padding:"4px 10px",background:"#fef2f2",border:"1px solid #fecaca",borderRadius:5,color:T.red,fontSize:11,cursor:"pointer",fontFamily:"inherit"}}>✕ ลบ</button>
                </>
              ) : (
                <>
                  <span style={{fontSize:20}}>🧾</span>
                  <div style={{flex:1,fontSize:11,color:T.muted}}>แนบสลิปโอนเงิน (ถ้ามี)</div>
                  <label style={{padding:"5px 12px",background:"rgba(59,91,139,0.08)",border:"1px solid rgba(59,91,139,0.3)",borderRadius:6,color:T.accent,fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
                    📁 อัปโหลด
                    <input type="file" accept="image/*" style={{display:"none"}} onChange={handlePaySlipUpload}/>
                  </label>
                </>
              )}
            </div>
          </div>

          <div style={{display:"flex",gap:8}}>
            <BtnGhost onClick={closePaymentModal} disabled={paySaving} style={{flex:1}}>ปิด</BtnGhost>
            <BtnPrimary onClick={handleAddPayment} disabled={paySaving||!Number(payForm.amount)} style={{flex:2}}>{paySaving?"⏳ กำลังบันทึก...":"💾 บันทึกการชำระ"}</BtnPrimary>
          </div>
        </Modal>
        );
      })()}

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
      {showPrintInvoice&&(
        <div className="print-modal-overlay" style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.88)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:500,backdropFilter:"blur(6px)"}}
          onMouseDown={e=>{if(e.target===e.currentTarget)setShowPrintInvoice(null);}}>
          <div className="print-modal-card" onMouseDown={e=>e.stopPropagation()} style={{background:"white",borderRadius:16,width:760,maxHeight:"94vh",overflowY:"auto",boxShadow:"0 24px 60px rgba(0,0,0,0.7)"}}>

            {/* ── เนื้อหาบิล (พิมพ์ได้) ── */}
            <div id="invoice-print-area" style={{padding:"12px 28px 14px",fontFamily:"'Sarabun',sans-serif",color:"#000"}}>

              {/* ── HEADER ── */}
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12,paddingBottom:10,borderBottom:"2px solid #000"}}>
                {/* ข้อมูลบริษัท */}
                <div style={{flex:1}}>
                  <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:4}}>
                    <div style={{width:42,height:42,borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,overflow:"hidden",background:"white"}}>
                      <img src={`${process.env.PUBLIC_URL}/cpu-logo.png`} alt="CPU Logo" style={{width:"100%",height:"100%",objectFit:"contain"}}
                        onError={(e)=>{e.target.style.display="none";e.target.parentElement.innerHTML=companyInfo.logo||"⚙️";e.target.parentElement.style.background="#000";e.target.parentElement.style.fontSize="20px";e.target.parentElement.style.color="white";}}/>
                    </div>
                    <div>
                      <div style={{fontSize:17,fontWeight:800,color:"#000",letterSpacing:1.5}}>{companyInfo.name||"CPU"}</div>
                    </div>
                  </div>
                  {companyInfo.address&&<div style={{fontSize:10,color:"#000",marginBottom:1,maxWidth:280,lineHeight:1.5}}>{companyInfo.address}</div>}
                  <div style={{display:"flex",flexWrap:"wrap",gap:12,marginTop:1}}>
                    {companyInfo.phone&&<div style={{fontSize:10,color:"#000"}}>โทร: {companyInfo.phone}</div>}
                    {companyInfo.email&&<div style={{fontSize:10,color:"#000"}}>{companyInfo.email}</div>}
                  </div>
                  {(showPrintInvoice.showCompanyTaxId!==false)&&companyInfo.taxId&&<div style={{fontSize:10,color:"#000",marginTop:1}}>เลขผู้เสียภาษี: {companyInfo.taxId}</div>}
                </div>

                {/* ประเภทเอกสาร + เลขที่ */}
                <div style={{textAlign:"right",minWidth:200}}>
                  <div data-doc-label style={{display:"inline-block",background:"#fff",color:"#000",padding:"4px 16px",borderRadius:4,fontSize:15,fontWeight:800,marginBottom:6,letterSpacing:1,border:"2px solid #000"}}>
                    {docTypeLabel(showPrintInvoice.docType)}
                  </div>
                  {showPrintInvoice.revisions>0 && (
                    <div style={{fontSize:9,color:"#000",marginBottom:4,fontWeight:600}}>
                      ✏️ แก้ไขครั้งที่ {showPrintInvoice.revisions}{showPrintInvoice.lastEditedBy?` · ${showPrintInvoice.lastEditedBy}`:""}{showPrintInvoice.lastEditedAt?` · ${showPrintInvoice.lastEditedAt}`:""}
                    </div>
                  )}
                  {showPrintInvoice.convertedFrom && (
                    <div style={{fontSize:9,color:"#000",marginBottom:4,fontWeight:600}}>
                      🔄 แปลงมาจาก {docTypeLabel(showPrintInvoice.convertedFrom.docType)} {showPrintInvoice.convertedFrom.invoiceNo}
                    </div>
                  )}
                  <div style={{display:"flex",flexDirection:"column",gap:2}}>
                    <div style={{display:"flex",justifyContent:"flex-end",gap:6}}>
                      <span style={{fontSize:10,color:"#000",fontWeight:600,minWidth:56,textAlign:"right"}}>เลขที่:</span>
                      <span style={{fontSize:11,color:"#000",fontFamily:"monospace",fontWeight:700}}>{showPrintInvoice.invoiceNo}</span>
                    </div>
                    <div style={{display:"flex",justifyContent:"flex-end",gap:6}}>
                      <span style={{fontSize:10,color:"#000",fontWeight:600,minWidth:56,textAlign:"right"}}>วันที่ออก:</span>
                      <span style={{fontSize:10,color:"#000",fontWeight:600}}>{showPrintInvoice.date}</span>
                    </div>
                    {showPrintInvoice.dueDate&&(
                      <div style={{display:"flex",justifyContent:"flex-end",gap:6}}>
                        <span style={{fontSize:10,color:"#000",fontWeight:600,minWidth:56,textAlign:"right"}}>ครบกำหนด:</span>
                        <span style={{fontSize:10,color:"#000",fontWeight:700}}>{showPrintInvoice.dueDate}</span>
                      </div>
                    )}
                    {showPrintInvoice.useVat&&(
                      <div style={{marginTop:3,textAlign:"right"}}>
                        <span style={{padding:"1px 6px",background:"#fff",borderRadius:4,fontSize:9,color:"#000",fontWeight:700,border:"1px solid #000"}}>มี VAT {showPrintInvoice.vatRate}%</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* ── BILL TO / FROM — ขอบเล็กลง สีดำ ── */}
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:0,marginBottom:10,border:"1px solid #000",borderRadius:4,overflow:"hidden"}}>
                <div style={{padding:"8px 12px",background:"#f8fafc",borderRight:"1px solid #000"}}>
                  <div style={{fontSize:10,color:"#000",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:4,paddingBottom:3,borderBottom:"1px solid #000"}}>ออกให้แก่ (Bill To)</div>
                  <div style={{fontSize:14,fontWeight:700,color:"#000",marginBottom:2}}>{showPrintInvoice.customerName||"-"}</div>
                  {showPrintInvoice.customerPhone&&<div style={{fontSize:11,color:"#000",marginBottom:1}}>โทร: {showPrintInvoice.customerPhone}</div>}
                  {showPrintInvoice.customerTaxId&&<div style={{fontSize:11,color:"#000",marginBottom:1}}>เลขผู้เสียภาษี: {showPrintInvoice.customerTaxId}</div>}
                  {showPrintInvoice.customerAddress&&<div style={{fontSize:11,color:"#000",lineHeight:1.5,marginTop:2}}>{showPrintInvoice.customerAddress}</div>}
                </div>
                <div style={{padding:"8px 12px",background:"#f8fafc"}}>
                  <div style={{fontSize:10,color:"#000",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:4,paddingBottom:3,borderBottom:"1px solid #000"}}>ออกโดย (From)</div>
                  <div style={{fontSize:13,fontWeight:700,color:"#000",marginBottom:2}}>{companyInfo.name||"CPU"}</div>
                  {companyInfo.phone&&<div style={{fontSize:11,color:"#000",marginBottom:1}}>โทร: {companyInfo.phone}</div>}
                  {companyInfo.email&&<div style={{fontSize:11,color:"#000",marginBottom:1}}>{companyInfo.email}</div>}
                  {companyInfo.address&&<div style={{fontSize:11,color:"#000",lineHeight:1.5,marginTop:2}}>{companyInfo.address}</div>}
                  {(showPrintInvoice.showCompanyTaxId!==false)&&companyInfo.taxId&&<div style={{fontSize:11,color:"#000",marginTop:1}}>เลขผู้เสียภาษี: {companyInfo.taxId}</div>}
                </div>
              </div>

              {/* ── รายละเอียดงาน Custom (รูป + ชนิดผ้า + ปก + ลักษณะงาน) ── */}
              {showPrintInvoice.customDetails&&(showPrintInvoice.customDetails.jobs||[]).length>0&&(
                <div style={{marginBottom:10,padding:"10px 12px",background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:8}}>
                  <div style={{fontSize:10,color:"#3b5b8b",fontWeight:800,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:8}}>📋 รายละเอียดงาน</div>
                  {(showPrintInvoice.customDetails.jobs||[]).map((j,ji)=>{
                    const imgs=j.images||[];
                    const cols=imgs.length<=1?1:(imgs.length===2?2:3);
                    return (
                      <div key={ji} style={{marginBottom:ji<(showPrintInvoice.customDetails.jobs.length-1)?10:0,paddingBottom:ji<(showPrintInvoice.customDetails.jobs.length-1)?10:0,borderBottom:ji<(showPrintInvoice.customDetails.jobs.length-1)?"1px dashed #cbd5e1":"none"}}>
                        <div style={{display:"flex",alignItems:"baseline",gap:8,flexWrap:"wrap",marginBottom:6}}>
                          {j.prodNo&&<span style={{fontSize:10,fontFamily:"monospace",color:"#3b5b8b",fontWeight:700,padding:"2px 7px",background:"#eff6ff",border:"1px solid #bfdbfe",borderRadius:4}}>{j.prodNo}</span>}
                          <span style={{fontSize:13,fontWeight:700,color:"#000"}}>{j.clothingName||"-"}</span>
                        </div>
                        {(j.fabricType||j.collarType||j.jobDescription)&&(
                          <div style={{display:"flex",flexWrap:"wrap",gap:6,fontSize:11,marginBottom:imgs.length>0?8:0}}>
                            {j.fabricType&&<span style={{padding:"2px 8px",background:"#eff6ff",border:"1px solid #bfdbfe",borderRadius:10,fontWeight:600,color:"#1e40af"}}>🧵 {j.fabricType}</span>}
                            {j.collarType&&<span style={{padding:"2px 8px",background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:10,fontWeight:600,color:"#15803d"}}>👔 {j.collarType}</span>}
                            {j.jobDescription&&<span style={{padding:"2px 8px",background:"#fffbeb",border:"1px solid #fde68a",borderRadius:10,fontWeight:600,color:"#78350f"}}>📋 {j.jobDescription}</span>}
                          </div>
                        )}
                        {j.note&&<div style={{fontSize:10,color:"#475569",marginBottom:imgs.length>0?8:0,fontStyle:"italic"}}>💬 {j.note}</div>}
                        {imgs.length>0&&(
                          <div style={{display:"grid",gridTemplateColumns:`repeat(${cols},1fr)`,gap:6}}>
                            {imgs.map((im,i)=>(
                              <div key={i} style={{textAlign:"center"}}>
                                <div style={{width:"100%",height:imgs.length===1?180:140,background:"#fff",border:"1px solid #e2e8f0",borderRadius:6,display:"flex",alignItems:"center",justifyContent:"center",overflow:"hidden"}}>
                                  <img src={im.dataUrl} alt="" style={{maxWidth:"100%",maxHeight:"100%",objectFit:"contain"}}/>
                                </div>
                                {im.label&&<div style={{fontSize:10,color:"#1e293b",fontWeight:700,marginTop:3}}>{im.label}</div>}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* ── ตารางรายการ (รุ่น | สี | SIZE×4 | จำนวน | ราคา) ── */}
              {(()=>{
                // ถ้ามีข้อมูล clothing แยก group ตามรุ่น+สี | ที่เหลือเป็น "อื่นๆ"
                const structured=(showPrintInvoice.items||[]).filter(i=>i.clothingId||i.clothingName);
                const generic=(showPrintInvoice.items||[]).filter(i=>!(i.clothingId||i.clothingName));
                const groups=Object.values(structured.reduce((acc,it)=>{
                  const k=`${it.clothingId||it.clothingName}-${it.colorIdx??""}|${it.colorName||""}|${it.variant||""}`;
                  if(!acc[k]) acc[k]={clothingName:it.clothingName,colorName:it.colorName,colorHex:it.colorHex,variant:it.variant||"",fabricType:it.fabricType||"",collarType:it.collarType||"",jobDescription:it.jobDescription||"",items:[]};
                  acc[k].items.push(it);
                  return acc;
                },{}));
                return (
                  <table style={{width:"100%",borderCollapse:"collapse",marginBottom:10,fontSize:13}}>
                    <thead>
                      <tr style={{background:"#f1f5f9",color:"#000"}}>
                        <th style={{padding:"6px 8px",textAlign:"left",fontWeight:700,border:"1px solid #000",fontSize:12,color:"#000"}}>รุ่น</th>
                        <th style={{padding:"6px 8px",textAlign:"left",fontWeight:700,border:"1px solid #000",fontSize:12,color:"#000"}}>สี</th>
                        {[1,2,3,4].flatMap(i=>[
                          <th key={`sh${i}`} style={{padding:"6px 4px",textAlign:"center",fontWeight:700,border:"1px solid #000",background:"#f1f5f9",color:"#000",minWidth:38,fontSize:11}}>SIZE</th>,
                          <th key={`qh${i}`} style={{padding:"6px 4px",textAlign:"center",fontWeight:700,border:"1px solid #000",minWidth:30,fontSize:11,color:"#000"}}></th>
                        ])}
                        <th style={{padding:"6px 8px",textAlign:"center",fontWeight:700,border:"1px solid #000",width:56,fontSize:12,color:"#000"}}>จำนวน</th>
                        <th style={{padding:"6px 6px",textAlign:"right",fontWeight:700,border:"1px solid #000",width:76,fontSize:11,color:"#000"}}>ราคา/หน่วย</th>
                        <th style={{padding:"6px 8px",textAlign:"right",fontWeight:700,border:"1px solid #000",width:96,fontSize:12,color:"#000"}}>ราคารวม (฿)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {groups.flatMap((group,gi)=>{
                        // ✨ sort + group (รองรับ 2XL-9XL)
                        const withSize = group.items.filter(i => i.size);
                        const noSize = group.items.filter(i => !i.size);
                        const rows = splitSizesIntoRows(withSize, 4, { fillPlus: false });
                        noSize.forEach(n => rows.push([n]));
                        if(rows.length===0) rows.push([]);
                        return rows.map((chunk,ci)=>{
                          const rowQty=chunk.reduce((s,i)=>s+i.qty,0);
                          const rowSub=chunk.reduce((s,i)=>s+(Number(i.unitPrice)||0)*i.qty,0);
                          return (
                            <tr key={`${gi}-${ci}`} style={{background:gi%2===0?"white":"#f8fafc"}}>
                              <td style={{padding:"5px 7px",fontWeight:600,color:"#000",verticalAlign:"middle",border:"1px solid #000",fontSize:11,width:60,textAlign:"center"}}>
                                {ci===0 ? group.clothingName : " "}
                              </td>
                              <td style={{padding:"5px 7px",verticalAlign:"middle",border:"1px solid #000",fontSize:11,color:"#000",width:70}}>
                                {ci===0 ? (
                                  <div style={{display:"flex",alignItems:"center",gap:4,justifyContent:"center"}}>
                                    <div style={{width:9,height:9,borderRadius:2,background:group.colorHex,border:"1px solid #000",flexShrink:0}}/>
                                    <span>{group.colorName}{group.variant?` (${group.variant})`:""}</span>
                                  </div>
                                ) : " "}
                              </td>
                              {chunk.map(it=>[
                                <td key={`s-${it.size}`} style={{padding:"6px 4px",textAlign:"center",fontFamily:"monospace",fontWeight:700,color:"#000",border:"1px solid #000",background:"#f1f5f9",fontSize:13}}>{it.size}</td>,
                                <td key={`q-${it.size}`} style={{padding:"6px 4px",textAlign:"center",fontFamily:"monospace",fontWeight:700,color:"#000",border:"1px solid #000",fontSize:13}}>{it.qty}</td>
                              ])}
                              {Array(4-chunk.length).fill(null).flatMap((_,i)=>[
                                <td key={`e1-${ci}-${i}`} style={{border:"1px solid #000",background:"#f8fafc"}}/>,
                                <td key={`e2-${ci}-${i}`} style={{border:"1px solid #000",background:"#f8fafc"}}/>
                              ])}
                              <td style={{padding:"7px 8px",textAlign:"center",fontFamily:"monospace",fontWeight:700,fontSize:14,color:"#000",verticalAlign:"middle",border:"1px solid #000"}}>{rowQty}</td>
                              {(()=>{
                                const prices=chunk.map(i=>Number(i.unitPrice)||0).filter(p=>p>0);
                                const uniq=[...new Set(prices)];
                                const unitTxt=uniq.length===1?uniq[0].toLocaleString("th-TH",{minimumFractionDigits:2}):(rowQty>0?`${(rowSub/rowQty).toFixed(2)}*`:"-");
                                return (<>
                                  <td style={{padding:"5px 7px",textAlign:"right",fontFamily:"monospace",fontSize:11,color:"#000",verticalAlign:"middle",border:"1px solid #000"}}>{unitTxt}</td>
                                  <td style={{padding:"5px 8px",textAlign:"right",fontFamily:"monospace",fontWeight:700,fontSize:12,color:"#000",verticalAlign:"middle",border:"1px solid #000"}}>{rowSub.toLocaleString("th-TH",{minimumFractionDigits:2})}</td>
                                </>);
                              })()}
                            </tr>
                          );
                        });
                      })}
                      {/* รายการกรอกเอง (ไม่มี clothing) — span คอลัมน์รุ่น+สี+ไซส์ */}
                      {generic.map((it,i)=>(
                        <tr key={`g${i}`} style={{background:(groups.length+i)%2===0?"white":"#f8fafc"}}>
                          <td colSpan={10} style={{padding:"6px 8px",fontWeight:500,color:"#000",border:"1px solid #000",fontSize:12}}>
                            <div style={{display:"flex",alignItems:"center",gap:6}}>
                              {it.colorHex&&<div style={{width:11,height:11,borderRadius:2,background:it.colorHex,border:"1px solid #000",flexShrink:0}}/>}
                              <span>{it.description}</span>
                              {it.colorName&&<span style={{color:"#000",fontSize:11}}>· {it.colorName}</span>}
                              {it.unit&&<span style={{color:"#000",fontSize:11}}>· {it.unit}</span>}
                            </div>
                          </td>
                          <td style={{padding:"7px 8px",textAlign:"center",fontFamily:"monospace",fontWeight:700,fontSize:14,color:"#000",border:"1px solid #000"}}>{it.qty}</td>
                          <td style={{padding:"5px 7px",textAlign:"right",fontFamily:"monospace",fontSize:11,color:"#000",border:"1px solid #000"}}>{(Number(it.unitPrice)||0).toLocaleString("th-TH",{minimumFractionDigits:2})}</td>
                          <td style={{padding:"5px 8px",textAlign:"right",fontFamily:"monospace",fontWeight:700,fontSize:12,color:"#000",border:"1px solid #000"}}>{(it.qty*it.unitPrice).toLocaleString("th-TH",{minimumFractionDigits:2})}</td>
                        </tr>
                      ))}
                      {/* padding rows */}
                      {(showPrintInvoice.items||[]).length<4&&Array.from({length:Math.max(0,4-(showPrintInvoice.items||[]).length)}).map((_,i)=>(
                        <tr key={`pad-${i}`}>
                          <td colSpan={13} style={{padding:"7px 10px",border:"1px solid #cbd5e1"}}>&nbsp;</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      {(showPrintInvoice.itemDiscountTotal>0||showPrintInvoice.billDiscount>0)&&(
                        <tr style={{background:"#fffbeb"}}>
                          <td colSpan={12} style={{padding:"6px 10px",textAlign:"right",fontSize:12,color:"#000",border:"1px solid #000"}}>ราคารวมก่อนส่วนลด</td>
                          <td style={{padding:"6px 10px",textAlign:"right",fontFamily:"monospace",color:"#000",border:"1px solid #000",fontSize:12}}>{(showPrintInvoice.grossSubtotal||0).toLocaleString("th-TH",{minimumFractionDigits:2})}</td>
                        </tr>
                      )}
                      {showPrintInvoice.itemDiscountTotal>0&&(
                        <tr style={{background:"#fffbeb"}}>
                          <td colSpan={12} style={{padding:"6px 10px",textAlign:"right",fontSize:12,color:"#000",border:"1px solid #000"}}>ส่วนลดรายการ</td>
                          <td style={{padding:"6px 10px",textAlign:"right",fontFamily:"monospace",fontWeight:600,color:"#000",border:"1px solid #000",fontSize:12}}>-{(showPrintInvoice.itemDiscountTotal||0).toLocaleString("th-TH",{minimumFractionDigits:2})}</td>
                        </tr>
                      )}
                      {showPrintInvoice.billDiscount>0&&(
                        <tr style={{background:"#fffbeb"}}>
                          <td colSpan={12} style={{padding:"6px 10px",textAlign:"right",fontSize:12,color:"#000",border:"1px solid #000"}}>ส่วนลดท้ายบิล{showPrintInvoice.discountType==="percent"?` (${showPrintInvoice.discount}%)`:""}</td>
                          <td style={{padding:"6px 10px",textAlign:"right",fontFamily:"monospace",fontWeight:600,color:"#000",border:"1px solid #000",fontSize:12}}>-{(showPrintInvoice.billDiscount||0).toLocaleString("th-TH",{minimumFractionDigits:2})}</td>
                        </tr>
                      )}
                      <tr style={{background:"#f1f5f9"}}>
                        <td colSpan={12} style={{padding:"7px 10px",textAlign:"right",fontWeight:600,fontSize:12,color:"#000",border:"1px solid #000"}}>ยอดรวมก่อนภาษี</td>
                        <td style={{padding:"7px 10px",textAlign:"right",fontFamily:"monospace",fontWeight:700,color:"#000",fontSize:13,border:"1px solid #000"}}>{(showPrintInvoice.subtotal||0).toLocaleString("th-TH",{minimumFractionDigits:2})}</td>
                      </tr>
                      {showPrintInvoice.useVat&&(
                        <tr style={{background:"#f1f5f9"}}>
                          <td colSpan={12} style={{padding:"6px 10px",textAlign:"right",fontSize:12,color:"#000",border:"1px solid #000"}}>ภาษีมูลค่าเพิ่ม (VAT {showPrintInvoice.vatRate}%)</td>
                          <td style={{padding:"6px 10px",textAlign:"right",fontFamily:"monospace",fontWeight:600,color:"#000",border:"1px solid #000",fontSize:12}}>{(showPrintInvoice.vat||0).toLocaleString("th-TH",{minimumFractionDigits:2})}</td>
                        </tr>
                      )}
                      {(showPrintInvoice.shipping>0||showPrintInvoice.useShipping)&&(
                        <tr style={{background:"#f1f5f9"}}>
                          <td colSpan={12} style={{padding:"6px 10px",textAlign:"right",fontSize:12,color:"#000",border:"1px solid #000"}}>ค่าจัดส่ง</td>
                          <td style={{padding:"6px 10px",textAlign:"right",fontFamily:"monospace",fontWeight:600,color:"#000",border:"1px solid #000",fontSize:12}}>{(showPrintInvoice.shipping||0).toLocaleString("th-TH",{minimumFractionDigits:2})}</td>
                        </tr>
                      )}
                      {/* ── ยอดรวมทั้งสิ้น (สีดำ + กรอบหนา) ── */}
                      <tr style={{background:"#fff"}}>
                        <td colSpan={12} style={{padding:"9px 12px",textAlign:"right",fontWeight:800,fontSize:15,color:"#000",border:"2px solid #000"}}>ยอดรวมทั้งสิ้น</td>
                        <td style={{padding:"9px 12px",textAlign:"right",fontFamily:"monospace",fontWeight:800,fontSize:17,color:"#000",border:"2px solid #000"}}>{(showPrintInvoice.total||0).toLocaleString("th-TH",{minimumFractionDigits:2})}</td>
                      </tr>
                    </tfoot>
                  </table>
                );
              })()}

              {/* ── บัญชีรับเงิน — compact ── */}
              {showPrintInvoice.bankAccount&&(
                <div style={{padding:"10px 14px",background:"#eff6ff",border:"1px solid #bfdbfe",borderRadius:8,marginBottom:10,display:"flex",alignItems:"center",gap:12,lineHeight:1.4}}>
                  <div style={{fontSize:20}}>🏦</div>
                  <div style={{flex:1}}>
                    <div style={{fontSize:12,color:"#475569",fontWeight:600,marginBottom:3}}>
                      โอนชำระเข้าบัญชี{showPrintInvoice.bankAccount.label?` (${showPrintInvoice.bankAccount.label})`:""} · <span style={{color:"#1e293b"}}>{showPrintInvoice.bankAccount.bankName||"-"} · {showPrintInvoice.bankAccount.accountName||"-"}</span>
                    </div>
                    <div style={{fontFamily:"monospace",color:"#1e293b",fontWeight:800,fontSize:18,letterSpacing:1.5}}>
                      {showPrintInvoice.bankAccount.accountNo||"-"}
                    </div>
                  </div>
                </div>
              )}

              {/* ── หมายเหตุ ── */}
              {showPrintInvoice.note&&(
                <div style={{padding:"10px 14px",background:"#fffbeb",border:"1px solid #fde68a",borderRadius:8,fontSize:11,color:"#78350f",marginBottom:16}}>
                  <span style={{fontWeight:700}}>หมายเหตุ:</span> {showPrintInvoice.note}
                </div>
              )}

              {/* ── เส้นแบ่ง + ช่องลายเซ็น — สีดำ ── */}
              <div style={{marginTop:22,paddingTop:10,borderTop:"1px solid #000"}}>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:16}}>
                  {[
                    {label:"ผู้รับเงิน / ผู้ออกเอกสาร"},
                    {label:"ผู้ตรวจสอบ"},
                    {label:"ผู้ชำระเงิน / ผู้รับสินค้า"},
                  ].map((sig,i)=>(
                    <div key={i} style={{textAlign:"center"}}>
                      <div style={{height:42,borderBottom:"1px solid #000",marginBottom:4}}/>
                      <div style={{fontSize:10,fontWeight:700,color:"#000",marginBottom:3}}>{sig.label}</div>
                      <div style={{fontSize:9,color:"#000",fontFamily:"monospace"}}>วันที่ ....../......./.........</div>
                    </div>
                  ))}
                </div>
              </div>

            </div>

            {/* ── ปุ่มด้านล่าง (ไม่พิมพ์) ── */}
            <div className="print-hide" style={{padding:"14px 24px",borderTop:"1px solid #e2e8f0",display:"flex",gap:10,justifyContent:"space-between",alignItems:"center",background:"#f8fafc",borderRadius:"0 0 16px 16px"}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <span style={{fontSize:12,color:"#64748b",fontWeight:500}}>ขนาดกระดาษ:</span>
                <div style={{display:"flex",gap:6}}>
                  {[
                    {id:"A5",label:"A5",size:"A5 portrait",margin:"8mm"},
                    {id:"A4",label:"A4",size:"A4 portrait",margin:"10mm"},
                    {id:"80mm",label:"80mm (สลิป)",size:"80mm auto",margin:"2mm 4mm"},
                    {id:"57mm",label:"57mm (ม้วน)",size:"57mm auto",margin:"1mm 3mm"},
                  ].map(p=>(
                    <button key={p.id}
                      onClick={()=>printElementById("invoice-print-area",p.size,p.margin,INVOICE_FONT_SCALE)}
                      style={{padding:"6px 12px",borderRadius:7,border:"1px solid #e2e8f0",background:"white",color:"#475569",fontSize:11,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontWeight:500}}>
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{display:"flex",gap:10}}>
                <button onClick={()=>setShowPrintInvoice(null)} style={{padding:"9px 16px",borderRadius:9,border:"1px solid #e2e8f0",background:"white",color:"#64748b",fontSize:13,cursor:"pointer",fontFamily:"'Sarabun',sans-serif"}}>ปิด</button>
                <button onClick={()=>downloadInvoicePdf(showPrintInvoice,false)} style={{padding:"9px 16px",borderRadius:9,border:"1px solid rgba(220,38,38,0.35)",background:"white",color:"#dc2626",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"'Sarabun',sans-serif"}}>📄 PDF</button>
                <button onClick={()=>downloadInvoicePdf(showPrintInvoice,true)} style={{padding:"9px 16px",borderRadius:9,border:"1px solid rgba(220,38,38,0.35)",background:"white",color:"#dc2626",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"'Sarabun',sans-serif"}}>📄 PDF × 3 ชุด</button>
                <button onClick={()=>printElementById("invoice-print-area","A5 portrait","8mm",INVOICE_FONT_SCALE)} style={{padding:"9px 16px",borderRadius:9,border:"1px solid rgba(59,91,139,0.35)",background:"white",color:"#3b5b8b",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"'Sarabun',sans-serif"}}>🖨️ พิมพ์ (A5)</button>
                <button onClick={()=>printInvoiceCopies("invoice-print-area")} style={{padding:"9px 16px",borderRadius:9,border:"none",background:"linear-gradient(135deg,#3b5b8b,#3b5b8b)",color:"white",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",boxShadow:"0 4px 14px rgba(59,91,139,0.3)"}}>🖨️ พิมพ์ × 3 ชุด (A5)</button>
              </div>
            </div>
          </div>
        </div>
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

      {/* ── MODAL: ขายวันนี้ (สรุปจ่ายออก แยกรุ่น/สี/ไซส์) ── */}
      {showSalesToday&&(()=>{
        const [yy,mm,dd] = salesDate.split("-");
        const prefix = `${dd}/${mm}/${yy}`; // ตรงกับรูปแบบ transaction.date
        const todays = transactions.filter(t => t.type==="จ่าย" && t.category==="เสื้อผ้า" && (t.date||"").startsWith(prefix));
        const byModel = {};
        todays.forEach(t => {
          const parts = (t.name||"").split(" / ");
          const model = (parts[0]||t.name||"-").trim();
          const color = (parts[1]||"-").trim();
          const size = (parts[2]||"-").trim();
          if (!byModel[model]) byModel[model] = { total:0, rows:{} };
          byModel[model].total += Number(t.qty)||0;
          const k = `${color}|||${size}`;
          byModel[model].rows[k] = (byModel[model].rows[k]||0) + (Number(t.qty)||0);
        });
        const models = Object.keys(byModel).sort((a,b)=>byModel[b].total-byModel[a].total);
        const grandTotal = todays.reduce((s,t)=>s+(Number(t.qty)||0),0);
        const isToday = salesDate === new Date().toISOString().slice(0,10);
        return (
        <Modal onClose={()=>setShowSalesToday(false)} w={640}>
          <MHead title={`📊 ขาย${isToday?"วันนี้":"ตามวันที่"}`} onClose={()=>setShowSalesToday(false)} color={T.green}/>
          <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:14,flexWrap:"wrap"}}>
            <input type="date" value={salesDate} onChange={e=>setSalesDate(e.target.value)}
              style={{background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:9,padding:"8px 12px",fontFamily:"'Sarabun',sans-serif",fontSize:13,outline:"none"}}/>
            <button onClick={()=>setSalesDate(new Date().toISOString().slice(0,10))} style={{padding:"7px 12px",borderRadius:8,border:`1px solid ${T.border}`,background:"transparent",color:T.sub,cursor:"pointer",fontSize:12,fontFamily:"'Sarabun',sans-serif"}}>วันนี้</button>
            {models.length>1&&(()=>{const allCollapsed=models.every(mm=>collapsedSalesModels[mm]);return(
              <button onClick={()=>setCollapsedSalesModels(allCollapsed?{}:Object.fromEntries(models.map(mm=>[mm,true])))} style={{padding:"7px 12px",borderRadius:8,border:`1px solid ${T.border}`,background:"transparent",color:T.sub,cursor:"pointer",fontSize:12,fontFamily:"'Sarabun',sans-serif"}}>{allCollapsed?"⊞ กางทั้งหมด":"⊟ ย่อทั้งหมด"}</button>
            );})()}
            <div style={{marginLeft:"auto",fontSize:14,fontWeight:800,color:T.green}}>รวมทั้งหมด {grandTotal.toLocaleString("th-TH")} ตัว</div>
          </div>

          {models.length===0 ? (
            <div style={{textAlign:"center",padding:40,color:T.muted,fontSize:13}}>
              <div style={{fontSize:40,marginBottom:8,opacity:0.3}}>📭</div>
              ยังไม่มีการจ่ายออกในวันนี้
            </div>
          ) : (
            <div style={{display:"flex",flexDirection:"column",gap:12,maxHeight:"60vh",overflowY:"auto"}}>
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
                      style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,padding:"10px 14px",background:"rgba(58,122,82,0.08)",cursor:"pointer",userSelect:"none"}}>
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
                              <button key={i} onClick={()=>setSalesCell({model,color,size:s.size,prefix})} title="คลิกเพื่อดู/ลบรายการที่กรอกผิด"
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
        const { model, color, size, prefix } = salesCell;
        const targetName = `${model} / ${color} / ${size}`;
        const cellTx = transactions
          .filter(t => t.type==="จ่าย" && t.category==="เสื้อผ้า" && (t.date||"").startsWith(prefix) && (t.name||"")===targetName)
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
            <div style={{display:"flex",flexDirection:"column",gap:8,maxHeight:"50vh",overflowY:"auto"}}>
              {cellTx.map(t=>(
                <div key={t.id} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",border:`1px solid ${T.border}`,borderRadius:10}}>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:14,fontWeight:800,color:T.text,fontFamily:"monospace"}}>×{t.qty} ตัว</div>
                    <div style={{fontSize:11,color:T.muted}}>{t.date}{t.by?` · ${t.by}`:""}{t.note?` · ${t.note}`:""}</div>
                  </div>
                  {role.canAdd&&(
                    <button onClick={async()=>{await handleDeleteSaleTx(t); if(cellTx.length<=1)setSalesCell(null);}} disabled={txSaving} title="ลบรายการนี้ + คืนสต็อก"
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
          <MHead title="🧺 ขายคละสีคละไซส์" onClose={()=>setMixModal(null)} color={T.amber}/>
          {txSuccess&&<Toast msg="ตัดสต็อกคละสำเร็จ!"/>}
          <div style={{padding:12,background:"rgba(184,134,0,0.06)",border:`1px solid rgba(184,134,0,0.2)`,borderRadius:10,marginBottom:14}}>
            <div style={{fontSize:13,fontWeight:700,color:T.text}}>{item.model}</div>
            <div style={{fontSize:11,color:T.sub,marginTop:2}}>เลือกสี + ไซส์ + จำนวน แต่ละแถว · ตัดสต็อกตามจริง (บิลออกแยก)</div>
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

          <div style={{display:"flex",gap:10}}>
            <BtnGhost onClick={()=>setMixModal(null)} disabled={txSaving} style={{flex:1}}>ยกเลิก</BtnGhost>
            <BtnDanger onClick={handleMixDispatch} disabled={txSaving||totalQty<=0} style={{flex:1}}>{txSaving?"⏳ กำลังบันทึก...":`✅ ตัดสต็อก (${totalQty})`}</BtnDanger>
          </div>
        </Modal>
        );
      })()}

      {/* ── MODAL: ตั้งราคาตามไซส์ ── */}
      {priceModal&&(()=>{
        const item = clothingItems.find(i=>i.id===priceModal.itemId);
        const col = item?.colors?.[priceModal.ci];
        if(!item||!col) return null;
        const handleSavePrices = async () => {
          const salePrices = {};
          SIZE_GROUPS.forEach(g => { salePrices[g.key] = Number(priceForm[g.key]) || 0; });
          const defaultPrice = salePrices.reg || salePrices.kids || Object.values(salePrices).find(v=>v>0) || 0;
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
          await updateDoc(doc(db,"clothing",priceModal.itemId),{colors:newColors});
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
            <div style={{fontSize:11,color:T.muted,marginBottom:8,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em"}}>ราคาขาย (฿/ชิ้น) ตามกลุ่มไซส์</div>
            <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:18}}>
              {SIZE_GROUPS.map(g=>(
                <div key={g.key} style={{display:"grid",gridTemplateColumns:"120px 1fr",alignItems:"center",gap:10,padding:"6px 10px",background:"rgba(241,243,246,0.5)",borderRadius:7,border:`1px solid ${T.border}`}}>
                  <span style={{fontSize:12,color:T.accent,fontWeight:600}}>{g.label}</span>
                  <input type="number" value={priceForm[g.key]} onFocus={e=>e.target.select()} onChange={e=>setPriceForm(f=>({...f,[g.key]:e.target.value}))} placeholder="0"
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

          {/* Custom color → เพิ่มเข้า buffer */}
          <div style={{padding:12,background:"rgba(4,18,44,0.6)",borderRadius:10,border:`1px solid ${T.border}`,marginBottom:14}}>
            <div style={{fontSize:11,color:T.muted,marginBottom:8,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em"}}>หรือเพิ่มสีเอง</div>
            <div style={{display:"flex",gap:10,alignItems:"center"}}>
              <input type="color" value={newColorHex} onChange={e=>setNewColorHex(e.target.value)} style={{width:40,height:36,borderRadius:8,border:`1px solid ${T.border}`,cursor:"pointer",background:"transparent",padding:2}}/>
              <input value={customColorName} onChange={e=>setCustomColorName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addPickedFromCustom()} placeholder="ชื่อสี เช่น เทา, กรมท่า..."
                style={{flex:1,background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:9,padding:"9px 14px",fontFamily:"'Sarabun',sans-serif",fontSize:13,outline:"none"}}/>
              <BtnPrimary onClick={addPickedFromCustom} disabled={!customColorName.trim()}>+ เพิ่มในรายการ</BtnPrimary>
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
        <Modal onClose={()=>setClothingTxModal(null)} w={540}>
          <MHead title={clothingTxType==="รับ"?"⬇️ รับเสื้อผ้าเข้าคลัง":"⬆️ จ่ายเสื้อผ้าออกคลัง"} onClose={()=>setClothingTxModal(null)} color={clothingTxType==="รับ"?T.green:T.red}/>
          {clothingTxSuccess&&<Toast msg="บันทึกสำเร็จ! ตัดสต็อกแล้ว"/>}
          <div style={{padding:14,background:"rgba(59,91,139,0.06)",border:`1px solid rgba(59,91,139,0.2)`,borderRadius:10,marginBottom:16}}>
            <div style={{fontSize:12,color:T.accent,fontWeight:600}}>{clothingTxModal.item.model}</div>
            <div style={{fontSize:11,color:T.sub,marginTop:2,display:"flex",alignItems:"center",gap:8}}>
              <div style={{width:10,height:10,borderRadius:2,background:(clothingTxModal.item.colors[clothingTxModal.colorIdx]||{}).hex}}/>
              {(clothingTxModal.item.colors[clothingTxModal.colorIdx]||{}).colorName}
            </div>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            <div>
              <label style={{fontSize:11,color:T.muted,display:"block",marginBottom:6,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em"}}>เลือกไซส์ * <span style={{textTransform:"none",fontWeight:400,color:T.muted}}>(กดเพื่อเลือก/ยกเลิก — เลือกได้หลายไซส์)</span></label>
              <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                {sizesFor(clothingTxModal.item).map(sz=>{
                  const stock=((clothingTxModal.item.colors[clothingTxModal.colorIdx]||{}).stock||{})[sz]||0;
                  const selected=clothingTxSizeQty[sz]!==undefined;
                  return (
                    <button key={sz} onClick={()=>setClothingTxSizeQty(p=>{const n={...p}; if(selected){delete n[sz];}else{n[sz]="";} return n;})}
                      style={{padding:"6px 12px",borderRadius:8,border:`1px solid ${selected?"#3b5b8b":"rgba(203,210,217,0.8)"}`,background:selected?"rgba(59,91,139,0.2)":"rgba(4,18,44,0.6)",color:selected?"#3b5b8b":T.sub,cursor:"pointer",fontSize:12,fontFamily:"'Sarabun',sans-serif",fontWeight:selected?700:400,transition:"all 0.15s"}}>
                      <div style={{fontWeight:700}}>{sz}</div>
                      <div style={{fontSize:9,color:stock===0?"#9aa5b1":stock<5?"#fbbf24":"#22d3ee",fontFamily:"monospace"}}>{stock}</div>
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
                const disabled = txSaving || totalQty <= 0;
                return clothingTxType==="รับ"
                  ?<BtnSuccess onClick={handleClothingTx} disabled={disabled} style={{flex:1}}>{txSaving?"⏳ กำลังบันทึก...":`✅ ยืนยันรับสินค้า${totalQty>0?` (${totalQty})`:""}`}</BtnSuccess>
                  :<BtnDanger onClick={handleClothingTx} disabled={disabled} style={{flex:1}}>{txSaving?"⏳ กำลังบันทึก...":`✅ ยืนยันจ่ายสินค้า${totalQty>0?` (${totalQty})`:""}`}</BtnDanger>;
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
            <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:14,maxHeight:"50vh",overflowY:"auto"}}>
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

    </div>
  );
}


