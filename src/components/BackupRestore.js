import { useState, useEffect, useRef } from "react";
import * as XLSX from "xlsx";
import { db } from "../firebase";
import { collection, getDocs, writeBatch, doc, deleteDoc, setDoc } from "firebase/firestore";
import { T } from "../theme";
import { BtnPrimary, BtnDanger, BtnGhost } from "./ui";
import { shouldRemindBackup, getLastBackupDate, BACKUP_TS_KEY } from "../utils/backupReminder";

// ── Collections ที่ backup ──
const COLLECTIONS = [
  "users", "products", "clothing", "transactions",
  "customers", "suppliers", "orders", "invoices",
  "statements", "settings",
];

// ── helpers ──
const pad2 = n => String(n).padStart(2, "0");
const nowStr = () => {
  const d = new Date();
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}_${pad2(d.getHours())}${pad2(d.getMinutes())}`;
};
const fmtDate = (ts) => {
  if (!ts) return "—";
  const d = new Date(ts);
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};
const daysSince = (ts) => (ts ? Math.floor((Date.now() - ts) / 86400000) : Infinity);

// 🔁 ย้ายไป utils/backupReminder.js แล้ว — หน้าแรกต้องเรียกตอน login
//    ถ้ายังอยู่ไฟล์นี้ จะลาก xlsx (ใหญ่หลายร้อย KB) เข้าโค้ดก้อนหลักไปด้วย
//    re-export ไว้เผื่อมีที่อื่น import จากไฟล์นี้อยู่
export { shouldRemindBackup, getLastBackupDate };

// ── Main Component ──
export default function BackupRestore({ projectId, user, role }) {
  const fileInputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [lastBackup, setLastBackup] = useState(getLastBackupDate());
  const [showRestoreConfirm, setShowRestoreConfirm] = useState(null); // {data, summary}
  const [result, setResult] = useState(null);

  useEffect(() => {
    setLastBackup(getLastBackupDate());
  }, []);

  // === ดึงข้อมูลทั้งหมดจาก Firestore (ใช้ร่วมระหว่าง JSON และ Excel) ===
  const fetchAllData = async () => {
    const data = {
      metadata: {
        version: 1,
        projectId,
        exportedAt: new Date().toISOString(),
        exportedBy: user?.username || "",
      },
      collections: {},
    };
    let totalDocs = 0;
    for (const col of COLLECTIONS) {
      setProgress(`กำลัง backup ${col}...`);
      const snap = await getDocs(collection(db, col));
      const docs = snap.docs.map(d => ({ _id: d.id, ...d.data() }));
      data.collections[col] = docs;
      totalDocs += docs.length;
    }
    return { data, totalDocs };
  };

  // === EXPORT JSON ===
  const handleExportJSON = async () => {
    setBusy(true);
    setResult(null);
    setProgress("กำลังเตรียมข้อมูล...");
    try {
      const { data, totalDocs } = await fetchAllData();
      setProgress(`พบ ${totalDocs} records — กำลังสร้างไฟล์...`);

      const json = JSON.stringify(data, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `cpu-erp-backup-${projectId}-${nowStr()}.json`;
      a.click();
      URL.revokeObjectURL(url);

      const ts = Date.now();
      localStorage.setItem(BACKUP_TS_KEY, String(ts));
      setLastBackup(ts);

      setResult({ type: "ok", msg: `✅ Backup JSON สำเร็จ ${totalDocs} records ใน ${COLLECTIONS.length} collections` });
    } catch (err) {
      console.error(err);
      setResult({ type: "err", msg: `❌ Backup ล้มเหลว: ${err.message}` });
    } finally {
      setBusy(false);
      setProgress("");
    }
  };

  // === EXPORT EXCEL ===
  // 1 sheet ต่อ 1 collection — field ที่เป็น array/object จะ JSON.stringify ลงเซลล์
  const flattenValue = (v) => {
    if (v == null) return "";
    if (v instanceof Date) return v.toISOString();
    if (typeof v === "object") {
      // Firestore Timestamp มี toDate()
      if (typeof v.toDate === "function") return v.toDate().toISOString();
      return JSON.stringify(v);
    }
    return v;
  };
  const flattenDoc = (d) => {
    const out = {};
    Object.entries(d).forEach(([k, v]) => { out[k] = flattenValue(v); });
    return out;
  };

  const handleExportExcel = async () => {
    setBusy(true);
    setResult(null);
    setProgress("กำลังเตรียมข้อมูล...");
    try {
      const { data, totalDocs } = await fetchAllData();
      setProgress(`พบ ${totalDocs} records — กำลังสร้าง Excel...`);

      const wb = XLSX.utils.book_new();

      // sheet สรุป (metadata)
      const summaryRows = [
        ["CPU ERP — Backup Report"],
        [""],
        ["Project", data.metadata.projectId],
        ["Exported At", data.metadata.exportedAt],
        ["Exported By", data.metadata.exportedBy],
        ["Total Records", totalDocs],
        [""],
        ["Collection", "Record Count"],
        ...COLLECTIONS.map(c => [c, (data.collections[c] || []).length]),
      ];
      const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
      summarySheet["!cols"] = [{ wch: 20 }, { wch: 40 }];
      XLSX.utils.book_append_sheet(wb, summarySheet, "📊 สรุป");

      // 1 sheet ต่อ collection
      for (const col of COLLECTIONS) {
        const docs = data.collections[col] || [];
        if (docs.length === 0) {
          // sheet ว่าง — ใส่ header เปล่าๆ
          const emptySheet = XLSX.utils.aoa_to_sheet([["(ไม่มีข้อมูล)"]]);
          XLSX.utils.book_append_sheet(wb, emptySheet, col.slice(0, 31)); // sheet name max 31 chars
          continue;
        }
        const flattened = docs.map(flattenDoc);
        const sheet = XLSX.utils.json_to_sheet(flattened);
        // auto column width (rough)
        const headers = Object.keys(flattened[0]);
        sheet["!cols"] = headers.map(h => ({ wch: Math.min(Math.max(h.length + 2, 12), 40) }));
        XLSX.utils.book_append_sheet(wb, sheet, col.slice(0, 31));
      }

      // เขียน + ดาวน์โหลด
      XLSX.writeFile(wb, `cpu-erp-backup-${projectId}-${nowStr()}.xlsx`);

      const ts = Date.now();
      localStorage.setItem(BACKUP_TS_KEY, String(ts));
      setLastBackup(ts);

      setResult({ type: "ok", msg: `✅ Backup Excel สำเร็จ ${totalDocs} records ใน ${COLLECTIONS.length} sheets` });
    } catch (err) {
      console.error(err);
      setResult({ type: "err", msg: `❌ Export Excel ล้มเหลว: ${err.message}` });
    } finally {
      setBusy(false);
      setProgress("");
    }
  };

  // === Pick file สำหรับ restore ===
  const onPickRestoreFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data.collections || !data.metadata) {
        alert("ไฟล์ไม่ใช่ backup ของ CPU ERP");
        return;
      }
      // สร้าง summary
      const summary = Object.entries(data.collections).map(([col, arr]) => ({
        col, count: Array.isArray(arr) ? arr.length : 0,
      }));
      setShowRestoreConfirm({ data, summary, fileName: file.name });
    } catch (err) {
      alert("อ่านไฟล์ไม่ได้: " + err.message);
    } finally {
      e.target.value = ""; // reset เพื่อเลือกไฟล์เดิมซ้ำได้
    }
  };

  // === RESTORE — กู้ข้อมูลจาก JSON ===
  const handleRestore = async ({ data, replaceMode }) => {
    setShowRestoreConfirm(null);
    setBusy(true);
    setResult(null);
    let restored = 0, failed = 0;

    try {
      for (const col of COLLECTIONS) {
        const docs = data.collections[col];
        if (!Array.isArray(docs)) continue;
        setProgress(`กำลังกู้ ${col} (${docs.length} records)...`);

        // ถ้า replaceMode → ลบของเก่าก่อน
        if (replaceMode) {
          const oldSnap = await getDocs(collection(db, col));
          for (let i = 0; i < oldSnap.docs.length; i += 100) {
            const chunk = oldSnap.docs.slice(i, i + 100);
            const batch = writeBatch(db);
            chunk.forEach(d => batch.delete(d.ref));
            try { await batch.commit(); } catch { failed += chunk.length; }
          }
        }

        // เขียนของใหม่ (batch 100)
        for (let i = 0; i < docs.length; i += 100) {
          const chunk = docs.slice(i, i + 100);
          const batch = writeBatch(db);
          chunk.forEach(d => {
            const { _id, ...rest } = d;
            const ref = _id ? doc(db, col, _id) : doc(collection(db, col));
            batch.set(ref, rest);
          });
          try {
            await batch.commit();
            restored += chunk.length;
          } catch (err) {
            console.error(`Restore ${col} batch failed:`, err);
            failed += chunk.length;
          }
        }
      }
      setResult({ type: "ok", msg: `✅ กู้คืนสำเร็จ ${restored} records${failed > 0 ? ` (ล้มเหลว ${failed})` : ""}` });
    } catch (err) {
      console.error(err);
      setResult({ type: "err", msg: `❌ Restore ล้มเหลว: ${err.message}` });
    } finally {
      setBusy(false);
      setProgress("");
    }
  };

  // ── RENDER ──
  const lastDays = daysSince(lastBackup);
  const isOverdue = lastDays >= 7;

  return (
    <div>
      {/* Status banner */}
      <div style={{
        padding: 14, borderRadius: 10, marginBottom: 18,
        background: isOverdue ? "rgba(184,134,0,0.08)" : "rgba(58,122,82,0.08)",
        border: `1px solid ${isOverdue ? "rgba(184,134,0,0.3)" : "rgba(58,122,82,0.25)"}`,
      }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: isOverdue ? T.amber : T.green, marginBottom: 4 }}>
          {isOverdue ? "⚠️ ควร backup โดยด่วน" : "✅ Backup อยู่ในสถานะดี"}
        </div>
        <div style={{ fontSize: 12, color: T.sub }}>
          Backup ล่าสุด (เครื่องนี้): <b>{lastBackup ? fmtDate(lastBackup) : "ยังไม่เคย backup"}</b>
          {lastBackup > 0 && <span style={{ marginLeft: 8, color: T.muted }}>({lastDays === 0 ? "วันนี้" : `${lastDays} วันที่แล้ว`})</span>}
        </div>
      </div>

      {/* Export section */}
      <div style={{ marginBottom: 20, padding: 16, background: T.input, borderRadius: 10, border: `1px solid ${T.border}` }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: T.text, marginBottom: 6 }}>💾 ดาวน์โหลด Backup</div>
        <div style={{ fontSize: 12, color: T.sub, marginBottom: 12 }}>
          ดาวน์โหลดข้อมูลทั้งหมด ({COLLECTIONS.length} collections) เก็บไว้ในเครื่อง (project: <b>{projectId}</b>)
        </div>
        {busy ? (
          <div style={{ padding: "10px 16px", borderRadius: 8, background: "rgba(59,91,139,0.08)", color: T.accent, fontSize: 13, fontWeight: 600, textAlign: "center" }}>
            ⏳ {progress || "กำลังทำงาน..."}
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <BtnPrimary onClick={handleExportJSON} disabled={busy}>
              📄 JSON (สำหรับ Restore)
            </BtnPrimary>
            <button onClick={handleExportExcel} disabled={busy}
              style={{ padding: "8px 18px", borderRadius: 8, border: "none", cursor: "pointer", background: "linear-gradient(135deg,#1f7244,#3a7a52)", color: "white", fontSize: 13, fontWeight: 600, fontFamily: "'Sarabun',sans-serif", boxShadow: "0 2px 10px rgba(58,122,82,0.3)" }}>
              📊 Excel (ดู/แก้ในมือ)
            </button>
          </div>
        )}
        <div style={{ marginTop: 8, fontSize: 10, color: T.muted, lineHeight: 1.5 }}>
          • <b>JSON</b> — ใช้กู้ข้อมูลกลับ (Restore) เก็บได้ครบ 100%<br />
          • <b>Excel</b> — เปิดด้วย Excel/Google Sheets, 1 sheet/collection ดูง่าย แต่ Restore ไม่ได้
        </div>
      </div>

      {/* Restore section */}
      {role.canClear && (
        <div style={{ marginBottom: 20, padding: 16, background: "rgba(184,134,0,0.05)", borderRadius: 10, border: "1px solid rgba(184,134,0,0.2)" }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: T.amber, marginBottom: 6 }}>📤 Restore จากไฟล์ Backup</div>
          <div style={{ fontSize: 12, color: T.sub, marginBottom: 12 }}>
            กู้ข้อมูลจากไฟล์ที่ backup ไว้ — มีตัวเลือกว่าจะ <b>เพิ่ม</b> (รวมกับของปัจจุบัน) หรือ <b>แทนที่</b> (ลบของเก่าหมดแล้วใส่ใหม่)
          </div>
          <BtnGhost onClick={() => fileInputRef.current?.click()} disabled={busy} style={{ width: "100%" }}>
            📂 เลือกไฟล์ Backup (.json)
          </BtnGhost>
          <input ref={fileInputRef} type="file" accept=".json" onChange={onPickRestoreFile} style={{ display: "none" }} />
        </div>
      )}

      {/* Result */}
      {result && (
        <div style={{
          padding: 12, borderRadius: 8, marginBottom: 14,
          background: result.type === "ok" ? "rgba(58,122,82,0.08)" : "#fef2f2",
          border: `1px solid ${result.type === "ok" ? "rgba(58,122,82,0.3)" : "#fecaca"}`,
          color: result.type === "ok" ? T.green : T.red,
          fontSize: 13, fontWeight: 500,
        }}>{result.msg}</div>
      )}

      {/* Info */}
      <div style={{ padding: 12, background: "rgba(59,91,139,0.05)", borderRadius: 8, fontSize: 11, color: T.sub, lineHeight: 1.6 }}>
        💡 <b>คำแนะนำ:</b><br />
        • ควร backup อย่างน้อย <b>สัปดาห์ละ 1 ครั้ง</b><br />
        • เก็บไฟล์ในที่หลายๆที่ — เครื่อง + Cloud + USB<br />
        • ทดสอบ restore เป็นระยะ — เผื่อไฟล์เสีย<br />
        • แอดมินเท่านั้นที่ทำ restore ได้ (อาจกระทบข้อมูลทั้งหมด)
      </div>

      {/* === Restore Confirmation Modal === */}
      {showRestoreConfirm && (
        <RestoreConfirmModal
          fileName={showRestoreConfirm.fileName}
          summary={showRestoreConfirm.summary}
          metadata={showRestoreConfirm.data.metadata}
          onCancel={() => setShowRestoreConfirm(null)}
          onConfirm={(replaceMode) => handleRestore({ data: showRestoreConfirm.data, replaceMode })}
        />
      )}
    </div>
  );
}

// === Restore Confirmation Modal ===
function RestoreConfirmModal({ fileName, summary, metadata, onCancel, onConfirm }) {
  const [mode, setMode] = useState("append"); // "append" | "replace"
  const totalRecords = summary.reduce((s, x) => s + x.count, 0);

  return (
    <div style={{ position: "fixed", inset: 0, background: T.overlay, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 600, backdropFilter: "blur(6px)" }}>
      <div style={{ background: "#ffffff", borderRadius: 14, padding: 24, width: 520, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 24px 60px rgba(0,0,0,0.3)" }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: T.text, marginBottom: 4 }}>📤 ยืนยันการกู้ข้อมูล</div>
        <div style={{ fontSize: 11, color: T.sub, marginBottom: 14 }}>{fileName}</div>

        {/* File metadata */}
        <div style={{ padding: 10, background: T.input, borderRadius: 8, marginBottom: 12, fontSize: 11, color: T.sub }}>
          <div>📅 Export เมื่อ: {metadata.exportedAt ? new Date(metadata.exportedAt).toLocaleString("th-TH") : "—"}</div>
          <div>👤 โดย: {metadata.exportedBy || "—"}</div>
          <div>🏷️ Project: {metadata.projectId || "—"}</div>
        </div>

        {/* Summary */}
        <div style={{ marginBottom: 14, padding: 12, background: "rgba(59,91,139,0.04)", borderRadius: 8, border: `1px solid ${T.border}` }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: T.text, marginBottom: 6 }}>ข้อมูลในไฟล์ ({totalRecords} records)</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 4, fontSize: 11, color: T.sub }}>
            {summary.map(s => (
              <div key={s.col}>{s.col}: <b style={{ color: T.text }}>{s.count}</b></div>
            ))}
          </div>
        </div>

        {/* Mode select */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: T.text, marginBottom: 8 }}>เลือกวิธีกู้ข้อมูล:</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <label style={{ padding: 12, borderRadius: 8, border: `1px solid ${mode === "append" ? T.accent : T.border}`, background: mode === "append" ? "rgba(59,91,139,0.06)" : T.card, cursor: "pointer" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input type="radio" checked={mode === "append"} onChange={() => setMode("append")} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>🟢 Append — เพิ่มเข้าของเดิม</div>
                  <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>ปลอดภัย — ทับเฉพาะ record ที่ ID ตรงกัน อันใหม่เพิ่มเข้ามา</div>
                </div>
              </div>
            </label>
            <label style={{ padding: 12, borderRadius: 8, border: `1px solid ${mode === "replace" ? "#b94a48" : T.border}`, background: mode === "replace" ? "rgba(185,74,72,0.06)" : T.card, cursor: "pointer" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input type="radio" checked={mode === "replace"} onChange={() => setMode("replace")} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: T.red }}>🔴 Replace — ลบของเก่าทั้งหมดแล้วใส่ใหม่</div>
                  <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>⚠️ อันตราย — ข้อมูลที่มีอยู่ตอนนี้จะหายหมด (Restore จากศูนย์)</div>
                </div>
              </div>
            </label>
          </div>
        </div>

        {mode === "replace" && (
          <div style={{ padding: 10, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 7, fontSize: 11, color: T.red, marginBottom: 14 }}>
            ⚠️ การ Replace จะลบข้อมูลปัจจุบัน <b>ทั้งหมด</b> ก่อนใส่ของใหม่ — ห้ามทำถ้าไม่ backup ของปัจจุบันไว้ก่อน
          </div>
        )}

        <div style={{ display: "flex", gap: 10 }}>
          <BtnGhost onClick={onCancel} style={{ flex: 1 }}>ยกเลิก</BtnGhost>
          {mode === "replace"
            ? <BtnDanger onClick={() => onConfirm(true)} style={{ flex: 2 }}>🔴 ยืนยัน Replace ทั้งหมด</BtnDanger>
            : <BtnPrimary onClick={() => onConfirm(false)} style={{ flex: 2 }}>🟢 ยืนยันกู้ข้อมูล</BtnPrimary>
          }
        </div>
      </div>
    </div>
  );
}
