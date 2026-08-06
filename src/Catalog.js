// 🛍️ Catalog Public — หน้าแคตตาล็อกสาธารณะ (ไม่ต้อง login)
// URL: /catalog
// อ่าน clothing + settings/company จาก Firestore
// ลูกค้ากดสั่ง → เขียน catalogOrders → ทีมรับใน ERP
import { useEffect, useState, useMemo, useRef } from "react";
import { db, auth, authReady } from "./firebase";
import { signInAnonymously } from "firebase/auth";
import { collection, doc, getDoc, onSnapshot, addDoc, runTransaction, serverTimestamp } from "firebase/firestore";
import { compareSizes, getSizesFor } from "./theme";

const T = {
  bg: "#f4f5f7", card: "#ffffff", border: "#e2e5ea",
  text: "#1f2933", sub: "#52606d", muted: "#9aa5b1",
  blue: "#3b5b8b", green: "#3a7a52", line: "#06C755",
};

// 🎨 hex → ชื่อสีไทย — fallback เมื่อ ERP ไม่ได้กรอกชื่อสี
const COLOR_NAME_FROM_HEX = {
  "#000000": "ดำ", "#000": "ดำ",
  "#ffffff": "ขาว", "#fff": "ขาว",
  "#ff0000": "แดง", "#f00": "แดง", "#dc2626": "แดง", "#ef4444": "แดง", "#b94a48": "แดง",
  "#0000ff": "น้ำเงิน", "#00f": "น้ำเงิน", "#2563eb": "น้ำเงิน", "#3b82f6": "น้ำเงิน", "#3b5b8b": "น้ำเงิน",
  "#008000": "เขียว", "#22c55e": "เขียว", "#16a34a": "เขียว", "#3a7a52": "เขียว",
  "#ffff00": "เหลือง", "#ff0": "เหลือง", "#facc15": "เหลือง", "#eab308": "เหลือง",
  "#ffa500": "ส้ม", "#f97316": "ส้ม", "#fb923c": "ส้ม",
  "#800080": "ม่วง", "#a855f7": "ม่วง", "#7c3aed": "ม่วง",
  "#ffc0cb": "ชมพู", "#ec4899": "ชมพู", "#f472b6": "ชมพู",
  "#a52a2a": "น้ำตาล", "#92400e": "น้ำตาล", "#78350f": "น้ำตาล",
  "#808080": "เทา", "#6b7280": "เทา", "#9ca3af": "เทา",
  "#f5deb3": "ครีม", "#fef3c7": "ครีม", "#fde68a": "ครีม",
};
function guessColorName(hex, fallbackIdx) {
  if (!hex) return `สี #${fallbackIdx+1}`;
  const h = String(hex).toLowerCase().trim();
  return COLOR_NAME_FROM_HEX[h] || `สี #${fallbackIdx+1}`;
}

// 👟 กรองไซส์ให้ตรงชนิดสินค้า — บางสีมีข้อมูลไซส์ผิดชนิดค้างอยู่ในคลัง
// (เช่น รองเท้าแต่สีนึงมี S,M,L,XL ติดมา) ถ้าไม่กรอง ลูกค้าจะเห็นไซส์มั่ว
// เกณฑ์: เบอร์รองเท้า = ตัวเลข ≥ 30 · ไซส์เด็ก = ตัวเลข < 30
// Firestore timestamp → "21/07 14:30"
const fmtOrderDate = (ts) => {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  if (isNaN(d.getTime())) return "—";
  const p = n => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth()+1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

const isShoeSize = (sz) => /^\d+$/.test(String(sz)) && Number(sz) >= 30;
const sizeFitsItem = (item, sz) =>
  (item?.sizeType === "shoe") ? isShoeSize(sz) : !isShoeSize(sz);

// 📏 ย่อรายการไซส์ให้อ่านง่ายในบรรทัดเดียว
// ["6","8","10","12","S","M","L","XL","2XL","5XL"] → "6-12 · S-2XL, 5XL"
// (ไซส์ที่เรียงต่อกันยุบเป็นช่วง — ดูจาก sizeRank ว่าติดกันไหม)
function summarizeSizes(sizes = []) {
  if (sizes.length === 0) return "";
  if (sizes.length <= 2) return sizes.join(", ");
  const ORDER = ["XS","S","M","L","XL","2XL","3XL","4XL","5XL","6XL","7XL","8XL","9XL"];
  const seqIdx = (sz) => {
    const s = String(sz).trim().toUpperCase();
    if (/^\d+$/.test(s)) return { group: "num", n: Number(s) };
    const i = ORDER.indexOf(s);
    return i >= 0 ? { group: "letter", n: i } : null;
  };
  const parts = [];
  let run = [];
  const flush = () => {
    if (run.length === 0) return;
    parts.push(run.length >= 3 ? `${run[0]}-${run[run.length-1]}` : run.join(", "));
    run = [];
  };
  let prev = null;
  sizes.forEach(sz => {
    const cur = seqIdx(sz);
    // ต่อเนื่องกัน = กลุ่มเดียวกัน + ลำดับถัดไปพอดี (ไซส์เด็กเว้นทีละ 2: 6,8,10,12)
    const contiguous = prev && cur && prev.group === cur.group &&
      (cur.group === "letter" ? cur.n === prev.n + 1 : (cur.n - prev.n === 2 || cur.n - prev.n === 1));
    if (!contiguous) flush();
    run.push(sz);
    prev = cur;
  });
  flush();
  return parts.join(" · ");
}

export default function Catalog() {
  const [items, setItems] = useState([]);
  const [company, setCompany] = useState({ name: "CPU", phone: "", lineId: "", lineUrl: "" });
  const [search, setSearch] = useState("");
  // 🔎 Filter 3 ชั้น ใช้ร่วมกันได้ (AND) — เลือกแบรนด์แล้วกรองหมวดย่อยต่อได้
  const [fType, setFType] = useState("");   // "" | apparel | shoe
  const [fBrand, setFBrand] = useState(""); // ชื่อแบรนด์
  const [fCat, setFCat] = useState("");     // หมวดย่อย
  const [detail, setDetail] = useState(null);
  const [order, setOrder] = useState(null); // {item, qtyMap} — สร้างก่อน add to cart
  const [customSizes, setCustomSizes] = useState([]); // ✏️ ไซส์พิเศษที่ลูกค้าพิมพ์เอง (ต่อการสั่ง 1 ครั้ง)
  const [newCustomSize, setNewCustomSize] = useState("");
  const [cart, setCart] = useState([]); // [{itemId, itemName, itemCategory, lines:[{colorIdx,color,colorHex,size,qty}]}]
  const [showCart, setShowCart] = useState(false);
  const [checkout, setCheckout] = useState(null); // {name, phone, address, note}
  const [sent, setSent] = useState(false);
  const [loadState, setLoadState] = useState("loading"); // loading | ok | denied | error
  const [retryTick, setRetryTick] = useState(0);
  const retriedRef = useRef(false);

  // 💾 persist cart in localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem("cpu_cart");
      if (saved) setCart(JSON.parse(saved));
    } catch (e) {}
  }, []);
  useEffect(() => {
    try { localStorage.setItem("cpu_cart", JSON.stringify(cart)); } catch (e) {}
  }, [cart]);

  // 🔗 ลิงก์ส่วนตัวของลูกค้า: /c?id=<customerId>
  //    เปิดจากเครื่องไหนก็ได้ ข้อมูลเติมให้ครบ — ไม่ต้อง login
  //    ใช้ id ของ Firestore (สุ่ม 20 ตัว) ไม่ใช่เบอร์โทร → เดาไม่ได้ ข้อมูลลูกค้าไม่รั่ว
  const [linkedCustomer, setLinkedCustomer] = useState(null);
  useEffect(() => {
    const cid = new URLSearchParams(window.location.search).get("id");
    if (!cid) return;
    getDoc(doc(db, "customers", cid))
      .then(s => { if (s.exists()) setLinkedCustomer({ id: s.id, ...s.data() }); })
      .catch(e => console.warn("[catalog] โหลดข้อมูลลูกค้าไม่สำเร็จ:", e));
  }, []);

  // 🧾 ออเดอร์ของฉัน — จำ id ที่เคยส่งไว้ในเครื่อง เพื่อให้ลูกค้าตามดู/ยกเลิกเองได้
  //    (ไม่ต้อง login — id ของ Firestore สุ่ม 20 ตัว เดาไม่ได้)
  const MY_ORDERS_KEY = "cpu_my_orders";
  const [myOrders, setMyOrders] = useState([]);      // [{id, ...data}]
  const [showMyOrders, setShowMyOrders] = useState(false);
  const [cancelling, setCancelling] = useState("");

  const readMyOrderIds = () => {
    try { const a = JSON.parse(localStorage.getItem(MY_ORDERS_KEY) || "[]"); return Array.isArray(a) ? a : []; }
    catch { return []; }
  };
  const rememberMyOrder = (id) => {
    try {
      const next = [id, ...readMyOrderIds().filter(x => x !== id)].slice(0, 30); // เก็บ 30 ใบล่าสุดพอ
      localStorage.setItem(MY_ORDERS_KEY, JSON.stringify(next));
    } catch {}
  };

  // โหลดออเดอร์ของฉัน (ตอนเปิดหน้าต่าง) — อ่านทีละใบด้วย id ที่จำไว้
  const loadMyOrders = async () => {
    const ids = readMyOrderIds();
    if (ids.length === 0) { setMyOrders([]); return; }
    const rows = await Promise.all(ids.map(async id => {
      try {
        const s = await getDoc(doc(db, "catalogOrders", id));
        return s.exists() ? { id: s.id, ...s.data() } : null;
      } catch { return null; }
    }));
    setMyOrders(rows.filter(Boolean));
  };
  const openMyOrders = () => { setShowMyOrders(true); loadMyOrders(); };

  // ❌ ยกเลิก — ได้เฉพาะใบที่ทีมยังไม่แตะ (status = new)
  //    ใช้ transaction เช็คสถานะตอนกดจริง กันกรณีทีมเพิ่งเริ่มทำพอดี
  const cancelMyOrder = async (o) => {
    if (cancelling) return;
    if (!window.confirm(`ยกเลิกออเดอร์นี้?\n\n${o.totalQty || 0} ตัว · ส่งเมื่อ ${fmtOrderDate(o.createdAt)}\n\n⚠️ ยกเลิกแล้วกู้คืนไม่ได้ ต้องสั่งใหม่`)) return;
    setCancelling(o.id);
    try {
      await runTransaction(db, async (tx) => {
        const ref = doc(db, "catalogOrders", o.id);
        const s = await tx.get(ref);
        if (!s.exists()) throw new Error("GONE");
        const st = s.data().status || "new";
        if (st !== "new") throw new Error("STARTED:" + st);
        tx.update(ref, { status: "cancelled", cancelledByCustomer: true, cancelledAt: serverTimestamp() });
      });
      await loadMyOrders();
    } catch (e) {
      const m = String(e.message || "");
      if (m === "GONE") alert("ไม่พบออเดอร์นี้แล้ว");
      else if (m.startsWith("STARTED:")) alert("ยกเลิกเองไม่ได้แล้วค่ะ 🙏\nทีมงานเริ่มดำเนินการแล้ว — กรุณาติดต่อร้านโดยตรง");
      else alert("ยกเลิกไม่สำเร็จ: " + m);
      await loadMyOrders();
    } finally {
      setCancelling("");
    }
  };

  // 💾 จำชื่อ/เบอร์/ที่อยู่ไว้ในเครื่องลูกค้า — สั่งครั้งหน้าไม่ต้องพิมพ์ใหม่
  //    เก็บเฉพาะเครื่องนั้น (localStorage) ไม่ได้ส่งไปไหน · ไม่เก็บหมายเหตุ (เปลี่ยนทุกออเดอร์)
  const SAVED_KEY = "cpu_customer_info";
  const loadSavedInfo = () => {
    // มาจากลิงก์ส่วนตัว → ใช้ข้อมูลจากระบบ (ถูกต้องกว่าที่ค้างในเครื่อง)
    if (linkedCustomer) {
      return {
        name: linkedCustomer.name || "",
        phone: linkedCustomer.phone || "",
        address: linkedCustomer.address || "",
      };
    }
    try {
      const s = JSON.parse(localStorage.getItem(SAVED_KEY) || "{}");
      return { name: s.name || "", phone: s.phone || "", address: s.address || "" };
    } catch { return { name: "", phone: "", address: "" }; }
  };
  const saveInfo = (info) => {
    try {
      localStorage.setItem(SAVED_KEY, JSON.stringify({
        name: (info.name || "").trim(), phone: (info.phone || "").trim(), address: (info.address || "").trim(),
      }));
    } catch {}
  };
  const clearSavedInfo = () => {
    try { localStorage.removeItem(SAVED_KEY); } catch {}
    setCheckout(c => c ? { ...c, name: "", phone: "", address: "" } : c);
  };
  const hasSavedInfo = () => !!loadSavedInfo().name;

  // ✏️ เพิ่ม/ลบไซส์พิเศษ — กันชื่อซ้ำกับไซส์ที่มีอยู่แล้ว (เทียบแบบไม่สนตัวพิมพ์)
  const addCustomSize = () => {
    const v = newCustomSize.trim();
    if (!v) return;
    const existing = [
      ...customSizes,
      ...((order?.item?.colors || []).flatMap(c => Object.keys(c.stock || {}))),
    ].map(s => s.toLowerCase());
    if (existing.includes(v.toLowerCase())) { setNewCustomSize(""); return; }
    setCustomSizes(prev => [...prev, v]);
    setNewCustomSize("");
  };
  // ปิดฟอร์มสั่ง → ล้างไซส์พิเศษด้วย ไม่งั้นติดไปสินค้าถัดไป
  const closeOrderForm = () => { setOrder(null); setCustomSizes([]); setNewCustomSize(""); };
  const removeCustomSize = (sz) => {
    setCustomSizes(prev => prev.filter(s => s !== sz));
    // ลบจำนวนที่กรอกไว้ในคอลัมน์นั้นด้วย ไม่งั้นค้างในตะกร้าทั้งที่คอลัมน์หายแล้ว
    setOrder(o => {
      if (!o?.qtyMap) return o;
      const qtyMap = {};
      Object.entries(o.qtyMap).forEach(([ci, row]) => {
        const r = { ...row }; delete r[sz];
        if (Object.keys(r).length > 0) qtyMap[ci] = r;
      });
      return { ...o, qtyMap };
    });
  };

  const cartTotalQty = cart.reduce((s, it) => s + it.lines.reduce((a,l)=>a+(l.qty||0),0), 0);
  const cartTotalItems = cart.length;

  const addToCart = (entry) => {
    setCart(prev => {
      // ถ้ามี item เดิมอยู่แล้ว (itemId เดียวกัน) → merge lines เข้าด้วยกัน
      const existIdx = prev.findIndex(c => c.itemId === entry.itemId);
      if (existIdx < 0) return [...prev, entry];
      const merged = [...prev];
      // รวม lines: ถ้า colorIdx+size ตรง → บวกจำนวน, ไม่ตรง → push ใหม่
      const existLines = [...merged[existIdx].lines];
      entry.lines.forEach(newLn => {
        const dup = existLines.findIndex(l => l.colorIdx === newLn.colorIdx && l.size === newLn.size);
        if (dup >= 0) existLines[dup] = { ...existLines[dup], qty: existLines[dup].qty + newLn.qty };
        else existLines.push(newLn);
      });
      merged[existIdx] = { ...merged[existIdx], lines: existLines };
      return merged;
    });
  };
  const removeFromCart = (idx) => setCart(prev => prev.filter((_, i) => i !== idx));
  const removeLine = (entryIdx, lineIdx) => setCart(prev => prev.map((e, i) => {
    if (i !== entryIdx) return e;
    const lines = e.lines.filter((_, j) => j !== lineIdx);
    return { ...e, lines };
  }).filter(e => e.lines.length > 0));
  const updateLineQty = (entryIdx, lineIdx, qty) => setCart(prev => prev.map((e, i) => {
    if (i !== entryIdx) return e;
    return { ...e, lines: e.lines.map((l, j) => j === lineIdx ? { ...l, qty: Math.max(1, Number(qty)||1) } : l) };
  }));
  const clearCart = () => setCart([]);

  // 📡 โหลดสินค้า — ต้องรอ anonymous auth ให้พร้อมก่อน
  //    (Firestore rules ต้องการ request.auth != null)
  //    Safari บล็อก storage บ่อย (ITP/โหมดส่วนตัว) → auth ช้า/ล้มเหลว
  //    เดิมไม่รอ + ไม่มี error handler → ขึ้น "ไม่พบสินค้า" ทั้งที่มีของ
  useEffect(() => {
    let u1 = null, u2 = null, alive = true;
    (async () => {
      await authReady;               // รอให้ auth พร้อม (มี timeout 10 วิ ในตัว)
      if (!alive) return;
      u1 = onSnapshot(collection(db, "clothing"),
        s => {
          setItems(s.docs.map(d => ({ ...d.data(), id: d.id })).filter(it => !it.hideFromCatalog));
          setLoadState("ok");
        },
        async err => {
          console.error("[catalog] โหลดสินค้าไม่สำเร็จ:", err);
          // permission-denied มักแปลว่า anonymous auth ยังไม่ติด (Safari บล็อก storage)
          // → ลอง sign-in ใหม่ 1 ครั้ง แล้ว subscribe ใหม่ ก่อนจะยอมแพ้
          if (err?.code === "permission-denied" && !retriedRef.current) {
            retriedRef.current = true;
            try {
              await signInAnonymously(auth);
              if (alive) { u1 && u1(); u1 = null; setLoadState("loading"); setRetryTick(t => t + 1); }
              return;
            } catch (e2) { console.error("[catalog] sign-in ใหม่ไม่สำเร็จ:", e2); }
          }
          setLoadState(err?.code === "permission-denied" ? "denied" : "error");
        }
      );
      u2 = onSnapshot(doc(db, "settings", "company"),
        s => { if (s.exists()) setCompany(prev => ({ ...prev, ...s.data() })); },
        () => {}
      );
    })();
    // ⏱️ ตาข่ายกันค้าง — ถ้าไม่มีทั้งข้อมูลและ error ภายใน 12 วิ ให้แสดงทางออก
    //    (ดีกว่าค้างที่ "กำลังโหลด" ตลอดกาลจนลูกค้าปิดหนี)
    const stuckTimer = setTimeout(() => {
      if (alive) setLoadState(s => s === "loading" ? "error" : s);
    }, 12000);
    return () => { alive = false; clearTimeout(stuckTimer); if (u1) u1(); if (u2) u2(); };
  }, [retryTick]); // retryTick เปลี่ยน = subscribe ใหม่หลัง sign-in ซ้ำ

  // 🏷️ Categories: predefined (เสื้อผ้า/รองเท้า ตาม sizeType) + custom (item.category)
  // 🔎 ตัวกรองแต่ละชั้นทำงานร่วมกัน (AND) และ "นับจำนวนตามชั้นอื่นที่เลือกไว้แล้ว"
  //    เช่น เลือกแบรนด์ X → ตัวเลขในหมวดย่อยจะนับเฉพาะของแบรนด์ X
  //    → ไม่มีปุ่มที่กดแล้วได้ 0 รายการ
  const matchType  = (i) => !fType  || (fType === "shoe" ? i.sizeType === "shoe" : i.sizeType !== "shoe");
  const matchBrand = (i) => !fBrand || i.brand === fBrand;
  const matchCat   = (i) => !fCat   || i.category === fCat;
  const matchSearch = (i) => {
    if (!search) return true;
    const norm = (s) => String(s||"").toLowerCase().replace(/\s+/g, "");
    const text = norm(`${i.model||i.name||""} ${i.brand||""} ${i.category||""} ${(i.colors||[]).map(c=>c.colorName||c.name||"").join(" ")}`);
    return text.includes(norm(search));
  };

  const typeOptions = useMemo(() => {
    const base = items.filter(i => matchBrand(i) && matchCat(i) && matchSearch(i));
    return [
      { key: "",        label: "ทั้งหมด",        icon: "📦", count: base.length },
      { key: "apparel", label: "เสื้อผ้า",       icon: "👕", count: base.filter(i => i.sizeType !== "shoe").length },
      { key: "shoe",    label: "รองเท้า & กีฬา", icon: "👟", count: base.filter(i => i.sizeType === "shoe").length },
    ].filter(t => t.count > 0 || t.key === "" || t.key === fType);
  }, [items, fBrand, fCat, search, fType]); // eslint-disable-line react-hooks/exhaustive-deps

  const brandOptions = useMemo(() => {
    const base = items.filter(i => matchType(i) && matchCat(i) && matchSearch(i));
    const names = [...new Set(base.map(i => i.brand).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"th"));
    return names.map(b => ({ key: b, label: b, icon: "🏢", count: base.filter(i => i.brand === b).length }));
  }, [items, fType, fCat, search]); // eslint-disable-line react-hooks/exhaustive-deps

  const catOptions = useMemo(() => {
    const base = items.filter(i => matchType(i) && matchBrand(i) && matchSearch(i));
    const names = [...new Set(base.map(i => i.category).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"th"));
    return names.map(c => ({ key: c, label: c, icon: "🏷️", count: base.filter(i => i.category === c).length }));
  }, [items, fType, fBrand, search]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(
    () => items.filter(i => matchType(i) && matchBrand(i) && matchCat(i) && matchSearch(i)),
    [items, fType, fBrand, fCat, search] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const hasFilter = !!(fType || fBrand || fCat);

  // 💬 LINE link: @xxx (OA) → ใช้ตรงๆ, ส่วน personal ID → prefix ~
  const lineHref = company.lineUrl
    || (company.lineId
        ? (company.lineId.startsWith("@")
            ? `https://line.me/R/ti/p/${encodeURIComponent(company.lineId)}`
            : `https://line.me/R/ti/p/~${encodeURIComponent(company.lineId)}`)
        : "");

  return (
    <div style={{ minHeight: "100vh", background: T.bg, fontFamily: "'Sarabun',sans-serif", color: T.text }}>
      {/* HEADER */}
      <div style={{ background: "white", borderBottom: `1px solid ${T.border}`, position: "sticky", top: 0, zIndex: 10 }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", padding: "14px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 800, color: T.blue, letterSpacing: 1 }}>{company.name || "CPU"}</div>
            <div style={{ fontSize: 12, color: T.sub }}>
              {linkedCustomer
                ? <>สวัสดีค่ะ <b style={{ color: T.blue }}>{linkedCustomer.name}</b> 👋</>
                : "แคตตาล็อกสินค้า • Catalog"}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {/* 🛒 Cart button */}
            <button onClick={()=>setShowCart(true)}
              style={{ position: "relative", background: cartTotalQty > 0 ? T.green : "white", color: cartTotalQty > 0 ? "white" : T.sub, border: `1px solid ${cartTotalQty > 0 ? T.green : T.border}`, padding: "10px 16px", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontFamily: "inherit" }}>
              🛒 ตะกร้า
              {cartTotalQty > 0 && (
                <span style={{ background: "white", color: T.green, borderRadius: 12, padding: "1px 9px", fontSize: 12, fontWeight: 800, minWidth: 22, textAlign: "center" }}>
                  {cartTotalQty}
                </span>
              )}
            </button>
            {/* 🧾 ออเดอร์ของฉัน — โผล่เมื่อเคยสั่งไปแล้ว */}
            {readMyOrderIds().length > 0 && (
              <button onClick={openMyOrders}
                style={{ background: "white", color: T.blue, border: `1px solid ${T.blue}`, padding: "10px 16px", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                🧾 ออเดอร์ของฉัน
              </button>
            )}
            {lineHref && (
              <a href={lineHref} target="_blank" rel="noreferrer" style={{ background: T.line, color: "white", padding: "10px 16px", borderRadius: 8, fontSize: 13, fontWeight: 700, textDecoration: "none", display: "flex", alignItems: "center", gap: 6 }}>
                💬 LINE {company.lineId || ""}
              </a>
            )}
            {company.phone && (
              <a href={`tel:${company.phone}`} style={{ background: T.blue, color: "white", padding: "10px 16px", borderRadius: 8, fontSize: 13, fontWeight: 700, textDecoration: "none" }}>
                📞 {company.phone}
              </a>
            )}
          </div>
        </div>
      </div>

      {/* SEARCH */}
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "16px 20px 8px", display: "flex", gap: 10, flexWrap: "wrap" }}>
        <input
          placeholder="🔍 ค้นหารุ่น / สี / หมวด..."
          value={search} onChange={e => setSearch(e.target.value)}
          style={{ flex: 1, minWidth: 200, padding: "10px 14px", borderRadius: 8, border: `1px solid ${T.border}`, fontSize: 14, fontFamily: "inherit" }}
        />
      </div>

      {/* 🔎 FILTER 3 ชั้น — ใช้ร่วมกันได้: ชนิด × แบรนด์ × หมวดย่อย */}
      {(() => {
        const renderTab = (t, small, active, onClick) => {
          return (
            <button key={t.key} onClick={onClick}
              style={{
                padding: small ? "4px 11px" : "8px 16px", borderRadius: 20,
                border: active ? `2px solid ${T.blue}` : `1px solid ${T.border}`,
                background: active ? T.blue : "white",
                color: active ? "white" : T.sub,
                fontSize: small ? 11 : 13, fontWeight: active ? 700 : 500,
                cursor: "pointer", fontFamily: "inherit",
                display: "flex", alignItems: "center", gap: small ? 4 : 6,
                transition: "all 0.15s", whiteSpace: "nowrap",
                boxShadow: active ? "0 4px 12px rgba(59,91,139,0.25)" : "none",
              }}>
              <span>{t.icon}</span>
              <span>{t.label}</span>
              <span style={{
                background: active ? "rgba(255,255,255,0.25)" : "rgba(59,91,139,0.08)",
                color: active ? "white" : T.blue,
                padding: small ? "0 6px" : "1px 8px", borderRadius: 10, fontSize: small ? 10 : 11, fontWeight: 700,
              }}>{t.count}</span>
            </button>
          );
        };
        const Row = ({ children, gap = 8, pb = 8 }) => (
          <div style={{ maxWidth: 1100, margin: "0 auto", padding: `0 20px ${pb}px`, display: "flex", gap, flexWrap: "wrap", alignItems: "center" }}>
            {children}
          </div>
        );
        return (
          <>
            <Row>
              {typeOptions.map(t => renderTab(t, false, fType === t.key, () => setFType(t.key)))}
              {/* ล้างทั้งหมด — โผล่เมื่อมีการกรองอยู่ */}
              {hasFilter && (
                <button onClick={() => { setFType(""); setFBrand(""); setFCat(""); }}
                  style={{ padding: "6px 14px", borderRadius: 20, border: `1px solid ${T.border}`, background: "white", color: T.sub, cursor: "pointer", fontFamily: "inherit", fontSize: 12, whiteSpace: "nowrap" }}>
                  ✕ ล้างตัวกรอง
                </button>
              )}
            </Row>
            {/* กดซ้ำที่อันเดิม = ยกเลิกตัวกรองนั้น */}
            {brandOptions.length > 0 && (
              <Row>{brandOptions.map(t => renderTab(t, false, fBrand === t.key, () => setFBrand(fBrand === t.key ? "" : t.key)))}</Row>
            )}
            {catOptions.length > 0 && (
              <Row gap={5} pb={14}>{catOptions.map(t => renderTab(t, true, fCat === t.key, () => setFCat(fCat === t.key ? "" : t.key)))}</Row>
            )}
          </>
        );
      })()}

      {/* GRID */}
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "0 20px 40px" }}>
        {filtered.length === 0 ? (
          <div style={{ textAlign: "center", padding: 60, color: T.muted }}>
            {/* บอกสถานะจริง — เดิมขึ้น "ไม่พบสินค้า" หมด แม้โหลดยังไม่เสร็จ/โหลดพัง */}
            {loadState === "loading" && (
              <><div style={{ fontSize: 48 }}>⏳</div><div style={{ marginTop: 10 }}>กำลังโหลดสินค้า...</div></>
            )}
            {(loadState === "denied" || loadState === "error") && (
              <>
                <div style={{ fontSize: 48 }}>😕</div>
                <div style={{ marginTop: 10, color: T.text, fontWeight: 700 }}>โหลดสินค้าไม่สำเร็จ</div>
                <div style={{ marginTop: 8, fontSize: 13, lineHeight: 1.8 }}>
                  ถ้าใช้ Safari ลองปิด <b>โหมดส่วนตัว (Private Browsing)</b><br/>
                  หรือปิด <b>ป้องกันการติดตามข้ามเว็บไซต์</b> ในตั้งค่า → Safari<br/>
                  แล้วกดโหลดใหม่
                </div>
                <button onClick={() => window.location.reload()}
                  style={{ marginTop: 14, background: T.blue, color: "white", border: "none", padding: "10px 22px", borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                  🔄 โหลดใหม่
                </button>
                {company.phone && (
                  <div style={{ marginTop: 12, fontSize: 12 }}>
                    หรือโทรสั่งได้ที่ <a href={`tel:${company.phone}`} style={{ color: T.blue, fontWeight: 700 }}>{company.phone}</a>
                  </div>
                )}
              </>
            )}
            {loadState === "ok" && (
              <><div style={{ fontSize: 48 }}>📦</div><div style={{ marginTop: 10 }}>ไม่พบสินค้าตามที่เลือก</div></>
            )}
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 14 }}>
            {filtered.map(it => {
              const cover = it.image || (it.colors && it.colors[0] && it.colors[0].image);
              return (
                <div key={it.id} onClick={() => setDetail(it)}
                  style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, overflow: "hidden", cursor: "pointer", transition: "transform .15s, box-shadow .15s" }}
                  onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 8px 24px rgba(0,0,0,.08)"; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = ""; e.currentTarget.style.boxShadow = ""; }}>
                  <div style={{ width: "100%", aspectRatio: "1/1", background: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                    {cover ? <img src={cover} alt={it.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      : <div style={{ fontSize: 56, color: T.muted }}>👕</div>}
                  </div>
                  <div style={{ padding: 12 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, color: T.text, marginBottom: 4 }}>{it.model || it.name || `(ไม่ระบุชื่อ — ${it.id.slice(0,6)})`}</div>
                    {(it.brand || it.category) && (
                      <div style={{ fontSize: 11, color: T.muted, marginBottom: 6 }}>
                        {it.brand && <span style={{ color: T.blue, fontWeight: 700 }}>{it.brand}</span>}
                        {it.brand && it.category && " › "}
                        {it.category}
                      </div>
                    )}
                    {/* 🎨 จุดสี + ชื่อสี (ไม่ได้ตั้งชื่อ → เดาจากรหัสสีให้) */}
                    <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 8 }}>
                      {(it.colors || []).slice(0, 6).map((c, i) => {
                        const label = c.colorName || c.name || guessColorName(c.hex, i);
                        return (
                          <span key={i} title={label} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 7px 2px 3px", background: "#f1f5f9", borderRadius: 10, fontSize: 10, color: T.sub, fontWeight: 600 }}>
                            <span style={{ width: 12, height: 12, borderRadius: "50%", background: c.hex || "#ddd", border: "1px solid rgba(0,0,0,.2)" }} />
                            {label}
                          </span>
                        );
                      })}
                      {(it.colors || []).length > 6 && (
                        <span style={{ fontSize: 10, color: T.muted, alignSelf: "center" }}>+{(it.colors||[]).length - 6}</span>
                      )}
                    </div>
                    {/* 🚫 ไม่บอกสถานะสต๊อก — พนักงานแจ้งลูกค้าเองตอนยืนยันออเดอร์ */}
                    <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center" }}>
                      <span style={{ fontSize: 11, color: T.blue, fontWeight: 600 }}>ดูรายละเอียด →</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 🧾 ออเดอร์ของฉัน — ตามดูสถานะ + ยกเลิกเองได้ถ้ายังไม่เริ่มทำ */}
      {showMyOrders && (
        <div onClick={() => setShowMyOrders(false)} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.65)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 120, padding: 12 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "white", borderRadius: 14, maxWidth: 520, width: "100%", maxHeight: "92vh", overflowY: "auto" }}>
            <div style={{ padding: 18, borderBottom: `1px solid ${T.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 17, fontWeight: 800, color: T.text }}>🧾 ออเดอร์ของฉัน</div>
                <div style={{ fontSize: 11, color: T.muted, marginTop: 3 }}>ยกเลิกเองได้ถ้าทีมงานยังไม่เริ่มทำ</div>
              </div>
              <button onClick={() => setShowMyOrders(false)} style={{ background: "none", border: `1px solid ${T.border}`, borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}>✕</button>
            </div>

            <div style={{ padding: 16 }}>
              {myOrders.length === 0 ? (
                <div style={{ textAlign: "center", padding: 30, color: T.muted, fontSize: 13 }}>ยังไม่มีออเดอร์</div>
              ) : myOrders.map(o => {
                const st = o.status || "new";
                const meta = st === "new"       ? { label: "รอทีมงานรับเรื่อง", color: T.blue,  bg: "#dbeafe" }
                          : st === "cancelled"  ? { label: "ยกเลิกแล้ว",        color: "#b94a48", bg: "#fee2e2" }
                          : st === "converted"  ? { label: "รับออเดอร์แล้ว",     color: "#7c3aed", bg: "#ede9fe" }
                          :                        { label: "กำลังดำเนินการ",   color: "#b88600", bg: "#fef3c7" };
                const canCancel = st === "new";
                const lines = (o.items?.length ? o.items : [{ itemName: o.itemName, lines: o.lines || [] }]);
                return (
                  <div key={o.id} style={{ border: `1px solid ${T.border}`, borderRadius: 10, padding: 12, marginBottom: 10, opacity: st === "cancelled" ? 0.6 : 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                      <span style={{ background: meta.bg, color: meta.color, padding: "3px 10px", borderRadius: 12, fontSize: 11, fontWeight: 700 }}>{meta.label}</span>
                      <span style={{ fontSize: 11, color: T.muted }}>{fmtOrderDate(o.createdAt)}</span>
                      <span style={{ marginLeft: "auto", fontSize: 13, fontWeight: 800, color: T.text }}>{o.totalQty || 0} ตัว</span>
                    </div>
                    <div style={{ fontSize: 12, color: T.sub, lineHeight: 1.7 }}>
                      {lines.map((e, i) => (
                        <div key={i}>• {e.itemName || "(ไม่ระบุ)"} — {(e.lines || []).reduce((s, l) => s + (Number(l.qty) || 0), 0)} ตัว</div>
                      ))}
                    </div>
                    {canCancel ? (
                      <button onClick={() => cancelMyOrder(o)} disabled={cancelling === o.id}
                        style={{ marginTop: 9, width: "100%", padding: "8px", borderRadius: 8, border: "1px solid rgba(185,74,72,0.35)", background: "rgba(185,74,72,0.06)", color: "#b94a48", cursor: cancelling === o.id ? "wait" : "pointer", fontSize: 12, fontWeight: 700, fontFamily: "inherit" }}>
                        {cancelling === o.id ? "⏳ กำลังยกเลิก..." : "❌ ยกเลิกออเดอร์นี้"}
                      </button>
                    ) : st !== "cancelled" && (
                      <div style={{ marginTop: 9, fontSize: 11, color: T.muted, textAlign: "center", lineHeight: 1.7 }}>
                        ทีมงานเริ่มดำเนินการแล้ว — ต้องการแก้ไข/ยกเลิก กรุณาติดต่อร้าน
                        {company.phone && <> <a href={`tel:${company.phone}`} style={{ color: T.blue, fontWeight: 700 }}>{company.phone}</a></>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* DETAIL MODAL */}
      {detail && (
        <div onClick={() => setDetail(null)} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.65)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 12 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "white", borderRadius: 14, maxWidth: 540, width: "100%", maxHeight: "92vh", overflowY: "auto" }}>
            <div style={{ padding: 18, display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: `1px solid ${T.border}` }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 800, color: T.text }}>{detail.model || detail.name}</div>
                {(detail.brand || detail.category) && (
                  <div style={{ fontSize: 12, color: T.sub, marginTop: 2 }}>
                    {detail.brand && <span style={{ color: T.blue, fontWeight: 700 }}>{detail.brand}</span>}
                    {detail.brand && detail.category && " › "}
                    {detail.category}
                  </div>
                )}
              </div>
              <button onClick={() => setDetail(null)} style={{ background: "none", border: `1px solid ${T.border}`, borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}>✕</button>
            </div>

            {/* 📖 เล่าเรื่องสินค้า — คำบรรยาย + รูปประกอบ (ตั้งที่ ERP) */}
            {(detail.description || (detail.gallery || []).length > 0) && (
              <div style={{ padding: "16px 18px 0" }}>
                {detail.description && (
                  <div style={{ fontSize: 14, color: T.text, lineHeight: 1.9, whiteSpace: "pre-wrap", marginBottom: (detail.gallery||[]).length > 0 ? 14 : 4 }}>
                    {detail.description}
                  </div>
                )}
                {(detail.gallery || []).map((im, gi) => (
                  <div key={gi} style={{ marginBottom: 12 }}>
                    <img src={im.url} alt={im.caption || ""} loading="lazy"
                      style={{ width: "100%", borderRadius: 10, display: "block" }}/>
                    {im.caption && (
                      <div style={{ fontSize: 12, color: T.sub, marginTop: 5, textAlign: "center", lineHeight: 1.6 }}>{im.caption}</div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* 🎨 สีทั้งหมดเรียงกัน + ไซส์รวมบรรทัดเดียว
                   (เดิมแยกแถวต่อสี → ยาวมากเมื่อมีหลายสี และไซส์ก็ซ้ำกันทุกแถว)
                   🚫 ไม่บอกสถานะสต๊อก — พนักงานแจ้งลูกค้าเองตอนยืนยัน */}
            {(() => {
              const limitD = detail.catalogSizes;
              const okSize = (sz) => sizeFitsItem(detail, sz)
                && (!Array.isArray(limitD) || limitD.length === 0 || limitD.includes(sz));
              const allSizes = [...new Set((detail.colors || []).flatMap(c => Object.keys(c.stock || {})))]
                .filter(okSize).sort(compareSizes);
              const colors = detail.colors || [];
              if (colors.length === 0 && allSizes.length === 0) return null;
              return (
                <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 10 }}>
                  {colors.length > 0 && (
                    <div style={{ display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
                      <span style={{ fontSize: 13, color: T.sub, flexShrink: 0, paddingTop: 3 }}>สี</span>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", flex: 1 }}>
                        {colors.map((c, ci) => (
                          <span key={ci} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 10px 3px 4px", background: "#f1f5f9", borderRadius: 12, fontSize: 12, color: T.text, fontWeight: 600 }}>
                            <span style={{ width: 15, height: 15, borderRadius: "50%", background: c.hex || "#ddd", border: "1px solid rgba(0,0,0,.2)" }}/>
                            {c.colorName || c.name || guessColorName(c.hex, ci)}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {allSizes.length > 0 && (
                    <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                      <span style={{ fontSize: 13, color: T.sub, flexShrink: 0 }}>ไซส์</span>
                      <b style={{ fontSize: 14, color: T.text }}>{summarizeSizes(allSizes)}</b>
                    </div>
                  )}
                </div>
              );
            })()}
            <div style={{ padding: 14, borderTop: `1px solid ${T.border}`, display: "flex", gap: 8, background: "#f8fafc", borderRadius: "0 0 14px 14px" }}>
              {lineHref && (
                <a href={lineHref} target="_blank" rel="noreferrer" style={{ flex: 1, background: T.line, color: "white", padding: "12px", textAlign: "center", borderRadius: 8, textDecoration: "none", fontWeight: 700, fontSize: 13 }}>💬 ติดต่อ LINE</a>
              )}
              <button onClick={() => { setOrder({ item: detail, qtyMap: {} }); setCustomSizes([]); setNewCustomSize(""); setDetail(null); }}
                style={{ flex: 1, background: T.blue, color: "white", padding: "12px", border: "none", borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>➕ เพิ่มลงตะกร้า</button>
            </div>
          </div>
        </div>
      )}

      {/* ORDER FORM — เลือกขนาด/สี แล้วใส่ตะกร้า */}
      {order && (
        <div onClick={() => closeOrderForm()} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.65)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 110, padding: 12 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "white", borderRadius: 14, maxWidth: 720, width: "100%", maxHeight: "92vh", overflowY: "auto" }}>
              <>
                <div style={{ padding: 16, borderBottom: `1px solid ${T.border}` }}>
                  <div style={{ fontSize: 16, fontWeight: 800 }}>➕ เลือกขนาด: {order.item.model || order.item.name}</div>
                  <div style={{ fontSize: 11, color: T.muted, marginTop: 4 }}>กรอกจำนวนในช่องไซส์ที่ต้องการ → เพิ่มลงตะกร้า</div>
                </div>
                <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ fontSize: 12, color: T.sub, fontWeight: 600, marginTop: 6 }}>รายการสั่งซื้อ (กรอกจำนวนในช่องไซส์ที่ต้องการ)</div>
                  {(() => {
                    const colors = order.item.colors || [];
                    // 📏 เรียงไซส์ด้วย compareSizes (ตัวเดียวกับที่ ERP ใช้)
                    //    ไซส์เด็ก (6,8,10,12) มาก่อน แล้วค่อย S,M,L,XL,2XL...
                    //    เดิม sort เองด้วย localeCompare → "10","12","6","8" (เรียงแบบข้อความ ผิด)
                    const foundSizes = [...new Set(colors.flatMap(c => Object.keys(c.stock || {})))]
                      .filter(sz => sizeFitsItem(order.item, sz))   // 👟 กันไซส์ผิดชนิดที่ค้างในคลัง
                      .sort(compareSizes);
                    // ไม่มีข้อมูลไซส์เลย (สินค้ายังไม่ตั้งสต๊อก) → ใช้ไซส์มาตรฐานตามชนิดสินค้า
                    // ⚠️ รองเท้าใช้เบอร์ 36-45 ไม่ใช่ S-XL → ต้องดู sizeType
                    const baseSizes = foundSizes.length > 0 ? foundSizes : getSizesFor(order.item);
                    // 🛍️ จำกัดเฉพาะไซส์ที่ตั้งไว้ว่ารับผลิต (ไม่ได้ตั้ง = ทุกไซส์)
                    const limit = order.item.catalogSizes;
                    const listedSizes = Array.isArray(limit) && limit.length > 0
                      ? baseSizes.filter(sz => limit.includes(sz))
                      : baseSizes;
                    // ✏️ ไซส์พิเศษที่ลูกค้าพิมพ์เอง (เฉพาะรุ่นที่เปิดรับตัดตามสั่ง)
                    const allSizes = [...listedSizes, ...customSizes.filter(s => !listedSizes.includes(s))];
                    const setQty = (ci, sz, v) => {
                      const qtyMap = { ...(order.qtyMap || {}) };
                      qtyMap[ci] = { ...(qtyMap[ci] || {}) };
                      const n = Math.max(0, Number(v) || 0);
                      if (n === 0) delete qtyMap[ci][sz]; else qtyMap[ci][sz] = n;
                      if (Object.keys(qtyMap[ci]).length === 0) delete qtyMap[ci];
                      setOrder({ ...order, qtyMap });
                    };
                    const grandTotal = Object.values(order.qtyMap || {}).reduce((s, row) => s + Object.values(row).reduce((a,b) => a+b, 0), 0);

                    return (
                      <div style={{ overflowX: "auto", border: `1px solid ${T.border}`, borderRadius: 8 }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                          <thead>
                            <tr style={{ background: "#eef2f7" }}>
                              <th style={{ padding: "8px 10px", textAlign: "left", fontWeight: 700, color: T.blue, borderBottom: `1px solid ${T.border}`, minWidth: 110 }}>สี</th>
                              {allSizes.map(sz => (
                                <th key={sz} style={{ padding: "8px 6px", textAlign: "center", fontWeight: 700, color: T.blue, borderBottom: `1px solid ${T.border}`, borderLeft: `1px solid ${T.border}`, minWidth: 56 }}>{sz}</th>
                              ))}
                              <th style={{ padding: "8px 10px", textAlign: "center", fontWeight: 700, color: T.green, borderBottom: `1px solid ${T.border}`, borderLeft: `1px solid ${T.border}`, minWidth: 60 }}>รวม</th>
                            </tr>
                          </thead>
                          <tbody>
                            {colors.map((c, ci) => {
                              const rowQty = Object.values((order.qtyMap||{})[ci] || {}).reduce((a,b) => a+b, 0);
                              const colorLabel = c.colorName || c.name || guessColorName(c.hex, ci);
                              return (
                                <tr key={ci} style={{ background: ci % 2 ? "#fafbfc" : "white" }}>
                                  <td style={{ padding: "6px 10px", borderBottom: `1px solid ${T.border}` }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                      <div style={{ width: 14, height: 14, borderRadius: 3, background: c.hex || "#ddd", border: "1px solid rgba(0,0,0,.2)" }} />
                                      <span style={{ fontSize: 12, fontWeight: 600 }}>{colorLabel}</span>
                                    </div>
                                  </td>
                                  {/* ✅ กรอกได้ทุกช่อง — ไม่ล็อก/ไม่ระบายสีตามสต๊อก
                                         ของมี/ไม่มี พนักงานแจ้งลูกค้าเองตอนยืนยัน */}
                                  {allSizes.map(sz => {
                                    const val = ((order.qtyMap||{})[ci] || {})[sz] || "";
                                    return (
                                      <td key={sz} style={{ padding: 3, borderLeft: `1px solid ${T.border}`, borderBottom: `1px solid ${T.border}` }}>
                                        <input type="number" min="0" value={val}
                                          onFocus={e => e.target.select()}
                                          onChange={e => setQty(ci, sz, e.target.value)}
                                          style={{ width: "100%", padding: "6px 4px", border: "none", background: "transparent", textAlign: "center", fontSize: 13, fontWeight: 600, color: val ? T.blue : T.text, outline: "none", fontFamily: "inherit" }}
                                        />
                                      </td>
                                    );
                                  })}
                                  <td style={{ padding: "6px 10px", textAlign: "center", borderLeft: `1px solid ${T.border}`, borderBottom: `1px solid ${T.border}`, fontWeight: 700, color: rowQty > 0 ? T.green : T.muted, fontSize: 13 }}>{rowQty || "-"}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                          <tfoot>
                            <tr style={{ background: "#f1f5f9" }}>
                              <td colSpan={allSizes.length + 1} style={{ padding: "8px 10px", textAlign: "right", fontWeight: 700, color: T.sub }}>รวมทั้งหมด</td>
                              <td style={{ padding: "8px 10px", textAlign: "center", fontWeight: 800, color: grandTotal > 0 ? T.green : T.muted, fontSize: 14 }}>{grandTotal || 0}</td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    );
                  })()}

                  {/* ✏️ ไซส์พิเศษ — เฉพาะรุ่นที่เปิดรับตัดตามสั่ง */}
                  {order.item.allowCustomSize && (
                    <div style={{ padding: "10px 12px", background: "rgba(124,58,237,0.05)", border: "1px solid rgba(124,58,237,0.25)", borderRadius: 8 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "#7c3aed", marginBottom: 6 }}>✏️ ต้องการไซส์พิเศษ?</div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                        <input value={newCustomSize} onChange={e => setNewCustomSize(e.target.value)}
                          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addCustomSize(); } }}
                          placeholder="เช่น 7XL, รอบอก 50 นิ้ว"
                          style={{ flex: "1 1 180px", padding: "8px 12px", borderRadius: 7, border: `1px solid ${T.border}`, fontSize: 13, fontFamily: "inherit", outline: "none" }}/>
                        <button onClick={addCustomSize} disabled={!newCustomSize.trim()}
                          style={{ padding: "8px 16px", borderRadius: 7, border: "none", background: newCustomSize.trim() ? "#7c3aed" : "#e2e5ea", color: "white", cursor: newCustomSize.trim() ? "pointer" : "default", fontSize: 13, fontWeight: 700, fontFamily: "inherit" }}>+ เพิ่มไซส์</button>
                      </div>
                      {customSizes.length > 0 && (
                        <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 8 }}>
                          {customSizes.map(sz => (
                            <span key={sz} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 6px 3px 10px", background: "white", border: "1px solid rgba(124,58,237,0.35)", borderRadius: 12, fontSize: 12, color: "#7c3aed", fontWeight: 600 }}>
                              {sz}
                              <button onClick={() => removeCustomSize(sz)} title="เอาออก"
                                style={{ border: "none", background: "transparent", color: T.muted, cursor: "pointer", fontSize: 13, lineHeight: 1, padding: 0 }}>✕</button>
                            </span>
                          ))}
                        </div>
                      )}
                      <div style={{ fontSize: 11, color: T.muted, marginTop: 7, lineHeight: 1.6 }}>
                        เพิ่มแล้วจะมีคอลัมน์ใหม่ในตาราง — กรอกจำนวนได้เลย<br/>
                        ทีมงานจะติดต่อยืนยันราคาไซส์พิเศษอีกครั้ง
                      </div>
                    </div>
                  )}
                </div>
                <div style={{ padding: 14, borderTop: `1px solid ${T.border}`, display: "flex", gap: 8, background: "#f8fafc", borderRadius: "0 0 14px 14px" }}>
                  <button onClick={() => closeOrderForm()} style={{ flex: 1, background: "white", border: `1px solid ${T.border}`, padding: 12, borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}>ยกเลิก</button>
                  <button onClick={() => {
                    // flatten qtyMap → lines
                    const valid = [];
                    Object.entries(order.qtyMap || {}).forEach(([ci, row]) => {
                      const idx = Number(ci);
                      const col = (order.item?.colors || [])[idx];
                      if (!col) return;
                      Object.entries(row).forEach(([size, qty]) => {
                        if (qty > 0) valid.push({
                          colorIdx: idx,
                          color: col.colorName || col.name || guessColorName(col.hex, idx),
                          colorHex: col.hex || "",
                          size: size || "",
                          qty: Number(qty) || 0,
                          // 🏷️ ไซส์ที่ลูกค้าพิมพ์เอง → ทีมงานต้องรู้ว่าไม่มีราคาในระบบ
                          ...(customSizes.includes(size) ? { customSize: true } : {}),
                        });
                      });
                    });
                    if (valid.length === 0) { alert("กรุณากรอกจำนวนอย่างน้อย 1 ช่อง"); return; }
                    addToCart({
                      itemId: order.item?.id || "",
                      itemName: order.item?.model || order.item?.name || "(ไม่ระบุชื่อสินค้า)",
                      itemCategory: order.item?.category || "",
                      lines: valid,
                    });
                    closeOrderForm();
                    setShowCart(true); // เปิดตะกร้าเลย — เห็นสิ่งที่เพิ่งใส่
                  }} style={{ flex: 2, background: T.green, color: "white", padding: 12, border: "none", borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontWeight: 700 }}>➕ เพิ่มลงตะกร้า</button>
                </div>
              </>
          </div>
        </div>
      )}

      {/* 🛒 CART DRAWER */}
      {showCart && (
        <div onClick={()=>setShowCart(false)} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.65)", display: "flex", alignItems: "stretch", justifyContent: "flex-end", zIndex: 120 }}>
          <div onClick={e=>e.stopPropagation()} style={{ background: "white", width: "100%", maxWidth: 540, height: "100%", overflowY: "auto", display: "flex", flexDirection: "column" }}>
            <div style={{ padding: 16, borderBottom: `1px solid ${T.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 800, color: T.text }}>🛒 ตะกร้าสินค้า</div>
                <div style={{ fontSize: 12, color: T.muted, marginTop: 2 }}>{cartTotalItems} รุ่น · {cartTotalQty} ชิ้น</div>
              </div>
              <button onClick={()=>setShowCart(false)} style={{ background: "none", border: `1px solid ${T.border}`, borderRadius: 8, padding: "6px 12px", cursor: "pointer", color: T.sub }}>✕</button>
            </div>

            <div style={{ flex: 1, padding: 16, overflowY: "auto" }}>
              {cart.length === 0 ? (
                <div style={{ textAlign: "center", padding: 60, color: T.muted }}>
                  <div style={{ fontSize: 56 }}>🛒</div>
                  <div style={{ marginTop: 12, fontSize: 14 }}>ตะกร้าว่าง</div>
                  <div style={{ fontSize: 12, marginTop: 6 }}>เลือกสินค้าจากแคตตาล็อกได้เลย</div>
                  <button onClick={()=>setShowCart(false)} style={{ marginTop: 16, background: T.blue, color: "white", padding: "10px 20px", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontFamily: "inherit" }}>← เลือกสินค้า</button>
                </div>
              ) : cart.map((entry, ei) => {
                const entryQty = entry.lines.reduce((s,l)=>s+(l.qty||0),0);
                return (
                  <div key={ei} style={{ background: "#f8fafc", borderRadius: 10, padding: 12, marginBottom: 10, border: `1px solid ${T.border}` }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>📦 {entry.itemName}</div>
                        <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>รวม {entryQty} ชิ้น</div>
                      </div>
                      <button onClick={()=>removeFromCart(ei)} title="ลบทั้งรุ่น" style={{ background: "#fee2e2", color: "#991b1b", border: "none", borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>🗑 ลบ</button>
                    </div>
                    {entry.lines.map((ln, li) => (
                      <div key={li} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", background: "white", borderRadius: 6, marginBottom: 4 }}>
                        <div style={{ width: 14, height: 14, borderRadius: 3, background: ln.colorHex || "#ddd", border: "1px solid rgba(0,0,0,.15)" }} />
                        <span style={{ fontSize: 12, fontWeight: 600, minWidth: 90 }}>{ln.color}</span>
                        <span style={{ fontSize: 12, color: T.sub, minWidth: 50 }}>ไซส์ <b>{ln.size}</b></span>
                        <input type="number" min="1" value={ln.qty} onChange={e=>updateLineQty(ei, li, e.target.value)} onFocus={e=>e.target.select()}
                          style={{ width: 60, padding: "4px 6px", borderRadius: 5, border: `1px solid ${T.border}`, fontSize: 12, textAlign: "center", fontFamily: "inherit" }} />
                        <button onClick={()=>removeLine(ei, li)} style={{ background: "#fee2e2", color: "#991b1b", border: "none", borderRadius: 4, padding: "3px 7px", cursor: "pointer", fontSize: 11 }}>✕</button>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>

            {cart.length > 0 && (
              <div style={{ padding: 14, borderTop: `1px solid ${T.border}`, background: "#f8fafc" }}>
                <button onClick={clearCart} style={{ width: "100%", background: "white", color: T.red, border: `1px solid #fecaca`, padding: 10, borderRadius: 8, marginBottom: 8, cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: 600 }}>🗑 ล้างตะกร้า</button>
                <button onClick={()=>{ setCheckout({ ...loadSavedInfo(), note: "" }); }}
                  style={{ width: "100%", background: T.green, color: "white", border: "none", padding: 14, borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: 14 }}>
                  💳 ดำเนินการสั่งซื้อ ({cartTotalQty} ชิ้น)
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 💳 CHECKOUT MODAL */}
      {checkout && (
        <div onClick={()=>!sent && setCheckout(null)} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 130, padding: 12 }}>
          <div onClick={e=>e.stopPropagation()} style={{ background: "white", borderRadius: 14, maxWidth: 480, width: "100%", maxHeight: "92vh", overflowY: "auto" }}>
            {sent ? (
              <div style={{ padding: 36, textAlign: "center" }}>
                <div style={{ fontSize: 56 }}>✅</div>
                <div style={{ fontSize: 18, fontWeight: 700, marginTop: 10, color: T.green }}>ส่งคำสั่งซื้อเรียบร้อย!</div>
                <div style={{ fontSize: 13, color: T.sub, marginTop: 6 }}>ทีมงานจะติดต่อกลับโดยเร็ว</div>
                <button onClick={()=>{ setCheckout(null); setShowCart(false); setSent(false); clearCart(); }} style={{ marginTop: 18, background: T.blue, color: "white", padding: "10px 26px", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontFamily: "inherit" }}>ปิด</button>
              </div>
            ) : (
              <>
                <div style={{ padding: 16, borderBottom: `1px solid ${T.border}` }}>
                  <div style={{ fontSize: 16, fontWeight: 800 }}>💳 ข้อมูลการสั่งซื้อ</div>
                  <div style={{ fontSize: 11, color: T.muted, marginTop: 4 }}>{cartTotalItems} รุ่น · {cartTotalQty} ชิ้น · ทีมงานจะติดต่อยืนยันยอด</div>
                </div>
                <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
                  {/* 💾 เติมข้อมูลเดิมให้ — บอกให้รู้ว่ามาจากไหน + ล้างได้ (เผื่อสั่งแทนคนอื่น) */}
                  {hasSavedInfo() && (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "7px 11px", background: "rgba(58,122,82,0.07)", border: `1px solid rgba(58,122,82,0.25)`, borderRadius: 8, fontSize: 11, color: T.green }}>
                      ✅ กรอกข้อมูลเดิมให้แล้ว — แก้ไขได้ตามต้องการ
                      <button onClick={clearSavedInfo}
                        style={{ marginLeft: "auto", background: "white", border: `1px solid ${T.border}`, color: T.sub, padding: "3px 10px", borderRadius: 6, cursor: "pointer", fontSize: 11, fontFamily: "inherit" }}>
                        ล้าง / สั่งให้คนอื่น
                      </button>
                    </div>
                  )}
                  <Field label="ชื่อ / ร้านค้า *" value={checkout.name} onChange={v=>setCheckout({...checkout, name: v})} />
                  <Field label="เบอร์โทร *" value={checkout.phone} onChange={v=>setCheckout({...checkout, phone: v})} />
                  <Field label="ที่อยู่จัดส่ง" value={checkout.address} onChange={v=>setCheckout({...checkout, address: v})} textarea />
                  <Field label="หมายเหตุ (ถ้ามี)" value={checkout.note} onChange={v=>setCheckout({...checkout, note: v})} textarea />
                </div>
                <div style={{ padding: 14, borderTop: `1px solid ${T.border}`, display: "flex", gap: 8, background: "#f8fafc", borderRadius: "0 0 14px 14px" }}>
                  <button onClick={()=>setCheckout(null)} style={{ flex: 1, background: "white", border: `1px solid ${T.border}`, padding: 12, borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}>← กลับ</button>
                  <button onClick={async()=>{
                    if (!checkout.name.trim() || !checkout.phone.trim()) { alert("กรุณากรอกชื่อและเบอร์โทร"); return; }
                    saveInfo(checkout); // 💾 จำไว้ให้ครั้งหน้า
                    try {
                      // 🛒 multi-item payload
                      const payload = {
                        // 🔗 มาจากลิงก์ส่วนตัว → ติด id ไปด้วย ตอนแปลงเป็นใบสั่งของจะจับคู่ลูกค้าให้เลย
                        ...(linkedCustomer ? { customerId: linkedCustomer.id } : {}),
                        customerName: (checkout.name||"").trim(),
                        phone: (checkout.phone||"").trim(),
                        address: (checkout.address||"").trim(),
                        note: (checkout.note||"").trim(),
                        items: cart.map(e => ({
                          itemId: e.itemId || "",
                          itemName: e.itemName || "",
                          itemCategory: e.itemCategory || "",
                          lines: e.lines.map(l => ({
                            colorIdx: typeof l.colorIdx === "number" ? l.colorIdx : 0,
                            color: l.color || "",
                            colorHex: l.colorHex || "",
                            size: l.size || "",
                            qty: Number(l.qty) || 0,
                          })),
                        })),
                        // backward-compat: ส่งของรุ่นแรกเป็น top-level fields ด้วย (Inbox/Convert เก่าจะอ่านได้)
                        itemId: cart[0]?.itemId || "",
                        itemName: cart[0]?.itemName || "(หลายรุ่น)",
                        itemCategory: cart[0]?.itemCategory || "",
                        lines: cart.flatMap(e => e.lines.map(l => ({
                          ...l,
                          itemId: e.itemId, itemName: e.itemName,
                        }))),
                        totalQty: cartTotalQty,
                        status: "new",
                        source: "catalog",
                        createdAt: serverTimestamp(),
                      };
                      const clean = JSON.parse(JSON.stringify(payload, (k,v) => v === undefined ? null : v));
                      clean.createdAt = serverTimestamp();
                      const ref = await addDoc(collection(db,"catalogOrders"), clean);
                      rememberMyOrder(ref.id); // 🧾 จำไว้ให้ลูกค้าตามดู/ยกเลิกเองได้
                      setSent(true);
                    } catch (e) {
                      alert("เกิดข้อผิดพลาด: " + e.message);
                    }
                  }} style={{ flex: 2, background: T.green, color: "white", padding: 12, border: "none", borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontWeight: 700 }}>📨 ส่งคำสั่งซื้อ</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* FOOTER */}
      <div style={{ borderTop: `1px solid ${T.border}`, padding: "20px", textAlign: "center", fontSize: 11, color: T.muted, background: "white" }}>
        © {new Date().getFullYear()} {company.name || "CPU"} • Powered by CPU ERP
      </div>
    </div>
  );
}

function Field({ label, value, onChange, textarea = false }) {
  return (
    <div>
      <label style={{ fontSize: 11, color: T.sub, fontWeight: 600, display: "block", marginBottom: 4 }}>{label}</label>
      {textarea ? (
        <textarea value={value} onChange={e => onChange(e.target.value)} rows={2}
          style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: `1px solid ${T.border}`, fontSize: 13, fontFamily: "inherit", resize: "vertical", boxSizing: "border-box" }} />
      ) : (
        <input value={value} onChange={e => onChange(e.target.value)}
          style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: `1px solid ${T.border}`, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }} />
      )}
    </div>
  );
}
