import React from "react";
import { splitSizesIntoRows } from "../theme";

const fmt = (n) => Number(n || 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtInt = (n) => Number(n || 0).toLocaleString("th-TH");

export default function PrintProductionOrder({ order, companyInfo = {}, onClose, onPrint }) {
  if (!order) return null;
  return (
    <div className="print-modal-overlay" style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:400,backdropFilter:"blur(6px)"}}
      onMouseDown={e=>{if(e.target===e.currentTarget)onClose&&onClose();}}>
      <div className="print-modal-card" onMouseDown={e=>e.stopPropagation()} style={{background:"white",borderRadius:16,padding:0,width:760,maxHeight:"94vh",overflowY:"auto",boxShadow:"0 24px 60px rgba(0,0,0,0.6)"}}>
        <div id="prod-print-area" style={{padding:"14px 24px",fontFamily:"'Sarabun',sans-serif",color:"#1e293b"}}>
          {/* Header (เล็กลงอีก — 1 บรรทัด) */}
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8,paddingBottom:5,borderBottom:"2px solid #3b5b8b"}}>
            <div style={{display:"flex",alignItems:"center",gap:6}}>
              <div style={{width:26,height:26,borderRadius:4,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,overflow:"hidden",background:"white"}}>
                <img src={`${process.env.PUBLIC_URL}/cpu-logo.png`} alt="CPU" style={{width:"100%",height:"100%",objectFit:"contain"}}/>
              </div>
              <span style={{fontSize:13,fontWeight:800,color:"#3b5b8b",letterSpacing:0.5}}>{companyInfo.name||"CPU"}</span>
              {companyInfo.phone&&<span style={{fontSize:9,color:"#64748b",marginLeft:6}}>· โทร {companyInfo.phone}</span>}
            </div>
            <div style={{display:"flex",alignItems:"center",gap:8,fontSize:10}}>
              <span style={{background:"#3b5b8b",color:"white",padding:"2px 10px",borderRadius:3,fontSize:11,fontWeight:800,letterSpacing:0.5}}>ใบสั่งผลิต</span>
              <span style={{color:"#64748b"}}>เลขที่</span>
              <span style={{color:"#3b5b8b",fontFamily:"monospace",fontWeight:700}}>{order.prodNo}</span>
              <span style={{color:"#64748b"}}>·</span>
              <span style={{color:"#1e293b",fontWeight:600}}>{order.date}</span>
              <span style={{color:"#64748b"}}>·</span>
              <span style={{color:"#16a34a",fontWeight:700}}>{order.status}</span>
            </div>
          </div>

          {/* Clothing info — รองรับรูปหลายใบ (grid) */}
          {(() => {
            // รวบรวมรูป: ใหม่ (clothingImages array) → fallback เก่า (clothingImage string)
            const imgs = Array.isArray(order.clothingImages) && order.clothingImages.length > 0
              ? order.clothingImages
              : (order.clothingImage ? [{ dataUrl: order.clothingImage, label: "" }] : []);
            const n = imgs.length;
            // grid: 1 → 1col, 2 → 2cols, 3+ → 3cols
            const cols = n <= 1 ? 1 : (n === 2 ? 2 : 3);
            return (
              <div style={{padding:"10px 14px",background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:10,marginBottom:10}}>
                <div style={{display:"flex",alignItems:"center",gap:14,marginBottom:n>0?10:0}}>
                  <div style={{flex:1}}>
                    <div style={{fontSize:10,color:"#3b5b8b",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:2}}>รุ่นสินค้า</div>
                    <div style={{fontSize:18,fontWeight:700,color:"#1e293b"}}>{order.clothingName}</div>
                    <div style={{fontSize:12,color:"#475569",marginTop:2}}>รวมทั้งหมด <b style={{color:"#3b5b8b",fontSize:15}}>{fmtInt(order.totalQty)}</b> ตัว</div>
                    {(order.fabricType||order.collarType||order.jobDescription||order.shrinkOffset>0) && (
                      <div style={{display:"flex",flexWrap:"wrap",gap:8,marginTop:6,fontSize:11,color:"#475569"}}>
                        {order.fabricType && <span style={{padding:"3px 8px",background:"#eff6ff",border:"1px solid #bfdbfe",borderRadius:10,fontWeight:600}}>🧵 {order.fabricType}</span>}
                        {order.collarType && <span style={{padding:"3px 8px",background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:10,fontWeight:600}}>👔 {order.collarType}</span>}
                        {order.jobDescription && <span style={{padding:"3px 8px",background:"#fffbeb",border:"1px solid #fde68a",borderRadius:10,fontWeight:600}}>📋 {order.jobDescription}</span>}
                        {order.shrinkOffset>0 && <span style={{padding:"3px 8px",background:"#fef3c7",border:"1px solid #fcd34d",borderRadius:10,fontWeight:700,color:"#92400e"}}>🪡 เผื่อหด ตัดผ้าใหญ่ขึ้น +{order.shrinkOffset} ไซส์</span>}
                      </div>
                    )}
                  </div>
                </div>
                {n > 0 && (
                  <div style={{display:"grid",gridTemplateColumns:`repeat(${cols},1fr)`,gap:8}}>
                    {imgs.map((im, i) => (
                      <div key={i} style={{textAlign:"center"}}>
                        <div style={{width:"100%",height:n===1?208:176,background:"#fff",border:"1px solid #e2e8f0",borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",overflow:"hidden"}}>
                          <img src={im.dataUrl} alt="" style={{maxWidth:"100%",maxHeight:"100%",width:"auto",height:"auto",objectFit:"contain",display:"block"}}/>
                        </div>
                        {im.label && <div style={{fontSize:11,color:"#1e293b",fontWeight:700,marginTop:4}}>{im.label}</div>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}

          {/* Items table — group by color, ไซส์ 4 ช่อง/แถว (เหมือนใบสั่งของ) */}
          {(() => {
            const groups = [];
            const gmap = new Map();
            (order.items||[]).forEach(it => {
              // 🔑 group key รวม variant ด้วย — แขนสั้นสีดำ vs แขนยาวสีดำ = คนละกลุ่ม
              const key = (it.colorName||"-") + "|" + (it.colorHex||"#999") + "|" + (it.variant||"");
              if (!gmap.has(key)) {
                const g = { colorName: it.colorName||"-", colorHex: it.colorHex||"#999", variant: it.variant||"", sizes: [] };
                gmap.set(key, g); groups.push(g);
              }
              const pSize = it.productionSize || it.size || "-";
              gmap.get(key).sizes.push({ size: pSize, customerSize: it.size||"-", qty: Number(it.qty)||0 });
            });
            const MAX = 4;
            return (
              <table style={{width:"100%",borderCollapse:"collapse",marginBottom:10,fontSize:11}}>
                <thead>
                  <tr style={{background:"#f1f5f9",color:"#000"}}>
                    <th style={{padding:"5px 5px",textAlign:"left",fontWeight:700,border:"1px solid #000",fontSize:11,width:58,minWidth:58}}>รุ่น</th>
                    <th style={{padding:"5px 5px",textAlign:"left",fontWeight:700,border:"1px solid #000",fontSize:11,width:46,minWidth:46}}>สี</th>
                    {Array.from({length:MAX}).flatMap((_,i)=>([
                      <th key={`s${i}`} style={{padding:"5px 4px",textAlign:"center",fontWeight:700,border:"1px solid #000",fontSize:10,minWidth:34,background:"#e0f2fe"}}>SIZE</th>,
                      <th key={`q${i}`} style={{padding:"5px 4px",textAlign:"center",fontWeight:700,border:"1px solid #000",fontSize:10,minWidth:28}}></th>
                    ]))}
                    <th style={{padding:"5px 8px",textAlign:"center",fontWeight:700,border:"1px solid #000",fontSize:11,minWidth:50}}>จำนวน</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.flatMap((g, gi) => {
                    // ✨ ใช้ splitSizesIntoRows: kids/regular → 4 ต่อแถว, plus → 1 ต่อแถว
                    const chunks = splitSizesIntoRows(g.sizes, MAX);
                    if (chunks.length === 0) chunks.push([]);
                    return chunks.map((chunk, ci) => {
                      const rowQty = chunk.reduce((s,x)=>s+x.qty, 0);
                      return (
                        <tr key={`${gi}-${ci}`} style={{background: gi%2===0?"white":"#f8fafc"}}>
                          <td style={{padding:"4px 5px",fontWeight:700,color:"#000",border:"1px solid #000",fontSize:11,verticalAlign:"middle",width:58}}>{ci===0 ? (order.clothingName || "-") : ""}</td>
                          <td style={{padding:"4px 5px",color:"#000",border:"1px solid #000",fontSize:11,verticalAlign:"middle",width:46}}>
                            {ci===0 && (<div>
                              <div style={{display:"flex",alignItems:"center",gap:5}}>
                                <div style={{width:10,height:10,borderRadius:2,background:g.colorHex,border:"1px solid #000",flexShrink:0}}/>
                                <span>{g.colorName}</span>
                              </div>
                              {g.variant && <div style={{fontSize:9,color:"#475569",marginTop:2,fontStyle:"italic"}}>🎽 {g.variant}</div>}
                            </div>)}
                          </td>
                          {chunk.flatMap((c,i)=>([
                            <td key={`s-${i}`} style={{padding:"4px 4px",textAlign:"center",fontFamily:"monospace",fontWeight:700,color:"#0c4a6e",border:"1px solid #000",background:"#f0f9ff",fontSize:11}}>
                              {c.size}
                              {c.customerSize && c.customerSize !== c.size && (
                                <div style={{fontSize:8,color:"#475569",fontWeight:500,marginTop:1,fontFamily:"inherit"}}>(ลูกค้า: {c.customerSize})</div>
                              )}
                            </td>,
                            <td key={`q-${i}`} style={{padding:"4px 4px",textAlign:"center",fontFamily:"monospace",fontWeight:700,color:"#000",border:"1px solid #000",fontSize:11}}>{fmtInt(c.qty)}</td>
                          ]))}
                          {Array(MAX - chunk.length).fill(null).flatMap((_,i)=>([
                            <td key={`e1-${i}`} style={{border:"1px solid #000",background:"#fafafa"}}/>,
                            <td key={`e2-${i}`} style={{border:"1px solid #000",background:"#fafafa"}}/>
                          ]))}
                          <td style={{padding:"4px 8px",textAlign:"center",fontFamily:"monospace",fontWeight:800,fontSize:12,color:"#000",border:"1px solid #000",verticalAlign:"middle"}}>{fmtInt(rowQty)}</td>
                        </tr>
                      );
                    });
                  })}
                </tbody>
                <tfoot>
                  <tr style={{background:"#f1f5f9",fontWeight:700}}>
                    <td colSpan={2 + MAX*2} style={{padding:"6px 10px",textAlign:"right",color:"#000",fontSize:12,border:"2px solid #000"}}>รวมทั้งหมด</td>
                    <td style={{padding:"6px 10px",textAlign:"center",fontFamily:"monospace",fontSize:13,color:"#000",border:"2px solid #000",fontWeight:800}}>{fmtInt(order.totalQty)} ตัว</td>
                  </tr>
                </tfoot>
              </table>
            );
          })()}

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
