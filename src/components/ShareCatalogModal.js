// 📱 แชร์ลิงก์สั่งของให้ลูกค้า — QR + ลิงก์สั้น + ปุ่มคัดลอก/แชร์
// ลูกค้าสแกน QR แล้วเข้าหน้าสั่งของได้เลย ไม่ต้องพิมพ์ URL ยาว ๆ
import { useState, useEffect, useRef } from "react";
import QRCode from "qrcode";
import { Modal, MHead, BtnPrimary, BtnGhost } from "./ui";
import { T } from "../theme";

// ลิงก์สั้นที่สุดที่ระบบรองรับ (ดู CATALOG_ALIASES ใน index.js)
const SHORT_PATH = "/c";

export default function ShareCatalogModal({ companyInfo = {}, onClose }) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const shortUrl = `${origin}${SHORT_PATH}`;
  const [dataUrl, setDataUrl] = useState("");
  const [copied, setCopied] = useState("");
  const printRef = useRef(null);

  useEffect(() => {
    QRCode.toDataURL(shortUrl, { width: 640, margin: 1, errorCorrectionLevel: "M" })
      .then(setDataUrl)
      .catch(e => console.warn("[QR] สร้างไม่สำเร็จ:", e));
  }, [shortUrl]);

  const copy = async (text, what) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(""), 1500);
    } catch {
      window.prompt("คัดลอกลิงก์นี้:", text);
    }
  };

  const shareNative = async () => {
    if (!navigator.share) { copy(shortUrl, "link"); return; }
    try {
      await navigator.share({ title: `สั่งของ — ${companyInfo.name || "ร้านเรา"}`, text: "สั่งของออนไลน์ได้ที่นี่", url: shortUrl });
    } catch { /* ผู้ใช้ยกเลิก — ไม่ต้องทำอะไร */ }
  };

  // ปริ้นป้าย QR ไปแปะหน้าร้าน/ใส่ในกล่องพัสดุ
  const printQr = () => {
    if (!dataUrl) return;
    const w = window.open("", "_blank", "width=600,height=800");
    if (!w) { alert("เบราว์เซอร์บล็อกหน้าต่างใหม่ — อนุญาต popup แล้วลองใหม่"); return; }
    const esc = s => String(s || "").replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>QR สั่งของ</title>
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;800&display=swap');
        body{font-family:'Sarabun',sans-serif;text-align:center;padding:28px;margin:0;}
        .box{border:3px solid #1f2a44;border-radius:18px;padding:26px 20px;max-width:420px;margin:0 auto;}
        h1{font-size:26px;margin:0 0 4px;color:#1f2a44;}
        .sub{font-size:15px;color:#5b6b85;margin-bottom:16px;}
        img{width:290px;height:290px;}
        .url{font-size:19px;font-weight:800;color:#3b5b8b;margin-top:12px;letter-spacing:.3px;}
        .hint{font-size:13px;color:#5b6b85;margin-top:6px;}
        @media print{ body{padding:0;} }
      </style></head><body>
      <div class="box">
        <h1>📱 สั่งของออนไลน์</h1>
        <div class="sub">${esc(companyInfo.name || "")}</div>
        <img src="${dataUrl}" alt="QR"/>
        <div class="url">${esc(shortUrl.replace(/^https?:\/\//, ""))}</div>
        <div class="hint">สแกน QR หรือพิมพ์ลิงก์ด้านบนในเบราว์เซอร์</div>
      </div>
      <script>window.onload=()=>{setTimeout(()=>{window.print();},350);}</script>
      </body></html>`);
    w.document.close();
  };

  return (
    <Modal onClose={onClose} w={480}>
      <MHead title="📱 ลิงก์สั่งของสำหรับลูกค้า" sub="ให้ลูกค้าสแกน QR หรือพิมพ์ลิงก์สั้น ๆ" onClose={onClose}/>

      <div ref={printRef} style={{ textAlign: "center", padding: "8px 0 4px" }}>
        {dataUrl ? (
          <img src={dataUrl} alt="QR สั่งของ" style={{ width: 220, height: 220, border: `1px solid ${T.border}`, borderRadius: 12, padding: 8, background: "white" }}/>
        ) : (
          <div style={{ width: 220, height: 220, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "center", color: T.muted, fontSize: 13, border: `1px dashed ${T.border}`, borderRadius: 12 }}>⏳ กำลังสร้าง QR...</div>
        )}
        <div style={{ marginTop: 12, fontSize: 20, fontWeight: 800, color: T.accent, fontFamily: "monospace" }}>
          {shortUrl.replace(/^https?:\/\//, "")}
        </div>
        <div style={{ fontSize: 11, color: T.muted, marginTop: 4 }}>สั้นกว่าเดิม — ไม่ต้องพิมพ์ /catalog แล้ว</div>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
        <BtnPrimary onClick={shareNative} style={{ flex: "1 1 140px" }}>
          {copied === "link" ? "✅ คัดลอกแล้ว" : "📤 ส่งให้ลูกค้า"}
        </BtnPrimary>
        <BtnGhost onClick={() => copy(shortUrl, "link")} style={{ flex: "1 1 120px" }}>
          {copied === "link" ? "✅ คัดลอกแล้ว" : "🔗 คัดลอกลิงก์"}
        </BtnGhost>
        <BtnGhost onClick={printQr} disabled={!dataUrl} style={{ flex: "1 1 120px" }}>🖨️ ปริ้นป้าย QR</BtnGhost>
      </div>

      <div style={{ marginTop: 14, padding: "10px 14px", background: "rgba(59,91,139,0.06)", border: `1px solid ${T.border}`, borderRadius: 10, fontSize: 12, color: T.sub, lineHeight: 1.8 }}>
        💡 <b>เอาไปใช้ยังไงได้บ้าง</b><br/>
        • ส่งลิงก์ในไลน์/แชท — ลูกค้ากดเข้าได้เลย<br/>
        • ปริ้นป้าย QR แปะหน้าร้าน หรือใส่ในกล่องพัสดุ<br/>
        • ลูกค้าพิมพ์เองก็ได้ — พิมพ์แค่ <b style={{ color: T.accent }}>{shortUrl.replace(/^https?:\/\//, "")}</b>
      </div>
    </Modal>
  );
}
