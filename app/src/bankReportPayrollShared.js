/**
 * Shared helpers + merge pipeline for Bank Format Report and Bank NEFT Report
 * (same payrollBankReportNetPay alignment as Payroll grid).
 */

import {
  normalizePayrollRowLikePayrollFetch,
  payrollDisplayAlignedWithPayrollGrid,
} from './payrollBankReportNetPay';

/** True when bank-format API sent a usable amount, including 0. */
export function bankApiFieldHasNumericValue(v) {
  if (v === null || v === undefined) return false;
  if (typeof v === 'number' && Number.isFinite(v)) return true;
  const s = String(v).replace(/,/g, '').trim();
  if (s === '' || s === '-') return false;
  const n = parseFloat(s);
  return Number.isFinite(n);
}

/** Prefer payroll-aligned values; else bank-format API / employee master. */
export function preferPayrollAlignedThenBankApi(payrollVal, bankApiVal) {
  if (payrollVal !== null && payrollVal !== undefined && payrollVal !== '') {
    if (typeof payrollVal === 'number' && Number.isFinite(payrollVal)) return payrollVal;
    const s = String(payrollVal).replace(/,/g, '').trim();
    if (s !== '' && s !== '-' && Number.isFinite(parseFloat(s))) return payrollVal;
  }
  if (bankApiFieldHasNumericValue(bankApiVal)) return bankApiVal;
  return '';
}

export function pickBackendSalaryOrNetColumn(row) {
  if (bankApiFieldHasNumericValue(row?.salaryAmount)) return row.salaryAmount;
  if (bankApiFieldHasNumericValue(row?.netPay)) return row.netPay;
  return '';
}

export function parsePayrollAmountLoose(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

/** Net Pay = Earned Gross Salary − Total Deduction when both exist on the merged row. */
export function bankReportNetPayEarnedGrossMinusTd(row) {
  const eg =
    parsePayrollAmountLoose(row.earnedGrossPayroll) ??
    parsePayrollAmountLoose(row.earnedGross) ??
    parsePayrollAmountLoose(row.EarnedSalaryCross ?? row.earnedSalaryCross);
  const td =
    parsePayrollAmountLoose(row.totalDeductionPayroll) ??
    parsePayrollAmountLoose(row.totalDeduction) ??
    parsePayrollAmountLoose(row.TotalDeduction);
  if (eg == null || td == null) return null;
  return Math.round(eg - td);
}

export function normalizeEmployeeCode(code) {
  const raw = String(code ?? '').trim();
  if (!raw) return '';
  const withoutDecimalZero = raw.endsWith('.0') ? raw.slice(0, -2) : raw;
  return withoutDecimalZero.replace(/^0+(?=\d)/, '') || raw;
}

export function candidateEmployeeCodesFromRow(row) {
  if (!row || typeof row !== 'object') return [];
  const raw = [
    row.employeeCode,
    row.EmployeeCode,
    row.employeeID,
    row.EmployeeID,
    row.EmployeeId,
    row.employeeId,
  ];
  const out = new Set();
  for (const v of raw) {
    if (v == null || v === '') continue;
    const s = String(v).trim();
    if (!s) continue;
    out.add(s);
    const norm = normalizeEmployeeCode(s);
    if (norm && norm !== s) out.add(norm);
    if (/^\d+$/.test(s)) out.add(String(parseInt(s, 10)));
    if (norm && /^\d+$/.test(norm)) out.add(String(parseInt(norm, 10)));
  }
  return [...out];
}

export function flattenPayrollRowIfNeeded(raw) {
  if (!raw || typeof raw !== 'object') return raw;
  const inner = raw.Payroll;
  if (inner && typeof inner === 'object') {
    return { ...raw, ...inner };
  }
  return raw;
}

export function buildPayrollByEmployeeCode(rows) {
  const map = new Map();
  for (const raw of rows || []) {
    const r = flattenPayrollRowIfNeeded(raw);
    for (const c of candidateEmployeeCodesFromRow(r)) {
      map.set(c, r);
    }
  }
  return map;
}

export function getPayrollRowForBank(map, bankRow) {
  for (const c of candidateEmployeeCodesFromRow(bankRow)) {
    if (map.has(c)) return map.get(c);
  }
  return undefined;
}

export function buildRunPayrollTableMapFromApi(rows) {
  const map = new Map();
  for (const raw of rows || []) {
    if (!raw || typeof raw !== 'object') continue;
    const code = raw.employeeCode ?? raw.EmployeeCode;
    if (code == null || String(code).trim() === '') continue;
    const synthetic = {
      employeeCode: String(code).trim(),
      earnedSalaryGross: raw.earnedSalaryGross ?? raw.earned_gross ?? null,
      netPay: raw.netPay ?? raw.net_pay ?? null,
    };
    for (const c of candidateEmployeeCodesFromRow({
      employeeCode: synthetic.employeeCode,
      EmployeeCode: synthetic.employeeCode,
    })) {
      map.set(c, synthetic);
    }
  }
  return map;
}

export function getRunPayrollTableRowForBank(map, bankRow) {
  for (const c of candidateEmployeeCodesFromRow(bankRow)) {
    if (map.has(c)) return map.get(c);
  }
  return undefined;
}

export function payrollMonthToFromToDates(monthStr) {
  const parts = String(monthStr || '').trim().split('-').map(Number);
  const y = parts[0];
  const m = parts[1];
  if (!y || !m || m < 1 || m > 12) return { fromDate: '', toDate: '' };
  const mm = String(m).padStart(2, '0');
  const fromDate = `${y}-${mm}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const toDate = `${y}-${mm}-${String(lastDay).padStart(2, '0')}`;
  return { fromDate, toDate };
}

export function mergeBankFormatRowsWithPayroll({
  bankRows,
  payrollMap,
  payrollLoadedOk,
  bankReportPayrollOpts,
  runPayrollTableMap,
}) {
  return bankRows.map((row) => {
    const p = getPayrollRowForBank(payrollMap, row);
    const masterBranch = String(row.bankBranch ?? row.BankBranch ?? '').trim();
    const masterBank = String(row.bankName ?? row.BankName ?? '').trim();
    let next = {
      ...row,
      actualBasicPayroll: null,
      earnedBasicPayroll: null,
      earnedGrossPayroll: null,
      totalDeductionPayroll: null,
      netPayPayroll: null,
    };
    const rpTbl = getRunPayrollTableRowForBank(runPayrollTableMap, row);
    let rpEg = row.runPayrollOverrideEarnedGross === true;
    let rpNp = row.runPayrollOverrideNetPay === true;
    if (rpTbl) {
      if (rpTbl.netPay != null && Number.isFinite(Number(rpTbl.netPay))) {
        const npv = Number(rpTbl.netPay);
        next.netPay = npv;
        next.salaryAmount = npv.toFixed(2);
        rpNp = true;
      }
      if (rpTbl.earnedSalaryGross != null && Number.isFinite(Number(rpTbl.earnedSalaryGross))) {
        next.earnedGross = Number(rpTbl.earnedSalaryGross);
        rpEg = true;
      }
    }
    if (p && payrollLoadedOk) {
      const normalized = normalizePayrollRowLikePayrollFetch(flattenPayrollRowIfNeeded(p));
      const d = payrollDisplayAlignedWithPayrollGrid(normalized, bankReportPayrollOpts);
      if (d) {
        next.actualBasicPayroll = Number.isFinite(d.actualBasic) ? d.actualBasic.toFixed(2) : null;
        next.earnedBasicPayroll = Number.isFinite(d.earnedBasic) ? d.earnedBasic.toFixed(2) : null;
        if (!rpEg) {
          next.earnedGrossPayroll = d.earnedGross;
        } else {
          next.earnedGrossPayroll = null;
        }
        next.totalDeductionPayroll = d.totalDeduction;
        if (!rpNp) {
          next.netPayPayroll = d.netPay;
          next.salaryAmount = d.netPay;
        } else {
          next.netPayPayroll = null;
        }
        if (Number.isFinite(d.actualBasic)) {
          next.actualBasic = d.actualBasic.toFixed(2);
        }
        if (Number.isFinite(d.earnedBasic)) {
          next.earnedBasic = d.earnedBasic.toFixed(2);
        }
        if (!rpEg && Number.isFinite(d.earnedGross)) {
          next.earnedGross = d.earnedGross;
        }
        if (Number.isFinite(d.totalDeduction)) {
          next.totalDeduction = d.totalDeduction;
        }
        if (!rpNp && Number.isFinite(d.netPay)) {
          next.netPay = d.netPay;
        }
        next.pfPayroll = Number.isFinite(d.pf) ? d.pf : null;
        next.esiPayroll = Number.isFinite(d.esi) ? d.esi : null;
        next.loanAllowancePayroll = Number.isFinite(d.loanAllowance) ? d.loanAllowance : null;
        next.uniformDeductionPayroll = Number.isFinite(d.uniformDeduction) ? d.uniformDeduction : null;
        next.attendanceDeductionPayroll = Number.isFinite(d.attendanceDeduction)
          ? d.attendanceDeduction
          : null;
        next.latePayroll = Number.isFinite(d.late) ? d.late : null;
        next.otAmountPayroll = Number.isFinite(d.otAmount) ? d.otAmount : null;
        next.incentivePayroll = Number.isFinite(d.incentive) ? d.incentive : null;
      }
      const pb = String(p.bankBranch || '').trim();
      if (pb && (!masterBranch || masterBranch === '-')) {
        next.bankBranch = pb;
      }
      const pbn = String(p.bankName || '').trim();
      if (pbn && (!masterBank || masterBank === '-')) {
        next.bankName = pbn;
      }
      const pifsc = String(p.ifscCode || '').trim();
      if (pifsc && !(String(next.ifscCode || next.IFSCCode || '').trim())) {
        next.ifscCode = pifsc;
      }
    }
    return next;
  });
}
