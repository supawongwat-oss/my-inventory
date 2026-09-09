// 🏷️ Print Barcode Stickers — ปริ้น barcode หลายๆ ใบใน 1 หน้า A4
import { useState, useMemo } from "react";
// 🚀 html2pdf.js (~400KB) → lazy load เฉพาะตอนกดปุ่ม PDF
import { T } from "../theme";
import { Modal, MHead, BtnPrimary, BtnGhost } from "./ui";
import { BarcodeDisplay } from "./ui";

// layout presets (col x row per A4)
const LAYOUTS = [
  { key: "3x10", cols: 3, rows: 10, label: "3×10 (30 ดวง / A4)", w: 65, h: 28 },
  { key: "4x10", cols: 4, rows: 10, label: "4×10 (40 ดวง / A4)", w: 48, h: 28 },
  { key: "2x8",  cols: 2, rows: 8,  label: "2×8 (16 ดวง / A4 — ใหญ่)", w: 95, h: 35 },
  { key: "5x13", cols: 5, rows: 13, label: "5×13 (65 ดวง / A4 — เล็ก)", w: 38, h: 20 },
  { key: "thermal", thermal: true, cols: 1, rows: 1, label: "🔥 สติกเกอร์ความร้อน (Aimo) — ตั้งขนาดเอง", w: 60, h: 40 },
];

// 📮 layout สำหรับสติกเกอร์ที่อยู่ — ช่องต้องใหญ่กว่าบาร์โค้ดมาก
//    ชื่อ+ที่อยู่+เบอร์ ยัดลงช่อง 65×28mm ของบาร์โค้ดไม่ได้ ตัวหนังสือจะเล็กจนอ่านไม่ออก
const ADDR_LAYOUTS = [
  { key: "a4-2x7", cols: 2, rows: 7, label: "2×7 (14 ดวง / A4 — 99×38mm)", w: 99, h: 38 },
  { key: "a4-2x5", cols: 2, rows: 5, label: "2×5 (10 ดวง / A4 — ใหญ่)", w: 99, h: 54 },
  { key: "a4-1x5", cols: 1, rows: 5, label: "1×5 (5 ดวง / A4 — ใหญ่มาก)", w: 190, h: 54 },
  { key: "thermal", thermal: true, cols: 1, rows: 1, label: "🔥 สติกเกอร์ความร้อน — ตั้งขนาดเอง", w: 100, h: 150 },
];

export default function BarcodePrintModal({ products = [], clothingItems = [], customers = [], companyInfo = null, onClose, printElementById }) {
  // 🏷️ = บาร์โค้ดติดสินค้า · 📮 = ที่อยู่ลูกค้าติดกล่องพัสดุ
  //    อยู่หน้าต่างเดียวกันเพราะเป็นงาน "ปริ้นสติกเกอร์" เหมือนกัน ใช้เครื่องเดียวกัน
  //    แต่แยกรายการที่เลือกและ layout กันคนละชุด — สลับโหมดแล้วของที่เลือกไว้ต้องไม่หาย
  const [tab, setTab] = useState("barcode");
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [search, setSearch] = useState("");
  const [layoutKey, setLayoutKey] = useState("3x10");
  const [showName, setShowName] = useState(true);
  const [showPrice, setShowPrice] = useState(true);
  const [copies, setCopies] = useState({}); // {productId: count}
  const [thermalW, setThermalW] = useState(60); // mm
  const [thermalH, setThermalH] = useState(40); // mm

  // ── โหมดที่อยู่ลูกค้า ──
  const [addrIds, setAddrIds] = useState(new Set());
  const [addrCopies, setAddrCopies] = useState({});
  const [addrSearch, setAddrSearch] = useState("");
  const [addrLayoutKey, setAddrLayoutKey] = useState("a4-2x7");
  const [addrThermalW, setAddrThermalW] = useState(100); // mm — ขนาดป้ายพัสดุมาตรฐาน
  const [addrThermalH, setAddrThermalH] = useState(150);
  const [showPhone, setShowPhone] = useState(true);
  const [showAddr, setShowAddr] = useState(true);
  const [showSender, setShowSender] = useState(false);

  // รวม products + clothing ที่มี barcode
  const allItems = useMemo(() => {
    const out = [];
    products.forEach(p => {
      if (!p.barcode) return;
      out.push({ id: p.id, name: p.name, code: p.code, barcode: p.barcode, price: p.salePrice, type: "ทั่วไป" });
    });
    clothingItems.forEach(item => {
      (item.colors||[]).forEach((col, ci) => {
        if (col.barcode) out.push({ id: `${item.id}_${ci}`, name: `${item.model} / ${col.colorName}`, code: item.id?.slice(0,6), barcode: col.barcode, price: col.salePrice, type: "เสื้อผ้า" });
      });
    });
    return out;
  }, [products, clothingItems]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return allItems;
    return allItems.filter(i => (i.name||"").toLowerCase().includes(q) || (i.code||"").toLowerCase().includes(q) || (i.barcode||"").toLowerCase().includes(q));
  }, [allItems, search]);

  const addrFiltered = useMemo(() => {
    const q = addrSearch.toLowerCase().trim();
    const list = [...customers].sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "th"));
    if (!q) return list;
    return list.filter(c => [c.name, c.phone, c.address].join(" ").toLowerCase().includes(q));
  }, [customers, addrSearch]);

  const addrLayoutBase = ADDR_LAYOUTS.find(l => l.key === addrLayoutKey) || ADDR_LAYOUTS[0];
  const addrLayout = addrLayoutBase.thermal
    ? { ...addrLayoutBase, w: Number(addrThermalW) || 100, h: Number(addrThermalH) || 150 }
    : addrLayoutBase;

  const addrList = useMemo(() => {
    const out = [];
    addrIds.forEach(id => {
      const c = customers.find(x => x.id === id);
      if (!c) return;
      const n = Math.max(1, addrCopies[id] || 1);
      for (let i = 0; i < n; i++) out.push(c);
    });
    return out;
  }, [addrIds, addrCopies, customers]);

  // ลูกค้าที่ยังไม่ได้กรอกที่อยู่ — ต้องเห็นก่อนกดพิมพ์ ไม่ใช่ได้สติกเกอร์เปล่ามาแล้วค่อยรู้
  const addrMissing = useMemo(
    () => [...addrIds].map(id => customers.find(x => x.id === id)).filter(c => c && !String(c.address || "").trim()),
    [addrIds, customers]);

  const layoutBase = LAYOUTS.find(l => l.key === layoutKey) || LAYOUTS[0];
  const layout = layoutBase.thermal
    ? { ...layoutBase, w: Number(thermalW) || 60, h: Number(thermalH) || 40 }
    : layoutBase;

  // สร้างรายการที่จะปริ้น (รวม copies)
  const printList = useMemo(() => {
    const out = [];
    selectedIds.forEach(id => {
      const item = allItems.find(x => x.id === id);
      if (!item) return;
      const count = Math.max(1, copies[id] || 1);
      for (let i = 0; i < count; i++) out.push(item);
    });
    return out;
  }, [selectedIds, copies, allItems]);

  const toggleSelect = (id) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const selectAll = () => setSelectedIds(new Set(filtered.map(i => i.id)));
  const clearAll = () => { setSelectedIds(new Set()); setCopies({}); };

  const handlePrint = () => {
    if (tab === "address") {
      if (addrList.length === 0) { alert("เลือกลูกค้าอย่างน้อย 1 ราย"); return; }
      if (addrLayout.thermal) {
        const w = Number(addrThermalW) || 100, h = Number(addrThermalH) || 150;
        setTimeout(() => printElementById?.("address-sticker-area", `${w}mm ${h}mm`, "0mm", 1.0), 100);
      } else {
        // fontScale 1.0 — ค่าเริ่มต้น 1.3 มีไว้สำหรับป้ายม้วน ตัวหนังสือจะล้นช่องสติกเกอร์
        setTimeout(() => printElementById?.("address-sticker-area", "A4 portrait", "8mm", 1.0), 100);
      }
      return;
    }
    if (printList.length === 0) { alert("เลือกสินค้าอย่างน้อย 1 รายการ"); return; }
    if (layout.thermal) {
      const w = Number(thermalW) || 60, h = Number(thermalH) || 40;
      setTimeout(() => printElementById?.("barcode-sticker-area", `${w}mm ${h}mm`, "0mm"), 100);
    } else {
      setTimeout(() => printElementById?.("barcode-sticker-area", "A4 portrait", "8mm"), 100);
    }
  };

  const handleDownloadPdf = async () => {
    const isAddr = tab === "address";
    const list = isAddr ? addrList : printList;
    if (list.length === 0) { alert(isAddr ? "เลือกลูกค้าอย่างน้อย 1 ราย" : "เลือกสินค้าอย่างน้อย 1 รายการ"); return; }
    const el = document.getElementById(isAddr ? "address-sticker-area" : "barcode-sticker-area");
    if (!el) return;
    const lay = isAddr ? addrLayout : layout;
    const w = isAddr ? (Number(addrThermalW) || 100) : (Number(thermalW) || 60);
    const h = isAddr ? (Number(addrThermalH) || 150) : (Number(thermalH) || 40);
    const stem = isAddr ? "address" : "stickers";
    const filename = lay.thermal
      ? `${stem}-${list.length}x-${w}x${h}mm.pdf`
      : `${stem}-${list.length}x-A4.pdf`;
    // 🚀 lazy import html2pdf.js (~400KB) เฉพาะตอนกด PDF
    const { default: html2pdf } = await import("html2pdf.js");
    html2pdf().set({
      margin: 0,
      filename,
      image: { type: "jpeg", quality: 0.98 },
      html2canvas: { scale: 4, useCORS: true, backgroundColor: "#ffffff" },
      jsPDF: lay.thermal
        ? { unit: "mm", format: [w, h], orientation: w > h ? "landscape" : "portrait" }
        : { unit: "mm", format: "a4", orientation: "portrait" },
      pagebreak: { mode: ["css", "legacy"] }
    }).from(el.cloneNode(true)).save();
  };

  return (
    <Modal onClose={onClose} w={1000}>
      <MHead title="🏷️ ปริ้นสติกเกอร์"
        sub={tab === "address" ? "เลือกลูกค้า + จำนวน → ปริ้นแปะกล่องพัสดุ" : "เลือกสินค้า + จำนวน → ปริ้นออกมาตัดติด"}
        onClose={onClose} color={T.accent}/>

      <div style={{ display: "flex", gap: 4, background: "#eef2f7", borderRadius: 8, padding: 3, marginBottom: 14 }}>
        {[{ id: "barcode", l: "🏷️ บาร์โค้ดสินค้า" }, { id: "address", l: "📮 ที่อยู่ลูกค้า" }].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ flex: 1, padding: "7px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 12.5, fontWeight: 700, fontFamily: "inherit",
              background: tab === t.id ? "white" : "transparent", color: tab === t.id ? T.accent : T.sub,
              boxShadow: tab === t.id ? "0 1px 3px rgba(0,0,0,0.1)" : "none" }}>
            {t.l}
          </button>
        ))}
      </div>

      {tab === "address" ? (
        <>
          {/* ── ตั้งค่าสติกเกอร์ที่อยู่ ── */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14, padding: 12, background: T.card, border: `1px solid ${T.border}`, borderRadius: 10 }}>
            <div>
              <label style={{ fontSize: 11, color: T.muted, fontWeight: 600, display: "block", marginBottom: 4 }}>📐 ขนาดสติกเกอร์</label>
              <select value={addrLayoutKey} onChange={e => setAddrLayoutKey(e.target.value)}
                style={{ width: "100%", background: T.input, border: `1px solid ${T.inputBorder}`, color: T.text, borderRadius: 7, padding: "7px 10px", fontSize: 12, outline: "none", cursor: "pointer" }}>
                {ADDR_LAYOUTS.map(l => <option key={l.key} value={l.key}>{l.label}</option>)}
              </select>
              {addrLayout.thermal && (
                <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 11, color: T.muted, fontWeight: 600 }}>ขนาด (mm):</span>
                  <input type="number" min="20" max="250" value={addrThermalW} onChange={e => setAddrThermalW(e.target.value)}
                    style={{ width: 70, background: T.input, border: `1px solid ${T.inputBorder}`, color: T.text, borderRadius: 6, padding: "5px 8px", fontSize: 12, outline: "none", fontFamily: "monospace", textAlign: "center" }}/>
                  <span style={{ color: T.muted, fontSize: 12 }}>×</span>
                  <input type="number" min="20" max="250" value={addrThermalH} onChange={e => setAddrThermalH(e.target.value)}
                    style={{ width: 70, background: T.input, border: `1px solid ${T.inputBorder}`, color: T.text, borderRadius: 6, padding: "5px 8px", fontSize: 12, outline: "none", fontFamily: "monospace", textAlign: "center" }}/>
                  <span style={{ fontSize: 11, color: T.muted }}>(ป้ายพัสดุมาตรฐาน 100×150)</span>
                </div>
              )}
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: T.text, cursor: "pointer" }}>
                <input type="checkbox" checked={showAddr} onChange={e => setShowAddr(e.target.checked)} style={{ accentColor: T.accent }}/>
                ที่อยู่
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: T.text, cursor: "pointer" }}>
                <input type="checkbox" checked={showPhone} onChange={e => setShowPhone(e.target.checked)} style={{ accentColor: T.accent }}/>
                เบอร์โทร
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: T.text, cursor: "pointer" }}
                title="ใส่ชื่อ/เบอร์ร้านไว้มุมบน เผื่อพัสดุตีกลับ">
                <input type="checkbox" checked={showSender} onChange={e => setShowSender(e.target.checked)} style={{ accentColor: T.accent }}/>
                ผู้ส่ง (ชื่อร้าน)
              </label>
            </div>
          </div>

          {/* ค้นหา + เลือก */}
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <input value={addrSearch} onChange={e => setAddrSearch(e.target.value)} placeholder="🔍 ค้นหาชื่อ / เบอร์ / ที่อยู่..."
              style={{ flex: 1, background: T.input, border: `1px solid ${T.inputBorder}`, color: T.text, borderRadius: 8, padding: "8px 12px", fontFamily: "'Sarabun',sans-serif", fontSize: 13, outline: "none" }}/>
            <button onClick={() => setAddrIds(new Set(addrFiltered.map(c => c.id)))}
              style={{ padding: "8px 14px", borderRadius: 8, border: `1px solid ${T.border}`, background: "rgba(59,91,139,0.08)", color: T.accent, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
              เลือกทั้งหมด ({addrFiltered.length})
            </button>
            <button onClick={() => { setAddrIds(new Set()); setAddrCopies({}); }}
              style={{ padding: "8px 14px", borderRadius: 8, border: `1px solid ${T.border}`, background: "transparent", color: T.sub, cursor: "pointer", fontSize: 12 }}>
              ล้าง
            </button>
          </div>

          <div style={{ maxHeight: 320, overflowY: "auto", border: `1px solid ${T.border}`, borderRadius: 10, marginBottom: 10 }}>
            {addrFiltered.length === 0 ? (
              <div style={{ padding: 30, textAlign: "center", color: T.muted, fontSize: 13 }}>ไม่พบลูกค้า</div>
            ) : addrFiltered.map((c, i) => {
              const sel = addrIds.has(c.id);
              const noAddr = !String(c.address || "").trim();
              return (
                <div key={c.id} style={{ display: "grid", gridTemplateColumns: "30px 1fr 110px 80px", alignItems: "center", padding: "8px 14px", borderBottom: i < addrFiltered.length - 1 ? `1px solid ${T.border}` : "none", fontSize: 12, background: sel ? "rgba(59,91,139,0.06)" : "transparent" }}>
                  <input type="checkbox" checked={sel} onChange={() => setAddrIds(prev => { const n = new Set(prev); n.has(c.id) ? n.delete(c.id) : n.add(c.id); return n; })}
                    style={{ accentColor: T.accent, width: 16, height: 16, cursor: "pointer" }}/>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, color: T.text }}>{c.name}</div>
                    <div style={{ fontSize: 10, color: noAddr ? "#b45309" : T.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {noAddr ? "⚠️ ยังไม่ได้กรอกที่อยู่" : c.address}
                    </div>
                  </div>
                  <div style={{ fontFamily: "monospace", fontSize: 11, color: T.sub }}>{c.phone || "—"}</div>
                  <div>
                    {sel && (
                      <input type="number" min="1" max="100" value={addrCopies[c.id] || 1}
                        onChange={e => setAddrCopies(x => ({ ...x, [c.id]: Math.max(1, Math.min(100, Number(e.target.value) || 1)) }))}
                        onFocus={e => e.target.select()}
                        style={{ width: 60, padding: "4px 6px", borderRadius: 5, border: `1px solid ${T.border}`, background: T.input, color: T.text, fontSize: 11, textAlign: "center", fontFamily: "monospace" }}
                        title="จำนวนดวง"/>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* ⚠️ เลือกคนที่ยังไม่มีที่อยู่ = ได้สติกเกอร์เปล่า ต้องรู้ก่อนกดพิมพ์ */}
          {addrMissing.length > 0 && (
            <div style={{ fontSize: 11, color: "#92400e", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "8px 11px", marginBottom: 10, lineHeight: 1.6 }}>
              ⚠️ ที่เลือกไว้มี <b>{addrMissing.length}</b> รายที่ยังไม่ได้กรอกที่อยู่ — สติกเกอร์จะมีแค่ชื่อกับเบอร์<br/>
              {addrMissing.slice(0, 6).map(c => c.name).join(" · ")}{addrMissing.length > 6 ? ` … อีก ${addrMissing.length - 6} ราย` : ""}
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
            <div style={{ fontSize: 12, color: T.sub }}>
              เลือก <b style={{ color: T.accent }}>{addrIds.size}</b> ราย · จะปริ้น <b style={{ color: T.green }}>{addrList.length}</b> ดวง ·
              {addrLayout.thermal
                ? <> ดวงละ {Number(addrThermalW) || 100}×{Number(addrThermalH) || 150} mm</>
                : <> ใช้ <b>{Math.ceil(addrList.length / (addrLayout.cols * addrLayout.rows))}</b> หน้า A4</>}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <BtnGhost onClick={onClose}>ปิด</BtnGhost>
              <BtnGhost onClick={handleDownloadPdf} disabled={addrList.length === 0} style={{ color: "#dc2626", borderColor: "rgba(220,38,38,0.35)" }}>
                📥 PDF ({addrList.length})
              </BtnGhost>
              <BtnPrimary onClick={handlePrint} disabled={addrList.length === 0}>🖨️ พิมพ์ ({addrList.length})</BtnPrimary>
            </div>
          </div>
        </>
      ) : (
      <>

      {/* Settings */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14, padding: 12, background: T.card, border: `1px solid ${T.border}`, borderRadius: 10 }}>
        <div>
          <label style={{ fontSize: 11, color: T.muted, fontWeight: 600, display: "block", marginBottom: 4 }}>📐 รูปแบบ Layout</label>
          <select value={layoutKey} onChange={e => setLayoutKey(e.target.value)}
            style={{ width: "100%", background: T.input, border: `1px solid ${T.inputBorder}`, color: T.text, borderRadius: 7, padding: "7px 10px", fontSize: 12, outline: "none", cursor: "pointer" }}>
            {LAYOUTS.map(l => <option key={l.key} value={l.key}>{l.label}</option>)}
          </select>
          {layout.thermal && (
            <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
              <span style={{ fontSize: 11, color: T.muted, fontWeight: 600 }}>ขนาด (mm):</span>
              <input type="number" min="10" max="200" value={thermalW} onChange={e => setThermalW(e.target.value)}
                style={{ width: 70, background: T.input, border: `1px solid ${T.inputBorder}`, color: T.text, borderRadius: 6, padding: "5px 8px", fontSize: 12, outline: "none", fontFamily: "monospace", textAlign: "center" }}/>
              <span style={{ color: T.muted, fontSize: 12 }}>×</span>
              <input type="number" min="10" max="200" value={thermalH} onChange={e => setThermalH(e.target.value)}
                style={{ width: 70, background: T.input, border: `1px solid ${T.inputBorder}`, color: T.text, borderRadius: 6, padding: "5px 8px", fontSize: 12, outline: "none", fontFamily: "monospace", textAlign: "center" }}/>
              <span style={{ fontSize: 11, color: T.muted }}>(เริ่มต้น 60×40 mm)</span>
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: T.text, cursor: "pointer" }}>
            <input type="checkbox" checked={showName} onChange={e => setShowName(e.target.checked)} style={{ accentColor: T.accent }}/>
            แสดงชื่อสินค้า
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: T.text, cursor: "pointer" }}>
            <input type="checkbox" checked={showPrice} onChange={e => setShowPrice(e.target.checked)} style={{ accentColor: T.accent }}/>
            แสดงราคา
          </label>
        </div>
      </div>

      {/* Search + select all */}
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 ค้นหาสินค้า..."
          style={{ flex: 1, background: T.input, border: `1px solid ${T.inputBorder}`, color: T.text, borderRadius: 8, padding: "8px 12px", fontFamily: "'Sarabun',sans-serif", fontSize: 13, outline: "none" }}/>
        <button onClick={selectAll} style={{ padding: "8px 14px", borderRadius: 8, border: `1px solid ${T.border}`, background: "rgba(59,91,139,0.08)", color: T.accent, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
          เลือกทั้งหมด ({filtered.length})
        </button>
        <button onClick={clearAll} style={{ padding: "8px 14px", borderRadius: 8, border: `1px solid ${T.border}`, background: "transparent", color: T.sub, cursor: "pointer", fontSize: 12 }}>
          ล้าง
        </button>
      </div>

      {/* Item list */}
      <div style={{ maxHeight: 320, overflowY: "auto", border: `1px solid ${T.border}`, borderRadius: 10, marginBottom: 14 }}>
        {filtered.length === 0 ? (
          <div style={{ padding: 30, textAlign: "center", color: T.muted, fontSize: 13 }}>
            ไม่มีสินค้าที่มีบาร์โค้ด<br/>
            <span style={{ fontSize: 11 }}>เพิ่ม barcode ในตอนสร้างสินค้า/รุ่นเสื้อก่อน</span>
          </div>
        ) : filtered.map((it, i) => {
          const sel = selectedIds.has(it.id);
          return (
            <div key={it.id} style={{ display: "grid", gridTemplateColumns: "30px 1fr 110px 100px 80px", alignItems: "center", padding: "8px 14px", borderBottom: i < filtered.length-1 ? `1px solid ${T.border}` : "none", fontSize: 12, background: sel ? "rgba(59,91,139,0.06)" : "transparent" }}>
              <input type="checkbox" checked={sel} onChange={() => toggleSelect(it.id)} style={{ accentColor: T.accent, width: 16, height: 16, cursor: "pointer" }}/>
              <div>
                <div style={{ fontWeight: 600, color: T.text }}>{it.name}</div>
                <div style={{ fontSize: 10, color: T.muted }}>{it.code} · <span style={{ padding: "1px 6px", borderRadius: 8, background: it.type === "เสื้อผ้า" ? "rgba(124,58,237,0.1)" : "rgba(59,91,139,0.1)", color: it.type === "เสื้อผ้า" ? "#7c3aed" : T.accent }}>{it.type}</span></div>
              </div>
              <div style={{ fontFamily: "monospace", fontSize: 11, color: T.sub }}>{it.barcode}</div>
              <div style={{ fontSize: 11, color: T.muted }}>{it.price ? `฿${Number(it.price).toLocaleString()}` : "—"}</div>
              <div>
                {sel && (
                  <input type="number" min="1" max="100" value={copies[it.id] || 1}
                    onChange={e => setCopies(c => ({ ...c, [it.id]: Math.max(1, Math.min(100, Number(e.target.value)||1)) }))}
                    onFocus={e => e.target.select()}
                    style={{ width: 60, padding: "4px 6px", borderRadius: 5, border: `1px solid ${T.border}`, background: T.input, color: T.text, fontSize: 11, textAlign: "center", fontFamily: "monospace" }}
                    title="จำนวน sticker"/>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Summary + actions */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: T.sub }}>
          เลือก <b style={{ color: T.accent }}>{selectedIds.size}</b> รายการ · จะปริ้น <b style={{ color: T.green }}>{printList.length}</b> ดวง ·
          {layout.thermal
            ? <> ใช้ <b>{printList.length}</b> ดวง × {Number(thermalW)||60}×{Number(thermalH)||40} mm</>
            : <> ใช้ <b>{Math.ceil(printList.length / (layout.cols * layout.rows))}</b> หน้า A4</>}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <BtnGhost onClick={onClose}>ปิด</BtnGhost>
          <BtnGhost onClick={handleDownloadPdf} disabled={printList.length === 0} style={{ color: "#dc2626", borderColor: "rgba(220,38,38,0.35)" }}>
            📥 PDF{layout.thermal ? " (สำหรับแอป Aimo)" : ""} ({printList.length})
          </BtnGhost>
          <BtnPrimary onClick={handlePrint} disabled={printList.length === 0}>🖨️ พิมพ์ ({printList.length})</BtnPrimary>
        </div>
      </div>

      </>
      )}

      {/* 📮 Print area — สติกเกอร์ที่อยู่ (วาดนอกจอ ให้ printElementById ไปหยิบ) */}
      <div style={{ position: "fixed", left: -99999, top: 0, width: 794 }}>
        <div id="address-sticker-area" style={{ background: "white", padding: addrLayout.thermal ? 0 : "8mm", fontFamily: "'Sarabun',sans-serif", color: "#000" }}>
          <style>{`
            .ad-grid { display: grid; grid-template-columns: repeat(${addrLayout.cols}, 1fr); gap: 3mm; }
            .ad-cell { border: 1px dashed #cbd5e1; border-radius: 3px; padding: 3mm; box-sizing: border-box;
                       height: ${addrLayout.h}mm; overflow: hidden; display: flex; flex-direction: column; justify-content: center; }
            /* โหมดความร้อน: 1 ดวง = 1 หน้า ไม่ใช่ตาราง */
            .ad-thermal { width: ${addrLayout.w}mm; height: ${addrLayout.h}mm; padding: 4mm; box-sizing: border-box;
                          display: flex; flex-direction: column; justify-content: center; overflow: hidden;
                          page-break-after: always; background: #fff; }
            .ad-thermal:last-child { page-break-after: auto; }
            .ad-sender { font-size: 9px; color: #334155; border-bottom: 1px solid #cbd5e1; padding-bottom: 1mm; margin-bottom: 1.5mm; line-height: 1.3; }
            .ad-to { font-size: 9px; color: #64748b; letter-spacing: .04em; }
            .ad-name { font-size: 14px; font-weight: 800; line-height: 1.25; margin-bottom: 0.8mm; }
            .ad-addr { font-size: 11px; line-height: 1.4; }
            .ad-phone { font-size: 12px; font-weight: 700; font-family: monospace; margin-top: 1mm; }
            .ad-thermal .ad-name { font-size: 19px; }
            .ad-thermal .ad-addr { font-size: 15px; }
            .ad-thermal .ad-phone { font-size: 17px; }
            @media print { .ad-cell { border: none; } }
          `}</style>
          {addrLayout.thermal ? (
            addrList.map((c, i) => (
              <div key={i} className="ad-thermal">
                {showSender && companyInfo?.name && (
                  <div className="ad-sender">
                    ผู้ส่ง: {companyInfo.name}{companyInfo.phone ? ` โทร ${companyInfo.phone}` : ""}
                  </div>
                )}
                <div className="ad-to">ผู้รับ</div>
                <div className="ad-name">{c.name}</div>
                {showAddr && c.address && <div className="ad-addr">{c.address}</div>}
                {showPhone && c.phone && <div className="ad-phone">โทร. {c.phone}</div>}
              </div>
            ))
          ) : (
            <div className="ad-grid">
              {addrList.map((c, i) => (
                <div key={i} className="ad-cell">
                  {showSender && companyInfo?.name && (
                    <div className="ad-sender">
                      ผู้ส่ง: {companyInfo.name}{companyInfo.phone ? ` โทร ${companyInfo.phone}` : ""}
                    </div>
                  )}
                  <div className="ad-to">ผู้รับ</div>
                  <div className="ad-name">{c.name}</div>
                  {showAddr && c.address && <div className="ad-addr">{c.address}</div>}
                  {showPhone && c.phone && <div className="ad-phone">โทร. {c.phone}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Print area — hidden, used by printElementById */}
      <div style={{ position: "fixed", left: -99999, top: 0, width: 794 }}>
        <div id="barcode-sticker-area" style={{ background: "white", padding: layout.thermal ? 0 : "8mm", fontFamily: "'Sarabun',sans-serif", color: "#1e293b" }}>
          {layout.thermal ? (
            <>
              <style>{`
                .bc-thermal { width: ${layout.w}mm; height: ${layout.h}mm; padding: 2mm; box-sizing: border-box; display: flex; flex-direction: column; align-items: center; justify-content: center; overflow: hidden; page-break-after: always; background: #fff; }
                .bc-thermal:last-child { page-break-after: auto; }
                .bc-thermal .bc-name { font-size: 10px; font-weight: 700; margin-bottom: 1mm; line-height: 1.15; max-height: 7mm; overflow: hidden; text-align: center; padding: 0 1mm; color: #000; }
                .bc-thermal .bc-price { font-size: 12px; font-weight: 800; margin-top: 1mm; color: #000; font-family: monospace; }
                /* barcode ใหญ่เกือบเต็มสติกเกอร์ — scanner สแกนติดง่ายขึ้น */
                .bc-thermal > div:has(svg) { width: 100%; }
                .bc-thermal svg { width: 100% !important; height: auto !important; max-height: ${Math.max(14, layout.h * 0.6)}mm; display: block; margin: 0 auto; }
              `}</style>
              {printList.map((it, i) => (
                <div key={i} className="bc-thermal">
                  {showName && <div className="bc-name">{(it.name || "").slice(0, 30)}</div>}
                  <BarcodeDisplay value={it.barcode} width={2.5} height={70} fontSize={14} margin={14} />
                  {showPrice && it.price > 0 && <div className="bc-price">฿{Number(it.price).toLocaleString()}</div>}
                </div>
              ))}
            </>
          ) : (
            <>
              <style>{`
                .bc-grid { display: grid; grid-template-columns: repeat(${layout.cols}, 1fr); gap: 4mm; }
                .bc-cell { border: 1px dashed #cbd5e1; border-radius: 4px; padding: 4px; text-align: center; height: ${layout.h}mm; display: flex; flex-direction: column; align-items: center; justify-content: center; overflow: hidden; }
                .bc-cell .bc-name { font-size: 9px; font-weight: 600; margin-bottom: 2px; line-height: 1.2; max-height: 22px; overflow: hidden; }
                .bc-cell .bc-price { font-size: 11px; font-weight: 700; margin-top: 2px; color: #166534; font-family: monospace; }
                .bc-cell svg { max-width: 100%; max-height: ${layout.h * 0.4}mm; }
                @media print { .bc-cell { border: none; } }
              `}</style>
              <div className="bc-grid">
                {printList.map((it, i) => (
                  <div key={i} className="bc-cell">
                    {showName && <div className="bc-name">{(it.name || "").slice(0, 30)}</div>}
                    <BarcodeDisplay value={it.barcode} />
                    {showPrice && it.price > 0 && <div className="bc-price">฿{Number(it.price).toLocaleString()}</div>}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
