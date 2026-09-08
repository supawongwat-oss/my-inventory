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
import { fetchInvoicesOfCustomer } from "../utils/fetchInvoices";
import { findParcelSource } from "../utils/parcelLookup";
import {
  RETURN_REASONS, RETURN_CONDITIONS, conditionRestocks,
  calcReturn, suggestInvoices, lineKey, matchesTokens, invoiceItemsText, norm, SETTLE_MODES, settleModeOf,
  checkReturnLines, returnableMap, invoiceLineResolver,
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
  // ชื่อ/เบอร์บนกล่องเปิดค้างไว้ถ้าใบเดิมเคยกรอกไว้ — ไม่งั้นเปิดใบเก่ามาแล้วมองไม่เห็นว่ามีข้อมูลอยู่
  const [showBoxInfo, setShowBoxInfo] = React.useState(() => !!(existing?.customerName || existing?.customerPhone));
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

  // 📦 ผลการตามจากเลขพัสดุ (ตัวค้นอยู่ล่างลงไป) — ประกาศไว้ตรงนี้เพราะ allInvoices ข้างล่างอ่านค่าไปใช้
  const [parcel, setParcel] = React.useState(null);
  const [parcelRun, setParcelRun] = React.useState(null);
  const [parcelInvoice, setParcelInvoice] = React.useState(null);
  const [parcelBusy, setParcelBusy] = React.useState(false);
  const [parcelMsg, setParcelMsg] = React.useState("");

  // 📥 พอรู้ว่าเป็นลูกค้ารายไหน ให้ไปขอบิลของร้านนั้นมาทั้งหมด
  //
  //    ของคืนมาช้ากว่าวันขายเสมอ และบางทีเป็นเดือน — แต่กองที่แอปโหลดค้างไว้มีแค่ 30 วัน
  //    ลูกค้าเอาของที่ซื้อไป 45 วันก่อนมาคืน = หาบิลต้นทางไม่เจอ จับคู่ไม่ได้
  //    แล้วใบรับคืนก็ค้างอยู่ในกอง "รอจับคู่บิล" ทั้งที่บิลมีอยู่จริงในระบบ
  //
  //    ถามตรง ๆ ว่า "ขอบิลของร้านนี้" ย้อนได้ไม่จำกัด และเบากว่าโหลดทั้งเดือนมาทั้งกอง
  const [custInvoices, setCustInvoices] = React.useState([]);
  const [custInvBusy, setCustInvBusy] = React.useState(false);
  React.useEffect(() => {
    if (!form.customerId) { setCustInvoices([]); return; }
    let dead = false;
    setCustInvBusy(true);
    fetchInvoicesOfCustomer(form.customerId)
      .then(list => { if (!dead) setCustInvoices(list); })
      // ดึงไม่ได้ → ใช้กองเดิม ยังจับคู่บิลใหม่ ๆ ได้อยู่
      .catch(e => { if (!dead) { console.warn("[return] ดึงบิลของลูกค้าไม่สำเร็จ:", e); setCustInvoices([]); } })
      .finally(() => { if (!dead) setCustInvBusy(false); });
    return () => { dead = true; };
  }, [form.customerId]);

  // บิลของลูกค้ารายนี้มาก่อน แล้วต่อด้วยกองเดิม (เผื่อบิลที่ยังไม่ผูกรหัสลูกค้า)
  // บิลที่ตามได้จากเลขพัสดุต้องอยู่ในกองนี้ด้วย ไม่งั้น pickedInvoice เป็น null
  // → ด่านกันคืนเกินหายไปเงียบ ๆ ทั้งที่รู้บิลแล้ว
  const allInvoices = React.useMemo(() => {
    const head = parcelInvoice ? [parcelInvoice] : [];
    custInvoices.forEach(i => { if (i.id !== parcelInvoice?.id) head.push(i); });
    const seen = new Set(head.map(i => i.id));
    return [...head, ...invoices.filter(i => !seen.has(i.id))];
  }, [custInvoices, invoices, parcelInvoice]);

  // 📦 ตามจากเลขพัสดุบนกล่อง — ทางเดียวที่ "รู้" ไม่ใช่ "เดา"
  //
  //    ของจากรอบแพ็คไม่มีทางเดาต้นบิลได้เลย: รอบเก็บเป็นตัวนับ ปิดรอบออกบิลใบเดียวทั้งรอบ
  //    และรุ่นเดียวกันออกทุกวัน — ตัวช่วยเดาด้านล่างจะเจอบิลที่คะแนนเท่ากันเป็นสิบใบ
  //    แต่เลขพัสดุติดกล่องมาเสมอ และถูกเก็บไว้ตอนลากใบปะหน้าเข้าระบบแล้ว
  const lookupParcel = async (raw) => {
    const q = String(raw || "").trim();
    if (!q) return;
    setParcelBusy(true); setParcelMsg("");
    setParcel(null); setParcelRun(null); setParcelInvoice(null);
    try {
      const src = await findParcelSource(q);
      if (!src) {
        setParcelMsg("ไม่พบเลขพัสดุนี้ — อาจเป็นของก่อนที่ระบบจะเริ่มเก็บ หรือเป็นรอบที่นำเข้าด้วยการวางข้อความ");
        // ค้นไม่เจอก็ยังต้องเก็บเลขที่พิมพ์มาไว้ในใบ — เป็นหลักฐานว่ากล่องไหน
        // (ตอนนี้ช่องนี้เป็นช่องเดียวที่รับเลขพัสดุแล้ว ถ้าไม่เก็บตรงนี้ก็ไม่มีที่เก็บเลย)
        patch({ trackingNo: q });
        return;
      }
      setParcel(src.parcel); setParcelRun(src.run); setParcelInvoice(src.invoice);
      // เติมให้เท่าที่รู้ — ลูกค้าคือเจ้าของรอบแพ็ค (คนที่เราออกบิลให้) ไม่ใช่คนที่ส่งของกลับมา
      patch({
        customerId: src.parcel.customerId || "", customerName: src.parcel.customerName || "",
        trackingNo: src.parcel.track || q,
      });
      // เลือกบิลให้เลยเมื่อยังไม่ได้เลือกไว้
      //
      // ไม่ขัดกับกฎ "ห้ามจับคู่บิลอัตโนมัติ" ข้างบน — กฎนั้นห้ามเชื่อ "การเดา" จากคะแนนความคล้าย
      // อันนี้ไม่ใช่การเดา: เลขพัสดุถูกจดไว้ตอนนำเข้าใบปะหน้าว่าอยู่รอบไหน และรอบนั้นถูกปั๊มเลขบิลไว้ตอนออกบิล
      // เป็นเส้นที่ระบบบันทึกเอง คนยังต้องกดบันทึกใบคืนอยู่ดี และเปลี่ยนบิลเองได้จากรายการด้านล่าง
      //
      // ไม่แตะบิลที่เลือกไว้แล้ว — pickInvoice ทับราคาต่อหน่วยด้วยราคาของบิลใหม่
      // ใบที่ตกลงยอดกับลูกค้าไปแล้ว ห้ามให้การกดค้นเลขพัสดุไปเปลี่ยนยอดเงียบ ๆ
      if (src.invoice && !form.invoiceId) pickInvoice(src.invoice);
    } catch (e) {
      setParcelMsg("ค้นไม่สำเร็จ: " + (e?.message || e));
    } finally { setParcelBusy(false); }
  };

  // ค้นให้เองเมื่อพิมพ์/สแกนครบ — ไม่ต้องกด Enter ไม่ต้องคลิกออกจากช่อง
  //
  //    ของเดิมค้นตอน Enter กับตอน blur เท่านั้น พิมพ์เลขเสร็จแล้วมองจอรอ = ไม่มีอะไรเกิดขึ้น
  //    ดูเหมือนฟีเจอร์เสีย ทั้งที่แค่ยังไม่ได้สั่งให้ค้น
  //    เครื่องสแกนบาร์โค้ดส่วนใหญ่เคาะ Enter ให้อยู่แล้ว แต่คนพิมพ์มือไม่เคาะ
  //
  //    หน่วง 450ms กันยิงรัวทุกตัวอักษร และกันเลขที่พิมพ์ค้างกลางคัน
  const [trackInput, setTrackInput] = React.useState(existing?.trackingNo || "");
  const lastLookup = React.useRef("");
  React.useEffect(() => {
    const v = trackInput.trim();
    if (v.length < 8 || v === lastLookup.current) return;
    const t = setTimeout(() => { lastLookup.current = v; lookupParcel(v); }, 450);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackInput]);

  const pickedInvoice = form.invoiceId ? allInvoices.find(i => i.id === form.invoiceId) : null;

  const invoiceById = React.useMemo(() => {
    const m = new Map();
    allInvoices.forEach(i => m.set(i.id, i));
    return m;
  }, [allInvoices]);
  const invoiceOf = React.useCallback(id => invoiceById.get(id) || null, [invoiceById]);

  // 📏 คืนได้ไม่เกินที่ขายไป — เทียบทีละบรรทัด กับบิลของบรรทัดนั้นเอง
  //    ของเดิมกรอกเท่าไหร่ก็ได้ บิลมี 1 ตัวแต่คืน 13 ตัวก็ผ่าน = ลดหนี้เกิน + สต๊อกเกิน
  const check = React.useMemo(
    () => checkReturnLines(form.items, invoiceOf, returns, existing?.id || ""),
    [form.items, invoiceOf, returns, existing]);
  const billQuota = React.useMemo(
    () => returnableMap(pickedInvoice, returns, existing?.id || ""),
    [pickedInvoice, returns, existing]);

  // 🧾 บิลที่ใบนี้อ้างถึงทั้งหมด — ใบเดียวมีของหลายบิลได้
  const billsInForm = React.useMemo(() => {
    const out = [];
    form.items.forEach(it => {
      if (!it.invoiceId || !(Number(it.qty) > 0)) return;
      const hit = out.find(b => b.id === it.invoiceId);
      if (hit) { hit.qty += Number(it.qty) || 0; hit.total += (Number(it.qty) || 0) * (Number(it.unitPrice) || 0); }
      else out.push({ id: it.invoiceId, no: it.invoiceNo || "", qty: Number(it.qty) || 0, total: (Number(it.qty) || 0) * (Number(it.unitPrice) || 0) });
    });
    return out;
  }, [form.items]);

  // ราคาต่อหน่วยของบรรทัดนี้ "ในบิลใบนั้น" — ไม่ใช่ราคาป้ายวันนี้
  //   เทียบด้วยตัวแปลงกุญแจ ไม่ใช่ lineKey ดิบ — บรรทัดที่พิมพ์ชื่อเอง (ไม่มี id)
  //   ต้องได้ราคาจากบิลด้วย ไม่งั้นค้างที่ 0 แล้วลดหนี้ขาดโดยไม่มีใครเห็น
  const priceInInvoice = (inv, it) => {
    const k = invoiceLineResolver(inv)(it);
    const hit = (inv?.items || []).find(x => lineKey(x) === k);
    return hit ? Number(hit.unitPrice) || 0 : null;
  };

  // 📦 ของในกล่องนี้ — กดเพิ่มเข้ารายการคืนได้เลย ไม่ต้องพิมพ์ชื่อรุ่น/สี/ไซส์/ราคาเอง
  //
  //    ระบบรู้อยู่แล้วว่ากล่องนี้ใส่อะไรไปบ้าง (จดไว้ตอนลากใบปะหน้าเข้าระบบ)
  //    ให้พนักงานพิมพ์ซ้ำอีกรอบคือให้พิมพ์ผิดฟรี ๆ — ชื่อรุ่นบนป้ายกับในคลังสะกดไม่เหมือนกันบ่อย
  //
  //    ลูกค้าคืนไม่ครบกล่องก็มี จึงกดทีละชิ้นได้ และมีปุ่มเพิ่มทั้งกล่องไว้ให้เคสคืนทั้งกล่อง
  const parcelRowOf = (x) => {
    const base = {
      clothingId: x.clothingId || "", clothingName: x.clothingName || "",
      colorIdx: x.colorIdx ?? null, colorName: x.colorName || "", size: x.size || "",
      qty: Number(x.qty) || 1, unitPrice: 0, condition: RETURN_CONDITIONS[0].id,
      invoiceId: parcelInvoice?.id || "", invoiceNo: parcelInvoice?.invoiceNo || "",
    };
    const p = parcelInvoice ? priceInInvoice(parcelInvoice, base) : null;
    return p != null ? { ...base, unitPrice: p } : base;
  };
  const parcelLineKey = (it) => lineKey(it) + "|" + (it.invoiceId || "");
  const addParcelItems = (list) => {
    const rows = (list || []).filter(x => Number(x.qty) > 0).map(parcelRowOf);
    if (!rows.length) return;
    setForm(f => {
      // ทับแถวเปล่าที่ยังไม่ได้กรอก ไม่ใช่ต่อท้ายให้มีแถวว่างค้าง
      const kept = f.items.filter(it => it.clothingName || it.clothingId);
      const seen = new Set(kept.map(parcelLineKey));
      const add = rows.filter(r => !seen.has(parcelLineKey(r)));
      const next = [...kept, ...add];
      return { ...f, items: next.length ? next : f.items };
    });
  };

  // ผูกบรรทัดหนึ่งเข้ากับบิล พร้อมดึงราคาของบิลนั้นมาให้
  const assignBill = (i, inv) => {
    if (!inv) { setItem(i, { invoiceId: "", invoiceNo: "" }); return; }
    const p = priceInInvoice(inv, form.items[i]);
    setItem(i, { invoiceId: inv.id, invoiceNo: inv.invoiceNo || "", ...(p != null ? { unitPrice: p } : {}) });
  };

  // ใส่บิลที่เลือกอยู่ให้ทุกแถว — ทางลัดของเคสปกติที่ทั้งใบมาจากบิลเดียว
  const assignBillToAll = (inv) => {
    if (!inv) return;
    setForm(f => ({
      ...f,
      items: f.items.map(it => {
        const p = priceInInvoice(inv, it);
        return { ...it, invoiceId: inv.id, invoiceNo: inv.invoiceNo || "", ...(p != null ? { unitPrice: p } : {}) };
      }),
    }));
  };

  // 🔎 บิลที่น่าจะใช่ — คิดใหม่ทุกครั้งที่ข้อมูลผู้ส่งหรือรายการสินค้าเปลี่ยน
  const suggestions = React.useMemo(
    () => suggestInvoices(allInvoices, { ...form, items: validItems }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allInvoices, form.customerName, form.customerPhone, JSON.stringify(validItems.map(lineKey))]
  );

  const manualHits = React.useMemo(() => {
    const q = norm(invSearch);
    if (!q) return [];
    return allInvoices
      .filter(inv => !inv.mergedInto && !inv.convertedTo)
      .filter(inv => matchesTokens(
        [inv.invoiceNo, inv.customerName, inv.customerPhone, invoiceItemsText(inv)].join(" "), q))
      .slice(0, 10);
  }, [allInvoices, invSearch]);

  // เลือกลูกค้าจากรายการ → เติมชื่อ+เบอร์ให้ (คะแนนจับคู่บิลจะแม่นขึ้นทันที)
  const pickCustomer = (id) => {
    const c = customers.find(x => x.id === id);
    patch(c ? { customerId: c.id, customerName: c.name || "", customerPhone: c.phone || "" } : { customerId: "" });
  };

  // เลือกบิลที่ "กำลังทำอยู่" → ดึงราคาต่อหน่วยของบิลใบนั้นมาใส่ให้ ไม่ใช่ราคาป้ายวันนี้
  //
  // แตะเฉพาะแถวที่ยังไม่ได้ผูกบิล — แถวที่ผูกบิลอื่นไว้แล้วห้ามโดนเปลี่ยนราคาตาม
  // ไม่งั้นพอเลือกบิลใบที่สองเพื่อกรอกของอีกกอง ราคาของกองแรกจะเพี้ยนไปทั้งแถบ
  const pickInvoice = (inv) => {
    if (!inv) { patch({ invoiceId: "", invoiceNo: "" }); return; }
    const keyOf = invoiceLineResolver(inv);
    const priceOf = new Map();
    (inv.items || []).forEach(it => { if (!priceOf.has(lineKey(it))) priceOf.set(lineKey(it), Number(it.unitPrice) || 0); });
    setForm(f => ({
      ...f,
      invoiceId: inv.id, invoiceNo: inv.invoiceNo || "",
      customerId: f.customerId || inv.customerId || "",
      customerName: f.customerName || inv.customerName || "",
      customerPhone: f.customerPhone || inv.customerPhone || "",
      items: f.items.map(it => {
        if (it.invoiceId) return it;
        const p = priceOf.get(keyOf(it));
        const stamped = { ...it, invoiceId: inv.id, invoiceNo: inv.invoiceNo || "" };
        return p != null ? { ...stamped, unitPrice: p } : stamped;
      }),
    }));
  };

  // ติ๊กบรรทัดจากบิลโดยตรง — เร็วกว่าพิมพ์เองมาก เมื่อรู้บิลแล้ว
  const addFromInvoiceLine = (it) => {
    setForm(f => {
      const k = lineKey(it);
      // เทียบด้วย "บรรทัด + บิล" — รุ่นสีไซส์เดียวกันมาจากคนละบิลได้ ต้องแยกแถวกัน
      const idx = f.items.findIndex(x => lineKey(x) === k && (x.invoiceId || "") === (pickedInvoice?.id || ""));
      const line = {
        clothingId: it.clothingId || "", clothingName: it.clothingName || it.description || "",
        colorIdx: it.colorIdx ?? null, colorName: it.colorName || "", size: it.size || "",
        qty: 1, unitPrice: Number(it.unitPrice) || 0, condition: RETURN_CONDITIONS[0].id,
        invoiceId: pickedInvoice?.id || "", invoiceNo: pickedInvoice?.invoiceNo || "",
      };
      // กดเพิ่มทีละ 1 แต่ห้ามเกินที่ขายไป (นับใบรับคืนใบอื่นของบิลนี้ด้วย)
      const cap = billQuota.get(k)?.left ?? Infinity;
      if (cap <= 0) return f;   // โควตาหมดแล้ว อย่าเพิ่มแถวจำนวน 0 ทิ้งไว้ให้งง
      if (idx >= 0) return { ...f, items: f.items.map((x, j) => j === idx ? { ...x, qty: Math.min(cap, Number(x.qty || 0) + 1) } : x) };
      line.qty = 1;
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
    // จับคู่ = ทุกแถวต้องรู้ว่ามาจากบิลไหน (คนละบิลกันได้ แต่ต้องรู้ทุกแถว)
    if (matchNow && check.hasNoBill) {
      const NL = String.fromCharCode(10);
      alert(
        "ยังมีรายการที่ไม่ได้ระบุบิลต้นทาง — จับคู่ไม่ได้" + NL + NL +
        form.items.map((it, i) => check.rows[i]?.noBill
          ? `• ${it.clothingName || "(ไม่ระบุรุ่น)"} ${it.colorName || ""} ${it.size || ""}`
          : null).filter(Boolean).join(NL) + NL + NL +
        "เลือกบิลข้างล่างแล้วกด “ใส่บิล…” ใต้แถวนั้น หรือกดบันทึกไว้ก่อนเป็น “รอจับคู่บิล”"
      );
      return;
    }
    // 🔒 คืนเกินที่ขายไป = ลดหนี้เกินจริง ต้องหยุดไว้ ไม่ใช่เตือนแล้วปล่อยผ่าน
    if (matchNow && check.hasOver) {
      const NL = String.fromCharCode(10);
      alert(
        "คืนเกินจำนวนที่ขายไปในบิลนี้ — บันทึกไม่ได้" + NL + NL +
        form.items.map((it, i) => {
          const r = check.rows[i];
          if (!r?.over) return null;
          return `• ${it.clothingName || "(ไม่ระบุรุ่น)"} ${it.colorName || ""} ${it.size || ""} (บิล ${r.invoiceNo || "-"}): กรอก ${r.qty} · ขายไป ${r.sold}` +
                 (r.returned > 0 ? ` · คืนแล้ว ${r.returned}` : "") + ` · คืนได้อีก ${r.left}`;
        }).filter(Boolean).join(NL) + NL + NL +
        "ถ้าของชิ้นนี้จริง ๆ มาจากบิลใบอื่น ให้กด “ใส่บิล…” ใต้แถวนั้นเปลี่ยนเป็นบิลที่ถูก"
      );
      return;
    }
    // ⚠️ บรรทัดที่ไม่มีในบิลที่ผูกไว้ แต่มีราคาติดมาด้วย
    //
    // สิ้นเดือนใบวางบิลหักของคืนด้วยยอดเงินรวมระดับลูกค้า ไม่ได้ไล่ดูรายบรรทัด
    // เงินก้อนนี้จะถูกหักออกจากที่ลูกค้าต้องจ่าย ทั้งที่ของไม่เคยอยู่ในบิลใบไหน
    // = ลดหนี้ให้ของที่ยังไม่เคยเก็บเงิน · ต้องให้คนตัดสินตรงนี้ ตอนที่ของยังอยู่ตรงหน้า
    let offBillLines = [];
    if (matchNow && check.offBillTotal > 0) {
      const NL = String.fromCharCode(10);
      offBillLines = check.offBillIdx.map(i => {
        const it = form.items[i];
        return {
          clothingName: it.clothingName || "", colorName: it.colorName || "", size: it.size || "",
          qty: Number(it.qty) || 0, unitPrice: Number(it.unitPrice) || 0, invoiceNo: it.invoiceNo || "",
        };
      });
      const ok = window.confirm(
        `มี ${offBillLines.length} รายการที่ไม่มีอยู่ในบิลที่ผูกไว้` + NL + NL +
        offBillLines.map(l =>
          `• ${l.clothingName || "(ไม่ระบุรุ่น)"} ${l.colorName} ${l.size} × ${l.qty} = ฿${money(l.qty * l.unitPrice)}` +
          (l.invoiceNo ? ` (ผูกกับบิล ${l.invoiceNo})` : "")
        ).join(NL) + NL + NL +
        `รวม ฿${money(check.offBillTotal)} — ยอดนี้จะถูกหักออกจากใบวางบิลสิ้นเดือน` + NL +
        `ทั้งที่ของพวกนี้ไม่ได้อยู่ในบิลที่ผูกไว้` + NL + NL +
        `ถ้าของมาจากบิลใบอื่น → กดยกเลิก แล้วกด "ใส่บิล…" ใต้แถวนั้นเปลี่ยนเป็นบิลที่ถูก` + NL +
        `ถ้าชื่อในบิลเขียนไม่เหมือนกัน → กดยกเลิก แล้วติ๊กบรรทัดจากบิลแทนการพิมพ์เอง` + NL +
        `ถ้าลูกค้าคืนของที่ยังไม่เคยออกบิล → ตั้งราคาเป็น 0 (บันทึกว่ารับของไว้ แต่ไม่ลดหนี้)` + NL + NL +
        `ยืนยันหักเงินก้อนนี้ให้ลูกค้า?`
      );
      if (!ok) return;
    }
    setBusy(true);
    try {
      await onSave({
        ...form,
        items: validItems.map(i => ({ ...i, qty: Number(i.qty) || 0, unitPrice: Number(i.unitPrice) || 0, restock: conditionRestocks(i.condition) })),
        status: matchNow ? "จับคู่แล้ว" : "รอจับคู่บิล",
        creditQty: calc.qty,
        creditTotal: matchNow ? calc.total : 0,   // ยังไม่จับคู่ = ยังไม่รู้ราคาจริง ยังลดหนี้ไม่ได้
        // ปั๊มไว้บนใบ ให้คนออกใบวางบิลสิ้นเดือนเห็นว่ายอดนี้มีส่วนที่ไม่มีในบิลปนอยู่เท่าไร
        offBillTotal: matchNow ? Math.round(check.offBillTotal * 100) / 100 : 0,
        offBillLines,
        restockQty: calc.restockQty,
        // 🧾 บิลอยู่ที่รายบรรทัดแล้ว — ช่องหัวเอกสารเก็บ "ใบแรก" ไว้เพื่อไม่ให้ของเดิมพัง
        //    (ลิงก์ในรายการ / ใบลดหนี้ / บันทึกตรวจสอบ ยังอ่านช่องนี้อยู่)
        //    เคสปกติทั้งใบมาจากบิลเดียว ค่าที่ได้จึงเท่าของเดิมเป๊ะ
        invoiceId: matchNow ? (billsInForm[0]?.id || "") : "",
        invoiceNo: matchNow ? (billsInForm[0]?.no || "") : "",
        invoiceIds: matchNow ? billsInForm.map(b => b.id) : [],
        invoiceNos: matchNow ? billsInForm.map(b => b.no).filter(Boolean) : [],
        multiBill: matchNow && billsInForm.length > 1,
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

      {/* 📦 ตามจากเลขพัสดุ — วางไว้บนสุดของส่วนจับคู่บิล เพราะเป็นทางที่แน่นอนที่สุด
          ต้องลองทางนี้ก่อนค่อยไปเดา ไม่ใช่เดาก่อนแล้วค่อยนึกได้ */}
      <div style={{ padding: "10px 12px", marginBottom: 10, borderRadius: 9,
        border: parcel ? "1px solid rgba(16,185,129,0.45)" : `1px solid ${T.border}`,
        background: parcel ? "rgba(16,185,129,0.06)" : "rgba(59,91,139,0.04)" }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, color: T.text, marginBottom: 6 }}>
          📦 มีเลขพัสดุบนกล่องไหม? — ตามได้เลยว่ามาจากบิลไหน
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <input
            value={trackInput}
            onChange={e => setTrackInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); lastLookup.current = trackInput.trim(); lookupParcel(trackInput); } }}
            placeholder="พิมพ์หรือสแกนเลขพัสดุ เช่น JTTH204465059304 / TH265269379394C"
            style={{ ...inputStyle, flex: "1 1 260px" }}/>
          <button type="button" onClick={() => { lastLookup.current = trackInput.trim(); lookupParcel(trackInput); }}
            disabled={parcelBusy || trackInput.trim().length < 8}
            style={{ padding: "8px 14px", borderRadius: 8, cursor: parcelBusy ? "wait" : "pointer",
              border: `1px solid ${T.border}`, background: "white", color: T.text,
              fontFamily: "'Sarabun',sans-serif", fontSize: 12, fontWeight: 700,
              opacity: trackInput.trim().length < 8 ? 0.5 : 1 }}>
            {parcelBusy ? "⏳ กำลังค้น…" : "🔍 ค้น"}
          </button>
        </div>
        {parcelMsg && <div style={{ fontSize: 11, color: "#b45309", marginTop: 6, lineHeight: 1.6 }}>⚠️ {parcelMsg}</div>}
        {/* ต้องบอกล่วงหน้าว่าค้นได้แค่ไหน ไม่ใช่ให้คนพิมพ์เลขเก่าแล้วงงว่าทำไมไม่เจอ
            สมุดจดเริ่มบันทึกตอนลากใบปะหน้าเข้าระบบ ของที่ส่งไปก่อนหน้านั้นไม่มีอยู่ในสมุด */}
        {!parcel && !parcelMsg && !parcelBusy && (
          <div style={{ fontSize: 10.5, color: T.muted, marginTop: 6, lineHeight: 1.6 }}>
            ค้นได้เฉพาะกล่องที่ส่งออกจาก “รอบแพ็ค” และนำเข้าใบปะหน้า (PDF) ไว้แล้วเท่านั้น —
            ของที่ส่งก่อนเริ่มใช้ระบบนี้ หรือรอบที่นำเข้าด้วยการวางข้อความ จะไม่มีเลขพัสดุให้ค้น
          </div>
        )}
        {parcel && (
          <div style={{ marginTop: 8, fontSize: 11.5, color: T.text, lineHeight: 1.9 }}>
            <div>
              ✅ กล่องนี้มาจากรอบ <b style={{ fontFamily: "monospace" }}>{parcel.runNo}</b>
              {" · "}<b>{parcel.customerName}</b>
              {parcel.runDate ? ` · ${String(parcel.runDate).split(" ")[0]}` : ""}
              {parcel.orderNo ? ` · ออเดอร์ ${parcel.orderNo}` : ""}
            </div>
            {/* กดชิ้นไหน = เพิ่มชิ้นนั้นเข้ารายการคืน พร้อมบิลและราคาของบิลนั้น
                ไม่ต้องเลื่อนลงไปพิมพ์รุ่น/สี/ไซส์/ราคาเองทีละช่อง */}
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 4, alignItems: "center" }}>
              <span style={{ fontSize: 11, color: T.sub }}>ของในกล่อง — กดเพื่อเพิ่ม:</span>
              {(parcel.items || []).map((it, i) => {
                const added = form.items.some(x => parcelLineKey(x) === parcelLineKey(parcelRowOf(it)));
                return (
                  <button key={i} type="button" onClick={() => addParcelItems([it])} disabled={added}
                    title={added ? "เพิ่มไปแล้ว" : "กดเพื่อเพิ่มเข้ารายการคืน"}
                    style={{ padding: "3px 9px", borderRadius: 7, fontSize: 11, cursor: added ? "default" : "pointer",
                      fontFamily: "'Sarabun',sans-serif", color: T.text, opacity: added ? 0.5 : 1,
                      background: added ? "#eef2f6" : "rgba(16,185,129,0.1)",
                      border: "1px solid rgba(16,185,129,0.3)" }}>
                    {added ? "✓ " : "＋ "}{it.clothingName}{it.colorName ? ` · ${it.colorName}` : ""}{it.size ? ` · ${it.size}` : ""}
                    <b style={{ fontFamily: "monospace" }}> ×{it.qty}</b>
                  </button>
                );
              })}
              {(parcel.items || []).length > 1 && (
                <button type="button" onClick={() => addParcelItems(parcel.items)}
                  style={{ padding: "3px 10px", borderRadius: 7, fontSize: 11, cursor: "pointer", fontWeight: 700,
                    fontFamily: "'Sarabun',sans-serif", color: T.text,
                    background: "rgba(16,185,129,0.2)", border: "1px solid rgba(16,185,129,0.55)" }}>
                  ＋ เพิ่มทั้งกล่อง ({(parcel.items || []).length})
                </button>
              )}
            </div>
            {/* เลขบิลที่ตามได้ — ตัวเต็มอยู่ที่ป้ายบิลต้นทางข้างบนแล้ว ตรงนี้เหลือบรรทัดเดียวพอ
                ไม่งั้นมีกล่องเขียวซ้อนกันสองชั้นบอกเรื่องเดียวกัน */}
            <div style={{ marginTop: 6 }}>
              {parcelInvoice ? (
                <div style={{ fontSize: 12, color: T.text }}>
                  📄 กล่องนี้ผูกกับบิล{" "}
                  <b style={{ fontFamily: "monospace" }}>{parcelInvoice.invoiceNo || "(ไม่มีเลข)"}</b>
                  {form.invoiceId === parcelInvoice.id
                    ? <b style={{ color: "#059669" }}> · ใช้อยู่ ✅</b>
                    : (
                      <button type="button" onClick={() => pickInvoice(parcelInvoice)}
                        style={{ marginLeft: 8, padding: "3px 10px", borderRadius: 7, cursor: "pointer",
                          border: "1px solid rgba(16,185,129,0.6)", background: "rgba(16,185,129,0.15)",
                          color: T.text, fontFamily: "'Sarabun',sans-serif", fontSize: 11.5, fontWeight: 700 }}>
                        ใช้บิลนี้
                      </button>
                    )}
                </div>
              ) : (
                <div style={{ fontSize: 11.5, color: T.sub }}>
                  {!parcelRun
                    ? "⚠️ เปิดรอบของพัสดุใบนี้ไม่ได้ (รอบอาจถูกลบ) — ค้นบิลจากรายการด้านล่างแทน"
                    : "⏳ รอบนี้ยังไม่ได้ออกบิล — บันทึกไว้ก่อนเป็น “รอจับคู่บิล” แล้วค่อยกลับมาจับทีหลัง"}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── ผู้ส่งคืน ── */}
      <div style={{ fontSize: 11, color: T.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>ผู้ส่งคืน</div>
      {/* ช่องที่ต้องกรอกจริง ๆ เหลือเท่านี้ — ที่เหลือได้มาจากการค้นเลขพัสดุข้างบน
          ช่อง "เลขพัสดุ" เดิมตรงนี้ถูกตัดออก เพราะซ้ำกับช่องค้นข้างบน (กรอกที่เดียวพอ) */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 8 }}>
        <div>
          <label style={labelStyle}>ลูกค้า (ถ้ารู้)</label>
          <select value={form.customerId} onChange={e => pickCustomer(e.target.value)} style={inputStyle}>
            <option value="">— ยังไม่ทราบ / กรอกเอง —</option>
            {customers.map(c => <option key={c.id} value={c.id}>{c.name}{c.phone ? ` · ${c.phone}` : ""}</option>)}
          </select>
        </div>
        <div>
          <label style={labelStyle}>เหตุผลที่คืน</label>
          <select value={form.reason} onChange={e => patch({ reason: e.target.value })} style={inputStyle}>
            {RETURN_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={labelStyle}>หมายเหตุ</label>
          <input value={form.note} onChange={e => patch({ note: e.target.value })} placeholder="รายละเอียดเพิ่มเติม (ไม่ใส่ก็ได้)" style={inputStyle}/>
        </div>
      </div>

      {/* 📮 ชื่อ/เบอร์บนกล่อง — พับไว้ ใช้เฉพาะตอนไม่มีเลขพัสดุให้ค้น
          สองช่องนี้มีไว้ให้ตัวเดาบิททำงานเท่านั้น ถ้าค้นเลขพัสดุเจอแล้วไม่ต้องใช้เลย
          ของเดิมโผล่ตลอดเวลา พนักงานเลยนึกว่าต้องกรอกทุกครั้ง */}
      <div style={{ marginBottom: 10 }}>
        <button type="button" onClick={() => setShowBoxInfo(v => !v)}
          style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: T.accent,
            fontFamily: "'Sarabun',sans-serif", fontSize: 11.5 }}>
          {showBoxInfo ? "▾" : "▸"} ไม่มีเลขพัสดุ? กรอกชื่อ/เบอร์บนกล่องช่วยเดาบิลได้
          {!showBoxInfo && (form.customerName || form.customerPhone)
            ? ` · กรอกไว้แล้ว: ${[form.customerName, form.customerPhone].filter(Boolean).join(" · ")}` : ""}
        </button>
        {showBoxInfo && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 8 }}>
            <div>
              <label style={labelStyle}>ชื่อบนกล่อง</label>
              <input value={form.customerName} onChange={e => patch({ customerName: e.target.value, customerId: "" })} placeholder="ชื่อผู้ส่ง" style={inputStyle}/>
            </div>
            <div>
              <label style={labelStyle}>เบอร์บนกล่อง <span style={{ color: T.green }}>← เดาบิลได้แม่นกว่าชื่อ</span></label>
              <input value={form.customerPhone} onChange={e => patch({ customerPhone: e.target.value, customerId: "" })} placeholder="08x-xxx-xxxx" style={inputStyle}/>
            </div>
          </div>
        )}
      </div>

      {/* ── สินค้าที่คืนมา ── */}
      <div style={{ fontSize: 11, color: T.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", margin: "16px 0 8px" }}>สินค้าที่คืนมา</div>
      {form.items.map((it, i) => {
        const ci = clothingItems.find(c => c.id === it.clothingId);
        const colors = ci?.colors || [];
        return (
          <div key={i} style={{ marginBottom: 8 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 0.7fr 0.6fr 0.8fr 1fr 28px", gap: 6, alignItems: "end" }}>
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
                <div style={{ fontSize: 9, color: check.rows[i].amount > 0 ? "#dc2626" : "#b45309", fontWeight: check.rows[i].amount > 0 ? 700 : 400, marginTop: 2, lineHeight: 1.4 }}>
                  ⚠️ ไม่มีบรรทัดนี้ในบิล {check.rows[i].invoiceNo || ""}
                  {check.rows[i].amount > 0 && <> — จะหักเงิน ฿{money(check.rows[i].amount)} ที่ไม่ได้อยู่ในบิล</>}
                </div>
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

          {/* 🧾 บิลของ "แถวนี้" — ใบรับคืนใบเดียวมีของจากหลายบิลได้
              ของคืนกองรวมกันหลายวันกว่าจะได้เปิดดู ในกองมาจากคนละบิลกันเป็นเรื่องปกติ
              ต้องบอกทีละแถว ไม่งั้นหักเงินผิดใบและโควตาคืนเกินก็เช็คไม่ได้ */}
          {(it.clothingName || it.clothingId) && (
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginTop: 3, paddingLeft: 2 }}>
              {it.invoiceNo || it.invoiceId ? (
                <span style={{ fontSize: 10.5, padding: "2px 8px", borderRadius: 6, fontFamily: "monospace",
                  background: "rgba(16,185,129,0.12)", border: "1px solid rgba(16,185,129,0.35)", color: T.text }}>
                  🧾 {it.invoiceNo || "(ไม่มีเลข)"}
                </span>
              ) : (
                <span style={{ fontSize: 10.5, padding: "2px 8px", borderRadius: 6,
                  background: "rgba(245,158,11,0.14)", border: "1px solid rgba(245,158,11,0.45)", color: "#b45309", fontWeight: 700 }}>
                  ⚠️ ยังไม่ระบุบิล
                </span>
              )}
              {pickedInvoice && it.invoiceId !== pickedInvoice.id && (
                <button type="button" onClick={() => assignBill(i, pickedInvoice)}
                  style={{ padding: "2px 8px", borderRadius: 6, cursor: "pointer", fontSize: 10.5,
                    border: `1px solid ${T.border}`, background: "white", color: T.accent, fontFamily: "'Sarabun',sans-serif" }}>
                  ใส่บิล {pickedInvoice.invoiceNo}
                </button>
              )}
              {it.invoiceId && (
                <button type="button" onClick={() => assignBill(i, null)}
                  style={{ padding: "2px 8px", borderRadius: 6, cursor: "pointer", fontSize: 10.5,
                    border: "none", background: "none", color: T.muted, fontFamily: "'Sarabun',sans-serif" }}>
                  เอาบิลออก
                </button>
              )}
            </div>
          )}
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

      {/* 📄 ป้ายบอกว่าตอนนี้ผูกกับบิลใบไหน — ใช้ร่วมกันทุกทางที่เลือกบิล
          เดิมมีให้เห็นชัดเฉพาะทางเลขพัสดุ (ลูกค้าที่ขายออนไลน์) ส่วนลูกค้าปกติที่กดเลือกจากรายการ
          ต้องไปสังเกตเอาเองว่าแถวไหนมีเครื่องหมายถูก เลื่อนจอผ่านไปนิดเดียวก็ไม่รู้แล้วว่าเลือกไว้หรือยัง
          เรื่องเงินต้องเห็นตลอดเวลาว่ากำลังหักกับบิลใบไหน */}
      {pickedInvoice ? (
        <div style={{ padding: "9px 12px", marginBottom: 10, borderRadius: 9,
          background: "rgba(16,185,129,0.13)", border: "1px solid rgba(16,185,129,0.5)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
            <div style={{ fontSize: 13, color: T.text }}>
              📄 บิลที่กำลังกรอกอยู่{" "}
              <b style={{ fontFamily: "monospace", fontSize: 15 }}>{pickedInvoice.invoiceNo || "(ไม่มีเลข)"}</b>
              {parcelInvoice && parcelInvoice.id === pickedInvoice.id && (
                <span style={{ marginLeft: 7, padding: "2px 7px", borderRadius: 6, fontSize: 10,
                  background: "rgba(16,185,129,0.2)", color: "#047857", fontWeight: 700 }}>📦 ตามจากเลขพัสดุ</span>
              )}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {/* ทางลัดของเคสปกติ: ทั้งใบมาจากบิลเดียว กดทีเดียวจบ ไม่ต้องไล่ใส่ทีละแถว */}
              {form.items.some(it => (it.clothingName || it.clothingId) && it.invoiceId !== pickedInvoice.id) && (
                <button type="button" onClick={() => assignBillToAll(pickedInvoice)}
                  style={{ padding: "3px 10px", borderRadius: 7, cursor: "pointer",
                    border: "1px solid rgba(16,185,129,0.6)", background: "rgba(16,185,129,0.18)",
                    color: T.text, fontFamily: "'Sarabun',sans-serif", fontSize: 11, fontWeight: 700 }}>
                  ใส่บิลนี้ให้ทุกแถว
                </button>
              )}
              <button type="button" onClick={() => pickInvoice(null)}
                style={{ padding: "3px 10px", borderRadius: 7, cursor: "pointer", border: `1px solid ${T.border}`,
                  background: "white", color: T.sub, fontFamily: "'Sarabun',sans-serif", fontSize: 11 }}>
                เลือกบิลอื่น
              </button>
            </div>
          </div>
          <div style={{ fontSize: 11.5, color: T.sub, marginTop: 2, fontFamily: "monospace" }}>
            {pickedInvoice.customerName || "-"} · {pickedInvoice.date || "-"} · ฿{money(pickedInvoice.total)}
          </div>
          {/* บิลที่แยกใบ (เสื้อผ้า/อุปกรณ์กีฬา) — ของที่คืนอาจอยู่อีกใบ ต้องเตือนไม่ให้หักผิดใบ */}
          {pickedInvoice.splitSiblingNo && (
            <div style={{ fontSize: 11, color: "#b45309", marginTop: 4, lineHeight: 1.6 }}>
              ⚠️ บิลนี้แยกเป็น 2 ใบ — ถ้าของที่คืนไม่อยู่ในใบนี้ ให้เลือก{" "}
              <b style={{ fontFamily: "monospace" }}>{pickedInvoice.splitSiblingNo}</b> แทน
            </div>
          )}
        </div>
      ) : (
        <div style={{ padding: "9px 12px", marginBottom: 10, borderRadius: 9,
          background: "rgba(245,158,11,0.09)", border: "1px solid rgba(245,158,11,0.4)",
          fontSize: 12, color: T.text, lineHeight: 1.7 }}>
          ⚠️ <b>ยังไม่ได้เลือกบิล</b> — เลือกจากรายการข้างล่าง หรือค้นด้วยเลขพัสดุบนกล่อง
          <div style={{ fontSize: 11, color: T.sub }}>
            บันทึกไว้ก่อนได้ (จะขึ้นเป็น “รอจับคู่บิล”) แต่จะยังไม่ถูกหักในใบวางบิลจนกว่าจะจับคู่บิล
          </div>
        </div>
      )}

      {/* 🧾 สรุปว่าใบรับคืนใบนี้อ้างบิลอะไรบ้าง — ของคืนกองหลายวันมาจากคนละบิลได้
          ต้องเห็นภาพรวมก่อนกดบันทึก ไม่ใช่ไปไล่อ่านทีละแถว */}
      {(billsInForm.length > 1 || check.hasNoBill) && (
        <div style={{ padding: "8px 11px", marginBottom: 10, borderRadius: 9,
          border: `1px solid ${T.border}`, background: "rgba(59,91,139,0.04)" }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: T.text, marginBottom: 4 }}>
            🧾 ใบนี้หักจาก {billsInForm.length} บิล
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {billsInForm.map(b => (
              <button key={b.id} type="button" onClick={() => { const inv = invoiceOf(b.id); if (inv) pickInvoice(inv); }}
                title="กดเพื่อสลับไปกรอกของบิลนี้"
                style={{ padding: "3px 9px", borderRadius: 7, cursor: "pointer", fontSize: 11,
                  fontFamily: "'Sarabun',sans-serif", color: T.text,
                  border: b.id === form.invoiceId ? `2px solid ${T.accent}` : `1px solid ${T.border}`,
                  background: "white" }}>
                <b style={{ fontFamily: "monospace" }}>{b.no || "(ไม่มีเลข)"}</b> · {b.qty} ชิ้น · ฿{money(b.total)}
              </button>
            ))}
          </div>
          {check.hasNoBill && (
            <div style={{ fontSize: 11, color: "#b45309", marginTop: 5, lineHeight: 1.6 }}>
              ⚠️ ยังมีแถวที่ไม่ได้ระบุบิล — เลือกบิลแล้วกด “ใส่บิล…” ที่ใต้แถวนั้น
              ถ้ายังหาไม่เจอ บันทึกไว้ก่อนเป็น “รอจับคู่บิล” ได้
            </div>
          )}
        </div>
      )}

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


      {form.customerId && (
        <div style={{ fontSize: 10.5, color: custInvBusy ? T.accent : T.muted, marginBottom: 6 }}>
          {custInvBusy
            ? "⏳ กำลังดึงบิลเก่าทั้งหมดของลูกค้ารายนี้…"
            : custInvoices.length
              ? `📥 ดึงบิลของลูกค้ารายนี้มาแล้ว ${custInvoices.length} ใบ (ย้อนได้ไม่จำกัด ไม่ติดช่วง 30 วัน)`
              : "ไม่พบบิลที่ผูกกับลูกค้ารายนี้ — ค้นจากบิลที่โหลดไว้แทน"}
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
            {(pickedInvoice.items || []).map((it, i) => {
              // เหลือคืนได้ = ขายไป − คืนไปแล้ว − ที่กรอกค้างอยู่ในฟอร์มตอนนี้
              const k = lineKey(it);
              // นับเฉพาะแถวที่ผูกกับบิลนี้ — แถวของบิลอื่นไม่กินโควตาบิลนี้
              const inForm = form.items
                .filter(x => lineKey(x) === k && x.invoiceId === pickedInvoice.id)
                .reduce((a, x) => a + (Number(x.qty) || 0), 0);
              const left = Math.max(0, (billQuota.get(k)?.left ?? 0) - inForm);
              const done = left <= 0;
              return (
                <button key={i} onClick={() => { if (!done) addFromInvoiceLine(it); }} disabled={done}
                  title={done ? "คืนครบจำนวนที่ขายไปแล้ว" : `เหลือคืนได้อีก ${left}`}
                  style={{ padding: "4px 9px", borderRadius: 7, border: `1px solid ${T.border}`,
                    background: done ? "#f1f3f6" : "white", cursor: done ? "default" : "pointer",
                    opacity: done ? 0.55 : 1, fontSize: 11, fontFamily: "'Sarabun',sans-serif", color: T.text }}>
                  {it.clothingName || it.description} {it.colorName ? `· ${it.colorName}` : ""} {it.size ? `· ${it.size}` : ""}{" "}
                  <span style={{ color: done ? T.muted : T.green, fontWeight: 700 }}>
                    {done ? "คืนครบแล้ว" : `เหลือ ${left}`}
                  </span>
                </button>
              );
            })}
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
