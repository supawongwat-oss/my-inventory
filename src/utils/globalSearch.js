// 🔎 ค้นหาทั้งระบบ — ยิงหา Firestore ตรง ๆ ไม่สนว่าโหลดช่วงวันที่ไหนมา
//
// ปัญหาที่แก้: หน้าใบสั่งของ/บิล โหลดมาแค่ช่วงวันที่ (2 วัน / 30 วัน)
// พนักงานพิมพ์เลขใบของเดือนที่แล้วแล้วไม่เจอ → นึกว่าใบหาย
// ตัวนี้จะไปถามฐานข้อมูลเองทุกครั้ง จึงเจอเสมอไม่ว่าใบนั้นเก่าแค่ไหน
//
// ⚠️ ข้อจำกัดของ Firestore: ค้นแบบ "มีคำนี้อยู่ตรงกลาง" ไม่ได้
//    ทำได้แค่ "เท่ากับ" (เลขใบ/เบอร์โทร) และ "ขึ้นต้นด้วย" (ชื่อลูกค้า)
//    ทุก query ในไฟล์นี้ใช้ index อัตโนมัติของ Firestore — ไม่ต้องสร้าง composite index
import { collection, query, where, limit, getDocs } from "firebase/firestore";
import { phoneKeyOf, nameKeyOf } from "./searchKeys";

const PER_KIND = 25;
// อักขระท้ายสุดของ Firestore (U+F8FF) — ใช้ปิดท้ายช่วงเพื่อทำ "ขึ้นต้นด้วย"
const HIGH = "";

// เดาว่าผู้ใช้พิมพ์อะไรมา
export function classifyQuery(raw) {
  const s = String(raw || "").trim();
  if (!s) return { kind: "empty", term: "" };
  const digits = s.replace(/\D/g, "");
  // เลขล้วน 6 ตัวขึ้นไป → เบอร์โทร
  if (/^[\d\s\-+()]+$/.test(s) && digits.length >= 6) return { kind: "phone", term: phoneKeyOf(s) };
  // มีทั้งตัวอักษรและตัวเลข เช่น INV6908-0003 / ORD6908-0121 → เลขที่เอกสาร
  if (/[A-Za-z]/.test(s) && /\d/.test(s)) return { kind: "docNo", term: s.toUpperCase().replace(/\s+/g, "") };
  return { kind: "name", term: nameKeyOf(s) };
}

const rows = (snap, type) => snap.docs.map(d => ({ ...d.data(), id: d.id, _type: type }));

// รวมผลจากหลาย query แล้วตัดตัวซ้ำด้วย id
const dedupe = (list) => {
  const seen = new Set();
  return list.filter(r => { const k = `${r._type}:${r.id}`; if (seen.has(k)) return false; seen.add(k); return true; });
};

// query ที่ล้มเหลว (เช่น field ยังไม่มีในเอกสารเก่า) ไม่ควรทำให้ทั้งการค้นหาพัง
const safe = (p) => p.then(v => v).catch(e => { console.warn("[globalSearch]", e?.message || e); return null; });

async function searchDocs(db, name, type, { kind, term }, numField) {
  const col = collection(db, name);
  const qs = [];
  if (kind === "docNo") {
    qs.push(query(col, where(numField, "==", term), limit(5)));
    // เผื่อพิมพ์เลขท้ายไม่ครบ → หาแบบขึ้นต้นด้วย
    qs.push(query(col, where(numField, ">=", term), where(numField, "<=", term + HIGH), limit(PER_KIND)));
  } else if (kind === "phone") {
    qs.push(query(col, where("phoneKey", "==", term), limit(PER_KIND)));
    // 🕰️ เอกสารเก่าที่บันทึกก่อนมี phoneKey — หาจากเบอร์ดิบด้วย
    qs.push(query(col, where("customerPhone", "==", term), limit(PER_KIND)));
  } else if (kind === "name") {
    qs.push(query(col, where("nameKey", ">=", term), where("nameKey", "<=", term + HIGH), limit(PER_KIND)));
    // 🕰️ เอกสารเก่า — เทียบชื่อดิบแบบขึ้นต้นด้วย
    qs.push(query(col, where("customerName", ">=", term), where("customerName", "<=", term + HIGH), limit(PER_KIND)));
  }
  const snaps = await Promise.all(qs.map(q => safe(getDocs(q))));
  return dedupe(snaps.filter(Boolean).flatMap(s => rows(s, type)));
}

// ทะเบียนลูกค้า — ชื่อ field ต่างจากใบสั่งของ (name/phone ไม่ใช่ customerName/customerPhone)
async function searchCustomers(db, { kind, term }) {
  const col = collection(db, "customers");
  const qs = [];
  if (kind === "phone") {
    qs.push(query(col, where("phoneKey", "==", term), limit(PER_KIND)));
    qs.push(query(col, where("phone", "==", term), limit(PER_KIND)));
  } else if (kind === "name") {
    qs.push(query(col, where("name", ">=", term), where("name", "<=", term + HIGH), limit(PER_KIND)));
  } else {
    return [];
  }
  const snaps = await Promise.all(qs.map(q => safe(getDocs(q))));
  return dedupe(snaps.filter(Boolean).flatMap(s => rows(s, "customer")));
}

// เรียงใหม่→เก่า (createdAt เป็น Timestamp; ถ้าไม่มีให้ไปท้ายสุด)
const byNewest = (a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0);

/**
 * ค้นหาทั้งระบบ
 * @returns { kind, term, orders[], invoices[], customers[] }
 */
export async function globalSearch(db, raw) {
  const c = classifyQuery(raw);
  if (c.kind === "empty") return { ...c, orders: [], invoices: [], customers: [] };

  const [orders, invoices, customers] = await Promise.all([
    searchDocs(db, "orders", "order", c, "orderNo"),
    searchDocs(db, "invoices", "invoice", c, "invoiceNo"),
    searchCustomers(db, c),
  ]);

  return { ...c, orders: orders.sort(byNewest), invoices: invoices.sort(byNewest), customers };
}
