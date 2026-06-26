import React from "react";
import { Modal, MHead, BtnPrimary, BtnGhost } from "./ui";
import { totalQtyOfLot, getMachineForCurrentStage, STATUS_COLORS } from "../utils/productionLots";

const fmtInt = (n) => Number(n || 0).toLocaleString("th-TH");

// ป้ายม้วนกระดาษ — สติ๊กเกอร์ 100×150mm (XP-480B)
// แสดง: เลขใบสั่ง / ม้วน / ลูกค้า / รายการสี+ไซส์ / รวม / เครื่อง / วันที่
export default function PrintRollLabel({ order, lot, onClose, onPrint, companyInfo = {} }) {
  if (!order || !lot) return null;

  const total = totalQtyOfLot(lot);
  const machine = getMachineForCurrentStage(lot);
  const stageColor = STATUS_COLORS[lot.status] || "#475569";

  // 🩹 group items by SIZE first → ใต้แต่ละไซส์มี list ของ (สี, จำนวน)
  // ใช้สำหรับ workflow โรงพิมพ์: พิมพ์ไซส์เดียวกันต่อกันก่อน เปลี่ยนไซส์ทีหลัง
  const sizeGroups = (() => {
    const map = new Map();
    (lot.items || []).forEach(it => {
      const pSize = it.productionSize || it.size || "-";
      const sKey = pSize + "|" + (it.variant || "");
      if (!map.has(sKey)) {
        map.set(sKey, {
          size: pSize,
          variant: it.variant || "",
          colors: [],
        });
      }
      const cKey = (it.colorName || "-") + "|" + (it.colorHex || "#999");
      const existing = map.get(sKey).colors.find(c => c.key === cKey);
      if (existing) {
        existing.qty += Number(it.qty) || 0;
      } else {
        map.get(sKey).colors.push({
          key: cKey,
          colorName: it.colorName || "-",
          colorHex: it.colorHex || "#999",
          qty: Number(it.qty) || 0,
        });
      }
    });
    // คงลำดับตามที่ user กรอก (ไม่ sort — ลำดับสะท้อนแผนการพิมพ์จริง)
    return Array.from(map.values());
  })();

  return (
    <div className="print-modal-overlay" style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:500,backdropFilter:"blur(6px)"}}
      onMouseDown={e=>{if(e.target===e.currentTarget) onClose && onClose();}}>
      <div onMouseDown={e=>e.stopPropagation()} style={{background:"white",borderRadius:14,padding:0,width:420,maxHeight:"94vh",overflowY:"auto",boxShadow:"0 24px 60px rgba(0,0,0,0.5)"}}>
        {/* การ์ดตัวอย่าง (preview) — ขนาดจริงตอนพิมพ์ = 100×150mm */}
        <div id="roll-label-area" style={{
          padding:"6mm 5mm",
          fontFamily:"'Sarabun',sans-serif",
          color:"#000",
          width:"100mm",
          minHeight:"138mm",
          boxSizing:"border-box",
          background:"white",
          margin:"10px auto",
          border:"1px dashed #94a3b8",
        }}>
          {/* Header — เลข PRD + ม้วน */}
          <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:5,paddingBottom:4,borderBottom:"2px solid #000"}}>
            <img src={`${process.env.PUBLIC_URL}/cpu-logo.png`} alt="" style={{width:32,height:32,objectFit:"contain"}}/>
            <div style={{flex:1}}>
              <div style={{fontSize:14,fontWeight:800,fontFamily:"monospace",letterSpacing:0.5}}>{order.prodNo || "-"}</div>
              <div style={{fontSize:18,fontWeight:900,color:"#000",marginTop:1,letterSpacing:1}}>📦 {lot.lotId || "L?"}</div>
            </div>
          </div>

          {/* Customer / job name */}
          <div style={{marginBottom:6,padding:"4px 6px",background:"#f1f5f9",border:"1px solid #cbd5e1",borderRadius:4}}>
            <div style={{fontSize:9,color:"#475569",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.06em"}}>ลูกค้า / งาน</div>
            <div style={{fontSize:14,fontWeight:800,color:"#000",marginTop:1,lineHeight:1.2}}>{order.customerName || order.clothingName || "-"}</div>
            {order.clothingName && order.customerName && (
              <div style={{fontSize:10,color:"#475569",marginTop:1}}>รุ่น: {order.clothingName}</div>
            )}
          </div>

          {/* Stage + Machine + Total — แถวหลัก */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:4,marginBottom:6}}>
            <div style={{padding:"4px 6px",border:`1.5px solid ${stageColor}`,borderRadius:4,background:`${stageColor}10`}}>
              <div style={{fontSize:8,color:"#475569",fontWeight:600}}>สถานะ</div>
              <div style={{fontSize:11,fontWeight:800,color:stageColor,marginTop:1}}>{lot.status || "-"}</div>
              {machine && <div style={{fontSize:10,color:"#000",fontWeight:700,marginTop:1}}>🏭 {machine}</div>}
            </div>
            <div style={{padding:"4px 6px",border:"2px solid #000",borderRadius:4,background:"#fffbeb"}}>
              <div style={{fontSize:8,color:"#92400e",fontWeight:600}}>จำนวนรวม</div>
              <div style={{fontSize:18,fontWeight:900,color:"#000",fontFamily:"monospace",lineHeight:1.1}}>{fmtInt(total)}</div>
              <div style={{fontSize:9,color:"#92400e"}}>ตัว</div>
            </div>
          </div>

          {/* Items breakdown — group ตามไซส์ (เรียงลำดับ S→XL→...) ใต้แต่ละไซส์มี "สี - จำนวน" */}
          <div style={{fontSize:9,color:"#475569",fontWeight:700,marginBottom:3,textTransform:"uppercase",letterSpacing:"0.05em"}}>📋 ลำดับการพิมพ์ ({sizeGroups.length} ไซส์)</div>
          <div style={{marginBottom:5,border:"1px solid #94a3b8",borderRadius:4,overflow:"hidden"}}>
            {sizeGroups.length === 0 ? (
              <div style={{padding:8,textAlign:"center",color:"#94a3b8",fontStyle:"italic",fontSize:10}}>— ไม่มีรายการ —</div>
            ) : sizeGroups.map((g, i) => {
              const groupTotal = g.colors.reduce((s, c) => s + c.qty, 0);
              return (
                <div key={i} style={{
                  borderBottom: i < sizeGroups.length - 1 ? "2px solid #94a3b8" : "none",
                  background: i % 2 === 0 ? "white" : "#f8fafc",
                }}>
                  {/* size header */}
                  <div style={{padding:"3px 6px",background:"#1e293b",color:"white",display:"flex",justifyContent:"space-between",alignItems:"baseline"}}>
                    <span style={{fontSize:12,fontWeight:800,fontFamily:"monospace",letterSpacing:0.5}}>
                      🧵 {g.size}
                      {g.variant && <span style={{fontSize:9,fontFamily:"'Sarabun',sans-serif",fontStyle:"italic",fontWeight:500,marginLeft:5,opacity:0.85}}>({g.variant})</span>}
                    </span>
                    <span style={{fontSize:10,fontFamily:"monospace",fontWeight:700,opacity:0.95}}>รวม {fmtInt(groupTotal)}</span>
                  </div>
                  {/* colors under this size */}
                  <div style={{padding:"3px 8px"}}>
                    {g.colors.map((c, j) => (
                      <div key={j} style={{display:"flex",alignItems:"center",gap:5,padding:"1px 0",fontSize:11}}>
                        <span style={{width:9,height:9,borderRadius:1,background:c.colorHex,border:"1px solid #000",flexShrink:0}}/>
                        <span style={{flex:1,fontWeight:600}}>{c.colorName}</span>
                        <span style={{color:"#475569"}}>—</span>
                        <span style={{fontFamily:"monospace",fontWeight:800,minWidth:"14mm",textAlign:"right"}}>{fmtInt(c.qty)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Note (ถ้ามี) */}
          {order.note && (
            <div style={{padding:"3px 6px",background:"#fffbeb",border:"1px solid #fde68a",borderRadius:4,fontSize:9,marginBottom:4}}>
              📝 {order.note}
            </div>
          )}

          {/* Footer — date + by */}
          <div style={{marginTop:"auto",paddingTop:4,borderTop:"1px solid #cbd5e1",fontSize:8,color:"#475569",display:"flex",justifyContent:"space-between"}}>
            <span>📅 {order.date || "-"}</span>
            <span>{companyInfo.name || "CPU"}</span>
          </div>
        </div>

        {/* Action bar */}
        <div style={{padding:"12px 18px",background:"#f8fafc",borderTop:"1px solid #e2e8f0",display:"flex",justifyContent:"space-between",alignItems:"center",gap:10}}>
          <div style={{fontSize:11,color:"#64748b"}}>🖨️ XP-480B · 100×150mm</div>
          <div style={{display:"flex",gap:8}}>
            <BtnGhost onClick={onClose}>ปิด</BtnGhost>
            <BtnPrimary onClick={() => onPrint && onPrint("roll-label-area", "100mm 150mm", "2mm")}>🖨️ พิมพ์</BtnPrimary>
          </div>
        </div>
      </div>
    </div>
  );
}
