import React from "react";
import { T } from "../theme";
import { Modal, MHead, BtnPrimary, BtnGhost } from "./ui";

const PAYMENT_METHODS = ["โอน","COD","เงินสด"];

export default function PaymentModal({
  invoice,
  payForm, setPayForm,
  paySaving,
  role = {},
  closePaymentModal,
  getPaidTotal,
  handleAddPayment,
  handleRemovePayment,
  handlePaySlipUpload,
}) {
  if (!invoice) return null;
  const inv = invoice;
  const paid = getPaidTotal(inv);
  const total = Number(inv.total)||0;
  const remaining = Math.max(0, total - paid);
  const pct = total>0 ? Math.min(100, Math.round(paid/total*100)) : 0;
  return (
        <Modal onClose={closePaymentModal} w={680}>
          <MHead title={`💵 การชำระเงิน · ${inv.invoiceNo}`} sub={`${inv.customerName} · ${inv.customerPhone||""}`} onClose={closePaymentModal}/>
          {/* สรุปยอด */}
          <div style={{padding:"14px 16px",background:"linear-gradient(135deg,rgba(59,91,139,0.06),rgba(16,185,129,0.04))",border:`1px solid ${T.border}`,borderRadius:10,marginBottom:14,display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12}}>
            <div><div style={{fontSize:10,color:T.muted,fontWeight:600,marginBottom:2}}>ยอดบิล</div><div style={{fontSize:16,fontWeight:800,color:T.text,fontFamily:"monospace"}}>฿{total.toLocaleString("th-TH",{minimumFractionDigits:2})}</div></div>
            <div><div style={{fontSize:10,color:T.muted,fontWeight:600,marginBottom:2}}>ชำระแล้ว</div><div style={{fontSize:16,fontWeight:800,color:T.green,fontFamily:"monospace"}}>฿{paid.toLocaleString("th-TH",{minimumFractionDigits:2})}</div><div style={{fontSize:10,color:T.muted}}>({pct}%)</div></div>
            <div><div style={{fontSize:10,color:T.muted,fontWeight:600,marginBottom:2}}>คงเหลือ</div><div style={{fontSize:16,fontWeight:800,color:remaining>0?T.amber:T.green,fontFamily:"monospace"}}>฿{remaining.toLocaleString("th-TH",{minimumFractionDigits:2})}</div></div>
          </div>
          {/* progress bar */}
          <div style={{height:6,background:T.border,borderRadius:3,overflow:"hidden",marginBottom:16}}>
            <div style={{height:"100%",width:`${pct}%`,background:pct>=100?T.green:T.amber,transition:"width 0.3s"}}/>
          </div>

          {/* รายการชำระที่มีแล้ว */}
          {(inv.payments||[]).length>0&&(
            <div style={{marginBottom:14}}>
              <div style={{fontSize:11,color:T.muted,fontWeight:700,marginBottom:8,letterSpacing:"0.04em"}}>📜 ประวัติการชำระ ({(inv.payments||[]).length} รายการ)</div>
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                {(inv.payments||[]).map(p=>(
                  <div key={p.id} style={{padding:"8px 10px",background:"white",border:`1px solid ${T.border}`,borderRadius:7,display:"grid",gridTemplateColumns:"60px 1fr auto auto 28px",gap:8,alignItems:"center"}}>
                    <span style={{padding:"3px 8px",borderRadius:10,fontSize:10,fontWeight:700,background:p.method==="โอน"?"rgba(59,91,139,0.1)":p.method==="COD"?"rgba(245,158,11,0.1)":"rgba(16,185,129,0.1)",color:p.method==="โอน"?T.accent:p.method==="COD"?T.amber:T.green,textAlign:"center"}}>{p.method}</span>
                    <div>
                      <div style={{fontSize:12,color:T.text,fontWeight:600}}>{p.date}{p.bank?` · ${p.bank}`:""}</div>
                      {p.note&&<div style={{fontSize:10,color:T.muted,marginTop:1}}>{p.note}</div>}
                      <div style={{fontSize:9,color:T.muted,marginTop:1}}>โดย {p.receivedBy||"-"}</div>
                    </div>
                    <span style={{fontSize:13,fontWeight:800,color:T.green,fontFamily:"monospace"}}>฿{Number(p.amount).toLocaleString("th-TH",{minimumFractionDigits:2})}</span>
                    {p.slip ? (
                      <button onClick={()=>window.open(p.slip,"_blank")} title="ดูสลิป" style={{padding:"4px 8px",background:"rgba(59,91,139,0.08)",border:"1px solid rgba(59,91,139,0.25)",borderRadius:5,color:T.accent,fontSize:10,cursor:"pointer",fontFamily:"inherit"}}>🧾 ดู</button>
                    ) : <span style={{fontSize:10,color:T.muted}}>—</span>}
                    {role.canDelete&&<button onClick={()=>handleRemovePayment(p.id)} title="ลบ" style={{padding:"4px 6px",background:"#fef2f2",border:"1px solid #fecaca",borderRadius:5,color:T.red,fontSize:11,cursor:"pointer"}}>✕</button>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ฟอร์มเพิ่มการชำระ */}
          <div style={{padding:14,background:"rgba(16,185,129,0.04)",border:"1px dashed rgba(16,185,129,0.3)",borderRadius:10,marginBottom:10}}>
            <div style={{fontSize:11,color:T.green,fontWeight:700,marginBottom:10,letterSpacing:"0.04em"}}>➕ เพิ่มการชำระเงิน</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:8}}>
              <div>
                <label style={{fontSize:10,color:T.muted,display:"block",marginBottom:3,fontWeight:600}}>จำนวนเงิน (บาท) *</label>
                <input type="number" min="0" step="0.01" value={payForm.amount} onFocus={e=>e.target.select()}
                  onChange={e=>setPayForm(f=>({...f,amount:e.target.value}))}
                  style={{width:"100%",background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:6,padding:"7px 9px",fontFamily:"monospace",fontSize:13,fontWeight:700,outline:"none",textAlign:"right"}}/>
              </div>
              <div>
                <label style={{fontSize:10,color:T.muted,display:"block",marginBottom:3,fontWeight:600}}>ช่องทาง *</label>
                <select value={payForm.method} onChange={e=>setPayForm(f=>({...f,method:e.target.value}))}
                  style={{width:"100%",background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:6,padding:"7px 9px",fontSize:12,outline:"none",cursor:"pointer",fontFamily:"inherit"}}>
                  {PAYMENT_METHODS.map(m=><option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <label style={{fontSize:10,color:T.muted,display:"block",marginBottom:3,fontWeight:600}}>ธนาคาร / หมายเหตุช่องทาง</label>
                <input value={payForm.bank} onChange={e=>setPayForm(f=>({...f,bank:e.target.value}))}
                  placeholder={payForm.method==="โอน"?"เช่น SCB, KBank":payForm.method==="COD"?"Kerry/Flash":""}
                  style={{width:"100%",background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:6,padding:"7px 9px",fontSize:12,outline:"none",fontFamily:"inherit"}}/>
              </div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
              <div>
                <label style={{fontSize:10,color:T.muted,display:"block",marginBottom:3,fontWeight:600}}>วันที่ / เวลาที่ชำระ</label>
                <input value={payForm.date} onChange={e=>setPayForm(f=>({...f,date:e.target.value}))}
                  style={{width:"100%",background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:6,padding:"7px 9px",fontSize:12,outline:"none",fontFamily:"inherit"}}/>
              </div>
              <div>
                <label style={{fontSize:10,color:T.muted,display:"block",marginBottom:3,fontWeight:600}}>หมายเหตุ</label>
                <input value={payForm.note} onChange={e=>setPayForm(f=>({...f,note:e.target.value}))}
                  placeholder="เช่น มัดจำ 50%"
                  style={{width:"100%",background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:6,padding:"7px 9px",fontSize:12,outline:"none",fontFamily:"inherit"}}/>
              </div>
            </div>
            {/* สลิป */}
            <div style={{display:"flex",alignItems:"center",gap:8,padding:8,background:"white",border:`1px dashed ${T.border}`,borderRadius:7}}>
              {payForm.slip ? (
                <>
                  <img src={payForm.slip} alt="slip" style={{width:64,height:64,objectFit:"cover",borderRadius:6,border:`1px solid ${T.border}`}}/>
                  <div style={{flex:1,fontSize:11,color:T.text}}>
                    <div style={{fontWeight:600}}>{payForm.slipFileName||"slip.jpg"}</div>
                    <div style={{color:T.muted,fontSize:10,marginTop:1}}>บีบรูปเรียบร้อย</div>
                  </div>
                  <button onClick={()=>setPayForm(f=>({...f,slip:"",slipFileName:""}))} style={{padding:"4px 10px",background:"#fef2f2",border:"1px solid #fecaca",borderRadius:5,color:T.red,fontSize:11,cursor:"pointer",fontFamily:"inherit"}}>✕ ลบ</button>
                </>
              ) : (
                <>
                  <span style={{fontSize:20}}>🧾</span>
                  <div style={{flex:1,fontSize:11,color:T.muted}}>แนบสลิปโอนเงิน (ถ้ามี)</div>
                  <label style={{padding:"5px 12px",background:"rgba(59,91,139,0.08)",border:"1px solid rgba(59,91,139,0.3)",borderRadius:6,color:T.accent,fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
                    📁 อัปโหลด
                    <input type="file" accept="image/*" style={{display:"none"}} onChange={handlePaySlipUpload}/>
                  </label>
                </>
              )}
            </div>
          </div>

          <div style={{display:"flex",gap:8}}>
            <BtnGhost onClick={closePaymentModal} disabled={paySaving} style={{flex:1}}>ปิด</BtnGhost>
            <BtnPrimary onClick={handleAddPayment} disabled={paySaving||!Number(payForm.amount)} style={{flex:2}}>{paySaving?"⏳ กำลังบันทึก...":"💾 บันทึกการชำระ"}</BtnPrimary>
          </div>
        </Modal>
  );
}
