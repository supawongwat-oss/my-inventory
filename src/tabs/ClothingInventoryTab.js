import React from "react";
import { SIZE_GROUPS } from "../theme";

const T = {
  card:"#ffffff", border:"#e3e8ef", text:"#1f2a44", sub:"#5b6b85", muted:"#8a9bb3",
  accent:"#3b5b8b", amber:"#d97706",
};

// อ่านชนิดแขนจากชื่อรุ่น (ใช้ทำ sub-tab กรอง)
const detectSleeve = (name = "") => {
  const s = String(name).toLowerCase();
  if (s.includes("แขนกุด")) return "sleeveless";
  if (s.includes("แขนยาว")) return "longsleeve";
  return "other";
};

export default function ClothingInventoryTab({
  inventoryTab, clothingItems, boms, role, sizesFor,
  clothingSubTab, setClothingSubTab,
  pendingMixSales, setPendingMixListOpen,
  clothingImgRef, handleClothingImageUpload, setUploadingClothingId,
  draggingClothingId, setDraggingClothingId,
  dragOverClothingId, setDragOverClothingId, reorderClothing,
  collapsedItems, toggleCollapse,
  setShowAddColor, openSizeEditor, openMix, openBomModal, openProductCatalog,
  brandFilter, setBrandFilter,
  manageColorMode, setManageColorMode,
  setDeleteClothingTarget, setDeleteConfirmText,
  linkedInvColors, toggleLinkInvColor,
  editingStock, setEditingStock, handleUpdateClothingStock,
  setPriceForm, setPriceModal,
  setClothingTxModal, setClothingTxType, setClothingTxQty, setClothingTxSizeQty, setClothingTxNote,
  handleDeleteClothingColor,
}) {
  // 👕 clothing tab → apparel + รุ่นเก่าที่ไม่มี sizeType | 👟 sports tab → shoe items only
  let tabItems = clothingItems.filter(it =>
    inventoryTab === "sports" ? it.sizeType === "shoe" : it.sizeType !== "shoe"
  ).sort((a, b) => (a.sortIndex ?? 9999) - (b.sortIndex ?? 9999));

  // 🏷️ กรองตามแบรนด์ (ชั้นบน) — ทำก่อน sub-tab เพื่อให้ตัวเลขในแท็บย่อยตรงกับแบรนด์ที่เลือก
  const brandList = [...new Set(tabItems.map(it => it.brand).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"th"));
  const noBrandCount = tabItems.filter(it => !it.brand).length;
  const brandCounts = {};
  tabItems.forEach(it => { if (it.brand) brandCounts[it.brand] = (brandCounts[it.brand]||0) + 1; });
  const totalInTab = tabItems.length;
  if (brandFilter === "__none__") tabItems = tabItems.filter(it => !it.brand);
  else if (brandFilter) tabItems = tabItems.filter(it => it.brand === brandFilter);

  const subCounts = { all: tabItems.length, sleeveless: 0, longsleeve: 0, other: 0 };
  tabItems.forEach(it => { subCounts[detectSleeve(it.model)]++; });
  if (inventoryTab === "clothing" && clothingSubTab !== "all") {
    tabItems = tabItems.filter(it => detectSleeve(it.model) === clothingSubTab);
  }

  return (
    <div style={{ animation: "fadeUp 0.4s ease" }}>
      <input ref={clothingImgRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleClothingImageUpload} />

      {/* 🏷️ แบรนด์ (ขนาดปกติ) + หมวดย่อย (เล็กลง) — บรรทัดเดียวกัน */}
      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
      {brandList.length > 0 && (
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center" }}>
          <button onClick={() => setBrandFilter("")}
            style={{ padding: "6px 14px", borderRadius: 8, cursor: "pointer", fontFamily: "'Sarabun',sans-serif", fontSize: 12,
              border: `1px solid ${!brandFilter ? T.accent : T.border}`, background: !brandFilter ? "rgba(59,91,139,0.1)" : "white",
              color: !brandFilter ? T.accent : T.sub, fontWeight: !brandFilter ? 700 : 500 }}>
            ทุกแบรนด์ <span style={{ opacity: 0.7, fontSize: 10 }}>({totalInTab})</span>
          </button>
          {brandList.map(b => (
            <button key={b} onClick={() => setBrandFilter(b)}
              style={{ padding: "6px 14px", borderRadius: 8, cursor: "pointer", fontFamily: "'Sarabun',sans-serif", fontSize: 12,
                border: `1px solid ${brandFilter === b ? T.accent : T.border}`, background: brandFilter === b ? "rgba(59,91,139,0.1)" : "white",
                color: brandFilter === b ? T.accent : T.sub, fontWeight: brandFilter === b ? 700 : 500 }}>
              🏢 {b} <span style={{ opacity: 0.7, fontSize: 10 }}>({brandCounts[b]})</span>
            </button>
          ))}
          {noBrandCount > 0 && (
            <button onClick={() => setBrandFilter("__none__")} title="รุ่นที่ยังไม่ได้ตั้งแบรนด์"
              style={{ padding: "6px 14px", borderRadius: 8, cursor: "pointer", fontFamily: "'Sarabun',sans-serif", fontSize: 12,
                border: `1px solid ${brandFilter === "__none__" ? T.amber : T.border}`, background: brandFilter === "__none__" ? "rgba(217,119,6,0.1)" : "white",
                color: brandFilter === "__none__" ? T.amber : T.muted, fontWeight: brandFilter === "__none__" ? 700 : 500 }}>
              ยังไม่ตั้งแบรนด์ <span style={{ opacity: 0.7, fontSize: 10 }}>({noBrandCount})</span>
            </button>
          )}
        </div>
      )}
      {inventoryTab === "clothing" && (
        <>
          <div style={{ display: "flex", gap: 3, padding: 2, background: T.card, borderRadius: 8, border: `1px solid ${T.border}`, flexWrap: "wrap" }}>
            {[
              { id: "all", icon: "👕", label: "ทั้งหมด" },
              { id: "sleeveless", icon: "🎽", label: "แขนกุด" },
              { id: "longsleeve", icon: "🧥", label: "แขนยาว" },
              { id: "other", icon: "👔", label: "แขนสั้น" },
            ].map(s => (
              <button key={s.id} onClick={() => setClothingSubTab(s.id)}
                style={{ padding: "3px 9px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 10, fontWeight: 600, fontFamily: "'Sarabun',sans-serif", background: clothingSubTab === s.id ? T.accent : "transparent", color: clothingSubTab === s.id ? "white" : T.sub, transition: "all 0.15s", whiteSpace: "nowrap" }}>
                {s.icon} {s.label} <span style={{ opacity: 0.7, fontSize: 9, marginLeft: 1 }}>({subCounts[s.id]})</span>
              </button>
            ))}
          </div>
          {(pendingMixSales || []).length > 0 && (
            <button onClick={() => setPendingMixListOpen(true)}
              style={{ padding: "5px 11px", borderRadius: 8, border: "1px solid rgba(184,134,0,0.5)", background: "rgba(184,134,0,0.15)", color: T.amber, cursor: "pointer", fontSize: 11, fontWeight: 700, fontFamily: "'Sarabun',sans-serif", display: "flex", alignItems: "center", gap: 5, whiteSpace: "nowrap" }}>
              🕐 รอระบุ <span style={{ background: T.amber, color: "white", padding: "1px 7px", borderRadius: 10, fontSize: 10 }}>{pendingMixSales.length}</span>
            </button>
          )}
        </>
      )}
      </div>
      {tabItems.length === 0 && (
        <div style={{ textAlign: "center", padding: 60, background: T.card, borderRadius: 16, border: `1px solid ${T.border}` }}>
          <div style={{ fontSize: 48, marginBottom: 12, opacity: 0.3 }}>{inventoryTab === "sports" ? "👟" : "👕"}</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: T.accent, marginBottom: 6 }}>ยังไม่มีรุ่นสินค้า</div>
          <div style={{ fontSize: 11, color: T.muted }}>กด "{inventoryTab === "sports" ? "👟" : "️"} เพิ่มรุ่นใหม่" เพื่อเริ่มต้น</div>
        </div>
      )}
      {tabItems.map((item) => (
        <div key={item.id}
          onDragOver={role.canAdd ? (e => { e.preventDefault(); if (dragOverClothingId !== item.id) setDragOverClothingId(item.id); }) : undefined}
          onDrop={role.canAdd ? (e => { e.preventDefault(); reorderClothing(draggingClothingId, item.id, tabItems); setDraggingClothingId(null); setDragOverClothingId(null); }) : undefined}
          style={{ background: T.card, border: `1px solid ${dragOverClothingId === item.id && draggingClothingId && draggingClothingId !== item.id ? T.accent : T.border}`, borderRadius: 16, marginBottom: 16, overflow: "hidden", boxShadow: "0 8px 32px rgba(0,0,0,0.3)", opacity: draggingClothingId === item.id ? 0.4 : 1, transition: "opacity 0.15s" }}>
          <div onClick={() => toggleCollapse(item.id)} style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 20px", borderBottom: (collapsedItems[item.id]!==false) ? "none" : `1px solid ${T.border}`, cursor: "pointer", userSelect: "none", transition: "background 0.2s" }}
            onMouseEnter={e => e.currentTarget.style.background = "rgba(59,91,139,0.04)"}
            onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
            {/* 🖱️ Drag handle — จัดลำดับ */}
            {role.canAdd && (
              <div draggable
                onDragStart={e => { e.stopPropagation(); setDraggingClothingId(item.id); e.dataTransfer.effectAllowed = "move"; }}
                onDragEnd={() => { setDraggingClothingId(null); setDragOverClothingId(null); }}
                onClick={e => e.stopPropagation()}
                title="ลากเพื่อจัดลำดับ"
                style={{ cursor: "grab", color: T.muted, fontSize: 16, flexShrink: 0, padding: "0 2px", lineHeight: 1, userSelect: "none" }}>⠿</div>
            )}
            {/* Collapse arrow */}
            <div style={{ width: 24, height: 24, borderRadius: 6, background: "rgba(59,91,139,0.1)", border: "1px solid rgba(59,91,139,0.2)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "transform 0.2s", transform: (collapsedItems[item.id]!==false) ? "rotate(-90deg)" : "rotate(0deg)", fontSize: 11, color: T.accent }}>▼</div>
            <div onClick={e => { e.stopPropagation(); setUploadingClothingId(item.id); setTimeout(() => clothingImgRef.current?.click(), 50); }}
              title={item.image ? "คลิกเพื่อเปลี่ยนรูป" : "คลิกเพื่อเพิ่มรูป"}
              style={{ width: 65, height: 65, borderRadius: 10, background: "rgba(59,91,139,0.08)", border: "2px dashed rgba(59,91,139,0.3)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flexShrink: 0, cursor: "pointer", overflow: "hidden", position: "relative" }}
              onMouseEnter={e => { const o = e.currentTarget.querySelector(".img-overlay"); if (o) o.style.opacity = "1"; }}
              onMouseLeave={e => { const o = e.currentTarget.querySelector(".img-overlay"); if (o) o.style.opacity = "0"; }}>
              {item.image ? <img src={item.image} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <><span style={{ fontSize: 20 }}>👕</span><span style={{ fontSize: 8, color: T.muted }}>รูป</span></>}
              {item.image && (
                <div className="img-overlay" style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.65)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", opacity: 0, transition: "opacity 0.15s", color: "#fff", fontSize: 9, fontWeight: 600, gap: 2 }}>
                  <span style={{ fontSize: 16 }}>📷</span>
                  <span>เปลี่ยนรูป</span>
                </div>
              )}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>
                {item.model}
                {item.brand && <span style={{ marginLeft: 7, fontSize: 10, padding: "2px 8px", background: "rgba(59,91,139,0.1)", color: T.accent, borderRadius: 10, fontWeight: 700, verticalAlign: "middle" }}>{item.brand}</span>}
                {item.category && <span style={{ marginLeft: 4, fontSize: 10, padding: "2px 8px", background: "#f1f5f9", color: T.sub, borderRadius: 10, fontWeight: 600, verticalAlign: "middle" }}>{item.category}</span>}
              </div>
              <div style={{ fontSize: 11, color: T.muted, marginTop: 3, display: "flex", alignItems: "center", gap: 10 }}>
                <span>{(item.colors || []).length} สี</span>
                <span style={{ color: "rgba(59,91,139,0.3)" }}>·</span>
                <span>รวม <b style={{ color: T.accent }}>{(item.colors || []).reduce((s, c) => s + Object.values(c.stock || {}).reduce((a, b) => a + b, 0), 0)}</b> ชิ้น</span>
                {(collapsedItems[item.id]!==false) && (item.colors || []).length > 0 && (
                  <div style={{ display: "flex", gap: 4, marginLeft: 4 }}>
                    {(item.colors || []).slice(0, 5).map((c, i) => (
                      <div key={i} title={c.colorName} style={{ width: 10, height: 10, borderRadius: 2, background: c.hex, border: "1px solid rgba(255,255,255,0.15)" }} />
                    ))}
                    {(item.colors || []).length > 5 && <span style={{ fontSize: 10, color: T.muted }}>+{(item.colors || []).length - 5}</span>}
                  </div>
                )}
              </div>
            </div>
            <div style={{ display: "flex", gap: 6 }} onClick={e => e.stopPropagation()}>
              <button onClick={() => setShowAddColor(item.id)} style={{ padding: "7px 14px", borderRadius: 8, border: "1px solid rgba(59,91,139,0.25)", background: "rgba(59,91,139,0.08)", color: T.accent, cursor: "pointer", fontSize: 12, fontFamily: "'Sarabun',sans-serif", fontWeight: 500 }}>️ สี</button>
              {/* 📏 เพิ่ม/ตั้งชื่อไซส์เฉพาะรุ่นนี้ */}
              {role.canAdd && openSizeEditor && (() => {
                const own = (item.extraSizes || []).length;
                return (
                  <button onClick={() => openSizeEditor(item)} title="เพิ่มไซส์ หรือตั้งชื่อไซส์เองสำหรับรุ่นนี้"
                    style={{ padding: "7px 14px", borderRadius: 8, border: `1px solid ${own ? "rgba(124,58,237,0.4)" : "rgba(59,91,139,0.25)"}`, background: own ? "rgba(124,58,237,0.10)" : "rgba(59,91,139,0.08)", color: own ? "#7c3aed" : T.accent, cursor: "pointer", fontSize: 12, fontFamily: "'Sarabun',sans-serif", fontWeight: own ? 700 : 500 }}>
                    📏 ไซส์{own ? ` +${own}` : ""}
                  </button>
                );
              })()}
              {(item.colors || []).length > 0 && <button onClick={() => openMix(item)} title="ขายคละสีคละไซส์" style={{ padding: "7px 14px", borderRadius: 8, border: "1px solid rgba(184,134,0,0.3)", background: "rgba(184,134,0,0.08)", color: T.amber, cursor: "pointer", fontSize: 12, fontFamily: "'Sarabun',sans-serif", fontWeight: 600 }}>🧺 ขายคละ</button>}
              {item.sizeType !== "shoe" && role.canAdd && (() => {
                const hasBom = boms.some(b => (b.id === item.id || b.clothingId === item.id) && (b.variants || []).some(v => (v.materials || []).length > 0));
                return <button onClick={() => openBomModal(item)} title="ตั้งสูตรวัตถุดิบ (BOM)" style={{ padding: "7px 14px", borderRadius: 8, border: `1px solid ${hasBom ? "rgba(22,163,74,0.35)" : "rgba(124,58,237,0.3)"}`, background: hasBom ? "rgba(22,163,74,0.08)" : "rgba(124,58,237,0.08)", color: hasBom ? "#16a34a" : "#7c3aed", cursor: "pointer", fontSize: 12, fontFamily: "'Sarabun',sans-serif", fontWeight: 600 }}>📐 {hasBom ? "BOM ✓" : "ตั้งสูตร BOM"}</button>;
              })()}
              {role.canAdd && openProductCatalog && (() => {
                const hasStory = !!item.description || (item.gallery||[]).length > 0;
                const limited = Array.isArray(item.catalogSizes) && item.catalogSizes.length > 0;
                const hiddenC = !!item.hideFromCatalog;
                const set = hiddenC ? "ซ่อนอยู่" : [item.brand, hasStory ? "มีรายละเอียด" : null, limited ? `${item.catalogSizes.length} ไซส์` : null].filter(Boolean).join(" · ");
                return (
                  <button onClick={() => openProductCatalog(item)} title="แบรนด์ / รายละเอียด / ไซส์ที่ขาย — ทุกอย่างที่ลูกค้าเห็น"
                    style={{ padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontFamily: "'Sarabun',sans-serif", fontWeight: 600, maxWidth: 230, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      border: `1px solid ${hiddenC ? "rgba(185,74,72,0.35)" : set ? "rgba(59,91,139,0.35)" : "rgba(59,91,139,0.2)"}`,
                      background: hiddenC ? "rgba(185,74,72,0.08)" : set ? "rgba(59,91,139,0.08)" : "transparent",
                      color: hiddenC ? "#b94a48" : set ? T.accent : T.muted }}>
                    🛍️ {set || "หน้าร้าน"}
                  </button>
                );
              })()}
              {role.canDelete && (item.colors || []).length > 0 &&
                <button onClick={() => setManageColorMode(m => ({ ...m, [item.id]: !m[item.id] }))}
                  title={manageColorMode[item.id] ? "ปิดโหมดลบสี" : "เปิดโหมดลบสี — ปุ่ม ✕ จะแสดงในแต่ละสี"}
                  style={{ padding: "7px 12px", borderRadius: 8, border: `1px solid ${manageColorMode[item.id] ? "rgba(184,134,0,0.4)" : "rgba(59,91,139,0.2)"}`, background: manageColorMode[item.id] ? "rgba(184,134,0,0.15)" : "transparent", color: manageColorMode[item.id] ? T.amber : T.muted, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>🔧 {manageColorMode[item.id] ? "ปิดจัดการสี" : "จัดการสี"}</button>}
              {role.canDelete && <button onClick={() => { setDeleteClothingTarget(item); setDeleteConfirmText(""); }} style={{ padding: "7px 12px", borderRadius: 8, border: "1px solid rgba(248,113,113,0.25)", background: "rgba(248,113,113,0.08)", color: "#f87171", cursor: "pointer", fontSize: 12 }}>✕</button>}
            </div>
          </div>

          {/* Collapsed state */}
          {(collapsedItems[item.id]!==false) ? null : (item.colors || []).length === 0 ? (
            <div style={{ padding: "20px", textAlign: "center", color: T.muted, fontSize: 12 }}>ยังไม่มีสี — กด "️ สี"</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                <thead>
                  <tr style={{ background: "rgba(241,243,246,0.8)" }}>
                    <th style={{ padding: "10px 14px", textAlign: "left", color: T.sub, fontWeight: 700, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.06em", width: 120, borderRight: `1px solid ${T.border}` }}>สี</th>
                    {sizesFor(item).map(sz => (
                      <th key={sz} style={{ padding: "10px 4px", textAlign: "center", color: T.text, fontWeight: 700, fontSize: 13, borderRight: "1px solid rgba(203,210,217,0.4)", fontFamily: "monospace", minWidth: 46 }}>{sz}</th>
                    ))}
                    <th style={{ padding: "10px 10px", textAlign: "center", color: T.sub, fontWeight: 700, fontSize: 12, minWidth: 60 }}>รวม</th>
                    <th style={{ padding: "10px 10px", textAlign: "center", color: T.sub, fontWeight: 700, fontSize: 12, minWidth: 100 }}>รับ/จ่าย</th>
                    <th style={{ width: 30 }} />
                  </tr>
                </thead>
                <tbody>
                  {(item.colors || []).map((col, ci) => {
                    const total = Object.values(col.stock || {}).reduce((a, b) => a + b, 0);
                    return (
                      <tr key={ci} style={{ borderBottom: "1px solid rgba(203,210,217,0.5)" }}
                        onMouseEnter={e => e.currentTarget.style.background = "rgba(59,91,139,0.04)"}
                        onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                        <td style={{ padding: "10px 14px", borderRight: `1px solid ${T.border}` }}>
                          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", userSelect: "none" }} title="🔗 ผูกสีนี้ — พิมพ์ค่าในไซส์เดียว จะซิงก์ไปทุกสีที่ผูก">
                            <input type="checkbox" checked={!!(linkedInvColors[item.id] || {})[ci]} onChange={() => toggleLinkInvColor(item.id, ci)} onClick={e => e.stopPropagation()} style={{ cursor: "pointer", accentColor: T.accent, width: 14, height: 14 }} />
                            <div style={{ width: 16, height: 16, borderRadius: 4, background: col.hex, border: "1px solid rgba(0,0,0,0.1)", flexShrink: 0 }} />
                            <span style={{ color: T.text, fontWeight: 600, fontSize: 14 }}>{col.colorName}</span>
                            {(linkedInvColors[item.id] || {})[ci] && <span style={{ fontSize: 10, color: T.accent }}>🔗</span>}
                          </label>
                        </td>
                        {sizesFor(item).map(sz => {
                          const isEd = editingStock?.itemId === item.id && editingStock?.ci === ci && editingStock?.size === sz;
                          const val = (col.stock || {})[sz] || 0;
                          return (
                            <td key={sz} style={{ padding: "3px 2px", textAlign: "center", borderRight: "1px solid rgba(203,210,217,0.4)" }}>
                              {isEd ? (
                                <input autoFocus type="number" defaultValue={val}
                                  onFocus={e => e.target.select()}
                                  onBlur={e => handleUpdateClothingStock(item.id, ci, sz, e.target.value)}
                                  onKeyDown={e => { if (e.key === "Enter" || e.key === "Escape") e.target.blur(); }}
                                  style={{ width: 48, textAlign: "center", background: "rgba(59,91,139,0.12)", border: "1.5px solid #3b5b8b", borderRadius: 6, color: "#1f2933", fontFamily: "monospace", fontSize: 15, fontWeight: 700, padding: "5px 4px", outline: "none" }} />
                              ) : (
                                <div onClick={() => setEditingStock({ itemId: item.id, ci, size: sz })}
                                  style={{ padding: "5px 4px", borderRadius: 6, cursor: "pointer", fontFamily: "monospace", fontWeight: 700, fontSize: 15, color: val === 0 ? "#9aa5b1" : val < 5 ? "#b88600" : "#1f2933", minWidth: 46, display: "inline-block", transition: "all 0.15s" }}
                                  onMouseEnter={e => { e.currentTarget.style.background = "rgba(59,91,139,0.10)"; }}
                                  onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}>
                                  {val === 0 ? "—" : val}
                                </div>
                              )}
                            </td>
                          );
                        })}
                        <td colSpan={2} style={{ padding: "4px 6px", textAlign: "center" }}>
                          {(() => {
                            const sp = col.salePrices || {};
                            const hasAny = SIZE_GROUPS.some(g => sp[g.key] != null && sp[g.key] !== "" && Number(sp[g.key]) > 0) || Number(col.salePrice) > 0;
                            const cost = Number(col.costPrice) || 0;
                            return (
                              <button onClick={() => {
                                setPriceForm({
                                  costPrice: col.costPrice || "",
                                  kids: sp.kids ?? col.salePrice ?? "",
                                  reg: sp.reg ?? col.salePrice ?? "",
                                  "2XL": sp["2XL"] ?? col.salePrice ?? "",
                                  "3XL": sp["3XL"] ?? col.salePrice ?? "",
                                  "4XL": sp["4XL"] ?? col.salePrice ?? "",
                                  "5XL": sp["5XL"] ?? col.salePrice ?? "",
                                });
                                setPriceModal({ itemId: item.id, ci });
                              }}
                                style={{ padding: "4px 8px", borderRadius: 6, border: `1px solid ${hasAny ? "rgba(52,211,153,0.3)" : T.border}`, background: hasAny ? "rgba(52,211,153,0.08)" : "rgba(59,91,139,0.05)", color: hasAny ? "#34d399" : T.sub, cursor: "pointer", fontSize: 10, fontWeight: 600, fontFamily: "'Sarabun',sans-serif", whiteSpace: "nowrap" }}>
                                💰 {hasAny ? "แก้ไขราคา" : "ตั้งราคา"}
                                {cost > 0 && <span style={{ marginLeft: 4, fontSize: 9, opacity: 0.7, fontFamily: "monospace" }}>ทุน {cost}</span>}
                              </button>
                            );
                          })()}
                        </td>
                        <td style={{ textAlign: "center", padding: "4px 6px" }}>
                          <span style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 16, color: T.text }}>{total}</span>
                        </td>
                        <td style={{ textAlign: "center", padding: "4px 8px" }}>
                          <div style={{ display: "flex", gap: 4, justifyContent: "center", alignItems: "center" }}>
                            <span title={col.colorName} style={{ width: 14, height: 14, borderRadius: 4, background: col.hex, border: "1px solid rgba(0,0,0,0.2)", flexShrink: 0 }}/>
                            <button onClick={() => { setClothingTxModal({ item, colorIdx: ci, size: null }); setClothingTxType("รับ"); setClothingTxQty(""); setClothingTxSizeQty({}); setClothingTxNote(""); }} style={{ padding: "4px 8px", borderRadius: 6, borderLeft: `3px solid ${col.hex}`, border: `1px solid rgba(52,211,153,0.3)`, borderLeftWidth: 3, borderLeftColor: col.hex, background: "rgba(52,211,153,0.08)", color: "#34d399", cursor: "pointer", fontSize: 10, fontWeight: 600, fontFamily: "'Sarabun',sans-serif" }}>⬇ รับ</button>
                            <button onClick={() => { setClothingTxModal({ item, colorIdx: ci, size: null }); setClothingTxType("จ่าย"); setClothingTxQty(""); setClothingTxSizeQty({}); setClothingTxNote(""); }} style={{ padding: "4px 8px", borderRadius: 6, border: `1px solid rgba(248,113,113,0.3)`, borderLeftWidth: 3, borderLeftColor: col.hex, background: "rgba(248,113,113,0.08)", color: "#f87171", cursor: "pointer", fontSize: 10, fontWeight: 600, fontFamily: "'Sarabun',sans-serif" }}>⬆ จ่าย</button>
                          </div>
                        </td>
                        <td style={{ textAlign: "center", padding: "4px 6px" }}>
                          {role.canDelete && manageColorMode[item.id] && <button onClick={() => handleDeleteClothingColor(item.id, ci)} title={`ลบสี ${col.colorName}`} style={{ background: "rgba(248,113,113,0.15)", border: "1px solid rgba(248,113,113,0.4)", borderRadius: 5, padding: "3px 8px", cursor: "pointer", fontSize: 11, color: "#dc2626", fontWeight: 700 }}>✕</button>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
