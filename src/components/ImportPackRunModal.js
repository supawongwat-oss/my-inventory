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
  "ข้าม":         { bg: "rgba(100,116,139,0.10)", color: T.sub,    icon: "⏭️" },
};
const READY = ["พร้อมลง", "ให้ยืนยัน"];
const MAX_QTY_PER_ROW = 200;   // 1 ออเดอร์แพลตฟอร์ม = 1 ชิ้น เกินนี้คือแมปคอลัมน์ผิด

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
  const [source, setSource] = React.useState("");
  const [aliases, setAliases] = React.useState({});      // ของลูกค้ารายนี้ — ปล่อยผ่านอัตโนมัติ
  const [gAliases, setGAliases] = React.useState({});     // ของรายอื่น — เติมให้ แต่ต้องกดยืนยัน
  const [learn, setLearn] = React.useState({});          // { rowIdx: true }
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
    const collapsed = collapseRows(raw);
    setRows(collapsed.map(r => matchRow(r, index, aliases, gAliases)));
    setSkipped(skip);
    setSource(src);
  };

  // ── รับไฟล์ ────────────────────────────────────────────────
  const takeFile = async (file) => {
    if (!file) return;
    setErr(""); setBusy("กำลังอ่านไฟล์...");
    try {
      if (isPdf(file)) {
        const res = await readLabelPdf(file, (d, t) => setBusy(`กำลังอ่านใบปะหน้า ${d}/${t}...`));
        if (!res.rows.length) throw new Error("อ่านใบปะหน้าไม่ออกสักใบ — ไฟล์อาจเป็นรูปสแกน ไม่ใช่ข้อความ");
        runMatch(res.rows, res.skipped, `ใบปะหน้า ${file.name} · ${res.pages} ใบ`);
      } else {
        const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
        const aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "", raw: false });
        if (aoa.length < 2) throw new Error("ไฟล์นี้ไม่มีข้อมูล");
        const headers = (aoa[0] || []).map(h => String(h || "").trim());
        const mapping = {};
        headers.forEach((h, i) => { mapping[i] = guessPackField(h); });
        setSheet({ headers, aoa, mapping });
        setRows(null);
        setSource(`ไฟล์ ${file.name}`);
      }
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

  const toggleSkip = (i) => setRows(rs => rs.map((r, j) => j === i ? { ...r, status: r.status === "ข้าม" ? (r.pick ? "ให้ยืนยัน" : "ไม่พบ") : "ข้าม" } : r));

  const entries = React.useMemo(() => (rows ? toCountEntries(rows.filter(r => r.status !== "ข้าม")) : []), [rows]);
  const blocked = React.useMemo(() => (rows || []).filter(r => r.status !== "ข้าม" && !READY.includes(r.status)), [rows]);
  const totalQty = entries.reduce((s, e) => s + e.qty, 0);
  const overQty = (rows || []).some(r => r.status !== "ข้าม" && Number(r.qty) > MAX_QTY_PER_ROW);
  const dupFingerprint = React.useMemo(() => {
    const fp = fingerprintOf(entries);
    return Object.values(run?.imports || {}).some(x => x && x.fp === fp) ? fp : "";
  }, [entries, run]);

  // แถวที่ระบบเติมครบแล้วรอแค่คนพยักหน้า — กดทีเดียวจบ ไม่ต้องไล่ทีละแถว
  //   ช่วยมากตอนของกลางเติมมาให้ (ลูกค้าเจ้าที่ 2-10 ที่ขายสินค้าตัวเดียวกัน)
  const confirmable = React.useMemo(
    () => (rows || []).filter(r => r.status === "ให้ยืนยัน" && r.pick?.clothingId && r.pick?.colorIdx != null && r.pick?.size).length,
    [rows]
  );
  const acceptAllSuggested = () => setRows(rs => rs.map(r =>
    (r.status === "ให้ยืนยัน" && r.pick?.clothingId && r.pick?.colorIdx != null && r.pick?.size)
      ? { ...r, status: "พร้อมลง" } : r));

  const commit = async () => {
    if (!entries.length || blocked.length) return;
    if (run.status === "ปิดแล้ว") { setErr("รอบนี้ถูกปิดไปแล้ว (อาจมีคนปิดจากอีกเครื่องระหว่างที่กำลังตรวจ)"); return; }
    if (dupFingerprint && !window.confirm("⚠️ ชุดนี้ยอดเหมือนที่เคยลงในรอบนี้แล้ว\n\nวางซ้ำหรือลากไฟล์เดิมซ้ำหรือเปล่า?\nลงต่อจะกลายเป็นยอดซ้อน")) return;
    if (!window.confirm(`ลง ${entries.length} รายการ รวม ${totalQty.toLocaleString("th-TH")} ชิ้น เข้ารอบ ${run.runNo}?`)) return;
    setBusy("กำลังลงรายการ...");
    try {
      await onCommit(run, entries, { importId, source, rows: rows.length, qty: totalQty, fp: fingerprintOf(entries) });
      // จำการจับคู่ที่คนแก้ไว้ — แยกชั้นรุ่นกับสี ครั้งหน้าแก้ 1 ครั้งได้ทุกสีใต้ชื่อนั้น
      const next = { ...aliases };
      rows.forEach((r, i) => {
        if (!learn[i] || !r.pick || r.status === "ข้าม") return;
        next[`p:${looseKey(r.productText)}`] = { clothingId: r.pick.clothingId, text: r.productText || "", by: user?.name || "", at: new Date().toISOString() };
        if (r.pick.colorIdx != null) {
          // กุญแจต้องเป็นตัวเดียวกับตอนอ่านใน matchRow — ลายเซ็นของแถว ไม่ใช่ชื่อสีที่แปลได้
          next[`pc:${looseKey(r.productText)}##${looseKey(r.optionText || "")}`] =
            { clothingId: r.pick.clothingId, colorIdx: r.pick.colorIdx, colorName: r.pick.colorName,
              text: r.productText || "", optionText: r.optionText || "", by: user?.name || "", at: new Date().toISOString() };
        }
      });
      if (Object.keys(next).length !== Object.keys(aliases).length) {
        // เขียน 2 ที่: ของลูกค้ารายนี้ (ใช้อัตโนมัติครั้งหน้า) และของกลาง (ให้รายอื่นได้ใช้เป็นตัวเติม)
        // ลูกค้าทุกเจ้าขายของจากคลังเดียวกัน สอนครั้งเดียวจึงควรช่วยทุกเจ้า
        const learned = {};
        Object.keys(next).forEach(k => { if (!aliases[k]) learned[k] = next[k]; });
        await Promise.all([
          setDoc(doc(db, "packAliases", run.customerId),
            { customerName: run.customerName || "", aliases: next, updatedAt: serverTimestamp() }, { merge: true }),
          setDoc(doc(db, "packAliases", "_shared"),
            { aliases: learned, updatedAt: serverTimestamp() }, { merge: true }),
        ]).catch(e => console.warn("[packImport] จำการจับคู่ไม่สำเร็จ:", e?.message || e));
      }
      onClose();
    } catch (e) {
      setErr("ลงรายการไม่สำเร็จ: " + (e?.message || e));
      setBusy("");
    }
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
              onDrop={e => { e.preventDefault(); takeFile(e.dataTransfer.files?.[0]); }}
              style={{ border: `2px dashed ${T.accent}66`, borderRadius: 12, padding: "38px 20px", textAlign: "center", cursor: "pointer", background: "rgba(59,91,139,0.04)" }}>
              <div style={{ fontSize: 34, marginBottom: 8 }}>{tab === "pdf" ? "📄" : "📂"}</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>
                {tab === "pdf" ? "ลากไฟล์ใบปะหน้า PDF มาวางที่นี่" : "ลากไฟล์ Excel/CSV มาวางที่นี่"}
              </div>
              <div style={{ fontSize: 12, color: T.muted, marginTop: 6, lineHeight: 1.7 }}>
                {tab === "pdf"
                  ? "ไฟล์เดียวกับที่ลูกค้าส่งมาให้แปะ — ไม่ต้องขออะไรเพิ่ม ระบบอ่านชื่อสินค้า สี ไซส์ ให้เอง"
                  : "รองรับไฟล์ที่ export จาก Seller Center"}
                <br/>หรือกดเพื่อเลือกไฟล์
              </div>
              <input ref={fileRef} type="file" accept={tab === "pdf" ? ".pdf" : ".xlsx,.xls,.csv"} style={{ display: "none" }}
                onChange={e => { takeFile(e.target.files?.[0]); if (e.target) e.target.value = ""; }}/>
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
              {skipped > 0 && <span style={{ color: T.amber }}> · อ่านไม่ออก/ข้ามอัตโนมัติ {skipped}</span>}
            </div>
            <div style={{ marginLeft: "auto", textAlign: "right" }}>
              <div style={{ fontSize: 22, fontWeight: 800, fontFamily: "monospace", color: blocked.length ? T.amber : T.green, lineHeight: 1 }}>
                {totalQty.toLocaleString("th-TH")}
              </div>
              <div style={{ fontSize: 11, color: T.muted }}>ชิ้นที่จะลง</div>
            </div>
          </div>

          {blocked.length > 0 && (
            <div style={{ padding: "8px 12px", background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.35)", borderRadius: 9, fontSize: 12, color: "#92400e", marginBottom: 10 }}>
              ยังลงไม่ได้ — มี <b>{blocked.length}</b> แถวที่ต้องเลือกให้ชัดก่อน (หรือกด ⏭️ ข้ามแถวนั้น)
            </div>
          )}
          {overQty && (
            <div style={{ padding: "8px 12px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 9, fontSize: 12, color: T.red, marginBottom: 10 }}>
              ⚠️ มีแถวที่จำนวนเกิน {MAX_QTY_PER_ROW} ชิ้น — ปกติ 1 ออเดอร์บนแพลตฟอร์ม = 1 ชิ้น ตรวจว่าแมปคอลัมน์ "จำนวน" ถูกไหม
            </div>
          )}

          <div style={{ maxHeight: "44vh", overflowY: "auto", border: `1px solid ${T.border}`, borderRadius: 10 }}>
            {rows.map((r, i) => {
              const st = STATUS_STYLE[r.status] || STATUS_STYLE["ไม่พบ"];
              const entry = r.pick ? index.find(e => e.id === r.pick.clothingId) : null;
              return (
                <div key={i} style={{ padding: "9px 12px", borderBottom: `1px solid ${T.border}`, background: st.bg, opacity: r.status === "ข้าม" ? 0.5 : 1 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: st.color, whiteSpace: "nowrap" }}>{st.icon} {r.status}</span>
                    <span style={{ fontSize: 12, color: T.text, flex: 1, minWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.raw || r.productText}>
                      {displayText(r.productText)}{r.optionText ? ` ${displayText(r.optionText)}` : ""}
                    </span>
                    <span style={{ fontSize: 12, fontFamily: "monospace", fontWeight: 700, color: T.text }}>×{r.qty}</span>
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
                        <input type="checkbox" checked={!!learn[i]} onChange={e => setLearn(l => ({ ...l, [i]: e.target.checked }))}/>
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
            <BtnGhost onClick={() => { setRows(null); setSheet(null); setPaste(""); setSource(""); setLearn({}); }}>เริ่มใหม่</BtnGhost>
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
          </div>
        </div>
      )}
    </Modal>
  );
}
