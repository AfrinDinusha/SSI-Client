import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import './Detection.css';
import * as XLSX from 'xlsx';
import HeaderBranding from './HeaderBranding';
import { getSidebarModulesForUser, resolveSidebarUserEmail } from './modulesConfig';
import { 
  Users, Calendar, FileText, AlertTriangle, FolderOpen, 
  ClipboardList, Building, Handshake, Landmark, Clock, 
  Map, BarChart3, User, TrendingUp, TrendingDown, CalendarDays,
  Activity, Plus, CheckCircle, Bell, Settings, LayoutDashboard, Home as HomeIcon, AlertOctagon, CreditCard, Shield, Trophy, Medal, Award, Star, FileSignature, Search, Clock3
} from 'lucide-react';
import { Link } from 'react-router-dom';
import Button from './Button';

const Detection = ({ userRole, userEmail }) => {
  const [selectedFile, setSelectedFile] = useState(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [importedData, setImportedData] = useState([]);
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const [showDataTable, setShowDataTable] = useState(false);
  const [showAllData, setShowAllData] = useState(false);
  const fileInputRef = useRef(null);
  const [expandedMenus, setExpandedMenus] = useState({});
  const [showNotifications, setShowNotifications] = useState(false);
  const [showSidebarMenu, setShowSidebarMenu] = useState(false);

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

  // User info
  const userAvatar = "https://images.pexels.com/photos/2379004/pexels-photo-2379004.jpeg?auto=compress&cs=tinysrgb&w=150";
  const userName = userRole === 'App Administrator' ? 'Admin User' : 'App User';

  // Load imported data from localStorage on component mount
  useEffect(() => {
    const savedData = localStorage.getItem('detectionImportedData');
    const savedShowTable = localStorage.getItem('detectionShowDataTable');
    const savedShowAll = localStorage.getItem('detectionShowAllData');
    
    if (savedData) {
      try {
        const parsedData = JSON.parse(savedData);
        setImportedData(parsedData);
        setShowDataTable(savedShowTable === 'true');
        setShowAllData(savedShowAll === 'true');
      } catch (error) {
        console.error('Error loading saved data:', error);
        // Clear invalid data
        localStorage.removeItem('detectionImportedData');
        localStorage.removeItem('detectionShowDataTable');
        localStorage.removeItem('detectionShowAllData');
      }
    }
  }, []);

  const handleFileSelect = (file) => {
    if (file && (file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || 
                 file.type === 'application/vnd.ms-excel' ||
                 file.name.endsWith('.xlsx') || 
                 file.name.endsWith('.xls'))) {
      setSelectedFile(file);
    } else {
      alert('Please select a valid Excel file (.xlsx or .xls)');
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  const handleFileInputChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  const handleBrowseClick = () => {
    fileInputRef.current.click();
  };

  const handleClearData = () => {
    setImportedData([]);
    setShowDataTable(false);
    setShowAllData(false);
    setSelectedFile(null);
    setImportError('');
    
    // Clear from localStorage
    localStorage.removeItem('detectionImportedData');
    localStorage.removeItem('detectionShowDataTable');
    localStorage.removeItem('detectionShowAllData');
    
    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleImportData = async () => {
    if (!selectedFile) {
      setImportError('Please select a file first');
      return;
    }

    setIsImporting(true);
    setImportError('');
    setShowDataTable(false);

    try {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target.result);
          const workbook = XLSX.read(data, { type: 'array' });
          const sheetName = workbook.SheetNames[0];
          
          if (!sheetName) {
            throw new Error('No sheets found in the Excel file.');
          }
          
          const worksheet = workbook.Sheets[sheetName];
          // Use raw option to preserve exact data formatting
          const jsonData = XLSX.utils.sheet_to_json(worksheet, { 
            raw: true, 
            defval: '', 
            blankrows: false 
          });

          if (!jsonData || jsonData.length === 0) {
            throw new Error('No data found in the Excel file.');
          }

          // Store the exact imported data without any processing
          setImportedData(jsonData);
          setShowDataTable(true);
          setShowAllData(false); // Reset to show first 10 records
          setImportError('');
          
          // Save to localStorage for persistence
          localStorage.setItem('detectionImportedData', JSON.stringify(jsonData));
          localStorage.setItem('detectionShowDataTable', 'true');
          localStorage.setItem('detectionShowAllData', 'false');
          
          console.log('Successfully imported data:', jsonData);
        } catch (parseError) {
          console.error('Error parsing Excel file:', parseError);
          setImportError(`Failed to parse Excel file: ${parseError.message}`);
        } finally {
          setIsImporting(false);
        }
      };

      reader.onerror = () => {
        setImportError('Failed to read the file.');
        setIsImporting(false);
      };

      reader.readAsArrayBuffer(selectedFile);
    } catch (error) {
      console.error('Import error:', error);
      setImportError(`Import failed: ${error.message}`);
      setIsImporting(false);
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

          {/* Detection Content */}
          <main className="cms-dashboard-content">
            <div className="detection-container">
              <div className="upload-card">
                <div className="upload-header">
                  <h2>Upload Excel File</h2>
                  <div className="download-icon">📥</div>
                </div>
                
                <div 
                  className={`upload-area ${isDragOver ? 'drag-over' : ''}`}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={handleBrowseClick}
                >
                  <div className="upload-content">
                    <div className="upload-icon">📄</div>
                    <p className="drop-text">Drop your Excel file here</p>
                    <p className="browse-text">or click to browse files</p>
                    <div className="file-types">Supports .xlsx, .xls files</div>
                  </div>
                </div>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={handleFileInputChange}
                  style={{ display: 'none' }}
                />

                {selectedFile && (
                  <div className="selected-file">
                    <p>Selected: {selectedFile.name}</p>
                  </div>
                )}

                {importError && (
                  <div className="import-error">
                    <p>{importError}</p>
                  </div>
                )}

                <div className="button-group">
                  <button 
                    className={`import-button ${isImporting ? 'importing' : ''}`}
                    onClick={handleImportData}
                    disabled={isImporting}
                  >
                    {isImporting ? (
                      <>
                        <span className="import-icon">⏳</span>
                        Importing...
                      </>
                    ) : (
                      <>
                        <span className="import-icon">📥</span>
                        Import Data
                      </>
                    )}
                  </button>
                  
                  {importedData.length > 0 && (
                    <button 
                      className="clear-button"
                      onClick={handleClearData}
                    >
                      <span className="clear-icon">🗑️</span>
                      Clear Data
                    </button>
                  )}
                </div>
              </div>

              {/* Display imported data below the upload area */}
              {showDataTable && importedData.length > 0 && (
                <div className="imported-data-section">
                  <div className="data-header">
                    <h3>Imported Data ({importedData.length} records)</h3>
                    <div className="data-controls">
                      {importedData.length > 10 && (
                        <button 
                          className="show-all-btn"
                          onClick={() => {
                            const newShowAll = !showAllData;
                            setShowAllData(newShowAll);
                            localStorage.setItem('detectionShowAllData', newShowAll.toString());
                          }}
                        >
                          {showAllData ? 'Show First 10' : 'Show All Data'}
                        </button>
                      )}
                      <button 
                        className="close-data-btn"
                        onClick={() => {
                          setShowDataTable(false);
                          localStorage.setItem('detectionShowDataTable', 'false');
                        }}
                      >
                        ×
                      </button>
                    </div>
                  </div>
                  
                  <div className="data-table-container">
                    <table className="imported-data-table">
                      <thead>
                        <tr>
                          {Object.keys(importedData[0]).map((key, index) => (
                            <th key={index}>{key}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {(showAllData ? importedData : importedData.slice(0, 10)).map((row, index) => (
                          <tr key={index}>
                            {Object.values(row).map((value, cellIndex) => (
                              <td key={cellIndex}>
                                {value === null || value === undefined ? '' : String(value)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    
                    {importedData.length > 10 && !showAllData && (
                      <div className="data-info">
                        <p>Showing first 10 records of {importedData.length} total records</p>
                      </div>
                    )}
                    {showAllData && (
                      <div className="data-info">
                        <p>Showing all {importedData.length} records</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </main>
        </div>
      </div>
    </>
  );
};

export default Detection;
