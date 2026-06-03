import { useState, useRef } from "react";
import * as XLSX from "xlsx";
import { db } from "../firebase";
import { collection, writeBatch, doc, serverTimestamp } from "firebase/firestore";
import { T } from "../theme";
import { Modal, MHead, BtnPrimary, BtnGhost } from "./ui";

// ── helpers ────────────────────────────────────────────────
// คำหลักภาษาไทย/อังกฤษที่ใช้ guess column → field
const FIELD_HINTS = {
  name:    ["ชื่อ", "name", "customer", "ลูกค้า"],
  phone:   ["เบอร์", "โทร", "phone", "tel", "mobile"],
  address: ["ที่อยู่", "address", "addr"],
  email:   ["email", "e-mail", "อีเมล"],
  taxId:   ["เลขผู้เสีย", "ภาษี", "tax", "vat"],
};

const guessField = (header) => {
  const h = String(header || "").toLowerCase().trim();
  for (const [field, hints] of Object.entries(FIELD_HINTS)) {
    if (hints.some(hint => h.includes(hint))) return field;
  }
  return "ignore";
};

// normalize phone: เก็บเฉพาะตัวเลข
const normalizePhone = (s) => String(s || "").replace(/[^\d]/g, "");

// dup key: name + phone (case-insensitive, ลบช่องว่าง)
const dupKey = (c) => `${(c.name || "").toLowerCase().trim()}|${normalizePhone(c.phone)}`;

const FIELD_LABELS = {
  name:    "ชื่อ *",
  phone:   "เบอร์โทร",
  address: "ที่อยู่",
  email:   "Email",
  taxId:   "เลขผู้เสียภาษี",
  ignore:  "— ข้าม —",
};

const FIELD_OPTIONS = ["name", "phone", "address", "email", "taxId", "ignore"];

// === Main Modal ===
export default function ImportCustomersModal({ existingCustomers, user, onClose, onDone }) {
  const fileInputRef = useRef(null);
  const [rows, setRows] = useState([]);        // [{col0:val, col1:val, ...}]
  const [headers, setHeaders] = useState([]);  // ["ชื่อ","เบอร์",...]
  const [mapping, setMapping] = useState({});  // { col0: "name", col1: "phone" }
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);  // { imported, skipped, errors }

  // === Read file ===
  const handleFile = async (file) => {
    if (!file) return;
    try {
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });
      if (json.length < 2) {
        alert("ไฟล์ว่าง หรือไม่มีข้อมูล (ต้องมีหัวคอลัมน์ + อย่างน้อย 1 แถว)");
        return;
      }
      const hdr = json[0].map(h => String(h || "").trim());
      const body = json.slice(1).filter(row => row.some(cell => String(cell || "").trim() !== ""));

      // auto-map
      const autoMap = {};
      hdr.forEach((h, i) => { autoMap[`col${i}`] = guessField(h); });

      // แปลง body เป็น object {col0:..., col1:...}
      const objRows = body.map(row => {
        const o = {};
        hdr.forEach((_, i) => { o[`col${i}`] = String(row[i] ?? "").trim(); });
        return o;
      });

      setHeaders(hdr);
      setRows(objRows);
      setMapping(autoMap);
      setResult(null);
    } catch (err) {
      console.error(err);
      alert("อ่านไฟล์ไม่ได้: " + err.message);
    }
  };

  const onPickFile = (e) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
  };

  const onDrop = (e) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  };

  // === Build customer records from mapped rows ===
  const buildCustomers = () => {
    const fieldToCol = {}; // {name:"col0", phone:"col1", ...}
    Object.entries(mapping).forEach(([col, field]) => {
      if (field !== "ignore" && !fieldToCol[field]) fieldToCol[field] = col;
    });

    return rows.map(row => ({
      name:    fieldToCol.name    ? row[fieldToCol.name]    : "",
      phone:   fieldToCol.phone   ? normalizePhone(row[fieldToCol.phone]) : "",
      address: fieldToCol.address ? row[fieldToCol.address] : "",
      email:   fieldToCol.email   ? row[fieldToCol.email]   : "",
      taxId:   fieldToCol.taxId   ? row[fieldToCol.taxId]   : "",
    })).filter(c => (c.name || "").trim() !== "");
  };

  const candidates = buildCustomers();
  const existingKeys = new Set(existingCustomers.map(dupKey));
  const newOnes = candidates.filter(c => !existingKeys.has(dupKey(c)));
  const dupes = candidates.length - newOnes.length;

  const nameMapped = Object.values(mapping).includes("name");

  // === Run import ===
  const handleImport = async () => {
    if (newOnes.length === 0) return;
    setImporting(true);
    let imported = 0, errors = 0;
    try {
      // batch 100 ต่อครั้ง (Firestore limit = 500 แต่เผื่อ index/safety)
      for (let i = 0; i < newOnes.length; i += 100) {
        const chunk = newOnes.slice(i, i + 100);
        const batch = writeBatch(db);
        chunk.forEach(c => {
          const ref = doc(collection(db, "customers"));
          batch.set(ref, {
            ...c,
            createdAt: serverTimestamp(),
            createdBy: user?.username || "",
            importedAt: serverTimestamp(),
          });
        });
        try {
          await batch.commit();
          imported += chunk.length;
        } catch (err) {
          console.error("Batch failed:", err);
          errors += chunk.length;
        }
      }
      setResult({ imported, skipped: dupes, errors });
      if (onDone) onDone(imported);
    } finally {
      setImporting(false);
    }
  };

  // === Download template ===
  const downloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ["ชื่อ", "เบอร์โทร", "ที่อยู่", "Email", "เลขผู้เสียภาษี"],
      ["บริษัท ABC จำกัด", "0812345678", "123 ถนน...", "abc@example.com", "1234567890123"],
      ["คุณสมชาย", "0898765432", "456 ซอย...", "", ""],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Customers");
    XLSX.writeFile(wb, "customers-template.xlsx");
  };

  return (
    <Modal onClose={onClose} w={760}>
      <MHead title="📥 นำเข้าลูกค้าจาก Excel" sub="รองรับ .xlsx, .xls, .csv (UTF-8)" onClose={onClose} />

      {/* === STEP 1: ยังไม่มีไฟล์ === */}
      {rows.length === 0 && !result && (
        <>
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={onDrop}
            style={{
              padding: 40, textAlign: "center", border: `2px dashed ${T.border}`, borderRadius: 12,
              background: "rgba(59,91,139,0.04)", cursor: "pointer", marginBottom: 14,
            }}>
            <div style={{ fontSize: 36, marginBottom: 10, opacity: 0.4 }}>📂</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: T.accent, marginBottom: 6 }}>คลิกเพื่อเลือกไฟล์ หรือลากมาวางที่นี่</div>
            <div style={{ fontSize: 11, color: T.muted }}>รองรับ .xlsx · .xls · .csv (แถวแรกคือหัวคอลัมน์)</div>
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" onChange={onPickFile} style={{ display: "none" }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, color: T.muted, padding: "8px 12px", background: "rgba(184,134,0,0.06)", borderRadius: 8, border: "1px solid rgba(184,134,0,0.2)" }}>
            <span>💡 ไม่มีไฟล์? ดาวน์โหลด template ตัวอย่างได้:</span>
            <button onClick={downloadTemplate} style={{ padding: "5px 12px", borderRadius: 6, border: `1px solid ${T.border}`, background: T.input, color: T.accent, cursor: "pointer", fontSize: 11, fontWeight: 600, fontFamily: "'Sarabun',sans-serif" }}>📥 ดาวน์โหลด template</button>
          </div>
        </>
      )}

      {/* === STEP 2: Preview + Mapping === */}
      {rows.length > 0 && !result && (
        <>
          <div style={{ marginBottom: 12, padding: "10px 14px", background: "rgba(59,91,139,0.06)", borderRadius: 8, fontSize: 12, color: T.sub }}>
            อ่านได้ <b style={{ color: T.accent }}>{rows.length}</b> แถว · จะ import <b style={{ color: T.green }}>{newOnes.length}</b> รายการ
            {dupes > 0 && <> · ข้าม <b style={{ color: T.amber }}>{dupes}</b> รายการ (ซ้ำกับที่มีอยู่)</>}
          </div>

          {/* Column mapping */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: T.muted, marginBottom: 6, fontWeight: 600 }}>📋 จับคู่คอลัมน์ (ระบบเดาให้แล้ว — ปรับได้ถ้าผิด)</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 8 }}>
              {headers.map((h, i) => (
                <div key={i} style={{ padding: 8, background: T.input, borderRadius: 7, border: `1px solid ${T.border}` }}>
                  <div style={{ fontSize: 10, color: T.muted, marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>📄 {h || `คอลัมน์ ${i + 1}`}</div>
                  <select value={mapping[`col${i}`] || "ignore"}
                    onChange={e => setMapping(m => ({ ...m, [`col${i}`]: e.target.value }))}
                    style={{ width: "100%", background: T.card, border: `1px solid ${T.border}`, borderRadius: 5, padding: "4px 6px", fontSize: 11, color: T.text, fontFamily: "'Sarabun',sans-serif", outline: "none" }}>
                    {FIELD_OPTIONS.map(f => <option key={f} value={f}>{FIELD_LABELS[f]}</option>)}
                  </select>
                </div>
              ))}
            </div>
            {!nameMapped && (
              <div style={{ marginTop: 8, padding: "8px 12px", background: "rgba(185,74,72,0.08)", borderRadius: 7, fontSize: 11, color: T.red }}>
                ⚠️ ต้องเลือกคอลัมน์ "ชื่อ" อย่างน้อย 1 คอลัมน์ ก่อน import ได้
              </div>
            )}
          </div>

          {/* Preview table */}
          <div style={{ maxHeight: 240, overflowY: "auto", background: T.card, borderRadius: 8, border: `1px solid ${T.border}`, marginBottom: 14 }}>
            <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
              <thead style={{ position: "sticky", top: 0, background: "rgba(241,243,246,0.95)" }}>
                <tr>
                  <th style={{ padding: "8px 6px", textAlign: "left", color: T.muted, fontWeight: 700, borderBottom: `1px solid ${T.border}`, width: 40 }}>#</th>
                  {["name", "phone", "address", "email", "taxId"].map(f => (
                    <th key={f} style={{ padding: "8px 6px", textAlign: "left", color: T.muted, fontWeight: 700, borderBottom: `1px solid ${T.border}` }}>{FIELD_LABELS[f].replace(" *", "")}</th>
                  ))}
                  <th style={{ padding: "8px 6px", textAlign: "center", color: T.muted, fontWeight: 700, borderBottom: `1px solid ${T.border}`, width: 50 }}>สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {candidates.slice(0, 50).map((c, i) => {
                  const isDupe = existingKeys.has(dupKey(c));
                  return (
                    <tr key={i} style={{ borderBottom: `1px solid ${T.border}`, opacity: isDupe ? 0.5 : 1 }}>
                      <td style={{ padding: "5px 6px", color: T.muted, fontFamily: "monospace" }}>{i + 1}</td>
                      <td style={{ padding: "5px 6px", color: T.text, fontWeight: 500 }}>{c.name || <span style={{ color: T.red }}>(ว่าง)</span>}</td>
                      <td style={{ padding: "5px 6px", color: T.sub, fontFamily: "monospace" }}>{c.phone || "—"}</td>
                      <td style={{ padding: "5px 6px", color: T.sub, fontSize: 10 }}>{(c.address || "").slice(0, 30)}{c.address?.length > 30 ? "…" : ""}</td>
                      <td style={{ padding: "5px 6px", color: T.sub, fontSize: 10 }}>{c.email || "—"}</td>
                      <td style={{ padding: "5px 6px", color: T.sub, fontFamily: "monospace", fontSize: 10 }}>{c.taxId || "—"}</td>
                      <td style={{ padding: "5px 6px", textAlign: "center" }}>
                        {isDupe ? <span style={{ color: T.amber, fontSize: 10 }}>ซ้ำ</span> : <span style={{ color: T.green, fontSize: 10 }}>ใหม่</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {candidates.length > 50 && (
              <div style={{ padding: "8px", textAlign: "center", fontSize: 11, color: T.muted, borderTop: `1px solid ${T.border}` }}>... และอีก {candidates.length - 50} แถว</div>
            )}
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <BtnGhost onClick={() => { setRows([]); setHeaders([]); setMapping({}); }} style={{ flex: 1 }}>ยกเลิก / เลือกไฟล์ใหม่</BtnGhost>
            <BtnPrimary onClick={handleImport} disabled={!nameMapped || newOnes.length === 0 || importing} style={{ flex: 2 }}>
              {importing ? "⏳ กำลัง import..." : `📥 Import ${newOnes.length} รายการ`}
            </BtnPrimary>
          </div>
        </>
      )}

      {/* === STEP 3: Result === */}
      {result && (
        <div style={{ textAlign: "center", padding: "20px 10px" }}>
          <div style={{ fontSize: 56, marginBottom: 12 }}>✅</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: T.green, marginBottom: 8 }}>Import เสร็จเรียบร้อย</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, margin: "20px 0", textAlign: "center" }}>
            <div style={{ padding: 14, background: "rgba(58,122,82,0.08)", borderRadius: 10 }}>
              <div style={{ fontSize: 24, fontWeight: 800, color: T.green, fontFamily: "monospace" }}>{result.imported}</div>
              <div style={{ fontSize: 11, color: T.sub }}>เพิ่มสำเร็จ</div>
            </div>
            <div style={{ padding: 14, background: "rgba(184,134,0,0.08)", borderRadius: 10 }}>
              <div style={{ fontSize: 24, fontWeight: 800, color: T.amber, fontFamily: "monospace" }}>{result.skipped}</div>
              <div style={{ fontSize: 11, color: T.sub }}>ข้าม (ซ้ำ)</div>
            </div>
            <div style={{ padding: 14, background: "rgba(185,74,72,0.08)", borderRadius: 10 }}>
              <div style={{ fontSize: 24, fontWeight: 800, color: T.red, fontFamily: "monospace" }}>{result.errors}</div>
              <div style={{ fontSize: 11, color: T.sub }}>ผิดพลาด</div>
            </div>
          </div>
          <BtnPrimary onClick={onClose} style={{ width: "100%" }}>เสร็จสิ้น</BtnPrimary>
        </div>
      )}
    </Modal>
  );
}
