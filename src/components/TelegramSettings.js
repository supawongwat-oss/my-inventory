// 🤖 Telegram Settings Panel — ตั้งค่า Telegram Bot สำหรับแจ้งเตือน
import { useState } from "react";
import { T } from "../theme";
import { sendTelegram, saveTelegramConfig, TELEGRAM_EVENTS } from "../utils/telegram";

export default function TelegramSettings({ config }) {
  const [form, setForm] = useState({
    botToken: config?.botToken || "",
    chatId: config?.chatId || "",
    enabled: !!config?.enabled,
    events: { ...Object.fromEntries(Object.entries(TELEGRAM_EVENTS).map(([k,v]) => [k, v.default])), ...(config?.events || {}) },
  });
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState({ type: "", text: "" });
  const [saved, setSaved] = useState(false);
  const [showGuide, setShowGuide] = useState(!config?.botToken);

  const handleSave = async () => {
    try {
      await saveTelegramConfig(form);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setTestMsg({ type: "err", text: "บันทึกล้มเหลว: " + e.message });
    }
  };

  const handleTest = async () => {
    if (!form.botToken || !form.chatId) {
      setTestMsg({ type: "err", text: "กรุณาใส่ Bot Token + Chat ID ก่อน" });
      return;
    }
    setTesting(true);
    setTestMsg({ type: "", text: "" });
    // ส่งทดสอบโดยไม่ผ่าน event filter
    const res = await sendTelegram({ ...form, enabled: true }, null, `🎉 <b>ทดสอบ Telegram จาก CPU ERP</b>\n\n✅ การตั้งค่าถูกต้อง! การแจ้งเตือนจะส่งมาที่ chat นี้`);
    setTesting(false);
    if (res.ok) {
      setTestMsg({ type: "ok", text: "✅ ส่งทดสอบสำเร็จ — เช็คใน Telegram chat" });
    } else {
      setTestMsg({ type: "err", text: "❌ ส่งไม่สำเร็จ: " + res.reason });
    }
  };

  const updateEvent = (key, val) => {
    setForm(f => ({ ...f, events: { ...f.events, [key]: val } }));
  };

  return (
    <div>
      {saved && <div style={{ background: "#dcfce7", border: "1px solid #86efac", borderRadius: 8, padding: "8px 14px", marginBottom: 12, color: "#166534", fontSize: 12 }}>✅ บันทึกสำเร็จ!</div>}

      {/* Header */}
      <div style={{ marginBottom: 14, padding: 14, background: "linear-gradient(135deg,rgba(59,91,139,0.06),rgba(58,122,82,0.06))", border: `1px solid ${T.border}`, borderRadius: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>🤖 Telegram Notification</div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <input type="checkbox" checked={form.enabled} onChange={e => setForm(f => ({ ...f, enabled: e.target.checked }))} style={{ width: 18, height: 18, cursor: "pointer", accentColor: T.green }}/>
            <span style={{ fontSize: 12, color: form.enabled ? T.green : T.muted, fontWeight: 700 }}>{form.enabled ? "เปิดใช้งาน" : "ปิดอยู่"}</span>
          </label>
        </div>
        <div style={{ fontSize: 11, color: T.sub }}>ส่งข้อความแจ้งเตือนไปยัง Telegram chat ของคุณ — ฟรี ไม่จำกัด</div>
      </div>

      {/* Setup Guide */}
      <div style={{ marginBottom: 14 }}>
        <button onClick={() => setShowGuide(s => !s)} style={{ width: "100%", padding: "10px 14px", borderRadius: 9, border: `1px solid ${T.border}`, background: "rgba(184,134,0,0.08)", color: T.amber, cursor: "pointer", fontSize: 12, fontFamily: "'Sarabun',sans-serif", fontWeight: 600, textAlign: "left", display: "flex", justifyContent: "space-between" }}>
          <span>📖 วิธี Setup (5 นาที — ครั้งแรก)</span>
          <span>{showGuide ? "▼" : "▶"}</span>
        </button>
        {showGuide && (
          <div style={{ marginTop: 8, padding: 14, background: "rgba(184,134,0,0.04)", border: `1px solid rgba(184,134,0,0.2)`, borderRadius: 9, fontSize: 12, lineHeight: 1.8 }}>
            <ol style={{ marginLeft: 18, color: T.text }}>
              <li>เปิด Telegram → search <b><code style={{ background: "rgba(0,0,0,0.05)", padding: "1px 6px", borderRadius: 4 }}>@BotFather</code></b></li>
              <li>พิมพ์ <code style={{ background: "rgba(0,0,0,0.05)", padding: "1px 6px", borderRadius: 4 }}>/newbot</code> → ตอบชื่อ bot และ username (ลงท้าย <code>_bot</code>)</li>
              <li>BotFather จะให้ <b>Bot Token</b> หน้าตา <code style={{ fontSize: 10 }}>123456:ABC-DEF...</code> → copy</li>
              <li>เปิด chat กับ bot ที่สร้าง → ส่งข้อความ <code>/start</code> ใดก็ได้</li>
              <li>เปิด URL ใน browser:<br/><code style={{ fontSize: 10, background: "rgba(0,0,0,0.05)", padding: "2px 6px", borderRadius: 4, display: "inline-block", marginTop: 4, wordBreak: "break-all" }}>https://api.telegram.org/bot[TOKEN]/getUpdates</code></li>
              <li>หาตัวเลข <code>"chat":{"{"}"id":<b>NNNNN</b>{"}"}</code> → นั่นคือ <b>Chat ID</b></li>
              <li>กลับมาใส่ Token + Chat ID ที่นี่ → กด <b>"ทดสอบ"</b></li>
            </ol>
            <div style={{ marginTop: 10, padding: 8, background: "rgba(59,91,139,0.06)", borderRadius: 6, fontSize: 11, color: T.accent }}>
              💡 <b>Tip:</b> ถ้าจะให้ทีมหลายคนได้รับ → สร้าง <b>Telegram Group</b> → เพิ่ม bot เข้า group → ใช้ chat ID ของ group แทน (จะเป็นเลขติดลบ)
            </div>
          </div>
        )}
      </div>

      {/* Form */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
        <div>
          <label style={{ fontSize: 11, color: T.muted, display: "block", marginBottom: 4, fontWeight: 600 }}>Bot Token *</label>
          <input value={form.botToken} onChange={e => setForm(f => ({ ...f, botToken: e.target.value.trim() }))} placeholder="123456789:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
            style={{ width: "100%", background: T.input, border: `1px solid ${T.inputBorder}`, color: T.text, borderRadius: 8, padding: "9px 12px", fontFamily: "monospace", fontSize: 12, outline: "none" }}/>
        </div>
        <div>
          <label style={{ fontSize: 11, color: T.muted, display: "block", marginBottom: 4, fontWeight: 600 }}>Chat ID *</label>
          <input value={form.chatId} onChange={e => setForm(f => ({ ...f, chatId: e.target.value.trim() }))} placeholder="123456789 หรือ -100123456 (group)"
            style={{ width: "100%", background: T.input, border: `1px solid ${T.inputBorder}`, color: T.text, borderRadius: 8, padding: "9px 12px", fontFamily: "monospace", fontSize: 12, outline: "none" }}/>
        </div>
      </div>

      {/* Test result */}
      {testMsg.text && (
        <div style={{ marginBottom: 12, padding: "10px 14px", background: testMsg.type === "ok" ? "#dcfce7" : "#fef2f2", border: `1px solid ${testMsg.type === "ok" ? "#86efac" : "#fecaca"}`, borderRadius: 8, color: testMsg.type === "ok" ? "#166534" : "#991b1b", fontSize: 12 }}>{testMsg.text}</div>
      )}

      {/* Events */}
      <div style={{ marginBottom: 14, padding: 14, background: T.card, border: `1px solid ${T.border}`, borderRadius: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: T.text, marginBottom: 10 }}>🔔 แจ้งเตือนอะไรบ้าง</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {Object.entries(TELEGRAM_EVENTS).map(([key, info]) => (
            <label key={key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 10px", borderRadius: 7, border: `1px solid ${form.events[key] ? T.accent + "60" : T.border}`, background: form.events[key] ? "rgba(59,91,139,0.06)" : "transparent", cursor: "pointer", fontSize: 12, transition: "all 0.15s" }}>
              <input type="checkbox" checked={!!form.events[key]} onChange={e => updateEvent(key, e.target.checked)} style={{ cursor: "pointer", accentColor: T.accent, width: 16, height: 16 }}/>
              <span style={{ color: form.events[key] ? T.text : T.sub, fontWeight: form.events[key] ? 600 : 400, flex: 1 }}>{info.label}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Action buttons */}
      <div style={{ display: "flex", gap: 10 }}>
        <button onClick={handleTest} disabled={testing || !form.botToken || !form.chatId}
          style={{ flex: 1, padding: "10px 14px", borderRadius: 9, border: `1px solid ${T.border}`, background: "rgba(184,134,0,0.1)", color: T.amber, cursor: (testing || !form.botToken || !form.chatId) ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 600, fontFamily: "'Sarabun',sans-serif", opacity: (testing || !form.botToken || !form.chatId) ? 0.45 : 1 }}>
          {testing ? "⏳ กำลังส่ง..." : "🧪 ทดสอบส่งข้อความ"}
        </button>
        <button onClick={handleSave}
          style={{ flex: 1, padding: "10px 14px", borderRadius: 9, border: "none", background: "linear-gradient(135deg,#3b5b8b,#3b5b8b)", color: "white", cursor: "pointer", fontSize: 13, fontWeight: 700, fontFamily: "'Sarabun',sans-serif", boxShadow: "0 2px 8px rgba(59,91,139,0.3)" }}>
          💾 บันทึก
        </button>
      </div>

      <div style={{ marginTop: 12, padding: 10, background: "rgba(59,91,139,0.05)", borderRadius: 7, fontSize: 11, color: T.muted, lineHeight: 1.7 }}>
        ⚙️ <b>ฟรี Quota:</b> Telegram ไม่จำกัดข้อความต่อ bot · ระบบจะหยุดส่งถ้า "เปิดใช้งาน" ปิด หรือ event เฉพาะถูกปิด
      </div>
    </div>
  );
}
