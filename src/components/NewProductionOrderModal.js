import React, { useState, useMemo } from "react";
import { Modal, MHead, Input, BtnPrimary, BtnGhost, Toast } from "./ui";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase";
import { logAudit, AUDIT_ACTIONS } from "../utils/audit";
import { generateDocNo } from "../utils/docNumber";
import { SIZES, SHOE_SIZES, compareSizes } from "../theme";
import { ORDER_PALETTE } from "./KanbanBoard";

const T = { border:"#e3e8ef", sub:"#5b6b85", text:"#1f2a44", muted:"#8a9bb3", accent:"#3b5b8b", input:"#f6f8fb", inputBorder:"#d8dee9", red:"#dc2626", green:"#16a34a", amber:"#d97706" };
const fmt = (n) => Number(n || 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtInt = (n) => Number(n || 0).toLocaleString("th-TH");

export default function NewProductionOrderModal({ clothingItems = [], boms = [], products = [], productionOrders = [], user, onClose, onCreated }) {
  const [clothingId, setClothingId] = useState("");
  const [items, setItems] = useState([]); // [{colorIdx, colorName, colorHex, size, qty}] — โหมดทีละแถว
  const [grid, setGrid] = useState({}); // { [colorIdx]: { [size]: qtyStr } } — โหมดตาราง
  const [inputMode, setInputMode] = useState("grid"); // "grid" | "rows"
  const [note, setNote] = useState("");
  const [setNo, setSetNo] = useState(""); // 🎽 ชุดที่ (เช่น "ชุด3", "ชุดผู้ใหญ่", "รอบ2/2026")
  const [color, setColor] = useState(""); // 🎨 สีชุดงาน (ว่าง = auto จาก prodNo)
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const clothing = clothingItems.find(c => c.id === clothingId);
  const bom = useMemo(() => boms.find(b => b.clothingId === clothingId), [boms, clothingId]);

  // ไซส์สำหรับตาราง = ไซส์มาตรฐาน (ตาม sizeType) ∪ ไซส์ที่มีในรุ่นนี้แล้ว
  const gridSizes = useMemo(() => {
    if (!clothing) return [];
    const base = clothing.sizeType === "shoe" ? SHOE_SIZES : SIZES;
    const present = new Set();
    (clothing.colors || []).forEach(c => Object.keys(c.stock || {}).forEach(s => present.add(s)));
    return [...new Set([...base, ...present])].sort(compareSizes);
  }, [clothing]);

  const [linkedColors, setLinkedColors] = useState(() => new Set()); // 🔗 สีที่ติ๊กไว้ → กรอกแล้วซิงก์ค่าเข้าทุกสีที่ติ๊ก
  const toggleLink = (ci) => setLinkedColors(s => {
    const next = new Set(s);
    if (next.has(ci)) next.delete(ci); else next.add(ci);
    return next;
  });
  const setCell = (ci, sz, val) => setGrid(g => {
    const nextG = { ...g, [ci]: { ...(g[ci] || {}), [sz]: val } };
    // 🔗 ถ้าสีนี้ถูกติ๊กไว้ → propagate ค่าไปยังทุกสีที่ติ๊กเหมือนกัน (ในไซส์เดียวกัน)
    if (linkedColors.has(ci) && linkedColors.size > 1) {
      linkedColors.forEach(otherCi => {
        if (otherCi !== ci) nextG[otherCi] = { ...(nextG[otherCi] || {}), [sz]: val };
      });
    }
    return nextG;
  });

  const gridToItems = (g) => {
    const out = [];
    (clothing?.colors || []).forEach((c, ci) => {
      const row = g[ci] || {};
      gridSizes.forEach(sz => {
        const q = Number(row[sz]) || 0;
        if (q > 0) out.push({ colorIdx: ci, colorName: c.colorName, colorHex: c.colorHex || c.hex || "#999", size: sz, qty: q });
      });
    });
    return out;
  };

  // รายการที่ใช้จริง (ขึ้นกับโหมด)
  const effItems = inputMode === "grid" ? gridToItems(grid) : items;

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

  const totalQty = effItems.reduce((s,r) => s + (Number(r.qty)||0), 0);

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

  const canSubmit = clothingId && effItems.length > 0 && totalQty > 0;

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
      items: effItems.map(r => ({ colorIdx:Number(r.colorIdx)||0, colorName:r.colorName||"", colorHex:r.colorHex||"#999", size:r.size||"", qty:Number(r.qty)||0 })),
      totalQty,
      status: "พิมพ์ลาย",
      statusHistory: [{ status:"สร้างใบสั่งผลิต", at:now(), by:user?.name || "", note:note || "" }],
      costSnapshot,
      materialsConsumed: false,
      finishedStocked: false,
      bomId: bom?.id || null,
      note: note || "",
      setNo: setNo || "",
      color: color || "", // 🎨 ว่าง = ใช้ auto-สีจาก prodNo
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
      note: `${effItems.length} แถว · ${totalQty} ตัว · ต้นทุน ฿${fmt(grandTotal)}${hasShortage ? " · ⚠️ วัตถุดิบไม่พอ" : ""}`,
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
        <select value={clothingId} onChange={e => { setClothingId(e.target.value); setItems([]); setGrid({}); }}
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

      {clothingId && (clothing?.colors||[]).length === 0 && (
        <div style={{marginBottom:14,padding:"14px 16px",background:"#fff7e6",border:"1px solid #ffd980",borderRadius:10,fontSize:13,color:"#92400e",lineHeight:1.6}}>
          ⚠️ <b>รุ่นนี้ยังไม่มีสี</b> — เลยกรอกจำนวนไม่ได้<br/>
          <span style={{fontSize:12}}>ไปที่เมนู <b>คลัง → เสื้อผ้า</b> → กดที่รุ่น "{clothing?.model}" → ปุ่ม <b>+ สี</b> เพื่อเพิ่มสีก่อน แล้วกลับมาสั่งผลิตอีกครั้ง</span><br/>
          <span style={{fontSize:11,opacity:0.85}}>หรือถ้าเป็นงานเฉพาะแบบ (พิมพ์สี/ไซส์เอง ไม่ตัดสต็อก) ให้ใช้ <b>🎨 สั่งผลิต Custom</b> แทน</span>
        </div>
      )}
      {clothingId && (clothing?.colors||[]).length > 0 && (
        <>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8,flexWrap:"wrap",gap:8}}>
            <div style={{fontSize:13,fontWeight:600,color:T.text}}>📦 รายการที่จะผลิต (รวม {fmtInt(totalQty)} ตัว)</div>
            <div style={{display:"flex",gap:4,background:"#eef2f7",borderRadius:8,padding:3}}>
              <button onClick={()=>setInputMode("grid")} style={{padding:"5px 12px",borderRadius:6,border:"none",cursor:"pointer",fontSize:12,fontWeight:600,fontFamily:"inherit",background:inputMode==="grid"?"white":"transparent",color:inputMode==="grid"?T.accent:T.sub,boxShadow:inputMode==="grid"?"0 1px 3px rgba(0,0,0,0.1)":"none"}}>▦ ตาราง</button>
              <button onClick={()=>setInputMode("rows")} style={{padding:"5px 12px",borderRadius:6,border:"none",cursor:"pointer",fontSize:12,fontWeight:600,fontFamily:"inherit",background:inputMode==="rows"?"white":"transparent",color:inputMode==="rows"?T.accent:T.sub,boxShadow:inputMode==="rows"?"0 1px 3px rgba(0,0,0,0.1)":"none"}}>☰ ทีละแถว</button>
            </div>
          </div>

          {inputMode === "grid" ? (
            <div style={{marginBottom:12,overflowX:"auto",border:`1px solid ${T.border}`,borderRadius:10}}>
              <table style={{borderCollapse:"collapse",width:"100%",fontSize:12,minWidth:480}}>
                <thead>
                  <tr style={{background:"#f1f5fb"}}>
                    <th style={{position:"sticky",left:0,background:"#f1f5fb",zIndex:2,padding:"8px 10px",textAlign:"left",color:T.sub,fontWeight:700,borderRight:`1px solid ${T.border}`,minWidth:96}}>สี</th>
                    {gridSizes.map(sz => <th key={sz} style={{padding:"8px 4px",textAlign:"center",color:T.text,fontWeight:700,fontFamily:"monospace",minWidth:48,borderRight:`1px solid ${T.border}`}}>{sz}</th>)}
                    <th style={{padding:"8px 8px",textAlign:"center",color:T.accent,fontWeight:700,minWidth:54}}>รวม</th>
                  </tr>
                </thead>
                <tbody>
                  {(clothing?.colors || []).map((c, ci) => {
                    const row = grid[ci] || {};
                    const rowTotal = gridSizes.reduce((s,sz)=>s+(Number(row[sz])||0),0);
                    return (
                      <tr key={ci} style={{borderTop:`1px solid ${T.border}`}}>
                        <td style={{position:"sticky",left:0,background:"white",zIndex:1,padding:"6px 10px",borderRight:`1px solid ${T.border}`,whiteSpace:"nowrap"}}>
                          <label style={{display:"inline-flex",alignItems:"center",gap:6,cursor:"pointer",userSelect:"none"}} title="🔗 ติ๊กหลายสี → กรอกสีเดียว ค่าจะซิงก์ไปทุกสีที่ติ๊ก">
                            <input type="checkbox" checked={linkedColors.has(ci)} onChange={()=>toggleLink(ci)} style={{cursor:"pointer",accentColor:T.accent}}/>
                            <span style={{width:12,height:12,borderRadius:3,background:c.colorHex||c.hex||"#999",border:"1px solid rgba(0,0,0,0.15)"}}/>
                            <span style={{fontWeight:600,color:T.text}}>{c.colorName}</span>
                            {linkedColors.has(ci) && <span style={{fontSize:10,color:T.accent,marginLeft:2}}>🔗</span>}
                          </label>
                        </td>
                        {gridSizes.map(sz => (
                          <td key={sz} style={{padding:"3px",borderRight:`1px solid ${T.border}`}}>
                            <input type="number" inputMode="numeric" value={row[sz] ?? ""} onChange={e=>setCell(ci,sz,e.target.value)} placeholder="·"
                              style={{width:"100%",minWidth:40,boxSizing:"border-box",textAlign:"center",background:row[sz]>0?"#eff6ff":"white",border:`1px solid ${T.inputBorder}`,borderRadius:5,padding:"6px 2px",fontFamily:"monospace",fontSize:13,outline:"none",color:T.text}}/>
                          </td>
                        ))}
                        <td style={{textAlign:"center",fontFamily:"monospace",fontWeight:700,color:rowTotal>0?T.accent:T.muted}}>{rowTotal||""}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr style={{background:"#f8fafc",borderTop:`2px solid ${T.border}`}}>
                    <td style={{position:"sticky",left:0,background:"#f8fafc",padding:"8px 10px",fontWeight:700,color:T.sub,borderRight:`1px solid ${T.border}`}}>รวมไซส์</td>
                    {gridSizes.map(sz => {
                      const colTotal = (clothing?.colors||[]).reduce((s,_,ci)=>s+(Number((grid[ci]||{})[sz])||0),0);
                      return <td key={sz} style={{textAlign:"center",fontFamily:"monospace",fontWeight:700,color:colTotal>0?T.green:T.muted,borderRight:`1px solid ${T.border}`}}>{colTotal||""}</td>;
                    })}
                    <td style={{textAlign:"center",fontFamily:"monospace",fontWeight:800,color:T.green}}>{fmtInt(totalQty)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : (
          <>
          <div style={{display:"flex",justifyContent:"flex-end",marginBottom:6}}>
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
                    {(gridSizes.length?gridSizes:SIZES_ALL).map(s => <option key={s} value={s}>{s}</option>)}
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
          </>
          )}

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

          <div style={{display:"grid",gridTemplateColumns:"1fr 2fr",gap:8,marginBottom:12}}>
            <Input label="🎽 ชุดที่ (option)" placeholder="เช่น ชุด3, รอบ2" value={setNo} onChange={e => setSetNo(e.target.value)}/>
            <Input label="หมายเหตุ" value={note} onChange={e => setNote(e.target.value)}/>
          </div>

          {/* 🎨 สีชุดงาน — ทุกล็อต/ม้วนของใบนี้จะเป็นสีเดียวกันบน Kanban */}
          <div style={{marginBottom:12,padding:"10px 12px",background:"#f8fafc",border:`1px solid ${T.border}`,borderRadius:9}}>
            <div style={{fontSize:11,color:T.sub,fontWeight:600,marginBottom:7,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <span>🎨 สีชุดงาน (แยกให้ต่างจากใบอื่นบนบอร์ด)</span>
              {color&&<button onClick={()=>setColor("")} style={{padding:"2px 8px",border:"none",background:"transparent",color:T.sub,fontSize:10,cursor:"pointer",fontFamily:"inherit"}}>รีเซ็ต (auto)</button>}
            </div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              {ORDER_PALETTE.map(c=>(
                <button key={c} onClick={()=>setColor(c)} title={c}
                  style={{width:30,height:30,borderRadius:8,border:color===c?`3px solid ${c}`:`1px solid ${T.border}`,background:c,cursor:"pointer",padding:0,boxShadow:color===c?`0 2px 8px ${c}55`:"none"}}/>
              ))}
              <div style={{fontSize:10,color:T.muted,alignSelf:"center",marginLeft:6}}>{color?"เลือกแล้ว":"ไม่เลือก = auto ตามเลขใบ"}</div>
            </div>
          </div>

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
