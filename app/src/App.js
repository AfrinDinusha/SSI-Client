import { BrowserRouter as Router, Routes, Route, Link, Navigate, useLocation } from 'react-router-dom';
import './App.css';
import EmployeeManagement from './EmployeeManagement';
import Layout from './Layout';
import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import LoginPage from './LoginPage';
import Button from './Button';
import Candidateform from './Candidateform';
import Designation  from './Designation';
import Department from './Department';
import Attendance from './Attendance';
import Contracters from './Contracters';
import Organization from './Organization';
import Attendancemuster from './Attendancemuster';
import CheckinCheckoutReport from './CheckinCheckoutReport';
import Shift from './Shift';
import EHS from './EHS';
import Shiftmap from './Shiftmap';
import NewShiftMap from './NewShiftMap';
import ShiftmapDeviation from './ShiftmapDeviation';
import DeviationRecords from './DeviationRecords';
import Reports from './reports';
import LOHReport from './LOHReport';
import BankFormatReport from './BankFormatReport';
import BankNeftReport from './BankNeftReport';
import Misspunch from './Misspunch';
import LateInReport from './LateInReport';
import PermissionReport from './Permissionreport';
import Dashboard from './Dashboard';
import CriticalIncident from './criticalIncident';
import Payment from './Payment';
import EHSViolation from './EHSViolation';
import ContractForm from './ContractForm';
import StatutoryRegisters from './StatutoryRegisters';
import Payroll from './Payroll';
import PayrollReport from './PayrollReport';
import PFReport from './PFReport';
import ESIReport from './ESIReport';
import PayslipTemplatePage from './PayslipTemplatePage';
import Detection from './Detection';
import Grace from './Grace';
import OnDutyManagement from './OnDuty';
import PermissionManagement from './Permission';
import CompOff from './compoff';
import Calendar from './Calendar';
import BioMax from './BioMax';
import Regularization from './regularization';
import SetupConfig from './setupconfig';
import HeaderBranding from './HeaderBranding';
import {
  getSidebarModulesForUser,
  isLimitedSidebarUser,
  isHideDashboardAndSetupUser,
  LIMITED_SIDEBAR_ALLOWED_PATHS,
} from './modulesConfig';
import { 
  Users, Calendar as CalendarIcon, FileText, AlertTriangle, FolderOpen, 
  ClipboardList, Building, Handshake, Landmark, Clock, 
  Map, BarChart3, User, TrendingUp, TrendingDown,
  Activity, Plus, CheckCircle, Bell, Settings, LayoutDashboard, Home as HomeIcon, AlertOctagon, CreditCard, Shield, Trophy, Medal, Award, Star, FileSignature, Search, Clock3, Database, CalendarDays
} from 'lucide-react';

// Enhanced Home component with CMS styling
// Protected Route component
function ProtectedRoute({ children }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        console.log('Checking authentication...');
        const authStatus = await window.catalyst.auth.isUserAuthenticated();
        console.log('Authentication status:', authStatus);
        setIsAuthenticated(authStatus);
      } catch (err) {
        console.error('Authentication error:', err);
        setIsAuthenticated(false);
      } finally {
        setIsLoading(false);
      }
    };
    checkAuth();
  }, []);

  const logout = useCallback(() => {
    const redirectURL = "/__catalyst/auth/login";
    window.catalyst.auth.signOut(redirectURL);
  }, []);

  if (isLoading) {
    return (
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        height: '100vh',
        fontSize: '1.2rem',
        color: '#3f51b5'
      }}>
        Loading...
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return children;
}

// Role-based Protected Route component
function RoleProtectedRoute({ children, allowedRoles, userRole }) {
  console.log('RoleProtectedRoute - userRole:', userRole, 'allowedRoles:', allowedRoles);
  
  if (!userRole) {
    return (
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        height: '100vh',
        fontSize: '1.2rem',
        color: '#f44336'
      }}>
        Loading user role... (Current role: {userRole || 'undefined'})
      </div>
    );
  }

  if (!allowedRoles.includes(userRole)) {
    return (
      <div style={{ 
        display: 'flex', 
        flexDirection: 'column',
        justifyContent: 'center', 
        alignItems: 'center', 
        height: '100vh',
        fontSize: '1.2rem',
        color: '#f44336'
      }}>
        <h2>Access Denied</h2>
        <p>You don't have permission to access this page.</p>
        <p>Your role: {userRole}</p>
        <button 
          onClick={() => window.history.back()} 
          style={{
            padding: '10px 20px',
            backgroundColor: '#3f51b5',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            marginTop: '20px'
          }}
        >
          Go Back
        </button>
      </div>
    );
  }

  return children;
}

/** Restrict specific users to Employees + Payroll routes only; send `/` to `/employees`.
 *  Other users in modulesConfig may be blocked from Dashboard / Setup only. */
function LimitedUserRouteGuard({ userEmail, children }) {
  const location = useLocation();
  const path = location.pathname;

  if (isLimitedSidebarUser(userEmail)) {
    if (path === '/') {
      return <Navigate to="/employees" replace />;
    }
    const ok = LIMITED_SIDEBAR_ALLOWED_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
    if (!ok) {
      return <Navigate to="/employees" replace />;
    }
    return children;
  }

  if (isHideDashboardAndSetupUser(userEmail)) {
    if (path === '/dashboard' || path.startsWith('/dashboard/') || path === '/setupconfig' || path.startsWith('/setupconfig/')) {
      return <Navigate to="/" replace />;
    }
  }

  return children;
}

function Home({ userRole, userEmail, setUserRole }) {
  // State for animations and interactions
  const [expandedMenus, setExpandedMenus] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [animatedCounts, setAnimatedCounts] = useState({
    employees: 0,
    departments: 0,
    designations: 0,
    shifts: 0
  });

  const [showNotifications, setShowNotifications] = useState(false);
  const [showSidebarMenu, setShowSidebarMenu] = useState(false);

  const modulesToShow = useMemo(() => getSidebarModulesForUser(userEmail, userRole), [userEmail, userRole]);

  // Flatten sidebar modules for System Modules & Features (only items that have a path)
  const flattenedModules = useMemo(() => {
    const list = [];
    modulesToShow.forEach((item) => {
      if (item.path) {
        list.push({ path: item.path, label: item.label, icon: item.icon });
      }
      if (item.children && Array.isArray(item.children)) {
        item.children.forEach((child) => {
          if (child.path) list.push({ path: child.path, label: child.label, icon: child.icon });
        });
      }
    });
    return list;
  }, [modulesToShow]);

  // Gradient colors for module cards (cycle by index)
  const moduleGradients = [
    'linear-gradient(135deg, #FF6B6B, #FF8E8E)',
    'linear-gradient(135deg, #4ECDC4, #6EDDD6)',
    'linear-gradient(135deg, #45B7D1, #67C3DD)',
    'linear-gradient(135deg, #96CEB4, #A8D5C4)',
    'linear-gradient(135deg, #FFEAA7, #FDCB6E)',
    'linear-gradient(135deg, #DDA0DD, #E6B3E6)',
    'linear-gradient(135deg, #FFB347, #FFC266)',
    'linear-gradient(135deg, #87CEEB, #9BDAEF)',
    'linear-gradient(135deg, #98FB98, #A8FBA8)',
    'linear-gradient(135deg, #F0A0A0, #F5B2B2)',
    'linear-gradient(135deg, #FFD700, #FFA500)',
    'linear-gradient(135deg, #20B2AA, #40E0D0)',
  ];

  // Title and description for each module in System Modules & Features (by path)
  const moduleDescriptions = {
    '/': { title: 'Home', description: 'Landing page and quick access to system overview and key metrics.' },
    '/dashboard': { title: 'Dashboard Analytics', description: 'Comprehensive analytics, performance metrics, and data visualization for informed decision-making' },
    '/organization': { title: 'Organization Management', description: 'Manage organizational structure, company details, and corporate information' },
    '/employees': { title: 'Employee Management', description: 'Complete employee lifecycle management including profiles, roles, and performance tracking' },
    '/setupconfig': { title: 'Setup Configuration', description: 'Configure system settings, preferences, and global options.' },
    '/regularization': { title: 'Regularization', description: 'Manage regularization requests and approval workflows.' },
    '/attendance': { title: 'Attendance Sync', description: 'Track employee attendance, generate reports, and monitor workforce presence' },
    '/time': { title: 'Department Management', description: 'Organize company structure with departments and reporting relationships' },
    '/tasks': { title: 'Designation Management', description: 'Manage job titles, roles, and organizational hierarchy' },
    '/payroll': { title: 'Payroll', description: 'Process payroll, manage salary structures, and handle compensation.' },
    '/payroll-report': { title: 'Payroll Report', description: 'View and export payroll reports and summaries.' },
    '/pf-report': { title: 'PF Report', description: 'Employee-wise Provident Fund (PF) deduction report.' },
    '/esi-report': { title: 'ESI Report', description: 'Employee-wise Employee State Insurance (ESI) deduction report.' },
    '/payslip-template': { title: 'Payroll Template', description: 'Manage payslip templates and formatting.' },
    '/shift': { title: 'Shift Management', description: 'Create and manage work schedules, shift patterns, and time allocations' },
    '/newshiftmap': { title: 'Shift Roaster', description: 'Map shifts to employees and manage shift assignments.' },
    '/onduty': { title: 'Onduty', description: 'Manage on-duty requests and approvals.' },
    '/permission': { title: 'Permission', description: 'Manage permission requests and access control.' },
    '/grace': { title: 'Grace', description: 'Configure and manage grace period settings.' },
    '/compoff': { title: 'Comboff', description: 'Manage compensatory off requests and balance.' },
    '/calendar': { title: 'Calendar', description: 'View and manage leave calendar and events.' },
    '/reports': { title: 'Monthly OT', description: 'Monthly overtime reports and analytics.' },
    '/loh-report': { title: 'LOH', description: 'Loss of hours and related reports.' },
    '/bank-format-report': { title: 'Bank Format Report', description: 'Employee bank details in report format.' },
    '/bank-neft-report': { title: 'Bank NEFT Report', description: 'NEFT transfer lines for bank upload.' },
    '/latein-report': { title: 'Late In', description: 'Employees who came in after the grace period.' },
    '/attendancemuster': { title: 'Attendance Muster', description: 'Attendance muster roll and summaries.' },
    '/shiftmapdeviation': { title: 'Shiftmap Deviation', description: 'Track and manage shift map deviations.' },
    '/candidate': { title: 'Candidate On-Boarding', description: 'Streamlined process for hiring new candidates with EHS compliance and documentation' },
    '/EHSViolation': { title: 'EHS Management', description: 'Environment, Health & Safety management including violations and critical incident tracking' },
    '/contracters': { title: 'Contractor Management', description: 'Comprehensive contractor database with approval workflows and compliance tracking' },
    '/payment': { title: 'Payment Processing', description: 'Manage payments, invoices, and financial transactions for contractors and employees' },
    '/statutoryregisters': { title: 'Statutory Registers', description: 'Statutory registers are legal records maintained for regulatory compliance' },
  };

  // Toggle expandable menus
  const toggleMenu = (index) => {
    setExpandedMenus(prev => ({
      ...prev,
      [index]: !prev[index]
    }));
  };

  const [counts, setCounts] = useState({
    employees: null,
    departments: null,
    designations: null,
    shifts: null,
    attendance: '95%'
  });
  const [loadingCounts, setLoadingCounts] = useState(true);

  // Animate count numbers
  const animateCount = (target, key) => {
    if (typeof target !== 'number') return;
    let current = 0;
    const increment = target / 50;
    const timer = setInterval(() => {
      current += increment;
      if (current >= target) {
        current = target;
        clearInterval(timer);
      }
      setAnimatedCounts(prev => ({
        ...prev,
        [key]: Math.floor(current)
      }));
    }, 30);
  };



  useEffect(() => {
    async function fetchCounts() {
      // Don't fetch counts if userRole is not set yet
      if (!userRole) {
        console.log('User role not set yet, skipping fetchCounts');
        return;
      }
      
      try {
        console.log('Fetching counts from APIs...');
        console.log('User role:', userRole);
        console.log('User email:', userEmail);
        
        const userRoleParam = encodeURIComponent(userRole || '');
        console.log('Encoded user role param:', userRoleParam);
        
        const [empRes, deptRes, desigRes, shiftRes] = await Promise.all([
          fetch(`/server/cms_function/employees/count?userRole=${userRoleParam}&userEmail=${encodeURIComponent(userEmail || '')}&dashboard=true`)
            .then(r => {
              console.log('Employee count API response status:', r.status);
              if (!r.ok) throw new Error(`Employees count failed: ${r.status}`);
              return r.json();
            })
            .then(data => {
              console.log('Employee count API response data:', data);
              return data;
            })
            .catch(err => {
              console.error('Employees count error:', err);
              return { count: 0 };
            }),
          fetch('/server/Department_function/departments/count')
            .then(r => {
              if (!r.ok) throw new Error(`Departments count failed: ${r.status}`);
              return r.json();
            })
            .catch(err => {
              console.error('Departments count error:', err);
              return { count: 0 };
            }),
          fetch('/server/Designation_function/designations')
            .then(r => {
              if (!r.ok) throw new Error(`Designations fetch failed: ${r.status}`);
              return r.json();
            })
            .catch(err => {
              console.error('Designations fetch error:', err);
              return { data: { designations: [] } };
            }),
          fetch('/server/Shift_function/shifts')
            .then(r => {
              if (!r.ok) throw new Error(`Shifts fetch failed: ${r.status}`);
              return r.json();
            })
            .catch(err => {
              console.error('Shifts fetch error:', err);
              return { data: { shifts: [] } };
            }),
        ]);
        
        const designationCount = Array.isArray(desigRes?.data?.designations) ? desigRes.data.designations.length : 0;
        const shiftCount = Array.isArray(shiftRes?.data?.shifts) ? shiftRes.data.shifts.length : 0;
        
        console.log('API responses:', { empRes, deptRes, desigRes, shiftRes });
        console.log('Designation count:', designationCount, 'Shift count:', shiftCount);
        
        setCounts({
          employees: empRes.count ?? empRes.data?.count ?? '—',
          departments: deptRes.count ?? deptRes.data?.count ?? '—',
          designations: designationCount,
          shifts: shiftCount,
          attendance: '95%'
        });
        
        // Animate counts after fetching
        setTimeout(() => {
          animateCount(empRes.count ?? empRes.data?.count ?? 0, 'employees');
          animateCount(deptRes.count ?? deptRes.data?.count ?? 0, 'departments');
          animateCount(designationCount, 'designations');
          animateCount(shiftCount, 'shifts');
        }, 500);
      } catch (err) {
        console.error('Fetch counts error:', err);
        setCounts({
          employees: '—',
          departments: '—',
          designations: '—',
          shifts: '—',
          attendance: '95%'
        });
      } finally {
        setLoadingCounts(false);
        setIsLoading(false);
      }
    }
    fetchCounts();
  }, [userRole, userEmail]);

  // User info
  const userAvatar = "https://images.pexels.com/photos/2379004/pexels-photo-2379004.jpeg?auto=compress&cs=tinysrgb&w=150";
  const userName = userRole === 'App Administrator' ? 'Admin User' : 'App User';

  // Sample activity data with Lucide icons
  const recentActivities = [
    { icon: <User size={20} />, title: 'New Employee Added', description: 'John Doe joined the development team', time: '2 hours ago' },
    { icon: <BarChart3 size={20} />, title: 'Monthly Report Generated', description: 'Contractor performance report is ready', time: '4 hours ago' },
  ];



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
                  <div className="cms-nav-item" onClick={() => toggleMenu(idx)}>
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
                        className={`cms-nav-child ${['/loh-report', '/latein-report', '/misspunch-report', '/onduty', '/permission', '/grace', '/compoff', '/calendar'].includes(child.path) ? 'clock-color-icon' : ''}`}
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
                  className={`cms-nav-item ${['/loh-report', '/latein-report', '/misspunch-report', '/onduty', '/grace', '/compoff', '/calendar'].includes(item.path) ? 'clock-color-icon' : ''}`}
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
              <h1>{(userEmail === 'afrindinu14@gmail.com' || userEmail === 'vaishnavi.a@buildhr.co.in') ? 'Yashaswi Academy for Skills' : 'Payroll Management System'}</h1>
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

          {/* Notification Popup */}
          {showNotifications && (
            <div className="cms-notification-overlay" onClick={() => setShowNotifications(false)}>
              <div className="cms-notification-popup" onClick={(e) => e.stopPropagation()}>
                <div className="cms-notification-header">
                  <h3>Recent Activity</h3>
                  <button 
                    className="cms-close-btn"
                    onClick={() => setShowNotifications(false)}
                  >
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

          {/* Dashboard Content */}
          <main className="cms-dashboard-content">
            {/* Stats Grid */}
            <div className="cms-stats-grid">
              <div className="cms-stat-card">
                <div className="cms-stat-header">
                  <div>
                    <div className="cms-stat-value">
                      {isLoading ? '...' : (animatedCounts.employees || counts.employees)}
                    </div>
                    <div className="cms-stat-label">Active Employees</div>
                    <div className="cms-stat-change positive">
                      <TrendingUp size={16} /> +12% from last month
                    </div>
                  </div>
                  <div className="cms-stat-icon">
                    <Users size={28} />
                  </div>
                </div>
              </div>

              <div className="cms-stat-card">
                <div className="cms-stat-header">
                  <div>
                    <div className="cms-stat-value">
                      {isLoading ? '...' : (animatedCounts.departments || counts.departments)}
                    </div>
                    <div className="cms-stat-label">Departments</div>
                    <div className="cms-stat-change positive">
                      <TrendingUp size={16} /> +3% from last month
                    </div>
                  </div>
                  <div className="cms-stat-icon">
                    <Building size={28} />
                  </div>
                </div>
              </div>

              <div className="cms-stat-card">
                <div className="cms-stat-header">
                  <div>
                    <div className="cms-stat-value">
                      {isLoading ? '...' : (animatedCounts.designations ?? counts.designations ?? 0)}
                    </div>
                    <div className="cms-stat-label">Designation</div>
                    <div className="cms-stat-change positive">
                      <TrendingUp size={16} /> +8% from last month
                    </div>
                  </div>
                  <div className="cms-stat-icon">
                    <Handshake size={28} />
                  </div>
                </div>
              </div>

              <div className="cms-stat-card">
                <div className="cms-stat-header">
                  <div>
                    <div className="cms-stat-value">
                      {isLoading ? '...' : (animatedCounts.shifts ?? counts.shifts ?? 0)}
                    </div>
                    <div className="cms-stat-label">Shift</div>
                    <div className="cms-stat-change positive">
                      <TrendingUp size={16} /> +15% from last month
                    </div>
                  </div>
                  <div className="cms-stat-icon">
                    <FileText size={28} />
                  </div>
                </div>
              </div>
            </div>

           {/* Main Content Grid - About PMS and Recent Activity */}
            <div className="cms-main-content-grid">
              {/* About PMS Section - Left Side */}
              <div className="cms-about-section">
                <div className="cms-about-card">
                  <div className="cms-chart-header">
                    <div className="cms-about-left">
                      <h3 className="cms-chart-title">About PMS</h3>
                    </div>
                    <div className="cms-about-right">
                      <p className="cms-about-subtitle" style={{fontFamily: 'Radley'}}>Payroll Management System - Your Complete Workforce Solution</p>
                    </div>
                  </div>
                  <div className="cms-about-content">
                    <div className="cms-about-description">
                      <p>
                        Payroll Management System is a comprehensive platform designed to streamline 
                        and manage all aspects of contractor operations, employee management, and organizational processes. 
                        Built with modern technology and user-friendly interfaces, Payroll Management System provides powerful tools for 
                        administrators and users to efficiently manage their workforce.
                      </p>
                    </div>
                    
                    <div className="cms-modules-overview">
                      <h4>System Modules & Features</h4>
                      <div className="cms-modules-grid">
                        {flattenedModules.map((mod, index) => {
                          const info = moduleDescriptions[mod.path];
                          const title = info?.title ?? mod.label;
                          const description = info?.description ?? '';
                          return (
                            <Link key={mod.path} to={mod.path} className="cms-module-item cms-module-link">
                              <div className="cms-module-icon" style={{ background: moduleGradients[index % moduleGradients.length] }}>
                                {mod.icon}
                              </div>
                              <div className="cms-module-content">
                                <h5>{title}</h5>
                                {description ? <p>{description}</p> : null}
                              </div>
                            </Link>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Side Section - Recent Activity */}
              <div className="cms-right-side-section">
                {/* Recent Activity Section */}
                <div className="cms-activity-section">
                  <div className="cms-activity-card">
                    <div className="cms-chart-header">
                      <h3 className="cms-chart-title">Recent Activity</h3>
                    </div>
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
            </div>
          </main>
        </div>
      </div>
    </>
  );
}

// Add this function to fetch the user's role from the backend
async function fetchUserRoleFromBackend() {
  try {
    // Get role from Catalyst authentication
    const authData = await window.catalyst.auth.isUserAuthenticated();
    console.log('Frontend auth data:', authData);
    
    if (authData && authData.content && authData.content.role_details) {
      const roleName = authData.content.role_details.role_name;
      console.log('Role from Catalyst auth:', roleName);
      
      // Map Catalyst roles to app roles
      switch(roleName) {
        case 'App Administrator':
          return 'App Administrator';
        case 'App User':
          return 'App User';
        default:
          // If role is not recognized, try backend endpoint
          break;
      }
    }
    
    // Fallback: Try backend endpoint
    console.log('Trying backend endpoint as fallback...');
    const response = await fetch('/server/authorized_portal_function', { 
      credentials: 'include',
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      console.error('HTTP error:', response.status);
      return 'App User';
    }
    
    const data = await response.json();
    console.log('Backend response:', data);
    console.log('Response status:', response.status);
    console.log('Response headers:', response.headers);
    
    // Handle the case where the response is wrapped in an 'output' field
    let responseData = data;
    if (data.output) {
      try {
        responseData = JSON.parse(data.output);
      } catch (parseError) {
        console.error('Error parsing output:', parseError);
        return 'App User';
      }
    }
    
    if (responseData && responseData.status === 'success' && responseData.user_details) {
      console.log('User details from backend:', responseData.user_details);
      console.log('Detected role from backend:', responseData.user_details.role_identifier);
      
      // Store contractor info if available
      if (responseData.user_details.contractor_info) {
        localStorage.setItem('contractorInfo', JSON.stringify(responseData.user_details.contractor_info));
        console.log('Contractor info stored:', responseData.user_details.contractor_info);
      }
      
      return responseData.user_details.role_identifier;
    } else if (responseData && responseData.status === 'failure') {
      console.error('Backend authentication failed:', responseData.message);
      return 'App User'; // fallback
    }
  } catch (err) {
    console.error('Error fetching user role:', err);
    return 'App User'; // fallback
  }
  return 'App User';
}

function App() {
  const [userRole, setUserRole] = useState(localStorage.getItem('userRole') || null);
  const [userEmail, setUserEmail] = useState(localStorage.getItem('userEmail') || null);
  
  console.log('App component - userRole:', userRole, 'userEmail:', userEmail);

  // Fetch user role and email after authentication
  useEffect(() => {
    async function fetchUserRole() {
      try {
        // Clear ALL cached data first
        localStorage.clear();
        sessionStorage.clear();
        
        const auth = await window.catalyst.auth.isUserAuthenticated();
        console.log('User authenticated:', auth);
        
        if (auth) {
          // Force fresh role fetch from backend
          const role = await fetchUserRoleFromBackend();
          console.log('Setting user role to:', role);
          setUserRole(role);
          localStorage.setItem('userRole', role);
          
          // Get user email from authentication
          if (auth.content && auth.content.email_id) {
            const email = auth.content.email_id;
            console.log('Setting user email to:', email);
            setUserEmail(email);
            localStorage.setItem('userEmail', email);
          }
        } else {
          console.log('User not authenticated');
          setUserRole('App User'); // Default role for unauthenticated users
        }
      } catch (error) {
        console.error('Error checking authentication:', error);
        setUserRole('App User'); // Default role on error
      }
    }
    fetchUserRole();
  }, []);

  // Pass userRole to Home and Dashboard
  return (
    <Router>
      <LimitedUserRouteGuard userEmail={userEmail}>
      <Routes>
        {/* Protected routes */}
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Home userRole={userRole} userEmail={userEmail} setUserRole={setUserRole} />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <Dashboard userRole={userRole} userEmail={userEmail} />
            </ProtectedRoute>
          }
        />
        <Route
          path="/employees"
          element={
            <ProtectedRoute>
              <RoleProtectedRoute allowedRoles={['App User', 'App Administrator']} userRole={userRole}>
                <EmployeeManagement userRole={userRole} userEmail={userEmail} />
              </RoleProtectedRoute>
            </ProtectedRoute>
            
          }
        />
        <Route
          path="/biomax"
          element={
            <ProtectedRoute>
              <RoleProtectedRoute allowedRoles={['App User', 'App Administrator']} userRole={userRole}>
                <BioMax userRole={userRole} userEmail={userEmail} />
              </RoleProtectedRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/regularization"
          element={
            <ProtectedRoute>
              <RoleProtectedRoute allowedRoles={['App User', 'App Administrator']} userRole={userRole}>
                <Regularization userRole={userRole} userEmail={userEmail} />
              </RoleProtectedRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/candidate"
          element={
            <ProtectedRoute>
              <RoleProtectedRoute allowedRoles={['App User', 'App Administrator']} userRole={userRole}>
                <Candidateform userRole={userRole} userEmail={userEmail} />
              </RoleProtectedRoute>
            </ProtectedRoute>
            }
        />
        <Route
          path="/tasks"
          element={
            <ProtectedRoute>
              <RoleProtectedRoute allowedRoles={['App User', 'App Administrator']} userRole={userRole}>
                <Designation userRole={userRole} setUserRole={setUserRole} />
              </RoleProtectedRoute>
            </ProtectedRoute>
            }
        />
        <Route
          path="/time"
          element={
            <ProtectedRoute>
              <RoleProtectedRoute allowedRoles={['App User', 'App Administrator']} userRole={userRole}>
                <Department userRole={userRole} userEmail={userEmail} setUserRole={setUserRole} />
              </RoleProtectedRoute>
            </ProtectedRoute>
            }
        />
        <Route
          path="/attendance"
          element={
            <ProtectedRoute>
              <RoleProtectedRoute allowedRoles={['App User', 'App Administrator']} userRole={userRole}>
                <Attendance userRole={userRole} userEmail={userEmail} />
              </RoleProtectedRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/contracters"
          element={
            <ProtectedRoute>
              <RoleProtectedRoute allowedRoles={['App Administrator']} userRole={userRole}>
                <Contracters userRole={userRole} setUserRole={setUserRole} />
              </RoleProtectedRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/contract-form"
          element={
            <ProtectedRoute>
              <RoleProtectedRoute allowedRoles={['App Administrator']} userRole={userRole}>
                <ContractForm userRole={userRole} setUserRole={setUserRole} />
              </RoleProtectedRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/organization"
          element={
            <ProtectedRoute>
              <RoleProtectedRoute allowedRoles={['App Administrator']} userRole={userRole}>
                <Organization />
              </RoleProtectedRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/attendancemuster"
          element={
            <ProtectedRoute>
              <RoleProtectedRoute allowedRoles={['App User', 'App Administrator']} userRole={userRole}>
                <Attendancemuster userRole={userRole} userEmail={userEmail} />
              </RoleProtectedRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/checkin-checkout-report"
          element={
            <ProtectedRoute>
              <RoleProtectedRoute allowedRoles={['App User', 'App Administrator']} userRole={userRole}>
                <CheckinCheckoutReport userRole={userRole} userEmail={userEmail} />
              </RoleProtectedRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/shift"
          element={
            <ProtectedRoute>
              <RoleProtectedRoute allowedRoles={['App User', 'App Administrator']} userRole={userRole}>
                <Shift userRole={userRole} userEmail={userEmail} />
              </RoleProtectedRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/EHS"
          element={
            <ProtectedRoute>
              <RoleProtectedRoute allowedRoles={['App User', 'App Administrator']} userRole={userRole}>
                <EHS userRole={userRole} />
              </RoleProtectedRoute>
            </ProtectedRoute>
            }
        />
        <Route
          path="/EHSViolation"
          element={
            <ProtectedRoute>
              <RoleProtectedRoute allowedRoles={['App User', 'App Administrator']} userRole={userRole}>
                <EHSViolation userRole={userRole} userEmail={userEmail} />
              </RoleProtectedRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/Shiftmap"
          element={
            <ProtectedRoute>
              <RoleProtectedRoute allowedRoles={['App User', 'App Administrator']} userRole={userRole}>
                <Shiftmap userRole={userRole} userEmail={userEmail} />
              </RoleProtectedRoute>
            </ProtectedRoute>
            }
        />
        <Route
          path="/newshiftmap"
          element={
            <ProtectedRoute>
              <RoleProtectedRoute allowedRoles={['App User', 'App Administrator']} userRole={userRole}>
                <NewShiftMap userRole={userRole} userEmail={userEmail} />
              </RoleProtectedRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/shiftmapdeviation"
          element={
            <ProtectedRoute>
              <RoleProtectedRoute allowedRoles={['App User', 'App Administrator']} userRole={userRole}>
                <ShiftmapDeviation userRole={userRole} userEmail={userEmail} />
              </RoleProtectedRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/deviationrecords"
          element={
            <ProtectedRoute>
              <RoleProtectedRoute allowedRoles={['App User', 'App Administrator']} userRole={userRole}>
                <DeviationRecords userRole={userRole} userEmail={userEmail} />
              </RoleProtectedRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports"
          element={
            <ProtectedRoute>
              <RoleProtectedRoute allowedRoles={['App User', 'App Administrator']} userRole={userRole}>
                <Reports userRole={userRole} userEmail={userEmail} />
              </RoleProtectedRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/loh-report"
          element={
            <ProtectedRoute>
              <RoleProtectedRoute allowedRoles={['App User', 'App Administrator']} userRole={userRole}>
                <LOHReport userRole={userRole} userEmail={userEmail} />
              </RoleProtectedRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/permission-report"
          element={
            <ProtectedRoute>
              <RoleProtectedRoute allowedRoles={['App User', 'App Administrator']} userRole={userRole}>
                <PermissionReport userRole={userRole} userEmail={userEmail} />
              </RoleProtectedRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/bank-format-report"
          element={
            <ProtectedRoute>
              <RoleProtectedRoute allowedRoles={['App User', 'App Administrator']} userRole={userRole}>
                <BankFormatReport userRole={userRole} userEmail={userEmail} />
              </RoleProtectedRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/bank-neft-report"
          element={
            <ProtectedRoute>
              <RoleProtectedRoute allowedRoles={['App User', 'App Administrator']} userRole={userRole}>
                <BankNeftReport userRole={userRole} userEmail={userEmail} />
              </RoleProtectedRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/misspunch-report"
          element={
            <ProtectedRoute>
              <RoleProtectedRoute allowedRoles={['App User', 'App Administrator']} userRole={userRole}>
                <Misspunch userRole={userRole} userEmail={userEmail} />
              </RoleProtectedRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/latein-report"
          element={
            <ProtectedRoute>
              <RoleProtectedRoute allowedRoles={['App User', 'App Administrator']} userRole={userRole}>
                <LateInReport userRole={userRole} userEmail={userEmail} />
              </RoleProtectedRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/statutoryregisters"
          element={
            <ProtectedRoute>
              <RoleProtectedRoute allowedRoles={['App User', 'App Administrator']} userRole={userRole}>
                <StatutoryRegisters userRole={userRole} userEmail={userEmail} />
              </RoleProtectedRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/criticalincident"
          element={
            <ProtectedRoute>
              <RoleProtectedRoute allowedRoles={['App User', 'App Administrator']} userRole={userRole}>
                <CriticalIncident userRole={userRole} userEmail={userEmail} />
              </RoleProtectedRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/payment"
          element={
            <ProtectedRoute>
              <RoleProtectedRoute allowedRoles={['App User', 'App Administrator']} userRole={userRole}>
                <Payment />
              </RoleProtectedRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/payroll"
          element={
            <ProtectedRoute>
              <RoleProtectedRoute allowedRoles={['App User', 'App Administrator']} userRole={userRole}>
                <Payroll />
              </RoleProtectedRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/payroll-report"
          element={
            <ProtectedRoute>
              <RoleProtectedRoute allowedRoles={['App User', 'App Administrator']} userRole={userRole}>
                <PayrollReport />
              </RoleProtectedRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/pf-report"
          element={
            <ProtectedRoute>
              <RoleProtectedRoute allowedRoles={['App User', 'App Administrator']} userRole={userRole}>
                <PFReport />
              </RoleProtectedRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/esi-report"
          element={
            <ProtectedRoute>
              <RoleProtectedRoute allowedRoles={['App User', 'App Administrator']} userRole={userRole}>
                <ESIReport />
              </RoleProtectedRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/payslip-template"
          element={
            <ProtectedRoute>
              <RoleProtectedRoute allowedRoles={['App User', 'App Administrator']} userRole={userRole}>
                <PayslipTemplatePage />
              </RoleProtectedRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/detection"
          element={
            <ProtectedRoute>
              <RoleProtectedRoute allowedRoles={['App User', 'App Administrator']} userRole={userRole}>
                <Detection userRole={userRole} userEmail={userEmail} />
              </RoleProtectedRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/grace"
          element={
            <ProtectedRoute>
              <RoleProtectedRoute allowedRoles={['App User', 'App Administrator']} userRole={userRole}>
                <Grace />
              </RoleProtectedRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/onduty"
          element={
            <ProtectedRoute>
              <RoleProtectedRoute allowedRoles={['App User', 'App Administrator']} userRole={userRole}>
                <OnDutyManagement userRole={userRole} userEmail={userEmail} />
              </RoleProtectedRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/permission"
          element={
            <ProtectedRoute>
              <RoleProtectedRoute allowedRoles={['App User', 'App Administrator']} userRole={userRole}>
                <PermissionManagement userRole={userRole} userEmail={userEmail} />
              </RoleProtectedRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/compoff"
          element={
            <ProtectedRoute>
              <RoleProtectedRoute allowedRoles={['App User', 'App Administrator']} userRole={userRole}>
                <CompOff userRole={userRole} userEmail={userEmail} />
              </RoleProtectedRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/calendar"
          element={
            <ProtectedRoute>
              <RoleProtectedRoute allowedRoles={['App User', 'App Administrator']} userRole={userRole}>
                <Calendar userRole={userRole} userEmail={userEmail} />
              </RoleProtectedRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/setupconfig"
          element={
            <ProtectedRoute>
              <RoleProtectedRoute allowedRoles={['App User', 'App Administrator']} userRole={userRole}>
                <SetupConfig userRole={userRole} userEmail={userEmail} />
              </RoleProtectedRoute>
            </ProtectedRoute>
          }
        />
        {/* Catch-all route */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </LimitedUserRouteGuard>
    </Router>
  );
}

export default App;
