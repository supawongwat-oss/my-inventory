// 🔗 ซ่อมบิลที่ไม่ได้ผูกกับทะเบียนลูกค้า
//
// ปัญหา: ก่อน 23 ส.ค. 2026 ช่องชื่อลูกค้าในบิลพิมพ์ลอย ๆ ได้ เดือน ส.ค. เดือนเดียว
// จึงมีบิล 25 ใบ (฿458,060) ที่ไม่ผูกทะเบียน ผลคือ
//   · ใบวางบิลเอาที่อยู่จากทะเบียนไม่ได้ — 24 ใบไม่มีที่อยู่เลย พิมพ์ออกมาว่าง ๆ
//   · ร้านเดียวถูกแยกเป็น 2 ใบวางบิล เพราะพิมพ์ชื่อคนละแบบ
//     ("สุขสันต์เซลล์" กับ "สุขสันต์เซล์" ต่างกันตัว ล ตัวเดียว)
//
// เครื่องมือนี้จับบิลที่ชื่อพิมพ์เหมือนกันมารวมเป็นกอง แล้วผูกทั้งกองทีเดียว
//
// 🔒 แก้แค่ customerId — ชื่อบนบิลไม่ขยับ
//    บิลที่ออกไปแล้วลูกค้าถือกระดาษอยู่ ชื่อที่พิมพ์ไปแล้วต้องคงเดิม
//    (ใบวางบิลจะขึ้นป้าย ⚠️ ว่าชื่อในบิลไม่ตรง ซึ่งถูกแล้ว — มันเป็นเรื่องจริง)
import { useState, useMemo } from "react";
import { writeBatch, doc } from "firebase/firestore";
import { db } from "../firebase";
import { Modal, MHead, BtnGhost } from "./ui";
import { T } from "../theme";
import { custKey } from "../utils/statement";
import { matchTokens } from "../utils/search";
import { logAudit, AUDIT_ACTIONS } from "../utils/audit";

const fmtB = (n) => Number(n || 0).toLocaleString("th-TH", { minimumFractionDigits: 2 });

export default function LinkInvoiceCustomers({ invoices = [], customers = [], user, onClose }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(() => new Set()); // ชื่อที่ผูกไปแล้วในรอบนี้
  const [terms, setTerms] = useState({});            // ชื่อ → คำค้นในช่องค้นหา

  // จับบิลที่ไม่ผูกทะเบียนมารวมเป็นกองตามชื่อที่พิมพ์
  const groups = useMemo(() => {
    const m = new Map();
    invoices.forEach(inv => {
      if (inv.customerId) return;
      if (inv.mergedInto || inv.convertedTo) return;
      const nm = (inv.customerName || "").trim();
      if (!nm) return;
      const g = m.get(nm) || { name: nm, invs: [] };
      g.invs.push(inv);
      m.set(nm, g);
    });
    return [...m.values()]
      .map(g => ({ ...g, total: g.invs.reduce((s, i) => s + (Number(i.total) || 0), 0) }))
      .sort((a, b) => b.total - a.total);
  }, [invoices]);

  // ลูกค้าที่น่าจะใช่ — ชื่อใกล้เคียง หรือเบอร์ตรงกับที่อยู่ในบิล
  const suggestFor = (g) => {
    const k = custKey(g.name);
    const phones = new Set(g.invs.map(i => (i.customerPhone || "").replace(/\D/g, "")).filter(p => p.length >= 9));
    return customers.filter(c => {
      const ck = custKey(c.name);
      if (ck && k && (ck === k || ck.includes(k) || k.includes(ck))) return true;
      const cp = (c.phone || "").replace(/\D/g, "");
      return cp.length >= 9 && phones.has(cp);
    }).slice(0, 4);
  };

  const link = async (g, c) => {
    if (busy) return;
    if (!window.confirm(
      `ผูกบิล ${g.invs.length} ใบ (฿${fmtB(g.total)}) ของ "${g.name}"${String.fromCharCode(10)}` +
      `เข้ากับลูกค้าในทะเบียน "${c.name}"?${String.fromCharCode(10,10)}` +
      `ชื่อที่พิมพ์บนบิลจะไม่เปลี่ยน — แก้แค่การผูก` + String.fromCharCode(10) +
      `ผลคือใบวางบิลจะรวมบิลพวกนี้เข้ากับ "${c.name}" และใช้ที่อยู่จากทะเบียน`
    )) return;
    setBusy(true);
    try {
      for (let i = 0; i < g.invs.length; i += 400) {
        const b = writeBatch(db);
        g.invs.slice(i, i + 400).forEach(inv => b.update(doc(db, "invoices", inv.id), { customerId: c.id }));
        await b.commit();
      }
      logAudit(user, {
        action: AUDIT_ACTIONS.UPDATE, collection: "invoices", targetId: c.id,
        targetLabel: `ผูกบิลเข้าทะเบียน ${c.name}`,
        note: `${g.invs.length} ใบ · ชื่อในบิล "${g.name}" · ฿${fmtB(g.total)}`,
      });
      setDone(prev => new Set(prev).add(g.name));
    } catch (e) {
      alert("ผูกไม่สำเร็จ: " + (e?.message || e));
    }
    setBusy(false);
  };

  const left = groups.filter(g => !done.has(g.name));
  const leftTotal = left.reduce((s, g) => s + g.total, 0);
  const leftInvs = left.reduce((s, g) => s + g.invs.length, 0);

  return (
    <Modal onClose={onClose} w={760}>
      <MHead title="🔗 บิลที่ยังไม่ผูกทะเบียนลูกค้า"
        sub="ผูกแล้วใบวางบิลจะรวมให้ถูกร้าน และดึงที่อยู่จากทะเบียนมาพิมพ์ได้" onClose={onClose} color={T.amber}/>

      <div style={{ padding: "9px 13px", marginBottom: 12, background: "rgba(59,91,139,0.06)", border: `1px solid ${T.border}`, borderRadius: 9, fontSize: 11, color: T.sub, lineHeight: 1.7 }}>
        เหลือ <b style={{ color: T.text }}>{left.length}</b> ชื่อ · <b style={{ color: T.text }}>{leftInvs}</b> บิล · ฿{fmtB(leftTotal)}
        <br/>ดูเฉพาะบิลในช่วงที่โหลดมา — ถ้าจะซ่อมย้อนหลังมากกว่านี้ ให้ขยายช่วงวันที่ที่แถบด้านบนก่อน
        <br/>🔒 แก้แค่การผูก ชื่อที่พิมพ์บนบิลคงเดิม (บิลออกไปแล้ว ลูกค้าถือกระดาษอยู่)
      </div>

      {left.length === 0 ? (
        <div style={{ padding: 40, textAlign: "center", color: T.muted, fontSize: 13 }}>
          <div style={{ fontSize: 40, marginBottom: 8, opacity: 0.3 }}>✅</div>
          บิลในช่วงนี้ผูกทะเบียนครบแล้ว
        </div>
      ) : (
        <div className="scroll-col" style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: "52vh", overflowY: "auto", marginBottom: 12 }}>
          {left.map(g => {
            const sug = suggestFor(g);
            const term = terms[g.name] || "";
            const hits = term.trim()
              ? customers.filter(c => matchTokens(term, c.name, c.phone, c.address, c.taxId)).slice(0, 6)
              : [];
            return (
              <div key={g.name} style={{ padding: 12, border: `1px solid ${T.border}`, borderRadius: 10, background: "white" }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>{g.name}</span>
                  <span style={{ fontSize: 11, color: T.muted }}>
                    {g.invs.length} บิล · {g.invs.map(i => i.invoiceNo).slice(0, 3).join(", ")}{g.invs.length > 3 ? ` +อีก ${g.invs.length - 3}` : ""}
                  </span>
                  <span style={{ marginLeft: "auto", fontFamily: "monospace", fontWeight: 700, color: T.green, fontSize: 13 }}>฿{fmtB(g.total)}</span>
                </div>

                {sug.length > 0 && (
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 10, color: T.muted, fontWeight: 700, marginBottom: 4 }}>น่าจะเป็นรายนี้</div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {sug.map(c => (
                        <button key={c.id} type="button" disabled={busy} onClick={() => link(g, c)}
                          style={{ padding: "6px 12px", borderRadius: 8, border: `1px solid ${T.green}`, background: "rgba(58,122,82,0.08)",
                            color: T.text, cursor: busy ? "wait" : "pointer", fontSize: 12, fontFamily: "inherit", textAlign: "left" }}>
                          🔗 {c.name}
                          <span style={{ color: T.muted, fontSize: 10 }}>{c.phone ? ` · ${c.phone}` : ""}{c.address ? " · มีที่อยู่" : " · ไม่มีที่อยู่"}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <input value={term} onChange={e => setTerms(p => ({ ...p, [g.name]: e.target.value }))}
                  placeholder="🔍 ค้นทะเบียนเอง — ชื่อ / เบอร์ / ที่อยู่"
                  style={{ width: "100%", boxSizing: "border-box", padding: "7px 11px", borderRadius: 8, border: `1px solid ${T.border}`, fontSize: 12, fontFamily: "inherit", outline: "none" }}/>
                {hits.length > 0 && (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                    {hits.map(c => (
                      <button key={c.id} type="button" disabled={busy} onClick={() => link(g, c)}
                        style={{ padding: "5px 11px", borderRadius: 8, border: `1px solid ${T.border}`, background: "white",
                          color: T.sub, cursor: busy ? "wait" : "pointer", fontSize: 12, fontFamily: "inherit" }}>
                        🔗 {c.name}{c.phone ? ` · ${c.phone}` : ""}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <BtnGhost onClick={onClose} style={{ width: "100%" }}>ปิด</BtnGhost>
    </Modal>
  );
}
