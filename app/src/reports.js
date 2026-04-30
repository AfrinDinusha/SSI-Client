import React, { useState, useEffect, useRef, useMemo } from 'react';
import './App.css';
import './reports.css';
import './employeeManagement.css';
import './Candidateform.css';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import Button from './Button';
import HeaderBranding from './HeaderBranding';
import { getSidebarModulesForUser, resolveSidebarUserEmail } from './modulesConfig';
import { 
  Users, Calendar, FileText, AlertTriangle, FolderOpen, 
  ClipboardList, Building, Handshake, Landmark, Clock, 
  Map, BarChart3, User, TrendingUp, TrendingDown,
  Activity, Plus, CheckCircle, Bell, Settings, LayoutDashboard, Home as HomeIcon, AlertOctagon, CreditCard, Shield, FileSignature, Search, Clock3, CalendarDays, Download
} from 'lucide-react';
function exportToCSV(data, filename) {
  const csvRows = [];
  const headers = ['Employee Code', 'Employee Name', 'Department', 'Category', 'Total Overtime (hrs)', 'Overtime Days', 'Avg Overtime/Day'];
  csvRows.push(headers.join(','));
  for (const row of data) {
    csvRows.push([
      row.employeeId,
      row.employeeName,
      row.department,
      row.category || '',
      row.totalOvertimeHours,
      row.overtimeDays,
      row.averageOvertimePerDay
    ].join(','));
  }
  const csvString = csvRows.join('\n');
  const blob = new Blob([csvString], { type: 'text/csv' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  window.URL.revokeObjectURL(url);
}

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

/** String for Adjust column: payroll OT − report total (e.g. payroll 40 vs report 44 → "-4"). */
function formatPayrollOtAdjustDelta(payrollOt, reportTotal) {
  const delta = payrollOt - reportTotal;
  const rounded = Math.round(delta * 100) / 100;
  if (!Number.isFinite(rounded)) return '0';
  if (Object.is(rounded, -0)) return '0';
  if (Number.isInteger(rounded)) return String(rounded);
  return String(rounded);
}

/**
 * Sync Adjust from payroll vs report: Adjust = payroll OT − report total so
 * Final OT (report total + adjust) matches payroll after edits (including payroll OT = 0).
 */
function adjustValueFromPayrollSync(payrollOt, reportTotal) {
  if (!Number.isFinite(payrollOt)) return '0';
  const rt = Number.isFinite(reportTotal) ? reportTotal : 0;
  const delta = payrollOt - rt;
  if (Math.abs(delta) < 0.005) return '0';
  return formatPayrollOtAdjustDelta(payrollOt, rt);
}

function exportToExcel(calendarData, dateRange, filename, adjustmentsByEmpId = {}) {
  // Simple Excel export using HTML table with date-wise columns
  let table = '<table><tr><th>Employee Code</th><th>Employee Name</th><th>Department</th><th>Category</th>';
  
  // Add date columns
  dateRange.forEach(date => {
    const dateStr = new Date(date).toLocaleDateString('en-GB');
    table += `<th>${dateStr}</th>`;
  });
  
  table += '<th>Total Overtime (hrs)</th><th>Adjust value</th><th>Final OT Value</th></tr>';
  
  for (const emp of calendarData) {
    table += `<tr><td>${emp.employeeId}</td><td>${emp.employeeName}</td><td>${emp.department || ''}</td><td>${emp.category || ''}</td>`;
    
    dateRange.forEach(date => {
      const dayData = emp.dateData[date];
      if (dayData && dayData.overtimeHours !== undefined && dayData.overtimeHours !== null) {
        if (dayData.overtimeHours > 0) {
          table += `<td>${parseFloat(dayData.overtimeHours).toFixed(2)}</td>`;
        } else if (dayData.firstIn || dayData.lastOut) {
          table += `<td>0.00</td>`;
        } else {
          table += `<td>-</td>`;
        }
      } else {
        table += `<td>-</td>`;
      }
    });
    
    const total = parseOtHours(emp.totalOvertimeHours);
    const adj = parseOtHours(adjustmentsByEmpId[emp.employeeId]);
    const finalOt = total + adj;
    table += `<td>${total.toFixed(2)}</td><td>${adj.toFixed(2)}</td><td>${finalOt.toFixed(2)}</td></tr>`;
  }
  
  table += '</table>';
  const blob = new Blob([
    '\ufeff',
    table
  ], { type: 'application/vnd.ms-excel' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  window.URL.revokeObjectURL(url);
}

export default function Reports({ userRole = 'App Administrator', userEmail = null }) {
  const navigate = useNavigate();
  const location = useLocation();

  // Sidebar state - simple initial value to avoid any cross-module reference in first hook
  const [expandedMenus, setExpandedMenus] = useState({});
  const [showSidebarMenu, setShowSidebarMenu] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  
  // Initialize contractor based on user restrictions
  const getInitialContractor = () => {
    if (userRole === 'App Administrator') return 'All';
    if (userEmail) {
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
      return emailContractorMap[userEmail] || 'All';
    }
    return 'All';
  };
  const [contractor, setContractor] = useState(getInitialContractor);
  const [department, setDepartment] = useState('All');
  const [departmentOtApplicableTo, setDepartmentOtApplicableTo] = useState(['All']);
  const [employeeId, setEmployeeId] = useState('All');
  const [startDate, setStartDate] = useState(() => {
    const now = new Date();
    return now.toISOString().slice(0, 10); // Format: YYYY-MM-DD
  });
  const [endDate, setEndDate] = useState(() => {
    const now = new Date();
    return now.toISOString().slice(0, 10); // Format: YYYY-MM-DD
  });
  const [tableData, setTableData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  /** Per-employee OT adjustment (hours); added to Total Overtime for Final OT Value */
  const [otAdjustments, setOtAdjustments] = useState({});

  // Generate array of dates between startDate and endDate
  const generateDateRange = (start, end) => {
    const dates = [];
    const startDateObj = new Date(start);
    const endDateObj = new Date(end);
    const currentDate = new Date(startDateObj);
    
    while (currentDate <= endDateObj) {
      dates.push(currentDate.toISOString().slice(0, 10));
      currentDate.setDate(currentDate.getDate() + 1);
    }
    return dates;
  };

  // Transform tableData into employee-based structure with date columns
  const transformDataForCalendarView = (data, dateRange) => {
    // Group data by employee
    const employeeMap = {};
    
    data.forEach(row => {
      const empKey = row.employeeId;
      if (!employeeMap[empKey]) {
        employeeMap[empKey] = {
          employeeId: row.employeeId,
          employeeName: row.employeeName,
          department: row.department,
          category: row.category || '',
          designation: row.designation || '',
          contractorName: row.contractorName,
          totalOvertimeHours: row.totalOvertimeHours,
          overtimeDays: row.overtimeDays,
          averageOvertimePerDay: row.averageOvertimePerDay,
          adjustValue: row.adjustValue ?? row.adjustOtHours ?? row.adjust_ot_hours,
          dateData: {}
        };
      }
      
      // Process overtime records for this employee
      if (row.overtimeRecords && Array.isArray(row.overtimeRecords)) {
        row.overtimeRecords.forEach(record => {
          const dateKey = record.date || '';
          if (dateKey) {
            employeeMap[empKey].dateData[dateKey] = {
              overtimeHours: record.overtimeHours || 0,
              firstIn: record.firstIn || '',
              lastOut: record.lastOut || '',
              source: record.source || ''
            };
          }
        });
      }
    });
    
    // Convert to array and ensure all dates are represented
    return Object.values(employeeMap).map(emp => {
      const dateDataWithAllDates = dateRange.reduce((acc, date) => {
        acc[date] = emp.dateData[date] || null;
        return acc;
      }, {});
      
      return {
        ...emp,
        dateData: dateDataWithAllDates
      };
    });
  };

  // Dropdown state
  // Remove sortBtnRef and sortOpen related code
  // const [sortOpen, setSortOpen] = useState(false);
  // const [sortSubMenu, setSortSubMenu] = useState(null);
  // const sortBtnRef = useRef();

  // Sorting state
  // Remove sort state and refs
  // const [sortField, setSortField] = useState(null); // e.g. 'employeeId'
  // const [sortOrder, setSortOrder] = useState('asc');

  // ⬇️ Move these hooks here:
  const [contractors, setContractors] = useState(['All']);
  const [departments, setDepartments] = useState(['All']);
  const [employees, setEmployees] = useState(['All']);

  const modulesToShow = useMemo(
    () => getSidebarModulesForUser(resolveSidebarUserEmail(userEmail), userRole),
    [userEmail, userRole]
  );

  // Resolve contractor restriction for App Users
  const allowedContractor = useMemo(() => {
    if (userRole === 'App Administrator') return null;
    let contractorName = null;

    // Prefer contractor info stored from authentication
    try {
      const stored = localStorage.getItem('contractorInfo');
      if (stored) {
        const parsed = JSON.parse(stored);
        contractorName = parsed.contractorName || parsed.ContractorName || null;
      }
    } catch (err) {
      console.error('Error reading contractorInfo from storage', err);
    }

    // Fallback to hardcoded mappings
    if (!contractorName && userEmail) {
      if (userEmail === 'afrindinusha29@gmail.com' || userEmail === 'sriramenterprises50@yahoo.com') {
        contractorName = 'Sriram Enterprises';
      } else if (userEmail === 'afrindinusha@gmail.com' || userEmail === 'rpdmanpowerservice@gmail.com' || userEmail === 'ramachandran23488@gmail.com') {
        contractorName = 'R.P.D Facility Management Services';
      } else if (userEmail === 'afrinatlin@gmail.com' || userEmail === 'samuelenterprisesms@gmail.com') {
        contractorName = 'Samuel Enterprise';
      } else if (userEmail === 'dinushaafrin@gmail.com' || userEmail === 'vijaybalaji701@gmail.com') {
        contractorName = 'Sri Balaji Enterprises';
      } else if (userEmail === 'afrindinu14@gmail.com' || userEmail === 'vaishnavi.a@buildhr.co.in') {
        contractorName = 'Yashaswi Academy for Skills';
      }
    }

    return contractorName;
  }, [userRole, userEmail]);

  // Filter contractors shown in dropdown based on restriction
  const filteredContractors = useMemo(() => {
    if (userRole === 'App Administrator') return contractors;
    if (allowedContractor) {
      // Always include the allowed contractor, even if it's not in the contractors list
      // This handles cases where the contractor name might have slight variations
      const hasExactMatch = contractors.includes(allowedContractor);
      if (hasExactMatch) {
        return [allowedContractor];
      } else {
        // Add the allowed contractor to the list even if it's not in the fetched contractors
        return [allowedContractor];
      }
    }
    return contractors;
  }, [userRole, contractors, allowedContractor]);

  // Force-select the allowed contractor for App Users when options load or user changes
  // Only run when userRole or allowedContractor changes, NOT when contractor changes
  useEffect(() => {
    if (userRole !== 'App Administrator' && allowedContractor) {
      // Set contractor even if it's not in the contractors list (handles name variations)
      if (contractor !== allowedContractor) {
        console.log(`Setting contractor to ${allowedContractor} for restricted user: ${userEmail}`);
        setContractor(allowedContractor);
      }
    }
    // Removed the else clause that was resetting contractor to 'All' for App Administrators
    // This was preventing users from selecting contractors
  }, [userRole, allowedContractor, userEmail]); // Removed 'contractor' from dependencies

  // Toggle expandable menus
  const toggleMenu = (index) => {
    setExpandedMenus(prev => ({
      ...prev,
      [index]: !prev[index]
    }));
  };

  // Ensure Reports menu stays expanded when on reports pages
  useEffect(() => {
    const reportsIndex = modulesToShow.findIndex(module => module.label === 'Reports');
    if (reportsIndex !== -1) {
      setExpandedMenus(prev => ({
        ...prev,
        [reportsIndex]: true
      }));
    }
  }, [location.pathname, modulesToShow]);


  // Sample activity data with Lucide icons (same as App.js)
  const recentActivities = [
    { icon: <User size={20} />, title: 'New Employee Added', description: 'John Doe joined the development team', time: '2 hours ago' },
    { icon: <BarChart3 size={20} />, title: 'Monthly Report Generated', description: 'Contractor performance report is ready', time: '4 hours ago' },
    { icon: <CheckCircle size={20} />, title: 'Contract Approved', description: 'ABC Construction contract approved', time: '6 hours ago' },
    { icon: <Bell size={20} />, title: 'System Update', description: 'Payroll Management System updated to version 2.1', time: '1 day ago' },
    { icon: <Plus size={20} />, title: 'New Application', description: 'Candidate applied for senior position', time: '2 days ago' }
  ];

  // Fetch overtime data when date range or filters change
  useEffect(() => {
    async function fetchOvertime() {
      setLoading(true);
      setError('');
      try {
        let url = `/server/reports_function/monthly-overtime?startDate=${startDate}&endDate=${endDate}`;
        if (contractor !== 'All') url += `&contractor=${encodeURIComponent(contractor)}`;
        if (department !== 'All') url += `&department=${encodeURIComponent(department)}`;
        const onlyCategories = (Array.isArray(departmentOtApplicableTo) ? departmentOtApplicableTo : [])
          .filter(v => v && v !== 'All');
        if (onlyCategories.length > 0) {
          url += `&designationApplicableTo=${encodeURIComponent(onlyCategories.join(','))}`;
        }
        if (employeeId !== 'All') url += `&employeeId=${encodeURIComponent(employeeId)}`;
        // Include userEmail and userRole for backend filtering
        if (userEmail) url += `&userEmail=${encodeURIComponent(userEmail)}`;
        if (userRole) url += `&userRole=${encodeURIComponent(userRole)}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error('Failed to fetch overtime data');
        const result = await res.json();
        console.log('Monthly OT Report - Received data:', {
          dataLength: result.data?.length || 0,
          dataSource: result.dataSource,
          summary: result.summary,
          sampleData: result.data?.slice(0, 2)
        });
        setTableData(result.data || []);
      } catch (err) {
        setError(err.message || 'Error fetching overtime data');
        setTableData([]);
      } finally {
        setLoading(false);
      }
    }
    fetchOvertime();
  }, [startDate, endDate, contractor, department, departmentOtApplicableTo, employeeId, userEmail, userRole]);

  // Adjust value: payroll OT − report total when fetched payroll row exists (any edit, including to 0)
  useEffect(() => {
    let cancelled = false;
    const month =
      startDate && String(startDate).length >= 7 ? String(startDate).slice(0, 7) : '';
    if (!month) return undefined;

    async function syncAdjustFromPayroll() {
      try {
        let url = `/server/payroll_function/payroll?month=${encodeURIComponent(month)}&_t=${Date.now()}`;
        if (contractor !== 'All') url += `&contractor=${encodeURIComponent(contractor)}`;
        if (department !== 'All') url += `&department=${encodeURIComponent(department)}`;
        if (employeeId !== 'All') url += `&employeeId=${encodeURIComponent(employeeId)}`;
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
          const ids = new Set(tableData.map((r) => String(r.employeeId).trim()));
          for (const row of tableData) {
            const id = String(row.employeeId).trim();
            const reportTotal = parseOtHours(row.totalOvertimeHours);
            const payrollOt = lookupPayrollOt(otMap, id);
            if (payrollOt !== undefined && Number.isFinite(payrollOt)) {
              next[id] = adjustValueFromPayrollSync(payrollOt, reportTotal);
            } else {
              next[id] = '0';
            }
          }
          Object.keys(next).forEach((k) => {
            if (!ids.has(k)) delete next[k];
          });
          return next;
        });
      } catch {
        if (!cancelled) {
          setOtAdjustments((prev) => {
            const next = { ...prev };
            const ids = new Set(tableData.map((r) => String(r.employeeId).trim()));
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
  }, [
    startDate,
    contractor,
    department,
    employeeId,
    userEmail,
    userRole,
    tableData,
  ]);

  // Fetch contractors
  useEffect(() => {
    fetch('/server/reports_function/contractors')
      .then(res => res.json())
      .then(data => setContractors(['All', ...(data.data || [])]))
      .catch(() => setContractors(['All']));
  }, []);

  // Allow refresh of contractors/departments when user opens the dropdown
  const refreshContractors = () => {
    fetch('/server/reports_function/contractors')
      .then(res => res.json())
      .then(data => setContractors(['All', ...(data.data || [])]))
      .catch(() => setContractors(['All']));
  };

  // Fetch departments
  useEffect(() => {
    fetch('/server/reports_function/departments')
      .then(res => res.json())
      .then(data => setDepartments(['All', ...(data.data || [])]))
      .catch(() => setDepartments(['All']));
  }, []);

  // Load saved Category OT Applicable To (used for report filter; config in Setup Configuration → OT)
  useEffect(() => {
    fetch('/server/reports_function/designation-applicable')
      .then(res => res.json())
      .then(data => {
        const savedDepartments = data?.data?.designations || data?.data?.departments || [];
        if (Array.isArray(savedDepartments) && savedDepartments.length > 0) {
          setDepartmentOtApplicableTo(savedDepartments);
        } else {
          setDepartmentOtApplicableTo(['All']);
        }
      })
      .catch(() => setDepartmentOtApplicableTo(['All']));
  }, []);

  const refreshDepartments = () => {
    fetch('/server/reports_function/departments')
      .then(res => res.json())
      .then(data => setDepartments(['All', ...(data.data || [])]))
      .catch(() => setDepartments(['All']));
  };

  // Fetch employee codes, filtered by contractor
  useEffect(() => {
    let url = '/server/reports_function/employee-codes';
    if (contractor && contractor !== 'All') {
      url += `?contractor=${encodeURIComponent(contractor)}`;
    }
    fetch(url)
      .then(res => res.json())
      .then(data => setEmployees(['All', ...(data.data || [])]))
      .catch(() => setEmployees(['All']));
    setEmployeeId('All'); // Reset employeeId when contractor changes
  }, [contractor]);

  // Remove sort menu/outside click logic
  useEffect(() => {
    function handleClick(e) {
      // Only close export menu if it existed (already removed)
      // No need to check sortBtnRef
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

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
                    {/* Debug indicator */}
                    {item.label === 'Reports' && (
                      <span style={{color: 'red', fontSize: '10px', marginLeft: '5px'}}>
                        {expandedMenus[idx] ? 'EXP' : 'COL'}
                      </span>
                    )}
                  </div>
                  <div className="cms-nav-children">
                    {/* Debug info */}
                    {item.label === 'Reports' && (
                      <div style={{color: 'yellow', fontSize: '10px', padding: '5px'}}>
                        Children count: {item.children.length}
                      </div>
                    )}
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

          {/* Dashboard Content */}
          <main className="cms-dashboard-content">
            <div className="employee-card-container">
              <div className="employee-section-title">Monthly OT Report</div>
              <div className="employee-section-subtitle">
                Generate comprehensive overtime reports with advanced filtering and export capabilities
              </div>

              {/* Toolbar Buttons */}
              <div className="employee-toolbar" style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'nowrap', marginBottom: '32px', justifyContent: 'flex-end' }}>
                <button
                  className="toolbar-btn export-btn"
                  onClick={() => {
                    const filename = `monthly_ot_report_${startDate}_to_${endDate}.xls`;
                    const dateRange = generateDateRange(startDate, endDate);
                    const calendarData = transformDataForCalendarView(tableData, dateRange);
                    exportToExcel(calendarData, dateRange, filename, otAdjustments);
                  }}
                  title="Export as Excel"
                  type="button"
                  style={{ background: '#fff', color: '#232323', border: 'none', fontWeight: 600, padding: '8px', borderRadius: '8px', width: '48px', height: '48px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <Download size={22} style={{ color: '#232323' }} />
                </button>
              </div>

              <div className="monthly-ot-filters">
                <div>
                  <label>Start Date:</label>
                  <input 
                    type="date" 
                    value={startDate} 
                    onChange={e => setStartDate(e.target.value)} 
                    max={endDate}
                  />
                </div>
                <div>
                  <label>End Date:</label>
                  <input 
                    type="date" 
                    value={endDate} 
                    onChange={e => setEndDate(e.target.value)} 
                    min={startDate}
                  />
                </div>
                <div>
                  <label>Department:</label>
                  <select
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                    onFocus={refreshDepartments}
                    style={{ width: '100%', padding: '8px', minHeight: '38px' }}
                  >
                    {departments.map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                </div>
                <div className="employee-id-filter-with-export">
                  <label>Employee Code:</label>
                  <select
                    value={employeeId}
                    onChange={(e) => setEmployeeId(e.target.value)}
                    style={{ width: '100%', padding: '8px', minHeight: '38px' }}
                  >
                    {employees.map((emp) => (
                      <option key={emp} value={emp}>{emp}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="monthly-ot-table-container">
                {loading ? (
                  <div style={{ textAlign: 'center', padding: '20px' }}>Loading...</div>
                ) : error ? (
                  <div style={{ textAlign: 'center', padding: '20px', color: 'red' }}>{error}</div>
                ) : (() => {
                  const dateRange = generateDateRange(startDate, endDate);
                  const calendarData = transformDataForCalendarView(tableData, dateRange);
                  
                  return (
                    <div className="muster-table-scroll">
                      <table className="muster-table">
                        <thead>
                          <tr>
                            <th>Employee Code</th>
                            <th>Employee Name</th>
                            <th>Department</th>
                            <th>Category</th>
                            {dateRange.map(date => (
                              <th key={date}>{new Date(date).toLocaleDateString('en-GB')}</th>
                            ))}
                            <th>Total Overtime (hrs)</th>
                            <th>Adjust value</th>
                            <th>Final OT Value</th>
                          </tr>
                        </thead>
                        <tbody>
                          {calendarData.length === 0 ? (
                            <tr>
                              <td colSpan={4 + dateRange.length + 3} style={{ textAlign: 'center', padding: '20px' }}>
                                No overtime data found for the selected date range.
                              </td>
                            </tr>
                          ) : (
                            calendarData.map((emp, idx) => {
                              const totalOt = parseOtHours(emp.totalOvertimeHours);
                              const adj = parseOtHours(otAdjustments[String(emp.employeeId)]);
                              const finalOt = totalOt + adj;
                              return (
                              <tr key={`${emp.employeeId}-${idx}`}>
                                <td>{emp.employeeId}</td>
                                <td>{emp.employeeName}</td>
                                <td>{emp.department}</td>
                                <td>{emp.category || '-'}</td>
                                {dateRange.map(date => {
                                  const dayData = emp.dateData[date];
                                  if (dayData && dayData.overtimeHours !== undefined && dayData.overtimeHours !== null) {
                                    if (dayData.overtimeHours > 0) {
                                      return (
                                        <td key={date} title={`FirstIn: ${dayData.firstIn || '-'}, LastOut: ${dayData.lastOut || '-'}, OT: ${dayData.overtimeHours} hrs`}>
                                          {parseFloat(dayData.overtimeHours).toFixed(2)}
                                        </td>
                                      );
                                    } else if (dayData.firstIn || dayData.lastOut) {
                                      return (
                                        <td key={date} title={`FirstIn: ${dayData.firstIn || '-'}, LastOut: ${dayData.lastOut || '-'}, OT: 0.00 hrs`}>
                                          0.00
                                        </td>
                                      );
                                    }
                                  }
                                  return <td key={date}>-</td>;
                                })}
                                <td>{emp.totalOvertimeHours || '0.00'}</td>
                                <td>
                                  <input
                                    type="number"
                                    step="0.01"
                                    className="monthly-ot-adjust-input"
                                    value={otAdjustments[String(emp.employeeId)] ?? '0'}
                                    onChange={(e) =>
                                      setOtAdjustments((prev) => ({
                                        ...prev,
                                        [String(emp.employeeId)]: e.target.value,
                                      }))
                                    }
                                    placeholder="0"
                                    title="Adjustment in hours (adds to total OT)"
                                  />
                                </td>
                                <td>{finalOt.toFixed(2)}</td>
                              </tr>
                            );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  );
                })()}
              </div>
            </div>
          </main>
        </div>
      </div>
    </>
  );
}
