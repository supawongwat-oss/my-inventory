import React, { useState, useMemo, useEffect } from "react";
import { doc, setDoc, updateDoc, deleteDoc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";
import { PRODUCTION_STEPS, STATUS_COLORS, getLots, totalQtyOfLot, moveLot, getMachineForCurrentStage, nextLotId, nowStr } from "../utils/productionLots";
import { consumeMaterialsForOrder, stockFinishedForLot } from "../utils/productionEffects";
import LotDetailModal from "./LotDetailModal";

const T = { card:"#ffffff", border:"#e3e8ef", text:"#1f2a44", sub:"#5b6b85", muted:"#8a9bb3", accent:"#3b5b8b" };
const fmtInt = (n) => Number(n || 0).toLocaleString("th-TH");
// ขั้นที่ลากเข้าแล้วรวมม้วนของใบเดียวกันอัตโนมัติ (รีดเสร็จ → เย็บ)
const AUTO_MERGE_STAGE = "เย็บ";

export default function KanbanBoard({
  orders = [], collectionName: defaultCollection = "productionOrders", isCustom: defaultIsCustom = false,
  user, role, products = [], clothingItems = [],
  printElementById, companyInfo = {},
}) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null); // { order, lotIdx }
  const [collapsed, setCollapsed] = useState({});
  const [compact, setCompact] = useState(false); // 🗜️ ย่อการ์ดทั้งบอร์ด
  const [columnOrder, setColumnOrder] = useState(PRODUCTION_STEPS);
  // 🏭 production = ทำงานในโรงงาน → ทุก role ลาก/จัดการได้
  const canReorder = !!user;
  // 🖱️ Drag & drop state
  const [draggingLot, setDraggingLot] = useState(null); // {orderId, lotIdx, fromStatus, orderRef, collection}
  const [dragOverStatus, setDragOverStatus] = useState(null);

  // 📦 เก็บเข้าประวัติ — admin/manager
  const canArchive = user?.role === "admin" || user?.role === "manager";
  const archiveColumn = async (step) => {
    const lotsInCol = (byStatus[step] || []);
    if (lotsInCol.length === 0) { alert("ช่องนี้ว่างอยู่"); return; }
    // เก็บได้เฉพาะ order ที่ "ทุกล็อต" อยู่ใน step นี้ — กันงานที่ยังไม่จบหายไป
    const ordersMap = new Map();
    lotsInCol.forEach(l => {
      const orderRef = l.orderRef;
      if (!orderRef) return;
      const key = `${orderRef.__collection||defaultCollection}/${orderRef.id}`;
      if (!ordersMap.has(key)) {
        ordersMap.set(key, { orderRef, collection: orderRef.__collection || defaultCollection, lotIdxsInStep: [] });
      }
      ordersMap.get(key).lotIdxsInStep.push(l.lotIdx);
    });
    // กรองเฉพาะ order ที่ทุก lot อยู่ในนี้ (ไม่นับ lot ที่ "ยกเลิก" แล้ว)
    // 🔧 ใช้ getLots() ครอบ — รองรับ order รุ่นเก่าที่ไม่มี .lots[] array (จะสร้าง virtual L1 ให้)
    const archivable = [];
    const partial = [];
    for (const [, info] of ordersMap) {
      const activeLots = getLots(info.orderRef).filter(l => l.status !== "ยกเลิก");
      if (activeLots.length === info.lotIdxsInStep.length) archivable.push(info);
      else partial.push(info);
    }
    if (archivable.length === 0) {
      // 📋 แสดงรายละเอียดว่า lot อื่นอยู่ขั้นไหน — user จะได้รู้ว่าต้องไปดันขั้นไหน
      const detailLines = partial.slice(0, 10).map(info => {
        const activeLots = getLots(info.orderRef).filter(l => l.status !== "ยกเลิก");
        const stuckStages = {};
        activeLots.forEach(l => {
          if (l.status !== step) stuckStages[l.status] = (stuckStages[l.status]||0) + 1;
        });
        const stageText = Object.entries(stuckStages).map(([s,n])=>`${s} (${n})`).join(", ");
        return `• ${info.orderRef.orderNo || info.orderRef.id?.slice(0,6)}: lot ค้างที่ ${stageText}`;
      }).join("\n");
      const more = partial.length > 10 ? `\n... และอีก ${partial.length-10} ใบ` : "";
      alert(
        `ไม่มีใบสั่งผลิตที่เก็บได้\n\n`+
        `ใบที่ค้าง (${partial.length} ใบ):\n${detailLines}${more}\n\n`+
        `💡 ดัน lot ที่ค้างเข้าช่องนี้ก่อน แล้วลองใหม่`
      );
      return;
    }
    const totalQty = archivable.reduce((s,a) => s + (a.orderRef.totalQty||0), 0);
    if (!window.confirm(
      `📦 เก็บเข้าประวัติการผลิต?\n\n`+
      `✅ จะเก็บ ${archivable.length} ใบสั่งผลิต · ${fmtInt(totalQty)} ตัว\n`+
      (partial.length > 0 ? `⏸ ข้าม ${partial.length} ใบ (มี lot ในขั้นอื่นยังไม่เสร็จ)\n` : "")+
      `\n💡 ใบที่เก็บจะไม่หายไป — ดูได้ที่ tab "📜 ประวัติการผลิต" + restore กลับได้ตลอด`
    )) return;

    let archivedCount = 0;
    for (const info of archivable) {
      try {
        await updateDoc(doc(db, info.collection, info.orderRef.id), {
          archived: true,
          archivedAt: new Date().toISOString(),
          archivedBy: user?.name || "",
          archivedFromStep: step,
        });
        archivedCount++;
      } catch (e) {
        console.error("[kanban] archive failed for order", info.orderRef.id, e);
      }
    }
    alert(`✅ เก็บเรียบร้อย ${archivedCount} ใบสั่งผลิต — ดูที่ tab "📜 ประวัติการผลิต"`);
  };

  // ย้าย lot ไปสถานะใหม่ (อิสระ — ไม่บังคับลำดับ)
  const moveLotToStatus = async (lot, targetStatus) => {
    if (lot.status === targetStatus) return;
    const orderRef = lot.orderRef;
    if (!orderRef) return;
    const collectionName = orderRef.__collection || defaultCollection;
    const isCustom = !!defaultIsCustom;
    // 🧪 side-effects (เหมือน path กดปุ่มในล็อต) — ตัดวัตถุดิบตอนออกจาก "พิมพ์ลาย" + บวกสต๊อกตอนเข้าคลัง
    const needsConsume = !isCustom && lot.status === "พิมพ์ลาย" && targetStatus !== "พิมพ์ลาย" && !orderRef.materialsConsumed;
    const enteringStock = targetStatus === "เข้าคลัง" && !lot.finishedStocked;
    try {
      const lots = orderRef.lots || [];
      // ถ้า order ไม่มี lots structure (legacy) → update status ของ order
      if (lots.length === 0 || lot.lotIdx === undefined || lot.lotIdx < 0) {
        if (needsConsume) await consumeMaterialsForOrder({ order: orderRef, products, user, isCustom });
        await updateDoc(doc(db, collectionName, orderRef.id), { status: targetStatus, ...(needsConsume ? { materialsConsumed: true } : {}) });
      } else {
        // 📦 เข้าคลัง — ยืนยันก่อน (กันลากพลาด) + บวกสต๊อกเฉพาะล็อตนี้
        if (enteringStock) {
          const items = lot.items || [];
          const totalQty = items.reduce((s, it) => s + (Number(it.qty) || 0), 0);
          const lines = items.map(it => `• ${it.colorName || "?"} / ${it.size || "?"} × ${Number(it.qty) || 0}`).slice(0, 12).join("\n");
          const moreText = items.length > 12 ? `\n... และอีก ${items.length - 12} รายการ` : "";
          const ok = window.confirm(
            `✅ ยืนยันเข้าคลัง — ${lot.lotId || "ล็อตนี้"}\n\n${lines}${moreText}\n\n` +
            `รวม ${totalQty} ตัว → ${isCustom ? "(custom — ไม่บวกสต็อก)" : (orderRef.clothingName || "เสื้อผ้า")}\n\n` +
            (isCustom ? "" : autoStock
              ? `➕ จะบวกเข้าสต๊อกจริงทันที\n\n`
              : `🔒 โหมดบันทึกยอด — บันทึกยอด/วันที่ไว้ แต่ไม่แตะเลขสต๊อก\n\n`) +
            `⚠️ ตรวจว่าตัวเลขถูกต้องก่อนกด OK`
          );
          if (!ok) return;
        }
        if (needsConsume) await consumeMaterialsForOrder({ order: orderRef, products, user, isCustom });
        if (enteringStock) await stockFinishedForLot({ order: orderRef, lot, clothingItems, user, isCustom });
        let newLots = moveLot(lots, lot.lotIdx, targetStatus, user?.name || "", `drag → ${targetStatus}`);
        if (enteringStock) newLots = newLots.map((l, i) => i === lot.lotIdx ? { ...l, finishedStocked: true } : l);
        // 🔗 ลากเข้า "เย็บ" → รวมม้วนของใบนี้ที่อยู่เย็บแล้วเป็นล็อตเดียว (รอกระจายทีม)
        if (targetStatus === AUTO_MERGE_STAGE) {
          const atStage = newLots.filter(l => l.status === AUTO_MERGE_STAGE);
          if (atStage.length > 1) {
            const merged = new Map(); const notes = [];
            atStage.forEach(l => {
              (l.items || []).forEach(it => {
                const q = Number(it.qty) || 0; if (q <= 0) return;
                const key = [it.colorIdx ?? "", it.colorName ?? "", it.colorHex ?? "", it.size ?? "", it.variant ?? "", it.productionSize ?? ""].join("|");
                if (!merged.has(key)) merged.set(key, { ...it, qty: 0 });
                merged.get(key).qty += q;
              });
              (l.notes || []).forEach(n => notes.push(n));
            });
            const others = newLots.filter(l => l.status !== AUTO_MERGE_STAGE);
            const id = nextLotId(others);
            newLots = [...others, {
              lotId: id, items: Array.from(merged.values()), status: AUTO_MERGE_STAGE,
              statusHistory: [{ status: `รวม ${atStage.length} ม้วน → เย็บ`, at: nowStr(), by: user?.name || "" }],
              notes, finishedStocked: false, machine: "", rollNo: "", machineByStage: {},
            }];
          }
        }
        await updateDoc(doc(db, collectionName, orderRef.id), { lots: newLots, ...(needsConsume ? { materialsConsumed: true } : {}) });
      }
    } catch (e) {
      console.error("[kanban] move failed:", e);
      alert("ย้ายไม่สำเร็จ: " + e.message);
    }
  };

  // โหลดสายงาน (steps + order รวมกัน — เก็บใน settings/kanbanSteps)
  // เปลี่ยนจาก kanbanOrder เป็น kanbanSteps เพราะตอนนี้ขั้นเพิ่ม/ลบได้
  useEffect(() => {
    const unsub = onSnapshot(doc(db, "settings", "kanbanSteps"), snap => {
      if (!snap.exists()) return;
      const stored = Array.isArray(snap.data().steps) ? snap.data().steps : [];
      const cleaned = stored.filter(s => typeof s === "string" && s.trim());
      if (cleaned.length > 0) setColumnOrder(cleaned);
    }, () => {});
    return () => unsub();
  }, []);

  const saveSteps = async (steps) => {
    setColumnOrder(steps);
    try { await setDoc(doc(db, "settings", "kanbanSteps"), { steps }); }
    catch(e) { console.warn("[kanbanSteps] save failed:", e); }
  };

  // 🔒 โหมดบวกสต๊อกอัตโนมัติตอน "เข้าคลัง" — ปิดไว้ก่อนจนกว่าระบบจะนิ่ง
  const [autoStock, setAutoStock] = useState(false);
  useEffect(() => {
    const unsub = onSnapshot(doc(db, "settings", "production"), snap => {
      setAutoStock(snap.exists() && snap.data().autoStockOnFinish === true);
    }, () => {});
    return () => unsub();
  }, []);

  const toggleAutoStock = async () => {
    const next = !autoStock;
    const msg = next
      ? "เปิดโหมดบวกสต๊อกอัตโนมัติ?\n\nต่อไปเมื่อกด \"เข้าคลัง\" ระบบจะบวกเลขสต๊อกจริงให้ทันที\n\n⚠️ เปิดเมื่อมั่นใจว่าตัวเลขในระบบตรงกับของจริงแล้ว"
      : "ปิดโหมดบวกสต๊อกอัตโนมัติ?\n\nกด \"เข้าคลัง\" ได้ตามปกติ + บันทึกยอด/วันที่ครบ\nแต่ระบบจะไม่แตะเลขสต๊อก (นับเองเหมือนเดิม)";
    if (!window.confirm(msg)) return;
    try { await setDoc(doc(db, "settings", "production"), { autoStockOnFinish: next }, { merge: true }); }
    catch(e) { alert("บันทึกไม่สำเร็จ: " + (e.message||e)); }
  };

  const moveColumn = async (idx, dir) => {
    const ni = idx + dir;
    if (ni < 0 || ni >= columnOrder.length) return;
    const newOrder = [...columnOrder];
    [newOrder[idx], newOrder[ni]] = [newOrder[ni], newOrder[idx]];
    await saveSteps(newOrder);
  };

  const addColumn = async () => {
    const name = window.prompt("ชื่อสายงานใหม่ (เช่น สกรีน, รีดร้อน):");
    if (!name || !name.trim()) return;
    const trimmed = name.trim();
    if (columnOrder.includes(trimmed)) { alert("มีสายงานชื่อนี้อยู่แล้ว"); return; }
    if (trimmed === "ยกเลิก") { alert("ใช้ชื่อนี้ไม่ได้ — สงวนสำหรับสถานะยกเลิก"); return; }
    await saveSteps([...columnOrder, trimmed]);
  };

  const removeColumn = async (step) => {
    const lotsInCol = allLots.filter(l => l.status === step);
    if (lotsInCol.length > 0) {
      alert(`ลบไม่ได้ — มี ${lotsInCol.length} ล็อตอยู่ในสายงาน "${step}" — กรุณาย้ายล็อตออกก่อน`);
      return;
    }
    if (!window.confirm(`ลบสายงาน "${step}" ?`)) return;
    await saveSteps(columnOrder.filter(s => s !== step));
  };

  const resetColumnOrder = async () => {
    if (!window.confirm("กลับเป็นลำดับเริ่มต้น (7 ขั้นมาตรฐาน)?")) return;
    await saveSteps([...PRODUCTION_STEPS]);
  };

  // กรอง orders — ซ่อนที่ archived (เก็บเข้าประวัติแล้ว)
  const visibleOrders = useMemo(() => {
    const q = search.toLowerCase().trim();
    return orders.filter(o => {
      if (o.archived) return false; // 📦 ซ่อน archived
      if (q) {
        const hit = (o.prodNo||"").toLowerCase().includes(q) || (o.clothingName||"").toLowerCase().includes(q) || (o.setNo||"").toLowerCase().includes(q);
        if (!hit) return false;
      }
      return true;
    });
  }, [orders, search]);

  // สร้าง list ของ lots จาก orders (เพิ่ม metadata orderRef + lotIdx)
  const allLots = useMemo(() => {
    const out = [];
    visibleOrders.forEach(o => {
      const lots = getLots(o);
      lots.forEach((lot, lotIdx) => {
        out.push({
          ...lot,
          orderId: o.id,
          orderRef: o,
          lotIdx,
          prodNo: o.prodNo,
          clothingName: o.clothingName,
          setNo: o.setNo,
          clothingImage: o.clothingImage,
        });
      });
    });
    return out;
  }, [visibleOrders]);

  // 🎨 map สี ต่อ prodNo — ใบที่อยู่บนบอร์ดพร้อมกัน "ไม่ชนสี" (คุมด้วย index ของใบทั้งหมด)
  //   ถ้า order ตั้ง .color ไว้เอง → ใช้ค่านั้น
  //   ที่เหลือ: จัด sequential ตาม prodNo (asc) เพื่อให้เสถียร + ไม่ชนกันจนกว่าจะเกิน 16 ใบ
  const orderColorByProdNo = useMemo(() => {
    const map = new Map();
    // เรียง prodNo เสถียร → เปิดครั้งต่อไปสีของใบเดิมไม่เปลี่ยน
    const uniq = [...new Set(visibleOrders.map(o => o.prodNo || o.id).filter(Boolean))].sort();
    let idx = 0;
    uniq.forEach(pn => {
      const o = visibleOrders.find(oo => (oo.prodNo || oo.id) === pn);
      if (o?.color) { map.set(pn, o.color); return; } // ใช้สีที่ user ตั้งเอง
      map.set(pn, ORDER_PALETTE[idx % ORDER_PALETTE.length]);
      idx++;
    });
    return map;
  }, [visibleOrders]);

  // group by status
  const byStatus = useMemo(() => {
    const m = {};
    PRODUCTION_STEPS.forEach(s => m[s] = []);
    allLots.forEach(l => {
      if (m[l.status]) m[l.status].push(l);
    });
    return m;
  }, [allLots]);

  const cancelledLots = allLots.filter(l => l.status === "ยกเลิก");

  return (
    <div>
      {/* Filter bar */}
      <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap"}}>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="🔍 ค้นหา เลขที่ใบ หรือ ชื่อรุ่น"
          style={{flex:"1 1 280px",padding:"8px 12px",border:`1px solid ${T.border}`,borderRadius:8,fontSize:13,fontFamily:"inherit",outline:"none",background:"white"}}/>
        <div style={{padding:"8px 14px",background:"rgba(59,91,139,0.06)",borderRadius:8,fontSize:12,color:T.sub}}>
          ทั้งหมด <b style={{color:T.accent}}>{allLots.length}</b> ล็อต
          {cancelledLots.length > 0 && <span style={{marginLeft:8,color:"#dc2626"}}>(ยกเลิก {cancelledLots.length})</span>}
        </div>
        {canReorder && allLots.length > 0 && (
          <div style={{padding:"8px 14px",background:"rgba(16,185,129,0.08)",border:"1px solid rgba(16,185,129,0.25)",borderRadius:8,fontSize:11,color:"#047857"}}>
            🖱️ ลากการ์ด → วางในคอลัมน์ที่ต้องการได้อิสระ
          </div>
        )}
        <button onClick={()=>setCompact(c=>!c)} title={compact?"ขยายการ์ด":"ย่อการ์ดให้เหลือบรรทัดเดียว"}
          style={{padding:"8px 14px",borderRadius:8,border:`1px solid ${compact?T.accent:T.border}`,background:compact?"rgba(59,91,139,0.1)":"white",color:compact?T.accent:T.sub,cursor:"pointer",fontSize:11,fontWeight:600,fontFamily:"inherit"}}>{compact?"🗗 ขยายการ์ด":"🗜️ ย่อการ์ด"}</button>
        {/* 🔒 สถานะโหมดสต๊อก — เห็นทุกคน, admin กดสลับได้ */}
        <button onClick={user?.role === "admin" ? toggleAutoStock : undefined}
          title={user?.role === "admin"
            ? (autoStock ? "กดเพื่อปิด — ให้บันทึกยอดอย่างเดียว" : "กดเพื่อเปิด — ให้บวกสต๊อกอัตโนมัติ")
            : (autoStock ? "กด \"เข้าคลัง\" = บวกสต๊อกจริง" : "กด \"เข้าคลัง\" = บันทึกยอดเท่านั้น ไม่แตะสต๊อก")}
          style={{padding:"8px 14px",borderRadius:8,cursor:user?.role==="admin"?"pointer":"default",fontSize:11,fontWeight:600,fontFamily:"inherit",
            border:`1px solid ${autoStock?"rgba(16,185,129,0.35)":"rgba(217,119,6,0.35)"}`,
            background:autoStock?"rgba(16,185,129,0.08)":"rgba(217,119,6,0.08)",
            color:autoStock?"#059669":"#b45309"}}>
          {autoStock ? "➕ เข้าคลัง = บวกสต๊อกจริง" : "🔒 เข้าคลัง = บันทึกยอดเท่านั้น"}
        </button>
        {canReorder && (
          <>
            <button onClick={addColumn} title="เพิ่มสายงานใหม่"
              style={{padding:"8px 14px",borderRadius:8,border:"1px solid rgba(16,185,129,0.35)",background:"rgba(16,185,129,0.08)",color:"#059669",cursor:"pointer",fontSize:11,fontWeight:600,fontFamily:"inherit"}}>+ เพิ่มสายงาน</button>
            <button onClick={resetColumnOrder} title="กลับเป็นลำดับเริ่มต้น"
              style={{padding:"8px 12px",borderRadius:8,border:`1px solid ${T.border}`,background:"white",color:T.sub,cursor:"pointer",fontSize:11,fontFamily:"inherit"}}>↺ เริ่มต้น</button>
          </>
        )}
      </div>

      {/* Kanban columns */}
      <div style={{display:"flex",gap:10,overflowX:"auto",paddingBottom:8,minHeight:480}}>
        {columnOrder.map((step, colIdx) => {
          const col = byStatus[step] || [];
          const color = STATUS_COLORS[step] || T.accent;
          const colTotal = col.reduce((s, l) => s + totalQtyOfLot(l), 0);
          const isCollapsed = collapsed[step];
          const isDragOver = dragOverStatus === step;
          return (
            <div key={step}
              onDragOver={e=>{ e.preventDefault(); if (draggingLot && draggingLot.status !== step) setDragOverStatus(step); }}
              onDragLeave={()=>setDragOverStatus(null)}
              onDrop={async e=>{
                e.preventDefault();
                if (draggingLot && draggingLot.status !== step) {
                  await moveLotToStatus(draggingLot, step);
                }
                setDraggingLot(null);
                setDragOverStatus(null);
              }}
              style={{flex:"0 0 240px",background:isDragOver?"#dbeafe":"#f8fafc",border:isDragOver?`2px dashed ${T.accent}`:`1px solid ${T.border}`,borderRadius:12,padding:8,display:"flex",flexDirection:"column",maxHeight:"calc(100vh - 280px)",transition:"background .15s, border-color .15s"}}>
              {/* Column header */}
              <div style={{padding:"8px 10px",borderRadius:8,background:color+"15",border:`1px solid ${color}30`,marginBottom:8,userSelect:"none"}}>
                <div style={{display:"flex",alignItems:"center",gap:6}}>
                  {canReorder && (
                    <button onClick={(e) => { e.stopPropagation(); moveColumn(colIdx, -1); }}
                      disabled={colIdx === 0}
                      title="ย้ายซ้าย"
                      style={{width:22,height:22,borderRadius:5,border:"none",background:colIdx===0?"transparent":"rgba(255,255,255,0.7)",color:colIdx===0?T.muted:color,cursor:colIdx===0?"not-allowed":"pointer",fontSize:11,fontWeight:700,fontFamily:"inherit",padding:0,opacity:colIdx===0?0.3:1}}>◀</button>
                  )}
                  <div onClick={() => setCollapsed(p => ({...p, [step]: !p[step]}))} style={{flex:1,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"space-between",gap:6}}>
                    <span style={{fontSize:12,fontWeight:700,color}}>{step}</span>
                    <span style={{fontSize:11,color:T.sub,whiteSpace:"nowrap"}}>{col.length} ล็อต · {fmtInt(colTotal)} ตัว</span>
                  </div>
                  {canReorder && (
                    <button onClick={(e) => { e.stopPropagation(); moveColumn(colIdx, 1); }}
                      disabled={colIdx === columnOrder.length - 1}
                      title="ย้ายขวา"
                      style={{width:22,height:22,borderRadius:5,border:"none",background:colIdx===columnOrder.length-1?"transparent":"rgba(255,255,255,0.7)",color:colIdx===columnOrder.length-1?T.muted:color,cursor:colIdx===columnOrder.length-1?"not-allowed":"pointer",fontSize:11,fontWeight:700,fontFamily:"inherit",padding:0,opacity:colIdx===columnOrder.length-1?0.3:1}}>▶</button>
                  )}
                  {canArchive && col.length > 0 && (
                    <button onClick={(e) => { e.stopPropagation(); archiveColumn(step); }}
                      title={`📦 เก็บ ${col.length} ใบในช่องนี้เข้าประวัติ`}
                      style={{width:22,height:22,borderRadius:5,border:"none",background:"rgba(16,185,129,0.12)",color:"#059669",cursor:"pointer",fontSize:11,fontWeight:600,fontFamily:"inherit",padding:0}}>📦</button>
                  )}
                  {canReorder && (
                    <button onClick={(e) => { e.stopPropagation(); removeColumn(step); }}
                      title={col.length > 0 ? `มี ${col.length} ล็อต — ย้ายออกก่อน` : "ลบสายงานนี้"}
                      style={{width:22,height:22,borderRadius:5,border:"none",background:col.length>0?"transparent":"rgba(220,38,38,0.12)",color:col.length>0?T.muted:"#dc2626",cursor:col.length>0?"not-allowed":"pointer",fontSize:13,fontWeight:600,fontFamily:"inherit",padding:0,opacity:col.length>0?0.3:1}}>✕</button>
                  )}
                </div>
              </div>
              {/* Cards */}
              {!isCollapsed && (
                <div style={{display:"flex",flexDirection:"column",gap:6,overflowY:"auto",flex:1}}>
                  {col.length === 0 ? (
                    <div style={{padding:20,textAlign:"center",fontSize:11,color:T.muted,fontStyle:"italic"}}>— ว่าง —</div>
                  ) : col.map(lot => (
                    <KanbanCard key={`${lot.orderId}-${lot.lotId}`} lot={lot} compact={compact}
                      overrideColor={orderColorByProdNo.get(lot.prodNo || lot.orderId)}
                      onClick={() => setSelected({ order: lot.orderRef, lotIdx: lot.lotIdx })}
                      onDragStart={()=>setDraggingLot(lot)}
                      onDragEnd={()=>{ setDraggingLot(null); setDragOverStatus(null); }}
                      isDragging={draggingLot && draggingLot.orderId === lot.orderId && draggingLot.lotId === lot.lotId}
                      canDrag={canReorder}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {/* Cancelled column (แสดงถ้ามี) */}
        {cancelledLots.length > 0 && (
          <div style={{flex:"0 0 220px",background:"#fef2f2",border:"1px solid #fecaca",borderRadius:12,padding:8,maxHeight:"calc(100vh - 280px)",display:"flex",flexDirection:"column"}}>
            <div style={{padding:"8px 10px",borderRadius:8,background:"#fee2e2",border:"1px solid #fca5a5",marginBottom:8}}>
              <span style={{fontSize:12,fontWeight:700,color:"#dc2626"}}>🛑 ยกเลิก ({cancelledLots.length})</span>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:6,overflowY:"auto",flex:1}}>
              {cancelledLots.map(lot => (
                <KanbanCard key={`${lot.orderId}-${lot.lotId}`} lot={lot} overrideColor={orderColorByProdNo.get(lot.prodNo || lot.orderId)} onClick={() => setSelected({ order: lot.orderRef, lotIdx: lot.lotIdx })}/>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Detail modal */}
      {selected && (
        <LotDetailModal
          order={selected.order}
          lotIdx={selected.lotIdx}
          user={user}
          role={role}
          products={products}
          clothingItems={clothingItems}
          collectionName={selected.order.__collection || defaultCollection}
          isCustom={selected.order.__isCustom ?? defaultIsCustom}
          steps={columnOrder}
          printElementById={printElementById}
          companyInfo={companyInfo}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

// 🎨 palette สำหรับ auto-สี ตาม prodNo — 16 สีกระจายรอบวงจร HSL ให้แยกได้ชัด
// เรียงแบบสลับข้าม (ไม่ให้ 2 ใบติดกันได้สีใกล้กัน) → เห็นต่างในสายตาแม้อยู่ใกล้กัน
export const ORDER_PALETTE = [
  "#ef4444", // red
  "#0ea5e9", // sky
  "#84cc16", // lime
  "#a855f7", // purple
  "#f97316", // orange
  "#06b6d4", // cyan
  "#eab308", // yellow
  "#ec4899", // pink
  "#10b981", // emerald
  "#3b82f6", // blue
  "#d946ef", // fuchsia
  "#22c55e", // green
  "#f43f5e", // rose
  "#6366f1", // indigo
  "#f59e0b", // amber
  "#0d9488", // teal
];
export function autoOrderColor(prodNo) {
  // ใช้ FNV-1a hash แล้ว mixing เพิ่มให้กระจายกว่า simple polynomial
  const s = String(prodNo||"L1");
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return ORDER_PALETTE[Math.abs(h) % ORDER_PALETTE.length];
}

function KanbanCard({ lot, onClick, onDragStart, onDragEnd, isDragging, canDrag = true, compact = false, overrideColor }) {
  const total = totalQtyOfLot(lot);
  const colors = Array.from(new Set((lot.items || []).map(it => it.colorName)));
  const isCustom = lot.orderRef?.__isCustom;
  // 🎨 order color:
  //   1. overrideColor จาก parent (คุมไม่ให้สีชนกันบนบอร์ด)
  //   2. order.color ถ้า user ตั้งเอง (fallback สำหรับกรณีเรียกที่อื่น)
  //   3. hash จาก prodNo (fallback ท้ายสุด)
  const orderColor = overrideColor || lot.orderRef?.color || autoOrderColor(lot.prodNo);
  const accentColor = orderColor || (isCustom ? "#d97706" : T.accent);
  // 🖼️ thumbnail — รูปแรกจาก clothingImages (ใหม่) หรือ clothingImage (เก่า)
  const ord = lot.orderRef || {};
  const thumb = (Array.isArray(ord.clothingImages) && ord.clothingImages[0]?.dataUrl)
    || ord.clothingImage
    || (Array.isArray(ord.images) && ord.images[0]?.dataUrl)
    || "";

  // 🗜️ โหมดย่อ — บรรทัดเดียว
  if (compact) {
    return (
      <div onClick={onClick} draggable={canDrag}
        onDragStart={e=>{ if (!canDrag) return; e.dataTransfer.effectAllowed="move"; e.dataTransfer.setData("text/plain", lot.lotId); onDragStart && onDragStart(); }}
        onDragEnd={onDragEnd}
        title={`${lot.prodNo} · ${lot.jobLabel||lot.clothingName||""}`}
        style={{display:"flex",alignItems:"center",gap:6,padding:"5px 9px",background:`${accentColor}12`,border:`1px solid ${accentColor}55`,borderLeft:`7px solid ${accentColor}`,borderRadius:6,cursor:canDrag?"grab":"pointer",opacity:isDragging?0.5:1,fontSize:11}}
        onMouseEnter={e=>e.currentTarget.style.background=`${accentColor}22`}
        onMouseLeave={e=>e.currentTarget.style.background=`${accentColor}12`}>
        {lot.rollNo&&<span style={{color:"#15803d",fontWeight:700,flexShrink:0}}>🧵{lot.rollNo}</span>}
        {lot.setNo&&<span style={{color:"#7c3aed",fontWeight:700,flexShrink:0,fontSize:10}}>🎽{lot.setNo}</span>}
        <span style={{fontWeight:600,color:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{lot.jobLabel||lot.clothingName||lot.prodNo}</span>
        <span style={{marginLeft:"auto",fontFamily:"monospace",fontWeight:700,color:T.text,flexShrink:0}}>{fmtInt(total)}</span>
      </div>
    );
  }

  return (
    <div onClick={onClick}
      draggable={canDrag}
      onDragStart={e=>{ if (!canDrag) return; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", lot.lotId); onDragStart && onDragStart(); }}
      onDragEnd={onDragEnd}
      style={{padding:"10px 12px",background:`linear-gradient(180deg, ${accentColor}18 0%, ${accentColor}08 40%, white 100%)`,border:`1px solid ${accentColor}55`,borderRadius:8,cursor:canDrag?"grab":"pointer",boxShadow:isDragging?`0 8px 20px ${accentColor}55`:`0 1px 3px ${accentColor}22`,transition:"all 0.15s",borderLeft:`7px solid ${accentColor}`,borderTop:`3px solid ${accentColor}`,opacity:isDragging?0.5:1,position:"relative"}}
      onMouseEnter={e=>{e.currentTarget.style.boxShadow=`0 6px 16px ${accentColor}44`;e.currentTarget.style.borderColor=accentColor;e.currentTarget.style.borderLeftColor=accentColor;e.currentTarget.style.borderTopColor=accentColor;}}
      onMouseLeave={e=>{e.currentTarget.style.boxShadow=isDragging?`0 8px 20px ${accentColor}55`:`0 1px 3px ${accentColor}22`;e.currentTarget.style.borderColor=`${accentColor}55`;e.currentTarget.style.borderLeftColor=accentColor;e.currentTarget.style.borderTopColor=accentColor;}}>
      <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:5}}>
        {isCustom && (
          <span style={{padding:"1px 6px",fontSize:9,background:"rgba(217,119,6,0.12)",color:"#d97706",borderRadius:6,border:"1px solid rgba(217,119,6,0.3)",fontWeight:700,letterSpacing:0.3}}>🎨 Custom</span>
        )}
        <span style={{fontFamily:"monospace",fontSize:10,color:accentColor,fontWeight:700}}>{lot.prodNo}</span>
        <span style={{fontSize:10,color:T.muted}}>· {lot.lotId}</span>
        {lot.setNo && <span title="ชุดที่" style={{padding:"1px 7px",fontSize:10,background:"rgba(124,58,237,0.12)",color:"#7c3aed",borderRadius:6,border:"1px solid rgba(124,58,237,0.3)",fontWeight:700}}>🎽 {lot.setNo}</span>}
        <span style={{marginLeft:"auto",fontFamily:"monospace",fontWeight:700,color:T.text,fontSize:13}}>{fmtInt(total)}</span>
      </div>
      {(lot.machine || lot.rollNo) && (
        <div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:5}}>
          {lot.machine && <span style={{padding:"1px 7px",fontSize:10,background:"#eef6ff",color:"#1e40af",borderRadius:6,border:"1px solid #bfdbfe",fontWeight:700}}>🖨️ {lot.machine}</span>}
          {lot.rollNo && <span style={{padding:"1px 7px",fontSize:10,background:"#f0fdf4",color:"#15803d",borderRadius:6,border:"1px solid #bbf7d0",fontWeight:700}}>🧵 ม้วน {lot.rollNo}{(lot.jobLabel||lot.clothingName)?` · ${lot.jobLabel||lot.clothingName}`:""}</span>}
        </div>
      )}
      {/* 🖼️ Thumbnail + ชื่อรุ่น */}
      <div style={{display:"flex",gap:8,marginBottom:6,alignItems:"flex-start"}}>
        {thumb ? (
          <img src={thumb} alt="" draggable={false}
            style={{width:42,height:42,borderRadius:6,objectFit:"cover",border:`1px solid ${T.border}`,flexShrink:0,background:"#f8fafc"}}/>
        ) : (
          <div style={{width:42,height:42,borderRadius:6,border:`1px dashed ${T.border}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,color:T.muted,flexShrink:0,background:"#f8fafc"}}>{isCustom?"🎨":"👕"}</div>
        )}
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:12,fontWeight:600,color:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{lot.clothingName}</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:3,marginTop:3}}>
            {colors.slice(0,4).map((c,i) => (
              <span key={i} style={{padding:"1px 6px",fontSize:10,background:"rgba(59,91,139,0.08)",color:T.accent,borderRadius:8,border:"1px solid rgba(59,91,139,0.15)"}}>{c}</span>
            ))}
            {colors.length > 4 && <span style={{fontSize:10,color:T.muted}}>+{colors.length-4}</span>}
          </div>
        </div>
      </div>
      {(() => {
        const machine = getMachineForCurrentStage(lot);
        return machine ? (
          <div style={{padding:"3px 8px",background:`${STATUS_COLORS[lot.status]||"#64748b"}12`,border:`1px solid ${STATUS_COLORS[lot.status]||"#64748b"}30`,borderRadius:5,fontSize:10,color:STATUS_COLORS[lot.status]||"#64748b",fontWeight:700,marginBottom:4}}>
            🏭 {machine}
          </div>
        ) : null;
      })()}
      {(lot.notes || []).length > 0 && (
        <div style={{padding:"4px 8px",background:"#fffbeb",border:"1px solid #fde68a",borderRadius:5,fontSize:10,color:"#92400e"}}>
          📝 {lot.notes.length} หมายเหตุ
        </div>
      )}
    </div>
  );
}
