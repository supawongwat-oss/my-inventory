// 🧠 การจับคู่ชื่อสินค้า — ดู / แก้ / ลบ สิ่งที่เคยสอนระบบไว้
//
// ทำไมต้องมี: ตอนนำเข้าใบปะหน้า พอคนแก้แถวไหน ระบบจะ "จำ" การจับคู่นั้นไว้
// ครั้งต่อไปจะปล่อยผ่านอัตโนมัติโดยไม่ถามอีก — ซึ่งดีมากถ้าสอนถูก
// แต่ถ้าสอนผิด (เผลอกด K-11 แขนสั้น แทนแขนยาว) มันจะผิดเงียบ ๆ ตลอดไป
// ตัดสต๊อกผิดตัวและออกบิลผิดรุ่นทุกรอบ กว่าจะรู้ก็ตอนนับสต๊อกสิ้นเดือน
//
// 2 ชั้นที่เก็บไว้ (ดู utils/packImport.js):
//   p:<ชื่อสินค้า>              → รุ่นในคลัง
//   pc:<ชื่อสินค้า>##<ตัวเลือก>  → รุ่น + สี
// กุญแจถูกตัดวรรณยุกต์/ช่องว่างทิ้งเพื่อใช้เทียบ อ่านไม่ออก — จึงเก็บ text ต้นฉบับไว้แสดงแทน
// (รายการเก่าที่สอนไว้ก่อนหน้านี้ไม่มี text — แสดงกุญแจไปก่อน ยังลบทิ้งได้)
import React from "react";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase";
import { T } from "../theme";
import { Modal, MHead, BtnGhost } from "./ui";

const SHARED = "_shared";

export default function PackAliasesModal({ customer, clothingItems = [], user, onClose }) {
  const [scope, setScope] = React.useState("mine");     // mine | shared
  const [aliases, setAliases] = React.useState({});
  const [loading, setLoading] = React.useState(true);
  const [search, setSearch] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [editKey, setEditKey] = React.useState(null);

  const docId = scope === "mine" ? customer?.id : SHARED;

  React.useEffect(() => {
    if (!docId) return;
    let alive = true;
    setLoading(true);
    getDoc(doc(db, "packAliases", docId))
      .then(snap => { if (alive) setAliases(snap.exists() ? (snap.data().aliases || {}) : {}); })
      .catch(e => { if (alive) { setAliases({}); console.warn("[packAliases] อ่านไม่ได้:", e?.message || e); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [docId]);

  const save = async (next) => {
    if (!docId) return;
    setBusy(true);
    try {
      await setDoc(doc(db, "packAliases", docId),
        { aliases: next, updatedAt: serverTimestamp(), lastEditedBy: user?.name || "" }, { merge: false });
      setAliases(next);
      setEditKey(null);
    } catch (e) {
      alert("บันทึกไม่สำเร็จ: " + (e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const removeOne = (k) => {
    const a = rows.find(r => r.key === k);
    if (!window.confirm(`ลบการจับคู่นี้?\n\n${a?.label || k}\n\nครั้งหน้าที่เจอชื่อนี้ ระบบจะถามใหม่`)) return;
    const next = { ...aliases };
    delete next[k];
    // ลบชั้นรุ่นทิ้ง = ชั้นสีที่ห้อยอยู่ใต้ชื่อเดียวกันก็ไม่มีความหมายแล้ว
    if (k.startsWith("p:")) {
      const stem = k.slice(2);
      Object.keys(next).forEach(x => { if (x.startsWith(`pc:${stem}##`)) delete next[x]; });
    }
    save(next);
  };

  const repoint = (k, clothingId, colorIdx) => {
    const cur = aliases[k] || {};
    const item = clothingItems.find(c => c.id === clothingId);
    const next = {
      ...aliases,
      [k]: {
        ...cur,
        clothingId,
        ...(k.startsWith("pc:")
          ? { colorIdx, colorName: item?.colors?.[colorIdx]?.colorName || item?.colors?.[colorIdx]?.name || "" }
          : {}),
        by: user?.name || "", at: new Date().toISOString(),
      },
    };
    save(next);
  };

  // ── แปลงเป็นแถวที่อ่านได้ ──
  const rows = React.useMemo(() => {
    const nameOf = (id) => clothingItems.find(c => c.id === id)?.model
      || clothingItems.find(c => c.id === id)?.name || "(รุ่นที่ถูกลบไปแล้ว)";
    const out = Object.entries(aliases).map(([key, v]) => {
      const isColor = key.startsWith("pc:");
      const label = v?.text
        ? (isColor && v.optionText ? `${v.text} · ${v.optionText}` : v.text)
        : key.replace(/^pc?:/, "");
      const item = clothingItems.find(c => c.id === v?.clothingId);
      const col = isColor && v?.colorIdx != null ? item?.colors?.[v.colorIdx] : null;
      return {
        key, isColor, label,
        raw: !v?.text,                                   // รายการเก่า ไม่มีข้อความต้นฉบับ
        clothingId: v?.clothingId || "",
        colorIdx: v?.colorIdx ?? null,
        target: nameOf(v?.clothingId),
        colorName: col ? (col.colorName || col.name || "") : (v?.colorName || ""),
        colorHex: col?.colorHex || col?.hex || "",
        missing: !!v?.clothingId && !item,               // ชี้ไปหารุ่นที่ไม่มีแล้ว
        by: v?.by || "", at: (v?.at || "").slice(0, 10),
      };
    });
    const q = search.trim().toLowerCase();
    const hit = q ? out.filter(r => r.label.toLowerCase().includes(q) || r.target.toLowerCase().includes(q)) : out;
    // ชั้นรุ่นก่อน แล้วเรียงตามชื่อบนใบปะหน้า
    return hit.sort((a, b) => (a.isColor === b.isColor)
      ? a.label.localeCompare(b.label, "th")
      : (a.isColor ? 1 : -1));
  }, [aliases, clothingItems, search]);

  const broken = rows.filter(r => r.missing).length;
  const sel = { padding: "5px 8px", borderRadius: 7, border: `1px solid ${T.inputBorder}`, background: T.input, fontSize: 12, fontFamily: "inherit", maxWidth: 200 };

  return (
    <Modal onClose={onClose} w={860}>
      <MHead title="🧠 การจับคู่ชื่อสินค้า"
        sub="สิ่งที่ระบบจำไว้จากตอนนำเข้าใบปะหน้า — แก้ตรงนี้ได้ถ้าเคยจับคู่ผิด" onClose={onClose}/>

      <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        {[
          { k: "mine", l: `📦 ${customer?.name || "ลูกค้ารายนี้"}`, hint: "ใช้อัตโนมัติกับเจ้านี้" },
          { k: "shared", l: "🌐 กองกลาง", hint: "เจ้าอื่นเอาไปใช้เป็นตัวเติม (ยังต้องกดยืนยัน)" },
        ].map(t => (
          <button key={t.k} onClick={() => { setScope(t.k); setEditKey(null); }} title={t.hint}
            style={{ padding: "7px 14px", borderRadius: 9, cursor: "pointer", fontSize: 12, fontFamily: "inherit",
              fontWeight: scope === t.k ? 700 : 500,
              border: `1px solid ${scope === t.k ? T.accent : T.border}`,
              background: scope === t.k ? "rgba(59,91,139,0.1)" : "transparent",
              color: scope === t.k ? T.accent : T.sub }}>
            {t.l}
          </button>
        ))}
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 ค้นชื่อบนใบปะหน้า / ชื่อรุ่นในคลัง"
          style={{ flex: "1 1 220px", padding: "8px 12px", borderRadius: 9, border: `1px solid ${T.border}`, fontSize: 13, fontFamily: "inherit", outline: "none" }}/>
      </div>

      {broken > 0 && (
        <div style={{ marginBottom: 10, padding: "9px 13px", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 9, fontSize: 12, color: "#b91c1c" }}>
          ⚠️ มี {broken} รายการที่ชี้ไปหารุ่นที่ถูกลบไปแล้ว — ควรแก้หรือลบทิ้ง ไม่งั้นรอบต่อไปจะจับคู่ไม่ได้
        </div>
      )}

      <div className="scroll-col" style={{ maxHeight: "56vh", overflowY: "auto", border: `1px solid ${T.border}`, borderRadius: 10 }}>
        {loading ? (
          <div style={{ padding: 30, textAlign: "center", color: T.muted, fontSize: 13 }}>กำลังโหลด...</div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 30, textAlign: "center", color: T.muted, fontSize: 13 }}>
            {search ? "ไม่พบรายการที่ค้น" : "ยังไม่เคยสอนการจับคู่ให้เจ้านี้"}
          </div>
        ) : rows.map((r, i) => (
          <div key={r.key} style={{ padding: "9px 12px", borderBottom: i < rows.length - 1 ? `1px solid ${T.border}` : "none",
            background: r.missing ? "rgba(239,68,68,0.04)" : (r.isColor ? "rgba(241,243,246,0.35)" : "transparent") }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 260px", minWidth: 0 }}>
                <div style={{ fontSize: 12, color: T.text, fontWeight: r.isColor ? 400 : 600, wordBreak: "break-word" }}>
                  {r.isColor && <span style={{ color: T.muted, marginRight: 4 }}>└ สี</span>}
                  {r.label}
                  {r.raw && <span title="สอนไว้ก่อนระบบจะเก็บข้อความต้นฉบับ" style={{ marginLeft: 6, fontSize: 9, color: T.muted }}>(ข้อความเดิมไม่ถูกเก็บไว้)</span>}
                </div>
              </div>
              <span style={{ color: T.muted, fontSize: 12 }}>→</span>
              <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                {editKey === r.key ? (
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                    <select defaultValue={r.clothingId} style={sel}
                      onChange={e => repoint(r.key, e.target.value, r.isColor ? 0 : undefined)}>
                      {clothingItems.map(c => <option key={c.id} value={c.id}>{c.model || c.name}</option>)}
                    </select>
                    {r.isColor && (
                      <select defaultValue={r.colorIdx ?? 0} style={sel}
                        onChange={e => repoint(r.key, r.clothingId, Number(e.target.value))}>
                        {(clothingItems.find(c => c.id === r.clothingId)?.colors || []).map((c, ci) =>
                          <option key={ci} value={ci}>{c.colorName || c.name || `สีที่ ${ci + 1}`}</option>)}
                      </select>
                    )}
                  </div>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {r.colorHex && <span style={{ width: 11, height: 11, borderRadius: 3, background: r.colorHex, border: "1px solid rgba(0,0,0,0.15)", flexShrink: 0 }}/>}
                    <span style={{ fontSize: 12, fontWeight: 600, color: r.missing ? T.red : T.accent }}>
                      {r.target}{r.colorName ? ` · ${r.colorName}` : ""}
                    </span>
                  </div>
                )}
              </div>
              <div style={{ fontSize: 10, color: T.muted, whiteSpace: "nowrap", minWidth: 90 }}>
                {r.by}{r.at ? ` · ${r.at}` : ""}
              </div>
              <div style={{ display: "flex", gap: 5 }}>
                <button onClick={() => setEditKey(editKey === r.key ? null : r.key)} disabled={busy}
                  title="เปลี่ยนว่าให้ชี้ไปที่รุ่น/สีไหน"
                  style={{ padding: "4px 9px", borderRadius: 7, border: `1px solid ${T.border}`, background: editKey === r.key ? "rgba(59,91,139,0.1)" : "white", color: T.accent, cursor: "pointer", fontSize: 11 }}>
                  {editKey === r.key ? "เสร็จ" : "✏️"}
                </button>
                <button onClick={() => removeOne(r.key)} disabled={busy} title="ลบการจับคู่นี้"
                  style={{ padding: "4px 9px", borderRadius: 7, border: "1px solid rgba(185,74,72,0.3)", background: "rgba(185,74,72,0.06)", color: T.red, cursor: "pointer", fontSize: 11 }}>🗑</button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ fontSize: 11, color: T.muted, marginTop: 10, lineHeight: 1.7 }}>
        💡 ลบชั้น <b>รุ่น</b> = ชั้น <b>สี</b> ที่ห้อยอยู่ใต้ชื่อเดียวกันจะถูกลบไปด้วย · ลบแล้วครั้งหน้าระบบจะถามใหม่ ไม่ได้ทำให้ยอดที่ลงไปแล้วเปลี่ยน
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
        <BtnGhost onClick={onClose} style={{ flex: 1 }}>ปิด</BtnGhost>
      </div>
    </Modal>
  );
}
