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

  // 1 รายการ = 1 แถว (สี · ไซส์ · จำนวน) — รวมเฉพาะที่ key เดียวกันให้เป็นแถวเดียว
  // คงลำดับตามที่ user กรอกในขั้น "แบ่งม้วน"
  const flatRows = (() => {
    const map = new Map();
    (lot.items || []).forEach(it => {
      const pSize = it.productionSize || it.size || "-";
      const key = [it.colorName || "-", it.colorHex || "#999", pSize, it.variant || ""].join("|");
      if (map.has(key)) {
        map.get(key).qty += Number(it.qty) || 0;
      } else {
        map.set(key, {
          colorName: it.colorName || "-",
          colorHex: it.colorHex || "#999",
          size: pSize,
          variant: it.variant || "",
          qty: Number(it.qty) || 0,
        });
      }
    });
    // 🔄 กลับลำดับ — ปริ้นจากข้างล่างขึ้นข้างบน (สำหรับลำดับงานจริง)
    return Array.from(map.values()).reverse();
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

          {/* Items breakdown — 1 แถว = สี · ไซส์ · จำนวน (คงลำดับตามที่กรอก) */}
          <div style={{fontSize:9,color:"#475569",fontWeight:700,marginBottom:3,textTransform:"uppercase",letterSpacing:"0.05em"}}>📋 ลำดับการพิมพ์ ({flatRows.length} รายการ)</div>
          <div style={{marginBottom:5,border:"1px solid #000",borderRadius:4,overflow:"hidden"}}>
            {/* header */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 16mm 18mm",background:"#1e293b",color:"white",padding:"3px 6px",fontSize:9,fontWeight:700,letterSpacing:"0.05em"}}>
              <span>สี</span>
              <span style={{textAlign:"center"}}>ไซส์</span>
              <span style={{textAlign:"right"}}>จำนวน</span>
            </div>
            {flatRows.length === 0 ? (
              <div style={{padding:8,textAlign:"center",color:"#94a3b8",fontStyle:"italic",fontSize:10}}>— ไม่มีรายการ —</div>
            ) : flatRows.map((r, i) => (
              <div key={i} style={{
                display:"grid",
                gridTemplateColumns:"1fr 16mm 18mm",
                alignItems:"center",
                padding:"3px 6px",
                fontSize:11,
                borderBottom: i < flatRows.length - 1 ? "1px solid #cbd5e1" : "none",
                background: i % 2 === 0 ? "white" : "#f8fafc",
              }}>
                <span style={{display:"flex",alignItems:"center",gap:5,minWidth:0}}>
                  <span style={{width:10,height:10,borderRadius:2,background:r.colorHex,border:"1px solid #000",flexShrink:0}}/>
                  <span style={{fontWeight:700,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.colorName}</span>
                  {r.variant && <span style={{fontSize:9,color:"#475569",fontStyle:"italic"}}>({r.variant})</span>}
                </span>
                <span style={{textAlign:"center",fontFamily:"monospace",fontWeight:700,color:"#0c4a6e"}}>{r.size}</span>
                <span style={{textAlign:"right",fontFamily:"monospace",fontWeight:800}}>{fmtInt(r.qty)}</span>
              </div>
            ))}
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
