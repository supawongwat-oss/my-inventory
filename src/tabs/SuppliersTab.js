import { useState } from "react";
import { db } from "../firebase";
import { collection, addDoc, updateDoc, deleteDoc, doc, serverTimestamp } from "firebase/firestore";
import { T } from "../theme";
import { Modal, MHead, Input, BtnPrimary, BtnGhost, BtnDanger, CardBox } from "../components/ui";

const emptyForm = { name: "", phone: "", email: "", address: "", note: "" };

export default function SuppliersTab({ suppliers, role }) {
  const [showAdd, setShowAdd] = useState(false);
  const [editSupplier, setEditSupplier] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [search, setSearch] = useState("");

  const openAdd = () => { setForm(emptyForm); setEditSupplier(null); setShowAdd(true); };
  const openEdit = (s) => { setForm({ name: s.name, phone: s.phone || "", email: s.email || "", address: s.address || "", note: s.note || "" }); setEditSupplier(s); setShowAdd(true); };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    if (editSupplier) {
      await updateDoc(doc(db, "suppliers", editSupplier.id), { ...form });
    } else {
      await addDoc(collection(db, "suppliers"), { ...form, createdAt: serverTimestamp() });
    }
    setShowAdd(false);
  };

  const filtered = suppliers.filter(s =>
    !search || (s.name || "").includes(search) || (s.phone || "").includes(search) || (s.email || "").includes(search)
  );

  return (
    <div style={{ animation: "fadeUp 0.4s ease", maxWidth: 800 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 ค้นหาชื่อ เบอร์ อีเมล..."
          style={{ width: 260, background: T.input, border: `1px solid ${T.inputBorder}`, color: T.text, borderRadius: 8, padding: "8px 12px", fontFamily: "'Sarabun',sans-serif", fontSize: 13, outline: "none" }} />
        {role.canAdd && <BtnPrimary onClick={openAdd}>＋ เพิ่มซัพพลายเออร์</BtnPrimary>}
      </div>

      {suppliers.length === 0 ? (
        <div style={{ textAlign: "center", padding: 60, background: T.card, borderRadius: 16, border: `1px solid ${T.border}` }}>
          <div style={{ fontSize: 48, marginBottom: 12, opacity: 0.3 }}>🏭</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: T.accent, marginBottom: 6 }}>ยังไม่มีซัพพลายเออร์</div>
          <div style={{ fontSize: 11, color: T.muted }}>กด "＋ เพิ่มซัพพลายเออร์" เพื่อเริ่มต้น</div>
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: 40, color: T.muted, fontSize: 13 }}>ไม่พบซัพพลายเออร์ที่ค้นหา</div>
      ) : (
        <CardBox style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 140px 180px 80px", alignItems: "center", padding: "10px 20px", background: "rgba(241,243,246,0.8)", borderBottom: `1px solid ${T.border}`, color: T.muted, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            <div>ชื่อ / ที่อยู่</div><div>เบอร์โทร</div><div>Email</div><div style={{ textAlign: "center" }}>จัดการ</div>
          </div>
          {filtered.map((s, i) => (
            <div key={s.id} style={{ display: "grid", gridTemplateColumns: "1fr 140px 180px 80px", alignItems: "center", padding: "14px 20px", borderBottom: i < filtered.length - 1 ? `1px solid ${T.border}` : "none", transition: "background 0.15s" }}
              onMouseEnter={e => e.currentTarget.style.background = "rgba(59,91,139,0.04)"}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
              <div>
                <div style={{ fontWeight: 600, color: T.text, fontSize: 13 }}>🏭 {s.name}</div>
                {s.address && <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>📍 {s.address}</div>}
                {s.note && <div style={{ fontSize: 11, color: T.muted, fontStyle: "italic" }}>📝 {s.note}</div>}
              </div>
              <div style={{ fontSize: 12, color: T.sub }}>{s.phone || "—"}</div>
              <div style={{ fontSize: 12, color: T.sub }}>{s.email || "—"}</div>
              <div style={{ display: "flex", gap: 5, justifyContent: "center" }}>
                {role.canAdd && <button onClick={() => openEdit(s)} style={{ padding: "5px 8px", borderRadius: 6, border: `1px solid ${T.border}`, background: "rgba(59,91,139,0.08)", color: T.accent, cursor: "pointer", fontSize: 11 }}>✏️</button>}
                {role.canDelete && <button onClick={async () => await deleteDoc(doc(db, "suppliers", s.id))} style={{ padding: "5px 8px", borderRadius: 6, border: "1px solid rgba(248,113,113,0.25)", background: "rgba(248,113,113,0.08)", color: "#f87171", cursor: "pointer", fontSize: 11 }}>✕</button>}
              </div>
            </div>
          ))}
        </CardBox>
      )}

      {showAdd && (
        <Modal onClose={() => setShowAdd(false)} w={480}>
          <MHead title={editSupplier ? "✏️ แก้ไขซัพพลายเออร์" : "🏭 เพิ่มซัพพลายเออร์ใหม่"} onClose={() => setShowAdd(false)} />
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 20 }}>
            <Input label="ชื่อบริษัท / ร้าน *" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="ชื่อซัพพลายเออร์" />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Input label="เบอร์โทรศัพท์" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="0812345678" />
              <Input label="Email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="info@supplier.com" />
            </div>
            <Input label="ที่อยู่" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} placeholder="ที่อยู่บริษัท" />
            <Input label="หมายเหตุ" value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} placeholder="สินค้าที่จัดหา, เงื่อนไข ฯลฯ" />
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <BtnGhost onClick={() => setShowAdd(false)} style={{ flex: 1 }}>ยกเลิก</BtnGhost>
            <BtnPrimary onClick={handleSave} disabled={!form.name.trim()} style={{ flex: 1 }}>💾 บันทึก</BtnPrimary>
          </div>
        </Modal>
      )}
    </div>
  );
}
