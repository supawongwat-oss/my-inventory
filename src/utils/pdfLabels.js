// 📄 อ่านใบปะหน้าของแพลตฟอร์มจากไฟล์ PDF
//
// ทำไมต้องมี: ลูกค้าส่ง "ใบปะหน้า" มาให้เราแปะอยู่แล้ว ไม่ได้ส่งไฟล์รายการสินค้า
// ถ้าอ่านใบปะหน้าเองได้ = ไม่ต้องขออะไรเพิ่มจากลูกค้า และไม่ต้องนั่งอ่านทีละใบ
//
// ── สิ่งที่ทดสอบกับไฟล์จริงแล้ว (Shopee-TH-SPX 9 ใบ) ──────────────
// ✅ ดึงได้ครบ 9/9 ใบ: ชื่อสินค้า · สี · ไซส์ · จำนวน · เลขออเดอร์ · เลขพัสดุ
//
// ⚠️ 2 กับดักที่ทำให้พังถ้าไม่รู้:
//
// 1) ห้ามใช้ตัวอ่านข้อความสำเร็จรูปแบบต่อสตริงตรง ๆ
//    สระ/วรรณยุกต์ไทยถูกวาดเป็นชิ้นข้อความแยกใน PDF และลำดับในไฟล์ไม่ใช่ลำดับที่อ่าน
//    ต่อดื้อ ๆ จะได้ "เสื ้อกีฬา" / "่น K11รุ" (สลับที่)
//    → ต้องเก็บทุกชิ้นพร้อมพิกัด แล้วจัดกลุ่มเป็นบรรทัดตาม y และเรียงตาม x
//    (ลองด้วย pdftotext ของ poppler แล้วได้ภาษาไทย 0 ตัวอักษร ทั้งที่ไฟล์มีตารางแปลงอยู่ครบ
//     — เป็นข้อจำกัดของเครื่องมือนั้น ไม่ใช่ของไฟล์ · pdf.js อ่านได้ถูกต้อง)
//
// 2) วรรณยุกต์บางตัวหายไปเลยตอนดึง (ม่วง→มวง, รุ่น→รุน)
//    → ห้ามเทียบข้อความแบบตรงตัว ตัวจับคู่ใน packImport.js ตัดวรรณยุกต์ทิ้งก่อนเทียบอยู่แล้ว
//
// pdfjs-dist โหลดแบบ dynamic import — เป็นไลบรารีก้อนใหญ่ ไม่ควรถ่วงตอนเปิดแอป

let pdfjsPromise = null;
async function getPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = await import("pdfjs-dist");
      // ปิด worker แยกไฟล์ — CRA ไม่ได้ตั้ง path ของ worker ไว้ให้
      // ช้ากว่านิดหน่อยแต่ไม่ต้องยุ่งกับ build config และไม่มีปัญหาไฟล์หาไม่เจอตอน deploy
      if (pdfjs.GlobalWorkerOptions) pdfjs.GlobalWorkerOptions.workerSrc = "";
      return pdfjs;
    })();
  }
  return pdfjsPromise;
}

// จัดชิ้นข้อความเป็นบรรทัด: จับกลุ่มตาม y แล้วเรียงตาม x
// ความคลาดเคลื่อนของ y ตั้งไว้กว้างหน่อย เพราะสระบน/ล่างอยู่คนละระดับกับพยัญชนะ
const LINE_TOL = 2.2;

function itemsToLines(items) {
  const buckets = new Map();
  for (const it of items) {
    const str = it.str;
    if (!str) continue;
    // transform = [a,b,c,d,e,f] — e,f คือพิกัด x,y ของชิ้นข้อความ
    const x = it.transform ? it.transform[4] : 0;
    const y = it.transform ? it.transform[5] : 0;
    const key = Math.round(y / LINE_TOL);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push({ x, str });
  }
  return [...buckets.entries()]
    .sort((a, b) => b[0] - a[0])                       // บนลงล่าง
    .map(([, parts]) => parts.sort((a, b) => a.x - b.x).map(p => p.str).join(""))
    .map(s => s.replace(/[ \t]{2,}/g, " ").trim())
    .filter(Boolean);
}

// ── แกะ 1 ใบ → รายการสินค้าในใบนั้น ─────────────────────────
// รูปแบบที่เจอในของจริง (บรรทัดถัดจากหัวตารางภาษาไทย):
//   "1CAPPUCCINO เสื้อกีฬาแขนยาว รุ่น K11สีแดง,M (อก38 ยาว26นิ้ว)1"
//    ^ลำดับ      ^ชื่อสินค้า+สีติดกัน      ^ไซส์            ^จำนวน
// สีถูกแยกออกจากชื่อสินค้าทีหลังโดย splitTailColor() ซึ่งใช้ชื่อสีในคลังเป็นตัวตัด
const HEAD_RE = /ตัวเลือกสินค|ชื่อสินค|Item.*V\s*Name/i;

function parseLabelPage(lines) {
  const orderNo = (lines.map(l => l.match(/Shopee Order No\.?\s*([A-Z0-9]{10,})/i)).find(Boolean) || [])[1] || "";
  const tracking = (lines.map(l => l.match(/\b([A-Z]{2}\d{9,}[A-Z]?)\b/)).find(Boolean) || [])[1] || "";
  const hi = lines.findIndex(l => HEAD_RE.test(l));
  const out = [];
  if (hi < 0) return { orderNo, tracking, rows: out };

  // อ่าน 5 บรรทัดถัดไป เผื่อใบที่มีสินค้าหลายรายการ
  const window = lines.slice(hi + 1, hi + 7);
  for (let k = 0; k < window.length; k++) {
    const line = window[k];
    if (/^No\.\d/i.test(line) || /Item.*V\s*Name/i.test(line)) continue;
    // <ลำดับ><ชื่อ+สี>,<ไซส์...><จำนวน>
    const m = line.match(/^\s*(\d{1,2})?\s*(.+?),\s*(.+?)\s*(\d{1,3})\s*$/);
    if (!m) continue;
    let productPlusColor = (m[2] || "").trim();
    let sizePart = (m[3] || "").trim();
    let qty = Number(m[4]) || 1;

    // ⚠️ "เบอร์47" / "EUR: 41" — เลขท้ายบรรทัดคือไซส์ ไม่ใช่จำนวน
    //    ถ้าตัดเลขออกแล้วส่วนไซส์เหลือแต่คำว่าเบอร์/EUR เปล่า ๆ แปลว่าตัดผิด ต้องคืนเลขกลับไป
    if (/(?:เบอร|eur|size|ไซส)\s*:?\s*$/i.test(sizePart)) {
      sizePart = `${sizePart}${qty}`;
      qty = 1;
    }
    // ⚠️ ชื่อสินค้ายาวจนตกไปบรรทัดบน — บรรทัดนี้จะเหลือแค่สีสั้น ๆ เช่น "ทอง"
    //    ต่อหัวจากบรรทัดก่อนหน้ากลับเข้าไป ไม่งั้นจับคู่ไม่ได้เลย
    if (productPlusColor.length < 12 && k > 0) {
      const prev = window[k - 1];
      if (prev && prev.length > 10 && !/^No\.\d/i.test(prev) && !/Item.*V\s*Name/i.test(prev)) {
        productPlusColor = `${prev.replace(/^\s*\d{1,2}\s*/, "").trim()} ${productPlusColor}`.trim();
      }
    }
    if (!productPlusColor || productPlusColor.length < 3) continue;
    out.push({
      productText: productPlusColor,
      optionText: `,${sizePart}`,        // ให้ตัวจับคู่ไปแกะไซส์เอง
      colorText: "", sizeText: "",
      qty, orderNo, tracking, raw: line,
    });
    break;                                // 1 ใบ = 1 รายการในทางปฏิบัติ
  }
  return { orderNo, tracking, rows: out };
}

/**
 * อ่านไฟล์ใบปะหน้า PDF → RawRow[] ชุดเดียวกับที่ตัววางข้อความ/Excel คืน
 * @param {File|ArrayBuffer} file
 * @param {(done:number,total:number)=>void} [onProgress]
 * @returns {Promise<{rows:Array, pages:number, skipped:number}>}
 */
export async function readLabelPdf(file, onProgress) {
  const pdfjs = await getPdfjs();
  const data = file instanceof ArrayBuffer ? file : await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data, disableWorker: true, isEvalSupported: false }).promise;
  const rows = [];
  let skipped = 0;
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const lines = itemsToLines(content.items || []);
    const parsed = parseLabelPage(lines);
    if (parsed.rows.length) rows.push(...parsed.rows);
    else skipped++;                       // อ่านใบนี้ไม่ออก — นับไว้ ไม่ทิ้งเงียบ
    if (onProgress) onProgress(p, doc.numPages);
  }
  try { await doc.destroy(); } catch (e) { /* ไม่สำคัญ */ }
  return { rows, pages: doc.numPages, skipped };
}

export const isPdf = (f) => !!f && (/\.pdf$/i.test(f.name || "") || f.type === "application/pdf");
