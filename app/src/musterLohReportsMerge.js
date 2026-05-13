/**
 * Align muster LOH with LOH Report (`reports_function` /loh) — same overlay as Attendance Muster UI.
 */

function normalizeLohReportDateYmd(value) {
  if (!value) return '';
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function buildLohHoursMapFromReportsRows(lohRows) {
  const map = {};
  if (!Array.isArray(lohRows)) return map;
  for (const row of lohRows) {
    const empId = String(row.employeeId ?? row.EmployeeId ?? '').trim();
    if (!empId) continue;
    const dateStr = normalizeLohReportDateYmd(row.date);
    if (!dateStr) continue;
    const hours = parseFloat(String(row.lossOfHours ?? '0').replace(/,/g, ''));
    if (!Number.isFinite(hours)) continue;
    map[`${empId}_${dateStr}`] = hours;
  }
  return map;
}

function isMusterCellLohExcluded(status, shiftTypeLabel) {
  const st = String(status ?? '').trim();
  if (st === 'WO' || st === 'H' || st === 'Week Off') return true;
  const sh = String(shiftTypeLabel ?? '').toLowerCase();
  if (sh.includes('housekeeping') || sh.includes('house keeping')) return true;
  return false;
}

/**
 * Replace muster `loh` / `monthlyLOHPreferred` using LOH Report data (`reports_function` /loh).
 */
export function applyReportsLohToMusterData(musterData, lohRows) {
  if (!musterData || !Array.isArray(musterData.employees) || !Array.isArray(musterData.dates)) {
    return musterData;
  }
  const map = buildLohHoursMapFromReportsRows(lohRows);
  if (Object.keys(map).length === 0) return musterData;

  const dates = musterData.dates;
  const newLoh = musterData.employees.map((empId, rowIdx) => {
    const empStr = String(empId).trim();
    const rowStatuses = musterData.muster?.[rowIdx] || [];
    const rowShiftTypes = musterData.shiftTypes?.[rowIdx] || [];
    return dates.map((dateStr, colIdx) => {
      if (isMusterCellLohExcluded(rowStatuses[colIdx], rowShiftTypes[colIdx])) return '';
      const key = `${empStr}_${dateStr}`;
      if (map[key] === undefined) return '';
      return parseFloat((map[key] || 0).toFixed(2));
    });
  });

  const monthlyLOHPreferred = newLoh.map((row) => {
    const total = (row || []).reduce((sum, v) => {
      if (v !== '' && v != null && !Number.isNaN(v)) return sum + parseFloat(v);
      return sum;
    }, 0);
    return parseFloat((total || 0).toFixed(2));
  });

  return {
    ...musterData,
    loh: newLoh,
    monthlyLOHPreferred
  };
}

export async function fetchLohRowsForMusterOverlay({
  startDate,
  endDate,
  contractor,
  department,
  userEmail,
  userRole
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
    grace
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
