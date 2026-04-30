import React, { useState, useEffect, useMemo } from 'react';
import './App.css';
import './reports.css';
import './LateInReport.css';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import Button from './Button';
import HeaderBranding from './HeaderBranding';
import { getSidebarModulesForUser, resolveSidebarUserEmail } from './modulesConfig';
import {
  Users, Calendar, FileText, AlertTriangle, FolderOpen,
  ClipboardList, Building, Landmark, Clock, BarChart3, User,
  Activity, Plus, CheckCircle, Bell, Settings, LayoutDashboard, Home as HomeIcon, Clock3, CalendarDays, Download
} from 'lucide-react';

function formatLateBy(minutes) {
  if (minutes === '' || minutes == null) return '-';
  const m = Number(minutes);
  if (isNaN(m)) return '-';
  const hrs = (m / 60).toFixed(2);
  return `${m} min (${hrs} hr)`;
}

// Generate array of dates between start and end (YYYY-MM-DD)
function generateDateRange(start, end) {
  const dates = [];
  const startObj = new Date(start);
  const endObj = new Date(end);
  const current = new Date(startObj);
  while (current <= endObj) {
    dates.push(current.toISOString().slice(0, 10));
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

// Format YYYY-MM-DD to DD/MM/YYYY for header
function formatDateHeader(dateStr) {
  if (!dateStr || dateStr.length < 10) return dateStr;
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

// Pivot raw rows into one row per employee with date columns (Miss Punch report model)
function transformToDateColumns(rawData, dateRange) {
  const byEmployee = {};
  rawData.forEach((row) => {
    const key = row.employeeId;
    if (!byEmployee[key]) {
      byEmployee[key] = {
        employeeId: row.employeeId,
        employeeName: row.employeeName || '',
        department: row.department || '',
        dateData: {}
      };
    }
    const dateKey = row.date && row.date.slice(0, 10);
    if (dateKey) {
      byEmployee[key].dateData[dateKey] = formatLateBy(row.lateByMinutes);
    }
  });
  return Object.values(byEmployee);
}

function exportToCSV(calendarData, dateRange, filename) {
  const headerRow = ['Employee Code', 'Employee Name', 'Department', ...dateRange.map(formatDateHeader)];
  const csvRows = [headerRow.join(',')];
  calendarData.forEach((emp) => {
    const row = [
      emp.employeeId,
      emp.employeeName,
      emp.department || '',
      ...dateRange.map((d) => emp.dateData[d] || '-')
    ];
    csvRows.push(row.map((cell) => (typeof cell === 'string' && cell.includes(',')) ? `"${cell}"` : cell).join(','));
  });
  const csvString = csvRows.join('\n');
  const blob = new Blob([csvString], { type: 'text/csv' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  window.URL.revokeObjectURL(url);
}

export default function LateInReport({ userRole = 'App Administrator', userEmail = null }) {
  const navigate = useNavigate();
  const location = useLocation();

  const [expandedMenus, setExpandedMenus] = useState({});
  const [showSidebarMenu, setShowSidebarMenu] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);

  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [department, setDepartment] = useState('All');
  const [employeeId, setEmployeeId] = useState('All');
  const [grace, setGrace] = useState('10');
  const [tableData, setTableData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [departments, setDepartments] = useState(['All']);
  const [employees, setEmployees] = useState(['All']);

  const modulesToShow = useMemo(
    () => getSidebarModulesForUser(resolveSidebarUserEmail(userEmail), userRole),
    [userEmail, userRole]
  );

  // Fetch grace (minutes) from Setup Configuration → LOH so Late In Report uses the same value
  useEffect(() => {
    fetch('/server/reports_function/loh-designation-applicable')
      .then(res => res.json())
      .then(data => {
        const savedGrace = data?.data?.grace;
        if (savedGrace !== undefined && savedGrace !== null && String(savedGrace).trim() !== '') {
          setGrace(String(savedGrace).trim());
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const reportsIndex = modulesToShow.findIndex(module => module.label === 'Reports');
    if (reportsIndex !== -1) {
      setExpandedMenus(prev => ({ ...prev, [reportsIndex]: true }));
    }
  }, [location.pathname, modulesToShow]);

  useEffect(() => {
    async function fetchLateInData() {
      setLoading(true);
      setError('');
      try {
        let url = `/server/reports_function/latein?_t=${Date.now()}`;
        url += `&startDate=${startDate}&endDate=${endDate}`;
        if (department !== 'All') url += `&department=${encodeURIComponent(department)}`;
        if (employeeId !== 'All') url += `&employeeId=${encodeURIComponent(employeeId)}`;
        if (grace !== '' && /^\d+$/.test(grace)) url += `&grace=${encodeURIComponent(grace)}`;
        if (userEmail) url += `&userEmail=${encodeURIComponent(userEmail)}`;
        if (userRole) url += `&userRole=${encodeURIComponent(userRole)}`;

        const res = await fetch(url);
        if (!res.ok) throw new Error('Failed to fetch Late In data');
        const result = await res.json();
        const rows = (result.data || []).map(row => ({
          employeeId: row.employeeId,
          employeeName: row.employeeName,
          department: row.department || '',
          date: row.date || startDate,
          firstIn: row.firstIn || '',
          expectedIn: row.expectedIn || '',
          lateByMinutes: row.lateByMinutes != null ? row.lateByMinutes : ''
        }));
        setTableData(rows);
      } catch (err) {
        setError(err.message || 'Error fetching Late In data');
        setTableData([]);
      } finally {
        setLoading(false);
      }
    }
    fetchLateInData();
  }, [startDate, endDate, department, employeeId, grace, userRole, userEmail]);

  useEffect(() => {
    fetch('/server/payroll_function/departments')
      .then(res => res.json())
      .then(data => setDepartments(['All', ...(data.data || [])]))
      .catch(() => setDepartments(['All']));
  }, []);

  useEffect(() => {
    fetch('/server/payroll_function/employee-codes')
      .then(res => res.json())
      .then(data => setEmployees(['All', ...(data.data || [])]))
      .catch(() => setEmployees(['All']));
  }, []);

  const toggleMenu = (index) => {
    setExpandedMenus(prev => ({ ...prev, [index]: !prev[index] }));
  };

  const recentActivities = [
    { icon: <User size={20} />, title: 'New Employee Added', description: 'John Doe joined the development team', time: '2 hours ago' },
    { icon: <BarChart3 size={20} />, title: 'Monthly Report Generated', description: 'Contractor performance report is ready', time: '4 hours ago' },
    { icon: <CheckCircle size={20} />, title: 'Contract Approved', description: 'ABC Construction contract approved', time: '6 hours ago' },
  ];

  const departmentOptions = departments.map(d => ({ value: d, label: d }));
  const employeeOptions = employees.map(e => ({ value: e, label: e }));

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
                    <span></span>
                    <span></span>
                    <span></span>
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
                    {item.children.map(child => (
                      <Link to={child.path} key={child.label} className={`cms-nav-child ${child.path === '/latein-report' ? 'active' : ''}`}>
                        <span className="cms-nav-icon">{child.icon}</span>
                        <span className="cms-nav-label">{child.label}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              ) : (
                <Link
                  to={item.path}
                  className={`cms-nav-item ${['/loh-report', '/onduty', '/grace', '/compoff', '/calendar', '/latein-report'].includes(item.path) ? 'clock-color-icon' : ''}`}
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
              <p>App Administrator</p>
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
            <div className="employee-card-container">
              <div className="employee-section-title" style={{ fontSize: '2rem', marginBottom: '0.25rem' }}>
                Late In Report
              </div>
              <div className="employee-section-subtitle" style={{ fontSize: '1rem', marginBottom: '0.25rem' }}>
                Displays employees who came in after the grace period for the selected date range. Select start and end date, department, employee code, and grace (minutes) to view the report.
              </div>
              <div className="latein-date-range-header" style={{ fontSize: '1rem', marginBottom: '1.25rem', fontWeight: 600, color: '#1e40af' }}>
                {formatDateHeader(startDate)} to {formatDateHeader(endDate)}
              </div>

              <div className="employee-toolbar" style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'nowrap', marginBottom: '20px', justifyContent: 'flex-end', background: 'transparent', border: 'none', padding: 0 }}>
                <button
                  className="toolbar-btn export-btn"
                  onClick={() => {
                    const filename = `latein_report_${startDate}_to_${endDate}.csv`;
                    const dateRange = generateDateRange(startDate, endDate);
                    const calendarData = transformToDateColumns(tableData, dateRange);
                    exportToCSV(calendarData, dateRange, filename);
                  }}
                  title="Download CSV"
                  type="button"
                  style={{ background: '#fff', color: '#232323', border: '1px solid #d9dee8', fontWeight: 500, padding: '6px', borderRadius: '8px', width: '40px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px' }}
                >
                  <Download size={18} style={{ color: '#232323' }} />
                </button>
              </div>

              <div className="monthly-ot-filters latein-filters">
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
                    style={{ width: '100%', padding: '8px 12px' }}
                  >
                    {departmentOptions.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <div>
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
                <div>
                  <label>Grace (minutes):</label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={grace}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === '' || /^\d+$/.test(val)) setGrace(val);
                    }}
                    placeholder="Enter grace (minutes)"
                    style={{ width: '100%', padding: '8px 12px' }}
                  />
                </div>
              </div>

              <div className="monthly-ot-table-container">
                {loading ? (
                  <div style={{ textAlign: 'center', padding: '20px' }}>Loading...</div>
                ) : error ? (
                  <div style={{ textAlign: 'center', padding: '20px', color: 'red' }}>{error}</div>
                ) : tableData.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '20px' }}>No employees found coming in after the grace period for the selected date range.</div>
                ) : (() => {
                  const dateRange = generateDateRange(startDate, endDate);
                  const calendarData = transformToDateColumns(tableData, dateRange);
                  return (
                    <div className="muster-table-scroll">
                      <table className="muster-table latein-table">
                        <thead>
                          <tr>
                            <th>Employee Code</th>
                            <th>Employee Name</th>
                            <th>Department</th>
                            {dateRange.map((d) => (
                              <th key={d}>{formatDateHeader(d)}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {calendarData.map((emp, idx) => (
                            <tr key={`${emp.employeeId}-${idx}`}>
                              <td>{emp.employeeId}</td>
                              <td>{emp.employeeName}</td>
                              <td>{emp.department || '-'}</td>
                              {dateRange.map((d) => (
                                <td key={d}>{emp.dateData[d] || '-'}</td>
                              ))}
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
