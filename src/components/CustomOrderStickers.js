// 🎨 สติกเกอร์งาน custom — รูป · ชื่องาน · เจ้าของ · จำนวนตัว · หมายเหตุ
//
// ไว้แปะถุง/กล่องงานสั่งทำ ให้หยิบถูกงานโดยไม่ต้องเปิดใบสั่งผลิต
// แยกไฟล์จากสติกเกอร์ที่อยู่ เพราะตัวนั้นมีกลไกย่อตัวหนังสือ/เลขกล่องของตัวเองซับซ้อนอยู่แล้ว
//
// ดึงใบ custom เอง ไม่รับจาก App — กองใบ custom โหลดเฉพาะตอนเข้าโซนผลิต
// ถ้าเปิดหน้าต่างนี้จากหน้าบาร์โค้ดโดยไม่ได้แวะหน้าผลิตก่อน รายการจะว่างเปล่าเฉย ๆ
import React, { useState, useEffect, useMemo, useRef, useLayoutEffect } from "react";
import { collection, getDocs, query, orderBy, limit } from "firebase/firestore";
import { db } from "../firebase";
import { T } from "../theme";
import { BtnPrimary, BtnGhost } from "./ui";

const LAYOUTS = [
  { key: "thermal", thermal: true, cols: 1, rows: 1, label: "🔥 สติกเกอร์ความร้อน — ตั้งขนาดเอง", w: 100, h: 150 },
  { key: "a4-2x4", cols: 2, rows: 4, label: "2×4 (8 ดวง / A4 — 99×68mm)", w: 99, h: 68 },
  { key: "a4-2x5", cols: 2, rows: 5, label: "2×5 (10 ดวง / A4 — 99×54mm)", w: 99, h: 54 },
];

const norm = (s) => String(s || "").normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();
const fmt = (n) => Number(n || 0).toLocaleString("th-TH");
// รูปของใบ custom เก็บลิงก์ Storage ไว้ในช่องชื่อ dataUrl (ชื่อค้างมาจากสมัยฝัง base64)
const firstImage = (o) => (o?.clothingImages || []).map(i => i?.dataUrl).find(Boolean) || o?.clothingImage || "";
const jobOf = (o) => String(o?.clothingName || o?.jobDescription || "").trim() || "-";

// ดวงเดียว — ใช้ทั้งโหมดความร้อนและตาราง A4
function StickerLabel({ o, qty, lay, showImg, showNote, className }) {
  const bodyRef = useRef(null);
  const img = showImg ? firstImage(o) : "";
  const note = showNote ? String(o?.note || "").trim() : "";
  const portrait = lay.h >= lay.w;

  // 📏 หดตัวหนังสือเท่าที่จำเป็นจนไม่ล้น — ชื่องาน/หมายเหตุยาวสั้นต่างกันมาก เดาสูตรตายตัวไม่ได้
  //    (หลักเดียวกับสติกเกอร์ที่อยู่: วัดของจริงใน DOM ไม่เดาจากจำนวนตัวอักษร)
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    let s = 1, guard = 0;
    el.style.setProperty("--s", "1");
    while (el.scrollHeight > el.clientHeight + 1 && s > 0.4 && guard++ < 40) {
      s -= 0.04;
      el.style.setProperty("--s", s.toFixed(3));
    }
  });

  // ขนาดตั้งต้นผูกกับความกว้างดวง (ดวงนอนเหลือที่ให้ข้อความแค่ ~60% ของความกว้าง)
  const textW = portrait ? lay.w : lay.w * 0.6;
  const base = Math.max(3, Math.min(9, textW * 0.085));
  return (
    <div className={className} style={{ flexDirection: portrait ? "column" : "row" }}>
      {img && (
        <div className={portrait ? "cs-img cs-img-p" : "cs-img cs-img-l"}>
          <img src={img} alt=""/>
        </div>
      )}
      <div className="cs-body" ref={bodyRef} style={{
        "--job": `${base.toFixed(2)}mm`, "--qty": `${(base * 1.15).toFixed(2)}mm`,
        "--txt": `${(base * 0.62).toFixed(2)}mm`, "--sm": `${Math.max(2.2, base * 0.38).toFixed(2)}mm`, "--s": 1,
      }}>
        <div className="cs-job">{jobOf(o)}</div>
        <div className="cs-line"><span className="cs-key">เจ้าของ</span><b>{String(o?.customerName || "").trim() || "-"}</b></div>
        <div className="cs-qty">{fmt(qty)} <span>ตัว</span></div>
        {note && <div className="cs-note"><span className="cs-key">หมายเหตุ</span>{note}</div>}
      </div>
    </div>
  );
}

// แปลงรูปเป็น dataURL ก่อนทำ PDF — html2canvas วาดรูปข้ามโดเมนไม่ได้ถ้าไม่ผ่าน CORS
// ลิงก์ Storage บางโปรเจกต์ไม่ได้เปิด CORS ไว้ ลองแล้วไม่ได้ก็ต้องบอกคนใช้ ห้ามปล่อยให้ได้ PDF รูปหายเงียบ ๆ
const toDataUrl = async (src) => {
  const res = await fetch(src, { mode: "cors" });
  if (!res.ok) throw new Error(String(res.status));
  const blob = await res.blob();
  return await new Promise((ok, bad) => {
    const r = new FileReader();
    r.onload = () => ok(r.result);
    r.onerror = bad;
    r.readAsDataURL(blob);
  });
};

export default function CustomOrderStickers({ printElementById, onClose }) {
  const [orders, setOrders] = useState(null);
  const [loadErr, setLoadErr] = useState("");
  const [search, setSearch] = useState("");
  const [showAll, setShowAll] = useState(false);          // รวมงานที่เก็บประวัติ/ยกเลิกแล้ว
  const [ids, setIds] = useState(() => new Set());
  const [qtys, setQtys] = useState({});                   // จำนวนบนป้าย (ค่าเริ่มต้น = ยอดทั้งใบ)
  const [copies, setCopies] = useState({});
  const [layoutKey, setLayoutKey] = useState("thermal");
  const [thermalW, setThermalW] = useState(100);
  const [thermalH, setThermalH] = useState(150);
  const [showImg, setShowImg] = useState(true);
  const [showNote, setShowNote] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const snap = await getDocs(query(collection(db, "customOrders"), orderBy("createdAt", "desc"), limit(400)));
        if (alive) setOrders(snap.docs.map(d => ({ ...d.data(), id: d.id })));
      } catch (e) {
        if (alive) setLoadErr(e?.message || String(e));
      }
    })();
    return () => { alive = false; };
  }, []);

  const base = LAYOUTS.find(l => l.key === layoutKey) || LAYOUTS[0];
  const lay = base.thermal ? { ...base, w: Number(thermalW) || 100, h: Number(thermalH) || 150 } : base;

  const shown = useMemo(() => {
    const q = norm(search);
    return (orders || [])
      .filter(o => showAll || (!o.archived && (o.status || "") !== "ยกเลิก"))
      .filter(o => !q || norm([o.prodNo, o.customerName, o.clothingName, o.jobDescription, o.note].join(" ")).includes(q));
  }, [orders, search, showAll]);

  const qtyOf = (o) => (qtys[o.id] != null ? Number(qtys[o.id]) || 0 : Number(o.totalQty) || 0);

  // เรียงตามลำดับในรายการ ไม่ใช่ลำดับที่ติ๊ก — ปริ้นออกมาแล้วไล่แปะตามรายการบนจอได้
  const printList = useMemo(() => {
    const out = [];
    (orders || []).forEach(o => {
      if (!ids.has(o.id)) return;
      const n = Math.max(1, Number(copies[o.id]) || 1);
      for (let i = 0; i < n; i++) out.push({ o, qty: qtyOf(o) });
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, ids, copies, qtys]);

  const toggle = (id) => setIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const handlePrint = () => {
    if (!printList.length) { alert("เลือกงานอย่างน้อย 1 ใบ"); return; }
    setTimeout(() => printElementById?.(
      "custom-sticker-area",
      lay.thermal ? `${lay.w}mm ${lay.h}mm` : "A4 portrait",
      lay.thermal ? "0mm" : "8mm",
      1.0,   // ค่าเริ่มต้น 1.3 มีไว้ให้ป้ายม้วน ใช้กับดวงนี้ตัวหนังสือจะล้น
    ), 100);
  };

  const handlePdf = async () => {
    if (!printList.length) { alert("เลือกงานอย่างน้อย 1 ใบ"); return; }
    const el = document.getElementById("custom-sticker-area");
    if (!el || busy) return;
    setBusy(true);
    try {
      const clone = el.cloneNode(true);
      const imgs = Array.from(clone.querySelectorAll("img"));
      let failed = 0;
      const cache = new Map();
      for (const im of imgs) {
        const src = im.getAttribute("src");
        if (!src || src.startsWith("data:")) continue;
        try {
          if (!cache.has(src)) cache.set(src, await toDataUrl(src));
          im.setAttribute("src", cache.get(src));
        } catch { failed++; }
      }
      const { default: html2pdf } = await import("html2pdf.js");
      await html2pdf().set({
        margin: 0,
        filename: lay.thermal ? `custom-${printList.length}x-${lay.w}x${lay.h}mm.pdf` : `custom-${printList.length}x-A4.pdf`,
        image: { type: "jpeg", quality: 0.95 },
        html2canvas: { scale: 3, useCORS: true, backgroundColor: "#ffffff" },
        jsPDF: lay.thermal
          ? { unit: "mm", format: [lay.w, lay.h], orientation: lay.w > lay.h ? "landscape" : "portrait" }
          : { unit: "mm", format: "a4", orientation: "portrait" },
        pagebreak: { mode: ["css", "legacy"] },
      }).from(clone).save();
      if (failed) alert(`PDF สร้างแล้ว แต่รูป ${failed} รูปดึงมาใส่ไม่ได้ (เซิร์ฟเวอร์รูปไม่อนุญาต)\nถ้าต้องการรูปครบ ให้ใช้ปุ่ม 🖨️ พิมพ์ แทน`);
    } catch (e) {
      alert("สร้าง PDF ไม่สำเร็จ: " + (e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const input = { background: T.input, border: `1px solid ${T.inputBorder}`, color: T.text, borderRadius: 7, outline: "none", fontFamily: "'Sarabun',sans-serif" };

  return (
    <>
      {/* ── ตั้งค่า ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14, padding: 12, background: T.card, border: `1px solid ${T.border}`, borderRadius: 10 }}>
        <div>
          <label style={{ fontSize: 11, color: T.muted, fontWeight: 600, display: "block", marginBottom: 4 }}>📐 ขนาดสติกเกอร์</label>
          <select value={layoutKey} onChange={e => setLayoutKey(e.target.value)} style={{ ...input, width: "100%", padding: "7px 10px", fontSize: 12, cursor: "pointer" }}>
            {LAYOUTS.map(l => <option key={l.key} value={l.key}>{l.label}</option>)}
          </select>
          {lay.thermal && (
            <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
              <span style={{ fontSize: 11, color: T.muted, fontWeight: 600 }}>ขนาด (mm):</span>
              <input type="number" min="20" max="250" value={thermalW} onChange={e => setThermalW(e.target.value)} style={{ ...input, width: 70, padding: "5px 8px", fontSize: 12, textAlign: "center", fontFamily: "monospace" }}/>
              <span style={{ color: T.muted, fontSize: 12 }}>×</span>
              <input type="number" min="20" max="250" value={thermalH} onChange={e => setThermalH(e.target.value)} style={{ ...input, width: 70, padding: "5px 8px", fontSize: 12, textAlign: "center", fontFamily: "monospace" }}/>
              <span style={{ fontSize: 11, color: T.muted }}>ตั้ง = รูปบน · นอน = รูปซ้าย</span>
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: T.text, cursor: "pointer" }}>
            <input type="checkbox" checked={showImg} onChange={e => setShowImg(e.target.checked)} style={{ accentColor: T.accent }}/> รูป
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: T.text, cursor: "pointer" }}>
            <input type="checkbox" checked={showNote} onChange={e => setShowNote(e.target.checked)} style={{ accentColor: T.accent }}/> หมายเหตุ
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: T.sub, cursor: "pointer" }}
            title="ปกติซ่อนงานที่เก็บเข้าประวัติแล้วและงานที่ยกเลิก">
            <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} style={{ accentColor: T.accent }}/> รวมงานที่เก็บประวัติ/ยกเลิก
          </label>
        </div>
      </div>

      {/* ── ค้นหา + เลือก ── */}
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 ค้นเลขใบ / ชื่องาน / เจ้าของ / หมายเหตุ..."
          style={{ ...input, flex: 1, padding: "8px 12px", fontSize: 13, borderRadius: 8 }}/>
        <button onClick={() => setIds(new Set(shown.map(o => o.id)))} disabled={!shown.length}
          style={{ padding: "8px 14px", borderRadius: 8, border: `1px solid ${T.border}`, background: "rgba(59,91,139,0.08)", color: T.accent, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
          เลือกทั้งหมด ({shown.length})
        </button>
        <button onClick={() => { setIds(new Set()); setQtys({}); setCopies({}); }}
          style={{ padding: "8px 14px", borderRadius: 8, border: `1px solid ${T.border}`, background: "transparent", color: T.sub, cursor: "pointer", fontSize: 12 }}>
          ล้าง
        </button>
      </div>

      <div style={{ maxHeight: 340, overflowY: "auto", border: `1px solid ${T.border}`, borderRadius: 10, marginBottom: 10 }}>
        {loadErr ? (
          <div style={{ padding: 24, textAlign: "center", color: T.red, fontSize: 13 }}>ดึงใบ custom ไม่สำเร็จ: {loadErr}</div>
        ) : orders === null ? (
          <div style={{ padding: 24, textAlign: "center", color: T.muted, fontSize: 13 }}>⏳ กำลังดึงใบ custom…</div>
        ) : shown.length === 0 ? (
          <div style={{ padding: 24, textAlign: "center", color: T.muted, fontSize: 13 }}>ไม่พบงาน</div>
        ) : shown.map((o, i) => {
          const sel = ids.has(o.id);
          const img = firstImage(o);
          return (
            <div key={o.id} style={{ display: "grid", gridTemplateColumns: "28px 44px 1fr 150px", gap: 10, alignItems: "center", padding: "7px 12px",
              borderTop: i ? `1px solid ${T.border}` : "none", fontSize: 12, background: sel ? "rgba(59,91,139,0.06)" : "transparent" }}>
              <input type="checkbox" checked={sel} onChange={() => toggle(o.id)} style={{ accentColor: T.accent, width: 16, height: 16, cursor: "pointer" }}/>
              <div onClick={() => toggle(o.id)} style={{ width: 40, height: 40, borderRadius: 6, overflow: "hidden", background: "#f1f5f9", border: `1px solid ${T.border}`, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                {img ? <img src={img} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }}/> : <span style={{ fontSize: 9, color: T.muted }}>ไม่มีรูป</span>}
              </div>
              <div onClick={() => toggle(o.id)} style={{ minWidth: 0, cursor: "pointer" }}>
                <div style={{ fontWeight: 700, color: T.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{jobOf(o)}</div>
                <div style={{ fontSize: 11, color: T.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  <span style={{ fontFamily: "monospace" }}>{o.prodNo}</span> · {o.customerName || "-"} · {fmt(o.totalQty)} ตัว
                  {(o.archived || (o.status || "") === "ยกเลิก") && <span style={{ color: T.red }}> · {o.archived ? "เก็บประวัติแล้ว" : "ยกเลิก"}</span>}
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                {sel && (
                  <>
                    <input type="number" min="0" value={qtys[o.id] ?? (Number(o.totalQty) || 0)} title="จำนวนบนป้าย — แบ่งหลายถุงได้ แก้เฉพาะป้าย ไม่แตะใบสั่ง"
                      onChange={e => setQtys(q => ({ ...q, [o.id]: e.target.value }))} onFocus={e => e.target.select()}
                      style={{ ...input, width: 64, padding: "4px 6px", fontSize: 11, textAlign: "center", fontFamily: "monospace" }}/>
                    <input type="number" min="1" max="100" value={copies[o.id] || 1} title="จำนวนดวง"
                      onChange={e => setCopies(c => ({ ...c, [o.id]: Math.max(1, Math.min(100, Number(e.target.value) || 1)) }))} onFocus={e => e.target.select()}
                      style={{ ...input, width: 48, padding: "4px 6px", fontSize: 11, textAlign: "center", fontFamily: "monospace" }}/>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: 10.5, color: T.muted, marginBottom: 10 }}>
        ช่องแรก = จำนวนตัวบนป้าย (แก้ได้ เช่นแบ่งหลายถุง — ไม่แตะใบสั่ง) · ช่องที่สอง = จำนวนดวง
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
        <div style={{ fontSize: 12, color: T.sub }}>
          เลือก <b style={{ color: T.accent }}>{ids.size}</b> งาน · จะปริ้น <b style={{ color: T.green }}>{printList.length}</b> ดวง ·
          {lay.thermal ? <> ดวงละ {lay.w}×{lay.h} mm</> : <> ใช้ <b>{Math.ceil(printList.length / (lay.cols * lay.rows))}</b> หน้า A4</>}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <BtnGhost onClick={onClose}>ปิด</BtnGhost>
          <BtnGhost onClick={handlePdf} disabled={!printList.length || busy} style={{ color: "#dc2626", borderColor: "rgba(220,38,38,0.35)" }}>
            {busy ? "กำลังทำ PDF…" : `📥 PDF (${printList.length})`}
          </BtnGhost>
          <BtnPrimary onClick={handlePrint} disabled={!printList.length}>🖨️ พิมพ์ ({printList.length})</BtnPrimary>
        </div>
      </div>

      {/* 🖨️ พื้นที่พิมพ์ — วาดนอกจอ ให้ printElementById ไปหยิบ */}
      <div style={{ position: "fixed", left: -99999, top: 0, width: 794 }}>
        <div id="custom-sticker-area" style={{ background: "white", padding: lay.thermal ? 0 : "8mm", fontFamily: "'Sarabun',sans-serif", color: "#000" }}>
          <style>{`
            .cs-grid { display: grid; grid-template-columns: repeat(${lay.cols}, 1fr); gap: 3mm; }
            .cs-cell, .cs-thermal { box-sizing: border-box; overflow: hidden; display: flex; background: #fff; color: #000;
                                    border: 0.6mm solid #000; border-radius: 1mm; }
            .cs-cell { height: ${lay.h}mm; }
            .cs-thermal { width: ${lay.w}mm; height: ${lay.h}mm; page-break-after: always; }
            .cs-thermal:last-child { page-break-after: auto; }
            /* รูปกินที่คงที่ ไม่ขึ้นกับขนาดไฟล์รูป — ข้อความจะได้คำนวณพื้นที่ได้แน่นอน */
            .cs-img { flex: 0 0 auto; display: flex; align-items: center; justify-content: center; background: #fff; }
            .cs-img img { max-width: 100%; max-height: 100%; object-fit: contain; display: block; }
            .cs-img-p { height: 45%; width: 100%; border-bottom: 0.35mm dashed #000; padding: 1.5mm; box-sizing: border-box; }
            .cs-img-l { width: 40%; height: 100%; border-right: 0.35mm dashed #000; padding: 1.5mm; box-sizing: border-box; }
            /* ⚠️ ห้าม overflow:hidden ที่ตัวข้อความ — ต้องให้ล้นออกมาวัดได้ ไม่งั้นตัววัดเห็นว่าพอดีทั้งที่โดนตัด */
            .cs-body { flex: 1 1 0; min-height: 0; min-width: 0; padding: 2.5mm 3mm; display: flex; flex-direction: column; gap: 1.2mm; }
            .cs-job { font-size: calc(var(--job) * var(--s)); font-weight: 800; line-height: 1.2; word-break: break-word; }
            .cs-line { font-size: calc(var(--txt) * var(--s)); line-height: 1.3; }
            .cs-key { font-size: calc(var(--sm) * var(--s)); font-weight: 700; color: #334155; margin-right: 1.5mm; }
            .cs-qty { font-size: calc(var(--qty) * var(--s)); font-weight: 800; font-family: monospace; line-height: 1.1; }
            .cs-qty span { font-size: calc(var(--txt) * var(--s)); font-family: 'Sarabun', sans-serif; }
            .cs-note { font-size: calc(var(--sm) * var(--s)); line-height: 1.35; border-top: 0.3mm dashed #94a3b8; padding-top: 1mm; word-break: break-word; }
          `}</style>
          {lay.thermal ? (
            printList.map((x, i) => <StickerLabel key={i} o={x.o} qty={x.qty} lay={lay} showImg={showImg} showNote={showNote} className="cs-thermal"/>)
          ) : (
            <div className="cs-grid">
              {printList.map((x, i) => <StickerLabel key={i} o={x.o} qty={x.qty} lay={lay} showImg={showImg} showNote={showNote} className="cs-cell"/>)}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
