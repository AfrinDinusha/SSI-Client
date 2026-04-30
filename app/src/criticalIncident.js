import './App.css';
import './CriticalIncident.css';
import './helper.css';
import './employeeManagement.css';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import { useNavigate, useParams, Link, useLocation } from 'react-router-dom';
import Button from './Button';
import HeaderBranding from './HeaderBranding';
import { getSidebarModulesForUser, resolveSidebarUserEmail } from './modulesConfig';
import {
  Users, Calendar, FileText, AlertTriangle, FolderOpen,
  ClipboardList, Building, Handshake, Landmark, Clock,
  Map, BarChart3, User, TrendingUp, TrendingDown,
  Activity, Plus, CheckCircle, Bell, Settings, LayoutDashboard, Home as HomeIcon, AlertOctagon, CreditCard, Shield, FileSignature, Search, Clock3, CalendarDays, Database,
  FileInput, FileOutput, Filter, RefreshCw, Trash2
} from 'lucide-react';

function CriticalIncidentRow({ incident, index, editIncident, isSelected, onCheckboxChange, selectedIncidents }) {
  const handleRowClick = () => {
    editIncident(incident);
  };

  const handleCheckboxClick = (e) => {
    e.stopPropagation(); // Prevent row click when clicking checkbox
    onCheckboxChange(incident.id, e.target.checked);
  };

  const handleEditButtonClick = (e) => {
    e.stopPropagation(); // Prevent row click when clicking edit button
    editIncident(incident);
  };

  return (
    <tr
      className="clickable-row"
      onClick={handleRowClick}
      style={{
        cursor: 'pointer',
        transition: 'background-color 0.2s ease'
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = '#f8f9fa';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = '';
      }}
    >
      <td onClick={handleCheckboxClick}>
        <input
          type="checkbox"
          checked={isSelected}
          onChange={handleCheckboxClick}
          style={{
            width: '18px',
            height: '18px',
            cursor: 'pointer',
            accentColor: '#dc3545',
          }}
          title="Select for deletion"
        />
      </td>
      {selectedIncidents.size > 0 && (
        <td onClick={handleEditButtonClick}>
          {isSelected && (
            <button
              className="btn btn-icon"
              onClick={handleEditButtonClick}
              title="Edit"
              style={{
                background: 'transparent',
                border: 'none',
                color: '#232323',
                padding: '6px 8px',
                minWidth: '32px',
                height: '32px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
            >
              <i className="fas fa-edit"></i>
            </button>
          )}
        </td>
      )}
      <td style={{ paddingRight: '20px' }}>{index + 1}</td>
      <td
        onClick={handleRowClick}
        style={{ cursor: 'pointer' }}
      >
        {incident.ContractEmplyee || '-'}
      </td>
      <td>{incident.Date1 || '-'}</td>
      <td>
        {incident.Details ? (
          <div style={{ maxWidth: '300px', wordBreak: 'break-word' }}>
            {incident.Details}
          </div>
        ) : '-'}
      </td>
      <td>{incident.Status || '-'}</td>
    </tr>
  );
}

function ContractEmployeeSelect({ employees, value, selectedCode, onChange }) {
  const [isOpen, setIsOpen] = React.useState(false);
  const [searchTerm, setSearchTerm] = React.useState('');
  const [allEmployees, setAllEmployees] = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  const containerRef = React.useRef(null);
  const inputRef = React.useRef(null);
  const dropdownRef = React.useRef(null);
  const [dropdownStyle, setDropdownStyle] = React.useState({ top: 0, left: 0, minWidth: 400, maxWidth: 500 });
 
  // Compute a human-friendly label for the selected value
  const displayValue = React.useMemo(() => {
    if (value) return value; // when parent stores name in value
    const source = (allEmployees && allEmployees.length > 0) ? allEmployees : employees;
    const match = source.find(emp => {
      const employeeCode = emp.employeeCode || emp.EmployeeCode || emp.contractEmployeeID || emp.ContractEmployeeID || emp.id;
      return String(employeeCode) === String(selectedCode);
    });
    if (!match) return selectedCode || '';
    const employeeCode = match.employeeCode || match.EmployeeCode || match.contractEmployeeID || match.ContractEmployeeID || match.id;
    const employeeName = match.employeeName || match.EmployeeName || match.name;
    return employeeName ? `${employeeName} (${employeeCode})` : String(employeeCode);
  }, [value, selectedCode, allEmployees, employees]);

  // Fetch all employees from cms_function when dropdown opens
  const fetchAllEmployees = React.useCallback(async () => {
    if (allEmployees.length > 0) return; // Don't fetch if already loaded
   
    setLoading(true);
    try {
      // Fetch all employees from cms_function with returnAll=true
      const response = await axios.get('/server/cms_function/employees', {
        params: { returnAll: true },
        timeout: 10000
      });
     
      const fetchedEmployees = response?.data?.data?.employees || [];
      console.log('Fetched all employees for Contract Employee dropdown:', fetchedEmployees.length);
     
      // Transform employees to match expected format
      const transformedEmployees = fetchedEmployees.map(emp => ({
        ...emp,
        type: 'employee',
        displayName: `${emp.employeeName || emp.EmployeeName || ''} (${emp.employeeCode || emp.EmployeeCode || emp.id || ''})`,
        contractEmployeeID: emp.employeeCode || emp.EmployeeCode || emp.id,
        employeeCode: emp.employeeCode || emp.EmployeeCode || emp.id
      }));
     
      setAllEmployees(transformedEmployees);
    } catch (error) {
      console.error('Error fetching all employees:', error);
      // Fallback to existing employees if API fails
      const fallbackEmployees = employees.filter(emp => emp.type === 'employee');
      setAllEmployees(fallbackEmployees);
      console.log('Using fallback employees:', fallbackEmployees.length);
    } finally {
      setLoading(false);
    }
  }, [employees, allEmployees.length]);

  // Filter contract employees only
  const contractEmployees = React.useMemo(() => {
    return allEmployees.length > 0 ? allEmployees : employees.filter(emp => emp.type === 'employee');
  }, [allEmployees, employees]);

  // Filtered employees based on search term
  const filteredEmployees = React.useMemo(() => {
    if (!searchTerm.trim()) {
      // Show all contract employees if no search term
      return contractEmployees;
    }
    return contractEmployees.filter(emp => {
      const employeeCode = emp.employeeCode || emp.EmployeeCode || emp.contractEmployeeID || emp.ContractEmployeeID || emp.id || '';
      const displayName = emp.displayName || '';
      return employeeCode.toLowerCase().includes(searchTerm.toLowerCase()) || displayName.toLowerCase().includes(searchTerm.toLowerCase());
    });
  }, [contractEmployees, searchTerm]);

  // Close dropdown on outside click
  React.useEffect(() => {
    function handleClickOutside(event) {
      const clickedInsideInput = containerRef.current && containerRef.current.contains(event.target);
      const clickedInsideDropdown = dropdownRef.current && dropdownRef.current.contains(event.target);
      if (!clickedInsideInput && !clickedInsideDropdown) {
        setIsOpen(false);
        setSearchTerm('');
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Position dropdown using viewport coordinates to escape clipping/overflow
  const positionDropdown = React.useCallback(() => {
    if (!inputRef.current) return;
    const rect = inputRef.current.getBoundingClientRect();
    setDropdownStyle({
      top: rect.bottom + 2,
      left: rect.left,
      minWidth: Math.max(400, rect.width),
      maxWidth: 500
    });
  }, []);

  React.useEffect(() => {
    if (isOpen) {
      positionDropdown();
    }
  }, [isOpen, positionDropdown, value]);

  React.useEffect(() => {
    if (!isOpen) return;
    const onResizeOrScroll = () => positionDropdown();
    window.addEventListener('resize', onResizeOrScroll);
    window.addEventListener('scroll', onResizeOrScroll, true);
    return () => {
      window.removeEventListener('resize', onResizeOrScroll);
      window.removeEventListener('scroll', onResizeOrScroll, true);
    };
  }, [isOpen, positionDropdown]);

  const handleSelect = (employee) => {
    const employeeCode = employee.employeeCode || employee.EmployeeCode || employee.contractEmployeeID || employee.ContractEmployeeID || employee.id;
    const employeeName = employee.employeeName || employee.EmployeeName || employee.name || '';
    // Save name in ContractEmplyee and code in ContractEmplyeeCode
    onChange({ target: { name: 'ContractEmplyee', value: employeeName || employeeCode } });
    onChange({ target: { name: 'ContractEmplyeeCode', value: employeeCode } });
    setIsOpen(false);
    setSearchTerm('');
  };

  return (
    <div className="contract-employee-select" ref={containerRef} style={{ position: 'relative' }}>
      <input
        type="text"
        readOnly
        value={displayValue}
        placeholder="Select Contract Empl"
        onClick={() => {
          if (!isOpen) {
            fetchAllEmployees();
          }
          setIsOpen(prev => !prev);
          setTimeout(positionDropdown, 0);
        }}
        className="input"
        style={{
          cursor: 'pointer',
          background: '#f5f5f5',
          border: '1px solid #ddd',
          borderRadius: '4px',
          padding: '8px 12px',
          fontSize: '14px',
          color: '#333'
        }}
        ref={inputRef}
      />
      {isOpen && createPortal(
        <div className="dropdown" ref={dropdownRef} style={{
          position: 'fixed',
          top: dropdownStyle.top,
          left: dropdownStyle.left,
          background: 'white',
          border: '1px solid #ddd',
          borderTop: 'none',
          borderRadius: '0 0 4px 4px',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.2)',
          zIndex: 999999,
          maxHeight: '250px',
          overflowY: 'auto',
          overflowX: 'visible',
          minWidth: dropdownStyle.minWidth,
          width: 'max-content',
          maxWidth: dropdownStyle.maxWidth
        }}>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {loading ? (
              <li style={{
                padding: '8px 12px',
                textAlign: 'center',
                color: '#666',
                fontStyle: 'italic',
                fontSize: '14px'
              }}>
                Loading employees...
              </li>
            ) : filteredEmployees.length > 0 ? (
              filteredEmployees.map(emp => {
                const employeeCode = emp.employeeCode || emp.EmployeeCode || emp.contractEmployeeID || emp.ContractEmployeeID || emp.id;
                const isActive = String(employeeCode) === String(selectedCode);
                return (
                  <li
                    key={employeeCode}
                    onClick={() => handleSelect(emp)}
                    style={{
                      padding: '8px 12px',
                      cursor: 'pointer',
                      backgroundColor: isActive ? '#e3f2fd' : 'white',
                      color: isActive ? '#2196f3' : '#333',
                      borderBottom: '1px solid #f0f0f0',
                      transition: 'all 0.2s ease',
                      fontSize: '14px',
                      whiteSpace: 'nowrap',
                      overflow: 'visible',
                      textOverflow: 'unset',
                      display: 'flex',
                      alignItems: 'center',
                      minHeight: '32px',
                      width: '100%'
                    }}
                    onMouseEnter={(e) => {
                      if (!isActive) {
                        e.target.style.backgroundColor = '#f8f9fa';
                        e.target.style.color = '#2196f3';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isActive) {
                        e.target.style.backgroundColor = 'white';
                        e.target.style.color = '#333';
                      }
                    }}
                    title={employeeCode}
                  >
                    <span style={{
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                      fontFamily: 'Arial, sans-serif',
                      fontWeight: '500',
                      fontSize: '14px',
                      whiteSpace: 'nowrap',
                      overflow: 'visible',
                      textOverflow: 'unset'
                    }}>
                      {employeeCode}
                      {emp.employeeName || emp.EmployeeName ? (
                        <span style={{
                          display: 'block',
                          fontSize: '12px',
                          color: '#666',
                          fontFamily: 'inherit',
                          fontWeight: '400',
                          marginTop: '2px'
                        }}>
                          {emp.employeeName || emp.EmployeeName}
                        </span>
                      ) : null}
                    </span>
                  </li>
                );
              })
            ) : (
              <li style={{
                padding: '8px 12px',
                textAlign: 'center',
                color: '#666',
                fontStyle: 'italic',
                fontSize: '14px'
              }}>
                No employees found
              </li>
            )}
            <li
              onClick={() => handleSelect({ employeeName: 'contract employee', employeeCode: 'contract employee' })}
              style={{
                padding: '8px 12px',
                cursor: 'pointer',
                backgroundColor: value === 'contract employee' ? '#e3f2fd' : 'white',
                color: value === 'contract employee' ? '#2196f3' : '#333',
                borderTop: '1px solid #ddd',
                fontWeight: 'bold',
                transition: 'all 0.2s ease',
                fontSize: '14px'
              }}
              onMouseEnter={(e) => {
                if (value !== 'contract employee') {
                  e.target.style.backgroundColor = '#f8f9fa';
                  e.target.style.color = '#2196f3';
                }
              }}
              onMouseLeave={(e) => {
                if (value !== 'contract employee') {
                  e.target.style.backgroundColor = 'white';
                  e.target.style.color = '#333';
                }
              }}
            >
              contract employee
            </li>
          </ul>
        </div>, document.body)
      }
    </div>
  );
}

// New component for Contract Employee filter dropdown with search
function ContractEmployeeFilterSelect({ value, onChange }) {
  const [isOpen, setIsOpen] = React.useState(false);
  const [searchTerm, setSearchTerm] = React.useState('');
  const [allEmployees, setAllEmployees] = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  const containerRef = React.useRef(null);

  // Fetch all employees from cms_function when dropdown opens
  const fetchAllEmployees = React.useCallback(async () => {
    if (allEmployees.length > 0) return; // Don't fetch if already loaded
   
    setLoading(true);
    try {
      // Fetch all employees from cms_function with returnAll=true
      const response = await axios.get('/server/cms_function/employees', {
        params: { returnAll: true },
        timeout: 10000
      });
     
      const fetchedEmployees = response?.data?.data?.employees || [];
      console.log('Fetched all employees for Contract Employee filter:', fetchedEmployees.length);
     
      // Transform employees to match expected format
      const transformedEmployees = fetchedEmployees.map(emp => ({
        ...emp,
        type: 'employee',
        displayName: `${emp.employeeName || emp.EmployeeName || ''} (${emp.employeeCode || emp.EmployeeCode || emp.id || ''})`,
        contractEmployeeID: emp.employeeCode || emp.EmployeeCode || emp.id,
        employeeCode: emp.employeeCode || emp.EmployeeCode || emp.id
      }));
     
      setAllEmployees(transformedEmployees);
    } catch (error) {
      console.error('Error fetching all employees for filter:', error);
      setAllEmployees([]);
    } finally {
      setLoading(false);
    }
  }, [allEmployees.length]);

  // Filtered employees based on search term
  const filteredEmployees = React.useMemo(() => {
    if (!searchTerm.trim()) {
      return allEmployees;
    }
    return allEmployees.filter(emp => {
      const employeeCode = emp.employeeCode || emp.EmployeeCode || emp.contractEmployeeID || emp.ContractEmployeeID || emp.id || '';
      const employeeName = emp.employeeName || emp.EmployeeName || '';
      return employeeCode.toLowerCase().includes(searchTerm.toLowerCase()) ||
             employeeName.toLowerCase().includes(searchTerm.toLowerCase());
    });
  }, [allEmployees, searchTerm]);

  // Close dropdown on outside click
  React.useEffect(() => {
    function handleClickOutside(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
        setSearchTerm('');
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleSelect = (employeeCode) => {
    onChange(employeeCode);
    setIsOpen(false);
    setSearchTerm('');
  };

  const handleClear = () => {
    onChange('');
    setIsOpen(false);
    setSearchTerm('');
  };

  return (
    <div className="contract-employee-filter-select" ref={containerRef} style={{ position: 'relative' }}>
      <div
        onClick={() => {
          if (!isOpen) {
            fetchAllEmployees();
          }
          setIsOpen(prev => !prev);
        }}
        style={{
          padding: '6px 8px',
          border: '1px solid #d1d5db',
          borderRadius: '4px',
          fontSize: '14px',
          backgroundColor: 'white',
          cursor: 'pointer',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          minHeight: '32px'
        }}
      >
        <span style={{ color: value ? '#000' : '#6b7280' }}>
          {value || 'Select Employee Code'}
        </span>
        <span style={{ fontSize: '12px', color: '#6b7280' }}>
          {isOpen ? '▲' : '▼'}
        </span>
      </div>
      {isOpen && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          right: 0,
          backgroundColor: 'white',
          border: '1px solid #d1d5db',
          borderRadius: '4px',
          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
          zIndex: 1000,
          maxHeight: '200px',
          overflow: 'hidden'
        }}>
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={value ? value : 'Search employee code...'}
            style={{
              width: '100%',
              padding: '8px 12px',
              border: 'none',
              borderBottom: '1px solid #e5e7eb',
              fontSize: '14px',
              outline: 'none',
              backgroundColor: 'white'
            }}
            autoFocus
          />
          <div style={{ maxHeight: '150px', overflowY: 'auto' }}>
            {loading ? (
              <div style={{
                padding: '8px 12px',
                fontSize: '14px',
                color: '#6b7280',
                textAlign: 'center',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px'
              }}>
                <div style={{
                  width: '16px',
                  height: '16px',
                  border: '2px solid #e5e7eb',
                  borderTop: '2px solid #3b82f6',
                  borderRadius: '50%',
                  animation: 'spin 1s linear infinite'
                }}></div>
                Loading employees...
              </div>
            ) : (
              <>
                <div
                  onClick={handleClear}
                  style={{
                    padding: '8px 12px',
                    cursor: 'pointer',
                    fontSize: '14px',
                    borderBottom: '1px solid #f3f4f6',
                    backgroundColor: value === '' ? '#e3f2fd' : 'white',
                    fontWeight: '500'
                  }}
                  onMouseEnter={(e) => {
                    if (value !== '') {
                      e.target.style.backgroundColor = '#f9fafb';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (value !== '') {
                      e.target.style.backgroundColor = 'white';
                    }
                  }}
                >
                  Clear Selection
                </div>
                {filteredEmployees.length > 0 ? (
                  filteredEmployees.map(emp => {
                    const employeeCode = emp.employeeCode || emp.EmployeeCode || emp.contractEmployeeID || emp.ContractEmployeeID || emp.id;
                    const employeeName = emp.employeeName || emp.EmployeeName || '';
                    return (
                      <div
                        key={employeeCode}
                        onClick={() => handleSelect(employeeCode)}
                        style={{
                          padding: '8px 12px',
                          cursor: 'pointer',
                          fontSize: '14px',
                          borderBottom: '1px solid #f3f4f6',
                          backgroundColor: value === employeeCode ? '#e3f2fd' : 'white'
                        }}
                        onMouseEnter={(e) => {
                          if (value !== employeeCode) {
                            e.target.style.backgroundColor = '#f9fafb';
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (value !== employeeCode) {
                            e.target.style.backgroundColor = 'white';
                          }
                        }}
                      >
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          <span style={{ fontWeight: '500', fontSize: '14px' }}>
                            {employeeCode}
                          </span>
                          {employeeName && (
                            <span style={{
                              fontSize: '12px',
                              color: '#666',
                              marginTop: '2px'
                            }}>
                              {employeeName}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div style={{
                    padding: '8px 12px',
                    fontSize: '14px',
                    color: '#6b7280',
                    textAlign: 'center'
                  }}>
                    No employees found
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function CriticalIncident({ userRole = 'App User', userEmail = null }) {
  const navigate = useNavigate();
  const { id } = useParams();
  const location = useLocation();
 
  // Sidebar state
  const [expandedMenus, setExpandedMenus] = useState({});
  const [showSidebarMenu, setShowSidebarMenu] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
 
  // Table states
  const [incidents, setIncidents] = useState([]);
  const [filteredIncidents, setFilteredIncidents] = useState([]);
  const [fetchState, setFetchState] = useState('init');
  const [fetchError, setFetchError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [selectedIncidents, setSelectedIncidents] = useState(new Set());
  const [searchTerm, setSearchTerm] = useState('');
 
  // Calculate if all incidents are selected
  const allSelected = filteredIncidents.length > 0 && selectedIncidents.size === filteredIncidents.length;
  const someSelected = selectedIncidents.size > 0 && selectedIncidents.size < filteredIncidents.length;

  // Search filter states
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);
  const [searchFields, setSearchFields] = useState({
    ContractEmplyee: { enabled: false, value: '' },
    Date1: { enabled: false, value: '' },
    Details: { enabled: false, value: '' },
    Status: { enabled: false, value: '' },
  });

  const searchableFields = [
    { label: 'Contract Employee', field: 'ContractEmplyee' },
    { label: 'Date', field: 'Date1' },
    { label: 'Details', field: 'Details' },
    { label: 'Status', field: 'Status' },
  ];


  // Filter logic
  const filteredData = useCallback(() => {
    const hasActiveFilters = Object.values(searchFields).some(field => field.enabled);
    if (!hasActiveFilters) return incidents;

    return incidents.filter((incident) => {
      if (!incident || typeof incident !== 'object') return false;
      return searchableFields.every(({ field }) => {
        const { enabled, value } = searchFields[field];
        if (!enabled) return true;

        // Special handling for Contract Employee field - exact match
        if (field === 'ContractEmplyee') {
          const incidentName = incident[field] || '';
          const incidentCode = incident.ContractEmplyeeCode || '';
          return incidentName === value || incidentCode === value;
        }

        // Standard filtering for other fields - simple contains search
        const incidentValue = incident[field] != null ? String(incident[field]).toLowerCase() : '';
        const lowerSearchValue = value.toLowerCase();
        return incidentValue.includes(lowerSearchValue);
      });
    });
  }, [incidents, searchFields]);

  useEffect(() => {
    setFilteredIncidents(filteredData());
  }, [filteredData]);

  // Handle search field toggle, mode change, and value change
  const handleFieldToggle = useCallback((field) => {
    setSearchFields((prev) => ({
      ...prev,
      [field]: { ...prev[field], enabled: !prev[field].enabled, value: !prev[field].enabled ? prev[field].value : '' },
    }));
  }, []);


  const handleSearchValueChange = useCallback((field, value) => {
    setSearchFields((prev) => ({
      ...prev,
      [field]: { ...prev[field], value },
    }));
  }, []);

  // Form states
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    Date1: '',
    ContractEmplyee: '',
    ContractEmplyeeCode: '',
    Details: '',
    Status: '',
  });
  const [employees, setEmployees] = useState([]);

  const [editingIncidentId, setEditingIncidentId] = useState(null);
  const isEditing = editingIncidentId !== null;
  const [showForm, setShowForm] = useState(false);
  const isFormView = isEditing || showForm;

  // Header data
  const userAvatar = "https://images.pexels.com/photos/2379004/pexels-photo-2379004.jpeg?auto=compress&cs=tinysrgb&w=150";
  const userName = 'Admin User';

  // Sample activity data with Lucide icons
  const recentActivities = [
    { icon: <User size={20} />, title: 'New Employee Added', description: 'John Doe joined the development team', time: '2 hours ago' },
    { icon: <BarChart3 size={20} />, title: 'Monthly Report Generated', description: 'Contractor performance report is ready', time: '4 hours ago' },
    { icon: <CheckCircle size={20} />, title: 'Contract Approved', description: 'ABC Construction contract approved', time: '6 hours ago' },
    { icon: <Bell size={20} />, title: 'System Update', description: 'Payroll Management System updated to version 2.1', time: '1 day ago' },
    { icon: <Plus size={20} />, title: 'New Application', description: 'Candidate applied for senior position', time: '2 days ago' }
  ];


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



  const fetchEmployees = useCallback(() => {
    // Build params for contractor filtering
    const params = {};
    if (userRole && userEmail) {
      params.userRole = userRole;
      params.userEmail = userEmail;
    }
   
    Promise.all([
      axios.get('/server/candidate_function/candidates', { timeout: 10000 }),
      axios.get('/server/cms_function/employees', { params, timeout: 10000 }),
    ])
      .then(([candidatesResponse, employeesResponse]) => {
        const candidates = candidatesResponse?.data?.data?.candidates || [];
        const employees = employeesResponse?.data?.data?.employees || [];
       
        const allEmployees = [
          ...employees.map(emp => ({
            ...emp,
            type: 'employee',
            displayName: `${emp.employeeName || emp.name || emp.EmployeeName} (${emp.employeeCode || emp.EmployeeCode || emp.id})`,
            contractEmployeeID: emp.employeeCode || emp.EmployeeCode || emp.id,
            employeeCode: emp.employeeCode || emp.EmployeeCode || emp.id
          })),
          ...candidates.map(cand => ({
            ...cand,
            type: 'candidate',
            displayName: `${cand.CandidateName || cand.candidateName} (${cand.ContractEmployeeID || cand.id})`,
            contractEmployeeID: cand.ContractEmployeeID || cand.id
          }))
        ];
       
        const uniqueEmployees = allEmployees.filter((emp, index, self) => {
          const employeeCode = emp.employeeCode || emp.contractEmployeeID || emp.ContractEmployeeID || emp.id;
          return self.findIndex(e => (e.employeeCode || e.contractEmployeeID || e.ContractEmployeeID || e.id) === employeeCode) === index;
        });
       
        setEmployees(uniqueEmployees);
      })
      .catch((err) => {
        console.error('Fetch employees error:', err);
        axios.get('/server/candidate_function/candidates', { timeout: 5000 })
          .then((response) => {
            if (response?.data?.data?.candidates) {
              const candidates = response.data.data.candidates.map(cand => ({
                ...cand,
                type: 'candidate',
                contractEmployeeID: cand.ContractEmployeeID || cand.id
              }));
              setEmployees(candidates);
            }
          })
          .catch((candErr) => {
            console.error('Fetch candidates error:', candErr);
          });
      });
  }, [userRole, userEmail]);

  const fetchIncident = useCallback(() => {
    if (!id) return;
   
    setLoading(true);
    axios
      .get(`/server/CriticalIncident_function/incidents/${id}`, { timeout: 5000 })
      .then((response) => {
        if (response?.data?.data?.incident) {
          const incident = response.data.data.incident;
          setForm({
            Date1: incident.Date1 || '',
            ContractEmplyee: incident.ContractEmplyee || '',
            Details: incident.Details || '',
            Status: incident.Status || '',
          });
        }
      })
      .catch((err) => {
        console.error('Fetch incident error:', err);
        setFormError('Failed to load incident data for editing.');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [id]);

  const fetchIncidents = useCallback(() => {
    setFetchState('loading');
    setFetchError('');
    axios
      .get('/server/CriticalIncident_function/incidents', { timeout: 5000 })
      .then((response) => {
        if (!response?.data?.data?.incidents) {
          throw new Error('Unexpected API response structure');
        }
        const fetchedIncidents = response.data.data.incidents || [];
        if (!Array.isArray(fetchedIncidents)) {
          throw new Error('Incidents data is not an array');
        }
       
        setIncidents(fetchedIncidents);
        setFilteredIncidents(fetchedIncidents);
        setFetchState('fetched');
      })
      .catch((err) => {
        console.error('Fetch incidents error:', err);
        let errorMessage = 'Failed to fetch incidents. Please try again later.';
       
        if (err.response) {
          errorMessage = err.response.data?.message || `Server error: ${err.response.status}`;
        } else if (err.request) {
          errorMessage = 'No response from server. Please check your connection.';
        } else {
          errorMessage = err.message || 'An unexpected error occurred.';
        }
       
        setFetchError(errorMessage);
        setFetchState('error');
      });
  }, []);

  useEffect(() => {
    if (isFormView) {
      fetchEmployees();
      if (isEditing) {
        fetchIncident();
      }
    } else {
      fetchIncidents();
    }
  }, [fetchEmployees, fetchIncidents, fetchIncident, isFormView, isEditing]);

  // Form handlers
  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setForm(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleEmployeeChange = (e) => {
    const { value } = e.target;
   
    const selectedEmployee = employees.find(emp =>
      emp.id === value ||
      emp.contractEmployeeID === value ||
      emp.employeeCode === value ||
      emp.EmployeeCode === value
    );
   
    if (selectedEmployee) {
      const employeeCode = selectedEmployee.employeeCode ||
                          selectedEmployee.EmployeeCode ||
                          selectedEmployee.contractEmployeeID ||
                          selectedEmployee.ContractEmployeeID ||
                          selectedEmployee.id;
      const employeeName = selectedEmployee.employeeName || selectedEmployee.EmployeeName || selectedEmployee.name || '';
     
      setForm(prev => ({
        ...prev,
        ContractEmplyee: employeeName || employeeCode,
        ContractEmplyeeCode: employeeCode
      }));
    } else {
      setForm(prev => ({
        ...prev,
        ContractEmplyee: value,
        ContractEmplyeeCode: value
      }));
    }
  };

  const validateForm = () => {
    if (!form.ContractEmplyee.trim()) {
      return 'Contract Employee is required';
    }
    if (!form.Details.trim()) {
      return 'Details are required';
    }
    if (!form.Status.trim()) {
      return 'Status is required';
    }
    return null;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
   
    const validationError = validateForm();
    if (validationError) {
      setFormError(validationError);
      return;
    }

    setSubmitting(true);
    setFormError('');
    setSuccessMessage('');

    try {
      const data = {
        Date1: form.Date1,
        ContractEmplyee: form.ContractEmplyee, // save name
        ContractEmplyeeCode: form.ContractEmplyeeCode, // also send code
        Details: form.Details,
        Status: form.Status,
      };

      const url = isEditing
        ? `/server/CriticalIncident_function/incidents/${editingIncidentId}`
        : '/server/CriticalIncident_function/incidents';
     
      const method = isEditing ? 'put' : 'post';
     
      const response = await axios[method](url, data, {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      });

      if (response?.data?.data?.incident) {
        setSuccessMessage(
          isEditing
            ? 'Critical incident updated successfully!'
            : 'Critical incident submitted successfully!'
        );
       
        setTimeout(() => {
          setShowForm(false);
          setEditingIncidentId(null);
          fetchIncidents();
        }, 2000);
      }
    } catch (err) {
      const errorMessage = err.response?.data?.message ||
        (isEditing ? 'Failed to update incident.' : 'Failed to submit incident.');
      setFormError(errorMessage);
      console.error('Submit incident error:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleReset = () => {
    setForm({
      Date1: '',
      ContractEmplyee: '',
      ContractEmplyeeCode: '',
      Details: '',
      Status: '',
    });
    setFormError('');
    setSuccessMessage('');
    setEditingIncidentId(null);
  };

  const handleBack = () => {
    if (isEditing) {
      setEditingIncidentId(null);
      setShowForm(false);
    } else {
      setShowForm(false);
    }
  };

  const toggleForm = () => {
    setShowForm(prev => !prev);
    setFormError('');
    setSuccessMessage('');
    setForm({
      Date1: '',
      ContractEmplyee: '',
      ContractEmplyeeCode: '',
      Details: '',
      Status: '',
    });
    setEditingIncidentId(null);
  };

  // Table handlers
  const editIncident = (incident) => {
    setForm({
      Date1: incident.Date1 || '',
      ContractEmplyee: incident.ContractEmplyee || '',
      ContractEmplyeeCode: incident.ContractEmplyeeCode || '',
      Details: incident.Details || '',
      Status: incident.Status || '',
    });
    setEditingIncidentId(incident.id);
    setShowForm(true);
  };

  const handleCheckboxChange = (incidentId, isChecked) => {
    setSelectedIncidents(prev => {
      const newSelected = new Set(prev);
      if (isChecked) {
        newSelected.add(incidentId);
      } else {
        newSelected.delete(incidentId);
      }
      return newSelected;
    });
  };

  const handleSelectAll = () => {
    if (allSelected) {
      // If all are selected, deselect all
      setSelectedIncidents(new Set());
    } else {
      // If not all are selected, select all
      const allIds = filteredIncidents.map(incident => incident.id);
      setSelectedIncidents(new Set(allIds));
    }
  };

  const handleDeleteSelected = async () => {
    if (selectedIncidents.size === 0) return;
   
    const confirmed = window.confirm(`Are you sure you want to delete ${selectedIncidents.size} selected incident(s)?`);
    if (!confirmed) return;

    try {
      const deletePromises = Array.from(selectedIncidents).map(id =>
        axios.delete(`/server/CriticalIncident_function/incidents/${id}`, { timeout: 5000 })
      );
     
      await Promise.all(deletePromises);
      setSelectedIncidents(new Set());
      fetchIncidents();
      setSuccessMessage(`${selectedIncidents.size} incident(s) deleted successfully!`);
      setTimeout(() => {
        setSuccessMessage('');
      }, 3000);
    } catch (err) {
      console.error('Delete incidents error:', err);
      setSuccessMessage('Failed to delete some incidents. Please try again.');
      setTimeout(() => {
        setSuccessMessage('');
      }, 3000);
    }
  };

  const columns = [
    { label: 'Select', field: null },
    { label: 'Edit', field: null },
    { label: '#', field: null },
    { label: 'Contract Employee', field: 'ContractEmplyee' },
    { label: 'Date', field: 'Date1' },
    { label: 'Details of Incident', field: 'Details' },
    { label: 'Status', field: 'Status' },
  ];

  // Render form view
  if (isFormView) {
    if (loading) {
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
                  <h4>Admin User</h4>
                  <p>App Administrator</p>
                </div>
              </div>
            </nav>

                      {/* Main Content */}
          <div className="cms-main-content">
            {/* Enhanced Header */}
            <header className="cms-header">
              <div className="cms-header-center">
                <h1>{(userEmail === 'afrindinu14@gmail.com' || userEmail === 'vaishnavi.a@buildhr.co.in') ? 'Yashaswi Academy for Skills' : 'Payroll Management System'}</h1>
              </div>
              <div className="cms-header-right">
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
              <div
                className="employee-card-container"
                style={{
                  background: 'var(--white)',
                  borderRadius: '20px',
                  boxShadow: '0 8px 30px var(--shadow-light)',
                  padding: '30px',
                  margin: '0',
                  maxWidth: '100%',
                  position: 'relative',
                  border: '1px solid rgba(37, 99, 235, 0.2)'
                }}
              >
                <div className="loading">Loading incident data...</div>
              </div>
            </main>
            </div>
          </div>
        </>
      );
    }

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
              <img src="https://images.pexels.com/photos/2379004/pexels-photo-2379004.jpeg?auto=compress&cs=tinysrgb&w=150" alt="User" className="cms-user-avatar" />
              <div className="cms-user-details">
                <h4>Admin User</h4>
                <p>App Administrator</p>
              </div>
            </div>
          </nav>

          {/* Main Content */}
          <div className="cms-main-content">
            {/* Enhanced Header */}
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
              <div
                className="employee-card-container"
                style={{
                  background: 'var(--white)',
                  borderRadius: '20px',
                  boxShadow: '0 8px 30px var(--shadow-light)',
                  padding: '30px',
                  margin: '0',
                  maxWidth: '100%',
                  position: 'relative',
                  border: '1px solid rgba(37, 99, 235, 0.2)'
                }}
              >
                <div className="employee-form-page">
                  <div className="employee-form-container">
                    <div className="employee-form-header">
                      <h1 style={{ paddingLeft: '20px' }}>
                        {isEditing ? 'Edit Critical Incident' : 'Add New Critical Incident'}
                      </h1>
                      <button
                        className="close-btn"
                        onClick={handleBack}
                        title="Close form"
                      >
                        <i className="fas fa-times"></i>
                      </button>
                    </div>
                    <div className="employee-form-content">
                      <div className="employee-form-card">
                        {formError && (
                          <div className="error-message" style={{ marginBottom: '20px' }}>
                            {formError}
                          </div>
                        )}

                        {successMessage && (
                          <div className="success-message" style={{ marginBottom: '20px' }}>
                            {successMessage}
                          </div>
                        )}

                        <form onSubmit={handleSubmit}>
                          {/* Critical Incident Info Card */}
                          <div className="form-section-card employee-info">
                            <h2 className="section-title">Critical Incident Information</h2>
                            <div className="form-grid">
                              <div className="form-group">
                                <label>Date<span className="required">*</span></label>
                                <input
                                  type="date"
                                  className="input"
                                  name="Date1"
                                  value={form.Date1}
                                  onChange={handleInputChange}
                                  required
                                />
                              </div>
                              <div className="form-group">
                                <label>Contract Employee<span className="required">*</span></label>
                                <ContractEmployeeSelect
                                  employees={employees}
                                value={form.ContractEmplyee}
                                selectedCode={form.ContractEmplyeeCode}
                                  onChange={handleInputChange}
                                />
                              </div>
                              <div className="form-group">
                                <label>Status<span className="required">*</span></label>
                                <select
                                  className="input"
                                  name="Status"
                                  value={form.Status}
                                  onChange={handleInputChange}
                                  required
                                >
                                  <option value="">Select Status</option>
                                  <option value="Open">Level 1</option>
                                  <option value="In Progress">Level 2</option>
                                  <option value="Resolved">Level 3</option>
                                </select>
                              </div>
                            </div>
                          </div>

                          {/* Incident Details Card */}
                          <div className="form-section-card work-info">
                            <h2 className="section-title">Incident Details</h2>
                            <div className="form-grid">
                              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                                <label>Details<span className="required">*</span></label>
                                <textarea
                                  className="input"
                                  name="Details"
                                  value={form.Details}
                                  onChange={handleInputChange}
                                  rows="6"
                                  placeholder="Enter detailed description of the critical incident..."
                                  required
                                  style={{ resize: 'vertical', minHeight: '120px' }}
                                />
                              </div>
                            </div>
                          </div>

                          <div className="form-actions">
                            <button
                              type="submit"
                              className="btn btn-primary"
                              disabled={submitting}
                            >
                              {isEditing ? 'Update Incident' : 'Submit'}
                              {submitting && <span className="btn-primary__loader ml-5"></span>}
                            </button>
                            <button
                              type="button"
                              className="btn btn-danger"
                              onClick={handleBack}
                            >
                              Cancel
                            </button>
                          </div>
                        </form>
                      </div>
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

  // Render table view
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
              <h4>Admin User</h4>
              <p>App Administrator</p>
            </div>
          </div>
        </nav>

        {/* Main Content */}
        <div className="cms-main-content">
          {/* Enhanced Header */}
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
            <div
              className="employee-card-container"
              style={{
                background: 'var(--white)',
                borderRadius: '20px',
                boxShadow: '0 8px 30px var(--shadow-light)',
                padding: '30px',
                margin: '0',
                maxWidth: '100%',
                position: 'relative',
                border: '1px solid rgba(37, 99, 235, 0.2)'
              }}
            >
              {/* Header and Toolbar */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
                <div className="employee-header-actions">
                  <div className="employee-title-section">
                    <h2 className="employee-title">
                      <AlertOctagon size={28} />
                      Critical Incident Directory
                    </h2>
                    <p className="employee-subtitle">
                      Manage your organization's critical incidents efficiently
                    </p>
                  </div>
                </div>
                {/* Toolbar Buttons */}
                <div className="employee-toolbar" style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'nowrap' }}>
                <button
                  className="toolbar-btn import-btn"
                  onClick={() => {
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.accept = '.csv';
                    input.onchange = (e) => {
                      const file = e.target.files[0];
                      if (file) {
                        const reader = new FileReader();
                        reader.onload = (event) => {
                          const csv = event.target.result;
                          const lines = csv.split('\n');
                          const data = lines.slice(1).filter(line => line.trim());
                         
                          const incidents = data.map(line => {
                            const values = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
                            return {
                              Date1: values[0] || null,
                              ContractEmplyee: values[1] || '',
                              Details: values[2] || '',
                              Status: values[3] || ''
                            };
                          });
                         
                          // Use bulk import endpoint
                          axios.post('/server/CriticalIncident_function/incidents/bulk-import', { incidents })
                            .then((response) => {
                              const { imported, errors, errorDetails } = response.data.data;
                              let message = `Import completed!\nImported: ${imported} incidents`;
                              if (errors > 0) {
                                message += `\nErrors: ${errors}`;
                                console.error('Import errors:', errorDetails);
                              }
                              alert(message);
                              fetchIncidents();
                            })
                            .catch(err => {
                              console.error('Import error:', err);
                              alert('Import failed: ' + (err.response?.data?.message || err.message));
                            });
                        };
                        reader.readAsText(file);
                      }
                    };
                    input.click();
                  }}
                  disabled={false}
                  title="Import incidents from CSV"
                  type="button"
                  style={{ background: '#fff', color: '#22c55e', border: 'none', fontWeight: 600, padding: '8px', borderRadius: '8px', width: '48px', height: '48px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}
                >
                  <FileInput size={22} style={{ color: '#22c55e' }} />
                </button>

                <button
                  className="toolbar-btn export-btn"
                  onClick={() => {
                    const headers = ['Date', 'Contract Employee', 'Details', 'Status'];
                    const csvContent = [
                      headers.join(','),
                      ...filteredIncidents.map(incident => [
                        incident.Date1 || '',
                        incident.ContractEmplyee || '',
                        `"${(incident.Details || '').replace(/"/g, '""')}"`,
                        incident.Status || ''
                      ].join(','))
                    ].join('\n');
                   
                    const blob = new Blob([csvContent], { type: 'text/csv' });
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `critical_incidents_${new Date().toISOString().split('T')[0]}.csv`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    window.URL.revokeObjectURL(url);
                  }}
                  disabled={false}
                  title="Export filtered incidents to CSV"
                  type="button"
                  style={{ background: '#fff', color: '#2563eb', border: 'none', fontWeight: 600, padding: '8px', borderRadius: '8px', width: '48px', height: '48px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}
                >
                  <FileOutput size={22} style={{ color: '#2563eb' }} />
                </button>

                <button
                  className="toolbar-btn filter-btn"
                  onClick={() => setShowSearchDropdown(prev => !prev)}
                  aria-expanded={showSearchDropdown}
                  aria-controls="search-dropdown"
                  type="button"
                  title="Show filter options"
                  style={{ background: '#fff', color: '#f97316', border: 'none', fontWeight: 600, padding: '8px', borderRadius: '8px', width: '48px', height: '48px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}
                >
                  <Filter size={22} style={{ color: '#f97316' }} />
                </button>

                <button
                  className="toolbar-btn"
                  onClick={fetchIncidents}
                  disabled={fetchState === 'loading'}
                  title="Refresh data"
                  type="button"
                  style={{ background: '#fff', color: '#7c3aed', border: 'none', fontWeight: 600, padding: '8px', borderRadius: '8px', width: '48px', height: '48px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}
                >
                  <RefreshCw size={22} style={{ color: '#7c3aed' }} />
                </button>

                <button
                  className="toolbar-btn"
                  onClick={toggleForm}
                  type="button"
                  title="Add new incident"
                  style={{ background: '#fff', color: '#14b8a6', border: 'none', fontWeight: 700, fontSize: '1.2rem', borderRadius: '8px', width: 48, height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(60,72,88,0.10)', padding: 0 }}
                >
                  <Plus size={24} style={{ color: '#14b8a6' }} />
                </button>
                {/* Delete button for selected incidents - moved after + button */}
                {selectedIncidents.size > 0 && (
                  <button
                    className="toolbar-btn"
                    onClick={handleDeleteSelected}
                    disabled={false}
                    title="Delete selected incidents"
                    type="button"
                    style={{
                      background: '#fff',
                      color: '#d32f2f',
                      border: '2px solid #ffcdd2',
                      fontWeight: 700,
                      padding: '8px',
                      borderRadius: '8px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '48px',
                      height: '48px',
                      boxShadow: '0 2px 8px rgba(211,47,47,0.15)',
                    }}
                  >
                    <Trash2 size={22} style={{ color: '#d32f2f' }} />
                  </button>
                )}
              </div>
                  </div>

              {fetchState === 'loading' && (
                <div className="loading">Loading incidents...</div>
              )}

              {fetchState === 'error' && (
                <div className="error">{fetchError}</div>
              )}

              {/* Filter Sidebar */}
              {showSearchDropdown && (
                <div style={{
                  position: 'fixed',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  backgroundColor: 'rgba(0, 0, 0, 0.5)',
                  zIndex: 1000,
                  display: 'flex',
                  justifyContent: 'flex-end',
                  alignItems: 'flex-start',
                  paddingTop: '80px'
                }} onClick={() => setShowSearchDropdown(false)}>
                  <div style={{
                    backgroundColor: 'white',
                    width: '400px',
                    maxHeight: '80vh',
                    overflowY: 'auto',
                    padding: '24px',
                    borderRadius: '8px',
                    marginRight: '20px',
                    boxShadow: '0 10px 25px rgba(0, 0, 0, 0.2)',
                    border: '1px solid #e5e7eb'
                  }} onClick={(e) => e.stopPropagation()}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                      <h4 style={{ margin: 0, color: '#333', fontSize: '18px', fontWeight: '600' }}>Filter Options</h4>
                      <button
                        onClick={() => setShowSearchDropdown(false)}
                        style={{
                          background: 'white',
                          border: '1px solid #e5e7eb',
                          fontSize: '20px',
                          cursor: 'pointer',
                          padding: '4px 8px',
                          color: '#ef4444',
                          borderRadius: '4px',
                          transition: 'background-color 0.2s, color 0.2s, border-color 0.2s',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          width: '32px',
                          height: '32px'
                        }}
                        title="Close filter options"
                      >
                        ×
                      </button>
                    </div>
                    <div style={{ display: 'grid', gap: '16px' }}>
                      {searchableFields.map(({ label, field }) => (
                        <div key={field} style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '8px',
                          padding: '12px',
                          border: '1px solid #f0f0f0',
                          borderRadius: '6px',
                          backgroundColor: '#fafafa'
                        }}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: '500' }}>
                            <input
                              type="checkbox"
                              checked={searchFields[field].enabled}
                              onChange={() => handleFieldToggle(field)}
                              style={{ width: '16px', height: '16px' }}
                            />
                            {label}
                          </label>
                          {searchFields[field].enabled && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginLeft: '24px' }}>
                              {field === 'ContractEmplyee' ? (
                                <ContractEmployeeFilterSelect
                                  value={searchFields[field].value}
                                  onChange={(value) => handleSearchValueChange(field, value)}
                                />
                              ) : (
                                <input
                                  type="text"
                                  value={searchFields[field].value}
                                  onChange={(e) => handleSearchValueChange(field, e.target.value)}
                                  placeholder={`Enter ${label.toLowerCase()}`}
                                  style={{
                                    padding: '6px 8px',
                                    border: '1px solid #d1d5db',
                                    borderRadius: '4px',
                                    fontSize: '14px',
                                    backgroundColor: 'white'
                                  }}
                                />
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                    <div style={{ marginTop: '20px', display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                      <button
                        onClick={() => {
                          setSearchFields({
                            ContractEmplyee: { enabled: false, value: '' },
                            Date1: { enabled: false, value: '' },
                            Details: { enabled: false, value: '' },
                            Status: { enabled: false, value: '' },
                          });
                        }}
                        style={{
                          padding: '8px 16px',
                          backgroundColor: '#6b7280',
                          color: 'white',
                          border: 'none',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          fontSize: '14px'
                        }}
                      >
                        Reset
                      </button>
                      <button
                        onClick={() => setShowSearchDropdown(false)}
                        style={{
                          padding: '8px 16px',
                          backgroundColor: '#3b82f6',
                          color: 'white',
                          border: 'none',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          fontSize: '14px'
                        }}
                      >
                        Apply
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {fetchState === 'fetched' && filteredIncidents.length > 0 && (
                <div className="employee-table-container">
                  <table className={`employee-table ${selectedIncidents.size === 0 ? 'edit-column-hidden' : ''}`}>
                    <thead>
                      <tr>
                        {selectedIncidents.size > 0 ? (
                          <>
                            <th>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <input
                                  type="checkbox"
                                  checked={allSelected}
                                  ref={(input) => {
                                    if (input) {
                                      input.indeterminate = someSelected;
                                    }
                                  }}
                                  onChange={handleSelectAll}
                                  style={{
                                    width: '18px',
                                    height: '18px',
                                    cursor: 'pointer',
                                    accentColor: '#dc3545',
                                  }}
                                  title={allSelected ? 'Deselect all' : 'Select all'}
                                />
                              </div>
                            </th>
                            <th>Edit</th>
                            <th>#</th>
                            <th>Contract Employee</th>
                            <th>Date</th>
                            <th>Details</th>
                            <th>Status</th>
                          </>
                        ) : (
                          <>
                            <th>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <input
                                  type="checkbox"
                                  checked={allSelected}
                                  ref={(input) => {
                                    if (input) {
                                      input.indeterminate = someSelected;
                                    }
                                  }}
                                  onChange={handleSelectAll}
                                  style={{
                                    width: '18px',
                                    height: '18px',
                                    cursor: 'pointer',
                                    accentColor: '#dc3545',
                                  }}
                                  title={allSelected ? 'Deselect all' : 'Select all'}
                                />
                              </div>
                            </th>
                            <th>#</th>
                            <th>Contract Employee</th>
                            <th>Date</th>
                            <th>Details</th>
                            <th>Status</th>
                          </>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredIncidents.map((incident, index) => (
                        <CriticalIncidentRow
                          key={incident.id || index}
                          incident={incident}
                          index={index}
                          editIncident={editIncident}
                          isSelected={selectedIncidents.has(incident.id)}
                          onCheckboxChange={handleCheckboxChange}
                          selectedIncidents={selectedIncidents}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {fetchState === 'fetched' && filteredIncidents.length === 0 && (
                <div className="no-data">No critical incidents found.</div>
              )}
            </div>
          </main>
        </div>
      </div>
    </>
  );
}

export default CriticalIncident;
