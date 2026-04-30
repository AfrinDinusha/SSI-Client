import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import axios from 'axios';
import './App.css';
import './Shiftmap.css';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import Button from './Button';
import HeaderBranding from './HeaderBranding';
import { getSidebarModulesForUser, resolveSidebarUserEmail } from './modulesConfig';
import * as XLSX from 'xlsx'; // Import the xlsx library for Excel operations
import { 
  Users, Calendar, FileText, AlertTriangle, FolderOpen, 
  ClipboardList, Building, Handshake, Landmark, Clock, 
  Map, BarChart3, User, TrendingUp, TrendingDown,
  Activity, Plus, CheckCircle, Bell, Settings, LayoutDashboard, Home as HomeIcon, AlertOctagon, CreditCard, Shield, FileSignature, Search, Clock3, CalendarDays, Database
} from 'lucide-react';

function extractTime(dateTimeStr) {
  if (!dateTimeStr) return '-';
  // If already just a time, return as is
  if (/^\\d{2}:\\d{2}(:\\d{2})?$/.test(dateTimeStr)) return dateTimeStr;
  // Otherwise, split by space and return the time part
  const parts = dateTimeStr.split(' ');
  return parts.length > 1 ? parts[1] : dateTimeStr;
}

function Shiftmap({ userRole = 'App Administrator', userEmail = null }) {
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
  
  // Get contractor name for current user
  const userContractor = finalUserEmail ? emailContractorMap[finalUserEmail] : null;
  const shouldFilterByContractor = finalUserRole === 'App User' && userContractor;
  
  // Sidebar state
  const [expandedMenus, setExpandedMenus] = useState({});
  const [showSidebarMenu, setShowSidebarMenu] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  
  const [shiftmaps, setShiftmaps] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [fetchError, setFetchError] = useState('');
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    employeeId: '',
    shiftId: '',
    fromdate: '',
    todate: '',
    assignedShift: ''
  });
  const [formError, setFormError] = useState('');
  const [formLoading, setFormLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [editMode, setEditMode] = useState(false);
  const [editId, setEditId] = useState(null);
  const [attendanceSummary, setAttendanceSummary] = useState([]);
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importError, setImportError] = useState('');
  const [exportError, setExportError] = useState('');
  const fileInputRef = useRef(null);


  const modulesToShow = useMemo(
    () => getSidebarModulesForUser(resolveSidebarUserEmail(finalUserEmail), finalUserRole),
    [finalUserEmail, finalUserRole]
  );

  // Toggle expandable menus
  const toggleMenu = (index) => {
    setExpandedMenus(prev => ({
      ...prev,
      [index]: !prev[index]
    }));
  };

  // Sample activity data with Lucide icons (same as App.js)
  const recentActivities = [
    { icon: <User size={20} />, title: 'New Employee Added', description: 'John Doe joined the development team', time: '2 hours ago' },
    { icon: <BarChart3 size={20} />, title: 'Monthly Report Generated', description: 'Contractor performance report is ready', time: '4 hours ago' },
    { icon: <CheckCircle size={20} />, title: 'Contract Approved', description: 'ABC Construction contract approved', time: '6 hours ago' },
    { icon: <Bell size={20} />, title: 'System Update', description: 'Payroll Management System updated to version 2.1', time: '1 day ago' },
    { icon: <Plus size={20} />, title: 'New Application', description: 'Candidate applied for senior position', time: '2 days ago' }
  ];

  // Fetch all data on mount
  useEffect(() => {
    setLoading(true);
    const userRoleParam = finalUserRole ? `userRole=${encodeURIComponent(finalUserRole)}` : '';
    const userEmailParam = finalUserEmail ? `userEmail=${encodeURIComponent(finalUserEmail)}` : '';
    const queryParams = [userRoleParam, userEmailParam].filter(Boolean).join('&');
    const shiftmapUrl = queryParams ? `/server/Shiftmap_function/shiftmaps?${queryParams}` : '/server/Shiftmap_function/shiftmaps';
    const employeesUrl = queryParams ? `/server/cms_function/employees?${queryParams}` : '/server/cms_function/employees';
    
    Promise.all([
      axios.get(shiftmapUrl),
      axios.get(employeesUrl),
      axios.get('/server/Shift_function/shifts'),
      axios.get('/server/Department_function/departments')
    ])
      .then(([shiftmapRes, empRes, shiftRes, depRes]) => {
        setShiftmaps(shiftmapRes.data.data.shiftmaps || []);
        setEmployees(empRes.data.data.employees || []);
        setShifts(shiftRes.data.data.shifts || []);
        setDepartments(depRes.data.data.departments || []);
        // Add these lines for debugging:
        console.log("Shiftmaps:", shiftmapRes.data.data.shiftmaps);
        console.log("Employees:", empRes.data.data.employees);
        console.log("Departments:", depRes.data.data.departments);
        setFetchError('');
      })
      .catch(() => setFetchError('Failed to fetch data.'))
      .finally(() => setLoading(false));
  }, [finalUserRole, finalUserEmail]);

  // Filter employees and shiftmaps by contractor for App Users
  const filteredEmployees = useMemo(() => {
    if (!shouldFilterByContractor || !userContractor) {
      return employees;
    }
    
    // Normalize contractor name for flexible matching
    const normalizedContractor = userContractor.replace(/\s+/g, ' ').trim().toLowerCase();
    const contractorWords = normalizedContractor.split(' ').filter(w => w.length > 2);
    
    return employees.filter(emp => {
      const empContractor = (emp.contractor || emp.contractorName || '').replace(/\s+/g, ' ').trim().toLowerCase();
      
      // Try exact match first
      if (empContractor === normalizedContractor) return true;
      
      // Try matching key words (handles variations like "Samuel Enterprise" vs "Samuel Enterprises")
      if (contractorWords.length > 0) {
        const allKeyWordsMatch = contractorWords.every(word => empContractor.includes(word));
        if (allKeyWordsMatch) {
          // Additional validation: the first word should match
          const firstWord = contractorWords[0];
          const empFirstWord = empContractor.split(' ')[0];
          if (empFirstWord && (empFirstWord.startsWith(firstWord) || firstWord.startsWith(empFirstWord))) {
            return true;
          }
        }
      }
      return false;
    });
  }, [employees, shouldFilterByContractor, userContractor]);
  
  // Filter shiftmaps to only show those for filtered employees
  const filteredShiftmaps = useMemo(() => {
    if (!shouldFilterByContractor) {
      return shiftmaps;
    }
    
    // Get set of employee IDs that belong to the contractor
    const contractorEmployeeIds = new Set(filteredEmployees.map(emp => String(emp.id)));
    
    // Filter shiftmaps to only include those for contractor employees
    return shiftmaps.filter(sm => contractorEmployeeIds.has(String(sm.employeeId)));
  }, [shiftmaps, filteredEmployees, shouldFilterByContractor]);
  
  // Calculate if all shift maps are selected
  const allSelected = filteredShiftmaps.length > 0 && selected.size === filteredShiftmaps.length;
  const someSelected = selected.size > 0 && selected.size < filteredShiftmaps.length;

  // Fetch attendance summary for the date range of all shiftmaps
  useEffect(() => {
    if (filteredShiftmaps.length === 0) return;
    const dates = filteredShiftmaps.flatMap(sm => [sm.fromdate, sm.todate]);
    const minDate = dates.reduce((a, b) => a < b ? a : b);
    const maxDate = dates.reduce((a, b) => a > b ? a : b);
    axios.get(`/server/GetAttendanceList?summary=true&startDate=${minDate}&endDate=${maxDate}`)
      .then(res => {
        setAttendanceSummary(res.data.data || []);
        console.log('Attendance summary:', res.data.data); // See what is returned
      })
      .catch(() => setFetchError('Failed to fetch attendance summary.'));
  }, [filteredShiftmaps]);
  
  // Helper: get Employee Code by id
  const getEmployeeCode = (id) => {
    const emp = filteredEmployees.find(e => String(e.id) === String(id));
    return emp ? emp.employeeCode : id;
  };

  // Helper: get Employee Name by id
  const getEmployeeName = (id) => {
    const emp = filteredEmployees.find(e => String(e.id) === String(id));
    return emp ? (emp.employeeName || emp.name || '') : '';
  };

  // Helper: get Shift Name by id
  const getShiftName = (id) => {
    const shift = shifts.find(s => s.id === id);
    return shift ? shift.shiftName : id;
  };

  // Helper: get Department Name by employeeId
  const getDepartmentName = (employeeId) => {
    const emp = filteredEmployees.find(e => String(e.id) === String(employeeId));
    console.log('Employee for department lookup:', emp); // <-- Add this line
    if (!emp) return '';
    // Try all possible fields
    return (
      emp.department ||
      emp.departmentName ||
      (() => {
        const dep = departments.find(d =>
          String(d.id) === String(emp.departmentId) ||
          String(d.departmentId) === String(emp.departmentId)
        );
        return dep ? dep.departmentName || dep.name : '';
      })()
    );
  };

  // Helper to get FirstIn/LastOut for a mapping
  const getAttendanceForMapping = (employeeId) => {
    // Find the employee object by id
    const emp = filteredEmployees.find(e => String(e.id) === String(employeeId));
    if (!emp || !emp.employeeCode) return { firstIn: '-', lastOut: '-' };
    // Use employeeCode to match attendance records
    const records = attendanceSummary.filter(
      row => String(row.EmployeeID) === String(emp.employeeCode)
    );
    if (records.length === 0) {
      return { firstIn: '-', lastOut: '-' };
    }
    // Find the earliest FirstIN and latest LastOUT
    let firstIn = null;
    let lastOut = null;
    records.forEach(rec => {
      if (rec.FirstIN && (!firstIn || rec.FirstIN < firstIn)) {
        firstIn = rec.FirstIN;
      }
      if (rec.LastOUT && (!lastOut || rec.LastOUT > lastOut)) {
        lastOut = rec.LastOUT;
      }
    });
    return {
      firstIn: firstIn || '-',
      lastOut: lastOut || '-'
    };
  };

  // Delete a single shiftmap
  const handleDelete = (id) => {
    if (window.confirm('Delete this shift mapping?')) {
      axios.delete(`/server/Shiftmap_function/shiftmaps/${id}`)
        .then(() => setShiftmaps(shiftmaps.filter(sm => sm.id !== id)))
        .catch(() => setFetchError('Failed to delete shift mapping.'));
    }
  };

  // Bulk delete
  const handleDeleteSelected = () => {
    if (window.confirm(`Delete ${selected.size} selected shift mappings?`)) {
      Promise.all(Array.from(selected).map(id =>
        axios.delete(`/server/Shiftmap_function/shiftmaps/${id}`)
      ))
        .then(() => {
          setShiftmaps(shiftmaps.filter(sm => !selected.has(sm.id)));
          setSelected(new Set());
        })
        .catch(() => setFetchError('Failed to delete one or more shift mappings.'));
    }
  };

  // Selection logic
  const toggleSelect = (id) => {
    const newSet = new Set(selected);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelected(newSet);
  };

  const handleSelectAll = useCallback(() => {
    if (allSelected) {
      // If all are selected, deselect all
      setSelected(new Set());
    } else {
      // If not all are selected, select all
      const allIds = filteredShiftmaps.map(shiftmap => shiftmap.id);
      setSelected(new Set(allIds));
    }
  }, [allSelected, filteredShiftmaps]);

  // Handle Import
  const handleImport = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    setImporting(true);
    setImportError('');

    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet);
      // Helper: normalize Excel date (including serial date numbers) to yyyy-mm-dd
      const normalizeDate = (value) => {
        if (!value) return '';
        // If already yyyy-mm-dd or yyyy/m/d
        if (typeof value === 'string') {
          const str = value.trim();
          // Replace / with - and pad
          const d = new Date(str.replaceAll('/', '-'));
          if (!isNaN(d)) return d.toISOString().slice(0, 10);
          return str; // fallback
        }
        // If Excel serial number
        if (typeof value === 'number') {
          const date = XLSX.SSF ? XLSX.SSF.parse_date_code(value) : null;
          if (date) {
            const y = date.y.toString().padStart(4, '0');
            const m = date.m.toString().padStart(2, '0');
            const d = date.d.toString().padStart(2, '0');
            return `${y}-${m}-${d}`;
          }
          // Fallback via epoch
          const d2 = new Date(Math.round((value - 25569) * 86400 * 1000));
          if (!isNaN(d2)) return d2.toISOString().slice(0, 10);
        }
        return '';
      };

      // Today as default when dates not provided
      const today = new Date().toISOString().slice(0, 10);

      // Process and post each row
      const errors = [];
      for (let i = 0; i < jsonData.length; i++) {
        const row = jsonData[i];

        // Resolve employee by code or name
        const employeeCode = row['Employee Code'] || row['employeeCode'] || row['Employee ID'] || row['employeeId'];
        const employeeName = row['Employee Name'] || row['employeeName'] || row['Name'];
        let employeeId = '';
        if (employeeCode != null && employeeCode !== '') {
          const empByCode = filteredEmployees.find(e => String(e.employeeCode).trim() === String(employeeCode).trim());
          if (empByCode) employeeId = empByCode.id;
        }
        if (!employeeId && employeeName) {
          const empByName = filteredEmployees.find(e =>
            String(e.name || e.employeeName || '').trim().toLowerCase() === String(employeeName).trim().toLowerCase()
          );
          if (empByName) employeeId = empByName.id;
        }

        // Resolve shift by id or name
        const rawShiftId = row['Shift ID'] || row['shiftId'];
        const rawShiftName = row['Shift'] || row['shift'] || row['Shift Name'];
        let shiftId = '';
        if (rawShiftId != null && rawShiftId !== '') {
          shiftId = rawShiftId;
        } else if (rawShiftName) {
          const match = shifts.find(s => String(s.shiftName).trim().toLowerCase() === String(rawShiftName).trim().toLowerCase());
          if (match) shiftId = match.id;
        }

        // Dates: use provided or default to today
        const fromdate = normalizeDate(row['From Date'] || row['fromdate']) || today;
        const todate = normalizeDate(row['To Date'] || row['todate']) || today;

        // Assigned/Actual/FirstIn/LastOut from various header variants
        const assignedShift = row['Assigned Shift'] || row['assignedShift'] || row['Assigned S'] || row['Assigned'] || '';
        const actualShift = row['Actual Shift'] || row['actualShift'] || row['Actual Shi'] || '';
        const firstIn = row['First In'] || row['FirstIn'] || '';
        const lastOut = row['Last out'] || row['LastOut'] || row['Last Out'] || '';

        if (!employeeId || !shiftId) {
          errors.push(`Row ${i + 2}: Missing employee or shift (Employee Code: ${employeeCode || '-'} | Shift: ${rawShiftName || rawShiftId || '-'})`);
          continue;
        }

        const shiftmapPayload = { employeeId, shiftId, fromdate, todate, assignedShift, actualShift, firstIn, lastOut };
        await axios.post('/server/Shiftmap_function/shiftmaps', shiftmapPayload);
      }

      if (errors.length > 0) {
        throw new Error(errors.join('\n'));
      }

                      // Refresh the data
      const userRoleParam = finalUserRole ? `userRole=${encodeURIComponent(finalUserRole)}` : '';
      const userEmailParam = finalUserEmail ? `userEmail=${encodeURIComponent(finalUserEmail)}` : '';
      const queryParams = [userRoleParam, userEmailParam].filter(Boolean).join('&');
      const refreshUrl = queryParams ? `/server/Shiftmap_function/shiftmaps?${queryParams}` : '/server/Shiftmap_function/shiftmaps';
      const res = await axios.get(refreshUrl);
      setShiftmaps(res.data.data.shiftmaps || []);
      setSuccessMessage('Shift mappings imported successfully');
      setTimeout(() => setSuccessMessage(''), 5000);
    } catch (error) {
      setImportError(error.message || 'Failed to import shift mappings');
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Handle Export
  const handleExport = async () => {
    if (filteredShiftmaps.length === 0) {
      setExportError('No shift mappings to export.');
      return;
    }

    setExporting(true);
    setExportError('');

    try {
      // Prepare export data with all relevant columns
      const exportData = [];

      filteredShiftmaps.forEach((sm) => {
        const emp = filteredEmployees.find(e => String(e.id) === String(sm.employeeId));
        const shift = shifts.find(s => s.id === sm.shiftId);
        const department = getDepartmentName(sm.employeeId);
        
        // Get attendance data for this mapping
        const attendance = getAttendanceForMapping(sm.employeeId);
        
        // Create a row for each date in the range
        const getDateRange = (from, to) => {
          const dates = [];
          let current = new Date(from);
          const end = new Date(to);
          while (current <= end) {
            dates.push(current.toISOString().slice(0, 10));
            current.setDate(current.getDate() + 1);
          }
          return dates;
        };

        const dateRange = getDateRange(sm.fromdate, sm.todate);
        
        dateRange.forEach((date) => {
          // Find attendance for this specific date
          const attendanceForDate = attendanceSummary.find(
            row => String(row.EmployeeID) === String(emp?.employeeCode) && row.Date === date
          );
          
          const firstIn = attendanceForDate ? extractTime(attendanceForDate.FirstIN || '-') : '-';
          const lastOut = attendanceForDate ? extractTime(attendanceForDate.LastOUT || '-') : '-';
          
          // Determine actual shift
          const assignedShift = (sm.assignedShift || '').trim().toUpperCase();
          const getHourMinute = (time) => {
            if (!time || time === '-') return '';
            const parts = time.split(':');
            return parts.length >= 2 ? `${parts[0]}:${parts[1]}` : time;
          };
          const isInWindow = (time, start, end) => {
            if (!time || time === '-') return false;
            const [h, m] = time.split(':').map(Number);
            const t = h * 60 + m;
            const [sh, sm] = start.split(':').map(Number);
            const [eh, em] = end.split(':').map(Number);
            return t >= (sh * 60 + sm) && t <= (eh * 60 + em);
          };
          const GENERAL_WINDOW = { start: "07:25", end: "17:55" };
          let actualShift = "-";
          const firstInHM = getHourMinute(firstIn);
          if (firstIn && firstIn !== '-') {
            if (assignedShift === "GENERAL") {
              if (isInWindow(firstInHM, GENERAL_WINDOW.start, GENERAL_WINDOW.end)) {
                actualShift = "Come in general shift";
              } else {
                actualShift = "No Match";
              }
            } else {
              actualShift = "No Match";
            }
          }

          exportData.push({
            'Date': date,
            'Employee Code': emp?.employeeCode || sm.employeeId,
            'Employee Name': emp ? (emp.employeeName || emp.name || '') : '',
            'Department': department || '',
            'Shift': shift?.shiftName || sm.shiftId,
            'Assigned Shift': sm.assignedShift || '-',
            'Actual Shift': actualShift,
            'First In': firstIn,
            'Last Out': lastOut,
            'From Date': sm.fromdate,
            'To Date': sm.todate
          });
        });
      });

      // Create worksheet and workbook
      const worksheet = XLSX.utils.json_to_sheet(exportData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Shift Mappings');
      
      // Generate filename with current date
      const today = new Date().toISOString().slice(0, 10);
      const filename = `shift-mappings-${today}.xlsx`;
      
      // Write file
      XLSX.writeFile(workbook, filename);
      
      setSuccessMessage('Shift mappings exported successfully');
      setTimeout(() => setSuccessMessage(''), 5000);
    } catch (error) {
      setExportError(error.message || 'Failed to export shift mappings');
    } finally {
      setExporting(false);
    }
  };

  // Edit logic (now implemented)
  const handleEdit = (shiftmap) => {
    setShowForm(true);
    setEditMode(true);
    setEditId(shiftmap.id);
    setForm({
      employeeId: shiftmap.employeeId,
      shiftId: shiftmap.shiftId,
      fromdate: shiftmap.fromdate,
      todate: shiftmap.todate,
      assignedShift: shiftmap.assignedShift || ''
    });
    setFormError('');
    setSuccessMessage('');
  };

  function getDeviationStatus(assignedShift, firstIn) {
    if (!assignedShift || !firstIn || firstIn === '-') return 'No Check-in';
    const assigned = assignedShift.trim().toUpperCase();
    const getHourMinute = (time) => {
      if (!time) return '';
      const parts = time.split(':');
      return parts.length >= 2 ? `${parts[0]}:${parts[1]}` : time;
    };
    const isInWindow = (time, start, end) => {
      if (!time) return false;
      const [h, m] = time.split(':').map(Number);
      const t = h * 60 + m;
      const [sh, sm] = start.split(':').map(Number);
      const [eh, em] = end.split(':').map(Number);
      return t >= (sh * 60 + sm) && t <= (eh * 60 + em);
    };
    const GENERAL_WINDOW = { start: "07:25", end: "17:55" }; // 7:25 to 5:55 (17:55 in 24-hour format)
    const firstInHM = getHourMinute(firstIn);
    
    if (assigned === "GENERAL") {
      if (isInWindow(firstInHM, GENERAL_WINDOW.start, GENERAL_WINDOW.end)) {
        return "Come in general shift";
      } else {
        return "No Match";
      }
    }
    return "No Match";
  }

  const closeForm = () => {
    setShowForm(false);
    setEditMode(false);
    setEditId(null);
    setForm({ employeeId: '', shiftId: '', fromdate: '', todate: '', assignedShift: '' });
    setFormError('');
    setSuccessMessage('');
  };

  // If form is shown, render the form page
  if (showForm) {
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
              <img src="https://images.pexels.com/photos/2379004/pexels-photo-2379004.jpeg?auto=compress&cs=tinysrgb&w=150" alt="User" className="cms-user-avatar" />
              <div className="cms-user-details">
                <h4>Admin User</h4>
                <p>App Administrator</p>
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
                  <img src="https://images.pexels.com/photos/2379004/pexels-photo-2379004.jpeg?auto=compress&cs=tinysrgb&w=150" alt="User" className="cms-user-avatar" />
                  <div className="cms-logout-icon">
                    <Button title="" className="cms-logout-btn" />
                  </div>
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

            {/* Form Page Content */}
            <main className="cms-dashboard-content">
              <div className="shiftmap-form-page">
                <div className="shiftmap-form-container">
                  <div className="shiftmap-form-header">
                    <h1>
                      <span className="modal-icon">{editMode ? '✏️' : '➕'}</span>
                      {editMode ? 'Edit' : 'Add'} Shift Mapping
                    </h1>
                    <button type="button" className="close-btn" onClick={closeForm}>
                      ✕
                    </button>
                  </div>
                  
                  <div className="shiftmap-form-content">
                    {formLoading && (
                      <div className="form-loader">
                        <div className="loading-spinner"></div>
                      </div>
                    )}
                    
                    <form onSubmit={async e => {
                      e.preventDefault();
                      setFormError('');
                      if (!form.employeeId || !form.shiftId || !form.fromdate || !form.todate) {
                        setFormError('All fields are required.');
                        return;
                      }
                      setFormLoading(true);

                      // Fetch attendance for this employee and fromdate
                      const attendanceUrl = `/server/GetAttendanceList?summary=true&startDate=${form.fromdate}&endDate=${form.fromdate}`;
                      const attendanceRes = await axios.get(attendanceUrl);
                      const attendanceData = attendanceRes.data.data || [];
                      const summary = attendanceData.find(
                        row => String(row.EmployeeID) === String(form.employeeId) && row.Date === form.fromdate
                      );
                      const firstIn = summary ? summary.FirstIN : '';
                      const lastOut = summary ? summary.LastOUT : '';

                      // Now include firstIn and lastOut in your shift mapping object:
                      const shiftmapPayload = {
                        ...form,
                        firstIn,
                        lastOut
                      };

                      if (editMode && editId) {
                        // Edit mode: PUT request
                        axios.put(`/server/Shiftmap_function/shiftmaps/${editId}`, shiftmapPayload)
                          .then(res => {
                            if (res.data.status === 'success') {
                              // Get employee details for display
                              const employee = filteredEmployees.find(emp => emp.id === form.employeeId);
                              const department = departments.find(dep => dep.id === employee?.departmentId);
                              const shift = shifts.find(s => s.id === form.shiftId);
                              const successMsg = `Successfully updated ${employee?.name || 'Employee'} (${employee?.employeeCode || 'N/A'}) from ${department?.name || 'N/A'} department to ${shift?.shiftName || 'N/A'} shift from ${form.fromdate} to ${form.todate}`;
                              setSuccessMessage(successMsg);
                              setTimeout(() => setSuccessMessage(''), 5000);
                              setShowForm(false);
                              setForm({ employeeId: '', shiftId: '', fromdate: '', todate: '', assignedShift: '' });
                              setShiftmaps(prev => prev.map(sm => sm.id === editId ? res.data.data.shiftmap : sm));
                            } else {
                              setFormError(res.data.message || 'Failed to update mapping.');
                            }
                          })
                          .catch(err => {
                            setFormError(err.response?.data?.message || 'Failed to update mapping.');
                          })
                          .finally(() => setFormLoading(false));
                      } else {
                        // Add mode: POST request
                        axios.post('/server/Shiftmap_function/shiftmaps', shiftmapPayload)
                          .then(res => {
                            if (res.data.status === 'success') {
                              // Get employee details for display
                              const employee = filteredEmployees.find(emp => emp.id === form.employeeId);
                              const department = departments.find(dep => dep.id === employee?.departmentId);
                              const shift = shifts.find(s => s.id === form.shiftId);
                              const successMsg = `Successfully assigned ${employee?.name || 'Employee'} (${employee?.employeeCode || 'N/A'}) from ${department?.name || 'N/A'} department to ${shift?.shiftName || 'N/A'} shift from ${form.fromdate} to ${form.todate}`;
                              setSuccessMessage(successMsg);
                              setTimeout(() => setSuccessMessage(''), 5000);
                              setShowForm(false);
                              setForm({ employeeId: '', shiftId: '', fromdate: '', todate: '', assignedShift: '' });
                              setShiftmaps(prev => [...prev, res.data.data.shiftmap]);
                            } else {
                              setFormError(res.data.message || 'Failed to add mapping.');
                            }
                          })
                          .catch(err => {
                            setFormError(err.response?.data?.message || 'Failed to add mapping.');
                          })
                          .finally(() => setFormLoading(false));
                      }
                    }}>
                      <div className="shiftmap-form-section-card employee-info">
                        <h2 className="section-title">Employee Information</h2>
                        <div className="form-grid">
                          <div className="form-group">
                            <label htmlFor="employeeId">
                              <span className="label-icon">👤</span>
                              Employee <span className="required">*</span>
                            </label>
                            <select
                              id="employeeId"
                              name="employeeId"
                              className="input"
                              value={form.employeeId}
                              onChange={e => {
                                const selectedEmp = filteredEmployees.find(emp => String(emp.id) === String(e.target.value));
                                setForm({
                                  ...form,
                                  employeeId: e.target.value,
                                });
                              }}
                              required
                            >
                              <option value="">-Select Employee-</option>
                              {filteredEmployees.map(emp => (
                                <option key={emp.id} value={emp.id}>{emp.employeeCode} {emp.name ? `(${emp.name})` : ''}</option>
                              ))}
                            </select>
                          </div>
                        </div>
                      </div>

                      <div className="shiftmap-form-section-card shift-info">
                        <h2 className="section-title">Shift Information</h2>
                        <div className="form-grid">
                          <div className="form-group">
                            <label htmlFor="shiftId">
                              <span className="label-icon">🕐</span>
                              Shift <span className="required">*</span>
                            </label>
                            <select 
                              id="shiftId"
                              name="shiftId" 
                              className="input"
                              value={form.shiftId} 
                              onChange={e => setForm({ ...form, shiftId: e.target.value })} 
                              required
                            >
                              <option value="">-Select Shift-</option>
                              {shifts.map(shift => (
                                <option key={shift.id} value={shift.id}>{shift.shiftName}</option>
                              ))}
                            </select>
                          </div>
                        </div>
                      </div>

                      <div className="shiftmap-form-section-card date-range">
                        <h2 className="section-title">Date Range</h2>
                        <div className="form-grid">
                          <div className="form-group">
                            <label htmlFor="fromdate">
                              <span className="label-icon">📅</span>
                              From Date <span className="required">*</span>
                            </label>
                            <input 
                              id="fromdate"
                              type="date" 
                              name="fromdate" 
                              className="input"
                              value={form.fromdate} 
                              onChange={e => setForm({ ...form, fromdate: e.target.value })} 
                              required 
                            />
                          </div>
                          <div className="form-group">
                            <label htmlFor="todate">
                              <span className="label-icon">📅</span>
                              To Date <span className="required">*</span>
                            </label>
                            <input 
                              id="todate"
                              type="date" 
                              name="todate" 
                              className="input"
                              value={form.todate} 
                              onChange={e => setForm({ ...form, todate: e.target.value })} 
                              required 
                            />
                          </div>
                        </div>
                      </div>

                      <div className="shiftmap-form-section-card shift-assignment">
                        <h2 className="section-title">Shift Assignment</h2>
                        <div className="form-grid">
                          <div className="form-group">
                            <label htmlFor="assignedShift">
                              <span className="label-icon">⚙️</span>
                              Assigned Shift
                            </label>
                            <input
                              id="assignedShift"
                              type="text"
                              name="assignedShift"
                              className="input"
                              value={form.assignedShift}
                              onChange={e => setForm({ ...form, assignedShift: e.target.value })}
                              placeholder="Enter assigned shift (optional)"
                            />
                          </div>
                        </div>
                      </div>

                      {formError && (
                        <div className="alert alert-error">
                          <span className="alert-icon">⚠️</span>
                          {formError}
                        </div>
                      )}

                      <div className="form-actions">
                        <button type="button" className="btn-danger" onClick={closeForm}>
                          Cancel
                        </button>
                        <button type="submit" className="btn-primary" disabled={formLoading}>
                          {formLoading ? (editMode ? 'Updating...' : 'Adding...') : (editMode ? 'Update Shift Mapping' : 'Add Shift Mapping')}
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
              </div>
            </main>
          </div>
        </div>
      </>
    );
  }

  // Main shiftmap list view
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
                        className="cms-nav-child"
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
            <img src="https://images.pexels.com/photos/2379004/pexels-photo-2379004.jpeg?auto=compress&cs=tinysrgb&w=150" alt="User" className="cms-user-avatar" />
            <div className="cms-user-details">
              <h4>Admin User</h4>
              <p>App Administrator</p>
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
                <img src="https://images.pexels.com/photos/2379004/pexels-photo-2379004.jpeg?auto=compress&cs=tinysrgb&w=150" alt="User" className="cms-user-avatar" />
                <div className="cms-logout-icon">
                  <Button title="" className="cms-logout-btn" />
                </div>
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
            <div 
              className="shiftmap-card-container" 
              style={{ 
                background: 'var(--white)', 
                borderRadius: '20px', 
                boxShadow: '0 8px 30px var(--shadow-light)', 
                padding: '30px', 
                margin: '0', 
                maxWidth: '100%', 
                position: 'relative',
                border: '1px solid rgba(37, 99, 235, 0.2)'
              }}
            >
              {/* Header and Toolbar */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
                <div className="shiftmap-header-actions">
                  <div className="shiftmap-title-section">
                    <h2 className="shiftmap-title">
                      <Map size={28} />
                      Employee Shift Mappings
                    </h2>
                    <button
                      className="btn-icon"
                      aria-label="Add Shift Mapping"
                      onClick={() => {
                        setShowForm(true);
                        setForm({ employeeId: '', shiftId: '', fromdate: '', todate: '', assignedShift: '', actualShift: '' });
                        setFormError('');
                        setSuccessMessage('');
                      }}
                      style={{ marginLeft: '8px' }}
                    >
                      <Plus size={20} />
                    </button>
                    <p className="shiftmap-subtitle">
                      Manage your employee shift mappings efficiently
                    </p>
                  </div>
                </div>
                {/* Toolbar Buttons */}
                <div className="shiftmap-toolbar" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <button className="toolbar-btn add-btn" onClick={() => { setShowForm(true); setForm({ employeeId: '', shiftId: '', fromdate: '', todate: '', assignedShift: '', actualShift: '' }); setFormError(''); setSuccessMessage(''); }}>
                    <i className="fas fa-plus" style={{ color: '#232323', fontSize: '1.5rem' }}></i>
                  </button>

                  <button
                    className="toolbar-btn export-btn"
                    onClick={handleExport}
                    disabled={exporting || filteredShiftmaps.length === 0}
                    title="Export to Excel"
                  >
                    <i className="fas fa-download" style={{ color: '#232323', fontSize: '1.5rem' }}></i>
                  </button>

                  {selected.size > 0 && (
                    <button className="action-btn" onClick={handleDeleteSelected} title="Delete Selected">
                      <i className="fas fa-trash" style={{ color: 'red' }}></i>
                    </button>
                  )}
                </div>
              </div>

              {fetchError && (
                <div className="alert alert-error">
                  <span className="alert-icon">⚠️</span>
                  {fetchError}
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

              {exportError && (
                <div className="alert alert-error">
                  <span className="alert-icon">⚠️</span>
                  Export Error: {exportError}
                </div>
              )}

              <div className="shiftmap-table-container">
                {loading ? (
                  <div className="loading-container">
                    <div className="loading-spinner"></div>
                    <p className="loading-text">Loading shift mappings...</p>
                  </div>
                ) : (
                  <table className={`shiftmap-table ${selected.size === 0 ? 'edit-column-hidden' : ''}`}>
                    <thead>
                      <tr>
                        <th>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <input
                              type="checkbox"
                              checked={allSelected}
                              ref={(input) => {
                                if (input) input.indeterminate = someSelected;
                              }}
                              onChange={handleSelectAll}
                              style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                            />
                          </div>
                        </th>
                        <th>Edit</th>
                        <th>Employee Code</th>
                        <th>Employee Name</th>
                        <th>Department</th>
                        <th>Shift</th>
                        <th>Assigned Shift</th>
                        <th>Actual Shift</th>
                        <th>First In</th>
                        <th>Last Out</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredShiftmaps.length > 0 ? (
                        filteredShiftmaps.flatMap((sm, idx) => {
                          const getDateRange = (from, to) => {
                            const dates = [];
                            let current = new Date(from);
                            const end = new Date(to);
                            while (current <= end) {
                              dates.push(current.toISOString().slice(0, 10));
                              current.setDate(current.getDate() + 1);
                            }
                            return dates;
                          };

                          const emp = filteredEmployees.find(e => String(e.id) === String(sm.employeeId));
                          const dateRange = getDateRange(sm.fromdate, sm.todate);

                          return dateRange.map((date, dateIdx) => {
                            // Find attendance for this employee and date
                            const attendance = attendanceSummary.find(
                              row => String(row.EmployeeID) === String(emp?.employeeCode) && row.Date === date
                            );
                            const firstIn = attendance ? attendance.FirstIN || '-' : '-';
                            const lastOut = attendance ? attendance.LastOUT || '-' : '-';

                            // Determine deviation status for Actual Shift
                            const getHourMinute = (time) => {
                              if (!time) return '';
                              const parts = time.split(':');
                              return parts.length >= 2 ? `${parts[0]}:${parts[1]}` : time;
                            };
                            const isInWindow = (time, start, end) => {
                              if (!time) return false;
                              const [h, m] = time.split(':').map(Number);
                              const t = h * 60 + m;
                              const [sh, sm] = start.split(':').map(Number);
                              const [eh, em] = end.split(':').map(Number);
                              return t >= (sh * 60 + sm) && t <= (eh * 60 + em);
                            };
                            const GENERAL_WINDOW = { start: "07:25", end: "17:55" }; // 7:25 to 5:55 (17:55 in 24-hour format)
                            let actualShift = "-";
                            const assignedShift = (sm.assignedShift || '').trim().toUpperCase();
                            const firstInHM = getHourMinute(extractTime(firstIn));
                            if (firstIn && firstIn !== '-') {
                              if (assignedShift === "GENERAL") {
                                if (isInWindow(firstInHM, GENERAL_WINDOW.start, GENERAL_WINDOW.end)) {
                                  actualShift = "Come in general shift";
                                } else {
                                  actualShift = "No Match";
                                }
                              } else {
                                actualShift = "No Match";
                              }
                            }

                            return (
                              <tr key={`${sm.id}-${date}`}>
                                <td>
                                  {dateIdx === 0 && (
                                    <input
                                      type="checkbox"
                                      checked={selected.has(sm.id)}
                                      onChange={() => toggleSelect(sm.id)}
                                    />
                                  )}
                                </td>
                                <td>
                                  {dateIdx === 0 && (
                                    <button className="btn-icon" onClick={() => handleEdit(sm)}>
                                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                                      </svg>
                                    </button>
                                  )}
                                </td>
                                <td>{emp?.employeeCode || sm.employeeId}</td>
                                <td>{emp ? (emp.employeeName || emp.name || '') : ''}</td>
                                <td>{getDepartmentName(sm.employeeId)}</td>
                                <td>{getShiftName(sm.shiftId)}</td>
                                <td>{sm.assignedShift || '-'}</td>
                                <td>{actualShift}</td>
                                <td>{extractTime(firstIn)}</td>
                                <td>{extractTime(lastOut)}</td>
                              </tr>
                            );
                          });
                        })
                      ) : (
                        <tr>
                          <td colSpan={10} className="text-center">
                            No shift mappings found.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </main>
        </div>
      </div>
    </>
  );
}

export default Shiftmap;
