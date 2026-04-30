import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import * as XLSX from 'xlsx-js-style';
import { User, Plus, Bell, BarChart3, CheckCircle, Download } from 'lucide-react';
import './App.css';
import './reports.css';
import './Attendancemuster.css';
import './BankFormatReport.css';
import './bankneftreport.css';
import HeaderBranding from './HeaderBranding';
import { getSidebarModulesForUser, resolveSidebarUserEmail } from './modulesConfig';

/** Column order: Employee ID first for reference; remaining columns match NEFT bank upload layout */
export const BANK_NEFT_COLUMNS = [
  { key: 'employeeId', label: 'EMPLOYEE ID' },
  { key: 'amount', label: 'Salary Amount' },
  { key: 'ourBankAct', label: 'OUR BANK ACC' },
  { key: 'emIfscCode', label: 'EM IFSC CODE' },
  { key: 'emplAct', label: 'EMPL ACC' },
  { key: 'bc', label: 'BC' },
  { key: 'emlName', label: 'EMPL NAME' },
  { key: 'bank', label: 'BANK' },
  { key: 'sender', label: 'SENDER' },
  { key: 'mode', label: 'MODE' },
  { key: 'neftLine', label: 'NEFT LINE' },
];

function formatAmountDisplay(val) {
  if (val === null || val === undefined || val === '') return '-';
  const n = parseFloat(String(val).replace(/,/g, '').trim());
  if (!Number.isFinite(n)) return String(val);
  return n.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function parseAmountNumber(val) {
  if (val === null || val === undefined || val === '') return null;
  const n = parseFloat(String(val).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

/** Tilde-separated line as in bank file (amount without comma grouping). */
export function buildNeftLine(row) {
  if (row.neftLine != null && String(row.neftLine).trim() !== '') {
    return String(row.neftLine).trim();
  }
  const amt = parseAmountNumber(row.amount);
  const amountPart = amt != null ? String(amt) : String(row.amount ?? '').replace(/,/g, '');
  const parts = [
    amountPart,
    row.ourBankAct ?? '',
    row.emIfscCode ?? '',
    row.emplAct ?? '',
    row.bc != null && row.bc !== '' ? String(row.bc) : '',
    String(row.emlName ?? '').toUpperCase(),
    row.bank ?? '',
    row.sender ?? '',
    row.mode ?? 'NEFT',
  ];
  return parts.join('~');
}

function normalizeRow(raw, index) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    id: r.employeeCode ?? r.EmployeeCode ?? r.id ?? r._id ?? `row-${index}`,
    employeeId: String(r.employeeCode ?? r.EmployeeCode ?? r.employeeId ?? r.EmployeeId ?? '').trim(),
    amount: r.amount ?? r.AMOUNT,
    netPay: r.netPay ?? r.NetPay ?? r.net_pay ?? r.NET_PAY ?? r.amount ?? r.AMOUNT ?? null,
    ourBankAct: r.ourBankAct ?? r.ourBankAccount ?? r.OUR_BANK_ACT ?? '',
    emIfscCode: r.emIfscCode ?? r.ifscCode ?? r.EM_IFSC_CODE ?? '',
    emplAct: r.emplAct ?? r.employeeAccount ?? r.EMPL_ACT ?? '',
    bc: r.bc ?? r.BC ?? '',
    emlName: r.emlName ?? r.employeeName ?? r.EML_NAME ?? '',
    bank: r.bank ?? r.bankBranch ?? r.BANK ?? '',
    sender: r.sender ?? r.Sender ?? 'S S Industries',
    mode: r.mode ?? r.MODE ?? 'NEFT',
    neftLine: r.neftLine ?? r.neft_line ?? r.detailLine ?? '',
  };
}

export default function BankNeftReport({ userRole = 'App Administrator', userEmail = null }) {
  const location = useLocation();
  const [expandedMenus, setExpandedMenus] = useState({});
  const [showSidebarMenu, setShowSidebarMenu] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);

  const defaultMonth = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  };

  const [payrollMonth, setPayrollMonth] = useState(defaultMonth);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [search, setSearch] = useState('');

  const modulesToShow = useMemo(
    () => getSidebarModulesForUser(resolveSidebarUserEmail(userEmail), userRole),
    [userEmail, userRole]
  );

  useEffect(() => {
    const reportsIndex = modulesToShow.findIndex((module) => module.label === 'Reports');
    if (reportsIndex !== -1) {
      setExpandedMenus((prev) => ({ ...prev, [reportsIndex]: true }));
    }
  }, [location.pathname, modulesToShow]);

  const fetchReport = useCallback(async () => {
    setLoading(true);
    setError('');
    setInfo('');
    try {
      const params = new URLSearchParams();
      params.set('month', payrollMonth);
      if (userEmail) params.set('userEmail', userEmail);
      if (userRole) params.set('userRole', userRole);
      const url = `/server/reports_function/bank-neft-report?${params.toString()}`;
      const res = await fetch(url);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.message || `Request failed (${res.status})`);
      }
      const list = Array.isArray(json.data) ? json.data : json.rows || [];
      setRows(list.map(normalizeRow));
      if (!list.length) {
        setInfo('No employees found for this report (check contractor filter or Employee master).');
      }
    } catch (e) {
      console.warn('Bank NEFT report:', e.message);
      setRows([]);
      setError(
        e.message ||
          'Could not load NEFT data. Add GET /server/reports_function/bank-neft-report or check the network.'
      );
    } finally {
      setLoading(false);
    }
  }, [payrollMonth, userEmail, userRole]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((r) =>
      [
        r.employeeId,
        r.amount,
        r.ourBankAct,
        r.emIfscCode,
        r.emplAct,
        r.bc,
        r.emlName,
        r.bank,
        r.sender,
        r.mode,
        buildNeftLine(r),
      ]
        .join(' ')
        .toLowerCase()
        .includes(term)
    );
  }, [rows, search]);

  const totalFilteredAmount = useMemo(() => {
    let sum = 0;
    for (const r of filteredRows) {
      const n = parseAmountNumber(r.amount);
      if (n != null) sum += n;
    }
    return sum;
  }, [filteredRows]);

  const exportExcel = () => {
    const header = BANK_NEFT_COLUMNS.map((c) => c.label);
    const aoa = [
      header,
      ...filteredRows.map((r) => [
        r.employeeId ?? '',
        parseAmountNumber(r.amount) ?? '',
        r.ourBankAct,
        r.emIfscCode,
        r.emplAct,
        r.bc,
        r.emlName,
        r.bank,
        r.sender,
        r.mode,
        buildNeftLine(r),
      ]),
      [
        '',
        filteredRows.reduce((s, r) => s + (parseAmountNumber(r.amount) || 0), 0),
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        'Total',
        '',
      ],
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Bank NEFT');
    XLSX.writeFile(wb, `bank_neft_${payrollMonth}.xlsx`);
  };

  const toggleMenu = (index) => {
    setExpandedMenus((prev) => ({ ...prev, [index]: !prev[index] }));
  };

  const userAvatar =
    'https://images.pexels.com/photos/2379004/pexels-photo-2379004.jpeg?auto=compress&cs=tinysrgb&w=150';
  const userName = userRole === 'App Administrator' ? 'Admin User' : 'App User';

  const recentActivities = [
    {
      icon: <User size={20} />,
      title: 'NEFT report ready',
      description: 'Employee NEFT lines loaded for the selected month',
      time: 'Just now',
    },
    {
      icon: <BarChart3 size={20} />,
      title: 'Report updated',
      description: 'Bank details synced from employee master',
      time: '1 hour ago',
    },
    {
      icon: <CheckCircle size={20} />,
      title: 'Validation complete',
      description: 'IFSC and account fields verified',
      time: 'Today',
    },
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
                      <Link to={child.path} key={child.label} className="cms-nav-child">
                        <span className="cms-nav-icon">{child.icon}</span>
                        <span className="cms-nav-label">{child.label}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              ) : (
                <Link to={item.path} className="cms-nav-item" key={item.label}>
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
              </div>
            </div>
          </header>

          {showNotifications && (
            <div className="cms-notification-overlay" onClick={() => setShowNotifications(false)}>
              <div className="cms-notification-popup" onClick={(e) => e.stopPropagation()}>
                <div className="cms-notification-header">
                  <h3>Recent Activity</h3>
                  <button className="cms-close-btn" onClick={() => setShowNotifications(false)}>
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
            <div className="employee-card-container">
              <div className="employee-section-title">Bank NEFT Report</div>

              <div className="bank-report-actions">
                <label className="bank-report-month-label">
                  Payroll month
                  <input
                    type="month"
                    className="bank-report-month-input"
                    value={payrollMonth}
                    onChange={(e) => setPayrollMonth(e.target.value)}
                  />
                </label>
                <input
                  type="text"
                  className="bank-report-search"
                  placeholder="Search by employee ID, salary amount, bank account, IFSC, name, NEFT line..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <button className="cms-btn" type="button" onClick={exportExcel} disabled={!filteredRows.length}>
                  <Download size={16} /> Export Excel
                </button>
              </div>

              {info && !error && <div className="bank-report-notice">{info}</div>}
              {error && <div className="bank-report-error">{error}</div>}
              {loading && <div className="bank-report-loading">Loading NEFT report...</div>}

              <div className="muster-table-scroll">
                <table className="muster-table bank-report-table bank-neft-report-table">
                  <thead>
                    <tr>
                      {BANK_NEFT_COLUMNS.map((c) => (
                        <th key={c.key}>{c.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {!loading && filteredRows.length === 0 ? (
                      <tr>
                        <td colSpan={BANK_NEFT_COLUMNS.length} className="bank-report-empty">
                          {rows.length === 0
                            ? 'No employees found for this report.'
                            : 'No rows match your search.'}
                        </td>
                      </tr>
                    ) : (
                      filteredRows.map((r) => (
                        <tr key={r.id}>
                          <td>{r.employeeId || '-'}</td>
                          <td className="bank-neft-amount-cell">{formatAmountDisplay(r.amount)}</td>
                          <td>{r.ourBankAct || '-'}</td>
                          <td>{r.emIfscCode || '-'}</td>
                          <td>{r.emplAct || '-'}</td>
                          <td>{r.bc !== '' && r.bc != null ? r.bc : '-'}</td>
                          <td>{r.emlName || '-'}</td>
                          <td>{r.bank || '-'}</td>
                          <td>{r.sender || '-'}</td>
                          <td>{r.mode || '-'}</td>
                          <td className="bank-neft-line-cell">{buildNeftLine(r)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                  {filteredRows.length > 0 && (
                    <tfoot>
                      <tr>
                        <td />
                        <td className="bank-neft-amount-cell">{formatAmountDisplay(totalFilteredAmount)}</td>
                        <td colSpan={9} style={{ textAlign: 'left', fontWeight: 700 }}>
                          Total
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          </main>
        </div>
      </div>
    </>
  );
}
