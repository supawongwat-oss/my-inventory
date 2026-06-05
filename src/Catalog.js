// 🛍️ Catalog Public — หน้าแคตตาล็อกสาธารณะ (ไม่ต้อง login)
// URL: /catalog
// อ่าน clothing + settings/company จาก Firestore
// ลูกค้ากดสั่ง → เขียน catalogOrders → ทีมรับใน ERP
import { useEffect, useState, useMemo } from "react";
import { db } from "./firebase";
import { collection, doc, onSnapshot, addDoc, serverTimestamp } from "firebase/firestore";

const T = {
  bg: "#f4f5f7", card: "#ffffff", border: "#e2e5ea",
  text: "#1f2933", sub: "#52606d", muted: "#9aa5b1",
  blue: "#3b5b8b", green: "#3a7a52", line: "#06C755",
};

// 🎨 hex → ชื่อสีไทย — fallback เมื่อ ERP ไม่ได้กรอกชื่อสี
const COLOR_NAME_FROM_HEX = {
  "#000000": "ดำ", "#000": "ดำ",
  "#ffffff": "ขาว", "#fff": "ขาว",
  "#ff0000": "แดง", "#f00": "แดง", "#dc2626": "แดง", "#ef4444": "แดง", "#b94a48": "แดง",
  "#0000ff": "น้ำเงิน", "#00f": "น้ำเงิน", "#2563eb": "น้ำเงิน", "#3b82f6": "น้ำเงิน", "#3b5b8b": "น้ำเงิน",
  "#008000": "เขียว", "#22c55e": "เขียว", "#16a34a": "เขียว", "#3a7a52": "เขียว",
  "#ffff00": "เหลือง", "#ff0": "เหลือง", "#facc15": "เหลือง", "#eab308": "เหลือง",
  "#ffa500": "ส้ม", "#f97316": "ส้ม", "#fb923c": "ส้ม",
  "#800080": "ม่วง", "#a855f7": "ม่วง", "#7c3aed": "ม่วง",
  "#ffc0cb": "ชมพู", "#ec4899": "ชมพู", "#f472b6": "ชมพู",
  "#a52a2a": "น้ำตาล", "#92400e": "น้ำตาล", "#78350f": "น้ำตาล",
  "#808080": "เทา", "#6b7280": "เทา", "#9ca3af": "เทา",
  "#f5deb3": "ครีม", "#fef3c7": "ครีม", "#fde68a": "ครีม",
};
function guessColorName(hex, fallbackIdx) {
  if (!hex) return `สี #${fallbackIdx+1}`;
  const h = String(hex).toLowerCase().trim();
  return COLOR_NAME_FROM_HEX[h] || `สี #${fallbackIdx+1}`;
}

export default function Catalog() {
  const [items, setItems] = useState([]);
  const [company, setCompany] = useState({ name: "CPU", phone: "", lineId: "", lineUrl: "" });
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState("");
  const [detail, setDetail] = useState(null);
  const [order, setOrder] = useState(null); // {item, sizeQty, color, name, phone, address, note}
  const [sent, setSent] = useState(false);

  useEffect(() => {
    const u1 = onSnapshot(collection(db, "clothing"), s =>
      setItems(s.docs.map(d => ({ ...d.data(), id: d.id }))
        .filter(it => !it.hideFromCatalog)
        .filter(it => (it.name || "").trim().length > 0)) // ❌ ซ่อนสินค้าที่ยังไม่มีชื่อ
    );
    const u2 = onSnapshot(doc(db, "settings", "company"), s => {
      if (s.exists()) setCompany(prev => ({ ...prev, ...s.data() }));
    });
    return () => { u1(); u2(); };
  }, []);

  const cats = useMemo(() => [...new Set(items.map(i => i.category).filter(Boolean))], [items]);
  const filtered = useMemo(() => items.filter(i => {
    if (filterCat && i.category !== filterCat) return false;
    if (search) {
      // normalize: lowercase + ลบ space — "CPU125" จะ match "CPU 125"
      const norm = (s) => String(s||"").toLowerCase().replace(/\s+/g, "");
      const q = norm(search);
      const text = norm(`${i.name||""} ${i.category||""} ${(i.colors||[]).map(c=>c.name).join(" ")}`);
      if (!text.includes(q)) return false;
    }
    return true;
  }), [items, search, filterCat]);

  // 💬 LINE link: @xxx (OA) → ใช้ตรงๆ, ส่วน personal ID → prefix ~
  const lineHref = company.lineUrl
    || (company.lineId
        ? (company.lineId.startsWith("@")
            ? `https://line.me/R/ti/p/${encodeURIComponent(company.lineId)}`
            : `https://line.me/R/ti/p/~${encodeURIComponent(company.lineId)}`)
        : "");

  return (
    <div style={{ minHeight: "100vh", background: T.bg, fontFamily: "'Sarabun',sans-serif", color: T.text }}>
      {/* HEADER */}
      <div style={{ background: "white", borderBottom: `1px solid ${T.border}`, position: "sticky", top: 0, zIndex: 10 }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", padding: "14px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 800, color: T.blue, letterSpacing: 1 }}>{company.name || "CPU"}</div>
            <div style={{ fontSize: 12, color: T.sub }}>แคตตาล็อกสินค้า • Catalog</div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {lineHref && (
              <a href={lineHref} target="_blank" rel="noreferrer" style={{ background: T.line, color: "white", padding: "10px 16px", borderRadius: 8, fontSize: 13, fontWeight: 700, textDecoration: "none", display: "flex", alignItems: "center", gap: 6 }}>
                💬 LINE {company.lineId || ""}
              </a>
            )}
            {company.phone && (
              <a href={`tel:${company.phone}`} style={{ background: T.blue, color: "white", padding: "10px 16px", borderRadius: 8, fontSize: 13, fontWeight: 700, textDecoration: "none" }}>
                📞 {company.phone}
              </a>
            )}
          </div>
        </div>
      </div>

      {/* SEARCH + FILTER */}
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "16px 20px", display: "flex", gap: 10, flexWrap: "wrap" }}>
        <input
          placeholder="🔍 ค้นหารุ่น / สี / หมวด..."
          value={search} onChange={e => setSearch(e.target.value)}
          style={{ flex: 1, minWidth: 200, padding: "10px 14px", borderRadius: 8, border: `1px solid ${T.border}`, fontSize: 14, fontFamily: "inherit" }}
        />
        <select value={filterCat} onChange={e => setFilterCat(e.target.value)}
          style={{ padding: "10px 14px", borderRadius: 8, border: `1px solid ${T.border}`, fontSize: 14, fontFamily: "inherit", background: "white" }}>
          <option value="">ทุกหมวด</option>
          {cats.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {/* GRID */}
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "0 20px 40px" }}>
        {filtered.length === 0 ? (
          <div style={{ textAlign: "center", padding: 60, color: T.muted }}>
            <div style={{ fontSize: 48 }}>📦</div>
            <div style={{ marginTop: 10 }}>ไม่พบสินค้า</div>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 14 }}>
            {filtered.map(it => {
              const totalStock = (it.colors || []).reduce((s, c) => s + Object.values(c.stock || {}).reduce((a, v) => a + (Number(v)||0), 0), 0);
              const inStock = totalStock > 0;
              const cover = it.image || (it.colors && it.colors[0] && it.colors[0].image);
              return (
                <div key={it.id} onClick={() => setDetail(it)}
                  style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, overflow: "hidden", cursor: "pointer", transition: "transform .15s, box-shadow .15s" }}
                  onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 8px 24px rgba(0,0,0,.08)"; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = ""; e.currentTarget.style.boxShadow = ""; }}>
                  <div style={{ width: "100%", aspectRatio: "1/1", background: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                    {cover ? <img src={cover} alt={it.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      : <div style={{ fontSize: 56, color: T.muted }}>👕</div>}
                  </div>
                  <div style={{ padding: 12 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, color: T.text, marginBottom: 4 }}>{it.name}</div>
                    {it.category && <div style={{ fontSize: 11, color: T.muted, marginBottom: 6 }}>{it.category}</div>}
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 8 }}>
                      {(it.colors || []).slice(0, 8).map((c, i) => (
                        <div key={i} title={c.name} style={{ width: 16, height: 16, borderRadius: "50%", background: c.hex || "#ddd", border: "1px solid rgba(0,0,0,.2)" }} />
                      ))}
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 11, color: inStock ? T.green : "#b94a48", fontWeight: 600 }}>
                        {inStock ? `✓ มีสินค้า` : "✗ สินค้าหมด"}
                      </span>
                      <span style={{ fontSize: 11, color: T.blue, fontWeight: 600 }}>ดูรายละเอียด →</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* DETAIL MODAL */}
      {detail && (
        <div onClick={() => setDetail(null)} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.65)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 12 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "white", borderRadius: 14, maxWidth: 540, width: "100%", maxHeight: "92vh", overflowY: "auto" }}>
            <div style={{ padding: 18, display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: `1px solid ${T.border}` }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 800, color: T.text }}>{detail.name}</div>
                {detail.category && <div style={{ fontSize: 12, color: T.sub, marginTop: 2 }}>{detail.category}</div>}
              </div>
              <button onClick={() => setDetail(null)} style={{ background: "none", border: `1px solid ${T.border}`, borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}>✕</button>
            </div>
            <div style={{ padding: 18 }}>
              {(detail.colors || []).map((c, ci) => {
                const stocks = c.stock || {};
                return (
                  <div key={ci} style={{ marginBottom: 14, padding: 12, background: "#f8fafc", borderRadius: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                      <div style={{ width: 22, height: 22, borderRadius: "50%", background: c.hex || "#ddd", border: "1px solid rgba(0,0,0,.2)" }} />
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{c.name}</div>
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {Object.entries(stocks).map(([sz, n]) => (
                        <div key={sz} style={{ padding: "5px 10px", background: Number(n) > 0 ? "#dcfce7" : "#fee2e2", color: Number(n) > 0 ? "#166534" : "#991b1b", borderRadius: 6, fontSize: 12, fontWeight: 600 }}>
                          {sz}: {Number(n) > 0 ? "มี" : "หมด"}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ padding: 14, borderTop: `1px solid ${T.border}`, display: "flex", gap: 8, background: "#f8fafc", borderRadius: "0 0 14px 14px" }}>
              {lineHref && (
                <a href={lineHref} target="_blank" rel="noreferrer" style={{ flex: 1, background: T.line, color: "white", padding: "12px", textAlign: "center", borderRadius: 8, textDecoration: "none", fontWeight: 700, fontSize: 13 }}>💬 ติดต่อ LINE</a>
              )}
              <button onClick={() => { setOrder({ item: detail, name: "", phone: "", address: "", note: "", qtyMap: {} }); setDetail(null); }}
                style={{ flex: 1, background: T.blue, color: "white", padding: "12px", border: "none", borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>🛒 สั่งซื้อ</button>
            </div>
          </div>
        </div>
      )}

      {/* ORDER FORM */}
      {order && (
        <div onClick={() => !sent && setOrder(null)} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.65)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 110, padding: 12 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "white", borderRadius: 14, maxWidth: 720, width: "100%", maxHeight: "92vh", overflowY: "auto" }}>
            {sent ? (
              <div style={{ padding: 36, textAlign: "center" }}>
                <div style={{ fontSize: 56 }}>✅</div>
                <div style={{ fontSize: 18, fontWeight: 700, marginTop: 10, color: T.green }}>ส่งคำสั่งซื้อเรียบร้อย!</div>
                <div style={{ fontSize: 13, color: T.sub, marginTop: 6 }}>ทีมงานจะติดต่อกลับโดยเร็ว</div>
                <button onClick={() => { setOrder(null); setSent(false); }} style={{ marginTop: 18, background: T.blue, color: "white", padding: "10px 26px", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 700 }}>ปิด</button>
              </div>
            ) : (
              <>
                <div style={{ padding: 16, borderBottom: `1px solid ${T.border}` }}>
                  <div style={{ fontSize: 16, fontWeight: 800 }}>🛒 สั่งซื้อ: {order.item.name}</div>
                  <div style={{ fontSize: 11, color: T.muted, marginTop: 4 }}>กรอกข้อมูล → ทีมงานจะติดต่อกลับเพื่อยืนยันยอด</div>
                </div>
                <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
                  <Field label="ชื่อ / ร้านค้า *" value={order.name} onChange={v => setOrder({ ...order, name: v })} />
                  <Field label="เบอร์โทร *" value={order.phone} onChange={v => setOrder({ ...order, phone: v })} />
                  <Field label="ที่อยู่จัดส่ง" value={order.address} onChange={v => setOrder({ ...order, address: v })} textarea />

                  <div style={{ fontSize: 12, color: T.sub, fontWeight: 600, marginTop: 6 }}>รายการสั่งซื้อ (กรอกจำนวนในช่องไซส์ที่ต้องการ)</div>
                  {(() => {
                    const colors = order.item.colors || [];
                    // union sizes across all colors, sorted by SIZES order
                    const SIZES_ORDER = ["XS","S","M","L","XL","2XL","3XL","4XL","5XL","6XL"];
                    const allSizes = [...new Set(colors.flatMap(c => Object.keys(c.stock || {})))]
                      .sort((a,b) => {
                        const ia = SIZES_ORDER.indexOf(a), ib = SIZES_ORDER.indexOf(b);
                        if (ia >= 0 && ib >= 0) return ia - ib;
                        if (ia >= 0) return -1; if (ib >= 0) return 1;
                        return a.localeCompare(b);
                      });
                    const setQty = (ci, sz, v) => {
                      const qtyMap = { ...(order.qtyMap || {}) };
                      qtyMap[ci] = { ...(qtyMap[ci] || {}) };
                      const n = Math.max(0, Number(v) || 0);
                      if (n === 0) delete qtyMap[ci][sz]; else qtyMap[ci][sz] = n;
                      if (Object.keys(qtyMap[ci]).length === 0) delete qtyMap[ci];
                      setOrder({ ...order, qtyMap });
                    };
                    const grandTotal = Object.values(order.qtyMap || {}).reduce((s, row) => s + Object.values(row).reduce((a,b) => a+b, 0), 0);

                    return (
                      <div style={{ overflowX: "auto", border: `1px solid ${T.border}`, borderRadius: 8 }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                          <thead>
                            <tr style={{ background: "#eef2f7" }}>
                              <th style={{ padding: "8px 10px", textAlign: "left", fontWeight: 700, color: T.blue, borderBottom: `1px solid ${T.border}`, minWidth: 110 }}>สี</th>
                              {allSizes.map(sz => (
                                <th key={sz} style={{ padding: "8px 6px", textAlign: "center", fontWeight: 700, color: T.blue, borderBottom: `1px solid ${T.border}`, borderLeft: `1px solid ${T.border}`, minWidth: 56 }}>{sz}</th>
                              ))}
                              <th style={{ padding: "8px 10px", textAlign: "center", fontWeight: 700, color: T.green, borderBottom: `1px solid ${T.border}`, borderLeft: `1px solid ${T.border}`, minWidth: 60 }}>รวม</th>
                            </tr>
                          </thead>
                          <tbody>
                            {colors.map((c, ci) => {
                              const rowQty = Object.values((order.qtyMap||{})[ci] || {}).reduce((a,b) => a+b, 0);
                              const colorLabel = c.name || guessColorName(c.hex, ci);
                              return (
                                <tr key={ci} style={{ background: ci % 2 ? "#fafbfc" : "white" }}>
                                  <td style={{ padding: "6px 10px", borderBottom: `1px solid ${T.border}` }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                      <div style={{ width: 14, height: 14, borderRadius: 3, background: c.hex || "#ddd", border: "1px solid rgba(0,0,0,.2)" }} />
                                      <span style={{ fontSize: 12, fontWeight: 600 }}>{colorLabel}</span>
                                    </div>
                                  </td>
                                  {allSizes.map(sz => {
                                    const inStock = (c.stock || {})[sz];
                                    const has = inStock !== undefined && inStock !== null;
                                    const isOut = has && Number(inStock) <= 0;
                                    const val = ((order.qtyMap||{})[ci] || {})[sz] || "";
                                    return (
                                      <td key={sz} style={{ padding: 3, borderLeft: `1px solid ${T.border}`, borderBottom: `1px solid ${T.border}`, background: !has ? "#f1f5f9" : isOut ? "#fef2f2" : "transparent" }}>
                                        {has ? (
                                          <input type="number" min="0" value={val}
                                            onFocus={e => e.target.select()}
                                            onChange={e => setQty(ci, sz, e.target.value)}
                                            style={{ width: "100%", padding: "6px 4px", border: "none", background: "transparent", textAlign: "center", fontSize: 13, fontWeight: 600, color: val ? T.blue : T.text, outline: "none", fontFamily: "inherit" }}
                                          />
                                        ) : <div style={{ textAlign: "center", color: T.muted, fontSize: 11 }}>—</div>}
                                      </td>
                                    );
                                  })}
                                  <td style={{ padding: "6px 10px", textAlign: "center", borderLeft: `1px solid ${T.border}`, borderBottom: `1px solid ${T.border}`, fontWeight: 700, color: rowQty > 0 ? T.green : T.muted, fontSize: 13 }}>{rowQty || "-"}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                          <tfoot>
                            <tr style={{ background: "#f1f5f9" }}>
                              <td colSpan={allSizes.length + 1} style={{ padding: "8px 10px", textAlign: "right", fontWeight: 700, color: T.sub }}>รวมทั้งหมด</td>
                              <td style={{ padding: "8px 10px", textAlign: "center", fontWeight: 800, color: grandTotal > 0 ? T.green : T.muted, fontSize: 14 }}>{grandTotal || 0}</td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    );
                  })()}

                  <Field label="หมายเหตุ (ถ้ามี)" value={order.note} onChange={v => setOrder({ ...order, note: v })} textarea />
                </div>
                <div style={{ padding: 14, borderTop: `1px solid ${T.border}`, display: "flex", gap: 8, background: "#f8fafc", borderRadius: "0 0 14px 14px" }}>
                  <button onClick={() => setOrder(null)} style={{ flex: 1, background: "white", border: `1px solid ${T.border}`, padding: 12, borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}>ยกเลิก</button>
                  <button onClick={async () => {
                    if (!order.name.trim() || !order.phone.trim()) { alert("กรุณากรอกชื่อและเบอร์โทร"); return; }
                    // flatten qtyMap → lines
                    const valid = [];
                    Object.entries(order.qtyMap || {}).forEach(([ci, row]) => {
                      const idx = Number(ci);
                      const col = (order.item?.colors || [])[idx];
                      if (!col) return;
                      Object.entries(row).forEach(([size, qty]) => {
                        if (qty > 0) valid.push({
                          colorIdx: idx, // 🔑 ใช้ index ตรง ๆ — convert จะ lookup จาก index ไม่ใช่ชื่อ
                          color: col.name || guessColorName(col.hex, idx),
                          colorHex: col.hex || "",
                          size: size || "",
                          qty: Number(qty) || 0,
                        });
                      });
                    });
                    if (valid.length === 0) { alert("กรุณากรอกจำนวนอย่างน้อย 1 ช่อง"); return; }
                    try {
                      // build payload + ลบ undefined ออกทั้งหมด (Firestore ไม่รับ undefined)
                      const payload = {
                        customerName: (order.name || "").trim(),
                        phone: (order.phone || "").trim(),
                        address: (order.address || "").trim(),
                        note: (order.note || "").trim(),
                        itemId: (order.item && order.item.id) || "",
                        itemName: (order.item && order.item.name) || "(ไม่ระบุชื่อสินค้า)",
                        itemCategory: (order.item && order.item.category) || "",
                        lines: valid,
                        totalQty: valid.reduce((s, l) => s + (Number(l.qty) || 0), 0),
                        status: "new",
                        source: "catalog",
                        createdAt: serverTimestamp(),
                      };
                      // strip undefined recursively
                      const clean = JSON.parse(JSON.stringify(payload, (k, v) => v === undefined ? null : v));
                      clean.createdAt = serverTimestamp(); // serverTimestamp ผ่าน JSON ไม่ได้ → ใส่กลับ
                      await addDoc(collection(db, "catalogOrders"), clean);
                      setSent(true);
                    } catch (e) {
                      alert("เกิดข้อผิดพลาด: " + e.message);
                    }
                  }} style={{ flex: 2, background: T.green, color: "white", padding: 12, border: "none", borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontWeight: 700 }}>📨 ส่งคำสั่งซื้อ</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* FOOTER */}
      <div style={{ borderTop: `1px solid ${T.border}`, padding: "20px", textAlign: "center", fontSize: 11, color: T.muted, background: "white" }}>
        © {new Date().getFullYear()} {company.name || "CPU"} • Powered by CPU ERP
      </div>
    </div>
  );
}

function Field({ label, value, onChange, textarea = false }) {
  return (
    <div>
      <label style={{ fontSize: 11, color: T.sub, fontWeight: 600, display: "block", marginBottom: 4 }}>{label}</label>
      {textarea ? (
        <textarea value={value} onChange={e => onChange(e.target.value)} rows={2}
          style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: `1px solid ${T.border}`, fontSize: 13, fontFamily: "inherit", resize: "vertical", boxSizing: "border-box" }} />
      ) : (
        <input value={value} onChange={e => onChange(e.target.value)}
          style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: `1px solid ${T.border}`, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }} />
      )}
    </div>
  );
}
