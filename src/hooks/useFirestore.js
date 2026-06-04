import { useState, useEffect } from "react";
import { db } from "../firebase";
import { collection, onSnapshot, doc, query, orderBy, limit, writeBatch, setDoc } from "firebase/firestore";
import { INIT_USERS, INIT_CATS } from "../constants";

export function useFirestore() {
  const [users, setUsers] = useState(INIT_USERS);
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
  const [productionOrders, setProductionOrders] = useState([]);
  const [boms, setBoms] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "users"), snap => {
      if (snap.empty) {
        const batch = writeBatch(db);
        INIT_USERS.forEach(u => batch.set(doc(db, "users", String(u.id)), u));
        batch.commit();
      } else {
        setUsers(snap.docs.map(d => ({ ...d.data(), id: d.id })));
      }
    });
    return () => unsub();
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
    const q = query(collection(db, "transactions"), orderBy("createdAt", "desc"));
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
    const q = query(collection(db, "orders"), orderBy("createdAt","desc"));
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
    const q = query(collection(db, "invoices"), orderBy("createdAt","desc"));
    const unsub = onSnapshot(q, snap => setInvoices(snap.docs.map(d=>({...d.data(),id:d.id}))), ()=>{});
    return () => unsub();
  }, []);

  useEffect(() => {
    const q = query(collection(db, "statements"), orderBy("createdAt","desc"));
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

  // Production orders
  useEffect(() => {
    const q = query(collection(db, "productionOrders"), orderBy("createdAt","desc"));
    const unsub = onSnapshot(q, snap => setProductionOrders(snap.docs.map(d => ({...d.data(), id:d.id}))), ()=>{});
    return () => unsub();
  }, []);

  // BOMs (สูตรวัตถุดิบ)
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "boms"), snap => setBoms(snap.docs.map(d => ({...d.data(), id:d.id}))), ()=>{});
    return () => unsub();
  }, []);

  return {
    users, setUsers,
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
    loading, setLoading,
  };
}
