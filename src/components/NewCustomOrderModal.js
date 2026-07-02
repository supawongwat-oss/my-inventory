import React, { useState, useRef } from "react";
import { Modal, MHead, Input, BtnPrimary, BtnGhost, Toast } from "./ui";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase";
import { logAudit, AUDIT_ACTIONS } from "../utils/audit";
import { generateDocNo } from "../utils/docNumber";
import { compressImage, dataUrlSizeKB } from "../utils/imageCompress";
import { PRESET_COLORS, getProductionSize, isProductionSizeCapped, SIZES, compareSizes } from "../theme";
import { ORDER_PALETTE } from "./KanbanBoard";

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
  const [fabricType, setFabricType] = useState("");
  const [collarType, setCollarType] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [shrinkOffset, setShrinkOffset] = useState(0); // 🪡 เผื่อหด: +0 / +1 / +2 / +3
  const [images, setImages] = useState([]); // [{dataUrl, label}]
  const [items, setItems] = useState([{ colorName:"", colorHex:"#94a3b8", size:"", qty:"", variant:"", productionSize:"" }]);
  // ▦ โหมดตาราง: แถว=สี (มี variant ต่อสี), คอลัมน์=ไซส์ (แก้ได้)
  const [inputMode, setInputMode] = useState("grid"); // "grid" | "rows"
  const [gridSizes, setGridSizes] = useState(["S","M","L","XL","2XL","3XL"]);
  const [newSizeCol, setNewSizeCol] = useState("");
  const [gridColors, setGridColors] = useState([{ colorName:"", colorHex:"#94a3b8", variant:"", qty:{} }]);

  const setGridCell = (ri, sz, v) => setGridColors(prev => prev.map((r,i)=> i===ri ? { ...r, qty:{...r.qty, [sz]:v} } : r));
  const setGridColorField = (ri, patch) => setGridColors(prev => prev.map((r,i)=> i===ri ? { ...r, ...patch } : r));
  const addGridColor = () => setGridColors(prev => { const last=prev[prev.length-1]; return [...prev, { colorName:"", colorHex:"#94a3b8", variant:last?.variant||"", qty:{} }]; });
  const removeGridColor = (ri) => setGridColors(prev => prev.filter((_,i)=>i!==ri));
  const addSizeCol = (raw) => {
    const v=String(raw||"").trim(); if(!v) return;
    setGridSizes(prev => prev.some(s=>s.toUpperCase()===v.toUpperCase()) ? prev : [...prev, v].sort(compareSizes));
    setNewSizeCol("");
  };
  const removeSizeCol = (sz) => setGridSizes(prev => prev.filter(s=>s!==sz));
  const gridToItems = () => {
    const out=[];
    gridColors.forEach(c => {
      gridSizes.forEach(sz => {
        const q = Number(c.qty?.[sz]) || 0;
        if (q>0) out.push({ colorName:(c.colorName||"").trim()||"-", colorHex:c.colorHex||"#94a3b8", size:sz, qty:q, variant:(c.variant||"").trim()||"", productionSize:getProductionSize(sz, shrinkOffset) });
      });
    });
    return out;
  };

  // 🎽 รูปแบบเสื้อยอดนิยม — กดชิปเพื่อใส่ในแถวที่เลือก
  const VARIANT_PRESETS = ["แขนสั้น", "แขนยาว", "แขนกุด", "คอกลม", "คอวี", "โปโล", "ฮู้ด"];
  const FABRIC_PRESETS = ["TK", "TC", "Cotton 100%", "Polyester", "Microfiber", "Lacoste/PK", "Dry-tech", "ผ้าโทรี่"];
  const COLLAR_PRESETS = ["คอกลม", "คอวี", "คอปก (โปโล)", "คอจีน", "คอฮู้ด"];
  const [costPerPiece, setCostPerPiece] = useState("");
  const [laborCostPerPiece, setLaborCostPerPiece] = useState("");
  const [note, setNote] = useState("");
  const [color, setColor] = useState(""); // 🎨 สีชุดงาน
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const fileRef = useRef(null);

  const addRow = () => setItems(prev => {
    // แถวใหม่ inherit สี + variant จากแถวสุดท้าย (กดน้อยลง)
    const last = prev[prev.length-1];
    return [...prev, { colorName: last?.colorName || "", colorHex: last?.colorHex || "#94a3b8", size:"", qty:"", variant: last?.variant || "", productionSize:"" }];
  });
  const setRow = (idx, patch) => setItems(prev => prev.map((r,i)=> i===idx ? {...r, ...patch} : r));
  const removeRow = (idx) => setItems(prev => prev.filter((_,i)=>i!==idx));
  // ⬆️ คัดลอกสีจากแถวบน
  const copyColorFromAbove = (idx) => {
    if (idx === 0) return;
    setItems(prev => prev.map((r,i) => i===idx ? { ...r, colorName: prev[i-1].colorName, colorHex: prev[i-1].colorHex || "#94a3b8" } : r));
  };

  // 🪡 บีบรูปแบบ adaptive: ถ้ายังใหญ่เกิน targetKB จะ retry ด้วย maxDim/quality ที่ต่ำลง
  const smartCompress = async (file, targetKB = 200) => {
    const presets = [
      { maxDim: 1100, quality: 0.78 },
      { maxDim: 900,  quality: 0.72 },
      { maxDim: 700,  quality: 0.65 },
      { maxDim: 550,  quality: 0.55 },
    ];
    let last = null;
    for (const p of presets) {
      last = await compressImage(file, p);
      if (dataUrlSizeKB(last) <= targetKB) return last;
    }
    return last; // ถ้ายังเกิน ส่งคืน attempt สุดท้าย (เล็กสุดเท่าที่ทำได้)
  };

  // อัปโหลดได้หลายรูปพร้อมกัน — บีบแบบ adaptive ให้ทุกรูปเล็กพอ
  const handleImageUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    try {
      const compressed = [];
      for (const f of files) {
        if (!f.type?.startsWith("image/")) continue;
        const dataUrl = await smartCompress(f, 200);
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

  const validItems = inputMode === "grid" ? gridToItems() : items.filter(r => Number(r.qty) > 0);
  const totalQty = validItems.reduce((s,r) => s + (Number(r.qty)||0), 0);
  const matCost = Number(costPerPiece) || 0;
  const labor = Number(laborCostPerPiece) || 0;
  const totalCostPerPiece = matCost + labor;
  const grandTotal = totalCostPerPiece * totalQty;

  const canSubmit = jobName.trim() && validItems.length > 0 && totalQty > 0;

  // คำนวณขนาดรวมของรูปทั้งหมด (KB) — ใช้แสดง progress + guard ตอน save
  const totalImageKB = images.reduce((s, im) => s + dataUrlSizeKB(im.dataUrl), 0);
  const IMAGE_BUDGET_KB = 900; // เหลือ ~120 KB สำหรับ field อื่น ๆ (Firestore limit 1024 KB / doc)

  const handleSubmit = async () => {
    if (!canSubmit || saving) return;
    if (totalImageKB > IMAGE_BUDGET_KB) {
      alert(`รูปรวม ${totalImageKB} KB เกิน budget ${IMAGE_BUDGET_KB} KB\n(Firestore จำกัด ~1 MB ต่อ document)\n\nกรุณาลบรูปบางรูป หรือใช้รูปที่เล็กลง`);
      return;
    }
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
      fabricType: (fabricType||"").trim(),
      collarType: (collarType||"").trim(),
      jobDescription: (jobDescription||"").trim(),
      shrinkOffset: Number(shrinkOffset) || 0,
      clothingImage: images[0]?.dataUrl || "", // backward compat (รูปแรก)
      clothingImages: images,                  // [{dataUrl, label}]
      items: (() => {
        // 🔑 colorIdx ต้องไม่ซ้ำกันต่อสี — ไม่งั้น invoice form จะรวมทุกสีเป็นกลุ่มเดียว
        const colorMap = new Map(); // colorName → index
        return validItems.map(r => {
          const key = (r.colorName.trim() || "-") + "|" + (r.colorHex || "#94a3b8");
          if (!colorMap.has(key)) colorMap.set(key, colorMap.size);
          const cSize = r.size.trim() || "-";
          const pSize = (r.productionSize||"").trim() || getProductionSize(cSize, shrinkOffset);
          return {
            colorIdx: colorMap.get(key),
            colorName: r.colorName.trim() || "-",
            colorHex: r.colorHex || "#94a3b8",
            size: cSize,
            productionSize: pSize,
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
      color: color || "",
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

      {/* ชนิดผ้า + ปกเสื้อ */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
        <div>
          <Input label="🧵 ชนิดผ้า" value={fabricType} onChange={e => setFabricType(e.target.value)} placeholder="เช่น TK, Cotton 100%" list="fabric-presets"/>
          <datalist id="fabric-presets">
            {FABRIC_PRESETS.map(v => <option key={v} value={v}/>)}
          </datalist>
          <div style={{display:"flex",flexWrap:"wrap",gap:4,marginTop:5}}>
            {FABRIC_PRESETS.slice(0,4).map(v => (
              <button key={v} onClick={()=>setFabricType(v)}
                style={{padding:"3px 8px",background:fabricType===v?"#3b5b8b":"white",color:fabricType===v?"white":T.accent,border:`1px solid ${fabricType===v?"#3b5b8b":T.inputBorder}`,borderRadius:12,fontSize:10,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>{v}</button>
            ))}
          </div>
        </div>
        <div>
          <Input label="👔 ปกเสื้อ / คอเสื้อ" value={collarType} onChange={e => setCollarType(e.target.value)} placeholder="เช่น คอกลม, คอวี" list="collar-presets"/>
          <datalist id="collar-presets">
            {COLLAR_PRESETS.map(v => <option key={v} value={v}/>)}
          </datalist>
          <div style={{display:"flex",flexWrap:"wrap",gap:4,marginTop:5}}>
            {COLLAR_PRESETS.slice(0,4).map(v => (
              <button key={v} onClick={()=>setCollarType(v)}
                style={{padding:"3px 8px",background:collarType===v?"#3b5b8b":"white",color:collarType===v?"white":T.accent,border:`1px solid ${collarType===v?"#3b5b8b":T.inputBorder}`,borderRadius:12,fontSize:10,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>{v}</button>
            ))}
          </div>
        </div>
      </div>

      {/* รายละเอียดงาน */}
      <div style={{marginBottom:10}}>
        <Input label="📋 รายละเอียดงาน" value={jobDescription} onChange={e => setJobDescription(e.target.value)} placeholder="เช่น สกรีนหน้า-หลัง, ปักโลโก้, เคลือบ..."/>
      </div>

      {/* รูปแบบ — หลายรูปได้, แต่ละรูปใส่ label สีกำกับได้ */}
      <div style={{marginBottom:14,padding:12,background:"#f8fafc",borderRadius:10,border:`1px solid ${T.border}`}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:images.length>0?10:0}}>
          <div style={{fontSize:12,fontWeight:600,color:T.text,display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
            🎨 รูปแบบงาน ({images.length} รูป)
            {images.length > 0 && (
              <span style={{padding:"2px 8px",borderRadius:10,fontSize:10,fontWeight:700,fontFamily:"monospace",background:totalImageKB > IMAGE_BUDGET_KB ? "rgba(220,38,38,0.1)" : totalImageKB > IMAGE_BUDGET_KB * 0.85 ? "rgba(217,119,6,0.1)" : "rgba(22,163,74,0.1)",color:totalImageKB > IMAGE_BUDGET_KB ? "#dc2626" : totalImageKB > IMAGE_BUDGET_KB * 0.85 ? "#92400e" : "#15803d",border:`1px solid ${totalImageKB > IMAGE_BUDGET_KB ? "rgba(220,38,38,0.3)" : totalImageKB > IMAGE_BUDGET_KB * 0.85 ? "rgba(217,119,6,0.3)" : "rgba(22,163,74,0.3)"}`}}>
                {totalImageKB} / {IMAGE_BUDGET_KB} KB
              </span>
            )}
            {totalImageKB > IMAGE_BUDGET_KB && (
              <span style={{fontSize:10,color:T.red,fontWeight:700}}>⚠️ เกิน — บันทึกไม่ได้</span>
            )}
          </div>
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
        <div style={{fontSize:13,fontWeight:600,color:T.text}}>📦 รายการผลิต (รวม {fmtInt(totalQty)} ตัว)</div>
        <div style={{display:"flex",gap:4,background:"#eef2f7",borderRadius:8,padding:3}}>
          <button onClick={()=>setInputMode("grid")} style={{padding:"5px 12px",borderRadius:6,border:"none",cursor:"pointer",fontSize:12,fontWeight:600,fontFamily:"inherit",background:inputMode==="grid"?"white":"transparent",color:inputMode==="grid"?T.accent:T.sub,boxShadow:inputMode==="grid"?"0 1px 3px rgba(0,0,0,0.1)":"none"}}>▦ ตาราง</button>
          <button onClick={()=>setInputMode("rows")} style={{padding:"5px 12px",borderRadius:6,border:"none",cursor:"pointer",fontSize:12,fontWeight:600,fontFamily:"inherit",background:inputMode==="rows"?"white":"transparent",color:inputMode==="rows"?T.accent:T.sub,boxShadow:inputMode==="rows"?"0 1px 3px rgba(0,0,0,0.1)":"none"}}>☰ ทีละแถว</button>
        </div>
      </div>

      {/* ใส่สีเดียวกันให้ทุกแถว */}
      {inputMode === "rows" && items.length > 1 && (
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

      {/* 🪡 เผื่อหด (Global offset — auto-calc ไซส์ผลิตให้ทุกแถว) */}
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8,padding:"5px 10px",background:"rgba(217,119,6,0.06)",border:"1px solid rgba(217,119,6,0.25)",borderRadius:7}}>
        <span style={{fontSize:11,fontWeight:700,color:"#92400e"}}>🪡 เผื่อหด:</span>
        <select value={shrinkOffset} onChange={e=>setShrinkOffset(Number(e.target.value))}
          style={{background:"white",border:"1px solid rgba(217,119,6,0.4)",borderRadius:5,padding:"3px 8px",fontSize:11,fontWeight:700,color:"#92400e",cursor:"pointer",fontFamily:"inherit",outline:"none"}}>
          <option value={0}>ไม่เผื่อ</option>
          <option value={1}>+1</option>
          <option value={2}>+2</option>
          <option value={3}>+3</option>
        </select>
        <span style={{fontSize:9,color:"#92400e",opacity:0.75}}>
          {shrinkOffset>0 ? `ตัดใหญ่ขึ้น ${shrinkOffset} ไซส์อัตโนมัติ (แถวที่ต้องการ override ได้)` : "ไซส์ผลิต = ไซส์ลูกค้า"}
        </span>
      </div>

      {/* รวมรายชื่อสีที่กรอกแล้วในใบนี้ + PRESET_COLORS → ใช้เป็น suggestion */}
      {(() => null)()}
      <datalist id="custom-color-suggestions">
        {[...new Set([
          ...items.map(r => r.colorName).filter(Boolean),
          ...PRESET_COLORS.map(c => c.name),
        ])].map(name => <option key={name} value={name}/>)}
      </datalist>

      {/* ▦ โหมดตาราง */}
      {inputMode === "grid" && (
        <div style={{marginBottom:12}}>
          {/* คอลัมน์ไซส์ — เพิ่ม/ลบได้ */}
          <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap",marginBottom:8,padding:"6px 10px",background:"#f8fafc",border:`1px solid ${T.border}`,borderRadius:8}}>
            <span style={{fontSize:11,color:T.sub,fontWeight:600}}>ไซส์ในตาราง:</span>
            {gridSizes.map(sz=>(
              <span key={sz} style={{display:"inline-flex",alignItems:"center",gap:4,padding:"2px 4px 2px 9px",borderRadius:7,background:"white",border:`1px solid ${T.inputBorder}`,fontSize:11,fontFamily:"monospace",fontWeight:700,color:T.accent}}>
                {sz}<button onClick={()=>removeSizeCol(sz)} title="ลบคอลัมน์" style={{border:"none",background:"transparent",color:T.red,cursor:"pointer",fontSize:12,lineHeight:1,padding:0}}>✕</button>
              </span>
            ))}
            <input value={newSizeCol} onChange={e=>setNewSizeCol(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addSizeCol(newSizeCol)} placeholder="+ ไซส์"
              style={{width:70,background:"white",border:`1px solid ${T.inputBorder}`,borderRadius:6,padding:"4px 8px",fontFamily:"inherit",fontSize:11,outline:"none"}}/>
            <button onClick={()=>addSizeCol(newSizeCol)} disabled={!newSizeCol.trim()} style={{padding:"4px 10px",borderRadius:6,border:`1px solid ${T.border}`,background:"rgba(59,91,139,0.08)",color:T.accent,cursor:"pointer",fontSize:11,fontWeight:600,fontFamily:"inherit"}}>เพิ่ม</button>
          </div>

          <div style={{overflowX:"auto",border:`1px solid ${T.border}`,borderRadius:10}}>
            <table style={{borderCollapse:"collapse",width:"100%",fontSize:12,minWidth:520}}>
              <thead>
                <tr style={{background:"#f1f5fb"}}>
                  <th style={{position:"sticky",left:0,background:"#f1f5fb",zIndex:2,padding:"7px 8px",textAlign:"left",color:T.sub,fontWeight:700,borderRight:`1px solid ${T.border}`,minWidth:150}}>สี · ลักษณะ</th>
                  {gridSizes.map(sz=><th key={sz} style={{padding:"7px 4px",textAlign:"center",color:T.text,fontWeight:700,fontFamily:"monospace",minWidth:46,borderRight:`1px solid ${T.border}`}}>{sz}</th>)}
                  <th style={{padding:"7px 6px",textAlign:"center",color:T.accent,fontWeight:700,minWidth:48}}>รวม</th>
                  <th style={{width:30}}></th>
                </tr>
              </thead>
              <tbody>
                {gridColors.map((c,ri)=>{
                  const rowTotal = gridSizes.reduce((s,sz)=>s+(Number(c.qty?.[sz])||0),0);
                  return (
                    <tr key={ri} style={{borderTop:`1px solid ${T.border}`}}>
                      <td style={{position:"sticky",left:0,background:"white",zIndex:1,padding:"5px 8px",borderRight:`1px solid ${T.border}`}}>
                        <div style={{display:"flex",alignItems:"center",gap:5,marginBottom:3}}>
                          <input type="color" value={c.colorHex||"#94a3b8"} onChange={e=>setGridColorField(ri,{colorHex:e.target.value})} title="เลือกสี"
                            style={{width:24,height:24,padding:0,border:`1px solid ${T.inputBorder}`,borderRadius:5,cursor:"pointer",background:"transparent",flexShrink:0}}/>
                          <input value={c.colorName} onChange={e=>setGridColorField(ri,{colorName:e.target.value})} list="custom-color-suggestions" placeholder="ชื่อสี"
                            style={{flex:1,minWidth:60,background:"white",border:`1px solid ${T.inputBorder}`,borderRadius:5,padding:"4px 6px",fontFamily:"inherit",fontSize:12,outline:"none"}}/>
                        </div>
                        <input value={c.variant||""} onChange={e=>setGridColorField(ri,{variant:e.target.value})} list="variant-grid-suggestions" placeholder="🎽 ลักษณะ (แขนสั้น...)"
                          style={{width:"100%",boxSizing:"border-box",background:"white",border:`1px solid ${T.inputBorder}`,borderRadius:5,padding:"3px 6px",fontFamily:"inherit",fontSize:10,outline:"none"}}/>
                      </td>
                      {gridSizes.map(sz=>(
                        <td key={sz} style={{padding:"3px",borderRight:`1px solid ${T.border}`}}>
                          <input type="number" inputMode="numeric" value={c.qty?.[sz] ?? ""} onChange={e=>setGridCell(ri,sz,e.target.value)} placeholder="·"
                            style={{width:"100%",minWidth:38,boxSizing:"border-box",textAlign:"center",background:(c.qty?.[sz]>0)?"#eff6ff":"white",border:`1px solid ${T.inputBorder}`,borderRadius:5,padding:"6px 2px",fontFamily:"monospace",fontSize:13,outline:"none",color:T.text}}/>
                        </td>
                      ))}
                      <td style={{textAlign:"center",fontFamily:"monospace",fontWeight:700,color:rowTotal>0?T.accent:T.muted}}>{rowTotal||""}</td>
                      <td style={{textAlign:"center"}}>
                        {gridColors.length>1&&<button onClick={()=>removeGridColor(ri)} title="ลบสี" style={{border:"none",background:"transparent",color:T.red,cursor:"pointer",fontSize:13}}>✕</button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{background:"#f8fafc",borderTop:`2px solid ${T.border}`}}>
                  <td style={{position:"sticky",left:0,background:"#f8fafc",padding:"7px 8px",fontWeight:700,color:T.sub,borderRight:`1px solid ${T.border}`}}>รวมไซส์</td>
                  {gridSizes.map(sz=>{const ct=gridColors.reduce((s,c)=>s+(Number(c.qty?.[sz])||0),0);return <td key={sz} style={{textAlign:"center",fontFamily:"monospace",fontWeight:700,color:ct>0?"#16a34a":T.muted,borderRight:`1px solid ${T.border}`}}>{ct||""}</td>;})}
                  <td style={{textAlign:"center",fontFamily:"monospace",fontWeight:800,color:"#16a34a"}}>{fmtInt(totalQty)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
          <button onClick={addGridColor} style={{marginTop:8,padding:"6px 14px",background:"rgba(59,91,139,0.08)",color:T.accent,border:`1px solid ${T.border}`,borderRadius:8,cursor:"pointer",fontSize:12,fontWeight:600,fontFamily:"inherit"}}>+ เพิ่มสี</button>
          {shrinkOffset>0 && <div style={{marginTop:6,fontSize:10,color:"#92400e"}}>🪡 เผื่อหด +{shrinkOffset}: ไซส์ผลิตจะถูกคำนวณอัตโนมัติจากไซส์ในตาราง</div>}
          <datalist id="variant-grid-suggestions">{VARIANT_PRESETS.map(v=><option key={v} value={v}/>)}</datalist>
        </div>
      )}

      {inputMode === "rows" && (<>
      <div style={{display:"flex",justifyContent:"flex-end",marginBottom:6}}>
        <button onClick={addRow} style={{padding:"6px 14px",background:"rgba(59,91,139,0.08)",color:T.accent,border:`1px solid ${T.border}`,borderRadius:8,cursor:"pointer",fontSize:12,fontWeight:600,fontFamily:"inherit"}}>+ เพิ่มแถว</button>
      </div>
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
          {/* 🪡 ไซส์ผลิต (auto จาก size + shrinkOffset, override ได้) */}
          {(shrinkOffset>0 || r.productionSize) && (()=>{
            const autoPSize = getProductionSize(r.size||"", shrinkOffset);
            const capped = isProductionSizeCapped(r.size||"", shrinkOffset);
            const effective = (r.productionSize||"").trim() || autoPSize;
            const isOverride = !!(r.productionSize||"").trim();
            return (
            <div style={{display:"flex",alignItems:"center",gap:5,marginTop:4,flexWrap:"wrap",padding:"4px 6px",background:"rgba(217,119,6,0.06)",border:"1px dashed rgba(217,119,6,0.3)",borderRadius:6}}>
              <label style={{fontSize:9,color:"#92400e",fontWeight:700,minWidth:75}}>🪡 ไซส์ผลิต:</label>
              <input value={r.productionSize||""} onChange={e=>setRow(idx,{productionSize:e.target.value})}
                placeholder={autoPSize ? `auto: ${autoPSize}` : "(ปล่อยว่าง = ใช้ไซส์ลูกค้า)"}
                style={{flex:"0 1 100px",background:"white",border:`1px solid ${T.inputBorder}`,borderRadius:6,padding:"4px 8px",fontFamily:"inherit",fontSize:11,fontWeight:700,textAlign:"center",outline:"none",color:isOverride?T.accent:"#92400e"}}/>
              <span style={{fontSize:10,color:"#92400e",fontWeight:600}}>
                = ตัดผ้าจริง <b style={{color:T.accent}}>{effective || "-"}</b>
                {r.size && effective && r.size !== effective && <span style={{color:T.muted,fontWeight:500,marginLeft:4}}>(ลูกค้า: {r.size})</span>}
              </span>
              {capped && !isOverride && <span style={{fontSize:9,color:T.red,fontWeight:700,padding:"2px 6px",background:"#fef2f2",border:"1px solid #fecaca",borderRadius:10}}>⚠️ ชน 12XL (เกิน max)</span>}
              {isOverride && <button onClick={()=>setRow(idx,{productionSize:""})} title="ใช้ auto" style={{padding:"2px 8px",background:"white",border:`1px solid ${T.inputBorder}`,borderRadius:10,fontSize:9,color:T.sub,cursor:"pointer",fontFamily:"inherit"}}>↺ auto</button>}
            </div>
            );
          })()}
          </div>
        ))}
      </div>
      </>)}

      {/* ต้นทุน + ค่าแรง + หมายเหตุ — ขนาดเล็ก ประหยัดพื้นที่ */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 2fr",gap:8,marginBottom:10}}>
        <div>
          <label style={{fontSize:10,color:T.muted,display:"block",marginBottom:2,fontWeight:600}}>ต้นทุนวัตถุดิบ/ตัว (฿)</label>
          <input type="number" value={costPerPiece} onChange={e => setCostPerPiece(e.target.value)}
            placeholder="0"
            style={{width:"100%",background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:6,padding:"5px 8px",fontFamily:"monospace",fontSize:11,outline:"none"}}/>
        </div>
        <div>
          <label style={{fontSize:10,color:T.muted,display:"block",marginBottom:2,fontWeight:600}}>ค่าแรง/ตัว (฿)</label>
          <input type="number" value={laborCostPerPiece} onChange={e => setLaborCostPerPiece(e.target.value)}
            placeholder="0"
            style={{width:"100%",background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:6,padding:"5px 8px",fontFamily:"monospace",fontSize:11,outline:"none"}}/>
        </div>
        <div>
          <label style={{fontSize:10,color:T.muted,display:"block",marginBottom:2,fontWeight:600}}>หมายเหตุ</label>
          <input value={note} onChange={e => setNote(e.target.value)}
            placeholder="เช่น ส่งภายใน 7 วัน"
            style={{width:"100%",background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:6,padding:"5px 8px",fontFamily:"inherit",fontSize:11,outline:"none"}}/>
        </div>
      </div>

      {/* 🎨 สีชุดงาน */}
      <div style={{marginBottom:10,padding:"8px 10px",background:"#f8fafc",border:`1px solid ${T.border}`,borderRadius:8}}>
        <div style={{fontSize:10,color:T.muted,fontWeight:600,marginBottom:5,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <span>🎨 สีชุดงาน (แยกให้ต่างจากใบอื่นบนบอร์ด Kanban)</span>
          {color&&<button onClick={()=>setColor("")} style={{padding:"1px 6px",border:"none",background:"transparent",color:T.sub,fontSize:9,cursor:"pointer",fontFamily:"inherit"}}>รีเซ็ต</button>}
        </div>
        <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
          {ORDER_PALETTE.map(c=>(
            <button key={c} onClick={()=>setColor(c)} title={c}
              style={{width:26,height:26,borderRadius:6,border:color===c?`3px solid ${c}`:`1px solid ${T.border}`,background:c,cursor:"pointer",padding:0,boxShadow:color===c?`0 2px 6px ${c}55`:"none"}}/>
          ))}
          <div style={{fontSize:9,color:T.muted,alignSelf:"center",marginLeft:4}}>{color?"":"ไม่เลือก = auto"}</div>
        </div>
      </div>

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
        <BtnPrimary onClick={handleSubmit} disabled={!canSubmit || saving || totalImageKB > IMAGE_BUDGET_KB} style={{flex:1}}>{saving ? "กำลังบันทึก..." : totalImageKB > IMAGE_BUDGET_KB ? "⚠️ รูปใหญ่เกิน — ลดรูปก่อน" : "🎨 ยืนยันสั่งผลิต Custom"}</BtnPrimary>
      </div>
    </Modal>
  );
}
