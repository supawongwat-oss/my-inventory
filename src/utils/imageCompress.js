// imageCompress.js — บีบขนาดรูปก่อนเก็บใน Firestore
// ค่าเริ่มต้น: ด้านยาวสุด 1000 px, JPEG quality 75% → ปกติได้ ~150-300 KB
// ผ่าน base64 → ใช้ใน sub-collection productionOrders/{id}/photos

export function compressImage(file, { maxDim = 1000, quality = 0.75 } = {}) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error("no file"));
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("invalid image"));
      img.onload = () => {
        let { width, height } = img;
        const ratio = width / height;
        if (Math.max(width, height) > maxDim) {
          if (width > height) {
            width = maxDim;
            height = Math.round(maxDim / ratio);
          } else {
            height = maxDim;
            width = Math.round(maxDim * ratio);
          }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#ffffff"; // กันพื้นโปร่งใส
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        resolve(dataUrl);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// คำนวนขนาด KB จาก dataUrl (ใช้สำหรับแสดงผล)
export function dataUrlSizeKB(dataUrl) {
  if (!dataUrl) return 0;
  // base64 length × 3/4 = byte size approx
  const base64 = dataUrl.split(",")[1] || "";
  const bytes = Math.floor(base64.length * 0.75);
  return Math.round(bytes / 1024);
}
