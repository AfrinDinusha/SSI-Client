/**
 * Permission report: LOH from attendance muster (raw monthlyLOHPreferred).
 * Payroll LOH column uses raw muster; Late deduction uses lohHoursForLateDeduction (1.5h grace).
 */

import { applyReportsLohToMusterData, fetchLohRowsForMusterOverlay } from './musterLohReportsMerge';

export const PERMISSION_LOH_GRACE_HOURS = 1.5;

export function parseLohHours(raw) {
  const n = parseFloat(String(raw ?? '').replace(/,/g, '').trim());
  if (!Number.isFinite(n)) return 0;
  return parseFloat(n.toFixed(2));
}

/** Late deduction only: ≤1.5h → 0; else raw − 1.5h grace (payroll LOH column uses raw muster). */
export function lohHoursForLateDeduction(rawHours) {
  const rounded = parseLohHours(rawHours);
  if (rounded <= PERMISSION_LOH_GRACE_HOURS) return 0;
  return Math.round((rounded - PERMISSION_LOH_GRACE_HOURS) * 100) / 100;
}

/** Pick saved Revised LOH from row (camelCase, PascalCase, or spaced API key). */
export function pickRevisedLohFromPayrollRow(row) {
  if (!row || typeof row !== 'object') return undefined;
  const raw = row.revisedLOH ?? row.RevisedLOH ?? row['Revised LOH'] ?? row.revisedloh;
  if (raw === undefined || raw === null || String(raw).trim() === '') return undefined;
  return parseLohHours(raw);
}

/**
 * Resolve Revised LOH from row fields + current LOH (same rules as payroll_function applyRevisedLohToPayrollRow).
 */
export function resolveRevisedLohDisplayOnRow(row) {
  if (!row || typeof row !== 'object') return 0;
  const derived = lohHoursForLateDeduction(row.loh ?? row.LOH ?? 0);
  const explicit = pickRevisedLohFromPayrollRow(row);
  if (explicit === undefined) return derived;
  return explicit;
}

/** @alias resolveRevisedLohDisplayOnRow */
export function getRevisedLohForPayrollRow(row) {
  return resolveRevisedLohDisplayOnRow(row);
}

/** @deprecated use lohHoursForLateDeduction for Late; use parseLohHours for payroll LOH from muster */
export function payrollMusterMonthlyLohForPayrollRow(rawHours) {
  return lohHoursForLateDeduction(rawHours);
}

function normalizeEmployeeCode(code) {
  const raw = String(code ?? '').trim();
  if (!raw) return '';
  const withoutDecimalZero = raw.endsWith('.0') ? raw.slice(0, -2) : raw;
  return withoutDecimalZero.replace(/^0+(?=\d)/, '') || raw;
}

function payrollRowHasStoredLoh(emp) {
  const raw = emp?.loh ?? emp?.LOH;
  if (raw === undefined || raw === null) return false;
  const s = String(raw).trim();
  if (s === '') return false;
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) && n !== 0;
}

export function monthDateRangeFromPayrollMonth(month) {
  const trimmed = String(month || '').trim();
  if (!/^\d{4}-\d{2}$/.test(trimmed)) {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    return monthDateRangeFromPayrollMonth(`${y}-${m}`);
  }
  const [y, m] = trimmed.split('-').map(Number);
  const fromDate = `${trimmed}-01`;
  const endDate = new Date(y, m, 0);
  const toDate = `${trimmed}-${String(endDate.getDate()).padStart(2, '0')}`;
  return { fromDate, toDate };
}

/** Permission Used = muster raw LOH capped at 1.5h grace allowance. */
export function permissionUsedFromMusterLoh(rawMusterLoh) {
  const n = parseLohHours(rawMusterLoh);
  if (n <= 0) return '0';
  const used = Math.min(n, PERMISSION_LOH_GRACE_HOURS);
  return String(Math.round(used * 100) / 100);
}

async function fetchMusterWithLohOverlay({ fromDate, toDate, userEmail, userRole }) {
  let musterUrl = `/server/attendance_muster_function/?startDate=${encodeURIComponent(fromDate)}&endDate=${encodeURIComponent(toDate)}&source=both`;
  if (userEmail) musterUrl += `&userEmail=${encodeURIComponent(userEmail)}`;

  const musterRes = await fetch(musterUrl);
  if (!musterRes.ok) {
    throw new Error('Failed to load attendance muster LOH data.');
  }

  let musterData = await musterRes.json();
  if (!musterData?.employees?.length) {
    return musterData;
  }

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
  } catch (lohMergeErr) {
    console.warn('LOH report merge skipped:', lohMergeErr);
  }

  return musterData;
}

/** Employee code → name (payroll list used only for names, not LOH). */
async function fetchEmployeeNameMap({ month, userEmail }) {
  const { fromDate, toDate } = monthDateRangeFromPayrollMonth(month);
  let url = `/server/payroll_function/payroll?month=${encodeURIComponent(month)}&fromDate=${encodeURIComponent(fromDate)}&toDate=${encodeURIComponent(toDate)}&_t=${Date.now()}`;
  if (userEmail) url += `&userEmail=${encodeURIComponent(userEmail)}`;

  const map = {};
  try {
    const res = await fetch(url);
    if (!res.ok) return map;
    const result = await res.json();
    const list = Array.isArray(result.data) ? result.data : [];
    for (const emp of list) {
      const code = String(emp.employeeCode ?? emp.EmployeeCode ?? '').trim();
      const name = String(emp.employeeName ?? emp.EmployeeName ?? '').trim();
      if (!code) continue;
      map[code] = name;
      const norm = normalizeEmployeeCode(code);
      if (norm) map[norm] = name;
    }
  } catch (e) {
    console.warn('Employee name lookup failed:', e);
  }
  return map;
}

/**
 * Permission Report rows from attendance muster monthlyLOHPreferred (not payroll LOH).
 */
export async function fetchPermissionReportFromMuster({ month, userEmail, userRole }) {
  const { fromDate, toDate } = monthDateRangeFromPayrollMonth(month);
  const [musterData, nameMap] = await Promise.all([
    fetchMusterWithLohOverlay({ fromDate, toDate, userEmail, userRole }),
    fetchEmployeeNameMap({ month, userEmail }),
  ]);

  if (!musterData?.employees?.length) return [];

  const rows = [];
  musterData.employees.forEach((empId, idx) => {
    const rawLoh =
      musterData.monthlyLOHPreferred && musterData.monthlyLOHPreferred[idx] != null
        ? parseLohHours(musterData.monthlyLOHPreferred[idx])
        : 0;
    if (rawLoh <= 0) return;

    const employeeId = String(empId ?? '').trim();
    if (!employeeId) return;
    const normalized = normalizeEmployeeCode(employeeId);

    rows.push({
      id: employeeId,
      employeeId,
      employeeName: nameMap[employeeId] || nameMap[normalized] || '',
      permissionApplicable: String(PERMISSION_LOH_GRACE_HOURS),
      permissionUsed: permissionUsedFromMusterLoh(rawLoh),
    });
  });

  return rows.sort((a, b) => String(a.employeeName || a.employeeId).localeCompare(String(b.employeeName || b.employeeId)));
}

/**
 * Fetch payroll rows with LOH matching the Payroll screen (muster + LOH report, payroll grace).
 */
export async function fetchLivePayrollWithMusterLoh({ month, userEmail, userRole }) {
  const { fromDate, toDate } = monthDateRangeFromPayrollMonth(month);
  let url = `/server/payroll_function/payroll?month=${encodeURIComponent(month)}&fromDate=${encodeURIComponent(fromDate)}&toDate=${encodeURIComponent(toDate)}&_t=${Date.now()}`;
  if (userEmail) url += `&userEmail=${encodeURIComponent(userEmail)}`;

  const res = await fetch(url);
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Failed to load payroll data${errText ? `: ${errText}` : ''}`);
  }

  const result = await res.json();
  let data = Array.isArray(result.data) ? result.data : [];

  let manualMode = false;
  try {
    const modeRes = await fetch(
      `/server/payroll_function/automatic-selection/latest?month=${encodeURIComponent(month)}&_t=${Date.now()}`
    );
    if (modeRes.ok) {
      const modeJson = await modeRes.json().catch(() => ({}));
      manualMode = !!modeJson.manual;
    }
  } catch (modeErr) {
    console.warn('Could not read payroll mode:', modeErr);
  }

  if (manualMode || !fromDate || !toDate || data.length === 0) {
    return data;
  }

  const musterData = await fetchMusterWithLohOverlay({ fromDate, toDate, userEmail, userRole });
  if (!musterData?.employees?.length || !musterData?.muster) return data;

  const lohMap = {};
  musterData.employees.forEach((empId, idx) => {
    const rawEmpId = String(empId ?? '').trim();
    const normalizedEmpId = normalizeEmployeeCode(empId);
    const lohRaw =
      musterData.monthlyLOHPreferred && musterData.monthlyLOHPreferred[idx] != null
        ? parseFloat(musterData.monthlyLOHPreferred[idx]) || 0
        : 0;
    const loh = parseLohHours(lohRaw);
    if (rawEmpId) lohMap[rawEmpId] = loh;
    if (normalizedEmpId) lohMap[normalizedEmpId] = loh;
  });

  return data.map((emp) => {
    const empCodeRaw = emp.employeeCode ? String(emp.employeeCode).trim() : null;
    const empCodeNormalized = emp.employeeCode ? normalizeEmployeeCode(emp.employeeCode) : null;
    const lohFromMuster =
      empCodeRaw && lohMap[empCodeRaw] !== undefined
        ? lohMap[empCodeRaw]
        : empCodeNormalized && lohMap[empCodeNormalized] !== undefined
          ? lohMap[empCodeNormalized]
          : undefined;

    if (payrollRowHasStoredLoh(emp) || lohFromMuster === undefined) return emp;
    return { ...emp, loh: lohFromMuster, LOH: lohFromMuster };
  });
}
