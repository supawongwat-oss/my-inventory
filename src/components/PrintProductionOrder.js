import React from "react";

const fmt = (n) => Number(n || 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtInt = (n) => Number(n || 0).toLocaleString("th-TH");

export default function PrintProductionOrder({ order, companyInfo = {}, onClose, onPrint }) {
  if (!order) return null;
  return (
    <div className="print-modal-overlay" style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:400,backdropFilter:"blur(6px)"}}
      onMouseDown={e=>{if(e.target===e.currentTarget)onClose&&onClose();}}>
      <div className="print-modal-card" onMouseDown={e=>e.stopPropagation()} style={{background:"white",borderRadius:16,padding:0,width:760,maxHeight:"94vh",overflowY:"auto",boxShadow:"0 24px 60px rgba(0,0,0,0.6)"}}>
        <div id="prod-print-area" style={{padding:"22px 32px",fontFamily:"'Sarabun',sans-serif",color:"#1e293b"}}>
          {/* Header (เล็กลง) */}
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12,paddingBottom:8,borderBottom:"2px solid #3b5b8b"}}>
            <div style={{flex:1,display:"flex",alignItems:"center",gap:8}}>
              <div style={{width:36,height:36,borderRadius:6,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,overflow:"hidden",background:"white"}}>
                <img src={`${process.env.PUBLIC_URL}/cpu-logo.png`} alt="CPU" style={{width:"100%",height:"100%",objectFit:"contain"}}/>
              </div>
              <div>
                <div style={{fontSize:16,fontWeight:800,color:"#3b5b8b",letterSpacing:1}}>{companyInfo.name||"CPU"}</div>
                {companyInfo.phone&&<div style={{fontSize:9,color:"#64748b"}}>โทร: {companyInfo.phone}</div>}
              </div>
            </div>
            <div style={{textAlign:"right"}}>
              <div style={{display:"inline-block",background:"#3b5b8b",color:"white",padding:"3px 14px",borderRadius:4,fontSize:12,fontWeight:800,marginBottom:4,letterSpacing:0.5}}>
                ใบสั่งผลิต
              </div>
              <div style={{display:"flex",justifyContent:"flex-end",gap:6,fontSize:10,color:"#64748b"}}>
                <span>เลขที่:</span>
                <span style={{color:"#3b5b8b",fontFamily:"monospace",fontWeight:700}}>{order.prodNo}</span>
              </div>
              <div style={{display:"flex",justifyContent:"flex-end",gap:6,fontSize:10,color:"#64748b"}}>
                <span>วันที่:</span>
                <span style={{color:"#1e293b",fontWeight:600}}>{order.date}</span>
              </div>
              <div style={{display:"flex",justifyContent:"flex-end",gap:6,fontSize:10,color:"#64748b"}}>
                <span>สถานะ:</span>
                <span style={{color:"#16a34a",fontWeight:700}}>{order.status}</span>
              </div>
            </div>
          </div>

          {/* Clothing info (รูปขยาย 200%) */}
          <div style={{padding:"12px 16px",background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:10,marginBottom:14,display:"flex",alignItems:"center",gap:18}}>
            {order.clothingImage && <img src={order.clothingImage} alt="" style={{width:160,height:160,borderRadius:10,objectFit:"cover",border:"1px solid #e2e8f0"}}/>}
            <div style={{flex:1}}>
              <div style={{fontSize:10,color:"#3b5b8b",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:4}}>รุ่นสินค้า</div>
              <div style={{fontSize:20,fontWeight:700,color:"#1e293b"}}>{order.clothingName}</div>
              <div style={{fontSize:13,color:"#475569",marginTop:4}}>รวมทั้งหมด <b style={{color:"#3b5b8b",fontSize:16}}>{fmtInt(order.totalQty)}</b> ตัว</div>
            </div>
          </div>

          {/* Items table */}
          <table style={{width:"100%",borderCollapse:"collapse",marginBottom:18,fontSize:14}}>
            <thead>
              <tr style={{background:"#3b5b8b",color:"white"}}>
                <th style={{padding:"9px 10px",textAlign:"left",fontWeight:700,border:"1px solid #0284c7",fontSize:13}}>สี</th>
                <th style={{padding:"9px 10px",textAlign:"center",fontWeight:700,border:"1px solid #0284c7",fontSize:13}}>ไซส์</th>
                <th style={{padding:"9px 10px",textAlign:"center",fontWeight:700,border:"1px solid #0284c7",fontSize:13}}>จำนวน</th>
              </tr>
            </thead>
            <tbody>
              {(order.items||[]).map((it, i) => (
                <tr key={i} style={{background:i%2===0?"white":"#f8fafc"}}>
                  <td style={{padding:"9px 10px",border:"1px solid #e2e8f0",fontSize:14}}>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <div style={{width:14,height:14,borderRadius:3,background:it.colorHex||"#999",border:"1px solid rgba(0,0,0,0.15)"}}/>
                      <span>{it.colorName}</span>
                    </div>
                  </td>
                  <td style={{padding:"9px 10px",textAlign:"center",fontFamily:"monospace",fontWeight:700,color:"#3b5b8b",border:"1px solid #e2e8f0",fontSize:14}}>{it.size}</td>
                  <td style={{padding:"9px 10px",textAlign:"center",fontFamily:"monospace",fontWeight:700,fontSize:16,color:"#059669",border:"1px solid #e2e8f0"}}>{fmtInt(it.qty)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{background:"#f1f5f9",fontWeight:700}}>
                <td colSpan={2} style={{padding:"11px 14px",textAlign:"right",color:"#475569",fontSize:14}}>รวมทั้งหมด</td>
                <td style={{padding:"11px 14px",textAlign:"center",fontFamily:"monospace",fontSize:16,color:"#3b5b8b",border:"1px solid #e2e8f0"}}>{fmtInt(order.totalQty)} ตัว</td>
              </tr>
            </tfoot>
          </table>

          {/* Materials (ไม่มีคอลัมน์ราคา/มูลค่า — ใบสั่งผลิตให้ทีมผลิต) */}
          {order.costSnapshot?.materials?.length > 0 && (
            <div style={{marginBottom:18}}>
              <div style={{fontSize:14,fontWeight:700,color:"#3b5b8b",marginBottom:8}}>🧪 วัตถุดิบที่ต้องใช้</div>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
                <thead>
                  <tr style={{background:"#f1f5f9"}}>
                    <th style={{padding:"8px 10px",textAlign:"left",border:"1px solid #e2e8f0",fontSize:12,color:"#475569"}}>วัตถุดิบ</th>
                    <th style={{padding:"8px 10px",textAlign:"right",border:"1px solid #e2e8f0",fontSize:12,color:"#475569",width:110}}>ใช้/ตัว</th>
                    <th style={{padding:"8px 10px",textAlign:"right",border:"1px solid #e2e8f0",fontSize:12,color:"#475569",width:140}}>รวม</th>
                  </tr>
                </thead>
                <tbody>
                  {order.costSnapshot.materials.map((m,i) => (
                    <tr key={i}>
                      <td style={{padding:"8px 10px",border:"1px solid #e2e8f0"}}>{m.productName}</td>
                      <td style={{padding:"8px 10px",textAlign:"right",fontFamily:"monospace",border:"1px solid #e2e8f0"}}>{fmt(m.qtyPerPiece)} {m.unit}</td>
                      <td style={{padding:"8px 10px",textAlign:"right",fontFamily:"monospace",fontWeight:700,border:"1px solid #e2e8f0"}}>{fmtInt(m.totalQty)} {m.unit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {order.note && (
            <div style={{padding:"10px 14px",background:"#fffbeb",border:"1px solid #fde68a",borderRadius:8,fontSize:13,color:"#78350f",marginBottom:8}}>
              <b>หมายเหตุ:</b> {order.note}
            </div>
          )}
        </div>

        {/* Action bar */}
        <div style={{padding:"12px 24px",background:"#f8fafc",borderTop:"1px solid #e2e8f0",display:"flex",justifyContent:"flex-end",gap:10}}>
          <button onClick={onClose} style={{padding:"9px 16px",borderRadius:9,border:"1px solid #e2e8f0",background:"white",color:"#64748b",fontSize:13,cursor:"pointer",fontFamily:"'Sarabun',sans-serif"}}>ปิด</button>
          <button onClick={() => onPrint && onPrint("prod-print-area")} style={{padding:"9px 16px",borderRadius:9,border:"none",background:"linear-gradient(135deg,#3b5b8b,#3b5b8b)",color:"white",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",boxShadow:"0 4px 14px rgba(59,91,139,0.3)"}}>🖨️ พิมพ์</button>
        </div>
      </div>
    </div>
  );
}
