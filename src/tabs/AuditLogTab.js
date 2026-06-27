// 📝 Audit Log Tab — ดูประวัติการทำงานของทุก user
import { useState, useMemo } from "react";
import { T } from "../theme";
import { AUDIT_META } from "../utils/audit";

export default function AuditLogTab({ auditLogs = [], users = [] }) {
  const [filterAction, setFilterAction] = useState("ทั้งหมด");
  const [filterUser, setFilterUser]     = useState("ทั้งหมด");
  const [filterDate, setFilterDate]     = useState(""); // YYYY-MM-DD
  const [search, setSearch]             = useState("");
  const [expanded, setExpanded]         = useState({});
  const [showCount, setShowCount]       = useState(50);

  // unique actions ที่มีจริง + เรียงตามจำนวน
  const actionsAvailable = useMemo(() => {
    const set = new Set(auditLogs.map(l => l.action));
    return Array.from(set);
  }, [auditLogs]);

  const filtered = useMemo(() => {
    return auditLogs.filter(l => {
      if (filterAction !== "ทั้งหมด" && l.action !== filterAction) return false;
      if (filterUser !== "ทั้งหมด" && l.userUsername !== filterUser) return false;
      if (filterDate) {
        const ts = l.timestamp?.toDate?.();
        if (!ts) return false;
        const d = `${ts.getFullYear()}-${String(ts.getMonth()+1).padStart(2,"0")}-${String(ts.getDate()).padStart(2,"0")}`;
        if (d !== filterDate) return false;
      }
      if (search) {
        const s = search.toLowerCase();
        const hay = [l.targetLabel, l.targetCollection, l.note, l.userName].join(" ").toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    });
  }, [auditLogs, filterAction, filterUser, filterDate, search]);

  const visible = filtered.slice(0, showCount);

  const fmtTime = (ts) => {
    if (!ts?.toDate) return "—";
    const d = ts.toDate();
    return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}:${String(d.getSeconds()).padStart(2,"0")}`;
  };

  const exportCSV = () => {
    const header = ["เวลา","ผู้ทำ","บทบาท","Action","Collection","Target","Note"];
    const rows = filtered.map(l => [
      fmtTime(l.timestamp),
      l.userName,
      l.userRole,
      AUDIT_META[l.action]?.label || l.action,
      l.targetCollection || "",
      l.targetLabel || l.targetId || "",
      (l.note || "").replace(/\n/g," "),
    ]);
    const csv = [header, ...rows]
      .map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(","))
      .join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `auditlog-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ─────────── Render ───────────
  return (
    <div style={{animation:"fadeUp 0.4s ease"}}>
      {/* Header */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10,marginBottom:16}}>
        <div>
          <div style={{fontSize:14,fontWeight:600,color:T.text}}>📝 ประวัติการทำงาน (Audit Log)</div>
          <div style={{fontSize:11,color:T.muted,marginTop:2}}>เก็บล่าสุด {auditLogs.length} รายการ · กรองแล้ว {filtered.length}</div>
        </div>
        <button onClick={exportCSV} style={{padding:"7px 14px",borderRadius:8,border:`1px solid ${T.border}`,background:"rgba(58,122,82,0.1)",color:"#3a7a52",cursor:"pointer",fontSize:12,fontFamily:"'Sarabun',sans-serif",fontWeight:600}}>
          📊 Export CSV ({filtered.length})
        </button>
      </div>

      {/* Filters */}
      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:14,padding:12,background:T.card,border:`1px solid ${T.border}`,borderRadius:10}}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="🔍 ค้นหา (target/note)..."
          style={{flex:"1 1 200px",minWidth:200,background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:7,padding:"7px 12px",fontFamily:"'Sarabun',sans-serif",fontSize:12,outline:"none"}}/>
        <select value={filterAction} onChange={e=>setFilterAction(e.target.value)}
          style={{background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:7,padding:"7px 10px",fontSize:12,outline:"none",cursor:"pointer"}}>
          <option>ทั้งหมด</option>
          {actionsAvailable.map(a => <option key={a} value={a}>{AUDIT_META[a]?.icon} {AUDIT_META[a]?.label || a}</option>)}
        </select>
        <select value={filterUser} onChange={e=>setFilterUser(e.target.value)}
          style={{background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:7,padding:"7px 10px",fontSize:12,outline:"none",cursor:"pointer"}}>
          <option>ทั้งหมด</option>
          {users.map(u => <option key={u.id} value={u.username}>{u.name} (@{u.username})</option>)}
        </select>
        <input type="date" value={filterDate} onChange={e=>setFilterDate(e.target.value)}
          style={{background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:7,padding:"7px 10px",fontSize:12,outline:"none"}}/>
        {(filterAction!=="ทั้งหมด"||filterUser!=="ทั้งหมด"||filterDate||search) && (
          <button onClick={()=>{setFilterAction("ทั้งหมด");setFilterUser("ทั้งหมด");setFilterDate("");setSearch("");}}
            style={{padding:"7px 12px",borderRadius:7,border:`1px solid ${T.border}`,background:"transparent",color:T.sub,cursor:"pointer",fontSize:12,fontFamily:"'Sarabun',sans-serif"}}>ล้างกรอง</button>
        )}
      </div>

      {/* List */}
      <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:12,overflowX:"auto",WebkitOverflowScrolling:"touch"}}>
        <div style={{minWidth:780}}>
        {/* Table header */}
        <div style={{display:"grid",gridTemplateColumns:"160px 110px 1fr 1fr 28px",alignItems:"center",padding:"10px 16px",background:"#f8f9fb",borderBottom:`1px solid ${T.border}`,color:T.muted,fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.06em"}}>
          <div>เวลา</div><div>ผู้ทำ</div><div>Action</div><div>เป้าหมาย</div><div></div>
        </div>

        {visible.length === 0 ? (
          <div style={{padding:40,textAlign:"center",color:T.muted,fontSize:13}}>ไม่มี log ที่ตรงกับเงื่อนไข</div>
        ) : visible.map((l, idx) => {
          const meta = AUDIT_META[l.action] || { icon: "•", color: T.sub, label: l.action };
          const isExp = expanded[l.id];
          const hasDetail = l.before || l.after || l.note;
          return (
            <div key={l.id}>
              <div onClick={()=>hasDetail && setExpanded(e=>({...e,[l.id]:!e[l.id]}))}
                style={{display:"grid",gridTemplateColumns:"160px 110px 1fr 1fr 28px",alignItems:"center",padding:"10px 16px",borderBottom:idx<visible.length-1?`1px solid ${T.border}`:"none",cursor:hasDetail?"pointer":"default",transition:"background 0.15s"}}
                onMouseEnter={e=>e.currentTarget.style.background="rgba(59,91,139,0.04)"}
                onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                <div style={{fontSize:11,color:T.sub,fontFamily:"monospace"}}>{fmtTime(l.timestamp)}</div>
                <div>
                  <div style={{fontSize:12,fontWeight:600,color:T.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{l.userName}</div>
                  <div style={{fontSize:10,color:T.muted}}>{l.userRole}</div>
                </div>
                <div>
                  <span style={{display:"inline-flex",alignItems:"center",gap:5,padding:"3px 9px",borderRadius:14,fontSize:11,fontWeight:600,background:`${meta.color}15`,color:meta.color,border:`1px solid ${meta.color}30`}}>
                    {meta.icon} {meta.label}
                  </span>
                  {l.targetCollection && <span style={{marginLeft:6,fontSize:10,color:T.muted,fontFamily:"monospace"}}>{l.targetCollection}</span>}
                </div>
                <div style={{fontSize:12,color:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                  {l.targetLabel || l.targetId || "—"}
                  {l.note && <span style={{color:T.muted,marginLeft:6,fontSize:11}}>· {l.note}</span>}
                </div>
                <div style={{textAlign:"center",fontSize:11,color:T.muted}}>
                  {hasDetail && (isExp ? "▼" : "▶")}
                </div>
              </div>

              {/* Expanded detail */}
              {isExp && hasDetail && (
                <div style={{padding:"12px 16px",background:"#f8f9fb",borderBottom:idx<visible.length-1?`1px solid ${T.border}`:"none",fontFamily:"monospace",fontSize:11}}>
                  {l.note && <div style={{marginBottom:8,color:T.sub}}><b>Note:</b> {l.note}</div>}
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                    {l.before && (
                      <div>
                        <div style={{fontSize:10,color:"#b94a48",fontWeight:700,marginBottom:4,fontFamily:"'Sarabun',sans-serif"}}>BEFORE</div>
                        <pre style={{margin:0,padding:10,background:"rgba(185,74,72,0.06)",border:"1px solid rgba(185,74,72,0.2)",borderRadius:6,fontSize:11,whiteSpace:"pre-wrap",wordBreak:"break-all",maxHeight:200,overflow:"auto"}}>{JSON.stringify(l.before,null,2)}</pre>
                      </div>
                    )}
                    {l.after && (
                      <div>
                        <div style={{fontSize:10,color:"#3a7a52",fontWeight:700,marginBottom:4,fontFamily:"'Sarabun',sans-serif"}}>AFTER</div>
                        <pre style={{margin:0,padding:10,background:"rgba(58,122,82,0.06)",border:"1px solid rgba(58,122,82,0.2)",borderRadius:6,fontSize:11,whiteSpace:"pre-wrap",wordBreak:"break-all",maxHeight:200,overflow:"auto"}}>{JSON.stringify(l.after,null,2)}</pre>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {/* Load more */}
        {filtered.length > showCount && (
          <div style={{padding:"12px",textAlign:"center",borderTop:`1px solid ${T.border}`}}>
            <button onClick={()=>setShowCount(c=>c+50)} style={{padding:"6px 16px",borderRadius:7,border:`1px solid ${T.border}`,background:"transparent",color:T.accent,cursor:"pointer",fontSize:12,fontFamily:"'Sarabun',sans-serif",fontWeight:600}}>
              โหลดเพิ่ม 50 รายการ ({filtered.length - showCount} เหลือ)
            </button>
          </div>
        )}
        </div>
      </div>

      <div style={{marginTop:12,padding:10,background:"rgba(59,91,139,0.06)",border:"1px solid rgba(59,91,139,0.15)",borderRadius:8,fontSize:11,color:T.sub}}>
        💡 Audit Log เก็บล่าสุด 500 รายการ — ถ้าต้องการประวัติย้อนหลังไกลกว่านี้ ดูได้ที่ backup JSON ใน <code style={{background:"rgba(0,0,0,0.05)",padding:"1px 5px",borderRadius:3}}>backups/&lt;project&gt;/YYYY-MM-DD.json</code>
      </div>
    </div>
  );
}
