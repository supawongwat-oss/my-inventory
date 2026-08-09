import React from "react";
import { T, SIZE_GROUPS, PRESET_COLORS, splitSizesIntoRows, sizeRank, getPriceForSize } from "../theme";
import { Modal, MHead, BtnPrimary, BtnGhost, BtnDanger } from "./ui";
import { compressImage } from "../utils/imageCompress";
import { uploadImage, deleteFile } from "../utils/upload";

const MAX_JOB_IMAGES = 8;

// 🖼️ แนบรูปงาน + รายละเอียด ลงบิลได้ตรงนี้ — ไม่ต้องย้อนไปเปิดใบสั่งผลิต custom ใหม่
//    เขียนลง customDetails.jobs ชุดเดียวกับที่มาจากใบ custom → PrintInvoiceModal พิมพ์ออกเหมือนกัน
function JobImagesPanel({ invoiceForm, setInvoiceForm }) {
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const fileRef = React.useRef(null);

  const jobs = (invoiceForm.customDetails || {}).jobs || [];
  const manual = jobs.find(j => j.__manual) || null;
  const fromCustom = jobs.filter(j => !j.__manual);
  const imgCount = jobs.reduce((s, j) => s + ((j.images || []).length), 0);

  const setJobs = (fn) => setInvoiceForm(f => {
    const cd = f.customDetails || {};
    const next = fn(cd.jobs || []);
    return { ...f, customDetails: { ...cd, jobs: next } };
  });

  const patchManual = (patch) => setJobs(list => {
    const i = list.findIndex(j => j.__manual);
    if (i < 0) return [...list, { __manual: true, prodNo: "", clothingName: "", fabricType: "", collarType: "", jobDescription: "", note: "", images: [], ...patch }];
    const next = [...list];
    next[i] = { ...next[i], ...patch };
    return next;
  });

  const addFiles = async (e) => {
    const files = [...(e.target.files || [])];
    if (files.length === 0) return;
    const room = MAX_JOB_IMAGES - (manual?.images || []).length;
    if (room <= 0) { alert(`แนบได้สูงสุด ${MAX_JOB_IMAGES} รูป`); return; }
    setBusy(true);
    try {
      const added = [];
      for (const f of files.slice(0, room)) {
        const dataUrl = await compressImage(f, { maxDim: 1200, quality: 0.75 });
        try {
          const { url, path } = await uploadImage(dataUrl, "invoiceJobs");
          added.push({ dataUrl: url, path, label: "" });
        } catch (err) {
          // ⚠️ Storage ใช้ไม่ได้ → เก็บ base64 ในบิลแทน (หนักกว่าแต่รูปไม่หาย)
          console.warn("[invoice] อัปโหลดรูปงานไม่สำเร็จ เก็บ base64 แทน:", err?.message || err);
          added.push({ dataUrl, path: "", label: "" });
        }
      }
      patchManual({});                                   // สร้าง job ว่างถ้ายังไม่มี
      setJobs(list => list.map(j => j.__manual ? { ...j, images: [...(j.images || []), ...added] } : j));
    } catch (err) {
      alert("แนบรูปไม่สำเร็จ: " + (err?.message || err));
    } finally {
      setBusy(false);
      if (e.target) e.target.value = "";
    }
  };

  const removeImage = (idx) => {
    const img = (manual?.images || [])[idx];
    if (img?.path) deleteFile(img.path).catch(() => {});
    setJobs(list => list
      .map(j => j.__manual ? { ...j, images: (j.images || []).filter((_, i) => i !== idx) } : j)
      // job ที่ว่างเปล่าแล้ว → ตัดทิ้ง ไม่ให้กล่อง "รายละเอียดงาน" โผล่บนบิลเปล่า ๆ
      .filter(j => !j.__manual || (j.images || []).length > 0 || j.clothingName || j.jobDescription || j.note));
  };

  const setLabel = (idx, v) => setJobs(list => list.map(j => j.__manual
    ? { ...j, images: (j.images || []).map((im, i) => i === idx ? { ...im, label: v } : im) } : j));

  const inputStyle = { width: "100%", boxSizing: "border-box", background: T.input, border: `1px solid ${T.inputBorder}`, color: T.text, borderRadius: 8, padding: "8px 11px", fontFamily: "'Sarabun',sans-serif", fontSize: 13, outline: "none" };

  return (
    <div style={{ marginBottom: 14, padding: "10px 14px", background: T.card, border: `1px solid ${T.border}`, borderRadius: 10 }}>
      <div onClick={() => setOpen(o => !o)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", userSelect: "none" }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: T.text }}>
          🖼️ รูปงาน / รายละเอียดงาน บนบิล
          {imgCount > 0 && <span style={{ marginLeft: 8, padding: "1px 8px", background: "rgba(5,150,105,0.12)", color: "#059669", borderRadius: 10, fontSize: 10, fontWeight: 800 }}>{imgCount} รูป</span>}
        </span>
        <span style={{ fontSize: 10, color: T.muted }}>{open ? "คลิกเพื่อพับ" : "คลิกเพื่อขยาย"}</span>
      </div>

      {open && (
        <div style={{ marginTop: 12 }}>
          {fromCustom.length > 0 && (
            <div style={{ fontSize: 11, color: T.muted, marginBottom: 10 }}>
              🎨 มาจากใบ Custom {fromCustom.map(j => j.prodNo).filter(Boolean).join(", ") || "—"} · {fromCustom.reduce((s, j) => s + ((j.images || []).length), 0)} รูป
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
            <input value={manual?.clothingName || ""} onChange={e => patchManual({ clothingName: e.target.value })}
              placeholder="ชื่องาน (เช่น เสื้อโปโลโรงเรียน ก.)" style={inputStyle}/>
            <input value={manual?.jobDescription || ""} onChange={e => patchManual({ jobDescription: e.target.value })}
              placeholder="ลักษณะงาน (เช่น สกรีนอก + ปักหลัง)" style={inputStyle}/>
          </div>

          <input ref={fileRef} type="file" accept="image/*" multiple onChange={addFiles} style={{ display: "none" }}/>
          <button onClick={() => fileRef.current?.click()} disabled={busy}
            style={{ padding: "8px 14px", borderRadius: 8, border: `1px dashed ${T.accent}`, background: "rgba(59,91,139,0.06)", color: T.accent, cursor: busy ? "wait" : "pointer", fontSize: 12, fontWeight: 600, fontFamily: "'Sarabun',sans-serif" }}>
            {busy ? "⏳ กำลังแนบ..." : `➕ แนบรูปงาน (${(manual?.images || []).length}/${MAX_JOB_IMAGES})`}
          </button>

          {(manual?.images || []).length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(110px,1fr))", gap: 8, marginTop: 10 }}>
              {(manual.images || []).map((im, i) => (
                <div key={i} style={{ border: `1px solid ${T.border}`, borderRadius: 8, padding: 6, background: "white" }}>
                  <div style={{ position: "relative", height: 78, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", background: "#f8fafc", borderRadius: 6 }}>
                    <img src={im.dataUrl} alt="" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}/>
                    <button onClick={() => removeImage(i)} title="ลบรูปนี้"
                      style={{ position: "absolute", top: 2, right: 2, width: 20, height: 20, borderRadius: 10, border: "none", background: "rgba(239,68,68,0.9)", color: "white", cursor: "pointer", fontSize: 11, lineHeight: "20px", padding: 0 }}>✕</button>
                  </div>
                  <input value={im.label || ""} onChange={e => setLabel(i, e.target.value)} placeholder="คำอธิบาย"
                    style={{ ...inputStyle, marginTop: 5, padding: "4px 7px", fontSize: 11 }}/>
                </div>
              ))}
            </div>
          )}

          <div style={{ fontSize: 10, color: T.muted, marginTop: 8, lineHeight: 1.6 }}>
            💡 รูปจะขึ้นในกล่อง "รายละเอียดงาน" บนบิลที่พิมพ์ — ปิดได้ที่สวิตช์ 🖼️ ด้านบน
          </div>
        </div>
      )}
    </div>
  );
}

// ⚡ จัดไซส์เข้ากลุ่มราคา — ใช้กับ "ตั้งราคาทีเดียว"
// เด็ก 6-12 = กลุ่มเดียว, S-XL = กลุ่มเดียว, 2XL/3XL/4XL... = แยกกลุ่มละไซส์ (ไล่ขึ้นไปไม่จำกัด)
const GROUP_LABEL = (key, fallback) => (SIZE_GROUPS.find(g => g.key === key)?.label) || fallback;
const priceTierOf = (sz) => {
  const s = String(sz || "").trim().toUpperCase();
  if (!s) return { key: "__nosize", label: "ไม่ระบุไซส์", rank: 999 };
  if (/^\d+$/.test(s)) {
    // ตัวเลข ≤ 20 = ไซส์เด็ก (6-12) | มากกว่านั้นคือไซส์รองเท้า → แยกเป็นของตัวเอง
    if (Number(s) <= 20) return { key: "kids", label: GROUP_LABEL("kids", "ไซส์ 6-12"), rank: 100 };
    return { key: s, label: `เบอร์ ${s}`, rank: sizeRank(s) };
  }
  if (["S", "M", "L", "XL"].includes(s)) return { key: "reg", label: GROUP_LABEL("reg", "ไซส์ S-XL"), rank: 200 };
  return { key: s, label: `ไซส์ ${s}`, rank: sizeRank(s) };
};

// 💰 แผงตั้งราคาทีเดียว — ใส่ราคาตามกลุ่มไซส์ (หรือแยกทีละไซส์) แล้วใช้กับทุกสี/ทุกรุ่นในบิล
function BulkPricePanel({ items, setInvoiceForm, clothingItems = [] }) {
  const [open, setOpen] = React.useState(false); // พับไว้ก่อน — กดเปิดเมื่อจะตั้งราคา
  const [mode, setMode] = React.useState("group"); // "group" = ตามกลุ่ม | "each" = แยกทีละไซส์

  // 👕 แขนสั้น/แขนยาว ราคาไม่เท่ากัน → ถ้าบิลมีมากกว่า 1 แบบ ต้องแยกช่องราคาให้
  const variants = React.useMemo(
    () => [...new Set(items.map(i => (i.variant || "").trim()))],
    [items]
  );
  const splitVariant = variants.length > 1;

  const buckets = React.useMemo(() => {
    const map = new Map();
    const vRank = new Map(variants.map((v, i) => [v, i]));
    items.forEach((it, idx) => {
      const t = mode === "group"
        ? priceTierOf(it.size)
        : (() => {
            const s = String(it.size || "").trim().toUpperCase();
            return s ? { key: s, label: `ไซส์ ${s}`, rank: sizeRank(s) } : { key: "__nosize", label: "ไม่ระบุไซส์", rank: 999 };
          })();
      const v = (it.variant || "").trim();
      const key = splitVariant ? `${v}|${t.key}` : t.key;
      const label = splitVariant ? `${v || "ไม่ระบุแบบ"} · ${t.label}` : t.label;
      // เรียงตามแบบเสื้อก่อน แล้วค่อยตามไซส์ — ราคาของแต่ละแบบจะอยู่ติดกัน
      const rank = splitVariant ? (vRank.get(v) ?? 99) * 1000 + t.rank : t.rank;
      if (!map.has(key)) map.set(key, { key, label, rank, idxs: [], qty: 0, prices: new Set() });
      const b = map.get(key);
      b.idxs.push(idx);
      b.qty += Number(it.qty) || 0;
      b.prices.add(Number(it.unitPrice) || 0);
    });
    return [...map.values()].sort((a, b) => a.rank - b.rank);
  }, [items, mode, splitVariant, variants]);

  const applyPrice = (idxs, v) => {
    const price = Math.max(0, Number(v) || 0);
    const set = new Set(idxs);
    setInvoiceForm(f => ({ ...f, items: f.items.map((x, j) => set.has(j) ? { ...x, unitPrice: price } : x) }));
  };
  const applyAll = (v) => applyPrice(items.map((_, i) => i), v);

  // 🔄 ดึงราคาล่าสุดจากคลัง — บิลเก็บราคา ณ ตอนออก ถ้าแก้ราคาในคลังทีหลังบิลไม่ตามให้
  const pullPricesFromStock = () => {
    const next = [];
    let changed = 0, missing = 0;
    items.forEach((it) => {
      const ci = clothingItems.find(c => c.id === it.clothingId);
      const col = ci?.colors?.[it.colorIdx];
      if (!col) { next.push(it); missing++; return; }
      const p = getPriceForSize(col, it.size);
      if (!(p > 0)) { next.push(it); missing++; return; }
      if (Number(it.unitPrice) !== p) changed++;
      next.push({ ...it, unitPrice: p });
    });
    if (!changed) {
      alert(missing ? `ราคาตรงกับคลังอยู่แล้ว (มี ${missing} รายการที่หาราคาในคลังไม่เจอ — ไม่แตะ)` : "ราคาตรงกับคลังอยู่แล้ว");
      return;
    }
    if (!window.confirm(`ดึงราคาล่าสุดจากคลังมาทับ ${changed} รายการ?${missing ? `\n(อีก ${missing} รายการหาราคาในคลังไม่เจอ — จะไม่ถูกแตะ)` : ""}\n\nราคาที่พิมพ์เองไว้ในบิลนี้จะถูกเขียนทับ`)) return;
    setInvoiceForm(f => ({ ...f, items: next }));
  };

  if (buckets.length === 0) return null;

  return (
    <div style={{ border: `1px solid ${T.border}`, borderRadius: 10, marginBottom: 10, background: "rgba(52,211,153,0.05)", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", flexWrap: "wrap", cursor: "pointer" }} onClick={() => setOpen(o => !o)}>
        <span style={{ fontSize: 12, fontWeight: 700, color: "#059669" }}>⚡ ตั้งราคาทีเดียว (ใช้กับทุกสี/ทุกรุ่น)</span>
        <span style={{ fontSize: 10, color: T.muted }}>{buckets.length} กลุ่ม{splitVariant ? " · แยกแขนสั้น/แขนยาวให้แล้ว" : "ไซส์"}</span>
        <span style={{ marginLeft: "auto", fontSize: 11, color: T.muted }}>{open ? "▲" : "▼"}</span>
      </div>
      {open && (
        <div style={{ padding: "0 10px 10px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
            {[{ id: "group", l: "📦 ตามกลุ่มไซส์" }, { id: "each", l: "🎯 แยกทีละไซส์" }].map(m => (
              <button key={m.id} onClick={() => setMode(m.id)}
                style={{ padding: "4px 10px", borderRadius: 7, cursor: "pointer", fontSize: 11, fontFamily: "inherit", fontWeight: mode === m.id ? 700 : 400, border: `1px solid ${mode === m.id ? "#059669" : T.border}`, background: mode === m.id ? "rgba(5,150,105,0.12)" : "transparent", color: mode === m.id ? "#059669" : T.sub }}>
                {m.l}
              </button>
            ))}
            <button onClick={pullPricesFromStock} title="อ่านราคาขายล่าสุดจากคลังมาใส่ทุกรายการในบิลนี้ (ใช้เมื่อแก้ราคาในคลังหลังออกบิลไปแล้ว)"
              style={{ padding: "4px 10px", borderRadius: 7, cursor: "pointer", fontSize: 11, fontFamily: "inherit", fontWeight: 700, border: "1px solid rgba(59,91,139,0.35)", background: "rgba(59,91,139,0.08)", color: T.accent }}>
              🔄 ดึงราคาจากคลัง
            </button>
            <span style={{ marginLeft: 6, fontSize: 11, color: T.muted, fontWeight: 600 }}>ทุกรายการ:</span>
            <input type="number" min="0" step="0.01" placeholder="฿"
              onFocus={e => e.target.select()}
              onBlur={e => { if (e.target.value !== "") { applyAll(e.target.value); e.target.value = ""; } }}
              onKeyDown={e => e.key === "Enter" && e.target.blur()}
              style={{ width: 70, textAlign: "right", background: T.input, border: `1px solid ${T.inputBorder}`, borderRadius: 6, color: T.text, fontFamily: "monospace", fontSize: 11, padding: "4px 6px", outline: "none" }} />
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {buckets.map(b => {
              const uniform = b.prices.size === 1 ? [...b.prices][0] : null;
              return (
                <div key={b.key} style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 8px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.card || "#fff" }}>
                  <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.25 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: T.text }}>{b.label}</span>
                    <span style={{ fontSize: 9, color: T.muted }}>{b.qty} ตัว</span>
                  </div>
                  <input type="number" min="0" step="0.01"
                    key={`${b.key}-${uniform ?? "mix"}`}
                    defaultValue={uniform ?? ""}
                    placeholder={uniform === null ? "หลายราคา" : "฿"}
                    onFocus={e => e.target.select()}
                    onBlur={e => { if (e.target.value !== "") applyPrice(b.idxs, e.target.value); }}
                    onKeyDown={e => e.key === "Enter" && e.target.blur()}
                    style={{ width: 74, textAlign: "right", background: "rgba(52,211,153,0.08)", border: "1px solid rgba(52,211,153,0.35)", borderRadius: 6, color: "#059669", fontFamily: "monospace", fontSize: 12, fontWeight: 700, padding: "5px 6px", outline: "none" }} />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default function NewInvoiceModal({
  onClose,
  editingInvoiceId,
  invoices = [],
  invoiceDocType, setInvoiceDocType,
  invoiceVat, setInvoiceVat,
  invoiceForm, setInvoiceForm,
  invoiceItemForm, setInvoiceItemForm,
  companyInfo = {},
  orders = [],
  orderPool = [],
  clothingItems = [],
  addItemCollapsed, setAddItemCollapsed,
  handleAddInvoiceItem,
  handleConfirmInvoice,
  handleImportFromOrder,
  docTypeLabel,
  calcInvoice,
  apparelSizes = [],
  shoeSizes = [],
}) {
  return (
        <Modal onClose={()=>{onClose();}} w={1100}>
          <MHead title={editingInvoiceId?"✏️ แก้ไขบิล":"🧾 ออกบิลใหม่"} sub={editingInvoiceId?`${invoices.find(i=>i.id===editingInvoiceId)?.invoiceNo || ""} · เลขที่บิลคงเดิม`:""} onClose={()=>{onClose();}} color={editingInvoiceId?T.amber:T.accent}/>

          {/* Doc type + VAT selector */}
          <div style={{display:"flex",gap:10,marginBottom:18,flexWrap:"wrap"}}>
            <div style={{flex:1}}>
              <label style={{fontSize:11,color:T.muted,display:"block",marginBottom:6,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em"}}>ประเภทเอกสาร</label>
              <div style={{display:"flex",gap:6}}>
                {[{id:"receipt",label:"🧾 ใบเสร็จ"},{id:"tax",label:"📄 ใบกำกับภาษี"},{id:"quotation",label:"📋 ใบวางบิล"}].map(t=>(
                  <button key={t.id} onClick={()=>{
                    setInvoiceDocType(t.id);
                    // ใบกำกับภาษี → บังคับ VAT 7% + ต้องแสดงข้อมูลบริษัทเต็ม
                    if (t.id === "tax") { setInvoiceVat(true); setInvoiceForm(f=>({...f,hideCompanyDetails:false})); }
                  }}
                    style={{padding:"7px 14px",borderRadius:8,border:`1px solid ${invoiceDocType===t.id?"#3b5b8b":T.border}`,background:invoiceDocType===t.id?"rgba(59,91,139,0.15)":"transparent",color:invoiceDocType===t.id?T.accent:T.sub,cursor:"pointer",fontSize:12,fontFamily:"'Sarabun',sans-serif",fontWeight:invoiceDocType===t.id?700:400,transition:"all 0.2s"}}>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            {/* 📅 วันที่เอกสาร — ออก/แก้ย้อนหลังได้ (ยอดจะไปลงเดือนตามวันที่นี้) */}
            {(()=>{
              const today=new Date();
              const iso=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;
              const back=invoiceForm.docDate&&invoiceForm.docDate!==iso;
              return (
                <div>
                  <label style={{fontSize:11,color:back?"#b45309":T.muted,display:"block",marginBottom:6,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em"}}>
                    วันที่เอกสาร {back&&<span style={{fontSize:10,fontWeight:700}}>· ย้อนหลัง</span>}
                  </label>
                  <input type="date" value={invoiceForm.docDate||iso} max={iso}
                    onChange={e=>setInvoiceForm(f=>({...f,docDate:e.target.value||iso}))}
                    title="วันที่ที่จะแสดงบนบิลและใช้คิดยอดในรายงาน — เลือกย้อนหลังได้"
                    style={{background:back?"rgba(245,158,11,0.10)":T.input,border:`1px solid ${back?"#f59e0b":T.inputBorder}`,color:T.text,borderRadius:8,padding:"7px 10px",fontFamily:"'Sarabun',sans-serif",fontSize:12,outline:"none",cursor:"pointer"}}/>
                </div>
              );
            })()}
            <div style={{display:"flex",alignItems:"flex-end",gap:10,flexWrap:"wrap"}}>
              <label style={{display:"flex",alignItems:"center",gap:8,cursor:invoiceDocType==="tax"?"not-allowed":"pointer",padding:"7px 14px",borderRadius:8,border:`1px solid ${invoiceVat?"#3b5b8b":T.border}`,background:invoiceVat?"rgba(59,91,139,0.15)":"transparent",opacity:invoiceDocType==="tax"?0.8:1}}
                title={invoiceDocType==="tax"?"ใบกำกับภาษีต้องมี VAT 7% เสมอ":""}>
                <input type="checkbox" checked={invoiceVat} disabled={invoiceDocType==="tax"} onChange={e=>setInvoiceVat(e.target.checked)} style={{cursor:invoiceDocType==="tax"?"not-allowed":"pointer"}}/>
                <span style={{fontSize:12,color:invoiceVat?T.accent:T.sub,fontWeight:invoiceVat?700:400}}>VAT {invoiceForm.vatRate}% {invoiceDocType==="tax"&&<span style={{color:T.red,fontSize:10,marginLeft:4}}>🔒 บังคับ</span>}</span>
              </label>
              <label style={{display:"flex",alignItems:"center",gap:8,cursor:invoiceDocType==="tax"?"not-allowed":"pointer",padding:"7px 14px",borderRadius:8,border:`1px solid ${invoiceForm.showCompanyTaxId!==false?"#3b5b8b":T.border}`,background:invoiceForm.showCompanyTaxId!==false?"rgba(59,91,139,0.15)":"transparent",opacity:invoiceDocType==="tax"?0.8:1}}
                title={invoiceDocType==="tax"?"ใบกำกับภาษีต้องแสดงเลขผู้เสียภาษีบริษัทเสมอ":"แสดง/ซ่อนเลขผู้เสียภาษีของบริษัทในบิล"}>
                <input type="checkbox" checked={invoiceForm.showCompanyTaxId!==false} disabled={invoiceDocType==="tax"}
                  onChange={e=>setInvoiceForm(f=>({...f,showCompanyTaxId:e.target.checked}))} style={{cursor:invoiceDocType==="tax"?"not-allowed":"pointer"}}/>
                <span style={{fontSize:12,color:invoiceForm.showCompanyTaxId!==false?T.accent:T.sub,fontWeight:invoiceForm.showCompanyTaxId!==false?700:400}}>แสดงเลขผู้เสียภาษีบริษัท {invoiceDocType==="tax"&&<span style={{color:T.red,fontSize:10,marginLeft:4}}>🔒 บังคับ</span>}</span>
              </label>
              {/* 🕶️ ลูกค้าบางเจ้าไม่ต้องการรับ VAT — ซ่อนชื่อเต็ม/ที่อยู่/เลขภาษีบริษัทบนบิล */}
              <label style={{display:"flex",alignItems:"center",gap:8,cursor:invoiceDocType==="tax"?"not-allowed":"pointer",padding:"7px 14px",borderRadius:8,border:`1px solid ${invoiceForm.hideCompanyDetails?"#b45309":T.border}`,background:invoiceForm.hideCompanyDetails?"rgba(180,83,9,0.12)":"transparent",opacity:invoiceDocType==="tax"?0.8:1}}
                title={invoiceDocType==="tax"?"ใบกำกับภาษีต้องแสดงข้อมูลบริษัทเต็มเสมอ":"ซ่อนชื่อเต็ม (เหลือชื่อย่อ) + ที่อยู่ + เลขผู้เสียภาษี + กล่อง 'ออกโดย' — สำหรับลูกค้าที่ไม่รับ VAT"}>
                <input type="checkbox" checked={!!invoiceForm.hideCompanyDetails} disabled={invoiceDocType==="tax"}
                  onChange={e=>setInvoiceForm(f=>({...f,hideCompanyDetails:e.target.checked}))} style={{cursor:invoiceDocType==="tax"?"not-allowed":"pointer"}}/>
                <span style={{fontSize:12,color:invoiceForm.hideCompanyDetails?"#b45309":T.sub,fontWeight:invoiceForm.hideCompanyDetails?700:400}}>🕶️ ซ่อนชื่อเต็ม/ที่อยู่บริษัท {invoiceDocType==="tax"&&<span style={{color:T.red,fontSize:10,marginLeft:4}}>🔒 ปิดอยู่</span>}</span>
              </label>
              {/* 🖼️ รูปงาน custom — บางใบไม่อยากให้รูปติดไปกับบิลลูกค้า (และช่วยให้บิลสั้นลงด้วย) */}
              {(()=>{
                const imgCount=((invoiceForm.customDetails||{}).jobs||[]).reduce((s,j)=>s+((j.images||[]).length),0);
                if(!imgCount) return null;
                const on=invoiceForm.showJobImages!==false;
                return (
                  <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",padding:"7px 14px",borderRadius:8,border:`1px solid ${on?"#059669":T.border}`,background:on?"rgba(5,150,105,0.12)":"transparent"}}
                    title="แสดง/ซ่อนรูปงานในกล่องรายละเอียดงานบนบิลที่พิมพ์">
                    <input type="checkbox" checked={on} onChange={e=>setInvoiceForm(f=>({...f,showJobImages:e.target.checked}))} style={{cursor:"pointer"}}/>
                    <span style={{fontSize:12,color:on?"#059669":T.sub,fontWeight:on?700:400}}>🖼️ แสดงรูปงานบนบิล <span style={{fontSize:10,color:T.muted}}>({imgCount} รูป)</span></span>
                  </label>
                );
              })()}
            </div>
          </div>

          {/* 🖼️ แนบรูปงานเองได้ — ไม่ต้องเปิดใบสั่งผลิต custom ใหม่เพื่อให้รูปติดบิล */}
          <JobImagesPanel invoiceForm={invoiceForm} setInvoiceForm={setInvoiceForm}/>

          {/* แจ้งเตือนเมื่อเป็นใบกำกับภาษี — ต้องมี taxId */}
          {invoiceDocType==="tax"&&(
            <div style={{marginBottom:14,padding:"10px 14px",background:"rgba(184,134,0,0.08)",border:"1px solid rgba(184,134,0,0.3)",borderRadius:8,fontSize:12,color:T.amber,lineHeight:1.7}}>
              ⚠️ <b>ใบกำกับภาษีต้องมีข้อมูลครบ:</b>
              <ul style={{marginLeft:18,marginTop:4,marginBottom:0}}>
                <li>✓ VAT 7% (บังคับ)</li>
                <li>{companyInfo.taxId ? "✓" : "❌"} เลขผู้เสียภาษีบริษัท {!companyInfo.taxId && <span style={{color:T.red,fontWeight:700}}>(ยังไม่ได้ตั้ง — ไปที่ ⚙️ ตั้งค่า → ข้อมูลบริษัท)</span>}</li>
                <li>{invoiceForm.customerTaxId ? "✓" : "❌"} เลขผู้เสียภาษีลูกค้า {!invoiceForm.customerTaxId && <span style={{color:T.red,fontWeight:700}}>(กรอกในช่องด้านล่าง)</span>}</li>
              </ul>
            </div>
          )}

          {/* บัญชีรับเงิน */}
          <div style={{marginBottom:14}}>
            <label style={{fontSize:11,color:T.muted,display:"block",marginBottom:6,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em"}}>🏦 บัญชีรับชำระเงิน (แสดงบนบิล)</label>
            <select value={invoiceForm.bankAccountIdx??-1} onChange={e=>setInvoiceForm(f=>({...f,bankAccountIdx:Number(e.target.value)}))}
              style={{width:"100%",background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:9,padding:"9px 12px",fontFamily:"'Sarabun',sans-serif",fontSize:13,outline:"none"}}>
              <option value={-1}>— ไม่แสดงบัญชี —</option>
              {(companyInfo.bankAccounts||[]).map((b,i)=>(
                <option key={i} value={i}>{b.label||"บัญชี"} · {b.bankName} · {b.accountNo}</option>
              ))}
            </select>
            {(!companyInfo.bankAccounts||companyInfo.bankAccounts.length===0)&&<div style={{fontSize:10,color:T.muted,marginTop:4}}>ยังไม่มีบัญชี — เพิ่มได้ที่ ⚙️ ตั้งค่า → ข้อมูลบริษัท</div>}
          </div>

          {/* Import from order */}
          {(orders.length>0 || orderPool.length>0)&&(()=>{
            // A (memory ~7 วัน) + B (ดึงจาก DB 300 ใบล่าสุด) → รวม + ตัดซ้ำด้วย id
            const seen = new Set();
            const allOrders = [...orders, ...orderPool].filter(o => {
              if (!o || !o.id || seen.has(o.id)) return false;
              seen.add(o.id); return true;
            });
            // เช็คว่าใบสั่งไหนออกบิลไปแล้ว — ดูจากลิงก์จริงเท่านั้น
            // ⚠️ เดิมเดาเพิ่มด้วย "ชื่อลูกค้า + วันเดียวกัน" → ลูกค้าคนเดียวสั่ง 5 ใบในวันเดียว
            //    ออกบิลใบเดียว อีก 4 ใบก็ขึ้น "ออกบิลแล้ว" ทั้งที่ยังไม่ได้ออก
            // ⚡ สร้าง Set ครั้งเดียว แทนการวนบิลทุกใบต่อใบสั่งทุกใบ
            const invoicedSet = new Set();
            invoices.forEach(inv => (inv.mergedFromOrderIds||[]).forEach(id => invoicedSet.add(id)));
            // o.invoiceId = ปั๊มไว้ในใบสั่งตอนออกบิล → ถูกต้องแม้บิลใบนั้นอยู่นอกช่วงที่โหลดมา
            const isInvoiced = (o) => !!o.invoiceId || invoicedSet.has(o.id);
            const tsOf = (o) => o.createdAt?.seconds || 0;
            const label = (o) => `${o.orderNo} · ${o.customerName} · ${o.date}`;
            const pending = allOrders.filter(o => !isInvoiced(o)).sort((a,b)=>tsOf(b)-tsOf(a));
            const billed = allOrders.filter(o => isInvoiced(o)).sort((a,b)=>tsOf(b)-tsOf(a));
            return (
            <div style={{marginBottom:16,padding:12,background:"rgba(59,91,139,0.06)",border:"1px solid rgba(59,91,139,0.2)",borderRadius:10}}>
              <div style={{fontSize:11,color:T.accent,fontWeight:600,marginBottom:8}}>📋 ดึงข้อมูลจากใบสั่งของ <span style={{color:T.muted,fontWeight:400}}>· ยังไม่ออกบิล {pending.length} ใบ</span></div>
              <select value="" onChange={e=>{const o=allOrders.find(x=>x.id===e.target.value);if(o)handleImportFromOrder(o);}}
                style={{width:"100%",background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:9,padding:"9px 12px",fontFamily:"'Sarabun',sans-serif",fontSize:13,outline:"none"}}>
                <option value="">-- เลือกใบสั่งของ (ถ้ามี) --</option>
                {pending.length>0 && <optgroup label={`⏳ ยังไม่ออกบิล (${pending.length})`}>
                  {pending.map(o=><option key={o.id} value={o.id}>{label(o)}</option>)}
                </optgroup>}
                {billed.length>0 && <optgroup label={`✅ ออกบิลแล้ว (${billed.length}${billed.length>50?" · แสดง 50 ล่าสุด":""})`}>
                  {billed.slice(0,50).map(o=><option key={o.id} value={o.id}>{label(o)}</option>)}
                </optgroup>}
              </select>
            </div>
            );
          })()}

          {/* Customer info */}
          <div style={{fontSize:11,color:T.muted,marginBottom:8,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.05em"}}>ข้อมูลลูกค้า / ผู้รับ</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:16}}>
            {[
              {k:"customerName",l:"ชื่อลูกค้า *",ph:"ชื่อ-นามสกุล / ชื่อบริษัท"},
              {k:"customerPhone",l:"เบอร์โทร",ph:"0812345678"},
              {k:"customerAddress",l:"ที่อยู่",ph:"บ้านเลขที่ ซอย ถนน..."},
              {k:"customerTaxId",l:"เลขผู้เสียภาษี",ph:"(ถ้ามี)"},
            ].map(f=>(
              <div key={f.k}>
                <label style={{fontSize:11,color:T.muted,display:"block",marginBottom:4,fontWeight:600}}>{f.l}</label>
                <input value={invoiceForm[f.k]} onChange={e=>setInvoiceForm(p=>({...p,[f.k]:e.target.value}))} placeholder={f.ph}
                  style={{width:"100%",background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:9,padding:"8px 12px",fontFamily:"'Sarabun',sans-serif",fontSize:13,outline:"none"}}/>
              </div>
            ))}
          </div>

          {/* Items */}
          <div style={{fontSize:11,color:T.muted,marginBottom:8,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.05em"}}>รายการสินค้า / บริการ</div>
          {invoiceForm.items.length>0&&<BulkPricePanel items={invoiceForm.items} setInvoiceForm={setInvoiceForm} clothingItems={clothingItems}/>}
          {invoiceForm.items.length>0&&(()=>{
            const isPlus=(sz)=>/^[2-9]XL$/.test(sz);
            // index-aware items (เก็บ index เดิมไว้ใช้แก้/ลบ)
            const indexed=invoiceForm.items.map((it,idx)=>({...it,__i:idx}));
            const liveOf=(it)=>indexed[it.__i]||it;
            // มีชื่อรุ่น = เข้าตาราง group | ไม่มี = แถวเดียว
            const structured=indexed.filter(i=>i.clothingId||i.clothingName);
            const generic=indexed.filter(i=>!(i.clothingId||i.clothingName));
            const groups=Object.values(structured.reduce((acc,it)=>{
              // 🔑 รวม colorName เข้าใน key — กัน legacy data ที่ colorIdx=0 ทุกแถว
              const k=`${it.clothingId||it.clothingName}-${it.colorIdx??""}|${it.colorName||""}|${it.variant||""}`;
              if(!acc[k]) acc[k]={clothingName:it.clothingName,colorName:it.colorName,colorHex:it.colorHex,variant:it.variant||"",fabricType:it.fabricType||"",collarType:it.collarType||"",jobDescription:it.jobDescription||"",items:[]};
              acc[k].items.push(it);
              return acc;
            },{}));
            const updateQty=(i,v)=>setInvoiceForm(f=>({...f,items:f.items.map((x,j)=>j===i?{...x,qty:Math.max(1,Number(v)||1)}:x)}));
            const updatePrice=(i,v)=>setInvoiceForm(f=>({...f,items:f.items.map((x,j)=>j===i?{...x,unitPrice:Math.max(0,Number(v)||0)}:x)}));
            // ⌨️ อัปเดตทันทีที่พิมพ์ — เดิมอัปเดตตอนคลิกออกจากช่องเท่านั้น
            //    ถ้าแก้จำนวนแล้วกดปุ่มอื่นทันที (โดยเฉพาะบนแท็บเล็ต) ค่าใหม่จะไม่ถูกบันทึก
            //    ตัวเลขในช่องโชว์ค่าที่พิมพ์ แต่ยอดรวมยังคูณด้วยจำนวนเก่า → ราคาผิด
            const liveInput=(idx,cur,apply)=>({
              onFocus:e=>e.target.select(),
              onChange:e=>{ if(e.target.value!=="") apply(idx,e.target.value); },
              onBlur:e=>{ if(e.target.value==="") e.target.value=cur; else apply(idx,e.target.value); },
              onKeyDown:e=>e.key==="Enter"&&e.target.blur(),
            });
            const removeItem=(i)=>setInvoiceForm(f=>({...f,items:f.items.filter((_,j)=>j!==i)}));
            const removeGroup=(items)=>setInvoiceForm(f=>({...f,items:f.items.filter((_,j)=>!items.find(it=>it.__i===j))}));
            return (
              <div style={{background:"rgba(241,243,246,0.5)",borderRadius:10,border:`1px solid ${T.border}`,marginBottom:12,overflow:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:11,color:T.text}}>
                  <thead>
                    <tr style={{background:"rgba(241,243,246,0.85)",color:T.muted,fontSize:10,textTransform:"uppercase",letterSpacing:"0.06em"}}>
                      <th style={{padding:"8px 10px",textAlign:"left",border:`1px solid ${T.border}`,minWidth:90}}>รุ่น</th>
                      <th style={{padding:"8px 10px",textAlign:"left",border:`1px solid ${T.border}`,minWidth:80}}>สี</th>
                      {[1,2,3,4].flatMap(i=>[
                        <th key={`sh${i}`} style={{padding:"6px 4px",textAlign:"center",border:`1px solid ${T.border}`,background:"rgba(22,101,52,0.4)",color:"#bbf7d0",minWidth:36}}>SIZE</th>,
                        <th key={`qh${i}`} style={{padding:"6px 4px",textAlign:"center",border:`1px solid ${T.border}`,minWidth:44}}>จำนวน</th>
                      ])}
                      <th style={{padding:"8px 8px",textAlign:"center",border:`1px solid ${T.border}`,width:70}}>รวม</th>
                      <th style={{padding:"8px 8px",textAlign:"right",border:`1px solid ${T.border}`,width:90}}>ราคา/หน่วย</th>
                      <th style={{padding:"8px 8px",textAlign:"right",border:`1px solid ${T.border}`,width:90}}>ราคารวม</th>
                      <th style={{width:32,border:`1px solid ${T.border}`}}/>
                    </tr>
                  </thead>
                  <tbody>
                    {groups.flatMap((group,gi)=>{
                      // ✨ เสื้อผ้าแถวละ 4 · สินค้าที่ไม่ใช่เสื้อผ้า (สนับแข้ง/รองเท้า/อุปกรณ์กีฬา)
                      //    ราคาต่างกันทุกไซส์ → แยกบรรทัดละไซส์ ช่องราคาจะได้ตรงกับไซส์นั้นจริง ๆ
                      const ciRef = clothingItems.find(c => c.id === group.items[0]?.clothingId);
                      const perSize = !!ciRef && (ciRef.sizeType === "shoe" || ciRef.priceBySize === true);
                      const withSize = group.items.filter(i => i.size);
                      const noSize = group.items.filter(i => !i.size);
                      const rows = splitSizesIntoRows(withSize, perSize ? 1 : 4, { fillPlus: false });
                      noSize.forEach(n => rows.push([n]));
                      if(rows.length===0) rows.push([]);
                      return rows.map((chunk,ci)=>{
                        const rowUnit=Number(chunk[0]?liveOf(chunk[0]).unitPrice:0)||0;
                        const rowQty=chunk.reduce((s,i)=>s+(Number(liveOf(i).qty)||0),0);
                        const rowSub=chunk.reduce((s,i)=>s+(Number(liveOf(i).unitPrice)||0)*(Number(liveOf(i).qty)||0),0);
                        const mixed=new Set(chunk.map(i=>Number(liveOf(i).unitPrice)||0)).size>1;
                        return (
                          <tr key={`${gi}-${ci}`} style={{background:gi%2===0?"transparent":"rgba(59,91,139,0.03)"}}>
                            <td style={{padding:"6px 10px",fontWeight:600,verticalAlign:"middle",border:`1px solid ${T.border}`}}>{ci===0&&<div><div>{group.clothingName}</div>{(group.fabricType||group.collarType||group.jobDescription)&&<div style={{fontSize:10,color:"#64748b",fontWeight:400,marginTop:2,display:"flex",flexWrap:"wrap",gap:3}}>{group.fabricType&&<span>🧵 {group.fabricType}</span>}{group.collarType&&<span>· 👔 {group.collarType}</span>}{group.jobDescription&&<span>· {group.jobDescription}</span>}</div>}</div>}</td>
                            <td style={{padding:"6px 10px",verticalAlign:"middle",border:`1px solid ${T.border}`}}>
                              {ci===0&&<div style={{display:"flex",alignItems:"center",gap:6}}>
                                <div style={{width:10,height:10,borderRadius:2,background:group.colorHex,border:"1px solid rgba(255,255,255,0.15)",flexShrink:0}}/>
                                <span>{group.colorName}{group.variant?` (${group.variant})`:""}</span>
                              </div>}
                            </td>
                            {chunk.map(it=>[
                              <td key={`s-${it.__i}`} style={{padding:"5px 4px",textAlign:"center",fontFamily:"monospace",fontWeight:700,color:T.accent,border:`1px solid ${T.border}`,background:"rgba(59,91,139,0.06)"}}>{it.size}</td>,
                              <td key={`q-${it.__i}`} style={{padding:"4px 4px",textAlign:"center",border:`1px solid ${T.border}`}}>
                                <input type="number" defaultValue={liveOf(it).qty} min="1" {...liveInput(it.__i,liveOf(it).qty,updateQty)}
                                  style={{width:42,textAlign:"center",background:"rgba(59,91,139,0.08)",border:`1px solid ${T.border}`,borderRadius:5,color:T.text,fontFamily:"monospace",fontSize:11,padding:"3px 2px",outline:"none"}}/>
                              </td>
                            ])}
                            {Array(4-chunk.length).fill(null).flatMap((_,i)=>[
                              <td key={`e1-${ci}-${i}`} style={{border:`1px solid ${T.border}`,background:"#fafafa"}}/>,
                              <td key={`e2-${ci}-${i}`} style={{border:`1px solid ${T.border}`,background:"#fafafa"}}/>
                            ])}
                            <td style={{padding:"6px 8px",textAlign:"center",fontFamily:"monospace",fontWeight:700,color:T.accent,verticalAlign:"middle",border:`1px solid ${T.border}`}}>{rowQty}</td>
                            <td style={{padding:"4px 8px",textAlign:"right",verticalAlign:"middle",border:`1px solid ${T.border}`}}>
                              <input type="number" key={`u-${chunk.map(c=>c.__i).join("_")}`} defaultValue={rowUnit} min="0" step="0.01"
                                title={mixed
                                  ? `⚠️ ไซส์ในแถวนี้ราคาไม่เท่ากัน (${[...new Set(chunk.map(i=>Number(liveOf(i).unitPrice)||0))].join(" / ")}) — พิมพ์ทับจะเปลี่ยนทุกไซส์ในแถว`
                                  : `ใช้กับไซส์: ${chunk.map(c=>c.size).join(", ")}`}
                                onFocus={e=>e.target.select()}
                                onChange={e=>{if(e.target.value==="")return;const v=Math.max(0,Number(e.target.value)||0);const ids=chunk.map(c=>c.__i);setInvoiceForm(f=>({...f,items:f.items.map((x,j)=>ids.includes(j)?{...x,unitPrice:v}:x)}));}}
                                onBlur={e=>{if(e.target.value===""){e.target.value=rowUnit;return;}const v=Math.max(0,Number(e.target.value)||0);const ids=chunk.map(c=>c.__i);setInvoiceForm(f=>({...f,items:f.items.map((x,j)=>ids.includes(j)?{...x,unitPrice:v}:x)}));}}
                                onKeyDown={e=>e.key==="Enter"&&e.target.blur()}
                                style={{width:72,textAlign:"right",background:mixed?"rgba(245,158,11,0.12)":"rgba(52,211,153,0.08)",border:`1px solid ${mixed?"#f59e0b":"rgba(52,211,153,0.3)"}`,borderRadius:5,color:mixed?"#b45309":"#34d399",fontFamily:"monospace",fontSize:11,fontWeight:600,padding:"4px 6px",outline:"none"}}/>
                              {mixed&&<div style={{fontSize:9,color:"#b45309",fontWeight:700,marginTop:1}}>⚠️ ราคาผสม</div>}
                            </td>
                            <td style={{padding:"6px 8px",textAlign:"right",fontFamily:"monospace",fontWeight:700,color:"#34d399",verticalAlign:"middle",border:`1px solid ${T.border}`}}>
                              ฿{rowSub.toLocaleString("th-TH",{minimumFractionDigits:2})}
                            </td>
                            <td style={{textAlign:"center",border:`1px solid ${T.border}`}}>{ci===0&&<button onClick={()=>removeGroup(group.items)} style={{background:"none",border:"none",color:"#f87171",cursor:"pointer",fontSize:13}}>✕</button>}</td>
                          </tr>
                        );
                      });
                    })}
                    {generic.length>1 && (
                      <tr style={{background:"rgba(217,119,6,0.06)"}}>
                        <td colSpan={13} style={{padding:"6px 10px",border:`1px solid ${T.border}`,fontSize:11}}>
                          <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                            <span style={{color:"#92400e",fontWeight:600}}>🎨 ใส่สีให้ทุกแถว ({generic.length} รายการ):</span>
                            <select onChange={e => {
                              const idx = e.target.value;
                              if (idx === "") return;
                              const p = PRESET_COLORS[idx];
                              if (!p) return;
                              const genericIds = generic.map(g => g.__i);
                              setInvoiceForm(f => ({...f, items: f.items.map((x,j) => genericIds.includes(j) ? {...x, colorName:p.name, colorHex:p.hex} : x)}));
                              e.target.value = "";
                            }} style={{background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:6,padding:"4px 8px",fontSize:11,cursor:"pointer",fontFamily:"inherit"}}>
                              <option value="">เลือกสี...</option>
                              {PRESET_COLORS.map((c,i) => <option key={i} value={i}>{c.name}</option>)}
                            </select>
                            <input type="color" onChange={e => {
                              const hex = e.target.value;
                              const genericIds = generic.map(g => g.__i);
                              setInvoiceForm(f => ({...f, items: f.items.map((x,j) => genericIds.includes(j) ? {...x, colorHex:hex} : x)}));
                            }} style={{width:32,height:24,border:`1px solid ${T.inputBorder}`,borderRadius:4,cursor:"pointer",padding:1}} title="เลือกสีกำหนดเอง"/>
                            <input placeholder="หรือพิมพ์ชื่อสีเอง" onKeyDown={e => {
                              if (e.key === "Enter" && e.target.value.trim()) {
                                const name = e.target.value.trim();
                                const genericIds = generic.map(g => g.__i);
                                setInvoiceForm(f => ({...f, items: f.items.map((x,j) => genericIds.includes(j) ? {...x, colorName:name} : x)}));
                                e.target.value = "";
                              }
                            }} style={{flex:"1 1 140px",background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:6,padding:"4px 8px",fontSize:11,outline:"none",fontFamily:"inherit"}}/>
                          </div>
                        </td>
                      </tr>
                    )}
                    {generic.map(it=>(
                      <tr key={`g-${it.__i}`}>
                        <td colSpan={10} style={{padding:"6px 10px",fontWeight:500,border:`1px solid ${T.border}`}}>
                          <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                            {it.colorHex&&<div style={{width:12,height:12,borderRadius:3,background:it.colorHex,border:"1px solid rgba(0,0,0,0.2)",flexShrink:0}}/>}
                            <span style={{fontWeight:600}}>{it.description}</span>
                            {it.colorName&&<span style={{padding:"1px 6px",background:"rgba(59,91,139,0.08)",color:T.accent,borderRadius:8,fontSize:10,fontWeight:600}}>{it.colorName}</span>}
                            {it.size&&<span style={{padding:"1px 6px",background:"rgba(16,185,129,0.08)",color:T.green,borderRadius:8,fontSize:10,fontFamily:"monospace",fontWeight:700}}>{it.size}</span>}
                            {it.unit&&<span style={{color:T.muted,fontSize:10}}>· {it.unit}</span>}
                          </div>
                        </td>
                        <td style={{padding:"4px 8px",textAlign:"center",border:`1px solid ${T.border}`}}>
                          <input type="number" defaultValue={it.qty} min="1" {...liveInput(it.__i,it.qty,updateQty)}
                            style={{width:48,textAlign:"center",background:"rgba(59,91,139,0.08)",border:`1px solid ${T.border}`,borderRadius:5,color:T.text,fontFamily:"monospace",fontSize:11,padding:"4px",outline:"none"}}/>
                        </td>
                        <td style={{padding:"4px 8px",textAlign:"right",border:`1px solid ${T.border}`}}>
                          <input type="number" defaultValue={it.unitPrice} min="0" step="0.01" {...liveInput(it.__i,it.unitPrice,updatePrice)}
                            style={{width:72,textAlign:"right",background:"rgba(52,211,153,0.08)",border:"1px solid rgba(52,211,153,0.3)",borderRadius:5,color:"#34d399",fontFamily:"monospace",fontSize:11,fontWeight:600,padding:"4px 6px",outline:"none"}}/>
                        </td>
                        <td style={{padding:"6px 8px",textAlign:"right",fontFamily:"monospace",fontWeight:700,color:"#34d399",border:`1px solid ${T.border}`}}>฿{(it.qty*it.unitPrice).toLocaleString("th-TH",{minimumFractionDigits:2})}</td>
                        <td style={{textAlign:"center",border:`1px solid ${T.border}`}}><button onClick={()=>removeItem(it.__i)} style={{background:"none",border:"none",color:"#f87171",cursor:"pointer",fontSize:13}}>✕</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {(()=>{const c=calcInvoice(invoiceForm.items,invoiceForm.vatRate,invoiceVat,invoiceForm.discount,invoiceForm.discountType,invoiceForm.useShipping,invoiceForm.shippingFee);return(
                  <div style={{padding:"10px 12px",borderTop:`1px solid ${T.border}`,fontSize:12,display:"flex",justifyContent:"space-between",alignItems:"flex-end",gap:14,flexWrap:"wrap"}}>
                    <div style={{display:"flex",flexDirection:"column",gap:6}}>
                      {/* ส่วนลดท้ายบิล input */}
                      <div style={{display:"flex",alignItems:"center",gap:6}}>
                        <span style={{fontSize:11,color:T.muted,fontWeight:600}}>💸 ส่วนลดท้ายบิล:</span>
                        <input type="number" min="0" step="0.01" value={invoiceForm.discount||0}
                          onFocus={e=>e.target.select()}
                          onChange={e=>setInvoiceForm(f=>({...f,discount:Number(e.target.value)||0}))}
                          style={{width:80,textAlign:"right",background:"rgba(184,134,0,0.08)",border:"1px solid rgba(184,134,0,0.3)",color:T.amber,borderRadius:6,padding:"5px 8px",fontFamily:"monospace",fontSize:12,fontWeight:600,outline:"none"}}/>
                        <select value={invoiceForm.discountType||"amount"} onChange={e=>setInvoiceForm(f=>({...f,discountType:e.target.value}))}
                          style={{background:T.input,border:`1px solid ${T.border}`,color:T.text,borderRadius:6,padding:"5px 8px",fontSize:11,outline:"none",cursor:"pointer"}}>
                          <option value="amount">฿ บาท</option>
                          <option value="percent">% เปอร์เซ็นต์</option>
                        </select>
                      </div>
                      {/* ค่าจัดส่ง (checkbox + input) */}
                      <div style={{display:"flex",alignItems:"center",gap:6}}>
                        <label style={{display:"flex",alignItems:"center",gap:5,cursor:"pointer",fontSize:11,color:T.muted,fontWeight:600}}>
                          <input type="checkbox" checked={!!invoiceForm.useShipping} onChange={e=>setInvoiceForm(f=>({...f,useShipping:e.target.checked}))} style={{cursor:"pointer"}}/>
                          🚚 ค่าจัดส่ง:
                        </label>
                        <input type="number" min="0" step="0.01" value={invoiceForm.shippingFee||0}
                          disabled={!invoiceForm.useShipping}
                          onFocus={e=>e.target.select()}
                          onChange={e=>setInvoiceForm(f=>({...f,shippingFee:Number(e.target.value)||0}))}
                          style={{width:80,textAlign:"right",background:invoiceForm.useShipping?"rgba(59,91,139,0.08)":"rgba(0,0,0,0.04)",border:`1px solid ${invoiceForm.useShipping?"rgba(59,91,139,0.3)":T.border}`,color:invoiceForm.useShipping?T.accent:T.muted,borderRadius:6,padding:"5px 8px",fontFamily:"monospace",fontSize:12,fontWeight:600,outline:"none"}}/>
                        <span style={{fontSize:11,color:T.muted}}>บาท</span>
                      </div>
                    </div>
                    {/* Totals */}
                    <div style={{textAlign:"right"}}>
                      {/* 🧮 จำนวนรวมทั้งบิล — ไว้เช็คกับใบสั่งผลิตว่าตรงกันไหม */}
                      <div style={{color:T.accent,marginBottom:3,fontSize:11,fontWeight:700}}>
                        รวมจำนวน: <b style={{fontFamily:"monospace",fontSize:13}}>{(invoiceForm.items||[]).reduce((s,i)=>s+(Number(i.qty)||0),0).toLocaleString("th-TH")}</b> ตัว
                      </div>
                      <div style={{color:T.sub,marginBottom:2,fontSize:11}}>ราคารวม: <b style={{fontFamily:"monospace",color:T.text}}>฿{c.grossSubtotal.toLocaleString("th-TH",{minimumFractionDigits:2})}</b></div>
                      {c.itemDiscountTotal>0&&<div style={{color:T.amber,marginBottom:2,fontSize:11}}>ส่วนลดรายการ: <b style={{fontFamily:"monospace"}}>-฿{c.itemDiscountTotal.toLocaleString("th-TH",{minimumFractionDigits:2})}</b></div>}
                      {c.billDiscount>0&&<div style={{color:T.amber,marginBottom:2,fontSize:11}}>ส่วนลดท้ายบิล: <b style={{fontFamily:"monospace"}}>-฿{c.billDiscount.toLocaleString("th-TH",{minimumFractionDigits:2})}</b></div>}
                      <div style={{color:T.sub,marginBottom:2}}>ยอดก่อนภาษี: <b style={{fontFamily:"monospace",color:T.text}}>฿{c.subtotal.toLocaleString("th-TH",{minimumFractionDigits:2})}</b></div>
                      {invoiceVat&&<div style={{color:T.sub,marginBottom:2}}>VAT {invoiceForm.vatRate}%: <b style={{fontFamily:"monospace",color:T.text}}>฿{c.vat.toLocaleString("th-TH",{minimumFractionDigits:2})}</b></div>}
                      {c.shipping>0&&<div style={{color:T.sub,marginBottom:2}}>🚚 ค่าจัดส่ง: <b style={{fontFamily:"monospace",color:T.text}}>฿{c.shipping.toLocaleString("th-TH",{minimumFractionDigits:2})}</b></div>}
                      <div style={{color:"#34d399",fontSize:14,fontWeight:700}}>ยอดรวม: <span style={{fontFamily:"monospace"}}>฿{c.total.toLocaleString("th-TH",{minimumFractionDigits:2})}</span></div>
                      {/* 💰 รับมัดจำ/ชำระแล้ว ตอนออกบิล */}
                      {(()=>{
                        const carried = (invoiceForm.payments||[]).reduce((s,p)=>s+(Number(p.amount)||0),0);
                        const dep = Number(invoiceForm.depositAmount)||0;
                        const remain = Math.max(0, c.total - carried - dep);
                        return (
                        <div style={{marginTop:8,paddingTop:8,borderTop:`1px dashed ${T.border}`}}>
                          {carried>0&&<div style={{color:T.green,marginBottom:4,fontSize:11}}>มัดจำจากใบสั่ง: <b style={{fontFamily:"monospace"}}>฿{carried.toLocaleString("th-TH",{minimumFractionDigits:2})}</b></div>}
                          <div style={{display:"flex",alignItems:"center",gap:6,justifyContent:"flex-end",marginBottom:4}}>
                            <span style={{fontSize:11,color:"#b45309",fontWeight:600}}>💰 รับมัดจำ:</span>
                            <input type="number" min="0" value={invoiceForm.depositAmount||""} onFocus={e=>e.target.select()}
                              onChange={e=>setInvoiceForm(f=>({...f,depositAmount:e.target.value}))} placeholder="0"
                              style={{width:90,textAlign:"right",background:"rgba(245,158,11,0.08)",border:"1px solid rgba(245,158,11,0.4)",color:"#b45309",borderRadius:6,padding:"5px 8px",fontFamily:"monospace",fontSize:12,fontWeight:700,outline:"none"}}/>
                            <select value={invoiceForm.depositMethod||"โอน"} onChange={e=>setInvoiceForm(f=>({...f,depositMethod:e.target.value}))}
                              style={{background:"#fff",border:`1px solid ${T.border}`,color:T.text,borderRadius:6,padding:"5px 6px",fontSize:11,outline:"none",cursor:"pointer"}}>
                              {["โอน","เงินสด","COD"].map(m=><option key={m} value={m}>{m}</option>)}
                            </select>
                          </div>
                          {(dep>0||carried>0)&&<div style={{color:remain>0?T.amber:T.green,fontSize:13,fontWeight:800}}>คงเหลือ: <span style={{fontFamily:"monospace"}}>฿{remain.toLocaleString("th-TH",{minimumFractionDigits:2})}</span></div>}
                        </div>
                        );
                      })()}
                    </div>
                  </div>
                )})()}
              </div>
            );
          })()}

          {/* Add item form (พับได้) */}
          <div style={{padding:14,background:"rgba(59,91,139,0.06)",border:"1px solid rgba(59,91,139,0.2)",borderRadius:10,marginBottom:16}}>
            <div onClick={()=>setAddItemCollapsed(c=>!c)}
              style={{display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"pointer",marginBottom:addItemCollapsed?0:10,userSelect:"none"}}>
              <div style={{fontSize:11,color:T.accent,fontWeight:600,display:"flex",alignItems:"center",gap:8}}>
                <span style={{display:"inline-block",width:18,height:18,borderRadius:5,background:"rgba(59,91,139,0.15)",border:"1px solid rgba(59,91,139,0.3)",textAlign:"center",lineHeight:"16px",fontSize:10,color:T.accent,transition:"transform 0.2s",transform:addItemCollapsed?"rotate(-90deg)":"rotate(0deg)"}}>▼</span>
                ➕ เพิ่มรายการสินค้า / บริการ
              </div>
              <span style={{fontSize:10,color:T.muted}}>{addItemCollapsed?"คลิกเพื่อขยาย":"คลิกเพื่อพับ"}</span>
            </div>
            {!addItemCollapsed&&<>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
              <div style={{gridColumn:"1/-1"}}>
                <label style={{fontSize:11,color:T.muted,display:"block",marginBottom:4,fontWeight:600}}>ชื่อรายการ *</label>
                <input value={invoiceItemForm.description} onChange={e=>setInvoiceItemForm(f=>({...f,description:e.target.value}))}
                  onKeyDown={e=>e.key==="Enter"&&handleAddInvoiceItem()}
                  placeholder="เช่น เสื้อยืด รุ่น A ดำ M / ลายพิมพ์โลโก้ DTF / ค่าออกแบบ..."
                  style={{width:"100%",background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:8,padding:"9px 12px",fontFamily:"'Sarabun',sans-serif",fontSize:13,outline:"none"}}/>
              </div>
              <div>
                <label style={{fontSize:11,color:T.muted,display:"block",marginBottom:4,fontWeight:600}}>จำนวน *</label>
                <input type="number" min="1" value={invoiceItemForm.qty} onChange={e=>setInvoiceItemForm(f=>({...f,qty:e.target.value}))} placeholder="0"
                  style={{width:"100%",background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:8,padding:"9px 12px",fontFamily:"monospace",fontSize:13,outline:"none",textAlign:"center"}}/>
              </div>
              <div>
                <label style={{fontSize:11,color:T.muted,display:"block",marginBottom:4,fontWeight:600}}>หน่วย</label>
                <select value={invoiceItemForm.unit} onChange={e=>setInvoiceItemForm(f=>({...f,unit:e.target.value}))}
                  style={{width:"100%",background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:8,padding:"9px 12px",fontFamily:"'Sarabun',sans-serif",fontSize:13,outline:"none"}}>
                  {["ชิ้น","ตัว","โหล","แพ็ค","กล่อง","ชุด","งาน","อัน"].map(u=><option key={u}>{u}</option>)}
                </select>
              </div>
              <div style={{gridColumn:"1/-1"}}>
                <label style={{fontSize:11,color:T.muted,display:"block",marginBottom:4,fontWeight:600}}>ไซส์ (ถ้ามี)</label>
                <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                  {[...apparelSizes, ...shoeSizes.filter(s=>!apparelSizes.includes(s))].map(sz=>{
                    const sel=invoiceItemForm.size===sz;
                    return (
                      <button key={sz} type="button" onClick={()=>setInvoiceItemForm(f=>({...f,size:sel?"":sz}))}
                        style={{padding:"6px 12px",borderRadius:7,border:`1px solid ${sel?"#3b5b8b":T.border}`,background:sel?"rgba(59,91,139,0.15)":"transparent",color:sel?T.accent:T.sub,fontFamily:"monospace",fontWeight:700,fontSize:12,cursor:"pointer"}}>{sz}</button>
                    );
                  })}
                </div>
              </div>
              <div style={{gridColumn:"1/-1"}}>
                <label style={{fontSize:11,color:T.muted,display:"block",marginBottom:4,fontWeight:600}}>สี (ถ้ามี)</label>
                <div style={{display:"flex",gap:8,alignItems:"center"}}>
                  <input type="color" value={invoiceItemForm.colorHex||"#ffffff"} onChange={e=>setInvoiceItemForm(f=>({...f,colorHex:e.target.value}))}
                    style={{width:42,height:38,background:T.input,border:`1px solid ${T.inputBorder}`,borderRadius:8,cursor:"pointer",padding:2}}/>
                  <input value={invoiceItemForm.colorName||""} onChange={e=>setInvoiceItemForm(f=>({...f,colorName:e.target.value}))} placeholder="เช่น ดำ / แดง / กรม (ว่างไว้ได้)"
                    style={{flex:1,background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:8,padding:"9px 12px",fontFamily:"'Sarabun',sans-serif",fontSize:13,outline:"none"}}/>
                  <select onChange={e=>{const p=PRESET_COLORS[e.target.value];if(p){setInvoiceItemForm(f=>({...f,colorName:p.name,colorHex:p.hex}));}e.target.value="";}}
                    style={{background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:8,padding:"9px 10px",fontFamily:"'Sarabun',sans-serif",fontSize:12,outline:"none",cursor:"pointer"}}>
                    <option value="">เลือกสีสำเร็จ...</option>
                    {PRESET_COLORS.map((c,i)=><option key={i} value={i}>{c.name}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label style={{fontSize:11,color:T.muted,display:"block",marginBottom:4,fontWeight:600}}>ราคาต่อหน่วย (฿) *</label>
                <input type="number" min="0" value={invoiceItemForm.unitPrice} onChange={e=>setInvoiceItemForm(f=>({...f,unitPrice:e.target.value}))} placeholder="0.00"
                  style={{width:"100%",background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:8,padding:"9px 12px",fontFamily:"monospace",fontSize:13,outline:"none",textAlign:"right"}}/>
              </div>
              <div style={{display:"flex",alignItems:"flex-end"}}>
                <div style={{padding:"9px 14px",borderRadius:8,background:"rgba(52,211,153,0.1)",border:"1px solid rgba(52,211,153,0.2)",width:"100%",textAlign:"right"}}>
                  <div style={{fontSize:10,color:T.muted,marginBottom:2}}>รวม</div>
                  <div style={{fontFamily:"monospace",fontWeight:700,fontSize:14,color:"#34d399"}}>
                    ฿{((Number(invoiceItemForm.qty)||0)*(Number(invoiceItemForm.unitPrice)||0)).toLocaleString("th-TH",{minimumFractionDigits:2})}
                  </div>
                </div>
              </div>
            </div>
            <button onClick={handleAddInvoiceItem} disabled={!invoiceItemForm.description||!invoiceItemForm.qty||!invoiceItemForm.unitPrice}
              style={{width:"100%",padding:"9px",borderRadius:8,border:"none",cursor:"pointer",background:"linear-gradient(135deg,#3b5b8b,#3b5b8b)",color:"white",fontSize:13,fontWeight:600,fontFamily:"'Sarabun',sans-serif",opacity:(!invoiceItemForm.description||!invoiceItemForm.qty||!invoiceItemForm.unitPrice)?0.45:1,boxShadow:"0 4px 14px rgba(59,91,139,0.25)"}}>
              ✅ เพิ่มรายการนี้
            </button>
            </>}
          </div>

          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:16}}>
            <div>
              <label style={{fontSize:11,color:T.muted,display:"block",marginBottom:4,fontWeight:600}}>วันที่ครบกำหนด</label>
              <input type="date" value={invoiceForm.dueDate} onChange={e=>setInvoiceForm(f=>({...f,dueDate:e.target.value}))}
                style={{width:"100%",background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:9,padding:"8px 12px",fontFamily:"'Sarabun',sans-serif",fontSize:13,outline:"none"}}/>
            </div>
            <div>
              <label style={{fontSize:11,color:T.muted,display:"block",marginBottom:4,fontWeight:600}}>หมายเหตุ</label>
              <input value={invoiceForm.note} onChange={e=>setInvoiceForm(f=>({...f,note:e.target.value}))} placeholder="หมายเหตุเพิ่มเติม..."
                style={{width:"100%",background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:9,padding:"8px 12px",fontFamily:"'Sarabun',sans-serif",fontSize:13,outline:"none"}}/>
            </div>
          </div>

          <div style={{display:"flex",gap:10}}>
            <BtnGhost onClick={()=>{onClose();}} style={{flex:1}}>ยกเลิก</BtnGhost>
            <BtnPrimary onClick={handleConfirmInvoice} disabled={!invoiceForm.customerName||invoiceForm.items.length===0} style={{flex:2,opacity:(!invoiceForm.customerName||invoiceForm.items.length===0)?0.45:1}}>
              {editingInvoiceId ? `💾 บันทึกการแก้ไข ${docTypeLabel(invoiceDocType)}` : `✅ ออก${docTypeLabel(invoiceDocType)} + บันทึก`}
            </BtnPrimary>
          </div>
        </Modal>
  );
}
