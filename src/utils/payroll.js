// 💰 Payroll calculations — ประเทศไทย
// อ้างอิง: SSO 5% (cap 750/เดือน), Personal income tax progressive

export const SSO_RATE = 0.05;
export const SSO_MAX_PER_MONTH = 750; // 5% ของ 15,000

// 📊 ภาษีบุคคลธรรมดา (อัตราก้าวหน้า ปี 2568)
// คำนวณจาก "เงินได้สุทธิ/ปี" (รายได้ - ค่าใช้จ่าย - ค่าลดหย่อน)
const TAX_BRACKETS = [
  { upTo: 150000,    rate: 0.00 },
  { upTo: 300000,    rate: 0.05 },
  { upTo: 500000,    rate: 0.10 },
  { upTo: 750000,    rate: 0.15 },
  { upTo: 1000000,   rate: 0.20 },
  { upTo: 2000000,   rate: 0.25 },
  { upTo: 5000000,   rate: 0.30 },
  { upTo: Infinity,  rate: 0.35 },
];

// ค่าลดหย่อนพื้นฐานต่อปี (ส่วนตัว 60,000 + ค่าใช้จ่ายเหมา 50% สูงสุด 100,000)
const ANNUAL_BASE_DEDUCTION = 160000;

/**
 * คำนวณภาษีหัก ณ ที่จ่ายรายเดือน (estimate)
 * @param {number} monthlyIncome - รายได้/เดือน (รวม base+OT+bonus)
 * @param {number} extraDeductionAnnual - ค่าลดหย่อนเพิ่มเติม/ปี (ลูก, ประกัน ฯลฯ)
 * @returns {number} - ภาษีหัก/เดือน
 */
export function calcMonthlyTax(monthlyIncome, extraDeductionAnnual = 0) {
  if (!monthlyIncome || monthlyIncome <= 0) return 0;
  const annualIncome = monthlyIncome * 12;
  const taxable = annualIncome - ANNUAL_BASE_DEDUCTION - extraDeductionAnnual;
  if (taxable <= 0) return 0;

  let tax = 0;
  let prevBracket = 0;
  for (const b of TAX_BRACKETS) {
    if (taxable > prevBracket) {
      const slice = Math.min(taxable, b.upTo) - prevBracket;
      tax += slice * b.rate;
      prevBracket = b.upTo;
    } else break;
  }
  return Math.max(0, Math.round((tax / 12) * 100) / 100);
}

/**
 * คำนวณประกันสังคม
 */
export function calcSSO(monthlyIncome, hasSSO = true) {
  if (!hasSSO || !monthlyIncome || monthlyIncome <= 0) return 0;
  return Math.min(SSO_MAX_PER_MONTH, Math.round(monthlyIncome * SSO_RATE * 100) / 100);
}

/**
 * คำนวณ pay slip 1 คน
 * @param {object} emp - employee record (มี baseSalary, otRate, hasSSO, extraDeductionAnnual)
 * @param {object} attendance - { daysPresent, daysAbsent, daysLate, otHours, workDaysInMonth }
 * @param {object} adjustments - { bonus, holidayPay, advance, penalty, otherDeduction }
 * @returns {object} - { earnings, deductions, breakdown, net }
 */
export function calculatePaySlip(emp, attendance, adjustments = {}) {
  const baseSalary = Number(emp.baseSalary) || 0;
  const otRate = Number(emp.otRate) || 0;
  const hasSSO = emp.hasSSO !== false; // default true
  const isPiecework = emp.salaryType === "piecework";
  const isMonthly = emp.salaryType === "monthly" || !emp.salaryType;
  const isDaily = emp.salaryType === "daily";

  const daysPresent = Number(attendance.daysPresent) || 0;
  const daysAbsent = Number(attendance.daysAbsent) || 0;
  const workDaysInMonth = Number(attendance.workDaysInMonth) || 26; // default 26 วัน
  const otHours = Number(attendance.otHours) || 0;
  const piecesProduced = Number(attendance.piecesProduced) || 0;
  const pieceRate = Number(emp.pieceRate) || 0;

  // 💰 รายได้หลัก
  let basePay = 0;
  if (isMonthly) {
    // หักตามวันขาด: เงินเดือน × (วันมา / วันทำงาน)
    if (daysAbsent > 0 && workDaysInMonth > 0) {
      basePay = baseSalary * (daysPresent / workDaysInMonth);
    } else {
      basePay = baseSalary;
    }
  } else if (isDaily) {
    basePay = baseSalary * daysPresent;
  } else if (isPiecework) {
    basePay = pieceRate * piecesProduced;
  }
  basePay = Math.round(basePay * 100) / 100;

  // ⏱️ OT
  const otPay = Math.round(otHours * otRate * 100) / 100;

  // 🎁 รายได้พิเศษ
  const bonus = Number(adjustments.bonus) || 0;
  const holidayPay = Number(adjustments.holidayPay) || 0;

  const grossEarnings = basePay + otPay + bonus + holidayPay;

  // 💸 หัก
  const sso = calcSSO(grossEarnings, hasSSO);
  const tax = calcMonthlyTax(grossEarnings, Number(emp.extraDeductionAnnual) || 0);
  const advance = Number(adjustments.advance) || 0;
  const penalty = Number(adjustments.penalty) || 0;
  const otherDeduction = Number(adjustments.otherDeduction) || 0;

  const totalDeductions = sso + tax + advance + penalty + otherDeduction;

  const net = Math.max(0, Math.round((grossEarnings - totalDeductions) * 100) / 100);

  return {
    employeeId: emp.id,
    employeeName: emp.name,
    salaryType: emp.salaryType || "monthly",
    earnings: {
      basePay,
      otPay,
      bonus,
      holidayPay,
      gross: Math.round(grossEarnings * 100) / 100,
    },
    deductions: {
      sso,
      tax,
      advance,
      penalty,
      other: otherDeduction,
      total: Math.round(totalDeductions * 100) / 100,
    },
    attendance: {
      daysPresent,
      daysAbsent,
      daysLate: Number(attendance.daysLate) || 0,
      otHours,
      piecesProduced,
      workDaysInMonth,
    },
    net,
  };
}

// helper: คำนวณ working days ในเดือน (ไม่นับเสาร์-อาทิตย์)
export function workingDaysInMonth(year, month) {
  // month: 1-12
  const days = new Date(year, month, 0).getDate();
  let count = 0;
  for (let d = 1; d <= days; d++) {
    const dow = new Date(year, month - 1, d).getDay();
    if (dow !== 0 && dow !== 6) count++; // 0=Sun, 6=Sat
  }
  return count;
}

// helper: รวม attendance ของพนักงาน 1 คนในเดือน
export function summarizeAttendance(records, employeeId) {
  const rec = records.filter(r => r.employeeId === employeeId);
  return rec.reduce((acc, r) => {
    if (r.status === "present") acc.daysPresent++;
    else if (r.status === "absent") acc.daysAbsent++;
    else if (r.status === "late") { acc.daysPresent++; acc.daysLate++; }
    else if (r.status === "halfday") acc.daysPresent += 0.5;
    else if (r.status === "leave") acc.daysAbsent++; // ลา = นับเป็นขาด (ปรับ logic ได้)
    acc.otHours += Number(r.otHours) || 0;
    acc.piecesProduced += Number(r.piecesProduced) || 0;
    return acc;
  }, { daysPresent: 0, daysAbsent: 0, daysLate: 0, otHours: 0, piecesProduced: 0 });
}
