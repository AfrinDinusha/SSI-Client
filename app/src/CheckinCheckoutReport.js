import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Link, useLocation } from 'react-router-dom';
import * as XLSX from 'xlsx';
import './Attendancemuster.css';
import './employeeManagement.css';
import './Candidateform.css';
import HeaderBranding from './HeaderBranding';
import { getSidebarModulesForUser, resolveSidebarUserEmail } from './modulesConfig';
import {
  Calendar, Users, FileText, AlertTriangle, FolderOpen,
  ClipboardList, Building, Handshake, Landmark, Clock,
  BarChart3, User, Plus, CheckCircle, Bell, LayoutDashboard, Home as HomeIcon, Shield, Clock3, CalendarDays, Database, Download
} from 'lucide-react';

// Format firstIn/lastOut to display time (or full string if only time)
function formatTime(value) {
  if (!value) return '-';
  const s = String(value).trim();
  if (s.includes(' ')) {
    const part = s.split(' ')[1];
    return part ? part.substring(0, 8) : s; // HH:MM:SS or HH:MM
  }
  return s;
}

function CheckinCheckoutReport({ userRole = 'App Administrator', userEmail = null }) {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
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
  const getInitialContractor = () => {
    if (userRole === 'App Administrator') return 'All';
    if (userEmail) return emailContractorMap[userEmail] || 'All';
    return 'All';
  };
  const [contractor, setContractor] = useState(getInitialContractor);
  const [department, setDepartment] = useState('All');
  const [status, setStatus] = useState('Active');
  const [contractors, setContractors] = useState(['All']);
  const [departments, setDepartments] = useState(['All']);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [expandedMenus, setExpandedMenus] = useState({});
  const [showNotifications, setShowNotifications] = useState(false);
  const [showSidebarMenu, setShowSidebarMenu] = useState(false);
  const location = useLocation();

  const modulesToShow = useMemo(
    () => getSidebarModulesForUser(resolveSidebarUserEmail(userEmail), userRole),
    [userEmail, userRole]
  );

  useEffect(() => {
    const reportsIndex = modulesToShow.findIndex(m => m.label === 'Reports');
    if (reportsIndex !== -1) setExpandedMenus(prev => ({ ...prev, [reportsIndex]: true }));
  }, [location.pathname, modulesToShow]);

  useEffect(() => {
    if (userRole === 'App Administrator') return;
    if (!userEmail) return;
    const defaultContractor = emailContractorMap[userEmail];
    if (defaultContractor && contractor !== defaultContractor) setContractor(defaultContractor);
  }, [userRole, userEmail]);

  useEffect(() => {
    fetch('/server/reports_function/contractors').then(res => res.json()).then(d => setContractors(['All', ...(d.data || [])])).catch(() => setContractors(['All']));
    fetch('/server/reports_function/departments').then(res => res.json()).then(d => setDepartments(['All', ...(d.data || [])])).catch(() => setDepartments(['All']));
  }, []);

  const toggleMenu = (idx) => setExpandedMenus(prev => ({ ...prev, [idx]: !prev[idx] }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!startDate || !endDate) {
      setError('Please select both start and end dates.');
      return;
    }
    try {
      const params = new URLSearchParams({ startDate, endDate, source: 'both' });
      if (contractor && contractor !== 'All') params.append('contractor', contractor);
      if (department && department !== 'All') params.append('department', department);
      if (status && status !== 'All') params.append('status', status);
      if (userEmail) params.append('userEmail', userEmail);
      if (userRole) params.append('userRole', userRole);
      const response = await fetch(`/server/attendance_muster_function?${params.toString()}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to fetch data');
      setData(result);
    } catch (err) {
      setError(err.message);
    }
  };

  // Build flat rows: Employee code, Date, Checkin, Checkout from firstIn/lastOut
  const reportRows = useMemo(() => {
    if (!data || !data.employees || !data.dates || !data.firstIn || !data.lastOut) return [];
    const rows = [];
    for (let rowIdx = 0; rowIdx < data.employees.length; rowIdx++) {
      const employeeCode = data.employees[rowIdx];
      const rowFirstIn = data.firstIn[rowIdx] || [];
      const rowLastOut = data.lastOut[rowIdx] || [];
      for (let colIdx = 0; colIdx < data.dates.length; colIdx++) {
        const dateStr = data.dates[colIdx];
        const checkin = rowFirstIn[colIdx];
        const checkout = rowLastOut[colIdx];
        rows.push({
          employeeCode,
          date: dateStr,
          checkin: formatTime(checkin),
          checkout: formatTime(checkout),
        });
      }
    }
    return rows;
  }, [data]);

  const handleExport = useCallback(() => {
    if (!reportRows || reportRows.length === 0) {
      setExportError('No data to export. Please apply filters first.');
      return;
    }
    setExporting(true);
    setExportError('');
    try {
      const exportData = reportRows.map(row => ({
        'Employee Code': row.employeeCode || '',
        'Date': row.date || '',
        'Checkin': row.checkin || '-',
        'Checkout': row.checkout || '-',
      }));
      const worksheet = XLSX.utils.json_to_sheet(exportData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Checkin Checkout Report');
      const fileName = `checkin_checkout_report_${startDate || 'start'}_${endDate || 'end'}.xlsx`;
      XLSX.writeFile(workbook, fileName);
    } catch (err) {
      setExportError(err.message || 'Failed to export to Excel.');
      console.error('Export error:', err);
    } finally {
      setExporting(false);
    }
  }, [reportRows, startDate, endDate]);

  const userAvatar = 'https://images.pexels.com/photos/2379004/pexels-photo-2379004.jpeg?auto=compress&cs=tinysrgb&w=150';
  const userName = userRole === 'App Administrator' ? 'Admin User' : 'App User';
  const recentActivities = [
    { icon: <User size={20} />, title: 'New Employee Added', description: 'John Doe joined the development team', time: '2 hours ago' },
    { icon: <BarChart3 size={20} />, title: 'Monthly Report Generated', description: 'Contractor performance report is ready', time: '4 hours ago' },
    { icon: <CheckCircle size={20} />, title: 'Contract Approved', description: 'ABC Construction contract approved', time: '6 hours ago' },
    { icon: <Bell size={20} />, title: 'System Update', description: 'Payroll Management System updated to version 2.1', time: '1 day ago' },
    { icon: <Plus size={20} />, title: 'New Application', description: 'Candidate applied for senior position', time: '2 days ago' }
  ];

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
                  <div className="cms-three-dots"><span></span><span></span><span></span></div>
                </div>
              </div>
            </div>
          </div>
          <div className="cms-nav">
            {modulesToShow.map((item, idx) => (
              item.children ? (
                <div key={item.label} className={`cms-nav-expandable ${expandedMenus[idx] ? 'expanded' : ''}`}>
                  <div className="cms-nav-item" onClick={() => toggleMenu(idx)}>
                    <span className="cms-nav-icon">{item.icon}</span>
                    <span className="cms-nav-label">{item.label}</span>
                    <span className="cms-expand-icon"><Plus size={16} className={`expand-icon ${expandedMenus[idx] ? 'rotated' : ''}`} /></span>
                  </div>
                  <div className="cms-nav-children">
                    {item.children.map(child => (
                      <Link to={child.path} key={child.label} className="cms-nav-child">
                        <span className="cms-nav-icon">{child.icon}</span>
                        <span className="cms-nav-label">{child.label}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              ) : (
                <Link to={item.path} key={item.label} className="cms-nav-item">
                  <span className="cms-nav-icon">{item.icon}</span>
                  <span className="cms-nav-label">{item.label}</span>
                </Link>
              )
            ))}
          </div>
          <div className="cms-user-info">
            <img src={userAvatar} alt="User" className="cms-user-avatar" />
            <div className="cms-user-details"><h4>{userName}</h4><p>{userRole || 'User'}</p></div>
          </div>
        </nav>
        <div className="cms-main-content">
          <header className="cms-header">
            <div className="cms-header-center"><h1>Payroll Management System</h1></div>
            <div className="cms-header-right">
              <HeaderBranding />
              <div className="cms-header-user">
                <div className="cms-notification-icon" onClick={() => setShowNotifications(!showNotifications)}><Bell size={24} /></div>
                <img src={userAvatar} alt="User" className="cms-user-avatar" />
              </div>
            </div>
          </header>
          {showNotifications && (
            <div className="cms-notification-overlay" onClick={() => setShowNotifications(false)}>
              <div className="cms-notification-popup" onClick={e => e.stopPropagation()}>
                <div className="cms-notification-header"><h3>Recent Activity</h3><button className="cms-close-btn" onClick={() => setShowNotifications(false)}>×</button></div>
                <div className="cms-notification-content">
                  {recentActivities.map((activity, index) => (
                    <div key={index} className="cms-activity-item">
                      <div className="cms-activity-icon">{activity.icon}</div>
                      <div className="cms-activity-content"><h4>{activity.title}</h4><p>{activity.description}</p><span className="cms-activity-time">{activity.time}</span></div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
          <main className="cms-dashboard-content">
            <div className="employee-card-container">
              <div className="employee-section-title">Checkin and Checkout Report</div>
              <div className="employee-section-subtitle">View first in (check-in) and last out (check-out) from attendance muster data</div>
              <form className="muster-filter-form" onSubmit={handleSubmit}>
                <div className="muster-filter-grid">
                  <div className="muster-filter-group">
                    <label>Start Date:
                      <input type="date" className="muster-input" value={startDate} onChange={e => setStartDate(e.target.value)} />
                    </label>
                  </div>
                  <div className="muster-filter-group">
                    <label>End Date:
                      <input type="date" className="muster-input" value={endDate} onChange={e => setEndDate(e.target.value)} />
                    </label>
                  </div>
                  <div className="muster-filter-group">
                    <label>Contractor:
                      <select className="muster-input" value={contractor} onChange={e => setContractor(e.target.value)}>
                        {contractors.map(c => (<option key={c} value={c}>{c}</option>))}
                      </select>
                    </label>
                  </div>
                  <div className="muster-filter-group">
                    <label>Department:
                      <select className="muster-input" value={department} onChange={e => setDepartment(e.target.value)}>
                        {departments.map(d => (<option key={d} value={d}>{d}</option>))}
                      </select>
                    </label>
                  </div>
                  <div className="muster-filter-group">
                    <label>Status:
                      <select className="muster-input" value={status} onChange={e => setStatus(e.target.value)}>
                        <option value="All">All</option>
                        <option value="Active">Active</option>
                        <option value="Inactive">Inactive</option>
                      </select>
                    </label>
                  </div>
                </div>
                <div className="muster-filter-actions">
                  <button type="submit" className="cms-btn primary">Apply Filter</button>
                  {data && reportRows.length > 0 && (
                    <button
                      type="button"
                      className="cms-btn primary"
                      onClick={handleExport}
                      disabled={exporting}
                      style={{ marginLeft: 10, display: 'inline-flex', alignItems: 'center', gap: 8 }}
                    >
                      <Download size={18} />
                      {exporting ? 'Exporting...' : 'Export to Excel'}
                    </button>
                  )}
                </div>
              </form>
              {error && <div className="muster-error">{error}</div>}
              {exportError && <div className="muster-error" style={{ marginTop: 8 }}>{exportError}</div>}
              {data && reportRows.length > 0 && (
                <div className="muster-table-wrapper" style={{ marginTop: '1.5rem', overflowX: 'auto' }}>
                  <table className="muster-table" style={{ minWidth: 400 }}>
                    <thead>
                      <tr>
                        <th>Employee code</th>
                        <th>Date</th>
                        <th>Checkin</th>
                        <th>Checkout</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportRows.map((row, i) => (
                        <tr key={`${row.employeeCode}-${row.date}-${i}`}>
                          <td>{row.employeeCode}</td>
                          <td>{row.date ? new Date(row.date).toLocaleDateString('en-GB') : '-'}</td>
                          <td>{row.checkin}</td>
                          <td>{row.checkout}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {data && reportRows.length === 0 && (
                <p style={{ marginTop: '1rem', color: '#64748b' }}>No check-in/check-out data for the selected period.</p>
              )}
            </div>
          </main>
        </div>
      </div>
    </>
  );
}

export default CheckinCheckoutReport;