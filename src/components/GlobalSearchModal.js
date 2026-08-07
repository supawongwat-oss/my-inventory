// 🔎 ค้นหาทั้งระบบ — เปิดด้วยปุ่มบนหัวจอ หรือ Ctrl+K
// ต่างจากช่องค้นหาในแต่ละหน้า: ตัวนี้ไปถามฐานข้อมูลจริง จึงเจอใบเก่าที่ยังไม่ได้โหลดมา
import React, { useState, useEffect, useRef, useCallback } from "react";
import { db } from "../firebase";
import { globalSearch } from "../utils/globalSearch";

const T = {
  card: "#ffffff", border: "#e3e8ef", text: "#1f2a44", sub: "#5b6b85", muted: "#8a9bb3",
  accent: "#3b5b8b", input: "#f6f8fb", inputBorder: "#d8dee9", amber: "#b45309", green: "#16a34a",
};

const KIND_HINT = {
  phone:  "🔢 กำลังหาจากเบอร์โทร (ต้องตรงทั้งเบอร์)",
  docNo:  "🧾 กำลังหาจากเลขที่เอกสาร (พิมพ์ขึ้นต้นได้ เช่น INV6908)",
  name:   "👤 กำลังหาจากชื่อลูกค้า (พิมพ์คำที่อยู่ตรงไหนของชื่อก็ได้)",
  empty:  "",
};

const qtyOf = (o) => (o.items || []).reduce((s, i) => s + (Number(i.qty) || 0), 0);
const baht = (n) => `฿${Number(n || 0).toLocaleString("th-TH", { minimumFractionDigits: 2 })}`;

export default function GlobalSearchModal({ open, onClose, onOpenOrder, onOpenInvoice, onOpenCustomer, customers = [] }) {
  const [term, setTerm] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  const [err, setErr] = useState("");
  const inputRef = useRef(null);
  const reqId = useRef(0);
  // เก็บใน ref — ทะเบียนลูกค้าเป็น array ใหม่ทุก snapshot ถ้าใส่ใน deps จะยิงค้นซ้ำโดยไม่จำเป็น
  const custRef = useRef(customers);
  custRef.current = customers;

  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 50); }, [open]);
  useEffect(() => { if (!open) { setTerm(""); setRes(null); setErr(""); } }, [open]);

  const run = useCallback(async (q) => {
    const my = ++reqId.current;
    if (!q.trim()) { setRes(null); setBusy(false); return; }
    setBusy(true); setErr("");
    try {
      const r = await globalSearch(db, q, custRef.current);
      if (my === reqId.current) setRes(r);
    } catch (e) {
      if (my === reqId.current) setErr(e?.message || String(e));
    } finally {
      if (my === reqId.current) setBusy(false);
    }
  }, []);

  // หน่วง 350ms — กันยิง query ทุกตัวอักษรที่พิมพ์ (เปลืองโควต้าอ่าน)
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => run(term), 350);
    return () => clearTimeout(t);
  }, [term, open, run]);

  if (!open) return null;

  const total = res ? res.orders.length + res.invoices.length + res.customers.length : 0;

  const pick = (fn, row) => { fn?.(row); onClose(); };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 900, background: "rgba(15,23,42,0.45)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "8vh 16px 16px" }}>
      <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 720, background: T.card, borderRadius: 16, border: `1px solid ${T.border}`, boxShadow: "0 24px 70px rgba(0,0,0,0.3)", overflow: "hidden", display: "flex", flexDirection: "column", maxHeight: "80vh" }}>
        <div style={{ padding: 14, borderBottom: `1px solid ${T.border}` }}>
          <input ref={inputRef} value={term} onChange={e => setTerm(e.target.value)}
            onKeyDown={e => { if (e.key === "Escape") onClose(); }}
            placeholder="🔎 ค้นหาทั้งระบบ — เลขที่ใบ / เบอร์โทร / ชื่อลูกค้า"
            style={{ width: "100%", boxSizing: "border-box", background: T.input, border: `1px solid ${T.accent}`, color: T.text, borderRadius: 10, padding: "12px 14px", fontFamily: "'Sarabun',sans-serif", fontSize: 16, outline: "none" }} />
          <div style={{ marginTop: 7, fontSize: 11, color: T.muted, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <span>ค้นทุกใบในฐานข้อมูล ไม่จำกัดช่วงวันที่</span>
            {res && <b style={{ color: T.sub }}>{KIND_HINT[res.kind]}</b>}
            {busy && <span style={{ color: T.accent }}>กำลังค้นหา…</span>}
          </div>
        </div>

        <div style={{ overflowY: "auto", padding: 10 }}>
          {err && <div style={{ padding: 14, fontSize: 12, color: "#b91c1c" }}>ค้นหาไม่สำเร็จ: {err}</div>}

          {!term.trim() && (
            <div style={{ padding: "26px 18px", fontSize: 12.5, color: T.sub, lineHeight: 2 }}>
              <div style={{ fontWeight: 700, color: T.text, marginBottom: 6 }}>พิมพ์อะไรก็ได้ ระบบเดาให้เอง</div>
              <div>🧾 <b>INV6908-0003</b> หรือ <b>ORD6908</b> — เลขที่เอกสาร (พิมพ์ขึ้นต้นก็ได้)</div>
              <div>🔢 <b>0812345678</b> — เบอร์โทร (ใส่ขีดหรือไม่ใส่ก็ได้)</div>
              <div>👤 <b>สมชาย</b> — ชื่อลูกค้า (พิมพ์แค่ท่อนกลางก็เจอ เช่น พิมพ์ "สมชาย" หา "ร้านสมชายสปอร์ต")</div>
            </div>
          )}

          {res && total === 0 && !busy && (
            <div style={{ padding: "26px 18px", textAlign: "center", fontSize: 13, color: T.muted }}>
              ไม่พบอะไรที่ตรงกับ "{term}"
              {res.kind === "name" && <div style={{ marginTop: 8, fontSize: 12, color: T.amber }}>ลองพิมพ์อย่างน้อย 3 ตัวอักษร หรือค้นด้วยเบอร์โทรแทน</div>}
            </div>
          )}

          {res?.orders.length > 0 && (
            <Group title={`📦 ใบสั่งของ (${res.orders.length})`}>
              {res.orders.map(o => (
                <Row key={o.id} onClick={() => pick(onOpenOrder, o)}
                  no={o.orderNo} name={o.customerName} date={o.date}
                  right={`${qtyOf(o).toLocaleString("th-TH")} ชิ้น`}
                  tag={o.invoiceNo ? `ออกบิลแล้ว · ${o.invoiceNo}` : ""} tagColor={T.green} />
              ))}
            </Group>
          )}

          {res?.invoices.length > 0 && (
            <Group title={`🧾 บิล (${res.invoices.length})`}>
              {res.invoices.map(inv => (
                <Row key={inv.id} onClick={() => pick(onOpenInvoice, inv)}
                  no={inv.invoiceNo} name={inv.customerName} date={inv.date}
                  right={baht(inv.total)} tag={inv.status || ""} tagColor={T.accent} />
              ))}
            </Group>
          )}

          {res?.customers.length > 0 && (
            <Group title={`👤 ลูกค้า (${res.customers.length})`}>
              {res.customers.map(c => (
                <Row key={c.id} onClick={() => pick(onOpenCustomer, c)}
                  no={c.phone || "—"} name={c.name} date={c.address || ""} right="" />
              ))}
            </Group>
          )}
        </div>

        <div style={{ padding: "8px 14px", borderTop: `1px solid ${T.border}`, fontSize: 11, color: T.muted, display: "flex", justifyContent: "space-between" }}>
          <span>Esc = ปิด</span>
          <span>Ctrl + K เปิดได้ทุกหน้า</span>
        </div>
      </div>
    </div>
  );
}

function Group({ title, children }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ padding: "6px 10px", fontSize: 11, fontWeight: 700, color: T.sub, letterSpacing: 0.3 }}>{title}</div>
      <div style={{ display: "flex", flexDirection: "column" }}>{children}</div>
    </div>
  );
}

function Row({ no, name, date, right, tag, tagColor, onClick }) {
  return (
    <div onClick={onClick}
      onMouseEnter={e => e.currentTarget.style.background = "rgba(59,91,139,0.07)"}
      onMouseLeave={e => e.currentTarget.style.background = "transparent"}
      style={{ display: "grid", gridTemplateColumns: "120px 1fr auto", gap: 10, alignItems: "center", padding: "10px 12px", borderRadius: 9, cursor: "pointer" }}>
      <span style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 700, color: T.accent }}>{no}</span>
      <span style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name || "—"}</div>
        <div style={{ fontSize: 11, color: T.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {date}{tag ? <b style={{ color: tagColor, marginLeft: 8 }}>{tag}</b> : null}
        </div>
      </span>
      <span style={{ fontSize: 12, fontWeight: 700, color: T.sub, fontFamily: "monospace" }}>{right}</span>
    </div>
  );
}
