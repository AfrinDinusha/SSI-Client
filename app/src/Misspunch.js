import React, { useState, useEffect, useMemo } from 'react';
import './App.css';
import './reports.css';
import './Misspunch.css';
import { useLocation, Link } from 'react-router-dom';
import Button from './Button';
import HeaderBranding from './HeaderBranding';
import { getSidebarModulesForUser, resolveSidebarUserEmail } from './modulesConfig';
import {
  BarChart3, User, Plus, CheckCircle, Bell, LayoutDashboard, Home as HomeIcon, Clock3, Download
} from 'lucide-react';

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

// Pivot raw rows into one row per employee with date columns
function transformToDateColumns(rawData, dateRange) {
  const byEmployee = {};
  rawData.forEach((row) => {
    const key = row.employeeId;
    const firstIn = row.firstIn || '';
    const lastOut = row.lastOut || '';
    const missingType = row.missingType || 'Missing Punch';

    if (!byEmployee[key]) {
      byEmployee[key] = {
        employeeId: row.employeeId,
        employeeName: row.employeeName || '',
        department: row.department || '',
        category: row.category || '',
        dateData: {}
      };
    }
    const dateKey = row.date && row.date.slice(0, 10);
    if (dateKey) {
      const fiText = firstIn || '-';
      const loText = lastOut || '-';
      // Single punch (same time): show as "18:33-18:33"
      if (missingType === 'Missing Punch' && fiText === loText && fiText !== '-') {
        byEmployee[key].dateData[dateKey] = `${fiText}-${loText}`;
      } else {
        byEmployee[key].dateData[dateKey] = `${missingType}: FI ${fiText}, LO ${loText}`;
      }
    }
  });
  return Object.values(byEmployee);
}

function exportToCSV(calendarData, dateRange, filename) {
  const headerRow = ['Employee Code', 'Employee Name', 'Department', 'Category', ...dateRange.map(formatDateHeader)];
  const csvRows = [headerRow.join(',')];
  calendarData.forEach((emp) => {
    const row = [
      emp.employeeId,
      emp.employeeName,
      emp.department || '',
      emp.category || '',
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

export default function Misspunch({ userRole = 'App Administrator', userEmail = null }) {
  const location = useLocation();

  const [expandedMenus, setExpandedMenus] = useState({});
  const [showNotifications, setShowNotifications] = useState(false);

  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [department, setDepartment] = useState('All');
  const [category, setCategory] = useState('All');
  const [employeeId, setEmployeeId] = useState('All');
  const [tableData, setTableData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [departments, setDepartments] = useState(['All']);
  const [categories, setCategories] = useState(['All']);
  const [employees, setEmployees] = useState(['All']);

  const modulesToShow = useMemo(
    () => getSidebarModulesForUser(resolveSidebarUserEmail(userEmail), userRole),
    [userEmail, userRole]
  );

  useEffect(() => {
    const reportsIndex = modulesToShow.findIndex((m) => m.label === 'Reports');
    if (reportsIndex !== -1) {
      setExpandedMenus((prev) => ({ ...prev, [reportsIndex]: true }));
    }
  }, [location.pathname, modulesToShow]);

  useEffect(() => {
    async function fetchMisspunchData() {
      setLoading(true);
      setError('');
      try {
        let url = `/server/reports_function/misspunch?_t=${Date.now()}`;
        url += `&startDate=${startDate}&endDate=${endDate}`;
        if (department !== 'All') url += `&department=${encodeURIComponent(department)}`;
        if (category !== 'All') url += `&category=${encodeURIComponent(category)}`;
        if (employeeId !== 'All') url += `&employeeId=${encodeURIComponent(employeeId)}`;
        if (userEmail) url += `&userEmail=${encodeURIComponent(userEmail)}`;
        if (userRole) url += `&userRole=${encodeURIComponent(userRole)}`;

        const res = await fetch(url);
        if (!res.ok) throw new Error('Failed to fetch Miss Punch data');
        const result = await res.json();
        const rows = (result.data || []).map((row) => ({
          employeeId: row.employeeId,
          employeeName: row.employeeName,
          department: row.department || '',
          category: row.category || '',
          date: row.date || startDate,
          firstIn: row.firstIn || '',
          lastOut: row.lastOut || '',
          missingType: row.missingType || 'Missing Punch'
        }));
        setTableData(rows);
      } catch (err) {
        setError(err.message || 'Error fetching Miss Punch data');
        setTableData([]);
      } finally {
        setLoading(false);
      }
    }
    fetchMisspunchData();
  }, [startDate, endDate, department, category, employeeId, userRole, userEmail]);

  useEffect(() => {
    fetch('/server/payroll_function/departments')
      .then((res) => res.json())
      .then((data) => setDepartments(['All', ...(data.data || [])]))
      .catch(() => setDepartments(['All']));
  }, []);

  useEffect(() => {
    const params = new URLSearchParams();
    if (userEmail) params.set('userEmail', userEmail);
    if (userRole) params.set('userRole', userRole);
    const query = params.toString();
    fetch(`/server/cms_function/employees/categories${query ? `?${query}` : ''}`)
      .then((res) => res.json())
      .then((data) => setCategories(['All', ...((data.data?.categories) || [])]))
      .catch(() => setCategories(['All']));
  }, [userEmail, userRole]);

  useEffect(() => {
    fetch('/server/payroll_function/employee-codes')
      .then((res) => res.json())
      .then((data) => setEmployees(['All', ...(data.data || [])]))
      .catch(() => setEmployees(['All']));
  }, []);

  const toggleMenu = (index) => {
    setExpandedMenus((prev) => ({ ...prev, [index]: !prev[index] }));
  };

  const recentActivities = [
    { icon: <User size={20} />, title: 'New Employee Added', description: 'John Doe joined the development team', time: '2 hours ago' },
    { icon: <BarChart3 size={20} />, title: 'Monthly Report Generated', description: 'Contractor performance report is ready', time: '4 hours ago' },
    { icon: <CheckCircle size={20} />, title: 'Contract Approved', description: 'ABC Construction contract approved', time: '6 hours ago' }
  ];

  const departmentOptions = departments.map((d) => ({ value: d, label: d }));
  const categoryOptions = categories.map((c) => ({ value: c, label: c }));
  const employeeOptions = employees.map((e) => ({ value: e, label: e }));

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
                <div className="cms-menu-toggle" onClick={() => {}}>
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
                    {item.children.map((child) => (
                      <Link
                        to={child.path}
                        key={child.label}
                        className={`cms-nav-child ${child.path === '/misspunch-report' ? 'active' : ''}`}
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
                  className={`cms-nav-item ${['/loh-report', '/latein-report', '/misspunch-report', '/onduty', '/grace', '/compoff', '/calendar'].includes(item.path) ? 'clock-color-icon' : ''}`}
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
                  <button type="button" className="cms-close-btn" onClick={() => setShowNotifications(false)}>×</button>
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
                Miss Punch Report
              </div>
              <div className="employee-section-subtitle" style={{ fontSize: '1rem', marginBottom: '0.25rem' }}>
                Displays employees where First In or Last Out is missing in attendance muster for the selected date range. Select start and end date, department, and employee code to view the report.
              </div>
              <div className="misspunch-date-range-header" style={{ fontSize: '1rem', marginBottom: '1.25rem', fontWeight: 600, color: '#1e40af' }}>
                {formatDateHeader(startDate)} to {formatDateHeader(endDate)}
              </div>

              <div className="employee-toolbar" style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'nowrap', marginBottom: '20px', justifyContent: 'flex-end', background: 'transparent', border: 'none', padding: 0 }}>
                <button
                  type="button"
                  className="toolbar-btn export-btn"
                  onClick={() => {
                    const filename = `misspunch_report_${startDate}_to_${endDate}.csv`;
                    const dateRange = generateDateRange(startDate, endDate);
                    const calendarData = transformToDateColumns(tableData, dateRange);
                    exportToCSV(calendarData, dateRange, filename);
                  }}
                  title="Download CSV"
                  style={{ background: '#fff', color: '#232323', border: '1px solid #d9dee8', fontWeight: 500, padding: '6px', borderRadius: '8px', width: '40px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px' }}
                >
                  <Download size={18} style={{ color: '#232323' }} />
                </button>
              </div>

              <div className="monthly-ot-filters misspunch-filters">
                <div>
                  <label>Start Date:</label>
                  <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} max={endDate} />
                </div>
                <div>
                  <label>End Date:</label>
                  <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} min={startDate} />
                </div>
                <div>
                  <label>Department:</label>
                  <select value={department} onChange={(e) => setDepartment(e.target.value)} style={{ width: '100%', padding: '8px 12px' }}>
                    {departmentOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label>Category:</label>
                  <select value={category} onChange={(e) => setCategory(e.target.value)} style={{ width: '100%', padding: '8px 12px' }}>
                    {categoryOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label>Employee Code:</label>
                  <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} style={{ width: '100%', padding: '8px 12px' }}>
                    {employeeOptions.map((opt) => (
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
                ) : tableData.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '20px' }}>No employees found with missing First In or Last Out for the selected date range.</div>
                ) : (() => {
                  const dateRange = generateDateRange(startDate, endDate);
                  const calendarData = transformToDateColumns(tableData, dateRange);
                  return (
                    <div className="muster-table-scroll">
                      <table className="muster-table misspunch-table">
                        <thead>
                          <tr>
                            <th>Employee Code</th>
                            <th>Employee Name</th>
                            <th>Department</th>
                            <th>Category</th>
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
                              <td>{emp.category || '-'}</td>
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
