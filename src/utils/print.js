// 🖨️ Print & PDF utilities — extracted from App.js
// 🚀 html2pdf.js (~400KB) → lazy load เฉพาะตอนกดปุ่ม PDF เท่านั้น

// scale fontSize ของทุก element ใน clone (ใช้ก่อนพิมพ์/PDF) — ค่าเริ่มต้น 1.3 = ใหญ่ขึ้น 30%
export const PRINT_FONT_SCALE = 1.3;
// ใบบิล: ขอบกระดาษแคบ (4mm) เนื้อหากว้าง ~197mm → ขยายตัวหนังสือให้เต็มพื้นที่
// ⚠️ ค่านี้เป็นตัวจริงตัวเดียว — PrintInvoiceModal import ไปใช้ ห้ามตั้งซ้ำที่อื่น
export const INVOICE_FONT_SCALE = 1.12;
// ใบบิล PDF: ใช้สเกลเดียวกับพิมพ์จาก PC — PDF วาดที่ความกว้างเท่าพื้นที่พิมพ์จริง
// จึงได้ขนาดตัวหนังสือเท่ากันเป๊ะ
export const INVOICE_PDF_FONT_SCALE = INVOICE_FONT_SCALE;
// 📏 ระยะว่างด้านบนของใบบิล — ใช้ค่าเดียวกันทั้งพิมพ์ตรงและ PDF
// เดิมหน้าแรกได้ 8mm (ขอบกระดาษ 4mm + padding ในบิล 4mm) แต่หน้า 2 ได้แค่ 4mm
// ตอนนี้ย้ายมาไว้ที่ขอบกระดาษทั้งหมด → ทุกหน้าเว้นบนเท่ากัน
// 📏 ระยะบน-ล่างของใบบิล — เก็บไว้ "ในตัวเอกสาร" ทั้งหมด ไม่พึ่งขอบกระดาษเลย
//
// ทำไม: ช่อง Margins ในหน้าต่างปริ้นของ Chrome เป็นค่ากลางค่าเดียว ใช้กับทุกงานพิมพ์
//   · ป้ายม้วน/สติกเกอร์ ต้องตั้ง "ไม่มี (None)" ถึงจะพิมพ์เต็มแผ่น
//   · แต่ None ทำให้ @page margin ถูกข้ามทั้งหมด → บิลไม่เหลือขอบ
// ถ้าให้บิลพึ่ง @page ผู้ใช้จะต้องสลับค่านี้ไปมาทุกครั้งที่เปลี่ยนงานพิมพ์
//
// แก้: ตั้ง @page margin บน-ล่าง = 0 แล้วให้ระยะมาจาก padding ในเอกสารแทน
//   ✅ Chrome ปิดไม่ได้ → ตั้ง None ค้างไว้ได้เลย ทั้งป้ายม้วนและบิลถูกต้องพร้อมกัน
//   ✅ ได้ระยะเท่ากันไม่ว่าผู้ใช้จะตั้ง Margins เป็นอะไร
//   ⚠️ padding มีผลแค่จุดที่เนื้อหาเริ่ม (หน้าแรก) → หน้า 2 พึ่งแถบหัวบิลใน <thead>
//      ซึ่งถูกพิมพ์ซ้ำทุกหน้า (ใส่ padding เท่ากันไว้ที่นั่น)
// หมายเหตุ: ขอบ "ซ้าย-ขวา" ไม่ต้องห่วง — ถูกบังคับด้วยความกว้างของ root อยู่แล้ว
//   (root.style.width = หน้ากระดาษ - 2×ขอบ) จึงไม่ขึ้นกับค่า Margins
export const INVOICE_MARGIN_TOP = "0mm";
export const INVOICE_MARGIN_BOTTOM = "0mm";
// ขอบบน 4mm · ขอบล่าง 8mm (ล่างต้องกว้างกว่า เพราะเป็นที่วางเลขที่บิล+เลขหน้าใน PDF)
export const INVOICE_PAD_TOP = "4mm";
export const INVOICE_PAD_BOTTOM = "8mm";
const PDF_MARGIN_TOP_MM = 4;
const PDF_MARGIN_BOTTOM_MM = 8;
// 📐 ความกว้างที่ใช้วาด PDF (px) — ต้องตรึงไว้ ห้ามปล่อยให้ไปวัดจากเครื่อง
//
// html2pdf กำหนดความกว้างกรอบที่ใช้วาดแบบนี้:
//   ถ้ามี opt.width และ opt.windowWidth เป็นตัวเลขทั้งคู่ → ใช้ opt.windowWidth
//   ถ้าไม่มี → ใช้ max(src.clientWidth, src.scrollWidth, src.offsetWidth)
// ทางหลังขึ้นกับความกว้างหน้าจอ/การจัดบรรทัดของเครื่องนั้น ๆ
// เครื่องที่วัดได้กว้างกว่า 764 จะได้กรอบกว้างกว่า แต่ตัวบิลยังกว้าง 764 เท่าเดิม
// → พอย่อทั้งกรอบให้พอดีหน้ากระดาษ บิลเลยเหลือแค่ครึ่งหน้า (คนละเครื่องได้ผลไม่เหมือนกัน)
const PDF_WIDTH_PX = 764;
export const scaleFontInElement = (root, factor = PRINT_FONT_SCALE) => {
  // ต้อง attach root เข้า DOM ชั่วคราวเพื่ออ่าน computed style
  const holder = document.createElement("div");
  holder.style.position = "fixed";
  holder.style.left = "-99999px";
  holder.style.top = "0";
  holder.style.visibility = "hidden";
  // 🩹 กัน Chrome ขยายตัวอักษรอัตโนมัติ (Android "ขนาดข้อความ" / จอที่ตั้งสเกลใหญ่)
  //    ถ้าไม่กัน ค่า computed fontSize ที่อ่านได้จะใหญ่กว่าความจริง แล้วถูกฝังลง clone
  //    → เอกสารกว้างเกินจริง คนละเครื่องได้ขนาดไม่เท่ากัน
  holder.style.webkitTextSizeAdjust = "100%";
  holder.style.textSizeAdjust = "100%";
  holder.appendChild(root);
  document.body.appendChild(holder);
  try {
    const all = [root, ...root.querySelectorAll("*")];
    all.forEach(n => {
      try {
        // ข้าม element ที่ระบุ data-no-scale="true" หรืออยู่ใน subtree data-no-scale-tree
        // (closest คลุม element ตัวเอง + ancestors — ถ้า td เป็น tree-root, td เองและ children ทั้งหมดจะถูกข้าม)
        if (n.getAttribute && n.getAttribute("data-no-scale") === "true") return;
        if (n.closest && n.closest('[data-no-scale-tree="true"]')) return;
        const cs = window.getComputedStyle(n);
        const fs = parseFloat(cs.fontSize);
        if (!isNaN(fs) && fs > 0) n.style.fontSize = (fs * factor).toFixed(2) + "px";
      } catch (e) {}
    });
  } finally {
    holder.removeChild(root);
    document.body.removeChild(holder);
  }
  return root;
};

// 🖨️ พิมพ์แบบ same-page isolation — ใช้ได้ทุกอุปกรณ์ (desktop + Samsung/iOS/Android)
// วิธีนี้ clone เนื้อหาที่จะพิมพ์ไปไว้ที่ body ระดับบนสุด แล้วใช้ @media print ซ่อนทุกอย่างที่เหลือ
// → ไม่มี sidebar/โลโก้แอป หลุดเข้ามา (เดิม iframe.print() บน Samsung พิมพ์ทั้งหน้าหลัก = โลโก้ซ้ำ)
// 📏 pageMarginTop = ระยะว่างด้านบนของ "ทุกหน้า"
//    ทำไมต้องแยกออกมา: เดิมระยะบนของหน้าแรกมาจาก 2 ที่รวมกัน คือขอบกระดาษ (@page margin)
//    บวก padding ในตัวเอกสารเอง — แต่ padding มีผลแค่จุดที่เนื้อหาเริ่ม (หน้าแรก) เท่านั้น
//    หน้า 2 เป็นต้นไปจึงได้แค่ขอบกระดาษ ทำให้ชิดบนกว่าหน้าแรก
//    แก้โดยย้ายระยะบนทั้งหมดไปไว้ที่ @page margin-top → ทุกหน้าเว้นเท่ากัน
export const printElementById = (id, pageSize = "A4 portrait", pageMargin = "10mm", fontScale = PRINT_FONT_SCALE, pageMarginTop = null, pageMarginBottom = null) => {
  const el = document.getElementById(id);
  if (!el) return;
  const thermalMatch = /^(\d+(?:\.\d+)?)mm\s+(\d+(?:\.\d+)?)mm$/i.exec(String(pageSize).trim());
  const isThermal = !!thermalMatch;
  const tW = isThermal ? Number(thermalMatch[1]) : null;

  // 🩹 Mobile/Tablet (Samsung Tab, iPad, Android) — เปิด tab ใหม่แล้ว print
  //    เพราะ Samsung Print Service capture ทั้งหน้าจอ ไม่ honor display:none
  const isMobile = /Android|iPhone|iPad|iPod|Mobi|Tablet|Silk|webOS|Kindle|PlayBook|BB10/i.test(navigator.userAgent)
    || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent))
    || (navigator.userAgentData && navigator.userAgentData.mobile)
    || (window.matchMedia && window.matchMedia("(hover: none) and (pointer: coarse)").matches);

  if (isMobile) {
    const sizeMapM = {
      "A4 portrait":  "210mm 297mm",
      "A4 landscape": "297mm 210mm",
      "A5 portrait":  "148mm 210mm",
      "A5 landscape": "210mm 148mm",
    };
    const cssPageSizeM = sizeMapM[pageSize] || pageSize;
    const cloneM = el.cloneNode(true);
    cloneM.removeAttribute("id");
    // 🩹 Samsung/mobile: ลด fontScale ลง (default 1.3 มักทำให้ตกขอบ)
    const mobileFontScale = Math.min(fontScale, 1.0);
    const finalElM = isThermal ? cloneM : scaleFontInElement(cloneM, mobileFontScale);
    // 🩹 ลด padding รอบ ๆ print-area — เดิม 32px 40px กว้างเกินไป
    // ถ้ากำหนดระยะบนไว้ที่ @page แล้ว ต้องไม่ใส่ padding บนซ้ำ ไม่งั้นหน้าแรกจะเว้นมากกว่าหน้าอื่น
    // ระยะบน-ล่างคงไว้เสมอ — เป็นชั้นที่ Chrome ปิดไม่ได้
    finalElM.style.padding = pageMarginTop ? `${INVOICE_PAD_TOP} 8mm ${INVOICE_PAD_BOTTOM}` : "6mm 8mm";
    finalElM.style.boxSizing = "border-box";
    finalElM.style.width = "100%";
    finalElM.style.maxWidth = "100%";
    // ดึง <style>/<link> ที่จำเป็นจาก parent (สำหรับให้สไตล์ inline ของ React ทำงานเหมือนเดิม)
    const html = `<!doctype html><html><head><meta charset="utf-8"/>
      <title>พิมพ์เอกสาร</title>
      <link rel="icon" href="data:,">
      <style>
        @page { size: ${cssPageSizeM}; margin: 6mm;${pageMarginTop ? ` margin-top: ${pageMarginTop};` : ""}${pageMarginBottom ? ` margin-bottom: ${pageMarginBottom};` : ""} }
        html, body { margin: 0; padding: 0; background: white; color: #1e293b; font-family: 'Sarabun','Sukhumvit Set','Noto Sans Thai',sans-serif; width: 100%; max-width: 100%; box-sizing: border-box; overflow-x: hidden; }
        * { box-sizing: border-box; }
        body > * { max-width: 100% !important; }
        table { border-collapse: collapse; width: 100% !important; max-width: 100% !important; }
        tr, td, th { page-break-inside: avoid; word-break: break-word; }
        thead { display: table-header-group; }
        tfoot { display: table-footer-group; }
        img { max-width: 100%; height: auto; }
        /* บังคับพิมพ์สีพื้นหลัง — Galaxy Tab ไม่มีตัวเลือก Background graphics ให้ติ๊ก */
        * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        .no-print, [data-no-print="true"], .print-hide { display: none !important; }
        #__print_btn { position: fixed; top: 12px; right: 12px; padding: 10px 18px; background: #3b5b8b; color: white; border: none; border-radius: 8px; font-size: 15px; font-weight: 700; cursor: pointer; box-shadow: 0 4px 14px rgba(0,0,0,0.2); z-index: 9999; }
        @media print { #__print_btn { display: none !important; } }
      </style></head><body>
      <button id="__print_btn" onclick="window.print()">🖨️ พิมพ์</button>
      ${finalElM.outerHTML}
      </body></html>`;
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const w = window.open(url, "_blank");
    if (!w) {
      URL.revokeObjectURL(url);
      alert("เบราว์เซอร์บล็อก popup — กรุณาอนุญาต popup สำหรับหน้านี้แล้วลองใหม่");
      return;
    }
    // รอ window load + รูปครบ แล้วค่อย print (ไม่ปิด tab อัตโนมัติ)
    const tryPrint = () => {
      try {
        const imgs = Array.from(w.document.images || []);
        const allReady = imgs.every(im => im.complete && im.naturalWidth > 0);
        if (!allReady) { setTimeout(tryPrint, 300); return; }
        w.focus();
        w.print();
      } catch (e) {
        console.warn("[print] auto-print failed:", e);
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      }
    };
    const start = Date.now();
    const waitLoad = () => {
      if (w.closed) return;
      const ready = w.document && w.document.readyState === "complete";
      if (ready) { setTimeout(tryPrint, 500); return; }
      if (Date.now() - start > 10000) { tryPrint(); return; }
      setTimeout(waitLoad, 200);
    };
    setTimeout(waitLoad, 300);
    return;
  }

  // === Desktop: ใช้ same-page isolation ===
  document.getElementById("__print_root__")?.remove();
  document.getElementById("__print_style__")?.remove();

  const clone = el.cloneNode(true);
  clone.removeAttribute("id");
  const finalEl = isThermal ? clone : scaleFontInElement(clone, fontScale);

  const root = document.createElement("div");
  root.id = "__print_root__";
  root.appendChild(finalEl);
  document.body.appendChild(root);

  // 🩹 JS-based hiding — ซ่อนทุก body child ด้วย inline style (CSS @media print ไม่ทำงานบน Samsung)
  //    เก็บค่า display เดิมไว้ restore ทีหลัง
  const bodyChildren = Array.from(document.body.children);
  const hiddenState = [];
  bodyChildren.forEach(child => {
    if (child === root) return;
    hiddenState.push({ el: child, prev: child.style.display });
    child.style.display = "none";
  });
  // เผื่อ modal overlay ใช้ position:fixed นอก body flow → hide ด้วย class
  const fixedHidden = [];
  document.querySelectorAll(".print-modal-overlay, [data-print-hide]").forEach(el => {
    if (el === root || root.contains(el)) return;
    fixedHidden.push({ el, prev: el.style.display });
    el.style.display = "none";
  });
  // reset html/body margin/padding ชั่วคราว
  const prevHtml = { margin: document.documentElement.style.margin, padding: document.documentElement.style.padding };
  const prevBody = { margin: document.body.style.margin, padding: document.body.style.padding, background: document.body.style.background };
  document.documentElement.style.margin = "0";
  document.documentElement.style.padding = "0";
  document.body.style.margin = "0";
  document.body.style.padding = "0";
  document.body.style.background = "#fff";

  const extraThermal = isThermal ? `
    #__print_root__ { width: ${tW}mm; }
    #__print_root__ > * { width: ${tW}mm; max-width: ${tW}mm; box-sizing: border-box; }
  ` : "";

  const sizeMap = {
    "A4 portrait":  "210mm 297mm",
    "A4 landscape": "297mm 210mm",
    "A5 portrait":  "148mm 210mm",
    "A5 landscape": "210mm 148mm",
  };
  const cssPageSize = sizeMap[pageSize] || pageSize;
  const tableLayout = (isThermal || /A5/i.test(pageSize)) ? "table-layout: fixed;" : "";
  const marginMm = parseFloat(String(pageMargin).match(/^([\d.]+)/)?.[1] || "10");
  const pageMatch = cssPageSize.match(/^([\d.]+)mm\s+([\d.]+)mm$/);
  const contentWidth = (pageMatch && !isThermal) ? (parseFloat(pageMatch[1]) - 2 * marginMm) + "mm" : "auto";

  // ตั้งค่า root inline เพื่อให้แสดง on-screen ตอน print (ไม่พึ่ง @media print ที่ Samsung ไม่ honor บางที)
  root.style.position = "static";
  root.style.left = "auto";
  root.style.top = "auto";
  root.style.width = contentWidth;
  root.style.maxWidth = contentWidth;
  root.style.margin = "0 auto";
  root.style.boxSizing = "border-box";
  root.style.background = "#fff";

  const style = document.createElement("style");
  style.id = "__print_style__";
  style.textContent = `
    @page { size: ${cssPageSize}; margin: ${pageMargin};${pageMarginTop ? ` margin-top: ${pageMarginTop};` : ""}${pageMarginBottom ? ` margin-bottom: ${pageMarginBottom};` : ""} }
    #__print_root__ table { border-collapse: collapse; width: 100%; ${tableLayout} }
    #__print_root__ tr, #__print_root__ td, #__print_root__ th { page-break-inside: avoid; min-width: 0 !important; word-break: break-word; }
    /* 🩹 กันเนื้อหากว้างเกินหน้ากระดาษ — ชื่อรุ่น/สีตั้ง nowrap ไว้ ทำให้ตารางดันกว้างจน
       Chrome ต้องตัดเป็นหน้าซ้าย-ขวาเพิ่ม (8 แผ่น) และคอลัมน์ขวาโดนตัด → บังคับให้ตัดคำได้ */
    #__print_root__ td, #__print_root__ th { white-space: normal !important; overflow-wrap: break-word; }
    /* หัวคอลัมน์ที่ห้ามตัดคำ (เช่น "จำนวน" ไม่ให้ "น" ตกบรรทัด) */
    #__print_root__ [data-nowrap] { white-space: nowrap !important; overflow-wrap: normal !important; }
    /* ตัวเลขเงิน (2 คอลัมน์ท้าย + แถวสรุปยอด) ห้ามตัดกลางตัวเลข — 133,405.00 ต้องอยู่บรรทัดเดียว */
    #__print_root__ td:last-child, #__print_root__ td:nth-last-child(2),
    #__print_root__ tfoot td, #__print_root__ tfoot th { white-space: nowrap !important; overflow-wrap: normal !important; }
    #__print_root__ { overflow: hidden; }
    #__print_root__ thead { display: table-header-group; }
    #__print_root__ tfoot { display: table-footer-group; }
    #__print_root__ img { max-width: 100%; height: auto; }
    /* บังคับพิมพ์สีพื้นหลัง — Galaxy Tab ไม่มีตัวเลือก Background graphics ให้ติ๊ก */
        * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        .no-print, [data-no-print="true"], .print-hide { display: none !important; }
    ${extraThermal}
  `;
  document.head.appendChild(style);

  let done = false;
  const cleanup = () => {
    if (done) return; done = true;
    root.remove();
    style.remove();
    // restore body children
    hiddenState.forEach(({ el, prev }) => { el.style.display = prev || ""; });
    fixedHidden.forEach(({ el, prev }) => { el.style.display = prev || ""; });
    document.documentElement.style.margin = prevHtml.margin;
    document.documentElement.style.padding = prevHtml.padding;
    document.body.style.margin = prevBody.margin;
    document.body.style.padding = prevBody.padding;
    document.body.style.background = prevBody.background;
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);

  const imgs = Array.from(root.querySelectorAll("img"));
  const waitImgs = Promise.all(imgs.map(im =>
    (im.complete && im.naturalWidth > 0)
      ? Promise.resolve()
      : new Promise(res => { im.onload = res; im.onerror = res; setTimeout(res, 3000); })
  ));
  const fontsReady = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();

  Promise.all([waitImgs, fontsReady]).then(() => {
    setTimeout(() => {
      try { window.print(); } catch (e) { console.warn("[print] failed:", e); }
      // เผื่อ afterprint ไม่ยิง (บางมือถือ) — เก็บกวาดหลัง 60 วิ
      setTimeout(cleanup, 60000);
    }, 120);
  });
};

// พิมพ์เอกสารหลายชุด (ต้นฉบับ + สำเนา) บน A4 — ขึ้นหน้าใหม่ทุกชุด
export const printInvoiceCopies = (id, labels = ["ใบส่งของ/ใบแจ้งหนี้ (ต้นฉบับ)", "ใบส่งของ/ใบแจ้งหนี้ (สำเนา)", "ใบส่งของ/ใบแจ้งหนี้ (สำเนา)"], fontScale = INVOICE_FONT_SCALE, pageSize = "A4 portrait", pageMargin = "10mm", pageMarginTop = null, pageMarginBottom = null) => {
  const el = document.getElementById(id);
  if (!el) return;

  // 🩹 Mobile/Tablet — เปิด tab ใหม่
  const isMobileM = /Android|iPhone|iPad|iPod|Mobi|Tablet|Silk|webOS|Kindle|PlayBook|BB10/i.test(navigator.userAgent)
    || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent))
    || (navigator.userAgentData && navigator.userAgentData.mobile)
    || (window.matchMedia && window.matchMedia("(hover: none) and (pointer: coarse)").matches);

  if (isMobileM) {
    const sizeMapM = {
      "A4 portrait":  "210mm 297mm",
      "A4 landscape": "297mm 210mm",
      "A5 portrait":  "148mm 210mm",
      "A5 landscape": "210mm 148mm",
    };
    const cssPageSizeM = sizeMapM[pageSize] || pageSize;
    const allHtml = labels.map((label, i) => {
      const cl = el.cloneNode(true);
      cl.removeAttribute("id");
      const tag = cl.querySelector("[data-doc-label]");
      if (tag) tag.textContent = label;
      scaleFontInElement(cl, fontScale);
      const sep = i < labels.length - 1 ? ' style="page-break-after: always;"' : '';
      return `<div${sep}>${cl.outerHTML}</div>`;
    }).join("");
    const html = `<!doctype html><html><head><meta charset="utf-8"/>
      <title>พิมพ์เอกสาร × ${labels.length}</title>
      <link rel="icon" href="data:,">
      <style>
        @page { size: ${cssPageSizeM}; margin: ${pageMargin};${pageMarginTop ? ` margin-top: ${pageMarginTop};` : ""}${pageMarginBottom ? ` margin-bottom: ${pageMarginBottom};` : ""} }
        html, body { margin: 0; padding: 0; background: white; color: #1e293b; font-family: 'Sarabun','Sukhumvit Set','Noto Sans Thai',sans-serif; }
        table { border-collapse: collapse; width: 100%; }
        tr, td, th { page-break-inside: avoid; }
        thead { display: table-header-group; }
        tfoot { display: table-footer-group; }
        img { max-width: 100%; height: auto; }
        /* บังคับพิมพ์สีพื้นหลัง — Galaxy Tab ไม่มีตัวเลือก Background graphics ให้ติ๊ก */
        * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        .no-print, [data-no-print="true"], .print-hide { display: none !important; }
        #__print_btn { position: fixed; top: 12px; right: 12px; padding: 10px 18px; background: #3b5b8b; color: white; border: none; border-radius: 8px; font-size: 15px; font-weight: 700; cursor: pointer; box-shadow: 0 4px 14px rgba(0,0,0,0.2); z-index: 9999; }
        @media print { #__print_btn { display: none !important; } }
      </style></head><body>
      <button id="__print_btn" onclick="window.print()">🖨️ พิมพ์ × ${labels.length}</button>
      ${allHtml}
      </body></html>`;
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const w = window.open(url, "_blank");
    if (!w) {
      URL.revokeObjectURL(url);
      alert("เบราว์เซอร์บล็อก popup — กรุณาอนุญาต popup แล้วลองใหม่");
      return;
    }
    const tryPrint = () => {
      try {
        const imgs = Array.from(w.document.images || []);
        if (!imgs.every(im => im.complete && im.naturalWidth > 0)) { setTimeout(tryPrint, 300); return; }
        w.focus(); w.print();
      } catch (e) {} finally { setTimeout(() => URL.revokeObjectURL(url), 60000); }
    };
    const start = Date.now();
    const waitLoad = () => {
      if (w.closed) return;
      if (w.document?.readyState === "complete") { setTimeout(tryPrint, 500); return; }
      if (Date.now() - start > 10000) { tryPrint(); return; }
      setTimeout(waitLoad, 200);
    };
    setTimeout(waitLoad, 300);
    return;
  }

  // === Desktop: same-page isolation ===
  document.getElementById("__print_root__")?.remove();
  document.getElementById("__print_style__")?.remove();

  const root = document.createElement("div");
  root.id = "__print_root__";
  labels.forEach((label, i) => {
    const clone = el.cloneNode(true);
    clone.removeAttribute("id");
    const tag = clone.querySelector("[data-doc-label]");
    if (tag) tag.textContent = label;
    scaleFontInElement(clone, fontScale);
    const wrap = document.createElement("div");
    if (i < labels.length - 1) wrap.style.pageBreakAfter = "always";
    wrap.appendChild(clone);
    root.appendChild(wrap);
  });
  document.body.appendChild(root);

  // 🩹 JS-based hiding (CSS @media print ไม่ทำงานบน Samsung)
  const bodyChildren2 = Array.from(document.body.children);
  const hiddenState2 = [];
  bodyChildren2.forEach(child => {
    if (child === root) return;
    hiddenState2.push({ el: child, prev: child.style.display });
    child.style.display = "none";
  });
  const fixedHidden2 = [];
  document.querySelectorAll(".print-modal-overlay, [data-print-hide]").forEach(elx => {
    if (elx === root || root.contains(elx)) return;
    fixedHidden2.push({ el: elx, prev: elx.style.display });
    elx.style.display = "none";
  });
  const prevHtml2 = { margin: document.documentElement.style.margin, padding: document.documentElement.style.padding };
  const prevBody2 = { margin: document.body.style.margin, padding: document.body.style.padding, background: document.body.style.background };
  document.documentElement.style.margin = "0";
  document.documentElement.style.padding = "0";
  document.body.style.margin = "0";
  document.body.style.padding = "0";
  document.body.style.background = "#fff";

  const sizeMap2 = {
    "A4 portrait":  "210mm 297mm",
    "A4 landscape": "297mm 210mm",
    "A5 portrait":  "148mm 210mm",
    "A5 landscape": "210mm 148mm",
  };
  const cssPageSize2 = sizeMap2[pageSize] || pageSize;
  const tableLayout2 = /A5/i.test(pageSize) ? "table-layout: fixed;" : "";
  const marginMm2 = parseFloat(String(pageMargin).match(/^([\d.]+)/)?.[1] || "10");
  const pm2 = cssPageSize2.match(/^([\d.]+)mm\s+([\d.]+)mm$/);
  const contentWidth2 = pm2 ? (parseFloat(pm2[1]) - 2 * marginMm2) + "mm" : "auto";

  root.style.position = "static";
  root.style.left = "auto";
  root.style.top = "auto";
  root.style.width = contentWidth2;
  root.style.maxWidth = contentWidth2;
  root.style.margin = "0 auto";
  root.style.boxSizing = "border-box";
  root.style.background = "#fff";

  const style = document.createElement("style");
  style.id = "__print_style__";
  style.textContent = `
    @page { size: ${cssPageSize2}; margin: ${pageMargin};${pageMarginTop ? ` margin-top: ${pageMarginTop};` : ""}${pageMarginBottom ? ` margin-bottom: ${pageMarginBottom};` : ""} }
    #__print_root__ > div { width: ${contentWidth2} !important; max-width: ${contentWidth2} !important; box-sizing: border-box; }
    #__print_root__ table { border-collapse: collapse; width: 100%; ${tableLayout2} }
    #__print_root__ tr, #__print_root__ td, #__print_root__ th { page-break-inside: avoid; min-width: 0 !important; word-break: break-word; }
    /* 🩹 กันเนื้อหากว้างเกินหน้ากระดาษ — ชื่อรุ่น/สีตั้ง nowrap ไว้ ทำให้ตารางดันกว้างจน
       Chrome ต้องตัดเป็นหน้าซ้าย-ขวาเพิ่ม (8 แผ่น) และคอลัมน์ขวาโดนตัด → บังคับให้ตัดคำได้ */
    #__print_root__ td, #__print_root__ th { white-space: normal !important; overflow-wrap: break-word; }
    /* หัวคอลัมน์ที่ห้ามตัดคำ (เช่น "จำนวน" ไม่ให้ "น" ตกบรรทัด) */
    #__print_root__ [data-nowrap] { white-space: nowrap !important; overflow-wrap: normal !important; }
    /* ตัวเลขเงิน (2 คอลัมน์ท้าย + แถวสรุปยอด) ห้ามตัดกลางตัวเลข — 133,405.00 ต้องอยู่บรรทัดเดียว */
    #__print_root__ td:last-child, #__print_root__ td:nth-last-child(2),
    #__print_root__ tfoot td, #__print_root__ tfoot th { white-space: nowrap !important; overflow-wrap: normal !important; }
    #__print_root__ { overflow: hidden; }
    #__print_root__ thead { display: table-header-group; }
    #__print_root__ img { max-width: 100%; height: auto; }
    /* บังคับพิมพ์สีพื้นหลัง — Galaxy Tab ไม่มีตัวเลือก Background graphics ให้ติ๊ก */
        * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        .no-print, [data-no-print="true"], .print-hide { display: none !important; }
  `;
  document.head.appendChild(style);

  let done = false;
  const cleanup = () => {
    if (done) return; done = true;
    root.remove(); style.remove();
    hiddenState2.forEach(({ el, prev }) => { el.style.display = prev || ""; });
    fixedHidden2.forEach(({ el, prev }) => { el.style.display = prev || ""; });
    document.documentElement.style.margin = prevHtml2.margin;
    document.documentElement.style.padding = prevHtml2.padding;
    document.body.style.margin = prevBody2.margin;
    document.body.style.padding = prevBody2.padding;
    document.body.style.background = prevBody2.background;
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);

  const imgs = Array.from(root.querySelectorAll("img"));
  const waitImgs = Promise.all(imgs.map(im => (im.complete && im.naturalWidth > 0) ? Promise.resolve() : new Promise(res => { im.onload = res; im.onerror = res; setTimeout(res, 3000); })));
  const fontsReady = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();
  Promise.all([waitImgs, fontsReady]).then(() => {
    setTimeout(() => { try { window.print(); } catch (e) {} setTimeout(cleanup, 60000); }, 120);
  });
};

// ดาวน์โหลดเอกสารเป็น PDF (ใช้ html2pdf.js — lazy load)
export const downloadInvoicePdf = async (inv, copies = false) => {
  const el = document.getElementById("invoice-print-area");
  if (!el || !inv) return;
  const safeName = (inv.customerName || "ลูกค้า").replace(/[\\/:*?"<>|]/g, "_").slice(0, 30);
  const filename = `${inv.invoiceNo || "INV"}_${safeName}.pdf`;
  let source;
  if (copies) {
    const labels = ["ใบส่งของ/ใบแจ้งหนี้ (ต้นฉบับ)", "ใบส่งของ/ใบแจ้งหนี้ (สำเนา)", "ใบส่งของ/ใบแจ้งหนี้ (สำเนา)"];
    const wrap = document.createElement("div");
    labels.forEach((label, i) => {
      const clone = el.cloneNode(true);
      clone.removeAttribute("id");        // กัน id ซ้ำกัน 3 ตัวในเอกสารเดียว
      clone.setAttribute("data-bill", ""); // ใช้เลือกตัวบิลจริงทีหลัง (ตัว wrap ไม่ใช่บิล)
      const tag = clone.querySelector("[data-doc-label]");
      if (tag) tag.textContent = label;
      scaleFontInElement(clone, INVOICE_PDF_FONT_SCALE);
      const pageWrap = document.createElement("div");
      if (i < labels.length - 1) pageWrap.style.pageBreakAfter = "always";
      pageWrap.appendChild(clone);
      wrap.appendChild(pageWrap);
    });
    source = wrap;
  } else {
    source = scaleFontInElement(el.cloneNode(true), INVOICE_PDF_FONT_SCALE);
    source.setAttribute("data-bill", "");
  }
  // 📐 บังคับความกว้าง = A4 content (~190mm ≈ 718px @96dpi) → html2canvas จับภาพเท่าหน้าจริง ไม่ล้นขอบ
  // 🩹 คลาย nowrap ของช่องรุ่น/สี — ไม่งั้นตารางดันกว้างเกิน 718px แล้วคอลัมน์ขวาโดนตัดใน PDF
  source.querySelectorAll("td, th").forEach(n => { n.style.whiteSpace = "normal"; n.style.overflowWrap = "break-word"; });
  // ตัวเลขเงินห้ามตัดกลาง
  source.querySelectorAll("tr").forEach(tr => { const c = tr.children; [c[c.length-1], c[c.length-2]].forEach(td => { if (td) { td.style.whiteSpace = "nowrap"; td.style.overflowWrap = "normal"; } }); });
  source.querySelectorAll("tfoot td, tfoot th, [data-nowrap]").forEach(n => { n.style.whiteSpace = "nowrap"; n.style.overflowWrap = "normal"; });
  // 📏 PDF มีขอบบน-ล่างของตัวเองอยู่แล้ว (PDF_MARGIN_*) ซึ่งเป็นแถบที่ใช้วางเลขที่บิล
  //    กับเลขหน้าด้วย → ต้องเอา padding บน-ล่างของเอกสารออก ไม่งั้นจะเว้นซ้ำเป็น 2 เท่า
  //    (ตอนพิมพ์ตรง กลับกัน: @page = 0 แล้วใช้ padding แทน)
  // ⚠️ ต้องใส่ที่ "ตัวบิล" ไม่ใช่ที่ source — โหมด 3 ชุด source เป็นแค่กล่องครอบ
  //    (เดิมใส่ที่ source ทำให้โหมด 3 ชุดมีขอบไม่เท่าโหมดชุดเดียว)
  source.querySelectorAll("[data-bill]").forEach(b => {
    b.style.paddingTop = "0";
    b.style.paddingBottom = "0";
  });
  if (source.hasAttribute("data-bill")) { source.style.paddingTop = "0"; source.style.paddingBottom = "0"; }
  source.style.width = PDF_WIDTH_PX + "px";
  source.style.maxWidth = PDF_WIDTH_PX + "px";
  // 🩹 กันตัวอักษรถูกขยายอัตโนมัติตอน html2canvas วาด (สืบทอดลงลูกทุกตัว)
  source.style.webkitTextSizeAdjust = "100%";
  source.style.textSizeAdjust = "100%";
  source.style.overflow = "hidden";
  source.style.boxSizing = "border-box";

  // 📏 วัดความสูงจริงก่อน แล้วเลือกความละเอียดให้ภาพไม่เกินเพดานของเบราว์เซอร์
  //
  // ⚠️ ต้นเหตุของอาการ "พิมพ์ 3 ชุด บางชุดครบ บางชุดขาด บางแถวหาย":
  //    PDF วาดทั้งเอกสารเป็นภาพเดียว ยิ่ง 3 ชุดยิ่งสูงมาก
  //    แต่ canvas ของเบราว์เซอร์มีเพดานความสูงราว 16,384px
  //    เกินเมื่อไหร่ ส่วนที่เกินจะกลายเป็นว่างเปล่า "เงียบ ๆ" ไม่มี error
  //    ที่ scale 2 บิล 3 หน้า × 3 ชุด ≈ 19,000px → ทะลุเพดาน จึงหายเป็นบางส่วน
  //    ยิ่งบิลยาวยิ่งหายมาก จึงดูเหมือนสุ่ม
  //    แท็บเล็ตมีเพดานต่ำกว่าเครื่อง PC มาก (PC ทดสอบได้ ~40,000px · มือถือ/แท็บเล็ตราว 16,384px)
  //    และหน่วยความจำจำกัดกว่า จึงพังบนแท็บเล็ตแต่ PC ปกติ
  const MAX_CANVAS_PX = 15000;   // เผื่อจากเพดาน 16,384 ของแท็บเล็ต
  const MIN_SCALE = 0.8;         // ต่ำกว่านี้ตัวหนังสือเริ่มอ่านยาก
  let renderScale = 2;
  let tooTall = false;
  const probe = document.createElement("div");
  probe.style.cssText = "position:fixed;left:-99999px;top:0;visibility:hidden;";
  probe.appendChild(source);
  document.body.appendChild(probe);
  try {
    const h = Math.max(source.scrollHeight, source.offsetHeight, 1);
    // ยอมลดความละเอียดลง — ชัดน้อยลงนิดหน่อย แต่ "ครบ" สำคัญกว่า
    renderScale = Math.min(2, Math.max(MIN_SCALE, MAX_CANVAS_PX / h));
    tooTall = h * renderScale > MAX_CANVAS_PX;
    if (tooTall) console.warn(`[pdf] เอกสารสูง ${h}px · แม้ลดความละเอียดเหลือ ${renderScale} ก็ยังเกินเพดานภาพ`);
  } catch (e) {
    console.warn("[pdf] วัดความสูงไม่สำเร็จ ใช้ค่าเริ่มต้น:", e?.message || e);
  } finally {
    probe.removeChild(source);
    document.body.removeChild(probe);
  }
  // ⚠️ เตือนก่อน "ดีกว่าได้ไฟล์ที่ขาดหายโดยไม่รู้ตัว" — ซึ่งอันตรายกับเอกสารส่งลูกค้า
  if (tooTall && !window.confirm(
    "บิลนี้ยาวเกินกว่าจะทำ PDF พร้อมกัน 3 ชุดได้ครบ\n\n" +
    "ถ้าทำต่อ บางชุดอาจมีรายการขาดหาย\n" +
    "แนะนำให้กด \"📄 PDF\" (ชุดเดียว) แล้วสั่งพิมพ์ 3 ชุดที่เครื่องพิมพ์แทน\n\n" +
    "ยืนยันทำต่อไหม?"
  )) return;
  // 🚀 lazy import — โหลด html2pdf.js เฉพาะตอนกดปุ่มนี้เท่านั้น (~400KB)
  // 🏷️ แถบระบุตัวบิลสำหรับ PDF — ต้องทำเป็น "รูปภาพ" แล้วแปะทีละหน้า
  //
  // ทำไมใช้วิธีนี้: PDF สร้างโดยวาดบิลเป็นภาพยาวรูปเดียวแล้วหั่นเป็นหน้า ไม่ได้แบ่งหน้าแบบ HTML
  // กลไก <thead> ที่ทำให้หัวตารางซ้ำทุกหน้าตอนพิมพ์ตรง จึงไม่มีผลใน PDF เลย
  // และจะเขียนเป็นข้อความด้วย jsPDF ตรง ๆ ก็ไม่ได้ เพราะฟอนต์มาตรฐานไม่มีตัวอักษรไทย
  // → วาดเป็นภาพด้วย html2canvas ภาษาไทยจึงขึ้นครบโดยไม่ต้องฝังฟอนต์เพิ่ม ~300KB
  const headerText = [
    inv.invoiceNo ? `เลขที่ ${inv.invoiceNo}` : "",
    inv.customerName || "",
    inv.date || "",
  ].filter(Boolean).join("  ·  ");
  let headerImg = null;
  try {
    const { default: html2canvas } = await import("html2canvas");
    const strip = document.createElement("div");
    // สีเทาให้เข้ากับเลขหน้าที่อยู่ข้าง ๆ (เป็นข้อมูลท้ายหน้า ไม่ใช่เนื้อหาบิล)
    strip.style.cssText = "position:fixed;left:-99999px;top:0;width:1400px;background:#fff;color:#5a5a5a;"
      + "font-family:'Sarabun','Sukhumvit Set','Noto Sans Thai',sans-serif;font-size:26px;line-height:1.3;white-space:nowrap;overflow:hidden;padding:2px 0;";
    strip.textContent = headerText;
    document.body.appendChild(strip);
    const canvas = await html2canvas(strip, { backgroundColor: "#ffffff", scale: 1, logging: false });
    document.body.removeChild(strip);
    headerImg = { data: canvas.toDataURL("image/png"), ratio: canvas.height / canvas.width };
  } catch (e) {
    // วาดไม่สำเร็จ → ปล่อยผ่าน ยังได้ PDF ปกติ (แค่ท้ายหน้าเหลือเลขหน้าอย่างเดียว)
    console.warn("[pdf] สร้างข้อมูลท้ายหน้าไม่สำเร็จ:", e?.message || e);
  }

  const { default: html2pdf } = await import("html2pdf.js");
  const worker = html2pdf().set({
    // [บน, ซ้าย, ล่าง, ขวา] — บน/ล่าง 8mm เท่ากันทุกหน้า (ตัวบิลไม่มี padding บน-ล่างแล้ว)
    margin: [PDF_MARGIN_TOP_MM, 4, PDF_MARGIN_BOTTOM_MM, 4],
    filename,
    image: { type: "jpeg", quality: 0.98 },
    // 📐 ตรึงความกว้าง — ต้องส่งทั้ง width และ windowWidth ถึงจะมีผล (ดู PDF_WIDTH_PX)
    //    ไม่งั้น html2pdf ไปวัดขนาดจากเครื่อง → คนละเครื่องได้บิลคนละขนาด
    width: PDF_WIDTH_PX,
    windowWidth: PDF_WIDTH_PX,
    backgroundColor: "#ffffff",
    // windowWidth ในนี้บังคับให้ html2canvas จัดหน้าเสมือนจอกว้าง 764px
    // → media query / ความกว้างแบบ % คิดเหมือนกันทุกเครื่อง
    html2canvas: { scale: renderScale, useCORS: true, windowWidth: PDF_WIDTH_PX, width: PDF_WIDTH_PX, backgroundColor: "#ffffff" },
    jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
    // 📄 วัดตำแหน่งของทุกแถวก่อนแบ่งหน้า — แถวไหนเหลือที่ไม่พอ ให้ยกไปทั้งแถวที่หน้าถัดไป
    //
    // ทำไมต้องใส่ avoid: เดิม PDF หั่นภาพตามความสูงคงที่ ไม่สนว่าตรงนั้นเป็นกลางแถวหรือไม่
    // → บรรทัดขาดครึ่ง ตัวหนังสือโดนตัดคาบเกี่ยว 2 หน้า
    // ส่วนกฎ page-break-inside: avoid ที่มีอยู่ ใช้เฉพาะตอนพิมพ์ตรงจากเบราว์เซอร์
    // ไม่ได้ติดไปกับ PDF จึงต้องบอกตรงนี้อีกที
    // avoid = ก้อนที่ห้ามตัดกลาง — html2pdf จะวัดตำแหน่งแล้วยกไปทั้งก้อนถ้าเหลือที่ไม่พอ
    //   tr           = แถวในตาราง
    //   [data-keep]  = ก้อนที่ทำเครื่องหมายไว้ในบิล เช่น ช่องเซ็นรับของ / กล่องหมายเหตุ
    //                  (เดิมกันแค่ tr ช่องเซ็นจึงขาดครึ่งคาบเกี่ยว 2 หน้า)
    //   thead/tfoot  = หัวตารางกับแถวสรุปยอด
    pagebreak: { mode: ["css", "legacy"], avoid: ["tr", "[data-keep]", "thead", "tfoot"] }
  }).from(source);

  await worker.toPdf().get("pdf").then((pdf) => {
    const total = pdf.internal.getNumberOfPages();
    if (total < 2) return; // หน้าเดียว: มีหัวบิลเต็มอยู่แล้ว ไม่ต้องมีแถบ/เลขหน้า
    const w = pdf.internal.pageSize.getWidth();
    const h = pdf.internal.pageSize.getHeight();
    // 🏷️ ข้อมูลระบุตัวบิล วางไว้ท้ายหน้าข้าง ๆ เลขหน้า (ตัวเล็ก)
    //    อยู่ในแถบขอบล่างที่เว้นไว้ จึงไม่ทับเนื้อหาบิล
    const footY = h - 2.6;                 // เส้นฐานเดียวกับเลขหน้า
    const maxInfoH = 4;                    // สูงสุด 4mm — ตัวเล็กพอ ๆ กับเลขหน้า
    const maxInfoW = w - 4 - 22;           // เว้นที่ทางขวาให้เลขหน้า
    let infoW = maxInfoW;
    let infoH = headerImg ? infoW * headerImg.ratio : 0;
    if (headerImg && infoH > maxInfoH) { infoH = maxInfoH; infoW = infoH / headerImg.ratio; }
    for (let i = 1; i <= total; i++) {
      pdf.setPage(i);
      if (headerImg && infoH > 0) {
        pdf.addImage(headerImg.data, "PNG", 4, footY - infoH + 0.9, infoW, infoH);
      }
      // 🔢 เลขหน้า — ตัวเลข/ขีดเท่านั้น (ฟอนต์มาตรฐานไม่มีตัวอักษรไทย)
      pdf.setFontSize(8);
      pdf.setTextColor(90);
      pdf.text(`${i} / ${total}`, w - 4, footY, { align: "right" });
    }
  }).save();
};
