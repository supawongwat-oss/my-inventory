# 📘 CPU ERP — Project Notes

> สรุปการใช้งาน, deploy, และ workflow ของระบบ
> สำหรับเปิดอ่านจากเครื่องที่ทำงานหรือเครื่องอื่นๆ ได้

## 🌿 Branch Strategy

- **`master`** — production (cpuerp.vercel.app + boong-private.vercel.app)
- **`dev`** — development/staging (Preview URL บน Vercel)
- Workflow: แก้บน `dev` → push → test ที่ Preview URL → merge เข้า `master` → deploy production

---

## 🏗️ Architecture

```
GitHub repo: supawongwat-oss/my-inventory (master branch)
    │
    ├──→ Vercel Project A → cpuerp.vercel.app          → Firebase: cpu-erp        (บริษัท)
    │                       (no env vars, ใช้ fallback config)
    │
    └──→ Vercel Project B → <pending>.vercel.app       → Firebase: boong-private  (ส่วนตัว)
                            (ใส่ env vars ที่ Vercel)
```

**1 codebase → 2 deployments → 2 databases** (data แยกกัน 100%, code เดียวกัน)

---

## 🌐 URLs

### Production
- **บริษัท**: https://cpuerp.vercel.app (✅ deploy แล้ว)
- **ส่วนตัว**: ยังไม่ deploy (พรุ่งนี้)

### Local Dev
- http://localhost:3000 (เครื่องนี้)
- http://192.168.10.197:3000 (LAN — สำหรับมือถือใน wifi เดียวกัน)

### Firebase Consoles
- บริษัท: https://console.firebase.google.com/project/cpu-erp
- ส่วนตัว: https://console.firebase.google.com/project/boong-private

### GitHub
- https://github.com/supawongwat-oss/my-inventory

### Vercel
- https://vercel.com (login ด้วย GitHub)

---

## 🔑 Login Default

| Username | Password | Role |
|----------|----------|------|
| admin    | 1234     | ผู้ดูแลระบบ |
| manager  | 1234     | ผู้จัดการ |
| staff    | 1234     | พนักงาน |

> ⚠️ เปลี่ยนรหัสผ่านก่อนใช้งานจริง

---

## ⚙️ Local Dev Setup

### ครั้งแรกบนเครื่องใหม่

```powershell
# 1. Clone repo
git clone https://github.com/supawongwat-oss/my-inventory.git
cd my-inventory

# 2. ติดตั้ง dependencies
npm install

# 3. รัน dev server
npm start
```

### สลับระหว่าง บริษัท / ส่วนตัว

**ใช้ บริษัท (cpu-erp):**
- ไม่ต้องมี `.env.local` (ใช้ fallback config)
- หรือเปลี่ยนชื่อ: `ren .env.local .env.personal`

**ใช้ ส่วนตัว (boong-private):**
- ต้องมีไฟล์ `.env.local` (gitignored — สร้างใหม่ในเครื่อง)
- หรือเปลี่ยนชื่อกลับ: `ren .env.personal .env.local`

**ตรวจสอบ:** เปิด browser → F12 → Console จะเห็น:
```
🔥 Firebase: cpu-erp        (ถ้าใช้บริษัท)
🔥 Firebase: boong-private  (ถ้าใช้ส่วนตัว)
```

### Firebase config ส่วนตัว (boong-private)

สร้าง `.env.local` (ไม่ commit เพราะ gitignore):

```env
REACT_APP_FB_API_KEY=AIzaSyDBUv8Gglpslce4g789vZXYzd8Etpbsvtk
REACT_APP_FB_AUTH_DOMAIN=boong-private.firebaseapp.com
REACT_APP_FB_PROJECT_ID=boong-private
REACT_APP_FB_STORAGE_BUCKET=boong-private.firebasestorage.app
REACT_APP_FB_MESSAGING_SENDER_ID=185142803696
REACT_APP_FB_APP_ID=1:185142803696:web:6fa4b124e1a82a83e89635
REACT_APP_FB_MEASUREMENT_ID=G-NZCBV11EEN
```

---

## 🚀 Deploy Workflow

### แก้ code → up auto

```powershell
git add .
git commit -m "feat: ..."
git push
```

→ Vercel auto-detect → build (~1-2 นาที) → deploy ทั้ง 2 projects พร้อมกัน

### ดู deploy status
- Dashboard: https://vercel.com → เลือก project → Deployments

### Build fail?
ปกติเพราะ ESLint warnings → ต้องมี env var:
- Key: `CI` Value: `false`
- ใส่ที่ Vercel project → Settings → Environment Variables

---

## 📋 Deploy ครั้งต่อไป (ส่วนตัว — boong-private)

```
1. ไป vercel.com → Add New Project → Import (repo เดิม my-inventory)
2. ตั้งชื่อใหม่ เช่น "boong-private" (อย่าซ้ำกับ cpuerp)
3. Framework: Create React App
4. Environment Variables → ใส่ทั้ง 7 ตัว:
   - CI = false
   - REACT_APP_FB_API_KEY = AIzaSyDBUv8Gglpslce4g789vZXYzd8Etpbsvtk
   - REACT_APP_FB_AUTH_DOMAIN = boong-private.firebaseapp.com
   - REACT_APP_FB_PROJECT_ID = boong-private
   - REACT_APP_FB_STORAGE_BUCKET = boong-private.firebasestorage.app
   - REACT_APP_FB_MESSAGING_SENDER_ID = 185142803696
   - REACT_APP_FB_APP_ID = 1:185142803696:web:6fa4b124e1a82a83e89635
   - REACT_APP_FB_MEASUREMENT_ID = G-NZCBV11EEN
5. Deploy
6. ได้ URL เช่น boong-private.vercel.app
```

---

## 🎨 Features Highlight

### ระบบหลัก
- **Dashboard** — ภาพรวมสต็อก, ความเคลื่อนไหว
- **คลังสินค้าทั่วไป** — เพิ่ม/แก้/ลบ, barcode, รับ/จ่าย
- **คลังเสื้อผ้า** — รุ่น × สี × ไซส์ พร้อมราคาตามไซส์
- **ใบสั่งของ** — สร้าง, ปริ้น, ตัดสต็อกอัตโนมัติ
- **ออกบิล** — ใบเสร็จ/ใบกำกับภาษี/ใบวางบิล + VAT + บัญชีรับเงิน
- **ลูกค้า** — ฐานข้อมูลลูกค้า
- **รายงาน** — ยอดขาย, สต็อกต่ำ
- **ซัพพลายเออร์** — รายชื่อผู้ขาย

### ระบบสิทธิ์
- 3 บทบาท: **Admin / Manager / Staff** (เปลี่ยนชื่อบทบาทได้)
- สิทธิ์ override รายคน: เพิ่ม / ลบ / ล้าง / ออกใบสั่ง / ออกบิล
- ตั้งค่าเมนูที่แต่ละ user เห็นได้
- Bulk action: ตั้งสิทธิ์ทุกคนพร้อมกัน
- ตำแหน่งหน้าที่ (กรอกเอง, ใช้กรอง sub-tab ได้)
- Admin ดูรหัสผ่านได้ (ต้อง re-auth, session 5 นาที)

### UI/UX
- Theme เทาอ่อนแบบมืออาชีพ
- Mobile responsive (sidebar auto-collapse, ตาราง scroll-x)
- Login background: CPU Branding Partner
- พรีวิวใบสั่ง/ใบบิลได้โดยคลิกที่แถว
- 2XL+ แยกบรรทัด (ราคาต่างกัน)
- จัดกลุ่มใบสั่ง/ใบบิลตามวัน (พับ/กางได้)
- บัญชีรับเงิน (เลือกบัญชีบริษัท/ส่วนตัวตอนออกบิล)

---

## 🔧 Quick Commands

```powershell
# ตรวจสอบสถานะ git
git status

# ดู log commit ล่าสุด
git log --oneline -10

# Pull โค้ดใหม่ (ก่อนแก้)
git pull

# Push หลังแก้
git add .
git commit -m "..."
git push

# สลับไป branch ที่กำลังพัฒนา
git checkout master
git checkout fix/inventory-table-headers

# ลบ branch เก่า
git branch -d fix/inventory-table-headers
```

---

## 🎯 พรีเซนต์กรรมการ — Talking Points

### จุดขายหลัก
1. **ฟรี 100%** — Vercel + Firebase free tier
2. **ใช้ได้ทุกที่** — มือถือ / คอม / 4G / ต่างประเทศ
3. **ไม่ต้องลงอะไร** — แค่ browser เปิด URL
4. **Real-time sync** — แก้ที่ไหนคนอื่นเห็นทันที
5. **ปิดคอมได้** — Server อยู่บน cloud
6. **อัปเดต 1 ครั้ง** — ทุกเครื่องได้พร้อมกัน

### Demo Flow
1. เปิด `cpuerp.vercel.app` บน desktop + มือถือคู่กัน
2. โชว์ออกบิล → ปรากฏบนมือถือทันที
3. โชว์ระบบสิทธิ์ → manager เห็นน้อยกว่า admin
4. โชว์ใบบิลปริ้น → format สวย พร้อมข้อมูลธนาคาร
5. ถ้ามีคำถาม security → ตอบ "ปรับ Firestore Rules + Firebase Auth ได้"

### ค่าใช้จ่ายในอนาคต
- ใช้ฟรีได้นาน — ถ้า traffic เยอะค่อยอัปเกรด
- Custom domain (ถ้าอยากได้ ชื่อตัวเอง) ~390-850 บาท/ปี

---

## 📝 To-Do (พรุ่งนี้+)

- [ ] Deploy boong-private (ส่วนตัว) บน Vercel
- [ ] (Optional) Custom domain
- [ ] (Optional) ปิด Firestore Rules ให้แคบลง (ต้องเปลี่ยนเป็น Firebase Auth)
- [ ] (Optional) สอนใช้งาน user ในโรงงาน
- [ ] (Optional) ระบบกล้องวงจรปิด — รวมในแอป (ต้องเช็คฮาร์ดแวร์ก่อน)

---

## 🆘 ปัญหาเจอบ่อย

### "เห็น Firebase: cpu-erp ทั้งที่อยากให้เป็น boong-private"
- ลืม restart `npm start` หลังสร้าง `.env.local`
- หรือ `.env.local` ไม่ได้อยู่ใน root project

### "Build fail บน Vercel"
- ESLint warnings → ใส่ env var `CI=false` ใน Vercel Project Settings

### "git push rejected"
- มี code ใหม่บน remote → `git pull --no-rebase` ก่อน → แล้ว push

### "git checkout master fail"
- อาจเป็น branch ชื่อ `main` → `git checkout main`

---

## 📞 Resources

- Claude Code: https://claude.com/claude-code
- Firebase Docs: https://firebase.google.com/docs/firestore
- Vercel Docs: https://vercel.com/docs
- Create React App: https://create-react-app.dev

---

_Last updated: 2026-06-02 (วันแรกที่ deploy)_
