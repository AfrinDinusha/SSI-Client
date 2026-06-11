import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import './App.css';
import './BankFormatReport.css';
import './Attendancemuster.css';
import './employeeManagement.css';
import './Candidateform.css';
import './PFReport.css';
import HeaderBranding from './HeaderBranding';
import Button from './Button';
import { Plus, Bell, Download } from 'lucide-react';
import { getSidebarModulesForUser, resolveSidebarUserEmail } from './modulesConfig';
import * as XLSX from 'xlsx';

function useQuery() {
  const { search } = useLocation();
  return useMemo(() => new URLSearchParams(search), [search]);
}

function formatPfAmount(val) {
  if (val === null || val === undefined || val === '') return '-';
  const n = Number(val);
  if (!Number.isFinite(n)) return '-';
  return n.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function resolvePfAmount(row) {
  const status = String(row.pfStatus ?? row.PFStatus ?? '').trim().toLowerCase();
  if (status === 'no') return 0;
  return Number(row.pf) || 0;
}

function isPfReportRowApplicable(row) {
  const status = String(row.pfStatus ?? row.PFStatus ?? '').trim().toLowerCase();
  if (status === 'no') return false;
  const contractor = String(row.contractor ?? row.Contractor ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return contractor !== 'yashaswi academy for skills';
}

/** Admin = Earned Basic >= 15000 ? 75 : Earned Basic * 0.5% */
function computeAdminAmount(row) {
  if (!isPfReportRowApplicable(row)) return 0;
  const earnedBasic = Number(row.earnedBasic ?? row.EarnedBasic ?? 0) || 0;
  if (earnedBasic <= 0) return 0;
  if (earnedBasic >= 15000) return 75;
  return Math.round(earnedBasic * 0.005);
}

/** EDLI = Earned Basic >= 15000 ? 75 : Earned Basic * 0.5% (same wage base as Admin). */
function computeEdliAmount(row) {
  if (!isPfReportRowApplicable(row)) return 0;
  const earnedBasic = Number(row.earnedBasic ?? row.EarnedBasic ?? 0) || 0;
  if (earnedBasic <= 0) return 0;
  if (earnedBasic >= 15000) return 75;
  return Math.round(earnedBasic * 0.005);
}

function buildPfStatusMap(employees) {
  const map = {};
  for (const emp of employees || []) {
    const code = String(emp.employeeCode ?? emp.EmployeeCode ?? '').trim();
    if (!code) continue;
    const status = String(emp.pfStatus ?? emp.PFStatus ?? '').trim().toLowerCase();
    map[code] = status;
    if (/^\d+$/.test(code)) map[String(parseInt(code, 10))] = status;
  }
  return map;
}

function lookupPfStatus(map, employeeCode) {
  const code = String(employeeCode ?? '').trim();
  if (!code) return '';
  if (map[code] !== undefined) return map[code];
  if (/^\d+$/.test(code) && map[String(parseInt(code, 10))] !== undefined) {
    return map[String(parseInt(code, 10))];
  }
  return '';
}

function PFReport() {
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
    navigate({ pathname: '/pf-report', search: params.toString() }, { replace: true });
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
      let pfStatusMap = {};
      try {
        const empJson = await empRes.json();
        const employees = empJson?.data?.employees ?? empJson?.employees ?? [];
        pfStatusMap = buildPfStatusMap(employees);
      } catch {
        pfStatusMap = {};
      }
      const rows = (Array.isArray(result.data) ? result.data : []).map((row) => {
        const code = row.employeeCode ?? row.EmployeeCode;
        const pfStatus =
          row.pfStatus ?? row.PFStatus ?? lookupPfStatus(pfStatusMap, code) ?? '';
        return { ...row, pfStatus };
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
        const pfNum = resolvePfAmount(row);
        const adminNum = computeAdminAmount(row);
        const edliNum = computeEdliAmount(row);
        const totalPfNum = pfNum + adminNum + edliNum;
        return {
          sno: index + 1,
          employeeCode: row.employeeCode ?? row.EmployeeCode ?? '-',
          employeeName: row.employeeName ?? row.EmployeeName ?? '-',
          pf: formatPfAmount(pfNum),
          pfNum,
          admin: formatPfAmount(adminNum),
          adminNum,
          edli: formatPfAmount(edliNum),
          edliNum,
          totalPf: formatPfAmount(totalPfNum),
          totalPfNum,
        };
      }),
    [data]
  );

  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return normalizedRows;
    return normalizedRows.filter((row) =>
      [row.employeeCode, row.employeeName, row.pf, row.admin, row.edli, row.totalPf]
        .join(' ')
        .toLowerCase()
        .includes(term)
    );
  }, [normalizedRows, search]);

  const totalPf = useMemo(
    () => filteredRows.reduce((acc, row) => acc + (Number(row.pfNum) || 0), 0),
    [filteredRows]
  );

  const totalAdmin = useMemo(
    () => filteredRows.reduce((acc, row) => acc + (Number(row.adminNum) || 0), 0),
    [filteredRows]
  );

  const totalEdli = useMemo(
    () => filteredRows.reduce((acc, row) => acc + (Number(row.edliNum) || 0), 0),
    [filteredRows]
  );

  const totalPfCombined = useMemo(
    () => filteredRows.reduce((acc, row) => acc + (Number(row.totalPfNum) || 0), 0),
    [filteredRows]
  );

  const exportToExcel = () => {
    if (!filteredRows.length) {
      setError('No PF report data to export.');
      return;
    }

    const rows = filteredRows.map((row) => ({
      'S.No': row.sno,
      'Employee Code': row.employeeCode,
      'Employee Name': row.employeeName,
      PF: row.pfNum,
      Admin: row.adminNum,
      EDli: row.edliNum,
      'Total PF': row.totalPfNum,
    }));

    rows.push({
      'S.No': '',
      'Employee Code': '',
      'Employee Name': 'Total',
      PF: totalPf,
      Admin: totalAdmin,
      EDli: totalEdli,
      'Total PF': totalPfCombined,
    });

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'PF Report');
    XLSX.writeFile(workbook, `pf-report-${month}.xlsx`);
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
                        className={`cms-nav-child ${child.path === '/pf-report' ? 'active' : ''}`}
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
              <div className="employee-section-title">PF Report</div>

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
                  placeholder="Search by employee code, name, PF, Admin, EDli, Total PF…"
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
              {loading && <div className="bank-report-loading">Loading PF report...</div>}

              <div className="muster-table-scroll">
                <table className="muster-table bank-report-table pf-report-table">
                  <thead>
                    <tr>
                      <th>S.No</th>
                      <th>Employee Code</th>
                      <th>Employee Name</th>
                      <th>PF</th>
                      <th>Admin</th>
                      <th>EDli</th>
                      <th>Total PF</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!loading && filteredRows.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="bank-report-empty">
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
                            <td>{row.pf}</td>
                            <td>{row.admin}</td>
                            <td>{row.edli}</td>
                            <td>{row.totalPf}</td>
                          </tr>
                        ))}
                        {!loading && filteredRows.length > 0 && (
                          <tr className="pf-report-total-row">
                            <td colSpan={3}>Total</td>
                            <td>{formatPfAmount(totalPf)}</td>
                            <td>{formatPfAmount(totalAdmin)}</td>
                            <td>{formatPfAmount(totalEdli)}</td>
                            <td>{formatPfAmount(totalPfCombined)}</td>
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

export default PFReport;
