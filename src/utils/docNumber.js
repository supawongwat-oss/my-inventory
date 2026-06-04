// สร้างเลขเอกสารแบบทางการ: PREFIX{ปีพ.ศ.2หลัก}{เดือน2หลัก}-{เลขรัน4หลัก}
// ตัวอย่าง: INV6906-0001 = ใบเสร็จที่ 1 ของเดือน มิ.ย. พ.ศ. 2569
// เลขรัน reset ทุกเดือน

export function generateDocNo(prefix, existingDocs = [], field = "invoiceNo") {
  const now = new Date();
  const buddhistYear = now.getFullYear() + 543;
  const yy = String(buddhistYear).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const monthCode = `${yy}${mm}`;
  const pattern = `${prefix}${monthCode}-`;

  // หาเลขรันสูงสุดในเดือนนี้
  let maxRun = 0;
  existingDocs.forEach((d) => {
    const no = d?.[field] || "";
    if (typeof no === "string" && no.startsWith(pattern)) {
      const run = parseInt(no.slice(pattern.length), 10);
      if (!isNaN(run) && run > maxRun) maxRun = run;
    }
  });

  const nextRun = String(maxRun + 1).padStart(4, "0");
  return `${pattern}${nextRun}`;
}
