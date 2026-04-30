import React, { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import Button from './Button';
import { 
  Users, Calendar, FileText, AlertTriangle, FolderOpen, 
  ClipboardList, Building, Handshake, Landmark, Clock, 
  Map, BarChart3, User, TrendingUp, TrendingDown,
  Activity, Plus, CheckCircle, Bell, Settings, LayoutDashboard, Home as HomeIcon,
  Search, Edit, Trash2, X, FileSignature, CreditCard, Shield, AlertOctagon, Clock3, CalendarDays, Database,
  Filter, RefreshCw
} from 'lucide-react';
import HeaderBranding from './HeaderBranding';
import { getSidebarModulesForUser, resolveSidebarUserEmail } from './modulesConfig';
import './Department.css';

function Department({ userRole = 'App Administrator', userEmail = null, setUserRole }) {
  const [departments, setDepartments] = useState([]);
  const [fetchState, setFetchState] = useState('init');
  const [fetchError, setFetchError] = useState('');
  const [form, setForm] = useState({ 
    department: '',
    addedUser: userEmail || '',
    modifiedUser: userEmail || ''
  });
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [editingDepartment, setEditingDepartment] = useState(null);
  const [success, setSuccess] = useState('');
  const [selectedDepartments, setSelectedDepartments] = useState(new Set());
  const [showSearchSidebar, setShowSearchSidebar] = useState(false);
  const [searchState, setSearchState] = useState({
    departmentName: { enabled: false, value: '', type: 'is' },
  });
  const [departmentSearchTerm, setDepartmentSearchTerm] = useState('');
  const [showDepartmentDropdown, setShowDepartmentDropdown] = useState(false);
  const [selectedDepartment, setSelectedDepartment] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [expandedMenus, setExpandedMenus] = useState({});
  const [showNotifications, setShowNotifications] = useState(false);
  const [showSidebarMenu, setShowSidebarMenu] = useState(false);
  const [currentView, setCurrentView] = useState('list'); // 'list' or 'form'

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

  const searchFields = [
    { label: 'Department Name', key: 'departmentName' },
  ];

  const searchTypes = [
    { label: 'is', value: 'is' },
    { label: 'is not', value: 'is_not' },
    { label: 'is empty', value: 'is_empty' },
    { label: 'is not empty', value: 'is_not_empty' },
  ];

  // Move API base URL to environment variable or config
  const API_BASE_URL = process.env.REACT_APP_API_URL || '/server/department_function';

  // Utility to format timestamps
  const formatTimestamp = (timestamp) => {
    if (!timestamp) return 'N/A';
    return new Date(timestamp).toLocaleString();
  };

  // Filter departments based on search criteria
  const filteredDepartments = departments.filter((d) => {
    return searchFields.every((f) => {
      if (!searchState[f.key].enabled) return true;
      const { type, value } = searchState[f.key];
      const fieldValue = (d[f.key] || '').toLowerCase();
      const searchValue = (value || '').toLowerCase();

      switch (type) {
        case 'is':
          return fieldValue.includes(searchValue);
        case 'is_not':
          return !fieldValue.includes(searchValue);
        case 'is_empty':
          return !fieldValue;
        case 'is_not_empty':
          return !!fieldValue;
        default:
          return true;
      }
    });
  });

  const fetchDepartments = useCallback(() => {
    setFetchState('loading');
    setFetchError('');

    axios
      .get(`${API_BASE_URL}/departments`)
      .then((res) => {
        const { data } = res;
        if (data?.status === 'success' && Array.isArray(data?.data?.departments)) {
          setDepartments(data.data.departments || []);
          setFetchState('fetched');
        } else {
          throw new Error('Invalid response format from server');
        }
      })
      .catch((err) => {
        setFetchError('Failed to fetch departments. Please try again.');
        setFetchState('error');
        console.error('Fetch error:', err);
      });
  }, [API_BASE_URL]);

  useEffect(() => {
    fetchDepartments();
  }, [fetchDepartments]);

  const validateForm = () => {
    if (!form.department.trim()) {
      setFormError('Department name is required.');
      return false;
    }
    return true;
  };

  const saveDepartment = useCallback(
    (e) => {
      e.preventDefault();
      if (!validateForm()) return;

      setSubmitting(true);
      setSuccess('');

      const request = editingDepartment
        ? axios.put(`${API_BASE_URL}/departments/${editingDepartment.id}`, {
            departmentName: form.department.trim(),
            modifiedUser: userEmail || form.modifiedUser,
          })
        : axios.post(`${API_BASE_URL}/departments`, {
            departmentName: form.department.trim(),
            addedUser: userEmail || form.addedUser,
            modifiedUser: userEmail || form.modifiedUser,
          });

      request
        .then((res) => {
          const { data } = res;
          if (data?.status === 'success' && data?.data?.department) {
            const returnedDepartment = data.data.department;
            if (editingDepartment) {
              setDepartments(
                departments.map((d) =>
                  d.id === returnedDepartment.id ? returnedDepartment : d
                )
              );
              setSuccess('Department updated successfully!');
            } else {
              setDepartments([...departments, returnedDepartment]);
              setSuccess('Department added successfully!');
            }
            setCurrentView('list');
            setEditingDepartment(null);
            setForm({ department: '' });
          } else {
            throw new Error(
              data?.message || `Failed to ${editingDepartment ? 'update' : 'add'} department.`
            );
          }
        })
        .catch((err) => {
          setFormError(
            err.response?.data?.message ||
              `Failed to ${editingDepartment ? 'update' : 'add'} department. Please try again.`
          );
          console.error('Save error:', err);
        })
        .finally(() => setSubmitting(false));
    },
    [form, editingDepartment, departments, API_BASE_URL]
  );

  const handleEdit = (department) => {
    setEditingDepartment(department);
    setForm({ 
      department: department.departmentName,
      addedUser: department.addedUser || userEmail || '',
      modifiedUser: userEmail || ''
    });
    setCurrentView('form');
    setFormError('');
    setSuccess('');
  };

  const handleDelete = (departmentId) => {
    if (!window.confirm('Are you sure you want to delete this department?')) return;

    setDeleting(true);
    axios
      .delete(`${API_BASE_URL}/departments/${departmentId}`)
      .then((res) => {
        if (res.data?.status === 'success') {
          fetchDepartments();
          setSuccess('Department deleted successfully!');
        } else {
          throw new Error(res.data?.message || 'Failed to delete department.');
        }
      })
      .catch((err) => {
        setFetchError(
          err.response?.data?.message || 'Failed to delete department. Please try again.'
        );
        console.error('Delete error:', err);
      })
      .finally(() => setDeleting(false));
  };

  const toggleAllDepartmentsSelection = () => {
    if (selectedDepartments.size === departments.length) {
      setSelectedDepartments(new Set());
    } else {
      setSelectedDepartments(new Set(departments.map((d) => d.id)));
    }
  };

  const toggleDepartmentSelection = (departmentId) => {
    const newSelection = new Set(selectedDepartments);
    if (newSelection.has(departmentId)) {
      newSelection.delete(departmentId);
    } else {
      newSelection.add(departmentId);
    }
    setSelectedDepartments(newSelection);
  };

  const handleDeleteSelected = () => {
    if (selectedDepartments.size === 0) return;
    
    if (window.confirm(`Are you sure you want to delete ${selectedDepartments.size} selected department(s)?`)) {
      setDeleting(true);
      const deletePromises = Array.from(selectedDepartments).map(id => 
        axios.delete(`${API_BASE_URL}/departments/${id}`)
      );
      
      Promise.all(deletePromises)
        .then(() => {
          fetchDepartments();
          setSelectedDepartments(new Set());
          setSuccess(`Successfully deleted ${selectedDepartments.size} department(s)!`);
        })
        .catch((err) => {
          setFetchError('Failed to delete some departments. Please try again.');
          console.error('Bulk delete error:', err);
        })
        .finally(() => setDeleting(false));
    }
  };


  // Filter departments based on search term
  const filteredDepartmentsForSearch = departments.filter(dept => 
    dept.departmentName?.toLowerCase().includes(departmentSearchTerm.toLowerCase())
  );

  // Handle department selection from dropdown
  const handleDepartmentSelect = (department) => {
    setSelectedDepartment(department);
    setSearchState(prev => ({
      ...prev,
      departmentName: { 
        enabled: true, 
        value: department.departmentName, 
        type: 'is' 
      }
    }));
    setShowDepartmentDropdown(false);
    setDepartmentSearchTerm('');
  };

  // Handle department search input change
  const handleDepartmentSearchChange = (e) => {
    setDepartmentSearchTerm(e.target.value);
    setShowDepartmentDropdown(true);
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (showDepartmentDropdown && !event.target.closest('.department-search-container')) {
        setShowDepartmentDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showDepartmentDropdown]);

  const resetForm = () => {
    setForm({ 
      department: '',
      addedUser: userEmail || '',
      modifiedUser: userEmail || ''
    });
    setFormError('');
    setEditingDepartment(null);
  };

  const toggleForm = () => {
    if (currentView === 'form') {
      setCurrentView('list');
      resetForm();
    } else {
      setCurrentView('form');
    }
  };

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
          
          {/* Department Content */}
          <main className="cms-dashboard-content">
            {currentView === 'list' ? (
              /* List View */
              <div className="department-management-section">
                {/* Header Actions - Matching EmployeeManagement Style */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
                  <div className="employee-header-actions">
                    <div className="employee-title-section">
                      <h2 className="employee-title">
                        <Building size={28} />
                        Department Directory
                      </h2>
                      <p className="employee-subtitle">
                        Manage your organization's departments efficiently
                      </p>
                    </div>
                  </div>
                  {/* Toolbar Buttons - Matching EmployeeManagement Style */}
                  <div className="employee-toolbar" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <button
                      className="toolbar-btn filter-btn"
                      onClick={() => setShowSearchSidebar(true)}
                      title="Search departments"
                      type="button"
                      style={{ background: '#fff', border: 'none', padding: '8px', borderRadius: '8px', width: '48px', height: '48px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(60,72,88,0.10)' }}
                    >
                      <Filter size={22} style={{ color: '#f97316' }} />
                    </button>
                    <button
                      className="toolbar-btn"
                      onClick={() => {
                        setCurrentView('list');
                        fetchDepartments();
                      }}
                      disabled={fetchState === 'loading'}
                      title="Refresh data"
                      type="button"
                      style={{ background: '#fff', border: 'none', padding: '8px', borderRadius: '8px', width: '48px', height: '48px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(60,72,88,0.10)' }}
                    >
                      <RefreshCw size={22} style={{ color: '#9333ea' }} />
                    </button>
                    <button
                      className="toolbar-btn"
                      onClick={toggleForm}
                      type="button"
                      title="Add new department"
                      style={{ background: '#fff', border: 'none', borderRadius: '8px', width: 48, height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(60,72,88,0.10)', padding: 0 }}
                    >
                      <Plus size={22} style={{ color: '#0d9488' }} />
                    </button>
                    {/* Delete button for selected departments - moved after + button */}
                    {selectedDepartments.size > 0 && (
                      <button
                        className="toolbar-btn"
                        onClick={handleDeleteSelected}
                        disabled={deleting}
                        title="Delete selected departments"
                        type="button"
                        style={{
                          background: '#fff',
                          border: '2px solid #ffcdd2',
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

                {/* Messages */}
                {(fetchError || success) && (
                  <div
                    className={`cms-message ${fetchError ? 'cms-message-error' : 'cms-message-success'}`}
                  >
                    {fetchError || success}
                  </div>
                )}

                {/* Department Content */}
                <div className="department-content">
                  {fetchState === 'loading' ? (
                    <div className="cms-loading">
                      <div className="cms-spinner"></div>
                      <p>Loading departments...</p>
                    </div>
                  ) : fetchState === 'error' ? (
                    <div className="cms-error-state">
                      <div className="cms-error-icon">⚠️</div>
                      <h3>Error Loading Departments</h3>
                      <p>{fetchError}</p>
                      <button className="cms-btn cms-btn-primary" onClick={fetchDepartments}>
                        Try Again
                      </button>
                    </div>
                  ) : filteredDepartments.length > 0 ? (
                    <div className="departments-grid">
                      {filteredDepartments.map((d, index) => (
                        <div key={d.id} className="department-card" style={{ animationDelay: `${index * 0.1}s` }}>
                          <div className="card-glow"></div>
                          <div className="card-header">
                            <div className="card-icon">🏢</div>
                            <h3 className="card-title">{d.departmentName || 'N/A'}</h3>
                            <div className="card-id">ID: {d.id || 'N/A'}</div>
                          </div>
                          <div className="card-body">
                            <div className="card-stats">
                              <div className="stat-item">
                                <span className="stat-label">Status</span>
                                <span className="stat-value active">Active</span>
                              </div>
                              <div className="stat-item">
                                <span className="stat-label">Created</span>
                                <span className="stat-value">{formatTimestamp(d.addedTime) || new Date().toLocaleDateString()}</span>
                              </div>
                            </div>
                            <div className="card-stats">
                              <div className="stat-item">
                                <span className="stat-label">Added By</span>
                                <span className="stat-value">{d.addedUser || 'N/A'}</span>
                              </div>
                              <div className="stat-item">
                                <span className="stat-label">Modified By</span>
                                <span className="stat-value">{d.modifiedUser || 'N/A'}</span>
                              </div>
                            </div>
                          </div>
                          <div className={`card-actions ${selectedDepartments.has(d.id) ? 'selected' : ''}`}>
                            <div className="card-checkbox">
                              <input
                                type="checkbox"
                                checked={selectedDepartments.has(d.id)}
                                onChange={() => toggleDepartmentSelection(d.id)}
                                aria-label={`Select department ${d.departmentName}`}
                              />
                            </div>
                            <button
                              className="card-edit-btn"
                              onClick={() => handleEdit(d)}
                              title="Edit department"
                              aria-label={`Edit department ${d.departmentName}`}
                            >
                              <Edit size={16} />
                            </button>
                            <button
                              className="card-delete-btn"
                              onClick={() => handleDelete(d.id)}
                              title="Delete department"
                              aria-label={`Delete department ${d.departmentName}`}
                              disabled={deleting}
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="empty-state">
                      <div className="empty-icon">🏢</div>
                      <h3>No Departments Found</h3>
                      <p>Start by adding your first department to the system.</p>
                      <button
                        className="cms-btn cms-btn-primary"
                        onClick={() => {
                          setCurrentView('form');
                          resetForm();
                        }}
                      >
                        <Plus size={16} />
                        Add First Department
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              /* Form View - Matching EmployeeManagement Style */
              <div className="employee-form-page">
                <div className="employee-form-container">
                  <div className="employee-form-header">
                    <h1 style={{ paddingLeft: '20px' }}>
                      {editingDepartment ? 'Edit Department' : 'Add New Department'}
                    </h1>
                    <button
                      className="close-btn" 
                      onClick={toggleForm}
                      title="Close form"
                    >
                      <X size={24} />
                    </button>
                  </div>
                  <div className="employee-form-content">
                    <form className="department-form" onSubmit={saveDepartment}>
                      <div className="form-section-card employee-info">
                        <h2 className="section-title">Department Information</h2>
                        <div className="form-grid">
                          <div className="form-group">
                            <label htmlFor="department" className="form-label">
                              Department Name <span className="required">*</span>
                            </label>
                            <div className="input-wrapper">
                              <input
                                id="department"
                                name="department"
                                type="text"
                                value={form.department}
                                onChange={(e) => setForm({ ...form, department: e.target.value })}
                                className="form-input"
                                required
                                autoFocus
                                placeholder="Enter department name (e.g., Human Resources, IT)"
                              />
                              <div className="input-icon">🏢</div>
                            </div>
                          </div>
                          
                          <div className="form-group">
                            <label htmlFor="addedUser" className="form-label">
                              Added User
                            </label>
                            <div className="input-wrapper">
                              <input
                                id="addedUser"
                                name="addedUser"
                                type="text"
                                value={form.addedUser}
                                onChange={(e) => setForm({ ...form, addedUser: e.target.value })}
                                className="form-input"
                                placeholder="User who added this department"
                                readOnly={!!userEmail}
                              />
                              <div className="input-icon">👤</div>
                            </div>
                          </div>
                          
                          <div className="form-group">
                            <label htmlFor="modifiedUser" className="form-label">
                              Modified User
                            </label>
                            <div className="input-wrapper">
                              <input
                                id="modifiedUser"
                                name="modifiedUser"
                                type="text"
                                value={form.modifiedUser}
                                onChange={(e) => setForm({ ...form, modifiedUser: e.target.value })}
                                className="form-input"
                                placeholder="User who last modified this department"
                                readOnly={!!userEmail}
                              />
                              <div className="input-icon">✏️</div>
                            </div>
                          </div>
                        </div>
                      </div>

                      {formError && (
                        <div className="cms-message cms-message-error">
                          {formError}
                        </div>
                      )}

                      <div className="form-actions">
                        <button
                          type="submit"
                          className="cms-btn cms-btn-primary"
                          disabled={submitting}
                        >
                          {editingDepartment ? '💾 Update Department' : '🚀 Add Department'}
                          {submitting && <span className="btn-loader" />}
                        </button>
                        <button
                          type="button"
                          className="cms-btn cms-btn-secondary"
                          onClick={resetForm}
                        >
                          🔄 Reset
                        </button>
                        <button
                          type="button"
                          className="cms-btn cms-btn-danger"
                          onClick={toggleForm}
                        >
                          ❌ Cancel
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
              </div>
            )}
          </main>
        </div>
      </div>

      {/* Filter Sidebar */}
      {showSearchSidebar && (
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
        }} onClick={() => setShowSearchSidebar(false)}>
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
                onClick={() => setShowSearchSidebar(false)}
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
              {/* Department Search Section */}
              <div style={{ 
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
                    checked={searchState.departmentName.enabled}
                    onChange={(e) =>
                      setSearchState((prev) => ({
                        ...prev,
                        departmentName: { ...prev.departmentName, enabled: e.target.checked },
                      }))
                    }
                    style={{ width: '16px', height: '16px' }}
                  />
                  Department
                </label>
                {searchState.departmentName.enabled && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginLeft: '24px' }}>
                    <div className="department-search-container" style={{ position: 'relative' }}>
                      <input
                        type="text"
                        value={departmentSearchTerm}
                        onChange={handleDepartmentSearchChange}
                        onFocus={() => setShowDepartmentDropdown(true)}
                        placeholder="Search department..."
                        style={{
                          width: '100%',
                          padding: '8px 12px',
                          border: '1px solid #d1d5db',
                          borderRadius: '4px',
                          fontSize: '14px',
                          backgroundColor: 'white'
                        }}
                      />
                      {showDepartmentDropdown && (
                        <div style={{
                          position: 'absolute',
                          top: '100%',
                          left: 0,
                          right: 0,
                          backgroundColor: 'white',
                          border: '1px solid #d1d5db',
                          borderRadius: '4px',
                          boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
                          zIndex: 1000,
                          maxHeight: '200px',
                          overflowY: 'auto'
                        }}>
                          {filteredDepartmentsForSearch.length > 0 ? (
                            filteredDepartmentsForSearch.map((dept) => (
                              <div
                                key={dept.id}
                                onClick={() => handleDepartmentSelect(dept)}
                                style={{
                                  padding: '8px 12px',
                                  cursor: 'pointer',
                                  borderBottom: '1px solid #f0f0f0',
                                  fontSize: '14px',
                                  transition: 'background-color 0.2s'
                                }}
                                onMouseOver={(e) => e.target.style.backgroundColor = '#f8fafc'}
                                onMouseOut={(e) => e.target.style.backgroundColor = 'white'}
                              >
                                {dept.departmentName}
                              </div>
                            ))
                          ) : (
                            <div style={{
                              padding: '8px 12px',
                              color: '#6b7280',
                              fontSize: '14px',
                              fontStyle: 'italic'
                            }}>
                              No departments found
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    {selectedDepartment && (
                      <div style={{
                        padding: '8px 12px',
                        backgroundColor: '#e0f2fe',
                        border: '1px solid #0ea5e9',
                        borderRadius: '4px',
                        fontSize: '14px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                      }}>
                        <span>Selected: {selectedDepartment.departmentName}</span>
                        <button
                          onClick={() => {
                            setSelectedDepartment(null);
                            setSearchState(prev => ({
                              ...prev,
                              departmentName: { enabled: false, value: '', type: 'is' }
                            }));
                          }}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: '#ef4444',
                            cursor: 'pointer',
                            fontSize: '16px',
                            padding: '0',
                            marginLeft: '8px'
                          }}
                        >
                          ×
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
            <div style={{ marginTop: '20px', display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setSearchState({
                  departmentName: { enabled: false, value: '', type: 'is' },
                })}
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
                onClick={() => setShowSearchSidebar(false)}
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
    </>
  );
}

export default Department;
