import React, { useState, useMemo, useEffect } from "react";
import { doc, setDoc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";
import { PRODUCTION_STEPS, STATUS_COLORS, getLots, totalQtyOfLot } from "../utils/productionLots";
import LotDetailModal from "./LotDetailModal";

const T = { card:"#ffffff", border:"#e3e8ef", text:"#1f2a44", sub:"#5b6b85", muted:"#8a9bb3", accent:"#3b5b8b" };
const fmtInt = (n) => Number(n || 0).toLocaleString("th-TH");

export default function KanbanBoard({
  orders = [], collectionName = "productionOrders", isCustom = false,
  user, role, products = [], clothingItems = [],
}) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null); // { order, lotIdx }
  const [collapsed, setCollapsed] = useState({});
  const [columnOrder, setColumnOrder] = useState(PRODUCTION_STEPS);
  const canReorder = user?.role === "admin" || user?.role === "manager";

  // โหลดลำดับ column ที่บันทึกไว้ (subscribe เพื่อ sync ทุกเครื่อง)
  useEffect(() => {
    const unsub = onSnapshot(doc(db, "settings", "kanbanOrder"), snap => {
      if (!snap.exists()) return;
      const stored = Array.isArray(snap.data().steps) ? snap.data().steps : [];
      const filtered = stored.filter(s => PRODUCTION_STEPS.includes(s));
      // เติมขั้นที่อาจเพิ่มมาภายหลัง (กัน PRODUCTION_STEPS เปลี่ยน)
      const missing = PRODUCTION_STEPS.filter(s => !filtered.includes(s));
      setColumnOrder([...filtered, ...missing]);
    }, () => {});
    return () => unsub();
  }, []);

  const moveColumn = async (idx, dir) => {
    const ni = idx + dir;
    if (ni < 0 || ni >= columnOrder.length) return;
    const newOrder = [...columnOrder];
    [newOrder[idx], newOrder[ni]] = [newOrder[ni], newOrder[idx]];
    setColumnOrder(newOrder);
    try {
      await setDoc(doc(db, "settings", "kanbanOrder"), { steps: newOrder });
    } catch (e) { console.warn("[kanbanOrder] save failed:", e); }
  };

  const resetColumnOrder = async () => {
    setColumnOrder(PRODUCTION_STEPS);
    try { await setDoc(doc(db, "settings", "kanbanOrder"), { steps: PRODUCTION_STEPS }); } catch(e){}
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
        {canReorder && (
          <button onClick={resetColumnOrder} title="กลับเป็นลำดับเริ่มต้น"
            style={{padding:"8px 12px",borderRadius:8,border:`1px solid ${T.border}`,background:"white",color:T.sub,cursor:"pointer",fontSize:11,fontFamily:"inherit"}}>↺ ลำดับเริ่มต้น</button>
        )}
      </div>

      {/* Kanban columns */}
      <div style={{display:"flex",gap:10,overflowX:"auto",paddingBottom:8,minHeight:480}}>
        {columnOrder.map((step, colIdx) => {
          const col = byStatus[step] || [];
          const color = STATUS_COLORS[step] || T.accent;
          const colTotal = col.reduce((s, l) => s + totalQtyOfLot(l), 0);
          const isCollapsed = collapsed[step];
          return (
            <div key={step} style={{flex:"0 0 240px",background:"#f8fafc",border:`1px solid ${T.border}`,borderRadius:12,padding:8,display:"flex",flexDirection:"column",maxHeight:"calc(100vh - 280px)"}}>
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
                </div>
              </div>
              {/* Cards */}
              {!isCollapsed && (
                <div style={{display:"flex",flexDirection:"column",gap:6,overflowY:"auto",flex:1}}>
                  {col.length === 0 ? (
                    <div style={{padding:20,textAlign:"center",fontSize:11,color:T.muted,fontStyle:"italic"}}>— ว่าง —</div>
                  ) : col.map(lot => (
                    <KanbanCard key={`${lot.orderId}-${lot.lotId}`} lot={lot} onClick={() => setSelected({ order: lot.orderRef, lotIdx: lot.lotIdx })}/>
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
          collectionName={collectionName}
          isCustom={isCustom}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

function KanbanCard({ lot, onClick }) {
  const total = totalQtyOfLot(lot);
  const colors = Array.from(new Set((lot.items || []).map(it => it.colorName)));
  return (
    <div onClick={onClick}
      style={{padding:"10px 12px",background:"white",border:`1px solid ${T.border}`,borderRadius:8,cursor:"pointer",boxShadow:"0 1px 3px rgba(0,0,0,0.04)",transition:"all 0.15s"}}
      onMouseEnter={e=>{e.currentTarget.style.boxShadow="0 4px 12px rgba(59,91,139,0.15)";e.currentTarget.style.borderColor="#3b5b8b";}}
      onMouseLeave={e=>{e.currentTarget.style.boxShadow="0 1px 3px rgba(0,0,0,0.04)";e.currentTarget.style.borderColor=T.border;}}>
      <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:5}}>
        <span style={{fontFamily:"monospace",fontSize:10,color:T.accent,fontWeight:700}}>{lot.prodNo}</span>
        <span style={{fontSize:10,color:T.muted}}>· {lot.lotId}</span>
        <span style={{marginLeft:"auto",fontFamily:"monospace",fontWeight:700,color:T.text,fontSize:13}}>{fmtInt(total)}</span>
      </div>
      <div style={{fontSize:12,fontWeight:600,color:T.text,marginBottom:4,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{lot.clothingName}</div>
      <div style={{display:"flex",flexWrap:"wrap",gap:3}}>
        {colors.slice(0,4).map((c,i) => (
          <span key={i} style={{padding:"2px 6px",fontSize:10,background:"rgba(59,91,139,0.08)",color:T.accent,borderRadius:8,border:"1px solid rgba(59,91,139,0.15)"}}>{c}</span>
        ))}
        {colors.length > 4 && <span style={{fontSize:10,color:T.muted}}>+{colors.length-4}</span>}
      </div>
      {(lot.notes || []).length > 0 && (
        <div style={{marginTop:6,padding:"4px 8px",background:"#fffbeb",border:"1px solid #fde68a",borderRadius:5,fontSize:10,color:"#92400e"}}>
          📝 {lot.notes.length} หมายเหตุ
        </div>
      )}
    </div>
  );
}
