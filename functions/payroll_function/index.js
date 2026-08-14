'use strict';

const catalyst = require('zcatalyst-sdk-node');
const url = require('url');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');

// Mapping of deduction types to File Store folder IDs
const DEDUCTION_FOLDER_IDS = {
  'Rent': '12381000001423548',    // Rent folder ID from the image
  'Advance': '12381000001423529'  // Advance folder ID from the image
};

// Normalize employee code for consistent matching (handles "00123", "123.0", etc.)
function normalizeEmployeeCode(code) {
  const raw = String(code ?? '').trim();
  if (!raw) return '';
  const withoutDecimalZero = raw.endsWith('.0') ? raw.slice(0, -2) : raw;
  return withoutDecimalZero.replace(/^0+(?=\d)/, '') || raw;
}

function sourceHasCompOffTakenSegment(source) {
  const s = String(source || '');
  if (s === 'CompOff') return true;
  return /(^|\+)CompOff($|\+)/.test(s);
}

/** Designation MANAGING PARTNER (case-insensitive): full month treated as days present in payroll. */
function isManagingPartnerDesignation(emp) {
  if (!emp || typeof emp !== 'object') return false;
  const d = String(emp.Designation ?? emp.designation ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return d === 'managing partner';
}

/** LOP = days in month − days present; keep up to 2 decimals when present is fractional (e.g. 21.5). */
function lopDaysValue(lop) {
  const n = Number(lop);
  if (!Number.isFinite(n)) return 0;
  return parseFloat(Math.max(0, n).toFixed(2));
}

// Read numeric field from Employee row (handles DB column name variants: ActualHRA, actualHRA, "Actual HRA", etc.)
function getEmployeeNum(emp, ...keys) {
  if (!emp || typeof emp !== 'object') return 0;
  for (const k of keys) {
    const v = emp[k];
    if (v !== undefined && v !== null && v !== '') {
      const raw = String(v).trim();
      const cleaned = raw.replace(/[^0-9.\-]/g, ''); // allow "₹15,200" / "15,200"
      const n = Number(cleaned);
      if (Number.isFinite(n)) return n;
    }
  }
  return 0;
}

// Like getEmployeeNum, but returns null when the field is missing/blank (so callers can decide fallback behavior).
function getEmployeeNumOptional(emp, ...keys) {
  if (!emp || typeof emp !== 'object') return null;
  for (const k of keys) {
    const v = emp[k];
    if (v !== undefined && v !== null && v !== '') {
      const raw = String(v).trim();
      const cleaned = raw.replace(/[^0-9.\-]/g, '');
      const n = Number(cleaned);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

function resolveActualTotalSalaryFromEmployee(emp, computedFallback) {
  const fromEmployee = getEmployeeNumOptional(emp, 'TotalSalary', 'totalSalary', 'Total Salary', 'Total Salary (Auto-calculated)');
  return fromEmployee !== null ? fromEmployee : computedFallback;
}

/** Employee form: Actual Total Salary = Actual Basic + Actual HRA + Actual DA + Special Allowance (excludes attendance / other allowances / travel). */
function computedEmployeeFormActualTotalSalary(actualBasic, actualHRA, actualDA, specialAllowance) {
  const sum =
    (Number(actualBasic) || 0) +
    (Number(actualHRA) || 0) +
    (Number(actualDA) || 0) +
    (Number(specialAllowance) || 0);
  return Math.round(sum * 100) / 100;
}

// Days in month excluding Sundays (e.g. March: 31 - 4 = 27)
function getDaysInMonthExcludingSundays(year, month) {
  const lastDay = new Date(year, month, 0).getDate();
  let count = 0;
  for (let d = 1; d <= lastDay; d++) {
    if (new Date(year, month - 1, d).getDay() !== 0) count++;
  }
  return count;
}

// Helper function to calculate hours worked between FirstIn and LastOut
function calculateHoursWorked(firstIn, lastOut, date) {
  if (!firstIn || !lastOut) {
    return 0;
  }

  try {
    // Handle different time formats
    let firstInTime, lastOutTime;

    // If firstIn/lastOut are just times (HH:MM:SS), combine with date
    if (firstIn.includes(' ') || firstIn.includes('T')) {
      // Already a full datetime string
      firstInTime = new Date(firstIn);
    } else {
      // Just time, combine with date
      firstInTime = new Date(`${date} ${firstIn}`);
    }

    if (lastOut.includes(' ') || lastOut.includes('T')) {
      // Already a full datetime string
      lastOutTime = new Date(lastOut);
    } else {
      // Just time, combine with date
      lastOutTime = new Date(`${date} ${lastOut}`);
    }

    // Handle case where lastOut might be next day (e.g., night shift)
    if (lastOutTime < firstInTime) {
      lastOutTime.setDate(lastOutTime.getDate() + 1);
    }

    const hoursWorked = (lastOutTime - firstInTime) / (1000 * 60 * 60);
    return hoursWorked;
  } catch (err) {
    console.log(`Error calculating hours worked: ${err.message}`, { firstIn, lastOut, date });
    return 0;
  }
}

/** Default OT amount when no Setup formula: (daily basic / 8) × OT hours × 2. Daily = earnedBasic ÷ days present, else actualBasic ÷ days in month (avoids double-scaling when days present changes). */
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

// Helper function to calculate present days from attendance muster logic
// This uses the same logic as attendance_muster_function to ensure consistency
async function calculatePresentDaysFromMuster(catalystApp, month, contractor, department, employeeId, fromDate, toDate) {
  const presentDaysMap = {}; // Map: employeeId -> totalDaysPresent

  try {
    // Build date range - use custom dates if provided, otherwise use month
    let startDate, endDateStr;
    if (fromDate && toDate) {
      // Normalize dates to ISO format (YYYY-MM-DD) to ensure consistent comparison
      // If already in YYYY-MM-DD format, use directly to avoid timezone issues
      // Otherwise, parse and format properly
      function normalizeDate(dateStr) {
        // If already in YYYY-MM-DD format, return as-is
        if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
          return dateStr;
        }
        // Try parsing as date and extract YYYY-MM-DD without timezone conversion
        const dateObj = new Date(dateStr);
        if (isNaN(dateObj.getTime())) {
          throw new Error(`Invalid date format: ${dateStr}`);
        }
        // Use local date components to avoid timezone shift
        const year = dateObj.getFullYear();
        const month = String(dateObj.getMonth() + 1).padStart(2, '0');
        const day = String(dateObj.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      }
      startDate = normalizeDate(fromDate);
      endDateStr = normalizeDate(toDate);
      console.log(`calculatePresentDaysFromMuster: Custom date range: ${startDate} to ${endDateStr}`);
    } else {
      // Build date range for the month
      const [year, monthNum] = month.split('-').map(Number);
      startDate = `${month}-01`;
      // Get last day of the month: new Date(year, monthNum, 0) gives last day of previous month
      // So new Date(year, monthNum + 1, 0) gives last day of current month
      const lastDayOfMonth = new Date(year, monthNum, 0).getDate();
      endDateStr = `${month}-${String(lastDayOfMonth).padStart(2, '0')}`;
      console.log(`calculatePresentDaysFromMuster: Month ${month}, Date range: ${startDate} to ${endDateStr}`);
    }
    const endDate = new Date(endDateStr);
 
    // Get employee filter conditions
    let employeeFilterConditions = [];
    let employeeIds = [];
 
    // Contractor filter
    if (contractor && contractor !== 'All') {
      try {
      const normalized = String(contractor || '').replace(/\s+/g, ' ').trim().replace(/'/g, "''");
        const contractorEmployeeQuery = await catalystApp.zcql().executeZCQLQuery(
        `SELECT EmployeeCode FROM Employee WHERE ContractorName LIKE '%${normalized}%'`
        );
        if (contractorEmployeeQuery && contractorEmployeeQuery.length > 0) {
          employeeIds = contractorEmployeeQuery.map(emp => emp.Employee.EmployeeCode);
        }
      } catch (error) {
        console.error('Error applying contractor filter:', error);
      }
    }
 
    // Department filter
    if (department && department !== 'All') {
      try {
        const departmentEmployeeQuery = await catalystApp.zcql().executeZCQLQuery(
          `SELECT EmployeeCode FROM Employee WHERE Department = '${department}'`
        );
        if (departmentEmployeeQuery && departmentEmployeeQuery.length > 0) {
          const departmentEmployeeIds = departmentEmployeeQuery.map(emp => emp.Employee.EmployeeCode);
          if (employeeIds.length > 0) {
            employeeIds = employeeIds.filter(id => departmentEmployeeIds.includes(id));
          } else {
            employeeIds = departmentEmployeeIds;
          }
        }
      } catch (error) {
        console.error('Error applying department filter:', error);
      }
    }
 
    // Employee filter
    if (employeeId && employeeId !== 'All') {
      if (employeeIds.length > 0) {
        employeeIds = employeeIds.filter(id => id === employeeId);
      } else {
        employeeIds = [employeeId];
      }
    }
 
    // Build employee filter condition
    if (employeeIds.length > 0) {
      const employeeIdList = employeeIds.map(id => `'${id}'`).join(',');
      employeeFilterConditions.push(`EmployeeID IN (${employeeIdList})`);
    }
 
    // Helper functions (defined early so we can use them for logging)
    // Use local date components to avoid timezone issues
    function isSunday(dateStr) {
      // Parse YYYY-MM-DD format and use local date components
      const [year, month, day] = dateStr.split('-').map(Number);
      const date = new Date(year, month - 1, day);
      const dayOfWeek = date.getDay(); // 0 = Sunday, 6 = Saturday
      return dayOfWeek === 0;
    }
 
    // Build date list for the selected date range (fromDate to toDate, or full month if not specified)
    // Use date string manipulation to avoid timezone issues
    const dates = [];
    const [startYear, startMonth, startDay] = startDate.split('-').map(Number);
    const [endYear, endMonth, endDay] = endDateStr.split('-').map(Number);
    const startDateObj = new Date(startYear, startMonth - 1, startDay);
    const endDateObj = new Date(endYear, endMonth - 1, endDay);
 
    for (let d = new Date(startDateObj); d <= endDateObj; d.setDate(d.getDate() + 1)) {
      // Format as YYYY-MM-DD using local date components to avoid timezone shift
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      dates.push(`${year}-${month}-${day}`);
    }
    console.log(`Date list built: ${dates.length} days from ${dates[0]} to ${dates[dates.length - 1]}`);
 
    const SundaysInRange = dates.filter(date => isSunday(date));
    console.log(`Sundays in date range: ${SundaysInRange.length} (${SundaysInRange.join(', ')})`);
 
    // Fetch BHR data
    const allLogs = [];
    let offset = 0;
    const pageSize = 300;
    let hasMore = true;
    while (hasMore) {
      let query = `SELECT EmployeeID, EventTime, DeviceSerial FROM BHR
                   WHERE EventTime >= '${startDate} 00:00:00'
                   AND EventTime <= '${endDateStr} 23:59:59'`;
      if (employeeFilterConditions.length > 0) {
        query += ` AND ${employeeFilterConditions.join(' AND ')}`;
      }
      query += ` ORDER BY ROWID LIMIT ${pageSize} OFFSET ${offset}`;
      const batch = await catalystApp.zcql().executeZCQLQuery(query);
      const rows = batch.map(r => r.BHR);
      if (rows.length === 0) {
        hasMore = false;
        break;
      }
      allLogs.push(...rows);
      offset += pageSize;
      if (rows.length < pageSize) hasMore = false;
      if (allLogs.length > 20000) break;
    }
 
    // Aggregate per EmployeeID + Date
    const byKey = {};
    allLogs.forEach(r => {
      const dateStr = r.EventTime.split(' ')[0];
      const key = `${r.EmployeeID}_${dateStr}`;
      if (!byKey[key]) {
        byKey[key] = {
          EmployeeID: r.EmployeeID,
          Date: dateStr,
          FirstIN: r.EventTime,
          LastOUT: r.EventTime,
          Source: 'BHR'
        };
      } else {
        if (r.EventTime < byKey[key].FirstIN) byKey[key].FirstIN = r.EventTime;
        if (r.EventTime > byKey[key].LastOUT) byKey[key].LastOUT = r.EventTime;
      }
    });
 
    // Fetch Attendance table data
    let attOffset = 0;
    let attHasMore = true;
    const attPageSize = 300;
 
    let attendanceRecordsCount = 0;
    while (attHasMore) {
      let aQuery = `SELECT EmployeeId, AttendanceDate, FirstIn, LastOut, Status FROM Attendance WHERE AttendanceDate >= '${startDate}' AND AttendanceDate <= '${endDateStr}'`;
      if (employeeFilterConditions.length > 0) {
        const attendanceEmployeeFilter = employeeFilterConditions[0].replace('EmployeeID', 'EmployeeId');
        aQuery += ` AND ${attendanceEmployeeFilter}`;
      }
      aQuery += ` ORDER BY EmployeeId, AttendanceDate LIMIT ${attPageSize} OFFSET ${attOffset}`;
      console.log(`Attendance query (offset ${attOffset}): ${aQuery}`);
      const aBatch = await catalystApp.zcql().executeZCQLQuery(aQuery);
      const aRows = aBatch.map(r => r.Attendance);
      if (aRows.length === 0) {
        attHasMore = false;
        break;
      }
   
      const normalizeTimeForDate = (dateStr, rawVal) => {
        if (!rawVal) return '';
        const raw = String(rawVal).trim();
        if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(:\d{2})?$/.test(raw)) return raw;
        const dmy = raw.match(/^(\d{2})[-\/](\d{2})[-\/](\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/);
        if (dmy) {
          const DD = dmy[1], MM = dmy[2], YYYY = dmy[3];
          const hh = dmy[4], mm = dmy[5], ss = dmy[6] ? dmy[6] : '00';
          return `${YYYY}-${MM}-${DD} ${hh}:${mm}:${ss}`;
        }
        const m = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
        if (m) {
          let h = parseInt(m[1], 10);
          const mm = m[2];
          const ss = m[3] ? m[3] : '00';
          const ampm = m[4] ? m[4].toUpperCase() : null;
          if (ampm) {
            if (ampm === 'AM' && h === 12) h = 0;
            if (ampm === 'PM' && h < 12) h += 12;
          }
          const HH = String(h).padStart(2, '0');
          return `${dateStr} ${HH}:${mm}:${ss}`;
        }
        if (/^\d{1,2}:\d{2}$/.test(raw)) {
          const [hStr, mStr] = raw.split(':');
          const HH = String(parseInt(hStr, 10)).padStart(2, '0');
          return `${dateStr} ${HH}:${mStr}:00`;
        }
        const d = new Date(`${dateStr} ${raw}`);
        if (!isNaN(d)) {
          const HH = String(d.getHours()).padStart(2, '0');
          const MM = String(d.getMinutes()).padStart(2, '0');
          const SS = String(d.getSeconds()).padStart(2, '0');
          return `${dateStr} ${HH}:${MM}:${SS}`;
        }
        return '';
      };
   
      const normalizeProvidedStatus = (val) => {
        if (!val) return '';
        const s = String(val).trim();
        const sUpper = s.toUpperCase();
        const sLower = s.toLowerCase();
        // Check for WO (Week Off) - case-insensitive
        if (sUpper === 'WO') return 'WO';
        // Check for H (Holiday) - case-insensitive, but only if it's a single letter 'H' or 'h'
        // If it's 'h' followed by other text (like 'half'), it's half day
        if (sUpper === 'H' && s.length === 1) return 'H';
        // Now check other statuses (convert to lowercase for comparison)
        if (sLower === 'p' || sLower === 'present' || sLower === 'full' || sLower === '1') return 'Present';
        if (sLower === 'h' || sLower === 'half' || sLower === 'half day' || sLower === '0.5' || sLower === 'half day present') return 'Half Day Present';
        if (sLower === 'a' || sLower === 'absent' || sLower === '0') return 'Absent';
        return '';
      };
   
      attendanceRecordsCount += aRows.length;
      console.log(`Processing ${aRows.length} Attendance records (total so far: ${attendanceRecordsCount})`);
      if (attendanceRecordsCount >= 15000) {
        console.log('Capping Attendance fetch at 15000 rows to avoid execution time exceeded');
        attHasMore = false;
      }
   
      aRows.forEach(r => {
        let dateStr = '';
        if (r.AttendanceDate) {
          if (typeof r.AttendanceDate === 'string') {
            if (/^\d{4}-\d{2}-\d{2}$/.test(r.AttendanceDate)) {
              dateStr = r.AttendanceDate;
            } else {
              // Try to parse various date formats
              const tmp = new Date(r.AttendanceDate);
              if (!isNaN(tmp)) {
                dateStr = tmp.toISOString().slice(0,10);
              } else {
                // Try DD-MM-YYYY or DD/MM/YYYY format
                const dmy = r.AttendanceDate.match(/^(\d{2})[-\/.](\d{2})[-\/.](\d{4})$/);
                if (dmy) {
                  dateStr = `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
                }
              }
            }
          } else {
            const tmp = new Date(r.AttendanceDate);
            if (!isNaN(tmp)) dateStr = tmp.toISOString().slice(0,10);
          }
        }
        const normalizedFirst = dateStr ? normalizeTimeForDate(dateStr, r.FirstIn) : '';
        const normalizedLast = dateStr ? normalizeTimeForDate(dateStr, r.LastOut) : '';
        if (!dateStr) {
          const dt = (normalizedFirst || normalizedLast || '').match(/^(\d{4}-\d{2}-\d{2})\s+/);
          if (dt) dateStr = dt[1];
        }
        // Only filter by date range if we have a valid date
        if (!dateStr) {
          console.log(`Skipping Attendance record for EmployeeId ${r.EmployeeId}: No valid date found (AttendanceDate: ${r.AttendanceDate})`);
          return;
        }
        if (dateStr < startDate || dateStr > endDateStr) {
          // Skip records outside date range (this is expected)
          return;
        }
     
        const key = `${r.EmployeeId}_${dateStr}`;
        const providedStatus = normalizeProvidedStatus(r.Status);
     
        if (!byKey[key]) {
          byKey[key] = {
            EmployeeID: r.EmployeeId,
            Date: dateStr,
            FirstIN: normalizedFirst,
            LastOUT: normalizedLast,
            Source: 'Attendance',
            ProvidedStatus: providedStatus
          };
        } else {
          if (normalizedFirst && (!byKey[key].FirstIN || normalizedFirst < byKey[key].FirstIN)) {
            byKey[key].FirstIN = normalizedFirst;
          }
          if (normalizedLast && (!byKey[key].LastOUT || normalizedLast > byKey[key].LastOUT)) {
            byKey[key].LastOUT = normalizedLast;
          }
          byKey[key].Source = 'Both';
          if (providedStatus && !byKey[key].ProvidedStatus) byKey[key].ProvidedStatus = providedStatus;
        }
      });
      attOffset += attPageSize;
      if (aRows.length < attPageSize || attendanceRecordsCount >= 15000) attHasMore = false;
    }
    console.log(`Total Attendance records processed: ${attendanceRecordsCount}`);
 
    // Fetch OnDuty records
    try {
      let ondutyOffset = 0;
      let ondutyHasMore = true;
      const ondutyPageSize = 300;
   
      while (ondutyHasMore) {
        let ondutyQuery = `SELECT EmployeeCode, EmployeeName, NoofHours, Reason, OnDutyDate, FirstIn, Lastout FROM OnDuty`;
        if (employeeIds.length > 0) {
          const employeeIdList = employeeIds.map(id => `'${id}'`).join(',');
          ondutyQuery += ` WHERE EmployeeCode IN (${employeeIdList})`;
        }
        ondutyQuery += ` ORDER BY EmployeeCode, OnDutyDate LIMIT ${ondutyPageSize} OFFSET ${ondutyOffset}`;
        const ondutyBatch = await catalystApp.zcql().executeZCQLQuery(ondutyQuery);
        const ondutyRows = ondutyBatch.map(r => r.OnDuty);
        if (ondutyRows.length === 0) {
          ondutyHasMore = false;
          break;
        }
     
        const normalizeOnDutyTime = (dateStr, rawVal) => {
          if (!rawVal) return '';
          const raw = String(rawVal).trim();
          if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(:\d{2})?$/.test(raw)) return raw;
          const dmy = raw.match(/^(\d{2})[-\/](\d{2})[-\/](\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/);
          if (dmy) {
            const DD = dmy[1], MM = dmy[2], YYYY = dmy[3];
            const hh = dmy[4], mm = dmy[5], ss = dmy[6] ? dmy[6] : '00';
            return `${YYYY}-${MM}-${DD} ${hh}:${mm}:${ss}`;
          }
          const m = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
          if (m) {
            let h = parseInt(m[1], 10);
            const mm = m[2];
            const ss = m[3] ? m[3] : '00';
            const ampm = m[4] ? m[4].toUpperCase() : null;
            if (ampm) {
              if (ampm === 'AM' && h === 12) h = 0;
              if (ampm === 'PM' && h < 12) h += 12;
            }
            const HH = String(h).padStart(2, '0');
            return `${dateStr} ${HH}:${mm}:${ss}`;
          }
          if (/^\d{1,2}:\d{2}$/.test(raw)) {
            const [hStr, mStr] = raw.split(':');
            const HH = String(parseInt(hStr, 10)).padStart(2, '0');
            return `${dateStr} ${HH}:${mStr}:00`;
          }
          const d = new Date(`${dateStr} ${raw}`);
          if (!isNaN(d)) {
            const HH = String(d.getHours()).padStart(2, '0');
            const MM = String(d.getMinutes()).padStart(2, '0');
            const SS = String(d.getSeconds()).padStart(2, '0');
            return `${dateStr} ${HH}:${MM}:${SS}`;
          }
          return '';
        };
     
        ondutyRows.forEach(r => {
          let dateStr = '';
          if (r.OnDutyDate) {
            if (typeof r.OnDutyDate === 'string') {
              if (/^\d{4}-\d{2}-\d{2}$/.test(r.OnDutyDate)) {
                dateStr = r.OnDutyDate;
              } else {
                const tmp = new Date(r.OnDutyDate);
                if (!isNaN(tmp)) dateStr = tmp.toISOString().slice(0, 10);
              }
            } else {
              const tmp = new Date(r.OnDutyDate);
              if (!isNaN(tmp)) dateStr = tmp.toISOString().slice(0, 10);
            }
          }
          if (!dateStr || dateStr < startDate || dateStr > endDateStr) return;
       
          const normalizedFirstIn = normalizeOnDutyTime(dateStr, r.FirstIn);
          const normalizedLastOut = normalizeOnDutyTime(dateStr, r.Lastout);
       
          let ondutyStatus = 'Present';
          if (r.NoofHours) {
            const hours = String(r.NoofHours).trim().toLowerCase();
            if (hours === 'half day' || hours === 'halfday' || hours === '0.5') {
              ondutyStatus = 'Half Day Present';
            }
          }
       
          const employeeCode = String(r.EmployeeCode || '').trim();
          if (!employeeCode) return;
       
          const key = `${employeeCode}_${dateStr}`;
          if (byKey[key]) {
            byKey[key].ProvidedStatus = ondutyStatus;
            byKey[key].Source = byKey[key].Source === 'Both' ? 'Both+OnDuty' : (byKey[key].Source || 'OnDuty');
            if (normalizedFirstIn && (!byKey[key].FirstIN || normalizedFirstIn < byKey[key].FirstIN)) {
              byKey[key].FirstIN = normalizedFirstIn;
            }
            if (normalizedLastOut && (!byKey[key].LastOUT || normalizedLastOut > byKey[key].LastOUT)) {
              byKey[key].LastOUT = normalizedLastOut;
            }
          } else {
            byKey[key] = {
              EmployeeID: employeeCode,
              Date: dateStr,
              FirstIN: normalizedFirstIn || '',
              LastOUT: normalizedLastOut || '',
              Source: 'OnDuty',
              ProvidedStatus: ondutyStatus
            };
          }
        });
     
        ondutyOffset += ondutyPageSize;
        if (ondutyRows.length < ondutyPageSize) ondutyHasMore = false;
      }
    } catch (ondutyError) {
      console.error('Error fetching OnDuty records:', ondutyError);
    }
 
    // Fetch CompOff records
    try {
      let compoffOffset = 0;
      let compoffHasMore = true;
      const compoffPageSize = 300;
   
      while (compoffHasMore) {
        let compoffQuery = `SELECT EmployeeCode, EmployeeName, WorkedOn, Taken FROM Comboff`;
        if (employeeIds.length > 0) {
          const employeeIdList = employeeIds.map(id => `'${id}'`).join(',');
          compoffQuery += ` WHERE EmployeeCode IN (${employeeIdList})`;
        }
        compoffQuery += ` ORDER BY EmployeeCode, Taken LIMIT ${compoffPageSize} OFFSET ${compoffOffset}`;
        const compoffBatch = await catalystApp.zcql().executeZCQLQuery(compoffQuery);
        const compoffRows = compoffBatch.map(r => r.Comboff);
        if (compoffRows.length === 0) {
          compoffHasMore = false;
          break;
        }
     
        compoffRows.forEach(r => {
          const employeeCode = String(r.EmployeeCode || '').trim();
          if (!employeeCode) return;
       
          // Helper function to normalize date to YYYY-MM-DD format
          const normalizeDate = (dateValue) => {
            if (!dateValue) return '';
            if (typeof dateValue === 'string') {
              if (/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
                return dateValue;
              } else {
                const tmp = new Date(dateValue);
                if (!isNaN(tmp)) return tmp.toISOString().slice(0, 10);
              }
            } else {
              const tmp = new Date(dateValue);
              if (!isNaN(tmp)) return tmp.toISOString().slice(0, 10);
            }
            return '';
          };
       
          // Process WorkedOn date - mark as Present (matching attendance muster logic)
          let workedOnDateStr = normalizeDate(r.WorkedOn);
          if (workedOnDateStr && workedOnDateStr >= startDate && workedOnDateStr <= endDateStr) {
            const workedOnKey = `${employeeCode}_${workedOnDateStr}`;
            const workedOnStatus = 'Present';
            const workedOnFirstIn = `${workedOnDateStr} 08:30:00`;
            const workedOnLastOut = `${workedOnDateStr} 17:00:00`;
         
            // WorkedOn date should show as Present - takes precedence over Attendance but not OnDuty
            if (byKey[workedOnKey]) {
              const currentSource = byKey[workedOnKey].Source || '';
              if (!currentSource.includes('OnDuty')) {
                // Update existing record with Present status
                byKey[workedOnKey].ProvidedStatus = workedOnStatus;
                byKey[workedOnKey].Source = currentSource === 'Both' || currentSource === 'Attendance'
                  ? 'Both+CompOffWorkedOn'
                  : (currentSource || 'CompOffWorkedOn');
                // Set default times if not already set from other sources
                if (!byKey[workedOnKey].FirstIN) {
                  byKey[workedOnKey].FirstIN = workedOnFirstIn;
                }
                if (!byKey[workedOnKey].LastOUT) {
                  byKey[workedOnKey].LastOUT = workedOnLastOut;
                }
              } else {
                // OnDuty already exists, so we keep OnDuty but mark source as including CompOffWorkedOn
                byKey[workedOnKey].Source = currentSource.includes('CompOffWorkedOn') ? currentSource : currentSource + '+CompOffWorkedOn';
              }
            } else {
              // Create new record for WorkedOn date as Present
              byKey[workedOnKey] = {
                EmployeeID: employeeCode,
                Date: workedOnDateStr,
                FirstIN: workedOnFirstIn,
                LastOUT: workedOnLastOut,
                Source: 'CompOffWorkedOn',
                ProvidedStatus: workedOnStatus
              };
            }
          }
       
          // Process Taken date - mark as CO (Comp Off) (matching attendance muster logic)
          let takenDateStr = normalizeDate(r.Taken);
          if (takenDateStr && takenDateStr >= startDate && takenDateStr <= endDateStr) {
            const takenKey = `${employeeCode}_${takenDateStr}`;
         
            // CompOff records mark the Taken date as CO (Comp Off)
            // They take precedence over Attendance but not over OnDuty
            const compoffStatus = 'CO';
            const defaultFirstIn = `${takenDateStr} 08:30:00`;
            const defaultLastOut = `${takenDateStr} 17:00:00`;
         
            // CompOff records take precedence over Attendance but not OnDuty
            if (byKey[takenKey]) {
              // Only update if source is not OnDuty (OnDuty takes highest precedence)
              const currentSource = byKey[takenKey].Source || '';
              if (!currentSource.includes('OnDuty')) {
                // Update existing record with CompOff status (CompOff takes precedence over Attendance)
                byKey[takenKey].ProvidedStatus = compoffStatus;
                byKey[takenKey].Source = currentSource === 'Both' || currentSource === 'Attendance'
                  ? 'Both+CompOff'
                  : (currentSource || 'CompOff');
                // Set default times if not already set from other sources
                if (!byKey[takenKey].FirstIN) {
                  byKey[takenKey].FirstIN = defaultFirstIn;
                }
                if (!byKey[takenKey].LastOUT) {
                  byKey[takenKey].LastOUT = defaultLastOut;
                }
              } else {
                // OnDuty already exists, so we keep OnDuty but mark source as including CompOff
                byKey[takenKey].Source = currentSource.includes('CompOff') ? currentSource : currentSource + '+CompOff';
              }
            } else {
              // Create new record for CompOff with default times
              byKey[takenKey] = {
                EmployeeID: employeeCode,
                Date: takenDateStr,
                FirstIN: defaultFirstIn,
                LastOUT: defaultLastOut,
                Source: 'CompOff',
                ProvidedStatus: compoffStatus
              };
            }
          }
        });
     
        compoffOffset += compoffPageSize;
        if (compoffRows.length < compoffPageSize) compoffHasMore = false;
      }
    } catch (compoffError) {
      console.error('Error fetching CompOff records:', compoffError);
    }
 
    // Calculate present days using same logic as attendance muster
    function getStatus(firstIn, lastOut, providedStatus, source) {
      // CompOffWorkedOn should return 'Present' status (highest precedence for WorkedOn dates)
      if (source === 'CompOffWorkedOn' || source?.includes('CompOffWorkedOn')) {
        return 'Present'; // WorkedOn date should always show as Present
      }
   
      // OnDuty status should return 'OD' or 'OD-0.5' (highest precedence)
      if (source === 'OnDuty' || source?.includes('OnDuty')) {
        // If source includes OnDuty, return the OnDuty status (OD or OD-0.5)
        if (providedStatus === 'OD' || providedStatus === 'OD-0.5') {
          return providedStatus;
        }
        // Fallback: if status is not set correctly, return 'OD'
        return 'OD';
      }
   
      // CompOff Taken status takes precedence
      if (providedStatus && (source === 'CompOff' || source === 'Both+CompOff' || source?.includes('CompOff'))) {
        // If source includes CompOff (Taken date) and status is CO, return CO
        if (providedStatus === 'CO') {
          return 'CO';
        }
        return providedStatus;
      }
   
      // If there's a provided status from Attendance table, use it
      if (providedStatus) {
        return providedStatus;
      }
   
      // Otherwise, calculate from FirstIN/LastOUT times
      if (!firstIn || !lastOut) return 'Absent';
      const inDate = new Date(firstIn.replace(' ', 'T'));
      const outDate = new Date(lastOut.replace(' ', 'T'));
      if (isNaN(inDate) || isNaN(outDate)) return 'Absent';
      const hours = (outDate - inDate) / (1000 * 60 * 60);
      if (hours >= 4) return 'Present';
      if (hours > 0) return 'Half Day Present';
      return 'Absent';
    }
 
    // Calculate total present days for each employee
    // Get all unique employee IDs from byKey (matching attendance muster logic)
    // Muster only includes employees that have at least one record, so we do the same
    const allEmployeeIds = new Set();
    Object.values(byKey).forEach(rec => {
      allEmployeeIds.add(String(rec.EmployeeID));
    });
 
    // Apply employee filter if provided (matching muster logic)
    if (employeeIds.length > 0) {
      const employeeIdsSet = new Set(employeeIds.map(id => String(id)));
      const filteredEmployeeIds = Array.from(allEmployeeIds).filter(empId => employeeIdsSet.has(String(empId)));
      allEmployeeIds.clear();
      filteredEmployeeIds.forEach(id => allEmployeeIds.add(id));
    }
 
    // Count present days for each employee
    // For each employee, check all dates in the month (using existing dates array)
    allEmployeeIds.forEach(empId => {
      if (!presentDaysMap[empId]) {
        presentDaysMap[empId] = 0;
      }
   
      dates.forEach(date => {
        // Ensure date is within the selected range (safety check)
        // Dates in the array are already in ISO format (YYYY-MM-DD), so string comparison works
        // But we'll use proper date comparison for extra safety to avoid timezone issues
        const [year, month, day] = date.split('-').map(Number);
        const [startYear, startMonth, startDay] = startDate.split('-').map(Number);
        const [endYear, endMonth, endDay] = endDateStr.split('-').map(Number);
        const dateObj = new Date(year, month - 1, day);
        const startDateObj = new Date(startYear, startMonth - 1, startDay);
        const endDateObj = new Date(endYear, endMonth - 1, endDay);
        if (dateObj < startDateObj || dateObj > endDateObj) {
          return; // Skip dates outside the range
        }
     
        const key = `${empId}_${date}`;
        const rec = byKey[key];
     
        // Sundays: match Attendance Muster Total Present — do not count toward present days
        if (isSunday(date)) {
          return;
        }
     
        // For other dates, check the record status
        if (rec) {
          const status = getStatus(rec.FirstIN, rec.LastOUT, rec.ProvidedStatus, rec.Source);
          if (status === 'Present') {
            presentDaysMap[empId] += 1;
          } else if (status === 'Half Day Present') {
            presentDaysMap[empId] += 0.5;
          } else if (status === 'CO') {
            // Comp Off (CO) counts as 1 day present (matching attendance muster logic)
            presentDaysMap[empId] += 1;
          } else if (status === 'OD' || status === 'OD-0.5') {
            // On Duty (OD) counts as 1 day present (both full and half day - changed OD-0.5 from 0.5 to 1 to match frontend)
            presentDaysMap[empId] += 1;
          } else if (status === 'H') {
            // Holiday (H) counts as 1 day present (even on regular dates if marked in attendance)
            presentDaysMap[empId] += 1;
          }
          // WO / Week Off: excluded from present days (same as attendance muster Total Present)
        }
      });
    });
 
    // Debug logging for specific employees
    if (presentDaysMap['36090'] !== undefined) {
      const emp36090Records = Object.values(byKey).filter(rec => String(rec.EmployeeID) === '36090');
      console.log(`Employee 36090: Found ${emp36090Records.length} date records`);
      emp36090Records.forEach(rec => {
        const status = getStatus(rec.FirstIN, rec.LastOUT, rec.ProvidedStatus, rec.Source);
        console.log(`  Date ${rec.Date}: Status=${status}, FirstIN=${rec.FirstIN}, LastOUT=${rec.LastOUT}, Source=${rec.Source}, ProvidedStatus=${rec.ProvidedStatus}`);
      });
      console.log(`Employee 36090: Total present days = ${presentDaysMap['36090']}`);
    }
 
    // Debug logging for employee 50035
    if (presentDaysMap['50035'] !== undefined) {
      console.log(`\n=== DEBUG: Employee 50035 ===`);
      console.log(`Total present days calculated: ${presentDaysMap['50035']}`);
      const emp50035Records = Object.values(byKey).filter(rec => String(rec.EmployeeID) === '50035');
      console.log(`Found ${emp50035Records.length} date records in byKey`);
   
      // Count by date type
      let SundayCount = 0, presentCount = 0, halfDayCount = 0, coCount = 0, odCount = 0, otherCount = 0;
   
      dates.forEach(date => {
        const key = `50035_${date}`;
        const rec = byKey[key];
        const isSun = isSunday(date);
     
        if (isSun) {
          if (rec && (rec.Source === 'CompOffWorkedOn' || rec.Source?.includes('CompOffWorkedOn'))) {
            presentCount++;
            console.log(`  ${date} (Sunday): CompOffWorkedOn -> Present (+1)`);
          } else if (rec) {
            const status = getStatus(rec.FirstIN, rec.LastOUT, rec.ProvidedStatus, rec.Source);
            if (status === 'Present' || status === 'CO' || status === 'OD' || status === 'OD-0.5') {
              presentCount += 1; // Changed OD-0.5 from 0.5 to 1 to match frontend
              console.log(`  ${date} (Sunday): ${status} -> +1`);
            } else if (status === 'Half Day Present') {
              halfDayCount += 0.5;
              console.log(`  ${date} (Sunday): Half Day Present -> +0.5`);
            } else if (status === 'H') {
              presentCount += 1;
              console.log(`  ${date} (Sunday): Holiday -> +1`);
            } else if (status === 'WO') {
              presentCount += 1;
              console.log(`  ${date} (Sunday): Week Off -> +1`);
            } else {
              SundayCount++;
              console.log(`  ${date} (Sunday): Other status (${status}) -> Holiday (+1)`);
            }
          } else {
            SundayCount++;
            console.log(`  ${date} (Sunday): No record -> Holiday (+1)`);
          }
        } else if (rec) {
          const status = getStatus(rec.FirstIN, rec.LastOUT, rec.ProvidedStatus, rec.Source);
          if (status === 'Present') {
            presentCount++;
            console.log(`  ${date}: Present -> +1`);
          } else if (status === 'Half Day Present') {
            halfDayCount += 0.5;
            console.log(`  ${date}: Half Day Present -> +0.5`);
          } else if (status === 'CO') {
            coCount++;
            console.log(`  ${date}: Comp Off -> +1`);
          } else if (status === 'OD' || status === 'OD-0.5') {
            odCount += 1; // Changed OD-0.5 from 0.5 to 1 to match frontend
            console.log(`  ${date}: On Duty (${status}) -> +1`);
          } else if (status === 'H') {
            presentCount++;
            console.log(`  ${date}: Holiday -> +1`);
          } else if (status === 'WO') {
            presentCount++;
            console.log(`  ${date}: Week Off -> +1`);
          } else {
            otherCount++;
            console.log(`  ${date}: Other status (${status}) -> +0 (not counted)`);
          }
        }
      });
   
      const calculatedTotal = presentCount + halfDayCount + coCount + odCount + SundayCount;
      console.log(`\nBreakdown for 50035:`);
      console.log(`  Present: ${presentCount}`);
      console.log(`  Half Day: ${halfDayCount}`);
      console.log(`  Comp Off: ${coCount}`);
      console.log(`  On Duty: ${odCount}`);
      console.log(`  Sundays (H): ${SundayCount}`);
      console.log(`  Other (not counted): ${otherCount}`);
      console.log(`  Calculated total: ${calculatedTotal}`);
      console.log(`  Actual total in map: ${presentDaysMap['50035']}`);
      console.log(`=== END DEBUG: Employee 50035 ===\n`);
    }
 
    // Ensure present days are findable by EmployeeCode (normalized) so payroll earned basic uses same days as display
    const keys = Object.keys(presentDaysMap);
    keys.forEach(id => {
      const norm = normalizeEmployeeCode(id);
      if (norm && norm !== id) presentDaysMap[norm] = presentDaysMap[id];
      const idNum = parseInt(id);
      if (!isNaN(idNum)) presentDaysMap[String(idNum)] = presentDaysMap[id];
    });

    console.log(`Calculated present days from muster logic for ${Object.keys(presentDaysMap).length} employees`);
    console.log(`Total records in byKey: ${Object.keys(byKey).length}`);
    console.log(`Sample present days:`, Object.entries(presentDaysMap).slice(0, 5).map(([id, days]) => ({ empId: id, days })));
  } catch (err) {
    console.error('Error calculating present days from muster:', err);
  }

  return presentDaysMap;
}

// Helper function to check ESI period eligibility
// ESI has two coverage periods: April-September and October-March
// Condition 1: If actual total salary > 21,000 at period start (April or October), ESI is not calculated for that period.
// Condition 2: Salary is checked at April and October; if above 21,000 then ESI don't calculate for that period.
// Condition 3: Once in a period, even if salary increases above 21,000 mid-period (e.g. May or Nov), ESI continues
//   for the rest of that period and stops only from the next period (Oct for Apr-Sep, Apr for Oct-Mar).
async function checkESIPeriodEligibility(catalystApp, currentMonth, employeeCode, actualTotalSalary) {
  try {
    const [year, month] = currentMonth.split('-').map(Number);
    let periodStartMonth;
    if (month >= 4 && month <= 9) {
      periodStartMonth = `${year}-04`;
    } else if (month >= 10 && month <= 12) {
      periodStartMonth = `${year}-10`;
    } else if (month >= 1 && month <= 3) {
      periodStartMonth = `${year - 1}-10`;
    } else {
      return false;
    }

    // Period start (April or October): ESI only if salary <= 21,000; if above 21,000 don't calculate
    if (currentMonth === periodStartMonth) {
      return actualTotalSalary <= 21000;
    }

    // Mid-period: ESI if it was calculated in the starting month (continue for entire period even if salary later exceeds 21,000)
    const empCodeEscaped = String(employeeCode || '').replace(/'/g, "''");
    const periodStartMonthEscaped = String(periodStartMonth || '').replace(/'/g, "''");
    const periodStartQuery = `SELECT ESI FROM Payroll WHERE Month_filter = '${periodStartMonthEscaped}' AND EmployeeCode = '${empCodeEscaped}' LIMIT 1`;
    const periodStartResult = await catalystApp.zcql().executeZCQLQuery(periodStartQuery);

    if (periodStartResult && periodStartResult.length > 0) {
      const periodStartESI = Number(periodStartResult[0].Payroll.ESI) || 0;
      return periodStartESI > 0;
    }
    return false;
  } catch (error) {
    console.error('Error checking ESI period eligibility:', error);
    return false;
  }
}

// Helper function to calculate LOH hours from attendance muster logic
// This uses the same logic as attendance_muster_function to ensure consistency
async function calculateLOHFromMuster(catalystApp, month, contractor, department, employeeId, fromDate, toDate) {
  const lohMap = {}; // Map: employeeId -> total LOH hours for the month

  try {
    // Build date range - use custom dates if provided, otherwise use month
    let startDate, endDateStr;
    if (fromDate && toDate) {
      // Normalize dates to ISO format (YYYY-MM-DD)
      function normalizeDate(dateStr) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
          return dateStr;
        }
        const dateObj = new Date(dateStr);
        if (isNaN(dateObj.getTime())) {
          throw new Error(`Invalid date format: ${dateStr}`);
        }
        const year = dateObj.getFullYear();
        const month = String(dateObj.getMonth() + 1).padStart(2, '0');
        const day = String(dateObj.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      }
      startDate = normalizeDate(fromDate);
      endDateStr = normalizeDate(toDate);
      console.log(`calculateLOHFromMuster: Custom date range: ${startDate} to ${endDateStr}`);
    } else {
      // Build date range for the month
      const [year, monthNum] = month.split('-').map(Number);
      startDate = `${month}-01`;
      const lastDayOfMonth = new Date(year, monthNum, 0).getDate();
      endDateStr = `${month}-${String(lastDayOfMonth).padStart(2, '0')}`;
      console.log(`calculateLOHFromMuster: Month ${month}, Date range: ${startDate} to ${endDateStr}`);
    }

    // Get employee filter conditions
    let employeeFilterConditions = [];
    let employeeIds = [];

    // Contractor filter
    if (contractor && contractor !== 'All') {
      try {
        const normalized = String(contractor || '').replace(/\s+/g, ' ').trim().replace(/'/g, "''");
        const contractorEmployeeQuery = await catalystApp.zcql().executeZCQLQuery(
          `SELECT EmployeeCode FROM Employee WHERE ContractorName LIKE '%${normalized}%'`
        );
        if (contractorEmployeeQuery && contractorEmployeeQuery.length > 0) {
          employeeIds = contractorEmployeeQuery.map(emp => emp.Employee.EmployeeCode);
        }
      } catch (error) {
        console.error('Error applying contractor filter:', error);
      }
    }

    // Department filter
    if (department && department !== 'All') {
      try {
        const departmentEmployeeQuery = await catalystApp.zcql().executeZCQLQuery(
          `SELECT EmployeeCode FROM Employee WHERE Department = '${department}'`
        );
        if (departmentEmployeeQuery && departmentEmployeeQuery.length > 0) {
          const departmentEmployeeIds = departmentEmployeeQuery.map(emp => emp.Employee.EmployeeCode);
          if (employeeIds.length > 0) {
            employeeIds = employeeIds.filter(id => departmentEmployeeIds.includes(id));
          } else {
            employeeIds = departmentEmployeeIds;
          }
        }
      } catch (error) {
        console.error('Error applying department filter:', error);
      }
    }

    // Employee filter
    if (employeeId && employeeId !== 'All') {
      if (employeeIds.length > 0) {
        employeeIds = employeeIds.filter(id => id === employeeId);
      } else {
        employeeIds = [employeeId];
      }
    }

    // Build employee filter condition
    if (employeeIds.length > 0) {
      const employeeIdList = employeeIds.map(id => `'${id}'`).join(',');
      employeeFilterConditions.push(`EmployeeID IN (${employeeIdList})`);
    }

    // Build date list for the selected date range
    const dates = [];
    const [startYear, startMonth, startDay] = startDate.split('-').map(Number);
    const [endYear, endMonth, endDay] = endDateStr.split('-').map(Number);
    const startDateObj = new Date(startYear, startMonth - 1, startDay);
    const endDateObj = new Date(endYear, endMonth - 1, endDay);

    for (let d = new Date(startDateObj); d <= endDateObj; d.setDate(d.getDate() + 1)) {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      dates.push(`${year}-${month}-${day}`);
    }

    // Fetch shift information
    const shiftMap = {};
    try {
      const shiftQuery = `SELECT EmployeeID, AssignedShift, FromDate, ToDate FROM ShiftMapping`;
      const shiftRecords = await catalystApp.zcql().executeZCQLQuery(shiftQuery);
      for (const row of shiftRecords) {
        const shift = row.ShiftMapping;
        const empId = String(shift.EmployeeID || '').trim();
        if (!empId) continue;
        if (!shiftMap[empId]) shiftMap[empId] = [];
        shiftMap[empId].push({
          assignedShift: shift.AssignedShift || '',
          fromdate: shift.FromDate || '',
          todate: shift.ToDate || ''
        });
      }
    } catch (err) {
      console.error('Error fetching shift information:', err);
    }

    // Helper functions for shift detection
    // Check in order: 1st shift -> 2nd shift -> else (general shift)
    const isFirstShift = (empId, dateStr) => {
      if (!shiftMap[empId] || shiftMap[empId].length === 0) return false;
      for (const shift of shiftMap[empId]) {
        // Check for various 1st shift naming patterns (case-insensitive)
        const shiftName = String(shift.assignedShift || '').trim();
        const shiftNameUpper = shiftName.toUpperCase();
        if (shiftNameUpper === '1ST' || shiftNameUpper === '1ST SHIFT' || shiftNameUpper === 'FIRST' ||
            shiftNameUpper === 'FIRST SHIFT' || shiftName === '1' || shiftNameUpper === 'SHIFT 1' ||
            shiftName === '1st Shift') {
          if (shift.fromdate && shift.todate) {
            if (dateStr >= shift.fromdate && dateStr <= shift.todate) return true;
          } else if (shift.fromdate && dateStr >= shift.fromdate) return true;
          else if (shift.todate && dateStr <= shift.todate) return true;
        }
      }
      return false;
    };

    const isSecondShift = (empId, dateStr) => {
      if (!shiftMap[empId] || shiftMap[empId].length === 0) return false;
      for (const shift of shiftMap[empId]) {
        // Check for various 2nd shift naming patterns (case-insensitive)
        const shiftName = String(shift.assignedShift || '').trim();
        const shiftNameUpper = shiftName.toUpperCase();
        if (shiftNameUpper === '2ND' || shiftNameUpper === '2ND SHIFT' || shiftNameUpper === 'SECOND' ||
            shiftNameUpper === 'SECOND SHIFT' || shiftName === '2' || shiftNameUpper === 'SHIFT 2' ||
            shiftName === '2nd Shift') {
          if (shift.fromdate && shift.todate) {
            if (dateStr >= shift.fromdate && dateStr <= shift.todate) return true;
          } else if (shift.fromdate && dateStr >= shift.fromdate) return true;
          else if (shift.todate && dateStr <= shift.todate) return true;
        }
      }
      return false;
    };

    // General shift: if employee is NOT in shiftmap, default to general shift
    // OR if employee has GENERAL shift explicitly assigned in shiftmap
    // OR if employee is in shiftmap but doesn't have 1st or 2nd shift for this date
    const isGeneralShift = (empId, dateStr) => {
      // If employee is not in shiftmap at all, default to general shift
      if (!shiftMap[empId] || shiftMap[empId].length === 0) return true;
     
      // Check if employee has GENERAL shift explicitly assigned (case-insensitive)
      for (const shift of shiftMap[empId]) {
        const shiftName = String(shift.assignedShift || '').trim().toUpperCase();
        if (shiftName === 'GENERAL' || shiftName === 'GENERAL SHIFT') {
          if (shift.fromdate && shift.todate) {
            if (dateStr >= shift.fromdate && dateStr <= shift.todate) return true;
          } else if (shift.fromdate && dateStr >= shift.fromdate) return true;
          else if (shift.todate && dateStr <= shift.todate) return true;
        }
      }
     
      // If employee is in shiftmap but doesn't have 1st or 2nd shift for this date, default to general
      const hasFirstShift = isFirstShift(empId, dateStr);
      const hasSecondShift = isSecondShift(empId, dateStr);
     
      // If they don't have 1st or 2nd shift, default to general
      return !hasFirstShift && !hasSecondShift;
    };

    // Helper function to parse time string to minutes
    const parseTime = (timeStr) => {
      if (!timeStr) return null;
      let timePart = timeStr;
      if (timeStr.includes(' ')) {
        timePart = timeStr.split(' ')[1];
      }
      const parts = timePart.split(':');
      if (parts.length < 2) return null;
      const hours = parseInt(parts[0], 10);
      const minutes = parseInt(parts[1], 10);
      if (isNaN(hours) || isNaN(minutes)) return null;
      return hours * 60 + minutes;
    };

    // Helper function to calculate LOH for any shift with grace period
    // Parameters: firstInTime, lastOutTime, shiftStart (minutes), shiftEnd (minutes), gracePeriodEnd (minutes)
    // Returns: { shouldCalculate: boolean, lohHours: number }
    const calculateLOHForShift = (firstInTime, lastOutTime, shiftStart, shiftEnd, gracePeriodEnd) => {
      const firstInMinutes = parseTime(firstInTime);
      const lastOutMinutes = parseTime(lastOutTime);
     
      if (firstInMinutes === null || lastOutMinutes === null) {
        return null;
      }
     
      // Only consider time within shift window. Ignore anything before shift start
      // Clamp arrival time to shift start minimum (if before shift start, treat as shift start for calculation)
      const clampedFirstInMinutes = Math.max(firstInMinutes, shiftStart);
     
      // Rule 1: If check-in is between shiftStart-gracePeriodEnd (inclusive) AND check-out is at or after shiftEnd → NO LOH
      if (clampedFirstInMinutes >= shiftStart && clampedFirstInMinutes <= gracePeriodEnd && lastOutMinutes >= shiftEnd) {
        return { shouldCalculate: false, lohHours: 0 };
      }
     
      // Calculate LOH based on time outside effective work period
      let lossOfMinutes = 0;
     
      // Late arrival (after grace): round check-in up to next :00 or :30, LOH = adjusted time − shift start
      if (clampedFirstInMinutes > gracePeriodEnd) {
        const adjustedFirstInMinutes = Math.ceil(clampedFirstInMinutes / 30) * 30;
        lossOfMinutes += (adjustedFirstInMinutes - shiftStart);
      }
     
      // Early departure: round check-out down to previous :00 or :30, LOH = shift end − adjusted time
      if (lastOutMinutes < shiftEnd) {
        const adjustedLastOutMinutes = Math.floor(lastOutMinutes / 30) * 30;
        lossOfMinutes += (shiftEnd - adjustedLastOutMinutes);
      }
     
      // Convert to hours
      const lohHours = lossOfMinutes > 0 ? lossOfMinutes / 60 : 0;
     
      return { shouldCalculate: lohHours > 0, lohHours: lohHours };
    };

    // Helper function to calculate LOH for general shift (8:30-17:00) with 10 min grace (8:30-8:40)
    const calculateLOHForGeneralShift = (firstInTime, lastOutTime) => {
      const shiftStart = 8 * 60 + 30; // 08:30 = 510 minutes
      const shiftEnd = 17 * 60 + 0; // 17:00 = 1020 minutes
      const gracePeriodEnd = 8 * 60 + 40; // 08:40 = 520 minutes (10 min grace)
      return calculateLOHForShift(firstInTime, lastOutTime, shiftStart, shiftEnd, gracePeriodEnd);
    };

    // Helper function to calculate LOH for 1st shift (6:00-14:00) with 10 min grace (6:00-6:10)
    const calculateLOHForFirstShift = (firstInTime, lastOutTime) => {
      const shiftStart = 6 * 60 + 0; // 06:00 = 360 minutes
      const shiftEnd = 14 * 60 + 0; // 14:00 = 840 minutes
      const gracePeriodEnd = 6 * 60 + 10; // 06:10 = 370 minutes (10 min grace)
      return calculateLOHForShift(firstInTime, lastOutTime, shiftStart, shiftEnd, gracePeriodEnd);
    };

    // Helper function to calculate LOH for 2nd shift (14:00-22:00) with 10 min grace (14:00-14:10)
    const calculateLOHForSecondShift = (firstInTime, lastOutTime) => {
      const shiftStart = 14 * 60 + 0; // 14:00 = 840 minutes
      const shiftEnd = 22 * 60 + 0; // 22:00 = 1320 minutes
      const gracePeriodEnd = 14 * 60 + 10; // 14:10 = 850 minutes (10 min grace)
      return calculateLOHForShift(firstInTime, lastOutTime, shiftStart, shiftEnd, gracePeriodEnd);
    };

    // Helper function to check if a date should be excluded from LOH calculation
    const isDateExcludedFromLOH = (dateStr) => {
      // Normalize date to YYYY-MM-DD format
      let normalizedDate = '';
      if (typeof dateStr === 'string') {
        if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
          normalizedDate = dateStr;
        } else {
          const d = new Date(dateStr);
          if (!isNaN(d)) {
            normalizedDate = d.toISOString().slice(0, 10);
          }
        }
      } else {
        const d = new Date(dateStr);
        if (!isNaN(d)) {
          normalizedDate = d.toISOString().slice(0, 10);
        }
      }
     
      // Dates to exclude from LOH calculation
      const excludedDates = [
        '2025-11-30',
        '2025-12-06',
        '2025-12-07',
        '2025-12-14',
        '2025-12-21'
      ];
     
      return excludedDates.includes(normalizedDate);
    };

    // Fetch LOH from LOHreport table first
    const lohReportMap = {}; // Key: empId_date -> LOH hours
    try {
      const tableNames = ['LOHreport', 'LOHReport', 'lohreport', 'LOH'];
      let lohRecords = [];
     
      for (const tableName of tableNames) {
        try {
          let lohQuery = `SELECT * FROM ${tableName} WHERE ((Date >= '${startDate}' AND Date <= '${endDateStr}') OR (Date_filter >= '${startDate}' AND Date_filter <= '${endDateStr}') OR (AttendanceDate >= '${startDate}' AND AttendanceDate <= '${endDateStr}'))`;
         
          const pageSize = 300;
          let offset = 0;
          let hasMore = true;
          let tableRecords = [];
         
          while (hasMore) {
            try {
              const paginatedQuery = `${lohQuery} ORDER BY ROWID LIMIT ${pageSize} OFFSET ${offset}`;
              const batch = await catalystApp.zcql().executeZCQLQuery(paginatedQuery);
              if (batch.length === 0) {
                hasMore = false;
                break;
              }
              tableRecords.push(...batch);
              offset += pageSize;
              if (batch.length < pageSize) {
                hasMore = false;
              }
              if (tableRecords.length > 50000) {
                hasMore = false;
              }
            } catch (pagErr) {
              tableRecords = await catalystApp.zcql().executeZCQLQuery(lohQuery);
              hasMore = false;
            }
          }
         
          if (tableRecords.length > 0) {
            lohRecords = tableRecords;
            break;
          }
        } catch (tableErr) {
          continue;
        }
      }
     
      // Process LOHreport records
      for (const row of lohRecords) {
        const lohRec = row.LOHreport || row.LOHReport || row.lohreport || row;
        if (!lohRec) continue;
       
        const empId = String(lohRec.EmployeeCode || lohRec.EmployeeID || lohRec.EmployeeId || '').trim();
        if (!empId) continue;
       
        const lohDate = lohRec.Date || lohRec.Date_filter || lohRec.AttendanceDate || '';
        if (!lohDate) continue;
       
        const lohHours = parseFloat(
          lohRec.LOH || lohRec.LOHHours || lohRec.LossOfHours ||
          lohRec['Loss of Hours (hrs)'] || lohRec['Loss of Hours'] || 0
        );
       
        // Allow negative LOH values (they can indicate adjustments or corrections)
        if (!isNaN(lohHours) && lohHours !== 0) {
          const key = `${empId}_${lohDate}`;
          lohReportMap[key] = lohHours;
        }
      }
    } catch (lohError) {
      console.error('Error fetching LOH from LOHreport table:', lohError);
    }

    // Fetch BHR, Attendance, and BioMax data
    const allLogs = [];
    let offset = 0;
    const pageSize = 300;
    let hasMore = true;
    while (hasMore) {
      let query = `SELECT EmployeeID, EventTime, DeviceSerial FROM BHR
                   WHERE EventTime >= '${startDate} 00:00:00'
                   AND EventTime <= '${endDateStr} 23:59:59'`;
      if (employeeFilterConditions.length > 0) {
        query += ` AND ${employeeFilterConditions.join(' AND ')}`;
      }
      query += ` ORDER BY ROWID LIMIT ${pageSize} OFFSET ${offset}`;
      const batch = await catalystApp.zcql().executeZCQLQuery(query);
      if (batch.length === 0) {
        hasMore = false;
        break;
      }
      allLogs.push(...batch);
      offset += pageSize;
      if (batch.length < pageSize) {
        hasMore = false;
      }
    }

    // Fetch Attendance records
    const attendanceRecords = [];
    try {
      let attendanceQuery = `SELECT EmployeeId, AttendanceDate, FirstIn, LastOut, Status, Source FROM Attendance
                             WHERE AttendanceDate >= '${startDate}' AND AttendanceDate <= '${endDateStr}'`;
      if (employeeFilterConditions.length > 0) {
        attendanceQuery += ` AND ${employeeFilterConditions.join(' AND ')}`;
      }
      const attRecords = await catalystApp.zcql().executeZCQLQuery(attendanceQuery);
      attendanceRecords.push(...attRecords);
    } catch (err) {
      console.error('Error fetching Attendance records:', err);
    }

    // Fetch BioMax records
    const biomaxRecords = [];
    try {
      let biomaxQuery = `SELECT EmployeeID, EventTime FROM BioMax
                         WHERE EventTime >= '${startDate} 00:00:00'
                         AND EventTime <= '${endDateStr} 23:59:59'`;
      if (employeeFilterConditions.length > 0) {
        biomaxQuery += ` AND ${employeeFilterConditions.join(' AND ')}`;
      }
      const bioRecords = await catalystApp.zcql().executeZCQLQuery(biomaxQuery);
      biomaxRecords.push(...bioRecords);
    } catch (err) {
      console.error('Error fetching BioMax records:', err);
    }

    // Group events by employee and date
    const byKey = {}; // Key: empId_date -> { FirstIN, LastOUT, Source }
   
    // Process BHR logs
    for (const row of allLogs) {
      const log = row.BHR;
      const empId = String(log.EmployeeID || '').trim();
      if (!empId) continue;
      const eventDate = log.EventTime.split(' ')[0];
      const key = `${empId}_${eventDate}`;
      if (!byKey[key]) {
        byKey[key] = { FirstIN: null, LastOUT: null, Source: 'BHR' };
      }
      const eventTime = log.EventTime;
      if (!byKey[key].FirstIN || eventTime < byKey[key].FirstIN) {
        byKey[key].FirstIN = eventTime;
      }
      if (!byKey[key].LastOUT || eventTime > byKey[key].LastOUT) {
        byKey[key].LastOUT = eventTime;
      }
    }

    // Process Attendance records
    for (const row of attendanceRecords) {
      const att = row.Attendance;
      const empId = String(att.EmployeeId || '').trim();
      if (!empId) continue;
      const attDate = att.AttendanceDate;
      const key = `${empId}_${attDate}`;
      if (!byKey[key]) {
        byKey[key] = { FirstIN: null, LastOUT: null, Source: 'Attendance' };
      }
      if (att.FirstIn) {
        const firstInTime = att.FirstIn.includes(' ') ? att.FirstIn : `${attDate} ${att.FirstIn}`;
        if (!byKey[key].FirstIN || firstInTime < byKey[key].FirstIN) {
          byKey[key].FirstIN = firstInTime;
        }
      }
      if (att.LastOut) {
        const lastOutTime = att.LastOut.includes(' ') ? att.LastOut : `${attDate} ${att.LastOut}`;
        if (!byKey[key].LastOUT || lastOutTime > byKey[key].LastOUT) {
          byKey[key].LastOUT = lastOutTime;
        }
      }
      if (att.Source) {
        byKey[key].Source = att.Source;
      }
    }

    // Process BioMax records
    for (const row of biomaxRecords) {
      const bio = row.BioMax;
      const empId = String(bio.EmployeeID || '').trim();
      if (!empId) continue;
      const eventDate = bio.EventTime.split(' ')[0];
      const key = `${empId}_${eventDate}`;
      if (!byKey[key]) {
        byKey[key] = { FirstIN: null, LastOUT: null, Source: 'BioMax' };
      }
      const eventTime = bio.EventTime;
      if (!byKey[key].FirstIN || eventTime < byKey[key].FirstIN) {
        byKey[key].FirstIN = eventTime;
      }
      if (!byKey[key].LastOUT || eventTime > byKey[key].LastOUT) {
        byKey[key].LastOUT = eventTime;
      }
      if (byKey[key].Source === 'BHR') {
        byKey[key].Source = 'BioMax';
      }
    }

    // Get all unique employee IDs
    const allEmployeeIds = new Set();
    for (const key in byKey) {
      const empId = key.split('_')[0];
      allEmployeeIds.add(empId);
    }
    if (employeeIds.length > 0) {
      const employeeIdSet = new Set(employeeIds.map(id => String(id).trim()));
      allEmployeeIds.forEach(id => {
        if (!employeeIdSet.has(String(id).trim())) {
          allEmployeeIds.delete(id);
        }
      });
    }

    // Calculate LOH for each employee per date
    allEmployeeIds.forEach(empId => {
      const empIdStr = String(empId).trim();
      if (!lohMap[empIdStr]) {
        lohMap[empIdStr] = 0;
      }
     
      dates.forEach(date => {
        const key = `${empIdStr}_${date}`;
       
        // Skip excluded dates from LOH calculation
        if (isDateExcludedFromLOH(date)) {
          return; // Skip LOH calculation for this date
        }
       
        // First, try to get LOH from LOHreport table
        let lohHours = lohReportMap[key];
       
        // If not found in LOHreport table, calculate from FirstIN/LastOUT
        if (!lohHours || lohHours <= 0) {
          const rec = byKey[key];
          if (rec && rec.FirstIN && rec.LastOUT) {
            // Skip OnDuty and CompOff *taken* days (not CompOffWorkedOn — includes('CompOff') matched wrongly)
            const source = rec.Source || '';
            if (source === 'OnDuty' || source.includes('OnDuty') || sourceHasCompOffTakenSegment(source)) {
              return; // Skip this record
            }
           
            try {
              const firstInDate = new Date(rec.FirstIN.replace(' ', 'T'));
              const lastOutDate = new Date(rec.LastOUT.replace(' ', 'T'));
             
              if (!isNaN(firstInDate) && !isNaN(lastOutDate)) {
                const diffMs = lastOutDate - firstInDate;
                if (diffMs > 0) {
                  const totalWorkingMinutes = Math.floor(diffMs / (1000 * 60));
                  const expectedWorkingMinutes = 8 * 60; // 8 hours
                 
                  // Check shift in order: 1st shift -> 2nd shift -> else (general shift)
                  const isFirst = isFirstShift(empIdStr, date);
                  const isSecond = isSecondShift(empIdStr, date);
                 
                  // Extract time strings for shift-specific calculations
                  const firstInTime = rec.FirstIN.includes(' ') ? rec.FirstIN.split(' ')[1].substring(0, 5) : rec.FirstIN.substring(0, 5);
                  const lastOutTime = rec.LastOUT.includes(' ') ? rec.LastOUT.split(' ')[1].substring(0, 5) : rec.LastOUT.substring(0, 5);
                 
                  if (isFirst) {
                    // For 1st shift: Calculate LOH with grace period (6:00-6:10, shift end 14:00)
                    const lohResult = calculateLOHForFirstShift(firstInTime, lastOutTime);
                   
                    if (lohResult === null) {
                      // Could not parse times, fall back to normal LOH calculation
                      if (totalWorkingMinutes > 0 && totalWorkingMinutes < expectedWorkingMinutes) {
                        const lossOfMinutes = expectedWorkingMinutes - totalWorkingMinutes;
                        if (lossOfMinutes > 0 && lossOfMinutes < 480) {
                          lohHours = lossOfMinutes / 60;
                        }
                      }
                    } else if (lohResult.shouldCalculate) {
                      lohHours = lohResult.lohHours && lohResult.lohHours > 0 ? parseFloat(lohResult.lohHours.toFixed(2)) : 0;
                    } else {
                      // No LOH (within grace period and left after shift end)
                      lohHours = 0;
                    }
                  } else if (isSecond) {
                    // For 2nd shift: Calculate LOH with grace period (14:00-14:10, shift end 22:00)
                    const lohResult = calculateLOHForSecondShift(firstInTime, lastOutTime);
                   
                    if (lohResult === null) {
                      // Could not parse times, fall back to normal LOH calculation
                      if (totalWorkingMinutes > 0 && totalWorkingMinutes < expectedWorkingMinutes) {
                        const lossOfMinutes = expectedWorkingMinutes - totalWorkingMinutes;
                        if (lossOfMinutes > 0 && lossOfMinutes < 480) {
                          lohHours = lossOfMinutes / 60;
                        }
                      }
                    } else if (lohResult.shouldCalculate) {
                      lohHours = lohResult.lohHours && lohResult.lohHours > 0 ? parseFloat(lohResult.lohHours.toFixed(2)) : 0;
                    } else {
                      // No LOH (within grace period and left after shift end)
                      lohHours = 0;
                    }
                  } else {
                    // Default to general shift (if not in shiftmap or doesn't have 1st/2nd shift)
                    const lohResult = calculateLOHForGeneralShift(firstInTime, lastOutTime);
                   
                    if (lohResult === null) {
                      if (totalWorkingMinutes > 0 && totalWorkingMinutes < expectedWorkingMinutes) {
                        const lossOfMinutes = expectedWorkingMinutes - totalWorkingMinutes;
                        if (lossOfMinutes > 0 && lossOfMinutes < 480) {
                          lohHours = lossOfMinutes / 60;
                        }
                      }
                    } else if (lohResult.shouldCalculate) {
                      lohHours = lohResult.lohHours && lohResult.lohHours > 0 ? parseFloat(lohResult.lohHours.toFixed(2)) : 0;
                    } else {
                      // No LOH (within grace period and left after shift end)
                      lohHours = 0;
                    }
                  }
                }
              }
            } catch (error) {
              console.error(`Error calculating LOH for ${empIdStr} on ${date}:`, error);
            }
          }
        }
       
        // Allow negative LOH values (they can indicate adjustments or corrections)
        if (lohHours !== null && lohHours !== undefined && !isNaN(lohHours) && lohHours !== 0) {
          if (!lohMap[empIdStr]) {
            lohMap[empIdStr] = 0;
          }
          lohMap[empIdStr] += parseFloat(lohHours.toFixed(2));
        }
      });
    });

    console.log(`LOH hours calculated from muster for ${Object.keys(lohMap).length} employees`);
  } catch (err) {
    console.error('Error calculating LOH from muster:', err);
  }

  return lohMap;
}

/** Raw monthly LOH from muster (payroll LOH column / earned calculations). */
function parsePayrollLohFromMuster(rawHours) {
  const n = parseFloat(String(rawHours ?? '').replace(/,/g, ''));
  if (!Number.isFinite(n)) return 0;
  return parseFloat(n.toFixed(2));
}

/** Late deduction only: ≤1.5h → 0; else raw − 1.5h grace. */
function lohHoursForLateDeduction(rawHours) {
  const rounded = parsePayrollLohFromMuster(rawHours);
  if (rounded <= 1.5) return 0;
  return Math.round((rounded - 1.5) * 100) / 100;
}

/** Parse saved RevisedLOH from Payroll (text column); undefined when unset. */
function parseSavedRevisedLohField(raw) {
  if (raw === null || raw === undefined || String(raw).trim() === '') return undefined;
  const n = parseFloat(String(raw).replace(/,/g, '').trim());
  if (!Number.isFinite(n)) return undefined;
  return parseFloat(n.toFixed(2));
}

/** Revised LOH = saved value when set (including explicit 0), else LOH minus 1.5h grace. */
function resolveRevisedLohForEmployee(empId, lohHours, savedRevisedLOHMap) {
  const derived = lohHoursForLateDeduction(lohHours ?? 0);
  if (savedRevisedLOHMap && typeof savedRevisedLOHMap === 'object') {
    const empIdStr = String(empId ?? '').trim();
    const empIdNorm = normalizeEmployeeCode(empIdStr);
    const saved =
      savedRevisedLOHMap[empIdStr] ??
      savedRevisedLOHMap[empIdNorm] ??
      savedRevisedLOHMap[String(parseInt(empId, 10))];
    if (saved !== undefined && saved !== null && Number.isFinite(saved)) {
      return parseFloat(Number(saved).toFixed(2));
    }
  }
  return derived;
}

/** Hours for Late formula: saved Revised LOH when set, else LOH minus 1.5h grace. */
function lateDeductionHoursForEmployee(empId, loh, savedRevisedLOHMap) {
  return resolveRevisedLohForEmployee(empId, loh, savedRevisedLOHMap);
}

/** Sync Revised LOH on row (LOH − grace, or manual override when it differs). */
function applyRevisedLohToPayrollRow(row) {
  if (!row || typeof row !== 'object') return;
  const raw = parsePayrollLohFromMuster(row.loh ?? row.LOH ?? 0);
  const derived = lohHoursForLateDeduction(raw);
  const explicit = parseSavedRevisedLohField(
    row.revisedLOH ?? row.RevisedLOH ?? row['Revised LOH']
  );
  const revised = explicit !== undefined ? explicit : derived;
  row.revisedLOH = revised;
  row.RevisedLOH = revised;
}

// Helper function to fetch LOH hours from attendance_muster_function
// This fetches the LOH column data directly from attendance muster (which uses LOH report data)
async function fetchLOHHours(catalystApp, month, contractor, department, employeeId, fromDate, toDate, userEmail, userRole) {
  const lohMap = {}; // Map: employeeId -> total LOH hours for the month

  try {
    console.log(`=== FETCHING LOH HOURS FROM ATTENDANCE MUSTER FUNCTION ===`);
    console.log(`Month: ${month}, Contractor: ${contractor}, Department: ${department}, EmployeeId: ${employeeId}`);
    console.log(`Input dates - fromDate: ${fromDate}, toDate: ${toDate}`);
   
    // Normalize date to YYYY-MM-DD format (remove time if present)
    const normalizeDate = (dateStr) => {
      if (!dateStr) return dateStr;
      // If already YYYY-MM-DD format
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
      // If has time component, extract date part
      const dateOnly = dateStr.split(' ')[0];
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) return dateOnly;
      // Try parsing as date
      const parsed = new Date(dateStr);
      if (!isNaN(parsed.getTime())) {
        return parsed.toISOString().slice(0, 10);
      }
      return dateStr;
    };
   
    // Determine date range for attendance_muster_function call
    let musterStartDate, musterEndDate;
    if (fromDate && toDate) {
      // Normalize dates to YYYY-MM-DD format
      musterStartDate = normalizeDate(fromDate);
      musterEndDate = normalizeDate(toDate);
      console.log(`Using custom date range: ${musterStartDate} to ${musterEndDate}`);
    } else {
      const [year, monthNum] = month.split('-').map(Number);
      musterStartDate = `${month}-01`;
      const lastDayOfMonth = new Date(year, monthNum, 0).getDate();
      musterEndDate = `${month}-${String(lastDayOfMonth).padStart(2, '0')}`;
      console.log(`Using month-based date range: ${musterStartDate} to ${musterEndDate}`);
    }
   
    console.log(`Final date range for attendance_muster_function: startDate=${musterStartDate}, endDate=${musterEndDate}`);
   
    // Validate dates are in correct format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(musterStartDate) || !/^\d{4}-\d{2}-\d{2}$/.test(musterEndDate)) {
      console.error(`❌ ERROR: Invalid date format. startDate=${musterStartDate}, endDate=${musterEndDate}`);
      throw new Error(`Invalid date format: startDate=${musterStartDate}, endDate=${musterEndDate}`);
    }
   
    // Build query parameters for attendance_muster_function
    const queryParams = new URLSearchParams();
    queryParams.set('startDate', musterStartDate);
    queryParams.set('endDate', musterEndDate);
    if (contractor && contractor !== 'All') {
      queryParams.set('contractor', contractor);
    }
    if (department && department !== 'All') {
      queryParams.set('department', department);
    }
    if (userEmail) {
      queryParams.set('userEmail', userEmail);
    }
    if (userRole) {
      queryParams.set('userRole', userRole);
    }
   
    // Build the URL for calling attendance_muster_function
    let baseUrl = '';
    if (process.env.CATALYST_FUNCTION_URL) {
      baseUrl = process.env.CATALYST_FUNCTION_URL.replace(/\/$/, '');
    } else if (process.env.CATALYST_ORG_ID) {
      baseUrl = `https://${process.env.CATALYST_ORG_ID}.functions.zoho.com`;
    } else {
      // Use default Catalyst function URL pattern
      baseUrl = 'https://cms2-906055465.development.catalystserverless.com';
    }
   
    const path = `/server/attendance_muster_function?${queryParams.toString()}`;
    const fullUrl = `${baseUrl}${path}`;
    console.log(`Fetching LOH from attendance_muster_function: ${fullUrl}`);
   
    // Make HTTP request to attendance_muster_function
    const http = require('http');
    const https = require('https');
   
    let hostname, port, requestPath, client;
    try {
      const parsedUrl = new URL(fullUrl);
      hostname = parsedUrl.hostname;
      port = parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80);
      requestPath = parsedUrl.pathname + parsedUrl.search;
      client = parsedUrl.protocol === 'https:' ? https : http;
    } catch (e) {
      // Fallback: manual parsing
      const urlMatch = fullUrl.match(/^(https?):\/\/([^\/:]+)(?::(\d+))?(\/.*)?$/);
      if (urlMatch) {
        hostname = urlMatch[2];
        port = urlMatch[3] || (urlMatch[1] === 'https' ? 443 : 80);
        requestPath = urlMatch[4] || '/';
        client = urlMatch[1] === 'https' ? https : http;
      } else {
        throw new Error('Invalid URL format: ' + fullUrl);
      }
    }
   
    // Fetch LOH from attendance_muster_function
    const musterLOHMap = await new Promise((resolve, reject) => {
      const options = {
        hostname: hostname,
        port: port,
        path: requestPath,
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Catalyst-PayrollFunction/1.0'
        },
        timeout: 30000
      };
     
      const reqHttp = client.request(options, (resHttp) => {
        let data = '';
       
        resHttp.on('data', (chunk) => {
          data += chunk;
        });
       
        resHttp.on('end', () => {
          try {
            if (resHttp.statusCode === 200) {
              const result = JSON.parse(data);
              const monthlyLOHPreferred = result.monthlyLOHPreferred || [];
              const employees = result.employees || [];
              const dates = result.dates || [];
             
              console.log(`✅ Successfully fetched LOH data from attendance_muster_function`);
              console.log(`   Employees: ${employees.length}, Dates: ${dates.length} (${dates[0] || 'N/A'} to ${dates[dates.length - 1] || 'N/A'})`);
              console.log(`   monthlyLOHPreferred array length: ${monthlyLOHPreferred.length}`);
              console.log(`   Date range requested: ${musterStartDate} to ${musterEndDate}`);
             
              // Use monthlyLOHPreferred directly - it's already the monthly total for each employee
              // monthlyLOHPreferred[idx] corresponds to employees[idx]
              employees.forEach((empId, empIdx) => {
                const empIdStr = String(empId).trim();
                const monthlyLOH = monthlyLOHPreferred[empIdx];
               
                if (monthlyLOH !== undefined && monthlyLOH !== null && monthlyLOH !== '' && !isNaN(monthlyLOH)) {
                  lohMap[empIdStr] = parsePayrollLohFromMuster(monthlyLOH);
                }
              });
             
              console.log(`✅ Processed LOH data for ${Object.keys(lohMap).length} employees from attendance_muster_function`);
              if (Object.keys(lohMap).length > 0) {
                const totalLOH = Object.values(lohMap).reduce((sum, hours) => sum + hours, 0);
                console.log(`Total LOH hours across all employees: ${totalLOH.toFixed(2)}`);
                console.log(`✅ SUCCESS: Using LOH data from attendance_muster_function for date range ${musterStartDate} to ${musterEndDate}`);
              } else {
                console.log('⚠️ WARNING: No LOH data found in monthlyLOHPreferred array');
                console.log(`   Response structure check: employees.length=${employees.length}, monthlyLOHPreferred.length=${monthlyLOHPreferred.length}, dates.length=${dates.length}`);
              }
             
              resolve(lohMap);
            } else {
              console.error(`❌ ERROR: Attendance muster function returned status ${resHttp.statusCode}`);
              console.error(`   Response (first 1000 chars): ${data.substring(0, 1000)}`);
              console.error(`   Requested date range: ${musterStartDate} to ${musterEndDate}`);
              console.error(`   Falling back to LOHreport table (this may have incorrect data for custom date ranges)`);
              resolve({});
            }
          } catch (parseError) {
            console.error('Error parsing attendance_muster_function response:', parseError);
            console.error('Response data (first 1000 chars):', data.substring(0, 1000));
            resolve({});
          }
        });
      });
     
      reqHttp.on('error', (error) => {
        console.error('❌ HTTP ERROR fetching LOH from attendance_muster_function:', error.message);
        console.error('Error stack:', error.stack);
        console.error('Falling back to LOHreport table');
        resolve({});
      });
     
      reqHttp.setTimeout(30000, () => {
        reqHttp.destroy();
        console.error('❌ TIMEOUT: Timeout fetching LOH from attendance_muster_function after 30 seconds');
        console.error('Falling back to LOHreport table');
        resolve({});
      });
     
      reqHttp.end();
    });
   
    if (musterLOHMap && Object.keys(musterLOHMap).length > 0) {
      console.log(`✅ Returning LOH data from attendance_muster_function: ${Object.keys(musterLOHMap).length} employees`);
      return musterLOHMap;
    } else {
      console.log('⚠️ Attendance muster function returned no LOH data');
      console.log('   Returning empty lohMap - LOH will default to 0 for all employees');
      return {}; // Return empty map - LOH will default to 0 (no fallback to incorrect data)
    }

    // Build date range for the month
    const [year, monthNum] = month.split('-').map(Number);
    const startDate = `${month}-01`;
    const lastDayOfMonth = new Date(year, monthNum, 0).getDate();
    const endDate = `${month}-${String(lastDayOfMonth).padStart(2, '0')}`;
    const startDateTime = `${startDate} 00:00:00`;
    const endDateTime = `${endDate} 23:59:59`;

    // Get employee codes that match the filters
    let filteredEmployeeCodes = [];
    if (employeeId && employeeId !== 'All') {
      filteredEmployeeCodes = [employeeId];
    } else {
      try {
        let empCodesQuery = `SELECT EmployeeCode FROM Employee WHERE EmployeeCode IS NOT NULL`;
        if (contractor && contractor !== 'All') {
          const normalized = String(contractor || '').replace(/\s+/g, ' ').trim().replace(/'/g, "''");
          empCodesQuery += ` AND ContractorName LIKE '%${normalized}%'`;
        }
        if (department && department !== 'All') empCodesQuery += ` AND Department = '${department}'`;
        const empCodesRecords = await catalystApp.zcql().executeZCQLQuery(empCodesQuery);
        filteredEmployeeCodes = empCodesRecords.map(row => row.Employee.EmployeeCode).filter(Boolean);
        console.log(`Filtered employee codes for contractor "${contractor}": ${filteredEmployeeCodes.length} employees`);
        if (filteredEmployeeCodes.length > 0 && filteredEmployeeCodes.length <= 20) {
          console.log(`Employee codes: ${filteredEmployeeCodes.join(', ')}`);
        }
      } catch (empCodesErr) {
        console.log('Error getting filtered employee codes:', empCodesErr.message);
        filteredEmployeeCodes = []; // Empty means fetch all
      }
    }

    // First, try to query LOHreport table directly
    let lohRecords = [];
    let lohReportTableExists = false;
 
    try {
      // Try different possible table and column names for LOHreport
      let lohQuery = `SELECT * FROM LOHreport WHERE (Date >= '${startDate}' AND Date <= '${endDate}' OR Date_filter >= '${startDate}' AND Date_filter <= '${endDate}' OR AttendanceDate >= '${startDate}' AND AttendanceDate <= '${endDate}')`;
   
      // Apply filters only if needed
      // When contractor is "All", we want ALL LOH data, so don't filter by employee codes
      if (employeeId && employeeId !== 'All') {
        // Specific employee filter
        lohQuery += ` AND (EmployeeCode = '${employeeId}' OR EmployeeID = '${employeeId}' OR EmployeeId = '${employeeId}')`;
        console.log(`LOH query filtered by specific employee: ${employeeId}`);
      } else if (contractor && contractor !== 'All' && filteredEmployeeCodes.length > 0) {
        // Contractor filter (not "All") - filter by employee codes
        const empCodesList = filteredEmployeeCodes.map(code => `'${code}'`).join(',');
        lohQuery += ` AND (EmployeeCode IN (${empCodesList}) OR EmployeeID IN (${empCodesList}) OR EmployeeId IN (${empCodesList}))`;
        console.log(`LOH query filtered by ${filteredEmployeeCodes.length} employee codes for contractor: ${contractor}`);
      } else {
        // Contractor is "All" - fetch ALL LOH data without employee code filtering
        // This is correct - we want all LOH data when contractor is "All"
        console.log('Contractor is "All" - LOH query will fetch ALL LOH data (no employee code filtering)');
      }
   
      console.log('Attempting to query LOHreport table:', lohQuery);
   
      // Use pagination to handle large result sets (especially when contractor is "All")
      const pageSize = 300;
      let offset = 0;
      let hasMore = true;
      lohRecords = [];
   
      while (hasMore) {
        let paginatedQuery = lohQuery;
        // Add pagination if ZCQL supports it
        try {
          paginatedQuery += ` ORDER BY ROWID LIMIT ${pageSize} OFFSET ${offset}`;
          const batch = await catalystApp.zcql().executeZCQLQuery(paginatedQuery);
          if (batch.length === 0) {
            hasMore = false;
            break;
          }
          lohRecords.push(...batch);
          offset += pageSize;
          if (batch.length < pageSize) {
            hasMore = false;
          }
          // Safety limit to prevent infinite loops
          if (lohRecords.length > 50000) {
            console.log('⚠️ Reached safety limit of 50000 LOHreport records, stopping pagination');
            hasMore = false;
          }
        } catch (pagErr) {
          // If pagination fails, try without pagination
          console.log('Pagination failed, trying without pagination:', pagErr.message);
          lohRecords = await catalystApp.zcql().executeZCQLQuery(lohQuery);
          hasMore = false;
        }
      }
   
      console.log(`✅ LOHreport table query successful: ${lohRecords.length} total records found (${offset > 0 ? 'paginated' : 'single query'})`);
      lohReportTableExists = true;
   
      // Process LOHreport records
      let processedCount = 0;
      let skippedCount = 0;
      for (const row of lohRecords) {
        const lohRec = row.LOHreport || row.LOHReport || row.lohreport || row;
        if (!lohRec) {
          skippedCount++;
          continue;
        }
     
        // Try different possible column names for employee code/ID
        const empId = lohRec.EmployeeCode || lohRec.EmployeeID || lohRec.EmployeeId || lohRec['Employee Code'] || lohRec.employeeCode || lohRec.employeeID;
        if (!empId) {
          skippedCount++;
          if (processedCount + skippedCount <= 3) {
            console.log('LOHreport record missing employee code/ID. Available keys:', Object.keys(lohRec));
          }
          continue;
        }
     
        // Try different possible column names for LOH hours
        // Based on image: "Loss of Hours (hrs)" column
        const lohHours = parseFloat(
          lohRec.LOH ||
          lohRec.LOHHours ||
          lohRec.LossOfHours ||
          lohRec['Loss of Hours (hrs)'] ||
          lohRec['Loss of Hours'] ||
          lohRec.loh ||
          lohRec.lohHours ||
          lohRec.lossOfHours ||
          0
        );
     
        // Allow negative LOH values (they can indicate adjustments or corrections)
        if (!isNaN(lohHours) && lohHours !== 0) {
          const empIdStr = String(empId);
          if (!lohMap[empIdStr]) {
            lohMap[empIdStr] = 0;
          }
          lohMap[empIdStr] += lohHours;
          processedCount++;
       
          if (processedCount <= 5) {
            console.log(`Processed LOH: Employee ${empIdStr}, LOH=${lohHours.toFixed(2)}, Total=${lohMap[empIdStr].toFixed(2)}`);
          }
        } else {
          skippedCount++;
        }
      }
   
      console.log(`LOHreport processing summary: ${processedCount} records processed, ${skippedCount} records skipped`);
   
      if (Object.keys(lohMap).length > 0) {
        console.log(`✅ LOH hours fetched from LOHreport table: ${Object.keys(lohMap).length} employees`);
        const totalLOH = Object.values(lohMap).reduce((sum, hours) => sum + hours, 0);
        console.log(`Total LOH hours across all employees: ${totalLOH.toFixed(2)}`);
        // Log all LOH keys when filtering by contractor to help debug matching issues
        if (contractor && contractor !== 'All') {
          console.log(`LOH map keys (all ${Object.keys(lohMap).length}): ${Object.keys(lohMap).join(', ')}`);
          console.log(`Expected employee codes (${filteredEmployeeCodes.length}): ${filteredEmployeeCodes.join(', ')}`);
        }
        return lohMap;
      } else {
        console.log('⚠️ No LOH data processed from LOHreport table (all records were skipped or had invalid data)');
        if (lohRecords.length > 0 && processedCount === 0) {
          console.log('⚠️ Records found but none were processed. Sample record structure:', Object.keys(lohRecords[0].LOHreport || lohRecords[0].LOHReport || lohRecords[0] || {}));
        }
      }
    } catch (queryErr) {
      console.log('⚠️ LOHreport table query failed, will calculate from BHR data:', queryErr.message);
      lohReportTableExists = false;
    }

    // If LOHreport table doesn't exist or has no data, calculate from BHR (same logic as reports function)
    console.log('=== CALCULATING LOH FROM BHR DATA (FALLBACK) ===');
 
    // Query BHR table for the month
    // When contractor is "All", fetch ALL BHR data without filtering
    let bhrQuery = `SELECT EmployeeID, EventTime FROM BHR WHERE EventTime >= '${startDateTime}' AND EventTime <= '${endDateTime}'`;
 
    if (employeeId && employeeId !== 'All') {
      bhrQuery += ` AND EmployeeID = '${employeeId}'`;
      console.log(`BHR query filtered by specific employee: ${employeeId}`);
    } else if (contractor && contractor !== 'All' && filteredEmployeeCodes.length > 0) {
      // Only filter by employee codes if contractor is NOT 'All'
      const empCodesList = filteredEmployeeCodes.map(code => `'${code}'`).join(',');
      bhrQuery += ` AND EmployeeID IN (${empCodesList})`;
      console.log(`BHR query filtered by ${filteredEmployeeCodes.length} employee codes for contractor: ${contractor}`);
    } else {
      // When contractor is "All", fetch ALL BHR data without filtering
      console.log('Contractor is "All" - BHR query will fetch ALL BHR data (no employee code filtering)');
    }
 
    bhrQuery += ` ORDER BY EmployeeID, EventTime`;
 
    console.log('BHR query for LOH calculation:', bhrQuery);
    const bhrRecords = await catalystApp.zcql().executeZCQLQuery(bhrQuery);
    console.log(`BHR records found for LOH calculation: ${bhrRecords.length}`);

    // Group by employee and date
    const empDateMap = {}; // Key: empId_date (e.g., "365_2025-11-08")
    for (const row of bhrRecords) {
      const rec = row.BHR;
      const empId = rec.EmployeeID;
      const eventDate = rec.EventTime.split(' ')[0]; // Extract date part
      const key = `${empId}_${eventDate}`;
      if (!empDateMap[key]) empDateMap[key] = { empId, date: eventDate, events: [] };
      empDateMap[key].events.push(rec.EventTime);
    }

    // Helper function to check if a date should be excluded from LOH calculation
    const isDateExcludedFromLOH = (dateStr) => {
      // Normalize date to YYYY-MM-DD format
      let normalizedDate = '';
      if (typeof dateStr === 'string') {
        if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
          normalizedDate = dateStr;
        } else {
          const d = new Date(dateStr);
          if (!isNaN(d)) {
            normalizedDate = d.toISOString().slice(0, 10);
          }
        }
      } else {
        const d = new Date(dateStr);
        if (!isNaN(d)) {
          normalizedDate = d.toISOString().slice(0, 10);
        }
      }
     
      // Dates to exclude from LOH calculation
      const excludedDates = [
        '2025-11-30',
        '2025-12-06',
        '2025-12-07',
        '2025-12-14',
        '2025-12-21'
      ];
     
      return excludedDates.includes(normalizedDate);
    };

    // Calculate LOH for each employee per day and aggregate (same logic as reports function)
    for (const key in empDateMap) {
      const { empId, date: eventDate, events } = empDateMap[key];
 
      // Skip excluded dates from LOH calculation
      if (isDateExcludedFromLOH(eventDate)) {
        continue; // Skip LOH calculation for this date
      }
 
      // Sort events by time
      events.sort((a, b) => new Date(a) - new Date(b));
 
      // Calculate total working time
      let totalWorkingMinutes = 0;
      const expectedWorkingMinutes = 8 * 60; // 8 hours in minutes
 
      if (events.length >= 2) {
        const firstIn = new Date(events[0].replace(' ', 'T'));
        const lastOut = new Date(events[events.length - 1].replace(' ', 'T'));
        const diffMs = lastOut - firstIn;
        if (diffMs > 0) {
          totalWorkingMinutes = Math.floor(diffMs / (1000 * 60));
        }
      }
 
      // Calculate loss of hours (expected - actual, but only if actual < expected)
      // Only include employees who worked more than 0 hours but less than 8 hours
      if (totalWorkingMinutes > 0 && totalWorkingMinutes < expectedWorkingMinutes) {
        const lossOfMinutes = Math.max(0, expectedWorkingMinutes - totalWorkingMinutes);
        const lossOfHours = lossOfMinutes / 60;
   
        // Aggregate LOH hours for the employee
        const empIdStr = String(empId);
        if (!lohMap[empIdStr]) {
          lohMap[empIdStr] = 0;
        }
        lohMap[empIdStr] += lossOfHours;
      }
    }

    console.log(`LOH hours calculated from BHR for ${Object.keys(lohMap).length} employees`);
    if (Object.keys(lohMap).length > 0) {
      const totalLOH = Object.values(lohMap).reduce((sum, hours) => sum + hours, 0);
      console.log(`Total LOH hours across all employees: ${totalLOH.toFixed(2)}`);
      // Log all LOH keys when filtering by contractor to help debug matching issues
      if (contractor && contractor !== 'All') {
        console.log(`LOH map keys from BHR (all ${Object.keys(lohMap).length}): ${Object.keys(lohMap).join(', ')}`);
        console.log(`Expected employee codes (${filteredEmployeeCodes.length}): ${filteredEmployeeCodes.join(', ')}`);
      }
    } else {
      console.log('⚠️ No LOH data found (neither from LOHreport table nor calculated from BHR)');
    }
  } catch (err) {
    console.log('Error fetching LOH hours:', err.message);
    console.log('Error stack:', err.stack);
    // Return empty map on error
  }

  return lohMap;
}

// Helper function to fetch OT hours from attendance_muster_function
// This fetches the monthlyOvertimePreferred array from attendance_muster_function
// Similar to fetchLOHHours but for OT hours
async function fetchOTHoursFromMuster(catalystApp, month, contractor, department, employeeId, fromDate, toDate, userEmail, userRole) {
  const otHoursMap = {}; // Map: employeeId -> total OT hours for the month

  try {
    console.log(`=== FETCHING OT HOURS FROM ATTENDANCE MUSTER FUNCTION ===`);
    console.log(`Month: ${month}, Contractor: ${contractor}, Department: ${department}, EmployeeId: ${employeeId}`);
    console.log(`Input dates - fromDate: ${fromDate}, toDate: ${toDate}`);
   
    // Build date range - use custom dates if provided, otherwise use month
    let musterStartDate, musterEndDate;
    if (fromDate && toDate) {
      musterStartDate = fromDate;
      musterEndDate = toDate;
    } else {
      const [year, monthNum] = month.split('-').map(Number);
      musterStartDate = `${month}-01`;
      const lastDayOfMonth = new Date(year, monthNum, 0).getDate();
      musterEndDate = `${month}-${String(lastDayOfMonth).padStart(2, '0')}`;
    }
   
    // Build query parameters for attendance_muster_function
    const queryParams = new URLSearchParams();
    queryParams.set('startDate', musterStartDate);
    queryParams.set('endDate', musterEndDate);
    if (contractor && contractor !== 'All') {
      queryParams.set('contractor', contractor);
    }
    if (department && department !== 'All') {
      queryParams.set('department', department);
    }
    if (employeeId && employeeId !== 'All') {
      queryParams.set('employeeId', employeeId);
    }
    if (userEmail) {
      queryParams.set('userEmail', userEmail);
    }
    if (userRole) {
      queryParams.set('userRole', userRole);
    }
   
    // Build the URL for calling attendance_muster_function
    let baseUrl = '';
    if (process.env.CATALYST_FUNCTION_URL) {
      baseUrl = process.env.CATALYST_FUNCTION_URL.replace(/\/$/, '');
    } else if (process.env.CATALYST_ORG_ID) {
      baseUrl = `https://${process.env.CATALYST_ORG_ID}.functions.zoho.com`;
    } else {
      // Use default Catalyst function URL pattern
      baseUrl = 'https://cms2-906055465.development.catalystserverless.com';
    }
   
    const path = `/server/attendance_muster_function?${queryParams.toString()}`;
    const fullUrl = `${baseUrl}${path}`;
    console.log(`Fetching OT hours from attendance_muster_function: ${fullUrl}`);
   
    // Make HTTP request to attendance_muster_function
    const http = require('http');
    const https = require('https');
   
    let hostname, port, requestPath, client;
    try {
      const parsedUrl = new URL(fullUrl);
      hostname = parsedUrl.hostname;
      port = parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80);
      requestPath = parsedUrl.pathname + parsedUrl.search;
      client = parsedUrl.protocol === 'https:' ? https : http;
    } catch (e) {
      // Fallback: manual parsing
      const urlMatch = fullUrl.match(/^(https?):\/\/([^\/:]+)(?::(\d+))?(\/.*)?$/);
      if (urlMatch) {
        hostname = urlMatch[2];
        port = urlMatch[3] || (urlMatch[1] === 'https' ? 443 : 80);
        requestPath = urlMatch[4] || '/';
        client = urlMatch[1] === 'https' ? https : http;
      } else {
        throw new Error('Invalid URL format: ' + fullUrl);
      }
    }
   
    // Fetch OT hours from attendance_muster_function
    const musterOTMap = await new Promise((resolve, reject) => {
      const options = {
        hostname: hostname,
        port: port,
        path: requestPath,
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Catalyst-PayrollFunction/1.0'
        },
        timeout: 30000
      };
     
      const reqHttp = client.request(options, (resHttp) => {
        let data = '';
       
        resHttp.on('data', (chunk) => {
          data += chunk;
        });
       
        resHttp.on('end', () => {
          try {
            console.log(`📥 Received response from attendance_muster_function. Status: ${resHttp.statusCode}, Data length: ${data.length}`);
           
            if (resHttp.statusCode === 200) {
              const result = JSON.parse(data);
              console.log(`📦 Parsed JSON response. Keys: ${Object.keys(result).join(', ')}`);
             
              const monthlyOvertimePreferred = result.monthlyOvertimePreferred || [];
              const employees = result.employees || [];
              const dates = result.dates || [];
             
              console.log(`✅ Successfully fetched OT hours data from attendance_muster_function`);
              console.log(`   Employees: ${employees.length}, Dates: ${dates.length} (${dates[0] || 'N/A'} to ${dates[dates.length - 1] || 'N/A'})`);
              console.log(`   monthlyOvertimePreferred array length: ${monthlyOvertimePreferred.length}`);
              console.log(`   Date range requested: ${musterStartDate} to ${musterEndDate}`);
             
              // Debug: Log first few employees and their OT values
              if (employees.length > 0 && monthlyOvertimePreferred.length > 0) {
                console.log(`   Sample mapping (first 5):`, employees.slice(0, 5).map((emp, idx) => ({
                  employeeId: emp,
                  otHours: monthlyOvertimePreferred[idx]
                })));
              }
             
              // Use monthlyOvertimePreferred directly - it's already the monthly total for each employee
              // monthlyOvertimePreferred[idx] corresponds to employees[idx]
              let processedCount = 0;
              employees.forEach((empId, empIdx) => {
                const empIdStr = String(empId).trim();
                const monthlyOT = monthlyOvertimePreferred[empIdx];
               
                if (monthlyOT !== undefined && monthlyOT !== null && monthlyOT !== '' && !isNaN(monthlyOT)) {
                  const otValue = parseFloat(monthlyOT);
                  // Include 0.00 values (same as attendance muster does)
                  otHoursMap[empIdStr] = parseFloat(otValue.toFixed(3));
                  // Also store with numeric key for better matching
                  const empIdNum = parseInt(empIdStr);
                  if (!isNaN(empIdNum)) {
                    otHoursMap[String(empIdNum)] = parseFloat(otValue.toFixed(3));
                    if (empIdNum === 33021) {
                      console.log(`✅ Employee 33021 mapped: otHoursMap['33021']=${otHoursMap['33021']}, otHoursMap[33021]=${otHoursMap[33021]}`);
                    }
                  }
                  processedCount++;
                } else if (empIdStr === '33021' || String(empId) === '33021') {
                  console.log(`⚠️ Employee 33021 found in employees array but monthlyOT is invalid: ${monthlyOT} (type: ${typeof monthlyOT}, index: ${empIdx})`);
                }
              });
             
              console.log(`✅ Processed OT hours data for ${Object.keys(otHoursMap).length} employees from attendance_muster_function (${processedCount} valid values)`);
              if (Object.keys(otHoursMap).length > 0) {
                const totalOT = Object.values(otHoursMap).reduce((sum, hours) => sum + hours, 0);
                console.log(`Total OT hours across all employees: ${totalOT.toFixed(3)}`);
                // Log sample entries for debugging
                const sampleEntries = Object.entries(otHoursMap).slice(0, 10);
                console.log(`Sample OT hours data (first 10):`, sampleEntries.map(([id, hours]) => ({ employeeId: id, otHours: hours.toFixed(3) })));
                // Check if employee 33021 is in the map
                if (otHoursMap['33021'] !== undefined || otHoursMap[33021] !== undefined) {
                  console.log(`✅ Found employee 33021 in OT hours map: ${otHoursMap['33021'] || otHoursMap[33021]} hours`);
                } else {
                  console.log(`⚠️ Employee 33021 NOT found in OT hours map. Available keys (first 30):`, Object.keys(otHoursMap).slice(0, 30));
                  // Check if 33021 is in employees array
                  const emp33021Index = employees.findIndex(emp => String(emp) === '33021' || emp === 33021);
                  if (emp33021Index >= 0) {
                    console.log(`   Employee 33021 found at index ${emp33021Index} in employees array`);
                    console.log(`   monthlyOvertimePreferred[${emp33021Index}] = ${monthlyOvertimePreferred[emp33021Index]} (type: ${typeof monthlyOvertimePreferred[emp33021Index]})`);
                  } else {
                    console.log(`   Employee 33021 NOT found in employees array at all`);
                  }
                }
                console.log(`✅ SUCCESS: Using OT hours data from attendance_muster_function for date range ${musterStartDate} to ${musterEndDate}`);
              } else {
                console.log('⚠️ WARNING: No OT hours data found in monthlyOvertimePreferred array');
                console.log(`   Response structure check: employees.length=${employees.length}, monthlyOvertimePreferred.length=${monthlyOvertimePreferred.length}, dates.length=${dates.length}`);
                if (employees.length > 0) {
                  console.log(`   Sample employee IDs from response (first 10):`, employees.slice(0, 10));
                }
                if (monthlyOvertimePreferred.length > 0) {
                  console.log(`   Sample monthlyOvertimePreferred values (first 10):`, monthlyOvertimePreferred.slice(0, 10));
                }
                // Log full response structure for debugging
                console.log(`   Full response keys:`, Object.keys(result));
              }
             
              resolve(otHoursMap);
            } else {
              console.error(`❌ ERROR: Attendance muster function returned status ${resHttp.statusCode}`);
              console.error(`   Response (first 2000 chars): ${data.substring(0, 2000)}`);
              console.error(`   Requested date range: ${musterStartDate} to ${musterEndDate}`);
              console.error(`   Full URL: ${fullUrl}`);
              console.error(`   Falling back to empty OT hours map`);
              resolve({});
            }
          } catch (parseError) {
            console.error('❌ Error parsing attendance_muster_function response:', parseError);
            console.error('   Parse error message:', parseError.message);
            console.error('   Parse error stack:', parseError.stack);
            console.error('   Response data length:', data.length);
            console.error('   Response data (first 2000 chars):', data.substring(0, 2000));
            resolve({});
          }
        });
      });
     
      reqHttp.on('error', (error) => {
        console.error('❌ HTTP ERROR fetching OT hours from attendance_muster_function:', error.message);
        console.error('Error stack:', error.stack);
        console.error('Falling back to empty OT hours map');
        resolve({});
      });
     
      reqHttp.setTimeout(30000, () => {
        reqHttp.destroy();
        console.error('❌ TIMEOUT: Timeout fetching OT hours from attendance_muster_function after 30 seconds');
        console.error('Falling back to empty OT hours map');
        resolve({});
      });
     
      reqHttp.end();
    });
   
    // musterOTMap is the resolved value from the Promise, which is otHoursMap
    if (musterOTMap && Object.keys(musterOTMap).length > 0) {
      console.log(`✅ Returning OT hours data from attendance_muster_function: ${Object.keys(musterOTMap).length} employees`);
      // Check for employee 33021 specifically before returning
      if (musterOTMap['33021'] !== undefined || musterOTMap[33021] !== undefined) {
        console.log(`✅ Employee 33021 OT hours in return map: ${musterOTMap['33021'] || musterOTMap[33021]} hours`);
      }
      return musterOTMap;
    } else {
      console.log('⚠️ Attendance muster function returned no OT hours data');
      console.log(`   musterOTMap type: ${typeof musterOTMap}, keys: ${musterOTMap ? Object.keys(musterOTMap).length : 'null'}`);
      console.log('   Returning empty otHoursMap - OT hours will default to saved values or 0');
      return {}; // Return empty map - OT hours will use saved values or default to 0
    }

  } catch (err) {
    console.error('❌ Error fetching OT hours from attendance_muster_function:', err.message);
    console.error('Error stack:', err.stack);
    return {}; // Return empty map on error
  }
}

/** HTTP GET JSON for server-to-server calls (muster / reports). */
function payrollHttpGetJson(hostname, port, client, pathWithQuery, timeoutMs) {
  return new Promise((resolve) => {
    const options = {
      hostname,
      port,
      path: pathWithQuery,
      method: 'GET',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'Catalyst-PayrollFunction/1.0' },
      timeout: timeoutMs
    };
    const reqHttp = client.request(options, (resHttp) => {
      let data = '';
      resHttp.on('data', (chunk) => {
        data += chunk;
      });
      resHttp.on('end', () => {
        if (resHttp.statusCode !== 200) return resolve(null);
        try {
          resolve(JSON.parse(data));
        } catch (_) {
          resolve(null);
        }
      });
    });
    reqHttp.on('error', () => resolve(null));
    reqHttp.setTimeout(timeoutMs, () => {
      try {
        reqHttp.destroy();
      } catch (_) {
        /* ignore */
      }
      resolve(null);
    });
    reqHttp.end();
  });
}

function payrollNormalizeLohReportDateYmd(value) {
  if (!value) return '';
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function payrollBuildLohHoursMapFromReportsRows(lohRows) {
  const map = {};
  if (!Array.isArray(lohRows)) return map;
  for (const row of lohRows) {
    const empId = String(row.employeeId ?? row.EmployeeId ?? '').trim();
    if (!empId) continue;
    const dateStr = payrollNormalizeLohReportDateYmd(row.date);
    if (!dateStr) continue;
    const hours = parseFloat(String(row.lossOfHours ?? '0').replace(/,/g, ''));
    if (!Number.isFinite(hours)) continue;
    map[`${empId}_${dateStr}`] = hours;
  }
  return map;
}

function payrollIsMusterCellLohExcluded(status, shiftTypeLabel) {
  const st = String(status ?? '').trim();
  if (st === 'WO' || st === 'H' || st === 'Week Off') return true;
  const sh = String(shiftTypeLabel ?? '').toLowerCase();
  if (sh.includes('housekeeping') || sh.includes('house keeping')) return true;
  return false;
}

/** Same overlay as Attendance Muster UI: LOH Report rows → monthly totals. */
function payrollApplyReportsLohToMusterData(musterData, lohRows) {
  if (!musterData || !Array.isArray(musterData.employees) || !Array.isArray(musterData.dates)) {
    return musterData;
  }
  const hourMap = payrollBuildLohHoursMapFromReportsRows(lohRows);
  if (Object.keys(hourMap).length === 0) return musterData;

  const dates = musterData.dates;
  const newLoh = musterData.employees.map((empId, rowIdx) => {
    const empStr = String(empId).trim();
    const rowStatuses = musterData.muster?.[rowIdx] || [];
    const rowShiftTypes = musterData.shiftTypes?.[rowIdx] || [];
    return dates.map((dateStr, colIdx) => {
      if (payrollIsMusterCellLohExcluded(rowStatuses[colIdx], rowShiftTypes[colIdx])) return '';
      const key = `${empStr}_${dateStr}`;
      if (hourMap[key] === undefined) return '';
      return parseFloat((hourMap[key] || 0).toFixed(2));
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

async function payrollFetchReportsLohRows(hostname, port, client, musterStartDate, musterEndDate, contractor, department, employeeId, userEmail, userRole) {
  let grace = '10';
  let designationApplicableTo = '';
  const des = await payrollHttpGetJson(hostname, port, client, '/server/reports_function/loh-designation-applicable', 15000);
  if (des && des.data) {
    const g = String(des.data.grace || '').trim();
    if (g && /^\d+$/.test(g)) grace = g;
    const designations = des.data.designations || [];
    const only = Array.isArray(designations)
      ? designations.filter((v) => v && String(v).toLowerCase() !== 'all')
      : [];
    if (only.length > 0) designationApplicableTo = only.join(',');
  }
  const q = new URLSearchParams({
    _t: String(Date.now()),
    startDate: musterStartDate,
    endDate: musterEndDate,
    grace
  });
  if (contractor && contractor !== 'All') q.set('contractor', contractor);
  if (department && department !== 'All') q.set('department', department);
  if (employeeId && employeeId !== 'All') q.set('employeeId', employeeId);
  if (designationApplicableTo) q.set('designationApplicableTo', designationApplicableTo);
  if (userEmail) q.set('userEmail', userEmail);
  if (userRole) q.set('userRole', userRole);
  const lohJson = await payrollHttpGetJson(hostname, port, client, `/server/reports_function/loh?${q.toString()}`, 45000);
  return Array.isArray(lohJson && lohJson.data) ? lohJson.data : [];
}

function payrollResolveHttpTarget(fullUrl) {
  const http = require('http');
  const https = require('https');
  try {
    const u = new URL(fullUrl);
    return {
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      client: u.protocol === 'https:' ? https : http,
      path: u.pathname + u.search
    };
  } catch (e) {
    const urlMatch = fullUrl.match(/^(https?):\/\/([^/:]+)(?::(\d+))?(\/.*)?$/);
    if (!urlMatch) return null;
    return {
      hostname: urlMatch[2],
      port: urlMatch[3] || (urlMatch[1] === 'https' ? 443 : 80),
      client: urlMatch[1] === 'https' ? https : http,
      path: urlMatch[4] || '/'
    };
  }
}

function payrollFillLohOtMapsFromMusterPayload(merged, lohMap, otHoursMap) {
  const monthlyLOHPreferred = merged.monthlyLOHPreferred || [];
  const monthlyOvertimePreferred = merged.monthlyOvertimePreferred || [];
  const employees = merged.employees || [];
  employees.forEach((empId, empIdx) => {
    const empIdStr = String(empId).trim();
    if (
      monthlyLOHPreferred[empIdx] !== undefined &&
      monthlyLOHPreferred[empIdx] !== null &&
      monthlyLOHPreferred[empIdx] !== '' &&
      !isNaN(monthlyLOHPreferred[empIdx])
    ) {
      lohMap[empIdStr] = parsePayrollLohFromMuster(monthlyLOHPreferred[empIdx]);
    }
    if (
      monthlyOvertimePreferred[empIdx] !== undefined &&
      monthlyOvertimePreferred[empIdx] !== null &&
      monthlyOvertimePreferred[empIdx] !== '' &&
      !isNaN(monthlyOvertimePreferred[empIdx])
    ) {
      const otVal = parseFloat(monthlyOvertimePreferred[empIdx]).toFixed(3);
      otHoursMap[empIdStr] = parseFloat(otVal);
      const num = parseInt(empIdStr, 10);
      if (!isNaN(num)) otHoursMap[String(num)] = parseFloat(otVal);
    }
  });
}

// Single HTTP call to attendance_muster_function returning both LOH and OT maps (avoids execution time exceeded)
async function fetchLOHAndOTFromMuster(catalystApp, month, contractor, department, employeeId, fromDate, toDate, userEmail, userRole) {
  const lohMap = {};
  const otHoursMap = {};
  const normalizeDate = (dateStr) => {
    if (!dateStr) return dateStr;
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
    const dateOnly = String(dateStr).split(' ')[0];
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) return dateOnly;
    const parsed = new Date(dateStr);
    return !isNaN(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : dateStr;
  };
  let musterStartDate, musterEndDate;
  if (fromDate && toDate) {
    musterStartDate = normalizeDate(fromDate);
    musterEndDate = normalizeDate(toDate);
  } else {
    const [y, mNum] = month.split('-').map(Number);
    musterStartDate = `${month}-01`;
    musterEndDate = `${month}-${String(new Date(y, mNum, 0).getDate()).padStart(2, '0')}`;
  }
  const queryParams = new URLSearchParams();
  queryParams.set('startDate', musterStartDate);
  queryParams.set('endDate', musterEndDate);
  if (contractor && contractor !== 'All') queryParams.set('contractor', contractor);
  if (department && department !== 'All') queryParams.set('department', department);
  if (employeeId && employeeId !== 'All') queryParams.set('employeeId', employeeId);
  queryParams.set('source', 'both');
  if (userEmail) queryParams.set('userEmail', userEmail);
  if (userRole) queryParams.set('userRole', userRole);
  const baseUrl = process.env.CATALYST_FUNCTION_URL
    ? process.env.CATALYST_FUNCTION_URL.replace(/\/$/, '')
    : process.env.CATALYST_ORG_ID
      ? `https://${process.env.CATALYST_ORG_ID}.functions.zoho.com`
      : 'https://cms2-906055465.development.catalystserverless.com';
  const requestPath = `/server/attendance_muster_function?${queryParams.toString()}`;
  const fullUrl = `${baseUrl}${requestPath}`;
  const target = payrollResolveHttpTarget(fullUrl);
  if (!target) return { lohMap: {}, otHoursMap: {} };

  try {
    const musterJson = await payrollHttpGetJson(target.hostname, target.port, target.client, target.path, 35000);
    if (!musterJson || !Array.isArray(musterJson.employees)) {
      return { lohMap: {}, otHoursMap: {} };
    }
    let merged = musterJson;
    try {
      const lohRows = await payrollFetchReportsLohRows(
        target.hostname,
        target.port,
        target.client,
        musterStartDate,
        musterEndDate,
        contractor,
        department,
        employeeId,
        userEmail,
        userRole
      );
      if (lohRows.length > 0) {
        merged = payrollApplyReportsLohToMusterData(musterJson, lohRows);
        console.log(`fetchLOHAndOTFromMuster: LOH merged from reports_function (${lohRows.length} row(s))`);
      }
    } catch (overlayErr) {
      console.warn('fetchLOHAndOTFromMuster: LOH overlay skipped:', overlayErr.message);
    }
    payrollFillLohOtMapsFromMusterPayload(merged, lohMap, otHoursMap);
    return { lohMap, otHoursMap };
  } catch (err) {
    console.error('fetchLOHAndOTFromMuster error:', err.message);
    return { lohMap: {}, otHoursMap: {} };
  }
}

// Helper function to calculate OT hours from attendance muster logic
// This uses the same logic as attendance_muster_function to ensure consistency
async function calculateOTHoursFromMuster(catalystApp, month, contractor, department, employeeId, fromDate, toDate) {
  const otHoursMap = {}; // Map: employeeId -> total OT hours for the month

  try {
    console.log(`=== CALCULATING OT HOURS FROM ATTENDANCE MUSTER LOGIC ===`);
    console.log(`Month: ${month}, Contractor: ${contractor}, Department: ${department}, EmployeeId: ${employeeId}`);
   
    // Build date range - use custom dates if provided, otherwise use month
    let startDate, endDateStr;
    if (fromDate && toDate) {
      function normalizeDate(dateStr) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
          return dateStr;
        }
        const dateObj = new Date(dateStr);
        if (isNaN(dateObj.getTime())) {
          throw new Error(`Invalid date format: ${dateStr}`);
        }
        const year = dateObj.getFullYear();
        const month = String(dateObj.getMonth() + 1).padStart(2, '0');
        const day = String(dateObj.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      }
      startDate = normalizeDate(fromDate);
      endDateStr = normalizeDate(toDate);
    } else {
      const [year, monthNum] = month.split('-').map(Number);
      startDate = `${month}-01`;
      const lastDayOfMonth = new Date(year, monthNum, 0).getDate();
      endDateStr = `${month}-${String(lastDayOfMonth).padStart(2, '0')}`;
    }

    // Reuse the byKey structure from calculatePresentDaysFromMuster logic
    // We'll build it the same way but focus on OT calculation
    // For efficiency, we can call calculatePresentDaysFromMuster to get the byKey structure
    // But actually, we need to build it ourselves to calculate OT
   
    // Get employee filter conditions (same as calculatePresentDaysFromMuster)
    let employeeFilterConditions = [];
    let employeeIds = [];
   
    if (contractor && contractor !== 'All') {
      try {
        const normalized = String(contractor || '').replace(/\s+/g, ' ').trim().replace(/'/g, "''");
        const contractorEmployeeQuery = await catalystApp.zcql().executeZCQLQuery(
          `SELECT EmployeeCode FROM Employee WHERE ContractorName LIKE '%${normalized}%'`
        );
        if (contractorEmployeeQuery && contractorEmployeeQuery.length > 0) {
          employeeIds = contractorEmployeeQuery.map(emp => emp.Employee.EmployeeCode);
        }
      } catch (error) {
        console.error('Error applying contractor filter:', error);
      }
    }
   
    if (department && department !== 'All') {
      try {
        const departmentEmployeeQuery = await catalystApp.zcql().executeZCQLQuery(
          `SELECT EmployeeCode FROM Employee WHERE Department = '${department}'`
        );
        if (departmentEmployeeQuery && departmentEmployeeQuery.length > 0) {
          const departmentEmployeeIds = departmentEmployeeQuery.map(emp => emp.Employee.EmployeeCode);
          if (employeeIds.length > 0) {
            employeeIds = employeeIds.filter(id => departmentEmployeeIds.includes(id));
          } else {
            employeeIds = departmentEmployeeIds;
          }
        }
      } catch (error) {
        console.error('Error applying department filter:', error);
      }
    }
   
    if (employeeId && employeeId !== 'All') {
      if (employeeIds.length > 0) {
        employeeIds = employeeIds.filter(id => id === employeeId);
      } else {
        employeeIds = [employeeId];
      }
    }
   
    if (employeeIds.length > 0) {
      const employeeIdList = employeeIds.map(id => `'${id}'`).join(',');
      employeeFilterConditions.push(`EmployeeID IN (${employeeIdList})`);
    }

    // Build dates array
    const dates = [];
    const [startYear, startMonth, startDay] = startDate.split('-').map(Number);
    const [endYear, endMonth, endDay] = endDateStr.split('-').map(Number);
    const startDateObj = new Date(startYear, startMonth - 1, startDay);
    const endDateObj = new Date(endYear, endMonth - 1, endDay);
   
    for (let d = new Date(startDateObj); d <= endDateObj; d.setDate(d.getDate() + 1)) {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      dates.push(`${year}-${month}-${day}`);
    }

    // Fetch shift mappings (same as attendance_muster_function)
    const shiftMap = {};
    try {
      const shiftQuery = `SELECT EmployeeId, AssignedShift, Fromdate, Todate FROM Shiftmap WHERE Fromdate <= '${endDateStr}' AND Todate >= '${startDate}'`;
      const shiftRecords = await catalystApp.zcql().executeZCQLQuery(shiftQuery);
     
      const rowIdToCodeMap = {};
      const employeeRowIds = [...new Set(shiftRecords.map(r => String(r.Shiftmap.EmployeeId || '').trim()).filter(Boolean))];
      if (employeeRowIds.length > 0) {
        const empQuery = `SELECT ROWID, EmployeeCode FROM Employee`;
        const empRecords = await catalystApp.zcql().executeZCQLQuery(empQuery);
        for (const empRow of empRecords) {
          const emp = empRow.Employee;
          const rowId = String(emp.ROWID || '').trim();
          const empCode = String(emp.EmployeeCode || '').trim();
          if (rowId && empCode && employeeRowIds.includes(rowId)) {
            rowIdToCodeMap[rowId] = empCode;
          }
        }
      }
     
      for (const row of shiftRecords) {
        const shift = row.Shiftmap;
        const empRowId = String(shift.EmployeeId || '').trim();
        if (!empRowId) continue;
       
        const empCode = rowIdToCodeMap[empRowId];
        if (!empCode) continue;
       
        const normalizeDate = (dateVal) => {
          if (!dateVal) return '';
          let dateStr = '';
          if (typeof dateVal === 'string') {
            dateStr = String(dateVal).trim();
          } else {
            const d = new Date(dateVal);
            if (!isNaN(d.getTime())) {
              return d.toISOString().slice(0, 10);
            }
            return '';
          }
          if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
            return dateStr;
          }
          const dmyMatch = dateStr.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);
          if (dmyMatch) {
            const [, day, month, year] = dmyMatch;
            return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
          }
          const d = new Date(dateStr);
          if (!isNaN(d.getTime())) {
            return d.toISOString().slice(0, 10);
          }
          return '';
        };
       
        const fromDateShift = normalizeDate(shift.Fromdate);
        const toDateShift = normalizeDate(shift.Todate);
        const assignedShift = String(shift.AssignedShift || '').trim().toUpperCase();
       
        if (!shiftMap[empCode]) {
          shiftMap[empCode] = [];
        }
        shiftMap[empCode].push({
          assignedShift: assignedShift,
          fromdate: fromDateShift,
          todate: toDateShift
        });
      }
    } catch (err) {
      console.log('Shiftmap query error:', err.message);
    }

    // Helper functions for shift detection (same as attendance_muster_function)
    const isGeneralShift = (empId, dateStr) => {
      if (!shiftMap[empId] || shiftMap[empId].length === 0) return false;
      for (const shift of shiftMap[empId]) {
        if (shift.assignedShift === 'GENERAL' || shift.assignedShift === 'GENERAL SHIFT') {
          if (shift.fromdate && shift.todate) {
            if (dateStr >= shift.fromdate && dateStr <= shift.todate) return true;
          } else if (shift.fromdate && dateStr >= shift.fromdate) return true;
          else if (shift.todate && dateStr <= shift.todate) return true;
        }
      }
      return false;
    };

    const isFirstShift = (empId, dateStr) => {
      if (!shiftMap[empId] || shiftMap[empId].length === 0) return false;
      for (const shift of shiftMap[empId]) {
        const shiftName = shift.assignedShift || '';
        if (shiftName === '1ST' || shiftName === '1ST SHIFT' || shiftName === 'FIRST' ||
            shiftName === 'FIRST SHIFT' || shiftName === '1' || shiftName === 'SHIFT 1') {
          if (shift.fromdate && shift.todate) {
            if (dateStr >= shift.fromdate && dateStr <= shift.todate) return true;
          } else if (shift.fromdate && dateStr >= shift.fromdate) return true;
          else if (shift.todate && dateStr <= shift.todate) return true;
        }
      }
      return false;
    };

    const isSecondShift = (empId, dateStr) => {
      if (!shiftMap[empId] || shiftMap[empId].length === 0) return false;
      for (const shift of shiftMap[empId]) {
        const shiftName = shift.assignedShift || '';
        if (shiftName === '2ND' || shiftName === '2ND SHIFT' || shiftName === 'SECOND' ||
            shiftName === 'SECOND SHIFT' || shiftName === '2' || shiftName === 'SHIFT 2') {
          if (shift.fromdate && shift.todate) {
            if (dateStr >= shift.fromdate && dateStr <= shift.todate) return true;
          } else if (shift.fromdate && dateStr >= shift.fromdate) return true;
          else if (shift.todate && dateStr <= shift.todate) return true;
        }
      }
      return false;
    };

    // OT calculation helper functions (same as attendance_muster_function)
    const parseTimeFromString = (timeStr) => {
      if (!timeStr) return '';
      let timePart = '';
      if (typeof timeStr === 'string') {
        if (timeStr.includes(' ')) {
          const parts = timeStr.split(' ');
          timePart = parts[1] || '00:00:00';
        } else {
          timePart = timeStr;
        }
      } else {
        const d = new Date(timeStr);
        if (!isNaN(d.getTime())) {
          const hours = String(d.getHours()).padStart(2, '0');
          const minutes = String(d.getMinutes()).padStart(2, '0');
          const seconds = String(d.getSeconds()).padStart(2, '0');
          timePart = `${hours}:${minutes}:${seconds}`;
        } else {
          return '';
        }
      }
      if (timePart.split(':').length === 2) {
        timePart += ':00';
      }
      return timePart;
    };

    const lastOutInstantFromStr = (lastOutTimeStr, dateStr) => {
      if (!lastOutTimeStr || !dateStr) return null;
      const s = String(lastOutTimeStr).trim();
      const timePart = parseTimeFromString(lastOutTimeStr);
      if (!timePart) return null;
      if (/^\d{4}-\d{2}-\d{2}\s/.test(s)) {
        const iso = s.length >= 19 ? s.substring(0, 19).replace(' ', 'T') : s.replace(' ', 'T');
        const d = new Date(iso);
        return isNaN(d.getTime()) ? null : d;
      }
      const d = new Date(`${dateStr} ${timePart}`.replace(' ', 'T'));
      return isNaN(d.getTime()) ? null : d;
    };

    // Round checkout DOWN to :00/:30; OT = rounded - shiftEnd (aligned with Monthly OT report).
    const roundLastOutDownToHalfHour = (lastOutDate) => {
      if (!lastOutDate || isNaN(lastOutDate.getTime())) return null;
      const d = new Date(lastOutDate.getTime());
      d.setMinutes(Math.floor(d.getMinutes() / 30) * 30, 0, 0);
      return d;
    };

    const calculateOvertimeAgainstShiftEnd = (lastOutTimeStr, dateStr, shiftEndHms) => {
      if (!lastOutTimeStr || !dateStr || !shiftEndHms) return 0;
      try {
        const lastOutTime = lastOutInstantFromStr(lastOutTimeStr, dateStr);
        if (!lastOutTime) return 0;
        const roundedLastOut = roundLastOutDownToHalfHour(lastOutTime);
        if (!roundedLastOut) return 0;
        const baseTime = new Date(`${dateStr} ${shiftEndHms}`.replace(' ', 'T'));
        if (isNaN(roundedLastOut.getTime()) || isNaN(baseTime.getTime())) return 0;
        if (roundedLastOut > baseTime) {
          const overtimeHours = (roundedLastOut - baseTime) / (1000 * 60 * 60);
          return Math.max(0, parseFloat(overtimeHours.toFixed(3)));
        }
        return 0;
      } catch (error) {
        return 0;
      }
    };

    const calculateOvertimeForGeneralShift = (lastOutTimeStr, dateStr) => {
      return calculateOvertimeAgainstShiftEnd(lastOutTimeStr, dateStr, '17:00:00');
    };

    const calculateOvertimeForFirstShift = (lastOutTimeStr, dateStr) => {
      return calculateOvertimeAgainstShiftEnd(lastOutTimeStr, dateStr, '14:30:00');
    };

    const calculateOvertimeForSecondShift = (lastOutTimeStr, dateStr) => {
      // Shift master 2ND: 08:00-16:30
      return calculateOvertimeAgainstShiftEnd(lastOutTimeStr, dateStr, '16:30:00');
    };

    // Build byKey structure (same as attendance_muster_function)
    // We'll build a simplified version focusing on OT calculation
    const byKey = {};
   
    // Fetch BHR data
    const allLogs = [];
    let offset = 0;
    const pageSize = 300;
    let hasMore = true;
    while (hasMore) {
      let query = `SELECT EmployeeID, EventTime FROM BHR
                   WHERE EventTime >= '${startDate} 00:00:00'
                   AND EventTime <= '${endDateStr} 23:59:59'`;
      if (employeeFilterConditions.length > 0) {
        query += ` AND ${employeeFilterConditions.join(' AND ')}`;
      }
      query += ` ORDER BY ROWID LIMIT ${pageSize} OFFSET ${offset}`;
      const batch = await catalystApp.zcql().executeZCQLQuery(query);
      const rows = batch.map(r => r.BHR);
      if (rows.length === 0) {
        hasMore = false;
        break;
      }
      allLogs.push(...rows);
      offset += pageSize;
      if (rows.length < pageSize) hasMore = false;
      if (allLogs.length > 20000) break;
    }

    // Aggregate per EmployeeID + Date
    allLogs.forEach(r => {
      const dateStr = r.EventTime.split(' ')[0];
      const key = `${r.EmployeeID}_${dateStr}`;
      if (!byKey[key]) {
        byKey[key] = {
          EmployeeID: r.EmployeeID,
          Date: dateStr,
          FirstIN: r.EventTime,
          LastOUT: r.EventTime,
          Source: 'BHR'
        };
      } else {
        if (r.EventTime < byKey[key].FirstIN) byKey[key].FirstIN = r.EventTime;
        if (r.EventTime > byKey[key].LastOUT) byKey[key].LastOUT = r.EventTime;
      }
    });

    // Fetch Attendance table data
    let attOffset = 0;
    let attHasMore = true;
    const attPageSize = 300;
   
    while (attHasMore) {
      let aQuery = `SELECT EmployeeId, AttendanceDate, FirstIn, LastOut FROM Attendance WHERE AttendanceDate >= '${startDate}' AND AttendanceDate <= '${endDateStr}'`;
      if (employeeFilterConditions.length > 0) {
        const attendanceEmployeeFilter = employeeFilterConditions[0].replace('EmployeeID', 'EmployeeId');
        aQuery += ` AND ${attendanceEmployeeFilter}`;
      }
      aQuery += ` ORDER BY EmployeeId, AttendanceDate LIMIT ${attPageSize} OFFSET ${attOffset}`;
      const aBatch = await catalystApp.zcql().executeZCQLQuery(aQuery);
      const aRows = aBatch.map(r => r.Attendance);
      if (aRows.length === 0) {
        attHasMore = false;
        break;
      }
   
      aRows.forEach(r => {
        let dateStr = '';
        if (r.AttendanceDate) {
          if (typeof r.AttendanceDate === 'string') {
            if (/^\d{4}-\d{2}-\d{2}$/.test(r.AttendanceDate)) {
              dateStr = r.AttendanceDate;
            } else {
              const tmp = new Date(r.AttendanceDate);
              if (!isNaN(tmp)) dateStr = tmp.toISOString().slice(0, 10);
            }
          } else {
            const tmp = new Date(r.AttendanceDate);
            if (!isNaN(tmp)) dateStr = tmp.toISOString().slice(0, 10);
          }
        }
        if (!dateStr || dateStr < startDate || dateStr > endDateStr) return;
     
        const key = `${r.EmployeeId}_${dateStr}`;
        if (!byKey[key]) {
          byKey[key] = {
            EmployeeID: r.EmployeeId,
            Date: dateStr,
            FirstIN: r.FirstIn ? `${dateStr} ${r.FirstIn}` : '',
            LastOUT: r.LastOut ? `${dateStr} ${r.LastOut}` : '',
            Source: 'Attendance'
          };
        } else {
          if (r.FirstIn && (!byKey[key].FirstIN || `${dateStr} ${r.FirstIn}` < byKey[key].FirstIN)) {
            byKey[key].FirstIN = `${dateStr} ${r.FirstIn}`;
          }
          if (r.LastOut && (!byKey[key].LastOUT || `${dateStr} ${r.LastOut}` > byKey[key].LastOUT)) {
            byKey[key].LastOUT = `${dateStr} ${r.LastOut}`;
          }
          byKey[key].Source = 'Both';
        }
      });
      attOffset += attPageSize;
      if (aRows.length < attPageSize) attHasMore = false;
    }

    // Calculate OT from byKey (same logic as attendance_muster_function monthlyOvertimeReports)
    const empOvertimeMap = {};
    Object.values(byKey).forEach(rec => {
      if (!rec.FirstIN || !rec.LastOUT) return;
            // Skip OnDuty and CompOff *taken* days only — not CompOffWorkedOn (includes('CompOff') matches wrongly)
      const source = rec.Source || '';
      if (source === 'OnDuty' || source.includes('OnDuty') || sourceHasCompOffTakenSegment(source)) {
        return;
      }
      try {
        const hasShiftInfo = Object.keys(shiftMap).length > 0;
        const isGen = hasShiftInfo ? isGeneralShift(rec.EmployeeID, rec.Date) : false;
        const is1 = hasShiftInfo ? isFirstShift(rec.EmployeeID, rec.Date) : false;
        const is2 = hasShiftInfo ? isSecondShift(rec.EmployeeID, rec.Date) : false;

        let otHours = 0;
        if (isGen) {
          otHours = calculateOvertimeForGeneralShift(rec.LastOUT, rec.Date);
        } else if (is1) {
          otHours = calculateOvertimeForFirstShift(rec.LastOUT, rec.Date);
        } else if (is2) {
          otHours = calculateOvertimeForSecondShift(rec.LastOUT, rec.Date);
        } else {
          if (!hasShiftInfo) {
            otHours = calculateOvertimeForGeneralShift(rec.LastOUT, rec.Date);
          } else {
            const firstInDate = new Date(rec.FirstIN.replace(' ', 'T'));
            const lastOutDate = new Date(rec.LastOUT.replace(' ', 'T'));
            if (!isNaN(firstInDate) && !isNaN(lastOutDate)) {
              const diffMs = lastOutDate - firstInDate;
              if (diffMs > 0) {
                const totalWorkingHours = diffMs / (1000 * 60 * 60);
                if (totalWorkingHours > 8.5) otHours = totalWorkingHours - 8.5;
              }
            }
          }
        }

        const empId = String(rec.EmployeeID || '').trim();
        if (!empId) return;
        if (rec.Date < startDate || rec.Date > endDateStr) return;
        if (!empOvertimeMap[empId]) empOvertimeMap[empId] = { totalOvertimeHours: 0 };
        const overtimeHours = parseFloat(otHours) || 0;
        empOvertimeMap[empId].totalOvertimeHours += overtimeHours;
      } catch (err) {
        console.error('Error calculating OT from byKey record:', err);
      }
    });

    // Convert to otHoursMap (same as monthlyOvertimePreferred)
    for (const empId in empOvertimeMap) {
      otHoursMap[empId] = parseFloat(empOvertimeMap[empId].totalOvertimeHours.toFixed(3));
    }

    console.log(`✅ OT hours calculated from attendance muster logic: ${Object.keys(otHoursMap).length} employees`);
    if (Object.keys(otHoursMap).length > 0) {
      const sampleEntries = Object.entries(otHoursMap).slice(0, 10);
      console.log('Sample OT data (first 10):', sampleEntries.map(([id, hours]) => ({ employeeId: id, otHours: hours.toFixed(3) })));
      const totalOT = Object.values(otHoursMap).reduce((sum, hours) => sum + hours, 0);
      console.log(`Total OT hours across all employees: ${totalOT.toFixed(3)}`);
    } else {
      console.log(`⚠️ No OT hours found for the specified filters.`);
    }

  } catch (err) {
    console.error('❌ Error calculating OT hours from attendance muster:', err.message);
    console.error('Error stack:', err.stack);
  }

  return otHoursMap;
}

// Helper function to fetch OT hours from reports function's monthly-overtime endpoint
async function fetchOTHours(catalystApp, month, contractor, department, employeeId, fromDate, toDate) {
  const otHoursMap = {}; // Map: employeeId -> total OT hours for the month

  try {
    console.log(`=== FETCHING OT HOURS FROM REPORTS FUNCTION ===`);
    console.log(`Month: ${month}, Contractor: ${contractor}, Department: ${department}, EmployeeId: ${employeeId}`);
   
    // Determine date range
    let startDate, endDateStr;
    if (fromDate && toDate) {
      startDate = fromDate;
      endDateStr = toDate;
    } else {
      startDate = `${month}-01`;
      const endDate = new Date(Number(month.split('-')[0]), Number(month.split('-')[1]), 0);
      endDateStr = `${month}-${String(endDate.getDate()).padStart(2, '0')}`;
    }

    // Build query parameters for reports function
    const queryParams = new URLSearchParams();
    queryParams.set('startDate', startDate);
    queryParams.set('endDate', endDateStr);
    if (contractor && contractor !== 'All') {
      queryParams.set('contractor', contractor);
    }
    if (department && department !== 'All') {
      queryParams.set('department', department);
    }
    if (employeeId && employeeId !== 'All') {
      queryParams.set('employeeId', employeeId);
    }
    queryParams.set('source', 'auto');

    // Make HTTP request to reports function's monthly-overtime endpoint
    // Note: In Catalyst, we need to use the internal function URL
    // For now, we'll use a direct approach by calling the reports function logic
    // Since HTTP calls between functions might be complex, we'll replicate the core logic
   
    // Get the reports function's monthly overtime data by calling it directly
    // We'll use the same logic as reports function but simplified
    const zcql = catalystApp.zcql();
   
    // Fetch shift mappings (same as reports function)
    const shiftMap = {};
    try {
      const shiftQuery = `SELECT EmployeeId, AssignedShift, Fromdate, Todate FROM Shiftmap WHERE Fromdate <= '${endDateStr}' AND Todate >= '${startDate}'`;
      const shiftRecords = await zcql.executeZCQLQuery(shiftQuery);
     
      // Map ROWID to EmployeeCode
      const rowIdToCodeMap = {};
      const employeeRowIds = [...new Set(shiftRecords.map(r => String(r.Shiftmap.EmployeeId || '').trim()).filter(Boolean))];
      if (employeeRowIds.length > 0) {
        const empQuery = `SELECT ROWID, EmployeeCode FROM Employee`;
        const empRecords = await zcql.executeZCQLQuery(empQuery);
        for (const empRow of empRecords) {
          const emp = empRow.Employee;
          const rowId = String(emp.ROWID || '').trim();
          const empCode = String(emp.EmployeeCode || '').trim();
          if (rowId && empCode && employeeRowIds.includes(rowId)) {
            rowIdToCodeMap[rowId] = empCode;
          }
        }
      }
     
      // Process shift mappings
      for (const row of shiftRecords) {
        const shift = row.Shiftmap;
        const empRowId = String(shift.EmployeeId || '').trim();
        if (!empRowId) continue;
       
        const empCode = rowIdToCodeMap[empRowId];
        if (!empCode) continue;
       
        const normalizeDate = (dateVal) => {
          if (!dateVal) return '';
          let dateStr = '';
          if (typeof dateVal === 'string') {
            dateStr = String(dateVal).trim();
          } else {
            const d = new Date(dateVal);
            if (!isNaN(d.getTime())) {
              return d.toISOString().slice(0, 10);
            }
            return '';
          }
          if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
            return dateStr;
          }
          const dmyMatch = dateStr.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);
          if (dmyMatch) {
            const [, day, month, year] = dmyMatch;
            return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
          }
          const d = new Date(dateStr);
          if (!isNaN(d.getTime())) {
            return d.toISOString().slice(0, 10);
          }
          return '';
        };
       
        const fromDateShift = normalizeDate(shift.Fromdate);
        const toDateShift = normalizeDate(shift.Todate);
        const assignedShift = String(shift.AssignedShift || '').trim().toUpperCase();
       
        if (!shiftMap[empCode]) {
          shiftMap[empCode] = [];
        }
        shiftMap[empCode].push({
          assignedShift: assignedShift,
          fromdate: fromDateShift,
          todate: toDateShift
        });
      }
    } catch (err) {
      console.log('Shiftmap query error:', err.message);
    }

    // Helper functions for shift detection and OT calculation (same as reports function)
    const isGeneralShift = (empId, dateStr) => {
      if (!shiftMap[empId] || shiftMap[empId].length === 0) return false;
      for (const shift of shiftMap[empId]) {
        if (shift.assignedShift === 'GENERAL' || shift.assignedShift === 'GENERAL SHIFT') {
          if (shift.fromdate && shift.todate) {
            if (dateStr >= shift.fromdate && dateStr <= shift.todate) return true;
          } else if (shift.fromdate && dateStr >= shift.fromdate) return true;
          else if (shift.todate && dateStr <= shift.todate) return true;
        }
      }
      return false;
    };

    const isFirstShift = (empId, dateStr) => {
      if (!shiftMap[empId] || shiftMap[empId].length === 0) return false;
      for (const shift of shiftMap[empId]) {
        const shiftName = shift.assignedShift || '';
        if (shiftName === '1ST' || shiftName === '1ST SHIFT' || shiftName === 'FIRST' ||
            shiftName === 'FIRST SHIFT' || shiftName === '1' || shiftName === 'SHIFT 1') {
          if (shift.fromdate && shift.todate) {
            if (dateStr >= shift.fromdate && dateStr <= shift.todate) return true;
          } else if (shift.fromdate && dateStr >= shift.fromdate) return true;
          else if (shift.todate && dateStr <= shift.todate) return true;
        }
      }
      return false;
    };

    const isSecondShift = (empId, dateStr) => {
      if (!shiftMap[empId] || shiftMap[empId].length === 0) return false;
      for (const shift of shiftMap[empId]) {
        const shiftName = shift.assignedShift || '';
        if (shiftName === '2ND' || shiftName === '2ND SHIFT' || shiftName === 'SECOND' ||
            shiftName === 'SECOND SHIFT' || shiftName === '2' || shiftName === 'SHIFT 2') {
          if (shift.fromdate && shift.todate) {
            if (dateStr >= shift.fromdate && dateStr <= shift.todate) return true;
          } else if (shift.fromdate && dateStr >= shift.fromdate) return true;
          else if (shift.todate && dateStr <= shift.todate) return true;
        }
      }
      return false;
    };

    const parseTimeFromString = (timeStr) => {
      if (!timeStr) return '';
      let timePart = '';
      if (typeof timeStr === 'string') {
        if (timeStr.includes(' ')) {
          const parts = timeStr.split(' ');
          timePart = parts[1] || '00:00:00';
        } else {
          timePart = timeStr;
        }
      } else {
        const d = new Date(timeStr);
        if (!isNaN(d.getTime())) {
          const hours = String(d.getHours()).padStart(2, '0');
          const minutes = String(d.getMinutes()).padStart(2, '0');
          const seconds = String(d.getSeconds()).padStart(2, '0');
          timePart = `${hours}:${minutes}:${seconds}`;
        } else {
          return '';
        }
      }
      if (timePart.split(':').length === 2) {
        timePart += ':00';
      }
      return timePart;
    };

    const lastOutInstantFromStr = (lastOutTimeStr, dateStr) => {
      if (!lastOutTimeStr || !dateStr) return null;
      const s = String(lastOutTimeStr).trim();
      const timePart = parseTimeFromString(lastOutTimeStr);
      if (!timePart) return null;
      if (/^\d{4}-\d{2}-\d{2}\s/.test(s)) {
        const iso = s.length >= 19 ? s.substring(0, 19).replace(' ', 'T') : s.replace(' ', 'T');
        const d = new Date(iso);
        return isNaN(d.getTime()) ? null : d;
      }
      const d = new Date(`${dateStr} ${timePart}`.replace(' ', 'T'));
      return isNaN(d.getTime()) ? null : d;
    };

    // Round checkout DOWN to :00/:30; OT = rounded - shiftEnd (aligned with Monthly OT report).
    const roundLastOutDownToHalfHour = (lastOutDate) => {
      if (!lastOutDate || isNaN(lastOutDate.getTime())) return null;
      const d = new Date(lastOutDate.getTime());
      d.setMinutes(Math.floor(d.getMinutes() / 30) * 30, 0, 0);
      return d;
    };

    const calculateOvertimeAgainstShiftEnd = (lastOutTimeStr, dateStr, shiftEndHms) => {
      if (!lastOutTimeStr || !dateStr || !shiftEndHms) return 0;
      try {
        const lastOutTime = lastOutInstantFromStr(lastOutTimeStr, dateStr);
        if (!lastOutTime) return 0;
        const roundedLastOut = roundLastOutDownToHalfHour(lastOutTime);
        if (!roundedLastOut) return 0;
        const baseTime = new Date(`${dateStr} ${shiftEndHms}`.replace(' ', 'T'));
        if (isNaN(roundedLastOut.getTime()) || isNaN(baseTime.getTime())) return 0;
        if (roundedLastOut > baseTime) {
          const overtimeHours = (roundedLastOut - baseTime) / (1000 * 60 * 60);
          return Math.max(0, parseFloat(overtimeHours.toFixed(3)));
        }
        return 0;
      } catch (error) {
        return 0;
      }
    };

    const calculateOvertimeForGeneralShift = (lastOutTimeStr, dateStr) => {
      return calculateOvertimeAgainstShiftEnd(lastOutTimeStr, dateStr, '17:00:00');
    };

    const calculateOvertimeForFirstShift = (lastOutTimeStr, dateStr) => {
      return calculateOvertimeAgainstShiftEnd(lastOutTimeStr, dateStr, '14:30:00');
    };

    const calculateOvertimeForSecondShift = (lastOutTimeStr, dateStr) => {
      // Shift master 2ND: 08:00-16:30
      return calculateOvertimeAgainstShiftEnd(lastOutTimeStr, dateStr, '16:30:00');
    };

    const calculateHoursFromTimestamps = (firstIn, lastOut) => {
      if (!firstIn || !lastOut) return 0;
      try {
        const firstInTime = new Date(firstIn.replace(' ', 'T'));
        const lastOutTime = new Date(lastOut.replace(' ', 'T'));
        if (isNaN(firstInTime.getTime()) || isNaN(lastOutTime.getTime())) {
          return 0;
        }
        if (lastOutTime < firstInTime) {
          lastOutTime.setDate(lastOutTime.getDate() + 1);
        }
        const diffMs = lastOutTime - firstInTime;
        return diffMs / (1000 * 60 * 60);
      } catch (error) {
        return 0;
      }
    };

    // Fetch attendance data and calculate OT (same logic as reports function)
    let overtimeRecords = [];
   
    // Get employee filter conditions
    // Note: BHR uses EmployeeID (capital ID), Attendance uses EmployeeId (lowercase d)
    let employeeFilterConditions = [];
    if (employeeId && employeeId !== 'All') {
      employeeFilterConditions.push(`EmployeeID = '${employeeId}'`); // BHR uses EmployeeID
    }
   
    if (contractor && contractor !== 'All') {
      try {
        const normalizedContractor = String(contractor || '').replace(/\s+/g, ' ').trim().replace(/'/g, "''");
        const contractorEmployeeQuery = await zcql.executeZCQLQuery(
          `SELECT EmployeeCode FROM Employee WHERE ContractorName LIKE '%${normalizedContractor}%'`
        );
        const normalizedSearch = normalizedContractor.toLowerCase();
        const searchWords = normalizedSearch.split(' ').filter(w => w.length > 2);
        const filteredEmployees = contractorEmployeeQuery.filter(emp => {
          const empContractor = String(emp.Employee?.ContractorName || '').replace(/\s+/g, ' ').trim().toLowerCase();
          if (empContractor === normalizedSearch) return true;
          if (empContractor.includes(normalizedSearch) || normalizedSearch.includes(empContractor)) return true;
          if (searchWords.length > 0) {
            const allKeyWordsMatch = searchWords.every(word => empContractor.includes(word));
            if (allKeyWordsMatch) {
              const firstWord = searchWords[0];
              const empFirstWord = empContractor.split(' ')[0];
              if (empFirstWord && (empFirstWord.startsWith(firstWord) || firstWord.startsWith(empFirstWord))) {
                return true;
              }
            }
          }
          return false;
        });
        if (filteredEmployees && filteredEmployees.length > 0) {
          const contractorEmployeeIds = filteredEmployees.map(emp => emp.Employee.EmployeeCode).filter(Boolean);
          const employeeIdList = contractorEmployeeIds.map(id => `'${id}'`).join(',');
          employeeFilterConditions.push(`EmployeeID IN (${employeeIdList})`); // BHR uses EmployeeID
        }
      } catch (error) {
        console.error('Error applying contractor filter:', error);
      }
    }

    // First, try BHR data (same priority as reports function)
    let bhrRecords = [];
    try {
      let bhrQuery = `SELECT EmployeeID, EventTime FROM BHR WHERE EventTime >= '${startDate} 00:00:00' AND EventTime <= '${endDateStr} 23:59:59'`;
      if (employeeFilterConditions.length > 0) {
        bhrQuery += ` AND (${employeeFilterConditions.join(' OR ')})`;
      }
      bhrQuery += ` ORDER BY EmployeeID, EventTime`;
     
      console.log(`BHR Query for OT: ${bhrQuery.substring(0, 200)}...`);
      bhrRecords = await zcql.executeZCQLQuery(bhrQuery);
      console.log(`Fetched ${bhrRecords.length} BHR records for OT calculation`);
     
      if (bhrRecords.length > 0) {
        // Group BHR by employee and date
        const bhrByEmpDate = {};
        for (const row of bhrRecords) {
          const bhr = row.BHR;
          const empId = String(bhr.EmployeeID || '').trim();
          if (!empId) continue;
         
          const eventTime = bhr.EventTime;
          const dateStr = eventTime ? eventTime.split(' ')[0] : '';
          if (!dateStr || dateStr < startDate || dateStr > endDateStr) continue;
         
          const key = `${empId}_${dateStr}`;
          if (!bhrByEmpDate[key]) {
            bhrByEmpDate[key] = { empId, dateStr, events: [] };
          }
          bhrByEmpDate[key].events.push(eventTime);
        }
       
        // Calculate OT from BHR data
        for (const key in bhrByEmpDate) {
          const { empId, dateStr, events } = bhrByEmpDate[key];
          if (events.length < 2) continue;
         
          // Sort events by time
          events.sort();
          const firstIn = events[0];
          const lastOut = events[events.length - 1];
         
          const totalHours = calculateHoursFromTimestamps(firstIn, lastOut);
          let overtimeHours = 0;

          if (isGeneralShift(empId, dateStr)) {
            overtimeHours = calculateOvertimeForGeneralShift(lastOut, dateStr);
          } else if (isFirstShift(empId, dateStr)) {
            overtimeHours = calculateOvertimeForFirstShift(lastOut, dateStr);
          } else if (isSecondShift(empId, dateStr)) {
            overtimeHours = calculateOvertimeForSecondShift(lastOut, dateStr);
          } else {
            if (totalHours > 8.5) {
              overtimeHours = totalHours - 8.5;
            }
          }

          if (overtimeHours > 0) {
            overtimeRecords.push({
              EmployeeID: empId,
              Date: dateStr,
              OvertimeHours: overtimeHours
            });
          }
        }
      }
    } catch (bhrErr) {
      console.log('BHR query error:', bhrErr.message);
    }

    // If no BHR data or BHR didn't yield results, try Attendance records
    if (overtimeRecords.length === 0) {
      let attendanceQuery = `SELECT EmployeeId, AttendanceDate, FirstIn, LastOut FROM Attendance WHERE AttendanceDate >= '${startDate}' AND AttendanceDate <= '${endDateStr}'`;
      if (employeeFilterConditions.length > 0) {
        attendanceQuery += ` AND (${employeeFilterConditions.join(' OR ')})`;
      }
      attendanceQuery += ` ORDER BY EmployeeId, AttendanceDate`;
     
      const attendanceRecords = await zcql.executeZCQLQuery(attendanceQuery);
      console.log(`Fetched ${attendanceRecords.length} attendance records for OT calculation`);

      // Calculate OT from attendance records
      for (const row of attendanceRecords) {
        const att = row.Attendance;
        const empId = String(att.EmployeeId || '').trim();
        if (!empId || !att.FirstIn || !att.LastOut) continue;
       
        let dateStr = '';
        if (att.AttendanceDate) {
          if (typeof att.AttendanceDate === 'string') {
            if (/^\d{4}-\d{2}-\d{2}$/.test(att.AttendanceDate)) {
              dateStr = att.AttendanceDate;
            } else {
              const tmp = new Date(att.AttendanceDate);
              if (!isNaN(tmp)) dateStr = tmp.toISOString().slice(0, 10);
            }
          } else {
            const tmp = new Date(att.AttendanceDate);
            if (!isNaN(tmp)) dateStr = tmp.toISOString().slice(0, 10);
          }
        }
        if (!dateStr || dateStr < startDate || dateStr > endDateStr) continue;

        const totalHours = calculateHoursFromTimestamps(att.FirstIn, att.LastOut);
        let overtimeHours = 0;

        if (isGeneralShift(empId, dateStr)) {
          overtimeHours = calculateOvertimeForGeneralShift(att.LastOut, dateStr);
        } else if (isFirstShift(empId, dateStr)) {
          overtimeHours = calculateOvertimeForFirstShift(att.LastOut, dateStr);
        } else if (isSecondShift(empId, dateStr)) {
          overtimeHours = calculateOvertimeForSecondShift(att.LastOut, dateStr);
        } else {
          if (totalHours > 8.5) {
            overtimeHours = totalHours - 8.5;
          }
        }

        if (overtimeHours > 0) {
          overtimeRecords.push({
            EmployeeID: empId,
            Date: dateStr,
            OvertimeHours: overtimeHours
          });
        }
      }
    }

    // Aggregate OT hours by employee
    const empOvertimeMap = {};
    for (const row of overtimeRecords) {
      const empId = String(row.EmployeeID);
      const overtimeHours = parseFloat(row.OvertimeHours) || 0;
      if (!empOvertimeMap[empId]) {
        empOvertimeMap[empId] = 0;
      }
      empOvertimeMap[empId] += overtimeHours;
    }

    // Convert to otHoursMap
    for (const empId in empOvertimeMap) {
      otHoursMap[empId] = parseFloat(empOvertimeMap[empId].toFixed(3));
    }

    console.log(`✅ OT hours fetched: ${Object.keys(otHoursMap).length} employees`);
    if (Object.keys(otHoursMap).length > 0) {
      const sampleEntries = Object.entries(otHoursMap).slice(0, 10);
      console.log('Sample OT data (first 10):', sampleEntries.map(([id, hours]) => ({ employeeId: id, otHours: hours.toFixed(3) })));
      const totalOT = Object.values(otHoursMap).reduce((sum, hours) => sum + hours, 0);
      console.log(`Total OT hours across all employees: ${totalOT.toFixed(3)}`);
    } else {
      console.log(`⚠️ No OT hours found for the specified filters. This might be expected if there's no overtime data.`);
      console.log(`   Date range: ${startDate} to ${endDateStr}`);
      console.log(`   Filters: contractor=${contractor}, department=${department}, employeeId=${employeeId}`);
    }

  } catch (err) {
    console.error('❌ Error fetching OT hours:', err.message);
    console.error('Error stack:', err.stack);
    // Return empty map on error so payroll can still proceed
  }

  return otHoursMap;
}

// Helper function to calculate overtime data directly (fallback method)
async function calculateOvertimeDataDirectly(catalystApp, month, contractor, department, employeeId) {
  console.log('=== DIRECT OT CALCULATION FALLBACK ===');
  const monthlyOTData = {};

  try {
    // Build date range for the month
    const startDate = `${month}-01`;
    const endDate = new Date(Number(month.split('-')[0]), Number(month.split('-')[1]), 0);
    const endDateStr = `${month}-${String(endDate.getDate()).padStart(2, '0')}`;

    console.log('Date range for direct OT calculation:', { startDate, endDateStr });

    // Try BHR table first (ESSL server data)
    try {
      console.log('=== CHECKING BHR TABLE FOR DIRECT OT CALCULATION ===');
      let bhrQuery = `
        SELECT EmployeeID, EventTime, DeviceSerial
        FROM BHR
        WHERE EventTime >= '${startDate} 00:00:00' AND EventTime <= '${endDateStr} 23:59:59'
      `;
 
      if (employeeId && employeeId !== 'All') bhrQuery += ` AND EmployeeID = '${employeeId}'`;
      if (contractor && contractor !== 'All') {
        // Get employee codes for this contractor first
        const normalized = String(contractor || '').replace(/\s+/g, ' ').trim().replace(/'/g, "''");
        const empQuery = `SELECT EmployeeCode FROM Employee WHERE ContractorName LIKE '%${normalized}%'`;
        const empRecords = await catalystApp.zcql().executeZCQLQuery(empQuery);
        const empCodes = empRecords.map(row => row.Employee.EmployeeCode).filter(Boolean);
        if (empCodes.length > 0) {
          bhrQuery += ` AND EmployeeID IN (${empCodes.map(code => `'${code}'`).join(',')})`;
        }
      }
 
      bhrQuery += ` ORDER BY EmployeeID, EventTime`;
 
      console.log('BHR query for direct OT:', bhrQuery);
      const bhrRecords = await catalystApp.zcql().executeZCQLQuery(bhrQuery);
      console.log('BHR records found for direct OT:', bhrRecords.length);
 
      if (bhrRecords.length > 0) {
        console.log('Using BHR data for direct overtime calculation');
   
        // Group BHR data by employee and date
        const bhrMap = {};
        for (const row of bhrRecords) {
          const bhr = row.BHR;
          const empId = bhr.EmployeeID;
          const eventTime = bhr.EventTime;
          const dateStr = eventTime.split(' ')[0];
     
          if (!bhrMap[empId]) {
            bhrMap[empId] = {};
          }
          if (!bhrMap[empId][dateStr]) {
            bhrMap[empId][dateStr] = [];
          }
          bhrMap[empId][dateStr].push(eventTime);
        }
   
        // Calculate overtime for each employee
        for (const empId in bhrMap) {
          let totalOvertimeHours = 0;
          let overtimeDays = 0;
     
          for (const dateStr in bhrMap[empId]) {
            const events = bhrMap[empId][dateStr].sort();
            if (events.length >= 2) {
              // Use earliest event as FirstIn and latest event as LastOut
              // Calculate total hours from FirstIn to LastOut
              const firstIn = new Date(events[0]);
              const lastOut = new Date(events[events.length - 1]);
              const totalHours = (lastOut - firstIn) / (1000 * 60 * 60);
         
              // Only include if total hours is above 8.5 hours (8 hours 30 minutes)
              // Calculate overtime (hours beyond 8.5)
              if (totalHours > 8.5) {
                const overtimeHours = totalHours - 8.5;
                totalOvertimeHours += overtimeHours;
                overtimeDays++;
                console.log(`Employee ${empId} on ${dateStr}: ${totalHours.toFixed(2)} total hours, ${overtimeHours.toFixed(2)} overtime hours`);
              }
            }
          }
     
          if (totalOvertimeHours > 0) {
            monthlyOTData[empId] = {
              totalOvertimeHours: totalOvertimeHours,
              overtimeDays: overtimeDays,
              averageOvertimePerDay: overtimeDays > 0 ? totalOvertimeHours / overtimeDays : 0
            };
            console.log(`Employee ${empId}: ${totalOvertimeHours.toFixed(2)} total overtime hours over ${overtimeDays} days`);
          }
        }
      }
    } catch (bhrErr) {
      console.log('BHR table not found or error:', bhrErr.message);
    }

    // If no BHR data, try Attendance table
    if (Object.keys(monthlyOTData).length === 0) {
      try {
        console.log('=== CHECKING ATTENDANCE TABLE FOR DIRECT OT CALCULATION ===');
        let attendanceQuery = `
          SELECT EmployeeId, AttendanceDate, FirstIn, LastOut, Status
          FROM Attendance
          WHERE AttendanceDate >= '${startDate}' AND AttendanceDate <= '${endDateStr}'
        `;
   
        if (employeeId && employeeId !== 'All') attendanceQuery += ` AND EmployeeId = '${employeeId}'`;
        if (contractor && contractor !== 'All') {
          // Get employee codes for this contractor first
        const normalized = String(contractor || '').replace(/\s+/g, ' ').trim().replace(/'/g, "''");
        const empQuery = `SELECT EmployeeCode FROM Employee WHERE ContractorName LIKE '%${normalized}%'`;
          const empRecords = await catalystApp.zcql().executeZCQLQuery(empQuery);
          const empCodes = empRecords.map(row => row.Employee.EmployeeCode).filter(Boolean);
          if (empCodes.length > 0) {
            attendanceQuery += ` AND EmployeeId IN (${empCodes.map(code => `'${code}'`).join(',')})`;
          }
        }
   
        attendanceQuery += ` ORDER BY EmployeeId, AttendanceDate`;
   
        console.log('Attendance query for direct OT:', attendanceQuery);
        const attendanceRecords = await catalystApp.zcql().executeZCQLQuery(attendanceQuery);
        console.log('Attendance records found for direct OT:', attendanceRecords.length);
   
        if (attendanceRecords.length > 0) {
          console.log('Using Attendance data for direct overtime calculation');
     
          // Group attendance data by employee and calculate overtime
          const attendanceMap = {};
          for (const row of attendanceRecords) {
            const attendance = row.Attendance;
            const empId = attendance.EmployeeId;
            const attendanceDate = attendance.AttendanceDate;
            const firstIn = attendance.FirstIn;
            const lastOut = attendance.LastOut;
       
            if (!attendanceMap[empId]) {
              attendanceMap[empId] = {
                totalOvertimeHours: 0,
                overtimeDays: 0
              };
            }
       
            // Calculate overtime if we have both firstIn and lastOut
            // Only include employees working above 8 hours 30 minutes (8.5 hours)
            if (firstIn && lastOut) {
              try {
                // Calculate total hours from FirstIn to LastOut
                const firstInTime = new Date(`${attendanceDate} ${firstIn}`);
                const lastOutTime = new Date(`${attendanceDate} ${lastOut}`);
                const totalHours = (lastOutTime - firstInTime) / (1000 * 60 * 60);
           
                // Only include if total hours is above 8.5 hours (8 hours 30 minutes)
                // Calculate overtime (hours beyond 8.5)
                if (totalHours > 8.5) {
                  const overtimeHours = totalHours - 8.5;
                  attendanceMap[empId].totalOvertimeHours += overtimeHours;
                  attendanceMap[empId].overtimeDays++;
                  console.log(`Employee ${empId} on ${attendanceDate}: ${totalHours.toFixed(2)} total hours, ${overtimeHours.toFixed(2)} overtime hours`);
                }
              } catch (timeErr) {
                console.log(`Error calculating overtime for ${empId} on ${attendanceDate}:`, timeErr.message);
              }
            }
          }
     
          // Convert to monthlyOTData format
          for (const empId in attendanceMap) {
            const data = attendanceMap[empId];
            if (data.totalOvertimeHours > 0) {
              monthlyOTData[empId] = {
                totalOvertimeHours: data.totalOvertimeHours,
                overtimeDays: data.overtimeDays,
                averageOvertimePerDay: data.overtimeDays > 0 ? data.totalOvertimeHours / data.overtimeDays : 0
              };
              console.log(`Employee ${empId}: ${data.totalOvertimeHours.toFixed(2)} total overtime hours over ${data.overtimeDays} days`);
            }
          }
        }
      } catch (attendanceErr) {
        console.log('Attendance table not found or error:', attendanceErr.message);
      }
    }

    console.log('Direct OT calculation completed:', Object.keys(monthlyOTData).length, 'employees with overtime');
    if (Object.keys(monthlyOTData).length > 0) {
      console.log('Direct OT data:', monthlyOTData);
    }

  } catch (err) {
    console.log('Error in direct OT calculation:', err.message);
  }

  return monthlyOTData;
}

const COMPONENTS_TABLE = 'Components';

/**
 * Resolve Data Store table by name (case-insensitive).
 * @returns {{ table: object, meta: object } | null}
 */
async function resolveDatastoreTableByName(catalystApp, wantedName) {
  const want = String(wantedName || '').trim().toLowerCase();
  if (!want) return null;
  const tables = await catalystApp.datastore().getAllTables();
  for (const t of tables) {
    const meta = typeof t.toJSON === 'function' ? t.toJSON() : t._tableDetails;
    const name = String(meta?.table_name || '').trim().toLowerCase();
    if (name === want) {
      const id = meta.table_id;
      const ref = id != null && String(id).length > 0 ? id : meta.table_name;
      return { table: catalystApp.datastore().table(ref), meta };
    }
  }
  return null;
}

/**
 * Payroll "Automatic" mode log table: name Automatic, columns Automatic + Manual + ButtonMonth (text).
 * ButtonMonth stores YYYY-MM; each month has its own mode. Months with no row default to Automatic.
 * Prefer name lookup; then env AUTOMATIC_TABLE_ID; then default id from Cloud Scale schema.
 */
async function getPayrollAutomaticModeTable(catalystApp) {
  const byName = await resolveDatastoreTableByName(catalystApp, 'Automatic');
  if (byName) return byName.table;
  const idCandidates = [process.env.AUTOMATIC_TABLE_ID, '399000000101514'].filter(Boolean);
  for (const rawId of idCandidates) {
    try {
      const details = await catalystApp.datastore().getTableDetails(rawId);
      const meta = typeof details.toJSON === 'function' ? details.toJSON() : details._tableDetails;
      const ref =
        meta && meta.table_id != null && String(meta.table_id).length > 0 ? meta.table_id : rawId;
      return catalystApp.datastore().table(ref);
    } catch (e) {
      console.log(`getPayrollAutomaticModeTable: id ${rawId} failed:`, e.message);
    }
  }
  return null;
}

/** SamplePayroll — manual Excel import target (text columns per Data Store schema). */
async function getSamplePayrollTable(catalystApp) {
  const byName = await resolveDatastoreTableByName(catalystApp, 'SamplePayroll');
  if (byName) return byName.table;
  const idCandidates = [process.env.SAMPLE_PAYROLL_TABLE_ID, '399000000108036'].filter(Boolean);
  for (const rawId of idCandidates) {
    try {
      const details = await catalystApp.datastore().getTableDetails(rawId);
      const meta = typeof details.toJSON === 'function' ? details.toJSON() : details._tableDetails;
      const ref =
        meta && meta.table_id != null && String(meta.table_id).length > 0 ? meta.table_id : rawId;
      return catalystApp.datastore().table(ref);
    } catch (e) {
      console.log(`getSamplePayrollTable: id ${rawId} failed:`, e.message);
    }
  }
  return null;
}

/** Normalize payroll month to YYYY-MM (RunPayroll Month_filter). */
function normalizePayrollMonthFilter(monthStr) {
  if (!monthStr) return '';
  const trimmed = String(monthStr).trim();
  if (/^\d{4}-\d{2}$/.test(trimmed)) return trimmed;
  const ymdMatch = trimmed.match(/^(\d{4})-(\d{2})-\d{2}/);
  if (ymdMatch) return `${ymdMatch[1]}-${ymdMatch[2]}`;
  const date = new Date(trimmed);
  if (!isNaN(date.getTime())) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }
  return trimmed;
}

function runPayrollRowMonthKey(row) {
  const r = row?.RunPayroll ?? row?.runPayroll ?? row;
  if (!r || typeof r !== 'object') return '';
  return normalizePayrollMonthFilter(r.Month_filter ?? r.month_filter ?? r.MonthFilter ?? '');
}

function collectRunPayrollRowIds(rows) {
  const ids = new Set();
  for (const r of rows || []) {
    const rp = r.RunPayroll ?? r.runPayroll ?? r;
    const rid = rp?.ROWID ?? r?.ROWID;
    if (rid != null) ids.add(rid);
  }
  return ids;
}

function runPayrollWrapRecord(rec) {
  return rec?.RunPayroll ?? rec?.runPayroll ?? rec;
}

function runPayrollRowIdNumeric(rec) {
  const rp = runPayrollWrapRecord(rec);
  const rid = rp?.ROWID ?? rec?.ROWID;
  const n = Number(rid);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function employeeCodeNormFromRunPayrollRec(rec) {
  const rp = runPayrollWrapRecord(rec);
  const code = String(rp?.EmployeeCode ?? rp?.employeeCode ?? '').trim();
  if (!code) return '';
  return normalizeEmployeeCode(code) || code;
}

/** Net Pay from Payroll table row (stored NetPay, else Earned Gross − Total Deduction). */
function payrollRowNetPayFromFields(p) {
  if (!p || typeof p !== 'object') return null;
  const raw = p.NetPay ?? p.netPay ?? p.netpay ?? p.NETPAY;
  if (raw != null && String(raw).trim() !== '') {
    const n = parseFloat(String(raw).replace(/,/g, '').trim());
    if (Number.isFinite(n)) return Math.round(n);
  }
  const egs = parseFloat(
    String(
      p.EarnedSalaryCross ??
        p.earnedSalaryCross ??
        p.EarnedGrossSalary ??
        p.earnedGrossSalary ??
        ''
    ).replace(/,/g, '')
  );
  const td = parseFloat(String(p.TotalDeduction ?? p.totalDeduction ?? '').replace(/,/g, ''));
  if (Number.isFinite(egs) && Number.isFinite(td)) return Math.round(egs - td);
  return null;
}

function runPayrollRowNetPayFromFields(r) {
  if (!r || typeof r !== 'object') return null;
  const egs = parseFloat(
    String(
      r.EarnedSalaryCross ??
        r.earnedSalaryCross ??
        r.EarnedGrossSalary ??
        r.earnedGrossSalary ??
        ''
    ).replace(/,/g, '')
  );
  const td = parseFloat(String(r.TotalDeduction ?? r.totalDeduction ?? '').replace(/,/g, ''));
  if (Number.isFinite(egs) && Number.isFinite(td)) return Math.round(egs - td);
  const raw = r.NetPay ?? r.netPay ?? r.netpay ?? r.NETPAY;
  if (raw != null && String(raw).trim() !== '') {
    const n = parseFloat(String(raw).replace(/,/g, '').trim());
    if (Number.isFinite(n)) return Math.round(n);
  }
  return null;
}

function scoreRunPayrollKeeperRow(rec, payrollNetForEmp) {
  const rp = runPayrollWrapRecord(rec);
  const rid = runPayrollRowIdNumeric(rec) ?? -1;
  const runNet = runPayrollRowNetPayFromFields(rp);
  const matches =
    payrollNetForEmp != null &&
    Number.isFinite(runNet) &&
    Math.round(runNet) === Math.round(payrollNetForEmp);
  return (matches ? 1e15 : 0) + Math.max(0, rid);
}

/** Latest Payroll row per employee for a month (Payroll table = source of truth for Net Pay). */
async function loadPayrollRecordsMapForMonth(catalystApp, month) {
  const monthNorm = normalizePayrollMonthFilter(month);
  const map = new Map();
  if (!monthNorm) return map;
  const byRid = new Map();

  try {
    const payrollTable = catalystApp.datastore().table('Payroll');
    const all = await payrollTable.getAllRows();
    for (const rec of all || []) {
      const p = rec.Payroll ?? rec.payroll ?? rec;
      if (!p || typeof p !== 'object') continue;
      const mf = normalizePayrollMonthFilter(p.Month_filter ?? p.month_filter ?? p.MonthFilter ?? '');
      if (mf !== monthNorm) continue;
      const code = String(p.EmployeeCode ?? p.employeeCode ?? '').trim();
      const norm = normalizeEmployeeCode(code) || code;
      if (!norm) continue;
      const rid = Number(p.ROWID ?? rec.ROWID ?? 0);
      const key = Number.isFinite(rid) && rid > 0 ? `rid:${rid}` : `ds:${norm}:${byRid.size}`;
      byRid.set(key, p);
    }
  } catch (e) {
    console.log('loadPayrollRecordsMapForMonth: datastore failed:', e.message);
  }

  try {
    const monthEscaped = monthNorm.replace(/'/g, "''");
    const zcqlRows = await catalystApp
      .zcql()
      .executeZCQLQuery(
        `SELECT * FROM Payroll WHERE Month_filter = '${monthEscaped}' ORDER BY ROWID DESC`
      );
    for (const rec of zcqlRows || []) {
      const p = rec.Payroll ?? rec.payroll ?? rec;
      if (!p || typeof p !== 'object') continue;
      const rid = Number(p.ROWID ?? rec.ROWID ?? 0);
      const key = Number.isFinite(rid) && rid > 0 ? `rid:${rid}` : null;
      if (key && !byRid.has(key)) byRid.set(key, p);
      else if (!key) {
        const code = String(p.EmployeeCode ?? p.employeeCode ?? '').trim();
        byRid.set(`zcql:${normalizeEmployeeCode(code) || code}:${byRid.size}`, p);
      }
    }
  } catch (e) {
    console.log('loadPayrollRecordsMapForMonth: ZCQL failed:', e.message);
  }

  for (const p of byRid.values()) {
    const code = String(p.EmployeeCode ?? p.employeeCode ?? '').trim();
    const norm = normalizeEmployeeCode(code) || code;
    if (!norm) continue;
    const rid = Number(p.ROWID ?? 0);
    const prev = map.get(norm);
    const prevRid = prev ? Number(prev.ROWID ?? -1) : -1;
    if (!prev || (Number.isFinite(rid) && rid > prevRid)) {
      map.set(norm, p);
    }
  }
  return map;
}

/** Employee Date of Joining for calcAttendanceBonus when Payroll row has no AttendanceBonus saved. */
async function loadEmployeeDateOfJoiningMap(catalystApp) {
  const map = new Map();
  try {
    const empTable = catalystApp.datastore().table('Employee');
    const all = await empTable.getAllRows();
    for (const e of all || []) {
      const code = String(e.EmployeeCode ?? e.employeeCode ?? '').trim();
      if (!code) continue;
      const doj = e.DateofJoining ?? e.DateOfJoining ?? e.dateOfJoining ?? e.date_of_joining ?? '';
      for (const k of [code, normalizeEmployeeCode(code), String(parseInt(code, 10))]) {
        if (k && k !== 'NaN') map.set(String(k), doj);
      }
    }
  } catch (e) {
    console.log('loadEmployeeDateOfJoiningMap failed:', e.message);
  }
  return map;
}

function lookupEmployeeDateOfJoining(dojMap, record) {
  if (!dojMap) {
    return (
      pickPayrollField(record, 'dateOfJoining', 'DateofJoining', 'DateOfJoining', 'date_of_joining') ||
      ''
    );
  }
  const code = String(pickPayrollField(record, 'employeeCode', 'EmployeeCode') ?? '').trim();
  const norm = normalizeEmployeeCode(code) || code;
  return (
    pickPayrollField(record, 'dateOfJoining', 'DateofJoining', 'DateOfJoining', 'date_of_joining') ||
    dojMap.get(code) ||
    dojMap.get(norm) ||
    dojMap.get(String(parseInt(code, 10))) ||
    ''
  );
}

/**
 * Attendance Bonus for RunPayroll — same rule as Payroll grid (getAttendanceBonusNumericForRow):
 * calc from DOJ + days when possible; else use saved Payroll.AttendanceBonus.
 */
function resolveRunPayrollAttendanceBonus(record, month, dojMap) {
  const monthNorm = normalizePayrollMonthFilter(
    month || pickPayrollField(record, 'Month_filter', 'month_filter', 'MonthFilter') || ''
  );
  const doj = lookupEmployeeDateOfJoining(dojMap, record);
  const dp = Number(pickPayrollField(record, 'daysPresent', 'DaysPresent')) || 0;
  const dim = Number(pickPayrollField(record, 'daysInMonth', 'DaysInMonth')) || 0;

  if (doj && dim > 0 && monthNorm) {
    if (Number(dp) === Number(dim)) return 0;
    const dojDate = new Date(doj);
    if (!isNaN(dojDate.getTime())) {
      return calcAttendanceBonus(doj, dp, dim, monthNorm);
    }
  }

  const savedRaw = pickPayrollField(record, 'attendanceBonus', 'AttendanceBonus');
  if (savedRaw != null && savedRaw !== undefined && String(savedRaw).trim() !== '') {
    const saved = Math.round(Number(savedRaw));
    if (Number.isFinite(saved)) return Math.max(0, saved);
  }
  return calcAttendanceBonus(doj, dp, dim, monthNorm);
}

/** Attendance amount counted once in RunPayroll Total Deduction — Attendance Deduction or Bonus only (not Late). */
function resolveRunPayrollSingleAttendanceForTotalDeduction(record, month, dojMap) {
  const savedAttDedRaw = pickPayrollField(record, 'attendanceDeduction', 'AttendanceDeduction');
  if (savedAttDedRaw != null && savedAttDedRaw !== undefined && String(savedAttDedRaw).trim() !== '') {
    const attDed = Math.round(Number(savedAttDedRaw));
    if (Number.isFinite(attDed) && attDed > 0) return attDed;
  }
  const ab = resolveRunPayrollAttendanceBonus(record, month, dojMap);
  return ab > 0 ? ab : 0;
}

/** Sum standard Payroll deductions excluding Attendance Bonus / Attendance Deduction. */
function runPayrollDeductionComponentSumExcludingAttendance(record) {
  const n = (...keys) => {
    const raw = pickPayrollField(record, ...keys);
    if (raw == null || String(raw).trim() === '') return 0;
    const v = Math.round(Number(raw));
    return Number.isFinite(v) ? Math.max(0, v) : 0;
  };
  return (
    n('pf', 'PF') +
    n('esi', 'ESI') +
    n('late', 'Late') +
    n('lwf', 'LWF') +
    n('pt', 'PT') +
    n('rent', 'Rent') +
    n('otherDeduction', 'OtherDeduction') +
    n('loanAllowance', 'LoanAllowance', 'Loan')
  );
}

/**
 * RunPayroll Total Deduction — include Attendance Bonus OR Attendance Deduction once, never both.
 * Ensures AttendanceBonus on the row is reflected in Total Deduction when not already included.
 */
function runPayrollTotalDeductionIncludingAttendanceBonus(record, month, dojMap) {
  const rawTd = Math.round(Number(pickPayrollField(record, 'totalDeduction', 'TotalDeduction')) || 0);
  const attOnce = resolveRunPayrollSingleAttendanceForTotalDeduction(record, month, dojMap);

  if (attOnce <= 0) return rawTd;

  const savedAttDedRaw = pickPayrollField(record, 'attendanceDeduction', 'AttendanceDeduction');
  const savedAttDed =
    savedAttDedRaw != null && String(savedAttDedRaw).trim() !== ''
      ? Math.round(Number(savedAttDedRaw)) || 0
      : 0;

  const compBase = runPayrollDeductionComponentSumExcludingAttendance(record);
  const expectedWithAtt =
    compBase > 0 ? compBase + attOnce : rawTd > attOnce ? rawTd : rawTd + attOnce;

  // Payroll Total Deduction already matches base deductions + attendance once.
  if (compBase > 0 && Math.abs(rawTd - expectedWithAtt) <= 2) return rawTd;
  if (compBase > 0 && Math.abs(rawTd - compBase) <= 2) return expectedWithAtt;
  if (savedAttDed > 0 && rawTd >= savedAttDed) {
    const impliedBase = rawTd - savedAttDed;
    if (impliedBase > 0 && compBase > 0 && Math.abs(impliedBase - compBase) <= 5) return rawTd;
  }
  if (compBase <= 0 && rawTd > attOnce && rawTd - attOnce >= attOnce) return rawTd;
  if (rawTd > expectedWithAtt) return rawTd;

  return expectedWithAtt;
}

/** Attendance Deduction on RunPayroll — saved Attendance Deduction or computed Attendance Bonus only (never Late). */
function runPayrollAttendanceDeductionFromPayrollRecord(record, month, dojMap) {
  const savedAttDedRaw = pickPayrollField(record, 'attendanceDeduction', 'AttendanceDeduction');
  if (savedAttDedRaw != null && savedAttDedRaw !== undefined && String(savedAttDedRaw).trim() !== '') {
    const attDed = Math.round(Number(savedAttDedRaw));
    if (Number.isFinite(attDed)) return Math.max(0, attDed);
  }
  const ab = resolveRunPayrollAttendanceBonus(record, month, dojMap);
  return ab > 0 ? ab : 0;
}

/** RunPayroll Net Pay = Earned Gross Salary (EarnedSalaryCross) − Total Deduction. */
function runPayrollNetPayFromEarnedGrossMinusTotalDeduction(record, month, dojMap, totalDeductionOverride) {
  const egs = Math.round(
    Number(
      pickPayrollField(
        record,
        'earnedSalaryCross',
        'EarnedSalaryCross',
        'earnedGrossSalary',
        'EarnedGrossSalary'
      )
    ) || 0
  );
  const td =
    totalDeductionOverride != null && Number.isFinite(Number(totalDeductionOverride))
      ? Math.round(Number(totalDeductionOverride))
      : runPayrollTotalDeductionIncludingAttendanceBonus(record, month, dojMap);
  if (Number.isFinite(egs)) return Math.round(egs - td);
  const stored = pickPayrollField(record, 'netPay', 'NetPay', 'netpay');
  if (stored != null && String(stored).trim() !== '') {
    const n = Math.round(Number(stored));
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function enrichPayrollRecordForRunPayroll(record, monthNorm, dojMap, payrollTableRow) {
  const merged = payrollTableRow ? Object.assign({}, payrollTableRow, record) : Object.assign({}, record);
  const ab = resolveRunPayrollAttendanceBonus(merged, monthNorm, dojMap);
  const td = runPayrollTotalDeductionIncludingAttendanceBonus(merged, monthNorm, dojMap);
  const attDed = runPayrollAttendanceDeductionFromPayrollRecord(merged, monthNorm, dojMap);
  const netPay = runPayrollNetPayFromEarnedGrossMinusTotalDeduction(merged, monthNorm, dojMap, td);
  merged.attendanceBonus = ab;
  merged.AttendanceBonus = ab;
  merged.totalDeduction = td;
  merged.TotalDeduction = td;
  merged.attendanceDeduction = attDed;
  merged.AttendanceDeduction = attDed;
  merged.netPay = netPay;
  merged.NetPay = netPay;
  return merged;
}

/** ZCQL + Data Store load for one payroll month (merged — ZCQL alone often misses rows). */
async function loadRunPayrollRecordsForMonth(catalystApp, runTable, month) {
  const monthNorm = normalizePayrollMonthFilter(month);
  if (!monthNorm) return { monthNorm: '', rows: [] };
  const byRid = new Map();

  if (runTable) {
    try {
      const allRun = await runTable.getAllRows();
      for (const rec of allRun || []) {
        if (runPayrollRowMonthKey(rec) !== monthNorm) continue;
        const rp = runPayrollWrapRecord(rec);
        const rid = rp?.ROWID ?? rec?.ROWID;
        const key = rid != null ? `rid:${rid}` : `ds:${employeeCodeNormFromRunPayrollRec(rec)}:${byRid.size}`;
        byRid.set(key, rec);
      }
    } catch (e) {
      console.log('loadRunPayrollRecordsForMonth: datastore failed:', e.message);
    }
  }

  try {
    const monthEscaped = monthNorm.replace(/'/g, "''");
    const zcqlRows = await catalystApp
      .zcql()
      .executeZCQLQuery(
        `SELECT * FROM RunPayroll WHERE Month_filter = '${monthEscaped}' ORDER BY ROWID DESC`
      );
    for (const rec of zcqlRows || []) {
      const rp = runPayrollWrapRecord(rec);
      const rid = rp?.ROWID ?? rec?.ROWID;
      const key = rid != null ? `rid:${rid}` : `zcql:${employeeCodeNormFromRunPayrollRec(rec)}:${byRid.size}`;
      if (!byRid.has(key)) byRid.set(key, rec);
    }
  } catch (e) {
    console.log('loadRunPayrollRecordsForMonth: ZCQL failed:', e.message);
  }

  const rows = [...byRid.values()];
  rows.sort((a, b) => (runPayrollRowIdNumeric(b) ?? -1) - (runPayrollRowIdNumeric(a) ?? -1));
  return { monthNorm, rows };
}

function employeeCodeLookupVariants(code) {
  const raw = String(code ?? '').trim();
  if (!raw) return [];
  const norm = normalizeEmployeeCode(raw) || raw;
  const variants = new Set([raw, norm]);
  if (norm !== `${norm}.0`) variants.add(`${norm}.0`);
  if (raw !== norm) variants.add(raw.replace(/^0+(?=\d)/, ''));
  return [...variants].filter(Boolean);
}

/**
 * Remove existing RunPayroll rows for a payroll month so re-run replaces the snapshot.
 * Uses ZCQL and Data Store fallback (ZCQL alone often misses rows).
 */
async function deleteRunPayrollRowsForMonth(catalystApp, runTable, month) {
  const monthNorm = normalizePayrollMonthFilter(month);
  if (!monthNorm) return 0;
  const rowIds = new Set();

  try {
    const allRun = await runTable.getAllRows();
    for (const rec of allRun || []) {
      if (runPayrollRowMonthKey(rec) === monthNorm) {
        const rp = runPayrollWrapRecord(rec);
        if (rp?.ROWID != null) rowIds.add(rp.ROWID);
      }
    }
  } catch (dsErr) {
    console.log('deleteRunPayrollRowsForMonth: datastore scan failed:', dsErr.message);
  }

  try {
    const monthEscaped = monthNorm.replace(/'/g, "''");
    const q = `SELECT ROWID FROM RunPayroll WHERE Month_filter = '${monthEscaped}'`;
    for (const rid of collectRunPayrollRowIds(await catalystApp.zcql().executeZCQLQuery(q))) {
      rowIds.add(rid);
    }
  } catch (e) {
    console.log('deleteRunPayrollRowsForMonth: ZCQL delete-select failed:', e.message);
  }

  let deleted = 0;
  for (const rid of rowIds) {
    try {
      await runTable.deleteRow({ ROWID: rid });
      deleted++;
    } catch (delErr) {
      console.warn(`deleteRunPayrollRowsForMonth: delete ROWID ${rid} failed:`, delErr?.message || delErr);
    }
  }
  if (deleted > 0) {
    console.log(`RunPayroll: removed ${deleted} existing row(s) for Month_filter=${monthNorm}`);
  }
  return deleted;
}

/** Remove rows for one employee + month before insert (prevents duplicate snapshots). */
async function deleteRunPayrollRowsForEmployeeMonth(catalystApp, runTable, month, employeeCode) {
  const monthNorm = normalizePayrollMonthFilter(month);
  const empRaw = String(employeeCode ?? '').trim();
  if (!monthNorm || !empRaw) return 0;
  const empNorm = normalizeEmployeeCode(empRaw) || empRaw;
  const rowIds = new Set();

  try {
    const allRun = await runTable.getAllRows();
    for (const rec of allRun || []) {
      const rp = runPayrollWrapRecord(rec);
      if (!rp) continue;
      const mf = runPayrollRowMonthKey(rec);
      const code = String(rp.EmployeeCode ?? rp.employeeCode ?? '').trim();
      const codeNorm = normalizeEmployeeCode(code) || code;
      if (mf === monthNorm && (code === empRaw || codeNorm === empNorm)) {
        if (rp.ROWID != null) rowIds.add(rp.ROWID);
      }
    }
  } catch (e) {
    console.log(`deleteRunPayrollRowsForEmployeeMonth: datastore scan failed for ${empRaw}:`, e.message);
  }

  for (const codeVariant of employeeCodeLookupVariants(employeeCode)) {
    const empEsc = String(codeVariant).replace(/'/g, "''");
    try {
      const q = `SELECT ROWID FROM RunPayroll WHERE Month_filter = '${monthNorm.replace(/'/g, "''")}' AND EmployeeCode = '${empEsc}'`;
      for (const rid of collectRunPayrollRowIds(await catalystApp.zcql().executeZCQLQuery(q))) {
        rowIds.add(rid);
      }
    } catch (e) {
      console.log(`deleteRunPayrollRowsForEmployeeMonth: ZCQL failed for ${empEsc}:`, e.message);
    }
  }
  let deleted = 0;
  for (const rid of rowIds) {
    try {
      await runTable.deleteRow({ ROWID: rid });
      deleted++;
    } catch (delErr) {
      console.warn(`deleteRunPayrollRowsForEmployeeMonth: delete ROWID ${rid} failed:`, delErr?.message || delErr);
    }
  }
  return deleted;
}

/**
 * Keep one RunPayroll row per employee for a month.
 * When duplicates exist, keep the row whose NetPay matches the Payroll table (not just highest ROWID).
 */
async function dedupeRunPayrollRowsForMonth(catalystApp, runTable, month) {
  const { monthNorm, rows } = await loadRunPayrollRecordsForMonth(catalystApp, runTable, month);
  if (!monthNorm || !rows.length) return 0;

  const payrollMap = await loadPayrollRecordsMapForMonth(catalystApp, monthNorm);
  const byEmp = new Map();
  for (const rec of rows) {
    const norm = employeeCodeNormFromRunPayrollRec(rec);
    if (!norm) continue;
    if (!byEmp.has(norm)) byEmp.set(norm, []);
    byEmp.get(norm).push(rec);
  }

  let removed = 0;
  for (const [norm, group] of byEmp) {
    if (group.length <= 1) continue;
    const payrollRow = payrollMap.get(norm);
    const payrollNet = payrollRow ? payrollRowNetPayFromFields(payrollRow) : null;
    group.sort(
      (a, b) => scoreRunPayrollKeeperRow(b, payrollNet) - scoreRunPayrollKeeperRow(a, payrollNet)
    );
    const keeperRp = runPayrollWrapRecord(group[0]);
    const keeperRid = keeperRp?.ROWID ?? group[0]?.ROWID;
    for (let i = 1; i < group.length; i++) {
      const rp = runPayrollWrapRecord(group[i]);
      const rid = rp?.ROWID ?? group[i]?.ROWID;
      if (rid == null || rid === keeperRid) continue;
      try {
        await runTable.deleteRow({ ROWID: rid });
        removed++;
      } catch (e) {
        console.warn(`dedupeRunPayrollRowsForMonth: delete ROWID ${rid} failed:`, e?.message || e);
      }
    }
  }
  if (removed > 0) {
    console.log(`RunPayroll: deduped ${removed} duplicate row(s) for Month_filter=${monthNorm}`);
  }
  return removed;
}

/**
 * Set RunPayroll NetPay (and related fields) from the Payroll table for each employee in the month.
 */
async function alignRunPayrollRowsWithPayrollTable(catalystApp, runTable, month) {
  const monthNorm = normalizePayrollMonthFilter(month);
  if (!monthNorm || !runTable) return { updated: 0, aligned: 0, skipped: 0 };

  await dedupeRunPayrollRowsForMonth(catalystApp, runTable, monthNorm);
  const payrollMap = await loadPayrollRecordsMapForMonth(catalystApp, monthNorm);
  const dojMap = await loadEmployeeDateOfJoiningMap(catalystApp);
  const { rows } = await loadRunPayrollRecordsForMonth(catalystApp, runTable, monthNorm);

  let updated = 0;
  let aligned = 0;
  let skipped = 0;

  for (const rec of rows) {
    const rp = runPayrollWrapRecord(rec);
    const norm = employeeCodeNormFromRunPayrollRec(rec);
    const rid = rp?.ROWID ?? rec?.ROWID;
    if (!norm || rid == null) {
      skipped++;
      continue;
    }
    const payrollRowRaw = payrollMap.get(norm);
    if (!payrollRowRaw) {
      skipped++;
      continue;
    }
    const payrollRow = enrichPayrollRecordForRunPayroll(
      payrollRowRaw,
      monthNorm,
      dojMap,
      payrollRowRaw
    );

    const patch = buildRunPayrollAlignPatchFromPayrollRow(
      payrollRow,
      rp,
      monthNorm,
      dojMap
    );

    if (Object.keys(patch).length === 0) {
      aligned++;
      continue;
    }
    try {
      await runTable.updateRow({ ROWID: rid, ...patch });
      updated++;
      aligned++;
      console.log(
        `RunPayroll align: employee ${norm} ROWID ${rid} patched ${Object.keys(patch).join(', ')}`
      );
    } catch (e) {
      console.warn(`alignRunPayrollRowsWithPayrollTable: update ROWID ${rid} failed:`, e?.message || e);
      skipped++;
    }
  }

  if (updated > 0) {
    console.log(
      `RunPayroll: aligned ${updated} row(s) with Payroll table NetPay for Month_filter=${monthNorm}`
    );
  }
  return { updated, aligned, skipped, payrollEmployees: payrollMap.size };
}

/** Payroll → RunPayroll fields kept in sync (Net Pay, deductions, allowances). */
const RUNPAYROLL_ALIGN_FROM_PAYROLL_FIELDS = [
  'NetPay',
  'EarnedSalaryCross',
  'TotalDeduction',
  'AttendanceBonus',
  'AttendanceDeduction',
  'EarnedBasic',
  'EarnedHRA',
  'EarnedDA',
  'EarnedSpecialAllowance',
  'PF',
  'ESI',
  'OTAmount',
  'Rent',
  'Advance',
  'Bonus',
  'FoodAllowance',
  'WashingAllowance',
  'UniformAllowance',
  'LoanAllowance',
  'Incentive',
  'OtherDeduction',
  'PT',
  'LWF',
  'LOP',
  'LOH',
  'DaysPresent',
  'DaysInMonth',
  'TravelChargers',
  'SpecialAllowance'
];

function payrollAlignNumStr(val) {
  if (val == null || String(val).trim() === '') return null;
  const n = parseFloat(String(val).replace(/,/g, '').trim());
  if (!Number.isFinite(n)) return null;
  return String(Math.round(n));
}

function buildRunPayrollAlignPatchFromPayrollRow(payrollRow, runRow, month, dojMap) {
  if (!payrollRow || typeof payrollRow !== 'object') return {};
  const monthNorm = normalizePayrollMonthFilter(
    month || pickPayrollField(payrollRow, 'Month_filter', 'month_filter', 'MonthFilter') || ''
  );
  const patch = {};

  const abResolved = resolveRunPayrollAttendanceBonus(payrollRow, monthNorm, dojMap);
  const abStr = String(Math.max(0, abResolved));
  const runAb = payrollAlignNumStr(runRow?.AttendanceBonus ?? runRow?.attendanceBonus);
  if (runAb !== abStr) patch.AttendanceBonus = abStr;

  const tdRun = runPayrollTotalDeductionIncludingAttendanceBonus(payrollRow, monthNorm, dojMap);
  const tdStr = String(tdRun);
  const runTdStr = payrollAlignNumStr(runRow?.TotalDeduction ?? runRow?.totalDeduction);
  if (runTdStr !== tdStr) patch.TotalDeduction = tdStr;

  const attDedTarget = runPayrollAttendanceDeductionFromPayrollRecord(payrollRow, monthNorm, dojMap);
  const attDedStr = String(Math.max(0, attDedTarget));
  const runAttDed = payrollAlignNumStr(runRow?.AttendanceDeduction ?? runRow?.attendanceDeduction);
  if (runAttDed !== attDedStr) patch.AttendanceDeduction = attDedStr;

  const netPayRun = runPayrollNetPayFromEarnedGrossMinusTotalDeduction(
    payrollRow,
    monthNorm,
    dojMap,
    tdRun
  );
  const netPayStr = String(netPayRun);
  const runNetStr = payrollAlignNumStr(runRow?.NetPay ?? runRow?.netPay);
  if (runNetStr !== netPayStr) patch.NetPay = netPayStr;

  for (const col of RUNPAYROLL_ALIGN_FROM_PAYROLL_FIELDS) {
    if (
      col === 'TotalDeduction' ||
      col === 'AttendanceDeduction' ||
      col === 'AttendanceBonus' ||
      col === 'NetPay'
    )
      continue;
    const camel = col.charAt(0).toLowerCase() + col.slice(1);
    const payStr = payrollAlignNumStr(payrollRow[col] ?? payrollRow[camel]);
    if (payStr == null) continue;
    const runStr = payrollAlignNumStr(runRow?.[col] ?? runRow?.[camel]);
    if (runStr !== payStr) patch[col] = payStr;
  }
  return patch;
}

/** Dedupe every month present in RunPayroll (one-time cleanup). */
async function dedupeAllRunPayrollMonths(catalystApp, runTable) {
  const months = new Set();
  try {
    const allRun = await runTable.getAllRows();
    for (const rec of allRun || []) {
      const mf = runPayrollRowMonthKey(rec);
      if (mf) months.add(mf);
    }
  } catch (e) {
    console.log('dedupeAllRunPayrollMonths: list months failed:', e.message);
    return { totalRemoved: 0, byMonth: {}, monthsProcessed: 0 };
  }
  let totalRemoved = 0;
  const byMonth = {};
  for (const m of months) {
    const removed = await dedupeRunPayrollRowsForMonth(catalystApp, runTable, m);
    if (removed > 0) byMonth[m] = removed;
    totalRemoved += removed;
  }
  return { totalRemoved, byMonth, monthsProcessed: months.size };
}

async function countRunPayrollRowsForMonth(catalystApp, runTable, month) {
  const { rows } = await loadRunPayrollRecordsForMonth(catalystApp, runTable, month);
  return rows.length;
}

/** Parse numeric for RunPayroll API row (ZCQL / Data Store). */
function toNumRunPayrollSnapshot(val) {
  if (val === null || val === undefined) return NaN;
  const s = String(val).replace(/,/g, '').trim();
  if (s === '') return NaN;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Latest RunPayroll row per employee for a month (same logic as bank-format-report).
 * Returns plain objects for GET /run-payroll-table.
 */
async function fetchRunPayrollTableSnapshotForMonth(catalystApp, monthParam, runTableOptional) {
  const monthEscaped = String(monthParam || '').replace(/'/g, "''").trim();
  if (!monthEscaped || !/^\d{4}-\d{2}$/.test(monthEscaped)) return [];
  let runTable = runTableOptional;
  if (!runTable) {
    try {
      runTable = catalystApp.datastore().table('RunPayroll');
    } catch (_) {
      runTable = null;
    }
  }
  const { rows: runPayrollRows } = await loadRunPayrollRecordsForMonth(
    catalystApp,
    runTable,
    monthParam
  );
  const payrollMap = await loadPayrollRecordsMapForMonth(catalystApp, monthParam);
  const bestRunByEmp = new Map();
  for (const rec of runPayrollRows || []) {
    const r = runPayrollWrapRecord(rec);
    const empCodeRun = String(r.EmployeeCode ?? r.employeeCode ?? '').trim();
    if (!empCodeRun) continue;
    const empKey = normalizeEmployeeCode(empCodeRun) || empCodeRun;
    const payrollRow = payrollMap.get(empKey);
    const payrollNet = payrollRow ? payrollRowNetPayFromFields(payrollRow) : null;
    const existingRun = bestRunByEmp.get(empKey);
    const candScore = scoreRunPayrollKeeperRow(rec, payrollNet);
    const existScore = existingRun
      ? scoreRunPayrollKeeperRow({ RunPayroll: existingRun }, payrollNet)
      : -1;
    if (!existingRun || candScore > existScore) {
      bestRunByEmp.set(empKey, r);
    }
  }
  const pickEg = (r) => {
    const n = toNumRunPayrollSnapshot(
      r.EarnedSalaryGross ??
        r.earnedSalaryGross ??
        r.EarnedSalaryCross ??
        r.earnedSalaryCross ??
        r.EarnedGrossSalary ??
        r.earnedGrossSalary
    );
    return Number.isFinite(n) ? n : null;
  };
  const pickNp = (r) => {
    const n = toNumRunPayrollSnapshot(r.NetPay ?? r.netPay ?? r.NETPAY ?? r.Netpay ?? r.netpay);
    return Number.isFinite(n) ? n : null;
  };
  const data = [];
  for (const [empKey, r] of bestRunByEmp) {
    const empCode = String(r.EmployeeCode ?? r.employeeCode ?? empKey).trim();
    if (!empCode) continue;
    const payrollRow = payrollMap.get(empKey);
    const payrollNet = payrollRow ? payrollRowNetPayFromFields(payrollRow) : null;
    const earnedSalaryGross = pickEg(r);
    const netPayStored = pickNp(r);
    const td = toNumRunPayrollSnapshot(r.TotalDeduction ?? r.totalDeduction);
    const netPay =
      earnedSalaryGross != null &&
      Number.isFinite(td) &&
      Number.isFinite(earnedSalaryGross)
        ? Math.round(earnedSalaryGross - td)
        : payrollNet != null && Number.isFinite(payrollNet)
          ? payrollNet
          : netPayStored != null && Number.isFinite(netPayStored)
            ? netPayStored
            : null;
    data.push({
      employeeCode: empCode,
      earnedSalaryGross,
      netPay,
      totalDeduction: Number.isFinite(td) ? td : null,
      hasStoredNetPay:
        payrollNet != null ||
        ((r.NetPay != null || r.netPay != null) && String(r.NetPay ?? r.netPay ?? '').trim() !== ''),
      month_filter: monthParam,
    });
  }
  return data;
}

function buildRunPayrollSnapshotPayload(record) {
  try {
    return JSON.stringify(record ?? {});
  } catch (e) {
    return '{}';
  }
}

/** Read payroll field from API/import row (camelCase, PascalCase, or case-insensitive key). */
function pickPayrollField(obj, ...aliases) {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const name of aliases) {
    if (name != null && Object.prototype.hasOwnProperty.call(obj, name)) {
      const v = obj[name];
      if (v !== undefined && v !== null) return v;
    }
  }
  const lowerSet = new Set(aliases.filter(Boolean).map((a) => String(a).toLowerCase()));
  for (const k of Object.keys(obj)) {
    if (lowerSet.has(String(k).toLowerCase())) {
      const v = obj[k];
      if (v !== undefined && v !== null) return v;
    }
  }
  return undefined;
}

/** Normalize one payroll row so RunPayroll can read values regardless of key casing. */
function normalizePayrollSourceForRunPayroll(record) {
  const r = record || {};
  const num = (v) => {
    const x = Number(v);
    return Number.isFinite(x) ? x : 0;
  };
  const ab = pickPayrollField(r, 'actualBasic', 'ActualBasic', 'Actual_Basic', 'actual_basic');
  const ah = pickPayrollField(r, 'actualHRA', 'ActualHRA');
  const ad = pickPayrollField(r, 'actualDA', 'ActualDA');
  const oa = pickPayrollField(r, 'otherAllowance', 'OtherAllowance');
  const oas = pickPayrollField(r, 'otherAllowances', 'OtherAllowances');
  const tc = pickPayrollField(r, 'travelChargers', 'TravelChargers');
  const sa = pickPayrollField(r, 'specialAllowance', 'SpecialAllowance');
  let actualTotalSalary = pickPayrollField(r, 'actualTotalSalary', 'ActualTotalSalary');
  if (actualTotalSalary === undefined || actualTotalSalary === null || actualTotalSalary === '') {
    actualTotalSalary =
      num(ab) + num(ah) + num(ad) + num(oa) + num(oas) + num(tc) + num(sa);
  }
  return {
    employeeCode: pickPayrollField(r, 'employeeCode', 'EmployeeCode'),
    employeeName: pickPayrollField(r, 'employeeName', 'EmployeeName'),
    department: pickPayrollField(r, 'department', 'Department'),
    category: pickPayrollField(r, 'category', 'Category'),
    contractor: pickPayrollField(r, 'contractor', 'Contractor', 'ContractorName'),
    daysInMonth: pickPayrollField(r, 'daysInMonth', 'DaysInMonth', 'NoOfDaysInMonth'),
    daysPresent: pickPayrollField(r, 'daysPresent', 'DaysPresent', 'noOfDaysPresent', 'NoOfDaysPresent'),
    otHours: pickPayrollField(r, 'otHours', 'OTHours', 'OtHours'),
    loh: pickPayrollField(r, 'loh', 'LOH'),
    revisedLOH: pickPayrollField(r, 'revisedLOH', 'RevisedLOH'),
    lop: pickPayrollField(r, 'lop', 'LOP'),
    actualBasic: ab,
    actualHRA: ah,
    actualDA: ad,
    actualTotalSalary,
    earnedBasic: pickPayrollField(r, 'earnedBasic', 'EarnedBasic'),
    earnedHRA: pickPayrollField(r, 'earnedHRA', 'EarnedHRA'),
    earnedDA: pickPayrollField(r, 'earnedDA', 'EarnedDA'),
    earnedSpecialAllowance: pickPayrollField(r, 'earnedSpecialAllowance', 'EarnedSpecialAllowance'),
    earnedAttendanceAllowance: pickPayrollField(
      r,
      'earnedAttendanceAllowance',
      'EarnedAttendanceAllowance',
      'attendanceAllowance',
      'AttendanceAllowance'
    ),
    earnedOtherAllowances: pickPayrollField(r, 'earnedOtherAllowances', 'EarnedOtherAllowances'),
    earnedSalaryCross: pickPayrollField(r, 'earnedSalaryCross', 'EarnedSalaryCross'),
    totalDeduction: pickPayrollField(r, 'totalDeduction', 'TotalDeduction'),
    netPay: pickPayrollField(r, 'netPay', 'NetPay', 'netpay'),
    pf: pickPayrollField(r, 'pf', 'PF', 'PF 12%', 'pf12', 'ProvidentFund', 'Provident Fund'),
    esi: pickPayrollField(r, 'esi', 'ESI'),
    employerEsi: pickPayrollField(r, 'employerEsi', 'EmployerESI'),
    esiContribution: pickPayrollField(r, 'esiContribution', 'ESIContribution'),
    otAmount: pickPayrollField(r, 'otAmount', 'OTAmount'),
    otArrearAmount: pickPayrollField(r, 'otArrearAmount', 'OTArrearAmount'),
    rent: pickPayrollField(r, 'rent', 'Rent'),
    advance: pickPayrollField(r, 'advance', 'Advance'),
    lwf: pickPayrollField(r, 'lwf', 'LWF'),
    pt: pickPayrollField(r, 'pt', 'PT'),
    otherDeduction: pickPayrollField(r, 'otherDeduction', 'OtherDeduction'),
    incentive: pickPayrollField(r, 'incentive', 'Incentive'),
    arrear: pickPayrollField(r, 'arrear', 'Arrear'),
    bonus: pickPayrollField(r, 'bonus', 'Bonus'),
    attendanceBonus: pickPayrollField(r, 'attendanceBonus', 'AttendanceBonus'),
    attendanceDeduction: pickPayrollField(r, 'attendanceDeduction', 'AttendanceDeduction'),
    loanAllowance: pickPayrollField(r, 'loanAllowance', 'LoanAllowance'),
    foodAllowance: pickPayrollField(r, 'foodAllowance', 'FoodAllowance'),
    uniformAllowance: pickPayrollField(r, 'uniformAllowance', 'UniformAllowance'),
    washingAllowance: pickPayrollField(r, 'washingAllowance', 'WashingAllowance'),
    otherAllowance: oa,
    otherAllowances: oas,
    travelChargers: tc,
    specialAllowance: sa
  };
}

/** RunPayroll Data Store columns are text — stringify values for insert. */
function toRunPayrollTextValue(val) {
  if (val === undefined || val === null) return undefined;
  if (typeof val === 'boolean') return val ? 'true' : 'false';
  if (typeof val === 'number') return String(Number.isFinite(val) ? val : 0);
  const s = String(val).trim();
  if (s === '') return '';
  const cleaned = s.replace(/,/g, '');
  if (/^-?\d+(\.\d+)?$/.test(cleaned)) {
    const n = Number(cleaned);
    return String(Number.isFinite(n) ? n : 0);
  }
  return String(val);
}

function extractDatastoreColumnNames(meta) {
  if (!meta) return [];
  let raw = meta.columns || meta.column_details || meta.Columns || meta.table_columns;
  if (!raw && meta.schema && meta.schema.columns) raw = meta.schema.columns;
  if (!raw && meta.table && meta.table.columns) raw = meta.table.columns;
  if (!raw && meta.data && meta.data.columns) raw = meta.data.columns;
  if (Array.isArray(raw) && raw.length && typeof raw[0] === 'string') {
    return raw.map((s) => String(s).trim()).filter(Boolean);
  }
  const names = [];
  for (const c of raw || []) {
    const n = c.column_name || c.name || c.ColumnName || c.COLUMN_NAME;
    if (n && String(n).trim()) names.push(String(n).trim());
  }
  return names;
}

/**
 * Catalyst sometimes omits column lists in getTableDetails / getAllTables meta.
 * Merge API-derived names with this list so RunPayroll still maps DaysPresent, ActualBasic, etc.
 * (PascalCase matches typical Cloud Scale UI.)
 */
const DEFAULT_RUNPAYROLL_DATASTORE_COLUMNS = [
  'Month_filter',
  'EmployeeCode',
  'EmployeeName',
  'Department',
  'Category',
  'Contractor',
  'DaysInMonth',
  'DaysPresent',
  'LOP',
  'OTHours',
  'LOH',
  'RevisedLOH',
  'ActualBasic',
  'ActualHRA',
  'ActualDA',
  'ActualTotalSalary',
  'EarnedBasic',
  'EarnedHRA',
  'EarnedDA',
  'EarnedSpecialAllowance',
  'EarnedAttendanceAllowance',
  'AttendanceAllowance',
  'AttendanceBonus',
  'AttendanceDeduction',
  'EarnedOtherAllowances',
  'OtherAllowance',
  'OtherAllowances',
  'TravelChargers',
  'SpecialAllowance',
  'LoanAllowance',
  'FoodAllowance',
  'UniformAllowance',
  'WashingAllowance',
  'Bonus',
  'EarnedSalaryCross',
  'TotalDeduction',
  'NetPay',
  'PF',
  'ESI',
  'EmployerESI',
  'ESIContribution',
  'OTAmount',
  'OTArrearAmount',
  'Rent',
  'Advance',
  'LWF',
  'PT',
  'OtherDeduction',
  'Incentive',
  'Arrear',
  'Payload'
];

function mergeRunPayrollColumnNames(fromApi, defaults) {
  const set = new Set();
  for (const c of fromApi || []) {
    const t = String(c || '').trim();
    if (t) set.add(t);
  }
  for (const c of defaults) set.add(c);
  return Array.from(set);
}

/**
 * Insert RunPayroll row; if Catalyst rejects unknown column names, drop them and retry (avoids silent "minimal" inserts).
 */
async function insertRunPayrollRowWithColumnRetries(runTable, row) {
  let attempt = { ...row };
  const dropPriority = ['Payload', 'Data', 'Snapshot', 'Json', 'RowJson', 'payload', 'data'];
  for (let round = 0; round < 50; round++) {
    try {
      await runTable.insertRow(attempt);
      return;
    } catch (e) {
      const msg = String(e?.message || e || '');
      const low = msg.toLowerCase();
      if (!/invalid|unknown|column|not exist|does not exist|not found/i.test(low)) {
        throw e;
      }
      let removed = false;
      const tryNames = [
        ...dropPriority.filter((k) => Object.prototype.hasOwnProperty.call(attempt, k)),
        ...Object.keys(attempt)
      ];
      const quoted = msg.match(/["']([A-Za-z0-9_\s]+)["']/);
      const colMatch =
        msg.match(/column\s*[:\s]+\s*([A-Za-z0-9_\s]+)/i) ||
        msg.match(/unknown\s+column[:\s]+([A-Za-z0-9_\s]+)/i) ||
        (quoted ? [null, quoted[1]] : null);
      if (colMatch && colMatch[1]) {
        const want = String(colMatch[1]).trim();
        const hit = Object.keys(attempt).find(
          (k) => k.toLowerCase().replace(/\s+/g, '') === want.toLowerCase().replace(/\s+/g, '')
        );
        if (hit) {
          delete attempt[hit];
          removed = true;
          console.log(`RunPayroll insert: removed invalid column "${hit}" (${msg.slice(0, 120)})`);
        }
      }
      if (!removed) {
        for (const k of dropPriority) {
          if (Object.prototype.hasOwnProperty.call(attempt, k)) {
            delete attempt[k];
            removed = true;
            console.log(`RunPayroll insert: removed optional column "${k}" after error`);
            break;
          }
        }
      }
      if (!removed && Object.keys(attempt).length > 1) {
        const keys = Object.keys(attempt);
        const drop = keys.find((k) => /payload|snapshot|^data$|^json$/i.test(k));
        if (drop) {
          delete attempt[drop];
          removed = true;
        }
      }
      if (!removed) {
        throw e;
      }
    }
  }
  throw new Error('RunPayroll insert failed after column retries');
}

/** Normalize Data Store column name for matching (handles "Days Present", "days_present", "DaysPresent"). */
function runPayrollColumnSlug(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_\-–—]+/g, '');
}

function isRunPayrollSystemColumn(name) {
  const L = String(name || '').toLowerCase();
  return (
    L === 'rowid' ||
    L === 'creatorid' ||
    L === 'createdtime' ||
    L === 'modifiedtime'
  );
}

async function getRunPayrollTableWithColumns(catalystApp) {
  const tryId = async (rawId) => {
    try {
      const details = await catalystApp.datastore().getTableDetails(rawId);
      const meta = typeof details.toJSON === 'function' ? details.toJSON() : details._tableDetails;
      const columnNames = extractDatastoreColumnNames(meta);
      const ref = meta && meta.table_id != null && String(meta.table_id).length > 0 ? meta.table_id : rawId;
      return { table: catalystApp.datastore().table(ref), columnNames, tableId: ref };
    } catch (e) {
      return null;
    }
  };
  const pack = (table, actualColumnNames, tableId) => {
    const actual = (actualColumnNames || []).filter(Boolean);
    const insertColumns =
      actual.length > 0 ? actual : [...DEFAULT_RUNPAYROLL_DATASTORE_COLUMNS];
    return {
      table,
      columnNames: insertColumns,
      /** Always non-empty — used for insert/filter (empty [] from API meta broke May saves). */
      actualColumnNames: insertColumns,
      mappingColumnNames: mergeRunPayrollColumnNames(actual, DEFAULT_RUNPAYROLL_DATASTORE_COLUMNS),
      tableId
    };
  };
  const byName = await resolveDatastoreTableByName(catalystApp, 'RunPayroll');
  if (byName) {
    let columnNames = extractDatastoreColumnNames(byName.meta) || [];
    const tid = byName.meta?.table_id;
    if (columnNames.length === 0 && tid) {
      const enriched = await tryId(tid);
      if (enriched && enriched.columnNames.length) {
        columnNames = enriched.columnNames;
      }
    }
    if (columnNames.length === 0) {
      console.log('RunPayroll: no columns from Catalyst meta; using DEFAULT_RUNPAYROLL_DATASTORE_COLUMNS for insert');
    }
    return pack(byName.table, columnNames, tid);
  }
  const idCandidates = [process.env.RUN_PAYROLL_TABLE_ID, '399000000206964'].filter(Boolean);
  for (const rawId of idCandidates) {
    const got = await tryId(rawId);
    if (got) {
      if (!got.columnNames || got.columnNames.length === 0) {
        console.log('RunPayroll: getTableDetails by id returned no columns; using default column list');
      }
      return pack(got.table, got.columnNames, got.tableId);
    }
  }
  for (const ref of ['399000000206964', 'RunPayroll']) {
    try {
      const enriched = await tryId(ref);
      if (enriched) {
        console.log(`RunPayroll: fallback table ref "${ref}" with ${enriched.columnNames.length} columns`);
        return pack(enriched.table, enriched.columnNames, enriched.tableId);
      }
      const table = catalystApp.datastore().table(ref);
      await table.getAllRows({ maxRecords: 1 });
      console.log(`RunPayroll: fallback table ref "${ref}" (no column meta)`);
      return pack(table, [], ref);
    } catch (fbErr) {
      console.log(`RunPayroll: fallback ref "${ref}" failed:`, fbErr?.message || fbErr);
    }
  }
  return null;
}

/** Fallback column sets — **largest first** so we never stop at Month_filter + EmployeeCode only. */
const RUNPAYROLL_INSERT_COLUMN_SETS = [
  [
    'Month_filter',
    'EmployeeCode',
    'EmployeeName',
    'Department',
    'Category',
    'Contractor',
    'DaysInMonth',
    'DaysPresent',
    'LOP',
    'LOH',
    'OTHours',
    'ActualBasic',
    'ActualHRA',
    'ActualDA',
    'OtherAllowance',
    'OtherAllowances',
    'TravelChargers',
    'SpecialAllowance',
    'Incentive',
    'LoanAllowance',
    'EarnedBasic',
    'EarnedHRA',
    'EarnedDA',
    'EarnedSpecialAllowance',
    'EarnedAttendanceAllowance',
    'AttendanceAllowance',
    'AttendanceDeduction',
    'AttendanceBonus',
    'EarnedSalaryCross',
    'TotalDeduction',
    'NetPay',
    'PF',
    'ESI',
    'OTAmount',
    'Rent',
    'Advance',
    'PT',
    'LWF',
    'OtherDeduction',
    'Bonus',
    'Arrear'
  ],
  [
    'Month_filter',
    'EmployeeCode',
    'EmployeeName',
    'Department',
    'Contractor',
    'DaysInMonth',
    'DaysPresent',
    'EarnedBasic',
    'EarnedHRA',
    'EarnedDA',
    'EarnedSalaryCross',
    'TotalDeduction',
    'NetPay',
    'PF',
    'ESI',
    'OTAmount',
    'Rent',
    'Advance',
    'LOH',
    'LOP',
    'LoanAllowance',
    'Bonus',
    'AttendanceBonus',
    'AttendanceDeduction'
  ],
  [
    'Month_filter',
    'EmployeeCode',
    'EmployeeName',
    'NetPay',
    'EarnedSalaryCross',
    'TotalDeduction',
    'PF',
    'ESI',
    'EarnedHRA',
    'EarnedBasic',
    'LOP',
    'LoanAllowance',
    'Rent',
    'Advance',
    'AttendanceBonus',
    'AttendanceDeduction'
  ],
  ['Month_filter', 'EmployeeCode', 'NetPay', 'EarnedSalaryCross', 'EarnedBasic', 'LOP']
];

async function insertRunPayrollRowKnownColumns(runTable, monthNorm, record, schemaInfo) {
  const fullRow = buildPayrollImportTextRow(monthNorm, record, {
    dojMap: schemaInfo?.dojMap
  });
  if (!fullRow.EmployeeCode) throw new Error('EmployeeCode is required for RunPayroll');
  const insertColumnNames = resolveRunPayrollInsertColumnNames(schemaInfo || {});
  let lastErr;

  const fullFiltered = filterRowToDatastoreColumns(fullRow, insertColumnNames);
  const fullKeys = Object.keys(fullFiltered).filter(
    (k) => !isRunPayrollSystemColumn(k) && fullFiltered[k] !== '' && fullFiltered[k] != null
  );
  if (
    fullKeys.length >= 3 &&
    runPayrollRowHasRequiredFields(fullFiltered, insertColumnNames)
  ) {
    try {
      await insertRunPayrollRowWithColumnRetries(runTable, fullFiltered);
      return;
    } catch (e) {
      lastErr = e;
      console.log(
        `RunPayroll schema insert failed for ${fullRow.EmployeeCode} (${fullKeys.length} cols):`,
        e?.message || e
      );
    }
  }

  for (const cols of RUNPAYROLL_INSERT_COLUMN_SETS) {
    const row = filterRowToDatastoreColumns(fullRow, cols);
    if (!runPayrollRowHasRequiredFields(row, cols)) continue;
    const valueCols = Object.keys(row).filter(
      (k) => runPayrollColumnSlug(k) !== 'monthfilter' && runPayrollColumnSlug(k) !== 'employeecode'
    );
    if (valueCols.length === 0) continue;
    try {
      await insertRunPayrollRowWithColumnRetries(runTable, row);
      return;
    } catch (e) {
      lastErr = e;
    }
  }

  throw lastErr || new Error('RunPayroll insert failed (all column sets exhausted)');
}

/**
 * Same text-row shape as Payroll import — ensures RunPayroll gets NetPay, EarnedHRA, PF, etc.
 */
function buildPayrollImportTextRow(month, record, runPayrollOpts) {
  const safeNumStr = (val) => {
    const num = Number(val);
    const result = isNaN(num) || num === null || num === undefined ? 0 : num;
    return String(result);
  };
  const monthNorm = normalizePayrollMonthFilter(month);
  const dojMap = runPayrollOpts?.dojMap;
  const row = {};
  row.Month_filter = monthNorm || String(month || '');
  row.EmployeeCode = String(record.employeeCode ?? record.EmployeeCode ?? '').trim();
  row.EmployeeName = String(record.employeeName ?? record.EmployeeName ?? '');
  row.Department = String(record.department ?? record.Department ?? '');
  row.Category = String(record.category ?? record.Category ?? '');
  row.Contractor = String(record.contractor ?? record.Contractor ?? '');
  row.DaysInMonth = safeNumStr(record.daysInMonth ?? record.DaysInMonth);
  row.DaysPresent = safeNumStr(record.daysPresent ?? record.DaysPresent);
  row.OTHours = safeNumStr(record.otHours ?? record.OTHours);
  row.LOH = safeNumStr(record.loh ?? record.LOH);
  row.RevisedLOH = safeNumStr(
    record.revisedLOH ??
      record.RevisedLOH ??
      lohHoursForLateDeduction(record.loh ?? record.LOH)
  );
  row.ActualBasic = safeNumStr(record.actualBasic ?? record.ActualBasic);
  row.ActualHRA = safeNumStr(record.actualHRA ?? record.ActualHRA);
  row.ActualDA = safeNumStr(record.actualDA ?? record.ActualDA);
  row.OtherAllowance = safeNumStr(record.otherAllowance ?? record.OtherAllowance);
  row.SpecialAllowance = safeNumStr(record.specialAllowance ?? record.SpecialAllowance);
  row.Incentive = safeNumStr(record.incentive ?? record.Incentive);
  row.LoanAllowance = safeNumStr(record.loanAllowance ?? record.LoanAllowance);
  row.NoOfDaysWithoutUniforms = safeNumStr(
    record.noOfDaysWithoutUniforms ?? record.NoOfDaysWithoutUniforms
  );
  row.Noofdayswithoutuniforms = row.NoOfDaysWithoutUniforms;
  row.OtherAllowances = safeNumStr(record.otherAllowances ?? record.OtherAllowances);
  row.TravelChargers = safeNumStr(record.travelChargers ?? record.TravelChargers);
  row.ActualTotalSalary = safeNumStr(
    (Number(record.actualBasic) || 0) +
      (Number(record.actualHRA) || 0) +
      (Number(record.actualDA) || 0) +
      (Number(record.otherAllowance) || 0) +
      (Number(record.otherAllowances) || 0) +
      (Number(record.travelChargers) || 0) +
      (Number(record.specialAllowance) || 0)
  );
  row.EarnedBasic = safeNumStr(record.earnedBasic ?? record.EarnedBasic);
  row.EarnedHRA = safeNumStr(record.earnedHRA ?? record.EarnedHRA);
  row.EarnedDA = safeNumStr(record.earnedDA ?? record.EarnedDA);
  row.EarnedSpecialAllowance = safeNumStr(
    record.earnedSpecialAllowance ?? record.EarnedSpecialAllowance
  );
  row.Arrear = safeNumStr(record.arrear ?? record.Arrear);
  row.ArrearForPF = safeNumStr(record.arrearForPF ?? record.ArrearForPF);
  row.LOP = safeNumStr(record.lop ?? record.LOP);
  row.EarnedSalaryCross = safeNumStr(record.earnedSalaryCross ?? record.EarnedSalaryCross);
  row.AttendanceAllowance = safeNumStr(
    record.earnedAttendanceAllowance ?? record.EarnedAttendanceAllowance ?? record.AttendanceAllowance
  );
  row.EarnedAttendanceAllowance = row.AttendanceAllowance;
  row.EarnedOtherAllowances = safeNumStr(
    record.earnedOtherAllowances ?? record.EarnedOtherAllowances
  );
  row.PF = safeNumStr(record.pf ?? record.PF);
  row.ESI = safeNumStr(record.esi ?? record.ESI);
  row.EmployerESI = safeNumStr(record.employerEsi ?? record.EmployerESI);
  row.ESIContribution = safeNumStr(record.esiContribution ?? record.ESIContribution ?? 0);
  row.TotalDeduction = safeNumStr(
    runPayrollTotalDeductionIncludingAttendanceBonus(record, monthNorm, dojMap)
  );
  row.OTAmount = safeNumStr(record.otAmount ?? record.OTAmount);
  row.OTArrearAmount = safeNumStr(record.otArrearAmount ?? record.OTArrearAmount);
  row.OTESI = safeNumStr(record.otEsi ?? record.OTESI);
  row.OTPayment = safeNumStr(record.otPayment ?? record.OTPayment);
  row.PayableAmount = safeNumStr(record.payableAmount ?? record.PayableAmount);
  row.OTWages = safeNumStr(record.otWages ?? record.OTWages);
  row.Rent = safeNumStr(record.rent ?? record.Rent);
  row.Advance = safeNumStr(record.advance ?? record.Advance);
  row.LWF =
    monthNorm && monthNorm.endsWith('-12') ? safeNumStr(20) : safeNumStr(record.lwf ?? record.LWF);
  row.EmployerLwf =
    monthNorm && monthNorm.endsWith('-12')
      ? safeNumStr(40)
      : safeNumStr(record.employerLwf ?? record.EmployerLwf ?? 0);
  row.PT = safeNumStr(record.pt ?? record.PT);
  row.OtherDeduction = safeNumStr(record.otherDeduction ?? record.OtherDeduction);
  row.NetPay = safeNumStr(
    runPayrollNetPayFromEarnedGrossMinusTotalDeduction(
      record,
      monthNorm,
      dojMap,
      Number(row.TotalDeduction) || 0
    )
  );
  row.TotalNetPayable = safeNumStr(record.totalNetPayable ?? record.TotalNetPayable);
  row.ERPF = safeNumStr(record.erpf ?? record.ERPF);
  row.Admin = safeNumStr(record.admin ?? record.Admin);
  row.EDLI = safeNumStr(record.edli ?? record.EDLI);
  row.ERPF13 = safeNumStr(record.erpf13 ?? record.ERPF13);
  row.ServiceCharge = safeNumStr(record.serviceCharge ?? record.ServiceCharge);
  row.Total = safeNumStr(record.total ?? record.Total);
  row.GST = safeNumStr(record.gst ?? record.GST);
  row.NetTotal = safeNumStr(record.netTotal ?? record.NetTotal);
  row.Bonus = safeNumStr(record.bonus ?? record.Bonus);
  row.AttendanceBonus = safeNumStr(resolveRunPayrollAttendanceBonus(record, monthNorm, dojMap));
  row.AttendanceDeduction = safeNumStr(
    runPayrollAttendanceDeductionFromPayrollRecord(record, monthNorm, dojMap)
  );
  row.FoodAllowance = safeNumStr(record.foodAllowance ?? record.FoodAllowance);
  row.UniformAllowance = safeNumStr(record.uniformAllowance ?? record.UniformAllowance);
  row.WashingAllowance = safeNumStr(record.washingAllowance ?? record.WashingAllowance);
  row.BankHolderName = String(record.bankHolderName ?? record.BankHolderName ?? '');
  row.BankName = String(record.bankName ?? record.BankName ?? '');
  row.IFSCCode = String(record.ifscCode ?? record.IFSCCode ?? '');
  row.BankBranch = String(record.bankBranch ?? record.BankBranch ?? '');
  Object.keys(row).forEach((key) => {
    if (row[key] === undefined || row[key] === null) row[key] = '';
  });
  return row;
}

function resolveRunPayrollInsertColumnNames(schemaInfo) {
  const actual = schemaInfo?.actualColumnNames;
  const fallback = schemaInfo?.columnNames || DEFAULT_RUNPAYROLL_DATASTORE_COLUMNS;
  return actual && actual.length > 0 ? actual : fallback;
}

function runPayrollRowHasRequiredFields(row, insertColumnNames) {
  if (!row || typeof row !== 'object') return false;
  let empVal = '';
  let monthVal = '';
  for (const col of insertColumnNames || []) {
    const slug = runPayrollColumnSlug(col);
    if (slug === 'employeecode') empVal = String(row[col] ?? '').trim();
    if (slug === 'monthfilter') monthVal = String(row[col] ?? '').trim();
  }
  if (!empVal) empVal = String(row.EmployeeCode ?? row.employeeCode ?? '').trim();
  if (!monthVal) monthVal = String(row.Month_filter ?? row.month_filter ?? '').trim();
  return !!empVal && !!monthVal;
}

/** Map Payroll-shaped row onto exact Data Store column names (no phantom columns). */
function filterRowToDatastoreColumns(fullRow, actualColumnNames) {
  if (!fullRow || !actualColumnNames?.length) return {};
  const slugToExact = new Map();
  for (const col of actualColumnNames) {
    if (!col || isRunPayrollSystemColumn(col)) continue;
    slugToExact.set(runPayrollColumnSlug(col), String(col).trim());
  }
  const out = {};
  for (const [key, val] of Object.entries(fullRow)) {
    const exact = slugToExact.get(runPayrollColumnSlug(key));
    if (exact && val !== undefined) out[exact] = val;
  }
  if (!out.Month_filter && fullRow.Month_filter) {
    const mf = slugToExact.get(runPayrollColumnSlug('Month_filter'));
    if (mf) out[mf] = fullRow.Month_filter;
  }
  if (!out.EmployeeCode && fullRow.EmployeeCode) {
    const ec = slugToExact.get(runPayrollColumnSlug('EmployeeCode'));
    if (ec) out[ec] = fullRow.EmployeeCode;
  }
  return out;
}

/**
 * Map logical payroll values keyed by slug (see runPayrollColumnSlug). Covers alternate spellings.
 */
function buildRunPayrollLogicalSlugMap(month, normalized, rawRecord) {
  const s = (v) => (v === undefined || v === null ? '' : String(v));
  const n = (v) => {
    const x = Number(v);
    return String(Number.isFinite(x) ? x : 0);
  };
  const payloadJson = buildRunPayrollSnapshotPayload(rawRecord);
  const dp = n(normalized.daysPresent);
  const ab = n(normalized.actualBasic);
  const map = {
    monthfilter: String(month || '').trim(),
    month: String(month || '').trim(),
    employeecode: s(normalized.employeeCode),
    employeename: s(normalized.employeeName),
    department: s(normalized.department),
    category: s(normalized.category),
    contractor: s(normalized.contractor),
    contractorname: s(normalized.contractor),
    daysinmonth: n(normalized.daysInMonth),
    noofdaysinmonth: n(normalized.daysInMonth),
    dayspresent: dp,
    daypresent: dp,
    noofdaypresent: dp,
    noofdayspresent: dp,
    nopresentdays: dp,
    othours: n(normalized.otHours),
    othrs: n(normalized.otHours),
    overtimehours: n(normalized.otHours),
    loh: n(normalized.loh),
    revisedloh: n(
      normalized.revisedLOH !== undefined && normalized.revisedLOH !== null && normalized.revisedLOH !== ''
        ? normalized.revisedLOH
        : lohHoursForLateDeduction(normalized.loh)
    ),
    lop: n(normalized.lop),
    actualbasic: ab,
    actualbasicsalary: ab,
    actualhra: n(normalized.actualHRA),
    actualda: n(normalized.actualDA),
    actualtotalsalary: n(normalized.actualTotalSalary),
    actualsalary: n(normalized.actualTotalSalary),
    earnedbasic: n(normalized.earnedBasic),
    earnedhra: n(normalized.earnedHRA),
    earnedda: n(normalized.earnedDA),
    earnedspecialallowance: n(normalized.earnedSpecialAllowance),
    earnedattendanceallowance: n(normalized.earnedAttendanceAllowance),
    earnedotherallowances: n(normalized.earnedOtherAllowances),
    earnedsalarycross: n(normalized.earnedSalaryCross),
    earnedgrosssalary: n(normalized.earnedSalaryCross),
    totaldeduction: n(normalized.totalDeduction),
    netpay: n(normalized.netPay),
    pf: n(normalized.pf),
    esi: n(normalized.esi),
    employeresi: n(normalized.employerEsi),
    esicontribution: n(normalized.esiContribution),
    otamount: n(normalized.otAmount),
    otarrearamount: n(normalized.otArrearAmount),
    rent: n(normalized.rent),
    advance: n(normalized.advance),
    lwf: n(normalized.lwf),
    pt: n(normalized.pt),
    otherdeduction: n(normalized.otherDeduction),
    incentive: n(normalized.incentive),
    arrear: n(normalized.arrear),
    bonus: n(normalized.bonus),
    attendancebonus: n(normalized.attendanceBonus),
    attendancededuction: n(normalized.attendanceDeduction),
    loanallowance: n(normalized.loanAllowance),
    foodallowance: n(normalized.foodAllowance),
    uniformallowance: n(normalized.uniformAllowance),
    washingallowance: n(normalized.washingAllowance),
    payload: payloadJson,
    data: payloadJson,
    snapshot: payloadJson,
    json: payloadJson,
    rowjson: payloadJson
  };
  return map;
}

/**
 * Value for a Data Store column when slug is not an exact key (handles typos / labels).
 */
function inferRunPayrollValueForSlug(slug, logical) {
  if (
    (slug.includes('days') && slug.includes('present')) ||
    (slug.includes('day') && slug.includes('present') && !slug.includes('holiday'))
  ) {
    return logical.dayspresent;
  }
  if (slug.includes('days') && slug.includes('month') && !slug.includes('present')) return logical.daysinmonth;
  if (slug.includes('actual') && slug.includes('basic')) return logical.actualbasic;
  if (slug.includes('actual') && slug.includes('hra')) return logical.actualhra;
  if (slug.includes('actual') && slug.includes('da') && !slug.includes('total')) return logical.actualda;
  if (slug.includes('actual') && slug.includes('total')) return logical.actualtotalsalary;
  if (slug.includes('earned') && slug.includes('basic')) return logical.earnedbasic;
  if (slug.includes('earned') && slug.includes('hra')) return logical.earnedhra;
  if (slug.includes('earned') && slug.includes('da') && !slug.includes('total')) return logical.earnedda;
  if (slug.includes('earned') && slug.includes('special')) return logical.earnedspecialallowance;
  if (slug.includes('earned') && slug.includes('attendance') && slug.includes('allow')) {
    return logical.earnedattendanceallowance;
  }
  if (slug.includes('attendance') && slug.includes('bonus') && !slug.includes('deduct')) {
    return logical.attendancebonus;
  }
  if (slug.includes('attendance') && slug.includes('deduct')) {
    return logical.attendancededuction;
  }
  if (slug === 'bonus' || (slug.includes('bonus') && !slug.includes('attendance'))) return logical.bonus;
  if (slug.includes('food') && slug.includes('allow')) return logical.foodallowance;
  if (slug.includes('uniform') && slug.includes('allow')) return logical.uniformallowance;
  if (slug.includes('wash') && slug.includes('allow')) return logical.washingallowance;
  if (slug.includes('loan') && slug.includes('allow')) return logical.loanallowance;
  if (slug.includes('earned') && slug.includes('attendance')) return logical.earnedattendanceallowance;
  if (slug.includes('earned') && slug.includes('other') && slug.includes('allow')) {
    return logical.earnedotherallowances;
  }
  if (slug.includes('earned') && (slug.includes('cross') || slug.includes('gross'))) return logical.earnedsalarycross;
  if (slug.includes('total') && slug.includes('deduct')) return logical.totaldeduction;
  if (slug === 'netpay' || (slug.includes('net') && slug.includes('pay'))) return logical.netpay;
  if (slug === 'esi' || (slug.includes('esi') && !slug.includes('employer') && !slug.includes('contrib'))) {
    return logical.esi;
  }
  if (slug.includes('employer') && slug.includes('esi')) return logical.employeresi;
  if (slug.includes('esi') && slug.includes('contrib')) return logical.esicontribution;
  if (slug === 'rent' || slug.includes('rentrecovery')) return logical.rent;
  if (slug === 'advance') return logical.advance;
  if (slug === 'lwf') return logical.lwf;
  if (slug === 'pt' || slug.includes('professionaltax')) return logical.pt;
  if (slug.includes('other') && slug.includes('deduct')) return logical.otherdeduction;
  if (slug.includes('ot') && slug.includes('arrear')) return logical.otarrearamount;
  if (slug.includes('ot') && slug.includes('amount')) return logical.otamount;
  if (
    slug === 'pf' ||
    (slug.includes('provident') && slug.includes('fund')) ||
    (slug.includes('pf') && (slug.includes('12') || slug.includes('%')))
  ) {
    return logical.pf;
  }
  if (slug.includes('othour') || slug === 'oth' || (slug.includes('ot') && slug.includes('hour'))) {
    return logical.othours;
  }
  if (slug.includes('revised') && slug.includes('loh')) return logical.revisedloh;
  return undefined;
}

/**
 * Build insert row using **exact** column names from Data Store schema so Catalyst does not drop values.
 * Matches columns by normalizing names (spaces/underscores) so "Days Present" and "DaysPresent" both work.
 */
function runPayrollValueFromRawRecord(colName, rawRecord) {
  const exact = String(colName || '').trim();
  if (!exact || !rawRecord || typeof rawRecord !== 'object') return undefined;
  const camel =
    exact.length > 1
      ? exact.charAt(0).toLowerCase() + exact.slice(1)
      : exact.toLowerCase();
  const v = pickPayrollField(rawRecord, exact, camel);
  return toRunPayrollTextValue(v);
}

function buildRunPayrollRowForSchema(columnNames, month, normalized, rawRecord) {
  const row = {};
  const logical = buildRunPayrollLogicalSlugMap(month, normalized, rawRecord);
  for (const col of columnNames) {
    if (!col || isRunPayrollSystemColumn(col)) continue;
    const exact = String(col).trim();
    const slug = runPayrollColumnSlug(exact);
    if (!slug) continue;
    let val;
    if (Object.prototype.hasOwnProperty.call(logical, slug)) {
      val = logical[slug];
    } else {
      val = inferRunPayrollValueForSlug(slug, logical);
    }
    if (val === undefined) {
      val = runPayrollValueFromRawRecord(exact, rawRecord);
    }
    if (val !== undefined) {
      row[exact] = val;
    }
  }
  return row;
}

/**
 * Insert one RunPayroll row: Payroll-import field mapping, only real table columns.
 */
async function insertRunPayrollRowCascade(runTable, month, record, schemaInfo) {
  const monthNorm = normalizePayrollMonthFilter(month);
  const normalized = normalizePayrollSourceForRunPayroll(record);
  const insertColumnNames = resolveRunPayrollInsertColumnNames(schemaInfo || {});
  const fullRow = buildPayrollImportTextRow(monthNorm, record, { dojMap: schemaInfo?.dojMap });
  if (!fullRow.EmployeeCode) {
    throw new Error('EmployeeCode is required for RunPayroll');
  }

  try {
    await insertRunPayrollRowKnownColumns(runTable, monthNorm, record, schemaInfo);
    return;
  } catch (knownErr) {
    console.log(
      `RunPayroll known-columns insert for ${fullRow.EmployeeCode}, retrying full map:`,
      knownErr?.message || knownErr
    );
  }

  const row = filterRowToDatastoreColumns(fullRow, insertColumnNames);
  if (runPayrollRowHasRequiredFields(row, insertColumnNames) && Object.keys(row).length >= 2) {
    try {
      await runTable.insertRow(row);
      return;
    } catch (insertErr) {
      console.log(
        `RunPayroll insertRow retry for ${fullRow.EmployeeCode}:`,
        insertErr?.message || insertErr
      );
      await insertRunPayrollRowWithColumnRetries(runTable, row);
      return;
    }
  }

  const columnNames =
    schemaInfo && Array.isArray(schemaInfo.mappingColumnNames) ? schemaInfo.mappingColumnNames : [];
  if (columnNames.length > 0) {
    const row = buildRunPayrollRowForSchema(columnNames, month, normalized, record);
    const filtered = filterRowToDatastoreColumns(
      Object.assign({}, fullRow, row),
      insertColumnNames
    );
    if (runPayrollRowHasRequiredFields(filtered, insertColumnNames) && Object.keys(filtered).length > 0) {
      await insertRunPayrollRowWithColumnRetries(runTable, filtered);
      return;
    }
  }

  const s = (v) => (v === undefined || v === null ? '' : String(v));
  const n = (v) => {
    const x = Number(v);
    return String(Number.isFinite(x) ? x : 0);
  };
  const payload = buildRunPayrollSnapshotPayload(record);
  const monthVal = String(month || '').trim();

  const attempts = [
    {
      Month_filter: monthVal,
      EmployeeCode: s(normalized.employeeCode),
      EmployeeName: s(normalized.employeeName),
      Department: s(normalized.department),
      Category: s(normalized.category),
      Contractor: s(normalized.contractor),
      DaysInMonth: n(normalized.daysInMonth),
      DaysPresent: n(normalized.daysPresent),
      LOP: n(normalized.lop),
      OTHours: n(normalized.otHours),
      LOH: n(normalized.loh),
      RevisedLOH: n(
        normalized.revisedLOH !== undefined && normalized.revisedLOH !== null && normalized.revisedLOH !== ''
          ? normalized.revisedLOH
          : lohHoursForLateDeduction(normalized.loh)
      ),
      ActualBasic: n(normalized.actualBasic),
      ActualHRA: n(normalized.actualHRA),
      ActualDA: n(normalized.actualDA),
      ActualTotalSalary: n(normalized.actualTotalSalary),
      EarnedBasic: n(normalized.earnedBasic),
      EarnedHRA: n(normalized.earnedHRA),
      EarnedDA: n(normalized.earnedDA),
      EarnedSpecialAllowance: n(normalized.earnedSpecialAllowance),
      EarnedSalaryCross: n(normalized.earnedSalaryCross),
      PF: n(normalized.pf),
      ESI: n(normalized.esi),
      Rent: n(normalized.rent),
      Advance: n(normalized.advance),
      TotalDeduction: n(normalized.totalDeduction),
      OTAmount: n(normalized.otAmount),
      NetPay: n(normalized.netPay),
      Payload: payload
    },
    {
      Month_filter: monthVal,
      EmployeeCode: s(normalized.employeeCode),
      EmployeeName: s(normalized.employeeName),
      Department: s(normalized.department),
      Contractor: s(normalized.contractor),
      DaysInMonth: n(normalized.daysInMonth),
      DaysPresent: n(normalized.daysPresent),
      LOP: n(normalized.lop),
      OTHours: n(normalized.otHours),
      LOH: n(normalized.loh),
      NetPay: n(normalized.netPay),
      Payload: payload
    },
    {
      Month_filter: monthVal,
      EmployeeCode: s(normalized.employeeCode),
      EmployeeName: s(normalized.employeeName),
      Department: s(normalized.department),
      Contractor: s(normalized.contractor),
      DaysInMonth: n(normalized.daysInMonth),
      Payload: payload
    },
    {
      Month_filter: monthVal,
      EmployeeCode: s(normalized.employeeCode),
      EmployeeName: s(normalized.employeeName),
      Department: s(normalized.department),
      Contractor: s(normalized.contractor),
      DaysInMonth: n(normalized.daysInMonth)
    },
    {
      EmployeeCode: s(normalized.employeeCode),
      EmployeeName: s(normalized.employeeName),
      Department: s(normalized.department),
      Contractor: s(normalized.contractor),
      DaysInMonth: n(normalized.daysInMonth)
    }
  ];

  let lastErr;
  for (const row of attempts) {
    try {
      await runTable.insertRow(row);
      return;
    } catch (e) {
      lastErr = e;
      const msg = String(e?.message || e || '');
      if (!/invalid column|unknown column|column name/i.test(msg)) {
        throw e;
      }
    }
  }
  throw lastErr || new Error('RunPayroll insert failed');
}

/**
 * Delete all RunPayroll rows for a month and rebuild from Payroll table (1 row per employee).
 */
async function rebuildRunPayrollMonthFromPayrollTable(catalystApp, runTable, month) {
  const monthNorm = normalizePayrollMonthFilter(month);
  if (!monthNorm || !runTable) return { ok: false, error: 'invalid month or table' };
  const schema = await getRunPayrollTableWithColumns(catalystApp);
  if (!schema?.table) return { ok: false, skipped: true, error: 'RunPayroll table not found' };
  const payrollMap = await loadPayrollRecordsMapForMonth(catalystApp, monthNorm);
  if (payrollMap.size === 0) {
    return { ok: false, error: `No Payroll rows for Month_filter=${monthNorm}` };
  }
  const dojMap = await loadEmployeeDateOfJoiningMap(catalystApp);
  const deleted = await deleteRunPayrollRowsForMonth(catalystApp, runTable, monthNorm);
  const insertColumnNames = resolveRunPayrollInsertColumnNames(schema);
  const schemaInfo = {
    columnNames: insertColumnNames,
    actualColumnNames: insertColumnNames,
    mappingColumnNames: schema.mappingColumnNames || insertColumnNames,
    dojMap
  };
  let inserted = 0;
  let failed = 0;
  let firstError = null;
  for (const payrollRow of payrollMap.values()) {
    try {
      const enriched = enrichPayrollRecordForRunPayroll(
        payrollRow,
        monthNorm,
        dojMap,
        payrollRow
      );
      await insertRunPayrollRowCascade(runTable, monthNorm, enriched, schemaInfo);
      inserted++;
    } catch (e) {
      failed++;
      if (!firstError) firstError = e?.message || String(e);
      console.error(
        `rebuildRunPayrollMonthFromPayrollTable: employee ${payrollRow?.EmployeeCode}:`,
        e?.message || e
      );
    }
  }
  return {
    ok: inserted > 0 && failed === 0,
    inserted,
    failed,
    deleted,
    employees: payrollMap.size,
    firstError
  };
}

/**
 * After Payroll import/save (including Run Payroll auto-save), mirror rows into RunPayroll.
 */
async function syncRunPayrollFromPayrollImport(catalystApp, month, payrollData) {
  const schema = await getRunPayrollTableWithColumns(catalystApp);
  if (!schema || !schema.table) {
    console.log('syncRunPayrollFromPayrollImport: RunPayroll table not found, skip');
    return { ok: false, skipped: true };
  }
  const { table: runTable, columnNames, mappingColumnNames } = schema;
  const insertColumnNames = resolveRunPayrollInsertColumnNames(schema);
  const monthNorm = normalizePayrollMonthFilter(month);
  console.log(
    `syncRunPayrollFromPayrollImport: month=${monthNorm}, employees=${payrollData?.length || 0}, columns=${insertColumnNames.length}`
  );
  if (!monthNorm || !Array.isArray(payrollData) || payrollData.length === 0) {
    return { ok: false, skipped: true };
  }
  const dedupedBefore = await dedupeRunPayrollRowsForMonth(catalystApp, runTable, monthNorm);
  const deletedMonth = await deleteRunPayrollRowsForMonth(catalystApp, runTable, monthNorm);
  const dojMap = await loadEmployeeDateOfJoiningMap(catalystApp);
  const payrollTableMap = await loadPayrollRecordsMapForMonth(catalystApp, monthNorm);
  let ok = 0;
  let failed = 0;
  let firstError = null;
  const schemaInfo = {
    columnNames: insertColumnNames,
    actualColumnNames: insertColumnNames,
    mappingColumnNames: mappingColumnNames || insertColumnNames,
    dojMap
  };
  for (const record of payrollData) {
    try {
      await deleteRunPayrollRowsForEmployeeMonth(
        catalystApp,
        runTable,
        monthNorm,
        record?.employeeCode ?? record?.EmployeeCode
      );
      const empCode = String(record?.employeeCode ?? record?.EmployeeCode ?? '').trim();
      const empNorm = normalizeEmployeeCode(empCode) || empCode;
      const payrollRow = payrollTableMap.get(empNorm);
      const enriched = enrichPayrollRecordForRunPayroll(
        record,
        monthNorm,
        dojMap,
        payrollRow
      );
      await insertRunPayrollRowCascade(runTable, monthNorm, enriched, schemaInfo);
      ok++;
    } catch (e) {
      failed++;
      const msg = e?.message || String(e);
      if (!firstError) firstError = msg;
      console.error(`syncRunPayrollFromPayrollImport: employee ${record?.employeeCode}:`, msg);
    }
  }
  const deduped = await dedupeRunPayrollRowsForMonth(catalystApp, runTable, monthNorm);
  const alignResult = await alignRunPayrollRowsWithPayrollTable(catalystApp, runTable, monthNorm);
  console.log(
    `syncRunPayrollFromPayrollImport: RunPayroll ${ok} inserted, ${failed} failed, ${dedupedBefore} deduped before, ${deletedMonth} deleted before insert, ${deduped} deduped after, ${alignResult.updated} aligned with Payroll (month=${monthNorm})`
  );
  let verifyCount = 0;
  try {
    const monthEscaped = monthNorm.replace(/'/g, "''");
    const cq = `SELECT COUNT(ROWID) AS cnt FROM RunPayroll WHERE Month_filter = '${monthEscaped}'`;
    const crows = await catalystApp.zcql().executeZCQLQuery(cq);
    const cr = crows?.[0]?.RunPayroll ?? crows?.[0] ?? {};
    verifyCount = Number(cr.cnt ?? cr.CNT ?? 0) || 0;
  } catch (verifyErr) {
    console.log('syncRunPayrollFromPayrollImport: post-sync count skipped:', verifyErr.message);
  }
  const storedCount = Math.max(ok, verifyCount);
  return {
    ok: storedCount > 0 && failed === 0,
    inserted: ok,
    failed,
    deleted: deletedMonth,
    deduped,
    month: monthNorm,
    verifyCount,
    firstError: failed > 0 ? firstError : undefined,
    skipped: false
  };
}

/** Monthly LOH grace (hours) — same as payslip Late / payroll LOH threshold. */
const PERMISSION_LOH_GRACE_HOURS = 1.5;

function parsePayrollLohHours(raw) {
  const n = parseFloat(String(raw ?? '').replace(/,/g, '').trim());
  if (!Number.isFinite(n)) return 0;
  return parseFloat(n.toFixed(2));
}

/** Qualify when payroll row has any LOH hours saved (> 0). */
function employeeQualifiesForPermissionReport(lohHours) {
  return parsePayrollLohHours(lohHours) > 0;
}

function permissionUsedFromPayrollLoh(lohHours) {
  const stored = parsePayrollLohHours(lohHours);
  if (stored <= 0) return String(PERMISSION_LOH_GRACE_HOURS);
  if (stored < PERMISSION_LOH_GRACE_HOURS) return String(stored);
  return String(PERMISSION_LOH_GRACE_HOURS);
}

async function getPermissionReportTable(catalystApp) {
  try {
    const table = catalystApp.datastore().table('PermissionReport');
    await table.getAllRows({ maxRecords: 1 });
    return table;
  } catch (e) {
    console.log('getPermissionReportTable: table unavailable:', e?.message || e);
    return null;
  }
}

async function clearPermissionReportTable(catalystApp, permissionTable) {
  const zcql = catalystApp.zcql();
  let existing = [];
  try {
    existing = await zcql.executeZCQLQuery('SELECT ROWID FROM PermissionReport');
  } catch (e) {
    console.log('clearPermissionReportTable: no rows or query failed:', e?.message || e);
    return;
  }
  for (const row of existing || []) {
    const rid = row?.PermissionReport?.ROWID ?? row?.ROWID;
    if (!rid) continue;
    try {
      await permissionTable.deleteRow({ ROWID: rid });
    } catch (delErr) {
      console.warn(`clearPermissionReportTable: delete ROWID ${rid}:`, delErr?.message || delErr);
    }
  }
}

/**
 * Rebuild PermissionReport from payroll rows where monthly LOH exceeds 1.5h grace
 * (employees for whom payroll applies the 1.5h subtraction on Late / LOH).
 */
async function syncPermissionReportFromPayrollMonth(catalystApp, month, payrollDataOptional) {
  const permissionTable = await getPermissionReportTable(catalystApp);
  if (!permissionTable) {
    return { ok: false, skipped: true, reason: 'PermissionReport table not found' };
  }

  let qualifying = [];
  if (Array.isArray(payrollDataOptional) && payrollDataOptional.length > 0) {
    qualifying = payrollDataOptional
      .filter((r) => employeeQualifiesForPermissionReport(r.loh ?? r.LOH))
      .map((r) => ({
        EmployeeName: String(r.employeeName ?? r.EmployeeName ?? '').trim(),
        EmployeeId: String(r.employeeCode ?? r.EmployeeId ?? r.employeeId ?? '').trim(),
        PermissionApplicable: String(PERMISSION_LOH_GRACE_HOURS),
        PermissionUsed: permissionUsedFromPayrollLoh(r.loh ?? r.LOH),
      }))
      .filter((r) => r.EmployeeId);
  } else if (month) {
    const monthEsc = String(month).replace(/'/g, "''").trim();
    const rows = await catalystApp.zcql().executeZCQLQuery(
      `SELECT EmployeeName, EmployeeCode, LOH FROM Payroll WHERE Month_filter = '${monthEsc}'`
    );
    qualifying = (rows || [])
      .map((row) => row.Payroll || row)
      .filter((p) => employeeQualifiesForPermissionReport(p.LOH))
      .map((p) => ({
        EmployeeName: String(p.EmployeeName || '').trim(),
        EmployeeId: String(p.EmployeeCode || '').trim(),
        PermissionApplicable: String(PERMISSION_LOH_GRACE_HOURS),
        PermissionUsed: permissionUsedFromPayrollLoh(p.LOH),
      }))
      .filter((r) => r.EmployeeId);
  }

  await clearPermissionReportTable(catalystApp, permissionTable);
  let inserted = 0;
  let failed = 0;
  for (const row of qualifying) {
    try {
      await permissionTable.insertRow(row);
      inserted++;
    } catch (insErr) {
      failed++;
      console.error(`syncPermissionReportFromPayrollMonth: insert ${row.EmployeeId}:`, insErr?.message || insErr);
    }
  }
  console.log(
    `syncPermissionReportFromPayrollMonth: month=${month}, inserted=${inserted}, failed=${failed}, qualifying=${qualifying.length}`
  );
  return { ok: failed === 0, inserted, failed, qualifying: qualifying.length };
}

function isAutomaticDatastoreYes(value) {
  const s = String(value ?? '').trim().toLowerCase();
  return s === 'yes' || s === 'true' || s === '1' || s === 'y';
}

/** Insert SamplePayroll row; retries without TravelChargers and/or OtherAllowance if columns are missing from the table schema. */
async function insertSamplePayrollRowCascade(sampleTable, rowInput) {
  const hasTravelKey =
    Object.prototype.hasOwnProperty.call(rowInput, 'TravelChargers') ||
    Object.prototype.hasOwnProperty.call(rowInput, 'travelchargers');
  const hasOaKey =
    Object.prototype.hasOwnProperty.call(rowInput, 'OtherAllowance') ||
    Object.prototype.hasOwnProperty.call(rowInput, 'otherAllowance');
  const stripTravel = (o) => {
    const { TravelChargers, travelchargers, ...r } = o;
    return r;
  };
  const stripOa = (o) => {
    const { OtherAllowance, otherAllowance, ...r } = o;
    return r;
  };
  const attempts = [rowInput];
  if (hasTravelKey) attempts.push(stripTravel(rowInput));
  if (hasOaKey) attempts.push(stripOa(rowInput));
  if (hasTravelKey && hasOaKey) attempts.push(stripOa(stripTravel(rowInput)));
  const seen = new Set();
  let lastErr;
  for (const att of attempts) {
    const sig = Object.keys(att)
      .sort()
      .join('|');
    if (seen.has(sig)) continue;
    seen.add(sig);
    try {
      await sampleTable.insertRow(att);
      return;
    } catch (e) {
      lastErr = e;
      const m = String(e?.message || e || '').toLowerCase();
      if (!/invalid|unknown|column|not exist|does not exist|not found/.test(m)) throw e;
    }
  }
  throw lastErr;
}

/** Read column from Catalyst row (API keys may vary in casing). */
function getAutomaticTableCell(row, ...candidateNames) {
  if (!row || typeof row !== 'object') return '';
  const keys = Object.keys(row);
  for (const want of candidateNames) {
    const w = String(want).toLowerCase();
    const hit = keys.find((k) => String(k).toLowerCase() === w);
    if (hit !== undefined) return row[hit];
  }
  return '';
}

function getRowCreatedMillis(row) {
  let raw = String(
    getAutomaticTableCell(row, 'CREATEDTIME', 'CreatedTime', 'createdtime', 'CREATED_TIME') ||
      row?.CREATEDTIME ||
      ''
  ).trim();
  // Cloud Scale / Catalyst often returns "YYYY-MM-DD HH:mm:ss:ms" (colon before ms) — not valid in Date()
  const zohoMs = raw.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2}):(\d{1,6})$/);
  if (zohoMs) {
    const ms = zohoMs[3].padEnd(3, '0').slice(0, 3);
    raw = `${zohoMs[1]}T${zohoMs[2]}.${ms}`;
  } else {
    raw = raw.replace(' ', 'T');
  }
  const t = new Date(raw).getTime();
  return Number.isFinite(t) ? t : 0;
}

/**
 * Latest row by CREATEDTIME then ROWID — restores payroll mode checkboxes.
 * @param {string} [monthKey] When set (YYYY-MM), only rows whose ButtonMonth matches are used; if none, defaults to Automatic only.
 * When omitted, uses the newest row in the table (legacy / global behavior).
 */
async function getLatestAutomaticModeFlags(catalystApp, monthKey) {
  const automaticTable = await getPayrollAutomaticModeTable(catalystApp);
  if (!automaticTable) return { automatic: false, manual: false, empty: true };
  const rows = [];
  let nextToken = undefined;
  do {
    const paged = await automaticTable.getPagedRows({ nextToken, maxRows: 300 });
    const chunk = Array.isArray(paged?.data) ? paged.data : [];
    rows.push(...chunk);
    nextToken = paged?.next_token;
  } while (nextToken);
  const normalizedMonth = monthKey ? normalizeSamplePayrollMonthKey(monthKey) : '';
  let candidates = rows;
  if (normalizedMonth) {
    candidates = rows.filter((r) => {
      const bm = normalizeSamplePayrollMonthKey(
        getAutomaticTableCell(r, 'ButtonMonth', 'buttonmonth', 'BUTTONMONTH', 'button_month')
      );
      return bm === normalizedMonth;
    });
    if (candidates.length === 0) {
      return { automatic: true, manual: false, empty: true };
    }
  }
  candidates.sort((a, b) => {
    const tb = getRowCreatedMillis(b);
    const ta = getRowCreatedMillis(a);
    if (tb !== ta) return tb - ta;
    return (Number(b.ROWID) || 0) - (Number(a.ROWID) || 0);
  });
  const latest = candidates[0];
  if (!latest) return { automatic: false, manual: false, empty: true };
  const autoVal = getAutomaticTableCell(latest, 'Automatic', 'automatic');
  const manualVal = getAutomaticTableCell(latest, 'Manual', 'manual');
  return {
    automatic: isAutomaticDatastoreYes(autoVal),
    manual: isAutomaticDatastoreYes(manualVal),
    empty: false
  };
}

/** First match for employee code variants (raw, normalized, numeric string). */
function pickEmployeeKeyedMapValue(map, empId) {
  if (!map || empId == null || empId === '') return undefined;
  const s = String(empId).trim();
  if (!s) return undefined;
  if (map[s] !== undefined && map[s] !== null) return map[s];
  const norm = normalizeEmployeeCode(s);
  if (norm && map[norm] !== undefined && map[norm] !== null) return map[norm];
  const n = parseInt(s, 10);
  if (!Number.isNaN(n)) {
    const ns = String(n);
    if (map[ns] !== undefined && map[ns] !== null) return map[ns];
  }
  return undefined;
}

/**
 * Per employee, take OTHours from the Payroll row with the highest ROWID in this result set.
 * Fixes frontend showing automatic/fetched OT when an older duplicate row was used but the user saved OT on the latest row.
 */
function buildLatestSavedOTHoursMapFromPayrollRows(payrollRowResults) {
  const bestByNorm = new Map();
  const rowIdNum = (p) => {
    const n = Number(p.ROWID ?? p.rowid ?? 0);
    return Number.isFinite(n) ? n : 0;
  };
  for (const rec of payrollRowResults || []) {
    const p = rec?.Payroll;
    if (!p) continue;
    const code = String(p.EmployeeCode || '').trim();
    if (!code) continue;
    const norm = normalizeEmployeeCode(code) || code;
    const rid = rowIdNum(p);
    const otRaw = p.OTHours ?? p.othours;
    if (otRaw === null || otRaw === undefined || String(otRaw).trim() === '') continue;
    const otNum = parseFloat(otRaw);
    if (!Number.isFinite(otNum)) continue;
    const otRounded = parseFloat(otNum.toFixed(3));
    const prev = bestByNorm.get(norm);
    if (!prev || rid >= prev.rowId) {
      bestByNorm.set(norm, { rowId: rid, ot: otRounded });
    }
  }
  const map = {};
  for (const rec of payrollRowResults || []) {
    const p = rec?.Payroll;
    if (!p) continue;
    const code = String(p.EmployeeCode || '').trim();
    if (!code) continue;
    const norm = normalizeEmployeeCode(code) || code;
    const best = bestByNorm.get(norm);
    if (!best) continue;
    if (rowIdNum(p) !== best.rowId) continue;
    map[code] = best.ot;
    map[norm] = best.ot;
    const n = parseInt(code, 10);
    if (!Number.isNaN(n)) map[String(n)] = best.ot;
  }
  return map;
}

/**
 * Per employee, RevisedLOH comes only from the Payroll row with the highest ROWID.
 * If that latest row has no RevisedLOH (cleared), do not fall back to an older row — use LOH-derived on GET.
 * Zero on the latest row is kept when explicitly saved.
 */
function buildLatestSavedRevisedLOHMapFromPayrollRows(payrollRowResults) {
  const latestByNorm = new Map();
  const rowIdNum = (p) => {
    const n = Number(p.ROWID ?? p.rowid ?? 0);
    return Number.isFinite(n) ? n : 0;
  };
  for (const rec of payrollRowResults || []) {
    const p = rec?.Payroll;
    if (!p) continue;
    const code = String(p.EmployeeCode || '').trim();
    if (!code) continue;
    const norm = normalizeEmployeeCode(code) || code;
    const rid = rowIdNum(p);
    const revRaw = p.RevisedLOH ?? p.revisedLOH ?? p.revisedloh;
    const revParsed = parseSavedRevisedLohField(revRaw);
    const prev = latestByNorm.get(norm);
    if (!prev || rid >= prev.rowId) {
      latestByNorm.set(norm, { rowId: rid, revised: revParsed });
    }
  }
  const map = {};
  for (const rec of payrollRowResults || []) {
    const p = rec?.Payroll;
    if (!p) continue;
    const code = String(p.EmployeeCode || '').trim();
    if (!code) continue;
    const norm = normalizeEmployeeCode(code) || code;
    const best = latestByNorm.get(norm);
    if (!best || rowIdNum(p) !== best.rowId) continue;
    if (best.revised === undefined) continue;
    map[code] = best.revised;
    map[norm] = best.revised;
    const n = parseInt(code, 10);
    if (!Number.isNaN(n)) map[String(n)] = best.revised;
  }
  return map;
}

/** Same as OT map but for LOH — newest Payroll ROWID per employee wins; zero is omitted so muster can supply LOH. */
function buildLatestSavedLOHMapFromPayrollRows(payrollRowResults) {
  const bestByNorm = new Map();
  const rowIdNum = (p) => {
    const n = Number(p.ROWID ?? p.rowid ?? 0);
    return Number.isFinite(n) ? n : 0;
  };
  for (const rec of payrollRowResults || []) {
    const p = rec?.Payroll;
    if (!p) continue;
    const code = String(p.EmployeeCode || '').trim();
    if (!code) continue;
    const norm = normalizeEmployeeCode(code) || code;
    const rid = rowIdNum(p);
    const lohRaw = p.LOH ?? p.loh;
    if (lohRaw === null || lohRaw === undefined || String(lohRaw).trim() === '') continue;
    const lohNum = parseFloat(lohRaw);
    if (!Number.isFinite(lohNum) || lohNum === 0) continue;
    const lohRounded = parseFloat(lohNum.toFixed(2));
    const prev = bestByNorm.get(norm);
    if (!prev || rid >= prev.rowId) {
      bestByNorm.set(norm, { rowId: rid, loh: lohRounded });
    }
  }
  const map = {};
  for (const rec of payrollRowResults || []) {
    const p = rec?.Payroll;
    if (!p) continue;
    const code = String(p.EmployeeCode || '').trim();
    if (!code) continue;
    const norm = normalizeEmployeeCode(code) || code;
    const best = bestByNorm.get(norm);
    if (!best) continue;
    if (rowIdNum(p) !== best.rowId) continue;
    map[code] = best.loh;
    map[norm] = best.loh;
    const n = parseInt(code, 10);
    if (!Number.isNaN(n)) map[String(n)] = best.loh;
  }
  return map;
}

function normalizeSamplePayrollMonthKey(val) {
  const s = String(val ?? '').trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{4})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}`;
  const d = new Date(s);
  if (!isNaN(d.getTime())) return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  return s;
}

function buildPayrollImportEmployeeKeySet(payrollData) {
  const keys = new Set();
  if (!Array.isArray(payrollData)) return keys;
  for (const r of payrollData) {
    const raw = String(r?.employeeCode ?? '').trim();
    if (!raw) continue;
    keys.add(raw);
    const norm = normalizeEmployeeCode(raw);
    if (norm) keys.add(norm);
    if (/^\d+$/.test(raw)) keys.add(String(parseInt(raw, 10)));
  }
  return keys;
}

function payrollImportRowMatchesEmployeeKeySet(employeeCode, keySet) {
  const raw = String(employeeCode ?? '').trim();
  if (!raw || !keySet.size) return false;
  if (keySet.has(raw)) return true;
  const norm = normalizeEmployeeCode(raw);
  if (norm && keySet.has(norm)) return true;
  if (/^\d+$/.test(raw) && keySet.has(String(parseInt(raw, 10)))) return true;
  return false;
}

/**
 * Remove SamplePayroll rows for the same month and employees in this import so a re-import replaces
 * overrides instead of losing to selectBestSamplePayrollRowsByEmployee (older row with higher days/LOH).
 */
async function clearSamplePayrollImportTargetsForMonth(sampleTable, month, payrollData) {
  if (!sampleTable || !month || !Array.isArray(payrollData) || payrollData.length === 0) return;
  const targetMonth = normalizeSamplePayrollMonthKey(month);
  if (!targetMonth) return;
  const keySet = buildPayrollImportEmployeeKeySet(payrollData);
  const sampleRows = [];
  let nextTok = undefined;
  do {
    const pg = await sampleTable.getPagedRows({ nextToken: nextTok, maxRows: 300 });
    sampleRows.push(...(Array.isArray(pg?.data) ? pg.data : []));
    nextTok = pg?.next_token;
  } while (nextTok);
  const idsToDelete = [];
  for (const pr of sampleRows) {
    const code = String(getAutomaticTableCell(pr, 'EmployeeCode', 'employeecode') || '').trim();
    if (!payrollImportRowMatchesEmployeeKeySet(code, keySet)) continue;
    const rowMonth = normalizeSamplePayrollMonthKey(
      getAutomaticTableCell(pr, 'Month_filter', 'month_filter', 'MonthFilter')
    );
    if (rowMonth === targetMonth) {
      const rid = pr.ROWID ?? pr.SamplePayroll?.ROWID;
      if (rid != null) idsToDelete.push(rid);
    }
  }
  for (const rid of idsToDelete) {
    try {
      await sampleTable.deleteRow(rid);
    } catch (delErr) {
      console.warn(`clearSamplePayrollImportTargetsForMonth: delete ROWID ${rid} failed:`, delErr?.message || delErr);
    }
  }
  if (idsToDelete.length) {
    console.log(
      `SamplePayroll: removed ${idsToDelete.length} existing row(s) for month ${targetMonth} before import (manual mode)`
    );
  }
}

/** Month_filter–scoped rows (plus legacy blank-month fallback) for payroll month. */
function getMonthScopedSamplePayrollRows(sortedRows, month) {
  const targetMonth = normalizeSamplePayrollMonthKey(month);
  if (!targetMonth) return sortedRows;
  const monthRows = [];
  const legacyRows = [];
  for (const r of sortedRows) {
    const rowMonth = normalizeSamplePayrollMonthKey(
      getAutomaticTableCell(r, 'Month_filter', 'month_filter', 'MonthFilter')
    );
    if (rowMonth === targetMonth) monthRows.push(r);
    else if (!rowMonth) legacyRows.push(r);
  }
  const seenFromMonth = new Set();
  for (const r of monthRows) {
    const code = String(getAutomaticTableCell(r, 'EmployeeCode', 'employeecode') || '').trim();
    if (!code) continue;
    seenFromMonth.add(normalizeEmployeeCode(code) || code);
  }
  const monthScopedRows = [...monthRows];
  for (const r of legacyRows) {
    const code = String(getAutomaticTableCell(r, 'EmployeeCode', 'employeecode') || '').trim();
    if (!code) continue;
    const norm = normalizeEmployeeCode(code) || code;
    if (seenFromMonth.has(norm)) continue;
    monthScopedRows.push(r);
  }
  return monthScopedRows;
}

/**
 * Pick one SamplePayroll row per employee: prefer rows that specify Days Present (including 0), then
 * newer ROWID (last import / Save Payroll mirror / PUT edit wins). LOH is still merged separately via
 * supplementLohMapFromAllSampleRows so a newer row without LOH does not lose hours from an older row.
 */
function selectBestSamplePayrollRowsByEmployee(monthScopedRows) {
  const bestSampleRowByEmp = new Map();
  const toNumSafe = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const sampleRowScore = (pr) => {
    const dpRaw = getAutomaticTableCell(pr, 'DaysPresent', 'dayspresent');
    const dp = toNumSafe(dpRaw);
    const hasDp = dpRaw !== null && dpRaw !== undefined && String(dpRaw).trim() !== '';
    const lohRaw = getAutomaticTableCell(pr, 'LOH', 'loh');
    const lohN = parseFloat(lohRaw);
    const hasLohVal = lohRaw != null && String(lohRaw).trim() !== '' && !Number.isNaN(lohN);
    const lohVal = hasLohVal ? lohN : 0;
    return {
      dpPositive: dp > 0 ? 1 : 0,
      hasDp: hasDp ? 1 : 0,
      dp,
      hasLohVal: hasLohVal ? 1 : 0,
      lohVal,
      rowId: toNumSafe(pr?.ROWID)
    };
  };
  const isBetterSampleRow = (a, b) => {
    if (!b) return true;
    if (a.hasDp !== b.hasDp) return a.hasDp > b.hasDp;
    if (a.rowId !== b.rowId) return a.rowId > b.rowId;
    if (a.hasLohVal !== b.hasLohVal) return a.hasLohVal > b.hasLohVal;
    if (a.lohVal !== b.lohVal) return a.lohVal > b.lohVal;
    if (a.dpPositive !== b.dpPositive) return a.dpPositive > b.dpPositive;
    if (a.dp !== b.dp) return a.dp > b.dp;
    return false;
  };
  for (const pr of monthScopedRows) {
    const code = String(getAutomaticTableCell(pr, 'EmployeeCode', 'employeecode') || '').trim();
    if (!code) continue;
    const norm = normalizeEmployeeCode(code) || code;
    const existing = bestSampleRowByEmp.get(norm);
    const candScore = sampleRowScore(pr);
    const existingScore = existing ? sampleRowScore(existing) : null;
    if (isBetterSampleRow(candScore, existingScore)) {
      bestSampleRowByEmp.set(norm, pr);
    }
  }
  return bestSampleRowByEmp;
}

/** For each employee, set loh[objKey] to max existing vs any positive LOH on rows in month (catch split across rows). */
function supplementLohMapFromAllSampleRows(monthScopedRows, lohObj, payrollLohLockedNorm) {
  for (const pr of monthScopedRows) {
    const code = String(getAutomaticTableCell(pr, 'EmployeeCode', 'employeecode') || '').trim();
    if (!code) continue;
    const norm = normalizeEmployeeCode(code) || code;
    if (payrollLohLockedNorm && payrollLohLockedNorm.has(norm)) continue;
    const lohC = getAutomaticTableCell(pr, 'LOH', 'loh');
    if (lohC == null || String(lohC).trim() === '') continue;
    const lv = parseFloat(lohC);
    if (Number.isNaN(lv) || lv <= 0) continue;
    const lr = parseFloat(lv.toFixed(2));
    const keys = [norm, code];
    const cn = String(parseInt(code, 10));
    if (cn && !Number.isNaN(parseInt(code, 10))) keys.push(cn);
    for (const k of keys) {
      if (!k) continue;
      const cur = Number(lohObj[k]) || 0;
      if (lr > cur) lohObj[k] = lr;
    }
  }
}

/**
 * Latest row per employee from SamplePayroll (ROWID desc) when Manual mode is on.
 * Same source as Excel import so refresh can restore days / OT / basic.
 * When month is provided, only rows with matching Month_filter are used.
 */
async function fetchLatestSamplePayrollOverrideMaps(catalystApp, month) {
  const empty = () => ({
    manualMode: false,
    daysInMonth: {},
    daysPresent: {},
    otHours: {},
    loh: {},
    actualBasic: {},
    travelChargers: {},
    otherAllowance: {}
  });
  try {
    const flags = await getLatestAutomaticModeFlags(catalystApp, month);
    if (!flags.manual) return empty();
    const sampleTn = await getSamplePayrollTable(catalystApp);
    if (!sampleTn) {
      console.log('fetchLatestSamplePayrollOverrideMaps: SamplePayroll table not found (manual mode on)');
      return { ...empty(), manualMode: true };
    }
    const sampleRows = [];
    let nextTok = undefined;
    do {
      const pg = await sampleTn.getPagedRows({ nextToken: nextTok, maxRows: 300 });
      sampleRows.push(...(Array.isArray(pg?.data) ? pg.data : []));
      nextTok = pg?.next_token;
    } while (nextTok);
    const targetMonth = normalizeSamplePayrollMonthKey(month);
    const sortedRows = [...sampleRows].sort((a, b) => (Number(b.ROWID) || 0) - (Number(a.ROWID) || 0));
    const monthScopedRows = getMonthScopedSamplePayrollRows(sortedRows, month);
    const daysInMonth = {};
    const daysPresent = {};
    const otHours = {};
    const loh = {};
    const actualBasic = {};
    const travelChargers = {};
    const otherAllowance = {};
    const bestSampleRowByEmp = selectBestSamplePayrollRowsByEmployee(monthScopedRows);
    for (const pr of bestSampleRowByEmp.values()) {
      const code = String(getAutomaticTableCell(pr, 'EmployeeCode', 'employeecode') || '').trim();
      if (!code) continue;
      const norm = normalizeEmployeeCode(code) || code;
      const dimC = getAutomaticTableCell(pr, 'DaysInMonth', 'daysinmonth');
      const dpC = getAutomaticTableCell(pr, 'DaysPresent', 'dayspresent');
      const otC = getAutomaticTableCell(pr, 'OTHours', 'othours');
      const lohC = getAutomaticTableCell(pr, 'LOH', 'loh');
      const abC = getAutomaticTableCell(pr, 'ActualBasic', 'actualbasic');
      const dim = parseFloat(dimC);
      const dp = parseFloat(dpC);
      const ot = parseFloat(otC);
      const lohValRaw = parseFloat(lohC);
      const ab = parseFloat(abC);
      const keys = [code, norm];
      const cn = String(parseInt(code, 10));
      if (cn && !Number.isNaN(parseInt(code, 10))) keys.push(cn);
      const putAll = (obj, val) => {
        for (const k of keys) {
          if (k) obj[k] = val;
        }
      };
      if (!Number.isNaN(dim) && dim > 0) putAll(daysInMonth, dim);
      if (dpC != null && String(dpC).trim() !== '' && !Number.isNaN(dp) && dp >= 0) putAll(daysPresent, dp);
      if (otC != null && String(otC).trim() !== '' && !Number.isNaN(ot) && ot >= 0) putAll(otHours, parseFloat(ot.toFixed(3)));
      if (lohC != null && String(lohC).trim() !== '' && !Number.isNaN(lohValRaw)) {
        putAll(loh, parseFloat(lohValRaw.toFixed(2)));
      }
      if (!Number.isNaN(ab) && ab > 0) putAll(actualBasic, ab);
      const tcC = getAutomaticTableCell(pr, 'TravelChargers', 'travelchargers', 'TravelCharges', 'Travel_Charges');
      if (tcC != null && String(tcC).trim() !== '') {
        const tcNum = parseFloat(tcC);
        if (!Number.isNaN(tcNum)) putAll(travelChargers, tcNum);
      }
      const oaC = getAutomaticTableCell(
        pr,
        'OtherAllowance',
        'otherallowance',
        'AttendanceAllowance',
        'attendanceallowance'
      );
      if (oaC != null && String(oaC).trim() !== '') {
        const oaNum = parseFloat(oaC);
        if (!Number.isNaN(oaNum)) putAll(otherAllowance, parseFloat(oaNum.toFixed(2)));
      }
    }
    supplementLohMapFromAllSampleRows(monthScopedRows, loh, null);
    console.log(
      `GET /payroll: Manual mode — merged SamplePayroll for ${bestSampleRowByEmp.size} employee(s) (month=${targetMonth || 'all'})`
    );
    return { manualMode: true, daysInMonth, daysPresent, otHours, loh, actualBasic, travelChargers, otherAllowance };
  } catch (e) {
    console.log('fetchLatestSamplePayrollOverrideMaps:', e.message);
    return empty();
  }
}

/** After Save Payroll in manual mode, append a SamplePayroll row so Run/refresh keeps days & OT. */
async function mirrorPayrollFieldsToSamplePayrollIfManual(catalystApp, row, monthForRow) {
  try {
    const flags = await getLatestAutomaticModeFlags(catalystApp, monthForRow);
    if (!flags.manual) return;
    const sampleTable = await getSamplePayrollTable(catalystApp);
    if (!sampleTable) {
      console.log('mirrorPayrollFieldsToSamplePayrollIfManual: SamplePayroll not found, skip');
      return;
    }
    const ec = String(row.EmployeeCode || '').trim();
    if (!ec) return;
    const travelStr = String(Number(row.TravelChargers ?? row.travelChargers ?? 0) || 0);
    const baseRow = {
      EmployeeCode: ec,
      EmployeeName: String(row.EmployeeName || ''),
      Department: String(row.Department || ''),
      DaysInMonth: String(row.DaysInMonth ?? ''),
      DaysPresent: String(row.DaysPresent ?? ''),
      OTHours: String(row.OTHours ?? ''),
      LOH: String(row.LOH ?? row.loh ?? ''),
      ActualBasic: String(row.ActualBasic ?? ''),
      OtherAllowance: String(Number(row.OtherAllowance ?? row.otherAllowance ?? 0) || 0),
      TravelChargers: travelStr
    };
    const monthVal = String(monthForRow ?? row.Month_filter ?? row.month_filter ?? row.MonthFilter ?? '');
    const withIncentiveAndMonth = {
      ...baseRow,
      Incentive: String(row.Incentive ?? row.incentive ?? ''),
      Month_filter: monthVal,
      month_filter: monthVal,
      MonthFilter: monthVal
    };
    const withMonthOnly = { ...baseRow, Month_filter: monthVal };
    const withIncentiveOnly = {
      ...baseRow,
      Incentive: String(row.Incentive ?? row.incentive ?? '')
    };
    try {
      await insertSamplePayrollRowCascade(sampleTable, withIncentiveAndMonth);
    } catch (insErr1) {
      try {
        await insertSamplePayrollRowCascade(sampleTable, withMonthOnly);
      } catch (insErr2) {
        try {
          await insertSamplePayrollRowCascade(sampleTable, withIncentiveOnly);
        } catch (insErr3) {
          await insertSamplePayrollRowCascade(sampleTable, baseRow);
        }
      }
    }
    console.log(`mirrorPayrollFieldsToSamplePayrollIfManual: SamplePayroll row appended for ${ec}`);
  } catch (e) {
    console.log('mirrorPayrollFieldsToSamplePayrollIfManual:', e.message);
  }
}

/**
 * Fetch payroll formulae from Setup (Components table, Formulas column).
 * Returns array of { variable, expression } e.g. { variable: 'Earned Basic', expression: 'Actual Basic / 8' }.
 */
async function getPayrollFormulae(catalystApp) {
  try {
    const table = catalystApp.datastore().table(COMPONENTS_TABLE);
    const rows = await table.getAllRows();
    const formulae = [];
    for (const row of rows) {
      const raw = (row.Formulas || '').trim();
      if (!raw) continue;
      const eqIdx = raw.indexOf('=');
      if (eqIdx === -1) continue;
      const variable = raw.slice(0, eqIdx).trim();
      const expression = raw.slice(eqIdx + 1).trim();
      if (variable && expression) formulae.push({ variable, expression });
    }
    return formulae;
  } catch (err) {
    console.log('getPayrollFormulae: could not read Setup formulae, using hardcoded calculations:', err.message);
    return [];
  }
}

/**
 * Get Actual salary components from Setup Configuration formulae when defined.
 * Returns { actualBasic, actualHRA, actualDA, specialAllowance } (numbers); when a formula is not found,
 * the corresponding value is null (caller should use Employee/Payroll value).
 * Evaluation order supports dependencies: Actual Basic -> Actual HRA -> Actual DA -> Special Allowance.
 */
function getActualBasicAndSpecialAllowanceFromFormulae(payrollFormulae, context) {
  let actualBasic = null;
  let actualHRA = null;
  let actualDA = null;
  let specialAllowance = null;
  if (!Array.isArray(payrollFormulae) || payrollFormulae.length === 0) return { actualBasic, actualHRA, actualDA, specialAllowance };
  const ctx = { ...context };
  for (const { variable, expression } of payrollFormulae) {
    const v = String(variable).trim();
    if (!v) continue;
    if (v === 'Actual Basic') {
      const num = evaluateFormulaExpression(expression, ctx);
      actualBasic = Number.isFinite(num) ? num : null;
      if (actualBasic !== null) ctx['Actual Basic'] = actualBasic;
    }
  }
  for (const { variable, expression } of payrollFormulae) {
    const v = String(variable).trim();
    if (!v) continue;
    if (v === 'Actual HRA') {
      const num = evaluateFormulaExpression(expression, ctx);
      actualHRA = Number.isFinite(num) ? num : null;
      if (actualHRA !== null) ctx['Actual HRA'] = actualHRA;
    }
  }
  for (const { variable, expression } of payrollFormulae) {
    const v = String(variable).trim();
    if (!v) continue;
    if (v === 'Actual DA') {
      const num = evaluateFormulaExpression(expression, ctx);
      actualDA = Number.isFinite(num) ? num : null;
      if (actualDA !== null) ctx['Actual DA'] = actualDA;
    }
  }
  for (const { variable, expression } of payrollFormulae) {
    const v = String(variable).trim();
    if (!v) continue;
    if (v === 'Special Allowance') {
      const num = evaluateFormulaExpression(expression, ctx);
      specialAllowance = Number.isFinite(num) ? num : null;
      if (specialAllowance !== null) ctx['Special Allowance'] = specialAllowance;
    }
  }
  return { actualBasic, actualHRA, actualDA, specialAllowance };
}

/**
 * Food Allowance: from Setup & Configuration only (not Employee form).
 * Variable name in formulae: "Food Allowance" or "Food Allownace" (typo).
 */
function getFoodAllowanceFromPayrollFormulae(payrollFormulae, foodContext) {
  if (!Array.isArray(payrollFormulae) || payrollFormulae.length === 0) return 0;
  const foodFormula = payrollFormulae.find((f) => {
    const v = String(f.variable).trim().toLowerCase();
    return v === 'food allowance' || v === 'food allownace';
  });
  if (!foodFormula || !foodFormula.expression) return 0;
  const n = evaluateFormulaExpression(foodFormula.expression, foodContext);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

/**
 * OT Amount from Setup & Configuration (Components → Formulas). Variable names: "OT Amount", "OTAmount".
 * Returns null when no formula is defined (caller uses default: Earned Basic / days in month / 8 × OT Hours × 2).
 */
function getOTAmountFromPayrollFormulae(payrollFormulae, otContext) {
  if (!Array.isArray(payrollFormulae) || payrollFormulae.length === 0) return null;
  const otFormula = payrollFormulae.find((f) => {
    const v = String(f.variable).trim().toLowerCase();
    return v === 'ot amount' || v === 'otamount';
  });
  if (!otFormula || !otFormula.expression) return null;
  const n = evaluateFormulaExpression(otFormula.expression, otContext);
  return Number.isFinite(n) ? n : null;
}

/**
 * OT Payment from Setup & Configuration. Variable names: "OT Payment", "OTPayment".
 * Default: Actual Total Gross / days in month / 8 × OT Hours × 2.
 */
function getOTPaymentFromPayrollFormulae(payrollFormulae, otContext) {
  if (!Array.isArray(payrollFormulae) || payrollFormulae.length === 0) return null;
  const otFormula = payrollFormulae.find((f) => {
    const v = String(f.variable).trim().toLowerCase();
    return v === 'ot payment' || v === 'otpayment';
  });
  if (!otFormula || !otFormula.expression) return null;
  const n = evaluateFormulaExpression(otFormula.expression, otContext);
  return Number.isFinite(n) ? n : null;
}

/** Late deduction from Setup & Configuration when a "Late" variable formula exists; otherwise 0. */
function getLateFromPayrollFormulae(payrollFormulae, lateContext) {
  if (!Array.isArray(payrollFormulae) || payrollFormulae.length === 0) return 0;
  const lateFormula = payrollFormulae.find((f) => String(f.variable).trim().toLowerCase() === 'late');
  if (!lateFormula || !lateFormula.expression) return 0;
  const n = evaluateFormulaExpression(lateFormula.expression, lateContext);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

/** Same variable matching as Payroll.js getPfDisplayValue (employee PF only, not employer). */
function findPfFormulaEntry(payrollFormulae) {
  if (!Array.isArray(payrollFormulae) || payrollFormulae.length === 0) return null;
  return (
    payrollFormulae.find((f) => {
      const v = String(f.variable || '').trim().toLowerCase();
      return (
        v === 'pf' ||
        v === 'pf 12%' ||
        (v.includes('pf') && !v.includes('employer') && (v.includes('12') || v.includes('%'))) ||
        v.includes('provident fund')
      );
    }) || null
  );
}

/**
 * Employee PF from Setup formula when defined (aligns with UI). Returns { ok: false } if no formula.
 * Omits the formula variable name from context so expressions do not substitute a stale PF.
 */
function getPFFromPayrollFormulae(payrollFormulae, pfContext) {
  const entry = findPfFormulaEntry(payrollFormulae);
  if (!entry || !entry.expression) return { ok: false, pf: 0 };
  const varTrim = String(entry.variable || '').trim();
  const ctx = { ...(pfContext || {}) };
  delete ctx[varTrim];
  delete ctx.PF;
  delete ctx['PF 12%'];
  const n = evaluateFormulaExpression(entry.expression, ctx);
  return {
    ok: true,
    pf: Number.isFinite(n) ? Math.round(Math.max(0, n)) : 0
  };
}

/** Statutory PF wage base (₹15k cap) for Admin / EDLI — from earned basic + earned special only. */
function getPfWageBaseFromEarned(earnedBasic, earnedSpecialAllowance) {
  const earnedPlus = (Number(earnedBasic) || 0) + (Number(earnedSpecialAllowance) || 0);
  if (earnedPlus <= 0) return 0;
  if (earnedPlus > 15000) return 15000;
  return earnedPlus;
}

/** PF amount + wage base: Setup formula when present, else Earned Basic > 15000 → 1800, else 12% of Earned Basic; pfWages uses combined earned (capped) for Admin/EDLI. */
function computePfLikePayrollUi(payrollFormulae, pfContext, earnedBasic, earnedSpecialAllowance) {
  const fr = getPFFromPayrollFormulae(payrollFormulae, pfContext);
  const eb = Number(earnedBasic) || 0;
  const es = Number(earnedSpecialAllowance) || 0;
  const pfWages = getPfWageBaseFromEarned(eb, es);
  if (fr.ok) return { pf: fr.pf, pfWages };
  if (eb <= 0) return { pf: 0, pfWages: 0 };
  if (eb > 15000) return { pf: 1800, pfWages: 15000 };
  return { pf: Math.round(eb * 0.12), pfWages };
}

/**
 * Evaluate a formula expression using a context of display names -> numbers.
 * Supports multi-word names (e.g. "Actual Basic"). Replaces identifiers with values then evaluates safely.
 * Any identifier not in context is replaced with 0 so the formula still evaluates (avoids returning 0 for one missing name).
 */
function evaluateFormulaExpression(expression, context) {
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
    // Replace any remaining identifiers (words / multi-word) with 0 so expression is valid
    expr = expr.replace(/\s+/g, ' ');
    expr = expr.replace(/\b[A-Za-z_][A-Za-z0-9_]*(?:\s+[A-Za-z_][A-Za-z0-9_]*)*\b/g, '0');
    expr = expr.replace(/\s+/g, '');
    if (!/^[\d\s+\-*/().]+$/.test(expr)) return 0;
    const fn = new Function('return (' + expr + ');');
    const result = fn();
    const n = Number(result);
    return Number.isFinite(n) ? Math.round(n) : 0;
  } catch (err) {
    console.log('evaluateFormulaExpression error:', expression, err.message);
    return 0;
  }
}

// Lightweight internal calculator used by the report endpoint to avoid HTTP self-calls
// Attendance Bonus: if days present = days in month → 0; else DOJ completed 1 year before month-end → 1200, else 800
function calcAttendanceBonus(dateOfJoining, daysPresent, daysInMonth, payrollMonth) {
  const dim = Number(daysInMonth) || 0;
  const dp = Number(daysPresent) || 0;
  if (!dateOfJoining || dim <= 0) return 0;
  if (Number(dp) === Number(dim)) return 0;
  const doj = new Date(dateOfJoining);
  if (isNaN(doj.getTime())) return 0;
  const parts = String(payrollMonth || '').split('-').map(Number);
  if (parts.length < 2) return 0;
  const lastDayOfMonth = new Date(parts[0], parts[1], 0); // day 0 of next month = last day of current month
  const oneYearBefore = new Date(lastDayOfMonth);
  oneYearBefore.setFullYear(oneYearBefore.getFullYear() - 1);
  return doj <= oneYearBefore ? 1200 : 800;
}

/** Normalize Data Store / ZCQL column names for set lookups (ignore spaces and underscores). */
function normalizePayrollColumnNameForSkip(name) {
  return String(name || '')
    .replace(/[\s_]/g, '')
    .toLowerCase();
}

/** UAN from Employee master (handles Catalyst / import column name variants). */
function pickUanNoFromRecord(rec) {
  if (!rec || typeof rec !== 'object') return '';
  const raw =
    rec.UANNo ?? rec.uanNo ?? rec.UAN ?? rec.uanNumber ?? rec['UAN No'] ?? rec.UAN_No ?? '';
  const s = String(raw ?? '').trim();
  return s === 'null' || s === 'undefined' ? '' : s;
}

/** ESIC from Employee master (handles Catalyst / import column name variants). */
function pickEsicNoFromRecord(rec) {
  if (!rec || typeof rec !== 'object') return '';
  const raw =
    rec.ESICNo ?? rec.esicNo ?? rec.ESIC ?? rec.esicNumber ?? rec['ESIC No'] ?? rec.ESIC_No ?? '';
  const s = String(raw ?? '').trim();
  return s === 'null' || s === 'undefined' ? '' : s;
}

/** After Payroll/Sample merges, keep statutory IDs from Employee when saved rows blanked them out. */
function applyEmployeeStatutoryIdsToPayrollRow(resultRow, employeeOrMaps) {
  if (!resultRow || !employeeOrMaps) return;
  const uan = pickUanNoFromRecord(employeeOrMaps);
  const esic = pickEsicNoFromRecord(employeeOrMaps);
  if (uan) {
    resultRow.uanNo = uan;
    resultRow.UANNo = uan;
  }
  if (esic) {
    resultRow.esicNo = esic;
    resultRow.ESICNo = esic;
  }
}

function lookupEmployeeStatutoryMaps(maps, employeeCode) {
  const ec = String(employeeCode || '').trim();
  if (!ec || !maps) return { uan: '', esic: '' };
  const norm = normalizeEmployeeCode(ec);
  const num = /^\d+$/.test(ec) ? String(parseInt(ec, 10)) : '';
  const uan =
    maps.uanNoMap?.[ec] ?? maps.uanNoMap?.[norm] ?? (num ? maps.uanNoMap?.[num] : '') ?? '';
  const esic =
    maps.esicNoMap?.[ec] ?? maps.esicNoMap?.[norm] ?? (num ? maps.esicNoMap?.[num] : '') ?? '';
  return { uan: String(uan || '').trim(), esic: String(esic || '').trim() };
}

/**
 * Columns on Payroll that are already computed or explicitly merged in computePayrollData.
 * Any other column on a saved row is treated as a Setup-defined custom component and copied onto the API row.
 */
const PAYROLL_STANDARD_COLUMN_SKIP = new Set(
  [
    'ROWID',
    'Month_filter',
    'month_filter',
    'EmployeeCode',
    'EmployeeName',
    'Department',
    'Category',
    'Contractor',
    'DaysInMonth',
    'DaysPresent',
    'OTHours',
    'LOH',
    'RevisedLOH',
    'LOP',
    'ActualBasic',
    'ActualHRA',
    'ActualDA',
    'OtherAllowance',
    'TravelChargers',
    'SpecialAllowance',
    'Incentive',
    'LoanAllowance',
    'FoodAllowance',
    'UniformAllowance',
    'WashingAllowance',
    'AttendanceBonus',
    'NoOfDaysWithoutUniforms',
    'Noofdayswithoutuniforms',
    'OtherAllowances',
    'ActualTotalSalary',
    'EarnedBasic',
    'EarnedHRA',
    'EarnedDA',
    'EarnedSpecialAllowance',
    'AttendanceAllowance',
    'EarnedAttendanceAllowance',
    'EarnedOtherAllowances',
    'Arrear',
    'ArrearForPF',
    'EarnedSalaryCross',
    'PF',
    'ESI',
    'EmployerESI',
    'ESIContribution',
    'TotalDeduction',
    'OTAmount',
    'OTArrearAmount',
    'OTESI',
    'OTPayment',
    'PayableAmount',
    'OTWages',
    'Rent',
    'Advance',
    'LWF',
    'EmployerLwf',
    'PT',
    'OtherDeduction',
    'NetPay',
    'TotalNetPayable',
    'ERPF',
    'ERPF13',
    'Admin',
    'EDLI',
    'ServiceCharge',
    'Total',
    'GST',
    'NetTotal',
    'BankHolderName',
    'BankName',
    'IFSCCode',
    'BankBranch',
    'Payslip',
    'Added_User',
    'Modified_User',
    'CREATEDTIME',
    'MODIFIEDTIME',
    'CREATEDBY',
    'MODIFIEDBY',
    'Owner',
    'OwnerName',
    'Payload',
    'Data',
    'Snapshot',
    'Json',
    'RowJson',
    'ButtonMonth',
    'Automatic',
    'Manual',
    'UANNo',
    'uanNo',
    'UAN',
    'ESICNo',
    'esicNo',
    'ESIC',
  ].map((c) => normalizePayrollColumnNameForSkip(c))
);

/**
 * Overlay custom Payroll table columns onto the computed payroll row (GET /payroll response).
 * Without this, ZCQL prefetches that list only fixed columns and edited Setup-only components disappear after refresh.
 */
function mergeSavedPayrollCustomColumnsIntoResultRow(resultRow, rawPayrollRow) {
  if (!resultRow || !rawPayrollRow || typeof rawPayrollRow !== 'object') return;
  for (const [k, v] of Object.entries(rawPayrollRow)) {
    if (v === undefined) continue;
    const nk = normalizePayrollColumnNameForSkip(k);
    if (!nk || PAYROLL_STANDARD_COLUMN_SKIP.has(nk)) continue;
    resultRow[k] = v;
  }
}

/**
 * Fill custom columns from an auxiliary row (RunPayroll snapshot or SamplePayroll import) only where
 * the API row still has no value — Payroll table saves win over Sample/Run; Sample fills gaps after Payroll.
 */
function mergeRunPayrollCustomFillGaps(resultRow, rawRunRow) {
  if (!resultRow || !rawRunRow || typeof rawRunRow !== 'object') return;
  for (const [k, v] of Object.entries(rawRunRow)) {
    if (v === undefined) continue;
    const nk = normalizePayrollColumnNameForSkip(k);
    if (!nk || PAYROLL_STANDARD_COLUMN_SKIP.has(nk)) continue;
    const cur = resultRow[k];
    const missing =
      cur === undefined ||
      cur === null ||
      (typeof cur === 'string' && String(cur).trim() === '');
    if (!missing) continue;
    resultRow[k] = v;
  }
}

async function computePayrollData(catalystApp, month, contractor, department, employeeId, fromDate, toDate, userEmail, userRole) {
  const result = [];
  // Check if this is January or December (month format: YYYY-MM)
  const isJanuary = month && month.endsWith('-01');
  const isDecember = month && month.endsWith('-12');
  // Build ZCQL query for employees
  let empWhereClause = '';
  if (contractor && contractor !== 'All') {
    const normalized = String(contractor || '').replace(/\s+/g, ' ').trim().replace(/'/g, "''");
    empWhereClause += ` AND ContractorName LIKE '%${normalized}%'`;
  }
  if (department && department !== 'All') empWhereClause += ` AND Department = '${department}'`;
  if (employeeId && employeeId !== 'All') empWhereClause += ` AND EmployeeCode = '${employeeId}'`;
  const buildEmpQuery = (includeSpecialAllowance, includeFoodUniform) => (
    `SELECT EmployeeCode, EmployeeName, Department, Category, Designation, ContractorName, ActualBasic, ActualHRA, ActualDA, AttendanceAllowance, OtherAllowance, TravelChargers, TotalSalary` +
    (includeSpecialAllowance ? `, SpecialAllowance, ActualSpecialAllowance` : ``) +
    (includeFoodUniform ? `, FoodAllowance, UniformAllowance` : ``) +
    `, BankHolderName, BankName, IFSCCode, BankBranch, PFStatus, ESIStatus, employeeStatus, DateofJoining, UANNo, ESICNo, RelevantExperience FROM Employee WHERE EmployeeCode IS NOT NULL ${empWhereClause}`
  );
  let empRecords = [];
  let empQueryHasFoodUniform = true;
  try {
    const empQuery = buildEmpQuery(true, true);
    empRecords = await catalystApp.zcql().executeZCQLQuery(empQuery);
    empQueryHasFoodUniform = true;
  } catch (empErr) {
    console.log('computePayrollData: Employee query with FoodAllowance failed, retrying without Food/Uniform columns:', empErr.message);
    try {
      const empQueryFallback = buildEmpQuery(true, false);
      empRecords = await catalystApp.zcql().executeZCQLQuery(empQueryFallback);
      empQueryHasFoodUniform = false;
    } catch (empErr2) {
      console.log('computePayrollData: Employee query retry 2 (no Special columns, with Food):', empErr2.message);
      try {
        const empQueryNoSpecial = buildEmpQuery(false, true);
        empRecords = await catalystApp.zcql().executeZCQLQuery(empQueryNoSpecial);
        empQueryHasFoodUniform = true;
      } catch (empErr2b) {
        console.log('computePayrollData: Employee query retry 3 (minimal columns):', empErr2b.message);
        empQueryHasFoodUniform = false;
        try {
          const empQueryNoFoodUniform = buildEmpQuery(false, false);
          empRecords = await catalystApp.zcql().executeZCQLQuery(empQueryNoFoodUniform);
        } catch (empErr3) {
          console.log('computePayrollData: Employee query fallback failed:', empErr3.message);
          throw empErr3;
        }
      }
    }
  }

  // Attendance summary using Attendance table (best effort)
  // Use custom date range if provided, otherwise use month-based range
  let startDate, endDateStr;
  if (fromDate && toDate) {
    startDate = fromDate;
    endDateStr = toDate;
    console.log('computePayrollData: Using custom date range:', { startDate, endDateStr });
  } else {
    startDate = `${month}-01`;
    const endDate = new Date(Number(month.split('-')[0]), Number(month.split('-')[1]), 0);
    endDateStr = `${month}-${String(endDate.getDate()).padStart(2, '0')}`;
    console.log('computePayrollData: Using month-based date range:', { startDate, endDateStr });
  }
  // Use date-based structure to properly merge with OnDuty and CompOff
  let attendanceByKey = {}; // Key: empId_date, Value: { employeeId, date, daysToAdd, source }
  try {
    // Get employee codes that match the filters to optimize attendance queries
    let filteredEmployeeCodes = [];
    if (employeeId && employeeId !== 'All') {
      filteredEmployeeCodes = [employeeId];
    } else {
      // When employeeId is 'All', get all employee codes that match contractor/department filters
      try {
        let empCodesQuery = `SELECT EmployeeCode FROM Employee WHERE EmployeeCode IS NOT NULL`;
        if (contractor && contractor !== 'All') {
          const normalized = String(contractor || '').replace(/\s+/g, ' ').trim().replace(/'/g, "''");
          empCodesQuery += ` AND ContractorName LIKE '%${normalized}%'`;
        }
        if (department && department !== 'All') empCodesQuery += ` AND Department = '${department}'`;
        const empCodesRecords = await catalystApp.zcql().executeZCQLQuery(empCodesQuery);
        filteredEmployeeCodes = empCodesRecords.map(row => row.Employee.EmployeeCode).filter(Boolean);
      } catch (empCodesErr) {
        filteredEmployeeCodes = []; // Empty means fetch all
      }
    }

    let attendanceQuery = `SELECT EmployeeId, AttendanceDate, FirstIn, LastOut, Status FROM Attendance WHERE AttendanceDate >= '${startDate}' AND AttendanceDate <= '${endDateStr}'`;
    // Filter by employee codes if we have them
    if (filteredEmployeeCodes.length > 0) {
      const empCodesList = filteredEmployeeCodes.map(code => `'${code}'`).join(',');
      attendanceQuery += ` AND EmployeeId IN (${empCodesList})`;
    } else if (employeeId && employeeId !== 'All') {
      attendanceQuery += ` AND EmployeeId = '${employeeId}'`;
    }
    // Helper: normalize provided status strings (matching Attendance Muster logic)
    const normalizeProvidedStatus = (val) => {
      if (!val) return '';
      const s = String(val).trim();
      const sUpper = s.toUpperCase();
      const sLower = s.toLowerCase();
      // Check for WO (Week Off) - case-insensitive
      if (sUpper === 'WO') return 'WO';
      // Check for H (Holiday) - case-insensitive, but only if it's a single letter 'H' or 'h'
      // If it's 'h' followed by other text (like 'half'), it's half day
      if (sUpper === 'H' && s.length === 1) return 'H';
      // Now check other statuses (convert to lowercase for comparison)
      if (sLower === 'p' || sLower === 'present' || sLower === 'full' || sLower === '1') return 'Present';
      if (sLower === 'h' || sLower === 'half' || sLower === 'half day' || sLower === '0.5' || sLower === 'half day present') return 'Half Day Present';
      if (sLower === 'a' || sLower === 'absent' || sLower === '0') return 'Absent';
      return '';
    };

    const attendanceRecords = await catalystApp.zcql().executeZCQLQuery(attendanceQuery);
 
    for (const row of attendanceRecords) {
      const a = row.Attendance;
      const empId = String(a.EmployeeId || ''); // Convert to string for consistent matching
      if (!empId) continue;
   
      // Normalize date
      let dateStr = '';
      if (a.AttendanceDate) {
        if (typeof a.AttendanceDate === 'string') {
          if (/^\d{4}-\d{2}-\d{2}$/.test(a.AttendanceDate)) {
            dateStr = a.AttendanceDate;
          } else {
            const tmp = new Date(a.AttendanceDate);
            if (!isNaN(tmp)) dateStr = tmp.toISOString().slice(0, 10);
          }
        } else {
          const tmp = new Date(a.AttendanceDate);
          if (!isNaN(tmp)) dateStr = tmp.toISOString().slice(0, 10);
        }
      }
      if (!dateStr || dateStr < startDate || dateStr > endDateStr) continue;
   
      const key = `${empId}_${dateStr}`;
      if (!attendanceByKey[key]) {
        attendanceByKey[key] = {
          employeeId: empId,
          date: dateStr,
          daysToAdd: 0,
          source: 'Attendance'
        };
      }
 
      // Check if status is provided first; time-based fallback matches attendance muster (under 4h = 0.5 day)
      const providedStatus = normalizeProvidedStatus(a.Status);
      const rawStatus = String(a.Status || '').trim().toUpperCase();
      let daysToAdd = 0;

      if (providedStatus === 'Present') {
        daysToAdd = 1;
      } else if (providedStatus === 'Half Day Present') {
        daysToAdd = 0.5;
      } else if (rawStatus === 'H') {
        // Holiday (H) counts as 1 day
        daysToAdd = 1;
      } else if (rawStatus === 'WO') {
        // Week Off (WO) counts as 1 day
        daysToAdd = 1;
      } else if (a.AttendanceDate && a.FirstIn && a.LastOut) {
        // Calculate from hours worked (same thresholds as attendance muster getStatus)
        const hoursWorked = calculateHoursWorked(a.FirstIn, a.LastOut, a.AttendanceDate);
        if (hoursWorked >= 4) {
          daysToAdd = 1;
        } else if (hoursWorked > 0) {
          daysToAdd = 0.5;
        }
      }
 
      if (daysToAdd > 0) {
        attendanceByKey[key].daysToAdd = daysToAdd;
      }
    }
  } catch (e) {
    // Keep existing attendanceByKey (may be empty)
    console.error('Error fetching attendance records:', e);
  }

  // Fetch OnDuty records for the month
  try {
    let ondutyOffset = 0;
    let ondutyHasMore = true;
    const ondutyPageSize = 300;
    const ondutyByKey = {}; // Key: empId_date

    while (ondutyHasMore) {
      let ondutyQuery = `SELECT EmployeeCode, EmployeeName, NoofHours, Reason, OnDutyDate, FirstIn, Lastout FROM OnDuty`;
   
      if (employeeId && employeeId !== 'All') {
        ondutyQuery += ` WHERE EmployeeCode = '${employeeId}'`;
      } else if (contractor && contractor !== 'All' && filteredEmployeeCodes.length > 0) {
        const employeeIdList = filteredEmployeeCodes.map(id => `'${id}'`).join(',');
        ondutyQuery += ` WHERE EmployeeCode IN (${employeeIdList})`;
      }
   
      ondutyQuery += ` ORDER BY EmployeeCode, OnDutyDate LIMIT ${ondutyPageSize} OFFSET ${ondutyOffset}`;
   
      const ondutyBatch = await catalystApp.zcql().executeZCQLQuery(ondutyQuery);
      const ondutyRows = ondutyBatch.map(r => r.OnDuty);
   
      if (ondutyRows.length === 0) {
        ondutyHasMore = false;
        break;
      }
   
      ondutyRows.forEach(r => {
        let dateStr = '';
        if (r.OnDutyDate) {
          if (typeof r.OnDutyDate === 'string') {
            if (/^\d{4}-\d{2}-\d{2}$/.test(r.OnDutyDate)) {
              dateStr = r.OnDutyDate;
            } else {
              const tmp = new Date(r.OnDutyDate);
              if (!isNaN(tmp)) dateStr = tmp.toISOString().slice(0, 10);
            }
          } else {
            const tmp = new Date(r.OnDutyDate);
            if (!isNaN(tmp)) dateStr = tmp.toISOString().slice(0, 10);
          }
        }
     
        if (!dateStr) return;
        if (dateStr < startDate || dateStr > endDateStr) return;
     
        const employeeCode = String(r.EmployeeCode || '').trim();
        if (!employeeCode) return;
     
        let ondutyStatus = 'Present';
        if (r.NoofHours) {
          const hours = String(r.NoofHours).trim().toLowerCase();
          if (hours === 'half day' || hours === 'halfday' || hours === '0.5') {
            ondutyStatus = 'Half Day Present';
          }
        }
     
        const key = `${employeeCode}_${dateStr}`;
        const daysToAdd = ondutyStatus === 'Present' ? 1 : (ondutyStatus === 'Half Day Present' ? 0.5 : 0);
        ondutyByKey[key] = daysToAdd;
      });
   
      ondutyOffset += ondutyPageSize;
      if (ondutyRows.length < ondutyPageSize) ondutyHasMore = false;
    }

    // Merge OnDuty into attendanceByKey (OnDuty takes precedence)
    Object.keys(ondutyByKey).forEach(key => {
      if (!attendanceByKey[key]) {
        const [empId, dateStr] = key.split('_');
        attendanceByKey[key] = {
          employeeId: empId,
          date: dateStr,
          daysToAdd: 0,
          source: 'OnDuty'
        };
      }
      // OnDuty overrides existing attendance for this date
      attendanceByKey[key].daysToAdd = ondutyByKey[key];
      attendanceByKey[key].source = attendanceByKey[key].source === 'Attendance' ? 'Both+OnDuty' : 'OnDuty';
    });
  } catch (ondutyError) {
    console.error('Error fetching OnDuty records in computePayrollData:', ondutyError);
  }

  // Fetch CompOff records for the month
  try {
    let compoffOffset = 0;
    let compoffHasMore = true;
    const compoffPageSize = 300;
    const compoffByKey = {}; // Key: empId_date

    while (compoffHasMore) {
      let compoffQuery = `SELECT EmployeeCode, EmployeeName, WorkedOn, Taken FROM Comboff`;
   
      if (employeeId && employeeId !== 'All') {
        compoffQuery += ` WHERE EmployeeCode = '${employeeId}'`;
      } else if (contractor && contractor !== 'All' && filteredEmployeeCodes.length > 0) {
        const employeeIdList = filteredEmployeeCodes.map(id => `'${id}'`).join(',');
        compoffQuery += ` WHERE EmployeeCode IN (${employeeIdList})`;
      }
   
      compoffQuery += ` ORDER BY EmployeeCode, Taken LIMIT ${compoffPageSize} OFFSET ${compoffOffset}`;
   
      const compoffBatch = await catalystApp.zcql().executeZCQLQuery(compoffQuery);
      const compoffRows = compoffBatch.map(r => r.Comboff);
   
      if (compoffRows.length === 0) {
        compoffHasMore = false;
        break;
      }
   
      compoffRows.forEach(r => {
        let dateStr = '';
        if (r.Taken) {
          if (typeof r.Taken === 'string') {
            if (/^\d{4}-\d{2}-\d{2}$/.test(r.Taken)) {
              dateStr = r.Taken;
            } else {
              const tmp = new Date(r.Taken);
              if (!isNaN(tmp)) dateStr = tmp.toISOString().slice(0, 10);
            }
          } else {
            const tmp = new Date(r.Taken);
            if (!isNaN(tmp)) dateStr = tmp.toISOString().slice(0, 10);
          }
        }
     
        if (!dateStr) return;
        if (dateStr < startDate || dateStr > endDateStr) return;
     
        const employeeCode = String(r.EmployeeCode || '').trim();
        if (!employeeCode) return;
     
        const key = `${employeeCode}_${dateStr}`;
        // CompOff marks as Present (1 day), but only if not already marked by OnDuty
        // Since we don't track dates precisely, we'll add CompOff days
        compoffByKey[key] = 1;
      });
   
      compoffOffset += compoffPageSize;
      if (compoffRows.length < compoffPageSize) compoffHasMore = false;
    }

    // Merge CompOff into attendanceByKey (CompOff takes precedence over Attendance but not OnDuty)
    Object.keys(compoffByKey).forEach(key => {
      if (!attendanceByKey[key]) {
        const [empId, dateStr] = key.split('_');
        attendanceByKey[key] = {
          employeeId: empId,
          date: dateStr,
          daysToAdd: 0,
          source: 'CompOff'
        };
      }
      // CompOff takes precedence over Attendance but not OnDuty
      const currentSource = attendanceByKey[key].source || '';
      if (!currentSource.includes('OnDuty')) {
        attendanceByKey[key].daysToAdd = compoffByKey[key]; // 1 day (Present)
        attendanceByKey[key].source = currentSource === 'Attendance' ? 'Both+CompOff' : 'CompOff';
      } else {
        // OnDuty already exists, just mark source
        attendanceByKey[key].source = currentSource.includes('CompOff') ? currentSource : currentSource + '+CompOff';
      }
    });

    // Convert attendanceByKey back to attendanceMap (employee totals)
    attendanceMap = {};
    Object.values(attendanceByKey).forEach(rec => {
      if (rec.daysToAdd > 0) {
        if (!attendanceMap[rec.employeeId]) {
          attendanceMap[rec.employeeId] = { totalDaysPresent: 0 };
        }
        attendanceMap[rec.employeeId].totalDaysPresent += rec.daysToAdd;
      }
    });
  } catch (compoffError) {
    console.error('Error fetching CompOff records in computePayrollData:', compoffError);
  }

  // Override with attendance muster calculation (ensures consistency with attendance muster)
  // Run muster and LOH+OT fetch in parallel to avoid execution time exceeded
  console.log('=== OVERRIDING WITH ATTENDANCE MUSTER CALCULATION ===');
  const lohOtPromise = fetchLOHAndOTFromMuster(catalystApp, month, contractor, department, employeeId, fromDate, toDate, userEmail, userRole);
  const musterPresentDaysMap = await calculatePresentDaysFromMuster(catalystApp, month, contractor, department, employeeId, fromDate, toDate);
  console.log(`Muster present days calculated for ${Object.keys(musterPresentDaysMap).length} employees`);
  const { lohMap, otHoursMap } = await lohOtPromise;

  // Update attendanceMap with muster data (muster is authoritative)
  // Also create a reverse lookup map for better matching
  const musterMapByString = {};
  const musterMapByNumber = {};
  Object.keys(musterPresentDaysMap).forEach(empId => {
    const empIdStr = String(empId).trim();
    const empIdNum = parseInt(empIdStr);
    musterMapByString[empIdStr] = musterPresentDaysMap[empId];
    if (!isNaN(empIdNum)) {
      musterMapByNumber[empIdNum] = musterPresentDaysMap[empId];
      musterMapByNumber[String(empIdNum)] = musterPresentDaysMap[empId];
    }
    // Also store with original key
    if (!attendanceMap[empId]) {
      attendanceMap[empId] = { totalDaysPresent: 0 };
    }
    if (!attendanceMap[empIdStr]) {
      attendanceMap[empIdStr] = { totalDaysPresent: 0 };
    }
    const oldDays = attendanceMap[empId].totalDaysPresent || attendanceMap[empIdStr].totalDaysPresent || 0;
    attendanceMap[empId].totalDaysPresent = musterPresentDaysMap[empId];
    attendanceMap[empIdStr].totalDaysPresent = musterPresentDaysMap[empId];
    if (oldDays !== musterPresentDaysMap[empId]) {
      console.log(`Employee ${empId}: Updated daysPresent from ${oldDays} to ${musterPresentDaysMap[empId]} (from muster)`);
    }
  });

  // Log muster matching summary for debugging
  console.log(`Muster map contains ${Object.keys(musterPresentDaysMap).length} employee IDs`);
  console.log(`Sample muster keys (first 10): ${Object.keys(musterPresentDaysMap).slice(0, 10).join(', ')}`);

  // Log LOH map summary for debugging contractor filter issues
  if (contractor && contractor !== 'All') {
    console.log(`=== LOH MAP SUMMARY FOR CONTRACTOR: ${contractor} ===`);
    console.log(`LOH map contains ${Object.keys(lohMap).length} employee IDs`);
    console.log(`Processing ${empRecords.length} employees from Employee table`);
    const empCodesFromTable = empRecords.map(row => String(row.Employee.EmployeeCode || '')).filter(Boolean);
    console.log(`Employee codes from Employee table (first 10): ${empCodesFromTable.slice(0, 10).join(', ')}`);
    const lohKeys = Object.keys(lohMap);
    console.log(`LOH map keys (first 10): ${lohKeys.slice(0, 10).join(', ')}`);
    // Check how many employee codes have matching LOH data
    let matchedCount = 0;
    for (const empCode of empCodesFromTable) {
      const empCodeStr = String(empCode).trim();
      if (lohMap[empCodeStr] !== undefined ||
          lohMap[String(parseInt(empCodeStr))] !== undefined) {
        matchedCount++;
      }
    }
    console.log(`LOH data matched for ${matchedCount} out of ${empCodesFromTable.length} employees`);
  }

  console.log(`=== LOH+OT from single fetch (computePayrollData) ===`);
  console.log(`   OT hours map contains ${Object.keys(otHoursMap).length} employee IDs`);
 
  // Log OT hours map summary for debugging
  console.log(`=== OT HOURS MAP SUMMARY (computePayrollData) ===`);
  console.log(`OT hours map contains ${Object.keys(otHoursMap).length} employee IDs`);
  console.log(`OT hours map type: ${typeof otHoursMap}, is object: ${otHoursMap && typeof otHoursMap === 'object'}`);
  if (Object.keys(otHoursMap).length > 0) {
    const otKeys = Object.keys(otHoursMap).slice(0, 20);
    console.log(`OT hours map keys (first 20): ${otKeys.join(', ')}`);
    // Check for employee 33021 specifically
    if (otHoursMap['33021'] !== undefined || otHoursMap[33021] !== undefined) {
      console.log(`✅ Employee 33021 found in OT map: ${otHoursMap['33021'] || otHoursMap[33021]} hours`);
    } else {
      console.log(`⚠️ Employee 33021 NOT found in OT map`);
      // Show all keys that contain "33021" for debugging
      const matchingKeys = Object.keys(otHoursMap).filter(key => String(key).includes('33021'));
      if (matchingKeys.length > 0) {
        console.log(`   Found keys containing "33021": ${matchingKeys.join(', ')}`);
      }
    }
    // Show sample OT values
    const sampleOTEntries = Object.entries(otHoursMap).slice(0, 10);
    console.log(`Sample OT hours values (first 10):`, sampleOTEntries.map(([id, hours]) => ({ employeeId: id, otHours: hours.toFixed(3) })));
  } else {
    console.log(`⚠️ WARNING: otHoursMap is empty - no OT hours fetched from attendance_muster_function`);
  }
 
  if (contractor && contractor !== 'All') {
    console.log(`=== OT HOURS MAP SUMMARY FOR CONTRACTOR: ${contractor} ===`);
    const empCodesFromTable = empRecords.map(row => String(row.Employee.EmployeeCode || '')).filter(Boolean);
    const otKeys = Object.keys(otHoursMap);
    console.log(`OT hours map keys (first 10): ${otKeys.slice(0, 10).join(', ')}`);
    // Check how many employee codes have matching OT hours data
    let matchedCount = 0;
    for (const empCode of empCodesFromTable) {
      const empCodeStr = String(empCode).trim();
      if (otHoursMap[empCodeStr] !== undefined ||
          otHoursMap[String(parseInt(empCodeStr))] !== undefined ||
          otHoursMap[parseInt(empCodeStr)] !== undefined) {
        matchedCount++;
      }
    }
    console.log(`OT hours data matched for ${matchedCount} out of ${empCodesFromTable.length} employees`);
  }

  const [yearNum, monthNum] = month.split('-').map(Number);
  const daysInMonth = getDaysInMonthExcludingSundays(yearNum, monthNum);

  // Prefetch Arrear, OtherAllowances, LOH, OT Hours, AttendanceAllowance, PF, and ESI from Payroll table for this month (so ESI/PF calculations can include arrear, and edits are preserved)
  const arrearMap = {};
  const arrearForPFMap = {};
  const otherAllowancesMap = {};
  const savedLOHMap = {}; // Map: employeeCode -> saved LOH value
  /** Payroll table had non-zero LOH for this normalized code — Sample/supplement must not overwrite that edit. */
  const payrollLohLockedNorm = new Set();
  const savedOTHoursMap = {}; // Map: employeeCode -> saved OT Hours value
  const savedRevisedLOHMap = {}; // Map: employeeCode -> saved Revised LOH (manual override)
  const savedOTArrearAmountMap = {}; // Map: employeeCode -> saved OT Arrear Amount value
  const savedActualAttendanceAllowanceMap = {}; // Map: employeeCode -> saved Actual Attendance Allowance (Payroll.OtherAllowance); when absent, payroll uses Employee.AttendanceAllowance column
  const savedAttendanceAllowanceMap = {}; // Map: employeeCode -> saved Earned Attendance Allowance value
  const savedEarnedAttendanceAllowanceMap = {}; // Map: employeeCode -> saved Earned Attendance Allowance value
  const savedPFMap = {}; // Map: employeeCode -> saved PF value
  const savedESIMap = {}; // Map: employeeCode -> saved ESI value
  const savedESIContributionMap = {}; // Map: employeeCode -> saved ESIContribution value (for service charge base)
  const savedRentMap = {}; // Map: employeeCode -> saved Rent (Rent Recovery) for Total Deduction
  const savedLWFMap = {}; // Map: employeeCode -> saved LWF value
  const savedPTMap = {}; // Map: employeeCode -> saved PT value
  const savedDaysInMonthMap = {}; // Map: employeeCode -> saved DaysInMonth (for earned basic formula)
  const savedDaysPresentMap = {}; // Map: employeeCode -> saved DaysPresent (for earned basic formula)
  const savedIncentiveMap = {}; // Map: employeeCode -> saved Incentive value
  const savedTravelChargersMap = {}; // Map: employeeCode -> saved Travel Chargers (Payroll); else Employee master
  const savedLoanAllowanceMap = {}; // Map: employeeCode -> saved Loan Allowance value
  const savedNoOfDaysWithoutUniformsMap = {}; // Map: employeeCode -> saved No of days without uniforms value
  const savedPayslipMap = {}; // Map: employeeCode -> saved Payslip checkbox value (true/false)
  /** Latest raw Payroll row per employee (SELECT *) — used to restore Setup-only custom columns after refresh. */
  const latestPayrollRawByNormalizedCode = new Map();
  /** Latest raw RunPayroll row per employee — custom columns often land here after Run Payroll. */
  const latestRunPayrollRawByNormalizedCode = new Map();
  /** Manual mode: latest SamplePayroll row per employee (Excel import) — fills custom columns not on Payroll. */
  const latestSamplePayrollRawByNormalizedCode = new Map();
  /** Manual mode: SamplePayroll row ActualBasic overrides Employee (same table as Excel import). */
  const sampleActualBasicMap = {};
  /** Manual mode: SamplePayroll TravelChargers when Payroll row has no saved travel (same as Excel import). */
  const sampleTravelChargersMap = {};
  /** Manual mode: SamplePayroll OtherAllowance (actual attendance allowance) when Payroll has no saved value. */
  const sampleOtherAllowanceMap = {};
  try {
    const empCodes = empRecords.map(r => String(r.Employee?.EmployeeCode || '').trim()).filter(Boolean);
    if (empCodes.length > 0) {
      const empCodesList = empCodes.map(code => `'${code.replace(/'/g, "''")}'`).join(',');
      const monthEscaped = String(month || '').replace(/'/g, "''");
      let payrollRows;
      const payrollQueryAllColumns = `SELECT * FROM Payroll WHERE Month_filter = '${monthEscaped}' AND EmployeeCode IN (${empCodesList}) ORDER BY ROWID DESC`;
      const payrollQueryWithPayslip = `SELECT ROWID, EmployeeCode, Arrear, ArrearForPF, OtherAllowance, OtherAllowances, LOH, OTHours, OTArrearAmount, AttendanceAllowance, EarnedAttendanceAllowance, PF, ESI, EmployerESI, ESIContribution, LWF, PT, Rent, DaysInMonth, DaysPresent, Incentive, TravelChargers, LoanAllowance, NoOfDaysWithoutUniforms, Noofdayswithoutuniforms, Payslip FROM Payroll WHERE Month_filter = '${monthEscaped}' AND EmployeeCode IN (${empCodesList}) ORDER BY ROWID DESC`;
      const payrollQueryWithoutPayslip = `SELECT ROWID, EmployeeCode, Arrear, ArrearForPF, OtherAllowance, OtherAllowances, LOH, OTHours, OTArrearAmount, AttendanceAllowance, EarnedAttendanceAllowance, PF, ESI, EmployerESI, ESIContribution, LWF, PT, Rent, DaysInMonth, DaysPresent, Incentive, TravelChargers, LoanAllowance, NoOfDaysWithoutUniforms, Noofdayswithoutuniforms FROM Payroll WHERE Month_filter = '${monthEscaped}' AND EmployeeCode IN (${empCodesList}) ORDER BY ROWID DESC`;
      try {
        payrollRows = await catalystApp.zcql().executeZCQLQuery(payrollQueryAllColumns);
      } catch (selectStarErr) {
        console.log('computePayrollData: SELECT * from Payroll failed, using fixed column list:', selectStarErr.message);
        try {
          payrollRows = await catalystApp.zcql().executeZCQLQuery(payrollQueryWithPayslip);
        } catch (payslipColErr) {
          payrollRows = await catalystApp.zcql().executeZCQLQuery(payrollQueryWithoutPayslip);
        }
      }
      const latestPayrollSeen = new Set();
      for (const r of payrollRows) {
        const p = r.Payroll;
        const code = String(p.EmployeeCode || '').trim();
        if (!code) continue;
        const normalizedCode = normalizeEmployeeCode(code);
        // ROWID DESC query: first row per employee is the latest saved row.
        if (latestPayrollSeen.has(normalizedCode)) continue;
        latestPayrollSeen.add(normalizedCode);
        try {
          const rawCopy = p && typeof p === 'object' ? { ...p } : {};
          latestPayrollRawByNormalizedCode.set(normalizedCode, rawCopy);
          if (code !== normalizedCode) latestPayrollRawByNormalizedCode.set(code, rawCopy);
          const codeNum = String(parseInt(code, 10));
          if (codeNum && !Number.isNaN(parseInt(code, 10))) latestPayrollRawByNormalizedCode.set(codeNum, rawCopy);
        } catch (rawCopyErr) {
          console.log('computePayrollData: could not stash raw Payroll row:', rawCopyErr.message);
        }
        arrearMap[normalizedCode] = parseFloat(p.Arrear) || 0;
        arrearForPFMap[normalizedCode] = parseFloat(p.ArrearForPF) || 0;
        // Only store saved OtherAllowances when it's a non-zero value (user override); 0 or empty = use Employee.OtherAllowance
        const savedOA = p.OtherAllowances;
        if (savedOA !== null && savedOA !== undefined && String(savedOA).trim() !== '') {
          const savedOANum = parseFloat(savedOA) || 0;
          if (savedOANum > 0) otherAllowancesMap[normalizedCode] = savedOANum;
        }
        // LOH from Payroll row: only non-zero counts as saved (matches OT Hours — zero means "use muster", not "user locked zero").
        if (p.LOH !== null && p.LOH !== undefined && String(p.LOH).trim() !== '') {
          const savedLOH = parseFloat(p.LOH);
          if (!isNaN(savedLOH) && savedLOH !== 0) {
            const lohRounded = parseFloat(savedLOH.toFixed(2));
            payrollLohLockedNorm.add(normalizedCode);
            savedLOHMap[normalizedCode] = lohRounded;
            if (code !== normalizedCode) savedLOHMap[code] = lohRounded;
            const codeNum = String(parseInt(code, 10));
            if (codeNum && !Number.isNaN(parseInt(code, 10))) savedLOHMap[codeNum] = lohRounded;
          }
        }
        // Check if OTHours exists in saved record (even if 0, it means user has set it)
        if (p.OTHours !== null && p.OTHours !== undefined && String(p.OTHours).trim() !== '') {
          const savedOTHours = parseFloat(p.OTHours) || 0;
          if (!isNaN(savedOTHours)) {
            savedOTHoursMap[normalizedCode] = parseFloat(savedOTHours.toFixed(3));
          }
        }
        // RevisedLOH: same persistence model as OTHours — keep explicit saved value (including 0)
        const savedRevParsed = parseSavedRevisedLohField(p.RevisedLOH ?? p.revisedLOH ?? p.revisedloh);
        if (savedRevParsed !== undefined) {
          savedRevisedLOHMap[normalizedCode] = savedRevParsed;
          if (code !== normalizedCode) savedRevisedLOHMap[code] = savedRevParsed;
          const codeNumRev = String(parseInt(code, 10));
          if (codeNumRev && !Number.isNaN(parseInt(code, 10))) savedRevisedLOHMap[codeNumRev] = savedRevParsed;
        }
        // OT Arrear Amount from saved Payroll
        if (p.OTArrearAmount !== null && p.OTArrearAmount !== undefined && String(p.OTArrearAmount).trim() !== '') {
          const savedOTA = parseFloat(p.OTArrearAmount) || 0;
          if (!isNaN(savedOTA)) savedOTArrearAmountMap[normalizedCode] = savedOTA;
        }
        // Actual Attendance Allowance (Payroll.OtherAllowance) - when saved in Payroll, use it; else payroll uses Employee.AttendanceAllowance column
        if (p.OtherAllowance !== null && p.OtherAllowance !== undefined && String(p.OtherAllowance).trim() !== '') {
          const savedActualAA = parseFloat(p.OtherAllowance) || 0;
          if (!isNaN(savedActualAA)) savedActualAttendanceAllowanceMap[normalizedCode] = parseFloat(savedActualAA.toFixed(2));
        }
        // Check if AttendanceAllowance exists in saved record (even if 0, it means user has set it)
        if (p.AttendanceAllowance !== null && p.AttendanceAllowance !== undefined && String(p.AttendanceAllowance).trim() !== '') {
          const savedAttendanceAllowance = parseFloat(p.AttendanceAllowance) || 0;
          if (!isNaN(savedAttendanceAllowance)) {
            savedAttendanceAllowanceMap[normalizedCode] = parseFloat(savedAttendanceAllowance.toFixed(2));
          }
        }
        // Check if EarnedAttendanceAllowance exists in saved record (even if 0, it means user has set it)
        if (p.EarnedAttendanceAllowance !== null && p.EarnedAttendanceAllowance !== undefined && String(p.EarnedAttendanceAllowance).trim() !== '') {
          const savedEarnedAttendanceAllowance = parseFloat(p.EarnedAttendanceAllowance) || 0;
          if (!isNaN(savedEarnedAttendanceAllowance)) {
            savedEarnedAttendanceAllowanceMap[normalizedCode] = parseFloat(savedEarnedAttendanceAllowance.toFixed(2));
          }
        }
        // Check if PF exists in saved record (even if 0, it means user has set it)
        if (p.PF !== null && p.PF !== undefined && String(p.PF).trim() !== '') {
          const savedPF = parseFloat(p.PF) || 0;
          if (!isNaN(savedPF)) {
            savedPFMap[normalizedCode] = parseFloat(savedPF.toFixed(2));
          }
        }
        // Check if ESI exists in saved record (even if 0, it means user has set it)
        if (p.ESI !== null && p.ESI !== undefined && String(p.ESI).trim() !== '') {
          const savedESI = parseFloat(p.ESI) || 0;
          if (!isNaN(savedESI)) {
            savedESIMap[normalizedCode] = parseFloat(savedESI.toFixed(2));
          }
        }
        // ESIContribution from saved record (for service charge base; default 0)
        const savedESIContrib = parseFloat(p.ESIContribution ?? p.esiContribution) || 0;
        if (!isNaN(savedESIContrib)) savedESIContributionMap[normalizedCode] = parseFloat(savedESIContrib.toFixed(2));
        // Rent (Rent Recovery) from saved record - included in Total Deduction
        const savedRent = parseFloat(p.Rent) || 0;
        if (!isNaN(savedRent)) savedRentMap[normalizedCode] = parseFloat(savedRent.toFixed(2));
        // Check if LWF exists in saved record (even if 0, it means user has set it)
        if (p.LWF !== null && p.LWF !== undefined && String(p.LWF).trim() !== '') {
          const savedLWF = parseFloat(p.LWF) || 0;
          if (!isNaN(savedLWF)) {
            savedLWFMap[normalizedCode] = parseFloat(savedLWF.toFixed(2));
          }
        }
        // Check if PT exists in saved record (only keep when > 0 so slab can recalc)
        if (p.PT !== null && p.PT !== undefined && String(p.PT).trim() !== '') {
          const savedPT = parseFloat(p.PT) || 0;
          if (!isNaN(savedPT) && savedPT > 0) {
            savedPTMap[normalizedCode] = parseFloat(savedPT.toFixed(2));
          }
        }
        // Saved DaysInMonth and DaysPresent for correct earned basic calculation (use working days / user edits when available)
        // Store under multiple keys so lookup by EmployeeCode (any format) always finds the value and earned basic uses same days as display
        if (p.DaysInMonth !== null && p.DaysInMonth !== undefined && String(p.DaysInMonth).trim() !== '') {
          const savedDim = parseFloat(p.DaysInMonth);
          if (!isNaN(savedDim) && savedDim > 0) {
            savedDaysInMonthMap[normalizedCode] = savedDim;
            if (code !== normalizedCode) savedDaysInMonthMap[code] = savedDim;
            const codeNum = String(parseInt(code));
            if (codeNum && !isNaN(parseInt(code))) savedDaysInMonthMap[codeNum] = savedDim;
          }
        }
        if (p.DaysPresent !== null && p.DaysPresent !== undefined && String(p.DaysPresent).trim() !== '') {
          const savedDp = parseFloat(p.DaysPresent);
          if (!isNaN(savedDp) && savedDp >= 0) {
            savedDaysPresentMap[normalizedCode] = savedDp;
            if (code !== normalizedCode) savedDaysPresentMap[code] = savedDp;
            const codeNum = String(parseInt(code));
            if (codeNum && !isNaN(parseInt(code))) savedDaysPresentMap[codeNum] = savedDp;
          }
        }
        // Incentive and Loan Allowance from saved Payroll (user edits)
        if (p.Incentive !== null && p.Incentive !== undefined && String(p.Incentive).trim() !== '') {
          const savedInv = parseFloat(p.Incentive) || 0;
          if (!isNaN(savedInv)) {
            savedIncentiveMap[normalizedCode] = savedInv;
            if (code !== normalizedCode) savedIncentiveMap[code] = savedInv;
          }
        }
        // Travel Chargers from saved Payroll (import / edit — same persistence model as Incentive)
        const rawTravelSaved = p.TravelChargers ?? p.travelChargers ?? '';
        if (rawTravelSaved !== null && rawTravelSaved !== undefined && String(rawTravelSaved).trim() !== '') {
          const savedTc = parseFloat(rawTravelSaved) || 0;
          if (!isNaN(savedTc)) {
            savedTravelChargersMap[normalizedCode] = savedTc;
            if (code !== normalizedCode) savedTravelChargersMap[code] = savedTc;
            const codeNum = String(parseInt(code, 10));
            if (codeNum && !Number.isNaN(parseInt(code, 10))) savedTravelChargersMap[codeNum] = savedTc;
          }
        }
        // LoanAllowance - support different DB column casings (e.g. LoanAllowance, loanallowance)
        const rawLoan = p.LoanAllowance ?? p.loanAllowance ?? p.Loanallowance ?? '';
        if (rawLoan !== null && rawLoan !== undefined && String(rawLoan).trim() !== '') {
          const savedLoan = parseFloat(rawLoan) || 0;
          if (!isNaN(savedLoan)) {
            savedLoanAllowanceMap[normalizedCode] = savedLoan;
            if (code !== normalizedCode) savedLoanAllowanceMap[code] = savedLoan;
          }
        }
        // NoOfDaysWithoutUniforms - support different DB column casings (e.g. Noofdayswithoutuniforms)
        const rawNoUniform = p.NoOfDaysWithoutUniforms ?? p.Noofdayswithoutuniforms ?? p.noofdayswithoutuniforms ?? p.Noofdayswithoutuniforms ?? '';
        if (rawNoUniform !== null && rawNoUniform !== undefined && String(rawNoUniform).trim() !== '') {
          const savedNoUniform = parseFloat(rawNoUniform) || 0;
          if (!isNaN(savedNoUniform) && savedNoUniform >= 0) {
            savedNoOfDaysWithoutUniformsMap[normalizedCode] = savedNoUniform;
            if (code !== normalizedCode) savedNoOfDaysWithoutUniformsMap[code] = savedNoUniform;
          }
        }
        // Payslip checkbox: support true/false, "true"/"false", 1/0
        const rawPayslip = p.Payslip ?? p.payslip;
        if (rawPayslip !== null && rawPayslip !== undefined) {
          const payslipVal = String(rawPayslip).toLowerCase() === 'true' || rawPayslip === true || Number(rawPayslip) === 1;
          savedPayslipMap[normalizedCode] = !!payslipVal;
          if (code !== normalizedCode) savedPayslipMap[code] = !!payslipVal;
        }
      }

      try {
        const runPayrollQuery = `SELECT * FROM RunPayroll WHERE Month_filter = '${monthEscaped}' AND EmployeeCode IN (${empCodesList}) ORDER BY ROWID DESC`;
        const runPayrollRows = await catalystApp.zcql().executeZCQLQuery(runPayrollQuery);
        const latestRunPayrollSeen = new Set();
        for (const r of runPayrollRows || []) {
          const rp = r.RunPayroll ?? r.runPayroll ?? r;
          if (!rp || typeof rp !== 'object') continue;
          const code = String(rp.EmployeeCode ?? rp.employeecode ?? '').trim();
          if (!code) continue;
          const normalizedCode = normalizeEmployeeCode(code);
          if (latestRunPayrollSeen.has(normalizedCode)) continue;
          latestRunPayrollSeen.add(normalizedCode);
          const rawRunCopy = { ...rp };
          latestRunPayrollRawByNormalizedCode.set(normalizedCode, rawRunCopy);
          if (code !== normalizedCode) latestRunPayrollRawByNormalizedCode.set(code, rawRunCopy);
          const codeNumRun = String(parseInt(code, 10));
          if (codeNumRun && !Number.isNaN(parseInt(code, 10))) {
            latestRunPayrollRawByNormalizedCode.set(codeNumRun, rawRunCopy);
          }
        }
      } catch (runPayrollPrefetchErr) {
        console.log('computePayrollData: RunPayroll SELECT * skipped:', runPayrollPrefetchErr.message);
      }

      // Manual payroll mode: latest row per employee from SamplePayroll (same store as Import Excel) overrides attendance/Payroll saves
      try {
        const manualPayrollMode = await getLatestAutomaticModeFlags(catalystApp, month);
        if (manualPayrollMode.manual) {
          const sampleTn = await getSamplePayrollTable(catalystApp);
          if (sampleTn) {
            const sampleRows = [];
            let nextTok = undefined;
            do {
              const pg = await sampleTn.getPagedRows({ nextToken: nextTok, maxRows: 300 });
              sampleRows.push(...(Array.isArray(pg?.data) ? pg.data : []));
              nextTok = pg?.next_token;
            } while (nextTok);
            sampleRows.sort((a, b) => (Number(b.ROWID) || 0) - (Number(a.ROWID) || 0));
            const monthScopedSample = getMonthScopedSamplePayrollRows(sampleRows, month);
            const bestByEmp = selectBestSamplePayrollRowsByEmployee(monthScopedSample);
            for (const pr of bestByEmp.values()) {
              const code = String(getAutomaticTableCell(pr, 'EmployeeCode', 'employeecode') || '').trim();
              if (!code) continue;
              const norm = normalizeEmployeeCode(code) || code;
              const dimC = getAutomaticTableCell(pr, 'DaysInMonth', 'daysinmonth');
              const dpC = getAutomaticTableCell(pr, 'DaysPresent', 'dayspresent');
              const otC = getAutomaticTableCell(pr, 'OTHours', 'othours');
              const lohSamC = getAutomaticTableCell(pr, 'LOH', 'loh');
              const abC = getAutomaticTableCell(pr, 'ActualBasic', 'actualbasic');
              const dim = parseFloat(dimC);
              const dp = parseFloat(dpC);
              const ot = parseFloat(otC);
              const lohSam = parseFloat(lohSamC);
              const ab = parseFloat(abC);
              if (!Number.isNaN(dim) && dim > 0) {
                savedDaysInMonthMap[norm] = dim;
                savedDaysInMonthMap[code] = dim;
                const cn = String(parseInt(code, 10));
                if (cn && !Number.isNaN(parseInt(code, 10))) savedDaysInMonthMap[cn] = dim;
              }
              if (dpC != null && String(dpC).trim() !== '' && !Number.isNaN(dp) && dp >= 0) {
                savedDaysPresentMap[norm] = dp;
                savedDaysPresentMap[code] = dp;
                const cn = String(parseInt(code, 10));
                if (cn && !Number.isNaN(parseInt(code, 10))) savedDaysPresentMap[cn] = dp;
              }
              if (otC != null && String(otC).trim() !== '' && !Number.isNaN(ot) && ot >= 0) {
                const otf = parseFloat(ot.toFixed(3));
                savedOTHoursMap[norm] = otf;
                savedOTHoursMap[code] = otf;
                const cn = String(parseInt(code, 10));
                if (cn && !Number.isNaN(parseInt(code, 10))) savedOTHoursMap[cn] = otf;
              }
              if (!payrollLohLockedNorm.has(norm) && lohSamC != null && String(lohSamC).trim() !== '' && !Number.isNaN(lohSam)) {
                const lohRounded = parseFloat(lohSam.toFixed(2));
                savedLOHMap[norm] = lohRounded;
                savedLOHMap[code] = lohRounded;
                const cn = String(parseInt(code, 10));
                if (cn && !Number.isNaN(parseInt(code, 10))) savedLOHMap[cn] = lohRounded;
              }
              if (!Number.isNaN(ab) && ab > 0) {
                sampleActualBasicMap[norm] = ab;
                sampleActualBasicMap[code] = ab;
                const cn = String(parseInt(code, 10));
                if (cn && !Number.isNaN(parseInt(code, 10))) sampleActualBasicMap[cn] = ab;
              }
              const tcSamC = getAutomaticTableCell(pr, 'TravelChargers', 'travelchargers', 'TravelCharges', 'Travel_Charges');
              if (tcSamC != null && String(tcSamC).trim() !== '') {
                const tcN = parseFloat(tcSamC);
                if (!Number.isNaN(tcN)) {
                  sampleTravelChargersMap[norm] = tcN;
                  sampleTravelChargersMap[code] = tcN;
                  const cnTc = String(parseInt(code, 10));
                  if (cnTc && !Number.isNaN(parseInt(code, 10))) sampleTravelChargersMap[cnTc] = tcN;
                }
              }
              const oaSamC = getAutomaticTableCell(
                pr,
                'OtherAllowance',
                'otherallowance',
                'AttendanceAllowance',
                'attendanceallowance'
              );
              if (oaSamC != null && String(oaSamC).trim() !== '') {
                const oaN = parseFloat(oaSamC);
                if (!Number.isNaN(oaN)) {
                  const oaRounded = parseFloat(oaN.toFixed(2));
                  sampleOtherAllowanceMap[norm] = oaRounded;
                  sampleOtherAllowanceMap[code] = oaRounded;
                  const cnOa = String(parseInt(code, 10));
                  if (cnOa && !Number.isNaN(parseInt(code, 10))) sampleOtherAllowanceMap[cnOa] = oaRounded;
                }
              }
              const rawSampleCopy = pr && typeof pr === 'object' ? { ...pr } : {};
              latestSamplePayrollRawByNormalizedCode.set(norm, rawSampleCopy);
              latestSamplePayrollRawByNormalizedCode.set(code, rawSampleCopy);
              const cnSp = String(parseInt(code, 10));
              if (cnSp && !Number.isNaN(parseInt(code, 10))) {
                latestSamplePayrollRawByNormalizedCode.set(cnSp, rawSampleCopy);
              }
            }
            supplementLohMapFromAllSampleRows(monthScopedSample, savedLOHMap, payrollLohLockedNorm);
            console.log(
              `computePayrollData: Manual mode — merged SamplePayroll rows for ${bestByEmp.size} employees (days present / OT / LOH / etc. persist after refresh)`
            );
          }
        }
      } catch (sampleMergeErr) {
        console.log('computePayrollData: SamplePayroll merge skipped:', sampleMergeErr.message);
      }

      if (Object.keys(savedLOHMap).length > 0) {
        console.log(`computePayrollData: Found saved LOH values for ${Object.keys(savedLOHMap).length} employees`);
      }
      if (Object.keys(savedOTHoursMap).length > 0) {
        console.log(`computePayrollData: Found saved OT Hours values for ${Object.keys(savedOTHoursMap).length} employees`);
      }
      if (Object.keys(savedRevisedLOHMap).length > 0) {
        console.log(`computePayrollData: Found saved Revised LOH values for ${Object.keys(savedRevisedLOHMap).length} employees`);
      }
      if (Object.keys(savedAttendanceAllowanceMap).length > 0) {
        console.log(`computePayrollData: Found saved Attendance Allowance values for ${Object.keys(savedAttendanceAllowanceMap).length} employees`);
      }
      if (Object.keys(savedPFMap).length > 0) {
        console.log(`computePayrollData: Found saved PF values for ${Object.keys(savedPFMap).length} employees`);
      }
      if (Object.keys(savedESIMap).length > 0) {
        console.log(`computePayrollData: Found saved ESI values for ${Object.keys(savedESIMap).length} employees`);
      }
      if (Object.keys(savedLWFMap).length > 0) {
        console.log(`computePayrollData: Found saved LWF values for ${Object.keys(savedLWFMap).length} employees`);
      }
      if (Object.keys(savedPTMap).length > 0) {
        console.log(`computePayrollData: Found saved PT values for ${Object.keys(savedPTMap).length} employees`);
      }
    }
  } catch (payrollErr) {
    console.log('computePayrollData: Error prefetching arrear/LOH/OTHours/AttendanceAllowance/PF/ESI from Payroll table, defaulting to 0:', payrollErr.message);
  }

  const payrollFormulae = await getPayrollFormulae(catalystApp);
  if (payrollFormulae.length > 0) {
    console.log('computePayrollData: Using Setup formulae for earned fields:', payrollFormulae.map((f) => `${f.variable} = ${f.expression}`));
  }

  for (const row of empRecords) {
    const emp = row.Employee;
    const empId = String(emp.EmployeeCode || ''); // Convert to string for consistent matching
    // Muster is authoritative - always check muster map first
    let daysPresent = 0;
    let foundInMuster = false;
    if (Object.keys(musterPresentDaysMap).length > 0) {
      // Try direct match
      if (musterPresentDaysMap[empId] !== undefined) {
        daysPresent = musterPresentDaysMap[empId];
        foundInMuster = true;
        console.log(`Employee ${empId}: Found in muster map (direct match): ${daysPresent} days`);
      } else {
        // Try with number conversion
        const empIdNum = parseInt(empId);
        if (!isNaN(empIdNum)) {
          if (musterPresentDaysMap[String(empIdNum)] !== undefined) {
            daysPresent = musterPresentDaysMap[String(empIdNum)];
            foundInMuster = true;
            console.log(`Employee ${empId}: Found in muster map (number match): ${daysPresent} days`);
          } else if (musterMapByNumber[empIdNum] !== undefined) {
            daysPresent = musterMapByNumber[empIdNum];
            foundInMuster = true;
            console.log(`Employee ${empId}: Found in muster map (number lookup): ${daysPresent} days`);
          }
        }
        // Try all keys in muster map for fuzzy matching
        if (!foundInMuster) {
          for (const musterKey in musterPresentDaysMap) {
            const musterKeyStr = String(musterKey).trim();
            const musterKeyNum = parseInt(musterKeyStr);
            const empIdNum = parseInt(empId);
            // Try exact string match
            if (musterKeyStr === empId) {
              daysPresent = musterPresentDaysMap[musterKey];
              foundInMuster = true;
              console.log(`Employee ${empId}: Found in muster map (fuzzy string match): ${daysPresent} days`);
              break;
            }
            // Try number match
            if (!isNaN(musterKeyNum) && !isNaN(empIdNum) && musterKeyNum === empIdNum) {
              daysPresent = musterPresentDaysMap[musterKey];
              foundInMuster = true;
              console.log(`Employee ${empId}: Found in muster map (fuzzy number match): ${daysPresent} days`);
              break;
            }
          }
        }
      }
     
      // If muster map exists but employee NOT found in it, set to 0 (no attendance data)
      if (!foundInMuster) {
        daysPresent = 0;
        console.log(`Employee ${empId}: NOT found in muster map - setting daysPresent to 0 (no attendance data)`);
      }
    } else {
      // If muster map is empty, fallback to attendanceMap
      daysPresent = attendanceMap[empId]?.totalDaysPresent || 0;
      if (daysPresent === 0) {
        // Try with number conversion
        const empIdNum = parseInt(empId);
        if (!isNaN(empIdNum)) {
          daysPresent = attendanceMap[String(empIdNum)]?.totalDaysPresent || 0;
        }
      }
    }
    // Use saved DaysPresent from Payroll table when available (so earned basic uses same days as display)
    const empIdStrLookup = String(empId).trim();
    const empIdNormLookup = normalizeEmployeeCode(empId);
    const empIdNumStr = String(parseInt(empId));
    const savedDaysPresent = savedDaysPresentMap[empId] ?? savedDaysPresentMap[empIdStrLookup] ?? savedDaysPresentMap[empIdNormLookup] ?? savedDaysPresentMap[empIdNumStr];
    if (savedDaysPresent !== undefined && savedDaysPresent !== null && !isNaN(savedDaysPresent) && savedDaysPresent >= 0) {
      daysPresent = savedDaysPresent;
    }
    // Prioritize non-zero saved LOH from Payroll / Sample; zero in Payroll is ignored so muster can populate (same as OT Hours).
    let loh = 0;
    let empIdStr = String(empId).trim();
    const savedLohPick =
      savedLOHMap[empId] ??
      savedLOHMap[empIdStrLookup] ??
      savedLOHMap[empIdNormLookup] ??
      savedLOHMap[empIdNumStr];
    if (savedLohPick !== undefined && savedLohPick !== null && Number.isFinite(Number(savedLohPick))) {
      loh = Number(savedLohPick);
      console.log(`Employee ${empId}: Using saved LOH value from Payroll table: ${loh} (preserving user edit)`);
    } else {
      if (isJanuary) {
        console.log(`Employee ${empId}: January month detected - using real-time data`);
      }
      // If no saved value exists, fetch from attendance_muster_function (lohMap)
      // Try multiple matching strategies to handle different data types
      // Strategy 1: Direct match
      if (lohMap[empId] !== undefined) {
        loh = lohMap[empId];
      }
   
      // Strategy 2: String conversion match
      if (loh === 0 && lohMap[empIdStr] !== undefined) {
        loh = lohMap[empIdStr];
      }
   
      // Strategy 3: Number conversion match
      if (loh === 0) {
        const empIdNum = parseInt(empId);
        if (!isNaN(empIdNum)) {
          const empIdNumStr = String(empIdNum);
          if (lohMap[empIdNumStr] !== undefined) {
            loh = lohMap[empIdNumStr];
          }
        }
      }
   
      // Strategy 4: Try all keys in lohMap to find a match (exact match after normalization)
      if (loh === 0 && Object.keys(lohMap).length > 0) {
        for (const key in lohMap) {
          const keyStr = String(key).trim();
          // Try exact match after converting both to numbers (if possible)
          const empIdNum = parseInt(empIdStr);
          const keyNum = parseInt(keyStr);
          if (!isNaN(empIdNum) && !isNaN(keyNum) && empIdNum === keyNum) {
            loh = lohMap[key];
            break;
          }
          // Try string match (case-insensitive)
          if (keyStr.toLowerCase() === empIdStr.toLowerCase()) {
            loh = lohMap[key];
            break;
          }
          // Try exact string match
          if (keyStr === empIdStr) {
            loh = lohMap[key];
            break;
          }
        }
      }
     
      if (loh > 0) {
        console.log(`Employee ${empId}: Using LOH from attendance_muster_function: ${loh.toFixed(2)}`);
      }
    }
 
    // Round to 2 decimal places
    loh = parseFloat((loh || 0).toFixed(2));

    // Get saved LWF and PT values
    let lwf = 0;
    let pt = 0;

    // Use saved LWF value if available
    if (savedLWFMap[empId] !== undefined) {
      lwf = savedLWFMap[empId];
    } else if (savedLWFMap[empIdStr] !== undefined) {
      lwf = savedLWFMap[empIdStr];
    }

    // For December months, set LWF to 20 rupees for all employees
    if (month.endsWith('-12')) {
      lwf = 20;
    }

    // PT is always calculated from salary slabs only (do not use saved PT from Payroll table)

    // Employer LWF contribution: static 40 for December months
    const employerLwf = (isDecember ? 40 : 0);

    const actualBasicEmp = getEmployeeNum(emp, 'ActualBasic', 'actualBasic', 'Actual Basic');
    let actualHRA = getEmployeeNum(emp, 'ActualHRA', 'actualHRA', 'Actual HRA');
    let actualDA = getEmployeeNum(emp, 'ActualDA', 'actualDA', 'Actual DA');
    const empIdNormForAA = normalizeEmployeeCode(empId);
    // Attendance Allowance (Payroll.OtherAllowance): saved Payroll, else Employee; in Manual mode SamplePayroll fills when Payroll has no saved value (same as Travel Chargers).
    const savedAAPick =
      savedActualAttendanceAllowanceMap[empId] ??
      savedActualAttendanceAllowanceMap[empIdStr] ??
      savedActualAttendanceAllowanceMap[empIdNormForAA] ??
      savedActualAttendanceAllowanceMap[String(parseInt(empId))];
    const hasSavedActualAttendanceAllowance =
      savedAAPick !== undefined &&
      savedAAPick !== null &&
      String(savedAAPick).trim() !== '' &&
      !Number.isNaN(Number(savedAAPick));
    let otherAllowance = hasSavedActualAttendanceAllowance
      ? Number(savedAAPick) || 0
      : Number(emp.AttendanceAllowance ?? emp.attendanceAllowance) || 0;
    const sampleOaRaw =
      sampleOtherAllowanceMap[empId] ??
      sampleOtherAllowanceMap[empIdStr] ??
      sampleOtherAllowanceMap[empIdNormForAA] ??
      sampleOtherAllowanceMap[String(parseInt(empId, 10))];
    if (
      !hasSavedActualAttendanceAllowance &&
      sampleOaRaw !== undefined &&
      sampleOaRaw !== null &&
      String(sampleOaRaw).trim() !== '' &&
      !Number.isNaN(Number(sampleOaRaw))
    ) {
      otherAllowance = Number(sampleOaRaw) || 0;
    }
    const travelChargersFromEmployee =
      getEmployeeNum(emp, 'TravelChargers', 'travelChargers', 'TravelCharges', 'Travel Charges', 'TravelCharger') || 0;
    const savedTravelPick =
      savedTravelChargersMap[empId] ??
      savedTravelChargersMap[empIdStr] ??
      savedTravelChargersMap[empIdNormForAA] ??
      savedTravelChargersMap[String(parseInt(empId, 10))];
    let travelChargers =
      savedTravelPick !== undefined && savedTravelPick !== null && !Number.isNaN(Number(savedTravelPick))
        ? Number(savedTravelPick) || 0
        : travelChargersFromEmployee;
    const sampleTcRaw =
      sampleTravelChargersMap[empId] ??
      sampleTravelChargersMap[empIdStr] ??
      sampleTravelChargersMap[empIdNormForAA] ??
      sampleTravelChargersMap[String(parseInt(empId, 10))];
    if (
      (savedTravelPick === undefined || savedTravelPick === null || Number.isNaN(Number(savedTravelPick))) &&
      sampleTcRaw !== undefined &&
      sampleTcRaw !== null &&
      !Number.isNaN(Number(sampleTcRaw))
    ) {
      travelChargers = Number(sampleTcRaw) || 0;
    }
    const specialAllowanceEmp = getEmployeeNum(emp, 'ActualSpecialAllowance', 'actualSpecialAllowance', 'SpecialAllowance', 'specialAllowance', 'Special Allowance');
    const uniformAllowance = 0;
    // OtherAllowances for actualTotalSalary: from saved Payroll override, else from Employee Other Allowance column
    const savedOtherAllowancesForTotal = otherAllowancesMap[empId] ?? otherAllowancesMap[empIdStr] ?? otherAllowancesMap[empIdNormForAA] ?? otherAllowancesMap[String(parseInt(empId))];
    const savedOANumForTotal = (savedOtherAllowancesForTotal !== undefined && savedOtherAllowancesForTotal !== null) ? (Number(savedOtherAllowancesForTotal) || 0) : 0;
    const empOANumForTotal = getEmployeeNum(emp, 'OtherAllowances', 'otherAllowances', 'OtherAllowance', 'otherAllowance', 'RevisedOtherAllowance', 'RevisedotherAllowance', 'Other Allowance');
    const otherAllowancesForTotal = savedOANumForTotal > 0 ? savedOANumForTotal : empOANumForTotal;
    const computedEmployeeFormTotalEmp = computedEmployeeFormActualTotalSalary(actualBasicEmp, actualHRA, actualDA, specialAllowanceEmp);
    let actualTotalSalary = resolveActualTotalSalaryFromEmployee(emp, computedEmployeeFormTotalEmp);
    // Actual Basic and Special Allowance: from Setup Configuration formulae when defined, else from Employee (PF and display use these)
    let actualBasic = actualBasicEmp;
    let specialAllowance = specialAllowanceEmp;
    if (payrollFormulae.length > 0) {
      const pfContext = {
        'Actual Total Salary': actualTotalSalary,
        'Actual Total Gross': actualTotalSalary,
        'Actual HRA': actualHRA,
        'Actual DA': actualDA,
        'Attendance Allowance': otherAllowance,
        'Other Allowances': otherAllowancesForTotal,
        'TravelChargers': travelChargers,
        'Travel Charges': travelChargers
      };
      const { actualBasic: abFromFormula, actualHRA: ahFromFormula, actualDA: adFromFormula, specialAllowance: saFromFormula } = getActualBasicAndSpecialAllowanceFromFormulae(payrollFormulae, pfContext);
      if (abFromFormula !== null) actualBasic = abFromFormula;
      if (ahFromFormula !== null) actualHRA = ahFromFormula;
      if (adFromFormula !== null) actualDA = adFromFormula;
      if (saFromFormula !== null) specialAllowance = saFromFormula;
      if (abFromFormula !== null || ahFromFormula !== null || adFromFormula !== null || saFromFormula !== null) {
        actualTotalSalary = computedEmployeeFormActualTotalSalary(actualBasic, actualHRA, actualDA, specialAllowance);
      }
    }
    const sampleAbRaw =
      sampleActualBasicMap[empId] ??
      sampleActualBasicMap[empIdStr] ??
      sampleActualBasicMap[empIdNormForAA] ??
      sampleActualBasicMap[String(parseInt(empId))];
    if (sampleAbRaw !== undefined && sampleAbRaw !== null && !Number.isNaN(sampleAbRaw) && sampleAbRaw > 0) {
      actualBasic = sampleAbRaw;
      actualTotalSalary = resolveActualTotalSalaryFromEmployee(
        emp,
        computedEmployeeFormActualTotalSalary(actualBasic, actualHRA, actualDA, specialAllowance)
      );
    }
    // Use saved DaysInMonth when available (e.g. working days 26) so earned basic matches UI and user expectations
    const savedDaysInMonth = savedDaysInMonthMap[empId] ?? savedDaysInMonthMap[empIdStr] ?? savedDaysInMonthMap[empIdNormForAA] ?? savedDaysInMonthMap[String(parseInt(empId))];
    const daysInMonthForCalc = (savedDaysInMonth !== undefined && savedDaysInMonth !== null && !isNaN(savedDaysInMonth) && savedDaysInMonth > 0) ? savedDaysInMonth : daysInMonth;
    if (isManagingPartnerDesignation(emp) && daysInMonthForCalc > 0) {
      daysPresent = daysInMonthForCalc;
    }
    // Earned Basic = (Actual Basic / No. of Days(In month) * No. of Days Present) - ((Actual Basic / No. of Days(In month)) / 8 * LOH)
    const dailyBasicRate = daysInMonthForCalc > 0 ? actualBasic / daysInMonthForCalc : 0;
    // Earned HRA = (Actual HRA / No. of Days(In month) * No. of Days Present) - ((Actual HRA / No. of Days(In month)) / 8 * LOH)
    const dailyHRARate = daysInMonthForCalc > 0 ? actualHRA / daysInMonthForCalc : 0;
    const dailyDARate = daysInMonthForCalc > 0 ? actualDA / daysInMonthForCalc : 0;
    // Earned Special Allowance = (Special Allowance / No. of Days(In month) * No. of Days Present)
    const dailySpecialRate = daysInMonthForCalc > 0 ? specialAllowance / daysInMonthForCalc : 0;
    let earnedBasicRaw = (dailyBasicRate * daysPresent) - ((dailyBasicRate / 8) * loh);
    let earnedBasic = Math.max(0, earnedBasicRaw);
    let earnedHRA = (dailyHRARate * daysPresent) - ((dailyHRARate / 8) * loh);
    let earnedDA = (dailyDARate * daysPresent) - ((dailyDARate / 8) * loh);
    let earnedSpecialAllowance = Math.max(0, dailySpecialRate * daysPresent);
    // Apply Setup formulae when defined (overrides hardcoded earned values so UI and backend match)
    if (payrollFormulae.length > 0) {
      const formulaContext = {
        'Actual Basic': actualBasic,
        'Actual HRA': actualHRA,
        'Actual DA': actualDA,
        'Days Present': daysPresent,
        'No. of Days Present': daysPresent,
        'LOH': loh,
        'Days In Month': daysInMonthForCalc,
        'No. of Days(In month)': daysInMonthForCalc,
        'No. of Days (In Month)': daysInMonthForCalc,
        'No. of Days in Month': daysInMonthForCalc,
        'Attendance Allowance': otherAllowance,
        'Other Allowances': otherAllowancesForTotal,
        'TravelChargers': travelChargers,
        'Travel Charges': travelChargers,
        'Special Allowance': specialAllowance,
        'Actual Total Gross': actualTotalSalary,
        'Earned Basic': earnedBasic,
        'Earned HRA': earnedHRA,
        'Earned DA': earnedDA,
        'Earned Special Allowance': earnedSpecialAllowance
      };
      for (const { variable, expression } of payrollFormulae) {
        const v = String(variable).trim();
        if (!v) continue;
        const num = evaluateFormulaExpression(expression, formulaContext);
        if (v === 'Earned Basic') earnedBasic = Math.max(0, num);
        else if (v === 'Earned HRA') earnedHRA = Math.max(0, num);
        else if (v === 'Earned DA') earnedDA = Math.max(0, num);
        else if (v === 'Earned Special Allowance') earnedSpecialAllowance = Math.max(0, num);
      }
    }
    // Always prioritize saved Earned Attendance Allowance from Payroll table (user edits should be preserved)
    // If no saved value, calculate using formula: (Actual Attendance Allowance / daysInMonth × daysPresent) - ((Actual Attendance Allowance / daysInMonth) / 8 × LOH)
    let earnedAttendanceAllowance = 0;
    const empIdStrForAA = String(empId).trim();
    if (savedEarnedAttendanceAllowanceMap[empId] !== undefined) {
      earnedAttendanceAllowance = savedEarnedAttendanceAllowanceMap[empId];
      console.log(`Employee ${empId}: Using saved Earned Attendance Allowance from EarnedAttendanceAllowance column: ${earnedAttendanceAllowance} (preserving user edit)`);
    } else if (savedEarnedAttendanceAllowanceMap[empIdStrForAA] !== undefined) {
      earnedAttendanceAllowance = savedEarnedAttendanceAllowanceMap[empIdStrForAA];
      console.log(`Employee ${empId}: Using saved Earned Attendance Allowance from EarnedAttendanceAllowance column: ${earnedAttendanceAllowance} (preserving user edit)`);
    } else if (savedAttendanceAllowanceMap[empId] !== undefined) {
      earnedAttendanceAllowance = savedAttendanceAllowanceMap[empId];
      console.log(`Employee ${empId}: Using saved Earned Attendance Allowance from AttendanceAllowance column: ${earnedAttendanceAllowance} (preserving user edit)`);
    } else if (savedAttendanceAllowanceMap[empIdStrForAA] !== undefined) {
      earnedAttendanceAllowance = savedAttendanceAllowanceMap[empIdStrForAA];
      console.log(`Employee ${empId}: Using saved Earned Attendance Allowance from AttendanceAllowance column: ${earnedAttendanceAllowance} (preserving user edit)`);
    } else {
      // Calculate using formula: (Actual Attendance Allowance / daysInMonth × daysPresent) - ((Actual Attendance Allowance / daysInMonth) / 8 × LOH)
      if (otherAllowance > 0) {
        const dailyAttendanceAllowanceRate = daysInMonthForCalc > 0 ? otherAllowance / daysInMonthForCalc : 0;
        earnedAttendanceAllowance = (dailyAttendanceAllowanceRate * daysPresent) - ((dailyAttendanceAllowanceRate / 8) * loh);
        console.log(`Employee ${empId}: Calculated Earned Attendance Allowance using formula: (${otherAllowance}/${daysInMonthForCalc}*${daysPresent}) - (${otherAllowance}/${daysInMonthForCalc}/8*${loh}) = ${earnedAttendanceAllowance}`);
      } else {
        earnedAttendanceAllowance = 0;
        console.log(`Employee ${empId}: No Actual Attendance Allowance found, Earned Attendance Allowance = 0`);
      }
    }
    // Earned Other Allowances = (OtherAllowances / daysInMonth * daysPresent) - ((OtherAllowances / daysInMonth) / 8 * LOH)
    // Use employee Other Allowance column when no saved override (same as otherAllowancesForTotal)
    const otherAllowancesOnly = savedOANumForTotal > 0 ? savedOANumForTotal : empOANumForTotal;
    const dailyOtherAllowancesRate = daysInMonthForCalc > 0 ? otherAllowancesOnly / daysInMonthForCalc : 0;
    const earnedOtherAllowances = (dailyOtherAllowancesRate * daysPresent) - ((dailyOtherAllowancesRate / 8) * loh);
    const arrear = Number(arrearMap[empId] ?? arrearMap[String(parseInt(empId))] ?? 0) || 0; // Arrear from Payroll table (month filter)
    const arrearForPF = Number(arrearForPFMap[empId] ?? arrearForPFMap[String(parseInt(empId))] ?? 0) || 0; // ArrearForPF from Payroll table
    const empIdNorm = empIdNormForAA;
    const incentive = Number(savedIncentiveMap[empId] ?? savedIncentiveMap[empIdStr] ?? savedIncentiveMap[empIdNorm] ?? savedIncentiveMap[String(parseInt(empId))] ?? 0) || 0; // Incentive from Payroll table when available
    const otArrearAmount = (savedOTArrearAmountMap[empId] ?? savedOTArrearAmountMap[empIdStr] ?? savedOTArrearAmountMap[normalizeEmployeeCode(empId)] ?? 0) || 0;
    const baseEarnedGross = earnedBasic + earnedHRA + earnedDA + earnedAttendanceAllowance + earnedOtherAllowances + arrear + arrearForPF + incentive + otArrearAmount;
    const pfStatus = String(emp.PFStatus || '').trim().toLowerCase();
    const isPfApplicable = pfStatus !== 'no';
    // PF: match payroll UI — Setup formula when defined, else 12% on Earned Basic + Earned Special (₹1800 cap).
    const pfFormulaContextCompute = {
      'Actual Basic': actualBasic,
      'Actual HRA': actualHRA,
      'Actual DA': actualDA,
      'Days Present': daysPresent,
      'No. of Days Present': daysPresent,
      'LOH': loh,
      'Days In Month': daysInMonthForCalc,
      'No. of Days(In month)': daysInMonthForCalc,
      'No. of Days (In Month)': daysInMonthForCalc,
      'No. of Days in Month': daysInMonthForCalc,
      'Special Allowance': specialAllowance,
      'Actual Total Gross': actualTotalSalary,
      'Earned Basic': earnedBasic,
      'Earned HRA': earnedHRA,
      'Earned DA': earnedDA,
      'Earned Special Allowance': earnedSpecialAllowance,
      'Attendance Allowance': otherAllowance,
      'Other Allowances': otherAllowancesForTotal,
      'Travel Charges': travelChargers,
      'TravelChargers': travelChargers
    };
    let pfWages;
    let pf;
    if (!isPfApplicable) {
      pf = 0;
      pfWages = 0;
    } else {
      const pfComputed = computePfLikePayrollUi(
        payrollFormulae,
        pfFormulaContextCompute,
        earnedBasic,
        earnedSpecialAllowance
      );
      pf = pfComputed.pf;
      pfWages = pfComputed.pfWages;
    }
   
    // Always prioritize saved OT Hours from Payroll table (user edits should be preserved)
    // If no saved value exists, fetch from attendance_muster_function
    let otHours = 0;
    // Reuse empIdStr from LOH matching above
    empIdStr = String(empId).trim();
   
    // Check if there's a saved OT Hours value for this employee
    if (savedOTHoursMap[empId] !== undefined) {
      otHours = savedOTHoursMap[empId];
      console.log(`Employee ${empId}: Using saved OT Hours value from Payroll table: ${otHours} (preserving user edit)`);
    } else if (savedOTHoursMap[empIdStr] !== undefined) {
      otHours = savedOTHoursMap[empIdStr];
      console.log(`Employee ${empId}: Using saved OT Hours value from Payroll table: ${otHours} (preserving user edit)`);
    } else {
      // If no saved value exists, fetch from attendance_muster_function
      let fetchedOT = 0;
      // Try multiple matching strategies to handle different data types
      if (otHoursMap[empId] !== undefined) {
        fetchedOT = otHoursMap[empId];
        console.log(`Employee ${empId}: Found OT hours via direct key match (key: ${empId}): ${fetchedOT}`);
      } else if (otHoursMap[empIdStr] !== undefined) {
        fetchedOT = otHoursMap[empIdStr];
        console.log(`Employee ${empId}: Found OT hours via string key match (key: "${empIdStr}"): ${fetchedOT}`);
      } else {
        const empIdNum = parseInt(empId);
        if (!isNaN(empIdNum) && otHoursMap[String(empIdNum)] !== undefined) {
          fetchedOT = otHoursMap[String(empIdNum)];
          console.log(`Employee ${empId}: Found OT hours via numeric string key match (key: "${String(empIdNum)}"): ${fetchedOT}`);
        } else if (!isNaN(empIdNum) && otHoursMap[empIdNum] !== undefined) {
          fetchedOT = otHoursMap[empIdNum];
          console.log(`Employee ${empId}: Found OT hours via numeric key match (key: ${empIdNum}): ${fetchedOT}`);
        } else {
          // Try all keys for fuzzy matching
          let foundKey = null;
          for (const otKey in otHoursMap) {
            const otKeyStr = String(otKey).trim();
            const otKeyNum = parseInt(otKeyStr);
            if (otKeyStr === empIdStr || otKeyStr === String(empId)) {
              fetchedOT = otHoursMap[otKey];
              foundKey = otKey;
              break;
            }
            if (!isNaN(otKeyNum) && !isNaN(empIdNum) && otKeyNum === empIdNum) {
              fetchedOT = otHoursMap[otKey];
              foundKey = otKey;
              break;
            }
          }
          if (foundKey) {
            console.log(`Employee ${empId}: Found OT hours via fuzzy match (matched key: "${foundKey}"): ${fetchedOT}`);
          }
        }
      }
      otHours = fetchedOT;
      if (fetchedOT > 0) {
        console.log(`Employee ${empId}: Using OT Hours from attendance_muster_function: ${otHours}`);
      } else {
        // Enhanced debugging for employee 33021
        if (empId === '33021' || empId === 33021 || String(empId).trim() === '33021') {
          console.log(`⚠️ DEBUG Employee 33021: No OT hours found. otHoursMap keys (first 30):`, Object.keys(otHoursMap).slice(0, 30));
          console.log(`   otHoursMap size: ${Object.keys(otHoursMap).length}`);
          console.log(`   Checking direct keys: otHoursMap['33021']=${otHoursMap['33021']}, otHoursMap[33021]=${otHoursMap[33021]}`);
        }
        console.log(`Employee ${empId}: No saved OT Hours value found and no OT hours from attendance_muster_function, defaulting to 0`);
      }
    }
   
    // Round to 3 decimal places to match reports function precision
    otHours = parseFloat((otHours || 0).toFixed(3));
   
    // OT Amount: Setup formula when defined; else daily-basic rule (not earnedBasic/dim twice — matches Payroll UI)
    const defaultOtAmount = computeDefaultOtAmountFromEarnedAndActual({
      earnedBasic,
      actualBasic,
      daysInMonth: daysInMonthForCalc,
      daysPresent,
      otHours
    });
    const otAmountBaseCtx = {
      'Actual Basic': actualBasic,
      'Actual HRA': actualHRA,
      'Actual DA': actualDA,
      'Special Allowance': specialAllowance,
      'Travel Charges': travelChargers,
      'TravelChargers': travelChargers,
      'Days Present': daysPresent,
      'No. of Days Present': daysPresent,
      'Days In Month': daysInMonthForCalc,
      'No. of Days in Month': daysInMonthForCalc,
      'No. of Days (In Month)': daysInMonthForCalc,
      'No. of Days(In month)': daysInMonthForCalc,
      'LOH': loh,
      'Earned Basic': earnedBasic,
      'Earned HRA': earnedHRA,
      'Earned DA': earnedDA,
      'Earned Special Allowance': earnedSpecialAllowance,
      'OT Hours': otHours,
      'Actual Total Gross': actualTotalSalary,
      'Actual Total Salary': actualTotalSalary,
      'Attendance Allowance': otherAllowance,
      'Other Allowances': otherAllowancesForTotal
    };
    const otAmountFromSetup = getOTAmountFromPayrollFormulae(payrollFormulae, otAmountBaseCtx);
    const otAmount = otAmountFromSetup !== null && otAmountFromSetup !== undefined ? Math.max(0, otAmountFromSetup) : defaultOtAmount;
    // Washing Allowance = 25 * (No. of Days Present - No. of days without uniform); clamp to 0 if negative
    const noOfDaysWithoutUniformsForWash = Number(savedNoOfDaysWithoutUniformsMap[empId] ?? savedNoOfDaysWithoutUniformsMap[empIdStr] ?? savedNoOfDaysWithoutUniformsMap[empIdNorm] ?? savedNoOfDaysWithoutUniformsMap[String(parseInt(empId))] ?? 0) || 0;
    const washingAllowanceForEarned = Math.round(25 * Math.max(0, daysPresent - noOfDaysWithoutUniformsForWash));
    // Earned Gross Salary = Travel Charges + OT Amount + Incentive + Attendance Bonus + Washing Allowance + Food Allowance + Earned Basic + Earned HRA + Earned Special Allowance (all from Setup/configuration or saved)
    const attendanceBonusForEarned = calcAttendanceBonus(emp.DateofJoining ?? emp.dateofjoining, daysPresent, daysInMonthForCalc, month);
    const foodAllowanceContext = {
      'Actual Basic': actualBasic,
      'Actual HRA': actualHRA,
      'Actual DA': actualDA,
      'Special Allowance': specialAllowance,
      'Travel Charges': travelChargers,
      'TravelChargers': travelChargers,
      'Days Present': daysPresent,
      'No. of Days Present': daysPresent,
      'Days In Month': daysInMonthForCalc,
      'No. of Days in Month': daysInMonthForCalc,
      'No. of Days (In Month)': daysInMonthForCalc,
      'LOH': loh,
      'Earned Basic': earnedBasic,
      'Earned HRA': earnedHRA,
      'Earned DA': earnedDA,
      'Earned Special Allowance': earnedSpecialAllowance,
      'OT Amount': otAmount,
      'OT Hours': otHours,
      'Incentive': incentive,
      'Attendance Bonus': attendanceBonusForEarned,
      'Washing Allowance': washingAllowanceForEarned,
      'Attendance Allowance': otherAllowance,
      'Other Allowances': otherAllowancesForTotal,
      'Actual Total Gross': actualTotalSalary,
      'Actual Total Salary': actualTotalSalary
    };
    const foodAllowance = getFoodAllowanceFromPayrollFormulae(payrollFormulae, foodAllowanceContext);
    const earnedSalaryCross = (travelChargers || 0) + (otAmount || 0) + (incentive || 0) + (attendanceBonusForEarned || 0) + (washingAllowanceForEarned || 0) + (foodAllowance || 0) + (earnedBasic || 0) + (earnedHRA || 0) + (earnedSpecialAllowance || 0);
    // PT calculation: always recalculated from Earned Gross Salary slabs (6-month basis: divide slabs and PT by 6)
    if (earnedSalaryCross >= 20001/6 && earnedSalaryCross <= 30000/6) {
      pt = 172/6;
    } else if (earnedSalaryCross >= 30001/6 && earnedSalaryCross <= 45000/6) {
      pt = 430/6;
    } else if (earnedSalaryCross >= 45001/6 && earnedSalaryCross <= 60000/6) {
      pt = 856/6;
    } else if (earnedSalaryCross >= 60001/6 && earnedSalaryCross <= 75000/6) {
      pt = 1250/6;
    } else if (earnedSalaryCross >= 75001/6) {
      pt = 1250/6;
    } else {
      pt = 0;
    }
   
    const defaultOtPayment = daysInMonthForCalc > 0 ? ((actualTotalSalary / daysInMonthForCalc) / 8) * otHours * 2 : 0;
    const otPaymentFromSetup = getOTPaymentFromPayrollFormulae(payrollFormulae, Object.assign({}, otAmountBaseCtx, { 'OT Amount': otAmount }));
    const otPayment = otPaymentFromSetup !== null && otPaymentFromSetup !== undefined ? Math.max(0, otPaymentFromSetup) : defaultOtPayment;
    const esiStatus = String(emp.ESIStatus || '').trim().toLowerCase();
    // ESI: if status is 'no' do not calculate; if 'yes' or blank/other, calculate (default to yes when not set so ESI is calculated)
    let isEsiApplicable;
    if (esiStatus === 'no') {
      isEsiApplicable = false;
    } else {
      // 'yes' or empty or any other value: calculate ESI (user must set 'no' to disable)
      isEsiApplicable = true;
    }
    // ESI base is Earned Gross Salary (which now includes OT Amount)
    const esiBase = earnedSalaryCross;
    // When ESI Status is "No" in Employee form, do not calculate ESI (ignore saved value and setup formula)
    let esi = 0;
    let employerEsi = 0;
    if (isEsiApplicable) {
      const attendanceBonusVal = calcAttendanceBonus(emp.DateofJoining ?? emp.dateofjoining, daysPresent, daysInMonthForCalc, month);
      const esiContext = {
        'Earned Gross Salary': earnedSalaryCross,
        'Earned Basic': earnedBasic,
        'Earned HRA': earnedHRA,
        'Earned Special Allowance': earnedSpecialAllowance,
        'Actual Basic': actualBasic,
        'Actual HRA': actualHRA,
        'Actual DA': actualDA,
        'Special Allowance': specialAllowance,
        'OT Hours': otHours,
        'OT Amount': otAmount,
        'Travel Charges': travelChargers,
        'TravelChargers': travelChargers,
        'Attendance Bonus': attendanceBonusVal,
        'Food Allowance': foodAllowance,
        'Food Allownace': foodAllowance,
        'Days Present': daysPresent,
        'Days In Month': daysInMonthForCalc,
        'LOH': loh,
        'Incentive': incentive
      };
      const esiFormula = Array.isArray(payrollFormulae) && payrollFormulae.find((f) => {
        const v = String(f.variable).trim().toLowerCase();
        return v === 'esi 0.75%' || v === 'esi';
      });
      if (esiFormula && esiFormula.expression) {
        const esiFromFormula = evaluateFormulaExpression(esiFormula.expression, esiContext);
        esi = Number.isFinite(esiFromFormula) ? Math.max(0, Math.ceil(esiFromFormula)) : 0;
        if (esi > 0) employerEsi = esiBase * 0.0325;
        console.log(`Employee ${empId}: ESI from Setup formula = ${esi}`);
      } else {
        // Default: ESI = (Earned Basic + OT Amount + Incentive) * 0.75%. When sum is 0 or less, ESI = 0.
        const esiBaseComponents = earnedBasic + otAmount + incentive;
        if (esiBaseComponents <= 0) {
          esi = 0;
        } else {
          esi = Math.round(esiBaseComponents * 0.0075);
          if (esi > 0) employerEsi = esiBase * 0.0325;
        }
        console.log(`Employee ${empId}: ESI from default formula (Earned Basic + OT Amount + Incentive) * 0.75% = ${esi}`);
      }
    } else {
      console.log(`Employee ${empId}: ESI Status is No - ESI not calculated`);
    }
    // If contractor is "Yashaswi Academy for Skills", do not calculate PT, PF, ESI (set to 0)
    const contractorName = String(emp.ContractorName || emp.Contractor || '').replace(/\s+/g, ' ').trim();
    const contractorNameLower = contractorName.toLowerCase();
    if (contractorNameLower === 'yashaswi academy for skills') {
      pt = 0;
      pf = 0;
      esi = 0;
      employerEsi = 0;
    } else {
      // Saved PF / ESI from Payroll table (persisted edits) — maps were prefetched but never applied before refresh.
      const savedPfPick =
        savedPFMap[empId] ??
        savedPFMap[empIdStr] ??
        savedPFMap[empIdNorm] ??
        savedPFMap[String(parseInt(empId, 10))];
      if (
        isPfApplicable &&
        savedPfPick !== undefined &&
        savedPfPick !== null &&
        String(savedPfPick).trim() !== ''
      ) {
        const spf = parseFloat(savedPfPick);
        if (!Number.isNaN(spf)) {
          pf = Math.round(spf);
          if (pf >= 1800) pfWages = 15000;
          else if (pf > 0) pfWages = Math.min(15000, Math.round(pf / 0.12));
          else pfWages = 0;
        }
      }
      const savedEsiPick =
        savedESIMap[empId] ??
        savedESIMap[empIdStr] ??
        savedESIMap[empIdNorm] ??
        savedESIMap[String(parseInt(empId, 10))];
      if (
        isEsiApplicable &&
        savedEsiPick !== undefined &&
        savedEsiPick !== null &&
        String(savedEsiPick).trim() !== ''
      ) {
        const sesi = parseFloat(savedEsiPick);
        if (!Number.isNaN(sesi)) {
          esi = Math.round(sesi);
          if (esi > 0) employerEsi = esiBase * 0.0325;
        }
      }
    }
    const otherDeduction = Number(emp.OtherDeduction ?? emp.otherDeduction ?? 0) || 0; // Other Deduction from Payroll table
    // Rent / Rent Recovery: from saved Payroll only (not from Employee form)
    const rent = savedRentMap[empId] ?? savedRentMap[empIdStr] ?? savedRentMap[empIdNormForAA] ?? savedRentMap[String(parseInt(empId))] ?? 0;
    // Loan Allowance for Total Deduction formula (from Setup Configuration when defined)
    const loanAllowanceVal = Number(savedLoanAllowanceMap[empId] ?? savedLoanAllowanceMap[empIdStr] ?? savedLoanAllowanceMap[empIdNormForAA] ?? savedLoanAllowanceMap[String(parseInt(empId))] ?? 0) || 0;
    const revisedLOHForRow = resolveRevisedLohForEmployee(empId, loh, savedRevisedLOHMap);
    const lateLohHours = lateDeductionHoursForEmployee(empId, loh, savedRevisedLOHMap);
    const lateContext = {
      'Earned Basic': earnedBasic,
      'Earned HRA': earnedHRA,
      'Earned DA': earnedDA,
      'Earned Special Allowance': earnedSpecialAllowance,
      'Earned Gross Salary': earnedSalaryCross,
      'Actual Basic': actualBasic,
      'Actual HRA': actualHRA,
      'Actual DA': actualDA,
      'Special Allowance': specialAllowance,
      'LOH': lateLohHours,
      'Revised LOH': revisedLOHForRow,
      'Days In Month': daysInMonthForCalc,
      'Days Present': daysPresent,
      'No. of Days(In month)': daysInMonthForCalc,
      'No. of Days (In Month)': daysInMonthForCalc,
      'OT Hours': otHours,
      'OT Amount': otAmount,
      'Travel Charges': travelChargers,
      'TravelChargers': travelChargers
    };
    const lateAmount = getLateFromPayrollFormulae(payrollFormulae, lateContext);
    // Total Deduction: from Setup Configuration formula when defined, else sum deduction components.
    // Food Allowance is not included in Total Deduction (earnings-side; avoid double-count if also listed under deductions in payslip).
    let totalDeduction;
    const totalDeductionFormula = Array.isArray(payrollFormulae) && payrollFormulae.find((f) => String(f.variable).trim().toLowerCase() === 'total deduction');
    if (totalDeductionFormula && totalDeductionFormula.expression) {
      const deductionContext = {
        'PF': pf,
        'ESI': esi,
        'ESI 0.75%': esi,
        'Loan Allowance': loanAllowanceVal,
        'Food Allowance': 0,
        'Food Allownace': 0,
        'Late': lateAmount,
        'Other Deduction': otherDeduction,
        'LWF': lwf,
        'PT': pt,
        'Rent': rent,
        'Rent Recovery': rent
      };
      totalDeduction = Math.round(evaluateFormulaExpression(totalDeductionFormula.expression, deductionContext));
    } else {
      // Fallback: PF + ESI + Loan + Late + Other + LWF + PT + Rent (no Food Allowance); Late only if Setup defines a Late formula
      totalDeduction = Math.round(pf + esi + loanAllowanceVal + lateAmount + otherDeduction + lwf + pt + rent);
    }
    const otEsi = isEsiApplicable ? Math.ceil(otAmount * 0.0075) : 0;
    const payableAmount = otPayment - otEsi;
    // Net Pay = Earned Gross Salary - Total Deduction (Total Deduction includes Rent Recovery)
    const netPay = earnedSalaryCross - totalDeduction; // Net Pay = Earned Gross Salary (includes OT Amount) - Total Deduction
    const totalNetPayable = netPay + payableAmount;
    const admin = contractorNameLower === 'yashaswi academy for skills' ? 0 : (isPfApplicable ? pfWages * 0.005 : 0); // Admin = 0 for Yashaswi; else (Earned Basic + Earned DA + Arrear) * 0.5%
    const edli = contractorNameLower === 'yashaswi academy for skills' ? 0 : (isPfApplicable ? (Math.round(pfWages) === 15000 ? 75 : pfWages * 0.005) : 0); // EDLI = 0 for Yashaswi; else as per slab
    const erpf = pf; // ERPF 12% = (Earned Basic + Earned DA + Arrear) * 12% (0 for Yashaswi)
    const erpf12PlusAdminPlusEdli = contractorNameLower === 'yashaswi academy for skills' ? 0 : (erpf + admin + edli); // ERPF 12% + Admin 0.5% + EDLI 0.5%
    // ESIContribution from saved Payroll or 0 (used in result only; not in service charge base)
    const esiContribution = savedESIContributionMap[empId] ?? savedESIContributionMap[empIdStr] ?? savedESIContributionMap[empIdNormForAA] ?? savedESIContributionMap[String(parseInt(empId))] ?? 0;
    // Special cases for service charge calculation:
    // - "Yashaswi Academy for Skills" or "Yashaswi Academy For Skills" (case-insensitive) = 1000 fixed
    // - "sriram enterprice"/"sriram enterprise"/"sriram enterprises" (case-insensitive) = 8%
    // - All others = 9%
    // Service charge base = baseEarnedGross + ERPF 12% + Admin 0.5% + EDLI 0.5% + Employer ESI 3.25% + Employer LWF (do not include ESI Contribution)
    const serviceChargeBase = Math.max(0, baseEarnedGross + erpf12PlusAdminPlusEdli + employerEsi + employerLwf);
    let serviceCharge;
    if (contractorNameLower === 'yashaswi academy for skills') {
      serviceCharge = 1000; // Fixed 1000 for Yashaswi Academy for Skills (both "for" and "For" variations)
    } else if (contractorNameLower === 'sriram enterprice' || contractorNameLower === 'sriram enterprise' || contractorNameLower === 'sriram enterprises') {
      serviceCharge = serviceChargeBase * 0.08; // 8% for Sriram Enterprise/Enterprises
    } else {
      serviceCharge = serviceChargeBase * 0.09; // 9% for all others (on base + ERPF 12% + Admin 0.5% + EDLI 0.5% + Employer ESI + Employer LWF)
    }
    const total = Math.round(earnedSalaryCross) + Math.round(erpf12PlusAdminPlusEdli) + Math.round(serviceCharge) + Math.round(employerEsi) + Math.round(employerLwf) + Math.round(esiContribution); // Total = Earned Gross Salary + ERPF 12% + Admin 0.5% + EDLI 0.5% + Service Charge + Employer ESI 3.25% + Employer LWF + ESI Contribution
    // Special case: If contractor is "Yashaswi Academy for Skills" or "Yashaswi Academy For Skills" (case-insensitive), GST = 0, otherwise calculate 18%
    const gst = contractorNameLower === 'yashaswi academy for skills' ? 0 : Math.round(total * 0.18);
    const netTotal = total + gst;
 
    // Calculate LOP: LOP = no. of days in month - no. of days present
    // Formula: LOP = daysInMonth - daysPresent (use same daysInMonth as earned basic for consistency)
    // Ensure LOP is never negative (minimum 0)
    const lop = Math.max(0, daysInMonthForCalc - daysPresent);

    // Format DateofJoining from Employee table (handle different key casings)
    const empDateRaw = emp.DateofJoining ?? emp.dateofjoining ?? emp.DateOfJoining;
    let dateOfJoining = '';
    if (empDateRaw) {
      if (typeof empDateRaw === 'string') {
        if (/^\d{4}-\d{2}-\d{2}$/.test(empDateRaw)) {
          dateOfJoining = empDateRaw;
        } else {
          const d = new Date(empDateRaw);
          if (!isNaN(d)) {
            dateOfJoining = d.toISOString().slice(0, 10);
          }
        }
      } else {
        const d = new Date(empDateRaw);
        if (!isNaN(d)) {
          dateOfJoining = d.toISOString().slice(0, 10);
        }
      }
    }

    const payrollResultRow = {
      employeeCode: empId,
      employeeName: emp.EmployeeName || '',
      designation: String(emp.Designation ?? emp.designation ?? '').trim(),
      unit: String(emp.RelevantExperience ?? emp.relevantExperience ?? '').trim(),
      department: emp.Department || '',
      category: String(emp.Category ?? emp.category ?? '').trim(),
      contractor: emp.ContractorName || '',
      dateOfJoining: dateOfJoining,
      daysInMonth: daysInMonthForCalc,
      daysPresent,
      otHours: otHours || 0, // OT hours: use saved value or default to 0 (never auto-fetch)
      loh,
      revisedLOH: revisedLOHForRow,
      actualBasic,
      actualHRA,
      actualDA,
      otherAllowance,
      travelChargers,
      specialAllowance,
      foodAllowance,
      uniformAllowance,
      washingAllowance: washingAllowanceForEarned,
      incentive: Number(savedIncentiveMap[empId] ?? savedIncentiveMap[empIdStr] ?? savedIncentiveMap[empIdNorm] ?? savedIncentiveMap[String(parseInt(empId))] ?? 0) || 0,
      loanAllowance: Number(savedLoanAllowanceMap[empId] ?? savedLoanAllowanceMap[empIdStr] ?? savedLoanAllowanceMap[empIdNorm] ?? savedLoanAllowanceMap[String(parseInt(empId))] ?? 0) || 0,
      noOfDaysWithoutUniforms: Number(savedNoOfDaysWithoutUniformsMap[empId] ?? savedNoOfDaysWithoutUniformsMap[empIdStr] ?? savedNoOfDaysWithoutUniformsMap[empIdNorm] ?? savedNoOfDaysWithoutUniformsMap[String(parseInt(empId))] ?? 0) || 0,
      otherAllowances,
      actualTotalSalary,
      earnedBasic: Math.round(earnedBasic),
      earnedHRA: Math.round(earnedHRA),
      earnedDA: Math.round(earnedDA),
      earnedSpecialAllowance: Math.round(earnedSpecialAllowance),
      earnedAttendanceAllowance: earnedAttendanceAllowance,
      earnedOtherAllowances: Math.round(earnedOtherAllowances),
      arrear: Math.round(arrear),
      arrearForPF: Math.round(arrearForPF),
      otherAllowances: Math.round(otherAllowances),
      lop: lopDaysValue(lop),
      earnedSalaryCross: Math.round(earnedSalaryCross),
      pf: Math.round(pf),
      esi: Math.round(esi),
      totalDeduction: Math.round(totalDeduction),
      otAmount: Math.round(otAmount),
      otArrearAmount: Math.round(otArrearAmount),
      otEsi: Math.round(otEsi),
      otPayment: Math.round(otPayment),
      payableAmount: Math.round(payableAmount),
      otWages: 0,
          rent: Math.round(rent),
          advance: 0,
          lwf: Math.round(lwf),
          pt: Math.round(pt),
          otherDeduction: Math.round(otherDeduction),
          late: Math.round(lateAmount),
          Late: Math.round(lateAmount),
          netPay: Math.round(netPay),
      totalNetPayable: Math.round(totalNetPayable),
      erpf: Math.round(erpf), // ERPF = PF = (Earned Basic + Earned DA) * 12%
      admin: Math.round(admin), // Admin = (Earned Basic + Earned DA) * 0.5% when PF applies
      edli: Math.round(edli), // EDLI only if PF applicable
      erpf13: Math.round(erpf12PlusAdminPlusEdli), // ERPF 12% + Admin 0.5% + EDLI 0.5% (kept for backend/DB compatibility)
      employerEsi: Math.round(employerEsi), // Employer ESI = Earned Gross Salary * 3.25%
      esiContribution: Math.round(esiContribution), // ESIContribution (editable; used in service charge base)
      employerLwf: Math.round(employerLwf), // Employer LWF contribution
      serviceCharge: Math.round(serviceCharge), // Service Charge = 1000 fixed for Yashaswi Academy For Skills, 8% for Sriram Enterprise, 9% for others
      total: Math.round(total), // Total = Earned Gross Salary + ERPF 13% + Service Charge + Employer ESI 3.25%
      gst: Math.round(gst), // GST = Total * 18%
      netTotal: Math.round(netTotal), // Net Total = Total + GST
      bonus: 0,
      attendanceBonus: calcAttendanceBonus(dateOfJoining, daysPresent, daysInMonthForCalc, month),
      bankHolderName: emp.BankHolderName || '',
      bankName: emp.BankName || '',
      ifscCode: emp.IFSCCode || '',
      bankBranch: emp.BankBranch || '',
      uanNo: String(emp.UANNo ?? emp.uanNo ?? emp.UAN ?? ''),
      esicNo: String(emp.ESICNo ?? emp.esicNo ?? emp.ESIC ?? ''),
      pfStatus: emp.PFStatus || '',
      esiStatus: emp.ESIStatus || '',
      employeeStatus: emp.EmployeeStatus || emp.employeeStatus || '',
      payslip: !!(savedPayslipMap[empId] ?? savedPayslipMap[empIdStr] ?? savedPayslipMap[empIdNorm] ?? savedPayslipMap[String(parseInt(empId))])
    };
    const rawSavedPayroll =
      latestPayrollRawByNormalizedCode.get(empIdNorm) ||
      latestPayrollRawByNormalizedCode.get(empIdStr) ||
      latestPayrollRawByNormalizedCode.get(String(empId).trim()) ||
      latestPayrollRawByNormalizedCode.get(String(parseInt(empId, 10)));
    mergeSavedPayrollCustomColumnsIntoResultRow(payrollResultRow, rawSavedPayroll);
    const rawSavedSamplePayroll =
      latestSamplePayrollRawByNormalizedCode.get(empIdNorm) ||
      latestSamplePayrollRawByNormalizedCode.get(empIdStr) ||
      latestSamplePayrollRawByNormalizedCode.get(String(empId).trim()) ||
      latestSamplePayrollRawByNormalizedCode.get(String(parseInt(empId, 10)));
    mergeRunPayrollCustomFillGaps(payrollResultRow, rawSavedSamplePayroll);
    const rawSavedRunPayroll =
      latestRunPayrollRawByNormalizedCode.get(empIdNorm) ||
      latestRunPayrollRawByNormalizedCode.get(empIdStr) ||
      latestRunPayrollRawByNormalizedCode.get(String(empId).trim()) ||
      latestRunPayrollRawByNormalizedCode.get(String(parseInt(empId, 10)));
    mergeRunPayrollCustomFillGaps(payrollResultRow, rawSavedRunPayroll);
    applyRevisedLohToPayrollRow(payrollResultRow);
    applyEmployeeStatutoryIdsToPayrollRow(payrollResultRow, emp);
    result.push(payrollResultRow);
  }
  return result;
}

/** Catalyst / API Gateway may pass `/server/payroll_function/...` or `/payroll_function/...`. */
function normalizePayrollFunctionPathname(p) {
  if (!p || typeof p !== 'string') return '/';
  const prefixes = ['/server/payroll_function', '/payroll_function'];
  for (const prefix of prefixes) {
    if (p === prefix) return '/';
    if (p.startsWith(`${prefix}/`)) {
      const rest = p.slice(prefix.length);
      return rest.startsWith('/') ? rest : `/${rest}`;
    }
  }
  return p;
}

/**
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 */
module.exports = async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = normalizePayrollFunctionPathname(parsedUrl.pathname);
  const query = parsedUrl.query;

  if (pathname === '/run-payroll-count') {
    const month = normalizePayrollMonthFilter(String(query.month || '').trim());
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'month query required (YYYY-MM)' }));
      return;
    }
    try {
      const catalystApp = catalyst.initialize(req);
      const runTable = catalystApp.datastore().table('RunPayroll');
      const count = await countRunPayrollRowsForMonth(catalystApp, runTable, month);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ month, count }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message || 'count failed' }));
    }
    return;
  }

  if (pathname === '/cleanup-run-payroll') {
    if (req.method !== 'POST' && req.method !== 'GET') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }
    const handleCleanup = async (monthRaw) => {
      const catalystApp = catalyst.initialize(req);
      const schema = await getRunPayrollTableWithColumns(catalystApp);
      if (!schema || !schema.table) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'RunPayroll table not found in Data Store' }));
        return;
      }
      const runTable = schema.table;
      const month = normalizePayrollMonthFilter(String(monthRaw || '').trim());
      if (month && !/^\d{4}-\d{2}$/.test(month)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Invalid month format: ${month}. Expected YYYY-MM` }));
        return;
      }
      const countBefore = month
        ? await countRunPayrollRowsForMonth(catalystApp, runTable, month)
        : null;
      let removed = 0;
      let byMonth = {};
      let monthsProcessed = 0;
      let alignSummary = { updated: 0, aligned: 0, skipped: 0 };
      let rebuildResult = null;
      if (month) {
        rebuildResult = await rebuildRunPayrollMonthFromPayrollTable(catalystApp, runTable, month);
        monthsProcessed = 1;
      } else {
        const allResult = await dedupeAllRunPayrollMonths(catalystApp, runTable);
        removed = allResult.totalRemoved;
        byMonth = allResult.byMonth;
        monthsProcessed = allResult.monthsProcessed;
        const monthsToAlign = new Set();
        try {
          const allRun = await runTable.getAllRows();
          for (const rec of allRun || []) {
            const mf = runPayrollRowMonthKey(rec);
            if (mf) monthsToAlign.add(mf);
          }
        } catch (_) {
          /* ignore */
        }
        for (const m of monthsToAlign) {
          const ar = await alignRunPayrollRowsWithPayrollTable(catalystApp, runTable, m);
          alignSummary.updated += ar.updated;
          alignSummary.aligned += ar.aligned;
          alignSummary.skipped += ar.skipped;
        }
      }
      const countAfter = month
        ? await countRunPayrollRowsForMonth(catalystApp, runTable, month)
        : null;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'success',
          month: month || null,
          removed,
          byMonth,
          monthsProcessed,
          countBefore,
          countAfter,
          aligned: alignSummary,
          rebuild: rebuildResult
        })
      );
    };
    if (req.method === 'GET') {
      handleCleanup(query.month).catch((err) => {
        console.error('cleanup-run-payroll error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message || 'Cleanup failed' }));
      });
      return;
    }
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      let monthRaw = '';
      try {
        const parsed = JSON.parse(body || '{}');
        monthRaw = parsed.month ?? '';
      } catch (_) {
        monthRaw = '';
      }
      handleCleanup(monthRaw).catch((err) => {
        console.error('cleanup-run-payroll error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message || 'Cleanup failed' }));
      });
    });
    return;
  }

  if (pathname === '/sync-run-payroll') {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', async () => {
      try {
        const parsed = JSON.parse(body || '{}');
        let month = String(parsed.month || '').trim();
        const payrollData = parsed.payrollData;
        const normalizeMonth = (monthStr) => {
          if (!monthStr) return monthStr;
          const trimmed = String(monthStr).trim();
          if (/^\d{4}-\d{2}$/.test(trimmed)) return trimmed;
          const ymdMatch = trimmed.match(/^(\d{4})-(\d{2})-\d{2}/);
          if (ymdMatch) return `${ymdMatch[1]}-${ymdMatch[2]}`;
          const date = new Date(trimmed);
          if (!isNaN(date.getTime())) {
            return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
          }
          return trimmed;
        };
        month = normalizeMonth(month);
        if (!/^\d{4}-\d{2}$/.test(month)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Invalid month format: ${month}. Expected YYYY-MM` }));
          return;
        }
        if (!Array.isArray(payrollData) || payrollData.length === 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'payrollData array is required' }));
          return;
        }
        const catalystApp = catalyst.initialize(req);
        const runPayrollResult = await syncRunPayrollFromPayrollImport(catalystApp, month, payrollData);
        const httpStatus =
          runPayrollResult.skipped || (runPayrollResult.inserted === 0 && !runPayrollResult.verifyCount)
            ? 500
            : 200;
        res.writeHead(httpStatus, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            status: runPayrollResult.ok ? 'success' : 'partial',
            runPayroll: runPayrollResult,
            error:
              runPayrollResult.inserted === 0
                ? runPayrollResult.firstError ||
                  (runPayrollResult.skipped
                    ? 'RunPayroll table not found in Data Store'
                    : 'No rows inserted into RunPayroll')
                : undefined
          })
        );
      } catch (err) {
        console.error('sync-run-payroll error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message || 'Failed to sync RunPayroll' }));
      }
    });
    return;
  }

  if (pathname === '/run-payroll-table') {
    if (req.method !== 'GET') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }
    const month = String(query.month || '').trim();
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing or invalid month parameter (YYYY-MM)' }));
      return;
    }
    try {
      const catalystApp = catalyst.initialize(req);
      const runTable = catalystApp.datastore().table('RunPayroll');
      await alignRunPayrollRowsWithPayrollTable(catalystApp, runTable, month);
      const data = await fetchRunPayrollTableSnapshotForMonth(catalystApp, month, runTable);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data }));
    } catch (err) {
      console.error('run-payroll-table error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message || 'Failed to load RunPayroll' }));
    }
    return;
  }

  if (pathname === '/payroll') {
    // Parse month and filters
    let month = query.month; // format: YYYY-MM
    let contractor = query.contractor;
    const department = query.department;
    const employeeId = query.employeeId;
    const employeeStatus = query.employeeStatus;
    const userEmail = query.userEmail;
    const fromDate = query.fromDate; // Custom from date (YYYY-MM-DD)
    const toDate = query.toDate; // Custom to date (YYYY-MM-DD)
    // When client overlays Attendance Muster (days/OT/LOH), skip heavy server attendance work.
    const clientAttendance =
      String(query.clientAttendance || '') === '1' ||
      String(query.clientAttendance || '').toLowerCase() === 'true';

  const normalizeName = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
 
    // Normalize month format to YYYY-MM (ensure consistent format)
    const normalizeMonth = (monthStr) => {
      if (!monthStr) return monthStr;
      const trimmed = String(monthStr).trim();
      // If already YYYY-MM format, return as is
      if (/^\d{4}-\d{2}$/.test(trimmed)) {
        return trimmed;
      }
      // If YYYY-MM-DD format, extract YYYY-MM
      const ymdMatch = trimmed.match(/^(\d{4})-(\d{2})-\d{2}/);
      if (ymdMatch) {
        return `${ymdMatch[1]}-${ymdMatch[2]}`;
      }
      // Try parsing as date
      const date = new Date(trimmed);
      if (!isNaN(date.getTime())) {
        const year = date.getFullYear();
        const monthNum = String(date.getMonth() + 1).padStart(2, '0');
        return `${year}-${monthNum}`;
      }
      return trimmed; // Return as is if can't parse
    };

    if (!month) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing month parameter (YYYY-MM)' }));
      return;
    }
   
    // Normalize month format
    month = normalizeMonth(month);
    console.log('Payroll request - normalized month:', month);

    // Filter by contractor based on user email (hard-coded mapping)
    const emailContractorMap = {
      'afrindinusha@gmail.com': 'R.P.D Facility Management Services',
      'rpdmanpowerservice@gmail.com': 'R.P.D Facility Management Services',
      'ramachandran23488@gmail.com': 'R.P.D Facility Management Services',
      'afrindinusha29@gmail.com': 'Sriram enterprises', // use DB spelling
      'sriramenterprises50@yahoo.com': 'Sriram enterprises', // use DB spelling
      'afrinatlin@gmail.com': 'Samuel Enterprise',
      'samuelenterprisesms@gmail.com': 'Samuel Enterprise',
      'dinushaafrin@gmail.com': 'Sri Balaji Enterprises',
      'vijaybalaji701@gmail.com': 'Sri Balaji Enterprises',
      'afrindinu14@gmail.com': 'Yashaswi Academy for Skills',
      'vaishnavi.a@buildhr.co.in': 'Yashaswi Academy for Skills',
    };
    const forcedContractor = emailContractorMap[userEmail];
    if (forcedContractor) {
      contractor = forcedContractor;
      console.log(`Filtering payroll for user ${userEmail} - showing only ${forcedContractor} employees`);
    }

    try {
      const catalystApp = catalyst.initialize(req);
 
      console.log('=== PAYROLL REQUEST ===');
      console.log('Month:', month);
      console.log('Contractor:', contractor, '(type:', typeof contractor, ', is "All":', contractor === 'All', ')');
      console.log('Department:', department);
      console.log('EmployeeId:', employeeId);
      console.log('EmployeeStatus:', employeeStatus);
      console.log('UserEmail:', userEmail);
      console.log('FromDate:', fromDate);
      console.log('ToDate:', toDate);
      console.log('Query params:', query);
 
      // Build ZCQL query for the month or custom date range
      let startDate, endDateStr;
      if (fromDate && toDate) {
        // Use custom date range
        startDate = `${fromDate} 00:00:00`;
        endDateStr = `${toDate} 23:59:59`;
        console.log('Using custom date range:', { startDate, endDateStr });
      } else {
        // Use month-based date range
        startDate = `${month}-01 00:00:00`;
        const endDate = new Date(Number(month.split('-')[0]), Number(month.split('-')[1]), 0);
        endDateStr = `${month}-${String(endDate.getDate()).padStart(2, '0')} 23:59:59`;
        console.log('Using month-based date range:', { startDate, endDateStr });
      }
 
      console.log('Date range:', { startDate, endDateStr });
 
      // Check if this is January or December (month format: YYYY-MM)
      const isJanuary = month && month.endsWith('-01');
      const isDecember = month && month.endsWith('-12');
 
      // First, get all employees from Employee table
      let empWhereClause = '';
      if (contractor && contractor !== 'All') {
        const normalized = String(contractor || '').replace(/\s+/g, ' ').trim().replace(/'/g, "''");
        empWhereClause += ` AND ContractorName LIKE '%${normalized}%'`;
      }
      if (department && department !== 'All') empWhereClause += ` AND Department = '${department}'`;
      if (employeeId && employeeId !== 'All') empWhereClause += ` AND EmployeeCode = '${employeeId}'`;
      // Note: Status filter will be applied in JavaScript after fetching to handle case-insensitive matching
      // since the database field name might vary (EmployeeStatus vs employeeStatus)
 
      const buildEmpQuery = (includeSpecialAllowance, includeFoodUniform) => (
`SELECT EmployeeCode, EmployeeName, Department, Category, Designation, ContractorName, ActualBasic, ActualHRA, ActualDA, AttendanceAllowance, OtherAllowance, TravelChargers, TotalSalary` +
    (includeSpecialAllowance ? `, SpecialAllowance, ActualSpecialAllowance` : ``) +
    (includeFoodUniform ? `, FoodAllowance, UniformAllowance` : ``) +
    `, BankHolderName, BankName, IFSCCode, BankBranch, PFStatus, ESIStatus, employeeStatus, DateofJoining, UANNo, ESICNo, RelevantExperience FROM Employee WHERE EmployeeCode IS NOT NULL ${empWhereClause}`
      );

      const empQuery = buildEmpQuery(true, true);
      console.log('Employee query:', empQuery);
      if (clientAttendance) {
        console.log('GET /payroll: clientAttendance=1 — will skip BHR/OnDuty/CompOff/muster server calc');
      }

      let empRecords;
      let empQueryHasFoodUniform = true;
      try {
        empRecords = await catalystApp.zcql().executeZCQLQuery(empQuery);
        empQueryHasFoodUniform = true;
      } catch (empErr) {
        console.log('Employee query with FoodAllowance failed, retrying without Food/Uniform columns:', empErr.message);
        try {
          const empQueryFallback = buildEmpQuery(true, false);
          empRecords = await catalystApp.zcql().executeZCQLQuery(empQueryFallback);
          empQueryHasFoodUniform = false;
        } catch (empErr2) {
          console.log('Employee query retry (no Special columns, with Food):', empErr2.message);
          try {
            const empQueryNoSpecial = buildEmpQuery(false, true);
            empRecords = await catalystApp.zcql().executeZCQLQuery(empQueryNoSpecial);
            empQueryHasFoodUniform = true;
          } catch (empErr2b) {
            console.log('Employee query retry (minimal columns):', empErr2b.message);
            empQueryHasFoodUniform = false;
            const empQueryNoFoodUniform = buildEmpQuery(false, false);
            empRecords = await catalystApp.zcql().executeZCQLQuery(empQueryNoFoodUniform);
          }
        }
      }
      console.log('Employee records found:', empRecords.length);

      // JS fallback: normalize contractor names to catch spacing/case differences and variations
      if (contractor && contractor !== 'All') {
        const normExpected = normalizeName(contractor);
        const expectedWords = normExpected.split(' ').filter(w => w.length > 2); // Get key words (ignore short words)
     
        empRecords = empRecords.filter(r => {
          const empContractor = normalizeName(r.Employee.ContractorName || '');
          // Try exact match first
          if (empContractor === normExpected) return true;
          // Try matching key words (handles variations like "Samuel Enterprise" vs "Samuel Enterprises")
          if (expectedWords.length > 0) {
            const allKeyWordsMatch = expectedWords.every(word => empContractor.includes(word));
            if (allKeyWordsMatch) {
              // Additional validation: the first word should match (e.g., "samuel")
              const firstWord = expectedWords[0];
              const empFirstWord = empContractor.split(' ')[0];
              if (empFirstWord && (empFirstWord.startsWith(firstWord) || firstWord.startsWith(empFirstWord))) {
                return true;
              }
            }
          }
          return false;
        });
        console.log('Employee records after JS normalized contractor filter:', empRecords.length);
        if (empRecords.length === 0) {
          console.log('No employees found for contractor:', contractor);
          try {
            const allContractors = await catalystApp.zcql().executeZCQLQuery(`SELECT DISTINCT ContractorName FROM Employee LIMIT 20`);
            const uniqueContractors = [...new Set(allContractors.map(r => r.Employee.ContractorName).filter(Boolean))];
            console.log('Sample contractor names in database:', uniqueContractors);
          } catch (debugErr) {
            console.log('Could not fetch contractor names for debugging:', debugErr.message);
          }
        }
      }
 
      // Debug: Log first employee record to see the data structure
      if (empRecords.length > 0) {
        console.log('First employee record:', JSON.stringify(empRecords[0], null, 2));
      }
 
      // Get attendance data - try BHR table first (ESSL server), then Attendance table (importattendance)
      let attendanceData = [];
      let dataSource = 'none';
      let musterPresentDaysMap = {};
      let lohMap = {};
      let otHoursMap = {};
 
      // Get employee codes that match the filters to optimize attendance queries
      let filteredEmployeeCodes = [];
      if (employeeId && employeeId !== 'All') {
        filteredEmployeeCodes = [employeeId];
        console.log(`Filtering attendance by specific employee: ${employeeId}`);
      } else if (contractor && contractor !== 'All') {
        // Use the already filtered employee records (normalized contractor)
        filteredEmployeeCodes = empRecords.map(r => r.Employee.EmployeeCode).filter(Boolean);
        console.log(`Derived employee codes from filtered employees for contractor ${contractor}: ${filteredEmployeeCodes.length}`);
        if (filteredEmployeeCodes.length > 0) {
          console.log('Sample employee codes:', filteredEmployeeCodes.slice(0, 10));
        }
      } else if (!clientAttendance) {
        // When contractor is 'All', get all employee codes (optionally filter by department)
        try {
          let empCodesQuery = `SELECT EmployeeCode FROM Employee WHERE EmployeeCode IS NOT NULL`;
          if (contractor && contractor !== 'All') {
            const normalized = String(contractor || '').replace(/\s+/g, ' ').trim().replace(/'/g, "''");
            empCodesQuery += ` AND ContractorName LIKE '%${normalized}%'`;
          }
          if (department && department !== 'All') {
            empCodesQuery += ` AND Department = '${department}'`;
            console.log(`Filtering employee codes by department: ${department}`);
          }
          let empCodesRecords = await catalystApp.zcql().executeZCQLQuery(empCodesQuery);
          filteredEmployeeCodes = empCodesRecords.map(row => row.Employee.EmployeeCode).filter(Boolean);
          console.log(`Filtered employee codes for attendance query: ${filteredEmployeeCodes.length} employees`);
          if (filteredEmployeeCodes.length > 0) {
            console.log('Sample employee codes:', filteredEmployeeCodes.slice(0, 10));
          }
        } catch (empCodesErr) {
          console.log('Error getting filtered employee codes, will fetch all attendance:', empCodesErr.message);
          filteredEmployeeCodes = []; // Empty means fetch all
        }
      }

      if (clientAttendance) {
        console.log('GET /payroll: skipped server attendance pipeline (clientAttendance=1)');
      } else {
 
      // First, try to get data from BHR table (ESSL server data)
      try {
        console.log('=== CHECKING BHR TABLE (ESSL SERVER DATA) ===');
        let bhrQuery = `
          SELECT EmployeeID, EventTime, DeviceSerial
          FROM BHR
          WHERE EventTime >= '${startDate}' AND EventTime <= '${endDateStr}'
        `;
   
        // Filter by employee codes if we have them
        // When contractor is 'All', we want to fetch ALL attendance data, so don't filter by employee codes
        // Only filter if we have a specific contractor filter (not 'All')
        if (employeeId && employeeId !== 'All') {
          bhrQuery += ` AND EmployeeID = '${employeeId}'`;
          console.log(`BHR query filtered by specific employee: ${employeeId}`);
        } else if (contractor && contractor !== 'All' && filteredEmployeeCodes.length > 0) {
          // Only filter by employee codes if contractor is NOT 'All'
          const empCodesList = filteredEmployeeCodes.map(code => `'${code}'`).join(',');
          bhrQuery += ` AND EmployeeID IN (${empCodesList})`;
          console.log(`BHR query filtered by ${filteredEmployeeCodes.length} employee codes for contractor: ${contractor}`);
        } else {
          // When contractor is 'All', fetch ALL attendance data without filtering
          console.log('Contractor is "All" - BHR query will fetch attendance for ALL employees (no filtering)');
        }
   
        bhrQuery += ` ORDER BY EmployeeID, EventTime`;
   
        console.log('BHR query:', bhrQuery);
        const bhrRecords = await catalystApp.zcql().executeZCQLQuery(bhrQuery);
        console.log('BHR records found:', bhrRecords.length);
   
        if (bhrRecords.length > 0) {
          console.log('Using BHR table data (ESSL server)');
          console.log('Sample BHR records (first 3):', bhrRecords.slice(0, 3).map(r => ({
            EmployeeID: r.BHR.EmployeeID,
            EventTime: r.BHR.EventTime
          })));
          dataSource = 'bhr';
     
          // Group BHR data by employee and date
          const bhrMap = {};
          const bhrByDate = {}; // Temporary structure to group events by employee and date
     
          for (const row of bhrRecords) {
            const bhr = row.BHR;
            const empId = bhr.EmployeeID;
            const eventTime = bhr.EventTime;
            const dateStr = eventTime.split(' ')[0]; // Extract date part
       
            if (!bhrByDate[empId]) {
              bhrByDate[empId] = {};
            }
            if (!bhrByDate[empId][dateStr]) {
              bhrByDate[empId][dateStr] = [];
            }
            bhrByDate[empId][dateStr].push(eventTime);
          }
     
          console.log(`Grouped BHR data: ${Object.keys(bhrByDate).length} employees with attendance records`);
     
          // Process grouped BHR data to calculate FirstIn, LastOut, and hours worked
          for (const empId in bhrByDate) {
            bhrMap[empId] = {
              employeeId: empId,
              totalDaysPresent: 0,
              totalOvertimeHours: 0,
              attendanceDetails: []
            };
       
            for (const dateStr in bhrByDate[empId]) {
              const events = bhrByDate[empId][dateStr].sort();
              if (events.length >= 2) {
                // Use earliest event as FirstIn and latest event as LastOut
                const firstIn = events[0];
                const lastOut = events[events.length - 1];
           
                // Calculate hours worked
                const hoursWorked = calculateHoursWorked(firstIn, lastOut, dateStr);
           
                // Count as present based on hours worked
                let daysToAdd = 0;
                if (hoursWorked >= 8) {
                  daysToAdd = 1; // Full day
                } else if (hoursWorked >= 4) {
                  daysToAdd = 0.5; // Half day
                }
             
                if (daysToAdd > 0) {
                  bhrMap[empId].totalDaysPresent += daysToAdd;
             
                  // Store BHR details
                  bhrMap[empId].attendanceDetails.push({
                    date: dateStr,
                    firstIn: firstIn,
                    lastOut: lastOut,
                    hoursWorked: hoursWorked.toFixed(2),
                    source: 'BHR'
                  });
                } else {
                  console.log(`Employee ${empId} on ${dateStr}: Only worked ${hoursWorked.toFixed(2)} hours (less than 4, not counting as present)`);
                }
              } else {
                console.log(`Employee ${empId} on ${dateStr}: Only ${events.length} event(s) (need at least 2 for FirstIn/LastOut)`);
              }
            }
          }
     
          console.log(`After processing: ${Object.keys(bhrMap).length} employees with valid attendance (>=8 hours)`);
          console.log(`Total days present by employee:`, Object.entries(bhrMap).slice(0, 10).map(([id, data]) => ({ employeeId: id, daysPresent: data.totalDaysPresent })));
     
          attendanceData = Object.values(bhrMap);
          console.log('Processed BHR data for', attendanceData.length, 'employees');
     
          // Debug: Show sample BHR data
          if (attendanceData.length > 0) {
            console.log('Sample BHR data (first 10):', attendanceData.slice(0, 10).map(att => ({
              employeeId: att.employeeId,
              type: typeof att.employeeId,
              daysPresent: att.totalDaysPresent
            })));
            console.log('All BHR employee IDs (first 20):', attendanceData.slice(0, 20).map(att => att.employeeId));
            console.log('Total unique employee IDs in attendance data:', new Set(attendanceData.map(att => String(att.employeeId))).size);
          } else {
            console.warn('⚠️ NO ATTENDANCE DATA PROCESSED FROM BHR TABLE!');
          }
        }
      } catch (bhrErr) {
        console.log('BHR table not found or no BHR data:', bhrErr.message);
      }
 
      // If no BHR data, try Attendance table (importattendance data)
      if (attendanceData.length === 0) {
        try {
          console.log('=== CHECKING ATTENDANCE TABLE (IMPORTATTENDANCE DATA) ===');
          let attendanceQuery = `
            SELECT EmployeeId, AttendanceDate, FirstIn, LastOut, Status
            FROM Attendance
            WHERE AttendanceDate >= '${startDate}' AND AttendanceDate <= '${endDateStr}'
          `;
     
          // Filter by employee codes if we have them
          // When contractor is 'All', we want to fetch ALL attendance data, so don't filter by employee codes
          // Only filter if we have a specific contractor filter (not 'All')
          if (employeeId && employeeId !== 'All') {
            attendanceQuery += ` AND EmployeeId = '${employeeId}'`;
            console.log(`Attendance query filtered by specific employee: ${employeeId}`);
          } else if (contractor && contractor !== 'All' && filteredEmployeeCodes.length > 0) {
            // Only filter by employee codes if contractor is NOT 'All'
            const empCodesList = filteredEmployeeCodes.map(code => `'${code}'`).join(',');
            attendanceQuery += ` AND EmployeeId IN (${empCodesList})`;
            console.log(`Attendance query filtered by ${filteredEmployeeCodes.length} employee codes for contractor: ${contractor}`);
          } else {
            // When contractor is 'All', fetch ALL attendance data without filtering
            console.log('Contractor is "All" - Attendance query will fetch attendance for ALL employees (no filtering)');
          }
     
          attendanceQuery += ` ORDER BY EmployeeId, AttendanceDate`;
     
          console.log('Attendance query:', attendanceQuery);
          const attendanceRecords = await catalystApp.zcql().executeZCQLQuery(attendanceQuery);
          console.log('Attendance records found:', attendanceRecords.length);
     
          if (attendanceRecords.length > 0) {
            console.log('Using Attendance table data (importattendance)');
            console.log('Sample Attendance records (first 3):', attendanceRecords.slice(0, 3).map(r => ({
              EmployeeId: r.Attendance.EmployeeId,
              AttendanceDate: r.Attendance.AttendanceDate,
              FirstIn: r.Attendance.FirstIn,
              LastOut: r.Attendance.LastOut
            })));
            dataSource = 'attendance';
       
            // Helper: normalize provided status strings from Excel/Attendance table (matching Attendance Muster logic)
            const normalizeProvidedStatus = (val) => {
              if (!val) return '';
              const s = String(val).trim();
              const sUpper = s.toUpperCase();
              const sLower = s.toLowerCase();
              // Check for WO (Week Off) - case-insensitive
              if (sUpper === 'WO') return 'WO';
              // Check for H (Holiday) - case-insensitive, but only if it's a single letter 'H' or 'h'
              // If it's 'h' followed by other text (like 'half'), it's half day
              if (sUpper === 'H' && s.length === 1) return 'H';
              // Now check other statuses (convert to lowercase for comparison)
              if (sLower === 'p' || sLower === 'present' || sLower === 'full' || sLower === '1') return 'Present';
              if (sLower === 'h' || sLower === 'half' || sLower === 'half day' || sLower === '0.5' || sLower === 'half day present') return 'Half Day Present';
              if (sLower === 'a' || sLower === 'absent' || sLower === '0') return 'Absent';
              return '';
            };
       
            // Group attendance data by employee
            const empMap = {};
            let recordsWithBothTimes = 0;
            let recordsWith8PlusHours = 0;
            let recordsWithStatus = 0;
       
            for (const row of attendanceRecords) {
              const attendance = row.Attendance;
              const empId = attendance.EmployeeId;
              const attendanceDate = attendance.AttendanceDate;
              const firstIn = attendance.FirstIn;
              const lastOut = attendance.LastOut;
         
              if (!empMap[empId]) {
                empMap[empId] = {
                  employeeId: empId,
                  totalDaysPresent: 0,
                  totalOvertimeHours: 0,
                  attendanceDetails: []
                };
              }
         
              // Normalize the provided status from Attendance table
              const providedStatus = normalizeProvidedStatus(attendance.Status);
              const rawStatus = String(attendance.Status || '').trim().toUpperCase();
              let finalStatus = '';
         
              // Strategy 1: If status is provided, use it (count "Present" as 1, "Half Day Present" as 0.5)
              let daysToAdd = 0;
              if (providedStatus === 'Present') {
                daysToAdd = 1;
                finalStatus = providedStatus;
                recordsWithStatus++;
              } else if (providedStatus === 'Half Day Present') {
                daysToAdd = 0.5;
                finalStatus = providedStatus;
                recordsWithStatus++;
              } else if (rawStatus === 'H') {
                // Holiday (H) counts as 1 day
                daysToAdd = 1;
                finalStatus = 'H';
                recordsWithStatus++;
              } else if (rawStatus === 'WO') {
                // Week Off (WO) counts as 1 day
                daysToAdd = 1;
                finalStatus = 'WO';
                recordsWithStatus++;
              } else if (attendanceDate && firstIn && lastOut) {
                // Strategy 2: Calculate from hours worked
                recordsWithBothTimes++;
                const hoursWorked = calculateHoursWorked(firstIn, lastOut, attendanceDate);
           
                if (hoursWorked >= 4) {
                  if (hoursWorked >= 8) {
                    recordsWith8PlusHours++;
                  }
                  daysToAdd = 1;
                  finalStatus = 'Present';
                } else if (hoursWorked > 0) {
                  daysToAdd = 0.5;
                  finalStatus = 'Half Day Present';
                } else {
                  finalStatus = 'Absent';
                  console.log(`Employee ${empId} on ${attendanceDate}: Zero hours between FirstIn and LastOut`);
                }
              } else {
                // No status and no times - cannot determine
                finalStatus = 'Absent';
                if (attendanceDate) {
                  console.log(`Employee ${empId} on ${attendanceDate}: Missing FirstIn or LastOut (FirstIn: ${firstIn}, LastOut: ${lastOut})`);
                }
              }
         
              if (daysToAdd > 0) {
                empMap[empId].totalDaysPresent += daysToAdd;
           
                // Store attendance details
                empMap[empId].attendanceDetails.push({
                  date: attendanceDate,
                  firstIn: firstIn,
                  lastOut: lastOut,
                  hoursWorked: firstIn && lastOut ? calculateHoursWorked(firstIn, lastOut, attendanceDate).toFixed(2) : 'N/A',
                  status: finalStatus || providedStatus || attendance.Status,
                  source: 'Attendance'
                });
              }
            }
       
            console.log(`Attendance processing: ${recordsWithBothTimes} records with both FirstIn/LastOut, ${recordsWithStatus} records with provided status, ${recordsWith8PlusHours} records with >=8 hours`);
            console.log(`After processing: ${Object.keys(empMap).length} employees with valid attendance (Present or Half Day Present)`);
            console.log(`Total days present by employee:`, Object.entries(empMap).slice(0, 5).map(([id, data]) => ({ employeeId: id, daysPresent: data.totalDaysPresent })));
       
            attendanceData = Object.values(empMap);
            console.log('Processed attendance data for', attendanceData.length, 'employees');
       
            // Debug: Show sample attendance data
            if (attendanceData.length > 0) {
              console.log('Sample attendance data:', attendanceData.slice(0, 3));
              console.log('All attendance employee IDs:', attendanceData.map(att => att.employeeId));
            }
          }
        } catch (attendanceErr) {
          console.log('Attendance table not found or no attendance data:', attendanceErr.message);
        }
      }
 
      // Convert attendanceData to a map structure (by employee and date) for merging with OnDuty and CompOff
      const attendanceByKey = {}; // Key: empId_date, Value: { employeeId, date, daysToAdd, firstIn, lastOut, source }
      attendanceData.forEach(att => {
        if (att.attendanceDetails && att.attendanceDetails.length > 0) {
          att.attendanceDetails.forEach(detail => {
            const key = `${att.employeeId}_${detail.date}`;
            if (!attendanceByKey[key]) {
              attendanceByKey[key] = {
                employeeId: att.employeeId,
                date: detail.date,
                daysToAdd: 0,
                firstIn: detail.firstIn,
                lastOut: detail.lastOut,
                source: detail.source || 'BHR'
              };
            }
            // Calculate days to add based on hours worked or status
            if (detail.hoursWorked && detail.hoursWorked !== 'N/A') {
              const hours = parseFloat(detail.hoursWorked);
              if (hours >= 8) {
                attendanceByKey[key].daysToAdd = 1;
              } else if (hours >= 4) {
                attendanceByKey[key].daysToAdd = 0.5;
              } else if (hours > 0) {
                attendanceByKey[key].daysToAdd = 0.5;
              }
            } else if (detail.status === 'Present') {
              attendanceByKey[key].daysToAdd = 1;
            } else if (detail.status === 'Half Day Present') {
              attendanceByKey[key].daysToAdd = 0.5;
            }
          });
        }
      });
 
      // Fetch OnDuty records for the date range
      let ondutyRecords = 0;
      let ondutyInRange = 0;
      try {
        console.log('=== CHECKING ONDUTY TABLE ===');
        let ondutyOffset = 0;
        let ondutyHasMore = true;
        const ondutyPageSize = 300;
 
        while (ondutyHasMore) {
          let ondutyQuery = `SELECT EmployeeCode, EmployeeName, NoofHours, Reason, OnDutyDate, FirstIn, Lastout FROM OnDuty`;
       
          // Apply employee filter if exists
          if (employeeId && employeeId !== 'All') {
            ondutyQuery += ` WHERE EmployeeCode = '${employeeId}'`;
          } else if (contractor && contractor !== 'All' && filteredEmployeeCodes.length > 0) {
            const employeeIdList = filteredEmployeeCodes.map(id => `'${id}'`).join(',');
            ondutyQuery += ` WHERE EmployeeCode IN (${employeeIdList})`;
          }
       
          ondutyQuery += ` ORDER BY EmployeeCode, OnDutyDate LIMIT ${ondutyPageSize} OFFSET ${ondutyOffset}`;
       
          console.log(`OnDuty Query (offset ${ondutyOffset}): ${ondutyQuery}`);
       
          const ondutyBatch = await catalystApp.zcql().executeZCQLQuery(ondutyQuery);
          const ondutyRows = ondutyBatch.map(r => r.OnDuty);
       
          if (ondutyRows.length === 0) {
            ondutyHasMore = false;
            break;
          }
       
          ondutyRecords += ondutyRows.length;
       
          // Helper function to normalize time from OnDuty
          const normalizeOnDutyTime = (dateStr, rawVal) => {
            if (!rawVal) return '';
            const raw = String(rawVal).trim();
            if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(:\d{2})?$/.test(raw)) return raw;
            const dmy = raw.match(/^(\d{2})[-\/](\d{2})[-\/](\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/);
            if (dmy) {
              const DD = dmy[1], MM = dmy[2], YYYY = dmy[3];
              const hh = dmy[4], mm = dmy[5], ss = dmy[6] ? dmy[6] : '00';
              return `${YYYY}-${MM}-${DD} ${hh}:${mm}:${ss}`;
            }
            const m = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
            if (m) {
              let h = parseInt(m[1], 10);
              const mm = m[2];
              const ss = m[3] ? m[3] : '00';
              const ampm = m[4] ? m[4].toUpperCase() : null;
              if (ampm) {
                if (ampm === 'AM' && h === 12) h = 0;
                if (ampm === 'PM' && h < 12) h += 12;
              }
              const HH = String(h).padStart(2, '0');
              return `${dateStr} ${HH}:${mm}:${ss}`;
            }
            if (/^\d{1,2}:\d{2}$/.test(raw)) {
              const [hStr, mStr] = raw.split(':');
              const HH = String(parseInt(hStr, 10)).padStart(2, '0');
              return `${dateStr} ${HH}:${mStr}:00`;
            }
            const d = new Date(`${dateStr} ${raw}`);
            if (!isNaN(d)) {
              const HH = String(d.getHours()).padStart(2, '0');
              const MM = String(d.getMinutes()).padStart(2, '0');
              const SS = String(d.getSeconds()).padStart(2, '0');
              return `${dateStr} ${HH}:${MM}:${SS}`;
            }
            return '';
          };
       
          ondutyRows.forEach(r => {
            let dateStr = '';
            if (r.OnDutyDate) {
              if (typeof r.OnDutyDate === 'string') {
                if (/^\d{4}-\d{2}-\d{2}$/.test(r.OnDutyDate)) {
                  dateStr = r.OnDutyDate;
                } else {
                  const tmp = new Date(r.OnDutyDate);
                  if (!isNaN(tmp)) dateStr = tmp.toISOString().slice(0, 10);
                }
              } else {
                const tmp = new Date(r.OnDutyDate);
                if (!isNaN(tmp)) dateStr = tmp.toISOString().slice(0, 10);
              }
            }
         
            if (!dateStr) return;
            if (dateStr < startDate || dateStr > endDateStr) return;
            ondutyInRange++;
         
            const normalizedFirstIn = normalizeOnDutyTime(dateStr, r.FirstIn);
            const normalizedLastOut = normalizeOnDutyTime(dateStr, r.Lastout);
         
            let ondutyStatus = 'Present';
            if (r.NoofHours) {
              const hours = String(r.NoofHours).trim().toLowerCase();
              if (hours === 'half day' || hours === 'halfday' || hours === '0.5') {
                ondutyStatus = 'Half Day Present';
              } else if (hours === 'full day' || hours === 'fullday' || hours === '1') {
                ondutyStatus = 'Present';
              }
            }
         
            const employeeCode = String(r.EmployeeCode || '').trim();
            if (!employeeCode) return;
         
            const key = `${employeeCode}_${dateStr}`;
            const daysToAdd = ondutyStatus === 'Present' ? 1 : (ondutyStatus === 'Half Day Present' ? 0.5 : 0);
         
            // OnDuty records take precedence - they override existing attendance data
            if (attendanceByKey[key]) {
              attendanceByKey[key].daysToAdd = daysToAdd;
              attendanceByKey[key].source = attendanceByKey[key].source === 'Both' ? 'Both+OnDuty' : (attendanceByKey[key].source || 'OnDuty');
              if (normalizedFirstIn) {
                if (!attendanceByKey[key].firstIn || normalizedFirstIn < attendanceByKey[key].firstIn) {
                  attendanceByKey[key].firstIn = normalizedFirstIn;
                }
              }
              if (normalizedLastOut) {
                if (!attendanceByKey[key].lastOut || normalizedLastOut > attendanceByKey[key].lastOut) {
                  attendanceByKey[key].lastOut = normalizedLastOut;
                }
              }
            } else {
              attendanceByKey[key] = {
                employeeId: employeeCode,
                date: dateStr,
                daysToAdd: daysToAdd,
                firstIn: normalizedFirstIn || '',
                lastOut: normalizedLastOut || '',
                source: 'OnDuty'
              };
            }
          });
       
          ondutyOffset += ondutyPageSize;
          if (ondutyRows.length < ondutyPageSize) ondutyHasMore = false;
        }
     
        console.log(`Fetched ${ondutyRecords} OnDuty records (${ondutyInRange} in-range)`);
      } catch (ondutyError) {
        console.error('Error fetching OnDuty records:', ondutyError);
      }
 
      // Fetch CompOff records for the date range
      let compoffRecords = 0;
      let compoffInRange = 0;
      try {
        console.log('=== CHECKING COMPOFF TABLE ===');
        let compoffOffset = 0;
        let compoffHasMore = true;
        const compoffPageSize = 300;
 
        while (compoffHasMore) {
          let compoffQuery = `SELECT EmployeeCode, EmployeeName, WorkedOn, Taken FROM Comboff`;
       
          // Apply employee filter if exists
          if (employeeId && employeeId !== 'All') {
            compoffQuery += ` WHERE EmployeeCode = '${employeeId}'`;
          } else if (contractor && contractor !== 'All' && filteredEmployeeCodes.length > 0) {
            const employeeIdList = filteredEmployeeCodes.map(id => `'${id}'`).join(',');
            compoffQuery += ` WHERE EmployeeCode IN (${employeeIdList})`;
          }
       
          compoffQuery += ` ORDER BY EmployeeCode, Taken LIMIT ${compoffPageSize} OFFSET ${compoffOffset}`;
       
          console.log(`CompOff Query (offset ${compoffOffset}): ${compoffQuery}`);
       
          const compoffBatch = await catalystApp.zcql().executeZCQLQuery(compoffQuery);
          const compoffRows = compoffBatch.map(r => r.Comboff);
       
          if (compoffRows.length === 0) {
            compoffHasMore = false;
            break;
          }
       
          compoffRecords += compoffRows.length;
       
          compoffRows.forEach(r => {
            let dateStr = '';
            if (r.Taken) {
              if (typeof r.Taken === 'string') {
                if (/^\d{4}-\d{2}-\d{2}$/.test(r.Taken)) {
                  dateStr = r.Taken;
                } else {
                  const tmp = new Date(r.Taken);
                  if (!isNaN(tmp)) dateStr = tmp.toISOString().slice(0, 10);
                }
              } else {
                const tmp = new Date(r.Taken);
                if (!isNaN(tmp)) dateStr = tmp.toISOString().slice(0, 10);
              }
            }
         
            if (!dateStr) return;
            if (dateStr < startDate || dateStr > endDateStr) return;
            compoffInRange++;
         
            const employeeCode = String(r.EmployeeCode || '').trim();
            if (!employeeCode) return;
         
            const key = `${employeeCode}_${dateStr}`;
            const compoffStatus = 'Present';
            const defaultFirstIn = `${dateStr} 08:30:00`;
            const defaultLastOut = `${dateStr} 17:00:00`;
         
            // CompOff records take precedence over Attendance but not OnDuty
            if (attendanceByKey[key]) {
              const currentSource = attendanceByKey[key].source || '';
              if (!currentSource.includes('OnDuty')) {
                attendanceByKey[key].daysToAdd = 1; // Present
                attendanceByKey[key].source = currentSource === 'Both' || currentSource === 'Attendance'
                  ? 'Both+CompOff'
                  : (currentSource || 'CompOff');
                if (!attendanceByKey[key].firstIn) {
                  attendanceByKey[key].firstIn = defaultFirstIn;
                }
                if (!attendanceByKey[key].lastOut) {
                  attendanceByKey[key].lastOut = defaultLastOut;
                }
              } else {
                attendanceByKey[key].source = currentSource.includes('CompOff') ? currentSource : currentSource + '+CompOff';
              }
            } else {
              attendanceByKey[key] = {
                employeeId: employeeCode,
                date: dateStr,
                daysToAdd: 1,
                firstIn: defaultFirstIn,
                lastOut: defaultLastOut,
                source: 'CompOff'
              };
            }
          });
       
          compoffOffset += compoffPageSize;
          if (compoffRows.length < compoffPageSize) compoffHasMore = false;
        }
     
        console.log(`Fetched ${compoffRecords} CompOff records (${compoffInRange} in-range)`);
      } catch (compoffError) {
        console.error('Error fetching CompOff records:', compoffError);
      }
 
      // Convert attendanceByKey back to attendanceData array format
      const attendanceByEmployee = {};
      Object.values(attendanceByKey).forEach(rec => {
        if (rec.daysToAdd > 0) {
          if (!attendanceByEmployee[rec.employeeId]) {
            attendanceByEmployee[rec.employeeId] = {
              employeeId: rec.employeeId,
              totalDaysPresent: 0,
              totalOvertimeHours: 0,
              attendanceDetails: []
            };
          }
          attendanceByEmployee[rec.employeeId].totalDaysPresent += rec.daysToAdd;
          attendanceByEmployee[rec.employeeId].attendanceDetails.push({
            date: rec.date,
            firstIn: rec.firstIn,
            lastOut: rec.lastOut,
            hoursWorked: rec.firstIn && rec.lastOut ? calculateHoursWorked(rec.firstIn, rec.lastOut, rec.date).toFixed(2) : 'N/A',
            status: rec.daysToAdd === 1 ? 'Present' : (rec.daysToAdd === 0.5 ? 'Half Day Present' : 'Absent'),
            source: rec.source
          });
        }
      });
      attendanceData = Object.values(attendanceByEmployee);
 
      console.log(`=== ATTENDANCE DATA SOURCE: ${dataSource.toUpperCase()} ===`);
      console.log(`Total employees with attendance data: ${attendanceData.length}`);
      console.log(`OnDuty records added: ${ondutyInRange}, CompOff records added: ${compoffInRange}`);
 
      // Debug: Show detailed attendance data
      if (attendanceData.length > 0) {
        console.log('=== ATTENDANCE DATA DETAILS ===');
        attendanceData.slice(0, 5).forEach((att, index) => {
          console.log(`Attendance ${index + 1}:`, {
            employeeId: att.employeeId,
            totalDaysPresent: att.totalDaysPresent,
            totalOvertimeHours: att.totalOvertimeHours,
            attendanceDetailsCount: att.attendanceDetails ? att.attendanceDetails.length : 0
          });
        });
        console.log('All attendance employee IDs:', attendanceData.map(att => att.employeeId));
      } else {
        console.log('=== NO ATTENDANCE DATA FOUND ===');
        console.log('This means present days will show as 0 for all employees');
      }
 
      // Build employee details map
      const empDetailsMap = {};
      for (const row of empRecords) {
        const emp = row.Employee;
        empDetailsMap[emp.EmployeeCode] = {
          employeeName: emp.EmployeeName || '',
          designation: String(emp.Designation ?? emp.designation ?? '').trim(),
          department: emp.Department || '',
          category: String(emp.Category ?? emp.category ?? '').trim(),
          contractorName: emp.ContractorName || '',
          basicSalary: emp.ActualBasic || 0,
          hra: emp.ActualHRA || 0
        };
      }

      // Calculate present days and fetch LOH+OT in parallel (single attendance_muster call) to avoid execution time exceeded
      console.log('=== CALCULATING PRESENT DAYS FROM ATTENDANCE MUSTER LOGIC ===');
      const lohOtPromise = fetchLOHAndOTFromMuster(catalystApp, month, contractor, department, employeeId, fromDate, toDate, userEmail, null);
      musterPresentDaysMap = await calculatePresentDaysFromMuster(catalystApp, month, contractor, department, employeeId, fromDate, toDate);
      console.log(`Muster present days calculated for ${Object.keys(musterPresentDaysMap).length} employees`);
      ({ lohMap, otHoursMap } = await lohOtPromise);
      console.log(`=== LOH+OT from single fetch ===`);
      console.log(`OT hours map contains ${Object.keys(otHoursMap).length} employee IDs`);
      if (Object.keys(otHoursMap).length > 0) {
        console.log(`OT hours map keys (first 20):`, Object.keys(otHoursMap).slice(0, 20));
      } else {
        console.log(`⚠️ WARNING: otHoursMap is EMPTY after fetchLOHAndOTFromMuster`);
      }
   
      // Convert muster present days map to attendanceData format for compatibility
      // This ensures payroll uses the same calculation as attendance muster
      const musterAttendanceData = Object.keys(musterPresentDaysMap).map(empId => ({
        employeeId: empId,
        totalDaysPresent: musterPresentDaysMap[empId],
        totalOvertimeHours: 0,
        attendanceDetails: []
      }));
   
      // Merge muster data with existing attendanceData (muster takes precedence)
      const attendanceDataMap = {};
      // Store by multiple key formats for better matching
      attendanceData.forEach(att => {
        const empId = String(att.employeeId).trim();
        attendanceDataMap[empId] = att;
        // Also store with number key if applicable
        const empIdNum = parseInt(empId);
        if (!isNaN(empIdNum)) {
          attendanceDataMap[String(empIdNum)] = att;
          attendanceDataMap[empIdNum] = att;
        }
      });
      musterAttendanceData.forEach(musterAtt => {
        const empId = String(musterAtt.employeeId).trim();
        const empIdNum = parseInt(empId);
     
        // Update or add with multiple key formats
        const keysToUpdate = [empId];
        if (!isNaN(empIdNum)) {
          keysToUpdate.push(String(empIdNum), empIdNum);
        }
     
        keysToUpdate.forEach(key => {
          if (attendanceDataMap[key]) {
          // Update existing record with muster days (muster is authoritative)
            const oldDays = attendanceDataMap[key].totalDaysPresent;
            attendanceDataMap[key].totalDaysPresent = musterAtt.totalDaysPresent;
            if (oldDays !== musterAtt.totalDaysPresent) {
              console.log(`Updated employee ${empId} (key: ${key}) daysPresent from ${oldDays} to ${musterAtt.totalDaysPresent} (from muster)`);
            }
        } else {
            // Add new record from muster (create a copy to avoid reference issues)
            attendanceDataMap[key] = {
              employeeId: musterAtt.employeeId,
              totalDaysPresent: musterAtt.totalDaysPresent,
              totalOvertimeHours: musterAtt.totalOvertimeHours || 0,
              attendanceDetails: musterAtt.attendanceDetails || []
            };
        }
      });
      });
      // Convert back to array, using only string keys to avoid duplicates
      const uniqueAttendanceData = {};
      Object.keys(attendanceDataMap).forEach(key => {
        const att = attendanceDataMap[key];
        const empId = String(att.employeeId).trim();
        if (!uniqueAttendanceData[empId]) {
          uniqueAttendanceData[empId] = att;
        }
      });
      attendanceData = Object.values(uniqueAttendanceData);
      console.log(`Final attendance data: ${attendanceData.length} employees (merged with muster data)`);
      console.log(`Muster map had ${Object.keys(musterPresentDaysMap).length} employees`);
   
      // Debug: Check employee 36090 specifically
      const emp36090Data = attendanceData.find(att => String(att.employeeId) === '36090');
      if (emp36090Data) {
        console.log(`Employee 36090: Attendance muster calculated ${emp36090Data.totalDaysPresent} present days`);
      } else {
        console.log(`Employee 36090: NOT FOUND in attendance data`);
        const emp36090Muster = musterPresentDaysMap['36090'];
        if (emp36090Muster !== undefined) {
          console.log(`Employee 36090: Found in muster map with ${emp36090Muster} present days`);
        } else {
          console.log(`Employee 36090: NOT FOUND in muster map either`);
        }
      }

      // lohMap already from fetchLOHAndOTFromMuster above
      console.log(`=== LOH MAP SUMMARY (from single fetch) ===`);
      console.log(`LOH hours fetched for ${Object.keys(lohMap).length} employees`);
      if (Object.keys(lohMap).length > 0) {
        const totalLOH = Object.values(lohMap).reduce((sum, hours) => sum + hours, 0);
        console.log(`Total LOH hours: ${totalLOH.toFixed(2)}`);
      } else {
        console.log('⚠️ WARNING: lohMap is empty - no LOH data from attendance_muster_function');
      }

      } // end !clientAttendance attendance pipeline

      const samplePayrollOverrides = await fetchLatestSamplePayrollOverrideMaps(catalystApp, month);

      /** Live GET /payroll: stash raw Payroll / RunPayroll / Sample rows for Setup-only columns (before import + calculated paths). */
      const latestPayrollRawByNormalizedCodeApi = new Map();
      const latestRunPayrollRawByNormalizedCodeApi = new Map();
      const latestSamplePayrollRawByNormalizedCodeApi = new Map();
      try {
        const allEmpCodesForMerge = empRecords.map((r) => String(r.Employee?.EmployeeCode || '').trim()).filter(Boolean);
        if (allEmpCodesForMerge.length > 0) {
          const empCodesListMerge = allEmpCodesForMerge.map((code) => `'${code.replace(/'/g, "''")}'`).join(',');
          const monthEscapedMerge = String(month || '').replace(/'/g, "''");
          let payrollRowsMerge;
          const payrollQueryAllColumnsMerge = `SELECT * FROM Payroll WHERE Month_filter = '${monthEscapedMerge}' AND EmployeeCode IN (${empCodesListMerge}) ORDER BY ROWID DESC`;
          try {
            payrollRowsMerge = await catalystApp.zcql().executeZCQLQuery(payrollQueryAllColumnsMerge);
          } catch (selStarErr) {
            console.log('GET /payroll: SELECT * Payroll for custom columns failed:', selStarErr.message);
            payrollRowsMerge = [];
          }
          const seenPayrollMerge = new Set();
          for (const r of payrollRowsMerge || []) {
            const p = r.Payroll;
            if (!p) continue;
            const code = String(p.EmployeeCode || '').trim();
            if (!code) continue;
            const normalizedCode = normalizeEmployeeCode(code);
            if (seenPayrollMerge.has(normalizedCode)) continue;
            seenPayrollMerge.add(normalizedCode);
            const rawCopy = typeof p === 'object' ? { ...p } : {};
            latestPayrollRawByNormalizedCodeApi.set(normalizedCode, rawCopy);
            if (code !== normalizedCode) latestPayrollRawByNormalizedCodeApi.set(code, rawCopy);
            const codeNum = String(parseInt(code, 10));
            if (codeNum && !Number.isNaN(parseInt(code, 10))) latestPayrollRawByNormalizedCodeApi.set(codeNum, rawCopy);
          }
          try {
            const runPayrollQueryMerge = `SELECT * FROM RunPayroll WHERE Month_filter = '${monthEscapedMerge}' AND EmployeeCode IN (${empCodesListMerge}) ORDER BY ROWID DESC`;
            const runPayrollRowsMerge = await catalystApp.zcql().executeZCQLQuery(runPayrollQueryMerge);
            const seenRun = new Set();
            for (const r of runPayrollRowsMerge || []) {
              const rp = r.RunPayroll ?? r.runPayroll ?? r;
              if (!rp || typeof rp !== 'object') continue;
              const code = String(rp.EmployeeCode ?? rp.employeecode ?? '').trim();
              if (!code) continue;
              const normalizedCode = normalizeEmployeeCode(code);
              if (seenRun.has(normalizedCode)) continue;
              seenRun.add(normalizedCode);
              const rawRunCopy = { ...rp };
              latestRunPayrollRawByNormalizedCodeApi.set(normalizedCode, rawRunCopy);
              if (code !== normalizedCode) latestRunPayrollRawByNormalizedCodeApi.set(code, rawRunCopy);
              const codeNumRun = String(parseInt(code, 10));
              if (codeNumRun && !Number.isNaN(parseInt(code, 10))) {
                latestRunPayrollRawByNormalizedCodeApi.set(codeNumRun, rawRunCopy);
              }
            }
          } catch (runPrefetchErr) {
            console.log('GET /payroll: RunPayroll prefetch for custom columns skipped:', runPrefetchErr.message);
          }
          if (samplePayrollOverrides.manualMode) {
            try {
              const sampleTnApi = await getSamplePayrollTable(catalystApp);
              if (sampleTnApi) {
                const sampleRowsApi = [];
                let nextTokApi = undefined;
                do {
                  const pgApi = await sampleTnApi.getPagedRows({ nextToken: nextTokApi, maxRows: 300 });
                  sampleRowsApi.push(...(Array.isArray(pgApi?.data) ? pgApi.data : []));
                  nextTokApi = pgApi?.next_token;
                } while (nextTokApi);
                sampleRowsApi.sort((a, b) => (Number(b.ROWID) || 0) - (Number(a.ROWID) || 0));
                const monthScopedSampleApi = getMonthScopedSamplePayrollRows(sampleRowsApi, month);
                const bestByEmpApi = selectBestSamplePayrollRowsByEmployee(monthScopedSampleApi);
                for (const pr of bestByEmpApi.values()) {
                  const code = String(getAutomaticTableCell(pr, 'EmployeeCode', 'employeecode') || '').trim();
                  if (!code) continue;
                  const norm = normalizeEmployeeCode(code) || code;
                  const rawSampleCopy = pr && typeof pr === 'object' ? { ...pr } : {};
                  latestSamplePayrollRawByNormalizedCodeApi.set(norm, rawSampleCopy);
                  latestSamplePayrollRawByNormalizedCodeApi.set(code, rawSampleCopy);
                  const cnSp = String(parseInt(code, 10));
                  if (cnSp && !Number.isNaN(parseInt(code, 10))) {
                    latestSamplePayrollRawByNormalizedCodeApi.set(cnSp, rawSampleCopy);
                  }
                }
              }
            } catch (samplePrefetchErr) {
              console.log('GET /payroll: SamplePayroll prefetch for custom columns skipped:', samplePrefetchErr.message);
            }
          }
        }
      } catch (mergePrefetchErr) {
        console.log('GET /payroll: custom-column row prefetch failed (non-fatal):', mergePrefetchErr.message);
      }

      // First, check if there are any imported payroll records for this month
      // IMPORTANT: Imported data takes priority - it should NEVER be overwritten by auto-fetched data
      let importedPayrollData = [];
      let importedEmployeeCodeSet = new Set();
      let latestSavedOtHoursByEmp = {};
      let latestSavedRevisedLOHByEmp = {};
      let latestSavedLohByEmp = {};
      try {
        // First, get ALL imported payroll data for the month (without filters)
        // Ensure month is properly escaped and normalized
        const monthEscaped = String(month || '').replace(/'/g, "''").trim();
        let allPayrollQuery = `SELECT * FROM Payroll WHERE Month_filter = '${monthEscaped}' ORDER BY ROWID DESC`;
        console.log('=== CHECKING FOR IMPORTED PAYROLL DATA ===');
        console.log('Query:', allPayrollQuery);
        console.log('Month value being queried:', monthEscaped, '(type:', typeof monthEscaped, ', length:', monthEscaped.length, ')');
        const allPayrollRecords = await catalystApp.zcql().executeZCQLQuery(allPayrollQuery);
        latestSavedOtHoursByEmp = buildLatestSavedOTHoursMapFromPayrollRows(allPayrollRecords);
        latestSavedRevisedLOHByEmp = buildLatestSavedRevisedLOHMapFromPayrollRows(allPayrollRecords);
        latestSavedLohByEmp = buildLatestSavedLOHMapFromPayrollRows(allPayrollRecords);
        console.log(`✅ Found ${allPayrollRecords.length} imported payroll records for month ${monthEscaped}`);
       
        // Log sample records to verify data structure
        if (allPayrollRecords.length > 0) {
          console.log('Sample imported record:', {
            employeeCode: allPayrollRecords[0].Payroll?.EmployeeCode,
            monthFilter: allPayrollRecords[0].Payroll?.Month_filter,
            daysPresent: allPayrollRecords[0].Payroll?.DaysPresent,
            loh: allPayrollRecords[0].Payroll?.LOH
          });
        }
   
        // Then apply filters in JavaScript for more flexible matching
        let payrollRecords = allPayrollRecords;
   
        if (contractor && contractor !== 'All') {
          console.log(`Filtering by contractor: "${contractor}"`);
          payrollRecords = payrollRecords.filter(record => {
            const recordContractor = record.Payroll.Contractor || '';
            const matches = recordContractor.toLowerCase().includes(contractor.toLowerCase()) ||
                           contractor.toLowerCase().includes(recordContractor.toLowerCase());
            console.log(`Contractor match check: "${recordContractor}" vs "${contractor}" = ${matches}`);
            return matches;
          });
        }
   
        if (department && department !== 'All') {
          console.log(`Filtering by department: "${department}"`);
          payrollRecords = payrollRecords.filter(record => {
            const recordDepartment = record.Payroll.Department || '';
            const matches = recordDepartment.toLowerCase().includes(department.toLowerCase()) ||
                           department.toLowerCase().includes(recordDepartment.toLowerCase());
            console.log(`Department match check: "${recordDepartment}" vs "${department}" = ${matches}`);
            return matches;
          });
        }
   
        if (employeeId && employeeId !== 'All') {
          console.log(`Filtering by employee ID: "${employeeId}"`);
          payrollRecords = payrollRecords.filter(record => {
            const recordEmployeeId = record.Payroll.EmployeeCode || '';
            const matches = recordEmployeeId === employeeId;
            console.log(`Employee ID match check: "${recordEmployeeId}" vs "${employeeId}" = ${matches}`);
            return matches;
          });
        }
   
        // When multiple Payroll rows exist for same employee+month, always prefer latest ROWID.
        // This preserves the latest manual OT override after refresh.
        if (payrollRecords.length > 1) {
          const bestRowByEmployee = new Map();
          const toNum = (v) => {
            const n = Number(v);
            return Number.isFinite(n) ? n : 0;
          };
          for (const rec of payrollRecords) {
            const p = rec?.Payroll || {};
            const empCode = String(p.EmployeeCode || '').trim();
            if (!empCode) continue;
            const existing = bestRowByEmployee.get(empCode);
            const candidateRowId = toNum(p.ROWID);
            const existingRowId = existing ? toNum(existing?.Payroll?.ROWID) : -1;
            if (!existing || candidateRowId >= existingRowId) {
              bestRowByEmployee.set(empCode, rec);
            }
          }
          const dedupedRows = Array.from(bestRowByEmployee.values());
          if (dedupedRows.length !== payrollRecords.length) {
            console.log(`Deduped imported payroll rows by EmployeeCode: ${payrollRecords.length} -> ${dedupedRows.length} (preferred latest ROWID)`);
          }
          payrollRecords = dedupedRows;
        }

        console.log('After filtering - Found imported payroll records:', payrollRecords.length);
        if (payrollRecords.length > 0) {
          console.log('Sample payroll record:', JSON.stringify(payrollRecords[0], null, 2));
          console.log('=== DAYS PRESENT DEBUG ===');
          console.log('Days Present values in first 3 records:', payrollRecords.slice(0, 3).map(r => ({
            employeeCode: r.Payroll.EmployeeCode,
            daysPresent: r.Payroll.DaysPresent,
            type: typeof r.Payroll.DaysPresent,
            rawValue: r.Payroll.DaysPresent
          })));
          console.log('=== END DAYS PRESENT DEBUG ===');
        }
   
        // Fetch PFStatus, ESIStatus, and EmployeeStatus for all employees in imported payroll records
        const pfStatusMap = {};
        const esiStatusMap = {};
        const employeeStatusMap = {};
        const dateOfJoiningMap = {};
        const designationMap = {};
        const categoryMap = {};
        const unitMap = {};
        const employeeNameMap = {};
        const departmentMap = {};
        const uanNoMap = {};
        const esicNoMap = {};
        const employeeOtherAllowancesMapForImport = {};
        const travelChargersMap = {};
        // Employee master salary — used when Payroll row has 0 (stale save / never filled).
        const employeeActualBasicMapForImport = {};
        const employeeActualHRAMapForImport = {};
        const employeeActualDAMapForImport = {};
        const employeeSpecialAllowanceMapForImport = {};
        const employeeTotalSalaryMapForImport = {};
        const employeeAttendanceAllowanceMapForImport = {};
        const putKeyedStringMap = (map, code, value) => {
          if (!code || value === undefined || value === null) return;
          const v = String(value).trim();
          if (!v) return;
          map[code] = v;
          map[normalizeEmployeeCode(code)] = v;
          if (/^\d+$/.test(code)) map[String(parseInt(code, 10))] = v;
        };
        const putImportSalaryMaps = (code, basic, hra, da, special, totalSalary, attAllowance) => {
          if (!code) return;
          employeeActualBasicMapForImport[code] = basic;
          employeeActualHRAMapForImport[code] = hra;
          employeeActualDAMapForImport[code] = da;
          employeeSpecialAllowanceMapForImport[code] = special;
          employeeTotalSalaryMapForImport[code] = totalSalary;
          employeeAttendanceAllowanceMapForImport[code] = attAllowance;
        };
        const seedImportSalaryFromEmp = (emp) => {
          if (!emp || !emp.EmployeeCode) return;
          const ec = String(emp.EmployeeCode);
          const basic = getEmployeeNum(emp, 'ActualBasic', 'actualBasic', 'Actual Basic');
          const hra = getEmployeeNum(emp, 'ActualHRA', 'actualHRA', 'Actual HRA');
          const da = getEmployeeNum(emp, 'ActualDA', 'actualDA', 'Actual DA');
          const special = getEmployeeNum(emp, 'ActualSpecialAllowance', 'actualSpecialAllowance', 'SpecialAllowance', 'specialAllowance', 'Special Allowance');
          const totalSalary = getEmployeeNum(emp, 'TotalSalary', 'totalSalary', 'Total Salary', 'Total Salary (Auto-calculated)');
          const attAllowance = getEmployeeNum(emp, 'AttendanceAllowance', 'attendanceAllowance', 'Attendance Allowance');
          putImportSalaryMaps(ec, basic, hra, da, special, totalSalary, attAllowance);
          putImportSalaryMaps(normalizeEmployeeCode(ec), basic, hra, da, special, totalSalary, attAllowance);
          if (/^\d+$/.test(ec)) putImportSalaryMaps(String(parseInt(ec, 10)), basic, hra, da, special, totalSalary, attAllowance);
          putKeyedStringMap(employeeNameMap, ec, emp.EmployeeName ?? emp.employeeName ?? emp.Name ?? emp.name);
          putKeyedStringMap(departmentMap, ec, emp.Department ?? emp.department);
          putKeyedStringMap(designationMap, ec, emp.Designation ?? emp.designation);
          putKeyedStringMap(categoryMap, ec, emp.Category ?? emp.category);
          putKeyedStringMap(unitMap, ec, emp.RelevantExperience ?? emp.relevantExperience);
        };
        // Prefer already-loaded Employee rows (includes ActualBasic / ActualHRA / TotalSalary).
        for (const row of empRecords || []) {
          seedImportSalaryFromEmp(row?.Employee);
        }
        if (payrollRecords.length > 0) {
          try {
            const employeeCodes = payrollRecords.map(r => r.Payroll.EmployeeCode).filter(Boolean);
            if (employeeCodes.length > 0) {
              const empCodesList = employeeCodes.map(code => `'${String(code).replace(/'/g, "''")}'`).join(',');
              const statusQuery = `SELECT EmployeeCode, EmployeeName, Department, PFStatus, ESIStatus, employeeStatus, DateofJoining, Designation, Category, RelevantExperience, AttendanceAllowance, OtherAllowance, RevisedOtherAllowance, TravelChargers, UANNo, ESICNo, ActualBasic, ActualHRA, ActualDA, SpecialAllowance, ActualSpecialAllowance, TotalSalary FROM Employee WHERE EmployeeCode IN (${empCodesList})`;
              const statusRecords = await catalystApp.zcql().executeZCQLQuery(statusQuery);
              for (const row of statusRecords) {
                const emp = row.Employee;
                if (emp.EmployeeCode) {
                  const ec = String(emp.EmployeeCode);
                  seedImportSalaryFromEmp(emp);
                  pfStatusMap[ec] = String(emp.PFStatus || '').trim().toLowerCase();
                  esiStatusMap[ec] = String(emp.ESIStatus || '').trim().toLowerCase();
                  const statusVal = String(emp.EmployeeStatus || emp.employeeStatus || emp.Employee_Status || '').trim();
                  employeeStatusMap[ec] = statusVal;
                  employeeStatusMap[normalizeEmployeeCode(ec)] = statusVal;
                  if (/^\d+$/.test(ec)) employeeStatusMap[String(parseInt(ec))] = statusVal;
                  // Format DateofJoining from Employee table
                  const dojRaw = emp.DateofJoining ?? emp.dateofjoining ?? emp.DateOfJoining;
                  let dateOfJoining = '';
                  if (dojRaw) {
                    if (typeof dojRaw === 'string') {
                      if (/^\d{4}-\d{2}-\d{2}$/.test(dojRaw)) {
                        dateOfJoining = dojRaw;
                      } else {
                        const d = new Date(dojRaw);
                        if (!isNaN(d)) {
                          dateOfJoining = d.toISOString().slice(0, 10);
                        }
                      }
                    } else {
                      const d = new Date(dojRaw);
                      if (!isNaN(d)) {
                        dateOfJoining = d.toISOString().slice(0, 10);
                      }
                    }
                  }
                  dateOfJoiningMap[ec] = dateOfJoining;
                  dateOfJoiningMap[normalizeEmployeeCode(ec)] = dateOfJoining;
                  if (/^\d+$/.test(ec)) dateOfJoiningMap[String(parseInt(ec))] = dateOfJoining;
                  const desigVal = String(emp.Designation ?? emp.designation ?? '').trim();
                  designationMap[ec] = desigVal;
                  designationMap[normalizeEmployeeCode(ec)] = desigVal;
                  if (/^\d+$/.test(ec)) designationMap[String(parseInt(ec))] = desigVal;
                  const catVal = String(emp.Category ?? emp.category ?? '').trim();
                  categoryMap[ec] = catVal;
                  categoryMap[normalizeEmployeeCode(ec)] = catVal;
                  if (/^\d+$/.test(ec)) categoryMap[String(parseInt(ec))] = catVal;
                  const unitVal = String(emp.RelevantExperience ?? emp.relevantExperience ?? '').trim();
                  unitMap[ec] = unitVal;
                  unitMap[normalizeEmployeeCode(ec)] = unitVal;
                  if (/^\d+$/.test(ec)) unitMap[String(parseInt(ec))] = unitVal;
                  putKeyedStringMap(employeeNameMap, ec, emp.EmployeeName ?? emp.employeeName ?? emp.Name ?? emp.name);
                  putKeyedStringMap(departmentMap, ec, emp.Department ?? emp.department);
                  const uanVal = String(emp.UANNo ?? emp.uanNo ?? emp.UAN ?? '').trim();
                  const esicVal = String(emp.ESICNo ?? emp.esicNo ?? emp.ESIC ?? '').trim();
                  uanNoMap[ec] = uanVal;
                  uanNoMap[normalizeEmployeeCode(ec)] = uanVal;
                  esicNoMap[ec] = esicVal;
                  esicNoMap[normalizeEmployeeCode(ec)] = esicVal;
                  if (/^\d+$/.test(ec)) {
                    const ecNum = String(parseInt(ec));
                    uanNoMap[ecNum] = uanVal;
                    esicNoMap[ecNum] = esicVal;
                  }
                  const empOA = emp.OtherAllowances ?? emp.otherAllowances ?? emp.OtherAllowance ?? emp.otherAllowance ?? emp.RevisedOtherAllowance ?? 0;
                  const oaVal = Number(empOA) || 0;
                  employeeOtherAllowancesMapForImport[ec] = oaVal;
                  employeeOtherAllowancesMapForImport[normalizeEmployeeCode(ec)] = oaVal;
                  if (/^\d+$/.test(ec)) employeeOtherAllowancesMapForImport[String(parseInt(ec))] = oaVal;

                  const tcVal = Number(emp.TravelChargers ?? emp.travelChargers ?? emp.TravelCharges ?? emp.travelCharges ?? 0) || 0;
                  travelChargersMap[ec] = tcVal;
                  travelChargersMap[normalizeEmployeeCode(ec)] = tcVal;
                  if (/^\d+$/.test(ec)) travelChargersMap[String(parseInt(ec))] = tcVal;
                }
              }
              console.log(`Fetched PFStatus, ESIStatus, EmployeeStatus, DateofJoining, and OtherAllowance for ${Object.keys(pfStatusMap).length} employees`);
            }
          } catch (statusErr) {
            console.log('Error fetching PFStatus/ESIStatus/EmployeeStatus/DateofJoining/OtherAllowance, will default to applying PF/ESI:', statusErr.message);
            try {
              const employeeCodes = payrollRecords.map(r => r.Payroll.EmployeeCode).filter(Boolean);
              if (employeeCodes.length > 0) {
                const empCodesList = employeeCodes.map(code => `'${String(code).replace(/'/g, "''")}'`).join(',');
                const fallbackQuery = `SELECT EmployeeCode, EmployeeName, Department, DateofJoining, Designation, Category, RelevantExperience, AttendanceAllowance, OtherAllowance, TravelChargers, UANNo, ESICNo, ActualBasic, ActualHRA, ActualDA, SpecialAllowance, ActualSpecialAllowance, TotalSalary FROM Employee WHERE EmployeeCode IN (${empCodesList})`;
                const fallbackRecords = await catalystApp.zcql().executeZCQLQuery(fallbackQuery);
                for (const row of fallbackRecords) {
                  const emp = row.Employee;
                  if (emp && emp.EmployeeCode) {
                    const ec = String(emp.EmployeeCode);
                    seedImportSalaryFromEmp(emp);
                    let doj = '';
                    const dojRaw = emp.DateofJoining ?? emp.dateofjoining ?? emp.DateOfJoining;
                    if (dojRaw) {
                      const d = new Date(dojRaw);
                      if (!isNaN(d)) doj = d.toISOString().slice(0, 10);
                    }
                    dateOfJoiningMap[ec] = doj;
                    dateOfJoiningMap[normalizeEmployeeCode(ec)] = doj;
                    if (/^\d+$/.test(ec)) dateOfJoiningMap[String(parseInt(ec))] = doj;
                    const desigFb = String(emp.Designation ?? emp.designation ?? '').trim();
                    designationMap[ec] = desigFb;
                    designationMap[normalizeEmployeeCode(ec)] = desigFb;
                    if (/^\d+$/.test(ec)) designationMap[String(parseInt(ec))] = desigFb;
                    const catFb = String(emp.Category ?? emp.category ?? '').trim();
                    categoryMap[ec] = catFb;
                    categoryMap[normalizeEmployeeCode(ec)] = catFb;
                    if (/^\d+$/.test(ec)) categoryMap[String(parseInt(ec))] = catFb;
                    const unitFb = String(emp.RelevantExperience ?? emp.relevantExperience ?? '').trim();
                    unitMap[ec] = unitFb;
                    unitMap[normalizeEmployeeCode(ec)] = unitFb;
                    if (/^\d+$/.test(ec)) unitMap[String(parseInt(ec))] = unitFb;
                    putKeyedStringMap(employeeNameMap, ec, emp.EmployeeName ?? emp.employeeName ?? emp.Name ?? emp.name);
                    putKeyedStringMap(departmentMap, ec, emp.Department ?? emp.department);
                    const uanVal = String(emp.UANNo ?? emp.uanNo ?? emp.UAN ?? '').trim();
                    const esicVal = String(emp.ESICNo ?? emp.esicNo ?? emp.ESIC ?? '').trim();
                    uanNoMap[ec] = uanVal;
                    uanNoMap[normalizeEmployeeCode(ec)] = uanVal;
                    esicNoMap[ec] = esicVal;
                    esicNoMap[normalizeEmployeeCode(ec)] = esicVal;
                    if (/^\d+$/.test(ec)) {
                      const ecNum = String(parseInt(ec));
                      uanNoMap[ecNum] = uanVal;
                      esicNoMap[ecNum] = esicVal;
                    }
                    const empOA = emp.OtherAllowance ?? emp.otherAllowance ?? 0;
                    const oaVal = Number(empOA) || 0;
                    employeeOtherAllowancesMapForImport[ec] = oaVal;
                    employeeOtherAllowancesMapForImport[normalizeEmployeeCode(ec)] = oaVal;

                    const tcVal = Number(emp.TravelChargers ?? emp.travelChargers ?? emp.TravelCharges ?? emp.travelCharges ?? 0) || 0;
                    travelChargersMap[ec] = tcVal;
                    travelChargersMap[normalizeEmployeeCode(ec)] = tcVal;
                  }
                }
              }
            } catch (fbErr) {
              console.log('Fallback OtherAllowance fetch failed:', fbErr.message);
            }
          }
        }
   
        // If a forced contractor is applied (App User), ignore imported payroll data so we always calculate fresh
        if (forcedContractor) {
          console.log('Forced contractor detected - ignoring imported payroll data and recalculating fresh');
          payrollRecords = [];
          importedEmployeeCodeSet = new Set();
        }

        if (payrollRecords.length > 0) {
          console.log(`✅ USING IMPORTED PAYROLL DATA: ${payrollRecords.length} records`);
          console.log('⚠️ IMPORTANT: These employees will NOT be recalculated - imported data takes priority');
          // Helper function to parse numeric values (table columns are text type)
          const parseNum = (val) => {
            const num = parseFloat(val);
            return isNaN(num) ? 0 : num;
          };
          // Get numeric value from payroll row trying multiple key casings (DB may return different casing)
          const getPayrollNum = (p, ...keys) => {
            for (const k of keys) {
              const v = p[k];
              if (v !== undefined && v !== null && String(v).trim() !== '') {
                const n = parseFloat(v);
                if (!isNaN(n)) return n;
              }
            }
            return 0;
          };
          // Prefer non-zero Payroll value; otherwise use Employee master (fixes stale Payroll ActualBasic/HRA = 0).
          const empKeysForImport = (ec) =>
            [ec, normalizeEmployeeCode(ec), /^\d+$/.test(String(ec || '')) ? String(parseInt(ec, 10)) : null].filter(Boolean);
          const fromEmployeeOrPayrollImport = (payrollVal, empMap, ec) => {
            const payNum = Number(payrollVal);
            if (Number.isFinite(payNum) && payNum > 0) return payNum;
            for (const k of empKeysForImport(ec)) {
              const v = empMap[k];
              if (v !== undefined && v !== null && Number(v) > 0) return Number(v);
            }
            return Number.isFinite(payNum) && payNum >= 0 ? payNum : 0;
          };
          const importFormulae = await getPayrollFormulae(catalystApp);
          // Use imported payroll data
          for (const row of payrollRecords) {
            const payroll = row.Payroll;
            console.log('Processing imported payroll record from Payroll table:', {
              employeeCode: payroll.EmployeeCode,
              employeeName: payroll.EmployeeName,
              daysPresent: payroll.DaysPresent,
              daysPresentType: typeof payroll.DaysPresent,
              otHours: payroll.OTHours,
              otHoursType: typeof payroll.OTHours,
              actualBasic: payroll.ActualBasic,
              netPay: payroll.NetPay
            });
            if (payroll.EmployeeCode) {
              importedEmployeeCodeSet.add(String(payroll.EmployeeCode));
            }
            // Calculate OT wages using formula for consistency, even for imported data
            // Convert to numbers properly (table columns are text type)
            // Use let so we can recompute from formula (including Other Allowances) after otherAllowancesImported is set
            let actualTotalSalary = parseFloat(payroll.ActualTotalSalary) || 0;
            const daysInMonth = parseFloat(payroll.DaysInMonth) || 0;
            let calculatedOTWages = daysInMonth > 0 ? actualTotalSalary / daysInMonth / 8 : 0;
       
            // Always prioritize saved DaysPresent from Payroll table (user edits should be preserved)
            // Only use attendance/muster data if saved value is not available (null, undefined, or empty)
            // Convert to number properly (table columns are text type)
            let actualDaysPresent = 0;
            let totalOvertimeHours = parseFloat(payroll.OTHours) || 0;
            if (isNaN(totalOvertimeHours)) totalOvertimeHours = 0;
           
            // Check if DaysPresent exists in the payroll record (even if it's 0, it means user has set it)
            // This distinguishes between "field not set" vs "field set to 0"
            const hasSavedDaysPresent = payroll.DaysPresent !== null && payroll.DaysPresent !== undefined && String(payroll.DaysPresent).trim() !== '';
            const savedDaysPresent = hasSavedDaysPresent ? (parseFloat(payroll.DaysPresent) || 0) : null;
            const sampleDaysPresent = samplePayrollOverrides.manualMode
              ? pickEmployeeKeyedMapValue(samplePayrollOverrides.daysPresent, payroll.EmployeeCode)
              : undefined;
            const sampleOTHours = samplePayrollOverrides.manualMode
              ? pickEmployeeKeyedMapValue(samplePayrollOverrides.otHours, payroll.EmployeeCode)
              : undefined;
            const sampleLOH = samplePayrollOverrides.manualMode
              ? pickEmployeeKeyedMapValue(samplePayrollOverrides.loh, payroll.EmployeeCode)
              : undefined;
           
            // Always prioritize saved OT Hours from Payroll table (user edits should be preserved)
            // EXCEPTION: For January, only use real-time data (not saved data)
            // For December, always use saved data to preserve existing data
            // If no saved value exists, fetch from attendance_muster_function
            const payrollEmpCodeStr = String(payroll.EmployeeCode).trim();
            const payrollEmpCodeNum = parseInt(payrollEmpCodeStr);
           
            // Always keep user-edited OT Hours from Payroll table when present.
            const hasSavedOTHours = payroll.OTHours !== null && payroll.OTHours !== undefined && String(payroll.OTHours).trim() !== '';
            if (hasSavedOTHours) {
              totalOvertimeHours = parseFloat(payroll.OTHours) || 0;
              if (isNaN(totalOvertimeHours)) totalOvertimeHours = 0;
              totalOvertimeHours = parseFloat(totalOvertimeHours.toFixed(3));
              console.log(`Imported payroll - Employee ${payroll.EmployeeCode}: Using saved OT Hours value from Payroll table: ${totalOvertimeHours} (preserving user edit)`);
            } else {
              // If no saved value exists, fetch from attendance_muster_function
              let fetchedOT = null;
              let foundKeyImported = null;
             
              // Try direct matches first
              if (otHoursMap[payroll.EmployeeCode] !== undefined) {
                fetchedOT = otHoursMap[payroll.EmployeeCode];
                foundKeyImported = payroll.EmployeeCode;
              } else if (otHoursMap[payrollEmpCodeStr] !== undefined) {
                fetchedOT = otHoursMap[payrollEmpCodeStr];
                foundKeyImported = payrollEmpCodeStr;
              } else if (!isNaN(payrollEmpCodeNum)) {
                if (otHoursMap[String(payrollEmpCodeNum)] !== undefined) {
                  fetchedOT = otHoursMap[String(payrollEmpCodeNum)];
                  foundKeyImported = String(payrollEmpCodeNum);
                } else if (otHoursMap[payrollEmpCodeNum] !== undefined) {
                  fetchedOT = otHoursMap[payrollEmpCodeNum];
                  foundKeyImported = payrollEmpCodeNum;
                }
              }
             
              // If not found, try fuzzy matching
              if (fetchedOT === null && Object.keys(otHoursMap).length > 0) {
                for (const otKey in otHoursMap) {
                  const otKeyStr = String(otKey).trim();
                  const otKeyNum = parseInt(otKeyStr);
                  if (otKeyStr === payrollEmpCodeStr || otKeyStr === String(payroll.EmployeeCode)) {
                    fetchedOT = otHoursMap[otKey];
                    foundKeyImported = otKey;
                    break;
                  }
                  if (!isNaN(payrollEmpCodeNum) && !isNaN(otKeyNum) && otKeyNum === payrollEmpCodeNum) {
                    fetchedOT = otHoursMap[otKey];
                    foundKeyImported = otKey;
                    break;
                  }
                }
              }
             
              // Use fetched value if available
              if (fetchedOT !== null) {
                totalOvertimeHours = fetchedOT;
                if (payroll.EmployeeCode === '33021' || payroll.EmployeeCode === 33021 || payrollEmpCodeStr === '33021') {
                  console.log(`Imported payroll - Employee 33021: Using OT Hours from attendance_muster_function: ${totalOvertimeHours} (matched key: "${foundKeyImported}")`);
                } else {
                  console.log(`Imported payroll - Employee ${payroll.EmployeeCode}: Using OT Hours from attendance_muster_function: ${totalOvertimeHours} (matched key: "${foundKeyImported}")`);
                }
                totalOvertimeHours = parseFloat((totalOvertimeHours || 0).toFixed(3));
              } else {
                // No saved value and no fetched value - default to 0
                totalOvertimeHours = 0;
                if (payroll.EmployeeCode === '33021' || payroll.EmployeeCode === 33021 || payrollEmpCodeStr === '33021') {
                  console.log(`⚠️ Imported payroll - Employee 33021: No OT hours found (saved: none, fetched: null), defaulting to 0`);
                  console.log(`   otHoursMap size: ${Object.keys(otHoursMap).length}, keys (first 30): ${Object.keys(otHoursMap).slice(0, 30).join(', ')}`);
                } else {
                  console.log(`Imported payroll - Employee ${payroll.EmployeeCode}: No saved OT Hours value found and no OT hours from attendance_muster_function, defaulting to 0`);
                }
                totalOvertimeHours = parseFloat((totalOvertimeHours || 0).toFixed(3));
              }
            }
            // Prefer OTHours from the newest Payroll row for this employee+month (handles duplicate rows / stale iterator row).
            const latestSavedOt = pickEmployeeKeyedMapValue(latestSavedOtHoursByEmp, payroll.EmployeeCode);
            if (latestSavedOt !== undefined && latestSavedOt !== null && Number.isFinite(Number(latestSavedOt))) {
              totalOvertimeHours = parseFloat(Number(latestSavedOt).toFixed(3));
              console.log(`Imported payroll - Employee ${payroll.EmployeeCode}: Using latest saved OTHours for month (newest ROWID): ${totalOvertimeHours}`);
            }
            // Manual mode must prefer SamplePayroll over saved/fetched OT from Payroll/muster.
            if (sampleOTHours !== undefined && !Number.isNaN(Number(sampleOTHours)) && Number(sampleOTHours) >= 0) {
              totalOvertimeHours = parseFloat(Number(sampleOTHours).toFixed(3));
              console.log(`Imported payroll - Employee ${payroll.EmployeeCode}: Using OT Hours from SamplePayroll (manual mode): ${totalOvertimeHours}`);
            }
         
            // IMPORTANT: Always prioritize imported/saved DaysPresent from Payroll table (preserves user edits and imported data)
            // Only use attendance/muster data if no saved value exists
            const employeeAttendance = attendanceData.find(att => att.employeeId === payroll.EmployeeCode);
            const employeeAttendanceStr = attendanceData.find(att => String(att.employeeId) === String(payroll.EmployeeCode));
            // payrollEmpCodeStr and payrollEmpCodeNum already declared above
            let musterDays = musterPresentDaysMap[payrollEmpCodeStr] ?? musterPresentDaysMap[payroll.EmployeeCode];
            let foundInMuster = musterDays !== undefined;
           
            // Try number conversion matching
            if (!foundInMuster && !isNaN(payrollEmpCodeNum)) {
              musterDays = musterPresentDaysMap[String(payrollEmpCodeNum)];
              foundInMuster = musterDays !== undefined;
            }
           
            // Manual mode: use SamplePayroll DaysPresent only when it is positive.
            // If SamplePayroll has 0, fallback to saved Payroll value (can be >0 for duplicate month rows).
            if (sampleDaysPresent !== undefined && !Number.isNaN(Number(sampleDaysPresent)) && Number(sampleDaysPresent) > 0) {
              actualDaysPresent = Math.max(0, Math.round((Number(sampleDaysPresent) + Number.EPSILON) * 2) / 2);
              console.log(`Imported payroll - Employee ${payroll.EmployeeCode}: Using Days Present from SamplePayroll (manual mode): ${actualDaysPresent}`);
            } else if (hasSavedDaysPresent && savedDaysPresent !== null) {
              // Use saved/imported value (preserves user edits and imported data)
              actualDaysPresent = savedDaysPresent;
              console.log(`Imported payroll - Employee ${payroll.EmployeeCode}: Using saved/imported Days Present from Payroll table: ${actualDaysPresent} (preserving imported data)`);
            } else {
              // No saved value - use attendance/muster data
              if (foundInMuster) {
                // Employee found in muster - use muster value
                actualDaysPresent = musterDays;
                console.log(`Imported payroll - Employee ${payroll.EmployeeCode}: Using attendance muster Days Present: ${actualDaysPresent} (no saved value found)`);
              } else if (Object.keys(musterPresentDaysMap).length > 0 && !foundInMuster) {
                // Muster map exists but employee NOT found in it - set to 0 (no attendance data)
                actualDaysPresent = 0;
                console.log(`Imported payroll - Employee ${payroll.EmployeeCode}: NOT found in muster map - setting daysPresent to 0 (no attendance data)`);
              } else if (employeeAttendance && employeeAttendance.totalDaysPresent > 0) {
                // Muster map empty, try attendance data
                actualDaysPresent = employeeAttendance.totalDaysPresent;
                console.log(`Imported payroll - Employee ${payroll.EmployeeCode}: Using attendance data Days Present: ${actualDaysPresent} (no saved value found)`);
              } else if (employeeAttendanceStr && employeeAttendanceStr.totalDaysPresent > 0) {
                actualDaysPresent = employeeAttendanceStr.totalDaysPresent;
                console.log(`Imported payroll - Employee ${payroll.EmployeeCode}: Using attendance data Days Present: ${actualDaysPresent} (string match, no saved value found)`);
              } else {
                // No data found anywhere - default to 0
                actualDaysPresent = 0;
                console.log(`Imported payroll - Employee ${payroll.EmployeeCode}: Days Present not found in saved data or attendance, defaulting to 0`);
              }
            }

            // Normalize to 0.5-step to avoid float drift like 10.11
            actualDaysPresent = Math.max(0, Math.round((actualDaysPresent + Number.EPSILON) * 2) / 2);
         
            console.log(`Imported payroll - Employee ${payroll.EmployeeCode}: Using imported OT hours value: ${totalOvertimeHours}`);
       
            // Debug: Log imported data processing
            if (importedPayrollData.length < 3) {
              const foundAttendance = attendanceData.find(att => String(att.employeeId) === String(payroll.EmployeeCode));
              const daysPresentSource = (actualDaysPresent > 0 && Number(payroll.DaysPresent) === actualDaysPresent)
                                       ? 'Imported Data (Preserved)'
                                       : (foundAttendance && foundAttendance.totalDaysPresent > 0)
                                         ? `BHR Table (Auto-fetched from ${dataSource})`
                                         : 'Imported Excel Data';
              console.log(`Employee ${payroll.EmployeeCode} imported data processing:`, {
                importedDaysPresent: payroll.DaysPresent || 0,
                finalDaysPresent: actualDaysPresent,
                daysPresentSource: daysPresentSource,
                originalOTWages: payroll.OTWages || 0,
                calculatedOTWages: calculatedOTWages,
                actualTotalSalary: actualTotalSalary,
                daysInMonth: daysInMonth,
                formula: 'OT Wages = actualTotalSalary / daysInMonth / 8',
                otHours: totalOvertimeHours,
                otHoursSource: 'Imported Excel Data',
                dataSource: dataSource
              });
            }
       
            // Recalculate earnings using LOH-based earned basic formula for imported data
            // Convert to numbers properly (table columns are text type)
            let importDaysInMonth = parseFloat(payroll.DaysInMonth) || 0;
            if (samplePayrollOverrides.manualMode) {
              const spDim = pickEmployeeKeyedMapValue(samplePayrollOverrides.daysInMonth, payroll.EmployeeCode);
              if (spDim !== undefined && !Number.isNaN(Number(spDim)) && Number(spDim) > 0) {
                importDaysInMonth = Number(spDim);
              }
            }
            const payrollEmpCodeForSalary = String(payroll.EmployeeCode || '');
            let importActualBasic = fromEmployeeOrPayrollImport(
              payroll.ActualBasic,
              employeeActualBasicMapForImport,
              payrollEmpCodeForSalary
            );
            let importActualHRA = fromEmployeeOrPayrollImport(
              payroll.ActualHRA,
              employeeActualHRAMapForImport,
              payrollEmpCodeForSalary
            );
            let importActualDA = fromEmployeeOrPayrollImport(
              payroll.ActualDA,
              employeeActualDAMapForImport,
              payrollEmpCodeForSalary
            );
            let importSpecialAllowance = fromEmployeeOrPayrollImport(
              getPayrollNum(payroll, 'SpecialAllowance', 'specialAllowance'),
              employeeSpecialAllowanceMapForImport,
              payrollEmpCodeForSalary
            );
            if (samplePayrollOverrides.manualMode) {
              const spAb = pickEmployeeKeyedMapValue(samplePayrollOverrides.actualBasic, payroll.EmployeeCode);
              if (spAb !== undefined && !Number.isNaN(Number(spAb)) && Number(spAb) > 0) {
                importActualBasic = Number(spAb);
              }
            }
            // Apply Setup formulae for Actual Basic / HRA / DA / Special Allowance when defined (same as computePayrollData).
            if (importFormulae.length > 0) {
              let empTotalForFormula = 0;
              for (const k of empKeysForImport(payrollEmpCodeForSalary)) {
                const v = employeeTotalSalaryMapForImport[k];
                if (v !== undefined && v !== null && Number(v) > 0) {
                  empTotalForFormula = Number(v);
                  break;
                }
              }
              const payrollTotal = parseFloat(payroll.ActualTotalSalary) || 0;
              const computedFormTotal = computedEmployeeFormActualTotalSalary(
                importActualBasic,
                importActualHRA,
                importActualDA,
                importSpecialAllowance
              );
              const actualTotalForFormula =
                empTotalForFormula > 0 ? empTotalForFormula : payrollTotal > 0 ? payrollTotal : computedFormTotal;
              const pfContextImport = {
                'Actual Total Salary': actualTotalForFormula,
                'Actual Total Gross': actualTotalForFormula,
                'Actual HRA': importActualHRA,
                'Actual DA': importActualDA,
                'Attendance Allowance': 0,
                'Other Allowances': 0,
                TravelChargers: 0,
                'Travel Charges': 0
              };
              const {
                actualBasic: abFromFormula,
                actualHRA: ahFromFormula,
                actualDA: adFromFormula,
                specialAllowance: saFromFormula
              } = getActualBasicAndSpecialAllowanceFromFormulae(importFormulae, pfContextImport);
              if (abFromFormula !== null) importActualBasic = abFromFormula;
              if (ahFromFormula !== null) importActualHRA = ahFromFormula;
              if (adFromFormula !== null) importActualDA = adFromFormula;
              if (saFromFormula !== null) importSpecialAllowance = saFromFormula;
            }
            if (!(actualTotalSalary > 0)) {
              let empTotalForAts = 0;
              for (const k of empKeysForImport(payrollEmpCodeForSalary)) {
                const v = employeeTotalSalaryMapForImport[k];
                if (v !== undefined && v !== null && Number(v) > 0) {
                  empTotalForAts = Number(v);
                  break;
                }
              }
              actualTotalSalary =
                empTotalForAts > 0
                  ? empTotalForAts
                  : computedEmployeeFormActualTotalSalary(
                      importActualBasic,
                      importActualHRA,
                      importActualDA,
                      importSpecialAllowance
                    );
            }
            // Non-zero saved LOH from Payroll wins; zero uses muster (same as computePayrollData / OT Hours).
            // EXCEPTION: For January, only use real-time data (not saved data)
            let importLOH = 0;
            const empIdStr = String(payroll.EmployeeCode);
           
            const parsedRowLohImp =
              !isJanuary && payroll.LOH !== null && payroll.LOH !== undefined && String(payroll.LOH).trim() !== ''
                ? parseFloat(payroll.LOH)
                : NaN;
            const useSavedPayrollLohImp = Number.isFinite(parsedRowLohImp) && parsedRowLohImp !== 0;
            if (useSavedPayrollLohImp) {
              importLOH = parseFloat(parsedRowLohImp.toFixed(2));
              console.log(`Imported payroll - Employee ${payroll.EmployeeCode}: Using saved LOH value from Payroll table: ${importLOH} (preserving user edit)`);
            } else {
              if (isJanuary) {
                console.log(`Imported payroll - Employee ${payroll.EmployeeCode}: January month detected - skipping saved LOH data, using only real-time data`);
              }
              // If no non-zero saved value, fetch from attendance_muster_function (lohMap)
              // Try multiple matching strategies to handle different data types
              // Strategy 1: Direct match
              if (lohMap[payroll.EmployeeCode] !== undefined) {
                importLOH = lohMap[payroll.EmployeeCode];
              }
           
              // Strategy 2: String conversion match
              if (importLOH === 0 && lohMap[empIdStr] !== undefined) {
                importLOH = lohMap[empIdStr];
              }
           
              // Strategy 3: Number conversion match
              if (importLOH === 0) {
                const empIdNum = parseInt(empIdStr);
                if (!isNaN(empIdNum)) {
                  const empIdNumStr = String(empIdNum);
                  if (lohMap[empIdNumStr] !== undefined) {
                    importLOH = lohMap[empIdNumStr];
                  }
                }
              }
           
              // Strategy 4: Try all keys in lohMap to find a match
              if (importLOH === 0 && Object.keys(lohMap).length > 0) {
                for (const key in lohMap) {
                  const keyStr = String(key).trim();
                  const empIdNum = parseInt(empIdStr);
                  const keyNum = parseInt(keyStr);
                  if (!isNaN(empIdNum) && !isNaN(keyNum) && empIdNum === keyNum) {
                    importLOH = lohMap[key];
                    break;
                  }
                  if (keyStr.toLowerCase() === empIdStr.toLowerCase()) {
                    importLOH = lohMap[key];
                    break;
                  }
                  if (keyStr === empIdStr) {
                    importLOH = lohMap[key];
                    break;
                  }
                }
              }
             
              if (importLOH > 0) {
                console.log(`Imported payroll - Employee ${payroll.EmployeeCode}: Using LOH from attendance_muster_function: ${importLOH.toFixed(2)}`);
              }
            }

            const latestLohPickImp = pickEmployeeKeyedMapValue(latestSavedLohByEmp, payroll.EmployeeCode);
            const hasExplicitLatestPayrollLohImp =
              latestLohPickImp !== undefined &&
              latestLohPickImp !== null &&
              String(latestLohPickImp).trim() !== '' &&
              Number.isFinite(Number(latestLohPickImp)) &&
              Number(latestLohPickImp) !== 0;
            if (hasExplicitLatestPayrollLohImp) {
              importLOH = parseFloat(Number(latestLohPickImp).toFixed(2));
              console.log(
                `Imported payroll - Employee ${payroll.EmployeeCode}: Using LOH from newest Payroll ROWID for month: ${importLOH} (preserving edit/import)`
              );
            }
           
            importLOH = parseFloat(importLOH.toFixed(2));
            if (
              samplePayrollOverrides.manualMode &&
              !hasExplicitLatestPayrollLohImp &&
              sampleLOH !== undefined &&
              sampleLOH !== null &&
              String(sampleLOH).trim() !== '' &&
              !Number.isNaN(Number(sampleLOH))
            ) {
              importLOH = parseFloat(Number(sampleLOH).toFixed(2));
              console.log(`Imported payroll - Employee ${payroll.EmployeeCode}: Using LOH from SamplePayroll (manual mode): ${importLOH}`);
            }
            const hasPayrollOtherAllowanceExplicit =
              payroll.OtherAllowance !== null &&
              payroll.OtherAllowance !== undefined &&
              String(payroll.OtherAllowance).trim() !== '';
            let importAttendanceAllowance = parseNum(payroll.OtherAllowance) || 0;
            if (!hasPayrollOtherAllowanceExplicit || importAttendanceAllowance <= 0) {
              const empAA = fromEmployeeOrPayrollImport(
                0,
                employeeAttendanceAllowanceMapForImport,
                payrollEmpCodeForSalary
              );
              if (empAA > 0 && importAttendanceAllowance <= 0) {
                importAttendanceAllowance = empAA;
              }
            }
            if (samplePayrollOverrides.manualMode && !hasPayrollOtherAllowanceExplicit) {
              const spOaImp = pickEmployeeKeyedMapValue(
                samplePayrollOverrides.otherAllowance,
                payroll.EmployeeCode
              );
              if (
                spOaImp !== undefined &&
                spOaImp !== null &&
                String(spOaImp).trim() !== '' &&
                !Number.isNaN(Number(spOaImp))
              ) {
                importAttendanceAllowance = Number(spOaImp) || 0;
                console.log(
                  `Imported payroll - Employee ${payroll.EmployeeCode}: Using OtherAllowance (attendance) from SamplePayroll (manual mode): ${importAttendanceAllowance}`
                );
              }
            }
            const desMpImported =
              designationMap[payrollEmpCodeStr] ??
              designationMap[normalizeEmployeeCode(payrollEmpCodeStr)] ??
              designationMap[String(parseInt(payrollEmpCodeStr, 10))] ??
              '';
            if (isManagingPartnerDesignation({ Designation: desMpImported }) && importDaysInMonth > 0) {
              actualDaysPresent = importDaysInMonth;
            }
            // Earned Basic = (Actual Basic / No. of Days(In month) * No. of Days Present) - ((Actual Basic / No. of Days(In month)) / 8 * LOH)
            const dailyBasicRateImported = importDaysInMonth > 0 ? importActualBasic / importDaysInMonth : 0;
            let earnedBasicImported = (dailyBasicRateImported * actualDaysPresent) - ((dailyBasicRateImported / 8) * importLOH);
            // Earned HRA = (Actual HRA / No. of Days(In month) * No. of Days Present) - ((Actual HRA / No. of Days(In month)) / 8 * LOH)
            const dailyHRARateImported = importDaysInMonth > 0 ? importActualHRA / importDaysInMonth : 0;
            let earnedHRAImported = (dailyHRARateImported * actualDaysPresent) - ((dailyHRARateImported / 8) * importLOH);
            const dailyDARateImported = importDaysInMonth > 0 ? importActualDA / importDaysInMonth : 0;
            let earnedDAImported = (dailyDARateImported * actualDaysPresent) - ((dailyDARateImported / 8) * importLOH);
            const specialAllowanceForEarned = importSpecialAllowance;
            // Earned Special Allowance = (Special Allowance / No. of Days(In month) * No. of Days Present)
            const dailySpecialRateImported = importDaysInMonth > 0 ? specialAllowanceForEarned / importDaysInMonth : 0;
            let earnedSpecialAllowanceImported = Math.max(0, dailySpecialRateImported * actualDaysPresent);
            if (importFormulae.length > 0) {
              const otherAllowancesImportedForCtx = (parseNum(payroll.OtherAllowances) || 0) || (employeeOtherAllowancesMapForImport[String(payroll.EmployeeCode)] ?? 0);
              const importCtx = {
                'Actual Basic': importActualBasic,
                'Actual HRA': importActualHRA,
                'Actual DA': importActualDA,
                'Days Present': actualDaysPresent,
                'No. of Days Present': actualDaysPresent,
                'LOH': importLOH,
                'Days In Month': importDaysInMonth,
                'No. of Days(In month)': importDaysInMonth,
                'No. of Days (In Month)': importDaysInMonth,
                'No. of Days in Month': importDaysInMonth,
                'Attendance Allowance': importAttendanceAllowance,
                'Other Allowances': otherAllowancesImportedForCtx,
                'Special Allowance': specialAllowanceForEarned,
                'Actual Total Gross': actualTotalSalary,
                'Earned Basic': earnedBasicImported,
                'Earned HRA': earnedHRAImported,
                'Earned DA': earnedDAImported,
                'Earned Special Allowance': earnedSpecialAllowanceImported
              };
              for (const { variable, expression } of importFormulae) {
                const v = String(variable).trim();
                if (!v) continue;
                const num = evaluateFormulaExpression(expression, importCtx);
                if (v === 'Earned Basic') earnedBasicImported = Math.max(0, num);
                else if (v === 'Earned HRA') earnedHRAImported = Math.max(0, num);
                else if (v === 'Earned DA') earnedDAImported = Math.max(0, num);
                else if (v === 'Earned Special Allowance') earnedSpecialAllowanceImported = Math.max(0, num);
              }
            }
            // Always prioritize saved Earned Attendance Allowance from Payroll table (user edits should be preserved)
            // If no saved value, calculate using formula: (Actual Attendance Allowance / daysInMonth × daysPresent) - ((Actual Attendance Allowance / daysInMonth) / 8 × LOH)
            let earnedAttendanceAllowanceImported = 0;
            const empCodeStrAA = String(payroll.EmployeeCode || '').trim();
            if (payroll.EarnedAttendanceAllowance !== null && payroll.EarnedAttendanceAllowance !== undefined && String(payroll.EarnedAttendanceAllowance).trim() !== '') {
              earnedAttendanceAllowanceImported = parseFloat(payroll.EarnedAttendanceAllowance) || 0;
              console.log(`Imported payroll - Employee ${payroll.EmployeeCode}: Using saved Earned Attendance Allowance from EarnedAttendanceAllowance column: ${earnedAttendanceAllowanceImported} (preserving user edit)`);
            } else if (payroll.AttendanceAllowance !== null && payroll.AttendanceAllowance !== undefined && String(payroll.AttendanceAllowance).trim() !== '') {
              earnedAttendanceAllowanceImported = parseFloat(payroll.AttendanceAllowance) || 0;
              console.log(`Imported payroll - Employee ${payroll.EmployeeCode}: Using saved Earned Attendance Allowance from AttendanceAllowance column: ${earnedAttendanceAllowanceImported} (preserving user edit)`);
            } else {
              // Calculate using formula: (Actual Attendance Allowance / daysInMonth × daysPresent) - ((Actual Attendance Allowance / daysInMonth) / 8 × LOH)
              const actualAttendanceAllowanceImported = importAttendanceAllowance;
              if (actualAttendanceAllowanceImported > 0) {
                const dailyAttendanceAllowanceRateImported = importDaysInMonth > 0 ? actualAttendanceAllowanceImported / importDaysInMonth : 0;
                earnedAttendanceAllowanceImported = (dailyAttendanceAllowanceRateImported * actualDaysPresent) - ((dailyAttendanceAllowanceRateImported / 8) * importLOH);
                console.log(`Imported payroll - Employee ${payroll.EmployeeCode}: Calculated Earned Attendance Allowance using formula: (${actualAttendanceAllowanceImported}/${importDaysInMonth}*${actualDaysPresent}) - (${actualAttendanceAllowanceImported}/${importDaysInMonth}/8*${importLOH}) = ${earnedAttendanceAllowanceImported}`);
              } else {
                earnedAttendanceAllowanceImported = 0;
                console.log(`Imported payroll - Employee ${payroll.EmployeeCode}: No Actual Attendance Allowance found, Earned Attendance Allowance = 0`);
              }
            }
            const arrearImported = parseNum(payroll.Arrear) || 0;
            const payOA = parseNum(payroll.OtherAllowances) || 0;
            const empCodeStrForOA = String(payroll.EmployeeCode || '');
            const empOAFromMap = employeeOtherAllowancesMapForImport[empCodeStrForOA] ?? employeeOtherAllowancesMapForImport[normalizeEmployeeCode(empCodeStrForOA)] ?? employeeOtherAllowancesMapForImport[String(parseInt(empCodeStrForOA))] ?? 0;
            const otherAllowancesImported = payOA > 0 ? payOA : empOAFromMap;
            // Earned Other Allowances = (OtherAllowances / daysInMonth * daysPresent) - ((OtherAllowances / daysInMonth) / 8 * LOH)
            // Use ONLY OtherAllowances (plural) from Payroll - never OtherAllowance (Attendance Allowance) or emp fallback
            const otherAllowancesForEarnedImported = payOA; // Only payroll.OtherAllowances, not empOAFromMap (which may include OtherAllowance)
            const dailyOtherAllowancesRateImported = importDaysInMonth > 0 ? otherAllowancesForEarnedImported / importDaysInMonth : 0;
            const earnedOtherAllowancesImported = (dailyOtherAllowancesRateImported * actualDaysPresent) - ((dailyOtherAllowancesRateImported / 8) * importLOH);
            const incentiveImported = parseNum(payroll.Incentive) || 0;
            const specialAllowanceImported = importSpecialAllowance;
            const otArrearAmountImported = parseNum(payroll.OTArrearAmount) || 0;
            const arrearForPFImported = parseNum(payroll.ArrearForPF) || 0;
            const rawTcPay = payroll.TravelChargers ?? payroll.travelChargers;
            const hasPayrollTravelExplicit =
              rawTcPay !== null && rawTcPay !== undefined && String(rawTcPay).trim() !== '';
            let travelChargersForTotal =
              (hasPayrollTravelExplicit ? parseNum(rawTcPay) : null) ??
              travelChargersMap[empCodeStrForOA] ??
              travelChargersMap[normalizeEmployeeCode(empCodeStrForOA)] ??
              travelChargersMap[String(parseInt(empCodeStrForOA))] ??
              0;
            if (samplePayrollOverrides.manualMode && !hasPayrollTravelExplicit) {
              const spTcImp = pickEmployeeKeyedMapValue(samplePayrollOverrides.travelChargers, payroll.EmployeeCode);
              if (
                spTcImp !== undefined &&
                spTcImp !== null &&
                String(spTcImp).trim() !== '' &&
                !Number.isNaN(Number(spTcImp))
              ) {
                travelChargersForTotal = Number(spTcImp) || 0;
              }
            }
            // Actual Total Gross = Actual Basic + Actual HRA + Actual DA + Other Allowance + Other Allowances + Travel Charges + Special Allowance
            actualTotalSalary =
              (importActualBasic || 0) +
              (importActualHRA || 0) +
              (importActualDA || 0) +
              importAttendanceAllowance +
              otherAllowancesImported +
              travelChargersForTotal +
              (importSpecialAllowance || 0);
            calculatedOTWages = importDaysInMonth > 0 ? actualTotalSalary / importDaysInMonth / 8 : 0;
            const baseEarnedGrossImported = earnedBasicImported + earnedHRAImported + earnedDAImported + earnedAttendanceAllowanceImported + earnedOtherAllowancesImported + arrearImported + arrearForPFImported + incentiveImported + otArrearAmountImported;
            const defaultOtAmountImported = computeDefaultOtAmountFromEarnedAndActual({
              earnedBasic: earnedBasicImported,
              actualBasic: importActualBasic,
              daysInMonth: importDaysInMonth,
              daysPresent: actualDaysPresent,
              otHours: totalOvertimeHours
            });
            const otImportedBaseCtx = {
              'Actual Basic': importActualBasic,
              'Actual HRA': importActualHRA,
              'Actual DA': importActualDA,
              'Special Allowance': specialAllowanceForEarned,
              'Travel Charges': travelChargersForTotal,
              'TravelChargers': travelChargersForTotal,
              'Days Present': actualDaysPresent,
              'No. of Days Present': actualDaysPresent,
              'Days In Month': importDaysInMonth,
              'No. of Days in Month': importDaysInMonth,
              'No. of Days (In Month)': importDaysInMonth,
              'No. of Days(In month)': importDaysInMonth,
              'LOH': importLOH,
              'Earned Basic': earnedBasicImported,
              'Earned HRA': earnedHRAImported,
              'Earned DA': earnedDAImported,
              'Earned Special Allowance': earnedSpecialAllowanceImported,
              'OT Hours': totalOvertimeHours,
              'Actual Total Gross': actualTotalSalary,
              'Actual Total Salary': actualTotalSalary,
              'Attendance Allowance': importAttendanceAllowance,
              'Other Allowances': otherAllowancesImported
            };
            const otAmountImportedResolved = getOTAmountFromPayrollFormulae(importFormulae, otImportedBaseCtx);
            const otAmountImported = otAmountImportedResolved !== null && otAmountImportedResolved !== undefined ? Math.max(0, otAmountImportedResolved) : defaultOtAmountImported;
            // Contractor check: if "Yashaswi Academy for Skills", do not calculate PT, PF, ESI (set to 0)
            const contractorNameImported = String(payroll.Contractor || '').trim();
            const contractorNameImportedLower = contractorNameImported.toLowerCase();
            // Check PFStatus and ESIStatus from Employee table
            const empCodeStr = String(payroll.EmployeeCode || '');
            const pfStatus = pfStatusMap[empCodeStr] || '';
            const isPfApplicable = pfStatus !== 'no';
            // PF: match payroll UI (Setup formula or Earned Basic + Earned Special statutory rule).
            let pfWagesImported;
            let pfImported;
            if (!isPfApplicable) {
              pfImported = 0;
              pfWagesImported = 0;
            } else {
              const pfImpBox = computePfLikePayrollUi(
                importFormulae,
                otImportedBaseCtx,
                earnedBasicImported,
                earnedSpecialAllowanceImported
              );
              pfImported = pfImpBox.pf;
              pfWagesImported = pfImpBox.pfWages;
            }
            const rentAmount = payroll.Rent || 0;
            const advanceAmount = payroll.Advance || 0;
            // OT Payment: Setup formula when defined; else (Actual Total Salary / days in month) / 8 * OT Hours * 2
            const defaultOtPaymentImported = importDaysInMonth > 0 ? ((actualTotalSalary / importDaysInMonth) / 8) * totalOvertimeHours * 2 : 0;
            const otPaymentImportedResolved = getOTPaymentFromPayrollFormulae(importFormulae, Object.assign({}, otImportedBaseCtx, { 'OT Amount': otAmountImported }));
            const otPaymentImported = otPaymentImportedResolved !== null && otPaymentImportedResolved !== undefined ? Math.max(0, otPaymentImportedResolved) : defaultOtPaymentImported;
            const esiStatus = esiStatusMap[empCodeStr] || '';
            // Prefer saved Attendance Bonus from Payroll so it persists after refresh
            const attendanceBonusImported = (() => {
              const savedRaw = payroll.AttendanceBonus ?? payroll.attendanceBonus;
              if (savedRaw != null && savedRaw !== undefined && String(savedRaw).trim() !== '') {
                const n = parseNum(savedRaw);
                if (n !== null && n !== undefined && Number.isFinite(Number(n))) return Number(n);
              }
              const doj = dateOfJoiningMap[empCodeStr] ?? dateOfJoiningMap[normalizeEmployeeCode(empCodeStr)] ?? dateOfJoiningMap[String(parseInt(empCodeStr))] ?? '';
              return calcAttendanceBonus(doj, actualDaysPresent, importDaysInMonth, month);
            })();
            const foodAllowanceImpForEarned = parseNum(payroll.FoodAllowance ?? payroll.foodAllowance) ?? 0;
            const washingAllowanceImpForEarned = parseNum(payroll.WashingAllowance ?? payroll.washingAllowance) ?? 0;
            // Earned Gross Salary = Travel Charges + OT Amount + Incentive + Attendance Bonus + Washing Allowance + Food Allowance + Earned Basic + Earned HRA + Earned Special Allowance
            const earnedSalaryCross = (travelChargersForTotal || 0) + (otAmountImported || 0) + (incentiveImported || 0) + (attendanceBonusImported || 0) + (washingAllowanceImpForEarned || 0) + (foodAllowanceImpForEarned || 0) + (earnedBasicImported || 0) + (earnedHRAImported || 0) + (earnedSpecialAllowanceImported || 0);
            // ESI: if status is 'yes' calculate regardless; if 'no' not applicable; else use period rules (Apr-Sep / Oct-Mar)
            let isEsiApplicable;
            if (esiStatus === 'no') {
              isEsiApplicable = false;
            } else if (esiStatus === 'yes') {
              isEsiApplicable = true;
            } else {
              isEsiApplicable = await checkESIPeriodEligibility(catalystApp, month, empCodeStr, actualTotalSalary);
            }
            // ESI: from Setup formula when defined, else default (Earned Basic + OT Amount + Incentive) * 0.75%. When sum is 0 or less, ESI = 0.
            const esiBaseImported = earnedSalaryCross;
            const actualBasicImp = getPayrollNum(payroll, 'ActualBasic', 'actualBasic');
            const actualHRAImp = getPayrollNum(payroll, 'ActualHRA', 'actualHRA');
            const foodAllowanceImp = getPayrollNum(payroll, 'FoodAllowance', 'foodAllowance');
            const travelChargersForEsi = parseNum(payroll.TravelChargers ?? payroll.travelChargers) ?? travelChargersMap[empCodeStr] ?? travelChargersMap[normalizeEmployeeCode(empCodeStr)] ?? travelChargersMap[String(parseInt(empCodeStr))] ?? 0;
            let esiImported = 0;
            let employerEsiImported = 0;
            if (isEsiApplicable) {
              const esiFormulaImport = Array.isArray(importFormulae) && importFormulae.find((f) => {
                const v = String(f.variable).trim().toLowerCase();
                return v === 'esi 0.75%' || v === 'esi';
              });
              if (esiFormulaImport && esiFormulaImport.expression) {
                const actualDAImp = parseNum(payroll.ActualDA) || 0;
                const esiContextImport = {
                  'Earned Gross Salary': earnedSalaryCross,
                  'Earned Basic': earnedBasicImported,
                  'Earned HRA': earnedHRAImported,
                  'Earned Special Allowance': earnedSpecialAllowanceImported,
                  'Actual Basic': actualBasicImp,
                  'Actual HRA': actualHRAImp,
                  'Actual DA': actualDAImp,
                  'Special Allowance': specialAllowanceImported,
                  'OT Hours': totalOvertimeHours,
                  'OT Amount': otAmountImported,
                  'Travel Charges': travelChargersForEsi,
                  'TravelChargers': travelChargersForEsi,
                  'Attendance Bonus': attendanceBonusImported,
                  'Food Allowance': foodAllowanceImp,
                  'Food Allownace': foodAllowanceImp,
                  'Days Present': actualDaysPresent,
                  'Days In Month': importDaysInMonth,
                  'LOH': importLOH,
                  'Incentive': incentiveImported
                };
                const esiFromFormulaImport = evaluateFormulaExpression(esiFormulaImport.expression, esiContextImport);
                esiImported = Number.isFinite(esiFromFormulaImport) ? Math.max(0, Math.ceil(esiFromFormulaImport)) : 0;
                if (esiImported > 0) employerEsiImported = esiBaseImported * 0.0325;
              } else {
                const esiBaseComponentsImp = earnedBasicImported + otAmountImported + incentiveImported;
                if (esiBaseComponentsImp <= 0) {
                  esiImported = 0;
                } else {
                  esiImported = Math.round(esiBaseComponentsImp * 0.0075);
                  if (esiImported > 0) employerEsiImported = esiBaseImported * 0.0325;
                }
              }
            }
            if (contractorNameImportedLower === 'yashaswi academy for skills') {
              pfImported = 0;
              esiImported = 0;
              employerEsiImported = 0;
            }
            const employerLwfImported = (month && month.endsWith('-12')) ? 40 : 0; // Employer LWF contribution (40 for December)
            const otherDeductionImported = parseNum(payroll.OtherDeduction) || 0;
            // Determine LWF/PT values for imported record. For December, enforce static LWF = 20
            const lwfImportedValue = (month && month.endsWith('-12')) ? 20 : (parseNum(payroll.LWF) || 0);
            const ptImportedRaw = payroll.PT;
            let ptImportedValue = parseNum(payroll.PT) || 0;
            // Always recalculate PT based on new salary slabs (ignore saved values). If contractor is Yashaswi Academy for Skills, PT = 0.
            // Divided by 6 for month-wise calculation (6 months data)
            if (contractorNameImportedLower === 'yashaswi academy for skills') {
              ptImportedValue = 0;
            } else if (earnedSalaryCross >= 20001/6 && earnedSalaryCross <= 30000/6) {
              ptImportedValue = 172/6;
            } else if (earnedSalaryCross >= 30001/6 && earnedSalaryCross <= 45000/6) {
              ptImportedValue = 430/6;
            } else if (earnedSalaryCross >= 45001/6 && earnedSalaryCross <= 60000/6) {
              ptImportedValue = 856/6;
            } else if (earnedSalaryCross >= 60001/6 && earnedSalaryCross <= 75000/6) {
              ptImportedValue = 1250/6;
            } else if (earnedSalaryCross >= 75001/6) {
              ptImportedValue = 1250/6;
            } else {
              ptImportedValue = 0;
            }
            // Total Deduction = PF + ESI + Other Deduction + LWF + PT + Rent Recovery (for Yashaswi, PF/ESI/PT are 0)
            const totalDeduction = pfImported + esiImported + otherDeductionImported + lwfImportedValue + ptImportedValue + rentAmount;
            // Calculate OT ESI for imported data (use OT Amount)
            // OT ESI = OT Amount * 0.75% (only if ESI is applicable)
            const otEsiImported = isEsiApplicable ? Math.ceil(otAmountImported * 0.0075) : 0;
            // Calculate Payable Amount for imported data
            // Payable Amount = OT Payment - OT ESI
            const payableAmountImported = otPaymentImported - otEsiImported;
            // Net Pay: Total Deduction includes Rent Recovery; subtract advance after Total Deduction
            const recalculatedNetPay = earnedSalaryCross - totalDeduction - advanceAmount; // Net Pay = Earned Gross - Total Deduction - Advance (rent already in totalDeduction)
            // Calculate Total Net Payable for imported data
            // Total Net Payable = Net Pay + Payable Amount
            const totalNetPayableImported = recalculatedNetPay + payableAmountImported;
       
            // Compute ERPF 12% + Admin 0.5% + EDLI 0.5% before service charge (service charge base includes ERPF 12% + Admin 0.5% + EDLI 0.5% + Employer ESI + Employer LWF)
            const adminImported = contractorNameImportedLower === 'yashaswi academy for skills' ? 0 : (isPfApplicable ? Math.round(pfWagesImported * 0.005) : 0); // Admin 0.5%
            const edliImported = contractorNameImportedLower === 'yashaswi academy for skills' ? 0 : (isPfApplicable ? (Math.round(pfWagesImported) === 15000 ? 75 : Math.round(pfWagesImported * 0.005)) : 0); // EDLI 0.5%
            const erpf12PlusAdminPlusEdliImported = contractorNameImportedLower === 'yashaswi academy for skills' ? 0 : (isPfApplicable ? (Math.round(pfImported) + adminImported + edliImported) : 0); // ERPF 12% + Admin 0.5% + EDLI 0.5%
            // Special cases for service charge calculation:
            // - "Yashaswi Academy for Skills" or "Yashaswi Academy For Skills" (case-insensitive) = 1000 fixed
            // - "sriram enterprice"/"sriram enterprise"/"sriram enterprises" (case-insensitive) = 8%
            // - All others = 9%
            // Service charge base = baseEarnedGross + ERPF 12% + Admin 0.5% + EDLI 0.5% + Employer ESI 3.25% + Employer LWF (do not include ESI Contribution)
            const serviceChargeBaseImported = Math.max(0, baseEarnedGrossImported + erpf12PlusAdminPlusEdliImported + employerEsiImported + employerLwfImported);
            let serviceChargeImported;
            if (contractorNameImportedLower === 'yashaswi academy for skills') {
              serviceChargeImported = 1000; // Fixed 1000 for Yashaswi Academy for Skills (both "for" and "For" variations)
            } else if (contractorNameImportedLower === 'sriram enterprice' || contractorNameImportedLower === 'sriram enterprise' || contractorNameImportedLower === 'sriram enterprises') {
              serviceChargeImported = Math.round(serviceChargeBaseImported * 0.08); // 8% for Sriram Enterprise/Enterprises
            } else {
              serviceChargeImported = Math.round(serviceChargeBaseImported * 0.09); // 9% for all others (on base + ERPF 12% + Admin 0.5% + EDLI 0.5% + Employer ESI + Employer LWF)
            }
            const esiContributionImported = Number(payroll.ESIContribution ?? payroll.esiContribution) || 0;
            const totalImported = Math.round(earnedSalaryCross) + erpf12PlusAdminPlusEdliImported + serviceChargeImported + Math.round(employerEsiImported) + Math.round(employerLwfImported) + Math.round(esiContributionImported); // Total = Earned Gross + ERPF 12% + Admin 0.5% + EDLI 0.5% + Service Charge + ... + ESI Contribution
            // Special case: If contractor is "Yashaswi Academy for Skills" or "Yashaswi Academy For Skills" (case-insensitive), GST = 0, otherwise calculate 18%
            const gstImported = contractorNameImportedLower === 'yashaswi academy for skills' ? 0 : Math.round(totalImported * 0.18);
            const netTotalImported = totalImported + gstImported;
         
            // Get DateofJoining from Employee table (reuse empCodeStr declared above)
            const dateOfJoining = dateOfJoiningMap[empCodeStr] ?? dateOfJoiningMap[normalizeEmployeeCode(empCodeStr)] ?? dateOfJoiningMap[String(parseInt(empCodeStr))] ?? '';
            const designationImported =
              designationMap[empCodeStr] ??
              designationMap[normalizeEmployeeCode(empCodeStr)] ??
              designationMap[String(parseInt(empCodeStr))] ??
              '';
            const unitImported =
              unitMap[empCodeStr] ??
              unitMap[normalizeEmployeeCode(empCodeStr)] ??
              (/^\d+$/.test(empCodeStr) ? unitMap[String(parseInt(empCodeStr))] : undefined) ??
              String(payroll.Unit ?? payroll.unit ?? '').trim();
            const travelChargersImported = parseNum(payroll.TravelChargers ?? payroll.travelChargers) ?? travelChargersMap[empCodeStr] ?? travelChargersMap[normalizeEmployeeCode(empCodeStr)] ?? travelChargersMap[String(parseInt(empCodeStr))] ?? 0;
            // Prefer Payroll values; fall back to Employee master (saved payroll often has blank name/dept)
            const employeeNameImported =
              String(payroll.EmployeeName ?? payroll.employeeName ?? '').trim() ||
              pickEmployeeKeyedMapValue(employeeNameMap, empCodeStr) ||
              '';
            const departmentImported =
              String(payroll.Department ?? payroll.department ?? '').trim() ||
              pickEmployeeKeyedMapValue(departmentMap, empCodeStr) ||
              '';
         
            const importedRow = {
              employeeCode: String(payroll.EmployeeCode || ''),
              employeeName: employeeNameImported,
              designation: designationImported,
              unit: unitImported,
              department: departmentImported,
              category: (() => {
                const fromPayroll = String(payroll.Category ?? payroll.category ?? '').trim();
                if (fromPayroll) return fromPayroll;
                const ec = String(payroll.EmployeeCode || '');
                return (
                  categoryMap[ec] ??
                  categoryMap[normalizeEmployeeCode(ec)] ??
                  (/^\d+$/.test(ec) ? categoryMap[String(parseInt(ec))] : undefined) ??
                  ''
                );
              })(),
              contractor: String(payroll.Contractor || ''),
              dateOfJoining: dateOfJoining,
              daysInMonth: parseNum(payroll.DaysInMonth),
              daysPresent: actualDaysPresent, // Preserved imported value or attendance data
              otHours: totalOvertimeHours || 0, // OT hours: use saved value or fetch from attendance_muster_function
              loh: importLOH, // Preserved imported value or auto-fetched
              revisedLOH: resolveRevisedLohForEmployee(
                payroll.EmployeeCode,
                importLOH,
                latestSavedRevisedLOHByEmp
              ),
              actualBasic: importActualBasic,
              actualHRA: importActualHRA,
              actualDA: importActualDA,
              otherAllowance: importAttendanceAllowance,
              travelChargers: travelChargersImported,
              specialAllowance: importSpecialAllowance,
              incentive: parseNum(payroll.Incentive),
              foodAllowance: parseNum(payroll.FoodAllowance ?? payroll.foodAllowance) ?? 0,
              uniformAllowance: 0,
              washingAllowance: parseNum(payroll.WashingAllowance ?? payroll.washingAllowance) ?? 0,
              attendanceBonus: attendanceBonusImported,
              loanAllowance: parseNum(payroll.LoanAllowance),
              noOfDaysWithoutUniforms: parseNum(payroll.NoOfDaysWithoutUniforms),
              otherAllowances: otherAllowancesImported,
              actualTotalSalary: actualTotalSalary,
              earnedBasic: Math.round(earnedBasicImported),
              earnedHRA: Math.round(earnedHRAImported),
              earnedDA: Math.round(earnedDAImported),
              earnedSpecialAllowance: Math.round(earnedSpecialAllowanceImported),
              earnedAttendanceAllowance: earnedAttendanceAllowanceImported,
              earnedOtherAllowances: Math.round(earnedOtherAllowancesImported),
              arrear: parseNum(payroll.Arrear),
              arrearForPF: parseNum(payroll.ArrearForPF) || 0,
              // Always calculate LOP from attendance: LOP = no. of days in month - no. of days present
              // This avoids stale saved values (e.g., default 31) and ensures consistency with attendance
              // Ensure LOP is never negative (minimum 0)
              lop: (() => {
                const calculatedLOP = Math.max(0, importDaysInMonth - actualDaysPresent);
                const lopOut = lopDaysValue(calculatedLOP);
                console.log(`Imported payroll - Employee ${payroll.EmployeeCode}: Calculating LOP: ${importDaysInMonth} - ${actualDaysPresent} = ${lopOut}`);
                return lopOut;
              })(),
              earnedSalaryCross: Math.round(earnedSalaryCross),
              pf: Math.round(pfImported),
              esi: Math.round(esiImported),
              employerEsi: Math.round(employerEsiImported), // Employer ESI = Earned Cross Salary × 3.25% (only if ESI applicable)
              esiContribution: Number(payroll.ESIContribution ?? payroll.esiContribution) || 0,
              employerLwf: Math.round(employerLwfImported), // Employer LWF contribution
              totalDeduction: Math.round(totalDeduction),
              netpay: recalculatedNetPay,
              otAmount: Math.round(otAmountImported),
              otArrearAmount: Math.round(otArrearAmountImported),
              otEsi: Math.round(otEsiImported), // Use calculated OT ESI
              otPayment: Math.round(otPaymentImported), // Use calculated OT Payment
              payableAmount: Math.round(payableAmountImported), // Use calculated Payable Amount
              otWages: calculatedOTWages, // Use calculated OT wages
              rent: parseNum(payroll.Rent),
              advance: parseNum(payroll.Advance),
              otherDeduction: parseNum(payroll.OtherDeduction),
              lwf: lwfImportedValue,
              pt: ptImportedValue,
             
              netPay: recalculatedNetPay, // Use recalculated Net Pay
              totalNetPayable: Math.round(totalNetPayableImported),
              erpf: Math.round(pfImported), // ERPF = PF (0 for Yashaswi)
              admin: Math.round(adminImported), // Admin 0.5% (0 for Yashaswi)
              edli: Math.round(edliImported), // EDLI 0.5% (0 for Yashaswi)
              erpf13: erpf12PlusAdminPlusEdliImported, // ERPF 12% + Admin 0.5% + EDLI 0.5% (kept for backend/DB compatibility)
              // Special case: If contractor is "Yashaswi Academy For Skills", set service charge to 1000 fixed
              serviceCharge: serviceChargeImported, // Service Charge = 1000 fixed for Yashaswi Academy For Skills, 8% for Sriram Enterprise, 9% for others
              total: totalImported, // Total = Earned Gross Salary + ERPF 13% + Service Charge + Employer ESI 3.25%
              gst: gstImported, // GST = Total * 18%
              netTotal: netTotalImported, // Net Total = Total + GST
              bonus: parseNum(payroll.Bonus),
              bankHolderName: String(payroll.BankHolderName || ''),
              bankName: String(payroll.BankName || ''),
              ifscCode: String(payroll.IFSCCode || ''),
              bankBranch: String(payroll.BankBranch || ''),
              uanNo: String(
                uanNoMap[empCodeStr] ??
                uanNoMap[normalizeEmployeeCode(empCodeStr)] ??
                uanNoMap[String(parseInt(empCodeStr))] ??
                payroll.UANNo ??
                payroll.uanNo ??
                ''
              ),
              esicNo: String(
                esicNoMap[empCodeStr] ??
                esicNoMap[normalizeEmployeeCode(empCodeStr)] ??
                esicNoMap[String(parseInt(empCodeStr))] ??
                payroll.ESICNo ??
                payroll.esicNo ??
                ''
              ),
              pfStatus: pfStatus || '',
              esiStatus: esiStatus || '',
              employeeStatus: (employeeStatusMap[empCodeStr] || employeeStatusMap[normalizeEmployeeCode(empCodeStr)] || (/^\d+$/.test(empCodeStr) ? employeeStatusMap[String(parseInt(empCodeStr))] : '') || '').trim()
            };
            mergeSavedPayrollCustomColumnsIntoResultRow(importedRow, payroll);
            const impEc = String(payroll.EmployeeCode || '').trim();
            const impNorm = normalizeEmployeeCode(impEc);
            const impNum = parseInt(impEc, 10);
            const rawSamImp =
              latestSamplePayrollRawByNormalizedCodeApi.get(impNorm) ||
              latestSamplePayrollRawByNormalizedCodeApi.get(impEc) ||
              latestSamplePayrollRawByNormalizedCodeApi.get(String(payroll.EmployeeCode || '').trim()) ||
              (!Number.isNaN(impNum) ? latestSamplePayrollRawByNormalizedCodeApi.get(String(impNum)) : undefined);
            mergeRunPayrollCustomFillGaps(importedRow, rawSamImp);
            const rawRunImp =
              latestRunPayrollRawByNormalizedCodeApi.get(impNorm) ||
              latestRunPayrollRawByNormalizedCodeApi.get(impEc) ||
              latestRunPayrollRawByNormalizedCodeApi.get(String(payroll.EmployeeCode || '').trim()) ||
              (!Number.isNaN(impNum) ? latestRunPayrollRawByNormalizedCodeApi.get(String(impNum)) : undefined);
            mergeRunPayrollCustomFillGaps(importedRow, rawRunImp);
            applyRevisedLohToPayrollRow(importedRow);
            const statutoryIds = lookupEmployeeStatutoryMaps({ uanNoMap, esicNoMap }, empCodeStr);
            applyEmployeeStatutoryIdsToPayrollRow(importedRow, {
              UANNo: statutoryIds.uan,
              ESICNo: statutoryIds.esic,
            });
            importedPayrollData.push(importedRow);
          }
        } else {
          console.log('⚠️ No imported payroll data found after filtering, will use calculated data for all employees');
        }
      } catch (payrollErr) {
        console.error('❌ ERROR loading imported payroll data:', payrollErr.message);
        console.error('Error stack:', payrollErr.stack);
        console.log('Will use calculated data for all employees');
        // If Payroll table doesn't exist, we'll use calculated data
        importedPayrollData = [];
        importedEmployeeCodeSet = new Set();
      }
     
      // Log final imported data status
      console.log(`=== IMPORTED DATA SUMMARY ===`);
      console.log(`Imported payroll records: ${importedPayrollData.length}`);
      console.log(`Employees with imported data: ${importedEmployeeCodeSet.size}`);
      if (importedEmployeeCodeSet.size > 0) {
        const sampleCodes = Array.from(importedEmployeeCodeSet).slice(0, 10);
        console.log(`Sample employee codes with imported data: ${sampleCodes.join(', ')}`);
      }

      // Calculate payroll data for each employee
      const result = [];
      const [yearNum2, monthNum2] = month.split('-').map(Number);
      const daysInMonth = getDaysInMonthExcludingSundays(yearNum2, monthNum2);

      // IMPORTANT: Imported payroll data takes priority - add it FIRST to result
      // This ensures imported data is never overwritten by calculated data
      if (importedPayrollData.length > 0) {
        console.log(`✅ INCLUDING IMPORTED PAYROLL DATA FIRST: ${importedPayrollData.length} records`);
        console.log(`   These records will NOT be recalculated - imported data is preserved`);
        result.push(...importedPayrollData);
        console.log(`   Result array now has ${result.length} records (${importedPayrollData.length} imported + calculated)`);
      } else {
        console.log('⚠️ No imported payroll data found - will calculate for all employees');
      }

      // Process all employees from Employee table, but skip those already present in imported data
      console.log('=== PROCESSING EMPLOYEES FOR CALCULATED DATA ===');
      console.log('Total employees from Employee table:', empRecords.length);
      console.log('Total attendance records:', attendanceData.length);
      console.log('Contractor filter:', contractor, '(is "All":', contractor === 'All' || !contractor, ')');
      console.log('Employee IDs from Employee table (first 20):', empRecords.slice(0, 20).map(row => ({
        code: row.Employee.EmployeeCode,
        codeType: typeof row.Employee.EmployeeCode,
        name: row.Employee.EmployeeName,
        contractor: row.Employee.ContractorName
      })));
      console.log('Employee IDs from attendance data (first 20):', attendanceData.slice(0, 20).map(att => ({
        employeeId: att.employeeId,
        idType: typeof att.employeeId,
        daysPresent: att.totalDaysPresent
      })));
 
      // Check for potential matching issues
      if (attendanceData.length > 0 && empRecords.length > 0) {
        const empCodes = new Set(empRecords.map(row => String(row.Employee.EmployeeCode)));
        const attIds = new Set(attendanceData.map(att => String(att.employeeId)));
        const intersection = [...empCodes].filter(code => attIds.has(code));
        console.log(`Matching analysis: ${empCodes.size} unique employee codes, ${attIds.size} unique attendance IDs, ${intersection.length} matches`);
        if (intersection.length < Math.min(empCodes.size, attIds.size) * 0.5) {
          console.warn('⚠️ LOW MATCH RATE - Employee codes and attendance IDs may not match!');
          console.log('Sample employee codes:', Array.from(empCodes).slice(0, 10));
          console.log('Sample attendance IDs:', Array.from(attIds).slice(0, 10));
        }
      }
      console.log('Employee IDs from imported payroll data:', Array.from(importedEmployeeCodeSet));
     
      // Prefetch saved OT Hours, Attendance Allowance, and Actual Attendance Allowance (OtherAllowance) from Payroll table
      const savedOTHoursMapAll = {}; // Map: employeeCode -> saved OT Hours value
      const savedAttendanceAllowanceMapAll = {}; // Map: employeeCode -> saved Earned Attendance Allowance value
      const savedActualAttendanceAllowanceMapAll = {}; // Map: employeeCode -> saved Actual Attendance Allowance (Payroll.OtherAllowance); when absent, payroll uses Employee.AttendanceAllowance column
      try {
        const allEmpCodes = empRecords.map(r => String(r.Employee?.EmployeeCode || '').trim()).filter(Boolean);
        if (allEmpCodes.length > 0) {
          const empCodesList = allEmpCodes.map(code => `'${code.replace(/'/g, "''")}'`).join(',');
          const monthEscaped = String(month || '').replace(/'/g, "''");
          const savedDataQuery = `SELECT ROWID, EmployeeCode, OTHours, OtherAllowance, AttendanceAllowance FROM Payroll WHERE Month_filter = '${monthEscaped}' AND EmployeeCode IN (${empCodesList}) ORDER BY ROWID DESC`;
          const savedDataRows = await catalystApp.zcql().executeZCQLQuery(savedDataQuery);
          const latestSavedSeen = new Set();
          for (const r of savedDataRows) {
            const p = r.Payroll;
            const code = String(p.EmployeeCode || '').trim();
            if (!code) continue;
            const normCode = normalizeEmployeeCode(code);
            // ROWID DESC query: first row per employee is the latest saved row.
            if (latestSavedSeen.has(normCode)) continue;
            latestSavedSeen.add(normCode);
            // Check if OTHours exists in saved record (even if 0, it means user has set it)
            if (p.OTHours !== null && p.OTHours !== undefined && String(p.OTHours).trim() !== '') {
              const savedOTHours = parseFloat(p.OTHours) || 0;
              if (!isNaN(savedOTHours)) {
                savedOTHoursMapAll[code] = parseFloat(savedOTHours.toFixed(3));
                savedOTHoursMapAll[normCode] = parseFloat(savedOTHours.toFixed(3));
              }
            }
            // Actual Attendance Allowance (Payroll.OtherAllowance) - when saved in Payroll, use it; else payroll uses Employee.AttendanceAllowance column
            if (p.OtherAllowance !== null && p.OtherAllowance !== undefined && String(p.OtherAllowance).trim() !== '') {
              const savedActualAA = parseFloat(p.OtherAllowance) || 0;
              if (!isNaN(savedActualAA)) {
                savedActualAttendanceAllowanceMapAll[code] = parseFloat(savedActualAA.toFixed(2));
                savedActualAttendanceAllowanceMapAll[normCode] = parseFloat(savedActualAA.toFixed(2));
              }
            }
            // Check if AttendanceAllowance exists in saved record (even if 0, it means user has set it)
            if (p.AttendanceAllowance !== null && p.AttendanceAllowance !== undefined && String(p.AttendanceAllowance).trim() !== '') {
              const savedAttendanceAllowance = parseFloat(p.AttendanceAllowance) || 0;
              if (!isNaN(savedAttendanceAllowance)) {
                savedAttendanceAllowanceMapAll[code] = parseFloat(savedAttendanceAllowance.toFixed(2));
                savedAttendanceAllowanceMapAll[normCode] = parseFloat(savedAttendanceAllowance.toFixed(2));
              }
            }
          }
          if (Object.keys(savedOTHoursMapAll).length > 0) {
            console.log(`Prefetched saved OT Hours values for ${Object.keys(savedOTHoursMapAll).length} employees`);
            // Check for employee 33021 specifically
            if (savedOTHoursMapAll['33021'] !== undefined || savedOTHoursMapAll[33021] !== undefined) {
              const savedVal = savedOTHoursMapAll['33021'] || savedOTHoursMapAll[33021];
              console.log(`⚠️ Employee 33021 has SAVED OT Hours value: ${savedVal} (this will be overridden by fetched value if available)`);
            }
          }
          if (Object.keys(savedAttendanceAllowanceMapAll).length > 0) {
            console.log(`Prefetched saved Attendance Allowance values for ${Object.keys(savedAttendanceAllowanceMapAll).length} employees`);
          }
        }
      } catch (savedDataErr) {
        console.log('Error prefetching saved OT Hours/Attendance Allowance from Payroll table, defaulting to 0:', savedDataErr.message);
      }

      // Batch fetch all detection data at once (rent and advance) to avoid per-employee queries
      const detectionDataMap = {}; // Key: EmployeeCode -> { rentAmount, advanceAmount }
      let detectionTableExists = false;
      try {
        console.log('=== BATCH FETCHING DETECTION DATA ===');
        const detectionQuery = `SELECT EmployeeCode, Rent, Advance FROM Detection WHERE Month_filter = '${month}'`;
        const detectionRecords = await catalystApp.zcql().executeZCQLQuery(detectionQuery);
        detectionTableExists = true;
        console.log(`Found ${detectionRecords.length} detection records for month ${month}`);
       
        // Build map for quick lookups
        detectionRecords.forEach(row => {
          const detection = row.Detection;
          const empCode = String(detection.EmployeeCode || '').trim();
          if (empCode) {
            detectionDataMap[empCode] = {
              rentAmount: parseFloat(detection.Rent) || 0,
              advanceAmount: parseFloat(detection.Advance) || 0
            };
          }
        });
        console.log(`Built detection data map for ${Object.keys(detectionDataMap).length} employees`);
      } catch (detectionErr) {
        // Detection table doesn't exist - this is normal, skip detection data
        console.log('Detection table does not exist or no data found - skipping detection data:', detectionErr.message);
        detectionTableExists = false;
      }
     
      let processedCount = 0;
      let skippedCount = 0;
      let withAttendanceCount = 0;
      let withoutAttendanceCount = 0;

      const detailFormulae = await getPayrollFormulae(catalystApp);

      for (const row of empRecords) {
        const emp = row.Employee;
        const empId = emp.EmployeeCode;
        const empIdStr = String(empId || '').trim();
        const empContractor = emp.ContractorName;
        // Try both uppercase and lowercase field names (Catalyst/Zoho may return either)
        const empStatus = emp.EmployeeStatus || emp.employeeStatus || '';
       
        // Debug logging for employee 33021
        if (empId === '33021' || empId === 33021 || String(empId).trim() === '33021') {
          console.log(`🔍🔍🔍 PROCESSING Employee 33021 in main loop`);
          console.log(`   empId type: ${typeof empId}, value: "${empId}"`);
          console.log(`   otHoursMap available: ${otHoursMap && typeof otHoursMap === 'object'}`);
          console.log(`   otHoursMap size: ${otHoursMap ? Object.keys(otHoursMap).length : 0}`);
          console.log(`   otHoursMap['33021']: ${otHoursMap ? otHoursMap['33021'] : 'N/A'}`);
          console.log(`   otHoursMap[33021]: ${otHoursMap ? otHoursMap[33021] : 'N/A'}`);
        }
     
        // Debug: Log employeeStatus for first few employees
        if (processedCount < 5) {
          console.log(`Employee ${empId} (${emp.EmployeeName}): EmployeeStatus = "${empStatus}" (from EmployeeStatus: "${emp.EmployeeStatus}", employeeStatus: "${emp.employeeStatus}")`);
        }
   
        // Skip if this employee already has an imported payroll row
        // IMPORTANT: Imported data takes priority - never recalculate for these employees
        if (importedEmployeeCodeSet.has(String(empId))) {
          skippedCount++;
          if (skippedCount <= 5) {
            console.log(`⏭️ Skipping employee ${empId} - has imported payroll data (will use imported data, not recalculate)`);
          }
          continue;
        }
   
        // If contractor filter is set, skip employees that don't match
        if (contractor && contractor !== 'All') {
          const empContractor = normalizeName(emp.ContractorName);
          const expected = normalizeName(contractor);
          if (empContractor !== expected) {
            skippedCount++;
            continue;
          }
        }
     
        // If employeeStatus filter is set, skip employees that don't match (case-insensitive)
        if (employeeStatus && employeeStatus !== 'All') {
          const empStatus = String(emp.EmployeeStatus || emp.employeeStatus || '').trim();
          if (empStatus.toLowerCase() !== employeeStatus.toLowerCase()) {
            skippedCount++;
            continue;
          }
        }
   
        // If department filter is set, skip employees that don't match
        if (department && department !== 'All') {
          if (emp.Department !== department) {
            skippedCount++;
            continue;
          }
        }
   
        // If employee filter is set, skip employees that don't match
        if (employeeId && employeeId !== 'All') {
          if (emp.EmployeeCode !== employeeId) {
            skippedCount++;
            continue;
          }
        }
   
        processedCount++;

        // Check if this employee has attendance data from Attendance table
        let daysPresent = 0;
        // Initialize OT Hours to 0 by default - will be updated if saved value exists
        let totalOvertimeHours = 0;
   
        // Find attendance data for this employee - try multiple matching strategies
        // IMPORTANT: Try all matching strategies to handle different data types
        // MUSTER DATA IS AUTHORITATIVE - check muster map first
        let employeeAttendance = null;
        let daysPresentFromMuster = null;
     
        // First, check muster map directly (muster is authoritative)
        if (Object.keys(musterPresentDaysMap).length > 0) {
          // Try direct match
          if (musterPresentDaysMap[empId] !== undefined) {
            daysPresentFromMuster = musterPresentDaysMap[empId];
            console.log(`Employee ${empId}: Found in muster map (direct): ${daysPresentFromMuster} days`);
          } else {
            // Try string match
            const empIdStr = String(empId).trim();
            if (musterPresentDaysMap[empIdStr] !== undefined) {
              daysPresentFromMuster = musterPresentDaysMap[empIdStr];
              console.log(`Employee ${empId}: Found in muster map (string): ${daysPresentFromMuster} days`);
            } else {
              // Try number match
              const empIdNum = parseInt(empId);
              if (!isNaN(empIdNum)) {
                if (musterPresentDaysMap[String(empIdNum)] !== undefined) {
                  daysPresentFromMuster = musterPresentDaysMap[String(empIdNum)];
                  console.log(`Employee ${empId}: Found in muster map (number): ${daysPresentFromMuster} days`);
                } else {
                  // Try all keys for fuzzy matching
                  for (const musterKey in musterPresentDaysMap) {
                    const musterKeyStr = String(musterKey).trim();
                    const musterKeyNum = parseInt(musterKeyStr);
                    if (musterKeyStr === empIdStr || musterKeyStr === String(empId)) {
                      daysPresentFromMuster = musterPresentDaysMap[musterKey];
                      console.log(`Employee ${empId}: Found in muster map (fuzzy string): ${daysPresentFromMuster} days`);
                      break;
                    }
                    if (!isNaN(musterKeyNum) && !isNaN(empIdNum) && musterKeyNum === empIdNum) {
                      daysPresentFromMuster = musterPresentDaysMap[musterKey];
                      console.log(`Employee ${empId}: Found in muster map (fuzzy number): ${daysPresentFromMuster} days`);
                      break;
                    }
                  }
                }
              }
            }
          }
        }
   
        // Strategy 1: Direct match
        employeeAttendance = attendanceData.find(att => att.employeeId === empId);
   
        // Strategy 2: String conversion match
        if (!employeeAttendance) {
          employeeAttendance = attendanceData.find(att => String(att.employeeId) === String(empId));
        }
   
        // Strategy 3: Number conversion match
        if (!employeeAttendance) {
          const empIdNum = parseInt(empId);
          if (!isNaN(empIdNum)) {
            employeeAttendance = attendanceData.find(att => {
              const attIdNum = parseInt(att.employeeId);
              return !isNaN(attIdNum) && attIdNum === empIdNum;
            });
          }
        }
   
        // Strategy 4: Case-insensitive string match
        if (!employeeAttendance) {
          employeeAttendance = attendanceData.find(att =>
            String(att.employeeId).toLowerCase().trim() === String(empId).toLowerCase().trim()
          );
        }
   
        // Strategy 5: Partial match (if one contains the other)
        if (!employeeAttendance) {
          const empIdStr = String(empId).trim();
          employeeAttendance = attendanceData.find(att => {
            const attIdStr = String(att.employeeId).trim();
            return attIdStr === empIdStr ||
                   attIdStr.includes(empIdStr) ||
                   empIdStr.includes(attIdStr);
          });
        }
   
        // Use muster data if available (muster is authoritative), otherwise use attendance data
        if (daysPresentFromMuster !== null && daysPresentFromMuster !== undefined) {
          daysPresent = daysPresentFromMuster;
          withAttendanceCount++;
          if (processedCount <= 5 || (contractor === 'All' || !contractor)) {
            console.log(`✓ Using muster data for employee ${empId} (${empContractor}): ${daysPresent} days present (MUSTER AUTHORITATIVE)`);
          }
        } else if (employeeAttendance) {
          daysPresent = employeeAttendance.totalDaysPresent || 0;
          withAttendanceCount++;
          if (processedCount <= 5 || (contractor === 'All' || !contractor)) {
            console.log(`✓ Found attendance data for employee ${empId} (${empContractor}): ${daysPresent} days present`);
            console.log(`  Matched attendance employeeId: ${employeeAttendance.employeeId} (type: ${typeof employeeAttendance.employeeId})`);
            console.log(`  Attendance totalDaysPresent: ${employeeAttendance.totalDaysPresent}, type: ${typeof employeeAttendance.totalDaysPresent}`);
          }
          // ALWAYS use fetched OT Hours from attendance_muster_function if available
          // EXCEPTION: For January, only use real-time data (not saved data)
          // For December, always use saved data to preserve existing data
          // Only use saved values if fetched value is not available (and not January)
          const empIdStr = String(empId).trim();
          const empIdNum = parseInt(empId);
         
          // Check if this is January (month format: YYYY-01) - skip saved data for January
          const isJanuary = month && month.endsWith('-01');
          const isDecember = month && month.endsWith('-12');
         
          // Check if there's a fetched value from attendance_muster_function - try all possible key formats
          let fetchedOTValue = null;
          let foundKey = null;
         
          // Try direct matches first
          if (otHoursMap[empId] !== undefined) {
            fetchedOTValue = otHoursMap[empId];
            foundKey = empId;
          } else if (otHoursMap[empIdStr] !== undefined) {
            fetchedOTValue = otHoursMap[empIdStr];
            foundKey = empIdStr;
          } else if (!isNaN(empIdNum)) {
            if (otHoursMap[String(empIdNum)] !== undefined) {
              fetchedOTValue = otHoursMap[String(empIdNum)];
              foundKey = String(empIdNum);
            } else if (otHoursMap[empIdNum] !== undefined) {
              fetchedOTValue = otHoursMap[empIdNum];
              foundKey = empIdNum;
            }
          }
         
          // If not found, try fuzzy matching
          if (fetchedOTValue === null && Object.keys(otHoursMap).length > 0) {
            for (const otKey in otHoursMap) {
              const otKeyStr = String(otKey).trim();
              const otKeyNum = parseInt(otKeyStr);
              if (otKeyStr === empIdStr || otKeyStr === String(empId)) {
                fetchedOTValue = otHoursMap[otKey];
                foundKey = otKey;
                break;
              }
              if (!isNaN(empIdNum) && !isNaN(otKeyNum) && otKeyNum === empIdNum) {
                fetchedOTValue = otHoursMap[otKey];
                foundKey = otKey;
                break;
              }
            }
          }
         
          // Debug logging for employee 33021
          if (empId === '33021' || empId === 33021 || empIdStr === '33021') {
            console.log(`🔍 DEBUG Employee 33021 OT Hours Logic:`);
            console.log(`   fetchedOTValue: ${fetchedOTValue} (type: ${typeof fetchedOTValue}, is null: ${fetchedOTValue === null})`);
            console.log(`   foundKey: "${foundKey}"`);
            console.log(`   otHoursMap['33021']: ${otHoursMap['33021']}`);
            console.log(`   otHoursMap[33021]: ${otHoursMap[33021]}`);
            console.log(`   savedOTHoursMapAll['33021']: ${savedOTHoursMapAll['33021']}`);
            console.log(`   savedOTHoursMapAll[33021]: ${savedOTHoursMapAll[33021]}`);
            console.log(`   savedOTHoursMapAll[empId]: ${savedOTHoursMapAll[empId]}`);
            console.log(`   savedOTHoursMapAll[empIdStr]: ${savedOTHoursMapAll[empIdStr]}`);
          }
         
          // In automatic mode, saved OT Hours (user edit) must override fetched OT when present.
          if (savedOTHoursMapAll[empId] !== undefined) {
            totalOvertimeHours = savedOTHoursMapAll[empId];
            if (empId === '33021' || empId === 33021 || empIdStr === '33021') {
              console.log(`✅ Employee 33021: Using SAVED OT Hours (${totalOvertimeHours}) from Payroll table (override)`);
            } else {
              console.log(`Employee ${empId}: Using saved OT Hours value from Payroll table (override): ${totalOvertimeHours}`);
            }
          } else if (savedOTHoursMapAll[empIdStr] !== undefined) {
            totalOvertimeHours = savedOTHoursMapAll[empIdStr];
            if (empId === '33021' || empId === 33021 || empIdStr === '33021') {
              console.log(`✅ Employee 33021: Using SAVED OT Hours (${totalOvertimeHours}) from Payroll table (override)`);
            } else {
              console.log(`Employee ${empId}: Using saved OT Hours value from Payroll table (override): ${totalOvertimeHours}`);
            }
          } else if (fetchedOTValue !== null) {
            // Use fetched value only when no saved override exists.
            totalOvertimeHours = fetchedOTValue;
            if (empId === '33021' || empId === 33021 || empIdStr === '33021') {
              console.log(`✅✅✅ Employee 33021: Using OT Hours from attendance_muster_function: ${totalOvertimeHours} (matched key: "${foundKey}")`);
            } else {
              console.log(`Employee ${empId}: Using OT Hours from attendance_muster_function: ${totalOvertimeHours} (matched key: "${foundKey}")`);
            }
          } else {
            // No fetched value and no saved value - default to 0
            totalOvertimeHours = 0;
            if (empId === '33021' || empId === 33021 || empIdStr === '33021') {
              console.log(`⚠️ Employee 33021: No OT hours found (fetched: ${fetchedOTValue}, saved: none), defaulting to 0`);
              console.log(`   otHoursMap size: ${Object.keys(otHoursMap).length}, keys (first 30): ${Object.keys(otHoursMap).slice(0, 30).join(', ')}`);
              console.log(`   Checking direct keys: otHoursMap['33021']=${otHoursMap['33021']}, otHoursMap[33021]=${otHoursMap[33021]}`);
            } else {
              console.log(`Employee ${empId}: No saved OT Hours value found and no OT hours from attendance_muster_function, defaulting to 0`);
            }
          }
          // Round to 3 decimal places
          totalOvertimeHours = parseFloat((totalOvertimeHours || 0).toFixed(3));
        } else {
          withoutAttendanceCount++;
          // Log detailed debug info for first few employees or when contractor is "All"
          if (result.length < 5 || (contractor === 'All' || !contractor)) {
            console.log(`⚠ NO ATTENDANCE DATA FOUND FOR EMPLOYEE ${empId} (${empContractor})`);
            console.log(`  Employee ID type: ${typeof empId}, Value: "${empId}"`);
            console.log(`  Muster map keys (first 10):`, Object.keys(musterPresentDaysMap).slice(0, 10));
            console.log(`  Muster map size: ${Object.keys(musterPresentDaysMap).length}`);
            // Check if there's a similar ID in attendance data
            const similarIds = attendanceData.filter(att => {
              const attId = String(att.employeeId);
              const empIdStr = String(empId);
              return attId.includes(empIdStr) || empIdStr.includes(attId) ||
                     attId.toLowerCase() === empIdStr.toLowerCase();
            });
            if (similarIds.length > 0) {
              console.log(`  Found ${similarIds.length} similar IDs in attendance data:`, similarIds.slice(0, 3).map(att => att.employeeId));
            }
            if (result.length < 3) {
              console.log(`  Available attendance employee IDs (first 10): [${attendanceData.slice(0, 10).map(att => `"${att.employeeId}"`).join(', ')}]`);
              console.log(`  Total attendance records: ${attendanceData.length}, Data source: ${dataSource}`);
            }
          }
          daysPresent = 0;
          // ALWAYS use fetched OT Hours from attendance_muster_function if available
          // EXCEPTION: For January, only use real-time data (not saved data)
          // For December, always use saved data to preserve existing data
          // Only use saved values if fetched value is not available (and not January)
          const empIdStrNoAtt = String(empId).trim();
          const empIdNumNoAtt = parseInt(empId);
         
          // Check if this is January (month format: YYYY-01) - skip saved data for January
          const isJanuary = month && month.endsWith('-01');
          const isDecember = month && month.endsWith('-12');
         
          // Check if there's a fetched value from attendance_muster_function - try all possible key formats
          let fetchedOT = null;
          let foundKeyNoAtt = null;
         
          // Try direct matches first
          if (otHoursMap[empId] !== undefined) {
            fetchedOT = otHoursMap[empId];
            foundKeyNoAtt = empId;
          } else if (otHoursMap[empIdStrNoAtt] !== undefined) {
            fetchedOT = otHoursMap[empIdStrNoAtt];
            foundKeyNoAtt = empIdStrNoAtt;
          } else if (!isNaN(empIdNumNoAtt)) {
            if (otHoursMap[String(empIdNumNoAtt)] !== undefined) {
              fetchedOT = otHoursMap[String(empIdNumNoAtt)];
              foundKeyNoAtt = String(empIdNumNoAtt);
            } else if (otHoursMap[empIdNumNoAtt] !== undefined) {
              fetchedOT = otHoursMap[empIdNumNoAtt];
              foundKeyNoAtt = empIdNumNoAtt;
            }
          }
         
          // If not found, try fuzzy matching
          if (fetchedOT === null && Object.keys(otHoursMap).length > 0) {
            for (const otKey in otHoursMap) {
              const otKeyStr = String(otKey).trim();
              const otKeyNum = parseInt(otKeyStr);
              if (otKeyStr === empIdStrNoAtt || otKeyStr === String(empId)) {
                fetchedOT = otHoursMap[otKey];
                foundKeyNoAtt = otKey;
                break;
              }
              if (!isNaN(empIdNumNoAtt) && !isNaN(otKeyNum) && otKeyNum === empIdNumNoAtt) {
                fetchedOT = otHoursMap[otKey];
                foundKeyNoAtt = otKey;
                break;
              }
            }
          }
         
          // In automatic mode, saved OT Hours (user edit) must override fetched OT when present.
          if (savedOTHoursMapAll[empId] !== undefined) {
            totalOvertimeHours = savedOTHoursMapAll[empId];
            if (empId === '33021' || empId === 33021 || empIdStrNoAtt === '33021') {
              console.log(`✅ Employee 33021: Using SAVED OT Hours (${totalOvertimeHours}) from Payroll table (override)`);
            } else {
              console.log(`Employee ${empId}: Using saved OT Hours value from Payroll table (override): ${totalOvertimeHours}`);
            }
          } else if (savedOTHoursMapAll[empIdStrNoAtt] !== undefined) {
            totalOvertimeHours = savedOTHoursMapAll[empIdStrNoAtt];
            if (empId === '33021' || empId === 33021 || empIdStrNoAtt === '33021') {
              console.log(`✅ Employee 33021: Using SAVED OT Hours (${totalOvertimeHours}) from Payroll table (override)`);
            } else {
              console.log(`Employee ${empId}: Using saved OT Hours value from Payroll table (override): ${totalOvertimeHours}`);
            }
          } else if (fetchedOT !== null) {
            totalOvertimeHours = fetchedOT;
            if (empId === '33021' || empId === 33021 || empIdStrNoAtt === '33021') {
              console.log(`✅ Employee 33021: Using OT Hours from attendance_muster_function: ${totalOvertimeHours} (no attendance data, matched key: "${foundKeyNoAtt}")`);
            } else {
              console.log(`Employee ${empId}: Using OT Hours from attendance_muster_function: ${totalOvertimeHours} (no attendance data, matched key: "${foundKeyNoAtt}")`);
            }
          } else {
            totalOvertimeHours = 0;
            if (empId === '33021' || empId === 33021 || empIdStrNoAtt === '33021') {
              console.log(`⚠️ Employee 33021: No OT hours found (fetched: ${fetchedOT}, saved: none), defaulting to 0`);
            } else {
              console.log(`Employee ${empId}: No saved OT Hours value found and no OT hours from attendance_muster_function, defaulting to 0`);
            }
          }
          // Round to 3 decimal places
          totalOvertimeHours = parseFloat((totalOvertimeHours || 0).toFixed(3));
        }
       
        // Debug log for daysPresent value before adding to result
        if (processedCount <= 5) {
          console.log(`Employee ${empId} final daysPresent: ${daysPresent} (type: ${typeof daysPresent})`);
        }

        let daysInMonthForCalc = daysInMonth;
        if (samplePayrollOverrides.manualMode) {
          const spDim = pickEmployeeKeyedMapValue(samplePayrollOverrides.daysInMonth, empId);
          const spDp = pickEmployeeKeyedMapValue(samplePayrollOverrides.daysPresent, empId);
          const spOt = pickEmployeeKeyedMapValue(samplePayrollOverrides.otHours, empId);
          if (spDim !== undefined && !Number.isNaN(Number(spDim)) && Number(spDim) > 0) {
            daysInMonthForCalc = Number(spDim);
          }
          if (spDp !== undefined && !Number.isNaN(Number(spDp)) && Number(spDp) >= 0) {
            daysPresent = Math.max(0, Math.round((Number(spDp) + Number.EPSILON) * 2) / 2);
          }
          if (spOt !== undefined && !Number.isNaN(Number(spOt)) && Number(spOt) >= 0) {
            totalOvertimeHours = parseFloat(Number(spOt).toFixed(3));
          }
        }
        if (isManagingPartnerDesignation(emp) && daysInMonthForCalc > 0) {
          daysPresent = daysInMonthForCalc;
        }
   
        // Calculate salary components: Actual Basic and Special Allowance from Setup Configuration formulae when defined, else from Employee
        let actualBasic = getEmployeeNum(emp, 'ActualBasic', 'actualBasic', 'Actual Basic');
        let actualHRA = getEmployeeNum(emp, 'ActualHRA', 'actualHRA', 'Actual HRA');
        let actualDA = getEmployeeNum(emp, 'ActualDA', 'actualDA', 'Actual DA');
        let travelChargers = getEmployeeNum(emp, 'TravelChargers', 'travelChargers', 'TravelCharges', 'Travel Charges', 'TravelCharger') || 0;
        let payrollTravelChargesFromRow = false;
        // Attendance Allowance: Payroll saved, else Employee; Manual mode SamplePayroll when Payroll has no saved OtherAllowance.
        const savedAAPickAll =
          savedActualAttendanceAllowanceMapAll[empId] ??
          savedActualAttendanceAllowanceMapAll[empIdStr] ??
          savedActualAttendanceAllowanceMapAll[normalizeEmployeeCode(String(empId))] ??
          savedActualAttendanceAllowanceMapAll[String(parseInt(empId))];
        const hasSavedActualAttendanceAllowanceAll =
          savedAAPickAll !== undefined &&
          savedAAPickAll !== null &&
          String(savedAAPickAll).trim() !== '' &&
          !Number.isNaN(Number(savedAAPickAll));
        let otherAllowance = hasSavedActualAttendanceAllowanceAll
          ? Number(savedAAPickAll) || 0
          : Number(emp.AttendanceAllowance ?? emp.attendanceAllowance) || 0;
        let specialAllowance = getEmployeeNum(emp, 'ActualSpecialAllowance', 'actualSpecialAllowance', 'SpecialAllowance', 'specialAllowance', 'Special Allowance');
        // Get Arrear, OtherAllowances, OTArrearAmount, and Incentive from existing Payroll record if available; needed for actualTotalSalary and baseEarnedGross
        let arrear = 0;
        let arrearForPFDet = 0;
        let otherAllowances = 0;
        let otherAllowancesOnlyForEarned = 0; // ONLY OtherAllowances (plural), never OtherAllowance (Attendance)
        let otArrearAmountDet = 0;
        let incentive = 0;
        let otherDeductionDet = 0;
        let lwfDet = 0;
        let ptDet = 0;
        try {
          const existingPayrollQuery = `SELECT Arrear, ArrearForPF, OtherAllowances, OTArrearAmount, Incentive, TravelChargers, PT, LWF, OtherDeduction FROM Payroll WHERE EmployeeCode = '${emp.EmployeeCode}' AND Month_filter = '${month}' LIMIT 1`;
          const existingPayrollRecords = await catalystApp.zcql().executeZCQLQuery(existingPayrollQuery);
          if (existingPayrollRecords.length > 0) {
            const pr = existingPayrollRecords[0].Payroll;
            arrear = parseFloat(pr.Arrear) || 0;
            arrearForPFDet = parseFloat(pr.ArrearForPF) || 0;
            otArrearAmountDet = parseFloat(pr.OTArrearAmount) || 0;
            incentive = parseFloat(pr.Incentive) || 0;
            const rawTcPr = pr.TravelChargers ?? pr.travelChargers;
            if (rawTcPr !== null && rawTcPr !== undefined && String(rawTcPr).trim() !== '') {
              const tcPr = parseFloat(rawTcPr) || 0;
              if (!Number.isNaN(tcPr)) {
                travelChargers = tcPr;
                payrollTravelChargesFromRow = true;
              }
            }
            otherDeductionDet = parseFloat(pr.OtherDeduction) || 0;
            lwfDet = (month && month.endsWith('-12')) ? 20 : (parseFloat(pr.LWF) || 0);
            // PT is not taken from saved data; will be set from slab later
            const savedOA = pr.OtherAllowances;
            const savedOANum = (savedOA !== null && savedOA !== undefined && String(savedOA).trim() !== '') ? (parseFloat(savedOA) || 0) : 0;
            const empOANum = getEmployeeNum(emp, 'OtherAllowances', 'otherAllowances', 'OtherAllowance', 'otherAllowance', 'RevisedOtherAllowance', 'RevisedotherAllowance', 'Other Allowance');
            otherAllowances = savedOANum > 0 ? savedOANum : empOANum;
            otherAllowancesOnlyForEarned = savedOANum > 0 ? savedOANum : empOANum;
          } else {
            const empOANum = getEmployeeNum(emp, 'OtherAllowances', 'otherAllowances', 'OtherAllowance', 'otherAllowance', 'RevisedOtherAllowance', 'RevisedotherAllowance', 'Other Allowance');
            otherAllowances = empOANum;
            otherAllowancesOnlyForEarned = empOANum;
          }
        } catch (err) {
          const empOANum = getEmployeeNum(emp, 'OtherAllowances', 'otherAllowances', 'OtherAllowance', 'otherAllowance', 'RevisedOtherAllowance', 'RevisedotherAllowance', 'Other Allowance');
          otherAllowances = empOANum;
          otherAllowancesOnlyForEarned = empOANum;
        }
        const computedEmployeeFormTotalDet = computedEmployeeFormActualTotalSalary(actualBasic, actualHRA, actualDA, specialAllowance);
        let actualTotalSalary = resolveActualTotalSalaryFromEmployee(emp, computedEmployeeFormTotalDet);
        // Actual Basic and Special Allowance from Setup Configuration formulae when defined (PF and display use these)
        if (detailFormulae.length > 0) {
          const pfContext = {
            'Actual Total Salary': actualTotalSalary,
            'Actual Total Gross': actualTotalSalary,
            'Actual HRA': actualHRA,
            'Actual DA': actualDA,
            'Attendance Allowance': otherAllowance,
            'Other Allowances': otherAllowances,
            'TravelChargers': travelChargers,
            'Travel Charges': travelChargers
          };
          const { actualBasic: abFromFormula, actualHRA: ahFromFormula, actualDA: adFromFormula, specialAllowance: saFromFormula } = getActualBasicAndSpecialAllowanceFromFormulae(detailFormulae, pfContext);
          if (abFromFormula !== null) actualBasic = abFromFormula;
          if (ahFromFormula !== null) actualHRA = ahFromFormula;
          if (adFromFormula !== null) actualDA = adFromFormula;
          if (saFromFormula !== null) specialAllowance = saFromFormula;
          if (abFromFormula !== null || ahFromFormula !== null || adFromFormula !== null || saFromFormula !== null) {
            actualTotalSalary = computedEmployeeFormActualTotalSalary(actualBasic, actualHRA, actualDA, specialAllowance);
          }
        }
        if (samplePayrollOverrides.manualMode) {
          const spAb = pickEmployeeKeyedMapValue(samplePayrollOverrides.actualBasic, empId);
          if (spAb !== undefined && !Number.isNaN(Number(spAb)) && Number(spAb) > 0) {
            actualBasic = Number(spAb);
            actualTotalSalary = resolveActualTotalSalaryFromEmployee(
              emp,
              computedEmployeeFormActualTotalSalary(actualBasic, actualHRA, actualDA, specialAllowance)
            );
          }
          const spTcDet = pickEmployeeKeyedMapValue(samplePayrollOverrides.travelChargers, empId);
          if (
            !payrollTravelChargesFromRow &&
            spTcDet !== undefined &&
            spTcDet !== null &&
            String(spTcDet).trim() !== '' &&
            !Number.isNaN(Number(spTcDet))
          ) {
            travelChargers = Number(spTcDet) || 0;
            actualTotalSalary = resolveActualTotalSalaryFromEmployee(
              emp,
              computedEmployeeFormActualTotalSalary(actualBasic, actualHRA, actualDA, specialAllowance)
            );
          }
          if (!hasSavedActualAttendanceAllowanceAll) {
            const spOaDet = pickEmployeeKeyedMapValue(samplePayrollOverrides.otherAllowance, empId);
            if (
              spOaDet !== undefined &&
              spOaDet !== null &&
              String(spOaDet).trim() !== '' &&
              !Number.isNaN(Number(spOaDet))
            ) {
              otherAllowance = Number(spOaDet) || 0;
            }
          }
        }
   
   
        // Debug: Log salary data for first few employees
        if (result.length < 3) {
          console.log(`Employee ${emp.EmployeeCode} salary data:`, {
            actualBasic: emp.ActualBasic,
            actualHRA: emp.ActualHRA,
            actualDA: emp.ActualDA,
            otherAllowance: Number(emp.AttendanceAllowance ?? emp.attendanceAllowance) || 0,
            specialAllowance: emp.SpecialAllowance,
            parsedBasic: actualBasic,
            parsedHRA: actualHRA,
            parsedDA: actualDA,
            parsedOtherAllowance: otherAllowance,
            daysInMonth: daysInMonthForCalc,
            daysPresent: daysPresent
          });
        }
   
        // Calculate earned amounts based on daily rate formula
        // Earned Basic = (Actual Basic / No. of Days(In month) * No. of Days Present) - ((Actual Basic / No. of Days(In month)) / 8 * LOH)
        const dailyBasicRate = daysInMonthForCalc > 0 ? actualBasic / daysInMonthForCalc : 0;
        // Get LOH hours from the fetched map (auto-fetched from LOHreport table), default to 0 if not found
        // Try multiple matching strategies to handle different data types
        let loh = 0;
     
        // Strategy 1: Direct match
        if (lohMap[empId] !== undefined) {
          loh = lohMap[empId];
        }
     
        // Strategy 2: String conversion match
        if (loh === 0) {
          const empIdStr = String(empId);
          if (lohMap[empIdStr] !== undefined) {
            loh = lohMap[empIdStr];
          }
        }
     
        // Strategy 3: Number conversion match
        if (loh === 0) {
          const empIdNum = parseInt(empId);
          if (!isNaN(empIdNum)) {
            const empIdNumStr = String(empIdNum);
            if (lohMap[empIdNumStr] !== undefined) {
              loh = lohMap[empIdNumStr];
            }
          }
        }
     
        // Strategy 4: Try all keys in lohMap to find a match (case-insensitive, partial match)
        if (loh === 0 && Object.keys(lohMap).length > 0) {
          const empIdStr = String(empId).trim();
          for (const key in lohMap) {
            const keyStr = String(key).trim();
            if (keyStr === empIdStr ||
                keyStr.toLowerCase() === empIdStr.toLowerCase() ||
                (keyStr.includes(empIdStr) || empIdStr.includes(keyStr))) {
              loh = lohMap[key];
              break;
            }
          }
        }
     
        // Round to 2 decimal places
        loh = parseFloat((loh || 0).toFixed(2));
        if (samplePayrollOverrides.manualMode) {
          const spLoh = pickEmployeeKeyedMapValue(samplePayrollOverrides.loh, empId);
          if (spLoh !== undefined && spLoh !== null && String(spLoh).trim() !== '' && !Number.isNaN(Number(spLoh))) {
            loh = parseFloat(Number(spLoh).toFixed(2));
          }
        }
     
        // Debug logging for first few employees
        if (result.length < 3) {
          console.log(`Employee ${empId} LOH lookup:`, {
            empId: empId,
            empIdType: typeof empId,
            lohFound: loh,
            lohMapKeys: Object.keys(lohMap).slice(0, 10),
            matchingKeys: Object.keys(lohMap).filter(k => String(k) === String(empId) || String(k).toLowerCase() === String(empId).toLowerCase()).slice(0, 5)
          });
        }
        const earnedBasicRaw = (dailyBasicRate * daysPresent) - ((dailyBasicRate / 8) * loh);
        let earnedBasic = Math.max(0, earnedBasicRaw);
   
        // Earned HRA = (Actual HRA / No. of Days(In month) * No. of Days Present) - ((Actual HRA / No. of Days(In month)) / 8 * LOH)
        const dailyHRARate = daysInMonthForCalc > 0 ? actualHRA / daysInMonthForCalc : 0;
        let earnedHRA = (dailyHRARate * daysPresent) - ((dailyHRARate / 8) * loh);
   
        // Earned DA = (Actual DA / daysInMonth * daysPresent) - ((Actual DA / daysInMonth) / 8 * LOH)
        const dailyDARate = daysInMonthForCalc > 0 ? actualDA / daysInMonthForCalc : 0;
        let earnedDA = (dailyDARate * daysPresent) - ((dailyDARate / 8) * loh);
        // Earned Special Allowance = (Special Allowance / No. of Days(In month) * No. of Days Present)
        const dailySpecialRateDet = daysInMonthForCalc > 0 ? specialAllowance / daysInMonthForCalc : 0;
        let earnedSpecialAllowanceDet = Math.max(0, dailySpecialRateDet * daysPresent);
        if (detailFormulae.length > 0) {
          const formulaContextDet = {
            'Actual Basic': actualBasic,
            'Actual HRA': actualHRA,
            'Actual DA': actualDA,
            'Days Present': daysPresent,
            'No. of Days Present': daysPresent,
            'LOH': loh,
            'Days In Month': daysInMonthForCalc,
            'No. of Days(In month)': daysInMonthForCalc,
            'No. of Days (In Month)': daysInMonthForCalc,
            'No. of Days in Month': daysInMonthForCalc,
            'Attendance Allowance': otherAllowance,
            'Other Allowances': otherAllowances,
            'TravelChargers': travelChargers,
            'Travel Charges': travelChargers,
            'Special Allowance': specialAllowance,
            'Actual Total Gross': actualTotalSalary,
            'Earned Basic': earnedBasic,
            'Earned HRA': earnedHRA,
            'Earned DA': earnedDA,
            'Earned Special Allowance': earnedSpecialAllowanceDet
          };
          for (const { variable, expression } of detailFormulae) {
            const v = String(variable).trim();
            if (!v) continue;
            const num = evaluateFormulaExpression(expression, formulaContextDet);
            if (v === 'Earned Basic') earnedBasic = Math.max(0, num);
            else if (v === 'Earned HRA') earnedHRA = Math.max(0, num);
            else if (v === 'Earned DA') earnedDA = Math.max(0, num);
            else if (v === 'Earned Special Allowance') earnedSpecialAllowanceDet = Math.max(0, num);
          }
        }
        // Always prioritize saved Earned Attendance Allowance from Payroll table (user edits should be preserved)
        // If no saved value, calculate using formula: (Actual Attendance Allowance / daysInMonth × daysPresent) - ((Actual Attendance Allowance / daysInMonth) / 8 × LOH)
        let earnedAttendanceAllowance = 0;
        const empIdStrForAA2 = String(emp.EmployeeCode).trim();
        // Check for saved earned attendance allowance in prefetched map (if available)
        if (savedAttendanceAllowanceMapAll && savedAttendanceAllowanceMapAll[emp.EmployeeCode] !== undefined) {
          earnedAttendanceAllowance = savedAttendanceAllowanceMapAll[emp.EmployeeCode];
          console.log(`Employee ${emp.EmployeeCode}: Using saved Earned Attendance Allowance from Payroll table: ${earnedAttendanceAllowance} (preserving user edit)`);
        } else if (savedAttendanceAllowanceMapAll && savedAttendanceAllowanceMapAll[empIdStrForAA2] !== undefined) {
          earnedAttendanceAllowance = savedAttendanceAllowanceMapAll[empIdStrForAA2];
          console.log(`Employee ${emp.EmployeeCode}: Using saved Earned Attendance Allowance from Payroll table: ${earnedAttendanceAllowance} (preserving user edit)`);
        } else {
          // Calculate using formula: Actual Attendance Allowance is stored in BankName field (legacy storage)
          const actualAttendanceAllowance = parseFloat(emp.BankName) || 0;
          if (actualAttendanceAllowance > 0) {
            const dailyAttendanceAllowanceRate = daysInMonthForCalc > 0 ? actualAttendanceAllowance / daysInMonthForCalc : 0;
            earnedAttendanceAllowance = (dailyAttendanceAllowanceRate * daysPresent) - ((dailyAttendanceAllowanceRate / 8) * loh);
            console.log(`Employee ${emp.EmployeeCode}: Calculated Earned Attendance Allowance using formula: (${actualAttendanceAllowance}/${daysInMonthForCalc}*${daysPresent}) - (${actualAttendanceAllowance}/${daysInMonthForCalc}/8*${loh}) = ${earnedAttendanceAllowance}`);
          } else {
            earnedAttendanceAllowance = 0;
            console.log(`Employee ${emp.EmployeeCode}: No Actual Attendance Allowance found, Earned Attendance Allowance = 0`);
          }
        }
        // arrear, otherAllowances, otArrearAmountDet, incentive already computed above from Payroll (or default 0)
        // Earned Other Allowances = (OtherAllowances / daysInMonth * daysPresent) - ((OtherAllowances / daysInMonth) / 8 * LOH)
        // Use ONLY OtherAllowances (plural) - NEVER OtherAllowance (Attendance Allowance)
        const dailyOtherAllowancesRateNew = daysInMonthForCalc > 0 ? otherAllowancesOnlyForEarned / daysInMonthForCalc : 0;
        const earnedOtherAllowancesNew = (dailyOtherAllowancesRateNew * daysPresent) - ((dailyOtherAllowancesRateNew / 8) * loh);
        const baseEarnedGross = earnedBasic + earnedHRA + earnedDA + earnedAttendanceAllowance + earnedOtherAllowancesNew + arrear + arrearForPFDet + incentive + otArrearAmountDet;
        // Calculate OT wages and OT Payment before earnedSalaryCross calculation
        // OT Wages = (Actual Basic / no.of present in month) / 8 * OT Hours
        // Use OT hours from Payroll table if available, otherwise 0
        const otHoursForCalc = totalOvertimeHours || 0;
        const otWages = daysPresent > 0 ? ((actualBasic / daysPresent) / 8) * otHoursForCalc : 0;
        // OT Amount / OT Payment: Setup & Configuration formulas when defined (same defaults as main payroll path)
        const defaultOtAmountDet = computeDefaultOtAmountFromEarnedAndActual({
          earnedBasic,
          actualBasic,
          daysInMonth: daysInMonthForCalc,
          daysPresent,
          otHours: otHoursForCalc
        });
        const otDetBaseCtx = {
          'Actual Basic': actualBasic,
          'Actual HRA': actualHRA,
          'Actual DA': actualDA,
          'Special Allowance': specialAllowance,
          'Travel Charges': travelChargers,
          'TravelChargers': travelChargers,
          'Days Present': daysPresent,
          'No. of Days Present': daysPresent,
          'Days In Month': daysInMonthForCalc,
          'No. of Days in Month': daysInMonthForCalc,
          'No. of Days (In Month)': daysInMonthForCalc,
          'No. of Days(In month)': daysInMonthForCalc,
          'LOH': loh,
          'Earned Basic': earnedBasic,
          'Earned HRA': earnedHRA,
          'Earned DA': earnedDA,
          'Earned Special Allowance': earnedSpecialAllowanceDet,
          'OT Hours': otHoursForCalc,
          'Actual Total Gross': actualTotalSalary,
          'Actual Total Salary': actualTotalSalary,
          'Attendance Allowance': otherAllowance,
          'Other Allowances': otherAllowances
        };
        const otAmountDetResolved = getOTAmountFromPayrollFormulae(detailFormulae, otDetBaseCtx);
        const otAmount = otAmountDetResolved !== null && otAmountDetResolved !== undefined ? Math.max(0, otAmountDetResolved) : defaultOtAmountDet;
        const defaultOtPaymentDet = daysInMonthForCalc > 0 ? ((actualTotalSalary / daysInMonthForCalc) / 8) * otHoursForCalc * 2 : 0;
        const otPaymentDetResolved = getOTPaymentFromPayrollFormulae(detailFormulae, Object.assign({}, otDetBaseCtx, { 'OT Amount': otAmount }));
        const otPayment = otPaymentDetResolved !== null && otPaymentDetResolved !== undefined ? Math.max(0, otPaymentDetResolved) : defaultOtPaymentDet;
        // Earned Gross Salary = Travel Charges + OT Amount + Incentive + Attendance Bonus + Washing Allowance + Food Allowance + Earned Basic + Earned HRA + Earned Special Allowance
        const attendanceBonusDetForEarned = calcAttendanceBonus(emp.DateofJoining ?? emp.dateofjoining, daysPresent, daysInMonthForCalc, month);
        const washingAllowanceDetForEarned = getEmployeeNum(emp, 'WashingAllowance', 'washingAllowance', 'Washing Allowance') || 0;
        const foodAllowanceDetContext = {
          'Actual Basic': actualBasic,
          'Actual HRA': actualHRA,
          'Actual DA': actualDA,
          'Special Allowance': specialAllowance,
          'Travel Charges': travelChargers,
          'TravelChargers': travelChargers,
          'Days Present': daysPresent,
          'No. of Days Present': daysPresent,
          'Days In Month': daysInMonthForCalc,
          'No. of Days in Month': daysInMonthForCalc,
          'No. of Days (In Month)': daysInMonthForCalc,
          'LOH': loh,
          'Earned Basic': earnedBasic,
          'Earned HRA': earnedHRA,
          'Earned DA': earnedDA,
          'Earned Special Allowance': earnedSpecialAllowanceDet,
          'OT Amount': otAmount,
          'OT Hours': otHoursForCalc,
          'Incentive': incentive,
          'Attendance Bonus': attendanceBonusDetForEarned,
          'Washing Allowance': washingAllowanceDetForEarned,
          'Attendance Allowance': otherAllowance,
          'Other Allowances': otherAllowances,
          'Actual Total Gross': actualTotalSalary,
          'Actual Total Salary': actualTotalSalary
        };
        const foodAllowanceDetForEarned = getFoodAllowanceFromPayrollFormulae(detailFormulae, foodAllowanceDetContext);
        const earnedSalaryCross = (travelChargers || 0) + (otAmount || 0) + (incentive || 0) + (attendanceBonusDetForEarned || 0) + (washingAllowanceDetForEarned || 0) + (foodAllowanceDetForEarned || 0) + (earnedBasic || 0) + (earnedHRA || 0) + (earnedSpecialAllowanceDet || 0);
   
        // PT from slab when no saved PT (6-month basis: divide slabs and PT by 6)
        if (ptDet === 0) {
          if (earnedSalaryCross >= 20001/6 && earnedSalaryCross <= 30000/6) ptDet = 172/6;
          else if (earnedSalaryCross >= 30001/6 && earnedSalaryCross <= 45000/6) ptDet = 430/6;
          else if (earnedSalaryCross >= 45001/6 && earnedSalaryCross <= 60000/6) ptDet = 856/6;
          else if (earnedSalaryCross >= 60001/6 && earnedSalaryCross <= 75000/6) ptDet = 1250/6;
          else if (earnedSalaryCross >= 75001/6) ptDet = 1250/6;
        }
        // If contractor is "Yashaswi Academy for Skills", do not calculate PT, PF, ESI (set to 0)
        const contractorNameDet = String(emp.ContractorName || '').trim();
        const contractorNameDetLower = contractorNameDet.toLowerCase();
        if (contractorNameDetLower === 'yashaswi academy for skills') {
          ptDet = 0;
        }
        // Calculate deductions
        const pfStatus = String(emp.PFStatus || '').trim().toLowerCase();
        const isPfApplicable = pfStatus !== 'no';
        let pfWages;
        let pf;
        if (!isPfApplicable) {
          pf = 0;
          pfWages = 0;
        } else {
          const pfDetBox = computePfLikePayrollUi(
            detailFormulae,
            otDetBaseCtx,
            earnedBasic,
            earnedSpecialAllowanceDet
          );
          pf = pfDetBox.pf;
          pfWages = pfDetBox.pfWages;
        }
        // ESI: if status is 'no' not applicable; if 'yes' calculate regardless; else use period rules (Apr-Sep / Oct-Mar)
        const esiStatus = String(emp.ESIStatus || '').trim().toLowerCase();
        let isEsiApplicable;
        if (esiStatus === 'no') {
          isEsiApplicable = false;
        } else if (esiStatus === 'yes') {
          isEsiApplicable = true;
        } else {
          isEsiApplicable = await checkESIPeriodEligibility(catalystApp, month, String(emp.EmployeeCode || ''), actualTotalSalary);
        }
        // ESI: from Setup formula when defined, else default (Earned Basic + OT Amount + Incentive) * 0.75%. When sum is 0 or less, ESI = 0.
        let esi = 0;
        let employerEsi = 0;
        if (isEsiApplicable) {
          const attendanceBonusDet = calcAttendanceBonus(emp.DateofJoining ?? emp.dateofjoining, daysPresent, daysInMonthForCalc, month);
          const esiFormulaDet = Array.isArray(detailFormulae) && detailFormulae.find((f) => {
            const v = String(f.variable).trim().toLowerCase();
            return v === 'esi 0.75%' || v === 'esi';
          });
          if (esiFormulaDet && esiFormulaDet.expression) {
            const esiContextDet = {
              'Earned Gross Salary': earnedSalaryCross,
              'Earned Basic': earnedBasic,
              'Earned HRA': earnedHRA,
              'Earned Special Allowance': earnedSpecialAllowanceDet,
              'Actual Basic': actualBasic,
              'Actual HRA': actualHRA,
              'Actual DA': actualDA,
              'Special Allowance': specialAllowance,
              'OT Hours': otHoursForCalc,
              'OT Amount': otAmount,
              'Travel Charges': travelChargers,
              'TravelChargers': travelChargers,
              'Attendance Bonus': attendanceBonusDet,
              'Food Allowance': foodAllowanceDetForEarned,
              'Food Allownace': foodAllowanceDetForEarned,
              'Days Present': daysPresent,
              'Days In Month': daysInMonthForCalc,
              'LOH': loh,
              'Incentive': incentive
            };
            const esiFromFormulaDet = evaluateFormulaExpression(esiFormulaDet.expression, esiContextDet);
            esi = Number.isFinite(esiFromFormulaDet) ? Math.max(0, Math.ceil(esiFromFormulaDet)) : 0;
            if (esi > 0) employerEsi = earnedSalaryCross * 0.0325;
          } else {
            const esiBaseComponentsDet = earnedBasic + otAmount + incentive;
            if (esiBaseComponentsDet <= 0) {
              esi = 0;
            } else {
              esi = Math.round(esiBaseComponentsDet * 0.0075);
              if (esi > 0) employerEsi = earnedSalaryCross * 0.0325;
            }
          }
        }
        if (contractorNameDetLower === 'yashaswi academy for skills') {
          pf = 0;
          esi = 0;
          employerEsi = 0;
        }
        const employerLwf = (month && month.endsWith('-12')) ? 40 : 0; // Employer LWF contribution (40 for December)
        // Rent from employee row (Rent / rent)
        const rentAmountDet = Number(emp.Rent ?? emp.rent ?? 0) || 0;
        // Total Deduction = PF + ESI + Other Deduction + LWF + PT + Rent Recovery (for Yashaswi, PF/ESI/PT are 0)
        const totalDeduction = pf + esi + otherDeductionDet + lwfDet + ptDet + rentAmountDet;
   
        // Debug: Log earned calculations for first few employees
        if (result.length < 3) {
          console.log(`Employee ${emp.EmployeeCode} earned calculations:`, {
            actualBasic: actualBasic,
            actualHRA: actualHRA,
            daysPresent: daysPresent,
            daysInMonth: daysInMonthForCalc,
            dailyBasicRate: dailyBasicRate,
            earnedBasic: earnedBasic,
            dailyHRARate: dailyHRARate,
            earnedHRA: earnedHRA,
            earnedSalaryCross: earnedSalaryCross,
            pf: pf,
            esi: esi,
            employerEsi: employerEsi,
            esiContribution: Number(emp.ESIContribution ?? emp.esiContribution) || 0,
            totalDeduction: totalDeduction,
            formulas: {
              earnedBasic: 'Actual Basic / no.of days in month * no.of present days',
              earnedHRA: 'Actual HRA / no.of days in month * no.of present days',
              pf: 'if(Earned Basic > 15000, 1800 else Earned Basic * 12%)',
              esi: '(Earned Basic + OT Amount + Incentive) * 0.75%',
              employerEsi: 'Earned Gross Salary * 3.25%'
            },
            calculation: {
              earnedBasicFormula: `${actualBasic} / ${daysInMonthForCalc} * ${daysPresent} - ((${actualBasic} / ${daysInMonthForCalc}) / 8 * ${loh}) = ${earnedBasic}`,
              earnedHRAFormula: `${actualHRA} / ${daysInMonthForCalc} * ${daysPresent} = ${earnedHRA}`
            }
          });
        }
   
        // Calculate OT ESI
        // OT ESI = OT Payment * 0.75% (only if ESI is applicable)
        const otEsi = isEsiApplicable ? Math.ceil(otPayment * 0.0075) : 0;
   
        // Calculate Payable Amount
        // Payable Amount = OT Payment - OT ESI
        const payableAmount = otPayment - otEsi;
   
        // Debug: Log attendance and OT wages calculation for first few employees
        if (result.length < 3) {
          console.log(`Employee ${emp.EmployeeCode} attendance and OT calculation:`, {
            daysPresent: daysPresent,
            otHours: totalOvertimeHours,
            otHoursSource: 'Manual entry (no automatic fetching)',
            dataSource: dataSource,
            actualTotalSalary: actualTotalSalary,
            daysInMonth: daysInMonthForCalc,
            otWages: otWages,
            formula: 'OT Wages = actualTotalSalary / daysInMonthForCalc / 8'
          });
        }
   
     
        // Calculate Net Pay: Earned Gross - Total Deduction (Total Deduction includes Rent for all contractors)
        const netPay = earnedSalaryCross - totalDeduction;

        // Get detection data for this employee (rent and advance) - for additional deductions
        // Use pre-fetched detection data map instead of querying per employee
        let rentAmount = 0;
        let advanceAmount = 0;
       
        if (detectionTableExists) {
          const detectionData = detectionDataMap[emp.EmployeeCode];
          if (detectionData) {
            rentAmount = detectionData.rentAmount;
            advanceAmount = detectionData.advanceAmount;
            // Only log for first few employees to avoid spam
            if (processedCount < 5) {
              console.log(`Found detection data for ${emp.EmployeeCode}: Rent=${rentAmount}, Advance=${advanceAmount}`);
            }
          }
        }
        // Rent column: Payroll Rent + any Detection rent
        const rentToDisplay = rentAmountDet + rentAmount;

        // Calculate final net pay after additional deductions (rent and advance)
        const finalNetPay = netPay - rentAmount - advanceAmount;
   
        // Calculate Total Net Payable
        // Total Net Payable = Net Pay + Payable Amount
        const totalNetPayable = finalNetPay + payableAmount;
     
        // Calculate LOP: LOP = no. of days in month - no. of days present
        // Formula: LOP = daysInMonth - daysPresent
        // Ensure LOP is never negative (minimum 0)
        const lop = Math.max(0, daysInMonthForCalc - daysPresent);
     
        // Compute ERPF 12% + Admin 0.5% + EDLI 0.5% before service charge (service charge base includes ERPF 12% + Admin 0.5% + EDLI 0.5% + Employer ESI + Employer LWF)
        const admin = contractorNameDetLower === 'yashaswi academy for skills' ? 0 : (isPfApplicable ? Math.round(pfWages * 0.005) : 0); // Admin 0.5%
        const edli = contractorNameDetLower === 'yashaswi academy for skills' ? 0 : (isPfApplicable ? (Math.round(pfWages) === 15000 ? 75 : Math.round(pfWages * 0.005)) : 0); // EDLI 0.5%
        const erpf12PlusAdminPlusEdli = contractorNameDetLower === 'yashaswi academy for skills' ? 0 : (Math.round(pf) + admin + edli); // ERPF 12% + Admin 0.5% + EDLI 0.5%
        // Special cases for service charge calculation:
        // - "Yashaswi Academy For Skills" = 1000 fixed
        // - "sriram enterprice"/"sriram enterprise"/"sriram enterprises" (case-insensitive) = 8%
        // - All others = 9%
        const contractorName = String(emp.ContractorName || '').trim();
        // Service charge base = baseEarnedGross + ERPF 12% + Admin 0.5% + EDLI 0.5% + Employer ESI 3.25% + Employer LWF (do not include ESI Contribution)
        const serviceChargeBase = Math.max(0, baseEarnedGross + erpf12PlusAdminPlusEdli + employerEsi + employerLwf);
        let serviceCharge;
        if (contractorName.toLowerCase() === 'yashaswi academy for skills') {
          serviceCharge = 1000;
        } else if (contractorName.toLowerCase() === 'sriram enterprice' || contractorName.toLowerCase() === 'sriram enterprise' || contractorName.toLowerCase() === 'sriram enterprises') {
          serviceCharge = Math.round(serviceChargeBase * 0.08); // 8% for Sriram Enterprise/Enterprises
        } else {
          serviceCharge = Math.round(serviceChargeBase * 0.09); // 9% for all others (on base + ERPF 12% + Admin 0.5% + EDLI 0.5% + Employer ESI + Employer LWF)
        }
        const esiContributionDet = Number(emp.ESIContribution ?? emp.esiContribution) || 0;
        const total = Math.round(earnedSalaryCross) + erpf12PlusAdminPlusEdli + serviceCharge + Math.round(employerEsi) + Math.round(employerLwf) + Math.round(esiContributionDet); // Total = Earned Gross + ERPF 12% + Admin 0.5% + EDLI 0.5% + Service Charge + ... + ESI Contribution
        // Special case: If contractor is "Yashaswi Academy For Skills", GST = 0, otherwise calculate 18%
        const gst = contractorName === 'Yashaswi Academy For Skills' ? 0 : Math.round(total * 0.18);
        const netTotal = total + gst;

        // Format DateofJoining from Employee table (handle different key casings)
        const empDateRaw = emp.DateofJoining ?? emp.dateofjoining ?? emp.DateOfJoining;
        let dateOfJoining = '';
        if (empDateRaw) {
          if (typeof empDateRaw === 'string') {
            if (/^\d{4}-\d{2}-\d{2}$/.test(empDateRaw)) {
              dateOfJoining = empDateRaw;
            } else {
              const d = new Date(empDateRaw);
              if (!isNaN(d)) {
                dateOfJoining = d.toISOString().slice(0, 10);
              }
            }
          } else {
            const d = new Date(empDateRaw);
            if (!isNaN(d)) {
              dateOfJoining = d.toISOString().slice(0, 10);
            }
          }
        }

        result.push({
          employeeCode: emp.EmployeeCode,
          employeeName: emp.EmployeeName || '',
          designation: String(emp.Designation ?? emp.designation ?? '').trim(),
          unit: String(emp.RelevantExperience ?? emp.relevantExperience ?? '').trim(),
          department: emp.Department || '',
          category: String(emp.Category ?? emp.category ?? '').trim(),
          contractor: emp.ContractorName || '',
          dateOfJoining: dateOfJoining,
          daysInMonth: daysInMonthForCalc,
          daysPresent: daysPresent,
          otHours: totalOvertimeHours || 0, // OT hours: use saved value or fetch from attendance_muster_function
          loh: loh,
          revisedLOH: resolveRevisedLohForEmployee(emp.EmployeeCode, loh, latestSavedRevisedLOHByEmp),
          actualBasic: actualBasic,
          actualHRA: actualHRA,
          actualDA: actualDA,
          otherAllowance: otherAllowance,
          travelChargers: travelChargers,
          specialAllowance: specialAllowance,
          foodAllowance: foodAllowanceDetForEarned,
          uniformAllowance: 0,
          incentive: incentive,
          otherAllowances: otherAllowances,
          actualTotalSalary: actualTotalSalary,
          earnedBasic: Math.round(earnedBasic),
          earnedHRA: Math.round(earnedHRA),
          earnedDA: Math.round(earnedDA),
          earnedAttendanceAllowance: earnedAttendanceAllowance,
          earnedOtherAllowances: Math.round(earnedOtherAllowancesNew),
          arrear: Math.round(arrear),
          arrearForPF: Math.round(arrearForPFDet),
          lop: lopDaysValue(lop),
          earnedSalaryCross: Math.round(earnedSalaryCross),
          pf: Math.round(pf),
          esi: Math.round(esi),
          employerEsi: Math.round(employerEsi),
          esiContribution: Math.round(Number(emp.ESIContribution ?? emp.esiContribution) || 0),
          employerLwf: Math.round(employerLwf),
          otherDeduction: Math.round(otherDeductionDet),
          lwf: Math.round(lwfDet),
          pt: Math.round(ptDet),
          totalDeduction: Math.round(totalDeduction),
          otWages: Math.round(otWages),
          otPayment: Math.round(otPayment),
          otArrearAmount: Math.round(Number(emp.OTArrearAmount ?? emp.otArrearAmount ?? 0) || 0),
          otEsi: Math.round(otEsi),
          payableAmount: Math.round(payableAmount),
          rent: Math.round(rentToDisplay),
          advance: Math.round(advanceAmount),
          netPay: Math.round(finalNetPay),
          totalNetPayable: Math.round(totalNetPayable),
          erpf: Math.round(pf), // ERPF = PF = (Earned Basic + Earned DA) * 12%
          admin: Math.round((earnedBasic + earnedDA) * 0.005), // Admin = (Earned Basic + Earned DA) * 0.5%
          edli: Math.round(earnedBasic + earnedDA) === 15000 ? 75 : Math.round((earnedBasic + earnedDA) * 0.005), // EDLI = 75 if (Earned Basic + Earned DA) == 15000, else (Earned Basic + Earned DA) * 0.5%
          erpf13: erpf12PlusAdminPlusEdli, // ERPF 12% + Admin 0.5% + EDLI 0.5% (kept for backend/DB compatibility)
          // Special case: If contractor is "Yashaswi Academy For Skills", set service charge to 1000 fixed
          serviceCharge: serviceCharge, // Service Charge = 1000 fixed for Yashaswi Academy For Skills, 8% for Sriram Enterprise, 9% for others
          total: total, // Total = Earned Gross Salary + ERPF 13% + Service Charge + Employer ESI 3.25% + Employer LWF
          gst: gst, // GST = Total * 18%
          netTotal: netTotal, // Net Total = Total + GST
          bonus: 0,
          bankHolderName: emp.BankHolderName || '',
          bankName: emp.BankName || '',
          ifscCode: emp.IFSCCode || '',
          bankBranch: emp.BankBranch || '',
          uanNo: String(emp.UANNo ?? emp.uanNo ?? emp.UAN ?? ''),
          esicNo: String(emp.ESICNo ?? emp.esicNo ?? emp.ESIC ?? ''),
          pfStatus: emp.PFStatus || '',
          esiStatus: emp.ESIStatus || '',
          employeeStatus: emp.EmployeeStatus || emp.employeeStatus || ''
        });
        const payrollResultRowApi = result[result.length - 1];
        const empIdForMerge = emp.EmployeeCode;
        const empIdNormMerge = normalizeEmployeeCode(String(empIdForMerge || ''));
        const empIdStrMerge = String(empIdForMerge || '').trim();
        const rawSavedPayrollApi =
          latestPayrollRawByNormalizedCodeApi.get(empIdNormMerge) ||
          latestPayrollRawByNormalizedCodeApi.get(empIdStrMerge) ||
          latestPayrollRawByNormalizedCodeApi.get(String(empIdForMerge).trim()) ||
          latestPayrollRawByNormalizedCodeApi.get(String(parseInt(empIdForMerge, 10)));
        mergeSavedPayrollCustomColumnsIntoResultRow(payrollResultRowApi, rawSavedPayrollApi);
        applyRevisedLohToPayrollRow(payrollResultRowApi);
        const rawSavedSampleApi =
          latestSamplePayrollRawByNormalizedCodeApi.get(empIdNormMerge) ||
          latestSamplePayrollRawByNormalizedCodeApi.get(empIdStrMerge) ||
          latestSamplePayrollRawByNormalizedCodeApi.get(String(empIdForMerge).trim()) ||
          latestSamplePayrollRawByNormalizedCodeApi.get(String(parseInt(empIdForMerge, 10)));
        mergeRunPayrollCustomFillGaps(payrollResultRowApi, rawSavedSampleApi);
        const rawSavedRunApi =
          latestRunPayrollRawByNormalizedCodeApi.get(empIdNormMerge) ||
          latestRunPayrollRawByNormalizedCodeApi.get(empIdStrMerge) ||
          latestRunPayrollRawByNormalizedCodeApi.get(String(empIdForMerge).trim()) ||
          latestRunPayrollRawByNormalizedCodeApi.get(String(parseInt(empIdForMerge, 10)));
        mergeRunPayrollCustomFillGaps(payrollResultRowApi, rawSavedRunApi);
        applyEmployeeStatutoryIdsToPayrollRow(payrollResultRowApi, emp);
      }

      // Summary log
      console.log('=== PROCESSING SUMMARY ===');
      console.log(`Total employees processed: ${processedCount}`);
      console.log(`Employees skipped (imported data): ${skippedCount}`);
      console.log(`Employees with attendance data: ${withAttendanceCount}`);
      console.log(`Employees without attendance data: ${withoutAttendanceCount}`);
      console.log(`Final result count: ${result.length}`);
      console.log(`   - Imported records: ${importedPayrollData.length}`);
      console.log(`   - Calculated records: ${result.length - importedPayrollData.length}`);
      console.log(`   - Employees with imported data (skipped from calculation): ${importedEmployeeCodeSet.size}`);
      if (contractor === 'All' || !contractor) {
        // Group by contractor to see distribution
        const byContractor = {};
        result.forEach(emp => {
          const cont = emp.contractor || 'Unknown';
          if (!byContractor[cont]) {
            byContractor[cont] = { total: 0, withAttendance: 0, withoutAttendance: 0 };
          }
          byContractor[cont].total++;
          if (emp.daysPresent > 0) {
            byContractor[cont].withAttendance++;
          } else {
            byContractor[cont].withoutAttendance++;
          }
        });
        console.log('Results by contractor:', byContractor);
      }
      console.log('=== END PROCESSING SUMMARY ===');

      console.log('Final result count:', result.length);
      if (result.length > 0) {
        console.log('First result record:', result[0]);
        console.log('Sample result data:', {
          employeeCode: result[0].employeeCode,
          employeeName: result[0].employeeName,
          actualBasic: result[0].actualBasic,
          actualHRA: result[0].actualHRA,
          actualDA: result[0].actualDA,
          otherAllowance: result[0].otherAllowance,
          actualTotalSalary: result[0].actualTotalSalary,
          loh: result[0].loh,
          lohType: typeof result[0].loh,
          netPay: result[0].netPay
        });
        // Check LOH values in first 10 records
        const lohSample = result.slice(0, 10).map(emp => ({
          employeeCode: emp.employeeCode,
          loh: emp.loh,
          lohType: typeof emp.loh
        }));
        console.log('LOH values in first 10 records:', lohSample);
        const employeesWithLOH = result.filter(emp => parseFloat(emp.loh) > 0);
        console.log(`Employees with LOH > 0: ${employeesWithLOH.length} out of ${result.length}`);
        if (employeesWithLOH.length > 0) {
        }
        console.log('All employee codes in result:', result.map(emp => emp.employeeCode));
      }

      // Check if user is restricted and month is Aug-Oct (2025-08, 2025-09, 2025-10)
      // For restricted users, set all numeric columns to 0 for these months
      const restrictedEmails = [
        'afrindinusha@gmail.com',
        'rpdmanpowerservice@gmail.com',
        'afrindinusha29@gmail.com',
        'sriramenterprises50@yahoo.com',
        'afrinatlin@gmail.com',
        'samuelenterprisesms@gmail.com',
        'dinushaafrin@gmail.com',
        'vijaybalaji701@gmail.com',
        'afrindinu14@gmail.com',
        'vaishnavi.a@buildhr.co.in'
      ];
      const restrictedMonths = ['2025-07', '2025-08', '2025-09', '2025-10'];
     
      if (userEmail && restrictedEmails.includes(userEmail) && restrictedMonths.includes(month)) {
        console.log(`⚠️ Restricted user ${userEmail} accessing ${month} - returning zeros for all columns`);
        // Set all numeric columns to 0 while preserving employee info
        result = result.map(emp => ({
          ...emp,
          daysInMonth: 0,
          daysPresent: 0,
          otHours: 0,
          loh: 0,
          actualBasic: 0,
          actualHRA: 0,
          actualDA: 0,
          otherAllowance: 0,
          otherAllowances: 0,
          specialAllowance: 0,
          incentive: 0,
          actualTotalSalary: 0,
          earnedBasic: 0,
          earnedHRA: 0,
          earnedDA: 0,
          arrear: 0,
          arrearForPF: 0,
          lop: 0,
          earnedSalaryCross: 0,
          pf: 0,
          esi: 0,
          totalDeduction: 0,
          otAmount: 0,
          otArrearAmount: 0,
          otEsi: 0,
          otPayment: 0,
          payableAmount: 0,
          otWages: 0,
          rent: 0,
          advance: 0,
          netPay: 0,
          totalNetPayable: 0,
          erpf: 0,
          admin: 0,
          edli: 0,
          erpf13: 0,
          employerEsi: 0,
          esiContribution: 0,
          serviceCharge: 0,
          total: 0,
          gst: 0,
          netTotal: 0,
          bonus: 0
        }));
      }

      // Enrich employeeStatus for all result records from Employee table (so "Active" filter shows all active employees, not just calculated)
      const codesWithEmptyStatus = result.filter(r => !String(r.employeeStatus || '').trim()).map(r => String(r.employeeCode || '').trim()).filter(Boolean);
      if (codesWithEmptyStatus.length > 0) {
        try {
          const uniqueCodes = [...new Set(codesWithEmptyStatus)];
          const empCodesList = uniqueCodes.map(code => `'${String(code).replace(/'/g, "''")}'`).join(',');
          const enrichQuery = `SELECT EmployeeCode, employeeStatus FROM Employee WHERE EmployeeCode IN (${empCodesList})`;
          const enrichRecords = await catalystApp.zcql().executeZCQLQuery(enrichQuery);
          const enrichMap = {};
          for (const row of enrichRecords) {
            const emp = row.Employee;
            if (emp && emp.EmployeeCode) {
              const ec = String(emp.EmployeeCode);
              const status = String(emp.EmployeeStatus || emp.employeeStatus || emp.Employee_Status || '').trim();
              enrichMap[ec] = status;
              enrichMap[normalizeEmployeeCode(ec)] = status;
              if (/^\d+$/.test(ec)) enrichMap[String(parseInt(ec))] = status;
            }
          }
          let enrichedCount = 0;
          for (const rec of result) {
            if (!String(rec.employeeStatus || '').trim() && rec.employeeCode) {
              const code = String(rec.employeeCode).trim();
              const status = enrichMap[code] || enrichMap[normalizeEmployeeCode(code)] || (/^\d+$/.test(code) ? enrichMap[String(parseInt(code))] : '') || '';
              if (status) {
                rec.employeeStatus = status;
                enrichedCount++;
              }
            }
          }
          if (enrichedCount > 0) {
            console.log(`Enriched employeeStatus for ${enrichedCount} records from Employee table (so Active/Inactive filter shows all employees)`);
          }
        } catch (enrichErr) {
          console.log('Enrich employeeStatus fallback failed (non-fatal):', enrichErr.message);
        }
      }

      console.log('=== BACKEND PAYROLL ENDPOINT - SENDING RESPONSE ===');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: result }));
    } catch (err) {
      console.error('Payroll endpoint error:', err);
      console.error('Error stack:', err.stack);
      console.error('Error details:', {
        message: err.message,
        name: err.name,
        month: query.month,
        contractor: query.contractor,
        fromDate: query.fromDate,
        toDate: query.toDate
      });
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: err.message || 'An error occurred while processing payroll',
        details: process.env.NODE_ENV === 'development' ? err.stack : undefined
      }));
    }
    return;
  }

  // Get all EmployeeCodes, optionally filtered by contractor
  if (pathname === '/employee-codes') {
    try {
      const catalystApp = catalyst.initialize(req);
      const empTable = catalystApp.datastore().table('Employee');
      const norm = (v) => String(v || '').replace(/\s+/g, ' ').trim().toLowerCase();
      let empRows = await empTable.getAllRows();
      if (query.contractor && query.contractor !== 'All') {
        const target = norm(query.contractor);
        empRows = empRows.filter(e => norm(e.ContractorName) === target);
      }
      const employeeCodes = empRows.map(e => e.EmployeeCode).filter(Boolean);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: employeeCodes }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Get all employees with codes and names from CMS function
  if (pathname === '/employees-list') {
    try {
      const catalystApp = catalyst.initialize(req);
      const empTable = catalystApp.datastore().table('Employee');
      const norm = (v) => String(v || '').replace(/\s+/g, ' ').trim().toLowerCase();
      let empRows = await empTable.getAllRows();
      if (query.contractor && query.contractor !== 'All') {
        const target = norm(query.contractor);
        empRows = empRows.filter(e => norm(e.ContractorName) === target);
      }
 
      const employees = empRows.map(e => ({
        employeeCode: e.EmployeeCode,
        employeeName: e.EmployeeName,
        department: e.Department,
        contractor: e.ContractorName,
        basicSalary: e.ActualBasic || 0,
        hra: e.ActualHRA || 0
      })).filter(emp => emp.employeeCode && emp.employeeName);
 
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: employees }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Get all Departments
  if (pathname === '/departments') {
    try {
      const catalystApp = catalyst.initialize(req);
      const deptTable = catalystApp.datastore().table('Department');
      const deptRows = await deptTable.getAllRows();
      const departments = deptRows.map(d => d.Department).filter(Boolean);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: departments }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Get all Contractors
  if (pathname === '/contractors') {
    try {
      const catalystApp = catalyst.initialize(req);
      const userEmail = query.userEmail;
   
      // Filter contractors based on user email
      let contractors = [];
      const emailContractorMap = {
        'afrindinusha@gmail.com': 'R.P.D Facility Management Services',
        'rpdmanpowerservice@gmail.com': 'R.P.D Facility Management Services',
        'afrindinusha29@gmail.com': 'Sriram enterprises', // use DB spelling
        'sriramenterprises50@yahoo.com': 'Sriram enterprises', // use DB spelling
        'afrinatlin@gmail.com': 'Samuel Enterprise',
      'samuelenterprisesms@gmail.com': 'Samuel Enterprise',
        'dinushaafrin@gmail.com': 'Sri Balaji Enterprises',
      'vijaybalaji701@gmail.com': 'Sri Balaji Enterprises',
        'afrindinu14@gmail.com': 'Yashaswi Academy for Skills',
        'vaishnavi.a@buildhr.co.in': 'Yashaswi Academy for Skills',
      };
      const forcedContractor = emailContractorMap[userEmail];
      if (forcedContractor) {
        contractors = [forcedContractor];
        console.log(`Filtering contractors for ${userEmail}: showing only ${forcedContractor}`);
      } else {
        // Return all contractors for other users
      const contractorTable = catalystApp.datastore().table('Contractors');
      const contractorRows = await contractorTable.getAllRows();
        contractors = contractorRows.map(c => c.ContractorName).filter(Boolean);
      }
   
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: contractors }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Get saved payroll report for a month (only imported/saved rows)
  if (pathname === '/report') {
    try {
      const catalystApp = catalyst.initialize(req);
      const month = query.month; // format: YYYY-MM
      let contractor = query.contractor;
      const department = query.department;
      const employeeId = query.employeeId;
      const userEmail = query.userEmail;

      if (!month) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing month parameter (YYYY-MM)' }));
        return;
      }

      // Apply email→contractor mapping to restrict results
      const emailContractorMap = {
        'afrindinusha@gmail.com': 'R.P.D Facility Management Services',
        'rpdmanpowerservice@gmail.com': 'R.P.D Facility Management Services',
        'afrindinusha29@gmail.com': 'Sriram Enterprises',
        'sriramenterprises50@yahoo.com': 'Sriram Enterprises',
        'afrinatlin@gmail.com': 'Samuel Enterprise',
      'samuelenterprisesms@gmail.com': 'Samuel Enterprise',
        'afrindinu14@gmail.com': 'Yashaswi Academy for Skills',
      };
      const forcedContractor = emailContractorMap[userEmail];
      if (forcedContractor) {
        contractor = forcedContractor;
        console.log(`Filtering payroll report for user ${userEmail} - showing only ${forcedContractor} employees`);
      }

      // Ensure Payroll table exists
      const payrollTable = catalystApp.datastore().table('Payroll');
      await payrollTable.getAllRows({ maxRecords: 1 }).catch(() => []);

      // Fetch all rows for the month, apply optional filters in JS for flexible matching
      const baseQuery = `SELECT * FROM Payroll WHERE Month_filter = '${month}'`;
      const rows = await catalystApp.zcql().executeZCQLQuery(baseQuery);
      console.log(`Payroll report: Found ${rows.length} records for month ${month}`);

      let records = rows.map(r => r.Payroll);
   
      // Debug: Show unique contractor names in the data
      if (rows.length > 0) {
        const uniqueContractors = [...new Set(records.map(r => r.Contractor || '').filter(Boolean))];
        console.log('Unique contractor names in Payroll table:', uniqueContractors);
        console.log('Looking for contractor:', contractor);
      }
      if (contractor && contractor !== 'All') {
        const normalizedContractor = String(contractor || '').replace(/\s+/g, ' ').trim().toLowerCase();
        const contractorWords = normalizedContractor.split(' ').filter(w => w.length > 2);
     
        records = records.filter(r => {
          const recordContractor = String(r.Contractor || '').replace(/\s+/g, ' ').trim().toLowerCase();
          // Try exact match first
          if (recordContractor === normalizedContractor) return true;
          // Try contains match
          if (recordContractor.includes(normalizedContractor) || normalizedContractor.includes(recordContractor)) return true;
          // Try matching key words (handles variations like "Samuel Enterprise" vs "Samuel Enterprises")
          if (contractorWords.length > 0) {
            const allKeyWordsMatch = contractorWords.every(word => recordContractor.includes(word));
            if (allKeyWordsMatch) {
              const firstWord = contractorWords[0];
              const recordFirstWord = recordContractor.split(' ')[0];
              if (recordFirstWord && (recordFirstWord.startsWith(firstWord) || firstWord.startsWith(recordFirstWord))) {
                return true;
              }
            }
          }
          return false;
        });
        console.log(`Filtered payroll report records for contractor "${contractor}":`, records.length, 'out of', rows.length);
      }
      if (department && department !== 'All') {
        records = records.filter(r => String(r.Department || '').toLowerCase().includes(String(department).toLowerCase()));
      }
      if (employeeId && employeeId !== 'All') {
        records = records.filter(r => String(r.EmployeeCode) === String(employeeId));
      }

      // Fetch DateofJoining, OtherAllowance/OtherAllowances, and Actual salary components (ActualHRA, ActualDA, etc.) from Employee table so payroll shows latest employee form data
      const dateOfJoiningMap = {};
      const designationMap = {};
      const categoryMap = {};
      const employeeNameMap = {};
      const departmentMap = {};
      const employeeOtherAllowancesMap = {};
      const employeeActualHRAMap = {};
      const employeeActualDAMap = {};
      const employeeActualBasicMap = {};
      const employeeSpecialAllowanceMap = {};
      const employeeAttendanceAllowanceMap = {};
      const employeeTotalSalaryMap = {};
      const pfStatusMap = {};
      const uanNoMap = {};
      const esicNoMap = {};
      const putReportKeyedStringMap = (map, code, value) => {
        if (!code || value === undefined || value === null) return;
        const v = String(value).trim();
        if (!v) return;
        map[code] = v;
        map[normalizeEmployeeCode(code)] = v;
        if (/^\d+$/.test(code)) map[String(parseInt(code, 10))] = v;
      };
      try {
        const employeeCodes = records.map(r => r.EmployeeCode).filter(Boolean);
        if (employeeCodes.length > 0) {
          const empCodesList = employeeCodes.map(code => `'${String(code).replace(/'/g, "''")}'`).join(',');
          const dateQuery = `SELECT EmployeeCode, EmployeeName, Department, DateofJoining, Designation, Category, AttendanceAllowance, OtherAllowance, RevisedOtherAllowance, ActualBasic, ActualHRA, ActualDA, SpecialAllowance, ActualSpecialAllowance, TotalSalary, PFStatus, UANNo, ESICNo FROM Employee WHERE EmployeeCode IN (${empCodesList})`;
          const dateRecords = await catalystApp.zcql().executeZCQLQuery(dateQuery);
          for (const row of dateRecords) {
            const emp = row.Employee;
            if (emp.EmployeeCode) {
              const dojRaw = emp.DateofJoining ?? emp.dateofjoining ?? emp.DateOfJoining;
              let dateOfJoining = '';
              if (dojRaw) {
                if (typeof dojRaw === 'string') {
                  if (/^\d{4}-\d{2}-\d{2}$/.test(dojRaw)) {
                    dateOfJoining = dojRaw;
                  } else {
                    const d = new Date(dojRaw);
                    if (!isNaN(d)) {
                      dateOfJoining = d.toISOString().slice(0, 10);
                    }
                  }
                } else {
                  const d = new Date(dojRaw);
                  if (!isNaN(d)) {
                    dateOfJoining = d.toISOString().slice(0, 10);
                  }
                }
              }
              const empCode = String(emp.EmployeeCode);
              dateOfJoiningMap[empCode] = dateOfJoining;
              dateOfJoiningMap[normalizeEmployeeCode(empCode)] = dateOfJoining;
              if (/^\d+$/.test(empCode)) dateOfJoiningMap[String(parseInt(empCode))] = dateOfJoining;
              const desigRow = String(emp.Designation ?? emp.designation ?? '').trim();
              designationMap[empCode] = desigRow;
              designationMap[normalizeEmployeeCode(empCode)] = desigRow;
              if (/^\d+$/.test(empCode)) designationMap[String(parseInt(empCode))] = desigRow;
              const catRow = String(emp.Category ?? emp.category ?? '').trim();
              categoryMap[empCode] = catRow;
              categoryMap[normalizeEmployeeCode(empCode)] = catRow;
              if (/^\d+$/.test(empCode)) categoryMap[String(parseInt(empCode))] = catRow;
              putReportKeyedStringMap(employeeNameMap, empCode, emp.EmployeeName ?? emp.employeeName ?? emp.Name ?? emp.name);
              putReportKeyedStringMap(departmentMap, empCode, emp.Department ?? emp.department);
              const empOA = emp.OtherAllowances ?? emp.otherAllowances ?? emp.OtherAllowance ?? emp.otherAllowance ?? emp.RevisedOtherAllowance ?? 0;
              const oaVal = Number(empOA) || 0;
              employeeOtherAllowancesMap[empCode] = oaVal;
              employeeOtherAllowancesMap[normalizeEmployeeCode(empCode)] = oaVal;
              if (/^\d+$/.test(empCode)) employeeOtherAllowancesMap[String(parseInt(empCode))] = oaVal;
              const setEmpMaps = (code, hra, da, basic, special, attAllowance) => {
                employeeActualHRAMap[code] = hra;
                employeeActualDAMap[code] = da;
                employeeActualBasicMap[code] = basic;
                employeeSpecialAllowanceMap[code] = special;
                employeeAttendanceAllowanceMap[code] = attAllowance;
              };
              const hra = getEmployeeNum(emp, 'ActualHRA', 'actualHRA', 'Actual HRA');
              const da = getEmployeeNum(emp, 'ActualDA', 'actualDA', 'Actual DA');
              const basic = getEmployeeNum(emp, 'ActualBasic', 'actualBasic', 'Actual Basic');
              const special = getEmployeeNum(emp, 'ActualSpecialAllowance', 'actualSpecialAllowance', 'SpecialAllowance', 'specialAllowance', 'Special Allowance');
              const attAllowance = getEmployeeNum(emp, 'AttendanceAllowance', 'attendanceAllowance', 'Attendance Allowance');
              const totalSalary = getEmployeeNum(emp, 'TotalSalary', 'totalSalary', 'Total Salary', 'Total Salary (Auto-calculated)');
              setEmpMaps(empCode, hra, da, basic, special, attAllowance);
              setEmpMaps(normalizeEmployeeCode(empCode), hra, da, basic, special, attAllowance);
              if (/^\d+$/.test(empCode)) {
                setEmpMaps(String(parseInt(empCode)), hra, da, basic, special, attAllowance);
              }
              const pfStatusVal = String(emp.PFStatus ?? emp.pfStatus ?? '').trim().toLowerCase();
              const uanVal = pickUanNoFromRecord(emp);
              const esicVal = pickEsicNoFromRecord(emp);
              [empCode, normalizeEmployeeCode(empCode), /^\d+$/.test(empCode) ? String(parseInt(empCode)) : null]
                .filter(Boolean)
                .forEach((code) => {
                  employeeTotalSalaryMap[code] = totalSalary;
                  pfStatusMap[code] = pfStatusVal;
                  uanNoMap[code] = uanVal;
                  esicNoMap[code] = esicVal;
                });
            }
          }
        }
      } catch (dateErr) {
        console.log('Error fetching DateofJoining/OtherAllowances:', dateErr.message);
        try {
          const employeeCodes = records.map(r => r.EmployeeCode).filter(Boolean);
          if (employeeCodes.length > 0) {
            const empCodesList = employeeCodes.map(code => `'${String(code).replace(/'/g, "''")}'`).join(',');
            const fallbackQuery = `SELECT EmployeeCode, EmployeeName, Department, DateofJoining, Designation, Category, AttendanceAllowance, OtherAllowance, RevisedOtherAllowance, ActualBasic, ActualHRA, ActualDA, SpecialAllowance, ActualSpecialAllowance, TotalSalary, PFStatus, UANNo, ESICNo FROM Employee WHERE EmployeeCode IN (${empCodesList})`;
            const fallbackRecords = await catalystApp.zcql().executeZCQLQuery(fallbackQuery);
            for (const row of fallbackRecords) {
              const emp = row.Employee;
              if (emp.EmployeeCode) {
                const dojRaw = emp.DateofJoining ?? emp.dateofjoining ?? emp.DateOfJoining;
                let dateOfJoining = '';
                if (dojRaw) {
                  const d = new Date(dojRaw);
                  if (!isNaN(d)) dateOfJoining = d.toISOString().slice(0, 10);
                }
                const empCode = String(emp.EmployeeCode);
                dateOfJoiningMap[empCode] = dateOfJoining;
                dateOfJoiningMap[normalizeEmployeeCode(empCode)] = dateOfJoining;
                if (/^\d+$/.test(empCode)) dateOfJoiningMap[String(parseInt(empCode))] = dateOfJoining;
                const desigFb = String(emp.Designation ?? emp.designation ?? '').trim();
                designationMap[empCode] = desigFb;
                designationMap[normalizeEmployeeCode(empCode)] = desigFb;
                if (/^\d+$/.test(empCode)) designationMap[String(parseInt(empCode))] = desigFb;
                const catFb = String(emp.Category ?? emp.category ?? '').trim();
                categoryMap[empCode] = catFb;
                categoryMap[normalizeEmployeeCode(empCode)] = catFb;
                if (/^\d+$/.test(empCode)) categoryMap[String(parseInt(empCode))] = catFb;
                putReportKeyedStringMap(employeeNameMap, empCode, emp.EmployeeName ?? emp.employeeName ?? emp.Name ?? emp.name);
                putReportKeyedStringMap(departmentMap, empCode, emp.Department ?? emp.department);
                const empOA = emp.OtherAllowances ?? emp.otherAllowances ?? emp.OtherAllowance ?? emp.otherAllowance ?? 0;
                const oaVal = Number(empOA) || 0;
                employeeOtherAllowancesMap[empCode] = oaVal;
                employeeOtherAllowancesMap[normalizeEmployeeCode(empCode)] = oaVal;
                if (/^\d+$/.test(empCode)) employeeOtherAllowancesMap[String(parseInt(empCode))] = oaVal;
                const hra = getEmployeeNum(emp, 'ActualHRA', 'actualHRA', 'Actual HRA');
                const da = getEmployeeNum(emp, 'ActualDA', 'actualDA', 'Actual DA');
                const basic = getEmployeeNum(emp, 'ActualBasic', 'actualBasic', 'Actual Basic');
                const special = getEmployeeNum(emp, 'ActualSpecialAllowance', 'actualSpecialAllowance', 'SpecialAllowance', 'specialAllowance', 'Special Allowance');
                const attAllowance = getEmployeeNum(emp, 'AttendanceAllowance', 'attendanceAllowance', 'Attendance Allowance');
                const totalSalary = getEmployeeNum(emp, 'TotalSalary', 'totalSalary', 'Total Salary', 'Total Salary (Auto-calculated)');
                const pfStatusFb = String(emp.PFStatus ?? emp.pfStatus ?? '').trim().toLowerCase();
                const uanValFb = pickUanNoFromRecord(emp);
                const esicValFb = pickEsicNoFromRecord(emp);
                [empCode, normalizeEmployeeCode(empCode), /^\d+$/.test(empCode) ? String(parseInt(empCode)) : null].filter(Boolean).forEach(code => {
                  employeeActualHRAMap[code] = hra;
                  employeeActualDAMap[code] = da;
                  employeeActualBasicMap[code] = basic;
                  employeeSpecialAllowanceMap[code] = special;
                  employeeAttendanceAllowanceMap[code] = attAllowance;
                  employeeTotalSalaryMap[code] = totalSalary;
                  pfStatusMap[code] = pfStatusFb;
                  uanNoMap[code] = uanValFb;
                  esicNoMap[code] = esicValFb;
                });
              }
            }
          }
        } catch (fallbackErr) {
          console.log('Fallback DateofJoining query failed:', fallbackErr.message);
        }
      }

      // Helper to get Employee-code keys for lookup
      const empKeys = (ec) => [ec, normalizeEmployeeCode(ec), /^\d+$/.test(ec) ? String(parseInt(ec)) : null].filter(Boolean);
      const lookupPfStatus = (ec) => {
        for (const k of empKeys(ec)) {
          if (pfStatusMap[k] !== undefined) return pfStatusMap[k];
        }
        return '';
      };
      const fromEmployeeOrPayroll = (payrollVal, empMap, ec) => {
        const payNum = Number(payrollVal);
        if (payNum > 0) return payNum;
        for (const k of empKeys(ec)) {
          const v = empMap[k];
          if (v !== undefined && v !== null && Number(v) > 0) return Number(v);
        }
        return payNum >= 0 ? payNum : 0;
      };

      // Helper to map to frontend-friendly structure (use Employee form data when Payroll has no/zero value)
      const mapRow = (p) => {
        const contractorForRow = String(p.Contractor || p.contractor || '').replace(/\s+/g, ' ').trim().toLowerCase();
        const isYashaswiContractor = contractorForRow === 'yashaswi academy for skills';
        const ec = String(p.EmployeeCode || '');
        const actualBasic = fromEmployeeOrPayroll(p.ActualBasic, employeeActualBasicMap, ec);
        const actualHRA = fromEmployeeOrPayroll(p.ActualHRA, employeeActualHRAMap, ec);
        const actualDA = fromEmployeeOrPayroll(p.ActualDA, employeeActualDAMap, ec);
        const specialAllowance = fromEmployeeOrPayroll(p.SpecialAllowance, employeeSpecialAllowanceMap, ec);
        let otherAllowance = Number(p.OtherAllowance) || 0;
        if (otherAllowance <= 0) {
          for (const k of empKeys(ec)) {
            const v = employeeAttendanceAllowanceMap[k];
            if (v !== undefined && v !== null && Number(v) > 0) {
              otherAllowance = Number(v);
              break;
            }
          }
        }
        const payOA = Number(p.OtherAllowances) || 0;
        const otherAllowances = payOA > 0 ? payOA : (employeeOtherAllowancesMap[ec] ?? employeeOtherAllowancesMap[normalizeEmployeeCode(ec)] ?? employeeOtherAllowancesMap[String(parseInt(ec))] ?? 0);
        const travelChargersRow = Number(p.TravelChargers ?? p.travelChargers) || 0;
        let employeeTotalSalary = 0;
        for (const k of empKeys(ec)) {
          const v = employeeTotalSalaryMap[k];
          if (v !== undefined && v !== null && Number(v) > 0) {
            employeeTotalSalary = Number(v);
            break;
          }
        }
        const computedEmployeeFormTotalRow = computedEmployeeFormActualTotalSalary(actualBasic, actualHRA, actualDA, specialAllowance);
        const payrollActualTotalSalary = Number(p.ActualTotalSalary) || 0;
        const actualTotalSalary = employeeTotalSalary > 0 ? employeeTotalSalary : (payrollActualTotalSalary || computedEmployeeFormTotalRow);
        const desRow = designationMap[ec] ?? designationMap[normalizeEmployeeCode(ec)] ?? designationMap[String(parseInt(ec))] ?? '';
        const dimRow = Number(p.DaysInMonth) || 0;
        let daysPresentRow = (p.DaysPresent != null && String(p.DaysPresent).trim() !== '') ? (Number(p.DaysPresent) || 0) : 0;
        if (isManagingPartnerDesignation({ Designation: desRow }) && dimRow > 0) {
          daysPresentRow = dimRow;
        }
        const savedLopRow = Number(p.LOP) || 0;
        const lopRow = isManagingPartnerDesignation({ Designation: desRow }) && dimRow > 0 ? 0 : savedLopRow;
        const statutoryIdsReport = lookupEmployeeStatutoryMaps({ uanNoMap, esicNoMap }, ec);
        const employeeNameReport =
          String(p.EmployeeName ?? p.employeeName ?? '').trim() ||
          pickEmployeeKeyedMapValue(employeeNameMap, ec) ||
          '';
        const departmentReport =
          String(p.Department ?? p.department ?? '').trim() ||
          pickEmployeeKeyedMapValue(departmentMap, ec) ||
          '';
        const mappedRow = {
        employeeCode: p.EmployeeCode,
        employeeName: employeeNameReport,
        designation: desRow,
        department: departmentReport,
        category: (() => {
          const fromPayroll = String(p.Category ?? p.category ?? '').trim();
          if (fromPayroll) return fromPayroll;
          return categoryMap[ec] ?? categoryMap[normalizeEmployeeCode(ec)] ?? categoryMap[String(parseInt(ec))] ?? '';
        })(),
        contractor: p.Contractor || '',
        dateOfJoining: (() => {
          return dateOfJoiningMap[ec] ?? dateOfJoiningMap[normalizeEmployeeCode(ec)] ?? dateOfJoiningMap[String(parseInt(ec))] ?? '';
        })(),
        daysInMonth: dimRow,
        daysPresent: daysPresentRow,
        otHours: Number(p.OTHours) || 0,
        loh: Number(p.LOH) || 0,
        revisedLOH: lohHoursForLateDeduction(Number(p.LOH) || 0),
        actualBasic,
        actualHRA,
        actualDA,
        otherAllowance,
        specialAllowance,
        incentive: Number(p.Incentive) || 0,
        loanAllowance: Number(p.LoanAllowance ?? p.loanAllowance ?? p.Loanallowance) || 0,
        noOfDaysWithoutUniforms: Number(p.NoOfDaysWithoutUniforms ?? p.Noofdayswithoutuniforms ?? p.noofdayswithoutuniforms ?? p.Noofdayswithoutuniforms) || 0,
        otherAllowances,
        actualTotalSalary,
        earnedBasic: Number(p.EarnedBasic) || 0,
        earnedHRA: Number(p.EarnedHRA) || 0,
        earnedDA: Number(p.EarnedDA) || 0,
        earnedSpecialAllowance: Number(p.EarnedSpecialAllowance) || 0,
        arrear: Number(p.Arrear) || 0,
        arrearForPF: Number(p.ArrearForPF) || 0,
        lop: lopRow,
        earnedSalaryCross: Number(p.EarnedSalaryCross) || 0,
        pfStatus: lookupPfStatus(ec),
        pf: (() => {
          if (isYashaswiContractor) return 0;
          if (lookupPfStatus(ec) === 'no') return 0;
          if (p.PF !== null && p.PF !== undefined && String(p.PF).trim() !== '') {
            return Number(p.PF) || 0;
          }
          const earnedBasicRow = Number(p.EarnedBasic) || 0;
          if (earnedBasicRow <= 0) return 0;
          if (earnedBasicRow > 15000) return 1800;
          return Math.round(earnedBasicRow * 0.12);
        })(),
        esi: (() => {
          if (isYashaswiContractor) return 0;
          const earnedBasicRow = Number(p.EarnedBasic) || 0;
          const otAmountRow = Number(p.OTAmount) || 0;
          const incentiveRow = Number(p.Incentive) || 0;
          const esiBaseList = earnedBasicRow + otAmountRow + incentiveRow;
          if (esiBaseList <= 0) return 0;
          return Math.round(esiBaseList * 0.0075);
        })(),
        employerEsi: isYashaswiContractor ? 0 : (Number(p.EmployerESI ?? p.employerEsi) || 0),
        esiContribution: Number(p.ESIContribution ?? p.esiContribution) || 0,
        employerLwf: month && month.endsWith('-12') ? 40 : (Number(p.EmployerLwf) || 0),
        totalDeduction: Number(p.TotalDeduction) || 0,
        netpay: Number(p.NetPay ?? p.Netpay) || 0,
        otAmount: Number(p.OTAmount) || 0,
        otArrearAmount: Number(p.OTArrearAmount) || 0,
        otEsi: Number(p.OTESI) || 0,
        otPayment: Number(p.OTPayment) || 0,
        payableAmount: Number(p.PayableAmount) || 0,
        otWages: Number(p.OTWages) || 0,
        rent: Number(p.Rent) || 0,
        advance: Number(p.Advance) || 0,
        lwf: (month && month.endsWith('-12')) ? 20 : (Number(p.LWF) || 0), // December: LWF always 20 for all employees
        pt: isYashaswiContractor ? 0 : (() => {
          const savedPT = Number(p.PT);
          if (savedPT > 0) return savedPT;
          const earnedCross = Number(p.EarnedSalaryCross) || 0;
          if (earnedCross >= 20001 && earnedCross <= 30000) return 172;
          if (earnedCross >= 30001 && earnedCross <= 45000) return 430;
          if (earnedCross >= 45001 && earnedCross <= 60000) return 856;
          if (earnedCross >= 60001 && earnedCross <= 75000) return 1250;
          if (earnedCross >= 75001) return 1250;
          return 0;
        })(),
        netPay: (() => {
          const stored = Number(p.NetPay) || 0;
          if (!isYashaswiContractor) return stored;
          const earned = Number(p.EarnedSalaryCross) || 0;
          const other = Number(p.OtherDeduction) || 0;
          const lwfVal = (month && month.endsWith('-12')) ? 20 : (Number(p.LWF) || 0); // December: LWF always 20
          const rentVal = Number(p.Rent) || 0;
          const advVal = Number(p.Advance) || 0;
          return Math.round(earned - other - lwfVal - rentVal - advVal);
        })(),
        totalNetPayable: Number(p.TotalNetPayable) || 0,
        admin: isYashaswiContractor ? 0 : (Number(p.Admin) || 0),
        edli: isYashaswiContractor ? 0 : (Number(p.EDLI) || 0),
        erpf: isYashaswiContractor ? 0 : (Number(p.ERPF ?? p.erpf) || 0),
        erpf13: isYashaswiContractor ? 0 : (Number(p.ERPF13 ?? p.erpf13) || 0),
        // Total = Earned Gross + (ERPF 12% + Admin 0.5% + EDLI 0.5%) + Service Charge + Employer ESI + Employer LWF. For Yashaswi: ERPF12+Admin+EDLI=0, Employer ESI=0, Service Charge=1000
        total: (() => {
          const stored = Number(p.Total) || 0;
          if (!isYashaswiContractor) return stored;
          const earned = Number(p.EarnedSalaryCross) || 0;
          const serviceCharge = 1000;
          const employerLwfVal = month && month.endsWith('-12') ? 40 : (Number(p.EmployerLwf) || 0);
          return Math.round(earned + serviceCharge + employerLwfVal);
        })(),
        gst: isYashaswiContractor ? 0 : (Number(p.GST) || 0),
        netTotal: (() => {
          const stored = Number(p.NetTotal) || 0;
          if (!isYashaswiContractor) return stored;
          const earned = Number(p.EarnedSalaryCross) || 0;
          const serviceCharge = 1000;
          const employerLwfVal = month && month.endsWith('-12') ? 40 : (Number(p.EmployerLwf) || 0);
          return Math.round(earned + serviceCharge + employerLwfVal); // GST = 0 for Yashaswi so netTotal = total
        })(),
        attendanceBonus: (() => {
          const savedRaw = p.AttendanceBonus ?? p.attendanceBonus;
          if (savedRaw != null && savedRaw !== undefined && String(savedRaw).trim() !== '') {
            const saved = Number(savedRaw);
            if (Number.isFinite(saved)) return saved;
          }
          const doj = dateOfJoiningMap[ec] ?? dateOfJoiningMap[normalizeEmployeeCode(ec)] ?? dateOfJoiningMap[String(parseInt(ec))] ?? '';
          return calcAttendanceBonus(doj, daysPresentRow, dimRow, month);
        })(),
        foodAllowance: Number(p.FoodAllowance ?? p.foodAllowance) || 0,
        uniformAllowance: 0,
        washingAllowance: Number(p.WashingAllowance ?? p.washingAllowance) || 0,
        travelChargers: Number(p.TravelChargers ?? p.travelChargers) || 0,
        uanNo: statutoryIdsReport.uan || pickUanNoFromRecord(p),
        esicNo: statutoryIdsReport.esic || pickEsicNoFromRecord(p),
      };
        // Preserve Setup/custom Payroll columns (e.g. Attendance Deduction) so payslip deductions resolve by label.
        mergeSavedPayrollCustomColumnsIntoResultRow(mappedRow, p);
        applyEmployeeStatutoryIdsToPayrollRow(mappedRow, {
          UANNo: statutoryIdsReport.uan,
          ESICNo: statutoryIdsReport.esic,
        });
        return mappedRow;
      };

      let data = records.map(mapRow);

      // Check if user is restricted and month is Aug-Oct (2025-08, 2025-09, 2025-10)
      // For restricted users, set all numeric columns to 0 for these months
      const restrictedEmails = [
        'afrindinusha@gmail.com',
        'rpdmanpowerservice@gmail.com',
        'afrindinusha29@gmail.com',
        'sriramenterprises50@yahoo.com',
        'afrinatlin@gmail.com',
        'samuelenterprisesms@gmail.com',
        'dinushaafrin@gmail.com',
        'vijaybalaji701@gmail.com',
        'afrindinu14@gmail.com',
        'vaishnavi.a@buildhr.co.in'
      ];
      const restrictedMonths = ['2025-07', '2025-08', '2025-09', '2025-10'];
     
      if (userEmail && restrictedEmails.includes(userEmail) && restrictedMonths.includes(month)) {
        console.log(`⚠️ Restricted user ${userEmail} accessing report for ${month} - returning zeros for all columns`);
        // Set all numeric columns to 0 while preserving employee info
        data = data.map(emp => ({
          ...emp,
          daysInMonth: 0,
          daysPresent: 0,
          otHours: 0,
          loh: 0,
          actualBasic: 0,
          actualHRA: 0,
          actualDA: 0,
          otherAllowance: 0,
          incentive: 0,
          otherAllowances: 0,
          actualTotalSalary: 0,
          earnedBasic: 0,
          earnedHRA: 0,
          earnedDA: 0,
          arrear: 0,
          arrearForPF: 0,
          lop: 0,
          earnedSalaryCross: 0,
          pf: 0,
          esi: 0,
          employerEsi: 0,
          esiContribution: 0,
          totalDeduction: 0,
          otAmount: 0,
          otArrearAmount: 0,
          otEsi: 0,
          otPayment: 0,
          payableAmount: 0,
          otWages: 0,
          rent: 0,
          advance: 0,
          netPay: 0,
          totalNetPayable: 0
        }));
      }

      // For December months, set LWF to 20 rupees for all employees
      if (month.endsWith('-12')) {
        console.log(`Setting LWF to 20 rupees and Employer LWF to 40 rupees for all employees in December month ${month}`);
        data = data.map(emp => ({
          ...emp,
          lwf: 20,
          employerLwf: 40
        }));
      }

      // Report endpoint ONLY returns saved data from Payroll table
      // No fallback to calculated data - if no saved data exists, return empty array
      // This ensures that only explicitly saved payroll reports are shown in the report page
      console.log(`Payroll report: Returning ${data.length} saved records for month ${month}`);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'success', month, count: data.length, data }));
    } catch (err) {
      console.error('Payroll report endpoint error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Deduction file upload endpoint
  if (pathname === '/deduction/upload') {
    try {
      const catalystApp = catalyst.initialize(req);
      const deductionType = query.type; // 'Rent' or 'Advance'
 
      console.log('Deduction upload request:', {
        pathname,
        deductionType,
        query,
        availableTypes: Object.keys(DEDUCTION_FOLDER_IDS)
      });
 
      if (!deductionType || !DEDUCTION_FOLDER_IDS[deductionType]) {
        console.error('Invalid deduction type:', { deductionType, availableTypes: Object.keys(DEDUCTION_FOLDER_IDS) });
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid deduction type. Must be Rent or Advance.' }));
        return;
      }

      // Check if file was uploaded
      if (!req.files || !req.files.file) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No file uploaded.' }));
        return;
      }

      const file = req.files.file;
      const folderId = DEDUCTION_FOLDER_IDS[deductionType];
      const tempDir = os.tmpdir();
      const tempPath = path.join(tempDir, file.name);
 
      console.log('Deduction file upload:', { deductionType, folderId, fileName: file.name, fileSize: file.size });
 
      try {
        // Move file to temporary location
        await file.mv(tempPath);
   
        // Upload to File Store
        const uploadResp = await catalystApp.filestore().folder(folderId).uploadFile({
          code: fs.createReadStream(tempPath),
          name: file.name
        });

        // Clean up temporary file
        if (fs.existsSync(tempPath)) {
          fs.unlinkSync(tempPath);
        }

        // Handle different response structures
        let fileId, fileName;
        if (Array.isArray(uploadResp) && uploadResp[0]?.id) {
          fileId = uploadResp[0].id;
          fileName = file.name;
        } else if (uploadResp && uploadResp.id) {
          fileId = uploadResp.id;
          fileName = file.name;
        } else if (uploadResp && uploadResp.file_details && uploadResp.file_details[0]?.id) {
          fileId = uploadResp.file_details[0].id;
          fileName = file.name;
        } else {
          console.error('Unexpected upload response:', uploadResp);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'File upload failed or invalid response from Catalyst.' }));
          return;
        }

        console.log('Deduction file uploaded successfully:', { fileId, fileName, deductionType });
   
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'success',
          fileId,
          fileName,
          deductionType,
          message: `${deductionType} file uploaded successfully`
        }));
   
      } catch (uploadErr) {
        // Clean up temporary file in case of error
        if (fs.existsSync(tempPath)) {
          fs.unlinkSync(tempPath);
        }
        throw uploadErr;
      }
    } catch (err) {
      console.log('Deduction upload error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message || 'File upload failed.' }));
    }
    return;
  }

  // Import payroll data endpoint
  if (pathname === '/import') {
    try {
      const catalystApp = catalyst.initialize(req);
 
      // Parse the request body
      let body = '';
      req.on('data', chunk => {
        body += chunk.toString();
      });
 
      req.on('end', async () => {
        try {
          const requestData = JSON.parse(body);
          let { month, payrollData, userEmail } = requestData;
          const actingUserEmail = String(userEmail || '').trim();
     
          console.log('Import request (raw):', { month, recordCount: payrollData?.length });
     
          if (!month || !payrollData || !Array.isArray(payrollData)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing month or payroll data' }));
            return;
          }
         
          // Normalize month format to YYYY-MM (ensure consistent format)
          // Handle formats like "2025-12", "2025-12-01", "Dec-2025", etc.
          const normalizeMonth = (monthStr) => {
            if (!monthStr) return monthStr;
            const trimmed = String(monthStr).trim();
            // If already YYYY-MM format, return as is
            if (/^\d{4}-\d{2}$/.test(trimmed)) {
              return trimmed;
            }
            // If YYYY-MM-DD format, extract YYYY-MM
            const ymdMatch = trimmed.match(/^(\d{4})-(\d{2})-\d{2}/);
            if (ymdMatch) {
              return `${ymdMatch[1]}-${ymdMatch[2]}`;
            }
            // Try parsing as date
            const date = new Date(trimmed);
            if (!isNaN(date.getTime())) {
              const year = date.getFullYear();
              const monthNum = String(date.getMonth() + 1).padStart(2, '0');
              return `${year}-${monthNum}`;
            }
            return trimmed; // Return as is if can't parse
          };
         
          month = normalizeMonth(month);
          console.log('Import request (normalized month):', { month, recordCount: payrollData?.length });
         
          // Validate month format
          if (!/^\d{4}-\d{2}$/.test(month)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: `Invalid month format: ${month}. Expected format: YYYY-MM (e.g., 2025-12)` }));
            return;
          }

          /** Normalize allowance fields on every row before SamplePayroll (manual) and Payroll loops — both must see the same values. */
          const normalizeImportPayrollPayloadRecord = (record) => {
            if (!record || typeof record !== 'object') return;
            applyRevisedLohToPayrollRow(record);
            const oaImported = pickPayrollField(
              record,
              'otherAllowance',
              'OtherAllowance',
              'attendanceAllowance',
              'AttendanceAllowance'
            );
            record.otherAllowance =
              oaImported !== undefined && oaImported !== null && String(oaImported).trim() !== ''
                ? Number(oaImported) || 0
                : Number(record.otherAllowance) || 0;
            const oasImported = pickPayrollField(record, 'otherAllowances', 'OtherAllowances');
            record.otherAllowances =
              oasImported !== undefined && oasImported !== null && String(oasImported).trim() !== ''
                ? Number(oasImported) || 0
                : Number(record.otherAllowances) || 0;
          };
          for (const rec of payrollData) normalizeImportPayrollPayloadRecord(rec);

          // When Manual mode is ON, mirror import rows into SamplePayroll too.
          // Do not return early: always continue and save to Payroll so frontend refresh can load from Payroll table.
          const payrollModeFlags = await getLatestAutomaticModeFlags(catalystApp, month);
          if (payrollModeFlags.manual) {
            const sampleTable = await getSamplePayrollTable(catalystApp);
            let sampleSuccess = 0;
            let sampleErrors = 0;
            const sampleErrorList = [];
            if (!sampleTable) {
              console.log('Manual mode is ON but SamplePayroll table is not available. Continuing with Payroll import only.');
            } else {
              await clearSamplePayrollImportTargetsForMonth(sampleTable, month, payrollData);
              for (const record of payrollData) {
                try {
                  const baseRow = {
                    EmployeeCode: String(record.employeeCode ?? '').trim(),
                    EmployeeName: String(record.employeeName ?? '').trim(),
                    Department: String(record.department ?? '').trim(),
                    DaysInMonth: String(record.daysInMonth ?? ''),
                    DaysPresent: String(record.daysPresent ?? ''),
                    OTHours: String(record.otHours ?? ''),
                    LOH: String(record.loh ?? record.LOH ?? ''),
                    ActualBasic: String(record.actualBasic ?? ''),
                    OtherAllowance: String(Number(record.otherAllowance ?? 0) || 0),
                    TravelChargers: String(Number(record.travelChargers ?? record.TravelChargers ?? 0) || 0)
                  };
                  const monthVal = String(month ?? '');
                  const withIncentiveAndMonth = {
                    ...baseRow,
                    Incentive: String(record.incentive ?? record.Incentive ?? ''),
                    Month_filter: monthVal,
                    month_filter: monthVal,
                    MonthFilter: monthVal
                  };
                  const withMonthOnly = { ...baseRow, Month_filter: monthVal };
                  const withIncentiveOnly = {
                    ...baseRow,
                    Incentive: String(record.incentive ?? record.Incentive ?? '')
                  };
                  if (!baseRow.EmployeeCode) {
                    throw new Error('EmployeeCode is required');
                  }
                  try {
                    await insertSamplePayrollRowCascade(sampleTable, withIncentiveAndMonth);
                  } catch (insErr1) {
                    try {
                      await insertSamplePayrollRowCascade(sampleTable, withMonthOnly);
                    } catch (insErr2) {
                      try {
                        await insertSamplePayrollRowCascade(sampleTable, withIncentiveOnly);
                      } catch (insErr3) {
                        await insertSamplePayrollRowCascade(sampleTable, baseRow);
                      }
                    }
                  }
                  sampleSuccess++;
                } catch (recErr) {
                  sampleErrors++;
                  sampleErrorList.push({
                    employeeCode: record.employeeCode,
                    employeeName: record.employeeName,
                    error: recErr.message || String(recErr)
                  });
                  console.error('SamplePayroll import row error:', recErr);
                }
              }
              console.log(`SamplePayroll import done: ${sampleSuccess} ok, ${sampleErrors} errors (Manual mode)`);
            }
          }

          // Get or create the Payroll table
          let payrollTable;
          try {
            payrollTable = catalystApp.datastore().table('Payroll');
            // Test if table exists by trying to get a row
            await payrollTable.getAllRows({ maxRecords: 1 });
            console.log('Payroll table exists');
          } catch (tableErr) {
            console.log('Payroll table does not exist, creating it...', tableErr.message);
            try {
              // Create the Payroll table with all necessary columns
              // All columns are text type to match the actual table schema
              payrollTable = await catalystApp.datastore().table('Payroll', {
                columns: [
                  { name: 'Month_filter', dataType: 'string' },
                  { name: 'EmployeeCode', dataType: 'string' },
                  { name: 'EmployeeName', dataType: 'string' },
                  { name: 'Department', dataType: 'string' },
                  { name: 'Contractor', dataType: 'string' },
                  { name: 'DaysInMonth', dataType: 'string' },
                  { name: 'DaysPresent', dataType: 'string' },
                  { name: 'OTHours', dataType: 'string' },
                  { name: 'LOH', dataType: 'string' },
                  { name: 'ActualBasic', dataType: 'string' },
                  { name: 'ActualHRA', dataType: 'string' },
                  { name: 'ActualDA', dataType: 'string' },
                  { name: 'OtherAllowance', dataType: 'string' },
                  { name: 'SpecialAllowance', dataType: 'string' },
                  { name: 'Incentive', dataType: 'string' },
                  { name: 'LoanAllowance', dataType: 'string' },
                  { name: 'NoOfDaysWithoutUniforms', dataType: 'string' },
                  { name: 'OtherAllowances', dataType: 'string' },
                  { name: 'ActualTotalSalary', dataType: 'string' },
                  { name: 'EarnedBasic', dataType: 'string' },
                  { name: 'EarnedHRA', dataType: 'string' },
                  { name: 'EarnedDA', dataType: 'string' },
                  { name: 'EarnedSpecialAllowance', dataType: 'string' },
                  { name: 'AttendanceAllowance', dataType: 'string' },
                  { name: 'EarnedAttendanceAllowance', dataType: 'string' },
                  { name: 'EarnedOtherAllowances', dataType: 'string' },
                  { name: 'Arrear', dataType: 'string' },
                  { name: 'ArrearForPF', dataType: 'string' },
                  { name: 'LOP', dataType: 'string' },
                  { name: 'EarnedSalaryCross', dataType: 'string' },
                  { name: 'PF', dataType: 'string' },
                  { name: 'ESI', dataType: 'string' },
                  { name: 'EmployerESI', dataType: 'string' },
                  { name: 'ESIContribution', dataType: 'string' },
                  { name: 'TotalDeduction', dataType: 'string' },
                  { name: 'OTAmount', dataType: 'string' },
                  { name: 'OTArrearAmount', dataType: 'string' },
                  { name: 'OTESI', dataType: 'string' },
                  { name: 'OTPayment', dataType: 'string' },
                  { name: 'PayableAmount', dataType: 'string' },
                  { name: 'OTWages', dataType: 'string' },
                  { name: 'Rent', dataType: 'string' },
                  { name: 'Advance', dataType: 'string' },
                  { name: 'LWF', dataType: 'string' },
                  { name: 'PT', dataType: 'string' },
                  { name: 'NetPay', dataType: 'string' },
                  { name: 'TotalNetPayable', dataType: 'string' },
                  { name: 'ERPF', dataType: 'string' },
                  { name: 'Admin', dataType: 'string' },
                  { name: 'EDLI', dataType: 'string' },
                  { name: 'ERPF13', dataType: 'string' },
                  { name: 'ServiceCharge', dataType: 'string' },
                  { name: 'Total', dataType: 'string' },
                  { name: 'GST', dataType: 'string' },
                  { name: 'NetTotal', dataType: 'string' },
                  { name: 'Bonus', dataType: 'string' },
                  { name: 'BankHolderName', dataType: 'string' },
                  { name: 'BankName', dataType: 'string' },
                  { name: 'IFSCCode', dataType: 'string' },
                  { name: 'BankBranch', dataType: 'string' },
                  { name: 'Added_User', dataType: 'string' },
                  { name: 'Modified_User', dataType: 'string' }
                ]
              });
              console.log('Payroll table created successfully with text columns');
            } catch (createErr) {
              console.error('Failed to create Payroll table:', createErr);
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Failed to create Payroll table: ' + createErr.message }));
              return;
            }
          }
     
          let successCount = 0;
          let errorCount = 0;
          const errors = [];
     
          // Fetch PFStatus, ESIStatus, and EmployeeStatus for all employees being imported
          const importPfStatusMap = {};
          const importEsiStatusMap = {};
          const importEmployeeStatusMap = {};
          const importUnitMap = {};
          try {
            const employeeCodes = payrollData.map(r => r.employeeCode).filter(Boolean);
            if (employeeCodes.length > 0) {
              const empCodesList = employeeCodes.map(code => `'${code}'`).join(',');
              const statusQuery = `SELECT EmployeeCode, PFStatus, ESIStatus, employeeStatus, RelevantExperience FROM Employee WHERE EmployeeCode IN (${empCodesList})`;
              const statusRecords = await catalystApp.zcql().executeZCQLQuery(statusQuery);
              for (const row of statusRecords) {
                const emp = row.Employee;
                if (emp.EmployeeCode) {
                  const ec = String(emp.EmployeeCode);
                  importPfStatusMap[ec] = String(emp.PFStatus || '').trim().toLowerCase();
                  importEsiStatusMap[ec] = String(emp.ESIStatus || '').trim().toLowerCase();
                  importEmployeeStatusMap[ec] = String(emp.EmployeeStatus || '').trim();
                  const uImp = String(emp.RelevantExperience ?? emp.relevantExperience ?? '').trim();
                  importUnitMap[ec] = uImp;
                  importUnitMap[normalizeEmployeeCode(ec)] = uImp;
                  if (/^\d+$/.test(ec)) importUnitMap[String(parseInt(ec, 10))] = uImp;
                }
              }
              console.log(`Fetched PFStatus, ESIStatus, EmployeeStatus, and Unit for ${Object.keys(importPfStatusMap).length} employees during import`);
            }
          } catch (statusErr) {
            console.log('Error fetching PFStatus/ESIStatus/EmployeeStatus during import, will use imported values:', statusErr.message);
          }

          const importPayrollFormulae = await getPayrollFormulae(catalystApp);
          const importTotalDeductionFormula = Array.isArray(importPayrollFormulae) && importPayrollFormulae.find((f) => String(f.variable).trim().toLowerCase() === 'total deduction');

          /** Import payload wins (including 0); do not keep old DB numbers when the file sends 0. */
          const getImportOverwriteNumStr = (newVal, existingVal) => {
            if (newVal === undefined || newVal === null) {
              const existingNum = Number(existingVal);
              return String(Number.isFinite(existingNum) ? existingNum : 0);
            }
            if (newVal === '') {
              const existingNum = Number(existingVal);
              return String(Number.isFinite(existingNum) ? existingNum : 0);
            }
            const newNum = Number(newVal);
            if (!Number.isFinite(newNum)) {
              const existingNum = Number(existingVal);
              return String(Number.isFinite(existingNum) ? existingNum : 0);
            }
            return String(newNum);
          };
     
          // Process each payroll record
          for (const record of payrollData) {
            try {
              console.log(`Processing record for employee ${record.employeeCode}:`, {
                employeeCode: record.employeeCode,
                employeeName: record.employeeName,
                actualBasic: record.actualBasic,
                actualHRA: record.actualHRA,
                otherAllowance: record.otherAllowance,
                netPay: record.netPay
              });
         
              // Check PFStatus and ESIStatus and override values if applicable
              const empCodeStr = String(record.employeeCode || '');
              const unitFromFile = String(record.unit ?? record.Unit ?? '').trim();
              const unitFromEmp =
                importUnitMap[empCodeStr] ||
                importUnitMap[normalizeEmployeeCode(empCodeStr)] ||
                (/^\d+$/.test(empCodeStr.trim()) ? importUnitMap[String(parseInt(empCodeStr.trim(), 10))] : '') ||
                '';
              record.unit = unitFromFile || unitFromEmp || '';
              const pfStatus = importPfStatusMap[empCodeStr] || '';
              const isPfApplicable = pfStatus !== 'no';
              const esiStatus = importEsiStatusMap[empCodeStr] || '';
              const actualTotalSalaryImport =
                (Number(record.actualBasic) || 0) +
                (Number(record.actualHRA) || 0) +
                (Number(record.actualDA) || 0) +
                (Number(record.otherAllowance) || 0) +
                (Number(record.otherAllowances) || 0) +
                (Number(record.travelChargers) || 0) +
                (Number(record.specialAllowance) || 0);
              // ESI: if status is 'no' not applicable; if 'yes' calculate regardless; else use period rules (Apr-Sep / Oct-Mar)
              let isEsiApplicable;
              if (esiStatus === 'no') {
                isEsiApplicable = false;
              } else if (esiStatus === 'yes') {
                isEsiApplicable = true;
              } else {
                isEsiApplicable = await checkESIPeriodEligibility(catalystApp, month, empCodeStr, actualTotalSalaryImport);
              }

              const contractorNameImportLowerEarly = String(record.contractor || '').trim().toLowerCase();
              const daysInMonthImport = Number(record.daysInMonth) || 31;
              const lateCtxImport = {
                'Earned Basic': Number(record.earnedBasic) || 0,
                'Earned HRA': Number(record.earnedHRA) || 0,
                'Earned DA': Number(record.earnedDA) || 0,
                'Earned Special Allowance': Number(record.earnedSpecialAllowance) || 0,
                'Earned Gross Salary': Number(record.earnedSalaryCross) || 0,
                'Actual Basic': Number(record.actualBasic) || 0,
                'Actual HRA': Number(record.actualHRA) || 0,
                'Actual DA': Number(record.actualDA) || 0,
                'Special Allowance': Number(record.specialAllowance) || 0,
                'LOH': lohHoursForLateDeduction(Number(record.loh) || 0),
                'Revised LOH': lohHoursForLateDeduction(Number(record.loh) || 0),
                'Days In Month': daysInMonthImport,
                'Days Present': Number(record.daysPresent) || 0,
                'No. of Days(In month)': daysInMonthImport,
                'No. of Days (In Month)': daysInMonthImport,
                'OT Hours': Number(record.otHours) || 0,
                'OT Amount': Number(record.otAmount) || 0,
                'Travel Charges': Number(record.travelChargers) || 0,
                'TravelChargers': Number(record.travelChargers) || 0
              };

              // PF: match payroll grid (Setup formula or Earned Basic + Earned Special). Stale record.pf from API was stored in Payroll/RunPayroll while UI recalculated in getPfDisplayValue.
              if (!isPfApplicable) {
                record.pf = 0;
                record.erpf = 0;
                record.admin = 0;
                record.edli = 0;
                record.erpf13 = 0;
                console.log(`Employee ${record.employeeCode}: PFStatus is "No", setting PF-related values to 0`);
              } else if (contractorNameImportLowerEarly === 'yashaswi academy for skills') {
                record.pf = 0;
                record.erpf = 0;
                record.admin = 0;
                record.edli = 0;
                record.erpf13 = 0;
              } else {
                const ebImp = Number(record.earnedBasic) || 0;
                const esImp = Number(record.earnedSpecialAllowance) || 0;
                const { pf: pfRecalculated, pfWages: pfWagesRec } = computePfLikePayrollUi(
                  importPayrollFormulae,
                  lateCtxImport,
                  ebImp,
                  esImp
                );
                record.pf = pfRecalculated;
                record.erpf = pfRecalculated;
                const adminRec = Math.round(pfWagesRec * 0.005);
                const edliRec = Math.round(pfWagesRec) === 15000 ? 75 : Math.round(pfWagesRec * 0.005);
                record.admin = adminRec;
                record.edli = edliRec;
                record.erpf13 = Math.round(pfRecalculated) + adminRec + edliRec;
              }
           
              // Override ESI-related values if ESI is not applicable
              if (!isEsiApplicable) {
                record.esi = 0;
                record.otEsi = 0;
                record.employerEsi = 0;
                console.log(`Employee ${record.employeeCode}: ESIStatus is "No", setting ESI-related values to 0`);
              }
           
              // Recalculate totalDeduction, netPay, and totals based on PF and ESI status (use Setup formula when defined)
              const pfValue = isPfApplicable ? (Number(record.pf) || 0) : 0;
              const esiValue = isEsiApplicable ? (Number(record.esi) || 0) : 0;
              const lwfValue = Number(record.lwf) || 0;
              const ptValue = Number(record.pt) || 0;
              const otherDeductionValue = Number(record.otherDeduction) || 0;
              const rentValue = Number(record.rent) || 0;
              const loanAllowanceImport = Number(record.loanAllowance) || 0;
              const lateAmountImport = getLateFromPayrollFormulae(importPayrollFormulae, lateCtxImport);
              if (importTotalDeductionFormula && importTotalDeductionFormula.expression) {
                const deductionContext = {
                  'PF': pfValue, 'ESI': esiValue, 'ESI 0.75%': esiValue,
                  'Loan Allowance': loanAllowanceImport, 'Food Allowance': 0, 'Food Allownace': 0,
                  'Uniform Allowance': 0, 'Late': lateAmountImport,
                  'Other Deduction': otherDeductionValue, 'LWF': lwfValue, 'PT': ptValue, 'Rent': rentValue, 'Rent Recovery': rentValue
                };
                record.totalDeduction = Math.round(evaluateFormulaExpression(importTotalDeductionFormula.expression, deductionContext));
              } else {
                record.totalDeduction = Math.round(pfValue + esiValue + loanAllowanceImport + lateAmountImport + otherDeductionValue + lwfValue + ptValue + rentValue);
              }
           
              // Recalculate netPay (Total Deduction already includes Rent Recovery)
              const earnedSalaryCross = Number(record.earnedSalaryCross) || 0;
              const otAmountImport = Number(record.otAmount) || 0;
              const advance = Number(record.advance) || 0;
              record.netPay = earnedSalaryCross - record.totalDeduction - advance; // Net Pay = Earned Gross - Total Deduction - Advance
           
              // Recalculate service charge: base = baseEarnedGross + ERPF 12% + Admin 0.5% + EDLI 0.5% + Employer ESI 3.25% + Employer LWF (do not include ESI Contribution)
              const contractorNameImport = String(record.contractor || '').trim();
              const contractorNameImportLower = contractorNameImport.toLowerCase();
              const specialImport = Number(record.specialAllowance) || 0;
              const otherImport = Number(record.otherAllowance) || Number(record.otherAllowances) || 0;
              const baseEarnedGrossImport = Math.max(0, earnedSalaryCross - otAmountImport - specialImport - otherImport);
              const erpf12PlusAdminPlusEdliImport = Number(record.erpf13) || 0; // erpf13 stores ERPF 12% + Admin 0.5% + EDLI 0.5%
              const employerEsiImport = Number(record.employerEsi) || 0;
              const employerLwfImport = Number(record.employerLwf) || 0;
              const serviceChargeBaseImport = Math.max(0, baseEarnedGrossImport + erpf12PlusAdminPlusEdliImport + employerEsiImport + employerLwfImport);
              let serviceCharge;
              if (contractorNameImportLower === 'yashaswi academy for skills') {
                serviceCharge = 1000;
              } else if (contractorNameImportLower === 'sriram enterprice' || contractorNameImportLower === 'sriram enterprise' || contractorNameImportLower === 'sriram enterprises') {
                serviceCharge = Math.round(serviceChargeBaseImport * 0.08);
              } else {
                serviceCharge = Math.round(serviceChargeBaseImport * 0.09);
              }
              record.serviceCharge = serviceCharge;
           
              // Recalculate totals
              const payableAmount = Number(record.payableAmount) || 0;
              const erpf12PlusAdminPlusEdliValue = isPfApplicable ? (Number(record.erpf13) || 0) : 0; // erpf13 stores ERPF 12% + Admin 0.5% + EDLI 0.5%
              record.total = earnedSalaryCross + erpf12PlusAdminPlusEdliValue + serviceCharge + (Number(record.employerEsi) || 0) + (Number(record.employerLwf) || 0) + (Number(record.esiContribution ?? record.ESIContribution) || 0); // Total = Earned Gross + ERPF 12% + Admin 0.5% + EDLI 0.5% + ... + ESI Contribution
              // Special case: If contractor is "Yashaswi Academy For Skills", GST = 0, otherwise calculate 18%
              record.gst = contractorNameImportLower === 'yashaswi academy for skills' ? 0 : Math.round(record.total * 0.18);
              record.netTotal = record.total + record.gst;
         
              // Check if record already exists for this month and employee (prefer latest ROWID)
              const escEmpCode = String(record.employeeCode ?? '').replace(/'/g, "''");
              const existingQuery = `SELECT * FROM Payroll WHERE Month_filter = '${month}' AND EmployeeCode = '${escEmpCode}' ORDER BY ROWID DESC LIMIT 1`;
              const existingRecords = await catalystApp.zcql().executeZCQLQuery(existingQuery);
         
              if (existingRecords.length > 0) {
                // Update existing record
                const existingRecord = existingRecords[0].Payroll;
             
                // Build update record with only valid column names (don't spread existingRecord)
                // All numeric values converted to strings since table columns are text type
                const updatedRecord = {
                  EmployeeName: String(record.employeeName || existingRecord.EmployeeName || ''),
                  Department: String(record.department || existingRecord.Department || ''),
                  Category: String(record.category ?? record.Category ?? existingRecord.Category ?? existingRecord.category ?? ''),
                  Contractor: String(record.contractor || existingRecord.Contractor || ''),
                  DaysInMonth: getImportOverwriteNumStr(record.daysInMonth, existingRecord.DaysInMonth),
                  DaysPresent: getImportOverwriteNumStr(record.daysPresent, existingRecord.DaysPresent),
                  OTHours: getImportOverwriteNumStr(record.otHours, existingRecord.OTHours),
                  LOH: getImportOverwriteNumStr(record.loh, existingRecord.LOH),
                  RevisedLOH: getImportOverwriteNumStr(
                    record.revisedLOH ?? record.RevisedLOH ?? lohHoursForLateDeduction(record.loh ?? record.LOH),
                    existingRecord.RevisedLOH ?? existingRecord.revisedLOH
                  ),
                  ActualBasic: getImportOverwriteNumStr(record.actualBasic, existingRecord.ActualBasic),
                  ActualHRA: getImportOverwriteNumStr(record.actualHRA, existingRecord.ActualHRA),
                  ActualDA: getImportOverwriteNumStr(record.actualDA, existingRecord.ActualDA),
                  OtherAllowance: getImportOverwriteNumStr(record.otherAllowance, existingRecord.OtherAllowance),
                  TravelChargers: getImportOverwriteNumStr(record.travelChargers, existingRecord.TravelChargers ?? existingRecord.travelChargers),
                  SpecialAllowance: getImportOverwriteNumStr(record.specialAllowance, existingRecord.SpecialAllowance),
                  Incentive: getImportOverwriteNumStr(record.incentive, existingRecord.Incentive),
                  LoanAllowance: getImportOverwriteNumStr(record.loanAllowance, existingRecord.LoanAllowance ?? existingRecord.loanAllowance ?? existingRecord.Loanallowance),
                  FoodAllowance: getImportOverwriteNumStr(record.foodAllowance, existingRecord.FoodAllowance ?? existingRecord.foodAllowance),
                  UniformAllowance: getImportOverwriteNumStr(record.uniformAllowance, existingRecord.UniformAllowance ?? existingRecord.uniformAllowance),
                  WashingAllowance: getImportOverwriteNumStr(record.washingAllowance, existingRecord.WashingAllowance ?? existingRecord.washingAllowance),
                  AttendanceBonus: getImportOverwriteNumStr(record.attendanceBonus, existingRecord.AttendanceBonus ?? existingRecord.attendanceBonus),
                  NoOfDaysWithoutUniforms: getImportOverwriteNumStr(record.noOfDaysWithoutUniforms, existingRecord.NoOfDaysWithoutUniforms ?? existingRecord.Noofdayswithoutuniforms ?? existingRecord.noofdayswithoutuniforms),
                  Noofdayswithoutuniforms: getImportOverwriteNumStr(record.noOfDaysWithoutUniforms, existingRecord.NoOfDaysWithoutUniforms ?? existingRecord.Noofdayswithoutuniforms ?? existingRecord.noofdayswithoutuniforms),
                  OtherAllowances: getImportOverwriteNumStr(record.otherAllowances, existingRecord.OtherAllowances),
                  ActualTotalSalary: String((Number(getImportOverwriteNumStr(record.actualBasic, existingRecord.ActualBasic)) || 0) +
                                            (Number(getImportOverwriteNumStr(record.actualHRA, existingRecord.ActualHRA)) || 0) +
                                            (Number(getImportOverwriteNumStr(record.actualDA, existingRecord.ActualDA)) || 0) +
                                            (Number(getImportOverwriteNumStr(record.otherAllowance, existingRecord.OtherAllowance)) || 0) +
                                            (Number(getImportOverwriteNumStr(record.otherAllowances, existingRecord.OtherAllowances)) || 0) +
                                            (Number(getImportOverwriteNumStr(record.travelChargers, existingRecord.TravelChargers ?? existingRecord.travelChargers)) || 0) +
                                            (Number(getImportOverwriteNumStr(record.specialAllowance, existingRecord.SpecialAllowance)) || 0)),
                  EarnedBasic: getImportOverwriteNumStr(record.earnedBasic, existingRecord.EarnedBasic),
                  EarnedHRA: getImportOverwriteNumStr(record.earnedHRA, existingRecord.EarnedHRA),
                  EarnedDA: getImportOverwriteNumStr(record.earnedDA, existingRecord.EarnedDA),
                  EarnedSpecialAllowance: getImportOverwriteNumStr(record.earnedSpecialAllowance, existingRecord.EarnedSpecialAllowance),
                  AttendanceAllowance: getImportOverwriteNumStr(record.earnedAttendanceAllowance, existingRecord.AttendanceAllowance),
                  EarnedAttendanceAllowance: getImportOverwriteNumStr(record.earnedAttendanceAllowance, existingRecord.EarnedAttendanceAllowance),
                  EarnedOtherAllowances: getImportOverwriteNumStr(record.earnedOtherAllowances, existingRecord.EarnedOtherAllowances),
                  Arrear: getImportOverwriteNumStr(record.arrear, existingRecord.Arrear),
                  ArrearForPF: getImportOverwriteNumStr(record.arrearForPF, existingRecord.ArrearForPF),
                  LOP: getImportOverwriteNumStr(record.lop, existingRecord.LOP),
                  EarnedSalaryCross: getImportOverwriteNumStr(record.earnedSalaryCross, existingRecord.EarnedSalaryCross),
                  PF: getImportOverwriteNumStr(record.pf, existingRecord.PF),
                  ESI: getImportOverwriteNumStr(record.esi, existingRecord.ESI),
                  EmployerESI: getImportOverwriteNumStr(record.employerEsi, existingRecord.EmployerESI),
                  ESIContribution: getImportOverwriteNumStr(record.esiContribution, existingRecord.ESIContribution),
                  TotalDeduction: getImportOverwriteNumStr(record.totalDeduction, existingRecord.TotalDeduction),
                  OTAmount: getImportOverwriteNumStr(record.otAmount, existingRecord.OTAmount),
                  OTArrearAmount: getImportOverwriteNumStr(record.otArrearAmount, existingRecord.OTArrearAmount),
                  OTESI: getImportOverwriteNumStr(record.otEsi, existingRecord.OTESI),
                  OTPayment: getImportOverwriteNumStr(record.otPayment, existingRecord.OTPayment),
                  PayableAmount: getImportOverwriteNumStr(record.payableAmount, existingRecord.PayableAmount),
                  OTWages: getImportOverwriteNumStr(record.otWages, existingRecord.OTWages),
                  Rent: getImportOverwriteNumStr(record.rent, existingRecord.Rent),
                  Advance: getImportOverwriteNumStr(record.advance, existingRecord.Advance),
                  LWF: month.endsWith('-12') ? '20' : getImportOverwriteNumStr(record.lwf, existingRecord.LWF),
                  PT: getImportOverwriteNumStr(record.pt, existingRecord.PT),
                  OtherDeduction: getImportOverwriteNumStr(record.otherDeduction, existingRecord.OtherDeduction),
                  NetPay: getImportOverwriteNumStr(
                    record.netPay !== undefined ? record.netPay : record.netpay,
                    existingRecord.NetPay !== undefined ? existingRecord.NetPay : existingRecord.Netpay
                  ),
                  TotalNetPayable: getImportOverwriteNumStr(record.totalNetPayable, existingRecord.TotalNetPayable),
                  ERPF: getImportOverwriteNumStr(record.erpf, existingRecord.ERPF),
                  Admin: getImportOverwriteNumStr(record.admin, existingRecord.Admin),
                  EDLI: getImportOverwriteNumStr(record.edli, existingRecord.EDLI),
                  ERPF13: getImportOverwriteNumStr(record.erpf13, existingRecord.ERPF13),
                  ServiceCharge: getImportOverwriteNumStr(record.serviceCharge, existingRecord.ServiceCharge),
                  Total: getImportOverwriteNumStr(record.total, existingRecord.Total),
                  GST: getImportOverwriteNumStr(record.gst, existingRecord.GST),
                  NetTotal: getImportOverwriteNumStr(record.netTotal, existingRecord.NetTotal),
                  Bonus: getImportOverwriteNumStr(record.bonus, existingRecord.Bonus),
                  BankHolderName: String(record.bankHolderName !== undefined ? record.bankHolderName : (existingRecord.BankHolderName || '')),
                  BankName: String(record.bankName !== undefined ? record.bankName : (existingRecord.BankName || '')),
                  IFSCCode: String(record.ifscCode !== undefined ? record.ifscCode : (existingRecord.IFSCCode || '')),
                  BankBranch: String(record.bankBranch !== undefined ? record.bankBranch : (existingRecord.BankBranch || '')),
                  Added_User: String((existingRecord.Added_User ?? existingRecord.added_User ?? actingUserEmail) || ''),
                  Modified_User: String(actingUserEmail || existingRecord.Modified_User || existingRecord.modified_User || existingRecord.Added_User || existingRecord.added_User || '')
                };
             
                try {
                  await payrollTable.updateRow({
                    ROWID: existingRecord.ROWID,
                    ...updatedRecord
                  });
                  console.log(`Updated payroll record for employee ${record.employeeCode}`);
                } catch (updateErr) {
                  const updMsg = String(updateErr?.message || updateErr?.error || '');
                  if (updMsg.includes('EarnedAttendanceAllowance') || updMsg.includes('Invalid column name')) {
                    delete updatedRecord.EarnedAttendanceAllowance;
                    if (updMsg.includes('EarnedSpecialAllowance')) delete updatedRecord.EarnedSpecialAllowance;
                    await payrollTable.updateRow({
                      ROWID: existingRecord.ROWID,
                      ...updatedRecord
                    });
                    console.log(`Updated payroll record (without EarnedAttendanceAllowance/EarnedSpecialAllowance) for employee ${record.employeeCode}`);
                  } else if (updMsg.includes('EarnedSpecialAllowance')) {
                    delete updatedRecord.EarnedSpecialAllowance;
                    await payrollTable.updateRow({
                      ROWID: existingRecord.ROWID,
                      ...updatedRecord
                    });
                    console.log(`Updated payroll record (without EarnedSpecialAllowance) for employee ${record.employeeCode}`);
                  } else {
                    throw updateErr;
                  }
                }
              } else {
                // Insert new record
                // Helper function to safely convert to number, then to string (table columns are text type)
                const safeNumStr = (val) => {
                  const num = Number(val);
                  const result = (isNaN(num) || num === null || num === undefined) ? 0 : num;
                  return String(result);
                };
             
                // Build record with only valid column names, ensuring all values are strings
                const newRecord = {};
             
                // Set each field explicitly
                newRecord.Month_filter = String(month || '');
                newRecord.EmployeeCode = String(record.employeeCode || '');
                newRecord.EmployeeName = String(record.employeeName || '');
                newRecord.Department = String(record.department || '');
                newRecord.Category = String(record.category ?? record.Category ?? '');
                newRecord.Contractor = String(record.contractor || '');
                newRecord.DaysInMonth = safeNumStr(record.daysInMonth);
                newRecord.DaysPresent = safeNumStr(record.daysPresent);
                newRecord.OTHours = safeNumStr(record.otHours);
                newRecord.LOH = safeNumStr(record.loh);
                newRecord.RevisedLOH = safeNumStr(
                  record.revisedLOH ?? record.RevisedLOH ?? lohHoursForLateDeduction(record.loh ?? record.LOH)
                );
                newRecord.ActualBasic = safeNumStr(record.actualBasic);
                newRecord.ActualHRA = safeNumStr(record.actualHRA);
                newRecord.ActualDA = safeNumStr(record.actualDA);
                newRecord.OtherAllowance = safeNumStr(record.otherAllowance);
                newRecord.SpecialAllowance = safeNumStr(record.specialAllowance);
                newRecord.Incentive = safeNumStr(record.incentive);
                newRecord.LoanAllowance = safeNumStr(record.loanAllowance);
                newRecord.NoOfDaysWithoutUniforms = safeNumStr(record.noOfDaysWithoutUniforms);
                newRecord.Noofdayswithoutuniforms = safeNumStr(record.noOfDaysWithoutUniforms);
                newRecord.OtherAllowances = safeNumStr(record.otherAllowances);
                newRecord.TravelChargers = safeNumStr(record.travelChargers);
                newRecord.ActualTotalSalary = safeNumStr(
                  (Number(record.actualBasic) || 0) +
                    (Number(record.actualHRA) || 0) +
                    (Number(record.actualDA) || 0) +
                    (Number(record.otherAllowance) || 0) +
                    (Number(record.otherAllowances) || 0) +
                    (Number(record.travelChargers) || 0) +
                    (Number(record.specialAllowance) || 0)
                );
                newRecord.EarnedBasic = safeNumStr(record.earnedBasic);
                newRecord.EarnedHRA = safeNumStr(record.earnedHRA);
                newRecord.EarnedDA = safeNumStr(record.earnedDA);
                newRecord.EarnedSpecialAllowance = safeNumStr(record.earnedSpecialAllowance);
                newRecord.Arrear = safeNumStr(record.arrear);
                newRecord.ArrearForPF = safeNumStr(record.arrearForPF);
                newRecord.LOP = safeNumStr(record.lop);
                newRecord.EarnedSalaryCross = safeNumStr(record.earnedSalaryCross);
                newRecord.AttendanceAllowance = safeNumStr(record.earnedAttendanceAllowance);
                newRecord.EarnedAttendanceAllowance = safeNumStr(record.earnedAttendanceAllowance);
                newRecord.EarnedOtherAllowances = safeNumStr(record.earnedOtherAllowances);
                newRecord.PF = safeNumStr(record.pf);
                newRecord.ESI = safeNumStr(record.esi);
                newRecord.EmployerESI = safeNumStr(record.employerEsi);
                newRecord.ESIContribution = safeNumStr(record.esiContribution ?? 0);
                newRecord.TotalDeduction = safeNumStr(record.totalDeduction);
                newRecord.OTAmount = safeNumStr(record.otAmount);
                newRecord.OTArrearAmount = safeNumStr(record.otArrearAmount);
                newRecord.OTESI = safeNumStr(record.otEsi);
                newRecord.OTPayment = safeNumStr(record.otPayment);
                newRecord.PayableAmount = safeNumStr(record.payableAmount);
                newRecord.OTWages = safeNumStr(record.otWages);
                newRecord.Rent = safeNumStr(record.rent);
                newRecord.Advance = safeNumStr(record.advance);
                newRecord.LWF = month.endsWith('-12') ? safeNumStr(20) : safeNumStr(record.lwf);
                newRecord.EmployerLwf = month.endsWith('-12') ? safeNumStr(40) : safeNumStr(record.employerLwf || 0);
                newRecord.PT = safeNumStr(record.pt);
                newRecord.OtherDeduction = safeNumStr(record.otherDeduction);
                const netPayValue = record.netPay !== undefined ? record.netPay : record.netpay;
                newRecord.NetPay = safeNumStr(netPayValue);
                newRecord.TotalNetPayable = safeNumStr(record.totalNetPayable);
                newRecord.ERPF = safeNumStr(record.erpf);
                newRecord.Admin = safeNumStr(record.admin);
                newRecord.EDLI = safeNumStr(record.edli);
                newRecord.ERPF13 = safeNumStr(record.erpf13);
                newRecord.ServiceCharge = safeNumStr(record.serviceCharge);
                newRecord.Total = safeNumStr(record.total);
                newRecord.GST = safeNumStr(record.gst);
                newRecord.NetTotal = safeNumStr(record.netTotal);
                newRecord.Bonus = safeNumStr(record.bonus);
                newRecord.BankHolderName = String(record.bankHolderName || '');
                newRecord.BankName = String(record.bankName || '');
                newRecord.IFSCCode = String(record.ifscCode || '');
                newRecord.BankBranch = String(record.bankBranch || '');
                newRecord.Added_User = String(actingUserEmail || '');
                newRecord.Modified_User = String(actingUserEmail || '');
             
                // Remove any undefined or null values (shouldn't happen, but just in case)
                Object.keys(newRecord).forEach(key => {
                  if (newRecord[key] === undefined || newRecord[key] === null) {
                    newRecord[key] = '';
                  }
                });
             
                // Validate required fields before insert
                if (!newRecord.EmployeeCode || newRecord.EmployeeCode.trim() === '') {
                  throw new Error('EmployeeCode is required');
                }
                if (!newRecord.Month_filter || newRecord.Month_filter.trim() === '') {
                  throw new Error('Month_filter is required');
                }
             
                console.log(`Inserting new payroll record for employee ${record.employeeCode}:`, {
                  employeeCode: newRecord.EmployeeCode,
                  month: newRecord.Month_filter,
                  actualBasic: newRecord.ActualBasic,
                  daysPresent: newRecord.DaysPresent,
                  netPay: newRecord.NetPay
                });
             
                // Log all column names being inserted for debugging
                console.log(`Column names in newRecord:`, Object.keys(newRecord));
                console.log(`Total columns: ${Object.keys(newRecord).length}`);
             
                try {
                  await payrollTable.insertRow(newRecord);
                  console.log(`Successfully inserted new payroll record for employee ${record.employeeCode}`);
                } catch (insertErr) {
                  const errMsg = String(insertErr?.message || insertErr?.error || '');
                  if (errMsg.includes('EarnedAttendanceAllowance') || errMsg.includes('Invalid column name')) {
                    delete newRecord.EarnedAttendanceAllowance;
                    try {
                      await payrollTable.insertRow(newRecord);
                      console.log(`Successfully inserted (without EarnedAttendanceAllowance) for employee ${record.employeeCode}`);
                    } catch (retryErr) {
                      console.error(`Insert retry failed for employee ${record.employeeCode}:`, retryErr?.message);
                      throw retryErr;
                    }
                  } else {
                    console.error(`Insert error details for employee ${record.employeeCode}:`, {
                      error: insertErr,
                      message: insertErr.message,
                      code: insertErr.code,
                      statusCode: insertErr.statusCode,
                      recordKeys: Object.keys(newRecord),
                      recordValues: newRecord
                    });
                    throw insertErr;
                  }
                }
              }
         
              successCount++;
            } catch (recordError) {
              console.error(`Error processing record for employee ${record.employeeCode}:`, {
                error: recordError,
                message: recordError.message,
                code: recordError.code,
                statusCode: recordError.statusCode,
                recordData: {
                  employeeCode: record.employeeCode,
                  employeeName: record.employeeName,
                  month: month
                }
              });
              errorCount++;
              errors.push({
                employeeCode: record.employeeCode,
                employeeName: record.employeeName,
                error: recordError.message || String(recordError),
                code: recordError.code,
                statusCode: recordError.statusCode
              });
            }
          }
     
          console.log(`Import completed: ${successCount} successful, ${errorCount} errors`);

          // Mirror payroll run/save into RunPayroll table (grid snapshot — even if some Payroll rows failed)
          let runPayrollSync = { skipped: true };
          if (Array.isArray(payrollData) && payrollData.length > 0) {
            try {
              runPayrollSync = await syncRunPayrollFromPayrollImport(catalystApp, month, payrollData);
            } catch (runPayrollErr) {
              console.error('RunPayroll sync error (Payroll import still succeeded):', runPayrollErr?.message || runPayrollErr);
              runPayrollSync = { ok: false, error: runPayrollErr?.message || String(runPayrollErr) };
            }
            try {
              await syncPermissionReportFromPayrollMonth(catalystApp, month, payrollData);
            } catch (permissionReportErr) {
              console.error(
                'PermissionReport sync error (Payroll import still succeeded):',
                permissionReportErr?.message || permissionReportErr
              );
            }
          }
     
          // Verify the data was actually stored
          try {
            const monthEscaped = String(month || '').replace(/'/g, "''").trim();
            const verifyQuery = `SELECT * FROM Payroll WHERE Month_filter = '${monthEscaped}' LIMIT 1`;
            console.log(`Verification query: ${verifyQuery}`);
            console.log(`Verification - month value: "${monthEscaped}" (type: ${typeof monthEscaped}, length: ${monthEscaped.length})`);
            const verifyRecords = await catalystApp.zcql().executeZCQLQuery(verifyQuery);
            console.log(`Verification: Found ${verifyRecords.length} records in Payroll table for month ${monthEscaped}`);
            if (verifyRecords.length > 0) {
              console.log('Sample stored record Month_filter:', verifyRecords[0].Payroll.Month_filter);
              console.log('Sample stored record EmployeeCode:', verifyRecords[0].Payroll.EmployeeCode);
            } else {
              console.log(`⚠️ WARNING: No records found for month ${monthEscaped} after import!`);
              // Try to find any records with similar month values
              const allMonthsQuery = `SELECT DISTINCT Month_filter FROM Payroll LIMIT 20`;
              try {
                const allMonths = await catalystApp.zcql().executeZCQLQuery(allMonthsQuery);
                console.log('Available Month_filter values in database:', allMonths.map(r => r.Payroll?.Month_filter || r.Month_filter).filter(Boolean));
              } catch (e) {
                console.log('Could not fetch available months:', e.message);
              }
            }
          } catch (verifyErr) {
            console.log('Verification failed:', verifyErr.message);
          }
     
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            status: 'success',
            message: `Successfully imported ${successCount} payroll records for ${month}`,
            successCount,
            errorCount,
            runPayroll: runPayrollSync,
            errors: errors.length > 0 ? errors : undefined
          }));
     
        } catch (parseError) {
          console.error('Error parsing import request:', parseError);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid request data' }));
        }
      });
 
    } catch (err) {
      console.error('Import endpoint error:', err);
      console.error('Error stack:', err.stack);
      console.error('Error details:', {
        message: err.message,
        name: err.name,
        code: err.code
      });
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: err.message || 'Unknown error occurred while saving payroll data',
        details: process.env.NODE_ENV === 'development' ? err.stack : undefined
      }));
    }
    return;
  }

  // Update payroll record endpoint
  /**
   * Persist custom payroll columns from the edit modal (camelCase keys not in the fixed mapping).
   */
  function mergeUnmappedPayrollUpdateFields(targetRecord, updatedData) {
    const handled = new Set([
      'employeeName',
      'department',
      'contractor',
      'daysInMonth',
      'daysPresent',
      'otHours',
      'loh',
      'actualBasic',
      'actualHRA',
      'actualDA',
      'otherAllowance',
      'travelChargers',
      'specialAllowance',
      'incentive',
      'loanAllowance',
      'foodAllowance',
      'uniformAllowance',
      'washingAllowance',
      'attendanceBonus',
      'noOfDaysWithoutUniforms',
      'otherAllowances',
      'actualTotalSalary',
      'ActualTotalSalary',
      'earnedBasic',
      'earnedHRA',
      'earnedDA',
      'earnedSpecialAllowance',
      'earnedAttendanceAllowance',
      'earnedOtherAllowances',
      'arrear',
      'arrearForPF',
      'lop',
      'earnedSalaryCross',
      'earnedGrossSalary',
      'esiContribution',
      'totalDeduction',
      'otAmount',
      'otArrearAmount',
      'otEsi',
      'otPayment',
      'payableAmount',
      'otWages',
      'rent',
      'advance',
      'lwf',
      'employerLwf',
      'pt',
      'otherDeduction',
      'netPay',
      'netpay',
      'erpf13',
      'employerEsi',
      'bankHolderName',
      'bankName',
      'ifscCode',
      'bankBranch',
      'payslip',
      'employeeCode',
      'userEmail',
      'month',
      'designation',
      'unit',
      'dateOfJoining',
      'pfStatus',
      'esiStatus',
      'pf',
      'esi',
      'erpf',
      'admin',
      'edli',
      'totalNetPayable',
      'bonus',
      'late',
    ]);
    if (!updatedData || typeof updatedData !== 'object') return;
    for (const k of Object.keys(updatedData)) {
      if (handled.has(k)) continue;
      const raw = updatedData[k];
      if (raw === undefined) continue;
      if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) continue;
      let out = raw;
      if (raw !== null && raw !== '' && typeof raw !== 'boolean') {
        const n = Number(raw);
        if (!Number.isNaN(n) && String(raw).trim() !== '') out = n;
      }
      const pascal = k.length ? k.charAt(0).toUpperCase() + k.slice(1) : k;
      targetRecord[pascal] = out;
      targetRecord[k] = out;
    }
  }

  if (pathname === '/update') {
    try {
      const catalystApp = catalyst.initialize(req);
 
      // Parse the request body
      let body = '';
      req.on('data', chunk => {
        body += chunk.toString();
      });
 
      req.on('end', async () => {
        try {
          console.log('=== BACKEND UPDATE DEBUG START ===');
          console.log('Raw request body:', body);
     
          const requestData = JSON.parse(body);
          const { month, employeeCode, updatedData, userEmail } = requestData;
          const actingUserEmail = String(userEmail || '').trim();
     
          console.log('Parsed request data:', requestData);
          console.log('Month:', month);
          console.log('Employee Code:', employeeCode);
          console.log('Updated Data:', updatedData);
          console.log('Days Present being updated:', updatedData.daysPresent);
          console.log('OT Hours being updated:', updatedData.otHours);
          console.log('No of days without uniforms being updated:', updatedData.noOfDaysWithoutUniforms);
     
          if (!month || !employeeCode || !updatedData) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing month, employeeCode, or updatedData' }));
            return;
          }
     
          // Get or create the Payroll table (if it doesn't exist yet)
          let payrollTable;
          try {
            payrollTable = catalystApp.datastore().table('Payroll');
            // touch the table to ensure it exists
            await payrollTable.getAllRows({ maxRecords: 1 });
          } catch (tableErr) {
            console.log('Payroll table missing. Creating it before update...', tableErr.message);
            payrollTable = await catalystApp.datastore().table('Payroll', {
              columns: [
                { name: 'Month_filter', dataType: 'string' },
                { name: 'EmployeeCode', dataType: 'string' },
                { name: 'EmployeeName', dataType: 'string' },
                { name: 'Department', dataType: 'string' },
                { name: 'Contractor', dataType: 'string' },
                { name: 'DaysInMonth', dataType: 'string' },
                { name: 'DaysPresent', dataType: 'string' },
                { name: 'OTHours', dataType: 'string' },
                { name: 'LOH', dataType: 'string' },
                { name: 'ActualBasic', dataType: 'string' },
                { name: 'ActualHRA', dataType: 'string' },
                { name: 'ActualDA', dataType: 'string' },
                { name: 'OtherAllowance', dataType: 'string' },
                { name: 'SpecialAllowance', dataType: 'string' },
                { name: 'Incentive', dataType: 'string' },
                { name: 'LoanAllowance', dataType: 'string' },
                { name: 'NoOfDaysWithoutUniforms', dataType: 'string' },
                { name: 'ActualTotalSalary', dataType: 'string' },
                { name: 'EarnedBasic', dataType: 'string' },
                { name: 'EarnedHRA', dataType: 'string' },
                { name: 'EarnedSpecialAllowance', dataType: 'string' },
                { name: 'EarnedSalaryCross', dataType: 'string' },
                { name: 'PF', dataType: 'string' },
                { name: 'ESI', dataType: 'string' },
                { name: 'TotalDeduction', dataType: 'string' },
                { name: 'OTAmount', dataType: 'string' },
                { name: 'OTArrearAmount', dataType: 'string' },
                { name: 'OTESI', dataType: 'string' },
                { name: 'OTPayment', dataType: 'string' },
                { name: 'PayableAmount', dataType: 'string' },
                { name: 'OTWages', dataType: 'string' },
                { name: 'Rent', dataType: 'string' },
                { name: 'Advance', dataType: 'string' },
                { name: 'OtherDeduction', dataType: 'string' },
                { name: 'NetPay', dataType: 'string' },
                { name: 'TotalNetPayable', dataType: 'string' },
                { name: 'Payslip', dataType: 'string' },
                { name: 'Added_User', dataType: 'string' },
                { name: 'Modified_User', dataType: 'string' }
              ]
            });
          }
     
          // Find the existing record
          let existingRecords = [];
          try {
            const existingQuery = `SELECT * FROM Payroll WHERE Month_filter = '${month}' AND EmployeeCode = '${employeeCode}' ORDER BY ROWID DESC`;
            existingRecords = await catalystApp.zcql().executeZCQLQuery(existingQuery);
          } catch (selErr) {
            console.log('Error querying Payroll table. Proceeding with insert:', selErr.message);
            existingRecords = [];
          }
     
          // If not found, perform an insert (UPSERT behavior)
          if (existingRecords.length === 0) {
            // Insert a minimal row first, then update with full payload to avoid INVALID_INPUT issues
            const minimalRecord = {
              Month_filter: String(month),
              EmployeeCode: String(employeeCode)
            };
            let inserted;
            try {
              inserted = await payrollTable.insertRow(minimalRecord);
              console.log(`Inserted minimal payroll row for ${employeeCode}`, inserted);
            } catch (insErr) {
              console.error('Minimal insert failed:', insErr);
              throw insErr;
            }

            const rowId = inserted?.ROWID || inserted?.ROWID_VALUE || inserted?.ROWID || inserted?.row_id || inserted?.id;

            // Build a sanitized update payload
            const sanitizeNum = (v) => {
              const n = Number(v);
              return Number.isFinite(n) ? n : 0;
            };
            const earnedSalaryCrossMin = sanitizeNum(updatedData.earnedSalaryCross);
            const otAmountMin = sanitizeNum(updatedData.otAmount);
            const contractorMin = String(updatedData.contractor || '').trim().toLowerCase();
            const employerLwfMin = sanitizeNum(updatedData.employerLwf);
            const specialMin = sanitizeNum(updatedData.specialAllowance);
            const otherMin = sanitizeNum(updatedData.otherAllowance) || sanitizeNum(updatedData.otherAllowances);
            const baseEarnedGrossMin = Math.max(0, earnedSalaryCrossMin - otAmountMin - specialMin - otherMin);
            const esiContributionMin = sanitizeNum(updatedData.esiContribution ?? 0);
            // PF and ESI: recalculate from EARNED values only (never from Actual)
            const earnedBasicMin = sanitizeNum(updatedData.earnedBasic);
            const earnedSpecialAllowanceMin = sanitizeNum(updatedData.earnedSpecialAllowance);
            const earnedPlusSpecialMin = earnedBasicMin + earnedSpecialAllowanceMin;
            let pfMin = 0;
            let pfWagesMin = 0;
            let erpf13Min = 0;
            if (contractorMin !== 'yashaswi academy for skills' && earnedBasicMin > 0) {
              if (earnedBasicMin > 15000) {
                pfMin = 1800;
                pfWagesMin = 15000;
              } else {
                pfWagesMin = Math.min(15000, Math.max(0, earnedPlusSpecialMin));
                pfMin = Math.round(earnedBasicMin * 0.12);
              }
              const adminMin = Math.round(pfWagesMin * 0.005);
              const edliMin = Math.round(pfWagesMin) === 15000 ? 75 : Math.round(pfWagesMin * 0.005);
              erpf13Min = pfMin + adminMin + edliMin;
            }
            const earnedHRAMin = sanitizeNum(updatedData.earnedHRA);
            const travelChargersMin = sanitizeNum(updatedData.travelChargers);
            const esiBaseMin = earnedBasicMin + earnedHRAMin + earnedSpecialAllowanceMin + otAmountMin + travelChargersMin;
            let esiMin = 0;
            let employerEsiRecalcMin = 0;
            if (contractorMin !== 'yashaswi academy for skills' && esiBaseMin > 0) {
              esiMin = Math.ceil(esiBaseMin * 0.0075);
              employerEsiRecalcMin = Math.round(earnedSalaryCrossMin * 0.0325);
            }
            const serviceChargeBaseMin = Math.max(0, baseEarnedGrossMin + erpf13Min + employerEsiRecalcMin + employerLwfMin); // base + ERPF + Employer ESI + Employer LWF (earned-based only)
            let serviceChargeMin;
            if (contractorMin === 'yashaswi academy for skills') serviceChargeMin = 1000;
            else if (contractorMin === 'sriram enterprice' || contractorMin === 'sriram enterprise' || contractorMin === 'sriram enterprises') serviceChargeMin = Math.round(serviceChargeBaseMin * 0.08);
            else serviceChargeMin = Math.round(serviceChargeBaseMin * 0.09);
            const totalMin = Math.round(earnedSalaryCrossMin) + Math.round(erpf13Min) + serviceChargeMin + Math.round(employerEsiRecalcMin) + Math.round(employerLwfMin) + Math.round(esiContributionMin); // Total = Earned Gross + ERPF 12% + Admin 0.5% + EDLI 0.5% + Service Charge + ... + ESI Contribution
            const gstMin = contractorMin === 'yashaswi academy for skills' ? 0 : Math.round(totalMin * 0.18);
            const netTotalMin = totalMin + gstMin;

            const providedActualTotalSalaryMinRaw = updatedData.actualTotalSalary ?? updatedData.ActualTotalSalary;
            const providedActualTotalSalaryMin = (providedActualTotalSalaryMinRaw !== undefined && providedActualTotalSalaryMinRaw !== null && providedActualTotalSalaryMinRaw !== '' && Number.isFinite(Number(providedActualTotalSalaryMinRaw)))
              ? Number(providedActualTotalSalaryMinRaw)
              : null;
            const computedActualTotalSalaryMin =
              sanitizeNum(updatedData.actualBasic) +
              sanitizeNum(updatedData.actualHRA) +
              sanitizeNum(updatedData.actualDA) +
              sanitizeNum(updatedData.specialAllowance);
            const actualTotalSalaryMin = providedActualTotalSalaryMin !== null ? providedActualTotalSalaryMin : computedActualTotalSalaryMin;

            const sanitizedUpdate = {
              EmployeeCode: String(employeeCode),
              EmployeeName: String(updatedData.employeeName || ''),
              Department: String(updatedData.department || ''),
              Category: String(updatedData.category ?? updatedData.Category ?? ''),
              Contractor: String(updatedData.contractor || ''),
              DaysInMonth: sanitizeNum(updatedData.daysInMonth),
              DaysPresent: sanitizeNum(updatedData.daysPresent),
              OTHours: sanitizeNum(updatedData.otHours),
              LOH: sanitizeNum(updatedData.loh),
              RevisedLOH: sanitizeNum(
                updatedData.revisedLOH ?? updatedData.RevisedLOH ?? lohHoursForLateDeduction(updatedData.loh)
              ),
              ActualBasic: sanitizeNum(updatedData.actualBasic),
              ActualHRA: sanitizeNum(updatedData.actualHRA),
              ActualDA: sanitizeNum(updatedData.actualDA),
              OtherAllowance: sanitizeNum(updatedData.otherAllowance),
              TravelChargers: sanitizeNum(updatedData.travelChargers),
              SpecialAllowance: sanitizeNum(updatedData.specialAllowance),
              Incentive: sanitizeNum(updatedData.incentive),
              LoanAllowance: String(sanitizeNum(updatedData.loanAllowance)),
              FoodAllowance: sanitizeNum(updatedData.foodAllowance),
              UniformAllowance: sanitizeNum(updatedData.uniformAllowance),
              WashingAllowance: sanitizeNum(updatedData.washingAllowance),
              AttendanceBonus: sanitizeNum(updatedData.attendanceBonus),
              NoOfDaysWithoutUniforms: String(sanitizeNum(updatedData.noOfDaysWithoutUniforms)),
              Noofdayswithoutuniforms: String(sanitizeNum(updatedData.noOfDaysWithoutUniforms)),
              OtherAllowances: sanitizeNum(updatedData.otherAllowances),
              ActualTotalSalary: actualTotalSalaryMin,
              EarnedBasic: sanitizeNum(updatedData.earnedBasic),
              EarnedHRA: sanitizeNum(updatedData.earnedHRA),
              EarnedDA: sanitizeNum(updatedData.earnedDA),
              EarnedSpecialAllowance: sanitizeNum(updatedData.earnedSpecialAllowance),
              AttendanceAllowance: sanitizeNum(updatedData.earnedAttendanceAllowance),
              EarnedOtherAllowances: sanitizeNum(updatedData.earnedOtherAllowances),
              Arrear: sanitizeNum(updatedData.arrear),
              ArrearForPF: sanitizeNum(updatedData.arrearForPF),
              LOP: sanitizeNum(updatedData.lop),
              EarnedSalaryCross: earnedSalaryCrossMin,
              PF: pfMin,
              ESI: esiMin,
              EmployerESI: employerEsiRecalcMin,
              ESIContribution: sanitizeNum(updatedData.esiContribution ?? 0),
              TotalDeduction: sanitizeNum(updatedData.totalDeduction),
              OTAmount: otAmountMin,
              OTArrearAmount: sanitizeNum(updatedData.otArrearAmount),
              OTESI: sanitizeNum(updatedData.otEsi),
              OTPayment: sanitizeNum(updatedData.otPayment),
              PayableAmount: sanitizeNum(updatedData.payableAmount),
              OTWages: sanitizeNum(updatedData.otWages),
              Rent: sanitizeNum(updatedData.rent),
              Advance: sanitizeNum(updatedData.advance),
              LWF: month.endsWith('-12') ? 20 : sanitizeNum(updatedData.lwf),
              EmployerLwf: month.endsWith('-12') ? 40 : sanitizeNum(updatedData.employerLwf),
              PT: sanitizeNum(updatedData.pt),
              OtherDeduction: sanitizeNum(updatedData.otherDeduction),
              NetPay: sanitizeNum(
                updatedData.netPay !== undefined ? updatedData.netPay : updatedData.netpay
              ),
              TotalNetPayable: sanitizeNum(updatedData.totalNetPayable),
              ERPF13: erpf13Min,
              ServiceCharge: serviceChargeMin,
              Total: totalMin,
              GST: gstMin,
              NetTotal: netTotalMin,
              BankHolderName: String(updatedData.bankHolderName || ''),
              BankName: String(updatedData.bankName || ''),
              IFSCCode: String(updatedData.ifscCode || ''),
              BankBranch: String(updatedData.bankBranch || ''),
              Payslip: updatedData.payslip === true || updatedData.payslip === 'true' ? 'true' : 'false',
              Added_User: String(actingUserEmail || ''),
              Modified_User: String(actingUserEmail || '')
            };

            mergeUnmappedPayrollUpdateFields(sanitizedUpdate, updatedData);

            try {
              await payrollTable.updateRow({ ROWID: rowId, ...sanitizedUpdate });
            } catch (updErr) {
              console.error('Follow-up update after minimal insert failed:', updErr, { sanitizedUpdateKeys: Object.keys(sanitizedUpdate) });
              throw updErr;
            }

            await mirrorPayrollFieldsToSamplePayrollIfManual(catalystApp, sanitizedUpdate, month);

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              status: 'success',
              message: 'Payroll record created and updated successfully',
              updatedRecord: {
                employeeCode: sanitizedUpdate.EmployeeCode,
                employeeName: sanitizedUpdate.EmployeeName,
                netPay: sanitizedUpdate.NetPay
              }
            }));
            return;
          }
     
          const existingRecord = existingRecords[0].Payroll;
     
          // Update the record with new data
          // Helper function to handle numeric values that can be 0
          const getNumericValue = (updatedValue, existingValue) => {
            // If updatedValue is explicitly provided (including 0), use it
            if (updatedValue !== undefined && updatedValue !== null && updatedValue !== '') {
              const numValue = Number(updatedValue);
              // Check if it's a valid number (not NaN)
              if (!isNaN(numValue)) {
                return numValue;
              }
            }
            // Otherwise, use existing value or default to 0
            const existingNum = Number(existingValue);
            return !isNaN(existingNum) ? existingNum : 0;
          };

          // Recalculate service charge: base = baseEarnedGross + ERPF 12% + Admin 0.5% + EDLI 0.5% + Employer ESI 3.25% + Employer LWF (do not include ESI Contribution)
          const earnedSalaryCrossUpdate = getNumericValue(updatedData.earnedSalaryCross, existingRecord.EarnedSalaryCross);
          const otAmountUpdate = getNumericValue(updatedData.otAmount, existingRecord.OTAmount);
          const erpf12PlusAdminPlusEdliUpdate = getNumericValue(updatedData.erpf13, existingRecord.ERPF13); // erpf13 stores ERPF 12% + Admin 0.5% + EDLI 0.5%
          const employerEsiUpdate = getNumericValue(updatedData.employerEsi, existingRecord.EmployerESI);
          const employerLwfUpdate = getNumericValue(updatedData.employerLwf, existingRecord.EmployerLwf);
          const specialUpdate = getNumericValue(updatedData.specialAllowance, existingRecord.SpecialAllowance);
          const otherUpdate = getNumericValue(updatedData.otherAllowance, existingRecord.OtherAllowance) || getNumericValue(updatedData.otherAllowances, existingRecord.OtherAllowances);

          // Actual Total Salary: prefer provided (or existing saved) value; fallback to computed sum only if neither exists.
          const computedActualTotalSalaryUpdate =
            getNumericValue(updatedData.actualBasic, existingRecord.ActualBasic) +
            getNumericValue(updatedData.actualHRA, existingRecord.ActualHRA) +
            getNumericValue(updatedData.actualDA, existingRecord.ActualDA) +
            getNumericValue(updatedData.specialAllowance, existingRecord.SpecialAllowance);
          const hasProvidedActualTotalSalaryUpdate = updatedData.actualTotalSalary !== undefined && updatedData.actualTotalSalary !== null && updatedData.actualTotalSalary !== '';
          const hasExistingActualTotalSalaryUpdate = existingRecord.ActualTotalSalary !== undefined && existingRecord.ActualTotalSalary !== null && existingRecord.ActualTotalSalary !== '';
          const resolvedActualTotalSalaryUpdate = (hasProvidedActualTotalSalaryUpdate || hasExistingActualTotalSalaryUpdate)
            ? getNumericValue(updatedData.actualTotalSalary ?? updatedData.ActualTotalSalary, existingRecord.ActualTotalSalary)
            : computedActualTotalSalaryUpdate;

          const baseEarnedGrossUpdate = Math.max(0, earnedSalaryCrossUpdate - otAmountUpdate - specialUpdate - otherUpdate);
          const contractorNameUpdate = String(updatedData.contractor || existingRecord.Contractor || '').trim().toLowerCase();
          const esiContributionUpdate = getNumericValue(updatedData.esiContribution, existingRecord.ESIContribution);
          // PF and ESI: recalculate from EARNED values only (never from Actual) so we never persist Actual-based values
          const earnedBasicUpdate = getNumericValue(updatedData.earnedBasic, existingRecord.EarnedBasic);
          const earnedHRAUpdate = getNumericValue(updatedData.earnedHRA, existingRecord.EarnedHRA);
          // Do not wipe Earned Special Allowance when the client sends 0 but Special Allowance is also 0 and DB has a value (import/run); matches import preserve behavior.
          const earnedSpecialAllowanceUpdate = (() => {
            const existingEsa = Number(existingRecord.EarnedSpecialAllowance);
            const specResolved = getNumericValue(updatedData.specialAllowance, existingRecord.SpecialAllowance);
            if (updatedData.earnedSpecialAllowance !== undefined && updatedData.earnedSpecialAllowance !== null && updatedData.earnedSpecialAllowance !== '') {
              const newEsa = Number(updatedData.earnedSpecialAllowance);
              if (!isNaN(newEsa) && newEsa === 0 && specResolved === 0 && !isNaN(existingEsa) && existingEsa !== 0) {
                return existingEsa;
              }
            }
            return getNumericValue(updatedData.earnedSpecialAllowance, existingRecord.EarnedSpecialAllowance);
          })();
          const travelChargersUpdate = getNumericValue(updatedData.travelChargers, existingRecord.TravelChargers ?? existingRecord.travelChargers);
          const earnedPlusSpecialUpdate = earnedBasicUpdate + earnedSpecialAllowanceUpdate;
          let pfUpdate = 0;
          let pfWagesUpdate = 0;
          let erpf12PlusAdminPlusEdliUpdateRecalc = 0;
          if (contractorNameUpdate !== 'yashaswi academy for skills' && earnedBasicUpdate > 0) {
            if (earnedBasicUpdate > 15000) {
              pfUpdate = 1800;
              pfWagesUpdate = 15000;
            } else {
              pfWagesUpdate = Math.min(15000, Math.max(0, earnedPlusSpecialUpdate));
              pfUpdate = Math.round(earnedBasicUpdate * 0.12);
            }
            const adminUpdate = Math.round(pfWagesUpdate * 0.005);
            const edliUpdate = Math.round(pfWagesUpdate) === 15000 ? 75 : Math.round(pfWagesUpdate * 0.005);
            erpf12PlusAdminPlusEdliUpdateRecalc = pfUpdate + adminUpdate + edliUpdate;
          }
          const esiBaseUpdate = earnedBasicUpdate + earnedHRAUpdate + earnedSpecialAllowanceUpdate + otAmountUpdate + travelChargersUpdate;
          let esiUpdate = 0;
          let employerEsiUpdateRecalc = 0;
          if (contractorNameUpdate !== 'yashaswi academy for skills' && esiBaseUpdate > 0) {
            esiUpdate = Math.ceil(esiBaseUpdate * 0.0075);
            employerEsiUpdateRecalc = Math.round(earnedSalaryCrossUpdate * 0.0325);
          }
          const serviceChargeBaseUpdate = Math.max(0, baseEarnedGrossUpdate + erpf12PlusAdminPlusEdliUpdateRecalc + employerEsiUpdateRecalc + employerLwfUpdate); // base + ERPF + Employer ESI + Employer LWF (earned-based only)
          let serviceChargeUpdate;
          if (contractorNameUpdate === 'yashaswi academy for skills') {
            serviceChargeUpdate = 1000;
          } else if (contractorNameUpdate === 'sriram enterprice' || contractorNameUpdate === 'sriram enterprise' || contractorNameUpdate === 'sriram enterprises') {
            serviceChargeUpdate = Math.round(serviceChargeBaseUpdate * 0.08);
          } else {
            serviceChargeUpdate = Math.round(serviceChargeBaseUpdate * 0.09);
          }
          const totalUpdate = Math.round(earnedSalaryCrossUpdate) + Math.round(erpf12PlusAdminPlusEdliUpdateRecalc) + serviceChargeUpdate + Math.round(employerEsiUpdateRecalc) + Math.round(employerLwfUpdate) + Math.round(esiContributionUpdate); // Total = Earned Gross + ERPF 12% + Admin 0.5% + EDLI 0.5% + Service Charge + ... + ESI Contribution
          const gstUpdate = contractorNameUpdate === 'yashaswi academy for skills' ? 0 : Math.round(totalUpdate * 0.18);
          const netTotalUpdate = totalUpdate + gstUpdate;
     
          const updatedRecord = {
            ...existingRecord,
            EmployeeName: String(updatedData.employeeName || existingRecord.EmployeeName || ''),
            Department: String(updatedData.department || existingRecord.Department || ''),
            Category: String(updatedData.category ?? updatedData.Category ?? existingRecord.Category ?? existingRecord.category ?? ''),
            Contractor: String(updatedData.contractor || existingRecord.Contractor || ''),
            DaysInMonth: getNumericValue(updatedData.daysInMonth, existingRecord.DaysInMonth),
            DaysPresent: getNumericValue(updatedData.daysPresent, existingRecord.DaysPresent),
            OTHours: getNumericValue(updatedData.otHours, existingRecord.OTHours),
            LOH: getNumericValue(updatedData.loh, existingRecord.LOH),
            RevisedLOH: (() => {
              const fromClient = parseSavedRevisedLohField(
                updatedData.revisedLOH ?? updatedData.RevisedLOH
              );
              if (fromClient !== undefined) return fromClient;
              const lohVal = getNumericValue(updatedData.loh, existingRecord.LOH);
              return lohHoursForLateDeduction(lohVal);
            })(),
            ActualBasic: getNumericValue(updatedData.actualBasic, existingRecord.ActualBasic),
            ActualHRA: getNumericValue(updatedData.actualHRA, existingRecord.ActualHRA),
            ActualDA: getNumericValue(updatedData.actualDA, existingRecord.ActualDA),
            OtherAllowance: getNumericValue(updatedData.otherAllowance, existingRecord.OtherAllowance),
            TravelChargers: getNumericValue(updatedData.travelChargers, existingRecord.TravelChargers ?? existingRecord.travelChargers),
            SpecialAllowance: getNumericValue(updatedData.specialAllowance, existingRecord.SpecialAllowance),
            Incentive: getNumericValue(updatedData.incentive, existingRecord.Incentive),
            LoanAllowance: String(getNumericValue(updatedData.loanAllowance, existingRecord.LoanAllowance ?? existingRecord.loanAllowance ?? existingRecord.Loanallowance)),
            FoodAllowance: getNumericValue(updatedData.foodAllowance, existingRecord.FoodAllowance ?? existingRecord.foodAllowance),
            UniformAllowance: getNumericValue(updatedData.uniformAllowance, existingRecord.UniformAllowance ?? existingRecord.uniformAllowance),
            WashingAllowance: getNumericValue(updatedData.washingAllowance, existingRecord.WashingAllowance ?? existingRecord.washingAllowance),
            AttendanceBonus: getNumericValue(updatedData.attendanceBonus, existingRecord.AttendanceBonus ?? existingRecord.attendanceBonus),
            NoOfDaysWithoutUniforms: String(getNumericValue(updatedData.noOfDaysWithoutUniforms, existingRecord.NoOfDaysWithoutUniforms ?? existingRecord.Noofdayswithoutuniforms ?? existingRecord.noofdayswithoutuniforms)),
            Noofdayswithoutuniforms: String(getNumericValue(updatedData.noOfDaysWithoutUniforms, existingRecord.NoOfDaysWithoutUniforms ?? existingRecord.Noofdayswithoutuniforms ?? existingRecord.noofdayswithoutuniforms)),
            OtherAllowances: getNumericValue(updatedData.otherAllowances, existingRecord.OtherAllowances),
            ActualTotalSalary: resolvedActualTotalSalaryUpdate,
            EarnedBasic: getNumericValue(updatedData.earnedBasic, existingRecord.EarnedBasic),
            EarnedHRA: getNumericValue(updatedData.earnedHRA, existingRecord.EarnedHRA),
            EarnedDA: getNumericValue(updatedData.earnedDA, existingRecord.EarnedDA),
            EarnedSpecialAllowance: earnedSpecialAllowanceUpdate,
            AttendanceAllowance: getNumericValue(updatedData.earnedAttendanceAllowance, existingRecord.AttendanceAllowance),
            EarnedOtherAllowances: getNumericValue(updatedData.earnedOtherAllowances, existingRecord.EarnedOtherAllowances),
            Arrear: getNumericValue(updatedData.arrear, existingRecord.Arrear),
            ArrearForPF: getNumericValue(updatedData.arrearForPF, existingRecord.ArrearForPF),
            LOP: getNumericValue(updatedData.lop, existingRecord.LOP),
            EarnedSalaryCross: earnedSalaryCrossUpdate,
            PF: pfUpdate,
            ESI: esiUpdate,
            EmployerESI: employerEsiUpdateRecalc,
            ESIContribution: getNumericValue(updatedData.esiContribution, existingRecord.ESIContribution),
            TotalDeduction: getNumericValue(updatedData.totalDeduction, existingRecord.TotalDeduction),
            OTAmount: otAmountUpdate,
            OTArrearAmount: getNumericValue(updatedData.otArrearAmount, existingRecord.OTArrearAmount),
            OTESI: getNumericValue(updatedData.otEsi, existingRecord.OTESI),
            OTPayment: getNumericValue(updatedData.otPayment, existingRecord.OTPayment),
            PayableAmount: getNumericValue(updatedData.payableAmount, existingRecord.PayableAmount),
            OTWages: getNumericValue(updatedData.otWages, existingRecord.OTWages),
            Rent: getNumericValue(updatedData.rent, existingRecord.Rent),
            Advance: getNumericValue(updatedData.advance, existingRecord.Advance),
            LWF: month.endsWith('-12') ? 20 : getNumericValue(updatedData.lwf, existingRecord.LWF),
            EmployerLwf: month.endsWith('-12') ? 40 : getNumericValue(updatedData.employerLwf, existingRecord.EmployerLwf),
            PT: getNumericValue(updatedData.pt, existingRecord.PT),
            OtherDeduction: getNumericValue(updatedData.otherDeduction, existingRecord.OtherDeduction),
            NetPay: getNumericValue(
              updatedData.netPay !== undefined ? updatedData.netPay : updatedData.netpay,
              existingRecord.NetPay !== undefined ? existingRecord.NetPay : existingRecord.Netpay
            ),
            ERPF13: erpf12PlusAdminPlusEdliUpdateRecalc,
            ServiceCharge: serviceChargeUpdate,
            Total: totalUpdate,
            GST: gstUpdate,
            NetTotal: netTotalUpdate,
            BankHolderName: String(updatedData.bankHolderName !== undefined ? updatedData.bankHolderName : (existingRecord.BankHolderName || '')),
            BankName: String(updatedData.bankName !== undefined ? updatedData.bankName : (existingRecord.BankName || '')),
            IFSCCode: String(updatedData.ifscCode !== undefined ? updatedData.ifscCode : (existingRecord.IFSCCode || '')),
            BankBranch: String(updatedData.bankBranch !== undefined ? updatedData.bankBranch : (existingRecord.BankBranch || '')),
            Payslip: updatedData.payslip !== undefined && updatedData.payslip !== null
              ? (updatedData.payslip === true || updatedData.payslip === 'true' ? 'true' : 'false')
              : (existingRecord.Payslip === 'true' || existingRecord.Payslip === true ? 'true' : 'false'),
            Added_User: String((existingRecord.Added_User ?? existingRecord.added_User ?? actingUserEmail) || ''),
            Modified_User: String(actingUserEmail || existingRecord.Modified_User || existingRecord.modified_User || existingRecord.Added_User || existingRecord.added_User || '')
          };

          mergeUnmappedPayrollUpdateFields(updatedRecord, updatedData);
     
          // Update the record in the database
          console.log('=== BACKEND UPDATE DEBUG - PERFORMING DATABASE UPDATE ===');
          console.log('ROWID:', existingRecord.ROWID);
          console.log('Updated record to save:', updatedRecord);
          console.log('DaysPresent being saved:', updatedRecord.DaysPresent);
          console.log('DaysPresent input value:', updatedData.daysPresent);
          console.log('DaysPresent existing value:', existingRecord.DaysPresent);
          console.log('DaysInMonth being saved:', updatedRecord.DaysInMonth);
          console.log('DaysInMonth input value:', updatedData.daysInMonth);
          console.log('OTHours being saved:', updatedRecord.OTHours);
     
          const updateResult = await payrollTable.updateRow({
            ROWID: existingRecord.ROWID,
            ...updatedRecord
          });

          await mirrorPayrollFieldsToSamplePayrollIfManual(catalystApp, updatedRecord, month);
     
          console.log('Database update result:', updateResult);
          console.log(`Successfully updated payroll record for employee ${employeeCode} in month ${month}`);
          console.log('Updated record data:', {
            employeeCode: updatedRecord.EmployeeCode,
            employeeName: updatedRecord.EmployeeName,
            daysPresent: updatedRecord.DaysPresent,
            otHours: updatedRecord.OTHours,
            actualBasic: updatedRecord.ActualBasic,
            netPay: updatedRecord.NetPay,
            noOfDaysWithoutUniforms: updatedRecord.NoOfDaysWithoutUniforms,
            Noofdayswithoutuniforms: updatedRecord.Noofdayswithoutuniforms
          });
     
          // Verify the update by querying the record back
          try {
            const verifyQuery = `SELECT * FROM Payroll WHERE Month_filter = '${month}' AND EmployeeCode = '${employeeCode}'`;
            const verifyRecords = await catalystApp.zcql().executeZCQLQuery(verifyQuery);
            console.log('=== BACKEND UPDATE DEBUG - VERIFICATION ===');
            console.log('Verification query:', verifyQuery);
            console.log('Verification result count:', verifyRecords.length);
            if (verifyRecords.length > 0) {
              const verifiedRecord = verifyRecords[0].Payroll;
              console.log('Verified record:', verifiedRecord);
              console.log('Key fields in verified record:', {
                EmployeeCode: verifiedRecord.EmployeeCode,
                ActualBasic: verifiedRecord.ActualBasic,
                ActualHRA: verifiedRecord.ActualHRA,
                ActualDA: verifiedRecord.ActualDA,
                OtherAllowance: verifiedRecord.OtherAllowance,
                ActualTotalSalary: verifiedRecord.ActualTotalSalary,
                NetPay: verifiedRecord.NetPay
              });
            } else {
              console.log('WARNING: Record not found after update!');
            }
          } catch (verifyErr) {
            console.error('Verification query failed:', verifyErr);
          }
     
          try {
            await syncPermissionReportFromPayrollMonth(catalystApp, month);
          } catch (permissionReportErr) {
            console.error(
              'PermissionReport sync after payroll update:',
              permissionReportErr?.message || permissionReportErr
            );
          }

          console.log('=== BACKEND UPDATE DEBUG - SENDING SUCCESS RESPONSE ===');
          const successResponse = {
            status: 'success',
            message: 'Payroll record updated successfully',
            updatedRecord: {
              employeeCode: updatedRecord.EmployeeCode,
              employeeName: updatedRecord.EmployeeName,
              netPay: updatedRecord.NetPay
            }
          };
          console.log('Success response:', successResponse);
     
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(successResponse));
     
        } catch (parseError) {
          console.error('=== BACKEND UPDATE DEBUG - PARSE ERROR ===');
          console.error('Error parsing update request:', parseError);
          console.error('Parse error stack:', parseError.stack);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid request data: ' + parseError.message }));
        }
      });
 
    } catch (err) {
      console.error('=== BACKEND UPDATE DEBUG - ENDPOINT ERROR ===');
      console.error('Update endpoint error:', err);
      console.error('Error stack:', err.stack);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Create Payroll table endpoint (for debugging)
  if (pathname === '/create-table') {
    try {
      const catalystApp = catalyst.initialize(req);
      console.log('Creating Payroll table...');
 
      const payrollTable = await catalystApp.datastore().table('Payroll', {
        columns: [
          { name: 'Month', dataType: 'string' },
          { name: 'EmployeeCode', dataType: 'string' },
          { name: 'EmployeeName', dataType: 'string' },
          { name: 'Department', dataType: 'string' },
          { name: 'Contractor', dataType: 'string' },
          { name: 'DaysInMonth', dataType: 'number' },
          { name: 'DaysPresent', dataType: 'number' },
          { name: 'OTHours', dataType: 'number' },
          { name: 'ActualBasic', dataType: 'number' },
          { name: 'ActualHRA', dataType: 'number' },
          { name: 'ActualTotalSalary', dataType: 'number' },
          { name: 'EarnedBasic', dataType: 'number' },
          { name: 'EarnedHRA', dataType: 'number' },
          { name: 'EarnedSalaryCross', dataType: 'number' },
          { name: 'OTWages', dataType: 'number' },
          { name: 'Rent', dataType: 'number' },
          { name: 'Advance', dataType: 'number' },
          { name: 'LWF', dataType: 'number' },
          { name: 'PT', dataType: 'number' },
          { name: 'NetPay', dataType: 'number' }
        ]
      });
 
      console.log('Payroll table created successfully');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'success', message: 'Payroll table created successfully' }));
    } catch (err) {
      console.error('Error creating Payroll table:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Get attendance data for payroll calculation
  if (pathname === '/attendance-data') {
    try {
      const catalystApp = catalyst.initialize(req);
      const month = query.month; // format: YYYY-MM
      const employeeId = query.employeeId;
 
      if (!month) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing month parameter (YYYY-MM)' }));
        return;
      }

      console.log('Fetching attendance data for payroll:', { month, employeeId });
 
      // Build date range for the month
      const startDate = `${month}-01`;
      const endDate = new Date(Number(month.split('-')[0]), Number(month.split('-')[1]), 0);
      const endDateStr = `${month}-${String(endDate.getDate()).padStart(2, '0')}`;
 
      console.log('Date range for attendance:', { startDate, endDateStr });
 
      // Query attendance data from Attendance table
      let attendanceQuery = `
        SELECT EmployeeId, AttendanceDate, FirstIn, LastOut, Status
        FROM Attendance
        WHERE AttendanceDate >= '${startDate}' AND AttendanceDate <= '${endDateStr}'
      `;
 
      if (employeeId && employeeId !== 'All') {
        attendanceQuery += ` AND EmployeeId = '${employeeId}'`;
      }
 
      attendanceQuery += ` ORDER BY EmployeeId, AttendanceDate`;
 
      console.log('Attendance query:', attendanceQuery);
 
      const attendanceRecords = await catalystApp.zcql().executeZCQLQuery(attendanceQuery);
      console.log('Found attendance records:', attendanceRecords.length);
 
      // Group attendance data by employee
      const employeeAttendanceMap = {};
 
      for (const row of attendanceRecords) {
        const attendance = row.Attendance;
        const empId = attendance.EmployeeId;
        const attendanceDate = attendance.AttendanceDate;
        const firstIn = attendance.FirstIn;
        const lastOut = attendance.LastOut;
   
        if (!employeeAttendanceMap[empId]) {
          employeeAttendanceMap[empId] = {
            employeeId: empId,
            totalDaysPresent: 0,
            totalOvertimeHours: 0,
            attendanceDetails: []
          };
        }
   
        // Count as present based on hours worked (>=8 = 1 day, >=4 = 0.5 day)
        if (attendanceDate && firstIn && lastOut) {
          const hoursWorked = calculateHoursWorked(firstIn, lastOut, attendanceDate);
          let daysToAdd = 0;
     
          if (hoursWorked >= 8) {
            daysToAdd = 1; // Full day
          } else if (hoursWorked >= 4) {
            daysToAdd = 0.5; // Half day
          }
       
          if (daysToAdd > 0) {
            employeeAttendanceMap[empId].totalDaysPresent += daysToAdd;
       
            // Store attendance details
            employeeAttendanceMap[empId].attendanceDetails.push({
              date: attendanceDate,
              firstIn: firstIn,
              lastOut: lastOut,
              hoursWorked: hoursWorked.toFixed(2),
              status: attendance.Status
            });
          }
        }
      }
 
      // Convert map to array
      const attendanceData = Object.values(employeeAttendanceMap);
 
      console.log('Processed attendance data for', attendanceData.length, 'employees');
 
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'success',
        data: attendanceData,
        month: month,
        totalEmployees: attendanceData.length
      }));
 
    } catch (err) {
      console.log('Attendance data endpoint error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // GET Automatic / Manual flags for payroll mode (per month via ?month=YYYY-MM; defaults that month to Automatic if no row)
  if (pathname === '/automatic-selection/latest') {
    if (req.method !== 'GET') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }
    try {
      const catalystApp = catalyst.initialize(req);
      const rawMonthQ = query.month;
      const monthQ =
        rawMonthQ != null ? String(Array.isArray(rawMonthQ) ? rawMonthQ[0] : rawMonthQ).trim() : '';
      const flags = await getLatestAutomaticModeFlags(catalystApp, monthQ || undefined);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'success',
          automatic: flags.automatic,
          manual: flags.manual,
          empty: flags.empty,
          month: monthQ ? normalizeSamplePayrollMonthKey(monthQ) : ''
        })
      );
    } catch (err) {
      console.error('automatic-selection/latest error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message || 'Failed to load saved selection.' }));
    }
    return;
  }

  // Save Automatic / Manual multi-select into Data Store table "Automatic" (columns: Automatic, Manual — text)
  if (pathname === '/automatic-selection') {
    const catalystApp = catalyst.initialize(req);
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', async () => {
      try {
        const requestData = JSON.parse(body || '{}');
        const { selections, month: monthRaw } = requestData;

        if (!selections || !Array.isArray(selections) || selections.length === 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Provide selections as a non-empty array (Automatic and/or Manual).' }));
          return;
        }

        const buttonMonth = normalizeSamplePayrollMonthKey(monthRaw);
        if (!buttonMonth || !/^\d{4}-\d{2}$/.test(buttonMonth)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              error: 'Provide a valid month (YYYY-MM) in the "month" field so the mode is saved for that payroll month only.'
            })
          );
          return;
        }

        const allowed = new Set(['Automatic', 'Manual']);
        const cleaned = [
          ...new Set(
            selections
              .map((s) => String(s || '').trim())
              .filter((s) => allowed.has(s))
          )
        ];
        if (cleaned.length === 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Each selection must be "Automatic" or "Manual".' }));
          return;
        }

        const automaticTable = await getPayrollAutomaticModeTable(catalystApp);
        if (!automaticTable) {
          let existingNames = [];
          try {
            const all = await catalystApp.datastore().getAllTables();
            existingNames = all
              .map((t) => {
                const meta = typeof t.toJSON === 'function' ? t.toJSON() : t._tableDetails;
                return String(meta?.table_name || '').trim();
              })
              .filter(Boolean);
          } catch (e) {
            console.log('Could not list Data Store tables:', e.message);
          }
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              error:
                'Data Store table "Automatic" not found. Set env AUTOMATIC_TABLE_ID to your table id (e.g. 399000000101514) or create a table named Automatic with text columns Automatic, Manual, and ButtonMonth (YYYY-MM).',
              existingTableNames: existingNames
            })
          );
          return;
        }

        const row = {
          Automatic: cleaned.includes('Automatic') ? 'Yes' : '',
          Manual: cleaned.includes('Manual') ? 'Yes' : '',
          ButtonMonth: buttonMonth
        };

        try {
          await automaticTable.insertRow(row);
        } catch (insertErr) {
          const msg = String(insertErr?.message || insertErr || '');
          console.error('Automatic table insertRow failed:', insertErr);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              error: msg || 'Insert failed.',
              help:
                'Table Automatic must have text columns Automatic, Manual, and ButtonMonth (YYYY-MM).',
              attemptedRow: row
            })
          );
          return;
        }

        console.log('Automatic selection saved:', row);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'success', data: row }));
      } catch (err) {
        console.error('automatic-selection error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message || 'Failed to save selection.' }));
      }
    });
    return;
  }

  // Default route
res.writeHead(404);
res.write('You might find the page you are looking for at "/" path');
res.end();
};