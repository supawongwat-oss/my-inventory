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
//
// 5) 🔑 ตัวแบ่งสองชุดที่ใช้ได้จริงคือ "ขนาดตัวอักษร" ไม่ใช่พิกัด
//    ชุดป้ายติดกล่องใช้ 10pt ชุดใบแนบใช้ 6.89pt — ไม่ปนกันสักชิ้นในไฟล์จริง 307 ใบ
//    ส่วนพิกัดแยกไม่ออก เพราะคอลัมน์ของสองชุดห่างกันแค่ ~4 หน่วย (125.3 กับ 121.4)
//    ซึ่งน้อยกว่าความคลาดเคลื่อนที่ต้องเผื่อไว้ ทำให้แถวของชุดหนึ่งไปเข้าอีกชุดได้
//
// 6) ใบหนึ่งมีสินค้าได้หลายรายการ (สั่งหลายตัวในออเดอร์เดียว)
//    แยกรายการด้วย "เลขลำดับ" ในคอลัมน์แรก โดยจับแถวเข้าเลขที่ใกล้ที่สุดตามแนวตั้ง
//    (เลขลำดับพิมพ์อยู่กึ่งกลางของรายการ ไม่ใช่บรรทัดแรก จึงตัดที่บรรทัดเลขไม่ได้)
//
// 7) ออเดอร์ที่ของเยอะจะล้นไปหน้าถัดไป "โดยไม่มีหัวตาราง"
//    หน้าพวกนี้ต้องยืมหัวตารางของหน้าก่อน ไม่งั้นของจะหายทั้งหน้า
//
// ✅ วัดกับไฟล์จริง: Shopee 9/9 ใบ · TikTok 306/307 ใบ (ใบที่เหลือเป็นหน้าท้ายที่ไม่มีรายการ)
//    และยอดที่อ่านได้ตรงกับ "Total" ที่พิมพ์อยู่บนใบครบทั้ง 309 ออเดอร์

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
  .map(i => ({
    s: i.str,
    x: i.transform ? i.transform[4] : 0,
    y: i.transform ? i.transform[5] : 0,
    // ขนาดตัวอักษร — ตัวแบ่ง "ชุดป้าย" ออกจาก "ชุดใบแนบ" (ดูหมายเหตุข้อ 5)
    h: i.height || (i.transform ? Math.abs(i.transform[3]) : 0),
  }));

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

// ชุดแถวนี้ชิดคอลัมน์ของหัวตารางชุดไหนมากกว่ากัน
const alignScore = (rows, hdr) => rows.reduce((n, r) =>
  n + r.cells.reduce((m, c) => m + (hdr.cols.some(k => Math.abs(c.x - k.x) <= COL_TOL) ? 1 : 0), 0), 0);

const isQtyKey = (k) => /^(qty|quantity|จ[\u0e4d\u0e32\u0e33]นวน)$/.test(k);
const isNoKey = (k) => /^(#|no\.?)$/.test(k);
const sizeKey = (p) => Math.round((p.h || 0) * 2) / 2;

// อ่านตารางหนึ่งชุด -> รายการสินค้า (ใบหนึ่งมีได้หลายรายการ)
function readTable(rows, hdr) {
  const cols = hdr.cols.map((c, i) => ({
    key: c.name.toLowerCase(),
    x0: c.x - COL_TOL,
    x1: i + 1 < hdr.cols.length ? hdr.cols[i + 1].x - COL_TOL : Infinity,
  }));

  // จุดยึดของแต่ละรายการ = เลขลำดับในคอลัมน์แรก (ดูหมายเหตุข้อ 6)
  const noCol = cols.find(k => isNoKey(k.key));
  const anchors = [];
  if (noCol) rows.forEach(r => r.cells.forEach(c => {
    if (c.x >= noCol.x0 && c.x < noCol.x1 && /^\d{1,2}$/.test(c.s.trim())) anchors.push(r.y);
  }));
  anchors.sort((a, b) => b - a);
  const groupOf = (y) => {
    if (anchors.length <= 1) return 0;
    let bi = 0, bd = Infinity;
    anchors.forEach((ay, i) => { const d = Math.abs(ay - y); if (d < bd) { bd = d; bi = i; } });
    return bi;
  };

  const recs = (anchors.length || 1) > 0 ? Array.from({ length: Math.max(1, anchors.length) }, () => cols.map(() => [])) : [];
  rows.forEach(r => {
    const g = groupOf(r.y);
    r.cells.forEach(c => {
      const ci = cols.findIndex(k => c.x >= k.x0 && c.x < k.x1);
      if (ci >= 0) recs[g][ci].push({ s: c.s, x: c.x, rowY: r.y });
    });
  });

  return recs.map(cells => {
    const textOf = (pred) => {
      const ci = cols.findIndex(k => pred(k.key));
      if (ci < 0) return "";
      return cells[ci].sort((a, b) => (b.rowY - a.rowY) || (a.x - b.x))
        .map(q => q.s).join("").replace(/\s+/g, " ").trim();
    };
    const qi = cols.findIndex(k => isQtyKey(k.key));
    const qtyParts = qi >= 0 ? cells[qi].length : 0;
    const digits = String(textOf(isQtyKey)).replace(/\D/g, "");
    return {
      name: textOf(k => /(item|^name|product\s*name|ชื่อสินค)/.test(k) && !/seller/.test(k)),
      variation: textOf(k => /(v\s*name|ตัวเลือก)/.test(k)) || textOf(k => k === "sku"),
      sku: textOf(k => /seller\s*sku/.test(k)) || textOf(k => k === "sku"),
      // 🔒 ช่องจำนวนต้องมีข้อความ "ชิ้นเดียว" เท่านั้น
      //    ถ้ามีหลายชิ้น = แบ่งรายการหรือแบ่งคอลัมน์ยังไม่ถูก เลขจะต่อกันเป็นจำนวนปลอม
      //    ("1"+"1" -> 11, "1"+"1"+"1" -> 111) เคยหลุดมาแล้วตอนทดสอบ
      //    เกือบตัดสต๊อก 111 ชิ้นจากใบที่สั่งจริง 1 ชิ้น
      //    อ่านไม่ชัวร์ให้เป็น null แล้วบังคับให้คนกรอกเอง ห้ามเดาเด็ดขาด
      qty: (qtyParts === 1 && digits && digits.length <= 2) ? parseInt(digits, 10) : null,
    };
  }).filter(r => r.name || r.sku || r.variation);
}

// คุณภาพของสิ่งที่อ่านได้ — ใช้ 2 อย่าง: เลือกตารางที่ดีกว่า และตัดสินว่าเชื่อได้ไหม
// หักคะแนนแรงถ้าคำที่เป็น "หัวตาราง" โผล่ในเนื้อหา = แบ่งเขตคอลัมน์ผิด ข้อมูลปนกันแล้ว
const LEAK_RE = /(Item|V\s*Name|SKU|Qty|Product Name|Seller SKU|Package ID|NickName|Order ID|Store Name)/i;
const quality1 = (r) =>
  (r.name && r.name.length > 8 ? 2 : 0) +
  (/_/.test(r.sku || "") ? 2 : 0) +
  (/,/.test(r.variation || "") ? 1 : 0) +
  (r.qty && r.qty >= 1 && r.qty <= 20 ? 1 : -6) +
  (LEAK_RE.test(r.name || "") ? -5 : 0) +
  (LEAK_RE.test(r.sku || "") ? -5 : 0) +
  (LEAK_RE.test(r.variation || "") ? -4 : 0);
// เฉลี่ยต่อรายการ — ตารางที่มี 2 รายการต้องไม่ได้เปรียบเพราะคะแนนรวมสูงกว่า
const quality = (recs) => (recs.length ? recs.reduce((a, r) => a + quality1(r), 0) / recs.length : -99);

function parsePage(ps, prevHeaders) {
  let headers = findHeaders(ps);
  let top = Infinity;                       // ขอบบนของเนื้อตาราง
  if (headers.length) top = headers[headers.length - 1].y - 1;
  else if (prevHeaders && prevHeaders.length) headers = prevHeaders;   // หน้าต่อของออเดอร์เดิม
  if (!headers.length) return null;

  const footY = ps.filter(p => /Store Name|Total\s*:/i.test(p.s)).map(p => p.y).sort((a, b) => b - a)[0];
  const body = ps.filter(p => p.y < top && (footY == null || p.y > footY + 1));

  // แยกชิ้นข้อความตามขนาดตัวอักษร = แยกชุดป้ายออกจากชุดใบแนบ
  const bySize = new Map();
  body.forEach(p => { const k = sizeKey(p); if (!bySize.has(k)) bySize.set(k, []); bySize.get(k).push(p); });
  const cands = [...bySize.values()].filter(g => g.length >= 2).map(toRows);
  cands.push(toRows(body));                 // เผื่อหน้าที่มีตารางเดียว/ขนาดเดียว

  // ลองทุกคู่ (ชุดข้อความ x หัวตาราง) แล้วเอาคู่ที่อ่านออกดีที่สุด
  let best = null;
  cands.forEach(rows => headers.forEach(h => {
    if (!rows.length) return;
    const recs = readTable(rows, h);
    if (!recs.length) return;
    const q = quality(recs) + Math.min(2, alignScore(rows, h) / 8);
    if (!best || q > best.q) best = { recs, q };
  }));
  // คุณภาพไม่ถึงเกณฑ์ = บอกว่าอ่านไม่ออก ดีกว่าเดาแล้วไปตัดสต๊อกและออกบิลผิด
  return best && best.q >= 4 ? best.recs : null;
}

/**
 * อ่านไฟล์ใบปะหน้า PDF -> RawRow[] ชุดเดียวกับที่ตัววางข้อความ/Excel คืน
 * แถวที่จำนวนอ่านไม่ชัวร์จะได้ qty = null + needsQty: true (คนต้องกรอกเอง ระบบไม่เดาให้)
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
  let prevHeaders = null;
  // 🧾 ออเดอร์หนึ่งอาจกินหลายหน้า — เก็บเป็นก้อนไว้เทียบกับยอด "Total" ที่พิมพ์บนใบ
  let group = null;
  const groups = [];

  for (let p = 1; p <= total; p++) {
    let recs = null, ps = [];
    try {
      const page = await doc.getPage(p);
      ps = pieces((await page.getTextContent()).items || []);
      const hdr = findHeaders(ps);
      if (hdr.length) { prevHeaders = hdr; group = { rows: [], total: null }; groups.push(group); }
      // ยึดก้อนของรอบนี้ไว้เป็นค่าคงที่ ไม่งั้น closure ข้างล่างจะอ้างถึงก้อนของหน้าถัดไป
      recs = parsePage(ps, prevHeaders);
      page.cleanup?.();
    } catch (e) { recs = null; }
    const g = group;

    if (recs && recs.length) {
      recs.forEach(rec => {
        const row = {
          productText: rec.name,
          optionText: rec.variation,
          skuText: rec.sku,
          colorText: "", sizeText: "",
          qty: rec.qty,
          needsQty: rec.qty == null,
          raw: `${rec.name} | ${rec.variation} | ${rec.sku}`,
          page: p,
        };
        rows.push(row);
        if (g) g.rows.push(row);
      });
    } else skipped++;              // อ่านใบนี้ไม่ออก — นับไว้ ไม่ทิ้งเงียบ

    // ยอดรวมที่แพลตฟอร์มพิมพ์ไว้บนใบ ("Total: 3") — ของจริงที่เอาไว้ตรวจตัวเอง
    if (g) {
      toRows(ps).forEach(r => {
        const m = r.cells.map(c => c.s).join(" ").match(/(?:Qty\s*)?Total\s*:?\s*(\d{1,3})/i);
        if (m) g.total = Math.max(g.total ?? 0, Number(m[1]));
      });
    }
    if (onProgress && (p % 5 === 0 || p === total)) onProgress(p, total);
  }
  try { await doc.destroy(); } catch (e) { /* ไม่สำคัญ */ }

  // 🔍 ตรวจตัวเองกับยอดบนใบ — ถ้าไม่ตรงแปลว่าอ่านจำนวนเพี้ยน
  //    ไม่รู้ว่าแถวไหนผิด จึงล้างจำนวนทั้งออเดอร์นั้นให้คนกรอกเอง
  //    ด่านนี้แหละที่กันเคส "1 กลายเป็น 111" ไม่ให้หลุดไปตัดสต๊อก
  let mismatched = 0;
  groups.forEach(g => {
    if (g.total == null || !g.rows.length) return;
    if (g.rows.some(r => r.qty == null)) return;              // มีที่ต้องกรอกอยู่แล้ว
    const sum = g.rows.reduce((a, r) => a + (Number(r.qty) || 0), 0);
    if (sum === g.total) return;
    mismatched++;
    g.rows.forEach(r => { r.qty = null; r.needsQty = true; r.qtyWhy = `ยอดบนใบบอก ${g.total} แต่อ่านได้ ${sum}`; });
  });

  return { rows, pages: total, skipped, needQty: rows.filter(r => r.needsQty).length, mismatched };
}

export const isPdf = (f) => !!f && (/\.pdf$/i.test(f.name || "") || f.type === "application/pdf");
