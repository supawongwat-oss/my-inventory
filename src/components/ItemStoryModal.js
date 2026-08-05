// 📖 รายละเอียดสินค้าแบบเล่าเรื่อง — ข้อความ + รูปเพิ่มเติม แสดงในหน้า Catalog
// เก็บที่ clothing/{id}:
//   description: "ผ้าไมโครโพลีเอสเตอร์ ระบายอากาศดี..."
//   gallery: [{ url, path, caption }]   ← รูปเพิ่ม (นอกจากรูปหน้าปก)
import { useState, useRef } from "react";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "../firebase";
import { Modal, MHead, BtnPrimary, BtnGhost } from "./ui";
import { T } from "../theme";
import { compressImage } from "../utils/imageCompress";
import { uploadImage, deleteFile } from "../utils/upload";
import { logAudit, AUDIT_ACTIONS } from "../utils/audit";

const MAX_IMAGES = 8;

export default function ItemStoryModal({ item, user, onClose }) {
  const [description, setDescription] = useState(item.description || "");
  const [gallery, setGallery] = useState(Array.isArray(item.gallery) ? item.gallery : []);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
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
    if (img?.path) deleteFile(img.path).catch(() => {}); // ลบไฟล์จริงด้วย ไม่ให้ค้างกินพื้นที่
    setGallery(g => g.filter((_, i) => i !== idx));
  };
  const setCaption = (idx, v) => setGallery(g => g.map((im, i) => i === idx ? { ...im, caption: v } : im));
  const move = (idx, dir) => setGallery(g => {
    const ni = idx + dir;
    if (ni < 0 || ni >= g.length) return g;
    const next = [...g];
    [next[idx], next[ni]] = [next[ni], next[idx]];
    return next;
  });

  const save = async () => {
    if (saving || uploading) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, "clothing", item.id), {
        description: description.trim() || null,
        gallery: gallery.length > 0 ? gallery : null,
      });
      logAudit(user, {
        action: AUDIT_ACTIONS.UPDATE, collection: "clothing", targetId: item.id,
        targetLabel: item.model || item.name || "",
        note: `รายละเอียดสินค้า · ${description.trim() ? "มีคำบรรยาย" : "ไม่มีคำบรรยาย"} · ${gallery.length} รูป`,
      });
      onClose && onClose();
    } catch (e) {
      alert("บันทึกไม่สำเร็จ: " + (e.message || e));
      setSaving(false);
    }
  };

  return (
    <Modal onClose={onClose} w={620}>
      <MHead title={`📖 รายละเอียดสินค้า — ${item.model || item.name || ""}`} sub="คำบรรยาย + รูปเพิ่มเติม ที่ลูกค้าจะเห็นในหน้าสั่งของ" onClose={onClose}/>

      <div style={{ marginBottom: 16 }}>
        <label style={{ fontSize: 12, fontWeight: 700, color: T.text, display: "block", marginBottom: 5 }}>
          ✍️ คำบรรยาย
        </label>
        <textarea value={description} onChange={e => setDescription(e.target.value)} rows={6}
          placeholder={"เล่าให้ลูกค้าฟัง เช่น\n• เนื้อผ้าไมโครโพลีเอสเตอร์ ระบายอากาศดี ใส่สบาย ไม่ร้อน\n• เหมาะกับชุดกีฬาโรงเรียน ซักง่าย แห้งไว\n• ทรงมาตรฐาน ไม่ต้องเผื่อไซส์"}
          style={{ width: "100%", boxSizing: "border-box", padding: "11px 13px", borderRadius: 9, border: `1px solid ${T.border}`, fontSize: 14, fontFamily: "inherit", lineHeight: 1.8, outline: "none", resize: "vertical" }}/>
        <div style={{ fontSize: 11, color: T.muted, marginTop: 4 }}>ขึ้นบรรทัดใหม่ได้ — จะแสดงตามที่พิมพ์</div>
      </div>

      <div>
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
          <div style={{ padding: 24, textAlign: "center", border: `1px dashed ${T.border}`, borderRadius: 10, color: T.muted, fontSize: 12, lineHeight: 1.8 }}>
            ยังไม่มีรูปเพิ่มเติม<br/>
            <span style={{ fontSize: 11 }}>เช่น รูปใส่จริง · รูปเนื้อผ้าใกล้ ๆ · รูปป้าย · ตารางไซส์</span>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {gallery.map((im, i) => (
              <div key={i} style={{ display: "flex", gap: 10, alignItems: "center", padding: 8, background: "#f8fafc", borderRadius: 9, border: `1px solid ${T.border}` }}>
                <img src={im.url} alt="" style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 7, flexShrink: 0 }}/>
                <input value={im.caption || ""} onChange={e => setCaption(i, e.target.value)} placeholder="คำอธิบายรูป (ไม่ใส่ก็ได้)"
                  style={{ flex: 1, minWidth: 0, padding: "7px 10px", borderRadius: 7, border: `1px solid ${T.border}`, fontSize: 12, fontFamily: "inherit", outline: "none" }}/>
                <div style={{ display: "flex", gap: 3, flexShrink: 0 }}>
                  <button onClick={() => move(i, -1)} disabled={i === 0} title="เลื่อนขึ้น"
                    style={{ padding: "5px 8px", borderRadius: 6, border: `1px solid ${T.border}`, background: "white", color: i === 0 ? T.muted : T.sub, cursor: i === 0 ? "default" : "pointer", fontSize: 11 }}>↑</button>
                  <button onClick={() => move(i, 1)} disabled={i === gallery.length - 1} title="เลื่อนลง"
                    style={{ padding: "5px 8px", borderRadius: 6, border: `1px solid ${T.border}`, background: "white", color: i === gallery.length - 1 ? T.muted : T.sub, cursor: i === gallery.length - 1 ? "default" : "pointer", fontSize: 11 }}>↓</button>
                  <button onClick={() => removeImage(i)} title="ลบรูป"
                    style={{ padding: "5px 8px", borderRadius: 6, border: "1px solid rgba(185,74,72,0.3)", background: "rgba(185,74,72,0.08)", color: T.red, cursor: "pointer", fontSize: 11 }}>✕</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
        <BtnGhost onClick={onClose} style={{ flex: 1 }}>ยกเลิก</BtnGhost>
        <BtnPrimary onClick={save} disabled={saving || uploading} style={{ flex: 1 }}>
          {saving ? "⏳ กำลังบันทึก..." : uploading ? "⏳ รออัปโหลดรูป..." : "💾 บันทึก"}
        </BtnPrimary>
      </div>
    </Modal>
  );
}
