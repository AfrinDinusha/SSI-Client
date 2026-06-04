/**
 * Align payroll API rows with the Payroll grid before bank reports compute Net Pay:
 * Attendance Muster (days present / OT / LOH) + earned salary recalc + Setup formulae net pay.
 */

import { applyReportsLohToMusterData, fetchLohRowsForMusterOverlay } from './musterLohReportsMerge';
import {
  lohHoursForLateDeduction,
  parseLohHours,
  pickRevisedLohFromPayrollRow,
  resolveRevisedLohDisplayOnRow,
} from './payrollLiveLoh';
import { createPayrollSetupFormulaeEngine } from './payrollSetupFormulaeEngine';

function normalizeEmployeeCode(code) {
  const raw = String(code ?? '').trim();
  if (!raw) return '';
  const withoutDecimalZero = raw.endsWith('.0') ? raw.slice(0, -2) : raw;
  return withoutDecimalZero.replace(/^0+(?=\d)/, '') || raw;
}

function syncRevisedLohOnPayrollRow(row, options = {}) {
  if (!row || typeof row !== 'object') return row;
  const revised = options.forceFromLoh
    ? lohHoursForLateDeduction(row.loh ?? row.LOH ?? 0)
    : resolveRevisedLohDisplayOnRow(row);
  return { ...row, revisedLOH: revised, RevisedLOH: revised };
}

function applyMusterLohUpdateToPayrollRow(emp, lohUpdate) {
  if (!emp || !lohUpdate || lohUpdate.loh === undefined) return { ...emp, ...lohUpdate };
  const prevLoh = parseLohHours(emp.loh ?? emp.LOH ?? 0);
  const newLoh = parseLohHours(lohUpdate.loh);
  if (Math.abs(prevLoh - newLoh) <= 0.001) return { ...emp, ...lohUpdate };
  const explicit = pickRevisedLohFromPayrollRow(emp);
  const wasAutoDerived =
    explicit !== undefined && Math.abs(explicit - lohHoursForLateDeduction(prevLoh)) <= 0.001;
  const merged = { ...emp, ...lohUpdate };
  if (wasAutoDerived) {
    const derived = lohHoursForLateDeduction(newLoh);
    merged.revisedLOH = derived;
    merged.RevisedLOH = derived;
  }
  return merged;
}

function payrollFieldNumber(...candidates) {
  for (const v of candidates) {
    const raw = String(v ?? '').trim();
    if (!raw) continue;
    const cleaned = raw.replace(/[^0-9.\-]/g, '');
    const n = Number(cleaned);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

/** Same field normalization as Payroll.js after muster merge (before applyPayrollFormulaeToEmployee). */
export function normalizePayrollRowForGridAlign(row) {
  if (!row || typeof row !== 'object') return row;
  const specialAllowance = payrollFieldNumber(row.specialAllowance, row.SpecialAllowance);
  const rawEarnedSpecial = payrollFieldNumber(row.earnedSpecialAllowance, row.EarnedSpecialAllowance);
  const dim = payrollFieldNumber(row.daysInMonth, row.DaysInMonth) || 31;
  const dp = payrollFieldNumber(row.daysPresent, row.DaysPresent);
  const lohRow = payrollFieldNumber(row.loh, row.LOH);
  let earnedSpecialAllowance = rawEarnedSpecial;
  if (specialAllowance > 0 && rawEarnedSpecial === 0) {
    earnedSpecialAllowance =
      dim > 0
        ? Math.max(0, Math.round((specialAllowance / dim) * dp - (specialAllowance / dim / 8) * lohRow))
        : 0;
  }
  const revisedFromApi = pickRevisedLohFromPayrollRow(row);
  const normalized = {
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
    ...(revisedFromApi !== undefined ? { revisedLOH: revisedFromApi, RevisedLOH: revisedFromApi } : {}),
  };
  return syncRevisedLohOnPayrollRow(normalized);
}

function normalizeStatus(s) {
  return String(s ?? '').trim();
}

function isAbsentStatus(s) {
  const v = normalizeStatus(s);
  return v === 'Absent' || v === 'A';
}

function isWoOrHStatus(s) {
  const v = normalizeStatus(s);
  return v === 'WO' || v === 'H' || v === 'Week Off' || v === 'Holiday';
}

function isSandwichedWoOrH(statuses, idx) {
  if (!Array.isArray(statuses)) return false;
  if (idx <= 0 || idx >= statuses.length - 1) return false;
  if (!isWoOrHStatus(statuses[idx])) return false;
  let left = idx - 1;
  while (left >= 0 && isWoOrHStatus(statuses[left])) left -= 1;
  let right = idx + 1;
  while (right < statuses.length && isWoOrHStatus(statuses[right])) right += 1;
  if (left < 0 || right >= statuses.length) return false;
  return isAbsentStatus(statuses[left]) && isAbsentStatus(statuses[right]);
}

function isSundayMusterDate(dateValue) {
  if (dateValue == null || dateValue === '') return false;
  const s = String(dateValue).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    const y = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10) - 1;
    const d = parseInt(m[3], 10);
    const dt = new Date(y, mo, d);
    if (!Number.isNaN(dt.getTime())) return dt.getDay() === 0;
  }
  const dt = new Date(s);
  if (Number.isNaN(dt.getTime())) return false;
  return dt.getDay() === 0;
}

function calculateDaysPresentFromMusterStatuses(statuses, dates) {
  if (!Array.isArray(statuses)) return 0;
  return statuses.reduce((sum, s, idx) => {
    if (Array.isArray(dates) && isSundayMusterDate(dates[idx])) return sum;
    const v = normalizeStatus(s);
    if (v === 'WO' || v === 'Week Off') return sum;
    if (v === 'Present' || v === 'P') return sum + 1;
    if (v === 'Half Day Present' || v === '0.5' || v === '0.50' || v === 0.5) return sum + 0.5;
    if (v === 'CO') return sum + 1;
    if (v === 'H' && isSandwichedWoOrH(statuses, idx)) return sum;
    if (v === 'H') return sum + 1;
    if (v === 'OD' || v === 'OD-0.5') return sum + 1;
    return sum;
  }, 0);
}

function isManagingPartnerPayrollRow(emp) {
  const d = String(emp?.designation ?? emp?.Designation ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return d === 'managing partner';
}

function managingPartnerDaysPresentValue(emp, computedPresent) {
  const dim = parseFloat(emp?.daysInMonth) || 0;
  if (isManagingPartnerPayrollRow(emp) && dim > 0) return dim;
  return computedPresent;
}

function payrollRowHasStoredLoh(emp) {
  const raw = emp?.loh ?? emp?.LOH;
  if (raw === undefined || raw === null) return false;
  const s = String(raw).trim();
  if (s === '') return false;
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) && n !== 0;
}

function parseLooseNumber(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const cleaned = raw.replace(/[^0-9.\-]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function getTravelChargersFromRecord(record) {
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
}

function computeDefaultOtAmountFromEarnedAndActual({ earnedBasic, actualBasic, daysInMonth, daysPresent, otHours }) {
  const dim = Number(daysInMonth) || 0;
  const dp = Number(daysPresent) || 0;
  const eb = Number(earnedBasic) || 0;
  const ab = Number(actualBasic) || 0;
  const oth = Number(otHours) || 0;
  if (dim <= 0 || oth <= 0) return 0;
  const dailyBasic = dp > 0 && eb > 0 ? eb / dp : ab / dim;
  if (dailyBasic <= 0) return 0;
  return (dailyBasic / 8) * oth * 2;
}

/** Same earned-field refresh as Payroll.js recalculateEarnedFromRow (before Setup formulae). */
export function recalculateEarnedFieldsFromPayrollRow(emp) {
  if (!emp) return emp;
  const num = (v) => parseLooseNumber(v) ?? 0;
  const actualBasic = num(emp.actualBasic ?? emp.ActualBasic);
  const actualHRA = num(emp.actualHRA ?? emp.ActualHRA);
  const actualDA = num(emp.actualDA ?? emp.ActualDA);
  const otherAllowance = num(emp.otherAllowance ?? emp.OtherAllowance);
  const specialAllowance = num(emp.specialAllowance ?? emp.SpecialAllowance);
  const daysInMonth = parseFloat(emp.daysInMonth ?? emp.DaysInMonth) || 31;
  const daysPresent = parseFloat(emp.daysPresent ?? emp.DaysPresent) || 0;
  const otHours = parseFloat(emp.otHours ?? emp.OTHours) || 0;
  const loh = parseFloat(emp.loh ?? emp.LOH) || 0;
  const arrear = parseFloat(emp.arrear) || 0;
  const arrearForPF = parseFloat(emp.arrearForPF) || 0;
  const incentive = parseFloat(emp.incentive) || 0;
  const otArrearAmount = parseFloat(emp.otArrearAmount) || 0;
  const otherAllowancesVal = num(emp.otherAllowances ?? emp.OtherAllowances);
  const dailyBasic = daysInMonth > 0 ? actualBasic / daysInMonth : 0;
  const earnedBasic = Math.max(0, dailyBasic * daysPresent - (dailyBasic / 8) * loh);
  const earnedHRA =
    (actualHRA / daysInMonth) * daysPresent - ((actualHRA / daysInMonth) / 8) * loh;
  const earnedDA = (actualDA / daysInMonth) * daysPresent - ((actualDA / daysInMonth) / 8) * loh;
  const earnedAttendanceAllowance =
    daysInMonth > 0
      ? (otherAllowance / daysInMonth) * daysPresent - ((otherAllowance / daysInMonth) / 8) * loh
      : 0;
  const earnedOtherAllowances =
    daysInMonth > 0
      ? (otherAllowancesVal / daysInMonth) * daysPresent -
        ((otherAllowancesVal / daysInMonth) / 8) * loh
      : 0;
  const earnedSpecialFromProration =
    daysInMonth > 0
      ? Math.max(
          0,
          (specialAllowance / daysInMonth) * daysPresent -
            ((specialAllowance / daysInMonth) / 8) * loh
        )
      : 0;
  const storedEarnedSpecial = num(emp.earnedSpecialAllowance ?? emp.EarnedSpecialAllowance);
  const earnedSpecialAllowance = specialAllowance > 0 ? earnedSpecialFromProration : storedEarnedSpecial;
  const lop = Math.max(0, daysInMonth - daysPresent);
  const baseEarnedGross =
    earnedBasic +
    earnedHRA +
    earnedDA +
    earnedSpecialAllowance +
    earnedAttendanceAllowance +
    earnedOtherAllowances +
    arrear +
    arrearForPF +
    incentive +
    otArrearAmount;
  const otAmount = computeDefaultOtAmountFromEarnedAndActual({
    earnedBasic,
    actualBasic,
    daysInMonth,
    daysPresent,
    otHours,
  });
  const earnedSalaryCross = Math.round(baseEarnedGross + otAmount);
  return {
    ...emp,
    lop,
    earnedBasic: Math.round(earnedBasic),
    earnedHRA: Math.round(earnedHRA),
    earnedDA: Math.round(earnedDA),
    earnedSpecialAllowance: Math.round(earnedSpecialAllowance),
    EarnedSpecialAllowance: Math.round(earnedSpecialAllowance),
    earnedAttendanceAllowance: Math.round(earnedAttendanceAllowance),
    earnedOtherAllowances: Math.round(earnedOtherAllowances),
    earnedSalaryCross,
    EarnedSalaryCross: earnedSalaryCross,
    otAmount: Math.round(otAmount),
    OTAmount: Math.round(otAmount),
    travelChargers: getTravelChargersFromRecord(emp),
  };
}

async function fetchMusterWithLohOverlay({ fromDate, toDate, userEmail, userRole }) {
  let musterUrl = `/server/attendance_muster_function/?startDate=${encodeURIComponent(fromDate)}&endDate=${encodeURIComponent(toDate)}&source=both`;
  if (userEmail) musterUrl += `&userEmail=${encodeURIComponent(userEmail)}`;
  const musterRes = await fetch(musterUrl);
  if (!musterRes.ok) return null;
  let musterData = await musterRes.json();
  if (!musterData?.employees?.length) return musterData;
  try {
    const lohRows = await fetchLohRowsForMusterOverlay({
      startDate: fromDate,
      endDate: toDate,
      userEmail,
      userRole,
    });
    if (lohRows.length > 0) {
      musterData = applyReportsLohToMusterData(musterData, lohRows);
    }
  } catch (e) {
    console.warn('Bank report muster LOH merge skipped:', e?.message || e);
  }
  return musterData;
}

async function isPayrollManualMode(month) {
  try {
    const modeRes = await fetch(
      `/server/payroll_function/automatic-selection/latest?month=${encodeURIComponent(month)}&_t=${Date.now()}`
    );
    if (modeRes.ok) {
      const modeJson = await modeRes.json().catch(() => ({}));
      return !!modeJson.manual;
    }
  } catch {
    /* default automatic */
  }
  return false;
}

/** Merge Attendance Muster into payroll rows (same rules as Payroll.js fetchPayrollData). */
export async function alignPayrollRowsWithAttendanceMuster(rows, { month, fromDate, toDate, userEmail, userRole }) {
  if (!Array.isArray(rows) || rows.length === 0) return rows;
  if (!fromDate || !toDate) return rows.map(recalculateEarnedFieldsFromPayrollRow).map(normalizePayrollRowForGridAlign);
  if (await isPayrollManualMode(month)) {
    return rows.map(recalculateEarnedFieldsFromPayrollRow).map(normalizePayrollRowForGridAlign);
  }

  const musterData = await fetchMusterWithLohOverlay({ fromDate, toDate, userEmail, userRole });
  if (!musterData?.employees?.length || !musterData?.muster) {
    return rows.map(recalculateEarnedFieldsFromPayrollRow).map(normalizePayrollRowForGridAlign);
  }

  const attendanceMap = {};
  const otHoursMap = {};
  const lohMap = {};
  musterData.employees.forEach((empId, idx) => {
    const statuses = musterData.muster[idx] || [];
    const daysPresent = calculateDaysPresentFromMusterStatuses(statuses, musterData.dates);
    const rawEmpId = String(empId ?? '').trim();
    const normalizedEmpId = normalizeEmployeeCode(empId);
    if (rawEmpId) attendanceMap[rawEmpId] = daysPresent;
    if (normalizedEmpId) attendanceMap[normalizedEmpId] = daysPresent;
    const otHours =
      musterData.monthlyOvertimePreferred && musterData.monthlyOvertimePreferred[idx] != null
        ? parseFloat(musterData.monthlyOvertimePreferred[idx]) || 0
        : 0;
    if (rawEmpId) otHoursMap[rawEmpId] = otHours;
    if (normalizedEmpId) otHoursMap[normalizedEmpId] = otHours;
    const lohRaw =
      musterData.monthlyLOHPreferred && musterData.monthlyLOHPreferred[idx] != null
        ? parseFloat(musterData.monthlyLOHPreferred[idx]) || 0
        : 0;
    const loh = parseLohHours(lohRaw);
    if (rawEmpId) lohMap[rawEmpId] = loh;
    if (normalizedEmpId) lohMap[normalizedEmpId] = loh;
  });

  return rows.map((emp) => {
    const empCodeRaw = emp.employeeCode ? String(emp.employeeCode).trim() : null;
    const empCodeNormalized = emp.employeeCode ? normalizeEmployeeCode(emp.employeeCode) : null;
    const daysInMonth = parseFloat(emp.daysInMonth) || 0;
    const matchedDaysPresent =
      empCodeRaw && attendanceMap[empCodeRaw] !== undefined
        ? attendanceMap[empCodeRaw]
        : empCodeNormalized && attendanceMap[empCodeNormalized] !== undefined
          ? attendanceMap[empCodeNormalized]
          : undefined;

    const savedOtHoursValue = Number(emp.otHours ?? emp.OTHours);
    const hasSavedOtHours = Number.isFinite(savedOtHoursValue) && savedOtHoursValue > 0;
    const otFromMuster =
      empCodeRaw && otHoursMap[empCodeRaw] !== undefined
        ? otHoursMap[empCodeRaw]
        : empCodeNormalized && otHoursMap[empCodeNormalized] !== undefined
          ? otHoursMap[empCodeNormalized]
          : undefined;
    const otHoursUpdate =
      !hasSavedOtHours && otFromMuster !== undefined
        ? { otHours: otFromMuster, OTHours: otFromMuster }
        : {};

    const lohFromMuster =
      empCodeRaw && lohMap[empCodeRaw] !== undefined
        ? lohMap[empCodeRaw]
        : empCodeNormalized && lohMap[empCodeNormalized] !== undefined
          ? lohMap[empCodeNormalized]
          : undefined;
    const lohUpdate =
      payrollRowHasStoredLoh(emp) || lohFromMuster === undefined ? {} : { loh: lohFromMuster, LOH: lohFromMuster };

    if (matchedDaysPresent !== undefined) {
      const updatedDaysPresent = managingPartnerDaysPresentValue(emp, matchedDaysPresent);
      const calculatedLOP = Math.max(0, daysInMonth - updatedDaysPresent);
      const withLoh = applyMusterLohUpdateToPayrollRow(emp, lohUpdate);
      return recalculateEarnedFieldsFromPayrollRow({
        ...withLoh,
        ...otHoursUpdate,
        daysPresent: updatedDaysPresent,
        DaysPresent: updatedDaysPresent,
        lop: calculatedLOP,
      });
    }
    if (empCodeRaw || empCodeNormalized) {
      const updatedDaysPresent = managingPartnerDaysPresentValue(emp, 0);
      const calculatedLOP = Math.max(0, daysInMonth - updatedDaysPresent);
      const withLoh = applyMusterLohUpdateToPayrollRow(emp, lohUpdate);
      return recalculateEarnedFieldsFromPayrollRow({
        ...withLoh,
        ...otHoursUpdate,
        daysPresent: updatedDaysPresent,
        DaysPresent: updatedDaysPresent,
        lop: calculatedLOP,
      });
    }
    const dimOnly = parseFloat(emp.daysInMonth) || 0;
    const mpOnly = isManagingPartnerPayrollRow(emp) && dimOnly > 0 ? { daysPresent: dimOnly, lop: 0 } : {};
    const withLohMp = applyMusterLohUpdateToPayrollRow(emp, lohUpdate);
    return recalculateEarnedFieldsFromPayrollRow({ ...withLohMp, ...otHoursUpdate, ...mpOnly });
  }).map(normalizePayrollRowForGridAlign);
}

/** Net Pay for bank reports — same as Payroll grid (muster row + normalize + Setup formulae ×2 + EGS − TD). */
export function computePayrollGridNetPayForBankReport(row, bankReportPayrollOpts) {
  if (!row) return null;
  const engine = createPayrollSetupFormulaeEngine({
    payrollFormulae: bankReportPayrollOpts?.payrollFormulae || [],
    payrollComponents: bankReportPayrollOpts?.payrollComponents || [],
    payslipTemplateConfig: bankReportPayrollOpts?.payslipTemplateConfig || {},
    reportMonth: bankReportPayrollOpts?.reportMonth || '',
  });
  let prepared = normalizePayrollRowForGridAlign(row);
  prepared = engine.applyPayrollFormulaeToEmployee(prepared);
  prepared = engine.applyPayrollFormulaeToEmployee(prepared);
  const earned =
    parseFloat(
      prepared.earnedSalaryCross ??
        prepared.EarnedSalaryCross ??
        prepared.earnedGrossSalary ??
        prepared.EarnedGrossSalary ??
        0
    ) || 0;
  const totalDed = engine.getDisplayTotalDeduction(prepared);
  if (Number.isFinite(earned) && Number.isFinite(totalDed)) {
    return Math.round(earned - totalDed);
  }
  const v = engine.getComponentDisplayValue(prepared, 'Net Pay');
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

export async function fetchPayrollRowsAlignedWithPayrollGrid({
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
  const rows = Array.isArray(json?.data) ? json.data : [];
  return alignPayrollRowsWithAttendanceMuster(rows, { month, fromDate, toDate, userEmail, userRole });
}
