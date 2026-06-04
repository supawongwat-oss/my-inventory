// 🏷️ Print Barcode Stickers — ปริ้น barcode หลายๆ ใบใน 1 หน้า A4
import { useState, useMemo } from "react";
import { T } from "../theme";
import { Modal, MHead, BtnPrimary, BtnGhost } from "./ui";
import { BarcodeDisplay } from "./ui";

// layout presets (col x row per A4)
const LAYOUTS = [
  { key: "3x10", cols: 3, rows: 10, label: "3×10 (30 ดวง / A4)", w: 65, h: 28 },
  { key: "4x10", cols: 4, rows: 10, label: "4×10 (40 ดวง / A4)", w: 48, h: 28 },
  { key: "2x8",  cols: 2, rows: 8,  label: "2×8 (16 ดวง / A4 — ใหญ่)", w: 95, h: 35 },
  { key: "5x13", cols: 5, rows: 13, label: "5×13 (65 ดวง / A4 — เล็ก)", w: 38, h: 20 },
];

export default function BarcodePrintModal({ products = [], clothingItems = [], onClose, printElementById }) {
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [search, setSearch] = useState("");
  const [layoutKey, setLayoutKey] = useState("3x10");
  const [showName, setShowName] = useState(true);
  const [showPrice, setShowPrice] = useState(true);
  const [copies, setCopies] = useState({}); // {productId: count}

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

  const layout = LAYOUTS.find(l => l.key === layoutKey) || LAYOUTS[0];

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
    if (printList.length === 0) { alert("เลือกสินค้าอย่างน้อย 1 รายการ"); return; }
    setTimeout(() => printElementById?.("barcode-sticker-area", "A4 portrait", "8mm"), 100);
  };

  return (
    <Modal onClose={onClose} w={1000}>
      <MHead title="🏷️ ปริ้นบาร์โค้ดติดสินค้า" sub={`เลือกสินค้า + จำนวน → ปริ้นออกมาตัดติด`} onClose={onClose} color={T.accent}/>

      {/* Settings */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14, padding: 12, background: T.card, border: `1px solid ${T.border}`, borderRadius: 10 }}>
        <div>
          <label style={{ fontSize: 11, color: T.muted, fontWeight: 600, display: "block", marginBottom: 4 }}>📐 รูปแบบ Layout</label>
          <select value={layoutKey} onChange={e => setLayoutKey(e.target.value)}
            style={{ width: "100%", background: T.input, border: `1px solid ${T.inputBorder}`, color: T.text, borderRadius: 7, padding: "7px 10px", fontSize: 12, outline: "none", cursor: "pointer" }}>
            {LAYOUTS.map(l => <option key={l.key} value={l.key}>{l.label}</option>)}
          </select>
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
          เลือก <b style={{ color: T.accent }}>{selectedIds.size}</b> รายการ · จะปริ้น <b style={{ color: T.green }}>{printList.length}</b> ดวง · ใช้ <b>{Math.ceil(printList.length / (layout.cols * layout.rows))}</b> หน้า A4
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <BtnGhost onClick={onClose}>ปิด</BtnGhost>
          <BtnPrimary onClick={handlePrint} disabled={printList.length === 0}>🖨️ พิมพ์ ({printList.length})</BtnPrimary>
        </div>
      </div>

      {/* Print area — hidden, used by printElementById */}
      <div style={{ position: "fixed", left: -99999, top: 0, width: 794 }}>
        <div id="barcode-sticker-area" style={{ background: "white", padding: "8mm", fontFamily: "'Sarabun',sans-serif", color: "#1e293b" }}>
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
        </div>
      </div>
    </Modal>
  );
}
