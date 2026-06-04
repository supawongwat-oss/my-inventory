import { useState } from "react";
import { T } from "../theme";
import { ROLES, INIT_USERS } from "../constants";
import { MASTER_KEY } from "../theme";
import { Input } from "./ui";

function CompanyEditor({ companyInfo, onSave }) {
  const [form, setForm] = useState({...companyInfo, bankAccounts: companyInfo.bankAccounts || []});
  const [saved, setSaved] = useState(false);

  const handle = async () => {
    await onSave(form);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const addBank = () => setForm(f=>({...f, bankAccounts:[...(f.bankAccounts||[]), {label:"", bankName:"", accountName:"", accountNo:""}]}));
  const updateBank = (i,k,v) => setForm(f=>({...f, bankAccounts:f.bankAccounts.map((b,j)=>j===i?{...b,[k]:v}:b)}));
  const removeBank = (i) => setForm(f=>({...f, bankAccounts:f.bankAccounts.filter((_,j)=>j!==i)}));

  return (
    <div>
      {saved && <div style={{background:"#dcfce7",border:"1px solid #86efac",borderRadius:8,padding:"8px 14px",marginBottom:12,color:"#166534",fontSize:12,fontWeight:500}}>✅ บันทึกสำเร็จ!</div>}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:14}}>
        {[
          {k:"name",l:"ชื่อบริษัท / ร้านค้า *",ph:"CPU"},
          {k:"logo",l:"โลโก้ (Emoji)",ph:"⚙️"},
          {k:"phone",l:"เบอร์โทรศัพท์",ph:"0812345678"},
          {k:"email",l:"Email",ph:"info@cpu.com"},
          {k:"taxId",l:"เลขผู้เสียภาษี",ph:"0000000000000"},
        ].map(f=>(
          <div key={f.k}>
            <label style={{fontSize:11,color:T.muted,display:"block",marginBottom:4,fontWeight:600}}>{f.l}</label>
            <input value={form[f.k]||""} onChange={e=>setForm(p=>({...p,[f.k]:e.target.value}))} placeholder={f.ph}
              style={{width:"100%",background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:8,padding:"8px 12px",fontFamily:"'Sarabun',sans-serif",fontSize:13,outline:"none"}}/>
          </div>
        ))}
        <div style={{gridColumn:"1/-1"}}>
          <label style={{fontSize:11,color:T.muted,display:"block",marginBottom:4,fontWeight:600}}>ที่อยู่บริษัท</label>
          <input value={form.address||""} onChange={e=>setForm(p=>({...p,address:e.target.value}))} placeholder="บ้านเลขที่ ซอย ถนน ตำบล อำเภอ จังหวัด รหัสไปรษณีย์"
            style={{width:"100%",background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:8,padding:"8px 12px",fontFamily:"'Sarabun',sans-serif",fontSize:13,outline:"none"}}/>
        </div>
      </div>

      {/* บัญชีธนาคาร */}
      <div style={{marginBottom:14,padding:14,background:"rgba(59,91,139,0.06)",border:"1px solid rgba(59,91,139,0.2)",borderRadius:10}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
          <div style={{fontSize:12,fontWeight:700,color:T.accent}}>🏦 บัญชีรับชำระเงิน</div>
          <button onClick={addBank} style={{padding:"5px 12px",borderRadius:7,border:"1px solid rgba(59,91,139,0.3)",background:"rgba(59,91,139,0.1)",color:T.accent,fontSize:11,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontWeight:600}}>+ เพิ่มบัญชี</button>
        </div>
        {(form.bankAccounts||[]).length===0&&<div style={{fontSize:11,color:T.muted,textAlign:"center",padding:10}}>ยังไม่มีบัญชี — กด "+ เพิ่มบัญชี" เพื่อเริ่ม (ใส่ได้ทั้งบัญชีบริษัทและบัญชีส่วนตัว)</div>}
        {(form.bankAccounts||[]).map((b,i)=>(
          <div key={i} style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr 32px",gap:6,marginBottom:6}}>
            <input value={b.label} onChange={e=>updateBank(i,"label",e.target.value)} placeholder="ชื่อเรียก (เช่น บัญชีบริษัท / บัญชีส่วนตัว)"
              style={{background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:7,padding:"7px 10px",fontFamily:"'Sarabun',sans-serif",fontSize:12,outline:"none"}}/>
            <input value={b.bankName} onChange={e=>updateBank(i,"bankName",e.target.value)} placeholder="ธนาคาร (เช่น กสิกร, SCB)"
              style={{background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:7,padding:"7px 10px",fontFamily:"'Sarabun',sans-serif",fontSize:12,outline:"none"}}/>
            <input value={b.accountName} onChange={e=>updateBank(i,"accountName",e.target.value)} placeholder="ชื่อบัญชี"
              style={{background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:7,padding:"7px 10px",fontFamily:"'Sarabun',sans-serif",fontSize:12,outline:"none"}}/>
            <input value={b.accountNo} onChange={e=>updateBank(i,"accountNo",e.target.value)} placeholder="เลขที่บัญชี"
              style={{background:T.input,border:`1px solid ${T.inputBorder}`,color:T.text,borderRadius:7,padding:"7px 10px",fontFamily:"monospace",fontSize:12,outline:"none"}}/>
            <button onClick={()=>removeBank(i)} style={{background:"rgba(248,113,113,0.1)",border:"1px solid rgba(248,113,113,0.3)",borderRadius:7,color:"#f87171",cursor:"pointer",fontSize:13}}>✕</button>
          </div>
        ))}
      </div>

      <button onClick={handle} style={{padding:"9px 20px",borderRadius:9,border:"none",cursor:"pointer",background:"linear-gradient(135deg,#3b5b8b,#3b5b8b)",color:"white",fontSize:13,fontWeight:600,fontFamily:"'Sarabun',sans-serif",boxShadow:"0 4px 14px rgba(59,91,139,0.3)"}}>
        💾 บันทึกข้อมูลบริษัท
      </button>
    </div>
  );
}

export { CompanyEditor };

export default function LoginPage({ users, onLogin, onResetPassword, onRegister }) {
  const [u,setU]=useState(""); const [p,setP]=useState(""); const [err,setErr]=useState(""); const [loading,setLoading]=useState(false);
  const [rememberMe,setRememberMe]=useState(true); // default ติ๊กไว้ — กันรหัสหลุดบ่อย
  const [showForgot,setShowForgot]=useState(false);
  const [showRegister,setShowRegister]=useState(false);
  const [regForm,setRegForm]=useState({name:"",username:"",password:"",confirm:""});
  const [regErr,setRegErr]=useState(""); const [regOk,setRegOk]=useState(false);

  const handleRegister = () => {
    setRegErr("");
    if(!regForm.name.trim()||!regForm.username.trim()){setRegErr("กรุณากรอกชื่อและชื่อผู้ใช้");return;}
    if(regForm.password.length<4){setRegErr("รหัสผ่านต้องมีอย่างน้อย 4 ตัว");return;}
    if(regForm.password!==regForm.confirm){setRegErr("รหัสผ่านไม่ตรงกัน");return;}
    if(users.find(x=>x.username===regForm.username.trim())){setRegErr("ชื่อผู้ใช้นี้มีในระบบแล้ว");return;}
    const id = Date.now();
    const newU = {id,username:regForm.username.trim(),password:regForm.password,name:regForm.name.trim(),role:"staff",avatar:"👷"};
    onRegister(newU);
    setRegOk(true);
    setTimeout(()=>{setRegOk(false);setShowRegister(false);setRegForm({name:"",username:"",password:"",confirm:""});},1500);
  };

  const [forgotStep,setForgotStep]=useState(1);
  const [forgotTarget,setForgotTarget]=useState("");
  const [adminPass,setAdminPass]=useState("");
  const [newPass,setNewPass]=useState(""); const [confirmPass,setConfirmPass]=useState("");
  const [forgotErr,setForgotErr]=useState(""); const [forgotOk,setForgotOk]=useState("");

  const handle = () => {
    if (!u || !p) { setErr("กรุณากรอกชื่อผู้ใช้และรหัสผ่าน"); return; }
    setLoading(true); setErr("");
    setTimeout(() => {
      const found = users.find(x => x.username === u && x.password === p);
      if (found) onLogin(found, rememberMe);
      else { setErr("ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง"); setLoading(false); }
    }, 500);
  };

  const handleForgotNext = () => {
    setForgotErr("");
    if (forgotStep === 1) {
      if (!forgotTarget) { setForgotErr("กรุณาเลือกบัญชีที่ต้องการรีเซ็ต"); return; }
      setForgotStep(2);
    } else if (forgotStep === 2) {
      const admin = users.find(x => x.role === "admin");
      const isAdminPass = admin && adminPass === admin.password;
      const isMasterKey = adminPass === MASTER_KEY;
      if (!isAdminPass && !isMasterKey) { setForgotErr("รหัสผ่าน Admin หรือ Master Key ไม่ถูกต้อง"); return; }
      setForgotStep(3);
    } else if (forgotStep === 3) {
      if (newPass.length < 4) { setForgotErr("รหัสผ่านใหม่ต้องมีอย่างน้อย 4 ตัว"); return; }
      if (newPass !== confirmPass) { setForgotErr("รหัสผ่านไม่ตรงกัน"); return; }
      onResetPassword(forgotTarget, newPass);
      setForgotOk(`รีเซ็ตรหัสผ่านสำเร็จ! กรุณาเข้าสู่ระบบด้วยรหัสใหม่`);
      setTimeout(() => { setShowForgot(false); setForgotStep(1); setForgotTarget(""); setAdminPass(""); setNewPass(""); setConfirmPass(""); setForgotOk(""); }, 2000);
    }
  };

  const closeForgot = () => { setShowForgot(false); setForgotStep(1); setForgotTarget(""); setAdminPass(""); setNewPass(""); setConfirmPass(""); setForgotErr(""); setForgotOk(""); };
  const stepLabel = ["","① เลือกบัญชี","② ยืนยัน Admin","③ ตั้งรหัสใหม่"];

  return (
    <div style={{minHeight:"100vh",backgroundColor:"#d1d5db",backgroundImage:"url('/login-bg.jpg')",backgroundSize:"auto 92vh",backgroundPosition:"center",backgroundRepeat:"no-repeat",display:"flex",alignItems:"center",justifyContent:"center",padding:"24px",fontFamily:"'Sarabun',sans-serif",position:"relative"}}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@300;400;500;600;700&family=Space+Mono:wght@400;700&display=swap');*{box-sizing:border-box;margin:0;padding:0}input:focus{outline:none;border-color:#93c5fd!important}`}</style>
      <div className="login-form-wrap" style={{width:400,position:"relative",zIndex:1}}>
        <div style={{textAlign:"center",marginBottom:24}}>
          <div style={{fontSize:30,fontWeight:800,color:"#1f2933",fontFamily:"'Space Mono',monospace",letterSpacing:5,textShadow:"0 1px 2px rgba(255,255,255,0.8)"}}>CPU</div>
          <div style={{fontSize:12,color:"#52606d",marginTop:4,fontWeight:600,letterSpacing:1}}>ระบบบริหารคลังสินค้า</div>
        </div>

        <div style={{background:"rgba(255,255,255,0.95)",backdropFilter:"blur(10px)",border:"1px solid rgba(203,210,217,0.6)",borderRadius:16,padding:32,boxShadow:"0 20px 60px rgba(31,41,51,0.18)"}}>
          <div style={{fontSize:16,fontWeight:700,color:"#1f2933",marginBottom:20}}>เข้าสู่ระบบ</div>
          {err && <div style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:8,padding:"10px 14px",color:"#dc2626",fontSize:13,marginBottom:14}}>⚠️ {err}</div>}
          <div style={{marginBottom:14}}>
            <Input label="ชื่อผู้ใช้" value={u} onChange={e=>setU(e.target.value)} placeholder="username" />
          </div>
          <div style={{marginBottom:8}}>
            <Input label="รหัสผ่าน" type="password" value={p} onChange={e=>setP(e.target.value)} placeholder="••••••" />
          </div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
            <label style={{display:"flex",alignItems:"center",gap:6,fontSize:12,color:T.sub,cursor:"pointer",userSelect:"none"}}>
              <input type="checkbox" checked={rememberMe} onChange={e=>setRememberMe(e.target.checked)} style={{cursor:"pointer",accentColor:"#3b5b8b"}}/>
              <span>จำฉันไว้ <span style={{fontSize:10,color:T.muted}}>(30 วัน)</span></span>
            </label>
            <span onClick={()=>setShowForgot(true)} style={{fontSize:12,color:T.blue,cursor:"pointer",fontWeight:500}}>🔑 ลืมรหัสผ่าน?</span>
          </div>
          <button onClick={handle} disabled={loading} style={{width:"100%",padding:"11px",background:"linear-gradient(135deg,#3b5b8b,#3b5b8b)",color:"white",border:"none",borderRadius:10,fontSize:14,fontWeight:700,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",opacity:loading?0.7:1,boxShadow:"0 4px 20px rgba(59,91,139,0.4)"}}>
            {loading?"กำลังเข้าสู่ระบบ...":"เข้าสู่ระบบ"}
          </button>
          <div style={{display:"flex",alignItems:"center",gap:10,margin:"16px 0"}}>
            <div style={{flex:1,height:1,background:T.border}}/><span style={{fontSize:11,color:T.muted}}>หรือ</span><div style={{flex:1,height:1,background:T.border}}/>
          </div>
          <button onClick={()=>setShowRegister(true)} style={{width:"100%",padding:"11px",background:"rgba(59,91,139,0.08)",color:"#3b5b8b",border:"2px solid rgba(59,91,139,0.35)",borderRadius:10,fontSize:14,fontWeight:700,cursor:"pointer",fontFamily:"'Sarabun',sans-serif"}}>
            👤 สมัคร Staff ID ใหม่
          </button>
        </div>
      </div>

      {/* MODAL: สมัคร Staff ID */}
      {showRegister&&(
        <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:300,backdropFilter:"blur(4px)"}} onMouseDown={e=>{if(e.target===e.currentTarget)setShowRegister(false);}}>
          <div onMouseDown={e=>e.stopPropagation()} style={{background:"#ffffff",border:"1px solid #0d2540",borderRadius:16,padding:28,width:440,boxShadow:"0 20px 60px rgba(0,8,30,0.8)"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
              <div style={{fontSize:15,fontWeight:700,color:"#93c5fd"}}>👤 สมัคร Staff ID ใหม่</div>
              <button onClick={()=>{setShowRegister(false);setRegForm({name:"",username:"",password:"",confirm:""});setRegErr("");}} style={{background:"none",border:`1px solid ${T.border}`,borderRadius:8,padding:"4px 10px",cursor:"pointer",color:T.sub,fontSize:13}}>✕</button>
            </div>
            {regOk&&<div style={{background:"#dcfce7",border:"1px solid #86efac",borderRadius:8,padding:"10px",marginBottom:14,color:"#166534",fontSize:13,textAlign:"center",fontWeight:500}}>✅ สมัครสำเร็จ! เข้าสู่ระบบได้เลย</div>}
            {regErr&&<div style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:8,padding:"10px 14px",color:"#dc2626",fontSize:13,marginBottom:14}}>⚠️ {regErr}</div>}
            <div style={{padding:12,background:"rgba(245,158,11,0.1)",border:"1px solid rgba(245,158,11,0.3)",borderRadius:8,marginBottom:18,fontSize:12,color:"#fbbf24"}}>
              🔐 บทบาทเริ่มต้นเป็น <b>Staff</b> — Admin สามารถเปลี่ยนบทบาทให้ได้ภายหลัง
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:12,marginBottom:20}}>
              <div><label style={{fontSize:11,color:"#64748b",display:"block",marginBottom:5,fontWeight:500}}>ชื่อ-นามสกุล *</label><input value={regForm.name} onChange={e=>setRegForm(f=>({...f,name:e.target.value}))} placeholder="กรอกชื่อ-นามสกุล" style={{width:"100%",background:"#252d40",border:"1px solid #2d3748",color:"#e2e8f0",borderRadius:8,padding:"9px 12px",fontFamily:"'Sarabun',sans-serif",fontSize:13,outline:"none"}}/></div>
              <div><label style={{fontSize:11,color:"#64748b",display:"block",marginBottom:5,fontWeight:500}}>ชื่อผู้ใช้ (username) *</label><input value={regForm.username} onChange={e=>setRegForm(f=>({...f,username:e.target.value}))} placeholder="ตั้งชื่อผู้ใช้สำหรับ Login" style={{width:"100%",background:"#252d40",border:"1px solid #2d3748",color:"#e2e8f0",borderRadius:8,padding:"9px 12px",fontFamily:"'Sarabun',sans-serif",fontSize:13,outline:"none"}}/></div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                <div><label style={{fontSize:11,color:"#64748b",display:"block",marginBottom:5,fontWeight:500}}>รหัสผ่าน * (4+ ตัว)</label><input type="password" value={regForm.password} onChange={e=>setRegForm(f=>({...f,password:e.target.value}))} placeholder="••••••" style={{width:"100%",background:"#252d40",border:"1px solid #2d3748",color:"#e2e8f0",borderRadius:8,padding:"9px 12px",fontFamily:"'Sarabun',sans-serif",fontSize:13,outline:"none"}}/></div>
                <div><label style={{fontSize:11,color:"#64748b",display:"block",marginBottom:5,fontWeight:500}}>ยืนยันรหัสผ่าน *</label><input type="password" value={regForm.confirm} onChange={e=>setRegForm(f=>({...f,confirm:e.target.value}))} placeholder="••••••" style={{width:"100%",background:"#252d40",border:"1px solid #2d3748",color:"#e2e8f0",borderRadius:8,padding:"9px 12px",fontFamily:"'Sarabun',sans-serif",fontSize:13,outline:"none"}}/></div>
              </div>
            </div>
            <div style={{display:"flex",gap:10}}>
              <button onClick={()=>{setShowRegister(false);setRegForm({name:"",username:"",password:"",confirm:""});setRegErr("");}} style={{flex:1,padding:"9px",borderRadius:8,border:`1px solid ${T.border}`,background:"transparent",color:"#64748b",fontSize:13,cursor:"pointer",fontFamily:"'Sarabun',sans-serif"}}>ยกเลิก</button>
              <button onClick={handleRegister} disabled={!regForm.name||!regForm.username||!regForm.password||!regForm.confirm} style={{flex:2,padding:"9px",borderRadius:8,border:"none",background:"linear-gradient(135deg,#3b82f6,#6366f1)",color:"white",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",opacity:(!regForm.name||!regForm.username||!regForm.password||!regForm.confirm)?0.45:1}}>✅ สร้าง Staff ID</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: ลืมรหัสผ่าน */}
      {showForgot&&(
        <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:300,backdropFilter:"blur(4px)"}} onClick={closeForgot}>
          <div onClick={e=>e.stopPropagation()} style={{background:"#ffffff",border:"1px solid #0d2540",borderRadius:16,padding:28,width:420,boxShadow:"0 20px 60px rgba(0,8,30,0.8)"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
              <div>
                <div style={{fontSize:15,fontWeight:700,color:"#3b5b8b"}}>🔑 ลืมรหัสผ่าน</div>
                <div style={{fontSize:11,color:T.muted,marginTop:2}}>{stepLabel[forgotStep]}</div>
              </div>
              <button onClick={closeForgot} style={{background:"none",border:`1px solid ${T.border}`,borderRadius:8,padding:"4px 10px",cursor:"pointer",color:T.sub,fontSize:13}}>✕</button>
            </div>
            <div style={{display:"flex",gap:6,marginBottom:20}}>
              {[1,2,3].map(s=>(
                <div key={s} style={{flex:1,height:4,borderRadius:2,background:forgotStep>=s?"#3b5b8b":"#0d2540",transition:"background .3s"}}/>
              ))}
            </div>
            {forgotErr&&<div style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:8,padding:"10px 14px",color:"#dc2626",fontSize:13,marginBottom:14}}>⚠️ {forgotErr}</div>}
            {forgotOk&&<div style={{background:"#dcfce7",border:"1px solid #86efac",borderRadius:8,padding:"10px 14px",color:"#166534",fontSize:13,marginBottom:14,textAlign:"center",fontWeight:500}}>✅ {forgotOk}</div>}
            {forgotStep===1&&!forgotOk&&(
              <div>
                <div style={{fontSize:13,color:T.sub,marginBottom:14}}>เลือกบัญชีที่ต้องการรีเซ็ตรหัสผ่าน</div>
                <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:20}}>
                  {users.map(u=>(
                    <div key={u.id} onClick={()=>setForgotTarget(u.username)} style={{display:"flex",alignItems:"center",gap:12,padding:"12px 14px",borderRadius:10,border:forgotTarget===u.username?`2px solid ${T.blue}`:`1px solid ${T.border}`,cursor:"pointer",background:forgotTarget===u.username?"#eff6ff":"white",transition:"all .18s"}}>
                      <div style={{fontSize:22}}>{u.avatar}</div>
                      <div style={{flex:1}}>
                        <div style={{fontSize:13,fontWeight:600,color:T.text}}>{u.name}</div>
                        <div style={{fontSize:11,color:T.muted}}>@{u.username} · <span style={{color:ROLES[u.role].color,fontWeight:600}}>{ROLES[u.role].label}</span></div>
                      </div>
                      {forgotTarget===u.username&&<div style={{color:T.blue,fontSize:16}}>✓</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {forgotStep===2&&!forgotOk&&(
              <div>
                <div style={{fontSize:13,color:T.sub,marginBottom:6}}>กรุณายืนยันตัวตนด้วย <b style={{color:T.amber}}>รหัสผ่าน Admin 👑</b> หรือ <b style={{color:T.indigo}}>Master Key 🗝️</b></div>
                <div style={{fontSize:12,color:T.muted,marginBottom:16}}>กรอกอย่างใดอย่างหนึ่งก็ได้ — ใช้ Master Key เมื่อ Admin ลืมรหัส</div>
                <div style={{marginBottom:12,padding:"10px 14px",background:"#fffbeb",border:"1px solid #fde68a",borderRadius:8}}>
                  <div style={{fontSize:11,color:"#92400e",fontWeight:600}}>🗝️ Master Key ฉุกเฉิน</div>
                  <div style={{fontSize:11,color:"#a16207",marginTop:2}}>ใช้เมื่อไม่มีใครจำรหัส Admin ได้ — เก็บไว้ในที่ปลอดภัย</div>
                  <div style={{fontSize:13,fontFamily:"monospace",fontWeight:700,color:"#92400e",marginTop:6,letterSpacing:2}}>{MASTER_KEY}</div>
                </div>
                <div style={{marginBottom:20}}>
                  <Input label="รหัสผ่าน Admin หรือ Master Key" type="password" placeholder="กรอกรหัสผ่าน Admin หรือ Master Key" value={adminPass} onChange={e=>setAdminPass(e.target.value)}/>
                </div>
              </div>
            )}
            {forgotStep===3&&!forgotOk&&(
              <div>
                <div style={{fontSize:13,color:T.sub,marginBottom:16}}>ตั้งรหัสผ่านใหม่สำหรับบัญชี <b style={{color:T.text}}>@{forgotTarget}</b></div>
                <div style={{display:"flex",flexDirection:"column",gap:12,marginBottom:20}}>
                  <Input label="รหัสผ่านใหม่ (อย่างน้อย 4 ตัว)" type="password" placeholder="••••••" value={newPass} onChange={e=>setNewPass(e.target.value)}/>
                  <Input label="ยืนยันรหัสผ่านใหม่" type="password" placeholder="••••••" value={confirmPass} onChange={e=>setConfirmPass(e.target.value)}/>
                </div>
              </div>
            )}
            {!forgotOk&&(
              <div style={{display:"flex",gap:10}}>
                {forgotStep>1&&<button onClick={()=>{setForgotStep(s=>s-1);setForgotErr("");}} style={{flex:1,padding:"9px",borderRadius:8,border:`1px solid ${T.border}`,background:"transparent",color:T.sub,fontSize:13,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontWeight:500}}>← ย้อนกลับ</button>}
                <button onClick={handleForgotNext} style={{flex:2,padding:"9px",borderRadius:8,border:"none",background:"linear-gradient(135deg,#3b82f6,#6366f1)",color:"white",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"'Sarabun',sans-serif"}}>
                  {forgotStep===3?"🔓 รีเซ็ตรหัสผ่าน":"ถัดไป →"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
