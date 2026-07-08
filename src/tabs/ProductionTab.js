import React, { useState, useMemo } from "react";
import { deleteDoc, doc, collection, getDocs, writeBatch } from "firebase/firestore";
import { db } from "../firebase";
import { logAudit, AUDIT_ACTIONS } from "../utils/audit";
import BOMEditor from "../components/BOMEditor";
import NewProductionOrderModal from "../components/NewProductionOrderModal";
import NewCustomOrderModal from "../components/NewCustomOrderModal";
import ProductionStatusModal from "../components/ProductionStatusModal";
import PrintProductionOrder from "../components/PrintProductionOrder";
import KanbanBoard from "../components/KanbanBoard";
import { getLots } from "../utils/productionLots";

const T = {
  card:"#ffffff", border:"#e3e8ef", text:"#1f2a44", sub:"#5b6b85", muted:"#8a9bb3",
  accent:"#3b5b8b", input:"#f6f8fb", inputBorder:"#d8dee9", red:"#dc2626", green:"#16a34a", amber:"#d97706"
};
const fmt = (n) => Number(n || 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtInt = (n) => Number(n || 0).toLocaleString("th-TH");

const STATUS_COLORS = {
  "พิมพ์ลาย": "#0ea5e9",
  "ตัดผ้า": "#6366f1",
  "รีดลงผ้า": "#8b5cf6",
  "เย็บ": "#ec4899",
  "รีดให้เรียบ": "#f59e0b",
  "แพ๊ค/QC": "#d97706",
  "เข้าคลัง": "#16a34a",
  "ยกเลิก": "#dc2626",
};

function parseThaiDate(s) {
  if (!s) return null;
  const [d,m,y] = String(s).slice(0,10).split("/");
  if (!d||!m||!y) return null;
  return new Date(`${y}-${m.padStart(2,"0")}-${d.padStart(2,"0")}`);
}

export default function ProductionTab({ productionOrders=[], customOrders=[], boms=[], products=[], clothingItems=[], customers=[], companyInfo={}, user, role, printElementById, onCreateInvoiceFromCustom }) {
  const [subTab, setSubTab] = useState("kanban"); // kanban | orders | custom | bom
  const [showNew, setShowNew] = useState(false);
  const [editProdOrder, setEditProdOrder] = useState(null); // ✏️ ใบสั่งผลิตที่กำลังแก้ไข
  const [showNewCustom, setShowNewCustom] = useState(false);
  const [selectedCustom, setSelectedCustom] = useState(new Set()); // ids ของ custom orders ที่เลือกเพื่อออกบิลรวม
  const [customSubTab, setCustomSubTab] = useState("active"); // active | done | all
  const [statusOrder, setStatusOrder] = useState(null);
  const [statusCustom, setStatusCustom] = useState(null);
  const [printOrder, setPrintOrder] = useState(null);
  const [editBom, setEditBom] = useState(null);   // null | {} (new) | {existing}
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [statusFilter, setStatusFilter] = useState("ทั้งหมด");

  const filteredOrders = useMemo(() => {
    return productionOrders.filter(o => {
      if (search) {
        const q = search.toLowerCase();
        const hit = (o.prodNo||"").toLowerCase().includes(q) || (o.clothingName||"").toLowerCase().includes(q);
        if (!hit) return false;
      }
      if (statusFilter !== "ทั้งหมด" && (o.status||"") !== statusFilter) return false;
      const od = parseThaiDate(o.date);
      if (dateFrom) { const f = new Date(dateFrom); if (!od || od < f) return false; }
      if (dateTo)   { const t = new Date(dateTo); t.setHours(23,59,59); if (!od || od > t) return false; }
      return true;
    });
  }, [productionOrders, search, statusFilter, dateFrom, dateTo]);

  const totalQtyAll = filteredOrders.reduce((s,o) => s + (Number(o.totalQty)||0), 0);

  const setPreset = (k) => {
    const today = new Date(); const y=today.getFullYear(); const m=today.getMonth();
    const f = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
    if (k==="all") { setDateFrom(""); setDateTo(""); }
    else if (k==="today") { setDateFrom(f(today)); setDateTo(f(today)); }
    else if (k==="month") { setDateFrom(f(new Date(y,m,1))); setDateTo(f(new Date(y,m+1,0))); }
    else if (k==="year") { setDateFrom(f(new Date(y,0,1))); setDateTo(f(new Date(y,11,31))); }
  };

  const handleDeleteBom = async (b) => {
    if (!window.confirm(`ลบ BOM สำหรับ "${b.clothingName}" ?`)) return;
    await deleteDoc(doc(db, "boms", b.id));
    logAudit(user, { action: AUDIT_ACTIONS.DELETE, collection:"boms", targetId:b.id, targetLabel:`BOM · ${b.clothingName}` });
  };

  // ลบใบสั่งผลิตทั้งใบ + sub-collection photos (สำหรับ custom + production)
  // ✏️ เปิดแก้ไขใบสั่งผลิต — อนุญาตเฉพาะใบที่ยังไม่เริ่มผลิต (กันสต๊อกวัตถุดิบ/ล็อตเพี้ยน)
  const openEditProd = (o) => {
    const lots = getLots(o);
    const started = o.materialsConsumed || o.finishedStocked || lots.length > 1 || lots.some(l => l.status !== "พิมพ์ลาย");
    if (started) {
      alert(`⚠️ แก้ไขใบ ${o.prodNo} ไม่ได้ — เริ่มผลิตไปแล้ว\n(มีล็อตเลื่อนสถานะ / แยกล็อต / ตัดวัตถุดิบไปแล้ว)\n\nถ้าต้องแก้จำนวนมาก แนะนำยกเลิกใบนี้แล้วสร้างใหม่ หรือจัดการทีละล็อตบนบอร์ด Kanban`);
      return;
    }
    setEditProdOrder(o);
  };

  const handleDeleteOrder = async (o, collectionName) => {
    const msg = `ลบใบสั่งผลิต "${o.prodNo}" ทั้งใบ?\n\n⚠️ การลบนี้ย้อนคืนไม่ได้`;
    if (!window.confirm(msg)) return;
    try {
      // ลบ photos ใน sub-collection ก่อน
      try {
        const photoSnap = await getDocs(collection(db, collectionName, o.id, "photos"));
        if (!photoSnap.empty) {
          const batch = writeBatch(db);
          photoSnap.forEach(d => batch.delete(d.ref));
          await batch.commit();
        }
      } catch (e) { console.warn("[deleteOrder] photo cleanup failed:", e); }
      await deleteDoc(doc(db, collectionName, o.id));
      logAudit(user, {
        action: AUDIT_ACTIONS.DELETE,
        collection: collectionName,
        targetId: o.id,
        targetLabel: `${o.prodNo} · ${o.clothingName || ""}`,
        note: `ลบใบสั่งผลิต (${o.status || "-"})`,
      });
    } catch (e) {
      console.error("[deleteOrder] failed:", e);
      alert("ลบไม่สำเร็จ: " + (e.message || e));
    }
  };

  return (
    <div style={{animation:"fadeUp 0.4s ease"}}>
      {/* Sub-tabs */}
      <div style={{display:"flex",gap:6,marginBottom:18,borderBottom:`1px solid ${T.border}`,flexWrap:"wrap"}}>
        {[{id:"kanban",l:"📊 Kanban (สายงาน)"},{id:"orders",l:"📋 รายการใบสั่ง"},{id:"custom",l:"🎨 Custom"},{id:"bom",l:"🧪 BOM"}].map(t => (
          <button key={t.id} onClick={()=>setSubTab(t.id)}
            style={{padding:"8px 18px",borderRadius:"8px 8px 0 0",border:"none",background:subTab===t.id?"rgba(59,91,139,0.1)":"transparent",color:subTab===t.id?T.accent:T.sub,cursor:"pointer",fontSize:13,fontWeight:subTab===t.id?700:500,fontFamily:"'Sarabun',sans-serif",borderBottom:subTab===t.id?`2px solid ${T.accent}`:"2px solid transparent"}}>
            {t.l}
          </button>
        ))}
      </div>

      {/* ── PRODUCTION ORDERS ── */}
      {/* ── KANBAN (สายงาน) ── */}
      {subTab === "kanban" && (
        <>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14,flexWrap:"wrap",gap:8}}>
            <div style={{fontSize:12,color:T.sub}}>มุมมองสายงาน — แต่ละ column เป็นขั้นตอนหนึ่ง · คลิก card เพื่อจัดการล็อต</div>
            {role?.canProduction && (
              <button onClick={()=>setShowNew(true)} style={{padding:"8px 18px",borderRadius:9,border:"none",cursor:"pointer",background:"linear-gradient(135deg,#3b5b8b,#3b5b8b)",color:"white",fontSize:12,fontWeight:600,fontFamily:"'Sarabun',sans-serif",boxShadow:"0 4px 14px rgba(59,91,139,0.3)"}}>+ สร้างใบสั่งผลิต</button>
            )}
          </div>
          <KanbanBoard
            orders={[
              ...productionOrders.map(o => ({ ...o, __collection: "productionOrders", __isCustom: false })),
              ...customOrders.map(o => ({ ...o, __collection: "customOrders", __isCustom: true })),
            ]}
            user={user} role={role}
            products={products} clothingItems={clothingItems}
            printElementById={printElementById} companyInfo={companyInfo}
          />
        </>
      )}

      {subTab === "orders" && (
        <>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
            <div style={{fontSize:12,color:T.sub}}>ใบสั่งผลิตทั้งหมด <b style={{color:T.accent}}>{productionOrders.length} ใบ</b></div>
            {role?.canProduction && (
              <button onClick={()=>setShowNew(true)} style={{padding:"8px 18px",borderRadius:9,border:"none",cursor:"pointer",background:"linear-gradient(135deg,#3b5b8b,#3b5b8b)",color:"white",fontSize:12,fontWeight:600,fontFamily:"'Sarabun',sans-serif",boxShadow:"0 4px 14px rgba(59,91,139,0.3)"}}>+ สร้างใบสั่งผลิต</button>
            )}
          </div>

          {/* Filter bar */}
          <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:14,padding:14,marginBottom:14}}>
            <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:10}}>
              <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="🔍 ค้นหาเลขที่ / รุ่นเสื้อ"
                style={{flex:"1 1 240px",background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:9,padding:"8px 12px",fontFamily:"'Sarabun',sans-serif",fontSize:13,outline:"none"}}/>
              <select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}
                style={{background:T.input,border:`1px solid ${T.inputBorder}`,borderRadius:9,padding:"8px 10px",fontSize:12,fontFamily:"'Sarabun',sans-serif"}}>
                <option>ทั้งหมด</option>
                {Object.keys(STATUS_COLORS).map(s => <option key={s}>{s}</option>)}
              </select>
              <input type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)} style={{background:T.input,border:`1px solid ${T.inputBorder}`,borderRadius:9,padding:"8px 10px",fontSize:12}}/>
              <span style={{alignSelf:"center",color:T.muted,fontSize:12}}>ถึง</span>
              <input type="date" value={dateTo} onChange={e=>setDateTo(e.target.value)} style={{background:T.input,border:`1px solid ${T.inputBorder}`,borderRadius:9,padding:"8px 10px",fontSize:12}}/>
            </div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
              {[{k:"all",l:"ทั้งหมด"},{k:"today",l:"วันนี้"},{k:"month",l:"เดือนนี้"},{k:"year",l:"ปีนี้"}].map(p=>(
                <button key={p.k} onClick={()=>setPreset(p.k)} style={{padding:"5px 12px",borderRadius:14,border:`1px solid ${T.border}`,background:"transparent",color:T.sub,cursor:"pointer",fontSize:11,fontFamily:"'Sarabun',sans-serif"}}>{p.l}</button>
              ))}
              <div style={{flex:1}}/>
              <div style={{fontSize:11,color:T.muted}}>
                พบ <b style={{color:T.accent}}>{filteredOrders.length}</b> / {productionOrders.length} ใบ
                <span style={{margin:"0 6px",color:T.border}}>·</span>
                รวม <b style={{color:"#16a34a"}}>{fmtInt(totalQtyAll)}</b> ตัว
              </div>
            </div>
          </div>

          {productionOrders.length === 0 ? (
            <div style={{textAlign:"center",padding:60,background:T.card,borderRadius:16,border:`1px solid ${T.border}`}}>
              <div style={{fontSize:48,marginBottom:12,opacity:0.3}}>🏭</div>
              <div style={{fontSize:14,fontWeight:600,color:T.accent,marginBottom:6}}>ยังไม่มีใบสั่งผลิต</div>
              {role?.canProduction && <div style={{fontSize:11,color:T.muted}}>กด "+ สร้างใบสั่งผลิต" เพื่อเริ่ม</div>}
            </div>
          ) : filteredOrders.length === 0 ? (
            <div style={{textAlign:"center",padding:40,background:T.card,borderRadius:14,border:`1px solid ${T.border}`}}>
              <div style={{fontSize:36,marginBottom:8,opacity:0.3}}>🔍</div>
              <div style={{fontSize:13,color:T.muted}}>ไม่พบใบสั่งผลิตตามที่ค้นหา</div>
            </div>
          ) : (
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              {filteredOrders.map(o => {
                const color = STATUS_COLORS[o.status] || "#6b7280";
                return (
                  <div key={o.id} onClick={()=>setStatusOrder(o)}
                    style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:14,padding:"14px 18px",cursor:"pointer",display:"grid",gridTemplateColumns:"120px 1fr 130px 130px 130px",alignItems:"center",gap:14,transition:"background 0.15s"}}
                    onMouseEnter={e=>e.currentTarget.style.background="rgba(59,91,139,0.04)"}
                    onMouseLeave={e=>e.currentTarget.style.background="white"}>
                    <div>
                      <div style={{fontFamily:"monospace",fontSize:12,color:T.accent,fontWeight:700}}>{o.prodNo}</div>
                      <div style={{fontSize:10,color:T.muted,marginTop:2}}>{o.date}</div>
                    </div>
                    <div>
                      <div style={{fontWeight:600,color:T.text,fontSize:13}}>{o.clothingName}</div>
                      <div style={{fontSize:11,color:T.muted,marginTop:2}}>{(o.items||[]).length} รายการ</div>
                    </div>
                    <div style={{textAlign:"center"}}>
                      <div style={{fontSize:11,color:T.muted}}>จำนวน</div>
                      <div style={{fontFamily:"monospace",fontWeight:700,color:T.text,fontSize:15}}>{fmtInt(o.totalQty)}</div>
                    </div>
                    <div style={{textAlign:"center"}}>
                      <span style={{padding:"4px 10px",borderRadius:14,fontSize:11,fontWeight:700,background:`${color}18`,color,border:`1px solid ${color}40`}}>{o.status}</span>
                    </div>
                    <div style={{display:"flex",gap:6,justifyContent:"flex-end"}} onClick={e=>e.stopPropagation()}>
                      <button onClick={()=>setPrintOrder(o)} title="พิมพ์" style={{padding:"6px 10px",borderRadius:7,border:"1px solid rgba(59,91,139,0.25)",background:"rgba(59,91,139,0.08)",color:T.accent,cursor:"pointer",fontSize:12}}>🖨️</button>
                      <button onClick={()=>openEditProd(o)} title="แก้ไขใบสั่งผลิต" style={{padding:"6px 10px",borderRadius:7,border:"1px solid rgba(59,91,139,0.25)",background:"rgba(59,91,139,0.08)",color:T.accent,cursor:"pointer",fontSize:12}}>✏️</button>
                      <button onClick={()=>setStatusOrder(o)} title="สถานะ" style={{padding:"6px 10px",borderRadius:7,border:"1px solid rgba(16,185,129,0.25)",background:"rgba(16,185,129,0.08)",color:"#059669",cursor:"pointer",fontSize:12}}>⚙️</button>
                      {(role?.canDelete || user?.role === "admin" || user?.role === "manager") && (
                        <button onClick={()=>handleDeleteOrder(o, "productionOrders")} title="ลบใบนี้" style={{padding:"6px 10px",borderRadius:7,border:"1px solid rgba(248,113,113,0.3)",background:"rgba(248,113,113,0.08)",color:T.red,cursor:"pointer",fontSize:13,fontWeight:600}}>🗑</button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ── CUSTOM ORDERS ── */}
      {subTab === "custom" && (() => {
        // 🔧 เช็คจาก lots — ใบจะ "เสร็จ" ก็ต่อเมื่อทุก lot (ที่ไม่ยกเลิก) อยู่ "เข้าคลัง"
        // fallback: ถ้าใบไม่มี lots (legacy) ให้ดูที่ order.status
        const isOrderDone = (o) => {
          const lots = (o.lots || []).filter(l => l.status !== "ยกเลิก");
          if (lots.length === 0) return (o.status||"") === "เข้าคลัง";
          return lots.every(l => l.status === "เข้าคลัง");
        };
        const activeOrders = customOrders.filter(o => !isOrderDone(o));
        const doneOrders = customOrders.filter(o => isOrderDone(o));
        const filteredCustom = customSubTab==="active" ? activeOrders : customSubTab==="done" ? doneOrders : customOrders;
        return (
        <>
          {/* sub-tabs: active / done / all */}
          <div style={{display:"flex",gap:6,marginBottom:12,flexWrap:"wrap"}}>
            {[
              {k:"active",l:"🎨 กำลังผลิต",c:"#d97706",n:activeOrders.length},
              {k:"done",l:"✅ เสร็จแล้ว",c:"#16a34a",n:doneOrders.length},
              {k:"all",l:"📋 ทั้งหมด",c:T.accent,n:customOrders.length},
            ].map(t => {
              const sel = customSubTab === t.k;
              return (
                <button key={t.k} onClick={()=>{setCustomSubTab(t.k);setSelectedCustom(new Set());}}
                  style={{padding:"7px 14px",borderRadius:9,border:`1px solid ${sel?t.c:T.border}`,background:sel?`${t.c}18`:"transparent",color:sel?t.c:T.sub,cursor:"pointer",fontSize:12,fontFamily:"'Sarabun',sans-serif",fontWeight:sel?700:500,transition:"all 0.15s"}}>
                  {t.l} <span style={{fontSize:10,opacity:0.75,marginLeft:4}}>({t.n})</span>
                </button>
              );
            })}
          </div>

          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14,gap:10,flexWrap:"wrap"}}>
            <div style={{fontSize:12,color:T.sub}}>
              {customSubTab==="active" ? "กำลังผลิต" : customSubTab==="done" ? "งานที่เสร็จแล้ว" : "Custom Order ทั้งหมด"} <b style={{color:T.accent}}>{filteredCustom.length} ใบ</b>
              {selectedCustom.size > 0 && <span style={{marginLeft:8,padding:"2px 8px",background:"rgba(22,163,74,0.12)",color:"#16a34a",borderRadius:10,fontSize:11,fontWeight:600}}>เลือก {selectedCustom.size} ใบ</span>}
            </div>
            <div style={{display:"flex",gap:8}}>
              {selectedCustom.size > 0 && role?.canIssueInvoice && (
                <button onClick={() => {
                  const selected = customOrders.filter(o => selectedCustom.has(o.id));
                  if (selected.length === 0) return;
                  // ตรวจชื่อลูกค้าให้ตรงกัน (เตือน ถ้าหลายลูกค้า)
                  const customerNames = [...new Set(selected.map(o => o.customerName).filter(Boolean))];
                  if (customerNames.length > 1) {
                    if (!window.confirm(`เลือก ${selected.length} ใบจาก ${customerNames.length} ลูกค้า:\n${customerNames.join(", ")}\n\nออกบิลรวมต่อ?`)) return;
                  }
                  onCreateInvoiceFromCustom?.(selected);
                  setSelectedCustom(new Set());
                }} style={{padding:"8px 14px",borderRadius:9,border:"none",cursor:"pointer",background:"#16a34a",color:"white",fontSize:12,fontWeight:600,fontFamily:"'Sarabun',sans-serif",boxShadow:"0 4px 14px rgba(22,163,74,0.3)"}}>🧾 ออกบิลรวม ({selectedCustom.size})</button>
              )}
              {selectedCustom.size > 0 && (
                <button onClick={() => setSelectedCustom(new Set())} style={{padding:"8px 12px",borderRadius:9,border:`1px solid ${T.border}`,background:"white",color:T.sub,cursor:"pointer",fontSize:12,fontFamily:"inherit"}}>✕ ล้าง</button>
              )}
              {role?.canProduction && (
                <button onClick={()=>setShowNewCustom(true)} style={{padding:"8px 18px",borderRadius:9,border:"none",cursor:"pointer",background:"linear-gradient(135deg,#d97706,#d97706)",color:"white",fontSize:12,fontWeight:600,fontFamily:"'Sarabun',sans-serif",boxShadow:"0 4px 14px rgba(217,119,6,0.3)"}}>+ สร้าง Custom Order</button>
              )}
            </div>
          </div>

          {filteredCustom.length === 0 ? (
            <div style={{textAlign:"center",padding:60,background:T.card,borderRadius:16,border:`1px solid ${T.border}`}}>
              <div style={{fontSize:48,marginBottom:12,opacity:0.3}}>{customSubTab==="done"?"✅":"🎨"}</div>
              <div style={{fontSize:14,fontWeight:600,color:T.accent,marginBottom:6}}>
                {customSubTab==="active" ? "ไม่มีงานที่กำลังผลิตอยู่" : customSubTab==="done" ? "ยังไม่มีงานที่เสร็จ" : "ยังไม่มี Custom Order"}
              </div>
              {customSubTab!=="done" && role?.canProduction && <div style={{fontSize:11,color:T.muted}}>สั่งผลิตเฉพาะแบบ — ใส่รูป + พิมพ์ไซส์เอง</div>}
            </div>
          ) : (
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              {filteredCustom.map(o => {
                const color = STATUS_COLORS[o.status] || "#6b7280";
                const isSelected = selectedCustom.has(o.id);
                return (
                  <div key={o.id} onClick={()=>setStatusCustom(o)}
                    style={{background:isSelected?"rgba(22,163,74,0.06)":T.card,border:`1px solid ${isSelected?"#16a34a":T.border}`,borderRadius:14,padding:"14px 18px",cursor:"pointer",display:"grid",gridTemplateColumns:"22px 60px 120px 1fr 130px 130px 80px",alignItems:"center",gap:12,transition:"background 0.15s"}}
                    onMouseEnter={e=>e.currentTarget.style.background=isSelected?"rgba(22,163,74,0.1)":"rgba(217,119,6,0.04)"}
                    onMouseLeave={e=>e.currentTarget.style.background=isSelected?"rgba(22,163,74,0.06)":"white"}>
                    <input type="checkbox" checked={isSelected} onClick={e=>e.stopPropagation()} onChange={() => {
                      setSelectedCustom(prev => {
                        const next = new Set(prev);
                        if (next.has(o.id)) next.delete(o.id); else next.add(o.id);
                        return next;
                      });
                    }} style={{width:16,height:16,cursor:"pointer",accentColor:"#16a34a"}}/>
                    {o.clothingImage ? <img src={o.clothingImage} alt="" style={{width:54,height:54,borderRadius:8,objectFit:"cover",border:`1px solid ${T.border}`}}/> : <div style={{width:54,height:54,borderRadius:8,background:"#f1f5f9",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22}}>🎨</div>}
                    <div>
                      <div style={{fontFamily:"monospace",fontSize:12,color:"#d97706",fontWeight:700}}>{o.prodNo}</div>
                      <div style={{fontSize:10,color:T.muted,marginTop:2}}>{o.date}</div>
                    </div>
                    <div>
                      <div style={{fontWeight:600,color:T.text,fontSize:13}}>{o.clothingName}</div>
                      <div style={{fontSize:11,color:T.muted,marginTop:2}}>{o.customerName ? `👤 ${o.customerName}` : ""} {o.customerPhone ? `· ${o.customerPhone}` : ""}</div>
                    </div>
                    <div style={{textAlign:"center"}}>
                      <div style={{fontSize:11,color:T.muted}}>จำนวน</div>
                      <div style={{fontFamily:"monospace",fontWeight:700,color:T.text,fontSize:15}}>{fmtInt(o.totalQty)}</div>
                    </div>
                    <div style={{textAlign:"center"}}>
                      <span style={{padding:"4px 10px",borderRadius:14,fontSize:11,fontWeight:700,background:`${color}18`,color,border:`1px solid ${color}40`}}>{o.status}</span>
                    </div>
                    <div style={{display:"flex",gap:6,justifyContent:"flex-end"}} onClick={e=>e.stopPropagation()}>
                      <button onClick={()=>setPrintOrder(o)} title="พิมพ์" style={{padding:"6px 10px",borderRadius:7,border:"1px solid rgba(59,91,139,0.25)",background:"rgba(59,91,139,0.08)",color:T.accent,cursor:"pointer",fontSize:12}}>🖨️</button>
                      {(role?.canDelete || user?.role === "admin" || user?.role === "manager") && (
                        <button onClick={()=>handleDeleteOrder(o, "customOrders")} title="ลบใบนี้" style={{padding:"6px 10px",borderRadius:7,border:"1px solid rgba(248,113,113,0.3)",background:"rgba(248,113,113,0.08)",color:T.red,cursor:"pointer",fontSize:13,fontWeight:600}}>🗑</button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
        );
      })()}

      {/* ── BOM ── */}
      {subTab === "bom" && (
        <>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
            <div style={{fontSize:12,color:T.sub}}>BOM ทั้งหมด <b style={{color:T.accent}}>{boms.length} สูตร</b></div>
            {role?.canManageBOM && (
              <button onClick={()=>setEditBom({})} style={{padding:"8px 18px",borderRadius:9,border:"none",cursor:"pointer",background:"linear-gradient(135deg,#7c3aed,#7c3aed)",color:"white",fontSize:12,fontWeight:600,fontFamily:"'Sarabun',sans-serif",boxShadow:"0 4px 14px rgba(124,58,237,0.3)"}}>+ สร้าง BOM</button>
            )}
          </div>

          {boms.length === 0 ? (
            <div style={{textAlign:"center",padding:60,background:T.card,borderRadius:16,border:`1px solid ${T.border}`}}>
              <div style={{fontSize:48,marginBottom:12,opacity:0.3}}>🧪</div>
              <div style={{fontSize:14,fontWeight:600,color:T.accent,marginBottom:6}}>ยังไม่มี BOM</div>
              {role?.canManageBOM && <div style={{fontSize:11,color:T.muted}}>สร้าง BOM ก่อนเพื่อใช้คำนวณวัตถุดิบในการสั่งผลิต</div>}
            </div>
          ) : (
            <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:16,overflow:"hidden"}}>
              {boms.map((b,i) => {
                const matCost = (b.materials||[]).reduce((s,m) => s + (Number(m.qtyPerPiece)||0)*(Number(m.costPerUnit)||0), 0);
                const total = matCost + (Number(b.laborCostPerPiece)||0);
                return (
                  <div key={b.id} style={{display:"grid",gridTemplateColumns:"1fr 120px 120px 140px 120px",alignItems:"center",gap:14,padding:"14px 18px",borderBottom:i<boms.length-1?`1px solid ${T.border}`:"none"}}>
                    <div>
                      <div style={{fontWeight:600,color:T.text,fontSize:13}}>{b.clothingName}</div>
                      <div style={{fontSize:11,color:T.muted,marginTop:2}}>{(b.materials||[]).length} วัตถุดิบ{b.notes?` · ${b.notes}`:""}</div>
                    </div>
                    <div style={{textAlign:"right",fontSize:12}}><div style={{color:T.muted,fontSize:10}}>วัตถุดิบ/ตัว</div><div style={{fontFamily:"monospace",fontWeight:600,color:T.text}}>฿{fmt(matCost)}</div></div>
                    <div style={{textAlign:"right",fontSize:12}}><div style={{color:T.muted,fontSize:10}}>ค่าแรง/ตัว</div><div style={{fontFamily:"monospace",fontWeight:600,color:T.text}}>฿{fmt(b.laborCostPerPiece||0)}</div></div>
                    <div style={{textAlign:"right",fontSize:13}}><div style={{color:T.muted,fontSize:10}}>ต้นทุน/ตัว</div><div style={{fontFamily:"monospace",fontWeight:700,color:T.accent,fontSize:15}}>฿{fmt(total)}</div></div>
                    <div style={{display:"flex",gap:6,justifyContent:"flex-end"}}>
                      {role?.canManageBOM && <button onClick={()=>setEditBom(b)} title="แก้ไข" style={{padding:"6px 10px",borderRadius:7,border:"1px solid rgba(124,58,237,0.25)",background:"rgba(124,58,237,0.08)",color:"#7c3aed",cursor:"pointer",fontSize:12}}>✏️</button>}
                      {role?.canDelete && <button onClick={()=>handleDeleteBom(b)} title="ลบ" style={{padding:"6px 10px",borderRadius:7,border:"1px solid rgba(248,113,113,0.25)",background:"rgba(248,113,113,0.08)",color:T.red,cursor:"pointer",fontSize:12}}>✕</button>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Modals */}
      {showNew && (
        <NewProductionOrderModal
          clothingItems={clothingItems}
          boms={boms}
          products={products}
          productionOrders={productionOrders}
          user={user}
          onClose={()=>setShowNew(false)}
          onCreated={(orderData) => { setShowNew(false); setPrintOrder(orderData); }}
        />
      )}
      {editProdOrder && (
        <NewProductionOrderModal
          clothingItems={clothingItems}
          boms={boms}
          products={products}
          productionOrders={productionOrders}
          user={user}
          editOrder={editProdOrder}
          onClose={()=>setEditProdOrder(null)}
          onUpdated={()=>setEditProdOrder(null)}
        />
      )}
      {statusOrder && (
        <ProductionStatusModal
          order={productionOrders.find(o => o.id === statusOrder.id) || statusOrder}
          products={products}
          clothingItems={clothingItems}
          user={user}
          onClose={()=>setStatusOrder(null)}
        />
      )}
      {showNewCustom && (
        <NewCustomOrderModal
          customOrders={customOrders}
          customers={customers}
          user={user}
          onClose={()=>setShowNewCustom(false)}
          onCreated={(orderData) => { setShowNewCustom(false); setPrintOrder(orderData); }}
        />
      )}
      {statusCustom && (
        <ProductionStatusModal
          order={customOrders.find(o => o.id === statusCustom.id) || statusCustom}
          products={products}
          clothingItems={clothingItems}
          user={user}
          collectionName="customOrders"
          isCustom={true}
          onClose={()=>setStatusCustom(null)}
        />
      )}
      {printOrder && (
        <PrintProductionOrder
          order={printOrder}
          companyInfo={companyInfo}
          onClose={()=>setPrintOrder(null)}
          onPrint={(id, opts)=>printElementById && printElementById(id, `A4 ${opts?.landscape?"landscape":"portrait"}`)}
        />
      )}
      {editBom !== null && (
        <BOMEditor
          initialBom={editBom?.id ? editBom : null}
          clothingItems={clothingItems}
          products={products}
          user={user}
          onClose={()=>setEditBom(null)}
        />
      )}
    </div>
  );
}
