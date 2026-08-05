import React, { useState, useEffect } from "react";
import { REGIONS, detectRegion, detectProvince, regionMeta } from "../utils/thaiRegion";
import { countOrdersByCustomers } from "../utils/orderStats";
import { deleteDoc, doc } from "firebase/firestore";
import { db } from "../firebase";
import { logAudit, AUDIT_ACTIONS } from "../utils/audit";
import { CardBox } from "../components/ui";
import { matchTokens } from "../utils/search";

const T = {
  card:"#ffffff", border:"#e3e8ef", text:"#1f2a44", sub:"#5b6b85", muted:"#8a9bb3",
  accent:"#3b5b8b", input:"#f6f8fb", inputBorder:"#d8dee9",
};

export default function CustomersTab({
  customers, orders, role, user,
  customerRegion, setCustomerRegion,
  customerSearch, setCustomerSearch,
  setShowImportCustomers, setShowNewCustomer,
  setProfileCustomer, setEditingCustomer,
}) {
  const enriched = customers.map(c => ({ ...c, _region: c.region || detectRegion(c.address), _province: c.province || detectProvince(c.address) }));
  const counts = {};
  REGIONS.forEach(r => counts[r.key] = 0);
  enriched.forEach(c => { counts[c._region] = (counts[c._region] || 0) + 1; });
  const filtered = enriched.filter(c => {
    if (customerRegion !== "ทั้งหมด" && c._region !== customerRegion) return false;
    if (customerSearch) {
      // 🔍 token search — เว้นวรรคแยกคำ ไม่สนลำดับ ("ดี สม" เจอ "สมชาย ใจดี")
      return matchTokens(customerSearch, c.name, c.phone, c.address, c.email, c._province, c.taxId, c.note);
    }
    return true;
  });

  // 🔢 จำนวนครั้งที่สั่ง — นับที่เซิร์ฟเวอร์ ไม่ใช่นับจาก orders ที่โหลดมา
  // (orders ในหน่วยความจำมีแค่ช่วง 7 วัน → ถ้านับจากตรงนั้นจะได้เลขผิดมาก)
  // 🔗 ลิงก์สั่งของส่วนตัว — id สุ่มของ Firestore เดาไม่ได้ (ต่างจากใช้เบอร์โทร)
  const [copiedLinkId, setCopiedLinkId] = useState("");
  const copyOrderLink = async (c) => {
    const url = `${window.location.origin}/c?id=${c.id}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedLinkId(c.id);
      setTimeout(() => setCopiedLinkId(""), 2000);
    } catch {
      window.prompt(`ลิงก์สั่งของของ ${c.name} — ส่งให้ลูกค้าเก็บไว้:`, url);
    }
  };

  const [orderCounts, setOrderCounts] = useState({});   // { [customerId]: number | null }
  const [countingBusy, setCountingBusy] = useState(false);
  const COUNT_LIMIT = 60; // นับเฉพาะรายที่อยู่ต้น ๆ ของผลกรอง — กันยิง query เป็นร้อยพร้อมกัน
  const visibleIds = filtered.slice(0, COUNT_LIMIT).map(c => c.id).filter(Boolean);
  const missingIds = visibleIds.filter(id => orderCounts[id] === undefined);
  const missingKey = missingIds.join(",");

  useEffect(() => {
    if (!missingKey) return;
    let alive = true;
    setCountingBusy(true);
    countOrdersByCustomers(missingKey.split(","))
      .then(res => { if (alive) setOrderCounts(prev => ({ ...prev, ...res })); })
      .catch(() => {})
      .finally(() => { if (alive) setCountingBusy(false); });
    return () => { alive = false; };
  }, [missingKey]);

  return (
    <div style={{ animation: "fadeUp 0.4s ease", maxWidth: 1000 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
        <div style={{ fontSize: 12, color: T.sub }}>
          ลูกค้าทั้งหมด <b style={{ color: T.accent }}>{customers.length} ราย</b> · กรองแล้ว {filtered.length}
          {countingBusy && <span style={{ marginLeft: 8, fontSize: 11, color: T.muted }}>⏳ กำลังนับยอดสั่งซื้อ...</span>}
          {filtered.length > COUNT_LIMIT && (
            <span style={{ marginLeft: 8, fontSize: 11, color: "#b45309" }}>
              · แสดงยอดสั่งซื้อเฉพาะ {COUNT_LIMIT} รายแรก — ค้นหาเพื่อดูรายอื่น
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {role.canAdd && <button onClick={() => setShowImportCustomers(true)} style={{ padding: "8px 14px", borderRadius: 9, border: `1px solid ${T.border}`, cursor: "pointer", background: "rgba(59,91,139,0.06)", color: T.accent, fontSize: 12, fontWeight: 600, fontFamily: "'Sarabun',sans-serif" }}>📥 นำเข้า Excel</button>}
          <button onClick={() => setShowNewCustomer(true)} style={{ padding: "8px 18px", borderRadius: 9, border: "none", cursor: "pointer", background: "linear-gradient(135deg,#3b5b8b,#3b5b8b)", color: "white", fontSize: 12, fontWeight: 600, fontFamily: "'Sarabun',sans-serif", boxShadow: "0 4px 14px rgba(59,91,139,0.3)" }}>＋ เพิ่มลูกค้าใหม่</button>
        </div>
      </div>

      {/* Region filter tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
        <button onClick={() => setCustomerRegion("ทั้งหมด")}
          style={{ padding: "7px 14px", borderRadius: 9, border: `1px solid ${customerRegion === "ทั้งหมด" ? T.accent : T.border}`, background: customerRegion === "ทั้งหมด" ? "rgba(59,91,139,0.12)" : "transparent", color: customerRegion === "ทั้งหมด" ? T.accent : T.sub, cursor: "pointer", fontSize: 12, fontWeight: customerRegion === "ทั้งหมด" ? 700 : 500, fontFamily: "'Sarabun',sans-serif" }}>
          🌍 ทั้งหมด <span style={{ marginLeft: 4, fontSize: 10, opacity: 0.7 }}>({customers.length})</span>
        </button>
        {REGIONS.map(r => {
          const sel = customerRegion === r.key;
          const ct = counts[r.key] || 0;
          if (ct === 0 && r.key !== "unknown") return null;
          return (
            <button key={r.key} onClick={() => setCustomerRegion(r.key)}
              style={{ padding: "7px 14px", borderRadius: 9, border: `1px solid ${sel ? r.color : T.border}`, background: sel ? `${r.color}20` : "transparent", color: sel ? r.color : T.sub, cursor: "pointer", fontSize: 12, fontWeight: sel ? 700 : 500, fontFamily: "'Sarabun',sans-serif" }}>
              {r.icon} {r.label} <span style={{ marginLeft: 4, fontSize: 10, opacity: 0.7 }}>({ct})</span>
            </button>
          );
        })}
      </div>

      <div style={{ marginBottom: 14 }}>
        <input value={customerSearch} onChange={e => setCustomerSearch(e.target.value)} placeholder="🔍 ค้นหาชื่อ เบอร์ ที่อยู่ จังหวัด..."
          style={{ width: "100%", background: T.input, border: `1px solid ${T.inputBorder}`, color: T.text, borderRadius: 9, padding: "9px 14px", fontFamily: "'Sarabun',sans-serif", fontSize: 13, outline: "none" }} />
      </div>

      {customers.length === 0 ? (
        <div style={{ textAlign: "center", padding: 60, background: T.card, borderRadius: 16, border: `1px solid ${T.border}` }}>
          <div style={{ fontSize: 48, marginBottom: 12, opacity: 0.3 }}>👤</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: T.accent, marginBottom: 6 }}>ยังไม่มีข้อมูลลูกค้า</div>
          <div style={{ fontSize: 11, color: T.muted }}>กด "️ เพิ่มลูกค้าใหม่" เพื่อเริ่มต้น</div>
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: 40, color: T.muted, fontSize: 13 }}>ไม่พบลูกค้าตามเงื่อนไข</div>
      ) : (
        <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 16, overflow: "hidden" }}>
          {filtered.map((c, i, arr) => {
            const rm = regionMeta(c._region);
            return (
              <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 20px", borderBottom: i < arr.length - 1 ? `1px solid ${T.border}` : "none", cursor: "pointer" }}
                onClick={() => setProfileCustomer(c)}
                onMouseEnter={e => e.currentTarget.style.background = "rgba(59,91,139,0.04)"}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                <div style={{ width: 48, height: 48, borderRadius: "50%", background: `linear-gradient(135deg,${rm.color},${rm.color}dd)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0, boxShadow: `0 4px 10px ${rm.color}55` }}>{rm.icon}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2, flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 600, color: T.text, fontSize: 13 }}>{c.name}</span>
                    <span style={{ padding: "1px 8px", borderRadius: 10, fontSize: 9, fontWeight: 700, background: `${rm.color}15`, color: rm.color, border: `1px solid ${rm.color}30` }}>{rm.label}</span>
                    {c._province && <span style={{ fontSize: 10, color: T.muted }}>{c._province}</span>}
                  </div>
                  <div style={{ fontSize: 11, color: T.muted }}>📞 {c.phone || "-"}</div>
                  <div style={{ fontSize: 11, color: T.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>📍 {c.address || "-"}</div>
                </div>
                <div style={{ fontSize: 11, color: T.sub, textAlign: "right" }}>
                  <div>
                    {(() => {
                      const n = orderCounts[c.id];
                      if (n === undefined) return <span style={{ color: T.muted }}>สั่งซื้อ …</span>;
                      if (n === null) return <span style={{ color: T.muted }}>สั่งซื้อ —</span>;
                      return <>สั่งซื้อ <b style={{ color: T.accent }}>{n.toLocaleString("th-TH")}</b> ครั้ง</>;
                    })()}
                  </div>
                  <div style={{ color: T.accent, fontSize: 10, marginTop: 2 }}>👁 ดูโปรไฟล์</div>
                </div>
                {/* 🔗 ลิงก์สั่งของส่วนตัว — ลูกค้าเปิดจากเครื่องไหนก็ได้ ข้อมูลเติมให้ครบ */}
                <button onClick={(e) => { e.stopPropagation(); copyOrderLink(c); }}
                  title="คัดลอกลิงก์สั่งของส่วนตัวของลูกค้ารายนี้ (ส่งให้ทางไลน์)"
                  style={{ padding: "5px 9px", borderRadius: 7, border: `1px solid ${copiedLinkId === c.id ? T.green : "rgba(59,91,139,0.25)"}`, background: copiedLinkId === c.id ? "rgba(58,122,82,0.1)" : "rgba(59,91,139,0.08)", color: copiedLinkId === c.id ? T.green : T.accent, cursor: "pointer", fontSize: 11, whiteSpace: "nowrap" }}>
                  {copiedLinkId === c.id ? "✅ คัดลอกแล้ว" : "🔗 ลิงก์สั่งของ"}
                </button>
                {role.canAdd && <button onClick={(e) => { e.stopPropagation(); setEditingCustomer({ ...c }); }}
                  title="แก้ไขชื่อ/ที่อยู่/เบอร์"
                  style={{ padding: "5px 9px", borderRadius: 7, border: "1px solid rgba(59,91,139,0.25)", background: "rgba(59,91,139,0.08)", color: T.accent, cursor: "pointer", fontSize: 11 }}>✏️</button>}
                {role.canDelete && <button onClick={async (e) => {
                  e.stopPropagation();
                  if (!window.confirm(`ลบลูกค้า "${c.name}"?`)) return;
                  await deleteDoc(doc(db, "customers", c.id));
                  logAudit(user, { action: AUDIT_ACTIONS.DELETE, collection: "customers", targetId: c.id, targetLabel: c.name, before: { name: c.name, phone: c.phone } });
                }} style={{ padding: "5px 8px", borderRadius: 7, border: "1px solid rgba(248,113,113,0.25)", background: "rgba(248,113,113,0.08)", color: "#f87171", cursor: "pointer", fontSize: 11 }}>✕</button>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
