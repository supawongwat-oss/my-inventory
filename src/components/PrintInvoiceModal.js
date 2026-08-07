import React from "react";
import { splitSizesIntoRows } from "../theme";

const INVOICE_FONT_SCALE = 1.0;

// 🕶️ ชื่อบริษัทแบบย่อ — ตัดคำนำหน้า/ต่อท้ายทางกฎหมายออก
// ใช้ตอนติ๊ก "ซ่อนข้อมูลบริษัท" (ลูกค้าที่ไม่ต้องการรับ VAT)
// "ห้างหุ้นส่วนจำกัด ซีพียู" → "ซีพียู"
const shortCompanyName = (name) => {
  let s = String(name || "").trim();
  s = s.replace(/\((มหาชน|สำนักงานใหญ่)\)/g, "");
  s = s.replace(/^(ห้างหุ้นส่วนจำกัด|ห้างหุ้นส่วนสามัญ|หจก\.?|บริษัท|บมจ\.?|บจ\.?|บจก\.?)\s*/i, "");
  s = s.replace(/\s*(จำกัด|Co\.,?\s*Ltd\.?|Company\s+Limited|Ltd\.?|Part\.?,?\s*Ltd\.?)\s*$/i, "");
  return s.trim() || String(name || "").trim();
};

export default function PrintInvoiceModal({
  invoice,
  clothingItems = [],
  companyInfo = {},
  docTypeLabel,
  onClose,
  printElementById,
  printInvoiceCopies,
  downloadInvoicePdf,
}) {
  if (!invoice) return null;
  // 🕶️ ซ่อนข้อมูลบริษัท — ชื่อย่อ + ไม่โชว์ที่อยู่/เลขภาษี/กล่อง "ออกโดย"
  const hideCo = invoice.hideCompanyDetails === true;
  const coName = hideCo ? shortCompanyName(companyInfo.name || "CPU") : (companyInfo.name || "CPU");
  const showCoTaxId = !hideCo && invoice.showCompanyTaxId !== false && !!companyInfo.taxId;
  return (
        <div className="print-modal-overlay" style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.88)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:500,backdropFilter:"blur(6px)"}}
          onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}>
          <div className="print-modal-card" onMouseDown={e=>e.stopPropagation()} style={{background:"white",borderRadius:16,width:"min(96vw, 794px)",maxHeight:"94vh",overflow:"auto",boxShadow:"0 24px 60px rgba(0,0,0,0.7)"}}>

            {/* ── เนื้อหาบิล (พิมพ์ได้) — กว้างเท่า A4 portrait (794px @96dpi) ── */}
            <div id="invoice-print-area" style={{padding:"6px 24px 10px",fontFamily:"'Sarabun',sans-serif",color:"#000",boxSizing:"border-box"}}>

              {/* ── HEADER ── */}
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:7,paddingBottom:6,borderBottom:"2px solid #000"}}>
                {/* ข้อมูลบริษัท */}
                <div style={{flex:1}}>
                  <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:4}}>
                    <div style={{width:42,height:42,borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,overflow:"hidden",background:"white"}}>
                      <img src={`${process.env.PUBLIC_URL}/cpu-logo.png`} alt="CPU Logo" style={{width:"100%",height:"100%",objectFit:"contain"}}
                        onError={(e)=>{e.target.style.display="none";e.target.parentElement.innerHTML=companyInfo.logo||"⚙️";e.target.parentElement.style.background="#000";e.target.parentElement.style.fontSize="20px";e.target.parentElement.style.color="white";}}/>
                    </div>
                    <div>
                      <div style={{fontSize:17,fontWeight:800,color:"#000",letterSpacing:1.5}}>{coName}</div>
                    </div>
                  </div>
                  {!hideCo&&companyInfo.address&&<div style={{fontSize:10,color:"#000",marginBottom:1,maxWidth:280,lineHeight:1.5}}>{companyInfo.address}</div>}
                  <div style={{display:"flex",flexWrap:"wrap",gap:12,marginTop:1}}>
                    {companyInfo.phone&&<div style={{fontSize:10,color:"#000"}}>โทร: {companyInfo.phone}</div>}
                    {!hideCo&&companyInfo.email&&<div style={{fontSize:10,color:"#000"}}>{companyInfo.email}</div>}
                  </div>
                  {showCoTaxId&&<div style={{fontSize:10,color:"#000",marginTop:1}}>เลขผู้เสียภาษี: {companyInfo.taxId}</div>}
                </div>

                {/* ประเภทเอกสาร + เลขที่ */}
                <div style={{textAlign:"right",minWidth:200}}>
                  <div data-doc-label style={{display:"inline-block",background:"#fff",color:"#000",padding:"4px 16px",borderRadius:4,fontSize:15,fontWeight:800,marginBottom:6,letterSpacing:1,border:"2px solid #000"}}>
                    {docTypeLabel(invoice.docType)}
                  </div>
                  {invoice.revisions>0 && (
                    <div style={{fontSize:9,color:"#000",marginBottom:4,fontWeight:600}}>
                      ✏️ แก้ไขครั้งที่ {invoice.revisions}{invoice.lastEditedBy?` · ${invoice.lastEditedBy}`:""}{invoice.lastEditedAt?` · ${invoice.lastEditedAt}`:""}
                    </div>
                  )}
                  {invoice.convertedFrom && (
                    <div style={{fontSize:9,color:"#000",marginBottom:4,fontWeight:600}}>
                      🔄 แปลงมาจาก {docTypeLabel(invoice.convertedFrom.docType)} {invoice.convertedFrom.invoiceNo}
                    </div>
                  )}
                  <div style={{display:"flex",flexDirection:"column",gap:2}}>
                    <div style={{display:"flex",justifyContent:"flex-end",gap:6}}>
                      <span style={{fontSize:10,color:"#000",fontWeight:600,minWidth:56,textAlign:"right"}}>เลขที่:</span>
                      <span style={{fontSize:11,color:"#000",fontFamily:"monospace",fontWeight:700}}>{invoice.invoiceNo}</span>
                    </div>
                    <div style={{display:"flex",justifyContent:"flex-end",gap:6}}>
                      <span style={{fontSize:10,color:"#000",fontWeight:600,minWidth:56,textAlign:"right"}}>วันที่ออก:</span>
                      <span style={{fontSize:10,color:"#000",fontWeight:600}}>{invoice.date}</span>
                    </div>
                    {invoice.dueDate&&(
                      <div style={{display:"flex",justifyContent:"flex-end",gap:6}}>
                        <span style={{fontSize:10,color:"#000",fontWeight:600,minWidth:56,textAlign:"right"}}>ครบกำหนด:</span>
                        <span style={{fontSize:10,color:"#000",fontWeight:700}}>{invoice.dueDate}</span>
                      </div>
                    )}
                    {invoice.useVat&&(
                      <div style={{marginTop:3,textAlign:"right"}}>
                        <span style={{padding:"1px 6px",background:"#fff",borderRadius:4,fontSize:9,color:"#000",fontWeight:700,border:"1px solid #000"}}>มี VAT {invoice.vatRate}%</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* ── BILL TO / FROM — ขอบเล็กลง สีดำ ── */}
              <div style={{display:"grid",gridTemplateColumns:hideCo?"1fr":"1fr 1fr",gap:0,marginBottom:7,border:"1px solid #000",borderRadius:4,overflow:"hidden"}}>
                <div style={{padding:"5px 12px",background:"#f8fafc",borderRight:hideCo?"none":"1px solid #000"}}>
                  <div style={{fontSize:10,color:"#000",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:4,paddingBottom:3,borderBottom:"1px solid #000"}}>ออกให้แก่ (Bill To)</div>
                  <div style={{fontSize:14,fontWeight:700,color:"#000",marginBottom:2}}>{invoice.customerName||"-"}</div>
                  {invoice.customerPhone&&<div style={{fontSize:11,color:"#000",marginBottom:1}}>โทร: {invoice.customerPhone}</div>}
                  {invoice.customerTaxId&&<div style={{fontSize:11,color:"#000",marginBottom:1}}>เลขผู้เสียภาษี: {invoice.customerTaxId}</div>}
                  {invoice.customerAddress&&<div style={{fontSize:11,color:"#000",lineHeight:1.5,marginTop:2}}>{invoice.customerAddress}</div>}
                </div>
                {!hideCo&&(
                <div style={{padding:"5px 12px",background:"#f8fafc"}}>
                  <div style={{fontSize:10,color:"#000",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:4,paddingBottom:3,borderBottom:"1px solid #000"}}>ออกโดย (From)</div>
                  <div style={{fontSize:13,fontWeight:700,color:"#000",marginBottom:2}}>{companyInfo.name||"CPU"}</div>
                  {companyInfo.phone&&<div style={{fontSize:11,color:"#000",marginBottom:1}}>โทร: {companyInfo.phone}</div>}
                  {companyInfo.email&&<div style={{fontSize:11,color:"#000",marginBottom:1}}>{companyInfo.email}</div>}
                  {companyInfo.address&&<div style={{fontSize:11,color:"#000",lineHeight:1.5,marginTop:2}}>{companyInfo.address}</div>}
                  {showCoTaxId&&<div style={{fontSize:11,color:"#000",marginTop:1}}>เลขผู้เสียภาษี: {companyInfo.taxId}</div>}
                </div>
                )}
              </div>

              {/* ── รายละเอียดงาน Custom (รูป + ชนิดผ้า + ปก + ลักษณะงาน) ── */}
              {invoice.customDetails&&(invoice.customDetails.jobs||[]).length>0&&(
                <div style={{marginBottom:7,padding:"7px 10px",background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:8}}>
                  <div style={{fontSize:10,color:"#3b5b8b",fontWeight:800,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:5}}>รายละเอียดงาน</div>
                  {(invoice.customDetails.jobs||[]).map((j,ji)=>{
                    // 🖼️ ปิดรูปได้จากหน้าออกบิล (ค่าเริ่มต้น = แสดง)
                    const imgs=invoice.showJobImages===false?[]:(j.images||[]);
                    const cols=imgs.length<=1?1:(imgs.length===2?2:3);
                    return (
                      <div key={ji} style={{marginBottom:ji<(invoice.customDetails.jobs.length-1)?7:0,paddingBottom:ji<(invoice.customDetails.jobs.length-1)?7:0,borderBottom:ji<(invoice.customDetails.jobs.length-1)?"1px dashed #cbd5e1":"none"}}>
                        <div style={{display:"flex",alignItems:"baseline",gap:8,flexWrap:"wrap",marginBottom:4}}>
                          {j.prodNo&&<span style={{fontSize:10,fontFamily:"monospace",color:"#3b5b8b",fontWeight:700,padding:"1px 7px",background:"#eff6ff",border:"1px solid #bfdbfe",borderRadius:4}}>{j.prodNo}</span>}
                          <span style={{fontSize:13,fontWeight:700,color:"#000"}}>{j.clothingName||"-"}</span>
                        </div>
                        {/* ไม่ใช้ไอคอน — บางเครื่องพิมพ์เป็นกรอบรูปแตก ใช้ข้อความล้วนแทน */}
                        {(j.fabricType||j.collarType||j.jobDescription)&&(
                          <div style={{display:"flex",flexWrap:"wrap",gap:6,fontSize:11,marginBottom:imgs.length>0?5:0}}>
                            {j.fabricType&&<span style={{padding:"1px 8px",background:"#eff6ff",border:"1px solid #bfdbfe",borderRadius:10,fontWeight:600,color:"#1e40af"}}>ผ้า: {j.fabricType}</span>}
                            {j.collarType&&<span style={{padding:"1px 8px",background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:10,fontWeight:600,color:"#15803d"}}>คอ: {j.collarType}</span>}
                            {j.jobDescription&&<span style={{padding:"1px 8px",background:"#fffbeb",border:"1px solid #fde68a",borderRadius:10,fontWeight:600,color:"#78350f"}}>{j.jobDescription}</span>}
                          </div>
                        )}
                        {j.note&&<div style={{fontSize:10,color:"#475569",marginBottom:imgs.length>0?5:0,fontStyle:"italic"}}>หมายเหตุ: {j.note}</div>}
                        {imgs.length>0&&(
                          <div style={{display:"grid",gridTemplateColumns:`repeat(${cols},1fr)`,gap:5}}>
                            {imgs.map((im,i)=>(
                              <div key={i} style={{textAlign:"center"}}>
                                <div style={{width:"100%",height:imgs.length===1?92:76,background:"#fff",border:"1px solid #e2e8f0",borderRadius:6,display:"flex",alignItems:"center",justifyContent:"center",overflow:"hidden"}}>
                                  <img src={im.dataUrl} alt="" style={{maxWidth:"100%",maxHeight:"100%",objectFit:"contain"}}/>
                                </div>
                                {im.label&&<div style={{fontSize:10,color:"#1e293b",fontWeight:700,marginTop:2}}>{im.label}</div>}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* ── ตารางรายการ (รุ่น | สี | SIZE×4 | จำนวน | ราคา) ── */}
              {(()=>{
                // ถ้ามีข้อมูล clothing แยก group ตามรุ่น+สี | ที่เหลือเป็น "อื่นๆ"
                const structured=(invoice.items||[]).filter(i=>i.clothingId||i.clothingName);
                const generic=(invoice.items||[]).filter(i=>!(i.clothingId||i.clothingName));
                const groups=Object.values(structured.reduce((acc,it)=>{
                  const k=`${it.clothingId||it.clothingName}-${it.colorIdx??""}|${it.colorName||""}|${it.variant||""}`;
                  if(!acc[k]) acc[k]={clothingName:it.clothingName,colorName:it.colorName,colorHex:it.colorHex,variant:it.variant||"",fabricType:it.fabricType||"",collarType:it.collarType||"",jobDescription:it.jobDescription||"",items:[]};
                  acc[k].items.push(it);
                  return acc;
                },{}));
                return (
                  <div style={{overflowX:"auto",WebkitOverflowScrolling:"touch",marginBottom:10}}>
                  <table style={{width:"100%",borderCollapse:"collapse",fontSize:15,minWidth:560}}>
                    <thead>
                      <tr style={{background:"#f1f5f9",color:"#000"}}>
                        <th style={{padding:"9px 4px",textAlign:"left",fontWeight:700,border:"1px solid #000",fontSize:11,color:"#000",width:72}}>รุ่น</th>
                        <th style={{padding:"9px 8px",textAlign:"left",fontWeight:700,border:"1px solid #000",fontSize:15,color:"#000"}}>สี</th>
                        {[1,2,3,4].flatMap(i=>[
                          <th key={`sh${i}`} style={{padding:"9px 2px",textAlign:"center",fontWeight:700,border:"1px solid #000",background:"#f1f5f9",color:"#000",minWidth:36,fontSize:13}}>SIZE</th>,
                          <th key={`qh${i}`} style={{padding:"9px 2px",textAlign:"center",fontWeight:700,border:"1px solid #000",minWidth:26,fontSize:13,color:"#000"}}></th>
                        ])}
                        <th style={{padding:"9px 4px",textAlign:"center",fontWeight:700,border:"1px solid #000",width:48,fontSize:14,color:"#000"}}>จำนวน</th>
                        <th style={{padding:"9px 4px",textAlign:"right",fontWeight:700,border:"1px solid #000",width:66,fontSize:12,color:"#000"}}>ราคา/หน่วย</th>
                        <th style={{padding:"9px 6px",textAlign:"right",fontWeight:700,border:"1px solid #000",width:90,fontSize:13,color:"#000"}}>ราคารวม (฿)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {groups.flatMap((group,gi)=>{
                        // ชนิดผ้า/แบบคอ ไม่ต้องซ้ำในตาราง — แสดงอยู่ในกล่อง "รายละเอียดงาน" ด้านบนแล้ว
                        // ✨ sort + split อัตโนมัติ — เสื้อผ้าแถวละ 4
                        //    สินค้าที่ไม่ใช่เสื้อผ้า (สนับแข้ง/รองเท้า/อุปกรณ์กีฬา) ราคาต่างกันทุกไซส์
                        //    → แยกบรรทัดละไซส์ ให้ช่องราคาตรงกับไซส์นั้นจริง ๆ
                        const ciRef = clothingItems.find(c => c.id === group.items[0]?.clothingId);
                        const perSize = !!ciRef && (ciRef.sizeType === "shoe" || ciRef.priceBySize === true);
                        // 🔗 สี+ไซส์+ราคาเดียวกัน ที่มาจากคนละใบสั่ง → รวมเป็นช่องเดียว
                        //    (เช่น S 13 · S 14 · S 16 → S 43) ยอดเงินเท่าเดิมทุกบาท
                        //    ราคาต่างกันไม่รวม — ไม่งั้นราคาต่อหน่วยจะกลายเป็นค่าเฉลี่ย
                        const sizeMap = new Map();
                        group.items.filter(i => i.size).forEach(it => {
                          const k = `${it.size}|${Number(it.unitPrice) || 0}`;
                          const prev = sizeMap.get(k);
                          sizeMap.set(k, prev
                            ? { ...prev, qty: (Number(prev.qty) || 0) + (Number(it.qty) || 0) }
                            : { ...it, qty: Number(it.qty) || 0 });
                        });
                        const withSize = [...sizeMap.values()];
                        const noSize = group.items.filter(i => !i.size);
                        const rows = splitSizesIntoRows(withSize, perSize ? 1 : 4, { fillPlus: false });
                        noSize.forEach(n => rows.push([n]));
                        if(rows.length===0) rows.push([]);
                        return rows.map((chunk,ci)=>{
                          const rowQty=chunk.reduce((s,i)=>s+(Number(i.qty)||0),0);
                          const rowSub=chunk.reduce((s,i)=>s+(Number(i.unitPrice)||0)*(Number(i.qty)||0),0);
                          return (
                            <tr key={`${gi}-${ci}`} style={{background:gi%2===0?"white":"#f8fafc"}}>
                              <td style={{padding:"8px 4px",fontWeight:600,color:"#000",verticalAlign:"middle",border:"1px solid #000",fontSize:11,textAlign:"center",whiteSpace:"nowrap",width:72}}>
                                {ci===0 ? group.clothingName : " "}
                              </td>
                              <td style={{padding:"8px 8px",verticalAlign:"middle",border:"1px solid #000",fontSize:15,color:"#000",whiteSpace:"nowrap"}}>
                                {ci===0 ? (
                                  <div style={{display:"flex",alignItems:"center",gap:5,justifyContent:"center"}}>
                                    <div style={{width:11,height:11,borderRadius:2,background:group.colorHex,border:"1px solid #000",flexShrink:0}}/>
                                    <span>{group.colorName}{group.variant?` (${group.variant})`:""}</span>
                                  </div>
                                ) : " "}
                              </td>
                              {chunk.map(it=>[
                                <td key={`s-${it.size}`} style={{padding:"9px 5px",textAlign:"center",fontFamily:"monospace",fontWeight:700,color:"#000",border:"1px solid #000",background:"#f1f5f9",fontSize:15}}>{it.size}</td>,
                                <td key={`q-${it.size}`} style={{padding:"9px 5px",textAlign:"center",fontFamily:"monospace",fontWeight:700,color:"#000",border:"1px solid #000",fontSize:15}}>{it.qty}</td>
                              ])}
                              {Array(4-chunk.length).fill(null).flatMap((_,i)=>[
                                <td key={`e1-${ci}-${i}`} style={{border:"1px solid #000",background:"#f8fafc"}}/>,
                                <td key={`e2-${ci}-${i}`} style={{border:"1px solid #000",background:"#f8fafc"}}/>
                              ])}
                              <td style={{padding:"9px 8px",textAlign:"center",fontFamily:"monospace",fontWeight:700,fontSize:16,color:"#000",verticalAlign:"middle",border:"1px solid #000"}}>{rowQty}</td>
                              {(()=>{
                                const prices=chunk.map(i=>Number(i.unitPrice)||0).filter(p=>p>0);
                                const uniq=[...new Set(prices)];
                                const unitTxt=uniq.length===1?uniq[0].toLocaleString("th-TH",{minimumFractionDigits:2}):(rowQty>0?`${(rowSub/rowQty).toFixed(2)}*`:"-");
                                return (<>
                                  <td style={{padding:"8px 8px",textAlign:"right",fontFamily:"monospace",fontSize:13,color:"#000",verticalAlign:"middle",border:"1px solid #000"}}>{unitTxt}</td>
                                  <td style={{padding:"8px 8px",textAlign:"right",fontFamily:"monospace",fontWeight:700,fontSize:14,color:"#000",verticalAlign:"middle",border:"1px solid #000"}}>{rowSub.toLocaleString("th-TH",{minimumFractionDigits:2})}</td>
                                </>);
                              })()}
                            </tr>
                          );
                        });
                      })}
                      {/* รายการกรอกเอง (ไม่มี clothing) — span คอลัมน์รุ่น+สี+ไซส์ */}
                      {generic.map((it,i)=>(
                        <tr key={`g${i}`} style={{background:(groups.length+i)%2===0?"white":"#f8fafc"}}>
                          <td colSpan={10} style={{padding:"6px 8px",fontWeight:500,color:"#000",border:"1px solid #000",fontSize:12}}>
                            <div style={{display:"flex",alignItems:"center",gap:6}}>
                              {it.colorHex&&<div style={{width:11,height:11,borderRadius:2,background:it.colorHex,border:"1px solid #000",flexShrink:0}}/>}
                              <span>{it.description}</span>
                              {it.colorName&&<span style={{color:"#000",fontSize:11}}>· {it.colorName}</span>}
                              {it.unit&&<span style={{color:"#000",fontSize:11}}>· {it.unit}</span>}
                            </div>
                          </td>
                          <td style={{padding:"7px 8px",textAlign:"center",fontFamily:"monospace",fontWeight:700,fontSize:14,color:"#000",border:"1px solid #000"}}>{it.qty}</td>
                          <td style={{padding:"5px 7px",textAlign:"right",fontFamily:"monospace",fontSize:11,color:"#000",border:"1px solid #000"}}>{(Number(it.unitPrice)||0).toLocaleString("th-TH",{minimumFractionDigits:2})}</td>
                          <td style={{padding:"5px 8px",textAlign:"right",fontFamily:"monospace",fontWeight:700,fontSize:12,color:"#000",border:"1px solid #000"}}>{(it.qty*it.unitPrice).toLocaleString("th-TH",{minimumFractionDigits:2})}</td>
                        </tr>
                      ))}
                      {/* padding rows */}
                      {(invoice.items||[]).length<4&&Array.from({length:Math.max(0,4-(invoice.items||[]).length)}).map((_,i)=>(
                        <tr key={`pad-${i}`}>
                          <td colSpan={13} style={{padding:"7px 10px",border:"1px solid #cbd5e1"}}>&nbsp;</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      {(invoice.itemDiscountTotal>0||invoice.billDiscount>0)&&(
                        <tr style={{background:"#fffbeb"}}>
                          <td colSpan={12} style={{padding:"6px 10px",textAlign:"right",fontSize:12,color:"#000",border:"1px solid #000"}}>ราคารวมก่อนส่วนลด</td>
                          <td style={{padding:"6px 10px",textAlign:"right",fontFamily:"monospace",color:"#000",border:"1px solid #000",fontSize:12}}>{(invoice.grossSubtotal||0).toLocaleString("th-TH",{minimumFractionDigits:2})}</td>
                        </tr>
                      )}
                      {invoice.itemDiscountTotal>0&&(
                        <tr style={{background:"#fffbeb"}}>
                          <td colSpan={12} style={{padding:"6px 10px",textAlign:"right",fontSize:12,color:"#000",border:"1px solid #000"}}>ส่วนลดรายการ</td>
                          <td style={{padding:"6px 10px",textAlign:"right",fontFamily:"monospace",fontWeight:600,color:"#000",border:"1px solid #000",fontSize:12}}>-{(invoice.itemDiscountTotal||0).toLocaleString("th-TH",{minimumFractionDigits:2})}</td>
                        </tr>
                      )}
                      {invoice.billDiscount>0&&(
                        <tr style={{background:"#fffbeb"}}>
                          <td colSpan={12} style={{padding:"6px 10px",textAlign:"right",fontSize:12,color:"#000",border:"1px solid #000",whiteSpace:"nowrap"}}>ส่วนลดท้ายบิล{invoice.discountType==="percent"?` (${invoice.discount}%)`:""}</td>
                          <td style={{padding:"6px 10px",textAlign:"right",fontFamily:"monospace",fontWeight:600,color:"#000",border:"1px solid #000",fontSize:12,whiteSpace:"nowrap"}}>-{(invoice.billDiscount||0).toLocaleString("th-TH",{minimumFractionDigits:2})}</td>
                        </tr>
                      )}
                      <tr style={{background:"#f1f5f9"}}>
                        <td colSpan={12} style={{padding:"7px 10px",textAlign:"right",fontWeight:600,fontSize:12,color:"#000",border:"1px solid #000",whiteSpace:"nowrap"}}>ยอดรวมก่อนภาษี</td>
                        <td style={{padding:"7px 10px",textAlign:"right",fontFamily:"monospace",fontWeight:700,color:"#000",fontSize:13,border:"1px solid #000",whiteSpace:"nowrap"}}>{(invoice.subtotal||0).toLocaleString("th-TH",{minimumFractionDigits:2})}</td>
                      </tr>
                      {invoice.useVat&&(
                        <tr style={{background:"#f1f5f9"}}>
                          <td colSpan={12} style={{padding:"6px 10px",textAlign:"right",fontSize:12,color:"#000",border:"1px solid #000",whiteSpace:"nowrap"}}>ภาษีมูลค่าเพิ่ม (VAT {invoice.vatRate}%)</td>
                          <td style={{padding:"6px 10px",textAlign:"right",fontFamily:"monospace",fontWeight:600,color:"#000",border:"1px solid #000",fontSize:12,whiteSpace:"nowrap"}}>{(invoice.vat||0).toLocaleString("th-TH",{minimumFractionDigits:2})}</td>
                        </tr>
                      )}
                      {(invoice.shipping>0||invoice.useShipping)&&(
                        <tr style={{background:"#f1f5f9"}}>
                          <td colSpan={12} style={{padding:"6px 10px",textAlign:"right",fontSize:12,color:"#000",border:"1px solid #000",whiteSpace:"nowrap"}}>ค่าจัดส่ง</td>
                          <td style={{padding:"6px 10px",textAlign:"right",fontFamily:"monospace",fontWeight:600,color:"#000",border:"1px solid #000",fontSize:12,whiteSpace:"nowrap"}}>{(invoice.shipping||0).toLocaleString("th-TH",{minimumFractionDigits:2})}</td>
                        </tr>
                      )}
                      {/* ── ยอดรวมทั้งสิ้น (สีดำ + กรอบหนา) ── */}
                      <tr style={{background:"#fff"}}>
                        <td colSpan={12} style={{padding:"9px 12px",textAlign:"right",fontWeight:800,fontSize:15,color:"#000",border:"2px solid #000",whiteSpace:"nowrap"}}>ยอดรวมทั้งสิ้น</td>
                        <td style={{padding:"9px 12px",textAlign:"right",fontFamily:"monospace",fontWeight:800,fontSize:17,color:"#000",border:"2px solid #000",whiteSpace:"nowrap"}}>{(invoice.total||0).toLocaleString("th-TH",{minimumFractionDigits:2})}</td>
                      </tr>
                      {/* ── มัดจำ/ชำระแล้ว + คงเหลือ (เฉพาะเมื่อมีการชำระ) ── */}
                      {(() => {
                        const paidTotal = (invoice.payments||[]).reduce((s,p)=>s+(Number(p.amount)||0),0);
                        if (paidTotal <= 0) return null;
                        const remain = Math.max(0, (Number(invoice.total)||0) - paidTotal);
                        const isDeposit = (invoice.payments||[]).some(p=>/มัดจำ/.test(p.note||""));
                        return (
                          <>
                            <tr style={{background:"#fff"}}>
                              <td colSpan={12} style={{padding:"6px 12px",textAlign:"right",fontWeight:700,fontSize:12,color:"#000",border:"1px solid #000",whiteSpace:"nowrap"}}>{isDeposit?"หัก มัดจำ/ชำระแล้ว":"ชำระแล้ว"}</td>
                              <td style={{padding:"6px 12px",textAlign:"right",fontFamily:"monospace",fontWeight:700,fontSize:13,color:"#000",border:"1px solid #000",whiteSpace:"nowrap"}}>-{paidTotal.toLocaleString("th-TH",{minimumFractionDigits:2})}</td>
                            </tr>
                            <tr style={{background:"#fff"}}>
                              <td colSpan={12} style={{padding:"8px 12px",textAlign:"right",fontWeight:800,fontSize:14,color:"#000",border:"2px solid #000",whiteSpace:"nowrap"}}>คงเหลือต้องชำระ</td>
                              <td style={{padding:"8px 12px",textAlign:"right",fontFamily:"monospace",fontWeight:800,fontSize:16,color:"#000",border:"2px solid #000",whiteSpace:"nowrap"}}>{remain.toLocaleString("th-TH",{minimumFractionDigits:2})}</td>
                            </tr>
                          </>
                        );
                      })()}
                    </tfoot>
                  </table>
                  </div>
                );
              })()}

              {/* ── บัญชีรับเงิน — compact ── */}
              {invoice.bankAccount&&(
                <div style={{padding:"10px 14px",background:"#eff6ff",border:"1px solid #bfdbfe",borderRadius:8,marginBottom:10,display:"flex",alignItems:"center",gap:12,lineHeight:1.4}}>
                  <div style={{fontSize:20}}>🏦</div>
                  <div style={{flex:1}}>
                    <div style={{fontSize:12,color:"#475569",fontWeight:600,marginBottom:3}}>
                      โอนชำระเข้าบัญชี{invoice.bankAccount.label?` (${invoice.bankAccount.label})`:""} · <span style={{color:"#1e293b"}}>{invoice.bankAccount.bankName||"-"} · {invoice.bankAccount.accountName||"-"}</span>
                    </div>
                    <div style={{fontFamily:"monospace",color:"#1e293b",fontWeight:800,fontSize:18,letterSpacing:1.5}}>
                      {invoice.bankAccount.accountNo||"-"}
                    </div>
                  </div>
                </div>
              )}

              {/* ── หมายเหตุ ── */}
              {invoice.note&&(
                <div style={{padding:"10px 14px",background:"#fffbeb",border:"1px solid #fde68a",borderRadius:8,fontSize:11,color:"#78350f",marginBottom:16}}>
                  <span style={{fontWeight:700}}>หมายเหตุ:</span> {invoice.note}
                </div>
              )}

              {/* ── เส้นแบ่ง + ช่องลายเซ็น — สีดำ ── */}
              <div style={{marginTop:22,paddingTop:10,borderTop:"1px solid #000"}}>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:16}}>
                  {[
                    {label:"ผู้รับเงิน / ผู้ออกเอกสาร"},
                    {label:"ผู้ตรวจสอบ"},
                    {label:"ผู้ชำระเงิน / ผู้รับสินค้า"},
                  ].map((sig,i)=>(
                    <div key={i} style={{textAlign:"center"}}>
                      <div style={{height:42,borderBottom:"1px solid #000",marginBottom:4}}/>
                      <div style={{fontSize:10,fontWeight:700,color:"#000",marginBottom:3}}>{sig.label}</div>
                      <div style={{fontSize:9,color:"#000",fontFamily:"monospace"}}>วันที่ ....../......./.........</div>
                    </div>
                  ))}
                </div>
              </div>

            </div>

            {/* ── ปุ่มด้านล่าง (ไม่พิมพ์) ── */}
            <div className="print-hide" style={{padding:"14px 24px",borderTop:"1px solid #e2e8f0",display:"flex",gap:10,justifyContent:"space-between",alignItems:"center",background:"#f8fafc",borderRadius:"0 0 16px 16px"}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <span style={{fontSize:12,color:"#64748b",fontWeight:500}}>ขนาดกระดาษ:</span>
                <div style={{display:"flex",gap:6}}>
                  {[
                    {id:"A4",label:"A4",size:"A4 portrait",margin:"10mm"},
                    {id:"A5",label:"A5",size:"A5 portrait",margin:"8mm"},
                  ].map(p=>(
                    <button key={p.id}
                      onClick={()=>printElementById("invoice-print-area",p.size,p.margin,INVOICE_FONT_SCALE)}
                      style={{padding:"6px 12px",borderRadius:7,border:"1px solid #e2e8f0",background:"white",color:"#475569",fontSize:11,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontWeight:500}}>
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{display:"flex",gap:10}}>
                <button onClick={()=>onClose()} style={{padding:"9px 16px",borderRadius:9,border:"1px solid #e2e8f0",background:"white",color:"#64748b",fontSize:13,cursor:"pointer",fontFamily:"'Sarabun',sans-serif"}}>ปิด</button>
                <button onClick={()=>downloadInvoicePdf(invoice,false)} style={{padding:"9px 16px",borderRadius:9,border:"1px solid rgba(220,38,38,0.35)",background:"white",color:"#dc2626",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"'Sarabun',sans-serif"}}>📄 PDF</button>
                <button onClick={()=>downloadInvoicePdf(invoice,true)} style={{padding:"9px 16px",borderRadius:9,border:"1px solid rgba(220,38,38,0.35)",background:"white",color:"#dc2626",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"'Sarabun',sans-serif"}}>📄 PDF × 3 ชุด</button>
                <button onClick={()=>printElementById("invoice-print-area","A4 portrait","10mm",INVOICE_FONT_SCALE)} style={{padding:"9px 16px",borderRadius:9,border:"1px solid rgba(59,91,139,0.35)",background:"white",color:"#3b5b8b",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"'Sarabun',sans-serif"}}>🖨️ พิมพ์ (A4)</button>
                <button onClick={()=>printInvoiceCopies("invoice-print-area",undefined,INVOICE_FONT_SCALE,"A4 portrait","10mm")} style={{padding:"9px 16px",borderRadius:9,border:"none",background:"linear-gradient(135deg,#3b5b8b,#3b5b8b)",color:"white",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",boxShadow:"0 4px 14px rgba(59,91,139,0.3)"}}>🖨️ พิมพ์ × 3 ชุด (A4)</button>
              </div>
            </div>
          </div>
        </div>
  );
}
