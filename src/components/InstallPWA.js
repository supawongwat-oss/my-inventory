import React, { useEffect, useState } from "react";

function detectDevice() {
  const ua = navigator.userAgent || "";
  const isIOS = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
  const isIPadOS = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  const isAndroid = /Android/i.test(ua);
  const isSafari = /^((?!chrome|android).)*safari/i.test(ua);
  const isInStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  return { isIOS: isIOS || isIPadOS, isAndroid, isSafari, isInStandalone };
}

export default function InstallPWA() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [device, setDevice] = useState({ isIOS: false, isAndroid: false, isSafari: false, isInStandalone: false });
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    setDevice(detectDevice());

    const onBeforeInstall = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") setInstalled(true);
    setDeferredPrompt(null);
  };

  const box = { background: "#f6f8fb", border: "1px solid #e3e8ef", borderRadius: 10, padding: 16, marginBottom: 12 };
  const title = { fontSize: 15, fontWeight: 700, color: "#1f2a44", marginBottom: 8 };
  const step = { fontSize: 13, color: "#3a4a66", marginBottom: 6, lineHeight: 1.6 };
  const btn = { padding: "10px 18px", background: "#1a73e8", color: "#fff", border: 0, borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" };

  if (device.isInStandalone || installed) {
    return (
      <div style={{ ...box, background: "#e8f5e9", borderColor: "#b6e0bc" }}>
        <div style={title}>✅ ติดตั้งแอปแล้ว</div>
        <div style={step}>คุณกำลังใช้งานผ่านแอปที่ติดตั้งไว้แล้ว</div>
      </div>
    );
  }

  return (
    <div>
      <div style={box}>
        <div style={title}>📱 ติดตั้งแอป CPU ERP</div>
        <div style={step}>ติดตั้งแอปลงในเครื่องเพื่อใช้งานเหมือนแอปจริง — เปิดเร็วขึ้น และใช้ได้แม้เน็ตหลุด</div>
      </div>

      {deferredPrompt && (
        <div style={box}>
          <div style={title}>🟢 พร้อมติดตั้ง</div>
          <div style={step}>กดปุ่มด้านล่างเพื่อติดตั้งแอปลงในเครื่อง</div>
          <button style={btn} onClick={handleInstall}>📥 ติดตั้งเลย</button>
        </div>
      )}

      {device.isIOS && (
        <div style={box}>
          <div style={title}>🍎 iPad / iPhone (Safari)</div>
          <div style={step}>1. กดปุ่ม <b>แชร์</b> <span style={{ fontSize: 16 }}>⬆️</span> ด้านล่าง (หรือมุมขวาบน)</div>
          <div style={step}>2. เลื่อนหา <b>"เพิ่มที่หน้าจอโฮม"</b> (Add to Home Screen)</div>
          <div style={step}>3. กด <b>"เพิ่ม"</b> มุมขวาบน</div>
          <div style={{ ...step, color: "#b07b00", marginTop: 8 }}>⚠️ ต้องเปิดด้วย Safari เท่านั้น (Chrome บน iOS ติดตั้งไม่ได้)</div>
        </div>
      )}

      {device.isAndroid && !deferredPrompt && (
        <div style={box}>
          <div style={title}>🤖 Android (Chrome)</div>
          <div style={step}>1. กดปุ่ม <b>เมนู ⋮</b> มุมขวาบนของ Chrome</div>
          <div style={step}>2. เลือก <b>"ติดตั้งแอป"</b> หรือ <b>"เพิ่มไปยังหน้าจอหลัก"</b></div>
          <div style={step}>3. กด <b>"ติดตั้ง"</b></div>
          <div style={{ ...step, color: "#b07b00", marginTop: 8 }}>💡 ถ้าไม่เห็นเมนู ลองรีเฟรชหน้าเว็บ หรือเข้าใหม่ผ่าน Chrome โดยตรง (ไม่ใช่ใน LINE/Facebook)</div>
        </div>
      )}

      {!device.isIOS && !device.isAndroid && !deferredPrompt && (
        <div style={box}>
          <div style={title}>💻 คอมพิวเตอร์ (Chrome / Edge)</div>
          <div style={step}>1. ดูที่ <b>แถบ URL ด้านบน</b> — จะมีไอคอน <b>⊕ ติดตั้ง</b> ทางขวา</div>
          <div style={step}>2. กดไอคอนนั้น แล้วกด <b>"ติดตั้ง"</b></div>
          <div style={step}>หรือ: เมนู ⋮ มุมขวาบน → <b>"ติดตั้ง CPU ERP..."</b></div>
        </div>
      )}

      <div style={{ ...box, background: "#fff7e6", borderColor: "#ffd980" }}>
        <div style={title}>❓ ไม่เห็นปุ่มติดตั้ง?</div>
        <div style={step}>• ตรวจสอบว่าเปิดผ่านเบราว์เซอร์โดยตรง (ไม่ใช่ผ่าน LINE/Facebook)</div>
        <div style={step}>• อาจติดตั้งไว้แล้ว — ลองหาที่หน้าจอหลัก</div>
        <div style={step}>• ลองรีเฟรชหน้าเว็บ หรือปิดเปิดเบราว์เซอร์ใหม่</div>
      </div>
    </div>
  );
}
