import React from "react";
import { T } from "../theme";
import { Modal, BtnGhost, BtnDanger } from "./ui";

export default function DeleteClothingConfirm({
  target,
  deleteConfirmText, setDeleteConfirmText,
  onClose,
  handleDeleteClothingItem,
}) {
  if (!target) return null;
  const it = target;
  const totalStock = (it.colors||[]).reduce((s,c)=>s+Object.values(c.stock||{}).reduce((a,b)=>a+(Number(b)||0),0),0);
  const matched = deleteConfirmText.trim() === (it.model||"").trim();
  const hasStock = totalStock > 0;
  return (
    <Modal onClose={onClose} w={460}>
      <div style={{textAlign:"center",marginBottom:6}}>
        <div style={{fontSize:42,marginBottom:8}}>🗑️</div>
        <div style={{fontSize:16,fontWeight:800,color:T.text}}>ลบรุ่น "{it.model}"?</div>
      </div>
      <div style={{padding:"10px 12px",background:hasStock?"#fef2f2":"#fffbeb",border:`1px solid ${hasStock?"#fecaca":"#fde68a"}`,borderRadius:9,marginBottom:14,fontSize:13,color:hasStock?"#991b1b":"#92400e",lineHeight:1.6}}>
        {hasStock
          ? <>⚠️ รุ่นนี้ยัง<b>มีสต็อก {totalStock.toLocaleString("th-TH")} ตัว</b> ({(it.colors||[]).length} สี)<br/>ถ้าลบ ข้อมูลสต็อก + ประวัติทั้งหมดจะหายถาวร — ย้อนคืนไม่ได้</>
          : <>รุ่นนี้ไม่มีสต็อกแล้ว · {(it.colors||[]).length} สี — ลบแล้วย้อนคืนไม่ได้</>}
      </div>
      <label style={{fontSize:12,color:T.sub,display:"block",marginBottom:6}}>พิมพ์ชื่อรุ่น <b style={{color:T.text}}>{it.model}</b> เพื่อยืนยัน:</label>
      <input value={deleteConfirmText} onChange={e=>setDeleteConfirmText(e.target.value)} placeholder={it.model} autoFocus
        style={{width:"100%",boxSizing:"border-box",background:T.input,border:`1px solid ${matched?"#16a34a":T.inputBorder}`,color:T.text,borderRadius:9,padding:"10px 14px",fontFamily:"'Sarabun',sans-serif",fontSize:14,outline:"none",marginBottom:16}}/>
      <div style={{display:"flex",gap:10}}>
        <BtnGhost onClick={onClose} style={{flex:1}}>ยกเลิก</BtnGhost>
        <BtnDanger onClick={async()=>{await handleDeleteClothingItem(it.id);onClose();setDeleteConfirmText("");}} disabled={!matched} style={{flex:1,opacity:matched?1:0.45,cursor:matched?"pointer":"not-allowed"}}>🗑 ลบถาวร</BtnDanger>
      </div>
    </Modal>
  );
}
