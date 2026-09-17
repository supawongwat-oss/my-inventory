// 📄 PDF สติกเกอร์ — วาดทีละหน้า แล้วรวมเป็นไฟล์เดียว
//
// ⚠️ ทำไมไม่ใช้ html2pdf().from(ทั้งพื้นที่).save() แบบเดิม
//    เดิมวาดสติกเกอร์ทุกดวงต่อกันเป็น "ภาพยาวรูปเดียว" แล้วหั่นเป็นหน้า
//    · 100×150 ที่ scale 4 = ภาพสูง ~2,270px ต่อดวง → 10 ดวงสูง ~22,700px
//      แท็บเล็ตมีเพดานขนาด canvas ต่ำกว่าคอม (iPad ~16.7 ล้านพิกเซลต่อภาพ) เกินแล้วภาพถูกย่อ/เพี้ยน
//      → ยิ่งเลือกหลายชื่อ สติกเกอร์ยิ่งล้นกระดาษ ขณะที่คอมเครื่องเดียวกันออกปกติ (เคสจริง 17/09/2569)
//    · รอยหั่นหน้าคิดจากพิกเซลปัดเศษ ยิ่งหน้าหลัง ๆ ยิ่งเลื่อน
//    (บิล PDF ใน utils/print.js เจอเพดานเดียวกัน แก้ด้วยการวาดแยกชุดเหมือนกัน)
//
//    วาดทีละหน้า = ภาพแต่ละรูปเล็กเท่า 1 หน้าเสมอ ไม่ว่าจะเลือกกี่ดวง · ไม่มีการหั่น จึงไม่มีรอยเลื่อน

const MAX_CANVAS_PX = 12_000_000;   // ต่ำกว่าเพดาน iPad (16.7 ล้าน) เผื่อหน่วยความจำเครื่องเล็ก
const PX_PER_MM = 96 / 25.4;

/**
 * @param {HTMLElement} area   พื้นที่พิมพ์ที่วาดไว้นอกจอ (มี <style> ของตัวเองอยู่ข้างใน)
 * @param {object} o
 *   thermal      true = 1 ดวง 1 หน้า ขนาดดวง · false = กระดาษ A4 เป็นตาราง
 *   w, h         ขนาดดวง (mm)
 *   itemSelector ตัวดวง เช่น ".ad-thermal" / ".ad-cell"
 *   gridSelector (A4) ตัวตาราง เช่น ".ad-grid"
 *   perPage      (A4) ดวงต่อหน้า = cols × rows
 *   rows         (A4) จำนวนแถวต่อหน้า — ใช้คำนวณระยะห่างให้พอดีหน้า
 *   filename
 *   onProgress   (done, total) => void
 *   prepare      async (hostEl) => void — แก้โคลนก่อนวาด เช่นแปลงรูปเป็น dataURL
 */
export async function stickerAreaToPdf(area, o) {
  const { default: html2canvas } = await import("html2canvas");
  const { jsPDF } = await import("jspdf");

  const items = Array.from(area.querySelectorAll(o.itemSelector));
  if (!items.length) throw new Error("ไม่มีสติกเกอร์ให้ทำ PDF");

  const pageW = o.thermal ? o.w : 210;
  const pageH = o.thermal ? o.h : 297;
  const pad = o.thermal ? 0 : 8;

  // โฮสต์นอกจอ — ต้องอยู่ในหน้าเว็บจริง html2canvas ถึงคำนวณ layout/ฟอนต์ได้
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-99999px;top:0;";
  document.body.appendChild(host);

  try {
    // <style> ของพื้นที่พิมพ์ต้องตามมาด้วย — ขนาดดวง/ตัวหนังสืออยู่ในนั้นทั้งหมด
    area.querySelectorAll("style").forEach(s => host.appendChild(s.cloneNode(true)));

    // โคลนดวงไว้ครั้งเดียว — ดวงต้นฉบับหดตัวหนังสือพอดีแล้ว (--s อยู่ใน style attribute ติดมากับโคลน)
    const clones = items.map(el => el.cloneNode(true));
    const pages = [];
    if (o.thermal) {
      clones.forEach(c => pages.push([c]));
    } else {
      const n = Math.max(1, o.perPage || 1);
      for (let i = 0; i < clones.length; i += n) pages.push(clones.slice(i, i + n));
    }

    const pdf = new jsPDF({ unit: "mm", format: o.thermal ? [pageW, pageH] : "a4", orientation: pageW > pageH ? "landscape" : "portrait" });
    const areaStyle = area.getAttribute("style") || "";
    const gridProto = !o.thermal && o.gridSelector ? area.querySelector(o.gridSelector) : null;

    // scale ให้ภาพ 1 หน้าไม่เกินเพดาน — A4 ได้ ~3 เท่า · ดวง 100×150 ได้ 4 เท่า
    const cssW = pageW * PX_PER_MM, cssH = pageH * PX_PER_MM;
    const scale = Math.max(1, Math.min(4, Math.sqrt(MAX_CANVAS_PX / (cssW * cssH))));

    for (let p = 0; p < pages.length; p++) {
      const page = document.createElement("div");
      page.setAttribute("style", areaStyle);
      Object.assign(page.style, {
        width: `${pageW}mm`, height: `${pageH}mm`, padding: `${pad}mm`,
        boxSizing: "border-box", overflow: "hidden", background: "#fff",
      });
      if (gridProto) {
        const grid = gridProto.cloneNode(false);
        // ระยะห่างแถวคิดให้พอดีหน้า — ค่าเดิม 3-4mm ทำให้ 7 แถว × 38mm ยาวเกิน A4 ไปเล็กน้อย
        const rows = Math.max(1, o.rows || 1);
        const gap = rows > 1 ? Math.max(0, Math.min(3, (pageH - pad * 2 - rows * o.h) / (rows - 1))) : 0;
        grid.style.rowGap = `${gap}mm`;
        pages[p].forEach(c => grid.appendChild(c));
        page.appendChild(grid);
      } else {
        pages[p].forEach(c => page.appendChild(c));
      }
      host.appendChild(page);
      if (o.prepare) await o.prepare(page);

      const canvas = await html2canvas(page, { scale, useCORS: true, backgroundColor: "#ffffff", logging: false });
      if (p > 0) pdf.addPage(o.thermal ? [pageW, pageH] : "a4", pageW > pageH ? "landscape" : "portrait");
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.95), "JPEG", 0, 0, pageW, pageH);
      // คืนหน่วยความจำทันที — แท็บเล็ตเก็บ canvas หลายสิบรูปไม่ไหว
      canvas.width = 0; canvas.height = 0;
      host.removeChild(page);
      o.onProgress?.(p + 1, pages.length);
    }
    pdf.save(o.filename);
  } finally {
    document.body.removeChild(host);
  }
}
