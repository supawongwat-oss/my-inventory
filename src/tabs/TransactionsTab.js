// 🔄 รับ/จ่ายสินค้า — ประวัติการเคลื่อนไหวของสต็อก
//
// เดิมหน้านี้ไม่มีตัวกรองอะไรเลยสักอย่าง ไม่มีแม้แต่ช่องค้นหา
// เทรายการทั้งหมด (เพดาน 500 แถว) ลงมารวดเดียว โดยเอาเสื้อผ้ากับวัตถุดิบปนกัน
// จะหาว่า "เมื่อวานจ่ายผ้าไปเท่าไหร่" ต้องไล่สายตาเอง
//
// 🏷️ แยกสินค้า/วัตถุดิบยังไง
//   รายการฝั่งเสื้อผ้าทุกจุดที่เขียนจะใส่ category: "เสื้อผ้า" ไว้ (9 จาก 11 จุดในโค้ด)
//   ฝั่ง products (วัตถุดิบ/ของทั่วไป) เดิมไม่ใส่อะไรเลย ตอนนี้ใส่ category ของตัวสินค้าลงไปแล้ว
//   กติกาจึงเป็น "เสื้อผ้า = สินค้า · นอกนั้น = วัตถุดิบ" ซึ่งใช้ได้กับข้อมูลเก่าที่ยังไม่มี category ด้วย
//   → ไม่ต้องไปไล่แก้ข้อมูลเก่าเลย
//
// ใช้ปุ่มกรอง ไม่ใช่แท็บแยกขาด — แท็บแยกขาดจะซ่อนรายการที่ไม่เข้าพวกทั้งสองฝั่ง
// ปุ่มกรองยังมี "ทั้งหมด" ให้กลับมาเห็นของครบเสมอ
import React from "react";
import { T } from "../theme";
import { CardBox, Badge } from "../components/ui";

const PAGE = 100;

const norm = (s) => String(s || "").normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();
const isClothing = (t) => t?.category === "เสื้อผ้า";

// ทุกคำต้องเจอ — พิมพ์ "ผ้า จ่าย สมชาย" แล้วได้เฉพาะรายการที่มีครบทั้งสาม
const matches = (t, q) => {
  const tokens = norm(q).split(" ").filter(Boolean);
  if (!tokens.length) return true;
  const hay = norm([t.name, t.note, t.code, t.by, t.type, t.date, t.category].filter(Boolean).join(" "));
  return tokens.every(k => hay.includes(k));
};

export default function TransactionsTab({ transactions = [] }) {
  const [search, setSearch] = React.useState("");
  const [cat, setCat] = React.useState("ทั้งหมด");    // ทั้งหมด | สินค้า | วัตถุดิบ
  const [type, setType] = React.useState("ทั้งหมด");  // ทั้งหมด | รับ | จ่าย
  const [shown, setShown] = React.useState(PAGE);

  // เปลี่ยนตัวกรองแล้วต้องกลับไปหน้าแรก ไม่งั้นจะงงว่าทำไมเห็นน้อย/เยอะผิดปกติ
  React.useEffect(() => { setShown(PAGE); }, [search, cat, type]);

  const counts = React.useMemo(() => ({
    all: transactions.length,
    clothing: transactions.filter(isClothing).length,
    material: transactions.filter(t => !isClothing(t)).length,
  }), [transactions]);

  const filtered = React.useMemo(() => transactions.filter(t => {
    if (cat === "สินค้า" && !isClothing(t)) return false;
    if (cat === "วัตถุดิบ" && isClothing(t)) return false;
    if (type !== "ทั้งหมด" && t.type !== type) return false;
    return matches(t, search);
  }), [transactions, cat, type, search]);

  const sum = React.useMemo(() => ({
    in: filtered.filter(t => t.type === "รับ").reduce((s, t) => s + (Number(t.qty) || 0), 0),
    out: filtered.filter(t => t.type === "จ่าย").reduce((s, t) => s + (Number(t.qty) || 0), 0),
  }), [filtered]);

  const visible = filtered.slice(0, shown);
  const filtering = !!search || cat !== "ทั้งหมด" || type !== "ทั้งหมด";

  const Chip = ({ active, onClick, children, color }) => (
    <button onClick={onClick}
      style={{ padding: "5px 12px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontFamily: "'Sarabun',sans-serif",
        fontWeight: active ? 700 : 400,
        border: `1px solid ${active ? (color || T.accent) : T.border}`,
        background: active ? `${color || T.accent}18` : "white",
        color: active ? (color || T.accent) : T.sub }}>
      {children}
    </button>
  );

  const GRID = "70px 80px 1fr 80px 150px 160px";

  return (
    <CardBox style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ padding: "12px 16px", borderBottom: `1px solid ${T.border}`, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: T.text, marginRight: 4 }}>ประวัติการเคลื่อนไหว</div>
        <Chip active={cat === "ทั้งหมด"} onClick={() => setCat("ทั้งหมด")}>ทั้งหมด ({counts.all})</Chip>
        <Chip active={cat === "สินค้า"} onClick={() => setCat("สินค้า")} color="#7c3aed">👕 สินค้า ({counts.clothing})</Chip>
        <Chip active={cat === "วัตถุดิบ"} onClick={() => setCat("วัตถุดิบ")} color="#0891b2">🧪 วัตถุดิบ ({counts.material})</Chip>
        <span style={{ width: 1, height: 20, background: T.border, margin: "0 2px" }}/>
        <Chip active={type === "ทั้งหมด"} onClick={() => setType("ทั้งหมด")}>รับ+จ่าย</Chip>
        <Chip active={type === "รับ"} onClick={() => setType("รับ")} color={T.green}>⬇ รับ</Chip>
        <Chip active={type === "จ่าย"} onClick={() => setType("จ่าย")} color={T.red}>⬆ จ่าย</Chip>
      </div>

      <div style={{ padding: "10px 16px", borderBottom: `1px solid ${T.border}`, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="🔍 ค้นชื่อสินค้า / โน้ต / รหัส / ผู้ดำเนินการ — พิมพ์หลายคำได้ ต้องเจอครบทุกคำ"
          style={{ flex: "1 1 260px", padding: "8px 12px", borderRadius: 8, border: `1px solid ${T.border}`, fontSize: 13, fontFamily: "inherit", outline: "none" }}/>
        {filtering && (
          <button onClick={() => { setSearch(""); setCat("ทั้งหมด"); setType("ทั้งหมด"); }}
            style={{ padding: "7px 12px", borderRadius: 8, border: `1px solid ${T.border}`, background: "white", color: T.sub, cursor: "pointer", fontSize: 12, fontFamily: "inherit" }}>
            ✕ ล้างตัวกรอง
          </button>
        )}
        <div style={{ fontSize: 12, color: T.sub, marginLeft: "auto", whiteSpace: "nowrap" }}>
          {filtered.length.toLocaleString("th-TH")} รายการ
          {" · "}<span style={{ color: T.green, fontWeight: 700, fontFamily: "monospace" }}>+{sum.in.toLocaleString("th-TH")}</span>
          {" "}<span style={{ color: T.red, fontWeight: 700, fontFamily: "monospace" }}>-{sum.out.toLocaleString("th-TH")}</span>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: GRID, alignItems: "center", padding: "10px 16px", background: "#f8f9fb", borderBottom: `1px solid ${T.border}`, color: T.muted, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>
        <div>#</div><div>ประเภท</div><div>สินค้า</div><div style={{ textAlign: "right" }}>จำนวน</div><div>ผู้ดำเนินการ</div><div>วันที่/เวลา</div>
      </div>

      {visible.length === 0 ? (
        <div style={{ padding: 40, textAlign: "center", color: T.muted, fontSize: 13 }}>
          {filtering ? "ไม่พบรายการที่ตรงกับตัวกรอง" : "ยังไม่มีรายการ"}
        </div>
      ) : visible.map((t, i) => (
        <div key={t.id} style={{ display: "grid", gridTemplateColumns: GRID, alignItems: "center", padding: "11px 16px", borderBottom: i < visible.length - 1 ? `1px solid ${T.border}` : "none" }}
          onMouseEnter={e => e.currentTarget.style.background = "rgba(59,91,139,0.05)"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
          <div style={{ fontFamily: "monospace", fontSize: 10, color: T.muted }}>#{String(i + 1).padStart(4, "0")}</div>
          <div><Badge bg={t.type === "รับ" ? "#dcfce7" : "#fef2f2"} color={t.type === "รับ" ? T.green : T.red}>{t.type === "รับ" ? "⬇ รับ" : "⬆ จ่าย"}</Badge></div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 500, color: T.text, fontSize: 13, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <span>{t.name}</span>
              <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 6, whiteSpace: "nowrap",
                background: isClothing(t) ? "rgba(124,58,237,0.1)" : "rgba(8,145,178,0.1)",
                color: isClothing(t) ? "#7c3aed" : "#0891b2" }}>
                {isClothing(t) ? "👕 สินค้า" : `🧪 ${t.category || "วัตถุดิบ"}`}
              </span>
              {t.stockAffected === false && (
                <span title="รายการนี้ไม่ได้ทำให้สต็อกเปลี่ยน" style={{ fontSize: 9, padding: "1px 6px", borderRadius: 6, background: "rgba(100,116,139,0.12)", color: T.sub, whiteSpace: "nowrap" }}>ไม่กระทบสต็อก</span>
              )}
            </div>
            <div style={{ fontSize: 10, color: T.muted }}>{t.note || "-"}</div>
          </div>
          <div style={{ textAlign: "right", fontFamily: "monospace", fontWeight: 700, color: t.type === "รับ" ? T.green : T.red }}>{t.type === "รับ" ? "+" : "-"}{t.qty}</div>
          <div style={{ fontSize: 12, color: T.sub, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.by}</div>
          <div style={{ fontSize: 11, color: T.muted, fontFamily: "monospace" }}>{t.date}</div>
        </div>
      ))}

      {filtered.length > shown && (
        <div style={{ padding: 14, textAlign: "center", borderTop: `1px solid ${T.border}` }}>
          <button onClick={() => setShown(n => n + PAGE)}
            style={{ padding: "8px 18px", borderRadius: 8, border: `1px solid ${T.border}`, background: "white", color: T.accent, cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: "'Sarabun',sans-serif" }}>
            โหลดเพิ่ม {Math.min(PAGE, filtered.length - shown)} รายการ (เหลืออีก {(filtered.length - shown).toLocaleString("th-TH")})
          </button>
        </div>
      )}
    </CardBox>
  );
}
