// 🔎 ค้นหาทั้งระบบ — ยิงหา Firestore ตรง ๆ ไม่สนว่าโหลดช่วงวันที่ไหนมา
//
// ปัญหาที่แก้: หน้าใบสั่งของ/บิล โหลดมาแค่ช่วงวันที่ (2 วัน / 30 วัน)
// พนักงานพิมพ์เลขใบของเดือนที่แล้วแล้วไม่เจอ → นึกว่าใบหาย
// ตัวนี้จะไปถามฐานข้อมูลเองทุกครั้ง จึงเจอเสมอไม่ว่าใบนั้นเก่าแค่ไหน
//
// 🧩 ค้นชื่อลูกค้า "ตรงไหนก็ได้" ทำได้ยังไง (Firestore ไม่มี LIKE '%คำ%')
//    ทาง A — ทะเบียนลูกค้าโหลดครบอยู่ในแอปแล้ว ค้นในหน่วยความจำได้เลย (ตรงกลางก็เจอ)
//            แล้วเอา customerId / ชื่อเต็ม ไปถามใบสั่งของ+บิลแบบ "เท่ากับ" ซึ่งเร็วและ
//            ใช้ได้กับ "ข้อมูลเก่าทั้งหมด" โดยไม่ต้องแก้อะไรย้อนหลัง  ← ทางหลัก
//    ทาง B — ลูกค้าที่ไม่ได้อยู่ในทะเบียน (ขายครั้งเดียว) ใช้ nameGrams ที่ฝังไว้ตอนบันทึก
//            (ชื่อถูกหั่นเป็นชิ้นละ 3 ตัวอักษร) แล้วค้นด้วย array-contains
//    ทาง C — เอกสารเก่าที่ยังไม่มี nameGrams ใช้ "ขึ้นต้นด้วย" เป็นตาข่ายรองสุดท้าย
//
// ⚠️ ทุก query ในไฟล์นี้ใช้ index อัตโนมัติของ Firestore — ไม่ต้องสร้าง composite index
import { collection, query, where, limit, getDocs } from "firebase/firestore";
import { phoneKeyOf, nameKeyOf, gramKeyOf, nameGramsOf, GRAM_LEN } from "./searchKeys";

const PER_KIND = 25;
const GRAM_SCAN = 80;   // ดึงมาเท่านี้แล้วค่อยกรองต่อในเครื่อง (ชิ้น 3 ตัวอักษรอาจซ้ำกันหลายชื่อ)
const MAX_IN = 25;      // Firestore จำกัดค่าใน where(..,"in",[..])
// อักขระท้ายสุดของ Firestore (U+F8FF) — ใช้ปิดท้ายช่วงเพื่อทำ "ขึ้นต้นด้วย"
// ⚠️ สร้างจากรหัสตัวอักษร ไม่ใช่พิมพ์ตัวจริง — ตัวจริงมองไม่เห็นและหลุดง่ายเวลาแก้ไฟล์
const HIGH = String.fromCharCode(0xf8ff);

// เดาว่าผู้ใช้พิมพ์อะไรมา
export function classifyQuery(raw) {
  const s = String(raw || "").trim();
  if (!s) return { kind: "empty", term: "" };
  const digits = s.replace(/\D/g, "");
  // เลขล้วน 6 ตัวขึ้นไป → เบอร์โทร
  if (/^[\d\s\-+()]+$/.test(s) && digits.length >= 6) return { kind: "phone", term: phoneKeyOf(s) };
  // มีทั้งตัวอักษรและตัวเลข เช่น INV6908-0003 / ORD6908-0121 → เลขที่เอกสาร
  if (/[A-Za-z]/.test(s) && /\d/.test(s)) return { kind: "docNo", term: s.toUpperCase().replace(/\s+/g, "") };
  return { kind: "name", term: nameKeyOf(s), gram: gramKeyOf(s) };
}

const rows = (snap, type) => snap.docs.map(d => ({ ...d.data(), id: d.id, _type: type }));

// รวมผลจากหลาย query แล้วตัดตัวซ้ำด้วย id
const dedupe = (list) => {
  const seen = new Set();
  return list.filter(r => { const k = `${r._type}:${r.id}`; if (seen.has(k)) return false; seen.add(k); return true; });
};

// query ที่ล้มเหลว (เช่น field ยังไม่มีในเอกสารเก่า) ไม่ควรทำให้ทั้งการค้นหาพัง
const safe = (p) => p.then(v => v).catch(e => { console.warn("[globalSearch]", e?.message || e); return null; });

const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };

// ── ค้นเลขที่เอกสาร / เบอร์โทร ──────────────────────────────
function docNoQueries(col, numField, term) {
  return [
    query(col, where(numField, "==", term), limit(5)),
    // เผื่อพิมพ์เลขท้ายไม่ครบ → หาแบบขึ้นต้นด้วย
    query(col, where(numField, ">=", term), where(numField, "<=", term + HIGH), limit(PER_KIND)),
  ];
}

function phoneQueries(col, term) {
  return [
    query(col, where("phoneKey", "==", term), limit(PER_KIND)),
    // 🕰️ เอกสารเก่าที่บันทึกก่อนมี phoneKey — หาจากเบอร์ดิบด้วย
    query(col, where("customerPhone", "==", term), limit(PER_KIND)),
  ];
}

// ── ค้นชื่อลูกค้า "ตรงไหนก็ได้" ─────────────────────────────
// matchedCustomers = ลูกค้าในทะเบียนที่ชื่อมีคำค้นอยู่ (หามาจากในหน่วยความจำ)
function nameQueries(col, { term, gram }, matchedCustomers) {
  const qs = [];

  // ทาง A — ผูกกับลูกค้าในทะเบียนที่เจอแล้ว (ใช้ได้กับข้อมูลเก่าทั้งหมด)
  const ids = matchedCustomers.map(c => c.id).filter(Boolean);
  chunk(ids, MAX_IN).forEach(part => qs.push(query(col, where("customerId", "in", part), limit(PER_KIND * 2))));
  const names = [...new Set(matchedCustomers.map(c => c.name).filter(Boolean))];
  chunk(names, MAX_IN).forEach(part => qs.push(query(col, where("customerName", "in", part), limit(PER_KIND * 2))));

  // ทาง B — ชื่อที่ไม่ได้อยู่ในทะเบียน: หาจากชิ้นส่วน 3 ตัวอักษร
  if (gram.length >= GRAM_LEN) {
    const g = nameGramsOf(gram)[0];
    if (g) qs.push(query(col, where("nameGrams", "array-contains", g), limit(GRAM_SCAN)));
  }

  // ทาง C — เอกสารเก่าที่ยังไม่มี nameGrams: "ขึ้นต้นด้วย"
  qs.push(query(col, where("nameKey", ">=", term), where("nameKey", "<=", term + HIGH), limit(PER_KIND)));
  qs.push(query(col, where("customerName", ">=", term), where("customerName", "<=", term + HIGH), limit(PER_KIND)));

  return qs;
}

async function searchDocs(db, name, type, c, numField, matchedCustomers) {
  const col = collection(db, name);
  let qs = [];
  if (c.kind === "docNo") qs = docNoQueries(col, numField, c.term);
  else if (c.kind === "phone") qs = phoneQueries(col, c.term);
  else if (c.kind === "name") qs = nameQueries(col, c, matchedCustomers);

  const snaps = await Promise.all(qs.map(q => safe(getDocs(q))));
  let out = dedupe(snaps.filter(Boolean).flatMap(s => rows(s, type)));

  // ทาง B ดึงมาเกิน (ชิ้น 3 ตัวอักษรตรงกัน ไม่ได้แปลว่าทั้งคำตรง) → กรองซ้ำในเครื่อง
  // ใบที่ผูกกับลูกค้าที่เจอแล้วให้ผ่านเสมอ แม้ชื่อในใบจะสะกดไม่เหมือนทะเบียน
  if (c.kind === "name") {
    const okIds = new Set(matchedCustomers.map(x => x.id));
    out = out.filter(r => okIds.has(r.customerId) || gramKeyOf(r.customerName).includes(c.gram));
  }
  return out;
}

// ── ทะเบียนลูกค้า ───────────────────────────────────────────
// โหลดครบอยู่ในแอปแล้ว → ค้น "ตรงไหนก็ได้" ในหน่วยความจำ เร็วและไม่เปลืองโควต้าอ่าน
export function matchCustomersInMemory(customers, { kind, term, gram }) {
  if (!Array.isArray(customers) || !customers.length) return [];
  if (kind === "name") {
    return customers.filter(c => gramKeyOf(c.name).includes(gram)).slice(0, MAX_IN * 2);
  }
  if (kind === "phone") {
    return customers.filter(c => phoneKeyOf(c.phone) === term).slice(0, MAX_IN);
  }
  return [];
}

// เรียงใหม่→เก่า (createdAt เป็น Timestamp; ถ้าไม่มีให้ไปท้ายสุด)
const byNewest = (a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0);

/**
 * ค้นหาทั้งระบบ
 * @param customers ทะเบียนลูกค้าที่แอปโหลดไว้แล้ว (ใช้ค้นชื่อแบบตรงไหนก็ได้)
 * @returns { kind, term, orders[], invoices[], customers[] }
 */
export async function globalSearch(db, raw, customers = []) {
  const c = classifyQuery(raw);
  if (c.kind === "empty") return { ...c, orders: [], invoices: [], customers: [] };

  // หาลูกค้าในทะเบียนก่อน — ผลนี้เป็นตัวตั้งต้นของการค้นใบสั่งของ/บิล
  const hitCustomers = matchCustomersInMemory(customers, c);

  const [orders, invoices] = await Promise.all([
    searchDocs(db, "orders", "order", c, "orderNo", hitCustomers),
    searchDocs(db, "invoices", "invoice", c, "invoiceNo", hitCustomers),
  ]);

  return {
    ...c,
    orders: orders.sort(byNewest),
    invoices: invoices.sort(byNewest),
    customers: hitCustomers.map(x => ({ ...x, _type: "customer" })),
  };
}
