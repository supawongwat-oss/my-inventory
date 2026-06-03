# 🗺️ CPU ERP — Roadmap

> รายการฟีเจอร์ที่จะพัฒนาต่อในระบบ
> เป็นแค่ feature list — เมื่อจะหยิบมาทำจริง ค่อย plan รายละเอียดเฉพาะอันนั้น

**Last updated:** 2026-06-03

---

## Context

- ระบบ deploy production แล้วบน Vercel ทั้ง 2 projects (cpuerp + boongerp)
- ใช้ Firestore แบบเปิด (rules = open) — ยังไม่ได้ lock เพราะอยู่ในช่วงทดสอบ
- ยังไม่เปิดให้พนักงานใช้จริง
- ไม่มี deadline เร่ง

---

## ✅ เสร็จแล้ว

### 2026-06-03 (วันนี้)
- ✅ **Auto Backup** (in-app JSON + Excel + GitHub Actions daily) — มี history 60 วัน
- ✅ **ใบวางบิลรวมเดือน (Statement)** — รวมยอดลูกค้าเป็นช่วงเวลา
- ✅ **Excel Import — ลูกค้า** (drag-drop, auto-detect columns, dedupe)
- ✅ **Session timeout** — 8h inactivity + 16h hard expiry + "จำฉันไว้" 30 วัน
- ✅ **Persistent login** — ไม่หลุดตอน refresh
- ✅ **Case-insensitive search** ทุกที่
- ✅ **Print fix** — iframe approach, multi-page A4
- ✅ **Per-size pricing** — เสื้อผ้าตั้งราคาตามกลุ่มไซส์ (6-12 / S-XL / 2XL / 3XL / 4XL / 5XL)
- ✅ **Modal ไม่ปิดเวลาคลิกข้างนอก** — ข้อมูลไม่หาย

### 2026-06-02 (วันแรก deploy)
- ✅ Initial deploy ทั้ง 2 projects (cpuerp + boongerp)
- ✅ Refactor App.js แยก modules
- ✅ Reports tab, Suppliers tab
- ✅ Payment tracking on invoices

---

## 🔴 ลำดับ 1: สำคัญมาก (ทำก่อนเปิดใช้งานจริงกับพนักงาน)

### 📝 Audit Log
บันทึก **"ใครทำอะไรเมื่อไหร่"**
- ลบบิล / แก้ราคา / เพิ่ม-ลบลูกค้า / เปลี่ยนสิทธิ์ผู้ใช้ ฯลฯ
- สำคัญตอนมีพนักงานหลายคน — ตามรอยปัญหาได้
- เก็บใน collection `auditLog`: `{action, userId, timestamp, targetCollection, targetId, before, after}`
- มีหน้า view + filter ตามผู้ใช้/วันที่/action

### 🔒 Firestore Security Rules + Firebase Auth
- ปัจจุบันเปิดให้ใครก็เข้า DB ได้ (ถ้ารู้ config)
- เคยลองทำ Anonymous Auth → เจอ race condition → roll back
- รอบหน้าต้องใช้ **Firebase Auth เต็มรูปแบบ** เท่านั้น:
  - Email/password (replace plain text)
  - Password hash + reset email
  - Token auto-refresh เสถียร
  - Migration script: ย้าย user เก่าเข้า Firebase Auth + map กับ Firestore user doc

---

## 🟡 ลำดับ 2: มีประโยชน์มาก (ทำหลังเปิดใช้งาน)

### 📥 Import Excel — ตัวอื่นๆ
ตอนนี้มีแล้ว: ลูกค้า ✅
ที่จะเพิ่ม (ใช้ pattern เดียวกับ ImportCustomersModal.js):
- **Products** (สินค้าทั่วไป) bulk upload
- **Clothing** (เสื้อผ้า รุ่น+สี+ไซส์+ราคา) — complex schema
- **Suppliers**
- **บิลเก่า migration** — สำหรับย้ายข้อมูลจากระบบเก่ามา

### 📸 Camera Barcode Scanner
- ตอนนี้แค่แสดงรูป barcode (visual only)
- จะเพิ่ม: สแกนผ่านกล้องมือถือ/Webcam จริงๆ
- ใช้ library: `@zxing/library` หรือ `quagga2`
- รองรับ EAN-13, Code 128, QR code
- ใช้งานในหน้า "สแกนบาร์โค้ด" และในใบสั่งของ

### 📊 รายงานเชิงลึก
- **Aging report** — บิลค้างกี่วัน 0-30, 31-60, 60+ days
- **ยอดขายต่อลูกค้า** ราย เดือน/ปี
- **ยอดขายต่อสินค้า** ดูสินค้า hot/slow-moving
- **กราฟ trend** ยอดขายย้อนหลัง
- **Profit margin** ต่อรุ่น/สี
- **VAT report** สรุปภาษีรายเดือน

### 🔔 แจ้งเตือนผ่าน LINE
- ออกบิลแล้วส่งให้ลูกค้าทาง LINE Notify หรือ LINE OA
- พนักงานเตือนตอนสต็อกต่ำกว่าขั้นต่ำ
- เตือนเมื่อมีใบสั่งของใหม่
- ใช้ LINE Notify token หรือ LINE Messaging API

### 🏦 PromptPay QR ในบิล
- Generate QR PromptPay (เลขบัญชี + ยอดเงิน) บนบิล
- ลูกค้าสแกนจ่ายในมือถือได้เลย
- ไม่ต้องพิมพ์เลขบัญชี
- ใช้ library: `promptpay-qr`
- ใส่ใน print template ของ Invoice + Statement

---

## 🟢 ลำดับ 3: น่าสนใจ (เสริม UX)

### 📱 PWA — ติดตั้งบนมือถือ
- เพิ่ม `manifest.json` + `service-worker.js`
- แตะ "Add to Home Screen" → ใช้เหมือนแอป native
- Offline-capable (cache UI, queue writes ตอน offline)

### หัก ณ ที่จ่าย 3%
- เพิ่ม field "หัก ณ ที่จ่าย" ในบิล
- คำนวณยอดสุทธิอัตโนมัติ
- แสดงในใบกำกับภาษี
- จำเป็นสำหรับลูกค้าที่เป็นนิติบุคคล

### 📎 แนบไฟล์/รูปภาพ
- รูปภาพสินค้า (preview, ขนาดเล็ก/ใหญ่)
- แนบ slip โอนเงินบนบิล (proof of payment)
- แนบ design file ในใบสั่งของ (สำหรับสกรีน/ปัก)
- ใช้ Firebase Storage

### 🎨 Dark mode toggle
- สลับโทนสว่าง/มืดได้
- เก็บ preference ใน localStorage
- มี theme constants ใน `src/theme.js` อยู่แล้ว — แค่ทำ alternate set

### 📦 Stocktake (เช็คสต็อก)
- หน้านับสต็อกประจำเดือน
- พนักงานนับ → กรอกในระบบ
- เทียบกับยอดในระบบ → adjust ที่ขาด/เกิน
- เก็บประวัติการนับ (ใครนับ เมื่อไหร่)

### 👤 หน้า Profile ลูกค้า
- คลิกชื่อลูกค้า → เห็น:
  - ประวัติบิลทั้งหมด
  - ยอดค้างชำระรวม
  - statement ที่ออกแล้ว
  - กราฟยอดซื้อย้อนหลัง

### 🏷️ Coupon / Discount codes
- สร้างโค้ดส่วนลด (% หรือ บาท)
- ลูกค้าเก่าได้ส่วนลดอัตโนมัติ
- โปรโมชั่นเทศกาล (ช่วงเวลาที่ใช้ได้)
- จำกัดจำนวนครั้งใช้

---

## 🎯 ลำดับแนะนำ (Update 2026-06-03)

| # | ฟีเจอร์ | สถานะ | เหตุผล |
|---|---|---|---|
| 1 | 💾 Auto Backup | ✅ **เสร็จ** | เริ่มเก็บ backup ตั้งแต่วันแรก กันเสียดาย |
| 2 | 📝 Audit Log | ⏳ ถัดไป | ก่อนเปิดให้พนักงาน — รู้ใครทำอะไร |
| 3 | 🔒 Firebase Auth | ⏳ | lock production ก่อนเปิดใช้จริง |
| 4 | 📥 Import Products | ⏳ | ถ้ามีสินค้าเยอะ ใส่ทีเดียวจบ |
| 5 | 📊 Aging Report | ⏳ | ดู cashflow ได้ — สำคัญต่อธุรกิจ |
| 6 | 🏦 PromptPay QR | ⏳ | UX ดีขึ้นมากสำหรับลูกค้า |
| 7 | 📸 Camera Barcode | ⏳ | ใช้งานจริงในโกดัง |
| ... | (ที่เหลือ) | ⏳ | ค่อยทำตามความต้องการ |

---

## หมายเหตุ

- รายการนี้เป็น **roadmap ไม่ใช่ commitment**
- พอจะหยิบมาทำจริง ค่อย plan รายละเอียดอีกที (Context + Decisions + Implementation)
- ผู้ใช้บอก "ยังไม่ได้ใช้จริง แค่ทดลองระบบก่อน" → ไม่มี deadline เร่ง
- ลำดับเปลี่ยนได้ตามความต้องการ business

---

## 💡 หลักการเลือกฟีเจอร์ทำต่อ

**ก่อนเปิดให้พนักงานใช้จริง:**
- ลำดับ 1-3 (Backup ✅ / Audit Log / Firebase Auth) ต้องเสร็จก่อน
- เพราะเกี่ยวกับ data safety + accountability + security

**หลังเปิดใช้:**
- เลือกตามความเจ็บปวด — อะไรเสียเวลาเยอะสุด ทำก่อน
- เช่น ถ้าพนักงานต้องสแกน barcode บ่อย → ทำ Camera Scanner ก่อน
- ถ้าลูกค้าค้างหนี้เยอะ → ทำ Aging Report ก่อน

**Long-term (1-3 เดือน):**
- LINE / PromptPay → ระบบครบ end-to-end
- PWA → ใช้บนมือถือเหมือน native app
- Profile ลูกค้า → CRM mindset
