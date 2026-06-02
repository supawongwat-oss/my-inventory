# my-inventory — ระบบบริหารคลังสินค้า CPU

ระบบจัดการคลังสินค้าสำหรับธุรกิจขนาดเล็ก-กลาง พัฒนาด้วย React + Firebase

## ฟีเจอร์หลัก

- **Dashboard** — ภาพรวมสินค้า สินค้าต่ำกว่าขั้นต่ำ และสถิติคลัง
- **คลังสินค้าทั่วไป** — เพิ่ม/แก้ไข/ลบสินค้า รับ-จ่ายสินค้า พร้อม barcode
- **คลังเสื้อผ้า** — จัดการสต็อกแยกตามรุ่น สี และไซส์
- **ใบสั่งของ** — สร้างและติดตามออเดอร์ลูกค้า
- **ใบเสร็จ/ใบกำกับภาษี** — ออกเอกสารทางการเงินได้เลย
- **จัดการผู้ใช้** — ระบบสิทธิ์ 3 ระดับ (Admin / Manager / Staff)

## เทคโนโลยี

- [React 19](https://react.dev/)
- [Firebase Firestore](https://firebase.google.com/) — ฐานข้อมูล realtime
- [Create React App](https://create-react-app.dev/)

## วิธีรันโปรเจค

```bash
npm install
npm start
```

เปิด [http://localhost:3000](http://localhost:3000) ในเบราว์เซอร์

## บัญชีเริ่มต้น (สำหรับทดสอบ)

| Username | Password | Role |
|----------|----------|------|
| admin | 1234 | ผู้ดูแลระบบ |
| manager | 1234 | ผู้จัดการ |
| staff | 1234 | พนักงาน |

## Build สำหรับ Production

```bash
npm run build
```
