// 🤖 Telegram Notification helper
// Config เก็บใน Firestore: settings/telegram = { botToken, chatId, enabled, events:{...} }
//
// วิธี setup (5 นาที):
//   1. เปิด Telegram → search "@BotFather"
//   2. /newbot → ตั้งชื่อ bot → ได้ Bot Token
//   3. ไปคุยกับ bot ที่สร้าง (อย่างน้อย 1 ข้อความ "/start")
//   4. เปิด https://api.telegram.org/bot<TOKEN>/getUpdates ใน browser
//   5. หา "chat":{"id":NNNN — นั่นคือ chatId
//   6. กลับมาแอป → ⚙️ ตั้งค่า → 🔔 แจ้งเตือน → ใส่ Token + Chat ID → ทดสอบ

import { doc, setDoc } from "firebase/firestore";
import { db } from "../firebase";

export const TELEGRAM_EVENTS = {
  stockLow:     { label: "🔔 สต็อกต่ำกว่าขั้นต่ำ",   default: true  },
  newOrder:     { label: "📋 ใบสั่งของใหม่",         default: true  },
  newInvoice:   { label: "🧾 ใบบิลใหม่",             default: true  },
  payment:      { label: "💰 ลูกค้าชำระเงิน",         default: true  },
  audit:        { label: "🚨 Action สำคัญ (ลบบิล)",  default: false },
  dailyReport:  { label: "📊 สรุปประจำวัน (manual)",  default: false },
};

/**
 * ส่งข้อความ Telegram
 * @param {object} config - { botToken, chatId, enabled, events }
 * @param {string} eventKey - key ใน TELEGRAM_EVENTS (เช่น "newOrder")
 * @param {string} message - HTML-formatted message
 */
export async function sendTelegram(config, eventKey, message) {
  if (!config || !config.enabled || !config.botToken || !config.chatId) return { ok: false, reason: "ไม่ได้ตั้งค่าหรือปิดอยู่" };
  // เช็คว่า event นี้เปิดอยู่ไหม
  if (eventKey && config.events && config.events[eventKey] === false) return { ok: false, reason: "event ปิดอยู่" };

  try {
    const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: config.chatId,
        text: message,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
    const data = await res.json();
    if (!data.ok) return { ok: false, reason: data.description || "Telegram API error" };
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e.message || String(e) };
  }
}

// บันทึก config ลง Firestore
export async function saveTelegramConfig(config) {
  await setDoc(doc(db, "settings", "telegram"), {
    botToken: config.botToken || "",
    chatId: config.chatId || "",
    enabled: !!config.enabled,
    events: config.events || {},
    updatedAt: new Date().toISOString(),
  });
}

// ─────────── Message builders ───────────
const esc = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const msgNewOrder = (order) => {
  const totalQty = (order.items || []).reduce((s, i) => s + (i.qty || 0), 0);
  return `📋 <b>ใบสั่งของใหม่</b>
${esc(order.orderNo)}
👤 ลูกค้า: <b>${esc(order.customerName)}</b>
📦 ${(order.items || []).length} รายการ · ${totalQty} ชิ้น
👨‍💼 โดย: ${esc(order.by)}
🕐 ${esc(order.date)}`;
};

export const msgNewInvoice = (inv, docTypeLabel) => `🧾 <b>${esc(docTypeLabel(inv.docType))}ใหม่</b>
${esc(inv.invoiceNo)}
👤 ลูกค้า: <b>${esc(inv.customerName)}</b>
💵 ยอดรวม: <b>฿${Number(inv.total || 0).toLocaleString("th-TH", { minimumFractionDigits: 2 })}</b>${inv.useVat ? ` (รวม VAT)` : ""}
👨‍💼 โดย: ${esc(inv.by)}
🕐 ${esc(inv.date)}`;

export const msgPayment = (inv) => `💰 <b>ลูกค้าชำระเงินแล้ว</b>
🧾 ${esc(inv.invoiceNo)}
👤 ${esc(inv.customerName)}
💵 <b>฿${Number(inv.total || 0).toLocaleString("th-TH", { minimumFractionDigits: 2 })}</b>`;

export const msgLowStock = (lowStockList) => {
  if (lowStockList.length === 0) return `✅ <b>สต็อกปกติทั้งหมด</b>\nไม่มีสินค้าต่ำกว่าขั้นต่ำ`;
  const top = lowStockList.slice(0, 15);
  const list = top.map(p => `• <b>${esc(p.name)}</b> — เหลือ <b>${p.qty}</b>/${p.minQty} ${esc(p.unit || "")}`).join("\n");
  const more = lowStockList.length > 15 ? `\n... และอีก ${lowStockList.length - 15} รายการ` : "";
  return `🔔 <b>สินค้าต่ำกว่าขั้นต่ำ ${lowStockList.length} รายการ</b>\n${list}${more}`;
};

export const msgAudit = (log, AUDIT_META) => {
  const meta = AUDIT_META?.[log.action] || { icon: "•", label: log.action };
  return `🚨 <b>Action สำคัญ</b>
${meta.icon} ${meta.label}
👤 ${esc(log.userName)} (${esc(log.userRole)})
📦 ${esc(log.targetLabel || log.targetId || "")}
${log.note ? `📝 ${esc(log.note)}` : ""}`;
};

export const msgDailyReport = ({ products, orders, invoices, transactions, lowStock }) => {
  const today = new Date();
  const todayStr = `${String(today.getDate()).padStart(2,"0")}/${String(today.getMonth()+1).padStart(2,"0")}/${today.getFullYear()}`;
  const todayPrefix = todayStr;

  // นับ activity วันนี้ (date string เริ่มด้วย DD/MM/YYYY)
  const todayOrders = orders.filter(o => (o.date || "").startsWith(todayPrefix));
  const todayInvoices = invoices.filter(i => (i.date || "").startsWith(todayPrefix));
  const todayTx = transactions.filter(t => (t.date || "").startsWith(todayPrefix));
  const todayRevenue = todayInvoices.reduce((s,i) => s + (Number(i.total)||0), 0);

  return `📊 <b>สรุปประจำวัน ${todayStr}</b>

📦 สินค้า: ${products.length} รายการ
${lowStock.length > 0 ? `🔔 สต็อกต่ำ: <b>${lowStock.length}</b> รายการ` : "✅ สต็อกปกติทั้งหมด"}

🆕 <b>วันนี้</b>
📋 ใบสั่งของ: ${todayOrders.length} ใบ
🧾 ใบบิล: ${todayInvoices.length} ใบ · ฿${todayRevenue.toLocaleString("th-TH", { minimumFractionDigits: 0 })}
🔄 รายการเคลื่อนไหว: ${todayTx.length} ครั้ง`;
};
