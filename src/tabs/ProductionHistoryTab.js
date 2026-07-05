// 📜 ประวัติการผลิต — รายการที่ archived จาก Kanban
import { useState, useMemo } from "react";
import { db } from "../firebase";
import { doc, updateDoc, deleteDoc } from "firebase/firestore";
import { T } from "../theme";
import { getLots } from "../utils/productionLots";

const fmtInt = (n) => Number(n || 0).toLocaleString("th-TH");
const THAI_MONTHS = ["","ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];

// key เดือนจาก archivedAt (ตกกลุ่ม "ไม่ระบุ" ถ้าไม่มีวันที่)
function monthKeyOf(order) {
  if (!order.archivedAt) return "ไม่ระบุ";
  const d = new Date(order.archivedAt);
  if (isNaN(d.getTime())) return "ไม่ระบุ";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function monthLabelOf(key) {
  if (key === "ไม่ระบุ") return "ไม่ระบุวันที่";
  const [y, m] = key.split("-");
  return `${THAI_MONTHS[Number(m)]} ${Number(y) + 543}`;
}

export default function ProductionHistoryTab({ productionOrders = [], customOrders = [], user, role }) {
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("all"); // all | normal | custom
  const [sort, setSort] = useState("newest"); // newest | oldest
  const [expandedId, setExpandedId] = useState(null); // แถวที่กำลังเปิดดูรายละเอียด
  const [collapsedMonths, setCollapsedMonths] = useState({}); // { [monthKey]: true } — พับไว้

  const allArchived = useMemo(() => {
    const list = [];
    productionOrders.filter(o => o.archived).forEach(o => list.push({ ...o, __isCustom: false, __collection: "productionOrders" }));
    customOrders.filter(o => o.archived).forEach(o => list.push({ ...o, __isCustom: true, __collection: "customOrders" }));
    return list;
  }, [productionOrders, customOrders]);

  const filtered = useMemo(() => {
    let list = allArchived;
    if (filterType === "normal") list = list.filter(o => !o.__isCustom);
    if (filterType === "custom") list = list.filter(o => o.__isCustom);
    if (search) {
      const q = search.toLowerCase().trim();
      list = list.filter(o => (o.prodNo||"").toLowerCase().includes(q) || (o.clothingName||"").toLowerCase().includes(q) || (o.customerName||"").toLowerCase().includes(q));
    }
    list.sort((a,b) => {
      const ta = new Date(a.archivedAt || 0).getTime();
      const tb = new Date(b.archivedAt || 0).getTime();
      return sort === "newest" ? tb - ta : ta - tb;
    });
    return list;
  }, [allArchived, filterType, search, sort]);

  const totalQty = filtered.reduce((s,o) => s + (Number(o.totalQty)||0), 0);

  // 📅 จัดกลุ่มตามเดือน (archivedAt) — เรียงเดือนตามลำดับ sort ปัจจุบัน
  const monthGroups = useMemo(() => {
    const map = new Map();
    filtered.forEach(o => {
      const k = monthKeyOf(o);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(o);
    });
    const keys = Array.from(map.keys()).sort((a, b) => sort === "newest" ? b.localeCompare(a) : a.localeCompare(b));
    return keys.map(k => ({ key: k, label: monthLabelOf(k), items: map.get(k) }));
  }, [filtered, sort]);

  const toggleMonth = (k) => setCollapsedMonths(p => ({ ...p, [k]: !p[k] }));

  const restore = async (order) => {
    if (!window.confirm(`คืน "${order.prodNo}" กลับไป Kanban?`)) return;
    try {
      await updateDoc(doc(db, order.__collection, order.id), {
        archived: false,
        restoredAt: new Date().toISOString(),
        restoredBy: user?.name || "",
      });
    } catch (e) { alert("คืนไม่สำเร็จ: " + e.message); }
  };

  const permanentDelete = async (order) => {
    if (user?.role !== "admin") { alert("ลบถาวรได้เฉพาะ admin"); return; }
    if (!window.confirm(`⚠️ ลบ "${order.prodNo}" ถาวร?\n\nย้อนกลับไม่ได้ — แนะนำ Backup ก่อน`)) return;
    if (!window.confirm(`ยืนยันอีกครั้ง — ลบ "${order.prodNo}" จาก ${order.__collection}?`)) return;
    try { await deleteDoc(doc(db, order.__collection, order.id)); }
    catch (e) { alert("ลบไม่สำเร็จ: " + e.message); }
  };

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: T.text }}>📜 ประวัติการผลิต</div>
        <div style={{ fontSize: 12, color: T.muted, marginTop: 4 }}>
          ใบสั่งผลิตที่เก็บออกจาก Kanban — restore กลับได้ตลอด · {allArchived.length} ใบ
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 14, alignItems: "center", flexWrap: "wrap", padding: 10, background: T.card, borderRadius: 10, border: `1px solid ${T.border}` }}>
        <input value={search} onChange={e=>setSearch(e.target.value)}
          placeholder="🔍 ค้นเลขที่/ชื่อรุ่น/ลูกค้า..."
          style={{ flex: "1 1 220px", padding: "8px 12px", borderRadius: 8, border: `1px solid ${T.border}`, fontSize: 13, fontFamily: "inherit" }}/>
        <select value={filterType} onChange={e=>setFilterType(e.target.value)}
          style={{ padding: "8px 10px", borderRadius: 8, border: `1px solid ${T.border}`, fontSize: 13, fontFamily: "inherit" }}>
          <option value="all">ทุกประเภท</option>
          <option value="normal">🏭 Production ปกติ</option>
          <option value="custom">🎨 Custom</option>
        </select>
        <select value={sort} onChange={e=>setSort(e.target.value)}
          style={{ padding: "8px 10px", borderRadius: 8, border: `1px solid ${T.border}`, fontSize: 13, fontFamily: "inherit" }}>
          <option value="newest">ใหม่ → เก่า</option>
          <option value="oldest">เก่า → ใหม่</option>
        </select>
        <span style={{ fontSize: 11, color: T.muted, marginLeft: 8 }}>
          แสดง <b style={{color:T.blue}}>{filtered.length}</b> ใบ · <b>{fmtInt(totalQty)}</b> ตัว
        </span>
      </div>

      {filtered.length === 0 ? (
        <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 50, textAlign: "center", color: T.muted }}>
          <div style={{ fontSize: 48, marginBottom: 10 }}>📭</div>
          <div>{allArchived.length === 0 ? "ยังไม่มีงานในประวัติ — ไปที่ Kanban แล้วกดปุ่ม 📦 ที่ส่วนหัวคอลัมน์" : "ไม่พบรายการ"}</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {monthGroups.map(({ key, label, items }) => {
            const monthCollapsed = collapsedMonths[key];
            const monthQty = items.reduce((s,o) => s + (Number(o.totalQty)||0), 0);
            return (
              <div key={key}>
                <div onClick={() => toggleMonth(key)}
                  style={{ padding: "8px 14px", background: "linear-gradient(90deg,#3b5b8b,#5b7ba8)", borderRadius: 10, display: "flex", alignItems: "center", gap: 10, cursor: "pointer", userSelect: "none", marginBottom: monthCollapsed ? 0 : 8 }}>
                  <div style={{ width: 18, height: 18, color: "white", fontSize: 10, display: "flex", alignItems: "center", justifyContent: "center", transition: "transform 0.2s", transform: monthCollapsed ? "rotate(-90deg)" : "rotate(0deg)" }}>▼</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "white" }}>📅 {label}</div>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.85)" }}>{items.length} ใบ · {fmtInt(monthQty)} ตัว</div>
                </div>
                {!monthCollapsed && (
                  <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" }}>
                    {items.map((order, i) => {
                      const rowKey = `${order.__collection}-${order.id}`;
                      const isOpen = expandedId === rowKey;
                      const lots = getLots(order);
                      const colors = Array.from(new Set(lots.flatMap(l => (l.items||[]).map(i => i.colorName))));
                      const archivedDate = order.archivedAt ? new Date(order.archivedAt).toLocaleDateString("th-TH") : "—";
                      const thumb = order.clothingImages?.[0]?.dataUrl || order.clothingImage || "";
                      return (
                        <div key={rowKey} style={{ borderBottom: i < items.length - 1 ? `1px solid ${T.border}` : "none" }}>
                          <div onClick={() => setExpandedId(isOpen ? null : rowKey)}
                            style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", cursor: "pointer", background: isOpen ? "rgba(59,91,139,0.05)" : "transparent" }}
                            onMouseEnter={e => { if (!isOpen) e.currentTarget.style.background = "rgba(59,91,139,0.03)"; }}
                            onMouseLeave={e => { if (!isOpen) e.currentTarget.style.background = "transparent"; }}>
                            <div style={{ width: 14, fontSize: 10, color: T.muted, transition: "transform 0.2s", transform: isOpen ? "rotate(90deg)" : "rotate(0deg)", flexShrink: 0 }}>▶</div>
                            {order.__isCustom && (
                              <span style={{ padding: "1px 6px", fontSize: 9, background: "rgba(217,119,6,0.12)", color: "#d97706", borderRadius: 5, fontWeight: 700, flexShrink: 0 }}>🎨</span>
                            )}
                            <span style={{ fontFamily: "monospace", fontSize: 11, color: T.accent, fontWeight: 700, flexShrink: 0 }}>{order.prodNo}</span>
                            <span style={{ fontSize: 13, fontWeight: 600, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>{order.clothingName}</span>
                            {order.customerName && <span style={{ fontSize: 11, color: T.muted, flexShrink: 0 }}>👤 {order.customerName}</span>}
                            <span style={{ fontFamily: "monospace", fontWeight: 700, color: T.text, fontSize: 13, flexShrink: 0 }}>{fmtInt(order.totalQty||0)}</span>
                          </div>
                          {isOpen && (
                            <div style={{ padding: "0 14px 12px 38px", display: "flex", gap: 12 }}>
                              {thumb ? (
                                <img src={thumb} alt="" style={{ width: 72, height: 72, borderRadius: 8, objectFit: "cover", border: `1px solid ${T.border}`, flexShrink: 0 }}/>
                              ) : (
                                <div style={{ width: 72, height: 72, borderRadius: 8, border: `1px dashed ${T.border}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, color: T.muted, flexShrink: 0 }}>
                                  {order.__isCustom ? "🎨" : "👕"}
                                </div>
                              )}
                              <div style={{ flex: 1, minWidth: 0 }}>
                                {colors.length > 0 && (
                                  <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginBottom: 8 }}>
                                    {colors.map((c,ci) => (
                                      <span key={ci} style={{ padding: "1px 6px", fontSize: 10, background: "rgba(59,91,139,0.08)", color: T.accent, borderRadius: 6 }}>{c}</span>
                                    ))}
                                  </div>
                                )}
                                <div style={{ fontSize: 10, color: T.muted, marginBottom: 8, padding: "4px 8px", background: "#f8fafc", borderRadius: 5 }}>
                                  📦 เก็บเมื่อ {archivedDate}
                                  {order.archivedBy && <> · โดย {order.archivedBy}</>}
                                  {order.archivedFromStep && <> · จากช่อง <b>{order.archivedFromStep}</b></>}
                                </div>
                                <div style={{ display: "flex", gap: 6 }} onClick={e => e.stopPropagation()}>
                                  <button onClick={()=>restore(order)}
                                    style={{ background: "#eff6ff", color: T.blue, border: `1px solid ${T.blue}`, padding: "6px 12px", borderRadius: 6, cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: 600 }}>↩️ คืนกลับ Kanban</button>
                                  {user?.role === "admin" && (
                                    <button onClick={()=>permanentDelete(order)} title="ลบถาวร (admin only)"
                                      style={{ background: "#fef2f2", color: T.red, border: `1px solid #fecaca`, padding: "6px 10px", borderRadius: 6, cursor: "pointer", fontFamily: "inherit", fontSize: 12 }}>🗑 ลบถาวร</button>
                                  )}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
