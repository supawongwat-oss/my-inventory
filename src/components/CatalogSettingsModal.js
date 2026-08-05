// 🛍️ ตั้งค่าการแสดงใน Catalog ต่อสินค้า — เลือกไซส์ที่รับผลิต/ขาย + ซ่อนสินค้า
//
// เก็บที่ clothing/{id}:
//   catalogSizes: ["S","M","L"]  → ไซส์ที่ให้ลูกค้าสั่งได้ (ไม่ตั้ง = ทุกไซส์ตามคลัง)
//   hideFromCatalog: true        → ไม่แสดงสินค้านี้ในหน้า catalog เลย
import { useState } from "react";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "../firebase";
import { Modal, MHead, BtnPrimary, BtnGhost } from "./ui";
import { T, getSizesFor, compareSizes } from "../theme";
import { logAudit, AUDIT_ACTIONS } from "../utils/audit";

export default function CatalogSettingsModal({ item, user, onClose }) {
  // ไซส์ที่เลือกได้ = ไซส์ที่มีในคลัง ∪ ไซส์มาตรฐานของชนิดสินค้านั้น
  const stockSizes = [...new Set((item.colors || []).flatMap(c => Object.keys(c.stock || {})))];
  const available = [...new Set([...stockSizes, ...getSizesFor(item)])].sort(compareSizes);

  // ยังไม่เคยตั้ง → ถือว่าเปิดทุกไซส์ (พฤติกรรมเดิม ไม่ทำให้ของที่ขายอยู่หาย)
  const [picked, setPicked] = useState(() =>
    Array.isArray(item.catalogSizes) ? item.catalogSizes : available
  );
  const [hidden, setHidden] = useState(!!item.hideFromCatalog);
  const [allowCustom, setAllowCustom] = useState(!!item.allowCustomSize);
  const [saving, setSaving] = useState(false);

  const toggle = (sz) => setPicked(prev => prev.includes(sz) ? prev.filter(s => s !== sz) : [...prev, sz]);
  const allOn = picked.length === available.length;

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      // เลือกครบทุกไซส์ = เหมือนไม่ได้จำกัด → เก็บ null ให้ยืดหยุ่น (เพิ่มไซส์ใหม่ทีหลังจะโชว์เอง)
      const catalogSizes = allOn ? null : [...picked].sort(compareSizes);
      await updateDoc(doc(db, "clothing", item.id), { catalogSizes, hideFromCatalog: hidden, allowCustomSize: allowCustom });
      logAudit(user, {
        action: AUDIT_ACTIONS.UPDATE, collection: "clothing", targetId: item.id,
        targetLabel: item.model || item.name || "",
        note: `Catalog: ${hidden ? "ซ่อน" : "แสดง"} · ไซส์ ${catalogSizes ? catalogSizes.join(",") : "ทั้งหมด"}${allowCustom ? " · รับไซส์พิเศษ" : ""}`,
      });
      onClose && onClose();
    } catch (e) {
      alert("บันทึกไม่สำเร็จ: " + (e.message || e));
      setSaving(false);
    }
  };

  return (
    <Modal onClose={onClose} w={520}>
      <MHead title={`🛍️ ตั้งค่า Catalog — ${item.model || item.name || ""}`} sub="เลือกว่าให้ลูกค้าสั่งไซส์ไหนได้บ้าง" onClose={onClose}/>

      <label style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", marginBottom: 14, background: hidden ? "rgba(185,74,72,0.08)" : "#f8fafc", border: `1px solid ${hidden ? "rgba(185,74,72,0.3)" : T.border}`, borderRadius: 10, cursor: "pointer" }}>
        <input type="checkbox" checked={hidden} onChange={e => setHidden(e.target.checked)} style={{ width: 16, height: 16, cursor: "pointer" }}/>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: hidden ? T.red : T.text }}>🚫 ซ่อนสินค้านี้จาก Catalog</div>
          <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>ลูกค้าจะไม่เห็นสินค้านี้เลย (ยังอยู่ในคลังตามปกติ)</div>
        </div>
      </label>

      <div style={{ opacity: hidden ? 0.45 : 1, pointerEvents: hidden ? "none" : "auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>📏 ไซส์ที่ให้สั่งได้</span>
          <span style={{ fontSize: 11, color: T.muted }}>เลือก {picked.length}/{available.length}</span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
            <button onClick={() => setPicked(available)}
              style={{ padding: "4px 12px", borderRadius: 7, border: `1px solid ${T.border}`, background: "white", color: T.sub, cursor: "pointer", fontSize: 11, fontFamily: "inherit" }}>เลือกทั้งหมด</button>
            <button onClick={() => setPicked([])}
              style={{ padding: "4px 12px", borderRadius: 7, border: `1px solid ${T.border}`, background: "white", color: T.sub, cursor: "pointer", fontSize: 11, fontFamily: "inherit" }}>ล้าง</button>
          </div>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
          {available.map(sz => {
            const on = picked.includes(sz);
            const inStock = stockSizes.includes(sz);
            return (
              <button key={sz} onClick={() => toggle(sz)} title={inStock ? "มีในคลัง" : "ยังไม่มีในคลัง"}
                style={{ padding: "8px 16px", borderRadius: 9, cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: on ? 700 : 500,
                  border: `1px solid ${on ? T.accent : T.border}`,
                  background: on ? "rgba(59,91,139,0.1)" : "white",
                  color: on ? T.accent : T.muted }}>
                {on ? "✓ " : ""}{sz}
                {!inStock && <span style={{ fontSize: 9, marginLeft: 3, opacity: 0.7 }}>·ใหม่</span>}
              </button>
            );
          })}
        </div>

        {picked.length === 0 && (
          <div style={{ marginTop: 10, padding: "8px 12px", background: "rgba(217,119,6,0.08)", border: "1px solid rgba(217,119,6,0.3)", borderRadius: 8, fontSize: 12, color: "#b45309" }}>
            ⚠️ ไม่ได้เลือกไซส์เลย — ลูกค้าจะสั่งสินค้านี้ไม่ได้ (ถ้าตั้งใจไม่ให้สั่ง แนะนำใช้ "ซ่อนสินค้า" แทน)
          </div>
        )}
        {allOn && (
          <div style={{ marginTop: 10, fontSize: 11, color: T.muted }}>
            💡 เลือกครบทุกไซส์ = ไม่จำกัด — ถ้าเพิ่มไซส์ใหม่ในคลังทีหลัง จะแสดงใน Catalog อัตโนมัติ
          </div>
        )}

        {/* ✏️ ไซส์พิเศษ — ให้ลูกค้าพิมพ์เอง (สำหรับรุ่นที่รับตัดตามสั่ง) */}
        <label style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14, padding: "10px 14px", background: allowCustom ? "rgba(124,58,237,0.07)" : "#f8fafc", border: `1px solid ${allowCustom ? "rgba(124,58,237,0.3)" : T.border}`, borderRadius: 10, cursor: "pointer" }}>
          <input type="checkbox" checked={allowCustom} onChange={e => setAllowCustom(e.target.checked)} style={{ width: 16, height: 16, cursor: "pointer" }}/>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: allowCustom ? "#7c3aed" : T.text }}>✏️ ให้ลูกค้าพิมพ์ไซส์พิเศษเองได้</div>
            <div style={{ fontSize: 11, color: T.muted, marginTop: 2, lineHeight: 1.6 }}>
              ลูกค้าจะมีปุ่ม “+ ไซส์พิเศษ” ในตารางสั่งซื้อ — เหมาะกับรุ่นที่รับตัดตามสั่ง<br/>
              ⚠️ ไซส์พิเศษไม่มีราคาในระบบ ต้องแจ้งยอดเองตอนยืนยันออเดอร์
            </div>
          </div>
        </label>
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
        <BtnGhost onClick={onClose} style={{ flex: 1 }}>ยกเลิก</BtnGhost>
        <BtnPrimary onClick={save} disabled={saving} style={{ flex: 1 }}>{saving ? "⏳ กำลังบันทึก..." : "💾 บันทึก"}</BtnPrimary>
      </div>
    </Modal>
  );
}
