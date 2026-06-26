/**
 * Shared helpers + merge pipeline for Bank Format Report and Bank NEFT Report
 * (same payrollBankReportNetPay alignment as Payroll grid).
 */

import {
  payrollGridEarnedGrossForDisplay,
  pickStoredPayrollNetPayFromRow,
} from './payrollBankReportNetPay';
import { BANK_NEFT_MAY_2026_NET_PAY_FROM_REPORT } from './bankNeftMay2026NetPayReport';
import { createPayrollSetupFormulaeEngine } from './payrollSetupFormulaeEngine';
import {
  computePayrollGridNetPayForBankReport,
  preparePayrollRowForGridDisplay,
  sumPreparedPayslipDeductionKeys,
} from './payrollGridAlignForBankReports';

function parseGridDisplayNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, '').trim());
  return Number.isFinite(n) ? Math.round(n) : null;
}

function gridAlignedEarnedGrossFromPrepared(prepared) {
  const earned =
    parseFloat(
      prepared?.earnedSalaryCross ??
        prepared?.EarnedSalaryCross ??
        prepared?.earnedGrossSalary ??
        prepared?.EarnedGrossSalary ??
        0
    ) || 0;
  return Number.isFinite(earned) ? Math.round(earned) : null;
}

function gridAlignedNetPayFromPrepared(engine, prepared, bankReportPayrollOpts) {
  if (!engine || !prepared) return null;
  const earned = gridAlignedEarnedGrossFromPrepared(prepared);
  const totalDed = gridAlignedTotalDeductionFromPrepared(engine, prepared, bankReportPayrollOpts);
  if (earned != null && totalDed != null && Number.isFinite(earned) && Number.isFinite(totalDed)) {
    return Math.round(earned - totalDed);
  }
  const v = engine.getComponentDisplayValue(prepared, 'Net Pay');
  return parseGridDisplayNumber(v);
}

function gridAlignedPfFromPrepared(engine, prepared) {
  if (!engine || !prepared) return null;
  const v = engine.getComponentDisplayValue(prepared, 'PF 12%');
  return parseGridDisplayNumber(v);
}

function gridAlignedEsiFromPrepared(engine, prepared) {
  if (!engine || !prepared) return null;
  const v = engine.getComponentDisplayValue(prepared, 'ESI 0.75%');
  return parseGridDisplayNumber(v);
}

function gridAlignedTotalDeductionFromPrepared(engine, prepared, bankReportPayrollOpts) {
  if (!engine || !prepared) return null;
  const viaSum = sumPreparedPayslipDeductionKeys(
    engine,
    prepared,
    bankReportPayrollOpts?.payslipTemplateConfig
  );
  if (viaSum != null) return viaSum;
  const td = engine.getDisplayTotalDeduction(prepared);
  return Number.isFinite(td) ? Math.round(td) : null;
}

/** Late from Setup "Late" formula (Revised LOH grace applied — same as Payroll grid). */
function gridAlignedLateFromPrepared(engine, prepared) {
  if (!engine || !prepared) return null;
  const v = engine.getComponentDisplayValue(prepared, 'Late');
  return parseGridDisplayNumber(v);
}

/** Grid display amounts for one payroll row (same pipeline as Payroll screen). */
export function computePayrollGridDisplayForPayrollRow(raw, bankReportPayrollOpts) {
  const flat = flattenPayrollRowIfNeeded(raw);
  if (!flat) return null;
  const { engine, prepared } = preparePayrollRowForGridDisplay(flat, bankReportPayrollOpts);
  return {
    earnedGross: gridAlignedEarnedGrossFromPrepared(prepared),
    netPay: gridAlignedNetPayFromPrepared(engine, prepared, bankReportPayrollOpts),
    pf: gridAlignedPfFromPrepared(engine, prepared),
    esi: gridAlignedEsiFromPrepared(engine, prepared),
    late: gridAlignedLateFromPrepared(engine, prepared),
    totalDeduction: gridAlignedTotalDeductionFromPrepared(engine, prepared, bankReportPayrollOpts),
  };
}

/** Per employee code: payroll grid display amounts from aligned payroll rows. */
export function buildPayrollGridDisplayMapForBankReports(payrollRows, bankReportPayrollOpts) {
  const map = new Map();
  for (const raw of payrollRows || []) {
    const flat = flattenPayrollRowIfNeeded(raw);
    const entry = computePayrollGridDisplayForPayrollRow(flat, bankReportPayrollOpts);
    if (!entry) continue;
    indexPayrollEntryByPrimaryCode(map, flat, entry);
  }
  return map;
}

export function lookupPayrollGridDisplayForBankRow(map, bankRow) {
  if (!map) return null;
  for (const c of candidateEmployeeCodesLongestFirst(bankRow)) {
    if (map.has(c)) return map.get(c);
  }
  return null;
}

/** Net Pay / Earned Gross for a bank row — matched payroll row first (primary code, no alias collisions). */
export function resolvePayrollGridDisplayForBankRow(
  bankRow,
  payrollMap,
  bankReportPayrollOpts,
  gridDisplayMap
) {
  const payrollRow = getPayrollRowForBank(payrollMap, bankRow);
  if (payrollRow && bankReportPayrollOpts) {
    const primary = primaryEmployeeCodeFromRow(payrollRow);
    if (primary && gridDisplayMap?.has(primary)) {
      return gridDisplayMap.get(primary);
    }
    return computePayrollGridDisplayForPayrollRow(payrollRow, bankReportPayrollOpts);
  }
  return lookupPayrollGridDisplayForBankRow(gridDisplayMap, bankRow);
}

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

function resolveEarnedComponentForBankMergedRow(row, payrollKey, ...fallbackKeys) {
  const aligned = parsePayrollAmountLoose(row?.[payrollKey]);
  if (aligned != null) return aligned;
  for (const k of fallbackKeys) {
    const n = parsePayrollAmountLoose(row?.[k]);
    if (n != null) return n;
  }
  return null;
}

export function resolveEarnedBasicForBankMergedRow(row) {
  return resolveEarnedComponentForBankMergedRow(
    row,
    'earnedBasicPayroll',
    'earnedBasic',
    'EarnedBasic'
  );
}

export function resolveEarnedHraForBankMergedRow(row) {
  return resolveEarnedComponentForBankMergedRow(row, 'earnedHRAPayroll', 'earnedHRA', 'EarnedHRA');
}

export function resolveEarnedDaForBankMergedRow(row) {
  return resolveEarnedComponentForBankMergedRow(row, 'earnedDAPayroll', 'earnedDA', 'EarnedDA');
}

export function resolveEarnedGrossForBankMergedRow(row) {
  const aligned =
    parsePayrollAmountLoose(row.earnedGrossPayroll) ?? parsePayrollAmountLoose(row.earnedGross);
  if (aligned != null) return aligned;
  return (
    parsePayrollAmountLoose(row.earnedSalaryCross) ??
    parsePayrollAmountLoose(row.EarnedSalaryCross) ??
    parsePayrollAmountLoose(row.EarnedGrossSalary) ??
    parsePayrollAmountLoose(row.earnedGrossSalary)
  );
}

function runPayrollDatastoreRow(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const inner = raw.RunPayroll ?? raw.runPayroll ?? raw;
  return inner && typeof inner === 'object' ? inner : raw;
}

export function runPayrollRowHasStoredNetPay(raw) {
  const src = runPayrollDatastoreRow(raw);
  if (!src) return false;
  const val = src.NetPay ?? src.netPay ?? src.NETPAY ?? src.Netpay ?? src.netpay;
  if (val === null || val === undefined) return false;
  return String(val).trim() !== '';
}

export function parseRunPayrollTableNetPay(raw) {
  const src = runPayrollDatastoreRow(raw);
  if (!src) return null;
  if (runPayrollRowHasStoredNetPay(raw)) {
    return parsePayrollAmountLoose(
      src.NetPay ?? src.netPay ?? src.NETPAY ?? src.Netpay ?? src.netpay
    );
  }
  const eg =
    parsePayrollAmountLoose(src.EarnedSalaryCross) ??
    parsePayrollAmountLoose(src.earnedSalaryCross) ??
    parsePayrollAmountLoose(src.EarnedSalaryGross) ??
    parsePayrollAmountLoose(src.earnedSalaryGross) ??
    parsePayrollAmountLoose(src.EarnedGrossSalary);
  const td = parsePayrollAmountLoose(src.TotalDeduction ?? src.totalDeduction);
  if (eg != null && td != null && Number.isFinite(eg) && Number.isFinite(td)) {
    return Math.round(eg - td);
  }
  return null;
}

export function parseRunPayrollTableEarnedGross(raw) {
  const src = runPayrollDatastoreRow(raw);
  if (!src) return null;
  return (
    parsePayrollAmountLoose(src.EarnedSalaryCross) ??
    parsePayrollAmountLoose(src.earnedSalaryCross) ??
    parsePayrollAmountLoose(src.EarnedSalaryGross) ??
    parsePayrollAmountLoose(src.earnedSalaryGross) ??
    parsePayrollAmountLoose(src.EarnedGrossSalary)
  );
}

export function isMayPayrollMonth(monthStr) {
  const parts = String(monthStr || '').trim().split('-').map(Number);
  return parts.length >= 2 && parts[1] === 5;
}

/** Net Pay from May 2026 payroll report export (Payroll_Report_2026-05 xlsx). */
export function getBankNeftMay2026ReportNetPay(employeeCode) {
  for (const c of candidateEmployeeCodesFromRow({
    employeeCode,
    EmployeeCode: employeeCode,
    employeeId: employeeCode,
  })) {
    const amount = BANK_NEFT_MAY_2026_NET_PAY_FROM_REPORT[c];
    if (amount != null && Number.isFinite(amount)) return amount;
  }
  return null;
}

/** May 2026: use payroll report NetPay; other months: no report override. */
export function getBankNeftDefaultNetPayForMonth(monthStr, employeeCode) {
  const month = String(monthStr || '').trim();
  if (month === '2026-05' || (isMayPayrollMonth(month) && month.startsWith('2026-'))) {
    return getBankNeftMay2026ReportNetPay(employeeCode);
  }
  return null;
}

/** Fetch Payroll table rows for the month (stored NetPay from Run Payroll). */
export async function fetchPayrollTableRowsForMonth({
  month,
  fromDate,
  toDate,
  userEmail,
  userRole,
}) {
  const params = new URLSearchParams({ month, _t: String(Date.now()) });
  if (fromDate) params.append('fromDate', fromDate);
  if (toDate) params.append('toDate', toDate);
  if (userEmail) params.append('userEmail', userEmail);
  if (userRole) params.append('userRole', userRole);
  const res = await fetch(`/server/payroll_function/payroll?${params.toString()}`);
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(errText || `Payroll fetch failed (HTTP ${res.status})`);
  }
  const json = await res.json();
  return Array.isArray(json?.data) ? json.data : [];
}

/** Bank NEFT Salary Amount: May 2026 report NetPay override, else grid-aligned Net Pay (same as Payroll screen). */
export function resolveBankNeftNetPayAmount(row, reportMonth) {
  const empCode =
    row?.employeeCode ?? row?.EmployeeCode ?? row?.employeeId ?? row?.employeeID ?? '';
  const mayDefault = getBankNeftDefaultNetPayForMonth(reportMonth, empCode);
  if (mayDefault != null) return mayDefault;
  return resolveBankReportNetPayAmount(row);
}

export function resolveBankReportNetPayAmount(row) {
  const payrollGridNet = parsePayrollAmountLoose(row?.netPayPayroll);
  if (row?.hasPayrollTableRow === true) {
    if (payrollGridNet != null && Number.isFinite(payrollGridNet)) {
      return payrollGridNet;
    }
    const netEgTdPayroll = bankReportNetPayEarnedGrossMinusTd(row);
    if (netEgTdPayroll != null && Number.isFinite(netEgTdPayroll)) {
      return netEgTdPayroll;
    }
  }

  const runPayrollStored = row?.runPayrollHasStoredNetPay === true;
  const runPayrollNet =
    parsePayrollAmountLoose(row?.netPayFromRunPayroll) ?? parseRunPayrollTableNetPay(row);

  if (runPayrollStored && runPayrollNet != null && Number.isFinite(runPayrollNet) && runPayrollNet > 0) {
    return runPayrollNet;
  }

  if (payrollGridNet != null && Number.isFinite(payrollGridNet) && payrollGridNet > 0) {
    return payrollGridNet;
  }

  const netEgTd = bankReportNetPayEarnedGrossMinusTd(row);
  if (netEgTd != null && Number.isFinite(netEgTd) && netEgTd > 0) {
    return netEgTd;
  }

  if (runPayrollNet != null && Number.isFinite(runPayrollNet) && runPayrollNet > 0) {
    return runPayrollNet;
  }

  if (payrollGridNet != null && Number.isFinite(payrollGridNet)) {
    return Math.max(0, payrollGridNet);
  }
  if (netEgTd != null && Number.isFinite(netEgTd)) {
    return Math.max(0, netEgTd);
  }
  if (runPayrollNet != null && Number.isFinite(runPayrollNet)) {
    return Math.max(0, runPayrollNet);
  }
  const preferredNet = preferPayrollAlignedThenBankApi(
    row?.netPayPayroll,
    pickBackendSalaryOrNetColumn(row) ||
      row?.salaryAmount ||
      row?.amount ||
      row?.SalaryAmount ||
      ''
  );
  const preferredNetNum = parsePayrollAmountLoose(preferredNet);
  if (preferredNetNum != null && Number.isFinite(preferredNetNum) && preferredNetNum > 0) {
    return preferredNetNum;
  }
  if (preferredNetNum != null && Number.isFinite(preferredNetNum)) {
    return Math.max(0, preferredNetNum);
  }
  const fallback = parsePayrollAmountLoose(row?.amount);
  return fallback != null && Number.isFinite(fallback) ? fallback : 0;
}

/** Net Pay = Earned Gross Salary − Total Deduction when both exist on the merged row. */
export function bankReportNetPayEarnedGrossMinusTd(row) {
  const eg =
    parsePayrollAmountLoose(row.earnedSalaryCross) ??
    parsePayrollAmountLoose(row.EarnedSalaryCross) ??
    parsePayrollAmountLoose(row.earnedGrossPayroll) ??
    parsePayrollAmountLoose(row.earnedGross) ??
    resolveEarnedGrossForBankMergedRow(row);
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

export function primaryEmployeeCodeFromRow(row) {
  if (!row || typeof row !== 'object') return '';
  return String(row.employeeCode ?? row.EmployeeCode ?? row.employeeId ?? row.employeeID ?? '').trim();
}

/** Lookup variants for bank ↔ payroll code match (no parseInt aliases — avoids 12 vs 0012 collisions). */
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
  }
  return [...out];
}

function candidateEmployeeCodesLongestFirst(row) {
  return [...new Set(candidateEmployeeCodesFromRow(row))].sort(
    (a, b) => String(b).length - String(a).length
  );
}

function indexPayrollEntryByPrimaryCode(map, flatRow, value) {
  const primary = primaryEmployeeCodeFromRow(flatRow);
  if (!primary) return;
  map.set(primary, value);
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
    indexPayrollEntryByPrimaryCode(map, r, r);
  }
  return map;
}

export function getPayrollRowForBank(map, bankRow) {
  if (!map) return undefined;
  for (const c of candidateEmployeeCodesLongestFirst(bankRow)) {
    if (map.has(c)) return map.get(c);
  }
  const bankNorms = new Set(
    candidateEmployeeCodesFromRow(bankRow).map(normalizeEmployeeCode).filter(Boolean)
  );
  if (bankNorms.size === 0) return undefined;
  for (const row of map.values()) {
    const p = primaryEmployeeCodeFromRow(row);
    if (p && bankNorms.has(normalizeEmployeeCode(p))) return row;
  }
  return undefined;
}

export function buildRunPayrollTableMapFromApi(rows) {
  const map = new Map();
  for (const raw of rows || []) {
    if (!raw || typeof raw !== 'object') continue;
    const flat = flattenPayrollRowIfNeeded(raw);
    const code = flat.employeeCode ?? flat.EmployeeCode;
    if (code == null || String(code).trim() === '') continue;
    const netPay = parseRunPayrollTableNetPay(flat);
    const earnedSalaryGross = parseRunPayrollTableEarnedGross(flat);
    const hasStoredNetPay =
      flat.hasStoredNetPay === true || runPayrollRowHasStoredNetPay(flat);
    const synthetic = {
      employeeCode: String(code).trim(),
      earnedSalaryGross: earnedSalaryGross ?? flat.earnedSalaryGross ?? null,
      netPay: netPay ?? flat.netPay ?? flat.net_pay ?? null,
      hasStoredNetPay,
      totalDeduction:
        parsePayrollAmountLoose(flat.TotalDeduction ?? flat.totalDeduction) ?? null,
      earnedBasic: parsePayrollAmountLoose(flat.EarnedBasic ?? flat.earnedBasic) ?? null,
    };
    indexPayrollEntryByPrimaryCode(
      map,
      { employeeCode: synthetic.employeeCode, EmployeeCode: synthetic.employeeCode },
      synthetic
    );
  }
  return map;
}

export function getRunPayrollTableRowForBank(map, bankRow) {
  if (!map) return undefined;
  for (const c of candidateEmployeeCodesLongestFirst(bankRow)) {
    if (map.has(c)) return map.get(c);
  }
  const bankNorms = new Set(
    candidateEmployeeCodesFromRow(bankRow).map(normalizeEmployeeCode).filter(Boolean)
  );
  for (const row of map.values()) {
    const p = primaryEmployeeCodeFromRow(row);
    if (p && bankNorms.has(normalizeEmployeeCode(p))) return row;
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

function applyRunPayrollNetPayToMergedRow(next, rpTbl, { preferRunPayrollNetPay = false } = {}) {
  const rpNet = parseRunPayrollTableNetPay(rpTbl);
  const hasStoredNetPay = rpTbl.hasStoredNetPay === true || runPayrollRowHasStoredNetPay(rpTbl);
  const useRunPayrollNet = preferRunPayrollNetPay
    ? rpNet != null && Number.isFinite(rpNet)
    : hasStoredNetPay && rpNet != null && Number.isFinite(rpNet) && rpNet > 0;
  if (!useRunPayrollNet) return false;
  next.netPayFromRunPayroll = rpNet;
  next.runPayrollHasStoredNetPay = hasStoredNetPay;
  next.netPay = rpNet;
  next.salaryAmount = rpNet.toFixed(2);
  next.runPayrollOverrideNetPay = true;
  return true;
}

export function mergeBankFormatRowsWithPayroll({
  bankRows,
  payrollMap = new Map(),
  payrollLoadedOk,
  bankReportPayrollOpts,
  runPayrollTableMap = new Map(),
  preferRunPayrollNetPay = false,
  preferPayrollTableNetPay = false,
}) {
  const reportMonth = bankReportPayrollOpts?.reportMonth || '';
  const setupEngine = createPayrollSetupFormulaeEngine({
    payrollFormulae: bankReportPayrollOpts?.payrollFormulae || [],
    payrollComponents: bankReportPayrollOpts?.payrollComponents || [],
    payslipTemplateConfig: bankReportPayrollOpts?.payslipTemplateConfig || {},
    reportMonth,
  });

  return bankRows.map((row) => {
    const p = getPayrollRowForBank(payrollMap, row);
    const masterBranch = String(row.bankBranch ?? row.BankBranch ?? '').trim();
    const masterBank = String(row.bankName ?? row.BankName ?? '').trim();
    let next = {
      ...row,
      hasPayrollTableRow: Boolean(p),
      actualBasicPayroll: null,
      earnedBasicPayroll: null,
      earnedHRAPayroll: null,
      earnedDAPayroll: null,
      earnedGrossPayroll: null,
      totalDeductionPayroll: null,
      netPayPayroll: null,
      netPayFromRunPayroll: null,
      runPayrollHasStoredNetPay: false,
    };
    const rpTbl = getRunPayrollTableRowForBank(runPayrollTableMap, row);
    let rpEg = false;
    let rpNp = false;
    const useRunPayrollSnapshot =
      rpTbl && (preferRunPayrollNetPay || !next.hasPayrollTableRow);
    if (useRunPayrollSnapshot) {
      rpNp = applyRunPayrollNetPayToMergedRow(next, rpTbl, { preferRunPayrollNetPay });
      const rpEgVal = parseRunPayrollTableEarnedGross(rpTbl);
      if (rpEgVal != null && Number.isFinite(rpEgVal) && rpEgVal > 0) {
        next.earnedGross = rpEgVal;
        if (preferRunPayrollNetPay || !next.hasPayrollTableRow) {
          next.earnedGrossPayroll = rpEgVal;
        }
        rpEg = true;
      }
    }
    if (p) {
      const payrollRow = flattenPayrollRowIfNeeded(p);
      const storedTableNetPay = pickStoredPayrollNetPayFromRow(payrollRow);
      const d = setupEngine.applySetupAndGetPayrollDisplay(payrollRow);
      const netFromPayroll = preferPayrollTableNetPay
        ? storedTableNetPay
        : computePayrollGridNetPayForBankReport(payrollRow, bankReportPayrollOpts) ??
          (d && Number.isFinite(d.netPay) ? d.netPay : null);
      const egsForDisplay = d?.earnedGross ?? payrollGridEarnedGrossForDisplay(payrollRow, bankReportPayrollOpts);
      if (d) {
        next.actualBasicPayroll = Number.isFinite(d.actualBasic) ? d.actualBasic.toFixed(2) : null;
        next.earnedBasicPayroll = Number.isFinite(d.earnedBasic) ? d.earnedBasic.toFixed(2) : null;
        next.earnedHRAPayroll = Number.isFinite(d.earnedHRA) ? d.earnedHRA : null;
        next.earnedDAPayroll = Number.isFinite(d.earnedDA) ? d.earnedDA : null;
        if (!rpEg) {
          next.earnedGrossPayroll =
            egsForDisplay ?? (Number.isFinite(d.earnedGross) ? d.earnedGross : null);
        } else if (Number.isFinite(next.earnedGross)) {
          next.earnedGrossPayroll = next.earnedGross;
        } else {
          next.earnedGrossPayroll = null;
        }
        next.totalDeductionPayroll = d.totalDeduction;
        if (!rpNp) {
          const netForRow =
            preferPayrollTableNetPay &&
            storedTableNetPay != null &&
            Number.isFinite(storedTableNetPay)
              ? storedTableNetPay
              : netFromPayroll != null && Number.isFinite(netFromPayroll)
                ? netFromPayroll
                : storedTableNetPay != null && Number.isFinite(storedTableNetPay)
                  ? storedTableNetPay
                  : Number.isFinite(d.netPay)
                    ? d.netPay
                    : bankReportNetPayEarnedGrossMinusTd({
                        ...next,
                        earnedGrossPayroll: next.earnedGrossPayroll,
                        totalDeductionPayroll: d.totalDeduction,
                      });
          if (netForRow != null && Number.isFinite(netForRow)) {
            next.netPayPayroll = netForRow;
            if (next.netPayFromRunPayroll == null) next.salaryAmount = netForRow;
          } else {
            next.netPayPayroll = null;
          }
        } else if (rpNp && next.netPayFromRunPayroll != null && Number.isFinite(next.netPayFromRunPayroll)) {
          next.netPayPayroll = next.netPayFromRunPayroll;
        } else {
          next.netPayPayroll = null;
        }
        if (Number.isFinite(d.actualBasic)) {
          next.actualBasic = d.actualBasic.toFixed(2);
        }
        if (Number.isFinite(d.earnedBasic)) {
          next.earnedBasic = d.earnedBasic.toFixed(2);
        }
        if (Number.isFinite(d.earnedHRA)) {
          next.earnedHRA = d.earnedHRA;
        }
        if (Number.isFinite(d.earnedDA)) {
          next.earnedDA = d.earnedDA;
        }
        if (!rpEg) {
          const egOut = egsForDisplay ?? d.earnedGross;
          if (Number.isFinite(egOut)) next.earnedGross = egOut;
        }
        if (Number.isFinite(d.totalDeduction)) {
          next.totalDeduction = d.totalDeduction;
        }
        if (!rpNp && netFromPayroll != null && Number.isFinite(netFromPayroll)) {
          next.netPay = netFromPayroll;
        } else if (rpNp && next.netPayFromRunPayroll != null) {
          next.netPay = next.netPayFromRunPayroll;
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
    const empCodeForDefault =
      next.employeeCode ?? next.EmployeeCode ?? row.employeeCode ?? row.EmployeeCode ?? '';
    const mayDefaultNet = getBankNeftDefaultNetPayForMonth(reportMonth, empCodeForDefault);
    if (mayDefaultNet != null) {
      next.may2026SalaryAmountOverride = mayDefaultNet;
    }
    return next;
  });
}
