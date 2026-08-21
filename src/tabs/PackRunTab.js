// 📦 รอบแพ็ค — สำหรับลูกค้าที่ขายบนแพลตฟอร์ม (Shopee/Lazada/TikTok)
//
// งานจริงที่โต๊ะแพ็ค: หยิบใบปะหน้าของลูกค้าขึ้นมา → อ่านว่าต้องแพ็คอะไร → หยิบของ → แปะป้าย → โยนกล่อง
// สิ่งที่ระบบต้องช่วยคือ "นับ" ให้ ไม่ใช่ให้คีย์ใบสั่ง 200 ใบ
//
// 🖐️ ออกแบบให้กดด้วยนิ้วบนแท็บเล็ตเป็นหลัก:
//   · ในรอบหนึ่งมักวนอยู่ไม่กี่รุ่น+สี → ดัน "ที่ใช้ในรอบนี้แล้ว" ขึ้นบนสุด แตะครั้งเดียวเลือกได้
//     (รอบแรกที่ทำ เทรุ่น×สีทุกคู่ลงกล่องเตี้ย ๆ กล่องเดียว — หาไม่เจอ ใช้งานจริงไม่ไหว)
//   · เลือกรุ่นก่อน แล้วค่อยเลือกสีของรุ่นนั้น — ตัวเลือกในแต่ละขั้นเหลือน้อยลงมาก
//   · ปุ่มลบ 1 เป็นปุ่มจริงที่มองเห็น ไม่ใช่คลิกขวา — แท็บเล็ตคลิกขวาไม่ได้
//   · ปุ่มไซส์ทำใหญ่ ให้แตะรัว ๆ ตอนแพ็คได้ไม่พลาด
//
// ตัวเลขวิ่งสดจาก Firestore ทุกเครื่อง — แพ็คพร้อมกันหลายโต๊ะได้ ยอดไม่ตีกัน
import React from "react";
import { T } from "../theme";
import { CardBox } from "../components/ui";
import { groupRun, totalOf, runTotalValue, findByBarcode, keyOf } from "../utils/packRun";

const money = (n) => Number(n || 0).toLocaleString("th-TH", { minimumFractionDigits: 2 });
const colorOf = (col) => col?.colorHex || col?.hex || "#ccc";

export default function PackRunTab({
  packRuns = [], customers = [], clothingItems = [], sizesFor, user, role = {},
  onOpenRun, onBump, onCloseRun, onReopenRun, onCancelRun, onBillRun, onPrintPickList,
}) {
  const [custId, setCustId] = React.useState("");
  const [model, setModel] = React.useState(null);    // รุ่นที่เลือกอยู่ (ขั้นที่ 1)
  const [pick, setPick] = React.useState(null);      // { item, colorIdx } พร้อมแตะไซส์ (ขั้นที่ 2)
  const [modelSearch, setModelSearch] = React.useState("");
  const [scan, setScan] = React.useState("");
  const [editSize, setEditSize] = React.useState(null);   // ไซส์ที่กำลังพิมพ์จำนวนทับ
  const [flash, setFlash] = React.useState("");
  const flashTimer = React.useRef(null);

  const canEdit = role.canAdd !== false;

  // 🔫 ช่องสแกนจะโผล่ก็ต่อเมื่อมีบาร์โค้ดในคลังจริง
  //    ตอนนี้ยังไม่มีสีไหนมีบาร์โค้ดเลย (ระบบไม่เคยเขียนค่าลง colors[].barcode)
  //    โชว์ช่องที่สแกนแล้วไม่มีวันเจอ = หลอกให้พนักงานลองแล้วงง
  //    พอสร้างบาร์โค้ดจริงเมื่อไหร่ ช่องนี้จะกลับมาเอง ไม่ต้องแก้โค้ดอีก
  const hasAnyBarcode = React.useMemo(
    () => clothingItems.some(c => (c.colors || []).some(col => col.barcode)),
    [clothingItems]
  );

  const open = React.useMemo(() => packRuns.filter(r => r.status !== "ปิดแล้ว"), [packRuns]);
  const closed = React.useMemo(() => packRuns.filter(r => r.status === "ปิดแล้ว"), [packRuns]);
  const run = React.useMemo(() => open.find(r => r.customerId === custId) || null, [open, custId]);

  const say = (msg) => {
    setFlash(msg);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(""), 1500);
  };
  React.useEffect(() => () => clearTimeout(flashTimer.current), []);

  const sizes = React.useMemo(() => (pick && sizesFor ? sizesFor(pick.item) : []), [pick, sizesFor]);
  const groups = React.useMemo(() => groupRun(run, sizes), [run, sizes]);
  const total = totalOf(run);
  const value = runTotalValue(run);

  // ⭐ รุ่น+สี ที่ใช้ในรอบนี้ไปแล้ว — เรียงจากใช้เยอะสุด แตะครั้งเดียวกลับมาใช้ต่อ
  //    หลังแพ็คไปไม่กี่กล่อง แถวนี้จะครอบคลุมเกือบทุกอย่างที่ต้องกดในรอบ
  const recent = React.useMemo(() => {
    if (!run) return [];
    const by = new Map();
    Object.entries(run.counts || {}).forEach(([k, qty]) => {
      const q = Number(qty) || 0;
      if (q <= 0) return;
      const m = (run.meta || {})[k];
      if (!m) return;
      const gk = `${m.clothingId}|${m.colorIdx}`;
      if (!by.has(gk)) by.set(gk, { ...m, qty: 0 });
      by.get(gk).qty += q;
    });
    return [...by.values()]
      .map(m => ({ ...m, item: clothingItems.find(c => c.id === m.clothingId) }))
      .filter(m => m.item)
      .sort((a, b) => b.qty - a.qty);
  }, [run, clothingItems]);

  const models = React.useMemo(() => {
    const q = modelSearch.trim().toLowerCase();
    const list = clothingItems.filter(c => (c.colors || []).length > 0);
    if (!q) return list;
    return list.filter(c => String(c.model || c.name || "").toLowerCase().includes(q));
  }, [clothingItems, modelSearch]);

  const choose = (item, colorIdx) => {
    setModel(item);
    setPick({ item, colorIdx });
  };

  // เครื่องสแกนพิมพ์รหัสแล้วเคาะ Enter — จับที่ Enter ไม่ใช่ทุกตัวอักษร
  const onScanKey = (e) => {
    if (e.key !== "Enter") return;
    const hit = findByBarcode(clothingItems, scan);
    setScan("");
    if (!hit) { say("❌ ไม่พบบาร์โค้ดนี้"); return; }
    choose(hit.item, hit.colorIdx);
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
      colorHex: colorOf(col),
      size,
    }, delta);
    say(`${delta > 0 ? "+" : "−"}${Math.abs(delta)}  ${pick.item.model || ""} ${col.colorName || ""} ${size}`);
  };

  const qtyOfSize = (size) =>
    (run && pick) ? (Number((run.counts || {})[keyOf(pick.item.id, pick.colorIdx, size)]) || 0) : 0;

  // ✍️ พิมพ์จำนวนทับไปเลย — แยกใบเป็นกองตามแบบแล้วนับได้ 40 ก็พิมพ์ 40 ทีเดียว
  //    ไม่ใช้ "ตัวคูณ" ที่ค้างไว้ เพราะลืมรีเซ็ตแล้วยอดพุ่งโดยไม่รู้ตัว
  //    วิธีนี้ไม่มีโหมดค้าง และใช้แก้ยอดที่นับผิดได้ด้วยในตัว
  const setSizeQty = (size, raw) => {
    const target = Math.max(0, Math.floor(Number(raw)));
    if (!Number.isFinite(target)) { setEditSize(null); return; }
    const delta = target - qtyOfSize(size);
    if (delta !== 0) bump(size, delta);
    setEditSize(null);
  };

  const Btn = ({ children, style = {}, ...rest }) => (
    <button {...rest}
      style={{ padding: "8px 14px", borderRadius: 9, border: `1px solid ${T.border}`, background: "white", color: T.sub, cursor: "pointer", fontSize: 13, fontFamily: "'Sarabun',sans-serif", ...style }}>
      {children}
    </button>
  );

  // ชิปรุ่น+สี ใช้ทั้งแถว "ใช้ในรอบนี้แล้ว" และแถวเลือกสี
  const ComboChip = ({ item, colorIdx, qty, big }) => {
    const col = item.colors?.[colorIdx] || {};
    const on = pick && pick.item.id === item.id && pick.colorIdx === colorIdx;
    return (
      <button onClick={() => choose(item, colorIdx)}
        style={{ display: "flex", alignItems: "center", gap: 7, padding: big ? "10px 14px" : "8px 12px", borderRadius: 10, cursor: "pointer",
          fontSize: big ? 14 : 13, fontFamily: "'Sarabun',sans-serif", fontWeight: on ? 800 : 500,
          border: on ? `2px solid ${T.accent}` : `1px solid ${T.border}`,
          background: on ? "rgba(59,91,139,0.12)" : "white", color: T.text }}>
        <span style={{ width: 14, height: 14, borderRadius: 4, background: colorOf(col), border: "1px solid rgba(0,0,0,0.2)", flexShrink: 0 }}/>
        <span>{item.model || item.name} · {col.colorName}</span>
        {qty > 0 && <span style={{ fontFamily: "monospace", fontWeight: 800, color: T.accent }}>{qty}</span>}
      </button>
    );
  };

  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: T.text }}>📦 รอบแพ็ค</div>
        <div style={{ fontSize: 12, color: T.muted, marginTop: 4, lineHeight: 1.7 }}>
          สำหรับลูกค้าที่ขายบนแพลตฟอร์มแล้วส่งงานมาให้แพ็คทีละชิ้น — นับระหว่างแพ็ค ไม่ต้องคีย์ใบสั่งทีละใบ
          <br/>ปิดรอบครั้งเดียว = ตัดสต็อกทีเดียว + ออกบิลใบเดียว
        </div>
      </div>

      <CardBox style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <select value={custId} onChange={e => { setCustId(e.target.value); setPick(null); setModel(null); }}
            style={{ flex: "1 1 260px", padding: "10px 12px", borderRadius: 9, border: `1px solid ${T.border}`, fontSize: 14, fontFamily: "inherit" }}>
            <option value="">— เลือกลูกค้า —</option>
            {customers.map(c => {
              const r = open.find(x => x.customerId === c.id);
              return <option key={c.id} value={c.id}>{c.name}{r ? `  ● กำลังแพ็ค ${totalOf(r)} ชิ้น` : ""}</option>;
            })}
          </select>
          {custId && !run && canEdit && (
            <Btn onClick={() => onOpenRun(customers.find(c => c.id === custId))}
              style={{ background: "linear-gradient(135deg,#3b5b8b,#3b5b8b)", color: "white", border: "none", fontWeight: 700, fontSize: 14 }}>
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
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", padding: "12px 16px", background: "rgba(59,91,139,0.06)", border: "1px solid rgba(59,91,139,0.25)", borderRadius: 10, marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 11, color: T.muted }}>{run.runNo} · เปิดโดย {run.openedBy || "-"} · {run.openedAt || ""}</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: T.text }}>{run.customerName}</div>
            </div>
            <div style={{ marginLeft: "auto", textAlign: "right" }}>
              <div style={{ fontSize: 28, fontWeight: 800, color: T.accent, fontFamily: "monospace", lineHeight: 1 }}>{total.toLocaleString("th-TH")}</div>
              <div style={{ fontSize: 11, color: T.muted }}>ชิ้นในรอบนี้ · ฿{money(value)}</div>
            </div>
            {canEdit && (
              <Btn onClick={() => onCancelRun(run)} title="ยกเลิกรอบนี้ทิ้ง (ยังไม่ได้ตัดสต๊อก จึงไม่กระทบคลัง)"
                style={{ padding: "6px 12px", fontSize: 12, color: "#b91c1c", borderColor: "rgba(239,68,68,0.35)", background: "rgba(239,68,68,0.05)" }}>
                ✕ ยกเลิกรอบ
              </Btn>
            )}
          </div>

          {flash && (
            <div style={{ padding: "10px 14px", borderRadius: 9, marginBottom: 10, fontSize: 15, fontWeight: 700,
              background: flash.startsWith("❌") ? "#fef2f2" : "rgba(16,185,129,0.12)",
              color: flash.startsWith("❌") ? T.red : "#047857",
              border: `1px solid ${flash.startsWith("❌") ? "#fecaca" : "rgba(16,185,129,0.3)"}` }}>
              {flash}
            </div>
          )}

          {canEdit && (
            <CardBox style={{ marginBottom: 12 }}>
              {hasAnyBarcode && (
                <input value={scan} onChange={e => setScan(e.target.value)} onKeyDown={onScanKey}
                  placeholder="🔫 สแกนบาร์โค้ดรุ่น+สี"
                  style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: 9, border: `2px solid ${T.accent}40`, fontSize: 14, fontFamily: "inherit", outline: "none", marginBottom: 12 }}/>
              )}

              {/* ⭐ ที่ใช้ในรอบนี้แล้ว — ทางลัดหลัก แตะครั้งเดียว */}
              {recent.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 11, color: T.muted, fontWeight: 700, marginBottom: 6 }}>⭐ ใช้ในรอบนี้แล้ว — แตะเพื่อเลือกต่อ</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {recent.map(m => <ComboChip key={`${m.clothingId}|${m.colorIdx}`} item={m.item} colorIdx={m.colorIdx} qty={m.qty} big/>)}
                  </div>
                </div>
              )}

              {/* ขั้นที่ 1 — เลือกรุ่น */}
              <div style={{ fontSize: 11, color: T.muted, fontWeight: 700, marginBottom: 6 }}>
                {recent.length > 0 ? "หรือเลือกรุ่นใหม่" : "เลือกรุ่น"}
              </div>
              <input value={modelSearch} onChange={e => setModelSearch(e.target.value)} placeholder="🔍 พิมพ์ชื่อรุ่นเพื่อกรอง"
                style={{ width: "100%", boxSizing: "border-box", padding: "8px 11px", borderRadius: 8, border: `1px solid ${T.border}`, fontSize: 13, fontFamily: "inherit", outline: "none", marginBottom: 7 }}/>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                {models.slice(0, 30).map(it => {
                  const on = model?.id === it.id;
                  return (
                    <button key={it.id} onClick={() => { setModel(it); setPick(null); }}
                      style={{ padding: "8px 13px", borderRadius: 9, cursor: "pointer", fontSize: 13, fontFamily: "'Sarabun',sans-serif",
                        border: on ? `2px solid ${T.accent}` : `1px solid ${T.border}`,
                        background: on ? "rgba(59,91,139,0.1)" : "white", color: T.text, fontWeight: on ? 700 : 400 }}>
                      {it.model || it.name}
                      <span style={{ fontSize: 10, color: T.muted }}> ({(it.colors || []).length} สี)</span>
                    </button>
                  );
                })}
                {models.length === 0 && <span style={{ fontSize: 12, color: T.muted }}>ไม่พบรุ่นที่ตรงกับที่ค้น</span>}
                {models.length > 30 && <span style={{ fontSize: 11, color: T.muted, alignSelf: "center" }}>…อีก {models.length - 30} รุ่น — พิมพ์ค้นเพื่อกรอง</span>}
              </div>

              {/* ขั้นที่ 2 — เลือกสีของรุ่นนั้น */}
              {model && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 11, color: T.muted, fontWeight: 700, marginBottom: 6 }}>เลือกสีของ {model.model || model.name}</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {(model.colors || []).map((col, ci) => <ComboChip key={ci} item={model} colorIdx={ci}/>)}
                  </div>
                </div>
              )}

              {/* ขั้นที่ 3 — แตะไซส์ */}
              {pick ? (
                <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: 12 }}>
                  <div style={{ fontSize: 13, color: T.text, marginBottom: 8, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span style={{ width: 14, height: 14, borderRadius: 4, background: colorOf(pick.item.colors?.[pick.colorIdx]), border: "1px solid rgba(0,0,0,0.2)" }}/>
                    <b>{pick.item.model || pick.item.name} · {pick.item.colors?.[pick.colorIdx]?.colorName}</b>
                    <span style={{ color: T.muted, fontSize: 12 }}>— แตะชื่อไซส์ = +1 · แตะตัวเลข = พิมพ์จำนวนทับ · ปุ่ม − = ลบ 1</span>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {sizes.map(sz => {
                      const q = qtyOfSize(sz);
                      return (
                        <div key={sz} style={{ position: "relative" }}>
                          <div style={{ minWidth: 78, padding: "10px 8px 8px", borderRadius: 12, textAlign: "center",
                            border: q > 0 ? `2px solid ${T.accent}` : `1px solid ${T.border}`,
                            background: q > 0 ? "rgba(59,91,139,0.1)" : "white" }}>
                            {/* แตะที่ชื่อไซส์ = +1 (ทางเร็ว ใช้ตอนแพ็คทีละกล่อง) */}
                            <button onClick={() => bump(sz, 1)} title={`เพิ่ม 1 ตัวใน ${sz}`}
                              style={{ display: "block", width: "100%", border: "none", background: "none", cursor: "pointer", padding: "2px 0", fontFamily: "monospace", fontSize: 15, fontWeight: 700, color: T.text }}>
                              {sz}
                            </button>
                            {/* แตะที่ตัวเลข = พิมพ์จำนวนทับ (ใช้ตอนนับมาเป็นกองแล้ว หรือแก้ที่นับผิด) */}
                            {editSize === sz ? (
                              <input autoFocus type="number" min="0" defaultValue={q}
                                onFocus={e => e.target.select()}
                                onKeyDown={e => { if (e.key === "Enter") setSizeQty(sz, e.target.value); if (e.key === "Escape") setEditSize(null); }}
                                onBlur={e => setSizeQty(sz, e.target.value)}
                                style={{ width: 62, textAlign: "center", fontFamily: "monospace", fontSize: 19, fontWeight: 800, color: T.accent, border: `2px solid ${T.accent}`, borderRadius: 7, padding: "1px 2px", outline: "none" }}/>
                            ) : (
                              <button onClick={() => setEditSize(sz)} title="แตะเพื่อพิมพ์จำนวนทับ"
                                style={{ display: "block", width: "100%", border: "none", background: "none", cursor: "pointer", padding: "1px 0", fontFamily: "monospace", fontSize: 20, fontWeight: 800, lineHeight: 1.15, color: q > 0 ? T.accent : "#d7dbe2", textDecoration: "underline", textDecorationStyle: "dotted", textUnderlineOffset: 3 }}>
                                {q}
                              </button>
                            )}
                          </div>
                          {q > 0 && editSize !== sz && (
                            <button onClick={() => bump(sz, -1)} title={`ลบ 1 ออกจาก ${sz}`}
                              style={{ position: "absolute", top: -6, right: -6, width: 26, height: 26, borderRadius: 13, border: "1px solid rgba(239,68,68,0.4)", background: "#fff", color: "#dc2626", cursor: "pointer", fontSize: 16, fontWeight: 700, lineHeight: 1, padding: 0, boxShadow: "0 1px 4px rgba(0,0,0,0.15)" }}>−</button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: 12, color: T.muted, padding: "10px 0", borderTop: `1px solid ${T.border}` }}>
                  เลือกรุ่นแล้วเลือกสีก่อน แล้วปุ่มไซส์จะขึ้นมาให้แตะ
                </div>
              )}
            </CardBox>
          )}

          <CardBox style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>ยอดสะสมในรอบ</div>
              <div style={{ display: "flex", gap: 8 }}>
                <Btn onClick={() => onPrintPickList?.(run)}>🖨️ ใบหยิบของ</Btn>
                {canEdit && <Btn onClick={() => onCloseRun(run)} style={{ background: "linear-gradient(135deg,#d97706,#b45309)", color: "white", border: "none", fontWeight: 700 }}>
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
                {user?.role === "admin" && !r.invoiceNo && <Btn onClick={() => onReopenRun(r)} style={{ padding: "3px 10px", fontSize: 11 }} title="เปิดรอบกลับมาแก้ (คืนสต็อกที่ตัดไป)">↩️ เปิดกลับ</Btn>}
              </div>
            </div>
          ))}
        </CardBox>
      )}
    </div>
  );
}
