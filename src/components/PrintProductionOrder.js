import React from "react";

const fmt = (n) => Number(n || 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtInt = (n) => Number(n || 0).toLocaleString("th-TH");

export default function PrintProductionOrder({ order, companyInfo = {}, onClose, onPrint }) {
  if (!order) return null;
  return (
    <div className="print-modal-overlay" style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:400,backdropFilter:"blur(6px)"}}
      onMouseDown={e=>{if(e.target===e.currentTarget)onClose&&onClose();}}>
      <div className="print-modal-card" onMouseDown={e=>e.stopPropagation()} style={{background:"white",borderRadius:16,padding:0,width:760,maxHeight:"94vh",overflowY:"auto",boxShadow:"0 24px 60px rgba(0,0,0,0.6)"}}>
        <div id="prod-print-area" style={{padding:"36px 44px",fontFamily:"'Sarabun',sans-serif",color:"#1e293b"}}>
          {/* Header */}
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:20,paddingBottom:18,borderBottom:"3px solid #3b5b8b"}}>
            <div style={{flex:1}}>
              <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:6}}>
                <div style={{width:54,height:54,borderRadius:10,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,overflow:"hidden",background:"white"}}>
                  <img src={`${process.env.PUBLIC_URL}/cpu-logo.png`} alt="CPU" style={{width:"100%",height:"100%",objectFit:"contain"}}/>
                </div>
                <div>
                  <div style={{fontSize:20,fontWeight:800,color:"#3b5b8b",letterSpacing:2}}>{companyInfo.name||"CPU"}</div>
                </div>
              </div>
              {companyInfo.address&&<div style={{fontSize:11,color:"#475569",marginBottom:2,maxWidth:280,lineHeight:1.6}}>{companyInfo.address}</div>}
              {companyInfo.phone&&<div style={{fontSize:11,color:"#475569"}}>โทร: {companyInfo.phone}</div>}
            </div>
            <div style={{textAlign:"right",minWidth:220}}>
              <div style={{display:"inline-block",background:"#3b5b8b",color:"white",padding:"6px 22px",borderRadius:6,fontSize:16,fontWeight:800,marginBottom:10,letterSpacing:1}}>
                ใบสั่งผลิต
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:5}}>
                <div style={{display:"flex",justifyContent:"flex-end",gap:10}}>
                  <span style={{fontSize:13,color:"#64748b",fontWeight:500}}>เลขที่:</span>
                  <span style={{fontSize:15,color:"#3b5b8b",fontFamily:"monospace",fontWeight:700}}>{order.prodNo}</span>
                </div>
                <div style={{display:"flex",justifyContent:"flex-end",gap:10}}>
                  <span style={{fontSize:13,color:"#64748b",fontWeight:500}}>วันที่:</span>
                  <span style={{fontSize:14,color:"#1e293b",fontWeight:600}}>{order.date}</span>
                </div>
                <div style={{display:"flex",justifyContent:"flex-end",gap:10}}>
                  <span style={{fontSize:13,color:"#64748b",fontWeight:500}}>สถานะ:</span>
                  <span style={{fontSize:14,color:"#16a34a",fontWeight:700}}>{order.status}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Clothing info */}
          <div style={{padding:"16px 20px",background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:10,marginBottom:16,display:"flex",alignItems:"center",gap:16}}>
            {order.clothingImage && <img src={order.clothingImage} alt="" style={{width:80,height:80,borderRadius:8,objectFit:"cover",border:"1px solid #e2e8f0"}}/>}
            <div style={{flex:1}}>
              <div style={{fontSize:11,color:"#3b5b8b",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:6}}>รุ่นสินค้า</div>
              <div style={{fontSize:18,fontWeight:700,color:"#1e293b"}}>{order.clothingName}</div>
              <div style={{fontSize:13,color:"#475569",marginTop:4}}>รวมทั้งหมด <b style={{color:"#3b5b8b"}}>{fmtInt(order.totalQty)}</b> ตัว</div>
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

          {/* Materials */}
          {order.costSnapshot?.materials?.length > 0 && (
            <div style={{marginBottom:18}}>
              <div style={{fontSize:14,fontWeight:700,color:"#3b5b8b",marginBottom:8}}>🧪 วัตถุดิบที่ต้องใช้</div>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
                <thead>
                  <tr style={{background:"#f1f5f9"}}>
                    <th style={{padding:"8px 10px",textAlign:"left",border:"1px solid #e2e8f0",fontSize:12,color:"#475569"}}>วัตถุดิบ</th>
                    <th style={{padding:"8px 10px",textAlign:"right",border:"1px solid #e2e8f0",fontSize:12,color:"#475569",width:100}}>ใช้/ตัว</th>
                    <th style={{padding:"8px 10px",textAlign:"right",border:"1px solid #e2e8f0",fontSize:12,color:"#475569",width:120}}>รวม</th>
                    <th style={{padding:"8px 10px",textAlign:"right",border:"1px solid #e2e8f0",fontSize:12,color:"#475569",width:120}}>มูลค่า (฿)</th>
                  </tr>
                </thead>
                <tbody>
                  {order.costSnapshot.materials.map((m,i) => (
                    <tr key={i}>
                      <td style={{padding:"8px 10px",border:"1px solid #e2e8f0"}}>{m.productName}</td>
                      <td style={{padding:"8px 10px",textAlign:"right",fontFamily:"monospace",border:"1px solid #e2e8f0"}}>{fmt(m.qtyPerPiece)} {m.unit}</td>
                      <td style={{padding:"8px 10px",textAlign:"right",fontFamily:"monospace",fontWeight:700,border:"1px solid #e2e8f0"}}>{fmtInt(m.totalQty)} {m.unit}</td>
                      <td style={{padding:"8px 10px",textAlign:"right",fontFamily:"monospace",border:"1px solid #e2e8f0"}}>{fmt(m.totalCost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Cost summary */}
          {order.costSnapshot && (
            <div style={{padding:"14px 18px",background:"linear-gradient(135deg,rgba(59,91,139,0.06),rgba(16,185,129,0.06))",border:"1px solid #e2e8f0",borderRadius:10,marginBottom:18}}>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,fontSize:13}}>
                <div><div style={{color:"#64748b",fontSize:11}}>ค่าวัตถุดิบ/ตัว</div><div style={{fontFamily:"monospace",fontWeight:700,fontSize:15}}>฿{fmt(order.costSnapshot.materialCostPerPiece)}</div></div>
                <div><div style={{color:"#64748b",fontSize:11}}>ค่าแรง/ตัว</div><div style={{fontFamily:"monospace",fontWeight:700,fontSize:15}}>฿{fmt(order.costSnapshot.laborCostPerPiece)}</div></div>
                <div><div style={{color:"#64748b",fontSize:11}}>ต้นทุน/ตัว</div><div style={{fontFamily:"monospace",fontWeight:700,fontSize:15,color:"#3b5b8b"}}>฿{fmt(order.costSnapshot.totalCostPerPiece)}</div></div>
                <div><div style={{color:"#64748b",fontSize:11}}>ต้นทุนรวม</div><div style={{fontFamily:"monospace",fontWeight:800,fontSize:18,color:"#3b5b8b"}}>฿{fmt(order.costSnapshot.grandTotal)}</div></div>
              </div>
            </div>
          )}

          {order.note && (
            <div style={{padding:"10px 14px",background:"#fffbeb",border:"1px solid #fde68a",borderRadius:8,fontSize:13,color:"#78350f",marginBottom:16}}>
              <b>หมายเหตุ:</b> {order.note}
            </div>
          )}

          {/* signatures */}
          <div style={{marginTop:32,paddingTop:16,borderTop:"1px solid #e2e8f0"}}>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:24}}>
              <div style={{textAlign:"center"}}>
                <div style={{height:48,borderBottom:"1px dashed #cbd5e1",marginBottom:6}}/>
                <div style={{fontSize:12,fontWeight:700,color:"#475569"}}>ผู้สั่งผลิต</div>
                <div style={{fontSize:11,color:"#94a3b8",marginTop:2}}>{order.by}</div>
              </div>
              <div style={{textAlign:"center"}}>
                <div style={{height:48,borderBottom:"1px dashed #cbd5e1",marginBottom:6}}/>
                <div style={{fontSize:12,fontWeight:700,color:"#475569"}}>ผู้รับงาน</div>
              </div>
            </div>
          </div>
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
