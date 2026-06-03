// 📸 Barcode Scanner Modal
// ใช้ html5-qrcode — รองรับ EAN-13, Code 128, QR code, ฯลฯ
import { useEffect, useRef, useState } from "react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { T } from "../theme";

const SCAN_ID = "cpu-barcode-scanner-region";

/**
 * Props:
 * - onScan(code): callback เมื่อสแกนสำเร็จ — รับค่า string
 * - onClose(): callback เมื่อปิด modal
 * - title?: หัวข้อ modal (default "📸 สแกนบาร์โค้ด")
 */
export default function BarcodeScanner({ onScan, onClose, title = "📸 สแกนบาร์โค้ด" }) {
  const scannerRef = useRef(null);
  const [err, setErr] = useState("");
  const [cameras, setCameras] = useState([]);
  const [selectedCamId, setSelectedCamId] = useState("");
  const [lastScan, setLastScan] = useState("");
  const [scanning, setScanning] = useState(false);
  const debounceRef = useRef(0);

  // ── เริ่มต้น: ขอสิทธิ์กล้อง + list cameras
  useEffect(() => {
    let cancel = false;
    Html5Qrcode.getCameras()
      .then(devs => {
        if (cancel) return;
        if (!devs || devs.length === 0) {
          setErr("ไม่พบกล้องบนอุปกรณ์นี้");
          return;
        }
        setCameras(devs);
        // เลือกกล้องหลัง ถ้ามี (มือถือ)
        const back = devs.find(d => /back|rear|environment/i.test(d.label));
        setSelectedCamId(back ? back.id : devs[0].id);
      })
      .catch(e => {
        if (cancel) return;
        if (e?.name === "NotAllowedError") setErr("ไม่ได้รับสิทธิ์ใช้กล้อง — กรุณาอนุญาตใน browser settings");
        else setErr("เปิดกล้องไม่ได้: " + (e?.message || e));
      });
    return () => { cancel = true; };
  }, []);

  // ── เริ่ม scan เมื่อมีกล้องเลือกแล้ว
  useEffect(() => {
    if (!selectedCamId) return;
    let stopped = false;
    const html5 = new Html5Qrcode(SCAN_ID, {
      formatsToSupport: [
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.EAN_8,
        Html5QrcodeSupportedFormats.CODE_128,
        Html5QrcodeSupportedFormats.CODE_39,
        Html5QrcodeSupportedFormats.QR_CODE,
        Html5QrcodeSupportedFormats.UPC_A,
        Html5QrcodeSupportedFormats.UPC_E,
        Html5QrcodeSupportedFormats.ITF,
      ],
      verbose: false,
    });
    scannerRef.current = html5;

    const config = {
      fps: 10,
      qrbox: (vw, vh) => {
        const min = Math.min(vw, vh);
        const size = Math.floor(min * 0.7);
        return { width: size, height: Math.floor(size * 0.6) };
      },
    };

    html5.start(
      selectedCamId,
      config,
      (decodedText /*, decodedResult*/) => {
        // debounce — กันสแกนซ้ำ
        const now = Date.now();
        if (now - debounceRef.current < 1500 && decodedText === lastScan) return;
        debounceRef.current = now;
        setLastScan(decodedText);
        // beep
        try {
          const ctx = new (window.AudioContext || window.webkitAudioContext)();
          const osc = ctx.createOscillator();
          osc.frequency.value = 1000;
          osc.connect(ctx.destination);
          osc.start();
          setTimeout(() => { osc.stop(); ctx.close(); }, 80);
        } catch {}
        onScan?.(decodedText);
      },
      () => {} // ignore scan errors (frame ที่ไม่เจอ barcode)
    )
    .then(() => { if (!stopped) setScanning(true); })
    .catch(e => setErr("เริ่มกล้องไม่ได้: " + (e?.message || e)));

    return () => {
      stopped = true;
      setScanning(false);
      if (html5 && html5.isScanning) {
        html5.stop().then(() => html5.clear()).catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCamId]);

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.7)", zIndex: 400, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, backdropFilter: "blur(6px)" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, width: "100%", maxWidth: 560, maxHeight: "92vh", display: "flex", flexDirection: "column", boxShadow: "0 20px 60px rgba(0,0,0,0.4)" }}>
        {/* Header */}
        <div style={{ padding: "14px 18px", borderBottom: `1px solid ${T.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: T.text }}>{title}</div>
          <button onClick={onClose} style={{ padding: "6px 12px", borderRadius: 7, border: `1px solid ${T.border}`, background: "transparent", color: T.sub, cursor: "pointer", fontSize: 13 }}>✕ ปิด</button>
        </div>

        {/* Camera selector */}
        {cameras.length > 1 && (
          <div style={{ padding: "10px 18px", borderBottom: `1px solid ${T.border}`, background: "rgba(241,243,246,0.4)" }}>
            <label style={{ fontSize: 11, color: T.muted, fontWeight: 600, marginRight: 8 }}>📷 กล้อง:</label>
            <select value={selectedCamId} onChange={e => setSelectedCamId(e.target.value)}
              style={{ background: T.input, border: `1px solid ${T.inputBorder}`, color: T.text, borderRadius: 7, padding: "5px 10px", fontSize: 12, outline: "none", cursor: "pointer" }}>
              {cameras.map(c => <option key={c.id} value={c.id}>{c.label || "กล้อง " + c.id.slice(0, 6)}</option>)}
            </select>
          </div>
        )}

        {/* Scanner viewport */}
        <div style={{ padding: 16, background: "#000", position: "relative", minHeight: 320 }}>
          <div id={SCAN_ID} style={{ width: "100%", borderRadius: 8, overflow: "hidden" }}/>
          {!scanning && !err && (
            <div style={{ position: "absolute", inset: 16, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 13 }}>
              ⏳ กำลังเปิดกล้อง...
            </div>
          )}
          {err && (
            <div style={{ position: "absolute", inset: 16, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", color: "#fff", fontSize: 13, background: "rgba(0,0,0,0.5)", padding: 20, textAlign: "center" }}>
              <div style={{ fontSize: 32, marginBottom: 10 }}>📷</div>
              <div style={{ color: "#fca5a5", fontWeight: 600 }}>❌ {err}</div>
              <div style={{ fontSize: 11, marginTop: 12, color: "#cbd5e1" }}>ลองรีเฟรชหน้า · ตรวจสอบสิทธิ์กล้องใน browser · ต้องใช้ HTTPS (ยกเว้น localhost)</div>
            </div>
          )}
        </div>

        {/* Footer status */}
        <div style={{ padding: "12px 18px", background: "rgba(241,243,246,0.4)", borderTop: `1px solid ${T.border}` }}>
          <div style={{ fontSize: 11, color: T.muted, marginBottom: lastScan ? 8 : 0 }}>
            💡 จัดบาร์โค้ดให้อยู่ในกรอบสี่เหลี่ยม — จะอ่านอัตโนมัติ
          </div>
          {lastScan && (
            <div style={{ padding: "8px 12px", background: "rgba(58,122,82,0.1)", border: "1px solid rgba(58,122,82,0.3)", borderRadius: 7, fontSize: 12 }}>
              <span style={{ color: T.muted }}>ล่าสุด: </span>
              <code style={{ fontFamily: "monospace", color: T.green, fontWeight: 700 }}>{lastScan}</code>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
