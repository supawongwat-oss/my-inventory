import React, { useState } from "react";
import { Modal, MHead, Input, BtnPrimary, BtnGhost, BtnDanger, Toast } from "./ui";
import { collection, addDoc, updateDoc, doc, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase";
import { logAudit, AUDIT_ACTIONS } from "../utils/audit";

const T = { border:"#e3e8ef", sub:"#5b6b85", text:"#1f2a44", muted:"#8a9bb3", accent:"#3b5b8b", green:"#16a34a", amber:"#d97706", red:"#dc2626" };

export const PRODUCTION_STEPS = [
  "พิมพ์ลาย",
  "ตัดผ้า",
  "รีดลงผ้า",
  "เย็บ",
  "รีดให้เรียบ",
  "แพ๊ค/QC",
  "เข้าคลัง",
];

const fmt = (n) => Number(n || 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtInt = (n) => Number(n || 0).toLocaleString("th-TH");

function nowStr() {
  const d = new Date(); const p=n=>String(n).padStart(2,"0");
  return `${p(d.getDate())}/${p(d.getMonth()+1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function ProductionStatusModal({ order, products = [], clothingItems = [], user, onClose, collectionName = "productionOrders", isCustom = false }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");

  if (!order) return null;

  const currentIdx = PRODUCTION_STEPS.indexOf(order.status);
  const isCancelled = order.status === "ยกเลิก";
  const isFinal = order.status === "เข้าคลัง";
  const nextStep = (currentIdx >= 0 && currentIdx < PRODUCTION_STEPS.length - 1) ? PRODUCTION_STEPS[currentIdx + 1] : null;

  const consumeMaterials = async () => {
    const mats = order.costSnapshot?.materials || [];
    for (const m of mats) {
      const prod = products.find(p => p.id === m.productId);
      if (!prod) continue;
      const oldQty = Number(prod.qty) || 0;
      const newQty = oldQty - (Number(m.totalQty) || 0);
      await updateDoc(doc(db, "products", prod.id), {
        qty: newQty,
        lastUpdate: nowStr(),
        history: [
          { action:"ผลิต-ใช้วัตถุดิบ", by:user?.name || "", date:nowStr(), note:`${order.prodNo} · -${fmtInt(m.totalQty)} ${m.unit||prod.unit||""}` },
          ...(prod.history || [])
        ]
      });
      await addDoc(collection(db, "transactions"), {
        type: "ผลิต-รับวัตถุดิบออก",
        code: prod.code, name: prod.name,
        qty: Number(m.totalQty) || 0,
        by: user?.name || "", date: nowStr(),
        note: `${order.prodNo} · ${order.clothingName}`,
        createdAt: serverTimestamp(),
      });
    }
  };

  const returnMaterials = async () => {
    const mats = order.costSnapshot?.materials || [];
    for (const m of mats) {
      const prod = products.find(p => p.id === m.productId);
      if (!prod) continue;
      const oldQty = Number(prod.qty) || 0;
      const newQty = oldQty + (Number(m.totalQty) || 0);
      await updateDoc(doc(db, "products", prod.id), {
        qty: newQty,
        lastUpdate: nowStr(),
        history: [
          { action:"ยกเลิกผลิต-คืนวัตถุดิบ", by:user?.name || "", date:nowStr(), note:`${order.prodNo} · +${fmtInt(m.totalQty)} ${m.unit||prod.unit||""}` },
          ...(prod.history || [])
        ]
      });
      await addDoc(collection(db, "transactions"), {
        type: "ผลิต-คืนวัตถุดิบ",
        code: prod.code, name: prod.name,
        qty: Number(m.totalQty) || 0,
        by: user?.name || "", date: nowStr(),
        note: `ยกเลิก ${order.prodNo}`,
        createdAt: serverTimestamp(),
      });
    }
  };

  const stockFinished = async () => {
    const clothing = clothingItems.find(c => c.id === order.clothingId);
    if (!clothing) return;
    // รวม qty per (colorIdx, size)
    const addMap = {}; // key = colorIdx, value = { size: qty }
    (order.items || []).forEach(it => {
      const ci = Number(it.colorIdx) || 0;
      if (!addMap[ci]) addMap[ci] = {};
      addMap[ci][it.size] = (addMap[ci][it.size] || 0) + (Number(it.qty) || 0);
    });
    const newColors = (clothing.colors || []).map((c, idx) => {
      const adds = addMap[idx];
      if (!adds) return c;
      const stock = { ...(c.stock || {}) };
      Object.entries(adds).forEach(([size, qty]) => {
        stock[size] = (Number(stock[size]) || 0) + qty;
      });
      return { ...c, stock };
    });
    await updateDoc(doc(db, "clothing", clothing.id), { colors: newColors });
    // log transaction รวมรายการ
    for (const it of (order.items || [])) {
      await addDoc(collection(db, "transactions"), {
        type: "ผลิต-รับเข้าคลัง",
        code: clothing.id,
        name: `${clothing.model} / ${it.colorName} / ${it.size}`,
        qty: Number(it.qty) || 0,
        by: user?.name || "", date: nowStr(),
        note: `${order.prodNo}`,
        category: "เสื้อผ้า",
        createdAt: serverTimestamp(),
      });
    }
  };

  const advance = async () => {
    if (!nextStep || busy) return;
    setBusy(true);
    try {
      const willConsume = (order.status === "พิมพ์ลาย" || currentIdx < 0) && !order.materialsConsumed;
      // กฎ: materialsConsumed = true เกิดขึ้น ณ ตอนสร้าง (status เริ่มเป็น "พิมพ์ลาย")
      // แต่ side effect จริง (หัก stock) เกิด ณ ตอนกด "ยืนยันเริ่มผลิต" → เลื่อนไป "ตัดผ้า"
      // เปลี่ยนนิยาม: หัก stock ทันทีก่อนเลื่อนออกจาก "พิมพ์ลาย" ครั้งแรก
      const needsConsume = !isCustom && order.status === "พิมพ์ลาย" && !order.materialsConsumed;
      if (needsConsume) await consumeMaterials();

      const needsStock = !isCustom && nextStep === "เข้าคลัง" && !order.finishedStocked;
      if (needsStock) await stockFinished();

      const update = {
        status: nextStep,
        statusHistory: [
          ...(order.statusHistory || []),
          { status: nextStep, at: nowStr(), by: user?.name || "", note: note || "" }
        ],
      };
      if (needsConsume) update.materialsConsumed = true;
      if (needsStock) update.finishedStocked = true;

      await updateDoc(doc(db, collectionName, order.id), update);
      logAudit(user, {
        action: AUDIT_ACTIONS.PRODUCTION_STATUS,
        collection: collectionName,
        targetId: order.id,
        targetLabel: `${order.prodNo} · ${order.clothingName}`,
        note: `${order.status} → ${nextStep}${needsConsume ? " · หักวัตถุดิบ" : ""}${needsStock ? " · รับเข้าคลัง" : ""}${isCustom ? " · (custom)" : ""}${note ? " · " + note : ""}`,
      });
      setToast(`เลื่อนเป็น "${nextStep}" สำเร็จ`);
      setTimeout(() => { onClose && onClose(); }, 700);
    } catch (e) {
      console.error(e);
      setToast("เกิดข้อผิดพลาด: " + (e.message || e));
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (busy) return;
    if (!window.confirm("ยืนยันยกเลิกใบสั่งผลิตนี้?\n" + (!isCustom && order.materialsConsumed && !order.finishedStocked ? "ระบบจะคืนวัตถุดิบกลับเข้าคลังให้อัตโนมัติ" : ""))) return;
    setBusy(true);
    try {
      if (!isCustom && order.materialsConsumed && !order.finishedStocked) await returnMaterials();
      const update = {
        status: "ยกเลิก",
        statusHistory: [...(order.statusHistory || []), { status:"ยกเลิก", at:nowStr(), by:user?.name || "", note: note || "" }],
      };
      if (!isCustom && order.materialsConsumed && !order.finishedStocked) update.materialsConsumed = false;
      await updateDoc(doc(db, collectionName, order.id), update);
      logAudit(user, {
        action: AUDIT_ACTIONS.PRODUCTION_CANCEL,
        collection: collectionName,
        targetId: order.id,
        targetLabel: `${order.prodNo} · ${order.clothingName}`,
        note: note || "ยกเลิกใบสั่งผลิต",
      });
      setToast("ยกเลิกใบสั่งผลิตสำเร็จ");
      setTimeout(() => { onClose && onClose(); }, 700);
    } catch (e) {
      console.error(e);
      setToast("เกิดข้อผิดพลาด: " + (e.message || e));
      setBusy(false);
    }
  };

  return (
    <Modal onClose={onClose} w={680}>
      <MHead title={`⚙️ สถานะการผลิต · ${order.prodNo}`} sub={`${order.clothingName} · รวม ${fmtInt(order.totalQty)} ตัว`} onClose={onClose}/>
      {toast && <Toast msg={toast}/>}

      {/* Stepper */}
      <div style={{display:"flex",alignItems:"center",gap:4,marginBottom:18,flexWrap:"wrap"}}>
        {PRODUCTION_STEPS.map((step, idx) => {
          const done = !isCancelled && idx <= currentIdx;
          const active = !isCancelled && idx === currentIdx;
          const bg = isCancelled ? "#f1f5f9" : (done ? "#3b5b8b" : "#f1f5f9");
          const color = isCancelled ? T.muted : (done ? "white" : T.muted);
          return (
            <React.Fragment key={step}>
              <div style={{padding:"6px 10px",borderRadius:16,background:bg,color,fontSize:11,fontWeight:active?700:500,border:active?"2px solid #1e3a5f":"none"}}>
                {idx+1}. {step}
              </div>
              {idx < PRODUCTION_STEPS.length-1 && <div style={{width:8,height:2,background:T.border}}/>}
            </React.Fragment>
          );
        })}
      </div>

      {isCancelled && (
        <div style={{padding:14,background:"#fef2f2",border:"1px solid #fecaca",borderRadius:10,color:T.red,fontWeight:600,fontSize:13,marginBottom:16,textAlign:"center"}}>
          🛑 ใบสั่งผลิตนี้ถูกยกเลิกแล้ว
        </div>
      )}

      {!isCancelled && (
        <div style={{padding:14,background:"#f8fafc",border:`1px solid ${T.border}`,borderRadius:10,marginBottom:16}}>
          <div style={{fontSize:11,color:T.muted,marginBottom:4}}>สถานะปัจจุบัน</div>
          <div style={{fontSize:18,fontWeight:700,color:T.accent}}>{order.status}</div>
          {nextStep && <div style={{fontSize:12,color:T.sub,marginTop:6}}>ถัดไป → <b style={{color:T.accent}}>{nextStep}</b></div>}
          {isFinal && <div style={{fontSize:12,color:T.green,marginTop:6,fontWeight:600}}>✓ เสร็จสมบูรณ์ (รับเข้าคลังแล้ว)</div>}
        </div>
      )}

      {/* History */}
      <div style={{marginBottom:16}}>
        <div style={{fontSize:12,fontWeight:600,color:T.sub,marginBottom:8}}>📋 ประวัติสถานะ</div>
        <div style={{maxHeight:140,overflowY:"auto",border:`1px solid ${T.border}`,borderRadius:8}}>
          {(order.statusHistory || []).slice().reverse().map((h, i, arr) => (
            <div key={i} style={{padding:"8px 12px",fontSize:12,borderBottom:i<arr.length-1?`1px solid ${T.border}`:"none"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <span style={{fontWeight:600,color:T.text}}>{h.status}</span>
                <span style={{fontSize:11,color:T.muted}}>{h.at}</span>
              </div>
              <div style={{fontSize:11,color:T.sub,marginTop:2}}>{h.by}{h.note ? ` · ${h.note}` : ""}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Cost summary */}
      {order.costSnapshot && (
        <div style={{padding:12,background:"linear-gradient(135deg,rgba(59,91,139,0.06),rgba(16,185,129,0.06))",border:`1px solid ${T.border}`,borderRadius:10,marginBottom:16,display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,fontSize:12}}>
          <div><div style={{color:T.muted,fontSize:10}}>วัตถุดิบ/ตัว</div><div style={{fontFamily:"monospace",fontWeight:700,color:T.text}}>฿{fmt(order.costSnapshot.materialCostPerPiece)}</div></div>
          <div><div style={{color:T.muted,fontSize:10}}>ค่าแรง/ตัว</div><div style={{fontFamily:"monospace",fontWeight:700,color:T.text}}>฿{fmt(order.costSnapshot.laborCostPerPiece)}</div></div>
          <div><div style={{color:T.muted,fontSize:10}}>รวม</div><div style={{fontFamily:"monospace",fontWeight:700,color:T.accent}}>฿{fmt(order.costSnapshot.grandTotal)}</div></div>
        </div>
      )}

      {!isCancelled && !isFinal && nextStep && (
        <>
          <Input label="หมายเหตุการเลื่อนสถานะ (ถ้ามี)" value={note} onChange={e => setNote(e.target.value)} placeholder="เช่น พิมพ์เสร็จ 50 ตัว เหลือพรุ่งนี้"/>
          <div style={{marginTop:14,display:"flex",gap:10}}>
            <BtnGhost onClick={onClose} style={{flex:1}}>ปิด</BtnGhost>
            <BtnDanger onClick={cancel} disabled={busy} style={{flex:1}}>🛑 ยกเลิกใบนี้</BtnDanger>
            <BtnPrimary onClick={advance} disabled={busy} style={{flex:2}}>
              {busy ? "กำลังบันทึก..." : `→ เลื่อนเป็น "${nextStep}"`}
            </BtnPrimary>
          </div>
        </>
      )}

      {(isCancelled || isFinal) && (
        <div style={{display:"flex",gap:10}}>
          <BtnGhost onClick={onClose} style={{flex:1}}>ปิด</BtnGhost>
        </div>
      )}
    </Modal>
  );
}
