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
import {
  bankReportNetPayEarnedGrossMinusTd,
  buildPayrollByEmployeeCode,
  buildRunPayrollTableMapFromApi,
  mergeBankFormatRowsWithPayroll,
  parsePayrollAmountLoose,
  payrollMonthToFromToDates,
  pickBackendSalaryOrNetColumn,
  preferPayrollAlignedThenBankApi,
} from './bankReportPayrollShared';
import {
  extractPayrollFormulaeRows,
  parsePayrollComponentsFromApi,
  parsePayrollFormulaeFromApi,
} from './payrollBankReportNetPay';

/** Same merged-row → NEFT row mapping as Bank Format salary (Net Pay = Earned Gross − Total Deduction when possible). */
function mergedBankRowToNeft(row, neftMeta, index) {
  const netEgTd = bankReportNetPayEarnedGrossMinusTd(row);
  let amountNum =
    netEgTd != null && Number.isFinite(netEgTd)
      ? netEgTd
      : parsePayrollAmountLoose(row.netPayPayroll);
  if (amountNum == null || !Number.isFinite(amountNum)) {
    const pref = preferPayrollAlignedThenBankApi(
      row.netPayPayroll,
      pickBackendSalaryOrNetColumn(row) ||
        row.salaryAmount ||
        row.amount ||
        row.SalaryAmount ||
        ''
    );
    const parsed =
      typeof pref === 'number'
        ? pref
        : parseFloat(String(pref ?? '').replace(/,/g, '').trim());
    amountNum = Number.isFinite(parsed) ? parsed : null;
  }
  if (amountNum == null || !Number.isFinite(amountNum)) {
    amountNum = parseAmountNumber(row.amount) ?? 0;
  }
  const employeeId = String(row.employeeCode ?? row.EmployeeCode ?? row.employeeId ?? '').trim();
  return {
    id: employeeId || row.id || `row-${index}`,
    employeeId,
    amount: amountNum,
    netPay: amountNum,
    ourBankAct: neftMeta.ourBankAct,
    emIfscCode: String(row.ifscCode ?? row.IFSCCode ?? '').trim(),
    emplAct: String(row.accountNumber ?? row.AccountNumber ?? '').trim(),
    bc: neftMeta.bc,
    emlName: String(row.employeeName ?? row.EmployeeName ?? '').trim().toUpperCase(),
    bank: String(row.bankBranch ?? row.bankName ?? row.BankName ?? '').trim().toUpperCase(),
    sender: neftMeta.sender,
    mode: 'NEFT',
    neftLine: '',
  };
}

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

export default function BankNeftReport({ userRole = 'App Administrator', userEmail = null }) {
  const location = useLocation();
  const [expandedMenus, setExpandedMenus] = useState({});
  const [showSidebarMenu, setShowSidebarMenu] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);

  const defaultMonth = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  };

  const initialPayrollSnapshot = useMemo(() => {
    const d = new Date();
    const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const { fromDate, toDate } = payrollMonthToFromToDates(month);
    return { month, fromDate, toDate };
  }, []);
  const [payrollMonth, setPayrollMonth] = useState(initialPayrollSnapshot.month);
  const [payrollFromDate, setPayrollFromDate] = useState(initialPayrollSnapshot.fromDate);
  const [payrollToDate, setPayrollToDate] = useState(initialPayrollSnapshot.toDate);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [payrollNotice, setPayrollNotice] = useState('');
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

  useEffect(() => {
    const { fromDate, toDate } = payrollMonthToFromToDates(payrollMonth);
    setPayrollFromDate(fromDate);
    setPayrollToDate(toDate);
  }, [payrollMonth]);

  const fetchReport = useCallback(async () => {
    setLoading(true);
    setError('');
    setInfo('');
    setPayrollNotice('');
    const m = String(payrollMonth || '').trim();
    const fromD = String(payrollFromDate || '').trim();
    const toD = String(payrollToDate || '').trim();
    if (!m || !fromD || !toD) {
      setRows([]);
      setLoading(false);
      return;
    }
    if (fromD > toD) {
      setRows([]);
      setError('From date must be on or before To date.');
      setLoading(false);
      return;
    }

    try {
      const bankParams = new URLSearchParams();
      bankParams.append('month', m);
      if (userRole) bankParams.append('userRole', userRole);
      if (userEmail) bankParams.append('userEmail', userEmail);

      const payrollParams = new URLSearchParams({
        month: payrollMonth,
        _t: String(Date.now()),
      });
      payrollParams.append('fromDate', fromD);
      payrollParams.append('toDate', toD);
      if (userRole) payrollParams.append('userRole', userRole);
      if (userEmail) payrollParams.append('userEmail', userEmail);

      const runPayrollTableParams = new URLSearchParams({ month: m });
      const neftMetaParams = new URLSearchParams({ month: m });
      if (userEmail) neftMetaParams.set('userEmail', userEmail);
      if (userRole) neftMetaParams.set('userRole', userRole);

      const [
        bankRes,
        payrollRes,
        componentsRes,
        formulaeRes,
        payslipRes,
        runPayrollTableRes,
        neftMetaRes,
      ] = await Promise.all([
        fetch(`/server/reports_function/bank-format-report?${bankParams.toString()}`),
        fetch(`/server/payroll_function/payroll?${payrollParams.toString()}`),
        fetch('/server/setupconfig/payroll/components'),
        fetch('/server/setupconfig/payroll/formulae'),
        fetch('/server/payslip_function/getPayslipTemplate'),
        fetch(`/server/payroll_function/run-payroll-table?${runPayrollTableParams.toString()}`),
        fetch(`/server/reports_function/bank-neft-report?${neftMetaParams.toString()}`),
      ]);

      const bankText = await bankRes.text();
      let bankJson;
      try {
        bankJson = bankText ? JSON.parse(bankText) : {};
      } catch {
        const preview = bankText.slice(0, 120).replace(/\s+/g, ' ').trim();
        throw new Error(
          preview.startsWith('You might')
            ? 'Bank format API is not available on the server yet. Deploy the latest reports_function, then refresh.'
            : `Invalid response from server${preview ? `: ${preview}` : ''}`
        );
      }
      if (!bankRes.ok) throw new Error(bankJson?.error || 'Failed to fetch bank format report');

      const bankRows = Array.isArray(bankJson?.data) ? bankJson.data : [];

      let payrollMap = new Map();
      const payrollText = await payrollRes.text();
      let payrollJson = {};
      try {
        payrollJson = payrollText ? JSON.parse(payrollText) : {};
      } catch {
        payrollJson = {};
      }
      const payrollLoadedOk = payrollRes.ok && Array.isArray(payrollJson?.data);

      let componentsJson = {};
      let formulaeJson = {};
      let payslipJson = {};
      try {
        componentsJson = await componentsRes.json();
      } catch {
        componentsJson = {};
      }
      try {
        formulaeJson = formulaeRes.ok ? await formulaeRes.json() : {};
      } catch {
        formulaeJson = {};
      }
      try {
        payslipJson = await payslipRes.json();
      } catch {
        payslipJson = {};
      }

      let runPayrollTableMap = new Map();
      try {
        const rpText = await runPayrollTableRes.text();
        let rpJson = {};
        try {
          rpJson = rpText ? JSON.parse(rpText) : {};
        } catch {
          rpJson = {};
        }
        if (runPayrollTableRes.ok && Array.isArray(rpJson.data)) {
          runPayrollTableMap = buildRunPayrollTableMapFromApi(rpJson.data);
        }
      } catch {
        runPayrollTableMap = new Map();
      }

      const payrollFormulae = parsePayrollFormulaeFromApi(extractPayrollFormulaeRows(formulaeJson));
      const payrollComponents = parsePayrollComponentsFromApi(componentsJson);
      const deductionKeys =
        payslipJson?.success && Array.isArray(payslipJson.deductionKeys) ? payslipJson.deductionKeys : [];

      const bankReportPayrollOpts = {
        payrollFormulae,
        payrollComponents,
        payslipTemplateConfig: { deductionKeys },
        reportMonth: m,
      };

      if (payrollLoadedOk) {
        payrollMap = buildPayrollByEmployeeCode(payrollJson.data);
      } else {
        const msg =
          payrollJson?.error ||
          (!payrollRes.ok
            ? `Payroll for ${payrollMonth} (${fromD}–${toD}) could not be loaded (HTTP ${payrollRes.status}).`
            : '');
        if (msg) {
          setPayrollNotice(`${msg} Salary amount falls back to bank/API values where available.`);
        }
      }

      if (!formulaeRes.ok) {
        setPayrollNotice((prev) =>
          prev
            ? `${prev} Setup formulae request failed (HTTP ${formulaeRes.status}).`
            : `Setup formulae could not be loaded (HTTP ${formulaeRes.status}).`
        );
      } else if (payrollFormulae.length === 0) {
        setPayrollNotice((prev) =>
          prev
            ? `${prev} No formulae parsed from Setup.`
            : 'No payroll formulae parsed from Setup Configuration.'
        );
      }

      let neftDefaults = { ourBankAct: '', bc: '10', sender: 'S S Industries' };
      try {
        const neftJson = await neftMetaRes.json().catch(() => ({}));
        const first = Array.isArray(neftJson?.data) ? neftJson.data[0] : null;
        if (first && typeof first === 'object') {
          neftDefaults = {
            ourBankAct: String(first.ourBankAct ?? '').trim(),
            bc:
              first.bc != null && String(first.bc).trim() !== ''
                ? String(first.bc).trim()
                : neftDefaults.bc,
            sender: String(first.sender ?? neftDefaults.sender).trim(),
          };
        }
      } catch {
        /* keep defaults */
      }

      const merged = mergeBankFormatRowsWithPayroll({
        bankRows,
        payrollMap,
        payrollLoadedOk,
        bankReportPayrollOpts,
        runPayrollTableMap,
      });

      const neftRows = merged.map((row, idx) => mergedBankRowToNeft(row, neftDefaults, idx));
      setRows(neftRows);

      if (!neftRows.length) {
        setInfo('No bank rows for this month (check contractor filter or Employee master).');
      }
    } catch (e) {
      console.warn('Bank NEFT report:', e.message);
      setRows([]);
      setError(e.message || 'Could not load NEFT report. Check network and server endpoints.');
    } finally {
      setLoading(false);
    }
  }, [payrollMonth, payrollFromDate, payrollToDate, userEmail, userRole]);

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
              {payrollNotice && <div className="bank-report-notice">{payrollNotice}</div>}
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
