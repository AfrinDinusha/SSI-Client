import React, { useState, useEffect, useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import './Attendance.css';
import './employeeManagement.css';
import './Candidateform.css';
import HeaderBranding from './HeaderBranding';
import { getSidebarModulesForUser, resolveSidebarUserEmail } from './modulesConfig';
import * as XLSX from 'xlsx';
import { 
  Calendar, Users, FileText, AlertTriangle, FolderOpen, 
  ClipboardList, Building, Handshake, Landmark, Clock, 
  Map, BarChart3, User, TrendingUp, TrendingDown,
  Activity, Plus, CheckCircle, Bell, Settings, LayoutDashboard, Home as HomeIcon, AlertOctagon, CreditCard, Shield, Search, Clock3
} from 'lucide-react';

function Attendance({ userRole, userEmail }) {
  const [attendance, setAttendance] = useState([]);
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const pageSize = 200;
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [fetchResult, setFetchResult] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [expandedMenus, setExpandedMenus] = useState({});
  const [showNotifications, setShowNotifications] = useState(false);
  const [showSidebarMenu, setShowSidebarMenu] = useState(false);
  const [importFile, setImportFile] = useState(null);
  const [importLoading, setImportLoading] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [importedData, setImportedData] = useState([]);
  const [employeesList, setEmployeesList] = useState([]);

  // Map EmployeeID (id or employeeCode) -> EmployeeName from cms_function
  const employeeNameMap = useMemo(() => {
    const map = {};
    (employeesList || []).forEach((emp) => {
      const name = emp.employeeName || emp.name || '';
      if (emp.id != null) map[String(emp.id)] = name;
      if (emp.employeeCode) map[String(emp.employeeCode)] = name;
    });
    return map;
  }, [employeesList]);

  // Fetch employees from cms_function for EmployeeName lookup
  useEffect(() => {
    const fetchEmployees = async () => {
      try {
        const userRoleParam = userRole ? `userRole=${encodeURIComponent(userRole)}` : '';
        const userEmailParam = userEmail ? `userEmail=${encodeURIComponent(userEmail)}` : '';
        const queryParams = [userRoleParam, userEmailParam].filter(Boolean).join('&');
        const url = queryParams ? `/server/cms_function/employees?${queryParams}` : '/server/cms_function/employees';
        const res = await fetch(url);
        if (!res.ok) return;
        const result = await res.json();
        const list = result?.data?.employees || [];
        setEmployeesList(list);
      } catch (err) {
        console.error('Attendance: fetch employees error', err);
      }
    };
    fetchEmployees();
  }, [userRole, userEmail]);

  const location = useLocation();
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

  // Improved error handling and removed 'append' param
  const loadAttendance = async (customStart, customEnd, pageNum = 1) => {
    setLoading(true);
    setFetchResult(null);
    try {
      let url = `/server/GetAttendanceList?page=${pageNum}&pageSize=${pageSize}`;
      if (customStart && customEnd) {
        url += `&startDate=${customStart}&endDate=${customEnd}`;
      }
      url += `${url.includes('?') ? '&' : '?'}summary=true`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to load attendance data');
      const result = await res.json();
      const data = result.data || [];
      console.log('Backend response structure:', result);
      console.log('Attendance data sample:', data.slice(0, 2));
      setHasMore(result.hasMore);
      setAttendance(data);
      setTotalCount(result.totalCount || data.length);
    } catch (err) {
      console.error('Load attendance error:', err);
      setFetchResult(`Error loading attendance data: ${err.message || 'Unknown error'}`);
      setAttendance([]);
      setTotalCount(0);
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  };

  // Fetch attendance data from ESSL for a date range
  const fetchESSLData = async (e) => {
    e.preventDefault();
    if (!fromDate || !toDate) {
      setFetchResult('Please select both start and end dates.');
      return;
    }
    setFetching(true);
    setFetchResult(null);
    try {
      console.log(`Fetching ESSL data for range: ${fromDate} to ${toDate}`);
      const esslUrl = 'http://www.esslcloud.com/SSINDUST/Main.aspx';
      const esslUser = 'SSINDUST';
      const esslPassword = 'SSIndust@2026';
      // No serial param: backend fetches both devices and merges daily first/last as IN/OUT
      const res = await fetch(`/server/attendance_function?fromDateTime=${fromDate} 00:00:00&toDateTime=${toDate} 23:59:59&url=${encodeURIComponent(esslUrl)}&user=${esslUser}&password=${esslPassword}`, { method: 'POST' });
      const result = await res.json();
      console.log('ESSL fetch response:', result);
      
      if (res.ok) {
        setFetchResult(`Success: ${result.message}, Inserted: ${result.transaction_count}`);
        // Optionally reload attendance data after fetch
        loadAttendance(fromDate, toDate, 1);
      } else {
        const errorMsg = result.error || result.message || 'Error fetching data';
        setFetchResult(`Error: ${errorMsg}`);
        console.error('ESSL fetch error:', result);
      }
    } catch (err) {
      console.error('Fetch ESSL error:', err);
      setFetchResult(`Network Error: ${err.message || 'Unable to connect to ESSL server. Please check server connectivity.'}`);
    }
    setFetching(false);
  };

  // Test backend connectivity
  const testBackendConnectivity = async () => {
    try {
      console.log('Testing backend connectivity...');
      
      // Test health endpoint
      const healthResponse = await fetch('/server/importattendance_function/health');
      const healthResult = await healthResponse.json();
      console.log('Health check result:', healthResult);
      
      // Test database connectivity
      const dbResponse = await fetch('/server/importattendance_function/test-db');
      const dbResult = await dbResponse.json();
      console.log('Database test result:', dbResult);
      
      return { health: healthResult, database: dbResult };
    } catch (error) {
      console.error('Backend connectivity test failed:', error);
      throw error;
    }
  };

  // Fetch attendance data from backend
  const fetchAttendanceData = async (filters = {}) => {
    try {
      const queryParams = new URLSearchParams();
      if (filters.startDate) queryParams.append('startDate', filters.startDate);
      if (filters.endDate) queryParams.append('endDate', filters.endDate);
      if (filters.employeeId) queryParams.append('employeeId', filters.employeeId);
      if (filters.status) queryParams.append('status', filters.status);
      if (filters.page) queryParams.append('page', filters.page);
      if (filters.pageSize) queryParams.append('pageSize', filters.pageSize);

      const response = await fetch(`/server/importattendance_function?${queryParams.toString()}`);
      const result = await response.json();
      
      if (response.ok && result.success) {
        return result;
      } else {
        throw new Error(result.error || 'Failed to fetch attendance data');
      }
    } catch (error) {
      console.error('Error fetching attendance data:', error);
      throw error;
    }
  };

  // Import attendance data from Excel file
  const importAttendanceData = async (e) => {
    e.preventDefault();
    if (!importFile) {
      setImportResult('Please select an Excel file to import.');
      return;
    }
    setImportLoading(true);
    setImportResult(null);
    try {
      console.log('Import file selected:', importFile);
      console.log('File name:', importFile?.name);
      console.log('File size:', importFile?.size);
      console.log('File type:', importFile?.type);
      
      // Read Excel file directly in the browser
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const data = new Uint8Array(e.target.result);
          const workbook = XLSX.read(data, { type: 'array' });
          const sheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[sheetName];
          const jsonData = XLSX.utils.sheet_to_json(worksheet);
          
          console.log('Parsed Excel data:', jsonData.length, 'rows');
          
          if (jsonData.length === 0) {
            setImportResult('Excel file is empty or has no valid data');
            setImportLoading(false);
            return;
          }
          
          // Validate column headers with flexible matching
          const firstRow = jsonData[0];
          const availableColumns = Object.keys(firstRow);
          console.log('Excel file columns found:', availableColumns);
          console.log('First row data:', firstRow);
          console.log('Column names with spaces:', availableColumns.map(col => `"${col}"`));
          
          // Function to find column with case-insensitive matching and space handling
          const findColumn = (possibleNames) => {
            console.log('Looking for column in:', possibleNames);
            for (const name of possibleNames) {
              console.log(`  Checking "${name}"`);
              // Exact match first
              if (availableColumns.includes(name)) {
                console.log(`    Exact match found: "${name}"`);
                return name;
              }
              // Case-insensitive match
              const found = availableColumns.find(col => 
                col.toLowerCase() === name.toLowerCase()
              );
              if (found) {
                console.log(`    Case-insensitive match found: "${found}"`);
                return found;
              }
              // Case-insensitive match with trimmed spaces
              const foundTrimmed = availableColumns.find(col => 
                col.trim().toLowerCase() === name.toLowerCase()
              );
              if (foundTrimmed) {
                console.log(`    Trimmed match found: "${foundTrimmed}"`);
                return foundTrimmed;
              }
            }
            console.log('  No match found');
            return null;
          };
          
          // Find actual column names
          const foundColumns = {
            employeeId: findColumn(['EmployeeId', 'Employee ID', 'employeeid', 'employee_id', 'emp_id', 'EmpId']),
            attendanceDate: findColumn(['AttendanceDate', 'Attendance Date', 'attendance_date', 'date', 'Date', 'DATE', 'Work Date', 'work_date', 'WorkDate']),
            firstIn: findColumn(['FirstIn', 'First IN', 'first_in', 'firstin', 'In Time', 'in_time', 'checkin']),
            lastOut: findColumn(['LastOut', 'Last OUT', 'last_out', 'lastout', 'Out Time', 'out_time', 'checkout']),
            status: findColumn(['Status', 'status', 'Attendance Status', 'attendance_status', 'Present', 'present', 'Absent', 'absent'])
          };
          
          console.log('Mapped columns:', foundColumns);
          
          // Check if all required columns are found (only the first 4 are required)
          const requiredColumns = ['employeeId', 'attendanceDate', 'firstIn', 'lastOut'];
          const missingRequiredColumns = requiredColumns.filter(key => !foundColumns[key]);
          
          if (missingRequiredColumns.length > 0) {
            setImportResult(`Missing required columns: ${missingRequiredColumns.join(', ')}. Found columns: ${availableColumns.join(', ')}`);
            setImportLoading(false);
            return;
          }
          
          // Log optional columns found
          const optionalColumns = ['status'];
          const foundOptionalColumns = optionalColumns.filter(key => foundColumns[key]);
          if (foundOptionalColumns.length > 0) {
            console.log('Optional columns found:', foundOptionalColumns);
          }
          
          // Process Excel data and convert to attendance format
          const processedData = [];
          let importedCount = 0;
          let errorCount = 0;
          const errors = [];
          
          // Initialize response object
          let response = {
            success: false,
            importedCount: 0,
            errorCount: 0,
            message: ''
          };
          
          // Helper function to convert Excel serial date to readable format
          const convertExcelDate = (excelDate) => {
            if (!excelDate) return '';
            
            // If it's already a string in correct format, return as is
            if (typeof excelDate === 'string' && excelDate.includes('-')) {
              return excelDate;
            }
            
            // Convert Excel serial date to JavaScript Date
            // Excel serial date starts from 1900-01-01, but JavaScript Date starts from 1970-01-01
            // Excel also has a leap year bug, so we need to adjust
            const excelEpoch = new Date(1900, 0, 1);
            const jsDate = new Date(excelEpoch.getTime() + (excelDate - 2) * 24 * 60 * 60 * 1000);
            
            // Format as DD-MM-YYYY
            const day = String(jsDate.getDate()).padStart(2, '0');
            const month = String(jsDate.getMonth() + 1).padStart(2, '0');
            const year = jsDate.getFullYear();
            
            return `${day}-${month}-${year}`;
          };
          
          // Helper function to convert Excel fractional day to time format
          const convertExcelTime = (excelTime) => {
            if (!excelTime) return '';
            
            // If it's already a string in correct format, return as is
            if (typeof excelTime === 'string' && excelTime.includes(':')) {
              return excelTime;
            }
            
            // Convert fractional day to hours, minutes, seconds
            const totalSeconds = Math.round(excelTime * 24 * 60 * 60);
            const hours = Math.floor(totalSeconds / 3600);
            const minutes = Math.floor((totalSeconds % 3600) / 60);
            const seconds = totalSeconds % 60;
            
            return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
          };
          
          jsonData.forEach((row, index) => {
            try {
              const employeeId = String(row[foundColumns.employeeId] || '').trim();
              const rawAttendanceDate = row[foundColumns.attendanceDate];
              const rawFirstIn = row[foundColumns.firstIn];
              const rawLastOut = row[foundColumns.lastOut];
              
              // Debug: Log raw values
              console.log(`Row ${index + 2} raw values:`, {
                rawAttendanceDate,
                rawFirstIn,
                rawLastOut,
                types: {
                  attendanceDate: typeof rawAttendanceDate,
                  firstIn: typeof rawFirstIn,
                  lastOut: typeof rawLastOut
                }
              });
              
              // Convert Excel formats to readable formats
              const attendanceDate = convertExcelDate(rawAttendanceDate);
              const firstIn = convertExcelTime(rawFirstIn);
              const lastOut = convertExcelTime(rawLastOut);
              
              console.log(`Row ${index + 2} converted values:`, {
                attendanceDate,
                firstIn,
                lastOut
              });
              
              // Get optional columns if they exist
              const status = foundColumns.status ? String(row[foundColumns.status] || '').trim() : '';
              
              if (!employeeId || !attendanceDate) {
                errorCount++;
                errors.push(`Row ${index + 2}: Missing EmployeeId or AttendanceDate`);
                return;
              }
              
              // Create attendance record
              const attendanceRecord = {
                EmployeeID: employeeId,
                Date: attendanceDate,
                FirstIN: firstIn ? `${attendanceDate} ${firstIn}` : '',
                LastOUT: lastOut ? `${attendanceDate} ${lastOut}` : '',
                Status: status || (firstIn && lastOut ? getStatus(`${attendanceDate} ${firstIn}`, `${attendanceDate} ${lastOut}`) : ''),
                Source: 'Excel Import'
              };
              
              processedData.push(attendanceRecord);
              importedCount++;
              
            } catch (rowError) {
              console.error(`Error processing row ${index + 2}:`, rowError);
              errorCount++;
              errors.push(`Row ${index + 2}: ${rowError.message}`);
            }
          });
          
          // Send processed data to backend for storage
          try {
            console.log('Sending processed data to backend for storage');
            
            const backendResponse = await fetch('/server/importattendance_function', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                attendanceData: processedData
              })
            });
            
            if (!backendResponse.ok) {
              const errorText = await backendResponse.text();
              console.error('Backend storage error:', errorText);
              throw new Error(`Backend storage failed (${backendResponse.status}): ${errorText}`);
            }
            
            const backendResult = await backendResponse.json();
            console.log('Data successfully stored in backend:', backendResult);
            
            // Update response with backend result
            response.message = backendResult.message;
            response.importedCount = backendResult.importedCount;
            response.errorCount = backendResult.errorCount;
            
          } catch (backendError) {
            console.error('Backend storage error:', backendError);
            // Fallback to local storage if backend fails
            response.message = `Processed ${importedCount} records locally but failed to store in backend: ${backendError.message}`;
          }
          
          // Set imported data for display
          setImportedData(processedData);
          
          // Store imported data in localStorage for Dashboard access
          localStorage.setItem('importedAttendanceData', JSON.stringify(processedData));
          
          // Dispatch custom event to notify Dashboard of changes
          window.dispatchEvent(new CustomEvent('importedDataChanged'));
          
          // Update response with final values
          response.success = errorCount === 0;
          response.importedCount = importedCount;
          response.errorCount = errorCount;
          if (!response.message) {
            response.message = `Successfully imported ${importedCount} attendance records${errorCount > 0 ? ` with ${errorCount} errors` : ''}`;
          }
          
          if (errors.length > 0) {
            response.errors = errors.slice(0, 10); // Limit to first 10 errors
          }
          
          setImportResult(`Success: ${response.message}`);
          console.log('Import completed:', response);
          
        } catch (parseError) {
          console.error('Excel parsing error:', parseError);
          setImportResult(`Failed to parse Excel file: ${parseError.message}`);
        }
        setImportLoading(false);
      };
      
      reader.onerror = () => {
        setImportResult('Failed to read the Excel file.');
        setImportLoading(false);
      };
      
      reader.readAsArrayBuffer(importFile);
      
    } catch (err) {
      console.error('Import error:', err);
      setImportResult(`Import failed: ${err.message || 'Unknown error'}`);
      setImportLoading(false);
    }
  };

  // Pagination handlers
  const handleNextPage = () => {
    if (hasMore && !loading) {
      const nextPage = currentPage + 1;
      setCurrentPage(nextPage);
      loadAttendance(fromDate, toDate, nextPage);
    }
  };
  const handlePrevPage = () => {
    if (currentPage > 1 && !loading) {
      const prevPage = currentPage - 1;
      setCurrentPage(prevPage);
      loadAttendance(fromDate, toDate, prevPage);
    }
  };

  // ESSL: two devices, both used for IN and OUT (see FetchESSLData.js — merged per employee per day)

  // Helper to extract date and time parts
  function extractDate(dateTimeStr) {
    if (!dateTimeStr) return '';
    return dateTimeStr.split(' ')[0];
  }
  function extractTime(dateTimeStr) {
    if (!dateTimeStr) return '';
    return dateTimeStr.split(' ')[1] || '';
  }

  // Note: calculateTotalHours and calculateOvertime functions removed as per user request
  // These functions were not being used in the table display and overtime calculation
  // has been removed from the payroll system

  // Helper to determine status based on total hours
  function getStatus(firstIn, lastOut) {
    if (!firstIn || !lastOut) return '';
    const inDate = new Date(firstIn.replace(' ', 'T'));
    const outDate = new Date(lastOut.replace(' ', 'T'));
    if (isNaN(inDate) || isNaN(outDate)) return '';
    let diffMs = outDate - inDate;
    if (diffMs < 0) return '';
    const hours = diffMs / (1000 * 60 * 60);
    if (hours >= 7) return 'Present';
    if (hours >= 4) return 'Half Day Present';
    return 'Absent';
  }

  // User info
  const userAvatar = "https://images.pexels.com/photos/2379004/pexels-photo-2379004.jpeg?auto=compress&cs=tinysrgb&w=150";
  const userName = userRole === 'App Administrator' ? 'Admin User' : 'App User';

  // Sample activity data with Lucide icons
  const recentActivities = [
    { icon: <User size={20} />, title: 'New Employee Added', description: 'John Doe joined the development team', time: '2 hours ago' },
    { icon: <BarChart3 size={20} />, title: 'Monthly Report Generated', description: 'Contractor performance report is ready', time: '4 hours ago' },
    { icon: <CheckCircle size={20} />, title: 'Contract Approved', description: 'ABC Construction contract approved', time: '6 hours ago' },
    { icon: <Bell size={20} />, title: 'System Update', description: 'Payroll Management System updated to version 2.1', time: '1 day ago' },
    { icon: <Plus size={20} />, title: 'New Application', description: 'Candidate applied for senior position', time: '2 days ago' }
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
                        className="cms-nav-child"
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
                  className="cms-nav-item"
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
              <h1>Attendance Management</h1>
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
            {/* Attendance Form Card */}
            <div className="employee-card-container">
              <div className="employee-section-title">Attendance Data Management</div>
              <div className="employee-section-subtitle">
                Manage attendance records and fetch ESSL data with comprehensive reporting
              </div>
              
              <form onSubmit={fetchESSLData} className="attendance-form">
                <div className="attendance-date-group">
                  <label>
                    From:
                    <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} disabled={fetching || loading} />
                  </label>
                  <label>
                    To:
                    <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} disabled={fetching || loading} />
                  </label>
                </div>
                <div className="attendance-form-buttons">
                  <button
                    type="button"
                    className="cms-btn primary"
                    disabled={fetching || loading || !fromDate || !toDate}
                    onClick={() => {
                      if (fromDate && toDate) {
                        setCurrentPage(1);
                        loadAttendance(fromDate, toDate, 1);
                      }
                    }}
                  >
                    Fetch Attendance Data for Range
                  </button>
                  <button type="submit" className="cms-btn primary" disabled={fetching || loading || !fromDate || !toDate}>
                    Fetch ESSL Data for Range
                  </button>
                </div>
              </form>
              
              {fetchResult && <div className={`attendance-message ${fetchResult.startsWith('Success') ? 'success' : 'error'}`}>{fetchResult}</div>}
              
              <div className="attendance-actions">
                <button onClick={() => { setCurrentPage(1); loadAttendance(fromDate, toDate, 1); }} disabled={loading || fetching || !fromDate || !toDate} className="cms-btn">
                  Reload Attendance
                </button>
                <button onClick={() => { setFromDate(''); setToDate(''); setCurrentPage(1); setAttendance([]); setTotalCount(0); setHasMore(false); setFetchResult(null); }} disabled={loading || fetching} className="cms-btn">
                  Clear Filters
                </button>
              </div>
            </div>

            {/* Import Excel Section */}
            <div className="employee-card-container">
              <div className="employee-section-title">Import Attendance from Excel</div>
              <div className="employee-section-subtitle">
                Upload an Excel file with attendance data. Imported data will be displayed in the attendance table below.
                <br />
                <strong>The excel fields are:</strong> Employee ID, AttendanceDate, FirstIn, LastOut, Status
              </div>

              <form onSubmit={importAttendanceData} className="attendance-form">
                <div className="attendance-file-group">
                  <label>
                    Select Excel File:
                    <input
                      type="file"
                      accept=".xlsx,.xls"
                      onChange={e => setImportFile(e.target.files[0])}
                      disabled={importLoading || fetching || loading}
                    />
                  </label>
                </div>
                <div className="attendance-form-buttons">
                  <button type="submit" className="cms-btn primary" disabled={importLoading || fetching || loading || !importFile}>
                    Import Attendance Data
                  </button>
                </div>
              </form>

              {importResult && <div className={`attendance-message ${importResult.startsWith('Success') ? 'success' : 'error'}`}>{importResult}</div>}
              
              {/* Action buttons after import */}
              {importResult && importResult.startsWith('Success') && (
                <div className="attendance-actions">
                  {fromDate && toDate && (
                    <button 
                      onClick={() => { setCurrentPage(1); loadAttendance(fromDate, toDate, 1); }} 
                      disabled={loading || fetching} 
                      className="cms-btn primary"
                    >
                      Refresh Database Data
                    </button>
                  )}
                  <button 
                    onClick={() => { 
                      setImportedData([]); 
                      setImportResult(null); 
                      setImportFile(null);
                      localStorage.removeItem('importedAttendanceData');
                      window.dispatchEvent(new CustomEvent('importedDataChanged'));
                    }} 
                    className="cms-btn"
                  >
                    Clear Imported Data
                  </button>
                </div>
              )}
            </div>

            {/* Summary Card */}
            <div className="cms-stat-card attendance-summary-card">
              <div className="cms-stat-header">
                <div>
                  <div className="cms-stat-label">Attendance Summary</div>
                  <div className="cms-stat-change positive">
                    <BarChart3 size={16} /> Current page statistics
                  </div>
                </div>
                <div className="cms-stat-icon">
                  <BarChart3 size={28} />
                </div>
              </div>
              
              <div className="attendance-summary">
                <span>Database records: <b>{attendance.length}</b></span>
                <span>Imported records: <b>{importedData.length}</b></span>
                <span>Total displayed: <b>{attendance.length + importedData.length}</b></span>
                <span>Page: <b>{currentPage}</b></span>
                <span>Total database records: <b>{totalCount}</b></span>
              </div>
              
              <div className="attendance-pagination">
                <button onClick={handlePrevPage} disabled={currentPage === 1 || loading} className="cms-btn">
                  Previous Page
                </button>
                <button onClick={handleNextPage} disabled={!hasMore || loading} className="cms-btn">
                  Next Page
                </button>
              </div>
            </div>

            {/* Attendance Table Section - Show when dates are selected OR when Excel data is imported */}
            {(fromDate && toDate) || importedData.length > 0 ? (
              <div className="cms-chart-card attendance-table-section">
                <div className="cms-chart-header">
                  <h3 className="cms-chart-title">
                    Attendance Records
                    {importedData.length > 0 && (
                      <span style={{ fontSize: '14px', color: '#666', marginLeft: '10px' }}>
                        (Including {importedData.length} imported records)
                      </span>
                    )}
                  </h3>
                </div>
                
                {loading ? (
                  <div className="cms-loading">
                    <div className="cms-spinner" />
                    <p>Loading attendance data...</p>
                  </div>
                ) : (
                  <div className="attendance-table-scroll">
                    <table className="attendance-table">
                      <thead>
                        <tr>
                          <th>Employee ID</th>
                          <th>Employee Name</th>
                          <th>Date</th>
                          <th>First IN</th>
                          <th>Last OUT</th>
                          <th>Status</th>
                          <th>Source</th>
                        </tr>
                      </thead>
                      <tbody>
                        {/* Show imported Excel data first */}
                        {importedData.map((row, idx) => (
                          <tr key={`imported-${row.EmployeeID}-${row.Date}-${idx}`} style={{ backgroundColor: '#f0f8ff' }}>
                            <td>{row.EmployeeID}</td>
                            <td>{employeeNameMap[String(row.EmployeeID)] ?? '-'}</td>
                            <td>{extractDate(row.FirstIN) || row.Date}</td>
                            <td>{extractTime(row.FirstIN)}</td>
                            <td>{extractTime(row.LastOUT)}</td>
                            <td>{row.Status || getStatus(row.FirstIN, row.LastOUT)}</td>
                            <td style={{ color: '#0066cc', fontWeight: 'bold' }}>Excel Import</td>
                          </tr>
                        ))}
                        {/* Show regular attendance data below */}
                        {attendance.map((row, idx) => {
                          console.log(`Row ${idx} data:`, row);
                          return (
                            <tr key={`regular-${row.EmployeeID}-${row.Date}-${idx}`}>
                              <td>{row.EmployeeID}</td>
                              <td>{employeeNameMap[String(row.EmployeeID)] ?? '-'}</td>
                              <td>{extractDate(row.FirstIN) || row.Date}</td>
                              <td>{extractTime(row.FirstIN)}</td>
                              <td>{extractTime(row.LastOUT)}</td>
                              <td>{getStatus(row.FirstIN, row.LastOUT)}</td>
                              <td style={{ color: '#666' }}>Database</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ) : null}
          </main>
        </div>
      </div>
    </>
  );
}

export default Attendance;
