// 📦↩️ ใบรับคืนสินค้า — หลักฐาน "ได้รับของแล้ว" ไม่ใช่หลักฐานทางบัญชี
//
// ทำไมต้องมีแยกจากใบลดหนี้:
//   ใบลดหนี้ออกได้ต่อเมื่อ "จับคู่บิลแล้ว + คืนเป็นเงินสด" เท่านั้น
//   แต่เคสหลักของร้านคือลูกค้าต่างจังหวัดส่งพัสดุคืนมาโดยไม่มีบิลมาด้วย
//   ใบรับคืนจึงค้างอยู่ที่ "รอจับคู่บิล" หลายวัน — ช่วงนั้นของอยู่ในร้านแล้ว
//   แต่ไม่มีกระดาษอะไรผูกกับตัวของเลย
//
//   ปัญหาที่ตามมา: ของกองรวมกันจนไม่รู้ว่าของใคร · เถียงกันเรื่องจำนวนที่ส่งมา ·
//   ตามไม่ได้ว่าใครเป็นคนแกะกล่อง
//
// 🔒 ไม่แสดงราคาถ้ายังไม่จับคู่บิล — ยังไม่รู้ราคาจริง ใส่ไปก็คือเดา
//    (หลักเดียวกับที่ตัวอ่านใบปะหน้าไม่เดาจำนวน)
//    จับคู่บิลแล้วค่อยมีราคาและเลขบิลต้นทางขึ้นให้
import React from "react";
import { INVOICE_FONT_SCALE, INVOICE_MARGIN_TOP, INVOICE_MARGIN_BOTTOM, INVOICE_PAD_TOP, INVOICE_PAD_BOTTOM } from "../utils/print";

const money = (n) => Number(n || 0).toLocaleString("th-TH", { minimumFractionDigits: 2 });

export default function PrintReturnSlipModal({
  ret,                  // ใบรับคืน — ใช้ได้ทุกสถานะ ไม่ต้องรอจับคู่บิล
  companyInfo = {},
  onClose,
  printElementById,
}) {
  if (!ret) return null;

  const items = (ret.items || []).filter(i => Number(i.qty) > 0);
  const totalQty = items.reduce((s, i) => s + (Number(i.qty) || 0), 0);
  // มีราคาให้แสดงเฉพาะตอนจับคู่บิลแล้ว
  const priced = (ret.status || "") === "จับคู่แล้ว" && Number(ret.creditTotal) > 0;
  const cell = { border: "1px solid #000", padding: "5px 7px", fontSize: 11 };

  return (
    <div className="print-modal-overlay"
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 500, backdropFilter: "blur(6px)" }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="print-modal-card" onMouseDown={e => e.stopPropagation()}
        style={{ background: "white", borderRadius: 16, width: "min(96vw, 794px)", maxHeight: "94vh", overflow: "auto", boxShadow: "0 24px 60px rgba(0,0,0,0.7)" }}>

        <div style={{ padding: INVOICE_MARGIN_TOP + " 0" }}>
        <div id="returnslip-print-area"
          style={{ padding: `${INVOICE_PAD_TOP} 2.5mm ${INVOICE_PAD_BOTTOM}`, fontFamily: "'Sarabun',sans-serif", color: "#000", boxSizing: "border-box" }}>

          {/* ── หัวเอกสาร ── */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8, paddingBottom: 6, borderBottom: "2px solid #000" }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: 1.5 }}>{companyInfo?.name || "CPU"}</div>
            </div>
            <div style={{ textAlign: "right", minWidth: 190 }}>
              <div style={{ display: "inline-block", padding: "4px 16px", borderRadius: 4, fontSize: 15, fontWeight: 800, marginBottom: 6, letterSpacing: 1, border: "2px solid #000", whiteSpace: "nowrap" }}>
                ใบรับคืนสินค้า
              </div>
              <div style={{ fontSize: 9, marginBottom: 5, letterSpacing: 0.5 }}>GOODS RETURN RECEIPT</div>
              <div style={{ fontSize: 11 }}>เลขที่ <b style={{ fontFamily: "monospace" }}>{ret.returnNo || "-"}</b></div>
              <div style={{ fontSize: 11 }}>วันที่รับ {ret.receivedAt || "-"}</div>
            </div>
          </div>

          {/* ── ผู้ส่งคืน + ข้อมูลพัสดุ ── */}
          <div style={{ display: "flex", gap: 10, marginBottom: 8 }}>
            <div style={{ flex: 1, border: "1px solid #000", padding: "6px 8px" }}>
              <div style={{ fontSize: 9, fontWeight: 700, marginBottom: 2 }}>ผู้ส่งคืน</div>
              <div style={{ fontSize: 12, fontWeight: 700 }}>{ret.customerName || "— ไม่ทราบผู้ส่ง —"}</div>
              {ret.customerPhone && <div style={{ fontSize: 10 }}>โทร {ret.customerPhone}</div>}
            </div>
            <div style={{ flex: 1, border: "1px solid #000", padding: "6px 8px" }}>
              <div style={{ fontSize: 9, fontWeight: 700, marginBottom: 2 }}>พัสดุ / เหตุผลที่คืน</div>
              <div style={{ fontSize: 11 }}>เลขพัสดุ: <b style={{ fontFamily: "monospace" }}>{ret.trackingNo || "-"}</b></div>
              <div style={{ fontSize: 11 }}>เหตุผล: {ret.reason || "-"}</div>
            </div>
          </div>

          {/* บิลต้นทาง — มีเฉพาะที่จับคู่แล้ว ยังไม่จับคู่ต้องบอกให้ชัดว่ายังไม่รู้ */}
          <div style={{ border: "1px solid #000", padding: "5px 8px", marginBottom: 8, fontSize: 11 }}>
            {ret.invoiceNo
              ? <>บิลต้นทาง: <b style={{ fontFamily: "monospace" }}>{ret.invoiceNo}</b></>
              : <b>ยังไม่ได้จับคู่บิลต้นทาง — ใบนี้เป็นหลักฐานการรับของเท่านั้น ยังไม่ใช่การลดหนี้</b>}
          </div>

          {/* ── รายการที่รับคืน ── */}
          <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 8 }}>
            <thead>
              <tr style={{ background: "#eee" }}>
                <th style={{ ...cell, width: 28, textAlign: "center" }}>#</th>
                <th style={{ ...cell, textAlign: "left" }}>รายการ</th>
                <th style={{ ...cell, width: 62, textAlign: "center" }}>สี</th>
                <th style={{ ...cell, width: 48, textAlign: "center" }}>ไซส์</th>
                <th style={{ ...cell, width: 52, textAlign: "center" }}>จำนวน</th>
                {priced && <th style={{ ...cell, width: 72, textAlign: "right" }}>ราคา/หน่วย</th>}
                {priced && <th style={{ ...cell, width: 78, textAlign: "right" }}>รวม</th>}
                {/* ช่องติ๊กตอนนับของจริง — ใบนี้ต้องใช้งานได้ตอนยืนมือถือของอยู่ */}
                <th style={{ ...cell, width: 40, textAlign: "center" }}>ตรวจ</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={i}>
                  <td style={{ ...cell, textAlign: "center" }}>{i + 1}</td>
                  <td style={cell}>{it.clothingName || it.description || "-"}</td>
                  <td style={{ ...cell, textAlign: "center" }}>{it.colorName || "-"}</td>
                  <td style={{ ...cell, textAlign: "center", fontFamily: "monospace", fontWeight: 700 }}>{it.size || "-"}</td>
                  <td style={{ ...cell, textAlign: "center", fontFamily: "monospace", fontWeight: 700, fontSize: 12 }}>{it.qty}</td>
                  {priced && <td style={{ ...cell, textAlign: "right", fontFamily: "monospace" }}>{money(it.unitPrice)}</td>}
                  {priced && <td style={{ ...cell, textAlign: "right", fontFamily: "monospace" }}>{money((Number(it.qty) || 0) * (Number(it.unitPrice) || 0))}</td>}
                  <td style={{ ...cell }} />
                </tr>
              ))}
              <tr style={{ background: "#f1f5f9" }}>
                <td style={{ ...cell, textAlign: "right", fontWeight: 700 }} colSpan={4}>รวมที่รับคืน</td>
                <td style={{ ...cell, textAlign: "center", fontFamily: "monospace", fontWeight: 800, fontSize: 13 }}>{totalQty}</td>
                {priced && <td style={{ ...cell }} />}
                {priced && <td style={{ ...cell, textAlign: "right", fontFamily: "monospace", fontWeight: 800 }}>{money(ret.creditTotal)}</td>}
                <td style={{ ...cell }} />
              </tr>
            </tbody>
          </table>

          {ret.note && (
            <div style={{ border: "1px solid #000", padding: "5px 8px", marginBottom: 8, fontSize: 11 }}>
              หมายเหตุ: {ret.note}
            </div>
          )}

          <div style={{ fontSize: 10, marginBottom: 4 }}>
            สภาพสินค้า: {ret.qcStatus || "รอตรวจ"}
            {ret.receivedBy ? ` · ผู้รับของ ${ret.receivedBy}` : ""}
          </div>

          {/* ── ลายเซ็น ── */}
          <div style={{ display: "flex", gap: 20, marginTop: 22, paddingTop: 10, borderTop: "1px solid #000" }}>
            {["ผู้รับของ / แกะพัสดุ", "ผู้ตรวจนับ"].map((l, i) => (
              <div key={i} style={{ flex: 1, textAlign: "center" }}>
                <div style={{ borderTop: "1px solid #000", marginBottom: 4 }} />
                <div style={{ fontSize: 10, fontWeight: 600 }}>{l}</div>
                <div style={{ fontSize: 9, marginTop: 3 }}>วันที่ ....../....../..........</div>
              </div>
            ))}
          </div>

          <div style={{ fontSize: 8, textAlign: "right", marginTop: 8 }}>
            {ret.returnNo || ""} · {ret.customerName || ""} · {(ret.receivedAt || "").split(" ")[0]}
          </div>
        </div>
        </div>

        {/* ── ปุ่ม (ไม่พิมพ์) ── */}
        <div className="no-print" style={{ display: "flex", gap: 8, justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderTop: "1px solid #e3e8ef", flexWrap: "wrap" }}>
          <div style={{ fontSize: 11, color: "#5b6b85" }}>
            พิมพ์ 2 ใบ — ใบหนึ่งใส่ไว้กับของที่คืนมา อีกใบถ่ายรูปส่งให้ลูกค้า
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={onClose}
              style={{ padding: "9px 16px", borderRadius: 9, border: "1px solid #e3e8ef", background: "white", color: "#5b6b85", fontSize: 13, cursor: "pointer", fontFamily: "'Sarabun',sans-serif" }}>ปิด</button>
            <button onClick={() => printElementById("returnslip-print-area", "A5 portrait", "8mm", INVOICE_FONT_SCALE, "0mm", "0mm")}
              style={{ padding: "9px 16px", borderRadius: 9, border: "1px solid rgba(59,91,139,0.35)", background: "white", color: "#3b5b8b", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "'Sarabun',sans-serif" }}>🖨️ พิมพ์ (A5)</button>
            <button onClick={() => printElementById("returnslip-print-area", "A4 portrait", "4mm", INVOICE_FONT_SCALE, INVOICE_MARGIN_TOP, INVOICE_MARGIN_BOTTOM)}
              style={{ padding: "9px 16px", borderRadius: 9, border: "none", background: "linear-gradient(135deg,#3b5b8b,#3b5b8b)", color: "white", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "'Sarabun',sans-serif", boxShadow: "0 4px 14px rgba(59,91,139,0.3)" }}>🖨️ พิมพ์ (A4)</button>
          </div>
        </div>
      </div>
    </div>
  );
}
