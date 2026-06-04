// 📦 Stocktake — นับสต็อกจริง + ปรับให้ตรง
import { useState, useMemo } from "react";
import { db } from "../firebase";
import { doc, updateDoc, addDoc, collection as fsCollection, serverTimestamp } from "firebase/firestore";
import { T, SIZES } from "../theme";
import { Modal, MHead, BtnPrimary, BtnGhost, CardBox } from "../components/ui";
import BarcodeScanner from "../components/BarcodeScanner";
import { logAudit, AUDIT_ACTIONS } from "../utils/audit";

const now = () => {
  const d = new Date();
  const p = n => String(n).padStart(2,"0");
  return `${p(d.getDate())}/${p(d.getMonth()+1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export default function StocktakeTab({ products, clothingItems, user, role }) {
  const [mode, setMode] = useState("general"); // general | clothing
  const [counts, setCounts] = useState({}); // {productId: actualCount}
  const [clothingCounts, setClothingCounts] = useState({}); // {`${itemId}_${ci}_${size}`: actualCount}
  const [showScanner, setShowScanner] = useState(false);
  const [search, setSearch] = useState("");
  const [filterDiff, setFilterDiff] = useState("ทั้งหมด"); // ทั้งหมด/มีส่วนต่าง/ยังไม่นับ
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");
  const [confirmFinalize, setConfirmFinalize] = useState(false);
  const [quickAdd, setQuickAdd] = useState(null); // {product, addQty}
  const [quickSearch, setQuickSearch] = useState(""); // search-to-add input

  // === General products ===
  const filteredProducts = useMemo(() => {
    return products.filter(p => {
      if (search && !((p.name||"").toLowerCase().includes(search.toLowerCase()) || (p.code||"").toLowerCase().includes(search.toLowerCase()) || (p.barcode||"").toLowerCase().includes(search.toLowerCase()))) return false;
      const counted = counts[p.id] !== undefined && counts[p.id] !== "";
      const diff = counted ? Number(counts[p.id]) - Number(p.qty||0) : 0;
      if (filterDiff === "มีส่วนต่าง" && (diff === 0 || !counted)) return false;
      if (filterDiff === "ยังไม่นับ" && counted) return false;
      return true;
    });
  }, [products, counts, search, filterDiff]);

  const generalSummary = useMemo(() => {
    let counted = 0, diff = 0, totalDiffQty = 0;
    products.forEach(p => {
      if (counts[p.id] !== undefined && counts[p.id] !== "") {
        counted++;
        const d = Number(counts[p.id]) - Number(p.qty||0);
        if (d !== 0) { diff++; totalDiffQty += Math.abs(d); }
      }
    });
    return { counted, total: products.length, diff, totalDiffQty };
  }, [products, counts]);

  // === Handle barcode scan → เปิด quick-add modal ===
  const handleScan = (code) => {
    setShowScanner(false);
    const found = products.find(p =>
      (p.barcode||"").toLowerCase() === code.toLowerCase() ||
      (p.code||"").toLowerCase() === code.toLowerCase()
    );
    if (found) openQuickAdd(found);
    else alert(`❌ ไม่พบสินค้าในระบบ — รหัส/บาร์โค้ด: ${code}`);
  };

  const openQuickAdd = (product) => {
    setQuickAdd({ product, addQty: "" });
  };

  const applyQuickAdd = () => {
    if (!quickAdd) return;
    const { product, addQty } = quickAdd;
    const n = Number(addQty);
    if (!n || n <= 0) { alert("ใส่จำนวนที่ถูกต้อง"); return; }
    const cur = counts[product.id] !== undefined && counts[product.id] !== "" ? Number(counts[product.id]) : 0;
    setCounts(c => ({ ...c, [product.id]: cur + n }));
    setQuickAdd(null);
    // scroll ไปแถวนั้น
    setSearch(product.code || product.name);
    setTimeout(() => {
      const el = document.querySelector(`[data-stocktake-id="${product.id}"]`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 100);
  };

  // ค้นหาเพื่อ quick add (ค้นชื่อ/รหัส/บาร์โค้ด)
  const quickSearchResults = useMemo(() => {
    const q = quickSearch.toLowerCase().trim();
    if (!q) return [];
    return products.filter(p =>
      (p.name||"").toLowerCase().includes(q) ||
      (p.code||"").toLowerCase().includes(q) ||
      (p.barcode||"").toLowerCase().includes(q)
    ).slice(0, 6);
  }, [products, quickSearch]);

  // === Save adjustments ===
  const handleFinalize = async () => {
    setSaving(true);
    const adjustments = [];
    if (mode === "general") {
      for (const p of products) {
        if (counts[p.id] === undefined || counts[p.id] === "") continue;
        const newQty = Number(counts[p.id]);
        const oldQty = Number(p.qty||0);
        const diff = newQty - oldQty;
        if (diff === 0) continue;
        adjustments.push({ productId: p.id, code: p.code, name: p.name, oldQty, newQty, diff });
      }
    }
    if (adjustments.length === 0) {
      alert("ไม่มีรายการที่ต้องปรับ");
      setSaving(false);
      setConfirmFinalize(false);
      return;
    }
    try {
      // 1) update products
      for (const adj of adjustments) {
        await updateDoc(doc(db, "products", adj.productId), {
          qty: adj.newQty,
          lastUpdate: now(),
          history: [{ action: "นับสต็อก (Stocktake)", by: user.name, date: now(), note: `ปรับ ${adj.oldQty}→${adj.newQty} (${adj.diff>0?"+":""}${adj.diff})` }],
        });
        // log transaction
        await addDoc(fsCollection(db, "transactions"), {
          type: adj.diff > 0 ? "รับ" : "จ่าย",
          code: adj.code, name: adj.name,
          qty: Math.abs(adj.diff),
          by: user.name, date: now(),
          note: "Stocktake adjustment",
          createdAt: serverTimestamp(),
          category: "Stocktake",
        });
      }
      // 2) save stocktake session
      await addDoc(fsCollection(db, "stocktakes"), {
        date: now(),
        by: user.name,
        userId: user.id,
        mode,
        adjustments,
        totalCounted: generalSummary.counted,
        totalDiff: adjustments.length,
        totalDiffQty: adjustments.reduce((s,a)=>s+Math.abs(a.diff),0),
        createdAt: serverTimestamp(),
      });
      // 3) audit
      logAudit(user, {
        action: AUDIT_ACTIONS.STOCK,
        collection: "products",
        targetLabel: `Stocktake · ${adjustments.length} รายการ`,
        note: `ปรับสต็อก: ${adjustments.length} รายการ, รวม ${adjustments.reduce((s,a)=>s+Math.abs(a.diff),0)} ชิ้น`,
      });
      setSavedMsg(`✅ บันทึกแล้ว — ปรับ ${adjustments.length} รายการ`);
      setCounts({});
      setConfirmFinalize(false);
      setTimeout(()=>setSavedMsg(""), 3500);
    } catch (e) {
      alert("บันทึกล้มเหลว: " + (e.message||e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ animation: "fadeUp 0.4s ease" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: T.text }}>📦 Stocktake — นับสต็อกจริง</div>
          <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>นับสินค้าจริง → ระบบจะปรับ qty ให้ตรง พร้อมบันทึก audit log</div>
        </div>
      </div>

      {savedMsg && <div style={{ marginBottom: 12, padding: "10px 14px", background: "rgba(58,122,82,0.1)", border: "1px solid rgba(58,122,82,0.3)", borderRadius: 8, color: T.green, fontSize: 13, fontWeight: 600 }}>{savedMsg}</div>}

      {/* === Quick Add Bar — สแกน/พิมพ์ → เลือก → ใส่จำนวน === */}
      <div style={{ marginBottom: 14, padding: 14, background: "linear-gradient(135deg,rgba(124,58,237,0.06),rgba(59,91,139,0.04))", border: "1px solid rgba(124,58,237,0.25)", borderRadius: 10 }}>
        <div style={{ fontSize: 11, color: "#7c3aed", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>⚡ Quick Add — สแกนหรือพิมพ์ ชื่อ/รหัส แล้วใส่จำนวน</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", position: "relative" }}>
          <input
            value={quickSearch}
            onChange={e => setQuickSearch(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && quickSearchResults.length > 0) {
                openQuickAdd(quickSearchResults[0]);
                setQuickSearch("");
              }
            }}
            placeholder="🔎 พิมพ์ชื่อ/รหัส/บาร์โค้ด — กด Enter เพื่อเลือกอันแรก..."
            style={{ flex: 1, background: T.input, border: `1px solid ${T.inputBorder}`, color: T.text, borderRadius: 8, padding: "10px 14px", fontFamily: "'Sarabun',sans-serif", fontSize: 14, outline: "none" }}/>
          <button onClick={()=>setShowScanner(true)} style={{ padding: "10px 16px", borderRadius: 8, border: "1px solid rgba(124,58,237,0.4)", background: "rgba(124,58,237,0.15)", color: "#7c3aed", cursor: "pointer", fontSize: 13, fontWeight: 700, fontFamily: "'Sarabun',sans-serif", whiteSpace: "nowrap" }}>
            📸 สแกนกล้อง
          </button>
          {/* Dropdown */}
          {quickSearch && quickSearchResults.length > 0 && (
            <div style={{ position: "absolute", top: "100%", left: 0, right: 100, marginTop: 4, background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.15)", maxHeight: 280, overflowY: "auto", zIndex: 50 }}>
              {quickSearchResults.map((p,i)=>(
                <div key={p.id} onClick={()=>{openQuickAdd(p); setQuickSearch("");}}
                  style={{ display: "grid", gridTemplateColumns: "80px 1fr 80px", padding: "10px 14px", borderBottom: i<quickSearchResults.length-1?`1px solid ${T.border}`:"none", cursor: "pointer", fontSize: 12, alignItems: "center" }}
                  onMouseEnter={e=>e.currentTarget.style.background="rgba(59,91,139,0.06)"}
                  onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                  <div style={{ fontFamily: "monospace", color: T.accent, fontWeight: 700 }}>{p.code}</div>
                  <div>
                    <div style={{ fontWeight: 600, color: T.text }}>{p.name}</div>
                    {p.barcode && <div style={{ fontSize: 10, color: T.muted, fontFamily: "monospace" }}>{p.barcode}</div>}
                  </div>
                  <div style={{ textAlign: "right", fontFamily: "monospace", color: T.sub }}>คงเหลือ {p.qty||0}</div>
                </div>
              ))}
            </div>
          )}
          {quickSearch && quickSearchResults.length === 0 && (
            <div style={{ position: "absolute", top: "100%", left: 0, right: 100, marginTop: 4, background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: 14, fontSize: 12, color: T.muted, textAlign: "center", zIndex: 50 }}>
              ไม่พบสินค้าที่ตรงกับ "{quickSearch}"
            </div>
          )}
        </div>
      </div>

      {/* Summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 14 }}>
        <div style={{ padding: 12, background: T.card, border: `1px solid ${T.border}`, borderRadius: 10 }}>
          <div style={{ fontSize: 10, color: T.muted, fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>นับแล้ว</div>
          <div style={{ fontSize: 20, fontWeight: 800, fontFamily: "monospace", color: T.accent }}>{generalSummary.counted}/{generalSummary.total}</div>
        </div>
        <div style={{ padding: 12, background: T.card, border: `1px solid ${T.border}`, borderRadius: 10 }}>
          <div style={{ fontSize: 10, color: T.muted, fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>คงเหลือ</div>
          <div style={{ fontSize: 20, fontWeight: 800, fontFamily: "monospace", color: T.sub }}>{generalSummary.total - generalSummary.counted}</div>
        </div>
        <div style={{ padding: 12, background: generalSummary.diff>0?"rgba(184,134,0,0.08)":T.card, border: `1px solid ${T.border}`, borderRadius: 10 }}>
          <div style={{ fontSize: 10, color: T.muted, fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>มีส่วนต่าง</div>
          <div style={{ fontSize: 20, fontWeight: 800, fontFamily: "monospace", color: generalSummary.diff>0?T.amber:T.sub }}>{generalSummary.diff}</div>
        </div>
        <div style={{ padding: 12, background: generalSummary.totalDiffQty>0?"rgba(185,74,72,0.08)":T.card, border: `1px solid ${T.border}`, borderRadius: 10 }}>
          <div style={{ fontSize: 10, color: T.muted, fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>รวมส่วนต่าง</div>
          <div style={{ fontSize: 20, fontWeight: 800, fontFamily: "monospace", color: generalSummary.totalDiffQty>0?T.red:T.sub }}>{generalSummary.totalDiffQty} ชิ้น</div>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="🔍 ค้นหา ชื่อ/รหัส/บาร์โค้ด..."
          style={{ flex: 1, minWidth: 200, background: T.input, border: `1px solid ${T.inputBorder}`, color: T.text, borderRadius: 7, padding: "8px 12px", fontFamily: "'Sarabun',sans-serif", fontSize: 13, outline: "none" }}/>
        <div style={{ display: "flex", gap: 4 }}>
          {["ทั้งหมด","ยังไม่นับ","มีส่วนต่าง"].map(f => (
            <button key={f} onClick={()=>setFilterDiff(f)}
              style={{ padding: "7px 12px", borderRadius: 7, border: `1px solid ${filterDiff===f?T.accent:T.border}`, background: filterDiff===f?"rgba(59,91,139,0.12)":"transparent", color: filterDiff===f?T.accent:T.sub, cursor: "pointer", fontSize: 12, fontWeight: filterDiff===f?700:500 }}>
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <CardBox style={{ padding: 0, overflow: "hidden", marginBottom: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "60px 90px 1fr 100px 100px 100px", padding: "10px 16px", background: "#f8f9fb", fontSize: 10, color: T.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", borderBottom: `1px solid ${T.border}` }}>
          <div></div><div>รหัส</div><div>ชื่อสินค้า</div><div style={{textAlign:"right"}}>ระบบ</div><div style={{textAlign:"center"}}>นับจริง</div><div style={{textAlign:"right"}}>ส่วนต่าง</div>
        </div>
        {filteredProducts.length === 0 ? (
          <div style={{ padding: 30, textAlign: "center", color: T.muted, fontSize: 13 }}>{search?"ไม่พบสินค้า":"ไม่มีสินค้าในระบบ"}</div>
        ) : filteredProducts.map((p, i) => {
          const counted = counts[p.id] !== undefined && counts[p.id] !== "";
          const actual = counted ? Number(counts[p.id]) : 0;
          const diff = counted ? actual - Number(p.qty||0) : null;
          const diffColor = diff === null ? T.muted : diff === 0 ? T.green : diff > 0 ? T.accent : T.red;
          return (
            <div key={p.id} data-stocktake-id={p.id} style={{ display: "grid", gridTemplateColumns: "60px 90px 1fr 100px 100px 100px", alignItems: "center", padding: "9px 16px", borderBottom: i<filteredProducts.length-1?`1px solid ${T.border}`:"none", fontSize: 12, background: counted ? (diff===0?"rgba(58,122,82,0.04)":"rgba(184,134,0,0.04)") : "transparent" }}>
              <div style={{ fontSize: 10, color: T.muted }}>
                {counted ? (diff===0 ? "✅" : "⚠️") : ""}
              </div>
              <div style={{ fontFamily: "monospace", color: T.accent, fontWeight: 600, fontSize: 11 }}>{p.code}</div>
              <div>
                <div style={{ fontWeight: 600, color: T.text }}>{p.name}</div>
                {p.barcode && <div style={{ fontSize: 10, color: T.muted, fontFamily: "monospace" }}>{p.barcode}</div>}
              </div>
              <div style={{ textAlign: "right", fontFamily: "monospace", color: T.sub, fontSize: 13 }}>{Number(p.qty||0).toLocaleString()}</div>
              <div style={{ textAlign: "center" }}>
                <input type="number" value={counts[p.id] ?? ""} onChange={e=>setCounts(c=>({...c,[p.id]:e.target.value}))}
                  onFocus={e=>e.target.select()}
                  placeholder="-"
                  style={{ width: 80, padding: "5px 8px", textAlign: "center", borderRadius: 6, border: `1.5px solid ${counted?T.accent:T.border}`, background: counted?"rgba(59,91,139,0.08)":T.input, color: T.text, fontFamily: "monospace", fontSize: 13, fontWeight: 700, outline: "none" }}/>
              </div>
              <div style={{ textAlign: "right", fontFamily: "monospace", fontWeight: 700, color: diffColor, fontSize: 13 }}>
                {diff === null ? "—" : `${diff>0?"+":""}${diff}`}
              </div>
            </div>
          );
        })}
      </CardBox>

      {/* Finalize button */}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
        <BtnGhost onClick={()=>{ if(window.confirm("ล้างค่าที่นับทั้งหมด?")) setCounts({}); }}>🗑️ ล้างค่าที่นับ</BtnGhost>
        <BtnPrimary onClick={()=>setConfirmFinalize(true)} disabled={generalSummary.diff===0 || saving}>
          💾 บันทึก & ปรับสต็อก ({generalSummary.diff} รายการ)
        </BtnPrimary>
      </div>

      {/* Confirm modal */}
      {confirmFinalize && (
        <Modal onClose={()=>setConfirmFinalize(false)} w={520}>
          <MHead title="⚠️ ยืนยันการปรับสต็อก" onClose={()=>setConfirmFinalize(false)} color={T.amber}/>
          <div style={{ fontSize: 13, color: T.text, marginBottom: 14, lineHeight: 1.7 }}>
            จะปรับ <b style={{ color: T.amber }}>{generalSummary.diff} รายการ</b> · รวม <b>{generalSummary.totalDiffQty} ชิ้น</b>
            <br/>
            <span style={{ fontSize: 11, color: T.muted }}>การปรับสต็อกจะถูกบันทึกใน transactions + audit log — ไม่สามารถ undo ได้</span>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <BtnGhost onClick={()=>setConfirmFinalize(false)} style={{ flex: 1 }}>ยกเลิก</BtnGhost>
            <BtnPrimary onClick={handleFinalize} disabled={saving} style={{ flex: 1 }}>
              {saving ? "⏳ กำลังบันทึก..." : "✅ ยืนยันปรับสต็อก"}
            </BtnPrimary>
          </div>
        </Modal>
      )}

      {/* ── Quick Add Modal ── */}
      {quickAdd && (()=>{
        const { product, addQty } = quickAdd;
        const currentCount = counts[product.id] !== undefined && counts[product.id] !== "" ? Number(counts[product.id]) : 0;
        const systemQty = Number(product.qty||0);
        const newTotal = currentCount + (Number(addQty)||0);
        const diff = newTotal - systemQty;
        return (
          <Modal onClose={()=>setQuickAdd(null)} w={460}>
            <MHead title="⚡ Quick Add" sub="เพิ่มจำนวนที่นับเข้าไป" onClose={()=>setQuickAdd(null)} color="#7c3aed"/>
            {/* Product info */}
            <div style={{ marginBottom: 14, padding: 14, background: "rgba(124,58,237,0.06)", borderRadius: 10, border: "1px solid rgba(124,58,237,0.2)" }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: T.text, marginBottom: 4 }}>{product.name}</div>
              <div style={{ fontSize: 11, color: T.muted, fontFamily: "monospace" }}>{product.code}{product.barcode?` · ${product.barcode}`:""}</div>
              <div style={{ marginTop: 8, display: "flex", gap: 14, fontSize: 12 }}>
                <span style={{ color: T.sub }}>ระบบ: <b style={{ color: T.text, fontFamily: "monospace" }}>{systemQty}</b></span>
                <span style={{ color: T.sub }}>นับไว้แล้ว: <b style={{ color: T.accent, fontFamily: "monospace" }}>{currentCount}</b></span>
              </div>
            </div>

            {/* Qty input + quick buttons */}
            <label style={{ fontSize: 11, color: T.muted, display: "block", marginBottom: 6, fontWeight: 600 }}>จำนวนที่เพิ่ม (นับเจอ)</label>
            <input type="number" min="1" autoFocus value={addQty}
              onChange={e=>setQuickAdd(q=>({...q, addQty: e.target.value}))}
              onFocus={e=>e.target.select()}
              onKeyDown={e=>{ if(e.key==="Enter") applyQuickAdd(); }}
              placeholder="ใส่จำนวน..."
              style={{ width: "100%", background: T.input, border: `1.5px solid ${T.accent}`, color: T.text, borderRadius: 9, padding: "12px 14px", fontFamily: "monospace", fontSize: 22, fontWeight: 700, outline: "none", textAlign: "center", marginBottom: 10 }}/>

            {/* Quick add buttons */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: 6, marginBottom: 14 }}>
              {[1,5,10,12,50,100].map(n=>(
                <button key={n} onClick={()=>setQuickAdd(q=>({...q, addQty: String((Number(q.addQty)||0)+n)}))}
                  style={{ padding: "10px 6px", borderRadius: 7, border: `1px solid ${T.border}`, background: "rgba(59,91,139,0.08)", color: T.accent, cursor: "pointer", fontSize: 13, fontWeight: 700, fontFamily: "monospace" }}>
                  +{n}
                </button>
              ))}
            </div>

            {/* Preview */}
            {Number(addQty)>0 && (
              <div style={{ marginBottom: 14, padding: 10, background: diff===0?"rgba(58,122,82,0.08)":diff>0?"rgba(59,91,139,0.08)":"rgba(185,74,72,0.08)", borderRadius: 8, border: `1px solid ${diff===0?"rgba(58,122,82,0.3)":diff>0?"rgba(59,91,139,0.3)":"rgba(185,74,72,0.3)"}`, fontSize: 12, textAlign: "center" }}>
                หลังเพิ่ม: <b style={{ fontFamily: "monospace", fontSize: 16, color: T.text }}>{newTotal}</b> ชิ้น ·
                ส่วนต่างจากระบบ: <b style={{ fontFamily: "monospace", color: diff===0?T.green:diff>0?T.accent:T.red }}>{diff>0?"+":""}{diff}</b>
              </div>
            )}

            <div style={{ display: "flex", gap: 10 }}>
              <BtnGhost onClick={()=>setQuickAdd(null)} style={{ flex: 1 }}>ยกเลิก</BtnGhost>
              <BtnPrimary onClick={applyQuickAdd} disabled={!addQty||Number(addQty)<=0} style={{ flex: 2 }}>
                ➕ เพิ่ม {addQty || "0"} ชิ้น
              </BtnPrimary>
            </div>

            <div style={{ marginTop: 10, fontSize: 10, color: T.muted, textAlign: "center" }}>
              💡 เคล็ดลับ: กด Enter เพื่อยืนยันเร็ว · จะเพิ่ม <b>สะสม</b> เข้ากับจำนวนที่นับไว้แล้ว
            </div>
          </Modal>
        );
      })()}

      {showScanner && <BarcodeScanner onScan={handleScan} onClose={()=>setShowScanner(false)} title="📸 สแกน Stocktake"/>}
    </div>
  );
}
