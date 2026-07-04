import { useState, useEffect } from "react";
import { db } from "../firebase";
import { collection, onSnapshot, doc, query, orderBy, limit, writeBatch, setDoc } from "firebase/firestore";
import { INIT_USERS, INIT_CATS } from "../constants";

// 🚀 จำกัดจำนวน doc ที่ subscribe real-time — โหลดเร็วขึ้น + ประหยัด Firestore reads
// ใช้ rolling window (เรียงใหม่→เก่า) — พอสำหรับงานประจำวัน + รายงาน 30 วัน
// ⚙️ ปรับตัวเลขตรงนี้ได้ทันที ถ้าอยากเห็นย้อนหลังมากขึ้น
const LIMITS = {
  transactions: 2000,      // รับ/จ่าย/ขาย — รายงานใช้แค่กราฟ 30 วัน
  invoices: 1000,          // บิล
  orders: 1000,            // ใบสั่งของ
  productionOrders: 1000,  // ใบสั่งผลิต
  customOrders: 800,       // ใบสั่งผลิต custom
  catalogOrders: 400,      // สั่งจากหน้า catalog
  statements: 500,         // ใบแจ้งยอด
  payrollRuns: 200,        // รอบเงินเดือน
  pendingMixSales: 300,    // ขายคละที่รอระบุ
};

export function useFirestore() {
  const [users, setUsers] = useState(INIT_USERS);
  const [usersLoaded, setUsersLoaded] = useState(false); // 🔐 true เมื่อ Firestore ตอบกลับจริง (กัน race "ไม่พบบัญชี")
  const [products, setProducts] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [categories, setCategories] = useState(INIT_CATS);
  const [clothingItems, setClothingItems] = useState([]);
  const [orders, setOrders] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [statements, setStatements] = useState([]);
  const [companyInfo, setCompanyInfo] = useState({ name:"CPU", address:"", phone:"", email:"", taxId:"", logo:"⚙️" });
  const [roleLabels, setRoleLabels] = useState({}); // {admin:"...", manager:"...", staff:"..."}
  const [auditLogs, setAuditLogs] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [taxDocs, setTaxDocs] = useState([]);
  const [productionOrders, setProductionOrders] = useState([]);
  const [boms, setBoms] = useState([]);
  const [customOrders, setCustomOrders] = useState([]);
  const [catalogOrders, setCatalogOrders] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [payrollRuns, setPayrollRuns] = useState([]);
  const [customSizes, setCustomSizes] = useState({ apparel: [], shoe: [] }); // 📏 ไซส์ที่ผู้ใช้เพิ่มเอง
  const [pendingMixSales, setPendingMixSales] = useState([]); // 🕐 ขายคละที่รอระบุสี/ไซส์
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 🛡️ ห้าม auto-overwrite ด้วย INIT_USERS!
    // เดิม: ถ้า snap.empty → batch.set(INIT_USERS) → กรณี permission-denied transient
    // ทำให้รหัสผ่านของ user ถูก RESET กลับเป็น "1234" และ login ไม่ได้
    // แก้: ถ้า empty (จากปัญหา network/permission) → ไม่ทำอะไร, users state เก็บค่าเดิมไว้
    let initialChecked = false;
    const unsub = onSnapshot(collection(db, "users"), snap => {
      if (snap.empty) {
        // ครั้งแรกที่ subscribe + จริงๆ ว่าง → ใช้ INIT_USERS เป็น fallback (local only)
        // แต่ "ห้าม" เขียน Firestore — ป้องกัน race condition ทับข้อมูลจริง
        if (!initialChecked) {
          setUsers(INIT_USERS);
          // 🔐 ไม่ setUsersLoaded(true) — รอจริง ๆ ก่อน (กัน LoginPage แสดง "ไม่พบบัญชี" ตอน Firestore ยังไม่ตอบ)
        }
      } else {
        setUsers(snap.docs.map(d => ({ ...d.data(), id: d.id })));
        setUsersLoaded(true); // ✅ มีข้อมูลจริงแล้ว
      }
      initialChecked = true;
    }, (err) => {
      console.warn("[users] subscription error:", err);
      // permission-denied/network error → ใช้ค่าเดิม ไม่ overwrite อะไร
    });
    // fallback timer — ถ้า 5 วินาทียัง empty → set loaded = true (อนุญาตให้ login ด้วย INIT_USERS)
    const fallbackTimer = setTimeout(() => setUsersLoaded(true), 5000);
    return () => { unsub(); clearTimeout(fallbackTimer); };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 6000);
    const unsub = onSnapshot(
      collection(db, "products"),
      snap => { setProducts(snap.docs.map(d => ({...d.data(), id:d.id}))); setLoading(false); clearTimeout(timer); },
      err  => { console.warn("Products error:", err); setLoading(false); clearTimeout(timer); }
    );
    return () => { unsub(); clearTimeout(timer); };
  }, []);

  useEffect(() => {
    const q = query(collection(db, "transactions"), orderBy("createdAt", "desc"), limit(LIMITS.transactions));
    const unsub = onSnapshot(q, snap => setTransactions(snap.docs.map(d => ({ ...d.data(), id: d.id }))));
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, "settings", "categories"), snap => {
      if (snap.exists()) setCategories(snap.data().list || INIT_CATS);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "clothing"), snap => {
      setClothingItems(snap.docs.map(d => ({ ...d.data(), id: d.id })));
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const q = query(collection(db, "orders"), orderBy("createdAt","desc"), limit(LIMITS.orders));
    const unsub = onSnapshot(q, snap => setOrders(snap.docs.map(d => ({...d.data(), id:d.id}))));
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "customers"), snap => setCustomers(snap.docs.map(d => ({...d.data(), id:d.id}))));
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "suppliers"), snap => setSuppliers(snap.docs.map(d => ({ ...d.data(), id: d.id }))));
    return () => unsub();
  }, []);

  useEffect(() => {
    const q = query(collection(db, "invoices"), orderBy("createdAt","desc"), limit(LIMITS.invoices));
    const unsub = onSnapshot(q, snap => setInvoices(snap.docs.map(d=>({...d.data(),id:d.id}))), ()=>{});
    return () => unsub();
  }, []);

  useEffect(() => {
    const q = query(collection(db, "statements"), orderBy("createdAt","desc"), limit(LIMITS.statements));
    const unsub = onSnapshot(q, snap => setStatements(snap.docs.map(d=>({...d.data(),id:d.id}))), ()=>{});
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(doc(db,"settings","company"), snap => {
      if(snap.exists()) setCompanyInfo(snap.data());
    }, ()=>{});
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(doc(db,"settings","roleLabels"), snap => {
      if(snap.exists()) setRoleLabels(snap.data());
    }, ()=>{});
    return () => unsub();
  }, []);

  // Audit logs — เอามาแค่ 500 รายการล่าสุด (กัน load หนัก)
  useEffect(() => {
    const q = query(collection(db, "auditLog"), orderBy("timestamp", "desc"), limit(500));
    const unsub = onSnapshot(q, snap => setAuditLogs(snap.docs.map(d => ({ ...d.data(), id: d.id }))), ()=>{});
    return () => unsub();
  }, []);

  // Employees (พนักงาน + work permit)
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "employees"), snap => setEmployees(snap.docs.map(d => ({ ...d.data(), id: d.id }))), ()=>{});
    return () => unsub();
  }, []);

  // Tax Docs
  useEffect(() => {
    const q = query(collection(db, "taxDocs"), orderBy("date","desc"));
    const unsub = onSnapshot(q, snap => setTaxDocs(snap.docs.map(d => ({ ...d.data(), id: d.id }))), ()=>{});
    return () => unsub();
  }, []);

  // Production orders
  useEffect(() => {
    const q = query(collection(db, "productionOrders"), orderBy("createdAt","desc"), limit(LIMITS.productionOrders));
    const unsub = onSnapshot(q, snap => setProductionOrders(snap.docs.map(d => ({...d.data(), id:d.id}))), ()=>{});
    return () => unsub();
  }, []);

  // BOMs (สูตรวัตถุดิบ)
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "boms"), snap => setBoms(snap.docs.map(d => ({...d.data(), id:d.id}))), ()=>{});
    return () => unsub();
  }, []);

  // Custom orders (ผลิตเฉพาะแบบ — ไม่ตัดสต็อกวัตถุดิบ/สินค้า)
  useEffect(() => {
    const q = query(collection(db, "customOrders"), orderBy("createdAt","desc"), limit(LIMITS.customOrders));
    const unsub = onSnapshot(q, snap => setCustomOrders(snap.docs.map(d => ({...d.data(), id:d.id}))), ()=>{});
    return () => unsub();
  }, []);

  // Catalog orders — สั่งจาก /catalog (public)
  useEffect(() => {
    const q = query(collection(db, "catalogOrders"), orderBy("createdAt","desc"), limit(LIMITS.catalogOrders));
    const unsub = onSnapshot(q, snap => setCatalogOrders(snap.docs.map(d => ({...d.data(), id:d.id}))), ()=>{});
    return () => unsub();
  }, []);

  // 📅 Attendance — บันทึกเวลาเข้างานพนักงาน (per day)
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "attendance"),
      snap => setAttendance(snap.docs.map(d => ({...d.data(), id:d.id}))),
      ()=>{});
    return () => unsub();
  }, []);

  // 💰 Payroll runs — รอบจ่ายเงินเดือน
  useEffect(() => {
    const q = query(collection(db, "payrollRuns"), orderBy("createdAt","desc"), limit(LIMITS.payrollRuns));
    const unsub = onSnapshot(q, snap => setPayrollRuns(snap.docs.map(d => ({...d.data(), id:d.id}))), ()=>{});
    return () => unsub();
  }, []);

  // 📏 Custom sizes — ไซส์เสื้อผ้า/รองเท้าที่ผู้ใช้เพิ่มเอง (settings/sizes)
  useEffect(() => {
    const q = query(collection(db, "pendingMixSales"), orderBy("createdAt","desc"), limit(LIMITS.pendingMixSales));
    const unsub = onSnapshot(q, snap => setPendingMixSales(snap.docs.map(d => ({...d.data(), id:d.id}))), ()=>{});
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, "settings", "sizes"), snap => {
      if (snap.exists()) {
        const d = snap.data();
        setCustomSizes({ apparel: d.apparel || [], shoe: d.shoe || [] });
      }
    }, ()=>{});
    return () => unsub();
  }, []);

  return {
    users, setUsers, usersLoaded,
    suppliers,
    products, setProducts,
    transactions,
    categories, setCategories,
    clothingItems,
    orders,
    customers,
    invoices,
    statements,
    companyInfo, setCompanyInfo,
    roleLabels,
    auditLogs,
    productionOrders,
    boms,
    customOrders,
    catalogOrders,
    attendance,
    payrollRuns,
    customSizes,
    pendingMixSales,
    employees,
    taxDocs,
    loading, setLoading,
  };
}
