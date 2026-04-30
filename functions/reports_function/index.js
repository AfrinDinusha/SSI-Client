'use strict';

const catalyst = require('zcatalyst-sdk-node');
const url = require('url');

// Helper function to calculate total hours from FirstIn and LastOut timestamps
function calculateHoursFromTimestamps(firstIn, lastOut) {
    if (!firstIn || !lastOut) return 0;
   
    try {
        console.log(`Calculating hours from: FirstIn="${firstIn}", LastOut="${lastOut}"`);
       
        // Clean timestamps by removing tab characters and normalizing whitespace
        const cleanFirstIn = firstIn.replace(/\s+/g, ' ').trim();
        const cleanLastOut = lastOut.replace(/\s+/g, ' ').trim();
       
        // Handle different timestamp formats
        let inTime, outTime;
       
        // Check if format is DD-MM-YYYY HH:MM:SS (from database)
        if (cleanFirstIn.includes('-') && cleanFirstIn.split('-')[0].length === 2) {
            // Convert DD-MM-YYYY HH:MM:SS to YYYY-MM-DD HH:MM:SS
            const inParts = cleanFirstIn.split(' ');
            const inDateParts = inParts[0].split('-');
            const inTimePart = inParts[1] || '00:00:00';
            const convertedFirstIn = `${inDateParts[2]}-${inDateParts[1]}-${inDateParts[0]} ${inTimePart}`;
           
            const outParts = cleanLastOut.split(' ');
            const outDateParts = outParts[0].split('-');
            const outTimePart = outParts[1] || '00:00:00';
            const convertedLastOut = `${outDateParts[2]}-${outDateParts[1]}-${outDateParts[0]} ${outTimePart}`;
           
            console.log(`Converted: FirstIn="${convertedFirstIn}", LastOut="${convertedLastOut}"`);
           
            inTime = new Date(convertedFirstIn.replace(' ', 'T'));
            outTime = new Date(convertedLastOut.replace(' ', 'T'));
        } else {
            // Assume YYYY-MM-DD HH:MM:SS format
            inTime = new Date(cleanFirstIn.replace(' ', 'T'));
            outTime = new Date(cleanLastOut.replace(' ', 'T'));
        }
       
        if (isNaN(inTime.getTime()) || isNaN(outTime.getTime())) {
            console.error('Invalid timestamp format after conversion:', cleanFirstIn, cleanLastOut, '->', inTime, outTime);
            return 0;
        }
       
        const diffMs = outTime - inTime;
        if (diffMs <= 0) {
            console.log('Invalid time difference (negative or zero):', diffMs);
            return 0;
        }
       
        // Convert milliseconds to hours
        const totalHours = diffMs / (1000 * 60 * 60);
        console.log(`Calculated total hours: ${totalHours}`);
        return totalHours;
    } catch (error) {
        console.error('Error calculating hours from timestamps:', firstIn, lastOut, error);
        return 0;
    }
}

// Helper function to convert time string format (e.g., "8h 30m") to decimal hours (legacy support)
function parseTimeStringToDecimalHours(timeString) {
    if (!timeString || typeof timeString !== 'string') return 0;
   
    try {
        // Handle format like "8h 30m" or "8h 30m 0s"
        const match = timeString.match(/(\d+)h\s*(\d+)m(?:\s*(\d+)s)?/);
        if (match) {
            const hours = parseInt(match[1], 10);
            const minutes = parseInt(match[2], 10);
            const seconds = match[3] ? parseInt(match[3], 10) : 0;
           
            // Convert to decimal hours
            return hours + (minutes / 60) + (seconds / 3600);
        }
       
        // Handle numeric string (fallback)
        const numericValue = parseFloat(timeString);
        if (!isNaN(numericValue)) {
            return numericValue;
        }
       
        return 0;
    } catch (error) {
        console.error('Error parsing time string:', timeString, error);
        return 0;
    }
}

/** CompOff *taken* CO day only — not CompOffWorkedOn (includes('CompOff') wrongly matches the latter). */
function sourceHasCompOffTakenSegment(source) {
  const s = String(source || '');
  if (s === 'CompOff') return true;
  return /(^|\+)CompOff($|\+)/.test(s);
}

/**
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 */
module.exports = async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const query = parsedUrl.query;

  if (pathname === '/monthly-overtime') {
    // Parse date/month/date range and filters
    const month = query.month; // format: YYYY-MM (legacy support)
    const startDateParam = query.startDate; // format: YYYY-MM-DD
    const endDateParam = query.endDate; // format: YYYY-MM-DD
    let contractor = query.contractor;
    const department = query.department;
    const designationApplicableToRaw = query.designationApplicableTo || query.departmentOtApplicableTo;
    const employeeId = query.employeeId;
    const userEmail = query.userEmail;
    const userRole = query.userRole;
    const source = (query.source || 'auto').toLowerCase(); // auto, bhr, attendance
   
    // Support both legacy (month) and new (startDate/endDate) parameters
    if (!month && (!startDateParam || !endDateParam)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing month (YYYY-MM) or startDate/endDate (YYYY-MM-DD) parameters' }));
      return;
    }
   
    // Filter by contractor based on user email (hard-coded mapping)
    if (userRole === 'App User' && userEmail && !contractor) {
      const emailContractorMap = {
        'afrindinusha@gmail.com': 'R.P.D Facility Management Services',
        'rpdmanpowerservice@gmail.com': 'R.P.D Facility Management Services',
        'ramachandran23488@gmail.com': 'R.P.D Facility Management Services',
        'afrindinusha29@gmail.com': 'Sriram enterprises',
        'sriramenterprises50@yahoo.com': 'Sriram enterprises',
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
        console.log(`Filtering monthly OT for user ${userEmail} - showing only ${forcedContractor} employees`);
      }
    }
   
    try {
      const catalystApp = catalyst.initialize(req);
      const zcql = catalystApp.zcql();
     
      // Determine date range based on month or startDate/endDate parameters
      let startDate, endDateStr, startDateOnly, endDateOnly;
      if (startDateParam && endDateParam) {
        // New date range format
        startDateOnly = startDateParam;
        endDateOnly = endDateParam;
        startDate = startDateOnly;
        endDateStr = endDateOnly;
      } else if (month) {
        // Month-wise: get all days in the month (legacy support)
        const [year, monthNum] = month.split('-').map(Number);
        startDateOnly = `${month}-01`;
        const lastDayOfMonth = new Date(year, monthNum, 0).getDate();
        endDateOnly = `${month}-${String(lastDayOfMonth).padStart(2, '0')}`;
        startDate = startDateOnly;
        endDateStr = endDateOnly;
      }

      // Category OT Applicable To (Setup Configuration): only these categories are included in OT calculation; others excluded. "All" = no filter.
      let designationApplicableToList = Array.isArray(designationApplicableToRaw)
        ? designationApplicableToRaw
            .flatMap((v) => String(v || '').split(','))
            .map((v) => String(v || '').trim())
            .filter((v) => v && v.toLowerCase() !== 'all')
        : String(designationApplicableToRaw || '')
            .split(',')
            .map((v) => String(v || '').trim())
            .filter((v) => v && v.toLowerCase() !== 'all');

      // If not sent, load latest saved Category OT Applicable To from Setup Configuration
      if (designationApplicableToList.length === 0) {
        try {
          const otApplicableTable = catalystApp.datastore().table('399000000022752');
          const savedRows = await otApplicableTable.getAllRows();
          if (savedRows.length > 0) {
            const latest = savedRows
              .slice()
              .sort((a, b) => {
                const aTime = new Date(a.MODIFIEDTIME || a.CREATEDTIME || 0).getTime();
                const bTime = new Date(b.MODIFIEDTIME || b.CREATEDTIME || 0).getTime();
                return bTime - aTime;
              })[0];
            const savedValue = String(
              latest.DepartmnetApplicableTo || latest.DepartmentApplicableTo || ''
            ).trim();
            if (savedValue) {
              designationApplicableToList = savedValue
                .split(',')
                .map((v) => String(v || '').trim())
                .filter((v) => v && v.toLowerCase() !== 'all');
            }
          }
        } catch (savedErr) {
          console.log('Monthly OT: failed to read saved Department OT Applicable To:', savedErr.message);
        }
      }

      const designationApplicableToSet = new Set(
        designationApplicableToList.map((d) => String(d || '').replace(/\s+/g, ' ').trim().toLowerCase())
      );
      const normalizeOtCategoryValue = (value) =>
        String(value || '')
          .replace(/\s+/g, ' ')
          .trim()
          .toLowerCase();
      const normalizeOtCategoryToken = (value) =>
        normalizeOtCategoryValue(value).replace(/[^a-z0-9]/g, '');
      const isOtCategoryApplicable = (value) => {
        const raw = normalizeOtCategoryValue(value);
        const token = normalizeOtCategoryToken(value);
        if (!raw && !token) return false;
        if (designationApplicableToSet.has(raw)) return true;
        for (const allowed of designationApplicableToSet) {
          const allowedRaw = normalizeOtCategoryValue(allowed);
          const allowedToken = normalizeOtCategoryToken(allowed);
          if (!allowedRaw && !allowedToken) continue;
          if (raw === allowedRaw || token === allowedToken) return true;
          if (
            raw.includes(allowedRaw) ||
            allowedRaw.includes(raw) ||
            token.includes(allowedToken) ||
            allowedToken.includes(token)
          ) {
            return true;
          }
        }
        return false;
      };
     
      console.log(`Monthly OT Report request: month=${month || 'N/A'}, startDate=${startDateOnly}, endDate=${endDateOnly}, source=${source}, contractor=${contractor}, department=${department}`);
      console.log(`Date range: ${startDate} to ${endDateStr}`);
     
      // Fetch shift mappings for the month to check General shift employees
      // Note: Shiftmap.EmployeeId is ROWID, but BHR/Attendance use EmployeeCode
      // So we need to map ROWID -> EmployeeCode
      const shiftMap = {}; // Key: employeeCode -> [{ assignedShift, fromdate, todate }]
      try {
        // First, get all shift mappings
        const shiftQuery = `SELECT EmployeeId, AssignedShift, Fromdate, Todate FROM Shiftmap WHERE Fromdate <= '${endDateStr}' AND Todate >= '${startDate}'`;
        const shiftRecords = await zcql.executeZCQLQuery(shiftQuery);
       
        // Get unique Employee ROWIDs from shift mappings
        const employeeRowIds = [...new Set(shiftRecords.map(r => String(r.Shiftmap.EmployeeId || '').trim()).filter(Boolean))];
       
        // Map ROWID to EmployeeCode
        const rowIdToCodeMap = {};
        if (employeeRowIds.length > 0) {
          // Query Employee table to get EmployeeCode for each ROWID
          // Note: We can't directly query by ROWID in ZCQL, so we'll fetch all and filter
          // But for better performance, we'll process in batches if needed
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
       
        // Now process shift mappings using EmployeeCode as key
        for (const row of shiftRecords) {
          const shift = row.Shiftmap;
          const empRowId = String(shift.EmployeeId || '').trim();
          if (!empRowId) continue;
         
          // Get EmployeeCode from mapping
          const empCode = rowIdToCodeMap[empRowId];
          if (!empCode) {
            console.log(`Monthly OT: Warning - Employee ROWID ${empRowId} not found in Employee table, skipping shift mapping`);
            continue;
          }
         
          // Normalize dates to YYYY-MM-DD format (handles DD/MM/YYYY, DD-MM-YYYY, etc.)
          const normalizeDate = (dateVal) => {
            if (!dateVal) return '';
           
            let dateStr = '';
            if (typeof dateVal === 'string') {
              dateStr = String(dateVal).trim();
            } else {
              // If it's already a Date object or number, convert to string first
              const d = new Date(dateVal);
              if (!isNaN(d.getTime())) {
                return d.toISOString().slice(0, 10);
              }
              return '';
            }
           
            // If already in YYYY-MM-DD format, return as is
            if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
              return dateStr;
            }
           
            // Try to parse DD/MM/YYYY or DD-MM-YYYY format (common in shift mappings like "20/12/2025")
            const dmyMatch = dateStr.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);
            if (dmyMatch) {
              const [, day, month, year] = dmyMatch;
              const dayPadded = day.padStart(2, '0');
              const monthPadded = month.padStart(2, '0');
              return `${year}-${monthPadded}-${dayPadded}`;
            }
           
            // Try to parse YYYY/MM/DD or YYYY-MM-DD format
            const ymdMatch = dateStr.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/);
            if (ymdMatch) {
              const [, year, month, day] = ymdMatch;
              const monthPadded = month.padStart(2, '0');
              const dayPadded = day.padStart(2, '0');
              return `${year}-${monthPadded}-${dayPadded}`;
            }
           
            // Fallback: try standard Date parsing
            const d = new Date(dateStr);
            if (!isNaN(d.getTime())) {
              return d.toISOString().slice(0, 10);
            }
           
            return '';
          };
         
          const fromDate = normalizeDate(shift.Fromdate);
          const toDate = normalizeDate(shift.Todate);
          const assignedShift = String(shift.AssignedShift || '').trim().toUpperCase();
         
          if (!shiftMap[empCode]) {
            shiftMap[empCode] = [];
          }
          shiftMap[empCode].push({
            assignedShift: assignedShift,
            fromdate: fromDate,
            todate: toDate
          });
         
          // Debug: Log General shift mappings
          if (assignedShift === 'GENERAL' || assignedShift === 'GENERAL SHIFT') {
            console.log(`Monthly OT: Found General shift for employee ${empCode} (ROWID: ${empRowId}): ${fromDate} to ${toDate} (original: ${shift.Fromdate} to ${shift.Todate})`);
          }
        }
        console.log(`Monthly OT: Fetched shift information for ${Object.keys(shiftMap).length} employees`);
      } catch (err) {
        console.log('Monthly OT Shiftmap query error:', err.message);
        // Continue without shift information if query fails
      }
     
      // Fetch NewShiftMap data for shift types (priority over Shiftmap)
      const newShiftMap = {}; // Key: "employeeCode_date" -> shiftType
      try {
        console.log(`Monthly OT: Fetching shift data from NewShiftMap for date range ${startDate} to ${endDateStr}`);
        const newShiftMapQuery = `SELECT EmployeeCode, ShiftDate, ShiftType FROM NewShiftMap WHERE ShiftDate >= '${startDate}' AND ShiftDate <= '${endDateStr}'`;
       
        // Use pagination to fetch all records (ZCQL max limit is 300)
        const pageSize = 300;
        let offset = 0;
        let hasMore = true;
        const allNewShiftRecords = [];
       
        while (hasMore) {
          try {
            const paginatedQuery = `${newShiftMapQuery} ORDER BY EmployeeCode, ShiftDate LIMIT ${pageSize} OFFSET ${offset}`;
            const batch = await zcql.executeZCQLQuery(paginatedQuery);
           
            if (batch.length === 0) {
              hasMore = false;
              break;
            }
           
            allNewShiftRecords.push(...batch);
            offset += pageSize;
           
            if (batch.length < pageSize) {
              hasMore = false;
            }
          } catch (pagErr) {
            // If pagination fails, try without pagination
            console.log('Monthly OT: NewShiftMap pagination failed, trying without pagination:', pagErr.message);
            try {
              const rows = await zcql.executeZCQLQuery(newShiftMapQuery);
              allNewShiftRecords.push(...rows);
            } catch (queryErr) {
              console.error('Monthly OT: Error executing NewShiftMap query without pagination:', queryErr);
            }
            hasMore = false;
          }
        }
       
        console.log(`Monthly OT: Fetched ${allNewShiftRecords.length} records from NewShiftMap`);
       
        // Build map: employeeCode_date -> shiftType
        for (const row of allNewShiftRecords) {
          const record = row.NewShiftMap || row;
          const empCode = String(record.EmployeeCode || '').trim();
          const shiftDate = String(record.ShiftDate || '').trim();
          const shiftType = String(record.ShiftType || '').trim().toUpperCase();
         
          if (empCode && shiftDate) {
            // Normalize date to YYYY-MM-DD format
            let normalizedDate = shiftDate;
            if (!/^\d{4}-\d{2}-\d{2}$/.test(shiftDate)) {
              // Try parsing as date
              const d = new Date(shiftDate);
              if (!isNaN(d.getTime())) {
                const year = d.getFullYear();
                const month = String(d.getMonth() + 1).padStart(2, '0');
                const day = String(d.getDate()).padStart(2, '0');
                normalizedDate = `${year}-${month}-${day}`;
              }
            }
           
            const key = `${empCode}_${normalizedDate}`;
            newShiftMap[key] = shiftType;
          }
        }
       
        console.log(`Monthly OT: Built NewShiftMap with ${Object.keys(newShiftMap).length} employee-date entries`);
      } catch (err) {
        console.log('Monthly OT: NewShiftMap query error:', err.message);
        // Continue without NewShiftMap information if query fails
      }

      // Fetch Shift master definitions for dynamic OT calculation by shift end time.
      const shiftDefinitions = {};
      const normalizeShiftNameKey = (name) =>
        String(name || '').trim().toUpperCase().replace(/\s+/g, '');
      const normalizeTimeToHms = (timeValue) => {
        const raw = String(timeValue || '').trim();
        if (!raw) return '';
        const hhmmss = raw.match(/^([01]?\d|2[0-3]):([0-5]\d):([0-5]\d)$/);
        if (hhmmss) {
          const hh = hhmmss[1].padStart(2, '0');
          return `${hh}:${hhmmss[2]}:${hhmmss[3]}`;
        }
        const hhmm = raw.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
        if (hhmm) {
          const hh = hhmm[1].padStart(2, '0');
          return `${hh}:${hhmm[2]}:00`;
        }
        return '';
      };
      try {
        const shiftRows = await zcql.executeZCQLQuery(
          `SELECT ShiftName, FromDate, ToDate FROM Shift`
        );
        for (const row of shiftRows) {
          const shift = row.Shift || row;
          const shiftName = String(shift.ShiftName || '').trim();
          const fromTime = normalizeTimeToHms(shift.FromDate);
          const toTime = normalizeTimeToHms(shift.ToDate);
          if (!shiftName || !fromTime || !toTime) continue;
          shiftDefinitions[normalizeShiftNameKey(shiftName)] = {
            shiftName,
            fromTime,
            toTime
          };
        }
        console.log(`Monthly OT: Loaded ${Object.keys(shiftDefinitions).length} shift definitions from Shift table`);
      } catch (err) {
        console.log('Monthly OT: Shift definitions query error:', err.message);
      }

      // Employee-date exclusions: do not calculate OT for these combinations (even if present).
      // Format: "employeeId_YYYY-MM-DD". Must match attendance_muster_function OT_EXCLUSIONS.
      const OT_EXCLUSIONS = new Set([
        '36150_2026-01-04', '60102_2026-01-04', '50059_2025-12-28', '50059_2025-12-14',
        '60060_2026-01-04', '36114_2026-01-04', '50028_2026-01-04', '60112_2026-01-04',
        '36150_2026-01-01'
      ]);
      const compoffWoExcludeFromOT = new Set();
      const otYesFullHoursKeys = new Set();
      const isOTExcluded = (empId, dateStr) => OT_EXCLUSIONS.has(`${String(empId).trim()}_${dateStr}`);

      // Holiday date check (hardcoded list only; used in BHR path before Calendar is loaded). For byKey we use isDeclaredHoliday (Calendar + hardcoded).
      const isDeclaredHolidayDateHardcoded = (dateStr) => {
        if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return false;
        const month = d.getMonth();
        const day = d.getDate();
        if (month === 0 && day === 1) return true;
        if (month === 0 && day === 15) return true;
        if (month === 0 && day === 16) return true;
        if (month === 0 && day === 17) return true;
        if (month === 0 && day === 26) return true;
        if (month === 3 && day === 14) return true;
        if (month === 4 && day === 1) return true;
        if (month === 7 && day === 15) return true;
        if (month === 8 && day === 14) return true;
        if (month === 9 && day === 2) return true;
        if (month === 9 && day === 19) return true;
        if (month === 11 && day === 25) return true;
        return false;
      };
     
      // Helper function to normalize date for comparison
      const normalizeDateForCompare = (dateVal) => {
        if (!dateVal) return '';
        if (typeof dateVal === 'string') {
          // Already in YYYY-MM-DD format
          if (/^\d{4}-\d{2}-\d{2}$/.test(dateVal)) return dateVal;
          // Handle DD/MM/YYYY format
          const ddmmyyyyMatch = dateVal.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
          if (ddmmyyyyMatch) {
            const [, day, month, year] = ddmmyyyyMatch;
            return `${year}-${month}-${day}`;
          }
        }
        return String(dateVal);
      };

      // True if this employee has a shift assigned in NewShiftMap for this date. If false, use General shift OT.
      const hasNewShiftMapEntry = (empId, dateStr) => {
        const key = `${String(empId).trim()}_${normalizeDateForCompare(dateStr)}`;
        return newShiftMap[key] !== undefined && newShiftMap[key] !== null && String(newShiftMap[key]).trim() !== '';
      };

      const getAssignedShiftForDate = (empId, dateStr) => {
        const normalizedEmpId = String(empId).trim();
        const normalizedDate = normalizeDateForCompare(dateStr);
        const newShiftKey = `${normalizedEmpId}_${normalizedDate}`;
        const newShiftType = String(newShiftMap[newShiftKey] || '').trim();
        if (newShiftType) return newShiftType;

        const mappedShifts = shiftMap[normalizedEmpId] || [];
        for (const shift of mappedShifts) {
          const assignedShift = String(shift.assignedShift || '').trim();
          if (!assignedShift) continue;
          if (shift.fromdate && shift.todate) {
            if (normalizedDate >= shift.fromdate && normalizedDate <= shift.todate) return assignedShift;
          } else if (shift.fromdate && normalizedDate >= shift.fromdate) {
            return assignedShift;
          } else if (shift.todate && normalizedDate <= shift.todate) {
            return assignedShift;
          }
        }
        return '';
      };

      const getShiftDefinitionForEmployeeDate = (empId, dateStr) => {
        const assignedShift = getAssignedShiftForDate(empId, dateStr);
        // When shiftmap is not mapped for this employee/date, use General shift from Shift table (same as attendance muster)
        if (!assignedShift) return getGeneralShiftDefinition();
        const key = normalizeShiftNameKey(assignedShift);
        if (shiftDefinitions[key]) return shiftDefinitions[key];

        // Alias resolution: map common shift labels from NewShiftMap/Shiftmap
        // to Shift master names (e.g., "GENERAL" -> "GENERAL SHIFT").
        const findByKeyword = (keywordList) => {
          const keys = Object.keys(shiftDefinitions);
          const matchKey = keys.find((k) => keywordList.some((kw) => k.includes(kw)));
          return matchKey ? shiftDefinitions[matchKey] : null;
        };

        if (key.includes('GENERALII') || (key.includes('GENERAL') && key.includes('II'))) {
          return findByKeyword(['GENERALII']);
        }
        if (key.includes('GENERAL')) {
          return findByKeyword(['GENERAL']);
        }
        if (key.includes('1ST') || key.includes('FIRST') || key === '1' || key.includes('SHIFT1')) {
          return findByKeyword(['1ST', 'FIRST']);
        }
        if (key.includes('2ND') || key.includes('SECOND') || key === '2' || key.includes('SHIFT2')) {
          return findByKeyword(['2ND', 'SECOND']);
        }
        if (key.includes('HOUSEKEEPING') || key === 'HK') {
          return findByKeyword(['HOUSEKEEPING', 'HK']);
        }

        return null;
      };

      const getGeneralShiftDefinition = () => {
        const keys = Object.keys(shiftDefinitions);
        const matchKey = keys.find((k) => k.includes('GENERAL') && !k.includes('GENERALII'));
        return matchKey ? shiftDefinitions[matchKey] : null;
      };
     
      // Helper function to check if employee is on General shift for a specific date
      // Note: empId here should be EmployeeCode (not ROWID)
      const isGeneralShift = (empId, dateStr) => {
        // First, check NewShiftMap (has priority)
        const normalizedEmpId = String(empId).trim();
        const normalizedDate = normalizeDateForCompare(dateStr);
        const newShiftKey = `${normalizedEmpId}_${normalizedDate}`;
        const newShiftType = newShiftMap[newShiftKey];
       
        // Debug logging for General shift detection
        if (newShiftType) {
          console.log(`[Monthly OT] Checking General shift for Employee ${normalizedEmpId} on ${normalizedDate}: NewShiftMap key=${newShiftKey}, shiftType="${newShiftType}"`);
        }
       
        if (newShiftType) {
          // Housekeeping is NOT a General shift (it has its own OT rules)
          const shiftTypeUpper = String(newShiftType || '').trim().toUpperCase();
          const shiftTypeCompact = shiftTypeUpper.replace(/\s+/g, '');
          const housekeepingMatch =
            shiftTypeUpper === 'HOUSEKEEPING' ||
            shiftTypeUpper === 'HOUSEKEEPING SHIFT' ||
            shiftTypeUpper === 'HOUSE KEEPING' ||
            shiftTypeUpper === 'HK' ||
            shiftTypeUpper.includes('HOUSEKEEPING') ||
            shiftTypeCompact.includes('HOUSEKEEPING');
          if (housekeepingMatch) {
            return false;
          }

          // General II is NOT a General shift - it has its own OT rules (12:00-20:00, OT after 21:00)
          const isGeneralIIMatch = shiftTypeUpper === 'GENERAL II' || shiftTypeUpper === 'GENERALII' ||
              shiftTypeCompact.includes('GENERALII') || (shiftTypeUpper.includes('GENERAL') && shiftTypeUpper.includes('II'));
          if (isGeneralIIMatch) {
            return false;
          }

          // Check if it's a General shift type (case-insensitive check)
          const shiftTypeUpperGeneral = String(newShiftType || '').toUpperCase();
          const isGeneralShiftMatch = shiftTypeUpperGeneral === 'GENERAL' || shiftTypeUpperGeneral === 'GENERAL SHIFT' ||
              shiftTypeUpperGeneral.includes('GENERAL');
         
          if (isGeneralShiftMatch) {
            console.log(`[Monthly OT] Employee ${normalizedEmpId} on ${normalizedDate} is on General shift (from NewShiftMap: "${newShiftType}")`);
            return true;
          }
         
          // If NewShiftMap has a shift type but it's not General, check if it's 1st or 2nd
          const isFirst = isFirstShift(empId, dateStr);
          const isSecond = isSecondShift(empId, dateStr);
          // If it's not 1st or 2nd, and NewShiftMap has a value, default to General
          if (!isFirst && !isSecond) {
            console.log(`[Monthly OT] Employee ${normalizedEmpId} on ${normalizedDate} defaulting to General shift (NewShiftMap has "${newShiftType}" but not 1st or 2nd)`);
            return true; // Default to General if NewShiftMap has a shift type but it's not 1st or 2nd
          }
          return false; // If it's 1st or 2nd, it's not General
        }
       
        // Fallback to Shiftmap if not found in NewShiftMap
        if (!shiftMap[empId] || shiftMap[empId].length === 0) {
          return false;
        }
       
        for (const shift of shiftMap[empId]) {
          if (shift.assignedShift === 'GENERAL' || shift.assignedShift === 'GENERAL SHIFT') {
            if (shift.fromdate && shift.todate) {
              // Check if date is within the shift date range
              if (dateStr >= shift.fromdate && dateStr <= shift.todate) {
                console.log(`Monthly OT: Employee ${empId} is on General shift for ${dateStr} (range: ${shift.fromdate} to ${shift.todate})`);
                return true;
              }
            } else if (shift.fromdate && dateStr >= shift.fromdate) {
              console.log(`Monthly OT: Employee ${empId} is on General shift for ${dateStr} (from: ${shift.fromdate})`);
              return true;
            } else if (shift.todate && dateStr <= shift.todate) {
              console.log(`Monthly OT: Employee ${empId} is on General shift for ${dateStr} (to: ${shift.todate})`);
              return true;
            }
          }
        }
        return false;
      };

      // Helper function to check if employee is on General II shift (12:00-20:00, 10 min grace, OT after 21:00)
      const isGeneralIIShiftMonthlyOT = (empId, dateStr) => {
        const normalizedEmpId = String(empId).trim();
        const normalizedDate = normalizeDateForCompare(dateStr);
        const newShiftKey = `${normalizedEmpId}_${normalizedDate}`;
        const newShiftType = newShiftMap[newShiftKey];
        if (newShiftType) {
          const shiftTypeUpper = String(newShiftType || '').trim().toUpperCase();
          const shiftTypeCompact = shiftTypeUpper.replace(/\s+/g, '');
          return shiftTypeUpper === 'GENERAL II' || shiftTypeUpper === 'GENERALII' ||
              shiftTypeCompact.includes('GENERALII') || (shiftTypeUpper.includes('GENERAL') && shiftTypeUpper.includes('II'));
        }
        return false;
      };

      // Helper function to check if employee is on 1st shift for a specific date
      const isFirstShift = (empId, dateStr) => {
        // First, check NewShiftMap (has priority)
        const normalizedEmpId = String(empId).trim();
        const normalizedDate = normalizeDateForCompare(dateStr);
        const newShiftKey = `${normalizedEmpId}_${normalizedDate}`;
        const newShiftType = newShiftMap[newShiftKey];
       
        if (newShiftType) {
          // Check if it's a 1st shift type
          const isFirstShiftMatch = newShiftType === '1ST' || newShiftType === '1ST SHIFT' ||
              newShiftType === 'FIRST' || newShiftType === 'FIRST SHIFT' ||
              newShiftType === '1' || newShiftType === 'SHIFT 1' ||
              newShiftType.includes('1ST') || newShiftType.includes('FIRST');
         
          if (isFirstShiftMatch) {
            return true;
          }
        }
       
        // Fallback to Shiftmap if not found in NewShiftMap
        if (!shiftMap[empId] || shiftMap[empId].length === 0) {
          return false;
        }
       
        for (const shift of shiftMap[empId]) {
          const shiftName = shift.assignedShift || '';
          if (shiftName === '1ST' || shiftName === '1ST SHIFT' || shiftName === 'FIRST' ||
              shiftName === 'FIRST SHIFT' || shiftName === '1' || shiftName === 'SHIFT 1') {
            if (shift.fromdate && shift.todate) {
              if (dateStr >= shift.fromdate && dateStr <= shift.todate) {
                return true;
              }
            } else if (shift.fromdate && dateStr >= shift.fromdate) {
              return true;
            } else if (shift.todate && dateStr <= shift.todate) {
              return true;
            }
          }
        }
        return false;
      };

      // Helper function to check if employee is on 2nd shift for a specific date
      const isSecondShift = (empId, dateStr) => {
        // First, check NewShiftMap (has priority)
        const normalizedEmpId = String(empId).trim();
        const normalizedDate = normalizeDateForCompare(dateStr);
        const newShiftKey = `${normalizedEmpId}_${normalizedDate}`;
        const newShiftType = newShiftMap[newShiftKey];
       
        if (newShiftType) {
          // Check if it's a 2nd shift type
          const isSecondShiftMatch = newShiftType === '2ND' || newShiftType === '2ND SHIFT' ||
              newShiftType === 'SECOND' || newShiftType === 'SECOND SHIFT' ||
              newShiftType === '2' || newShiftType === 'SHIFT 2' ||
              newShiftType.includes('2ND') || newShiftType.includes('SECOND');
         
          if (isSecondShiftMatch) {
            return true;
          }
        }
       
        // Fallback to Shiftmap if not found in NewShiftMap
        if (!shiftMap[empId] || shiftMap[empId].length === 0) {
          return false;
        }
       
        for (const shift of shiftMap[empId]) {
          const shiftName = shift.assignedShift || '';
          if (shiftName === '2ND' || shiftName === '2ND SHIFT' || shiftName === 'SECOND' ||
              shiftName === 'SECOND SHIFT' || shiftName === '2' || shiftName === 'SHIFT 2' ||
              shiftName === '2ND SHIFT' || shiftName === '2ND') {
            if (shift.fromdate && shift.todate) {
              if (dateStr >= shift.fromdate && dateStr <= shift.todate) {
                return true;
              }
            } else if (shift.fromdate && dateStr >= shift.fromdate) {
              return true;
            } else if (shift.todate && dateStr <= shift.todate) {
              return true;
            }
          }
        }
        return false;
      };

      // Helper function to check if employee is on Housekeeping shift for a specific date
      // Housekeeping OT rule: no fixed start/end; OT only when total > 9h, then OT = total − 8.
      function isHousekeepingShift(empId, dateStr) {
        // First, check NewShiftMap (has priority)
        const normalizedEmpId = String(empId).trim();
        const normalizedDate = normalizeDateForCompare(dateStr);
        const newShiftKey = `${normalizedEmpId}_${normalizedDate}`;
        const newShiftType = newShiftMap[newShiftKey];

        if (newShiftType) {
          const shiftTypeUpper = String(newShiftType || '').trim().toUpperCase();
          const shiftTypeCompact = shiftTypeUpper.replace(/\s+/g, '');
          const isHK =
            shiftTypeUpper === 'HOUSEKEEPING' ||
            shiftTypeUpper === 'HOUSEKEEPING SHIFT' ||
            shiftTypeUpper === 'HOUSE KEEPING' ||
            shiftTypeUpper === 'HK' ||
            shiftTypeUpper.includes('HOUSEKEEPING') ||
            shiftTypeCompact.includes('HOUSEKEEPING');
          if (isHK) return true;
        }

        // Fallback to Shiftmap if not found in NewShiftMap
        if (!shiftMap[empId] || shiftMap[empId].length === 0) return false;

        for (const shift of shiftMap[empId]) {
          const shiftName = String(shift.assignedShift || '').trim().toUpperCase();
          const shiftNameCompact = shiftName.replace(/\s+/g, '');
          const isHK =
            shiftName === 'HOUSEKEEPING' ||
            shiftName === 'HOUSEKEEPING SHIFT' ||
            shiftName === 'HOUSE KEEPING' ||
            shiftName === 'HK' ||
            shiftName.includes('HOUSEKEEPING') ||
            shiftNameCompact.includes('HOUSEKEEPING');
          if (!isHK) continue;

          if (shift.fromdate && shift.todate) {
            if (dateStr >= shift.fromdate && dateStr <= shift.todate) return true;
          } else if (shift.fromdate && dateStr >= shift.fromdate) {
            return true;
          } else if (shift.todate && dateStr <= shift.todate) {
            return true;
          }
        }
        return false;
      }
     
      // Helper function to parse time from string
      const parseTimeFromString = (timeStr) => {
        if (!timeStr) return '';
       
          let timePart = '';
        if (typeof timeStr === 'string') {
          if (timeStr.includes(' ')) {
              // Format: YYYY-MM-DD HH:MM:SS or DD-MM-YYYY HH:MM:SS
            const parts = timeStr.split(' ');
              timePart = parts[1] || '00:00:00';
            } else {
              // Just time format (HH:MM:SS or HH:MM)
            timePart = timeStr;
            }
          } else {
            // If not a string, try to convert to Date and extract time
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
         
          // Ensure timePart has seconds
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

      // Helper function to calculate overtime based on shift end time
      const calculateOvertimeForShift = (lastOutTimeStr, dateStr, expectedCheckoutTime) => {
        if (!lastOutTimeStr || !dateStr || !expectedCheckoutTime) return 0;
       
        try {
          const timePart = parseTimeFromString(lastOutTimeStr);
          if (!timePart) return 0;
         
          const lastOutTime = lastOutInstantFromStr(lastOutTimeStr, dateStr);
          if (!lastOutTime) return 0;
          const expectedCheckout = new Date(`${dateStr} ${expectedCheckoutTime}`.replace(' ', 'T'));
         
          if (isNaN(lastOutTime.getTime()) || isNaN(expectedCheckout.getTime())) {
            return 0;
          }
         
          // If checkout is after expected time, calculate OT hours
          // Note: General shift uses a different calculation (see calculateOvertimeForGeneralShift)
          // This function is used for 1st and 2nd shifts
          if (lastOutTime > expectedCheckout) {
            const diffMs = lastOutTime - expectedCheckout;
            const overtimeHours = diffMs / (1000 * 60 * 60); // Convert to hours
            const result = Math.max(0, parseFloat(overtimeHours.toFixed(3))); // Round to 3 decimal places for accuracy
            console.log(`OT Calculation: checkout=${timePart}, expected=${expectedCheckoutTime}, diffMs=${diffMs}, OT=${result.toFixed(3)} hours`);
            return result;
          }
         
          // If checkout is exactly at or before expected time, no OT
          return 0;
        } catch (error) {
          console.error('Error calculating overtime:', error, 'lastOutTimeStr:', lastOutTimeStr, 'dateStr:', dateStr, 'expectedCheckoutTime:', expectedCheckoutTime);
          return 0;
        }
      };

      // Helper function to calculate overtime for General shift
      // Uses 17:55:00 as the cutoff time (no OT if checkout is 17:55 or earlier)
      // If checkout is after 17:55, calculate OT as (checkout time - 16:55)
      // Example: 17:56 - 16:55 = 1.017 hours (61 minutes)
      // If checkout is 17:55 or earlier (like 17:30), no OT is calculated
      const calculateOvertimeForGeneralShift = (lastOutTimeStr, dateStr) => {
        if (!lastOutTimeStr || !dateStr) {
          console.log(`[General Shift OT] Missing parameters: lastOutTimeStr=${lastOutTimeStr}, dateStr=${dateStr}`);
          return 0;
        }
       
        try {
          const timePart = parseTimeFromString(lastOutTimeStr);
          if (!timePart) {
            console.log(`[General Shift OT] Failed to parse time from: ${lastOutTimeStr}`);
            return 0;
          }
         
          // Normalize date to YYYY-MM-DD format
          let normalizedDate = dateStr;
          if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
            const d = new Date(dateStr);
            if (!isNaN(d.getTime())) {
              const year = d.getFullYear();
              const month = String(d.getMonth() + 1).padStart(2, '0');
              const day = String(d.getDate()).padStart(2, '0');
              normalizedDate = `${year}-${month}-${day}`;
            }
          }
         
          const lastOutTime = lastOutInstantFromStr(lastOutTimeStr, normalizedDate);
          if (!lastOutTime) {
            console.log(`[General Shift OT] Invalid last out instant from: ${lastOutTimeStr}`);
            return 0;
          }
          const cutoffTime = new Date(`${normalizedDate} 17:55:00`.replace(' ', 'T'));
          const baseTime = new Date(`${normalizedDate} 16:55:00`.replace(' ', 'T'));
         
          if (isNaN(lastOutTime.getTime()) || isNaN(cutoffTime.getTime()) || isNaN(baseTime.getTime())) {
            console.log(`[General Shift OT] Invalid date/time: lastOutTime=${lastOutTime}, cutoffTime=${cutoffTime}, baseTime=${baseTime}`);
            return 0;
          }
         
          // Only calculate OT if checkout is after 17:55
          if (lastOutTime > cutoffTime) {
            const diffMs = lastOutTime - baseTime;
            const overtimeHours = diffMs / (1000 * 60 * 60); // Convert to hours
            const result = Math.max(0, parseFloat(overtimeHours.toFixed(3))); // Round to 3 decimal places
            console.log(`[General Shift OT] date=${normalizedDate}, checkout=${timePart}, cutoff=17:55:00, base=16:55:00, OT=${result.toFixed(3)} hours`);
            return result;
          }
         
          // If checkout is 17:55 or earlier, no OT
          console.log(`[General Shift OT] date=${normalizedDate}, checkout=${timePart} is <= 17:55:00, no OT calculated`);
          return 0;
        } catch (error) {
          console.error(`[General Shift OT] Error calculating General shift overtime for date=${dateStr}, lastOut=${lastOutTimeStr}:`, error);
          return 0;
        }
      };

      // Helper function to calculate overtime for 1st shift
      // Uses 15:00:00 as the cutoff time (no OT if checkout is 15:00 or earlier)
      // If checkout is after 15:00, calculate OT as (checkout time - 14:00)
      // Example: 15:01 - 14:00 = 1.017 hours (61 minutes)
      // If checkout is 15:00 or earlier, no OT is calculated
      const calculateOvertimeForFirstShift = (lastOutTimeStr, dateStr) => {
        if (!lastOutTimeStr || !dateStr) return 0;
       
        try {
          const timePart = parseTimeFromString(lastOutTimeStr);
          if (!timePart) return 0;
         
          const lastOutTime = lastOutInstantFromStr(lastOutTimeStr, dateStr);
          if (!lastOutTime) return 0;
          const cutoffTime = new Date(`${dateStr} 15:00:00`.replace(' ', 'T'));
          const baseTime = new Date(`${dateStr} 14:00:00`.replace(' ', 'T'));
         
          if (isNaN(lastOutTime.getTime()) || isNaN(cutoffTime.getTime()) || isNaN(baseTime.getTime())) {
            return 0;
          }
         
          // Only calculate OT if checkout is after 15:00
          if (lastOutTime > cutoffTime) {
            const diffMs = lastOutTime - baseTime;
            const overtimeHours = diffMs / (1000 * 60 * 60); // Convert to hours
            const result = Math.max(0, parseFloat(overtimeHours.toFixed(3))); // Round to 3 decimal places
            console.log(`[1st Shift OT] checkout=${timePart}, cutoff=15:00:00, base=14:00:00, OT=${result.toFixed(3)} hours`);
            return result;
          }
         
          // If checkout is 15:00 or earlier, no OT
          console.log(`[1st Shift OT] checkout=${timePart} is <= 15:00:00, no OT calculated`);
          return 0;
        } catch (error) {
          console.error('Error calculating 1st shift overtime:', error);
          return 0;
        }
      };

      // Helper function to calculate overtime for General II shift
      // General II: 12:00-20:00, OT if checkout after 21:00
      const calculateOvertimeForGeneralIIShift = (lastOutTimeStr, dateStr) => {
        if (!lastOutTimeStr || !dateStr) return 0;
        try {
          const timePart = parseTimeFromString(lastOutTimeStr);
          if (!timePart) return 0;
          const lastOutTime = lastOutInstantFromStr(lastOutTimeStr, dateStr);
          if (!lastOutTime) return 0;
          // OT = checkout minus 20:00 (shift end) only if checkout is after 21:00
          const cutoffTime = new Date(`${dateStr} 21:00:00`.replace(' ', 'T'));
          const baseTime = new Date(`${dateStr} 20:00:00`.replace(' ', 'T'));
          if (isNaN(lastOutTime.getTime()) || isNaN(cutoffTime.getTime()) || isNaN(baseTime.getTime())) {
            return 0;
          }
          if (lastOutTime > cutoffTime) {
            const diffMs = lastOutTime - baseTime;
            const overtimeHours = diffMs / (1000 * 60 * 60);
            return Math.max(0, parseFloat(overtimeHours.toFixed(3)));
          }
          return 0;
        } catch (error) {
          return 0;
        }
      };

      // Helper function to calculate overtime for 2nd shift
      // Uses 23:00:00 as the cutoff time (no OT if checkout is 23:00 or earlier)
      // If checkout is after 23:00, calculate OT as (checkout time - 22:00)
      // Example: 23:01 - 22:00 = 1.017 hours (61 minutes)
      // If checkout is 23:00 or earlier, no OT is calculated
      const calculateOvertimeForSecondShift = (lastOutTimeStr, dateStr) => {
        if (!lastOutTimeStr || !dateStr) return 0;
       
        try {
          const timePart = parseTimeFromString(lastOutTimeStr);
          if (!timePart) return 0;
         
          const lastOutTime = lastOutInstantFromStr(lastOutTimeStr, dateStr);
          if (!lastOutTime) return 0;
          const cutoffTime = new Date(`${dateStr} 23:00:00`.replace(' ', 'T'));
          const baseTime = new Date(`${dateStr} 22:00:00`.replace(' ', 'T'));
         
          if (isNaN(lastOutTime.getTime()) || isNaN(cutoffTime.getTime()) || isNaN(baseTime.getTime())) {
            return 0;
          }
         
          // Only calculate OT if checkout is after 23:00
          if (lastOutTime > cutoffTime) {
            const diffMs = lastOutTime - baseTime;
            const overtimeHours = diffMs / (1000 * 60 * 60); // Convert to hours
            const result = Math.max(0, parseFloat(overtimeHours.toFixed(3))); // Round to 3 decimal places
            console.log(`[2nd Shift OT] checkout=${timePart}, cutoff=23:00:00, base=22:00:00, OT=${result.toFixed(3)} hours`);
            return result;
          }
         
          // If checkout is 23:00 or earlier, no OT
          console.log(`[2nd Shift OT] checkout=${timePart} is <= 23:00:00, no OT calculated`);
          return 0;
        } catch (error) {
          console.error('Error calculating 2nd shift overtime:', error);
          return 0;
        }
      };

      // Dynamic OT calculation for Shift master definitions:
      // OT is counted immediately after shift end time.
      const calculateOvertimeForDynamicShift = (lastOutTimeStr, dateStr, shiftEndTimeHms) => {
        if (!shiftEndTimeHms) return 0;
        return calculateOvertimeForShift(lastOutTimeStr, dateStr, shiftEndTimeHms);
      };
     
      let dataSource = 'none';
      let overtimeRecords = [];
      let bhrRecords = 0;
      let attendanceRecords = 0;
     
      // First, check if we have BHR data (ESSL server data) for the month
      if (source === 'auto' || source === 'bhr' || source === 'essl') {
        console.log('Checking BHR table for overtime data...');
       
        // Get employee filter conditions
        let employeeFilterConditions = [];
        if (employeeId && employeeId !== 'All') {
          employeeFilterConditions.push(`EmployeeID = '${employeeId}'`);
        }
       
        // Apply contractor filter through Employee table
        if (contractor && contractor !== 'All') {
          try {
            // Use flexible matching for contractor names
            const normalizedContractor = String(contractor || '').replace(/\s+/g, ' ').trim().replace(/'/g, "''");
            const contractorEmployeeQuery = await zcql.executeZCQLQuery(
              `SELECT EmployeeID, ContractorName FROM Employee WHERE ContractorName LIKE '%${normalizedContractor}%'`
            );
           
            // Additional JavaScript filtering for better matching
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
              employeeFilterConditions.push(`EmployeeID IN (${employeeIdList})`);
              console.log(`Contractor filter "${contractor}": Found ${contractorEmployeeIds.length} employees`);
            } else {
              console.log(`Contractor filter "${contractor}": No employees found`);
            }
          } catch (error) {
            console.error('Error applying contractor filter:', error);
          }
        }
       
        // Apply department filter through Employee table
        if (department && department !== 'All') {
          try {
            const departmentEmployeeQuery = await zcql.executeZCQLQuery(
              `SELECT EmployeeCode FROM Employee WHERE Department = '${department}'`
            );
           
            if (departmentEmployeeQuery && departmentEmployeeQuery.length > 0) {
              const departmentEmployeeIds = departmentEmployeeQuery.map(emp => emp.Employee.EmployeeCode);
              const employeeIdList = departmentEmployeeIds.map(id => `'${id}'`).join(',');
              if (employeeFilterConditions.length > 0) {
                // Intersect with existing conditions
                const existingCondition = employeeFilterConditions[0];
                if (existingCondition.includes('IN (')) {
                  // Extract existing IDs and intersect
                  const existingMatch = existingCondition.match(/IN \(([^)]+)\)/);
                  if (existingMatch) {
                    const existingIds = existingMatch[1].split(',').map(id => id.trim().replace(/'/g, ''));
                    const intersection = existingIds.filter(id => departmentEmployeeIds.includes(id));
                    if (intersection.length > 0) {
                      employeeFilterConditions[0] = `EmployeeID IN (${intersection.map(id => `'${id}'`).join(',')})`;
                    } else {
                      // No intersection, return empty result
                      res.writeHead(200, { 'Content-Type': 'application/json' });
                      res.end(JSON.stringify({ data: [], dataSource: 'BHR', summary: { totalEmployees: 0, totalDays: 0, bhrRecords: 0, attendanceRecords: 0 } }));
                      return;
                    }
                  }
                }
              } else {
                employeeFilterConditions.push(`EmployeeID IN (${employeeIdList})`);
              }
            }
          } catch (error) {
            console.error('Error applying department filter:', error);
          }
        }
       
        // Fetch BHR records for the month
        let bhrQuery = `SELECT EmployeeID, EventTime, Direction, DeviceSerial FROM BHR
                       WHERE EventTime >= '${startDate} 00:00:00'
                       AND EventTime <= '${endDateStr} 23:59:59'`;
        if (employeeFilterConditions.length > 0) {
          bhrQuery += ` AND ${employeeFilterConditions.join(' AND ')}`;
        }
        bhrQuery += ` ORDER BY EmployeeID, EventTime`;
       
        console.log(`BHR Query: ${bhrQuery}`);
        const bhrResults = await zcql.executeZCQLQuery(bhrQuery);
        const bhrRows = bhrResults.map(r => r.BHR);
        bhrRecords = bhrRows.length;
       
        if (bhrRecords > 0) {
          dataSource = 'BHR';
          console.log(`Found ${bhrRecords} BHR records, processing for overtime...`);
         
          // Group BHR records by EmployeeID and Date
          const bhrByEmployeeDate = {};
          bhrRows.forEach(row => {
            const date = row.EventTime.split(' ')[0];
            const key = `${row.EmployeeID}_${date}`;
            if (!bhrByEmployeeDate[key]) {
              bhrByEmployeeDate[key] = {
                EmployeeID: row.EmployeeID,
                Date: date,
                events: []
              };
            }
            bhrByEmployeeDate[key].events.push(row);
          });
         
          // Calculate overtime for each employee per day
          Object.values(bhrByEmployeeDate).forEach(empDateData => {
            const events = empDateData.events.sort((a, b) => new Date(a.EventTime) - new Date(b.EventTime));
           
            // Use earliest event as FirstIn and latest event as LastOut
            // This ensures we calculate total hours from FirstIn to LastOut
            if (events.length >= 2) {
              const firstIn = events[0].EventTime;
              const lastOut = events[events.length - 1].EventTime;
              const dateStr = empDateData.Date;
             
              const inTime = new Date(firstIn.replace(' ', 'T'));
              const outTime = new Date(lastOut.replace(' ', 'T'));
             
              // Calculate total hours from FirstIn to LastOut
              const totalHours = (outTime - inTime) / (1000 * 60 * 60);
             
              // Check which shift the employee is on for this date
              const isHousekeeping = isHousekeepingShift(empDateData.EmployeeID, dateStr);
              const isGeneralII = isGeneralIIShiftMonthlyOT(empDateData.EmployeeID, dateStr);
              const isGeneral = isGeneralShift(empDateData.EmployeeID, dateStr);
              const isFirst = isFirstShift(empDateData.EmployeeID, dateStr);
              const isSecond = isSecondShift(empDateData.EmployeeID, dateStr);
              const assignedShiftDef = getShiftDefinitionForEmployeeDate(empDateData.EmployeeID, dateStr);
             
              let overtimeHours = 0;

            const currentDate = new Date(dateStr);
            const dayOfWeek = currentDate.getDay(); // Sunday - 0, Saturday - 6

            // Sunday weekly off only (first Saturday of month is not auto WO)
            const isWO = dayOfWeek === 0;
            // Jan 3 2026 (03/01/2026) only: do not use WO model; use normal OT (after 60 min / shift threshold)
            const useWOModel = isWO && dateStr !== '2026-01-03';

            if (isOTExcluded(empDateData.EmployeeID, dateStr)) {
              // No OT for this employee-date (exclusion list)
            } else if (useWOModel) {
              overtimeHours = totalHours; // WO: total hours only (not doubled)
              overtimeRecords.push({
                EmployeeID: empDateData.EmployeeID,
                Date: dateStr,
                TotalHours: totalHours,
                OvertimeHours: overtimeHours,
                FirstIn: firstIn,
                LastOut: lastOut,
                Source: 'BHR_WO'
              });
              console.log(`Employee ${empDateData.EmployeeID} on ${dateStr} (WO - Sunday): ${totalHours.toFixed(2)} hours worked, OT (total): ${overtimeHours.toFixed(2)} hours`);
            } else if (isDeclaredHolidayDateHardcoded(dateStr) && totalHours > 0) {
              // Holiday: OT = total hours (not shift-based).
              overtimeHours = totalHours;
              overtimeRecords.push({
                EmployeeID: empDateData.EmployeeID,
                Date: dateStr,
                TotalHours: totalHours,
                OvertimeHours: overtimeHours,
                FirstIn: firstIn,
                LastOut: lastOut,
                Source: 'BHR_H'
              });
            } else if (!hasNewShiftMapEntry(empDateData.EmployeeID, dateStr) && !assignedShiftDef && !isHousekeeping) {
              // No shift assigned in NewShiftMap for this date → use General shift OT (e.g. 08:12-16:55 = 0 OT).
              {
                const fallbackGeneralShift = getGeneralShiftDefinition();
                overtimeHours = fallbackGeneralShift
                  ? calculateOvertimeForDynamicShift(lastOut, dateStr, fallbackGeneralShift.toTime)
                  : calculateOvertimeForGeneralShift(lastOut, dateStr);
              }
              if (overtimeHours > 0 || dateStr === '2026-01-03') {
                overtimeRecords.push({
                  EmployeeID: empDateData.EmployeeID,
                  Date: dateStr,
                  TotalHours: totalHours,
                  OvertimeHours: overtimeHours,
                  FirstIn: firstIn,
                  LastOut: lastOut,
                  Source: 'BHR'
                });
              }
            } else if (isHousekeeping) {
                // Housekeeping: OT only when total > 9h; then OT = total − 8 (e.g. 9h 30m → 1h 30m OT; 8h 30m → 0 OT). No early-arrival OT.
                overtimeHours = totalHours > 9 ? (totalHours - 8) : 0;
                if (overtimeHours > 0 || dateStr === '2026-01-03') {
                  overtimeRecords.push({
                    EmployeeID: empDateData.EmployeeID,
                    Date: dateStr,
                    TotalHours: totalHours,
                    OvertimeHours: overtimeHours,
                    FirstIn: firstIn,
                    LastOut: lastOut,
                    Source: 'BHR'
                  });
                  console.log(`Employee ${empDateData.EmployeeID} on ${dateStr} (Housekeeping): ${totalHours.toFixed(2)} hours, OT: ${overtimeHours.toFixed(2)} hours (total − 8h)`);
                }
              } else if (assignedShiftDef) {
                overtimeHours =
                  calculateOvertimeForDynamicShift(lastOut, dateStr, assignedShiftDef.toTime);
                if (overtimeHours > 0 || dateStr === '2026-01-03') {
                  overtimeRecords.push({
                    EmployeeID: empDateData.EmployeeID,
                    Date: dateStr,
                    TotalHours: totalHours,
                    OvertimeHours: overtimeHours,
                    FirstIn: firstIn,
                    LastOut: lastOut,
                    Source: 'BHR'
                  });
                }
              } else if (hasNewShiftMapEntry(empDateData.EmployeeID, dateStr)) {
                // Shift is assigned in NewShiftMap but not resolved in Shift master -> fallback to General shift.
                const fallbackGeneralShift = getGeneralShiftDefinition();
                overtimeHours = fallbackGeneralShift
                  ? calculateOvertimeForDynamicShift(lastOut, dateStr, fallbackGeneralShift.toTime)
                  : calculateOvertimeForGeneralShift(lastOut, dateStr);
                if (overtimeHours > 0 || dateStr === '2026-01-03') {
                  overtimeRecords.push({
                    EmployeeID: empDateData.EmployeeID,
                    Date: dateStr,
                    TotalHours: totalHours,
                    OvertimeHours: overtimeHours,
                    FirstIn: firstIn,
                    LastOut: lastOut,
                    Source: 'BHR'
                  });
                }
              } else if (isGeneralII) {
                // For General II shift: 12:00-20:00, OT if checkout after 21:00.
                overtimeHours = calculateOvertimeForGeneralIIShift(lastOut, dateStr);
                if (overtimeHours > 0 || dateStr === '2026-01-03') {
                  overtimeRecords.push({
                    EmployeeID: empDateData.EmployeeID,
                    Date: dateStr,
                    TotalHours: totalHours,
                    OvertimeHours: overtimeHours,
                    FirstIn: firstIn,
                    LastOut: lastOut,
                    Source: 'BHR'
                  });
                }
              } else if (isGeneral) {
                // For General shift: Calculate OT if checkout is after 17:55.
                {
                  const fallbackGeneralShift = getGeneralShiftDefinition();
                  overtimeHours = fallbackGeneralShift
                    ? calculateOvertimeForDynamicShift(lastOut, dateStr, fallbackGeneralShift.toTime)
                    : calculateOvertimeForGeneralShift(lastOut, dateStr);
                }
                if (overtimeHours > 0 || dateStr === '2026-01-03') {
                  overtimeRecords.push({
                    EmployeeID: empDateData.EmployeeID,
                    Date: dateStr,
                    TotalHours: totalHours,
                    OvertimeHours: overtimeHours,
                    FirstIn: firstIn,
                    LastOut: lastOut,
                    Source: 'BHR'
                  });
                  console.log(`Employee ${empDateData.EmployeeID} on ${dateStr} (General shift): ${totalHours.toFixed(2)} hours, checkout ${lastOut.split(' ')[1]}, OT: ${overtimeHours.toFixed(2)} hours`);
                }
              } else if (isFirst) {
                // For 1st shift: Calculate OT if checkout is after 15:00.
                overtimeHours = calculateOvertimeForFirstShift(lastOut, dateStr);
                if (overtimeHours > 0 || dateStr === '2026-01-03') {
                  overtimeRecords.push({
                    EmployeeID: empDateData.EmployeeID,
                    Date: dateStr,
                    TotalHours: totalHours,
                    OvertimeHours: overtimeHours,
                    FirstIn: firstIn,
                    LastOut: lastOut,
                    Source: 'BHR'
                  });
                  console.log(`Employee ${empDateData.EmployeeID} on ${dateStr} (1st shift): ${totalHours.toFixed(2)} hours, checkout ${lastOut.split(' ')[1]}, OT: ${overtimeHours.toFixed(2)} hours`);
                }
              } else if (isSecond) {
                // For 2nd shift: Calculate OT if checkout is after 23:00.
                overtimeHours = calculateOvertimeForSecondShift(lastOut, dateStr);
                if (overtimeHours > 0 || dateStr === '2026-01-03') {
                  overtimeRecords.push({
                    EmployeeID: empDateData.EmployeeID,
                    Date: dateStr,
                    TotalHours: totalHours,
                    OvertimeHours: overtimeHours,
                    FirstIn: firstIn,
                    LastOut: lastOut,
                    Source: 'BHR'
                  });
                  console.log(`Employee ${empDateData.EmployeeID} on ${dateStr} (2nd shift): ${totalHours.toFixed(2)} hours, checkout ${lastOut.split(' ')[1]}, OT: ${overtimeHours.toFixed(2)} hours`);
                }
              } else {
                // For other shifts: Only include if total hours is above 8.5 hours.
                if (totalHours > 8.5 || dateStr === '2026-01-03') {
                  overtimeHours = (totalHours > 8.5 ? totalHours - 8.5 : 0);
                  overtimeRecords.push({
                    EmployeeID: empDateData.EmployeeID,
                    Date: dateStr,
                    TotalHours: totalHours,
                    OvertimeHours: overtimeHours,
                    FirstIn: firstIn,
                    LastOut: lastOut,
                    Source: 'BHR'
                  });
                  console.log(`Employee ${empDateData.EmployeeID} on ${dateStr}: ${totalHours.toFixed(2)} hours (${overtimeHours.toFixed(2)} OT hours)`);
                }
              }
            }
          });
        }
      }
     
      // If no BHR data found and source is auto or attendance, check Attendance table
      if ((source === 'auto' && bhrRecords === 0) || source === 'attendance') {
        console.log('No BHR data found or explicitly requested attendance data, checking Attendance table...');
       
        // First, check if there are any attendance records at all
        const totalAttendanceQuery = `SELECT COUNT(ROWID) as count FROM Attendance`;
        const totalAttendanceResult = await zcql.executeZCQLQuery(totalAttendanceQuery);
        const totalAttendanceCount = totalAttendanceResult[0].Attendance.count;
        console.log(`Total attendance records in database: ${totalAttendanceCount}`);
       
        // Get sample dates to see the format
        if (totalAttendanceCount > 0) {
          const sampleDatesQuery = `SELECT AttendanceDate FROM Attendance ORDER BY ROWID DESC LIMIT 5`;
          const sampleDatesResult = await zcql.executeZCQLQuery(sampleDatesQuery);
          const sampleDates = sampleDatesResult.map(r => r.Attendance.AttendanceDate);
          console.log(`Sample attendance dates:`, sampleDates);
        }
       
        let attendanceQuery = `SELECT EmployeeId, AttendanceDate, FirstIn, LastOut, Status FROM Attendance
                              WHERE AttendanceDate >= '${startDate}'
                              AND AttendanceDate <= '${endDateStr}'`;
       
        if (employeeId && employeeId !== 'All') {
          attendanceQuery += ` AND EmployeeId = '${employeeId}'`;
        }
       
        // Apply contractor filter through Employee table
        if (contractor && contractor !== 'All') {
          try {
            // Use flexible matching for contractor names
            const normalizedContractor = String(contractor || '').replace(/\s+/g, ' ').trim().replace(/'/g, "''");
            const contractorEmployeeQuery = await zcql.executeZCQLQuery(
              `SELECT EmployeeID, ContractorName FROM Employee WHERE ContractorName LIKE '%${normalizedContractor}%'`
            );
           
            // Additional JavaScript filtering for better matching
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
              attendanceQuery += ` AND EmployeeId IN (${employeeIdList})`;
              console.log(`Contractor filter for attendance "${contractor}": Found ${contractorEmployeeIds.length} employees`);
            } else {
              console.log(`Contractor filter for attendance "${contractor}": No employees found`);
            }
          } catch (error) {
            console.error('Error applying contractor filter to attendance:', error);
          }
        }
       
        // Apply department filter through Employee table
        if (department && department !== 'All') {
          try {
            const departmentEmployeeQuery = await zcql.executeZCQLQuery(
              `SELECT EmployeeCode FROM Employee WHERE Department = '${department}'`
            );
           
            if (departmentEmployeeQuery && departmentEmployeeQuery.length > 0) {
              const departmentEmployeeIds = departmentEmployeeQuery.map(emp => emp.Employee.EmployeeCode);
              const employeeIdList = departmentEmployeeIds.map(id => `'${id}'`).join(',');
              if (attendanceQuery.includes('EmployeeId IN (')) {
                // Already has employee filter, need to intersect
                const existingMatch = attendanceQuery.match(/EmployeeId IN \(([^)]+)\)/);
                if (existingMatch) {
                  const existingIds = existingMatch[1].split(',').map(id => id.trim().replace(/'/g, ''));
                  const intersection = existingIds.filter(id => departmentEmployeeIds.includes(id));
                  if (intersection.length > 0) {
                    attendanceQuery = attendanceQuery.replace(/EmployeeId IN \([^)]+\)/, `EmployeeId IN (${intersection.map(id => `'${id}'`).join(',')})`);
                  } else {
                    // No intersection, return empty result
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ data: [], dataSource: 'Attendance', summary: { totalEmployees: 0, totalDays: 0, bhrRecords: 0, attendanceRecords: 0 } }));
                    return;
                  }
                }
              } else {
                attendanceQuery += ` AND EmployeeId IN (${employeeIdList})`;
              }
            }
          } catch (error) {
            console.error('Error applying department filter to attendance:', error);
          }
        }
       
        console.log(`Attendance Query: ${attendanceQuery}`);
        const attendanceResults = await zcql.executeZCQLQuery(attendanceQuery);
        const attendanceRows = attendanceResults.map(r => r.Attendance);
        attendanceRecords = attendanceRows.length;
       
        console.log(`Found ${attendanceRecords} attendance records`);
        if (attendanceRecords > 0) {
          console.log('Sample attendance record:', attendanceRows[0]);
        }
       
        if (attendanceRecords > 0) {
          dataSource = 'Attendance';
          console.log(`Found ${attendanceRecords} Attendance records, processing for overtime...`);
         
          // Calculate overtime from FirstIn and LastOut timestamps
          attendanceRows.forEach(row => {
            // Calculate total hours from FirstIn and LastOut timestamps
            const totalHours = calculateHoursFromTimestamps(row.FirstIn, row.LastOut);
            const dateStr = row.AttendanceDate;
            console.log(`Processing attendance record: EmployeeId=${row.EmployeeId}, FirstIn="${row.FirstIn}", LastOut="${row.LastOut}" -> ${totalHours} decimal hours`);
           
            // Check if employee is on General shift for this date
            // Check which shift the employee is on for this date
            const isHousekeeping = isHousekeepingShift(row.EmployeeId, dateStr);
            const isGeneralII = isGeneralIIShiftMonthlyOT(row.EmployeeId, dateStr);
            const isGeneral = isGeneralShift(row.EmployeeId, dateStr);
            const isFirst = isFirstShift(row.EmployeeId, dateStr);
            const isSecond = isSecondShift(row.EmployeeId, dateStr);
            const assignedShiftDef = getShiftDefinitionForEmployeeDate(row.EmployeeId, dateStr);
           
            let overtimeHours = 0;

            const currentDate = new Date(dateStr);
            const dayOfWeek = currentDate.getDay(); // Sunday - 0, Saturday - 6

            // Sunday weekly off only (first Saturday of month is not auto WO)
            const isWO = dayOfWeek === 0;
            // Jan 3 2026 (03/01/2026) only: do not use WO model; use normal OT (after 60 min / shift threshold)
            const useWOModel = isWO && dateStr !== '2026-01-03';

            // When present on Holiday: Status = H, or Sunday, or date is declared holiday → OT = total hours (not shift-based).
            const isSundayDate = (new Date(dateStr).getDay() === 0);
            const isPresentOnHoliday = (String(row.Status || '').trim().toUpperCase() === 'H') || isSundayDate || isDeclaredHolidayDateHardcoded(dateStr);

            if (isOTExcluded(row.EmployeeId, dateStr)) {
              // No OT for this employee-date (exclusion list)
            } else if (isPresentOnHoliday && totalHours > 0) {
              overtimeHours = totalHours;
              overtimeRecords.push({
                EmployeeID: row.EmployeeId,
                Date: dateStr,
                TotalHours: totalHours,
                OvertimeHours: overtimeHours,
                FirstIn: row.FirstIn,
                LastOut: row.LastOut,
                Source: 'Attendance_H'
              });
              console.log(`Added overtime record (H - Present on Holiday): ${row.EmployeeId} on ${dateStr} - ${totalHours}h total, ${overtimeHours.toFixed(3)}h OT`);
            } else if (useWOModel) {
              overtimeHours = totalHours; // WO: total hours only (not doubled)
              overtimeRecords.push({
                EmployeeID: row.EmployeeId,
                Date: dateStr,
                TotalHours: totalHours,
                OvertimeHours: overtimeHours,
                FirstIn: row.FirstIn,
                LastOut: row.LastOut,
                Source: 'Attendance_WO'
              });
              console.log(`Added overtime record (WO - Sunday): ${row.EmployeeId} on ${dateStr} - ${totalHours}h worked, OT (total): ${overtimeHours.toFixed(3)}h`);
            } else if (!hasNewShiftMapEntry(row.EmployeeId, dateStr) && !assignedShiftDef && !isHousekeeping) {
              // No shift assigned in NewShiftMap for this date → use General shift OT (e.g. 08:12-16:55 = 0 OT).
              {
                const fallbackGeneralShift = getGeneralShiftDefinition();
                overtimeHours = fallbackGeneralShift
                  ? calculateOvertimeForDynamicShift(row.LastOut, dateStr, fallbackGeneralShift.toTime)
                  : calculateOvertimeForGeneralShift(row.LastOut, dateStr);
              }
              if (overtimeHours > 0 || dateStr === '2026-01-03') {
                overtimeRecords.push({
                  EmployeeID: row.EmployeeId,
                  Date: dateStr,
                  TotalHours: totalHours,
                  OvertimeHours: overtimeHours,
                  FirstIn: row.FirstIn,
                  LastOut: row.LastOut,
                  Source: 'Attendance'
                });
              }
            } else if (isHousekeeping) {
              // Housekeeping: OT only when total > 9h; then OT = total − 8. No early-arrival OT.
              overtimeHours = totalHours > 9 ? (totalHours - 8) : 0;
              if (overtimeHours > 0 || dateStr === '2026-01-03') {
                overtimeRecords.push({
                  EmployeeID: row.EmployeeId,
                  Date: dateStr,
                  TotalHours: totalHours,
                  OvertimeHours: overtimeHours,
                  FirstIn: row.FirstIn,
                  LastOut: row.LastOut,
                  Source: 'Attendance'
                });
                console.log(`Added overtime record (Housekeeping): ${row.EmployeeId} on ${dateStr} - ${totalHours}h total, ${overtimeHours.toFixed(3)}h OT (total − 8h)`);
              }
            } else if (assignedShiftDef) {
              overtimeHours =
                calculateOvertimeForDynamicShift(row.LastOut, dateStr, assignedShiftDef.toTime);
              if (overtimeHours > 0 || dateStr === '2026-01-03') {
                overtimeRecords.push({
                  EmployeeID: row.EmployeeId,
                  Date: dateStr,
                  TotalHours: totalHours,
                  OvertimeHours: overtimeHours,
                  FirstIn: row.FirstIn,
                  LastOut: row.LastOut,
                  Source: 'Attendance'
                });
              }
            } else if (hasNewShiftMapEntry(row.EmployeeId, dateStr)) {
              // Shift is assigned in NewShiftMap but not resolved in Shift master -> fallback to General shift.
              const fallbackGeneralShift = getGeneralShiftDefinition();
              overtimeHours = fallbackGeneralShift
                ? calculateOvertimeForDynamicShift(row.LastOut, dateStr, fallbackGeneralShift.toTime)
                : calculateOvertimeForGeneralShift(row.LastOut, dateStr);
              if (overtimeHours > 0 || dateStr === '2026-01-03') {
                overtimeRecords.push({
                  EmployeeID: row.EmployeeId,
                  Date: dateStr,
                  TotalHours: totalHours,
                  OvertimeHours: overtimeHours,
                  FirstIn: row.FirstIn,
                  LastOut: row.LastOut,
                  Source: 'Attendance'
                });
              }
            } else if (isGeneralII) {
              // For General II shift: 12:00-20:00, OT if checkout after 21:00.
              overtimeHours = calculateOvertimeForGeneralIIShift(row.LastOut, dateStr);
              if (overtimeHours > 0 || dateStr === '2026-01-03') {
                overtimeRecords.push({
                  EmployeeID: row.EmployeeId,
                  Date: dateStr,
                  TotalHours: totalHours,
                  OvertimeHours: overtimeHours,
                  FirstIn: row.FirstIn,
                  LastOut: row.LastOut,
                  Source: 'Attendance'
                });
              }
            } else if (isGeneral) {
              // For General shift: Calculate OT if checkout is after 17:55.
              {
                const fallbackGeneralShift = getGeneralShiftDefinition();
                overtimeHours = fallbackGeneralShift
                  ? calculateOvertimeForDynamicShift(row.LastOut, dateStr, fallbackGeneralShift.toTime)
                  : calculateOvertimeForGeneralShift(row.LastOut, dateStr);
              }
              if (overtimeHours > 0 || dateStr === '2026-01-03') {
                overtimeRecords.push({
                  EmployeeID: row.EmployeeId,
                  Date: dateStr,
                  TotalHours: totalHours,
                  OvertimeHours: overtimeHours,
                  FirstIn: row.FirstIn,
                  LastOut: row.LastOut,
                  Source: 'Attendance'
                });
                console.log(`Added overtime record (General shift): ${row.EmployeeId} on ${dateStr} - ${totalHours}h total, checkout after 17:55, ${overtimeHours.toFixed(3)}h OT`);
              }
            } else if (isFirst) {
              // For 1st shift: Calculate OT if checkout is after 15:00.
              overtimeHours = calculateOvertimeForFirstShift(row.LastOut, dateStr);
              if (overtimeHours > 0 || dateStr === '2026-01-03') {
                overtimeRecords.push({
                  EmployeeID: row.EmployeeId,
                  Date: dateStr,
                  TotalHours: totalHours,
                  OvertimeHours: overtimeHours,
                  FirstIn: row.FirstIn,
                  LastOut: row.LastOut,
                  Source: 'Attendance'
                });
                console.log(`Added overtime record (1st shift): ${row.EmployeeId} on ${dateStr} - ${totalHours}h total, checkout after 15:00, ${overtimeHours.toFixed(2)}h OT`);
              }
            } else if (isSecond) {
              // For 2nd shift: Calculate OT if checkout is after 23:00.
              overtimeHours = calculateOvertimeForSecondShift(row.LastOut, dateStr);
              if (overtimeHours > 0 || dateStr === '2026-01-03') {
                overtimeRecords.push({
                  EmployeeID: row.EmployeeId,
                  Date: dateStr,
                  TotalHours: totalHours,
                  OvertimeHours: overtimeHours,
                  FirstIn: row.FirstIn,
                  LastOut: row.LastOut,
                  Source: 'Attendance'
                });
                console.log(`Added overtime record (2nd shift): ${row.EmployeeId} on ${dateStr} - ${totalHours}h total, checkout after 23:00, ${overtimeHours.toFixed(2)}h OT`);
              }
            } else {
              // For other shifts: Only include if total hours above 8.5h.
              if (totalHours > 8.5 || dateStr === '2026-01-03') {
                overtimeHours = (totalHours > 8.5 ? totalHours - 8.5 : 0);
                overtimeRecords.push({
                  EmployeeID: row.EmployeeId,
                  Date: dateStr,
                  TotalHours: totalHours,
                  OvertimeHours: overtimeHours,
                  FirstIn: row.FirstIn,
                  LastOut: row.LastOut,
                  Source: 'Attendance'
                });
                console.log(`Added overtime record: ${row.EmployeeId} - ${totalHours}h total, ${overtimeHours.toFixed(2)}h overtime`);
              }
            }
          });
        }
      }
     
      // If still no data source determined and we have BHR records, use BHR
      if (dataSource === 'none' && bhrRecords > 0) {
        dataSource = 'BHR';
      }
     
      console.log(`Final data source: ${dataSource}, Overtime records: ${overtimeRecords.length}`);
      console.log(`BHR records found: ${bhrRecords}, Attendance records found: ${attendanceRecords}`);
     
      // Build byKey structure similar to attendance muster to get accurate OT calculation
      // This ensures we use the same merged data source as attendance muster
      // ALWAYS build byKey regardless of whether we found records in original query
      const byKey = {}; // Key: empId_date -> { EmployeeID, Date, FirstIN, LastOUT, Source }
     
      // Build employee filter conditions for byKey queries (same as original)
      let employeeFilterConditionsForByKey = [];
      if (employeeId && employeeId !== 'All') {
        employeeFilterConditionsForByKey.push(`EmployeeID = '${employeeId}'`);
      }
     
      // Apply contractor filter for byKey
      if (contractor && contractor !== 'All') {
        try {
          const normalizedContractor = String(contractor || '').replace(/\s+/g, ' ').trim().replace(/'/g, "''");
          const contractorEmployeeQuery = await zcql.executeZCQLQuery(
            `SELECT EmployeeCode, ContractorName FROM Employee WHERE ContractorName LIKE '%${normalizedContractor}%'`
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
            employeeFilterConditionsForByKey.push(`EmployeeID IN (${employeeIdList})`);
          }
        } catch (error) {
          console.error('Error applying contractor filter for byKey:', error);
        }
      }
     
      // Apply department filter for byKey
      if (department && department !== 'All') {
        try {
          const departmentEmployeeQuery = await zcql.executeZCQLQuery(
            `SELECT EmployeeCode FROM Employee WHERE Department = '${department}'`
          );
         
          if (departmentEmployeeQuery && departmentEmployeeQuery.length > 0) {
            const departmentEmployeeIds = departmentEmployeeQuery.map(emp => emp.Employee.EmployeeCode);
            const employeeIdList = departmentEmployeeIds.map(id => `'${id}'`).join(',');
            if (employeeFilterConditionsForByKey.length > 0) {
              const existingCondition = employeeFilterConditionsForByKey[0];
              if (existingCondition.includes('IN (')) {
                const existingMatch = existingCondition.match(/IN \(([^)]+)\)/);
                if (existingMatch) {
                  const existingIds = existingMatch[1].split(',').map(id => id.trim().replace(/'/g, ''));
                  const intersection = existingIds.filter(id => departmentEmployeeIds.includes(id));
                  if (intersection.length > 0) {
                    employeeFilterConditionsForByKey[0] = `EmployeeID IN (${intersection.map(id => `'${id}'`).join(',')})`;
                  } else {
                    // No intersection, byKey will be empty
                    employeeFilterConditionsForByKey = [`EmployeeID IN ('')`];
                  }
                }
              }
            } else {
              employeeFilterConditionsForByKey.push(`EmployeeID IN (${employeeIdList})`);
            }
          }
        } catch (error) {
          console.error('Error applying department filter for byKey:', error);
        }
      }
     
      // Add BHR records to byKey (always try, not just if bhrRecords > 0)
      // This ensures we get data even if original query didn't find records due to different filters
      // Use pagination like attendance muster to handle large date ranges
      try {
        let offset = 0;
        const pageSize = 300;
        let hasMore = true;
        let allBhrRowsForByKey = [];
       
        while (hasMore) {
          let bhrQueryForByKey = `SELECT EmployeeID, EventTime, Direction FROM BHR
                                 WHERE EventTime >= '${startDate} 00:00:00'
                                 AND EventTime <= '${endDateStr} 23:59:59'`;
          if (employeeFilterConditionsForByKey.length > 0) {
            bhrQueryForByKey += ` AND ${employeeFilterConditionsForByKey.join(' AND ')}`;
          }
          bhrQueryForByKey += ` ORDER BY ROWID LIMIT ${pageSize} OFFSET ${offset}`;
         
          console.log(`Building byKey from BHR (offset ${offset}): ${bhrQueryForByKey.substring(0, 200)}...`);
          const bhrResultsForByKey = await zcql.executeZCQLQuery(bhrQueryForByKey);
          const bhrRowsForByKey = bhrResultsForByKey.map(r => r.BHR);
         
          if (bhrRowsForByKey.length === 0) {
            hasMore = false;
            break;
          }
         
          allBhrRowsForByKey.push(...bhrRowsForByKey);
          offset += pageSize;
         
          if (bhrRowsForByKey.length < pageSize) {
            hasMore = false;
          }
         
          // Safety guard for very large datasets
          if (allBhrRowsForByKey.length > 20000) {
            console.log(`Reached safety limit of 20000 BHR records, stopping pagination`);
            hasMore = false;
            break;
          }
        }
       
        console.log(`Found ${allBhrRowsForByKey.length} BHR records for byKey (paginated)`);
       
        if (allBhrRowsForByKey.length > 0) {
          // Group by employee and date
          const bhrByEmployeeDate = {};
          allBhrRowsForByKey.forEach(row => {
            const date = row.EventTime.split(' ')[0];
            const key = `${row.EmployeeID}_${date}`;
            if (!bhrByEmployeeDate[key]) {
              bhrByEmployeeDate[key] = {
                EmployeeID: row.EmployeeID,
                Date: date,
                events: []
              };
            }
            bhrByEmployeeDate[key].events.push(row);
          });
         
          // Process BHR data into byKey
          Object.values(bhrByEmployeeDate).forEach(empDateData => {
            const events = empDateData.events.sort((a, b) => new Date(a.EventTime) - new Date(b.EventTime));
            if (events.length >= 2) {
              const key = `${empDateData.EmployeeID}_${empDateData.Date}`;
              byKey[key] = {
                EmployeeID: empDateData.EmployeeID,
                Date: empDateData.Date,
                FirstIN: events[0].EventTime,
                LastOUT: events[events.length - 1].EventTime,
                Source: 'BHR'
              };
            }
          });
        }
      } catch (error) {
        console.error('Error building byKey from BHR:', error);
      }
     
      // Add Attendance records to byKey (merge with BHR if exists)
      // Always try to get attendance data to match attendance muster behavior
      // This ensures we use the same data source as attendance muster
      // Use pagination like attendance muster to handle large date ranges
      if (source !== 'bhr') {
        try {
          let attOffset = 0;
          let attHasMore = true;
          const attPageSize = 300;
          let allAttendanceResultsForByKey = [];
         
          while (attHasMore) {
            // Match attendance muster: Don't filter by AttendanceDate in query
            // Instead, fetch all records and filter by effective date from FirstIn/LastOut
            // This ensures we get the same data as attendance muster
            let attendanceQueryForByKey = `SELECT EmployeeId, AttendanceDate, FirstIn, LastOut, Status FROM Attendance`;
           
            // Apply employee filter if exists (note: Attendance table uses EmployeeId, not EmployeeID)
            if (employeeFilterConditionsForByKey.length > 0) {
              // Convert EmployeeID filter to EmployeeId for Attendance table
              const employeeIdConditions = employeeFilterConditionsForByKey.map(cond => {
                return cond.replace(/EmployeeID/g, 'EmployeeId');
              });
              attendanceQueryForByKey += ` WHERE ${employeeIdConditions.join(' AND ')}`;
            } else if (employeeId && employeeId !== 'All') {
              attendanceQueryForByKey += ` WHERE EmployeeId = '${employeeId}'`;
            }
           
            attendanceQueryForByKey += ` ORDER BY EmployeeId, AttendanceDate LIMIT ${attPageSize} OFFSET ${attOffset}`;
           
            console.log(`Building byKey from Attendance (offset ${attOffset}): ${attendanceQueryForByKey.substring(0, 200)}...`);
            const attendanceResultsForByKey = await zcql.executeZCQLQuery(attendanceQueryForByKey);
           
            if (attendanceResultsForByKey.length === 0) {
              attHasMore = false;
              break;
            }
           
            allAttendanceResultsForByKey.push(...attendanceResultsForByKey);
            attOffset += attPageSize;
           
            if (attendanceResultsForByKey.length < attPageSize) {
              attHasMore = false;
            }
           
            // Safety guard for very large datasets
            if (allAttendanceResultsForByKey.length > 20000) {
              console.log(`Reached safety limit of 20000 Attendance records, stopping pagination`);
              attHasMore = false;
              break;
            }
          }
         
          console.log(`Found ${allAttendanceResultsForByKey.length} Attendance records for byKey (paginated)`);
         
          // Helper: normalize time strings, including AM/PM and single-digit hours, return full datetime
          // This matches attendance muster exactly
          const normalizeTimeForDate = (dateStr, rawVal) => {
            if (!rawVal) return '';
            const raw = String(rawVal).trim();
            // If looks like full datetime already (YYYY-MM-DD), return as is
            if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(:\d{2})?$/.test(raw)) return raw;
            // If looks like DD-MM-YYYY HH:mm[:ss], convert to YYYY-MM-DD
            const dmy = raw.match(/^(\d{2})[-\/](\d{2})[-\/](\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/);
            if (dmy) {
              const DD = dmy[1], MM = dmy[2], YYYY = dmy[3];
              const hh = dmy[4], mm = dmy[5], ss = dmy[6] ? dmy[6] : '00';
              return `${YYYY}-${MM}-${DD} ${hh}:${mm}:${ss}`;
            }
            // Match H:MM[:SS][ AM|PM]
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
            // Fallback: if it's only time without seconds (e.g., 9:00), append :00
            if (/^\d{1,2}:\d{2}$/.test(raw)) {
              const [hStr, mStr] = raw.split(':');
              const HH = String(parseInt(hStr, 10)).padStart(2, '0');
              return `${dateStr} ${HH}:${mStr}:00`;
            }
            // As a last resort, try Date parse by combining
            const d = new Date(`${dateStr} ${raw}`);
            if (!isNaN(d)) {
              const HH = String(d.getHours()).padStart(2, '0');
              const MM = String(d.getMinutes()).padStart(2, '0');
              const SS = String(d.getSeconds()).padStart(2, '0');
              return `${dateStr} ${HH}:${MM}:${SS}`;
            }
            return '';
          };
         
          allAttendanceResultsForByKey.forEach(row => {
            const r = row.Attendance;
            // Try to compute a reliable date for the row (same logic as attendance muster)
            let dateStr = '';
            if (r.AttendanceDate) {
              if (typeof r.AttendanceDate === 'string') {
                if (/^\d{4}-\d{2}-\d{2}$/.test(r.AttendanceDate)) {
                  dateStr = r.AttendanceDate;
                } else {
                  const tmp = new Date(r.AttendanceDate);
                  if (!isNaN(tmp)) dateStr = tmp.toISOString().slice(0,10);
                }
              } else {
                const tmp = new Date(r.AttendanceDate);
                if (!isNaN(tmp)) dateStr = tmp.toISOString().slice(0,10);
              }
            }
           
            // Normalize FirstIn/LastOut to full datetime strings supporting AM/PM and single-digit hours
            // This matches attendance muster exactly
            const normalizedFirst = dateStr ? normalizeTimeForDate(dateStr, r.FirstIn) : normalizeTimeForDate('1970-01-01', r.FirstIn);
            const normalizedLast = dateStr ? normalizeTimeForDate(dateStr, r.LastOut) : normalizeTimeForDate('1970-01-01', r.LastOut);
           
            // If dateStr is still empty, try to derive from normalizedFirst/Last (YYYY-MM-DD ...)
            if (!dateStr) {
              const dt = (normalizedFirst || normalizedLast || '').match(/^(\d{4}-\d{2}-\d{2})\s+/);
              if (dt) dateStr = dt[1];
            }
           
            // Skip if we still don't have a date
            if (!dateStr) return;
           
            // Filter rows by the requested date range using the derived date (same as attendance muster)
            if (dateStr < startDate || dateStr > endDateStr) return;
           
            const key = `${r.EmployeeId}_${dateStr}`;
           
            if (!byKey[key]) {
              byKey[key] = {
                EmployeeID: r.EmployeeId,
                Date: dateStr,
                FirstIN: normalizedFirst,
                LastOUT: normalizedLast,
                Source: 'Attendance',
                Status: r.Status || ''
              };
            } else {
              // Merge with existing BHR data - keep earliest FirstIN and latest LastOUT (same as attendance muster)
              if (normalizedFirst && (!byKey[key].FirstIN || normalizedFirst < byKey[key].FirstIN)) {
                byKey[key].FirstIN = normalizedFirst;
              }
              if (normalizedLast && (!byKey[key].LastOUT || normalizedLast > byKey[key].LastOUT)) {
                byKey[key].LastOUT = normalizedLast;
              }
              byKey[key].Source = 'Both';
              if (r.Status) byKey[key].Status = r.Status;
            }
          });
        } catch (error) {
          console.error('Error building byKey from Attendance:', error);
        }
      }

      // Merge OnDuty records into byKey (OnDuty takes precedence, same as Attendance Muster).
      // This is critical so OT totals reflect imported OnDuty FirstIn/LastOut as well.
      try {
        let ondutyOffset = 0;
        let ondutyHasMore = true;
        const ondutyPageSize = 300;
        let allOnDutyResultsForByKey = [];

        while (ondutyHasMore) {
          // Filter by OnDutyDate range (OnDutyDate is normalized to YYYY-MM-DD by onduty_function)
          let ondutyQueryForByKey = `SELECT EmployeeCode, OnDutyDate, NoofHours, FirstIn, Lastout FROM OnDuty WHERE OnDutyDate >= '${startDate}' AND OnDutyDate <= '${endDateStr}'`;

          // Apply employee filters (EmployeeID -> EmployeeCode)
          if (employeeFilterConditionsForByKey.length > 0) {
            const ondutyEmployeeConds = employeeFilterConditionsForByKey.map(cond => cond.replace(/EmployeeID/g, 'EmployeeCode'));
            ondutyQueryForByKey += ` AND ${ondutyEmployeeConds.join(' AND ')}`;
          } else if (employeeId && employeeId !== 'All') {
            ondutyQueryForByKey += ` AND EmployeeCode = '${employeeId}'`;
          }

          ondutyQueryForByKey += ` ORDER BY EmployeeCode, OnDutyDate LIMIT ${ondutyPageSize} OFFSET ${ondutyOffset}`;

          console.log(`Building byKey from OnDuty (offset ${ondutyOffset}): ${ondutyQueryForByKey.substring(0, 200)}...`);
          const ondutyResultsForByKey = await zcql.executeZCQLQuery(ondutyQueryForByKey);

          if (!ondutyResultsForByKey || ondutyResultsForByKey.length === 0) {
            ondutyHasMore = false;
            break;
          }

          allOnDutyResultsForByKey.push(...ondutyResultsForByKey);
          ondutyOffset += ondutyPageSize;

          if (ondutyResultsForByKey.length < ondutyPageSize) {
            ondutyHasMore = false;
          }

          // Safety guard for very large datasets
          if (allOnDutyResultsForByKey.length > 20000) {
            console.log(`Reached safety limit of 20000 OnDuty records, stopping pagination`);
            ondutyHasMore = false;
            break;
          }
        }

        console.log(`Found ${allOnDutyResultsForByKey.length} OnDuty records for byKey (paginated)`);

        // Helper: normalize time strings to full datetime, including AM/PM and single-digit hours.
        const normalizeTimeForDateOnDuty = (dateStr, rawVal) => {
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

        allOnDutyResultsForByKey.forEach(row => {
          const r = row.OnDuty || row;
          const empCode = String(r.EmployeeCode || '').trim();
          if (!empCode) return;

          let dateStr = '';
          if (r.OnDutyDate) {
            if (typeof r.OnDutyDate === 'string') {
              const raw = String(r.OnDutyDate).trim();
              if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
                dateStr = raw;
              } else {
                const tmp = new Date(raw);
                if (!isNaN(tmp)) dateStr = tmp.toISOString().slice(0, 10);
              }
            } else {
              const tmp = new Date(r.OnDutyDate);
              if (!isNaN(tmp)) dateStr = tmp.toISOString().slice(0, 10);
            }
          }

          if (!dateStr) return;
          if (dateStr < startDate || dateStr > endDateStr) return;

          let normalizedFirst = normalizeTimeForDateOnDuty(dateStr, r.FirstIn);
          let normalizedLast = normalizeTimeForDateOnDuty(dateStr, r.Lastout);
          if (!normalizedFirst) normalizedFirst = `${dateStr} 08:25:00`;
          if (!normalizedLast) {
            const nof = String(r.NoofHours || '').trim().toLowerCase();
            normalizedLast = (nof === 'half day' || nof === 'halfday' || nof === '0.5') ? `${dateStr} 13:00:00` : `${dateStr} 16:55:00`;
          }

          const key = `${empCode}_${dateStr}`;
          const isHalfDay = (() => {
            const nof = String(r.NoofHours || '').trim().toLowerCase();
            return nof === 'half day' || nof === 'halfday' || nof === '0.5';
          })();
          const existing = byKey[key];

          if (isHalfDay && existing) {
            // Half day: merge earliest FirstIN and latest LastOUT
            const existingFirst = existing.FirstIN || normalizedFirst;
            const existingLast = existing.LastOUT || normalizedLast;
            byKey[key] = {
              EmployeeID: empCode,
              Date: dateStr,
              FirstIN: existingFirst <= normalizedFirst ? existingFirst : normalizedFirst,
              LastOUT: existingLast >= normalizedLast ? existingLast : normalizedLast,
              Source: (existing.Source && !existing.Source.includes('OnDuty')) ? existing.Source + '+OnDuty' : 'OnDuty'
            };
          } else {
            // Full day or no existing: OnDuty takes complete precedence
            byKey[key] = {
              EmployeeID: empCode,
              Date: dateStr,
              FirstIN: normalizedFirst,
              LastOUT: normalizedLast,
              Source: 'OnDuty'
            };
          }
        });
      } catch (error) {
        console.error('Error building byKey from OnDuty:', error);
      }

      // Merge Regularization records into byKey (same as attendance muster).
      // This ensures OT is calculated for days that have only Regularization (no BHR/Attendance).
      try {
        let regularizationOffset = 0;
        const regularizationPageSize = 300;
        let regularizationHasMore = true;

        while (regularizationHasMore) {
          let regularizationQuery = `SELECT EmployeeCode, EmployeeName, LogDate, FirstIn, LastOut FROM Regularization
                                    WHERE LogDate >= '${startDate}'
                                    AND LogDate <= '${endDateStr}'`;

          if (employeeFilterConditionsForByKey.length > 0) {
            const employeeIdList = employeeFilterConditionsForByKey[0].match(/IN\s*\(([^)]+)\)/);
            if (employeeIdList && employeeIdList[1]) {
              const ids = employeeIdList[1].replace(/'/g, '').split(',').map(s => s.trim()).filter(Boolean);
              if (ids.length > 0) {
                regularizationQuery += ` AND EmployeeCode IN (${ids.map(id => `'${id}'`).join(',')})`;
              }
            }
          } else if (employeeId && employeeId !== 'All') {
            regularizationQuery += ` AND EmployeeCode = '${employeeId}'`;
          }

          regularizationQuery += ` ORDER BY EmployeeCode, LogDate LIMIT ${regularizationPageSize} OFFSET ${regularizationOffset}`;

          const regularizationBatch = await zcql.executeZCQLQuery(regularizationQuery);
          const regularizationRows = regularizationBatch.map(r => r.Regularization);

          if (regularizationRows.length === 0) {
            regularizationHasMore = false;
            break;
          }

          regularizationRows.forEach(r => {
            let dateStr = '';
            if (r.LogDate) {
              const logDateStr = String(r.LogDate).trim();
              const dateMatch = logDateStr.match(/^(\d{4}-\d{2}-\d{2})/);
              if (dateMatch) {
                dateStr = dateMatch[1];
              } else {
                const tmp = new Date(r.LogDate);
                if (!isNaN(tmp)) dateStr = tmp.toISOString().slice(0, 10);
              }
            }
            if (!dateStr || dateStr < startDate || dateStr > endDateStr) return;

            const employeeCode = String(r.EmployeeCode || '').trim();
            if (!employeeCode) return;

            const key = `${employeeCode}_${dateStr}`;

            const firstInRaw = r.FirstIn ?? r['First In'];
            const lastOutRaw = r.LastOut ?? r['Last Out'];

            let firstInDateTime = '';
            let lastOutDateTime = '';

            if (firstInRaw) {
              const firstInStr = String(firstInRaw).trim();
              if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(firstInStr)) {
                const timePart = firstInStr.length === 5 ? firstInStr : firstInStr.substring(0, 5);
                firstInDateTime = `${dateStr} ${timePart}:00`.substring(0, 19);
              } else if (firstInStr.includes(' ')) {
                firstInDateTime = firstInStr.substring(0, 19);
              } else {
                const tmp = new Date(firstInStr);
                if (!isNaN(tmp)) {
                  const y = tmp.getFullYear();
                  const m = String(tmp.getMonth() + 1).padStart(2, '0');
                  const d = String(tmp.getDate()).padStart(2, '0');
                  const h = String(tmp.getHours()).padStart(2, '0');
                  const min = String(tmp.getMinutes()).padStart(2, '0');
                  const s = String(tmp.getSeconds()).padStart(2, '0');
                  firstInDateTime = `${y}-${m}-${d} ${h}:${min}:${s}`;
                }
              }
            }

            if (lastOutRaw) {
              const lastOutStr = String(lastOutRaw).trim();
              if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(lastOutStr)) {
                const timePart = lastOutStr.length === 5 ? lastOutStr : lastOutStr.substring(0, 5);
                lastOutDateTime = `${dateStr} ${timePart}:00`.substring(0, 19);
              } else if (lastOutStr.includes(' ')) {
                lastOutDateTime = lastOutStr.substring(0, 19);
              } else {
                const tmp = new Date(lastOutStr);
                if (!isNaN(tmp)) {
                  const y = tmp.getFullYear();
                  const m = String(tmp.getMonth() + 1).padStart(2, '0');
                  const d = String(tmp.getDate()).padStart(2, '0');
                  const h = String(tmp.getHours()).padStart(2, '0');
                  const min = String(tmp.getMinutes()).padStart(2, '0');
                  const s = String(tmp.getSeconds()).padStart(2, '0');
                  lastOutDateTime = `${y}-${m}-${d} ${h}:${min}:${s}`;
                }
            }
          }

            if (firstInDateTime && lastOutDateTime) {
              try {
                const fi = new Date(String(firstInDateTime).substring(0, 19).replace(' ', 'T'));
                const lo = new Date(String(lastOutDateTime).substring(0, 19).replace(' ', 'T'));
                if (!isNaN(fi.getTime()) && !isNaN(lo.getTime()) && lo.getTime() <= fi.getTime()) {
                  lo.setDate(lo.getDate() + 1);
                  const y = lo.getFullYear();
                  const mo = String(lo.getMonth() + 1).padStart(2, '0');
                  const da = String(lo.getDate()).padStart(2, '0');
                  const h = String(lo.getHours()).padStart(2, '0');
                  const min = String(lo.getMinutes()).padStart(2, '0');
                  const sec = String(lo.getSeconds()).padStart(2, '0');
                  lastOutDateTime = `${y}-${mo}-${da} ${h}:${min}:${sec}`;
                }
              } catch (_) { /* keep lastOutDateTime */ }
            }

            if (byKey[key]) {
              const currentSource = byKey[key].Source || '';
              if (!currentSource.includes('OnDuty') && !sourceHasCompOffTakenSegment(currentSource)) {
                if (firstInDateTime) byKey[key].FirstIN = firstInDateTime;
                if (lastOutDateTime) byKey[key].LastOUT = lastOutDateTime;
                byKey[key].Source = currentSource === 'BHR' || currentSource === 'Attendance' || currentSource === 'Both'
                  ? (currentSource + '+Regularization')
                  : (currentSource || 'Regularization');
              }
            } else {
              byKey[key] = {
                EmployeeID: employeeCode,
                Date: dateStr,
                FirstIN: firstInDateTime || null,
                LastOUT: lastOutDateTime || null,
                Source: 'Regularization'
              };
            }
          });

          regularizationOffset += regularizationPageSize;
          if (regularizationRows.length < regularizationPageSize) regularizationHasMore = false;
        }

        console.log(`Merged Regularization records into byKey for monthly OT`);
      } catch (regErr) {
        console.error('Error building byKey from Regularization:', regErr);
      }

      // Fetch CompOff and apply Comboff=Yes exclusions so Monthly OT Report does not count OT for those days
      try {
        let compoffOffset = 0;
        let compoffHasMore = true;
        const compoffPageSize = 300;
        let employeeIdsForCompoff = [];
        if (employeeFilterConditionsForByKey.length > 0) {
          const inMatch = employeeFilterConditionsForByKey[0].match(/IN\s*\(([^)]+)\)/);
          if (inMatch && inMatch[1]) {
            employeeIdsForCompoff = inMatch[1].replace(/'/g, '').split(',').map(s => s.trim()).filter(Boolean);
          }
        }
        while (compoffHasMore) {
          let compoffQuery = `SELECT EmployeeCode, EmployeeName, WorkedOn, Taken, ComboffStatus, OT FROM Comboff`;
          if (employeeIdsForCompoff.length > 0) {
            compoffQuery += ` WHERE EmployeeCode IN (${employeeIdsForCompoff.map(id => `'${id}'`).join(',')})`;
          }
          compoffQuery += ` ORDER BY EmployeeCode, Taken LIMIT ${compoffPageSize} OFFSET ${compoffOffset}`;
          const compoffBatch = await zcql.executeZCQLQuery(compoffQuery);
          const compoffRows = compoffBatch.map(r => r.Comboff);
          if (compoffRows.length === 0) {
            compoffHasMore = false;
            break;
          }
          const normalizeDateCompoff = (dateValue) => {
            if (!dateValue) return '';
            if (typeof dateValue === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateValue)) return dateValue;
            const tmp = new Date(dateValue);
            return !isNaN(tmp) ? tmp.toISOString().slice(0, 10) : '';
          };
          const isWoDateCompoff = (dateStr) => {
            if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
            const d = new Date(dateStr);
            return d.getDay() === 0 || (d.getDay() === 6 && d.getDate() >= 1 && d.getDate() <= 7);
          };
          const compoffStatusYes = (v) => (String(v || '').trim().toLowerCase() === 'yes');
          compoffRows.forEach(r => {
            const employeeCode = String(r.EmployeeCode || '').trim();
            if (!employeeCode) return;
            const comboffYes = compoffStatusYes(r.ComboffStatus);
            const otYes = compoffStatusYes(r.OT);
            let workedOnDateStr = normalizeDateCompoff(r.WorkedOn);
            if (workedOnDateStr && workedOnDateStr >= startDate && workedOnDateStr <= endDateStr) {
              const workedOnKey = `${employeeCode}_${workedOnDateStr}`;
              if (comboffYes && isWoDateCompoff(workedOnDateStr)) compoffWoExcludeFromOT.add(workedOnKey);
              if (otYes) otYesFullHoursKeys.add(workedOnKey);
            }
            let takenDateStr = normalizeDateCompoff(r.Taken);
            if (takenDateStr && takenDateStr >= startDate && takenDateStr <= endDateStr) {
              const takenKey = `${employeeCode}_${takenDateStr}`;
              if (comboffYes) compoffWoExcludeFromOT.add(takenKey);
            }
          });
          compoffOffset += compoffPageSize;
          if (compoffRows.length < compoffPageSize) compoffHasMore = false;
        }
        compoffWoExcludeFromOT.forEach(k => OT_EXCLUSIONS.add(k));
        console.log(`Applied CompOff exclusions for Monthly OT: ${compoffWoExcludeFromOT.size} employee-dates (Comboff=Yes)`);
      } catch (compoffErr) {
        console.error('Error fetching CompOff for monthly OT exclusions:', compoffErr);
      }
     
      // Now recalculate OT from byKey using the same logic as attendance muster
      // This ensures we use the same data source and calculation as attendance muster
      console.log(`Building byKey complete. Total records in byKey: ${Object.keys(byKey).length}`);
      const overtimeFromByKey = [];

      // Helper functions to identify Weekly Off (WO) days
      const isSunday = (dateStr) => {
        const d = new Date(dateStr);
        return d.getDay() === 0; // 0 = Sunday
      };

      // Fetch declared holidays (Calendar table + hardcoded) so present-on-H days get full OT (aligned with muster "H")
      const holidaySetForOT = new Set();
      try {
        const holidayQuery = `SELECT CalendarDate FROM Calendar WHERE CalendarDate >= '${startDate}' AND CalendarDate <= '${endDateStr}'`;
        const holidays = await zcql.executeZCQLQuery(holidayQuery);
        if (holidays && holidays.length > 0) {
          holidays.forEach(row => {
            let holidayDate = row.Calendar?.CalendarDate || row.CalendarDate;
            if (holidayDate) {
              if (holidayDate.includes('T')) holidayDate = holidayDate.split('T')[0];
              else if (holidayDate.length > 10) holidayDate = holidayDate.substring(0, 10);
              holidaySetForOT.add(holidayDate);
            }
          });
          console.log(`Loaded ${holidaySetForOT.size} declared holidays from Calendar for OT (present-on-H = full OT)`);
        }
      } catch (err) {
        console.log('Calendar holidays for OT (optional):', err.message);
      }
      const isDeclaredHoliday = (dateStr) => {
        if (!dateStr) return false;
        if (holidaySetForOT.has(dateStr)) return true;
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return false;
        const month = d.getMonth();
        const day = d.getDate();
        if (month === 0 && day === 1) return true;   // Jan 1
        if (month === 0 && day === 15) return true;  // Pongal
        if (month === 0 && day === 16) return true;  // Thiruvallur
        if (month === 0 && day === 17) return true;  // Uzhavar Thirunal
        if (month === 0 && day === 26) return true;  // Republic Day
        if (month === 3 && day === 14) return true;  // Tamil New Year
        if (month === 4 && day === 1) return true;   // May Day
        if (month === 7 && day === 15) return true;  // Independence Day
        if (month === 8 && day === 14) return true;  // Vinayakar Chaturthi
        if (month === 9 && day === 2) return true;   // Gandhi Jayanthi
        if (month === 9 && day === 19) return true; // Ayudha Pooja
        if (month === 11 && day === 25) return true; // Christmas
        return false;
      };

      Object.values(byKey).forEach(rec => {
        if (!rec.FirstIN || !rec.LastOUT) return;
       
        try {
          const exclusionKey = `${String(rec.EmployeeID).trim()}_${rec.Date}`;
          const firstInDate = new Date(rec.FirstIN.replace(' ', 'T'));
          const lastOutDate = new Date(rec.LastOUT.replace(' ', 'T'));
          const totalHours = !isNaN(firstInDate) && !isNaN(lastOutDate)
            ? (lastOutDate - firstInDate) / (1000 * 60 * 60)
            : 0;
          if (otYesFullHoursKeys.has(exclusionKey)) {
            const finalOtHours = isOTExcluded(rec.EmployeeID, rec.Date) ? 0 : totalHours;
            overtimeFromByKey.push({
              EmployeeID: rec.EmployeeID,
              Date: rec.Date,
              TotalHours: totalHours,
              OvertimeHours: finalOtHours,
              FirstIn: rec.FirstIN,
              LastOut: rec.LastOUT,
              Source: rec.Source
            });
            return;
          }
          // Holiday (H): present on declared holiday → OT = total hours (not shift-based).
          const isPresentOnHoliday = (String(rec.Status || '').trim().toUpperCase() === 'H') || isDeclaredHoliday(rec.Date);
          if (isPresentOnHoliday && totalHours > 0) {
            const finalOtHours = isOTExcluded(rec.EmployeeID, rec.Date) ? 0 : totalHours;
            overtimeFromByKey.push({
              EmployeeID: rec.EmployeeID,
              Date: rec.Date,
              TotalHours: totalHours,
              OvertimeHours: finalOtHours,
              FirstIn: rec.FirstIN,
              LastOut: rec.LastOUT,
              Source: rec.Source
            });
            return;
          }
          // Weekly Off (WO): present on Sunday → OT = total hours (not shift-based).
          const isWeekOff = isSunday(rec.Date);
          const useWOModel = isWeekOff && rec.Date !== '2026-01-03';
          if (useWOModel && totalHours > 0) {
            const finalOtHours = isOTExcluded(rec.EmployeeID, rec.Date) ? 0 : totalHours;
            overtimeFromByKey.push({
              EmployeeID: rec.EmployeeID,
              Date: rec.Date,
              TotalHours: totalHours,
              OvertimeHours: finalOtHours,
              FirstIn: rec.FirstIN,
              LastOut: rec.LastOUT,
              Source: rec.Source
            });
            return;
          }
          // No shift assigned in NewShiftMap for this employee-date → use General shift OT (e.g. 08:12-16:55 = 0 OT).
          const hasShiftInfo = Object.keys(shiftMap).length > 0 || Object.keys(newShiftMap).length > 0;
          const isHousekeeping = hasShiftInfo ? isHousekeepingShift(rec.EmployeeID, rec.Date) : false;
          const assignedShiftDef = getShiftDefinitionForEmployeeDate(rec.EmployeeID, rec.Date);
          if (!hasNewShiftMapEntry(rec.EmployeeID, rec.Date) && !assignedShiftDef && !isHousekeeping) {
            const fallbackGeneralShift = getGeneralShiftDefinition();
            const otHoursGeneral = fallbackGeneralShift
              ? calculateOvertimeForDynamicShift(rec.LastOUT, rec.Date, fallbackGeneralShift.toTime)
              : calculateOvertimeForGeneralShift(rec.LastOUT, rec.Date);
            const finalOtHours = isOTExcluded(rec.EmployeeID, rec.Date) ? 0 : otHoursGeneral;
            overtimeFromByKey.push({
              EmployeeID: rec.EmployeeID,
              Date: rec.Date,
              TotalHours: totalHours,
              OvertimeHours: finalOtHours,
              FirstIn: rec.FirstIN,
              LastOut: rec.LastOUT,
              Source: rec.Source
            });
            return;
          }
          const isGeneralII = hasShiftInfo ? isGeneralIIShiftMonthlyOT(rec.EmployeeID, rec.Date) : false;
          const isGeneral = hasShiftInfo ? isGeneralShift(rec.EmployeeID, rec.Date) : false;
          const isFirst = hasShiftInfo ? isFirstShift(rec.EmployeeID, rec.Date) : false;
          const isSecond = hasShiftInfo ? isSecondShift(rec.EmployeeID, rec.Date) : false;
         
          // Debug logging for shift detection
          if (rec.EmployeeID && rec.Date && (rec.LastOUT && rec.LastOUT.includes('23:59') || rec.LastOUT && rec.LastOUT.includes('23:5'))) {
            console.log(`[Monthly OT Debug] Employee ${rec.EmployeeID} on ${rec.Date}: FirstIN=${rec.FirstIN}, LastOUT=${rec.LastOUT}, hasShiftInfo=${hasShiftInfo}, isHK=${isHousekeeping}, isGeneral=${isGeneral}, isFirst=${isFirst}, isSecond=${isSecond}`);
          }

          let otHours = 0;
          // Holiday and WO already handled above (total hours, early return). Here only shift-based.
          if (isHousekeeping) {
            // Housekeeping: OT only when total > 9h; then OT = total − 8. No early-arrival OT.
            if (!isNaN(firstInDate) && !isNaN(lastOutDate)) {
              const diffMs = lastOutDate - firstInDate;
              if (diffMs > 0) {
                const totalWorkingHours = diffMs / (1000 * 60 * 60);
                otHours = totalWorkingHours > 9 ? (totalWorkingHours - 8) : 0;
              }
            }
          } else if (assignedShiftDef) {
            otHours =
              calculateOvertimeForDynamicShift(rec.LastOUT, rec.Date, assignedShiftDef.toTime);
          } else if (hasNewShiftMapEntry(rec.EmployeeID, rec.Date)) {
            // Shift is assigned in NewShiftMap but not resolved in Shift master -> fallback to General shift.
            const fallbackGeneralShift = getGeneralShiftDefinition();
            otHours = fallbackGeneralShift
              ? calculateOvertimeForDynamicShift(rec.LastOUT, rec.Date, fallbackGeneralShift.toTime)
              : calculateOvertimeForGeneralShift(rec.LastOUT, rec.Date);
          } else if (isGeneralII) {
            // For General II shift: 12:00-20:00, OT if checkout after 21:00.
            otHours = calculateOvertimeForGeneralIIShift(rec.LastOUT, rec.Date);
          } else if (isGeneral) {
            // For General shift: OT if checkout after 17:55.
            {
              const fallbackGeneralShift = getGeneralShiftDefinition();
              otHours = fallbackGeneralShift
                ? calculateOvertimeForDynamicShift(rec.LastOUT, rec.Date, fallbackGeneralShift.toTime)
                : calculateOvertimeForGeneralShift(rec.LastOUT, rec.Date);
            }
            if (rec.EmployeeID && rec.Date && (rec.LastOUT && rec.LastOUT.includes('23:59') || rec.LastOUT && rec.LastOUT.includes('23:5'))) {
              console.log(`[Monthly OT Debug] General shift OT calculated: ${otHours} hours for Employee ${rec.EmployeeID} on ${rec.Date}`);
            }
          } else if (isFirst) {
            // For 1st shift: OT if checkout after 15:00.
            otHours = calculateOvertimeForFirstShift(rec.LastOUT, rec.Date);
          } else if (isSecond) {
            // For 2nd shift: OT if checkout after 23:00.
            otHours = calculateOvertimeForSecondShift(rec.LastOUT, rec.Date);
          } else {
            // Shift not matched (should not happen when NewShiftMap has entry). Default to General shift logic.
            {
              const fallbackGeneralShift = getGeneralShiftDefinition();
              otHours = fallbackGeneralShift
                ? calculateOvertimeForDynamicShift(rec.LastOUT, rec.Date, fallbackGeneralShift.toTime)
                : calculateOvertimeForGeneralShift(rec.LastOUT, rec.Date);
            }
          }

          const finalOtHours = isOTExcluded(rec.EmployeeID, rec.Date) ? 0 : otHours;
         
          overtimeFromByKey.push({
            EmployeeID: rec.EmployeeID,
            Date: rec.Date,
            TotalHours: totalHours,
            OvertimeHours: finalOtHours, // Can be 0, which is fine - we'll display it
            FirstIn: rec.FirstIN,
            LastOut: rec.LastOUT,
            Source: rec.Source
          });
        } catch (error) {
          console.error(`Error calculating OT from byKey for ${rec.EmployeeID} on ${rec.Date}:`, error);
        }
      });
     
      console.log(`Calculated ${overtimeFromByKey.length} OT records from byKey`);
      console.log(`byKey sample records:`, Object.keys(byKey).slice(0, 5).map(k => ({ key: k, data: byKey[k] })));
     
      // ALWAYS use overtimeFromByKey if we have any records in byKey (even if OT is 0 for some)
      // This ensures we use the same data source as attendance muster
      // Only fall back to overtimeRecords if byKey is completely empty
      const finalOvertimeRecords = Object.keys(byKey).length > 0 ? overtimeFromByKey : overtimeRecords;
      console.log(`Using ${finalOvertimeRecords.length} overtime records (${overtimeFromByKey.length} from byKey with ${Object.keys(byKey).length} total byKey records, ${overtimeRecords.length} from original calculation)`);
     
      if (finalOvertimeRecords.length === 0) {
        console.log(`No overtime records found. byKey has ${Object.keys(byKey).length} records, overtimeFromByKey has ${overtimeFromByKey.length} records, overtimeRecords has ${overtimeRecords.length} records`);
        console.log(`Date range used: ${startDate} to ${endDateStr}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          data: [],
          dataSource: dataSource,
          summary: {
            totalEmployees: 0,
            totalDays: 0,
            bhrRecords: bhrRecords,
            attendanceRecords: attendanceRecords,
            dataSourceUsed: dataSource,
            sourceDescription: dataSource === 'BHR' ? 'ESSL Server Data (Device Transactions)' :
                              dataSource === 'Attendance' ? 'Imported Excel Data' : 'No Data Found',
            debugInfo: {
              month: month || null,
              startDate: startDateOnly,
              endDate: endDateOnly,
              contractor: contractor,
              department: department,
              employeeId: employeeId
            }
          }
        }));
        return;
      }
     
      // 1. Get ALL employees from Employee table based on filters (like attendance muster does)
      // This ensures we show all employees, not just those with attendance data
      let employeeIds = [];
     
      // Build employee filter based on contractor, department, employeeId
      const activeEmployeeCondition = ` AND (DateofExit IS NULL OR DateofExit = '')`;
      if (contractor && contractor !== 'All') {
        try {
          const normalizedContractor = String(contractor || '').replace(/\s+/g, ' ').trim().replace(/'/g, "''");
          const contractorEmployeeQuery = await zcql.executeZCQLQuery(
            `SELECT EmployeeCode FROM Employee WHERE ContractorName LIKE '%${normalizedContractor}%'${activeEmployeeCondition}`
          );
          if (contractorEmployeeQuery && contractorEmployeeQuery.length > 0) {
            employeeIds = contractorEmployeeQuery.map(emp => String(emp.Employee?.EmployeeCode || '').trim()).filter(Boolean);
            console.log(`Contractor filter "${contractor}": Found ${employeeIds.length} employees`);
          }
        } catch (error) {
          console.error('Error applying contractor filter:', error);
        }
      }
     
      if (department && department !== 'All') {
        try {
          const departmentEmployeeQuery = await zcql.executeZCQLQuery(
            `SELECT EmployeeCode FROM Employee WHERE Department = '${department}'${activeEmployeeCondition}`
          );
          if (departmentEmployeeQuery && departmentEmployeeQuery.length > 0) {
            const departmentEmployeeIds = departmentEmployeeQuery.map(emp => String(emp.Employee?.EmployeeCode || '').trim()).filter(Boolean);
            if (employeeIds.length > 0) {
              employeeIds = employeeIds.filter(id => departmentEmployeeIds.includes(id));
            } else {
              employeeIds = departmentEmployeeIds;
            }
            console.log(`Department filter "${department}": Found ${employeeIds.length} employees`);
          }
        } catch (error) {
          console.error('Error applying department filter:', error);
        }
      }
     
      if (employeeId && employeeId !== 'All') {
        if (employeeIds.length > 0) {
          employeeIds = employeeIds.filter(id => id === String(employeeId).trim());
        } else {
          employeeIds = [String(employeeId).trim()];
        }
        console.log(`Employee filter "${employeeId}": Found ${employeeIds.length} employees`);
      }
     
      // If no filters, get ALL employees from Employee table (not just those with attendance data)
      // This ensures all employees show up when dates are selected
      if (employeeIds.length === 0) {
        try {
          const allEmployeesQuery = await zcql.executeZCQLQuery(
            `SELECT EmployeeCode FROM Employee WHERE 1=1${activeEmployeeCondition}`
          );
          if (allEmployeesQuery && allEmployeesQuery.length > 0) {
            employeeIds = allEmployeesQuery.map(emp => String(emp.Employee?.EmployeeCode || '').trim()).filter(Boolean);
            console.log(`No filters applied, using ALL ${employeeIds.length} employees from Employee table`);
          } else {
            // Fallback: if Employee table query fails, use byKey
            const uniqueEmpIdsFromByKey = [...new Set(Object.values(byKey).map(rec => String(rec.EmployeeID || '').trim()).filter(Boolean))];
            employeeIds = uniqueEmpIdsFromByKey;
            console.log(`No filters applied, fallback to ${employeeIds.length} employees from byKey`);
          }
        } catch (error) {
          console.error('Error fetching all employees:', error);
          // Fallback: use byKey
          const uniqueEmpIdsFromByKey = [...new Set(Object.values(byKey).map(rec => String(rec.EmployeeID || '').trim()).filter(Boolean))];
          employeeIds = uniqueEmpIdsFromByKey;
          console.log(`Error fetching all employees, fallback to ${employeeIds.length} employees from byKey`);
        }
      }
     
      // Also include employees from byKey who might not be in the filtered list
      // This ensures employees with attendance data are always included
      const uniqueEmpIdsFromByKey = [...new Set(Object.values(byKey).map(rec => String(rec.EmployeeID || '').trim()).filter(Boolean))];
      const uniqueEmpIds = [...new Set([...employeeIds, ...uniqueEmpIdsFromByKey])];
     
      console.log(`Found ${uniqueEmpIds.length} unique employees (${employeeIds.length} from filters, ${uniqueEmpIdsFromByKey.length} from byKey)`);
      console.log(`Date range for attendance data: ${startDate} to ${endDateStr}`);
      console.log(`Total byKey records: ${Object.keys(byKey).length}`);
      console.log(`Sample EmployeeIDs (first 5):`, uniqueEmpIds.slice(0, 5).map(id => ({ id, type: typeof id, length: id.length })));
     
      if (uniqueEmpIds.length === 0) {
        console.log('No unique employees found');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          data: [],
          dataSource: dataSource,
          summary: {
            totalEmployees: 0,
            totalDays: 0,
            bhrRecords: bhrRecords,
            attendanceRecords: attendanceRecords,
            dataSourceUsed: dataSource,
            sourceDescription: dataSource === 'BHR' ? 'ESSL Server Data (Device Transactions)' :
                              dataSource === 'Attendance' ? 'Imported Excel Data' : 'No Data Found'
          }
        }));
        return;
      }
     
      // 2. Query Employee table for these EmployeeCodes
      // Try both with and without quotes to handle number vs string mismatch
      // Handle large lists by batching if needed (ZCQL has limits)
      const batchSize = 300;
      let allEmpRecords = [];
     
      for (let i = 0; i < uniqueEmpIds.length; i += batchSize) {
        const batch = uniqueEmpIds.slice(i, i + batchSize);
       
        // First try with quotes (string matching). Include DateofExit and Category for OT applicable filter.
        let empQuery = `SELECT EmployeeCode, EmployeeName, Department, Designation, Category, ContractorName, DateofExit FROM Employee WHERE EmployeeCode IN (${batch.map(id => `'${String(id).replace(/'/g, "''")}'`).join(',')})`;
        console.log(`Querying Employee table for batch ${Math.floor(i/batchSize) + 1} (${batch.length} employees) with quotes: ${batch.slice(0, 3).join(', ')}${batch.length > 3 ? '...' : ''}`);
        try {
          const batchRecords = await zcql.executeZCQLQuery(empQuery);
          if (batchRecords.length > 0) {
            allEmpRecords.push(...batchRecords);
            console.log(`Found ${batchRecords.length} employees in batch ${Math.floor(i/batchSize) + 1} with quoted query`);
          } else {
            // If no results with quotes, try without quotes (for numeric EmployeeCodes)
            console.log(`No results with quoted query, trying without quotes for batch ${Math.floor(i/batchSize) + 1}`);
            const numericBatch = batch.filter(id => !isNaN(id));
            if (numericBatch.length > 0) {
              empQuery = `SELECT EmployeeCode, EmployeeName, Department, Designation, Category, ContractorName, DateofExit FROM Employee WHERE EmployeeCode IN (${numericBatch.join(',')})`;
              try {
                const numericRecords = await zcql.executeZCQLQuery(empQuery);
                if (numericRecords.length > 0) {
                  allEmpRecords.push(...numericRecords);
                  console.log(`Found ${numericRecords.length} employees in batch ${Math.floor(i/batchSize) + 1} with numeric query`);
                }
              } catch (numericError) {
                console.error(`Error with numeric query for batch ${Math.floor(i/batchSize) + 1}:`, numericError);
              }
            }
          }
        } catch (batchError) {
          console.error(`Error querying batch ${Math.floor(i/batchSize) + 1}:`, batchError);
          // Try without quotes as fallback
          const numericBatch = batch.filter(id => !isNaN(id));
          if (numericBatch.length > 0) {
            try {
              empQuery = `SELECT EmployeeCode, EmployeeName, Department, Designation, Category, ContractorName, DateofExit FROM Employee WHERE EmployeeCode IN (${numericBatch.join(',')})`;
              const numericRecords = await zcql.executeZCQLQuery(empQuery);
              if (numericRecords.length > 0) {
                allEmpRecords.push(...numericRecords);
                console.log(`Found ${numericRecords.length} employees in batch ${Math.floor(i/batchSize) + 1} with fallback numeric query`);
              }
            } catch (fallbackError) {
              console.error(`Fallback query also failed for batch ${Math.floor(i/batchSize) + 1}:`, fallbackError);
            }
          }
        }
      }
     
      console.log(`Found ${allEmpRecords.length} employees in Employee table (queried ${uniqueEmpIds.length} EmployeeIDs)`);
      if (allEmpRecords.length > 0) {
        console.log(`Sample EmployeeCodes found:`, allEmpRecords.slice(0, 5).map(r => {
          const emp = r.Employee || {};
          return { EmployeeCode: String(emp.EmployeeCode || ''), EmployeeName: emp.EmployeeName || '' };
        }));
      } else {
        // Debug: Try querying a sample employee directly to see what's in the table
        console.log(`Debug: Querying Employee table for sample EmployeeCode '20001' to check data format`);
        try {
          const sampleQuery = await zcql.executeZCQLQuery(`SELECT EmployeeCode, EmployeeName FROM Employee WHERE EmployeeCode = '20001' LIMIT 1`);
          if (sampleQuery.length > 0) {
            console.log(`Sample query result:`, sampleQuery[0].Employee);
          } else {
            console.log(`Sample query returned 0 results - EmployeeCode '20001' not found`);
            // Try as number
            try {
              const sampleQueryNum = await zcql.executeZCQLQuery(`SELECT EmployeeCode, EmployeeName FROM Employee WHERE EmployeeCode = 20001 LIMIT 1`);
              if (sampleQueryNum.length > 0) {
                console.log(`Sample query (numeric) result:`, sampleQueryNum[0].Employee);
              }
            } catch (e) {
              console.log(`Sample numeric query failed:`, e.message);
            }
          }
        } catch (sampleError) {
          console.error(`Sample query error:`, sampleError);
        }
      }
     
      const empRecords = allEmpRecords;
     
      // 3. Build a map: EmployeeCode -> { EmployeeName, Department, Category, designation, contractorName, dateOfExit }
      const empDetailsMap = {};
      for (const row of empRecords) {
        const emp = row.Employee;
        const empCode = String(emp.EmployeeCode || '').trim();
        if (empCode) {
          let dateOfExit = '';
          if (emp.DateofExit) {
            const doe = String(emp.DateofExit).trim();
            if (/^\d{4}-\d{2}-\d{2}$/.test(doe)) dateOfExit = doe;
            else {
              const parsed = new Date(emp.DateofExit);
              if (!isNaN(parsed.getTime())) dateOfExit = parsed.toISOString().slice(0, 10);
            }
          }
          empDetailsMap[empCode] = {
            employeeName: emp.EmployeeName || '',
            department: emp.Department || '',
            category: emp.Category || '',
            designation: emp.Designation || '',
            contractorName: emp.ContractorName || '',
            dateOfExit: dateOfExit
          };
        }
      }
     
      // Log employees not found in Employee table
      const missingEmployees = uniqueEmpIds.filter(id => {
        const normalizedId = String(id).trim();
        return !empDetailsMap[normalizedId];
      });
     
      if (missingEmployees.length > 0) {
        console.log(`Warning: ${missingEmployees.length} employees with OT not found in Employee table: ${missingEmployees.slice(0, 10).join(', ')}${missingEmployees.length > 10 ? '...' : ''}`);
        console.log(`Sample missing EmployeeIDs:`, missingEmployees.slice(0, 5).map(id => ({ id, type: typeof id, normalized: String(id).trim() })));
        console.log(`Sample found EmployeeCodes:`, Object.keys(empDetailsMap).slice(0, 5).map(code => ({ code, type: typeof code })));
      } else {
        console.log(`All ${uniqueEmpIds.length} employees with OT were found in Employee table`);
      }

      // Keep Setup Category OT Applicable To strict:
      // do not auto-expand allowed categories from OT records.
     
      // 4. Build empOvertimeMap - Initialize ALL employees first, then add their OT records
      // This ensures we show all employees from Employee table, not just those with attendance data
      const empOvertimeMap = {};
     
      // Initialize all employees from uniqueEmpIds (which includes all filtered employees)
      uniqueEmpIds.forEach(empId => {
        const normalizedId = String(empId).trim();
        if (normalizedId) {
          empOvertimeMap[normalizedId] = {
            employeeId: normalizedId,
            totalOvertimeHours: 0,
            overtimeDays: 0,
            records: []
          };
        }
      });
     
      // Process all records from finalOvertimeRecords (which already has all calculated OT from byKey)
      // This is the primary source of OT data - it includes all records from byKey with calculated OT
      console.log(`Processing ${finalOvertimeRecords.length} records from finalOvertimeRecords`);
     
      for (const row of finalOvertimeRecords) {
        const empId = String(row.EmployeeID || '').trim();
        if (!empId) continue;

        // Category OT Applicable To (Setup): match Employee.Category OR Designation (same labels often used).
        // Do not exclude when master row is missing or both fields are blank — avoids silent 0 OT from bad master data.
        if (designationApplicableToSet.size > 0) {
          const detailsForFilter = empDetailsMap[empId];
          const empCategory = detailsForFilter?.category || '';
          const empDesignation = detailsForFilter?.designation || '';
          if (detailsForFilter && (empCategory || empDesignation)) {
            if (!isOtCategoryApplicable(empCategory) && !isOtCategoryApplicable(empDesignation)) {
              continue;
            }
          }
        }
       
        // Ensure the record date is within the selected date range
        const recordDate = row.Date;
        if (recordDate < startDate || recordDate > endDateStr) {
          continue; // Skip records outside the selected date range
        }
       
        // Ensure this employee is in the map
        if (!empOvertimeMap[empId]) {
          empOvertimeMap[empId] = {
            employeeId: empId,
            totalOvertimeHours: 0,
            overtimeDays: 0,
            records: []
          };
        }
       
        // Check if we already have this date for this employee (avoid duplicates)
        const existingRecordIndex = empOvertimeMap[empId].records.findIndex(r => r.date === row.Date);
        if (existingRecordIndex === -1) {
          // Add the record
          const overtimeHours = parseFloat(row.OvertimeHours) || 0;
        empOvertimeMap[empId].totalOvertimeHours += overtimeHours;
          if (overtimeHours > 0) {
        empOvertimeMap[empId].overtimeDays += 1;
          }
        empOvertimeMap[empId].records.push({
          date: row.Date,
            totalHours: parseFloat(row.TotalHours) || 0,
          overtimeHours: overtimeHours,
            firstIn: row.FirstIn || '',
            lastOut: row.LastOut || '',
            source: row.Source || ''
          });
        }
      }
     
      console.log(`Processed records for ${Object.keys(empOvertimeMap).length} employees`);
      // Log sample records to verify data
      const sampleEmp = Object.keys(empOvertimeMap)[0];
      if (sampleEmp) {
        console.log(`Sample employee ${sampleEmp}: ${empOvertimeMap[sampleEmp].records.length} records, total OT: ${empOvertimeMap[sampleEmp].totalOvertimeHours}`);
        if (empOvertimeMap[sampleEmp].records.length > 0) {
          console.log(`Sample record:`, empOvertimeMap[sampleEmp].records[0]);
        }
      }
     
      console.log(`Built empOvertimeMap with ${Object.keys(empOvertimeMap).length} employees`);
     
      // 5. Build final result with employee details
      const result = [];
      // Prepare contractor filter for final result
      let contractorFilter = null;
      if (contractor && contractor !== 'All') {
        const normalizedContractor = String(contractor || '').replace(/\s+/g, ' ').trim().toLowerCase();
        const contractorWords = normalizedContractor.split(' ').filter(w => w.length > 2);
        contractorFilter = { normalized: normalizedContractor, words: contractorWords };
      }
     
      let skippedNoDetails = 0;
      let skippedContractor = 0;
      let skippedInactive = 0;
     
      for (const empId in empOvertimeMap) {
        const overtimeData = empOvertimeMap[empId];
        // Normalize EmployeeID for lookup (handle string/number mismatches)
        const normalizedEmpId = String(empId).trim();
        const details = empDetailsMap[normalizedEmpId];
       
        // Skip employees that do not exist in the Employee master table
        if (!details) {
          skippedNoDetails++;
          continue;
        }
       
        // Monthly OT: show only active employees (no DateofExit)
        if (details.dateOfExit && details.dateOfExit.trim() !== '') {
          skippedInactive++;
          continue;
        }

        // Enforce selected OT category on final employee rows too,
        // so non-matching categories are not shown as blank/zero rows.
        if (designationApplicableToSet.size > 0) {
          const detailsCategory = details.category || '';
          const detailsDesignation = details.designation || '';
          if (!isOtCategoryApplicable(detailsCategory) && !isOtCategoryApplicable(detailsDesignation)) {
            continue;
          }
        }

        // Apply contractor filter if specified
        if (contractorFilter) {
          const empContractor = String(details.contractorName || '').replace(/\s+/g, ' ').trim().toLowerCase();
          let matches = false;
          if (empContractor === contractorFilter.normalized) matches = true;
          else if (empContractor.includes(contractorFilter.normalized) || contractorFilter.normalized.includes(empContractor)) matches = true;
          else if (contractorFilter.words.length > 0) {
            const allKeyWordsMatch = contractorFilter.words.every(word => empContractor.includes(word));
            if (allKeyWordsMatch) {
              const firstWord = contractorFilter.words[0];
              const empFirstWord = empContractor.split(' ')[0];
              if (empFirstWord && (empFirstWord.startsWith(firstWord) || firstWord.startsWith(empFirstWord))) {
                matches = true;
              }
            }
          }
          if (!matches) {
            skippedContractor++;
            continue; // Skip this employee if contractor doesn't match
          }
        }
       
        result.push({
          employeeId: empId,
          employeeName: details.employeeName || '',
          department: details.department || '',
          category: details.category || '',
          designation: details.designation || '',
          contractorName: details.contractorName || '',
          totalOvertimeHours: overtimeData.totalOvertimeHours.toFixed(2),
          overtimeDays: overtimeData.overtimeDays,
          averageOvertimePerDay: overtimeData.overtimeDays > 0
            ? (overtimeData.totalOvertimeHours / overtimeData.overtimeDays).toFixed(2)
            : '0.00',
          overtimeRecords: overtimeData.records
        });
      }
     
      console.log(`Final result: ${result.length} employees with OT data`);
      console.log(`Skipped ${skippedNoDetails} employees (not in Employee table), ${skippedContractor} employees (contractor filter), ${skippedInactive} inactive employees (has DateofExit)`);
      if (result.length > 0) {
        console.log(`Sample result:`, result.slice(0, 2).map(r => ({
          employeeId: r.employeeId,
          employeeName: r.employeeName,
          totalOvertimeHours: r.totalOvertimeHours,
          overtimeDays: r.overtimeDays,
          recordsCount: r.overtimeRecords?.length || 0
        })));
      }
     
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        data: result,
        dataSource: dataSource,
        summary: {
          totalEmployees: result.length,
          totalDays: finalOvertimeRecords.length,
          bhrRecords: bhrRecords,
          attendanceRecords: attendanceRecords,
          dataSourceUsed: dataSource,
          sourceDescription: dataSource === 'BHR' ? 'ESSL Server Data (Device Transactions)' :
                            dataSource === 'Attendance' ? 'Imported Excel Data' : 'No Data Found'
        }
      }));
    } catch (err) {
      console.log('Monthly Overtime endpoint error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Get all EmployeeCodes, optionally filtered by contractor
  if (pathname === '/employee-codes') {
    try {
      const catalystApp = catalyst.initialize(req);
      const empTable = catalystApp.datastore().table('Employee');
      let empRows;
      if (query.contractor && query.contractor !== 'All') {
        empRows = await empTable.getAllRows();
        // Use flexible matching for contractor names
        const normalizedContractor = String(query.contractor || '').replace(/\s+/g, ' ').trim().toLowerCase();
        const contractorWords = normalizedContractor.split(' ').filter(w => w.length > 2);
       
        empRows = empRows.filter(e => {
          const empContractor = String(e.ContractorName || '').replace(/\s+/g, ' ').trim().toLowerCase();
          if (empContractor === normalizedContractor) return true;
          if (empContractor.includes(normalizedContractor) || normalizedContractor.includes(empContractor)) return true;
          if (contractorWords.length > 0) {
            const allKeyWordsMatch = contractorWords.every(word => empContractor.includes(word));
            if (allKeyWordsMatch) {
              const firstWord = contractorWords[0];
              const empFirstWord = empContractor.split(' ')[0];
              if (empFirstWord && (empFirstWord.startsWith(firstWord) || firstWord.startsWith(empFirstWord))) {
                return true;
              }
            }
          }
          return false;
        });
      } else {
        empRows = await empTable.getAllRows();
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

  // Get all Designations
  if (pathname === '/designations') {
    try {
      const catalystApp = catalyst.initialize(req);
      const designationTable = catalystApp.datastore().table('Designation');
      const designationRows = await designationTable.getAllRows();
      const designations = designationRows
        .map(d => d.Designation)
        .filter(Boolean);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: ['All', ...designations] }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Get latest saved Category OT Applicable To (Employee Category list from Setup; not department/designation)
  if (pathname === '/department-ot-applicable' || pathname === '/designation-applicable') {
    try {
      const catalystApp = catalyst.initialize(req);
      const otApplicableTable = catalystApp.datastore().table('399000000022752');
      const rows = await otApplicableTable.getAllRows();
      if (!rows || rows.length === 0) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: { departments: [], designations: [] } }));
        return;
      }

      const latest = rows
        .slice()
        .sort((a, b) => {
          const aTime = new Date(a.MODIFIEDTIME || a.CREATEDTIME || 0).getTime();
          const bTime = new Date(b.MODIFIEDTIME || b.CREATEDTIME || 0).getTime();
          return bTime - aTime;
        })[0];

      // Table 399000000022752 has column DepartmnetApplicableTo (stores Category OT Applicable To data)
      const raw = String(
        latest.DepartmnetApplicableTo ||
        latest.DepartmentApplicableTo ||
        latest.CategoryApplicableTo ||
        ''
      ).trim();
      const designations = raw
        ? raw.split(',').map((v) => String(v || '').trim()).filter(Boolean)
        : [];

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        data: {
          departments: designations,
          designations,
          startDate: latest.StartDate || '',
          endDate: latest.EndDate || '',
          department: latest.Department || 'All',
          employeeCode: latest.EmployeeCode || 'All'
        }
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Save Category OT Applicable To (Employee Category list from Setup Configuration; not department/designation)
  // Table 399000000022752 (Reports) columns: ROWID, CREATORID, CREATEDTIME, MODIFIEDTIME, DepartmnetApplicableTo, StartDate, EndDate, Department (no EmployeeCode)
  if (pathname === '/department-ot-applicable/save' || pathname === '/designation-applicable/save') {
    try {
      const catalystApp = catalyst.initialize(req);
      const otApplicableTable = catalystApp.datastore().table('399000000022752');
      const categoriesRaw = String(query.designations || query.departments || query.categories || '').trim() || 'All';
      const startDate = String(query.startDate || '').trim();
      const endDate = String(query.endDate || '').trim();
      const department = String(query.department || 'All').trim();

      // Only include columns that exist in Reports table (399000000022752) to avoid "Invalid input value for column name"
      const payload = {
        DepartmnetApplicableTo: categoriesRaw,
        Department: department
      };
      if (startDate) payload.StartDate = startDate;
      if (endDate) payload.EndDate = endDate;

      let savedRow = null;
      let lastErr = null;
      const categoryColumnNames = ['DepartmnetApplicableTo', 'DepartmentApplicableTo'];
      for (const colName of categoryColumnNames) {
        const tryPayload = { Department: department };
        if (startDate) tryPayload.StartDate = startDate;
        if (endDate) tryPayload.EndDate = endDate;
        tryPayload[colName] = categoriesRaw;
        try {
          savedRow = await otApplicableTable.insertRow(tryPayload);
          lastErr = null;
          break;
        } catch (insertErr) {
          lastErr = insertErr;
        }
      }
      if (!savedRow && lastErr) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: lastErr.message || 'Failed to save Category OT Applicable To. Ensure table 399000000022752 has column DepartmnetApplicableTo or DepartmentApplicableTo.' }));
        return;
      }

      const categoriesList = categoriesRaw.split(',').map((v) => String(v || '').trim()).filter(Boolean);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'success',
        data: {
          id: savedRow ? savedRow.ROWID : null,
          departments: categoriesList,
          designations: categoriesList
        }
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message || 'Failed to save Category OT Applicable To' }));
    }
    return;
  }

  // Get latest saved Designation LOH Applicable To selection
  if (pathname === '/loh-designation-applicable') {
    try {
      const catalystApp = catalyst.initialize(req);
      const lohApplicableTable = catalystApp.datastore().table('399000000051588');
      const rows = await lohApplicableTable.getAllRows();
      if (!rows || rows.length === 0) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: { designations: ['All'] } }));
        return;
      }

      const latest = rows
        .slice()
        .sort((a, b) => {
          const aTime = new Date(a.MODIFIEDTIME || a.CREATEDTIME || 0).getTime();
          const bTime = new Date(b.MODIFIEDTIME || b.CREATEDTIME || 0).getTime();
          return bTime - aTime;
        })[0];

      const dynamicDesignationKey = Object.keys(latest).find((key) =>
        String(key || '').toLowerCase().startsWith('designationapplic')
      );
      const raw = String(
        latest.DesignationApplicableTo ||
        latest.DesignationApplicable ||
        (dynamicDesignationKey ? latest[dynamicDesignationKey] : '') ||
        ''
      ).trim();

      const designations = raw
        ? raw.split(',').map((v) => String(v || '').trim()).filter(Boolean)
        : ['All'];

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        data: {
          designations,
          startDate: latest.StartDate || '',
          endDate: latest.EndDate || '',
          department: latest.Department || 'All',
          employeeCode: latest.EmployeeCode || 'All',
          designation: latest.Designation || 'All',
          grace: latest.Grace || ''
        }
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Save Designation LOH Applicable To selection
  if (pathname === '/loh-designation-applicable/save') {
    try {
      const catalystApp = catalyst.initialize(req);
      const lohApplicableTable = catalystApp.datastore().table('399000000051588');
      const rawIncoming = String(query.designations || '').trim();
      const designationsRaw = rawIncoming || 'All';
      const startDate = String(query.startDate || '').trim();
      const endDate = String(query.endDate || '').trim();
      const department = String(query.department || 'All').trim();
      const employeeCode = String(query.employeeCode || 'All').trim();
      const designation = String(query.designation || 'All').trim();
      const grace = String(query.grace || '').trim();

      const basePayload = {
        StartDate: startDate,
        EndDate: endDate,
        Department: department,
        EmployeeCode: employeeCode,
        Designation: designation,
        Grace: grace
      };

      let savedRow = null;
      const candidateColumns = ['DesignationApplicableTo', 'DesignationApplicable', 'DepartmnetApplicableTo', 'DepartmentApplicableTo'];
      let insertError = null;

      for (const col of candidateColumns) {
        try {
          savedRow = await lohApplicableTable.insertRow({
            ...basePayload,
            [col]: designationsRaw
          });
          insertError = null;
          break;
        } catch (err) {
          insertError = err;
        }
      }

      if (!savedRow && insertError) {
        throw insertError;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'success',
        data: {
          id: savedRow ? savedRow.ROWID : null,
          designations: designationsRaw.split(',').map((v) => String(v || '').trim()).filter(Boolean)
        }
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Save Grace (minutes) for LOH report
  if (pathname === '/loh-grace/save') {
    try {
      const catalystApp = catalyst.initialize(req);
      const lohApplicableTable = catalystApp.datastore().table('399000000051588');
      const grace = String(query.grace || '').trim();
      const startDate = String(query.startDate || '').trim();
      const endDate = String(query.endDate || '').trim();
      const department = String(query.department || 'All').trim();
      const employeeCode = String(query.employeeCode || 'All').trim();

      if (!/^\d+$/.test(grace)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Grace must be minutes (whole number)' }));
        return;
      }

      const savedRow = await lohApplicableTable.insertRow({
        StartDate: startDate,
        EndDate: endDate,
        Department: department,
        EmployeeCode: employeeCode,
        Grace: grace
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'success',
        data: {
          id: savedRow ? savedRow.ROWID : null,
          grace
        }
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Miss Punch report endpoint
  if (pathname === '/misspunch') {
    const date = query.date;
    const month = query.month;
    const startDateParam = query.startDate;
    const endDateParam = query.endDate;
    let contractor = query.contractor;
    const department = query.department;
    const employeeId = query.employeeId;
    const userEmail = query.userEmail;
    const userRole = query.userRole;

    if (!date && !month && (!startDateParam || !endDateParam)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing date (YYYY-MM-DD), month (YYYY-MM), or startDate/endDate (YYYY-MM-DD) parameters' }));
      return;
    }

    if (userRole === 'App User' && userEmail && !contractor) {
      const emailContractorMap = {
        'afrindinusha@gmail.com': 'R.P.D Facility Management Services',
        'rpdmanpowerservice@gmail.com': 'R.P.D Facility Management Services',
        'ramachandran23488@gmail.com': 'R.P.D Facility Management Services',
        'afrindinusha29@gmail.com': 'Sriram enterprises',
        'sriramenterprises50@yahoo.com': 'Sriram enterprises',
        'afrinatlin@gmail.com': 'Samuel Enterprise',
        'samuelenterprisesms@gmail.com': 'Samuel Enterprise',
        'dinushaafrin@gmail.com': 'Sri Balaji Enterprises',
        'vijaybalaji701@gmail.com': 'Sri Balaji Enterprises',
        'afrindinu14@gmail.com': 'Yashaswi Academy for Skills',
        'vaishnavi.a@buildhr.co.in': 'Yashaswi Academy for Skills'
      };
      const forcedContractor = emailContractorMap[userEmail];
      if (forcedContractor) contractor = forcedContractor;
    }

    try {
      const catalystApp = catalyst.initialize(req);
      const zcql = catalystApp.zcql();

      let startDateOnly;
      let endDateOnly;
      if (startDateParam && endDateParam) {
        startDateOnly = startDateParam;
        endDateOnly = endDateParam;
      } else if (month) {
        const [year, monthNum] = month.split('-').map(Number);
        startDateOnly = `${month}-01`;
        const lastDayOfMonth = new Date(year, monthNum, 0).getDate();
        endDateOnly = `${month}-${String(lastDayOfMonth).padStart(2, '0')}`;
      } else {
        startDateOnly = date;
        endDateOnly = date;
      }
      const startDate = `${startDateOnly} 00:00:00`;
      const endDate = `${endDateOnly} 23:59:59`;

      let employeeIds = [];
      if (employeeId && employeeId !== 'All') {
        employeeIds = [String(employeeId).trim()];
      }

      const activeEmployeeCondition = ` AND (DateofExit IS NULL OR DateofExit = '')`;

      if (contractor && contractor !== 'All') {
        try {
          const normalized = String(contractor || '').replace(/\s+/g, ' ').trim().replace(/'/g, "''");
          const empRows = await zcql.executeZCQLQuery(
            `SELECT EmployeeCode, ContractorName FROM Employee WHERE ContractorName LIKE '%${normalized}%'${activeEmployeeCondition}`
          );
          const contractorEmployeeIds = empRows
            .map((row) => row.Employee || row)
            .map((emp) => String(emp.EmployeeCode || '').trim())
            .filter(Boolean);
          if (employeeIds.length > 0) {
            employeeIds = employeeIds.filter((id) => contractorEmployeeIds.includes(String(id)));
          } else {
            employeeIds = contractorEmployeeIds;
          }
        } catch (err) {
          console.error('MissPunch: contractor filter error', err.message);
        }
      }

      if (department && department !== 'All') {
        try {
          const deptRows = await zcql.executeZCQLQuery(
            `SELECT EmployeeCode FROM Employee WHERE Department = '${String(department).replace(/'/g, "''")}'${activeEmployeeCondition}`
          );
          const departmentEmployeeIds = deptRows
            .map((row) => row.Employee || row)
            .map((emp) => String(emp.EmployeeCode || '').trim())
            .filter(Boolean);
          if (employeeIds.length > 0) {
            employeeIds = employeeIds.filter((id) => departmentEmployeeIds.includes(String(id)));
          } else {
            employeeIds = departmentEmployeeIds;
          }
        } catch (err) {
          console.error('MissPunch: department filter error', err.message);
        }
      }

      if (employeeIds.length === 0) {
        try {
          const activeRows = await zcql.executeZCQLQuery(
            `SELECT EmployeeCode FROM Employee WHERE 1=1${activeEmployeeCondition}`
          );
          employeeIds = (activeRows || [])
            .map((row) => row.Employee || row)
            .map((emp) => String(emp.EmployeeCode || '').trim())
            .filter(Boolean);
        } catch (err) {
          console.error('MissPunch: active employees fetch error', err.message);
        }
      }

      if (employeeId && employeeId !== 'All') {
        const singleId = String(employeeId).trim();
        let isActive = false;
        try {
          const escaped = singleId.replace(/'/g, "''");
          const activeCheckQuoted = await zcql.executeZCQLQuery(
            `SELECT EmployeeCode FROM Employee WHERE EmployeeCode = '${escaped}'${activeEmployeeCondition}`
          );
          if ((activeCheckQuoted || []).length > 0) isActive = true;
          if (!isActive && !isNaN(Number(singleId))) {
            const activeCheckNum = await zcql.executeZCQLQuery(
              `SELECT EmployeeCode FROM Employee WHERE EmployeeCode = ${singleId}${activeEmployeeCondition}`
            );
            isActive = (activeCheckNum || []).length > 0;
          }
        } catch (e) { /* ignore */ }
        if (!isActive) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ data: [] }));
          return;
        }
      }

      if ((employeeId && employeeId !== 'All') || (contractor && contractor !== 'All') || (department && department !== 'All')) {
        if (employeeIds.length === 0) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ data: [] }));
          return;
        }
      }

      let allLogs = [];
      let offset = 0;
      const pageSize = 300;
      let hasMore = true;

      while (hasMore) {
        let q = `SELECT EmployeeID, EventTime FROM BHR WHERE EventTime >= '${startDate}' AND EventTime <= '${endDate}'`;
        if (employeeIds.length > 0) {
          const idList = employeeIds.map((id) => `'${String(id).replace(/'/g, "''")}'`).join(',');
          q += ` AND EmployeeID IN (${idList})`;
        }
        q += ` ORDER BY EventTime ASC LIMIT ${offset}, ${pageSize}`;
        const rows = await zcql.executeZCQLQuery(q);
        const page = rows.map((r) => r.BHR || r).filter(Boolean);
        allLogs = allLogs.concat(page);
        if (page.length < pageSize) hasMore = false;
        else offset += pageSize;
      }

      const byKey = {};
      for (const rec of allLogs) {
        const empId = String(rec.EmployeeID || '').trim();
        const eventTimeRaw = String(rec.EventTime || '').trim();
        if (!empId || !eventTimeRaw || eventTimeRaw.length < 16) continue;
        const dateStr = eventTimeRaw.slice(0, 10);
        const timeStr = eventTimeRaw.slice(11, 16);
        const key = `${empId}_${dateStr}`;
        if (!byKey[key]) {
          byKey[key] = { employeeId: empId, date: dateStr, firstIn: timeStr, lastOut: timeStr, punchCount: 1 };
        } else {
          byKey[key].punchCount += 1;
          if (timeStr < byKey[key].firstIn) byKey[key].firstIn = timeStr;
          if (timeStr > byKey[key].lastOut) byKey[key].lastOut = timeStr;
        }
      }

      const normalizeDate = (rawDate) => {
        if (!rawDate) return '';
        const value = String(rawDate).trim();
        if (!value) return '';
        if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
        if (value.includes(' ') && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
        if (value.includes('/')) {
          const parts = value.split('/');
          if (parts.length === 3) {
            const [a, b, c] = parts;
            if (c.length === 4) {
              return `${c}-${String(b).padStart(2, '0')}-${String(a).padStart(2, '0')}`;
            }
          }
        }
        const d = new Date(value);
        if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
        return '';
      };

      const normalizeTime = (rawTime) => {
        if (rawTime === null || rawTime === undefined) return '';
        const value = String(rawTime).trim();
        if (!value || value === '-' || value === '--:--' || value.toLowerCase() === 'null') return '';
        if (/^\d{2}:\d{2}$/.test(value)) return value;
        if (/^\d{2}:\d{2}:\d{2}$/.test(value)) return value.slice(0, 5);
        const hhmmMatch = value.match(/(\d{2}):(\d{2})(?::\d{2})?/);
        if (hhmmMatch) return `${hhmmMatch[1]}:${hhmmMatch[2]}`;
        return '';
      };

      const missingMap = {};
      const setMissingRow = (empIdRaw, dateRaw, firstRaw, lastRaw, missingType, sourcePriority) => {
        const empId = String(empIdRaw || '').trim();
        const dateStr = normalizeDate(dateRaw);
        if (!empId || !dateStr) return;
        const firstIn = normalizeTime(firstRaw);
        const lastOut = normalizeTime(lastRaw);
        const key = `${empId}_${dateStr}`;
        const existing = missingMap[key];
        if (!existing || sourcePriority >= existing.sourcePriority) {
          missingMap[key] = {
            employeeId: empId,
            date: dateStr,
            firstIn,
            lastOut,
            missingType,
            sourcePriority
          };
        }
      };

      // BHR miss punch: one device punch in a day (same first and last event)
      Object.values(byKey).forEach((row) => {
        if (row.punchCount <= 1 || row.firstIn === row.lastOut) {
          setMissingRow(row.employeeId, row.date, row.firstIn, row.lastOut, 'Missing Punch', 1);
        }
      });

      // Attendance miss punch: explicit missing FirstIn/LastOut should appear in Miss Punch report
      try {
        let attendanceQuery = `SELECT EmployeeId, AttendanceDate, FirstIn, LastOut FROM Attendance WHERE AttendanceDate >= '${startDateOnly}' AND AttendanceDate <= '${endDateOnly}'`;
        if (employeeIds.length > 0) {
          const idList = employeeIds.map((id) => `'${String(id).replace(/'/g, "''")}'`).join(',');
          attendanceQuery += ` AND EmployeeId IN (${idList})`;
        }
        const attendanceRows = await zcql.executeZCQLQuery(attendanceQuery);
        attendanceRows.map((r) => r.Attendance || r).forEach((row) => {
          const firstIn = normalizeTime(row.FirstIn);
          const lastOut = normalizeTime(row.LastOut);
          if (firstIn && !lastOut) {
            setMissingRow(row.EmployeeId, row.AttendanceDate, firstIn, '', 'Missing Check-Out', 2);
          } else if (!firstIn && lastOut) {
            setMissingRow(row.EmployeeId, row.AttendanceDate, '', lastOut, 'Missing Check-In', 2);
          } else if (firstIn && lastOut && firstIn === lastOut) {
            setMissingRow(row.EmployeeId, row.AttendanceDate, firstIn, lastOut, 'Missing Punch', 2);
          }
        });
      } catch (err) {
        console.error('MissPunch: attendance query error', err.message);
      }

      // OnDuty miss punch: if FirstIn exists and Lastout is missing (or vice versa), include it
      try {
        let ondutyQuery = `SELECT EmployeeCode, OnDutyDate, FirstIn, Lastout FROM OnDuty WHERE OnDutyDate >= '${startDateOnly}' AND OnDutyDate <= '${endDateOnly}'`;
        if (employeeIds.length > 0) {
          const idList = employeeIds.map((id) => `'${String(id).replace(/'/g, "''")}'`).join(',');
          ondutyQuery += ` AND EmployeeCode IN (${idList})`;
        }
        const onDutyRows = await zcql.executeZCQLQuery(ondutyQuery);
        onDutyRows.map((r) => r.OnDuty || r).forEach((row) => {
          const firstIn = normalizeTime(row.FirstIn);
          const lastOut = normalizeTime(row.Lastout);
          if (firstIn && !lastOut) {
            setMissingRow(row.EmployeeCode, row.OnDutyDate, firstIn, '', 'Missing Check-Out', 3);
          } else if (!firstIn && lastOut) {
            setMissingRow(row.EmployeeCode, row.OnDutyDate, '', lastOut, 'Missing Check-In', 3);
          } else if (firstIn && lastOut && firstIn === lastOut) {
            setMissingRow(row.EmployeeCode, row.OnDutyDate, firstIn, lastOut, 'Missing Punch', 3);
          }
        });
      } catch (err) {
        console.error('MissPunch: onduty query error', err.message);
      }

      const missingRows = Object.values(missingMap);
      if (missingRows.length === 0) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: [] }));
        return;
      }

      const uniqueEmpIds = [...new Set(missingRows.map((r) => String(r.employeeId).trim()).filter(Boolean))];
      const empDetailsMap = {};
      // Fetch only active employees (same as cms_function: employeeStatus/EmployeeStatus = 'Active')
      const activeWhere = "(employeeStatus = 'Active' OR EmployeeStatus = 'Active')";
      for (let i = 0; i < uniqueEmpIds.length; i += 100) {
        const batch = uniqueEmpIds.slice(i, i + 100);
        const idList = batch.map((id) => `'${String(id).replace(/'/g, "''")}'`).join(',');
        const q = `SELECT EmployeeCode, EmployeeName, Department, Designation, ContractorName FROM Employee WHERE EmployeeCode IN (${idList}) AND ${activeWhere}`;
        try {
          const rows = await zcql.executeZCQLQuery(q);
          for (const row of rows) {
            const emp = row.Employee || row;
            const code = String(emp.EmployeeCode || '').trim();
            if (!code) continue;
            empDetailsMap[code] = {
              employeeName: emp.EmployeeName || '',
              department: emp.Department || '',
              designation: emp.Designation || '',
              contractorName: emp.ContractorName || ''
            };
          }
        } catch (err) {
          console.error('MissPunch: employee details batch error', err.message);
        }
      }

      // Include only active employees in the report (those present in empDetailsMap)
      const result = missingRows
        .filter((row) => empDetailsMap[row.employeeId])
        .map((row) => {
        const details = empDetailsMap[row.employeeId] || {};
        return {
          employeeId: row.employeeId,
          employeeName: details.employeeName || '',
          department: details.department || '',
          designation: details.designation || '',
          contractorName: details.contractorName || '',
          date: row.date,
          firstIn: row.firstIn || '',
          lastOut: row.lastOut || '',
          missingType: row.missingType || 'Missing Punch',
          lossOfHours: 'Missing',
          lossOfMinutes: 0
        };
      }).sort((a, b) => (a.date === b.date ? String(a.employeeId).localeCompare(String(b.employeeId)) : a.date.localeCompare(b.date)));

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: result }));
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
      const contractorTable = catalystApp.datastore().table('Contractors');
      const contractorRows = await contractorTable.getAllRows();
      const contractors = contractorRows.map(c => c.ContractorName).filter(Boolean);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: contractors }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Bank format report: employee code, name, bank, branch, account, IFSC, salary (for payroll / NEFT exports)
  if (pathname === '/bank-format-report') {
    let contractor = query.contractor;
    const userEmail = query.userEmail;
    const userRole = query.userRole;

    if (userRole === 'App User' && userEmail && !contractor) {
      const emailContractorMap = {
        'afrindinusha@gmail.com': 'R.P.D Facility Management Services',
        'rpdmanpowerservice@gmail.com': 'R.P.D Facility Management Services',
        'ramachandran23488@gmail.com': 'R.P.D Facility Management Services',
        'afrindinusha29@gmail.com': 'Sriram enterprises',
        'sriramenterprises50@yahoo.com': 'Sriram enterprises',
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
        console.log(`Bank format report: restricting to contractor ${forcedContractor} for ${userEmail}`);
      }
    }

    try {
      const catalystApp = catalyst.initialize(req);
      const empTable = catalystApp.datastore().table('Employee');
      let empRows = await empTable.getAllRows();

      if (contractor && contractor !== 'All') {
        const normalizedContractor = String(contractor || '').replace(/\s+/g, ' ').trim().toLowerCase();
        const contractorWords = normalizedContractor.split(' ').filter(w => w.length > 2);
        empRows = empRows.filter(e => {
          const empContractor = String(e.ContractorName || '').replace(/\s+/g, ' ').trim().toLowerCase();
          if (empContractor === normalizedContractor) return true;
          if (empContractor.includes(normalizedContractor) || normalizedContractor.includes(empContractor)) return true;
          if (contractorWords.length > 0) {
            const allKeyWordsMatch = contractorWords.every(word => empContractor.includes(word));
            if (allKeyWordsMatch) {
              const firstWord = contractorWords[0];
              const empFirstWord = empContractor.split(' ')[0];
              if (empFirstWord && (empFirstWord.startsWith(firstWord) || firstWord.startsWith(empFirstWord))) {
                return true;
              }
            }
          }
          return false;
        });
      }

      const monthParam = String(query.month || '').trim();
      const toNumBank = (v) => {
        if (v === null || v === undefined || v === '') return 0;
        const n = parseFloat(String(v).replace(/,/g, '').trim());
        return Number.isFinite(n) ? n : 0;
      };

      /**
       * Earned Basic for bank format: Setup "Actual Basic" (e.g. Actual Total Salary × 55%) then pro-rata by days.
       */
      const extractPayrollRowBankFormat = (rec) => {
        if (!rec || typeof rec !== 'object') return {};
        return rec.Payroll ?? rec.payroll ?? rec;
      };

      const evaluateFormulaExprBankFormat = (expression, context) => {
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
      };

      const pickTotalSalaryForBankFormat = (p, computedTotal) => {
        const keys = [
          'TotalSalary',
          'totalSalary',
          'GrossSalary',
          'grossSalary',
          'ActualTotalSalary',
          'actualTotalSalary',
          'ActualTotalGross',
          'actualTotalGross',
        ];
        for (const k of keys) {
          if (p[k] === undefined || p[k] === null || String(p[k]).trim() === '') continue;
          const n = toNumBank(p[k]);
          if (Number.isFinite(n)) return n;
        }
        return computedTotal;
      };

      const resolveActualBasicForBankReportRow = (p, payrollFormulae) => {
        const actualBasicEmp = toNumBank(p.ActualBasic ?? p.actualBasic);
        const actualHRA = toNumBank(p.ActualHRA ?? p.actualHRA);
        const actualDA = toNumBank(p.ActualDA ?? p.actualDA);
        const otherAllowance = toNumBank(p.OtherAllowance ?? p.otherAllowance ?? p.AttendanceAllowance);
        const otherAllowancesForTotal = toNumBank(p.OtherAllowances ?? p.otherAllowances);
        const travelChargers = toNumBank(p.TravelChargers ?? p.travelChargers ?? p.TravelCharges);
        const specialAllowanceEmp = toNumBank(p.SpecialAllowance ?? p.specialAllowance);
        const computedTotal =
          actualBasicEmp +
          actualHRA +
          actualDA +
          otherAllowance +
          otherAllowancesForTotal +
          travelChargers +
          specialAllowanceEmp;
        const actualTotalSalary = pickTotalSalaryForBankFormat(p, computedTotal);
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
        if (!Array.isArray(payrollFormulae) || payrollFormulae.length === 0) return actualBasicEmp;
        for (const { variable, expression } of payrollFormulae) {
          const vn = String(variable || '')
            .trim()
            .toLowerCase()
            .replace(/\s+/g, ' ');
          if (vn === 'actual basic') {
            const num = evaluateFormulaExprBankFormat(expression, pfContext);
            return Number.isFinite(num) ? num : actualBasicEmp;
          }
        }
        return actualBasicEmp;
      };

      const computeEarnedBasicBankReport = (p, payrollFormulae) => {
        if (!p || typeof p !== 'object') return null;
        const actualBasic = resolveActualBasicForBankReportRow(p, payrollFormulae);
        let daysInMonth = toNumBank(p.DaysInMonth ?? p.daysInMonth ?? p.DAYS_IN_MONTH);
        if (daysInMonth <= 0 && monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
          const [yy, mm] = monthParam.split('-').map(Number);
          if (yy && mm >= 1 && mm <= 12) {
            daysInMonth = new Date(yy, mm, 0).getDate();
          }
        }
        const daysPresent = toNumBank(p.DaysPresent ?? p.daysPresent ?? p.DAYS_PRESENT);
        if (daysInMonth <= 0) return 0;
        const raw = (actualBasic / daysInMonth) * daysPresent;
        return Math.max(0, Math.round(raw * 100) / 100);
      };

      const addPayrollLookupKeys = (map, empCode, row) => {
        const code = String(empCode || '').trim();
        if (!code || !row) return;
        map.set(code, row);
        const noLeadingZeros = code.replace(/^0+(?=\d)/, '');
        if (noLeadingZeros && noLeadingZeros !== code) map.set(noLeadingZeros, row);
        if (/^\d+$/.test(code)) map.set(String(parseInt(code, 10)), row);
        if (noLeadingZeros && /^\d+$/.test(noLeadingZeros)) map.set(String(parseInt(noLeadingZeros, 10)), row);
      };

      const getPayrollRowForBankFormat = (map, rawCode) => {
        const s = String(rawCode || '').trim();
        if (!s) return undefined;
        const candidates = [s, s.replace(/^0+(?=\d)/, '')];
        if (/^\d+$/.test(s)) candidates.push(String(parseInt(s, 10)));
        for (const c of candidates) {
          if (c && map.has(c)) return map.get(c);
        }
        return undefined;
      };

      let payrollByEmpForMonth = new Map();
      let runPayrollByEmpForMonth = new Map();
      let payrollFormulaeBank = [];
      if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
        try {
          try {
            const compRowsBf = await catalystApp.datastore().table('Components').getAllRows();
            for (const row of compRowsBf) {
              const raw = String(row.Formulas || '').trim();
              if (!raw) continue;
              const eqIdx = raw.indexOf('=');
              if (eqIdx === -1) continue;
              const variable = raw.slice(0, eqIdx).trim();
              const expression = raw.slice(eqIdx + 1).trim();
              if (variable && expression) payrollFormulaeBank.push({ variable, expression });
            }
          } catch (feForm) {
            console.log('Bank format report: could not load Setup formulae:', feForm.message);
          }
          const monthEscaped = monthParam.replace(/'/g, "''");
          const payrollQuery = `SELECT * FROM Payroll WHERE Month_filter = '${monthEscaped}' ORDER BY ROWID DESC`;
          let payrollRows = await catalystApp.zcql().executeZCQLQuery(payrollQuery);
          if (!Array.isArray(payrollRows) || payrollRows.length === 0) {
            try {
              const payrollTable = catalystApp.datastore().table('Payroll');
              const allPay = await payrollTable.getAllRows();
              payrollRows = (allPay || []).filter((rec) => {
                const pr = extractPayrollRowBankFormat(rec);
                const mf = String(pr.Month_filter ?? pr.month_filter ?? '').trim();
                return mf === monthParam;
              });
              console.log(
                `Bank format report: ZCQL returned no Payroll rows for ${monthParam}; using datastore filter (${payrollRows.length} rows)`
              );
            } catch (dsErr) {
              console.log('Bank format report: datastore Payroll fallback failed:', dsErr.message);
            }
          }
          const bestByRaw = new Map();
          for (const rec of payrollRows || []) {
            const p = extractPayrollRowBankFormat(rec);
            const empCode = String(p.EmployeeCode ?? p.employeeCode ?? '').trim();
            if (!empCode) continue;
            const existing = bestByRaw.get(empCode);
            const candId = toNumBank(p.ROWID);
            const existId = existing ? toNumBank(existing.ROWID) : -1;
            if (!existing || candId >= existId) {
              bestByRaw.set(empCode, p);
            }
          }
          for (const [code, p] of bestByRaw) {
            addPayrollLookupKeys(payrollByEmpForMonth, code, p);
          }

          /** RunPayroll snapshot (Month_filter + EmployeeCode); bank format uses NetPay + EarnedSalaryGross when set. */
          runPayrollByEmpForMonth = new Map();
          try {
            const runPayrollQuery = `SELECT * FROM RunPayroll WHERE Month_filter = '${monthEscaped}' ORDER BY ROWID DESC`;
            let runPayrollRows = await catalystApp.zcql().executeZCQLQuery(runPayrollQuery);
            if (!Array.isArray(runPayrollRows) || runPayrollRows.length === 0) {
              try {
                const runTable = catalystApp.datastore().table('RunPayroll');
                const allRun = await runTable.getAllRows();
                runPayrollRows = (allRun || []).filter((rec) => {
                  const rr = rec.RunPayroll ?? rec.runPayroll ?? rec;
                  const mf = String(rr.Month_filter ?? rr.month_filter ?? '').trim();
                  return mf === monthParam;
                });
                if (runPayrollRows.length) {
                  console.log(
                    `Bank format report: RunPayroll ZCQL empty for ${monthParam}; datastore filter returned ${runPayrollRows.length} row(s)`
                  );
                }
              } catch (runDsErr) {
                console.log('Bank format report: RunPayroll datastore fallback failed:', runDsErr.message);
              }
            }
            const bestRunByEmp = new Map();
            for (const rec of runPayrollRows || []) {
              const r = rec.RunPayroll ?? rec.runPayroll ?? rec;
              const empCodeRun = String(r.EmployeeCode ?? r.employeeCode ?? '').trim();
              if (!empCodeRun) continue;
              const existingRun = bestRunByEmp.get(empCodeRun);
              const candRid = toNumBank(r.ROWID);
              const existRid = existingRun ? toNumBank(existingRun.ROWID) : -1;
              if (!existingRun || candRid >= existRid) {
                bestRunByEmp.set(empCodeRun, r);
              }
            }
            for (const [code, r] of bestRunByEmp) {
              addPayrollLookupKeys(runPayrollByEmpForMonth, code, r);
            }
            if (runPayrollByEmpForMonth.size > 0) {
              console.log(
                `Bank format report: RunPayroll loaded ${runPayrollByEmpForMonth.size} employee key(s) for ${monthParam} (NetPay / EarnedSalaryGross override when present)`
              );
            }
          } catch (runErr) {
            console.log('Bank format report: RunPayroll lookup skipped:', runErr.message);
            runPayrollByEmpForMonth = new Map();
          }
        } catch (pe) {
          console.log('Bank format report: payroll lookup for Earned Basic skipped:', pe.message);
          payrollByEmpForMonth = new Map();
          runPayrollByEmpForMonth = new Map();
        }
      }

      const formatSalaryAmount = (val) => {
        if (val === null || val === undefined || val === '') return '';
        const s = String(val).replace(/,/g, '').trim();
        const n = parseFloat(s);
        if (Number.isFinite(n)) return n.toFixed(2);
        return String(val).trim();
      };

      /**
       * Net Pay = Earned Gross Salary - Total Deduction (Total Deduction includes Rent Recovery).
       * Same as payroll_function compute (~5789-5790) and GET /payroll netPay for non-Yashaswi.
       */
      const pickPayrollNetPayBankFormat = (p) => {
        if (!p) return null;
        const round2 = (n) => Math.round(n * 100) / 100;
        const pickFirstNum = (...keys) => {
          for (const k of keys) {
            if (p[k] !== undefined && p[k] !== null && String(p[k]).trim() !== '') {
              const n = toNumBank(p[k]);
              if (Number.isFinite(n)) return n;
            }
          }
          return null;
        };

        const contractorLc = String(p.Contractor || p.contractor || '').toLowerCase();
        if (contractorLc.includes('yashaswi academy for skills')) {
          const earned = toNumBank(
            p.EarnedSalaryCross ?? p.earnedSalaryCross ?? p.EarnedGrossSalary ?? p.earnedGrossSalary
          );
          const other = toNumBank(p.OtherDeduction ?? p.otherDeduction);
          const lwfVal =
            monthParam && String(monthParam).endsWith('-12') ? 20 : toNumBank(p.LWF ?? p.lwf);
          const rentVal = toNumBank(p.Rent ?? p.rent);
          const advVal = toNumBank(p.Advance ?? p.advance);
          return round2(earned - other - lwfVal - rentVal - advVal);
        }

        const egs =
          pickFirstNum(
            'EarnedSalaryCross',
            'earnedSalaryCross',
            'EarnedGrossSalary',
            'earnedGrossSalary',
            'Earned_Gross_Salary'
          ) ?? 0;
        const td = pickFirstNum('TotalDeduction', 'totalDeduction', 'Total_Deduction') ?? 0;
        return round2(egs - td);
      };

      const pickRunPayrollEarnedGrossForBank = (r) => {
        if (!r || typeof r !== 'object') return null;
        const n = toNumBank(
          r.EarnedSalaryGross ??
            r.earnedSalaryGross ??
            r.EarnedSalaryCross ??
            r.earnedSalaryCross ??
            r.EarnedGrossSalary ??
            r.earnedGrossSalary
        );
        return Number.isFinite(n) ? n : null;
      };

      const pickRunPayrollNetPayForBank = (r) => {
        if (!r || typeof r !== 'object') return null;
        const n = toNumBank(r.NetPay ?? r.netPay ?? r.NETPAY ?? r.Netpay ?? r.netpay);
        return Number.isFinite(n) ? n : null;
      };

      const data = empRows
        .filter((e) => e.EmployeeCode)
        .map((e) => {
          const salaryRaw =
            e.TotalSalary ??
            e.totalSalary ??
            e.GrossSalary ??
            e.grossSalary ??
            e.ActualBasic ??
            e.actualBasic ??
            '';
          const pRow = getPayrollRowForBankFormat(payrollByEmpForMonth, e.EmployeeCode);
          const rpRow = getPayrollRowForBankFormat(runPayrollByEmpForMonth, e.EmployeeCode);
          let earnedBasicFormatted = '';
          let earnedGrossFormatted = '';
          let totalDeductionFormatted = '';
          let netPayFormatted = '';
          let salaryAmountOut = formatSalaryAmount(salaryRaw);
          let runPayrollOverrideEarnedGross = false;
          let runPayrollOverrideNetPay = false;

          let actualBasicFormatted = '';
          if (pRow) {
            const abResolved = resolveActualBasicForBankReportRow(pRow, payrollFormulaeBank);
            if (Number.isFinite(abResolved)) {
              actualBasicFormatted = abResolved.toFixed(2);
            }
            const eb = computeEarnedBasicBankReport(pRow, payrollFormulaeBank);
            if (eb !== null && eb !== undefined && Number.isFinite(eb)) {
              earnedBasicFormatted = eb.toFixed(2);
            }
            const eg = toNumBank(
              pRow.EarnedSalaryCross ??
                pRow.earnedSalaryCross ??
                pRow.EarnedGrossSalary ??
                pRow.earnedGrossSalary
            );
            const td = toNumBank(pRow.TotalDeduction ?? pRow.totalDeduction);
            if (Number.isFinite(eg)) earnedGrossFormatted = eg.toFixed(2);
            if (Number.isFinite(td)) totalDeductionFormatted = td.toFixed(2);

            const np = pickPayrollNetPayBankFormat(pRow);
            if (np != null && Number.isFinite(np)) {
              netPayFormatted = np.toFixed(2);
              salaryAmountOut = netPayFormatted;
            }
          }

          if (rpRow) {
            const egRp = pickRunPayrollEarnedGrossForBank(rpRow);
            if (egRp != null && Number.isFinite(egRp)) {
              earnedGrossFormatted = egRp.toFixed(2);
              runPayrollOverrideEarnedGross = true;
            }
            const npRp = pickRunPayrollNetPayForBank(rpRow);
            if (npRp != null && Number.isFinite(npRp)) {
              netPayFormatted = npRp.toFixed(2);
              salaryAmountOut = netPayFormatted;
              runPayrollOverrideNetPay = true;
            }
          }

          return {
            employeeCode: String(e.EmployeeCode || ''),
            employeeName: String(e.EmployeeName || e.Name || ''),
            bankName: String(e.BankName || ''),
            bankBranch: String(e.BankBranch || ''),
            accountNumber: String(e.AccountNumber || ''),
            ifscCode: String(e.IFSCCode || ''),
            salaryAmount: salaryAmountOut,
            actualBasic: actualBasicFormatted,
            earnedBasic: earnedBasicFormatted,
            earnedGross: earnedGrossFormatted,
            totalDeduction: totalDeductionFormatted,
            netPay: netPayFormatted,
            runPayrollOverrideEarnedGross,
            runPayrollOverrideNetPay,
          };
        })
        .sort((a, b) => String(a.employeeCode).localeCompare(String(b.employeeCode), undefined, { numeric: true }));

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data }));
    } catch (err) {
      console.log('Bank format report error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Bank NEFT report: all employees (same contractor rules as bank-format-report) + amount from payroll for month when present, else master salary
  if (pathname === '/bank-neft-report') {
    const monthRaw = query.month;
    let contractor = query.contractor;
    const userEmail = query.userEmail;
    const userRole = query.userRole;

    const month = String(monthRaw || '').trim();
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing or invalid month parameter (YYYY-MM)' }));
      return;
    }

    if (userRole === 'App User' && userEmail && !contractor) {
      const emailContractorMap = {
        'afrindinusha@gmail.com': 'R.P.D Facility Management Services',
        'rpdmanpowerservice@gmail.com': 'R.P.D Facility Management Services',
        'ramachandran23488@gmail.com': 'R.P.D Facility Management Services',
        'afrindinusha29@gmail.com': 'Sriram enterprises',
        'sriramenterprises50@yahoo.com': 'Sriram enterprises',
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
        console.log(`Bank NEFT report: restricting to contractor ${forcedContractor} for ${userEmail}`);
      }
    }

    try {
      const catalystApp = catalyst.initialize(req);

      let ourBankAct = '';
      let orgBc = '10';
      let senderName = 'S S Industries';
      try {
        const orgRows = await catalystApp.zcql().executeZCQLQuery(
          `SELECT OrganizationName, OurBankAccount, BC FROM Organization LIMIT 5`
        );
        if (orgRows && orgRows.length > 0) {
          const o = orgRows[0].Organization || {};
          ourBankAct = String(o.OurBankAccount || '').trim();
          if (o.BC != null && String(o.BC).trim() !== '') {
            orgBc = String(o.BC).trim();
          }
          if (o.OrganizationName) {
            senderName = String(o.OrganizationName).trim();
          }
        }
      } catch (orgErr) {
        console.log('Bank NEFT: organization lookup skipped:', orgErr.message);
      }

      /** Same canonical month as payroll GET (Month_filter may be 2026-04 or 2026-4 in DB). */
      const canonicalPayrollMonth = (m) => {
        const s = String(m || '').trim();
        const mo = s.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/);
        if (mo) return `${mo[1]}-${String(parseInt(mo[2], 10)).padStart(2, '0')}`;
        return s;
      };
      const monthCanon = canonicalPayrollMonth(month);
      const monthCanonEscaped = monthCanon.replace(/'/g, "''");
      const monthLoose = monthCanon.replace(/^(\d{4})-(\d{2})$/, (_, y, mm) => `${y}-${parseInt(mm, 10)}`);
      const monthLooseEscaped = monthLoose.replace(/'/g, "''");

      const payrollQuery = `SELECT * FROM Payroll WHERE Month_filter = '${monthCanonEscaped}' ORDER BY ROWID DESC`;
      let payrollRowsSource = await catalystApp.zcql().executeZCQLQuery(payrollQuery);
      if (!payrollRowsSource || payrollRowsSource.length === 0) {
        try {
          payrollRowsSource = await catalystApp
            .zcql()
            .executeZCQLQuery(
              `SELECT * FROM Payroll WHERE Month_filter = '${monthLooseEscaped}' ORDER BY ROWID DESC`
            );
        } catch (e) {
          console.log('Bank NEFT: alternate Month_filter query skipped:', e.message);
        }
      }
      if (!payrollRowsSource || payrollRowsSource.length === 0) {
        try {
          const payrollTable = catalystApp.datastore().table('Payroll');
          const allPay = await payrollTable.getAllRows();
          payrollRowsSource = (allPay || []).filter((rec) => {
            const pr = rec?.Payroll || rec || {};
            const mfRaw = String(pr.Month_filter ?? pr.month_filter ?? '').trim();
            return canonicalPayrollMonth(mfRaw) === monthCanon || mfRaw === month || mfRaw === monthLoose;
          });
          if (payrollRowsSource.length > 0) {
            console.log(
              `Bank NEFT: ZCQL returned no Payroll rows for ${monthCanon}; using datastore filter (${payrollRowsSource.length} rows)`
            );
          }
        } catch (dsErr) {
          console.log('Bank NEFT: datastore Payroll fallback failed:', dsErr.message);
          payrollRowsSource = [];
        }
      }

      const toNum = (v) => {
        const n = Number(v);
        return Number.isFinite(n) ? n : 0;
      };

      /** Union ZCQL Payroll rows with datastore rows for this month (ZCQL sometimes returns fewer rows than Payroll UI). */
      try {
        const payrollTableDs = catalystApp.datastore().table('Payroll');
        const allPayDs = await payrollTableDs.getAllRows();
        const monthRowMatchesDs = (mfRaw) => {
          const s = String(mfRaw ?? '').trim();
          if (!s) return false;
          return (
            canonicalPayrollMonth(s) === monthCanon ||
            s === month ||
            s === monthLoose ||
            (s.length >= 7 && s.slice(0, 7) === monthCanon.slice(0, 7))
          );
        };
        const seenPayKeys = new Set();
        const mergedList = [];
        const addPayRec = (rec) => {
          const p = rec?.Payroll || rec || {};
          if (!monthRowMatchesDs(p.Month_filter ?? p.month_filter)) return;
          const rid = toNum(p.ROWID);
          const ec = String(p.EmployeeCode ?? p.employeeCode ?? '').trim();
          const key = rid > 0 ? `rid:${rid}` : `ec:${ec}:mf:${String(p.Month_filter ?? '')}`;
          if (seenPayKeys.has(key)) return;
          seenPayKeys.add(key);
          mergedList.push(rec && rec.Payroll ? rec : { Payroll: p });
        };
        for (const rec of payrollRowsSource || []) addPayRec(rec);
        for (const rec of allPayDs || []) addPayRec(rec);
        if (mergedList.length > (payrollRowsSource || []).length) {
          console.log(
            `Bank NEFT: payroll row count after datastore merge ${(payrollRowsSource || []).length} -> ${mergedList.length}`
          );
        }
        payrollRowsSource = mergedList;
      } catch (mergeDsErr) {
        console.log('Bank NEFT: payroll datastore merge skipped:', mergeDsErr.message);
      }

      /**
       * Net Pay = Earned Gross Salary - Total Deduction (Total Deduction includes Rent Recovery).
       * Same as payroll_function (~5789-5790) and bank-format-report.
       */
      const netPayFromEarnedGrossMinusTotalDeductionNeft = (p) => {
        if (!p) return null;
        const round2 = (n) => Math.round(n * 100) / 100;
        const pickFirstNum = (...keys) => {
          for (const k of keys) {
            if (p[k] !== undefined && p[k] !== null && String(p[k]).trim() !== '') {
              const n = toNum(p[k]);
              if (Number.isFinite(n)) return n;
            }
          }
          return null;
        };
        const contractorLc = String(p.Contractor || p.contractor || '').toLowerCase();
        if (contractorLc.includes('yashaswi academy for skills')) {
          const earned = toNum(
            p.EarnedSalaryCross ?? p.earnedSalaryCross ?? p.EarnedGrossSalary ?? p.earnedGrossSalary
          );
          const other = toNum(p.OtherDeduction ?? p.otherDeduction);
          const lwfVal = month && String(month).endsWith('-12') ? 20 : toNum(p.LWF ?? p.lwf);
          const rentVal = toNum(p.Rent ?? p.rent);
          const advVal = toNum(p.Advance ?? p.advance);
          return round2(earned - other - lwfVal - rentVal - advVal);
        }
        const egs =
          pickFirstNum(
            'EarnedSalaryCross',
            'earnedSalaryCross',
            'EarnedGrossSalary',
            'earnedGrossSalary',
            'Earned_Gross_Salary'
          ) ?? 0;
        const td = pickFirstNum('TotalDeduction', 'totalDeduction', 'Total_Deduction') ?? 0;
        return round2(egs - td);
      };

      /** Align with Payroll.js / BankFormatReport: Catalyst may store codes as "100001", "100001.0", or padded zeros. */
      const candidateEmployeeCodesForNeft = (code) => {
        const raw = String(code ?? '').trim();
        if (!raw) return [];
        const out = new Set();
        const withoutDecimalZero = raw.endsWith('.0') ? raw.slice(0, -2).trim() : raw;
        const variants = [raw, withoutDecimalZero];
        for (const v of variants) {
          if (!v) continue;
          out.add(v);
          const nz = v.replace(/^0+(?=\d)/, '');
          if (nz && nz !== v) out.add(nz);
          if (/^\d+$/.test(v)) out.add(String(parseInt(v, 10)));
          if (nz && /^\d+$/.test(nz)) out.add(String(parseInt(nz, 10)));
        }
        return [...out].filter(Boolean);
      };

      const addPayrollLookupKeysNeft = (map, empCode, row) => {
        if (!row) return;
        for (const key of candidateEmployeeCodesForNeft(empCode)) {
          map.set(String(key), row);
          if (/^\d+$/.test(String(key))) map.set(parseInt(String(key), 10), row);
        }
      };

      const getPayrollRowForNeft = (map, rawCode) => {
        for (const c of candidateEmployeeCodesForNeft(rawCode)) {
          if (c && map.has(c)) return map.get(c);
          if (/^\d+$/.test(String(c)) && map.has(parseInt(String(c), 10))) return map.get(parseInt(String(c), 10));
        }
        return undefined;
      };

      /** Same netPay as Payroll screen: GET /payroll_function/payroll. Uses fetch when present, else Node http(s). */
      let payrollGridNetByCode = new Map();
      const fillPayrollGridNetFromRows = (rows) => {
        for (const row of rows) {
          const ec = row.employeeCode ?? row.EmployeeCode ?? row.employeeID ?? row.EmployeeId;
          const np = row.netPay ?? row.NetPay ?? row.netpay;
          if (ec == null || ec === '') continue;
          const keySet = new Set([String(ec).trim(), ...candidateEmployeeCodesForNeft(ec)]);
          for (const k of keySet) {
            if (!k && k !== 0) continue;
            const sk = String(k);
            payrollGridNetByCode.set(sk, np);
            if (/^\d+$/.test(sk)) payrollGridNetByCode.set(parseInt(sk, 10), np);
          }
        }
      };
      const httpGetJsonInternal = (urlStr, hdrs) =>
        new Promise((resolve, reject) => {
          try {
            const httpMod = require('http');
            const httpsMod = require('https');
            const u = new URL(urlStr);
            const lib = u.protocol === 'https:' ? httpsMod : httpMod;
            const opts = {
              hostname: u.hostname,
              port: u.port || (u.protocol === 'https:' ? 443 : 80),
              path: `${u.pathname}${u.search}`,
              method: 'GET',
              headers: { Accept: 'application/json', ...hdrs },
              timeout: 55000,
            };
            const reqH = lib.request(opts, (res) => {
              let buf = '';
              res.setEncoding('utf8');
              res.on('data', (c) => {
                buf += c;
              });
              res.on('end', () => {
                try {
                  resolve({ status: res.statusCode, json: JSON.parse(buf) });
                } catch (pe) {
                  reject(pe);
                }
              });
            });
            reqH.on('error', reject);
            reqH.on('timeout', () => {
              reqH.destroy();
              reject(new Error('payroll API request timeout'));
            });
            reqH.end();
          } catch (e) {
            reject(e);
          }
        });
      try {
        const host = req.headers && req.headers.host;
        if (host) {
          const qs = new URLSearchParams({ month });
          if (userEmail) qs.set('userEmail', String(userEmail));
          if (userRole) qs.set('userRole', String(userRole));
          if (contractor && contractor !== 'All') qs.set('contractor', String(contractor));
          const proto = req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
          const path = `/server/payroll_function/payroll?${qs.toString()}`;
          const url = `${proto}://${host}${path}`;
          const cookieHdr = req.headers.cookie ? { Cookie: req.headers.cookie } : {};
          let rows = [];
          if (typeof fetch === 'function') {
            try {
              const fr = await fetch(url, { headers: { Accept: 'application/json', ...cookieHdr } });
              if (fr.ok) {
                const j = await fr.json();
                rows = Array.isArray(j.data) ? j.data : [];
              } else {
                console.log(`Bank NEFT: payroll fetch HTTP ${fr.status}, trying http(s) fallback`);
              }
            } catch (fe) {
              console.log('Bank NEFT: payroll fetch failed:', fe.message);
            }
          }
          if (!rows.length) {
            try {
              const r = await httpGetJsonInternal(url, cookieHdr);
              if (r.status === 200 && r.json && Array.isArray(r.json.data)) {
                rows = r.json.data;
              } else {
                console.log(`Bank NEFT: payroll http(s) status ${r.status}`);
              }
            } catch (he) {
              console.log('Bank NEFT: payroll http(s) fallback failed:', he.message);
            }
          }
          if (rows.length) {
            fillPayrollGridNetFromRows(rows);
            console.log(
              `Bank NEFT: payroll API merged ${rows.length} rows into net-pay lookup (${payrollGridNetByCode.size} keys)`
            );
          }
        }
      } catch (apiErr) {
        console.log('Bank NEFT: payroll API net pay merge failed:', apiErr.message);
      }

      const lookupPayrollGridNet = (rawCode) => {
        for (const c of candidateEmployeeCodesForNeft(rawCode)) {
          if (c == null || c === '') continue;
          const s = String(c);
          if (payrollGridNetByCode.has(s)) return payrollGridNetByCode.get(s);
          if (/^\d+$/.test(s) && payrollGridNetByCode.has(parseInt(s, 10))) {
            return payrollGridNetByCode.get(parseInt(s, 10));
          }
        }
        return undefined;
      };

      const resolveBankNeftEmployeeCode = (e) => {
        if (!e || typeof e !== 'object') return '';
        const raw =
          e.EmployeeCode ??
          e.EmployeeID ??
          e.employeeCode ??
          (e.Employee && (e.Employee.EmployeeCode ?? e.Employee.EmployeeID));
        return String(raw ?? '').trim();
      };

      const bestPayrollByRawCode = new Map();
      for (const rec of payrollRowsSource || []) {
        const p = rec?.Payroll || rec || {};
        const empCodeRaw = String(p.EmployeeCode ?? p.employeeCode ?? '').trim();
        if (!empCodeRaw) continue;
        const empCode = empCodeRaw.endsWith('.0') ? empCodeRaw.slice(0, -2).trim() : empCodeRaw;
        const existing = bestPayrollByRawCode.get(empCode);
        const candidateRowId = toNum(p.ROWID);
        const existingRowId = existing ? toNum(existing.ROWID) : -1;
        if (!existing || candidateRowId >= existingRowId) {
          bestPayrollByRawCode.set(empCode, p);
        }
      }

      const bestPayrollByCode = new Map();
      for (const [code, row] of bestPayrollByRawCode) {
        addPayrollLookupKeysNeft(bestPayrollByCode, code, row);
      }

      /** RunPayroll snapshot: use Data Store NetPay for NEFT AMOUNT (and NET PAY) when present — same source as Bank Format RunPayroll override. */
      let runPayrollByEmpForNeft = new Map();
      try {
        const runPayrollQueryNeft = `SELECT * FROM RunPayroll WHERE Month_filter = '${monthCanonEscaped}' ORDER BY ROWID DESC`;
        let runPayrollRowsNeft = await catalystApp.zcql().executeZCQLQuery(runPayrollQueryNeft);
        if (!Array.isArray(runPayrollRowsNeft) || runPayrollRowsNeft.length === 0) {
          try {
            runPayrollRowsNeft = await catalystApp
              .zcql()
              .executeZCQLQuery(
                `SELECT * FROM RunPayroll WHERE Month_filter = '${monthLooseEscaped}' ORDER BY ROWID DESC`
              );
          } catch (e) {
            console.log('Bank NEFT: RunPayroll alternate Month_filter query skipped:', e.message);
          }
        }
        if (!Array.isArray(runPayrollRowsNeft) || runPayrollRowsNeft.length === 0) {
          try {
            const runTableNeft = catalystApp.datastore().table('RunPayroll');
            const allRunNeft = await runTableNeft.getAllRows();
            runPayrollRowsNeft = (allRunNeft || []).filter((rec) => {
              const rr = rec.RunPayroll ?? rec.runPayroll ?? rec;
              const mfRaw = String(rr.Month_filter ?? rr.month_filter ?? '').trim();
              return (
                canonicalPayrollMonth(mfRaw) === monthCanon ||
                mfRaw === month ||
                mfRaw === monthLoose
              );
            });
            if (runPayrollRowsNeft.length > 0) {
              console.log(
                `Bank NEFT: RunPayroll ZCQL empty for ${monthCanon}; datastore filter returned ${runPayrollRowsNeft.length} row(s)`
              );
            }
          } catch (runDsNeft) {
            console.log('Bank NEFT: RunPayroll datastore fallback failed:', runDsNeft.message);
            runPayrollRowsNeft = [];
          }
        }
        const bestRunByEmpNeft = new Map();
        for (const rec of runPayrollRowsNeft || []) {
          const r = rec.RunPayroll ?? rec.runPayroll ?? rec;
          const empCodeRun = String(r.EmployeeCode ?? r.employeeCode ?? '').trim();
          if (!empCodeRun) continue;
          const empNorm = empCodeRun.endsWith('.0') ? empCodeRun.slice(0, -2).trim() : empCodeRun;
          const existingRun = bestRunByEmpNeft.get(empNorm);
          const candRid = toNum(r.ROWID);
          const existRid = existingRun ? toNum(existingRun.ROWID) : -1;
          if (!existingRun || candRid >= existRid) {
            bestRunByEmpNeft.set(empNorm, r);
          }
        }
        for (const [codeRp, rowRp] of bestRunByEmpNeft) {
          addPayrollLookupKeysNeft(runPayrollByEmpForNeft, codeRp, rowRp);
        }
        if (runPayrollByEmpForNeft.size > 0) {
          console.log(
            `Bank NEFT: RunPayroll loaded ${runPayrollByEmpForNeft.size} employee key(s) for ${monthCanon} (NetPay → AMOUNT when set)`
          );
        }
      } catch (runErrNeft) {
        console.log('Bank NEFT: RunPayroll lookup skipped:', runErrNeft.message);
        runPayrollByEmpForNeft = new Map();
      }

      const pickRunPayrollNetPayForNeft = (r) => {
        if (!r || typeof r !== 'object') return null;
        const raw = r.NetPay ?? r.netPay ?? r.NETPAY ?? r.Netpay ?? r.netpay;
        if (raw === null || raw === undefined || String(raw).trim() === '') return null;
        const n = parseFloat(String(raw).replace(/,/g, '').trim());
        return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
      };

      const pickAmountFromPayroll = (p) => {
        const n = netPayFromEarnedGrossMinusTotalDeductionNeft(p);
        return n != null && Number.isFinite(n) ? n : 0;
      };

      /** NET PAY column: same Net Pay = Earned Gross Salary - Total Deduction rule as payroll_function / bank-format. */
      const pickPayrollNetPayOnly = (p) => netPayFromEarnedGrossMinusTotalDeductionNeft(p);

      const salaryFallbackFromEmployee = (e) => {
        const salaryRaw =
          e.TotalSalary ??
          e.totalSalary ??
          e.GrossSalary ??
          e.grossSalary ??
          e.ActualBasic ??
          e.actualBasic ??
          '';
        const s = String(salaryRaw ?? '').replace(/,/g, '').trim();
        const n = parseFloat(s);
        return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
      };

      const empTable = catalystApp.datastore().table('Employee');
      let empRows = await empTable.getAllRows();

      if (contractor && contractor !== 'All') {
        const normalizedContractor = String(contractor || '').replace(/\s+/g, ' ').trim().toLowerCase();
        const contractorWords = normalizedContractor.split(' ').filter((w) => w.length > 2);
        empRows = empRows.filter((e) => {
          const empContractor = String(e.ContractorName || '').replace(/\s+/g, ' ').trim().toLowerCase();
          if (empContractor === normalizedContractor) return true;
          if (empContractor.includes(normalizedContractor) || normalizedContractor.includes(empContractor)) return true;
          if (contractorWords.length > 0) {
            const allKeyWordsMatch = contractorWords.every((word) => empContractor.includes(word));
            if (allKeyWordsMatch) {
              const firstWord = contractorWords[0];
              const empFirstWord = empContractor.split(' ')[0];
              if (empFirstWord && (empFirstWord.startsWith(firstWord) || firstWord.startsWith(empFirstWord))) {
                return true;
              }
            }
          }
          return false;
        });
      }

      const data = empRows
        .filter((e) => resolveBankNeftEmployeeCode(e))
        .map((e) => {
          const code = resolveBankNeftEmployeeCode(e);
          const runPayrollRow = getPayrollRowForNeft(runPayrollByEmpForNeft, code);
          const netFromRunPayroll = runPayrollRow ? pickRunPayrollNetPayForNeft(runPayrollRow) : null;

          const payrollRow = getPayrollRowForNeft(bestPayrollByCode, code);
          let amount = payrollRow ? pickAmountFromPayroll(payrollRow) : salaryFallbackFromEmployee(e);
          let netPay = payrollRow ? pickPayrollNetPayOnly(payrollRow) : null;

          if (netFromRunPayroll != null && Number.isFinite(netFromRunPayroll)) {
            amount = netFromRunPayroll;
            netPay = netFromRunPayroll;
          } else {
            if (netPay == null || (typeof netPay === 'number' && Number.isNaN(netPay))) {
              const g = lookupPayrollGridNet(code);
              if (g != null && g !== '' && Number.isFinite(Number(g))) {
                netPay = Math.round(Number(g) * 100) / 100;
              }
            }
            /** Show same figure as AMOUNT when no payroll row / API net could be resolved (avoids blank NET PAY column). */
            if (netPay == null || (typeof netPay === 'number' && Number.isNaN(netPay))) {
              netPay = amount;
            }
          }
          const ifsc = String(e.IFSCCode || '').trim();
          const account = String(e.AccountNumber || '').trim();
          const emlName = String(e.EmployeeName || e.Name || '').trim();
          const bankCity = String(e.BankBranch || e.BankName || '').trim();

          return {
            employeeCode: code,
            amount,
            netPay,
            ourBankAct,
            emIfscCode: ifsc,
            emplAct: account,
            bc: orgBc,
            emlName: emlName.toUpperCase(),
            bank: bankCity ? bankCity.toUpperCase() : '',
            sender: senderName,
            mode: 'NEFT',
            neftLine: '',
          };
        })
        .sort((a, b) => String(a.emlName).localeCompare(String(b.emlName)));

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'success', data }));
    } catch (err) {
      console.log('Bank NEFT report error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message, message: err.message }));
    }
    return;
  }

  // LOH (Loss of Hours) Report endpoint and Late In Report (same data, different filter/output)
  if (pathname === '/loh' || pathname === '/latein') {
    const isLateInReport = pathname === '/latein';
    // Parse date/month/date range and filters (Late In uses only startDate, endDate, department, employeeId, grace)
    const date = query.date; // format: YYYY-MM-DD (legacy support)
    const month = query.month; // format: YYYY-MM (legacy support)
    const startDateParam = query.startDate; // format: YYYY-MM-DD
    const endDateParam = query.endDate; // format: YYYY-MM-DD
    let contractor = query.contractor;
    const department = query.department;
    const employeeId = query.employeeId;
    const designationApplicableToRaw = isLateInReport ? 'All' : (query.designationApplicableTo || query.designationLohApplicableTo);
    const userEmail = query.userEmail;
    const userRole = query.userRole;
   
    // Support both legacy (date/month) and new (startDate/endDate) parameters
    if (!date && !month && (!startDateParam || !endDateParam)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing date (YYYY-MM-DD), month (YYYY-MM), or startDate/endDate (YYYY-MM-DD) parameters' }));
      return;
    }
   
    // Filter by contractor based on user email (hard-coded mapping)
    if (userRole === 'App User' && userEmail && !contractor) {
      const emailContractorMap = {
        'afrindinusha@gmail.com': 'R.P.D Facility Management Services',
        'rpdmanpowerservice@gmail.com': 'R.P.D Facility Management Services',
        'ramachandran23488@gmail.com': 'R.P.D Facility Management Services',
        'afrindinusha29@gmail.com': 'Sriram enterprises',
        'sriramenterprises50@yahoo.com': 'Sriram enterprises',
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
        console.log(`Filtering LOH for user ${userEmail} - showing only ${forcedContractor} employees`);
      }
    }
   
    try {
      const catalystApp = catalyst.initialize(req);
      const table = catalystApp.datastore().table('BHR');
     
      // Determine date range based on date, month, or startDate/endDate parameters
      let startDate, endDate, startDateOnly, endDateOnly;
      if (startDateParam && endDateParam) {
        // New date range format
        startDateOnly = startDateParam;
        endDateOnly = endDateParam;
        startDate = `${startDateParam} 00:00:00`;
        endDate = `${endDateParam} 23:59:59`;
      } else if (month) {
        // Month-wise: get all days in the month
        const [year, monthNum] = month.split('-').map(Number);
        startDateOnly = `${month}-01`;
        const lastDayOfMonth = new Date(year, monthNum, 0).getDate();
        endDateOnly = `${month}-${String(lastDayOfMonth).padStart(2, '0')}`;
        startDate = `${startDateOnly} 00:00:00`;
        endDate = `${endDateOnly} 23:59:59`;
      } else {
        // Single date (legacy support)
        startDateOnly = date;
        endDateOnly = date;
        startDate = `${date} 00:00:00`;
        endDate = `${date} 23:59:59`;
      }
     
      const zcql = catalystApp.zcql();

      // Grace period in minutes (from report UI). Applied to all shifts. Default 10 if not provided or invalid.
      const graceParam = String(query.grace || '').trim();
      const graceMinutes = (/^\d+$/.test(graceParam) && parseInt(graceParam, 10) >= 0)
        ? parseInt(graceParam, 10)
        : 10;

      let designationApplicableToList = Array.isArray(designationApplicableToRaw)
        ? designationApplicableToRaw
        : String(designationApplicableToRaw || '')
            .split(',')
            .map((v) => String(v || '').trim())
            .filter(Boolean);

      // Load Category LOH Applicable To from Setup Configuration if not in query
      if (designationApplicableToList.length === 0) {
        try {
          const lohApplicableTable = catalystApp.datastore().table('399000000051588');
          const savedRows = await lohApplicableTable.getAllRows();
          if (savedRows && savedRows.length > 0) {
            const latest = savedRows
              .slice()
              .sort((a, b) => {
                const aTime = new Date(a.MODIFIEDTIME || a.CREATEDTIME || 0).getTime();
                const bTime = new Date(b.MODIFIEDTIME || b.CREATEDTIME || 0).getTime();
                return bTime - aTime;
              })[0];

            const dynamicDesignationKey = Object.keys(latest).find((key) =>
              String(key || '').toLowerCase().startsWith('designationapplic')
            );
            const savedRaw = String(
              latest.DesignationApplicableTo ||
              latest.DesignationApplicable ||
              (dynamicDesignationKey ? latest[dynamicDesignationKey] : '') ||
              ''
            ).trim();

            designationApplicableToList = savedRaw
              ? savedRaw.split(',').map((v) => String(v || '').trim()).filter(Boolean)
              : ['All'];
          } else {
            designationApplicableToList = ['All'];
          }
        } catch (savedErr) {
          console.log('LOH: Failed to load saved Category LOH Applicable To, using All:', savedErr.message);
          designationApplicableToList = ['All'];
        }
      }

      // Only calculate LOH for employees whose Category is in Setup Configuration "Category LOH Applicable To". Other categories are excluded. When "All" is selected, no filter.
      const designationFilterEnabled = designationApplicableToList.length > 0 &&
        !designationApplicableToList.some((d) => String(d || '').trim().toLowerCase() === 'all');
      const designationApplicableToSet = new Set(
        designationApplicableToList.map((d) => String(d || '').replace(/\s+/g, ' ').trim().toLowerCase())
      );
      const normalizeCategoryForMatch = (value) =>
        String(value || '')
          .replace(/\s+/g, ' ')
          .trim()
          .toLowerCase();
      const normalizeCategoryToken = (value) =>
        normalizeCategoryForMatch(value).replace(/[^a-z0-9]/g, '');
      const isCategoryApplicable = (value) => {
        const raw = normalizeCategoryForMatch(value);
        const token = normalizeCategoryToken(value);
        if (!raw && !token) return false;
        if (designationApplicableToSet.has(raw)) return true;
        for (const allowed of designationApplicableToSet) {
          const allowedRaw = normalizeCategoryForMatch(allowed);
          const allowedToken = normalizeCategoryToken(allowed);
          if (!allowedRaw && !allowedToken) continue;
          if (raw === allowedRaw || token === allowedToken) return true;
          if (
            raw.includes(allowedRaw) ||
            allowedRaw.includes(raw) ||
            token.includes(allowedToken) ||
            allowedToken.includes(token)
          ) {
            return true;
          }
        }
        return false;
      };
     
      // Build employee filter conditions
      let employeeFilterConditions = [];
      let employeeIds = [];
     
      if (employeeId && employeeId !== 'All') {
        employeeIds = [employeeId];
        employeeFilterConditions.push(`EmployeeID = '${employeeId}'`);
      }
     
      // Contractor filter
      if (contractor && contractor !== 'All') {
        try {
          // Use flexible matching for contractor names
          const normalizedContractor = String(contractor || '').replace(/\s+/g, ' ').trim().replace(/'/g, "''");
          console.log(`LOH: Applying contractor filter for: "${contractor}" (normalized: "${normalizedContractor}")`);
         
          // Try LIKE query first (case-insensitive matching)
          let contractorEmployeeQuery = [];
          try {
            contractorEmployeeQuery = await zcql.executeZCQLQuery(
              `SELECT EmployeeCode, ContractorName FROM Employee WHERE ContractorName LIKE '%${normalizedContractor}%'`
            );
            console.log(`LOH: LIKE query returned ${contractorEmployeeQuery.length} records`);
          } catch (likeError) {
            console.log(`LOH: LIKE query failed, trying alternative approach: ${likeError.message}`);
          }
         
          // If LIKE query returned no results, try fetching all employees and filtering in JavaScript
          // This handles case sensitivity issues
          if (contractorEmployeeQuery.length === 0) {
            try {
              const allEmployeesQuery = await zcql.executeZCQLQuery(
                `SELECT EmployeeCode, ContractorName FROM Employee LIMIT 10000`
              );
              console.log(`LOH: Fetched ${allEmployeesQuery.length} total employees for contractor filtering`);
              contractorEmployeeQuery = allEmployeesQuery;
            } catch (allError) {
              console.error(`LOH: Error fetching all employees: ${allError.message}`);
            }
          }
         
          // Additional JavaScript filtering for better matching (handles case sensitivity)
          const normalizedSearch = normalizedContractor.toLowerCase();
          const searchWords = normalizedSearch.split(' ').filter(w => w.length > 2);
         
          const filteredEmployees = contractorEmployeeQuery.filter(emp => {
            // Handle different possible result structures
            const empRecord = emp.Employee || emp;
            const empContractor = String(empRecord?.ContractorName || empRecord?.contractorName || '').replace(/\s+/g, ' ').trim().toLowerCase();
           
            // Exact match (case-insensitive)
            if (empContractor === normalizedSearch) return true;
           
            // Substring match (case-insensitive)
            if (empContractor.includes(normalizedSearch) || normalizedSearch.includes(empContractor)) return true;
           
            // Keyword matching for multi-word contractor names
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
         
          console.log(`LOH: After JavaScript filtering, ${filteredEmployees.length} employees match contractor "${contractor}"`);
         
          if (filteredEmployees && filteredEmployees.length > 0) {
            // Handle different possible result structures for EmployeeCode
            const contractorEmployeeIds = filteredEmployees.map(emp => {
              const empRecord = emp.Employee || emp;
              return String(empRecord?.EmployeeCode || empRecord?.employeeCode || empRecord?.EmployeeID || empRecord?.employeeId || '').trim();
            }).filter(Boolean);
           
            console.log(`LOH: Extracted ${contractorEmployeeIds.length} employee codes from contractor filter`);
            if (contractorEmployeeIds.length > 0) {
              console.log(`LOH: Sample employee codes: ${contractorEmployeeIds.slice(0, 5).join(', ')}`);
            }
           
            if (employeeIds.length > 0) {
              employeeIds = employeeIds.filter(id => contractorEmployeeIds.includes(String(id)));
            } else {
              employeeIds = contractorEmployeeIds;
            }
            console.log(`LOH: Contractor filter "${contractor}": Final employeeIds count = ${employeeIds.length}`);
          } else {
            console.log(`LOH: Contractor filter "${contractor}": No employees found after filtering`);
            employeeIds = []; // No employees match, return empty result
          }
        } catch (error) {
          console.error('LOH: Error applying contractor filter:', error);
          console.error('LOH: Contractor filter error stack:', error.stack);
          // Don't set employeeIds to empty array on error - let it proceed without contractor filter
        }
      }
     
      // Department filter
      if (department && department !== 'All') {
        try {
          const departmentEmployeeQuery = await zcql.executeZCQLQuery(
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

      // Category LOH Applicable To (Setup Configuration): only employees in the saved category list get LOH calculated; other categories are excluded
      if (designationFilterEnabled) {
        try {
          const categoryEmployeeQuery = await zcql.executeZCQLQuery(
            `SELECT EmployeeCode, Category FROM Employee LIMIT 10000`
          );

          const designationEmployeeIds = categoryEmployeeQuery
            .map((row) => row.Employee || row)
            .filter((emp) => {
              return isCategoryApplicable(emp.Category);
            })
            .map((emp) => String(emp.EmployeeCode || '').trim())
            .filter(Boolean);

          if (designationEmployeeIds.length > 0) {
            if (employeeIds.length > 0) {
              employeeIds = employeeIds.filter((id) => designationEmployeeIds.includes(String(id)));
            } else {
              employeeIds = designationEmployeeIds;
            }
          } else {
            console.log(
              `LOH: No Employee IDs matched category filter [${Array.from(designationApplicableToSet).join(', ')}] at pre-filter stage; applying category filter on final result instead.`
            );
          }
        } catch (error) {
          console.error('LOH: Error applying designation filter:', error);
        }
      }
     
      if (employeeIds.length > 0) {
        const employeeIdList = employeeIds.map(id => `'${id}'`).join(',');
        employeeFilterConditions.push(`EmployeeID IN (${employeeIdList})`);
      }
     
      // Aggregate data from all sources (BHR, Attendance, BioMax, OnDuty, CompOff)
      // Use same structure as attendance_muster_function
      const byKey = {}; // Key: empId_date -> { EmployeeID, Date, FirstIN, LastOUT, Source }
     
      // 1. Fetch BHR (device) transactions
      let allLogs = [];
      let offset = 0;
      const pageSize = 300;
      let hasMore = true;
      while (hasMore) {
        let query = `SELECT EmployeeID, EventTime, DeviceSerial FROM BHR
                     WHERE EventTime >= '${startDate}'
                     AND EventTime <= '${endDate}'`;
        if (employeeFilterConditions.length > 0) {
          query += ` AND ${employeeFilterConditions.join(' AND ')}`;
        }
        query += ` ORDER BY ROWID LIMIT ${pageSize} OFFSET ${offset}`;
        try {
          const batch = await zcql.executeZCQLQuery(query);
          const rows = batch.map(r => r.BHR);
          if (rows.length === 0) {
            hasMore = false;
            break;
          }
          allLogs.push(...rows);
          offset += pageSize;
          if (rows.length < pageSize) hasMore = false;
          if (allLogs.length > 20000) break; // safety guard
        } catch (err) {
          console.log('BHR fetch error:', err.message);
          hasMore = false;
        }
      }
      console.log(`LOH: Fetched ${allLogs.length} BHR records`);
     
      // Aggregate BHR per EmployeeID + Date using earliest and latest EventTime
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
     
      // 2. Fetch and merge Attendance table data
      let attOffset = 0;
      let attHasMore = true;
      const attPageSize = 300;
      while (attHasMore) {
        let aQuery = `SELECT EmployeeId, AttendanceDate, FirstIn, LastOut, Status FROM Attendance`;
        if (employeeFilterConditions.length > 0) {
          const attendanceEmployeeFilter = employeeFilterConditions[0].replace('EmployeeID', 'EmployeeId');
          aQuery += ` WHERE ${attendanceEmployeeFilter}`;
        }
        aQuery += ` ORDER BY EmployeeId, AttendanceDate LIMIT ${attPageSize} OFFSET ${attOffset}`;
       
        try {
          const aBatch = await zcql.executeZCQLQuery(aQuery);
          const aRows = aBatch.map(r => r.Attendance);
          if (aRows.length === 0) {
            attHasMore = false;
            break;
          }
         
          // Helper: normalize time strings
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
         
          aRows.forEach(r => {
            let dateStr = '';
            if (r.AttendanceDate) {
              if (typeof r.AttendanceDate === 'string') {
                if (/^\d{4}-\d{2}-\d{2}$/.test(r.AttendanceDate)) {
                  dateStr = r.AttendanceDate;
                } else {
                  const tmp = new Date(r.AttendanceDate);
                  if (!isNaN(tmp)) dateStr = tmp.toISOString().slice(0,10);
                }
              } else {
                const tmp = new Date(r.AttendanceDate);
                if (!isNaN(tmp)) dateStr = tmp.toISOString().slice(0,10);
              }
            }
           
            const normalizedFirst = dateStr ? normalizeTimeForDate(dateStr, r.FirstIn) : normalizeTimeForDate('1970-01-01', r.FirstIn);
            const normalizedLast = dateStr ? normalizeTimeForDate(dateStr, r.LastOut) : normalizeTimeForDate('1970-01-01', r.LastOut);
           
            if (!dateStr) {
              const dt = (normalizedFirst || normalizedLast || '').match(/^(\d{4}-\d{2}-\d{2})\s+/);
              if (dt) dateStr = dt[1];
            }
           
            if (!dateStr) return;
            if (dateStr < startDateOnly || dateStr > endDateOnly) return;
           
            const key = `${r.EmployeeId}_${dateStr}`;
            if (!byKey[key]) {
              byKey[key] = {
                EmployeeID: r.EmployeeId,
                Date: dateStr,
                FirstIN: normalizedFirst,
                LastOUT: normalizedLast,
                Source: 'Attendance',
                Status: r.Status || ''
              };
            } else {
              if (normalizedFirst && (!byKey[key].FirstIN || normalizedFirst < byKey[key].FirstIN)) {
                byKey[key].FirstIN = normalizedFirst;
              }
              if (normalizedLast && (!byKey[key].LastOUT || normalizedLast > byKey[key].LastOUT)) {
                byKey[key].LastOUT = normalizedLast;
              }
              byKey[key].Source = byKey[key].Source === 'BHR' ? 'Both' : (byKey[key].Source || 'Attendance');
              if (r.Status) byKey[key].Status = r.Status;
            }
          });
         
          attOffset += attPageSize;
          if (aRows.length < attPageSize) attHasMore = false;
        } catch (err) {
          console.log('Attendance fetch error:', err.message);
          attHasMore = false;
        }
      }
     
      // 3. Fetch and merge BioMax data
      try {
        let biomaxOffset = 0;
        let biomaxHasMore = true;
        const biomaxPageSize = 300;
       
        while (biomaxHasMore) {
          let biomaxQuery = `SELECT EmployeeCode, EmployeeName, LogDate FROM BioMax
                            WHERE LogDate >= '${startDate}'
                            AND LogDate <= '${endDate}'`;
          if (employeeIds.length > 0) {
            const employeeIdList = employeeIds.map(id => `'${id}'`).join(',');
            biomaxQuery += ` AND EmployeeCode IN (${employeeIdList})`;
          }
          biomaxQuery += ` ORDER BY EmployeeCode, LogDate LIMIT ${biomaxPageSize} OFFSET ${biomaxOffset}`;
         
          const biomaxBatch = await zcql.executeZCQLQuery(biomaxQuery);
          const biomaxRows = biomaxBatch.map(r => r.BioMax);
         
          if (biomaxRows.length === 0) {
            biomaxHasMore = false;
            break;
          }
         
          const biomaxByKey = {};
          biomaxRows.forEach(r => {
            let dateStr = '';
            let logDateTime = '';
            if (r.LogDate) {
              const logDateStr = String(r.LogDate).trim();
              const dateMatch = logDateStr.match(/^(\d{4}-\d{2}-\d{2})/);
              if (dateMatch) {
                dateStr = dateMatch[1];
                logDateTime = logDateStr;
              } else {
                const tmp = new Date(r.LogDate);
                if (!isNaN(tmp)) {
                  dateStr = tmp.toISOString().slice(0, 10);
                  const year = tmp.getFullYear();
                  const month = String(tmp.getMonth() + 1).padStart(2, '0');
                  const day = String(tmp.getDate()).padStart(2, '0');
                  const hour = String(tmp.getHours()).padStart(2, '0');
                  const minute = String(tmp.getMinutes()).padStart(2, '0');
                  const second = String(tmp.getSeconds()).padStart(2, '0');
                  logDateTime = `${year}-${month}-${day} ${hour}:${minute}:${second}`;
                }
              }
            }
            if (!dateStr || !logDateTime) return;
            if (dateStr < startDateOnly || dateStr > endDateOnly) return;
           
            const employeeCode = String(r.EmployeeCode || '').trim();
            if (!employeeCode) return;
            const key = `${employeeCode}_${dateStr}`;
           
            if (!biomaxByKey[key]) {
              biomaxByKey[key] = {
                EmployeeID: employeeCode,
                Date: dateStr,
                FirstIN: logDateTime,
                LastOUT: logDateTime
              };
            } else {
              if (logDateTime < biomaxByKey[key].FirstIN) biomaxByKey[key].FirstIN = logDateTime;
              if (logDateTime > biomaxByKey[key].LastOUT) biomaxByKey[key].LastOUT = logDateTime;
            }
          });
         
          Object.values(biomaxByKey).forEach(biomaxRec => {
            const key = `${biomaxRec.EmployeeID}_${biomaxRec.Date}`;
            if (byKey[key]) {
              if (biomaxRec.FirstIN && (!byKey[key].FirstIN || biomaxRec.FirstIN < byKey[key].FirstIN)) {
                byKey[key].FirstIN = biomaxRec.FirstIN;
              }
              if (biomaxRec.LastOUT && (!byKey[key].LastOUT || biomaxRec.LastOUT > byKey[key].LastOUT)) {
                byKey[key].LastOUT = biomaxRec.LastOUT;
              }
              byKey[key].Source = byKey[key].Source === 'BHR' || byKey[key].Source === 'Attendance' || byKey[key].Source === 'Both'
                ? (byKey[key].Source + '+BioMax')
                : (byKey[key].Source || 'BioMax');
            } else {
              byKey[key] = {
                EmployeeID: biomaxRec.EmployeeID,
                Date: biomaxRec.Date,
                FirstIN: biomaxRec.FirstIN,
                LastOUT: biomaxRec.LastOUT,
                Source: 'BioMax'
              };
            }
          });
         
          biomaxOffset += biomaxPageSize;
          if (biomaxRows.length < biomaxPageSize) biomaxHasMore = false;
        }
      } catch (biomaxError) {
        console.error('Error fetching BioMax records:', biomaxError);
      }
     
      // 4. Fetch and merge OnDuty data (OnDuty takes complete precedence)
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
         
          const ondutyBatch = await zcql.executeZCQLQuery(ondutyQuery);
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
            try {
              const d = new Date(`${dateStr} ${raw}`);
              if (!isNaN(d.getTime())) {
                const HH = String(d.getHours()).padStart(2, '0');
                const MM = String(d.getMinutes()).padStart(2, '0');
                const SS = String(d.getSeconds()).padStart(2, '0');
                return `${dateStr} ${HH}:${MM}:${SS}`;
              }
            } catch (e) {}
            return '';
          };
         
          ondutyRows.forEach(r => {
            let dateStr = '';
            if (r.OnDutyDate) {
              if (typeof r.OnDutyDate === 'string') {
                const dateStrRaw = String(r.OnDutyDate).trim();
                if (/^\d{4}-\d{2}-\d{2}$/.test(dateStrRaw)) {
                  dateStr = dateStrRaw;
                } else {
                  const dmy = dateStrRaw.match(/^(\d{2})[-\/.](\d{2})[-\/.](\d{4})$/);
                  if (dmy) {
                    const [, day, month, year] = dmy;
                    dateStr = `${year}-${month}-${day}`;
                  } else {
                    const tmp = new Date(r.OnDutyDate);
                    if (!isNaN(tmp)) dateStr = tmp.toISOString().slice(0, 10);
                  }
                }
              } else {
                const tmp = new Date(r.OnDutyDate);
                if (!isNaN(tmp)) dateStr = tmp.toISOString().slice(0, 10);
              }
            }
            if (!dateStr) return;
            if (dateStr < startDateOnly || dateStr > endDateOnly) return;
           
            let normalizedFirstIn = normalizeOnDutyTime(dateStr, r.FirstIn);
            let normalizedLastOut = normalizeOnDutyTime(dateStr, r.Lastout);
           
            if (!normalizedFirstIn || !normalizedLastOut) {
              const defaultFirstIn = `${dateStr} 08:25:00`;
              const defaultLastOut = `${dateStr} 16:55:00`;
              if (r.NoofHours) {
                const hours = String(r.NoofHours).trim().toLowerCase();
                if (hours === 'half day' || hours === 'halfday' || hours === '0.5') {
                  normalizedLastOut = normalizedLastOut || `${dateStr} 13:00:00`;
                }
              }
              normalizedFirstIn = normalizedFirstIn || defaultFirstIn;
              normalizedLastOut = normalizedLastOut || defaultLastOut;
            }
           
            const employeeCode = String(r.EmployeeCode || '').trim();
            if (!employeeCode) return;
            const key = `${employeeCode}_${dateStr}`;
            const isHalfDay = (() => {
              const nof = String(r.NoofHours || '').trim().toLowerCase();
              return nof === 'half day' || nof === 'halfday' || nof === '0.5';
            })();
            const existing = byKey[key];

            if (isHalfDay && existing) {
              // Half day: merge earliest FirstIN and latest LastOUT
              const existingFirst = existing.FirstIN || normalizedFirstIn;
              const existingLast = existing.LastOUT || normalizedLastOut;
              byKey[key] = {
                EmployeeID: employeeCode,
                Date: dateStr,
                FirstIN: existingFirst <= normalizedFirstIn ? existingFirst : normalizedFirstIn,
                LastOUT: existingLast >= normalizedLastOut ? existingLast : normalizedLastOut,
                Source: (existing.Source && !existing.Source.includes('OnDuty')) ? existing.Source + '+OnDuty' : 'OnDuty',
                IsOnDutyHalfDay: true // Mark as OnDuty half-day for LOH calculation
              };
            } else {
              // Full day or no existing: OnDuty takes complete precedence
              byKey[key] = {
                EmployeeID: employeeCode,
                Date: dateStr,
                FirstIN: normalizedFirstIn,
                LastOUT: normalizedLastOut,
                Source: 'OnDuty',
                IsOnDutyHalfDay: isHalfDay // Mark if it's OnDuty half-day
              };
            }
          });
         
          ondutyOffset += ondutyPageSize;
          if (ondutyRows.length < ondutyPageSize) ondutyHasMore = false;
        }
      } catch (ondutyError) {
        console.error('Error fetching OnDuty records:', ondutyError);
      }
     
      // 5. Fetch and merge CompOff data
      const OT_EXCLUSIONS = new Set();
      const compoffWoExcludeFromOT = new Set();
      const otYesFullHoursKeys = new Set();
      try {
        let compoffOffset = 0;
        let compoffHasMore = true;
        const compoffPageSize = 300;
       
        while (compoffHasMore) {
          let compoffQuery = `SELECT EmployeeCode, EmployeeName, WorkedOn, Taken, ComboffStatus, OT FROM Comboff`;
          if (employeeIds.length > 0) {
            const employeeIdList = employeeIds.map(id => `'${id}'`).join(',');
            compoffQuery += ` WHERE EmployeeCode IN (${employeeIdList})`;
          }
          compoffQuery += ` ORDER BY EmployeeCode, Taken LIMIT ${compoffPageSize} OFFSET ${compoffOffset}`;
         
          const compoffBatch = await zcql.executeZCQLQuery(compoffQuery);
          const compoffRows = compoffBatch.map(r => r.Comboff);
         
          if (compoffRows.length === 0) {
            compoffHasMore = false;
            break;
          }
         
          const normalizeDate = (dateValue) => {
            if (!dateValue) return '';
            if (typeof dateValue === 'string') {
              if (/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) return dateValue;
              const tmp = new Date(dateValue);
              if (!isNaN(tmp)) return tmp.toISOString().slice(0, 10);
            } else {
              const tmp = new Date(dateValue);
              if (!isNaN(tmp)) return tmp.toISOString().slice(0, 10);
            }
            return '';
          };
          const isWoDate = (dateStr) => {
            if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
            const d = new Date(dateStr);
            return d.getDay() === 0 || (d.getDay() === 6 && d.getDate() >= 1 && d.getDate() <= 7);
          };
          const compoffStatusYes = (v) => (String(v || '').trim().toLowerCase() === 'yes');
         
          compoffRows.forEach(r => {
            const employeeCode = String(r.EmployeeCode || '').trim();
            if (!employeeCode) return;
            const comboffYes = compoffStatusYes(r.ComboffStatus);
            const otYes = compoffStatusYes(r.OT);
           
            // Process WorkedOn date - mark as Present
            let workedOnDateStr = normalizeDate(r.WorkedOn);
            if (workedOnDateStr && workedOnDateStr >= startDateOnly && workedOnDateStr <= endDateOnly) {
              const workedOnKey = `${employeeCode}_${workedOnDateStr}`;
              if (comboffYes && isWoDate(workedOnDateStr)) compoffWoExcludeFromOT.add(workedOnKey);
              if (otYes) otYesFullHoursKeys.add(workedOnKey);
              const workedOnFirstIn = `${workedOnDateStr} 08:25:00`;
              const workedOnLastOut = `${workedOnDateStr} 16:55:00`;
             
              if (byKey[workedOnKey]) {
                const currentSource = byKey[workedOnKey].Source || '';
                if (!currentSource.includes('OnDuty')) {
                  if (!byKey[workedOnKey].FirstIN) byKey[workedOnKey].FirstIN = workedOnFirstIn;
                  if (!byKey[workedOnKey].LastOUT) byKey[workedOnKey].LastOUT = workedOnLastOut;
                }
              } else {
                byKey[workedOnKey] = {
                  EmployeeID: employeeCode,
                  Date: workedOnDateStr,
                  FirstIN: workedOnFirstIn,
                  LastOUT: workedOnLastOut,
                  Source: 'CompOffWorkedOn'
                };
              }
            }
           
            // Process Taken date - mark as CO (Comp Off). When Comboff=Yes, exclude taken date from OT.
            let takenDateStr = normalizeDate(r.Taken);
            if (takenDateStr && takenDateStr >= startDateOnly && takenDateStr <= endDateOnly) {
              const takenKey = `${employeeCode}_${takenDateStr}`;
              if (comboffYes) compoffWoExcludeFromOT.add(takenKey);
              const defaultFirstIn = `${takenDateStr} 08:25:00`;
              const defaultLastOut = `${takenDateStr} 16:55:00`;
             
              if (byKey[takenKey]) {
                const currentSource = byKey[takenKey].Source || '';
                if (!currentSource.includes('OnDuty')) {
                  if (!byKey[takenKey].FirstIN) byKey[takenKey].FirstIN = defaultFirstIn;
                  if (!byKey[takenKey].LastOUT) byKey[takenKey].LastOUT = defaultLastOut;
                }
              } else {
                byKey[takenKey] = {
                  EmployeeID: employeeCode,
                  Date: takenDateStr,
                  FirstIN: defaultFirstIn,
                  LastOUT: defaultLastOut,
                  Source: 'CompOff'
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
      compoffWoExcludeFromOT.forEach(k => OT_EXCLUSIONS.add(k));
     
      // 6. Fetch and merge Regularization data (same as attendance muster - so LOH uses muster FirstIN/LastOUT)
      try {
        let regOffset = 0;
        const regPageSize = 300;
        let regHasMore = true;
        while (regHasMore) {
          let regQuery = `SELECT EmployeeCode, EmployeeName, LogDate, FirstIn, LastOut FROM Regularization WHERE LogDate >= '${startDateOnly}' AND LogDate <= '${endDateOnly}'`;
          if (employeeIds.length > 0) {
            regQuery += ` AND EmployeeCode IN (${employeeIds.map(id => `'${id}'`).join(',')})`;
          }
          regQuery += ` ORDER BY EmployeeCode, LogDate LIMIT ${regPageSize} OFFSET ${regOffset}`;
          const regBatch = await zcql.executeZCQLQuery(regQuery);
          const regRows = regBatch.map(r => r.Regularization);
          if (regRows.length === 0) {
            regHasMore = false;
            break;
          }
          regRows.forEach(r => {
            let dateStr = '';
            if (r.LogDate) {
              const logDateStr = String(r.LogDate).trim();
              const dateMatch = logDateStr.match(/^(\d{4}-\d{2}-\d{2})/);
              if (dateMatch) dateStr = dateMatch[1];
              else {
                const tmp = new Date(r.LogDate);
                if (!isNaN(tmp)) dateStr = tmp.toISOString().slice(0, 10);
              }
            }
            if (!dateStr || dateStr < startDateOnly || dateStr > endDateOnly) return;
            const employeeCode = String(r.EmployeeCode || '').trim();
            if (!employeeCode) return;
            const key = `${employeeCode}_${dateStr}`;
            const firstInRaw = r.FirstIn ?? r['First In'];
            const lastOutRaw = r.LastOut ?? r['Last Out'];
            let firstInDateTime = '';
            let lastOutDateTime = '';
            if (firstInRaw) {
              const firstInStr = String(firstInRaw).trim();
              if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(firstInStr)) {
                const timePart = firstInStr.length === 5 ? firstInStr : firstInStr.substring(0, 5);
                firstInDateTime = `${dateStr} ${timePart}:00`.substring(0, 19);
              } else if (firstInStr.includes(' ')) {
                firstInDateTime = firstInStr.substring(0, 19);
              } else {
                const tmp = new Date(firstInStr);
                if (!isNaN(tmp)) {
                  const y = tmp.getFullYear(), m = String(tmp.getMonth() + 1).padStart(2, '0'), d = String(tmp.getDate()).padStart(2, '0');
                  const h = String(tmp.getHours()).padStart(2, '0'), min = String(tmp.getMinutes()).padStart(2, '0'), s = String(tmp.getSeconds()).padStart(2, '0');
                  firstInDateTime = `${y}-${m}-${d} ${h}:${min}:${s}`;
                }
              }
            }
            if (lastOutRaw) {
              const lastOutStr = String(lastOutRaw).trim();
              if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(lastOutStr)) {
                const timePart = lastOutStr.length === 5 ? lastOutStr : lastOutStr.substring(0, 5);
                lastOutDateTime = `${dateStr} ${timePart}:00`.substring(0, 19);
              } else if (lastOutStr.includes(' ')) {
                lastOutDateTime = lastOutStr.substring(0, 19);
              } else {
                const tmp = new Date(lastOutStr);
                if (!isNaN(tmp)) {
                  const y = tmp.getFullYear(), m = String(tmp.getMonth() + 1).padStart(2, '0'), d = String(tmp.getDate()).padStart(2, '0');
                  const h = String(tmp.getHours()).padStart(2, '0'), min = String(tmp.getMinutes()).padStart(2, '0'), s = String(tmp.getSeconds()).padStart(2, '0');
                  lastOutDateTime = `${y}-${m}-${d} ${h}:${min}:${s}`;
                }
              }
            }
            if (firstInDateTime && lastOutDateTime) {
              try {
                const fi = new Date(String(firstInDateTime).substring(0, 19).replace(' ', 'T'));
                const lo = new Date(String(lastOutDateTime).substring(0, 19).replace(' ', 'T'));
                if (!isNaN(fi.getTime()) && !isNaN(lo.getTime()) && lo.getTime() <= fi.getTime()) {
                  lo.setDate(lo.getDate() + 1);
                  const y = lo.getFullYear();
                  const mo = String(lo.getMonth() + 1).padStart(2, '0');
                  const da = String(lo.getDate()).padStart(2, '0');
                  const h = String(lo.getHours()).padStart(2, '0');
                  const min = String(lo.getMinutes()).padStart(2, '0');
                  const sec = String(lo.getSeconds()).padStart(2, '0');
                  lastOutDateTime = `${y}-${mo}-${da} ${h}:${min}:${sec}`;
                }
              } catch (_) { /* keep lastOutDateTime */ }
            }
            if (byKey[key]) {
              const currentSource = byKey[key].Source || '';
              if (!currentSource.includes('OnDuty') && !sourceHasCompOffTakenSegment(currentSource)) {
                if (firstInDateTime) byKey[key].FirstIN = firstInDateTime;
                if (lastOutDateTime) byKey[key].LastOUT = lastOutDateTime;
                byKey[key].Source = currentSource === 'BHR' || currentSource === 'Attendance' || currentSource === 'Both' ? (currentSource + '+Regularization') : (currentSource || 'Regularization');
              }
            } else {
              byKey[key] = {
                EmployeeID: employeeCode,
                Date: dateStr,
                FirstIN: firstInDateTime || null,
                LastOUT: lastOutDateTime || null,
                Source: 'Regularization'
              };
            }
          });
          regOffset += regPageSize;
          if (regRows.length < regPageSize) regHasMore = false;
        }
        console.log('LOH: Merged Regularization into byKey (same as attendance muster)');
      } catch (regErr) {
        console.error('LOH: Error merging Regularization:', regErr.message);
      }
     
      // Collect all unique EmployeeIDs from byKey
      const uniqueEmpIds = [...new Set(Object.values(byKey).map(item => item.EmployeeID))];
      if (uniqueEmpIds.length === 0) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: [] }));
        return;
      }
     
      // 2. Query Employee table for these EmployeeCodes (batch if more than 300)
      const empTable = catalystApp.datastore().table('Employee');
      const empDetailsMap = {};
      const batchSize = 300;
     
      // Process employee IDs in batches to avoid ZCQL limit
      for (let i = 0; i < uniqueEmpIds.length; i += batchSize) {
        const batch = uniqueEmpIds.slice(i, i + batchSize);
        const empQuery = `SELECT EmployeeCode, EmployeeName, Department, Designation, Category, ContractorName, DateofJoining, DateofExit FROM Employee WHERE EmployeeCode IN (${batch.map(id => `'${id}'`).join(',')})`;
        try {
          const empRecords = await catalystApp.zcql().executeZCQLQuery(empQuery);
          for (const row of empRecords) {
            const emp = row.Employee;
           
            // Normalize date of joining to YYYY-MM-DD format
            let dateOfJoining = '';
            if (emp.DateofJoining) {
              const doj = String(emp.DateofJoining);
              if (/^\d{4}-\d{2}-\d{2}$/.test(doj)) {
                dateOfJoining = doj;
              } else {
                const parsed = new Date(doj);
                if (!isNaN(parsed.getTime())) {
                  dateOfJoining = parsed.toISOString().slice(0, 10);
                }
              }
            }
           
            // Normalize date of exit to YYYY-MM-DD format
            let dateOfExit = '';
            if (emp.DateofExit) {
              const doe = String(emp.DateofExit);
              if (/^\d{4}-\d{2}-\d{2}$/.test(doe)) {
                dateOfExit = doe;
              } else {
                const parsed = new Date(doe);
                if (!isNaN(parsed.getTime())) {
                  dateOfExit = parsed.toISOString().slice(0, 10);
                }
              }
            }
           
            empDetailsMap[emp.EmployeeCode] = {
              employeeName: emp.EmployeeName || '',
              department: emp.Department || '',
              designation: emp.Designation || '',
              category: emp.Category || '',
              contractorName: emp.ContractorName || '',
              dateOfJoining: dateOfJoining,
              dateOfExit: dateOfExit
            };
          }
        } catch (err) {
          console.log('LOH Employee query error for batch:', err.message);
          // Continue with next batch even if one fails
        }
      }
     
      // 3. Query Shiftmap/ShiftMapping table to get shift information for employees
      const shiftMap = {}; // Key: empId -> { assignedShift, fromdate, todate }
      try {
        // Try multiple table/column name variations
        let shiftRecords = [];
        let tableName = '';
        let rowKey = '';
       
        // Try ShiftMapping first (as used in payroll_function)
        try {
          // First, try to get all records to verify table exists
          const testQuery = `SELECT EmployeeID, AssignedShift, FromDate, ToDate FROM ShiftMapping LIMIT 10`;
          const testRecords = await catalystApp.zcql().executeZCQLQuery(testQuery);
          console.log(`LOH: ShiftMapping table exists, found ${testRecords.length} test records`);
         
          // Now query with date filter
          const shiftQuery1 = `SELECT EmployeeID, AssignedShift, FromDate, ToDate FROM ShiftMapping WHERE FromDate <= '${endDate}' AND ToDate >= '${startDate}'`;
          shiftRecords = await catalystApp.zcql().executeZCQLQuery(shiftQuery1);
          if (shiftRecords.length > 0) {
            tableName = 'ShiftMapping';
            rowKey = 'ShiftMapping';
            console.log(`LOH: Found ${shiftRecords.length} records in ShiftMapping table for date range ${startDate} to ${endDate}`);
          } else {
            console.log(`LOH: ShiftMapping table exists but no records found for date range ${startDate} to ${endDate}`);
            // Try without date filter to see if there's any data
            const allRecordsQuery = `SELECT EmployeeID, AssignedShift, FromDate, ToDate FROM ShiftMapping LIMIT 100`;
            const allRecords = await catalystApp.zcql().executeZCQLQuery(allRecordsQuery);
            console.log(`LOH: ShiftMapping table has ${allRecords.length} total records (showing first 100)`);
            if (allRecords.length > 0) {
              const sample = allRecords[0].ShiftMapping || allRecords[0];
              console.log(`LOH: Sample ShiftMapping record: EmployeeID=${sample.EmployeeID}, FromDate=${sample.FromDate}, ToDate=${sample.ToDate}, AssignedShift=${sample.AssignedShift}`);
            }
          }
        } catch (err1) {
          console.log(`LOH: ShiftMapping table query failed: ${err1.message}`);
        }
       
        // If ShiftMapping didn't work, try Shiftmap
        if (shiftRecords.length === 0) {
          try {
            // First, try to get all records to verify table exists and check structure
            const testQuery2 = `SELECT EmployeeId, EmployeeID, AssignedShift, Fromdate, Todate, FromDate, ToDate, DateWise, DateWiseShiftName FROM Shiftmap LIMIT 10`;
            const testRecords2 = await catalystApp.zcql().executeZCQLQuery(testQuery2);
            console.log(`LOH: Shiftmap table exists, found ${testRecords2.length} test records`);
           
            if (testRecords2.length > 0) {
              const sample = testRecords2[0].Shiftmap || testRecords2[0];
              console.log(`LOH: Sample Shiftmap record structure: EmployeeID=${sample.EmployeeId || sample.EmployeeID}, FromDate=${sample.Fromdate || sample.FromDate}, ToDate=${sample.Todate || sample.ToDate}, DateWise=${sample.DateWise}, AssignedShift=${sample.AssignedShift}`);
            }
           
            // Query ALL records with DateWise and filter in memory (more reliable than SQL date matching)
            // This handles date format variations better
            const allRecordsQuery = `SELECT EmployeeId, EmployeeID, AssignedShift, DateWise, DateWiseShiftName, Fromdate, Todate, FromDate, ToDate FROM Shiftmap`;
            const allShiftRecords = await catalystApp.zcql().executeZCQLQuery(allRecordsQuery);
            console.log(`LOH: Fetched ${allShiftRecords.length} total records from Shiftmap table (will filter by date range in memory)`);
           
            if (allShiftRecords.length > 0) {
              // Show sample record to understand date format
              const sample = allShiftRecords[0].Shiftmap || allShiftRecords[0];
              console.log(`LOH: Sample Shiftmap record: EmployeeID=${sample.EmployeeId || sample.EmployeeID}, DateWise=${sample.DateWise} (type: ${typeof sample.DateWise}), FromDate=${sample.Fromdate || sample.FromDate}, ToDate=${sample.Todate || sample.ToDate}, AssignedShift=${sample.AssignedShift}`);
             
              // Helper function to normalize date for comparison (handles multiple formats)
              const normalizeDateForFilter = (dateVal) => {
                if (!dateVal) return null;
                if (typeof dateVal === 'string') {
                  // Already in YYYY-MM-DD format
                  if (/^\d{4}-\d{2}-\d{2}$/.test(dateVal)) return dateVal;
                  // Handle DD/MM/YYYY format (e.g., "09/12/2025")
                  const ddmmyyyyMatch = dateVal.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
                  if (ddmmyyyyMatch) {
                    const [, day, month, year] = ddmmyyyyMatch;
                    return `${year}-${month}-${day}`;
                  }
                  // Try parsing as date
                  const d = new Date(dateVal);
                  if (!isNaN(d.getTime())) {
                    const year = d.getFullYear();
                    const month = String(d.getMonth() + 1).padStart(2, '0');
                    const day = String(d.getDate()).padStart(2, '0');
                    return `${year}-${month}-${day}`;
                  }
                } else if (dateVal instanceof Date) {
                  const year = dateVal.getFullYear();
                  const month = String(dateVal.getMonth() + 1).padStart(2, '0');
                  const day = String(dateVal.getDate()).padStart(2, '0');
                  return `${year}-${month}-${day}`;
                }
                return null;
              };
             
              // Normalize start and end dates for comparison
              const normalizedStartDate = normalizeDateForFilter(startDate);
              const normalizedEndDate = normalizeDateForFilter(endDate);
              console.log(`LOH: Filtering by date range: ${normalizedStartDate} to ${normalizedEndDate}`);
             
              // Filter records by DateWise within the date range
              shiftRecords = allShiftRecords.filter(row => {
                const shift = row.Shiftmap || row;
                const dateWise = shift.DateWise || shift.dateWise;
                if (!dateWise) return false; // Skip records without DateWise
               
                const normalizedDateWise = normalizeDateForFilter(dateWise);
                if (!normalizedDateWise) return false;
               
                // Check if DateWise is within the date range
                const isInRange = normalizedDateWise >= normalizedStartDate && normalizedDateWise <= normalizedEndDate;
               
                // Debug logging for employee 35021
                const empId = String(shift.EmployeeId || shift.EmployeeID || '').trim();
                if (empId === '35021') {
                  console.log(`LOH Filter - Employee ${empId}: DateWise=${dateWise}, normalized=${normalizedDateWise}, inRange=${isInRange}, AssignedShift=${shift.AssignedShift || shift.DateWiseShiftName}`);
                }
               
                return isInRange;
              });
             
              if (shiftRecords.length > 0) {
                tableName = 'Shiftmap';
                rowKey = 'Shiftmap';
                console.log(`LOH: Found ${shiftRecords.length} records in Shiftmap table after filtering by DateWise for date range ${startDate} to ${endDate}`);
              } else {
                console.log(`LOH: No records found after filtering by DateWise for date range ${startDate} to ${endDate}`);
                // Fallback: Try with FromDate/ToDate range if DateWise filtering didn't work
                const shiftQuery3 = `SELECT EmployeeId, EmployeeID, AssignedShift, DateWise, DateWiseShiftName, Fromdate, Todate, FromDate, ToDate FROM Shiftmap WHERE (Fromdate <= '${endDate}' AND Todate >= '${startDate}') OR (FromDate <= '${endDate}' AND ToDate >= '${startDate}')`;
                shiftRecords = await catalystApp.zcql().executeZCQLQuery(shiftQuery3);
                if (shiftRecords.length > 0) {
                  tableName = 'Shiftmap';
                  rowKey = 'Shiftmap';
                  console.log(`LOH: Found ${shiftRecords.length} records in Shiftmap table using FromDate/ToDate range`);
                }
              }
            }
          } catch (err2) {
            console.log(`LOH: Shiftmap table query failed: ${err2.message}`);
          }
        }
       
        console.log(`LOH: Fetched ${shiftRecords.length} shift records from ${tableName || 'Shiftmap/ShiftMapping'} table`);
       
        for (const row of shiftRecords) {
          const shift = row[rowKey] || row.Shiftmap || row.ShiftMapping || row;
          // Try multiple employee ID field names
          const empId = String(shift.EmployeeId || shift.EmployeeID || shift.employeeId || shift.employeeID || '').trim();
          if (!empId) continue;
         
          // Normalize dates to YYYY-MM-DD format
          // Handle both DD/MM/YYYY and YYYY-MM-DD formats
          const normalizeDate = (dateVal) => {
            if (!dateVal) return '';
            if (typeof dateVal === 'string') {
              // Already in YYYY-MM-DD format
              if (/^\d{4}-\d{2}-\d{2}$/.test(dateVal)) return dateVal;
             
              // Handle DD/MM/YYYY format (e.g., "09/12/2025")
              const ddmmyyyyMatch = dateVal.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
              if (ddmmyyyyMatch) {
                const [, day, month, year] = ddmmyyyyMatch;
                return `${year}-${month}-${day}`;
              }
             
              // Try standard Date parsing
              const d = new Date(dateVal);
              if (!isNaN(d.getTime())) {
                const year = d.getFullYear();
                const month = String(d.getMonth() + 1).padStart(2, '0');
                const day = String(d.getDate()).padStart(2, '0');
                return `${year}-${month}-${day}`;
              }
            } else {
              const d = new Date(dateVal);
              if (!isNaN(d.getTime())) {
                const year = d.getFullYear();
                const month = String(d.getMonth() + 1).padStart(2, '0');
                const day = String(d.getDate()).padStart(2, '0');
                return `${year}-${month}-${day}`;
              }
            }
            return '';
          };
         
          // Try multiple date field name variations (case sensitivity)
          // Priority: DateWise (exact date) > FromDate/ToDate (date range)
          const dateWise = normalizeDate(shift.DateWise || shift.dateWise || shift.Datewise || shift.datewise);
          const fromDate = normalizeDate(shift.Fromdate || shift.FromDate || shift.fromdate || shift.fromDate);
          const toDate = normalizeDate(shift.Todate || shift.ToDate || shift.todate || shift.toDate);
          // Use DateWiseShiftName as fallback if AssignedShift is not available
          const assignedShift = String(shift.AssignedShift || shift.assignedShift || shift.DateWiseShiftName || shift.dateWiseShiftName || '').trim().toUpperCase();
         
          // Debug logging for employee 35021
          if (empId === '35021') {
            console.log(`LOH Shiftmap - Employee ${empId}: AssignedShift="${shift.AssignedShift || shift.DateWiseShiftName}" -> normalized="${assignedShift}", DateWise=${dateWise || shift.DateWise}, fromDate=${fromDate}, toDate=${toDate}`);
          }
         
          // Store shift info for this employee
          if (!shiftMap[empId]) {
            shiftMap[empId] = [];
          }
          shiftMap[empId].push({
            assignedShift: assignedShift,
            dateWise: dateWise, // Store DateWise for exact date matching
            fromdate: fromDate,
            todate: toDate
          });
         
          // Debug logging for employee 35021
          if (empId === '35021') {
            console.log(`LOH Shiftmap - Employee ${empId}: AssignedShift="${shift.AssignedShift || shift.DateWiseShiftName}" -> normalized="${assignedShift}", DateWise=${dateWise}, fromDate=${fromDate}, toDate=${toDate}`);
          }
        }
        console.log(`LOH: Fetched shift information for ${Object.keys(shiftMap).length} employees`);
        if (shiftMap['35021']) {
          console.log(`LOH: Shiftmap data for 35021:`, JSON.stringify(shiftMap['35021'], null, 2));
        }
      } catch (err) {
        console.log('LOH Shiftmap query error:', err.message);
        // Continue without shift information if query fails
      }
     
      // 4. Query NewShiftMap table to get shift types for employees (priority over Shiftmap)
      const newShiftMap = {}; // Key: "employeeCode_date" -> shiftType
      try {
        console.log(`LOH: Fetching shift data from NewShiftMap for date range ${startDate} to ${endDate}`);
        const newShiftMapQuery = `SELECT EmployeeCode, ShiftDate, ShiftType FROM NewShiftMap WHERE ShiftDate >= '${startDate}' AND ShiftDate <= '${endDate}'`;
       
        // Use pagination to fetch all records (ZCQL max limit is 300)
        const pageSize = 300;
        let offset = 0;
        let hasMore = true;
        const allNewShiftRecords = [];
       
        while (hasMore) {
          try {
            const paginatedQuery = `${newShiftMapQuery} ORDER BY EmployeeCode, ShiftDate LIMIT ${pageSize} OFFSET ${offset}`;
            const batch = await catalystApp.zcql().executeZCQLQuery(paginatedQuery);
           
            if (batch.length === 0) {
              hasMore = false;
              break;
            }
           
            allNewShiftRecords.push(...batch);
            offset += pageSize;
           
            if (batch.length < pageSize) {
              hasMore = false;
            }
          } catch (pagErr) {
            // If pagination fails, try without pagination
            console.log('LOH: NewShiftMap pagination failed, trying without pagination:', pagErr.message);
            try {
              const rows = await catalystApp.zcql().executeZCQLQuery(newShiftMapQuery);
              allNewShiftRecords.push(...rows);
            } catch (queryErr) {
              console.error('LOH: Error executing NewShiftMap query without pagination:', queryErr);
            }
            hasMore = false;
          }
        }
       
        console.log(`LOH: Fetched ${allNewShiftRecords.length} records from NewShiftMap`);
       
        // Build map: employeeCode_date -> shiftType
        for (const row of allNewShiftRecords) {
          const record = row.NewShiftMap || row;
          const empCode = String(record.EmployeeCode || '').trim();
          const shiftDate = String(record.ShiftDate || '').trim();
          const shiftType = String(record.ShiftType || '').trim().toUpperCase();
         
          if (empCode && shiftDate) {
            // Normalize date to YYYY-MM-DD format
            let normalizedDate = shiftDate;
            if (!/^\d{4}-\d{2}-\d{2}$/.test(shiftDate)) {
              // Try parsing as date
              const d = new Date(shiftDate);
              if (!isNaN(d.getTime())) {
                const year = d.getFullYear();
                const month = String(d.getMonth() + 1).padStart(2, '0');
                const day = String(d.getDate()).padStart(2, '0');
                normalizedDate = `${year}-${month}-${day}`;
              }
            }
           
            const key = `${empCode}_${normalizedDate}`;
            newShiftMap[key] = shiftType;
          }
        }
       
        console.log(`LOH: Built NewShiftMap with ${Object.keys(newShiftMap).length} employee-date entries`);
      } catch (err) {
        console.log('LOH: NewShiftMap query error:', err.message);
        // Continue without NewShiftMap information if query fails
      }

      // Fetch Shift table (shift_function) definitions so LOH uses mapped shift start/end, not hardcoded times
      const lohShiftDefinitions = {};
      const normalizeShiftNameKeyLOH = (name) => String(name || '').trim().toUpperCase().replace(/\s+/g, '');
      const normalizeTimeToHmsLOH = (timeValue) => {
        const raw = String(timeValue || '').trim();
        if (!raw) return '';
        const hhmmss = raw.match(/^([01]?\d|2[0-3]):([0-5]\d):([0-5]\d)$/);
        if (hhmmss) return `${hhmmss[1].padStart(2, '0')}:${hhmmss[2]}:${hhmmss[3]}`;
        const hhmm = raw.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
        if (hhmm) return `${hhmm[1].padStart(2, '0')}:${hhmm[2]}:00`;
        return '';
      };
      try {
        const shiftRows = await zcql.executeZCQLQuery('SELECT ShiftName, FromDate, ToDate FROM Shift');
        for (const row of shiftRows) {
          const shift = row.Shift || row;
          const shiftName = String(shift.ShiftName || '').trim();
          const fromTime = normalizeTimeToHmsLOH(shift.FromDate);
          const toTime = normalizeTimeToHmsLOH(shift.ToDate);
          if (!shiftName || !fromTime || !toTime) continue;
          lohShiftDefinitions[normalizeShiftNameKeyLOH(shiftName)] = { shiftName, fromTime, toTime };
        }
        console.log(`LOH: Loaded ${Object.keys(lohShiftDefinitions).length} shift definitions from Shift table`);
      } catch (err) {
        console.log('LOH: Shift table query error:', err.message);
      }

      // Get assigned shift name for employee+date (NewShiftMap priority, then Shiftmap)
      const getAssignedShiftForDateLOH = (empId, dateStr) => {
        const normalizedEmpId = String(empId).trim();
        const normalizedDate = normalizeDateForCompare(dateStr);
        const newShiftKey = `${normalizedEmpId}_${normalizedDate}`;
        const newShiftType = String(newShiftMap[newShiftKey] || '').trim();
        if (newShiftType) return newShiftType;
        const mappedShifts = shiftMap[normalizedEmpId] || [];
        for (const shift of mappedShifts) {
          const assignedShift = String(shift.assignedShift || '').trim();
          if (!assignedShift) continue;
          if (shift.fromdate && shift.todate) {
            if (normalizedDate >= shift.fromdate && normalizedDate <= shift.todate) return assignedShift;
          } else if (shift.fromdate && normalizedDate >= shift.fromdate) return assignedShift;
          else if (shift.todate && normalizedDate <= shift.todate) return assignedShift;
        }
        return '';
      };

      // When shiftmap is not mapped, use General shift from Shift table (same as attendance muster)
      const getGeneralShiftDefinitionLOH = () => {
        const keys = Object.keys(lohShiftDefinitions);
        const matchKey = keys.find((k) => k.includes('GENERAL') && !k.includes('GENERALII'));
        return matchKey ? lohShiftDefinitions[matchKey] : null;
      };

      // Resolve shift definition from Shift table by assigned shift name (with alias resolution)
      const getShiftDefinitionForEmployeeDateLOH = (empId, dateStr) => {
        const assignedShift = getAssignedShiftForDateLOH(empId, dateStr);
        // When shiftmap is not mapped for this employee/date, use General shift from Shift table (same as attendance muster)
        if (!assignedShift) return getGeneralShiftDefinitionLOH();
        const key = normalizeShiftNameKeyLOH(assignedShift);
        if (lohShiftDefinitions[key]) return lohShiftDefinitions[key];
        const findByKeyword = (keywordList) => {
          const keys = Object.keys(lohShiftDefinitions);
          const matchKey = keys.find((k) => keywordList.some((kw) => k.includes(kw)));
          return matchKey ? lohShiftDefinitions[matchKey] : null;
        };
        if (key.includes('GENERALII') || (key.includes('GENERAL') && key.includes('II'))) return findByKeyword(['GENERALII']);
        if (key.includes('GENERAL')) return findByKeyword(['GENERAL']);
        if (key.includes('1ST') || key.includes('FIRST') || key === '1' || key.includes('SHIFT1')) return findByKeyword(['1ST', 'FIRST']);
        if (key.includes('2ND') || key.includes('SECOND') || key === '2' || key.includes('SHIFT2')) return findByKeyword(['2ND', 'SECOND']);
        if (key.includes('HOUSEKEEPING') || key === 'HK') return findByKeyword(['HOUSEKEEPING', 'HK']);
        return null;
      };

      // Helper function to normalize date for comparison (handles DD/MM/YYYY and YYYY-MM-DD)
      const normalizeDateForCompare = (dateVal) => {
        if (!dateVal) return '';
        if (typeof dateVal === 'string') {
          // Already in YYYY-MM-DD format
          if (/^\d{4}-\d{2}-\d{2}$/.test(dateVal)) return dateVal;
          // Handle DD/MM/YYYY format (e.g., "09/12/2025")
          const ddmmyyyyMatch = dateVal.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
          if (ddmmyyyyMatch) {
            const [, day, month, year] = ddmmyyyyMatch;
            return `${year}-${month}-${day}`;
          }
        }
        return String(dateVal);
      };

      // Helper functions for shift detection
      // Check in order: NewShiftMap (priority) -> Shiftmap -> default to general
      // Helper function to check if employee is on 1st shift for a specific date
      const isFirstShift = (empId, dateStr) => {
        // First, check NewShiftMap (has priority)
        const normalizedEmpId = String(empId).trim();
        const normalizedDate = normalizeDateForCompare(dateStr);
        const newShiftKey = `${normalizedEmpId}_${normalizedDate}`;
        const newShiftType = newShiftMap[newShiftKey];
       
        if (newShiftType) {
          // Check if it's a 1st shift type
          const isFirstShiftMatch = newShiftType === '1ST' || newShiftType === '1ST SHIFT' ||
              newShiftType === 'FIRST' || newShiftType === 'FIRST SHIFT' ||
              newShiftType === '1' || newShiftType === 'SHIFT 1' ||
              newShiftType.includes('1ST') || newShiftType.includes('FIRST');
         
          if (isFirstShiftMatch) {
            if (empId === '35021') {
              console.log(`LOH isFirstShift - Employee ${empId} on ${dateStr}: Found in NewShiftMap with shiftType="${newShiftType}"`);
            }
            return true;
          }
        }
        // Jan 3 2026 only: use only NewShiftMap for LOH; do not fallback to Shiftmap
        if (normalizedDate === normalizeDateForCompare('2026-01-03')) return false;
       
        // Fallback to Shiftmap if not found in NewShiftMap
        if (!shiftMap[empId] || shiftMap[empId].length === 0) {
          if (empId === '35021') {
            console.log(`LOH isFirstShift - Employee ${empId} on ${dateStr}: No shiftMap entry found`);
          }
          return false;
        }
        // Check if any shift mapping covers this date and is 1st shift
        // Note: shift.assignedShift is stored as uppercase in shiftMap
        for (const shift of shiftMap[empId]) {
          const shiftName = String(shift.assignedShift || '').trim();
          // Check for various 1st shift naming patterns (already uppercase from storage)
          // Handle "1ST SHIFT", "1ST", "FIRST", "FIRST SHIFT", "1", "SHIFT 1"
          const isFirstShiftMatch = shiftName === '1ST' || shiftName === '1ST SHIFT' || shiftName === 'FIRST' ||
              shiftName === 'FIRST SHIFT' || shiftName === '1' || shiftName === 'SHIFT 1';
         
          if (isFirstShiftMatch) {
            // Priority 1: Check DateWise for exact date match (preferred method)
            let dateMatches = false;
            if (shift.dateWise) {
              // DateWise contains the exact date for this shift assignment
              // Normalize both dates for comparison (handle DD/MM/YYYY format)
              const normalizedDateWise = normalizeDateForCompare(shift.dateWise);
              const normalizedEventDate = normalizeDateForCompare(dateStr);
              dateMatches = normalizedDateWise === normalizedEventDate;
            } else {
              // Fallback: Check if date is within the shift date range
              if (shift.fromdate && shift.todate) {
                dateMatches = dateStr >= shift.fromdate && dateStr <= shift.todate;
              } else if (shift.fromdate) {
                dateMatches = dateStr >= shift.fromdate;
              } else if (shift.todate) {
                dateMatches = dateStr <= shift.todate;
              }
            }
           
            if (empId === '35021') {
              console.log(`LOH isFirstShift - Employee ${empId} on ${dateStr}: shiftName="${shiftName}", dateWise=${shift.dateWise}, normalizedDateWise=${normalizeDateForCompare(shift.dateWise)}, normalizedEventDate=${normalizeDateForCompare(dateStr)}, fromdate=${shift.fromdate}, todate=${shift.todate}, dateMatches=${dateMatches}`);
            }
           
            if (dateMatches) {
              return true;
            }
          }
        }
        if (empId === '35021') {
          console.log(`LOH isFirstShift - Employee ${empId} on ${dateStr}: No matching 1st shift found`);
        }
        return false;
      };
     
      // Helper function to check if employee is on 2nd shift for a specific date
      const isSecondShift = (empId, dateStr) => {
        // First, check NewShiftMap (has priority)
        const normalizedEmpId = String(empId).trim();
        const normalizedDate = normalizeDateForCompare(dateStr);
        const newShiftKey = `${normalizedEmpId}_${normalizedDate}`;
        const newShiftType = newShiftMap[newShiftKey];
       
        if (newShiftType) {
          // Check if it's a 2nd shift type
          const isSecondShiftMatch = newShiftType === '2ND' || newShiftType === '2ND SHIFT' ||
              newShiftType === 'SECOND' || newShiftType === 'SECOND SHIFT' ||
              newShiftType === '2' || newShiftType === 'SHIFT 2' ||
              newShiftType.includes('2ND') || newShiftType.includes('SECOND');
         
          if (isSecondShiftMatch) {
            if (empId === '35021') {
              console.log(`LOH isSecondShift - Employee ${empId} on ${dateStr}: Found in NewShiftMap with shiftType="${newShiftType}"`);
            }
            return true;
          }
        }
        // Jan 3 2026 only: use only NewShiftMap for LOH; do not fallback to Shiftmap
        if (normalizedDate === normalizeDateForCompare('2026-01-03')) return false;
       
        // Fallback to Shiftmap if not found in NewShiftMap
        if (!shiftMap[empId] || shiftMap[empId].length === 0) return false;
        // Check if any shift mapping covers this date and is 2nd shift
        // Note: shift.assignedShift is stored as uppercase in shiftMap
        for (const shift of shiftMap[empId]) {
          const shiftName = String(shift.assignedShift || '').trim();
          // Check for various 2nd shift naming patterns (already uppercase from storage)
          if (shiftName === '2ND' || shiftName === '2ND SHIFT' || shiftName === 'SECOND' ||
              shiftName === 'SECOND SHIFT' || shiftName === '2' || shiftName === 'SHIFT 2') {
            // Priority 1: Check DateWise for exact date match (preferred method)
            let dateMatches = false;
            if (shift.dateWise) {
              // DateWise contains the exact date for this shift assignment
              // Normalize both dates for comparison (handle DD/MM/YYYY format)
              const normalizedDateWise = normalizeDateForCompare(shift.dateWise);
              const normalizedEventDate = normalizeDateForCompare(dateStr);
              dateMatches = normalizedDateWise === normalizedEventDate;
            } else {
              // Fallback: Check if date is within the shift date range
              if (shift.fromdate && shift.todate) {
                dateMatches = dateStr >= shift.fromdate && dateStr <= shift.todate;
              } else if (shift.fromdate) {
                dateMatches = dateStr >= shift.fromdate;
              } else if (shift.todate) {
                dateMatches = dateStr <= shift.todate;
              }
            }
           
            if (dateMatches) {
              return true;
            }
          }
        }
        return false;
      };
     
      // General shift: if employee is NOT in shiftmap, default to general shift
      // OR if employee has GENERAL shift explicitly assigned in shiftmap
      // OR if employee is in shiftmap but doesn't have 1st or 2nd shift for this date
      const isGeneralShift = (empId, dateStr) => {
        // First, check NewShiftMap (has priority)
        const normalizedEmpId = String(empId).trim();
        const normalizedDate = normalizeDateForCompare(dateStr);
        const newShiftKey = `${normalizedEmpId}_${normalizedDate}`;
        const newShiftType = newShiftMap[newShiftKey];
       
        if (newShiftType) {
          // Housekeeping is NOT a General shift (it has its own LOH rules)
          const shiftTypeUpper = String(newShiftType || '').trim().toUpperCase();
          const shiftTypeCompact = shiftTypeUpper.replace(/\s+/g, '');
          const housekeepingMatch =
            shiftTypeUpper === 'HOUSEKEEPING' ||
            shiftTypeUpper === 'HOUSEKEEPING SHIFT' ||
            shiftTypeUpper === 'HOUSE KEEPING' ||
            shiftTypeUpper === 'HK' ||
            shiftTypeUpper.includes('HOUSEKEEPING') ||
            shiftTypeCompact.includes('HOUSEKEEPING');
          if (housekeepingMatch) {
            return false;
          }

          // General II is NOT a General shift - it has its own LOH/OT rules (12:00-20:00, OT after 21:00)
          const isGeneralIIMatch = shiftTypeUpper === 'GENERAL II' || shiftTypeUpper === 'GENERALII' ||
              shiftTypeCompact.includes('GENERALII') || (shiftTypeUpper.includes('GENERAL') && shiftTypeUpper.includes('II'));
          if (isGeneralIIMatch) {
            return false; // General II is handled separately
          }

          // Check if it's a General shift type
          const isGeneralShiftMatch = newShiftType === 'GENERAL' || newShiftType === 'GENERAL SHIFT' ||
              newShiftType.includes('GENERAL');
         
          if (isGeneralShiftMatch) {
            if (empId === '35021') {
              console.log(`LOH isGeneralShift - Employee ${empId} on ${dateStr}: Found in NewShiftMap with shiftType="${newShiftType}"`);
            }
            return true;
          }
         
          // If NewShiftMap has a shift type but it's not General, 1st, 2nd, or General II, check if it's one of those
          const isFirst = isFirstShift(empId, dateStr);
          const isSecond = isSecondShift(empId, dateStr);
          // If it's not 1st or 2nd, and NewShiftMap has a value, it might be General or default to General
          if (!isFirst && !isSecond) {
            return true; // Default to General if NewShiftMap has a shift type but it's not 1st or 2nd
          }
          return false; // If it's 1st or 2nd, it's not General
        }
        // Jan 3 2026 only: use only NewShiftMap for LOH; do not fallback to Shiftmap
        if (normalizedDate === normalizeDateForCompare('2026-01-03')) return false;
       
        // Fallback to Shiftmap if not found in NewShiftMap
        // If employee is not in shiftmap at all, default to general shift
        if (!shiftMap[empId] || shiftMap[empId].length === 0) return true;
       
        // Check if employee has GENERAL shift explicitly assigned (case-insensitive)
        for (const shift of shiftMap[empId]) {
          const shiftName = String(shift.assignedShift || '').trim().toUpperCase();
          if (shiftName === 'GENERAL' || shiftName === 'GENERAL SHIFT') {
            // Check if date is within the shift date range
            if (shift.fromdate && shift.todate) {
              if (dateStr >= shift.fromdate && dateStr <= shift.todate) {
                return true;
              }
            } else if (shift.fromdate && dateStr >= shift.fromdate) {
              return true;
            } else if (shift.todate && dateStr <= shift.todate) {
              return true;
            }
          }
        }
       
        // If employee is in shiftmap but doesn't have 1st or 2nd shift for this date, default to general
        const hasFirstShift = isFirstShift(empId, dateStr);
        const hasSecondShift = isSecondShift(empId, dateStr);
       
        // If they don't have 1st or 2nd shift, default to general
        return !hasFirstShift && !hasSecondShift;
      };

      // Helper function to check if employee is on General II shift (12:00-20:00, 10 min grace, OT after 21:00)
      function isGeneralIIShift(empId, dateStr) {
        const normalizedEmpId = String(empId).trim();
        const normalizedDate = normalizeDateForCompare(dateStr);
        const newShiftKey = `${normalizedEmpId}_${normalizedDate}`;
        const newShiftType = newShiftMap[newShiftKey];
        if (newShiftType) {
          const shiftTypeUpper = String(newShiftType || '').trim().toUpperCase();
          const shiftTypeCompact = shiftTypeUpper.replace(/\s+/g, '');
          return shiftTypeUpper === 'GENERAL II' || shiftTypeUpper === 'GENERALII' ||
              shiftTypeCompact.includes('GENERALII') || (shiftTypeUpper.includes('GENERAL') && shiftTypeUpper.includes('II'));
        }
        return false;
      }

      // Helper function to check if employee is on Housekeeping shift for a specific date
      // Housekeeping: employee can come any time; LOH depends on total hours (8h with 10 min grace).
      function isHousekeepingShift(empId, dateStr) {
        // First, check NewShiftMap (has priority)
        const normalizedEmpId = String(empId).trim();
        const normalizedDate = normalizeDateForCompare(dateStr);
        const newShiftKey = `${normalizedEmpId}_${normalizedDate}`;
        const newShiftType = newShiftMap[newShiftKey];

        if (newShiftType) {
          const shiftTypeUpper = String(newShiftType || '').trim().toUpperCase();
          const shiftTypeCompact = shiftTypeUpper.replace(/\s+/g, '');
          const isHK =
            shiftTypeUpper === 'HOUSEKEEPING' ||
            shiftTypeUpper === 'HOUSEKEEPING SHIFT' ||
            shiftTypeUpper === 'HOUSE KEEPING' ||
            shiftTypeUpper === 'HK' ||
            shiftTypeUpper.includes('HOUSEKEEPING') ||
            shiftTypeCompact.includes('HOUSEKEEPING');
          if (isHK) return true;
        }
        // Jan 3 2026 only: use only NewShiftMap for LOH; do not fallback to Shiftmap
        if (normalizedDate === normalizeDateForCompare('2026-01-03')) return false;

        // Fallback to Shiftmap if not found in NewShiftMap
        if (!shiftMap[empId] || shiftMap[empId].length === 0) return false;

        for (const shift of shiftMap[empId]) {
          const shiftName = String(shift.assignedShift || '').trim().toUpperCase();
          const shiftNameCompact = shiftName.replace(/\s+/g, '');
          const isHK =
            shiftName === 'HOUSEKEEPING' ||
            shiftName === 'HOUSEKEEPING SHIFT' ||
            shiftName === 'HOUSE KEEPING' ||
            shiftName === 'HK' ||
            shiftName.includes('HOUSEKEEPING') ||
            shiftNameCompact.includes('HOUSEKEEPING');
          if (!isHK) continue;

          // Priority 1: Check DateWise for exact date match (preferred method)
          let dateMatches = false;
          if (shift.dateWise) {
            const normalizedDateWise = normalizeDateForCompare(shift.dateWise);
            const normalizedEventDate = normalizeDateForCompare(dateStr);
            dateMatches = normalizedDateWise === normalizedEventDate;
          } else {
            // Fallback: Check if date is within the shift date range
            if (shift.fromdate && shift.todate) {
              dateMatches = dateStr >= shift.fromdate && dateStr <= shift.todate;
            } else if (shift.fromdate) {
              dateMatches = dateStr >= shift.fromdate;
            } else if (shift.todate) {
              dateMatches = dateStr <= shift.todate;
            }
          }

          if (dateMatches) return true;
        }
        return false;
      }
     
      // Helper function to parse time string to minutes
      const parseTime = (timeStr) => {
        if (!timeStr) return null;
        // Extract time part if it's a datetime string
        let timePart = timeStr;
        if (timeStr.includes(' ')) {
          timePart = timeStr.split(' ')[1];
        }
        const parts = timePart.split(':');
        if (parts.length < 2) return null;
        const hours = parseInt(parts[0], 10);
        const minutes = parseInt(parts[1], 10);
        if (isNaN(hours) || isNaN(minutes)) return null;
        return hours * 60 + minutes; // Return total minutes
      };

      // Helper function to calculate LOH for any shift with grace period
      // Uses shift start + grace (e.g. 5 min). Check-in is bucketed: e.g. 08:36–09:00 → 09:00, 09:01–09:30 → 09:30, after that use actual.
      // LOH = effective check-in - shift start. Optional: if employee works 8 hours from effective check-in, no LOH (used for Late In report only; LOH report always keeps late-arrival LOH).
      const calculateLOHForShift = (firstInTime, lastOutTime, shiftStart, shiftEnd, gracePeriodEnd, applyEightHourWorkedWaiver) => {
        const firstInMinutes = parseTime(firstInTime);
        if (firstInMinutes === null) {
          return null;
        }

        // If check-in before shift start → no LOH (came early)
        if (firstInMinutes < shiftStart) {
          return { shouldCalculate: false, lohHours: 0 };
        }
        // If check-in within grace (shiftStart to shiftStart+graceMinutes) → no LOH
        if (firstInMinutes <= gracePeriodEnd) {
          return { shouldCalculate: false, lohHours: 0 };
        }
        // Bucket check-in: 1st bucket (after grace) → next :00 or :30; 2nd bucket → +30 min; after that use actual
        // e.g. grace ends 8:35 → 8:36–9:00 → 9:00; 9:01–9:30 → 9:30; after 9:30 use actual check-in
        const bucket1End = Math.ceil(gracePeriodEnd / 30) * 30;
        const bucket2End = bucket1End + 30;
        let adjustedFirstInMinutes = firstInMinutes;
        if (firstInMinutes <= bucket1End) {
          adjustedFirstInMinutes = bucket1End;
        } else if (firstInMinutes <= bucket2End) {
          adjustedFirstInMinutes = bucket2End;
        }
        const lastOutMinutes = parseTime(lastOutTime);
        if (
          applyEightHourWorkedWaiver &&
          lastOutMinutes !== null &&
          lastOutMinutes >= adjustedFirstInMinutes + 8 * 60
        ) {
          return { shouldCalculate: false, lohHours: 0 };
        }
        const lossOfMinutes = adjustedFirstInMinutes - shiftStart;
        const lohHours = lossOfMinutes / 60;
        return { shouldCalculate: true, lohHours: lohHours };
      };

      // Helper function to calculate LOH for OnDuty half-day cases
      // For OD half-day, use NewShiftMap shift time instead of actual shift, ignore last checkout
      const calculateLOHForOnDutyHalfDay = (firstInTime, empId, dateStr) => {
        // Get shift type from NewShiftMap
        const normalizedEmpId = String(empId).trim();
        const normalizedDate = normalizeDateForCompare(dateStr);
        const newShiftKey = `${normalizedEmpId}_${normalizedDate}`;
        const newShiftType = newShiftMap[newShiftKey];
       
        // Determine shift start time and grace period based on shift type
        let shiftStart, gracePeriodEnd;
       
        if (newShiftType) {
          const shiftTypeLower = newShiftType.toLowerCase().trim();
         
          // Check for 1st shift
          if (shiftTypeLower.includes('1st') || shiftTypeLower === '1') {
            shiftStart = 6 * 60 + 0; // 06:00 = 360 minutes
            gracePeriodEnd = shiftStart + graceMinutes;
          }
          // Check for 2nd shift
          else if (shiftTypeLower.includes('2nd') || shiftTypeLower === '2') {
            shiftStart = 14 * 60 + 0; // 14:00 = 840 minutes
            gracePeriodEnd = shiftStart + graceMinutes;
          }
          // Check for General II shift
          else if (shiftTypeLower.includes('general') && shiftTypeLower.includes('ii')) {
            shiftStart = 12 * 60 + 0; // 12:00 = 720 minutes
            gracePeriodEnd = shiftStart + graceMinutes;
          }
          // Default to General shift (most common for OD half-day)
          else {
            shiftStart = 8 * 60 + 25; // 08:25 = 505 minutes
            gracePeriodEnd = shiftStart + graceMinutes;
          }
        } else {
          // No NewShiftMap entry, default to General shift
          shiftStart = 8 * 60 + 25; // 08:25 = 505 minutes
          gracePeriodEnd = shiftStart + graceMinutes;
        }
       
        const firstInMinutes = parseTime(firstInTime);
       
        if (firstInMinutes === null) {
          return null;
        }
       
        // For OD half-day, only calculate LOH based on late arrival (ignore checkout)
        // If check-in is within grace period, no LOH
        if (firstInMinutes >= shiftStart && firstInMinutes <= gracePeriodEnd) {
          return { shouldCalculate: false, lohHours: 0 };
        }
       
        // If check-in is before shift start, no LOH (came early)
        if (firstInMinutes < shiftStart) {
          return { shouldCalculate: false, lohHours: 0 };
        }
       
        // Round to next 30-min clock boundaries (:00 or :30), same as main LOH
        const bucket1End = Math.ceil(gracePeriodEnd / 30) * 30;
        const bucket2End = bucket1End + 30;
        let adjustedFirstInMinutes = firstInMinutes;
        if (firstInMinutes <= bucket1End) {
          adjustedFirstInMinutes = bucket1End;
        } else if (firstInMinutes <= bucket2End) {
          adjustedFirstInMinutes = bucket2End;
        }
        const lateMinutes = adjustedFirstInMinutes - shiftStart;
        const lohHours = lateMinutes > 0 ? lateMinutes / 60 : 0;
       
        return { shouldCalculate: lohHours > 0, lohHours: lohHours };
      };
     
      // Helper function to check if a date is Sunday
      const isSunday = (dateStr) => {
        const date = new Date(dateStr);
        const dayOfWeek = date.getDay(); // 0 = Sunday, 6 = Saturday
        return dayOfWeek === 0;
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

      // Fetch declared holidays for LOH (H present = do not calculate LOH)
      const holidaySetForLOH = new Set();
      try {
        const holidayQuery = `SELECT CalendarDate FROM Calendar WHERE CalendarDate >= '${startDateOnly}' AND CalendarDate <= '${endDateOnly}'`;
        const holidays = await zcql.executeZCQLQuery(holidayQuery);
        if (holidays && holidays.length > 0) {
          holidays.forEach(row => {
            let holidayDate = row.Calendar?.CalendarDate || row.CalendarDate;
            if (holidayDate) {
              if (holidayDate.includes('T')) holidayDate = holidayDate.split('T')[0];
              else if (holidayDate.length > 10) holidayDate = holidayDate.substring(0, 10);
              holidaySetForLOH.add(holidayDate);
            }
          });
          console.log(`LOH: Loaded ${holidaySetForLOH.size} declared holidays from Calendar`);
        }
      } catch (err) {
        console.log('LOH: Calendar holidays (optional):', err.message);
      }
      const isDeclaredHolidayForLOH = (dateStr) => {
        if (!dateStr) return false;
        const norm = typeof dateStr === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? dateStr : new Date(dateStr).toISOString().slice(0, 10);
        if (holidaySetForLOH.has(norm)) return true;
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return false;
        const month = d.getMonth(), day = d.getDate();
        if (month === 0 && day === 1) return true;   // Jan 1
        if (month === 0 && day === 15) return true;  // Pongal
        if (month === 0 && day === 16) return true;  // Thiruvallur
        if (month === 0 && day === 17) return true;  // Uzhavar Thirunal
        if (month === 0 && day === 26) return true;  // Republic Day
        if (month === 3 && day === 14) return true;  // Tamil New Year
        if (month === 4 && day === 1) return true;   // May Day
        if (month === 7 && day === 15) return true;  // Independence Day
        if (month === 8 && day === 14) return true;  // Vinayakar Chaturthi
        if (month === 9 && day === 2) return true;   // Gandhi Jayanthi
        if (month === 9 && day === 19) return true;  // Ayudha Pooja
        if (month === 11 && day === 25) return true; // Christmas
        return false;
      };

      // Helper function to check if attendance muster marks this date as H or WO
      // If H present (Present on Holiday), do not calculate LOH
      const isMarkedAsHolidayOrWeekOff = (empId, dateStr, rec) => {
        // H present: record has Status H (present on holiday from Excel/Attendance) - do not calculate LOH
        if (rec && (String(rec.Status || '').trim().toUpperCase() === 'H')) {
          return true; // Skip LOH for H present
        }

        const normalizedEmpId = String(empId).trim();
        const empDetails = empDetailsMap[normalizedEmpId];
       
        // Get employee's date of joining and date of exit
        const dateOfJoining = empDetails?.dateOfJoining || '';
        const dateOfExit = empDetails?.dateOfExit || '';
       
        // Helper function to normalize dates to YYYY-MM-DD format for comparison
        const normalizeDate = (d) => {
          if (!d) return '';
          if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
          const parsed = new Date(d);
          if (!isNaN(parsed.getTime())) {
            return parsed.toISOString().slice(0, 10);
          }
          return '';
        };
       
        // Helper function to compare dates (returns true if date1 < date2)
        const isDateBefore = (date1, date2) => {
          if (!date1 || !date2) return false;
          const normDate1 = normalizeDate(date1);
          const normDate2 = normalizeDate(date2);
          return normDate1 && normDate2 && normDate1 < normDate2;
        };
       
        // Helper function to compare dates (returns true if date1 > date2)
        const isDateAfter = (date1, date2) => {
          if (!date1 || !date2) return false;
          const normDate1 = normalizeDate(date1);
          const normDate2 = normalizeDate(date2);
          return normDate1 && normDate2 && normDate1 > normDate2;
        };

        // Check if this date is a declared holiday (Calendar + hardcoded) - H present, do not calculate LOH
        if (isDeclaredHolidayForLOH(dateStr)) {
          if (rec && (rec.Source === 'CompOffWorkedOn' || rec.Source?.includes('CompOffWorkedOn'))) return false;
          if (dateOfJoining && isDateBefore(dateStr, dateOfJoining)) return false;
          if (dateOfExit && isDateAfter(dateStr, dateOfExit)) return false;
          return true; // Marked as H (declared holiday)
        }
       
        // Check if this date is Sunday (Holiday)
        if (isSunday(dateStr)) {
          // If there's a CompOffWorkedOn record for this date, it's Present, not H
          if (rec && (rec.Source === 'CompOffWorkedOn' || rec.Source?.includes('CompOffWorkedOn'))) {
            return false; // Not H/WO, it's Present
          }
          // If date is before date of joining, don't count as Holiday
          if (dateOfJoining && isDateBefore(dateStr, dateOfJoining)) {
            return false; // Before date of joining, not counted as H
          }
          // If date is after date of exit, don't count as Holiday
          if (dateOfExit && isDateAfter(dateStr, dateOfExit)) {
            return false; // After date of exit, not counted as H
          }
          return true; // Marked as H (Holiday)
        }
       
        return false; // Not marked as H or WO
      };
     
      // 4. Calculate loss of hours using attendance muster FirstIN and LastOUT (merged byKey: BHR, Attendance, BioMax, OnDuty, Regularization, CompOff)
      const result = [];
      for (const key in byKey) {
        const rec = byKey[key];
        const empId = rec.EmployeeID;
        const eventDate = rec.Date;
       
        // Get employee details
        const empDetails = empDetailsMap[empId];
        if (!empDetails) continue;
       
        // If contractor filter is set, skip employees that don't match (using flexible matching)
        if (contractor && contractor !== 'All') {
          const empContractor = String(empDetails.contractorName || '').replace(/\s+/g, ' ').trim().toLowerCase();
          const normalizedContractor = String(contractor || '').replace(/\s+/g, ' ').trim().toLowerCase();
          const contractorWords = normalizedContractor.split(' ').filter(w => w.length > 2);
         
          let matches = false;
          if (empContractor === normalizedContractor) matches = true;
          else if (empContractor.includes(normalizedContractor) || normalizedContractor.includes(empContractor)) matches = true;
          else if (contractorWords.length > 0) {
            const allKeyWordsMatch = contractorWords.every(word => empContractor.includes(word));
            if (allKeyWordsMatch) {
              const firstWord = contractorWords[0];
              const empFirstWord = empContractor.split(' ')[0];
              if (empFirstWord && (empFirstWord.startsWith(firstWord) || firstWord.startsWith(empFirstWord))) {
                matches = true;
              }
            }
          }
          if (!matches) continue; // Skip this employee if contractor doesn't match
        } else if (!contractor || contractor === 'All') {
          // When contractor is "All", only show active employees (those without DateofExit)
          const dateOfExit = empDetails.dateOfExit || '';
          if (dateOfExit && dateOfExit.trim() !== '') {
            // Employee has a date of exit (inactive), skip them
            continue; // Skip inactive employees
          }
          // If no dateOfExit, employee is active, include them
        }
       
        // Skip if no FirstIN or LastOUT
        if (!rec.FirstIN || !rec.LastOUT) continue;
       
        // Skip excluded dates from LOH calculation
        if (isDateExcludedFromLOH(eventDate)) {
          continue; // Skip this date for LOH calculation
        }
       
        // Skip if attendance muster marks this date as H (Holiday) or WO (Week Off)
        if (isMarkedAsHolidayOrWeekOff(empId, eventDate, rec)) {
          continue; // Skip LOH calculation for H/WO dates
        }
       
        // Use muster's merged FirstIN/LastOUT for LOH (all sources: BHR, Attendance, BioMax, OnDuty, CompOff, etc.)
       
        // Calculate total working time and expected working time
        let totalWorkingMinutes = 0;
        let expectedWorkingMinutes = 8 * 60; // 8 hours in minutes
       
        // Parse FirstIN and LastOUT from merged data
        const firstIn = new Date(rec.FirstIN.replace(' ', 'T'));
        const lastOut = new Date(rec.LastOUT.replace(' ', 'T'));
       
        if (!isNaN(firstIn) && !isNaN(lastOut)) {
          const diffMs = lastOut - firstIn;
          if (diffMs > 0) {
            totalWorkingMinutes = Math.floor(diffMs / (1000 * 60));
          }
        }
       
        // Extract FirstIn and LastOut time strings (format: HH:MM)
        let firstInTime = '';
        let lastOutTime = '';
        if (rec.FirstIN) {
          const firstInParts = rec.FirstIN.split(' ');
          firstInTime = firstInParts.length > 1 ? firstInParts[1].substring(0, 5) : '';
        }
        if (rec.LastOUT) {
          const lastOutParts = rec.LastOUT.split(' ');
          lastOutTime = lastOutParts.length > 1 ? lastOutParts[1].substring(0, 5) : '';
        }
       
        // Check shift in order: 1st shift -> 2nd shift -> else (general shift)
        // Normalize employee ID for lookup (handle string/number mismatches)
        const normalizedEmpId = String(empId).trim();
        const isFirst = isFirstShift(normalizedEmpId, eventDate);
        const isSecond = isSecondShift(normalizedEmpId, eventDate);
        const isGeneralII = isGeneralIIShift(normalizedEmpId, eventDate);
        const isHousekeeping = isHousekeepingShift(normalizedEmpId, eventDate);
        // Do not calculate LOH for Housekeeping shift
        if (isHousekeeping) continue;
       
        // Debug logging for shift detection (for employee 35021)
        if (normalizedEmpId === '35021') {
          console.log(`LOH Debug - Employee ${normalizedEmpId} on ${eventDate}: isFirst=${isFirst}, isSecond=${isSecond}, shiftMap exists=${!!shiftMap[normalizedEmpId]}, shiftMap data=${JSON.stringify(shiftMap[normalizedEmpId] || [])}`);
          console.log(`LOH Debug - FirstIN=${rec.FirstIN}, LastOUT=${rec.LastOUT}, firstInTime=${firstInTime}, lastOutTime=${lastOutTime}`);
        }
       
        // Apply shift-specific rules
        let shouldCalculateLOH = false;
        let lohCalculatedByFunction = false;
        let calculatedLOHHours = null;
       
        // Check if this is an OnDuty half-day record
        const isOnDutyHalfDay = rec.IsOnDutyHalfDay === true;
       
        if (isOnDutyHalfDay) {
          // Special handling for OnDuty half-day: use NewShiftMap-based calculation, ignore last checkout
          const lohResult = calculateLOHForOnDutyHalfDay(firstInTime, normalizedEmpId, eventDate);
         
          if (normalizedEmpId === '35021' || normalizedEmpId === '36050') {
            console.log(`LOH Debug - OnDuty Half-Day calculation: Employee ${normalizedEmpId} on ${eventDate}, firstInTime=${firstInTime}, lohResult=${JSON.stringify(lohResult)}`);
          }
         
          if (lohResult === null) {
            // Could not parse time, no LOH
            shouldCalculateLOH = false;
            calculatedLOHHours = 0;
            lohCalculatedByFunction = true;
          } else if (lohResult.shouldCalculate) {
            shouldCalculateLOH = true;
            calculatedLOHHours = lohResult.lohHours && lohResult.lohHours > 0 ? parseFloat(lohResult.lohHours.toFixed(2)) : 0;
            lohCalculatedByFunction = true;
          } else {
            // No LOH (within grace period or came early)
            shouldCalculateLOH = false;
            calculatedLOHHours = 0;
            lohCalculatedByFunction = true;
          }
          if (isLateInReport && isOnDutyHalfDay && lohResult && lohResult.shouldCalculate) {
            const details = empDetailsMap[empId] || {};
            const lateByMin = Math.round((lohResult.lohHours || 0) * 60);
            result.push({
              employeeId: empId,
              employeeName: details.employeeName || '',
              department: details.department || '',
              date: eventDate,
              firstIn: firstInTime,
              expectedIn: '-',
              lateByMinutes: lateByMin
            });
            continue;
          }
        } else {
          // Prefer Shift table + NewShiftMap: use mapped shift start time and report grace (minutes)
          const shiftDef = getShiftDefinitionForEmployeeDateLOH(normalizedEmpId, eventDate);
          if (shiftDef) {
            const defKey = normalizeShiftNameKeyLOH(shiftDef.shiftName);
            const isShiftHK = /HOUSEKEEPING|^HK$/i.test(defKey);
            if (!isShiftHK) {
              const shiftStartMin = parseTime(shiftDef.fromTime);
              if (shiftStartMin !== null) {
                const gracePeriodEnd = shiftStartMin + graceMinutes;
                const lohResult = calculateLOHForShift(
                  firstInTime,
                  lastOutTime,
                  shiftStartMin,
                  0,
                  gracePeriodEnd,
                  isLateInReport
                );
                if (lohResult === null) {
                  if (totalWorkingMinutes > 0 && totalWorkingMinutes < expectedWorkingMinutes) {
                    const lossOfMinutes = expectedWorkingMinutes - totalWorkingMinutes;
                    if (lossOfMinutes > 0 && lossOfMinutes < 480) {
                      shouldCalculateLOH = true;
                      calculatedLOHHours = lossOfMinutes / 60;
                      lohCalculatedByFunction = true;
                    }
                  }
                } else if (lohResult.shouldCalculate) {
                  shouldCalculateLOH = true;
                  calculatedLOHHours = lohResult.lohHours && lohResult.lohHours > 0 ? parseFloat(lohResult.lohHours.toFixed(2)) : 0;
                  lohCalculatedByFunction = true;
                } else {
                  shouldCalculateLOH = false;
                  calculatedLOHHours = 0;
                  lohCalculatedByFunction = true;
                }
                if (isLateInReport) {
                  const firstInMinutes = parseTime(firstInTime);
                  // Only include if person came after grace period (shift start + grace)
                  if (firstInMinutes !== null && firstInMinutes > gracePeriodEnd) {
                    const details = empDetailsMap[empId] || {};
                    const expectedIn = String(Math.floor(shiftStartMin / 60)).padStart(2, '0') + ':' + String(shiftStartMin % 60).padStart(2, '0');
                    // Late by = (person come time) - (shift start time), so grace is part of allowed window but reported minutes are from shift start (e.g. come 09:33, shift 09:00 → late by 33 min)
                    const lateByMinutes = firstInMinutes - shiftStartMin;
                    result.push({
                      employeeId: empId,
                      employeeName: details.employeeName || '',
                      department: details.department || '',
                      date: eventDate,
                      firstIn: firstInTime,
                      expectedIn: expectedIn,
                      lateByMinutes
                    });
                  }
                  continue;
                }
              }
            }
          }
        }
        // LOH is calculated only from Shift table + report grace (no fixed 1st/2nd/General/General II timings)
        // If no shift definition for this employee/date, lohCalculatedByFunction stays false and record is not included
       
        // Use calculated LOH hours if available
        let finalLossOfMinutes = 0;
        if (lohCalculatedByFunction && calculatedLOHHours !== null) {
          finalLossOfMinutes = calculatedLOHHours * 60;
        } else if (shouldCalculateLOH && calculatedLOHHours !== null) {
          finalLossOfMinutes = calculatedLOHHours * 60;
        }
       
        // Only include records where LOH was actually calculated (even if 0.00 for grace period)
        // Don't include employees who worked 8+ hours with no LOH - they will show as dash
        // This ensures:
        // - If LOH is calculated as 0.00 (grace period) → show 0.00
        // - If LOH > 0 → show the calculated value
        // - If no LOH calculated (worked 8+ hours or not present) → show dash (don't include in results)
        const shouldIncludeRecord = lohCalculatedByFunction && totalWorkingMinutes > 0;
         
        if (isLateInReport) continue;
        if (shouldIncludeRecord && finalLossOfMinutes < 480) {
          // Use Employee table data if available
          const details = empDetailsMap[empId] || {};
          result.push({
            employeeId: empId,
            employeeName: details.employeeName || '',
            department: details.department || '',
            category: details.category || '',
            designation: details.designation || '',
            contractorName: details.contractorName || '',
            lossOfMinutes: Math.round(finalLossOfMinutes),
            lossOfHours: finalLossOfMinutes > 0 ? (finalLossOfMinutes / 60).toFixed(2) : '0.00',
            date: eventDate,
            firstIn: firstInTime,
            lastOut: lastOutTime
          });
        }
      }
     
      const finalResult = designationFilterEnabled
        ? result.filter((row) => isCategoryApplicable(row.category) || isCategoryApplicable(row.designation))
        : result;

      // Sort result by date, then by employee name
      finalResult.sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        return a.employeeName.localeCompare(b.employeeName);
      });
     
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: finalResult }));
    } catch (err) {
      console.log('LOH endpoint error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Debug endpoint to check attendance data
  if (pathname === '/debug-attendance') {
    try {
      const catalystApp = catalyst.initialize(req);
      const zcql = catalystApp.zcql();
     
      // Get sample attendance records
      const debugQuery = `SELECT EmployeeId, AttendanceDate, FirstIn, LastOut, Status FROM Attendance ORDER BY ROWID DESC LIMIT 10`;
      const debugResults = await zcql.executeZCQLQuery(debugQuery);
      const debugRows = debugResults.map(r => r.Attendance);
     
      // Get total count
      const countQuery = `SELECT COUNT(ROWID) as count FROM Attendance`;
      const countResults = await zcql.executeZCQLQuery(countQuery);
      const totalCount = countResults[0].Attendance.count;
     
      // Test overtime calculation on sample data
      const overtimeTests = debugRows.map(row => {
        const totalHours = calculateHoursFromTimestamps(row.FirstIn, row.LastOut);
        const hasOvertime = totalHours > 8.5;
        const overtimeHours = hasOvertime ? totalHours - 8.5 : 0;
       
        return {
          employeeId: row.EmployeeId,
          date: row.AttendanceDate,
          firstIn: row.FirstIn,
          lastOut: row.LastOut,
          totalHours: totalHours,
          hasOvertime: hasOvertime,
          overtimeHours: overtimeHours
        };
      });
     
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        totalRecords: totalCount,
        sampleRecords: debugRows,
        overtimeTests: overtimeTests,
        message: 'Debug data retrieved successfully'
      }));
    } catch (err) {
      console.log('Debug endpoint error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Default route
  res.writeHead(404);
  res.write('You might find the page you are looking for at "/" path');
  res.end();
};
