import React, { useState } from "react";
import { Modal, MHead, Input, BtnPrimary, BtnGhost, BtnDanger, Toast } from "./ui";
import { collection, addDoc, updateDoc, doc, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase";
import { logAudit, AUDIT_ACTIONS } from "../utils/audit";
import {
  PRODUCTION_STEPS, STATUS_COLORS, getLots, totalQtyOfLot,
  moveLot, splitLot, addLotNote, nextStep, canMoveTo, nowStr,
} from "../utils/productionLots";

const T = { border:"#e3e8ef", sub:"#5b6b85", text:"#1f2a44", muted:"#8a9bb3", accent:"#3b5b8b", red:"#dc2626", green:"#16a34a" };
const fmtInt = (n) => Number(n || 0).toLocaleString("th-TH");

export default function LotDetailModal({
  order, lotIdx, user, role, products = [], clothingItems = [],
  collectionName = "productionOrders", isCustom = false,
  onClose,
}) {
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [showSplit, setShowSplit] = useState(false);
  const [noteText, setNoteText] = useState("");

  const lots = getLots(order);
  const lot = lots[lotIdx];
  if (!lot) return null;
  const lotTotal = totalQtyOfLot(lot);
  const next = nextStep(lot.status);
  const isFinal = lot.status === "เข้าคลัง";
  const userRole = user?.role || "staff";

  // ── persist helper ──
  const persistLots = async (newLots, extras = {}) => {
    await updateDoc(doc(db, collectionName, order.id), {
      lots: newLots,
      ...extras,
      lastLotUpdate: serverTimestamp(),
    });
  };

  // ── side effects ──
  const consumeMaterials = async () => {
    if (isCustom) return;
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
          { action: "ผลิต-ใช้วัตถุดิบ", by: user?.name || "", date: nowStr(), note: `${order.prodNo} · -${fmtInt(m.totalQty)} ${m.unit || prod.unit || ""}` },
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

  const stockFinishedForLot = async (l) => {
    if (isCustom) return;
    const clothing = clothingItems.find(c => c.id === order.clothingId);
    if (!clothing) return;
    const addMap = {};
    (l.items || []).forEach(it => {
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
    for (const it of (l.items || [])) {
      await addDoc(collection(db, "transactions"), {
        type: "ผลิต-รับเข้าคลัง",
        code: clothing.id,
        name: `${clothing.model} / ${it.colorName} / ${it.size}`,
        qty: Number(it.qty) || 0,
        by: user?.name || "", date: nowStr(),
        note: `${order.prodNo} · ${l.lotId}`,
        category: "เสื้อผ้า",
        createdAt: serverTimestamp(),
      });
    }
  };

  // ── move ──
  const moveTo = async (targetStatus) => {
    if (busy) return;
    if (!canMoveTo(lot.status, targetStatus, userRole)) {
      setToast("ไม่มีสิทธิ์ย้อนกลับ — staff เดินหน้าได้เท่านั้น");
      return;
    }
    setBusy(true);
    try {
      // consume materials ครั้งแรกที่ใบนี้ออกจาก "พิมพ์ลาย" (ระดับใบ ไม่ใช่ล็อต)
      const needsConsume = !isCustom && lot.status === "พิมพ์ลาย" && !order.materialsConsumed;
      if (needsConsume) await consumeMaterials();

      // ตอนเข้าคลัง — เพิ่ม clothing stock เฉพาะล็อตนี้
      const willEnterStock = targetStatus === "เข้าคลัง" && !lot.finishedStocked;
      if (willEnterStock) await stockFinishedForLot(lot);

      let newLots = moveLot(lots, lotIdx, targetStatus, user?.name || "");
      if (willEnterStock) {
        newLots = newLots.map((l, i) => i === lotIdx ? { ...l, finishedStocked: true } : l);
      }
      const extras = {};
      if (needsConsume) extras.materialsConsumed = true;
      // อัพเดทสถานะใบรวม = สถานะของล็อตล่าสุด (เพื่อ backward compat)
      extras.status = targetStatus;
      await persistLots(newLots, extras);

      logAudit(user, {
        action: AUDIT_ACTIONS.PRODUCTION_STATUS,
        collection: collectionName,
        targetId: order.id,
        targetLabel: `${order.prodNo} · ${lot.lotId}`,
        note: `${lot.status} → ${targetStatus}${needsConsume ? " · หักวัตถุดิบ" : ""}${willEnterStock ? " · เข้าคลัง" : ""}`,
      });
      setToast(`เลื่อน ${lot.lotId} เป็น "${targetStatus}" สำเร็จ`);
      setTimeout(() => onClose && onClose(), 600);
    } catch (e) {
      console.error(e); setToast("ผิดพลาด: " + (e.message || e)); setBusy(false);
    }
  };

  // ── add note ──
  const handleAddNote = async () => {
    if (busy || !noteText.trim()) return;
    setBusy(true);
    try {
      const newLots = addLotNote(lots, lotIdx, noteText.trim(), user?.name || "");
      await persistLots(newLots);
      setNoteText("");
      setToast("เพิ่มหมายเหตุสำเร็จ");
    } catch (e) {
      console.error(e); setToast("ผิดพลาด: " + (e.message || e));
    } finally {
      setBusy(false);
    }
  };

  // ── cancel lot ──
  const handleCancel = async () => {
    if (busy) return;
    if (!window.confirm(`ยกเลิกล็อต ${lot.lotId} (${lotTotal} ตัว)?`)) return;
    setBusy(true);
    try {
      const newLots = moveLot(lots, lotIdx, "ยกเลิก", user?.name || "");
      await persistLots(newLots);
      logAudit(user, {
        action: AUDIT_ACTIONS.PRODUCTION_CANCEL,
        collection: collectionName,
        targetId: order.id,
        targetLabel: `${order.prodNo} · ${lot.lotId}`,
        note: "ยกเลิกล็อต",
      });
      setToast("ยกเลิกล็อตสำเร็จ");
      setTimeout(() => onClose && onClose(), 600);
    } catch (e) {
      console.error(e); setToast("ผิดพลาด: " + (e.message || e)); setBusy(false);
    }
  };

  const currentIdx = PRODUCTION_STEPS.indexOf(lot.status);
  const isCancelled = lot.status === "ยกเลิก";

  return (
    <Modal onClose={onClose} w={720}>
      <MHead
        title={`📦 ${order.prodNo} · ล็อต ${lot.lotId}`}
        sub={`${order.clothingName} · ${fmtInt(lotTotal)} ตัว`}
        onClose={onClose}
      />
      {toast && <Toast msg={toast}/>}

      {/* Items */}
      <div style={{padding:12,background:"#f8fafc",border:`1px solid ${T.border}`,borderRadius:10,marginBottom:12}}>
        <div style={{fontSize:11,fontWeight:700,color:T.muted,marginBottom:8,textTransform:"uppercase",letterSpacing:"0.06em"}}>รายการในล็อตนี้</div>
        <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
          {(lot.items || []).map((it, i) => (
            <span key={i} style={{padding:"4px 10px",background:"white",border:`1px solid ${T.border}`,borderRadius:14,fontSize:12,display:"inline-flex",alignItems:"center",gap:6}}>
              <span style={{width:10,height:10,borderRadius:2,background:it.colorHex||"#999"}}/>
              <b style={{color:T.text}}>{it.colorName}</b>
              <span style={{color:T.sub}}>/ {it.size}</span>
              <span style={{fontFamily:"monospace",fontWeight:700,color:T.accent}}>× {fmtInt(it.qty)}</span>
            </span>
          ))}
        </div>
      </div>

      {/* Stepper */}
      <div style={{display:"flex",alignItems:"center",gap:3,marginBottom:14,flexWrap:"wrap"}}>
        {PRODUCTION_STEPS.map((step, idx) => {
          const done = !isCancelled && idx <= currentIdx;
          const active = !isCancelled && idx === currentIdx;
          return (
            <div key={step} onClick={() => !active && !isCancelled && moveTo(step)}
              style={{
                padding:"5px 10px", borderRadius:14, fontSize:11,
                background: isCancelled ? "#f1f5f9" : (done ? "#3b5b8b" : "#f1f5f9"),
                color: isCancelled ? T.muted : (done ? "white" : T.muted),
                fontWeight: active ? 700 : 500,
                border: active ? "2px solid #1e3a5f" : "none",
                cursor: active || isCancelled ? "default" : (canMoveTo(lot.status, step, userRole) ? "pointer" : "not-allowed"),
                opacity: canMoveTo(lot.status, step, userRole) || done ? 1 : 0.5,
              }}>
              {idx+1}.{step}
            </div>
          );
        })}
      </div>

      {isCancelled && (
        <div style={{padding:12,background:"#fef2f2",border:"1px solid #fecaca",borderRadius:8,color:T.red,fontWeight:600,fontSize:13,marginBottom:12,textAlign:"center"}}>
          🛑 ล็อตนี้ถูกยกเลิกแล้ว
        </div>
      )}

      {/* Actions row */}
      {!isCancelled && (
        <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap"}}>
          {next && (
            <BtnPrimary onClick={() => moveTo(next)} disabled={busy} style={{flex:1,minWidth:160}}>
              {busy ? "กำลังบันทึก..." : `→ ${next}`}
            </BtnPrimary>
          )}
          {isFinal && (
            <div style={{flex:1,padding:"10px",textAlign:"center",background:"rgba(22,163,74,0.08)",color:T.green,borderRadius:8,fontWeight:600,fontSize:13}}>
              ✓ เข้าคลังเรียบร้อย
            </div>
          )}
          {(lot.items || []).length > 0 && lotTotal > 1 && (
            <BtnGhost onClick={() => setShowSplit(true)} disabled={busy} style={{flex:1,minWidth:140}}>✂️ แยกล็อตย่อย</BtnGhost>
          )}
          {(userRole === "admin" || userRole === "manager") && !isFinal && (
            <BtnDanger onClick={handleCancel} disabled={busy} style={{minWidth:90}}>🛑 ยกเลิก</BtnDanger>
          )}
        </div>
      )}

      {/* Notes */}
      <div style={{padding:12,background:"#fffbeb",border:"1px solid #fde68a",borderRadius:10,marginBottom:12}}>
        <div style={{fontSize:11,fontWeight:700,color:"#92400e",marginBottom:8,textTransform:"uppercase",letterSpacing:"0.06em"}}>📝 หมายเหตุล็อต ({(lot.notes||[]).length})</div>
        <div style={{maxHeight:180,overflowY:"auto",marginBottom:8}}>
          {(lot.notes || []).length === 0 ? (
            <div style={{fontSize:12,color:T.muted,textAlign:"center",padding:14}}>— ยังไม่มี —</div>
          ) : [...(lot.notes||[])].reverse().map((n, i, arr) => (
            <div key={i} style={{padding:"8px 12px",background:"white",borderRadius:7,marginBottom:i<arr.length-1?6:0,fontSize:12}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                <span style={{fontWeight:600,color:T.text}}>{n.by || "ไม่ระบุ"}</span>
                <span style={{color:T.muted,fontSize:11}}>{n.at}</span>
              </div>
              <div style={{color:T.sub,whiteSpace:"pre-wrap"}}>{n.text}</div>
            </div>
          ))}
        </div>
        <div style={{display:"flex",gap:6}}>
          <input value={noteText} onChange={e => setNoteText(e.target.value)}
            placeholder="เพิ่มหมายเหตุ (เช่น พิมพ์เสร็จ 30 ตัว เหลือพรุ่งนี้)"
            onKeyDown={e => e.key === "Enter" && handleAddNote()}
            style={{flex:1,padding:"7px 12px",border:`1px solid ${T.border}`,borderRadius:7,fontSize:12,fontFamily:"'Sarabun',sans-serif",outline:"none",background:"white"}}/>
          <button onClick={handleAddNote} disabled={busy || !noteText.trim()}
            style={{padding:"7px 14px",border:"none",borderRadius:7,background:"#92400e",color:"white",fontSize:12,fontWeight:600,cursor:noteText.trim()?"pointer":"not-allowed",opacity:noteText.trim()?1:0.5,fontFamily:"inherit"}}>+ เพิ่ม</button>
        </div>
      </div>

      {/* History */}
      <div style={{padding:12,background:"#f8fafc",border:`1px solid ${T.border}`,borderRadius:10,marginBottom:12}}>
        <div style={{fontSize:11,fontWeight:700,color:T.muted,marginBottom:6,textTransform:"uppercase",letterSpacing:"0.06em"}}>📋 ประวัติสถานะ</div>
        <div style={{maxHeight:120,overflowY:"auto"}}>
          {(lot.statusHistory || []).length === 0 ? (
            <div style={{fontSize:12,color:T.muted,textAlign:"center",padding:8}}>— ยังไม่มีประวัติ —</div>
          ) : [...(lot.statusHistory||[])].reverse().map((h, i) => (
            <div key={i} style={{padding:"6px 0",fontSize:12,borderBottom:i < lot.statusHistory.length-1 ? `1px solid ${T.border}` : "none"}}>
              <div style={{display:"flex",justifyContent:"space-between"}}>
                <span style={{fontWeight:600,color:STATUS_COLORS[h.status] || T.text}}>{h.status}</span>
                <span style={{color:T.muted,fontSize:11}}>{h.at}</span>
              </div>
              <div style={{color:T.sub,fontSize:11}}>{h.by}{h.note ? ` · ${h.note}` : ""}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{display:"flex",gap:8}}>
        <BtnGhost onClick={onClose} style={{flex:1}}>ปิด</BtnGhost>
      </div>

      {/* Split modal */}
      {showSplit && (
        <SplitLotModal
          lot={lot}
          onClose={() => setShowSplit(false)}
          onConfirm={async (selections) => {
            setBusy(true);
            try {
              const { newLots, splitOk } = splitLot(lots, lotIdx, selections, { by: user?.name || "" });
              if (!splitOk) { setToast("กรอกจำนวนที่จะแยกอย่างน้อย 1 ตัว"); setBusy(false); return; }
              await persistLots(newLots);
              logAudit(user, {
                action: AUDIT_ACTIONS.PRODUCTION_STATUS,
                collection: collectionName,
                targetId: order.id,
                targetLabel: `${order.prodNo} · แยก ${lot.lotId}`,
                note: `สร้างล็อตใหม่จาก ${lot.lotId}`,
              });
              setShowSplit(false);
              setToast("แยกล็อตย่อยสำเร็จ");
              setTimeout(() => onClose && onClose(), 600);
            } catch (e) {
              console.error(e); setToast("ผิดพลาด: " + (e.message || e));
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
    </Modal>
  );
}

// ── Split modal ──
function SplitLotModal({ lot, onClose, onConfirm }) {
  const [sels, setSels] = useState(() => (lot.items || []).map(() => ""));
  const setSel = (idx, val) => setSels(prev => prev.map((v, i) => i === idx ? val : v));

  const submit = () => {
    const selections = sels.map((v, idx) => ({ itemIdx: idx, qty: Number(v) || 0 }))
                          .filter(s => s.qty > 0);
    onConfirm(selections);
  };

  return (
    <Modal onClose={onClose} w={560}>
      <MHead title={`✂️ แยกล็อต ${lot.lotId}`} sub="กรอกจำนวนของแต่ละแถวที่จะแยกออกเป็นล็อตใหม่" onClose={onClose}/>
      <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:14,maxHeight:300,overflowY:"auto"}}>
        {(lot.items || []).map((it, i) => (
          <div key={i} style={{display:"grid",gridTemplateColumns:"1fr 80px 90px",gap:8,alignItems:"center",padding:8,background:"#f8fafc",border:`1px solid ${T.border}`,borderRadius:8}}>
            <div style={{fontSize:12,color:T.text}}>
              <b>{it.colorName}</b> / {it.size} <span style={{color:T.muted}}>(มี {fmtInt(it.qty)})</span>
            </div>
            <input type="number" min="0" max={it.qty} value={sels[i]} onChange={e => setSel(i, e.target.value)}
              placeholder="0"
              style={{padding:"6px 10px",border:`1px solid ${T.border}`,borderRadius:6,textAlign:"center",fontFamily:"monospace",fontSize:13,outline:"none"}}/>
            <button onClick={() => setSel(i, String(it.qty))}
              style={{padding:"6px 8px",fontSize:11,border:`1px solid ${T.border}`,borderRadius:6,background:"white",cursor:"pointer",fontFamily:"inherit"}}>แยกทั้งหมด</button>
          </div>
        ))}
      </div>
      <div style={{display:"flex",gap:8}}>
        <BtnGhost onClick={onClose} style={{flex:1}}>ยกเลิก</BtnGhost>
        <BtnPrimary onClick={submit} style={{flex:1}}>✂️ ยืนยันแยกล็อต</BtnPrimary>
      </div>
    </Modal>
  );
}
