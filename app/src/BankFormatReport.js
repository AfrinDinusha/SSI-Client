import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import * as XLSX from 'xlsx-js-style';
import { Bell, Download, Plus, User, BarChart3, CheckCircle } from 'lucide-react';
import './BankFormatReport.css';
import './Attendancemuster.css';
import './employeeManagement.css';
import './Candidateform.css';
import HeaderBranding from './HeaderBranding';
import { getSidebarModulesForUser, resolveSidebarUserEmail } from './modulesConfig';
import {
  extractPayrollFormulaeRows,
  normalizePayrollRowLikePayrollFetch,
  parsePayrollComponentsFromApi,
  parsePayrollFormulaeFromApi,
  payrollDisplayAlignedWithPayrollGrid,
} from './payrollBankReportNetPay';

function formatSalaryForBankReport(val) {
  if (val === null || val === undefined || val === '') return '-';
  const s = String(val).replace(/,/g, '').trim();
  const n = parseFloat(s);
  if (Number.isFinite(n)) return n.toFixed(2);
  return String(val).trim() || '-';
}

/** True when bank-format API (reports_function) sent a usable amount, including 0. */
function bankApiFieldHasNumericValue(v) {
  if (v === null || v === undefined) return false;
  if (typeof v === 'number' && Number.isFinite(v)) return true;
  const s = String(v).replace(/,/g, '').trim();
  if (s === '' || s === '-') return false;
  const n = parseFloat(s);
  return Number.isFinite(n);
}

/** Prefer payroll-aligned values (same pipeline as Payroll grid); else bank-format API / employee master. */
function preferPayrollAlignedThenBankApi(payrollVal, bankApiVal) {
  if (payrollVal !== null && payrollVal !== undefined && payrollVal !== '') {
    if (typeof payrollVal === 'number' && Number.isFinite(payrollVal)) return payrollVal;
    const s = String(payrollVal).replace(/,/g, '').trim();
    if (s !== '' && s !== '-' && Number.isFinite(parseFloat(s))) return payrollVal;
  }
  if (bankApiFieldHasNumericValue(bankApiVal)) return bankApiVal;
  return '';
}

function pickBackendSalaryOrNetColumn(row) {
  if (bankApiFieldHasNumericValue(row?.salaryAmount)) return row.salaryAmount;
  if (bankApiFieldHasNumericValue(row?.netPay)) return row.netPay;
  return '';
}

/** Same as payroll_function/index.js — match "00123", leading zeros, "123.0". */
function normalizeEmployeeCode(code) {
  const raw = String(code ?? '').trim();
  if (!raw) return '';
  const withoutDecimalZero = raw.endsWith('.0') ? raw.slice(0, -2) : raw;
  return withoutDecimalZero.replace(/^0+(?=\d)/, '') || raw;
}

/** Normalized id variants for matching bank rows to payroll GET /payroll rows. */
function candidateEmployeeCodesFromRow(row) {
  if (!row || typeof row !== 'object') return [];
  const raw = [
    row.employeeCode,
    row.EmployeeCode,
    row.employeeID,
    row.EmployeeID,
    row.EmployeeId,
    row.employeeId,
  ];
  const out = new Set();
  for (const v of raw) {
    if (v == null || v === '') continue;
    const s = String(v).trim();
    if (!s) continue;
    out.add(s);
    const norm = normalizeEmployeeCode(s);
    if (norm && norm !== s) out.add(norm);
    if (/^\d+$/.test(s)) out.add(String(parseInt(s, 10)));
    if (norm && /^\d+$/.test(norm)) out.add(String(parseInt(norm, 10)));
  }
  return [...out];
}

/** Catalyst / ZCQL sometimes wraps row data under `Payroll`; merge so employeeCode / NetPay match Payroll.js. */
function flattenPayrollRowIfNeeded(raw) {
  if (!raw || typeof raw !== 'object') return raw;
  const inner = raw.Payroll;
  if (inner && typeof inner === 'object') {
    return { ...raw, ...inner };
  }
  return raw;
}

function buildPayrollByEmployeeCode(rows) {
  const map = new Map();
  for (const raw of rows || []) {
    const r = flattenPayrollRowIfNeeded(raw);
    for (const c of candidateEmployeeCodesFromRow(r)) {
      map.set(c, r);
    }
  }
  return map;
}

function getPayrollRowForBank(map, bankRow) {
  for (const c of candidateEmployeeCodesFromRow(bankRow)) {
    if (map.has(c)) return map.get(c);
  }
  return undefined;
}

/** Map from GET payroll_function/run-payroll-table (RunPayroll snapshot). */
function buildRunPayrollTableMapFromApi(rows) {
  const map = new Map();
  for (const raw of rows || []) {
    if (!raw || typeof raw !== 'object') continue;
    const code = raw.employeeCode ?? raw.EmployeeCode;
    if (code == null || String(code).trim() === '') continue;
    const synthetic = {
      employeeCode: String(code).trim(),
      earnedSalaryGross: raw.earnedSalaryGross ?? raw.earned_gross ?? null,
      netPay: raw.netPay ?? raw.net_pay ?? null,
    };
    for (const c of candidateEmployeeCodesFromRow({
      employeeCode: synthetic.employeeCode,
      EmployeeCode: synthetic.employeeCode,
    })) {
      map.set(c, synthetic);
    }
  }
  return map;
}

function getRunPayrollTableRowForBank(map, bankRow) {
  for (const c of candidateEmployeeCodesFromRow(bankRow)) {
    if (map.has(c)) return map.get(c);
  }
  return undefined;
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

/** First and last calendar day of YYYY-MM (for payroll fromDate / toDate). */
function payrollMonthToFromToDates(monthStr) {
  const parts = String(monthStr || '').trim().split('-').map(Number);
  const y = parts[0];
  const m = parts[1];
  if (!y || !m || m < 1 || m > 12) return { fromDate: '', toDate: '' };
  const mm = String(m).padStart(2, '0');
  const fromDate = `${y}-${mm}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const toDate = `${y}-${mm}-${String(lastDay).padStart(2, '0')}`;
  return { fromDate, toDate };
}

function salaryDisplayToNumber(display) {
  if (display == null || display === '' || display === '-') return null;
  const n = parseFloat(String(display).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
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
  ws['!merges'] = [
    { s: { r: 0, c: 1 }, e: { r: 0, c: 9 } },
    { s: { r: 2, c: 1 }, e: { r: 2, c: 9 } },
    { s: { r: 4, c: 2 }, e: { r: 4, c: 9 } },
    { s: { r: 6, c: 1 }, e: { r: 6, c: 9 } },
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
      } else if (isSalaryCol) {
        const v = ws[addr].v;
        const isNum = typeof v === 'number' && Number.isFinite(v);
        if (isNum) {
          ws[addr].t = 'n';
          ws[addr].s = {
            ...base,
            font: { bold: true },
            alignment: { ...base.alignment, horizontal: 'right' },
            numFmt: '#,##0.00',
          };
        } else {
          ws[addr].s = {
            ...base,
            font: { bold: true },
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

      const payrollParams = new URLSearchParams({
        month: reportMonth,
        _t: String(Date.now()),
      });
      payrollParams.append('fromDate', fromD);
      payrollParams.append('toDate', toD);
      if (userRole) payrollParams.append('userRole', userRole);
      if (userEmail) payrollParams.append('userEmail', userEmail);

      const runPayrollTableParams = new URLSearchParams({ month: m });
      const [bankRes, payrollRes, componentsRes, formulaeRes, payslipRes, runPayrollTableRes] =
        await Promise.all([
          fetch(`/server/reports_function/bank-format-report?${bankParams.toString()}`),
          fetch(`/server/payroll_function/payroll?${payrollParams.toString()}`),
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
            ? `Payroll for ${reportMonth} (${fromD}–${toD}) could not be loaded (HTTP ${payrollRes.status}).`
            : '');
        if (msg) {
          setPayrollNotice(`${msg} Salary amount falls back to employee master where available.`);
        }
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

      const merged = bankRows.map((row) => {
        const p = getPayrollRowForBank(payrollMap, row);
        const masterBranch = String(row.bankBranch ?? row.BankBranch ?? '').trim();
        const masterBank = String(row.bankName ?? row.BankName ?? '').trim();
        let next = {
          ...row,
          actualBasicPayroll: null,
          earnedBasicPayroll: null,
          earnedGrossPayroll: null,
          totalDeductionPayroll: null,
          netPayPayroll: null,
        };
        const rpTbl = getRunPayrollTableRowForBank(runPayrollTableMap, row);
        let rpEg = row.runPayrollOverrideEarnedGross === true;
        let rpNp = row.runPayrollOverrideNetPay === true;
        if (rpTbl) {
          if (rpTbl.netPay != null && Number.isFinite(Number(rpTbl.netPay))) {
            const npv = Number(rpTbl.netPay);
            next.netPay = npv;
            next.salaryAmount = npv.toFixed(2);
            rpNp = true;
          }
          if (rpTbl.earnedSalaryGross != null && Number.isFinite(Number(rpTbl.earnedSalaryGross))) {
            next.earnedGross = Number(rpTbl.earnedSalaryGross);
            rpEg = true;
          }
        }
        /** Same pipeline as Payroll grid (payrollBankReportNetPay + Setup formulae). Overrides bank-format API so amounts match Payroll. */
        /** When RunPayroll snapshot or API set runPayrollOverride*, keep Earned Gross / Net Pay from RunPayroll / bank-format response. */
        if (p && payrollLoadedOk) {
          const normalized = normalizePayrollRowLikePayrollFetch(flattenPayrollRowIfNeeded(p));
          const d = payrollDisplayAlignedWithPayrollGrid(normalized, bankReportPayrollOpts);
          if (d) {
            next.actualBasicPayroll = Number.isFinite(d.actualBasic) ? d.actualBasic.toFixed(2) : null;
            next.earnedBasicPayroll = Number.isFinite(d.earnedBasic) ? d.earnedBasic.toFixed(2) : null;
            if (!rpEg) {
              next.earnedGrossPayroll = d.earnedGross;
            } else {
              next.earnedGrossPayroll = null;
            }
            next.totalDeductionPayroll = d.totalDeduction;
            if (!rpNp) {
              next.netPayPayroll = d.netPay;
              next.salaryAmount = d.netPay;
            } else {
              next.netPayPayroll = null;
            }
            if (Number.isFinite(d.actualBasic)) {
              next.actualBasic = d.actualBasic.toFixed(2);
            }
            if (Number.isFinite(d.earnedBasic)) {
              next.earnedBasic = d.earnedBasic.toFixed(2);
            }
            if (!rpEg && Number.isFinite(d.earnedGross)) {
              next.earnedGross = d.earnedGross;
            }
            if (Number.isFinite(d.totalDeduction)) {
              next.totalDeduction = d.totalDeduction;
            }
            if (!rpNp && Number.isFinite(d.netPay)) {
              next.netPay = d.netPay;
            }
          }
          const pb = String(p.bankBranch || '').trim();
          if (pb && (!masterBranch || masterBranch === '-')) {
            next.bankBranch = pb;
          }
          const pbn = String(p.bankName || '').trim();
          if (pbn && (!masterBank || masterBank === '-')) {
            next.bankName = pbn;
          }
          const pifsc = String(p.ifscCode || '').trim();
          if (pifsc && !(String(next.ifscCode || next.IFSCCode || '').trim())) {
            next.ifscCode = pifsc;
          }
        }
        return next;
      });

      setRecords(merged);
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
      bankName: row.bankName || row.BankName || '-',
      bankBranch: row.bankBranch || row.BankBranch || '-',
      accountNumber: row.accountNumber || row.AccountNumber || '-',
      ifscCode: row.ifscCode || row.IFSCCode || '-',
      salaryAmount: formatSalaryForBankReport(
        preferPayrollAlignedThenBankApi(
          row.netPayPayroll,
          pickBackendSalaryOrNetColumn(row) ||
            row.salaryAmount ||
            row.SalaryAmount ||
            row.totalSalary ||
            row.TotalSalary
        )
      ),
    }));
  }, [records]);

  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return normalizedRows;
    return normalizedRows.filter((row) =>
      [
        row.employeeCode,
        row.employeeName,
        row.bankName,
        row.bankBranch,
        row.accountNumber,
        row.ifscCode,
        row.salaryAmount,
      ]
        .join(' ')
        .toLowerCase()
        .includes(term)
    );
  }, [normalizedRows, search]);

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
                <input
                  type="text"
                  className="bank-report-search"
                  placeholder="Search by employee code, name, bank, branch, account, IFSC, salary amount"
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
                        <td colSpan={8} className="bank-report-empty">
                          {!payrollFiltersFilled
                            ? 'Choose payroll month, from date, and to date to generate the report.'
                            : !payrollFiltersComplete
                              ? 'From date must be on or before To date.'
                              : 'No bank records found.'}
                        </td>
                      </tr>
                    ) : (
                      filteredRows.map((row) => (
                        <tr key={`${row.employeeCode}-${row.sno}`}>
                          <td>{row.sno}</td>
                          <td>{row.employeeCode}</td>
                          <td>{row.employeeName}</td>
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
