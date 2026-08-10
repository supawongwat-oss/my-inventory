import { useEffect, useRef, useState } from "react";
import JsBarcode from "jsbarcode";
import { T } from "../theme";

// 📊 BarcodeDisplay — สร้างบาร์โค้ดจริง (Code 128) ด้วย jsbarcode → สแกนได้จริง
// ค่า default ปรับเพื่อให้สแกนติดบนสติกเกอร์ thermal:
//   - width=2.2 (bar หนาขึ้น), height=60 (สูง → scan ง่าย),
//   - margin=12 (quiet zone กว้างพอตามมาตรฐาน Code 128),
//   - lineColor=#000 (ดำสนิทเพื่อ contrast สูงสุด)
export function BarcodeDisplay({ value, format = "CODE128", width = 2.2, height = 60, fontSize = 14, displayValue = true, margin = 12 }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!ref.current || !value) return;
    try {
      JsBarcode(ref.current, String(value), {
        format,
        width,
        height,
        displayValue,
        fontSize,
        fontOptions: "bold",
        font: "monospace",
        textMargin: 2,
        margin,
        background: "#ffffff",
        lineColor: "#000000",
      });
    } catch (e) {
      console.warn("[barcode] failed to render:", value, e);
    }
  }, [value, format, width, height, fontSize, displayValue, margin]);

  if (!value || String(value).trim() === "") return null;
  return (
    <div style={{ background: "white", borderRadius: 4, padding: "2px 4px", display: "inline-block", lineHeight: 0 }}>
      <svg ref={ref} />
    </div>
  );
}

export function Modal({ onClose, children, w = 460 }) {
  const cardRef = useRef(null);
  // 🛟 กันข้อมูลหาย — พอมีการพิมพ์/เลือกอะไรในกล่องนี้แล้ว ถ้าหน้าจะ reload/ปิด ให้เตือนก่อน
  //    (ด่านสองต่อจาก overscroll-behavior ใน index.css เผื่อ refresh มาจากทางอื่น
  //     เช่น ปัดปิดแท็บ, กดปุ่ม reload, หรือแท็บเล็ตรุ่นเก่าที่ยังไม่รองรับ overscroll-behavior)
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const mark = () => setDirty(true);
    el.addEventListener("input", mark);
    el.addEventListener("change", mark);
    return () => { el.removeEventListener("input", mark); el.removeEventListener("change", mark); };
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  return (
    <div
      style={{position:"fixed",inset:0,background:T.overlay,display:"flex",alignItems:"center",justifyContent:"center",zIndex:300,backdropFilter:"blur(4px)",padding:8}}
    >
      <div
        ref={cardRef}
        className="modal-card"
        style={{background:"#ffffff",border:`1px solid ${T.border}`,borderRadius:16,padding:28,width:w,maxWidth:"96vw",boxShadow:"0 20px 60px rgba(0,0,0,0.15)",maxHeight:"92vh",overflowY:"auto"}}
      >
        {children}
      </div>
    </div>
  );
}

export function MHead({ title, sub, onClose, color = T.blue }) {
  return (
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:20}}>
      <div>
        <div style={{fontSize:15,fontWeight:700,color}}>{title}</div>
        {sub && <div style={{fontSize:12,color:T.sub,marginTop:2}}>{sub}</div>}
      </div>
      <button onClick={onClose} style={{background:"none",border:`1px solid ${T.border}`,borderRadius:8,padding:"4px 10px",cursor:"pointer",color:T.sub,fontSize:13}}>✕</button>
    </div>
  );
}

export function Toast({ msg }) {
  return <div style={{background:"#dcfce7",border:"1px solid #86efac",borderRadius:8,padding:"10px 14px",marginBottom:14,color:"#166534",fontSize:13,textAlign:"center",fontWeight:500}}>✅ {msg}</div>;
}

export function Input({ label, value, onChange, type="text", placeholder="", disabled=false, style={} }) {
  return (
    <div style={{marginBottom:0}}>
      {label && <label style={{fontSize:11,color:T.sub,display:"block",marginBottom:5,fontWeight:500}}>{label}</label>}
      <input
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        disabled={disabled}
        style={{width:"100%",background:disabled?"#f8fafc":T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:8,padding:"9px 12px",fontFamily:"'Sarabun',sans-serif",fontSize:13,outline:"none",...style}}
      />
    </div>
  );
}

export function BtnPrimary({onClick,children,disabled=false,style={}}) {
  return (
    <button onClick={onClick} disabled={disabled} style={{padding:"8px 18px",borderRadius:8,border:"none",cursor:disabled?"not-allowed":"pointer",background:"linear-gradient(135deg,#3b5b8b,#3b5b8b)",color:"white",fontSize:13,fontWeight:600,fontFamily:"'Sarabun',sans-serif",opacity:disabled?0.45:1,boxShadow:disabled?"none":"0 2px 12px rgba(59,91,139,0.3)",...style}}>{children}</button>
  );
}

export function BtnSuccess({onClick,children,disabled=false,style={}}) {
  return (
    <button onClick={onClick} disabled={disabled} style={{padding:"8px 18px",borderRadius:8,border:"none",cursor:disabled?"not-allowed":"pointer",background:"linear-gradient(135deg,#059669,#10b981)",color:"white",fontSize:13,fontWeight:600,fontFamily:"'Sarabun',sans-serif",opacity:disabled?0.45:1,boxShadow:disabled?"none":"0 2px 10px rgba(16,185,129,0.3)",...style}}>{children}</button>
  );
}

export function BtnDanger({onClick,children,disabled=false,style={}}) {
  return (
    <button onClick={onClick} disabled={disabled} style={{padding:"8px 18px",borderRadius:8,border:"none",cursor:disabled?"not-allowed":"pointer",background:"linear-gradient(135deg,#dc2626,#ef4444)",color:"white",fontSize:13,fontWeight:600,fontFamily:"'Sarabun',sans-serif",opacity:disabled?0.45:1,boxShadow:disabled?"none":"0 2px 10px rgba(239,68,68,0.3)",...style}}>{children}</button>
  );
}

export function BtnGhost({onClick,children,style={}}) {
  return (
    <button onClick={onClick} style={{padding:"8px 18px",borderRadius:8,border:`1px solid ${T.border}`,cursor:"pointer",background:"rgba(59,91,139,0.05)",color:T.sub,fontSize:13,fontWeight:500,fontFamily:"'Sarabun',sans-serif",...style}}>{children}</button>
  );
}

export function Badge({children, bg, color}) {
  return (
    <span style={{padding:"3px 10px",borderRadius:20,fontSize:11,fontWeight:600,background:bg,color}}>{children}</span>
  );
}

export function CardBox({children, style={}}) {
  return (
    <div style={{background:"#ffffff",border:`1px solid ${T.border}`,borderRadius:14,padding:20,boxShadow:"0 1px 4px rgba(0,0,0,0.04)",...style}}>{children}</div>
  );
}
