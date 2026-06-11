import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import './App.css';
import './BankFormatReport.css';
import './Attendancemuster.css';
import './employeeManagement.css';
import './Candidateform.css';
import './ESIReport.css';
import HeaderBranding from './HeaderBranding';
import Button from './Button';
import { Plus, Bell, Download } from 'lucide-react';
import { getSidebarModulesForUser, resolveSidebarUserEmail } from './modulesConfig';
import * as XLSX from 'xlsx';

function useQuery() {
  const { search } = useLocation();
  return useMemo(() => new URLSearchParams(search), [search]);
}

function formatEsiAmount(val) {
  if (val === null || val === undefined || val === '') return '-';
  const n = Number(val);
  if (!Number.isFinite(n)) return '-';
  return n.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function getEsiWageBase(row) {
  const status = String(row.esiStatus ?? row.ESIStatus ?? '').trim().toLowerCase();
  if (status === 'no') return null;
  const contractor = String(row.contractor ?? row.Contractor ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  if (contractor === 'yashaswi academy for skills') return null;
  const earnedBasic = Number(row.earnedBasic ?? row.EarnedBasic ?? 0) || 0;
  const otAmount = Number(row.otAmount ?? row.OTAmount ?? 0) || 0;
  const incentive = Number(row.incentive ?? row.Incentive ?? 0) || 0;
  const base = earnedBasic + otAmount + incentive;
  if (base <= 0) return null;
  return base;
}

/** ESI = (Earned Basic + OT Amount + Incentive) * 0.75% — same rule as Payroll grid. */
function computeEsiAmount(row) {
  const base = getEsiWageBase(row);
  if (base === null) return 0;
  return Math.round(base * 0.0075);
}

/** Employer ESI = (Earned Basic + OT Amount + Incentive) * 3.25% */
function computeEmployerEsiAmount(row) {
  const base = getEsiWageBase(row);
  if (base === null) return 0;
  return Math.round(base * 0.0325);
}

function resolveEsiAmount(row) {
  return computeEsiAmount(row);
}

function buildEsiStatusMap(employees) {
  const map = {};
  for (const emp of employees || []) {
    const code = String(emp.employeeCode ?? emp.EmployeeCode ?? '').trim();
    if (!code) continue;
    const status = String(emp.esiStatus ?? emp.ESIStatus ?? '').trim().toLowerCase();
    map[code] = status;
    if (/^\d+$/.test(code)) map[String(parseInt(code, 10))] = status;
  }
  return map;
}

function lookupEsiStatus(map, employeeCode) {
  const code = String(employeeCode ?? '').trim();
  if (!code) return '';
  if (map[code] !== undefined) return map[code];
  if (/^\d+$/.test(code) && map[String(parseInt(code, 10))] !== undefined) {
    return map[String(parseInt(code, 10))];
  }
  return '';
}

function ESIReport() {
  const query = useQuery();
  const navigate = useNavigate();
  const location = useLocation();
  const [month, setMonth] = useState(query.get('month') || new Date().toISOString().slice(0, 7));
  const [department, setDepartment] = useState('All');
  const [employeeId, setEmployeeId] = useState('All');
  const [search, setSearch] = useState('');
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expandedMenus, setExpandedMenus] = useState({});
  const [showSidebarMenu, setShowSidebarMenu] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const userEmail = localStorage.getItem('userEmail') || null;
  const userRole = localStorage.getItem('userRole') || 'App Administrator';

  const modulesToShow = useMemo(
    () => getSidebarModulesForUser(resolveSidebarUserEmail(userEmail), userRole),
    [userEmail, userRole]
  );

  const toggleMenu = (index) => {
    setExpandedMenus((prev) => ({ ...prev, [index]: !prev[index] }));
  };

  useEffect(() => {
    const payrollIndex = modulesToShow.findIndex((module) => module.label === 'Payroll');
    if (payrollIndex !== -1) {
      setExpandedMenus((prev) => ({ ...prev, [payrollIndex]: true }));
    }
  }, [location.pathname, modulesToShow]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (month) params.set('month', month);
    if (department !== 'All') params.set('department', department);
    if (employeeId !== 'All') params.set('employeeId', employeeId);
    if (userEmail) params.set('userEmail', userEmail);
    navigate({ pathname: '/esi-report', search: params.toString() }, { replace: true });
  }, [month, department, employeeId, userEmail, navigate]);

  const fetchReport = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const params = new URLSearchParams({ month });
      if (department !== 'All') params.set('department', department);
      if (employeeId !== 'All') params.set('employeeId', employeeId);
      if (userEmail) params.set('userEmail', userEmail);
      const empParams = new URLSearchParams();
      if (userEmail) empParams.set('userEmail', userEmail);
      const [res, empRes] = await Promise.all([
        fetch(`/server/payroll_function/report?${params.toString()}`),
        fetch(`/server/cms_function/employees?${empParams.toString()}`),
      ]);
      const result = await res.json();
      if (!res.ok || result.error) throw new Error(result.error || `HTTP ${res.status}`);
      let esiStatusMap = {};
      try {
        const empJson = await empRes.json();
        const employees = empJson?.data?.employees ?? empJson?.employees ?? [];
        esiStatusMap = buildEsiStatusMap(employees);
      } catch {
        esiStatusMap = {};
      }
      const rows = (Array.isArray(result.data) ? result.data : []).map((row) => {
        const code = row.employeeCode ?? row.EmployeeCode;
        const esiStatus =
          row.esiStatus ?? row.ESIStatus ?? lookupEsiStatus(esiStatusMap, code) ?? '';
        return { ...row, esiStatus };
      });
      rows.sort((a, b) =>
        String(a.employeeCode ?? '').localeCompare(String(b.employeeCode ?? ''), undefined, { numeric: true })
      );
      setData(rows);
    } catch (e) {
      setError(e.message);
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [month, department, employeeId, userEmail]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  const normalizedRows = useMemo(
    () =>
      data.map((row, index) => {
        const esiNum = resolveEsiAmount(row);
        const employerEsiNum = computeEmployerEsiAmount(row);
        const totalEsiNum = esiNum + employerEsiNum;
        return {
          sno: index + 1,
          employeeCode: row.employeeCode ?? row.EmployeeCode ?? '-',
          employeeName: row.employeeName ?? row.EmployeeName ?? '-',
          esi: formatEsiAmount(esiNum),
          esiNum,
          employerEsi: formatEsiAmount(employerEsiNum),
          employerEsiNum,
          totalEsi: formatEsiAmount(totalEsiNum),
          totalEsiNum,
        };
      }),
    [data]
  );

  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return normalizedRows;
    return normalizedRows.filter((row) =>
      [row.employeeCode, row.employeeName, row.esi, row.employerEsi, row.totalEsi]
        .join(' ')
        .toLowerCase()
        .includes(term)
    );
  }, [normalizedRows, search]);

  const totalEsi = useMemo(
    () => filteredRows.reduce((acc, row) => acc + (Number(row.esiNum) || 0), 0),
    [filteredRows]
  );

  const totalEmployerEsi = useMemo(
    () => filteredRows.reduce((acc, row) => acc + (Number(row.employerEsiNum) || 0), 0),
    [filteredRows]
  );

  const totalEsiCombined = useMemo(
    () => filteredRows.reduce((acc, row) => acc + (Number(row.totalEsiNum) || 0), 0),
    [filteredRows]
  );

  const exportToExcel = () => {
    if (!filteredRows.length) {
      setError('No ESI report data to export.');
      return;
    }

    const rows = filteredRows.map((row) => ({
      'S.No': row.sno,
      'Employee Code': row.employeeCode,
      'Employee Name': row.employeeName,
      ESI: row.esiNum,
      'Employer ESI': row.employerEsiNum,
      'Total ESI': row.totalEsiNum,
    }));

    rows.push({
      'S.No': '',
      'Employee Code': '',
      'Employee Name': 'Total',
      ESI: totalEsi,
      'Employer ESI': totalEmployerEsi,
      'Total ESI': totalEsiCombined,
    });

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'ESI Report');
    XLSX.writeFile(workbook, `esi-report-${month}.xlsx`);
  };

  const userAvatar =
    'https://images.pexels.com/photos/2379004/pexels-photo-2379004.jpeg?auto=compress&cs=tinysrgb&w=150';
  const userName = userRole === 'App Administrator' ? 'Admin User' : 'App User';

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
                      <Link
                        to={child.path}
                        key={child.label}
                        className={`cms-nav-child ${child.path === '/esi-report' ? 'active' : ''}`}
                      >
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
              <h1>
                {userEmail === 'afrindinu14@gmail.com' || userEmail === 'vaishnavi.a@buildhr.co.in'
                  ? 'Yashaswi Academy for Skills'
                  : 'Payroll Management System'}
              </h1>
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

          <main className="cms-dashboard-content">
            <div className="employee-card-container">
              <div className="employee-section-title">ESI Report</div>

              <div className="bank-report-actions">
                <label className="bank-report-month-label">
                  Payroll month
                  <input
                    type="month"
                    className="bank-report-month-input"
                    value={month}
                    onChange={(e) => setMonth(e.target.value)}
                  />
                </label>
                <input
                  type="text"
                  className="bank-report-search"
                  placeholder="Search by employee code, name, ESI, Employer ESI, Total ESI…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <button
                  className="cms-btn"
                  type="button"
                  onClick={exportToExcel}
                  disabled={!filteredRows.length || loading}
                >
                  <Download size={16} /> Export Excel
                </button>
                <button className="cms-btn" type="button" onClick={fetchReport} disabled={loading}>
                  {loading ? 'Loading…' : 'Refresh'}
                </button>
              </div>

              {error && <div className="bank-report-error">{error}</div>}
              {loading && <div className="bank-report-loading">Loading ESI report...</div>}

              <div className="muster-table-scroll">
                <table className="muster-table bank-report-table esi-report-table">
                  <thead>
                    <tr>
                      <th>S.No</th>
                      <th>Employee Code</th>
                      <th>Employee Name</th>
                      <th>ESI</th>
                      <th>Employer ESI</th>
                      <th>Total ESI</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!loading && filteredRows.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="bank-report-empty">
                          {data.length === 0
                            ? `No payroll data for ${month}. Run payroll for this month first.`
                            : 'No employees match your search.'}
                        </td>
                      </tr>
                    ) : (
                      <>
                        {filteredRows.map((row) => (
                          <tr key={`${row.employeeCode}-${row.sno}`}>
                            <td>{row.sno}</td>
                            <td>{row.employeeCode}</td>
                            <td>{row.employeeName}</td>
                            <td>{row.esi}</td>
                            <td>{row.employerEsi}</td>
                            <td>{row.totalEsi}</td>
                          </tr>
                        ))}
                        {!loading && filteredRows.length > 0 && (
                          <tr className="esi-report-total-row">
                            <td colSpan={3}>Total</td>
                            <td>{formatEsiAmount(totalEsi)}</td>
                            <td>{formatEsiAmount(totalEmployerEsi)}</td>
                            <td>{formatEsiAmount(totalEsiCombined)}</td>
                          </tr>
                        )}
                      </>
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

export default ESIReport;
