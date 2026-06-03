# 💾 Backup Setup — คู่มือตั้งค่า

## ระบบ Backup มี 2 ส่วน

### 🅰️ Manual In-App Backup (ใช้ได้ทันที)

- เข้า **⚙️ ตั้งค่า** → แท็บ **💾 Backup**
- กด **"💾 Backup ตอนนี้"** → ดาวน์โหลด JSON
- เก็บไฟล์ในที่ปลอดภัย (Drive / OneDrive / USB)

### 🅱️ Auto Backup รายวัน (GitHub Actions)

อัตโนมัติ 09:00 ทุกเช้า → commit เข้า repo ใน folder `backups/`
ต้องตั้งค่าครั้งเดียวก่อนใช้

---

## 📋 ขั้นตอนตั้งค่า GitHub Actions

### Step 1: หา Firebase Service Account สำหรับทั้ง 2 projects

**สำหรับ cpu-erp:**
1. ไป https://console.firebase.google.com/project/cpu-erp/settings/serviceaccounts/adminsdk
2. เลือก **Node.js** language
3. คลิก **"Generate new private key"**
4. กด **"Generate key"** → ดาวน์โหลดไฟล์ JSON
5. เปิดไฟล์ → copy เนื้อหา**ทั้งหมด**

**สำหรับ boong-private:**
- ทำเหมือนกันที่ https://console.firebase.google.com/project/boong-private/settings/serviceaccounts/adminsdk

### Step 2: เพิ่ม Secrets บน GitHub

1. ไป https://github.com/supawongwat-oss/my-inventory/settings/secrets/actions
2. คลิก **"New repository secret"**

เพิ่ม **2 secrets:**

| Name | Value |
|---|---|
| `FIREBASE_SA_CPU_ERP` | (paste เนื้อหา JSON ของ cpu-erp ทั้งหมด) |
| `FIREBASE_SA_BOONG` | (paste เนื้อหา JSON ของ boong-private ทั้งหมด) |

### Step 3: ทดสอบรันทันที (ไม่ต้องรอ schedule)

1. ไป https://github.com/supawongwat-oss/my-inventory/actions
2. เลือก workflow **"Firestore Daily Backup"** (sidebar ซ้าย)
3. คลิก **"Run workflow"** → เลือก branch `master` → กด **"Run workflow"** สีเขียว
4. รอ ~30 วินาที → ดูผล

### Step 4: ตรวจสอบ

หลัง workflow รันเสร็จ จะมีไฟล์ใหม่ใน repo:
- `backups/cpu-erp/2026-06-03.json`
- `backups/boong-private/2026-06-03.json`

ดูได้ที่: https://github.com/supawongwat-oss/my-inventory/tree/master/backups

---

## ⚙️ Schedule

- **อัตโนมัติ:** ทุกวัน 09:00 (เวลาไทย)
- **เก็บย้อนหลัง:** 30 วันล่าสุด (เก่ากว่านี้ระบบลบทิ้งเอง)
- **Manual trigger:** ไป Actions tab → Run workflow ได้ทุกเมื่อ

---

## 🔄 วิธี Restore จาก Backup

### จาก Manual Backup (ในแอป)

1. ⚙️ ตั้งค่า → แท็บ **💾 Backup**
2. คลิก **"📂 เลือกไฟล์ Backup (.json)"**
3. เลือกไฟล์ → เห็น preview ข้อมูล
4. เลือกโหมด:
   - **🟢 Append** = เพิ่มเข้าของเดิม (ปลอดภัย)
   - **🔴 Replace** = ลบของเก่าหมดแล้วใส่ใหม่ (อันตราย)
5. กดยืนยัน

### จาก Auto Backup (GitHub)

1. ไป repo → `backups/cpu-erp/` หรือ `backups/boong-private/`
2. คลิกไฟล์วันที่ต้องการ
3. กดปุ่ม **"Download raw file"** (ไอคอนลูกศรลง)
4. กลับมาแอป → ⚙️ Settings → 💾 Backup → Restore (ตามขั้นบน)

---

## ⚠️ ข้อควรระวัง

- **อย่า commit ไฟล์ Service Account ลง repo** — เก็บใน GitHub Secrets เท่านั้น
- **Replace mode** ลบข้อมูลปัจจุบันทั้งหมด — ต้อง backup ของปัจจุบันก่อนใช้
- ถ้า rules ของ Firestore = lock (require auth) — Service Account ผ่านได้ (มีสิทธิ์ admin)
- Free tier ของ GitHub Actions: 2000 นาที/เดือน — backup ใช้ ~1 นาที/วัน × 2 projects = ~60 นาที/เดือน → เหลือเฟือ

---

## 📊 สถานะปัจจุบัน

- ✅ Manual backup ในแอป (พร้อมใช้)
- ⏳ Auto backup (รอตั้งค่า GitHub Secrets ตามขั้นตอนข้างบน)
