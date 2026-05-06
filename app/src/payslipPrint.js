import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

const STORAGE_KEY = 'payslipTemplateConfig_v1';

const escapeHtml = (value) => {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

const safeMoney = (v) => {
  if (v == null || v === '') return '';
  const raw = typeof v === 'string' ? v.replace(/,/g, '').trim() : v;
  const n = Number(raw);
  if (!Number.isFinite(n)) return '';
  return Math.round(n).toString();
};

/** Show blank instead of 0 in payslip display. */
const hideZero = (v) => {
  if (v == null || v === '') return '';
  if (v === 0 || v === '0') return '';
  return String(v);
};

/** Normalize common typos in template labels (e.g. "Allownace" -> "Allowance") so lookup matches. */
const normalizeLabelForMatch = (s) => {
  if (typeof s !== 'string') return '';
  return s
    .replace(/\ballownace\b/gi, 'allowance')
    .replace(/\bcharges\b/gi, 'chargers')
    .trim();
};

/** Earnings table "Actual" column: monthly contractual amounts for Earned Basic/HRA/DA rows — show number including 0. */
const amountForEarningsActualColumn = (value, label) => {
  if (value == null || value === '') return '';
  const norm = normalizeLabelForMatch(String(label || '').trim().toLowerCase()).replace(/\s+/g, ' ');
  if (
    norm === 'earned basic' ||
    norm === 'earned hra' ||
    norm === 'earned da' ||
    norm === 'actual basic' ||
    norm === 'actual hra' ||
    norm === 'actual da'
  ) {
    return String(value);
  }
  return hideZero(value);
};

/** Earnings table "Earnings" column (pro-rated / paid amounts). */
const amountForEarningsEarnedColumn = (value, label) => {
  if (value == null || value === '') return '';
  const norm = String(label || '').trim().toLowerCase();
  if (norm === 'actual basic' || norm === 'actual hra' || norm === 'actual da') return String(value);
  return hideZero(value);
};

/** Hide allowances that should not appear on payslip rows. */
const isHiddenPayslipAllowanceLabel = (lbl) => {
  const n = normalizeLabelForMatch(String(lbl || '').trim().toLowerCase());
  const isAllowance = n.includes('allowance') || n.includes('allownace');
  if (!isAllowance) return false;
  if (n.includes('food')) return true;
  if (n.includes('washing')) return true;
  if (n.includes('uniform')) return true;
  return false;
};

/** Remove hidden allowance rows from deductions table. */
const filterDeductionRowsForPayslip = (rows) => {
  if (!Array.isArray(rows) || !rows.length) return rows;
  return rows.filter((r) => !isHiddenPayslipAllowanceLabel(r.label));
};

/** Template deduction row labeled "Late" — append total LOH in label: "Late | &lt;hours&gt;". */
const isPayslipLateDeductionLabel = (label) => {
  const n = normalizeLabelForMatch(String(label || '').trim().toLowerCase()).replace(/\s+/g, ' ');
  return n === 'late';
};

/** LOH hours for Late label; returns null if unknown, "0" when LOH is zero. */
const formatLohHoursForPayslipCell = (raw) => {
  if (raw == null || raw === '') return null;
  const n = Number(String(raw).replace(/,/g, '').trim());
  if (!Number.isFinite(n)) return null;
  if (n === 0) return '0';
  if (Number.isInteger(n)) return String(n);
  return String(Math.round(n * 100) / 100);
};

const getPayslipLateHoursFromLoh = (rawLoh) => {
  if (rawLoh == null || rawLoh === '') return null;
  const loh = Number(String(rawLoh).replace(/,/g, '').trim());
  if (!Number.isFinite(loh)) return null;
  if (loh <= 1.5) return 0;
  return Math.round((loh - 1.5) * 100) / 100;
};

const getLohRawForPayslipLate = (emp, getVal) => {
  let raw =
    getPayslipValue(emp, 'loh', 'Loss of Hours', getVal) ?? getPayslipValue(emp, 'loh', 'LOH', getVal);
  if (raw !== undefined && raw !== null && raw !== '') return raw;
  if (raw === 0 || raw === '0') return raw;
  raw = emp?.loh ?? emp?.LOH;
  if (raw !== undefined && raw !== null && raw !== '') return raw;
  if (raw === 0 || raw === '0') return raw;
  return undefined;
};

const deductionDisplayLabel = (rowLabel, emp, getVal) => {
  if (!isPayslipLateDeductionLabel(rowLabel)) return rowLabel;
  const raw = getLohRawForPayslipLate(emp, getVal);
  const lateHours = getPayslipLateHoursFromLoh(raw);
  const formatted = formatLohHoursForPayslipCell(lateHours);
  if (formatted === null) return String(rowLabel).trim();
  return `${String(rowLabel).trim()} | ${formatted}`;
};

/**
 * Payslip earnings only: remove "Other Allowance(s)" / typo "Other Allownace" / key otherAllowances.
 * Does NOT remove otherAllowance (singular) — that maps to Attendance Allowance on payroll.
 */
const isOtherAllowancePayslipEarningsLabel = (lblOrKey) => {
  const s = String(lblOrKey || '').trim();
  if (!s) return false;
  const compact = s.replace(/\s+/g, '').toLowerCase();
  if (compact === 'otherallowances') return true;
  const n = normalizeLabelForMatch(s.toLowerCase()).replace(/\s+/g, ' ');
  return n === 'other allowance' || n === 'other allowances';
};

const stripOtherAllowanceFromEarningsKeys = (keys) => {
  if (!Array.isArray(keys)) return [];
  return keys.filter((k) => !isOtherAllowancePayslipEarningsLabel(k) && !isHiddenPayslipAllowanceLabel(k));
};

const getComponentDisplayValue = (employee, componentName) => {
  if (!employee || !componentName) return '';
  const base = String(componentName).trim();
  if (!base) return '';

  const lower = normalizeLabelForMatch(base.toLowerCase());
  if (lower.includes('no. of days') && lower.includes('month')) return employee.daysInMonth ?? employee.DaysInMonth ?? '';
  if (lower.includes('no. of days present') || lower.includes('days present')) return employee.daysPresent ?? employee.DaysPresent ?? '';
  if (lower === 'loh' || lower.includes('loss of hours')) return employee.loh ?? employee.LOH ?? '';
  if (lower === 'lop' || lower.includes('loss of pay')) return employee.lop ?? employee.LOP ?? '';
  if (lower.includes('ot hours') || lower === 'ot') return employee.otHours ?? employee.OTHours ?? '';
  // Template/Setup may label this as "TRAVEL CHARGES", while Employee/Payroll uses travelChargers
  if (lower.includes('travel') && lower.includes('charge')) {
    return (
      employee.travelChargers ??
      employee.TravelChargers ??
      employee.travelCharges ??
      employee.TravelCharges ??
      ''
    );
  }
  // Explicit fallbacks for common payroll keys (API may use PascalCase)
  if (lower.includes('food') && (lower.includes('allowance') || lower.includes('allownace'))) {
    return employee.foodAllowance ?? employee.FoodAllowance ?? '';
  }
  if (lower.includes('loan') && lower.includes('allowance')) {
    const v = employee.loanAllowance ?? employee.LoanAllowance ?? '';
    return v !== undefined && v !== null && v !== '' ? v : '';
  }
  if (lower === 'esi' || (lower.includes('esi') && (lower.includes('0.75') || lower.includes('%')))) {
    const v = employee.esi ?? employee.ESI ?? '';
    return v !== undefined && v !== null && v !== '' ? v : '';
  }
  if (lower === 'pf') {
    const v = employee.pf ?? employee.PF ?? '';
    return v !== undefined && v !== null && v !== '' ? v : '';
  }
  if (lower === 'late') return employee.late ?? employee.Late ?? '';
  if (lower === 'other allowance' || lower === 'other allowances') {
    return employee.otherAllowances ?? employee.otherAllowance ?? employee.OtherAllowances ?? employee.OtherAllowance ?? '';
  }
  if (lower.includes('attendance') && lower.includes('bonus')) {
    return employee.attendanceBonus ?? employee.AttendanceBonus ?? '';
  }
  if (lower.includes('washing') && lower.includes('allowance')) {
    return employee.washingAllowance ?? employee.WashingAllowance ?? '';
  }
  if (lower.includes('total') && lower.includes('deduction')) {
    return employee.totalDeduction ?? employee.TotalDeduction ?? '';
  }
  if (lower.includes('net') && lower.includes('pay')) {
    return employee.netPay ?? employee.NetPay ?? '';
  }

  const camel = base
    .toLowerCase()
    .split(/\s+/)
    .map((word, index) => (index === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join('');

  const camelAcronym = base
    .split(/\s+/)
    .map((word, index) =>
      index === 0
        ? word.toLowerCase()
        : (word.length <= 4 && word === word.toUpperCase()
          ? word
          : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    )
    .join('');

  // PascalCase (e.g. Actual Basic -> ActualBasic, Actual HRA -> ActualHRA) for API keys
  const pascalCase = base
    .split(/\s+/)
    .map((word, index) =>
      index === 0
        ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
        : (word.length <= 4 && word === word.toUpperCase()
          ? word
          : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    )
    .join('');

  const variants = [
    base,
    base.toLowerCase(),
    base.toUpperCase(),
    base.replace(/\s+/g, ''),
    base.replace(/\s+/g, '').toLowerCase(),
    base.replace(/\s+/g, '_').toLowerCase(),
    base.replace(/\s+/g, '_').toUpperCase(),
    camel,
    camelAcronym,
    pascalCase,
  ];

  for (const key of variants) {
    if (employee[key] !== undefined && employee[key] !== null) return employee[key];
  }
  return '';
};

const isTotalDeductionField = (key, label) => {
  const nk = String(key || '').replace(/\s+/g, '').replace(/_/g, '').toLowerCase();
  if (nk === 'totaldeduction') return true;
  const nl = normalizeLabelForMatch(String(label || '').trim().toLowerCase());
  return nl === 'total deduction' || nl === 'total deductions';
};

const isNetPayField = (key, label) => {
  const nk = String(key || '').replace(/\s+/g, '').replace(/_/g, '').toLowerCase();
  if (nk === 'netpay') return true;
  const nl = normalizeLabelForMatch(String(label || '').trim().toLowerCase());
  return nl === 'net pay' || nl === 'netpay';
};

const getPayslipValue = (employee, key, label, getDisplayValueOverride) => {
  if (!employee) return '';
  // Total Deduction / Net Pay: must use live display logic (formulae + template) when provided —
  // raw employee.totalDeduction is often stale vs line items (PF + …).
  if (
    getDisplayValueOverride &&
    (isTotalDeductionField(key, label) || isNetPayField(key, label))
  ) {
    const resolve = getDisplayValueOverride;
    const byLabel = label ? resolve(employee, label) : '';
    if (byLabel !== '' && byLabel !== undefined && byLabel !== null) return byLabel;
    const byKeyName = key ? resolve(employee, key) : '';
    if (byKeyName !== '' && byKeyName !== undefined && byKeyName !== null) return byKeyName;
  }
  if (key && employee[key] !== undefined && employee[key] !== null) return employee[key];
  if (label && employee[label] !== undefined && employee[label] !== null) return employee[label];
  // Backend may send PascalCase keys; prefer fetched values before computed display fallbacks.
  const norm = String(label || key || '').trim().toLowerCase();
  if (norm === 'actual hra' && (employee.ActualHRA !== undefined && employee.ActualHRA !== null)) return employee.ActualHRA;
  if (norm === 'actual basic' && (employee.ActualBasic !== undefined && employee.ActualBasic !== null)) return employee.ActualBasic;
  if (norm === 'actual da' && (employee.ActualDA !== undefined && employee.ActualDA !== null)) return employee.ActualDA;
  if (norm === 'earned hra' && (employee.EarnedHRA !== undefined && employee.EarnedHRA !== null)) return employee.EarnedHRA;
  if (norm === 'earned basic' && (employee.EarnedBasic !== undefined && employee.EarnedBasic !== null)) return employee.EarnedBasic;
  if (norm === 'earned da' && (employee.EarnedDA !== undefined && employee.EarnedDA !== null)) return employee.EarnedDA;

  if (key) {
    const keyNoSpace = String(key).replace(/\s+/g, '');
    const keyPascal = keyNoSpace.charAt(0).toUpperCase() + keyNoSpace.slice(1);
    if (employee[keyPascal] !== undefined && employee[keyPascal] !== null) return employee[keyPascal];
  }

  const resolve = getDisplayValueOverride || getComponentDisplayValue;
  const byLabel = label ? resolve(employee, label) : '';
  if (byLabel !== '' && byLabel !== undefined && byLabel !== null) return byLabel;
  const byKeyName = key ? resolve(employee, key) : '';
  return byKeyName;
};

const labelToKey = (label, payrollKeyToHeaderLabel) => {
  if (!label || !payrollKeyToHeaderLabel) return null;
  const raw = String(label).trim().toLowerCase();
  const norm = normalizeLabelForMatch(raw);
  // Explicit fallbacks for labels that may not exist in map or have different wording
  const labelToKeyFallbacks = {
    'other allowance': 'otherAllowance',
    'other allowances': 'otherAllowances',
    'travel charges': 'travelChargers',
    'washing allowance': 'washingAllowance',
  };
  if (labelToKeyFallbacks[norm]) return labelToKeyFallbacks[norm];
  const entry = Object.entries(payrollKeyToHeaderLabel).find(
    ([, v]) => normalizeLabelForMatch(String(v || '').trim().toLowerCase()) === norm
  );
  return entry ? entry[0] : null;
};

const COMBINED_EARNINGS = {
  'basic + da': { actual: ['actualBasic', 'actualDA'], earned: ['earnedBasic', 'earnedDA'] },
  'basic+da': { actual: ['actualBasic', 'actualDA'], earned: ['earnedBasic', 'earnedDA'] },
};

const sumKeys = (emp, keys) => {
  if (!emp || !Array.isArray(keys)) return '';
  let sum = 0;
  for (const k of keys) {
    const v = emp[k];
    if (v !== undefined && v !== null && v !== '') {
      const n = Number(String(v).replace(/,/g, '').trim());
      if (Number.isFinite(n)) sum += n;
    }
  }
  return sum;
};

const getActualEarnedKeys = (key) => {
  const k = String(key || '').trim();
  if (/^actual/i.test(k)) return { actualKey: k, earnedKey: k.replace(/^actual/i, 'earned') };
  if (/^earned/i.test(k)) return { actualKey: k.replace(/^earned/i, 'actual'), earnedKey: k };
  return { actualKey: k, earnedKey: k };
};

const getActualEarned = (emp, key, label, payrollKeyToHeaderLabel, getDisplayValueOverride) => {
  const normLabel = String(label || key || '').trim().toLowerCase();
  const combined = COMBINED_EARNINGS[normLabel];
  if (combined) {
    const actual = sumKeys(emp, combined.actual);
    const earned = sumKeys(emp, combined.earned);
    return { actual: safeMoney(actual !== '' ? actual : 0), earned: safeMoney(earned !== '' ? earned : 0) };
  }
  const resolvedKey = labelToKey(label, payrollKeyToHeaderLabel) || key;
  const { actualKey, earnedKey } = getActualEarnedKeys(resolvedKey);
  const earnedLabel = payrollKeyToHeaderLabel && payrollKeyToHeaderLabel[earnedKey] ? payrollKeyToHeaderLabel[earnedKey] : earnedKey;
  const labelNorm = normalizeLabelForMatch(normLabel).replace(/\s+/g, ' ');
  // "Earned Basic" / "Earned HRA" / "Earned DA" rows: Actual column = monthly master (Actual Basic/HRA/DA), Earnings = pro-rated earned.
  if (labelNorm === 'earned basic' || labelNorm === 'earned hra' || labelNorm === 'earned da') {
    const actualHeader =
      labelNorm === 'earned basic' ? 'Actual Basic' : labelNorm === 'earned hra' ? 'Actual HRA' : 'Actual DA';
    const earnedHeader =
      labelNorm === 'earned basic' ? 'Earned Basic' : labelNorm === 'earned hra' ? 'Earned HRA' : 'Earned DA';
    const actualVal = getPayslipValue(emp, actualKey, actualHeader, getDisplayValueOverride);
    const earnedVal = getPayslipValue(emp, earnedKey, earnedHeader, getDisplayValueOverride);
    return { actual: safeMoney(actualVal), earned: safeMoney(earnedVal) };
  }
  const actualVal = getPayslipValue(emp, actualKey, label, getDisplayValueOverride);
  const earnedVal = getPayslipValue(emp, earnedKey, earnedLabel, getDisplayValueOverride);
  return { actual: safeMoney(actualVal), earned: safeMoney(earnedVal) };
};

const monthLabel = (yyyyMm) => {
  if (!yyyyMm || typeof yyyyMm !== 'string' || yyyyMm.length < 7) return '';
  const [y, m] = yyyyMm.split('-').map((x) => Number(x));
  if (!Number.isFinite(y) || !Number.isFinite(m)) return '';
  const dt = new Date(Date.UTC(y, m - 1, 1));
  return dt.toLocaleString(undefined, { month: 'long', year: 'numeric' }).toUpperCase();
};

/** html2pdf.js can leave overlay/container on body; drop stray payslip capture divs after errors. */
export const removePayslipPdfGenerationArtifacts = () => {
  if (typeof document === 'undefined') return;
  document.querySelectorAll('.html2pdf__overlay, .html2pdf__container').forEach((node) => {
    try {
      node.parentNode?.removeChild(node);
    } catch {
      /* ignore */
    }
  });
  document.querySelectorAll('[id^="payslip-pdf-wrapper-"]').forEach((node) => {
    try {
      node.parentNode?.removeChild(node);
    } catch {
      /* ignore */
    }
  });
};

/** Prevent a wide fixed capture node from introducing horizontal scroll / layout shift on the main app. */
const lockViewportScrollX = () => {
  if (typeof document === 'undefined') return () => {};
  const html = document.documentElement;
  const body = document.body;
  const prevHtml = html.style.overflowX;
  const prevBody = body.style.overflowX;
  html.style.overflowX = 'hidden';
  body.style.overflowX = 'hidden';
  return () => {
    html.style.overflowX = prevHtml;
    body.style.overflowX = prevBody;
  };
};

const PRINT_STYLES = `
  * { box-sizing: border-box; }
  body { margin: 0; padding: 18px; font-family: Arial, Helvetica, sans-serif; color: #111; }
  .payslip-sheet { width: 900px; max-width: 100%; margin: 0 auto; border: 2px solid #111; }
  .payslip-header { padding: 10px 14px; border-bottom: 2px solid #111; }
  .payslip-header-inner { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
  .payslip-header-text { flex: 1; text-align: center; }
  .payslip-header-logo { flex-shrink: 0; }
  .payslip-header-logo img { display: block; height: 52px; width: auto; object-fit: contain; }
  .payslip-header h2 { margin: 0; font-size: 18px; letter-spacing: 0.5px; }
  .payslip-header h3 { margin: 6px 0 0 0; font-size: 14px; font-weight: 700; }
  .payslip-meta { display: grid; grid-template-columns: 1fr 1fr; border-bottom: 2px solid #111; }
  .payslip-box { border-right: 2px solid #111; padding: 10px 12px; }
  .payslip-box:last-child { border-right: none; }
  .payslip-kv { display: grid; grid-template-columns: 160px 1fr; gap: 8px 10px; font-size: 12px; }
  .payslip-kv .k { font-weight: 700; }
  .payslip-kv .v { font-weight: 600; }
  .payslip-body { display: grid; grid-template-columns: 1fr 1fr; }
  .payslip-table { width: 100%; border-collapse: collapse; }
  .payslip-table th, .payslip-table td { border: 1px solid #111; padding: 6px 8px; font-size: 12px; }
  .payslip-table th { background: #f2f2f2; text-align: left; }
  .payslip-table td.amount { text-align: right; font-variant-numeric: tabular-nums; }
  .payslip-kv .v.payslip-v-right { text-align: right; }
  .payslip-amount-split { display: flex; flex-direction: row; align-items: center; justify-content: flex-end; gap: 0; }
  .payslip-amount-split-left, .payslip-amount-split-right { padding: 0 6px; font-variant-numeric: tabular-nums; }
  .payslip-amount-split-vline { width: 0; border-left: 1px solid #111; align-self: stretch; min-height: 1.2em; }
  .payslip-gross-values { display: flex; justify-content: flex-end; gap: 16px; }
  .payslip-gross-actual, .payslip-gross-earned { font-variant-numeric: tabular-nums; }
  .payslip-footer { border-top: 2px solid #111; padding: 10px 12px; display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .payslip-footer > div:last-child { grid-column: 1 / -1; }
  .payslip-footer-summary { display: flex; flex-direction: column; gap: 0; grid-column: 1 / -1; margin: 0 -12px; padding: 0 12px; }
  /* Match .payslip-body (1fr | 1fr) so Gross lines up with earnings table; Total Deduction with deductions table */
  .payslip-summary-row-split { display: grid; grid-template-columns: 1fr 1fr; border: none; border-bottom: 1px solid #111; font-size: 12px; }
  .payslip-summary-row-split:last-of-type { border-bottom: 1px solid #111; }
  .payslip-summary-earnings-side { display: grid; grid-template-columns: 1fr 90px 90px; align-items: center; }
  .payslip-summary-deductions-side { display: grid; grid-template-columns: 1fr 140px; align-items: center; }
  .payslip-summary-cell { border: none; padding: 6px 8px; font-weight: 700; }
  .payslip-summary-cell.payslip-summary-value.amount { text-align: right; font-variant-numeric: tabular-nums; }
  .payslip-total { display: grid; grid-template-columns: 1fr 140px; gap: 8px; font-size: 12px; }
  .payslip-total .k { font-weight: 800; }
  .payslip-total .v { text-align: right; font-weight: 800; font-variant-numeric: tabular-nums; }
  @media print {
    body { padding: 0; }
    .payslip-sheet { margin: 0; }
  }
`;

// Styles scoped for in-page preview (do not affect global body styles).
const PREVIEW_STYLES = `
  .payslip-preview-scope, .payslip-preview-scope * { box-sizing: border-box; }
  .payslip-preview-scope { margin: 0; padding: 18px; font-family: Arial, Helvetica, sans-serif; color: #111; background: #fff; }
  .payslip-preview-scope .payslip-sheet { width: 900px; max-width: 100%; margin: 0 auto; border: 2px solid #111; background: #fff; }
  .payslip-preview-scope .payslip-header { padding: 10px 14px; border-bottom: 2px solid #111; }
  .payslip-preview-scope .payslip-header-inner { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
  .payslip-preview-scope .payslip-header-text { flex: 1; text-align: center; }
  .payslip-preview-scope .payslip-header-logo { flex-shrink: 0; }
  .payslip-preview-scope .payslip-header-logo img { display: block; height: 52px; width: auto; object-fit: contain; }
  .payslip-preview-scope .payslip-header h2 { margin: 0; font-size: 18px; letter-spacing: 0.5px; }
  .payslip-preview-scope .payslip-header h3 { margin: 6px 0 0 0; font-size: 14px; font-weight: 700; }
  .payslip-preview-scope .payslip-meta { display: grid; grid-template-columns: 1fr 1fr; border-bottom: 2px solid #111; }
  .payslip-preview-scope .payslip-box { border-right: 2px solid #111; padding: 10px 12px; }
  .payslip-preview-scope .payslip-box:last-child { border-right: none; }
  .payslip-preview-scope .payslip-kv { display: grid; grid-template-columns: 160px 1fr; gap: 8px 10px; font-size: 12px; }
  .payslip-preview-scope .payslip-kv .k { font-weight: 700; }
  .payslip-preview-scope .payslip-kv .v { font-weight: 600; }
  .payslip-preview-scope .payslip-body { display: grid; grid-template-columns: 1fr 1fr; }
  .payslip-preview-scope .payslip-table { width: 100%; border-collapse: collapse; }
  .payslip-preview-scope .payslip-table th, .payslip-preview-scope .payslip-table td { border: 1px solid #111; padding: 6px 8px; font-size: 12px; }
  .payslip-preview-scope .payslip-table th { background: #f2f2f2; text-align: left; }
  .payslip-preview-scope .payslip-table td.amount { text-align: right; font-variant-numeric: tabular-nums; }
  .payslip-preview-scope .payslip-kv .v.payslip-v-right { text-align: right; }
  .payslip-preview-scope .payslip-amount-split { display: flex; flex-direction: row; align-items: center; justify-content: flex-end; gap: 0; }
  .payslip-preview-scope .payslip-amount-split-left, .payslip-preview-scope .payslip-amount-split-right { padding: 0 6px; font-variant-numeric: tabular-nums; }
  .payslip-preview-scope .payslip-amount-split-vline { width: 0; border-left: 1px solid #111; align-self: stretch; min-height: 1.2em; }
  .payslip-preview-scope .payslip-gross-values { display: flex; justify-content: flex-end; gap: 16px; }
  .payslip-preview-scope .payslip-gross-actual, .payslip-preview-scope .payslip-gross-earned { font-variant-numeric: tabular-nums; }
  .payslip-preview-scope .payslip-footer { border-top: 2px solid #111; padding: 10px 12px; display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .payslip-preview-scope .payslip-footer > div:last-child { grid-column: 1 / -1; }
  .payslip-preview-scope .payslip-footer-summary { display: flex; flex-direction: column; gap: 0; grid-column: 1 / -1; margin: 0 -12px; padding: 0 12px; }
  .payslip-preview-scope .payslip-summary-row-split { display: grid; grid-template-columns: 1fr 1fr; border: none; border-bottom: 1px solid #111; font-size: 12px; }
  .payslip-preview-scope .payslip-summary-row-split:last-of-type { border-bottom: 1px solid #111; }
  .payslip-preview-scope .payslip-summary-earnings-side { display: grid; grid-template-columns: 1fr 90px 90px; align-items: center; }
  .payslip-preview-scope .payslip-summary-deductions-side { display: grid; grid-template-columns: 1fr 140px; align-items: center; }
  .payslip-preview-scope .payslip-summary-cell { border: none; padding: 6px 8px; font-weight: 700; }
  .payslip-preview-scope .payslip-summary-cell.payslip-summary-value.amount { text-align: right; font-variant-numeric: tabular-nums; }
  .payslip-preview-scope .payslip-total { display: grid; grid-template-columns: 1fr 140px; gap: 8px; font-size: 12px; }
  .payslip-preview-scope .payslip-total .k { font-weight: 800; }
  .payslip-preview-scope .payslip-total .v { text-align: right; font-weight: 800; font-variant-numeric: tabular-nums; }
`;

const buildPrintHtml = ({ title, styles, bodyHtml }) => `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>${styles}</style>
  </head>
  <body>${bodyHtml}</body>
</html>`;

const getTemplateConfigFromStorage = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      companyName: typeof parsed.companyName === 'string' ? parsed.companyName.trim() : '',
      earningKeys: Array.isArray(parsed.earningKeys) ? parsed.earningKeys : [],
      deductionKeys: Array.isArray(parsed.deductionKeys) ? parsed.deductionKeys : [],
      PayslipNames: typeof parsed.PayslipNames === 'string' ? parsed.PayslipNames : '',
    };
  } catch {
    return null;
  }
};

const normalizeKeyList = (list) => {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (const item of list) {
    const v = String(item ?? '').trim();
    if (!v) continue;
    const k = v.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
};

const parsePayslipNames = (raw) => {
  if (typeof raw !== 'string') return [];
  return normalizeKeyList(
    raw
      .split(',')
      .map((s) => String(s ?? '').trim())
      .filter(Boolean)
  );
};

const deriveKnownKeys = (payrollKeyToHeaderLabel) => {
  const keys = Object.keys(payrollKeyToHeaderLabel || {});
  const deny = new Set([
    'totalDeduction',
    'netPay',
    'total',
    'gst',
    'netTotal',
    'erpf',
    'admin',
    'edli',
    'employerEsi',
    'esiContribution',
    'employerLwf',
    'serviceCharge',
  ]);
  const earningKeys = keys.filter(
    (k) =>
      !deny.has(k) &&
      String(k).toLowerCase() !== 'otherallowances' &&
      !k.toLowerCase().includes('deduct') &&
      !k.toLowerCase().includes('pf') &&
      !k.toLowerCase().includes('esi') &&
      !k.toLowerCase().includes('pt') &&
      !k.toLowerCase().includes('lwf')
  );

  const allow = new Set(['pf', 'esi', 'pt', 'lwf', 'rent', 'advance', 'otherDeduction', 'totalDeduction']);
  const deductionKeys = keys.filter(
    (k) =>
      allow.has(k) ||
      k.toLowerCase().includes('deduct') ||
      k.toLowerCase().includes('pf') ||
      k.toLowerCase().includes('esi') ||
      k.toLowerCase().includes('pt') ||
      k.toLowerCase().includes('lwf')
  );

  return { earningKeys, deductionKeys };
};

const buildPayslipSheetHtml = ({
  employee,
  selectedMonth,
  payrollKeyToHeaderLabel,
  companyName,
  earningKeys,
  deductionKeys,
  logoUrl,
  getDisplayValue,
}) => {
  const labelForKey = (key) => (payrollKeyToHeaderLabel?.[key] ? payrollKeyToHeaderLabel[key] : key);

  const monthText = monthLabel(selectedMonth);
  const emp = employee || {};
  const getVal = getDisplayValue || null;

  const earningKeysForPayslip = stripOtherAllowanceFromEarningsKeys(earningKeys || []);

  // Use template names as-is for display; resolve each to table key and fetch value from employee (same lookup as payroll table)
  const earningsRows = earningKeysForPayslip.map((k) => {
    const displayLabel = k; // Keep template data name unchanged
    const resolvedKey = labelToKey(k, payrollKeyToHeaderLabel) || k;
    const { actual, earned } = getActualEarned(emp, resolvedKey, displayLabel, payrollKeyToHeaderLabel, getVal);
    return { key: resolvedKey, label: displayLabel, actual, earned };
  });

  const deductionsRowsRaw = (deductionKeys || []).map((k) => {
    const displayLabel = k; // Keep template data name unchanged
    const resolvedKey = labelToKey(k, payrollKeyToHeaderLabel) || k;
    const raw = getPayslipValue(emp, resolvedKey, displayLabel, getVal);
    return { key: resolvedKey, label: displayLabel, value: safeMoney(raw) };
  });
  const deductionsRows = filterDeductionRowsForPayslip(deductionsRowsRaw);

  const sumDeductionLinesExcludingTotalRow = (rows) => {
    let sum = 0;
    for (const r of rows || []) {
      const nl = normalizeLabelForMatch(String(r.label || '').trim().toLowerCase());
      if (nl === 'total deduction' || nl === 'total deductions') continue;
      const n = Number(String(r.value ?? '').replace(/,/g, '').trim());
      if (Number.isFinite(n)) sum += n;
    }
    return sum;
  };

  const grossEarnedFromRows = earningsRows.reduce((s, r) => s + (Number(r.earned) || 0), 0);
  const grossEarnedFromTable =
    safeMoney(getPayslipValue(emp, 'earnedSalaryCross', labelForKey('earnedSalaryCross'), getVal)) ||
    safeMoney(getPayslipValue(emp, 'earnedGrossSalary', labelForKey('earnedGrossSalary'), getVal));
  const grossEarnedDisplay = grossEarnedFromTable || safeMoney(String(grossEarnedFromRows));

  let totalDeductionValue = safeMoney(getPayslipValue(emp, 'totalDeduction', labelForKey('totalDeduction'), getVal));
  // Print / PDF paths may not pass Payroll getDisplayValue — total must still match visible deduction lines.
  const sumDedLines = sumDeductionLinesExcludingTotalRow(deductionsRows);
  if (!getVal && sumDedLines > 0) {
    totalDeductionValue = safeMoney(sumDedLines);
  }
  let netPayValue = safeMoney(getPayslipValue(emp, 'netPay', labelForKey('netPay'), getVal));
  if (!getVal && grossEarnedDisplay && totalDeductionValue) {
    const g = Number(grossEarnedDisplay);
    const d = Number(totalDeductionValue);
    if (Number.isFinite(g) && Number.isFinite(d)) netPayValue = safeMoney(g - d);
  }

  const earningsTr = earningsRows
    .map(
      (r) =>
        `<tr><td>${escapeHtml(r.label)}</td><td class="amount">${escapeHtml(amountForEarningsActualColumn(r.actual, r.label))}</td><td class="amount">${escapeHtml(amountForEarningsEarnedColumn(r.earned, r.label))}</td></tr>`
    )
    .join('');

  const deductionsTr = deductionsRows
    .map(
      (r) =>
        `<tr><td>${escapeHtml(deductionDisplayLabel(r.label, emp, getVal))}</td><td class="amount">${escapeHtml(hideZero(r.value))}</td></tr>`
    )
    .join('');

  const logoImg = logoUrl ? `<div class="payslip-header-logo"><img src="${escapeHtml(logoUrl)}" alt="" /></div>` : '';
  return `
    <div class="payslip-sheet">
      <div class="payslip-header">
        <div class="payslip-header-inner">
          <div class="payslip-header-text">
            <h2>${escapeHtml(String(companyName || '').trim() || 'S S INDUSTRIES')}</h2>
            <h3>${escapeHtml(monthText ? `PAY SLIP FOR THE MONTH OF ${monthText}` : 'PAY SLIP')}</h3>
          </div>
          ${logoImg}
        </div>
      </div>

      <div class="payslip-meta">
        <div class="payslip-box">
          <div class="payslip-kv">
            <div class="k">NAME</div>
            <div class="v payslip-v-right">${escapeHtml(emp.employeeName || '')}</div>
            <div class="k">DATE OF JOINING</div>
            <div class="v payslip-v-right">${escapeHtml(emp.dateOfJoining ? new Date(emp.dateOfJoining).toLocaleDateString('en-GB') : '')}</div>
            <div class="k">DEPARTMENT</div>
            <div class="v payslip-v-right">${escapeHtml(emp.department || '')}</div>
            <div class="k">DESIGNATION</div>
            <div class="v payslip-v-right">${escapeHtml(emp.designation || '')}</div>
          </div>
        </div>
        <div class="payslip-box">
          <div class="payslip-kv">
            <div class="k">UAN NO</div>
            <div class="v payslip-v-right">${escapeHtml(String(emp.uanNo ?? emp.UANNo ?? emp.uan ?? emp.uanNumber ?? ''))}</div>
            <div class="k">ESIC NO</div>
            <div class="v payslip-v-right">${escapeHtml(String(emp.esicNo ?? emp.ESICNo ?? emp.esic ?? emp.esicNumber ?? ''))}</div>
            <div class="k">Actual Days</div>
            <div class="v payslip-v-right">${escapeHtml(String(emp.daysPresent ?? ''))}</div>
            <div class="k">No of Working Days</div>
            <div class="v payslip-v-right">${escapeHtml(String(emp.daysInMonth ?? ''))}</div>
          </div>
        </div>
      </div>

      <div class="payslip-body">
        <table class="payslip-table payslip-table-earnings">
          <thead>
            <tr>
              <th>EARNINGS</th>
              <th class="amount" style="width: 90px;">Actual</th>
              <th class="amount" style="width: 90px;">Earnings</th>
            </tr>
          </thead>
          <tbody>${earningsTr}</tbody>
        </table>

        <table class="payslip-table">
          <thead>
            <tr>
              <th>DEDUCTIONS</th>
              <th class="amount" style="width: 140px;">AMOUNT</th>
            </tr>
          </thead>
          <tbody>${deductionsTr}</tbody>
        </table>
      </div>

      <div class="payslip-footer">
        <div class="payslip-footer-summary">
          <div class="payslip-summary-row-split">
            <div class="payslip-summary-earnings-side">
              <div class="payslip-summary-cell payslip-summary-label">Gross Salary</div>
              <div class="payslip-summary-cell" aria-hidden="true"></div>
              <div class="payslip-summary-cell payslip-summary-value amount">${escapeHtml(hideZero(grossEarnedDisplay))}</div>
            </div>
            <div class="payslip-summary-deductions-side">
              <div class="payslip-summary-cell payslip-summary-label">Total Deduction</div>
              <div class="payslip-summary-cell payslip-summary-value amount">${escapeHtml(hideZero(totalDeductionValue))}</div>
            </div>
          </div>
        </div>
        <div style="font-size: 11px; line-height: 1.4;">
          <div style="font-weight: 800; margin-bottom: 6px;">NetSalary <span style="font-variant-numeric: tabular-nums;">${escapeHtml(hideZero(netPayValue))}</span></div>
        </div>
      </div>
    </div>
  `;
};

export const openPayslipPrintDialog = ({
  employee,
  selectedMonth,
  payrollKeyToHeaderLabel,
  preferStoredTemplate = true,
  logoUrl,
}) => {
  const derived = deriveKnownKeys(payrollKeyToHeaderLabel);
  const stored = preferStoredTemplate ? getTemplateConfigFromStorage() : null;

  const companyName = stored?.companyName || 'S S INDUSTRIES';
  const earningKeys = (stored?.earningKeys && stored.earningKeys.length ? stored.earningKeys : derived.earningKeys) || [];
  const deductionKeys = (stored?.deductionKeys && stored.deductionKeys.length ? stored.deductionKeys : derived.deductionKeys) || [];

  const title = `Payslip_${employee?.employeeCode || 'employee'}_${selectedMonth || ''}`;
  const sheetHtml = buildPayslipSheetHtml({
    employee,
    selectedMonth,
    payrollKeyToHeaderLabel,
    companyName,
    earningKeys,
    deductionKeys,
    logoUrl,
  });

  const html = buildPrintHtml({
    title,
    styles: PRINT_STYLES,
    bodyHtml: sheetHtml,
  });

  const w = window.open('', '_blank', 'noopener,noreferrer');
  if (!w) return false;
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => {
    try {
      w.print();
    } catch {
      // ignore
    }
  }, 250);
  return true;
};

/**
 * Open payslip in a new window for viewing only (no auto-print, no download).
 */
export const openPayslipPreviewWindow = ({
  employee,
  selectedMonth,
  payrollKeyToHeaderLabel,
  preferStoredTemplate = true,
}) => {
  const derived = deriveKnownKeys(payrollKeyToHeaderLabel);
  const stored = preferStoredTemplate ? getTemplateConfigFromStorage() : null;

  const companyName = stored?.companyName || 'S S INDUSTRIES';
  const earningKeys = (stored?.earningKeys && stored.earningKeys.length ? stored.earningKeys : derived.earningKeys) || [];
  const deductionKeys = (stored?.deductionKeys && stored.deductionKeys.length ? stored.deductionKeys : derived.deductionKeys) || [];

  const title = `Payslip_${employee?.employeeCode || 'employee'}_${selectedMonth || ''}`;
  const sheetHtml = buildPayslipSheetHtml({
    employee,
    selectedMonth,
    payrollKeyToHeaderLabel,
    companyName,
    earningKeys,
    deductionKeys,
  });

  const html = buildPrintHtml({
    title,
    styles: PRINT_STYLES,
    bodyHtml: sheetHtml,
  });

  const w = window.open('', '_blank', 'noopener,noreferrer');
  if (!w) return false;
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.focus();
  return true;
};

/** Resolve company name and earnings/deduction keys (same rules as in-page preview). */
const resolvePayslipSheetKeysAndCompany = ({
  payrollKeyToHeaderLabel,
  preferStoredTemplate = true,
  strictTemplate = false,
  earningKeysOverride,
  deductionKeysOverride,
  companyNameOverride,
}) => {
  const derived = deriveKnownKeys(payrollKeyToHeaderLabel);
  const stored = preferStoredTemplate ? getTemplateConfigFromStorage() : null;

  const companyName = (typeof companyNameOverride === 'string' && companyNameOverride.trim())
    ? companyNameOverride.trim()
    : (stored?.companyName || 'S S INDUSTRIES');
  const storedEarningKeys =
    stored?.earningKeys && stored.earningKeys.length
      ? normalizeKeyList(stored.earningKeys)
      : parsePayslipNames(stored?.PayslipNames);
  const storedDeductionKeys = normalizeKeyList(stored?.deductionKeys);

  const resolvedEarningKeys = strictTemplate
    ? storedEarningKeys
    : (storedEarningKeys.length ? storedEarningKeys : (derived.earningKeys || []));
  const resolvedDeductionKeys = strictTemplate
    ? storedDeductionKeys
    : (storedDeductionKeys.length ? storedDeductionKeys : (derived.deductionKeys || []));
  const earningKeys = earningKeysOverride ? normalizeKeyList(earningKeysOverride) : resolvedEarningKeys;
  const deductionKeys = deductionKeysOverride ? normalizeKeyList(deductionKeysOverride) : resolvedDeductionKeys;

  return { companyName, earningKeys, deductionKeys };
};

/**
 * Build scoped HTML markup for showing payslip inside the current page.
 * Returns a string containing a <style> tag plus the payslip HTML.
 */
export const buildPayslipPreviewMarkup = ({
  employee,
  selectedMonth,
  payrollKeyToHeaderLabel,
  preferStoredTemplate = true,
  strictTemplate = false,
  earningKeysOverride,
  deductionKeysOverride,
  companyNameOverride,
  logoUrl,
  getDisplayValue,
}) => {
  const { companyName, earningKeys, deductionKeys } = resolvePayslipSheetKeysAndCompany({
    payrollKeyToHeaderLabel,
    preferStoredTemplate,
    strictTemplate,
    earningKeysOverride,
    deductionKeysOverride,
    companyNameOverride,
  });

  const sheetHtml = buildPayslipSheetHtml({
    employee,
    selectedMonth,
    payrollKeyToHeaderLabel,
    companyName,
    earningKeys,
    deductionKeys,
    logoUrl,
    getDisplayValue,
  });

  return `<style>${PREVIEW_STYLES}</style><div class="payslip-preview-scope">${sheetHtml}</div>`;
};

const runPayslipPdfWorker = ({
  employee,
  selectedMonth,
  payrollKeyToHeaderLabel,
  preferStoredTemplate = true,
  strictTemplate = false,
  earningKeysOverride,
  deductionKeysOverride,
  companyNameOverride,
  logoUrl,
  getDisplayValue,
  filename,
  output,
}) => {
  const { companyName, earningKeys, deductionKeys } = resolvePayslipSheetKeysAndCompany({
    payrollKeyToHeaderLabel,
    preferStoredTemplate,
    strictTemplate,
    earningKeysOverride,
    deductionKeysOverride,
    companyNameOverride,
  });

  const sheetHtml = buildPayslipSheetHtml({
    employee,
    selectedMonth,
    payrollKeyToHeaderLabel,
    companyName,
    earningKeys,
    deductionKeys,
    logoUrl,
    getDisplayValue,
  });

  removePayslipPdfGenerationArtifacts();
  const unlockViewportScrollX = lockViewportScrollX();

  // Off-screen on the main document (fixed does not widen layout like wide right-edge nodes).
  // html2canvas onclone moves the *clone* to the origin so capture matches View (iframe/srcdoc often stayed blank).
  const wrapperId = `payslip-pdf-wrapper-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const wrapper = document.createElement('div');
  wrapper.id = wrapperId;
  wrapper.setAttribute('aria-hidden', 'true');
  wrapper.innerHTML = `<style>${PRINT_STYLES}</style>${sheetHtml}`;
  wrapper.style.cssText = [
    'position:fixed',
    'left:-14000px',
    'top:0',
    'width:900px',
    'min-height:400px',
    'background:#ffffff',
    'overflow:visible',
    'opacity:1',
    'pointer-events:none',
    'box-sizing:border-box',
    'margin:0',
    'padding:0',
  ].join(';');
  document.body.appendChild(wrapper);

  const resolvedFilename = filename || `Payslip_${employee?.employeeCode || 'employee'}_${selectedMonth || ''}.pdf`;

  const cleanup = () => {
    unlockViewportScrollX();
    const el = document.getElementById(wrapperId);
    if (el?.parentNode) el.parentNode.removeChild(el);
    removePayslipPdfGenerationArtifacts();
  };

  const buildPdfFromCanvas = (canvas) => {
    const marginMm = 8;
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const usableW = pageW - marginMm * 2;
    const usableH = pageH - marginMm * 2;
    const imgData = canvas.toDataURL('image/jpeg', 0.92);
    const imgW = usableW;
    const imgH = (canvas.height * imgW) / canvas.width;

    let heightLeft = imgH;
    let y = marginMm;
    pdf.addImage(imgData, 'JPEG', marginMm, y, imgW, imgH);
    heightLeft -= usableH;

    while (heightLeft > 0) {
      y = marginMm - (imgH - heightLeft);
      pdf.addPage();
      pdf.addImage(imgData, 'JPEG', marginMm, y, imgW, imgH);
      heightLeft -= usableH;
    }

    return pdf;
  };

  return new Promise((resolve) => {
    (async () => {
      try {
        await new Promise((r) => {
          requestAnimationFrame(() => requestAnimationFrame(r));
        });
        await new Promise((r) => setTimeout(r, 40));

        await Promise.all(
          Array.from(wrapper.querySelectorAll('img')).map(
            (img) =>
              new Promise((res) => {
                if (img.complete) res();
                else {
                  img.onload = () => res();
                  img.onerror = () => res();
                  setTimeout(res, 12000);
                }
              })
          )
        );

        const canvas = await html2canvas(wrapper, {
          scale: 2,
          useCORS: true,
          logging: false,
          backgroundColor: '#ffffff',
          imageTimeout: 20000,
          onclone: (clonedDoc) => {
            const node = clonedDoc.getElementById(wrapperId);
            if (!node) return;
            node.style.cssText = [
              'position:relative',
              'left:0',
              'top:0',
              'width:900px',
              'min-height:400px',
              'background:#ffffff',
              'overflow:visible',
              'opacity:1',
              'pointer-events:none',
              'box-sizing:border-box',
              'margin:0',
              'padding:0',
            ].join(';');
            const b = clonedDoc.body;
            if (b) {
              b.style.margin = '0';
              b.style.padding = '0';
              b.style.backgroundColor = '#ffffff';
            }
          },
        });

        if (!canvas || canvas.width < 80 || canvas.height < 80) {
          throw new Error('Payslip capture produced an empty canvas');
        }

        const pdf = buildPdfFromCanvas(canvas);

        if (output === 'blob') {
          const blob = pdf.output('blob');
          cleanup();
          resolve(blob);
        } else {
          pdf.save(resolvedFilename);
          cleanup();
          resolve(true);
        }
      } catch (err) {
        console.error('Payslip PDF generation failed:', err);
        cleanup();
        resolve(output === 'blob' ? null : false);
      }
    })();
  });
};

/**
 * Directly download payslip as PDF (one-click, no print dialog).
 * Uses html2canvas + jsPDF (avoids html2pdf.js blank pages in Chrome).
 * Optional overrides match {@link buildPayslipPreviewMarkup} so PDF matches View / template.
 */
export const downloadPayslipPdf = ({
  employee,
  selectedMonth,
  payrollKeyToHeaderLabel,
  preferStoredTemplate = true,
  strictTemplate = false,
  earningKeysOverride,
  deductionKeysOverride,
  companyNameOverride,
  logoUrl,
  getDisplayValue,
}) => {
  const filename = `Payslip_${employee?.employeeCode || 'employee'}_${selectedMonth || ''}.pdf`;
  return runPayslipPdfWorker({
    employee,
    selectedMonth,
    payrollKeyToHeaderLabel,
    preferStoredTemplate,
    strictTemplate,
    earningKeysOverride,
    deductionKeysOverride,
    companyNameOverride,
    logoUrl,
    getDisplayValue,
    filename,
    output: 'save',
  });
};

/**
 * Same rendering as download; returns a PDF Blob (e.g. for ZIP) or null on failure.
 */
export const generatePayslipPdfBlob = (opts) =>
  runPayslipPdfWorker({
    ...opts,
    output: 'blob',
  });
