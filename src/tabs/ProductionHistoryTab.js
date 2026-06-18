// 📜 ประวัติการผลิต — รายการที่ archived จาก Kanban
import { useState, useMemo } from "react";
import { db } from "../firebase";
import { doc, updateDoc, deleteDoc } from "firebase/firestore";
import { T } from "../theme";
import { totalQtyOfLot, getLots } from "../utils/productionLots";

const fmtInt = (n) => Number(n || 0).toLocaleString("th-TH");

export default function ProductionHistoryTab({ productionOrders = [], customOrders = [], user, role }) {
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("all"); // all | normal | custom
  const [sort, setSort] = useState("newest"); // newest | oldest

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
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 10 }}>
          {filtered.map(order => {
            const thumb = order.clothingImages?.[0]?.dataUrl || order.clothingImage || "";
            const lots = getLots(order);
            const colors = Array.from(new Set(lots.flatMap(l => (l.items||[]).map(i => i.colorName))));
            const archivedDate = order.archivedAt ? new Date(order.archivedAt).toLocaleDateString("th-TH") : "—";
            return (
              <div key={`${order.__collection}-${order.id}`} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: 12, position: "relative" }}>
                <div style={{ display: "flex", gap: 10, marginBottom: 8 }}>
                  {thumb ? (
                    <img src={thumb} alt="" style={{ width: 56, height: 56, borderRadius: 6, objectFit: "cover", border: `1px solid ${T.border}` }}/>
                  ) : (
                    <div style={{ width: 56, height: 56, borderRadius: 6, border: `1px dashed ${T.border}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, color: T.muted }}>
                      {order.__isCustom ? "🎨" : "👕"}
                    </div>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      {order.__isCustom && (
                        <span style={{ padding: "1px 6px", fontSize: 9, background: "rgba(217,119,6,0.12)", color: "#d97706", borderRadius: 5, fontWeight: 700 }}>🎨 Custom</span>
                      )}
                      <span style={{ fontFamily: "monospace", fontSize: 11, color: T.accent, fontWeight: 700 }}>{order.prodNo}</span>
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: T.text, marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{order.clothingName}</div>
                    {order.customerName && <div style={{ fontSize: 11, color: T.muted }}>👤 {order.customerName}</div>}
                  </div>
                  <div style={{ textAlign: "right", fontFamily: "monospace", fontWeight: 700, color: T.text, fontSize: 16 }}>{fmtInt(order.totalQty||0)}</div>
                </div>

                {colors.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginBottom: 8 }}>
                    {colors.slice(0,5).map((c,i) => (
                      <span key={i} style={{ padding: "1px 6px", fontSize: 10, background: "rgba(59,91,139,0.08)", color: T.accent, borderRadius: 6 }}>{c}</span>
                    ))}
                    {colors.length > 5 && <span style={{ fontSize: 10, color: T.muted }}>+{colors.length-5}</span>}
                  </div>
                )}

                <div style={{ fontSize: 10, color: T.muted, marginBottom: 8, padding: "4px 8px", background: "#f8fafc", borderRadius: 5 }}>
                  📦 เก็บเมื่อ {archivedDate}
                  {order.archivedBy && <> · โดย {order.archivedBy}</>}
                  {order.archivedFromStep && <> · จากช่อง <b>{order.archivedFromStep}</b></>}
                </div>

                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={()=>restore(order)}
                    style={{ flex: 1, background: "#eff6ff", color: T.blue, border: `1px solid ${T.blue}`, padding: "6px 12px", borderRadius: 6, cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: 600 }}>↩️ คืนกลับ Kanban</button>
                  {user?.role === "admin" && (
                    <button onClick={()=>permanentDelete(order)} title="ลบถาวร (admin only)"
                      style={{ background: "#fef2f2", color: T.red, border: `1px solid #fecaca`, padding: "6px 10px", borderRadius: 6, cursor: "pointer", fontFamily: "inherit", fontSize: 12 }}>🗑</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
