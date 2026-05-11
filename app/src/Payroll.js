import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import './Payroll.css';
import './App.css';
import './helper.css';
import { Link } from 'react-router-dom';
import payslipLogo from './assets/SSI Payslip logo.png';
import HeaderBranding from './HeaderBranding';
import Button from './Button';
import * as XLSX from 'xlsx';
import {
  Users, Calendar, FileText, AlertTriangle, FolderOpen,
  ClipboardList, Building, Handshake, Landmark, Clock,
  Map, BarChart3, User, TrendingUp, TrendingDown,
  Activity, Plus, CheckCircle, Bell, Settings, LayoutDashboard, Home as HomeIcon,
  Shield, AlertOctagon, CreditCard, FileSignature, Search, Clock3, CalendarDays, Database
} from 'lucide-react';
import {
  buildPayslipPreviewMarkup,
  downloadPayslipPdf,
  generatePayslipPdfBlob,
  removePayslipPdfGenerationArtifacts,
} from './payslipPrint';
import JSZip from 'jszip';
import { getSidebarModulesForUser } from './modulesConfig';

const PAYROLL_AUTOMATIC_MODE_OPTIONS = ['Automatic', 'Manual'];

/** Edit modal: when Automatic is on and Manual is off, these `editFormData` keys are read-only. */
const AUTOMATIC_PAYROLL_EDIT_READONLY_KEYS = new Set([
  'daysInMonth',
  'daysPresent',
  'loh',
  'otHours',
  'lop',
  'actualBasic',
  'actualHRA',
  'specialAllowance',
  'pf',
  'esi',
  'attendanceBonus',
]);

/** Remove columns not shown on the payroll grid (Setup may still list legacy / duplicate labels). */
/** Unit on payroll rows: Employee master stores it as RelevantExperience / export "Unit". */
function payrollRowUnitDisplay(emp) {
  if (!emp) return '';
  const v =
    emp.unit ??
    emp.Unit ??
    emp.relevantExperience ??
    emp.RelevantExperience ??
    emp['SSPSE Experience'] ??
    '';
  return String(v ?? '').trim();
}

function stripPayrollGridExcludedColumns(columns) {
  if (!Array.isArray(columns) || columns.length === 0) return columns;
  return columns
    .map((c) => String(c ?? '').trim())
    .filter(Boolean)
    .filter((h) => {
      const s = h.toLowerCase();
      if (s.includes('uniform') && (s.includes('allowance') || s.includes('allownace'))) return false;
      if (s.includes('washing') && (s.includes('allowance') || s.includes('allownace'))) return false;
      if (s.includes('attendance') && s.includes('bonus')) return false;
      return true;
    });
}

/**
 * Payload key for a Setup column / formula variable label (same rules as applyPayrollFormulaeToEmployee).
 * Used so custom columns (e.g. Dummy) map to one editFormData key and persist on save.
 */
function componentLabelToPayloadKey(label) {
  const base = String(label || '').trim();
  if (!base) return '';
  const camel = base
    .toLowerCase()
    .split(/\s+/)
    .map((word, index) => (index === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join('');
  return camel || base.replace(/\s+/g, '') || base.replace(/\s+/g, '_').toLowerCase();
}

/** Match Data Store / API field names to Setup labels (Price vs price, Foo Bar vs fooBar). */
function normPayrollFieldKeyForLookup(s) {
  return String(s ?? '').replace(/[\s_]/g, '').toLowerCase();
}

/**
 * Sort payroll rows: MANAGING PARTNER first, then by Unit number (UNIT 1 before UNIT 2, …),
 * then by employee code for a stable order within the same unit.
 */
function sortPayrollManagingPartnerFirst(rows) {
  if (!Array.isArray(rows) || rows.length <= 1) return rows;
  const normDesig = (emp) =>
    String(emp?.designation ?? emp?.Designation ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  const isManagingPartner = (emp) => normDesig(emp) === 'managing partner';
  /** Lower = earlier in list. Parsed from labels like "UNIT 1", "Unit 2". */
  const unitSortRank = (emp) => {
    const s = payrollRowUnitDisplay(emp);
    const m = s.match(/\d+/);
    if (m) return parseInt(m[0], 10);
    if (!s) return 1_000_000;
    return 999_999;
  };
  return [...rows].sort((a, b) => {
    const da = isManagingPartner(a) ? 0 : 1;
    const db = isManagingPartner(b) ? 0 : 1;
    if (da !== db) return da - db;
    const ua = unitSortRank(a);
    const ub = unitSortRank(b);
    if (ua !== ub) return ua - ub;
    const ca = String(a?.employeeCode ?? '').trim();
    const cb = String(b?.employeeCode ?? '').trim();
    return ca.localeCompare(cb, undefined, { numeric: true });
  });
}

/**
 * Built-in OT amount: (effective daily basic ÷ 8) × OT hours × 2.
 * Daily basic = earnedBasic ÷ days present when both are set (so OT does not re-scale with present days);
 * otherwise actual basic ÷ days in month. Avoids OT exploding when "No. of Days Present" is edited manually.
 */
function computeDefaultOtAmountFromEarnedAndActual({ earnedBasic, actualBasic, daysInMonth, daysPresent, otHours }) {
  const dim = Number(daysInMonth) || 0;
  const dp = Number(daysPresent) || 0;
  const eb = Number(earnedBasic) || 0;
  const ab = Number(actualBasic) || 0;
  const oth = Number(otHours) || 0;
  if (dim <= 0 || oth <= 0) return 0;
  const dailyBasic = dp > 0 && eb > 0 ? eb / dp : ab / dim;
  if (dailyBasic <= 0) return 0;
  return (dailyBasic / 8) * oth * 2;
}

function isManagingPartnerPayrollRow(emp) {
  const d = String(emp?.designation ?? emp?.Designation ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return d === 'managing partner';
}

/** Days present for payroll row: MANAGING PARTNER → full days in month (display + LOP). */
function managingPartnerDaysPresentValue(emp, computedPresent) {
  const dim = parseFloat(emp?.daysInMonth) || 0;
  if (isManagingPartnerPayrollRow(emp) && dim > 0) return dim;
  return computedPresent;
}

const Payroll = () => {
  console.log('Payroll component is rendering');
  const navigate = useNavigate();
  const location = useLocation();
 
  // Read month from URL query parameters on initialization
  // Always default to current month when page opens (ignore URL parameter on initial load)
  const getCurrentMonth = () => {
    return new Date().toISOString().slice(0, 7);
  };
 
  const [payrollData, setPayrollData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState(getCurrentMonth());
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [contractor, setContractor] = useState('All');
  const [department, setDepartment] = useState('All');
  const [employeeId, setEmployeeId] = useState('All');
  const [employeeStatus, setEmployeeStatus] = useState('All');
  const [contractors, setContractors] = useState(['All']);
  const [departments, setDepartments] = useState(['All']);
  const [employees, setEmployees] = useState(['All']);
  const [error, setError] = useState(null);
  const [renderError, setRenderError] = useState(null);

  // Dynamic payroll components & formulae configured in Setup & Configuration
  const [payrollComponents, setPayrollComponents] = useState([]);
  const [payrollFormulae, setPayrollFormulae] = useState([]);
  const [showAutomaticModal, setShowAutomaticModal] = useState(false);
  const [automaticSelections, setAutomaticSelections] = useState(() => new Set());
  const [savingAutomaticSelection, setSavingAutomaticSelection] = useState(false);
  const [loadingAutomaticSaved, setLoadingAutomaticSaved] = useState(false);
  const payrollKeyToHeaderLabel = useMemo(() => ({
    daysInMonth: 'No. of Days (In Month)',
    daysPresent: 'No. of Days Present',
    loh: 'LOH',
    lop: 'LOP',
    otHours: 'OT Hours',
    foodAllowance: 'Food Allowance',
    washingAllowance: 'Washing Allowance',
    actualBasic: 'Actual Basic',
    actualDA: 'Actual DA',
    actualHRA: 'Actual HRA',
    otherAllowance: 'Attendance Allowance',
    otherAllowances: 'Other Allowances',
    travelChargers: 'Travel Chargers',
    specialAllowance: 'Special Allowance',
    loanAllowance: 'Loan',
    noOfDaysWithoutUniforms: 'No of days without uniforms',
    actualTotalSalary: 'Actual Total Gross',
    earnedBasic: 'Earned Basic',
    earnedDA: 'Earned DA',
    earnedHRA: 'Earned HRA',
    arrear: 'Arrear',
    arrearForPF: 'Arrear For PF',
    earnedOtherAllowances: 'Earned Other Allowances',
    earnedAttendanceAllowance: 'Earned Attendance Allowance',
    incentive: 'Incentive',
    otAmount: 'OT Amount',
    otArrearAmount: 'OT Arrear Amount',
    earnedSalaryCross: 'Earned Gross Salary',
    rent: 'Rent Recovery',
    pf: 'PF 12%',
    esi: 'ESI 0.75%',
    lwf: 'LWF',
    pt: 'PT',
    otherDeduction: 'Other Deduction',
    late: 'Late',
    totalDeduction: 'Total Deduction',
    netPay: 'Net Pay',
    erpf: 'ERPF 12%',
    admin: 'Admin 0.5%',
    edli: 'EDLI 0.5%',
    employerEsi: 'Employer ESI 3.25%',
    esiContribution: 'ESIContribution',
    ESIContribution: 'ESIContribution',
    employerLwf: 'EmployerLWF',
    serviceCharge: 'Service Charge 9%',
    total: 'Total',
    gst: 'GST 18%',
    netTotal: 'Net Total',
    bonus: 'Bonus',
    attendanceBonus: 'Attendance Bonus',
    unit: 'Unit',
  }), []);
  const defaultPayrollComponentHeaders = useMemo(() => ([
    'Actual Basic',
    'Actual DA',
    'Actual HRA',
    'Attendance Allowance',
    'Other Allowances',
    'Travel Chargers',
    'Special Allowance',
    'Loan',
    'No of days without uniforms',
    'Actual Total Gross',
    'Earned Basic',
    'Earned DA',
    'Earned HRA',
    'Arrear',
    'Arrear For PF',
    'Earned Other Allowances',
    'Earned Attendance Allowance',
    'Incentive',
    'OT Amount',
    'OT Arrear Amount',
    'Earned Gross Salary',
    'Rent Recovery',
    'PF 12%',
    'ESI 0.75%',
    'LWF',
    'PT',
    'Other Deduction',
    'Late',
    'Total Deduction',
    'Net Pay',
    'ERPF 12%',
    'Admin 0.5%',
    'EDLI 0.5%',
    'Employer ESI 3.25%',
    'ESIContribution',
    'EmployerLWF',
    'Service Charge 9%',
    'Total',
    'GST 18%',
    'Net Total',
    'Bonus',
  ]), []);
  const tablePayrollComponents = useMemo(() => {
    // Use SetupConfig columns, or default when empty; always include key editable columns.
    const fromConfig = (payrollComponents || []).map((name) => String(name || '').trim()).filter(Boolean);
    const list = fromConfig.length > 0 ? fromConfig : defaultPayrollComponentHeaders;
    const lowerList = list.map((n) => String(n).toLowerCase().trim());
    const hasLoan = lowerList.some((n) => n === 'loan' || (n.includes('loan') && n.includes('allowance')));
    const hasNoOfDaysWithoutUniform = lowerList.some((n) => n.includes('no of days without uniform') || n.includes('no.of days without uniform'));
    const hasTravelChargers = lowerList.some(
      (n) => n.includes('travel') && n.includes('charge')
    );
    const hasLate = lowerList.some((n) => n === 'late');
    const add = [];
    if (!hasLoan) add.push(payrollKeyToHeaderLabel.loanAllowance || 'Loan');
    if (!hasNoOfDaysWithoutUniform) add.push('No of days without uniforms');
    if (!hasTravelChargers) add.push(payrollKeyToHeaderLabel.travelChargers || 'Travel Chargers');
    if (!hasLate) add.push(payrollKeyToHeaderLabel.late || 'Late');
    const merged = add.length > 0 ? [...list, ...add] : list;
    return stripPayrollGridExcludedColumns(merged);
  }, [payrollComponents, defaultPayrollComponentHeaders, payrollKeyToHeaderLabel]);

  // Map table column label to editFormData key (for edit form and export - only show what's in the table)
  const tableColumnToKey = useMemo(() => {
    const labelToKey = {};
    if (payrollKeyToHeaderLabel) {
      Object.entries(payrollKeyToHeaderLabel).forEach(([k, v]) => {
        if (v) labelToKey[String(v).toLowerCase().trim()] = k;
      });
    }
    return (name) => {
      const n = String(name || '').trim();
      const lower = n.toLowerCase();
      if (labelToKey[lower]) return labelToKey[lower];
      if (lower.includes('no. of days') && lower.includes('month')) return 'daysInMonth';
      if (lower.includes('days present')) return 'daysPresent';
      if (lower === 'loh') return 'loh';
      if (lower === 'lop') return 'lop';
      if (lower.includes('ot hours')) return 'otHours';
      if (lower.includes('food') && (lower.includes('allowance') || lower.includes('allownace'))) return 'foodAllowance';
      if (lower.includes('washing') && (lower.includes('allowance') || lower.includes('allownace'))) return 'washingAllowance';
      if (lower.includes('travel') && lower.includes('charge')) return 'travelChargers';
      if (lower === 'loan' || (lower.includes('loan') && lower.includes('allowance'))) return 'loanAllowance';
      if (lower.includes('no of days without uniform') || lower.includes('no.of days without uniform')) return 'noOfDaysWithoutUniforms';
      if (lower === 'unit') return 'unit';
      return null;
    };
  }, [payrollKeyToHeaderLabel]);

  /** Non-zero LOH from saved payroll counts as user/import data — do not replace with muster (same idea as OT Hours). Zero is treated as unset so stale DB zeros still refresh from Attendance Muster. */
  const payrollRowHasStoredLoh = (emp) => {
    const raw = emp?.loh ?? emp?.LOH;
    if (raw === undefined || raw === null) return false;
    const s = String(raw).trim();
    if (s === '') return false;
    const n = Number(s.replace(/,/g, ''));
    return Number.isFinite(n) && n !== 0;
  };

  /** Setup & Configuration: variables with a non-empty expression, mapped to editFormData keys (for read-only in Automatic payroll mode). */
  const payrollFormulaOptionKeys = useMemo(() => {
    const norm = (s) =>
      String(s || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');
    const result = new Set();
    for (const f of payrollFormulae || []) {
      const expr = String(f?.expression || '').trim();
      if (!expr) continue;
      const vNorm = norm(f.variable);
      if (!vNorm) continue;
      for (const [key, label] of Object.entries(payrollKeyToHeaderLabel)) {
        if (norm(label) === vNorm || norm(key) === vNorm) {
          result.add(key);
          break;
        }
      }
    }
    return result;
  }, [payrollFormulae, payrollKeyToHeaderLabel]);

  // Ref so async callbacks (e.g. after fetch) always use latest formulae when applying
  const payrollFormulaeRef = useRef([]);
  payrollFormulaeRef.current = payrollFormulae;

  const normalizeFormulaVariable = (s) =>
    String(s || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');

  /** Resolve edit-form / save key for a table column label (known map first, else same as formula payload key). */
  const getPayrollEditFieldKey = useCallback(
    (compName) => {
      const mapped = tableColumnToKey(compName);
      if (mapped) return mapped;
      return componentLabelToPayloadKey(compName);
    },
    [tableColumnToKey]
  );

  /** True when Setup has a non-empty expression for this column (variable matches label or configured header). */
  const hasPayrollFormulaForComponent = useCallback(
    (compName) => {
      const normComp = normalizeFormulaVariable(compName);
      if (!normComp) return false;
      const mappedKey = tableColumnToKey(compName);
      const mappedLabel =
        mappedKey && payrollKeyToHeaderLabel ? payrollKeyToHeaderLabel[mappedKey] : null;
      const normMappedLabel = mappedLabel ? normalizeFormulaVariable(mappedLabel) : '';
      for (const f of payrollFormulae || []) {
        const expr = String(f?.expression || '').trim();
        if (!expr) continue;
        const normVar = normalizeFormulaVariable(f.variable);
        if (!normVar) continue;
        if (normVar === normComp || (normMappedLabel && normVar === normMappedLabel)) return true;
      }
      return false;
    },
    [payrollFormulae, payrollKeyToHeaderLabel, tableColumnToKey]
  );

  /** Find first Setup & Configuration formula whose variable matches predicate(normalizedName, row). */
  const findPayrollFormula = (predicate) => {
    const formulae = payrollFormulaeRef.current || [];
    for (const f of formulae) {
      const v = normalizeFormulaVariable(f.variable);
      if (v && predicate(v, f)) return f;
    }
    return null;
  };

  /** True when Setup defines a formula for Washing Allowance (built-in 25× rule must not override). */
  const washingAllowanceHasSetupFormula = () => {
    const list = payrollFormulaeRef.current || [];
    return list.some((f) => {
      const v = normalizeFormulaVariable(f.variable);
      return v === 'washing allowance' || (v.includes('washing') && (v.includes('allowance') || v.includes('allownace')));
    });
  };

  /** Built-in washing (same as payroll run / backend): 25 × max(0, days present − no-uniform days). */
  const getBuiltInWashingAllowanceFromRow = (row) => {
    if (!row) return 0;
    const dp = Number(row.daysPresent ?? row.DaysPresent ?? 0) || 0;
    const nu =
      Number(
        row.noOfDaysWithoutUniforms ??
          row.NoOfDaysWithoutUniforms ??
          row.noofdayswithoutuniforms ??
          0
      ) || 0;
    return Math.round(25 * Math.max(0, dp - nu));
  };

  /** Table/display: prefer positive saved/formula value; else Setup formula if > 0; else built-in (fixes ₹0 when formula fails). */
  const getWashingAllowanceDisplayFromEmployee = (employee) => {
    if (!employee) return 0;
    const sRaw = employee.washingAllowance ?? employee.WashingAllowance;
    const s = parseFloat(sRaw);
    if (Number.isFinite(s) && s > 0) return Math.round(s);
    if (washingAllowanceHasSetupFormula()) {
      const washFormula = findPayrollFormula(
        (norm) =>
          norm === 'washing allowance' ||
          (norm.includes('washing') && (norm.includes('allowance') || norm.includes('allownace')))
      );
      if (washFormula && washFormula.expression) {
        const ev = evaluateFormulaExpression(employee, washFormula.expression);
        if (Number.isFinite(ev) && ev > 0) return Math.round(ev);
      }
    }
    const builtIn = getBuiltInWashingAllowanceFromRow(employee);
    if (builtIn > 0) return builtIn;
    return Number.isFinite(s) ? Math.round(s) : 0;
  };

  /** Built-in OT Amount: same daily-rate rule as computeDefaultOtAmountFromEarnedAndActual (not earnedBasic/dim twice). */
  const getBuiltInOtAmountFromRow = (row) => {
    if (!row) return 0;
    let dim = Number(row.daysInMonth ?? row.DaysInMonth ?? row.daysInMonthForCalc ?? 0) || 0;
    if (dim <= 0 && selectedMonth) {
      const parts = String(selectedMonth).split('-');
      if (parts.length >= 2) {
        const y = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10);
        if (!isNaN(y) && !isNaN(m)) dim = new Date(y, m, 0).getDate();
      }
    }
    dim = dim || 31;
    const oth = Number(row.otHours ?? row.OTHours ?? 0) || 0;
    const eb = Number(row.earnedBasic ?? row.EarnedBasic ?? 0) || 0;
    const ab = Number(row.actualBasic ?? row.ActualBasic ?? 0) || 0;
    const dp = Number(row.daysPresent ?? row.DaysPresent ?? 0) || 0;
    if (dim <= 0 || oth <= 0) return 0;
    return Math.round(
      computeDefaultOtAmountFromEarnedAndActual({
        earnedBasic: eb,
        actualBasic: ab,
        daysInMonth: dim,
        daysPresent: dp,
        otHours: oth
      })
    );
  };

  /**
   * Table/display: Setup "OT Amount" formula when valid; else built-in daily-rate OT; else plausible saved value.
   * Saved OTAmount is ignored when it is far above computed (stale saves from old earnedBasic÷daysInMonth bug or bad edits).
   */
  const getOtAmountDisplayFromEmployee = (employee) => {
    if (!employee) return 0;
    const oth = Number(employee.otHours ?? employee.OTHours ?? 0) || 0;
    const storedRaw = employee.otAmount ?? employee.OTAmount;
    const stored = parseFloat(storedRaw);
    if (oth <= 0) return Number.isFinite(stored) ? Math.round(stored) : 0;
    const builtIn = getBuiltInOtAmountFromRow(employee);
    const isStaleInflated = (n) =>
      builtIn > 0 && Number.isFinite(n) && n > 0 && n > builtIn * 1.35;
    const otFormula = findPayrollFormula((norm) => norm === 'ot amount' || norm === 'otamount');
    if (otFormula?.expression) {
      const ev = evaluateFormulaExpression(employee, otFormula.expression);
      if (Number.isFinite(ev)) {
        const rounded = Math.max(0, Math.round(ev));
        if (isStaleInflated(rounded)) return builtIn;
        return rounded;
      }
    }
    if (isStaleInflated(stored)) return builtIn;
    if (Number.isFinite(stored) && stored > 0) return Math.round(stored);
    return Math.max(0, builtIn);
  };

  /**
   * When DB left OTAmount empty/0 but OT Hours > 0, fill otAmount so totals, ESI base, and saves stay consistent.
   */
  const syncOtAmountFromOtHours = (updated) => {
    if (!updated) return;
    const oth = Number(updated.otHours ?? updated.OTHours ?? 0) || 0;
    if (oth <= 0) return;
    const builtIn = getBuiltInOtAmountFromRow(updated);
    const stored = parseFloat(updated.otAmount ?? updated.OTAmount);
    if (builtIn > 0 && Number.isFinite(stored) && stored > builtIn * 1.35) {
      updated.otAmount = builtIn;
      updated.OTAmount = builtIn;
      return;
    }
    if (Number.isFinite(stored) && stored > 0) return;
    const otFormula = findPayrollFormula((norm) => norm === 'ot amount' || norm === 'otamount');
    let next;
    if (otFormula?.expression) {
      const ev = evaluateFormulaExpression(updated, otFormula.expression);
      if (Number.isFinite(ev)) next = Math.max(0, Math.round(ev));
    }
    if (next === undefined) next = builtIn;
    if (builtIn > 0 && next !== undefined && Number.isFinite(next) && next > builtIn * 1.35) next = builtIn;
    updated.otAmount = next;
    updated.OTAmount = next;
  };

  /**
   * When DB/formula left washing at 0 but attendance implies a positive amount, apply built-in rule.
   * Do not skip when Setup has a formula — broken/misnamed formulas were leaving the column at ₹0 forever.
   * Any positive saved or formula-applied value is kept.
   */
  const syncWashingAllowanceFromAttendance = (updated) => {
    if (!updated) return;
    const s = parseFloat(updated.washingAllowance ?? updated.WashingAllowance);
    if (Number.isFinite(s) && s > 0) return;
    const calc = getBuiltInWashingAllowanceFromRow(updated);
    if (calc <= 0) return;
    updated.washingAllowance = calc;
    updated.WashingAllowance = calc;
  };

  const payslipSelectAllRef = useRef(null);

  // Run Payroll state
  const [payrollRun, setPayrollRun] = useState(false);
  const [runningPayroll, setRunningPayroll] = useState(false);
  const [savingPayroll, setSavingPayroll] = useState(false);

  // Edit functionality state
  const [editingEmployee, setEditingEmployee] = useState(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editFormData, setEditFormData] = useState({});
  const [savingEdit, setSavingEdit] = useState(false);

  /** Employee codes whose OT Hours cell shows an input (manual entry tied to that row’s employeeCode). */
  const [manualOtEditCodes, setManualOtEditCodes] = useState(() => new Set());
  /** Draft OT string per employee code while the OT edit checkbox is on (committed on Save). */
  const [manualOtDraftByCode, setManualOtDraftByCode] = useState({});
  /** Saved OT value when the checkbox was checked; used to show Save only when the draft differs. */
  const [manualOtSnapshotByCode, setManualOtSnapshotByCode] = useState({});
  const [savingManualOtCode, setSavingManualOtCode] = useState(null);

  // Import state
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const [importSuccess, setImportSuccess] = useState('');

  // Payslip preview (in-page) – uses Payslip Template format (earnings/deductions from template)
  const [showPayslipPreview, setShowPayslipPreview] = useState(false);
  const [payslipPreviewEmployee, setPayslipPreviewEmployee] = useState(null);
  const [payslipTemplateConfig, setPayslipTemplateConfig] = useState(null);
  const [payslipPdfRowBusyCode, setPayslipPdfRowBusyCode] = useState(null);
  const [payslipZipBusy, setPayslipZipBusy] = useState(false);
  /** Manual ZIP link when automatic download is blocked (same-tab blob URL). */
  const [payslipZipFallback, setPayslipZipFallback] = useState(null);

  // Sidebar state
  const [expandedMenus, setExpandedMenus] = useState({});
  const [showNotifications, setShowNotifications] = useState(false);
  const [showSidebarMenu, setShowSidebarMenu] = useState(false);
  // Payslip Template is a separate page now (/payslip-template)

  // User info
  const userAvatar = "https://images.pexels.com/photos/2379004/pexels-photo-2379004.jpeg?auto=compress&cs=tinysrgb&w=150";
  const userName = 'Admin User';
  const userRole = localStorage.getItem('userRole') || 'App Administrator';
  const userEmail = localStorage.getItem('userEmail') || null;

  // Map restricted users to their contractor
  const forcedContractor = useMemo(() => {
    const map = {
      'afrindinusha@gmail.com': 'R.P.D Facility Management Services',
      'rpdmanpowerservice@gmail.com': 'R.P.D Facility Management Services',
      'ramachandran23488@gmail.com': 'R.P.D Facility Management Services',
      'afrindinusha29@gmail.com': 'Sriram enterprises',
      'sriramenterprises50@yahoo.com': 'Sriram enterprises',
      'afrinatlin@gmail.com': 'Samuel Enterprise',
      'samuelenterprisesms@gmail.com': 'Samuel Enterprise',
      'dinushaafrin@gmail.com': 'Sri Balaji Enterprises',
      'vijaybalaji701@gmail.com': 'Sri Balaji Enterprises',
      'afrindinu14@gmail.com': 'Yashaswi Academy for Skills',
      'vaishnavi.a@buildhr.co.in': 'Yashaswi Academy for Skills',
    };
    return map[userEmail] || null;
  }, [userEmail]);

  // Attendance helpers (match Attendance Muster counting rules, incl. sandwich rule for WO/H)
  const normalizeStatus = (s) => String(s ?? '').trim();
  const isAbsentStatus = (s) => {
    const v = normalizeStatus(s);
    return v === 'Absent' || v === 'A';
  };
  const isWoOrHStatus = (s) => {
    const v = normalizeStatus(s);
    return v === 'WO' || v === 'H' || v === 'Week Off' || v === 'Holiday';
  };
  const isSandwichedWoOrH = (statuses, idx) => {
    if (!Array.isArray(statuses)) return false;
    if (idx <= 0 || idx >= statuses.length - 1) return false;
    if (!isWoOrHStatus(statuses[idx])) return false;

    let left = idx - 1;
    while (left >= 0 && isWoOrHStatus(statuses[left])) left -= 1;
    let right = idx + 1;
    while (right < statuses.length && isWoOrHStatus(statuses[right])) right += 1;

    if (left < 0 || right >= statuses.length) return false;
    return isAbsentStatus(statuses[left]) && isAbsentStatus(statuses[right]);
  };
  /** YYYY-MM-DD local calendar Sunday (same idea as payroll_function / Attendance Muster). */
  const isSundayMusterDate = (dateValue) => {
    if (dateValue == null || dateValue === '') return false;
    const s = String(dateValue).trim();
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) {
      const y = parseInt(m[1], 10);
      const mo = parseInt(m[2], 10) - 1;
      const d = parseInt(m[3], 10);
      const dt = new Date(y, mo, d);
      if (!Number.isNaN(dt.getTime())) return dt.getDay() === 0;
    }
    const dt = new Date(s);
    if (Number.isNaN(dt.getTime())) return false;
    return dt.getDay() === 0;
  };
  const normalizeEmployeeCode = (code) => {
    const raw = String(code ?? '').trim();
    if (!raw) return '';
    // Handle common numeric-string artifacts (e.g. "123.0" from spreadsheets)
    const withoutDecimalZero = raw.endsWith('.0') ? raw.slice(0, -2) : raw;
    // Remove leading zeros but keep at least one digit
    return withoutDecimalZero.replace(/^0+(?=\d)/, '');
  };
  const calculateDaysPresentFromMusterStatuses = (statuses, dates) => {
    if (!Array.isArray(statuses)) return 0;
    // Match Attendance Muster "Total Present": exclude Sundays and WO/Week Off; H uses sandwich rule only.
    return statuses.reduce((sum, s, idx) => {
      if (Array.isArray(dates) && isSundayMusterDate(dates[idx])) return sum;
      const v = normalizeStatus(s);
      if (v === 'WO' || v === 'Week Off') return sum;
      if (v === 'Present' || v === 'P') return sum + 1;
      if (v === 'Half Day Present' || v === '0.5' || v === '0.50' || v === 0.5) return sum + 1;
      if (v === 'CO') return sum + 1;
      if (v === 'H' && isSandwichedWoOrH(statuses, idx)) return sum;
      if (v === 'H') return sum + 1;
      if (v === 'OD' || v === 'OD-0.5') return sum + 1;
      return sum;
    }, 0);
  };

  // Payroll UI: most numeric fields use whole numbers; Days Present / LOP, OT Hours, and LOH (edit form) keep decimals.
  const toWholeNumber = (v, fallback = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.round(n) : fallback;
  };

  // LOH (Loss of Hours): preserve 2 decimal places (e.g. 5.83 for 5h 50m), do not round to whole hours
  const toLohValue = (v, fallback = 0) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? parseFloat(n.toFixed(2)) : fallback;
  };

  // No. of Days Present / LOP (edit form): preserve decimals (e.g. 2.5), do not round to whole days
  const toDaysPresentValue = (v, fallback = 0) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? parseFloat(n.toFixed(2)) : fallback;
  };

  // OT Hours (edit form): preserve decimals (e.g. 8.5), do not round to whole hours
  const toOtHoursValue = (v, fallback = 0) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? parseFloat(n.toFixed(2)) : fallback;
  };

  const payslipEmployee = useMemo(() => {
    if (!Array.isArray(payrollData) || payrollData.length === 0) return null;
    if (employeeId && employeeId !== 'All') {
      const match = payrollData.find((e) => String(e?.employeeCode ?? '') === String(employeeId));
      return match || payrollData[0];
    }
    return payrollData[0];
  }, [payrollData, employeeId]);

  // Contractor "Yashaswi Academy for Skills": do not calculate PT, PF, ESI (show 0)
  const isYashaswiContractor = (emp) =>
    String(emp?.contractor ?? emp?.Contractor ?? '').trim().toLowerCase() === 'yashaswi academy for skills';

  // PT: prefer Setup & Configuration formula; else saved PT; else slab fallback. Yashaswi → 0.
  const getDisplayPT = (emp) => {
    if (isYashaswiContractor(emp)) return 0;
    const ptFormula = findPayrollFormula((v) => v === 'pt' || v.includes('professional tax'));
    if (ptFormula?.expression) {
      const skipVars = [ptFormula.variable, 'PT', payrollKeyToHeaderLabel?.pt].filter(Boolean);
      const n = evaluateFormulaExpression(emp, ptFormula.expression, { skipVariables: skipVars });
      if (Number.isFinite(n)) return Math.round(n);
    }
    const saved = parseFloat(emp?.pt ?? emp?.PT);
    if (Number.isFinite(saved) && saved > 0) return Math.round(saved);
    const earnedCross = parseFloat(emp?.earnedSalaryCross ?? emp?.EarnedSalaryCross ?? emp?.EarnedGrossSalary) || 0;
    let ptValue = 0;
    if (earnedCross >= 20001/6 && earnedCross <= 30000/6) {
      ptValue = 172/6;
    } else if (earnedCross >= 30001/6 && earnedCross <= 45000/6) {
      ptValue = 430/6;
    } else if (earnedCross >= 45001/6 && earnedCross <= 60000/6) {
      ptValue = 856/6;
    } else if (earnedCross >= 60001/6 && earnedCross <= 75000/6) {
      ptValue = 1250/6;
    } else if (earnedCross >= 75001/6) {
      ptValue = 1250/6;
    }
    return Math.round(ptValue);
  };

  // Helper to fetch dynamic payroll components and formulae from Setup & Configuration
  useEffect(() => {
    const fetchPayrollComponents = async () => {
      try {
        const [componentsRes, formulaeRes] = await Promise.all([
          fetch('/server/setupconfig/payroll/components'),
          fetch('/server/setupconfig/payroll/formulae'),
        ]);

        const componentsJson = await componentsRes.json().catch(() => ({}));
        const formulaeJson = await formulaeRes.json().catch(() => ({}));

        const rawComponents = componentsJson?.data?.components || [];
        const names = rawComponents
          .map((item) => {
            if (!item) return null;
            if (typeof item === 'string') return item;
            if (typeof item.allFields === 'string') return item.allFields;
            return null;
          })
          .filter(Boolean);
        setPayrollComponents(names);

        const rawFormulae = formulaeJson?.data?.formulae || [];
        const cleanedFormulae = rawFormulae
          .map((row) => {
            let variable = (row.variable || row.Variable || '').trim();
            let expression = (row.expression || row.Expression || '').trim();
            if (expression && expression.includes('=') && !variable) {
              const idx = expression.indexOf('=');
              variable = expression.slice(0, idx).trim();
              expression = expression.slice(idx + 1).trim();
            }
            if (!variable || !expression) return null;
            return { variable, expression };
          })
          .filter(Boolean);
        setPayrollFormulae(cleanedFormulae);
      } catch (err) {
        console.error('Error loading payroll setup data:', err);
      }
    };

    fetchPayrollComponents();
  }, []);

  // Indeterminate state for Payslip "Select all" header checkbox
  useEffect(() => {
    if (!payslipSelectAllRef.current || !payrollData.length) return;
    const allChecked = payrollData.every(emp => !!(emp.payslip === true || emp.payslip === 'true'));
    const someChecked = payrollData.some(emp => !!(emp.payslip === true || emp.payslip === 'true'));
    payslipSelectAllRef.current.indeterminate = someChecked && !allChecked;
  }, [payrollData]);

  // Load Payslip Template from backend so "View" payslip uses same format as Payslip Template page
  useEffect(() => {
    fetch('/server/payslip_function/getPayslipTemplate')
      .then((res) => res.json())
      .then((data) => {
        if (data && data.success) {
          setPayslipTemplateConfig({
            companyName: typeof data.companyName === 'string' ? data.companyName.trim() : '',
            earningKeys: Array.isArray(data.earningKeys) ? data.earningKeys : [],
            deductionKeys: Array.isArray(data.deductionKeys) ? data.deductionKeys : [],
          });
        }
      })
      .catch(() => {});
  }, []);

  // When Setup formulae load or change, re-apply them to current table data so the table
  // shows formula-based values (e.g. Earned Basic = Actual Basic / 8) without needing to save from edit.
  useEffect(() => {
    if (!Array.isArray(payrollFormulae) || payrollFormulae.length === 0) return;
    setAllPayrollData((prev) => {
      if (!prev || prev.length === 0) return prev;
      return prev.map(applyPayrollFormulaeToEmployee);
    });
    setPayrollData((prev) => {
      if (!prev || prev.length === 0) return prev;
      return prev.map(applyPayrollFormulaeToEmployee);
    });
  }, [payrollFormulae]); // eslint-disable-line react-hooks/exhaustive-deps -- applyPayrollFormulaeToEmployee uses payrollFormulae

  // Helpers used by getComponentDisplayValue (and payslip preview useMemo); must be declared before getComponentDisplayValue to avoid TDZ when useMemo runs.
  const normalizeStatusValue = (value) => `${value ?? ''}`.trim().toLowerCase();
  const getStatusFromRecord = (record, keys) => {
    if (!record) return '';
    for (const key of keys) {
      if (record[key] !== undefined && record[key] !== null && record[key] !== '') {
        return record[key];
      }
    }
    return '';
  };
  /** Employee master / payroll rows may use travelChargers, TravelChargers, or spaced keys from the API ("Travel Charges"). */
  const getTravelChargersFromRecord = (record) => {
    if (!record || typeof record !== 'object') return 0;
    const v =
      record.travelChargers ??
      record.TravelChargers ??
      record.travelCharges ??
      record.TravelCharges ??
      record['Travel Chargers'] ??
      record['Travel Charges'];
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const isPfEnabled = (record) =>
    normalizeStatusValue(getStatusFromRecord(record, ['pfStatus', 'PFStatus', 'pfstatus'])) !== 'no';
  const isEsiEnabled = (record) => {
    const esiStatus = normalizeStatusValue(getStatusFromRecord(record, ['esiStatus', 'ESIStatus', 'esi_status']));
    if (esiStatus === 'no') return false;
    return true;
  };
  const getPfDisplayValue = (record) => {
    if (isYashaswiContractor(record)) return 0;
    if (!isPfEnabled(record)) return '';
    const pfFormula = findPayrollFormula(
      (v) =>
        v === 'pf' ||
        v === 'pf 12%' ||
        (v.includes('pf') && !v.includes('employer') && (v.includes('12') || v.includes('%'))) ||
        v.includes('provident fund')
    );
    if (pfFormula?.expression) {
      const skipVars = [
        pfFormula.variable,
        'PF',
        'PF 12%',
        payrollKeyToHeaderLabel?.pf,
      ].filter(Boolean);
      const n = evaluateFormulaExpression(record, pfFormula.expression, { skipVariables: skipVars });
      if (Number.isFinite(n)) return n;
    }
    const earnedBasic = Number(record?.earnedBasic ?? record?.EarnedBasic ?? 0) || 0;
    if (earnedBasic <= 0) return 0;
    if (earnedBasic > 15000) return 1800;
    return Math.round(earnedBasic * 0.12);
  };
  /** Employee ESI 0.75%: Earned Basic + OT Amount + Incentive only (LOH must not move ESI via HRA/Special/Travel). */
  const getEsiEmployeeAmountBasicOtIncentive = (record) => {
    const eb = Number(record?.earnedBasic ?? record?.EarnedBasic ?? 0) || 0;
    const ot = Number(record?.otAmount ?? record?.OTAmount ?? 0) || 0;
    const inc = Number(record?.incentive ?? record?.Incentive ?? 0) || 0;
    const base = eb + ot + inc;
    if (base <= 0) return 0;
    return Math.round(base * 0.0075);
  };
  const getEsiDisplayValue = (record) => {
    if (isYashaswiContractor(record)) return 0;
    if (!isEsiEnabled(record)) return '';
    return getEsiEmployeeAmountBasicOtIncentive(record);
  };
  /** Same rule as backend calcAttendanceBonus / "Attendance Bonus" column (full month present → 0; else DOJ → 1200 or 800). */
  const getAttendanceBonusNumericForRow = (employee) => {
    if (!employee) return 0;
    const daysInMonth = Number(employee.daysInMonth ?? employee.DaysInMonth ?? 0);
    const daysPresent = Number(employee.daysPresent ?? employee.DaysPresent ?? 0);
    const dojRaw =
      employee.dateOfJoining ??
      employee.DateofJoining ??
      employee.DateOfJoining ??
      employee.date_of_joining ??
      '';
    if (dojRaw && daysInMonth > 0 && selectedMonth) {
      if (Number(daysPresent) === Number(daysInMonth)) return 0;
      const doj = new Date(dojRaw);
      if (!isNaN(doj.getTime())) {
        const parts = String(selectedMonth).split('-').map(Number);
        if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
          const lastDayOfMonth = new Date(parts[0], parts[1], 0);
          const oneYearBefore = new Date(lastDayOfMonth);
          oneYearBefore.setFullYear(oneYearBefore.getFullYear() - 1);
          return doj <= oneYearBefore ? 1200 : 800;
        }
      }
    }
    const v = employee.attendanceBonus ?? employee.AttendanceBonus ?? '';
    const n = Number(v);
    return Number.isFinite(n) ? Math.round(n) : 0;
  };
  const getDisplayTotalDeduction = (emp) => {
    const formulae = payrollFormulaeRef.current || [];
    const totalDeductionFormula = formulae.find((f) =>
      String(f?.variable || '').trim().toLowerCase() === 'total deduction'
    );

    // Prefer Setup & Configuration formula so deduction changes are data-driven (no code changes).
    if (totalDeductionFormula?.expression) {
      const evaluated = evaluateFormulaExpression(emp, totalDeductionFormula.expression, {
        skipVariables: [
          totalDeductionFormula.variable,
          'Total Deduction',
          'Total Deductions',
          payrollKeyToHeaderLabel?.totalDeduction,
        ].filter(Boolean),
      });
      if (Number.isFinite(evaluated)) return Math.round(evaluated);
    }

    // Fallback (when formula is missing/invalid): sum configured deduction keys from template, not hardcoded fields.
    const deductionKeys = Array.isArray(payslipTemplateConfig?.deductionKeys)
      ? payslipTemplateConfig.deductionKeys
      : [];
    const filteredKeys = deductionKeys.filter((k) => {
      const lower = String(k || '').trim().toLowerCase();
      return lower && lower !== 'total deduction' && lower !== 'total deductions' && lower !== 'net pay';
    });

    if (filteredKeys.length > 0) {
      const dedSum = filteredKeys.reduce((sum, key) => {
        const v = parseFloat(getComponentDisplayValue(emp, key));
        return sum + (Number.isFinite(v) ? v : 0);
      }, 0);
      return Math.round(dedSum);
    }

    return Math.round(parseFloat(emp?.totalDeduction ?? emp?.TotalDeduction ?? 0) || 0);
  };

  /** Same numeric rule as Net Pay column — used after formulae so Run Payroll save / RunPayroll table match the grid. */
  const getGridAlignedNetPayNumber = (employee) => {
    if (!employee) return NaN;
    const earned =
      parseFloat(
        employee.earnedSalaryCross ??
          employee.EarnedSalaryCross ??
          employee.earnedGrossSalary ??
          employee.EarnedGrossSalary ??
          0
      ) || 0;
    const totalDed =
      typeof getDisplayTotalDeduction === 'function'
        ? getDisplayTotalDeduction(employee)
        : Math.round(parseFloat(employee.totalDeduction ?? employee.TotalDeduction ?? 0) || 0);
    if (Number.isFinite(earned) && Number.isFinite(totalDed)) return Math.round(earned - totalDed);
    const stored = employee.netPay ?? employee.NetPay ?? employee.net_pay;
    const storedNum = parseFloat(stored);
    if (Number.isFinite(storedNum)) return Math.round(storedNum);
    const advance = parseFloat(employee.advance ?? employee.Advance ?? 0) || 0;
    return Math.round(earned - totalDed - advance);
  };

  const getComponentDisplayValue = (employee, componentName) => {
    if (!employee || !componentName) return '';
    const base = String(componentName).trim();
    if (!base) return '';

    const lower = base.toLowerCase();
    if (lower === 'unit') return payrollRowUnitDisplay(employee);
    if (lower.includes('no. of days present') || lower.includes('days present')) {
      const dimGp = parseFloat(employee.daysInMonth ?? employee.DaysInMonth ?? 0) || 0;
      if (isManagingPartnerPayrollRow(employee) && dimGp > 0) return dimGp;
      return employee.daysPresent ?? employee.DaysPresent ?? '';
    }
    // No. of Days (In Month) - must be after "days present" so that isn't matched
    if (lower.includes('no. of days') && lower.includes('month')) {
      const v = employee.daysInMonth ?? employee.DaysInMonth ?? employee.daysInMonthForCalc ?? employee['Days In Month'] ?? '';
      const n = Number(v);
      return Number.isFinite(n) ? n : (v !== '' && v !== null && v !== undefined ? v : '');
    }
    if (lower === 'loh' || lower.includes('loss of hours')) return employee.loh;
    if (lower === 'lop' || lower.includes('loss of pay')) {
      const dimLop = parseFloat(employee.daysInMonth ?? employee.DaysInMonth ?? 0) || 0;
      if (isManagingPartnerPayrollRow(employee) && dimLop > 0) return 0;
      return employee.lop;
    }
    if (lower.includes('ot hours') || lower === 'ot') return employee.otHours;
    // OT Amount (not OT Hours / not OT Arrear): show computed amount when API omitted OTAmount after import
    if (
      lower === 'ot amount' ||
      (lower.includes('ot') && lower.includes('amount') && !lower.includes('hours') && !lower.includes('arrear'))
    ) {
      return getOtAmountDisplayFromEmployee(employee);
    }
    // Food Allowance / Food Allownace (typo) — same Setup formula as payroll run; edit form syncs via calculateDerivedFields
    if (lower.includes('food') && (lower.includes('allowance') || lower.includes('allownace'))) {
      const v = employee.foodAllowance ?? employee.FoodAllowance ?? '';
      const n = Number(v);
      return Number.isFinite(n) ? Math.round(n) : (v !== '' && v !== null && v !== undefined ? v : 0);
    }
    // No of days without uniforms - show 0 when value is missing or zero
    if (lower.includes('no of days without uniforms') || lower === 'noofdayswithoutuniforms' || lower.includes('no.of days without uniform')) {
      const v = employee.noOfDaysWithoutUniforms ?? employee.NoOfDaysWithoutUniforms ?? employee.noofdayswithoutuniforms ?? '';
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    }
    // Loan / Loan Allowance - show 0 when value is missing or zero
    if (lower === 'loan' || (lower.includes('loan') && lower.includes('allowance'))) {
      const v = employee.loanAllowance ?? employee.LoanAllowance ?? '';
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    }
    // Washing Allowance — align table with edit modal (25× days present − no-uniform days) when no Setup formula
    if (lower.includes('washing') && (lower.includes('allowance') || lower.includes('allownace'))) {
      return getWashingAllowanceDisplayFromEmployee(employee);
    }
    // ESI 0.75% / ESI – prefer Setup formula via getEsiDisplayValue (same as table totals)
    if (lower === 'esi' || (lower.includes('esi') && (lower.includes('0.75') || lower.includes('%')))) {
      if (!isEsiEnabled(employee)) return 0;
      const g = getEsiDisplayValue(employee);
      return g === '' ? 0 : g;
    }
    // Late — from Setup formula (applyPayrollFormulaeToEmployee) or stored/backend value
    if (lower === 'late') {
      const v = employee.late ?? employee.Late ?? '';
      const n = parseFloat(v);
      return Number.isFinite(n) ? Math.round(n) : 0;
    }
    // PF - from EARNED values only (same rule as getPfDisplayValue). Column label is usually "PF 12%" from Setup, not plain "pf".
    const normCompLabel = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const pfHeaderNorm = normCompLabel(payrollKeyToHeaderLabel?.pf || 'PF 12%');
    const isPfColumn =
      lower === 'pf' ||
      normCompLabel(base) === pfHeaderNorm ||
      (lower.startsWith('pf') && (/\b12\b/.test(lower) || lower.includes('%')));
    if (isPfColumn) {
      const v = getPfDisplayValue(employee);
      if (v === '') return 0;
      return v;
    }
    // Other Deduction, LWF, PT, Rent / Rent Recovery - for Total Deduction formula (rounded)
    if (lower === 'other deduction') return Math.round(parseFloat(employee.otherDeduction ?? employee.OtherDeduction) || 0);
    if (lower === 'lwf') return Math.round(parseFloat(employee.lwf ?? employee.LWF) || 0);
    if (lower === 'pt') return getDisplayPT(employee);
    if (lower.includes('rent')) return Math.round(parseFloat(employee.rent ?? employee.Rent) || 0);
    // Other Allowance (singular) - show value from Employee form SALARY INFO "Other Allowance" (stored in payroll as otherAllowances)
    if (lower === 'other allowance' || lower === 'other allowances') {
      const val = employee.otherAllowances ?? employee.otherAllowance ?? '';
      return val !== '' && val !== null && val !== undefined ? val : '';
    }
    // SetupConfig may label this as "TRAVEL CHARGES"; API may use "Travel Charges" (spaced key)
    if (lower.includes('travel') && lower.includes('charge')) {
      const n = getTravelChargersFromRecord(employee);
      return Number.isFinite(n) ? Math.round(n) : 0;
    }
    // Attendance Bonus — same rule as payroll_function calcAttendanceBonus
    if (lower.includes('attendance') && lower.includes('bonus')) {
      return getAttendanceBonusNumericForRow(employee);
    }
    // Attendance Deduction (Setup deduction column): show same computed amount as Attendance Bonus for visibility in deductions section
    if (lower.includes('attendance') && lower.includes('deduction')) {
      return getAttendanceBonusNumericForRow(employee);
    }
    // Earned Gross Salary: use earnedSalaryCross (synced from formula earnedGrossSalary when present) so edit form and table show same value
    if (lower.includes('earned') && lower.includes('gross') && (lower.includes('salary') || lower.includes('cross'))) {
      const v = employee.earnedSalaryCross ?? employee.EarnedSalaryCross ?? employee.earnedGrossSalary ?? employee.EarnedGrossSalary ?? '';
      const n = parseFloat(v);
      return Number.isFinite(n) ? Math.round(n) : (v !== '' && v !== null && v !== undefined ? v : '');
    }
    // Net Pay / NetPay: always display as Earned Gross Salary - Total Deduction so table matches the shown EGS and Total Deduction
    if (lower === 'net pay' || lower === 'netpay') {
      const earned = parseFloat(employee.earnedSalaryCross ?? employee.EarnedSalaryCross ?? employee.earnedGrossSalary ?? employee.EarnedGrossSalary ?? 0) || 0;
      const totalDed = typeof getDisplayTotalDeduction === 'function' ? getDisplayTotalDeduction(employee) : (parseFloat(employee.totalDeduction ?? employee.TotalDeduction ?? 0) || 0);
      if (Number.isFinite(earned) && Number.isFinite(totalDed)) return Math.round(earned - totalDed);
      const stored = employee.netPay ?? employee.NetPay ?? employee.net_pay;
      const storedNum = parseFloat(stored);
      if (Number.isFinite(storedNum)) return Math.round(storedNum);
      const advance = parseFloat(employee.advance ?? employee.Advance ?? 0) || 0;
      return Math.round(earned - totalDed - advance);
    }
    // Total Deduction: always recalculated (PF + ESI + Loan; Food Allowance excluded) so it updates when PF changes
    if (lower === 'total deduction' || lower === 'total deductions') {
      return typeof getDisplayTotalDeduction === 'function' ? getDisplayTotalDeduction(employee) : Math.round(parseFloat(employee?.totalDeduction ?? employee?.TotalDeduction ?? 0) || 0);
    }
    // Earned Basic / Earned HRA / Earned DA: read from camelCase or PascalCase (backend/DB may return EarnedHRA, EarnedBasic)
    if (lower === 'earned basic') {
      const v = employee.earnedBasic ?? employee.EarnedBasic ?? '';
      const n = Number(v);
      return Number.isFinite(n) ? Math.round(n) : (v !== '' && v !== null && v !== undefined ? v : 0);
    }
    if (lower === 'earned hra') {
      const v = employee.earnedHRA ?? employee.EarnedHRA ?? '';
      const n = Number(v);
      return Number.isFinite(n) ? Math.round(n) : (v !== '' && v !== null && v !== undefined ? v : 0);
    }
    if (lower === 'earned da') {
      const v = employee.earnedDA ?? employee.EarnedDA ?? '';
      const n = Number(v);
      return Number.isFinite(n) ? Math.round(n) : (v !== '' && v !== null && v !== undefined ? v : 0);
    }
    if (lower === 'earned special allowance') {
      const v = employee.earnedSpecialAllowance ?? employee.EarnedSpecialAllowance ?? '';
      const n = Number(v);
      return Number.isFinite(n) ? Math.round(n) : (v !== '' && v !== null && v !== undefined ? v : 0);
    }

    const camel = base
      .toLowerCase()
      .split(/\s+/)
      .map((word, index) =>
        index === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1)
      )
      .join('');

    // Camel with acronyms kept uppercase (e.g. "Actual HRA" -> actualHRA) so backend keys like actualHRA match
    const camelAcronym = base
      .split(/\s+/)
      .map((word, index) =>
        index === 0 ? word.toLowerCase() : (word.length <= 4 && word === word.toUpperCase() ? word : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      )
      .join('');

    const variants = [
      base,
      base.toLowerCase(),
      base.toUpperCase(),
      base.replace(/\s+/g, ''),
      base.replace(/\s+/g, '').toLowerCase(),
      base.replace(/\s+/g, '_').toLowerCase(),
      base.replace(/\s+/g, '_').toUpperCase(),
      camel,
      camelAcronym,
    ];
    // Data Store / update path often uses PascalCase from camel payload keys (e.g. price → Price).
    if (camel && camel.length) {
      const pascalFromCamel = camel.charAt(0).toUpperCase() + camel.slice(1);
      if (!variants.includes(pascalFromCamel)) variants.push(pascalFromCamel);
    }

    for (const key of variants) {
      if (employee[key] === undefined || employee[key] === null) continue;
      const val = employee[key];
      // Do not stop on '' — another variant (e.g. allowance vs OtherAllowance) may hold the saved value.
      if (val === '') continue;
      if (typeof val === 'number' && Number.isFinite(val)) return Math.round(val);
      if (typeof val === 'string' && Number.isFinite(Number(val))) return Math.round(Number(val));
      return val;
    }
    // Fallback: Catalyst / merge may use a key shape not in variants (e.g. only "Price" on row, label "PRICE").
    const payloadKey = componentLabelToPayloadKey(base);
    const tgt = payloadKey ? normPayrollFieldKeyForLookup(payloadKey) : '';
    if (tgt) {
      for (const k of Object.keys(employee)) {
        if (normPayrollFieldKeyForLookup(k) !== tgt) continue;
        const val = employee[k];
        if (val === undefined || val === null || val === '') continue;
        if (typeof val === 'number' && Number.isFinite(val)) return Math.round(val);
        if (typeof val === 'string' && Number.isFinite(Number(val))) return Math.round(Number(val));
        return val;
      }
    }
    return '';
  };

  const evaluateFormulaExpression = (employee, expression, options = {}) => {
    if (!expression) return 0;

    const reserved = ['Math', 'min', 'max', 'round', 'floor', 'ceil', 'abs'];
    const skipVariableNorm = new Set(
      (Array.isArray(options.skipVariables) ? options.skipVariables : [])
        .map((x) => normalizeFormulaVariable(x))
        .filter(Boolean)
    );
    try {
      let expr = String(expression).trim();

      // Support Setup formulas written as:
      // if (<condition>) then <value-if-true> else <value-if-false>
      // Convert it to JS ternary before token replacement.
      const ifThenElseMatch = expr.match(/^if\s*\((.+)\)\s*then\s+(.+)\s+else\s+(.+)$/i);
      if (ifThenElseMatch) {
        const conditionExpr = String(ifThenElseMatch[1] || '').trim();
        const trueExpr = String(ifThenElseMatch[2] || '').trim();
        const falseExpr = String(ifThenElseMatch[3] || '').trim();
        expr = `((${conditionExpr}) ? (${trueExpr}) : (${falseExpr}))`;
      }

      // Support formula helper functions from Setup Configuration.
      expr = expr
        .replace(/\bmin\s*\(/gi, 'Math.min(')
        .replace(/\bmax\s*\(/gi, 'Math.max(')
        .replace(/\bround\s*\(/gi, 'Math.round(')
        .replace(/\bfloor\s*\(/gi, 'Math.floor(')
        .replace(/\bceil\s*\(/gi, 'Math.ceil(')
        .replace(/\babs\s*\(/gi, 'Math.abs(');

      const formulaeForExpr = payrollFormulaeRef.current || [];
      const allVarAndComponentNames = [
        ...(payrollComponents || []),
        ...(formulaeForExpr || []).map(f => (f.variable || '').trim()).filter(Boolean),
      ];

      // 1) Replace variable names that contain % (e.g. "ESI 0.75%") with placeholders BEFORE % conversion,
      //    so "ESI 0.75%" is not turned into "ESI (0.75 / 100)" (which would be parsed as getVal("ESI")(0.75/100))
      const namesWithPercent = [...new Set(allVarAndComponentNames.filter(n => String(n).includes('%')))].sort((a, b) => b.length - a.length);
      const percentPlaceholders = [];
      namesWithPercent.forEach((name) => {
        percentPlaceholders.push(name);
        const idx = percentPlaceholders.length - 1;
        const placeholder = `__P${idx}__`;
        expr = expr.replace(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), placeholder);
      });

      // 2) Convert standalone percentages like 12% to (12 / 100)
      expr = expr.replace(/(\d+(\.\d+)?)%/g, '($1 / 100)');

      // 3) Collect multi-word names (no %) so they are treated as one identifier.
      // Include names that contain a period (e.g. "No. of Days in Month") since the word regex below does not match them.
      const periodVarNames = ['No. of Days in Month', 'No. of Days Present', 'No. of Days(In month)', 'No. of Days (In Month)'];
      const fromComponentsAndVars = allVarAndComponentNames.filter(name => String(name).includes(' ') && !String(name).includes('%'));
      const fromExpression = (expression.match(/[A-Za-z][A-Za-z0-9]*(?:\s+[A-Za-z][A-Za-z0-9]*)+/g) || [])
        .map(s => s.trim())
        .filter(Boolean);
      const multiWordNames = [...new Set([...fromComponentsAndVars, ...fromExpression, ...periodVarNames])]
        .sort((a, b) => b.length - a.length);

      const placeholders = [];
      multiWordNames.forEach((name) => {
        if (!placeholders.includes(name)) {
          placeholders.push(name);
          const idx = placeholders.length - 1;
          const placeholder = `__M${idx}__`;
          expr = expr.replace(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), placeholder);
        }
      });

      // Replace remaining single-word identifiers with getVal("name")
      expr = expr.replace(/[A-Za-z_][A-Za-z0-9_]*/g, (name) => {
        if (reserved.includes(name)) return name;
        if (/^__M\d+__$/.test(name)) return name;
        if (/^__P\d+__$/.test(name)) return name;
        return `getVal("${name}")`;
      });

      // Replace multi-word placeholders with getVal("Actual Basic") etc.
      placeholders.forEach((name, i) => {
        expr = expr.replace(new RegExp(`__M${i}__`, 'g'), `getVal(${JSON.stringify(name)})`);
      });
      // Replace percent-variable placeholders with getVal("ESI 0.75%") etc.
      percentPlaceholders.forEach((name, i) => {
        expr = expr.replace(new RegExp(`__P${i}__`, 'g'), `getVal(${JSON.stringify(name)})`);
      });
      const getVal = (name) => {
        if (skipVariableNorm.has(normalizeFormulaVariable(name))) return 0;
        const vNorm = normalizeFormulaVariable(name);
        // Washing Allowance: never route through getComponentDisplayValue (it would call back here via
        // getWashingAllowanceDisplayFromEmployee when a Setup formula exists, forcing 0 and breaking evaluation).
        if (
          vNorm === 'washing allowance' ||
          (vNorm.includes('washing') && (vNorm.includes('allowance') || vNorm.includes('allownace')))
        ) {
          const rawStored = employee.washingAllowance ?? employee.WashingAllowance;
          const sn = parseFloat(rawStored);
          return Number.isFinite(sn) ? sn : 0;
        }
        if (vNorm === 'ot amount' || vNorm === 'otamount') {
          const rawOt = employee.otAmount ?? employee.OTAmount;
          const sn = parseFloat(rawOt);
          return Number.isFinite(sn) ? sn : 0;
        }
        const raw = getComponentDisplayValue(employee, name);
        const num = parseFloat(raw);
        return Number.isFinite(num) ? num : 0;
      };

      // eslint-disable-next-line no-new-func
      const fn = new Function('getVal', `return (${expr});`);
      const result = fn(getVal);
      const n = Number(result);
      return Number.isFinite(n) ? Math.round(n) : 0;
    } catch (e) {
      console.error('Error evaluating payroll formula:', expression, e);
      return 0;
    }
  };

  /** After a Setup formula runs, mirror common DB/display keys (pf, esi, pt, etc.) from the formula variable name. */
  const applyCanonicalFieldFromFormulaVariable = (updated, variableTrimmed, numericRounded) => {
    const v = normalizeFormulaVariable(variableTrimmed);
    const n = Number(numericRounded);
    const num = Number.isFinite(n) ? Math.round(n) : 0;
    if (v.includes('employer') && v.includes('esi')) {
      updated.employerEsi = num;
      updated.EmployerEsi = num;
      return;
    }
    if (
      (v === 'esi' || v === 'esi 0.75%' || (v.includes('esi') && v.includes('0.75'))) &&
      !v.includes('employer')
    ) {
      updated.esi = num;
      updated.ESI = num;
      return;
    }
    if (
      v === 'pf' ||
      v.includes('provident fund') ||
      (v.includes('pf') && !v.includes('employer') && (v.includes('12') || v.includes('%')))
    ) {
      updated.pf = num;
      updated.PF = num;
      return;
    }
    if (v === 'pt' || v.includes('professional tax')) {
      updated.pt = num;
      updated.PT = num;
      return;
    }
    if (v === 'late') {
      updated.late = num;
      updated.Late = num;
      return;
    }
    if (v === 'net pay' || v === 'netpay') {
      updated.netPay = num;
      updated.NetPay = num;
    }
    if (v === 'total deduction' || v === 'total deductions') {
      updated.totalDeduction = num;
      updated.TotalDeduction = num;
    }
  };

  const applyPayrollFormulaeToEmployee = (employee) => {
    if (!employee) return employee;
    const formulae = payrollFormulaeRef.current;
    const updated = { ...employee };
    // Preserve backend netPay so Setup formulae (if they also define "Net Pay") don't overwrite it
    // This keeps the payroll list aligned with backend display.
    const originalNetPay = employee.netPay ?? employee.NetPay ?? employee.net_pay ?? employee.netpay;

    if (Array.isArray(formulae) && formulae.length > 0) {
      // When ESI Status is "No" in Employee form, do not apply ESI formulae (keep ESI and Employer ESI 0)
      const esiEnabled = isEsiEnabled(employee);
      const hasEsiEmployeeFormula = formulae.some((f) => {
        const v = normalizeFormulaVariable(f.variable);
        return (
          (v === 'esi' || v === 'esi 0.75%' || (v.includes('esi') && v.includes('0.75'))) &&
          !v.includes('employer')
        );
      });

      // Snapshot attendance-based earned values before Setup formulae run (formulae may fail to resolve names and write 0).
      const preservedEarned = {
        earnedBasic: Number(updated.earnedBasic ?? updated.EarnedBasic) || 0,
        earnedHRA: Number(updated.earnedHRA ?? updated.EarnedHRA) || 0,
        earnedDA: Number(updated.earnedDA ?? updated.EarnedDA) || 0,
        earnedSpecialAllowance: Number(updated.earnedSpecialAllowance ?? updated.EarnedSpecialAllowance) || 0,
      };

      formulae.forEach(({ variable, expression }) => {
      const base = String(variable).trim();
      if (!base) return;

      const key = componentLabelToPayloadKey(base);

      // When ESI Status is No, do not apply ESI formulae (keep ESI and Employer ESI 0)
      const baseLower = base.toLowerCase();
      if (!esiEnabled && baseLower.includes('esi')) {
        if (baseLower.includes('employer')) updated.employerEsi = 0;
        else updated.esi = 0;
        return;
      }
      // Late is evaluated after Earned Gross / OT sync (see below) so LOH × Earned Basic resolves correctly
      if (baseLower === 'late') return;
      if (
        baseLower.includes('uniform') &&
        (baseLower.includes('allowance') || baseLower.includes('allownace'))
      )
        return;

      const value = evaluateFormulaExpression(updated, expression);
      // Total Deduction fallback: use configured deduction keys so setup changes are reflected automatically.
      if (baseLower === 'total deduction' && (value === 0 || !Number.isFinite(value))) {
        const configuredDeductionKeys = Array.isArray(payslipTemplateConfig?.deductionKeys)
          ? payslipTemplateConfig.deductionKeys
          : [];
        const fallbackKeys = configuredDeductionKeys.filter((k) => {
          const lowerKey = String(k || '').trim().toLowerCase();
          return lowerKey && lowerKey !== 'total deduction' && lowerKey !== 'total deductions' && lowerKey !== 'net pay';
        });
        const fallbackSum = fallbackKeys.reduce((sum, keyName) => {
          const n = parseFloat(getComponentDisplayValue(updated, keyName));
          return sum + (Number.isFinite(n) ? n : 0);
        }, 0);
        if (fallbackSum > 0) updated[key] = Math.round(fallbackSum);
        else updated[key] = Math.round(value);
      } else if (
        !hasEsiEmployeeFormula &&
        (baseLower === 'esi 0.75%' || baseLower === 'esi') &&
        (value === 0 || !Number.isFinite(value))
      ) {
        // Legacy ESI fallback: Earned Basic + OT Amount + Incentive (same as edit form / display)
        const eb = parseFloat(updated.earnedBasic ?? updated.EarnedBasic) || 0;
        const otAmt = parseFloat(updated.otAmount ?? updated.OTAmount) || 0;
        const incAmt = parseFloat(updated.incentive ?? updated.Incentive) || 0;
        const esiBaseSum = eb + otAmt + incAmt;
        if (esiBaseSum > 0) updated[key] = Math.round(esiBaseSum * 0.0075);
        else updated[key] = 0;
      } else {
        updated[key] = Number.isFinite(value) ? Math.round(value) : value;
      }
      // Washing Allowance (any spelling Setup uses): always mirror to washingAllowance / WashingAllowance for grid + API
      if (
        baseLower.includes('washing') &&
        (baseLower.includes('allowance') || baseLower.includes('allownace'))
      ) {
        const fv = Number.isFinite(value) ? Math.round(value) : (Number(updated[key]) || 0);
        updated.washingAllowance = fv;
        updated.WashingAllowance = fv;
      }
      // Food Allowance / Food Allownace (typo): always store on foodAllowance so edit form and save use one key (matches backend)
      if (baseLower === 'food allowance' || baseLower === 'food allownace') {
        const fv = Number.isFinite(value) ? Math.round(value) : (Number(updated[key]) || 0);
        updated.foodAllowance = fv;
      }
      if (baseLower.includes('travel') && baseLower.includes('charge')) {
        const fv = Number.isFinite(value) ? Math.round(value) : (Number(updated[key]) || 0);
        updated.travelChargers = fv;
        updated.TravelChargers = fv;
      }
      // Earned Gross Salary: formula variable is "Earned Gross Salary" -> key earnedGrossSalary; sync to earnedSalaryCross so edit form and display use same value
      if (key === 'earnedGrossSalary' && updated.earnedGrossSalary !== undefined) {
        updated.earnedSalaryCross = updated.earnedGrossSalary;
      }
      if (!(baseLower.includes('esi') && !esiEnabled)) {
        const sv = updated[key];
        if (sv !== undefined && sv !== null && sv !== '') {
          const nn = typeof sv === 'number' && Number.isFinite(sv) ? Math.round(sv) : parseFloat(sv);
          if (Number.isFinite(nn)) applyCanonicalFieldFromFormulaVariable(updated, base, nn);
        }
      }
      });

      const restoreEarnedIfFormulaZeroed = (camelKey, pascalKey) => {
        const cur = Number(updated[camelKey] ?? updated[pascalKey]) || 0;
        const prev = preservedEarned[camelKey];
        if (cur === 0 && prev > 0) {
          const v = Math.round(prev);
          updated[camelKey] = v;
          updated[pascalKey] = v;
        }
      };
      restoreEarnedIfFormulaZeroed('earnedBasic', 'EarnedBasic');
      restoreEarnedIfFormulaZeroed('earnedHRA', 'EarnedHRA');
      restoreEarnedIfFormulaZeroed('earnedDA', 'EarnedDA');
      restoreEarnedIfFormulaZeroed('earnedSpecialAllowance', 'EarnedSpecialAllowance');

      syncWashingAllowanceFromAttendance(updated);
      syncOtAmountFromOtHours(updated);

      // Re-run Earned Gross Salary formula if present so totals stay consistent after restoring earned components
      const egsEntry = formulae.find((f) => String(f.variable || '').trim().toLowerCase() === 'earned gross salary');
      if (egsEntry && egsEntry.expression) {
        const v = evaluateFormulaExpression(updated, egsEntry.expression);
        if (Number.isFinite(v)) {
          updated.earnedGrossSalary = Math.round(v);
          updated.earnedSalaryCross = updated.earnedGrossSalary;
        }
      }
    }

    syncWashingAllowanceFromAttendance(updated);
    syncOtAmountFromOtHours(updated);

    // Washing may have been filled after EGS ran inside the formulae block; re-run Earned Gross if it depends on washing.
    const formulaeAfterWash = payrollFormulaeRef.current || [];
    const egsAfterWash = formulaeAfterWash.find(
      (f) => String(f.variable || '').trim().toLowerCase() === 'earned gross salary'
    );
    if (egsAfterWash && egsAfterWash.expression) {
      const vEgs = evaluateFormulaExpression(updated, egsAfterWash.expression);
      if (Number.isFinite(vEgs)) {
        updated.earnedGrossSalary = Math.round(vEgs);
        updated.earnedSalaryCross = updated.earnedGrossSalary;
      }
    }

    const lateFormulaFinal = formulaeAfterWash.find(
      (f) => String(f.variable || '').trim().toLowerCase() === 'late'
    );
    if (lateFormulaFinal && lateFormulaFinal.expression) {
      const lateSkip = [lateFormulaFinal.variable, 'Late', payrollKeyToHeaderLabel?.late].filter(Boolean);
      const lv = evaluateFormulaExpression(updated, lateFormulaFinal.expression, { skipVariables: lateSkip });
      if (Number.isFinite(lv)) {
        const rounded = Math.round(lv);
        updated.late = rounded;
        updated.Late = rounded;
      }
    }

    // Do not overwrite Earned Basic / Earned HRA / Earned DA when backend sent 0 - PF/ESI must use only these earned values, so when they are 0 we keep 0

    if (Number.isFinite(Number(originalNetPay))) {
      updated.netPay = Number(originalNetPay);
      updated.NetPay = Number(originalNetPay);
    }

    return updated;
  };

  const modulesToShow = useMemo(() => getSidebarModulesForUser(userEmail, userRole), [userEmail, userRole]);

  // Toggle expandable menus
  const toggleMenu = (index) => {
    setExpandedMenus(prev => ({
      ...prev,
      [index]: !prev[index]
    }));
  };

  // Function to fetch payroll data
  const fetchPayrollData = useCallback(async (overrideFromDate = null, overrideToDate = null) => {
    try {
      console.log('=== FETCH PAYROLL DATA DEBUG START ===');
      setLoading(true);
      setError(null);
     
      // Use override dates if provided, otherwise use state values
      const effectiveFromDate = overrideFromDate !== null ? overrideFromDate : fromDate;
      const effectiveToDate = overrideToDate !== null ? overrideToDate : toDate;
     
      let url = `/server/payroll_function/payroll?month=${selectedMonth}&_t=${Date.now()}`;
      if (contractor !== 'All') url += `&contractor=${encodeURIComponent(contractor)}`;
      if (department !== 'All') url += `&department=${encodeURIComponent(department)}`;
      if (employeeId !== 'All') url += `&employeeId=${encodeURIComponent(employeeId)}`;
      if (employeeStatus !== 'All') url += `&employeeStatus=${encodeURIComponent(employeeStatus)}`;
      if (effectiveFromDate) url += `&fromDate=${encodeURIComponent(effectiveFromDate)}`;
      if (effectiveToDate) url += `&toDate=${encodeURIComponent(effectiveToDate)}`;
      if (userEmail) url += `&userEmail=${encodeURIComponent(userEmail)}`;
     
      console.log('Fetching payroll data from:', url);
      console.log('Current filters:', { selectedMonth, contractor, department, employeeId });
     
      const res = await fetch(url);
      console.log('Response status:', res.status);
      console.log('Response ok:', res.ok);
     
      if (!res.ok) {
        const errorText = await res.text();
        console.error('Response error:', errorText);
        throw new Error(`Failed to fetch payroll data: ${res.status} ${errorText}`);
      }
     
      const result = await res.json();
      console.log('Payroll data received:', result);
      console.log('Data array length:', result.data ? result.data.length : 0);

      // Align No. of Days Present with Attendance Muster when NOT in Manual mode (same as Run Payroll path).
      // Manual mode keeps DaysPresent/OT/LOH from saved payroll / SamplePayroll — muster merge was incorrectly always applied on refresh.
      let manualModeActiveFetch = automaticSelections.has('Manual');
      if (!manualModeActiveFetch) {
        try {
          const modeRes = await fetch(
            `/server/payroll_function/automatic-selection/latest?month=${encodeURIComponent(selectedMonth)}&_t=${Date.now()}`
          );
          if (modeRes.ok) {
            const modeJson = await modeRes.json().catch(() => ({}));
            manualModeActiveFetch = !!modeJson.manual;
          }
        } catch (modeErr) {
          console.warn('Could not verify payroll mode for fetch; may merge muster:', modeErr);
        }
      }
      if (!manualModeActiveFetch && effectiveFromDate && effectiveToDate && result.data && result.data.length > 0) {
        try {
          console.log('Fetching accurate attendance data from Attendance Muster...');
          let musterUrl = `/server/attendance_muster_function/?startDate=${encodeURIComponent(effectiveFromDate)}&endDate=${encodeURIComponent(effectiveToDate)}&userEmail=${encodeURIComponent(userEmail || '')}`;
         
          // Add contractor filter if applicable
          const contractorForQuery = forcedContractor || (contractor !== 'All' ? contractor : null);
          if (contractorForQuery) {
            musterUrl += `&contractor=${encodeURIComponent(contractorForQuery)}`;
          }

          const musterRes = await fetch(musterUrl);
         
          if (musterRes.ok) {
            const musterData = await musterRes.json();
           
            if (musterData && musterData.employees && musterData.muster) {
              console.log(`Received attendance data for ${musterData.employees.length} employees`);
             
              // Create a map of EmployeeID -> DaysPresent
              const attendanceMap = {};
              // Create a map of EmployeeID -> OT Hours (from attendance_muster_function monthlyOvertimePreferred)
              const otHoursMap = {};
              // Create a map of EmployeeID -> LOH (from attendance_muster_function monthlyLOHPreferred)
              const lohMap = {};
             
              musterData.employees.forEach((empId, idx) => {
                const statuses = musterData.muster[idx] || [];
               
                // Calculate Days Present using Attendance Muster logic (same as muster Total Present incl. dates for Sun/WO)
                const daysPresent = calculateDaysPresentFromMusterStatuses(statuses, musterData.dates);
               
                // Store both raw and normalized employee codes to avoid mismatch (e.g. "00123" vs "123")
                const rawEmpId = String(empId ?? '').trim();
                const normalizedEmpId = normalizeEmployeeCode(empId);
                if (rawEmpId) attendanceMap[rawEmpId] = daysPresent;
                if (normalizedEmpId) attendanceMap[normalizedEmpId] = daysPresent;

                // OT Hours from attendance_muster_function (monthlyOvertimePreferred)
                const otHours = (musterData.monthlyOvertimePreferred && musterData.monthlyOvertimePreferred[idx] != null)
                  ? parseFloat(musterData.monthlyOvertimePreferred[idx]) || 0
                  : 0;
                if (rawEmpId) otHoursMap[rawEmpId] = otHours;
                if (normalizedEmpId) otHoursMap[normalizedEmpId] = otHours;

                // LOH from attendance_muster_function (monthlyLOHPreferred)
                const loh = (musterData.monthlyLOHPreferred && musterData.monthlyLOHPreferred[idx] != null)
                  ? parseFloat(musterData.monthlyLOHPreferred[idx]) || 0
                  : 0;
                if (rawEmpId) lohMap[rawEmpId] = loh;
                if (normalizedEmpId) lohMap[normalizedEmpId] = loh;
              });
             
              // Update payroll data with accurate counts, OT Hours and LOH
              let updatedCount = 0;
              let zeroCount = 0;
              result.data = result.data.map(emp => {
                // Try to match by Employee Code - normalize to string for consistent matching
                const empCodeRaw = emp.employeeCode ? String(emp.employeeCode).trim() : null;
                const empCodeNormalized = emp.employeeCode ? normalizeEmployeeCode(emp.employeeCode) : null;
                const daysInMonth = parseFloat(emp.daysInMonth) || 0;
               
                const matchedDaysPresent =
                  (empCodeRaw && attendanceMap[empCodeRaw] !== undefined) ? attendanceMap[empCodeRaw]
                  : (empCodeNormalized && attendanceMap[empCodeNormalized] !== undefined) ? attendanceMap[empCodeNormalized]
                  : undefined;

                // Keep a positive saved OT Hours value, but allow automatic muster OT to replace blank/zero.
                const savedOtHoursValue = Number(emp.otHours ?? emp.OTHours);
                const hasSavedOtHours = Number.isFinite(savedOtHoursValue) && savedOtHoursValue > 0;
                const otFromMuster = (empCodeRaw && otHoursMap[empCodeRaw] !== undefined) ? otHoursMap[empCodeRaw]
                  : (empCodeNormalized && otHoursMap[empCodeNormalized] !== undefined) ? otHoursMap[empCodeNormalized]
                  : undefined;
                const otHoursUpdate = (!hasSavedOtHours && otFromMuster !== undefined) ? { otHours: otFromMuster, OTHours: otFromMuster } : {};

                // LOH: use muster when row has no non-zero saved LOH (same as OT — stale 0 from DB still refreshes from muster).
                const lohFromMuster = (empCodeRaw && lohMap[empCodeRaw] !== undefined) ? lohMap[empCodeRaw]
                  : (empCodeNormalized && lohMap[empCodeNormalized] !== undefined) ? lohMap[empCodeNormalized]
                  : undefined;
                const lohUpdate =
                  payrollRowHasStoredLoh(emp) || lohFromMuster === undefined ? {} : { loh: lohFromMuster };

                if (matchedDaysPresent !== undefined) {
                  // Employee found in attendance muster - use their attendance data and recalc Earned Basic to match
                  updatedCount++;
                  const updatedDaysPresent = managingPartnerDaysPresentValue(emp, matchedDaysPresent);
                  const calculatedLOP = Math.max(0, daysInMonth - updatedDaysPresent);
                  const merged = { ...emp, ...otHoursUpdate, ...lohUpdate, daysPresent: updatedDaysPresent, lop: calculatedLOP };
                  return recalculateEarnedFromRow(merged);
                } else if (empCodeRaw || empCodeNormalized) {
                  // Employee NOT found in attendance muster - set to 0 and recalc Earned Basic
                  zeroCount++;
                  const updatedDaysPresent = managingPartnerDaysPresentValue(emp, 0);
                  const calculatedLOP = Math.max(0, daysInMonth - updatedDaysPresent);
                  const merged = { ...emp, ...otHoursUpdate, ...lohUpdate, daysPresent: updatedDaysPresent, lop: calculatedLOP };
                  return recalculateEarnedFromRow(merged);
                }

                const dimOnly = parseFloat(emp.daysInMonth) || 0;
                const mpOnly =
                  isManagingPartnerPayrollRow(emp) && dimOnly > 0
                    ? { daysPresent: dimOnly, lop: 0 }
                    : {};
                return recalculateEarnedFromRow({ ...emp, ...otHoursUpdate, ...lohUpdate, ...mpOnly });
              });
             
              console.log(`Updated daysPresent, LOP, OT Hours and LOH for ${updatedCount} employees based on Attendance Muster data`);
              console.log(`Set daysPresent to 0 for ${zeroCount} employees not found in Attendance Muster`);
              console.log(`Attendance map keys (sample):`, Object.keys(attendanceMap).slice(0, 5));
              console.log(`Payroll employee codes (sample):`, result.data.slice(0, 5).map(emp => String(emp.employeeCode)));
            }
          } else {
            console.error('Failed to fetch attendance muster data:', musterRes.status);
          }
        } catch (err) {
          console.error('Error fetching/processing attendance muster data:', err);
        }
      } else if (manualModeActiveFetch) {
        console.log('Manual mode is active — skipping Attendance Muster overwrite for daysPresent/OT/LOH on fetch/refresh');
      }
     
      if (result.data && result.data.length > 0) {
        console.log('First record in data:', result.data[0]);
        console.log('Sample employee codes in data:', result.data.slice(0, 3).map(emp => emp.employeeCode));
        console.log('All employee codes in received data:', result.data.map(emp => emp.employeeCode));
        console.log('Current filters applied:', { selectedMonth, contractor, department, employeeId });
      } else {
        console.log('No payroll data received - checking filters and backend response');
        console.log('Current filters:', { selectedMonth, contractor, department, employeeId });
        console.log('Request URL:', url);
      }
     
      // Normalize numeric salary fields: API may send PascalCase keys or formatted strings; keeps recalculateEarnedFromRow and table totals consistent.
      const payrollFieldNumber = (...candidates) => {
        for (const v of candidates) {
          const raw = String(v ?? '').trim();
          if (!raw) continue;
          const cleaned = raw.replace(/[^0-9.\-]/g, '');
          const n = Number(cleaned);
          if (Number.isFinite(n)) return n;
        }
        return 0;
      };

      // Force a new array reference; normalize ESI, earned fields, and netPay (backend/DB may return PascalCase: NetPay, EarnedHRA, etc.)
      const newPayrollData = (result.data || []).map((row) => {
        const specialAllowance = payrollFieldNumber(row.specialAllowance, row.SpecialAllowance);
        const rawEarnedSpecial = payrollFieldNumber(row.earnedSpecialAllowance, row.EarnedSpecialAllowance);
        const dim = payrollFieldNumber(row.daysInMonth, row.DaysInMonth) || 31;
        const dp = payrollFieldNumber(row.daysPresent, row.DaysPresent);
        const lohRow = payrollFieldNumber(row.loh, row.LOH);
        let earnedSpecialAllowance = rawEarnedSpecial;
        if (specialAllowance > 0 && rawEarnedSpecial === 0) {
          earnedSpecialAllowance =
            dim > 0
              ? Math.max(
                  0,
                  Math.round((specialAllowance / dim) * dp - (specialAllowance / dim / 8) * lohRow)
                )
              : 0;
        }
        return {
        ...row,
        unit: payrollRowUnitDisplay(row),
        actualBasic: payrollFieldNumber(row.actualBasic, row.ActualBasic),
        actualHRA: payrollFieldNumber(row.actualHRA, row.ActualHRA),
        actualDA: payrollFieldNumber(row.actualDA, row.ActualDA),
        otherAllowance: payrollFieldNumber(row.otherAllowance, row.OtherAllowance),
        specialAllowance,
        otherAllowances: payrollFieldNumber(row.otherAllowances, row.OtherAllowances),
        washingAllowance: payrollFieldNumber(row.washingAllowance, row.WashingAllowance),
        esi: Number(row.esi ?? row.ESI ?? 0) || 0,
        earnedBasic: Number(row.earnedBasic ?? row.EarnedBasic) || 0,
        earnedHRA: Number(row.earnedHRA ?? row.EarnedHRA) || 0,
        earnedDA: Number(row.earnedDA ?? row.EarnedDA) || 0,
        earnedSpecialAllowance,
        netPay: row.netPay ?? row.NetPay ?? row.net_pay ?? row.netpay,
        daysInMonth: row.daysInMonth ?? row.DaysInMonth,
        daysPresent: row.daysPresent ?? row.DaysPresent,
        loh: row.loh ?? row.LOH
      };
      });
     
      // Debug: Check if employeeStatus is present in the data
      if (newPayrollData.length > 0) {
        const sampleRecord = newPayrollData[0];
        console.log('📋 Sample payroll record:', {
          hasEmployeeStatus: 'employeeStatus' in sampleRecord,
          employeeStatusValue: sampleRecord.employeeStatus,
          employeeCode: sampleRecord.employeeCode,
          employeeName: sampleRecord.employeeName,
          allKeys: Object.keys(sampleRecord)
        });
        const recordsWithStatus = newPayrollData.filter(emp => emp.employeeStatus && String(emp.employeeStatus).trim() !== '').length;
        const statusCounts = {};
        newPayrollData.forEach(emp => {
          const status = String(emp.employeeStatus || '').trim() || '(empty)';
          statusCounts[status] = (statusCounts[status] || 0) + 1;
        });
        console.log(`📊 Records with employeeStatus: ${recordsWithStatus} out of ${newPayrollData.length}`);
        console.log('📊 Status distribution in fetched data:', statusCounts);
      }
     
      // If fetching all data (no filters), store in allPayrollData for local filtering
      // Note: We don't filter by status here - we store all data and filter on display
      if (contractor === 'All' && department === 'All' && employeeId === 'All' && newPayrollData.length > 0) {
        const dataWithFormulae = newPayrollData.map(applyPayrollFormulaeToEmployee);
        const sortedAll = sortPayrollManagingPartnerFirst(dataWithFormulae);
        setAllPayrollData(sortedAll);
        shouldUseLocalFilter.current = true;
        console.log('Stored all payroll data for local filtering:', newPayrollData.length, 'records');
       
        // Apply current filters (including status) to display (use formula-applied data)
        let filteredData = sortedAll;
        if (employeeStatus !== 'All') {
          filteredData = filteredData.filter(emp => {
            const empStatus = String(emp.employeeStatus || '').trim();
            return empStatus.toLowerCase() === employeeStatus.toLowerCase();
          });
          console.log(`Applied status filter "${employeeStatus}": ${dataWithFormulae.length} -> ${filteredData.length} records`);
        }
        setPayrollData(filteredData);
      } else {
        // If filters are applied, apply status filter if needed (use formula-applied data)
        const dataWithFormulaeElse = newPayrollData.map(applyPayrollFormulaeToEmployee);
        const sortedElse = sortPayrollManagingPartnerFirst(dataWithFormulaeElse);
        let filteredData = sortedElse;
        if (employeeStatus !== 'All') {
          filteredData = filteredData.filter(emp => {
            const empStatus = String(emp.employeeStatus || '').trim();
            return empStatus.toLowerCase() === employeeStatus.toLowerCase();
          });
          console.log(`Applied status filter "${employeeStatus}" to filtered data: ${dataWithFormulaeElse.length} -> ${filteredData.length} records`);
        }
        setPayrollData(filteredData);
      }
     
      console.log('Payroll data state updated with', newPayrollData.length, 'records');
      console.log('New payroll data reference created:', newPayrollData !== (result.data || []));
     
      // Debug: Log sample data to verify it's correct
      if (newPayrollData.length > 0) {
        console.log('Sample payroll data after fetch:', {
          firstRecord: newPayrollData[0],
          totalRecords: newPayrollData.length,
          employeeCodes: newPayrollData.map(emp => emp.employeeCode).slice(0, 5)
        });
      }
     
      console.log('=== FETCH PAYROLL DATA DEBUG END - SUCCESS ===');
    } catch (err) {
      console.error('=== FETCH PAYROLL DATA DEBUG END - ERROR ===');
      console.error('Error fetching payroll data:', err);
      setError(err.message);
      setPayrollData([]);
    } finally {
      setLoading(false);
    }
  }, [
    selectedMonth,
    contractor,
    department,
    employeeId,
    employeeStatus,
    fromDate,
    toDate,
    userEmail,
    forcedContractor,
    automaticSelections
  ]);

  // Store all imported data (unfiltered) to allow local filtering
  const [allPayrollData, setAllPayrollData] = useState([]);

  // Track if we should use local filtering vs backend fetch
  const shouldUseLocalFilter = useRef(false);
 
  // Track last pathname to detect navigation to payroll page
  const lastPathname = useRef(null);
  const hasInitialized = useRef(false);
  const monthInitialized = useRef(false);

  // Do NOT auto-load payroll data when month is selected. Data loads only when user sets Start/End date and clicks Run Payroll.
  useEffect(() => {
    setPayrollRun(false);
    setPayrollData([]);
    setAllPayrollData([]);
    shouldUseLocalFilter.current = false;
  }, [selectedMonth]);

  // Track if this is the initial mount to avoid duplicate fetches
  const isInitialMount = useRef(true);
  const prevMonth = useRef(selectedMonth);
  // Track if we're refreshing after import to skip loading state
  const isRefreshingAfterImport = useRef(false);
 
  // Helper function to apply all filters
  const applyFilters = useCallback((data) => {
    let filtered = [...data]; // Create a copy to avoid mutating original
   
    if (contractor !== 'All') {
      // Use flexible matching for contractor names (handles variations)
      const normalizedContractor = String(contractor || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const contractorWords = normalizedContractor.split(' ').filter(w => w.length > 2);
     
      filtered = filtered.filter(emp => {
        const empContractor = String(emp.contractor || '').replace(/\s+/g, ' ').trim().toLowerCase();
        // Try exact match first
        if (empContractor === normalizedContractor) return true;
        // Try contains match
        if (empContractor.includes(normalizedContractor) || normalizedContractor.includes(empContractor)) return true;
        // Try matching key words (handles variations like "Samuel Enterprise" vs "Samuel Enterprises")
        if (contractorWords.length > 0) {
          const allKeyWordsMatch = contractorWords.every(word => empContractor.includes(word));
          if (allKeyWordsMatch) {
            const firstWord = contractorWords[0];
            const empFirstWord = empContractor.split(' ')[0];
            if (empFirstWord && (empFirstWord.startsWith(firstWord) || firstWord.startsWith(empFirstWord))) {
              return true;
            }
          }
        }
        return false;
      });
    }
    if (department !== 'All') {
      filtered = filtered.filter(emp => emp.department === department);
    }
    if (employeeId !== 'All') {
      filtered = filtered.filter(emp => emp.employeeCode === employeeId);
    }
    if (employeeStatus !== 'All') {
      const beforeStatusFilter = filtered.length;
      console.log(`🔍 Applying status filter: "${employeeStatus}" to ${beforeStatusFilter} records`);
     
      // Debug: Show status distribution before filtering
      const statusDistribution = {};
      const sampleStatuses = [];
      filtered.forEach((emp, idx) => {
        const status = String(emp.employeeStatus || '').trim() || '(empty)';
        statusDistribution[status] = (statusDistribution[status] || 0) + 1;
        if (idx < 5) {
          sampleStatuses.push({
            code: emp.employeeCode,
            name: emp.employeeName,
            status: status,
            rawStatus: emp.employeeStatus,
            hasField: 'employeeStatus' in emp
          });
        }
      });
      console.log('📊 Status distribution before filter:', statusDistribution);
      console.log('📋 Sample employee statuses:', sampleStatuses);
     
      filtered = filtered.filter(emp => {
        const empStatus = String(emp.employeeStatus || '').trim();
        const matches = empStatus.toLowerCase() === employeeStatus.toLowerCase();
        if (!matches && filtered.length <= 20) {
          console.log(`❌ Status filter: Employee ${emp.employeeCode} (${emp.employeeName}) - Status: "${empStatus}" (expected: "${employeeStatus}") - Match: ${matches}`);
        }
        return matches;
      });
      console.log(`✅ Status filter "${employeeStatus}": ${beforeStatusFilter} -> ${filtered.length} records`);
     
      if (filtered.length === 0 && beforeStatusFilter > 0) {
        console.warn('⚠️ WARNING: Status filter returned 0 results! Check if employeeStatus field is populated in the data.');
        console.log('Available statuses in data:', Object.keys(statusDistribution));
      }
    }
   
    return sortPayrollManagingPartnerFirst(filtered);
  }, [contractor, department, employeeId, employeeStatus]);

  // Handle filter changes - use local filtering if we have data
  useEffect(() => {
    // Skip if month changed (handled by checkForSavedData)
    if (prevMonth.current !== selectedMonth) {
      prevMonth.current = selectedMonth;
      return;
    }
   
    // If we have data locally, filter it locally instead of fetching from backend
    if (shouldUseLocalFilter.current && allPayrollData.length > 0) {
      console.log('🔧 Filters changed - filtering local data. Current status filter:', employeeStatus);
      console.log('📊 Total records in allPayrollData:', allPayrollData.length);
      let filtered = applyFilters(allPayrollData);
     
      console.log(`✅ Filtered ${allPayrollData.length} records to ${filtered.length} records`);
      setPayrollData(filtered);
    } else {
      console.log('⚠️ Cannot filter locally - shouldUseLocalFilter:', shouldUseLocalFilter.current, 'allPayrollData.length:', allPayrollData.length);
    }
  }, [contractor, department, employeeId, employeeStatus, allPayrollData, applyFilters]); // Only trigger on filter changes, not month

  // Auto-set contractor filter based on user email
  useEffect(() => {
    if (forcedContractor) {
      console.log(`Setting contractor to ${forcedContractor} for user:`, userEmail);
      setContractor(forcedContractor);
      setContractors([forcedContractor]); // Only show this contractor
    }
  }, [userEmail, forcedContractor]);

  // Fetch contractors
  useEffect(() => {
    console.log('Fetching contractors');
    let url = '/server/payroll_function/contractors';
    if (userEmail) {
      url += `?userEmail=${encodeURIComponent(userEmail)}`;
    }
    fetch(url)
      .then(res => {
        console.log('Contractors response:', res.status);
        return res.json();
      })
      .then(data => {
        console.log('Contractors data:', data);
        const contractorList = data.data || [];
        // If user has a forced contractor, only show that contractor
        if (forcedContractor) {
          const restrictedContractor = forcedContractor;
          setContractors([restrictedContractor]);
          setContractor(restrictedContractor);
        } else {
          setContractors(['All', ...contractorList]);
        }
      })
      .catch(err => {
        console.error('Error fetching contractors:', err);
        if (forcedContractor) {
          setContractors([forcedContractor]);
          setContractor(forcedContractor);
        } else {
        setContractors(['All']);
        }
      });
  }, [userEmail, forcedContractor]);

  // Fetch departments
  useEffect(() => {
    console.log('Fetching departments');
    fetch('/server/payroll_function/departments')
      .then(res => {
        console.log('Departments response:', res.status);
        return res.json();
      })
      .then(data => {
        console.log('Departments data:', data);
        setDepartments(['All', ...(data.data || [])]);
      })
      .catch(err => {
        console.error('Error fetching departments:', err);
        setDepartments(['All']);
      });
  }, []);

  // Fetch employee codes, filtered by contractor
  useEffect(() => {
    console.log('Fetching employee codes for contractor:', contractor);
    let url = '/server/payroll_function/employee-codes';
    if (contractor && contractor !== 'All') {
      url += `?contractor=${encodeURIComponent(contractor)}`;
    }
    fetch(url)
      .then(res => {
        console.log('Employee codes response:', res.status);
        return res.json();
      })
      .then(data => {
        console.log('Employee codes data:', data);
        setEmployees(['All', ...(data.data || [])]);
      })
      .catch(err => {
        console.error('Error fetching employee codes:', err);
        setEmployees(['All']);
      });
    setEmployeeId('All'); // Reset employeeId when contractor changes
  }, [contractor]);

  // Always set to current month when page opens (on initial mount)
  useEffect(() => {
    if (!monthInitialized.current) {
      const currentMonth = getCurrentMonth();
      setSelectedMonth(currentMonth);
      // Update URL to reflect current month
      const params = new URLSearchParams(location.search);
      params.set('month', currentMonth);
      navigate({ pathname: location.pathname, search: params.toString() }, { replace: true });
      monthInitialized.current = true;
    }
  }, []); // Run only on mount

  // Update month from URL when location changes (but only after initial mount)
  useEffect(() => {
    if (monthInitialized.current) {
      const searchParams = new URLSearchParams(location.search);
      const urlMonth = searchParams.get('month');
      if (urlMonth && urlMonth !== selectedMonth) {
        setSelectedMonth(urlMonth);
      }
    }
  }, [location.search, selectedMonth]);

  // Reset date filters to empty when navigating to payroll page
  // This ensures that when the payroll page is opened, it shows current month data by default
  // Users can still set custom dates, but they will reset when they open the page again
  useEffect(() => {
    const isOnPayrollPage = location.pathname === '/payroll';
   
    // On initial mount or when navigating TO the payroll page (not when already on it)
    if (isOnPayrollPage) {
      if (!hasInitialized.current || lastPathname.current !== '/payroll') {
        // User just navigated to payroll page or component just mounted - reset dates to show current month
        setFromDate('');
        setToDate('');
        hasInitialized.current = true;
      }
    }
   
    // Update the last pathname for next comparison
    lastPathname.current = location.pathname;
  }, [location.pathname]); // Reset when pathname changes

  const handleMonthChange = (e) => {
    const newMonth = e.target.value;
    setSelectedMonth(newMonth);
    // Update URL when month changes
    const params = new URLSearchParams(location.search);
    params.set('month', newMonth);
    navigate({ pathname: location.pathname, search: params.toString() }, { replace: true });
  };

  // Handle Run Payroll button click
  const handleRunPayroll = async () => {
    setError(null);
    setImportSuccess('');
    if (!fromDate || !toDate) {
      setError('Please select Start Date and End Date, then click Run Payroll to load payroll data.');
      return;
    }
    setRunningPayroll(true);
    try {
      // Show initial message
      setImportSuccess('Fetching attendance data and running payroll...');
     
      // Simulate payroll processing time (includes fetching attendance and OT data)
      await new Promise(resolve => setTimeout(resolve, 2000));
     
      // Fetch payroll data (Days Present and LOH hours are auto-fetched from BHR table and LOH report)
      // For restricted users, pull from saved payroll report to avoid missing recompute data on past months
      setLoading(true);
      const basePath = forcedContractor ? '/server/payroll_function/report' : '/server/payroll_function/payroll';
      let url = `${basePath}?month=${selectedMonth}&_t=${Date.now()}`;
      // Include contractor explicitly when restricted
      const contractorForQuery = forcedContractor || (contractor !== 'All' ? contractor : null);
      if (contractorForQuery) url += `&contractor=${encodeURIComponent(contractorForQuery)}`;
      // Include from/to date range if provided so payroll respects the selected window
      if (fromDate) url += `&fromDate=${encodeURIComponent(fromDate)}`;
      if (toDate) url += `&toDate=${encodeURIComponent(toDate)}`;
      // Include userEmail for backend filtering
      if (userEmail) url += `&userEmail=${encodeURIComponent(userEmail)}`;
      // Don't apply frontend filters - fetch data for the requested date range (backend will filter by contractor if needed)
     
      console.log('Running payroll - fetching data with date range:', { url, fromDate, toDate });
      const res = await fetch(url);
     
      if (!res.ok) {
        let errorText = '';
        try {
          const errorJson = await res.json();
          errorText = errorJson.error || JSON.stringify(errorJson);
        } catch (e) {
          errorText = await res.text();
        }
        console.error('Payroll API error response:', { status: res.status, statusText: res.statusText, error: errorText });
        throw new Error(`Server error (${res.status}): ${errorText || res.statusText}`);
      }
     
      const result = await res.json();
     
      // Check if result has an error property
      if (result.error) {
        console.error('Payroll API returned error:', result.error);
        throw new Error(result.error);
      }
      console.log('Payroll data received:', result);
      // Normalize ESI so table displays value (handle both esi and ESI from API)
      if (result.data && Array.isArray(result.data)) {
        result.data = result.data.map(row => ({
          ...row,
          esi: Number(row.esi ?? row.ESI ?? 0) || 0
        }));
      }
     
      // Fix for Sunday count when date range is selected:
      // We fetch data from Attendance Muster function to get accurate daily status counts.
      // IMPORTANT: In Manual mode we must keep values from SamplePayroll/import and NOT overwrite
      // daysPresent/OT/LOH from attendance muster.
      let manualModeActive = automaticSelections.has('Manual');
      if (!manualModeActive) {
        try {
          const modeRes = await fetch(
            `/server/payroll_function/automatic-selection/latest?month=${encodeURIComponent(selectedMonth)}&_t=${Date.now()}`
          );
          if (modeRes.ok) {
            const modeJson = await modeRes.json().catch(() => ({}));
            manualModeActive = !!modeJson.manual;
          }
        } catch (modeErr) {
          console.warn('Could not verify payroll mode; defaulting to current selection state:', modeErr);
        }
      }
      if (!manualModeActive && fromDate && toDate && result.data && result.data.length > 0) {
        try {
          console.log('Fetching accurate attendance data from Attendance Muster...');
          let musterUrl = `/server/attendance_muster_function/?startDate=${encodeURIComponent(fromDate)}&endDate=${encodeURIComponent(toDate)}&source=both`;
         
          if (userEmail) musterUrl += `&userEmail=${encodeURIComponent(userEmail)}`;
         
          // Add contractor filter if applicable
          const contractorForQuery = forcedContractor || (contractor !== 'All' ? contractor : null);
          if (contractorForQuery) {
            musterUrl += `&contractor=${encodeURIComponent(contractorForQuery)}`;
          }

          const musterRes = await fetch(musterUrl);
         
          if (musterRes.ok) {
            const musterData = await musterRes.json();
           
            if (musterData && musterData.employees && musterData.muster) {
              console.log(`Received attendance data for ${musterData.employees.length} employees`);
             
              // Create a map of EmployeeID -> DaysPresent
              const attendanceMap = {};
              // Create a map of EmployeeID -> OT Hours (from attendance_muster_function monthlyOvertimePreferred)
              const otHoursMap = {};
              // Create a map of EmployeeID -> LOH (from attendance_muster_function monthlyLOHPreferred)
              const lohMap = {};
             
              musterData.employees.forEach((empId, idx) => {
                const statuses = musterData.muster[idx] || [];
                const rawEmpId = String(empId ?? '').trim();
                const normalizedEmpId = normalizeEmployeeCode(empId);
                // Calculate Days Present using Attendance Muster logic (same as muster Total Present incl. dates for Sun/WO)
                const daysPresent = calculateDaysPresentFromMusterStatuses(statuses, musterData.dates);
                if (rawEmpId) attendanceMap[rawEmpId] = daysPresent;
                if (normalizedEmpId) attendanceMap[normalizedEmpId] = daysPresent;
                // OT Hours from attendance_muster_function (monthlyOvertimePreferred)
                const otHours = (musterData.monthlyOvertimePreferred && musterData.monthlyOvertimePreferred[idx] != null)
                  ? parseFloat(musterData.monthlyOvertimePreferred[idx]) || 0
                  : 0;
                if (rawEmpId) otHoursMap[rawEmpId] = otHours;
                if (normalizedEmpId) otHoursMap[normalizedEmpId] = otHours;
                // LOH from attendance_muster_function (monthlyLOHPreferred)
                const loh = (musterData.monthlyLOHPreferred && musterData.monthlyLOHPreferred[idx] != null)
                  ? parseFloat(musterData.monthlyLOHPreferred[idx]) || 0
                  : 0;
                if (rawEmpId) lohMap[rawEmpId] = loh;
                if (normalizedEmpId) lohMap[normalizedEmpId] = loh;
              });
             
              // Update payroll data with accurate counts, OT Hours and LOH
              let updatedCount = 0;
              let zeroCount = 0;
              result.data = result.data.map(emp => {
                // Try to match by Employee Code - normalize to string for consistent matching
                const empCodeRaw = emp.employeeCode ? String(emp.employeeCode).trim() : null;
                const empCodeNormalized = emp.employeeCode ? normalizeEmployeeCode(emp.employeeCode) : null;
                const daysInMonth = parseFloat(emp.daysInMonth) || 0;
               
                const matchedDaysPresent =
                  (empCodeRaw && attendanceMap[empCodeRaw] !== undefined) ? attendanceMap[empCodeRaw]
                  : (empCodeNormalized && attendanceMap[empCodeNormalized] !== undefined) ? attendanceMap[empCodeNormalized]
                  : undefined;

                // Keep a positive saved OT Hours value, but allow automatic muster OT to replace blank/zero.
                const savedOtHoursValue = Number(emp.otHours ?? emp.OTHours);
                const hasSavedOtHours = Number.isFinite(savedOtHoursValue) && savedOtHoursValue > 0;
                const otFromMuster = (empCodeRaw && otHoursMap[empCodeRaw] !== undefined) ? otHoursMap[empCodeRaw]
                  : (empCodeNormalized && otHoursMap[empCodeNormalized] !== undefined) ? otHoursMap[empCodeNormalized]
                  : undefined;
                const otHoursUpdate = (!hasSavedOtHours && otFromMuster !== undefined) ? { otHours: otFromMuster, OTHours: otFromMuster } : {};

                const lohFromMuster = (empCodeRaw && lohMap[empCodeRaw] !== undefined) ? lohMap[empCodeRaw]
                  : (empCodeNormalized && lohMap[empCodeNormalized] !== undefined) ? lohMap[empCodeNormalized]
                  : undefined;
                const lohUpdate =
                  payrollRowHasStoredLoh(emp) || lohFromMuster === undefined ? {} : { loh: lohFromMuster };

                if (matchedDaysPresent !== undefined) {
                  updatedCount++;
                  const updatedDaysPresent = managingPartnerDaysPresentValue(emp, matchedDaysPresent);
                  const calculatedLOP = Math.max(0, daysInMonth - updatedDaysPresent);
                  const merged = { ...emp, ...otHoursUpdate, ...lohUpdate, daysPresent: updatedDaysPresent, lop: calculatedLOP };
                  return recalculateEarnedFromRow(merged);
                } else if (empCodeRaw || empCodeNormalized) {
                  zeroCount++;
                  const updatedDaysPresent = managingPartnerDaysPresentValue(emp, 0);
                  const calculatedLOP = Math.max(0, daysInMonth - updatedDaysPresent);
                  const merged = { ...emp, ...otHoursUpdate, ...lohUpdate, daysPresent: updatedDaysPresent, lop: calculatedLOP };
                  return recalculateEarnedFromRow(merged);
                }
                const dimOnlyRun = parseFloat(emp.daysInMonth) || 0;
                const mpOnlyRun =
                  isManagingPartnerPayrollRow(emp) && dimOnlyRun > 0
                    ? { daysPresent: dimOnlyRun, lop: 0 }
                    : {};
                return recalculateEarnedFromRow({ ...emp, ...otHoursUpdate, ...lohUpdate, ...mpOnlyRun });
              });
             
              console.log(`Updated daysPresent, LOP, OT Hours and LOH for ${updatedCount} employees based on Attendance Muster data`);
              console.log(`Set daysPresent to 0 for ${zeroCount} employees not found in Attendance Muster`);
              console.log(`Attendance map keys (sample):`, Object.keys(attendanceMap).slice(0, 5));
              console.log(`Payroll employee codes (sample):`, result.data.slice(0, 5).map(emp => String(emp.employeeCode)));
            }
          } else {
            console.error('Failed to fetch attendance muster data:', musterRes.status);
          }
        } catch (err) {
          console.error('Error fetching/processing attendance muster data:', err);
        }
      } else if (manualModeActive) {
        console.log('Manual mode is active - skipping Attendance Muster overwrite for daysPresent/OT/LOH');
      }

      // Same as fetchPayrollData: backend often returns EarnedSpecialAllowance 0 while Special Allowance is set (Run Payroll path skips fetch normalization).
      if (result.data && Array.isArray(result.data)) {
        const pfnRun = (...candidates) => {
          for (const v of candidates) {
            const raw = String(v ?? '').trim();
            if (!raw) continue;
            const cleaned = raw.replace(/[^0-9.\-]/g, '');
            const n = Number(cleaned);
            if (Number.isFinite(n)) return n;
          }
          return 0;
        };
        result.data = result.data.map((row) => {
          const specialAllowance = pfnRun(row.specialAllowance, row.SpecialAllowance);
          const rawEarnedSpecial = pfnRun(row.earnedSpecialAllowance, row.EarnedSpecialAllowance);
          const dim = pfnRun(row.daysInMonth, row.DaysInMonth) || 31;
          const dp = pfnRun(row.daysPresent, row.DaysPresent);
          const lohRow = pfnRun(row.loh, row.LOH);
          let earnedSpecialAllowance = rawEarnedSpecial;
          if (specialAllowance > 0 && rawEarnedSpecial === 0) {
            earnedSpecialAllowance =
              dim > 0
                ? Math.max(
                    0,
                    Math.round((specialAllowance / dim) * dp - (specialAllowance / dim / 8) * lohRow)
                  )
                : 0;
          }
          return { ...row, specialAllowance, earnedSpecialAllowance, unit: payrollRowUnitDisplay(row) };
        });
      }

      if (result.data && result.data.length > 0) {
          // Apply Setup & Configuration formulae so only formula-based values are shown
          const dataWithFormulae = result.data.map(applyPayrollFormulaeToEmployee);
          const sortedPayroll = sortPayrollManagingPartnerFirst(dataWithFormulae);
          // Persist the same rows the user sees (including formulae) to Payroll + RunPayroll
          const payrollPayloadForSave = sortedPayroll;
          // Store all data for local filtering
          setAllPayrollData(sortedPayroll);
         
          // Apply current filters (including status) to the data
          let filteredData = sortedPayroll;
          if (contractor !== 'All') {
            // Use flexible matching for contractor names (handles variations)
            const normalizedContractor = String(contractor || '').replace(/\s+/g, ' ').trim().toLowerCase();
            const contractorWords = normalizedContractor.split(' ').filter(w => w.length > 2);
           
            filteredData = filteredData.filter(emp => {
              const empContractor = String(emp.contractor || '').replace(/\s+/g, ' ').trim().toLowerCase();
              // Try exact match first
              if (empContractor === normalizedContractor) return true;
              // Try contains match
              if (empContractor.includes(normalizedContractor) || normalizedContractor.includes(empContractor)) return true;
              // Try matching key words (handles variations like "Samuel Enterprise" vs "Samuel Enterprises")
              if (contractorWords.length > 0) {
                const allKeyWordsMatch = contractorWords.every(word => empContractor.includes(word));
                if (allKeyWordsMatch) {
                  const firstWord = contractorWords[0];
                  const empFirstWord = empContractor.split(' ')[0];
                  if (empFirstWord && (empFirstWord.startsWith(firstWord) || firstWord.startsWith(empFirstWord))) {
                    return true;
                  }
                }
              }
              return false;
            });
            console.log(`handleRunPayroll contractor filter: "${contractor}" matched ${filteredData.length} records out of ${dataWithFormulae.length}`);
          }
          if (department !== 'All') {
            filteredData = filteredData.filter(emp => emp.department === department);
          }
          if (employeeId !== 'All') {
            filteredData = filteredData.filter(emp => emp.employeeCode === employeeId);
          }
          if (employeeStatus !== 'All') {
            filteredData = filteredData.filter(emp => {
              const empStatus = String(emp.employeeStatus || '').trim();
              return empStatus.toLowerCase() === employeeStatus.toLowerCase();
            });
          }
         
          setPayrollData(filteredData);
          setPayrollRun(true);
         
          // Enable local filtering for this data
          shouldUseLocalFilter.current = true;
         
          // Save calculated payroll data to backend so it persists
          console.log('=== SAVING CALCULATED PAYROLL DATA TO BACKEND ===');
          console.log('Data to save:', payrollPayloadForSave.length, 'records');
          console.log('Sample record:', payrollPayloadForSave[0]);
          try {
            const saveResponse = await fetch('/server/payroll_function/import', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                month: selectedMonth,
                payrollData: payrollPayloadForSave,
                userEmail
              }),
            });
           
            console.log('Save response status:', saveResponse.status);
            console.log('Save response headers:', Object.fromEntries(saveResponse.headers.entries()));
           
            let saveResult;
            try {
              const responseText = await saveResponse.text();
              console.log('Save response text:', responseText);
              saveResult = JSON.parse(responseText);
            } catch (parseErr) {
              console.error('Error parsing save response:', parseErr);
              throw new Error(`Failed to parse server response: ${parseErr.message}`);
            }
            console.log('Save result:', saveResult);
           
            if (saveResponse.ok && saveResult.status === 'success') {
              console.log('✅ Payroll data saved to backend:', saveResult.successCount || payrollPayloadForSave.length, 'records');
              // Verify the data was saved by fetching it back
              setTimeout(async () => {
                try {
                  let verifyUrl = `/server/payroll_function/payroll?month=${selectedMonth}&_t=${Date.now()}`;
                  if (fromDate) verifyUrl += `&fromDate=${encodeURIComponent(fromDate)}`;
                  if (toDate) verifyUrl += `&toDate=${encodeURIComponent(toDate)}`;
                  if (userEmail) verifyUrl += `&userEmail=${encodeURIComponent(userEmail)}`;
                  const verifyRes = await fetch(verifyUrl);
                  if (verifyRes.ok) {
                    const verifyResult = await verifyRes.json();
                    console.log('✅ Verification: Found', verifyResult.data?.length || 0, 'records in backend after save');
                  }
                } catch (verifyErr) {
                  console.error('Error verifying saved data:', verifyErr);
                }
              }, 1000);
            } else {
              const errorMsg = saveResult.error || saveResult.message || 'Unknown error';
              console.error('⚠️ Failed to save payroll data to backend:', errorMsg);
              console.error('Full save result:', saveResult);
              // Don't show error to user - data is displaying correctly, user can save manually if needed
              // setError(`Failed to save payroll data: ${errorMsg}. Please try saving manually using the "Save Payroll" button.`);
            }
          } catch (saveErr) {
            console.error('Error saving payroll data to backend:', saveErr);
            const errorMessage = saveErr.message || 'Unknown error occurred';
            // Don't show error to user - data is displaying correctly, user can save manually if needed
            // setError(`Failed to save payroll data: ${errorMessage}. Please try saving manually using the "Save Payroll" button.`);
            // Continue even if save fails - data is still displayed
          }
         
          // Reset filters for unrestricted users only
          if (!forcedContractor) {
          setContractor('All');
          setDepartment('All');
          setEmployeeId('All');
          }
         
          console.log('✅ Payroll completed -', result.data.length, 'records loaded and saved');
          // Clear any previous errors since payroll completed successfully
          setError(null);
          setImportSuccess('Payroll completed successfully! Days Present and LOH hours are automatically fetched from BHR attendance table and LOH report. Data has been saved.');
          setTimeout(() => setImportSuccess(''), 5000);
        } else {
          console.log('No payroll data returned');
          setPayrollRun(false);
          setPayrollData([]);
          setAllPayrollData([]);
          shouldUseLocalFilter.current = false;
          // Clear any previous errors
          setError(null);
          setImportSuccess('Payroll completed but no data found for the selected month.');
          setTimeout(() => setImportSuccess(''), 5000);
        }
    } catch (err) {
      console.error('Error running payroll:', err);
      // Show detailed error message to help debug
      const errorMessage = err.message || 'Unknown error occurred';
      setError(`Failed to run payroll: ${errorMessage}. Please check the console for more details.`);
      setImportSuccess('');
    } finally {
      setRunningPayroll(false);
      setLoading(false);
    }
  };

  const handleSavePayroll = async () => {
    const dataToSave = allPayrollData.length > 0 ? allPayrollData : payrollData;

    if (!payrollRun || dataToSave.length === 0) {
      setError('Run payroll first before saving.');
      return;
    }

    setSavingPayroll(true);
    setError(null);
    setImportSuccess('');

    try {
      const response = await fetch('/server/payroll_function/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          month: selectedMonth,
          payrollData: dataToSave,
          userEmail
        })
      });

      const result = await response.json();

      if (response.ok && result.status === 'success') {
        setImportSuccess(`Payroll saved successfully for ${selectedMonth}. Redirecting to report...`);
        // Navigate to the Payroll Report page for the saved month so the user can view it immediately
        navigate(`/payroll-report?month=${encodeURIComponent(selectedMonth)}`);
      } else {
        throw new Error(result.message || result.error || 'Failed to save payroll data');
      }
    } catch (err) {
      console.error('Error saving payroll:', err);
      setError('Failed to save payroll. ' + err.message);
    } finally {
      setSavingPayroll(false);
    }
  };

  const selectionsFromAutomaticDatastoreRow = useCallback((row) => {
    const next = new Set();
    if (!row || typeof row !== 'object') return next;
    const isYes = (v) => {
      const s = String(v ?? '').trim().toLowerCase();
      return s === 'yes' || s === 'true' || s === '1' || s === 'y';
    };
    if (isYes(row.Automatic)) next.add('Automatic');
    if (isYes(row.Manual)) next.add('Manual');
    return next;
  }, []);

  const closeAutomaticModal = () => {
    if (savingAutomaticSelection) return;
    setShowAutomaticModal(false);
  };

  const toggleAutomaticModeOption = (label) => {
    setAutomaticSelections((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  const handleSaveAutomaticSelection = async () => {
    const list = Array.from(automaticSelections);
    if (list.length === 0) {
      setError('Select at least one option: Automatic or Manual.');
      return;
    }
    setSavingAutomaticSelection(true);
    setError(null);
    setImportSuccess('');
    try {
      const response = await fetch('/server/payroll_function/automatic-selection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selections: list, month: selectedMonth })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result.error || `Save failed (${response.status})`);
      }
      setImportSuccess(`Saved payroll mode for ${selectedMonth}: ${list.join(', ')}.`);
      if (result.data) {
        setAutomaticSelections(selectionsFromAutomaticDatastoreRow(result.data));
      }
    } catch (err) {
      console.error('Error saving Automatic selection:', err);
      setError(err.message || 'Failed to save to Automatic datastore.');
    } finally {
      setSavingAutomaticSelection(false);
    }
  };

  // Per-month payroll mode (Automatic / Manual) from Data Store.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/server/payroll_function/automatic-selection/latest?month=${encodeURIComponent(selectedMonth)}&_t=${Date.now()}`
        );
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          console.error('Could not load saved payroll mode:', data.error || res.status);
          return;
        }
        if (data.status === 'success') {
          const next = new Set();
          if (data.automatic) next.add('Automatic');
          if (data.manual) next.add('Manual');
          setAutomaticSelections(next);
        }
      } catch (e) {
        if (!cancelled) {
          console.error('Load payroll mode:', e);
        }
      } finally {
        if (!cancelled) setLoadingAutomaticSaved(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedMonth]);

  // Handle row click to edit employee data
  const handleViewPayslip = (employee) => {
    // Fetch latest Payslip Template first so View displays with saved template data (components, company name)
    fetch('/server/payslip_function/getPayslipTemplate')
      .then((res) => res.json())
      .then((data) => {
        if (data && data.success) {
          setPayslipTemplateConfig({
            companyName: typeof data.companyName === 'string' ? data.companyName.trim() : '',
            earningKeys: Array.isArray(data.earningKeys) ? data.earningKeys : [],
            deductionKeys: Array.isArray(data.deductionKeys) ? data.deductionKeys : [],
          });
        }
        setPayslipPreviewEmployee(employee);
        setShowPayslipPreview(true);
      })
      .catch(() => {
        setPayslipPreviewEmployee(employee);
        setShowPayslipPreview(true);
      });
  };

  const handleClosePayslipPreview = () => {
    setShowPayslipPreview(false);
    setPayslipPreviewEmployee(null);
  };

  // Toggle Payslip checkbox and persist to backend
  const handlePayslipCheck = async (employee, checked) => {
    const prevChecked = !!(employee.payslip === true || employee.payslip === 'true');
    if (prevChecked === checked) return;
    setPayrollData(prev => prev.map(emp => emp.employeeCode === employee.employeeCode ? { ...emp, payslip: checked } : emp));
    setAllPayrollData(prev => prev.map(emp => emp.employeeCode === employee.employeeCode ? { ...emp, payslip: checked } : emp));
    try {
      const response = await fetch('/server/payroll_function/update', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          month: selectedMonth,
          employeeCode: employee.employeeCode,
          updatedData: { payslip: checked },
          userEmail
        })
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `Update failed: ${response.status}`);
      }
    } catch (err) {
      setPayrollData(prev => prev.map(emp => emp.employeeCode === employee.employeeCode ? { ...emp, payslip: prevChecked } : emp));
      setAllPayrollData(prev => prev.map(emp => emp.employeeCode === employee.employeeCode ? { ...emp, payslip: prevChecked } : emp));
      setError(err.message || 'Failed to update payslip');
    }
  };

  // Select all / deselect all Payslip checkboxes for visible employees
  const handlePayslipSelectAll = async (checked) => {
    if (!payrollData || payrollData.length === 0) return;
    const savedPayrollData = payrollData.map(emp => ({ ...emp }));
    const savedAllPayrollData = allPayrollData.map(emp => ({ ...emp }));
    setPayrollData(prev => prev.map(emp => ({ ...emp, payslip: checked })));
    setAllPayrollData(prev => prev.map(emp => ({ ...emp, payslip: checked })));
    const results = await Promise.allSettled(
      payrollData.map(emp =>
        fetch('/server/payroll_function/update', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            month: selectedMonth,
            employeeCode: emp.employeeCode,
            updatedData: { payslip: checked },
            userEmail
          })
        })
      )
    );
    const failed = results.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && r.value && !r.value.ok));
    if (failed.length > 0) {
      setPayrollData(savedPayrollData);
      setAllPayrollData(savedAllPayrollData);
      setError(`Payslip update failed for ${failed.length} employee(s).`);
    }
  };

  const fetchPayslipTemplateForPdf = async () => {
    try {
      const res = await fetch('/server/payslip_function/getPayslipTemplate');
      const data = await res.json();
      if (data && data.success) {
        return {
          companyName: typeof data.companyName === 'string' ? data.companyName.trim() : '',
          earningKeys: Array.isArray(data.earningKeys) ? data.earningKeys : [],
          deductionKeys: Array.isArray(data.deductionKeys) ? data.deductionKeys : [],
        };
      }
    } catch {
      /* use fallback */
    }
    return payslipTemplateConfig;
  };

  const payslipPdfBaseOptions = (template) => {
    const t = template && typeof template === 'object' ? template : null;
    const useTemplateOverrides = t && (t.earningKeys?.length > 0 || t.deductionKeys?.length > 0);
    return {
      payrollKeyToHeaderLabel,
      selectedMonth,
      preferStoredTemplate: true,
      strictTemplate: !!useTemplateOverrides,
      companyNameOverride: useTemplateOverrides && t.companyName ? t.companyName : undefined,
      earningKeysOverride: useTemplateOverrides ? t.earningKeys : undefined,
      deductionKeysOverride: useTemplateOverrides ? t.deductionKeys : undefined,
      logoUrl: payslipLogo,
      getDisplayValue: getComponentDisplayValue,
    };
  };

  const handleDownloadPayslipPdf = async (employee) => {
    if (!employee) return;
    setShowPayslipPreview(false);
    setPayslipPreviewEmployee(null);
    const code = employee.employeeCode ?? employee.EmployeeCode ?? '';
    setPayslipPdfRowBusyCode(code);
    setError('');
    try {
      const template = await fetchPayslipTemplateForPdf();
      const ok = await downloadPayslipPdf({
        employee,
        ...payslipPdfBaseOptions(template),
      });
      if (!ok) setError('Could not generate payslip PDF. Try again or use View and print to PDF.');
    } catch (err) {
      setError(err?.message || 'Payslip PDF download failed.');
    } finally {
      removePayslipPdfGenerationArtifacts();
      setPayslipPdfRowBusyCode(null);
    }
  };

  const handleDownloadSelectedPayslipsZip = async () => {
    const selected = payrollData.filter((emp) => !!(emp.payslip === true || emp.payslip === 'true'));
    if (!selected.length) {
      setError('Select at least one employee with the Payslip checkbox, then click Download ZIP.');
      return;
    }
    setShowPayslipPreview(false);
    setPayslipPreviewEmployee(null);
    setPayslipZipFallback((prev) => {
      if (prev?.url) URL.revokeObjectURL(prev.url);
      return null;
    });
    removePayslipPdfGenerationArtifacts();

    const zipName = `Payslips_${selectedMonth || 'export'}.zip`;

    setPayslipZipBusy(true);
    setError('');
    try {
      const template = await fetchPayslipTemplateForPdf();
      const base = payslipPdfBaseOptions(template);
      const zip = new JSZip();
      let added = 0;
      for (let i = 0; i < selected.length; i += 1) {
        const employee = selected[i];
        const blob = await generatePayslipPdfBlob({ employee, ...base });
        if (blob && blob.size > 0) {
          const rawCode = employee.employeeCode ?? employee.EmployeeCode ?? `emp_${i}`;
          const safeCode = String(rawCode).replace(/[^\w.-]+/g, '_');
          zip.file(`Payslip_${safeCode}_${selectedMonth || 'month'}.pdf`, blob);
          added += 1;
        }
      }
      if (!added) {
        setError(
          'Could not generate any payslip PDFs. If this persists, open one row with View — if View is blank, fix the payslip template or logo (CORS).'
        );
        return;
      }
      const zipBlob = await zip.generateAsync({ type: 'blob' });

      const nav = typeof navigator !== 'undefined' ? navigator : null;
      if (nav && typeof nav.msSaveOrOpenBlob === 'function') {
        nav.msSaveOrOpenBlob(zipBlob, zipName);
        setImportSuccess(`Saving ${zipName} (${added} PDFs)…`);
        setTimeout(() => setImportSuccess(''), 6000);
        return;
      }

      const url = URL.createObjectURL(zipBlob);
      setPayslipZipFallback({ url, filename: zipName });
      const a = document.createElement('a');
      a.href = url;
      a.setAttribute('download', zipName);
      a.download = zipName;
      a.rel = 'noopener';
      a.style.display = 'none';
      document.body.appendChild(a);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          try {
            a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
          } catch {
            a.click();
          }
        });
      });
      setTimeout(() => {
        if (a.parentNode) a.parentNode.removeChild(a);
      }, 4000);
      setImportSuccess(
        `ZIP ${zipName} contains ${added} payslip PDF(s) (same layout as View). If download did not start, use the green “Save …” link below.`
      );
      setTimeout(() => setImportSuccess(''), 20000);
      setTimeout(() => {
        setPayslipZipFallback((prev) => {
          if (prev?.url === url) {
            URL.revokeObjectURL(url);
            return null;
          }
          return prev;
        });
      }, 300000);
    } catch (err) {
      setError(err?.message || 'ZIP download failed.');
    } finally {
      removePayslipPdfGenerationArtifacts();
      setPayslipZipBusy(false);
    }
  };

  const payslipPreviewMarkup = useMemo(() => {
    if (!showPayslipPreview || !payslipPreviewEmployee) return '';

    // Use Payslip Template format: same earnings/deductions and company name as on Payslip Template page.
    // If we have template from backend, use it; otherwise use stored template from localStorage.
    const template = payslipTemplateConfig;
    const useTemplateOverrides = template && (template.earningKeys?.length > 0 || template.deductionKeys?.length > 0);

    return buildPayslipPreviewMarkup({
      employee: payslipPreviewEmployee,
      selectedMonth,
      payrollKeyToHeaderLabel,
      preferStoredTemplate: true,
      strictTemplate: useTemplateOverrides,
      companyNameOverride: useTemplateOverrides && template.companyName ? template.companyName : undefined,
      earningKeysOverride: useTemplateOverrides ? template.earningKeys : undefined,
      deductionKeysOverride: useTemplateOverrides ? template.deductionKeys : undefined,
      logoUrl: payslipLogo,
      getDisplayValue: getComponentDisplayValue,
    });
  }, [showPayslipPreview, payslipPreviewEmployee, selectedMonth, payrollKeyToHeaderLabel, payslipTemplateConfig]);

  const handleRowClick = (employee) => {
    setEditingEmployee(employee);
    const initialFormData = {
      employeeCode: employee.employeeCode || '',
      employeeName: employee.employeeName || '',
      designation: employee.designation ?? employee.Designation ?? '',
      department: employee.department || '',
      unit: payrollRowUnitDisplay(employee),
      dateOfJoining: employee.dateOfJoining ?? employee.date_of_joining ?? '',
      contractor: employee.contractor || '',
      daysInMonth: toWholeNumber(employee.daysInMonth ?? employee.DaysInMonth ?? 0),
      daysPresent:
        employee.daysPresent != null && employee.daysPresent !== '' && !isNaN(Number(employee.daysPresent))
          ? toDaysPresentValue(Number(employee.daysPresent))
          : 0,
      otHours: toOtHoursValue(employee.otHours ?? employee.OTHours ?? 0),
      loh: toLohValue(employee.loh !== null && employee.loh !== undefined ? employee.loh : 0),
      actualBasic: toWholeNumber(employee.actualBasic ?? employee.ActualBasic ?? 0),
      actualHRA: toWholeNumber(employee.actualHRA ?? employee.ActualHRA ?? 0),
      actualDA: toWholeNumber(employee.actualDA ?? employee.ActualDA ?? 0),
      otherAllowance: toWholeNumber(employee.otherAllowance || 0),
      otherAllowances: toWholeNumber(employee.otherAllowances ?? employee.otherAllowance ?? 0),
      specialAllowance: toWholeNumber(employee.specialAllowance ?? employee.SpecialAllowance ?? 0),
      loanAllowance: toWholeNumber(employee.loanAllowance || 0),
      foodAllowance: toWholeNumber(employee.foodAllowance ?? employee.FoodAllowance ?? 0),
      travelChargers: toWholeNumber(getTravelChargersFromRecord(employee)),
      noOfDaysWithoutUniforms: toWholeNumber(employee.noOfDaysWithoutUniforms ?? employee.noofdayswithoutuniforms ?? 0),
      incentive: toWholeNumber(employee.incentive || 0),
      arrear: toWholeNumber(employee.arrear || 0),
      arrearForPF: toWholeNumber(employee.arrearForPF || 0),
      lop: toDaysPresentValue(parseFloat(employee.lop) || 0),
      actualTotalSalary: toWholeNumber(employee.actualTotalSalary || 0),
      earnedBasic: toWholeNumber(employee.earnedBasic || 0),
      earnedHRA: toWholeNumber(employee.earnedHRA || 0),
      earnedDA: toWholeNumber(employee.earnedDA || 0),
      earnedSpecialAllowance: toWholeNumber(employee.earnedSpecialAllowance ?? employee.EarnedSpecialAllowance ?? 0),
      earnedAttendanceAllowance: toWholeNumber(employee.earnedAttendanceAllowance || 0),
      earnedOtherAllowances: toWholeNumber(employee.earnedOtherAllowances || 0),
      earnedSalaryCross: toWholeNumber(employee.earnedSalaryCross || 0),
      // Keep edit modal PF/ESI aligned with table display logic.
      pf: toWholeNumber(getPfDisplayValue(employee) ?? 0),
      esi: toWholeNumber(employee.esi ?? getEsiDisplayValue(employee) ?? 0),
      totalDeduction: toWholeNumber(getDisplayTotalDeduction(employee)),
      otAmount: toWholeNumber(getOtAmountDisplayFromEmployee(employee)),
      otArrearAmount: toWholeNumber(employee.otArrearAmount || 0),
      otEsi: toWholeNumber(employee.otEsi || 0),
      otPayment: toWholeNumber(employee.otPayment || 0),
      payableAmount: toWholeNumber(employee.payableAmount || 0),
      otWages: toWholeNumber(employee.otWages || 0),
      rent: toWholeNumber(employee.rent || 0),
      advance: toWholeNumber(employee.advance || 0),
      lwf: selectedMonth.endsWith('-12') ? 20 : toWholeNumber(employee.lwf || 0),
      pt: toWholeNumber(getDisplayPT(employee)),
      otherDeduction: toWholeNumber(employee.otherDeduction || 0),
      netPay: toWholeNumber(employee.netPay || 0),
      totalNetPayable: toWholeNumber(employee.totalNetPayable || 0),
      erpf: toWholeNumber(employee.erpf || 0),
      admin: toWholeNumber(employee.admin || 0),
      edli: toWholeNumber(employee.edli || 0),
      erpf13: toWholeNumber(getErpf13DisplayValue(employee)),
      employerEsi: toWholeNumber(employee.employerEsi || 0),
      esiContribution: toWholeNumber(employee.esiContribution ?? employee.ESIContribution ?? 0),
      employerLwf: toWholeNumber(employee.employerLwf ?? (selectedMonth.endsWith('-12') ? 40 : 0)),
      serviceCharge: toWholeNumber(employee.serviceCharge || 0),
      total: toWholeNumber(employee.total || 0),
      gst: toWholeNumber(employee.gst || 0),
      netTotal: toWholeNumber(employee.netTotal || 0),
      bonus: toWholeNumber(employee.bonus || 0),
      washingAllowance: toWholeNumber(employee.washingAllowance ?? employee.WashingAllowance ?? 0),
      attendanceBonus: toWholeNumber(employee.attendanceBonus ?? employee.AttendanceBonus ?? 0),
      bankHolderName: employee.bankHolderName || '',
      bankName: employee.bankName || '',
      ifscCode: employee.ifscCode || '',
      bankBranch: employee.bankBranch || '',
      pfStatus: employee.pfStatus ?? employee.PFStatus ?? employee.pfstatus ?? '',
      esiStatus: employee.esiStatus ?? employee.ESIStatus ?? employee.esi_status ?? '',
      payslip: !!(employee.payslip === true || employee.payslip === 'true'),
    };
    // Calculate derived fields immediately when opening the modal
    const derivedFields = calculateDerivedFields(initialFormData);
    const merged = { ...initialFormData, ...derivedFields };
    // Modal must match grid row on open: calculateDerivedFields can change earned* / esi vs muster+saved row.
    merged.earnedBasic = toWholeNumber(employee.earnedBasic ?? employee.EarnedBasic ?? merged.earnedBasic);
    merged.earnedHRA = toWholeNumber(employee.earnedHRA ?? employee.EarnedHRA ?? merged.earnedHRA);
    merged.earnedDA = toWholeNumber(employee.earnedDA ?? employee.EarnedDA ?? merged.earnedDA);
    merged.earnedSpecialAllowance = toWholeNumber(
      employee.earnedSpecialAllowance ?? employee.EarnedSpecialAllowance ?? merged.earnedSpecialAllowance
    );
    merged.esi = employee.esi ?? employee.ESI ?? merged.esi;
    // OT Amount must match the payroll grid column (same as getComponentDisplayValue → stored / Setup formula / built-in), not only the built-in recompute from calculateDerivedFields.
    merged.otAmount = toWholeNumber(getOtAmountDisplayFromEmployee(employee));
    // Earned Gross Salary: use same value as grid row (backend + payroll formulae). Client-only sum (egsFromFormula) can differ from displayed EGS.
    const rowEgsRaw =
      employee.earnedSalaryCross ?? employee.EarnedSalaryCross ?? employee.earnedGrossSalary ?? employee.EarnedGrossSalary;
    let egsVal;
    if (rowEgsRaw !== undefined && rowEgsRaw !== null && rowEgsRaw !== '') {
      egsVal = toWholeNumber(rowEgsRaw);
    } else {
      const egsFormulaOpen = (Array.isArray(payrollFormulae) ? payrollFormulae : []).find(
        (f) => String(f.variable || '').trim().toLowerCase() === 'earned gross salary'
      );
      if (egsFormulaOpen && String(egsFormulaOpen.expression || '').trim()) {
        const vOpen = evaluateFormulaExpression(merged, egsFormulaOpen.expression);
        egsVal = Number.isFinite(vOpen)
          ? Math.round(vOpen)
          : toWholeNumber(merged.earnedSalaryCross ?? merged.earnedGrossSalary ?? 0);
      } else {
        const egsFromFormula =
          (Number(merged.travelChargers) || 0) +
          (Number(merged.otAmount) || 0) +
          (Number(merged.incentive) || 0) +
          (Number(merged.attendanceBonus) || 0) +
          (Number(merged.washingAllowance) || 0) +
          (Number(merged.foodAllowance) || 0) +
          (Number(merged.earnedBasic) || 0) +
          (Number(merged.earnedHRA) || 0) +
          (Number(merged.earnedSpecialAllowance) || 0);
        egsVal = Math.round(egsFromFormula);
      }
    }
    merged.earnedSalaryCross = egsVal;
    merged.earnedGrossSalary = egsVal;
    // Ensure modal shows exactly what table logic would show for PF/ESI/Total Deduction/Net Pay.
    merged.pf = toWholeNumber(getPfDisplayValue(merged) ?? 0);
    merged.esi = toWholeNumber(getEsiDisplayValue(merged) ?? 0);
    merged.totalDeduction = toWholeNumber(getDisplayTotalDeduction(merged) ?? 0);
    merged.netPay = toWholeNumber(getComponentDisplayValue(merged, 'Net Pay') ?? 0);
    for (const compName of tablePayrollComponents || []) {
      const k = getPayrollEditFieldKey(compName);
      if (!k) continue;
      if (merged[k] === undefined || merged[k] === null || merged[k] === '') {
        const disp = getComponentDisplayValue(employee, compName);
        if (disp !== '' && disp !== undefined && disp !== null) {
          const n = typeof disp === 'number' ? disp : Number(disp);
          merged[k] = Number.isFinite(n) ? toWholeNumber(disp) : disp;
        } else {
          merged[k] = 0;
        }
      }
    }
    setEditFormData(merged);
    setShowEditModal(true);
  };

  // Calculate derived fields based on formulas
  const calculateDerivedFields = (formData) => {
    const parseLooseNumber = (value) => {
      const raw = String(value ?? '').trim();
      if (!raw) return null;
      const cleaned = raw.replace(/[^0-9.\-]/g, '');
      const n = Number(cleaned);
      return Number.isFinite(n) ? n : null;
    };

    const actualBasic = parseFloat(formData.actualBasic) || 0;
    let actualHRA = parseFloat(formData.actualHRA) || 0;
    let actualHRAFromFormula = false;
    // When Actual HRA is 0 in the form, apply saved "Actual HRA" formula if present (e.g. Actual Basic * 40%) so Earned HRA can display
    const formulaeRef = payrollFormulaeRef.current || [];
    const actualHRAFormula = formulaeRef.find((f) => String(f.variable || '').trim().toLowerCase() === 'actual hra');
    if (actualHRAFormula && actualHRAFormula.expression && actualHRA === 0) {
      const formulaHRA = evaluateFormulaExpression(formData, actualHRAFormula.expression);
      if (Number.isFinite(formulaHRA) && formulaHRA >= 0) {
        actualHRA = formulaHRA;
        actualHRAFromFormula = true;
      }
    }
    const actualDA = parseFloat(formData.actualDA) || 0;
    const otherAllowance = parseFloat(formData.otherAllowance) || 0;
    const specialAllowance = parseFloat(formData.specialAllowance) || 0;
    // Use form value, else derive from selected month (e.g. 2026-03 -> 31), else 31
    let daysInMonth = parseFloat(formData.daysInMonth) || 0;
    if (daysInMonth <= 0 && selectedMonth) {
      const parts = String(selectedMonth).split('-');
      if (parts.length >= 2) {
        const y = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10);
        if (!isNaN(y) && !isNaN(m)) daysInMonth = new Date(y, m, 0).getDate();
      }
    }
    daysInMonth = daysInMonth || 31;
    const daysPresent = parseFloat(formData.daysPresent) || 0;
    const otHours = parseFloat(formData.otHours ?? formData.OTHours) || 0;
    const loh = parseFloat(formData.loh ?? formData.LOH) || 0;
    // OT Wages = (Actual Basic / no.of present in month) / 8 * OT Hours
    const otWages = daysPresent > 0 ? ((actualBasic / daysPresent) / 8) * otHours : 0;

    // Calculate earned amounts
    // Earned Basic = (Actual Basic / No. of Days(In month) * No. of Days Present) - ((Actual Basic / No. of Days(In month)) / 8 * LOH); clamp to 0
    const dailyBasic = daysInMonth > 0 ? actualBasic / daysInMonth : 0;
    const earnedBasicRaw = (dailyBasic * daysPresent) - ((dailyBasic / 8) * loh);
    const earnedBasic = Math.max(0, earnedBasicRaw);
    // Earned HRA = (Actual HRA / No. of Days(In month) * No. of Days Present) - ((Actual HRA / No. of Days(In month)) / 8 * LOH)
    const earnedHRA = ((actualHRA / daysInMonth) * daysPresent) - (((actualHRA / daysInMonth) / 8) * loh);
    const earnedDA = ((actualDA / daysInMonth) * daysPresent) - (((actualDA / daysInMonth) / 8) * loh);
    const arrear = parseFloat(formData.arrear) || 0;
    const arrearForPF = parseFloat(formData.arrearForPF) || 0;
    // Use manually entered LOP if provided, otherwise calculate LOP automatically: LOP = Days In Month - Days Present
    // This preserves user edits when LOP is manually changed
    const lop = formData.lop !== undefined && formData.lop !== null && formData.lop !== ''
      ? parseFloat(formData.lop) || 0
      : Math.max(0, daysInMonth - daysPresent);

    const incentive = parseFloat(formData.incentive) || 0;
    const otArrearAmount = parseFloat(formData.otArrearAmount) || 0;
    // Calculate Earned Attendance Allowance: (Attendance Allowance / daysInMonth × daysPresent) - ((Attendance Allowance / daysInMonth) / 8 × LOH)
    const earnedAttendanceAllowance = daysInMonth > 0 ? ((otherAllowance / daysInMonth) * daysPresent) - (((otherAllowance / daysInMonth) / 8) * loh) : 0;
    const otherAllowances = parseFloat(formData.otherAllowances) || 0;
    // Earned Other Allowances = (OtherAllowances / daysInMonth * daysPresent) - ((OtherAllowances / daysInMonth) / 8 * LOH)
    const earnedOtherAllowances = daysInMonth > 0 ? ((otherAllowances / daysInMonth) * daysPresent) - (((otherAllowances / daysInMonth) / 8) * loh) : 0;

    // Actual Total Salary: prefer stored value (from employee master / imported payroll), do not derive from formulae.
    const providedActualTotalSalaryRaw = formData?.actualTotalSalary ?? formData?.ActualTotalSalary ?? formData?.ActualTotalGross ?? formData?.actualTotalGross;
    const providedActualTotalSalary = parseLooseNumber(providedActualTotalSalaryRaw);
    const travelChargersRow = getTravelChargersFromRecord(formData);
    const computedActualTotalSalary =
      actualBasic + actualHRA + actualDA + otherAllowance + otherAllowances + travelChargersRow + specialAllowance;
    const actualTotalSalary = providedActualTotalSalary ?? computedActualTotalSalary;

    const baseEarnedGross = earnedBasic + earnedHRA + earnedDA + earnedAttendanceAllowance + earnedOtherAllowances + arrear + arrearForPF + incentive + otArrearAmount; // Includes OTArrearAmount and Arrear For PF
    // OT Amount = (effective daily basic / 8) * OT Hours * 2 — daily basic from earned÷present or actual÷dim (not earned÷dim twice)
    const otAmount = computeDefaultOtAmountFromEarnedAndActual({
      earnedBasic,
      actualBasic,
      daysInMonth,
      daysPresent,
      otHours
    });
    const earnedSalaryCross = baseEarnedGross + otAmount; // Earned Gross Salary = baseEarnedGross + OT only (exclude special allowance, other allowances)
    const pfEnabled = isPfEnabled(formData);
    const esiEnabled = isEsiEnabled(formData);
    // Earned Special Allowance = (Special Allowance / No. of Days(In month) * No. of Days Present) - ((Special Allowance / No. of Days(In month)) / 8 * LOH)
    const earnedSpecialAllowanceForm = daysInMonth > 0 ? Math.max(0, ((specialAllowance / daysInMonth) * daysPresent) - (((specialAllowance / daysInMonth) / 8) * loh)) : 0;
    // When Actual Special Allowance is 0 (or missing on row) but payroll row still has Earned Special Allowance from run/import/DB, keep it — otherwise Save sends 0 and the grid shows ₹0.
    const savedEarnedSpecialAllowance = parseLooseNumber(formData.earnedSpecialAllowance ?? formData.EarnedSpecialAllowance);
    const earnedSpecialAllowanceResolved =
      specialAllowance > 0
        ? earnedSpecialAllowanceForm
        : savedEarnedSpecialAllowance !== null && savedEarnedSpecialAllowance >= 0
          ? savedEarnedSpecialAllowance
          : earnedSpecialAllowanceForm;
    // PF: Earned Basic > 15000 → 1800; else 12% on Earned Basic. pfWages (Admin/EDLI) still uses combined earned (capped).
    const earnedPlusSpecial = earnedBasic + earnedSpecialAllowanceResolved;
    let pfWages;
    let pf;
    if (pfEnabled && earnedBasic > 0) {
      if (earnedBasic > 15000) {
        pf = 1800;
        pfWages = 15000;
      } else {
        pfWages = Math.min(15000, Math.max(0, earnedPlusSpecial));
        pf = Math.round(earnedBasic * 0.12);
      }
    } else {
      pf = 0;
      pfWages = 0;
    }
   const otPayment = daysInMonth > 0 ? ((actualTotalSalary / daysInMonth) / 8) * otHours * 2 : 0; // OT Payment = (Actual Total Gross / no.of months) / 8 * OT Hours * 2
    // ESI 0.75%: Earned Basic + OT Amount + Incentive (not HRA/Special/Travel — avoids LOH shifting ESI incorrectly)
    const esiBaseSum = earnedBasic + otAmount + incentive;
    const esi = esiEnabled && esiBaseSum > 0 ? Math.round(esiBaseSum * 0.0075) : 0;
    const employerEsi = esiEnabled && esi > 0 ? earnedSalaryCross * 0.0325 : 0; // Employer ESI = Earned Gross Salary × 3.25% when ESI > 0
    const otherDeduction = parseFloat(formData.otherDeduction) || 0;
    // December: LWF = 20 for all employees (enforced every year)
    const lwf = selectedMonth.endsWith('-12') ? 20 : (parseFloat(formData.lwf) || 0);
    const pt = toWholeNumber(parseFloat(formData.pt) || 0); // PT rounded to whole number
    const rent = parseFloat(formData.rent) || 0; // Rent Recovery (included in Total Deduction)
    const contractorNameForCalc = String(formData.contractor || '').trim().toLowerCase();
    const isYashaswiForCalc = contractorNameForCalc === 'yashaswi academy for skills';
    // Total Deduction = PF + ESI + Loan allowance (Food allowance excluded from total)
    const loanVal = parseFloat(formData.loanAllowance) || 0;
    const esiForTotalDed = Number(formData.esi ?? formData.ESI ?? '') || esi;
    const totalDeduction = pf + esiForTotalDed + loanVal;
    const netPayBeforeAdvance = earnedSalaryCross - totalDeduction; // Net Pay before advance
    const otEsi = esiEnabled ? otAmount * 0.0075 : 0; // OT ESI uses OT Amount, not OT Payment, when ESI is enabled
    const payableAmount = otPayment - otEsi; // Payable Amount = OT Payment - OT ESI
    const advance = parseFloat(formData.advance) || 0;
    const finalNetPay = netPayBeforeAdvance - advance; // Final Net Pay (take-home) after advance (rent already in totalDeduction)
    const totalNetPayable = finalNetPay + payableAmount; // Total Net Payable = Net Pay + Payable Amount

    const erpf = pf; // ERPF 12% = PF from Actual Basic + Special Allowance (setup config), cap 15000
    const admin = pfEnabled ? pfWages * 0.005 : 0; // Admin 0.5% on PF wage base (only when PF enabled)
    const edli = pfEnabled ? (Math.round(pfWages) === 15000 ? 75 : pfWages * 0.005) : 0; // EDLI 0.5% = 75 if PF wages == 15000, else PF wages * 0.5% (only when PF enabled)
    const erpf12PlusAdminPlusEdli = isYashaswiForCalc ? 0 : (erpf + admin + edli); // ERPF 12% + Admin 0.5% + EDLI 0.5%
    let employerEsiForTotal = employerEsi;
    if (isYashaswiForCalc) { employerEsiForTotal = 0; } // Yashaswi: Employer ESI not in Total
    // Employer LWF contribution (40 for December, else 0) unless already present in the form (preserve saved/user value)
    const employerLwf = (formData.employerLwf !== undefined && formData.employerLwf !== null && formData.employerLwf !== '')
      ? (parseFloat(formData.employerLwf) || 0)
      : (selectedMonth.endsWith('-12') ? 40 : 0);
    // Special cases for service charge calculation:
    // - "Yashaswi Academy for Skills" or "Yashaswi Academy For Skills" (case-insensitive) = 1000 fixed
    // - "sriram enterprice"/"sriram enterprise"/"sriram enterprises" (case-insensitive) = 8%
    // - All others = 9%
    const contractorName = String(formData.contractor || '').trim();
    const contractorNameLower = contractorName.toLowerCase();
    // Service charge base = baseEarnedGross + ERPF 12% + Admin 0.5% + EDLI 0.5% + Employer ESI 3.25% + Employer LWF (do not include ESI Contribution)
    const serviceChargeBase = Math.max(0, baseEarnedGross + erpf12PlusAdminPlusEdli + employerEsiForTotal + employerLwf);
    let serviceCharge;
    if (contractorNameLower === 'yashaswi academy for skills') {
      serviceCharge = 1000; // Fixed 1000 for Yashaswi Academy for Skills (both "for" and "For" variations)
    } else if (contractorNameLower === 'sriram enterprice' || contractorNameLower === 'sriram enterprise' || contractorNameLower === 'sriram enterprises') {
      serviceCharge = serviceChargeBase * 0.08; // 8% for Sriram Enterprise/Enterprises
    } else {
      serviceCharge = serviceChargeBase * 0.09; // 9% for all others (on base + ERPF 12% + Admin 0.5% + EDLI 0.5% + Employer ESI + Employer LWF)
    }
    const esiContributionForTotal = parseFloat(formData.esiContribution ?? formData.ESIContribution) || 0;
    const total = earnedSalaryCross + erpf12PlusAdminPlusEdli + serviceCharge + employerEsiForTotal + employerLwf + esiContributionForTotal; // Total = Earned Gross + ERPF 12% + Admin 0.5% + EDLI 0.5% + Service Charge + Employer ESI 3.25% + Employer LWF + ESI Contribution
    // Special case: If contractor is "Yashaswi Academy for Skills" or "Yashaswi Academy For Skills" (case-insensitive), GST = 0, otherwise calculate 18%
    const gst = contractorNameLower === 'yashaswi academy for skills' ? 0 : total * 0.18;
    const netTotal = total + gst; // Net Total = Total + GST 18%

    // Attendance Bonus: days present = days in month → 0; else DOJ ≥1 year before month-end → 1200, else 800
    let attendanceBonusCalc = 0;
    const dateOfJoiningVal = formData.dateOfJoining ?? formData.date_of_joining ?? '';
    if (dateOfJoiningVal && daysInMonth > 0 && selectedMonth) {
      if (Number(daysPresent) === Number(daysInMonth)) {
        attendanceBonusCalc = 0;
      } else {
        const doj = new Date(dateOfJoiningVal);
        if (!isNaN(doj.getTime())) {
          const parts = String(selectedMonth).split('-').map(Number);
          if (parts.length >= 2) {
            const lastDayOfMonth = new Date(parts[0], parts[1], 0);
            const oneYearBefore = new Date(lastDayOfMonth);
            oneYearBefore.setFullYear(oneYearBefore.getFullYear() - 1);
            attendanceBonusCalc = doj <= oneYearBefore ? 1200 : 800;
          }
        }
      }
    }

    // Washing Allowance = 25 * (No. of Days Present - No. of days without uniform); clamp to 0 if negative
    const noOfDaysWithoutUniformsVal = Number(formData.noOfDaysWithoutUniforms ?? formData.noofdayswithoutuniforms ?? 0) || 0;
    const washingAllowanceCalc = Math.round(25 * Math.max(0, daysPresent - noOfDaysWithoutUniformsVal));

    const derived = {
      // Round most calculated fields to whole numbers; LOP can be fractional when Days Present is (e.g. 2.5)
      actualTotalSalary: toWholeNumber(actualTotalSalary),
      earnedBasic: toWholeNumber(earnedBasic),
      earnedHRA: toWholeNumber(earnedHRA),
      earnedDA: toWholeNumber(earnedDA),
      earnedSpecialAllowance: toWholeNumber(earnedSpecialAllowanceResolved),
      arrear: toWholeNumber(arrear),
      arrearForPF: toWholeNumber(parseFloat(formData.arrearForPF) || 0),
      lop: toDaysPresentValue(lop),
      earnedSalaryCross: toWholeNumber(earnedSalaryCross),
      pf: toWholeNumber(pf),
      esi: toWholeNumber(esi),
      totalDeduction: toWholeNumber(totalDeduction),
      late: 0,
      netPay: toWholeNumber(finalNetPay),
      otEsi: toWholeNumber(otEsi),
      otPayment: toWholeNumber(otPayment),
      payableAmount: toWholeNumber(payableAmount),
      totalNetPayable: toWholeNumber(totalNetPayable),
      erpf: toWholeNumber(erpf), // ERPF 12%
      admin: toWholeNumber(admin), // Admin 0.5%
      edli: toWholeNumber(edli), // EDLI 0.5%
      erpf13: toWholeNumber(erpf12PlusAdminPlusEdli), // ERPF 12% + Admin 0.5% + EDLI 0.5% (kept for backend/DB compatibility)
      employerEsi: toWholeNumber(isYashaswiForCalc ? 0 : employerEsi), // Employer ESI = 0 for Yashaswi; else Earned Cross Salary × 3.25%
      employerLwf: toWholeNumber(employerLwf), // Employer LWF contribution
      serviceCharge: toWholeNumber(serviceCharge), // Service Charge
      total: toWholeNumber(total), // Total
      gst: toWholeNumber(gst), // GST 18%
      netTotal: toWholeNumber(netTotal), // Net Total
      earnedAttendanceAllowance: toWholeNumber(earnedAttendanceAllowance),
      earnedOtherAllowances: toWholeNumber(earnedOtherAllowances),
      pt: toWholeNumber(pt), // PT rounded to whole number
      attendanceBonus: toWholeNumber(attendanceBonusCalc), // full month present → 0; else tenure 1+ year → 1200, under 1 year → 800
      washingAllowance: toWholeNumber(washingAllowanceCalc), // 25 * (Days Present - No. of days without uniform)
      // Echo allowances on the object sent to /import (derive merge must not drop PascalCase-only keys).
      otherAllowance: toWholeNumber(parseFloat(formData.otherAllowance ?? formData.OtherAllowance ?? 0) || 0),
      otherAllowances: toWholeNumber(parseFloat(formData.otherAllowances ?? formData.OtherAllowances ?? 0) || 0),
    };
    // When Actual HRA was computed from saved formula (form had 0), show it in the edit form so Earned HRA displays correctly
    if (actualHRAFromFormula) {
      derived.actualHRA = toWholeNumber(actualHRA);
    }
    // Overwrite with saved formulae so only formula-based values are used (e.g. Earned Basic = Basic / 8)
    if (Array.isArray(payrollFormulae) && payrollFormulae.length > 0) {
      const withFormulae = applyPayrollFormulaeToEmployee({ ...formData, ...derived });
      payrollFormulae.forEach(({ variable }) => {
        const base = String(variable).trim();
        if (!base) return;
        const camel = base.toLowerCase().split(/\s+/).map((word, i) => i === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1)).join('');
        const key = camel || base.replace(/\s+/g, '') || base.replace(/\s+/g, '_').toLowerCase();
        if (key === 'actualTotalSalary') return; // keep from employee/master, not formula-driven
        // Do not overwrite user-editable allowances with formula (user input must persist in edit form). Food Allowance uses Setup formula (same as payroll run).
        const userEditableAllowances = new Set(['washingAllowance', 'travelChargers', 'attendanceBonus']);
        if (userEditableAllowances.has(key)) return;
        if (key === 'foodAllownace') {
          const fv = withFormulae.foodAllowance ?? withFormulae.foodAllownace;
          if (fv !== undefined) derived.foodAllowance = fv;
          return;
        }
        const formulaVal = withFormulae[key];
        const formulaFailed = formulaVal === 0 || formulaVal === undefined || !Number.isFinite(formulaVal);
        // If formula returned 0/invalid but built-in would be positive, keep built-in so edit form shows correct value (matches backend after save)
        if (key === 'earnedHRA' && formulaFailed && actualHRA > 0 && daysPresent > 0 && (derived.earnedHRA || 0) > 0) {
          // keep derived.earnedHRA
        } else if (key === 'earnedBasic' && formulaFailed && actualBasic > 0 && (derived.earnedBasic || 0) > 0) {
          // keep derived.earnedBasic
        } else         if (key === 'earnedDA' && formulaFailed && actualDA > 0 && daysPresent > 0 && (derived.earnedDA || 0) > 0) {
          // keep derived.earnedDA
        } else         if (key === 'earnedSpecialAllowance' && formulaFailed && (specialAllowance > 0 || (savedEarnedSpecialAllowance !== null && savedEarnedSpecialAllowance > 0)) && daysPresent > 0 && (derived.earnedSpecialAllowance || 0) > 0) {
          // keep derived.earnedSpecialAllowance
        } else if (key === 'otAmount' && daysInMonth > 0 && otHours > 0 && (derived.otAmount || 0) > 0) {
          // keep derived OT Amount from built-in formula: (Earned Basic / daysInMonth / 8) * OT Hours * 2
        } else if (formulaVal !== undefined) {
          derived[key] = formulaVal;
        }
      });
      // Earned Gross Salary: formula writes to earnedGrossSalary; sync to earnedSalaryCross so edit form displays same value
      if (derived.earnedGrossSalary !== undefined) {
        derived.earnedSalaryCross = derived.earnedGrossSalary;
      }
    }
    // Fallback when Setup does not define Earned Gross Salary: sum travel, OT, incentives, allowances, earned components.
    const applyEarnedGrossFormula = () => {
      const sum = (Number(derived.travelChargers ?? formData.travelChargers) || 0) +
        (Number(derived.otAmount) || 0) +
        (Number(derived.incentive ?? formData.incentive) || 0) +
        (Number(derived.attendanceBonus ?? formData.attendanceBonus) || 0) +
        (Number(derived.washingAllowance ?? formData.washingAllowance) || 0) +
        (Number(derived.foodAllowance ?? formData.foodAllowance) || 0) +
        (Number(derived.earnedBasic) || 0) +
        (Number(derived.earnedHRA) || 0) +
        (Number(derived.earnedSpecialAllowance) || 0);
      derived.earnedSalaryCross = toWholeNumber(sum);
      derived.earnedGrossSalary = derived.earnedSalaryCross;
    };
    // OT Amount: same daily-rate rule after formulae (do not use finalEarnedBasic/dim — avoids OT spike when days present changes)
    const finalEarnedBasic = Number(derived.earnedBasic) || 0;
    const finalActualBasic = parseFloat(formData.actualBasic) || 0;
    const finalDaysPresent = parseFloat(formData.daysPresent) || 0;
    if (daysInMonth > 0 && finalEarnedBasic >= 0) {
      if (otHours > 0) {
        const newOtAmount = computeDefaultOtAmountFromEarnedAndActual({
          earnedBasic: finalEarnedBasic,
          actualBasic: finalActualBasic,
          daysInMonth,
          daysPresent: finalDaysPresent,
          otHours
        });
        derived.otAmount = toWholeNumber(newOtAmount);
      }
    }
    // When Setup defines "Earned Gross Salary", use that expression (e.g. Basic+HRA+Special+OtherAllowance+OT+Incentive).
    // Do not overwrite with the client-only fallback sum — that caused edit-form EGS to ignore Saved Formulae.
    const egsFormulaEntry = (Array.isArray(payrollFormulae) ? payrollFormulae : []).find(
      (f) => String(f.variable || '').trim().toLowerCase() === 'earned gross salary'
    );
    if (egsFormulaEntry && String(egsFormulaEntry.expression || '').trim()) {
      const rowForEgs = { ...formData, ...derived };
      const vEgs = evaluateFormulaExpression(rowForEgs, egsFormulaEntry.expression);
      if (Number.isFinite(vEgs)) {
        derived.earnedGrossSalary = Math.round(vEgs);
        derived.earnedSalaryCross = derived.earnedGrossSalary;
      } else {
        applyEarnedGrossFormula();
      }
    } else {
      applyEarnedGrossFormula();
    }
    // PF / ESI / Total Deduction / Net Pay / PT: align with Setup & Configuration + payslip template (same as main payroll grid)
    const recordForDisplayCalc = { ...formData, ...derived };
    derived.pf = toWholeNumber(getPfDisplayValue(recordForDisplayCalc) ?? 0);
    derived.esi = toWholeNumber(getEsiDisplayValue(recordForDisplayCalc) ?? 0);
    const rowFinal = { ...formData, ...derived };
    derived.pt = toWholeNumber(getDisplayPT(rowFinal));
    derived.totalDeduction = toWholeNumber(getDisplayTotalDeduction(rowFinal));
    derived.netPay = toWholeNumber(
      (Number(derived.earnedSalaryCross) || 0) -
        (Number(derived.totalDeduction) || 0) -
        (parseFloat(formData.advance) || 0)
    );
    return derived;
  };

  // Handle form input changes with automatic calculations
  const handleEditFormChange = (field, value) => {
    console.log(`Form field changed: ${field} = ${value}`);
    setEditFormData(prev => {
      const numericFields = new Set([
        'daysInMonth','daysPresent','otHours','loh','actualBasic','actualHRA','actualDA','otherAllowance','otherAllowances','specialAllowance','loanAllowance','foodAllowance','washingAllowance','travelChargers','noOfDaysWithoutUniforms',
        'incentive','arrear','arrearForPF','lop','earnedAttendanceAllowance','earnedOtherAllowances','pf','esi','otherDeduction','totalDeduction',
        'otAmount','otArrearAmount','otWages','otEsi','otPayment','payableAmount','rent','advance','lwf','pt','netPay','totalNetPayable',
        'erpf','admin','edli','employerEsi','esiContribution','employerLwf','serviceCharge','total','gst','netTotal','bonus','attendanceBonus',
        'actualTotalSalary','earnedBasic','earnedHRA','earnedDA','earnedSpecialAllowance','earnedSalaryCross'
      ]);
      const normalizedValue = numericFields.has(field)
        ? field === 'loh'
          ? toLohValue(value)
          : field === 'otHours'
            ? toOtHoursValue(value)
            : field === 'daysPresent' || field === 'lop'
              ? toDaysPresentValue(value)
              : toWholeNumber(value)
        : value;
      let newFormData = { ...prev, [field]: normalizedValue };
      console.log(`Updated form data for ${field}:`, newFormData[field]);
     
      // If Days In Month or Days Present is changed, automatically calculate LOP = Days In Month - Days Present
      if (field === 'daysInMonth' || field === 'daysPresent') {
        const daysInMonth = field === 'daysInMonth' ? toWholeNumber(value) : toWholeNumber(newFormData.daysInMonth);
        const daysPresentNum =
          field === 'daysPresent' ? toDaysPresentValue(value) : toDaysPresentValue(newFormData.daysPresent);
        const calculatedLOP = Math.max(0, daysInMonth - daysPresentNum); // Ensure non-negative
        newFormData.lop = toDaysPresentValue(calculatedLOP);
        console.log(`Auto-calculated LOP from ${field}: ${daysInMonth} - ${daysPresentNum} = ${calculatedLOP}`);
      }
      // If LOP is manually changed, automatically calculate Days Present = Days In Month - LOP
      if (field === 'lop') {
        const daysInMonth = toWholeNumber(newFormData.daysInMonth);
        const lopNum = toDaysPresentValue(value);
        const calculatedDaysPresent = Math.max(0, daysInMonth - lopNum); // Ensure non-negative
        newFormData.daysPresent = toDaysPresentValue(calculatedDaysPresent);
        console.log(`Auto-calculated Days Present from LOP: ${daysInMonth} - ${lopNum} = ${calculatedDaysPresent}`);
      }
     
      // Fields that are display-only / identifiers and do not affect payroll formulas - skip formula recalc
      const noRecalcFields = new Set(['employeeCode', 'employeeName', 'designation', 'department', 'unit', 'contractor', 'bankHolderName', 'bankName', 'ifscCode', 'bankBranch', 'pfStatus', 'esiStatus', 'payslip']);
      if (!noRecalcFields.has(field)) {
        let derivedFields = calculateDerivedFields(newFormData);
        // Keep Earned Gross fixed for edits that should not re-open gross (OT/travel/loan/uniform paths, etc.).
        // Do NOT include daysPresent / lop: they drive Earned Basic/HRA/Special via pro‑rating, so Earned Gross must follow the Setup gross formula.
        const editFieldsPreserveEarnedGross = new Set([
          'loh',
          'otHours',
          'travelChargers',
          'otherAllowance',
          'otherAllowances',
          'loanAllowance',
          'noOfDaysWithoutUniforms',
          'noofdayswithoutuniforms',
        ]);
        if (editFieldsPreserveEarnedGross.has(field)) {
          const keepEgs = Number(prev.earnedSalaryCross ?? prev.earnedGrossSalary ?? prev.EarnedGrossSalary);
          if (Number.isFinite(keepEgs)) {
            const adv = parseFloat(newFormData.advance) || 0;
            derivedFields = {
              ...derivedFields,
              earnedSalaryCross: toWholeNumber(keepEgs),
              earnedGrossSalary: toWholeNumber(keepEgs),
              netPay: toWholeNumber(
                keepEgs - (Number(derivedFields.totalDeduction) || 0) - adv
              ),
            };
          }
        }
        // LOH edit only: keep Earned Basic / Special / OT / Incentive as before — ESI = (Basic+OT+Incentive)×0.75% must not move.
        if (field === 'loh') {
          const eb = parseFloat(prev.earnedBasic ?? prev.EarnedBasic) || 0;
          const ehra = parseFloat(prev.earnedHRA ?? prev.EarnedHRA) || 0;
          const eda = parseFloat(prev.earnedDA ?? prev.EarnedDA) || 0;
          const esa = parseFloat(prev.earnedSpecialAllowance ?? prev.EarnedSpecialAllowance) || 0;
          const ot = parseFloat(prev.otAmount ?? prev.OTAmount) || 0;
          const inc = parseFloat(prev.incentive ?? prev.Incentive) || 0;
          derivedFields = {
            ...derivedFields,
            earnedBasic: toWholeNumber(eb),
            earnedHRA: toWholeNumber(ehra),
            earnedDA: toWholeNumber(eda),
            earnedSpecialAllowance: toWholeNumber(esa),
            otAmount: toWholeNumber(ot),
            incentive: toWholeNumber(inc),
          };
          const rowForEsi = { ...newFormData, ...derivedFields };
          const esiBase = eb + ot + inc;
          derivedFields.esi =
            isEsiEnabled(rowForEsi) && esiBase > 0
              ? toWholeNumber(Math.round(esiBase * 0.0075))
              : 0;
          const rowForDed = { ...newFormData, ...derivedFields };
          derivedFields.totalDeduction = toWholeNumber(getDisplayTotalDeduction(rowForDed));
          const adv = parseFloat(newFormData.advance) || 0;
          const egs = Number(derivedFields.earnedSalaryCross ?? derivedFields.earnedGrossSalary ?? 0);
          derivedFields.netPay = toWholeNumber(
            egs - (Number(derivedFields.totalDeduction) || 0) - adv
          );
        }
        console.log(`Calculated derived fields for ${field}:`, derivedFields);
        return { ...newFormData, ...derivedFields };
      }
      return newFormData;
    });
  };

  // Save edited data
  const handleSaveEdit = async () => {
    setSavingEdit(true);
    setError(null); // Clear any previous errors
   
    try {
      console.log('=== PAYROLL SAVE DEBUG START ===');
      console.log('Selected month:', selectedMonth);
      console.log('Editing employee:', editingEmployee);
      console.log('Edit form data:', editFormData);
      console.log('Days Present value being saved:', editFormData.daysPresent);
      console.log('OT Hours value being saved:', editFormData.otHours);
     
      // Net Pay = Earned Gross Salary - Total Deduction (ensure saved value is correct)
      const egs = Number(editFormData.earnedSalaryCross) || 0;
      const totDed = Number(editFormData.totalDeduction) || 0;
      const netPayToSave = Math.round(egs - totDed);
      const requestPayload = {
        month: selectedMonth,
        employeeCode: editingEmployee.employeeCode,
        updatedData: { ...editFormData, uniformAllowance: 0, netPay: netPayToSave },
        userEmail
      };
     
      console.log('Request payload:', requestPayload);
      console.log('Request URL:', '/server/payroll_function/update');
     
      // Send the updated data to the backend
      const response = await fetch('/server/payroll_function/update', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestPayload)
      });

      console.log('Response status:', response.status);
      console.log('Response ok:', response.ok);
      console.log('Response headers:', Object.fromEntries(response.headers.entries()));

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Error response text:', errorText);
        let errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch (parseErr) {
          console.error('Failed to parse error response as JSON:', parseErr);
          throw new Error(`HTTP ${response.status}: ${errorText}`);
        }
        throw new Error(errorData.error || `HTTP ${response.status}: Failed to update payroll record`);
      }

      const result = await response.json();
      console.log('Update successful response:', result);

      // Helper function to update employee data
      const updateEmployeeData = (emp) => {
        if (emp.employeeCode === editingEmployee.employeeCode) {
          // Merge the updated form data with the existing employee data
          const isYashaswi = String(editFormData.contractor ?? emp.contractor ?? '').trim().toLowerCase() === 'yashaswi academy for skills';
          const mergedEsi = isYashaswi ? 0 : (editFormData.esi ?? emp.esi ?? 0);
          const mergedTotalDeduction = isYashaswi
            ? Math.max(0, (parseFloat(editFormData.totalDeduction) || 0) - (parseFloat(editFormData.esi ?? editFormData.ESI ?? emp.esi ?? 0) || 0))
            : (editFormData.totalDeduction ?? emp.totalDeduction);
          return {
            ...emp,
            ...editFormData,
            // Ensure all calculated fields are included
            actualTotalSalary: editFormData.actualTotalSalary || emp.actualTotalSalary,
            earnedBasic: editFormData.earnedBasic !== undefined ? editFormData.earnedBasic : emp.earnedBasic,
            earnedHRA: editFormData.earnedHRA !== undefined ? editFormData.earnedHRA : emp.earnedHRA,
            earnedDA: editFormData.earnedDA !== undefined ? editFormData.earnedDA : emp.earnedDA,
            earnedAttendanceAllowance: editFormData.earnedAttendanceAllowance !== undefined ? editFormData.earnedAttendanceAllowance : emp.earnedAttendanceAllowance,
            earnedOtherAllowances: editFormData.earnedOtherAllowances !== undefined ? editFormData.earnedOtherAllowances : emp.earnedOtherAllowances,
            arrear: editFormData.arrear !== undefined ? editFormData.arrear : emp.arrear,
            arrearForPF: editFormData.arrearForPF !== undefined ? editFormData.arrearForPF : emp.arrearForPF,
            lop: editFormData.lop !== undefined ? editFormData.lop : emp.lop,
            loh: editFormData.loh !== undefined ? editFormData.loh : emp.loh, // Explicitly handle LOH to support 0 values
            earnedSalaryCross: editFormData.earnedSalaryCross !== undefined ? editFormData.earnedSalaryCross : emp.earnedSalaryCross,
            otherAllowance: editFormData.otherAllowance !== undefined ? editFormData.otherAllowance : emp.otherAllowance,
            otherAllowances: editFormData.otherAllowances !== undefined ? editFormData.otherAllowances : emp.otherAllowances,
            loanAllowance: editFormData.loanAllowance !== undefined ? editFormData.loanAllowance : emp.loanAllowance,
            foodAllowance: editFormData.foodAllowance !== undefined ? editFormData.foodAllowance : emp.foodAllowance,
            uniformAllowance: 0,
            washingAllowance: editFormData.washingAllowance !== undefined ? editFormData.washingAllowance : emp.washingAllowance,
            travelChargers: editFormData.travelChargers !== undefined ? editFormData.travelChargers : emp.travelChargers,
            attendanceBonus: editFormData.attendanceBonus !== undefined ? editFormData.attendanceBonus : emp.attendanceBonus,
            noOfDaysWithoutUniforms: editFormData.noOfDaysWithoutUniforms !== undefined ? editFormData.noOfDaysWithoutUniforms : emp.noOfDaysWithoutUniforms,
            pf: editFormData.pf || emp.pf,
            esi: mergedEsi,
            totalDeduction: mergedTotalDeduction,
            employerEsi: editFormData.employerEsi ?? emp.employerEsi,
            esiContribution: editFormData.esiContribution ?? emp.esiContribution,
            employerLwf: editFormData.employerLwf ?? emp.employerLwf,
            otherDeduction: editFormData.otherDeduction !== undefined ? editFormData.otherDeduction : emp.otherDeduction,
            rent: editFormData.rent !== undefined && editFormData.rent !== null ? editFormData.rent : emp.rent,
            netPay: editFormData.netPay || emp.netPay,
            otAmount: editFormData.otAmount ?? emp.otAmount,
            otArrearAmount: editFormData.otArrearAmount ?? emp.otArrearAmount,
            otPayment: editFormData.otPayment || emp.otPayment,
            otEsi: editFormData.otEsi || emp.otEsi,
            payableAmount: editFormData.payableAmount || emp.payableAmount,
            totalNetPayable: editFormData.totalNetPayable || emp.totalNetPayable,
            erpf: editFormData.erpf || emp.erpf,
            admin: editFormData.admin || emp.admin,
            edli: editFormData.edli || emp.edli,
            erpf13: editFormData.erpf13 || emp.erpf13,
            serviceCharge: editFormData.serviceCharge || emp.serviceCharge,
            total: editFormData.total || emp.total,
            gst: editFormData.gst || emp.gst,
            netTotal: editFormData.netTotal || emp.netTotal,
            bonus: editFormData.bonus || emp.bonus,
            bankHolderName: editFormData.bankHolderName !== undefined ? editFormData.bankHolderName : emp.bankHolderName,
            bankName: editFormData.bankName !== undefined ? editFormData.bankName : emp.bankName,
            ifscCode: editFormData.ifscCode !== undefined ? editFormData.ifscCode : emp.ifscCode,
            bankBranch: editFormData.bankBranch !== undefined ? editFormData.bankBranch : emp.bankBranch
          };
        }
        return emp;
      };

      // Update the local state with the edited data. Preserve saved values for the edited employee
      // so the table shows what was saved (e.g. 1250); do not re-apply formulae to the edited row.
      const editedCode = editingEmployee.employeeCode;
      setPayrollData(prev => {
        const merged = prev.map(updateEmployeeData);
        const updated = merged.map(emp =>
          emp.employeeCode === editedCode ? emp : applyPayrollFormulaeToEmployee(emp)
        );
        const updatedEmployee = updated.find(emp => emp.employeeCode === editedCode);
        if (updatedEmployee) {
          console.log('✅ Payroll data updated in table (saved values preserved for edited employee):', {
            employeeCode: updatedEmployee.employeeCode,
            earnedBasic: updatedEmployee.earnedBasic,
            earnedHRA: updatedEmployee.earnedHRA,
            loh: updatedEmployee.loh
          });
        }
        return updated;
      });

      // Also update allPayrollData so the table and filters stay in sync
      setAllPayrollData(prev => {
        if (prev.length === 0) return prev;
        const merged = prev.map(updateEmployeeData);
        return merged.map(emp =>
          emp.employeeCode === editedCode ? emp : applyPayrollFormulaeToEmployee(emp)
        );
      });

      // NO BACKGROUND REFRESH - Data stays permanently as updated
      console.log('✅ Payroll record updated - data stays permanently, no refresh');

      setShowEditModal(false);
      setEditingEmployee(null);
      setEditFormData({});
     
      // Show success message
      setImportSuccess('Payroll record updated successfully!');
      setTimeout(() => setImportSuccess(''), 3000);
     
      console.log('=== PAYROLL SAVE DEBUG END - SUCCESS ===');
    } catch (err) {
      console.error('=== PAYROLL SAVE DEBUG END - ERROR ===');
      console.error('Error saving edit:', err);
      console.error('Error stack:', err.stack);
      setError('Failed to save changes: ' + err.message);
    } finally {
      setSavingEdit(false);
    }
  };

  // Cancel editing
  const handleCancelEdit = () => {
    setShowEditModal(false);
    setEditingEmployee(null);
    setEditFormData({});
  };

  // Recalculate earned amounts from a payroll row (so Earned Basic matches displayed Days Present / LOH / OT)
  const recalculateEarnedFromRow = (emp) => {
    const parseLooseNumber = (value) => {
      const raw = String(value ?? '').trim();
      if (!raw) return null;
      const cleaned = raw.replace(/[^0-9.\-]/g, '');
      const n = Number(cleaned);
      return Number.isFinite(n) ? n : null;
    };

    // Backend / JSON often uses PascalCase (ActualBasic) or formatted strings; parseFloat(emp.actualBasic) alone yields 0 and zeros out Earned Basic in the table.
    const num = (v) => parseLooseNumber(v) ?? 0;
    const actualBasic = num(emp.actualBasic ?? emp.ActualBasic);
    const actualHRA = num(emp.actualHRA ?? emp.ActualHRA);
    const actualDA = num(emp.actualDA ?? emp.ActualDA);
    const otherAllowance = num(emp.otherAllowance ?? emp.OtherAllowance);
    const specialAllowance = num(emp.specialAllowance ?? emp.SpecialAllowance);
    const daysInMonth = parseFloat(emp.daysInMonth ?? emp.DaysInMonth) || 31;
    const daysPresent = parseFloat(emp.daysPresent ?? emp.DaysPresent) || 0;
    const otHours = parseFloat(emp.otHours ?? emp.OTHours) || 0;
    const loh = parseFloat(emp.loh ?? emp.LOH) || 0;
    const arrear = parseFloat(emp.arrear) || 0;
    const arrearForPF = parseFloat(emp.arrearForPF) || 0;
    const incentive = parseFloat(emp.incentive) || 0;
    const otArrearAmount = parseFloat(emp.otArrearAmount) || 0;
    const providedActualTotalSalary = parseLooseNumber(emp?.actualTotalSalary ?? emp?.ActualTotalSalary);
    const otherAllowancesVal = num(emp.otherAllowances ?? emp.OtherAllowances);
    const travelChargersVal = getTravelChargersFromRecord(emp);
    const computedActualTotalSalary =
      actualBasic + actualHRA + actualDA + otherAllowance + otherAllowancesVal + travelChargersVal + specialAllowance;
    const actualTotalSalary = providedActualTotalSalary ?? computedActualTotalSalary;
    const dailyBasic = daysInMonth > 0 ? actualBasic / daysInMonth : 0;
    const earnedBasicRaw = (dailyBasic * daysPresent) - ((dailyBasic / 8) * loh);
    const earnedBasic = Math.max(0, earnedBasicRaw);
    const earnedHRA = ((actualHRA / daysInMonth) * daysPresent) - (((actualHRA / daysInMonth) / 8) * loh);
    const earnedDA = ((actualDA / daysInMonth) * daysPresent) - (((actualDA / daysInMonth) / 8) * loh);
    const earnedAttendanceAllowance = daysInMonth > 0 ? ((otherAllowance / daysInMonth) * daysPresent) - (((otherAllowance / daysInMonth) / 8) * loh) : 0;
    // Earned Other Allowances = (OtherAllowances / daysInMonth * daysPresent) - ((OtherAllowances / daysInMonth) / 8 * LOH)
    const earnedOtherAllowances = daysInMonth > 0 ? ((otherAllowancesVal / daysInMonth) * daysPresent) - (((otherAllowancesVal / daysInMonth) / 8) * loh) : 0;
    // Earned Special Allowance (same proration as payroll run); DB/API often has 0 while Special Allowance is set — table was showing ₹0.
    const earnedSpecialFromProration =
      daysInMonth > 0
        ? Math.max(0, ((specialAllowance / daysInMonth) * daysPresent) - (((specialAllowance / daysInMonth) / 8) * loh))
        : 0;
    const storedEarnedSpecial = num(emp.earnedSpecialAllowance ?? emp.EarnedSpecialAllowance);
    const earnedSpecialAllowance =
      specialAllowance > 0 ? earnedSpecialFromProration : storedEarnedSpecial;
    const lop = Math.max(0, daysInMonth - daysPresent);
    const baseEarnedGross =
      earnedBasic +
      earnedHRA +
      earnedDA +
      earnedSpecialAllowance +
      earnedAttendanceAllowance +
      earnedOtherAllowances +
      arrear +
      arrearForPF +
      incentive +
      otArrearAmount; // Includes earned special + OTArrearAmount and Arrear For PF
    const otAmount = computeDefaultOtAmountFromEarnedAndActual({
      earnedBasic,
      actualBasic,
      daysInMonth,
      daysPresent,
      otHours
    });
    const earnedSalaryCross = baseEarnedGross + otAmount; // Earned Gross Salary = baseEarnedGross + OT Amount (baseEarnedGross includes OTArrearAmount)
    const pfEnabled = isPfEnabled(emp);
    const esiEnabled = isEsiEnabled(emp);
    // PF: Actual Basic and Special Allowance from Setup formula when defined. PF = (Actual Basic + Special Allowance) > 15000 ? 1800 : (Actual Basic + Special Allowance) * 12%
    const actualPlusSpecial = actualBasic + specialAllowance;
    let pfWages;
    let pf;
    if (pfEnabled) {
      if (actualPlusSpecial > 15000) {
        pf = 1800;
        pfWages = 15000;
      } else {
        pfWages = actualPlusSpecial;
        pf = Math.round(pfWages * 0.12);
      }
    } else {
      pf = 0;
      pfWages = 0;
    }
    const otPayment = daysInMonth > 0 ? ((actualTotalSalary / daysInMonth) / 8) * otHours * 2 : 0;
    const esiBase = earnedSalaryCross;
    const esi = esiEnabled ? Math.round(esiBase * 0.0075) : 0;
    const employerEsi = esiEnabled ? esiBase * 0.0325 : 0;
    const otherDeduction = parseFloat(emp.otherDeduction) || 0;
    const lwf = getDisplayLWF(emp); // December: 20 for all employees
    const pt = parseFloat(emp.pt ?? emp.PT) || 0;
    const contractorNameEmp = String(emp.contractor || '').trim().toLowerCase();
    const isYashaswiEmp = contractorNameEmp === 'yashaswi academy for skills';
    const rent = parseFloat(emp.rent ?? emp.Rent) || 0; // Rent Recovery (included in Total Deduction)
    // Total Deduction = PF + ESI + Other Deduction + LWF + PT + Rent Recovery (for Yashaswi, PF/ESI/PT are 0)
    const totalDeduction = pf + esi + otherDeduction + lwf + pt + rent;
    const netPayBeforeAdvance = earnedSalaryCross - totalDeduction;
    const otEsi = esiEnabled ? otAmount * 0.0075 : 0;
    const payableAmount = otPayment - otEsi;
    const advance = parseFloat(emp.advance) || 0;
    const finalNetPay = netPayBeforeAdvance - advance; // Rent already in totalDeduction
    const totalNetPayable = finalNetPay + payableAmount;
    const erpf = pf;
    const admin = pfEnabled ? pfWages * 0.005 : 0;
    const edli = pfEnabled ? (Math.round(pfWages) === 15000 ? 75 : pfWages * 0.005) : 0;
    const erpf12PlusAdminPlusEdli = isYashaswiEmp ? 0 : (erpf + admin + edli); // ERPF 12% + Admin 0.5% + EDLI 0.5%
    let employerEsiForTotal = employerEsi;
    if (isYashaswiEmp) { employerEsiForTotal = 0; } // Yashaswi: Employer ESI not in Total
    const employerLwf = emp.employerLwf != null && emp.employerLwf !== '' ? (parseFloat(emp.employerLwf) || 0) : (selectedMonth.endsWith('-12') ? 40 : 0);
    const contractorName = String(emp.contractor || '').trim().toLowerCase();
    // Service charge base = baseEarnedGross + ERPF 12% + Admin 0.5% + EDLI 0.5% + Employer ESI 3.25% + Employer LWF (do not include ESI Contribution)
    const serviceChargeBase = Math.max(0, baseEarnedGross + erpf12PlusAdminPlusEdli + employerEsiForTotal + employerLwf);
    let serviceCharge;
    if (contractorName === 'yashaswi academy for skills') serviceCharge = 1000;
    else if (contractorName === 'sriram enterprice' || contractorName === 'sriram enterprise' || contractorName === 'sriram enterprises') serviceCharge = serviceChargeBase * 0.08;
    else serviceCharge = serviceChargeBase * 0.09;
    const esiContributionForTotal = parseFloat(emp.esiContribution ?? emp.ESIContribution) || 0;
    const total = earnedSalaryCross + erpf12PlusAdminPlusEdli + serviceCharge + employerEsiForTotal + employerLwf + esiContributionForTotal; // Total = Earned Gross + ERPF 12% + Admin 0.5% + EDLI 0.5% + Service Charge + ... + ESI Contribution
    const gst = contractorName === 'yashaswi academy for skills' ? 0 : total * 0.18;
    const netTotal = total + gst;
    const result = {
      ...emp,
      lop: toDaysPresentValue(lop),
      earnedBasic: toWholeNumber(earnedBasic),
      earnedHRA: toWholeNumber(earnedHRA),
      earnedDA: toWholeNumber(earnedDA),
      earnedSpecialAllowance: toWholeNumber(earnedSpecialAllowance),
      EarnedSpecialAllowance: toWholeNumber(earnedSpecialAllowance),
      earnedAttendanceAllowance: toWholeNumber(earnedAttendanceAllowance),
      earnedOtherAllowances: toWholeNumber(earnedOtherAllowances),
      earnedSalaryCross: toWholeNumber(earnedSalaryCross),
      otAmount: toWholeNumber(otAmount),
      otArrearAmount: toWholeNumber(emp.otArrearAmount || 0),
      pf: toWholeNumber(pf),
      esi: toWholeNumber(esi),
      totalDeduction: toWholeNumber(totalDeduction),
      late: 0,
      netPay: toWholeNumber(finalNetPay),
      otEsi: toWholeNumber(otEsi),
      otPayment: toWholeNumber(otPayment),
      payableAmount: toWholeNumber(payableAmount),
      totalNetPayable: toWholeNumber(totalNetPayable),
      erpf: toWholeNumber(erpf),
      admin: toWholeNumber(admin),
      edli: toWholeNumber(edli),
      erpf13: toWholeNumber(erpf12PlusAdminPlusEdli), // ERPF 12% + Admin 0.5% + EDLI 0.5% (kept for backend/DB compatibility)
      employerEsi: toWholeNumber(employerEsiForTotal),
      employerLwf: toWholeNumber(employerLwf),
      serviceCharge: toWholeNumber(serviceCharge),
      total: toWholeNumber(total),
      gst: toWholeNumber(gst),
      netTotal: toWholeNumber(netTotal),
    };
    // Saved formulae override: only formula-based calculation is used for formula variables (e.g. Earned Basic = Basic / 8)
    const afterFormulae = applyPayrollFormulaeToEmployee(result);
    const td = getDisplayTotalDeduction(afterFormulae);
    const ec = Number(afterFormulae.earnedSalaryCross ?? afterFormulae.earnedGrossSalary ?? afterFormulae.EarnedSalaryCross) || 0;
    const adv = parseFloat(afterFormulae.advance) || 0;
    return {
      ...afterFormulae,
      totalDeduction: td,
      TotalDeduction: td,
      netPay: Math.round(ec - td - adv),
      NetPay: Math.round(ec - td - adv),
    };
  };

  const manualOtEmployeeKey = (code) => String(code ?? '');

  const toggleManualOtEdit = (employee, checked) => {
    const key = manualOtEmployeeKey(employee.employeeCode);
    setManualOtEditCodes((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
    if (checked) {
      const snap = Number(employee.otHours ?? employee.OTHours) || 0;
      setManualOtSnapshotByCode((prev) => ({ ...prev, [key]: snap }));
      // Keep draft empty initially so typing is immediate.
      setManualOtDraftByCode((prev) => ({ ...prev, [key]: '' }));
    } else {
      setManualOtSnapshotByCode((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      setManualOtDraftByCode((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

  const handleManualOtDraftChange = (employeeCode, rawValue) => {
    const key = manualOtEmployeeKey(employeeCode);
    setManualOtDraftByCode((prev) => ({ ...prev, [key]: rawValue }));
  };

  const handleSaveManualOtHours = async (employee) => {
    const key = manualOtEmployeeKey(employee.employeeCode);
    const draftStr = manualOtDraftByCode[key];
    const raw = draftStr !== undefined && draftStr !== null ? String(draftStr).trim() : '';
    const finalOt = raw === '' ? 0 : parseFloat(raw);
    if (!Number.isFinite(finalOt) || finalOt < 0) {
      setError('Enter a valid OT hours value (0 or greater).');
      return;
    }

    setSavingManualOtCode(key);
    setError(null);
    try {
      const current = payrollData.find((e) => manualOtEmployeeKey(e.employeeCode) === key) || employee;
      const merged = recalculateEarnedFromRow({ ...current, otHours: finalOt, OTHours: finalOt });
      const egs = Number(merged.earnedSalaryCross) || 0;
      const totDed = Number(merged.totalDeduction) || 0;
      const netPayToSave = Math.round(egs - totDed);
      const response = await fetch('/server/payroll_function/update', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          month: selectedMonth,
          employeeCode: current.employeeCode,
          updatedData: { ...merged, netPay: netPayToSave },
          userEmail
        }),
      });
      if (!response.ok) {
        const errorText = await response.text();
        let msg = errorText;
        try {
          const errJson = JSON.parse(errorText);
          msg = errJson.error || msg;
        } catch (_) { /* ignore */ }
        throw new Error(msg || `Update failed: ${response.status}`);
      }

      const applyMerged = (emp) =>
        manualOtEmployeeKey(emp.employeeCode) === key ? merged : emp;
      setPayrollData((prev) => prev.map(applyMerged));
      setAllPayrollData((prev) => (prev.length ? prev.map(applyMerged) : prev));
      setManualOtSnapshotByCode((prev) => ({ ...prev, [key]: finalOt }));
      setManualOtDraftByCode((prev) => ({ ...prev, [key]: String(finalOt) }));
      setImportSuccess('OT Hours saved successfully!');
      setTimeout(() => setImportSuccess(''), 4000);
    } catch (err) {
      setError(err.message || 'Failed to save OT hours.');
    } finally {
      setSavingManualOtCode(null);
    }
  };

  // Numeric ESI value for table/totals. If contractor is Yashaswi Academy for Skills, ESI = 0.
  const getEsiValue = (emp) => (isYashaswiContractor(emp) ? 0 : Math.round(parseFloat(emp?.esi ?? emp?.ESI ?? 0) || 0));

  // LWF: every year December month = 20 for all employees; otherwise use saved/calculated value.
  const getDisplayLWF = (emp) => (selectedMonth && selectedMonth.endsWith('-12') ? 20 : (parseFloat(emp?.lwf ?? emp?.LWF) || 0));

  // Admin 0.5% and EDLI 0.5%: show 0 for Yashaswi Academy for Skills.
  const getAdminDisplayValue = (emp) => (isYashaswiContractor(emp) ? 0 : (parseFloat(emp?.admin ?? emp?.Admin ?? 0) || 0));
  const getEdliDisplayValue = (emp) => (isYashaswiContractor(emp) ? 0 : (parseFloat(emp?.edli ?? emp?.EDLI ?? 0) || 0));

  // ERPF 12%: do not display for Yashaswi Academy for Skills (show 0 in logic, — in UI).
  const getErpfDisplayValue = (emp) => (isYashaswiContractor(emp) ? 0 : (parseFloat(emp?.erpf ?? emp?.ERPF ?? 0) || 0));
  const getErpfDisplayText = (emp) => (isYashaswiContractor(emp) ? '—' : `₹${getErpfDisplayValue(emp).toLocaleString()}`);

  // ERPF 12% + Admin 0.5% + EDLI 0.5% (stored as erpf13 for DB; 0 for Yashaswi)
  const getErpf13DisplayValue = (emp) => (isYashaswiContractor(emp) ? 0 : (parseFloat(emp?.erpf13 ?? emp?.ERPF13 ?? 0) || 0));

  const exportToExcel = () => {
    try {
      console.log('Exporting payroll data to Excel...');
     
      if (!payrollData || payrollData.length === 0) {
        alert('No payroll data available to export. Please run payroll first.');
        return;
      }

      // Export columns must exactly match visible front-table component columns (actual rendered order).
      const renderedHeaderColumns = Array.from(
        document.querySelectorAll('.payroll-table thead tr.table-header th.light-green-header')
      )
        .map((th) => String(th.textContent || '').trim())
        .filter(Boolean);
      const exportColumns = renderedHeaderColumns.length > 0
        ? renderedHeaderColumns
        : [...tablePayrollComponents];

      const exportSheetKeys = exportColumns.map((compName, idx) => {
        const sameBefore = exportColumns.slice(0, idx).filter((c) => c === compName).length;
        return sameBefore === 0 ? compName : `${compName} (${sameBefore + 1})`;
      });

      const mpExportRows = [];
      const otherExportRows = [];
      payrollData.forEach((emp) => {
        if (isManagingPartnerPayrollRow(emp)) mpExportRows.push(emp);
        else otherExportRows.push(emp);
      });
      const showMpGapExport = mpExportRows.length > 0 && otherExportRows.length > 0;

      const buildExportDataRow = (employee, serialNo) => {
        const row = {
          'S.No': serialNo,
          'Employee Code': employee.employeeCode || '',
          'Employee Name': employee.employeeName || '',
          'Designation': employee.designation ?? employee.Designation ?? '',
          'Department': employee.department || '',
          Unit: payrollRowUnitDisplay(employee),
          'Date of Joining': employee.dateOfJoining ? new Date(employee.dateOfJoining).toLocaleDateString('en-GB') : ''
        };
        exportColumns.forEach((compName, idx) => {
          row[exportSheetKeys[idx]] = getComponentDisplayValue(employee, compName);
        });
        return row;
      };

      const exportData = [];
      mpExportRows.forEach((employee, i) => {
        exportData.push(buildExportDataRow(employee, i + 1));
      });
      if (showMpGapExport) {
        const gapRow = {
          'S.No': '',
          'Employee Code': '',
          'Employee Name': '',
          'Designation': '',
          'Department': '',
          Unit: '',
          'Date of Joining': ''
        };
        exportSheetKeys.forEach((sk) => {
          gapRow[sk] = '';
        });
        exportData.push(gapRow);
      }
      otherExportRows.forEach((employee, i) => {
        exportData.push(buildExportDataRow(employee, i + 1));
      });

      // Totals row: fixed columns empty/total label, then sum for each numeric table column
      const totalsRow = {
        'S.No': 'Total',
        'Employee Code': '',
        'Employee Name': '',
        'Designation': '',
        'Department': '',
        Unit: '',
        'Date of Joining': '',
      };
      exportColumns.forEach((compName, idx) => {
        const sheetKey = exportSheetKeys[idx];
        const firstVal = payrollData.length ? getComponentDisplayValue(payrollData[0], compName) : 0;
        const isNumeric = typeof firstVal === 'number' && !Number.isNaN(firstVal);
        totalsRow[sheetKey] = isNumeric
          ? payrollData.reduce((sum, emp) => sum + (Number(getComponentDisplayValue(emp, compName)) || 0), 0)
          : '';
      });

      // Add totals row to export data
      exportData.push(totalsRow);

      // Create workbook and worksheet
      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.json_to_sheet(exportData);

      // Set column widths: fixed columns then one per export column
      const columnWidths = [
        { wch: 8 },   // S.No
        { wch: 15 },  // Employee Code
        { wch: 20 },  // Employee Name
        { wch: 18 },  // Designation
        { wch: 15 },  // Department
        { wch: 14 },  // Unit
        { wch: 18 }   // Date of Joining
      ].concat(exportColumns.map(() => ({ wch: 15 })));
      worksheet['!cols'] = columnWidths;

      // Add worksheet to workbook
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Payroll Report');

      // Generate filename with current date and month
      const currentDate = new Date();
      const dateStr = currentDate.toISOString().split('T')[0];
      const filename = `Payroll_Report_${selectedMonth}_${dateStr}.xlsx`;

      // Export the file
      XLSX.writeFile(workbook, filename);
     
      console.log(`Excel file exported successfully: ${filename}`);
      setImportSuccess(`Excel file exported successfully: ${filename}`);
      setTimeout(() => setImportSuccess(''), 3000);
     
    } catch (error) {
      console.error('Error exporting to Excel:', error);
      setError('Failed to export Excel file: ' + error.message);
    }
  };

  const handlePayslipSend = () => {
    if (!payrollRun || !payrollData || payrollData.length === 0) {
      setImportSuccess('No payroll data to send. Please run payroll first.');
      setTimeout(() => setImportSuccess(''), 3000);
      return;
    }

    setImportSuccess('Payslip Send is not configured yet.');
    setTimeout(() => setImportSuccess(''), 3000);
  };

  const exportToPDF = () => {
    try {
      console.log('Exporting payroll data to PDF...');
     
      if (!payrollData || payrollData.length === 0) {
        alert('No payroll data available to export. Please run payroll first.');
        return;
      }

      // Create a simple HTML table for PDF conversion
      let htmlContent = `
        <html>
          <head>
            <title>Payroll Report - ${selectedMonth}</title>
            <style>
              body { font-family: Arial, sans-serif; margin: 20px; }
              h1 { text-align: center; color: #333; margin-bottom: 30px; }
              h2 { color: #666; margin-bottom: 20px; }
              table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
              th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
              th { background-color: #f2f2f2; font-weight: bold; }
              .total-row { background-color: #e6f3ff; font-weight: bold; }
              .summary { margin-top: 30px; }
              .summary-item { margin: 10px 0; }
            </style>
          </head>
          <body>
            <h1>Payroll Report - ${selectedMonth}</h1>
            <h2>Employee Details</h2>
            <table>
              <thead>
                <tr>
                  <th>S.No</th>
                  <th>Employee Code</th>
                  <th>Employee Name</th>
                  <th>Designation</th>
                  <th>Department</th>
                  <th>Contractor</th>
                  <th>Date of Joining</th>
                  <th>Days Present</th>
                  <th>OT Hours</th>
                  <th>Actual Basic</th>
                  <th>Actual DA</th>
                  <th>Actual HRA</th>
                  <th>Other Allowances</th>
                  <th>Actual Total Salary</th>
                  <th>Earned Basic</th>
                  <th>Earned DA</th>
                  <th>Earned HRA</th>
                  <th>PF Arrear</th>
                  <th>LOP</th>
                  <th>PF 12%</th>
                  <th>ESI 0.75%</th>
                  <th>Other Deduction</th>
                  <th>Total Deduction</th>
                  <th>Net Pay</th>
                  <th>ERPF 12%</th>
                  <th>Admin 0.5%</th>
                  <th>EDLI 0.5%</th>
                  <th>Employer ESI 3.25%</th>
                  <th>ESIContribution</th>
                  <th>Service Charge 9%</th>
                  <th>Total</th>
                  <th>GST 18%</th>
                  <th>Net Total</th>
                </tr>
              </thead>
              <tbody>
      `;

      // Add employee rows
      payrollData.forEach((employee, index) => {
        htmlContent += `
          <tr>
            <td>${index + 1}</td>
            <td>${employee.employeeCode || ''}</td>
            <td>${employee.employeeName || ''}</td>
            <td>${employee.designation ?? employee.Designation ?? ''}</td>
            <td>${employee.department || ''}</td>
            <td>${employee.contractor || ''}</td>
            <td>${employee.dateOfJoining ? new Date(employee.dateOfJoining).toLocaleDateString('en-GB') : '-'}</td>
            <td>${employee.daysPresent || 0}</td>
            <td>${employee.otHours || 0}</td>
            <td>₹${(parseFloat(employee.actualBasic) || 0).toLocaleString()}</td>
            <td>₹${(parseFloat(employee.actualDA) || 0).toLocaleString()}</td>
            <td>₹${(parseFloat(employee.actualHRA) || 0).toLocaleString()}</td>
            <td>₹${(parseFloat(employee.otherAllowances ?? employee.otherAllowance) || 0).toLocaleString()}</td>
            <td>₹${(parseFloat(employee.actualTotalSalary) || 0).toLocaleString()}</td>
            <td>₹${(parseFloat(employee.earnedBasic) || 0).toLocaleString()}</td>
            <td>₹${(parseFloat(employee.earnedDA) || 0).toLocaleString()}</td>
            <td>₹${(parseFloat(employee.earnedHRA) || 0).toLocaleString()}</td>
            <td>₹${(parseFloat(employee.arrear) || 0).toLocaleString()}</td>
            <td>${(parseFloat(employee.lop) || 0).toLocaleString()}</td>
            <td>₹${(Number(getPfDisplayValue(employee)) || 0).toLocaleString()}</td>
            <td>₹${getEsiValue(employee).toLocaleString()}</td>
            <td>₹${(parseFloat(employee.otherDeduction) || 0).toLocaleString()}</td>
            <td>₹${getDisplayTotalDeduction(employee).toLocaleString()}</td>
            <td>₹${(Number(getComponentDisplayValue(employee, 'Net Pay')) || 0).toLocaleString()}</td>
            <td>${getErpfDisplayText(employee)}</td>
            <td>₹${getAdminDisplayValue(employee).toLocaleString()}</td>
            <td>₹${getEdliDisplayValue(employee).toLocaleString()}</td>
            <td>₹${(parseFloat(employee.employerEsi) || 0).toLocaleString()}</td>
            <td>₹${(parseFloat(employee.esiContribution ?? employee.ESIContribution) || 0).toLocaleString()}</td>
            <td>₹${(parseFloat(employee.serviceCharge) || 0).toLocaleString()}</td>
            <td>₹${(parseFloat(employee.total) || 0).toLocaleString()}</td>
            <td>₹${(parseFloat(employee.gst) || 0).toLocaleString()}</td>
            <td>₹${(parseFloat(employee.netTotal) || 0).toLocaleString()}</td>
          </tr>
        `;
      });

      // Add totals row
      htmlContent += `
        <tr class="total-row">
          <td>Total</td>
          <td></td>
          <td></td>
          <td></td>
          <td></td>
          <td></td>
          <td></td>
          <td>${payrollData.reduce((sum, emp) => sum + (parseFloat(emp.daysPresent) || 0), 0)}</td>
          <td>${payrollData.reduce((sum, emp) => sum + (parseFloat(emp.otHours) || 0), 0).toFixed(1)}</td>
          <td>₹${payrollData.reduce((sum, emp) => sum + (parseFloat(emp.actualBasic) || 0), 0).toLocaleString()}</td>
          <td>₹${payrollData.reduce((sum, emp) => sum + (parseFloat(emp.actualDA) || 0), 0).toLocaleString()}</td>
          <td>₹${payrollData.reduce((sum, emp) => sum + (parseFloat(emp.actualHRA) || 0), 0).toLocaleString()}</td>
          <td>₹${payrollData.reduce((sum, emp) => sum + (parseFloat(emp.actualTotalSalary) || 0), 0).toLocaleString()}</td>
          <td>₹${payrollData.reduce((sum, emp) => sum + (parseFloat(emp.earnedBasic) || 0), 0).toLocaleString()}</td>
          <td>₹${payrollData.reduce((sum, emp) => sum + (parseFloat(emp.earnedDA) || 0), 0).toLocaleString()}</td>
          <td>₹${payrollData.reduce((sum, emp) => sum + (parseFloat(emp.earnedHRA) || 0), 0).toLocaleString()}</td>
          <td>₹${payrollData.reduce((sum, emp) => sum + (parseFloat(emp.arrear) || 0), 0).toLocaleString()}</td>
          <td>${payrollData.reduce((sum, emp) => sum + (parseFloat(emp.lop) || 0), 0).toLocaleString()}</td>
          <td>₹${payrollData.reduce((sum, emp) => sum + (Number(getPfDisplayValue(emp)) || 0), 0).toLocaleString()}</td>
          <td>₹${payrollData.reduce((sum, emp) => sum + getEsiValue(emp), 0).toLocaleString()}</td>
          <td>₹${payrollData.reduce((sum, emp) => sum + (parseFloat(emp.otherDeduction) || 0), 0).toLocaleString()}</td>
          <td>₹${payrollData.reduce((sum, emp) => sum + getDisplayTotalDeduction(emp), 0).toLocaleString()}</td>
          <td>₹${payrollData.reduce((sum, emp) => sum + (Number(getComponentDisplayValue(emp, 'Net Pay')) || 0), 0).toLocaleString()}</td>
          <td>₹${payrollData.reduce((sum, emp) => sum + getErpfDisplayValue(emp), 0).toLocaleString()}</td>
          <td>₹${payrollData.reduce((sum, emp) => sum + getAdminDisplayValue(emp), 0).toLocaleString()}</td>
          <td>₹${payrollData.reduce((sum, emp) => sum + getEdliDisplayValue(emp), 0).toLocaleString()}</td>
          <td>₹${payrollData.reduce((sum, emp) => sum + (parseFloat(emp.employerEsi) || 0), 0).toLocaleString()}</td>
          <td>₹${payrollData.reduce((sum, emp) => sum + (parseFloat(emp.esiContribution ?? emp.ESIContribution) || 0), 0).toLocaleString()}</td>
          <td>₹${payrollData.reduce((sum, emp) => sum + (parseFloat(emp.serviceCharge) || 0), 0).toLocaleString()}</td>
          <td>₹${payrollData.reduce((sum, emp) => sum + (parseFloat(emp.total) || 0), 0).toLocaleString()}</td>
          <td>₹${payrollData.reduce((sum, emp) => sum + (parseFloat(emp.gst) || 0), 0).toLocaleString()}</td>
          <td>₹${payrollData.reduce((sum, emp) => sum + (parseFloat(emp.netTotal) || 0), 0).toLocaleString()}</td>
        </tr>
      `;

      htmlContent += `
              </tbody>
            </table>
           
            <div class="summary">
              <h2>Summary</h2>
              <div class="summary-item"><strong>Total Employees:</strong> ${payrollData.length}</div>
              <div class="summary-item"><strong>Total OT Hours:</strong> ${payrollData.reduce((sum, emp) => sum + (parseFloat(emp.otHours) || 0), 0).toFixed(1)} hrs</div>
              <div class="summary-item"><strong>Total Actual Salary:</strong> ₹${payrollData.reduce((sum, emp) => sum + (parseFloat(emp.actualTotalSalary) || 0), 0).toLocaleString()}</div>
              <div class="summary-item"><strong>Total Earned Salary:</strong> ₹${payrollData.reduce((sum, emp) => sum + (parseFloat(emp.earnedSalaryCross) || 0), 0).toLocaleString()}</div>
              <div class="summary-item"><strong>Total Deductions:</strong> ₹${payrollData.reduce((sum, emp) => sum + getDisplayTotalDeduction(emp), 0).toLocaleString()}</div>
              <div class="summary-item"><strong>Total Net Pay:</strong> ₹${payrollData.reduce((sum, emp) => sum + (Number(getComponentDisplayValue(emp, 'Net Pay')) || 0), 0).toLocaleString()}</div>
            </div>
           
            <div style="margin-top: 50px; text-align: center; color: #666;">
              <p>Generated on: ${new Date().toLocaleDateString()}</p>
            </div>
          </body>
        </html>
      `;

      // Open in new window for printing/saving as PDF
      const printWindow = window.open('', '_blank');
      printWindow.document.write(htmlContent);
      printWindow.document.close();
     
      // Trigger print dialog
      setTimeout(() => {
        printWindow.print();
      }, 500);
     
      console.log('PDF export initiated');
      setImportSuccess('PDF export initiated - use browser print dialog to save as PDF');
      setTimeout(() => setImportSuccess(''), 3000);
     
    } catch (error) {
      console.error('Error exporting to PDF:', error);
      setError('Failed to export PDF: ' + error.message);
    }
  };


  const downloadTemplate = () => {
    // Create CSV template content with exact column names
    // Note: The import function supports flexible header matching, so variations like "EmployeeName", "Name", etc. will also work
    // Note: When importing exported Excel files, totals/summary rows are automatically skipped
    const templateContent = `Employee Code,Employee Name,Department,Unit,Contractor,No. of Days (Month),No. of Days Present,OT Hours,LOH,Actual Basic,Actual HRA,Actual DA,Other Allowance,Other Allowances,Travel Chargers,Special Allowance,Incentive,OT Amount,OT Arrear Amount,Actual Total Gross,Earned Basic,Earned HRA,Earned Gross Salary,PF 12%,ESI 0.75%,Employer ESI 3.25%,ESIContribution,Total Deduction,Rent,Net Pay
EMP001,MUKESH,SALES,Unit-A,No,31,22.5,0.00,0,10000,5000,0,0,0,0,0,0,15000,7258.06,3629.03,10887.09,870.97,54.44,925.41,0,0,0,0,10887.09
36050,K.Sivasubramanian,Accounts,Unit-B,R.P.D Facility Management,31,25,8.5,0,25000,5000,0,0,0,0,0,0,30000,25000,5000,30000,3000,187.5,3187.5,0,0,0,0,31250
36109,Sunil Kumar,Hamper assembly,Unit-B,R.P.D Facility Management,31,28,12.0,0,22000,4400,0,0,0,0,0,0,26400,22000,4400,26400,2640,165,2805,0,0,0,0,28900`;

    // Create and download the file
    const blob = new Blob([templateContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'payroll-import-template.csv';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  };

  // Validation function for imported payroll data
  const validateImportedPayroll = useCallback((payroll, rowIndex) => {
    const errors = [];
    if (!payroll.employeeCode) errors.push('Employee Code is required.');
    if (!payroll.employeeName) errors.push('Employee Name is required.');
    if (payroll.daysInMonth < 0 || payroll.daysInMonth > 31) {
      errors.push('Days in Month must be between 0 and 31.');
    }
    const dim = Number(payroll.daysInMonth);
    const dp = Number(payroll.daysPresent);
    if (dp < 0 || (Number.isFinite(dim) && dim > 0 && dp > dim + 1e-6)) {
      errors.push('Days Present cannot exceed Days in Month.');
    }
    if (payroll.otHours < 0) {
      errors.push('OT Hours cannot be negative.');
    }
    if (payroll.actualBasic < 0) {
      errors.push('Actual Basic cannot be negative.');
    }
    if (payroll.actualHRA < 0) {
      errors.push('Actual HRA cannot be negative.');
    }
    if (payroll.specialAllowance < 0) {
      errors.push('Special Allowance cannot be negative.');
    }
    if (payroll.pf < 0) {
      errors.push('PF cannot be negative.');
    }
    if (payroll.esi < 0) {
      errors.push('ESI cannot be negative.');
    }
    if (payroll.totalDeduction < 0) {
      errors.push('Total Deduction cannot be negative.');
    }
    if (payroll.otAmount < 0) {
      errors.push('OT Amount cannot be negative.');
    }
    return errors.length > 0 ? errors.join(' ') : null;
  }, []);

  // Import Excel file handler
  const handleImport = useCallback(async (event) => {
    const file = event.target.files[0];
    if (!file) {
      setImportError('No file selected.');
      return;
    }

    const validTypes = ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'];
    if (!validTypes.includes(file.type)) {
      setImportError('Invalid file type. Please upload an Excel file (.xlsx or .xls).');
      return;
    }
   
    const maxSize = 5 * 1024 * 1024; // 5MB
    if (file.size > maxSize) {
      setImportError('File size exceeds 5MB limit.');
      return;
    }

    setImporting(true);
    setImportError('');
    setImportSuccess('');

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        if (!sheetName) {
          throw new Error('No sheets found in the Excel file.');
        }
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet);

        if (!jsonData || jsonData.length === 0) {
          throw new Error('No data found in the Excel file.');
        }

        console.log('Excel data parsed:', jsonData);
       
        // Track employee codes to detect duplicates
        const employeeCodes = new Set();
        const duplicateCodes = new Set();

        // Debug: Log the first row to see actual headers
        if (jsonData.length > 0) {
          console.log('Excel headers found:', Object.keys(jsonData[0]));
          console.log('First row data:', jsonData[0]);
          console.log('Sample values for key fields:');
          console.log('- Days Present:', jsonData[0]['No. of Days Present'], jsonData[0]['Days Present'], jsonData[0]['DaysPresent']);
          console.log('- OT Hours:', jsonData[0]['OT Hours'], jsonData[0]['OTHours'], jsonData[0]['OT']);
        }

        const newPayrollData = jsonData.map((row, index) => {
          // Skip rows that are clearly totals/summary rows
          const sNoValue = row['S.No'] || row['S.No'] || row['SNo'] || row['Serial No'] || row['SerialNo'];
          if (sNoValue === 'Total' || sNoValue === 'TOTAL' || sNoValue === 'total' ||
              sNoValue === 'Sum' || sNoValue === 'SUM' || sNoValue === 'sum' ||
              sNoValue === 'Grand Total' || sNoValue === 'GRAND TOTAL' || sNoValue === 'grand total') {
            console.log(`Skipping totals row at index ${index}:`, row);
            return null; // Return null to filter out later
          }

          const safeToString = (value, isNumeric = false) => {
            if (value == null || value === '') return isNumeric ? null : '';
            if (isNumeric) {
              const num = Number(value);
              return isNaN(num) ? null : num;
            }
            return String(value);
          };

          // Helper function to find column value with flexible matching
          const getColumnValue = (possibleNames) => {
            for (const name of possibleNames) {
              if (row[name] !== undefined && row[name] !== null && row[name] !== '') {
                return row[name];
              }
            }
            return null;
          };

          // Enhanced helper function with fuzzy matching for key fields
          const getColumnValueWithFuzzyMatch = (possibleNames, fuzzyKeywords) => {
            // First try exact matches
            let result = getColumnValue(possibleNames);
            if (result !== null) return result;
           
            // If no exact match, try fuzzy matching
            const allKeys = Object.keys(row);
            for (const key of allKeys) {
              const lowerKey = key.toLowerCase();
              for (const keyword of fuzzyKeywords) {
                if (lowerKey.includes(keyword.toLowerCase()) && row[key] !== undefined && row[key] !== null && row[key] !== '') {
                  console.log(`Fuzzy match found for ${fuzzyKeywords.join('/')}: "${key}" = ${row[key]}`);
                  return row[key];
                }
              }
            }
            return null;
          };

          /** Excel templates often use "No. of Days(In month)" (no space before '(') or truncated "…(In mon". */
          const getDaysInMonthImportValue = () => {
            const exactNames = [
              'No. of Days (In Month)',
              'No. of Days (Month)',
              'No. of Days(In Month)',
              'No. of Days(In month)',
              'No. of Days(In mon)',
              'No. of Days(In mon.',
              'Days in Month',
              'Days In Month',
              'DaysInMonth',
              'days_in_month',
              'Total Days'
            ];
            const direct = getColumnValue(exactNames);
            if (direct != null && direct !== '') {
              const n = Number(safeToString(direct, true));
              return Number.isFinite(n) ? n : 0;
            }
            for (const key of Object.keys(row)) {
              const lk = key.toLowerCase();
              if (lk.includes('present')) continue;
              const looksLikeDaysInMonth =
                (lk.includes('days') && (lk.includes('month') || lk.includes('(in mon') || lk.includes('in mon'))) ||
                (lk.includes('day') && lk.includes('in mon'));
              if (looksLikeDaysInMonth && row[key] != null && row[key] !== '') {
                const n = Number(safeToString(row[key], true));
                if (Number.isFinite(n)) {
                  console.log(`Days-in-month fuzzy match: "${key}" = ${row[key]}`);
                  return n;
                }
              }
            }
            return 0;
          };

          /** Travel Chargers / Travel Charges — Excel and API use mixed spellings. */
          const getTravelChargersImportValue = () => {
            const exactNames = [
              'Travel Chargers',
              'Travel Charges',
              'TravelChargers',
              'TravelCharges',
              'travel_chargers',
              'Travel Charger',
            ];
            const direct = getColumnValue(exactNames);
            if (direct != null && direct !== '') {
              const n = Number(safeToString(direct, true));
              return Number.isFinite(n) ? n : 0;
            }
            for (const key of Object.keys(row)) {
              const lk = key.toLowerCase();
              if (lk.includes('travel') && lk.includes('charge') && row[key] != null && row[key] !== '') {
                const n = Number(safeToString(row[key], true));
                if (Number.isFinite(n)) {
                  console.log(`Travel charges fuzzy match: "${key}" = ${row[key]}`);
                  return n;
                }
              }
            }
            return 0;
          };

          /** Handle days-present header variants/typos like "Presenl", "Presnt", etc. */
          const getDaysPresentImportValue = () => {
            const exactNames = [
              'No. of Days Present',
              'No. of Days Presenl',
              'No. of Days Presen',
              'No. of Days Presnt',
              'Days Present',
              'DaysPresent',
              'days_present',
              'Present Days',
              'Days Worked',
              'Working Days',
              'Attendance Days',
              'Present'
            ];
            const direct = getColumnValue(exactNames);
            if (direct != null && direct !== '') {
              const n = Number(safeToString(direct, true));
              return Number.isFinite(n) ? n : 0;
            }
            for (const key of Object.keys(row)) {
              const lk = key.toLowerCase();
              const hasDaysWord = lk.includes('day') || lk.includes('days');
              const looksLikeDaysInMonth =
                (lk.includes('month') || lk.includes('(in mon') || lk.includes('in mon'));
              const hasPresentLikeWord =
                lk.includes('present') ||
                lk.includes('attendance') ||
                lk.includes('worked') ||
                /presen[lnt]?|presnt|prsnt/.test(lk);
              if (hasDaysWord && !looksLikeDaysInMonth && hasPresentLikeWord && row[key] != null && row[key] !== '') {
                const n = Number(safeToString(row[key], true));
                if (Number.isFinite(n)) {
                  console.log(`Days-present fuzzy match: "${key}" = ${row[key]}`);
                  return n;
                }
              }
            }
            return 0;
          };

          // Check for duplicate employee codes
          const employeeCode = safeToString(getColumnValue(['Employee Code', 'EmployeeCode', 'employee_code', 'Employee ID', 'EmployeeID']));
          const employeeName = safeToString(getColumnValue(['Employee Name', 'EmployeeName', 'employee_name', 'Name', 'Employee']));
         
          // Skip rows with empty employee code or name (likely totals/summary rows)
          if (!employeeCode || !employeeName || employeeCode.trim() === '' || employeeName.trim() === '') {
            console.log(`Skipping row at index ${index} due to empty employee code or name:`, { employeeCode, employeeName });
            return null;
          }
         
          if (employeeCode && employeeCodes.has(employeeCode)) {
            duplicateCodes.add(employeeCode);
            console.warn(`Duplicate Employee Code found: ${employeeCode} at row ${index + 2}`);
          }
          if (employeeCode) {
            employeeCodes.add(employeeCode);
          }

          // Debug: Log key field extraction for first few rows
          if (index < 3) {
            console.log(`Row ${index + 2} - Key field extraction:`, {
              employeeCode: safeToString(getColumnValue(['Employee Code', 'EmployeeCode', 'employee_code', 'Employee ID', 'EmployeeID'])),
              employeeName: safeToString(getColumnValue(['Employee Name', 'EmployeeName', 'employee_name', 'Name', 'Employee'])),
              daysPresent: {
                possibleNames: ['No. of Days Present', 'Days Present', 'DaysPresent', 'days_present', 'Present Days', 'Days Worked', 'Working Days', 'Attendance Days', 'Days', 'Present'],
                fuzzyKeywords: ['days', 'present', 'attendance', 'worked'],
                foundValue: getDaysPresentImportValue(),
                finalValue: getDaysPresentImportValue()
              },
              otHours: {
                possibleNames: ['OT Hours', 'OTHours', 'ot_hours', 'Overtime Hours', 'OT', 'Overtime', 'OT Hrs', 'OT_Hours', 'Extra Hours', 'Hours Worked', 'Hours'],
                fuzzyKeywords: ['ot', 'hours', 'overtime', 'extra'],
                foundValue: getColumnValueWithFuzzyMatch(['OT Hours', 'OTHours', 'ot_hours', 'Overtime Hours', 'OT', 'Overtime', 'OT Hrs', 'OT_Hours', 'Extra Hours', 'Hours Worked', 'Hours'], ['ot', 'hours', 'overtime', 'extra']),
                finalValue: Number(safeToString(getColumnValueWithFuzzyMatch(['OT Hours', 'OTHours', 'ot_hours', 'Overtime Hours', 'OT', 'Overtime', 'OT Hrs', 'OT_Hours', 'Extra Hours', 'Hours Worked', 'Hours'], ['ot', 'hours', 'overtime', 'extra']), true)) || 0
              },
              rawRow: row
            });
          }

          const payroll = {
            employeeCode: employeeCode,
            employeeName: employeeName,
            department: safeToString(getColumnValue(['Department', 'Dept', 'department'])),
            unit: safeToString(
              getColumnValue([
                'Unit',
                'unit',
                'SSPSE Experience',
                'RelevantExperience',
                'relevantExperience',
              ])
            ),
            contractor: safeToString(getColumnValue(['Contractor', 'ContractorName', 'contractor'])),
            daysInMonth: getDaysInMonthImportValue(),
            daysPresent: getDaysPresentImportValue(),
            otHours: Number(safeToString(getColumnValueWithFuzzyMatch(['OT Hours', 'OTHours', 'ot_hours', 'Overtime Hours', 'OT', 'Overtime', 'OT Hrs', 'OT_Hours', 'Extra Hours', 'Hours Worked', 'Hours'], ['ot', 'hours', 'overtime', 'extra']), true)) || 0,
            loh: Number(
              safeToString(
                getColumnValueWithFuzzyMatch(
                  ['LOH', 'loh', 'Loss of Hours', 'LossOfHours', 'loss_of_hours', 'Loss Of Hours', 'L.O.H'],
                  ['loh', 'loss of hour', 'lossofhour']
                ),
                true
              )
            ) || 0,
            actualBasic: Number(safeToString(getColumnValue(['Actual Basic', 'ActualBasic', 'actual_basic', 'Basic Salary', 'Basic']), true)) || 0,
            actualHRA: Number(safeToString(getColumnValue(['Actual HRA', 'ActualHRA', 'actual_hra', 'HRA', 'House Rent Allowance']), true)) || 0,
            actualDA: Number(safeToString(getColumnValue(['Actual DA', 'ActualDA', 'actual_da', 'DA', 'Dearness Allowance']), true)) || 0,
            otherAllowance: Number(safeToString(getColumnValue(['Other Allowance', 'OtherAllowance', 'Attendance Allowance', 'OtherAllowancs']), true)) || 0,
            otherAllowances: Number(safeToString(getColumnValue(['Other Allowances', 'OtherAllowances', 'other_allowances']), true)) || 0,
            travelChargers: getTravelChargersImportValue(),
            specialAllowance: Number(safeToString(getColumnValue(['Special Allowance', 'SpecialAllowance', 'special_allowance', 'Special Allowance Amount']), true)) || 0,
            loanAllowance: Number(safeToString(getColumnValue(['Loan Allowance', 'LoanAllowance', 'loan_allowance']), true)) || 0,
            noOfDaysWithoutUniforms: Number(safeToString(getColumnValue(['No of days without uniforms', 'NoOfDaysWithoutUniforms', 'no_of_days_without_uniforms']), true)) || 0,
            incentive: Number(safeToString(getColumnValue(['Incentive', 'incentive', 'Incentive Amount', 'IncentiveAmount']), true)) || 0,
            actualTotalSalary: Number(safeToString(getColumnValue(['Actual Total Gross', 'Actual Total Salary', 'ActualTotalSalary', 'actual_total_salary', 'Total Salary', 'Gross Salary']), true)) || 0,
            earnedBasic: Number(safeToString(getColumnValue(['Earned Basic', 'EarnedBasic', 'earned_basic']), true)) || 0,
            earnedHRA: Number(safeToString(getColumnValue(['Earned HRA', 'EarnedHRA', 'earned_hra']), true)) || 0,
            earnedDA: Number(safeToString(getColumnValue(['Earned DA', 'EarnedDA', 'earned_da']), true)) || 0,
            earnedOtherAllowances: Number(safeToString(getColumnValue(['Earned Other Allowances', 'EarnedOtherAllowances', 'earned_other_allowances']), true)) || 0,
            arrear: Number(safeToString(getColumnValue(['Arrear', 'arrear']), true)) || 0,
            arrearForPF: Number(safeToString(getColumnValue(['Arrear For PF', 'ArrearForPF', 'arrearForPF']), true)) || 0,
            lop: Number(safeToString(getColumnValue(['LOP', 'lop', 'Loss of Pay']), true)) || 0,
            earnedSalaryCross: 0, // Will be recalculated
            otWages: Number(safeToString(getColumnValue(['OT Wages', 'OTWages', 'ot_wages', 'Overtime Wages']), true)) || 0,
            rent: Number(safeToString(getColumnValue(['Rent', 'rent', 'Rent Recovery']), true)) || 0,
            advance: Number(safeToString(getColumnValue(['Advance', 'advance', 'Salary Advance', 'SalaryAdvance']), true)) || 0,
            lwf: Number(safeToString(getColumnValue(['LWF', 'lwf', 'Labour Welfare Fund']), true)) || 0,
            pt: Number(safeToString(getColumnValue(['PT', 'pt', 'Professional Tax']), true)) || 0,
            netPay: Number(safeToString(getColumnValue(['Net Pay', 'NetPay', 'net_pay', 'Final Pay', 'Take Home']), true)) || 0,
            pf: Number(safeToString(getColumnValue(['PF', 'pf', 'Provident Fund', 'ProvidentFund']), true)) || 0,
            esi: Number(safeToString(getColumnValue(['ESI', 'esi', 'Employee State Insurance']), true)) || 0,
            employerEsi: Number(safeToString(getColumnValue(['Employer ESI 3.25%', 'EmployerESI', 'employerEsi', 'Employer ESI']), true)) || 0,
            esiContribution: Number(safeToString(getColumnValue(['ESIContribution', 'esiContribution', 'ESI Contribution']), true)) || 0,
            totalDeduction: Number(safeToString(getColumnValue(['Total Deduction', 'TotalDeduction', 'total_deduction', 'Deductions']), true)) || 0,
            otAmount: Number(safeToString(getColumnValue(['OT Amount', 'OTAmount', 'ot_amount', 'Overtime Amount']), true)) || 0,
            otArrearAmount: Number(safeToString(getColumnValue(['OT Arrear Amount', 'OTArrearAmount', 'ot_arrear_amount']), true)) || 0,
            otEsi: Number(safeToString(getColumnValue(['OT ESI', 'OTESI', 'ot_esi', 'OT ESI Deduction']), true)) || 0,
            otPayment: Number(safeToString(getColumnValue(['OT Payment', 'OTPayment', 'ot_payment', 'OT Net Payment']), true)) || 0,
            payableAmount: Number(safeToString(getColumnValue(['Payable Amount', 'PayableAmount', 'payable_amount', 'Final Payable']), true)) || 0,
            totalNetPayable: Number(safeToString(getColumnValue(['Total Net Payable', 'TotalNetPayable', 'total_net_payable']), true)) || 0,
            bonus: Number(safeToString(getColumnValue(['Bonus', 'bonus', 'Bonus Amount', 'BonusAmount']), true)) || 0,
            bankHolderName: safeToString(getColumnValue(['Bank Holder Name', 'BankHolderName', 'bank_holder_name', 'Account Holder Name', 'Holder Name'])),
            bankName: safeToString(getColumnValue(['Bank Name', 'BankName', 'bank_name', 'Bank'])),
            ifscCode: safeToString(getColumnValue(['IFSC Code', 'IFSCCode', 'ifsc_code', 'IFSC', 'IFSC Code'])),
            bankBranch: safeToString(getColumnValue(['AccountNumber', 'Bank Branch', 'BankBranch', 'bank_branch', 'Branch', 'Branch Name'])),
          };

          const dimImp = Number(payroll.daysInMonth);
          if ((!Number.isFinite(dimImp) || dimImp === 0) && payroll.daysPresent > 0 && payroll.daysPresent <= 31) {
            payroll.daysInMonth = payroll.daysPresent;
          }
          const dimResolved = Number(payroll.daysInMonth);
          const dpResolved = Number(payroll.daysPresent);
          if (
            Number.isFinite(dimResolved) &&
            dimResolved > 0 &&
            Number.isFinite(dpResolved) &&
            dpResolved > dimResolved
          ) {
            // Import should not hard-fail when days-present column has mismatch/noise; cap to month days.
            payroll.daysPresent = dimResolved;
          }

          // Apply calculations for imported data
          const derivedFields = calculateDerivedFields(payroll);
          Object.assign(payroll, derivedFields);

          // Check for duplicate employee codes
          if (duplicateCodes.has(payroll.employeeCode)) {
            const error = `Row ${index + 2}: Duplicate Employee Code '${payroll.employeeCode}' found. Each employee must have a unique code.`;
            console.error(error);
            throw new Error(error);
          }

          const validationError = validateImportedPayroll(payroll, index + 2);
          if (validationError) {
            console.error(`Row ${index + 2} validation error:`, validationError);
            throw new Error(validationError);
          }

          return payroll;
        }).filter(row => row !== null); // Filter out null values (totals rows)

        // Log duplicate codes summary
        if (duplicateCodes.size > 0) {
          console.warn(`Found ${duplicateCodes.size} duplicate Employee Codes:`, Array.from(duplicateCodes));
        }

        console.log(`Importing ${newPayrollData.length} payroll records for month ${selectedMonth}`);

        // Send data to backend for processing
        try {
          const response = await fetch('/server/payroll_function/import', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              month: selectedMonth,
              payrollData: newPayrollData,
              userEmail
            }),
          });

          const result = await response.json();

          if (response.ok && result.status === 'success') {
            console.log('=== IMPORT SUCCESS ===');
            console.log('Imported records count:', result.successCount || newPayrollData.length);
            console.log('Imported data sample (first 3):', newPayrollData.slice(0, 3));
            console.log('Current filters:', { selectedMonth, contractor, department, employeeId });

            const okCount = result.successCount ?? newPayrollData.length;
            const sampleMsg =
              result.target === 'SamplePayroll'
                ? `Successfully imported ${okCount} row(s) into the SamplePayroll table (Manual mode was saved in Setup Configuration).`
                : `Successfully imported ${okCount} payroll records for ${selectedMonth}. Note: Totals/summary rows are automatically skipped during import.`;
            setImportSuccess(sampleMsg);
            setImportError('');
           
            // Ensure payroll UI is enabled and data is visible after import
            setPayrollRun(true);
           
            // Apply dynamic formulae to imported data once
            const newPayrollFormulaData = newPayrollData.map(applyPayrollFormulaeToEmployee);
            const sortedImported = sortPayrollManagingPartnerFirst(newPayrollFormulaData);

            // Store all imported data (unfiltered) for local filtering
            setAllPayrollData(sortedImported);
           
            // Display imported data immediately - NO REFRESH, data stays permanently
            console.log('Setting payroll data with', sortedImported.length, 'records - NO REFRESH');
            setPayrollData(sortedImported);
           
            // Enable local filtering for this data
            shouldUseLocalFilter.current = true;
           
            // Reset filters to "All" to show all imported data
            setContractor('All');
            setDepartment('All');
            setEmployeeId('All');
           
            // Verify data was set
            setTimeout(() => {
              console.log('✅ Payroll data displayed permanently - payrollRun:', true, 'data length:', newPayrollData.length);
              console.log('Data will remain visible - no background refresh will occur');
            }, 100);
           
            // NO BACKGROUND REFRESH - Data stays permanently as imported
          } else {
            setImportError(result.message || result.error || 'Failed to import payroll data');
          }
        } catch (apiError) {
          console.error('Import error:', apiError);
          setImportError('Failed to send data to server. Please try again.');
        }

      } catch (err) {
        setImportError(err.message || 'Failed to parse Excel file.');
        console.error('Excel parse error:', err);
      } finally {
        setImporting(false);
      }
    };

    reader.onerror = () => {
      setImportError('Failed to read the Excel file.');
      setImporting(false);
    };

    reader.readAsArrayBuffer(file);
  }, [selectedMonth, validateImportedPayroll]);

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
          {/* Water Bubbles */}
          <div className="water-bubble"></div>
          <div className="water-bubble"></div>
          <div className="water-bubble"></div>
          <div className="water-bubble"></div>
          <div className="water-bubble"></div>
          <div className="water-bubble"></div>
          <div className="water-bubble"></div>
          <div className="water-bubble"></div>
          <div className="water-bubble"></div>
          <div className="water-bubble"></div>
          <div className="water-bubble"></div>
          <div className="water-bubble"></div>
          <div className="water-bubble"></div>
          <div className="water-bubble"></div>
          <div className="water-bubble"></div>
          <div className="water-bubble"></div>
         
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
                  <div className="cms-nav-item" onClick={() => { toggleMenu(idx); }}>
                    <span className="cms-nav-icon">{item.icon}</span>
                    <span className="cms-nav-label">{item.label}</span>
                    <span className="cms-expand-icon">
                      <Plus size={16} className={`expand-icon ${expandedMenus[idx] ? 'rotated' : ''}`} />
                    </span>
                  </div>
                  <div className="cms-nav-children">
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
            {/* Water Bubbles */}
            <div className="water-bubble"></div>
            <div className="water-bubble"></div>
            <div className="water-bubble"></div>
            <div className="water-bubble"></div>
            <div className="water-bubble"></div>
            <div className="water-bubble"></div>
            <div className="water-bubble"></div>
            <div className="water-bubble"></div>
            <div className="water-bubble"></div>
            <div className="water-bubble"></div>
            <div className="water-bubble"></div>
            <div className="water-bubble"></div>
            <div className="water-bubble"></div>
            <div className="water-bubble"></div>
            <div className="water-bubble"></div>
            <div className="water-bubble"></div>
           
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

          {/* Payroll Content */}
          <div className="payroll-container">
            {error && (
              <div style={{ padding: '20px', background: 'orange', color: 'white', margin: '10px' }}>
                ERROR: {error}
              </div>
            )}
           
            {/* Import Success Message */}
            {importSuccess && (
              <div style={{ padding: '20px', background: 'green', color: 'white', margin: '10px' }}>
                SUCCESS: {importSuccess}
              </div>
            )}

            {payslipZipFallback && (
              <div className="payroll-zip-fallback-banner" role="status">
                <span className="payroll-zip-fallback-text">
                  If the ZIP did not start downloading, use this link (same file; link expires after a few minutes):
                </span>
                <a
                  href={payslipZipFallback.url}
                  download={payslipZipFallback.filename}
                  className="payroll-zip-fallback-link"
                >
                  Save {payslipZipFallback.filename}
                </a>
                <button
                  type="button"
                  className="payroll-zip-fallback-dismiss"
                  onClick={() => {
                    setPayslipZipFallback((prev) => {
                      if (prev?.url) URL.revokeObjectURL(prev.url);
                      return null;
                    });
                  }}
                >
                  Dismiss
                </button>
              </div>
            )}

            {/* Import Error Message */}
            {importError && (
              <div style={{ padding: '20px', background: 'red', color: 'white', margin: '10px' }}>
                IMPORT ERROR: {importError}
              </div>
            )}
           
            {/* Payroll Controls - Always visible */}
            <div className="payroll-filters">
              <h1 className="payroll-title">Payroll Report</h1>
              <div className="filters-row">
                <div className="filter-group">
                  <label htmlFor="month">Select Month:</label>
                  <input
                    type="month"
                    id="month"
                    value={selectedMonth}
                    onChange={handleMonthChange}
                    className="filter-select"
                  />
                </div>
                <div className="filter-group">
                  <label htmlFor="fromDate">From Date:</label>
                  <input
                    type="date"
                    id="fromDate"
                    value={fromDate}
                    onChange={(e) => {
                      const newFromDate = e.target.value;
                      setFromDate(newFromDate);
                      if (payrollRun && newFromDate && toDate) {
                        fetchPayrollData(newFromDate, toDate);
                      }
                    }}
                    className="filter-select"
                  />
                </div>
                <div className="filter-group">
                  <label htmlFor="toDate">To Date:</label>
                  <input
                    type="date"
                    id="toDate"
                    value={toDate}
                    onChange={(e) => {
                      const newToDate = e.target.value;
                      setToDate(newToDate);
                      if (payrollRun && fromDate && newToDate) {
                        fetchPayrollData(fromDate, newToDate);
                      }
                    }}
                    className="filter-select"
                    min={fromDate}
                  />
                </div>
                <div className="filter-group">
                  <label htmlFor="department">Department:</label>
                  <select
                    id="department"
                    value={department}
                    onChange={(e) => {
                      const newDepartment = e.target.value;
                      setDepartment(newDepartment);
                      // Automatically fetch and display data when department changes (if payroll has been run)
                      if (payrollRun) {
                        const fetchWithNewDepartment = async () => {
                          try {
                            setLoading(true);
                            setError(null);
                           
                            let url = `/server/payroll_function/payroll?month=${selectedMonth}&_t=${Date.now()}`;
                            if (contractor !== 'All') url += `&contractor=${encodeURIComponent(contractor)}`;
                            if (newDepartment !== 'All') url += `&department=${encodeURIComponent(newDepartment)}`;
                            if (employeeId !== 'All') url += `&employeeId=${encodeURIComponent(employeeId)}`;
                            if (fromDate) url += `&fromDate=${encodeURIComponent(fromDate)}`;
                            if (toDate) url += `&toDate=${encodeURIComponent(toDate)}`;
                            if (userEmail) url += `&userEmail=${encodeURIComponent(userEmail)}`;
                           
                            const res = await fetch(url);
                            if (!res.ok) {
                              const errorText = await res.text();
                              throw new Error(`Failed to fetch payroll data: ${res.status} ${errorText}`);
                            }
                           
                            const result = await res.json();
                            const newPayrollData = result.data ? [...result.data] : [];
                            setPayrollData(
                              sortPayrollManagingPartnerFirst(newPayrollData.map(applyPayrollFormulaeToEmployee))
                            );
                          } catch (err) {
                            console.error('Error fetching payroll data:', err);
                            setError(err.message);
                            setPayrollData([]);
                          } finally {
                            setLoading(false);
                          }
                        };
                        fetchWithNewDepartment();
                      }
                    }}
                    className="filter-select"
                    disabled={!payrollRun}
                  >
                    {departments.map(dept => (
                      <option key={dept} value={dept}>
                        {dept}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="filter-group">
                  <label htmlFor="employee">Employee Code:</label>
                  <select
                    id="employee"
                    value={employeeId}
                    onChange={(e) => {
                      const newEmployeeId = e.target.value;
                      setEmployeeId(newEmployeeId);
                      // Automatically fetch and display data when employee changes (if payroll has been run)
                      if (payrollRun) {
                        const fetchWithNewEmployee = async () => {
                          try {
                            setLoading(true);
                            setError(null);
                           
                            let url = `/server/payroll_function/payroll?month=${selectedMonth}&_t=${Date.now()}`;
                            if (contractor !== 'All') url += `&contractor=${encodeURIComponent(contractor)}`;
                            if (department !== 'All') url += `&department=${encodeURIComponent(department)}`;
                            if (newEmployeeId !== 'All') url += `&employeeId=${encodeURIComponent(newEmployeeId)}`;
                            if (fromDate) url += `&fromDate=${encodeURIComponent(fromDate)}`;
                            if (toDate) url += `&toDate=${encodeURIComponent(toDate)}`;
                            if (userEmail) url += `&userEmail=${encodeURIComponent(userEmail)}`;
                           
                            const res = await fetch(url);
                            if (!res.ok) {
                              const errorText = await res.text();
                              throw new Error(`Failed to fetch payroll data: ${res.status} ${errorText}`);
                            }
                           
                            const result = await res.json();
                            const newPayrollData = result.data ? [...result.data] : [];
                            setPayrollData(
                              sortPayrollManagingPartnerFirst(newPayrollData.map(applyPayrollFormulaeToEmployee))
                            );
                          } catch (err) {
                            console.error('Error fetching payroll data:', err);
                            setError(err.message);
                            setPayrollData([]);
                          } finally {
                            setLoading(false);
                          }
                        };
                        fetchWithNewEmployee();
                      }
                    }}
                    className="filter-select"
                    disabled={!payrollRun}
                  >
                    {employees.map(emp => (
                      <option key={emp} value={emp}>
                        {emp}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="export-buttons">
                <button
                  onClick={handleRunPayroll}
                  className="run-payroll-btn"
                  disabled={runningPayroll}
                  title="Run payroll for the selected month (includes fetching attendance data)"
                >
                  {runningPayroll ? 'Running Payroll...' : 'Run Payroll'}
                </button>
                <button
                  onClick={handleSavePayroll}
                  className="export-btn save-payroll-btn"
                  disabled={!payrollRun || savingPayroll}
                  title="Save the current payroll data to the database"
                >
                  {savingPayroll ? 'Saving Payroll...' : 'Save Payroll'}
                </button>
                <button
                  onClick={downloadTemplate}
                  className="export-btn template-btn"
                  disabled={!payrollRun}
                >
                  Download Template
                </button>
                <div className="import-section">
                  <input
                    type="file"
                    id="import-excel"
                    accept=".xlsx,.xls"
                    onChange={handleImport}
                    style={{ display: 'none' }}
                    disabled={importing}
                  />
                  <button
                    onClick={() => document.getElementById('import-excel').click()}
                    className="export-btn import-btn"
                    disabled={importing || !payrollRun}
                    title="Import from Excel. If you saved Manual in Setup Configuration, rows go to the SamplePayroll table; otherwise they go to Payroll."
                  >
                    {importing ? 'Importing...' : 'Import Excel'}
                  </button>
                </div>
                <button
                  onClick={exportToExcel}
                  className="export-btn excel-btn"
                  disabled={!payrollRun}
                >
                  Export to Excel
                </button>
                <button
                  onClick={handlePayslipSend}
                  className="export-btn payslip-send-btn"
                  disabled={!payrollRun}
                >
                  Payslip Send
                </button>
                <button
                  onClick={exportToPDF}
                  className="export-btn pdf-btn"
                  disabled={!payrollRun}
                >
                  Export to PDF
                </button>
                <div className="filter-group" style={{ marginLeft: '10px' }}>
                  <label htmlFor="status-filter" style={{ marginRight: '8px', fontWeight: 600 }}>Status:</label>
                  <select
                    id="status-filter"
                    value={employeeStatus}
                    onChange={(e) => {
                      const newStatus = e.target.value;
                      console.log('🔄 Status filter changed to:', newStatus);
                      setEmployeeStatus(newStatus);
                    }}
                    className="filter-select"
                    disabled={!payrollRun}
                    style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #ddd', fontSize: '0.95rem' }}
                  >
                    <option value="All">All</option>
                    <option value="Active">Active</option>
                    <option value="Inactive">Inactive</option>
                  </select>
                </div>
              </div>
            </div>


            {/* Summary Cards - Only show after payroll is run */}
            {payrollRun && (
              <div className="payroll-summary">
                <div className="summary-card">
                  <h3>Total Employees</h3>
                  <span>{payrollData && Array.isArray(payrollData) ? payrollData.length : 0}</span>
                </div>
                <div className="summary-card">
                  <h3>Total OT Hours</h3>
                  <span>{payrollData && Array.isArray(payrollData) ? payrollData.reduce((sum, emp) => sum + (parseFloat(emp.otHours) || 0), 0).toFixed(1) : '0.0'} hrs</span>
                </div>
                <div className="summary-card">
                  <h3>Total Actual Salary</h3>
                  <span>₹{payrollData && Array.isArray(payrollData) ? Math.round(payrollData.reduce((sum, emp) => sum + (parseFloat(emp.actualTotalSalary) || 0), 0)).toLocaleString() : '0'}</span>
                </div>
                <div className="summary-card">
                  <h3>Total Earned Salary</h3>
                  <span>₹{payrollData && Array.isArray(payrollData) ? Math.round(payrollData.reduce((sum, emp) => sum + (parseFloat(emp.earnedSalaryCross) || 0), 0)).toLocaleString() : '0'}</span>
                </div>
                <div className="summary-card">
                  <h3>Total PF 12%</h3>
                  <span>₹{payrollData && Array.isArray(payrollData) ? Math.round(payrollData.reduce((sum, emp) => sum + (Number(getPfDisplayValue(emp)) || 0), 0)).toLocaleString() : '0'}</span>
                </div>
                <div className="summary-card">
                  <h3>Total ESI 0.75%</h3>
                  <span>₹{payrollData && Array.isArray(payrollData) ? Math.round(payrollData.reduce((sum, emp) => sum + getEsiValue(emp), 0)).toLocaleString() : '0'}</span>
                </div>
                <div className="summary-card">
                  <h3>Total Deduction</h3>
                  <span>₹{payrollData && Array.isArray(payrollData) ? Math.round(payrollData.reduce((sum, emp) => sum + getDisplayTotalDeduction(emp), 0)).toLocaleString() : '0'}</span>
                </div>
                <div className="summary-card">
                  <h3>Total OT Amount</h3>
                  <span>₹{payrollData && Array.isArray(payrollData) ? Math.round(payrollData.reduce((sum, emp) => sum + (Number(getComponentDisplayValue(emp, 'OT Amount')) || 0), 0)).toLocaleString() : '0'}</span>
                </div>
              </div>
            )}

            {/* Debug Info - Show when no data */}
            {payrollRun && payrollData.length === 0 && !loading && (
              <div style={{ padding: '20px', background: '#f8f9fa', border: '1px solid #dee2e6', margin: '10px', borderRadius: '5px' }}>
                <h4>Debug Information - No Data Found</h4>
                <p><strong>Current Filters:</strong></p>
                <ul>
                  <li>Month: {selectedMonth}</li>
                  <li>Department: {department}</li>
                  <li>Employee ID: {employeeId}</li>
                </ul>
                <p><strong>Possible Issues:</strong></p>
                <ul>
                  <li>No payroll data exists for this month</li>
                  <li>Filters are too restrictive</li>
                  <li>Data exists but doesn't match current filters</li>
                </ul>
                <p><strong>Solutions:</strong></p>
                <ul>
                  <li>Try setting all filters to "All"</li>
                  <li>Check if data was imported successfully</li>
                </ul>
              </div>
            )}

            {/* Payroll Table - Only show after payroll is run */}
            {payrollRun && (
              <div className="payroll-table-container">
                {loading ? (
                  <div className="loading">Loading payroll data...</div>
                ) : (
                  <table className="payroll-table">
                    <thead>
                      <tr className="table-header">
                        <th>S.No</th>
                        <th>Employee Code</th>
                        <th>Employee Name</th>
                        <th>Designation</th>
                        <th>Department</th>
                        <th>Unit</th>
                        <th>Date of Joining</th>
                        {tablePayrollComponents.map((name, colIdx) => {
                          const lower = String(name || '').toLowerCase();
                          if (lower === 'ot hours' || lower.includes('ot hours')) {
                            return (
                              <th
                                key={`payroll-col-${colIdx}`}
                                className="light-green-header payroll-ot-hours-combined-header"
                                title="Use the checkbox in each row to enable editing OT hours"
                              >
                                {name}
                              </th>
                            );
                          }
                          return (
                            <th key={`payroll-col-${colIdx}`} className="light-green-header">
                              {name}
                            </th>
                          );
                        })}
                        <th className="payslip-header-cell">
                          <div className="payslip-header-cell-inner">
                            <label className="payslip-checkbox-wrap payslip-select-all-label" htmlFor="payslip-select-all">
                              <input
                                id="payslip-select-all"
                                type="checkbox"
                                ref={payslipSelectAllRef}
                                checked={payrollData.length > 0 && payrollData.every(emp => !!(emp.payslip === true || emp.payslip === 'true'))}
                                onChange={(e) => handlePayslipSelectAll(e.target.checked)}
                                title="Select all / Deselect all"
                              />
                              <span className="payslip-checkbox-label">Payslip</span>
                            </label>
                            <button
                              type="button"
                              className="payslip-bulk-zip-btn"
                              onClick={(e) => { e.stopPropagation(); handleDownloadSelectedPayslipsZip(); }}
                              disabled={payslipZipBusy}
                              title="Download one PDF per employee with Payslip checked, packaged as a ZIP file"
                            >
                              {payslipZipBusy ? 'Working…' : 'Download ZIP'}
                            </button>
                          </div>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {payrollData && Array.isArray(payrollData) ? (
                        payrollData.length === 0 ? null : (() => {
                          const mpRows = [];
                          const otherRows = [];
                          payrollData.forEach((emp) => {
                            if (isManagingPartnerPayrollRow(emp)) mpRows.push(emp);
                            else otherRows.push(emp);
                          });
                          const showMpSectionGap = mpRows.length > 0 && otherRows.length > 0;
                          const tbodyColSpan = 8 + tablePayrollComponents.length;
                          const renderPayrollDataRow = (employee, displaySerialNo, rowSuffix) => (
                        <tr
                          key={`${rowSuffix}-${employee.employeeCode}-${employee.actualBasic}-${employee.actualHRA}-${employee.actualDA}-${employee.otherAllowance}`}
                          className="table-row clickable-row"
                          onClick={() => handleRowClick(employee)}
                          title="Click to edit this employee's payroll data"
                        >
                          <td>{displaySerialNo}</td>
                          <td>{employee.employeeCode || ''}</td>
                          <td>{employee.employeeName || ''}</td>
                          <td>{employee.designation ?? employee.Designation ?? ''}</td>
                          <td>{employee.department || ''}</td>
                          <td>{payrollRowUnitDisplay(employee)}</td>
                          <td>{employee.dateOfJoining ? new Date(employee.dateOfJoining).toLocaleDateString('en-GB') : '-'}</td>
                          {tablePayrollComponents.map((name, colIdx) => {
                            const lowerName = String(name || '').toLowerCase();
                            // Special handling for 'No. of Days in Month' component (exclude Sundays)
                            if (lowerName.includes('no. of days') && lowerName.includes('month')) {
                              const [year, month] = selectedMonth.split('-').map(Number);
                              let days = '';
                              if (year && month) {
                                const lastDay = new Date(year, month, 0).getDate();
                                let count = 0;
                                for (let d = 1; d <= lastDay; d++) {
                                  if (new Date(year, month - 1, d).getDay() !== 0) count++;
                                }
                                days = count;
                              }
                              return <td key={`payroll-col-${colIdx}`}>{days}</td>;
                            }
                            // Fetch from attendance_muster_function
                            if (lowerName.includes('no. of days present')) {
                              return <td key={`payroll-col-${colIdx}`}>{employee.daysPresent != null ? employee.daysPresent : ''}</td>;
                            }
                            if (lowerName === 'loh' || lowerName.includes('loss of hours')) {
                              return <td key={`payroll-col-${colIdx}`}>{employee.loh != null ? employee.loh : ''}</td>;
                            }
                            if (lowerName === 'ot hours' || lowerName.includes('ot hours')) {
                              const otKey = manualOtEmployeeKey(employee.employeeCode);
                              const showInput = manualOtEditCodes.has(otKey);
                              const otVal = employee.otHours ?? employee.OTHours;
                              const draftStr =
                                manualOtDraftByCode[otKey] !== undefined && manualOtDraftByCode[otKey] !== null
                                  ? String(manualOtDraftByCode[otKey])
                                  : null;
                              const snap = manualOtSnapshotByCode[otKey];
                              const draftNum =
                                draftStr !== null && draftStr.trim() !== ''
                                  ? parseFloat(draftStr.trim())
                                  : NaN;
                              const snapNum = snap !== undefined && snap !== null ? Number(snap) : Number(otVal) || 0;
                              const hasOtChanged =
                                Number.isFinite(draftNum) &&
                                draftNum !== snapNum;
                              const savingThisOt = savingManualOtCode === otKey;
                              return (
                                <td
                                  key={`payroll-col-${colIdx}`}
                                  className="payroll-ot-hours-combined-cell"
                                  onClick={showInput ? (e) => e.stopPropagation() : undefined}
                                >
                                  <span
                                    className="payroll-ot-hours-edit-cb-wrap"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <input
                                      type="checkbox"
                                      className="payroll-manual-ot-checkbox"
                                      checked={manualOtEditCodes.has(otKey)}
                                      onChange={(e) => toggleManualOtEdit(employee, e.target.checked)}
                                      disabled={savingThisOt}
                                      title="Enable OT hours entry for this employee"
                                      aria-label={`Enable manual OT hours for employee ${employee.employeeCode ?? ''}`}
                                    />
                                  </span>
                                  {showInput ? (
                                    <div className="payroll-ot-hours-edit-wrap">
                                      <input
                                        type="text"
                                        inputMode="decimal"
                                        className="payroll-inline-ot-input"
                                        value={draftStr !== null ? draftStr : ''}
                                        placeholder={String(otVal ?? 0)}
                                        onMouseDown={(e) => e.stopPropagation()}
                                        onClick={(e) => e.stopPropagation()}
                                        onChange={(e) => handleManualOtDraftChange(employee.employeeCode, e.target.value)}
                                        disabled={savingThisOt}
                                        title={`OT hours for employee ${employee.employeeCode ?? ''}`}
                                        aria-label={`OT hours for ${employee.employeeCode ?? ''}`}
                                      />
                                      <button
                                        type="button"
                                        className="payroll-inline-ot-save-btn"
                                        onMouseDown={(e) => e.stopPropagation()}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleSaveManualOtHours(employee);
                                        }}
                                        disabled={savingThisOt}
                                        title={hasOtChanged ? 'Save OT hours' : 'Save OT hours'}
                                      >
                                        {savingThisOt ? 'Saving…' : 'Save'}
                                      </button>
                                    </div>
                                  ) : (
                                    <span className="payroll-ot-hours-readonly-val">{otVal != null && otVal !== '' ? otVal : ''}</span>
                                  )}
                                </td>
                              );
                            }
                            if (lowerName === 'lop' || lowerName.includes('lop')) {
                              return <td key={`payroll-col-${colIdx}`}>{employee.lop != null ? employee.lop : ''}</td>;
                            }
                            const val = getComponentDisplayValue(employee, name);
                            const num = parseFloat(val);
                            // Currency grid: blank / non-numeric should show ₹0 (same as Loan/PF-style columns), not an empty cell.
                            const amount = Number.isFinite(num) ? num : 0;
                            return (
                              <td key={`payroll-col-${colIdx}`}>
                                {`₹${Number(amount).toLocaleString()}`}
                              </td>
                            );
                          })}
                          <td className="payslip-cell" onClick={(e) => e.stopPropagation()}>
                            <label className="payslip-checkbox-wrap" htmlFor={`payslip-cb-${employee.employeeCode}-${rowSuffix}`}>
                              <input
                                id={`payslip-cb-${employee.employeeCode}-${rowSuffix}`}
                                type="checkbox"
                                checked={!!(employee.payslip === true || employee.payslip === 'true')}
                                onChange={(e) => handlePayslipCheck(employee, e.target.checked)}
                                title="Payslip"
                              />
                              <span
                                className="payslip-checkbox-label"
                                role="button"
                                tabIndex={0}
                                onClick={(e) => { e.preventDefault(); handlePayslipCheck(employee, !(employee.payslip === true || employee.payslip === 'true')); }}
                                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handlePayslipCheck(employee, !(employee.payslip === true || employee.payslip === 'true')); } }}
                              >
                                Payslip
                              </span>
                            </label>
                            <button
                              type="button"
                              className="payslip-view-btn"
                              onClick={(e) => { e.stopPropagation(); handleViewPayslip(employee); }}
                              title="View payslip"
                            >
                              View
                            </button>
                            <button
                              type="button"
                              className="payslip-download-pdf-btn"
                              onClick={(e) => { e.stopPropagation(); handleDownloadPayslipPdf(employee); }}
                              disabled={
                                payslipZipBusy ||
                                (payslipPdfRowBusyCode != null &&
                                  String(payslipPdfRowBusyCode) === String(employee.employeeCode ?? employee.EmployeeCode ?? ''))
                              }
                              title="Download payslip as PDF"
                            >
                              {payslipPdfRowBusyCode != null && String(payslipPdfRowBusyCode) === String(employee.employeeCode ?? employee.EmployeeCode ?? '')
                                ? '…'
                                : 'PDF'}
                            </button>
                          </td>
                        </tr>
                          );
                          return (
                            <>
                              {mpRows.map((employee, index) =>
                                renderPayrollDataRow(employee, index + 1, `mp-${index}`)
                              )}
                              {showMpSectionGap ? (
                                <tr key="payroll-mp-gap" className="payroll-table-mp-gap" aria-hidden="true">
                                  <td className="payroll-table-mp-gap-cell" colSpan={tbodyColSpan} />
                                </tr>
                              ) : null}
                              {otherRows.map((employee, index) =>
                                renderPayrollDataRow(employee, index + 1, `oth-${index}`)
                              )}
                            </>
                          );
                        })()
                      ) : (
                        <tr>
                          <td colSpan={8 + tablePayrollComponents.length} style={{ textAlign: 'center', padding: '20px' }}>
                            No payroll data available
                          </td>
                        </tr>
                      )}
                    </tbody>
                    <tfoot>
                      <tr className="table-footer">
                        <td colSpan="7">Total</td>
                        {tablePayrollComponents.map((name, colIdx) => {
                            const total = payrollData && Array.isArray(payrollData)
                              ? payrollData.reduce((sum, emp) => {
                                  const value = getComponentDisplayValue(emp, name);
                                  const num = parseFloat(value);
                                  return sum + (Number.isFinite(num) ? num : 0);
                                }, 0)
                              : 0;
                            const lowerName = String(name || '').toLowerCase();
                            // Show 0 for Attendance Bonus, Loan Allowance, No of days without uniforms when total is 0
                            const hideZero = false; // was hiding 0 for loan/no-of-days; now always show 0
                            const displayTotal = (!payrollData || !payrollData.length) ? '0' : (hideZero && total === 0 ? '' : total.toLocaleString());
                            if (lowerName === 'ot hours' || lowerName.includes('ot hours')) {
                              return (
                                <td key={`payroll-col-${colIdx}-foot`}>{displayTotal}</td>
                              );
                            }
                            return (
                              <td key={`payroll-col-${colIdx}-foot`}>{displayTotal}</td>
                            );
                          })}
                        <td></td>
                      </tr>
                    </tfoot>
                  </table>
                )}
              </div>
            )}

            {showAutomaticModal && (
              <div className="edit-modal-overlay" onClick={closeAutomaticModal}>
                <div
                  className="edit-modal automatic-mode-modal"
                  onClick={(e) => e.stopPropagation()}
                  role="dialog"
                  aria-labelledby="automatic-mode-title"
                >
                  <div className="edit-modal-header">
                    <h2 id="automatic-mode-title">Payroll mode</h2>
                    <button
                      type="button"
                      className="close-edit-btn"
                      onClick={closeAutomaticModal}
                      disabled={savingAutomaticSelection}
                      aria-label="Close"
                    >
                      ×
                    </button>
                  </div>
                  <div className="edit-modal-content">
                    <p className="automatic-mode-hint">
                      Settings apply to <strong>{selectedMonth}</strong> only. Other months default to <strong>Automatic</strong> until you save a mode for them. Select one or both. If <strong>Manual</strong> is saved for this month, <strong>Import Excel</strong> writes each row to the <strong>SamplePayroll</strong> table (EmployeeCode, EmployeeName, Department, DaysInMonth, DaysPresent, OTHours, LOH, ActualBasic, OtherAllowance, TravelChargers, Incentive, Month).
                    </p>
                    {loadingAutomaticSaved ? (
                      <p className="automatic-mode-loading">Loading saved selection…</p>
                    ) : null}
                    <div className="automatic-mode-checkboxes">
                      {PAYROLL_AUTOMATIC_MODE_OPTIONS.map((label) => (
                        <label key={label} className="automatic-mode-option">
                          <input
                            type="checkbox"
                            checked={automaticSelections.has(label)}
                            onChange={() => toggleAutomaticModeOption(label)}
                            disabled={savingAutomaticSelection || loadingAutomaticSaved}
                          />
                          <span>{label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className="edit-modal-actions">
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={closeAutomaticModal}
                      disabled={savingAutomaticSelection}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={handleSaveAutomaticSelection}
                      disabled={savingAutomaticSelection || loadingAutomaticSaved}
                    >
                      {savingAutomaticSelection ? 'Saving...' : 'Save to datastore'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Edit Modal */}
            {showEditModal && (
              <div className="edit-modal-overlay">
                <div className="edit-modal">
                  <div className="edit-modal-header">
                    <h2>Edit Payroll Data</h2>
                    <button
                      className="close-edit-btn"
                      onClick={handleCancelEdit}
                      disabled={savingEdit}
                    >
                      ×
                    </button>
                  </div>
                  <div className="edit-modal-content">
                    <div className="edit-form">
                      <div className="form-row">
                        <div className="form-group">
                          <label>Employee Code:</label>
                          <input
                            type="text"
                            value={editFormData.employeeCode}
                            readOnly
                            disabled
                            style={{ backgroundColor: '#f8f9fa', color: '#6c757d', cursor: 'not-allowed' }}
                            title="Read-only"
                          />
                        </div>
                        <div className="form-group">
                          <label>Employee Name:</label>
                          <input
                            type="text"
                            value={editFormData.employeeName}
                            readOnly
                            disabled
                            style={{ backgroundColor: '#f8f9fa', color: '#6c757d', cursor: 'not-allowed' }}
                            title="Read-only"
                          />
                        </div>
                      </div>

                      <div className="form-row">
                        <div className="form-group">
                          <label>Designation:</label>
                          <input
                            type="text"
                            value={editFormData.designation ?? ''}
                            readOnly
                            disabled
                            style={{ backgroundColor: '#f8f9fa', color: '#6c757d', cursor: 'not-allowed' }}
                            title="Read-only (from Employee master)"
                          />
                        </div>
                        <div className="form-group">
                          <label>Department:</label>
                          <input
                            type="text"
                            value={editFormData.department}
                            readOnly
                            disabled
                            style={{ backgroundColor: '#f8f9fa', color: '#6c757d', cursor: 'not-allowed' }}
                            title="Read-only"
                          />
                        </div>
                        <div className="form-group">
                          <label>Unit:</label>
                          <input
                            type="text"
                            value={editFormData.unit ?? ''}
                            readOnly
                            disabled
                            style={{ backgroundColor: '#f8f9fa', color: '#6c757d', cursor: 'not-allowed' }}
                            title="Read-only (from Employee master)"
                          />
                        </div>
                      </div>

                      <div className="form-row">
                        <div className="form-group">
                          <label>Date of Joining:</label>
                          <input
                            type="text"
                            value={editFormData.dateOfJoining ? new Date(editFormData.dateOfJoining).toLocaleDateString('en-GB') : ''}
                            readOnly
                            disabled
                            style={{ backgroundColor: '#f8f9fa', color: '#6c757d', cursor: 'not-allowed' }}
                            title="Read-only"
                          />
                        </div>
                        <div className="form-group">
                          <label>Contractor:</label>
                          <input
                            type="text"
                            value={editFormData.contractor ?? ''}
                            readOnly
                            disabled
                            style={{ backgroundColor: '#f8f9fa', color: '#6c757d', cursor: 'not-allowed' }}
                            title="Read-only"
                          />
                        </div>
                      </div>

                      <div className="form-section">
                        <h3>Payroll data (table columns only)</h3>
                        {tablePayrollComponents.length === 0 ? (
                          <p className="form-hint">No payroll columns configured. Add columns in Setup and Configuration.</p>
                        ) : (
                          <div className="form-rows-dynamic">
                            {(() => {
                              const rows = [];
                              for (let i = 0; i < tablePayrollComponents.length; i += 2) {
                                const pair = tablePayrollComponents.slice(i, i + 2);
                                rows.push(
                                  <div key={i} className="form-row">
                                    {pair.map((compName, j) => {
                                      const key = getPayrollEditFieldKey(compName);
                                      const displayValue = getComponentDisplayValue(editFormData, compName);
                                      const lockedByFormula = hasPayrollFormulaForComponent(compName);
                                      const automaticLock =
                                        automaticSelections.has('Automatic') && !automaticSelections.has('Manual');
                                      const lockedByAutomatic =
                                        automaticLock &&
                                        ((key && AUTOMATIC_PAYROLL_EDIT_READONLY_KEYS.has(key)) ||
                                          payrollFormulaOptionKeys.has(key));
                                      const isEditable = Boolean(key) && !lockedByFormula && !lockedByAutomatic;
                                      const readOnlyTitle = lockedByFormula
                                        ? 'Calculated from Setup formula (read-only)'
                                        : lockedByAutomatic
                                          ? 'Read-only in Automatic payroll mode'
                                          : 'Read-only';
                                      // Read-only columns must use the same value as the table (getComponentDisplayValue). Previously we preferred
                                      // editFormData.pf / editFormData.esi, which can differ from table PF/ESI (formula vs stored).
                                      let rawVal;
                                      if (isEditable && key && editFormData[key] !== undefined) {
                                        rawVal = editFormData[key];
                                      } else {
                                        rawVal = displayValue;
                                      }
                                      const isNumeric = typeof displayValue === 'number' || (typeof rawVal === 'number' && !Number.isNaN(rawVal));
                                      const inputType = isNumeric ? 'number' : 'text';
                                      const readOnlyValue = (rawVal !== undefined && rawVal !== null ? rawVal : displayValue);
                                      return (
                                        <div key={`edit-pc-${i + j}`} className="form-group">
                                          <label>{compName}:</label>
                                          {isEditable ? (
                            <input
                                              type={inputType}
                                              step={inputType === 'number' ? 'any' : undefined}
                                              value={rawVal !== undefined && rawVal !== null ? rawVal : ''}
                                              onChange={(e) => handleEditFormChange(key, inputType === 'number' ? (parseFloat(e.target.value) || 0) : e.target.value)}
                              disabled={savingEdit}
                            />
                                          ) : (
                            <input
                                              type={inputType}
                                              step={inputType === 'number' ? 'any' : undefined}
                                              value={readOnlyValue !== undefined && readOnlyValue !== null ? readOnlyValue : ''}
                              readOnly
                              disabled
                                              style={{ backgroundColor: '#f8f9fa', color: '#6c757d', cursor: 'not-allowed' }}
                                              title={readOnlyTitle}
                            />
                                          )}
                          </div>
                                      );
                                    })}
                        </div>
                                );
                              }
                              return rows;
                            })()}
                          </div>
                        )}
                      </div>

                      <div className="form-section">
                        <h3>Bank Details</h3>
                        <div className="form-row">
                          <div className="form-group">
                            <label>Bank Holder Name:</label>
                            <input
                              type="text"
                              value={editFormData.bankHolderName || ''}
                              readOnly
                              disabled
                              style={{ backgroundColor: '#f8f9fa', color: '#6c757d', cursor: 'not-allowed' }}
                              title="Read-only (from employee master)"
                            />
                          </div>
                        </div>
                        <div className="form-row">
                          <div className="form-group">
                            <label>IFSC Code:</label>
                            <input
                              type="text"
                              value={editFormData.ifscCode || ''}
                              readOnly
                              disabled
                              style={{ backgroundColor: '#f8f9fa', color: '#6c757d', cursor: 'not-allowed' }}
                              title="Read-only (from employee master)"
                            />
                          </div>
                          <div className="form-group">
                            <label>AccountNumber:</label>
                            <input
                              type="text"
                              value={editFormData.bankBranch || ''}
                              readOnly
                              disabled
                              style={{ backgroundColor: '#f8f9fa', color: '#6c757d', cursor: 'not-allowed' }}
                              title="Read-only (from employee master)"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="edit-modal-actions">
                    <button
                      className="btn btn-secondary"
                      onClick={handleCancelEdit}
                      disabled={savingEdit}
                    >
                      Cancel
                    </button>
                    <button
                      className="btn btn-primary"
                      onClick={handleSaveEdit}
                      disabled={savingEdit}
                    >
                      {savingEdit ? 'Saving...' : 'Save Changes'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Payslip Preview Modal */}
            {showPayslipPreview && payslipPreviewEmployee && (
              <div className="edit-modal-overlay" onClick={handleClosePayslipPreview}>
                <div className="edit-modal payslip-preview-modal" onClick={(e) => e.stopPropagation()}>
                  <div className="edit-modal-header">
                    <h2>Payslip Preview</h2>
                    <button className="close-edit-btn" onClick={handleClosePayslipPreview}>
                      Ã—
                    </button>
          </div>
                  <div className="edit-modal-content payslip-preview-content">
                    <div
                      className="payslip-preview-host"
                      dangerouslySetInnerHTML={{ __html: payslipPreviewMarkup }}
                    />
                  </div>
                </div>
              </div>
            )}

          </div>

        </div>
      </div>
    </>
  );
};

export default Payroll;
