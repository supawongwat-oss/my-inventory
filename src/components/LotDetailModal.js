import React, { useState, useEffect, useRef } from "react";
import { Modal, MHead, BtnPrimary, BtnGhost, BtnDanger, Toast } from "./ui";
import { collection, addDoc, updateDoc, deleteDoc, doc, getDocs, query, where, documentId, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase";
import { logAudit, AUDIT_ACTIONS } from "../utils/audit";
import {
  PRODUCTION_STEPS, STATUS_COLORS, getLots, totalQtyOfLot,
  moveLot, splitLot, addLotNote, nextStep, canMoveTo, removeLot, nowStr,
  MACHINES_BY_STAGE, getMachineForCurrentStage,
  estimateRolls, ROLL_CAPACITY, packIntoRolls, nextLotId,
} from "../utils/productionLots";
import { compressImage, dataUrlSizeKB } from "../utils/imageCompress";
import { sizeRank } from "../theme";
import PrintRollLabel from "./PrintRollLabel";

const T = { border:"#e3e8ef", sub:"#5b6b85", text:"#1f2a44", muted:"#8a9bb3", accent:"#3b5b8b", red:"#dc2626", green:"#16a34a" };
const fmtInt = (n) => Number(n || 0).toLocaleString("th-TH");

export default function LotDetailModal({
  order, lotIdx, user, role, products = [], clothingItems = [],
  collectionName = "productionOrders", isCustom = false,
  steps = PRODUCTION_STEPS,
  printElementById, companyInfo = {},
  onClose,
}) {
  const [showRollLabel, setShowRollLabel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [showSplit, setShowSplit] = useState(false);
  const [showRollSplit, setShowRollSplit] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [pendingPhotos, setPendingPhotos] = useState([]); // [{dataUrl, sizeKB}]
  const [photoCache, setPhotoCache] = useState({}); // {photoId: dataUrl}
  const [lightbox, setLightbox] = useState(null);    // dataUrl
  const [editMode, setEditMode] = useState(false);
  const [editItems, setEditItems] = useState([]);
  const [editMachine, setEditMachine] = useState(false);
  const [machineVal, setMachineVal] = useState("");
  const [rollVal, setRollVal] = useState("");
  const [jobVal, setJobVal] = useState("");
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
    // sync order.items + order.totalQty จาก lots ทุกครั้ง
    // (ใบพิมพ์/รายละเอียดอ่านจาก order.items, ลิสต์อ่านจาก order.totalQty — ต้อง sync ทั้งคู่)
    const merged = new Map(); // key = colorIdx|colorName|colorHex|size|variant|productionSize
    (newLots || []).forEach(l => {
      (l.items || []).forEach(it => {
        const q = Number(it.qty) || 0;
        if (q <= 0) return;
        const key = [it.colorIdx ?? "", it.colorName ?? "", it.colorHex ?? "", it.size ?? "", it.variant ?? "", it.productionSize ?? ""].join("|");
        if (!merged.has(key)) {
          merged.set(key, {
            colorIdx: it.colorIdx ?? 0,
            colorName: it.colorName ?? "",
            colorHex: it.colorHex ?? "",
            size: it.size ?? "",
            variant: it.variant ?? "",
            productionSize: it.productionSize ?? "",
            qty: 0,
          });
        }
        merged.get(key).qty += q;
      });
    });
    const newItems = Array.from(merged.values());
    const newTotalQty = newItems.reduce((s, it) => s + it.qty, 0);
    await updateDoc(doc(db, collectionName, order.id), {
      lots: newLots,
      items: newItems,
      totalQty: newTotalQty,
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

      // ตอนเข้าคลัง — ยืนยันก่อน + เพิ่ม clothing stock เฉพาะล็อตนี้
      const willEnterStock = targetStatus === "เข้าคลัง" && !lot.finishedStocked;
      if (willEnterStock) {
        // 📋 สรุปสำหรับ confirm
        const items = lot.items || [];
        const totalQty = items.reduce((s,it)=>s+(Number(it.qty)||0),0);
        const lines = items.map(it => `• ${it.colorName||"?"} / ${it.size||"?"} × ${Number(it.qty)||0}`).slice(0,12).join("\n");
        const moreCount = items.length - 12;
        const moreText = moreCount>0 ? `\n... และอีก ${moreCount} รายการ` : "";
        const isCustomOrder = !!isCustom;
        const targetName = isCustomOrder ? "(custom — ไม่บวกสต็อก)" : (order.clothingName || "เสื้อผ้า");
        const ok = window.confirm(
          `✅ ยืนยันเข้าคลัง — ${lot.lotId || "ล็อตนี้"}\n\n`+
          `${lines}${moreText}\n\n`+
          `รวม ${totalQty} ตัว → ${targetName}\n\n`+
          `⚠️ ตรวจว่าตัวเลขถูกต้องก่อนกด OK\n`+
          `(กด Cancel ถ้ายังมี lot อื่นที่ต้องเข้าคลังพร้อมกัน)`
        );
        if (!ok) { setBusy(false); return; }
        await stockFinishedForLot(lot);
      }

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
    // normalize: qty เป็นเลข, trim ฟิลด์ string, ตัดแถวที่ qty <= 0
    const cleaned = editItems
      .map(it => ({
        ...it,
        colorName: (it.colorName || "").trim(),
        size: (it.size || "").trim(),
        variant: (it.variant || "").trim(),
        productionSize: (it.productionSize || "").trim(),
        qty: Math.max(0, Number(it.qty) || 0),
      }))
      .filter(it => it.qty > 0);
    console.log("[saveEdit] cleaned items:", cleaned, "lotIdx:", lotIdx, "total:", cleaned.reduce((s,i)=>s+i.qty,0));
    if (cleaned.length === 0) {
      // อนุญาตให้ "ลบทุกรายการในล็อตนี้" → ล็อตจะถูกลบไป
      if (!window.confirm("ทุกรายการในล็อตนี้มีจำนวน 0 — ลบทั้งล็อตเลยไหม?")) return;
    }
    setBusy(true);
    try {
      let newLots;
      if (cleaned.length === 0) {
        newLots = lots.filter((_, i) => i !== lotIdx);
      } else {
        newLots = lots.map((l, i) => i === lotIdx ? { ...l, items: cleaned } : l);
      }
      console.log("[saveEdit] newLots:", newLots);
      await persistLots(newLots);
      const beforeTotal = (lot.items || []).reduce((s,i)=>s+(Number(i.qty)||0), 0);
      const afterTotal = cleaned.reduce((s,i)=>s+i.qty, 0);
      logAudit(user, {
        action: AUDIT_ACTIONS.UPDATE,
        collection: collectionName,
        targetId: order.id,
        targetLabel: `${order.prodNo} · ${lot.lotId}`,
        note: `แก้ไขรายการล็อต (${cleaned.length} รายการ, ${afterTotal} ตัว · เปลี่ยนจาก ${beforeTotal} → ${afterTotal})`,
      });
      setToast(cleaned.length === 0
        ? "ลบล็อตสำเร็จ"
        : `บันทึกสำเร็จ · ${beforeTotal} → ${afterTotal} ตัว${beforeTotal !== afterTotal ? ` (${afterTotal > beforeTotal ? "+" : ""}${afterTotal - beforeTotal})` : ""}`);
      setEditMode(false);
      if (cleaned.length === 0 && onClose) setTimeout(onClose, 800);
    } catch (e) {
      console.error("[saveEdit] failed:", e);
      alert("บันทึกไม่สำเร็จ: " + (e?.message || e));
      setToast("ผิดพลาด: " + (e?.message || e));
    } finally {
      setBusy(false);
    }
  };
  // ── แก้เครื่องพิมพ์ + ม้วน ──
  const startEditMachine = () => { setMachineVal(lot.machine || ""); setRollVal(lot.rollNo || ""); setJobVal(lot.jobLabel || ""); setEditMachine(true); };
  const saveMachine = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const newLots = lots.map((l, i) => i === lotIdx ? { ...l, machine: machineVal.trim(), rollNo: rollVal.trim(), jobLabel: jobVal.trim() } : l);
      await persistLots(newLots);
      logAudit(user, { action: AUDIT_ACTIONS.UPDATE, collection: collectionName, targetId: order.id, targetLabel: `${order.prodNo} · ${lot.lotId}`, note: `ตั้งเครื่องพิมพ์: ${machineVal||"-"} · ม้วน: ${rollVal||"-"} · งาน: ${jobVal||"-"}` });
      setEditMachine(false);
      setToast("บันทึกเครื่องพิมพ์/ม้วนสำเร็จ");
    } catch (e) { console.error(e); setToast("ผิดพลาด: " + (e.message || e)); }
    finally { setBusy(false); }
  };

  // ── core: แทนล็อตนี้ด้วยหลายล็อต (ม้วน 1..N) จาก rolls = [{rollNo, items}] ──
  const replaceLotWithRolls = async (rolls, noteLabel) => {
    if (busy) return;
    if (!rolls || rolls.length === 0) { setToast("ยังไม่มีของในม้วน"); return; }
    setBusy(true);
    try {
      let working = lots.filter((_, i) => i !== lotIdx);
      const at = nowStr();
      rolls.forEach((r) => {
        const id = nextLotId(working);
        const hasRoll = r.rollNo != null && r.rollNo !== "";
        working = [...working, {
          lotId: id,
          items: r.items,
          status: lot.status,
          statusHistory: [{ status: r.label || `แบ่งม้วนจาก ${lot.lotId}`, at, by: user?.name || "" }],
          notes: [],
          finishedStocked: false,
          machine: "",
          rollNo: hasRoll ? String(r.rollNo) : "",
          jobLabel: r.jobLabel || "",
          machineByStage: {},
        }];
      });
      await persistLots(working);
      logAudit(user, {
        action: AUDIT_ACTIONS.PRODUCTION_STATUS, collection: collectionName, targetId: order.id,
        targetLabel: `${order.prodNo} · ${lot.lotId}`,
        note: noteLabel || `แบ่ง ${rolls.length} ม้วนจาก ${lot.lotId}`,
      });
      setShowRollSplit(false);
      setToast(`แบ่งเป็น ${rolls.length} ม้วนสำเร็จ`);
      setTimeout(() => onClose && onClose(), 700);
    } catch (e) { console.error(e); setToast("ผิดพลาด: " + (e.message || e)); setBusy(false); }
  };

  // โหมดอัตโนมัติ — pack ตาม capacity
  const applyRollSplit = async (orderedItems, capacity) => {
    const baseRolls = packIntoRolls(orderedItems, capacity);
    if (baseRolls.length <= 1) { setToast("ของน้อยกว่า 1 ม้วน — ไม่ต้องแบ่ง"); return; }
    // 🩹 offset rollNo เพื่อต่อจากม้วนพี่น้องที่มีอยู่
    const siblingMaxRoll = lots.reduce((max, l, i) => {
      if (i === lotIdx) return max;
      const n = parseInt(l.rollNo, 10);
      return !isNaN(n) && n > max ? n : max;
    }, 0);
    const rolls = baseRolls.map((r, i) => ({ ...r, rollNo: siblingMaxRoll + i + 1 }));
    await replaceLotWithRolls(rolls, `แบ่ง ${rolls.length} ม้วน (${capacity}/ม้วน) จาก ${lot.lotId}`);
  };

  // ── รวมล็อตที่อยู่ "ขั้นเดียวกัน" กลับเป็นล็อตเดียว (เช่น รีดเสร็จ → รวมรอส่งเย็บ) ──
  const handleMergeAllLots = async () => {
    if (busy) return;
    const sameStage = lots.filter(l => l.status === lot.status && l.status !== "ยกเลิก");
    if (sameStage.length < 2) { setToast(`ขั้น "${lot.status}" มีล็อตเดียว — ไม่ต้องรวม`); return; }
    if (!window.confirm(`รวม ${sameStage.length} ล็อตที่อยู่ขั้น "${lot.status}" เป็นล็อตเดียว?\n(ล็อตในขั้นอื่นไม่ถูกแตะ)`)) return;
    setBusy(true);
    try {
      // รวม items (key = colorIdx|colorName|colorHex|size|variant|productionSize)
      const merged = new Map();
      const notes = [];
      sameStage.forEach(l => {
        (l.items || []).forEach(it => {
          const q = Number(it.qty) || 0; if (q <= 0) return;
          const key = [it.colorIdx ?? "", it.colorName ?? "", it.colorHex ?? "", it.size ?? "", it.variant ?? "", it.productionSize ?? ""].join("|");
          if (!merged.has(key)) merged.set(key, { ...it, qty: 0 });
          merged.get(key).qty += q;
        });
        (l.notes || []).forEach(n => notes.push(n));
      });
      const items = Array.from(merged.values());
      // ล็อตที่เหลือ (ขั้นอื่น + ยกเลิก) ไม่ถูกแตะ
      const untouched = lots.filter(l => !(l.status === lot.status && l.status !== "ยกเลิก"));
      const id = nextLotId(untouched);
      const mergedLot = {
        lotId: id, items, status: lot.status,
        statusHistory: [{ status: `รวม ${sameStage.length} ล็อต (${lot.status})`, at: nowStr(), by: user?.name || "" }],
        notes, finishedStocked: false, machine: "", rollNo: "", machineByStage: {},
      };
      await persistLots([mergedLot, ...untouched]);
      logAudit(user, {
        action: AUDIT_ACTIONS.PRODUCTION_STATUS, collection: collectionName, targetId: order.id,
        targetLabel: `${order.prodNo} · ${id}`, note: `รวม ${sameStage.length} ล็อตขั้น ${lot.status}`,
      });
      setToast(`รวม ${sameStage.length} ล็อตสำเร็จ`);
      setTimeout(() => onClose && onClose(), 700);
    } catch (e) { console.error(e); setToast("ผิดพลาด: " + (e.message || e)); setBusy(false); }
  };

  // โหมดกรอกเอง — rolls = [{rollNo, items}] · ของที่ไม่ได้ใส่ในม้วน → เก็บเป็นล็อต "เหลือ" (ไม่หาย)
  const applyManualRolls = async (rolls) => {
    const clean = (rolls || []).filter(r => (r.items || []).length > 0);
    if (clean.length === 0) { setToast("กรอกอย่างน้อย 1 ม้วนที่มีของ"); return; }
    const keyOf = (it) => [it.colorIdx ?? "", it.colorName ?? "", it.colorHex ?? "", it.size ?? "", it.variant ?? "", it.productionSize ?? ""].join("|");
    const allocated = new Map();
    clean.forEach(r => (r.items || []).forEach(it => { const k = keyOf(it); allocated.set(k, (allocated.get(k) || 0) + (Number(it.qty) || 0)); }));
    const leftover = [];
    (lot.items || []).forEach(it => {
      const rem = (Number(it.qty) || 0) - (allocated.get(keyOf(it)) || 0);
      if (rem > 0) leftover.push({ ...it, qty: rem });
    });
    const all = [...clean];
    if (leftover.length > 0) all.push({ rollNo: "", items: leftover, label: `เหลือจาก ${lot.lotId}` });
    const note = `แบ่ง ${clean.length} ม้วน (กรอกเอง)${leftover.length ? " + เหลือ 1 ล็อต" : ""} จาก ${lot.lotId}`;
    await replaceLotWithRolls(all, note);
  };

  const updateEditItem = (idx, patch) => setEditItems(prev => prev.map((it, i) => i === idx ? { ...it, ...patch } : it));
  const removeEditItem = (idx) => setEditItems(prev => prev.filter((_, i) => i !== idx));
  const addEditItem = () => setEditItems(prev => [...prev, { colorName: "", colorHex: "#999", colorIdx: 0, size: "", variant: "", productionSize: "", qty: "1" }]);
  const VARIANT_PRESETS = ["แขนสั้น", "แขนยาว", "แขนกุด", "คอกลม", "คอวี", "โปโล", "ฮู้ด"];

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

  // 🏷️ พิมพ์ป้ายม้วน — สติกเกอร์แปะม้วน (กลุ่มตามสี)
  const printRollLabel = () => {
    const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    // 1 แถว = 1 (สี + ไซส์ + จำนวน) — รวมถ้า key เดียวกัน, คงลำดับตามที่กรอก
    const map = new Map(); const flat = [];
    (lot.items || []).forEach(it => {
      const pSize = it.productionSize || it.size || "-";
      const key = (it.colorName || "-") + "|" + (it.colorHex || "#999") + "|" + pSize + "|" + (it.variant || "");
      if (map.has(key)) { map.get(key).qty += Number(it.qty) || 0; }
      else {
        const row = { colorName: it.colorName || "-", colorHex: it.colorHex || "#999", size: pSize, variant: it.variant || "", qty: Number(it.qty) || 0 };
        map.set(key, row); flat.push(row);
      }
    });
    // 🔄 กลับลำดับ — พิมพ์จากล่างขึ้นบน (สำหรับลำดับงาน)
    flat.reverse();
    const rowsHtml = flat.map((r, i) => `
      <tr style="background:${i%2===0?"#fff":"#f8fafc"}">
        <td class="c"><span class="sw" style="background:${esc(r.colorHex)}"></span>${esc(r.colorName)}${r.variant ? ` <i class="v">(${esc(r.variant)})</i>` : ""}</td>
        <td class="sz">${esc(r.size)}</td>
        <td class="q">${fmtInt(r.qty)}</td>
      </tr>`).join("");
    const machine = getMachineForCurrentStage(lot) || lot.machine || "";
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>ป้ายม้วน ${esc(lot.rollNo || lot.lotId)}</title>
      <style>
        *{box-sizing:border-box;font-family:'Sarabun',Tahoma,sans-serif;}
        body{margin:0;padding:8px;}
        .label{width:100%;max-width:380px;border:2px solid #000;border-radius:8px;padding:10px 12px;}
        .hd{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #000;padding-bottom:6px;margin-bottom:6px;}
        .roll{font-size:30px;font-weight:800;line-height:1;}
        .roll small{font-size:13px;font-weight:600;display:block;margin-top:2px;}
        .job{font-size:15px;font-weight:800;text-align:right;max-width:200px;}
        .meta{font-size:12px;color:#222;text-align:right;margin-top:2px;}
        table{width:100%;border-collapse:collapse;font-size:13px;border:1px solid #000;}
        thead th{background:#1e293b;color:#fff;padding:4px 6px;font-size:11px;text-align:left;}
        thead th.sz,thead th.q{text-align:center;}
        thead th.q{text-align:right;}
        td{padding:4px 6px;border-bottom:1px solid #cbd5e1;vertical-align:middle;}
        td.c{white-space:nowrap;font-weight:700;}
        td.sz{text-align:center;font-family:monospace;font-weight:700;color:#0c4a6e;width:60px;}
        td.q{text-align:right;font-family:monospace;font-weight:800;width:70px;}
        .v{color:#475569;font-size:11px;font-weight:500;font-style:italic;}
        .sw{display:inline-block;width:11px;height:11px;border:1px solid #000;border-radius:2px;margin-right:4px;vertical-align:middle;}
        .tot{display:flex;justify-content:space-between;border-top:2px solid #000;margin-top:6px;padding-top:5px;font-size:15px;font-weight:800;}
        @media print{ body{padding:0;} .label{border-width:1.5px;} }
      </style></head>
      <body><div class="label">
        <div class="hd">
          <div><div class="roll">🧵 ม้วน ${esc(lot.rollNo || lot.lotId)}</div>
            ${machine ? `<small>🖨️ ${esc(machine)}</small>` : ""}</div>
          <div><div class="job">${esc(lot.jobLabel || order.clothingName || "")}</div>
            <div class="meta">${esc(order.prodNo || "")}<br>${esc(nowStr())}</div></div>
        </div>
        <table>
          <thead><tr><th>สี</th><th class="sz">ไซส์</th><th class="q">จำนวน</th></tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>
        <div class="tot"><span>รวม</span><span>${fmtInt(lotTotal)} ตัว</span></div>
      </div>
      <script>window.onload=function(){window.print();}</script>
      </body></html>`;
    const w = window.open("", "_blank", "width=420,height=640");
    if (!w) { setToast("เบราว์เซอร์บล็อกป๊อปอัพ — อนุญาตก่อน"); return; }
    w.document.write(html); w.document.close();
  };

  return (
    <Modal onClose={onClose} w={720}>
      <MHead
        title={`📦 ${order.prodNo} · ล็อต ${lot.lotId}`}
        sub={`${order.clothingName} · ${fmtInt(lotTotal)} ตัว`}
        onClose={onClose}
      />
      {toast && <Toast msg={toast}/>}

      {/* 🏷️ ปุ่มพิมพ์ป้ายม้วน (สติ๊กเกอร์ 100×150mm) */}
      {printElementById && (
        <div style={{display:"flex",justifyContent:"flex-end",marginBottom:10}}>
          <button onClick={()=>setShowRollLabel(true)}
            style={{padding:"7px 14px",borderRadius:8,border:"1px solid rgba(59,91,139,0.3)",background:"rgba(59,91,139,0.08)",color:T.accent,fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",gap:6}}>
            🏷️ พิมพ์ป้ายม้วน (100×150mm)
          </button>
        </div>
      )}

      {/* Modal ป้ายม้วน */}
      {showRollLabel && (
        <PrintRollLabel
          order={order}
          lot={lot}
          companyInfo={companyInfo}
          onClose={()=>setShowRollLabel(false)}
          onPrint={(id, size, margin)=>{
            printElementById(id, size, margin);
            setTimeout(()=>setShowRollLabel(false), 1500);
          }}
        />
      )}

      {/* 🏭 เครื่อง/ทีม ที่กำลังทำม้วนนี้ใน stage ปัจจุบัน */}
      {(()=>{
        const currentStage = lot?.status || "";
        const choices = MACHINES_BY_STAGE[currentStage] || [];
        if (choices.length === 0) return null; // stage ที่ไม่ต้องเลือกเครื่อง (ตัดผ้ารวม, แพ๊ค, เข้าคลัง)
        const current = (lot?.machineByStage || {})[currentStage] || "";
        return (
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12,padding:"10px 14px",background:"rgba(59,91,139,0.06)",border:`1px solid ${T.border}`,borderRadius:10}}>
            <span style={{fontSize:11,color:T.muted,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.05em"}}>🏭 {currentStage} — เครื่อง/ทีม:</span>
            <select value={current} disabled={!userRole || isCancelled} onChange={async e=>{
              const v = e.target.value;
              const newLots = lots.map((l,i) => i === lotIdx ? { ...l, machineByStage: { ...(l.machineByStage||{}), [currentStage]: v } } : l);
              await persistLots(newLots);
              setToast(v ? `อัพเดท: ${v}` : "ล้างเครื่อง/ทีมแล้ว");
            }}
              style={{background:"white",border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:7,padding:"6px 12px",fontSize:12,outline:"none",cursor:"pointer",fontFamily:"inherit",minWidth:140}}>
              <option value="">— ยังไม่ระบุ —</option>
              {choices.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            {current && <span style={{fontSize:11,padding:"3px 9px",borderRadius:10,background:`${STATUS_COLORS[currentStage]||"#64748b"}18`,color:STATUS_COLORS[currentStage]||"#64748b",fontWeight:700,border:`1px solid ${STATUS_COLORS[currentStage]||"#64748b"}40`}}>✓ {current}</span>}
          </div>
        );
      })()}

      {/* 🖨️ เครื่องพิมพ์ + ม้วน */}
      <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",padding:"10px 14px",background:"#eef6ff",border:"1px solid #bfdbfe",borderRadius:10,marginBottom:12}}>
        {editMachine ? (
          <>
            <div style={{display:"flex",alignItems:"center",gap:6}}>
              <span style={{fontSize:12,color:T.sub}}>🖨️ เครื่อง:</span>
              <input value={machineVal} onChange={e=>setMachineVal(e.target.value)} placeholder="เช่น เครื่อง A"
                style={{width:110,padding:"5px 8px",border:`1px solid ${T.border}`,borderRadius:6,fontSize:12,outline:"none",fontFamily:"inherit"}}/>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:6}}>
              <span style={{fontSize:12,color:T.sub}}>🧵 ม้วน:</span>
              <input value={rollVal} onChange={e=>setRollVal(e.target.value)} placeholder="เช่น 1"
                style={{width:70,padding:"5px 8px",border:`1px solid ${T.border}`,borderRadius:6,fontSize:12,outline:"none",fontFamily:"inherit"}}/>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:6,flex:"1 1 180px"}}>
              <span style={{fontSize:12,color:T.sub,whiteSpace:"nowrap"}}>👕 รุ่น/งาน:</span>
              <input value={jobVal} onChange={e=>setJobVal(e.target.value)} placeholder="เช่น K12, เสื้อคลาส (ถ้ามีหลายงานในม้วน)"
                style={{flex:1,minWidth:120,padding:"5px 8px",border:`1px solid ${T.border}`,borderRadius:6,fontSize:12,outline:"none",fontFamily:"inherit"}}/>
            </div>
            <BtnPrimary onClick={saveMachine} disabled={busy} style={{fontSize:12,padding:"5px 12px"}}>💾 บันทึก</BtnPrimary>
            <BtnGhost onClick={()=>setEditMachine(false)} disabled={busy} style={{fontSize:12,padding:"5px 12px"}}>ยกเลิก</BtnGhost>
          </>
        ) : (
          <>
            <span style={{fontSize:13,color:T.text,fontWeight:600}}>🖨️ {lot.machine || <span style={{color:T.muted,fontWeight:400}}>ยังไม่ระบุเครื่อง</span>}</span>
            {lot.rollNo && <span style={{fontSize:13,color:T.text,fontWeight:600}}>· 🧵 ม้วน {lot.rollNo}</span>}
            <span style={{fontSize:13,color:T.text,fontWeight:600}}>· 👕 {lot.jobLabel || order.clothingName}</span>
            <span style={{fontSize:11,color:T.sub,marginLeft:4}}>· ล็อตนี้ ≈ <b>{estimateRolls(lotTotal)}</b> ม้วน ({fmtInt(ROLL_CAPACITY)}/ม้วน)</span>
            <span style={{marginLeft:"auto",display:"flex",gap:6}}>
              <button onClick={printRollLabel} title="พิมพ์ป้ายแปะม้วน" style={{padding:"4px 12px",borderRadius:7,border:"1px solid rgba(58,122,82,0.35)",background:"#f0fdf4",color:T.green,fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>🏷️ พิมพ์ป้าย</button>
              {!!userRole && !isCancelled && (
                <button onClick={startEditMachine} style={{padding:"4px 12px",borderRadius:7,border:"1px solid rgba(59,91,139,0.3)",background:"white",color:T.accent,fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>✏️ ตั้งเครื่อง/ม้วน</button>
              )}
            </span>
          </>
        )}
      </div>

      {/* Items — ใหญ่ขึ้นเพื่อเห็นรายการชัดเจน */}
      <div style={{padding:18,background:"#f8fafc",border:`1px solid ${T.border}`,borderRadius:12,marginBottom:14}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
          <div style={{fontSize:13,fontWeight:700,color:T.accent,textTransform:"uppercase",letterSpacing:"0.06em"}}>📦 รายการในล็อตนี้</div>
          {!!userRole && !isCancelled && !editMode && (
            <button onClick={startEdit} style={{padding:"5px 12px",borderRadius:7,border:"1px solid rgba(59,91,139,0.3)",background:"rgba(59,91,139,0.08)",color:T.accent,fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>✏️ แก้ไข</button>
          )}
        </div>
        {editMode ? (
          <>
            <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:10}}>
              {editItems.map((it, idx) => (
                <div key={idx} style={{display:"grid",gridTemplateColumns:"1fr 1fr 70px 70px 70px 32px",gap:6,alignItems:"center",padding:6,background:"white",border:`1px solid ${T.border}`,borderRadius:7}}>
                  <input value={it.colorName} onChange={e => updateEditItem(idx, { colorName: e.target.value })} placeholder="สี"
                    style={{padding:"5px 8px",border:`1px solid ${T.border}`,borderRadius:5,fontSize:12,outline:"none",fontFamily:"inherit"}}/>
                  <input value={it.variant || ""} onChange={e => updateEditItem(idx, { variant: e.target.value })} placeholder="ลักษณะ"
                    list={`lot-variant-suggestions-${idx}`}
                    style={{padding:"5px 8px",border:`1px solid ${T.border}`,borderRadius:5,fontSize:12,outline:"none",fontFamily:"inherit"}}/>
                  <datalist id={`lot-variant-suggestions-${idx}`}>
                    {VARIANT_PRESETS.map(v => <option key={v} value={v}/>)}
                  </datalist>
                  <input value={it.size} onChange={e => updateEditItem(idx, { size: e.target.value })} placeholder="ลูกค้า"
                    title="ไซส์ลูกค้า (ขึ้นในบิล)"
                    style={{padding:"5px 8px",border:`1px solid ${T.border}`,borderRadius:5,fontSize:12,outline:"none",fontFamily:"inherit",textAlign:"center"}}/>
                  <input value={it.productionSize||""} onChange={e => updateEditItem(idx, { productionSize: e.target.value })} placeholder="ผลิต"
                    title="🪡 ไซส์ผลิต (ขึ้นในใบสั่งผลิต) — ปล่อยว่าง = ใช้ไซส์ลูกค้า"
                    style={{padding:"5px 8px",border:`1px solid rgba(217,119,6,0.3)`,background:"rgba(217,119,6,0.04)",borderRadius:5,fontSize:12,outline:"none",fontFamily:"inherit",textAlign:"center",fontWeight:700,color:"#92400e"}}/>
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
                {it.variant && <span style={{color:T.sub,fontSize:13,padding:"2px 8px",background:"rgba(59,91,139,0.08)",borderRadius:10}}>{it.variant}</span>}
                <span style={{color:T.sub,fontSize:14}}>/ {it.size}</span>
                {it.productionSize && it.productionSize !== it.size && <span style={{color:"#92400e",fontSize:11,padding:"2px 7px",background:"rgba(217,119,6,0.1)",border:"1px solid rgba(217,119,6,0.3)",borderRadius:10,fontWeight:700}} title="🪡 ไซส์ผลิต">🪡 ผลิต: {it.productionSize}</span>}
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
          {lotTotal > 0 && (
            <BtnGhost onClick={() => setShowRollSplit(true)} disabled={busy} style={{flex:1,minWidth:150}}>🧵 แบ่งม้วน</BtnGhost>
          )}
          {lots.filter(l => l.status === lot.status && l.status !== "ยกเลิก").length > 1 && (
            <BtnGhost onClick={handleMergeAllLots} disabled={busy} style={{flex:1,minWidth:160}}>🔗 รวมล็อตขั้นนี้ ({lots.filter(l => l.status === lot.status && l.status !== "ยกเลิก").length})</BtnGhost>
          )}
          {!!userRole && !isFinal && (
            <BtnDanger onClick={handleCancel} disabled={busy} style={{minWidth:90}}>🛑 ยกเลิก</BtnDanger>
          )}
          {!!userRole && (
            <button onClick={handleDeleteLot} disabled={busy}
              title={lots.length === 1 ? "ลบใบสั่งผลิตทั้งใบ" : "ลบล็อตนี้"}
              style={{padding:"8px 14px",borderRadius:8,border:"1px solid rgba(127,29,29,0.4)",background:"rgba(127,29,29,0.08)",color:"#7f1d1d",fontSize:13,fontWeight:600,cursor:busy?"not-allowed":"pointer",fontFamily:"'Sarabun',sans-serif",opacity:busy?0.45:1,minWidth:90}}>🗑 ลบ</button>
          )}
        </div>
      )}

      {/* Cancelled lot ก็ลบได้ */}
      {isCancelled && !!userRole && (
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
          steps={steps}
          onClose={() => setShowSplit(false)}
          onConfirm={async (selections, opts = {}) => {
            setBusy(true);
            try {
              const { newLots, splitOk } = splitLot(lots, lotIdx, selections, {
                by: user?.name || "",
                machine: opts.machine || "",
                rollNo: opts.rollNo || "",
                targetStatus: opts.targetStatus || undefined,
                machineByStage: opts.machineByStage || {},
              });
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

      {/* Roll-split modal */}
      {showRollSplit && (
        <RollSplitModal
          lot={lot}
          lots={lots}
          lotIdx={lotIdx}
          busy={busy}
          onClose={() => setShowRollSplit(false)}
          onConfirm={applyRollSplit}
          onConfirmManual={applyManualRolls}
        />
      )}
    </Modal>
  );
}

// ── Roll-split modal: แบ่งของในล็อตเป็นหลายม้วน (อัตโนมัติ หรือ กรอกเอง) ──
function RollSplitModal({ lot, lots = [], lotIdx, busy, onClose, onConfirm, onConfirmManual }) {
  const [mode, setMode] = useState("manual"); // "manual" | "auto"
  const lotItems = lot.items || [];

  // 🩹 หา rollNo สูงสุดของม้วนพี่น้อง (ที่ไม่ใช่ตัวเอง) — เพื่อให้ลำดับม้วนใหม่ต่อจากเดิม
  const siblingMaxRoll = (() => {
    let max = 0;
    (lots || []).forEach((l, i) => {
      if (i === lotIdx) return; // ข้ามล็อตที่กำลังแบ่ง
      const n = parseInt(l.rollNo, 10);
      if (!isNaN(n) && n > max) max = n;
    });
    return max;
  })();
  const startRollNo = siblingMaxRoll; // ม้วนใหม่จะเริ่มที่ startRollNo + 1, +2, ...

  // ── โหมดอัตโนมัติ ──
  const [items, setItems] = useState(() => lotItems.map(it => ({ ...it })));
  const [capacity, setCapacity] = useState(ROLL_CAPACITY);
  const move = (idx, dir) => setItems(prev => {
    const ni = idx + dir;
    if (ni < 0 || ni >= prev.length) return prev;
    const arr = [...prev];
    [arr[idx], arr[ni]] = [arr[ni], arr[idx]];
    return arr;
  });
  const cap = Math.max(1, Number(capacity) || ROLL_CAPACITY);
  const autoRolls = packIntoRolls(items, cap);
  // เรียงตามไซส์ (รวมทุกสีของไซส์เดียวกันไว้ด้วยกัน) — JS sort เสถียร สีคงลำดับเดิม
  const sortBySize = (dir) => setItems(prev => [...prev].sort((a,b) => {
    const ra = sizeRank(a.productionSize || a.size), rb = sizeRank(b.productionSize || b.size);
    return dir === "desc" ? rb - ra : ra - rb;
  }));

  // ── โหมดกรอกเอง ──
  const [mRolls, setMRolls] = useState([{ jobLabel: "", rows: [{ itemIdx: "", qty: "" }] }]);
  const setMRollField = (ri, patch) => setMRolls(prev => prev.map((roll, i) => i !== ri ? roll : { ...roll, ...patch }));
  const setMRow = (ri, rowi, patch) => setMRolls(prev => prev.map((roll, i) => i !== ri ? roll : { ...roll, rows: roll.rows.map((row, j) => j === rowi ? { ...row, ...patch } : row) }));
  const addMRow = (ri) => setMRolls(prev => prev.map((roll, i) => i !== ri ? roll : { ...roll, rows: [...roll.rows, { itemIdx: "", qty: "" }] }));
  const removeMRow = (ri, rowi) => setMRolls(prev => prev.map((roll, i) => i !== ri ? roll : { ...roll, rows: roll.rows.filter((_, j) => j !== rowi) }));
  // เลื่อนแถวขึ้น/ลงในม้วน (สลับกับแถวข้างเคียง)
  const moveMRow = (ri, rowi, dir) => setMRolls(prev => prev.map((roll, i) => {
    if (i !== ri) return roll;
    const ni = rowi + dir;
    if (ni < 0 || ni >= roll.rows.length) return roll;
    const arr = [...roll.rows];
    [arr[rowi], arr[ni]] = [arr[ni], arr[rowi]];
    return { ...roll, rows: arr };
  }));
  const addRoll = () => setMRolls(prev => [...prev, { jobLabel: "", rows: [{ itemIdx: "", qty: "" }] }]);
  // 🖱️ คลิกช่องในตาราง "คงเหลือ" → เพิ่มแถวเข้าม้วนล่าสุด (ตามลำดับคลิก)
  const clickCellToLastRoll = (itemIdx, defaultQty) => {
    if (itemIdx == null || itemIdx < 0) return;
    setMRolls(prev => {
      const arr = [...prev];
      const last = arr.length - 1;
      const target = { ...arr[last] };
      const newRow = { itemIdx: String(itemIdx), qty: String(defaultQty || "") };
      // ถ้าแถวสุดท้ายว่าง (ยังไม่ได้เลือกอะไร) → แทน; ไม่งั้น append
      const rows = [...(target.rows || [])];
      const lastRow = rows[rows.length - 1];
      if (lastRow && !lastRow.itemIdx && !lastRow.qty) {
        rows[rows.length - 1] = newRow;
      } else {
        rows.push(newRow);
      }
      target.rows = rows;
      arr[last] = target;
      return arr;
    });
  };
  const removeRoll = (ri) => setMRolls(prev => prev.filter((_, i) => i !== ri));
  // เลื่อนม้วนขึ้น/ลง
  const moveRoll = (ri, dir) => setMRolls(prev => {
    const ni = ri + dir;
    if (ni < 0 || ni >= prev.length) return prev;
    const arr = [...prev];
    [arr[ri], arr[ni]] = [arr[ni], arr[ri]];
    return arr;
  });

  // รวมยอดที่ใช้ต่อ item + คงเหลือ
  const usedByItem = {};
  mRolls.forEach(roll => roll.rows.forEach(r => { if (r.itemIdx !== "") usedByItem[r.itemIdx] = (usedByItem[r.itemIdx] || 0) + (Number(r.qty) || 0); }));
  const manualGrand = Object.values(usedByItem).reduce((s, v) => s + v, 0);

  // สร้าง rolls สำหรับ confirm (โหมดกรอกเอง) — ต่อจาก siblingMaxRoll
  const buildManualRolls = () => mRolls.map((roll, i) => ({
    rollNo: startRollNo + i + 1,
    jobLabel: (roll.jobLabel || "").trim(),
    items: roll.rows.filter(r => r.itemIdx !== "" && Number(r.qty) > 0).map(r => ({ ...lotItems[Number(r.itemIdx)], qty: Number(r.qty) })),
  })).filter(r => r.items.length > 0);

  const itemLabel = (it) => `${it.colorName} / ${it.productionSize || it.size}`;

  return (
    <Modal onClose={onClose} w={860}>
      <MHead title={`🧵 แบ่งม้วน · ${lot.lotId}`} sub="กรอกเองว่าแต่ละม้วนพิมพ์อะไร (ใส่ชื่อรุ่น/งานได้) หรือให้ระบบจัดอัตโนมัติ" onClose={onClose}/>

      {/* tabs */}
      <div style={{display:"flex",gap:4,background:"#eef2f7",borderRadius:8,padding:3,marginBottom:14}}>
        <button onClick={()=>setMode("manual")} style={{flex:1,padding:"6px",borderRadius:6,border:"none",cursor:"pointer",fontSize:12,fontWeight:600,fontFamily:"inherit",background:mode==="manual"?"white":"transparent",color:mode==="manual"?T.accent:T.sub,boxShadow:mode==="manual"?"0 1px 3px rgba(0,0,0,0.1)":"none"}}>✍️ กรอกเอง</button>
        <button onClick={()=>setMode("auto")} style={{flex:1,padding:"6px",borderRadius:6,border:"none",cursor:"pointer",fontSize:12,fontWeight:600,fontFamily:"inherit",background:mode==="auto"?"white":"transparent",color:mode==="auto"?T.accent:T.sub,boxShadow:mode==="auto"?"0 1px 3px rgba(0,0,0,0.1)":"none"}}>⚙️ อัตโนมัติ</button>
      </div>

      {mode === "manual" ? (
        <>
          {/* คงเหลือ — ตารางกริด ไซส์เป็นคอลัมน์ตรงกันทุกสี */}
          {(() => {
            const rem = lotItems.map((it, idx) => ({ ...it, idx, sz: it.productionSize || it.size, remain: (Number(it.qty) || 0) - (usedByItem[idx] || 0) }));
            // 🗺️ map: colorName|colorHex|size → itemIdx (สำหรับคลิกเซลล์)
            const cellIdx = {};
            rem.forEach(it => { cellIdx[`${it.colorName||"-"}|${it.colorHex||"#999"}|${it.sz}`] = { idx: it.idx, remain: it.remain }; });
            // union ไซส์ทั้งหมด เรียงเล็ก→ใหญ่
            const allSizes = Array.from(new Set(rem.map(it => it.sz))).sort((a, b) => sizeRank(a) - sizeRank(b));
            // group by สี → { size: remain }
            const groups = []; const gm = new Map();
            rem.forEach(it => {
              const key = (it.colorName || "-") + "|" + (it.colorHex || "#999");
              if (!gm.has(key)) { const g = { colorName: it.colorName || "-", colorHex: it.colorHex || "#999", map: {} }; gm.set(key, g); groups.push(g); }
              gm.get(key).map[it.sz] = (gm.get(key).map[it.sz] || 0) + it.remain;
            });
            const colTotal = (sz) => groups.reduce((s, g) => s + (g.map[sz] || 0), 0);
            const grand = rem.reduce((s, it) => s + it.remain, 0);
            const th = { padding: "5px 4px", textAlign: "center", fontWeight: 700, fontSize: 11, fontFamily: "monospace", borderRight: `1px solid ${T.border}`, background: "#e0f2fe", color: "#0c4a6e", minWidth: 40 };
            return (
              <div style={{marginBottom:12,border:`1px solid ${T.border}`,borderRadius:8,overflow:"hidden"}}>
                <div style={{padding:"5px 10px",background:"#f1f5fb",fontSize:11,fontWeight:700,color:T.sub,display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                  <span>📦 คงเหลือ (ยังไม่ใส่ม้วน)</span>
                  <span style={{fontSize:10,color:T.accent,fontWeight:600}}>💡 คลิกช่องสีน้ำเงินเพื่อเพิ่มเข้าม้วนล่าสุดเลย (ตามลำดับคลิก)</span>
                </div>
                <div style={{overflowX:"auto",maxHeight:200,overflowY:"auto"}}>
                  <table style={{borderCollapse:"collapse",fontSize:12,width:"100%"}}>
                    <thead>
                      <tr style={{background:"#f1f5fb"}}>
                        <th style={{position:"sticky",left:0,background:"#f1f5fb",zIndex:2,padding:"5px 8px",textAlign:"left",fontWeight:700,fontSize:11,color:T.sub,borderRight:`1px solid ${T.border}`,minWidth:80}}>สี</th>
                        {allSizes.map(sz => <th key={sz} style={th}>{sz}</th>)}
                        <th style={{padding:"5px 8px",textAlign:"center",fontWeight:700,fontSize:11,color:T.accent,minWidth:46}}>รวม</th>
                      </tr>
                    </thead>
                    <tbody>
                      {groups.map((g,gi) => {
                        const rowTotal = allSizes.reduce((s,sz)=>s+(g.map[sz]||0),0);
                        return (
                          <tr key={gi} style={{borderTop:`1px solid ${T.border}`}}>
                            <td style={{position:"sticky",left:0,background:"white",zIndex:1,padding:"4px 8px",whiteSpace:"nowrap",borderRight:`1px solid ${T.border}`}}>
                              <span style={{display:"inline-flex",alignItems:"center",gap:5}}>
                                <span style={{width:11,height:11,borderRadius:2,background:g.colorHex,border:"1px solid rgba(0,0,0,0.15)"}}/>
                                <b style={{color:T.text}}>{g.colorName}</b>
                              </span>
                            </td>
                            {allSizes.map(sz => {
                              const v = g.map[sz];
                              const info = cellIdx[`${g.colorName}|${g.colorHex}|${sz}`];
                              const clickable = v !== undefined && v > 0 && info;
                              return (
                                <td key={sz}
                                  onClick={clickable ? () => clickCellToLastRoll(info.idx, info.remain) : undefined}
                                  title={clickable ? `คลิกเพื่อเพิ่ม ${v} ตัวเข้าม้วนปัจจุบัน` : ""}
                                  style={{padding:"4px 4px",textAlign:"center",fontFamily:"monospace",borderRight:`1px solid ${T.border}`,fontWeight:700,
                                    background: v===undefined?"#fff":v<0?"#fef2f2":v===0?"#f0fdf4":clickable?"#eef2ff":"#fff",
                                    color: v===undefined?"#cbd5e1":v<0?T.red:v===0?T.green:clickable?T.accent:T.text,
                                    cursor: clickable?"pointer":"default",
                                    transition:"background 0.15s"}}
                                  onMouseEnter={clickable?e=>e.currentTarget.style.background="#c7d2fe":undefined}
                                  onMouseLeave={clickable?e=>e.currentTarget.style.background="#eef2ff":undefined}>
                                  {v===undefined?"·":fmtInt(v)}
                                </td>
                              );
                            })}
                            <td style={{padding:"4px 6px",textAlign:"center",fontFamily:"monospace",fontWeight:800,color:T.accent}}>{fmtInt(rowTotal)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr style={{borderTop:`2px solid ${T.border}`,background:"#f8fafc"}}>
                        <td style={{position:"sticky",left:0,background:"#f8fafc",padding:"5px 8px",fontWeight:700,color:T.sub,borderRight:`1px solid ${T.border}`}}>รวม</td>
                        {allSizes.map(sz => {const ct=colTotal(sz);return <td key={sz} style={{padding:"5px 4px",textAlign:"center",fontFamily:"monospace",fontWeight:700,color:ct<0?T.red:T.green,borderRight:`1px solid ${T.border}`}}>{fmtInt(ct)}</td>;})}
                        <td style={{padding:"5px 6px",textAlign:"center",fontFamily:"monospace",fontWeight:800,color:grand<0?T.red:T.green}}>{fmtInt(grand)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            );
          })()}

          <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:12}}>
            {mRolls.map((roll, ri) => {
              const rollTotal = roll.rows.reduce((s,r)=>s+(Number(r.qty)||0),0);
              return (
                <div key={ri} style={{border:`1px solid #bfdbfe`,borderRadius:9,overflow:"hidden"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,padding:"6px 10px",background:"#eef6ff",flexWrap:"wrap"}}>
                    <span style={{display:"flex",alignItems:"center",gap:8,flex:"1 1 240px"}}>
                      <span style={{fontSize:13,fontWeight:700,color:"#1e40af",whiteSpace:"nowrap"}}>🧵 ม้วน {startRollNo + ri + 1}</span>
                      <input value={roll.jobLabel||""} onChange={e=>setMRollField(ri,{jobLabel:e.target.value})} placeholder="👕 ชื่อรุ่น/งาน (เช่น K12, เสื้อคลาส)"
                        style={{flex:1,minWidth:120,padding:"5px 8px",border:`1px solid ${T.border}`,borderRadius:6,fontSize:12,outline:"none",fontFamily:"inherit",background:"white"}}/>
                    </span>
                    <span style={{display:"flex",alignItems:"center",gap:8}}>
                      <span style={{fontFamily:"monospace",fontWeight:700,color:"#1e40af",fontSize:13}}>{fmtInt(rollTotal)} ตัว</span>
                      {mRolls.length>1 && (
                        <span style={{display:"flex",flexDirection:"column",gap:1}}>
                          <button onClick={()=>moveRoll(ri,-1)} disabled={ri===0}
                            title="เลื่อนม้วนขึ้น"
                            style={{height:13,width:18,padding:0,border:`1px solid ${ri===0?T.border:"#1e40af"}`,background:ri===0?"#f1f5f9":"white",color:ri===0?T.muted:"#1e40af",borderRadius:3,cursor:ri===0?"not-allowed":"pointer",fontSize:8,fontFamily:"inherit",fontWeight:700,opacity:ri===0?0.4:1}}>▲</button>
                          <button onClick={()=>moveRoll(ri,1)} disabled={ri===mRolls.length-1}
                            title="เลื่อนม้วนลง"
                            style={{height:13,width:18,padding:0,border:`1px solid ${ri===mRolls.length-1?T.border:"#1e40af"}`,background:ri===mRolls.length-1?"#f1f5f9":"white",color:ri===mRolls.length-1?T.muted:"#1e40af",borderRadius:3,cursor:ri===mRolls.length-1?"not-allowed":"pointer",fontSize:8,fontFamily:"inherit",fontWeight:700,opacity:ri===mRolls.length-1?0.4:1}}>▼</button>
                        </span>
                      )}
                      {mRolls.length>1&&<button onClick={()=>removeRoll(ri)} style={{border:"none",background:"transparent",color:T.red,cursor:"pointer",fontSize:14}}>✕</button>}
                    </span>
                  </div>
                  <div style={{padding:"8px 10px",display:"flex",flexDirection:"column",gap:5}}>
                    {roll.rows.map((row, rowi) => (
                      <div key={rowi} style={{display:"grid",gridTemplateColumns:"40px 1fr 90px 28px",gap:6,alignItems:"center"}}>
                        {/* up/down arrows */}
                        <div style={{display:"flex",flexDirection:"column",gap:1}}>
                          <button onClick={()=>moveMRow(ri,rowi,-1)} disabled={rowi===0}
                            title="เลื่อนขึ้น"
                            style={{height:13,padding:0,border:`1px solid ${rowi===0?T.border:T.accent}`,background:rowi===0?"#f1f5f9":"rgba(59,91,139,0.08)",color:rowi===0?T.muted:T.accent,borderRadius:4,cursor:rowi===0?"not-allowed":"pointer",fontSize:8,fontFamily:"inherit",fontWeight:700,opacity:rowi===0?0.4:1}}>▲</button>
                          <button onClick={()=>moveMRow(ri,rowi,1)} disabled={rowi===roll.rows.length-1}
                            title="เลื่อนลง"
                            style={{height:13,padding:0,border:`1px solid ${rowi===roll.rows.length-1?T.border:T.accent}`,background:rowi===roll.rows.length-1?"#f1f5f9":"rgba(59,91,139,0.08)",color:rowi===roll.rows.length-1?T.muted:T.accent,borderRadius:4,cursor:rowi===roll.rows.length-1?"not-allowed":"pointer",fontSize:8,fontFamily:"inherit",fontWeight:700,opacity:rowi===roll.rows.length-1?0.4:1}}>▼</button>
                        </div>
                        <select value={row.itemIdx} onChange={e=>setMRow(ri,rowi,{itemIdx:e.target.value})}
                          style={{padding:"6px 8px",border:`1px solid ${T.border}`,borderRadius:6,fontSize:12,outline:"none",fontFamily:"inherit",background:"white"}}>
                          <option value="">— เลือกสี/ไซส์ —</option>
                          {lotItems.map((it,idx)=><option key={idx} value={idx}>{itemLabel(it)}</option>)}
                        </select>
                        <input type="number" min="0" value={row.qty} onChange={e=>setMRow(ri,rowi,{qty:e.target.value})} placeholder="จำนวน"
                          style={{padding:"6px 8px",border:`1px solid ${T.border}`,borderRadius:6,textAlign:"center",fontFamily:"monospace",fontSize:13,outline:"none"}}/>
                        {roll.rows.length>1
                          ? <button onClick={()=>removeMRow(ri,rowi)} style={{border:`1px solid #fecaca`,background:"#fef2f2",borderRadius:5,color:T.red,cursor:"pointer",fontSize:11,height:28}}>✕</button>
                          : <div/>}
                      </div>
                    ))}
                    <button onClick={()=>addMRow(ri)} style={{alignSelf:"flex-start",padding:"3px 10px",fontSize:11,border:`1px dashed ${T.accent}`,borderRadius:6,background:"transparent",color:T.accent,cursor:"pointer",fontFamily:"inherit"}}>+ เพิ่มสี/ไซส์ในม้วนนี้</button>
                  </div>
                </div>
              );
            })}
          </div>

          <button onClick={addRoll} style={{width:"100%",padding:"8px",borderRadius:8,border:`1px dashed ${T.accent}`,background:"rgba(59,91,139,0.05)",color:T.accent,cursor:"pointer",fontSize:12,fontWeight:600,fontFamily:"inherit",marginBottom:12}}>+ เพิ่มม้วน</button>

          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 12px",background:"rgba(58,122,82,0.08)",borderRadius:8,marginBottom:8,flexWrap:"wrap",gap:6}}>
            <span style={{fontSize:13,color:T.text,fontWeight:700}}>
              เพิ่ม {mRolls.length} ม้วนใหม่ (#{startRollNo+1}–#{startRollNo+mRolls.length})
              {startRollNo > 0 && <span style={{fontSize:11,color:T.muted,fontWeight:500,marginLeft:6}}>· มีอยู่แล้ว {startRollNo} ม้วน</span>}
            </span>
            <span style={{fontSize:13,color:T.green,fontWeight:700,fontFamily:"monospace"}}>รวม {fmtInt(manualGrand)} ตัว</span>
          </div>
          {(() => {
            const lotTot = lotItems.reduce((s,it)=>s+(Number(it.qty)||0),0);
            const left = lotTot - manualGrand;
            return left > 0 ? (
              <div style={{fontSize:11,color:"#92400e",background:"#fffbeb",border:"1px solid #fde68a",borderRadius:7,padding:"6px 10px",marginBottom:12}}>
                ℹ️ ที่เหลืออีก <b>{fmtInt(left)}</b> ตัวที่ยังไม่ใส่ม้วน → จะเก็บเป็นล็อต <b>"เหลือ"</b> อัตโนมัติ (ไม่หาย)
              </div>
            ) : null;
          })()}

          <div style={{display:"flex",gap:8}}>
            <BtnGhost onClick={onClose} disabled={busy} style={{flex:1}}>ยกเลิก</BtnGhost>
            <BtnPrimary onClick={()=>onConfirmManual(buildManualRolls())} disabled={busy || manualGrand<=0} style={{flex:1}}>{busy?"กำลังบันทึก...":"🧵 สร้างม้วน"}</BtnPrimary>
          </div>
        </>
      ) : (
        <>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
            <span style={{fontSize:12,color:T.sub,fontWeight:600}}>ความจุต่อม้วน:</span>
            <input type="number" value={capacity} onChange={e=>setCapacity(e.target.value)}
              style={{width:100,padding:"6px 10px",border:`1px solid ${T.border}`,borderRadius:7,fontSize:13,fontFamily:"monospace",textAlign:"center",outline:"none"}}/>
            <span style={{fontSize:11,color:T.muted}}>ตัว/ม้วน (ปรับได้ตามจริง)</span>
          </div>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6,flexWrap:"wrap",gap:6}}>
            <span style={{fontSize:11,fontWeight:700,color:T.sub,textTransform:"uppercase"}}>1️⃣ ลำดับการพิมพ์</span>
            <span style={{display:"flex",gap:5}}>
              <button onClick={()=>sortBySize("desc")} title="พิมพ์ไซส์ใหญ่ก่อน (XL→L→M) ทุกสีของไซส์เดียวกันอยู่ด้วยกัน" style={{padding:"3px 10px",fontSize:11,border:`1px solid ${T.border}`,borderRadius:6,background:"white",color:T.accent,cursor:"pointer",fontFamily:"inherit",fontWeight:600}}>↕️ ไซส์ใหญ่→เล็ก</button>
              <button onClick={()=>sortBySize("asc")} title="ไซส์เล็กก่อน" style={{padding:"3px 10px",fontSize:11,border:`1px solid ${T.border}`,borderRadius:6,background:"white",color:T.sub,cursor:"pointer",fontFamily:"inherit"}}>เล็ก→ใหญ่</button>
            </span>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:4,marginBottom:14,maxHeight:180,overflowY:"auto"}}>
            {items.map((it, i) => (
              <div key={i} style={{display:"grid",gridTemplateColumns:"1fr 70px 28px 28px",gap:6,alignItems:"center",padding:"6px 8px",background:"#f8fafc",border:`1px solid ${T.border}`,borderRadius:7}}>
                <div style={{fontSize:12,color:T.text}}>
                  <span style={{width:10,height:10,borderRadius:2,background:it.colorHex||"#999",display:"inline-block",marginRight:6,verticalAlign:"middle",border:"1px solid rgba(0,0,0,0.1)"}}/>
                  <b>{it.colorName}</b> / {it.productionSize || it.size}
                </div>
                <div style={{textAlign:"right",fontFamily:"monospace",fontWeight:700,color:T.accent,fontSize:12}}>{fmtInt(it.qty)}</div>
                <button onClick={()=>move(i,-1)} disabled={i===0} style={{padding:"3px",border:`1px solid ${T.border}`,borderRadius:5,background:i===0?"#f1f5f9":"white",cursor:i===0?"not-allowed":"pointer",fontSize:11}}>↑</button>
                <button onClick={()=>move(i,1)} disabled={i===items.length-1} style={{padding:"3px",border:`1px solid ${T.border}`,borderRadius:5,background:i===items.length-1?"#f1f5f9":"white",cursor:i===items.length-1?"not-allowed":"pointer",fontSize:11}}>↓</button>
              </div>
            ))}
          </div>
          <div style={{fontSize:11,fontWeight:700,color:T.sub,marginBottom:6,textTransform:"uppercase"}}>2️⃣ ผลลัพธ์ — {autoRolls.length} ม้วน</div>
          <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:14,maxHeight:220,overflowY:"auto"}}>
            {autoRolls.map((r) => (
              <div key={r.rollNo} style={{border:`1px solid ${T.border}`,borderRadius:8,overflow:"hidden"}}>
                <div style={{display:"flex",justifyContent:"space-between",padding:"5px 10px",background:"#eef6ff",fontSize:12,fontWeight:700,color:"#1e40af"}}>
                  <span>🧵 ม้วน {startRollNo + r.rollNo}</span>
                  <span style={{fontFamily:"monospace"}}>{fmtInt(r.total)} ตัว</span>
                </div>
                <div style={{display:"flex",flexWrap:"wrap",gap:4,padding:"6px 10px"}}>
                  {r.items.map((it,j) => (
                    <span key={j} style={{padding:"2px 8px",fontSize:11,background:"#f8fafc",border:`1px solid ${T.border}`,borderRadius:6}}>
                      {it.colorName} {it.productionSize || it.size} <b style={{color:T.accent}}>×{fmtInt(it.qty)}</b>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div style={{display:"flex",gap:8}}>
            <BtnGhost onClick={onClose} disabled={busy} style={{flex:1}}>ยกเลิก</BtnGhost>
            <BtnPrimary onClick={()=>onConfirm(items, cap)} disabled={busy || autoRolls.length<=1} style={{flex:1}}>{busy?"กำลังบันทึก...":`🧵 สร้าง ${autoRolls.length} ม้วน`}</BtnPrimary>
          </div>
        </>
      )}
    </Modal>
  );
}

// ── Split modal ──
function SplitLotModal({ lot, steps = PRODUCTION_STEPS, onClose, onConfirm }) {
  const [sels, setSels] = useState(() => (lot.items || []).map(() => ""));
  const [machine, setMachine] = useState("");
  const [rollNo, setRollNo] = useState("");
  const [targetStage, setTargetStage] = useState("");   // "" = คงขั้นเดิม
  const [team, setTeam] = useState("");                  // ทีม/เครื่องของขั้นปลายทาง
  const [capacity, setCapacity] = useState(ROLL_CAPACITY); // ม้วนปรับได้ (ไม่ fix 1800)
  const setSel = (idx, val) => setSels(prev => prev.map((v, i) => i === idx ? val : v));

  const splitTotal = sels.reduce((s, v) => s + (Number(v) || 0), 0);
  const cap = Math.max(1, Number(capacity) || ROLL_CAPACITY);
  const rollEst = Math.max(1, Math.ceil(splitTotal / cap));
  const stageTeamChoices = targetStage ? (MACHINES_BY_STAGE[targetStage] || []) : [];

  const submit = () => {
    const selections = sels.map((v, idx) => ({ itemIdx: idx, qty: Number(v) || 0 }))
                          .filter(s => s.qty > 0);
    const machineByStage = (targetStage && team) ? { [targetStage]: team } : {};
    onConfirm(selections, { machine: machine.trim(), rollNo: rollNo.trim(), targetStatus: targetStage || undefined, machineByStage });
  };

  return (
    <Modal onClose={onClose} w={560}>
      <MHead title={`✂️ แยกล็อต ${lot.lotId}`} sub="เลือกสี/ไซส์ + จำนวน → ส่งไปขั้น/ทีม หรือตั้งเครื่องพิมพ์-ม้วน" onClose={onClose}/>

      {/* ส่งไปขั้น + ทีม (เช่น ส่งทีมเย็บ) */}
      <div style={{display:"flex",gap:8,marginBottom:10,flexWrap:"wrap",padding:"10px",background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:9}}>
        <div style={{flex:"1 1 160px"}}>
          <label style={{fontSize:11,color:T.sub,display:"block",marginBottom:3,fontWeight:600}}>📍 ส่งไปขั้น</label>
          <select value={targetStage} onChange={e=>{setTargetStage(e.target.value);setTeam("");}}
            style={{width:"100%",boxSizing:"border-box",padding:"7px 10px",border:`1px solid ${T.border}`,borderRadius:7,fontSize:12,outline:"none",fontFamily:"inherit",background:"white"}}>
            <option value="">— คงขั้นเดิม ({lot.status}) —</option>
            {steps.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div style={{flex:"1 1 160px"}}>
          <label style={{fontSize:11,color:T.sub,display:"block",marginBottom:3,fontWeight:600}}>🏭 ทีม/เครื่อง</label>
          {stageTeamChoices.length > 0 ? (
            <select value={team} onChange={e=>setTeam(e.target.value)}
              style={{width:"100%",boxSizing:"border-box",padding:"7px 10px",border:`1px solid ${T.border}`,borderRadius:7,fontSize:12,outline:"none",fontFamily:"inherit",background:"white"}}>
              <option value="">— ยังไม่ระบุ —</option>
              {stageTeamChoices.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          ) : (
            <input value={team} onChange={e=>setTeam(e.target.value)} placeholder={targetStage?"พิมพ์ทีม/เครื่อง":"เลือกขั้นก่อน"} disabled={!targetStage}
              style={{width:"100%",boxSizing:"border-box",padding:"7px 10px",border:`1px solid ${T.border}`,borderRadius:7,fontSize:12,outline:"none",fontFamily:"inherit",background:targetStage?"white":"#f1f5f9"}}/>
          )}
        </div>
      </div>

      {/* เครื่องพิมพ์ + ม้วน ของล็อตใหม่ (สำหรับวางแผนพิมพ์) */}
      <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap"}}>
        <div style={{flex:"1 1 150px"}}>
          <label style={{fontSize:11,color:T.sub,display:"block",marginBottom:3,fontWeight:600}}>🖨️ เครื่องพิมพ์ (ถ้ามี)</label>
          <input value={machine} onChange={e=>setMachine(e.target.value)} placeholder="เช่น CPU 1"
            style={{width:"100%",boxSizing:"border-box",padding:"7px 10px",border:`1px solid ${T.border}`,borderRadius:7,fontSize:12,outline:"none",fontFamily:"inherit"}}/>
        </div>
        <div style={{flex:"0 1 90px"}}>
          <label style={{fontSize:11,color:T.sub,display:"block",marginBottom:3,fontWeight:600}}>🧵 ม้วน</label>
          <input value={rollNo} onChange={e=>setRollNo(e.target.value)} placeholder="1"
            style={{width:"100%",boxSizing:"border-box",padding:"7px 10px",border:`1px solid ${T.border}`,borderRadius:7,fontSize:12,outline:"none",fontFamily:"inherit"}}/>
        </div>
        <div style={{flex:"0 1 110px"}}>
          <label style={{fontSize:11,color:T.sub,display:"block",marginBottom:3,fontWeight:600}}>ตัว/ม้วน</label>
          <input type="number" value={capacity} onChange={e=>setCapacity(e.target.value)}
            style={{width:"100%",boxSizing:"border-box",padding:"7px 10px",border:`1px solid ${T.border}`,borderRadius:7,fontSize:12,outline:"none",fontFamily:"monospace",textAlign:"center"}}/>
        </div>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:10,maxHeight:240,overflowY:"auto"}}>
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
      <div style={{textAlign:"right",fontSize:12,color:T.sub,marginBottom:12}}>
        จะแยกออก <b style={{color:T.accent}}>{fmtInt(splitTotal)}</b> ตัว{splitTotal>0&&<> ≈ <b style={{color:T.accent}}>{rollEst}</b> ม้วน ({fmtInt(cap)}/ม้วน)</>}
        {targetStage && <span style={{marginLeft:8,color:T.green,fontWeight:600}}>→ {targetStage}{team?` · ${team}`:""}</span>}
      </div>
      <div style={{display:"flex",gap:8}}>
        <BtnGhost onClick={onClose} style={{flex:1}}>ยกเลิก</BtnGhost>
        <BtnPrimary onClick={submit} style={{flex:1}}>✂️ ยืนยันแยกล็อต</BtnPrimary>
      </div>
    </Modal>
  );
}
