import React from 'react';
import {
  Users,
  Calendar,
  FileText,
  FolderOpen,
  ClipboardList,
  Building,
  Landmark,
  Clock,
  BarChart3,
  LayoutDashboard,
  Home as HomeIcon,
  Clock3,
  Settings,
  CalendarDays,
  FileSignature,
  AlertTriangle,
} from 'lucide-react';

/**
 * Single source of truth for sidebar navigation order.
 * This exact order is used on ALL sidebar pages (Home, Dashboard, Permission, Payroll, etc.)
 * Order: Home → Dashboard → Organization (Organization, Department, Designation) → Employees → Setup Configuration
 * App User: Organization expands to Department + Designation only (company Organization page link is hidden).
 *        → Time Office (Attendance, Onduty, Permission, Regularization)
 *        → Payroll (Payroll, Payroll Report, Payroll Template)
 *        → Shift (Shift, Shift Roaster)
 *        → Leave (Comboff, Calendar)
 *        → Reports (Monthly OT, LOH, Attendance Muster, Shiftmap Deviation, Grace)
 */
export const sidebarModules = [
  { icon: <HomeIcon size={22} />, label: 'Home', path: '/' },
  { icon: <LayoutDashboard size={22} />, label: 'Dashboard', path: '/dashboard' },
  {
    icon: <Landmark size={22} />,
    label: 'Organization',
    children: [
      { icon: <Landmark size={20} />, label: 'Organization', path: '/organization' },
      { icon: <Building size={20} />, label: 'Department', path: '/time' },
      { icon: <ClipboardList size={20} />, label: 'Designation', path: '/tasks' },
    ],
  },
  { icon: <Users size={22} />, label: 'Employees', path: '/employees' },
  { icon: <Settings size={22} />, label: 'Setup Configuration', path: '/setupconfig' },
  {
    icon: <FolderOpen size={22} />,
    label: 'Time Office',
    children: [
      { icon: <Calendar size={20} />, label: 'Attendance', path: '/attendance' },
      { icon: <Clock size={20} />, label: 'Onduty', path: '/onduty' },
      { icon: <FileSignature size={20} />, label: 'Permission', path: '/permission' },
      { icon: <Clock3 size={20} />, label: 'Regularization', path: '/regularization' },
    ],
  },
  {
    icon: <BarChart3 size={22} />,
    label: 'Payroll',
    children: [
      { icon: <BarChart3 size={20} />, label: 'Payroll', path: '/payroll' },
      { icon: <BarChart3 size={20} />, label: 'Payroll Report', path: '/payroll-report' },
      { icon: <FileText size={20} />, label: 'Payroll Template', path: '/payslip-template' },
    ],
  },
  {
    icon: <Clock size={22} />,
    label: 'Shift',
    children: [
      { icon: <Clock size={20} />, label: 'Shift', path: '/shift' },
      { icon: <CalendarDays size={20} />, label: 'Shift Roaster', path: '/newshiftmap' },
    ],
  },
  {
    icon: <CalendarDays size={22} />,
    label: 'Leave',
    children: [
      { icon: <Clock size={20} />, label: 'Comboff', path: '/compoff' },
      { icon: <Calendar size={20} />, label: 'Calendar', path: '/calendar' },
    ],
  },
  {
    icon: <BarChart3 size={22} />,
    label: 'Reports',
    children: [
      { icon: <BarChart3 size={20} />, label: 'Monthly OT', path: '/reports' },
      { icon: <Clock3 size={20} />, label: 'LOH', path: '/loh-report' },
      { icon: <FileText size={20} />, label: 'Bank Format Report', path: '/bank-format-report' },
      { icon: <FileText size={20} />, label: 'Bank NEFT Report', path: '/bank-neft-report' },
      { icon: <Clock3 size={20} />, label: 'Late In Report', path: '/latein-report' },
      { icon: <Clock3 size={20} />, label: 'Miss Punch Report', path: '/misspunch-report' },
      { icon: <FolderOpen size={20} />, label: 'Attendance Muster', path: '/attendancemuster' },
      { icon: <FileSignature size={20} />, label: 'Permission Report', path: '/permission-report' },
      { icon: <AlertTriangle size={20} />, label: 'Shiftmap Deviation', path: '/shiftmapdeviation' },
      { icon: <Clock3 size={20} />, label: 'Grace', path: '/grace' },
    ],
  },
];

/** Logins that see only Dashboard + Employees + Payroll in the sidebar (and matching route access). */
const LIMITED_SIDEBAR_USER_EMAILS = new Set(['ashwathkumar1245@gmail.com']);

/** Logins that see the full sidebar except Dashboard and Setup Configuration (routes blocked too). */
const HIDE_DASHBOARD_AND_SETUP_USER_EMAILS = new Set([]);

export function normalizeAppUserEmail(userEmail) {
  return String(userEmail || '').trim().toLowerCase();
}

export function isLimitedSidebarUser(userEmail) {
  return LIMITED_SIDEBAR_USER_EMAILS.has(normalizeAppUserEmail(userEmail));
}

export function isHideDashboardAndSetupUser(userEmail) {
  return HIDE_DASHBOARD_AND_SETUP_USER_EMAILS.has(normalizeAppUserEmail(userEmail));
}

/** Routes a limited-sidebar user may open (exact path; no sub-routes today). */
export const LIMITED_SIDEBAR_ALLOWED_PATHS = [
  '/dashboard',
  '/employees',
  '/payroll',
  '/payroll-report',
  '/payslip-template',
];

/** Resolve email from props or localStorage (after login) for sidebar filtering. */
export function resolveSidebarUserEmail(userEmail) {
  return userEmail ?? (typeof localStorage !== 'undefined' ? localStorage.getItem('userEmail') : null);
}

/** Role from localStorage (set in App.js after login). May be stale briefly after localStorage.clear(). */
export function resolveSidebarUserRole() {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem('userRole');
}

/** Prefer React state from callers; falls back to localStorage. Trim + case-insensitive. */
export function isAppUserRole(userRole) {
  const r = String(userRole ?? resolveSidebarUserRole() ?? '').trim().toLowerCase();
  return r === 'app user';
}

/** App User: keep Organization in the sidebar; under it show only Department and Designation (not /organization). */
function filterOrganizationChildrenForAppUser(modules, userRole) {
  if (!isAppUserRole(userRole)) return modules;
  return modules.map((m) => {
    if (m.label !== 'Organization' || !Array.isArray(m.children)) return m;
    return {
      ...m,
      children: m.children.filter((c) => c.path !== '/organization'),
    };
  });
}

/**
 * @param {string|null|undefined} userEmail
 * @param {string|null|undefined} userRole - pass from React (e.g. App state) so filtering works after login; localStorage alone can be wrong until role is re-stored.
 */
export function getSidebarModulesForUser(userEmail, userRole) {
  let modules;
  if (isLimitedSidebarUser(userEmail)) {
    const dashboard = sidebarModules.find((m) => m.path === '/dashboard');
    const employees = sidebarModules.find((m) => m.path === '/employees');
    const payroll = sidebarModules.find((m) => m.label === 'Payroll' && m.children);
    modules = [dashboard, employees, payroll].filter(Boolean);
  } else if (isHideDashboardAndSetupUser(userEmail)) {
    modules = sidebarModules.filter(
      (m) =>
        m.path !== '/dashboard' &&
        m.label !== 'Dashboard' &&
        m.path !== '/setupconfig' &&
        m.label !== 'Setup Configuration'
    );
  } else {
    modules = sidebarModules;
  }

  const resolvedRole = userRole !== undefined ? userRole : resolveSidebarUserRole();
  return filterOrganizationChildrenForAppUser(modules, resolvedRole);
}

// Legacy export for any code still using allModules
export const allModules = sidebarModules;

export default sidebarModules;
