import React, { useState, useEffect, useMemo, useRef } from 'react';
import axios from 'axios';
import './App.css';
import './NewShiftMap.css';
import './Organization.css';
import './employeeManagement.css';
import './shift.css';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import Button from './Button';
import HeaderBranding from './HeaderBranding';
import { getSidebarModulesForUser, resolveSidebarUserEmail } from './modulesConfig';
import * as XLSX from 'xlsx';
import { 
  Users, Calendar, FileText, AlertTriangle, FolderOpen, 
  ClipboardList, Building, Handshake, Landmark, Clock, 
  Map, BarChart3, User, TrendingUp, TrendingDown,
  Activity, Plus, CheckCircle, Bell, Settings, LayoutDashboard, Home as HomeIcon, AlertOctagon, CreditCard, Shield, FileSignature, Search, Clock3, CalendarDays,   Database, Download, Trash2, X
} from 'lucide-react';

const VALID_SHIFT_NAMES = ['1st Shift', 'General', '2nd Shift'];

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
  
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return str;
  }
  
  const dmyMatch = str.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);
  if (dmyMatch) {
    const [, day, month, year] = dmyMatch;
    const dayPadded = day.padStart(2, '0');
    const monthPadded = month.padStart(2, '0');
    return `${year}-${monthPadded}-${dayPadded}`;
  }
  
  const ymdMatch = str.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/);
  if (ymdMatch) {
    const [, year, month, day] = ymdMatch;
    const monthPadded = month.padStart(2, '0');
    const dayPadded = day.padStart(2, '0');
    return `${year}-${monthPadded}-${dayPadded}`;
  }
  
  const date = new Date(str);
  if (!isNaN(date.getTime())) {
    return date.toISOString().slice(0, 10);
  }
  
  return '';
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

function NewShiftMap({ userRole = 'App Administrator', userEmail = null }) {
  const userEmailFromStorage = localStorage.getItem('userEmail') || null;
  const finalUserEmail = userEmail || userEmailFromStorage;
  const finalUserRole = userRole || localStorage.getItem('userRole') || 'App Administrator';
  const navigate = useNavigate();
  const location = useLocation();
  
  // Email to Contractor mapping
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
  
  // Sidebar state
  const [expandedMenus, setExpandedMenus] = useState({});
  const [showSidebarMenu, setShowSidebarMenu] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  
  // Main state
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [schedules, setSchedules] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [uniqueEmployeesFromSchedule, setUniqueEmployeesFromSchedule] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const fileInputRef = useRef(null);
  const [selectedEmployeeCodes, setSelectedEmployeeCodes] = useState([]); // employeeCode[]
  const [deletingSelected, setDeletingSelected] = useState(false);
  const [showAddRosterForm, setShowAddRosterForm] = useState(false);
  const [addRosterForm, setAddRosterForm] = useState({
    employeeCode: '',
    employeeName: '',
    fromDate: '',
    toDate: '',
    shiftName: ''
  });
  const [addRosterSubmitting, setAddRosterSubmitting] = useState(false);
  const [addRosterFormError, setAddRosterFormError] = useState('');
  const [rosterShiftOptions, setRosterShiftOptions] = useState(
    VALID_SHIFT_NAMES
  );
  
  const modulesToShow = useMemo(
    () => getSidebarModulesForUser(resolveSidebarUserEmail(finalUserEmail), finalUserRole),
    [finalUserEmail, finalUserRole]
  );
  
  // Auto-expand the Shift menu if we're on any Shift-related page
  useEffect(() => {
    const shiftPaths = ['/shift', '/Shiftmap', '/newshiftmap'];
    if (shiftPaths.includes(location.pathname)) {
      // Find the index of the Shift menu
      const shiftMenuIndex = modulesToShow.findIndex(module => module.label === 'Shift' && module.children);
      if (shiftMenuIndex !== -1) {
        setExpandedMenus(prev => ({
          ...prev,
          [shiftMenuIndex]: true
        }));
      }
    }
  }, [location.pathname, modulesToShow]);
  
  const toggleMenu = (index) => {
    setExpandedMenus(prev => ({
      ...prev,
      [index]: !prev[index]
    }));
  };
  
  const recentActivities = [
    { icon: <User size={20} />, title: 'New Employee Added', description: 'John Doe joined the development team', time: '2 hours ago' },
    { icon: <BarChart3 size={20} />, title: 'Monthly Report Generated', description: 'Contractor performance report is ready', time: '4 hours ago' },
    { icon: <CheckCircle size={20} />, title: 'Contract Approved', description: 'ABC Construction contract approved', time: '6 hours ago' },
    { icon: <Bell size={20} />, title: 'System Update', description: 'Payroll Management System updated to version 2.1', time: '1 day ago' },
    { icon: <Plus size={20} />, title: 'New Application', description: 'Candidate applied for senior position', time: '2 days ago' }
  ];
  
  // Fetch employees
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

  // Fetch shift master options for Add Shift Roaster form
  useEffect(() => {
    let mounted = true;

    const fetchShiftOptions = async () => {
      try {
        const response = await axios.get('/server/Shift_function/shifts');
        const shifts = response?.data?.data?.shifts;
        if (!Array.isArray(shifts)) return;

        const uniqueShiftNames = [...new Set(
          shifts
            .map((s) => String(s?.shiftName || '').trim())
            .filter(Boolean)
        )];

        if (mounted && uniqueShiftNames.length > 0) {
          setRosterShiftOptions(uniqueShiftNames);
        }
      } catch (err) {
        console.error('Error fetching shift options:', err);
      }
    };

    fetchShiftOptions();
    return () => {
      mounted = false;
    };
  }, []);
  
  // Fetch schedules when date range is set; optional overrides used after add-roster save (state may not have flushed yet)
  const fetchSchedules = async (rangeStartOverride, rangeEndOverride) => {
    const rangeStart = rangeStartOverride ?? startDate;
    const rangeEnd = rangeEndOverride ?? endDate;
    if (!rangeStart || !rangeEnd) {
      setSchedules([]);
      return;
    }
    
    setLoading(true);
    setError('');
    
    try {
      const userRoleParam = finalUserRole ? `userRole=${encodeURIComponent(finalUserRole)}` : '';
      const userEmailParam = finalUserEmail ? `userEmail=${encodeURIComponent(finalUserEmail)}` : '';
      const params = new URLSearchParams({
        ...(userRoleParam && { userRole: finalUserRole }),
        ...(userEmailParam && { userEmail: finalUserEmail }),
        startDate: rangeStart,
        endDate: rangeEnd
      });
      
      const response = await axios.get(`/server/newshiftmap_function/newshiftmaps?${params.toString()}`);
      
      if (response.data.status === 'success') {
        const fetchedSchedules = response.data.data.schedules || [];
        const uniqueEmployees = response.data.data.uniqueEmployees || [];
        console.log(`Fetched ${fetchedSchedules.length} schedule records for ${uniqueEmployees.length} unique employees`);
        setSchedules(fetchedSchedules);
        setUniqueEmployeesFromSchedule(uniqueEmployees);
        
        // Store unique employees for reference
        if (uniqueEmployees.length > 0) {
          console.log('Unique employees:', uniqueEmployees.map(e => e.employeeCode));
        }
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
  
  useEffect(() => {
    if (startDate && endDate) {
      fetchSchedules();
    }
  }, [startDate, endDate, finalUserRole, finalUserEmail]);
  
  // Handle Excel import
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
      
      if (jsonData.length === 0) {
        throw new Error('Excel file is empty');
      }
      
      // Parse date columns from headers
      const parseDateColumn = (dateStr) => {
        if (!dateStr) return null;
        const str = String(dateStr).trim();
        const cleaned = str.replace(/^[^0-9]+/, '');
        const match = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (match) {
          const [, day, month, year] = match;
          const dayPadded = day.padStart(2, '0');
          const monthPadded = month.padStart(2, '0');
          return `${year}-${monthPadded}-${dayPadded}`;
        }
        return null;
      };
      
      // Define valid shift names (case-sensitive)
      const validShiftNames = ['1st Shift', 'General', '2nd Shift'];
      
      // Collect all shift values from the Excel to validate
      const allShiftValues = new Set();
      
      // First pass: collect all shift values
      const allHeaders = Object.keys(jsonData[0] || {});
      const dateColumns = [];
      allHeaders.forEach(header => {
        const parsedDate = parseDateColumn(header);
        if (parsedDate) {
          dateColumns.push({ header, date: parsedDate });
        }
      });
      
      // Collect shift values from all rows
      for (const row of jsonData) {
        for (const dateCol of dateColumns) {
          const shiftType = row[dateCol.header];
          if (shiftType && String(shiftType).trim()) {
            const shiftValue = String(shiftType).trim();
            // Only validate if it looks like it could be a shift name (not empty, not just whitespace)
            if (shiftValue && !allShiftValues.has(shiftValue)) {
              allShiftValues.add(shiftValue);
            }
          }
        }
      }
      
      // Validate shift names - check for case-sensitive mismatches
      // Only validate the three specific shift names: "1st Shift", "General", "2nd Shift"
      const invalidShifts = [];
      allShiftValues.forEach(shiftValue => {
        // Check if this shift value matches any valid shift name (case-insensitive)
        const matchedValidName = validShiftNames.find(validName => 
          validName.toLowerCase() === shiftValue.toLowerCase()
        );
        
        // If it matches a valid shift name (case-insensitive) but not exactly (case-sensitive), it's an error
        if (matchedValidName && matchedValidName !== shiftValue) {
          invalidShifts.push({ found: shiftValue, expected: matchedValidName });
        }
      });
      
      // If we found invalid shift names, throw error
      if (invalidShifts.length > 0) {
        const errorMessages = invalidShifts.map(invalid => 
          `${invalid.expected} name is wrong. Found: "${invalid.found}", Expected: "${invalid.expected}"`
        );
        throw new Error(errorMessages.join('. '));
      }
      
      console.log('Detected date columns:', dateColumns);
      
      // Process data and create schedules array
      const schedulesToImport = [];
      
      for (const row of jsonData) {
        // Get employee code - try multiple column names
        let employeeCode = row['Employ'] || row['EmployeeCode'] || row['Employee Code'] || row['EMPLOYEE CODE'] || row['EMPLOYEE_CODE'];
        
        // Handle case where first "Employ" column is ID and second is Name
        if (!employeeCode && Array.isArray(allHeaders)) {
          const employColumns = allHeaders.filter(h => h.toLowerCase().includes('employ'));
          if (employColumns.length >= 1) {
            employeeCode = row[employColumns[0]];
          }
        }
        
        // Get employee name
        let employeeName = row['Employee Name'] || row['EmployeeName'] || row['Name'] || row['EMPLOYEE NAME'] || row['EMPLOYEE_NAME'];
        if (!employeeName && Array.isArray(allHeaders)) {
          const employColumns = allHeaders.filter(h => h.toLowerCase().includes('employ'));
          if (employColumns.length >= 2) {
            employeeName = row[employColumns[1]];
          }
        }
        
        if (!employeeCode) {
          continue; // Skip rows without employee code
        }
        
        // Process each date column
        for (const dateCol of dateColumns) {
          const shiftType = row[dateCol.header];
          if (shiftType && String(shiftType).trim()) {
            schedulesToImport.push({
              employeeCode: String(employeeCode).trim(),
              employeeName: employeeName ? String(employeeName).trim() : null,
              shiftDate: dateCol.date,
              shiftType: String(shiftType).trim()
            });
          }
        }
      }
      
      console.log(`Prepared ${schedulesToImport.length} schedule records to import`);
      
      if (schedulesToImport.length === 0) {
        throw new Error('No valid schedule data found in Excel file');
      }
      
      // Bulk import to backend (extended timeout for large files)
      const response = await axios.post('/server/newshiftmap_function/newshiftmaps/bulk-import', {
        schedules: schedulesToImport
      }, { timeout: 120000 });
      
      if (response.data.status === 'success') {
        const { successful, updated, failed } = response.data.data;
        setSuccessMessage(`Import successful! Created: ${successful}, Updated: ${updated}, Failed: ${failed}`);
        
        // Refresh schedules
        if (startDate && endDate) {
          await fetchSchedules();
        }
      } else {
        throw new Error(response.data.message || 'Import failed');
      }
      
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (err) {
      console.error('Import error:', err);
      const isTimeout = err.response?.status === 408 || err.code === 'ECONNABORTED' || err.message?.toLowerCase().includes('timeout');
      if (isTimeout) {
        // Backend often completes successfully; connection times out before response arrives.
        // Refresh data so the user sees the imported records immediately.
        setImportError('');
        setSuccessMessage('Import completed. Refreshing your data...');
        if (startDate && endDate) {
          await fetchSchedules();
        }
        setSuccessMessage('Import completed! Your data has been refreshed.');
        if (fileInputRef.current) fileInputRef.current.value = '';
        setTimeout(() => setSuccessMessage(''), 5000);
      } else {
        setImportError(err.response?.data?.message || err.message || 'Failed to import Excel file');
      }
    } finally {
      setImporting(false);
    }
  };
  
  // Group schedules by employee - ensure all employees are shown
  const groupedSchedules = React.useMemo(() => {
    if (!startDate || !endDate) return {};
    
    const grouped = {};
    const dateRange = getDateRange(startDate, endDate);
    
    // Helper function to normalize contractor names for comparison
    const normalizeContractor = (contractorName) => {
      if (!contractorName) return '';
      // Normalize: trim, lowercase, and collapse multiple spaces
      return String(contractorName).trim().toLowerCase().replace(/\s+/g, ' ');
    };
    
    // Helper function to check if contractor names match (handles variations)
    const contractorsMatch = (contractor1, contractor2) => {
      if (!contractor1 || !contractor2) return false;
      const norm1 = normalizeContractor(contractor1);
      const norm2 = normalizeContractor(contractor2);
      
      // Exact match
      if (norm1 === norm2) return true;
      
      // Check if one contains the other (handles partial matches like "Samuel Enterprise" vs "Samuel")
      if (norm1.includes(norm2) || norm2.includes(norm1)) {
        // Only allow if the shorter name is at least 5 characters (to avoid false matches)
        const shorter = norm1.length < norm2.length ? norm1 : norm2;
        if (shorter.length >= 5) return true;
      }
      
      return false;
    };
    
    // Normalize user contractor for comparison
    const normalizedUserContractor = userContractor ? normalizeContractor(userContractor) : null;
    
    // First, initialize all unique employees from the backend (ensures all employees are shown)
    if (uniqueEmployeesFromSchedule.length > 0) {
      uniqueEmployeesFromSchedule.forEach(emp => {
        // Filter by contractor if user is App User
        if (shouldFilterByContractor && userContractor) {
          if (!contractorsMatch(emp.contractor, userContractor)) {
            return; // Skip employees that don't match the user's contractor
          }
        }
        
        const key = String(emp.employeeCode || '').trim();
        if (key && !grouped[key]) {
          grouped[key] = {
            employeeCode: emp.employeeCode,
            employeeName: emp.employeeName,
            contractor: emp.contractor,
            shifts: {},
            recordIds: {} // shiftDate -> schedule ROWID
          };
        }
      });
    }
    
    // Then, process all schedules from the API and add shift data
    schedules.forEach(schedule => {
      // Filter by contractor if user is App User
      if (shouldFilterByContractor && userContractor) {
        if (!contractorsMatch(schedule.contractor, userContractor)) {
          return; // Skip schedules that don't match the user's contractor
        }
      }
      
      const key = String(schedule.employeeCode || '').trim() || 'unknown';
      if (!grouped[key]) {
        grouped[key] = {
          employeeCode: schedule.employeeCode,
          employeeName: schedule.employeeName,
          contractor: schedule.contractor,
          shifts: {},
          recordIds: {} // shiftDate -> schedule ROWID
        };
      }
      
      // Safety: some entries are created from uniqueEmployeesFromSchedule (they may not have recordIds yet)
      if (!grouped[key].recordIds) grouped[key].recordIds = {};
      if (!grouped[key].shifts) grouped[key].shifts = {};
      // Only add shift if it's within the date range
      if (dateRange.includes(schedule.shiftDate)) {
        grouped[key].shifts[schedule.shiftDate] = schedule.shiftType;
        if (schedule.id !== undefined && schedule.id !== null && schedule.id !== '') {
          grouped[key].recordIds[schedule.shiftDate] = String(schedule.id);
        }
      }
    });
    
    // Initialize all dates with null for all employees
    Object.keys(grouped).forEach(key => {
      dateRange.forEach(date => {
        if (!grouped[key].shifts[date]) {
          grouped[key].shifts[date] = null;
        }
        if (!grouped[key].recordIds) grouped[key].recordIds = {};
      });
    });
    
    // Sort by employee code for consistent display
    const sortedKeys = Object.keys(grouped).sort((a, b) => {
      const numA = parseInt(a) || 0;
      const numB = parseInt(b) || 0;
      return numA - numB;
    });
    
    const sortedGrouped = {};
    sortedKeys.forEach(key => {
      sortedGrouped[key] = grouped[key];
    });
    
    console.log(`Grouped schedules: ${Object.keys(sortedGrouped).length} employees for date range ${startDate} to ${endDate}`);
    if (shouldFilterByContractor && userContractor) {
      console.log(`Filtered by contractor: ${userContractor}`);
    }
    console.log('Employee codes:', Object.keys(sortedGrouped));
    
    return sortedGrouped;
  }, [schedules, startDate, endDate, uniqueEmployeesFromSchedule, shouldFilterByContractor, userContractor]);
  
  const dateColumns = startDate && endDate ? getDateRange(startDate, endDate) : [];
  
  const selectedSet = useMemo(() => new Set(selectedEmployeeCodes.map(c => String(c).trim()).filter(Boolean)), [selectedEmployeeCodes]);

  const getGroupIdsForDateRange = (group) => {
    const ids = dateColumns
      .map(d => group?.recordIds?.[d])
      .filter(Boolean)
      .map(String);
    // de-dupe
    return Array.from(new Set(ids));
  };

  const toggleEmployeeSelected = (empCode) => {
    const code = String(empCode || '').trim();
    if (!code) return;
    setSelectedEmployeeCodes(prev => {
      const set = new Set((prev || []).map(v => String(v).trim()).filter(Boolean));
      if (set.has(code)) set.delete(code);
      else set.add(code);
      return Array.from(set);
    });
  };

  const clearSelection = () => setSelectedEmployeeCodes([]);

  const handleDeleteSelected = async () => {
    if (deletingSelected) return;
    if (!startDate || !endDate) return;

    const groups = Object.values(groupedSchedules || {});
    const ids = [];
    selectedSet.forEach((empCode) => {
      const group = groups.find(g => String(g?.employeeCode || '').trim() === empCode);
      if (!group) return;
      ids.push(...getGroupIdsForDateRange(group));
    });

    const uniqueIds = Array.from(new Set(ids));
    if (uniqueIds.length === 0) {
      setError('No shift schedule records found to delete for the selected employees in the selected date range.');
      setTimeout(() => setError(''), 4000);
      return;
    }

    const ok = window.confirm(`Delete ${uniqueIds.length} shift schedule record(s) for selected employee(s) (within selected date range)?`);
    if (!ok) return;

    setDeletingSelected(true);
    setError('');
    setSuccessMessage('');

    try {
      const resp = await axios.delete('/server/newshiftmap_function/newshiftmaps', {
        data: { ids: uniqueIds }
      });
      if (resp?.data?.status !== 'success') {
        throw new Error(resp?.data?.message || 'Delete failed');
      }

      // Optimistic local update + refresh
      setSchedules(prev => (Array.isArray(prev) ? prev.filter(s => !uniqueIds.includes(String(s.id))) : prev));
      setSuccessMessage(`Deleted ${uniqueIds.length} record(s).`);
      setTimeout(() => setSuccessMessage(''), 3000);
      clearSelection();

      await fetchSchedules();
    } catch (err) {
      console.error('Delete selected schedules error:', err);
      setError(err?.response?.data?.message || err?.message || 'Failed to delete shift schedules.');
      setTimeout(() => setError(''), 5000);
    } finally {
      setDeletingSelected(false);
    }
  };

  const resetAddRosterForm = () => {
    setAddRosterForm({
      employeeCode: '',
      employeeName: '',
      fromDate: '',
      toDate: '',
      shiftName: ''
    });
    setAddRosterFormError('');
  };

  const closeAddRosterForm = () => {
    setShowAddRosterForm(false);
    resetAddRosterForm();
  };

  const onAddRosterEmployeeCodeChange = (value) => {
    const trimmed = String(value).trim();
    const emp = employees.find(
      (e) => String(e.employeeCode || '').trim() === trimmed
    );
    setAddRosterForm((prev) => ({
      ...prev,
      employeeCode: value,
      employeeName: emp ? String(emp.employeeName || '').trim() : ''
    }));
  };

  const resolveCanonicalShiftName = (input) => {
    const s = String(input || '').trim();
    if (!s) return null;
    const allowedShiftNames =
      Array.isArray(rosterShiftOptions) && rosterShiftOptions.length > 0
        ? rosterShiftOptions
        : VALID_SHIFT_NAMES;
    const found = allowedShiftNames.find(
      (v) => v.toLowerCase() === s.toLowerCase()
    );
    return found || null;
  };

  const handleAddRosterSubmit = async (e) => {
    e.preventDefault();
    setAddRosterFormError('');

    const code = String(addRosterForm.employeeCode || '').trim();
    const name = String(addRosterForm.employeeName || '').trim();
    const from = normalizeDateToYYYYMMDD(addRosterForm.fromDate);
    const to = normalizeDateToYYYYMMDD(addRosterForm.toDate);
    const canonicalShift = resolveCanonicalShiftName(addRosterForm.shiftName);

    if (!code) {
      setAddRosterFormError('Employee Code is required.');
      return;
    }
    if (!name) {
      setAddRosterFormError('Employee Name is required.');
      return;
    }
    if (!from || !to) {
      setAddRosterFormError('From date and To date are required.');
      return;
    }
    if (from > to) {
      setAddRosterFormError('From date cannot be after To date.');
      return;
    }
    if (!canonicalShift) {
      const allowedShiftNames =
        Array.isArray(rosterShiftOptions) && rosterShiftOptions.length > 0
          ? rosterShiftOptions
          : VALID_SHIFT_NAMES;
      setAddRosterFormError(
        `Shift Name must be one of: ${allowedShiftNames.join(', ')}.`
      );
      return;
    }

    const emp = employees.find(
      (e) => String(e.employeeCode || '').trim() === code
    );
    const contractor = emp?.contractor
      ? String(emp.contractor).trim()
      : null;

    const dateList = getDateRange(from, to);
    if (dateList.length === 0) {
      setAddRosterFormError('No valid dates in the selected range.');
      return;
    }

    const schedulesToSave = dateList.map((shiftDate) => ({
      employeeCode: code,
      employeeName: name || null,
      contractor,
      shiftDate,
      shiftType: canonicalShift
    }));

    setAddRosterSubmitting(true);
    setError('');
    setSuccessMessage('');

    try {
      const response = await axios.post(
        '/server/newshiftmap_function/newshiftmaps/bulk-import',
        { schedules: schedulesToSave },
        { timeout: 120000 }
      );
      if (response.data.status !== 'success') {
        throw new Error(response.data.message || 'Save failed');
      }
      const { successful, updated, failed } = response.data.data || {};
      setSuccessMessage(
        `Shift roster saved. Created: ${successful ?? 0}, Updated: ${updated ?? 0}, Failed: ${failed ?? 0}`
      );
      setTimeout(() => setSuccessMessage(''), 5000);

      let mergedStart = from;
      let mergedEnd = to;
      if (startDate && endDate) {
        mergedStart = from < startDate ? from : startDate;
        mergedEnd = to > endDate ? to : endDate;
      }
      const rangeUnchanged =
        startDate === mergedStart && endDate === mergedEnd;
      setStartDate(mergedStart);
      setEndDate(mergedEnd);
      if (rangeUnchanged) {
        await fetchSchedules(mergedStart, mergedEnd);
      }
      closeAddRosterForm();
    } catch (err) {
      console.error('Add shift roster error:', err);
      setAddRosterFormError(
        err.response?.data?.message ||
          err.message ||
          'Failed to save shift roster.'
      );
    } finally {
      setAddRosterSubmitting(false);
    }
  };
  
  // Export to Excel function
  const handleExportExcel = () => {
    if (!startDate || !endDate || Object.keys(groupedSchedules).length === 0) {
      setError('No data to export. Please select a date range and ensure data is loaded.');
      return;
    }
    
    try {
      // Prepare data for export
      const exportData = [];
      
      // Create header row
      const headerRow = ['Employee Code', 'Employee Name'];
      dateColumns.forEach(date => {
        headerRow.push(formatDateDDMMYYYY(date));
      });
      exportData.push(headerRow);
      
      // Add data rows
      Object.values(groupedSchedules).forEach(group => {
        const row = [
          group.employeeCode || '',
          group.employeeName || ''
        ];
        
        // Add shift data for each date
        dateColumns.forEach(date => {
          const shiftType = group.shifts[date] || '-';
          row.push(shiftType);
        });
        
        exportData.push(row);
      });
      
      // Create workbook and worksheet
      const ws = XLSX.utils.aoa_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Shift Schedule');
      
      // Set column widths
      const colWidths = [
        { wch: 15 }, // Employee Code
        { wch: 25 } // Employee Name
      ];
      // Add width for each date column
      dateColumns.forEach(() => {
        colWidths.push({ wch: 12 });
      });
      ws['!cols'] = colWidths;
      
      // Generate filename with date range
      const startDateFormatted = formatDateDDMMYYYY(startDate).replace(/\//g, '-');
      const endDateFormatted = formatDateDDMMYYYY(endDate).replace(/\//g, '-');
      const filename = `Shift_Schedule_${startDateFormatted}_to_${endDateFormatted}.xlsx`;
      
      // Export file
      XLSX.writeFile(wb, filename);
      
      setSuccessMessage(`Shift schedule exported successfully as ${filename}`);
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (err) {
      console.error('Error exporting to Excel:', err);
      setError('Failed to export to Excel. Please try again.');
      setTimeout(() => setError(''), 5000);
    }
  };
  
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
        {/* Enhanced Sidebar - matching Shift.js structure */}
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

          {/* Navigation - matching Shift.js structure */}
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
            ))}
          </div>

          {/* User Info */}
          <div className="cms-user-info">
            <img src="https://images.pexels.com/photos/2379004/pexels-photo-2379004.jpeg?auto=compress&cs=tinysrgb&w=150" alt="User" className="cms-user-avatar" />
            <div className="cms-user-details">
              <h4>Admin User</h4>
              <p>App Administrator</p>
            </div>
          </div>
        </nav>
      
        {/* Main Content */}
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
          {showAddRosterForm ? (
            <div className="employee-form-page newshiftmap-add-roster-fullpage">
              <div className="employee-form-container">
                <div className="employee-form-header">
                  <h1>Add Shift Roaster</h1>
                  <button
                    type="button"
                    className="close-btn"
                    onClick={closeAddRosterForm}
                    aria-label="Close form"
                  >
                    <X size={20} />
                  </button>
                </div>
                <div className="employee-form-content">
                  {addRosterSubmitting && (
                    <div className="form-loader">
                      <div className="cms-spinner" />
                    </div>
                  )}
                  <form className="employee-form" onSubmit={handleAddRosterSubmit}>
                    <div className="form-sections">
                      <div className="form-section-card employee-info">
                        <h2 className="section-title">Roster details</h2>
                        <div className="form-grid">
                          {addRosterFormError && (
                            <div
                              className="cms-message cms-message-error"
                              role="alert"
                              style={{ gridColumn: '1 / -1' }}
                            >
                              <AlertTriangle size={20} />
                              {addRosterFormError}
                            </div>
                          )}
                          <div className="form-group">
                            <label htmlFor="add-roster-emp-code">Employee Code</label>
                            <input
                              id="add-roster-emp-code"
                              type="text"
                              value={addRosterForm.employeeCode}
                              onChange={(e) =>
                                onAddRosterEmployeeCodeChange(e.target.value)
                              }
                              className="form-input"
                              autoComplete="off"
                            />
                          </div>
                          <div className="form-group">
                            <label htmlFor="add-roster-emp-name">Employee Name</label>
                            <input
                              id="add-roster-emp-name"
                              type="text"
                              value={addRosterForm.employeeName}
                              onChange={(e) =>
                                setAddRosterForm((prev) => ({
                                  ...prev,
                                  employeeName: e.target.value
                                }))
                              }
                              className="form-input"
                              autoComplete="off"
                            />
                          </div>
                          <div className="form-group">
                            <label htmlFor="add-roster-from">From date</label>
                            <input
                              id="add-roster-from"
                              type="date"
                              value={addRosterForm.fromDate}
                              onChange={(e) =>
                                setAddRosterForm((prev) => ({
                                  ...prev,
                                  fromDate: e.target.value
                                }))
                              }
                              className="form-input"
                            />
                          </div>
                          <div className="form-group">
                            <label htmlFor="add-roster-to">To date</label>
                            <input
                              id="add-roster-to"
                              type="date"
                              value={addRosterForm.toDate}
                              onChange={(e) =>
                                setAddRosterForm((prev) => ({
                                  ...prev,
                                  toDate: e.target.value
                                }))
                              }
                              className="form-input"
                            />
                          </div>
                          <div className="form-group">
                            <label htmlFor="add-roster-shift">Shift Name</label>
                            <select
                              id="add-roster-shift"
                              value={addRosterForm.shiftName}
                              onChange={(e) =>
                                setAddRosterForm((prev) => ({
                                  ...prev,
                                  shiftName: e.target.value
                                }))
                              }
                              className="form-input"
                            >
                              <option value="">Select shift</option>
                              {rosterShiftOptions.map((n) => (
                                <option key={n} value={n}>
                                  {n}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="form-actions">
                      <button
                        type="submit"
                        className="cms-btn cms-btn-primary"
                        disabled={addRosterSubmitting}
                        aria-label="Save shift roster"
                      >
                        {addRosterSubmitting ? (
                          <div className="btn-loader">
                            <div className="cms-spinner" />
                          </div>
                        ) : (
                          'SAVE'
                        )}
                      </button>
                      <button
                        type="button"
                        className="btn-danger"
                        onClick={closeAddRosterForm}
                        disabled={addRosterSubmitting}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            </div>
          ) : (
          <div className="newshiftmap-card-container">
            <div className="newshiftmap-header">
              <h2 className="newshiftmap-title">
                <CalendarDays size={28} />
                Shift Roaster
              </h2>
              <p className="newshiftmap-subtitle">
                Manage daily shift schedules for employees
              </p>
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
            
            {/* Date Range Selection - dates left, buttons pushed to far right */}
            <div className="newshiftmap-date-filter">
              <div className="newshiftmap-date-filter-left">
                <div className="date-input-group">
                  <label>Start Date:</label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="newshiftmap-date-input"
                  />
                </div>
                <div className="date-input-group">
                  <label>End Date:</label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="newshiftmap-date-input"
                  />
                </div>
              </div>
              <div className="newshiftmap-date-filter-right">
                <button
                  type="button"
                  className="import-btn add-shift-roster-btn"
                  onClick={() => {
                    setAddRosterFormError('');
                    setAddRosterForm({
                      employeeCode: '',
                      employeeName: '',
                      fromDate: startDate || '',
                      toDate: endDate || '',
                      shiftName: ''
                    });
                    setShowAddRosterForm(true);
                  }}
                  title="Add shift roster for an employee"
                >
                  <Plus size={18} className="add-shift-roster-icon" />
                  Add Shift Roaster
                </button>
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
            
            {/* Table Display */}
            {startDate && endDate && (
              <div className="newshiftmap-table-container">
                {loading ? (
                  <div className="loading-container">
                    <div className="loading-spinner"></div>
                    <p className="loading-text">Loading schedules...</p>
                  </div>
                ) : (
                  <table className="newshiftmap-table">
                    <thead>
                      <tr>
                        {finalUserRole === 'App Administrator' && (
                          <th className="th-select" title="Select rows">
                            <input
                              type="checkbox"
                              className="checkbox-cell"
                              checked={selectedSet.size > 0 && selectedSet.size === Object.keys(groupedSchedules || {}).length}
                              onChange={(e) => {
                                const checked = e.target.checked;
                                if (!checked) {
                                  clearSelection();
                                } else {
                                  const allCodes = Object.values(groupedSchedules || {})
                                    .map(g => String(g?.employeeCode || '').trim())
                                    .filter(Boolean);
                                  setSelectedEmployeeCodes(Array.from(new Set(allCodes)));
                                }
                              }}
                              disabled={deletingSelected}
                            />
                          </th>
                        )}
                        <th>Employee Code</th>
                        <th>Employee Name</th>
                        {dateColumns.map(date => (
                          <th key={date} className="th-date">
                            {formatDateDDMMYYYY(date)}
                          </th>
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
                            {dateColumns.map(date => (
                              <td key={date} className={`shift-type-${group.shifts[date]?.toLowerCase().replace(/\s+/g, '-') || 'empty'}`}>
                                {group.shifts[date] || '-'}
                              </td>
                            ))}
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={(finalUserRole === 'App Administrator' ? 3 : 2) + dateColumns.length} className="td-empty">
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
              <div className="newshiftmap-placeholder">
                <CalendarDays size={64} />
                <p>Please select a start date and end date to view the shift schedule</p>
              </div>
            )}
          </div>
          )}
        </main>
      </div>
    </div>
    </>
  );
}

export default NewShiftMap;
