// 🏷️ ตั้งแบรนด์ + หมวดย่อยของรุ่นสินค้า
// เก็บที่ clothing/{id}: { brand: "X TREME", category: "เสื้อโปโล" }
// - brand    = แบรนด์ (ชั้นบน) — ใช้ทำแท็บทั้งในคลังและหน้า Catalog
// - category = หมวดย่อยในแบรนด์นั้น (field เดิม ที่ Catalog ใช้อยู่แล้ว)
import { useState, useMemo } from "react";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "../firebase";
import { Modal, MHead, BtnPrimary, BtnGhost } from "./ui";
import { T } from "../theme";
import { logAudit, AUDIT_ACTIONS } from "../utils/audit";

export default function ItemCategoryModal({ item, allItems = [], user, onClose }) {
  const [brand, setBrand] = useState(item.brand || "");
  const [category, setCategory] = useState(item.category || "");
  const [saving, setSaving] = useState(false);

  // ชื่อที่เคยใช้แล้ว — กดเลือกได้ ไม่ต้องพิมพ์ซ้ำ (กันสะกดต่างกันจนกลายเป็นคนละหมวด)
  const brands = useMemo(
    () => [...new Set(allItems.map(i => i.brand).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"th")),
    [allItems]
  );
  // หมวดย่อยที่เคยใช้ในแบรนด์นี้ก่อน แล้วตามด้วยหมวดจากแบรนด์อื่น
  const categories = useMemo(() => {
    const inBrand = allItems.filter(i => brand && i.brand === brand).map(i => i.category).filter(Boolean);
    const others = allItems.map(i => i.category).filter(Boolean);
    return [...new Set([...inBrand, ...others])].sort((a,b)=>a.localeCompare(b,"th"));
  }, [allItems, brand]);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, "clothing", item.id), {
        brand: brand.trim() || null,
        category: category.trim() || null,
      });
      logAudit(user, {
        action: AUDIT_ACTIONS.UPDATE, collection: "clothing", targetId: item.id,
        targetLabel: item.model || item.name || "",
        note: `หมวดหมู่: ${brand.trim() || "—"} › ${category.trim() || "—"}`,
      });
      onClose && onClose();
    } catch (e) {
      alert("บันทึกไม่สำเร็จ: " + (e.message || e));
      setSaving(false);
    }
  };

  const Suggest = ({ list, onPick, current }) => list.length === 0 ? null : (
    <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 6 }}>
      {list.map(v => (
        <button key={v} onClick={() => onPick(v)}
          style={{ padding: "3px 10px", borderRadius: 12, cursor: "pointer", fontFamily: "inherit", fontSize: 11,
            border: `1px solid ${current === v ? T.accent : T.border}`,
            background: current === v ? "rgba(59,91,139,0.1)" : "white",
            color: current === v ? T.accent : T.sub, fontWeight: current === v ? 700 : 500 }}>
          {v}
        </button>
      ))}
    </div>
  );

  return (
    <Modal onClose={onClose} w={480}>
      <MHead title={`🏷️ หมวดหมู่ — ${item.model || item.name || ""}`} sub="แบรนด์ › หมวดย่อย" onClose={onClose}/>

      <div style={{ marginBottom: 16 }}>
        <label style={{ fontSize: 12, fontWeight: 700, color: T.text, display: "block", marginBottom: 5 }}>🏢 แบรนด์</label>
        <input value={brand} onChange={e => setBrand(e.target.value)} placeholder="เช่น X TREME"
          style={{ width: "100%", boxSizing: "border-box", padding: "9px 12px", borderRadius: 8, border: `1px solid ${T.border}`, fontSize: 14, fontFamily: "inherit", outline: "none" }}/>
        <Suggest list={brands} current={brand} onPick={setBrand}/>
      </div>

      <div>
        <label style={{ fontSize: 12, fontWeight: 700, color: T.text, display: "block", marginBottom: 5 }}>
          📂 หมวดย่อย <span style={{ fontWeight: 400, color: T.muted }}>(ไม่ใส่ก็ได้)</span>
        </label>
        <input value={category} onChange={e => setCategory(e.target.value)} placeholder="เช่น เสื้อโปโล, เสื้อคอกลม"
          style={{ width: "100%", boxSizing: "border-box", padding: "9px 12px", borderRadius: 8, border: `1px solid ${T.border}`, fontSize: 14, fontFamily: "inherit", outline: "none" }}/>
        <Suggest list={categories} current={category} onPick={setCategory}/>
      </div>

      <div style={{ marginTop: 16, padding: "9px 13px", background: "rgba(59,91,139,0.06)", border: `1px solid ${T.border}`, borderRadius: 9, fontSize: 12, color: T.sub }}>
        ตัวอย่างที่จะแสดง: <b style={{ color: T.accent }}>{brand.trim() || "(ไม่ระบุแบรนด์)"}</b>
        {category.trim() && <> › <b style={{ color: T.accent }}>{category.trim()}</b></>}
        <div style={{ fontSize: 11, color: T.muted, marginTop: 4 }}>💡 กดปุ่มชื่อที่เคยใช้ด้านบนได้ — กันสะกดต่างกันจนกลายเป็นคนละหมวด</div>
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
        <BtnGhost onClick={onClose} style={{ flex: 1 }}>ยกเลิก</BtnGhost>
        <BtnPrimary onClick={save} disabled={saving} style={{ flex: 1 }}>{saving ? "⏳ กำลังบันทึก..." : "💾 บันทึก"}</BtnPrimary>
      </div>
    </Modal>
  );
}
