import React from "react";

// 📅 แถบบอก "ช่วงวันที่ที่โหลดมาจริง" + ปุ่มขยายช่วง
// ทำไมต้องมี: ระบบโหลดข้อมูลเป็นช่วงวันที่ (ไม่ใช่ทั้งหมด) — ถ้าไม่บอก
// ผู้ใช้จะนึกว่า "ใบนั้นหายไปแล้ว" ทั้งที่แค่ยังไม่ได้ดึงมา
const T = {
  border: "#e3e8ef", sub: "#5b6b85", muted: "#8a9bb3", accent: "#3b5b8b", amber: "#b45309",
};

const fmtDMY = (d) => d instanceof Date && !isNaN(d)
  ? `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`
  : "—";

const midnightAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); d.setHours(0, 0, 0, 0); return d; };

export const RANGE_PRESETS = [
  { d: 0,   l: "วันนี้" },
  { d: 2,   l: "3 วัน" },
  { d: 7,   l: "7 วัน" },
  { d: 30,  l: "30 วัน" },
  { d: 90,  l: "90 วัน" },
  { d: 365, l: "1 ปี" },
];

export default function LoadRangeBar({
  label,          // "ใบสั่งของ" / "บิล" / "ออเดอร์จาก catalog"
  range,          // { from: Date, to: Date|null }
  setRange,
  capped = false,
  count = 0,
  unit = "ใบ",
  presets = RANGE_PRESETS,
}) {
  if (!range?.from) return null;
  const activeDays = Math.round((Date.now() - range.from.getTime()) / 86400000);

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
      padding: "8px 14px", marginBottom: 12, borderRadius: 9, fontSize: 11,
      background: capped ? "rgba(217,119,6,0.08)" : "rgba(59,91,139,0.06)",
      border: `1px solid ${capped ? "rgba(217,119,6,0.35)" : T.border}`,
      color: capped ? T.amber : T.sub,
    }}>
      <span>
        📅 {label}ช่วง <b>{fmtDMY(range.from)} – {range.to ? fmtDMY(range.to) : "วันนี้"}</b>
        {" "}({count.toLocaleString("th-TH")} {unit})
      </span>
      <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {presets.map(p => {
          const on = !range.to && Math.abs(activeDays - p.d) <= 0;
          return (
            <button key={p.d} onClick={() => setRange({ from: midnightAgo(p.d), to: null })}
              style={{
                padding: "3px 10px", borderRadius: 12, cursor: "pointer", fontSize: 11, fontFamily: "'Sarabun',sans-serif",
                border: `1px solid ${on ? T.accent : T.border}`,
                background: on ? "rgba(59,91,139,0.12)" : "white",
                color: on ? T.accent : T.muted, fontWeight: on ? 700 : 400,
              }}>{p.l}</button>
          );
        })}
      </span>
      {capped
        ? <b>⚠️ ช่วงนี้มีมากเกินกว่าจะโหลดหมด — แสดงเฉพาะที่ใหม่ที่สุด ให้เลือกช่วงแคบลง</b>
        : <span style={{ color: T.muted }}>· เก่ากว่านี้ยังอยู่ครบ — ขยายช่วงเพื่อดึงมาดู</span>}
    </div>
  );
}
