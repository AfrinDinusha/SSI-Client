import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import './App.css';
import HeaderBranding from './HeaderBranding';
import Button from './Button';
import { Plus, Bell } from 'lucide-react';
import { getSidebarModulesForUser } from './modulesConfig';
import './PayrollReport.css';
import * as XLSX from 'xlsx';

function useQuery() {
  const { search } = useLocation();
  return useMemo(() => new URLSearchParams(search), [search]);
}

function PayrollReport() {
  const query = useQuery();
  const navigate = useNavigate();
  const [month, setMonth] = useState(query.get('month') || new Date().toISOString().slice(0,7));
  const [contractor, setContractor] = useState('All');
  const [department, setDepartment] = useState('All');
  const [employeeId, setEmployeeId] = useState('All');
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expandedMenus, setExpandedMenus] = useState({});
  const [showSidebarMenu, setShowSidebarMenu] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const userEmail = localStorage.getItem('userEmail') || null;
  const userRole = localStorage.getItem('userRole');
  const sidebarNavModules = useMemo(() => getSidebarModulesForUser(userEmail, userRole), [userEmail, userRole]);

  // Map restricted users to a single contractor
  const forcedContractor = useMemo(() => {
    const map = {
      'afrindinusha@gmail.com': 'R.P.D Facility Management Services',
      'afrindinusha29@gmail.com': 'Sriram enterprises', // use DB spelling
      'dinushaafrin@gmail.com': 'Sri Balaji Enterprises',
    };
    return map[userEmail] || null;
  }, [userEmail]);

  const toggleMenu = (index) => {
    setExpandedMenus(prev => ({ ...prev, [index]: !prev[index] }));
  };

  useEffect(() => {
    const params = new URLSearchParams();
    if (month) params.set('month', month);
    if (contractor !== 'All') params.set('contractor', contractor);
    if (department !== 'All') params.set('department', department);
    if (employeeId !== 'All') params.set('employeeId', employeeId);
    if (userEmail) params.set('userEmail', userEmail);
    navigate({ pathname: '/payroll-report', search: params.toString() }, { replace: true });
  }, [month, contractor, department, employeeId, userEmail, navigate]);

  const fetchReport = async () => {
    try {
      setLoading(true);
      setError('');
      const params = new URLSearchParams({ month });
      if (contractor !== 'All') params.set('contractor', contractor);
      if (department !== 'All') params.set('department', department);
      if (employeeId !== 'All') params.set('employeeId', employeeId);
      if (userEmail) params.set('userEmail', userEmail);
      const res = await fetch(`/server/payroll_function/report?${params.toString()}`);
      const result = await res.json();
      if (!res.ok || result.error) throw new Error(result.error || `HTTP ${res.status}`);
      setData(Array.isArray(result.data) ? result.data : []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchReport(); }, [month, contractor, department, employeeId, userEmail]);

  const totals = useMemo(() => {
    const sum = (fn) => data.reduce((acc, r) => acc + (Number(fn(r)) || 0), 0);
    return {
      employees: data.length,
      otHours: sum(r => r.otHours),
      actualTotalSalary: sum(r => r.actualTotalSalary),
      earnedSalaryCross: sum(r => r.earnedSalaryCross),
      totalDeduction: sum(r => r.totalDeduction),
      netPay: sum(r => r.netPay),
      totalNetPayable: sum(r => r.totalNetPayable),
    };
  }, [data]);

  const exportToExcel = () => {
    if (!data || data.length === 0) {
      setError('No payroll report data to export.');
      return;
    }

    const rows = data.map((row, index) => ({
      'S.No': index + 1,
      'Employee Code': row.employeeCode,
      'Employee Name': row.employeeName,
      Designation: row.designation ?? row.Designation ?? '',
      Department: row.department,
      Contractor: row.contractor,
      'Days In Month': row.daysInMonth,
      'Days Present': row.daysPresent,
      'OT Hours': row.otHours,
      LOH: row.loh,
      'Actual Basic': row.actualBasic,
      'Actual HRA': row.actualHRA,
      'Actual DA': row.actualDA,
      'Other Allowance': row.otherAllowance,
      'Actual Total': row.actualTotalSalary,
      'Earned Basic': row.earnedBasic,
      'Earned HRA': row.earnedHRA,
      'Earned Cross': row.earnedSalaryCross,
      PF: row.pf,
      ESI: row.esi,
      'Total Deduction': row.totalDeduction,
      'OT Amount': row.otAmount,
      'OT ESI': row.otEsi,
      'OT Payment': row.otPayment,
      'Payable Amount': row.payableAmount,
      'OT Wages': row.otWages,
      Rent: row.rent,
      Advance: row.advance,
      'Net Pay': row.netPay,
      'Total Net Payable': row.totalNetPayable,
      Incentive: row.incentive,
    }));

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Payroll Report');
    XLSX.writeFile(workbook, `payroll-report-${month}.xlsx`);
  };

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
          <div className="water-bubble"></div>
          <div className="water-bubble"></div>
          <div className="water-bubble"></div>
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
            {sidebarNavModules.map((item, idx) => (
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
                    {item.children.map(child => (
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
            ))}
          </div>
          <div className="cms-user-info">
            <div className="cms-user-details">
              <h4>CMS User</h4>
              <p>App User</p>
            </div>
          </div>
        </nav>
        <div className="cms-main-content">
          <header className="cms-header">
            <div className="cms-header-center">
              <h1>{(userEmail === 'afrindinu14@gmail.com' || userEmail === 'vaishnavi.a@buildhr.co.in') ? 'Yashaswi Academy for Skills' : 'Payroll Management System'}</h1>
            </div>
            <div className="cms-header-right">
              <HeaderBranding />
              <div className="cms-header-user">
                <div className="cms-notification-icon" onClick={() => setShowNotifications(!showNotifications)}>
                  <Bell size={24} />
                </div>
                <div className="cms-logout-icon">
                  <Button title="" className="cms-logout-btn" />
                </div>
              </div>
            </div>
          </header>
          <main className="cms-dashboard-content">
            <div className="container payroll-report" style={{ padding: '16px' }}>
              <div className="header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2>Payroll Report</h2>
              </div>

              <div style={{ marginTop: 12, padding: '12px 14px', border: '1px solid #e5e7eb', borderRadius: 8, background: '#f8fafc' }}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>Saved payroll exports</div>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  <div style={{ padding: '6px 10px', borderRadius: 6, background: '#e0f2fe', color: '#0f172a', fontWeight: 600 }}>
                    {month}
                  </div>
                  <button
                    onClick={exportToExcel}
                    disabled={loading || data.length === 0}
                    style={{ background: '#0d6efd', color: '#ffffff', border: 'none', padding: '10px 16px', borderRadius: 6, fontWeight: 600 }}
                  >
                    Download {month} Payroll
                  </button>
                  <button
                    onClick={fetchReport}
                    disabled={loading}
                    style={{ background: '#0d6efd', color: '#ffffff', border: 'none', padding: '10px 16px', borderRadius: 6, fontWeight: 600 }}
                  >
                    Refresh {month}
                  </button>
                </div>
              </div>

              {error && (
                <div style={{ color: '#b00020', marginTop: 8 }}>{error}</div>
              )}

              {/* Totals summary removed per request */}
            </div>
          </main>
        </div>
      </div>
    </>
  );
}

export default PayrollReport;
