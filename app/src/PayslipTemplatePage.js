import React, { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import './App.css';
import HeaderBranding from './HeaderBranding';
import Button from './Button';
import { Plus, Bell } from 'lucide-react';
import { getSidebarModulesForUser } from './modulesConfig';
import PayslipTemplateDrawer from './PayslipTemplateDrawer';

function PayslipTemplatePage() {
  const navigate = useNavigate();
  const [expandedMenus, setExpandedMenus] = useState({});
  const [showSidebarMenu, setShowSidebarMenu] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);

  const userEmail = localStorage.getItem('userEmail') || null;
  const userRole = localStorage.getItem('userRole');
  const sidebarNavModules = useMemo(() => getSidebarModulesForUser(userEmail, userRole), [userEmail, userRole]);
  const selectedMonth = new Date().toISOString().slice(0, 7);

  const payrollKeyToHeaderLabel = useMemo(
    () => ({
      actualBasic: 'Actual Basic',
      actualDA: 'Actual DA',
      actualHRA: 'Actual HRA',
      otherAllowance: 'Attendance Allowance',
      specialAllowance: 'Special Allowance',
      actualTotalSalary: 'Actual Total Gross',
      earnedBasic: 'Earned Basic',
      earnedDA: 'Earned DA',
      earnedHRA: 'Earned HRA',
      arrear: 'Arrear',
      arrearForPF: 'Arrear For PF',
      incentive: 'Incentive',
      otAmount: 'OT Amount',
      earnedSalaryCross: 'Earned Gross Salary',
      rent: 'Rent Recovery',
      pf: 'PF 12%',
      esi: 'ESI 0.75%',
      otherDeduction: 'Other Deduction',
      totalDeduction: 'Total Deduction',
      netPay: 'Net Pay',
      esiContribution: 'ESIContribution',
      ESIContribution: 'ESIContribution',
      serviceCharge: 'Service Charge 9%',
      total: 'Total',
      bonus: 'Bonus',
    }),
    []
  );

  const toggleMenu = (index) => setExpandedMenus((prev) => ({ ...prev, [index]: !prev[index] }));

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
            {sidebarNavModules.map((item, idx) =>
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
            <div className="cms-user-details">
              <h4>CMS User</h4>
              <p>App User</p>
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
                <div className="cms-logout-icon">
                  <Button title="" className="cms-logout-btn" />
                </div>
              </div>
            </div>
          </header>

          <main className="cms-dashboard-content" style={{ padding: 0 }}>
            <PayslipTemplateDrawer
              open
              mode="page"
              lockBodyScroll={false}
              onClose={() => navigate(-1)}
              selectedMonth={selectedMonth}
              employee={null}
              payrollKeyToHeaderLabel={payrollKeyToHeaderLabel}
            />
          </main>
        </div>
      </div>
    </>
  );
}

export default PayslipTemplatePage;

