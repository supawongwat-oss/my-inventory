import React, { useState, useRef } from "react";
import { Modal, MHead, Input, BtnPrimary, BtnGhost, Toast } from "./ui";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase";
import { logAudit, AUDIT_ACTIONS } from "../utils/audit";
import { generateDocNo } from "../utils/docNumber";
import { compressImage, dataUrlSizeKB } from "../utils/imageCompress";
import { PRESET_COLORS } from "../theme";

const T = { border:"#e3e8ef", sub:"#5b6b85", text:"#1f2a44", muted:"#8a9bb3", accent:"#3b5b8b", input:"#f6f8fb", inputBorder:"#d8dee9", red:"#dc2626" };
const fmt = (n) => Number(n || 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtInt = (n) => Number(n || 0).toLocaleString("th-TH");

function nowStr() {
  const d = new Date(); const p=n=>String(n).padStart(2,"0");
  return `${p(d.getDate())}/${p(d.getMonth()+1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function NewCustomOrderModal({ customOrders = [], customers = [], user, onClose, onCreated }) {
  const [customerId, setCustomerId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [jobName, setJobName] = useState("");
  const [images, setImages] = useState([]); // [{dataUrl, label}]
  const [items, setItems] = useState([{ colorName:"", colorHex:"#94a3b8", size:"", qty:"", variant:"" }]);

  // 🎽 รูปแบบเสื้อยอดนิยม — กดชิปเพื่อใส่ในแถวที่เลือก
  const VARIANT_PRESETS = ["แขนสั้น", "แขนยาว", "แขนกุด", "คอกลม", "คอวี", "โปโล", "ฮู้ด"];
  const [costPerPiece, setCostPerPiece] = useState("");
  const [laborCostPerPiece, setLaborCostPerPiece] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const fileRef = useRef(null);

  const addRow = () => setItems(prev => {
    // แถวใหม่ inherit สี + variant จากแถวสุดท้าย (กดน้อยลง)
    const last = prev[prev.length-1];
    return [...prev, { colorName: last?.colorName || "", colorHex: last?.colorHex || "#94a3b8", size:"", qty:"", variant: last?.variant || "" }];
  });
  const setRow = (idx, patch) => setItems(prev => prev.map((r,i)=> i===idx ? {...r, ...patch} : r));
  const removeRow = (idx) => setItems(prev => prev.filter((_,i)=>i!==idx));
  // ⬆️ คัดลอกสีจากแถวบน
  const copyColorFromAbove = (idx) => {
    if (idx === 0) return;
    setItems(prev => prev.map((r,i) => i===idx ? { ...r, colorName: prev[i-1].colorName, colorHex: prev[i-1].colorHex || "#94a3b8" } : r));
  };

  // อัปโหลดได้หลายรูปพร้อมกัน — แต่ละรูป compress ก่อน
  const handleImageUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    try {
      const compressed = [];
      for (const f of files) {
        if (!f.type?.startsWith("image/")) continue;
        const dataUrl = await compressImage(f, { maxDim: 1200, quality: 0.8 });
        compressed.push({ dataUrl, label: "" });
      }
      setImages(prev => [...prev, ...compressed]);
    } catch (err) {
      console.error("[image] compress failed:", err);
      alert("โหลดรูปไม่สำเร็จ: " + (err.message || err));
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };
  const updateImageLabel = (idx, label) => setImages(prev => prev.map((im, i) => i === idx ? { ...im, label } : im));
  const removeImage = (idx) => setImages(prev => prev.filter((_, i) => i !== idx));

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
    try {
    const prodNo = generateDocNo("CUS", customOrders, "prodNo");
    const data = {
      prodNo,
      isCustom: true,
      customerId: customerId || "",
      customerName: customerName.trim(),
      customerPhone: customerPhone.trim(),
      clothingId: null,
      clothingName: jobName.trim(),
      clothingImage: images[0]?.dataUrl || "", // backward compat (รูปแรก)
      clothingImages: images,                  // [{dataUrl, label}]
      items: (() => {
        // 🔑 colorIdx ต้องไม่ซ้ำกันต่อสี — ไม่งั้น invoice form จะรวมทุกสีเป็นกลุ่มเดียว
        const colorMap = new Map(); // colorName → index
        return validItems.map(r => {
          const key = (r.colorName.trim() || "-") + "|" + (r.colorHex || "#94a3b8");
          if (!colorMap.has(key)) colorMap.set(key, colorMap.size);
          return {
            colorIdx: colorMap.get(key),
            colorName: r.colorName.trim() || "-",
            colorHex: r.colorHex || "#94a3b8",
            size: r.size.trim() || "-",
            qty: Number(r.qty) || 0,
            variant: (r.variant || "").trim() || "",
          };
        });
      })(),
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
    } catch (err) {
      console.error("[customOrder] save failed:", err);
      setSaving(false);
      const msg = err?.code === "invalid-argument" || /size|too large|exceeds/i.test(err?.message || "")
        ? "บันทึกไม่สำเร็จ — เอกสารใหญ่เกินไป (ลองใช้รูปขนาดเล็กลง)"
        : "บันทึกไม่สำเร็จ: " + (err?.message || err);
      alert(msg);
    }
  };

  return (
    <Modal onClose={onClose} w={820}>
      <MHead title="🎨 สร้างใบสั่งผลิต Custom (เฉพาะแบบ)" sub="ใส่รูป + พิมพ์รุ่น/สี/ไซส์เอง — ไม่ตัดสต็อก" onClose={onClose}/>
      {saved && <Toast msg="สร้างใบสั่งผลิต custom สำเร็จ"/>}

      {/* ลูกค้า — search ลูกค้าเดิม หรือพิมพ์ชื่อใหม่ */}
      <div style={{marginBottom:12,position:"relative"}}>
        <label style={{fontSize:11,color:T.muted,display:"block",marginBottom:4,fontWeight:600}}>ลูกค้า</label>
        <input
          value={customerId ? `✓ ${customerName}` : customerSearch}
          onChange={e => { setCustomerSearch(e.target.value); setCustomerId(""); setCustomerName(e.target.value); setCustomerPhone(""); }}
          placeholder="🔍 ค้นหาลูกค้าเดิม หรือพิมพ์ชื่อใหม่"
          style={{width:"100%",background:T.input,border:`1px solid ${customerId?"#16a34a":T.inputBorder}`,color:T.text,borderRadius:8,padding:"8px 12px",fontFamily:"inherit",fontSize:13,outline:"none"}}/>
        {customerSearch && !customerId && (() => {
          const norm = (s) => String(s||"").normalize("NFC").toLowerCase().replace(/\s+/g," ").trim();
          const q = norm(customerSearch);
          const matches = customers.filter(c =>
            norm(c.name).includes(q) || norm(c.phone).includes(q) || norm(c.address).includes(q)
          );
          return (
          <div style={{position:"absolute",top:"100%",left:0,right:0,background:"#fff",border:`1px solid ${T.border}`,borderRadius:8,zIndex:50,maxHeight:280,overflowY:"auto",boxShadow:"0 8px 24px rgba(0,0,0,0.15)",marginTop:2}}>
            {matches.length > 0 && (
              <div style={{padding:"5px 12px",background:"#eff6ff",fontSize:10,color:T.accent,fontWeight:700,borderBottom:`1px solid ${T.border}`,position:"sticky",top:0}}>
                เจอ {matches.length} ราย {matches.length > 30 && "(แสดง 30 รายแรก — พิมพ์เพิ่มเพื่อกรอง)"}
              </div>
            )}
            {matches.slice(0,30).map(c => (
              <div key={c.id} onClick={() => { setCustomerId(c.id); setCustomerName(c.name||""); setCustomerPhone(c.phone||""); setCustomerSearch(""); }}
                style={{padding:"8px 12px",cursor:"pointer",borderBottom:`1px solid ${T.border}`,fontSize:12}}
                onMouseEnter={e => e.currentTarget.style.background = "rgba(59,91,139,0.08)"}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                <div style={{fontWeight:600,color:T.text}}>{c.name}</div>
                {c.phone && <div style={{fontSize:11,color:T.muted}}>📞 {c.phone}</div>}
              </div>
            ))}
            {matches.length === 0 && (
              <div style={{padding:"8px 12px",fontSize:11,color:T.muted}}>ไม่พบในระบบ — จะใช้ชื่อนี้แบบใหม่</div>
            )}
          </div>
          );
        })()}
      </div>
      <Input label="เบอร์โทร" value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} style={{marginBottom:10}}/>

      {/* ชื่องาน */}
      <div style={{marginBottom:10}}>
        <Input label="ชื่องาน / รุ่น *" value={jobName} onChange={e => setJobName(e.target.value)} placeholder="เช่น เสื้อคลาส ม.6/3 ปี 2569"/>
      </div>

      {/* รูปแบบ — หลายรูปได้, แต่ละรูปใส่ label สีกำกับได้ */}
      <div style={{marginBottom:14,padding:12,background:"#f8fafc",borderRadius:10,border:`1px solid ${T.border}`}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:images.length>0?10:0}}>
          <div style={{fontSize:12,fontWeight:600,color:T.text}}>🎨 รูปแบบงาน ({images.length} รูป)</div>
          <BtnGhost onClick={()=>fileRef.current?.click()} style={{fontSize:11,padding:"5px 12px"}}>📁 + เพิ่มรูป</BtnGhost>
          <input ref={fileRef} type="file" accept="image/*" multiple style={{display:"none"}} onChange={handleImageUpload}/>
        </div>
        {images.length === 0 ? (
          <div onClick={()=>fileRef.current?.click()} style={{padding:"18px 12px",textAlign:"center",border:`2px dashed ${T.inputBorder}`,borderRadius:8,cursor:"pointer",background:"white",color:T.muted,fontSize:12}}>
            📷 คลิกเพื่ออัปโหลดรูป (เลือกได้หลายรูปพร้อมกัน)
          </div>
        ) : (
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))",gap:10}}>
            {images.map((im, idx) => (
              <div key={idx} style={{background:"white",border:`1px solid ${T.border}`,borderRadius:8,padding:6,position:"relative"}}>
                <button onClick={()=>removeImage(idx)} style={{position:"absolute",top:4,right:4,width:22,height:22,borderRadius:"50%",border:"1px solid #fecaca",background:"white",cursor:"pointer",fontSize:12,color:T.red,padding:0,lineHeight:1,zIndex:2}}>✕</button>
                <img src={im.dataUrl} alt="" style={{width:"100%",height:100,objectFit:"cover",borderRadius:6,marginBottom:6}}/>
                <input value={im.label} onChange={e => updateImageLabel(idx, e.target.value)}
                  placeholder="ชื่อ/สี (เช่น ดำ)"
                  style={{width:"100%",padding:"4px 6px",border:`1px solid ${T.inputBorder}`,borderRadius:5,fontSize:11,fontFamily:"inherit",outline:"none",textAlign:"center"}}/>
                <div style={{fontSize:9,color:T.muted,textAlign:"center",marginTop:3}}>{dataUrlSizeKB(im.dataUrl)} KB</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* รายการ */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8,flexWrap:"wrap",gap:6}}>
        <div style={{fontSize:13,fontWeight:600,color:T.text}}>📦 รายการผลิต ({validItems.length} แถว · รวม {fmtInt(totalQty)} ตัว)</div>
        <button onClick={addRow} style={{padding:"6px 14px",background:"rgba(59,91,139,0.08)",color:T.accent,border:`1px solid ${T.border}`,borderRadius:8,cursor:"pointer",fontSize:12,fontWeight:600,fontFamily:"inherit"}}>+ เพิ่มแถว</button>
      </div>

      {/* ใส่สีเดียวกันให้ทุกแถว */}
      {items.length > 1 && (
        <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:8,padding:"5px 10px",background:"rgba(217,119,6,0.06)",border:"1px solid rgba(217,119,6,0.2)",borderRadius:7,flexWrap:"wrap"}}>
          <span style={{fontSize:11,color:"#92400e",fontWeight:600}}>🎨 ใส่สีเดียวกันให้ทุกแถว:</span>
          <select onChange={e => {
            const idx = e.target.value;
            if (idx === "") return;
            const p = PRESET_COLORS[idx];
            if (!p) return;
            setItems(prev => prev.map(r => ({ ...r, colorName: p.name })));
            e.target.value = "";
          }} style={{background:"white",border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:5,padding:"3px 6px",fontSize:11,cursor:"pointer",fontFamily:"inherit"}}>
            <option value="">เลือก...</option>
            {PRESET_COLORS.map((c,i) => <option key={i} value={i}>{c.name}</option>)}
          </select>
          <input placeholder="หรือพิมพ์ชื่อสี" onKeyDown={e => {
            if (e.key === "Enter" && e.target.value.trim()) {
              const name = e.target.value.trim();
              setItems(prev => prev.map(r => ({ ...r, colorName: name })));
              e.target.value = "";
            }
          }} style={{flex:"1 1 100px",background:"white",border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:5,padding:"3px 6px",fontSize:11,outline:"none",fontFamily:"inherit"}}/>
        </div>
      )}

      {/* รวมรายชื่อสีที่กรอกแล้วในใบนี้ + PRESET_COLORS → ใช้เป็น suggestion */}
      {(() => null)()}
      <datalist id="custom-color-suggestions">
        {[...new Set([
          ...items.map(r => r.colorName).filter(Boolean),
          ...PRESET_COLORS.map(c => c.name),
        ])].map(name => <option key={name} value={name}/>)}
      </datalist>

      <div style={{display:"flex",flexDirection:"column",gap:4,marginBottom:12,maxHeight:340,overflowY:"auto"}}>
        {items.map((r, idx) => (
          <div key={idx} style={{padding:"6px 8px",background:"#f8fafc",border:`1px solid ${T.border}`,borderRadius:7}}>
          <div style={{display:"grid",gridTemplateColumns:"28px 24px 1fr 1fr 1fr 32px",gap:5,alignItems:"end"}}>
            {/* 🎨 swatch — กดเปลี่ยนสี */}
            <div>
              <label style={{fontSize:9,color:T.sub,display:"block",marginBottom:2}}>&nbsp;</label>
              <input type="color" value={r.colorHex || "#94a3b8"} onChange={e => setRow(idx, { colorHex: e.target.value })}
                title="เลือกสี"
                style={{width:28,height:28,padding:0,border:`1px solid ${T.inputBorder}`,borderRadius:6,cursor:"pointer",background:"transparent"}}/>
            </div>
            {/* ⬆️ copy color from row above */}
            <div>
              <label style={{fontSize:9,color:T.sub,display:"block",marginBottom:2}}>&nbsp;</label>
              <button onClick={()=>copyColorFromAbove(idx)} disabled={idx === 0}
                title={idx === 0 ? "ไม่มีแถวบน" : "ใช้สี+ชื่อสีเดียวกับแถวบน"}
                style={{width:24,height:28,padding:0,background:idx===0?"#f1f5f9":"#dbeafe",border:`1px solid ${idx===0?T.inputBorder:"#bfdbfe"}`,borderRadius:6,cursor:idx===0?"not-allowed":"pointer",fontSize:13,color:idx===0?T.muted:T.accent,fontWeight:700,fontFamily:"inherit"}}>↑</button>
            </div>
            <div>
              <label style={{fontSize:9,color:T.sub,display:"block",marginBottom:2}}>สี (เลือกจากที่ใช้แล้ว หรือพิมพ์ใหม่)</label>
              <input value={r.colorName} onChange={e => setRow(idx, { colorName: e.target.value })}
                list="custom-color-suggestions"
                placeholder="เช่น ส้ม / แดง / น้ำเงิน"
                style={{width:"100%",background:"white",border:`1px solid ${T.inputBorder}`,borderRadius:6,padding:"5px 8px",fontFamily:"inherit",fontSize:12,outline:"none"}}/>
            </div>
            <div>
              <label style={{fontSize:9,color:T.sub,display:"block",marginBottom:2}}>ไซส์ (พิมพ์เอง)</label>
              <input value={r.size} onChange={e => setRow(idx, { size: e.target.value })}
                style={{width:"100%",background:"white",border:`1px solid ${T.inputBorder}`,borderRadius:6,padding:"5px 8px",fontFamily:"inherit",fontSize:12,outline:"none"}}/>
            </div>
            <div>
              <label style={{fontSize:9,color:T.sub,display:"block",marginBottom:2}}>จำนวน</label>
              <input type="number" value={r.qty} onChange={e => setRow(idx, { qty: e.target.value })}
                style={{width:"100%",background:"white",border:`1px solid ${T.inputBorder}`,borderRadius:6,padding:"5px 8px",fontFamily:"inherit",fontSize:12,outline:"none"}}/>
            </div>
            {items.length > 1 ? (
              <button onClick={() => removeRow(idx)} title="ลบ" style={{padding:"5px 6px",background:"#fef2f2",border:"1px solid #fecaca",borderRadius:6,color:T.red,cursor:"pointer",fontSize:11,height:28}}>✕</button>
            ) : <div/>}
          </div>
          {/* 🎽 ลักษณะ (แขนสั้น/ยาว/กุด หรือพิมพ์เอง) */}
          <div style={{display:"flex",alignItems:"center",gap:5,marginTop:4,flexWrap:"wrap"}}>
            <label style={{fontSize:9,color:T.sub,fontWeight:600,minWidth:55}}>🎽 ลักษณะ:</label>
            <input value={r.variant||""} onChange={e => setRow(idx, { variant: e.target.value })}
              list={`variant-suggestions-${idx}`}
              placeholder="เช่น แขนสั้น, แขนยาว, แขนกุด, คอวี... (ไม่บังคับ)"
              style={{flex:"1 1 180px",background:"white",border:`1px solid ${T.inputBorder}`,borderRadius:6,padding:"4px 8px",fontFamily:"inherit",fontSize:11,outline:"none"}}/>
            <datalist id={`variant-suggestions-${idx}`}>
              {VARIANT_PRESETS.map(v => <option key={v} value={v}/>)}
            </datalist>
            {VARIANT_PRESETS.slice(0,3).map(v => (
              <button key={v} onClick={()=>setRow(idx, { variant: v })}
                style={{padding:"3px 8px",background:r.variant===v?"#3b5b8b":"white",color:r.variant===v?"white":T.accent,border:`1px solid ${r.variant===v?"#3b5b8b":T.inputBorder}`,borderRadius:12,fontSize:10,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>{v}</button>
            ))}
          </div>
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
