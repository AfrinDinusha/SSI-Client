/**
 * Setup & Configuration payroll formula engine — mirrors Payroll.js (find formula → evaluate → apply to row → display).
 * Bank Format Report uses this so Salary / Earned Basic / Earned Gross / Total Deduction / Net Pay match the Payroll grid.
 */

export function normalizeFormulaVariable(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function isManagingPartnerPayrollRow(emp) {
  const d = String(emp?.designation ?? emp?.Designation ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return d === 'managing partner';
}

/** Same keys as Payroll.js payrollKeyToHeaderLabel useMemo */
const DEFAULT_PAYROLL_KEY_TO_HEADER_LABEL = {
  daysInMonth: 'No. of Days (In Month)',
  daysPresent: 'No. of Days Present',
  loh: 'LOH',
  lop: 'LOP',
  otHours: 'OT Hours',
  foodAllowance: 'Food Allowance',
  washingAllowance: 'Washing Allowance',
  actualBasic: 'Actual Basic',
  actualDA: 'Actual DA',
  actualHRA: 'Actual HRA',
  otherAllowance: 'Attendance Allowance',
  otherAllowances: 'Other Allowances',
  travelChargers: 'Travel Chargers',
  specialAllowance: 'Special Allowance',
  loanAllowance: 'Loan Allowance',
  noOfDaysWithoutUniforms: 'No of days without uniforms',
  actualTotalSalary: 'Actual Total Gross',
  earnedBasic: 'Earned Basic',
  earnedDA: 'Earned DA',
  earnedHRA: 'Earned HRA',
  arrear: 'Arrear',
  arrearForPF: 'Arrear For PF',
  earnedOtherAllowances: 'Earned Other Allowances',
  earnedAttendanceAllowance: 'Earned Attendance Allowance',
  incentive: 'Incentive',
  otAmount: 'OT Amount',
  otArrearAmount: 'OT Arrear Amount',
  earnedSalaryCross: 'Earned Gross Salary',
  rent: 'Rent Recovery',
  pf: 'PF 12%',
  esi: 'ESI 0.75%',
  lwf: 'LWF',
  pt: 'PT',
  otherDeduction: 'Other Deduction',
  late: 'Late',
  totalDeduction: 'Total Deduction',
  netPay: 'Net Pay',
  erpf: 'ERPF 12%',
  admin: 'Admin 0.5%',
  edli: 'EDLI 0.5%',
  employerEsi: 'Employer ESI 3.25%',
  esiContribution: 'ESIContribution',
  ESIContribution: 'ESIContribution',
  employerLwf: 'EmployerLWF',
  serviceCharge: 'Service Charge 9%',
  total: 'Total',
  gst: 'GST 18%',
  netTotal: 'Net Total',
  bonus: 'Bonus',
  attendanceBonus: 'Attendance Bonus',
};

/**
 * @param {object} opts
 * @param {Array<{ variable: string, expression: string }>} opts.payrollFormulae
 * @param {string[]} opts.payrollComponents
 * @param {{ deductionKeys?: string[] } | null} opts.payslipTemplateConfig
 * @param {string} opts.reportMonth - YYYY-MM (Attendance Bonus / OT days fallback)
 */
export function createPayrollSetupFormulaeEngine(opts) {
  const payrollFormulae = Array.isArray(opts?.payrollFormulae) ? opts.payrollFormulae : [];
  const payrollComponents = Array.isArray(opts?.payrollComponents) ? opts.payrollComponents : [];
  const payslipTemplateConfig = opts?.payslipTemplateConfig || {};
  const reportMonth = String(opts?.reportMonth || '').trim();
  const payrollKeyToHeaderLabel = DEFAULT_PAYROLL_KEY_TO_HEADER_LABEL;

  const getFormulae = () => payrollFormulae;

  const findPayrollFormula = (predicate) => {
    const formulae = getFormulae();
    for (const f of formulae) {
      const v = normalizeFormulaVariable(f.variable);
      if (v && predicate(v, f)) return f;
    }
    return null;
  };

  const washingAllowanceHasSetupFormula = () => {
    const list = getFormulae();
    return list.some((f) => {
      const v = normalizeFormulaVariable(f.variable);
      return v === 'washing allowance' || (v.includes('washing') && (v.includes('allowance') || v.includes('allownace')));
    });
  };

  const getBuiltInWashingAllowanceFromRow = (row) => {
    if (!row) return 0;
    const dp = Number(row.daysPresent ?? row.DaysPresent ?? 0) || 0;
    const nu =
      Number(
        row.noOfDaysWithoutUniforms ?? row.NoOfDaysWithoutUniforms ?? row.noofdayswithoutuniforms ?? 0
      ) || 0;
    return Math.round(25 * Math.max(0, dp - nu));
  };

  const getBuiltInOtAmountFromRow = (row) => {
    if (!row) return 0;
    let dim = Number(row.daysInMonth ?? row.DaysInMonth ?? row.daysInMonthForCalc ?? 0) || 0;
    if (dim <= 0 && reportMonth) {
      const parts = String(reportMonth).split('-');
      if (parts.length >= 2) {
        const y = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10);
        if (!isNaN(y) && !isNaN(m)) dim = new Date(y, m, 0).getDate();
      }
    }
    dim = dim || 31;
    const oth = Number(row.otHours ?? row.OTHours ?? 0) || 0;
    const eb = Number(row.earnedBasic ?? row.EarnedBasic ?? 0) || 0;
    if (dim <= 0 || oth <= 0) return 0;
    return Math.round(((eb / dim) / 8) * oth * 2);
  };

  const isYashaswiContractor = (emp) =>
    String(emp?.contractor ?? emp?.Contractor ?? '').trim().toLowerCase() === 'yashaswi academy for skills';

  const normalizeStatusValue = (value) => `${value ?? ''}`.trim().toLowerCase();
  const getStatusFromRecord = (record, keys) => {
    if (!record) return '';
    for (const key of keys) {
      if (record[key] !== undefined && record[key] !== null && record[key] !== '') {
        return record[key];
      }
    }
    return '';
  };

  const getTravelChargersFromRecord = (record) => {
    if (!record || typeof record !== 'object') return 0;
    const v =
      record.travelChargers ??
      record.TravelChargers ??
      record.travelCharges ??
      record.TravelCharges ??
      record['Travel Chargers'] ??
      record['Travel Charges'];
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  const isPfEnabled = (record) =>
    normalizeStatusValue(getStatusFromRecord(record, ['pfStatus', 'PFStatus', 'pfstatus'])) !== 'no';
  const isEsiEnabled = (record) => {
    const esiStatus = normalizeStatusValue(getStatusFromRecord(record, ['esiStatus', 'ESIStatus', 'esi_status']));
    if (esiStatus === 'no') return false;
    return true;
  };

  let evaluateFormulaExpression;
  let getComponentDisplayValue;

  const getDisplayPT = (emp) => {
    if (isYashaswiContractor(emp)) return 0;
    const ptFormula = findPayrollFormula((v) => v === 'pt' || v.includes('professional tax'));
    if (ptFormula?.expression) {
      const skipVars = [ptFormula.variable, 'PT', payrollKeyToHeaderLabel?.pt].filter(Boolean);
      const n = evaluateFormulaExpression(emp, ptFormula.expression, { skipVariables: skipVars });
      if (Number.isFinite(n)) return Math.round(n);
    }
    const saved = parseFloat(emp?.pt ?? emp?.PT);
    if (Number.isFinite(saved) && saved > 0) return Math.round(saved);
    const earnedCross = parseFloat(emp?.earnedSalaryCross ?? emp?.EarnedSalaryCross ?? emp?.EarnedGrossSalary) || 0;
    let ptValue = 0;
    if (earnedCross >= 20001 / 6 && earnedCross <= 30000 / 6) {
      ptValue = 172 / 6;
    } else if (earnedCross >= 30001 / 6 && earnedCross <= 45000 / 6) {
      ptValue = 430 / 6;
    } else if (earnedCross >= 45001 / 6 && earnedCross <= 60000 / 6) {
      ptValue = 856 / 6;
    } else if (earnedCross >= 60001 / 6 && earnedCross <= 75000 / 6) {
      ptValue = 1250 / 6;
    } else if (earnedCross >= 75001 / 6) {
      ptValue = 1250 / 6;
    }
    return Math.round(ptValue);
  };

  const getOtAmountDisplayFromEmployee = (employee) => {
    if (!employee) return 0;
    const oth = Number(employee.otHours ?? employee.OTHours ?? 0) || 0;
    const storedRaw = employee.otAmount ?? employee.OTAmount;
    const stored = parseFloat(storedRaw);
    if (oth <= 0) return Number.isFinite(stored) ? Math.round(stored) : 0;
    if (Number.isFinite(stored) && stored > 0) return Math.round(stored);
    const otFormula = findPayrollFormula((norm) => norm === 'ot amount' || norm === 'otamount');
    if (otFormula?.expression) {
      const ev = evaluateFormulaExpression(employee, otFormula.expression);
      if (Number.isFinite(ev)) return Math.max(0, Math.round(ev));
    }
    return getBuiltInOtAmountFromRow(employee);
  };

  const getWashingAllowanceDisplayFromEmployee = (employee) => {
    if (!employee) return 0;
    const sRaw = employee.washingAllowance ?? employee.WashingAllowance;
    const s = parseFloat(sRaw);
    if (Number.isFinite(s) && s > 0) return Math.round(s);
    if (washingAllowanceHasSetupFormula()) {
      const washFormula = findPayrollFormula(
        (norm) =>
          norm === 'washing allowance' ||
          (norm.includes('washing') && (norm.includes('allowance') || norm.includes('allownace')))
      );
      if (washFormula && washFormula.expression) {
        const ev = evaluateFormulaExpression(employee, washFormula.expression);
        if (Number.isFinite(ev) && ev > 0) return Math.round(ev);
      }
    }
    const builtIn = getBuiltInWashingAllowanceFromRow(employee);
    if (builtIn > 0) return builtIn;
    return Number.isFinite(s) ? Math.round(s) : 0;
  };

  const syncOtAmountFromOtHours = (updated) => {
    if (!updated) return;
    const oth = Number(updated.otHours ?? updated.OTHours ?? 0) || 0;
    if (oth <= 0) return;
    const stored = parseFloat(updated.otAmount ?? updated.OTAmount);
    if (Number.isFinite(stored) && stored > 0) return;
    const otFormula = findPayrollFormula((norm) => norm === 'ot amount' || norm === 'otamount');
    let next;
    if (otFormula?.expression) {
      const ev = evaluateFormulaExpression(updated, otFormula.expression);
      if (Number.isFinite(ev)) next = Math.max(0, Math.round(ev));
    }
    if (next === undefined) next = getBuiltInOtAmountFromRow(updated);
    updated.otAmount = next;
    updated.OTAmount = next;
  };

  const syncWashingAllowanceFromAttendance = (updated) => {
    if (!updated) return;
    const s = parseFloat(updated.washingAllowance ?? updated.WashingAllowance);
    if (Number.isFinite(s) && s > 0) return;
    const calc = getBuiltInWashingAllowanceFromRow(updated);
    if (calc <= 0) return;
    updated.washingAllowance = calc;
    updated.WashingAllowance = calc;
  };

  const getPfDisplayValue = (record) => {
    if (isYashaswiContractor(record)) return 0;
    if (!isPfEnabled(record)) return '';
    const pfFormula = findPayrollFormula(
      (v) =>
        v === 'pf' ||
        v === 'pf 12%' ||
        (v.includes('pf') && !v.includes('employer') && (v.includes('12') || v.includes('%'))) ||
        v.includes('provident fund')
    );
    if (pfFormula?.expression) {
      const skipVars = [pfFormula.variable, 'PF', 'PF 12%', payrollKeyToHeaderLabel?.pf].filter(Boolean);
      const n = evaluateFormulaExpression(record, pfFormula.expression, { skipVariables: skipVars });
      if (Number.isFinite(n)) return n;
    }
    const earnedBasic = Number(record?.earnedBasic ?? record?.EarnedBasic ?? 0) || 0;
    if (earnedBasic <= 0) return 0;
    if (earnedBasic > 15000) return 1800;
    return Math.round(earnedBasic * 0.12);
  };

  const getEsiDisplayValue = (record) => {
    if (isYashaswiContractor(record)) return 0;
    if (!isEsiEnabled(record)) return '';
    const esiFormula = findPayrollFormula(
      (v) =>
        (v === 'esi' || v === 'esi 0.75%' || (v.includes('esi') && v.includes('0.75'))) &&
        !v.includes('employer')
    );
    if (esiFormula?.expression) {
      const skipVars = [esiFormula.variable, 'ESI', 'ESI 0.75%', payrollKeyToHeaderLabel?.esi].filter(Boolean);
      const n = evaluateFormulaExpression(record, esiFormula.expression, { skipVariables: skipVars });
      if (Number.isFinite(n)) return Math.round(n);
    }
    const esiValue = record?.esi ?? record?.ESI ?? 0;
    return Math.round(parseFloat(esiValue) || 0);
  };

  const getDisplayTotalDeduction = (emp) => {
    const formulae = getFormulae();
    const totalDeductionFormula = formulae.find((f) =>
      String(f?.variable || '').trim().toLowerCase() === 'total deduction'
    );

    if (totalDeductionFormula?.expression) {
      const evaluated = evaluateFormulaExpression(emp, totalDeductionFormula.expression, {
        skipVariables: [
          totalDeductionFormula.variable,
          'Total Deduction',
          'Total Deductions',
          payrollKeyToHeaderLabel?.totalDeduction,
        ].filter(Boolean),
      });
      if (Number.isFinite(evaluated)) return Math.round(evaluated);
    }

    const deductionKeys = Array.isArray(payslipTemplateConfig?.deductionKeys)
      ? payslipTemplateConfig.deductionKeys
      : [];
    const filteredKeys = deductionKeys.filter((k) => {
      const lower = String(k || '').trim().toLowerCase();
      return lower && lower !== 'total deduction' && lower !== 'total deductions' && lower !== 'net pay';
    });

    if (filteredKeys.length > 0) {
      const dedSum = filteredKeys.reduce((sum, key) => {
        const v = parseFloat(getComponentDisplayValue(emp, key));
        return sum + (Number.isFinite(v) ? v : 0);
      }, 0);
      return Math.round(dedSum);
    }

    return Math.round(parseFloat(emp?.totalDeduction ?? emp?.TotalDeduction ?? 0) || 0);
  };

  getComponentDisplayValue = (employee, componentName) => {
    if (!employee || !componentName) return '';
    const base = String(componentName).trim();
    if (!base) return '';

    const lower = base.toLowerCase();
    if (lower.includes('no. of days present') || lower.includes('days present')) {
      const dimGp = parseFloat(employee.daysInMonth ?? employee.DaysInMonth ?? 0) || 0;
      if (isManagingPartnerPayrollRow(employee) && dimGp > 0) return dimGp;
      return employee.daysPresent ?? employee.DaysPresent ?? '';
    }
    if (lower.includes('no. of days') && lower.includes('month')) {
      const v =
        employee.daysInMonth ?? employee.daysInMonthForCalc ?? employee.DaysInMonth ?? employee['Days In Month'] ?? '';
      const n = Number(v);
      return Number.isFinite(n) ? n : v !== '' && v !== null && v !== undefined ? v : '';
    }
    if (lower === 'loh' || lower.includes('loss of hours')) return employee.loh;
    if (lower === 'lop' || lower.includes('loss of pay')) {
      const dimLop = parseFloat(employee.daysInMonth ?? employee.DaysInMonth ?? 0) || 0;
      if (isManagingPartnerPayrollRow(employee) && dimLop > 0) return 0;
      return employee.lop;
    }
    if (lower.includes('ot hours') || lower === 'ot') return employee.otHours;
    if (
      lower === 'ot amount' ||
      (lower.includes('ot') && lower.includes('amount') && !lower.includes('hours') && !lower.includes('arrear'))
    ) {
      return getOtAmountDisplayFromEmployee(employee);
    }
    if (lower.includes('food') && (lower.includes('allowance') || lower.includes('allownace'))) {
      const v = employee.foodAllowance ?? employee.FoodAllowance ?? '';
      const n = Number(v);
      return Number.isFinite(n) ? Math.round(n) : v !== '' && v !== null && v !== undefined ? v : 0;
    }
    if (
      lower.includes('no of days without uniforms') ||
      lower === 'noofdayswithoutuniforms' ||
      lower.includes('no.of days without uniform')
    ) {
      const v = employee.noOfDaysWithoutUniforms ?? employee.NoOfDaysWithoutUniforms ?? employee.noofdayswithoutuniforms ?? '';
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    }
    if (lower.includes('loan') && lower.includes('allowance')) {
      const v = employee.loanAllowance ?? employee.LoanAllowance ?? '';
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    }
    if (lower.includes('washing') && (lower.includes('allowance') || lower.includes('allownace'))) {
      return getWashingAllowanceDisplayFromEmployee(employee);
    }
    if (lower === 'esi' || (lower.includes('esi') && (lower.includes('0.75') || lower.includes('%')))) {
      if (!isEsiEnabled(employee)) return 0;
      const g = getEsiDisplayValue(employee);
      return g === '' ? 0 : g;
    }
    if (lower === 'late') {
      const v = employee.late ?? employee.Late ?? '';
      const n = parseFloat(v);
      return Number.isFinite(n) ? Math.round(n) : 0;
    }
    const normCompLabel = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const pfHeaderNorm = normCompLabel(payrollKeyToHeaderLabel?.pf || 'PF 12%');
    const isPfColumn =
      lower === 'pf' ||
      normCompLabel(base) === pfHeaderNorm ||
      (lower.startsWith('pf') && (/\b12\b/.test(lower) || lower.includes('%')));
    if (isPfColumn) {
      const v = getPfDisplayValue(employee);
      if (v === '') return 0;
      return v;
    }
    if (lower === 'other deduction') return Math.round(parseFloat(employee.otherDeduction ?? employee.OtherDeduction) || 0);
    if (lower === 'lwf') return Math.round(parseFloat(employee.lwf ?? employee.LWF) || 0);
    if (lower === 'pt') return getDisplayPT(employee);
    if (lower.includes('rent')) return Math.round(parseFloat(employee.rent ?? employee.Rent) || 0);
    if (lower === 'other allowance' || lower === 'other allowances') {
      const val = employee.otherAllowances ?? employee.otherAllowance ?? '';
      return val !== '' && val !== null && val !== undefined ? val : '';
    }
    if (lower.includes('travel') && lower.includes('charge')) {
      const n = getTravelChargersFromRecord(employee);
      return Number.isFinite(n) ? Math.round(n) : 0;
    }
    if (lower.includes('attendance') && lower.includes('bonus')) {
      const v = employee.attendanceBonus ?? employee.AttendanceBonus ?? '';
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) return Math.round(n);
      const daysInMonth = Number(employee.daysInMonth ?? employee.DaysInMonth ?? 0);
      const daysPresent = Number(employee.daysPresent ?? employee.DaysPresent ?? 0);
      const dojRaw = employee.dateOfJoining ?? employee.DateofJoining ?? employee.DateOfJoining ?? employee.date_of_joining ?? '';
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
    if (lower.includes('earned') && lower.includes('gross') && (lower.includes('salary') || lower.includes('cross'))) {
      const v =
        employee.earnedSalaryCross ??
        employee.EarnedSalaryCross ??
        employee.earnedGrossSalary ??
        employee.EarnedGrossSalary ??
        '';
      const n = parseFloat(v);
      return Number.isFinite(n) ? Math.round(n) : v !== '' && v !== null && v !== undefined ? v : '';
    }
    if (lower === 'net pay' || lower === 'netpay') {
      const netPayFormula = findPayrollFormula((v) => v === 'net pay' || v === 'netpay');
      if (netPayFormula?.expression && typeof evaluateFormulaExpression === 'function') {
        const npSkip = [
          netPayFormula.variable,
          'Net Pay',
          'NetPay',
          'netPay',
          'net_pay',
          'netpay',
          payrollKeyToHeaderLabel?.netPay,
        ].filter(Boolean);
        const fromSetup = evaluateFormulaExpression(employee, netPayFormula.expression, {
          skipVariables: npSkip,
        });
        if (Number.isFinite(fromSetup)) return Math.round(fromSetup);
      }
      const earned =
        parseFloat(
          employee.earnedSalaryCross ??
            employee.EarnedSalaryCross ??
            employee.earnedGrossSalary ??
            employee.EarnedGrossSalary ??
            0
        ) || 0;
      const totalDed =
        typeof getDisplayTotalDeduction === 'function'
          ? getDisplayTotalDeduction(employee)
          : parseFloat(employee.totalDeduction ?? employee.TotalDeduction ?? 0) || 0;
      if (Number.isFinite(earned) && Number.isFinite(totalDed)) return Math.round(earned - totalDed);
      const stored = employee.netPay ?? employee.NetPay ?? employee.net_pay;
      const storedNum = parseFloat(stored);
      if (Number.isFinite(storedNum)) return Math.round(storedNum);
      const advance = parseFloat(employee.advance ?? employee.Advance ?? 0) || 0;
      return Math.round(earned - totalDed - advance);
    }
    if (lower === 'total deduction' || lower === 'total deductions') {
      return typeof getDisplayTotalDeduction === 'function'
        ? getDisplayTotalDeduction(employee)
        : Math.round(parseFloat(employee?.totalDeduction ?? employee?.TotalDeduction ?? 0) || 0);
    }
    if (lower === 'earned basic') {
      const v = employee.earnedBasic ?? employee.EarnedBasic ?? '';
      const n = Number(v);
      return Number.isFinite(n) ? Math.round(n) : v !== '' && v !== null && v !== undefined ? v : 0;
    }
    if (lower === 'earned hra') {
      const v = employee.earnedHRA ?? employee.EarnedHRA ?? '';
      const n = Number(v);
      return Number.isFinite(n) ? Math.round(n) : v !== '' && v !== null && v !== undefined ? v : 0;
    }
    if (lower === 'earned da') {
      const v = employee.earnedDA ?? employee.EarnedDA ?? '';
      const n = Number(v);
      return Number.isFinite(n) ? Math.round(n) : v !== '' && v !== null && v !== undefined ? v : 0;
    }
    if (lower === 'earned special allowance') {
      const v = employee.earnedSpecialAllowance ?? employee.EarnedSpecialAllowance ?? '';
      const n = Number(v);
      return Number.isFinite(n) ? Math.round(n) : v !== '' && v !== null && v !== undefined ? v : 0;
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
      if (employee[key] !== undefined && employee[key] !== null) {
        const val = employee[key];
        if (typeof val === 'number' && Number.isFinite(val)) return Math.round(val);
        if (typeof val === 'string' && val !== '' && Number.isFinite(Number(val))) return Math.round(Number(val));
        return val;
      }
    }
    return '';
  };

  evaluateFormulaExpression = (employee, expression, options = {}) => {
    if (!expression) return 0;

    const reserved = ['Math', 'min', 'max', 'round', 'floor', 'ceil', 'abs'];
    const skipVariableNorm = new Set(
      (Array.isArray(options.skipVariables) ? options.skipVariables : [])
        .map((x) => normalizeFormulaVariable(x))
        .filter(Boolean)
    );
    try {
      let expr = String(expression).trim();

      // Support Setup formulas written as:
      // if (<condition>) then <value-if-true> else <value-if-false>
      // Convert it to JS ternary before token replacement.
      const ifThenElseMatch = expr.match(/^if\s*\((.+)\)\s*then\s+(.+)\s+else\s+(.+)$/i);
      if (ifThenElseMatch) {
        const conditionExpr = String(ifThenElseMatch[1] || '').trim();
        const trueExpr = String(ifThenElseMatch[2] || '').trim();
        const falseExpr = String(ifThenElseMatch[3] || '').trim();
        expr = `((${conditionExpr}) ? (${trueExpr}) : (${falseExpr}))`;
      }

      // Support formula helper functions from Setup Configuration.
      expr = expr
        .replace(/\bmin\s*\(/gi, 'Math.min(')
        .replace(/\bmax\s*\(/gi, 'Math.max(')
        .replace(/\bround\s*\(/gi, 'Math.round(')
        .replace(/\bfloor\s*\(/gi, 'Math.floor(')
        .replace(/\bceil\s*\(/gi, 'Math.ceil(')
        .replace(/\babs\s*\(/gi, 'Math.abs(');

      const formulaeForExpr = getFormulae();
      const allVarAndComponentNames = [
        ...(payrollComponents || []),
        ...(formulaeForExpr || []).map((f) => (f.variable || '').trim()).filter(Boolean),
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
      const getVal = (name) => {
        if (skipVariableNorm.has(normalizeFormulaVariable(name))) return 0;
        const vNorm = normalizeFormulaVariable(name);
        if (
          vNorm === 'washing allowance' ||
          (vNorm.includes('washing') && (vNorm.includes('allowance') || vNorm.includes('allownace')))
        ) {
          const rawStored = employee.washingAllowance ?? employee.WashingAllowance;
          const sn = parseFloat(rawStored);
          return Number.isFinite(sn) ? sn : 0;
        }
        if (vNorm === 'ot amount' || vNorm === 'otamount') {
          const rawOt = employee.otAmount ?? employee.OTAmount;
          const sn = parseFloat(rawOt);
          return Number.isFinite(sn) ? sn : 0;
        }
        const raw = getComponentDisplayValue(employee, name);
        const num = parseFloat(raw);
        return Number.isFinite(num) ? num : 0;
      };

      const fn = new Function('getVal', `return (${expr});`);
      const result = fn(getVal);
      const n = Number(result);
      return Number.isFinite(n) ? Math.round(n) : 0;
    } catch (e) {
      console.error('payrollSetupFormulaeEngine formula error:', expression, e);
      return 0;
    }
  };

  const applyCanonicalFieldFromFormulaVariable = (updated, variableTrimmed, numericRounded) => {
    const v = normalizeFormulaVariable(variableTrimmed);
    const n = Number(numericRounded);
    const num = Number.isFinite(n) ? Math.round(n) : 0;
    if (v.includes('employer') && v.includes('esi')) {
      updated.employerEsi = num;
      updated.EmployerEsi = num;
      return;
    }
    if ((v === 'esi' || v === 'esi 0.75%' || (v.includes('esi') && v.includes('0.75'))) && !v.includes('employer')) {
      updated.esi = num;
      updated.ESI = num;
      return;
    }
    if (
      v === 'pf' ||
      v.includes('provident fund') ||
      (v.includes('pf') && !v.includes('employer') && (v.includes('12') || v.includes('%')))
    ) {
      updated.pf = num;
      updated.PF = num;
      return;
    }
    if (v === 'pt' || v.includes('professional tax')) {
      updated.pt = num;
      updated.PT = num;
      return;
    }
    if (v === 'late') {
      updated.late = num;
      updated.Late = num;
      return;
    }
    if (v === 'net pay' || v === 'netpay') {
      updated.netPay = num;
      updated.NetPay = num;
    }
    if (v === 'total deduction' || v === 'total deductions') {
      updated.totalDeduction = num;
      updated.TotalDeduction = num;
    }
  };

  const applyPayrollFormulaeToEmployee = (employee) => {
    if (!employee) return employee;
    const formulae = getFormulae();
    const updated = { ...employee };
    const originalNetPay = employee.netPay ?? employee.NetPay ?? employee.net_pay ?? employee.netpay;

    if (Array.isArray(formulae) && formulae.length > 0) {
      const esiEnabled = isEsiEnabled(employee);
      const hasEsiEmployeeFormula = formulae.some((f) => {
        const v = normalizeFormulaVariable(f.variable);
        return (
          (v === 'esi' || v === 'esi 0.75%' || (v.includes('esi') && v.includes('0.75'))) &&
          !v.includes('employer')
        );
      });

      const preservedEarned = {
        earnedBasic: Number(updated.earnedBasic ?? updated.EarnedBasic) || 0,
        earnedHRA: Number(updated.earnedHRA ?? updated.EarnedHRA) || 0,
        earnedDA: Number(updated.earnedDA ?? updated.EarnedDA) || 0,
        earnedSpecialAllowance: Number(updated.earnedSpecialAllowance ?? updated.EarnedSpecialAllowance) || 0,
      };

      formulae.forEach(({ variable, expression }) => {
        const base = String(variable).trim();
        if (!base) return;

        const camel = base
          .toLowerCase()
          .split(/\s+/)
          .map((word, index) => (index === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1)))
          .join('');

        const key = camel || base.replace(/\s+/g, '') || base.replace(/\s+/g, '_').toLowerCase();

        const baseLower = base.toLowerCase();
        if (!esiEnabled && baseLower.includes('esi')) {
          if (baseLower.includes('employer')) updated.employerEsi = 0;
          else updated.esi = 0;
          return;
        }
        if (baseLower === 'late') return;

        const value = evaluateFormulaExpression(updated, expression);
        if (baseLower === 'total deduction' && (value === 0 || !Number.isFinite(value))) {
          const configuredDeductionKeys = Array.isArray(payslipTemplateConfig?.deductionKeys)
            ? payslipTemplateConfig.deductionKeys
            : [];
          const fallbackKeys = configuredDeductionKeys.filter((k) => {
            const lowerKey = String(k || '').trim().toLowerCase();
            return lowerKey && lowerKey !== 'total deduction' && lowerKey !== 'total deductions' && lowerKey !== 'net pay';
          });
          const fallbackSum = fallbackKeys.reduce((sum, keyName) => {
            const n = parseFloat(getComponentDisplayValue(updated, keyName));
            return sum + (Number.isFinite(n) ? n : 0);
          }, 0);
          if (fallbackSum > 0) updated[key] = Math.round(fallbackSum);
          else updated[key] = Math.round(value);
        } else if (
          !hasEsiEmployeeFormula &&
          (baseLower === 'esi 0.75%' || baseLower === 'esi') &&
          (value === 0 || !Number.isFinite(value))
        ) {
          const eb = parseFloat(updated.earnedBasic ?? updated.EarnedBasic) || 0;
          const ehra = parseFloat(updated.earnedHRA ?? updated.EarnedHRA) || 0;
          const esa = parseFloat(updated.earnedSpecialAllowance ?? updated.EarnedSpecialAllowance) || 0;
          const otAmt = parseFloat(updated.otAmount ?? updated.OTAmount) || 0;
          const travel = getTravelChargersFromRecord(updated);
          const esiBaseSum = eb + ehra + esa + otAmt + travel;
          if (esiBaseSum > 0) updated[key] = Math.ceil(esiBaseSum * 0.0075);
          else updated[key] = 0;
        } else {
          updated[key] = Number.isFinite(value) ? Math.round(value) : value;
        }
        if (baseLower.includes('washing') && (baseLower.includes('allowance') || baseLower.includes('allownace'))) {
          const fv = Number.isFinite(value) ? Math.round(value) : Number(updated[key]) || 0;
          updated.washingAllowance = fv;
          updated.WashingAllowance = fv;
        }
        if (baseLower === 'food allowance' || baseLower === 'food allownace') {
          const fv = Number.isFinite(value) ? Math.round(value) : Number(updated[key]) || 0;
          updated.foodAllowance = fv;
        }
        if (baseLower.includes('travel') && baseLower.includes('charge')) {
          const fv = Number.isFinite(value) ? Math.round(value) : Number(updated[key]) || 0;
          updated.travelChargers = fv;
          updated.TravelChargers = fv;
        }
        if (key === 'earnedGrossSalary' && updated.earnedGrossSalary !== undefined) {
          updated.earnedSalaryCross = updated.earnedGrossSalary;
        }
        if (!(baseLower.includes('esi') && !esiEnabled)) {
          const sv = updated[key];
          if (sv !== undefined && sv !== null && sv !== '') {
            const nn = typeof sv === 'number' && Number.isFinite(sv) ? Math.round(sv) : parseFloat(sv);
            if (Number.isFinite(nn)) applyCanonicalFieldFromFormulaVariable(updated, base, nn);
          }
        }
      });

      const restoreEarnedIfFormulaZeroed = (camelKey, pascalKey) => {
        const cur = Number(updated[camelKey] ?? updated[pascalKey]) || 0;
        const prev = preservedEarned[camelKey];
        if (cur === 0 && prev > 0) {
          const v = Math.round(prev);
          updated[camelKey] = v;
          updated[pascalKey] = v;
        }
      };
      restoreEarnedIfFormulaZeroed('earnedBasic', 'EarnedBasic');
      restoreEarnedIfFormulaZeroed('earnedHRA', 'EarnedHRA');
      restoreEarnedIfFormulaZeroed('earnedDA', 'EarnedDA');
      restoreEarnedIfFormulaZeroed('earnedSpecialAllowance', 'EarnedSpecialAllowance');

      syncWashingAllowanceFromAttendance(updated);
      syncOtAmountFromOtHours(updated);

      const egsEntry = formulae.find((f) => String(f.variable || '').trim().toLowerCase() === 'earned gross salary');
      if (egsEntry && egsEntry.expression) {
        const v = evaluateFormulaExpression(updated, egsEntry.expression);
        if (Number.isFinite(v)) {
          updated.earnedGrossSalary = Math.round(v);
          updated.earnedSalaryCross = updated.earnedGrossSalary;
        }
      }
    }

    syncWashingAllowanceFromAttendance(updated);
    syncOtAmountFromOtHours(updated);

    const formulaeAfterWash = getFormulae();
    const egsAfterWash = formulaeAfterWash.find(
      (f) => String(f.variable || '').trim().toLowerCase() === 'earned gross salary'
    );
    if (egsAfterWash && egsAfterWash.expression) {
      const vEgs = evaluateFormulaExpression(updated, egsAfterWash.expression);
      if (Number.isFinite(vEgs)) {
        updated.earnedGrossSalary = Math.round(vEgs);
        updated.earnedSalaryCross = updated.earnedGrossSalary;
      }
    }

    const lateFormulaFinal = formulaeAfterWash.find((f) => String(f.variable || '').trim().toLowerCase() === 'late');
    if (lateFormulaFinal && lateFormulaFinal.expression) {
      const lateSkip = [lateFormulaFinal.variable, 'Late', payrollKeyToHeaderLabel?.late].filter(Boolean);
      const lv = evaluateFormulaExpression(updated, lateFormulaFinal.expression, { skipVariables: lateSkip });
      if (Number.isFinite(lv)) {
        const rounded = Math.round(lv);
        updated.late = rounded;
        updated.Late = rounded;
      }
    }

    const netPayFormulaFinal = formulaeAfterWash.find((f) => {
      const v = normalizeFormulaVariable(f.variable);
      return v === 'net pay' || v === 'netpay';
    });
    if (netPayFormulaFinal && netPayFormulaFinal.expression) {
      const npSkip = [
        netPayFormulaFinal.variable,
        'Net Pay',
        'NetPay',
        'netPay',
        'net_pay',
        'netpay',
        payrollKeyToHeaderLabel?.netPay,
      ].filter(Boolean);
      const vNp = evaluateFormulaExpression(updated, netPayFormulaFinal.expression, { skipVariables: npSkip });
      if (Number.isFinite(vNp)) {
        const rounded = Math.round(vNp);
        updated.netPay = rounded;
        updated.NetPay = rounded;
      }
    } else if (Number.isFinite(Number(originalNetPay))) {
      updated.netPay = Number(originalNetPay);
      updated.NetPay = Number(originalNetPay);
    }

    return updated;
  };

  return {
    applyPayrollFormulaeToEmployee,
    getComponentDisplayValue,
    getDisplayTotalDeduction,
    evaluateFormulaExpression,
  };
}
