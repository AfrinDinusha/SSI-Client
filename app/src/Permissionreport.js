import React, { useEffect, useMemo, useState } from 'react';
import './App.css';
import './helper.css';
import './permission.css';
import './permissionreport.css';
import { Link, useLocation } from 'react-router-dom';
import HeaderBranding from './HeaderBranding';
import Button from './Button';
import { getSidebarModulesForUser, resolveSidebarUserEmail } from './modulesConfig';
import { Bell, Download, FileSignature, Plus } from 'lucide-react';
import { fetchPermissionReportFromMuster } from './payrollLiveLoh';

function downloadCsv(rows) {
  const headers = ['S.No', 'Employee Code', 'Employee Name', 'Permission Applicable', 'Permission Used'];
  const csvRows = [
    headers.join(','),
    ...rows.map((row, index) =>
      [index + 1, row.employeeId || '', row.employeeName || '', row.permissionApplicable || '', row.permissionUsed || '']
        .map((cell) => {
          const safe = String(cell ?? '');
          return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
        })
        .join(',')
    ),
  ];

  const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'permission-report.csv';
  link.click();
  URL.revokeObjectURL(url);
}

export default function PermissionReport({ userRole = 'App Administrator', userEmail = null }) {
  const location = useLocation();
  const [expandedMenus, setExpandedMenus] = useState({});
  const [showNotifications, setShowNotifications] = useState(false);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [reportMonth, setReportMonth] = useState(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('month');
    return fromUrl && /^\d{4}-\d{2}$/.test(fromUrl) ? fromUrl : new Date().toISOString().slice(0, 7);
  });

  const modulesToShow = useMemo(
    () => getSidebarModulesForUser(resolveSidebarUserEmail(userEmail), userRole),
    [userEmail, userRole]
  );

  const userAvatar = 'https://images.pexels.com/photos/2379004/pexels-photo-2379004.jpeg?auto=compress&cs=tinysrgb&w=150';
  const userName = userRole === 'App Administrator' ? 'Admin User' : 'App User';

  useEffect(() => {
    const reportsIndex = modulesToShow.findIndex((module) => module.label === 'Reports');
    if (reportsIndex !== -1) {
      setExpandedMenus((prev) => ({ ...prev, [reportsIndex]: true }));
    }
  }, [location.pathname, modulesToShow]);

  const fetchReport = async () => {
    setLoading(true);
    setError('');
    try {
      const reportRows = await fetchPermissionReportFromMuster({
        month: reportMonth,
        userEmail,
        userRole,
      });
      setRows(reportRows);
    } catch (err) {
      setRows([]);
      setError(err.message || 'Failed to fetch permission report.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReport();
  }, [userRole, userEmail, reportMonth]);

  const toggleMenu = (index) => {
    setExpandedMenus((prev) => ({ ...prev, [index]: !prev[index] }));
  };

  const recentActivities = [
    {
      icon: '📊',
      title: 'Permission Report',
      description: 'Permission Used from attendance muster monthly LOH',
      time: 'Updated on refresh',
    },
  ];

  const reportColumns = [
    'S.No',
    'Employee Code',
    'Employee Name',
    'Permission Applicable',
    'Permission Used',
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
              <div className="cms-logo-section"></div>
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
                        className={`cms-nav-child ${child.path === '/permission-report' ? 'active' : ''}`}
                      >
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
            )}
          </div>

          <div className="cms-user-info">
            <img src={userAvatar} alt="User" className="cms-user-avatar" />
            <div className="cms-user-details">
              <h4>{userName}</h4>
              <p>{userRole || 'User'}</p>
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
                <img src={userAvatar} alt="User" className="cms-user-avatar" />
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
                  <button type="button" className="cms-close-btn" onClick={() => setShowNotifications(false)}>
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

          <main className="cms-dashboard-content">
            <div className="permission-card-container">
              <div className="permission-report-top-row">
                <div className="permission-header-actions">
                  <div className="permission-title-section">
                    <h2 className="permission-title">
                      <FileSignature size={28} />
                      Permission Report
                    </h2>
                  </div>
                </div>
                <div className="permission-report-controls-box">
                  <input
                    id="report-month"
                    className="permission-report-month-input"
                    type="month"
                    value={reportMonth}
                    onChange={(e) => setReportMonth(e.target.value)}
                    aria-label="Payroll month"
                  />
                  <button
                    type="button"
                    className="permission-report-export-btn"
                    onClick={() => downloadCsv(rows)}
                    disabled={loading || !rows.length}
                    title="Export to CSV"
                  >
                    <Download size={24} />
                  </button>
                </div>
              </div>

              <div className="permission-table-container permission-report-table-container">
                {loading && (
                  <div className="dF aI-center jC-center h-inh" style={{ minHeight: 120 }}>
                    <div className="loader-lg"></div>
                  </div>
                )}
                {error && <div className="error-message">{error}</div>}
                {!loading && !error && (
                  <table className="permission-table permission-report-table">
                    <colgroup>
                      <col className="permission-report-col-sno" />
                      <col className="permission-report-col-code" />
                      <col className="permission-report-col-name" />
                      <col className="permission-report-col-applicable" />
                      <col className="permission-report-col-used" />
                    </colgroup>
                    <thead>
                      <tr>
                        {reportColumns.map((label) => (
                          <th key={label}>{label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.length ? (
                        rows.map((row, index) => (
                          <tr key={row.id || `${row.employeeId}-${index}`}>
                            <td className="permission-sno-cell">{index + 1}</td>
                            <td className="permission-report-td-code">{row.employeeId || '-'}</td>
                            <td className="permission-report-td-name">{row.employeeName || '-'}</td>
                            <td className="permission-report-td-num">{row.permissionApplicable || '-'}</td>
                            <td className="permission-report-td-num">{row.permissionUsed || '-'}</td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={reportColumns.length} className="text-center">
                            No permission report records found for this month.
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
