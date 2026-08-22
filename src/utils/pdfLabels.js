// 📄 อ่านใบปะหน้าของแพลตฟอร์มจากไฟล์ PDF
//
// ทำไมต้องมี: ลูกค้าส่ง "ใบปะหน้า" มาให้เราแปะอยู่แล้ว ไม่ได้ส่งไฟล์รายการสินค้า
// ถ้าอ่านใบปะหน้าเองได้ = ไม่ต้องขออะไรเพิ่มจากลูกค้า และไม่ต้องนั่งอ่านทีละใบ
//
// ── ทดสอบกับไฟล์จริง 2 แพลตฟอร์ม ────────────────────────────
//   Shopee + SPX    9 ใบ
//   TikTok  + J&T 307 ใบ
// สองเจ้าวางหน้ากระดาษคนละแบบสิ้นเชิง จึงไม่ยึดรูปแบบใดรูปแบบหนึ่ง
// แต่ยึด "หัวตาราง" (Item / V Name / SKU / Qty) แล้วอ่านตามคอลัมน์ — ทั้งสองเจ้ามีเหมือนกัน
//
// ⚠️ กับดักที่เจอจากของจริงทั้งนั้น
//
// 1) ห้ามต่อข้อความตรง ๆ ต้องอ่านตามพิกัด
//    สระ/วรรณยุกต์ไทยถูกวาดเป็นชิ้นแยก และลำดับในไฟล์ไม่ใช่ลำดับที่อ่าน
//    ต่อดื้อ ๆ ได้ "่น K11รุ" (สลับที่)
//    (pdftotext ของ poppler ดึงภาษาไทยได้ 0 ตัวอักษร ทั้งที่ตารางแปลงอยู่ครบในไฟล์
//     เป็นข้อจำกัดของเครื่องมือนั้น ไม่ใช่ของไฟล์ · pdf.js อ่านได้ถูกต้อง)
//
// 2) 🔥 หน้าหนึ่งพิมพ์ตารางสินค้า "สองชุดซ้อนกัน"
//    ชุดบนคือส่วนป้ายติดกล่อง ชุดล่างคือใบแนบของ — เนื้อหาเดียวกันแต่คนละคอลัมน์คนละกริด
//    และแถวของสองชุดสลับกันไปมาตามแนวตั้ง (124=ชุดA, 116=ชุดB, 114=ชุดA, 108=ชุดB ...)
//    ถ้าแยกด้วย y หรือรวมทั้งคอลัมน์ จะได้สองชุดปนกันจนอ่านไม่ออก
//    เช่น SKU "โคตรถูก8_กุด4874" กลายเป็น "โคตรถูก8_กุ8_กุด4874ด4874"
//    → แยกด้วย "แถวนี้ชิดคอลัมน์ของหัวตารางไหน" เพราะข้อความในแถวเดียวกัน
//      ต้องเป็นของตารางเดียวกันเสมอ
//
// 3) เนื้อหาในช่องตัดบรรทัดเอง ชื่อสินค้ายาว ๆ กินไป 2-3 แถว
//    ต้องต่อทุกแถวของระเบียนเดียวกัน "แยกตามคอลัมน์"
//
// 4) วรรณยุกต์บางตัวหายหรืออยู่ในย่านอักขระพิเศษ — ตัวจับคู่ใน packImport.js จัดการให้แล้ว

let pdfjsPromise = null;
async function getPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = await import("pdfjs-dist");
      // ⚙️ ต้องชี้ไฟล์ worker ให้ pdf.js เสมอ — ตั้งเป็นค่าว่างไม่ได้
      //    v4 ขึ้นไปจะโยน No "GlobalWorkerOptions.workerSrc" specified ทันที
      //
      //    ใช้ไฟล์ใน public/ (ก็อปมาโดย scripts/copy-pdf-worker.js ตอน build)
      //    ห้ามให้ webpack เป็นคนจัดการไฟล์นี้ — CRA จะเอาไปผ่าน Babel
      //    แล้วเขียน import เป็น path ของเครื่องที่ build (/vercel/path0/...)
      //    ซึ่งบนเว็บไม่มี → worker พัง แล้วตกไป fake worker ที่พังตามอีกที
      if (pdfjs.GlobalWorkerOptions && !pdfjs.GlobalWorkerOptions.workerSrc) {
        const base = process.env.PUBLIC_URL || "";
        pdfjs.GlobalWorkerOptions.workerSrc = `${base}/pdf.worker.min.mjs`;
      }
      return pdfjs;
    })();
  }
  return pdfjsPromise;
}

const HDR_RE = /^(#|no\.?|item|v\s*name|name|product\s*name|seller\s*sku|sku|qty|quantity|จ[ําำ]นวน|ชื่อสินค|ตัวเลือก)$/i;
const ROW_TOL = 2;      // ความคลาดเคลื่อนของ y ที่ยังถือว่าเป็นแถวเดียวกัน
const COL_TOL = 5;      // ความคลาดเคลื่อนของ x ที่ยังถือว่าชิดคอลัมน์นั้น

const pieces = (items) => items
  .filter(i => i && typeof i.str === "string" && i.str.trim() !== "")
  .map(i => ({ s: i.str, x: i.transform ? i.transform[4] : 0, y: i.transform ? i.transform[5] : 0 }));

// จับชิ้นข้อความเป็นแถวตามพิกัด y
function toRows(ps) {
  const by = new Map();
  ps.forEach(p => {
    const k = Math.round(p.y / ROW_TOL);
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(p);
  });
  return [...by.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, v]) => ({ y: v[0].y, cells: v.sort((a, b) => a.x - b.x) }));
}

// หาหัวตารางทุกชุดในหน้า — คืน [{ y, cols:[{name,x}] }] เรียงจากบนลงล่าง
function findHeaders(ps) {
  const cand = ps.filter(p => HDR_RE.test(p.s.trim()));
  const by = new Map();
  cand.forEach(p => {
    const k = Math.round(p.y / 3);
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(p);
  });
  const out = [];
  by.forEach(v => {
    const names = v.map(p => p.s.trim().toLowerCase());
    const hasQty = names.some(n => /^(qty|quantity|จ[ําำ]นวน)$/.test(n));
    const hasName = names.some(n => /(item|name|ชื่อสินค)/.test(n));
    if (!hasQty || !hasName || v.length < 3) return;
    out.push({ y: v[0].y, cols: v.sort((a, b) => a.x - b.x).map(p => ({ name: p.s.trim(), x: p.x })) });
  });
  return out.sort((a, b) => b.y - a.y);
}

// แถวนี้ชิดคอลัมน์ของหัวตารางชุดไหนมากกว่ากัน
const alignScore = (row, hdr) =>
  row.cells.reduce((n, c) => n + (hdr.cols.some(k => Math.abs(c.x - k.x) <= COL_TOL) ? 1 : 0), 0);

// อ่านตารางหนึ่งชุด → ระเบียนเดียว
// ตั้งใจอ่านใบละ 1 รายการ เพราะ 1 ออเดอร์บนแพลตฟอร์ม = 1 ชิ้นแทบทุกครั้ง
// ใบที่มีหลายรายการจะถูก quality() ตีเป็น "อ่านไม่ออก" แล้วให้คนนับเอง
// ปลอดภัยกว่าเดาแล้วยุบจำนวนผิด
function readTable(rows, hdr) {
  const cols = hdr.cols.map((c, i) => ({
    key: c.name.toLowerCase(),
    x0: c.x - COL_TOL,
    x1: i + 1 < hdr.cols.length ? hdr.cols[i + 1].x - COL_TOL : Infinity,
    parts: [],
  }));
  rows.forEach(r => r.cells.forEach(c => {
    const col = cols.find(k => c.x >= k.x0 && c.x < k.x1);
    if (col) col.parts.push({ s: c.s, x: c.x, rowY: r.y });
  }));
  const colOf = (pred) => cols.find(k => pred(k.key));
  const textOf = (pred) => {
    const col = colOf(pred);
    if (!col) return "";
    return col.parts.sort((a, b) => (b.rowY - a.rowY) || (a.x - b.x))
      .map(q => q.s).join("").replace(/\s+/g, " ").trim();
  };
  const isQty = (k) => /^(qty|quantity|จ[ําำ]นวน)$/.test(k);
  const qtyCol = colOf(isQty);
  const qtyParts = qtyCol ? qtyCol.parts.length : 0;
  const digits = String(textOf(isQty)).replace(/\D/g, "");
  return {
    name: textOf(k => /(item|^name|product\s*name|ชื่อสินค)/.test(k) && !/seller/.test(k)),
    variation: textOf(k => /(v\s*name|ตัวเลือก)/.test(k)) || textOf(k => k === "sku"),
    sku: textOf(k => /seller\s*sku/.test(k)) || textOf(k => k === "sku"),
    // 🔒 ช่องจำนวนต้องมีข้อความ "ชิ้นเดียว" เท่านั้น
    //    ถ้ามีหลายชิ้น = ตารางสองชุดปนกัน หรือใบนี้มีสินค้าหลายรายการ
    //    ทั้งสองกรณีทำให้เลขต่อกันเป็นจำนวนปลอม ("1"+"1" → 11, "1"+"1"+"1" → 111)
    //    เคยหลุดมาแล้วตอนทดสอบ เกือบตัดสต๊อก 111 ชิ้นจากใบที่สั่งจริง 1 ชิ้น
    //    ช่องจำนวนไม่มีวันตัดบรรทัด จึงใช้ "ต้องมีชิ้นเดียว" เป็นเกณฑ์ได้เต็มปาก
    qty: (qtyParts === 1 && digits && digits.length <= 2) ? parseInt(digits, 10) : null,
  };
}

// คุณภาพของสิ่งที่อ่านได้ — ใช้ 2 อย่าง: เลือกตารางที่ดีกว่า และตัดสินว่าเชื่อได้ไหม
// หักคะแนนแรงถ้าคำที่เป็น "หัวตาราง" โผล่ในเนื้อหา = แบ่งเขตคอลัมน์ผิด ข้อมูลปนกันแล้ว
const LEAK_RE = /(Item|V\s*Name|SKU|Qty|Product Name|Seller SKU|Package ID|NickName|Order ID|Store Name)/i;
const quality = (r) =>
  (r.name && r.name.length > 8 ? 2 : 0) +
  (/_/.test(r.sku || "") ? 2 : 0) +
  (/,/.test(r.variation || "") ? 1 : 0) +
  (r.qty && r.qty >= 1 && r.qty <= 20 ? 1 : -6) +
  (LEAK_RE.test(r.name || "") ? -5 : 0) +
  (LEAK_RE.test(r.sku || "") ? -5 : 0) +
  (LEAK_RE.test(r.variation || "") ? -4 : 0);

function parsePage(ps) {
  const headers = findHeaders(ps);
  if (!headers.length) return null;
  const rows = toRows(ps);
  const footY = ps.filter(p => /Store Name|Total\s*:/i.test(p.s)).map(p => p.y).sort((a, b) => b - a)[0];
  const body = rows.filter(r => r.y < headers[headers.length - 1].y - 1 && (footY == null || r.y > footY + 1));

  // แจกแถวให้หัวตารางที่มันชิดที่สุด — แถวเดียวกันต้องเป็นของตารางเดียวกันเสมอ
  const buckets = headers.map(() => []);
  body.forEach(r => {
    let best = -1, bestScore = 0;
    headers.forEach((h, i) => {
      const sc = alignScore(r, h);
      if (sc > bestScore) { bestScore = sc; best = i; }
    });
    if (best >= 0) buckets[best].push(r);
  });

  // อ่านทุกชุดแล้วเอาชุดที่อ่านออกดีที่สุด
  let best = null;
  headers.forEach((h, i) => {
    if (!buckets[i].length) return;
    const r = readTable(buckets[i], h);
    const q = quality(r);
    if (!best || q > best.q) best = { ...r, q };
  });
  // คุณภาพไม่ถึงเกณฑ์ = บอกว่าอ่านไม่ออก ดีกว่าเดาแล้วไปตัดสต๊อกและออกบิลผิด
  return best && best.q >= 4 ? best : null;
}

/**
 * อ่านไฟล์ใบปะหน้า PDF → RawRow[] ชุดเดียวกับที่ตัววางข้อความ/Excel คืน
 * @param {File|ArrayBuffer} file
 * @param {(done:number,total:number)=>void} [onProgress]
 */
export async function readLabelPdf(file, onProgress) {
  const pdfjs = await getPdfjs();
  const data = file instanceof ArrayBuffer ? file : await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
  const rows = [];
  let skipped = 0;
  const total = doc.numPages;
  for (let p = 1; p <= total; p++) {
    let rec = null;
    try {
      const page = await doc.getPage(p);
      rec = parsePage(pieces((await page.getTextContent()).items || []));
      page.cleanup?.();
    } catch (e) { rec = null; }
    if (rec) {
      rows.push({
        productText: rec.name,
        optionText: rec.variation,
        skuText: rec.sku,
        colorText: "", sizeText: "",
        qty: rec.qty,
        raw: `${rec.name} | ${rec.variation} | ${rec.sku}`,
        page: p,
      });
    } else skipped++;              // อ่านใบนี้ไม่ออก — นับไว้ ไม่ทิ้งเงียบ
    if (onProgress && (p % 5 === 0 || p === total)) onProgress(p, total);
  }
  try { await doc.destroy(); } catch (e) { /* ไม่สำคัญ */ }
  return { rows, pages: total, skipped };
}

export const isPdf = (f) => !!f && (/\.pdf$/i.test(f.name || "") || f.type === "application/pdf");
