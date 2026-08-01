// 🖨️ Print & PDF utilities — extracted from App.js
// 🚀 html2pdf.js (~400KB) → lazy load เฉพาะตอนกดปุ่ม PDF เท่านั้น

// scale fontSize ของทุก element ใน clone (ใช้ก่อนพิมพ์/PDF) — ค่าเริ่มต้น 1.3 = ใหญ่ขึ้น 30%
export const PRINT_FONT_SCALE = 1.3;
// ใบบิล: A4 มีพื้นที่พอ → พิมพ์ที่ขนาดเกือบเต็ม (0.95) ให้ตารางอ่านง่าย
export const INVOICE_FONT_SCALE = 1.0;
// ใบบิล PDF: ย่อลงให้พอดีหน้า A4 มีขอบเหลือ (ฟอนต์ base ตารางใหญ่ → ต้องย่อกว่า print ปกติ)
export const INVOICE_PDF_FONT_SCALE = 0.72;
export const scaleFontInElement = (root, factor = PRINT_FONT_SCALE) => {
  // ต้อง attach root เข้า DOM ชั่วคราวเพื่ออ่าน computed style
  const holder = document.createElement("div");
  holder.style.position = "fixed";
  holder.style.left = "-99999px";
  holder.style.top = "0";
  holder.style.visibility = "hidden";
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

// 📱 ตรวจว่าเป็นมือถือ/แท็บเล็ตหรือไม่
export const isMobileDevice = () =>
  /Android|iPhone|iPad|iPod|Mobi|Tablet|Silk|webOS|Kindle|PlayBook|BB10/i.test(navigator.userAgent)
  || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent))
  || (navigator.userAgentData && navigator.userAgentData.mobile)
  || (window.matchMedia && window.matchMedia("(hover: none) and (pointer: coarse)").matches);

const mmToPx = (mm) => (mm * 96) / 25.4;

const PAGE_MM = {
  "A4 portrait":  [210, 297], "A4 landscape": [297, 210],
  "A5 portrait":  [148, 210], "A5 landscape": [210, 148],
};

// ⏳ overlay ระหว่างสร้าง PDF (สร้าง PDF บนแท็บเล็ตใช้เวลาหลายวินาที ต้องมี feedback)
const pdfOverlay = (msg) => {
  const d = document.createElement("div");
  d.style.cssText = "position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center;color:#fff;font-family:'Sarabun',sans-serif;font-size:17px;font-weight:600;text-align:center;padding:24px;";
  d.textContent = msg;
  document.body.appendChild(d);
  return () => { try { d.remove(); } catch (e) {} };
};

// 🖼️ แปลง <img> ทุกตัวเป็น data URL ก่อนวาดภาพ
// จำเป็นเพราะ html2canvas วาดรูปข้ามโดเมน (โลโก้/รูปงานจาก Storage) ไม่ได้ → กลายเป็นกรอบรูปแตก
const inlineImagesIn = async (root) => {
  const imgs = Array.from(root.querySelectorAll("img"));
  await Promise.all(imgs.map(async (im) => {
    const src = im.getAttribute("src") || "";
    if (!src || src.startsWith("data:")) return;
    try {
      const res = await fetch(src, { mode: "cors", cache: "force-cache" });
      const blob = await res.blob();
      const dataUrl = await new Promise((ok, bad) => {
        const r = new FileReader();
        r.onload = () => ok(r.result);
        r.onerror = bad;
        r.readAsDataURL(blob);
      });
      im.setAttribute("src", dataUrl);
    } catch (e) {
      // โหลดไม่ได้ → ซ่อนไปเลย ดีกว่าโชว์กรอบรูปแตกบนเอกสารที่ส่งลูกค้า
      im.style.visibility = "hidden";
    }
  }));
};

// 🖨️ พิมพ์บนแท็บเล็ต/มือถือ — วาดเอกสารเป็นภาพขนาดเท่าหน้า A4 จริง แล้วสั่งพิมพ์ให้ทันที
// เหตุผล: เบราว์เซอร์บนแท็บเล็ตจัดหน้าเองไม่ตรงกับ PC (ตัวเล็กบ้าง หลุดขอบบ้าง)
//   วาดเป็นภาพจาก layout เดียวกับ PC → หน้าตาตรงกันแน่นอน และไม่ต้องโหลดไฟล์มากดพิมพ์ซ้ำ
// ภาพถูกบังคับ "พอดีหน้า" ด้วย object-fit: contain → ไม่มีทางล้นไปหน้าที่ 2
export const printAsImage = async (el, { labels = null, fontScale = PRINT_FONT_SCALE, pageSize = "A4 portrait", title = "พิมพ์เอกสาร" } = {}) => {
  const [pageW, pageH] = PAGE_MM[pageSize] || [210, 297];
  // 📏 ขอบกระดาษ 5mm (เกือบเต็มหน้า) — @page margin ต้องเป็น 0 เพื่อให้เบราว์เซอร์
  //    ไม่พิมพ์หัว/ท้ายกระดาษของตัวเอง (URL เว็บ + วันที่) แล้วเว้นขอบเองด้วย padding แทน
  const edgeMm = 5;
  const cw = pageW - 2 * edgeMm, ch = pageH - 2 * edgeMm;
  const widthPx = Math.round(mmToPx(cw));
  const sheets = labels && labels.length ? labels : [null];

  // เปิดแท็บทันทีตอนกด (ต้องอยู่ใน user gesture ไม่งั้นโดน popup blocker)
  const w = window.open("", "_blank");
  if (w) {
    w.document.write(`<!doctype html><meta charset="utf-8"><title>${title}</title>
      <body style="margin:0;display:flex;align-items:center;justify-content:center;height:100vh;font-family:'Sarabun',sans-serif;font-size:18px;color:#334155">
      ⏳ กำลังเตรียมเอกสาร...</body>`);
  }

  const hide = pdfOverlay("⏳ กำลังเตรียมเอกสาร...\nกรุณารอสักครู่");
  const holder = document.createElement("div");
  holder.style.cssText = `position:fixed;left:-99999px;top:0;width:${widthPx}px;background:#fff;`;
  document.body.appendChild(holder);
  try {
    const { default: html2pdf } = await import("html2pdf.js");
    const renderSheet = async (label, scale) => {
      const cl = el.cloneNode(true);
      cl.removeAttribute("id");
      if (label) {
        const tag = cl.querySelector("[data-doc-label]");
        if (tag) tag.textContent = label;
      }
      scaleFontInElement(cl, scale);
      cl.style.width = widthPx + "px";
      cl.style.maxWidth = widthPx + "px";
      cl.style.boxSizing = "border-box";
      holder.innerHTML = "";
      holder.appendChild(cl);
      await inlineImagesIn(cl);
      // ใช้ html2canvas ที่มากับ html2pdf.js (ไม่ต้องเพิ่ม dependency)
      return html2pdf().set({
        html2canvas: { scale: 2, useCORS: true, backgroundColor: "#ffffff", windowWidth: widthPx, logging: false },
      }).from(cl).toCanvas().get("canvas");
    };

    // 🔍 วาดชุดแรกก่อนเพื่อวัดความสูงจริง — ถ้าเอกสารสั้นกว่าหน้ากระดาษมาก
    //    ขยายตัวหนังสือให้เต็มหน้าขึ้น (ขยายเฉพาะฟอนต์ → ความสูงโตช้ากว่าตัวคูณ จึงไม่มีทางล้นหน้า)
    let scale = fontScale;
    let firstCanvas = await renderSheet(sheets[0], scale);
    const pageRatio = ch / cw;
    const ratio = firstCanvas.height / firstCanvas.width;
    if (ratio > 0 && ratio < pageRatio * 0.94) {
      const grow = Math.min(pageRatio / ratio, 1.35);
      if (grow > 1.08) {
        scale = fontScale * grow;
        firstCanvas = await renderSheet(sheets[0], scale);
      }
    }

    const pages = [firstCanvas.toDataURL("image/jpeg", 0.95)];
    for (const label of sheets.slice(1)) {
      const canvas = await renderSheet(label, scale);
      pages.push(canvas.toDataURL("image/jpeg", 0.95));
    }

    const body = pages.map(src => `<div class="pg"><img src="${src}" alt=""/></div>`).join("");
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
      <link rel="icon" href="data:,">
      <style>
        /* margin:0 = เบราว์เซอร์ไม่พิมพ์หัว/ท้ายกระดาษ (URL + วันที่) */
        @page { size: ${pageW}mm ${pageH}mm; margin: 0; }
        html, body { margin:0; padding:0; background:#525659; }
        .pg { width:${pageW}mm; height:${pageH}mm; padding:${edgeMm}mm; box-sizing:border-box; margin:0 auto; display:flex; align-items:flex-start; justify-content:center; page-break-after:always; background:#fff; overflow:hidden; }
        .pg:last-child { page-break-after:auto; }
        .pg img { max-width:100%; max-height:100%; width:100%; object-fit:contain; object-position:top center; }
        #__pb { position:fixed; top:10px; right:10px; padding:12px 20px; background:#3b5b8b; color:#fff; border:none; border-radius:8px; font-size:16px; font-weight:700; font-family:'Sarabun',sans-serif; z-index:9; }
        @media print { #__pb { display:none !important; } html, body { background:#fff; } }
      </style></head><body>
      <button id="__pb" onclick="window.print()">🖨️ พิมพ์</button>
      ${body}
      <script>window.addEventListener("load",function(){setTimeout(function(){try{window.focus();window.print();}catch(e){}},400);});<\/script>
      </body></html>`;

    if (w && !w.closed) {
      w.document.open();
      w.document.write(html);
      w.document.close();
    } else {
      alert("เบราว์เซอร์บล็อก popup — กรุณาอนุญาต popup สำหรับหน้านี้แล้วลองใหม่");
    }
  } finally {
    holder.remove();
    hide();
  }
};

// 🖨️ พิมพ์แบบ same-page isolation — ใช้ได้ทุกอุปกรณ์ (desktop + Samsung/iOS/Android)
// วิธีนี้ clone เนื้อหาที่จะพิมพ์ไปไว้ที่ body ระดับบนสุด แล้วใช้ @media print ซ่อนทุกอย่างที่เหลือ
// → ไม่มี sidebar/โลโก้แอป หลุดเข้ามา (เดิม iframe.print() บน Samsung พิมพ์ทั้งหน้าหลัก = โลโก้ซ้ำ)
export const printElementById = (id, pageSize = "A4 portrait", pageMargin = "10mm", fontScale = PRINT_FONT_SCALE) => {
  const el = document.getElementById(id);
  if (!el) return;
  const thermalMatch = /^(\d+(?:\.\d+)?)mm\s+(\d+(?:\.\d+)?)mm$/i.exec(String(pageSize).trim());
  const isThermal = !!thermalMatch;
  const tW = isThermal ? Number(thermalMatch[1]) : null;

  // 🩹 Mobile/Tablet (Samsung Tab, iPad, Android) — เปิด tab ใหม่แล้ว print
  //    เพราะ Samsung Print Service capture ทั้งหน้าจอ ไม่ honor display:none
  const isMobile = isMobileDevice();

  // 📄 แท็บเล็ต/มือถือ (ยกเว้นสติกเกอร์ความร้อน) → วาดเป็นภาพแล้วสั่งพิมพ์ทันที (หน้าตาตรงกับ PC)
  if (isMobile && !isThermal) {
    printAsImage(el, { fontScale, pageSize, pageMargin })
      .catch(err => { console.warn("[print] image print failed:", err); alert("เตรียมเอกสารไม่สำเร็จ — ลองใหม่อีกครั้ง"); });
    return;
  }

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
    // ให้ตัวหนังสือเท่า PC — เดิม cap 1.0 ทำให้ Galaxy Tab/มือถือเล็กกว่า desktop (ที่ใช้ 1.3)
    // กันตกขอบด้วย width:100% + word-break ใน CSS ด้านล่างแทน (ไม่ใช่ย่อฟอนต์)
    const finalElM = isThermal ? cloneM : scaleFontInElement(cloneM, fontScale);
    // 🩹 ลด padding รอบ ๆ print-area — เดิม 32px 40px กว้างเกินไป
    finalElM.style.padding = "6mm 8mm";
    finalElM.style.boxSizing = "border-box";
    // 📐 บังคับความกว้างเท่าพื้นที่พิมพ์จริง — เดิมใช้ 100% (= กว้างตามจอแท็บเล็ต) ทำให้หลุดขอบกระดาษ
    const pmE = String(cssPageSizeM).match(/^([\d.]+)mm\s+([\d.]+)mm$/);
    const contentWidthE = (pmE && !isThermal) ? (parseFloat(pmE[1]) - 12) + "mm" : "100%"; // @page margin 6mm × 2
    finalElM.style.width = contentWidthE;
    finalElM.style.maxWidth = contentWidthE;
    finalElM.style.margin = "0 auto";
    // ดึง <style>/<link> ที่จำเป็นจาก parent (สำหรับให้สไตล์ inline ของ React ทำงานเหมือนเดิม)
    const html = `<!doctype html><html><head><meta charset="utf-8"/>
      <title>พิมพ์เอกสาร</title>
      <link rel="icon" href="data:,">
      <style>
        @page { size: ${cssPageSizeM}; margin: 6mm; }
        html, body { margin: 0; padding: 0; background: white; color: #1e293b; font-family: 'Sarabun','Sukhumvit Set','Noto Sans Thai',sans-serif; width: 100%; max-width: 100%; box-sizing: border-box; overflow-x: hidden; }
        * { box-sizing: border-box; }
        body > * { max-width: ${contentWidthE} !important; }
        table { border-collapse: collapse; width: 100% !important; max-width: 100% !important; }
        tr, td, th { page-break-inside: avoid; min-width: 0 !important; word-break: break-word; }
        thead { display: table-header-group; }
        tfoot { display: table-footer-group; }
        img { max-width: 100%; height: auto; }
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
    @page { size: ${cssPageSize}; margin: ${pageMargin}; }
    #__print_root__ table { border-collapse: collapse; width: 100%; ${tableLayout} }
    #__print_root__ tr, #__print_root__ td, #__print_root__ th { page-break-inside: avoid; min-width: 0 !important; word-break: break-word; }
    #__print_root__ thead { display: table-header-group; }
    #__print_root__ tfoot { display: table-footer-group; }
    #__print_root__ img { max-width: 100%; height: auto; }
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
export const printInvoiceCopies = (id, labels = ["ใบส่งของ/ใบแจ้งหนี้ (ต้นฉบับ)", "ใบส่งของ/ใบแจ้งหนี้ (สำเนา)", "ใบส่งของ/ใบแจ้งหนี้ (สำเนา)"], fontScale = INVOICE_FONT_SCALE, pageSize = "A4 portrait", pageMargin = "10mm") => {
  const el = document.getElementById(id);
  if (!el) return;

  // 📄 แท็บเล็ต/มือถือ → วาดทุกชุดเป็นภาพแล้วสั่งพิมพ์ทันที (ต้นฉบับ+สำเนา อยู่ในงานพิมพ์เดียว)
  if (isMobileDevice()) {
    printAsImage(el, { labels, fontScale, pageSize, pageMargin, title: `พิมพ์เอกสาร × ${labels.length}` })
      .catch(err => { console.warn("[print] image print failed:", err); alert("เตรียมเอกสารไม่สำเร็จ — ลองใหม่อีกครั้ง"); });
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
    @page { size: ${cssPageSize2}; margin: ${pageMargin}; }
    #__print_root__ > div { width: ${contentWidth2} !important; max-width: ${contentWidth2} !important; box-sizing: border-box; }
    #__print_root__ table { border-collapse: collapse; width: 100%; ${tableLayout2} }
    #__print_root__ tr, #__print_root__ td, #__print_root__ th { page-break-inside: avoid; min-width: 0 !important; word-break: break-word; }
    #__print_root__ thead { display: table-header-group; }
    #__print_root__ img { max-width: 100%; height: auto; }
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
  }
  // 📐 บังคับความกว้าง = A4 content (~190mm ≈ 718px @96dpi) → html2canvas จับภาพเท่าหน้าจริง ไม่ล้นขอบ
  source.style.width = "718px";
  source.style.boxSizing = "border-box";
  // 🚀 lazy import — โหลด html2pdf.js เฉพาะตอนกดปุ่มนี้เท่านั้น (~400KB)
  const { default: html2pdf } = await import("html2pdf.js");
  html2pdf().set({
    margin: 10,
    filename,
    image: { type: "jpeg", quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true },
    jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
    pagebreak: { mode: ["css", "legacy"] }
  }).from(source).save();
};
