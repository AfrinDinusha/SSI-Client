import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import './App.css';
import './DeviationRecords.css';
import './employeeManagement.css';
import './Candidateform.css';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import Button from './Button';
import HeaderBranding from './HeaderBranding';
import { getSidebarModulesForUser, resolveSidebarUserEmail } from './modulesConfig';
import * as XLSX from 'xlsx';
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

function DeviationRecords({ userRole = 'App Administrator', userEmail = null }) {
  const navigate = useNavigate();
  const location = useLocation();
  
  // Sidebar state
  const [expandedMenus, setExpandedMenus] = useState({});
  const [showSidebarMenu, setShowSidebarMenu] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  
  const [shiftmaps, setShiftmaps] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [attendanceSummary, setAttendanceSummary] = useState([]);
  const [fetchError, setFetchError] = useState('');
  const [loading, setLoading] = useState(true);
  const [exportLoading, setExportLoading] = useState(false);

  const modulesToShow = useMemo(
    () => getSidebarModulesForUser(resolveSidebarUserEmail(userEmail), userRole),
    [userEmail, userRole]
  );

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

  // User info
  const userAvatar = "https://images.pexels.com/photos/2379004/pexels-photo-2379004.jpeg?auto=compress&cs=tinysrgb&w=150";
  const userName = userRole === 'App Administrator' ? 'Admin User' : 'App User';

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
    Promise.all([
      axios.get('/server/Shiftmap_function/shiftmaps'),
      axios.get('/server/cms_function/employees'),
      axios.get('/server/Shift_function/shifts'),
      axios.get('/server/Department_function/departments')
    ])
      .then(([shiftmapRes, empRes, shiftRes, depRes]) => {
        setShiftmaps(shiftmapRes.data.data.shiftmaps || []);
        setEmployees(empRes.data.data.employees || []);
        setShifts(shiftRes.data.data.shifts || []);
        setDepartments(depRes.data.data.departments || []);
        setFetchError('');
      })
      .catch(() => setFetchError('Failed to fetch data.'))
      .finally(() => setLoading(false));
  }, []);

  // Fetch attendance summary for the date range of all shiftmaps
  useEffect(() => {
    if (shiftmaps.length === 0) return;
    const dates = shiftmaps.flatMap(sm => [sm.fromdate, sm.todate]);
    const minDate = dates.reduce((a, b) => a < b ? a : b);
    const maxDate = dates.reduce((a, b) => a > b ? a : b);
    axios.get(`/server/GetAttendanceList?summary=true&startDate=${minDate}&endDate=${maxDate}`)
      .then(res => {
        setAttendanceSummary(res.data.data || []);
      })
      .catch(() => setFetchError('Failed to fetch attendance summary.'));
  }, [shiftmaps]);

  // Helper: get Employee Name by id
  const getEmployeeName = (id) => {
    const emp = employees.find(e => String(e.id) === String(id));
    return emp ? (emp.employeeName || emp.name || '') : '';
  };

  // Helper: get Employee Code by id
  const getEmployeeCode = (id) => {
    const emp = employees.find(e => String(e.id) === String(id));
    return emp ? emp.employeeCode : id;
  };

  // Helper: get Department Name by employeeId
  const getDepartmentName = (employeeId) => {
    const emp = employees.find(e => String(e.id) === String(employeeId));
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

  // Helper: get Shift Name by id
  const getShiftName = (id) => {
    const shift = shifts.find(s => s.id === id);
    return shift ? shift.shiftName : id;
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

  // Export functionality
  const handleExport = () => {
    if (deviationRecords.length === 0) {
      alert('No deviation records to export.');
      return;
    }

    setExportLoading(true);

    try {
      // Prepare data for export
      const exportData = deviationRecords.map((record, index) => ({
        'S.No': index + 1,
        'Employee Code': record.employeeCode,
        'Employee Name': record.employeeName,
        'Department': record.department,
        'Shift': record.shiftName,
        'Date': record.date,
        'Assigned Shift': record.assignedShift,
        'First In': record.firstIn,
        'Last Out': record.lastOut,
        'Deviation Status': record.status
      }));

      // Create workbook and worksheet
      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.json_to_sheet(exportData);

      // Set column widths
      const columnWidths = [
        { wch: 8 },   // S.No
        { wch: 15 },  // Employee Code
        { wch: 20 },  // Employee Name
        { wch: 15 },  // Department
        { wch: 15 },  // Shift
        { wch: 12 },  // Date
        { wch: 15 },  // Assigned Shift
        { wch: 12 },  // First In
        { wch: 12 },  // Last Out
        { wch: 20 }   // Deviation Status
      ];
      worksheet['!cols'] = columnWidths;

      // Add worksheet to workbook
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Deviation Records');

      // Generate filename with current date
      const currentDate = new Date().toISOString().split('T')[0];
      const fileName = `Deviation_Records_${currentDate}.xlsx`;

      // Save file
      XLSX.writeFile(workbook, fileName);

      setExportLoading(false);
    } catch (error) {
      console.error('Export error:', error);
      alert('Failed to export deviation records. Please try again.');
      setExportLoading(false);
    }
  };

  // Filter only records with deviations
  const deviationRecords = shiftmaps.flatMap((sm) => {
    const emp = employees.find(e => String(e.id) === String(sm.employeeId));
    if (!emp) return [];

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

    return dateRange.map((date) => {
      const attendance = attendanceSummary.find(
        row => String(row.EmployeeID) === String(emp?.employeeCode) && row.Date === date
      );
      const firstIn = attendance ? extractTime(attendance.FirstIN) : '-';
      const lastOut = attendance ? extractTime(attendance.LastOUT) : '-';
      const status = getDeviationStatus(sm.assignedShift, firstIn);

      // Only return records with deviations
      if (!status || status === 'No Check-in') return null;

      return {
        id: `${sm.id}-${date}`,
        employeeId: sm.employeeId,
        employeeCode: getEmployeeCode(sm.employeeId),
        employeeName: getEmployeeName(sm.employeeId),
        department: getDepartmentName(sm.employeeId),
        shiftName: getShiftName(sm.shiftId),
        date: date,
        assignedShift: sm.assignedShift || '-',
        firstIn: firstIn,
        lastOut: lastOut,
        status: status
      };
    }).filter(record => record !== null);
  });

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
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
                <div>
                  <div className="employee-section-title">Employee Deviation Records</div>
                  <div className="employee-section-subtitle">
                    Track and manage employee attendance deviations with detailed reporting
                  </div>
                </div>
                
                {/* Export Button - Right Side */}
                <button
                  className="toolbar-btn export-btn"
                  onClick={handleExport}
                  disabled={exportLoading || deviationRecords.length === 0}
                  title="Export deviation records to Excel"
                  type="button"
                  style={{ background: '#fff', color: '#232323', border: 'none', fontWeight: 600, padding: '8px 12px' }}
                >
                  <i className="fas fa-file-export" style={{ color: '#232323' }}></i>
                </button>
              </div>

              {fetchError && (
                <div className="alert alert-error">
                  <span className="alert-icon">⚠️</span>
                  {fetchError}
                </div>
              )}

              <div className="employee-table-container">
                {loading ? (
                  <div className="loading-container">
                    <div className="loading-spinner"></div>
                    <p className="loading-text">Loading deviation records...</p>
                  </div>
                ) : (
                                     <table className="employee-table">
                     <thead>
                       <tr>
                         <th style={{ textAlign: 'center' }}>Employee Code</th>
                         <th style={{ textAlign: 'center' }}>Employee Name</th>
                         <th style={{ textAlign: 'center' }}>Department</th>
                         <th style={{ textAlign: 'center' }}>Shift</th>
                         <th style={{ textAlign: 'center' }}>Date</th>
                         <th style={{ textAlign: 'center' }}>Assigned Shift</th>
                         <th style={{ textAlign: 'center' }}>First In</th>
                         <th style={{ textAlign: 'center' }}>Last Out</th>
                         <th style={{ textAlign: 'center' }}>Deviation Status</th>
                       </tr>
                     </thead>
                     <tbody>
                       {deviationRecords.length > 0 ? (
                         deviationRecords.map((record) => (
                           <tr key={record.id}>
                             <td style={{ textAlign: 'center' }}>{record.employeeCode}</td>
                             <td style={{ textAlign: 'center' }}>{record.employeeName}</td>
                             <td style={{ textAlign: 'center' }}>{record.department}</td>
                             <td style={{ textAlign: 'center' }}>{record.shiftName}</td>
                             <td style={{ textAlign: 'center' }}>{record.date}</td>
                             <td style={{ textAlign: 'center' }}>{record.assignedShift}</td>
                             <td style={{ textAlign: 'center' }}>{record.firstIn}</td>
                             <td style={{ textAlign: 'center' }}>{record.lastOut}</td>
                             <td style={{ textAlign: 'center' }}>
                               <span className={`deviation-status ${record.status === 'Come in general shift' ? 'warning' : 'error'}`}>
                                 {record.status}
                               </span>
                             </td>
                           </tr>
                         ))
                       ) : (
                         <tr>
                           <td colSpan={9} style={{ textAlign: 'center' }}>
                             No deviation records found.
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

export default DeviationRecords;
