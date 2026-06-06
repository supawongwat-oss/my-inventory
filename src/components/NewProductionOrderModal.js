import React, { useState, useMemo } from "react";
import { Modal, MHead, Input, BtnPrimary, BtnGhost, Toast } from "./ui";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase";
import { logAudit, AUDIT_ACTIONS } from "../utils/audit";
import { generateDocNo } from "../utils/docNumber";

const T = { border:"#e3e8ef", sub:"#5b6b85", text:"#1f2a44", muted:"#8a9bb3", accent:"#3b5b8b", input:"#f6f8fb", inputBorder:"#d8dee9", red:"#dc2626", green:"#16a34a", amber:"#d97706" };
const fmt = (n) => Number(n || 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtInt = (n) => Number(n || 0).toLocaleString("th-TH");

export default function NewProductionOrderModal({ clothingItems = [], boms = [], products = [], productionOrders = [], user, onClose, onCreated }) {
  const [clothingId, setClothingId] = useState("");
  const [items, setItems] = useState([]); // [{colorIdx, colorName, colorHex, size, qty}]
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const clothing = clothingItems.find(c => c.id === clothingId);
  const bom = useMemo(() => boms.find(b => b.clothingId === clothingId), [boms, clothingId]);

  const addRow = () => {
    if (!clothing) return;
    const c0 = clothing.colors?.[0];
    setItems(prev => [...prev, { colorIdx:0, colorName:c0?.colorName || "", colorHex:c0?.colorHex || "#999", size:"M", qty:1 }]);
  };
  const setRow = (idx, patch) => setItems(prev => prev.map((r,i)=> i===idx ? {...r, ...patch} : r));
  const removeRow = (idx) => setItems(prev => prev.filter((_,i)=>i!==idx));
  const pickColor = (idx, colorIdx) => {
    const c = clothing?.colors?.[colorIdx];
    if (!c) return;
    setRow(idx, { colorIdx, colorName:c.colorName, colorHex:c.colorHex });
  };

  const totalQty = items.reduce((s,r) => s + (Number(r.qty)||0), 0);

  // คำนวณวัตถุดิบที่ต้องใช้และเช็คสต็อก
  const materialPlan = useMemo(() => {
    if (!bom || totalQty <= 0) return [];
    return bom.materials.map(m => {
      const need = (Number(m.qtyPerPiece)||0) * totalQty;
      const prod = products.find(p => p.id === m.productId);
      const have = Number(prod?.qty) || 0;
      const enough = have >= need;
      const totalCost = need * (Number(m.costPerUnit)||0);
      return { ...m, need, have, enough, totalCost, unit: m.unit || prod?.unit || "" };
    });
  }, [bom, totalQty, products]);

  const materialCostPerPiece = (bom?.materials || []).reduce((s,m) => s + (Number(m.qtyPerPiece)||0) * (Number(m.costPerUnit)||0), 0);
  const laborCostPerPiece = Number(bom?.laborCostPerPiece) || 0;
  const totalCostPerPiece = materialCostPerPiece + laborCostPerPiece;
  const grandTotal = totalCostPerPiece * totalQty;
  const hasShortage = materialPlan.some(m => !m.enough);

  const canSubmit = clothingId && items.length > 0 && totalQty > 0;

  const now = () => {
    const d = new Date(); const p=n=>String(n).padStart(2,"0");
    return `${p(d.getDate())}/${p(d.getMonth()+1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };

  const handleSubmit = async () => {
    if (!canSubmit || saving) return;
    setSaving(true);
    const prodNo = generateDocNo("PRD", productionOrders, "prodNo");
    const costSnapshot = {
      materials: (bom?.materials || []).map(m => ({
        productId: m.productId, productName: m.productName, unit: m.unit || "",
        qtyPerPiece: Number(m.qtyPerPiece)||0,
        costPerUnit: Number(m.costPerUnit)||0,
        totalQty: (Number(m.qtyPerPiece)||0) * totalQty,
        totalCost: (Number(m.qtyPerPiece)||0) * totalQty * (Number(m.costPerUnit)||0),
      })),
      laborCostPerPiece,
      materialCostPerPiece,
      totalCostPerPiece,
      grandTotal,
    };
    const data = {
      prodNo,
      clothingId,
      clothingName: clothing?.model || "",
      clothingImage: clothing?.image || "",
      items: items.map(r => ({ colorIdx:Number(r.colorIdx)||0, colorName:r.colorName||"", colorHex:r.colorHex||"#999", size:r.size||"", qty:Number(r.qty)||0 })),
      totalQty,
      status: "พิมพ์ลาย",
      statusHistory: [{ status:"สร้างใบสั่งผลิต", at:now(), by:user?.name || "", note:note || "" }],
      costSnapshot,
      materialsConsumed: false,
      finishedStocked: false,
      bomId: bom?.id || null,
      note: note || "",
      by: user?.name || "",
      date: now(),
      createdAt: serverTimestamp(),
    };
    const ref = await addDoc(collection(db, "productionOrders"), data);
    logAudit(user, {
      action: AUDIT_ACTIONS.PRODUCTION_CREATE,
      collection: "productionOrders",
      targetId: ref.id,
      targetLabel: `${prodNo} · ${data.clothingName}`,
      note: `${items.length} แถว · ${totalQty} ตัว · ต้นทุน ฿${fmt(grandTotal)}${hasShortage ? " · ⚠️ วัตถุดิบไม่พอ" : ""}`,
    });
    setSaved(true);
    setTimeout(() => { setSaved(false); setSaving(false); onCreated && onCreated({ ...data, id: ref.id }); onClose && onClose(); }, 700);
  };

  // size options ตามที่ใช้ในระบบ
  const SIZES_ALL = ["S","M","L","XL","2XL","3XL","4XL","5XL","6","8","10","12","14","16"];

  return (
    <Modal onClose={onClose} w={820}>
      <MHead title="🏭 สร้างใบสั่งผลิตใหม่" sub="เลือกรุ่น · สี · ไซส์ · จำนวน — ระบบคำนวณวัตถุดิบและต้นทุนให้" onClose={onClose}/>
      {saved && <Toast msg="สร้างใบสั่งผลิตสำเร็จ"/>}

      <div style={{marginBottom:14}}>
        <label style={{fontSize:11,color:T.sub,display:"block",marginBottom:5,fontWeight:500}}>เลือกรุ่นเสื้อ *</label>
        <select value={clothingId} onChange={e => { setClothingId(e.target.value); setItems([]); }}
          style={{width:"100%",background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:8,padding:"9px 12px",fontFamily:"'Sarabun',sans-serif",fontSize:13,outline:"none"}}>
          <option value="">— เลือกรุ่น —</option>
          {clothingItems.map(c => <option key={c.id} value={c.id}>{c.model}</option>)}
        </select>
        {clothingId && !bom && (
          <div style={{marginTop:6,padding:"4px 10px",background:"#fff7e6",border:"1px solid #ffd980",borderRadius:6,fontSize:10,color:"#92400e",lineHeight:1.3}}>
            ⚠️ รุ่นนี้ไม่มี BOM — สั่งผลิตได้แต่ไม่คำนวณวัตถุดิบ/ต้นทุน
          </div>
        )}
      </div>

      {clothingId && (
        <>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <div style={{fontSize:13,fontWeight:600,color:T.text}}>📦 รายการที่จะผลิต ({items.length} แถว · รวม {fmtInt(totalQty)} ตัว)</div>
            <button onClick={addRow} style={{padding:"6px 14px",background:"rgba(59,91,139,0.08)",color:T.accent,border:`1px solid ${T.border}`,borderRadius:8,cursor:"pointer",fontSize:12,fontWeight:600,fontFamily:"inherit"}}>+ เพิ่มแถว</button>
          </div>

          <div style={{display:"flex",flexDirection:"column",gap:4,marginBottom:12,maxHeight:240,overflowY:"auto"}}>
            {items.map((r, idx) => (
              <div key={idx} style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 32px",gap:6,alignItems:"end",padding:"6px 8px",background:"#f8fafc",border:`1px solid ${T.border}`,borderRadius:7}}>
                <div>
                  <label style={{fontSize:9,color:T.sub,display:"block",marginBottom:2}}>สี</label>
                  <select value={r.colorIdx} onChange={e => pickColor(idx, Number(e.target.value))}
                    style={{width:"100%",background:"white",border:`1px solid ${T.inputBorder}`,borderRadius:6,padding:"5px 8px",fontFamily:"inherit",fontSize:12,outline:"none"}}>
                    {(clothing?.colors || []).map((c,i) => <option key={i} value={i}>{c.colorName}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{fontSize:9,color:T.sub,display:"block",marginBottom:2}}>ไซส์</label>
                  <select value={r.size} onChange={e => setRow(idx, { size: e.target.value })}
                    style={{width:"100%",background:"white",border:`1px solid ${T.inputBorder}`,borderRadius:6,padding:"5px 8px",fontFamily:"inherit",fontSize:12,outline:"none"}}>
                    {SIZES_ALL.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{fontSize:9,color:T.sub,display:"block",marginBottom:2}}>จำนวน</label>
                  <input type="number" value={r.qty} onChange={e => setRow(idx, { qty: e.target.value })}
                    style={{width:"100%",background:"white",border:`1px solid ${T.inputBorder}`,borderRadius:6,padding:"5px 8px",fontFamily:"inherit",fontSize:12,outline:"none"}}/>
                </div>
                <button onClick={() => removeRow(idx)} title="ลบ" style={{padding:"5px 6px",background:"#fef2f2",border:"1px solid #fecaca",borderRadius:6,color:T.red,cursor:"pointer",fontSize:11,height:28}}>✕</button>
              </div>
            ))}
          </div>

          {bom && totalQty > 0 && (
            <div style={{marginBottom:14}}>
              <div style={{fontSize:13,fontWeight:600,color:T.text,marginBottom:8}}>🧪 วัตถุดิบที่ต้องใช้</div>
              <div style={{border:`1px solid ${T.border}`,borderRadius:10,overflow:"hidden"}}>
                <div style={{display:"grid",gridTemplateColumns:"2fr 90px 90px 100px",padding:"8px 12px",background:"#f8fafc",fontSize:10,fontWeight:700,color:T.muted,textTransform:"uppercase",letterSpacing:"0.06em",borderBottom:`1px solid ${T.border}`}}>
                  <div>วัตถุดิบ</div><div style={{textAlign:"right"}}>ต้องใช้</div><div style={{textAlign:"right"}}>คงเหลือ</div><div style={{textAlign:"right"}}>สถานะ</div>
                </div>
                {materialPlan.map((m, i) => (
                  <div key={i} style={{display:"grid",gridTemplateColumns:"2fr 90px 90px 100px",padding:"10px 12px",fontSize:12,borderBottom:i<materialPlan.length-1?`1px solid ${T.border}`:"none",alignItems:"center"}}>
                    <div style={{color:T.text}}>{m.productName}</div>
                    <div style={{textAlign:"right",fontFamily:"monospace",fontWeight:600,color:T.text}}>{fmtInt(m.need)} {m.unit}</div>
                    <div style={{textAlign:"right",fontFamily:"monospace",color:T.sub}}>{fmtInt(m.have)} {m.unit}</div>
                    <div style={{textAlign:"right",fontSize:11,fontWeight:700,color:m.enough?T.green:T.red}}>
                      {m.enough ? "✓ พอ" : "✗ ขาด"}
                    </div>
                  </div>
                ))}
              </div>
              {hasShortage && (
                <div style={{marginTop:8,padding:"8px 12px",background:"#fff7e6",border:"1px solid #ffd980",borderRadius:8,fontSize:12,color:"#92400e"}}>
                  ⚠️ วัตถุดิบบางตัวไม่พอ — สั่งผลิตได้ แต่ stock จะติดลบเมื่อเลื่อนสถานะเข้า "พิมพ์ลาย"
                </div>
              )}
            </div>
          )}

          <Input label="หมายเหตุ" value={note} onChange={e => setNote(e.target.value)} style={{marginBottom:12}}/>
          {/* spacer */}
          <div style={{height:2}}/>

          {bom && totalQty > 0 && (
            <div style={{padding:14,background:"linear-gradient(135deg,rgba(59,91,139,0.06),rgba(16,185,129,0.06))",border:`1px solid ${T.border}`,borderRadius:10,marginBottom:14}}>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:12,color:T.sub,marginBottom:3}}>
                <span>วัตถุดิบ/ตัว</span><span style={{fontFamily:"monospace",fontWeight:700,color:T.text}}>฿{fmt(materialCostPerPiece)}</span>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:12,color:T.sub,marginBottom:3}}>
                <span>ค่าแรง/ตัว</span><span style={{fontFamily:"monospace",fontWeight:700,color:T.text}}>฿{fmt(laborCostPerPiece)}</span>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:13,fontWeight:700,paddingTop:6,marginTop:6,borderTop:`1px solid ${T.border}`}}>
                <span style={{color:T.accent}}>ต้นทุน/ตัว × {fmtInt(totalQty)}</span>
                <span style={{fontFamily:"monospace",color:T.accent,fontSize:16}}>฿{fmt(grandTotal)}</span>
              </div>
            </div>
          )}
        </>
      )}

      <div style={{display:"flex",gap:10}}>
        <BtnGhost onClick={onClose} style={{flex:1}}>ยกเลิก</BtnGhost>
        <BtnPrimary onClick={handleSubmit} disabled={!canSubmit || saving} style={{flex:1}}>{saving ? "กำลังบันทึก..." : "🏭 ยืนยันสั่งผลิต"}</BtnPrimary>
      </div>
    </Modal>
  );
}
