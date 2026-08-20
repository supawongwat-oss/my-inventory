// 🧾↩️ ใบลดหนี้ (Credit Note) — เอกสารแยกใบ อ้างถึงบิลต้นทาง
//
// ทำไมต้องเป็นเอกสารแยก ไม่ใช่แก้ยอดในบิลเดิม:
//   บิลต้นทางออกไปแล้วและอยู่ในมือลูกค้า ถ้าย้อนไปแก้ยอด เอกสารสองฝั่งจะไม่ตรงกัน
//   ตรวจสอบย้อนหลังไม่ได้ และผิดหลักบัญชี — วิธีที่ถูกคือออกใบลดหนี้อีกใบมาหักกัน
//
// เลขที่เอกสาร: จองเลขชุด CN ครั้งแรกที่พิมพ์ แล้วเก็บติดใบรับคืนไว้ (พิมพ์ซ้ำได้เลขเดิม)
// VAT: ถ้าบิลต้นทางมี VAT ใบลดหนี้ต้องแยกฐานภาษี/ภาษี ให้ตรงกัน ไม่งั้นยอดคืนภาษีไม่ตรง
import React from "react";
import { INVOICE_FONT_SCALE, INVOICE_MARGIN_TOP, INVOICE_MARGIN_BOTTOM, INVOICE_PAD_TOP, INVOICE_PAD_BOTTOM } from "../utils/print";

const money = (n) => Number(n || 0).toLocaleString("th-TH", { minimumFractionDigits: 2 });

// ชื่อบริษัทแบบย่อ — ใช้ตอนบิลต้นทางติ๊ก "ซ่อนข้อมูลบริษัท"
const shortCompanyName = (name) => {
  let s = String(name || "").trim();
  s = s.replace(/\((มหาชน|สำนักงานใหญ่)\)/g, "");
  s = s.replace(/^(ห้างหุ้นส่วนจำกัด|ห้างหุ้นส่วนสามัญ|หจก\.?|บริษัท|บมจ\.?|บจ\.?|บจก\.?)\s*/i, "");
  s = s.replace(/\s*(จำกัด|Co\.,?\s*Ltd\.?|Company\s+Limited|Ltd\.?|Part\.?,?\s*Ltd\.?)\s*$/i, "");
  return s.trim() || String(name || "").trim();
};

export default function PrintCreditNoteModal({
  ret,                 // ใบรับคืน (ต้องจับคู่บิลแล้ว)
  invoice = null,      // บิลต้นทาง — ใช้ดู VAT/ที่อยู่ (อาจ null ถ้าอยู่นอกช่วงที่โหลดมา)
  companyInfo = {},
  onClose,
  printElementById,
}) {
  if (!ret) return null;

  const items = (ret.items || []).filter(i => Number(i.qty) > 0);
  const gross = items.reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.unitPrice) || 0), 0);

  // บิลต้นทางมี VAT → ใบลดหนี้ต้องแยกฐาน/ภาษีให้ตรงกัน
  // ราคาที่เก็บในบิลเป็นราคาก่อน VAT (calcInvoice บวก VAT ทีหลัง) จึงคิดแบบเดียวกัน
  const useVat = !!invoice?.useVat;
  const vatRate = Number(invoice?.vatRate) || 7;
  const vat = useVat ? gross * vatRate / 100 : 0;
  const grand = gross + vat;

  const hideCo = invoice?.hideCompanyDetails === true;
  const coName = hideCo ? shortCompanyName(companyInfo.name || "CPU") : (companyInfo.name || "CPU");
  const showCoTaxId = !hideCo && invoice?.showCompanyTaxId !== false && !!companyInfo.taxId;

  const docNo = ret.creditNoteNo || ret.returnNo || "";
  const cell = { padding: "5px 7px", border: "1px solid #000", color: "#000", fontSize: 10 };

  return (
    <div className="print-modal-overlay"
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 500, backdropFilter: "blur(6px)" }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="print-modal-card" onMouseDown={e => e.stopPropagation()}
        style={{ background: "white", borderRadius: 16, width: "min(96vw, 794px)", maxHeight: "94vh", overflow: "auto", boxShadow: "0 24px 60px rgba(0,0,0,0.7)" }}>

        <div style={{ padding: INVOICE_MARGIN_TOP + " 0" }}>
        <div id="creditnote-print-area"
          style={{ padding: `${INVOICE_PAD_TOP} 2.5mm ${INVOICE_PAD_BOTTOM}`, fontFamily: "'Sarabun',sans-serif", color: "#000", boxSizing: "border-box" }}>

          {/* ── หัวเอกสาร ── */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8, paddingBottom: 6, borderBottom: "2px solid #000" }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                <div style={{ width: 42, height: 42, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, overflow: "hidden", background: "white" }}>
                  <img src={`${process.env.PUBLIC_URL}/cpu-logo.png`} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }}
                    onError={(e) => { e.target.style.display = "none"; }} />
                </div>
                <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: 1.5 }}>{coName}</div>
              </div>
              {!hideCo && companyInfo.address && <div style={{ fontSize: 10, marginBottom: 1, maxWidth: 300, lineHeight: 1.5 }}>{companyInfo.address}</div>}
              {showCoTaxId && <div style={{ fontSize: 10, marginTop: 1 }}>เลขผู้เสียภาษี: {companyInfo.taxId}</div>}
            </div>

            <div style={{ textAlign: "right", minWidth: 200 }}>
              <div style={{ display: "inline-block", padding: "4px 16px", borderRadius: 4, fontSize: 15, fontWeight: 800, marginBottom: 6, letterSpacing: 1, border: "2px solid #000", whiteSpace: "nowrap" }}>
                ใบลดหนี้
              </div>
              <div style={{ fontSize: 9, marginBottom: 5, letterSpacing: 0.5 }}>CREDIT NOTE</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
                  <span style={{ fontSize: 10, fontWeight: 600, minWidth: 62, textAlign: "right" }}>เลขที่:</span>
                  <span style={{ fontSize: 11, fontFamily: "monospace", fontWeight: 700 }}>{docNo}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
                  <span style={{ fontSize: 10, fontWeight: 600, minWidth: 62, textAlign: "right" }}>วันที่:</span>
                  <span style={{ fontSize: 10, fontWeight: 600 }}>{(ret.checkedAt || ret.receivedAt || "").split(" ")[0]}</span>
                </div>
                {/* 🔗 อ้างบิลต้นทาง — หัวใจของใบลดหนี้ ต้องบอกว่าไปหักใบไหน */}
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
                  <span style={{ fontSize: 10, fontWeight: 600, minWidth: 62, textAlign: "right" }}>อ้างถึงบิล:</span>
                  <span style={{ fontSize: 11, fontFamily: "monospace", fontWeight: 700 }}>{ret.invoiceNo || "-"}</span>
                </div>
                {invoice?.date && (
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
                    <span style={{ fontSize: 10, fontWeight: 600, minWidth: 62, textAlign: "right" }}>ลงวันที่:</span>
                    <span style={{ fontSize: 10 }}>{(invoice.date || "").split(" ")[0]}</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ── ลูกค้า ── */}
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <div style={{ flex: 1, border: "1px solid #000", borderRadius: 6, padding: "7px 10px" }}>
              <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: 0.8, marginBottom: 3 }}>ลดหนี้ให้แก่</div>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{ret.customerName || invoice?.customerName || "-"}</div>
              {(ret.customerPhone || invoice?.customerPhone) && <div style={{ fontSize: 10, marginTop: 2 }}>โทร: {ret.customerPhone || invoice?.customerPhone}</div>}
              {invoice?.customerAddress && <div style={{ fontSize: 10, marginTop: 2, lineHeight: 1.5 }}>{invoice.customerAddress}</div>}
              {invoice?.customerTaxId && <div style={{ fontSize: 10, marginTop: 2 }}>เลขผู้เสียภาษี: {invoice.customerTaxId}</div>}
            </div>
            <div style={{ flex: 1, border: "1px solid #000", borderRadius: 6, padding: "7px 10px" }}>
              <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: 0.8, marginBottom: 3 }}>สาเหตุการลดหนี้</div>
              <div style={{ fontSize: 12, fontWeight: 600 }}>{ret.reason || "รับคืนสินค้า"}</div>
              {ret.trackingNo && <div style={{ fontSize: 10, marginTop: 3 }}>เลขพัสดุ: {ret.trackingNo}</div>}
              {ret.note && <div style={{ fontSize: 10, marginTop: 3, fontStyle: "italic" }}>{ret.note}</div>}
            </div>
          </div>

          {/* ── รายการที่รับคืน ── */}
          <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 8 }}>
            <thead>
              <tr style={{ background: "#f1f5f9" }}>
                <th style={{ ...cell, textAlign: "left", fontWeight: 700, width: 34 }}>ลำดับ</th>
                <th style={{ ...cell, textAlign: "left", fontWeight: 700 }}>รายการ</th>
                <th style={{ ...cell, textAlign: "center", fontWeight: 700, width: 56 }}>ไซส์</th>
                <th style={{ ...cell, textAlign: "center", fontWeight: 700, width: 56 }}>จำนวน</th>
                <th style={{ ...cell, textAlign: "right", fontWeight: 700, width: 74 }}>ราคา/หน่วย</th>
                <th style={{ ...cell, textAlign: "right", fontWeight: 700, width: 88 }}>รวม (฿)</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={i} style={{ background: i % 2 === 0 ? "white" : "#f8fafc" }}>
                  <td style={{ ...cell, textAlign: "center" }}>{i + 1}</td>
                  <td style={cell}>
                    {it.clothingName}{it.colorName ? ` · ${it.colorName}` : ""}
                    {!it.restock && <span style={{ fontSize: 8, marginLeft: 5 }}>({it.condition})</span>}
                  </td>
                  <td style={{ ...cell, textAlign: "center", fontFamily: "monospace", fontWeight: 700 }}>{it.size || "-"}</td>
                  <td style={{ ...cell, textAlign: "center", fontFamily: "monospace", fontWeight: 700 }}>{it.qty}</td>
                  <td style={{ ...cell, textAlign: "right", fontFamily: "monospace" }}>{money(it.unitPrice)}</td>
                  <td style={{ ...cell, textAlign: "right", fontFamily: "monospace", fontWeight: 700 }}>{money((Number(it.qty) || 0) * (Number(it.unitPrice) || 0))}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              {useVat && (
                <>
                  <tr style={{ background: "#f1f5f9" }}>
                    <td colSpan={5} style={{ ...cell, textAlign: "right", fontWeight: 600 }}>มูลค่าสินค้าที่รับคืน</td>
                    <td style={{ ...cell, textAlign: "right", fontFamily: "monospace", fontWeight: 700, whiteSpace: "nowrap" }}>{money(gross)}</td>
                  </tr>
                  <tr style={{ background: "#f1f5f9" }}>
                    <td colSpan={5} style={{ ...cell, textAlign: "right" }}>ภาษีมูลค่าเพิ่ม {vatRate}%</td>
                    <td style={{ ...cell, textAlign: "right", fontFamily: "monospace", fontWeight: 600, whiteSpace: "nowrap" }}>{money(vat)}</td>
                  </tr>
                </>
              )}
              <tr style={{ background: "#fff", fontWeight: 800 }}>
                <td colSpan={5} style={{ ...cell, textAlign: "right", fontSize: 12, border: "2px solid #000" }}>รวมยอดลดหนี้</td>
                <td style={{ ...cell, textAlign: "right", fontFamily: "monospace", fontSize: 14, border: "2px solid #000", whiteSpace: "nowrap" }}>{money(grand)}</td>
              </tr>
            </tfoot>
          </table>

          <div style={{ fontSize: 9, marginBottom: 10, lineHeight: 1.7 }}>
            ยอดนี้จะถูกนำไปหักออกจากใบวางบิลงวดถัดไปของท่าน
            {ret.appliedStatementNo ? ` (หักแล้วในใบวางบิล ${ret.appliedStatementNo})` : ""}
          </div>

          {/* ── ลายเซ็น ── */}
          <div style={{ display: "flex", gap: 20, marginTop: 26, paddingTop: 10, borderTop: "1px solid #000" }}>
            {["ผู้จัดทำ", "ผู้ตรวจสอบ", "ผู้รับใบลดหนี้"].map((l, i) => (
              <div key={i} style={{ flex: 1, textAlign: "center" }}>
                <div style={{ borderTop: "1px solid #000", marginBottom: 4 }} />
                <div style={{ fontSize: 10, fontWeight: 600 }}>{l}</div>
                <div style={{ fontSize: 9, marginTop: 3 }}>วันที่ ....../....../..........</div>
              </div>
            ))}
          </div>

          <div style={{ fontSize: 8, textAlign: "right", marginTop: 8 }}>
            เลขที่ <b style={{ fontFamily: "monospace" }}>{docNo}</b> · {ret.customerName || ""} · {(ret.checkedAt || ret.receivedAt || "").split(" ")[0]}
          </div>
        </div>
        </div>

        {/* ── ปุ่ม (ไม่พิมพ์) ── */}
        <div className="no-print" style={{ display: "flex", gap: 8, justifyContent: "flex-end", padding: "12px 16px", borderTop: "1px solid #e3e8ef", flexWrap: "wrap" }}>
          <button onClick={onClose}
            style={{ padding: "9px 16px", borderRadius: 9, border: "1px solid #e3e8ef", background: "white", color: "#5b6b85", fontSize: 13, cursor: "pointer", fontFamily: "'Sarabun',sans-serif" }}>ปิด</button>
          <button onClick={() => printElementById("creditnote-print-area", "A5 portrait", "8mm", INVOICE_FONT_SCALE, "0mm", "0mm")}
            style={{ padding: "9px 16px", borderRadius: 9, border: "1px solid rgba(59,91,139,0.35)", background: "white", color: "#3b5b8b", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "'Sarabun',sans-serif" }}>🖨️ พิมพ์ (A5)</button>
          <button onClick={() => printElementById("creditnote-print-area", "A4 portrait", "4mm", INVOICE_FONT_SCALE, INVOICE_MARGIN_TOP, INVOICE_MARGIN_BOTTOM)}
            style={{ padding: "9px 16px", borderRadius: 9, border: "none", background: "linear-gradient(135deg,#3b5b8b,#3b5b8b)", color: "white", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "'Sarabun',sans-serif", boxShadow: "0 4px 14px rgba(59,91,139,0.3)" }}>🖨️ พิมพ์ (A4)</button>
        </div>
      </div>
    </div>
  );
}
