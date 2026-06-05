import React, { useState, useMemo } from "react";
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
      </div>

      {/* Kanban columns */}
      <div style={{display:"flex",gap:10,overflowX:"auto",paddingBottom:8,minHeight:480}}>
        {PRODUCTION_STEPS.map(step => {
          const col = byStatus[step] || [];
          const color = STATUS_COLORS[step] || T.accent;
          const colTotal = col.reduce((s, l) => s + totalQtyOfLot(l), 0);
          const isCollapsed = collapsed[step];
          return (
            <div key={step} style={{flex:"0 0 240px",background:"#f8fafc",border:`1px solid ${T.border}`,borderRadius:12,padding:8,display:"flex",flexDirection:"column",maxHeight:"calc(100vh - 280px)"}}>
              {/* Column header */}
              <div onClick={() => setCollapsed(p => ({...p, [step]: !p[step]}))}
                style={{padding:"8px 10px",borderRadius:8,background:color+"15",border:`1px solid ${color}30`,marginBottom:8,cursor:"pointer",userSelect:"none"}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                  <span style={{fontSize:12,fontWeight:700,color}}>{step}</span>
                  <span style={{fontSize:11,color:T.sub}}>{col.length} ล็อต · {fmtInt(colTotal)} ตัว</span>
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
