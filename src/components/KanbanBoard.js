import React, { useState, useMemo, useEffect } from "react";
import { doc, setDoc, updateDoc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";
import { PRODUCTION_STEPS, STATUS_COLORS, getLots, totalQtyOfLot, moveLot } from "../utils/productionLots";
import LotDetailModal from "./LotDetailModal";

const T = { card:"#ffffff", border:"#e3e8ef", text:"#1f2a44", sub:"#5b6b85", muted:"#8a9bb3", accent:"#3b5b8b" };
const fmtInt = (n) => Number(n || 0).toLocaleString("th-TH");

export default function KanbanBoard({
  orders = [], collectionName: defaultCollection = "productionOrders", isCustom: defaultIsCustom = false,
  user, role, products = [], clothingItems = [],
}) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null); // { order, lotIdx }
  const [collapsed, setCollapsed] = useState({});
  const [columnOrder, setColumnOrder] = useState(PRODUCTION_STEPS);
  // 🏭 production = ทำงานในโรงงาน → ทุก role ลาก/จัดการได้
  const canReorder = !!user;
  // 🖱️ Drag & drop state
  const [draggingLot, setDraggingLot] = useState(null); // {orderId, lotIdx, fromStatus, orderRef, collection}
  const [dragOverStatus, setDragOverStatus] = useState(null);

  // ย้าย lot ไปสถานะใหม่ (อิสระ — ไม่บังคับลำดับ)
  const moveLotToStatus = async (lot, targetStatus) => {
    if (lot.status === targetStatus) return;
    const orderRef = lot.orderRef;
    if (!orderRef) return;
    const collectionName = orderRef.__collection || defaultCollection;
    try {
      const lots = orderRef.lots || [];
      // ถ้า order ไม่มี lots structure (legacy) → update status ของ order
      if (lots.length === 0 || lot.lotIdx === undefined || lot.lotIdx < 0) {
        await updateDoc(doc(db, collectionName, orderRef.id), { status: targetStatus });
      } else {
        const newLots = moveLot(lots, lot.lotIdx, targetStatus, user?.name || "", `drag → ${targetStatus}`);
        await updateDoc(doc(db, collectionName, orderRef.id), { lots: newLots });
      }
    } catch (e) {
      console.error("[kanban] move failed:", e);
      alert("ย้ายไม่สำเร็จ: " + e.message);
    }
  };

  // โหลดสายงาน (steps + order รวมกัน — เก็บใน settings/kanbanSteps)
  // เปลี่ยนจาก kanbanOrder เป็น kanbanSteps เพราะตอนนี้ขั้นเพิ่ม/ลบได้
  useEffect(() => {
    const unsub = onSnapshot(doc(db, "settings", "kanbanSteps"), snap => {
      if (!snap.exists()) return;
      const stored = Array.isArray(snap.data().steps) ? snap.data().steps : [];
      const cleaned = stored.filter(s => typeof s === "string" && s.trim());
      if (cleaned.length > 0) setColumnOrder(cleaned);
    }, () => {});
    return () => unsub();
  }, []);

  const saveSteps = async (steps) => {
    setColumnOrder(steps);
    try { await setDoc(doc(db, "settings", "kanbanSteps"), { steps }); }
    catch(e) { console.warn("[kanbanSteps] save failed:", e); }
  };

  const moveColumn = async (idx, dir) => {
    const ni = idx + dir;
    if (ni < 0 || ni >= columnOrder.length) return;
    const newOrder = [...columnOrder];
    [newOrder[idx], newOrder[ni]] = [newOrder[ni], newOrder[idx]];
    await saveSteps(newOrder);
  };

  const addColumn = async () => {
    const name = window.prompt("ชื่อสายงานใหม่ (เช่น สกรีน, รีดร้อน):");
    if (!name || !name.trim()) return;
    const trimmed = name.trim();
    if (columnOrder.includes(trimmed)) { alert("มีสายงานชื่อนี้อยู่แล้ว"); return; }
    if (trimmed === "ยกเลิก") { alert("ใช้ชื่อนี้ไม่ได้ — สงวนสำหรับสถานะยกเลิก"); return; }
    await saveSteps([...columnOrder, trimmed]);
  };

  const removeColumn = async (step) => {
    const lotsInCol = allLots.filter(l => l.status === step);
    if (lotsInCol.length > 0) {
      alert(`ลบไม่ได้ — มี ${lotsInCol.length} ล็อตอยู่ในสายงาน "${step}" — กรุณาย้ายล็อตออกก่อน`);
      return;
    }
    if (!window.confirm(`ลบสายงาน "${step}" ?`)) return;
    await saveSteps(columnOrder.filter(s => s !== step));
  };

  const resetColumnOrder = async () => {
    if (!window.confirm("กลับเป็นลำดับเริ่มต้น (7 ขั้นมาตรฐาน)?")) return;
    await saveSteps([...PRODUCTION_STEPS]);
  };

  // กรอง orders + ไม่เอาที่ทุก lot เป็น "เข้าคลัง" หรือ "ยกเลิก"
  const visibleOrders = useMemo(() => {
    const q = search.toLowerCase().trim();
    return orders.filter(o => {
      if (q) {
        const hit = (o.prodNo||"").toLowerCase().includes(q) || (o.clothingName||"").toLowerCase().includes(q);
        if (!hit) return false;
      }
      return true;
    });
  }, [orders, search]);

  // สร้าง list ของ lots จาก orders (เพิ่ม metadata orderRef + lotIdx)
  const allLots = useMemo(() => {
    const out = [];
    visibleOrders.forEach(o => {
      const lots = getLots(o);
      lots.forEach((lot, lotIdx) => {
        out.push({
          ...lot,
          orderId: o.id,
          orderRef: o,
          lotIdx,
          prodNo: o.prodNo,
          clothingName: o.clothingName,
          clothingImage: o.clothingImage,
        });
      });
    });
    return out;
  }, [visibleOrders]);

  // group by status
  const byStatus = useMemo(() => {
    const m = {};
    PRODUCTION_STEPS.forEach(s => m[s] = []);
    allLots.forEach(l => {
      if (m[l.status]) m[l.status].push(l);
    });
    return m;
  }, [allLots]);

  const cancelledLots = allLots.filter(l => l.status === "ยกเลิก");

  return (
    <div>
      {/* Filter bar */}
      <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap"}}>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="🔍 ค้นหา เลขที่ใบ หรือ ชื่อรุ่น"
          style={{flex:"1 1 280px",padding:"8px 12px",border:`1px solid ${T.border}`,borderRadius:8,fontSize:13,fontFamily:"inherit",outline:"none",background:"white"}}/>
        <div style={{padding:"8px 14px",background:"rgba(59,91,139,0.06)",borderRadius:8,fontSize:12,color:T.sub}}>
          ทั้งหมด <b style={{color:T.accent}}>{allLots.length}</b> ล็อต
          {cancelledLots.length > 0 && <span style={{marginLeft:8,color:"#dc2626"}}>(ยกเลิก {cancelledLots.length})</span>}
        </div>
        {canReorder && allLots.length > 0 && (
          <div style={{padding:"8px 14px",background:"rgba(16,185,129,0.08)",border:"1px solid rgba(16,185,129,0.25)",borderRadius:8,fontSize:11,color:"#047857"}}>
            🖱️ ลากการ์ด → วางในคอลัมน์ที่ต้องการได้อิสระ
          </div>
        )}
        {canReorder && (
          <>
            <button onClick={addColumn} title="เพิ่มสายงานใหม่"
              style={{padding:"8px 14px",borderRadius:8,border:"1px solid rgba(16,185,129,0.35)",background:"rgba(16,185,129,0.08)",color:"#059669",cursor:"pointer",fontSize:11,fontWeight:600,fontFamily:"inherit"}}>+ เพิ่มสายงาน</button>
            <button onClick={resetColumnOrder} title="กลับเป็นลำดับเริ่มต้น"
              style={{padding:"8px 12px",borderRadius:8,border:`1px solid ${T.border}`,background:"white",color:T.sub,cursor:"pointer",fontSize:11,fontFamily:"inherit"}}>↺ เริ่มต้น</button>
          </>
        )}
      </div>

      {/* Kanban columns */}
      <div style={{display:"flex",gap:10,overflowX:"auto",paddingBottom:8,minHeight:480}}>
        {columnOrder.map((step, colIdx) => {
          const col = byStatus[step] || [];
          const color = STATUS_COLORS[step] || T.accent;
          const colTotal = col.reduce((s, l) => s + totalQtyOfLot(l), 0);
          const isCollapsed = collapsed[step];
          const isDragOver = dragOverStatus === step;
          return (
            <div key={step}
              onDragOver={e=>{ e.preventDefault(); if (draggingLot && draggingLot.status !== step) setDragOverStatus(step); }}
              onDragLeave={()=>setDragOverStatus(null)}
              onDrop={async e=>{
                e.preventDefault();
                if (draggingLot && draggingLot.status !== step) {
                  await moveLotToStatus(draggingLot, step);
                }
                setDraggingLot(null);
                setDragOverStatus(null);
              }}
              style={{flex:"0 0 240px",background:isDragOver?"#dbeafe":"#f8fafc",border:isDragOver?`2px dashed ${T.accent}`:`1px solid ${T.border}`,borderRadius:12,padding:8,display:"flex",flexDirection:"column",maxHeight:"calc(100vh - 280px)",transition:"background .15s, border-color .15s"}}>
              {/* Column header */}
              <div style={{padding:"8px 10px",borderRadius:8,background:color+"15",border:`1px solid ${color}30`,marginBottom:8,userSelect:"none"}}>
                <div style={{display:"flex",alignItems:"center",gap:6}}>
                  {canReorder && (
                    <button onClick={(e) => { e.stopPropagation(); moveColumn(colIdx, -1); }}
                      disabled={colIdx === 0}
                      title="ย้ายซ้าย"
                      style={{width:22,height:22,borderRadius:5,border:"none",background:colIdx===0?"transparent":"rgba(255,255,255,0.7)",color:colIdx===0?T.muted:color,cursor:colIdx===0?"not-allowed":"pointer",fontSize:11,fontWeight:700,fontFamily:"inherit",padding:0,opacity:colIdx===0?0.3:1}}>◀</button>
                  )}
                  <div onClick={() => setCollapsed(p => ({...p, [step]: !p[step]}))} style={{flex:1,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"space-between",gap:6}}>
                    <span style={{fontSize:12,fontWeight:700,color}}>{step}</span>
                    <span style={{fontSize:11,color:T.sub,whiteSpace:"nowrap"}}>{col.length} ล็อต · {fmtInt(colTotal)} ตัว</span>
                  </div>
                  {canReorder && (
                    <button onClick={(e) => { e.stopPropagation(); moveColumn(colIdx, 1); }}
                      disabled={colIdx === columnOrder.length - 1}
                      title="ย้ายขวา"
                      style={{width:22,height:22,borderRadius:5,border:"none",background:colIdx===columnOrder.length-1?"transparent":"rgba(255,255,255,0.7)",color:colIdx===columnOrder.length-1?T.muted:color,cursor:colIdx===columnOrder.length-1?"not-allowed":"pointer",fontSize:11,fontWeight:700,fontFamily:"inherit",padding:0,opacity:colIdx===columnOrder.length-1?0.3:1}}>▶</button>
                  )}
                  {canReorder && (
                    <button onClick={(e) => { e.stopPropagation(); removeColumn(step); }}
                      title={col.length > 0 ? `มี ${col.length} ล็อต — ย้ายออกก่อน` : "ลบสายงานนี้"}
                      style={{width:22,height:22,borderRadius:5,border:"none",background:col.length>0?"transparent":"rgba(220,38,38,0.12)",color:col.length>0?T.muted:"#dc2626",cursor:col.length>0?"not-allowed":"pointer",fontSize:13,fontWeight:600,fontFamily:"inherit",padding:0,opacity:col.length>0?0.3:1}}>✕</button>
                  )}
                </div>
              </div>
              {/* Cards */}
              {!isCollapsed && (
                <div style={{display:"flex",flexDirection:"column",gap:6,overflowY:"auto",flex:1}}>
                  {col.length === 0 ? (
                    <div style={{padding:20,textAlign:"center",fontSize:11,color:T.muted,fontStyle:"italic"}}>— ว่าง —</div>
                  ) : col.map(lot => (
                    <KanbanCard key={`${lot.orderId}-${lot.lotId}`} lot={lot}
                      onClick={() => setSelected({ order: lot.orderRef, lotIdx: lot.lotIdx })}
                      onDragStart={()=>setDraggingLot(lot)}
                      onDragEnd={()=>{ setDraggingLot(null); setDragOverStatus(null); }}
                      isDragging={draggingLot && draggingLot.orderId === lot.orderId && draggingLot.lotId === lot.lotId}
                      canDrag={canReorder}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {/* Cancelled column (แสดงถ้ามี) */}
        {cancelledLots.length > 0 && (
          <div style={{flex:"0 0 220px",background:"#fef2f2",border:"1px solid #fecaca",borderRadius:12,padding:8,maxHeight:"calc(100vh - 280px)",display:"flex",flexDirection:"column"}}>
            <div style={{padding:"8px 10px",borderRadius:8,background:"#fee2e2",border:"1px solid #fca5a5",marginBottom:8}}>
              <span style={{fontSize:12,fontWeight:700,color:"#dc2626"}}>🛑 ยกเลิก ({cancelledLots.length})</span>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:6,overflowY:"auto",flex:1}}>
              {cancelledLots.map(lot => (
                <KanbanCard key={`${lot.orderId}-${lot.lotId}`} lot={lot} onClick={() => setSelected({ order: lot.orderRef, lotIdx: lot.lotIdx })}/>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Detail modal */}
      {selected && (
        <LotDetailModal
          order={selected.order}
          lotIdx={selected.lotIdx}
          user={user}
          role={role}
          products={products}
          clothingItems={clothingItems}
          collectionName={selected.order.__collection || defaultCollection}
          isCustom={selected.order.__isCustom ?? defaultIsCustom}
          steps={columnOrder}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

function KanbanCard({ lot, onClick, onDragStart, onDragEnd, isDragging, canDrag = true }) {
  const total = totalQtyOfLot(lot);
  const colors = Array.from(new Set((lot.items || []).map(it => it.colorName)));
  const isCustom = lot.orderRef?.__isCustom;
  const accentColor = isCustom ? "#d97706" : T.accent;
  // 🖼️ thumbnail — รูปแรกจาก clothingImages (ใหม่) หรือ clothingImage (เก่า)
  const ord = lot.orderRef || {};
  const thumb = (Array.isArray(ord.clothingImages) && ord.clothingImages[0]?.dataUrl)
    || ord.clothingImage
    || (Array.isArray(ord.images) && ord.images[0]?.dataUrl)
    || "";
  return (
    <div onClick={onClick}
      draggable={canDrag}
      onDragStart={e=>{ if (!canDrag) return; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", lot.lotId); onDragStart && onDragStart(); }}
      onDragEnd={onDragEnd}
      style={{padding:"10px 12px",background:"white",border:`1px solid ${T.border}`,borderRadius:8,cursor:canDrag?"grab":"pointer",boxShadow:isDragging?`0 8px 20px ${accentColor}55`:"0 1px 3px rgba(0,0,0,0.04)",transition:"all 0.15s",borderLeft:`3px solid ${accentColor}`,opacity:isDragging?0.5:1}}
      onMouseEnter={e=>{e.currentTarget.style.boxShadow=`0 4px 12px ${accentColor}25`;e.currentTarget.style.borderColor=accentColor;e.currentTarget.style.borderLeftColor=accentColor;}}
      onMouseLeave={e=>{e.currentTarget.style.boxShadow=isDragging?`0 8px 20px ${accentColor}55`:"0 1px 3px rgba(0,0,0,0.04)";e.currentTarget.style.borderColor=T.border;e.currentTarget.style.borderLeftColor=accentColor;}}>
      <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:5}}>
        {isCustom && (
          <span style={{padding:"1px 6px",fontSize:9,background:"rgba(217,119,6,0.12)",color:"#d97706",borderRadius:6,border:"1px solid rgba(217,119,6,0.3)",fontWeight:700,letterSpacing:0.3}}>🎨 Custom</span>
        )}
        <span style={{fontFamily:"monospace",fontSize:10,color:accentColor,fontWeight:700}}>{lot.prodNo}</span>
        <span style={{fontSize:10,color:T.muted}}>· {lot.lotId}</span>
        <span style={{marginLeft:"auto",fontFamily:"monospace",fontWeight:700,color:T.text,fontSize:13}}>{fmtInt(total)}</span>
      </div>
      {/* 🖼️ Thumbnail + ชื่อรุ่น */}
      <div style={{display:"flex",gap:8,marginBottom:6,alignItems:"flex-start"}}>
        {thumb ? (
          <img src={thumb} alt="" draggable={false}
            style={{width:42,height:42,borderRadius:6,objectFit:"cover",border:`1px solid ${T.border}`,flexShrink:0,background:"#f8fafc"}}/>
        ) : (
          <div style={{width:42,height:42,borderRadius:6,border:`1px dashed ${T.border}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,color:T.muted,flexShrink:0,background:"#f8fafc"}}>{isCustom?"🎨":"👕"}</div>
        )}
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:12,fontWeight:600,color:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{lot.clothingName}</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:3,marginTop:3}}>
            {colors.slice(0,4).map((c,i) => (
              <span key={i} style={{padding:"1px 6px",fontSize:10,background:"rgba(59,91,139,0.08)",color:T.accent,borderRadius:8,border:"1px solid rgba(59,91,139,0.15)"}}>{c}</span>
            ))}
            {colors.length > 4 && <span style={{fontSize:10,color:T.muted}}>+{colors.length-4}</span>}
          </div>
        </div>
      </div>
      {(lot.notes || []).length > 0 && (
        <div style={{padding:"4px 8px",background:"#fffbeb",border:"1px solid #fde68a",borderRadius:5,fontSize:10,color:"#92400e"}}>
          📝 {lot.notes.length} หมายเหตุ
        </div>
      )}
    </div>
  );
}
