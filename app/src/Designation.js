import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import Button from './Button';
import { 
  Users, Calendar, FileText, AlertTriangle, FolderOpen, 
  ClipboardList, Building, Handshake, Landmark, Clock, 
  Map, BarChart3, User, TrendingUp, TrendingDown,
  Activity, Plus, CheckCircle, Bell, Settings, LayoutDashboard, Home as HomeIcon,
  Search, Edit, Trash2, X, FileSignature, CreditCard, Shield, AlertOctagon, Clock3, CalendarDays, Database,
  Filter
} from 'lucide-react';
import HeaderBranding from './HeaderBranding';
import { getSidebarModulesForUser, resolveSidebarUserEmail } from './modulesConfig';
import './employeeManagement.css';
import './Designation.css';

function Designation({ userRole = 'App Administrator', setUserRole }) {
  const userEmail = localStorage.getItem('userEmail') || null;
  const [designations, setDesignations] = useState([]);
  const [fetchState, setFetchState] = useState('init');
  const [fetchError, setFetchError] = useState('');
  const [form, setForm] = useState({ designation: '', skillType: '' });
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [editingDesignation, setEditingDesignation] = useState(null);
  const [success, setSuccess] = useState('');
  const [selectedDesignations, setSelectedDesignations] = useState(new Set());
  const [showSearchSidebar, setShowSearchSidebar] = useState(false);
  const [searchState, setSearchState] = useState({
    designation: { enabled: false, value: '', type: 'is' },
    skillType: { enabled: false, value: '', type: 'is' },
  });
  const [deleting, setDeleting] = useState(false);
  const [expandedMenus, setExpandedMenus] = useState({});
  const [showNotifications, setShowNotifications] = useState(false);
  const [showSidebarMenu, setShowSidebarMenu] = useState(false);
  const [currentView, setCurrentView] = useState('list'); // 'list' or 'form'
  const [allDesignations, setAllDesignations] = useState([]); // Store all designations for filter dropdown
  const [designationSearchTerm, setDesignationSearchTerm] = useState(''); // Search term for designation filter
  const [showDesignationDropdown, setShowDesignationDropdown] = useState(false);
  const [selectedDesignation, setSelectedDesignation] = useState(null);
  const [skillTypeSearchTerm, setSkillTypeSearchTerm] = useState(''); // Search term for skill type filter
  const [showSkillTypeDropdown, setShowSkillTypeDropdown] = useState(false);
  const [selectedSkillType, setSelectedSkillType] = useState(null);

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
    { label: 'Designation Name', key: 'designation' },
    { label: 'Skill Type', key: 'skillType' },
  ];

  const searchTypes = [
    { label: 'is', value: 'is' },
  ];

  // Filter designations for search dropdown
  const filteredDesignationsForSearch = allDesignations.filter(designation =>
    designation.designation.toLowerCase().includes(designationSearchTerm.toLowerCase())
  );

  // Get unique skill types for search dropdown
  const uniqueSkillTypes = [...new Set(allDesignations.map(d => d.skillType).filter(Boolean))];
  const filteredSkillTypesForSearch = uniqueSkillTypes.filter(skillType =>
    skillType.toLowerCase().includes(skillTypeSearchTerm.toLowerCase())
  );

  // Move API base URL to environment variable or config
  const API_BASE_URL = process.env.REACT_APP_API_URL || '/server/Designation_function';

  // Filter designations based on search criteria
  const filteredDesignations = designations.filter((d) => {
    return searchFields.every((f) => {
      if (!searchState[f.key].enabled) return true;
      const { value } = searchState[f.key];
      const fieldValue = (d[f.key] || '').toLowerCase();
      const searchValue = (value || '').toLowerCase();

      return fieldValue.includes(searchValue);
    });
  });

  const fetchDesignations = useCallback(() => {
    setFetchState('loading');
    setFetchError('');

    axios
      .get(`${API_BASE_URL}/designations`)
      .then((res) => {
        const { data } = res;
        console.log('Fetch response:', data);
        if (data?.status === 'success' && Array.isArray(data?.data?.designations)) {
          // Map the backend response to frontend expected format
          const mappedDesignations = data.data.designations.map(item => ({
            id: item.id,
            designation: item.designationName, // Map designationName to designation
            skillType: item.skillType || ''
          }));
          console.log('Mapped designations:', mappedDesignations);
          setDesignations(mappedDesignations || []);
          setAllDesignations(mappedDesignations || []); // Store all designations for filter
          setFetchState('fetched');
        } else {
          throw new Error('Invalid response format from server');
        }
      })
      .catch((err) => {
        setFetchError('Failed to fetch designations. Please try again.');
        setFetchState('error');
        console.error('Fetch error:', err);
      });
  }, [API_BASE_URL]);

  useEffect(() => {
    fetchDesignations();
  }, [fetchDesignations]);

  const validateForm = () => {
    if (!form.designation.trim()) {
      setFormError('Designation name is required.');
      return false;
    }
    return true;
  };

  const saveDesignation = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;

    setSubmitting(true);
    setFormError('');
    setSuccess('');

    try {
      const url = editingDesignation
        ? `${API_BASE_URL}/designations/${editingDesignation.id}`
        : `${API_BASE_URL}/designations`;
      const method = editingDesignation ? 'PUT' : 'POST';

      console.log('Saving designation:', {
        url,
        method,
        data: form,
        editingDesignation: editingDesignation?.id
      });

      const response = await axios({
        method,
        url,
        data: { designationName: form.designation, skillType: form.skillType },
        headers: { 'Content-Type': 'application/json' },
      });

      console.log('Response:', response.data);

      if (response.data?.status === 'success') {
        setSuccess(
          editingDesignation
            ? 'Designation updated successfully!'
            : 'Designation added successfully!'
        );
        fetchDesignations();
        resetForm();
        setCurrentView('list');
      } else {
        throw new Error(response.data?.message || 'Invalid response from server');
      }
    } catch (error) {
      console.error('Error saving designation:', error);
      console.error('Error details:', {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status
      });
      setFormError(
        error.response?.data?.message || error.message ||
          `Failed to ${editingDesignation ? 'update' : 'add'} designation. Please try again.`
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = (designation) => {
    setEditingDesignation(designation);
    setForm({ 
      designation: designation.designation || designation.designationName,
      skillType: designation.skillType || ''
    });
    setCurrentView('form');
    setFormError('');
    setSuccess('');
  };

  const handleDelete = (designationId) => {
    if (!window.confirm('Are you sure you want to delete this designation?')) return;

    setDeleting(true);
    axios
      .delete(`${API_BASE_URL}/designations/${designationId}`)
      .then((res) => {
        if (res.data?.status === 'success') {
          fetchDesignations();
          setSuccess('Designation deleted successfully!');
        } else {
          throw new Error(res.data?.message || 'Failed to delete designation.');
        }
      })
      .catch((err) => {
        setFetchError(
          err.response?.data?.message || 'Failed to delete designation. Please try again.'
        );
        console.error('Delete error:', err);
      })
      .finally(() => setDeleting(false));
  };

  const handleDeleteSelected = () => {
    if (
      !window.confirm(
        `Are you sure you want to delete ${selectedDesignations.size} selected designations?`
      )
    )
      return;

    setDeleting(true);
    const deletePromises = Array.from(selectedDesignations).map((designationId) =>
      axios.delete(`${API_BASE_URL}/designations/${designationId}`)
    );

    Promise.all(deletePromises)
      .then(() => {
        fetchDesignations();
        setSelectedDesignations(new Set());
        setSuccess('Selected designations deleted successfully!');
      })
      .catch((err) => {
        setFetchError('Failed to delete one or more designations. Please try again.');
        console.error('Bulk delete error:', err);
      })
      .finally(() => setDeleting(false));
  };

  const toggleAllDesignationsSelection = () => {
    if (selectedDesignations.size === designations.length) {
      setSelectedDesignations(new Set());
    } else {
      setSelectedDesignations(new Set(designations.map((d) => d.id)));
    }
  };

  const toggleDesignationSelection = (designationId) => {
    const newSelection = new Set(selectedDesignations);
    if (newSelection.has(designationId)) {
      newSelection.delete(designationId);
    } else {
      newSelection.add(designationId);
    }
    setSelectedDesignations(newSelection);
  };

  // Handle designation selection from dropdown
  const handleDesignationSelect = (designation) => {
    setSelectedDesignation(designation);
    setSearchState(prev => ({
      ...prev,
      designation: { 
        enabled: true, 
        value: designation.designation, 
        type: 'is' 
      }
    }));
    setShowDesignationDropdown(false);
    setDesignationSearchTerm('');
  };

  // Handle designation search input change
  const handleDesignationSearchChange = (e) => {
    setDesignationSearchTerm(e.target.value);
    setShowDesignationDropdown(true);
  };

  // Handle skill type selection from dropdown
  const handleSkillTypeSelect = (skillType) => {
    setSelectedSkillType(skillType);
    setSearchState(prev => ({
      ...prev,
      skillType: { 
        enabled: true, 
        value: skillType, 
        type: 'is' 
      }
    }));
    setShowSkillTypeDropdown(false);
    setSkillTypeSearchTerm('');
  };

  // Handle skill type search input change
  const handleSkillTypeSearchChange = (e) => {
    setSkillTypeSearchTerm(e.target.value);
    setShowSkillTypeDropdown(true);
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (showDesignationDropdown && !event.target.closest('.designation-search-container')) {
        setShowDesignationDropdown(false);
      }
      if (showSkillTypeDropdown && !event.target.closest('.skilltype-search-container')) {
        setShowSkillTypeDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showDesignationDropdown, showSkillTypeDropdown]);

  const resetForm = () => {
    setForm({ designation: '', skillType: '' });
    setFormError('');
    setEditingDesignation(null);
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

          {/* Designation Content */}
          <main className="cms-dashboard-content">
            <div 
              className="designation-card-container" 
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
              {/* Title above toolbar - Designation Directory */}
              <div style={{ marginBottom: '32px' }}>
                <div className="employee-header-actions" style={{ marginBottom: '16px' }}>
                  <div className="employee-title-section">
                    <div className="employee-section-title">
                      <ClipboardList size={28} />
                      Designation Directory
                    </div>
                    <div className="employee-section-subtitle">
                      Manage your organization's designations efficiently
                    </div>
                  </div>
                </div>
                {/* Toolbar Buttons - below title */}
                <div className="employee-toolbar" style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'nowrap' }}>
                  <button
                    className="toolbar-btn filter-btn"
                    onClick={() => setShowSearchSidebar(true)}
                    title="Search designations"
                    type="button"
                    style={{ background: '#fff', border: 'none', padding: '8px', borderRadius: '8px', width: '48px', height: '48px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(60,72,88,0.10)' }}
                  >
                    <Filter size={22} style={{ color: '#f97316' }} />
                  </button>
                  <button
                    className="toolbar-btn"
                    onClick={() => {
                      setCurrentView('form');
                      resetForm();
                    }}
                    title="Add new designation"
                    type="button"
                    style={{ background: '#fff', border: 'none', borderRadius: '8px', width: '48px', height: '48px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(60,72,88,0.10)' }}
                  >
                    <Plus size={22} style={{ color: '#0d9488' }} />
                  </button>
                  {selectedDesignations.size > 0 && (
                    <button
                      className="toolbar-btn"
                      onClick={handleDeleteSelected}
                      disabled={deleting}
                      title={`Delete ${selectedDesignations.size} selected designation(s)`}
                      type="button"
                      style={{
                        background: '#fff',
                        border: '2px solid #ffcdd2',
                        padding: '8px',
                        borderRadius: '8px',
                        width: '48px',
                        height: '48px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: '0 2px 8px rgba(211,47,47,0.15)'
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

              {/* Designation Content */}
              <div className="designation-content">
                {currentView === 'list' ? (
                  fetchState === 'loading' ? (
                    <div className="cms-loading">
                      <div className="cms-spinner"></div>
                      <p>Loading designations...</p>
                    </div>
                  ) : fetchState === 'error' ? (
                    <div className="cms-error-state">
                      <div className="cms-error-icon">⚠️</div>
                      <h3>Error Loading Designations</h3>
                      <p>{fetchError}</p>
                      <button className="cms-btn cms-btn-primary" onClick={fetchDesignations}>
                        Try Again
                      </button>
                    </div>
                  ) : filteredDesignations.length > 0 ? (
                    <div className="designations-grid">
                      {filteredDesignations.map((d, index) => (
                        <div key={d.id} className="designation-card" style={{ animationDelay: `${index * 0.1}s` }}>
                          <div className="card-glow"></div>
                          <div className="card-header">
                            <div className="card-icon">🎯</div>
                            <h3 className="card-title">{d.designation || 'N/A'}</h3>
                            <div className="card-id">ID: {d.id || 'N/A'}</div>
                          </div>
                          <div className="card-body">
                            <div className="card-stats">
                              <div className="stat-item">
                                <span className="stat-label">Status</span>
                                <span className="stat-value active">Active</span>
                              </div>
                              <div className="stat-item">
                                <span className="stat-label">Skill Type</span>
                                <span className="stat-value">{d.skillType || 'Not specified'}</span>
                              </div>
                              <div className="stat-item">
                                <span className="stat-label">Created</span>
                                <span className="stat-value">{new Date().toLocaleDateString()}</span>
                              </div>
                            </div>
                          </div>
                          <div className="card-actions">
                            <div className="card-checkbox">
                              <input
                                type="checkbox"
                                checked={selectedDesignations.has(d.id)}
                                onChange={() => toggleDesignationSelection(d.id)}
                                aria-label={`Select designation ${d.designation}`}
                              />
                            </div>
                            <button
                              className="card-edit-btn"
                              onClick={() => handleEdit(d)}
                              title="Edit designation"
                              aria-label={`Edit designation ${d.designationName}`}
                            >
                              <Edit size={16} />
                            </button>
                            <button
                              className="card-delete-btn"
                              onClick={() => handleDelete(d.id)}
                              title="Delete designation"
                              aria-label={`Delete designation ${d.designationName}`}
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
                      <div className="empty-icon">📋</div>
                      <h3>No Designations Found</h3>
                      <p>Start by adding your first designation to the system.</p>
                      <button
                        className="cms-btn cms-btn-primary"
                        onClick={() => {
                          setCurrentView('form');
                          resetForm();
                        }}
                      >
                        <Plus size={16} />
                        Add First Designation
                      </button>
                    </div>
                  )
                ) : (
                  /* Form View */
                  <div className="employee-form-page">
                    <div className="employee-form-container">
                      <div className="employee-form-header">
                        <h1 style={{ paddingLeft: '20px' }}>
                          {editingDesignation ? 'Edit Designation' : 'Add New Designation'}
                        </h1>
                        <button
                          className="close-btn" 
                          onClick={toggleForm}
                          title="Close form"
                        >
                          <i className="fas fa-times"></i>
                        </button>
                      </div>
                      <div className="employee-form-content">
                        <div className="employee-form-card">
                          <form onSubmit={saveDesignation}>
                            {/* Designation Info Card */}
                            <div className="form-section-card employee-info">
                              <h2 className="section-title">Designation Info</h2>
                              <div className="form-grid">
                                <div className="form-group">
                                  <label>Designation Name</label>
                                  <input 
                                    className="input" 
                                    name="designation" 
                                    value={form.designation} 
                                    onChange={(e) => setForm({ ...form, designation: e.target.value })}
                                    placeholder="Enter designation name (e.g., Software Engineer, Manager)"
                                    required
                                    autoFocus
                                  />
                                </div>
                                <div className="form-group">
                                  <label>Skill Type</label>
                                  <select 
                                    className="input" 
                                    name="skillType" 
                                    value={form.skillType} 
                                    onChange={(e) => setForm({ ...form, skillType: e.target.value })}
                                  >
                                    <option value="">Select skill type</option>
                                    <option value="Skilled">Skilled</option>
                                    <option value="Semi Skilled">Semi Skilled</option>
                                    <option value="Unskilled">Unskilled</option>
                                  </select>
                                </div>
                              </div>
                            </div>
                            
                            <div className="form-actions">
                              <button type="submit" className="btn btn-primary" disabled={submitting}>
                                {editingDesignation ? 'Update Designation' : 'Submit'}
                                {submitting && <span className="btn-primary__loader ml-5"></span>}
                              </button>
                              <button type="button" className="btn btn-danger" onClick={toggleForm}>
                                Cancel
                              </button>
                            </div>
                            {formError && <div className="error-message">{formError}</div>}
                          </form>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
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
              {/* Designation Search Section */}
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
                    checked={searchState.designation.enabled}
                    onChange={(e) =>
                      setSearchState((prev) => ({
                        ...prev,
                        designation: { ...prev.designation, enabled: e.target.checked },
                      }))
                    }
                    style={{ width: '16px', height: '16px' }}
                  />
                  Designation Name
                </label>
                {searchState.designation.enabled && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginLeft: '24px' }}>
                    <div className="designation-search-container" style={{ position: 'relative' }}>
                      <input
                        type="text"
                        value={designationSearchTerm}
                        onChange={handleDesignationSearchChange}
                        onFocus={() => setShowDesignationDropdown(true)}
                        placeholder="Search designation..."
                        style={{
                          width: '100%',
                          padding: '8px 12px',
                          border: '1px solid #d1d5db',
                          borderRadius: '4px',
                          fontSize: '14px',
                          backgroundColor: 'white'
                        }}
                      />
                      {showDesignationDropdown && (
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
                          {filteredDesignationsForSearch.length > 0 ? (
                            filteredDesignationsForSearch.map((designation) => (
                              <div
                                key={designation.id}
                                onClick={() => handleDesignationSelect(designation)}
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
                                {designation.designation}
                              </div>
                            ))
                          ) : (
                            <div style={{
                              padding: '8px 12px',
                              color: '#6b7280',
                              fontSize: '14px',
                              fontStyle: 'italic'
                            }}>
                              No designations found
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    {selectedDesignation && (
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
                        <span>Selected: {selectedDesignation.designation}</span>
                        <button
                          onClick={() => {
                            setSelectedDesignation(null);
                            setSearchState(prev => ({
                              ...prev,
                              designation: { enabled: false, value: '', type: 'is' }
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

              {/* Skill Type Search Section */}
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
                    checked={searchState.skillType.enabled}
                    onChange={(e) =>
                      setSearchState((prev) => ({
                        ...prev,
                        skillType: { ...prev.skillType, enabled: e.target.checked },
                      }))
                    }
                    style={{ width: '16px', height: '16px' }}
                  />
                  Skill Type
                </label>
                {searchState.skillType.enabled && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginLeft: '24px' }}>
                    <div className="skilltype-search-container" style={{ position: 'relative' }}>
                      <input
                        type="text"
                        value={skillTypeSearchTerm}
                        onChange={handleSkillTypeSearchChange}
                        onFocus={() => setShowSkillTypeDropdown(true)}
                        placeholder="Search skill type..."
                        style={{
                          width: '100%',
                          padding: '8px 12px',
                          border: '1px solid #d1d5db',
                          borderRadius: '4px',
                          fontSize: '14px',
                          backgroundColor: 'white'
                        }}
                      />
                      {showSkillTypeDropdown && (
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
                          {filteredSkillTypesForSearch.length > 0 ? (
                            filteredSkillTypesForSearch.map((skillType) => (
                              <div
                                key={skillType}
                                onClick={() => handleSkillTypeSelect(skillType)}
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
                                {skillType}
                              </div>
                            ))
                          ) : (
                            <div style={{
                              padding: '8px 12px',
                              color: '#6b7280',
                              fontSize: '14px',
                              fontStyle: 'italic'
                            }}>
                              No skill types found
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    {selectedSkillType && (
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
                        <span>Selected: {selectedSkillType}</span>
                        <button
                          onClick={() => {
                            setSelectedSkillType(null);
                            setSearchState(prev => ({
                              ...prev,
                              skillType: { enabled: false, value: '', type: 'is' }
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
                onClick={() => {
                  setSearchState({
                    designation: { enabled: false, value: '', type: 'is' },
                    skillType: { enabled: false, value: '', type: 'is' },
                  });
                  setDesignationSearchTerm('');
                  setSelectedDesignation(null);
                  setSkillTypeSearchTerm('');
                  setSelectedSkillType(null);
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

export default Designation;
