'use strict';

function sourceHasCompOffTakenSegment(source) {
  const s = String(source || '');
  if (s === 'CompOff') return true;
  return /(^|\+)CompOff($|\+)/.test(s);
}

function addDaysYmd(ymd, days) {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd;
  const d = new Date(`${ymd}T12:00:00`);
  if (isNaN(d.getTime())) return ymd;
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function bhrFetchEndExtendedFrom(endDate) {
  const d = new Date(`${endDate}T12:00:00`);
  if (isNaN(d.getTime())) return endDate;
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function buildDatesList(startDate, endDate) {
  const dates = [];
  const start = new Date(`${startDate}T12:00:00`);
  const end = new Date(`${endDate}T12:00:00`);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return dates;
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

function classifyShiftType(rawType) {
  const t = String(rawType || '').trim().toUpperCase();
  const compact = t.replace(/\s+/g, '');
  if (!t) return 'GENERAL';
  if (
    t === 'HOUSEKEEPING' || t === 'HOUSEKEEPING SHIFT' || t === 'HOUSE KEEPING' || t === 'HK' ||
    t.includes('HOUSEKEEPING') || compact.includes('HOUSEKEEPING')
  ) return 'HOUSEKEEPING';
  if (t === '1ST' || t === '1ST SHIFT' || t === 'FIRST' || t === 'FIRST SHIFT' || t === '1' || t === 'SHIFT 1' || t.includes('1ST') || t.includes('FIRST')) {
    return 'FIRST';
  }
  if (t === '2ND' || t === '2ND SHIFT' || t === 'SECOND' || t === 'SECOND SHIFT' || t === '2' || t === 'SHIFT 2' || t.includes('2ND') || t.includes('SECOND')) {
    return 'SECOND';
  }
  if (t === '3RD' || t === '3RD SHIFT' || t === 'THIRD' || t === 'THIRD SHIFT' || t === '3' || t === 'SHIFT 3' || t.includes('3RD') || t.includes('THIRD')) {
    return 'THIRD';
  }
  if (t === '4TH' || t === '4TH SHIFT' || t === 'FOURTH' || t === 'FOURTH SHIFT' || t === '4' || t === 'SHIFT 4' || t.includes('4TH') || t.includes('FOURTH')) {
    return 'FOURTH';
  }
  if (t === 'GENERAL II' || t === 'GENERALII' || compact.includes('GENERALII') || (t.includes('GENERAL') && t.includes('II'))) {
    return 'GENERAL_II';
  }
  return 'GENERAL';
}

function normalizeDateForCompare(dateVal) {
  if (!dateVal) return '';
  if (typeof dateVal === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateVal)) return dateVal;
    const ddmmyyyyMatch = dateVal.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (ddmmyyyyMatch) {
      const [, day, month, year] = ddmmyyyyMatch;
      return `${year}-${month}-${day}`;
    }
  }
  return String(dateVal);
}

/**
 * True when date has no NewShiftMap row but lies within that employee's NewShiftMap
 * min–max span for the same calendar month (not merely "any row in the filter range").
 */
function isDateWithinEmployeeNewShiftMapSpan(newShiftMap, empId, dateStr) {
  const emp = String(empId || '').trim();
  const date = normalizeDateForCompare(dateStr);
  if (!emp || !date || date.length < 7) return false;
  const monthPrefix = date.slice(0, 7);
  let minDate = null;
  let maxDate = null;
  for (const key of Object.keys(newShiftMap || {})) {
    if (!key.startsWith(`${emp}_`)) continue;
    const d = key.slice(emp.length + 1);
    if (!d.startsWith(monthPrefix)) continue;
    if (!minDate || d < minDate) minDate = d;
    if (!maxDate || d > maxDate) maxDate = d;
  }
  if (!minDate || !maxDate) return false;
  return date >= minDate && date <= maxDate;
}

function buildGetShiftTypeForDate(shiftMap, newShiftMap) {
  return (empId, dateStr) => {
    const emp = String(empId || '').trim();
    const date = normalizeDateForCompare(dateStr);
    const fromNew = newShiftMap[`${emp}_${date}`];
    if (fromNew) return classifyShiftType(fromNew);

    if (isDateWithinEmployeeNewShiftMapSpan(newShiftMap, emp, date)) return 'GENERAL';

    if (!shiftMap[emp] || shiftMap[emp].length === 0) return 'GENERAL';

    let foundGeneral = false;
    for (const shift of shiftMap[emp]) {
      const s = String(shift.assignedShift || '').trim().toUpperCase();
      const inRange =
        (shift.fromdate && shift.todate && dateStr >= shift.fromdate && dateStr <= shift.todate) ||
        (shift.fromdate && !shift.todate && dateStr >= shift.fromdate) ||
        (!shift.fromdate && shift.todate && dateStr <= shift.todate) ||
        (!shift.fromdate && !shift.todate);
      if (!inRange) continue;

      const cls = classifyShiftType(s);
      if (cls === 'GENERAL') foundGeneral = true;
      else return cls;
    }
    return foundGeneral ? 'GENERAL' : 'GENERAL';
  };
}

function canRePairOvernightPunches(rec) {
  if (!rec) return true;
  const s = String(rec.Source || '');
  if (s.includes('OnDuty')) return false;
  if (sourceHasCompOffTakenSegment(s) || s.includes('CompOffWorkedOn')) return false;
  if (s === 'Regularization' || s.includes('Regularization')) return false;
  if (s === 'BioMax' || (s.includes('BioMax') && !s.includes('BHR') && !s.includes('Attendance'))) return false;
  return true;
}

function getPunchMinutes(eventTime) {
  const parts = String(eventTime || '').trim().split(' ');
  if (parts.length < 2) return null;
  const [h, m] = parts[1].split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

function isEarlyMorningPunch(eventTime) {
  const mins = getPunchMinutes(eventTime);
  return mins !== null && mins < 12 * 60;
}

/**
 * 3rd/4th shift: alternate IN/OUT across calendar days (checkout next morning pairs with prior evening check-in).
 */
function applyOvernightShiftPunchPairing({
  allLogs,
  byKey,
  startDate,
  endDate,
  dates,
  isThirdOrFourthShiftOnDate,
  bhrFetchEndExtended,
  logPrefix = ''
}) {
  if (!allLogs || allLogs.length === 0 || !byKey || !isThirdOrFourthShiftOnDate) return 0;

  const fetchEnd = bhrFetchEndExtended || bhrFetchEndExtendedFrom(endDate);
  const dateList = dates && dates.length > 0 ? dates : buildDatesList(startDate, endDate);

  const punchesByEmp = {};
  for (const r of allLogs) {
    const empId = String(r.EmployeeID || r.EmployeeId || '').trim();
    const eventTime = String(r.EventTime || '').trim();
    if (!empId || !eventTime) continue;
    const punchDate = eventTime.split(' ')[0];
    if (punchDate < startDate || punchDate > fetchEnd) continue;
    if (!punchesByEmp[empId]) punchesByEmp[empId] = [];
    punchesByEmp[empId].push(eventTime);
  }

  let pairedEmployees = 0;

  for (const empId of Object.keys(punchesByEmp)) {
    const hasOvernightShift = dateList.some((date) => isThirdOrFourthShiftOnDate(empId, date));
    if (!hasOvernightShift) continue;
    pairedEmployees += 1;

    for (const date of dateList) {
      if (!isThirdOrFourthShiftOnDate(empId, date)) continue;
      const key = `${empId}_${date}`;
      const rec = byKey[key];
      if (rec && canRePairOvernightPunches(rec)) {
        rec.FirstIN = null;
        rec.LastOUT = null;
      }
    }

    const punches = punchesByEmp[empId].sort();
    let openShiftDate = null;

    for (const eventTime of punches) {
      const punchDate = eventTime.split(' ')[0];

      if (openShiftDate !== null) {
        const key = `${empId}_${openShiftDate}`;
        if (!byKey[key]) {
          byKey[key] = { EmployeeID: empId, Date: openShiftDate, FirstIN: null, LastOUT: null, Source: 'BHR' };
        }
        if (canRePairOvernightPunches(byKey[key])) {
          byKey[key].LastOUT = eventTime;
          byKey[key].Source = byKey[key].Source || 'BHR';
        }
        openShiftDate = null;
        continue;
      }

      if (isEarlyMorningPunch(eventTime)) {
        const prevDate = addDaysYmd(punchDate, -1);
        if (prevDate >= startDate && isThirdOrFourthShiftOnDate(empId, prevDate)) {
          const prevKey = `${empId}_${prevDate}`;
          const prevRec = byKey[prevKey];
          if (prevRec && prevRec.FirstIN && !prevRec.LastOUT && canRePairOvernightPunches(prevRec)) {
            prevRec.LastOUT = eventTime;
            continue;
          }
        }
        continue;
      }

      if (punchDate <= endDate && isThirdOrFourthShiftOnDate(empId, punchDate)) {
        const key = `${empId}_${punchDate}`;
        if (!byKey[key]) {
          byKey[key] = { EmployeeID: empId, Date: punchDate, FirstIN: null, LastOUT: null, Source: 'BHR' };
        }
        if (canRePairOvernightPunches(byKey[key])) {
          byKey[key].FirstIN = eventTime;
          byKey[key].Source = byKey[key].Source || 'BHR';
          openShiftDate = punchDate;
        }
      }
    }
  }

  if (pairedEmployees > 0 && logPrefix) {
    console.log(`${logPrefix}: Applied overnight punch pairing for ${pairedEmployees} 3rd/4th shift employee(s)`);
  }

  return pairedEmployees;
}

/**
 * When an employee has NewShiftMap rows in the same month and this date falls inside
 * their min–max NewShiftMap span but has no row, treat as General (not legacy Shiftmap).
 */
function buildNewShiftMapDateHelpers(newShiftMap) {
  const hasNewShiftMapEntry = (empId, dateStr) => {
    const emp = String(empId || '').trim();
    const date = normalizeDateForCompare(dateStr);
    const val = newShiftMap[`${emp}_${date}`];
    return val !== undefined && val !== null && String(val).trim() !== '';
  };
  const isUnmappedNewShiftMapDate = (empId, dateStr) => {
    if (hasNewShiftMapEntry(empId, dateStr)) return false;
    return isDateWithinEmployeeNewShiftMapSpan(newShiftMap, empId, dateStr);
  };
  return { hasNewShiftMapEntry, isUnmappedNewShiftMapDate };
}

module.exports = {
  sourceHasCompOffTakenSegment,
  addDaysYmd,
  bhrFetchEndExtendedFrom,
  buildDatesList,
  classifyShiftType,
  normalizeDateForCompare,
  buildGetShiftTypeForDate,
  buildNewShiftMapDateHelpers,
  isDateWithinEmployeeNewShiftMapSpan,
  applyOvernightShiftPunchPairing
};
