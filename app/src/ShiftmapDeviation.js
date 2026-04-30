import React, { useState, useEffect, useMemo, useRef } from 'react';
import axios from 'axios';
import './App.css';
import './ShiftmapDeviation.css';
import './shift.css';
import { useLocation, Link } from 'react-router-dom';
import Button from './Button';
import HeaderBranding from './HeaderBranding';
import { getSidebarModulesForUser, resolveSidebarUserEmail } from './modulesConfig';
import * as XLSX from 'xlsx';
import {
  Users, Calendar, FileText, AlertTriangle, FolderOpen,
  ClipboardList, Building, Handshake, Landmark, Clock,
  Map, BarChart3, User, TrendingUp, TrendingDown,
  Activity, Plus, CheckCircle, Bell, Settings, LayoutDashboard, Home as HomeIcon,
  AlertOctagon, CreditCard, Shield, FileSignature, Search, Clock3, CalendarDays, Database,
  Download, Trash2
} from 'lucide-react';

// Helper function to format date as DD/MM/YYYY
function formatDateDDMMYYYY(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr;
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

// Helper function to normalize date to YYYY-MM-DD format
function normalizeDateToYYYYMMDD(dateStr) {
  if (!dateStr) return '';
  const str = String(dateStr).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  const dmyMatch = str.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);
  if (dmyMatch) {
    const [, day, month, year] = dmyMatch;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  const ymdMatch = str.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/);
  if (ymdMatch) {
    const [, year, month, day] = ymdMatch;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  const date = new Date(str);
  if (!isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  return '';
}

// Helper: get deviation status from assigned shift and first-in time
function getDeviationStatus(assignedShift, firstIn) {
  if (!firstIn || firstIn === '-' || firstIn === '') return 'No Check-in';
  const assigned = (assignedShift || '').trim();
  if (!assigned) return 'No Check-in';
  const getHourMinute = (time) => {
    if (!time) return '';
    const parts = String(time).split(':');
    return parts.length >= 2 ? `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}` : time;
  };
  const isInWindow = (time, start, end) => {
    if (!time) return false;
    const [h, m] = time.split(':').map(Number);
    const t = (h || 0) * 60 + (m || 0);
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    return t >= (sh * 60 + sm) && t <= (eh * 60 + em);
  };
  const firstInHM = getHourMinute(firstIn);
  const upper = assigned.toUpperCase();
  const GENERAL_WINDOW = { start: '07:25', end: '17:55' };
  const FIRST_SHIFT_WINDOW = { start: '06:00', end: '14:00' };
  const SECOND_SHIFT_WINDOW = { start: '14:00', end: '22:00' };
  if (upper === 'GENERAL') {
    return isInWindow(firstInHM, GENERAL_WINDOW.start, GENERAL_WINDOW.end) ? 'General' : 'No Match';
  }
  if (upper === '1ST SHIFT') {
    return isInWindow(firstInHM, FIRST_SHIFT_WINDOW.start, FIRST_SHIFT_WINDOW.end) ? '1st Shift' : 'No Match';
  }
  if (upper === '2ND SHIFT') {
    return isInWindow(firstInHM, SECOND_SHIFT_WINDOW.start, SECOND_SHIFT_WINDOW.end) ? '2nd Shift' : 'No Match';
  }
  if (upper === 'H' || upper === 'WO' || upper === 'HOUSEKEEPING') return 'Worked';
  return isInWindow(firstInHM, GENERAL_WINDOW.start, GENERAL_WINDOW.end) ? 'General' : 'No Match';
}

// Helper function to generate date range array
function getDateRange(startDate, endDate) {
  if (!startDate || !endDate) return [];
  const normalizedStart = normalizeDateToYYYYMMDD(startDate);
  const normalizedEnd = normalizeDateToYYYYMMDD(endDate);
  if (!normalizedStart || !normalizedEnd) return [];
  const dates = [];
  const [startYear, startMonth, startDay] = normalizedStart.split('-').map(Number);
  const [endYear, endMonth, endDay] = normalizedEnd.split('-').map(Number);
  const start = new Date(startYear, startMonth - 1, startDay);
  const end = new Date(endYear, endMonth - 1, endDay);
  const current = new Date(start);
  while (current <= end) {
    const year = current.getFullYear();
    const month = String(current.getMonth() + 1).padStart(2, '0');
    const day = String(current.getDate()).padStart(2, '0');
    dates.push(`${year}-${month}-${day}`);
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

function ShiftmapDeviation({ userRole = 'App Administrator', userEmail = null }) {
  const userEmailFromStorage = localStorage.getItem('userEmail') || null;
  const finalUserEmail = userEmail || userEmailFromStorage;
  const finalUserRole = userRole || localStorage.getItem('userRole') || 'App Administrator';
  const location = useLocation();

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

  const userContractor = finalUserEmail ? emailContractorMap[finalUserEmail] : null;
  const shouldFilterByContractor = finalUserRole === 'App User' && userContractor;

  const [expandedMenus, setExpandedMenus] = useState({});
  const [showSidebarMenu, setShowSidebarMenu] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [schedules, setSchedules] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [uniqueEmployeesFromSchedule, setUniqueEmployeesFromSchedule] = useState([]);
  const [musterData, setMusterData] = useState({}); // { [employeeCode]: { [date]: { firstIn, lastOut } } }
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const fileInputRef = useRef(null);
  const [selectedEmployeeCodes, setSelectedEmployeeCodes] = useState([]);
  const [deletingSelected, setDeletingSelected] = useState(false);

  const modulesToShow = useMemo(
    () => getSidebarModulesForUser(resolveSidebarUserEmail(userEmail), userRole),
    [userEmail, userRole]
  );

  useEffect(() => {
    if (location.pathname === '/shiftmapdeviation') {
      const reportsMenuIndex = modulesToShow.findIndex((m) => m.label === 'Reports' && m.children);
      if (reportsMenuIndex !== -1) {
        setExpandedMenus((prev) => ({ ...prev, [reportsMenuIndex]: true }));
      }
    }
  }, [location.pathname]);

  const toggleMenu = (index) => {
    setExpandedMenus((prev) => ({ ...prev, [index]: !prev[index] }));
  };

  const recentActivities = [
    { icon: <User size={20} />, title: 'New Employee Added', description: 'John Doe joined the development team', time: '2 hours ago' },
    { icon: <BarChart3 size={20} />, title: 'Monthly Report Generated', description: 'Contractor performance report is ready', time: '4 hours ago' },
    { icon: <CheckCircle size={20} />, title: 'Contract Approved', description: 'ABC Construction contract approved', time: '6 hours ago' },
    { icon: <Bell size={20} />, title: 'System Update', description: 'Payroll Management System updated to version 2.1', time: '1 day ago' },
    { icon: <Plus size={20} />, title: 'New Application', description: 'Candidate applied for senior position', time: '2 days ago' },
  ];

  useEffect(() => {
    const fetchEmployees = async () => {
      try {
        const userRoleParam = finalUserRole ? `userRole=${encodeURIComponent(finalUserRole)}` : '';
        const userEmailParam = finalUserEmail ? `userEmail=${encodeURIComponent(finalUserEmail)}` : '';
        const queryParams = [userRoleParam, userEmailParam].filter(Boolean).join('&');
        const url = queryParams ? `/server/cms_function/employees?${queryParams}` : '/server/cms_function/employees';
        const response = await axios.get(url);
        if (response.data.status === 'success') {
          setEmployees(response.data.data.employees || []);
        }
      } catch (err) {
        console.error('Error fetching employees:', err);
      }
    };
    fetchEmployees();
  }, [finalUserRole, finalUserEmail]);

  const fetchSchedules = async () => {
    if (!startDate || !endDate) {
      setSchedules([]);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({
        ...(finalUserRole && { userRole: finalUserRole }),
        ...(finalUserEmail && { userEmail: finalUserEmail }),
        startDate,
        endDate,
      });
      const response = await axios.get(`/server/newshiftmap_function/newshiftmaps?${params.toString()}`);
      if (response.data.status === 'success') {
        const fetchedSchedules = response.data.data.schedules || [];
        const uniqueEmployees = response.data.data.uniqueEmployees || [];
        setSchedules(fetchedSchedules);
        setUniqueEmployeesFromSchedule(uniqueEmployees);
      } else {
        setError(response.data.message || 'Failed to fetch schedules');
      }
    } catch (err) {
      console.error('Error fetching schedules:', err);
      setError(err.response?.data?.message || 'Failed to fetch schedules');
    } finally {
      setLoading(false);
    }
  };

  const fetchMuster = async () => {
    if (!startDate || !endDate) {
      setMusterData({});
      return;
    }
    try {
      const params = new URLSearchParams({
        startDate,
        endDate,
        source: 'both',
        ...(finalUserRole && { userRole: finalUserRole }),
        ...(finalUserEmail && { userEmail: finalUserEmail }),
      });
      const response = await fetch(`/server/attendance_muster_function?${params.toString()}`);
      const result = await response.json();
      if (!response.ok || !result) {
        setMusterData({});
        return;
      }
      const dates = result.dates || [];
      const employeesList = result.employees || [];
      const firstInRows = result.firstIn || [];
      const lastOutRows = result.lastOut || [];
      const idToCode = {};
      (employees || []).forEach((emp) => {
        if (emp.id != null) idToCode[String(emp.id)] = String(emp.employeeCode || emp.id).trim();
        if (emp.employeeCode) idToCode[String(emp.employeeCode)] = String(emp.employeeCode).trim();
      });
      const byCodeAndDate = {};
      employeesList.forEach((empIdOrCode, rowIdx) => {
        const raw = String(empIdOrCode).trim();
        const employeeCode = idToCode[raw] || raw;
        const firstInRow = firstInRows[rowIdx];
        const lastOutRow = lastOutRows[rowIdx];
        if (!byCodeAndDate[employeeCode]) byCodeAndDate[employeeCode] = {};
        dates.forEach((date, colIdx) => {
          const dateKey = normalizeDateToYYYYMMDD(date) || date;
          const firstIn = firstInRow && (Array.isArray(firstInRow) ? firstInRow[colIdx] : firstInRow);
          const lastOut = lastOutRow && (Array.isArray(lastOutRow) ? lastOutRow[colIdx] : lastOutRow);
          const fi = firstIn != null && firstIn !== '' ? String(firstIn).trim() : null;
          const lo = lastOut != null && lastOut !== '' ? String(lastOut).trim() : null;
          let fiTime = fi;
          let loTime = lo;
          if (fi && fi.length > 8) {
            const t = fi.indexOf(' ') >= 0 ? fi.split(' ')[1] : fi;
            fiTime = t && /^\d{1,2}:\d{2}/.test(t) ? t.slice(0, 5) : fi;
          }
          if (lo && lo.length > 8) {
            const t = lo.indexOf(' ') >= 0 ? lo.split(' ')[1] : lo;
            loTime = t && /^\d{1,2}:\d{2}/.test(t) ? t.slice(0, 5) : lo;
          }
          byCodeAndDate[employeeCode][dateKey] = { firstIn: fiTime || '-', lastOut: loTime || '-' };
        });
      });
      setMusterData(byCodeAndDate);
    } catch (err) {
      console.error('Error fetching muster:', err);
      setMusterData({});
    }
  };

  useEffect(() => {
    if (startDate && endDate) fetchSchedules();
  }, [startDate, endDate, finalUserRole, finalUserEmail]);

  useEffect(() => {
    if (startDate && endDate) fetchMuster();
  }, [startDate, endDate, finalUserRole, finalUserEmail]);

  const handleImport = async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    setImporting(true);
    setImportError('');
    setSuccessMessage('');
    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet);
      if (jsonData.length === 0) throw new Error('Excel file is empty');

      const parseDateColumn = (dateStr) => {
        if (!dateStr) return null;
        const str = String(dateStr).trim().replace(/^[^0-9]+/, '');
        const match = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (match) {
          const [, day, month, year] = match;
          return `${year}-${day.padStart(2, '0')}-${month.padStart(2, '0')}`;
        }
        return null;
      };

      const validShiftNames = ['1st Shift', 'General', '2nd Shift'];
      const allHeaders = Object.keys(jsonData[0] || {});
      const dateColumns = [];
      allHeaders.forEach((header) => {
        const parsedDate = parseDateColumn(header);
        if (parsedDate) dateColumns.push({ header, date: parsedDate });
      });

      const allShiftValues = new Set();
      jsonData.forEach((row) => {
        dateColumns.forEach((dateCol) => {
          const shiftType = row[dateCol.header];
          if (shiftType && String(shiftType).trim()) allShiftValues.add(String(shiftType).trim());
        });
      });
      const invalidShifts = [];
      allShiftValues.forEach((shiftValue) => {
        const matched = validShiftNames.find((n) => n.toLowerCase() === shiftValue.toLowerCase());
        if (matched && matched !== shiftValue) invalidShifts.push({ found: shiftValue, expected: matched });
      });
      if (invalidShifts.length > 0) {
        throw new Error(
          invalidShifts.map((i) => `"${i.found}" should be "${i.expected}"`).join('. ')
        );
      }

      const schedulesToImport = [];
      jsonData.forEach((row) => {
        let employeeCode = row['Employ'] || row['EmployeeCode'] || row['Employee Code'] || row['EMPLOYEE CODE'];
        if (!employeeCode && allHeaders.length) {
          const employCols = allHeaders.filter((h) => h.toLowerCase().includes('employ'));
          if (employCols.length >= 1) employeeCode = row[employCols[0]];
        }
        let employeeName = row['Employee Name'] || row['EmployeeName'] || row['Name'] || row['EMPLOYEE NAME'];
        if (!employeeName && allHeaders.length) {
          const employCols = allHeaders.filter((h) => h.toLowerCase().includes('employ'));
          if (employCols.length >= 2) employeeName = row[employCols[1]];
        }
        let contractor = row['Contra'] || row['Contractor'] || row['ContractorName'] || row['CONTRACTOR'];
        if (!employeeCode) return;
        dateColumns.forEach((dateCol) => {
          const shiftType = row[dateCol.header];
          if (shiftType && String(shiftType).trim()) {
            schedulesToImport.push({
              employeeCode: String(employeeCode).trim(),
              employeeName: employeeName ? String(employeeName).trim() : null,
              contractor: contractor ? String(contractor).trim() : null,
              shiftDate: dateCol.date,
              shiftType: String(shiftType).trim(),
            });
          }
        });
      });

      if (schedulesToImport.length === 0) throw new Error('No valid schedule data found in Excel file');

      const response = await axios.post('/server/newshiftmap_function/newshiftmaps/bulk-import', {
        schedules: schedulesToImport,
      });
      if (response.data.status === 'success') {
        const { successful, updated, failed } = response.data.data;
        setSuccessMessage(`Import successful! Created: ${successful}, Updated: ${updated}, Failed: ${failed}`);
        if (startDate && endDate) await fetchSchedules();
      } else {
        throw new Error(response.data.message || 'Import failed');
      }
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err) {
      console.error('Import error:', err);
      setImportError(err.response?.data?.message || err.message || 'Failed to import Excel file');
    } finally {
      setImporting(false);
    }
  };

  const groupedSchedules = useMemo(() => {
    if (!startDate || !endDate) return {};
    const grouped = {};
    const dateRange = getDateRange(startDate, endDate);
    const normalizeContractor = (c) => (c ? String(c).trim().toLowerCase().replace(/\s+/g, ' ') : '');
    const contractorsMatch = (c1, c2) => {
      if (!c1 || !c2) return false;
      const n1 = normalizeContractor(c1);
      const n2 = normalizeContractor(c2);
      if (n1 === n2) return true;
      if (n1.includes(n2) || n2.includes(n1)) return Math.min(n1.length, n2.length) >= 5;
      return false;
    };

    uniqueEmployeesFromSchedule.forEach((emp) => {
      if (shouldFilterByContractor && userContractor && !contractorsMatch(emp.contractor, userContractor)) return;
      const key = String(emp.employeeCode || '').trim();
      if (key && !grouped[key]) {
        grouped[key] = {
          employeeCode: emp.employeeCode,
          employeeName: emp.employeeName,
          contractor: emp.contractor,
          shifts: {},
          recordIds: {},
        };
      }
    });

    schedules.forEach((schedule) => {
      if (shouldFilterByContractor && userContractor && !contractorsMatch(schedule.contractor, userContractor)) return;
      const key = String(schedule.employeeCode || '').trim() || 'unknown';
      if (!grouped[key]) {
        grouped[key] = {
          employeeCode: schedule.employeeCode,
          employeeName: schedule.employeeName,
          contractor: schedule.contractor,
          shifts: {},
          recordIds: {},
        };
      }
      if (!grouped[key].recordIds) grouped[key].recordIds = {};
      if (!grouped[key].shifts) grouped[key].shifts = {};
      if (dateRange.includes(schedule.shiftDate)) {
        grouped[key].shifts[schedule.shiftDate] = schedule.shiftType;
        if (schedule.id != null && schedule.id !== '') grouped[key].recordIds[schedule.shiftDate] = String(schedule.id);
      }
    });

    Object.keys(grouped).forEach((key) => {
      dateRange.forEach((date) => {
        if (!grouped[key].shifts[date]) grouped[key].shifts[date] = null;
        if (!grouped[key].recordIds) grouped[key].recordIds = {};
      });
    });

    const sortedKeys = Object.keys(grouped).sort((a, b) => (parseInt(a) || 0) - (parseInt(b) || 0));
    const sortedGrouped = {};
    sortedKeys.forEach((k) => (sortedGrouped[k] = grouped[k]));
    return sortedGrouped;
  }, [schedules, startDate, endDate, uniqueEmployeesFromSchedule, shouldFilterByContractor, userContractor]);

  const dateColumns = startDate && endDate ? getDateRange(startDate, endDate) : [];
  const selectedSet = useMemo(
    () => new Set(selectedEmployeeCodes.map((c) => String(c).trim()).filter(Boolean)),
    [selectedEmployeeCodes]
  );

  const getGroupIdsForDateRange = (group) => {
    const ids = dateColumns.map((d) => group?.recordIds?.[d]).filter(Boolean).map(String);
    return Array.from(new Set(ids));
  };

  const toggleEmployeeSelected = (empCode) => {
    const code = String(empCode || '').trim();
    if (!code) return;
    setSelectedEmployeeCodes((prev) => {
      const set = new Set((prev || []).map(String).filter(Boolean));
      if (set.has(code)) set.delete(code);
      else set.add(code);
      return Array.from(set);
    });
  };

  const clearSelection = () => setSelectedEmployeeCodes([]);

  const handleDeleteSelected = async () => {
    if (deletingSelected || !startDate || !endDate) return;
    const groups = Object.values(groupedSchedules || {});
    const ids = [];
    selectedSet.forEach((empCode) => {
      const group = groups.find((g) => String(g?.employeeCode || '').trim() === empCode);
      if (group) ids.push(...getGroupIdsForDateRange(group));
    });
    const uniqueIds = Array.from(new Set(ids));
    if (uniqueIds.length === 0) {
      setError('No shift schedule records found to delete for the selected employees in the selected date range.');
      setTimeout(() => setError(''), 4000);
      return;
    }
    if (!window.confirm(`Delete ${uniqueIds.length} shift schedule record(s) for selected employee(s)?`)) return;
    setDeletingSelected(true);
    setError('');
    setSuccessMessage('');
    try {
      const resp = await axios.delete('/server/newshiftmap_function/newshiftmaps', { data: { ids: uniqueIds } });
      if (resp?.data?.status !== 'success') throw new Error(resp?.data?.message || 'Delete failed');
      setSchedules((prev) => (Array.isArray(prev) ? prev.filter((s) => !uniqueIds.includes(String(s.id))) : prev));
      setSuccessMessage(`Deleted ${uniqueIds.length} record(s).`);
      setTimeout(() => setSuccessMessage(''), 3000);
      clearSelection();
      await fetchSchedules();
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || 'Failed to delete shift schedules.');
      setTimeout(() => setError(''), 5000);
    } finally {
      setDeletingSelected(false);
    }
  };

  const handleExportExcel = () => {
    if (!startDate || !endDate || Object.keys(groupedSchedules).length === 0) {
      setError('No data to export. Please select a date range and ensure data is loaded.');
      return;
    }
    try {
      const exportData = [];
      const headerRow = ['Employee Code', 'Employee Name', 'Contractor'];
      dateColumns.forEach((date) => headerRow.push(formatDateDDMMYYYY(date)));
      exportData.push(headerRow);
      Object.values(groupedSchedules).forEach((group) => {
        const row = [group.employeeCode || '', group.employeeName || '', group.contractor || ''];
        dateColumns.forEach((date) => row.push(group.shifts[date] || '-'));
        exportData.push(row);
      });
      const ws = XLSX.utils.aoa_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Shiftmap Deviation');
      const colWidths = [{ wch: 15 }, { wch: 25 }, { wch: 30 }];
      dateColumns.forEach(() => colWidths.push({ wch: 12 }));
      ws['!cols'] = colWidths;
      const startF = formatDateDDMMYYYY(startDate).replace(/\//g, '-');
      const endF = formatDateDDMMYYYY(endDate).replace(/\//g, '-');
      XLSX.writeFile(wb, `Shiftmap_Deviation_${startF}_to_${endF}.xlsx`);
      setSuccessMessage('Shiftmap deviation exported successfully.');
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (err) {
      setError('Failed to export to Excel. Please try again.');
      setTimeout(() => setError(''), 5000);
    }
  };

  return (
    <>
      <div className="cms-background">
        <div className="floating-shape"></div>
        <div className="floating-shape"></div>
        <div className="floating-shape"></div>
        <div className="floating-shape"></div>
      </div>

      <div className="cms-dashboard-root">
        <nav className="cms-sidebar">
          <div className="cms-sidebar-header">
            <div className="cms-header-content">
              <div className="cms-logo-section">
                <div className="cms-menu-toggle" onClick={() => setShowSidebarMenu(!showSidebarMenu)}>
                  <div className="cms-three-dots">
                    <span></span><span></span><span></span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="cms-nav">
            {modulesToShow.map((item, idx) =>
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
                    {item.children.map((child) => (
                      <Link
                        to={child.path}
                        key={child.label}
                        className={`cms-nav-child ${location.pathname === child.path ? 'active' : ''}`}
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
                  className={`cms-nav-item ${location.pathname === item.path ? 'active' : ''} ${['/loh-report', '/onduty', '/grace', '/compoff', '/calendar'].includes(item.path) ? 'clock-color-icon' : ''}`}
                  data-nav-path={item.path}
                  key={item.label}
                >
                  <span className="cms-nav-icon">{item.icon}</span>
                  <span className="cms-nav-label">{item.label}</span>
                </Link>
              )
            )}
          </div>

          <div className="cms-user-info">
            <img src="https://images.pexels.com/photos/2379004/pexels-photo-2379004.jpeg?auto=compress&cs=tinysrgb&w=150" alt="User" className="cms-user-avatar" />
            <div className="cms-user-details">
              <h4>Admin User</h4>
              <p>{finalUserRole || 'App Administrator'}</p>
            </div>
          </div>
        </nav>

        <div className="cms-main-content">
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
                <img src="https://images.pexels.com/photos/2379004/pexels-photo-2379004.jpeg?auto=compress&cs=tinysrgb&w=150" alt="User" className="cms-user-avatar" />
                <div className="cms-logout-icon">
                  <Button title="" className="cms-logout-btn" />
                </div>
              </div>
            </div>
          </header>

          {showNotifications && (
            <div className="cms-notification-overlay" onClick={() => setShowNotifications(false)}>
              <div className="cms-notification-popup" onClick={(e) => e.stopPropagation()}>
                <div className="cms-notification-header">
                  <h3>Recent Activity</h3>
                  <button className="cms-close-btn" onClick={() => setShowNotifications(false)}>×</button>
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

          <main className="cms-dashboard-content">
            <div className="shiftmapdeviation-card-container">
              <div className="shiftmapdeviation-header">
                <h2 className="shiftmapdeviation-title">
                  <AlertTriangle size={28} />
                  Shiftmap Deviation
                </h2>
                <p className="shiftmapdeviation-subtitle">View or manage shift map deviations</p>
              </div>

              {error && (
                <div className="alert alert-error">
                  <span className="alert-icon">⚠️</span>
                  {error}
                </div>
              )}
              {successMessage && (
                <div className="alert alert-success">
                  <span className="alert-icon">✅</span>
                  {successMessage}
                </div>
              )}
              {importError && (
                <div className="alert alert-error">
                  <span className="alert-icon">⚠️</span>
                  Import Error: {importError}
                </div>
              )}

              <div className="shiftmapdeviation-date-filter">
                <div className="shiftmapdeviation-date-filter-left">
                  <div className="date-input-group">
                    <label>Start Date:</label>
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="shiftmapdeviation-date-input"
                    />
                  </div>
                  <div className="date-input-group">
                    <label>End Date:</label>
                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="shiftmapdeviation-date-input"
                    />
                  </div>
                </div>
                <div className="shiftmapdeviation-date-filter-right">
                  {finalUserRole === 'App Administrator' && (
                    <>
                      <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleImport}
                        accept=".xlsx,.xls"
                        className="file-input-hidden"
                      />
                      <button
                        className="import-btn"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={importing || !startDate || !endDate}
                        title="Import from Excel"
                      >
                        {importing ? 'Importing...' : 'Import Excel'}
                      </button>
                    </>
                  )}
                  <button
                    className={`import-btn export-excel-btn ${finalUserRole !== 'App Administrator' ? 'export-excel-btn-first' : ''}`}
                    onClick={handleExportExcel}
                    disabled={!startDate || !endDate || Object.keys(groupedSchedules).length === 0}
                    title="Export to Excel"
                  >
                    Export Excel
                    <Download size={22} className="export-excel-icon" />
                  </button>
                  {finalUserRole === 'App Administrator' && (
                    <button
                      className="import-btn delete-selected-btn"
                      onClick={handleDeleteSelected}
                      disabled={deletingSelected || selectedSet.size === 0 || !startDate || !endDate}
                      title={selectedSet.size === 0 ? 'Select rows using checkboxes to delete' : 'Delete selected rows'}
                    >
                      <Trash2 size={22} />
                    </button>
                  )}
                </div>
              </div>

              {startDate && endDate && (
                <div className="shiftmapdeviation-table-container">
                  {loading ? (
                    <div className="shiftmapdeviation-loading-container">
                      <div className="shiftmapdeviation-loading-spinner"></div>
                      <p className="shiftmapdeviation-loading-text">Loading schedules...</p>
                    </div>
                  ) : (
                    <table className="shiftmapdeviation-table shiftmapdeviation-table-with-subcols">
                      <thead>
                        <tr className="shiftmapdeviation-thead-row-dates">
                          {finalUserRole === 'App Administrator' && (
                            <th rowSpan={2} className="th-select" title="Select rows">
                              <input
                                type="checkbox"
                                className="checkbox-cell"
                                checked={selectedSet.size > 0 && selectedSet.size === Object.keys(groupedSchedules || {}).length}
                                onChange={(e) => {
                                  if (!e.target.checked) clearSelection();
                                  else {
                                    const allCodes = Object.values(groupedSchedules || {})
                                      .map((g) => String(g?.employeeCode || '').trim())
                                      .filter(Boolean);
                                    setSelectedEmployeeCodes(Array.from(new Set(allCodes)));
                                  }
                                }}
                                disabled={deletingSelected}
                              />
                            </th>
                          )}
                          <th rowSpan={2}>Employee Code</th>
                          <th rowSpan={2}>Employee Name</th>
                          <th rowSpan={2}>Contractor</th>
                          {dateColumns.map((date) => (
                            <th key={date} colSpan={4} className="th-date-group">
                              {formatDateDDMMYYYY(date)}
                            </th>
                          ))}
                        </tr>
                        <tr className="shiftmapdeviation-thead-row-subcols">
                          {dateColumns.map((date) => (
                            <React.Fragment key={date}>
                              <th className="th-subcol">Shift</th>
                              <th className="th-subcol">FirstIN</th>
                              <th className="th-subcol">LastOUT</th>
                              <th className="th-subcol">Deviation</th>
                            </React.Fragment>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {Object.keys(groupedSchedules).length > 0 ? (
                          Object.values(groupedSchedules).map((group, idx) => (
                            <tr key={idx}>
                              {finalUserRole === 'App Administrator' && (
                                <td className="td-select">
                                  <input
                                    type="checkbox"
                                    className="checkbox-cell"
                                    checked={selectedSet.has(String(group.employeeCode || '').trim())}
                                    onChange={() => toggleEmployeeSelected(group.employeeCode)}
                                    disabled={deletingSelected}
                                  />
                                </td>
                              )}
                              <td>{group.employeeCode}</td>
                              <td>{group.employeeName || '-'}</td>
                              <td>{group.contractor || '-'}</td>
                              {dateColumns.map((date) => {
                                const shiftType = group.shifts[date] || '-';
                                const muster = musterData[String(group.employeeCode || '').trim()]?.[date];
                                const firstIn = muster?.firstIn ?? '-';
                                const lastOut = muster?.lastOut ?? '-';
                                const deviation = getDeviationStatus(shiftType, firstIn);
                                const shiftClass = shiftType !== '-' ? `shift-type-${String(shiftType).toLowerCase().replace(/\s+/g, '-')}` : 'shift-type-empty';
                                const deviationClass = deviation === 'No Match' || deviation === 'No Check-in' ? 'deviation-mismatch' : deviation === '1st Shift' ? 'deviation-1st' : deviation === 'General' ? 'deviation-general' : '';
                                return (
                                  <React.Fragment key={date}>
                                    <td className={`td-subcol ${shiftClass}`}>{shiftType}</td>
                                    <td className="td-subcol td-firstin">{firstIn}</td>
                                    <td className="td-subcol td-lastout">{lastOut}</td>
                                    <td className={`td-subcol td-deviation ${deviationClass}`}>{deviation}</td>
                                  </React.Fragment>
                                );
                              })}
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td
                              colSpan={(finalUserRole === 'App Administrator' ? 4 : 3) + dateColumns.length * 4}
                              className="td-empty"
                            >
                              No schedule data found. Import data using the Import Excel button above.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  )}
                </div>
              )}

              {(!startDate || !endDate) && (
                <div className="shiftmapdeviation-placeholder">
                  <AlertTriangle size={64} />
                  <p>Please select a start date and end date to view the shiftmap deviation</p>
                </div>
              )}
            </div>
          </main>
        </div>
      </div>
    </>
  );
}

export default ShiftmapDeviation;
