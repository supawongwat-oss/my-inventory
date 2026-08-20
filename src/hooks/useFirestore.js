import { useState, useEffect } from "react";
import { db } from "../firebase";
import { collection, onSnapshot, doc, query, where, orderBy, limit, writeBatch, setDoc, Timestamp } from "firebase/firestore";
import { INIT_USERS, INIT_CATS } from "../constants";

// เที่ยงคืนของ N วันก่อน — ใช้เป็นจุดเริ่มช่วงโหลดใบสั่งของ
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

// 🚀 จำกัดจำนวน doc ที่ subscribe real-time — โหลดเร็วขึ้น + ประหยัด Firestore reads
// ใช้ rolling window (เรียงใหม่→เก่า) — พอสำหรับงานประจำวัน + รายงาน 30 วัน
// ⚙️ ปรับตัวเลขตรงนี้ได้ทันที ถ้าอยากเห็นย้อนหลังมากขึ้น
const LIMITS = {
  transactions: 500,       // รับ/จ่าย/ขาย — รายงาน/ขายวันนี้ query ตามวันเองแล้ว (live ใช้แค่ dashboard + tab ประวัติ)
  ordersCap: 4000,         // 🛡️ เพดานกันเผลอเลือกช่วงกว้างเกิน (ปกติโหลดตามช่วงวันที่)
  invoicesCap: 3000,       // 🛡️ เพดานของบิล (ปกติโหลดตามช่วงวันที่)
  catalogCap: 1500,        // 🛡️ เพดานของ catalog inbox (ปกติโหลดตามช่วงวันที่)
  productionOrders: 1000,  // ใบสั่งผลิต
  customOrders: 800,       // ใบสั่งผลิต custom
  statements: 500,         // ใบแจ้งยอด
  returns: 500,            // ใบรับคืนสินค้า
  payrollRuns: 200,        // รอบเงินเดือน
  pendingMixSales: 300,    // ขายคละที่รอระบุ
  auditLogs: 500,          // ประวัติการใช้งาน
  taxDocs: 1000,           // เอกสารภาษี (เดิมไม่มีเพดาน)
  attendance: 8000,        // ลงเวลา ≈ 1 ปีที่พนักงาน 20 คน (เดิมไม่มีเพดาน)
};

// 📅 ช่วงเริ่มต้นของแต่ละคอลเลกชัน (วัน)
// ⚠️ ที่ 200-400 ใบ/วัน "เพดานจำนวนใบ" ใช้ไม่ได้ — 1,000 ใบ = แค่ 3 วัน แล้วใบเก่าหายเงียบ ๆ
//    เปลี่ยนเป็นโหลดตามช่วงวันที่ทั้งหมด + เตือนเมื่อชนเพดาน + ให้ผู้ใช้ขยายช่วงเองได้
const DEFAULT_DAYS = {
  orders: 2,      // ใบสั่งของ — งานประจำวันดูแค่วันนี้/เมื่อวาน (กดขยายได้)
  invoices: 30,   // บิล — ต้องพอสำหรับรายงาน/ตามหนี้เดือนปัจจุบัน
  catalog: 30,    // inbox จากหน้า catalog
};

export function useFirestore(activeTab = "") {
  const [users, setUsers] = useState(INIT_USERS);
  const [usersLoaded, setUsersLoaded] = useState(false); // 🔐 true เมื่อ Firestore ตอบกลับจริง (กัน race "ไม่พบบัญชี")
  const [products, setProducts] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [categories, setCategories] = useState(INIT_CATS);
  const [clothingItems, setClothingItems] = useState([]);
  const [orders, setOrders] = useState([]);
  // 📅 ช่วงวันที่ของใบสั่งของที่กำลังโหลด — เริ่มต้น 7 วันล่าสุด, เปลี่ยนได้จากหน้าใบสั่งของ
  const [ordersRange, setOrdersRange] = useState(() => ({ from: daysAgo(DEFAULT_DAYS.orders), to: null }));
  const [ordersCapped, setOrdersCapped] = useState(false);
  const [customers, setCustomers] = useState([]);
  const [invoices, setInvoices] = useState([]);
  // 📅 ช่วงวันที่ของบิลที่กำลังโหลด — เริ่มต้น 30 วัน, ขยายได้จากหน้าออกบิล/รายงาน
  const [invoicesRange, setInvoicesRange] = useState(() => ({ from: daysAgo(DEFAULT_DAYS.invoices), to: null }));
  const [invoicesCapped, setInvoicesCapped] = useState(false);
  const [statements, setStatements] = useState([]);
  const [returns, setReturns] = useState([]);
  const [companyInfo, setCompanyInfo] = useState({ name:"CPU", address:"", phone:"", email:"", taxId:"", logo:"⚙️" });
  const [roleLabels, setRoleLabels] = useState({}); // {admin:"...", manager:"...", staff:"..."}
  const [auditLogs, setAuditLogs] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [taxDocs, setTaxDocs] = useState([]);
  const [productionOrders, setProductionOrders] = useState([]);
  const [boms, setBoms] = useState([]);
  const [customOrders, setCustomOrders] = useState([]);
  const [catalogOrders, setCatalogOrders] = useState([]);
  const [catalogRange, setCatalogRange] = useState(() => ({ from: daysAgo(DEFAULT_DAYS.catalog), to: null }));
  const [catalogCapped, setCatalogCapped] = useState(false);
  const [attendance, setAttendance] = useState([]);
  const [payrollRuns, setPayrollRuns] = useState([]);
  const [customSizes, setCustomSizes] = useState({ apparel: [], shoe: [] }); // 📏 ไซส์ที่ผู้ใช้เพิ่มเอง
  const [pendingMixSales, setPendingMixSales] = useState([]); // 🕐 ขายคละที่รอระบุสี/ไซส์
  const [loading, setLoading] = useState(true);
  // 🚀 หน่วงโหลดข้อมูลหนัก (ผลิต/บิล/ลูกค้า ฯลฯ) ให้หน้าแรก (login/dashboard) ขึ้นก่อน
  // critical (users/products/transactions/settings) โหลดทันที · ที่เหลือเริ่มหลัง ~250ms
  const [deferReady, setDeferReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setDeferReady(true), 250);
    return () => clearTimeout(t);
  }, []);

  // 🏭 ข้อมูลผลิต (ใบสั่งผลิต/custom — custom ฝังรูป base64 หนักมาก) โหลดเฉพาะตอนเข้าโซนผลิตครั้งแรก
  // แล้ว "ค้าง" ไว้ทั้ง session (sticky) — หน้าแรกจะได้ไม่ต้องดาวน์โหลดก้อนนี้เลย
  const [prodLoaded, setProdLoaded] = useState(false);
  useEffect(() => {
    if (["production", "productionHistory", "employees"].includes(activeTab)) setProdLoaded(true);
  }, [activeTab]);
  const prodReady = deferReady && prodLoaded;

  // 🚪 คอลเลกชันที่ใช้แค่ในแท็บของตัวเอง — เริ่มโหลดตอนเปิดแท็บนั้นครั้งแรก
  //    แล้ว "ค้าง" ไว้ทั้ง session (กลับมาดูอีกไม่ต้องรอโหลดใหม่)
  //
  // ทำไม: เดิม subscribe ทุกอันตั้งแต่เปิดแอป ทั้งที่พนักงานส่วนใหญ่ไม่เคยเข้าแท็บพวกนี้เลย
  //       แท็บเล็ตต้องดาวน์โหลด+ถือไว้ในหน่วยความจำฟรี ๆ → เปิดแอปครั้งแรกค้าง
  //       ที่หนักสุดคือ attendance กับ taxDocs ซึ่ง "ไม่มีเพดานเลย" และโตขึ้นทุกวัน
  const [visitedTabs, setVisitedTabs] = useState(() => new Set());
  useEffect(() => {
    if (!activeTab) return;
    setVisitedTabs(prev => (prev.has(activeTab) ? prev : new Set(prev).add(activeTab)));
  }, [activeTab]);
  // เคยเปิดแท็บใดแท็บหนึ่งในรายการนี้หรือยัง
  const visited = (...tabs) => deferReady && tabs.some(t => visitedTabs.has(t));

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
    // ⏱️ เดิม 6 วิ — นานเกินสำหรับแท็บเล็ต/เน็ตช้า (ค้างหน้าโลโก้)
    // 2.5 วิ พอ: ถ้าสินค้ายังมาไม่ครบ ก็เข้าแอปไปก่อน แล้ว snapshot จะเติมให้เองแบบ real-time
    const timer = setTimeout(() => setLoading(false), 2500);
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
    if (!deferReady) return;
    const unsub = onSnapshot(collection(db, "clothing"), snap => {
      setClothingItems(snap.docs.map(d => ({ ...d.data(), id: d.id })));
    });
    return () => unsub();
  }, [deferReady]);

  // 📅 ใบสั่งของ — โหลด "ตามช่วงวันที่" ไม่ใช่ "N ใบล่าสุด"
  // ที่ 200-300 ใบ/วัน การ limit จำนวนใบทำให้เห็นย้อนหลังได้แค่ 3-4 วัน
  // และค้นหาใบเก่าไม่เจอโดยไม่มีอะไรเตือน → เปลี่ยนเป็น query ตามช่วงวันที่แทน
  useEffect(() => {
    if (!deferReady) return;
    const clauses = [where("createdAt", ">=", Timestamp.fromDate(ordersRange.from))];
    if (ordersRange.to) clauses.push(where("createdAt", "<=", Timestamp.fromDate(ordersRange.to)));
    const q = query(collection(db, "orders"), ...clauses, orderBy("createdAt","desc"), limit(LIMITS.ordersCap));
    const unsub = onSnapshot(q, snap => {
      setOrders(snap.docs.map(d => ({...d.data(), id:d.id})));
      // ชนเพดาน = ในช่วงนี้มีมากกว่าที่โหลดไหว → ต้องบอกผู้ใช้ ไม่ใช่เงียบ
      setOrdersCapped(snap.size >= LIMITS.ordersCap);
    });
    return () => unsub();
    // ใช้ค่าเวลา ไม่ใช่ object — กัน re-subscribe ทุก render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deferReady, ordersRange.from?.getTime(), ordersRange.to?.getTime()]);

  useEffect(() => {
    if (!deferReady) return;
    const unsub = onSnapshot(collection(db, "customers"), snap => setCustomers(snap.docs.map(d => ({...d.data(), id:d.id}))));
    return () => unsub();
  }, [deferReady]);

  useEffect(() => {
    if (!deferReady) return;
    const unsub = onSnapshot(collection(db, "suppliers"), snap => setSuppliers(snap.docs.map(d => ({ ...d.data(), id: d.id }))));
    return () => unsub();
  }, [deferReady]);

  // 📅 บิล — โหลดตามช่วงวันที่ (เดิม limit 1000 ใบ = ที่ 200-400 ใบ/วัน เห็นย้อนหลังได้แค่ 3 วัน
  //    แล้วบิลเก่าหายจากรายงาน/ตามหนี้โดยไม่มีอะไรเตือน)
  useEffect(() => {
    if (!deferReady) return;
    const clauses = [where("createdAt", ">=", Timestamp.fromDate(invoicesRange.from))];
    if (invoicesRange.to) clauses.push(where("createdAt", "<=", Timestamp.fromDate(invoicesRange.to)));
    const q = query(collection(db, "invoices"), ...clauses, orderBy("createdAt","desc"), limit(LIMITS.invoicesCap));
    const unsub = onSnapshot(q, snap => {
      setInvoices(snap.docs.map(d=>({...d.data(),id:d.id})));
      setInvoicesCapped(snap.size >= LIMITS.invoicesCap);
    }, ()=>{});
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deferReady, invoicesRange.from?.getTime(), invoicesRange.to?.getTime()]);

  // 🚪 ใบแจ้งยอด — ใช้เฉพาะแท็บ "วางบิลเก็บเงิน"
  const stmtReady = visited("statements");
  useEffect(() => {
    if (!stmtReady) return;
    const q = query(collection(db, "statements"), orderBy("createdAt","desc"), limit(LIMITS.statements));
    const unsub = onSnapshot(q, snap => setStatements(snap.docs.map(d=>({...d.data(),id:d.id}))), ()=>{});
    return () => unsub();
  }, [stmtReady]);

  // ↩️ ใบรับคืนสินค้า — จำนวนน้อย แต่ต้องเห็นได้จากหลายที่ (แท็บรับคืน + ยอดสุทธิในบิล)
  //    จึงโหลดพร้อมกับชุดหลัก ไม่ผูกกับการเข้าแท็บ
  useEffect(() => {
    if (!deferReady) return;
    const q = query(collection(db, "returns"), orderBy("createdAt","desc"), limit(LIMITS.returns));
    const unsub = onSnapshot(q, snap => setReturns(snap.docs.map(d=>({...d.data(),id:d.id}))), ()=>{});
    return () => unsub();
  }, [deferReady]);

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

  // 🚪 Audit logs — ใช้เฉพาะแท็บ "ประวัติการใช้งาน" (admin)
  const auditReady = visited("auditlog");
  useEffect(() => {
    if (!auditReady) return;
    const q = query(collection(db, "auditLog"), orderBy("timestamp", "desc"), limit(LIMITS.auditLogs));
    const unsub = onSnapshot(q, snap => setAuditLogs(snap.docs.map(d => ({ ...d.data(), id: d.id }))), ()=>{});
    return () => unsub();
  }, [auditReady]);

  // 🚪 Employees (พนักงาน + work permit) — ใช้ในบัตรลูกจ้าง/เงินเดือน/โซนผลิต
  const empReady = prodReady || visited("employees", "payroll");
  useEffect(() => {
    if (!empReady) return;
    const unsub = onSnapshot(collection(db, "employees"), snap => setEmployees(snap.docs.map(d => ({ ...d.data(), id: d.id }))), ()=>{});
    return () => unsub();
  }, [empReady]);

  // 🚪 Tax Docs — ใช้เฉพาะแท็บ "คลังเอกสารภาษี"
  // ⚠️ เดิมไม่มีเพดานเลย + โหลดตั้งแต่เปิดแอป
  const taxReady = visited("taxdocs");
  useEffect(() => {
    if (!taxReady) return;
    const q = query(collection(db, "taxDocs"), orderBy("date","desc"), limit(LIMITS.taxDocs));
    const unsub = onSnapshot(q, snap => setTaxDocs(snap.docs.map(d => ({ ...d.data(), id: d.id }))), ()=>{});
    return () => unsub();
  }, [taxReady]);

  // Production orders — โหลดเฉพาะตอนเข้าโซนผลิต
  useEffect(() => {
    if (!prodReady) return;
    const q = query(collection(db, "productionOrders"), orderBy("createdAt","desc"), limit(LIMITS.productionOrders));
    const unsub = onSnapshot(q, snap => setProductionOrders(snap.docs.map(d => ({...d.data(), id:d.id}))), ()=>{});
    return () => unsub();
  }, [prodReady]);

  // BOMs (สูตรวัตถุดิบ)
  useEffect(() => {
    if (!deferReady) return;
    const unsub = onSnapshot(collection(db, "boms"), snap => setBoms(snap.docs.map(d => ({...d.data(), id:d.id}))), ()=>{});
    return () => unsub();
  }, [deferReady]);

  // Custom orders (ฝังรูป base64 หนักมาก) — โหลดเฉพาะตอนเข้าโซนผลิต
  useEffect(() => {
    if (!prodReady) return;
    const q = query(collection(db, "customOrders"), orderBy("createdAt","desc"), limit(LIMITS.customOrders));
    const unsub = onSnapshot(q, snap => setCustomOrders(snap.docs.map(d => ({...d.data(), id:d.id}))), ()=>{});
    return () => unsub();
  }, [prodReady]);

  // Catalog orders — สั่งจาก /catalog (public)
  // 📅 โหลดตามช่วงวันที่ (เดิมเพดาน 400 ใบ — ที่ 200-400 ออเดอร์/วัน เต็มภายในวันเดียว
  //    แล้วออเดอร์ที่ยังไม่รับหายจาก inbox เงียบ ๆ)
  useEffect(() => {
    if (!deferReady) return;
    const clauses = [where("createdAt", ">=", Timestamp.fromDate(catalogRange.from))];
    if (catalogRange.to) clauses.push(where("createdAt", "<=", Timestamp.fromDate(catalogRange.to)));
    const q = query(collection(db, "catalogOrders"), ...clauses, orderBy("createdAt","desc"), limit(LIMITS.catalogCap));
    const unsub = onSnapshot(q, snap => {
      setCatalogOrders(snap.docs.map(d => ({...d.data(), id:d.id})));
      setCatalogCapped(snap.size >= LIMITS.catalogCap);
    }, ()=>{});
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deferReady, catalogRange.from?.getTime(), catalogRange.to?.getTime()]);

  // 🚪 Attendance / Payroll — ใช้เฉพาะแท็บ "เงินเดือน" (admin เท่านั้น)
  // ⚠️ attendance เดิมไม่มีเพดานเลย + โหลดตั้งแต่เปิดแอป
  //    เอกสาร = พนักงาน 1 คน × 1 วัน → พนักงาน 20 คน 1 ปี = 7,300 เอกสาร
  //    แท็บเล็ตต้องดาวน์โหลดทุกครั้งที่เปิดแอป ทั้งที่พนักงานหน้าร้านไม่มีสิทธิ์เข้าด้วยซ้ำ
  const payReady = visited("payroll");
  useEffect(() => {
    if (!payReady) return;
    const q = query(collection(db, "attendance"), orderBy("date","desc"), limit(LIMITS.attendance));
    const unsub = onSnapshot(q, snap => setAttendance(snap.docs.map(d => ({...d.data(), id:d.id}))), ()=>{});
    return () => unsub();
  }, [payReady]);

  useEffect(() => {
    if (!payReady) return;
    const q = query(collection(db, "payrollRuns"), orderBy("createdAt","desc"), limit(LIMITS.payrollRuns));
    const unsub = onSnapshot(q, snap => setPayrollRuns(snap.docs.map(d => ({...d.data(), id:d.id}))), ()=>{});
    return () => unsub();
  }, [payReady]);

  // 🧺 ขายคละที่รอระบุสี/ไซส์
  useEffect(() => {
    if (!deferReady) return;
    const q = query(collection(db, "pendingMixSales"), orderBy("createdAt","desc"), limit(LIMITS.pendingMixSales));
    const unsub = onSnapshot(q, snap => setPendingMixSales(snap.docs.map(d => ({...d.data(), id:d.id}))), ()=>{});
    return () => unsub();
  }, [deferReady]);

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
    ordersRange, setOrdersRange, ordersCapped,
    customers,
    invoices,
    invoicesRange, setInvoicesRange, invoicesCapped,
    statements,
    returns,
    companyInfo, setCompanyInfo,
    roleLabels,
    auditLogs,
    productionOrders,
    boms,
    customOrders,
    catalogOrders,
    catalogRange, setCatalogRange, catalogCapped,
    attendance,
    payrollRuns,
    customSizes,
    pendingMixSales,
    employees,
    taxDocs,
    loading, setLoading,
  };
}
