import { useState, useRef, useEffect } from "react";
import { db } from "./firebase";
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, setDoc, getDocs, writeBatch, serverTimestamp, query, orderBy } from "firebase/firestore";
import { T, SIZES, PRESET_COLORS, MASTER_KEY, SIZE_GROUPS, getPriceForSize } from "./theme";
import { INIT_USERS, ROLES, INIT_CATS } from "./constants";
import { BarcodeDisplay, Modal, MHead, Toast, Input, BtnPrimary, BtnSuccess, BtnDanger, BtnGhost, Badge, CardBox } from "./components/ui";
import LoginPage, { CompanyEditor } from "./components/LoginPage";
import { useFirestore } from "./hooks/useFirestore";
import ReportsTab from "./tabs/ReportsTab";
import SuppliersTab from "./tabs/SuppliersTab";
// ── MAIN APP ───────────────────────────────────────────────────
export default function App() {
  const { users, setUsers, products, setProducts, transactions, categories, setCategories, clothingItems, orders, customers, invoices, companyInfo, setCompanyInfo, loading, setLoading, suppliers } = useFirestore();
  const [user, setUser] = useState(null);
  const [activeTab, setActiveTab] = useState("dashboard");
  const [selectedCat, setSelectedCat] = useState("ทั้งหมด");
  const [search, setSearch] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);




  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [showDeleteUserConfirm, setShowDeleteUserConfirm] = useState(null);
  const [newUser, setNewUser] = useState({ name:"", username:"", password:"", confirmPassword:"" });
  const [addUserErr, setAddUserErr] = useState("");
  const [addUserSuccess, setAddUserSuccess] = useState(false);

  // modals
  // ── Clothing state ───────────────────────────────────────────

  // ── Orders & Customers state ──────────────────────────────────


  const [showNewOrder, setShowNewOrder] = useState(false);
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [showPrintOrder, setShowPrintOrder] = useState(null);
  const [orderForm, setOrderForm] = useState({
    customerId: "", customerName: "", customerPhone: "", customerAddress: "",
    note: "", items: []
  });
  const [newCustomerForm, setNewCustomerForm] = useState({ name:"", phone:"", address:"" });
  const [customerSearch, setCustomerSearch] = useState("");
  const [orderItemForm, setOrderItemForm] = useState({ clothingId:"", colorIdx:"", size:"", qty:"" });


  const [showAddClothing, setShowAddClothing] = useState(false);
  const [showAddColor, setShowAddColor] = useState(null);
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
  const [showTxModal, setShowTxModal] = useState(false);
  const [showBarcodeModal, setShowBarcodeModal] = useState(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(null);
  const [showHistoryModal, setShowHistoryModal] = useState(null);
  const [showCatModal, setShowCatModal] = useState(false);
  const [showImgModal, setShowImgModal] = useState(null);
  const [showSettings, setShowSettings] = useState(false);

  // ── Invoice & Company state ───────────────────────────────────
  const [showNewInvoice, setShowNewInvoice] = useState(false);
  const [showPrintInvoice, setShowPrintInvoice] = useState(null);
  const [invoiceDocType, setInvoiceDocType] = useState("receipt"); // receipt | tax | quotation
  const [invoiceVat, setInvoiceVat] = useState(false);
  const [invoiceStatusFilter, setInvoiceStatusFilter] = useState("ทั้งหมด");
  const [invoiceForm, setInvoiceForm] = useState({
    customerId:"", customerName:"", customerPhone:"", customerAddress:"", customerTaxId:"",
    items:[], note:"", dueDate:"", vatRate:7
  });
  const [invoiceItemForm, setInvoiceItemForm] = useState({ description:"", qty:"", unitPrice:"", unit:"ชิ้น" });
  const [txType, setTxType] = useState("รับ");

  // forms
  const [newProduct, setNewProduct] = useState({ code:"",name:"",category:"",qty:"",unit:"",minQty:"",location:"",barcode:"",image:"",costPrice:"",salePrice:"" });
  const [txForm, setTxForm] = useState({ productId:"",qty:"",note:"" });
  const [newCatName, setNewCatName] = useState("");
  const [barcodeSearch, setBarcodeSearch] = useState("");
  const [inventoryTab, setInventoryTab] = useState("general"); // "general" | "clothing"
  const [clothingTxModal, setClothingTxModal] = useState(null); // {item, colorIdx, size}
  const [clothingTxType, setClothingTxType] = useState("รับ");
  const [clothingTxQty, setClothingTxQty] = useState("");
  const [clothingTxNote, setClothingTxNote] = useState("");
  const [clothingTxSuccess, setClothingTxSuccess] = useState(false);
  const [barcodeResult, setBarcodeResult] = useState(null);
  const [barcodeErr, setBarcodeErr] = useState("");

  // settings state
  const [settingsTab, setSettingsTab] = useState("profile");
  const [profileForm, setProfileForm] = useState({ name:"",username:"",oldPass:"",newPass:"",confirmPass:"" });
  const [profileMsg, setProfileMsg] = useState({ type:"",text:"" });

  // toasts
  const [addSuccess, setAddSuccess] = useState(false);
  const [txSuccess, setTxSuccess] = useState(false);

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

  const role = user ? ROLES[user.role] : null;

  const now = () => {
    const d = new Date();
    return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
  };


  const filtered = products.filter(p =>
    (selectedCat === "ทั้งหมด" || p.category === selectedCat) &&
    (p.name.includes(search) || p.code.includes(search) || (p.barcode || "").includes(search))
  );
  const lowStock = products.filter(p => Number(p.qty) < Number(p.minQty));
  const totalQty = products.reduce((s,p) => s + Number(p.qty), 0);
  const statusColor = p => Number(p.qty) < Number(p.minQty) ? T.red : Number(p.qty) < Number(p.minQty) * 1.5 ? T.amber : T.green;
  const statusLabel = p => Number(p.qty) < Number(p.minQty) ? "ต่ำกว่าขั้นต่ำ" : Number(p.qty) < Number(p.minQty) * 1.5 ? "ใกล้หมด" : "ปกติ";

  const handleImageUpload = e => {
    const file = e.target.files[0]; if (!file) return;
    const r = new FileReader(); r.onload = ev => setNewProduct(p => ({...p, image: ev.target.result})); r.readAsDataURL(file);
  };

  const handleAddProduct = async () => {
    if (!newProduct.code || !newProduct.name || newProduct.qty === "" || !newProduct.unit) return;
    const bc = newProduct.barcode || `CPU${Date.now().toString().slice(-8)}`;
    const cat = newProduct.category || categories[0] || "ทั่วไป";
    const data = {
      ...newProduct,
      qty: Number(newProduct.qty),
      minQty: newProduct.minQty === "" ? 0 : Number(newProduct.minQty),
      barcode: bc, category: cat, lastUpdate: now(),
      history: [{ action:"เพิ่มสินค้าใหม่", by: user.name, date: now(), note:`จำนวนเริ่มต้น: ${newProduct.qty} ${newProduct.unit}` }]
    };
    await addDoc(collection(db, "products"), data);
    setAddSuccess(true);
    setTimeout(() => { setAddSuccess(false); setShowAddModal(false); setNewProduct({code:"",name:"",category:"",qty:"",unit:"",minQty:"",location:"",barcode:"",image:""}); }, 1000);
  };

  const handleTx = async () => {
    if (!txForm.productId || txForm.qty === "" || Number(txForm.qty) <= 0) return;
    const pid = txForm.productId;
    const qty = Number(txForm.qty);
    const prod = products.find(p => p.id === pid);
    const histEntry = { action: txType==="รับ" ? "รับสินค้าเข้าคลัง" : "จ่ายสินค้าออกคลัง", by: user.name, date: now(), note:`${txType==="รับ"?"+":"-"}${qty} ${prod?.unit||""}${txForm.note ? ` (${txForm.note})` : ""}` };
    const newQty = txType==="รับ" ? Number(prod.qty)+qty : Math.max(0, Number(prod.qty)-qty);
    await updateDoc(doc(db, "products", pid), { qty: newQty, lastUpdate: now(), history: [histEntry, ...(prod.history||[])] });
    await addDoc(collection(db, "transactions"), { type:txType, code:prod?.code, name:prod?.name, qty, by:user.name, date:now(), note:txForm.note||"", createdAt: serverTimestamp() });
    setTxSuccess(true);
    setTimeout(() => { setTxSuccess(false); setShowTxModal(false); setTxForm({productId:"",qty:"",note:""}); }, 1000);
  };

  const handleDelete = async id => {
    await deleteDoc(doc(db, "products", id));
    setShowDeleteConfirm(null);
  };

  const handleClear = async () => {
    const batch = writeBatch(db);
    const pSnap = await getDocs(collection(db, "products"));
    const tSnap = await getDocs(collection(db, "transactions"));
    pSnap.docs.forEach(d => batch.delete(d.ref));
    tSnap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
    setShowClearConfirm(false);
  };

  const handleBarcodeSearch = () => {
    setBarcodeErr(""); setBarcodeResult(null);
    const found = products.find(p => p.barcode === barcodeSearch || p.code === barcodeSearch);
    if (found) setBarcodeResult(found); else setBarcodeErr("ไม่พบสินค้าในระบบ");
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
    setAddUserSuccess(true);
    setTimeout(() => { setAddUserSuccess(false); setShowAddUserModal(false); setNewUser({name:"",username:"",password:"",confirmPassword:""}); }, 1200);
  };

  const handleDeleteUser = async u => {
    await deleteDoc(doc(db, "users", String(u.id)));
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
    const dupUser = users.find(u => u.username === profileForm.username && u.id !== user.id);
    if (dupUser) { setProfileMsg({type:"err",text:"ชื่อผู้ใช้นี้มีในระบบแล้ว"}); return; }
    if (profileForm.newPass) {
      if (profileForm.oldPass !== user.password) { setProfileMsg({type:"err",text:"รหัสผ่านเดิมไม่ถูกต้อง"}); return; }
      if (profileForm.newPass.length < 4) { setProfileMsg({type:"err",text:"รหัสผ่านใหม่ต้องมีอย่างน้อย 4 ตัว"}); return; }
      if (profileForm.newPass !== profileForm.confirmPass) { setProfileMsg({type:"err",text:"รหัสผ่านใหม่ไม่ตรงกัน"}); return; }
    }
    const updated = { ...user, name: profileForm.name.trim(), username: profileForm.username.trim(), password: profileForm.newPass || user.password };
    await setDoc(doc(db, "users", String(user.id)), updated);
    setUser(updated);
    setProfileMsg({type:"ok",text:"บันทึกสำเร็จ!"});
    setProfileForm(f => ({...f, oldPass:"", newPass:"", confirmPass:""}));
  };


  // ── Clothing handlers ─────────────────────────────────────────
  const handleAddClothingItem = async () => {
    if (!newModel.trim()) return;
    await addDoc(collection(db, "clothing"), { model: newModel.trim(), image: "", colors: [], createdAt: serverTimestamp() });
    setNewModel(""); setShowAddClothing(false);
  };

  const handleAddColorToItem = async (itemId, colorObj) => {
    const item = clothingItems.find(i => i.id === itemId);
    if (!item) return;
    const initStock = {}; SIZES.forEach(s => initStock[s] = 0);
    const newColors = [...(item.colors||[]), { ...colorObj, stock: initStock, costPrice: colorObj.costPrice||0, salePrice: colorObj.salePrice||0 }];
    await updateDoc(doc(db, "clothing", itemId), { colors: newColors });
    setShowAddColor(null); setCustomColorName(""); setNewColorHex("#ffffff");
    setNewColorCost(""); setNewColorSale("");
  };

  const handleUpdateClothingStock = async (itemId, colorIdx, size, val) => {
    const item = clothingItems.find(i => i.id === itemId);
    if (!item) return;
    const newColors = item.colors.map((c,i) => i===colorIdx ? {...c, stock:{...c.stock,[size]:Math.max(0,Number(val)||0)}} : c);
    await updateDoc(doc(db, "clothing", itemId), { colors: newColors });
    setEditingStock(null);
  };

  const handleDeleteClothingItem = async (itemId) => {
    await deleteDoc(doc(db, "clothing", itemId));
  };

  const handleDeleteClothingColor = async (itemId, colorIdx) => {
    const item = clothingItems.find(i => i.id === itemId);
    if (!item) return;
    const newColors = item.colors.filter((_,i) => i !== colorIdx);
    await updateDoc(doc(db, "clothing", itemId), { colors: newColors });
  };


  // ── Order handlers ────────────────────────────────────────────
  const handleAddCustomer = async () => {
    if (!newCustomerForm.name.trim()) return;
    await addDoc(collection(db, "customers"), { ...newCustomerForm, createdAt: serverTimestamp() });
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
    // Cut stock for each item
    for (const oi of orderForm.items) {
      const item = clothingItems.find(i => i.id === oi.clothingId);
      if (!item) continue;
      const newColors = item.colors.map((c, i) =>
        i === oi.colorIdx ? { ...c, stock: { ...c.stock, [oi.size]: Math.max(0, ((c.stock||{})[oi.size]||0) - oi.qty) } } : c
      );
      await updateDoc(doc(db, "clothing", oi.clothingId), { colors: newColors });
      await addDoc(collection(db, "transactions"), {
        type: "จ่าย", code: oi.clothingId,
        name: `${oi.clothingName} / ${oi.colorName} / ${oi.size}`,
        qty: oi.qty, by: user.name, date: now(),
        note: `ใบสั่งของ: ${orderForm.customerName}`,
        createdAt: serverTimestamp(), category: "เสื้อผ้า"
      });
    }
    const orderNo = `ORD${Date.now().toString().slice(-6)}`;
    await addDoc(collection(db, "orders"), {
      orderNo, ...orderForm, status: "สำเร็จ",
      by: user.name, date: now(), createdAt: serverTimestamp()
    });
    setOrderForm({ customerId:"", customerName:"", customerPhone:"", customerAddress:"", note:"", items:[] });
    setShowNewOrder(false);
  };

  const handleClothingTx = async () => {
    if (!clothingTxModal || !clothingTxQty || Number(clothingTxQty) <= 0) return;
    const { item, colorIdx, size } = clothingTxModal;
    const col = item.colors[colorIdx];
    const curQty = (col.stock || {})[size] || 0;
    const newQty = clothingTxType === "รับ"
      ? curQty + Number(clothingTxQty)
      : Math.max(0, curQty - Number(clothingTxQty));
    const newColors = item.colors.map((c, i) =>
      i === colorIdx ? { ...c, stock: { ...c.stock, [size]: newQty } } : c
    );
    await updateDoc(doc(db, "clothing", item.id), { colors: newColors });
    // Log transaction
    await addDoc(collection(db, "transactions"), {
      type: clothingTxType, code: item.id,
      name: `${item.model} / ${col.colorName} / ${size}`,
      qty: Number(clothingTxQty), by: user.name,
      date: now(), note: clothingTxNote || "", createdAt: serverTimestamp(),
      category: "เสื้อผ้า"
    });
    setClothingTxSuccess(true);
    setTimeout(() => {
      setClothingTxSuccess(false); setClothingTxModal(null);
      setClothingTxQty(""); setClothingTxNote("");
    }, 1000);
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
    setInvoiceForm(f=>({...f,items:[...f.items,{...invoiceItemForm,qty:Number(invoiceItemForm.qty),unitPrice:Number(invoiceItemForm.unitPrice)}]}));
    setInvoiceItemForm({description:"",qty:"",unitPrice:"",unit:"ชิ้น"});
  };

  const handleImportFromOrder = (order) => {
    const items = (order.items||[]).map(i=>{
      // Try to get sale price from clothing item
      const clothingItem = clothingItems.find(c=>c.id===i.clothingId);
      const colorData = clothingItem?.colors?.[i.colorIdx];
      const salePrice = getPriceForSize(colorData, i.size);
      return {
        description:`${i.clothingName} (${i.colorName}) ไซส์ ${i.size}`,
        qty:i.qty, unitPrice:salePrice, unit:"ชิ้น"
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

  const calcInvoice = (items, vatRate, useVat) => {
    const subtotal = items.reduce((s,i)=>s+(i.qty*i.unitPrice),0);
    const vat = useVat ? subtotal*(vatRate/100) : 0;
    return { subtotal, vat, total: subtotal+vat };
  };

  const docTypeLabel = (type) => ({
    receipt:"ใบเสร็จรับเงิน", tax:"ใบกำกับภาษี", quotation:"ใบวางบิล/ใบแจ้งหนี้"
  }[type]||"ใบเสร็จรับเงิน");

  const handleConfirmInvoice = async () => {
    if(!invoiceForm.customerName||invoiceForm.items.length===0) return;
    const calc = calcInvoice(invoiceForm.items, invoiceForm.vatRate, invoiceVat);
    const invNo = `INV${Date.now().toString().slice(-6)}`;
    const data = {
      ...invoiceForm, ...calc,
      invoiceNo:invNo, docType:invoiceDocType, useVat:invoiceVat,
      by:user.name, date:now(), createdAt:serverTimestamp(), status:"ออกแล้ว"
    };
    const ref = await addDoc(collection(db,"invoices"), data);
    setShowPrintInvoice({...data, id:ref.id});
    setShowNewInvoice(false);
    setInvoiceForm({customerId:"",customerName:"",customerPhone:"",customerAddress:"",customerTaxId:"",items:[],note:"",dueDate:"",vatRate:7});
  };

  const PAYMENT_STATUSES = ["ออกแล้ว","รอชำระ","ชำระแล้ว","ยกเลิก"];
  const paymentStatusStyle = (s) => ({
    "ออกแล้ว":  {bg:"rgba(14,165,233,0.1)",  color:T.accent,  border:"1px solid rgba(56,189,248,0.2)"},
    "รอชำระ":   {bg:"rgba(245,158,11,0.1)", color:T.amber,   border:"1px solid rgba(245,158,11,0.25)"},
    "ชำระแล้ว": {bg:"rgba(16,185,129,0.1)", color:T.green,   border:"1px solid rgba(16,185,129,0.25)"},
    "ยกเลิก":   {bg:"rgba(239,68,68,0.1)",  color:T.red,     border:"1px solid rgba(239,68,68,0.25)"},
  }[s] || {bg:"rgba(14,165,233,0.1)",color:T.accent,border:"1px solid rgba(56,189,248,0.2)"});

  const handleUpdateInvoiceStatus = async (invId, newStatus) => {
    await updateDoc(doc(db,"invoices",invId), { status: newStatus });
  };

  // ปริ้นผ่าน iframe — เนื้อหาใหญ่เต็ม A4 และไหลข้ามหน้าได้
  const printElementById = (id, pageSize = "A4 portrait", pageMargin = "10mm") => {
    const el = document.getElementById(id);
    if (!el) return;
    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    document.body.appendChild(iframe);
    const doc = iframe.contentWindow.document;
    doc.open();
    doc.write(`<!doctype html><html><head><meta charset="utf-8"/>
      <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;500;600;700;800&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">
      <style>
        @page { size: ${pageSize}; margin: ${pageMargin}; }
        html, body { margin: 0; padding: 0; background: white; color: #1e293b; font-family: 'Sarabun', sans-serif; }
        body { padding: 0; }
        table { border-collapse: collapse; width: 100%; }
        tr, td, th { page-break-inside: avoid; }
        thead { display: table-header-group; }
        tfoot { display: table-footer-group; }
        img { max-width: 100%; }
      </style></head><body>${el.outerHTML}</body></html>`);
    doc.close();
    const trigger = () => {
      try { iframe.contentWindow.focus(); iframe.contentWindow.print(); } catch(e){}
      setTimeout(() => iframe.remove(), 1000);
    };
    if (doc.fonts && doc.fonts.ready) {
      doc.fonts.ready.then(() => setTimeout(trigger, 200));
    } else {
      setTimeout(trigger, 500);
    }
  };

  const handleResetPassword = async (username, newPassword) => {
    const u = users.find(u => u.username === username);
    if (!u) return;
    await setDoc(doc(db, "users", String(u.id)), { ...u, password: newPassword });
  };

  if (loading) return (
    <div style={{minHeight:"100vh",background:"#020c1b",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",fontFamily:"'Sarabun',sans-serif"}}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@700&display=swap');@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <div style={{width:64,height:64,background:"linear-gradient(135deg,#0ea5e9,#0369a1)",borderRadius:16,display:"flex",alignItems:"center",justifyContent:"center",fontSize:30,marginBottom:20,boxShadow:"0 8px 32px rgba(14,165,233,0.4)"}}>⚙️</div>
      <div style={{fontSize:20,fontWeight:800,color:"#e0f2fe",fontFamily:"'Space Mono',monospace",letterSpacing:4,marginBottom:8}}>CPU</div>
      <div style={{width:32,height:32,border:"3px solid rgba(56,189,248,0.2)",borderTop:"3px solid #38bdf8",borderRadius:"50%",animation:"spin 0.8s linear infinite",marginTop:16}}/>
      <div style={{fontSize:12,color:"#4a7fa5",marginTop:12}}>กำลังเชื่อมต่อฐานข้อมูล...</div>
      <button onClick={()=>setLoading(false)} style={{marginTop:24,padding:"8px 20px",borderRadius:9,border:"1px solid rgba(56,189,248,0.3)",background:"rgba(14,165,233,0.1)",color:"#38bdf8",fontSize:12,cursor:"pointer",fontFamily:"'Sarabun',sans-serif"}}>
        เข้าใช้งานเลย (ข้ามการโหลด)
      </button>
      <div style={{fontSize:11,color:"#1e4060",marginTop:8}}>ถ้าโหลดนานเกินไป กรุณาตรวจสอบ Firebase Rules</div>
    </div>
  );

    const handleRegisterUser = async (newU) => {
    await setDoc(doc(db, "users", String(newU.id)), newU);
  };

  if (!user) return <LoginPage users={users} onLogin={u => { setUser(u); setProfileForm({name:u.name,username:u.username,oldPass:"",newPass:"",confirmPass:""}); }} onResetPassword={handleResetPassword} onRegister={handleRegisterUser}/>;

  const navItems = [
    { id:"dashboard",    icon:"📊", label:"ภาพรวม" },
    { id:"inventory",    icon:"📦", label:"สินค้าคงคลัง" },
    { id:"transactions", icon:"🔄", label:"รับ/จ่ายสินค้า" },
    { id:"barcode",      icon:"▦",  label:"สแกนบาร์โค้ด" },
    { id:"orders",       icon:"📋", label:"ใบสั่งของ" },
    { id:"invoice",      icon:"🧾", label:"ออกบิล" },
    { id:"customers",     icon:"👤", label:"ลูกค้า" },
    { id:"alerts",        icon:"🔔", label:"แจ้งเตือน", badge: lowStock.length },
    ...(role.canManageUsers ? [{ id:"users", icon:"👥", label:"จัดการผู้ใช้" }] : []),
    { id:"reports",   icon:"📊", label:"รายงาน" },
    { id:"suppliers", icon:"🏭", label:"ซัพพลายเออร์" },
  ];


  return (
    <div style={{display:"flex",height:"100vh",fontFamily:"'Sarabun',sans-serif",background:T.bg,color:T.text,overflow:"hidden"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@300;400;500;600;700&family=Space+Mono:wght@400;700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        ::-webkit-scrollbar{width:5px}::-webkit-scrollbar-track{background:#020b18}::-webkit-scrollbar-thumb{background:#0d2540;border-radius:3px}
        input::placeholder{color:#475569}
        input:focus{outline:none;border-color:#38bdf8 !important;box-shadow:0 0 0 3px rgba(56,189,248,0.15)}select:focus{outline:none;border-color:#38bdf8 !important}
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
        @media print{
          /* ปริ้นใช้ iframe — ไม่ต้องทำอะไรกับหน้าหลัก */
        }
      `}</style>

      {/* Hidden image upload for existing products */}
      <input ref={productImageRef} type="file" accept="image/*" style={{display:"none"}} onChange={handleProductImageUpload}/>

      {/* SIDEBAR */}
      <div style={{width:sidebarOpen?224:60,background:T.sidebar,borderRight:`1px solid ${T.border}`,transition:"width .28s",display:"flex",flexDirection:"column",flexShrink:0,boxShadow:"2px 0 8px rgba(0,0,0,0.04)"}}>
        <div style={{padding:"18px 16px",borderBottom:`1px solid ${T.border}`,display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:34,height:34,background:"linear-gradient(135deg,#0ea5e9,#0369a1)",borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,fontSize:18,boxShadow:"0 2px 12px rgba(14,165,233,0.4)"}}>⚙️</div>
          {sidebarOpen&&<div><div style={{fontSize:15,fontWeight:800,color:T.text,fontFamily:"'Space Mono',monospace",letterSpacing:3}}>CPU</div><div style={{fontSize:9,color:T.muted}}>ระบบคลังสินค้า</div></div>}
        </div>

        <nav style={{padding:"10px 8px",flex:1}}>
          {navItems.map(item => {
            const active = activeTab === item.id;
            return (
              <div key={item.id} onClick={() => setActiveTab(item.id)}
                className={active?"nav-active-bar":""}
                style={{display:"flex",alignItems:"center",gap:10,padding:"9px 14px",borderRadius:10,cursor:"pointer",transition:"all .2s",color:active?T.navActiveText:T.sub,fontWeight:active?600:400,fontSize:13,background:active?T.navActive:"transparent",border:active?`1px solid ${T.navActiveBorder}`:"1px solid transparent",marginBottom:2,justifyContent:sidebarOpen?"flex-start":"center",position:"relative",boxShadow:active?"0 0 12px rgba(14,165,233,0.08)":"none"}}>
                <span style={{fontSize:15,flexShrink:0}}>{item.icon}</span>
                {sidebarOpen&&<span style={{fontFamily:"'DM Sans','Sarabun',sans-serif"}}>{item.label}</span>}
                {sidebarOpen&&item.badge>0&&<span style={{marginLeft:"auto",background:T.red,color:"white",borderRadius:10,padding:"1px 7px",fontSize:10,fontWeight:700}}>{item.badge}</span>}
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
                <div style={{fontSize:10,color:ROLES[user.role].color,fontWeight:600}}>{ROLES[user.role].label}</div>
              </div>
            </div>
            <button onClick={openSettings} style={{width:"100%",padding:"7px",borderRadius:8,border:`1px solid ${T.border}`,background:"transparent",color:T.sub,fontSize:12,cursor:"pointer",marginBottom:6,fontFamily:"'Sarabun',sans-serif",fontWeight:500}}>⚙️ ตั้งค่า</button>
            <button onClick={() => setUser(null)} style={{width:"100%",padding:"7px",borderRadius:8,border:`1px solid ${T.border}`,background:"rgba(239,68,68,0.08)",color:T.red,fontSize:12,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontWeight:500}}>🚪 ออกจากระบบ</button>
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
            {activeTab==="inventory"&&inventoryTab==="clothing"&&role.canAdd&&<BtnPrimary onClick={()=>setShowAddClothing(true)}>️ เพิ่มรุ่นใหม่</BtnPrimary>}
            {activeTab==="inventory"&&inventoryTab==="general"&&<>
              <BtnSuccess onClick={()=>{setTxType("รับ");setShowTxModal(true);}}>⬇ รับสินค้า</BtnSuccess>
              <BtnDanger onClick={()=>{setTxType("จ่าย");setShowTxModal(true);}}>⬆ จ่ายสินค้า</BtnDanger>
            </>}
            {activeTab==="transactions"&&<>
              <BtnSuccess onClick={()=>{setTxType("รับ");setShowTxModal(true);}}>⬇ รับสินค้า</BtnSuccess>
              <BtnDanger onClick={()=>{setTxType("จ่าย");setShowTxModal(true);}}>⬆ จ่ายสินค้า</BtnDanger>
            </>}
            {activeTab==="inventory"&&role.canClear&&<button onClick={()=>setShowClearConfirm(true)} style={{padding:"8px 16px",borderRadius:8,border:"1px solid rgba(239,68,68,0.3)",background:"rgba(239,68,68,0.08)",color:T.red,fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"'Sarabun',sans-serif"}}>🗑 ล้างคลัง</button>}
          </div>
        </div>

        <div style={{padding:24,flex:1}}>

          {/* DASHBOARD */}
          {activeTab==="dashboard"&&(
            <div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:16,marginBottom:24}}>
                {[
                  {label:"สินค้าทั้งหมด",value:products.length,unit:"รายการ",icon:"📦",color:T.blue,accent:"#0ea5e9"},
                  {label:"จำนวนรวม",value:totalQty.toLocaleString(),unit:"หน่วย",icon:"📊",color:T.green,accent:"#10b981"},
                  {label:"ต่ำกว่าขั้นต่ำ",value:lowStock.length,unit:"รายการ",icon:"⚠️",color:T.red,accent:"#ef4444"},
                  {label:"รายการเคลื่อนไหว",value:transactions.length,unit:"ครั้ง",icon:"🔄",color:T.amber,accent:"#f59e0b"},
                ].map((s,i)=>(
                  <div key={i} style={{background:"#061628",border:`1px solid ${T.border}`,borderRadius:14,overflow:"hidden",boxShadow:"0 4px 20px rgba(0,0,0,0.15)",transition:"transform .2s,box-shadow .2s"}}
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
                      <div style={{height:5,borderRadius:3,background:"#0a1f35",overflow:"hidden"}}>
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
              <div style={{display:"flex",gap:6,marginBottom:20,padding:"4px",background:T.card,borderRadius:12,border:`1px solid ${T.border}`,width:"fit-content"}}>
                {[{id:"general",icon:"📦",label:"สินค้าทั่วไป"},{id:"clothing",icon:"👕",label:"เสื้อผ้า"}].map(t=>(
                  <button key={t.id} onClick={()=>setInventoryTab(t.id)} style={{padding:"8px 20px",borderRadius:9,border:"none",cursor:"pointer",background:inventoryTab===t.id?"linear-gradient(135deg,#0ea5e9,#0369a1)":"transparent",color:inventoryTab===t.id?"white":T.sub,fontSize:13,fontWeight:inventoryTab===t.id?700:500,fontFamily:"'Sarabun',sans-serif",transition:"all 0.2s",boxShadow:inventoryTab===t.id?"0 4px 14px rgba(14,165,233,0.3)":"none"}}>
                    {t.icon} {t.label}
                    {t.id==="clothing"&&clothingItems.length>0&&<span style={{marginLeft:6,background:"rgba(255,255,255,0.2)",borderRadius:10,padding:"1px 7px",fontSize:10}}>{clothingItems.length}</span>}
                  </button>
                ))}
              </div>

              {/* General products */}
              {inventoryTab==="general"&&<div>
              <div style={{display:"flex",gap:10,marginBottom:16,alignItems:"center",flexWrap:"wrap"}}>
                <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="🔍 ค้นหาชื่อ, รหัส, บาร์โค้ด..."
                  style={{width:260,background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:8,padding:"8px 12px",fontFamily:"'Sarabun',sans-serif",fontSize:13,outline:"none"}}/>
                <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                  {["ทั้งหมด",...categories].map(c=>(
                    <button key={c} onClick={()=>setSelectedCat(c)} style={{padding:"6px 14px",borderRadius:8,border:selectedCat===c?`1px solid #bfdbfe`:`1px solid ${T.border}`,background:selectedCat===c?"#eff6ff":"transparent",color:selectedCat===c?T.blue:T.sub,cursor:"pointer",fontSize:12,fontFamily:"'Sarabun',sans-serif",fontWeight:selectedCat===c?600:400}}>{c}</button>
                  ))}
                </div>
                <div style={{marginLeft:"auto",fontSize:12,color:T.muted}}>พบ {filtered.length} รายการ</div>
              </div>
              <CardBox style={{padding:0,overflow:"hidden"}}>
                {/* Table header */}
                <div style={{display:"grid",gridTemplateColumns:"44px 90px 1fr 110px 70px 70px 70px 100px 100px",alignItems:"center",padding:"10px 16px",background:"#041020",borderBottom:`1px solid ${T.border}`,color:T.muted,fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.06em"}}>
                  <div>รูป</div><div>รหัส</div><div>ชื่อสินค้า</div><div>หมวดหมู่</div><div style={{textAlign:"right"}}>จำนวน</div><div style={{textAlign:"right"}}>ขั้นต่ำ</div><div>สถานะ</div><div>ที่เก็บ</div><div style={{textAlign:"center"}}>จัดการ</div>
                </div>
                {filtered.length===0?(
                  <div style={{padding:40,textAlign:"center",color:T.muted,fontSize:13}}>ยังไม่มีสินค้า — กด "️ เพิ่มสินค้า" เพื่อเริ่มต้น</div>
                ):filtered.map((p,i)=>(
                  <div key={p.id} style={{display:"grid",gridTemplateColumns:"44px 90px 1fr 110px 70px 70px 70px 100px 100px",alignItems:"center",padding:"11px 16px",borderBottom:i<filtered.length-1?`1px solid ${T.border}`:"none",transition:"background .15s"}}
                    onMouseEnter={e=>e.currentTarget.style.background="rgba(14,165,233,0.05)"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                    <div style={{position:"relative"}}>
                      {p.image
                        ?<img src={p.image} alt="" style={{width:38,height:38,borderRadius:6,objectFit:"cover",border:`1px solid ${T.border}`,cursor:"pointer"}} onClick={()=>setShowImgModal(p)}/>
                        :<div style={{width:38,height:38,borderRadius:6,background:"#041020",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",fontSize:12,border:"2px dashed rgba(14,165,233,0.4)",cursor:"pointer",gap:1}} onClick={()=>{setUploadingForProduct(p.id);setTimeout(()=>productImageRef.current?.click(),50);}}>
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
                      {role.canDelete&&<button title="ลบ" onClick={()=>setShowDeleteConfirm(p.id)} style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:6,padding:"4px 7px",cursor:"pointer",fontSize:12,color:T.red}}>✕</button>}
                    </div>
                  </div>
                ))}
              </CardBox>
              </div>} {/* end general tab */}

              {/* Clothing tab content */}
              {inventoryTab==="clothing"&&<div style={{animation:"fadeUp 0.4s ease"}}>
                <input ref={clothingImgRef} type="file" accept="image/*" style={{display:"none"}} onChange={handleClothingImageUpload}/>
                {clothingItems.length===0&&(
                  <div style={{textAlign:"center",padding:60,background:T.card,borderRadius:16,border:`1px solid ${T.border}`}}>
                    <div style={{fontSize:48,marginBottom:12,opacity:0.3}}>👕</div>
                    <div style={{fontSize:14,fontWeight:600,color:T.accent,marginBottom:6}}>ยังไม่มีรุ่นสินค้า</div>
                    <div style={{fontSize:11,color:T.muted}}>กด "️ เพิ่มรุ่นใหม่" เพื่อเริ่มต้น</div>
                  </div>
                )}
                {clothingItems.map((item,idx)=>(
                  <div key={item.id} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:16,marginBottom:16,overflow:"hidden",boxShadow:"0 8px 32px rgba(0,0,0,0.3)"}}>
                    <div onClick={()=>toggleCollapse(item.id)} style={{display:"flex",alignItems:"center",gap:14,padding:"14px 20px",borderBottom:collapsedItems[item.id]?"none":`1px solid ${T.border}`,cursor:"pointer",userSelect:"none",transition:"background 0.2s"}}
                      onMouseEnter={e=>e.currentTarget.style.background="rgba(14,165,233,0.04)"}
                      onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                      {/* Collapse arrow */}
                      <div style={{width:24,height:24,borderRadius:6,background:"rgba(14,165,233,0.1)",border:"1px solid rgba(56,189,248,0.2)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,transition:"transform 0.2s",transform:collapsedItems[item.id]?"rotate(-90deg)":"rotate(0deg)",fontSize:11,color:T.accent}}>▼</div>
                      <div onClick={e=>{e.stopPropagation();setUploadingClothingId(item.id);setTimeout(()=>clothingImgRef.current?.click(),50);}} style={{width:54,height:54,borderRadius:10,background:"rgba(14,165,233,0.08)",border:"2px dashed rgba(56,189,248,0.3)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",flexShrink:0,cursor:"pointer",overflow:"hidden"}}>
                        {item.image?<img src={item.image} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/>:<><span style={{fontSize:20}}>👕</span><span style={{fontSize:8,color:T.muted}}>รูป</span></>}
                      </div>
                      <div style={{flex:1}}>
                        <div style={{fontSize:14,fontWeight:700,color:T.text}}>{item.model}</div>
                        <div style={{fontSize:11,color:T.muted,marginTop:3,display:"flex",alignItems:"center",gap:10}}>
                          <span>{(item.colors||[]).length} สี</span>
                          <span style={{color:"rgba(56,189,248,0.3)"}}>·</span>
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
                        <button onClick={()=>setShowAddColor(item.id)} style={{padding:"7px 14px",borderRadius:8,border:"1px solid rgba(56,189,248,0.25)",background:"rgba(14,165,233,0.08)",color:T.accent,cursor:"pointer",fontSize:12,fontFamily:"'Sarabun',sans-serif",fontWeight:500}}>️ สี</button>
                        {role.canDelete&&<button onClick={()=>handleDeleteClothingItem(item.id)} style={{padding:"7px 12px",borderRadius:8,border:"1px solid rgba(248,113,113,0.25)",background:"rgba(248,113,113,0.08)",color:"#f87171",cursor:"pointer",fontSize:12}}>✕</button>}
                      </div>
                    </div>

                    {/* Collapsed state */}
                    {collapsedItems[item.id]?null:(item.colors||[]).length===0?(
                      <div style={{padding:"20px",textAlign:"center",color:T.muted,fontSize:12}}>ยังไม่มีสี — กด "️ สี"</div>
                    ):(
                      <div style={{overflowX:"auto"}}>
                        <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                          <thead>
                            <tr style={{background:"rgba(2,8,22,0.8)"}}>
                              <th style={{padding:"8px 14px",textAlign:"left",color:T.muted,fontWeight:600,fontSize:10,textTransform:"uppercase",letterSpacing:"0.06em",width:120,borderRight:`1px solid ${T.border}`}}>สี</th>
                              {SIZES.map(sz=>(
                                <th key={sz} style={{padding:"8px 4px",textAlign:"center",color:T.accent,fontWeight:700,fontSize:10,borderRight:"1px solid rgba(13,40,72,0.4)",fontFamily:"monospace",minWidth:38}}>{sz}</th>
                              ))}
                              <th style={{padding:"8px 10px",textAlign:"center",color:T.muted,fontWeight:600,fontSize:10,minWidth:44}}>รวม</th>
                              <th style={{padding:"8px 10px",textAlign:"center",color:T.muted,fontWeight:600,fontSize:10,minWidth:90}}>รับ/จ่าย</th>
                              <th style={{width:30}}/>
                            </tr>
                          </thead>
                          <tbody>
                            {(item.colors||[]).map((col,ci)=>{
                              const total=Object.values(col.stock||{}).reduce((a,b)=>a+b,0);
                              return (
                                <tr key={ci} style={{borderBottom:"1px solid rgba(13,40,72,0.5)"}}
                                  onMouseEnter={e=>e.currentTarget.style.background="rgba(14,165,233,0.04)"}
                                  onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                                  <td style={{padding:"8px 14px",borderRight:`1px solid ${T.border}`}}>
                                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                                      <div style={{width:12,height:12,borderRadius:3,background:col.hex,border:"1px solid rgba(255,255,255,0.15)",flexShrink:0}}/>
                                      <span style={{color:T.text,fontWeight:500,fontSize:11}}>{col.colorName}</span>
                                    </div>
                                  </td>
                                  {SIZES.map(sz=>{
                                    const isEd=editingStock?.itemId===item.id&&editingStock?.ci===ci&&editingStock?.size===sz;
                                    const val=(col.stock||{})[sz]||0;
                                    return (
                                      <td key={sz} style={{padding:"3px 2px",textAlign:"center",borderRight:"1px solid rgba(13,40,72,0.4)"}}>
                                        {isEd?(
                                          <input autoFocus type="number" defaultValue={val}
                                            onBlur={e=>handleUpdateClothingStock(item.id,ci,sz,e.target.value)}
                                            onKeyDown={e=>{if(e.key==="Enter"||e.key==="Escape")e.target.blur();}}
                                            style={{width:34,textAlign:"center",background:"rgba(14,165,233,0.15)",border:"1px solid #38bdf8",borderRadius:5,color:"#38bdf8",fontFamily:"monospace",fontSize:11,padding:"2px",outline:"none"}}/>
                                        ):(
                                          <div onClick={()=>setEditingStock({itemId:item.id,ci,size:sz})}
                                            style={{padding:"3px 2px",borderRadius:5,cursor:"pointer",fontFamily:"monospace",fontWeight:600,fontSize:12,color:val===0?"#1e4060":val<5?"#fbbf24":"#22d3ee",minWidth:34,display:"inline-block",transition:"all 0.15s"}}
                                            onMouseEnter={e=>{e.currentTarget.style.background="rgba(14,165,233,0.12)";e.currentTarget.style.color="#38bdf8";}}
                                            onMouseLeave={e=>{e.currentTarget.style.background="transparent";e.currentTarget.style.color=val===0?"#1e4060":val<5?"#fbbf24":"#22d3ee";}}>
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
                                        style={{padding:"4px 8px",borderRadius:6,border:`1px solid ${hasAny?"rgba(52,211,153,0.3)":T.border}`,background:hasAny?"rgba(52,211,153,0.08)":"rgba(14,165,233,0.05)",color:hasAny?"#34d399":T.sub,cursor:"pointer",fontSize:10,fontWeight:600,fontFamily:"'Sarabun',sans-serif",whiteSpace:"nowrap"}}>
                                          💰 {hasAny ? "แก้ไขราคา" : "ตั้งราคา"}
                                          {cost > 0 && <span style={{marginLeft:4,fontSize:9,opacity:0.7,fontFamily:"monospace"}}>ทุน {cost}</span>}
                                        </button>
                                      );
                                    })()}
                                  </td>
                                  <td style={{textAlign:"center",padding:"4px 6px"}}>
                                    <span style={{fontFamily:"monospace",fontWeight:700,fontSize:12,color:T.accent}}>{total}</span>
                                  </td>
                                  <td style={{textAlign:"center",padding:"4px 8px"}}>
                                    <div style={{display:"flex",gap:4,justifyContent:"center"}}>
                                      <button onClick={()=>{setClothingTxModal({item,colorIdx:ci,size:null});setClothingTxType("รับ");setClothingTxQty("");setClothingTxNote("");}} style={{padding:"4px 8px",borderRadius:6,border:"1px solid rgba(52,211,153,0.3)",background:"rgba(52,211,153,0.08)",color:"#34d399",cursor:"pointer",fontSize:10,fontWeight:600,fontFamily:"'Sarabun',sans-serif"}}>⬇ รับ</button>
                                      <button onClick={()=>{setClothingTxModal({item,colorIdx:ci,size:null});setClothingTxType("จ่าย");setClothingTxQty("");setClothingTxNote("");}} style={{padding:"4px 8px",borderRadius:6,border:"1px solid rgba(248,113,113,0.3)",background:"rgba(248,113,113,0.08)",color:"#f87171",cursor:"pointer",fontSize:10,fontWeight:600,fontFamily:"'Sarabun',sans-serif"}}>⬆ จ่าย</button>
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
              </div>}
            </div>
          )}

          {/* TRANSACTIONS */}
          {activeTab==="transactions"&&(
            <CardBox style={{padding:0,overflow:"hidden"}}>
              <div style={{padding:"14px 16px",borderBottom:`1px solid ${T.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div style={{fontSize:13,fontWeight:600,color:T.text}}>ประวัติการเคลื่อนไหว <span style={{color:T.muted,fontWeight:400}}>({transactions.length} รายการ)</span></div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"70px 80px 1fr 80px 160px 170px",alignItems:"center",padding:"10px 16px",background:"#041020",borderBottom:`1px solid ${T.border}`,color:T.muted,fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.06em"}}>
                <div>#</div><div>ประเภท</div><div>สินค้า</div><div style={{textAlign:"right"}}>จำนวน</div><div>ผู้ดำเนินการ</div><div>วันที่/เวลา</div>
              </div>
              {transactions.length===0?<div style={{padding:40,textAlign:"center",color:T.muted,fontSize:13}}>ยังไม่มีรายการ</div>:transactions.map((t,i)=>(
                <div key={t.id} style={{display:"grid",gridTemplateColumns:"70px 80px 1fr 80px 160px 170px",alignItems:"center",padding:"11px 16px",borderBottom:i<transactions.length-1?`1px solid ${T.border}`:"none"}}
                  onMouseEnter={e=>e.currentTarget.style.background="rgba(14,165,233,0.05)"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
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
                <div style={{display:"flex",gap:10}}>
                  <input ref={barcodeInputRef} value={barcodeSearch} onChange={e=>setBarcodeSearch(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleBarcodeSearch()} placeholder="สแกนหรือพิมพ์บาร์โค้ด / รหัสสินค้า..." autoFocus
                    style={{flex:1,background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:8,padding:"9px 12px",fontFamily:"'Sarabun',sans-serif",fontSize:13,outline:"none"}}/>
                  <BtnPrimary onClick={handleBarcodeSearch}>ค้นหา</BtnPrimary>
                </div>
                <div style={{fontSize:11,color:T.muted,marginTop:8}}>💡 กด Enter หลังสแกนบาร์โค้ด หรือพิมพ์รหัสสินค้าแล้วกดค้นหา</div>
                {barcodeErr&&<div style={{marginTop:14,padding:"10px 14px",background:"#fef2f2",border:"1px solid #fecaca",borderRadius:8,color:T.red,fontSize:13}}>❌ {barcodeErr}</div>}
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
                  <button onClick={()=>setShowAddClothing(true)} style={{padding:"8px 18px",borderRadius:9,border:"none",cursor:"pointer",background:"linear-gradient(135deg,#0ea5e9,#0369a1)",color:"white",fontSize:12,fontWeight:600,fontFamily:"'DM Sans','Sarabun',sans-serif",boxShadow:"0 4px 14px rgba(14,165,233,0.3)"}}>️ เพิ่มรุ่นใหม่</button>
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
                    <div onClick={()=>{setUploadingClothingId(item.id);setTimeout(()=>clothingImgRef.current?.click(),50);}} style={{width:54,height:54,borderRadius:10,background:"rgba(14,165,233,0.08)",border:"2px dashed rgba(56,189,248,0.3)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",flexShrink:0,cursor:"pointer",overflow:"hidden"}}>
                      {item.image?<img src={item.image} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/>:<><span style={{fontSize:20}}>👕</span><span style={{fontSize:8,color:T.muted}}>เพิ่มรูป</span></>}
                    </div>
                    <div style={{flex:1}}>
                      <div style={{fontSize:14,fontWeight:700,color:T.text,fontFamily:"'DM Sans','Sarabun',sans-serif"}}>{item.model}</div>
                      <div style={{fontSize:11,color:T.muted,marginTop:2}}>{(item.colors||[]).length} สี · สต็อกรวม {(item.colors||[]).reduce((s,c)=>s+Object.values(c.stock||{}).reduce((a,b)=>a+b,0),0)} ชิ้น</div>
                    </div>
                    <button onClick={()=>setShowAddColor(item.id)} style={{padding:"7px 14px",borderRadius:8,border:"1px solid rgba(56,189,248,0.25)",background:"rgba(14,165,233,0.08)",color:T.accent,cursor:"pointer",fontSize:12,fontFamily:"'DM Sans','Sarabun',sans-serif",fontWeight:500}}>️ เพิ่มสี</button>
                    {role.canDelete&&<button onClick={()=>handleDeleteClothingItem(item.id)} style={{padding:"7px 12px",borderRadius:8,border:"1px solid rgba(248,113,113,0.25)",background:"rgba(248,113,113,0.08)",color:"#f87171",cursor:"pointer",fontSize:12}}>✕</button>}
                  </div>

                  {/* Table */}
                  {(item.colors||[]).length===0?(
                    <div style={{padding:"24px",textAlign:"center",color:T.muted,fontSize:12}}>ยังไม่มีสี — กด "️ เพิ่มสี"</div>
                  ):(
                    <div style={{overflowX:"auto"}}>
                      <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                        <thead>
                          <tr style={{background:"rgba(2,8,22,0.8)"}}>
                            <th style={{padding:"8px 14px",textAlign:"left",color:T.muted,fontWeight:600,fontSize:10,textTransform:"uppercase",letterSpacing:"0.06em",width:110,borderRight:`1px solid ${T.border}`}}>สี</th>
                            {SIZES.map(sz=>(
                              <th key={sz} style={{padding:"8px 5px",textAlign:"center",color:T.accent,fontWeight:700,fontSize:10,borderRight:`1px solid rgba(13,40,72,0.4)`,fontFamily:"'DM Mono',monospace",minWidth:40}}>{sz}</th>
                            ))}
                            <th style={{padding:"8px 10px",textAlign:"center",color:T.muted,fontWeight:600,fontSize:10,textTransform:"uppercase",minWidth:50}}>รวม</th>
                            <th style={{width:30}}/>
                          </tr>
                        </thead>
                        <tbody>
                          {(item.colors||[]).map((col,ci)=>{
                            const total=Object.values(col.stock||{}).reduce((a,b)=>a+b,0);
                            return (
                              <tr key={ci} style={{borderBottom:`1px solid rgba(13,40,72,0.5)`}}
                                onMouseEnter={e=>e.currentTarget.style.background="rgba(14,165,233,0.04)"}
                                onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                                <td style={{padding:"8px 14px",borderRight:`1px solid ${T.border}`}}>
                                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                                    <div style={{width:14,height:14,borderRadius:3,background:col.hex,border:"1px solid rgba(255,255,255,0.15)",flexShrink:0}}/>
                                    <span style={{color:T.text,fontWeight:500,fontSize:11,fontFamily:"'DM Sans','Sarabun',sans-serif"}}>{col.colorName}</span>
                                  </div>
                                </td>
                                {SIZES.map(sz=>{
                                  const isEd=editingStock?.itemId===item.id&&editingStock?.ci===ci&&editingStock?.size===sz;
                                  const val=(col.stock||{})[sz]||0;
                                  return (
                                    <td key={sz} style={{padding:"4px 2px",textAlign:"center",borderRight:"1px solid rgba(13,40,72,0.4)"}}>
                                      {isEd?(
                                        <input autoFocus type="number" defaultValue={val}
                                          onBlur={e=>handleUpdateClothingStock(item.id,ci,sz,e.target.value)}
                                          onKeyDown={e=>{if(e.key==="Enter"||e.key==="Escape")e.target.blur();}}
                                          style={{width:36,textAlign:"center",background:"rgba(14,165,233,0.15)",border:"1px solid #38bdf8",borderRadius:5,color:"#38bdf8",fontFamily:"'DM Mono',monospace",fontSize:11,padding:"3px 2px",outline:"none"}}/>
                                      ):(
                                        <div onClick={()=>setEditingStock({itemId:item.id,ci,size:sz})}
                                          style={{padding:"4px 2px",borderRadius:5,cursor:"pointer",fontFamily:"'DM Mono',monospace",fontWeight:600,fontSize:12,color:val===0?"#1e4060":val<5?"#fbbf24":"#22d3ee",minWidth:36,display:"inline-block",transition:"all 0.15s"}}
                                          onMouseEnter={e=>{e.currentTarget.style.background="rgba(14,165,233,0.12)";e.currentTarget.style.color="#38bdf8";}}
                                          onMouseLeave={e=>{e.currentTarget.style.background="transparent";e.currentTarget.style.color=val===0?"#1e4060":val<5?"#fbbf24":"#22d3ee";}}>
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
                      <button onClick={handleAddClothingItem} disabled={!newModel.trim()} style={{flex:1,padding:"9px",borderRadius:9,border:"none",background:"linear-gradient(135deg,#0ea5e9,#0369a1)",color:"white",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"'DM Sans','Sarabun',sans-serif",opacity:!newModel.trim()?0.45:1}}>✅ สร้างรุ่น</button>
                    </div>
                  </div>
                </div>
              )}

              {/* ── MODAL: เพิ่มสี ── */}
              {showAddColor&&(
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
                            style={{display:"flex",alignItems:"center",gap:6,padding:"6px 12px",borderRadius:20,border:`1px solid ${already?"rgba(13,40,72,0.5)":"rgba(56,189,248,0.25)"}`,cursor:already?"not-allowed":"pointer",background:already?"rgba(13,40,72,0.3)":"rgba(14,165,233,0.08)",opacity:already?0.4:1,transition:"all 0.2s"}}
                            onMouseEnter={e=>{if(!already)e.currentTarget.style.background="rgba(14,165,233,0.18)";}}
                            onMouseLeave={e=>{if(!already)e.currentTarget.style.background="rgba(14,165,233,0.08)";}}>
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
                          style={{padding:"9px 16px",borderRadius:9,border:"none",cursor:"pointer",background:"linear-gradient(135deg,#0ea5e9,#0369a1)",color:"white",fontSize:12,fontWeight:600,fontFamily:"'DM Sans','Sarabun',sans-serif",opacity:!customColorName.trim()?0.45:1}}>เพิ่ม</button>
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
                          background:invoiceStatusFilter===s?(isAll?"rgba(14,165,233,0.15)":st.bg):"transparent",
                          color:invoiceStatusFilter===s?(isAll?T.accent:st.color):T.muted}}>
                        {s}{!isAll&&<span style={{marginLeft:4,fontSize:10,opacity:0.7}}>({invoices.filter(x=>(x.status||"ออกแล้ว")===s).length})</span>}
                      </button>);
                  })}
                </div>
                <button onClick={()=>{setInvoiceForm({customerId:"",customerName:"",customerPhone:"",customerAddress:"",customerTaxId:"",items:[],note:"",dueDate:"",vatRate:7});setInvoiceDocType("receipt");setInvoiceVat(false);setShowNewInvoice(true);}}
                  style={{padding:"8px 18px",borderRadius:9,border:"none",cursor:"pointer",background:"linear-gradient(135deg,#0ea5e9,#0369a1)",color:"white",fontSize:12,fontWeight:600,fontFamily:"'Sarabun',sans-serif",boxShadow:"0 4px 14px rgba(14,165,233,0.3)"}}>＋ ออกบิลใหม่</button>
              </div>
              {invoices.length===0?(
                <div style={{textAlign:"center",padding:60,background:T.card,borderRadius:16,border:`1px solid ${T.border}`}}>
                  <div style={{fontSize:48,marginBottom:12,opacity:0.3}}>🧾</div>
                  <div style={{fontSize:14,fontWeight:600,color:T.accent,marginBottom:6}}>ยังไม่มีบิล</div>
                  <div style={{fontSize:11,color:T.muted}}>กด "＋ ออกบิลใหม่" เพื่อเริ่มต้น</div>
                </div>
              ):(()=>{
                const fInv=invoiceStatusFilter==="ทั้งหมด"?invoices:invoices.filter(x=>(x.status||"ออกแล้ว")===invoiceStatusFilter);
                return fInv.length===0?<div style={{textAlign:"center",padding:40,color:T.muted,fontSize:13}}>ไม่พบบิลตามสถานะนี้</div>:(
                <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:16,overflow:"hidden"}}>
                  <div style={{display:"grid",gridTemplateColumns:"90px 80px 1fr 120px 100px 140px 100px",alignItems:"center",padding:"10px 20px",background:"rgba(2,8,22,0.8)",borderBottom:`1px solid ${T.border}`,color:T.muted,fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.06em"}}>
                    <div>เลขที่</div><div>ประเภท</div><div>ลูกค้า</div><div style={{textAlign:"right"}}>ยอดรวม</div><div>วันที่</div><div>สถานะชำระ</div><div style={{textAlign:"center"}}>จัดการ</div>
                  </div>
                  {fInv.map((inv,i)=>{
                    const st=paymentStatusStyle(inv.status||"ออกแล้ว");
                    return (
                    <div key={inv.id} style={{display:"grid",gridTemplateColumns:"90px 80px 1fr 120px 100px 140px 100px",alignItems:"center",padding:"13px 20px",borderBottom:i<fInv.length-1?`1px solid ${T.border}`:"none",transition:"background 0.15s"}}
                      onMouseEnter={e=>e.currentTarget.style.background="rgba(14,165,233,0.04)"}
                      onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                      <div style={{fontFamily:"monospace",fontSize:11,color:T.accent,fontWeight:700}}>{inv.invoiceNo}</div>
                      <div><span style={{padding:"2px 8px",borderRadius:12,fontSize:10,fontWeight:600,background:"rgba(14,165,233,0.1)",color:T.accent,border:"1px solid rgba(56,189,248,0.2)"}}>{docTypeLabel(inv.docType)?.slice(0,4)}</span></div>
                      <div><div style={{fontWeight:600,color:T.text,fontSize:13}}>{inv.customerName}</div><div style={{fontSize:10,color:T.muted}}>{inv.customerPhone}</div></div>
                      <div style={{textAlign:"right",fontFamily:"monospace",fontWeight:700,color:"#34d399",fontSize:13}}>฿{(inv.total||0).toLocaleString("th-TH",{minimumFractionDigits:2})}</div>
                      <div style={{fontSize:11,color:T.muted}}>{inv.date}</div>
                      <div>
                        <select value={inv.status||"ออกแล้ว"} onChange={e=>handleUpdateInvoiceStatus(inv.id,e.target.value)}
                          style={{background:st.bg,border:st.border,borderRadius:10,padding:"4px 8px",fontSize:10,fontWeight:600,color:st.color,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",outline:"none"}}>
                          {PAYMENT_STATUSES.map(s=><option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>
                      <div style={{display:"flex",gap:5,justifyContent:"center"}}>
                        <button onClick={()=>setShowPrintInvoice(inv)} style={{padding:"5px 10px",borderRadius:7,border:"1px solid rgba(56,189,248,0.25)",background:"rgba(14,165,233,0.08)",color:T.accent,cursor:"pointer",fontSize:11,fontFamily:"'Sarabun',sans-serif"}}>🖨️</button>
                        {role.canDelete&&<button onClick={async()=>await deleteDoc(doc(db,"invoices",inv.id))} style={{padding:"5px 8px",borderRadius:7,border:"1px solid rgba(248,113,113,0.25)",background:"rgba(248,113,113,0.08)",color:"#f87171",cursor:"pointer",fontSize:11}}>✕</button>}
                      </div>
                    </div>);
                  })}
                </div>);
              })()}
            </div>
          )}

          {/* ── ORDERS ── */}
          {activeTab==="orders"&&(
            <div style={{animation:"fadeUp 0.4s ease"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
                <div style={{fontSize:12,color:T.sub}}>ใบสั่งของทั้งหมด <b style={{color:T.accent}}>{orders.length} ใบ</b></div>
                <button onClick={()=>{setOrderForm({customerId:"",customerName:"",customerPhone:"",customerAddress:"",note:"",items:[]});setShowNewOrder(true);}} style={{padding:"8px 18px",borderRadius:9,border:"none",cursor:"pointer",background:"linear-gradient(135deg,#0ea5e9,#0369a1)",color:"white",fontSize:12,fontWeight:600,fontFamily:"'Sarabun',sans-serif",boxShadow:"0 4px 14px rgba(14,165,233,0.3)"}}>️ สร้างใบสั่งของ</button>
              </div>

              {orders.length===0?(
                <div style={{textAlign:"center",padding:60,background:T.card,borderRadius:16,border:`1px solid ${T.border}`}}>
                  <div style={{fontSize:48,marginBottom:12,opacity:0.3}}>📋</div>
                  <div style={{fontSize:14,fontWeight:600,color:T.accent,marginBottom:6}}>ยังไม่มีใบสั่งของ</div>
                  <div style={{fontSize:11,color:T.muted}}>กด "️ สร้างใบสั่งของ" เพื่อเริ่มต้น</div>
                </div>
              ):(
                <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:16,overflow:"hidden"}}>
                  <div style={{display:"grid",gridTemplateColumns:"100px 1fr 120px 80px 80px 100px",alignItems:"center",padding:"10px 20px",background:"rgba(2,8,22,0.8)",borderBottom:`1px solid ${T.border}`,color:T.muted,fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.06em"}}>
                    <div>เลขที่</div><div>ลูกค้า</div><div>รายการ</div><div>โดย</div><div>สถานะ</div><div style={{textAlign:"center"}}>จัดการ</div>
                  </div>
                  {orders.map((o,i)=>(
                    <div key={o.id} style={{display:"grid",gridTemplateColumns:"100px 1fr 120px 80px 80px 100px",alignItems:"center",padding:"13px 20px",borderBottom:i<orders.length-1?`1px solid ${T.border}`:"none"}}
                      onMouseEnter={e=>e.currentTarget.style.background="rgba(14,165,233,0.04)"}
                      onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                      <div style={{fontFamily:"monospace",fontSize:11,color:T.accent,fontWeight:700}}>{o.orderNo}</div>
                      <div>
                        <div style={{fontWeight:600,color:T.text,fontSize:13}}>{o.customerName}</div>
                        <div style={{fontSize:10,color:T.muted,marginTop:1}}>{o.customerPhone} · {o.date}</div>
                      </div>
                      <div style={{fontSize:12,color:T.sub}}>{(o.items||[]).length} รายการ · {(o.items||[]).reduce((s,i)=>s+i.qty,0)} ชิ้น</div>
                      <div style={{fontSize:11,color:T.sub}}>{o.by}</div>
                      <div><span style={{padding:"3px 10px",borderRadius:20,fontSize:11,fontWeight:600,background:"rgba(52,211,153,0.1)",color:"#34d399",border:"1px solid rgba(52,211,153,0.2)"}}>{o.status}</span></div>
                      <div style={{display:"flex",gap:6,justifyContent:"center"}}>
                        <button onClick={()=>setShowPrintOrder(o)} style={{padding:"5px 10px",borderRadius:7,border:`1px solid rgba(56,189,248,0.25)`,background:"rgba(14,165,233,0.08)",color:T.accent,cursor:"pointer",fontSize:11,fontFamily:"'Sarabun',sans-serif"}}>🖨️ ปริ้น</button>
                        {role.canDelete&&<button onClick={async()=>await deleteDoc(doc(db,"orders",o.id))} style={{padding:"5px 8px",borderRadius:7,border:"1px solid rgba(248,113,113,0.25)",background:"rgba(248,113,113,0.08)",color:"#f87171",cursor:"pointer",fontSize:11}}>✕</button>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── CUSTOMERS ── */}
          {activeTab==="customers"&&(
            <div style={{animation:"fadeUp 0.4s ease",maxWidth:700}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
                <div style={{fontSize:12,color:T.sub}}>ลูกค้าทั้งหมด <b style={{color:T.accent}}>{customers.length} ราย</b></div>
                <button onClick={()=>setShowNewCustomer(true)} style={{padding:"8px 18px",borderRadius:9,border:"none",cursor:"pointer",background:"linear-gradient(135deg,#0ea5e9,#0369a1)",color:"white",fontSize:12,fontWeight:600,fontFamily:"'Sarabun',sans-serif",boxShadow:"0 4px 14px rgba(14,165,233,0.3)"}}>️ เพิ่มลูกค้าใหม่</button>
              </div>
              <div style={{marginBottom:14}}>
                <input value={customerSearch} onChange={e=>setCustomerSearch(e.target.value)} placeholder="🔍 ค้นหาชื่อ เบอร์ หรือที่อยู่..."
                  style={{width:"100%",background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:9,padding:"9px 14px",fontFamily:"'Sarabun',sans-serif",fontSize:13,outline:"none"}}/>
              </div>
              {customers.length===0?(
                <div style={{textAlign:"center",padding:60,background:T.card,borderRadius:16,border:`1px solid ${T.border}`}}>
                  <div style={{fontSize:48,marginBottom:12,opacity:0.3}}>👤</div>
                  <div style={{fontSize:14,fontWeight:600,color:T.accent,marginBottom:6}}>ยังไม่มีข้อมูลลูกค้า</div>
                  <div style={{fontSize:11,color:T.muted}}>กด "️ เพิ่มลูกค้าใหม่" เพื่อเริ่มต้น</div>
                </div>
              ):(
                <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:16,overflow:"hidden"}}>
                  {customers.filter(c=>!customerSearch||(c.name||"").includes(customerSearch)||(c.phone||"").includes(customerSearch)||(c.address||"").includes(customerSearch)).map((c,i,arr)=>(
                    <div key={c.id} style={{display:"flex",alignItems:"center",gap:14,padding:"14px 20px",borderBottom:i<arr.length-1?`1px solid ${T.border}`:"none"}}
                      onMouseEnter={e=>e.currentTarget.style.background="rgba(14,165,233,0.04)"}
                      onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                      <div style={{width:40,height:40,borderRadius:"50%",background:"linear-gradient(135deg,#0ea5e9,#0369a1)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0,boxShadow:"0 4px 10px rgba(14,165,233,0.3)"}}>👤</div>
                      <div style={{flex:1}}>
                        <div style={{fontWeight:600,color:T.text,fontSize:13}}>{c.name}</div>
                        <div style={{fontSize:11,color:T.muted,marginTop:2}}>📞 {c.phone||"-"}</div>
                        <div style={{fontSize:11,color:T.muted}}>📍 {c.address||"-"}</div>
                      </div>
                      <div style={{fontSize:11,color:T.sub}}>สั่งซื้อ {orders.filter(o=>o.customerId===c.id).length} ครั้ง</div>
                      {role.canDelete&&<button onClick={async()=>await deleteDoc(doc(db,"customers",c.id))} style={{padding:"5px 8px",borderRadius:7,border:"1px solid rgba(248,113,113,0.25)",background:"rgba(248,113,113,0.08)",color:"#f87171",cursor:"pointer",fontSize:11}}>✕</button>}
                    </div>
                  ))}
                </div>
              )}
            </div>
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
                      {p.image?<img src={p.image} alt="" style={{width:52,height:52,borderRadius:8,objectFit:"cover"}}/>:<div style={{fontSize:30}}>⚠️</div>}
                      <div style={{flex:1}}>
                        <div style={{fontWeight:600,color:T.text}}>{p.name}</div>
                        <div style={{fontSize:12,color:T.sub}}>{p.code} · ที่เก็บ: {p.location}</div>
                        <div style={{marginTop:8,height:5,borderRadius:3,background:"#f1f5f9",width:200,overflow:"hidden"}}>
                          <div style={{height:"100%",borderRadius:3,width:`${Math.min((Number(p.qty)/Math.max(Number(p.minQty),1))*100,100)}%`,background:T.red}}/>
                        </div>
                      </div>
                      <div style={{textAlign:"right"}}><div style={{fontSize:24,fontWeight:700,color:T.red,fontFamily:"monospace"}}>{p.qty}</div><div style={{fontSize:11,color:T.muted}}>ขั้นต่ำ: {p.minQty} {p.unit}</div></div>
                      <BtnPrimary onClick={()=>{setTxType("รับ");setTxForm(f=>({...f,productId:String(p.id)}));setShowTxModal(true);}}>+ รับสินค้า</BtnPrimary>
                    </CardBox>
                  ))}
                </>
              )}
            </div>
          )}

          {/* USERS */}
          {activeTab==="users"&&role.canManageUsers&&(
            <div style={{maxWidth:680}}>
              <div style={{fontSize:14,fontWeight:600,color:T.text,marginBottom:16}}>👥 รายชื่อผู้ใช้งาน ({users.length} บัญชี)</div>
              <CardBox style={{padding:0,overflow:"hidden"}}>
                <div style={{display:"grid",gridTemplateColumns:"40px 1fr 130px 180px 60px",alignItems:"center",padding:"10px 16px",background:"#041020",borderBottom:`1px solid ${T.border}`,color:T.muted,fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.06em"}}>
                  <div></div><div>ชื่อ / ผู้ใช้</div><div>บทบาท</div><div>สิทธิ์</div><div style={{textAlign:"center"}}>ลบ</div>
                </div>
                {users.map((u,i)=>(
                  <div key={u.id} style={{display:"grid",gridTemplateColumns:"40px 1fr 130px 180px 60px",alignItems:"center",padding:"12px 16px",borderBottom:i<users.length-1?`1px solid ${T.border}`:"none"}}
                    onMouseEnter={e=>e.currentTarget.style.background="rgba(14,165,233,0.05)"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                    <div style={{fontSize:22}}>{u.avatar}</div>
                    <div>
                      <div style={{fontWeight:600,color:T.text,fontSize:13}}>{u.name}</div>
                      <div style={{fontSize:11,color:T.muted}}>@{u.username}</div>
                    </div>
                    <div>
                      {user.role==="admin" ? (
                        <select value={u.role} onChange={async e=>{
                          const newRole = e.target.value;
                          const updated = {...u, role: newRole, avatar: newRole==="admin"?"👑":newRole==="manager"?"🧑‍💼":"👷"};
                          await setDoc(doc(db,"users",String(u.id)),updated);
                        }} style={{background:T.input,border:`1px solid ${T.inputBorder}`,color:ROLES[u.role].color,borderRadius:8,padding:"5px 8px",fontFamily:"'Sarabun',sans-serif",fontSize:12,fontWeight:600,outline:"none",cursor:"pointer"}}>
                          <option value="admin">👑 Admin</option>
                          <option value="manager">🧑‍💼 Manager</option>
                          <option value="staff">👷 Staff</option>
                        </select>
                      ) : (
                        <Badge bg={`${ROLES[u.role].color}15`} color={ROLES[u.role].color}>{ROLES[u.role].label}</Badge>
                      )}
                    </div>
                    <div style={{fontSize:11,color:T.muted}}>
                      {ROLES[u.role].canAdd?"✅":"❌"} เพิ่ม·{ROLES[u.role].canDelete?"✅":"❌"} ลบ·{ROLES[u.role].canClear?"✅":"❌"} ล้าง
                    </div>
                    <div style={{textAlign:"center"}}>
                      {user.role==="admin" && String(u.id)!==String(user.id) && (
                        <button onClick={()=>setShowDeleteUserConfirm(u)} style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:6,padding:"5px 10px",cursor:"pointer",fontSize:13,color:T.red,fontWeight:700}}>✕</button>
                      )}
                    </div>
                  </div>
                ))}
              </CardBox>
              <div style={{marginTop:14,padding:12,background:"rgba(14,165,233,0.08)",border:"1px solid rgba(56,189,248,0.2)",borderRadius:10,fontSize:12,color:"#38bdf8"}}>
                💡 พนักงานใหม่สมัครได้เองที่หน้า Login → "สมัคร Staff ID ใหม่" — Admin กำหนดบทบาทได้ที่นี่
              </div>
            </div>
          )}

          {/* ── REPORTS ── */}
          {activeTab==="reports"&&(
            <ReportsTab products={products} transactions={transactions} invoices={invoices} orders={orders}/>
          )}

          {/* ── SUPPLIERS ── */}
          {activeTab==="suppliers"&&(
            <SuppliersTab suppliers={suppliers} role={role}/>
          )}


        </div>
      </div>

      {/* ── MODAL: เพิ่มสินค้า ── */}
      {showAddModal&&(
        <Modal onClose={()=>setShowAddModal(false)} w={520}>
          <MHead title="🆕 เพิ่มสินค้าใหม่" onClose={()=>setShowAddModal(false)}/>
          {addSuccess&&<Toast msg="เพิ่มสินค้าสำเร็จ!"/>}
          <div style={{display:"flex",alignItems:"center",gap:16,marginBottom:18,padding:14,background:"#f8fafc",borderRadius:10,border:`1px solid ${T.border}`}}>
            <div style={{flexShrink:0}}>
              {newProduct.image?<img src={newProduct.image} alt="" style={{width:80,height:80,borderRadius:10,objectFit:"cover",border:`2px solid ${T.blue}`}}/>
                :<div style={{width:80,height:80,borderRadius:10,background:T.input,display:"flex",alignItems:"center",justifyContent:"center",fontSize:28,border:`2px dashed ${T.inputBorder}`,cursor:"pointer"}} onClick={()=>imageInputRef.current?.click()}>📷</div>}
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
            <BtnPrimary onClick={handleAddProduct} disabled={!newProduct.code||!newProduct.name||newProduct.qty===""||!newProduct.unit} style={{flex:1}}>✅ บันทึกสินค้า</BtnPrimary>
          </div>
        </Modal>
      )}

      {/* ── MODAL: รับ/จ่าย ── */}
      {showTxModal&&(
        <Modal onClose={()=>setShowTxModal(false)} w={420}>
          <MHead title={txType==="รับ"?"⬇️ รับสินค้าเข้าคลัง":"⬆️ จ่ายสินค้าออกคลัง"} onClose={()=>setShowTxModal(false)} color={txType==="รับ"?T.green:T.red}/>
          {txSuccess&&<Toast msg="บันทึกสำเร็จ!"/>}
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            <div>
              <label style={{fontSize:11,color:T.sub,display:"block",marginBottom:5,fontWeight:500}}>สินค้า</label>
              <select value={txForm.productId} onChange={e=>setTxForm(f=>({...f,productId:e.target.value}))} style={{width:"100%",background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:8,padding:"9px 12px",fontFamily:"'Sarabun',sans-serif",fontSize:13,outline:"none"}}>
                <option value="">-- เลือกสินค้า --</option>
                {products.map(p=><option key={p.id} value={p.id}>{p.code} — {p.name} (คงเหลือ: {p.qty} {p.unit})</option>)}
              </select>
            </div>
            <Input label="จำนวน" type="number" placeholder="0" value={txForm.qty} onChange={e=>setTxForm(f=>({...f,qty:e.target.value}))}/>
            <Input label="หมายเหตุ" placeholder="ระบุหมายเหตุ (ถ้ามี)" value={txForm.note} onChange={e=>setTxForm(f=>({...f,note:e.target.value}))}/>
            <div style={{display:"flex",gap:10}}>
              <BtnGhost onClick={()=>setShowTxModal(false)} style={{flex:1}}>ยกเลิก</BtnGhost>
              {txType==="รับ"
                ?<BtnSuccess onClick={handleTx} disabled={!txForm.productId||!txForm.qty||Number(txForm.qty)<=0} style={{flex:1}}>ยืนยันรับสินค้า</BtnSuccess>
                :<BtnDanger onClick={handleTx} disabled={!txForm.productId||!txForm.qty||Number(txForm.qty)<=0} style={{flex:1}}>ยืนยันจ่ายสินค้า</BtnDanger>
              }
            </div>
          </div>
        </Modal>
      )}

      {/* ── MODAL: ประวัติ ── */}
      {showHistoryModal&&(
        <Modal onClose={()=>setShowHistoryModal(null)} w={500}>
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
        <Modal onClose={()=>setShowCatModal(false)} w={420}>
          <MHead title="📦 จัดการหมวดหมู่" onClose={()=>setShowCatModal(false)}/>
          <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:16,padding:12,background:"#f8fafc",borderRadius:10,border:`1px solid ${T.border}`,minHeight:48}}>
            {categories.map(c=>(
              <span key={c} style={{display:"inline-flex",alignItems:"center",gap:6,padding:"5px 12px",borderRadius:20,fontSize:12,fontWeight:500,background:"rgba(59,130,246,0.15)",color:"#93c5fd",border:"1px solid rgba(99,179,237,0.3)"}}>
                {c}
                {role.canManageCats&&<span onClick={()=>setCategories(prev=>prev.filter(x=>x!==c))} style={{cursor:"pointer",color:T.red,fontWeight:700,fontSize:14,lineHeight:1}}>×</span>}
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
        <Modal onClose={()=>setShowImgModal(null)} w={420}>
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
            const r=new FileReader();
            r.onload=async ev=>{
              await updateDoc(doc(db,"products",showImgModal.id),{image:ev.target.result,lastUpdate:now()});
              setShowImgModal(p=>({...p,image:ev.target.result}));
            };
            r.readAsDataURL(file);
            e.target.value="";
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
        <Modal onClose={()=>setShowBarcodeModal(null)} w={360}>
          <MHead title="▦ บาร์โค้ดสินค้า" sub={showBarcodeModal.name} onClose={()=>setShowBarcodeModal(null)}/>
          <div style={{display:"flex",justifyContent:"center",marginBottom:16}}><BarcodeDisplay value={showBarcodeModal.barcode}/></div>
          <div style={{fontSize:12,color:T.sub,textAlign:"center",marginBottom:16}}>รหัส: {showBarcodeModal.code} · หมวด: {showBarcodeModal.category}</div>
          <BtnGhost onClick={()=>setShowBarcodeModal(null)} style={{width:"100%"}}>ปิด</BtnGhost>
        </Modal>
      )}

      {/* ── MODAL: ยืนยันลบ ── */}
      {showDeleteConfirm&&(
        <Modal onClose={()=>setShowDeleteConfirm(null)} w={340}>
          <div style={{textAlign:"center"}}>
            <div style={{fontSize:42,marginBottom:12}}>🗑️</div>
            <div style={{fontSize:15,fontWeight:700,color:T.text,marginBottom:8}}>ยืนยันการลบสินค้า?</div>
            <div style={{fontSize:13,color:T.sub,marginBottom:24}}>ประวัติของสินค้านี้จะหายไปด้วย</div>
            <div style={{display:"flex",gap:10}}><BtnGhost onClick={()=>setShowDeleteConfirm(null)} style={{flex:1}}>ยกเลิก</BtnGhost><BtnDanger onClick={()=>handleDelete(showDeleteConfirm)} style={{flex:1}}>ลบสินค้า</BtnDanger></div>
          </div>
        </Modal>
      )}

      {/* ── MODAL: ล้างคลัง ── */}
      {showClearConfirm&&(
        <Modal onClose={()=>setShowClearConfirm(false)} w={360}>
          <div style={{textAlign:"center"}}>
            <div style={{fontSize:42,marginBottom:12}}>⚠️</div>
            <div style={{fontSize:15,fontWeight:700,color:T.red,marginBottom:8}}>ล้างคลังสินค้าทั้งหมด?</div>
            <div style={{fontSize:13,color:T.sub,marginBottom:8}}>สินค้าและประวัติทั้งหมดจะถูกลบออก</div>
            <div style={{fontSize:12,color:T.red,marginBottom:24,padding:"10px",background:"#fef2f2",borderRadius:8}}>⚠️ ไม่สามารถย้อนกลับได้!</div>
            <div style={{display:"flex",gap:10}}><BtnGhost onClick={()=>setShowClearConfirm(false)} style={{flex:1}}>ยกเลิก</BtnGhost><BtnDanger onClick={handleClear} style={{flex:1}}>ล้างคลังทั้งหมด</BtnDanger></div>
          </div>
        </Modal>
      )}

      {/* ── MODAL: Settings ── */}
      {showSettings&&(
        <Modal onClose={()=>setShowSettings(false)} w={520}>
          <MHead title="⚙️ ตั้งค่าระบบ" onClose={()=>setShowSettings(false)}/>
          {/* Settings tabs */}
          <div style={{display:"flex",gap:4,marginBottom:20,borderBottom:`1px solid ${T.border}`,paddingBottom:12}}>
            {[{id:"profile",label:"👤 โปรไฟล์"},{id:"system",label:"🏢 ระบบ"},{id:"about",label:"ℹ️ เกี่ยวกับ"}].map(t=>(
              <button key={t.id} onClick={()=>setSettingsTab(t.id)} style={{padding:"7px 16px",borderRadius:8,border:settingsTab===t.id?`1px solid ${T.navActiveBorder}`:`1px solid transparent`,background:settingsTab===t.id?"rgba(14,165,233,0.15)":"transparent",color:settingsTab===t.id?"#38bdf8":T.sub,cursor:"pointer",fontSize:13,fontFamily:"'Sarabun',sans-serif",fontWeight:settingsTab===t.id?600:400}}>{t.label}</button>
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

          {settingsTab==="system"&&(
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
              <div style={{marginTop:16,padding:12,background:"rgba(14,165,233,0.08)",border:"1px solid rgba(56,189,248,0.2)",borderRadius:10,fontSize:12,color:"#38bdf8"}}>
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

          {settingsTab==="about"&&(
            <div style={{textAlign:"center",padding:"10px 0"}}>
              <div style={{width:64,height:64,background:"linear-gradient(135deg,#0ea5e9,#0369a1)",borderRadius:16,display:"flex",alignItems:"center",justifyContent:"center",fontSize:30,margin:"0 auto 16px",boxShadow:"0 8px 32px rgba(14,165,233,0.4)"}}>⚙️</div>
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
        <Modal onClose={()=>setShowNewOrder(false)} w={700}>
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
                {customerSearch&&!orderForm.customerId&&(
                  <div style={{position:"absolute",top:"100%",left:0,right:0,background:"#061628",border:`1px solid ${T.border}`,borderRadius:10,zIndex:50,maxHeight:180,overflowY:"auto",boxShadow:"0 8px 24px rgba(0,0,0,0.4)"}}>
                    {customers.filter(c=>(c.name||"").includes(customerSearch)||(c.phone||"").includes(customerSearch)).slice(0,5).map(c=>(
                      <div key={c.id} onClick={()=>handleSelectCustomer(c)} style={{padding:"10px 14px",cursor:"pointer",borderBottom:`1px solid ${T.border}`,transition:"background 0.15s"}}
                        onMouseEnter={e=>e.currentTarget.style.background="rgba(14,165,233,0.1)"}
                        onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                        <div style={{fontSize:13,fontWeight:600,color:T.text}}>{c.name}</div>
                        <div style={{fontSize:11,color:T.muted}}>📞 {c.phone} · 📍 {c.address}</div>
                      </div>
                    ))}
                    {customers.filter(c=>(c.name||"").includes(customerSearch)||(c.phone||"").includes(customerSearch)).length===0&&(
                      <div style={{padding:"10px 14px",fontSize:12,color:T.muted}}>ไม่พบลูกค้า — จะสร้างใหม่อัตโนมัติ</div>
                    )}
                  </div>
                )}
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
              <div style={{marginBottom:14,background:"rgba(2,8,22,0.6)",borderRadius:10,border:"1px solid rgba(56,189,248,0.2)",overflow:"hidden"}}>
                <div style={{padding:"8px 14px",background:"rgba(14,165,233,0.08)",borderBottom:"1px solid rgba(56,189,248,0.15)",display:"flex",alignItems:"center",gap:8}}>
                  <div style={{width:12,height:12,borderRadius:2,background:col.hex,border:"1px solid rgba(255,255,255,0.15)"}}/>
                  <span style={{fontSize:12,color:T.accent,fontWeight:600}}>{item.model} · {col.colorName}</span>
                  <span style={{fontSize:10,color:T.muted,marginLeft:"auto"}}>กรอกจำนวนที่ต้องการสั่ง</span>
                </div>
                <div style={{padding:10,display:"flex",flexDirection:"column",gap:8}}>
                  {[["6","8","10","12"],["S","M","L","XL"],["2XL"],["3XL"],["4XL"],["5XL"]].map((row,ri)=>(
                    <div key={ri} style={{display:"grid",gridTemplateColumns:`repeat(${row.length},1fr)`,gap:6}}>
                      {row.map(sz=>{
                        const stock=(col.stock||{})[sz]||0;
                        const curVal=orderForm.items.find(i=>i.clothingId===orderItemForm.clothingId&&i.colorIdx===Number(orderItemForm.colorIdx)&&i.size===sz)?.qty||0;
                        return (
                          <div key={sz} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 10px",background:stock===0?"rgba(13,40,72,0.25)":"rgba(2,8,22,0.5)",borderRadius:7,border:`1px solid ${stock===0?"rgba(13,40,72,0.5)":"rgba(56,189,248,0.18)"}`}}>
                            <div style={{minWidth:38,display:"flex",flexDirection:"column"}}>
                              <span style={{fontFamily:"monospace",fontWeight:700,fontSize:13,color:stock===0?"#1e4060":T.accent}}>{sz}</span>
                              <span style={{fontSize:9,color:stock===0?"#1e4060":stock<5?"#fbbf24":"#22d3ee",fontFamily:"monospace"}}>มี {stock}</span>
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
                              style={{flex:1,minWidth:0,textAlign:"center",background:stock===0?"rgba(13,40,72,0.3)":"rgba(14,165,233,0.1)",border:`1px solid ${stock===0?"rgba(13,40,72,0.5)":"rgba(56,189,248,0.25)"}`,borderRadius:6,color:stock===0?"#1e4060":"#38bdf8",fontFamily:"monospace",fontSize:13,fontWeight:600,padding:"6px 4px",outline:"none",cursor:stock===0?"not-allowed":"text"}}
                            />
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
                <div style={{padding:"8px 14px",borderTop:"1px solid rgba(13,40,72,0.5)",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <span style={{fontSize:11,color:T.muted}}>💡 กรอกจำนวน แล้วคลิกออกจากช่องเพื่อบันทึก</span>
                  <span style={{fontSize:12,color:T.accent,fontFamily:"monospace",fontWeight:700}}>
                    สั่ง {orderForm.items.filter(i=>i.clothingId===orderItemForm.clothingId&&i.colorIdx===Number(orderItemForm.colorIdx)).reduce((s,i)=>s+i.qty,0)} ชิ้น
                  </span>
                </div>
              </div>
            );
          })()}

          {/* Step 3: สรุปรายการ */}
          {orderForm.items.length>0&&(
            <div style={{background:"rgba(2,8,22,0.6)",borderRadius:10,border:`1px solid ${T.border}`,marginBottom:14,overflow:"hidden"}}>
              <div style={{padding:"8px 14px",background:"rgba(2,8,22,0.8)",borderBottom:`1px solid ${T.border}`,fontSize:10,color:T.muted,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.06em"}}>📋 สรุปรายการที่เลือก</div>
              {Object.entries(orderForm.items.reduce((acc,oi)=>{
                const k=`${oi.clothingId}-${oi.colorIdx}`;
                if(!acc[k]) acc[k]={clothingName:oi.clothingName,colorName:oi.colorName,colorHex:oi.colorHex,clothingId:oi.clothingId,colorIdx:oi.colorIdx,sizes:[]};
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
                    {g.sizes.sort((a,b)=>SIZES.indexOf(a.size)-SIZES.indexOf(b.size)).map(s=>(
                      <span key={s.size} style={{background:"rgba(14,165,233,0.1)",border:"1px solid rgba(56,189,248,0.2)",borderRadius:6,padding:"2px 8px",fontSize:11,fontFamily:"monospace",color:T.accent,fontWeight:700}}>
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

      {/* ── MODAL: เพิ่มลูกค้าใหม่ ── */}
      {showNewCustomer&&(
        <Modal onClose={()=>setShowNewCustomer(false)} w={420}>
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
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:24,paddingBottom:16,borderBottom:"2px solid #0ea5e9"}}>
                <div>
                  <div style={{fontSize:28,fontWeight:800,color:"#0369a1",letterSpacing:3,fontFamily:"monospace"}}>CPU</div>
                  <div style={{fontSize:11,color:"#64748b"}}>ระบบบริหารคลังสินค้า</div>
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontSize:20,fontWeight:700,color:"#1e293b"}}>ใบสั่งของ</div>
                  <div style={{fontSize:14,color:"#0369a1",fontFamily:"monospace",fontWeight:700}}>{showPrintOrder.orderNo}</div>
                  <div style={{fontSize:11,color:"#64748b",marginTop:4}}>{showPrintOrder.date}</div>
                </div>
              </div>

              {/* Customer info */}
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:24,padding:16,background:"#f8fafc",borderRadius:10,border:"1px solid #e2e8f0"}}>
                <div>
                  <div style={{fontSize:11,color:"#64748b",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:4}}>ลูกค้า</div>
                  <div style={{fontSize:14,fontWeight:700,color:"#1e293b"}}>{showPrintOrder.customerName}</div>
                  <div style={{fontSize:12,color:"#475569",marginTop:2}}>📞 {showPrintOrder.customerPhone||"-"}</div>
                </div>
                <div>
                  <div style={{fontSize:11,color:"#64748b",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:4}}>ที่อยู่จัดส่ง</div>
                  <div style={{fontSize:12,color:"#475569"}}>{showPrintOrder.customerAddress||"-"}</div>
                </div>
              </div>

              {/* Items table */}
              <table style={{width:"100%",borderCollapse:"collapse",marginBottom:20,fontSize:13}}>
                <thead>
                  <tr style={{background:"#0369a1",color:"white"}}>
                    <th style={{padding:"10px 12px",textAlign:"left",fontWeight:600,borderRadius:"0"}}>รุ่น</th>
                    <th style={{padding:"10px 12px",textAlign:"left",fontWeight:600}}>สี</th>
                    <th style={{padding:"10px 12px",textAlign:"center",fontWeight:600}}>ไซส์</th>
                    <th style={{padding:"10px 12px",textAlign:"center",fontWeight:600}}>จำนวน</th>
                  </tr>
                </thead>
                <tbody>
                  {(showPrintOrder.items||[]).map((oi,i)=>(
                    <tr key={i} style={{borderBottom:"1px solid #e2e8f0",background:i%2===0?"white":"#f8fafc"}}>
                      <td style={{padding:"10px 12px",fontWeight:500}}>{oi.clothingName}</td>
                      <td style={{padding:"10px 12px"}}>
                        <div style={{display:"flex",alignItems:"center",gap:6}}>
                          <div style={{width:12,height:12,borderRadius:2,background:oi.colorHex,border:"1px solid rgba(0,0,0,0.1)"}}/>
                          {oi.colorName}
                        </div>
                      </td>
                      <td style={{padding:"10px 12px",textAlign:"center",fontFamily:"monospace",fontWeight:700,color:"#0369a1"}}>{oi.size}</td>
                      <td style={{padding:"10px 12px",textAlign:"center",fontFamily:"monospace",fontWeight:700,color:"#059669"}}>{oi.qty}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{background:"#f1f5f9",fontWeight:700}}>
                    <td colSpan={3} style={{padding:"10px 12px",textAlign:"right",color:"#475569"}}>รวมทั้งหมด</td>
                    <td style={{padding:"10px 12px",textAlign:"center",fontFamily:"monospace",fontSize:16,color:"#0369a1"}}>{(showPrintOrder.items||[]).reduce((s,i)=>s+i.qty,0)} ชิ้น</td>
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
              <button onClick={()=>printElementById("print-area")} style={{padding:"9px 20px",borderRadius:9,border:"none",background:"linear-gradient(135deg,#0ea5e9,#0369a1)",color:"white",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",boxShadow:"0 4px 14px rgba(14,165,233,0.3)"}}>🖨️ สั่งปริ้น</button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: ออกบิลใหม่ ── */}
      {showNewInvoice&&(
        <Modal onClose={()=>setShowNewInvoice(false)} w={760}>
          <MHead title="🧾 ออกบิลใหม่" onClose={()=>setShowNewInvoice(false)} color={T.accent}/>

          {/* Doc type + VAT selector */}
          <div style={{display:"flex",gap:10,marginBottom:18,flexWrap:"wrap"}}>
            <div style={{flex:1}}>
              <label style={{fontSize:11,color:T.muted,display:"block",marginBottom:6,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em"}}>ประเภทเอกสาร</label>
              <div style={{display:"flex",gap:6}}>
                {[{id:"receipt",label:"🧾 ใบเสร็จ"},{id:"tax",label:"📄 ใบกำกับภาษี"},{id:"quotation",label:"📋 ใบวางบิล"}].map(t=>(
                  <button key={t.id} onClick={()=>setInvoiceDocType(t.id)}
                    style={{padding:"7px 14px",borderRadius:8,border:`1px solid ${invoiceDocType===t.id?"#38bdf8":T.border}`,background:invoiceDocType===t.id?"rgba(14,165,233,0.15)":"transparent",color:invoiceDocType===t.id?T.accent:T.sub,cursor:"pointer",fontSize:12,fontFamily:"'Sarabun',sans-serif",fontWeight:invoiceDocType===t.id?700:400,transition:"all 0.2s"}}>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            <div style={{display:"flex",alignItems:"flex-end",gap:10}}>
              <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",padding:"7px 14px",borderRadius:8,border:`1px solid ${invoiceVat?"#38bdf8":T.border}`,background:invoiceVat?"rgba(14,165,233,0.15)":"transparent"}}>
                <input type="checkbox" checked={invoiceVat} onChange={e=>setInvoiceVat(e.target.checked)} style={{cursor:"pointer"}}/>
                <span style={{fontSize:12,color:invoiceVat?T.accent:T.sub,fontWeight:invoiceVat?700:400}}>VAT {invoiceForm.vatRate}%</span>
              </label>
            </div>
          </div>

          {/* Import from order */}
          {orders.length>0&&(
            <div style={{marginBottom:16,padding:12,background:"rgba(14,165,233,0.06)",border:"1px solid rgba(56,189,248,0.2)",borderRadius:10}}>
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
          {invoiceForm.items.length>0&&(
            <div style={{background:"rgba(2,8,22,0.5)",borderRadius:10,border:`1px solid ${T.border}`,marginBottom:12,overflow:"hidden"}}>
              <div style={{display:"grid",gridTemplateColumns:"1fr 70px 90px 60px 100px 36px",padding:"8px 12px",background:"rgba(2,8,22,0.8)",borderBottom:`1px solid ${T.border}`,fontSize:10,color:T.muted,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.06em"}}>
                <div>รายการ</div><div style={{textAlign:"center"}}>จำนวน</div><div style={{textAlign:"center"}}>หน่วย</div><div style={{textAlign:"right"}}>ราคา/หน่วย</div><div style={{textAlign:"right"}}>รวม</div><div/>
              </div>
              {invoiceForm.items.map((item,i)=>(
                <div key={i} style={{display:"grid",gridTemplateColumns:"1fr 70px 90px 110px 100px 36px",alignItems:"center",padding:"7px 12px",borderBottom:i<invoiceForm.items.length-1?`1px solid ${T.border}`:"none",fontSize:12,color:T.text}}>
                  <div style={{fontWeight:500}}>{item.description}</div>
                  {/* qty — คลิกแก้ได้ */}
                  <div style={{textAlign:"center"}}>
                    <input type="number" defaultValue={item.qty} min="1"
                      onBlur={e=>{const v=Math.max(1,Number(e.target.value)||1);setInvoiceForm(f=>({...f,items:f.items.map((x,j)=>j===i?{...x,qty:v}:x)}));}}
                      onKeyDown={e=>e.key==="Enter"&&e.target.blur()}
                      style={{width:54,textAlign:"center",background:"rgba(14,165,233,0.08)",border:`1px solid ${T.border}`,borderRadius:6,color:T.text,fontFamily:"monospace",fontSize:12,padding:"4px 2px",outline:"none"}}/>
                  </div>
                  <div style={{textAlign:"center",color:T.sub,fontSize:11}}>{item.unit}</div>
                  {/* ราคา/หน่วย — คลิกแก้ได้ */}
                  <div style={{textAlign:"right"}}>
                    <div style={{display:"flex",alignItems:"center",justifyContent:"flex-end",gap:3}}>
                      <span style={{fontSize:11,color:T.muted}}>฿</span>
                      <input type="number" defaultValue={item.unitPrice} min="0" step="0.01"
                        onBlur={e=>{const v=Math.max(0,Number(e.target.value)||0);setInvoiceForm(f=>({...f,items:f.items.map((x,j)=>j===i?{...x,unitPrice:v}:x)}));}}
                        onKeyDown={e=>e.key==="Enter"&&e.target.blur()}
                        style={{width:78,textAlign:"right",background:"rgba(52,211,153,0.08)",border:"1px solid rgba(52,211,153,0.3)",borderRadius:6,color:"#34d399",fontFamily:"monospace",fontSize:12,fontWeight:600,padding:"4px 6px",outline:"none"}}/>
                    </div>
                  </div>
                  <div style={{textAlign:"right",fontFamily:"monospace",fontWeight:700,color:"#34d399"}}>฿{(item.qty*item.unitPrice).toLocaleString("th-TH",{minimumFractionDigits:2})}</div>
                  <div style={{textAlign:"center"}}><button onClick={()=>setInvoiceForm(f=>({...f,items:f.items.filter((_,j)=>j!==i)}))} style={{background:"none",border:"none",color:"#f87171",cursor:"pointer",fontSize:13}}>✕</button></div>
                </div>
              ))}
              {(()=>{const c=calcInvoice(invoiceForm.items,invoiceForm.vatRate,invoiceVat);return(
                <div style={{padding:"10px 12px",borderTop:`1px solid ${T.border}`,textAlign:"right",fontSize:12}}>
                  <div style={{color:T.sub,marginBottom:2}}>ยอดก่อนภาษี: <b style={{fontFamily:"monospace",color:T.text}}>฿{c.subtotal.toLocaleString("th-TH",{minimumFractionDigits:2})}</b></div>
                  {invoiceVat&&<div style={{color:T.sub,marginBottom:2}}>VAT {invoiceForm.vatRate}%: <b style={{fontFamily:"monospace",color:T.text}}>฿{c.vat.toLocaleString("th-TH",{minimumFractionDigits:2})}</b></div>}
                  <div style={{color:"#34d399",fontSize:14,fontWeight:700}}>ยอดรวม: <span style={{fontFamily:"monospace"}}>฿{c.total.toLocaleString("th-TH",{minimumFractionDigits:2})}</span></div>
                </div>
              )})()}
            </div>
          )}

          {/* Add item form */}
          <div style={{padding:14,background:"rgba(14,165,233,0.06)",border:"1px solid rgba(56,189,248,0.2)",borderRadius:10,marginBottom:16}}>
            <div style={{fontSize:11,color:T.accent,fontWeight:600,marginBottom:10}}>️ เพิ่มรายการสินค้า / บริการ</div>
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
              style={{width:"100%",padding:"9px",borderRadius:8,border:"none",cursor:"pointer",background:"linear-gradient(135deg,#0ea5e9,#0369a1)",color:"white",fontSize:13,fontWeight:600,fontFamily:"'Sarabun',sans-serif",opacity:(!invoiceItemForm.description||!invoiceItemForm.qty||!invoiceItemForm.unitPrice)?0.45:1,boxShadow:"0 4px 14px rgba(14,165,233,0.25)"}}>
              ✅ เพิ่มรายการนี้
            </button>
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
            <BtnGhost onClick={()=>setShowNewInvoice(false)} style={{flex:1}}>ยกเลิก</BtnGhost>
            <BtnPrimary onClick={handleConfirmInvoice} disabled={!invoiceForm.customerName||invoiceForm.items.length===0} style={{flex:2,opacity:(!invoiceForm.customerName||invoiceForm.items.length===0)?0.45:1}}>
              ✅ ออก{docTypeLabel(invoiceDocType)} + บันทึก
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
            <div id="invoice-print-area" style={{padding:"36px 44px",fontFamily:"'Sarabun',sans-serif",color:"#1e293b"}}>

              {/* ── HEADER ── */}
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:20,paddingBottom:18,borderBottom:"3px solid #0369a1"}}>
                {/* ข้อมูลบริษัท */}
                <div style={{flex:1}}>
                  <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:6}}>
                    <div style={{width:46,height:46,background:"linear-gradient(135deg,#0ea5e9,#0369a1)",borderRadius:10,display:"flex",alignItems:"center",justifyContent:"center",fontSize:24,flexShrink:0}}>{companyInfo.logo||"⚙️"}</div>
                    <div>
                      <div style={{fontSize:20,fontWeight:800,color:"#0369a1",letterSpacing:2}}>{companyInfo.name||"CPU"}</div>
                    </div>
                  </div>
                  {companyInfo.address&&<div style={{fontSize:11,color:"#475569",marginBottom:2,maxWidth:260,lineHeight:1.6}}>{companyInfo.address}</div>}
                  <div style={{display:"flex",flexWrap:"wrap",gap:14,marginTop:2}}>
                    {companyInfo.phone&&<div style={{fontSize:11,color:"#475569"}}>โทร: {companyInfo.phone}</div>}
                    {companyInfo.email&&<div style={{fontSize:11,color:"#475569"}}>{companyInfo.email}</div>}
                  </div>
                  {companyInfo.taxId&&<div style={{fontSize:11,color:"#475569",marginTop:2}}>เลขผู้เสียภาษี: {companyInfo.taxId}</div>}
                </div>

                {/* ประเภทเอกสาร + เลขที่ */}
                <div style={{textAlign:"right",minWidth:220}}>
                  <div style={{display:"inline-block",background:"#0369a1",color:"white",padding:"6px 22px",borderRadius:6,fontSize:16,fontWeight:800,marginBottom:10,letterSpacing:1}}>
                    {docTypeLabel(showPrintInvoice.docType)}
                  </div>
                  <div style={{display:"flex",flexDirection:"column",gap:4}}>
                    <div style={{display:"flex",justifyContent:"flex-end",gap:10}}>
                      <span style={{fontSize:11,color:"#64748b",fontWeight:500,minWidth:68,textAlign:"right"}}>เลขที่:</span>
                      <span style={{fontSize:13,color:"#0369a1",fontFamily:"monospace",fontWeight:700}}>{showPrintInvoice.invoiceNo}</span>
                    </div>
                    <div style={{display:"flex",justifyContent:"flex-end",gap:10}}>
                      <span style={{fontSize:11,color:"#64748b",fontWeight:500,minWidth:68,textAlign:"right"}}>วันที่ออก:</span>
                      <span style={{fontSize:12,color:"#1e293b",fontWeight:600}}>{showPrintInvoice.date}</span>
                    </div>
                    {showPrintInvoice.dueDate&&(
                      <div style={{display:"flex",justifyContent:"flex-end",gap:10}}>
                        <span style={{fontSize:11,color:"#64748b",fontWeight:500,minWidth:68,textAlign:"right"}}>ครบกำหนด:</span>
                        <span style={{fontSize:12,color:"#ef4444",fontWeight:700}}>{showPrintInvoice.dueDate}</span>
                      </div>
                    )}
                    {showPrintInvoice.useVat&&(
                      <div style={{marginTop:4,textAlign:"right"}}>
                        <span style={{padding:"2px 10px",background:"#dbeafe",borderRadius:10,fontSize:10,color:"#1d4ed8",fontWeight:700}}>มี VAT {showPrintInvoice.vatRate}%</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* ── BILL TO / FROM ── */}
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:0,marginBottom:20,border:"1px solid #e2e8f0",borderRadius:8,overflow:"hidden"}}>
                <div style={{padding:"14px 18px",background:"#f8fafc",borderRight:"1px solid #e2e8f0"}}>
                  <div style={{fontSize:9,color:"#0369a1",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:8,paddingBottom:6,borderBottom:"1px solid #e2e8f0"}}>ออกให้แก่ (Bill To)</div>
                  <div style={{fontSize:14,fontWeight:700,color:"#1e293b",marginBottom:3}}>{showPrintInvoice.customerName||"-"}</div>
                  {showPrintInvoice.customerPhone&&<div style={{fontSize:11,color:"#475569",marginBottom:2}}>โทร: {showPrintInvoice.customerPhone}</div>}
                  {showPrintInvoice.customerTaxId&&<div style={{fontSize:11,color:"#475569",marginBottom:2}}>เลขผู้เสียภาษี: {showPrintInvoice.customerTaxId}</div>}
                  {showPrintInvoice.customerAddress&&<div style={{fontSize:11,color:"#475569",lineHeight:1.6,marginTop:4}}>{showPrintInvoice.customerAddress}</div>}
                </div>
                <div style={{padding:"14px 18px",background:"#f8fafc"}}>
                  <div style={{fontSize:9,color:"#0369a1",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:8,paddingBottom:6,borderBottom:"1px solid #e2e8f0"}}>ออกโดย (From)</div>
                  <div style={{fontSize:13,fontWeight:700,color:"#1e293b",marginBottom:3}}>{companyInfo.name||"CPU"}</div>
                  {companyInfo.phone&&<div style={{fontSize:11,color:"#475569",marginBottom:2}}>โทร: {companyInfo.phone}</div>}
                  {companyInfo.email&&<div style={{fontSize:11,color:"#475569",marginBottom:2}}>{companyInfo.email}</div>}
                  {companyInfo.address&&<div style={{fontSize:11,color:"#475569",lineHeight:1.6,marginTop:4}}>{companyInfo.address}</div>}
                  {companyInfo.taxId&&<div style={{fontSize:11,color:"#475569",marginTop:2}}>เลขผู้เสียภาษี: {companyInfo.taxId}</div>}
                </div>
              </div>

              {/* ── ตารางรายการ ── */}
              <table style={{width:"100%",borderCollapse:"collapse",marginBottom:16,fontSize:12}}>
                <thead>
                  <tr style={{background:"#0369a1"}}>
                    <th style={{padding:"9px 12px",textAlign:"center",color:"white",fontWeight:700,width:36,fontSize:11}}>#</th>
                    <th style={{padding:"9px 12px",textAlign:"left",color:"white",fontWeight:700,fontSize:11}}>รายการสินค้า / บริการ</th>
                    <th style={{padding:"9px 12px",textAlign:"center",color:"white",fontWeight:700,width:60,fontSize:11}}>จำนวน</th>
                    <th style={{padding:"9px 12px",textAlign:"center",color:"white",fontWeight:700,width:60,fontSize:11}}>หน่วย</th>
                    <th style={{padding:"9px 12px",textAlign:"right",color:"white",fontWeight:700,width:100,fontSize:11}}>ราคา/หน่วย (฿)</th>
                    <th style={{padding:"9px 12px",textAlign:"right",color:"white",fontWeight:700,width:110,fontSize:11}}>จำนวนเงิน (฿)</th>
                  </tr>
                </thead>
                <tbody>
                  {(showPrintInvoice.items||[]).map((item,i)=>(
                    <tr key={i} style={{borderBottom:"1px solid #e2e8f0",background:i%2===0?"white":"#f8fafc"}}>
                      <td style={{padding:"9px 12px",textAlign:"center",color:"#94a3b8",fontSize:11}}>{i+1}</td>
                      <td style={{padding:"9px 12px",color:"#1e293b",fontWeight:500}}>{item.description}</td>
                      <td style={{padding:"9px 12px",textAlign:"center",fontFamily:"monospace",color:"#334155"}}>{item.qty}</td>
                      <td style={{padding:"9px 12px",textAlign:"center",color:"#64748b",fontSize:11}}>{item.unit}</td>
                      <td style={{padding:"9px 12px",textAlign:"right",fontFamily:"monospace",color:"#334155"}}>{Number(item.unitPrice).toLocaleString("th-TH",{minimumFractionDigits:2})}</td>
                      <td style={{padding:"9px 12px",textAlign:"right",fontFamily:"monospace",fontWeight:700,color:"#1e293b"}}>{(item.qty*item.unitPrice).toLocaleString("th-TH",{minimumFractionDigits:2})}</td>
                    </tr>
                  ))}
                  {/* padding rows เพื่อให้บิลดูสมบูรณ์ */}
                  {(showPrintInvoice.items||[]).length<5&&Array.from({length:Math.max(0,5-(showPrintInvoice.items||[]).length)}).map((_,i)=>(
                    <tr key={`pad-${i}`} style={{borderBottom:"1px solid #f1f5f9"}}>
                      <td style={{padding:"9px 12px",color:"#94a3b8",textAlign:"center",fontSize:11}}>{(showPrintInvoice.items||[]).length+i+1}</td>
                      <td colSpan={5} style={{padding:"9px 12px"}}>&nbsp;</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{background:"#f8fafc",borderTop:"2px solid #e2e8f0"}}>
                    <td colSpan={5} style={{padding:"10px 12px",textAlign:"right",fontWeight:600,fontSize:12,color:"#64748b"}}>ยอดรวมก่อนภาษี</td>
                    <td style={{padding:"10px 12px",textAlign:"right",fontFamily:"monospace",fontWeight:700,color:"#1e293b",fontSize:13}}>{(showPrintInvoice.subtotal||0).toLocaleString("th-TH",{minimumFractionDigits:2})}</td>
                  </tr>
                  {showPrintInvoice.useVat&&(
                    <tr style={{background:"#f8fafc",borderTop:"1px solid #e2e8f0"}}>
                      <td colSpan={5} style={{padding:"8px 12px",textAlign:"right",fontSize:12,color:"#64748b"}}>ภาษีมูลค่าเพิ่ม (VAT {showPrintInvoice.vatRate}%)</td>
                      <td style={{padding:"8px 12px",textAlign:"right",fontFamily:"monospace",fontWeight:600,color:"#334155"}}>{(showPrintInvoice.vat||0).toLocaleString("th-TH",{minimumFractionDigits:2})}</td>
                    </tr>
                  )}
                  <tr style={{background:"#0369a1"}}>
                    <td colSpan={5} style={{padding:"12px 14px",textAlign:"right",fontWeight:800,fontSize:14,color:"white"}}>ยอดรวมทั้งสิ้น</td>
                    <td style={{padding:"12px 14px",textAlign:"right",fontFamily:"monospace",fontWeight:800,fontSize:15,color:"white"}}>{(showPrintInvoice.total||0).toLocaleString("th-TH",{minimumFractionDigits:2})}</td>
                  </tr>
                </tfoot>
              </table>

              {/* ── หมายเหตุ ── */}
              {showPrintInvoice.note&&(
                <div style={{padding:"10px 14px",background:"#fffbeb",border:"1px solid #fde68a",borderRadius:8,fontSize:11,color:"#78350f",marginBottom:16}}>
                  <span style={{fontWeight:700}}>หมายเหตุ:</span> {showPrintInvoice.note}
                </div>
              )}

              {/* ── เส้นแบ่ง + ช่องลายเซ็น ── */}
              <div style={{marginTop:32,paddingTop:16,borderTop:"1px solid #e2e8f0"}}>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:20}}>
                  {[
                    {label:"ผู้รับเงิน / ผู้ออกเอกสาร",sub:"(Authorized Signature)"},
                    {label:"ผู้ตรวจสอบ",sub:"(Verified By)"},
                    {label:"ผู้ชำระเงิน / ผู้รับสินค้า",sub:"(Customer Signature)"},
                  ].map((sig,i)=>(
                    <div key={i} style={{textAlign:"center"}}>
                      <div style={{height:56,borderBottom:"1px dashed #cbd5e1",marginBottom:6}}/>
                      <div style={{fontSize:11,fontWeight:700,color:"#475569",marginBottom:2}}>{sig.label}</div>
                      <div style={{fontSize:9,color:"#94a3b8",marginBottom:6}}>{sig.sub}</div>
                      <div style={{fontSize:10,color:"#94a3b8",fontFamily:"monospace",letterSpacing:1}}>วันที่ ....../......./.........</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* ── footer ── */}
              <div style={{marginTop:16,paddingTop:10,borderTop:"1px solid #f1f5f9",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div style={{fontSize:9,color:"#cbd5e1"}}>เอกสารออกโดยระบบ CPU ERP · {showPrintInvoice.invoiceNo}</div>
                <div style={{fontSize:9,color:"#cbd5e1"}}>ผู้ออกเอกสาร: {showPrintInvoice.by} · {showPrintInvoice.date}</div>
              </div>
            </div>

            {/* ── ปุ่มด้านล่าง (ไม่พิมพ์) ── */}
            <div className="print-hide" style={{padding:"14px 24px",borderTop:"1px solid #e2e8f0",display:"flex",gap:10,justifyContent:"space-between",alignItems:"center",background:"#f8fafc",borderRadius:"0 0 16px 16px"}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <span style={{fontSize:12,color:"#64748b",fontWeight:500}}>ขนาดกระดาษ:</span>
                <div style={{display:"flex",gap:6}}>
                  {[
                    {id:"A4",label:"A4",size:"A4 portrait",margin:"10mm"},
                    {id:"80mm",label:"80mm (สลิป)",size:"80mm auto",margin:"2mm 4mm"},
                    {id:"57mm",label:"57mm (ม้วน)",size:"57mm auto",margin:"1mm 3mm"},
                  ].map(p=>(
                    <button key={p.id}
                      onClick={()=>printElementById("invoice-print-area",p.size,p.margin)}
                      style={{padding:"6px 12px",borderRadius:7,border:"1px solid #e2e8f0",background:"white",color:"#475569",fontSize:11,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontWeight:500}}>
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{display:"flex",gap:10}}>
                <button onClick={()=>setShowPrintInvoice(null)} style={{padding:"9px 20px",borderRadius:9,border:"1px solid #e2e8f0",background:"white",color:"#64748b",fontSize:13,cursor:"pointer",fontFamily:"'Sarabun',sans-serif"}}>ปิด</button>
                <button onClick={()=>printElementById("invoice-print-area")} style={{padding:"9px 20px",borderRadius:9,border:"none",background:"linear-gradient(135deg,#0ea5e9,#0369a1)",color:"white",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",boxShadow:"0 4px 14px rgba(14,165,233,0.3)"}}>🖨️ พิมพ์เอกสาร</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: เพิ่มรุ่นเสื้อผ้า ── */}
      {showAddClothing&&(
        <Modal onClose={()=>{setShowAddClothing(false);setNewModel("");}} w={420}>
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

      {/* ── MODAL: ตั้งราคาตามไซส์ ── */}
      {priceModal&&(()=>{
        const item = clothingItems.find(i=>i.id===priceModal.itemId);
        const col = item?.colors?.[priceModal.ci];
        if(!item||!col) return null;
        const handleSavePrices = async () => {
          const salePrices = {};
          SIZE_GROUPS.forEach(g => { salePrices[g.key] = Number(priceForm[g.key]) || 0; });
          const defaultPrice = salePrices.reg || salePrices.kids || Object.values(salePrices).find(v=>v>0) || 0;
          const newColors = item.colors.map((c,i)=>i===priceModal.ci?{
            ...c,
            costPrice: Number(priceForm.costPrice) || 0,
            salePrice: defaultPrice,
            salePrices,
          }:c);
          await updateDoc(doc(db,"clothing",priceModal.itemId),{colors:newColors});
          setPriceModal(null);
        };
        return (
          <Modal onClose={()=>setPriceModal(null)} w={460}>
            <MHead title="💰 ตั้งราคาตามไซส์" onClose={()=>setPriceModal(null)}/>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:14,padding:"8px 12px",background:"rgba(14,165,233,0.06)",borderRadius:8,border:`1px solid ${T.border}`}}>
              <div style={{width:14,height:14,borderRadius:3,background:col.hex,border:"1px solid rgba(255,255,255,0.15)"}}/>
              <span style={{fontSize:13,color:T.text,fontWeight:600}}>{item.model} · {col.colorName}</span>
            </div>
            <div style={{marginBottom:12}}>
              <label style={{fontSize:11,color:T.muted,display:"block",marginBottom:5,fontWeight:600}}>ราคาทุน (฿/ชิ้น)</label>
              <input type="number" value={priceForm.costPrice} onChange={e=>setPriceForm(f=>({...f,costPrice:e.target.value}))} placeholder="0"
                style={{width:"100%",background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:8,padding:"8px 12px",fontFamily:"monospace",fontSize:13,outline:"none"}}/>
            </div>
            <div style={{fontSize:11,color:T.muted,marginBottom:8,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em"}}>ราคาขาย (฿/ชิ้น) ตามกลุ่มไซส์</div>
            <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:18}}>
              {SIZE_GROUPS.map(g=>(
                <div key={g.key} style={{display:"grid",gridTemplateColumns:"120px 1fr",alignItems:"center",gap:10,padding:"6px 10px",background:"rgba(2,8,22,0.5)",borderRadius:7,border:`1px solid ${T.border}`}}>
                  <span style={{fontSize:12,color:T.accent,fontWeight:600}}>{g.label}</span>
                  <input type="number" value={priceForm[g.key]} onChange={e=>setPriceForm(f=>({...f,[g.key]:e.target.value}))} placeholder="0"
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

      {/* ── MODAL: เพิ่มสีเสื้อผ้า ── */}
      {showAddColor&&(
        <Modal onClose={()=>{setShowAddColor(null);setCustomColorName("");setNewColorHex("#ffffff");}} w={480}>
          <MHead title="🎨 เพิ่มสีใหม่" onClose={()=>{setShowAddColor(null);setCustomColorName("");setNewColorHex("#ffffff");}}/>
          <div style={{fontSize:11,color:T.muted,marginBottom:10,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em"}}>เลือกสีที่มี</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:18}}>
            {PRESET_COLORS.map(c=>{
              const item=clothingItems.find(i=>i.id===showAddColor);
              const already=(item?.colors||[]).some(cl=>cl.colorName===c.name);
              return (
                <div key={c.name} onClick={()=>!already&&handleAddColorToItem(showAddColor,{colorName:c.name,hex:c.hex})}
                  style={{display:"flex",alignItems:"center",gap:6,padding:"6px 12px",borderRadius:20,border:`1px solid ${already?"rgba(13,40,72,0.5)":"rgba(56,189,248,0.25)"}`,cursor:already?"not-allowed":"pointer",background:already?"rgba(13,40,72,0.3)":"rgba(14,165,233,0.08)",opacity:already?0.4:1,transition:"all 0.2s"}}
                  onMouseEnter={e=>{if(!already)e.currentTarget.style.background="rgba(14,165,233,0.18)";}}
                  onMouseLeave={e=>{if(!already)e.currentTarget.style.background="rgba(14,165,233,0.08)";}}>
                  <div style={{width:12,height:12,borderRadius:3,background:c.hex,border:"1px solid rgba(255,255,255,0.2)"}}/>
                  <span style={{fontSize:12,color:already?T.muted:T.text,fontFamily:"'Sarabun',sans-serif"}}>{c.name}</span>
                  {already&&<span style={{fontSize:9,color:T.muted}}>✓</span>}
                </div>
              );
            })}
          </div>
          <div style={{padding:14,background:"rgba(4,18,44,0.6)",borderRadius:10,border:`1px solid ${T.border}`,marginBottom:16}}>
            <div style={{fontSize:11,color:T.muted,marginBottom:10,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em"}}>หรือเพิ่มสีเอง</div>
            <div style={{display:"flex",gap:10,alignItems:"center"}}>
              <input type="color" value={newColorHex} onChange={e=>setNewColorHex(e.target.value)} style={{width:40,height:36,borderRadius:8,border:`1px solid ${T.border}`,cursor:"pointer",background:"transparent",padding:2}}/>
              <input value={customColorName} onChange={e=>setCustomColorName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&customColorName.trim()&&handleAddColorToItem(showAddColor,{colorName:customColorName.trim(),hex:newColorHex})} placeholder="ชื่อสี เช่น เทา, กรมท่า..."
                style={{flex:1,background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:9,padding:"9px 14px",fontFamily:"'Sarabun',sans-serif",fontSize:13,outline:"none"}}/>
              <BtnPrimary onClick={()=>customColorName.trim()&&handleAddColorToItem(showAddColor,{colorName:customColorName.trim(),hex:newColorHex})} disabled={!customColorName.trim()}>เพิ่ม</BtnPrimary>
            </div>
          </div>
          <BtnGhost onClick={()=>{setShowAddColor(null);setCustomColorName("");setNewColorHex("#ffffff");}} style={{width:"100%"}}>ปิด</BtnGhost>
        </Modal>
      )}

      {/* ── MODAL: รับ/จ่ายเสื้อผ้า ── */}
      {clothingTxModal&&(
        <Modal onClose={()=>setClothingTxModal(null)} w={440}>
          <MHead title={clothingTxType==="รับ"?"⬇️ รับเสื้อผ้าเข้าคลัง":"⬆️ จ่ายเสื้อผ้าออกคลัง"} onClose={()=>setClothingTxModal(null)} color={clothingTxType==="รับ"?T.green:T.red}/>
          {clothingTxSuccess&&<Toast msg="บันทึกสำเร็จ! ตัดสต็อกแล้ว"/>}
          <div style={{padding:14,background:"rgba(14,165,233,0.06)",border:`1px solid rgba(56,189,248,0.2)`,borderRadius:10,marginBottom:16}}>
            <div style={{fontSize:12,color:T.accent,fontWeight:600}}>{clothingTxModal.item.model}</div>
            <div style={{fontSize:11,color:T.sub,marginTop:2,display:"flex",alignItems:"center",gap:8}}>
              <div style={{width:10,height:10,borderRadius:2,background:(clothingTxModal.item.colors[clothingTxModal.colorIdx]||{}).hex}}/>
              {(clothingTxModal.item.colors[clothingTxModal.colorIdx]||{}).colorName}
            </div>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            <div>
              <label style={{fontSize:11,color:T.muted,display:"block",marginBottom:6,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em"}}>ไซส์ *</label>
              <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                {SIZES.map(sz=>{
                  const stock=((clothingTxModal.item.colors[clothingTxModal.colorIdx]||{}).stock||{})[sz]||0;
                  const selected=clothingTxModal.size===sz;
                  return (
                    <button key={sz} onClick={()=>setClothingTxModal(p=>({...p,size:sz}))}
                      style={{padding:"6px 12px",borderRadius:8,border:`1px solid ${selected?"#38bdf8":"rgba(13,40,72,0.8)"}`,background:selected?"rgba(14,165,233,0.2)":"rgba(4,18,44,0.6)",color:selected?"#38bdf8":T.sub,cursor:"pointer",fontSize:12,fontFamily:"'Sarabun',sans-serif",fontWeight:selected?700:400,transition:"all 0.15s"}}>
                      <div style={{fontWeight:700}}>{sz}</div>
                      <div style={{fontSize:9,color:stock===0?"#1e4060":stock<5?"#fbbf24":"#22d3ee",fontFamily:"monospace"}}>{stock}</div>
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <label style={{fontSize:11,color:T.muted,display:"block",marginBottom:6,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em"}}>จำนวน *</label>
              <input type="number" placeholder="0" value={clothingTxQty} onChange={e=>setClothingTxQty(e.target.value)}
                style={{width:"100%",background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:9,padding:"9px 14px",fontFamily:"'Sarabun',sans-serif",fontSize:13,outline:"none"}}/>
              {clothingTxModal.size&&<div style={{fontSize:11,color:T.sub,marginTop:4}}>สต็อกปัจจุบัน: <b style={{color:T.accent}}>{((clothingTxModal.item.colors[clothingTxModal.colorIdx]||{}).stock||{})[clothingTxModal.size]||0} ชิ้น</b></div>}
            </div>
            <div>
              <label style={{fontSize:11,color:T.muted,display:"block",marginBottom:6,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em"}}>หมายเหตุ</label>
              <input placeholder="ระบุหมายเหตุ (ถ้ามี)" value={clothingTxNote} onChange={e=>setClothingTxNote(e.target.value)}
                style={{width:"100%",background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:9,padding:"9px 14px",fontFamily:"'Sarabun',sans-serif",fontSize:13,outline:"none"}}/>
            </div>
            <div style={{display:"flex",gap:10}}>
              <BtnGhost onClick={()=>setClothingTxModal(null)} style={{flex:1}}>ยกเลิก</BtnGhost>
              {clothingTxType==="รับ"
                ?<BtnSuccess onClick={handleClothingTx} disabled={!clothingTxModal.size||!clothingTxQty||Number(clothingTxQty)<=0} style={{flex:1}}>✅ ยืนยันรับสินค้า</BtnSuccess>
                :<BtnDanger onClick={handleClothingTx} disabled={!clothingTxModal.size||!clothingTxQty||Number(clothingTxQty)<=0} style={{flex:1}}>✅ ยืนยันจ่ายสินค้า</BtnDanger>
              }
            </div>
          </div>
        </Modal>
      )}

      {/* ── MODAL: ยืนยันลบ User ── */}
      {showDeleteUserConfirm&&(
        <Modal onClose={()=>setShowDeleteUserConfirm(null)} w={360}>
          <div style={{textAlign:"center"}}>
            <div style={{fontSize:42,marginBottom:12}}>{showDeleteUserConfirm.avatar}</div>
            <div style={{fontSize:15,fontWeight:700,color:T.text,marginBottom:6}}>ลบบัญชีผู้ใช้?</div>
            <div style={{fontSize:13,color:T.sub,marginBottom:4}}>{showDeleteUserConfirm.name}</div>
            <div style={{fontSize:12,color:T.muted,marginBottom:6}}>@{showDeleteUserConfirm.username}</div>
            <div style={{marginBottom:20}}>
              <Badge bg={`${ROLES[showDeleteUserConfirm.role].color}15`} color={ROLES[showDeleteUserConfirm.role].color}>{ROLES[showDeleteUserConfirm.role].label}</Badge>
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


