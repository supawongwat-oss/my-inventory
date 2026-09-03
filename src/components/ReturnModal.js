// ↩️ รับคืนสินค้า — ออกแบบสำหรับลูกค้าต่างจังหวัดที่ส่งของคืนมาทางพัสดุ
//
// ลำดับการทำงานจริงที่หน้าร้าน:
//   1. กล่องมาถึง → เปิดกล่อง → บันทึกว่าได้อะไรมาบ้าง สภาพเป็นยังไง (ถ่ายรูปไว้)
//   2. ถ้ายังไม่รู้ว่ามาจากบิลไหน → บันทึกไว้ก่อนเป็น "รอจับคู่บิล" ของไม่หายจากระบบ
//   3. พอรู้บิลแล้ว (โทรถาม / ลูกค้าส่งรูปบิลมา / ระบบเดาให้) → จับคู่ → ลดหนี้ + คืนสต็อก
//
// จงใจไม่จับคู่บิลอัตโนมัติแม้คะแนนจะสูง — เป็นเรื่องเงิน ต้องให้คนกดยืนยันเสมอ
import React from "react";
import { T } from "../theme";
import { Modal, MHead, BtnPrimary, BtnGhost } from "./ui";
import { compressImage } from "../utils/imageCompress";
import { uploadImage, deleteFile } from "../utils/upload";
import {
  RETURN_REASONS, RETURN_CONDITIONS, conditionRestocks,
  calcReturn, suggestInvoices, lineKey, matchesTokens, invoiceItemsText, norm, SETTLE_MODES, settleModeOf,
  checkReturnAgainstInvoice, returnableMap,
} from "../utils/returns";

const MAX_IMAGES = 6;
const money = (n) => Number(n || 0).toLocaleString("th-TH", { minimumFractionDigits: 2 });

const inputStyle = {
  width: "100%", boxSizing: "border-box", background: T.input, border: `1px solid ${T.inputBorder}`,
  color: T.text, borderRadius: 8, padding: "8px 11px", fontFamily: "'Sarabun',sans-serif", fontSize: 13, outline: "none",
};
const labelStyle = { fontSize: 11, color: T.muted, display: "block", marginBottom: 5, fontWeight: 600 };

const emptyItem = () => ({ clothingId: "", clothingName: "", colorIdx: null, colorName: "", size: "", qty: 1, unitPrice: 0, condition: RETURN_CONDITIONS[0].id });

export default function ReturnModal({
  existing = null,          // แก้ใบเดิม (เช่น กลับมาจับคู่บิลทีหลัง)
  customers = [],
  clothingItems = [],
  invoices = [],
  returns = [],            // ใบรับคืนใบอื่น — ใช้นับว่าบิลต้นทางถูกคืนไปแล้วเท่าไหร่
  user,
  onSave,
  onCancelReturn,          // ยกเลิกใบนี้ทิ้ง — ให้ทำได้จากในฟอร์มด้วย ไม่ต้องปิดไปหาปุ่มในรายการ
  onClose,
}) {
  const [form, setForm] = React.useState(() => existing || {
    customerId: "", customerName: "", customerPhone: "",
    trackingNo: "", reason: RETURN_REASONS[0], note: "",
    items: [emptyItem()],
    images: [],
    invoiceId: "", invoiceNo: "", settleMode: "statement",
  });
  const [busy, setBusy] = React.useState(false);
  const [invSearch, setInvSearch] = React.useState("");
  const fileRef = React.useRef(null);

  const patch = (p) => setForm(f => ({ ...f, ...p }));
  const setItem = (i, p) => setForm(f => ({ ...f, items: f.items.map((x, j) => j === i ? { ...x, ...p } : x) }));
  const addItem = () => setForm(f => ({ ...f, items: [...f.items, emptyItem()] }));
  // แถวสุดท้ายลบทิ้งไม่ได้ (ฟอร์มต้องมีที่ให้กรอกอย่างน้อยหนึ่งแถว) แต่ต้องล้างค่าให้
  // ของเดิมกด ✕ แล้วเงียบ ไม่มีอะไรเกิดขึ้นและไม่มีคำอธิบาย เหมือนปุ่มเสีย
  const removeItem = (i) => setForm(f => ({
    ...f,
    items: f.items.length > 1 ? f.items.filter((_, j) => j !== i) : [emptyItem()],
  }));

  const validItems = form.items.filter(i => (i.clothingName || i.clothingId) && Number(i.qty) > 0);
  const calc = calcReturn(validItems);

  const pickedInvoice = form.invoiceId ? invoices.find(i => i.id === form.invoiceId) : null;

  // 📏 คืนได้ไม่เกินที่ขายไป — เทียบรายบรรทัดกับบิลต้นทาง
  //    ของเดิมกรอกเท่าไหร่ก็ได้ บิลมี 1 ตัวแต่คืน 13 ตัวก็ผ่าน = ลดหนี้เกิน + สต๊อกเกิน
  const check = React.useMemo(
    () => checkReturnAgainstInvoice(form.items, pickedInvoice, returns, existing?.id || ""),
    [form.items, pickedInvoice, returns, existing]);

  // 🔎 บิลที่น่าจะใช่ — คิดใหม่ทุกครั้งที่ข้อมูลผู้ส่งหรือรายการสินค้าเปลี่ยน
  const suggestions = React.useMemo(
    () => suggestInvoices(invoices, { ...form, items: validItems }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [invoices, form.customerName, form.customerPhone, JSON.stringify(validItems.map(lineKey))]
  );

  const manualHits = React.useMemo(() => {
    const q = norm(invSearch);
    if (!q) return [];
    return invoices
      .filter(inv => !inv.mergedInto && !inv.convertedTo)
      .filter(inv => matchesTokens(
        [inv.invoiceNo, inv.customerName, inv.customerPhone, invoiceItemsText(inv)].join(" "), q))
      .slice(0, 10);
  }, [invoices, invSearch]);

  // เลือกลูกค้าจากรายการ → เติมชื่อ+เบอร์ให้ (คะแนนจับคู่บิลจะแม่นขึ้นทันที)
  const pickCustomer = (id) => {
    const c = customers.find(x => x.id === id);
    patch(c ? { customerId: c.id, customerName: c.name || "", customerPhone: c.phone || "" } : { customerId: "" });
  };

  // เลือกบิล → ดึงราคาต่อหน่วย "ของบิลใบนั้น" มาใส่ให้ ไม่ใช่ราคาป้ายวันนี้
  const pickInvoice = (inv) => {
    if (!inv) { patch({ invoiceId: "", invoiceNo: "" }); return; }
    const priceOf = new Map();
    (inv.items || []).forEach(it => { if (!priceOf.has(lineKey(it))) priceOf.set(lineKey(it), Number(it.unitPrice) || 0); });
    setForm(f => ({
      ...f,
      invoiceId: inv.id, invoiceNo: inv.invoiceNo || "",
      customerId: f.customerId || inv.customerId || "",
      customerName: f.customerName || inv.customerName || "",
      customerPhone: f.customerPhone || inv.customerPhone || "",
      items: f.items.map(it => {
        const p = priceOf.get(lineKey(it));
        return p != null ? { ...it, unitPrice: p } : it;
      }),
    }));
  };

  // ติ๊กบรรทัดจากบิลโดยตรง — เร็วกว่าพิมพ์เองมาก เมื่อรู้บิลแล้ว
  const addFromInvoiceLine = (it) => {
    setForm(f => {
      const k = lineKey(it);
      const idx = f.items.findIndex(x => lineKey(x) === k);
      const line = {
        clothingId: it.clothingId || "", clothingName: it.clothingName || it.description || "",
        colorIdx: it.colorIdx ?? null, colorName: it.colorName || "", size: it.size || "",
        qty: 1, unitPrice: Number(it.unitPrice) || 0, condition: RETURN_CONDITIONS[0].id,
      };
      // กดเพิ่มทีละ 1 แต่ห้ามเกินที่ขายไป (นับใบรับคืนใบอื่นของบิลนี้ด้วย)
      const cap = returnableMap(pickedInvoice, returns, existing?.id || "").get(k)?.left ?? Infinity;
      if (idx >= 0) return { ...f, items: f.items.map((x, j) => j === idx ? { ...x, qty: Math.min(cap, Number(x.qty || 0) + 1) } : x) };
      line.qty = Math.min(cap, 1);
      // แถวว่างแถวแรกให้ทับได้ ไม่งั้นจะมีแถวเปล่าค้าง
      const blank = f.items.findIndex(x => !x.clothingName && !x.clothingId);
      if (blank >= 0) return { ...f, items: f.items.map((x, j) => j === blank ? line : x) };
      return { ...f, items: [...f.items, line] };
    });
  };

  const addImages = async (e) => {
    const files = [...(e.target.files || [])];
    if (!files.length) return;
    const room = MAX_IMAGES - (form.images || []).length;
    if (room <= 0) { alert(`แนบได้สูงสุด ${MAX_IMAGES} รูป`); return; }
    setBusy(true);
    try {
      const added = [];
      for (const f of files.slice(0, room)) {
        const dataUrl = await compressImage(f, { maxDim: 1200, quality: 0.75 });
        try {
          const { url, path } = await uploadImage(dataUrl, "returns");
          added.push({ url, path });
        } catch (err) {
          // Storage ล่ม → เก็บ base64 ในเอกสารแทน รูปสภาพสินค้าสำคัญเกินกว่าจะยอมให้หาย
          added.push({ url: dataUrl, path: "" });
        }
      }
      patch({ images: [...(form.images || []), ...added] });
    } catch (err) {
      alert("แนบรูปไม่สำเร็จ: " + (err?.message || err));
    } finally {
      setBusy(false);
      if (e.target) e.target.value = "";
    }
  };

  const removeImage = (i) => {
    const im = (form.images || [])[i];
    if (im?.path) deleteFile(im.path).catch(() => {});
    patch({ images: (form.images || []).filter((_, j) => j !== i) });
  };

  const save = async (matchNow) => {
    if (validItems.length === 0) { alert("ยังไม่ได้ระบุสินค้าที่คืนมา"); return; }
    if (matchNow && !pickedInvoice) { alert("ยังไม่ได้เลือกบิลต้นทาง"); return; }
    // 🔒 คืนเกินที่ขายไป = ลดหนี้เกินจริง ต้องหยุดไว้ ไม่ใช่เตือนแล้วปล่อยผ่าน
    if (matchNow && check.hasOver) {
      const NL = String.fromCharCode(10);
      alert(
        "คืนเกินจำนวนที่ขายไปในบิลนี้ — บันทึกไม่ได้" + NL + NL +
        form.items.map((it, i) => {
          const r = check.rows[i];
          if (!r?.over) return null;
          return `• ${it.clothingName || "(ไม่ระบุรุ่น)"} ${it.colorName || ""} ${it.size || ""}: กรอก ${r.qty} · ขายไป ${r.sold}` +
                 (r.returned > 0 ? ` · คืนแล้ว ${r.returned}` : "") + ` · คืนได้อีก ${r.left}`;
        }).filter(Boolean).join(NL) + NL + NL +
        "ถ้าลูกค้าคืนของจากบิลใบอื่นด้วย ให้แยกทำอีกใบตามบิลนั้น"
      );
      return;
    }
    setBusy(true);
    try {
      await onSave({
        ...form,
        items: validItems.map(i => ({ ...i, qty: Number(i.qty) || 0, unitPrice: Number(i.unitPrice) || 0, restock: conditionRestocks(i.condition) })),
        status: matchNow ? "จับคู่แล้ว" : "รอจับคู่บิล",
        creditQty: calc.qty,
        creditTotal: matchNow ? calc.total : 0,   // ยังไม่จับคู่ = ยังไม่รู้ราคาจริง ยังลดหนี้ไม่ได้
        restockQty: calc.restockQty,
        invoiceId: matchNow ? form.invoiceId : "",
        invoiceNo: matchNow ? form.invoiceNo : "",
        settleMode: settleModeOf(form),
      }, matchNow);
      onClose();
    } catch (e) {
      alert("บันทึกไม่สำเร็จ: " + (e?.message || e));
      setBusy(false);
    }
  };

  const SugRow = ({ inv, score, reasons }) => {
    const on = form.invoiceId === inv.id;
    return (
      <div onClick={() => pickInvoice(on ? null : inv)}
        style={{ padding: "8px 10px", borderRadius: 8, cursor: "pointer", marginBottom: 5,
          border: on ? `2px solid ${T.accent}` : `1px solid ${T.border}`, background: on ? "rgba(59,91,139,0.07)" : "white" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: T.text }}>
            {on ? "✅ " : ""}{inv.invoiceNo} · {inv.customerName}
          </div>
          <div style={{ fontSize: 11, fontFamily: "monospace", color: T.muted, whiteSpace: "nowrap" }}>
            ฿{money(inv.total)} · {inv.date || ""}
          </div>
        </div>
        {reasons?.length > 0 && (
          <div style={{ fontSize: 10, color: score >= 90 ? T.green : T.amber, marginTop: 2 }}>
            {score >= 90 ? "🎯 " : "• "}{reasons.join(" · ")}
          </div>
        )}
      </div>
    );
  };

  return (
    <Modal onClose={onClose} w={880}>
      <MHead title={existing ? "↩️ แก้ไข/จับคู่ใบรับคืน" : "↩️ รับคืนสินค้า"}
        sub={existing?.returnNo || "ของถึงร้านแล้ว บันทึกไว้ก่อนได้ ยังไม่ต้องรู้บิล"}
        onClose={onClose} color={T.amber}/>

      {/* ── ผู้ส่งคืน ── */}
      <div style={{ fontSize: 11, color: T.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>ผู้ส่งคืน</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
        <div>
          <label style={labelStyle}>ลูกค้า (ถ้ารู้)</label>
          <select value={form.customerId} onChange={e => pickCustomer(e.target.value)} style={inputStyle}>
            <option value="">— ยังไม่ทราบ / กรอกเอง —</option>
            {customers.map(c => <option key={c.id} value={c.id}>{c.name}{c.phone ? ` · ${c.phone}` : ""}</option>)}
          </select>
        </div>
        <div>
          <label style={labelStyle}>เลขพัสดุ / ขนส่ง</label>
          <input value={form.trackingNo} onChange={e => patch({ trackingNo: e.target.value })} placeholder="เช่น TH123456789" style={inputStyle}/>
        </div>
        <div>
          <label style={labelStyle}>ชื่อบนกล่อง</label>
          <input value={form.customerName} onChange={e => patch({ customerName: e.target.value, customerId: "" })} placeholder="ชื่อผู้ส่ง" style={inputStyle}/>
        </div>
        <div>
          <label style={labelStyle}>เบอร์บนกล่อง <span style={{ color: T.green }}>← ช่วยหาบิลได้แม่นสุด</span></label>
          <input value={form.customerPhone} onChange={e => patch({ customerPhone: e.target.value, customerId: "" })} placeholder="08x-xxx-xxxx" style={inputStyle}/>
        </div>
        <div>
          <label style={labelStyle}>เหตุผลที่คืน</label>
          <select value={form.reason} onChange={e => patch({ reason: e.target.value })} style={inputStyle}>
            {RETURN_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div>
          <label style={labelStyle}>หมายเหตุ</label>
          <input value={form.note} onChange={e => patch({ note: e.target.value })} placeholder="รายละเอียดเพิ่มเติม" style={inputStyle}/>
        </div>
      </div>

      {/* ── สินค้าที่คืนมา ── */}
      <div style={{ fontSize: 11, color: T.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", margin: "16px 0 8px" }}>สินค้าที่คืนมา</div>
      {form.items.map((it, i) => {
        const ci = clothingItems.find(c => c.id === it.clothingId);
        const colors = ci?.colors || [];
        return (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 0.7fr 0.6fr 0.8fr 1fr 28px", gap: 6, marginBottom: 6, alignItems: "end" }}>
            <div>
              {i === 0 && <label style={labelStyle}>รุ่น</label>}
              <select value={it.clothingId} onChange={e => {
                const c = clothingItems.find(x => x.id === e.target.value);
                setItem(i, c ? { clothingId: c.id, clothingName: c.model || c.name || "", colorIdx: null, colorName: "" } : { clothingId: "" });
              }} style={{ ...inputStyle, padding: "7px 8px", fontSize: 12 }}>
                <option value="">— พิมพ์ชื่อเอง —</option>
                {clothingItems.map(c => <option key={c.id} value={c.id}>{c.model || c.name}</option>)}
              </select>
              {!it.clothingId && (
                <input value={it.clothingName} onChange={e => setItem(i, { clothingName: e.target.value })}
                  placeholder="ชื่อรุ่นตามป้ายบนเสื้อ" style={{ ...inputStyle, marginTop: 4, padding: "7px 8px", fontSize: 12 }}/>
              )}
            </div>
            <div>
              {i === 0 && <label style={labelStyle}>สี</label>}
              {colors.length > 0 ? (
                <select value={it.colorIdx ?? ""} onChange={e => {
                  const idx = e.target.value === "" ? null : Number(e.target.value);
                  setItem(i, { colorIdx: idx, colorName: idx == null ? "" : (colors[idx]?.colorName || "") });
                }} style={{ ...inputStyle, padding: "7px 8px", fontSize: 12 }}>
                  <option value="">— เลือกสี —</option>
                  {colors.map((c, ci2) => <option key={ci2} value={ci2}>{c.colorName}</option>)}
                </select>
              ) : (
                <input value={it.colorName} onChange={e => setItem(i, { colorName: e.target.value })} placeholder="สี" style={{ ...inputStyle, padding: "7px 8px", fontSize: 12 }}/>
              )}
            </div>
            <div>
              {i === 0 && <label style={labelStyle}>ไซส์</label>}
              <input value={it.size} onChange={e => setItem(i, { size: e.target.value.toUpperCase() })} placeholder="2XL"
                style={{ ...inputStyle, padding: "7px 8px", fontSize: 12, textAlign: "center", fontFamily: "monospace" }}/>
            </div>
            <div>
              {i === 0 && <label style={labelStyle}>จำนวน</label>}
              <input type="number" min="1" value={it.qty} onChange={e => setItem(i, { qty: Math.max(1, Number(e.target.value) || 1) })}
                style={{ ...inputStyle, padding: "7px 8px", fontSize: 12, textAlign: "center", fontFamily: "monospace",
                  border: check.rows[i]?.over ? "1px solid #dc2626" : inputStyle.border,
                  background: check.rows[i]?.over ? "rgba(220,38,38,0.06)" : inputStyle.background }}/>
              {/* 📏 โควตาของบรรทัดนี้ — เห็นตอนพิมพ์เลย ไม่ใช่ไปเจอตอนกดบันทึกแล้วไม่ผ่าน */}
              {check.rows[i]?.over && (
                <div style={{ fontSize: 9, color: "#dc2626", fontWeight: 700, marginTop: 2, lineHeight: 1.4 }}>
                  เกิน! ขายไป {check.rows[i].sold}{check.rows[i].returned > 0 ? ` · คืนแล้ว ${check.rows[i].returned}` : ""} · คืนได้อีก {check.rows[i].left}
                </div>
              )}
              {check.rows[i] && !check.rows[i].over && !check.rows[i].notOnBill && (
                <div style={{ fontSize: 9, color: T.muted, marginTop: 2 }}>คืนได้อีก {check.rows[i].left - check.rows[i].qty}</div>
              )}
              {check.rows[i]?.notOnBill && (
                <div style={{ fontSize: 9, color: "#b45309", marginTop: 2, lineHeight: 1.4 }}>⚠️ ไม่มีบรรทัดนี้ในบิล</div>
              )}
            </div>
            <div>
              {i === 0 && <label style={labelStyle}>ราคา/หน่วย</label>}
              <input type="number" min="0" step="0.01" value={it.unitPrice} onChange={e => setItem(i, { unitPrice: Math.max(0, Number(e.target.value) || 0) })}
                title="ดึงมาจากบิลต้นทางให้อัตโนมัติเมื่อเลือกบิลแล้ว"
                style={{ ...inputStyle, padding: "7px 8px", fontSize: 12, textAlign: "right", fontFamily: "monospace" }}/>
            </div>
            <div>
              {i === 0 && <label style={labelStyle}>สภาพ</label>}
              <select value={it.condition} onChange={e => setItem(i, { condition: e.target.value })}
                title={RETURN_CONDITIONS.find(c => c.id === it.condition)?.hint}
                style={{ ...inputStyle, padding: "7px 8px", fontSize: 12, color: conditionRestocks(it.condition) ? T.green : T.red }}>
                {RETURN_CONDITIONS.map(c => <option key={c.id} value={c.id}>{c.id}</option>)}
              </select>
            </div>
            <button onClick={() => removeItem(i)} title="ลบแถวนี้"
              style={{ background: "none", border: "none", color: "#f87171", cursor: "pointer", fontSize: 13, padding: "8px 0" }}>✕</button>
          </div>
        );
      })}
      <button onClick={addItem} style={{ padding: "6px 12px", borderRadius: 8, border: `1px dashed ${T.accent}`, background: "rgba(59,91,139,0.06)", color: T.accent, cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: "'Sarabun',sans-serif" }}>➕ เพิ่มรายการ</button>

      {/* ── รูปสภาพสินค้า ── */}
      <div style={{ marginTop: 14 }}>
        <input ref={fileRef} type="file" accept="image/*" multiple onChange={addImages} style={{ display: "none" }}/>
        <button onClick={() => fileRef.current?.click()} disabled={busy}
          style={{ padding: "6px 12px", borderRadius: 8, border: `1px dashed ${T.border}`, background: "white", color: T.sub, cursor: busy ? "wait" : "pointer", fontSize: 12, fontFamily: "'Sarabun',sans-serif" }}>
          📷 ถ่ายรูปสภาพสินค้า ({(form.images || []).length}/{MAX_IMAGES})
        </button>
        {(form.images || []).length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(84px,1fr))", gap: 6, marginTop: 8 }}>
            {form.images.map((im, i) => (
              <div key={i} style={{ position: "relative", height: 62, background: "#f8fafc", border: `1px solid ${T.border}`, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                <img src={im.url} alt="" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}/>
                <button onClick={() => removeImage(i)} style={{ position: "absolute", top: 2, right: 2, width: 18, height: 18, borderRadius: 9, border: "none", background: "rgba(239,68,68,0.9)", color: "white", cursor: "pointer", fontSize: 10, lineHeight: "18px", padding: 0 }}>✕</button>
              </div>
            ))}
          </div>
        )}
        <div style={{ fontSize: 10, color: T.muted, marginTop: 5 }}>ถ่ายไว้เป็นหลักฐาน เผื่อต้องเคลมกับขนส่งหรือคุยกับลูกค้าทีหลัง</div>
      </div>

      {/* ── จับคู่บิล ── */}
      <div style={{ fontSize: 11, color: T.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", margin: "18px 0 8px" }}>บิลต้นทาง</div>

      {suggestions.length > 0 ? (
        <>
          <div style={{ fontSize: 11, color: T.sub, marginBottom: 6 }}>บิลที่น่าจะใช่ — เรียงจากตรงมากสุด กดเลือกได้เลย</div>
          {suggestions.map(s => <SugRow key={s.inv.id} {...s}/>)}
        </>
      ) : (
        <div style={{ fontSize: 11, color: T.muted, marginBottom: 8 }}>
          ยังเดาบิลไม่ได้ — กรอกเบอร์โทรหรือระบุสินค้าให้ครบขึ้น แล้วรายการจะขึ้นเอง
        </div>
      )}

      <input value={invSearch} onChange={e => setInvSearch(e.target.value)}
        placeholder="🔍 หาบิลเอง — เลขที่ / ชื่อลูกค้า / ชื่อรุ่น สี ไซส์"
        style={{ ...inputStyle, marginTop: 8 }}/>
      {manualHits.map(inv => <SugRow key={inv.id} inv={inv} score={0} reasons={[]}/>)}

      {/* บรรทัดในบิลที่เลือก — ติ๊กเพิ่มเข้ารายการคืนได้เลย */}
      {pickedInvoice && (
        <div style={{ marginTop: 10, padding: 10, background: "rgba(59,91,139,0.05)", border: `1px solid ${T.border}`, borderRadius: 8 }}>
          <div style={{ fontSize: 11, color: T.sub, marginBottom: 6 }}>รายการในบิล {pickedInvoice.invoiceNo} — กดเพื่อเพิ่มเข้ารายการคืน</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
            {(pickedInvoice.items || []).map((it, i) => (
              <button key={i} onClick={() => addFromInvoiceLine(it)}
                style={{ padding: "4px 9px", borderRadius: 7, border: `1px solid ${T.border}`, background: "white", cursor: "pointer", fontSize: 11, fontFamily: "'Sarabun',sans-serif", color: T.text }}>
                {it.clothingName || it.description} {it.colorName ? `· ${it.colorName}` : ""} {it.size ? `· ${it.size}` : ""} <span style={{ color: T.muted }}>×{it.qty}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 💰 คืนเงินให้ลูกค้าทางไหน — ต้องเลือกทางเดียว ไม่งั้นได้คืน 2 ทาง */}
      {pickedInvoice && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 11, color: T.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>คืนเงินให้ลูกค้าทางไหน</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {SETTLE_MODES.map(m => {
              const on = settleModeOf(form) === m.id;
              return (
                <label key={m.id} style={{ flex: "1 1 200px", display: "flex", alignItems: "flex-start", gap: 8, padding: "9px 12px", borderRadius: 9, cursor: "pointer", border: `1px solid ${on ? (m.id === "cash" ? "#b45309" : T.accent) : T.border}`, background: on ? (m.id === "cash" ? "rgba(217,119,6,0.08)" : "rgba(59,91,139,0.06)") : T.input }}>
                  <input type="radio" name="settleMode" checked={on} onChange={() => patch({ settleMode: m.id })} style={{ marginTop: 2, cursor: "pointer" }} />
                  <div>
                    <div style={{ fontSize: 12, fontWeight: on ? 700 : 500, color: on ? (m.id === "cash" ? "#b45309" : T.accent) : T.text }}>
                      {m.id === "cash" ? "💵 " : "📃 "}{m.label}
                    </div>
                    <div style={{ fontSize: 10, color: T.muted, marginTop: 2 }}>{m.hint}</div>
                  </div>
                </label>
              );
            })}
          </div>
          {settleModeOf(form) === "cash" && (
            <div style={{ fontSize: 10, color: "#b45309", marginTop: 6, lineHeight: 1.6 }}>
              ⚠️ ใบนี้จะไม่ถูกนำไปหักในใบวางบิล — พิมพ์ใบลดหนี้ให้ลูกค้าเก็บไว้เป็นหลักฐานการรับเงินคืน
            </div>
          )}
        </div>
      )}
      {/* ── สรุป ── */}
      <div style={{ marginTop: 16, padding: "10px 14px", background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: 12, color: T.sub }}>
          คืน <b style={{ fontFamily: "monospace", fontSize: 14, color: T.text }}>{calc.qty}</b> ชิ้น
          {calc.restockQty !== calc.qty && <span style={{ color: T.amber }}> · เข้าสต็อกได้ {calc.restockQty} ชิ้น</span>}
        </div>
        <div style={{ fontSize: 13, fontWeight: 700, color: pickedInvoice ? T.green : T.muted }}>
          ยอดลดหนี้: <span style={{ fontFamily: "monospace" }}>฿{money(calc.total)}</span>
          {!pickedInvoice && <span style={{ fontSize: 11, fontWeight: 400 }}> (ต้องเลือกบิลก่อน)</span>}
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
        <BtnGhost onClick={onClose} style={{ flex: 1 }}>{existing?.id ? "ปิดหน้าต่าง" : "ยกเลิก"}</BtnGhost>
        {/* ✕ ยกเลิกใบนี้ — เดิมมีแต่ในหน้ารายการ คนที่เปิดใบมาดูแล้วอยากยกเลิกจึงหาไม่เจอ
            (ยกเลิกได้เฉพาะ admin และถ้าใบนี้ถูกหักในใบวางบิลไปแล้วจะถูกห้าม ตัว handler เช็กเอง) */}
        {existing?.id && existing.status !== "ยกเลิก" && user?.role === "admin" && onCancelReturn && (
          <BtnGhost onClick={async () => { const ok = await onCancelReturn(existing); if (ok) onClose?.(); }}
            style={{ flex: 1, color: "#b91c1c", borderColor: "rgba(239,68,68,0.35)" }}>
            ✕ ยกเลิกใบรับคืนนี้
          </BtnGhost>
        )}
        {existing?.status !== "จับคู่แล้ว" && (
          <BtnGhost onClick={() => save(false)} disabled={busy || validItems.length === 0} style={{ flex: 2, opacity: (busy || validItems.length === 0) ? 0.45 : 1 }}>
            📥 รับของไว้ก่อน (ยังไม่รู้บิล)
          </BtnGhost>
        )}
        <BtnPrimary onClick={() => save(true)} disabled={busy || validItems.length === 0 || !pickedInvoice || check.hasOver}
          style={{ flex: 2, opacity: (busy || validItems.length === 0 || !pickedInvoice || check.hasOver) ? 0.45 : 1 }}>
          {busy ? "⏳ กำลังบันทึก..."
            : check.hasOver ? "🔒 คืนเกินจำนวนที่ขายไป"
            : (existing?.status === "จับคู่แล้ว" ? "💾 บันทึกการแก้ไข" : "✅ จับคู่บิล + ลดหนี้")}
        </BtnPrimary>
      </div>
      <div style={{ fontSize: 10, color: T.muted, marginTop: 8, lineHeight: 1.6 }}>
        บิลต้นทางจะไม่ถูกแก้ — เอกสารที่ออกไปแล้วคงสภาพเดิม · หักในใบวางบิล = ยกไปหักงวดถัดไป · คืนเงินสด = พิมพ์ใบลดหนี้ให้ลูกค้า
        {calc.restockQty > 0 && ` · ของสภาพดี ${calc.restockQty} ชิ้นจะถูกคืนเข้าสต็อกอัตโนมัติ`}
      </div>
    </Modal>
  );
}
