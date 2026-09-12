// 🧯 กันจอขาว + ป้ายเตือนว่ามีเหตุค้าง/พังถูกบันทึกไว้
//
// เดิมถ้ามี error ที่ไหนสักแห่ง React จะถอดทั้งหน้าทิ้งเป็นจอขาว พนักงานเห็นแค่ "โปรแกรมพัง"
// แล้วไม่มีอะไรให้ตามต่อ · ตอนนี้ค้างไว้ที่หน้าจอบอกสาเหตุ พร้อมปุ่มคัดลอกรายละเอียด
import React from "react";
import { recordCrash, getCrashLog, clearCrashLog, crashLogText } from "../utils/crashLog";

const copy = (text) => {
  try {
    navigator.clipboard.writeText(text);
    alert("คัดลอกแล้ว — วางในแชทส่งให้คนแก้ได้เลย");
  } catch {
    // คลิปบอร์ดใช้ไม่ได้ (บางเครื่อง/บางสิทธิ์) — เปิดให้เลือกคัดลอกเองแทน ดีกว่าไม่ได้อะไรเลย
    window.prompt("คัดลอกข้อความนี้ส่งให้คนแก้", text);
  }
};

const box = {
  maxWidth: 720, margin: "40px auto", background: "white", borderRadius: 14,
  border: "1px solid #e3e8ef", padding: 24, fontFamily: "'Sarabun',sans-serif", color: "#1f2a44",
};
const btn = (primary) => ({
  padding: "9px 18px", borderRadius: 9, cursor: "pointer", fontSize: 13, fontFamily: "inherit", fontWeight: 600,
  border: primary ? "none" : "1px solid #d8dee9",
  background: primary ? "#3b5b8b" : "white", color: primary ? "white" : "#5b6b85",
});

export class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { err: null, info: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err, info) {
    this.setState({ info });
    recordCrash("render", { msg: err?.message || String(err), stack: (err?.stack || "") + "\n" + (info?.componentStack || "") });
  }
  render() {
    if (!this.state.err) return this.props.children;
    const detail = [
      `ข้อความ: ${this.state.err?.message || this.state.err}`,
      this.state.err?.stack || "",
      this.state.info?.componentStack || "",
    ].join("\n");
    return (
      <div style={box}>
        <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 6 }}>⚠️ หน้านี้มีปัญหา</div>
        <div style={{ fontSize: 13, color: "#5b6b85", lineHeight: 1.7, marginBottom: 14 }}>
          ข้อมูลที่บันทึกไปแล้วไม่หาย — ที่พังคือหน้าจอ ไม่ใช่ข้อมูล<br/>
          กด <b>โหลดหน้าใหม่</b> เพื่อใช้งานต่อ ถ้าพังซ้ำที่เดิม กด <b>คัดลอกรายละเอียด</b> แล้วส่งให้คนแก้
        </div>
        <pre style={{
          background: "#f6f8fb", border: "1px solid #e3e8ef", borderRadius: 9, padding: 12,
          fontSize: 11, lineHeight: 1.5, maxHeight: 220, overflow: "auto", whiteSpace: "pre-wrap", marginBottom: 14,
        }}>{detail.slice(0, 1500)}</pre>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button style={btn(true)} onClick={() => window.location.reload()}>🔄 โหลดหน้าใหม่</button>
          <button style={btn(false)} onClick={() => copy(crashLogText() + "\n\n" + detail)}>📋 คัดลอกรายละเอียด</button>
        </div>
      </div>
    );
  }
}

// 🔔 ป้ายเล็ก ๆ มุมจอ — ขึ้นเฉพาะตอนมีเหตุถูกบันทึกไว้
//    อาการ "ค้าง" ไม่ทำให้หน้าพัง จึงไม่มีอะไรฟ้อง ถ้าไม่มีป้ายนี้บันทึกจะนอนอยู่เฉย ๆ ไม่มีใครรู้
export function CrashWatch() {
  const [list, setList] = React.useState(() => getCrashLog());
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    // เหตุถูกบันทึกนอกวงจร React (onerror / ตัวจับค้าง) — คอยดูเป็นระยะ
    const t = setInterval(() => setList(getCrashLog()), 5000);
    return () => clearInterval(t);
  }, []);

  if (!list.length) return null;

  return (
    <div style={{ position: "fixed", left: 12, bottom: 12, zIndex: 9000, fontFamily: "'Sarabun',sans-serif" }}>
      {open && (
        <div style={{
          width: "min(560px, 92vw)", maxHeight: "60vh", overflowY: "auto", background: "white",
          border: "1px solid #e3e8ef", borderRadius: 12, boxShadow: "0 12px 40px rgba(0,0,0,0.18)", padding: 14, marginBottom: 8,
        }}>
          <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 4 }}>🧯 บันทึกเหตุขัดข้อง ({list.length})</div>
          <div style={{ fontSize: 11, color: "#8a9bb3", marginBottom: 10 }}>
            เก็บไว้ในเครื่องนี้เท่านั้น — ส่งให้คนแก้ด้วยปุ่มคัดลอกด้านล่าง
          </div>
          {list.map((c, i) => (
            <div key={i} style={{ borderTop: i ? "1px solid #eef2f7" : "none", padding: "7px 0", fontSize: 11.5, color: "#1f2a44" }}>
              <div style={{ fontWeight: 700 }}>
                {c.kind === "freeze" ? "🧊 ค้าง" : c.kind === "render" ? "💥 หน้าพัง" : "⚠️ error"} · {c.at}
                {c.mem && <span style={{ color: "#8a9bb3", fontWeight: 400 }}> · หน่วยความจำ {c.mem}</span>}
              </div>
              <div style={{ color: "#5b6b85", wordBreak: "break-word" }}>{c.msg}</div>
              {c.src && <div style={{ color: "#8a9bb3", fontSize: 10 }}>{c.src}</div>}
            </div>
          ))}
          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <button style={btn(true)} onClick={() => copy(crashLogText())}>📋 คัดลอกทั้งหมด</button>
            <button style={btn(false)} onClick={() => { clearCrashLog(); setList([]); setOpen(false); }}>ล้างบันทึก</button>
            <button style={btn(false)} onClick={() => setOpen(false)}>ปิด</button>
          </div>
        </div>
      )}
      <button onClick={() => setOpen(o => !o)} title="มีเหตุขัดข้องถูกบันทึกไว้ — กดดูรายละเอียด"
        style={{
          padding: "6px 12px", borderRadius: 20, cursor: "pointer", fontSize: 11.5, fontWeight: 700, fontFamily: "inherit",
          border: "1px solid rgba(217,119,6,0.45)", background: "rgba(254,243,199,0.97)", color: "#92400e",
          boxShadow: "0 4px 14px rgba(0,0,0,0.12)",
        }}>
        🧯 บันทึกเหตุขัดข้อง {list.length}
      </button>
    </div>
  );
}
