// 🚫 ของไม่เจอตอนจัด — ติ๊กว่าอะไรหยิบไม่เจอ แล้วตัดออกจากรอบ
//
// บิลรอบแพ็คสร้างจากยอดในรอบตรง ๆ ถ้าหยิบไม่เจอแล้วไม่ตัดออก ลูกค้าโดนเก็บเงินของที่ไม่ได้ส่ง
// หน้าต่างนี้ให้คนจัดของบอกได้เลยตรงหน้าชั้น ไม่ต้องรอ admin มาเปิดรอบกลับ
//
// ออกแบบให้กดบนแท็บเล็ต (เหมือนหน้ารอบแพ็ค): ปุ่ม − / + ใหญ่ และ "ไม่เจอทั้งหมด" แตะเดียวจบ
import React from "react";
import { T, sizeRank } from "../theme";
import { Modal, MHead, BtnPrimary, BtnGhost } from "./ui";
import { groupRun, planMissing, missingOf } from "../utils/packRun";

const fmt = (n) => Number(n || 0).toLocaleString("th-TH");

export default function PackMissingModal({ run, onSave, onClose }) {
  const [marks, setMarks] = React.useState({});
  const [q, setQ] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const groups = React.useMemo(() => {
    const gs = groupRun(run);
    // ไซส์เรียงเล็ก→ใหญ่ ให้ตรงกับใบหยิบของที่ถืออยู่ในมือ
    gs.forEach(g => g.sizes.sort((a, b) => sizeRank(a.size) - sizeRank(b.size)));
    return gs;
  }, [run]);

  const shown = React.useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return groups;
    return groups.filter(g => `${g.clothingName} ${g.colorName}`.toLowerCase().includes(t));
  }, [groups, q]);

  const plan = React.useMemo(() => planMissing(run, marks), [run, marks]);
  const before = missingOf(run);

  const setN = (key, max, v) => setMarks(m => {
    const n = Math.max(0, Math.min(max, Math.floor(Number(v) || 0)));
    const x = { ...m };
    if (n > 0) x[key] = n; else delete x[key];
    return x;
  });

  const save = async () => {
    if (plan.total <= 0 || busy) return;
    const NL = String.fromCharCode(10);
    const list = plan.lines.slice(0, 12).map(l => `• ${l.clothingName} ${l.colorName} ${l.size} × ${l.n}`).join(NL) +
      (plan.lines.length > 12 ? NL + `… และอีก ${plan.lines.length - 12} รายการ` : "");
    if (!window.confirm(
      `ตัดของที่ไม่เจอออกจากรอบ ${run.runNo} รวม ${fmt(plan.total)} ชิ้น?` + NL + NL + list + NL + NL +
      "ของพวกนี้จะไม่อยู่ในบิลที่ออกจากรอบนี้" +
      (plan.restoreTotal > 0 ? NL + `สต๊อกที่ตัดไปแล้ว ${fmt(plan.restoreTotal)} ชิ้นจะคืนเข้าคลังให้` : "")
    )) return;
    setBusy(true);
    const ok = await onSave(marks);
    setBusy(false);
    if (ok) onClose();
  };

  const btn = (on) => ({
    width: 34, height: 34, borderRadius: 8, border: `1px solid ${on ? "#dc2626" : T.border}`,
    background: on ? "rgba(220,38,38,0.08)" : "white", color: on ? "#dc2626" : T.sub,
    fontSize: 17, fontWeight: 800, cursor: "pointer", fontFamily: "inherit", lineHeight: 1,
  });

  return (
    <Modal onClose={busy ? () => {} : onClose} w={720}>
      <MHead title="🚫 ของไม่เจอ — ตัดออกจากรอบ"
        sub={`${run.runNo} · ${run.customerName} · ของที่ตัดออกจะไม่ไปอยู่ในบิล`}
        onClose={busy ? () => {} : onClose} color="#dc2626"/>

      {before > 0 && (
        <div style={{ fontSize: 11.5, color: T.sub, marginBottom: 10 }}>
          รอบนี้เคยตัดออกเพราะหาไม่เจอไปแล้ว <b>{fmt(before)}</b> ชิ้น (ยอดด้านล่างคือที่เหลืออยู่ในรอบตอนนี้)
        </div>
      )}

      {groups.length > 6 && (
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="🔍 ค้นรุ่น / สี"
          style={{ width: "100%", boxSizing: "border-box", marginBottom: 10, background: T.input, border: `1px solid ${T.inputBorder}`,
            color: T.text, borderRadius: 8, padding: "8px 12px", fontFamily: "'Sarabun',sans-serif", fontSize: 13, outline: "none" }}/>
      )}

      <div className="scroll-col" style={{ maxHeight: "52vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
        {shown.length === 0 && <div style={{ padding: 24, textAlign: "center", color: T.muted, fontSize: 13 }}>ไม่มีรายการ</div>}
        {shown.map(g => (
          <div key={g.key} style={{ border: `1px solid ${T.border}`, borderRadius: 10, padding: "8px 10px", background: "white" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <span style={{ width: 12, height: 12, borderRadius: 3, background: g.colorHex || "#ccc", border: "1px solid rgba(0,0,0,0.15)", flexShrink: 0 }}/>
              <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>{g.clothingName}</span>
              <span style={{ fontSize: 12.5, color: T.sub }}>{g.colorName}</span>
              <span style={{ marginLeft: "auto", fontSize: 11, color: T.muted, fontFamily: "monospace" }}>{fmt(g.qty)} ชิ้น</span>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {g.sizes.map(sz => {
                const n = marks[sz.key] || 0;
                return (
                  <div key={sz.key} style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 7px", borderRadius: 9,
                    border: `1px solid ${n ? "rgba(220,38,38,0.45)" : T.border}`, background: n ? "rgba(220,38,38,0.05)" : "#f8fafc" }}>
                    <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.15, minWidth: 40 }}>
                      <span style={{ fontSize: 13, fontWeight: 800, fontFamily: "monospace", color: T.text }}>{sz.size}</span>
                      <span style={{ fontSize: 10, color: T.muted }}>มี {fmt(sz.qty)}</span>
                    </div>
                    <button type="button" onClick={() => setN(sz.key, sz.qty, n - 1)} disabled={!n} style={{ ...btn(false), opacity: n ? 1 : 0.35 }}>−</button>
                    <input type="number" min="0" max={sz.qty} value={n || ""} placeholder="0"
                      onChange={e => setN(sz.key, sz.qty, e.target.value)} onFocus={e => e.target.select()}
                      style={{ width: 44, height: 34, boxSizing: "border-box", textAlign: "center", borderRadius: 8, border: `1px solid ${T.inputBorder}`,
                        fontFamily: "monospace", fontSize: 14, fontWeight: 800, color: n ? "#dc2626" : T.text, outline: "none" }}/>
                    <button type="button" onClick={() => setN(sz.key, sz.qty, n + 1)} disabled={n >= sz.qty} style={{ ...btn(n > 0), opacity: n >= sz.qty ? 0.35 : 1 }}>+</button>
                    <button type="button" onClick={() => setN(sz.key, sz.qty, n >= sz.qty ? 0 : sz.qty)}
                      title={n >= sz.qty ? "ยกเลิก" : "ไซส์นี้ไม่เจอเลยทั้งหมด"}
                      style={{ height: 34, padding: "0 8px", borderRadius: 8, border: `1px solid ${n >= sz.qty ? "#dc2626" : T.border}`,
                        background: n >= sz.qty ? "#dc2626" : "white", color: n >= sz.qty ? "white" : T.sub,
                        fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>
                      {n >= sz.qty ? "✓ ไม่เจอทั้งหมด" : "ไม่เจอทั้งหมด"}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div style={{ padding: "9px 12px", borderRadius: 9, marginBottom: 12, fontSize: 12.5,
        background: plan.total ? "rgba(220,38,38,0.06)" : "#f8fafc", border: `1px solid ${plan.total ? "rgba(220,38,38,0.3)" : T.border}`,
        color: plan.total ? "#991b1b" : T.muted }}>
        {plan.total
          ? <>ตัดออก <b>{fmt(plan.total)}</b> ชิ้น จาก {plan.lines.length} รายการ — จะไม่อยู่ในบิล
              {plan.restoreTotal > 0 && <> · สต๊อกที่ตัดไปแล้ว <b>{fmt(plan.restoreTotal)}</b> ชิ้นคืนเข้าคลังให้</>}</>
          : "แตะ + หรือ \"ไม่เจอทั้งหมด\" ที่ไซส์ที่หยิบไม่เจอ"}
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <BtnGhost onClick={onClose} disabled={busy} style={{ flex: 1 }}>ยกเลิก</BtnGhost>
        <BtnPrimary onClick={save} disabled={busy || !plan.total}
          style={{ flex: 2, background: plan.total ? "#dc2626" : undefined, opacity: (busy || !plan.total) ? 0.5 : 1 }}>
          {busy ? "กำลังบันทึก..." : plan.total ? `🚫 ตัดออก ${fmt(plan.total)} ชิ้น` : "ยังไม่ได้เลือก"}
        </BtnPrimary>
      </div>
    </Modal>
  );
}
