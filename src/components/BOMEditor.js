import React, { useState } from "react";
import { Modal, MHead, Input, BtnPrimary, BtnGhost, Toast } from "./ui";
import { collection, addDoc, updateDoc, doc, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase";
import { logAudit, AUDIT_ACTIONS } from "../utils/audit";

const T = { border:"#e3e8ef", sub:"#5b6b85", text:"#1f2a44", muted:"#8a9bb3", accent:"#3b5b8b", input:"#f6f8fb", inputBorder:"#d8dee9", red:"#dc2626" };

const fmt = (n) => Number(n || 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function BOMEditor({ initialBom, clothingItems = [], products = [], user, onClose }) {
  const rawMaterials = products.filter(p => (p.category || "").includes("วัตถุดิบ"));

  const [clothingId, setClothingId] = useState(initialBom?.clothingId || "");
  const [materials, setMaterials] = useState(initialBom?.materials || []);
  const [laborCostPerPiece, setLaborCostPerPiece] = useState(initialBom?.laborCostPerPiece ?? "");
  const [notes, setNotes] = useState(initialBom?.notes || "");
  const [saved, setSaved] = useState(false);

  const selectedClothing = clothingItems.find(c => c.id === clothingId);

  const addMaterial = () => {
    setMaterials(prev => [...prev, { productId:"", productName:"", unit:"", qtyPerPiece:"", costPerUnit:"" }]);
  };
  const updateMaterial = (idx, patch) => {
    setMaterials(prev => prev.map((m, i) => i === idx ? { ...m, ...patch } : m));
  };
  const removeMaterial = (idx) => {
    setMaterials(prev => prev.filter((_, i) => i !== idx));
  };
  const pickProduct = (idx, productId) => {
    const p = rawMaterials.find(x => x.id === productId);
    if (!p) { updateMaterial(idx, { productId:"", productName:"", unit:"", costPerUnit:"" }); return; }
    updateMaterial(idx, { productId: p.id, productName: p.name, unit: p.unit || "", costPerUnit: Number(p.costPrice) || 0 });
  };

  const materialCostPerPiece = materials.reduce((s, m) => s + (Number(m.qtyPerPiece) || 0) * (Number(m.costPerUnit) || 0), 0);
  const totalPerPiece = materialCostPerPiece + (Number(laborCostPerPiece) || 0);

  const canSave = clothingId && materials.length > 0 && materials.every(m => m.productId && Number(m.qtyPerPiece) > 0);

  const handleSave = async () => {
    if (!canSave) return;
    const data = {
      clothingId,
      clothingName: selectedClothing?.model || initialBom?.clothingName || "",
      materials: materials.map(m => ({
        productId: m.productId, productName: m.productName, unit: m.unit || "",
        qtyPerPiece: Number(m.qtyPerPiece) || 0, costPerUnit: Number(m.costPerUnit) || 0
      })),
      laborCostPerPiece: Number(laborCostPerPiece) || 0,
      notes: notes || "",
      updatedAt: serverTimestamp(),
      updatedBy: user?.name || "",
    };
    let id = initialBom?.id;
    if (id) {
      await updateDoc(doc(db, "boms", id), data);
    } else {
      const ref = await addDoc(collection(db, "boms"), data);
      id = ref.id;
    }
    logAudit(user, {
      action: AUDIT_ACTIONS.BOM_UPDATE,
      collection: "boms",
      targetId: id,
      targetLabel: `BOM · ${data.clothingName}`,
      note: `${data.materials.length} วัตถุดิบ · ค่าแรง ${fmt(data.laborCostPerPiece)} · ต้นทุน/ตัว ${fmt(totalPerPiece)}`,
    });
    setSaved(true);
    setTimeout(() => { setSaved(false); onClose && onClose(); }, 800);
  };

  return (
    <Modal onClose={onClose} w={760}>
      <MHead title={initialBom?.id ? "🧪 แก้ไข BOM" : "🧪 สร้าง BOM ใหม่"} sub="สูตรวัตถุดิบและค่าแรงต่อตัว" onClose={onClose}/>
      {saved && <Toast msg="บันทึก BOM สำเร็จ"/>}

      <div style={{marginBottom:14}}>
        <label style={{fontSize:11,color:T.sub,display:"block",marginBottom:5,fontWeight:500}}>เลือกรุ่นเสื้อ *</label>
        <select value={clothingId} onChange={e => setClothingId(e.target.value)} disabled={!!initialBom?.id}
          style={{width:"100%",background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:8,padding:"9px 12px",fontFamily:"'Sarabun',sans-serif",fontSize:13,outline:"none"}}>
          <option value="">— เลือกรุ่นเสื้อ —</option>
          {clothingItems.map(c => <option key={c.id} value={c.id}>{c.model}</option>)}
        </select>
      </div>

      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
        <div style={{fontSize:13,fontWeight:600,color:T.text}}>📦 รายการวัตถุดิบ ({materials.length})</div>
        <button onClick={addMaterial} style={{padding:"6px 14px",background:"rgba(59,91,139,0.08)",color:T.accent,border:`1px solid ${T.border}`,borderRadius:8,cursor:"pointer",fontSize:12,fontWeight:600,fontFamily:"inherit"}}>+ เพิ่มวัตถุดิบ</button>
      </div>

      {rawMaterials.length === 0 && (
        <div style={{padding:12,background:"#fff7e6",border:"1px solid #ffd980",borderRadius:8,fontSize:12,color:"#92400e",marginBottom:10}}>
          ⚠️ ยังไม่มีสินค้าหมวด "วัตถุดิบ" ในคลัง — เพิ่มที่ tab สินค้าคงคลังก่อน
        </div>
      )}

      <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:14,maxHeight:280,overflowY:"auto"}}>
        {materials.map((m, idx) => (
          <div key={idx} style={{display:"grid",gridTemplateColumns:"2fr 90px 90px 90px 36px",gap:8,alignItems:"end",padding:10,background:"#f8fafc",border:`1px solid ${T.border}`,borderRadius:10}}>
            <div>
              <label style={{fontSize:10,color:T.sub,display:"block",marginBottom:4}}>วัตถุดิบ</label>
              <select value={m.productId} onChange={e => pickProduct(idx, e.target.value)}
                style={{width:"100%",background:"white",border:`1px solid ${T.inputBorder}`,borderRadius:7,padding:"7px 10px",fontFamily:"inherit",fontSize:12,outline:"none"}}>
                <option value="">— เลือก —</option>
                {rawMaterials.map(p => <option key={p.id} value={p.id}>{p.name} ({p.unit || "-"})</option>)}
              </select>
            </div>
            <Input label="ใช้/ตัว" type="number" value={m.qtyPerPiece} onChange={e => updateMaterial(idx, { qtyPerPiece: e.target.value })}/>
            <Input label="หน่วยละ ฿" type="number" value={m.costPerUnit} onChange={e => updateMaterial(idx, { costPerUnit: e.target.value })}/>
            <div>
              <label style={{fontSize:10,color:T.sub,display:"block",marginBottom:4}}>รวม</label>
              <div style={{padding:"7px 8px",fontSize:12,fontFamily:"monospace",fontWeight:700,color:T.accent,background:"white",border:`1px solid ${T.inputBorder}`,borderRadius:7,textAlign:"right"}}>
                {fmt((Number(m.qtyPerPiece)||0)*(Number(m.costPerUnit)||0))}
              </div>
            </div>
            <button onClick={() => removeMaterial(idx)} title="ลบ" style={{padding:"7px 8px",background:"#fef2f2",border:"1px solid #fecaca",borderRadius:7,color:T.red,cursor:"pointer",fontSize:12,height:34}}>✕</button>
          </div>
        ))}
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:14}}>
        <Input label="ค่าแรงต่อตัว (฿)" type="number" value={laborCostPerPiece} onChange={e => setLaborCostPerPiece(e.target.value)}/>
        <Input label="หมายเหตุ" value={notes} onChange={e => setNotes(e.target.value)}/>
      </div>

      <div style={{padding:14,background:"linear-gradient(135deg,rgba(59,91,139,0.06),rgba(16,185,129,0.06))",border:`1px solid ${T.border}`,borderRadius:10,marginBottom:16}}>
        <div style={{display:"flex",justifyContent:"space-between",fontSize:12,color:T.sub,marginBottom:4}}>
          <span>ค่าวัตถุดิบ/ตัว</span><span style={{fontFamily:"monospace",fontWeight:700,color:T.text}}>฿{fmt(materialCostPerPiece)}</span>
        </div>
        <div style={{display:"flex",justifyContent:"space-between",fontSize:12,color:T.sub,marginBottom:6}}>
          <span>ค่าแรง/ตัว</span><span style={{fontFamily:"monospace",fontWeight:700,color:T.text}}>฿{fmt(Number(laborCostPerPiece)||0)}</span>
        </div>
        <div style={{display:"flex",justifyContent:"space-between",fontSize:14,fontWeight:700,paddingTop:6,borderTop:`1px solid ${T.border}`}}>
          <span style={{color:T.accent}}>ต้นทุน/ตัว</span>
          <span style={{fontFamily:"monospace",color:T.accent}}>฿{fmt(totalPerPiece)}</span>
        </div>
      </div>

      <div style={{display:"flex",gap:10}}>
        <BtnGhost onClick={onClose} style={{flex:1}}>ยกเลิก</BtnGhost>
        <BtnPrimary onClick={handleSave} disabled={!canSave} style={{flex:1}}>💾 บันทึก BOM</BtnPrimary>
      </div>
    </Modal>
  );
}
