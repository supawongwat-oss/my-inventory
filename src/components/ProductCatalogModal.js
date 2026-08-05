// 🛍️ หน้าร้าน (Catalog) ของสินค้ารุ่นหนึ่ง — รวม 3 เรื่องไว้ที่เดียว
//   🏷️ หมวดหมู่   — แบรนด์ › หมวดย่อย
//   📖 รายละเอียด — คำบรรยาย + รูปเล่าเรื่อง
//   📏 การขาย     — ไซส์ที่ให้สั่งได้ / ไซส์พิเศษ / ซ่อนสินค้า
// (เดิมแยกเป็น 3 ปุ่มบนการ์ดสินค้า — แถวปุ่มยาวเกินไป)
import { useState, useMemo, useRef } from "react";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "../firebase";
import { Modal, MHead, BtnPrimary, BtnGhost } from "./ui";
import { T, getSizesFor, compareSizes } from "../theme";
import { compressImage } from "../utils/imageCompress";
import { uploadImage, deleteFile } from "../utils/upload";
import { logAudit, AUDIT_ACTIONS } from "../utils/audit";

const MAX_IMAGES = 8;

export default function ProductCatalogModal({ item, allItems = [], user, onClose }) {
  const [tab, setTab] = useState("info"); // info | story | sales
  const [saving, setSaving] = useState(false);

  // ── 🏷️ หมวดหมู่ ──
  const [brand, setBrand] = useState(item.brand || "");
  const [category, setCategory] = useState(item.category || "");
  const brands = useMemo(
    () => [...new Set(allItems.map(i => i.brand).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"th")),
    [allItems]
  );
  const categories = useMemo(() => {
    const inBrand = allItems.filter(i => brand && i.brand === brand).map(i => i.category).filter(Boolean);
    const others = allItems.map(i => i.category).filter(Boolean);
    return [...new Set([...inBrand, ...others])].sort((a,b)=>a.localeCompare(b,"th"));
  }, [allItems, brand]);

  // ── 📖 รายละเอียด ──
  const [description, setDescription] = useState(item.description || "");
  const [gallery, setGallery] = useState(Array.isArray(item.gallery) ? item.gallery : []);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  const pickFiles = async (e) => {
    const files = [...(e.target.files || [])];
    if (files.length === 0) return;
    const room = MAX_IMAGES - gallery.length;
    if (room <= 0) { alert(`ใส่รูปได้สูงสุด ${MAX_IMAGES} รูป`); return; }
    setUploading(true);
    try {
      for (const f of files.slice(0, room)) {
        const dataUrl = await compressImage(f, { maxDim: 1400, quality: 0.8 });
        const { url, path } = await uploadImage(dataUrl, "clothing/story");
        setGallery(g => [...g, { url, path, caption: "" }]);
      }
    } catch (err) {
      alert("อัปโหลดรูปไม่สำเร็จ: " + (err?.message || err));
    } finally {
      setUploading(false);
      if (e.target) e.target.value = "";
    }
  };
  const removeImage = (idx) => {
    const img = gallery[idx];
    if (img?.path) deleteFile(img.path).catch(() => {}); // ลบไฟล์จริง ไม่ให้ค้างกินพื้นที่
    setGallery(g => g.filter((_, i) => i !== idx));
  };
  const setCaption = (idx, v) => setGallery(g => g.map((im, i) => i === idx ? { ...im, caption: v } : im));
  const moveImage = (idx, dir) => setGallery(g => {
    const ni = idx + dir;
    if (ni < 0 || ni >= g.length) return g;
    const next = [...g]; [next[idx], next[ni]] = [next[ni], next[idx]]; return next;
  });

  // ── 📏 การขาย ──
  const stockSizes = [...new Set((item.colors || []).flatMap(c => Object.keys(c.stock || {})))];
  const available = [...new Set([...stockSizes, ...getSizesFor(item)])].sort(compareSizes);
  const [picked, setPicked] = useState(() => Array.isArray(item.catalogSizes) ? item.catalogSizes : available);
  const [hidden, setHidden] = useState(!!item.hideFromCatalog);
  const [allowCustom, setAllowCustom] = useState(!!item.allowCustomSize);
  const allOn = picked.length === available.length;
  const toggleSize = (sz) => setPicked(prev => prev.includes(sz) ? prev.filter(s => s !== sz) : [...prev, sz]);

  // ── บันทึกทั้งหมดในครั้งเดียว ──
  const save = async () => {
    if (saving || uploading) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, "clothing", item.id), {
        brand: brand.trim() || null,
        category: category.trim() || null,
        description: description.trim() || null,
        gallery: gallery.length > 0 ? gallery : null,
        catalogSizes: allOn ? null : [...picked].sort(compareSizes),
        hideFromCatalog: hidden,
        allowCustomSize: allowCustom,
      });
      logAudit(user, {
        action: AUDIT_ACTIONS.UPDATE, collection: "clothing", targetId: item.id,
        targetLabel: item.model || item.name || "",
        note: `หน้าร้าน: ${brand.trim() || "—"} › ${category.trim() || "—"} · ${hidden ? "ซ่อน" : "แสดง"} · ไซส์ ${allOn ? "ทั้งหมด" : picked.length} · ${gallery.length} รูป`,
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
            color: current === v ? T.accent : T.sub, fontWeight: current === v ? 700 : 500 }}>{v}</button>
      ))}
    </div>
  );

  const TABS = [
    { id: "info",  label: "🏷️ หมวดหมู่" },
    { id: "story", label: `📖 รายละเอียด${(item.description || (item.gallery||[]).length) ? " ✓" : ""}` },
    { id: "sales", label: "📏 การขาย" },
  ];

  return (
    <Modal onClose={onClose} w={620}>
      <MHead title={`🛍️ หน้าร้าน — ${item.model || item.name || ""}`} sub="ตั้งค่าสิ่งที่ลูกค้าเห็นในหน้าสั่งของ" onClose={onClose}/>

      <div style={{ display: "flex", gap: 5, marginBottom: 16, padding: 4, background: "#f1f5f9", borderRadius: 10 }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ flex: 1, padding: "8px 10px", borderRadius: 7, border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 12,
              background: tab === t.id ? "white" : "transparent",
              color: tab === t.id ? T.accent : T.sub, fontWeight: tab === t.id ? 700 : 500,
              boxShadow: tab === t.id ? "0 1px 3px rgba(0,0,0,.1)" : "none" }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── 🏷️ หมวดหมู่ ── */}
      {tab === "info" && (
        <div>
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
            ลูกค้าจะเห็น: <b style={{ color: T.accent }}>{brand.trim() || "(ไม่ระบุแบรนด์)"}</b>
            {category.trim() && <> › <b style={{ color: T.accent }}>{category.trim()}</b></>}
            <div style={{ fontSize: 11, color: T.muted, marginTop: 4 }}>💡 กดปุ่มชื่อที่เคยใช้ได้ — กันสะกดต่างจนกลายเป็นคนละหมวด</div>
          </div>
        </div>
      )}

      {/* ── 📖 รายละเอียด ── */}
      {tab === "story" && (
        <div>
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: T.text, display: "block", marginBottom: 5 }}>✍️ คำบรรยาย</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={5}
              placeholder={"เล่าให้ลูกค้าฟัง เช่น\n• เนื้อผ้าไมโครโพลีเอสเตอร์ ระบายอากาศดี ใส่สบาย\n• เหมาะกับชุดกีฬาโรงเรียน ซักง่าย แห้งไว"}
              style={{ width: "100%", boxSizing: "border-box", padding: "11px 13px", borderRadius: 9, border: `1px solid ${T.border}`, fontSize: 14, fontFamily: "inherit", lineHeight: 1.8, outline: "none", resize: "vertical" }}/>
            <div style={{ fontSize: 11, color: T.muted, marginTop: 4 }}>ขึ้นบรรทัดใหม่ได้ — จะแสดงตามที่พิมพ์</div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: T.text }}>🖼️ รูปเพิ่มเติม</span>
            <span style={{ fontSize: 11, color: T.muted }}>{gallery.length}/{MAX_IMAGES}</span>
            <button onClick={() => fileRef.current?.click()} disabled={uploading || gallery.length >= MAX_IMAGES}
              style={{ marginLeft: "auto", padding: "5px 14px", borderRadius: 8, border: `1px solid ${T.accent}`, background: "rgba(59,91,139,0.08)", color: T.accent, cursor: uploading || gallery.length >= MAX_IMAGES ? "not-allowed" : "pointer", fontSize: 12, fontWeight: 600, fontFamily: "inherit", opacity: gallery.length >= MAX_IMAGES ? 0.5 : 1 }}>
              {uploading ? "⏳ กำลังอัปโหลด..." : "＋ เพิ่มรูป"}
            </button>
            <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={pickFiles}/>
          </div>

          {gallery.length === 0 ? (
            <div style={{ padding: 22, textAlign: "center", border: `1px dashed ${T.border}`, borderRadius: 10, color: T.muted, fontSize: 12, lineHeight: 1.8 }}>
              ยังไม่มีรูปเพิ่มเติม<br/>
              <span style={{ fontSize: 11 }}>เช่น รูปใส่จริง · รูปเนื้อผ้าใกล้ ๆ · รูปป้าย · ตารางไซส์</span>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {gallery.map((im, i) => (
                <div key={i} style={{ display: "flex", gap: 10, alignItems: "center", padding: 8, background: "#f8fafc", borderRadius: 9, border: `1px solid ${T.border}` }}>
                  <img src={im.url} alt="" style={{ width: 52, height: 52, objectFit: "cover", borderRadius: 7, flexShrink: 0 }}/>
                  <input value={im.caption || ""} onChange={e => setCaption(i, e.target.value)} placeholder="คำอธิบายรูป (ไม่ใส่ก็ได้)"
                    style={{ flex: 1, minWidth: 0, padding: "7px 10px", borderRadius: 7, border: `1px solid ${T.border}`, fontSize: 12, fontFamily: "inherit", outline: "none" }}/>
                  <div style={{ display: "flex", gap: 3, flexShrink: 0 }}>
                    <button onClick={() => moveImage(i, -1)} disabled={i === 0}
                      style={{ padding: "5px 8px", borderRadius: 6, border: `1px solid ${T.border}`, background: "white", color: i === 0 ? T.muted : T.sub, cursor: i === 0 ? "default" : "pointer", fontSize: 11 }}>↑</button>
                    <button onClick={() => moveImage(i, 1)} disabled={i === gallery.length - 1}
                      style={{ padding: "5px 8px", borderRadius: 6, border: `1px solid ${T.border}`, background: "white", color: i === gallery.length - 1 ? T.muted : T.sub, cursor: i === gallery.length - 1 ? "default" : "pointer", fontSize: 11 }}>↓</button>
                    <button onClick={() => removeImage(i)}
                      style={{ padding: "5px 8px", borderRadius: 6, border: "1px solid rgba(185,74,72,0.3)", background: "rgba(185,74,72,0.08)", color: T.red, cursor: "pointer", fontSize: 11 }}>✕</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── 📏 การขาย ── */}
      {tab === "sales" && (
        <div>
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
                  <button key={sz} onClick={() => toggleSize(sz)} title={inStock ? "มีในคลัง" : "ยังไม่มีในคลัง"}
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
                ⚠️ ไม่ได้เลือกไซส์เลย — ลูกค้าจะสั่งสินค้านี้ไม่ได้ (ถ้าตั้งใจ แนะนำใช้ "ซ่อนสินค้า" แทน)
              </div>
            )}
            {allOn && (
              <div style={{ marginTop: 10, fontSize: 11, color: T.muted }}>
                💡 เลือกครบ = ไม่จำกัด — เพิ่มไซส์ใหม่ในคลังทีหลังจะแสดงอัตโนมัติ
              </div>
            )}

            <label style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14, padding: "10px 14px", background: allowCustom ? "rgba(124,58,237,0.07)" : "#f8fafc", border: `1px solid ${allowCustom ? "rgba(124,58,237,0.3)" : T.border}`, borderRadius: 10, cursor: "pointer" }}>
              <input type="checkbox" checked={allowCustom} onChange={e => setAllowCustom(e.target.checked)} style={{ width: 16, height: 16, cursor: "pointer" }}/>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: allowCustom ? "#7c3aed" : T.text }}>✏️ ให้ลูกค้าพิมพ์ไซส์พิเศษเองได้</div>
                <div style={{ fontSize: 11, color: T.muted, marginTop: 2, lineHeight: 1.6 }}>
                  เหมาะกับรุ่นที่รับตัดตามสั่ง<br/>
                  ⚠️ ไซส์พิเศษไม่มีราคาในระบบ ต้องแจ้งยอดเองตอนยืนยัน
                </div>
              </div>
            </label>
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
        <BtnGhost onClick={onClose} style={{ flex: 1 }}>ยกเลิก</BtnGhost>
        <BtnPrimary onClick={save} disabled={saving || uploading} style={{ flex: 2 }}>
          {saving ? "⏳ กำลังบันทึก..." : uploading ? "⏳ รออัปโหลดรูป..." : "💾 บันทึกทั้งหมด"}
        </BtnPrimary>
      </div>
    </Modal>
  );
}
