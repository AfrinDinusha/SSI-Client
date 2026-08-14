/**
 * Align muster LOH with LOH Report (`reports_function` /loh) — same overlay as Payroll.
 */

import { normalizeEmployeeCode } from './bankReportPayrollShared';

function normalizeLohReportDateYmd(value) {
  if (!value) return '';
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

/** All employee-code aliases for matching muster rows to LOH report rows. */
function employeeCodeAliases(code) {
  const raw = String(code ?? '').trim();
  if (!raw) return [];
  const out = new Set([raw]);
  const norm = normalizeEmployeeCode(raw);
  if (norm) out.add(norm);
  if (/^\d+$/.test(raw)) out.add(String(parseInt(raw, 10)));
  if (norm && /^\d+$/.test(norm)) out.add(String(parseInt(norm, 10)));
  return [...out];
}

function primaryEmployeeIdFromLohRow(row) {
  return String(row.employeeId ?? row.EmployeeId ?? row.employeeID ?? '').trim();
}

export function employeeIdsMatchForLoh(musterEmpId, lohRowEmpId) {
  const aliasesA = employeeCodeAliases(musterEmpId);
  const aliasesB = employeeCodeAliases(lohRowEmpId);
  return aliasesA.some((a) => aliasesB.includes(a));
}

/**
 * Map of empAlias_YYYY-MM-DD -> hours.
 * Same employee+date written once (last wins) — mirrors LOHReport calendar grouping.
 */
function buildLohHoursMapFromReportsRows(lohRows) {
  const map = {};
  if (!Array.isArray(lohRows)) return map;

  // First dedupe by canonical emp + date (LOH Report: one cell per date)
  const byCanonicalDate = {};
  for (const row of lohRows) {
    const empId = primaryEmployeeIdFromLohRow(row);
    if (!empId) continue;
    const dateStr = normalizeLohReportDateYmd(row.date);
    if (!dateStr) continue;
    const hours = parseFloat(String(row.lossOfHours ?? '0').replace(/,/g, ''));
    if (!Number.isFinite(hours)) continue;
    const canonical = normalizeEmployeeCode(empId) || empId;
    byCanonicalDate[`${canonical}_${dateStr}`] = hours;
  }

  for (const [canonKey, hours] of Object.entries(byCanonicalDate)) {
    const sep = canonKey.lastIndexOf('_');
    const canonical = canonKey.slice(0, sep);
    const dateStr = canonKey.slice(sep + 1);
    for (const alias of employeeCodeAliases(canonical)) {
      map[`${alias}_${dateStr}`] = hours;
    }
  }

  return map;
}

function lookupLohHoursInMap(map, empId, dateStr) {
  for (const alias of employeeCodeAliases(empId)) {
    const key = `${alias}_${dateStr}`;
    if (map[key] !== undefined) return map[key];
  }
  return undefined;
}

/**
 * Monthly total per employee — same as LOH Report "Total Hours":
 * one value per date in range, then sum (includes 0.00).
 */
function buildMonthlyLohTotalsFromReportsRows(lohRows, employees, dates) {
  const map = buildLohHoursMapFromReportsRows(lohRows);
  const dateList = Array.isArray(dates) ? dates : [];

  return employees.map((empId) => {
    let total = 0;

    if (dateList.length > 0) {
      for (const dateStr of dateList) {
        const normDate = normalizeLohReportDateYmd(dateStr) || String(dateStr).trim();
        const hours = lookupLohHoursInMap(map, empId, normDate);
        if (hours !== undefined && Number.isFinite(hours)) total += hours;
      }
    } else {
      // No muster dates: date-dedupe matching rows (same as LOH Report grouping)
      const byDate = {};
      for (const row of lohRows) {
        if (!employeeIdsMatchForLoh(empId, primaryEmployeeIdFromLohRow(row))) continue;
        const dateStr = normalizeLohReportDateYmd(row.date);
        if (!dateStr) continue;
        const hours = parseFloat(String(row.lossOfHours ?? '0').replace(/,/g, ''));
        if (!Number.isFinite(hours)) continue;
        byDate[dateStr] = hours;
      }
      total = Object.values(byDate).reduce((sum, h) => sum + h, 0);
    }

    return parseFloat((total || 0).toFixed(2));
  });
}

function isMusterCellLohExcluded(status, shiftTypeLabel) {
  const st = String(status ?? '').trim();
  if (st === 'WO' || st === 'H' || st === 'Week Off') return true;
  const sh = String(shiftTypeLabel ?? '').toLowerCase();
  if (sh.includes('housekeeping') || sh.includes('house keeping')) return true;
  return false;
}

/** Format LOH column total for display/export (show 0.50, not "-", when LOH > 0). */
export function formatMusterLohTotal(value) {
  const n = parseFloat(value);
  if (!Number.isFinite(n) || n <= 0) return '-';
  return n.toFixed(2);
}

/**
 * Replace muster `loh` / `monthlyLOHPreferred` using LOH Report data (`reports_function` /loh).
 * monthlyLOHPreferred always matches LOH Report Total Hours for the same date range.
 */
export function applyReportsLohToMusterData(musterData, lohRows) {
  if (!musterData || !Array.isArray(musterData.employees) || !Array.isArray(musterData.dates)) {
    return musterData;
  }
  if (!Array.isArray(lohRows) || lohRows.length === 0) return musterData;

  const map = buildLohHoursMapFromReportsRows(lohRows);
  const dates = musterData.dates;

  const newLoh = musterData.employees.map((empId, rowIdx) => {
    const rowStatuses = musterData.muster?.[rowIdx] || [];
    const rowShiftTypes = musterData.shiftTypes?.[rowIdx] || [];

    return dates.map((dateStr, colIdx) => {
      if (isMusterCellLohExcluded(rowStatuses[colIdx], rowShiftTypes[colIdx])) return '';
      const hours = lookupLohHoursInMap(map, empId, dateStr);
      if (hours === undefined) return '';
      return parseFloat((hours || 0).toFixed(2));
    });
  });

  // Prefer report calendar total (all dates in range), not sum of WO/H-blanked daily cells
  const monthlyLOHPreferred = buildMonthlyLohTotalsFromReportsRows(
    lohRows,
    musterData.employees,
    dates
  );

  return {
    ...musterData,
    loh: newLoh,
    monthlyLOHPreferred,
  };
}

export async function fetchLohRowsForMusterOverlay({
  startDate,
  endDate,
  contractor,
  department,
  userEmail,
  userRole,
}) {
  let grace = '10';
  let designationApplicableTo = '';

  try {
    const desRes = await fetch('/server/reports_function/loh-designation-applicable');
    const desJson = await desRes.json().catch(() => ({}));
    const g = String(desJson?.data?.grace ?? '').trim();
    if (g && /^\d+$/.test(g)) grace = g;
    const designations = desJson?.data?.designations || [];
    const only = Array.isArray(designations)
      ? designations.filter((v) => v && String(v).toLowerCase() !== 'all')
      : [];
    if (only.length > 0) designationApplicableTo = only.join(',');
  } catch (_) {
    /* use defaults */
  }

  const q = new URLSearchParams({
    _t: String(Date.now()),
    startDate,
    endDate,
    grace,
  });
  if (contractor && contractor !== 'All') q.set('contractor', contractor);
  if (department && department !== 'All') q.set('department', department);
  if (designationApplicableTo) q.set('designationApplicableTo', designationApplicableTo);
  if (userEmail) q.set('userEmail', userEmail);
  if (userRole) q.set('userRole', userRole);

  const lohRes = await fetch(`/server/reports_function/loh?${q.toString()}`);
  if (!lohRes.ok) return [];
  const lohJson = await lohRes.json().catch(() => ({}));
  return Array.isArray(lohJson.data) ? lohJson.data : [];
}
