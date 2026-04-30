import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import './Grace.css';
import './App.css';
import './helper.css';
import { Link } from 'react-router-dom';
import HeaderBranding from './HeaderBranding';
// ...removed sspowerlogo import...
import Button from './Button';
import * as XLSX from 'xlsx';
import { getSidebarModulesForUser, resolveSidebarUserEmail } from './modulesConfig';
import {
  Users, Calendar, FileText, AlertTriangle, FolderOpen,
  ClipboardList, Building, Handshake, Landmark, Clock,
  Map, BarChart3, User, TrendingUp, TrendingDown,
  Activity, Plus, CheckCircle, Bell, Settings, LayoutDashboard, Home as HomeIcon,
  Shield, AlertOctagon, CreditCard, FileSignature, Search, Clock3, CalendarDays, Database
} from 'lucide-react';

const Grace = () => {
  console.log('Grace component is rendering');
  const userEmail = localStorage.getItem('userEmail') || null;
  const navigate = useNavigate();
  const location = useLocation();
  
  const [graceData, setGraceData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedStartDate, setSelectedStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [selectedEndDate, setSelectedEndDate] = useState(new Date().toISOString().slice(0, 10));
  const [employeeCode, setEmployeeCode] = useState('All');
  const [employeeCodes, setEmployeeCodes] = useState(['All']);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState('');
  const [calculating, setCalculating] = useState(false);

  // Sidebar state
  const [expandedMenus, setExpandedMenus] = useState({});
  const [showNotifications, setShowNotifications] = useState(false);
  const [showSidebarMenu, setShowSidebarMenu] = useState(false);

  // User info
  const userAvatar = "https://images.pexels.com/photos/2379004/pexels-photo-2379004.jpeg?auto=compress&cs=tinysrgb&w=150";
  const userName = 'Admin User';
  const userRole = localStorage.getItem('userRole') || 'App Administrator';

  const modulesToShow = useMemo(
    () => getSidebarModulesForUser(resolveSidebarUserEmail(userEmail), userRole),
    [userEmail, userRole]
  );

  // Toggle expandable menus
  const toggleMenu = (index) => {
    setExpandedMenus(prev => ({
      ...prev,
      [index]: !prev[index]
    }));
  };

  // Function to fetch grace data
  const fetchGraceData = useCallback(async () => {
    try {
      console.log('=== FETCH GRACE DATA DEBUG START ===');
      setLoading(true);
      setError(null);
      
      let url = `/server/grace_function/grace?startDate=${selectedStartDate}&endDate=${selectedEndDate}&_t=${Date.now()}`;
      if (employeeCode !== 'All') url += `&employeeCode=${encodeURIComponent(employeeCode)}`;
      
      console.log('Fetching grace data from:', url);
      console.log('Current filters:', { selectedStartDate, selectedEndDate, employeeCode });
      
      const res = await fetch(url);
      console.log('Response status:', res.status);
      console.log('Response ok:', res.ok);
      
      if (!res.ok) {
        const errorText = await res.text();
        console.error('Response error:', errorText);
        throw new Error(`Failed to fetch grace data: ${res.status} ${errorText}`);
      }
      
      const result = await res.json();
      console.log('Grace data received:', result);
      console.log('Data array length:', result.data ? result.data.length : 0);
      
      // Force a new array reference to ensure React re-renders
      const newGraceData = result.data ? [...result.data] : [];
      setGraceData(newGraceData);
      console.log('Grace data state updated with', newGraceData.length, 'records');
      
      console.log('=== FETCH GRACE DATA DEBUG END - SUCCESS ===');
    } catch (err) {
      console.error('=== FETCH GRACE DATA DEBUG END - ERROR ===');
      console.error('Error fetching grace data:', err);
      setError(err.message);
      setGraceData([]);
    } finally {
      setLoading(false);
    }
  }, [selectedStartDate, selectedEndDate, employeeCode]);

  // Fetch grace data when filters change
  useEffect(() => {
    console.log('useEffect triggered for grace data');
    fetchGraceData();
  }, [fetchGraceData]);

  // Fetch employee codes
  useEffect(() => {
    console.log('Fetching employee codes');
    fetch('/server/grace_function/employee-codes')
      .then(res => {
        console.log('Employee codes response:', res.status);
        return res.json();
      })
      .then(data => {
        console.log('Employee codes data:', data);
        setEmployeeCodes(['All', ...(data.data || [])]);
      })
      .catch(err => {
        console.error('Error fetching employee codes:', err);
        setEmployeeCodes(['All']);
      });
  }, []);

  // Handle calculate grace periods
  const handleCalculateGrace = async () => {
    setCalculating(true);
    setError(null);
    setSuccess('');
    
    try {
      const response = await fetch('/server/grace_function/calculate-grace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startDate: selectedStartDate,
          endDate: selectedEndDate
        })
      });

      const result = await response.json();

      if (!response.ok || result.status !== 'success') {
        throw new Error(result.message || result.error || `HTTP ${response.status}`);
      }

      setSuccess(result.message || 'Grace periods calculated successfully!');
      setTimeout(() => setSuccess(''), 5000);
      
      // Refresh data after calculation
      await fetchGraceData();
    } catch (err) {
      console.error('Error calculating grace periods:', err);
      setError('Failed to calculate grace periods: ' + err.message);
    } finally {
      setCalculating(false);
    }
  };

  const exportToExcel = () => {
    try {
      console.log('Exporting grace data to Excel...');
      
      if (!graceData || graceData.length === 0) {
        alert('No grace data available to export.');
        return;
      }

      // Prepare data for export
      const exportData = graceData.map((record, index) => ({
        'S.No': index + 1,
        'Employee Code': record.employeeCode || '',
        'Employee Name': record.employeeName || '',
        'First In': record.firstIn || '',
        'Grace Minutes': record.graceMinutes || '',
        'Grace Hour': record.graceHour || ''
      }));

      // Create workbook and worksheet
      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.json_to_sheet(exportData);

      // Set column widths
      const columnWidths = [
        { wch: 8 },   // S.No
        { wch: 15 },  // Employee Code
        { wch: 25 },  // Employee Name
        { wch: 12 },  // First In
        { wch: 15 },  // Grace Minutes
        { wch: 12 }   // Grace Hour
      ];
      worksheet['!cols'] = columnWidths;

      // Add worksheet to workbook
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Grace Report');

      // Generate filename
      const currentDate = new Date();
      const dateStr = currentDate.toISOString().split('T')[0];
      const filename = `Grace_Report_${selectedStartDate}_to_${selectedEndDate}_${dateStr}.xlsx`;

      // Export the file
      XLSX.writeFile(workbook, filename);
      
      console.log(`Excel file exported successfully: ${filename}`);
      setSuccess(`Excel file exported successfully: ${filename}`);
      setTimeout(() => setSuccess(''), 3000);
      
    } catch (error) {
      console.error('Error exporting to Excel:', error);
      setError('Failed to export Excel file: ' + error.message);
    }
  };

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

          {/* Grace Content */}
          <div className="grace-container">
            {error && (
              <div style={{ padding: '20px', background: 'orange', color: 'white', margin: '10px', borderRadius: '5px' }}>
                ERROR: {error}
              </div>
            )}
            
            {success && (
              <div style={{ padding: '20px', background: 'green', color: 'white', margin: '10px', borderRadius: '5px' }}>
                SUCCESS: {success}
              </div>
            )}
            
            {/* Grace Controls */}
            <div className="grace-filters">
              <h1 className="grace-title">Grace Period Report</h1>
              <div className="filters-row">
                <div className="filter-group">
                  <label htmlFor="startDate">Start Date:</label>
                  <input
                    type="date"
                    id="startDate"
                    value={selectedStartDate}
                    onChange={(e) => setSelectedStartDate(e.target.value)}
                    className="filter-select"
                  />
                </div>
                <div className="filter-group">
                  <label htmlFor="endDate">End Date:</label>
                  <input
                    type="date"
                    id="endDate"
                    value={selectedEndDate}
                    onChange={(e) => setSelectedEndDate(e.target.value)}
                    className="filter-select"
                  />
                </div>
                <div className="filter-group">
                  <label htmlFor="employee">Employee Code:</label>
                  <select
                    id="employee"
                    value={employeeCode}
                    onChange={(e) => setEmployeeCode(e.target.value)}
                    className="filter-select"
                  >
                    {employeeCodes.map(emp => (
                      <option key={emp} value={emp}>
                        {emp}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="export-buttons">
                <button 
                  onClick={handleCalculateGrace}
                  className="run-payroll-btn"
                  disabled={calculating}
                  title="Calculate grace periods for the selected date range"
                >
                  {calculating ? 'Calculating...' : 'Calculate Grace Periods'}
                </button>
                <button 
                  onClick={exportToExcel} 
                  className="export-btn excel-btn"
                  disabled={graceData.length === 0}
                >
                  Export to Excel
                </button>
                <button 
                  onClick={fetchGraceData} 
                  className="export-btn refresh-btn"
                  disabled={loading}
                  title="Refresh grace data"
                >
                  {loading ? 'Refreshing...' : 'Refresh Data'}
                </button>
              </div>
            </div>

            {/* Summary Cards */}
            {graceData.length > 0 && (
              <div className="grace-summary">
                <div className="summary-card">
                  <h3>Total Records</h3>
                  <span>{graceData.length}</span>
                </div>
                <div className="summary-card">
                  <h3>Total Grace Minutes</h3>
                  <span>{graceData.reduce((sum, record) => sum + (parseInt(record.graceMinutes) || 0), 0)} mins</span>
                </div>
                <div className="summary-card summary-card-average">
                  <h3>Average Grace Minutes</h3>
                  <span>{graceData.length > 0 ? Math.round(graceData.reduce((sum, record) => sum + (parseInt(record.graceMinutes) || 0), 0) / graceData.length) : 0} mins</span>
                </div>
              </div>
            )}

            {/* Grace Table */}
            <div className="grace-table-container">
              {loading ? (
                <div className="loading">Loading grace data...</div>
              ) : (
                <table className="grace-table">
                  <thead>
                    <tr className="table-header">
                      <th className="col-sno">S.No</th>
                      <th className="col-emp-code">Employee Code</th>
                      <th className="col-emp-name">Employee Name</th>
                      <th className="col-first-in">First In</th>
                      <th className="col-grace-minutes">Grace Minutes</th>
                      <th className="col-grace-hour">Grace Hour</th>
                    </tr>
                  </thead>
                  <tbody>
                    {graceData && Array.isArray(graceData) && graceData.length > 0 ? graceData.map((record, index) => {
                      // If employeeName is empty, null, or same as employeeCode, show empty
                      const displayName = record.employeeName && 
                                         record.employeeName.trim() !== '' && 
                                         record.employeeName !== record.employeeCode 
                                        ? record.employeeName 
                                        : '';
                      return (
                        <tr key={record.id || index} className="table-row">
                          <td className="col-sno">{index + 1}</td>
                          <td className="col-emp-code">{record.employeeCode || ''}</td>
                          <td className="col-emp-name">{displayName}</td>
                          <td className="col-first-in">{record.firstIn || '-'}</td>
                          <td className="col-grace-minutes">{record.graceMinutes || '0'} mins</td>
                          <td className="col-grace-hour">{record.graceHour || '-'}</td>
                        </tr>
                      );
                    }) : (
                      <tr>
                        <td colSpan="6" className="no-data-message">
                          No grace period data available. Click "Calculate Grace Periods" to generate reports.
                        </td>
                      </tr>
                    )}
                  </tbody>
                  {graceData.length > 0 && (
                    <tfoot>
                      <tr className="table-footer">
                        <td colSpan="4" className="footer-total">Total</td>
                        <td className="col-grace-minutes">{graceData.reduce((sum, record) => sum + (parseInt(record.graceMinutes) || 0), 0)} mins</td>
                        <td className="col-grace-hour"></td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default Grace;
