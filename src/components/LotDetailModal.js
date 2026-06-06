import React, { useState, useEffect, useRef } from "react";
import { Modal, MHead, BtnPrimary, BtnGhost, BtnDanger, Toast } from "./ui";
import { collection, addDoc, updateDoc, deleteDoc, doc, getDocs, query, where, documentId, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase";
import { logAudit, AUDIT_ACTIONS } from "../utils/audit";
import {
  PRODUCTION_STEPS, STATUS_COLORS, getLots, totalQtyOfLot,
  moveLot, splitLot, addLotNote, nextStep, canMoveTo, removeLot, nowStr,
} from "../utils/productionLots";
import { compressImage, dataUrlSizeKB } from "../utils/imageCompress";

const T = { border:"#e3e8ef", sub:"#5b6b85", text:"#1f2a44", muted:"#8a9bb3", accent:"#3b5b8b", red:"#dc2626", green:"#16a34a" };
const fmtInt = (n) => Number(n || 0).toLocaleString("th-TH");

export default function LotDetailModal({
  order, lotIdx, user, role, products = [], clothingItems = [],
  collectionName = "productionOrders", isCustom = false,
  steps = PRODUCTION_STEPS,
  onClose,
}) {
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [showSplit, setShowSplit] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [pendingPhotos, setPendingPhotos] = useState([]); // [{dataUrl, sizeKB}]
  const [photoCache, setPhotoCache] = useState({}); // {photoId: dataUrl}
  const [lightbox, setLightbox] = useState(null);    // dataUrl
  const [editMode, setEditMode] = useState(false);
  const [editItems, setEditItems] = useState([]);
  const fileRef = useRef(null);

  const lots = getLots(order);
  const lot = lots[lotIdx];
  const lotTotal = lot ? totalQtyOfLot(lot) : 0;
  const next = lot ? nextStep(lot.status, steps) : null;
  const isFinal = lot && (lot.status === "เข้าคลัง" || lot.status === steps[steps.length - 1]);
  const userRole = user?.role || "staff";

  // โหลดรูปจาก sub-collection สำหรับ note ที่มี photoIds
  useEffect(() => {
    const ids = new Set();
    (lot?.notes || []).forEach(n => (n.photoIds || []).forEach(id => {
      if (!photoCache[id]) ids.add(id);
    }));
    if (ids.size === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const idList = Array.from(ids);
        // Firestore in() รับสูงสุด 30 ids/ครั้ง
        const chunks = [];
        for (let i = 0; i < idList.length; i += 30) chunks.push(idList.slice(i, i + 30));
        const out = {};
        for (const chunk of chunks) {
          const q = query(collection(db, collectionName, order.id, "photos"), where(documentId(), "in", chunk));
          const snap = await getDocs(q);
          snap.forEach(d => { out[d.id] = d.data().dataUrl || ""; });
        }
        if (!cancelled) setPhotoCache(p => ({ ...p, ...out }));
      } catch (e) { console.warn("[photos] load failed:", e); }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lot?.notes, order.id, collectionName]);

  if (!lot) return null;

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
    if (!canMoveTo(lot.status, targetStatus, userRole, steps)) {
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

  // ── pick photos ──
  const handlePickFiles = async (files) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    try {
      const compressed = [];
      for (const f of files) {
        if (!f.type?.startsWith("image/")) continue;
        const dataUrl = await compressImage(f, { maxDim: 1000, quality: 0.75 });
        compressed.push({ dataUrl, sizeKB: dataUrlSizeKB(dataUrl) });
      }
      setPendingPhotos(prev => [...prev, ...compressed]);
      setToast(`เลือก ${compressed.length} รูป รวมที่ค้างจะส่ง ${compressed.length + pendingPhotos.length} รูป`);
    } catch (e) {
      console.error(e); setToast("ผิดพลาด: " + (e.message || e));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  // ── add note ──
  const handleAddNote = async () => {
    if (busy) return;
    if (!noteText.trim() && pendingPhotos.length === 0) return;
    setBusy(true);
    try {
      // 1) upload รูปลง sub-collection
      const photoIds = [];
      for (const ph of pendingPhotos) {
        const ref = await addDoc(collection(db, collectionName, order.id, "photos"), {
          dataUrl: ph.dataUrl, by: user?.name || "", at: nowStr(), createdAt: serverTimestamp(),
        });
        photoIds.push(ref.id);
        setPhotoCache(p => ({ ...p, [ref.id]: ph.dataUrl }));
      }
      // 2) เพิ่ม note ใน lots (รวม photoIds)
      const newLots = lots.map((l, i) => {
        if (i !== lotIdx) return l;
        return {
          ...l,
          notes: [...(l.notes || []), {
            at: nowStr(),
            by: user?.name || "",
            text: noteText.trim(),
            photoIds: photoIds,
          }],
        };
      });
      await persistLots(newLots);
      setNoteText("");
      setPendingPhotos([]);
      setToast(`บันทึกหมายเหตุสำเร็จ ${photoIds.length > 0 ? `(${photoIds.length} รูป)` : ""}`);
    } catch (e) {
      console.error(e); setToast("ผิดพลาด: " + (e.message || e));
    } finally {
      setBusy(false);
    }
  };

  // unused import suppression
  void addLotNote;

  // ── edit lot items (admin/manager) ──
  const startEdit = () => {
    setEditItems((lot.items || []).map(it => ({ ...it, qty: String(it.qty) })));
    setEditMode(true);
  };
  const cancelEdit = () => { setEditMode(false); setEditItems([]); };
  const saveEdit = async () => {
    if (busy) return;
    const cleaned = editItems
      .map(it => ({ ...it, qty: Math.max(0, Number(it.qty) || 0) }))
      .filter(it => it.qty > 0);
    if (cleaned.length === 0) { setToast("ต้องมีอย่างน้อย 1 รายการ"); return; }
    setBusy(true);
    try {
      const newLots = lots.map((l, i) => i === lotIdx ? { ...l, items: cleaned } : l);
      await persistLots(newLots);
      logAudit(user, {
        action: AUDIT_ACTIONS.UPDATE,
        collection: collectionName,
        targetId: order.id,
        targetLabel: `${order.prodNo} · ${lot.lotId}`,
        note: `แก้ไขรายการล็อต (${cleaned.length} รายการ, ${cleaned.reduce((s,i)=>s+i.qty,0)} ตัว)`,
      });
      setToast("บันทึกรายการสำเร็จ");
      setEditMode(false);
    } catch (e) {
      console.error(e); setToast("ผิดพลาด: " + (e.message || e));
    } finally {
      setBusy(false);
    }
  };
  const updateEditItem = (idx, patch) => setEditItems(prev => prev.map((it, i) => i === idx ? { ...it, ...patch } : it));
  const removeEditItem = (idx) => setEditItems(prev => prev.filter((_, i) => i !== idx));
  const addEditItem = () => setEditItems(prev => [...prev, { colorName: "", colorHex: "#999", colorIdx: 0, size: "", qty: "1" }]);

  // ── delete lot (admin/manager) ──
  const handleDeleteLot = async () => {
    if (busy) return;
    const willDeleteOrder = lots.length === 1;
    const msg = willDeleteOrder
      ? `ลบ "${order.prodNo}" ทั้งใบ?\n(เพราะมีล็อตเดียวที่เหลือ)\n\n⚠️ การลบนี้ย้อนคืนไม่ได้`
      : `ลบล็อต ${lot.lotId} (${lotTotal} ตัว) ออกจาก ${order.prodNo}?\n\n⚠️ การลบนี้ย้อนคืนไม่ได้`;
    if (!window.confirm(msg)) return;
    setBusy(true);
    try {
      if (willDeleteOrder) {
        await deleteDoc(doc(db, collectionName, order.id));
      } else {
        const newLots = removeLot(lots, lotIdx);
        await persistLots(newLots);
      }
      logAudit(user, {
        action: AUDIT_ACTIONS.DELETE,
        collection: collectionName,
        targetId: order.id,
        targetLabel: `${order.prodNo} · ${lot.lotId}`,
        note: willDeleteOrder ? "ลบใบสั่งผลิตทั้งใบ" : "ลบล็อตย่อย",
      });
      setToast(willDeleteOrder ? "ลบใบสั่งผลิตสำเร็จ" : "ลบล็อตสำเร็จ");
      setTimeout(() => onClose && onClose(), 600);
    } catch (e) {
      console.error(e); setToast("ผิดพลาด: " + (e.message || e)); setBusy(false);
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

  const currentIdx = steps.indexOf(lot.status);
  const isCancelled = lot.status === "ยกเลิก";

  return (
    <Modal onClose={onClose} w={720}>
      <MHead
        title={`📦 ${order.prodNo} · ล็อต ${lot.lotId}`}
        sub={`${order.clothingName} · ${fmtInt(lotTotal)} ตัว`}
        onClose={onClose}
      />
      {toast && <Toast msg={toast}/>}

      {/* Items — ใหญ่ขึ้นเพื่อเห็นรายการชัดเจน */}
      <div style={{padding:18,background:"#f8fafc",border:`1px solid ${T.border}`,borderRadius:12,marginBottom:14}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
          <div style={{fontSize:13,fontWeight:700,color:T.accent,textTransform:"uppercase",letterSpacing:"0.06em"}}>📦 รายการในล็อตนี้</div>
          {(userRole === "admin" || userRole === "manager") && !isCancelled && !editMode && (
            <button onClick={startEdit} style={{padding:"5px 12px",borderRadius:7,border:"1px solid rgba(59,91,139,0.3)",background:"rgba(59,91,139,0.08)",color:T.accent,fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>✏️ แก้ไข</button>
          )}
        </div>
        {editMode ? (
          <>
            <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:10}}>
              {editItems.map((it, idx) => (
                <div key={idx} style={{display:"grid",gridTemplateColumns:"1fr 1fr 80px 32px",gap:6,alignItems:"center",padding:6,background:"white",border:`1px solid ${T.border}`,borderRadius:7}}>
                  <input value={it.colorName} onChange={e => updateEditItem(idx, { colorName: e.target.value })} placeholder="สี"
                    style={{padding:"5px 8px",border:`1px solid ${T.border}`,borderRadius:5,fontSize:12,outline:"none",fontFamily:"inherit"}}/>
                  <input value={it.size} onChange={e => updateEditItem(idx, { size: e.target.value })} placeholder="ไซส์"
                    style={{padding:"5px 8px",border:`1px solid ${T.border}`,borderRadius:5,fontSize:12,outline:"none",fontFamily:"inherit",textAlign:"center"}}/>
                  <input type="number" min="0" value={it.qty} onChange={e => updateEditItem(idx, { qty: e.target.value })} placeholder="จำนวน"
                    style={{padding:"5px 8px",border:`1px solid ${T.border}`,borderRadius:5,fontSize:12,outline:"none",fontFamily:"monospace",textAlign:"center"}}/>
                  <button onClick={() => removeEditItem(idx)} style={{padding:"4px 6px",background:"#fef2f2",border:"1px solid #fecaca",borderRadius:5,color:T.red,fontSize:11,cursor:"pointer"}}>✕</button>
                </div>
              ))}
              <button onClick={addEditItem} style={{padding:"6px 12px",background:"rgba(22,163,74,0.08)",border:"1px solid rgba(22,163,74,0.3)",borderRadius:6,color:T.green,fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>+ เพิ่มรายการ</button>
            </div>
            <div style={{display:"flex",gap:6}}>
              <BtnGhost onClick={cancelEdit} disabled={busy} style={{flex:1,fontSize:12,padding:"6px"}}>ยกเลิก</BtnGhost>
              <BtnPrimary onClick={saveEdit} disabled={busy} style={{flex:2,fontSize:12,padding:"6px"}}>{busy ? "กำลังบันทึก..." : "💾 บันทึก"}</BtnPrimary>
            </div>
          </>
        ) : (
          <div style={{display:"flex",flexWrap:"wrap",gap:10}}>
            {(lot.items || []).map((it, i) => (
              <span key={i} style={{padding:"10px 16px",background:"white",border:`1px solid ${T.border}`,borderRadius:10,fontSize:15,display:"inline-flex",alignItems:"center",gap:10,boxShadow:"0 1px 2px rgba(0,0,0,0.04)"}}>
                <span style={{width:14,height:14,borderRadius:3,background:it.colorHex||"#999",border:"1px solid rgba(0,0,0,0.1)"}}/>
                <b style={{color:T.text,fontSize:15}}>{it.colorName}</b>
                <span style={{color:T.sub,fontSize:14}}>/ {it.size}</span>
                <span style={{fontFamily:"monospace",fontWeight:800,color:T.accent,fontSize:16}}>× {fmtInt(it.qty)}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Stepper — เล็กลงครึ่งหนึ่ง */}
      <div style={{display:"flex",alignItems:"center",gap:2,marginBottom:10,flexWrap:"wrap"}}>
        {steps.map((step, idx) => {
          const done = !isCancelled && idx <= currentIdx;
          const active = !isCancelled && idx === currentIdx;
          return (
            <div key={step} onClick={() => !active && !isCancelled && moveTo(step)}
              style={{
                padding:"2px 6px", borderRadius:10, fontSize:9,
                background: isCancelled ? "#f1f5f9" : (done ? "#3b5b8b" : "#f1f5f9"),
                color: isCancelled ? T.muted : (done ? "white" : T.muted),
                fontWeight: active ? 700 : 500,
                border: active ? "1px solid #1e3a5f" : "none",
                cursor: active || isCancelled ? "default" : (canMoveTo(lot.status, step, userRole, steps) ? "pointer" : "not-allowed"),
                opacity: canMoveTo(lot.status, step, userRole, steps) || done ? 1 : 0.5,
                lineHeight:1.2,
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
          {(userRole === "admin" || userRole === "manager") && (
            <button onClick={handleDeleteLot} disabled={busy}
              title={lots.length === 1 ? "ลบใบสั่งผลิตทั้งใบ" : "ลบล็อตนี้"}
              style={{padding:"8px 14px",borderRadius:8,border:"1px solid rgba(127,29,29,0.4)",background:"rgba(127,29,29,0.08)",color:"#7f1d1d",fontSize:13,fontWeight:600,cursor:busy?"not-allowed":"pointer",fontFamily:"'Sarabun',sans-serif",opacity:busy?0.45:1,minWidth:90}}>🗑 ลบ</button>
          )}
        </div>
      )}

      {/* Cancelled lot ก็ลบได้ */}
      {isCancelled && (userRole === "admin" || userRole === "manager") && (
        <div style={{display:"flex",gap:8,marginBottom:14,justifyContent:"flex-end"}}>
          <button onClick={handleDeleteLot} disabled={busy}
            style={{padding:"8px 14px",borderRadius:8,border:"1px solid rgba(127,29,29,0.4)",background:"rgba(127,29,29,0.08)",color:"#7f1d1d",fontSize:13,fontWeight:600,cursor:busy?"not-allowed":"pointer",fontFamily:"'Sarabun',sans-serif"}}>🗑 ลบล็อตที่ยกเลิก</button>
        </div>
      )}

      {/* Notes — ย่อเล็กลง */}
      <div style={{padding:8,background:"#fffbeb",border:"1px solid #fde68a",borderRadius:8,marginBottom:10}}>
        <div style={{fontSize:10,fontWeight:700,color:"#92400e",marginBottom:6,textTransform:"uppercase",letterSpacing:"0.05em"}}>📝 หมายเหตุล็อต ({(lot.notes||[]).length})</div>
        <div style={{maxHeight:140,overflowY:"auto",marginBottom:6}}>
          {(lot.notes || []).length === 0 ? (
            <div style={{fontSize:12,color:T.muted,textAlign:"center",padding:14}}>— ยังไม่มี —</div>
          ) : [...(lot.notes||[])].reverse().map((n, i, arr) => (
            <div key={i} style={{padding:"5px 8px",background:"white",borderRadius:5,marginBottom:i<arr.length-1?4:0,fontSize:11}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}>
                <span style={{fontWeight:600,color:T.text,fontSize:11}}>{n.by || "ไม่ระบุ"}</span>
                <span style={{color:T.muted,fontSize:10}}>{n.at}</span>
              </div>
              {n.text && <div style={{color:T.sub,whiteSpace:"pre-wrap",marginBottom:n.photoIds?.length?4:0,fontSize:11}}>{n.text}</div>}
              {(n.photoIds || []).length > 0 && (
                <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                  {n.photoIds.map((pid, j) => {
                    const url = photoCache[pid];
                    return url ? (
                      <img key={j} src={url} alt="" onClick={() => setLightbox(url)}
                        style={{width:46,height:46,objectFit:"cover",borderRadius:4,border:`1px solid ${T.border}`,cursor:"zoom-in"}}/>
                    ) : (
                      <div key={j} style={{width:46,height:46,borderRadius:4,background:"#f1f5f9",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,color:T.muted}}>⏳</div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Pending photos preview */}
        {pendingPhotos.length > 0 && (
          <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:8,padding:6,background:"rgba(146,64,14,0.06)",borderRadius:7}}>
            {pendingPhotos.map((ph, i) => (
              <div key={i} style={{position:"relative"}}>
                <img src={ph.dataUrl} alt="" style={{width:50,height:50,objectFit:"cover",borderRadius:5,border:`1px solid ${T.border}`}}/>
                <button onClick={() => setPendingPhotos(prev => prev.filter((_, j) => j !== i))}
                  style={{position:"absolute",top:-4,right:-4,width:18,height:18,borderRadius:"50%",border:"1px solid #fecaca",background:"white",cursor:"pointer",fontSize:10,color:T.red,lineHeight:1,padding:0}}>✕</button>
                <div style={{fontSize:9,color:T.muted,textAlign:"center",marginTop:2}}>{ph.sizeKB} KB</div>
              </div>
            ))}
          </div>
        )}

        <div style={{display:"flex",gap:4}}>
          <input value={noteText} onChange={e => setNoteText(e.target.value)}
            placeholder="พิมพ์ข้อความ หรือ 📷 แนบรูป"
            onKeyDown={e => e.key === "Enter" && handleAddNote()}
            style={{flex:1,padding:"5px 10px",border:`1px solid ${T.border}`,borderRadius:5,fontSize:11,fontFamily:"'Sarabun',sans-serif",outline:"none",background:"white"}}/>
          <input ref={fileRef} type="file" accept="image/*" multiple style={{display:"none"}}
            onChange={e => handlePickFiles(Array.from(e.target.files || []))}/>
          <button onClick={() => fileRef.current?.click()} disabled={busy}
            title="แนบรูป" style={{padding:"5px 9px",border:`1px solid #fde68a`,borderRadius:5,background:"white",color:"#92400e",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>📷</button>
          <button onClick={handleAddNote} disabled={busy || (!noteText.trim() && pendingPhotos.length === 0)}
            style={{padding:"5px 10px",border:"none",borderRadius:5,background:"#92400e",color:"white",fontSize:11,fontWeight:600,cursor:(noteText.trim()||pendingPhotos.length)?"pointer":"not-allowed",opacity:(noteText.trim()||pendingPhotos.length)?1:0.5,fontFamily:"inherit"}}>+ เพิ่ม</button>
        </div>
      </div>

      {/* Lightbox */}
      {lightbox && (
        <div onClick={() => setLightbox(null)}
          style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:9999,cursor:"zoom-out",padding:20}}>
          <img src={lightbox} alt="" style={{maxWidth:"95%",maxHeight:"95%",borderRadius:8,boxShadow:"0 20px 60px rgba(0,0,0,0.5)"}}/>
        </div>
      )}

      {/* History — เล็กมาก */}
      <div style={{padding:6,background:"#f8fafc",border:`1px solid ${T.border}`,borderRadius:6,marginBottom:10}}>
        <div style={{fontSize:9,fontWeight:700,color:T.muted,marginBottom:3,textTransform:"uppercase",letterSpacing:"0.05em"}}>📋 ประวัติสถานะ</div>
        <div style={{maxHeight:80,overflowY:"auto"}}>
          {(lot.statusHistory || []).length === 0 ? (
            <div style={{fontSize:10,color:T.muted,textAlign:"center",padding:6}}>— ยังไม่มีประวัติ —</div>
          ) : [...(lot.statusHistory||[])].reverse().map((h, i) => (
            <div key={i} style={{padding:"3px 0",fontSize:10,borderBottom:i < lot.statusHistory.length-1 ? `1px solid ${T.border}` : "none"}}>
              <div style={{display:"flex",justifyContent:"space-between"}}>
                <span style={{fontWeight:600,color:STATUS_COLORS[h.status] || T.text,fontSize:10}}>{h.status}</span>
                <span style={{color:T.muted,fontSize:9}}>{h.at}</span>
              </div>
              <div style={{color:T.sub,fontSize:9}}>{h.by}{h.note ? ` · ${h.note}` : ""}</div>
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
