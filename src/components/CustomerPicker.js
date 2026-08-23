// 👤 ช่องเลือกลูกค้า — ใช้ร่วมกันทุกที่ที่เอกสารต้องมีลูกค้า
//    (บิล · ใบสั่งของ · ใบสั่งผลิต custom)
//
// ทำไมต้องเป็นตัวเดียวกัน: เดิมแต่ละหน้ามีช่องค้นลูกค้าของตัวเอง ก็อปกันไปคนละเวอร์ชัน
// บางหน้าเตือนชื่อใกล้เคียง บางหน้าไม่เตือน บางหน้าเขียนว่า "จะสร้างใหม่อัตโนมัติ"
// ทั้งที่ไม่ได้สร้างอะไรเลย ปิดรูหน้าหนึ่งแล้วอีกหน้ายังรั่วอยู่
// (โปรเจกต์นี้เคยเจอมาแล้วกับตัวคัดบิลเข้าใบวางบิลที่มี 2 เวอร์ชันไม่ตรงกัน)
//
// 🔒 เอกสารต้องผูก customerId เสมอ ห้ามพิมพ์ชื่อลอย ๆ แล้วบันทึก
//    เดือน ส.ค. 2026 เดือนเดียวมีบิลไม่ผูกทะเบียน 51 ใบ ผลคือตอนวางบิล
//    ร้านเดียวถูกแยกเป็น 2 ใบเพราะพิมพ์ชื่อคนละแบบ และไม่มีที่อยู่ให้พิมพ์ลงใบวางบิล
//
// ⚠️ ปุ่ม "＋ เพิ่มเข้าทะเบียน" จงใจไม่ผูกกับสิทธิ์ canAdd — ห้ามใส่เงื่อนไขสิทธิ์ทีหลัง
//    สิทธิ์ตั้งทับรายคนได้ (users/{id}.permissions) ตอนนี้ staff ก็ออกบิลได้
//    ถ้าคนออกบิลได้แต่เพิ่มลูกค้าไม่ได้ จะบันทึกไม่ได้เลยเมื่อเจอลูกค้าใหม่ = ติดตายกลางกะ
import React from "react";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase";
import { T } from "../theme";
import { matchTokens } from "../utils/search";
import { custKey } from "../utils/statement";
import { withCustomerSearchKeys } from "../utils/searchKeys";

export default function CustomerPicker({
  customers = [],
  value = {},                 // { customerId, customerName, customerPhone, customerAddress, customerTaxId }
  onChange,                   // (patch) => void — merge เข้าฟอร์มของหน้านั้น
  label = "ชื่อลูกค้า *",
  showContactFields = false,  // true = โชว์ช่องเบอร์/ที่อยู่/เลขภาษีในตัวเอง (ฝั่งบิลใช้)
}) {
  const [q, setQ] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [adding, setAdding] = React.useState(false);
  const boxRef = React.useRef(null);
  const linked = !!value.customerId;
  const name = value.customerName || "";

  // ปิดรายการเมื่อคลิกที่อื่น — ไม่ใช้ onBlur เพราะมันปิดก่อนที่คลิกจะโดนรายการ
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const pick = (c) => {
    // เบอร์/ที่อยู่/เลขภาษี ทับด้วยของในทะเบียนเฉพาะที่มีค่า — ที่พิมพ์ไว้แล้วจะไม่ถูกล้างทิ้ง
    onChange({
      customerId: c.id || "",
      customerName: c.name || "",
      customerPhone: c.phone || value.customerPhone || "",
      customerAddress: c.address || value.customerAddress || "",
      customerTaxId: c.taxId || value.customerTaxId || "",
    });
    setQ(""); setOpen(false);
  };

  const typed = (v) => {
    // พิมพ์เอง = หลุดจากทะเบียนแล้ว ต้องล้าง customerId
    // ไม่งั้นเอกสารจะผูกกับรหัสลูกค้าคนหนึ่งแต่โชว์ชื่ออีกคน
    setQ(v);
    onChange({ customerId: "", customerName: v });
    setOpen(true);
  };

  const term = q || (linked ? "" : name);
  const matches = React.useMemo(() => {
    const t = String(term).trim();
    if (!t) return customers.slice(0, 30);
    return customers.filter(c => matchTokens(t, c.name, c.phone, c.address, c.taxId));
  }, [term, customers]);

  // ชื่อที่พิมพ์ตรงกับรายในทะเบียนเป๊ะ ๆ (ไม่สนวรรค/วรรณยุกต์) → ห้ามเสนอให้สร้างใหม่
  const exactMatch = React.useMemo(() => {
    const k = custKey(name);
    return !!k && matches.some(c => custKey(c.name) === k);
  }, [name, matches]);

  // 🔎 พิมพ์เองแล้วชื่อดัน "ใกล้เคียง" กับที่มีในทะเบียน
  //    เคสนี้แหละที่ทำให้เอกสารกระจายคนละชื่อจนแยกใบตอนวางบิล — ต้องทักตั้งแต่ตอนกรอก
  const nearby = React.useMemo(() => {
    if (linked) return [];
    const k = custKey(name);
    if (k.length < 3) return [];
    return customers.filter(c => {
      const ck = custKey(c.name);
      return ck && (ck.includes(k) || k.includes(ck));
    }).slice(0, 3);
  }, [linked, name, customers]);

  // สร้างลูกค้าใหม่จากชื่อที่พิมพ์ + ข้อมูลติดต่อที่กรอกไว้แล้ว แล้วผูกทันที
  // เตือนก่อนถ้าชื่อใกล้เคียงของเดิม — ปล่อยให้สร้างซ้ำง่าย ๆ ทะเบียนจะรกจนวางบิลแยกใบอีก
  const addToRegistry = async () => {
    const nm = (name || "").trim();
    if (!nm || adding) return;
    const NL = String.fromCharCode(10);
    if (nearby.length > 0 && !window.confirm(
      `มีลูกค้าชื่อใกล้เคียงอยู่แล้ว:${NL}` +
      nearby.map(c => `• ${c.name}`).join(NL) +
      `${NL}${NL}ถ้าเป็นร้านเดียวกัน ให้กดปุ่ม 🔗 ด้านล่างเพื่อผูกกับรายเดิมแทน${NL}` +
      `จะสร้าง "${nm}" เป็นลูกค้ารายใหม่จริงไหม?`
    )) return;
    setAdding(true);
    try {
      const ref = await addDoc(collection(db, "customers"), withCustomerSearchKeys({
        name: nm,
        phone: value.customerPhone || "",
        address: value.customerAddress || "",
        taxId: value.customerTaxId || "",
        createdAt: serverTimestamp(),
      }));
      onChange({ customerId: ref.id, customerName: nm });
      setQ(""); setOpen(false);
    } catch (e) {
      alert("เพิ่มลูกค้าไม่สำเร็จ: " + (e?.message || e));
    }
    setAdding(false);
  };

  const inputStyle = { width: "100%", boxSizing: "border-box", background: T.input, border: `1px solid ${T.inputBorder}`,
    color: T.text, borderRadius: 9, padding: "8px 12px", fontFamily: "'Sarabun',sans-serif", fontSize: 13, outline: "none" };
  const lbl = { fontSize: 11, color: T.muted, display: "block", marginBottom: 4, fontWeight: 600 };

  return (
    <div style={{ marginBottom: 16 }}>
      <div ref={boxRef} style={{ position: "relative", marginBottom: 10 }}>
        {label && <label style={lbl}>{label}</label>}
        {linked ? (
          {/* ⚠️ ห้ามใช้ ✓ (U+2713) ตรงนี้ — ฟอนต์ Sarabun ไม่มีอักขระนี้ Windows จะดึง
              Segoe UI Emoji มาแทน กลายเป็นกล่องฟ้าหน้าตาเหมือน checkbox ที่กดได้
              ทั้งที่เป็นข้อความเฉย ๆ วางข้างช่องกรอกฟอร์มยิ่งชวนให้เข้าใจผิด
              ใช้ป้ายข้อความแทน อ่านออกแน่นอนทุกเครื่อง */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, background: "rgba(52,211,153,0.10)",
            border: "1px solid #34d399", borderRadius: 9, padding: "8px 12px" }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: "white", background: T.green, borderRadius: 5,
              padding: "2px 7px", whiteSpace: "nowrap", flexShrink: 0 }}>ผูกแล้ว</span>
            <span style={{ fontSize: 13, color: T.text, fontWeight: 600, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {name}
            </span>
            <button type="button" onClick={() => { setQ(""); onChange({ customerId: "" }); setOpen(true); }}
              style={{ background: "none", border: `1px solid ${T.border}`, color: T.sub, borderRadius: 7, padding: "3px 10px",
                cursor: "pointer", fontSize: 11, fontFamily: "inherit", whiteSpace: "nowrap" }}>
              เปลี่ยน
            </button>
          </div>
        ) : (
          <input value={name} onChange={e => typed(e.target.value)} onFocus={() => setOpen(true)}
            placeholder="🔍 ค้นหาลูกค้าเดิม หรือพิมพ์ชื่อใหม่..." style={inputStyle}/>
        )}

        {open && !linked && (
          <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#ffffff",
            border: `1px solid ${T.border}`, borderRadius: 10, zIndex: 60, maxHeight: 280, overflowY: "auto",
            boxShadow: "0 8px 24px rgba(0,0,0,0.25)", marginTop: 2 }}>
            {matches.length > 0 && (
              <div style={{ padding: "6px 14px", background: "#eff6ff", fontSize: 10, color: T.blue, fontWeight: 700,
                borderBottom: `1px solid ${T.border}`, position: "sticky", top: 0 }}>
                เจอ {matches.length} ราย {matches.length > 30 && "(แสดง 30 รายแรก — พิมพ์เพิ่มเพื่อกรอง)"}
              </div>
            )}
            {matches.slice(0, 30).map(c => (
              <div key={c.id} onClick={() => pick(c)}
                style={{ padding: "10px 14px", cursor: "pointer", borderBottom: `1px solid ${T.border}` }}
                onMouseEnter={e => e.currentTarget.style.background = "rgba(59,91,139,0.1)"}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{c.name}</div>
                <div style={{ fontSize: 11, color: T.muted }}>📞 {c.phone || "-"} · 📍 {c.address || "-"}</div>
              </div>
            ))}
            {/* ทางออกสำหรับลูกค้าใหม่ — ต้องอยู่ตรงนี้ ไม่งั้นพนักงานติดตายตอนลูกค้ายืนรอ
                แต่ต้องไม่เด่นกว่ารายชื่อที่มีอยู่แล้ว ไม่งั้นกลายเป็นเชิญให้สร้างซ้ำ
                ซึ่งเป็นต้นเหตุของปัญหาที่กำลังแก้อยู่พอดี (ทะเบียนรก → วางบิลแยกใบ)
                · ชื่อตรงกับที่มีอยู่แล้ว = ไม่ต้องมีปุ่มเลย ให้กดรายชื่อข้างบน
                · มีชื่อคล้าย ๆ = มีปุ่มแต่ทำให้จืด ต้องตั้งใจกดถึงจะโดน
                · ไม่เจออะไรเลย = ปุ่มเด่นได้ เพราะเป็นทางเดียวที่เหลือ */}
            {name.trim() && !exactMatch && (
              <div style={{ padding: "10px 14px", borderTop: matches.length ? `1px solid ${T.border}` : "none", background: "#f8fafc" }}>
                {matches.length === 0
                  ? <div style={{ fontSize: 12, color: T.muted, marginBottom: 8 }}>ไม่พบ "{name}" ในทะเบียน</div>
                  : <div style={{ fontSize: 11, color: T.muted, marginBottom: 8 }}>ถ้าไม่ใช่รายข้างบน ถึงค่อยเพิ่มใหม่</div>}
                <button type="button" disabled={adding} onClick={addToRegistry}
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 8,
                    border: matches.length ? `1px solid ${T.border}` : "none",
                    background: adding ? "#94a3b8" : matches.length ? "white" : T.green,
                    color: adding ? "white" : matches.length ? T.sub : "white",
                    cursor: adding ? "wait" : "pointer", fontSize: 12, fontWeight: matches.length ? 500 : 700, fontFamily: "inherit" }}>
                  {adding ? "กำลังเพิ่ม…" : `＋ เพิ่ม "${name}" เป็นลูกค้ารายใหม่`}
                </button>
              </div>
            )}
            {name.trim() && exactMatch && (
              <div style={{ padding: "8px 14px", borderTop: `1px solid ${T.border}`, background: "#f0fdf4", fontSize: 11, color: T.green, fontWeight: 600 }}>
                ✓ ชื่อนี้มีในทะเบียนแล้ว — กดที่รายชื่อด้านบนเพื่อผูก
              </div>
            )}
          </div>
        )}
      </div>

      {!linked && name.trim() && nearby.length === 0 && (
        <div style={{ marginBottom: 10, padding: "8px 12px", background: "rgba(185,74,72,0.08)",
          border: "1px solid rgba(185,74,72,0.35)", borderRadius: 9, fontSize: 11, color: T.red, lineHeight: 1.7 }}>
          🔒 ยังไม่ได้ผูกกับทะเบียนลูกค้า — บันทึกไม่ได้<br/>
          เลือกจากรายการด้านบน หรือกด "＋ เพิ่มเข้าทะเบียนลูกค้า" ถ้าเป็นลูกค้าใหม่
        </div>
      )}

      {nearby.length > 0 && (
        <div style={{ marginBottom: 10, padding: "8px 12px", background: "rgba(184,134,0,0.08)",
          border: "1px solid rgba(184,134,0,0.35)", borderRadius: 9 }}>
          <div style={{ fontSize: 11, color: T.amber, fontWeight: 700, marginBottom: 6 }}>
            ⚠️ ชื่อนี้ใกล้เคียงกับลูกค้าในทะเบียน — ถ้าเป็นคนเดียวกันให้กดผูก ไม่งั้นเอกสารจะแยกกันตอนวางบิล
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {nearby.map(c => (
              <button key={c.id} type="button" onClick={() => pick(c)}
                style={{ background: "#ffffff", border: `1px solid ${T.amber}`, color: T.text, borderRadius: 7,
                  padding: "5px 12px", cursor: "pointer", fontSize: 12, fontFamily: "inherit" }}>
                🔗 {c.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {showContactFields && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {[
            { k: "customerPhone", l: "เบอร์โทร", ph: "0812345678" },
            { k: "customerTaxId", l: "เลขผู้เสียภาษี", ph: "(ถ้ามี)" },
            { k: "customerAddress", l: "ที่อยู่", ph: "บ้านเลขที่ ซอย ถนน...", full: true },
          ].map(f => (
            <div key={f.k} style={f.full ? { gridColumn: "1/-1" } : undefined}>
              <label style={lbl}>{f.l}</label>
              <input value={value[f.k] || ""} onChange={e => onChange({ [f.k]: e.target.value })}
                placeholder={f.ph} style={inputStyle}/>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
