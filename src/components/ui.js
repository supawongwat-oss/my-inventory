import { T } from "../theme";

export function BarcodeDisplay({ value }) {
  if (!value || String(value).trim() === '') return null;
  const bars = []; let x = 8;
  const seed = String(value).split("").reduce((a,c) => a + c.charCodeAt(0), 0);
  for (let i = 0; i < 38; i++) {
    const w = ((seed * (i + 7) * 13) % 17 > 7) ? 3 : 1.5;
    bars.push(<rect key={i} x={x} y={8} width={w} height={44} fill={i % 2 === 0 ? "#1e293b" : "#fff"} />);
    x += w + 0.5;
  }
  return (
    <div style={{background:"white",borderRadius:8,padding:"6px 10px",display:"inline-block",textAlign:"center",border:`1px solid ${T.border}`}}>
      <svg width={x + 8} height={60}><rect width="100%" height="100%" fill="white"/>{bars}</svg>
      <div style={{fontSize:10,fontFamily:"monospace",color:"#1e293b",marginTop:2,letterSpacing:2}}>{value}</div>
    </div>
  );
}

export function Modal({ onClose, children, w = 460 }) {
  return (
    <div
      style={{position:"fixed",inset:0,background:T.overlay,display:"flex",alignItems:"center",justifyContent:"center",zIndex:300,backdropFilter:"blur(4px)"}}
    >
      <div
        style={{background:"#061628",border:`1px solid ${T.border}`,borderRadius:16,padding:28,width:w,boxShadow:"0 20px 60px rgba(0,0,0,0.15)",maxHeight:"88vh",overflowY:"auto"}}
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
    <button onClick={onClick} disabled={disabled} style={{padding:"8px 18px",borderRadius:8,border:"none",cursor:disabled?"not-allowed":"pointer",background:"linear-gradient(135deg,#0ea5e9,#0369a1)",color:"white",fontSize:13,fontWeight:600,fontFamily:"'Sarabun',sans-serif",opacity:disabled?0.45:1,boxShadow:disabled?"none":"0 2px 12px rgba(14,165,233,0.3)",...style}}>{children}</button>
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
    <button onClick={onClick} style={{padding:"8px 18px",borderRadius:8,border:`1px solid ${T.border}`,cursor:"pointer",background:"rgba(14,165,233,0.05)",color:T.sub,fontSize:13,fontWeight:500,fontFamily:"'Sarabun',sans-serif",...style}}>{children}</button>
  );
}

export function Badge({children, bg, color}) {
  return (
    <span style={{padding:"3px 10px",borderRadius:20,fontSize:11,fontWeight:600,background:bg,color}}>{children}</span>
  );
}

export function CardBox({children, style={}}) {
  return (
    <div style={{background:"#061628",border:`1px solid ${T.border}`,borderRadius:14,padding:20,boxShadow:"0 1px 4px rgba(0,0,0,0.04)",...style}}>{children}</div>
  );
}
