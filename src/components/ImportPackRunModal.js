// 📥 นำเข้ารายการเข้ารอบแพ็ค
//
// ทางหลัก: ลากไฟล์ "ใบปะหน้า PDF" ที่ลูกค้าส่งมาอยู่แล้ว → ได้ยอดทั้งรอบทันที
// ทางรอง: วางข้อความจากแชท LINE · ไฟล์ Excel/CSV
//
// 🔒 ไม่ลงเงียบ ๆ เด็ดขาด — ตัวเลขนี้ไปตัดสต๊อกและออกบิลจริง
//   · ทุกแถวโผล่ให้ตรวจก่อนเสมอ แก้รุ่น/สี/ไซส์ได้ทุกแถว
//   · แถวที่ระบบไม่มั่นใจ (กำกวม/หาสีไม่เจอ/หาไซส์ไม่เจอ) ต้องแก้หรือกดข้ามก่อนถึงจะลงได้
//   · บรรทัด/ใบที่อ่านไม่ออกต้องนับให้เห็น ไม่ทิ้งเงียบ
//   · จำการจับคู่ที่คนแก้ไว้ต่อลูกค้า ครั้งหน้าไม่ต้องแก้ซ้ำ
import React from "react";
import * as XLSX from "xlsx";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase";
import { T } from "../theme";
import { Modal, MHead, BtnPrimary, BtnGhost } from "./ui";
import {
  buildCatalogIndex, matchRow, collapseRows, toCountEntries, fingerprintOf,
  parsePaste, rowsFromSheet, guessPackField, PACK_FIELDS, PACK_FIELD_LABELS, looseKey, displayText,
} from "../utils/packImport";
import { readLabelPdf, isPdf } from "../utils/pdfLabels";

const STATUS_STYLE = {
  "พร้อมลง":      { bg: "rgba(16,185,129,0.10)", color: "#047857", icon: "✅" },
  "ให้ยืนยัน":    { bg: "rgba(245,158,11,0.10)", color: "#b45309", icon: "🟡" },
  "กำกวม":       { bg: "rgba(245,158,11,0.14)", color: "#b45309", icon: "🟠" },
  "ต้องเลือกสี":  { bg: "rgba(239,68,68,0.08)",  color: "#b91c1c", icon: "🔴" },
  "ต้องเลือกไซส์": { bg: "rgba(239,68,68,0.08)", color: "#b91c1c", icon: "🔴" },
  "ไม่พบ":        { bg: "rgba(239,68,68,0.08)",  color: "#b91c1c", icon: "❌" },
  "ต้องกรอกจำนวน": { bg: "rgba(239,68,68,0.10)", color: "#b91c1c", icon: "🔢" },
  "ข้าม":         { bg: "rgba(100,116,139,0.10)", color: T.sub,    icon: "⏭️" },
};
const READY = ["พร้อมลง", "ให้ยืนยัน"];
// แถวที่ระบบเติมครบแล้ว แต่ยังอยากให้คนดูก่อน — ต้องมีทางกด "ใช่ ถูกแล้ว" ได้
// เดิม "กำกวม" ไม่มีอยู่ในลิสต์ไหนเลย: ปุ่มลงถูกล็อก และปุ่มยอมรับก็ข้ามไป
// ถ้าตัวที่ระบบเลือกถูกอยู่แล้วจะไม่มีอะไรให้แก้ → กดต่อไม่ได้ ติดตาย
const NEEDS_OK = ["ให้ยืนยัน", "กำกวม"];
const MAX_QTY_PER_ROW = 200;   // 1 ออเดอร์แพลตฟอร์ม = 1 ชิ้น เกินนี้คือแมปคอลัมน์ผิด

// 🔒 ด่านจำนวน — ระบบจะไม่เดาจำนวนให้เด็ดขาด
//
// ที่ต้องมีด่านนี้เพราะเคสจริงตอนทดสอบ: เลข "1" ของสามรายการถูกอ่านต่อกันเป็น "111"
// ถ้าปล่อยผ่านจะไปตัดสต๊อกเกิน 110 ชิ้นและออกบิลเกิน โดยไม่มีใครทันเห็น
// ตัวอ่าน PDF จึงคืน qty = null เมื่อไม่ชัวร์ แล้วบังคับให้คนกรอกเองตรงนี้
// คิดสถานะจาก qty ตอนใช้งาน ไม่เก็บลง state — จะได้ไม่มีทางหลุดจากการแก้แถว
const effStatus = (r) => r.status === "ข้าม" ? "ข้าม" : (Number(r.qty) > 0 ? r.status : "ต้องกรอกจำนวน");

const inputStyle = {
  width: "100%", boxSizing: "border-box", background: T.input, border: `1px solid ${T.inputBorder}`,
  color: T.text, borderRadius: 8, padding: "8px 11px", fontFamily: "'Sarabun',sans-serif", fontSize: 13, outline: "none",
};

export default function ImportPackRunModal({ run, clothingItems = [], sizesFor, user, onCommit, onClose }) {
  const [tab, setTab] = React.useState("pdf");
  const [busy, setBusy] = React.useState("");
  const [err, setErr] = React.useState("");
  const [paste, setPaste] = React.useState("");
  const [sheet, setSheet] = React.useState(null);       // { headers, aoa, mapping }
  const [rows, setRows] = React.useState(null);         // MatchedRow[]
  const [skipped, setSkipped] = React.useState(0);
  const [mismatched, setMismatched] = React.useState(0);   // ออเดอร์ที่ยอดอ่านได้ไม่ตรงกับที่พิมพ์บนใบ
  const [source, setSource] = React.useState("");
  const [aliases, setAliases] = React.useState({});      // ของลูกค้ารายนี้ — ปล่อยผ่านอัตโนมัติ
  const [gAliases, setGAliases] = React.useState({});     // ของรายอื่น — เติมให้ แต่ต้องกดยืนยัน
  const [learn, setLearn] = React.useState({});          // { rowIdx: true|false } — ไม่มีค่า = ใช้ค่าเริ่มต้น

  // 🧠 แถวไหนควร "จำ" ไว้ใช้ครั้งหน้า
  //
  // เดิมติ๊กให้เฉพาะตอนคนแก้แถวเอง (patchRow) — แต่แถวที่ระบบเดาถูกอยู่แล้ว
  // แล้วคนแค่กดยืนยัน จะไม่ถูกจำเลย ครั้งหน้าก็ขึ้น "กำกวม" ให้ยืนยันซ้ำอีก
  // ทั้งที่การกดยืนยันนั่นแหละคือการบอกว่า "ใช่ อันนี้ถูก"
  //
  // จึงตั้งค่าเริ่มต้นเป็นติ๊กไว้ สำหรับแถวที่ต้องให้คนตัดสิน
  // แถว "พร้อมลง" ไม่ต้องจำ — มันตรงด้วยรหัสรุ่นอยู่แล้ว จำไปก็ไม่ได้อะไรเพิ่ม
  const NEEDS_DECISION = ["กำกวม", "ให้ยืนยัน"];
  const willLearn = (i, r) => learn[i] !== undefined ? learn[i] : NEEDS_DECISION.includes(r?.status);
  const [importId] = React.useState(() => `imp_${Date.now().toString(36)}`);
  const fileRef = React.useRef(null);

  const index = React.useMemo(() => buildCatalogIndex(clothingItems, sizesFor), [clothingItems, sizesFor]);

  // อ่านการจับคู่ที่จำไว้ — ของลูกค้ารายนี้ + ของกลางที่รายอื่นเคยสอน
  // อ่านครั้งเดียวตอนเปิด ไม่ subscribe (ใช้แค่ในหน้าต่างนี้)
  React.useEffect(() => {
    if (!run?.customerId) return;
    let alive = true;
    Promise.all([
      getDoc(doc(db, "packAliases", run.customerId)).catch(() => null),
      getDoc(doc(db, "packAliases", "_shared")).catch(() => null),
    ]).then(([mine, shared]) => {
      if (!alive) return;
      if (mine?.exists()) setAliases(mine.data().aliases || {});
      if (shared?.exists()) setGAliases(shared.data().aliases || {});
    }).catch(e => console.warn("[packImport] อ่านการจับคู่ที่จำไว้ไม่ได้:", e?.message || e));
    return () => { alive = false; };
  }, [run?.customerId]);

  const runMatch = (raw, skip, src) => {
    setMismatched(m => (src && src.startsWith("ใบปะหน้า")) ? m : 0);
    const collapsed = collapseRows(raw);
    setRows(collapsed.map(r => matchRow(r, index, aliases, gAliases)));
    setSkipped(skip);
    setSource(src);
  };

  // ── รับไฟล์ ────────────────────────────────────────────────
  // 📂 รับได้ทีละหลายไฟล์ — ลูกค้าส่งใบปะหน้ามาทีละไฟล์ ต้องลากรวดเดียวได้
  //    รวมทุกไฟล์เป็นชุดเดียวก่อนจับคู่ ตัวยุบรายการซ้ำจะได้ทำงานข้ามไฟล์ด้วย
  //    (ของเดิมรับแค่ไฟล์แรก ที่เหลือหายเงียบ ๆ ไม่มีอะไรบอก)
  const takeFiles = async (fileList) => {
    const all = [...(fileList || [])];
    if (!all.length) return;
    setErr("");

    const pdfs = all.filter(isPdf);
    const others = all.filter(f => !isPdf(f));

    // Excel ยังทีละไฟล์ เพราะต้องแมปคอลัมน์ทีละแผ่น
    if (!pdfs.length) {
      if (others.length > 1) setErr(`ไฟล์ Excel/CSV รับได้ทีละไฟล์ — อ่านให้เฉพาะ ${others[0].name}`);
      return takeSheet(others[0]);
    }

    // ลากไฟล์เดิมซ้ำในคราวเดียว = ยอดเบิ้ล ตัดทิ้งตั้งแต่ตรงนี้
    const seen = new Set();
    const files = pdfs.filter(f => {
      const k = `${f.name}|${f.size}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    const dupCount = pdfs.length - files.length;

    setBusy("กำลังอ่านไฟล์...");
    try {
      const rowsAll = [];
      let pages = 0, skipped = 0, mism = 0, textPieces = 0, withHeader = 0;
      const failed = [];
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const tag = files.length > 1 ? `ไฟล์ ${i + 1}/${files.length} · ` : "";
        try {
          const res = await readLabelPdf(f, (d, t) => setBusy(`${tag}กำลังอ่านใบปะหน้า ${d}/${t}...`));
          // ติดชื่อไฟล์ไปกับแถว — เวลาสงสัยแถวไหนจะได้รู้ว่ามาจากไฟล์ไหน
          res.rows.forEach(r => rowsAll.push({ ...r, srcFile: f.name }));
          pages += res.pages || 0;
          skipped += res.skipped || 0;
          mism += res.mismatched || 0;
          textPieces += res.textPieces || 0;
          withHeader += res.pagesWithHeader || 0;
        } catch (e) {
          failed.push(`${f.name} (${e?.message || e})`);
        }
      }
      if (!rowsAll.length) {
        const NL = String.fromCharCode(10);
        if (failed.length) throw new Error(`อ่านไม่ได้สักไฟล์:${NL}${failed.join(NL)}`);
        // 🔍 บอกสาเหตุตามที่วัดได้จริง ไม่เดา — คนละสาเหตุคนละทางแก้
        if (textPieces === 0) {
          throw new Error([
            "ไฟล์นี้ไม่มีข้อความให้อ่านเลย — เป็นรูปสแกน/รูปถ่ายที่บันทึกเป็น PDF", "",
            "ทางแก้: ขอไฟล์ต้นฉบับที่โหลดจากแพลตฟอร์มโดยตรง (ไม่ใช่ถ่ายรูปหน้าจอ)",
            "หรือใช้แท็บ 📋 วางข้อความ พิมพ์/วางรายการเอง",
          ].join(NL));
        }
        if (withHeader === 0) {
          throw new Error([
            `อ่านข้อความในไฟล์ได้ (${textPieces.toLocaleString("th-TH")} ชิ้น) แต่หา "ตารางสินค้า" ไม่เจอสักหน้า`, "",
            "แปลว่าใบปะหน้าแบบนี้จัดหน้าต่างจากที่ระบบเคยเจอ (คนละแพลตฟอร์ม/คนละรุ่น)", "",
            "ส่งไฟล์นี้ให้ผู้ดูแลระบบดู เพื่อเพิ่มรูปแบบใหม่ให้ระบบอ่านออก",
            "ระหว่างนี้ใช้แท็บ 📋 วางข้อความ ไปก่อนได้",
          ].join(NL));
        }
        throw new Error([
          `เจอตารางสินค้า ${withHeader} หน้า แต่อ่านรายละเอียดไม่ชัวร์สักหน้า`, "",
          "ระบบเลือกที่จะไม่เดา เพราะเดาผิดแล้วไปตัดสต๊อกและออกบิลผิดตาม",
          "ส่งไฟล์นี้ให้ผู้ดูแลระบบดู หรือใช้แท็บ 📋 วางข้อความ ไปก่อน",
        ].join(NL));
      }
      // อ่านไม่ได้บางไฟล์ต้องบอก ไม่ใช่เงียบแล้วลงยอดขาด
      const notes = [];
      if (dupCount > 0) notes.push(`ข้ามไฟล์ซ้ำ ${dupCount} ไฟล์`);
      if (failed.length) notes.push(`อ่านไม่ได้ ${failed.length} ไฟล์: ${failed.join(" · ")}`);
      setErr(notes.join(" · "));
      setMismatched(mism);
      runMatch(rowsAll, skipped, files.length > 1
        ? `ใบปะหน้า ${files.length} ไฟล์ · ${pages} ใบ`
        : `ใบปะหน้า ${files[0].name} · ${pages} ใบ`);
    } catch (e) {
      setErr(e?.message || String(e));
    } finally { setBusy(""); }
  };

  const takeSheet = async (file) => {
    if (!file) return;
    setBusy("กำลังอ่านไฟล์...");
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "", raw: false });
      if (aoa.length < 2) throw new Error("ไฟล์นี้ไม่มีข้อมูล");
      const headers = (aoa[0] || []).map(h => String(h || "").trim());
      const mapping = {};
      headers.forEach((h, i) => { mapping[i] = guessPackField(h); });
      setSheet({ headers, aoa, mapping });
      setRows(null);
      setSource(`ไฟล์ ${file.name}`);
    } catch (e) {
      setErr(e?.message || String(e));
    } finally { setBusy(""); }
  };

  const applySheetMapping = () => {
    if (!sheet) return;
    const { rows: r, skipped: s } = rowsFromSheet(sheet.aoa, sheet.mapping);
    if (!r.length) { setErr("แมปคอลัมน์แล้วยังไม่ได้ข้อมูล — ตรวจว่าเลือกคอลัมน์ 'ชื่อสินค้า' แล้วหรือยัง"); return; }
    runMatch(r, s, source);
  };

  const takePaste = () => {
    setErr("");
    const { rows: r, skipped: s } = parsePaste(paste);
    if (!r.length) { setErr("อ่านข้อความไม่ออกสักบรรทัด"); return; }
    runMatch(r, s, "ข้อความที่วาง");
  };

  // ── แก้ทีละแถว ─────────────────────────────────────────────
  const patchRow = (i, patch) => {
    // แก้เองแปลว่าตั้งใจสอน — ติ๊ก "จำ" ให้อัตโนมัติ ไม่ต้องกดเพิ่มอีกที
    setLearn(l => (l[i] === false ? l : { ...l, [i]: true }));
    setRows(rs => rs.map((r, j) => {
    if (j !== i) return r;
    const pick = { ...(r.pick || {}), ...patch };
    const entry = index.find(e => e.id === pick.clothingId);
    if (entry) {
      pick.clothingName = entry.model;
      if (patch.colorIdx != null) pick.colorName = entry.colors[patch.colorIdx]?.name || "";
      if (patch.clothingId) { pick.colorIdx = null; pick.colorName = ""; pick.size = null; }
    }
    const ok = pick.clothingId && pick.colorIdx != null && pick.size;
    return { ...r, pick, status: r.status === "ข้าม" ? "ข้าม" : (ok ? "ให้ยืนยัน" : (pick.colorIdx == null ? "ต้องเลือกสี" : "ต้องเลือกไซส์")) };
  }));
  };

  // ✏️ แก้จำนวนได้ทุกแถว — อ่านมาผิดก็แก้ตรงนี้ ไม่ต้องยกเลิกทั้งไฟล์
  //    ว่าง = ยังไม่กรอก → แถวนั้นจะล็อกไม่ให้ลงจนกว่าจะใส่
  const setQty = (i, rawVal) => setRows(rs => rs.map((r, j) => {
    if (j !== i) return r;
    const t = String(rawVal).replace(/[^0-9]/g, "").slice(0, 4);
    return { ...r, qty: t === "" ? null : parseInt(t, 10) };
  }));

  const toggleSkip = (i) => setRows(rs => rs.map((r, j) => j === i ? { ...r, status: r.status === "ข้าม" ? (r.pick ? "ให้ยืนยัน" : "ไม่พบ") : "ข้าม" } : r));

  // มุมมองที่คิดสถานะจริงแล้ว — ทุกอย่างที่ตัดสินใจต้องอ่านจากตัวนี้ ไม่ใช่ rows ดิบ
  const view = React.useMemo(() => (rows || []).map(r => ({ ...r, status: effStatus(r) })), [rows]);
  const entries = React.useMemo(() => toCountEntries(view.filter(r => r.status !== "ข้าม")), [view]);
  const blocked = React.useMemo(() => view.filter(r => r.status !== "ข้าม" && !READY.includes(r.status)), [view]);
  const needQty = React.useMemo(() => view.filter(r => r.status === "ต้องกรอกจำนวน").length, [view]);
  const totalQty = entries.reduce((s, e) => s + e.qty, 0);
  const overQty = view.some(r => r.status !== "ข้าม" && Number(r.qty) > MAX_QTY_PER_ROW);
  const dupFingerprint = React.useMemo(() => {
    const fp = fingerprintOf(entries);
    return Object.values(run?.imports || {}).some(x => x && x.fp === fp) ? fp : "";
  }, [entries, run]);

  // แถวที่ระบบเติมครบแล้วรอแค่คนพยักหน้า — กดทีเดียวจบ ไม่ต้องไล่ทีละแถว
  //   ช่วยมากตอนของกลางเติมมาให้ (ลูกค้าเจ้าที่ 2-10 ที่ขายสินค้าตัวเดียวกัน)
  const confirmable = React.useMemo(
    () => view.filter(r => NEEDS_OK.includes(r.status) && r.pick?.clothingId && r.pick?.colorIdx != null && r.pick?.size).length,
    [view]
  );
  const acceptAllSuggested = () => setRows(rs => rs.map(r =>
    (NEEDS_OK.includes(r.status) && r.pick?.clothingId && r.pick?.colorIdx != null && r.pick?.size)
      ? { ...r, status: "พร้อมลง" } : r));

  // ยอมรับทีละแถว — บางทีถูกแค่บางแถว ไม่อยากกดยอมรับยกชุด
  const acceptRow = (i) => setRows(rs => rs.map((r, j) => (j === i && NEEDS_OK.includes(r.status)
    && r.pick?.clothingId && r.pick?.colorIdx != null && r.pick?.size) ? { ...r, status: "พร้อมลง" } : r));

  const commit = async () => {
    if (!entries.length || blocked.length) return;
    if (run.status === "ปิดแล้ว") { setErr("รอบนี้ถูกปิดไปแล้ว (อาจมีคนปิดจากอีกเครื่องระหว่างที่กำลังตรวจ)"); return; }
    if (dupFingerprint && !window.confirm("⚠️ ชุดนี้ยอดเหมือนที่เคยลงในรอบนี้แล้ว\n\nวางซ้ำหรือลากไฟล์เดิมซ้ำหรือเปล่า?\nลงต่อจะกลายเป็นยอดซ้อน")) return;
    if (!window.confirm(`ลง ${entries.length} รายการ รวม ${totalQty.toLocaleString("th-TH")} ชิ้น เข้ารอบ ${run.runNo}?`)) return;
    setBusy("กำลังลงรายการ...");
    try {
      // 🧠 คิดการจับคู่ที่จะจำ "ก่อน" เขียนยอด — ต้องเอาไปบันทึกไว้ในบัญชีนำเข้าด้วย
      //    เผื่อวันหลังถอนชุดนี้เพราะจับคู่ผิด จะได้ตามไปลืมได้ถูกตัว
      //    (ไม่มีบันทึกนี้ = ถอนยอดได้ แต่ของที่สอนผิดยังอยู่ แล้วผิดเงียบ ๆ ต่อไปทุกรอบ)
      const next = { ...aliases };
      const touched = [];
      // คำอธิบายที่คนอ่านออกของแต่ละกุญแจ — กุญแจจริงถูกตัดวรรณยุกต์/ช่องว่างทิ้งจนอ่านไม่รู้เรื่อง
      // ถ้าไม่เก็บไว้ ตอนถอนจะบอกได้แค่ "สอนไว้ 12 รายการ" ซึ่งตัดสินใจอะไรไม่ได้เลย
      const labelOf = {};
      view.forEach((r, i) => {
        if (!willLearn(i, r) || !r.pick || r.status === "ข้าม") return;
        const kp = `p:${looseKey(r.productText)}`;
        next[kp] = { clothingId: r.pick.clothingId, text: r.productText || "", by: user?.name || "", at: new Date().toISOString() };
        touched.push(kp);
        labelOf[kp] = `${displayText(r.productText)} → ${r.pick.clothingName || ""}`;
        if (r.pick.colorIdx != null) {
          // กุญแจต้องเป็นตัวเดียวกับตอนอ่านใน matchRow — ลายเซ็นของแถว ไม่ใช่ชื่อสีที่แปลได้
          const kc = `pc:${looseKey(r.productText)}##${looseKey(r.optionText || "")}`;
          next[kc] = { clothingId: r.pick.clothingId, colorIdx: r.pick.colorIdx, colorName: r.pick.colorName,
            text: r.productText || "", optionText: r.optionText || "", by: user?.name || "", at: new Date().toISOString() };
          touched.push(kc);
          labelOf[kc] = `${displayText(r.productText)} ${displayText(r.optionText || "")} → ${r.pick.clothingName || ""} · ${r.pick.colorName || ""}`;
        }
      });

      // นับเฉพาะตัวที่ "ชุดนี้ทำให้เปลี่ยนจริง" — ของเดิมที่สอนไว้ก่อนแล้วไม่ใช่ผลงานของชุดนี้
      // ถ้าเหมาไปลืมด้วยจะไปลบของที่สอนถูกไว้นานแล้ว
      const differs = (a, b) => !a || a.clothingId !== b.clothingId || (a.colorIdx ?? null) !== (b.colorIdx ?? null);
      const aliasKeys = [...new Set(touched)].filter(k => differs(aliases[k], next[k]));
      // ของกลาง: ลืมได้เฉพาะตัวที่ "ชุดนี้เป็นคนใส่เข้าไปใหม่"
      // ตัวที่มีอยู่ก่อนแล้วเป็นของลูกค้ารายอื่นสอนไว้ ห้ามไปลบของเขา
      const sharedKeys = aliasKeys.filter(k => !gAliases[k]);

      await onCommit(run, entries, {
        importId, source, rows: rows.length, qty: totalQty, fp: fingerprintOf(entries),
        aliasKeys, sharedKeys,
        // เก็บคู่ กุญแจ+คำอธิบาย ไว้เป็นอาร์เรย์ (ไม่ใช้ map เพราะกุญแจมีจุดได้)
        aliasLog: aliasKeys.map(k => ({ k, label: (labelOf[k] || "").slice(0, 120) })),
      });

      if (aliasKeys.length) {
        // เขียน 2 ที่: ของลูกค้ารายนี้ (ใช้อัตโนมัติครั้งหน้า) และของกลาง (ให้รายอื่นได้ใช้เป็นตัวเติม)
        // ลูกค้าทุกเจ้าขายของจากคลังเดียวกัน สอนครั้งเดียวจึงควรช่วยทุกเจ้า
        const learned = {};
        sharedKeys.forEach(k => { learned[k] = next[k]; });
        await Promise.all([
          setDoc(doc(db, "packAliases", run.customerId),
            { customerName: run.customerName || "", aliases: next, updatedAt: serverTimestamp() }, { merge: true }),
          ...(Object.keys(learned).length ? [setDoc(doc(db, "packAliases", "_shared"),
            { aliases: learned, updatedAt: serverTimestamp() }, { merge: true })] : []),
        ]).catch(e => console.warn("[packImport] จำการจับคู่ไม่สำเร็จ:", e?.message || e));
      }
      onClose();
    } catch (e) {
      setErr("ลงรายการไม่สำเร็จ: " + (e?.message || e));
      setBusy("");
    }
  };

  // แถวหนึ่งอาจมาจากหลายใบ (ยุบรวมของเหมือนกันแล้ว) — บอกให้ครบจะได้ตามไปดูใบจริงถูก
  const pagesOf = (r) => [...new Set((r.sources || [r]).map(x => x.page).filter(Boolean))];
  const filesOf = (r) => [...new Set((r.sources || [r]).map(x => x.srcFile).filter(Boolean))];
  const pageLabel = (r) => {
    const ps = pagesOf(r);
    if (!ps.length) return "";
    return ps.length === 1 ? `ใบ ${ps[0]}` : `${ps.length} ใบ`;
  };
  const pageTitle = (r) => {
    const ps = pagesOf(r);
    const fs = filesOf(r);
    if (!ps.length) return fs.length ? `มาจากไฟล์ ${fs.join(", ")}` : "";
    return `มาจากใบที่ ${ps.join(", ")}` + (fs.length ? `${String.fromCharCode(10)}ไฟล์: ${fs.join(", ")}` : "");
  };

  const Tab = ({ id, children }) => (
    <button onClick={() => { setTab(id); setErr(""); }}
      style={{ padding: "8px 16px", borderRadius: 9, cursor: "pointer", fontSize: 13, fontFamily: "'Sarabun',sans-serif",
        fontWeight: tab === id ? 700 : 400,
        border: tab === id ? `2px solid ${T.accent}` : `1px solid ${T.border}`,
        background: tab === id ? "rgba(59,91,139,0.1)" : "white", color: tab === id ? T.accent : T.sub }}>
      {children}
    </button>
  );

  return (
    <Modal onClose={onClose} w={1000}>
      <MHead title="📥 นำเข้ารายการเข้ารอบแพ็ค" sub={`${run?.runNo || ""} · ${run?.customerName || ""}`} onClose={onClose} color={T.accent}/>

      {!rows && !sheet && (
        <>
          <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
            <Tab id="pdf">📄 ใบปะหน้า PDF</Tab>
            <Tab id="paste">📋 วางข้อความ</Tab>
            <Tab id="file">📂 ไฟล์ Excel/CSV</Tab>
          </div>

          {tab !== "paste" ? (
            <div onClick={() => fileRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); takeFiles(e.dataTransfer.files); }}
              style={{ border: `2px dashed ${T.accent}66`, borderRadius: 12, padding: "38px 20px", textAlign: "center", cursor: "pointer", background: "rgba(59,91,139,0.04)" }}>
              <div style={{ fontSize: 34, marginBottom: 8 }}>{tab === "pdf" ? "📄" : "📂"}</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>
                {tab === "pdf" ? "ลากไฟล์ใบปะหน้า PDF มาวางที่นี่ — ลากทีเดียวหลายไฟล์ได้" : "ลากไฟล์ Excel/CSV มาวางที่นี่"}
              </div>
              <div style={{ fontSize: 12, color: T.muted, marginTop: 6, lineHeight: 1.7 }}>
                {tab === "pdf"
                  ? "ไฟล์เดียวกับที่ลูกค้าส่งมาให้แปะ — ลูกค้าส่งมาทีละไฟล์ก็เลือกทีเดียวได้ทั้งหมด ระบบรวมให้เอง"
                  : "รองรับไฟล์ที่ export จาก Seller Center"}
                <br/>หรือกดเพื่อเลือกไฟล์
              </div>
              <input ref={fileRef} type="file" multiple={tab === "pdf"} accept={tab === "pdf" ? ".pdf" : ".xlsx,.xls,.csv"} style={{ display: "none" }}
                onChange={e => { takeFiles(e.target.files); if (e.target) e.target.value = ""; }}/>
            </div>
          ) : (
            <>
              <textarea autoFocus value={paste} onChange={e => setPaste(e.target.value)} rows={9}
                placeholder={"วางข้อความจากแชทได้เลย บรรทัดละ 1 รายการ เช่น\nK-12 แขนยาว สีแดง 2XL x3\nCPU125 แขนกุด, ม่วง, M, 2"}
                style={{ ...inputStyle, fontFamily: "monospace", fontSize: 13, lineHeight: 1.6, resize: "vertical" }}/>
              <BtnPrimary onClick={takePaste} disabled={!paste.trim()} style={{ marginTop: 10, opacity: paste.trim() ? 1 : 0.45 }}>
                ตรวจข้อความ
              </BtnPrimary>
            </>
          )}
        </>
      )}

      {/* แมปคอลัมน์ (เฉพาะ Excel) */}
      {sheet && !rows && (
        <div>
          <div style={{ fontSize: 12, color: T.sub, marginBottom: 10 }}>เลือกว่าคอลัมน์ไหนคืออะไร — ระบบเดาให้แล้ว ตรวจอีกที</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: 8, marginBottom: 12 }}>
            {sheet.headers.map((h, i) => (
              <div key={i}>
                <div style={{ fontSize: 11, color: T.muted, marginBottom: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h || `คอลัมน์ ${i + 1}`}</div>
                <select value={sheet.mapping[i]} onChange={e => setSheet(s => ({ ...s, mapping: { ...s.mapping, [i]: e.target.value } }))}
                  style={{ ...inputStyle, padding: "6px 8px", fontSize: 12 }}>
                  {PACK_FIELDS.map(f => <option key={f} value={f}>{PACK_FIELD_LABELS[f]}</option>)}
                </select>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <BtnGhost onClick={() => { setSheet(null); setSource(""); }}>ย้อนกลับ</BtnGhost>
            <BtnPrimary onClick={applySheetMapping}>ตรวจข้อมูล</BtnPrimary>
          </div>
        </div>
      )}

      {busy && <div style={{ marginTop: 12, fontSize: 13, color: T.accent, fontWeight: 600 }}>{busy}</div>}
      {err && <div style={{ marginTop: 12, padding: 10, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, fontSize: 12, color: T.red }}>{err}</div>}

      {/* ── ตารางตรวจ ── */}
      {rows && (
        <div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "10px 12px", background: "rgba(59,91,139,0.06)", border: "1px solid rgba(59,91,139,0.2)", borderRadius: 10, marginBottom: 10 }}>
            <div style={{ fontSize: 12, color: T.sub }}>
              {source} · ยุบเหลือ <b>{rows.length}</b> แบบ
              {skipped > 0 && <span style={{ color: T.amber }}> · อ่านไม่ออก {skipped}</span>}
            </div>
            <div style={{ marginLeft: "auto", textAlign: "right" }}>
              <div style={{ fontSize: 22, fontWeight: 800, fontFamily: "monospace", color: blocked.length ? T.amber : T.green, lineHeight: 1 }}>
                {totalQty.toLocaleString("th-TH")}
              </div>
              <div style={{ fontSize: 11, color: T.muted }}>ชิ้นที่จะลง</div>
            </div>
          </div>

          {needQty > 0 && (
            <div style={{ padding: "8px 12px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 9, fontSize: 12, color: T.red, marginBottom: 10 }}>
              🔢 มี <b>{needQty}</b> แถวที่อ่านจำนวนไม่ชัวร์ — <b>กรอกจำนวนเองในช่องสีแดง</b> ก่อนถึงจะลงได้
              <div style={{ fontSize: 11, marginTop: 3, color: "#92400e" }}>
                ระบบไม่เดาจำนวนให้ เพราะเดาผิดครั้งเดียวจะไปตัดสต๊อกและออกบิลเกินโดยไม่มีใครเห็น
                {mismatched > 0 && <> · มี <b>{mismatched}</b> ออเดอร์ที่ยอดอ่านได้ไม่ตรงกับ &quot;Total&quot; ที่พิมพ์บนใบ</>}
              </div>
            </div>
          )}
          {skipped > 0 && (
            <div style={{ padding: "8px 12px", background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.35)", borderRadius: 9, fontSize: 12, color: "#92400e", marginBottom: 10 }}>
              📄 มี <b>{skipped}</b> ใบที่ไม่มีตารางสินค้าให้อ่าน — ถ้าเป็นใบเปล่า/หน้าท้ายก็ไม่ต้องทำอะไร
              <div style={{ fontSize: 11, marginTop: 3 }}>
                แต่ถ้าเป็นใบที่มีของจริง ต้องแยกออกมานับเองในหน้ารอบแพ็ค — ระบบเลือกที่จะไม่เดา
              </div>
            </div>
          )}
          {blocked.length > 0 && (
            <div style={{ padding: "8px 12px", background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.35)", borderRadius: 9, fontSize: 12, color: "#92400e", marginBottom: 10 }}>
              ยังลงไม่ได้ — มี <b>{blocked.length}</b> แถวที่ต้องให้คนตัดสินก่อน · ถ้าที่ระบบเลือกไว้ถูกแล้ว กด <b>✓ ถูกแล้ว</b> ท้ายแถว (หรือ <b>ยอมรับที่เดาไว้ทั้งหมด</b> ด้านล่าง) · ไม่เอาแถวไหนกด ⏭️ ข้าม
            </div>
          )}
          {overQty && (
            <div style={{ padding: "8px 12px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 9, fontSize: 12, color: T.red, marginBottom: 10 }}>
              ⚠️ มีแถวที่จำนวนเกิน {MAX_QTY_PER_ROW} ชิ้น — ปกติ 1 ออเดอร์บนแพลตฟอร์ม = 1 ชิ้น ตรวจว่าแมปคอลัมน์ "จำนวน" ถูกไหม
            </div>
          )}

          <div style={{ maxHeight: "44vh", overflowY: "auto", border: `1px solid ${T.border}`, borderRadius: 10 }}>
            {view.map((r, i) => {
              const st = STATUS_STYLE[r.status] || STATUS_STYLE["ไม่พบ"];
              const entry = r.pick ? index.find(e => e.id === r.pick.clothingId) : null;
              return (
                <div key={i} style={{ padding: "9px 12px", borderBottom: `1px solid ${T.border}`, background: st.bg, opacity: r.status === "ข้าม" ? 0.5 : 1 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: st.color, whiteSpace: "nowrap" }}>{st.icon} {r.status}</span>
                    {/* 🔖 มาจากใบไหน — ให้ตรวจย้อนกับใบจริงได้เวลาเจอแถวที่ไม่น่าจะมี */}
                    {pageLabel(r) && (
                      <span title={pageTitle(r)}
                        style={{ fontSize: 10, color: T.sub, background: "rgba(100,116,139,0.12)", borderRadius: 6, padding: "1px 6px", whiteSpace: "nowrap" }}>
                        {pageLabel(r)}
                      </span>
                    )}
                    {/* ⚠️ ห้ามตัดท้ายทิ้ง — ไซส์อยู่ท้ายสุดของข้อความเสมอ ("...,EUR: 38 (25 CM.)")
                        เดิมตั้ง nowrap+ellipsis ชื่อสินค้ายาว ๆ เลยกินที่จนไซส์ถูกตัดหาย
                        คนตรวจอ่านไม่เห็นไซส์ = ตรวจไม่ได้จริง · ให้ตัดบรรทัดได้ จำกัดไว้ 2 บรรทัด */}
                    <span style={{ fontSize: 12, color: T.text, flex: 1, minWidth: 180, overflow: "hidden",
                      display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
                      whiteSpace: "normal", wordBreak: "break-word", lineHeight: 1.45 }} title={r.raw || r.productText}>
                      {displayText(r.productText)}{r.optionText ? ` ${displayText(r.optionText)}` : ""}
                    </span>
                    <span style={{ fontSize: 12, color: T.muted }}>×</span>
                    <input value={r.qty ?? ""} onChange={e => setQty(i, e.target.value)} inputMode="numeric"
                      placeholder="?" title={r.qtyWhy || (r.page ? `จากใบที่ ${r.page}` : "จำนวนชิ้น")}
                      style={{ width: 46, textAlign: "center", fontFamily: "monospace", fontWeight: 700, fontSize: 13,
                        padding: "3px 4px", borderRadius: 7, outline: "none", boxSizing: "border-box",
                        border: `1px solid ${r.qty == null ? T.red : T.inputBorder}`,
                        background: r.qty == null ? "#fff1f2" : T.input, color: T.text }}/>
                    {NEEDS_OK.includes(r.status) && r.pick?.clothingId && r.pick?.colorIdx != null && r.pick?.size && (
                      <button onClick={() => acceptRow(i)} title="ใช่ ที่เลือกไว้ถูกแล้ว"
                        style={{ border: "1px solid rgba(16,185,129,0.45)", background: "rgba(16,185,129,0.12)", color: "#047857", cursor: "pointer", fontSize: 11, fontWeight: 700, padding: "2px 9px", borderRadius: 7, fontFamily: "inherit" }}>
                        ✓ ถูกแล้ว
                      </button>
                    )}
                    <button onClick={() => toggleSkip(i)} title={r.status === "ข้าม" ? "เอากลับมาลง" : "ข้ามแถวนี้"}
                      style={{ border: "none", background: "none", cursor: "pointer", fontSize: 13, padding: 0 }}>
                      {r.status === "ข้าม" ? "↩️" : "⏭️"}
                    </button>
                  </div>
                  {r.status !== "ข้าม" && (
                    <div style={{ display: "grid", gridTemplateColumns: "2fr 1.2fr 0.9fr auto", gap: 6, alignItems: "center" }}>
                      <select value={r.pick?.clothingId || ""} onChange={e => patchRow(i, { clothingId: e.target.value })}
                        style={{ ...inputStyle, padding: "5px 7px", fontSize: 12 }}>
                        <option value="">— เลือกรุ่น —</option>
                        {(r.candidates || []).map(c => <option key={c.clothingId} value={c.clothingId}>⭐ {c.clothingName}</option>)}
                        {index.filter(e => !(r.candidates || []).some(c => c.clothingId === e.id))
                              .map(e => <option key={e.id} value={e.id}>{e.model}</option>)}
                      </select>
                      <select value={r.pick?.colorIdx ?? ""} onChange={e => patchRow(i, { colorIdx: e.target.value === "" ? null : Number(e.target.value) })}
                        disabled={!entry} style={{ ...inputStyle, padding: "5px 7px", fontSize: 12 }}>
                        <option value="">— เลือกสี —</option>
                        {(entry?.colors || []).map(c => <option key={c.idx} value={c.idx}>{c.name}</option>)}
                      </select>
                      <select value={r.pick?.size || ""} onChange={e => patchRow(i, { size: e.target.value || null })}
                        disabled={!entry} style={{ ...inputStyle, padding: "5px 7px", fontSize: 12 }}>
                        <option value="">— ไซส์ —</option>
                        {(entry?.sizes || []).map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                      <label title="จำไว้ ครั้งหน้าลูกค้ารายนี้เขียนแบบนี้จะจับคู่ให้เอง"
                        style={{ fontSize: 10, color: T.sub, display: "flex", alignItems: "center", gap: 3, whiteSpace: "nowrap", cursor: "pointer" }}>
                        <input type="checkbox" checked={willLearn(i, r)} onChange={e => setLearn(l => ({ ...l, [i]: e.target.checked }))}/>
                        จำ
                      </label>
                    </div>
                  )}
                  {r.pick?.why?.length > 0 && r.status !== "ข้าม" && (
                    <div style={{ fontSize: 10, color: T.muted, marginTop: 3 }}>{r.pick.why.join(" · ")}</div>
                  )}
                </div>
              );
            })}
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
            <BtnGhost onClick={() => { setRows(null); setSheet(null); setPaste(""); setSource(""); setLearn({}); setSkipped(0); setMismatched(0); }}>เริ่มใหม่</BtnGhost>
            {confirmable > 0 && (
              <BtnGhost onClick={acceptAllSuggested} title="แถวที่ระบบเติมรุ่น/สี/ไซส์ครบแล้ว กดยอมรับทีเดียว">
                ✅ ยอมรับที่เดาไว้ทั้งหมด ({confirmable})
              </BtnGhost>
            )}
            <BtnPrimary onClick={commit} disabled={!!busy || !entries.length || blocked.length > 0}
              style={{ flex: 1, opacity: (!!busy || !entries.length || blocked.length > 0) ? 0.45 : 1 }}>
              {busy || `✅ ลง ${entries.length} รายการ (${totalQty.toLocaleString("th-TH")} ชิ้น) เข้ารอบ`}
            </BtnPrimary>
          </div>
          <div style={{ fontSize: 10, color: T.muted, marginTop: 8, lineHeight: 1.6 }}>
            ยังไม่ตัดสต๊อกตอนนี้ — ตัดตอนปิดรอบเหมือนเดิม · ลงผิดกดถอนได้ที่ประวัติการนำเข้าในหน้ารอบแพ็ค
            {(() => {
              const n = view.filter((r, i) => willLearn(i, r) && r.pick && r.status !== "ข้าม").length;
              if (!n) return null;
              return (
                <div style={{ marginTop: 3, color: "#047857" }}>
                  🧠 จะจำการจับคู่ {n} แถว — ครั้งหน้าไม่ต้องยืนยันซ้ำ · ไม่อยากให้จำแถวไหน ติ๊ก “จำ” ท้ายแถวนั้นออก
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </Modal>
  );
}
