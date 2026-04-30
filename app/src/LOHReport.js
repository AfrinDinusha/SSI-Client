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
  const headers = ['Date', 'Employee Code', 'Employee Name', 'Department', 'Category', 'FirstIn', 'LastOut', 'Loss of Minutes', 'Loss of Hours (hrs)'];
  csvRows.push(headers.join(','));
  for (const row of data) {
    csvRows.push([
      row.date || '',
      row.employeeId,
      row.employeeName,
      row.department,
      row.category || '',
      row.firstIn || '',
      row.lastOut || '',
      row.lossOfMinutes,
      row.lossOfHours
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

function exportToExcel(calendarData, dateRange, filename) {
  // Simple Excel export using HTML table with date-wise columns
  let table = '<table><tr><th>Employee Code</th><th>Employee Name</th><th>Department</th><th>Category</th>';
  
  // Add date columns
  dateRange.forEach(date => {
    const dateStr = new Date(date).toLocaleDateString('en-GB');
    table += `<th>${dateStr}</th>`;
  });
  
  // Add total column
  table += '<th>Total Hours</th></tr>';
  
  // Add data rows
  for (const emp of calendarData) {
    table += `<tr><td>${emp.employeeId}</td><td>${emp.employeeName}</td><td>${emp.department || ''}</td><td>${emp.category || ''}</td>`;
    
    // Add date-wise LOH data
    dateRange.forEach(date => {
      const dayData = emp.dateData[date];
      if (dayData && dayData.lossOfHours !== undefined && dayData.lossOfHours !== null) {
        table += `<td>${dayData.lossOfHours}</td>`;
      } else {
        table += `<td>-</td>`;
      }
    });
    
    // Add total LOH hours
    table += `<td>${emp.totalHours || '0.00'}</td></tr>`;
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

export default function LOHReport({ userRole = 'App Administrator', userEmail = null, reportType = 'loh' }) {
  const navigate = useNavigate();
  const location = useLocation();
  const isMissPunch = reportType === 'misspunch';
  
  // Sidebar state
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
        'afrindinusha29@gmail.com': 'Sriram Enterprises',
        'sriramenterprises50@yahoo.com': 'Sriram Enterprises',
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
  const [employeeId, setEmployeeId] = useState('All');
  const [grace, setGrace] = useState('');
  const [designationLohApplicableTo, setDesignationLohApplicableTo] = useState(['All']);
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
          dateData: {}
        };
      }
      // Store LOH data by date - normalize date to YYYY-MM-DD format
      let dateKey = row.date || startDate;
      // Ensure date is in YYYY-MM-DD format to match dateRange
      if (dateKey && dateKey.includes('/')) {
        // Convert DD/MM/YYYY or MM/DD/YYYY to YYYY-MM-DD
        const parts = dateKey.split('/');
        if (parts.length === 3) {
          dateKey = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
        }
      } else if (dateKey && dateKey.includes('-') && dateKey.length === 10) {
        // Already in YYYY-MM-DD format or similar
        dateKey = dateKey;
      }
      employeeMap[empKey].dateData[dateKey] = {
        lossOfMinutes: row.lossOfMinutes,
        lossOfHours: row.lossOfHours,
        missingType: row.missingType || '',
        firstIn: row.firstIn || '',
        lastOut: row.lastOut || ''
      };
    });
    
    // Convert to array and ensure all dates are represented, and calculate total hours
    return Object.values(employeeMap).map(emp => {
      const dateDataWithAllDates = dateRange.reduce((acc, date) => {
        acc[date] = emp.dateData[date] || null;
        return acc;
      }, {});
      
      // Calculate total value across all dates.
      const totalHours = Object.values(dateDataWithAllDates).reduce((sum, dayData) => {
        if (dayData && isMissPunch) {
          return sum + 1;
        }
        if (dayData && dayData.lossOfHours !== undefined && dayData.lossOfHours !== null) {
          const hours = parseFloat(dayData.lossOfHours) || 0;
          return sum + hours;
        }
        return sum;
      }, 0);
      
      return {
        ...emp,
        dateData: dateDataWithAllDates,
        totalHours: totalHours.toFixed(2)
      };
    });
  };

  // Dropdown state
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

  // Fetch LOH data from reports function when date/month or filters change
  useEffect(() => {
    async function fetchLOHData() {
      setLoading(true);
      setError('');
      try {
        // Build URL with date range filter
        let url = `/server/reports_function/${isMissPunch ? 'misspunch' : 'loh'}?_t=${Date.now()}`;
        url += `&startDate=${startDate}&endDate=${endDate}`;
        if (contractor !== 'All') url += `&contractor=${encodeURIComponent(contractor)}`;
        if (department !== 'All') url += `&department=${encodeURIComponent(department)}`;
        if (!isMissPunch && Array.isArray(designationLohApplicableTo)) {
          const onlyCategories = designationLohApplicableTo.filter(v => v && v !== 'All');
          if (onlyCategories.length > 0) {
            url += `&designationApplicableTo=${encodeURIComponent(onlyCategories.join(','))}`;
          }
        }
        if (!isMissPunch && grace !== '') url += `&grace=${encodeURIComponent(grace)}`;
        if (employeeId !== 'All') url += `&employeeId=${encodeURIComponent(employeeId)}`;
        // Include userEmail and userRole for backend filtering
        if (userEmail) url += `&userEmail=${encodeURIComponent(userEmail)}`;
        if (userRole) url += `&userRole=${encodeURIComponent(userRole)}`;
        
        const res = await fetch(url);
        if (!res.ok) throw new Error('Failed to fetch LOH data');
        const result = await res.json();

        // Process the LOH data from the backend
        const lohData = (result.data || []).map(row => ({
          employeeId: row.employeeId,
          employeeName: row.employeeName,
          department: row.department,
          category: row.category || '',
          designation: row.designation || '',
          contractorName: row.contractorName,
          lossOfMinutes: row.lossOfMinutes ?? Math.round(parseFloat(row.lossOfHours) * 60),
          lossOfHours: row.lossOfHours || '0.00',
          missingType: row.missingType || '',
          date: row.date || startDate,
          firstIn: row.firstIn || '',
          lastOut: row.lastOut || ''
        }));

        // Backend already filters by contractor, department, and employeeId
        // So we don't need to filter again by the employee dropdown list
        // This ensures that contractor filter works correctly
        setTableData(lohData);
      } catch (err) {
        setError(err.message || 'Error fetching LOH data');
        setTableData([]);
      } finally {
        setLoading(false);
      }
    }
    fetchLOHData();
  }, [startDate, endDate, contractor, department, designationLohApplicableTo, grace, employeeId, employees, isMissPunch]);

  // Fetch contractors from payroll function
  useEffect(() => {
    fetch('/server/payroll_function/contractors')
      .then(res => res.json())
      .then(data => setContractors(['All', ...(data.data || [])]))
      .catch(() => setContractors(['All']));
  }, []);

  // Allow refresh of contractors/departments when user opens the dropdown
  const refreshContractors = () => {
    fetch('/server/payroll_function/contractors')
      .then(res => res.json())
      .then(data => setContractors(['All', ...(data.data || [])]))
      .catch(() => setContractors(['All']));
  };

  // Fetch departments from payroll function
  useEffect(() => {
    fetch('/server/payroll_function/departments')
      .then(res => res.json())
      .then(data => setDepartments(['All', ...(data.data || [])]))
      .catch(() => setDepartments(['All']));
  }, []);

  useEffect(() => {
    fetch('/server/reports_function/loh-designation-applicable')
      .then(res => res.json())
      .then(data => {
        const savedDesignations = data?.data?.designations || [];
        if (Array.isArray(savedDesignations) && savedDesignations.length > 0) {
          setDesignationLohApplicableTo(savedDesignations);
        } else {
          setDesignationLohApplicableTo(['All']);
        }
        const savedGrace = data?.data?.grace;
        if (savedGrace !== undefined && savedGrace !== null && String(savedGrace).trim() !== '') {
          setGrace(String(savedGrace).trim());
        }
      })
      .catch(() => setDesignationLohApplicableTo(['All']));
  }, []);

  const refreshDepartments = () => {
    fetch('/server/payroll_function/departments')
      .then(res => res.json())
      .then(data => setDepartments(['All', ...(data.data || [])]))
      .catch(() => setDepartments(['All']));
  };

  // Fetch employee codes from payroll function, filtered by contractor
  useEffect(() => {
    let url = '/server/payroll_function/employee-codes';
    if (contractor && contractor !== 'All') {
      url += `?contractor=${encodeURIComponent(contractor)}`;
    }
    fetch(url)
      .then(res => res.json())
      .then(data => setEmployees(['All', ...(data.data || [])]))
      .catch(() => setEmployees(['All']));
    setEmployeeId('All'); // Reset employeeId when contractor changes
  }, [contractor]);

  // Prepare options for react-select
  // Ensure selected contractor is always in the options (case-insensitive matching)
  const contractorOptions = useMemo(() => {
    const options = filteredContractors.map(c => ({ value: c, label: c }));
    // If contractor is selected but not in options, add it
    if (contractor && contractor !== 'All') {
      const exists = options.some(opt => opt.value.toLowerCase() === contractor.toLowerCase());
      if (!exists) {
        // Add the contractor to options so react-select can find it
        options.push({ value: contractor, label: contractor });
      }
    }
    return options;
  }, [filteredContractors, contractor]);
  
  const departmentOptions = departments.map(d => ({ value: d, label: d }));
  const employeeOptions = employees.map(e => ({ value: e, label: e }));

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
            <div className="employee-card-container">
              <div className="employee-section-title" style={{ fontSize: '2rem', marginBottom: '0.25rem' }}>
                {isMissPunch ? 'Miss Punch Report' : 'Loss of Hours (LOH) Report'}
              </div>
              <div className="employee-section-subtitle" style={{ fontSize: '1rem', marginBottom: '1.25rem' }}>
                {isMissPunch
                  ? 'Automatically displays employees with missing check-in or check-out punches for the selected date range.'
                  : 'Automatically displays employees who worked more than 0 hours but less than 8 hours (excluding 0 hours and exactly 8 hours) from BHR data. Select a date range to view LOH report.'}
              </div>

              {/* Toolbar Buttons */}
              <div className="employee-toolbar" style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'nowrap', marginBottom: '20px', justifyContent: 'flex-end', background: 'transparent', border: 'none', padding: 0 }}>
                <button
                  className="toolbar-btn export-btn"
                  onClick={() => {
                    const filename = `${isMissPunch ? 'misspunch_report' : 'loh_report'}_${startDate}_to_${endDate}.xls`;
                    const dateRange = generateDateRange(startDate, endDate);
                    const calendarData = transformDataForCalendarView(tableData, dateRange);
                    exportToExcel(calendarData, dateRange, filename);
                  }}
                  title="Export as Excel"
                  type="button"
                  style={{ background: '#fff', color: '#232323', border: '1px solid #d9dee8', fontWeight: 500, padding: '6px', borderRadius: '8px', width: '40px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px' }}
                >
                  <Download size={18} style={{ color: '#232323' }} />
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
                    style={{ width: '100%', padding: '8px 12px' }}
                  >
                    {departmentOptions.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <div className="employee-id-filter-with-export">
                  <label>Employee Code:</label>
                  <select
                    value={employeeId}
                    onChange={(e) => setEmployeeId(e.target.value)}
                    style={{ width: '100%', padding: '8px 12px' }}
                  >
                    {employeeOptions.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
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
                  
                  if (calendarData.length === 0) {
                    return <div style={{ textAlign: 'center', padding: '20px' }}>{isMissPunch ? 'No employees found with missing punch for the selected date range.' : 'No employees found with less than 8 hours for the selected date range.'}</div>;
                  }
                  
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
                            <th>{isMissPunch ? 'Total Missing Days' : 'Total Hours'}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {calendarData.map((emp, idx) => (
                            <tr key={`${emp.employeeId}-${idx}`}>
                              <td>{emp.employeeId}</td>
                              <td>{emp.employeeName}</td>
                              <td>{emp.department}</td>
                              <td>{emp.category || '-'}</td>
                              {dateRange.map(date => {
                                const dayData = emp.dateData[date];
                                if (dayData && dayData.lossOfHours !== undefined && dayData.lossOfHours !== null) {
                                  return (
                                    <td key={date} title={`FirstIn: ${dayData.firstIn || '-'}, LastOut: ${dayData.lastOut || '-'}`}>
                                      {isMissPunch ? (dayData.missingType || dayData.lossOfHours || '-') : dayData.lossOfHours}
                                    </td>
                                  );
                                }
                                return <td key={date}>-</td>;
                              })}
                              <td>{emp.totalHours || '0.00'}</td>
                            </tr>
                          ))}
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
