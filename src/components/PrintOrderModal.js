import React from "react";
import { splitSizesIntoRows, getPriceForSize } from "../theme";

export default function PrintOrderModal({
  order,
  clothingItems = [],
  onClose,
  printElementById,
}) {
  if (!order) return null;
  return (
        <div className="print-modal-overlay" style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:400,backdropFilter:"blur(6px)"}}
          onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}>
          <div className="print-modal-card" onMouseDown={e=>e.stopPropagation()} style={{background:"white",borderRadius:16,padding:0,width:680,maxHeight:"90vh",overflowY:"auto",boxShadow:"0 24px 60px rgba(0,0,0,0.6)"}}>
            {/* Print content */}
            <div id="print-area" style={{padding:"32px 40px",fontFamily:"'Sarabun',sans-serif",color:"#1e293b"}}>
              {/* Header */}
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:24,paddingBottom:16,borderBottom:"2px solid #3b5b8b"}}>
                <div>
                  <div style={{fontSize:28,fontWeight:800,color:"#3b5b8b",letterSpacing:3,fontFamily:"monospace"}}>CPU</div>
                  <div style={{fontSize:11,color:"#64748b"}}>ระบบบริหารคลังสินค้า</div>
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontSize:20,fontWeight:700,color:"#1e293b"}}>ใบสั่งของ</div>
                  <div style={{fontSize:14,color:"#3b5b8b",fontFamily:"monospace",fontWeight:700}}>{order.orderNo}</div>
                  <div style={{fontSize:11,color:"#64748b",marginTop:4}}>{order.date}</div>
                </div>
              </div>

              {/* Customer info */}
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:24,padding:18,background:"#f8fafc",borderRadius:10,border:"1px solid #e2e8f0"}}>
                <div>
                  <div style={{fontSize:12,color:"#64748b",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:6}}>ลูกค้า</div>
                  <div style={{fontSize:17,fontWeight:700,color:"#1e293b"}}>{order.customerName}</div>
                  <div style={{fontSize:14,color:"#475569",marginTop:4}}>📞 {order.customerPhone||"-"}</div>
                </div>
                <div>
                  <div style={{fontSize:12,color:"#64748b",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:6}}>ที่อยู่จัดส่ง</div>
                  <div style={{fontSize:14,color:"#475569",lineHeight:1.6}}>{order.customerAddress||"-"}</div>
                  {order.shipping&&<div style={{fontSize:13,color:"#1e293b",marginTop:6,fontWeight:600}}>🚚 ขนส่ง: <span style={{color:"#3b5b8b"}}>{order.shipping}</span></div>}
                </div>
              </div>

              {/* Items table — Model | Color | SIZE+qty ×4 | จำนวน | ราคา(หน้าจอเท่านั้น) */}
              <div style={{overflowX:"auto",WebkitOverflowScrolling:"touch",marginBottom:20}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:14,minWidth:640}}>
                <thead>
                  <tr style={{background:"#3b5b8b",color:"white"}}>
                    <th style={{padding:"5px 4px",textAlign:"left",fontWeight:700,border:"1px solid #0284c7",fontSize:8,width:38,minWidth:38,whiteSpace:"nowrap"}}>รุ่น</th>
                    <th style={{padding:"5px 4px",textAlign:"left",fontWeight:700,border:"1px solid #0284c7",fontSize:8,width:56,minWidth:56,whiteSpace:"nowrap"}}>สี</th>
                    {[1,2,3,4].flatMap(i=>[
                      <th key={`sh${i}`} style={{padding:"8px 4px",textAlign:"center",fontWeight:700,border:"1px solid #0284c7",background:"#166534",color:"#bbf7d0",width:44,minWidth:44,fontSize:12,whiteSpace:"nowrap"}}>SIZE</th>,
                      <th key={`qh${i}`} style={{padding:"8px 4px",textAlign:"center",fontWeight:700,border:"1px solid #0284c7",width:40,minWidth:40,fontSize:12,whiteSpace:"nowrap"}}></th>
                    ])}
                    <th style={{padding:"9px 10px",textAlign:"center",fontWeight:700,border:"1px solid #0284c7",fontSize:13,width:72,minWidth:72,whiteSpace:"nowrap"}}>จำนวน</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.values((order.items||[]).reduce((acc,oi)=>{
                    const k=`${oi.clothingId||oi.clothingName}-${oi.colorIdx??""}|${oi.colorName||""}|${oi.variant||""}`;
                    if(!acc[k]) acc[k]={clothingName:oi.clothingName,colorName:oi.colorName,colorHex:oi.colorHex,clothingId:oi.clothingId,colorIdx:oi.colorIdx,variant:oi.variant||"",fabricType:oi.fabricType||"",collarType:oi.collarType||"",jobDescription:oi.jobDescription||"",items:[]};
                    acc[k].items.push(oi);
                    return acc;
                  },{})).flatMap((group,gi)=>{
                    // ✨ sort + group ด้วย helper (รองรับ 2XL-9XL, 6XL/7XL)
                    const withSize = group.items.filter(i => i.size);
                    const rows = splitSizesIntoRows(withSize, 4, { fillPlus: false });
                    if(rows.length===0) rows.push([]);
                    const totalQty=group.items.reduce((s,i)=>s+i.qty,0);
                    // คำนวณราคารวมของ group นี้ (qty × salePrice ตามไซส์)
                    const clothingItem = clothingItems.find(ci=>ci.id===group.clothingId);
                    const colorData = clothingItem?.colors?.[group.colorIdx];
                    const groupTotalPrice = group.items.reduce((s,oi) => s + oi.qty * (getPriceForSize(colorData, oi.size) || 0), 0);
                    const lastIdx=rows.length-1;
                    return rows.map((chunk,ci)=>(
                      <tr key={`${gi}-${ci}`} style={{borderBottom:"1px solid #e2e8f0",background:gi%2===0?"white":"#f8fafc"}}>
                        <td style={{padding:"5px 4px",fontWeight:600,color:"#1e293b",verticalAlign:"middle",border:"1px solid #e2e8f0",fontSize:8,width:38,whiteSpace:"nowrap"}}>{ci===0&&<div><div>{group.clothingName}</div>{(group.fabricType||group.collarType||group.jobDescription)&&<div style={{fontSize:7,color:"#64748b",fontWeight:400,marginTop:2,display:"flex",flexWrap:"wrap",gap:2}}>{group.fabricType&&<span>🧵 {group.fabricType}</span>}{group.collarType&&<span>· 👔 {group.collarType}</span>}{group.jobDescription&&<span>· {group.jobDescription}</span>}</div>}</div>}</td>
                        <td style={{padding:"5px 4px",verticalAlign:"middle",border:"1px solid #e2e8f0",fontSize:8,width:56,whiteSpace:"nowrap"}}>
                          {ci===0&&<div style={{display:"flex",alignItems:"center",gap:3}}>
                            <div style={{width:6,height:6,borderRadius:2,background:group.colorHex,border:"1px solid rgba(0,0,0,0.15)",flexShrink:0}}/>
                            <span>{group.colorName}{group.variant?` (${group.variant})`:""}</span>
                          </div>}
                        </td>
                        {chunk.map(oi=>[
                          <td key={`s-${oi.size}`} style={{padding:"8px 4px",textAlign:"center",fontFamily:"monospace",fontWeight:700,color:"#3b5b8b",border:"1px solid #e2e8f0",background:"rgba(219,234,254,0.4)",fontSize:14,width:44,minWidth:44,whiteSpace:"nowrap"}}>{oi.size}</td>,
                          <td key={`q-${oi.size}`} style={{padding:"8px 4px",textAlign:"center",fontFamily:"monospace",fontWeight:700,color:"#059669",border:"1px solid #e2e8f0",fontSize:14,width:40,minWidth:40,whiteSpace:"nowrap"}}>{oi.qty}</td>
                        ])}
                        {Array(4-chunk.length).fill(null).flatMap((_,i)=>[
                          <td key={`e1-${ci}-${i}`} style={{border:"1px solid #e2e8f0",background:"#fafafa"}}/>,
                          <td key={`e2-${ci}-${i}`} style={{border:"1px solid #e2e8f0",background:"#fafafa"}}/>
                        ])}
                        <td style={{padding:"9px 10px",textAlign:"center",fontFamily:"monospace",fontWeight:700,fontSize:16,color:"#3b5b8b",verticalAlign:"middle",border:"1px solid #e2e8f0",width:72,minWidth:72,whiteSpace:"nowrap"}}>{ci===lastIdx?totalQty:""}</td>
                      </tr>
                    ));
                  })}
                </tbody>
                <tfoot>
                  <tr style={{background:"#f1f5f9",fontWeight:700}}>
                    <td colSpan={10} style={{padding:"11px 14px",textAlign:"right",color:"#475569",fontSize:13}}>รวมทั้งหมด</td>
                    <td style={{padding:"11px 14px",textAlign:"center",fontFamily:"monospace",fontSize:16,color:"#3b5b8b",border:"1px solid #e2e8f0",width:72,minWidth:72,whiteSpace:"nowrap"}}>{(order.items||[]).reduce((s,i)=>s+i.qty,0)} ชิ้น</td>
                  </tr>
                </tfoot>
              </table>
              </div>

              {order.note&&<div style={{padding:12,background:"#fffbeb",border:"1px solid #fde68a",borderRadius:8,fontSize:12,color:"#92400e",marginBottom:16}}>📝 หมายเหตุ: {order.note}</div>}

              <div style={{display:"flex",justifyContent:"space-between",marginTop:32,paddingTop:16,borderTop:"1px solid #e2e8f0",fontSize:11,color:"#94a3b8"}}>
                <div>ผู้สั่ง: {order.by}</div>
                <div>สถานะ: {order.status}</div>
              </div>
            </div>

            {/* Print buttons */}
            <div className="print-hide" style={{padding:"16px 24px",borderTop:"1px solid #e2e8f0",display:"flex",gap:10,justifyContent:"flex-end",background:"#f8fafc",borderRadius:"0 0 16px 16px"}}>
              <button onClick={()=>onClose()} style={{padding:"9px 20px",borderRadius:9,border:"1px solid #e2e8f0",background:"white",color:"#64748b",fontSize:13,cursor:"pointer",fontFamily:"'Sarabun',sans-serif"}}>ปิด</button>
              <button onClick={()=>printElementById("print-area")} style={{padding:"9px 20px",borderRadius:9,border:"none",background:"linear-gradient(135deg,#3b5b8b,#3b5b8b)",color:"white",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",boxShadow:"0 4px 14px rgba(59,91,139,0.3)"}}>🖨️ สั่งปริ้น</button>
            </div>
          </div>
        </div>
  );
}
