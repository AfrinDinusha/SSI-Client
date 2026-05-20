/**
 * Bank report salary from Setup & Configuration "Net Pay" formula (same source as Payroll),
 * with fallbacks aligned to Payroll.js grid Net Pay (Earned Gross − Total Deduction).
 */

export function normalizeFormulaVariable(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function skipNorm(arr) {
  return new Set((arr || []).map((x) => normalizeFormulaVariable(x)).filter(Boolean));
}

/**
 * TD sum is PF + … + Uniform Deduction + … . If Setup PF formula references "Uniform Deduction",
 * it would be counted again in uniformV — skip uniform while evaluating PF for this sum only.
 */
const BANK_REPORT_TD_PF_SKIP_UNIFORM_VARS = [
  'Uniform Deduction',
  'uniform deduction',
  'uniformDeduction',
  'UniformDeduction',
];

/** Labels skipped when resolving TD line items (avoid circular TD reference). */
const BANK_REPORT_TD_SKIP_SELF = ['Total Deduction', 'Total Deductions', 'total deduction'];

/** PF evaluation for bank TD / PF column: TD skip + uniform not embedded in PF amount. */
const BANK_REPORT_TD_PF_EVAL_SKIP = [...BANK_REPORT_TD_SKIP_SELF, ...BANK_REPORT_TD_PF_SKIP_UNIFORM_VARS];

function pickNum(row, ...keys) {
  for (const k of keys) {
    const v = row[k];
    if (v !== undefined && v !== null && v !== '') {
      const n = parseFloat(String(v).replace(/,/g, ''));
      if (Number.isFinite(n)) return n;
    }
  }
  return 0;
}

/** Calendar days in month for YYYY-MM (e.g. 2026-04 → 30). Used when Payroll.DaysInMonth is missing. */
function calendarDaysInMonthFromReportMonth(reportMonth) {
  const parts = String(reportMonth || '').trim().split('-').map(Number);
  const y = parts[0];
  const m = parts[1];
  if (!y || !m || m < 1 || m > 12) return 0;
  return new Date(y, m, 0).getDate();
}

/**
 * Same rule as Payroll.js getAttendanceBonusNumericForRow and payroll_function calcAttendanceBonus:
 * days in month = days present → 0; otherwise flat 1200 if DOJ ≤ one year before payroll month-end, else 800.
 * Returns null if days/DOJ/month cannot drive the rule (caller may fall back to stored AttendanceBonus).
 */
function attendanceBonusDeductionFlatFromDaysAndDoj(row, reportMonth) {
  if (!row || typeof row !== 'object') return null;
  let daysInMonth = pickNum(
    row,
    'daysInMonth',
    'DaysInMonth',
    'daysInMonthForCalc',
    'Days_In_Month',
    'DAYS_IN_MONTH'
  );
  if (daysInMonth <= 0 && reportMonth) {
    daysInMonth = calendarDaysInMonthFromReportMonth(reportMonth);
  }
  const daysPresent = pickNum(row, 'daysPresent', 'DaysPresent', 'days_present', 'DAYS_PRESENT');
  const dojRaw =
    row.dateOfJoining ?? row.DateofJoining ?? row.DateOfJoining ?? row.date_of_joining ?? '';
  const m = String(reportMonth || '').trim();
  if (!dojRaw || daysInMonth <= 0 || !m) return null;
  if (Number(daysPresent) === Number(daysInMonth)) return 0;
  const doj = new Date(dojRaw);
  if (isNaN(doj.getTime())) return null;
  const parts = m.split('-').map(Number);
  if (parts.length < 2 || isNaN(parts[0]) || isNaN(parts[1])) return null;
  const lastDayOfMonth = new Date(parts[0], parts[1], 0);
  const oneYearBefore = new Date(lastDayOfMonth);
  oneYearBefore.setFullYear(oneYearBefore.getFullYear() - 1);
  return doj <= oneYearBefore ? 1200 : 800;
}

/** Earned Basic = (Actual Basic ÷ days in month) × days present — dim/dp from payroll row. */
function earnedBasicProRataFromPayrollRow(actualBasic, daysInMonth, daysPresent) {
  const dim = Number(daysInMonth);
  const dp = Number(daysPresent);
  if (!Number.isFinite(dim) || dim <= 0 || !Number.isFinite(actualBasic)) return null;
  return Math.max(
    0,
    Math.round((actualBasic / dim) * (Number.isFinite(dp) ? dp : 0) * 100) / 100
  );
}

/**
 * First present numeric (same cleaning as payroll_function getEmployeeNumOptional) — used for TotalSalary on merged rows.
 */
function pickNumOptionalRow(row, ...keys) {
  if (!row || typeof row !== 'object') return null;
  for (const k of keys) {
    const v = row[k];
    if (v === undefined || v === null || v === '') continue;
    const cleaned = String(v).replace(/,/g, '').replace(/[^0-9.\-]/g, '');
    const n = parseFloat(cleaned);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * Same intent as payroll_function resolveActualTotalSalaryFromEmployee + payroll row Actual Total Gross.
 * Order: Employee TotalSalary / GrossSalary, then payroll actualTotalSalary / ActualTotalGross, then sum of components.
 */
function resolveActualTotalSalaryForBankReport(row, computedFallback) {
  const direct = pickNumOptionalRow(
    row,
    'TotalSalary',
    'totalSalary',
    'Total Salary',
    'Total Salary (Auto-calculated)',
    'GrossSalary',
    'grossSalary',
    'actualTotalSalary',
    'ActualTotalSalary',
    'ActualTotalGross',
    'actualTotalGross'
  );
  if (direct != null) return direct;
  return computedFallback;
}

/** Same as payroll_function evaluateFormulaExpression — for Setup "Actual Basic = Actual Total Salary * 55%" etc. */
function evaluateFormulaExpressionSimple(expression, context) {
  if (!expression || typeof expression !== 'string') return 0;
  try {
    let expr = String(expression).trim();
    expr = expr.replace(/(\d+(\.\d+)?)%/g, '($1 / 100)');
    const keys = Object.keys(context).filter((k) => k.length > 0).sort((a, b) => b.length - a.length);
    for (const key of keys) {
      const val = Number(context[key]);
      const num = Number.isFinite(val) ? val : 0;
      const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      expr = expr.replace(new RegExp(escaped, 'gi'), String(num));
    }
    expr = expr.replace(/\s+/g, ' ');
    expr = expr.replace(/\b[A-Za-z_][A-Za-z0-9_]*(?:\s+[A-Za-z_][A-Za-z0-9_]*)*\b/g, '0');
    expr = expr.replace(/\s+/g, '');
    if (!/^[\d\s+\-*/().]+$/.test(expr)) return 0;
    const n = Number(new Function('return (' + expr + ');')());
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

/** Same order as payroll_function getActualBasicAndSpecialAllowanceFromFormulae. */
function getActualBasicAndSpecialAllowanceFromFormulae(payrollFormulae, context) {
  let actualBasic = null;
  let actualHRA = null;
  let actualDA = null;
  let specialAllowance = null;
  if (!Array.isArray(payrollFormulae) || payrollFormulae.length === 0) {
    return { actualBasic, actualHRA, actualDA, specialAllowance };
  }
  const ctx = { ...context };
  for (const { variable, expression } of payrollFormulae) {
    const v = String(variable || '').trim();
    if (!v) continue;
    if (normalizeFormulaVariable(v) === 'actual basic') {
      const num = evaluateFormulaExpressionSimple(expression, ctx);
      actualBasic = Number.isFinite(num) ? num : null;
      if (actualBasic !== null) ctx['Actual Basic'] = actualBasic;
    }
  }
  for (const { variable, expression } of payrollFormulae) {
    const v = String(variable || '').trim();
    if (!v) continue;
    if (normalizeFormulaVariable(v) === 'actual hra') {
      const num = evaluateFormulaExpressionSimple(expression, ctx);
      actualHRA = Number.isFinite(num) ? num : null;
      if (actualHRA !== null) ctx['Actual HRA'] = actualHRA;
    }
  }
  for (const { variable, expression } of payrollFormulae) {
    const v = String(variable || '').trim();
    if (!v) continue;
    if (normalizeFormulaVariable(v) === 'actual da') {
      const num = evaluateFormulaExpressionSimple(expression, ctx);
      actualDA = Number.isFinite(num) ? num : null;
      if (actualDA !== null) ctx['Actual DA'] = actualDA;
    }
  }
  for (const { variable, expression } of payrollFormulae) {
    const v = String(variable || '').trim();
    if (!v) continue;
    if (normalizeFormulaVariable(v) === 'special allowance') {
      const num = evaluateFormulaExpressionSimple(expression, ctx);
      specialAllowance = Number.isFinite(num) ? num : null;
      if (specialAllowance !== null) ctx['Special Allowance'] = specialAllowance;
    }
  }
  return { actualBasic, actualHRA, actualDA, specialAllowance };
}

/**
 * Apply Setup Actual Basic (and related) formulae using Actual Total Salary context — same inputs as payroll_function.
 * Without this, Earned Basic pro-rata uses raw Payroll.ActualBasic from DB (wrong vs "Actual Total Salary * 55%").
 */
function applyActualBasicFormulaToBankRow(row, payrollFormulae) {
  const actualBasicEmp = pickNum(row, 'actualBasic', 'ActualBasic');
  const actualHRA = pickNum(row, 'actualHRA', 'ActualHRA');
  const actualDA = pickNum(row, 'actualDA', 'ActualDA');
  const otherAllowance = pickNum(
    row,
    'otherAllowance',
    'OtherAllowance',
    'AttendanceAllowance',
    'attendanceAllowance'
  );
  const otherAllowancesForTotal = pickNum(row, 'otherAllowances', 'OtherAllowances');
  const travelChargers = pickNum(
    row,
    'travelChargers',
    'TravelChargers',
    'travelCharges',
    'TravelCharges'
  );
  const specialAllowanceEmp = pickNum(row, 'specialAllowance', 'SpecialAllowance');
  const computedTotal =
    actualBasicEmp +
    actualHRA +
    actualDA +
    otherAllowance +
    otherAllowancesForTotal +
    travelChargers +
    specialAllowanceEmp;
  const actualTotalSalary = resolveActualTotalSalaryForBankReport(
    row,
    computedTotal
  );

  const pfContext = {
    'Actual Total Salary': actualTotalSalary,
    'Actual Total Gross': actualTotalSalary,
    'Actual HRA': actualHRA,
    'Actual DA': actualDA,
    'Attendance Allowance': otherAllowance,
    'Other Allowances': otherAllowancesForTotal,
    TravelChargers: travelChargers,
    'Travel Charges': travelChargers,
  };
  const fromForm = getActualBasicAndSpecialAllowanceFromFormulae(payrollFormulae, pfContext);
  const ab =
    fromForm.actualBasic !== null && fromForm.actualBasic !== undefined
      ? fromForm.actualBasic
      : actualBasicEmp;
  return { ...row, actualBasic: ab, ActualBasic: ab };
}

function isYashaswi(row) {
  return String(row?.contractor ?? row?.Contractor ?? '')
    .trim()
    .toLowerCase() === 'yashaswi academy for skills';
}

function isPfNorm(n) {
  return (
    n === 'pf' ||
    (n.startsWith('pf') && (/\b12\b/.test(n) || n.includes('%'))) ||
    n.includes('provident fund')
  );
}

/**
 * Bank report OT Amount / Incentive (fixed rules; Actual Basic = post–Setup Actual Basic on row):
 * OT Amount = if (OT Hours <= 20) then (Actual Basic / Days in month / 8 * OT Hours * 2) else (Actual Basic / Days in month / 8 * 20 * 2)
 * Incentive = if (OT Hours > 20) then (Actual Basic / Days in month / 8) * (OT Hours - 20) else 0
 */
function computeBankReportOtAmountIncentive(actualBasic, daysInMonth, otHoursRaw) {
  const dim = Number(daysInMonth);
  let oth = Number(otHoursRaw);
  if (!Number.isFinite(oth) || oth < 0) oth = 0;
  if (!Number.isFinite(dim) || dim <= 0 || !Number.isFinite(actualBasic) || actualBasic <= 0) {
    return { otAmount: 0, incentive: 0 };
  }
  const hourly = actualBasic / dim / 8;
  let otAmount;
  let incentive = 0;
  if (oth <= 20) {
    otAmount = hourly * oth * 2;
  } else {
    otAmount = hourly * 20 * 2;
    incentive = hourly * (oth - 20);
  }
  return {
    otAmount: Math.round(otAmount * 100) / 100,
    incentive: Math.round(incentive * 100) / 100,
  };
}

function rowVariantNumber(row, componentName) {
  const base = String(componentName || '').trim();
  if (!base) return null;
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
        : word.length <= 4 && word === word.toUpperCase()
          ? word
          : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
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
  ];
  if (camel && camel.length) {
    const pascalFromCamel = camel.charAt(0).toUpperCase() + camel.slice(1);
    if (!variants.includes(pascalFromCamel)) variants.push(pascalFromCamel);
  }
  for (const key of variants) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== '') {
      const val = row[key];
      if (typeof val === 'number' && Number.isFinite(val)) return Math.round(val);
      if (typeof val === 'string' && val !== '' && Number.isFinite(Number(val))) return Math.round(Number(val));
    }
  }
  return null;
}

/**
 * Bank report Uniform Deduction = No of days without uniforms × 25 (₹25 per day without uniform).
 */
function uniformDeductionForBankReport(row) {
  if (!row || typeof row !== 'object') return 0;
  const nu = pickNum(
    row,
    'noOfDaysWithoutUniforms',
    'NoOfDaysWithoutUniforms',
    'noofdayswithoutuniforms',
    'Noofdayswithoutuniforms'
  );
  return Math.round(Math.max(0, nu) * 25);
}

/**
 * Same parsing/evaluation strategy as Payroll.js evaluateFormulaExpression.
 */
export function evaluatePayrollMoneyExpression(expression, getVal, meta) {
  if (!expression) return 0;
  const { components = [], formulae = [], skipVariables = [], row: empRow = {} } = meta || {};
  const reserved = ['Math', 'min', 'max', 'round', 'floor', 'ceil', 'abs'];
  const skipVariableNorm = skipNorm(skipVariables);

  try {
    let expr = String(expression).trim();
    const formulaeForExpr = formulae || [];
    const allVarAndComponentNames = [
      ...(components || []),
      ...formulaeForExpr.map((f) => (f.variable || '').trim()).filter(Boolean),
    ];

    const namesWithPercent = [...new Set(allVarAndComponentNames.filter((n) => String(n).includes('%')))].sort(
      (a, b) => b.length - a.length
    );
    const percentPlaceholders = [];
    namesWithPercent.forEach((name) => {
      percentPlaceholders.push(name);
      const idx = percentPlaceholders.length - 1;
      const placeholder = `__P${idx}__`;
      expr = expr.replace(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), placeholder);
    });

    expr = expr.replace(/(\d+(\.\d+)?)%/g, '($1 / 100)');

    const periodVarNames = [
      'No. of Days in Month',
      'No. of Days Present',
      'No. of Days(In month)',
      'No. of Days (In Month)',
    ];
    const fromComponentsAndVars = allVarAndComponentNames.filter(
      (name) => String(name).includes(' ') && !String(name).includes('%')
    );
    const fromExpression = (expression.match(/[A-Za-z][A-Za-z0-9]*(?:\s+[A-Za-z][A-Za-z0-9]*)+/g) || [])
      .map((s) => s.trim())
      .filter(Boolean);
    const multiWordNames = [...new Set([...fromComponentsAndVars, ...fromExpression, ...periodVarNames])].sort(
      (a, b) => b.length - a.length
    );

    const placeholders = [];
    multiWordNames.forEach((name) => {
      if (!placeholders.includes(name)) {
        placeholders.push(name);
        const idx = placeholders.length - 1;
        const placeholder = `__M${idx}__`;
        expr = expr.replace(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), placeholder);
      }
    });

    expr = expr.replace(/[A-Za-z_][A-Za-z0-9_]*/g, (name) => {
      if (reserved.includes(name)) return name;
      if (/^__M\d+__$/.test(name)) return name;
      if (/^__P\d+__$/.test(name)) return name;
      return `getVal("${name}")`;
    });

    placeholders.forEach((name, i) => {
      expr = expr.replace(new RegExp(`__M${i}__`, 'g'), `getVal(${JSON.stringify(name)})`);
    });
    percentPlaceholders.forEach((name, i) => {
      expr = expr.replace(new RegExp(`__P${i}__`, 'g'), `getVal(${JSON.stringify(name)})`);
    });

    const wrappedGetVal = (name) => {
      if (skipVariableNorm.has(normalizeFormulaVariable(name))) return 0;
      const vNorm = normalizeFormulaVariable(name);
      if (
        vNorm === 'washing allowance' ||
        (vNorm.includes('washing') && (vNorm.includes('allowance') || vNorm.includes('allownace')))
      ) {
        const w = pickNum(empRow, 'washingAllowance', 'WashingAllowance');
        return Number.isFinite(w) ? w : 0;
      }
      if (vNorm === 'ot amount' || vNorm === 'otamount') {
        const o = pickNum(empRow, 'otAmount', 'OTAmount');
        return Number.isFinite(o) ? o : 0;
      }
      const raw = getVal(name);
      const num = parseFloat(raw);
      return Number.isFinite(num) ? num : 0;
    };

    // eslint-disable-next-line no-new-func
    const fn = new Function('getVal', `return (${expr});`);
    const result = fn(wrappedGetVal);
    const n = Number(result);
    return Number.isFinite(n) ? Math.round(n) : 0;
  } catch (e) {
    console.error('Bank report payroll formula error:', expression, e);
    return 0;
  }
}

/**
 * Same normalization as Payroll.js after GET /payroll (earned special allowance from days/LOH, PascalCase → numbers).
 * Without this, Earned Gross / deductions can drift from what the Payroll grid shows.
 */
export function normalizePayrollRowLikePayrollFetch(row) {
  if (!row || typeof row !== 'object') return row;
  const payrollFieldNumber = (...candidates) => {
    for (const v of candidates) {
      const raw = String(v ?? '').trim();
      if (!raw) continue;
      const cleaned = raw.replace(/[^0-9.\-]/g, '');
      const n = Number(cleaned);
      if (Number.isFinite(n)) return n;
    }
    return 0;
  };
  const specialAllowance = payrollFieldNumber(row.specialAllowance, row.SpecialAllowance);
  const rawEarnedSpecial = payrollFieldNumber(row.earnedSpecialAllowance, row.EarnedSpecialAllowance);
  const dim = payrollFieldNumber(row.daysInMonth, row.DaysInMonth) || 31;
  const dp = payrollFieldNumber(row.daysPresent, row.DaysPresent);
  const lohRow = payrollFieldNumber(row.loh, row.LOH);
  let earnedSpecialAllowance = rawEarnedSpecial;
  if (specialAllowance > 0 && rawEarnedSpecial === 0) {
    earnedSpecialAllowance =
      dim > 0
        ? Math.max(
            0,
            Math.round((specialAllowance / dim) * dp - (specialAllowance / dim / 8) * lohRow)
          )
        : 0;
  }
  return {
    ...row,
    actualBasic: payrollFieldNumber(row.actualBasic, row.ActualBasic),
    actualHRA: payrollFieldNumber(row.actualHRA, row.ActualHRA),
    actualDA: payrollFieldNumber(row.actualDA, row.ActualDA),
    otherAllowance: payrollFieldNumber(row.otherAllowance, row.OtherAllowance),
    specialAllowance,
    otherAllowances: payrollFieldNumber(row.otherAllowances, row.OtherAllowances),
    washingAllowance: payrollFieldNumber(row.washingAllowance, row.WashingAllowance),
    esi: Number(row.esi ?? row.ESI ?? 0) || 0,
    earnedBasic: Number(row.earnedBasic ?? row.EarnedBasic) || 0,
    earnedHRA: Number(row.earnedHRA ?? row.EarnedHRA) || 0,
    earnedDA: Number(row.earnedDA ?? row.EarnedDA) || 0,
    earnedSpecialAllowance,
    netPay: row.netPay ?? row.NetPay ?? row.net_pay ?? row.netpay,
    daysInMonth: row.daysInMonth ?? row.DaysInMonth,
    daysPresent: row.daysPresent ?? row.DaysPresent,
    loh: row.loh ?? row.LOH,
  };
}

/**
 * True when the payroll row carries an explicit Net Pay / NetPay value from the API (not only Total Net Payable).
 */
function hasExplicitNetPayOnRow(p) {
  if (!p || typeof p !== 'object') return false;
  if (p.netPay != null && String(p.netPay).trim() !== '') return true;
  if (p.NetPay != null && String(p.NetPay).trim() !== '') return true;
  if (p.net_pay != null && String(p.net_pay).trim() !== '') return true;
  if (p.netpay != null && String(p.netpay).trim() !== '') return true;
  return false;
}

/**
 * Stored take-home amount for bank transfer (matches payslip "Net Salary" / Payroll grid Net Pay).
 * Prefer Net Pay over Total Net Payable — Total Net Payable = Net Pay + Payable Amount and can be larger.
 */
export function pickNetPayFromPayrollRow(p) {
  if (!p || typeof p !== 'object') return null;
  const toNum = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const net = toNum(p.NetPay ?? p.Netpay ?? p.netPay ?? p.net_pay);
  const totalNet = toNum(p.TotalNetPayable ?? p.totalNetPayable);
  if (hasExplicitNetPayOnRow(p)) {
    return Math.round(net * 100) / 100;
  }
  if (totalNet > 0) return Math.round(totalNet * 100) / 100;
  if (net !== 0) return Math.round(net * 100) / 100;
  const combined = Math.round((totalNet || net) * 100) / 100;
  return Number.isFinite(combined) ? combined : null;
}

/**
 * Same construction as payroll_function/index.js Earned Gross (travel + OT + incentive + bonus + washing +
 * food + earned basic/HRA/special). Used when stored EarnedSalaryCross is inflated vs line items.
 */
function earnedGrossFromBackendComponentSum(row) {
  if (!row || typeof row !== 'object') return 0;
  // Use only stored OT from payroll row. Do not infer OT from hours when otAmount is 0 — that inflated gross
  // vs payslip (no OT in earnings) and produced bank amounts like 3443 instead of 2276.
  const ot = Math.max(0, pickNum(row, 'otAmount', 'OTAmount'));
  const sum =
    pickNum(row, 'travelChargers', 'TravelChargers', 'travelCharges', 'TravelCharges') +
    ot +
    pickNum(row, 'incentive') +
    pickNum(row, 'attendanceBonus', 'AttendanceBonus') +
    pickNum(row, 'washingAllowance', 'WashingAllowance') +
    pickNum(row, 'foodAllowance', 'FoodAllowance') +
    pickNum(row, 'earnedBasic', 'EarnedBasic') +
    pickNum(row, 'earnedHRA', 'EarnedHRA') +
    pickNum(row, 'earnedSpecialAllowance', 'EarnedSpecialAllowance');
  return Math.round(sum);
}

/**
 * Core payroll amounts using the same Setup formulae / resolution as Payroll.js (Earned Gross Salary formula,
 * Total Deduction when Setup defines it, else fixed PF+ESI+… sum; then gridNet = round(EGS − TD)).
 */
function computeBankReportPayrollAmounts(row, options) {
  if (!row || typeof row !== 'object') return null;
  row = normalizePayrollRowLikePayrollFetch({ ...row });
  const payrollFormulae = options?.payrollFormulae || [];
  const payrollComponents = options?.payrollComponents || [];
  const reportMonth = options?.reportMonth || '';

  row = applyActualBasicFormulaToBankRow(row, payrollFormulae);

  const findForm = (pred) => payrollFormulae.find((f) => pred(normalizeFormulaVariable(f.variable)));

  const esiEnabled = () => {
    const st = String(row.esiStatus ?? row.ESIStatus ?? '').trim().toLowerCase();
    return st !== 'no';
  };

  function ptSlab() {
    const earnedCross = pickNum(row, 'earnedSalaryCross', 'EarnedSalaryCross', 'earnedGrossSalary');
    let ptValue = 0;
    if (earnedCross >= 20001 / 6 && earnedCross <= 30000 / 6) ptValue = 172 / 6;
    else if (earnedCross >= 30001 / 6 && earnedCross <= 45000 / 6) ptValue = 430 / 6;
    else if (earnedCross >= 45001 / 6 && earnedCross <= 60000 / 6) ptValue = 856 / 6;
    else if (earnedCross >= 60001 / 6 && earnedCross <= 75000 / 6) ptValue = 1250 / 6;
    else if (earnedCross >= 75001 / 6) ptValue = 1250 / 6;
    return Math.round(ptValue);
  }

  let dimForEb = pickNum(
    row,
    'daysInMonth',
    'DaysInMonth',
    'daysInMonthForCalc',
    'Days_In_Month',
    'DAYS_IN_MONTH'
  );
  if (dimForEb <= 0 && reportMonth) {
    dimForEb = calendarDaysInMonthFromReportMonth(reportMonth);
  }
  const dpForEb = pickNum(row, 'daysPresent', 'DaysPresent', 'days_present', 'DAYS_PRESENT');
  /** After applyActualBasicFormulaToBankRow — same value as the Bank report "Actual Basic" column. */
  const abForEarned = pickNum(row, 'actualBasic', 'ActualBasic');
  let earnedBasicPayslip;
  if (dimForEb > 0) {
    const eb = earnedBasicProRataFromPayrollRow(abForEarned, dimForEb, dpForEb);
    earnedBasicPayslip = eb != null ? eb : Math.round(pickNum(row, 'earnedBasic', 'EarnedBasic'));
  } else {
    earnedBasicPayslip = Math.round(pickNum(row, 'earnedBasic', 'EarnedBasic'));
  }

  function resolveValue(name, skipList) {
    const sk = skipNorm(skipList);
    const n = normalizeFormulaVariable(name);
    if (sk.has(n)) return 0;
    if (n === 'net pay' || n === 'netpay') return 0;

    if (n.includes('no. of days present') || (n.includes('days') && n.includes('present'))) {
      return pickNum(row, 'daysPresent', 'DaysPresent');
    }
    if (n.includes('no. of days') && n.includes('month')) {
      return pickNum(row, 'daysInMonth', 'DaysInMonth', 'daysInMonthForCalc');
    }
    if (n === 'loh' || n.includes('loss of hours')) return pickNum(row, 'loh', 'LOH');
    if (n === 'lop' || n.includes('loss of pay')) return pickNum(row, 'lop', 'LOP');
    if (n.includes('ot hours') || n === 'ot') return pickNum(row, 'otHours', 'OTHours');

    if (n === 'ot amount' || (n.includes('ot') && n.includes('amount') && !n.includes('hours') && !n.includes('arrear'))) {
      const { otAmount } = computeBankReportOtAmountIncentive(
        abForEarned,
        dimForEb,
        pickNum(row, 'otHours', 'OTHours')
      );
      return otAmount;
    }

    if (n === 'incentive') {
      const { incentive } = computeBankReportOtAmountIncentive(
        abForEarned,
        dimForEb,
        pickNum(row, 'otHours', 'OTHours')
      );
      return incentive;
    }

    if (n.includes('food') && (n.includes('allowance') || n.includes('allownace'))) {
      return Math.round(pickNum(row, 'foodAllowance', 'FoodAllowance'));
    }
    if (n.includes('loan') && n.includes('allowance')) return Math.round(pickNum(row, 'loanAllowance', 'LoanAllowance'));
    if (n.includes('washing') && (n.includes('allowance') || n.includes('allownace'))) {
      const w = pickNum(row, 'washingAllowance', 'WashingAllowance');
      if (w > 0) return w;
      const dp = pickNum(row, 'daysPresent', 'DaysPresent');
      const nu = pickNum(row, 'noOfDaysWithoutUniforms', 'NoOfDaysWithoutUniforms');
      return Math.round(25 * Math.max(0, dp - nu));
    }

    if (
      n === 'uniform deduction' ||
      (n.includes('uniform') && n.includes('deduction') && !n.includes('allowance') && !n.includes('allownace'))
    ) {
      return uniformDeductionForBankReport(row);
    }
    if (
      n.includes('uniform') &&
      (n.includes('allowance') || n.includes('allownace')) &&
      !n.includes('deduction')
    ) {
      return Math.round(pickNum(row, 'uniformAllowance', 'UniformAllowance'));
    }

    if (n === 'esi' || ((n.includes('esi') && (n.includes('0.75') || n.includes('%'))) && !n.includes('employer'))) {
      if (isYashaswi(row) || !esiEnabled()) return 0;
      // Bank report ESI rule: ESI = (Earned Basic + OT Amount + Incentive) * 0.75%
      const otAmt = resolveValue('OT Amount', skipList);
      const incentiveAmt = resolveValue('Incentive', skipList);
      const base = earnedBasicPayslip + otAmt + incentiveAmt;
      return base > 0 ? Math.round(base * 0.0075) : 0;
    }

    if (isPfNorm(n)) {
      if (isYashaswi(row)) return 0;
      const pfForm = findForm(
        (v) => v === 'pf' || (v.includes('pf') && !v.includes('employer') && (v.includes('12') || v.includes('%')))
      );
      if (pfForm?.expression) {
        const ev = evaluatePayrollMoneyExpression(
          pfForm.expression,
          (nm) => resolveValue(nm, [...skipList, pfForm.variable, 'PF', 'PF 12%']),
          {
            components: payrollComponents,
            formulae: payrollFormulae,
            skipVariables: [...skipList, pfForm.variable],
            row,
          }
        );
        if (Number.isFinite(ev)) return ev;
      }
      if (earnedBasicPayslip <= 0) return 0;
      if (earnedBasicPayslip > 15000) return 1800;
      return Math.round(earnedBasicPayslip * 0.12);
    }

    if (n === 'pt' || n.includes('professional tax')) {
      if (isYashaswi(row)) return 0;
      const ptForm = findForm((v) => v === 'pt' || v.includes('professional tax'));
      if (ptForm?.expression) {
        const ev = evaluatePayrollMoneyExpression(
          ptForm.expression,
          (nm) => resolveValue(nm, [...skipList, ptForm.variable, 'PT']),
          {
            components: payrollComponents,
            formulae: payrollFormulae,
            skipVariables: [...skipList, ptForm.variable],
            row,
          }
        );
        if (Number.isFinite(ev)) return ev;
      }
      const saved = pickNum(row, 'pt', 'PT');
      if (saved > 0) return Math.round(saved);
      return ptSlab();
    }

    if (n === 'other deduction') return Math.round(pickNum(row, 'otherDeduction', 'OtherDeduction'));
    if (n === 'lwf') return Math.round(pickNum(row, 'lwf', 'LWF'));
    if (n.includes('rent')) return Math.round(pickNum(row, 'rent', 'Rent'));
    if (n.includes('travel') && n.includes('charge')) {
      return Math.round(pickNum(row, 'travelChargers', 'TravelChargers', 'travelCharges', 'TravelCharges'));
    }
    if (n === 'late') {
      if (isYashaswi(row)) return 0;
      // Bank report Late: payroll LOH is post-grace; 0 if LOH ≤ 0, else Basic ÷ days ÷ 8 × 2 × LOH
      const lohVal = pickNum(row, 'loh', 'LOH');
      if (!Number.isFinite(lohVal) || lohVal <= 0) return 0;
      let dimLate = dimForEb;
      if (dimLate <= 0) {
        dimLate = pickNum(
          row,
          'daysInMonth',
          'DaysInMonth',
          'daysInMonthForCalc',
          'Days_In_Month',
          'DAYS_IN_MONTH'
        );
        if (dimLate <= 0 && reportMonth) dimLate = calendarDaysInMonthFromReportMonth(reportMonth);
      }
      if (dimLate <= 0 || !Number.isFinite(abForEarned)) {
        return Math.round(pickNum(row, 'late', 'Late'));
      }
      const lateAmt = (abForEarned / dimLate / 8) * 2 * lohVal;
      return Math.round(lateAmt);
    }

    if (n.includes('earned') && n.includes('gross') && (n.includes('salary') || n.includes('cross'))) {
      return Math.round(
        pickNum(row, 'earnedSalaryCross', 'EarnedSalaryCross', 'earnedGrossSalary', 'EarnedGrossSalary')
      );
    }

    if (n === 'total deduction' || n === 'total deductions') {
      const skipTd = [...skipList, ...BANK_REPORT_TD_SKIP_SELF];
      const skipTdPf = [...skipTd, ...BANK_REPORT_TD_PF_SKIP_UNIFORM_VARS];
      // Always component sum (ignore Setup "Total Deduction" formula so Late and every line item is included).
      // Total Deduction = PF + ESI + Loan Allowance + Uniform Deduction + Attendance Deduction + Late
      const pfV = resolveValue('PF', skipTdPf);
      const esiV = Math.round(resolveValue('ESI', skipTd));
      const loanV = Math.round(pickNum(row, 'loanAllowance', 'LoanAllowance'));
      const uniformV = uniformDeductionForBankReport(row);
      const attDedV = Math.round(resolveValue('Attendance Deduction', skipTd));
      const lateV = Math.round(resolveValue('Late', skipTd));
      return Math.round(pfV + esiV + loanV + uniformV + attDedV + lateV);
    }

    if (n === 'earned basic') return earnedBasicPayslip;
    if (n === 'earned hra') return Math.round(pickNum(row, 'earnedHRA', 'EarnedHRA'));
    if (n === 'earned da') return Math.round(pickNum(row, 'earnedDA', 'EarnedDA'));
    if (n === 'earned special allowance') {
      return Math.round(pickNum(row, 'earnedSpecialAllowance', 'EarnedSpecialAllowance'));
    }

    if (n.includes('attendance') && n.includes('bonus')) {
      const flat = attendanceBonusDeductionFlatFromDaysAndDoj(row, reportMonth);
      if (flat !== null) return flat;
      const v = pickNum(row, 'attendanceBonus', 'AttendanceBonus');
      return Number.isFinite(v) ? Math.round(v) : 0;
    }

    // Attendance Deduction: same rule as Attendance Bonus / calcAttendanceBonus (partial month → 1200 or 800 by tenure).
    if (n.includes('attendance') && n.includes('deduction')) {
      const flat = attendanceBonusDeductionFlatFromDaysAndDoj(row, reportMonth);
      if (flat !== null) return flat;
      const v = pickNum(row, 'attendanceBonus', 'AttendanceBonus');
      return Number.isFinite(v) ? Math.round(v) : 0;
    }

    if (n === 'other allowance' || n === 'other allowances') {
      const v = row.otherAllowances ?? row.otherAllowance;
      if (v !== '' && v !== null && v !== undefined) {
        const num = parseFloat(v);
        return Number.isFinite(num) ? num : 0;
      }
      return 0;
    }

    const fallback = rowVariantNumber(row, name);
    return fallback != null ? fallback : 0;
  }

  const ebFormula = findForm((v) => v === 'earned basic');
  if (ebFormula?.expression) {
    const ebSkip = [
      ebFormula.variable,
      'Earned Basic',
      'earnedBasic',
      'EarnedBasic',
    ].filter(Boolean);
    const evEb = evaluatePayrollMoneyExpression(
      ebFormula.expression,
      (nm) => resolveValue(nm, ebSkip),
      {
        components: payrollComponents,
        formulae: payrollFormulae,
        skipVariables: ebSkip,
        row,
      }
    );
    if (Number.isFinite(evEb)) {
      earnedBasicPayslip = Math.round(evEb);
    }
  }

  row = { ...row, earnedBasic: earnedBasicPayslip, EarnedBasic: earnedBasicPayslip };

  const storedEgs = pickNum(
    row,
    'earnedSalaryCross',
    'EarnedSalaryCross',
    'earnedGrossSalary',
    'EarnedGrossSalary'
  );
  const compEgs = earnedGrossFromBackendComponentSum(row);
  // Payroll.js re-runs Setup "Earned Gross Salary" after GET /payroll (applyPayrollFormulaeToEmployee); Bank Format
  // must do the same or it uses stale EarnedSalaryCross from the API (e.g. 3804 vs payslip 2637 → wrong bank net).
  const egsFormula = findForm((v) => v === 'earned gross salary' || v === 'earned gross cross');
  let earnedGrossPayslip = storedEgs;
  if (egsFormula?.expression) {
    const egsSkip = [
      egsFormula.variable,
      'Earned Gross Salary',
      'Earned Gross Cross',
      'earnedGrossSalary',
      'EarnedGrossSalary',
    ].filter(Boolean);
    const ev = evaluatePayrollMoneyExpression(
      egsFormula.expression,
      (nm) => resolveValue(nm, egsSkip),
      {
        components: payrollComponents,
        formulae: payrollFormulae,
        skipVariables: egsSkip,
        row,
      }
    );
    if (Number.isFinite(ev) && ev > 0) {
      let eg = Math.round(ev);
      // When formula result still tracks inflated stored EGS but line-item sum matches payslip, prefer the sum
      // (same idea as Payroll after wash/OT sync). Threshold avoids replacing with an incomplete component sum.
      if (compEgs > 0 && compEgs < eg) {
        const rel = (eg - compEgs) / eg;
        if (rel >= 0.22) eg = compEgs;
      }
      earnedGrossPayslip = eg;
    } else if (compEgs > 0) {
      earnedGrossPayslip = compEgs;
    }
  } else if (compEgs > 0) {
    earnedGrossPayslip = compEgs;
  }
  const totalDedPayslip = resolveValue('Total Deduction', []);
  const tdStored = pickNum(row, 'totalDeduction', 'TotalDeduction');

  // Bank report / salary amount: Net Pay = Earned Gross Salary − Total Deduction (no Setup "Net Pay" override).
  const gridNet = Math.round(earnedGrossPayslip - totalDedPayslip);

  const otHoursBank = pickNum(row, 'otHours', 'OTHours');
  const { otAmount: bankOtComputed, incentive: bankIncentiveComputed } =
    computeBankReportOtAmountIncentive(abForEarned, dimForEb, otHoursBank);

  // Line items that sum to totalDedPayslip (same rules as resolveValue Total Deduction branch).
  const pfPayslip = Math.round(resolveValue('PF', BANK_REPORT_TD_PF_EVAL_SKIP));
  const esiPayslip = Math.round(resolveValue('ESI', BANK_REPORT_TD_SKIP_SELF));
  const loanPayslip = Math.round(pickNum(row, 'loanAllowance', 'LoanAllowance'));
  const uniformDeductionPayslip = uniformDeductionForBankReport(row);
  const attendanceDeductionPayslip = Math.round(resolveValue('Attendance Deduction', BANK_REPORT_TD_SKIP_SELF));
  const latePayslip = Math.round(resolveValue('Late', BANK_REPORT_TD_SKIP_SELF));
  const otAmountPayslip = Math.round(bankOtComputed);
  const incentivePayslip = Math.round(bankIncentiveComputed);

  return {
    row,
    storedEgs,
    tdStored,
    earnedBasicPayslip,
    earnedGrossPayslip,
    totalDedPayslip,
    gridNet,
    pfPayslip,
    esiPayslip,
    loanPayslip,
    uniformDeductionPayslip,
    attendanceDeductionPayslip,
    latePayslip,
    otAmountPayslip,
    incentivePayslip,
  };
}

/**
 * Bank Format columns: Net Pay = round(Earned Gross Salary − Total Deduction); other amounts from bank pipeline.
 */
export function payrollDisplayAlignedWithPayrollGrid(row, options) {
  const c = computeBankReportPayrollAmounts(row, options);
  if (!c) return null;
  const reportMonth = options?.reportMonth || '';
  let dim = pickNum(
    c.row,
    'daysInMonth',
    'DaysInMonth',
    'daysInMonthForCalc',
    'Days_In_Month',
    'DAYS_IN_MONTH'
  );
  if (dim <= 0 && reportMonth) {
    dim = calendarDaysInMonthFromReportMonth(reportMonth);
  }
  const dp = pickNum(c.row, 'daysPresent', 'DaysPresent', 'days_present', 'DAYS_PRESENT');
  const ab = pickNum(c.row, 'actualBasic', 'ActualBasic');
  let earnedBasic = c.earnedBasicPayslip;
  if (dim > 0) {
    const eb = earnedBasicProRataFromPayrollRow(ab, dim, dp);
    if (eb != null) earnedBasic = eb;
  }
  return {
    actualBasic: Number.isFinite(ab) ? ab : null,
    earnedBasic,
    earnedGross: c.earnedGrossPayslip,
    totalDeduction: c.totalDedPayslip,
    netPay: c.gridNet,
    pf: c.pfPayslip,
    esi: c.esiPayslip,
    loanAllowance: c.loanPayslip,
    uniformDeduction: c.uniformDeductionPayslip,
    attendanceDeduction: c.attendanceDeductionPayslip,
    late: c.latePayslip,
    otAmount: c.otAmountPayslip,
    incentive: c.incentivePayslip,
  };
}

/**
 * Net salary for bank transfer: grid-aligned net plus optional caps vs stored API netPay (bank credit amount).
 */
export function bankReportNetPayFromSetup(row, options) {
  const c = computeBankReportPayrollAmounts(row, options);
  if (!c) return null;
  const r = c.row;
  let out = c.gridNet;
  const { storedEgs, tdStored } = c;
  // Cross-check with stored EGS − stored total deduction (grid footer); take lower net if template TD differs.
  const netFromStoredFields =
    storedEgs > 0 && tdStored >= 0 ? Math.round(storedEgs - tdStored) : null;
  if (netFromStoredFields != null && Number.isFinite(netFromStoredFields) && netFromStoredFields < out) {
    out = netFromStoredFields;
  }
  // API netPay is finalNetPay (after rent/advance); payslip net is usually EGS−TD. Prefer smaller when computed high.
  const savedNet = Math.round(pickNum(r, 'netPay', 'NetPay', 'net_pay', 'netpay'));
  if (Number.isFinite(savedNet) && savedNet > 0 && out > savedNet + 25) {
    out = savedNet;
  }
  const hasEgsNum =
    pickNum(r, 'earnedSalaryCross', 'EarnedSalaryCross', 'earnedGrossSalary', 'EarnedGrossSalary') !== 0;
  const hasTdNum = pickNum(r, 'totalDeduction', 'TotalDeduction') !== 0;
  if (!hasEgsNum && !hasTdNum && out === 0) {
    const picked = pickNetPayFromPayrollRow(r);
    if (picked != null && Number.isFinite(picked)) return Math.round(picked);
    for (const k of ['netPay', 'NetPay', 'netpay', 'net_pay']) {
      const v = r[k];
      if (v == null || v === '') continue;
      const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, ''));
      if (Number.isFinite(n)) return Math.round(n);
    }
  }
  return out;
}

/**
 * Normalize Catalyst/setupconfig GET /payroll/formulae payloads ({ data: { formulae } }, or legacy shapes).
 */
export function extractPayrollFormulaeRows(apiJson) {
  if (!apiJson || typeof apiJson !== 'object') return [];
  if (Array.isArray(apiJson.formulae)) return apiJson.formulae;
  const d = apiJson.data;
  if (d && Array.isArray(d.formulae)) return d.formulae;
  if (Array.isArray(d)) return d;
  return [];
}

export function parsePayrollFormulaeFromApi(rawFormulae) {
  const rows = Array.isArray(rawFormulae) ? rawFormulae : [];
  return rows
    .map((row) => {
      if (!row || typeof row !== 'object') return null;
      let variable = (row.variable || row.Variable || '').trim();
      let expression = (row.expression || row.Expression || row.Formulas || '').trim();
      if (expression && expression.includes('=') && !variable) {
        const idx = expression.indexOf('=');
        variable = expression.slice(0, idx).trim();
        expression = expression.slice(idx + 1).trim();
      }
      if (!variable || !expression) return null;
      return { variable, expression };
    })
    .filter(Boolean);
}

export function parsePayrollComponentsFromApi(componentsJson) {
  const raw = componentsJson?.data?.components || [];
  return raw
    .map((item) => {
      if (!item) return null;
      if (typeof item === 'string') return item;
      if (typeof item.allFields === 'string') return item.allFields;
      return null;
    })
    .filter(Boolean);
}
