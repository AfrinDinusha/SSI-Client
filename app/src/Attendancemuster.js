import React, { useState, useEffect, useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import './Attendancemuster.css';
import './employeeManagement.css';
import './Candidateform.css';
import HeaderBranding from './HeaderBranding';
import { getSidebarModulesForUser, resolveSidebarUserEmail } from './modulesConfig';
import * as XLSX from 'xlsx-js-style';
import { 
  Calendar, Users, FileText, AlertTriangle, FolderOpen, 
  ClipboardList, Building, Handshake, Landmark, Clock, 
  Map, BarChart3, User, TrendingUp, TrendingDown,
  Activity, Plus, CheckCircle, Bell, Settings, LayoutDashboard, Home as HomeIcon, AlertOctagon, CreditCard, Shield, Download, FileSignature, Search, Clock3, CalendarDays, Database
} from 'lucide-react';
import DateInputDdMm from './DateInputDdMm';
import {
  applyReportsLohToMusterData,
  fetchLohRowsForMusterOverlay,
  formatMusterLohTotal,
} from './musterLohReportsMerge';

function parseOtHours(val) {
  const n = parseFloat(String(val ?? '').replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : 0;
}

/** Payroll OT hours by employee code (string keys + numeric alias for leading-zero codes). */
function buildPayrollOtLookup(payrollRows) {
  const map = {};
  if (!Array.isArray(payrollRows)) return map;
  for (const r of payrollRows) {
    const code = String(r.employeeCode ?? r.EmployeeCode ?? '').trim();
    if (!code) continue;
    const ot = parseOtHours(r.otHours ?? r.OTHours);
    map[code] = ot;
    if (/^\d+$/.test(code)) {
      map[String(parseInt(code, 10))] = ot;
    }
  }
  return map;
}

function lookupPayrollOt(map, employeeId) {
  const s = String(employeeId ?? '').trim();
  if (!s) return undefined;
  if (map[s] !== undefined) return map[s];
  if (/^\d+$/.test(s) && map[String(parseInt(s, 10))] !== undefined) {
    return map[String(parseInt(s, 10))];
  }
  return undefined;
}

function formatPayrollOtAdjustDelta(payrollOt, reportTotal) {
  const delta = payrollOt - reportTotal;
  const rounded = Math.round(delta * 100) / 100;
  if (!Number.isFinite(rounded)) return '0';
  if (Object.is(rounded, -0)) return '0';
  if (Number.isInteger(rounded)) return String(rounded);
  return String(rounded);
}

/** Adjust = payroll OT − report total so Final OT matches payroll (same as Monthly OT report). */
function adjustValueFromPayrollSync(payrollOt, reportTotal) {
  if (!Number.isFinite(payrollOt)) return '0';
  const rt = Number.isFinite(reportTotal) ? reportTotal : 0;
  const delta = payrollOt - rt;
  if (Math.abs(delta) < 0.005) return '0';
  return formatPayrollOtAdjustDelta(payrollOt, rt);
}

/** Shift CSS class from NewShiftMap value (matches Attendancemuster.css). */
function getShiftClassName(shiftTypeValue) {
  const shiftRaw = String(shiftTypeValue || '').trim().toUpperCase();
  const shiftCompact = shiftRaw.replace(/[\s_-]+/g, '');

  if (
    shiftRaw === 'FIRST' ||
    shiftRaw === '1ST' ||
    shiftRaw === '1ST SHIFT' ||
    shiftRaw === 'FIRST SHIFT' ||
    shiftCompact === '1STSHIFT' ||
    shiftCompact === 'FIRSTSHIFT'
  ) {
    return 'shift-first';
  }
  if (
    shiftRaw === 'SECOND' ||
    shiftRaw === '2ND' ||
    shiftRaw === '2ND SHIFT' ||
    shiftRaw === 'SECOND SHIFT' ||
    shiftCompact === '2NDSHIFT' ||
    shiftCompact === 'SECONDSHIFT'
  ) {
    return 'shift-second';
  }
  if (
    shiftRaw === 'THIRD' ||
    shiftRaw === '3RD' ||
    shiftRaw === '3RD SHIFT' ||
    shiftRaw === 'THIRD SHIFT' ||
    shiftRaw === '3' ||
    shiftRaw === 'SHIFT 3' ||
    shiftCompact.includes('3RD') ||
    shiftCompact.includes('THIRD')
  ) {
    return 'shift-third';
  }
  if (
    shiftRaw === 'FOURTH' ||
    shiftRaw === '4TH' ||
    shiftRaw === '4TH SHIFT' ||
    shiftRaw === 'FOURTH SHIFT' ||
    shiftRaw === '4' ||
    shiftRaw === 'SHIFT 4' ||
    shiftCompact.includes('4TH') ||
    shiftCompact.includes('FOURTH')
  ) {
    return 'shift-fourth';
  }
  if (shiftRaw === 'HOUSEKEEPING' || shiftRaw === 'HK' || shiftCompact === 'HOUSEKEEPING') {
    return 'shift-housekeeping';
  }
  if (
    shiftRaw === 'GENERAL II' ||
    shiftRaw === 'GENERALII' ||
    shiftRaw === 'GENERAL_II' ||
    shiftCompact === 'GENERALII'
  ) {
    return 'shift-general-ii';
  }
  return 'shift-general';
}

/** Same 3rd-shift night inference as the on-screen muster table. */
function resolveMusterShiftClassForCell(shiftTypeValue, status, firstIn) {
  let shiftClass = getShiftClassName(shiftTypeValue);
  const s = String(status || '').trim();
  const firstInRaw = String(firstIn || '').trim();
  if (shiftClass === 'shift-general' && (s === 'Present' || s === 'Half Day Present') && firstInRaw) {
    const timeMatch = firstInRaw.match(/(?:^|\s|T)(\d{1,2}):(\d{2})/);
    if (timeMatch) {
      const h = parseInt(timeMatch[1], 10);
      if (!Number.isNaN(h) && h >= 19 && h <= 23) {
        return 'shift-third';
      }
    }
  }
  return shiftClass;
}

/** Background/text hex for a muster date cell — mirrors Attendancemuster.css + inline WO/H styles. */
function getMusterDateCellColors(status, shiftType, firstIn, lastOut) {
  const s = String(status || '').trim();
  const firstInStr = String(firstIn || '').trim();
  const lastOutStr = String(lastOut || '').trim();

  if (s === 'WO' && firstInStr && lastOutStr) {
    return { fgHex: 'FFB3DE', fontHex: '000000' };
  }
  if (s === 'H' && firstInStr && lastOutStr) {
    return { fgHex: 'FF1493', fontHex: 'FFFFFF' };
  }

  const shiftClass = resolveMusterShiftClassForCell(shiftType, status, firstIn);

  if (s === 'Present' || s === 'Half Day Present') {
    if (shiftClass === 'shift-first') return { fgHex: '765341', fontHex: 'FFFFFF' };
    if (shiftClass === 'shift-second') return { fgHex: '06B1CF', fontHex: 'FFFFFF' };
    if (shiftClass === 'shift-third') return { fgHex: 'B80F0A', fontHex: 'FFFFFF' };
    if (shiftClass === 'shift-fourth') return { fgHex: 'F70ADF', fontHex: 'FFFFFF' };
    if (shiftClass === 'shift-housekeeping') return { fgHex: 'FF7F7F', fontHex: '000000' };
    if (shiftClass === 'shift-general-ii') return { fgHex: 'B8B8B8', fontHex: '333333' };
    return {
      fgHex: s === 'Half Day Present' ? '1976D2' : '4CAF50',
      fontHex: 'FFFFFF',
    };
  }

  if (s === 'Absent' || s === 'A') return { fgHex: 'FFFFFF', fontHex: '222222' };
  if (s === 'WO') return { fgHex: 'FEF250', fontHex: '000000' };
  if (s === 'H') return { fgHex: 'FF9800', fontHex: 'FFFFFF' };
  if (s === 'CO') return { fgHex: '9C27B0', fontHex: 'FFFFFF' };
  if (s === 'OD') return { fgHex: '00BCD4', fontHex: 'FFFFFF' };
  if (s === 'OD-0.5') return { fgHex: '00ACC1', fontHex: 'FFFFFF' };
  return { fgHex: 'FFFFFF', fontHex: '222222' };
}

function musterDateCellExcelStyle(status, shiftType, firstIn, lastOut) {
  const { fgHex, fontHex } = getMusterDateCellColors(status, shiftType, firstIn, lastOut);
  const rgb = (hex) => ({ rgb: hex.length === 6 ? 'FF' + hex : hex });
  return {
    fill: { patternType: 'solid', fgColor: rgb(fgHex) },
    font: { color: rgb(fontHex), bold: true },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
  };
}

function Attendancemuster({ userRole = 'App Administrator', userEmail = null }) {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  
  // Email to contractor mapping - defined before use
  const emailContractorMap = {
    'afrindinusha@gmail.com': 'R.P.D Facility Management Services',
    'rpdmanpowerservice@gmail.com': 'R.P.D Facility Management Services',
    'ramachandran23488@gmail.com': 'R.P.D Facility Management Services',
    'afrindinusha29@gmail.com': 'Sriram Enterprises',
    'sriramenterprises50@yahoo.com': 'Sriram Enterprises',
    'afrinatlin@gmail.com': 'Samuel Enterprise',
    'samuelenterprisesms@gmail.com': 'Samuel Enterprise',
    'dinushaafrin@gmail.com': 'Sri Balaji Enterprises',
    'vijaybalaji701@gmail.com': 'Sri Balaji Enterprises',
    'afrindinu14@gmail.com': 'Yashaswi Academy for Skills',
    'vaishnavi.a@buildhr.co.in': 'Yashaswi Academy for Skills',
  };
  
  // Initialize contractor based on user restrictions
  const getInitialContractor = () => {
    if (userRole === 'App Administrator') return 'All';
    if (userEmail) {
      return emailContractorMap[userEmail] || 'All';
    }
    return 'All';
  };
  const [contractor, setContractor] = useState(getInitialContractor);
  const [department, setDepartment] = useState('All');
  const [category, setCategory] = useState('All');
  const [status, setStatus] = useState('Active');
  const [contractors, setContractors] = useState(['All']);
  const [departments, setDepartments] = useState(['All']);
  const [categories, setCategories] = useState(['All']);
  const [shiftMasterNames, setShiftMasterNames] = useState([]);
  const [data, setData] = useState(null);
  /** Per-employee OT adjustment (hours); added to OT Hours for Final OT Value (Monthly OT parity). */
  const [otAdjustments, setOtAdjustments] = useState({});
  const [error, setError] = useState('');
  const [expandedMenus, setExpandedMenus] = useState({});
  const [showNotifications, setShowNotifications] = useState(false);
  const [showSidebarMenu, setShowSidebarMenu] = useState(false);
  const location = useLocation();

  // Attendance helpers (includes sandwich rule for WO/H)
  const normalizeStatus = (s) => String(s ?? '').trim();
  const isAbsentStatus = (s) => {
    const v = normalizeStatus(s);
    return v === 'Absent' || v === 'A';
  };
  const isWoOrHStatus = (s) => {
    const v = normalizeStatus(s);
    return v === 'WO' || v === 'H' || v === 'Week Off' || v === 'Holiday';
  };
  const isSundayDate = (dateValue) => {
    if (!dateValue) return false;
    const d = new Date(dateValue);
    if (Number.isNaN(d.getTime())) return false;
    return d.getDay() === 0;
  };
  const calculateTotalAbsentExcludingSundays = (statuses, dates) => {
    if (!Array.isArray(statuses)) return 0;
    return statuses.reduce((count, statusValue, idx) => {
      if (isSundayDate(Array.isArray(dates) ? dates[idx] : null)) return count;
      const normalized = normalizeStatus(statusValue);
      if (normalized === 'Absent' || normalized === 'A') return count + 1;
      return count;
    }, 0);
  };
  const normalizeShiftDisplayName = (shiftTypeValue) => {
    const shiftRaw = String(shiftTypeValue || '').trim();
    if (!shiftRaw) return 'General';
    const shiftUpper = shiftRaw.toUpperCase();
    const shiftCompact = shiftUpper.replace(/[\s_-]+/g, '');

    if (
      shiftUpper === 'FIRST' ||
      shiftUpper === '1ST' ||
      shiftUpper === '1ST SHIFT' ||
      shiftUpper === 'FIRST SHIFT' ||
      shiftCompact === '1STSHIFT' ||
      shiftCompact === 'FIRSTSHIFT'
    ) {
      return '1st Shift';
    }
    if (
      shiftUpper === 'SECOND' ||
      shiftUpper === '2ND' ||
      shiftUpper === '2ND SHIFT' ||
      shiftUpper === 'SECOND SHIFT' ||
      shiftCompact === '2NDSHIFT' ||
      shiftCompact === 'SECONDSHIFT'
    ) {
      return '2nd Shift';
    }
    if (
      shiftUpper === 'THIRD' ||
      shiftUpper === '3RD' ||
      shiftUpper === '3RD SHIFT' ||
      shiftUpper === 'THIRD SHIFT' ||
      shiftUpper === '3' ||
      shiftUpper === 'SHIFT 3' ||
      shiftCompact.includes('3RD') ||
      shiftCompact.includes('THIRD')
    ) {
      return '3rd Shift';
    }
    if (
      shiftUpper === 'FOURTH' ||
      shiftUpper === '4TH' ||
      shiftUpper === '4TH SHIFT' ||
      shiftUpper === 'FOURTH SHIFT' ||
      shiftUpper === '4' ||
      shiftUpper === 'SHIFT 4' ||
      shiftCompact.includes('4TH') ||
      shiftCompact.includes('FOURTH')
    ) {
      return '4th Shift';
    }
    if (shiftUpper === 'HK' || shiftCompact === 'HOUSEKEEPING') {
      return 'Housekeeping';
    }
    if (
      shiftUpper === 'GENERAL II' ||
      shiftUpper === 'GENERALII' ||
      shiftUpper === 'GENERAL_II' ||
      shiftCompact === 'GENERALII'
    ) {
      return 'General II';
    }
    if (shiftUpper === 'GENERAL') return 'General';
    return shiftRaw;
  };
  // Sandwich rule:
  // If WO/H is between absents on both sides (skipping consecutive WO/H), then WO/H shouldn shouldn't be counted as present.
  const isSandwichedWoOrH = (statuses, idx) => {
    if (!Array.isArray(statuses)) return false;
    if (idx <= 0 || idx >= statuses.length - 1) return false;
    if (!isWoOrHStatus(statuses[idx])) return false;

    let left = idx - 1;
    while (left >= 0 && isWoOrHStatus(statuses[left])) left -= 1;
    let right = idx + 1;
    while (right < statuses.length && isWoOrHStatus(statuses[right])) right += 1;

    if (left < 0 || right >= statuses.length) return false;
    return isAbsentStatus(statuses[left]) && isAbsentStatus(statuses[right]);
  };

  /**
   * Total present for muster: do not count Sundays (calendar) or WO / Week Off as present days.
   * halfDayWeight — half days (e.g. under 4h worked) count as 0.5; full Present/CO/H/OD count as 1.
   */
  const countPresentDaysForMusterRow = (rowStatuses, dates, { halfDayWeight = 0.5 } = {}) => {
    if (!Array.isArray(rowStatuses)) return 0;
    return rowStatuses.reduce((sum, s, idx) => {
      if (Array.isArray(dates) && isSundayDate(dates[idx])) return sum;
      const ns = normalizeStatus(s);
      if (ns === 'WO' || ns === 'Week Off') return sum;
      if (s === 'Present' || s === 'P') return sum + 1;
      if (s === 'Half Day Present' || s === '0.5' || s === 0.5) return sum + halfDayWeight;
      if (s === 'CO') return sum + 1;
      if (s === 'H' && isSandwichedWoOrH(rowStatuses, idx)) return sum;
      if (s === 'H') return sum + 1;
      if (s === 'OD' || s === 'OD-0.5') return sum + 1;
      return sum;
    }, 0);
  };

  const modulesToShow = useMemo(
    () => getSidebarModulesForUser(resolveSidebarUserEmail(userEmail), userRole),
    [userEmail, userRole]
  );

  useEffect(() => {
    const reportsMenuIndex = modulesToShow.findIndex((module) => module.label === 'Reports' && module.children);
    if (reportsMenuIndex !== -1) {
      setExpandedMenus((prev) => ({ ...prev, [reportsMenuIndex]: true }));
    }
  }, [location.pathname, modulesToShow]);

  // Filter contractors based on user email - restrict to specific contractor for certain users
  const getFilteredContractors = () => {
    if (userRole === 'App Administrator') return contractors;
    if (!userEmail) return contractors;
    
    // Use the emailContractorMap defined at the top level
    const allowedContractor = emailContractorMap[userEmail];
    if (allowedContractor) {
      // Always include the allowed contractor, even if it's not in the contractors list
      // This handles cases where the contractor name might have slight variations
        return [allowedContractor];
    }
    
    // For other users, show all contractors
    return contractors;
  };

  const filteredContractors = getFilteredContractors();

  // Toggle expandable menus
  const toggleMenu = (index) => {
    setExpandedMenus(prev => ({
      ...prev,
      [index]: !prev[index]
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setData(null);
    try {
      if (!startDate || !endDate) {
        setError('Please select both start and end dates.');
        return;
      }
      console.log('Start Date:', startDate, 'End Date:', endDate);
      
      // Build query parameters
      const params = new URLSearchParams({
        startDate,
        endDate,
        source: 'both'
      });
      
      if (contractor && contractor !== 'All') {
        params.append('contractor', contractor);
      }
      if (department && department !== 'All') {
        params.append('department', department);
      }
      if (category && category !== 'All') {
        params.append('category', category);
      }
      if (status && status !== 'All') {
        params.append('status', status);
      }
      if (userEmail) {
        params.append('userEmail', userEmail);
      }
      if (userRole) {
        params.append('userRole', userRole);
      }
      
      const response = await fetch(`/server/attendance_muster_function?${params.toString()}`);
      let result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to fetch muster data');
      if (result.error) throw new Error(result.error);

      if (result.employees && result.muster) {
        try {
          const lohRows = await fetchLohRowsForMusterOverlay({
            startDate,
            endDate,
            contractor: contractor !== 'All' ? contractor : undefined,
            department: department !== 'All' ? department : undefined,
            userEmail,
            userRole,
          });
          if (lohRows.length > 0) {
            result = applyReportsLohToMusterData(result, lohRows);
            console.log(
              `Attendance Muster: LOH merged from reports_function (${lohRows.length} row(s)) — matches LOH Report`
            );
          }
        } catch (lohMergeErr) {
          console.warn('Attendance Muster: LOH merge from reports_function skipped:', lohMergeErr?.message || lohMergeErr);
        }
      }

      setData(result);
    } catch (err) {
      setError(err.message);
    }
  };

  // Set default contractor based on user email - always set for restricted users
  useEffect(() => {
    if (userRole === 'App Administrator') return;
    if (!userEmail) return;
    
    // Use the emailContractorMap defined at the top level
    const defaultContractor = emailContractorMap[userEmail];
    
    // For restricted users, always set to their assigned contractor (even if not in contractors list)
    if (defaultContractor && contractor !== defaultContractor) {
      console.log(`Setting contractor to ${defaultContractor} for restricted user: ${userEmail}`);
      setContractor(defaultContractor);
    }
  }, [userRole, userEmail, contractor]);

  // Fetch dropdown data on mount
  useEffect(() => {
    fetch('/server/reports_function/contractors')
      .then(res => res.json())
      .then(data => setContractors(['All', ...(data.data || [])]))
      .catch(() => setContractors(['All']));
    fetch('/server/department_function/departments')
      .then(res => res.json())
      .then(data => {
        const departmentRows = data?.data?.departments || [];
        const departmentNames = departmentRows.map(d => d.departmentName).filter(Boolean);
        setDepartments(['All', ...departmentNames]);
      })
      .catch(() => setDepartments(['All']));
    fetch(`/server/cms_function/employees/categories${userEmail || userRole ? `?${new URLSearchParams({
      ...(userEmail ? { userEmail } : {}),
      ...(userRole ? { userRole } : {})
    }).toString()}` : ''}`)
      .then(res => res.json())
      .then(data => setCategories(['All', ...((data.data?.categories) || [])]))
      .catch(() => setCategories(['All']));
  }, []);

  useEffect(() => {
    let mounted = true;
    fetch('/server/Shift_function/shifts')
      .then((res) => res.json())
      .then((result) => {
        if (!mounted) return;
        const shifts = result?.data?.shifts;
        if (!Array.isArray(shifts)) {
          setShiftMasterNames([]);
          return;
        }
        const names = Array.from(
          new Set(
            shifts
              .map((row) => normalizeShiftDisplayName(row?.shiftName))
              .filter(Boolean)
          )
        );
        setShiftMasterNames(names);
      })
      .catch(() => {
        if (mounted) setShiftMasterNames([]);
      });
    return () => {
      mounted = false;
    };
  }, []);

  // Sync Adjust value from payroll vs muster OT (same logic as Monthly OT report).
  useEffect(() => {
    let cancelled = false;
    if (!data?.employees?.length || !startDate || String(startDate).length < 7) return undefined;

    const month = String(startDate).slice(0, 7);

    async function syncAdjustFromPayroll() {
      try {
        let url = `/server/payroll_function/payroll?month=${encodeURIComponent(month)}&_t=${Date.now()}`;
        if (contractor !== 'All') url += `&contractor=${encodeURIComponent(contractor)}`;
        if (department !== 'All') url += `&department=${encodeURIComponent(department)}`;
        if (userEmail) url += `&userEmail=${encodeURIComponent(userEmail)}`;
        if (userRole) url += `&userRole=${encodeURIComponent(userRole)}`;
        const res = await fetch(url);
        if (!res.ok || cancelled) return;
        const result = await res.json();
        const payrollRows = result.data || [];
        if (cancelled) return;
        const otMap = buildPayrollOtLookup(payrollRows);
        setOtAdjustments(() => {
          const next = {};
          const ids = new Set(data.employees.map((id) => String(id).trim()));
          data.employees.forEach((empId, rowIdx) => {
            const id = String(empId).trim();
            let reportOt = 0;
            if (data.monthlyOvertimePreferred && data.monthlyOvertimePreferred[rowIdx] != null) {
              reportOt = parseFloat(data.monthlyOvertimePreferred[rowIdx]) || 0;
            } else if (data.monthlyOvertimeReports && data.monthlyOvertimeReports[rowIdx] != null) {
              reportOt = parseFloat(data.monthlyOvertimeReports[rowIdx]) || 0;
            } else if (data.monthlyOvertime && data.monthlyOvertime[rowIdx] != null) {
              reportOt = parseFloat(data.monthlyOvertime[rowIdx]) || 0;
            }
            const payrollOt = lookupPayrollOt(otMap, id);
            if (payrollOt !== undefined && Number.isFinite(payrollOt)) {
              next[id] = adjustValueFromPayrollSync(payrollOt, reportOt);
            } else {
              next[id] = '0';
            }
          });
          Object.keys(next).forEach((k) => {
            if (!ids.has(k)) delete next[k];
          });
          return next;
        });
      } catch {
        if (!cancelled) {
          setOtAdjustments((prev) => {
            const next = { ...prev };
            const ids = new Set(data.employees.map((id) => String(id).trim()));
            for (const id of ids) {
              if (!(id in next)) next[id] = '0';
            }
            Object.keys(next).forEach((k) => {
              if (!ids.has(k)) delete next[k];
            });
            return next;
          });
        }
      }
    }

    syncAdjustFromPayroll();
    return () => {
      cancelled = true;
    };
  }, [data, startDate, contractor, department, userEmail, userRole]);

  const legendShifts = useMemo(() => {
    if (shiftMasterNames.length > 0) return shiftMasterNames;
    return ['1st Shift', '2nd Shift', '3rd Shift', 'General', 'General II', 'Housekeeping'];
  }, [shiftMasterNames]);

  const refreshContractors = () => {
    fetch('/server/reports_function/contractors')
      .then(res => res.json())
      .then(data => setContractors(['All', ...(data.data || [])]))
      .catch(() => setContractors(['All']));
  };

  const refreshDepartments = () => {
    fetch('/server/department_function/departments')
      .then(res => res.json())
      .then(data => {
        const departmentRows = data?.data?.departments || [];
        const departmentNames = departmentRows.map(d => d.departmentName).filter(Boolean);
        setDepartments(['All', ...departmentNames]);
      })
      .catch(() => setDepartments(['All']));
  };

  const refreshCategories = () => {
    const params = new URLSearchParams();
    if (userEmail) params.set('userEmail', userEmail);
    if (userRole) params.set('userRole', userRole);
    const query = params.toString();
    fetch(`/server/cms_function/employees/categories${query ? `?${query}` : ''}`)
      .then(res => res.json())
      .then(data => setCategories(['All', ...((data.data?.categories) || [])]))
      .catch(() => setCategories(['All']));
  };

  const handleExport = async () => {
    if (!data || !data.dates || !data.employees || !data.muster) return;
    
    // Build header and sheet data for XLSX
    const header = ['Employee ID', 'Employee Name', 'Department', 'Category', 'Date of Joining', 'Date of Exit', ...data.dates.map(date => new Date(date).toLocaleDateString('en-GB')), 'Total Hours', 'LOH', 'OT Hours', 'Adjust value', 'Final OT Value', 'Total Present', 'Total Absent'];
    const sheetData = [header];
    
    // Add data rows - use explicit for loop to ensure exact same order as display
    // This ensures the export order matches exactly what's displayed on screen
    for (let rowIdx = 0; rowIdx < data.employees.length; rowIdx++) {
      const empId = data.employees[rowIdx];
      const rowStatuses = data.muster[rowIdx];
      const rowFirstIn = data.firstIn ? data.firstIn[rowIdx] : [];
      const rowLastOut = data.lastOut ? data.lastOut[rowIdx] : [];
      const rowOndutyAppliedFirstIn = data.ondutyAppliedFirstIn ? data.ondutyAppliedFirstIn[rowIdx] : [];
      const rowOndutyAppliedLastOut = data.ondutyAppliedLastOut ? data.ondutyAppliedLastOut[rowIdx] : [];
      const rowRealFirstIn = data.realFirstIn ? data.realFirstIn[rowIdx] : [];
      const rowRealLastOut = data.realLastOut ? data.realLastOut[rowIdx] : [];
      const rowLohFirstIn = data.lohFirstIn ? data.lohFirstIn[rowIdx] : [];
      const rowLohLastOut = data.lohLastOut ? data.lohLastOut[rowIdx] : [];
      const rowTotalHours = data.totalHours ? data.totalHours[rowIdx] : [];
      const rowLOH = data.loh ? data.loh[rowIdx] : [];
      const rowOvertimeHours = data.overtimeHours ? data.overtimeHours[rowIdx] : [];
      const rowEmployeeNames = data.employeeNames ? data.employeeNames[rowIdx] : [];
      const rowDepartments = data.departments ? data.departments[rowIdx] : [];
      const rowCategories = data.categories ? data.categories[rowIdx] : [];
      const rowDateOfJoining = data.dateOfJoining ? data.dateOfJoining[rowIdx] : [];
      const rowDateOfExit = data.dateOfExit ? data.dateOfExit[rowIdx] : [];
      const employeeName = rowEmployeeNames.length > 0 ? rowEmployeeNames[0] : '';
      const department = rowDepartments.length > 0 ? rowDepartments[0] : '-';
      const category = rowCategories.length > 0 ? rowCategories[0] : '-';
      const dateOfJoining = rowDateOfJoining.length > 0 ? rowDateOfJoining[0] : '';
      const dateOfExit = rowDateOfExit.length > 0 ? rowDateOfExit[0] : '';
      const formattedDateOfJoining = dateOfJoining ? new Date(dateOfJoining).toLocaleDateString('en-GB') : '-';
      const formattedDateOfExit = dateOfExit ? new Date(dateOfExit).toLocaleDateString('en-GB') : '-';
      
      const totalPresent = countPresentDaysForMusterRow(rowStatuses, data.dates, { halfDayWeight: 0.5 });
      const totalAbsent = calculateTotalAbsentExcludingSundays(rowStatuses, data.dates);
      
      const totalHoursSum = rowTotalHours.reduce((sum, hoursValue) => {
        if (hoursValue && hoursValue !== '' && !isNaN(hoursValue)) {
          return sum + parseFloat(hoursValue);
        }
        return sum;
      }, 0);
      const formattedTotalHours = totalHoursSum > 0 ? totalHoursSum.toFixed(2) : '-';
      
      let totalLOH = 0;
      if (data.monthlyLOHPreferred && data.monthlyLOHPreferred[rowIdx] !== undefined && data.monthlyLOHPreferred[rowIdx] !== null) {
        totalLOH = parseFloat(data.monthlyLOHPreferred[rowIdx]) || 0;
      } else {
        totalLOH = rowLOH.reduce((sum, lohValue) => {
          if (lohValue && lohValue !== '' && !isNaN(lohValue)) {
            return sum + parseFloat(lohValue);
          }
          return sum;
        }, 0);
      }
      const formattedTotalLOH = formatMusterLohTotal(totalLOH);
      
      // OT Hours must come from reports_function values only
      let totalOTHours = 0;
      if (data.monthlyOvertimePreferred && data.monthlyOvertimePreferred[rowIdx] !== undefined && data.monthlyOvertimePreferred[rowIdx] !== null) {
        totalOTHours = parseFloat(data.monthlyOvertimePreferred[rowIdx]);
      } else if (data.monthlyOvertimeReports && data.monthlyOvertimeReports[rowIdx] !== undefined && data.monthlyOvertimeReports[rowIdx] !== null) {
        totalOTHours = parseFloat(data.monthlyOvertimeReports[rowIdx]);
      } else if (data.monthlyOvertime && data.monthlyOvertime[rowIdx] !== undefined && data.monthlyOvertime[rowIdx] !== null) {
        totalOTHours = parseFloat(data.monthlyOvertime[rowIdx]);
      }
      const formattedTotalOTHours = totalOTHours > 0 ? totalOTHours.toFixed(2) : '-';
      const adjExport = parseOtHours(otAdjustments[String(empId)]);
      const finalOtExport = totalOTHours + adjExport;
      
      // Build row data
      const rowData = [
        empId,
        employeeName || '-',
        department || '-',
        category || '-',
        formattedDateOfJoining,
        formattedDateOfExit,
        ...rowStatuses.map((s, colIdx) => {
          const status = String(s || '').trim();
          const lohFirstInTime = rowLohFirstIn && rowLohFirstIn[colIdx] ? String(rowLohFirstIn[colIdx]).trim() : '';
          const lohLastOutTime = rowLohLastOut && rowLohLastOut[colIdx] ? String(rowLohLastOut[colIdx]).trim() : '';
          const lohLine = (lohFirstInTime && lohLastOutTime) ? `LOH: ${lohFirstInTime} - ${lohLastOutTime}` : '';
          let statusDisplay = 'A';
          if (status === 'Present' || status === 'P') statusDisplay = 'P';
          else if (status === 'Half Day Present' || status === '0.5') statusDisplay = '0.5'; // Half Day as 0.5
          else if (status === 'H') statusDisplay = 'H'; // Holiday as H
          else if (status === 'WO') statusDisplay = 'WO';
          else if (status === 'CO') statusDisplay = 'CO'; // Comp Off as CO
          else if (status === 'OD') statusDisplay = 'OD (Full Day)'; // On Duty as OD (Full Day)
          else if (status === 'OD-0.5') statusDisplay = 'OD (Half Day)'; // Half Day On Duty
          
          if (status === 'CO') {
            return statusDisplay;
          }
          // OD (Full Day): show First In and Last Out (from OnDuty applied or muster firstIn/lastOut)
          if (status === 'OD') {
            const odFirstIn = rowOndutyAppliedFirstIn[colIdx] || rowFirstIn[colIdx] || '';
            const odLastOut = rowOndutyAppliedLastOut[colIdx] || rowLastOut[colIdx] || '';
            const toTimeStr = (v) => {
              if (!v || typeof v !== 'string') return '';
              const s = String(v).trim();
              if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(s)) return s.length >= 5 ? s.substring(0, 5) : s;
              const spaceIdx = s.indexOf(' ');
              if (spaceIdx !== -1) return s.substring(spaceIdx + 1, spaceIdx + 6);
              return s.substring(0, 5);
            };
            const firstInTime = toTimeStr(odFirstIn);
            const lastOutTime = toTimeStr(odLastOut);
            if (firstInTime && lastOutTime) {
              return [statusDisplay, `${firstInTime} - ${lastOutTime}`, lohLine].filter(Boolean).join('\n');
            }
            return [statusDisplay, lohLine].filter(Boolean).join('\n');
          }
          // OD (Half Day): two parts - OnDuty applied time, then Check-in/out (real times)
          if (status === 'OD-0.5') {
            const appliedFrom = rowOndutyAppliedFirstIn[colIdx] || '';
            const appliedTo = rowOndutyAppliedLastOut[colIdx] || '';
            const realFrom = rowRealFirstIn[colIdx] || '';
            const realTo = rowRealLastOut[colIdx] || '';
            const appliedLine = (appliedFrom && appliedTo) ? `${appliedFrom} - ${appliedTo}` : '';
            const realLine = (realFrom && realTo) ? `Check-in/out: ${realFrom} - ${realTo}` : '';
            if (appliedLine || realLine) {
              const primaryLine = [appliedLine, realLine].filter(Boolean).join(' | ');
              return [statusDisplay, primaryLine, lohLine].filter(Boolean).join('\n');
            }
            return [statusDisplay, lohLine].filter(Boolean).join('\n');
          }
          
          const firstInTime = rowFirstIn[colIdx] || '';
          const lastOutTime = rowLastOut[colIdx] || '';
          
          if (firstInTime && lastOutTime) {
            return [statusDisplay, `${firstInTime} - ${lastOutTime}`, lohLine].filter(Boolean).join('\n');
          }
          return [statusDisplay, lohLine].filter(Boolean).join('\n');
        }),
        formattedTotalHours,
        formattedTotalLOH,
        formattedTotalOTHours,
        adjExport.toFixed(2),
        finalOtExport.toFixed(2),
        totalPresent,
        totalAbsent
      ];
      
      sheetData.push(rowData);
    }
    
    // Build workbook with XLSX and download
    const worksheet = XLSX.utils.aoa_to_sheet(sheetData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Muster');

    worksheet['!cols'] = header.map((columnName, idx) => {
      if (idx === 0) return { wch: 12 };
      if (idx === 1) return { wch: 22 };
      if (idx === 2) return { wch: 16 };
      if (idx === 3) return { wch: 12 };
      if (idx === 4 || idx === 5) return { wch: 14 };
      if (idx >= 6 && idx < 6 + data.dates.length) return { wch: 18 };
      if (columnName === 'Total Hours' || columnName === 'Final OT Value') return { wch: 14 };
      if (columnName === 'LOH' || columnName === 'OT Hours' || columnName === 'Adjust value') return { wch: 12 };
      return { wch: 13 };
    });

    // Apply header row style (dark blue background, white text, centered) – matches image model
    const headerFill = {
      fill: { patternType: 'solid', fgColor: { rgb: 'FF1E40AF' } },
      font: { color: { rgb: 'FFFFFFFF' }, bold: true },
      alignment: { horizontal: 'center', vertical: 'center', wrapText: true }
    };
    const numCols = header.length;
    for (let c = 0; c < numCols; c++) {
      const addr = XLSX.utils.encode_cell({ r: 0, c });
      if (worksheet[addr]) worksheet[addr].s = headerFill;
    }

    // Apply status + shift colours to each date cell (1st shift, 2nd shift, housekeeping = same as table)
    // Columns 0–5: ID, Name, Dept, Category, Date of Joining, Date of Exit; dates start at 6
    const dateStartCol = 6;
    const dateColCount = data.dates.length;
    for (let rowIdx = 0; rowIdx < data.employees.length; rowIdx++) {
      const rowStatuses = data.muster[rowIdx];
      const rowFirstIn = data.firstIn ? data.firstIn[rowIdx] : [];
      const rowLastOut = data.lastOut ? data.lastOut[rowIdx] : [];
      const rowShiftTypes = data.shiftTypes && data.shiftTypes[rowIdx] ? data.shiftTypes[rowIdx] : [];
      const sheetRow = rowIdx + 1;
      for (let colIdx = 0; colIdx < dateColCount; colIdx++) {
        const status = rowStatuses && rowStatuses[colIdx] != null ? rowStatuses[colIdx] : '';
        const firstIn = rowFirstIn[colIdx] || '';
        const lastOut = rowLastOut[colIdx] || '';
        const shiftType = rowShiftTypes[colIdx] != null ? rowShiftTypes[colIdx] : '';
        const addr = XLSX.utils.encode_cell({ r: sheetRow, c: dateStartCol + colIdx });
        if (worksheet[addr]) worksheet[addr].s = musterDateCellExcelStyle(status, shiftType, firstIn, lastOut);
      }
    }

    XLSX.writeFile(workbook, 'attendance_muster.xlsx');
  };

  // User info
  const userAvatar = "https://images.pexels.com/photos/2379004/pexels-photo-2379004.jpeg?auto=compress&cs=tinysrgb&w=150";
  const userName = userRole === 'App Administrator' ? 'Admin User' : 'App User';

  // Sample activity data with Lucide icons
  const recentActivities = [
    { icon: <User size={20} />, title: 'New Employee Added', description: 'John Doe joined the development team', time: '2 hours ago' },
    { icon: <BarChart3 size={20} />, title: 'Monthly Report Generated', description: 'Contractor performance report is ready', time: '4 hours ago' },
    { icon: <CheckCircle size={20} />, title: 'Contract Approved', description: 'ABC Construction contract approved', time: '6 hours ago' },
    { icon: <Bell size={20} />, title: 'System Update', description: 'Payroll Management System updated to version 2.1', time: '1 day ago' },
    { icon: <Plus size={20} />, title: 'New Application', description: 'Candidate applied for senior position', time: '2 days ago' }
  ];

  return (
    <>
      {/* Animated Background */}
      <div className="cms-background">
        <div className="floating-shape"></div>
        <div className="floating-shape"></div>
        <div className="floating-shape"></div>
        <div className="floating-shape"></div>
      </div>

      <div className="cms-dashboard-root">
        {/* Enhanced Sidebar */}
        <nav className="cms-sidebar">
          {/* Sidebar Header */}
          <div className="cms-sidebar-header">
            <div className="cms-header-content">
              <div className="cms-logo-section">
                <div className="cms-menu-toggle" onClick={() => setShowSidebarMenu(!showSidebarMenu)}>
                  <div className="cms-three-dots">
                    <span></span>
                    <span></span>
                    <span></span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Navigation */}
          <div className="cms-nav">
            {modulesToShow.map((item, idx) => (
              item.children ? (
                <div key={item.label} className={`cms-nav-expandable ${expandedMenus[idx] ? 'expanded' : ''}`}>
                  <div className="cms-nav-item" onClick={() => toggleMenu(idx)}>
                    <span className="cms-nav-icon">{item.icon}</span>
                    <span className="cms-nav-label">{item.label}</span>
                    <span className="cms-expand-icon">
                      <Plus size={16} className={`expand-icon ${expandedMenus[idx] ? 'rotated' : ''}`} />
                    </span>
                  </div>
                  <div className="cms-nav-children">
                    {item.children.map(child => (
                      <Link
                        to={child.path}
                        key={child.label}
                        className={`cms-nav-child ${['/loh-report', '/onduty', '/grace', '/compoff', '/calendar'].includes(child.path) ? 'clock-color-icon' : ''}`}
                      >
                        <span className="cms-nav-icon">{child.icon}</span>
                        <span className="cms-nav-label">{child.label}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              ) : (
                <Link
                  to={item.path}
                  className={`cms-nav-item ${['/loh-report', '/onduty', '/grace', '/compoff', '/calendar'].includes(item.path) ? 'clock-color-icon' : ''}`}
                  data-nav-path={item.path}
                  key={item.label}
                >
                  <span className="cms-nav-icon">{item.icon}</span>
                  <span className="cms-nav-label">{item.label}</span>
                </Link>
              )
            ))}
          </div>

          {/* User Info */}
          <div className="cms-user-info">
            <img src={userAvatar} alt="User" className="cms-user-avatar" />
            <div className="cms-user-details">
              <h4>{userName}</h4>
              <p>{userRole || 'User'}</p>
            </div>
          </div>
        </nav>

        {/* Main Content */}
        <div className="cms-main-content">
          {/* Enhanced Header */}
          <header className="cms-header">
            <div className="cms-header-center">
              <h1>Payroll Management System</h1>
            </div>
            <div className="cms-header-right">
              <HeaderBranding />
              <div className="cms-header-user">
                <div className="cms-notification-icon" onClick={() => setShowNotifications(!showNotifications)}>
                  <Bell size={24} />
                </div>
                <img src={userAvatar} alt="User" className="cms-user-avatar" />
              </div>
            </div>
          </header>

          {/* Notification Popup */}
          {showNotifications && (
            <div className="cms-notification-overlay" onClick={() => setShowNotifications(false)}>
              <div className="cms-notification-popup" onClick={(e) => e.stopPropagation()}>
                <div className="cms-notification-header">
                  <h3>Recent Activity</h3>
                  <button 
                    className="cms-close-btn"
                    onClick={() => setShowNotifications(false)}
                  >
                    ×
                  </button>
                </div>
                <div className="cms-notification-content">
                  {recentActivities.map((activity, index) => (
                    <div key={index} className="cms-activity-item">
                      <div className="cms-activity-icon">{activity.icon}</div>
                      <div className="cms-activity-content">
                        <h4>{activity.title}</h4>
                        <p>{activity.description}</p>
                        <span className="cms-activity-time">{activity.time}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Dashboard Content */}
          <main className="cms-dashboard-content">
            {/* Muster Form Card */}
            <div className="employee-card-container">
              <div className="employee-section-title">Muster Report Configuration</div>
              <div className="employee-section-subtitle">
                Generate attendance muster reports with advanced filtering and export capabilities
              </div>
              
              <form className="muster-filter-form" onSubmit={handleSubmit}>
                <div className="muster-filter-grid">
                  <div className="muster-filter-group">
                    <label>Start Date:
                      <DateInputDdMm
                        className="muster-input"
                        value={startDate}
                        onChange={setStartDate}
                      />
                    </label>
                  </div>
                  <div className="muster-filter-group">
                    <label>End Date:
                      <DateInputDdMm
                        className="muster-input"
                        value={endDate}
                        onChange={setEndDate}
                        min={startDate || undefined}
                      />
                    </label>
                  </div>
                  <div className="muster-filter-group">
                    <label>Employee ID:
                      <input type="text" className="muster-input" placeholder="Search By Employee" />
                    </label>
                  </div>
                  <div className="muster-filter-group">
                    <label>Employee Name:
                      <input type="text" className="muster-input" placeholder="Search By Name" />
                    </label>
                  </div>
                  <div className="muster-filter-group">
                    <label>Status:
                      <select
                        className="muster-input"
                        value={status}
                        onChange={e => setStatus(e.target.value)}
                      >
                        <option value="All">All</option>
                        <option value="Active">Active</option>
                        <option value="Inactive">Inactive</option>
                      </select>
                    </label>
                  </div>
                </div>
                <div className="muster-filter-actions">
                  <button type="submit" className="cms-btn primary">Apply Filter</button>
                  <button type="button" className="cms-btn" onClick={handleExport} disabled={!data}>
                    <Download size={16} /> Export to Excel
                  </button>
                </div>
              </form>
              
              {error && <div className="muster-error">{error}</div>}
              
              {data && data.summary && (
                <div className="muster-data-info">
                  <h4>Data Sources</h4>
                  <p>ESSL Server Records: {data.summary.bhrRecords || 0}</p>
                  <p>Imported Attendance Records: {data.summary.attendanceRecords || 0}</p>
                  <p>On Duty Records: {data.summary.ondutyRecords || 0}</p>
                  <p>Total Employees: {data.summary.totalEmployees || 0}</p>
                  <p>Date Range: {data.summary.dateRange || 'N/A'}</p>
                </div>
              )}
            </div>

            {/* Muster Table Section */}
            {data && data.dates && data.employees && data.muster && (
              <div className="cms-chart-card muster-table-section">
                <div className="cms-chart-header">
                  <h3 className="cms-chart-title">Attendance Muster Report</h3>
                </div>

                {/* Shift legend (NewShiftMap) */}
                <div className="muster-shift-legend">
                  {legendShifts.map((shiftName) => (
                    <div className="legend-item" key={shiftName}>
                      <span className={`legend-swatch ${getShiftClassName(shiftName)}`} />
                      <span>{shiftName}</span>
                    </div>
                  ))}
                </div>
                
                <div className="muster-table-scroll">
                  <table className="muster-table">
                    <thead>
                      <tr>
                        <th>Employee ID</th>
                        <th>Employee Name</th>
                        <th>Department</th>
                        <th>Category</th>
                        <th>Date of Joining</th>
                        <th>Date of Exit</th>
                        {(data.dates && Array.isArray(data.dates) ? data.dates : []).map(date => (
                          <th key={date} className="muster-date-col">{new Date(date).toLocaleDateString('en-GB')}</th>
                        ))}
                        <th>Total Hours</th>
                        <th>LOH</th>
                        <th>OT Hours</th>
                        <th>Adjust value</th>
                        <th>Final OT Value</th>
                        <th>Total Present</th>
                        <th>Total Absent</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.employees && data.employees.map((empId, rowIdx) => {
                        const rowStatuses = data.muster && data.muster[rowIdx] ? data.muster[rowIdx] : [];
                        const rowFirstIn = data.firstIn && data.firstIn[rowIdx] ? data.firstIn[rowIdx] : [];
                        const rowLastOut = data.lastOut && data.lastOut[rowIdx] ? data.lastOut[rowIdx] : [];
                        const rowShiftTypes = data.shiftTypes && data.shiftTypes[rowIdx] ? data.shiftTypes[rowIdx] : [];
                        const rowSources = data.sources && data.sources[rowIdx] ? data.sources[rowIdx] : [];
                        const rowOndutyFirstIn = data.ondutyFirstIn && data.ondutyFirstIn[rowIdx] ? data.ondutyFirstIn[rowIdx] : [];
                        const rowOndutyLastOut = data.ondutyLastOut && data.ondutyLastOut[rowIdx] ? data.ondutyLastOut[rowIdx] : [];
                        const rowOndutyAppliedFirstIn = data.ondutyAppliedFirstIn && data.ondutyAppliedFirstIn[rowIdx] ? data.ondutyAppliedFirstIn[rowIdx] : [];
                        const rowOndutyAppliedLastOut = data.ondutyAppliedLastOut && data.ondutyAppliedLastOut[rowIdx] ? data.ondutyAppliedLastOut[rowIdx] : [];
                        const rowRealFirstIn = data.realFirstIn && data.realFirstIn[rowIdx] ? data.realFirstIn[rowIdx] : [];
                        const rowRealLastOut = data.realLastOut && data.realLastOut[rowIdx] ? data.realLastOut[rowIdx] : [];
                        const rowLohFirstIn = data.lohFirstIn && data.lohFirstIn[rowIdx] ? data.lohFirstIn[rowIdx] : [];
                        const rowLohLastOut = data.lohLastOut && data.lohLastOut[rowIdx] ? data.lohLastOut[rowIdx] : [];
                        const rowTotalHours = data.totalHours && data.totalHours[rowIdx] ? data.totalHours[rowIdx] : [];
                        const rowLOH = data.loh && data.loh[rowIdx] ? data.loh[rowIdx] : [];
                        const rowOvertimeHours = data.overtimeHours && data.overtimeHours[rowIdx] ? data.overtimeHours[rowIdx] : [];
                        const rowEmployeeNames = data.employeeNames && data.employeeNames[rowIdx] ? data.employeeNames[rowIdx] : [];
                        const rowDepartments = data.departments && data.departments[rowIdx] ? data.departments[rowIdx] : [];
                        const rowCategories = data.categories && data.categories[rowIdx] ? data.categories[rowIdx] : [];
                        const rowDateOfJoining = data.dateOfJoining && data.dateOfJoining[rowIdx] ? data.dateOfJoining[rowIdx] : [];
                        const rowDateOfExit = data.dateOfExit && data.dateOfExit[rowIdx] ? data.dateOfExit[rowIdx] : [];
                        const employeeName = rowEmployeeNames.length > 0 ? rowEmployeeNames[0] : '';
                        const department = rowDepartments.length > 0 ? rowDepartments[0] : '-';
                        const category = rowCategories.length > 0 ? rowCategories[0] : '-';
                        const dateOfJoining = rowDateOfJoining.length > 0 ? rowDateOfJoining[0] : '';
                        const dateOfExit = rowDateOfExit.length > 0 ? rowDateOfExit[0] : '';
                        // Format date of joining for display (DD/MM/YYYY)
                        const formattedDateOfJoining = dateOfJoining ? new Date(dateOfJoining).toLocaleDateString('en-GB') : '-';
                        // Format date of exit for display (DD/MM/YYYY)
                        const formattedDateOfExit = dateOfExit ? new Date(dateOfExit).toLocaleDateString('en-GB') : '-';
                        const totalPresent = countPresentDaysForMusterRow(rowStatuses, data.dates, { halfDayWeight: 0.5 });
                        const totalAbsent = calculateTotalAbsentExcludingSundays(rowStatuses, data.dates);
                        // Calculate total hours for the period (sum of all days)
                        const totalHoursSum = (rowTotalHours && Array.isArray(rowTotalHours)) ? rowTotalHours.reduce((sum, hoursValue) => {
                          if (hoursValue && hoursValue !== '' && !isNaN(hoursValue)) {
                            return sum + parseFloat(hoursValue);
                          }
                          return sum;
                        }, 0) : 0;
                        const formattedTotalHours = totalHoursSum > 0 ? totalHoursSum.toFixed(2) : '-';
                        // Calculate total LOH for the period. Always use LOH report total hours (same calculation as LOH report)
                        let totalLOH = 0;
                        // Prefer monthlyLOHPreferred (which sums calculated daily LOH values - same as LOH report)
                        if (data.monthlyLOHPreferred && data.monthlyLOHPreferred[rowIdx] !== undefined && data.monthlyLOHPreferred[rowIdx] !== null) {
                          totalLOH = parseFloat(data.monthlyLOHPreferred[rowIdx]);
                        } else {
                          // Fallback: sum daily LOH values (same calculation as LOH report)
                          totalLOH = (rowLOH && Array.isArray(rowLOH)) ? rowLOH.reduce((sum, lohValue) => {
                            if (lohValue && lohValue !== '' && !isNaN(lohValue)) {
                              return sum + parseFloat(lohValue);
                            }
                            return sum;
                          }, 0) : 0;
                        }
                        const formattedTotalLOH = formatMusterLohTotal(totalLOH);
                        // Calculate total OT hours for the period using reports_function totals only
                        let totalOTHours = 0;
                        if (data.monthlyOvertimePreferred && data.monthlyOvertimePreferred[rowIdx] !== undefined && data.monthlyOvertimePreferred[rowIdx] !== null) {
                          totalOTHours = parseFloat(data.monthlyOvertimePreferred[rowIdx]);
                        } else if (data.monthlyOvertimeReports && data.monthlyOvertimeReports[rowIdx] !== undefined && data.monthlyOvertimeReports[rowIdx] !== null) {
                          totalOTHours = parseFloat(data.monthlyOvertimeReports[rowIdx]);
                        }
                        const formattedTotalOTHours = totalOTHours > 0 ? totalOTHours.toFixed(2) : '-';
                        const adjMuster = parseOtHours(otAdjustments[String(empId)]);
                        const finalOtMuster = totalOTHours + adjMuster;
                        return (
                          <tr key={empId}>
                            <td>{empId}</td>
                            <td>{employeeName || '-'}</td>
                            <td>{department}</td>
                            <td>{category || '-'}</td>
                            <td>{formattedDateOfJoining}</td>
                            <td>{formattedDateOfExit}</td>
                            {(rowStatuses && Array.isArray(rowStatuses) ? rowStatuses : []).map((status, colIdx) => {
                              let display = status;
                              let className = '';
                              if (status === 'Present') { display = 'P'; className = 'present'; }
                              else if (status === 'Absent') { display = ' '; className = 'absent'; }
                              else if (status === 'Half Day Present') { display = '0.5'; className = 'halfday'; }
                              else if (status === 'WO') { display = 'WO'; className = 'weekoff'; }
                              else if (status === 'H') { display = 'H'; className = 'holiday'; }
                              else if (status === 'CO') { display = 'CO'; className = 'compoff'; }
                              else if (status === 'OD') { display = 'OD (Full Day)'; className = 'onduty'; }
                              else if (status === 'OD-0.5') { display = 'OD (Half Day)'; className = 'onduty-halfday'; }

                              // Apply shift-based tint (from NewShiftMap / Shiftmap) for UI clarity
                              const shiftType = rowShiftTypes && rowShiftTypes[colIdx] ? rowShiftTypes[colIdx] : 'GENERAL';
                              const firstInRawForInfer = rowFirstIn && Array.isArray(rowFirstIn) && rowFirstIn[colIdx] ? String(rowFirstIn[colIdx]).trim() : '';
                              let shiftClass = resolveMusterShiftClassForCell(shiftType, status, firstInRawForInfer);
                              let shiftDisplayName = normalizeShiftDisplayName(shiftType);
                              if (shiftClass === 'shift-third' && getShiftClassName(shiftType) === 'shift-general') {
                                shiftDisplayName = '3rd Shift';
                              }
                              const shouldShowShiftText = shiftDisplayName && shiftDisplayName.toLowerCase() !== 'general';
                              className = `${className} ${shiftClass}`.trim();
                              
                              // Get source for this date
                              const source = rowSources && rowSources[colIdx] ? rowSources[colIdx] : '';
                              const isOnDuty = source && (source.includes('OnDuty') || source === 'OnDuty');
                              
                              // Get First IN and Last OUT for this specific date (shown for WO and H)
                              const firstInTime = rowFirstIn && Array.isArray(rowFirstIn) && rowFirstIn[colIdx] ? String(rowFirstIn[colIdx]).trim() : '';
                              const lastOutTime = rowLastOut && Array.isArray(rowLastOut) && rowLastOut[colIdx] ? String(rowLastOut[colIdx]).trim() : '';
                              
                              // For OD/OD-0.5, prioritize ondutyAppliedFirstIn/LastOut (bypasses OT_EXCLUSIONS for OnDuty display)
                              const odAppliedFirstInTime = rowOndutyAppliedFirstIn && rowOndutyAppliedFirstIn[colIdx] ? String(rowOndutyAppliedFirstIn[colIdx]).trim() : '';
                              const odAppliedLastOutTime = rowOndutyAppliedLastOut && rowOndutyAppliedLastOut[colIdx] ? String(rowOndutyAppliedLastOut[colIdx]).trim() : '';
                              
                              // Determine which time to display - single unified logic
                              let finalTimeDisplay = '';
                              let displayFirstInTime = firstInTime;
                              let displayLastOutTime = lastOutTime;
                              
                              // For OD statuses, use OnDuty applied times first (always shown even if OT_EXCLUSIONS applies)
                              if ((status === 'OD' || status === 'OD-0.5') && isOnDuty) {
                                if (odAppliedFirstInTime && odAppliedLastOutTime) {
                                  displayFirstInTime = odAppliedFirstInTime;
                                  displayLastOutTime = odAppliedLastOutTime;
                                }
                              }
                              
                              // For OnDuty records (Present, OD, OD-0.5), if regular times are not available, try to extract from OnDuty arrays
                              if (isOnDuty && (status === 'Present' || status === 'OD' || status === 'OD-0.5') && (!displayFirstInTime || !displayLastOutTime)) {
                                const ondutyFirstInDate = rowOndutyFirstIn && rowOndutyFirstIn[colIdx] ? rowOndutyFirstIn[colIdx] : '';
                                const ondutyLastOutDate = rowOndutyLastOut && rowOndutyLastOut[colIdx] ? rowOndutyLastOut[colIdx] : '';
                                
                                // Extract time from OnDuty datetime strings if regular times not available
                                if (!displayFirstInTime && ondutyFirstInDate) {
                                  try {
                                    const timeMatch = String(ondutyFirstInDate).match(/\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
                                    if (timeMatch) {
                                      displayFirstInTime = timeMatch[1].padStart(2, '0') + ':' + timeMatch[2];
                                    } else {
                                      const dateObj = new Date(ondutyFirstInDate.replace(' ', 'T'));
                                      if (!isNaN(dateObj.getTime())) {
                                        displayFirstInTime = String(dateObj.getHours()).padStart(2, '0') + ':' + String(dateObj.getMinutes()).padStart(2, '0');
                                      }
                                    }
                                  } catch (e) {
                                    console.error('Error extracting OnDuty FirstIn time:', e);
                                  }
                                }
                                
                                if (!displayLastOutTime && ondutyLastOutDate) {
                                  try {
                                    const timeMatch = String(ondutyLastOutDate).match(/\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
                                    if (timeMatch) {
                                      displayLastOutTime = timeMatch[1].padStart(2, '0') + ':' + timeMatch[2];
                                    } else {
                                      const dateObj = new Date(ondutyLastOutDate.replace(' ', 'T'));
                                      if (!isNaN(dateObj.getTime())) {
                                        displayLastOutTime = String(dateObj.getHours()).padStart(2, '0') + ':' + String(dateObj.getMinutes()).padStart(2, '0');
                                      }
                                    }
                                  } catch (e) {
                                    console.error('Error extracting OnDuty LastOut time:', e);
                                  }
                                }
                              }
                              
                              // OD (Half Day) two-part display: 1) OnDuty applied time, 2) Real check-in/out
                              const odHalfDayRealFrom = rowRealFirstIn && rowRealFirstIn[colIdx] ? String(rowRealFirstIn[colIdx]).trim() : '';
                              const odHalfDayRealTo = rowRealLastOut && rowRealLastOut[colIdx] ? String(rowRealLastOut[colIdx]).trim() : '';
                              const odHalfDayAppliedTime = (status === 'OD-0.5' && odAppliedFirstInTime && odAppliedLastOutTime) ? `${odAppliedFirstInTime} - ${odAppliedLastOutTime}` : '';
                              const odHalfDayRealTime = (status === 'OD-0.5' && odHalfDayRealFrom && odHalfDayRealTo) ? `Check-in/out: ${odHalfDayRealFrom} - ${odHalfDayRealTo}` : '';

                              // LOH first-in / last-out (rounded per LOH model: first-in up, last-out down to :00/:30)
                              const lohFirstInTime = rowLohFirstIn && rowLohFirstIn[colIdx] ? String(rowLohFirstIn[colIdx]).trim() : '';
                              const lohLastOutTime = rowLohLastOut && rowLohLastOut[colIdx] ? String(rowLohLastOut[colIdx]).trim() : '';
                              const hasLohTimes = lohFirstInTime && lohLastOutTime;

                              // Build final time display
                              // CO: no time display. OD-0.5 uses two-part display above. OD (full): single range. Others: firstIn - lastOut
                              if (status === 'CO') {
                                finalTimeDisplay = ''; // No time display for Comp Off
                              } else if (status === 'OD-0.5') {
                                // OD (Half Day) uses odHalfDayAppliedTime and odHalfDayRealTime in JSX; fallback to single range if new API not available
                                if (displayFirstInTime && displayLastOutTime && !odHalfDayAppliedTime && !odHalfDayRealTime) {
                                  finalTimeDisplay = `${displayFirstInTime} - ${displayLastOutTime}`;
                                } else {
                                  finalTimeDisplay = '';
                                }
                              } else if (status === 'OD' || status === 'Present' || status === 'WO' || status === 'H') {
                                if (displayFirstInTime && displayLastOutTime) {
                                  finalTimeDisplay = `${displayFirstInTime} - ${displayLastOutTime}`;
                                } else if (displayFirstInTime) {
                                  finalTimeDisplay = displayFirstInTime;
                                } else if (displayLastOutTime) {
                                  finalTimeDisplay = displayLastOutTime;
                                }
                              } else {
                                // For other statuses (if any), also show times
                                if (displayFirstInTime && displayLastOutTime) {
                                  finalTimeDisplay = `${displayFirstInTime} - ${displayLastOutTime}`;
                                }
                              }
                              
                              // Inline colours for WO/H-with-times (export uses same via getMusterDateCellColors)
                              const { fgHex, fontHex } = getMusterDateCellColors(
                                status,
                                shiftType,
                                displayFirstInTime,
                                displayLastOutTime
                              );
                              const cellStyle = {
                                backgroundColor: `#${fgHex}`,
                                color: `#${fontHex}`,
                                fontWeight: 600,
                              };
                              
                              // Debug logging for OnDuty records
                              if (isOnDuty && status === 'Present') {
                                console.log(`OnDuty Present detected for ${empId} on ${data.dates && data.dates[colIdx] ? data.dates[colIdx] : 'N/A'}:`, {
                                  source,
                                  firstInTime,
                                  lastOutTime,
                                  displayFirstInTime,
                                  displayLastOutTime,
                                  finalTimeDisplay,
                                  rowFirstInExists: !!rowFirstIn,
                                  rowFirstInLength: rowFirstIn ? rowFirstIn.length : 0,
                                  rowLastOutExists: !!rowLastOut,
                                  rowLastOutLength: rowLastOut ? rowLastOut.length : 0,
                                  colIdx,
                                  ondutyFirstInDate: rowOndutyFirstIn && rowOndutyFirstIn[colIdx],
                                  ondutyLastOutDate: rowOndutyLastOut && rowOndutyLastOut[colIdx]
                                });
                              }
                              
                              return (
                                <td key={colIdx} className={`muster-date-col ${className}`.trim()} style={cellStyle}>
                                  <div className="muster-date-cell-inner" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                    <div>{display}</div>
                                    {shouldShowShiftText && shiftClass !== 'shift-third' && shiftClass !== 'shift-fourth' ? (
                                      <div style={{ fontSize: '11px', color: '#2f2f2f', marginTop: '2px', fontWeight: '600' }}>
                                        {shiftDisplayName}
                                      </div>
                                    ) : null}
                                    {/* OD (Half Day): two parts - OnDuty applied time, then Check-in/out (real times); else single line fallback */}
                                    {status === 'OD-0.5' && (odHalfDayAppliedTime || odHalfDayRealTime) ? (
                                      <>
                                        {odHalfDayAppliedTime && (
                                          <div style={{ fontSize: '13px', color: '#000', marginTop: '3px', fontWeight: '500' }}>
                                            {odHalfDayAppliedTime}
                                          </div>
                                        )}
                                        {odHalfDayRealTime && (
                                          <div style={{ fontSize: '12px', color: '#333', marginTop: '2px' }}>
                                            {odHalfDayRealTime}
                                          </div>
                                        )}
                                        {hasLohTimes && (
                                          <div style={{ fontSize: '12px', color: '#555', marginTop: '2px' }}>
                                            LOH: {lohFirstInTime} - {lohLastOutTime}
                                          </div>
                                        )}
                                      </>
                                    ) : finalTimeDisplay ? (
                                      <>
                                        <div style={{ fontSize: '13px', color: '#000', marginTop: '3px', fontWeight: '500' }}>
                                          {finalTimeDisplay}
                                        </div>
                                        {hasLohTimes && (
                                          <div style={{ fontSize: '12px', color: '#555', marginTop: '2px' }}>
                                            LOH: {lohFirstInTime} - {lohLastOutTime}
                                          </div>
                                        )}
                                      </>
                                    ) : null}
                                  </div>
                                </td>
                              );
                            })}
                            <td>{formattedTotalHours}</td>
                            <td>{formattedTotalLOH}</td>
                            <td>{formattedTotalOTHours}</td>
                            <td>
                              <input
                                type="number"
                                step="0.01"
                                className="muster-ot-adjust-input"
                                value={otAdjustments[String(empId)] ?? '0'}
                                onChange={(e) =>
                                  setOtAdjustments((prev) => ({
                                    ...prev,
                                    [String(empId)]: e.target.value,
                                  }))
                                }
                                placeholder="0"
                                title="Adjustment in hours (adds to OT Hours for Final OT Value)"
                              />
                            </td>
                            <td>{finalOtMuster.toFixed(2)}</td>
                            <td>{totalPresent}</td>
                            <td>{totalAbsent}</td>
                          </tr>
                        );
                      })}
                      {/* Total Row */}
                      <tr className="muster-total-row">
                        <td><strong>TOTAL</strong></td>
                        <td className="total-cell">-</td>
                        <td className="total-cell">-</td>
                        <td className="total-cell">-</td>
                        <td className="total-cell">-</td>
                        <td className="total-cell">-</td>
                        {(data.dates && Array.isArray(data.dates) ? data.dates : []).map((date, colIdx) => {
                          // Calculate total for each date column
                          const dateTotal = (data.muster && Array.isArray(data.muster)) ? data.muster.reduce((sum, rowStatuses) => {
                            if (!rowStatuses || !Array.isArray(rowStatuses)) return sum;
                            const status = rowStatuses[colIdx];
                            if (status === 'Present' || status === 'P') return sum + 1;
                            if (status === 'Half Day Present' || status === '0.5' || status === 0.5) return sum + 0.5;
                            return sum;
                          }, 0) : 0;
                          return (
                            <td key={colIdx} className="total-cell muster-date-col">
                              <strong>{dateTotal}</strong>
                            </td>
                          );
                        })}
                        {/* Total Hours, LOH, OT Hours, Adjust, Final OT - no column totals */}
                        <td className="total-cell">-</td>
                        <td className="total-cell">-</td>
                        <td className="total-cell">-</td>
                        <td className="total-cell">-</td>
                        <td className="total-cell">-</td>
                        {/* Total Present and Absent columns */}
                        <td className="total-cell">
                          <strong>
                            {(data.muster && Array.isArray(data.muster))
                              ? data.muster.reduce(
                                  (sum, rowStatuses) =>
                                    sum +
                                    countPresentDaysForMusterRow(rowStatuses, data.dates, { halfDayWeight: 0.5 }),
                                  0
                                )
                              : 0}
                          </strong>
                        </td>
                        <td className="total-cell">
                          <strong>
                            {(data.muster && Array.isArray(data.muster)) ? data.muster.reduce((sum, rowStatuses) => {
                              if (!rowStatuses || !Array.isArray(rowStatuses)) return sum;
                              return sum + rowStatuses.filter(s => s === 'Absent' || s === 'A').length;
                            }, 0) : 0}
                          </strong>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </main>
        </div>
      </div>
    </>
  );
}

export default Attendancemuster;
