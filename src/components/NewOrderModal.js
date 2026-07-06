import React from "react";
import { T, compareSizes, getSizesFor, mergeSizes } from "../theme";
import { Modal, MHead, BtnPrimary, BtnGhost } from "./ui";
import { matchTokens } from "../utils/search";

export default function NewOrderModal({
  onClose,
  editingOrderId,
  orderForm, setOrderForm,
  orderItemForm, setOrderItemForm,
  orderMixForm, setOrderMixForm,
  orderMixExpanded, setOrderMixExpanded,
  orderFreeExpanded, setOrderFreeExpanded,
  freeItemForm, setFreeItemForm,
  freeItemCutStock, setFreeItemCutStock,
  customerSearch, setCustomerSearch,
  customers = [],
  clothingItems = [],
  handleSelectCustomer,
  handleConfirmOrder,
  addOrderMixItem,
}) {
  return (
        <Modal onClose={()=>onClose()} w={880}>
          <MHead title={editingOrderId ? "✏️ แก้ไขใบสั่งของ" : "📋 สร้างใบสั่งของ"} onClose={()=>onClose()} color={T.accent}/>

          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:20}}>
            {/* Customer section */}
            <div style={{gridColumn:"1/-1"}}>
              <div style={{fontSize:12,fontWeight:700,color:T.accent,marginBottom:10,textTransform:"uppercase",letterSpacing:"0.06em"}}>ข้อมูลลูกค้า</div>
              {/* Search existing customer */}
              <div style={{position:"relative",marginBottom:10}}>
                <input placeholder="🔍 ค้นหาลูกค้าเดิม หรือพิมพ์ชื่อใหม่..."
                  value={orderForm.customerId ? `✓ ${orderForm.customerName}` : customerSearch}
                  onChange={e=>{setCustomerSearch(e.target.value);setOrderForm(f=>({...f,customerId:"",customerName:e.target.value,customerPhone:"",customerAddress:""}));}}
                  style={{width:"100%",background:T.input,border:`1px solid ${orderForm.customerId?"#34d399":T.inputBorder}`,color:T.text,borderRadius:9,padding:"9px 14px",fontFamily:"'Sarabun',sans-serif",fontSize:13,outline:"none"}}/>
                {customerSearch&&!orderForm.customerId&&(()=>{
                  // 🔍 token search — เว้นวรรคแยกคำ ไม่สนลำดับ
                  const matches = customers.filter(c => matchTokens(customerSearch, c.name, c.phone, c.address, c.taxId));
                  return (
                  <div style={{position:"absolute",top:"100%",left:0,right:0,background:"#ffffff",border:`1px solid ${T.border}`,borderRadius:10,zIndex:50,maxHeight:280,overflowY:"auto",boxShadow:"0 8px 24px rgba(0,0,0,0.4)"}}>
                    {matches.length > 0 && (
                      <div style={{padding:"6px 14px",background:"#eff6ff",fontSize:10,color:T.blue,fontWeight:700,borderBottom:`1px solid ${T.border}`,position:"sticky",top:0}}>
                        เจอ {matches.length} ราย {matches.length > 30 && "(แสดง 30 รายแรก — พิมพ์เพิ่มเพื่อกรอง)"}
                      </div>
                    )}
                    {matches.slice(0,30).map(c=>(
                      <div key={c.id} onClick={()=>handleSelectCustomer(c)} style={{padding:"10px 14px",cursor:"pointer",borderBottom:`1px solid ${T.border}`,transition:"background 0.15s"}}
                        onMouseEnter={e=>e.currentTarget.style.background="rgba(59,91,139,0.1)"}
                        onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                        <div style={{fontSize:13,fontWeight:600,color:T.text}}>{c.name}</div>
                        <div style={{fontSize:11,color:T.muted}}>📞 {c.phone} · 📍 {c.address}</div>
                      </div>
                    ))}
                    {matches.length===0&&(
                      <div style={{padding:"10px 14px",fontSize:12,color:T.muted}}>ไม่พบลูกค้า — จะสร้างใหม่อัตโนมัติ</div>
                    )}
                  </div>
                  );
                })()}
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                {[{k:"customerPhone",l:"เบอร์โทรศัพท์",ph:"0812345678"},{k:"customerAddress",l:"ที่อยู่จัดส่ง",ph:"บ้านเลขที่ ซอย ถนน..."}].map(f=>(
                  <div key={f.k}>
                    <label style={{fontSize:11,color:T.muted,display:"block",marginBottom:5,fontWeight:600}}>{f.l}</label>
                    <input value={orderForm[f.k]} onChange={e=>setOrderForm(p=>({...p,[f.k]:e.target.value}))} placeholder={f.ph}
                      style={{width:"100%",background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:9,padding:"9px 14px",fontFamily:"'Sarabun',sans-serif",fontSize:13,outline:"none"}}/>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Order items */}
          <div style={{fontSize:12,fontWeight:700,color:T.accent,marginBottom:10,textTransform:"uppercase",letterSpacing:"0.06em"}}>เลือกสินค้า</div>

          {/* 🧺 คละ — เพิ่มรายการโดยระบุแค่รุ่น + จำนวน (สี/ไซส์ กรอกทีหลัง) */}
          <div style={{marginBottom:10,background:"rgba(184,134,0,0.06)",border:`1px dashed ${T.amber}`,borderRadius:10,overflow:"hidden"}}>
            <div onClick={()=>setOrderMixExpanded(v=>!v)} style={{padding:"8px 12px",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"space-between",userSelect:"none"}}>
              <div style={{fontSize:11,fontWeight:700,color:T.amber}}>🧺 เพิ่มแบบคละ (ระบุสี/ไซส์ทีหลัง — ยังไม่ตัดสต๊อก)</div>
              <span style={{fontSize:10,color:T.amber,fontWeight:700}}>{orderMixExpanded?"▲ ย่อ":"▼ ขยาย"}</span>
            </div>
            {orderMixExpanded && (
              <div style={{padding:"0 12px 12px",display:"grid",gridTemplateColumns:"2fr 1fr auto",gap:8,alignItems:"end"}}>
                <select value={orderMixForm.clothingId} onChange={e=>setOrderMixForm(f=>({...f,clothingId:e.target.value}))}
                  style={{width:"100%",background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:8,padding:"8px 10px",fontFamily:"'Sarabun',sans-serif",fontSize:13,outline:"none"}}>
                  <option value="">-- เลือกรุ่น --</option>
                  {clothingItems.map(i=><option key={i.id} value={i.id}>{i.model}</option>)}
                </select>
                <input type="number" placeholder="จำนวน" value={orderMixForm.qty} onChange={e=>setOrderMixForm(f=>({...f,qty:e.target.value}))}
                  style={{width:"100%",background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:8,padding:"8px 10px",fontFamily:"monospace",fontSize:13,outline:"none",textAlign:"center"}}/>
                <button onClick={addOrderMixItem} disabled={!orderMixForm.clothingId||!(Number(orderMixForm.qty)>0)}
                  style={{padding:"8px 16px",borderRadius:8,border:"none",background:T.amber,color:"white",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"'Sarabun',sans-serif",whiteSpace:"nowrap",opacity:(!orderMixForm.clothingId||!(Number(orderMixForm.qty)>0))?0.4:1}}>
                  ➕ เพิ่มคละ
                </button>
              </div>
            )}
          </div>

          {/* Step 1: เลือกรุ่น + สี */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
            <div>
              <label style={{fontSize:11,color:T.muted,display:"block",marginBottom:5,fontWeight:600}}>รุ่นเสื้อ</label>
              <select value={orderItemForm.clothingId} onChange={e=>setOrderItemForm(f=>({...f,clothingId:e.target.value,colorIdx:""}))}
                style={{width:"100%",background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:9,padding:"9px 12px",fontFamily:"'Sarabun',sans-serif",fontSize:13,outline:"none"}}>
                <option value="">-- เลือกรุ่น --</option>
                {clothingItems.map(i=><option key={i.id} value={i.id}>{i.model}</option>)}
              </select>
            </div>
            <div>
              <label style={{fontSize:11,color:T.muted,display:"block",marginBottom:5,fontWeight:600}}>สี</label>
              <select value={orderItemForm.colorIdx} onChange={e=>setOrderItemForm(f=>({...f,colorIdx:e.target.value}))}
                style={{width:"100%",background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:9,padding:"9px 12px",fontFamily:"'Sarabun',sans-serif",fontSize:13,outline:"none"}}>
                <option value="">-- เลือกสี --</option>
                {orderItemForm.clothingId&&(clothingItems.find(i=>i.id===orderItemForm.clothingId)?.colors||[]).map((c,ci)=>(
                  <option key={ci} value={ci}>{c.colorName}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Step 2: ตารางไซส์ */}
          {orderItemForm.clothingId&&orderItemForm.colorIdx!==""&&(()=>{
            const item=clothingItems.find(i=>i.id===orderItemForm.clothingId);
            const col=item?.colors?.[Number(orderItemForm.colorIdx)];
            if(!item||!col) return null;
            // 📐 รวมไซส์: base ของประเภท + ไซส์เพิ่มเติมที่มีในสต๊อก (เช่น 6XL/7XL) → แบ่งเป็นแถวละ 4
            const stockKeys = Object.keys(col.stock || {});
            const allSizes = mergeSizes(getSizesFor(item), stockKeys);
            const sizeRows = [];
            for (let i = 0; i < allSizes.length; i += 4) sizeRows.push(allSizes.slice(i, i + 4));
            return (
              <div style={{marginBottom:14,background:"rgba(241,243,246,0.6)",borderRadius:10,border:"1px solid rgba(59,91,139,0.2)",overflow:"hidden"}}>
                <div style={{padding:"8px 14px",background:"rgba(59,91,139,0.08)",borderBottom:"1px solid rgba(59,91,139,0.15)",display:"flex",alignItems:"center",gap:8}}>
                  <div style={{width:12,height:12,borderRadius:2,background:col.hex,border:"1px solid rgba(255,255,255,0.15)"}}/>
                  <span style={{fontSize:12,color:T.accent,fontWeight:600}}>{item.model} · {col.colorName}</span>
                  <span style={{fontSize:10,color:T.muted,marginLeft:"auto"}}>กรอกจำนวนที่ต้องการสั่ง</span>
                </div>
                <div style={{padding:10,overflowX:"auto",WebkitOverflowScrolling:"touch"}}>
                  <div style={{display:"flex",flexDirection:"column",gap:8,minWidth:480}}>
                  {sizeRows.map((row,ri)=>(
                    <div key={ri} style={{display:"grid",gridTemplateColumns:`repeat(${row.length},1fr)`,gap:6,minWidth:480}}>
                      {row.map(sz=>{
                        const stock=(col.stock||{})[sz]||0;
                        const curVal=orderForm.items.find(i=>i.clothingId===orderItemForm.clothingId&&i.colorIdx===Number(orderItemForm.colorIdx)&&i.size===sz)?.qty||0;
                        // 🔓 ถ้าโหมด "ขายก่อน ไม่ตัดสต๊อก" — ไม่บังคับตรวจสต๊อก
                        const defer = !!orderForm.deferStockCut;
                        const noStock = stock===0 && !defer;
                        return (
                          <div key={sz} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 10px",background:noStock?"rgba(203,210,217,0.25)":stock===0&&defer?"rgba(124,58,237,0.06)":"rgba(241,243,246,0.5)",borderRadius:7,border:`1px solid ${noStock?"rgba(203,210,217,0.5)":stock===0&&defer?"rgba(124,58,237,0.25)":"rgba(59,91,139,0.18)"}`}}>
                            <div style={{minWidth:38,display:"flex",flexDirection:"column"}}>
                              <span style={{fontFamily:"monospace",fontWeight:700,fontSize:13,color:noStock?"#9aa5b1":T.accent}}>{sz}</span>
                              <span style={{fontSize:9,color:noStock?"#9aa5b1":stock===0&&defer?"#7c3aed":stock<5?"#fbbf24":"#22d3ee",fontFamily:"monospace"}}>{stock===0&&defer?"🔓":"มี "+stock}</span>
                            </div>
                            <input type="number" min="0" {...(defer?{}:{max:stock})}
                              defaultValue={curVal||""}
                              placeholder="0"
                              disabled={noStock}
                              key={`${orderItemForm.clothingId}-${orderItemForm.colorIdx}-${sz}`}
                              onBlur={e=>{
                                const raw=Math.max(0,Number(e.target.value)||0);
                                const val=defer?raw:Math.min(raw,stock);
                                if(val>0){
                                  setOrderForm(f=>{
                                    const idx=f.items.findIndex(i=>i.clothingId===orderItemForm.clothingId&&i.colorIdx===Number(orderItemForm.colorIdx)&&i.size===sz);
                                    const newItem={clothingId:orderItemForm.clothingId,clothingName:item.model,colorIdx:Number(orderItemForm.colorIdx),colorName:col.colorName,colorHex:col.hex,size:sz,qty:val,stock};
                                    const items=[...f.items];
                                    if(idx>=0) items[idx]=newItem; else items.push(newItem);
                                    return {...f,items};
                                  });
                                } else {
                                  setOrderForm(f=>({...f,items:f.items.filter(i=>!(i.clothingId===orderItemForm.clothingId&&i.colorIdx===Number(orderItemForm.colorIdx)&&i.size===sz))}));
                                }
                              }}
                              style={{flex:1,minWidth:0,textAlign:"center",background:noStock?"rgba(203,210,217,0.3)":stock===0&&defer?"rgba(124,58,237,0.08)":"rgba(59,91,139,0.1)",border:`1px solid ${noStock?"rgba(203,210,217,0.5)":stock===0&&defer?"rgba(124,58,237,0.35)":"rgba(59,91,139,0.25)"}`,borderRadius:6,color:noStock?"#9aa5b1":stock===0&&defer?"#7c3aed":"#3b5b8b",fontFamily:"monospace",fontSize:13,fontWeight:600,padding:"6px 4px",outline:"none",cursor:noStock?"not-allowed":"text"}}
                            />
                          </div>
                        );
                      })}
                    </div>
                  ))}
                  </div>
                </div>
                <div style={{padding:"8px 14px",borderTop:"1px solid rgba(203,210,217,0.5)",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <span style={{fontSize:11,color:T.muted}}>💡 กรอกจำนวน แล้วคลิกออกจากช่องเพื่อบันทึก (บน tablet เลื่อนซ้าย-ขวาได้)</span>
                  <span style={{fontSize:12,color:T.accent,fontFamily:"monospace",fontWeight:700}}>
                    สั่ง {orderForm.items.filter(i=>i.clothingId===orderItemForm.clothingId&&i.colorIdx===Number(orderItemForm.colorIdx)).reduce((s,i)=>s+i.qty,0)} ชิ้น
                  </span>
                </div>
              </div>
            );
          })()}

          {/* Step 2b: เพิ่มแถวอิสระ — auto-match clothing + checkbox ตัดสต๊อก */}
          {(() => {
            const fname = freeItemForm.name.trim().toLowerCase();
            const fcolor = freeItemForm.colorName.trim().toLowerCase();
            const fsize = freeItemForm.size.trim();
            const fqty = Number(freeItemForm.qty) || 0;
            let matched = null;
            if (fname && fcolor && fsize) {
              for (const it of clothingItems) {
                if ((it.model||"").trim().toLowerCase() !== fname) continue;
                const ci = (it.colors||[]).findIndex(c => (c.colorName||"").trim().toLowerCase() === fcolor);
                if (ci < 0) continue;
                const stock = Number((it.colors[ci].stock||{})[fsize]) || 0;
                matched = { item: it, colorIdx: ci, color: it.colors[ci], stock };
                break;
              }
            }
            const willLink = matched && freeItemCutStock;
            const stockShort = willLink && matched.stock < fqty;
            return (
            <div style={{marginBottom:14,background:"rgba(217,119,6,0.04)",border:"1px dashed rgba(217,119,6,0.35)",borderRadius:10,overflow:"hidden"}}>
              <div onClick={()=>setOrderFreeExpanded(v=>!v)} style={{padding:"8px 12px",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"space-between",userSelect:"none"}}>
                <div style={{fontSize:11,fontWeight:700,color:"#92400e",letterSpacing:"0.04em"}}>✍️ เพิ่มแถวอิสระ (พิมพ์เอง)</div>
                <span style={{fontSize:10,color:"#92400e",fontWeight:700}}>{orderFreeExpanded?"▲ ย่อ":"▼ ขยาย"}</span>
              </div>
              {orderFreeExpanded && <>
              <div style={{padding:"0 12px",display:"grid",gridTemplateColumns:"2fr 1fr 1fr 80px 80px",gap:6,alignItems:"end"}}>
                <input value={freeItemForm.name} onChange={e=>setFreeItemForm(f=>({...f,name:e.target.value}))} placeholder="รุ่น / ชื่อสินค้า"
                  style={{background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:7,padding:"7px 10px",fontFamily:"'Sarabun',sans-serif",fontSize:12,outline:"none"}}/>
                <input value={freeItemForm.colorName} onChange={e=>setFreeItemForm(f=>({...f,colorName:e.target.value}))} placeholder="สี"
                  style={{background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:7,padding:"7px 10px",fontFamily:"'Sarabun',sans-serif",fontSize:12,outline:"none"}}/>
                <input value={freeItemForm.size} onChange={e=>setFreeItemForm(f=>({...f,size:e.target.value}))} placeholder="ไซส์ (เช่น XL, 12)"
                  style={{background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:7,padding:"7px 10px",fontFamily:"'Sarabun',sans-serif",fontSize:12,outline:"none",fontWeight:600,textAlign:"center"}}/>
                <input type="number" min="1" value={freeItemForm.qty} onChange={e=>setFreeItemForm(f=>({...f,qty:e.target.value}))} placeholder="จำนวน"
                  style={{background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:7,padding:"7px 10px",fontFamily:"'Sarabun',sans-serif",fontSize:12,outline:"none",fontFamily:"monospace",textAlign:"center"}}/>
                <button onClick={()=>{
                  const name=freeItemForm.name.trim(); const qty=Number(freeItemForm.qty)||0;
                  if(!name||qty<=0) return;
                  if (willLink) {
                    setOrderForm(f=>({...f,items:[...f.items,{
                      clothingId: matched.item.id,
                      clothingName: matched.item.model,
                      colorIdx: matched.colorIdx,
                      colorName: matched.color.colorName,
                      colorHex: matched.color.hex || "#94a3b8",
                      size: fsize, qty,
                      stock: matched.stock
                    }]}));
                  } else {
                    setOrderForm(f=>({...f,items:[...f.items,{
                      freeText:true,
                      clothingId:`free_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
                      clothingName:name,
                      colorIdx:0, colorName:freeItemForm.colorName||"-", colorHex:"#94a3b8",
                      size:freeItemForm.size||"-", qty
                    }]}));
                  }
                  setFreeItemForm({name:"",colorName:"",size:"",qty:""});
                  setFreeItemCutStock(true);
                }} disabled={!freeItemForm.name.trim()||!Number(freeItemForm.qty)}
                  style={{padding:"7px 12px",borderRadius:7,border:"none",background:willLink?"#16a34a":"#d97706",color:"white",fontSize:12,fontWeight:700,cursor:freeItemForm.name.trim()&&Number(freeItemForm.qty)?"pointer":"not-allowed",opacity:freeItemForm.name.trim()&&Number(freeItemForm.qty)?1:0.4,fontFamily:"inherit"}}>{willLink?"+ ตัดสต๊อก":"+ เพิ่ม"}</button>
              </div>
              <div style={{padding:"0 12px 12px"}}>
              {matched ? (
                <div style={{marginTop:8,padding:"8px 10px",background:"rgba(22,163,74,0.08)",border:"1px solid rgba(22,163,74,0.25)",borderRadius:7,display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                  <span style={{fontSize:11,color:"#15803d",fontWeight:700}}>✓ พบในระบบ:</span>
                  <span style={{fontSize:11,color:"#1e293b"}}>{matched.item.model} / {matched.color.colorName} / {fsize}</span>
                  <span style={{fontSize:11,color:matched.stock>0?"#15803d":"#dc2626",fontFamily:"monospace",fontWeight:700}}>คงเหลือ {matched.stock} ตัว</span>
                  <label style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:6,cursor:"pointer",fontSize:11,color:"#15803d",fontWeight:700}}>
                    <input type="checkbox" checked={freeItemCutStock} onChange={e=>setFreeItemCutStock(e.target.checked)} style={{cursor:"pointer"}}/>
                    ตัดสต๊อก
                  </label>
                  {stockShort && <div style={{flex:"1 0 100%",fontSize:10,color:"#dc2626",fontWeight:700}}>⚠️ สต๊อกไม่พอ (มี {matched.stock}, สั่ง {fqty}) — จะตัดเหลือ 0</div>}
                </div>
              ) : (
                <div style={{fontSize:10,color:"#92400e",marginTop:6,opacity:0.8}}>💡 กรอกครบ (รุ่น/สี/ไซส์) ระบบจะค้นในคลังให้อัตโนมัติ — ถ้าไม่เจอจะเป็นรายการอิสระ (ไม่ตัดสต๊อก)</div>
              )}
              </div>
              </>}
            </div>
            );
          })()}

          {/* Step 3: สรุปรายการ */}
          {orderForm.items.length>0&&(
            <div style={{background:"rgba(241,243,246,0.6)",borderRadius:10,border:`1px solid ${T.border}`,marginBottom:14,overflow:"hidden"}}>
              <div style={{padding:"8px 14px",background:"rgba(241,243,246,0.8)",borderBottom:`1px solid ${T.border}`,fontSize:10,color:T.muted,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.06em"}}>📋 สรุปรายการที่เลือก</div>
              {Object.entries(orderForm.items.reduce((acc,oi)=>{
                const k=`${oi.clothingId||oi.clothingName}-${oi.colorIdx??""}|${oi.colorName||""}|${oi.variant||""}`;
                if(!acc[k]) acc[k]={clothingName:oi.clothingName,colorName:oi.colorName,colorHex:oi.colorHex,clothingId:oi.clothingId,colorIdx:oi.colorIdx,variant:oi.variant||"",fabricType:oi.fabricType||"",collarType:oi.collarType||"",jobDescription:oi.jobDescription||"",sizes:[]};
                acc[k].sizes.push({size:oi.size,qty:oi.qty});
                return acc;
              },{})).map(([k,g],gi,arr)=>(
                <div key={k} style={{padding:"10px 14px",borderBottom:gi<arr.length-1?`1px solid ${T.border}`:"none",display:"flex",alignItems:"center",gap:12}}>
                  <div style={{width:10,height:10,borderRadius:2,background:g.colorHex,border:"1px solid rgba(255,255,255,0.15)",flexShrink:0}}/>
                  <div style={{flex:1}}>
                    <span style={{fontSize:12,fontWeight:600,color:T.text}}>{g.clothingName}</span>
                    <span style={{fontSize:11,color:T.sub,marginLeft:8}}>{g.colorName}</span>
                  </div>
                  <div style={{display:"flex",gap:6,flexWrap:"wrap",justifyContent:"flex-end"}}>
                    {g.sizes.slice().sort((a,b)=>compareSizes(a.size,b.size)).map(s=>(
                      <span key={s.size} style={{background:"rgba(59,91,139,0.1)",border:"1px solid rgba(59,91,139,0.2)",borderRadius:6,padding:"2px 8px",fontSize:11,fontFamily:"monospace",color:T.accent,fontWeight:700}}>
                        {s.size}×{s.qty}
                      </span>
                    ))}
                  </div>
                  <button onClick={()=>setOrderForm(f=>({...f,items:f.items.filter(i=>!(i.clothingId===g.clothingId&&i.colorIdx===g.colorIdx))}))} style={{background:"rgba(248,113,113,0.08)",border:"1px solid rgba(248,113,113,0.2)",borderRadius:5,padding:"2px 8px",cursor:"pointer",fontSize:11,color:"#f87171",flexShrink:0}}>✕</button>
                </div>
              ))}
              <div style={{padding:"8px 14px",borderTop:`1px solid ${T.border}`,display:"flex",justifyContent:"flex-end",fontSize:12,color:T.sub}}>
                รวมทั้งหมด <b style={{color:T.accent,fontFamily:"monospace",marginLeft:6}}>{orderForm.items.reduce((s,i)=>s+i.qty,0)}</b> ชิ้น
              </div>
            </div>
          )}

          <div style={{marginBottom:10}}>
            <label style={{fontSize:11,color:T.muted,display:"block",marginBottom:5,fontWeight:600}}>🚚 ขนส่ง</label>
            <input list="shipping-presets" value={orderForm.shipping||""} onChange={e=>setOrderForm(f=>({...f,shipping:e.target.value}))} placeholder="เช่น Kerry, Flash, ไปรษณีย์, ลูกค้ารับเอง..."
              style={{width:"100%",background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:9,padding:"9px 14px",fontFamily:"'Sarabun',sans-serif",fontSize:13,outline:"none"}}/>
            <datalist id="shipping-presets">
              <option value="Kerry Express"/>
              <option value="Flash Express"/>
              <option value="J&T Express"/>
              <option value="ไปรษณีย์ไทย"/>
              <option value="Best Express"/>
              <option value="Ninja Van"/>
              <option value="ลูกค้ามารับเอง"/>
              <option value="ส่งเอง"/>
              <option value="ลูกค้าจัดขนส่งเอง"/>
            </datalist>
          </div>

          {/* 🔓 ขายก่อน ไม่ตัดสต๊อก — สำหรับกรณียังไม่ได้นับสต๊อก / ขายคนสนิท */}
          <div style={{marginBottom:10,padding:"9px 12px",background:orderForm.deferStockCut?"rgba(124,58,237,0.08)":"rgba(241,243,246,0.5)",border:`1px solid ${orderForm.deferStockCut?"rgba(124,58,237,0.35)":T.border}`,borderRadius:9,transition:"all 0.15s"}}>
            <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",userSelect:"none"}}>
              <input type="checkbox" checked={!!orderForm.deferStockCut} onChange={e=>setOrderForm(f=>({...f,deferStockCut:e.target.checked}))} style={{cursor:"pointer",accentColor:"#7c3aed",width:16,height:16}}/>
              <div>
                <div style={{fontSize:12,fontWeight:700,color:orderForm.deferStockCut?"#7c3aed":T.text}}>🔓 ขายก่อน — ไม่ตัดสต๊อก</div>
                <div style={{fontSize:10,color:T.muted,marginTop:1}}>เหมาะกรณียังไม่ได้นับสต๊อก / ขายให้คนสนิท · จะออกใบขายได้ทันที ค่อยไปแก้สต๊อกเมื่อนับเสร็จ</div>
              </div>
            </label>
          </div>

          <div>
            <label style={{fontSize:11,color:T.muted,display:"block",marginBottom:5,fontWeight:600}}>หมายเหตุ</label>
            <input value={orderForm.note} onChange={e=>setOrderForm(f=>({...f,note:e.target.value}))} placeholder="หมายเหตุเพิ่มเติม..."
              style={{width:"100%",background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:9,padding:"9px 14px",fontFamily:"'Sarabun',sans-serif",fontSize:13,outline:"none",marginBottom:16}}/>
          </div>

          <div style={{display:"flex",gap:10}}>
            <BtnGhost onClick={()=>onClose()} style={{flex:1}}>ยกเลิก</BtnGhost>
            <BtnPrimary onClick={handleConfirmOrder} disabled={orderForm.items.length===0} style={{flex:2,opacity:orderForm.items.length===0?0.45:1}}>
              {orderForm.items.length===0
                ? "กรุณาเพิ่มสินค้าก่อน"
                : editingOrderId
                  ? "💾 บันทึกการแก้ไข"
                  : "✅ ยืนยันใบสั่งของ + ตัดสต็อก"}
            </BtnPrimary>
          </div>
        </Modal>
  );
}
