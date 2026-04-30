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

function builtInOtAmount(row) {
  let dim = Number(row.daysInMonth ?? row.DaysInMonth ?? 0) || 0;
  if (dim <= 0) dim = 31;
  const oth = Number(row.otHours ?? row.OTHours ?? 0) || 0;
  const eb = Number(row.earnedBasic ?? row.EarnedBasic ?? 0) || 0;
  if (dim <= 0 || oth <= 0) return 0;
  return Math.round(((eb / dim) / 8) * oth * 2);
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
 * food + uniform + earned basic/HRA/special). Used when stored EarnedSalaryCross is inflated vs line items.
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
    pickNum(row, 'uniformAllowance', 'UniformAllowance') +
    pickNum(row, 'earnedBasic', 'EarnedBasic') +
    pickNum(row, 'earnedHRA', 'EarnedHRA') +
    pickNum(row, 'earnedSpecialAllowance', 'EarnedSpecialAllowance');
  return Math.round(sum);
}

/**
 * Core payroll amounts using the same Setup formulae / resolution as Payroll.js (Earned Gross Salary formula,
 * Total Deduction formula / payslip keys, then gridNet = round(EGS − TD)).
 */
function computeBankReportPayrollAmounts(row, options) {
  if (!row || typeof row !== 'object') return null;
  row = normalizePayrollRowLikePayrollFetch({ ...row });
  const payrollFormulae = options?.payrollFormulae || [];
  const payrollComponents = options?.payrollComponents || [];
  const deductionKeys = Array.isArray(options?.payslipTemplateConfig?.deductionKeys)
    ? options.payslipTemplateConfig.deductionKeys
    : [];
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
      const o = pickNum(row, 'otAmount', 'OTAmount');
      if (o > 0) return o;
      return builtInOtAmount(row);
    }

    if (n.includes('food') && (n.includes('allowance') || n.includes('allownace'))) {
      return Math.round(pickNum(row, 'foodAllowance', 'FoodAllowance'));
    }
    if (n.includes('loan') && n.includes('allowance')) return Math.round(pickNum(row, 'loanAllowance', 'LoanAllowance'));
    if (n.includes('uniform') && (n.includes('allowance') || n.includes('allownace'))) {
      return Math.round(pickNum(row, 'uniformAllowance', 'UniformAllowance'));
    }
    if (n.includes('washing') && (n.includes('allowance') || n.includes('allownace'))) {
      const w = pickNum(row, 'washingAllowance', 'WashingAllowance');
      if (w > 0) return w;
      const dp = pickNum(row, 'daysPresent', 'DaysPresent');
      const nu = pickNum(row, 'noOfDaysWithoutUniforms', 'NoOfDaysWithoutUniforms');
      return Math.round(25 * Math.max(0, dp - nu));
    }

    if (n === 'esi' || ((n.includes('esi') && (n.includes('0.75') || n.includes('%'))) && !n.includes('employer'))) {
      if (isYashaswi(row) || !esiEnabled()) return 0;
      const esiForm = findForm(
        (v) =>
          (v === 'esi' || v === 'esi 0.75%' || (v.includes('esi') && v.includes('0.75'))) && !v.includes('employer')
      );
      if (esiForm?.expression) {
        const ev = evaluatePayrollMoneyExpression(
          esiForm.expression,
          (nm) => resolveValue(nm, [...skipList, esiForm.variable, 'ESI', 'ESI 0.75%']),
          {
            components: payrollComponents,
            formulae: payrollFormulae,
            skipVariables: [...skipList, esiForm.variable],
            row,
          }
        );
        if (Number.isFinite(ev)) return ev;
      }
      const base =
        earnedBasicPayslip +
        pickNum(row, 'earnedHRA', 'EarnedHRA') +
        pickNum(row, 'earnedSpecialAllowance', 'EarnedSpecialAllowance') +
        resolveValue('OT Amount', skipList) +
        resolveValue('Travel Charges', skipList);
      return base > 0 ? Math.ceil(base * 0.0075) : 0;
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
      const earnedPlusSpecial =
        earnedBasicPayslip + pickNum(row, 'earnedSpecialAllowance', 'EarnedSpecialAllowance');
      if (earnedPlusSpecial <= 0) return 0;
      if (earnedPlusSpecial > 15000) return 1800;
      return Math.round(earnedPlusSpecial * 0.12);
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
    if (n === 'late') return Math.round(pickNum(row, 'late', 'Late'));

    if (n.includes('earned') && n.includes('gross') && (n.includes('salary') || n.includes('cross'))) {
      return Math.round(
        pickNum(row, 'earnedSalaryCross', 'EarnedSalaryCross', 'earnedGrossSalary', 'EarnedGrossSalary')
      );
    }

    if (n === 'total deduction' || n === 'total deductions') {
      const tdForm = findForm((v) => v === 'total deduction' || v === 'total deductions');
      if (tdForm?.expression) {
        const ev = evaluatePayrollMoneyExpression(
          tdForm.expression,
          (nm) =>
            resolveValue(nm, [...skipList, tdForm.variable, 'Total Deduction', 'Total Deductions', 'total deduction']),
          {
            components: payrollComponents,
            formulae: payrollFormulae,
            skipVariables: [...skipList, tdForm.variable],
            row,
          }
        );
        if (Number.isFinite(ev)) return ev;
      }
      if (deductionKeys.length > 0) {
        let sum = 0;
        for (const k of deductionKeys) {
          const lk = String(k || '')
            .trim()
            .toLowerCase();
          if (!lk || lk.includes('total deduction') || lk.includes('net pay')) continue;
          sum += resolveValue(k, [...skipList, 'Total Deduction', 'Total Deductions']);
        }
        return Math.round(sum);
      }
      return Math.round(pickNum(row, 'totalDeduction', 'TotalDeduction'));
    }

    if (n === 'earned basic') return earnedBasicPayslip;
    if (n === 'earned hra') return Math.round(pickNum(row, 'earnedHRA', 'EarnedHRA'));
    if (n === 'earned da') return Math.round(pickNum(row, 'earnedDA', 'EarnedDA'));
    if (n === 'earned special allowance') {
      return Math.round(pickNum(row, 'earnedSpecialAllowance', 'EarnedSpecialAllowance'));
    }

    if (n.includes('attendance') && n.includes('bonus')) {
      const v = pickNum(row, 'attendanceBonus', 'AttendanceBonus');
      if (v > 0) return Math.round(v);
      const daysInMonth = pickNum(row, 'daysInMonth', 'DaysInMonth');
      const daysPresent = pickNum(row, 'daysPresent', 'DaysPresent');
      const dojRaw =
        row.dateOfJoining ?? row.DateofJoining ?? row.DateOfJoining ?? row.date_of_joining ?? '';
      if (dojRaw && daysInMonth > 0 && daysPresent === daysInMonth && reportMonth) {
        const doj = new Date(dojRaw);
        if (!isNaN(doj.getTime())) {
          const parts = String(reportMonth).split('-').map(Number);
          if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
            const lastDayOfMonth = new Date(parts[0], parts[1], 0);
            const oneYearBefore = new Date(lastDayOfMonth);
            oneYearBefore.setFullYear(oneYearBefore.getFullYear() - 1);
            return doj <= oneYearBefore ? 1200 : 800;
          }
        }
      }
      return 0;
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

  // Setup & Configuration: evaluate "Net Pay" formula when present (Components → Formulae, variable Net Pay).
  // Bind Earned Gross Salary / Total Deduction tokens to the same computed values as above (not raw API EGS).
  const netPayFormula = findForm((v) => {
    const nv = normalizeFormulaVariable(v);
    return nv === 'net pay' || nv === 'netpay';
  });
  let gridNet = Math.round(earnedGrossPayslip - totalDedPayslip);
  if (netPayFormula?.expression) {
    const npSkip = [
      netPayFormula.variable,
      'Net Pay',
      'NetPay',
      'netPay',
      'net_pay',
      'netpay',
    ].filter(Boolean);
    const resolveForNetPay = (name) => {
      const nn = normalizeFormulaVariable(name);
      if (
        nn.includes('earned') &&
        nn.includes('gross') &&
        (nn.includes('salary') || nn.includes('cross'))
      ) {
        return Math.round(earnedGrossPayslip);
      }
      if (nn === 'total deduction' || nn === 'total deductions') {
        return Math.round(totalDedPayslip);
      }
      return resolveValue(name, [...npSkip, netPayFormula.variable]);
    };
    const evNp = evaluatePayrollMoneyExpression(
      netPayFormula.expression,
      resolveForNetPay,
      {
        components: payrollComponents,
        formulae: payrollFormulae,
        skipVariables: npSkip,
        row,
      }
    );
    if (Number.isFinite(evNp)) {
      gridNet = Math.round(evNp);
    }
  }

  return {
    row,
    storedEgs,
    tdStored,
    earnedBasicPayslip,
    earnedGrossPayslip,
    totalDedPayslip,
    gridNet,
  };
}

/**
 * Bank Format columns: Earned Gross and Total Deduction from Setup resolution; Net Pay from Setup "Net Pay"
 * formula when defined, otherwise round(Earned Gross − Total Deduction) like the Payroll grid.
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
