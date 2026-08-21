// 📦 รอบแพ็ค — สำหรับลูกค้าที่ขายบนแพลตฟอร์ม (Shopee/Lazada/TikTok)
//
// งานจริงที่หน้าโต๊ะแพ็ค: หยิบใบปะหน้าของลูกค้าขึ้นมา → อ่านว่าต้องแพ็คอะไร → หยิบของ → แปะป้าย → โยนกล่อง
// สิ่งที่ระบบต้องช่วยคือ "นับ" ให้ ไม่ใช่ให้คีย์ใบสั่ง 200 ใบ
//
// วิธีใช้: เลือกลูกค้า → เปิดรอบ → แตะไซส์ทีละกล่องระหว่างแพ็ค (หรือสแกนบาร์โค้ดรุ่น+สีก่อนแตะ)
//          → ปิดรอบ = ตัดสต็อกทีเดียว + ออกบิลใบเดียว
//
// ตัวเลขวิ่งสดจาก Firestore ทุกเครื่อง — แพ็คพร้อมกันหลายโต๊ะได้ ยอดไม่ตีกัน
import React from "react";
import { T } from "../theme";
import { CardBox } from "../components/ui";
import { groupRun, totalOf, runTotalValue, findByBarcode, keyOf } from "../utils/packRun";

const money = (n) => Number(n || 0).toLocaleString("th-TH", { minimumFractionDigits: 2 });

export default function PackRunTab({
  packRuns = [], customers = [], clothingItems = [], sizesFor, user, role = {},
  onOpenRun, onBump, onCloseRun, onReopenRun, onDeleteRun, onBillRun, onPrintPickList,
}) {
  const [custId, setCustId] = React.useState("");
  const [pick, setPick] = React.useState(null);      // { item, colorIdx } ที่กำลังจะแตะไซส์
  const [modelSearch, setModelSearch] = React.useState("");
  const [scan, setScan] = React.useState("");
  const [flash, setFlash] = React.useState("");      // ข้อความเด้งสั้น ๆ ตอนแตะ
  const scanRef = React.useRef(null);
  const flashTimer = React.useRef(null);

  const canEdit = role.canAdd !== false;

  const open = React.useMemo(() => packRuns.filter(r => r.status !== "ปิดแล้ว"), [packRuns]);
  const closed = React.useMemo(() => packRuns.filter(r => r.status === "ปิดแล้ว"), [packRuns]);
  // รอบที่กำลังทำของลูกค้าที่เลือก — 1 ลูกค้ามีรอบเปิดได้ทีละรอบ กันยอดกระจัดกระจาย
  const run = React.useMemo(() => open.find(r => r.customerId === custId) || null, [open, custId]);

  const say = (msg) => {
    setFlash(msg);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(""), 1600);
  };

  // ต้องเป็น useMemo — ไม่งั้น array ใหม่ทุก render แล้ว groupRun คิดใหม่ทุกครั้งที่กดปุ่มใด ๆ
  const sizes = React.useMemo(
    () => (pick && sizesFor ? sizesFor(pick.item) : []),
    [pick, sizesFor]
  );
  const groups = React.useMemo(() => groupRun(run, sizes), [run, sizes]);
  const total = totalOf(run);
  const value = runTotalValue(run);

  const models = React.useMemo(() => {
    const q = modelSearch.trim().toLowerCase();
    const list = clothingItems.filter(c => (c.colors || []).length > 0);
    if (!q) return list.slice(0, 40);
    return list.filter(c => String(c.model || c.name || "").toLowerCase().includes(q)).slice(0, 40);
  }, [clothingItems, modelSearch]);

  // ⌨️ เครื่องสแกนพิมพ์รหัสแล้วเคาะ Enter — จับที่ Enter ไม่ใช่ทุกตัวอักษร
  const onScanKey = (e) => {
    if (e.key !== "Enter") return;
    const hit = findByBarcode(clothingItems, scan);
    setScan("");
    if (!hit) { say("❌ ไม่พบบาร์โค้ดนี้"); return; }
    setPick(hit);
    say(`✅ ${hit.item.model || hit.item.name} · ${hit.item.colors[hit.colorIdx]?.colorName || ""} — แตะไซส์ได้เลย`);
  };

  const bump = (size, delta) => {
    if (!run || !pick) return;
    const col = pick.item.colors?.[pick.colorIdx] || {};
    onBump(run, {
      clothingId: pick.item.id,
      clothingName: pick.item.model || pick.item.name || "",
      colorIdx: pick.colorIdx,
      colorName: col.colorName || "",
      colorHex: col.colorHex || col.hex || "",
      size,
    }, delta);
    if (delta > 0) say(`+1 ${pick.item.model || ""} ${col.colorName || ""} ${size}`);
  };

  const qtyOfSize = (size) => {
    if (!run || !pick) return 0;
    return Number((run.counts || {})[keyOf(pick.item.id, pick.colorIdx, size)]) || 0;
  };

  const Btn = ({ onClick, children, style = {}, ...rest }) => (
    <button onClick={onClick} {...rest}
      style={{ padding: "8px 14px", borderRadius: 9, border: `1px solid ${T.border}`, background: "white", color: T.sub, cursor: "pointer", fontSize: 13, fontFamily: "'Sarabun',sans-serif", ...style }}>
      {children}
    </button>
  );

  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: T.text }}>📦 รอบแพ็ค</div>
        <div style={{ fontSize: 12, color: T.muted, marginTop: 4, lineHeight: 1.7 }}>
          สำหรับลูกค้าที่ขายบนแพลตฟอร์มแล้วส่งงานมาให้แพ็คทีละชิ้น — นับระหว่างแพ็ค ไม่ต้องคีย์ใบสั่งทีละใบ
          <br/>ปิดรอบครั้งเดียว = ตัดสต็อกทีเดียว + ออกบิลใบเดียว
        </div>
      </div>

      {/* เลือกลูกค้า */}
      <CardBox style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <select value={custId} onChange={e => { setCustId(e.target.value); setPick(null); }}
            style={{ flex: "1 1 260px", padding: "9px 12px", borderRadius: 9, border: `1px solid ${T.border}`, fontSize: 13, fontFamily: "inherit" }}>
            <option value="">— เลือกลูกค้า —</option>
            {customers.map(c => {
              const r = open.find(x => x.customerId === c.id);
              return <option key={c.id} value={c.id}>{c.name}{r ? `  ● กำลังแพ็ค ${totalOf(r)} ชิ้น` : ""}</option>;
            })}
          </select>
          {custId && !run && canEdit && (
            <Btn onClick={() => onOpenRun(customers.find(c => c.id === custId))}
              style={{ background: "linear-gradient(135deg,#3b5b8b,#3b5b8b)", color: "white", border: "none", fontWeight: 600 }}>
              ➕ เปิดรอบใหม่
            </Btn>
          )}
          {open.length > 0 && (
            <div style={{ fontSize: 11, color: T.muted, marginLeft: "auto" }}>
              กำลังแพ็คอยู่ {open.length} เจ้า · รวม {open.reduce((s, r) => s + totalOf(r), 0).toLocaleString("th-TH")} ชิ้น
            </div>
          )}
        </div>
      </CardBox>

      {!custId && (
        <div style={{ padding: 30, textAlign: "center", color: T.muted, fontSize: 13, background: T.card, border: `1px solid ${T.border}`, borderRadius: 10 }}>
          เลือกลูกค้าด้านบนเพื่อเริ่มแพ็ค
        </div>
      )}

      {custId && !run && (
        <div style={{ padding: 24, textAlign: "center", color: T.muted, fontSize: 13, background: T.card, border: `1px solid ${T.border}`, borderRadius: 10 }}>
          ลูกค้ารายนี้ยังไม่มีรอบที่เปิดอยู่ — กด "เปิดรอบใหม่" เพื่อเริ่มนับ
        </div>
      )}

      {run && (
        <>
          {/* แถบยอดสด */}
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", padding: "12px 16px", background: "rgba(59,91,139,0.06)", border: "1px solid rgba(59,91,139,0.25)", borderRadius: 10, marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 11, color: T.muted }}>{run.runNo} · เปิดโดย {run.openedBy || "-"} · {run.openedAt || ""}</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: T.text }}>{run.customerName}</div>
            </div>
            <div style={{ marginLeft: "auto", textAlign: "right" }}>
              <div style={{ fontSize: 26, fontWeight: 800, color: T.accent, fontFamily: "monospace", lineHeight: 1 }}>{total.toLocaleString("th-TH")}</div>
              <div style={{ fontSize: 11, color: T.muted }}>ชิ้นในรอบนี้ · ฿{money(value)}</div>
            </div>
          </div>

          {flash && (
            <div style={{ padding: "8px 14px", borderRadius: 9, marginBottom: 10, fontSize: 13, fontWeight: 600,
              background: flash.startsWith("❌") ? "#fef2f2" : "rgba(16,185,129,0.1)",
              color: flash.startsWith("❌") ? T.red : "#047857",
              border: `1px solid ${flash.startsWith("❌") ? "#fecaca" : "rgba(16,185,129,0.3)"}` }}>
              {flash}
            </div>
          )}

          {canEdit && (
            <CardBox style={{ marginBottom: 12 }}>
              {/* สแกน */}
              <input ref={scanRef} value={scan} onChange={e => setScan(e.target.value)} onKeyDown={onScanKey}
                placeholder="🔫 สแกนบาร์โค้ดรุ่น+สี แล้วแตะไซส์ (หรือเลือกรุ่นเองด้านล่าง)"
                style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: 9, border: `2px solid ${T.accent}40`, fontSize: 14, fontFamily: "inherit", outline: "none", marginBottom: 10 }}/>

              {/* เลือกรุ่น → สี */}
              <input value={modelSearch} onChange={e => setModelSearch(e.target.value)} placeholder="🔍 พิมพ์ชื่อรุ่นเพื่อกรอง"
                style={{ width: "100%", boxSizing: "border-box", padding: "7px 11px", borderRadius: 8, border: `1px solid ${T.border}`, fontSize: 12, fontFamily: "inherit", outline: "none", marginBottom: 8 }}/>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5, maxHeight: 120, overflowY: "auto", marginBottom: 10 }}>
                {models.flatMap(item => (item.colors || []).map((col, ci) => {
                  const on = pick && pick.item.id === item.id && pick.colorIdx === ci;
                  return (
                    <button key={`${item.id}-${ci}`} onClick={() => setPick({ item, colorIdx: ci })}
                      style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 10px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontFamily: "inherit",
                        border: on ? `2px solid ${T.accent}` : `1px solid ${T.border}`, background: on ? "rgba(59,91,139,0.08)" : "white", color: T.text, fontWeight: on ? 700 : 400 }}>
                      <span style={{ width: 9, height: 9, borderRadius: 3, background: col.colorHex || col.hex || "#ccc", border: "1px solid rgba(0,0,0,0.15)" }}/>
                      {item.model || item.name} · {col.colorName}
                    </button>
                  );
                }))}
              </div>

              {/* แตะไซส์ = +1 */}
              {pick ? (
                <div>
                  <div style={{ fontSize: 12, color: T.sub, marginBottom: 6 }}>
                    แตะไซส์เพื่อ <b>+1</b> · คลิกขวาเพื่อ −1 — <b>{pick.item.model || pick.item.name}</b> · {pick.item.colors?.[pick.colorIdx]?.colorName}
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {sizes.map(sz => {
                      const q = qtyOfSize(sz);
                      return (
                        <button key={sz} onClick={() => bump(sz, 1)}
                          onContextMenu={e => { e.preventDefault(); if (q > 0) bump(sz, -1); }}
                          style={{ minWidth: 62, padding: "12px 8px", borderRadius: 10, cursor: "pointer", fontFamily: "'Sarabun',sans-serif",
                            border: q > 0 ? `2px solid ${T.accent}` : `1px solid ${T.border}`,
                            background: q > 0 ? "rgba(59,91,139,0.1)" : "white" }}>
                          <div style={{ fontSize: 14, fontWeight: 700, color: T.text, fontFamily: "monospace" }}>{sz}</div>
                          <div style={{ fontSize: 15, fontWeight: 800, color: q > 0 ? T.accent : T.border, fontFamily: "monospace" }}>{q}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: 12, color: T.muted, padding: "8px 0" }}>สแกนบาร์โค้ด หรือเลือกรุ่น+สีด้านบนก่อน แล้วปุ่มไซส์จะขึ้นมาให้แตะ</div>
              )}
            </CardBox>
          )}

          {/* ยอดสะสมในรอบ */}
          <CardBox style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>ยอดสะสมในรอบ</div>
              <div style={{ display: "flex", gap: 8 }}>
                <Btn onClick={() => onPrintPickList?.(run)}>🖨️ ใบหยิบของ</Btn>
                {canEdit && <Btn onClick={() => onCloseRun(run)} style={{ background: "linear-gradient(135deg,#d97706,#b45309)", color: "white", border: "none", fontWeight: 600 }}>
                  ✅ ปิดรอบ + ตัดสต็อก
                </Btn>}
              </div>
            </div>
            {groups.length === 0 ? (
              <div style={{ padding: 20, textAlign: "center", color: T.muted, fontSize: 13 }}>ยังไม่ได้นับอะไรในรอบนี้</div>
            ) : groups.map(g => (
              <div key={g.key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: `1px solid ${T.border}`, flexWrap: "wrap" }}>
                <span style={{ width: 10, height: 10, borderRadius: 3, background: g.colorHex || "#ccc", border: "1px solid rgba(0,0,0,0.15)", flexShrink: 0 }}/>
                <div style={{ fontSize: 13, fontWeight: 600, color: T.text, minWidth: 150 }}>{g.clothingName} · {g.colorName}</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, flex: 1 }}>
                  {g.sizes.map(s => (
                    <span key={s.key} style={{ padding: "2px 8px", borderRadius: 7, background: "rgba(59,91,139,0.08)", fontSize: 12, fontFamily: "monospace", color: T.text }}>
                      {s.size} <b style={{ color: T.accent }}>{s.qty}</b>
                    </span>
                  ))}
                </div>
                <div style={{ fontSize: 14, fontWeight: 800, color: T.accent, fontFamily: "monospace", whiteSpace: "nowrap" }}>{g.qty} ชิ้น</div>
              </div>
            ))}
          </CardBox>
        </>
      )}

      {/* รอบที่ปิดแล้ว */}
      {closed.length > 0 && (
        <CardBox>
          <div style={{ fontSize: 13, fontWeight: 700, color: T.text, marginBottom: 8 }}>รอบที่ปิดแล้ว ({closed.length})</div>
          {closed.slice(0, 30).map(r => (
            <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: `1px solid ${T.border}`, flexWrap: "wrap", fontSize: 12 }}>
              <span style={{ fontFamily: "monospace", fontWeight: 700, color: T.accent }}>{r.runNo}</span>
              <span style={{ fontWeight: 600, color: T.text }}>{r.customerName}</span>
              <span style={{ color: T.muted }}>{r.closedAt || r.openedAt}</span>
              <span style={{ fontFamily: "monospace", color: T.text }}>{totalOf(r).toLocaleString("th-TH")} ชิ้น</span>
              <span style={{ fontFamily: "monospace", color: T.green }}>฿{money(runTotalValue(r))}</span>
              {r.invoiceNo
                ? <span style={{ color: T.accent }}>🧾 {r.invoiceNo}</span>
                : <span style={{ color: T.amber }}>ยังไม่ออกบิล</span>}
              <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                <Btn onClick={() => onPrintPickList?.(r)} style={{ padding: "3px 10px", fontSize: 11 }}>🖨️</Btn>
                {canEdit && !r.invoiceNo && <Btn onClick={() => onBillRun(r)} style={{ padding: "3px 10px", fontSize: 11, color: T.accent, borderColor: "rgba(59,91,139,0.4)" }}>🧾 ออกบิล</Btn>}
                {user?.role === "admin" && !r.invoiceNo && <Btn onClick={() => onReopenRun(r)} style={{ padding: "3px 10px", fontSize: 11 }} title="เปิดรอบกลับมาแก้ (คืนสต็อกที่ตัดไป)">↩️</Btn>}
              </div>
            </div>
          ))}
        </CardBox>
      )}
    </div>
  );
}
