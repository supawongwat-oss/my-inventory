import React from "react";
import { T } from "../theme";
import { BarcodeDisplay, Badge, CardBox, BtnPrimary } from "../components/ui";

const statusColor = (p) => Number(p.qty) < Number(p.minQty) ? T.red : Number(p.qty) < Number(p.minQty) * 1.5 ? T.amber : T.green;
const statusLabel = (p) => Number(p.qty) < Number(p.minQty) ? "ต่ำกว่าขั้นต่ำ" : Number(p.qty) < Number(p.minQty) * 1.5 ? "ใกล้หมด" : "ปกติ";

export default function BarcodeTab({
  products, role,
  barcodeInputRef, barcodeSearch, setBarcodeSearch, handleBarcodeSearch,
  barcodeErr, setBarcodeErr, barcodeResult,
  setShowScanner, setShowBarcodePrint,
  setNewProduct, setShowAddModal,
}) {
  return (
    <div style={{ maxWidth: 580 }}>
      <CardBox style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: T.text, marginBottom: 16 }}>▦ สแกน / ค้นหาบาร์โค้ด</div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <input ref={barcodeInputRef} value={barcodeSearch} onChange={e => setBarcodeSearch(e.target.value)} onKeyDown={e => e.key === "Enter" && handleBarcodeSearch()} placeholder="สแกนหรือพิมพ์บาร์โค้ด / รหัสสินค้า..." autoFocus
            style={{ flex: 1, minWidth: 200, background: T.input, border: `1px solid ${T.inputBorder}`, color: T.text, borderRadius: 8, padding: "9px 12px", fontFamily: "'Sarabun',sans-serif", fontSize: 13, outline: "none" }} />
          <button onClick={() => setShowScanner(true)} style={{ padding: "9px 14px", borderRadius: 8, border: "1px solid rgba(124,58,237,0.3)", background: "rgba(124,58,237,0.1)", color: "#7c3aed", cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: "'Sarabun',sans-serif" }}>📸 สแกนกล้อง</button>
          <button onClick={() => setShowBarcodePrint(true)} style={{ padding: "9px 14px", borderRadius: 8, border: "1px solid rgba(58,122,82,0.3)", background: "rgba(58,122,82,0.1)", color: T.green, cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: "'Sarabun',sans-serif" }}>🏷️ ปริ้น sticker</button>
          <BtnPrimary onClick={handleBarcodeSearch}>ค้นหา</BtnPrimary>
        </div>
        <div style={{ fontSize: 11, color: T.muted, marginTop: 8 }}>💡 กด Enter หลังสแกนบาร์โค้ดจากเครื่องสแกน · หรือกด <b>📸 สแกนกล้อง</b> เพื่อใช้กล้องมือถือ/Webcam</div>
        {barcodeErr && (
          <div style={{ marginTop: 14, padding: "12px 14px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, fontSize: 13 }}>
            <div style={{ color: T.red, marginBottom: role.canAdd ? 10 : 0 }}>❌ {barcodeErr}</div>
            {role.canAdd && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button onClick={() => {
                  setNewProduct({ code: "", name: "", category: "", qty: "", unit: "", minQty: "", location: "", barcode: barcodeSearch.trim(), image: "", costPrice: "", salePrice: "" });
                  setShowAddModal(true);
                }} style={{ padding: "6px 14px", borderRadius: 7, border: "1px solid rgba(58,122,82,0.3)", background: "rgba(58,122,82,0.1)", color: T.green, cursor: "pointer", fontSize: 12, fontFamily: "'Sarabun',sans-serif", fontWeight: 600 }}>
                  ➕ เพิ่มสินค้าใหม่ด้วยบาร์โค้ดนี้
                </button>
                <button onClick={() => { setBarcodeSearch(""); setBarcodeErr(""); }} style={{ padding: "6px 12px", borderRadius: 7, border: `1px solid ${T.border}`, background: "transparent", color: T.sub, cursor: "pointer", fontSize: 12, fontFamily: "'Sarabun',sans-serif" }}>
                  ล้างค่า
                </button>
              </div>
            )}
          </div>
        )}
        {barcodeResult && (
          <div style={{ marginTop: 14, padding: 16, background: "#eff6ff", border: `1px solid ${T.navActiveBorder}`, borderRadius: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
              <div><div style={{ fontWeight: 700, color: T.text, fontSize: 15 }}>{barcodeResult.name}</div><div style={{ fontSize: 12, color: T.sub }}>{barcodeResult.code} · {barcodeResult.category}</div></div>
              <Badge bg={`${statusColor(barcodeResult)}15`} color={statusColor(barcodeResult)}>{statusLabel(barcodeResult)}</Badge>
            </div>
            <div style={{ display: "flex", gap: 24, marginBottom: 14 }}>
              <div><div style={{ fontSize: 10, color: T.muted }}>คงเหลือ</div><div style={{ fontSize: 24, fontWeight: 700, color: statusColor(barcodeResult), fontFamily: "monospace" }}>{barcodeResult.qty} {barcodeResult.unit}</div></div>
              <div><div style={{ fontSize: 10, color: T.muted }}>ขั้นต่ำ</div><div style={{ fontSize: 24, fontWeight: 700, color: T.muted, fontFamily: "monospace" }}>{barcodeResult.minQty} {barcodeResult.unit}</div></div>
            </div>
            <BarcodeDisplay value={barcodeResult.barcode} />
          </div>
        )}
      </CardBox>
      <CardBox>
        <div style={{ fontSize: 13, fontWeight: 600, color: T.text, marginBottom: 14 }}>บาร์โค้ดสินค้าทั้งหมด ({products.length})</div>
        {products.length === 0 ? <div style={{ color: T.muted, fontSize: 13 }}>ยังไม่มีสินค้า</div> : products.map(p => (
          <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "10px 0", borderBottom: `1px solid ${T.border}` }}>
            <div style={{ flex: 1 }}><div style={{ fontSize: 13, fontWeight: 500, color: T.text }}>{p.name}</div><div style={{ fontSize: 10, color: T.muted }}>{p.code}</div></div>
            <BarcodeDisplay value={p.barcode} />
          </div>
        ))}
      </CardBox>
    </div>
  );
}
