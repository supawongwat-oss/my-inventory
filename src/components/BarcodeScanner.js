// 📸 Barcode Scanner — ใช้ @zxing/browser (อ่านเร็วและแม่นกว่า html5-qrcode)
// รองรับ: EAN-13/8, Code 128/39, QR, UPC-A/E, ITF, Codabar
import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { DecodeHintType, BarcodeFormat } from "@zxing/library";
import { T } from "../theme";

/**
 * Props:
 * - onScan(code): callback เมื่อสแกนสำเร็จ
 * - onClose(): callback ปิด modal
 * - title?: หัวข้อ (default "📸 สแกนบาร์โค้ด")
 * - continuous?: boolean — true = ไม่ปิดหลังสแกนสำเร็จ (default false)
 */
export default function BarcodeScanner({ onScan, onClose, title = "📸 สแกนบาร์โค้ด", continuous = false }) {
  const videoRef = useRef(null);
  const controlsRef = useRef(null);
  const readerRef = useRef(null);
  const lastScanRef = useRef({ code: "", time: 0 });

  const [err, setErr] = useState("");
  const [cameras, setCameras] = useState([]);
  const [selectedCamId, setSelectedCamId] = useState("");
  const [lastScan, setLastScan] = useState("");
  const [scanCount, setScanCount] = useState(0);
  const [torchOn, setTorchOn] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const [manualCode, setManualCode] = useState("");

  // ── Initial: list cameras ──
  useEffect(() => {
    let cancel = false;
    BrowserMultiFormatReader.listVideoInputDevices()
      .then(devs => {
        if (cancel) return;
        if (!devs || devs.length === 0) {
          setErr("ไม่พบกล้องบนอุปกรณ์นี้");
          return;
        }
        setCameras(devs);
        // เลือกกล้องหลังถ้ามี (มือถือ)
        const back = devs.find(d => /back|rear|environment/i.test(d.label));
        setSelectedCamId(back ? back.deviceId : devs[0].deviceId);
      })
      .catch(e => {
        if (cancel) return;
        if (e?.name === "NotAllowedError") setErr("ไม่ได้รับสิทธิ์ใช้กล้อง — กรุณาอนุญาตใน browser");
        else setErr("เปิดกล้องไม่ได้: " + (e?.message || e));
      });
    return () => { cancel = true; };
  }, []);

  // ── Start decode loop ──
  useEffect(() => {
    if (!selectedCamId || !videoRef.current) return;

    let mounted = true;

    // Hints: รองรับหลาย format + try harder
    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [
      BarcodeFormat.EAN_13,
      BarcodeFormat.EAN_8,
      BarcodeFormat.CODE_128,
      BarcodeFormat.CODE_39,
      BarcodeFormat.UPC_A,
      BarcodeFormat.UPC_E,
      BarcodeFormat.ITF,
      BarcodeFormat.CODABAR,
      BarcodeFormat.QR_CODE,
      BarcodeFormat.DATA_MATRIX,
    ]);
    hints.set(DecodeHintType.TRY_HARDER, true);

    // ⚠️ สำคัญ: pass เฉพาะ hints (อย่าใส่ options arg ที่ 2 — version 0.2 ไม่รองรับ)
    const reader = new BrowserMultiFormatReader(hints);
    readerRef.current = reader;

    reader.decodeFromVideoDevice(
      selectedCamId,
      videoRef.current,
      (result, error, controls) => {
        if (!mounted) return;
        // Save controls reference (first call)
        if (controls && !controlsRef.current) {
          controlsRef.current = controls;
          // เช็ค torch หลังจาก video พร้อม
          setTimeout(() => checkTorchSupport(), 500);
        }
        if (result) {
          const code = result.getText();
          const now = Date.now();
          // debounce
          if (code === lastScanRef.current.code && now - lastScanRef.current.time < 1500) return;
          lastScanRef.current = { code, time: now };
          setLastScan(code);
          setScanCount(c => c + 1);
          beep();
          onScan?.(code);
          if (!continuous) {
            try { controls?.stop(); } catch {}
          }
        }
        // ignore decode errors (frame ที่ไม่เจอ barcode)
      }
    ).catch(e => {
      if (!mounted) return;
      console.error("scanner error:", e);
      const msg = e?.name === "NotAllowedError" ? "ไม่ได้รับสิทธิ์ใช้กล้อง"
        : e?.name === "NotFoundError" ? "ไม่พบกล้องที่เลือก"
        : e?.name === "NotReadableError" ? "กล้องถูกใช้งานโดยแอปอื่น"
        : ("เริ่มกล้องไม่ได้: " + (e?.message || e));
      setErr(msg);
    });

    return () => {
      mounted = false;
      try {
        controlsRef.current?.stop();
        controlsRef.current = null;
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCamId]);

  // ── Torch support check ──
  const checkTorchSupport = () => {
    try {
      const stream = videoRef.current?.srcObject;
      if (!stream) return;
      const track = stream.getVideoTracks()[0];
      if (!track || !track.getCapabilities) return;
      const caps = track.getCapabilities();
      if (caps?.torch) setTorchSupported(true);
    } catch (e) {
      console.warn("torch check failed:", e);
    }
  };

  // ── Toggle torch ──
  const toggleTorch = async () => {
    try {
      const stream = videoRef.current?.srcObject;
      if (!stream) return;
      const track = stream.getVideoTracks()[0];
      await track.applyConstraints({ advanced: [{ torch: !torchOn }] });
      setTorchOn(t => !t);
    } catch (e) {
      console.warn("torch toggle failed:", e);
    }
  };

  // ── Beep sound ──
  const beep = () => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 1200;
      gain.gain.value = 0.1;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      setTimeout(() => { osc.stop(); ctx.close(); }, 100);
    } catch {}
  };

  // ── Manual entry submit ──
  const handleManualSubmit = () => {
    const code = manualCode.trim();
    if (!code) return;
    setLastScan(code);
    onScan?.(code);
    setManualCode("");
    if (!continuous) onClose?.();
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.75)", zIndex: 500, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, backdropFilter: "blur(6px)" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, width: "100%", maxWidth: 540, maxHeight: "94vh", display: "flex", flexDirection: "column", boxShadow: "0 20px 60px rgba(0,0,0,0.5)" }}>
        {/* Header */}
        <div style={{ padding: "14px 18px", borderBottom: `1px solid ${T.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: T.text }}>{title}</div>
            {scanCount > 0 && <div style={{ fontSize: 10, color: T.muted, marginTop: 2 }}>สแกนแล้ว {scanCount} ครั้ง · ใช้ ZXing</div>}
          </div>
          <button onClick={onClose} style={{ padding: "6px 12px", borderRadius: 7, border: `1px solid ${T.border}`, background: "transparent", color: T.sub, cursor: "pointer", fontSize: 13 }}>✕ ปิด</button>
        </div>

        {/* Mode tabs */}
        <div style={{ display: "flex", padding: "8px 12px", gap: 4, borderBottom: `1px solid ${T.border}`, background: "rgba(241,243,246,0.4)" }}>
          <button onClick={()=>setManualMode(false)}
            style={{ flex: 1, padding: "7px", borderRadius: 7, border: "none", background: !manualMode?T.accent:"transparent", color: !manualMode?"#fff":T.sub, cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: "'Sarabun',sans-serif" }}>
            📷 กล้อง
          </button>
          <button onClick={()=>setManualMode(true)}
            style={{ flex: 1, padding: "7px", borderRadius: 7, border: "none", background: manualMode?T.accent:"transparent", color: manualMode?"#fff":T.sub, cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: "'Sarabun',sans-serif" }}>
            ⌨️ พิมพ์มือ
          </button>
        </div>

        {!manualMode ? (
          <>
            {/* Camera selector + torch */}
            <div style={{ padding: "10px 18px", borderBottom: `1px solid ${T.border}`, background: "rgba(241,243,246,0.3)", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              {cameras.length > 1 && (
                <>
                  <label style={{ fontSize: 11, color: T.muted, fontWeight: 600 }}>📷</label>
                  <select value={selectedCamId} onChange={e => setSelectedCamId(e.target.value)}
                    style={{ flex: 1, minWidth: 140, background: T.input, border: `1px solid ${T.inputBorder}`, color: T.text, borderRadius: 7, padding: "5px 10px", fontSize: 11, outline: "none", cursor: "pointer" }}>
                    {cameras.map(c => <option key={c.deviceId} value={c.deviceId}>{c.label || "กล้อง " + c.deviceId.slice(0, 6)}</option>)}
                  </select>
                </>
              )}
              {torchSupported && (
                <button onClick={toggleTorch}
                  style={{ padding: "6px 14px", borderRadius: 7, border: `1px solid ${torchOn?"#fbbf24":T.border}`, background: torchOn?"rgba(251,191,36,0.15)":"transparent", color: torchOn?"#d97706":T.sub, cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: "'Sarabun',sans-serif" }}>
                  {torchOn ? "🔦 ปิดไฟ" : "💡 เปิดไฟ"}
                </button>
              )}
            </div>

            {/* Video viewport */}
            <div style={{ padding: 14, background: "#000", position: "relative", minHeight: 320 }}>
              <video ref={videoRef} style={{ width: "100%", maxHeight: "55vh", borderRadius: 8, display: "block", objectFit: "cover" }} playsInline muted/>
              {/* Aiming overlay */}
              <div style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)", width: "75%", height: "30%", border: "2px solid rgba(58,189,248,0.6)", borderRadius: 8, pointerEvents: "none", boxShadow: "0 0 0 9999px rgba(0,0,0,0.25)" }}/>
              {err && (
                <div style={{ position: "absolute", inset: 14, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", color: "#fff", fontSize: 13, background: "rgba(0,0,0,0.7)", padding: 20, textAlign: "center", borderRadius: 8 }}>
                  <div style={{ fontSize: 32, marginBottom: 10 }}>📷</div>
                  <div style={{ color: "#fca5a5", fontWeight: 600 }}>❌ {err}</div>
                  <div style={{ fontSize: 11, marginTop: 12, color: "#cbd5e1" }}>ลองรีเฟรช · เช็คสิทธิ์กล้อง · ต้องใช้ HTTPS</div>
                </div>
              )}
            </div>

            {/* Tips footer */}
            <div style={{ padding: "10px 18px", background: "rgba(241,243,246,0.4)", borderTop: `1px solid ${T.border}` }}>
              <div style={{ fontSize: 11, color: T.muted, marginBottom: lastScan ? 6 : 0 }}>
                💡 จัดบาร์โค้ดในกรอบฟ้า · ระยะ 10-20 ซม. · ถือนิ่ง 1 วิ · ถ้ามืดกด <b>💡 เปิดไฟ</b>
              </div>
              {lastScan && (
                <div style={{ padding: "6px 10px", background: "rgba(58,122,82,0.1)", border: "1px solid rgba(58,122,82,0.3)", borderRadius: 6, fontSize: 11 }}>
                  <span style={{ color: T.muted }}>ล่าสุด: </span>
                  <code style={{ fontFamily: "monospace", color: T.green, fontWeight: 700 }}>{lastScan}</code>
                </div>
              )}
            </div>
          </>
        ) : (
          /* Manual entry mode */
          <div style={{ padding: 24 }}>
            <label style={{ fontSize: 12, color: T.muted, display: "block", marginBottom: 8, fontWeight: 600 }}>พิมพ์รหัส/บาร์โค้ดด้วยมือ</label>
            <input type="text" autoFocus value={manualCode}
              onChange={e=>setManualCode(e.target.value)}
              onKeyDown={e=>{ if(e.key==="Enter") handleManualSubmit(); }}
              placeholder="เช่น 8851234567890 หรือ ABC123"
              style={{ width: "100%", background: T.input, border: `1.5px solid ${T.accent}`, color: T.text, borderRadius: 9, padding: "14px 16px", fontFamily: "monospace", fontSize: 18, fontWeight: 700, outline: "none", marginBottom: 14, textAlign: "center" }}/>
            <button onClick={handleManualSubmit} disabled={!manualCode.trim()}
              style={{ width: "100%", padding: "12px", borderRadius: 9, border: "none", background: T.accent, color: "#fff", cursor: manualCode.trim()?"pointer":"not-allowed", fontSize: 14, fontWeight: 700, fontFamily: "'Sarabun',sans-serif", opacity: manualCode.trim()?1:0.45 }}>
              ✓ ค้นหา
            </button>
            <div style={{ marginTop: 14, padding: 10, background: "rgba(184,134,0,0.08)", borderRadius: 7, fontSize: 11, color: T.amber, lineHeight: 1.6 }}>
              💡 ถ้ากล้องอ่านไม่ออก ลองพิมพ์เลข barcode ใต้รหัสแท่งของสินค้า — กด Enter เพื่อค้นหาเร็ว
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
