# 📘 CPU ERP — Project Notes

> สรุปการใช้งาน, deploy, และ workflow ของระบบ
> สำหรับเปิดอ่านจากเครื่องที่ทำงานหรือเครื่องอื่นๆ ได้

_Last updated: 2026-06-04_

---

## 🌿 Branch Strategy (ปัจจุบัน)

- **`master`** — production (cpuerp.vercel.app + boongerp.vercel.app)
- **dev branch ถูกลบไปแล้ว** — push ตรงเข้า master เลย เพราะยังเป็น test phase ไม่มีพนักงานใช้
- เมื่อเปิดให้พนักงานใช้จริง → ค่อยสร้าง dev branch กลับมา

---

## 🏗️ Architecture

```
GitHub repo: supawongwat-oss/my-inventory (master)
    │
    ├──→ Vercel Project A: cpuerp     → cpuerp.vercel.app     → Firebase: cpu-erp
    │                                   (fallback config ใน code)
    │
    └──→ Vercel Project B: boongerp   → boongerp.vercel.app   → Firebase: boong-private
                                        (env vars ที่ Vercel)
```

**1 codebase → 2 deployments → 2 databases** (data แยกกัน 100%, code เดียวกัน)

---

## 🌐 URLs

### Production (ใช้งานจริง)
- **บริษัท**: https://cpuerp.vercel.app ✅
- **ส่วนตัว**: https://boongerp.vercel.app ✅

### Local Dev
- http://localhost:3000

### Firebase Consoles
- บริษัท: https://console.firebase.google.com/project/cpu-erp
- ส่วนตัว: https://console.firebase.google.com/project/boong-private

### GitHub
- https://github.com/supawongwat-oss/my-inventory

### Vercel
- https://vercel.com → boong-s-projects1 team

---

## 🔑 Login Default

| Username | Password | Role |
|----------|----------|------|
| admin    | 1234     | ผู้ดูแลระบบ |
| manager  | 1234     | ผู้จัดการ |
| staff    | 1234     | พนักงาน |

> ⚠️ เปลี่ยนรหัสผ่านก่อนใช้งานจริง

### Session Behavior (ตั้งแต่ 2026-06-03)
- **ไม่ติ๊ก "จำฉันไว้":** inactivity 8 ชม. + hard expiry 16 ชม.
- **ติ๊ก "จำฉันไว้":** inactivity off + hard expiry 30 วัน
- เช็คทุก 30 วิ — auto logout เมื่อหมดอายุ

---

## ⚙️ Local Dev Setup

### ครั้งแรกบนเครื่องใหม่

```powershell
git clone https://github.com/supawongwat-oss/my-inventory.git
cd my-inventory
npm install
npm start
```

### สลับระหว่าง บริษัท / ส่วนตัว

**ใช้ บริษัท (cpu-erp):**
- ไม่ต้องมี `.env.local` (ใช้ fallback config ใน `src/firebase.js`)

**ใช้ ส่วนตัว (boong-private):**
- สร้าง `.env.local` ที่ root (gitignored)

```env
REACT_APP_FB_API_KEY=AIzaSyDBUv8Gglpslce4g789vZXYzd8Etpbsvtk
REACT_APP_FB_AUTH_DOMAIN=boong-private.firebaseapp.com
REACT_APP_FB_PROJECT_ID=boong-private
REACT_APP_FB_STORAGE_BUCKET=boong-private.firebasestorage.app
REACT_APP_FB_MESSAGING_SENDER_ID=185142803696
REACT_APP_FB_APP_ID=1:185142803696:web:6fa4b124e1a82a83e89635
REACT_APP_FB_MEASUREMENT_ID=G-NZCBV11EEN
```

**ตรวจสอบ:** F12 → Console จะเห็น
```
🔥 Firebase: cpu-erp        (ถ้าใช้บริษัท)
🔥 Firebase: boong-private  (ถ้าใช้ส่วนตัว)
```

⚠️ **ระวัง typo ใน env var names** — เคยพลาดที่ Vercel (`REACT_APP_FB_API_KE` ขาดตัว `Y`) แล้วใช้ไม่ได้ทั้ง project!

---

## 🚀 Deploy Workflow (ปัจจุบัน — ตรงสู่ master)

```powershell
git add .
git commit -m "..."
git push
```

→ Vercel auto build ทั้ง 2 projects → deploy production ภายใน 1-2 นาที

### ดู deploy status
- https://vercel.com → เลือก project → Deployments

### Build fail?
- ESLint warnings → ตั้ง `CI=false` ใน Vercel env vars

---

## 🎨 Features Highlight

### ระบบหลัก
- 📊 **Dashboard** — ภาพรวมสต็อก, ความเคลื่อนไหว
- 📦 **คลังสินค้าทั่วไป** — เพิ่ม/แก้/ลบ, barcode, รับ/จ่าย
- 👕 **คลังเสื้อผ้า** — รุ่น × สี × ไซส์, ราคาตามกลุ่มไซส์ (6-12 / S-XL / 2XL / 3XL / 4XL / 5XL)
- 📋 **ใบสั่งของ** — สร้าง, ปริ้น, ตัดสต็อกอัตโนมัติ
- 🧾 **ออกบิล** — ใบเสร็จ/ใบกำกับภาษี/ใบวางบิล + VAT + บัญชีรับเงิน + payment status
- 📃 **วางบิลเก็บเงิน (Statement)** — รวมยอดลูกค้าเป็นเดือน/ช่วงเวลา → ออกใบวางบิลรวม
- 👤 **ลูกค้า** — ฐานข้อมูล + Excel import
- 📊 **รายงาน** — ยอดขาย, สต็อกต่ำ, top products, CSV export
- 🏭 **ซัพพลายเออร์** — รายชื่อผู้ขาย

### ระบบสิทธิ์
- 3 บทบาท: Admin / Manager / Staff (เปลี่ยนชื่อบทบาทได้)
- สิทธิ์ override รายคน
- ตั้งค่าเมนูที่แต่ละ user เห็นได้
- Admin ดูรหัสผ่านได้ (ต้อง re-auth, session 5 นาที)

### 📝 Audit Log (ใหม่ — 2026-06-04)
เก็บประวัติ "ใครทำอะไรเมื่อไหร่" — เฉพาะ admin เห็น tab **📝 ประวัติการใช้**
- Track: LOGIN/LOGOUT, CREATE/DELETE (สินค้า/บิล/order/customer/user/clothing), STOCK (รับ/จ่าย), PRICE (เปลี่ยนราคา), PERMISSION (เปลี่ยนสิทธิ์/role/password reset), STATUS (invoice payment), CLEAR (ล้างคลัง)
- Filter: action / user / date / search
- Pagination 50/load · Export CSV
- Expand row → ดู before/after JSON
- เก็บล่าสุด 500 รายการใน Firestore collection `auditLog`

### 📊 Reports — รายงานเชิงลึก (ใหม่ — 2026-06-04)
Sub-tabs: Overview / Aging / Sales by Customer / Sales by Product / Trend / Profit / VAT
- ⏰ **Aging** — บิลค้างชำระแบ่ง bucket 0-30/31-60/61-90/90+ วัน + drill-down ลูกค้าเดี่ยว
- 👥 **Sales by Customer** — top customers (ยอด/บิล/ชำระ/ค้าง)
- 📦 **Sales by Product** — top products (ชิ้น/รายได้/กำไรประมาณ)
- 📈 **Monthly Trend** — กราฟ 12 เดือนล่าสุด (รวม vs ชำระแล้ว)
- 💵 **Profit Margin** — รวม products + clothing พร้อม margin% color-coded
- 🧾 **VAT Report** — รายเดือน + per-customer + Single customer drill-down
- ✨ **Customer name merging** — รวมชื่อซ้ำที่ตัด space + lowercase (Aging / Sales / VAT)
- Export CSV ทุก tab

### 📸 Camera Barcode Scanner (ใหม่ — 2026-06-04)
ใช้ `html5-qrcode` — รองรับ EAN-13/8, Code 128/39, QR, UPC-A/E, ITF
- ปุ่ม **📸 สแกนกล้อง** ใน tab "▦ สแกนบาร์โค้ด"
- เลือกกล้องได้ (auto-เลือกกล้องหลังบนมือถือ)
- เสียง beep ตอนสแกนสำเร็จ · debounce 1.5 วิ
- ค้นหาทั้ง products + clothing (case-insensitive)
- ถ้าไม่เจอ → ปุ่ม "➕ เพิ่มสินค้าใหม่ด้วยบาร์โค้ดนี้" — auto-fill barcode
- ต้องใช้ HTTPS (Vercel มีอยู่แล้ว ✅)

### UX
- 🔍 ค้นหา **case-insensitive** ทุกที่ (ลูกค้า/สินค้า/ซัพ)
- 🔒 **Persistent login** — ไม่หลุดตอน refresh
- 🖨️ Print ผ่าน iframe → A4 หลายหน้าได้, font Sarabun โหลดถูก
- 📱 Mobile responsive (sidebar auto-collapse)
- 💾 Modal ไม่ปิดเวลาคลิกข้างนอก → ข้อมูลไม่หาย

### 💾 Backup System (ใหม่ — 2026-06-03)

**In-App (ปุ่ม ⚙️ → 💾 Backup):**
- 📄 Download JSON — สำหรับ restore
- 📊 Download Excel — 1 sheet/collection, summary sheet
- 📂 Restore from JSON — Append หรือ Replace mode
- ⚠️ Banner เตือนเมื่อไม่ backup เกิน 7 วัน (admin only)

**Auto Daily Backup (GitHub Actions):**
- รัน 09:00 ไทย ทุกวัน
- Backup ทั้ง 2 projects sequential (ไม่ race condition)
- Commit เข้า `backups/<project>/YYYY-MM-DD.json`
- เก็บย้อนหลัง **60 วัน** (ลบเก่าอัตโนมัติ)
- Workflow file: `.github/workflows/firestore-backup.yml`
- ต้องมี GitHub Secrets:
  - `FIREBASE_SA_CPU_ERP` = service account JSON ของ cpu-erp
  - `FIREBASE_SA_BOONG` = service account JSON ของ boong-private
- Manual trigger: Actions tab → Firestore Daily Backup → Run workflow

📖 รายละเอียดเต็มอยู่ที่ `BACKUP-SETUP.md`

---

## 🔧 Quick Commands

```powershell
git status                    # ดูสถานะ
git log --oneline -10         # log 10 ตัวล่าสุด
git pull                      # ดึงล่าสุดก่อนแก้
git add . && git commit -m "..." && git push    # commit + push
```

---

## 🔥 Firestore Rules

### ปัจจุบัน — ทั้ง 2 projects เปิด (development mode)

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} { allow read, write: if true; }
  }
}
```

⚠️ Warning ใน Console: "Your security rules are defined as public"

### บทเรียนจาก 2026-06-03 — เคยลอง lock แล้วเจอปัญหา

ใช้ Anonymous Auth + Security Rules — เจอปัญหา:
1. Race condition — Firestore subscribe ก่อน auth ready → permission-denied
2. Anonymous token refresh ไม่ stable พอ
3. **ต้องเป็น Firebase Auth เต็มรูปแบบเท่านั้น** ถึงจะ lock ได้สบายใจ (item 3 ใน roadmap)

→ ปัจจุบันปล่อยเปิดไว้, ใช้ backup ป้องกันความเสี่ยงข้อมูลแทน

---

## 🗺️ Roadmap

### 🔴 สำคัญ (ก่อนเปิดให้พนักงาน)
1. ✅ ~~Auto Backup~~ — เสร็จ 2026-06-03
2. ✅ ~~Audit Log~~ — เสร็จ 2026-06-04
3. ⏳ Firebase Auth (เพื่อ lock rules อย่างถูกต้อง)

### 🟡 ประโยชน์มาก
4. ⏳ Import Excel: Products, Clothing, Suppliers (ลูกค้า ✅ แล้ว)
5. ✅ ~~Camera Barcode Scanner~~ — เสร็จ 2026-06-04 (html5-qrcode)
6. ✅ ~~รายงานเชิงลึก~~ — เสร็จ 2026-06-04 (Aging/Sales/Trend/Profit/VAT)
7. ❌ ~~LINE Notify~~ — ปิดบริการแล้ว มี.ค. 2025 · ลอง Telegram แต่ไม่นิยม → ปิดไปก่อน
8. ⏳ PromptPay QR ในบิล

### 🟢 เสริม UX
9. ⏳ PWA install
10. ⏳ หัก ณ ที่จ่าย 3%
11. ⏳ แนบไฟล์/รูป (Firebase Storage)
12. ⏳ Dark mode
13. ⏳ Stocktake
14. ⏳ หน้า Profile ลูกค้า
15. ⏳ Coupon/Discount

---

## 🆘 ปัญหาเจอบ่อย + วิธีแก้

### "permission-denied" ตอน save
- เช็ค F12 Console — ถ้าเห็น project ID ผิด → Vercel env vars พลาด (เคยเจอ typo `REACT_APP_FB_API_KE` ขาด Y)
- เช็ค Firestore Rules — ถ้าตั้ง lock แล้ว ต้องมี Anonymous Auth + handle race condition

### "เห็น Firebase: cpu-erp ทั้งที่อยากให้เป็น boong-private"
- ลืม restart `npm start` หลังสร้าง/แก้ `.env.local`
- หรือ env var name มี typo

### "Build fail บน Vercel"
- ESLint warnings → ใส่ env var `CI=false`

### "git push rejected"
- มี code ใหม่บน remote (เช่น backup commit จาก GitHub Actions) → `git pull --no-rebase` ก่อน → push

### "ปริ้นไม่ครบ หลายหน้า"
- แก้แล้ว — ใช้ iframe-based printing (`printElementById` ใน App.js)

### "Thai text มั่ว"
- เคยเจอเพราะ PowerShell อ่าน UTF-8 เป็น CP874
- แก้แล้วและไม่ควรเกิดอีก ถ้าใช้ Edit tool / VS Code

---

## 📥 Excel Import — Customers (มีแล้ว)

- ⚙️ ตั้งค่าไม่ใช่ — อยู่ที่ **ลูกค้า** tab → ปุ่ม "📥 นำเข้า Excel"
- Drag & drop หรือ click → เลือก `.xlsx` / `.csv`
- Auto-detect column จากหัวคอลัมน์ (ไทย+อังกฤษ)
- Duplicate detection: ชื่อ+เบอร์ตรง → ข้าม
- Bulk write 100 records/batch
- Template ดาวน์โหลดได้ในระบบ

---

## 📞 Resources

- Claude Code: https://claude.com/claude-code
- Firebase Docs: https://firebase.google.com/docs/firestore
- Vercel Docs: https://vercel.com/docs
- xlsx (SheetJS): https://docs.sheetjs.com
- GitHub Actions: https://docs.github.com/en/actions

---

## 📝 Major Changes Log

### 2026-06-04 (วันนี้)
- ✅ **Audit Log system** — ติดตาม "ใครทำอะไร" + UI + filter + export
- ✅ **Reports — รายงานเชิงลึก** (Aging, Sales by Customer/Product, Monthly Trend, Profit Margin, VAT) — 7 sub-tabs
- ✅ **Customer name merging** — รวมชื่อซ้ำตัด space + case (ใช้ใน Aging/Sales/VAT)
- ✅ **Statement preview modal** — คลิกแถวใบวางบิลเพื่อดูรายละเอียด
- ✅ **Camera Barcode Scanner** — html5-qrcode, scan EAN/QR/Code128, ค้นทั้ง products+clothing, ปุ่ม "เพิ่มสินค้าใหม่จากบาร์โค้ด"
- ❌ Telegram notification — ลอง implement แล้ว user บอกว่าคนไทยไม่นิยม → revert

### 2026-06-03
- ✅ ใบวางบิลรวมเดือน (Statement) — ใหม่
- ✅ Excel import ลูกค้า
- ✅ Session timeout + "จำฉันไว้"
- ✅ Persistent login
- ✅ Case-insensitive search
- ✅ Backup system (in-app JSON + Excel + GitHub Actions auto)
- ✅ Print fix: iframe approach → multi-page A4 properly
- ✅ Per-size pricing for clothing
- ✅ Modal ไม่ปิดเวลาคลิกข้างนอก
- ❌ Anonymous Auth + Security Rules → roll back (เจอ race condition issues)

### 2026-06-02 (วันแรกที่ deploy)
- Initial deployment ทั้ง 2 projects บน Vercel
- Refactor App.js แยก modules
- เพิ่ม Reports tab, Suppliers tab
- Payment tracking on invoices
- พอเปิด Production ทั้ง 2 ระบบ

---

## 🎯 จุดสำคัญที่ต้องจำ

1. **ไม่ใช้ dev branch แล้ว** — push ตรง master
2. **Backup ทำงานทุกวัน** อัตโนมัติ — มี history 60 วัน
3. **Rules เปิดทั้ง 2 projects** — เลือกความสะดวกกว่า security ในช่วง test
4. **2 projects แยก database** แต่ code เดียวกัน
5. **Vercel env vars สำคัญมาก** — ระวัง typo ในชื่อ
6. **Firebase Auth** = next big task ก่อนเปิดใช้งานจริง
