import React, { useState, useRef } from "react";
import { Modal, MHead, Input, BtnPrimary, BtnGhost, Toast } from "./ui";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase";
import { logAudit, AUDIT_ACTIONS } from "../utils/audit";
import { generateDocNo } from "../utils/docNumber";

const T = { border:"#e3e8ef", sub:"#5b6b85", text:"#1f2a44", muted:"#8a9bb3", accent:"#3b5b8b", input:"#f6f8fb", inputBorder:"#d8dee9", red:"#dc2626" };
const fmt = (n) => Number(n || 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtInt = (n) => Number(n || 0).toLocaleString("th-TH");

function nowStr() {
  const d = new Date(); const p=n=>String(n).padStart(2,"0");
  return `${p(d.getDate())}/${p(d.getMonth()+1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function NewCustomOrderModal({ customOrders = [], customers = [], user, onClose, onCreated }) {
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [jobName, setJobName] = useState("");
  const [image, setImage] = useState("");
  const [items, setItems] = useState([{ colorName:"", size:"", qty:"" }]);
  const [costPerPiece, setCostPerPiece] = useState("");
  const [laborCostPerPiece, setLaborCostPerPiece] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const fileRef = useRef(null);

  const addRow = () => setItems(prev => [...prev, { colorName:"", size:"", qty:"" }]);
  const setRow = (idx, patch) => setItems(prev => prev.map((r,i)=> i===idx ? {...r, ...patch} : r));
  const removeRow = (idx) => setItems(prev => prev.filter((_,i)=>i!==idx));

  const handleImageUpload = (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = () => setImage(reader.result);
    reader.readAsDataURL(f);
  };

  const validItems = items.filter(r => Number(r.qty) > 0);
  const totalQty = validItems.reduce((s,r) => s + (Number(r.qty)||0), 0);
  const matCost = Number(costPerPiece) || 0;
  const labor = Number(laborCostPerPiece) || 0;
  const totalCostPerPiece = matCost + labor;
  const grandTotal = totalCostPerPiece * totalQty;

  const canSubmit = jobName.trim() && validItems.length > 0 && totalQty > 0;

  const handleSubmit = async () => {
    if (!canSubmit || saving) return;
    setSaving(true);
    const prodNo = generateDocNo("CUS", customOrders, "prodNo");
    const data = {
      prodNo,
      isCustom: true,
      customerName: customerName.trim(),
      customerPhone: customerPhone.trim(),
      clothingId: null,
      clothingName: jobName.trim(),
      clothingImage: image || "",
      items: validItems.map(r => ({
        colorIdx: 0,
        colorName: r.colorName.trim() || "-",
        colorHex: "#94a3b8",
        size: r.size.trim() || "-",
        qty: Number(r.qty) || 0,
      })),
      totalQty,
      status: "พิมพ์ลาย",
      statusHistory: [{ status:"สร้างใบสั่งผลิต (custom)", at:nowStr(), by:user?.name || "", note:note || "" }],
      costSnapshot: {
        materials: [],
        laborCostPerPiece: labor,
        materialCostPerPiece: matCost,
        totalCostPerPiece,
        grandTotal,
      },
      materialsConsumed: false,
      finishedStocked: false,
      bomId: null,
      note: note || "",
      by: user?.name || "",
      date: nowStr(),
      createdAt: serverTimestamp(),
    };
    const ref = await addDoc(collection(db, "customOrders"), data);
    logAudit(user, {
      action: AUDIT_ACTIONS.PRODUCTION_CREATE,
      collection: "customOrders",
      targetId: ref.id,
      targetLabel: `${prodNo} · ${data.clothingName}`,
      note: `Custom · ${validItems.length} แถว · ${totalQty} ตัว · ต้นทุน ฿${fmt(grandTotal)}`,
    });
    setSaved(true);
    setTimeout(() => { setSaved(false); setSaving(false); onCreated && onCreated({ ...data, id: ref.id }); onClose && onClose(); }, 700);
  };

  return (
    <Modal onClose={onClose} w={820}>
      <MHead title="🎨 สร้างใบสั่งผลิต Custom (เฉพาะแบบ)" sub="ใส่รูป + พิมพ์รุ่น/สี/ไซส์เอง — ไม่ตัดสต็อก" onClose={onClose}/>
      {saved && <Toast msg="สร้างใบสั่งผลิต custom สำเร็จ"/>}

      {/* ลูกค้า */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
        <Input label="ชื่อลูกค้า (ถ้ามี)" value={customerName} onChange={e => setCustomerName(e.target.value)}/>
        <Input label="เบอร์โทร" value={customerPhone} onChange={e => setCustomerPhone(e.target.value)}/>
      </div>

      {/* ชื่องาน + รูป */}
      <div style={{display:"flex",alignItems:"center",gap:16,marginBottom:14,padding:14,background:"#f8fafc",borderRadius:10,border:`1px solid ${T.border}`}}>
        <div style={{flexShrink:0}}>
          {image
            ? <img src={image} alt="" style={{width:110,height:110,borderRadius:10,objectFit:"cover",border:`2px solid ${T.accent}`}}/>
            : <div onClick={()=>fileRef.current?.click()} style={{width:110,height:110,borderRadius:10,background:T.input,display:"flex",alignItems:"center",justifyContent:"center",fontSize:30,border:`2px dashed ${T.inputBorder}`,cursor:"pointer"}}>📷</div>}
          <input ref={fileRef} type="file" accept="image/*" style={{display:"none"}} onChange={handleImageUpload}/>
        </div>
        <div style={{flex:1}}>
          <Input label="ชื่องาน / รุ่น *" value={jobName} onChange={e => setJobName(e.target.value)} placeholder="เช่น เสื้อคลาส ม.6/3 ปี 2569"/>
          <div style={{marginTop:8}}>
            <BtnGhost onClick={()=>fileRef.current?.click()} style={{fontSize:12,padding:"6px 14px"}}>📁 {image ? "เปลี่ยน" : "อัปโหลด"}รูปแบบ</BtnGhost>
            {image && <BtnGhost onClick={()=>setImage("")} style={{fontSize:12,padding:"6px 14px",marginLeft:6,color:T.red}}>✕ ลบ</BtnGhost>}
          </div>
        </div>
      </div>

      {/* รายการ */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
        <div style={{fontSize:13,fontWeight:600,color:T.text}}>📦 รายการผลิต ({validItems.length} แถว · รวม {fmtInt(totalQty)} ตัว)</div>
        <button onClick={addRow} style={{padding:"6px 14px",background:"rgba(59,91,139,0.08)",color:T.accent,border:`1px solid ${T.border}`,borderRadius:8,cursor:"pointer",fontSize:12,fontWeight:600,fontFamily:"inherit"}}>+ เพิ่มแถว</button>
      </div>

      <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:14,maxHeight:240,overflowY:"auto"}}>
        {items.map((r, idx) => (
          <div key={idx} style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 40px",gap:8,alignItems:"end",padding:10,background:"#f8fafc",border:`1px solid ${T.border}`,borderRadius:10}}>
            <Input label="สี" value={r.colorName} onChange={e => setRow(idx, { colorName: e.target.value })}/>
            <Input label="ไซส์ (พิมพ์เอง)" value={r.size} onChange={e => setRow(idx, { size: e.target.value })}/>
            <Input label="จำนวน" type="number" value={r.qty} onChange={e => setRow(idx, { qty: e.target.value })}/>
            {items.length > 1 && (
              <button onClick={() => removeRow(idx)} title="ลบ" style={{padding:"7px 8px",background:"#fef2f2",border:"1px solid #fecaca",borderRadius:7,color:T.red,cursor:"pointer",fontSize:12,height:34}}>✕</button>
            )}
          </div>
        ))}
      </div>

      {/* ต้นทุน */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
        <Input label="ต้นทุนวัตถุดิบ/ตัว (฿)" type="number" value={costPerPiece} onChange={e => setCostPerPiece(e.target.value)}/>
        <Input label="ค่าแรง/ตัว (฿)" type="number" value={laborCostPerPiece} onChange={e => setLaborCostPerPiece(e.target.value)}/>
      </div>

      <Input label="หมายเหตุ" value={note} onChange={e => setNote(e.target.value)} style={{marginBottom:12}}/>

      {totalQty > 0 && (
        <div style={{padding:14,background:"linear-gradient(135deg,rgba(59,91,139,0.06),rgba(16,185,129,0.06))",border:`1px solid ${T.border}`,borderRadius:10,marginBottom:14}}>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:12,color:T.sub,marginBottom:3}}>
            <span>วัตถุดิบ/ตัว</span><span style={{fontFamily:"monospace",fontWeight:700,color:T.text}}>฿{fmt(matCost)}</span>
          </div>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:12,color:T.sub,marginBottom:3}}>
            <span>ค่าแรง/ตัว</span><span style={{fontFamily:"monospace",fontWeight:700,color:T.text}}>฿{fmt(labor)}</span>
          </div>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:13,fontWeight:700,paddingTop:6,marginTop:6,borderTop:`1px solid ${T.border}`}}>
            <span style={{color:T.accent}}>ต้นทุน/ตัว × {fmtInt(totalQty)}</span>
            <span style={{fontFamily:"monospace",color:T.accent,fontSize:16}}>฿{fmt(grandTotal)}</span>
          </div>
        </div>
      )}

      <div style={{display:"flex",gap:10}}>
        <BtnGhost onClick={onClose} style={{flex:1}}>ยกเลิก</BtnGhost>
        <BtnPrimary onClick={handleSubmit} disabled={!canSubmit || saving} style={{flex:1}}>{saving ? "กำลังบันทึก..." : "🎨 ยืนยันสั่งผลิต Custom"}</BtnPrimary>
      </div>
    </Modal>
  );
}
