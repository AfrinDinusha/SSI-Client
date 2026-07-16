import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import * as XLSX from 'xlsx-js-style';
import { Bell, Download, Plus, User, BarChart3, CheckCircle } from 'lucide-react';
import './BankFormatReport.css';
import './bankneftreport.css';
import './Attendancemuster.css';
import './employeeManagement.css';
import './Candidateform.css';
import HeaderBranding from './HeaderBranding';
import { getSidebarModulesForUser, resolveSidebarUserEmail } from './modulesConfig';
import {
  extractPayrollFormulaeRows,
  parsePayrollComponentsFromApi,
  parsePayrollFormulaeFromApi,
} from './payrollBankReportNetPay';
import {
  buildPayrollByEmployeeCode,
  buildPayrollGridDisplayMapForBankReports,
  buildRunPayrollTableMapFromApi,
  getPayrollRowForBank,
  mergeBankFormatRowsWithPayroll,
  parsePayrollAmountLoose,
  payrollMonthToFromToDates,
  resolveBankReportSalaryAmountLikeNeft,
  resolveEarnedGrossForBankMergedRow,
} from './bankReportPayrollShared';
import { fetchPayrollRowsAlignedWithPayrollGrid } from './payrollGridAlignForBankReports';

function formatSalaryForBankReport(val) {
  if (val === null || val === undefined || val === '') return '-';
  const s = String(val).replace(/,/g, '').trim();
  const n = parseFloat(s);
  if (Number.isFinite(n)) return n.toFixed(2);
  return String(val).trim() || '-';
}

function reportMonthEndAsDDMMYYYY(monthStr) {
  const parts = String(monthStr || '').split('-').map(Number);
  const y = parts[0];
  const m = parts[1];
  if (!y || !m || m < 1 || m > 12) return '';
  const last = new Date(y, m, 0);
  const dd = String(last.getDate()).padStart(2, '0');
  const mm = String(m).padStart(2, '0');
  return `${dd}.${mm}.${y}`;
}

function salaryDisplayToNumber(display) {
  if (display == null || display === '' || display === '-') return null;
  const n = parseFloat(String(display).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

/** Payroll-aligned numeric from merged row (number or parsable string). */
function formatMergedMoneyMaybe(...sources) {
  for (const v of sources) {
    if (v === null || v === undefined || v === '') continue;
    if (typeof v === 'number' && Number.isFinite(v)) return formatSalaryForBankReport(v);
    const n = parseFloat(String(v).replace(/,/g, '').trim());
    if (Number.isFinite(n)) return formatSalaryForBankReport(n);
  }
  return '-';
}

const thinBorder = {
  top: { style: 'thin', color: { rgb: 'FF000000' } },
  bottom: { style: 'thin', color: { rgb: 'FF000000' } },
  left: { style: 'thin', color: { rgb: 'FF000000' } },
  right: { style: 'thin', color: { rgb: 'FF000000' } },
};

function buildBankLetterExcelSheet(filteredRows, reportMonth) {
  const letterDate = reportMonthEndAsDDMMYYYY(reportMonth);
  const lineAfterTheir = 'The following Employees are working in our organization, their';
  const acCreditLine =
    'A/c No. And the Salary is given below, Please credit in to their Accounts.';
  const pad10 = () => ['', '', '', '', '', '', '', '', '', ''];
  const aoa = [
    ['', 'To.', ...pad10().slice(2)],
    [],
    ['', 'The Bank Manager', ...pad10().slice(2)],
    [],
    ['', '', lineAfterTheir, '', '', '', '', '', '', ''],
    [],
    ['', acCreditLine, '', '', '', '', '', '', '', ''],
    [],
    ['', '', '', 'Bank Account Details', '', letterDate, '', '', '', ''],
    [],
    [
      'S.No',
      'Name',
      'Bank Name',
      'Branch',
      'Account no',
      'IFSC no',
      'Salary Amount',
    ],
  ];

  for (const r of filteredRows) {
    const salNum = salaryDisplayToNumber(r.salaryAmount);
    aoa.push([
      r.sno,
      String(r.employeeName || '').toUpperCase(),
      r.bankName === '-' ? '' : r.bankName,
      r.bankBranch === '-' ? '' : r.bankBranch,
      r.accountNumber === '-' ? '' : String(r.accountNumber),
      r.ifscCode === '-' ? '' : r.ifscCode,
      salNum != null ? salNum : '',
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const lastTableCol = 6;
  ws['!merges'] = [
    { s: { r: 0, c: 1 }, e: { r: 0, c: lastTableCol } },
    { s: { r: 2, c: 1 }, e: { r: 2, c: lastTableCol } },
    { s: { r: 4, c: 2 }, e: { r: 4, c: lastTableCol } },
    { s: { r: 6, c: 1 }, e: { r: 6, c: lastTableCol } },
  ];
  ws['!cols'] = [
    { wch: 6 },
    { wch: 30 },
    { wch: 22 },
    { wch: 26 },
    { wch: 18 },
    { wch: 14 },
    { wch: 14 },
  ];

  const titleRow = 8;
  const headerRow = 10;
  const dataStartRow = 11;
  const lastRow = dataStartRow + filteredRows.length - 1;

  const setCellStyle = (r, c, style) => {
    const addr = XLSX.utils.encode_cell({ r, c });
    if (!ws[addr]) {
      ws[addr] = { t: 's', v: '' };
    }
    ws[addr].s = { ...(ws[addr].s || {}), ...style };
  };

  const letterCells = [
    [0, 1],
    [2, 1],
    [4, 2],
    [6, 1],
  ];
  for (const [r, c] of letterCells) {
    const addr = XLSX.utils.encode_cell({ r, c });
    if (ws[addr]) {
      ws[addr].s = {
        ...(r === 0 && c === 1 ? { font: { bold: true } } : {}),
        alignment: { horizontal: 'left', vertical: 'center', wrapText: false },
      };
    }
  }

  setCellStyle(titleRow, 3, {
    font: { bold: true, underline: true },
    alignment: { horizontal: 'left', vertical: 'center' },
  });
  setCellStyle(titleRow, 5, {
    font: { bold: true },
    alignment: { horizontal: 'right', vertical: 'center' },
  });

  const tableColCount = 7;
  for (let r = headerRow; r <= lastRow; r += 1) {
    for (let c = 0; c < tableColCount; c += 1) {
      const addr = XLSX.utils.encode_cell({ r, c });
      if (!ws[addr]) {
        ws[addr] = { t: 's', v: '' };
      }
      const isHeader = r === headerRow;
      const isSalaryCol = c === 6;
      const isNumericAmountCol = c === 6;
      const isSnoCol = c === 0;
      const base = {
        border: thinBorder,
        alignment: { vertical: 'center', wrapText: true },
      };
      if (isHeader) {
        ws[addr].s = {
          ...base,
          font: { bold: true },
          alignment: { ...base.alignment, horizontal: 'center' },
        };
      } else if (isNumericAmountCol) {
        const v = ws[addr].v;
        const isNum = typeof v === 'number' && Number.isFinite(v);
        const boldAmount = isSalaryCol;
        if (isNum) {
          ws[addr].t = 'n';
          ws[addr].s = {
            ...base,
            ...(boldAmount ? { font: { bold: true } } : {}),
            alignment: { ...base.alignment, horizontal: 'right' },
            numFmt: '#,##0.00',
          };
        } else {
          ws[addr].s = {
            ...base,
            ...(boldAmount ? { font: { bold: true } } : {}),
            alignment: { ...base.alignment, horizontal: 'right' },
          };
        }
      } else if (isSnoCol) {
        ws[addr].s = {
          ...base,
          alignment: { ...base.alignment, horizontal: 'center' },
        };
      } else {
        ws[addr].s = {
          ...base,
          alignment: { ...base.alignment, horizontal: 'left' },
        };
      }
    }
  }

  return ws;
}

function BankFormatReport({ userRole = 'App Administrator', userEmail = null }) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [payrollNotice, setPayrollNotice] = useState('');
  const [search, setSearch] = useState('');
  const [employeeStatus, setEmployeeStatus] = useState('Active');
  const [reportMonth, setReportMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [payrollFromDate, setPayrollFromDate] = useState('');
  const [payrollToDate, setPayrollToDate] = useState('');
  const [expandedMenus, setExpandedMenus] = useState({});
  const [showNotifications, setShowNotifications] = useState(false);
  const [showSidebarMenu, setShowSidebarMenu] = useState(false);
  const location = useLocation();

  const modulesToShow = useMemo(
    () => getSidebarModulesForUser(resolveSidebarUserEmail(userEmail), userRole),
    [userEmail, userRole]
  );

  const toggleMenu = (index) => {
    setExpandedMenus((prev) => ({
      ...prev,
      [index]: !prev[index],
    }));
  };

  useEffect(() => {
    const reportsIndex = modulesToShow.findIndex((module) => module.label === 'Reports');
    if (reportsIndex !== -1) {
      setExpandedMenus((prev) => ({
        ...prev,
        [reportsIndex]: true,
      }));
    }
  }, [location.pathname, modulesToShow]);

  useEffect(() => {
    const { fromDate, toDate } = payrollMonthToFromToDates(reportMonth);
    setPayrollFromDate(fromDate);
    setPayrollToDate(toDate);
  }, [reportMonth]);

  const payrollFiltersFilled = useMemo(() => {
    const m = String(reportMonth || '').trim();
    const f = String(payrollFromDate || '').trim();
    const t = String(payrollToDate || '').trim();
    return Boolean(m && f && t);
  }, [reportMonth, payrollFromDate, payrollToDate]);

  const payrollFiltersComplete = useMemo(() => {
    if (!payrollFiltersFilled) return false;
    const f = String(payrollFromDate || '').trim();
    const t = String(payrollToDate || '').trim();
    return f <= t;
  }, [payrollFiltersFilled, payrollFromDate, payrollToDate]);

  const loadReport = useCallback(async () => {
    setError('');
    setPayrollNotice('');
    const m = String(reportMonth || '').trim();
    const fromD = String(payrollFromDate || '').trim();
    const toD = String(payrollToDate || '').trim();
    if (!m || !fromD || !toD) {
      setRecords([]);
      setLoading(false);
      return;
    }
    if (fromD > toD) {
      setRecords([]);
      setError('From date must be on or before To date.');
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const bankParams = new URLSearchParams();
      bankParams.append('month', m);
      if (userRole) bankParams.append('userRole', userRole);
      if (userEmail) bankParams.append('userEmail', userEmail);

      const runPayrollTableParams = new URLSearchParams({ month: m });
      const [bankRes, componentsRes, formulaeRes, payslipRes, runPayrollTableRes] =
        await Promise.all([
          fetch(`/server/reports_function/bank-format-report?${bankParams.toString()}`),
          fetch('/server/setupconfig/payroll/components'),
          fetch('/server/setupconfig/payroll/formulae'),
          fetch('/server/payslip_function/getPayslipTemplate'),
          fetch(`/server/payroll_function/run-payroll-table?${runPayrollTableParams.toString()}`),
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
      let payrollRows = [];
      let payrollLoadedOk = false;
      try {
        payrollRows = await fetchPayrollRowsAlignedWithPayrollGrid({
          month: m,
          fromDate: fromD,
          toDate: toD,
          userEmail,
          userRole,
        });
        payrollLoadedOk = payrollRows.length > 0;
      } catch (payrollErr) {
        console.warn('Bank format payroll table fetch:', payrollErr.message);
        payrollRows = [];
      }

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

      if (payrollRows.length > 0) {
        payrollMap = buildPayrollByEmployeeCode(payrollRows);
      }
      if (!payrollLoadedOk) {
        setPayrollNotice(
          `No payroll rows for ${reportMonth} (${fromD}–${toD}). Run Payroll on the Payroll screen for this month, then refresh. May 2026 Salary Amount uses NetPay from the payroll report export.`
        );
      }

      if (!formulaeRes.ok) {
        setPayrollNotice((prev) =>
          prev
            ? `${prev} Setup formulae request failed (HTTP ${formulaeRes.status}); using payroll row defaults where needed.`
            : `Setup formulae could not be loaded (HTTP ${formulaeRes.status}). Bank amounts use payroll row + defaults.`
        );
      } else if (payrollFormulae.length === 0) {
        setPayrollNotice((prev) =>
          prev
            ? `${prev} No formulae parsed from Setup (check Components → Formulas).`
            : 'No payroll formulae parsed from Setup Configuration. Add formulas under Components (Formulas column), then refresh.'
        );
      }

      const merged = mergeBankFormatRowsWithPayroll({
        bankRows,
        payrollMap,
        payrollLoadedOk,
        bankReportPayrollOpts,
        runPayrollTableMap,
        preferPayrollTableNetPay: false,
      });
      const gridDisplayMap = buildPayrollGridDisplayMapForBankReports(
        payrollRows,
        bankReportPayrollOpts
      );
      const withSalary = merged.map((row) => {
        const payrollRow = getPayrollRowForBank(payrollMap, row);
        const status = String(
          row.employeeStatus ??
            row.EmployeeStatus ??
            payrollRow?.employeeStatus ??
            payrollRow?.EmployeeStatus ??
            ''
        ).trim();
        return {
          ...row,
          employeeStatus: status,
          bankSalaryAmount: resolveBankReportSalaryAmountLikeNeft(
            row,
            m,
            gridDisplayMap,
            payrollMap,
            bankReportPayrollOpts
          ),
        };
      });

      setRecords(withSalary);
    } catch (err) {
      setError(err.message || 'Unable to load bank format report');
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }, [reportMonth, payrollFromDate, payrollToDate, userEmail, userRole]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  const normalizedRows = useMemo(() => {
    return records.map((row, index) => ({
      sno: index + 1,
      employeeCode: row.employeeCode || row.EmployeeCode || row.employeeId || '-',
      employeeName: row.employeeName || row.EmployeeName || '-',
      employeeStatus: row.employeeStatus || '-',
      bankName: row.bankName || row.BankName || '-',
      bankBranch: row.bankBranch || row.BankBranch || '-',
      accountNumber: row.accountNumber || row.AccountNumber || '-',
      ifscCode: row.ifscCode || row.IFSCCode || '-',
      pf: formatMergedMoneyMaybe(row.pfPayroll),
      esi: formatMergedMoneyMaybe(row.esiPayroll),
      loanAllowance: formatMergedMoneyMaybe(row.loanAllowancePayroll, row.loanAllowance, row.LoanAllowance),
      uniformDeduction: formatMergedMoneyMaybe(
        row.uniformDeductionPayroll,
        row.uniformDeduction,
        row.UniformDeduction
      ),
      attendanceDeduction: formatMergedMoneyMaybe(row.attendanceDeductionPayroll),
      late: formatMergedMoneyMaybe(row.latePayroll, row.late, row.Late),
      earnedGrossSalary: formatSalaryForBankReport(resolveEarnedGrossForBankMergedRow(row)),
      totalDeduction: formatSalaryForBankReport(
        (() => {
          const td =
            parsePayrollAmountLoose(row.totalDeductionPayroll) ??
            parsePayrollAmountLoose(row.totalDeduction) ??
            parsePayrollAmountLoose(row.TotalDeduction);
          if (td != null && Number.isFinite(td)) return td;
          return '';
        })()
      ),
      salaryAmount: formatSalaryForBankReport(row.bankSalaryAmount),
    }));
  }, [records]);

  const filteredRows = useMemo(() => {
    let list = normalizedRows;
    if (employeeStatus !== 'All') {
      list = list.filter((row) => {
        const status = String(row.employeeStatus || '').trim();
        return status.toLowerCase() === employeeStatus.toLowerCase();
      });
    }
    const term = search.trim().toLowerCase();
    if (!term) return list;
    return list.filter((row) =>
      [
        row.employeeCode,
        row.employeeName,
        row.employeeStatus,
        row.bankName,
        row.bankBranch,
        row.accountNumber,
        row.ifscCode,
        row.pf,
        row.esi,
        row.loanAllowance,
        row.uniformDeduction,
        row.attendanceDeduction,
        row.late,
        row.totalDeduction,
        row.salaryAmount,
      ]
        .join(' ')
        .toLowerCase()
        .includes(term)
    );
  }, [normalizedRows, search, employeeStatus]);

  const handleExportExcel = () => {
    if (!filteredRows.length || !payrollFiltersComplete) return;
    const ws = buildBankLetterExcelSheet(filteredRows, reportMonth);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'emp');
    const range = `${payrollFromDate}_${payrollToDate}`.replace(/\//g, '-');
    XLSX.writeFile(wb, `bank_format_report_${reportMonth}_${range}.xlsx`);
  };

  const userAvatar =
    'https://images.pexels.com/photos/2379004/pexels-photo-2379004.jpeg?auto=compress&cs=tinysrgb&w=150';
  const userName = userRole === 'App Administrator' ? 'Admin User' : 'App User';

  const recentActivities = [
    {
      icon: <User size={20} />,
      title: 'Bank Report Ready',
      description: 'Bank format records are available for export',
      time: 'Just now',
    },
    {
      icon: <BarChart3 size={20} />,
      title: 'Report Updated',
      description: 'Latest employee bank details have been synced',
      time: '1 hour ago',
    },
    {
      icon: <CheckCircle size={20} />,
      title: 'Validation Complete',
      description: 'Account details validation completed',
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
              <div className="employee-section-title">Bank Format Report</div>

              <div className="bank-report-actions">
                <label className="bank-report-month-label">
                  Payroll month
                  <input
                    type="month"
                    className="bank-report-month-input"
                    value={reportMonth}
                    onChange={(e) => setReportMonth(e.target.value)}
                  />
                </label>
                <label className="bank-report-month-label">
                  From date
                  <input
                    type="date"
                    className="bank-report-month-input"
                    value={payrollFromDate}
                    onChange={(e) => setPayrollFromDate(e.target.value)}
                  />
                </label>
                <label className="bank-report-month-label">
                  To date
                  <input
                    type="date"
                    className="bank-report-month-input"
                    value={payrollToDate}
                    onChange={(e) => setPayrollToDate(e.target.value)}
                  />
                </label>
                <label className="bank-report-month-label">
                  Status
                  <select
                    className="bank-report-month-input bank-report-status-select"
                    value={employeeStatus}
                    onChange={(e) => setEmployeeStatus(e.target.value)}
                  >
                    <option value="All">All</option>
                    <option value="Active">Active</option>
                    <option value="Inactive">Inactive</option>
                  </select>
                </label>
                <input
                  type="text"
                  className="bank-report-search"
                  placeholder="Search by employee, bank, account, IFSC, salary…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <button
                  className="cms-btn"
                  type="button"
                  onClick={handleExportExcel}
                  disabled={!filteredRows.length || !payrollFiltersComplete}
                >
                  <Download size={16} /> Export Excel
                </button>
              </div>

              {payrollNotice && <div className="bank-report-notice">{payrollNotice}</div>}
              {error && <div className="bank-report-error">{error}</div>}
              {loading && <div className="bank-report-loading">Loading bank report...</div>}

              <div className="muster-table-scroll">
                <table className="muster-table bank-report-table">
                  <thead>
                    <tr>
                      <th>S.No</th>
                      <th>Employee Code</th>
                      <th>Employee Name</th>
                      <th>Status</th>
                      <th>Bank Name</th>
                      <th>Bank Branch</th>
                      <th>Account Number</th>
                      <th>IFSC Code</th>
                      <th>Salary Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!loading && filteredRows.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="bank-report-empty">
                          {!payrollFiltersFilled
                            ? 'Choose payroll month, from date, and to date to generate the report.'
                            : !payrollFiltersComplete
                              ? 'From date must be on or before To date.'
                              : normalizedRows.length === 0
                                ? 'No bank records found.'
                                : employeeStatus !== 'All' && !search.trim()
                                  ? `No ${employeeStatus.toLowerCase()} employees for this month.`
                                  : 'No rows match your filters.'}
                        </td>
                      </tr>
                    ) : (
                      filteredRows.map((row) => (
                        <tr key={`${row.employeeCode}-${row.sno}`}>
                          <td>{row.sno}</td>
                          <td>{row.employeeCode}</td>
                          <td>{row.employeeName}</td>
                          <td>{row.employeeStatus}</td>
                          <td>{row.bankName}</td>
                          <td>{row.bankBranch}</td>
                          <td>{row.accountNumber}</td>
                          <td>{row.ifscCode}</td>
                          <td>{row.salaryAmount}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </main>
        </div>
      </div>
    </>
  );
}

export default BankFormatReport;
