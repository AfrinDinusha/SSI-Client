import React, { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import './App.css';
import './shift.css';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import Button from './Button';
import HeaderBranding from './HeaderBranding';
import { getSidebarModulesForUser, resolveSidebarUserEmail } from './modulesConfig';
import { 
  Users, Calendar, FileText, AlertTriangle, FolderOpen, 
  ClipboardList, Building, Handshake, Landmark, Clock, 
  Map, BarChart3, User, TrendingUp, TrendingDown,
  Activity, Plus, CheckCircle, Bell, Settings, LayoutDashboard, Home as HomeIcon, AlertOctagon, CreditCard, Shield, FileSignature, Search, Clock3, CalendarDays, Database, Pencil, Trash2, ArrowRight, RefreshCw, X, Info, AlarmClock
} from 'lucide-react';

function Shift({ userRole: propUserRole, userEmail: propUserEmail }) {
  const userEmail = propUserEmail || localStorage.getItem('userEmail') || null;
  const userRole = propUserRole || localStorage.getItem('userRole') || 'App User';
  const navigate = useNavigate();
  const location = useLocation();
  
  // Sidebar state
  const [expandedMenus, setExpandedMenus] = useState({});
  const [showSidebarMenu, setShowSidebarMenu] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  
  const [shifts, setShifts] = useState([]);
  const [fetchState, setFetchState] = useState('init');
  const [fetchError, setFetchError] = useState('');
  const [form, setForm] = useState({ shiftName: '', from: '', to: '' });
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingShift, setEditingShift] = useState(null);
  const [success, setSuccess] = useState('');
  const [selectedShifts, setSelectedShifts] = useState(new Set());

  const modulesToShow = useMemo(
    () => getSidebarModulesForUser(resolveSidebarUserEmail(userEmail), userRole),
    [userEmail, userRole]
  );
  const userName = userRole === 'App Administrator' ? 'Admin User' : 'App User';
  const userRoleLabel = userRole === 'App Administrator' ? 'App Administrator' : 'App User';

  // Toggle expandable menus
  const toggleMenu = (index) => {
    setExpandedMenus(prev => ({
      ...prev,
      [index]: !prev[index]
    }));
  };

  // Sample activity data with Lucide icons (same as App.js)
  const recentActivities = [
    { icon: <User size={20} />, title: 'New Employee Added', description: 'John Doe joined the development team', time: '2 hours ago' },
    { icon: <BarChart3 size={20} />, title: 'Monthly Report Generated', description: 'Contractor performance report is ready', time: '4 hours ago' },
    { icon: <CheckCircle size={20} />, title: 'Contract Approved', description: 'ABC Construction contract approved', time: '6 hours ago' },
    { icon: <Bell size={20} />, title: 'System Update', description: 'Payroll Management System updated to version 2.1', time: '1 day ago' },
    { icon: <Plus size={20} />, title: 'New Application', description: 'Candidate applied for senior position', time: '2 days ago' }
  ];

  const fetchShifts = useCallback(() => {
    setFetchState('loading');
    setFetchError('');
    axios
      .get('/server/Shift_function/shifts')
      .then((res) => {
        if (res.data.status === 'success' && Array.isArray(res.data.data.shifts)) {
          setShifts(res.data.data.shifts || []);
          setFetchState('fetched');
        } else {
          throw new Error('Unexpected response format from server');
        }
      })
      .catch((err) => {
        setFetchError('Failed to fetch shifts. Please try again.');
        setFetchState('error');
        console.error('Fetch error:', err);
      });
  }, []);

  useEffect(() => {
    fetchShifts();
  }, [fetchShifts]);

  const validateForm = useCallback(() => {
    if (!form.shiftName.trim()) {
      setFormError('Shift Name is required.');
      return false;
    }
    if (!form.from.trim()) {
      setFormError('From time is required.');
      return false;
    }
    if (!form.to.trim()) {
      setFormError('To time is required.');
      return false;
    }
    setFormError('');
    return true;
  }, [form]);

  const saveShift = useCallback(
    (e) => {
      e.preventDefault();
      if (!validateForm()) return;
      setSubmitting(true);
      setFormError('');
      setSuccess('');

      const request = editingShift
        ? axios.put(`/server/Shift_function/shifts/${editingShift.id}`, {
            shiftName: form.shiftName.trim(),
            from: form.from.trim(),
            to: form.to.trim(),
          })
        : axios.post('/server/Shift_function/shifts', {
            shiftName: form.shiftName.trim(),
            from: form.from.trim(),
            to: form.to.trim(),
          });

      request
        .then((res) => {
          if (res.data.status === 'success') {
            const returnedShift = res.data.data.shift;
            if (editingShift) {
              setShifts(shifts.map((d) => (d.id === returnedShift.id ? returnedShift : d)));
            } else {
              setShifts([...shifts, returnedShift]);
            }
            setShowForm(false);
            setEditingShift(null);
            setForm({ shiftName: '', from: '', to: '' });
            setSuccess(editingShift ? 'Shift updated successfully!' : 'Shift added successfully!');
          } else {
            throw new Error(res.data.message || `Failed to ${editingShift ? 'update' : 'add'} shift.`);
          }
        })
        .catch((err) => {
          setFormError(
            err.response?.data?.message || `Failed to ${editingShift ? 'update' : 'add'} shift. Please try again.`
          );
          console.error('Save error:', err);
        })
        .finally(() => setSubmitting(false));
    },
    [form, validateForm, editingShift, shifts]
  );

  const handleEdit = (shift) => {
    setEditingShift(shift);
    setForm({ shiftName: shift.shiftName, from: shift.from, to: shift.to });
    setShowForm(true);
    setFormError('');
    setSuccess('');
  };

  const handleDelete = (shiftId) => {
    if (window.confirm('Are you sure you want to delete this shift?')) {
      axios
        .delete(`/server/Shift_function/shifts/${shiftId}`)
        .then((res) => {
          if (res.data.status === 'success') {
            fetchShifts();
          } else {
            throw new Error(res.data.message || 'Failed to delete shift.');
          }
        })
        .catch((err) => {
          setFetchError(err.response?.data?.message || 'Failed to delete shift. Please try again.');
          console.error('Delete error:', err);
        });
    }
  };

  const handleDeleteSelected = () => {
    if (window.confirm(`Are you sure you want to delete ${selectedShifts.size} selected shifts?`)) {
      const deletePromises = Array.from(selectedShifts).map((shiftId) =>
        axios.delete(`/server/Shift_function/shifts/${shiftId}`)
      );

      Promise.all(deletePromises)
        .then(() => {
          fetchShifts();
          setSelectedShifts(new Set());
        })
        .catch((err) => {
          setFetchError('Failed to delete one or more shifts. Please try again.');
          console.error('Bulk delete error:', err);
        });
    }
  };

  const handleDeleteAll = () => {
    if (window.confirm('Are you sure you want to delete all shifts?')) {
      axios
        .delete('/server/Shift_function/shifts')
        .then((res) => {
          if (res.data.status === 'success') {
            setSelectedShifts(new Set());
            fetchShifts();
            setSuccess('All shifts deleted successfully!');
          } else {
            throw new Error(res.data.message || 'Failed to delete all shifts.');
          }
        })
        .catch((err) => {
          setFetchError(err.response?.data?.message || 'Failed to delete all shifts. Please try again.');
          console.error('Delete all error:', err);
        });
    }
  };

  const toggleShiftSelection = (shiftId) => {
    const newSelection = new Set(selectedShifts);
    if (newSelection.has(shiftId)) {
      newSelection.delete(shiftId);
    } else {
      newSelection.add(shiftId);
    }
    setSelectedShifts(newSelection);
  };

  const resetForm = useCallback(() => {
    setForm({ shiftName: '', from: '', to: '' });
    setFormError('');
    setSuccess('');
    setEditingShift(null);
  }, []);

  const closeForm = () => {
    setShowForm(false);
    resetForm();
  };

  // If form is shown, render the form page
  if (showForm) {
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
                <h4>{userName}</h4>
                <p>{userRoleLabel}</p>
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
                  <img src="https://images.pexels.com/photos/2379004/pexels-photo-2379004.jpeg?auto=compress&cs=tinysrgb&w=150" alt="User" className="cms-user-avatar" />
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

            {/* Form Page Content */}
            <main className="cms-dashboard-content">
              <div className="shift-form-page">
                <div className="shift-form-container">
                  <div className="shift-form-header">
                    <h1 className="shift-form-title">
                      {editingShift ? <Pencil size={24} className="shift-form-title-icon" /> : <Plus size={24} className="shift-form-title-icon" />}
                      {editingShift ? 'Edit' : 'Add'} Shift
                    </h1>
                    <button type="button" className="shift-form-close" onClick={closeForm} aria-label="Close">
                      <X size={22} />
                    </button>
                  </div>
                  
                  <div className="shift-form-content">
                    {submitting && (
                      <div className="form-loader">
                        <div className="loading-spinner"></div>
                      </div>
                    )}
                    
                    <form onSubmit={saveShift} className="shift-add-form">
                      <div className="shift-form-section-card shift-info">
                        <h2 className="section-title">Shift Information</h2>
                        <div className="shift-form-grid shift-form-grid-single">
                          <div className="shift-form-group">
                            <label htmlFor="shiftName">
                              <FileText size={16} className="label-icon" />
                              SHIFT NAME <span className="required">**</span>
                            </label>
                            <input
                              id="shiftName"
                              name="shiftName"
                              type="text"
                              className="shift-input"
                              value={form.shiftName}
                              onChange={e => setForm({ ...form, shiftName: e.target.value })}
                              placeholder="Enter shift name..."
                              required
                            />
                          </div>
                        </div>
                      </div>

                      <div className="shift-form-section-card time-details">
                        <div className="section-title-row">
                          <h2 className="section-title">Time Details</h2>
                          <AlarmClock size={22} className="section-title-card-icon section-title-icon-time" aria-hidden />
                        </div>
                        <div className="shift-form-grid shift-form-grid-double">
                          <div className="shift-form-group">
                            <label htmlFor="from">
                              <Clock size={16} className="label-icon" />
                              FROM <span className="required">**</span>
                            </label>
                            <div className="shift-input-wrap">
                              <input
                                id="from"
                                name="from"
                                type="time"
                                className="shift-input"
                                value={form.from}
                                onChange={e => setForm({ ...form, from: e.target.value })}
                                required
                              />
                              <Clock size={18} className="shift-input-icon" aria-hidden />
                            </div>
                          </div>
                          <div className="shift-form-group">
                            <label htmlFor="to">
                              <Clock size={16} className="label-icon" />
                              TO <span className="required">**</span>
                            </label>
                            <div className="shift-input-wrap">
                              <input
                                id="to"
                                name="to"
                                type="time"
                                className="shift-input"
                                value={form.to}
                                onChange={e => setForm({ ...form, to: e.target.value })}
                                required
                              />
                              <Clock size={18} className="shift-input-icon" aria-hidden />
                            </div>
                          </div>
                        </div>
                      </div>

                      {formError && (
                        <div className="alert alert-error">
                          <span className="alert-icon">⚠️</span>
                          {formError}
                        </div>
                      )}

                      <div className="shift-form-actions">
                        <button type="button" className="btn-danger" onClick={resetForm}>
                          <RefreshCw size={18} className="btn-icon-svg" />
                          Reset
                        </button>
                        <button type="submit" className="btn-primary" disabled={submitting}>
                          <Plus size={18} className="btn-icon-svg" />
                          {editingShift ? 'Update' : 'Add'} Shift
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
              </div>
            </main>
          </div>
        </div>
      </>
    );
  }

  // Main shift list view
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
              <h1>Payroll Management System</h1>
            </div>
            <div className="cms-header-right">
              <HeaderBranding />
              <div className="cms-header-user">
                <div className="cms-notification-icon" onClick={() => setShowNotifications(!showNotifications)}>
                  <Bell size={24} />
                </div>
                <img src="https://images.pexels.com/photos/2379004/pexels-photo-2379004.jpeg?auto=compress&cs=tinysrgb&w=150" alt="User" className="cms-user-avatar" />
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
            <div className="shift-container">
              {/* Simple header with Add Shift (+) button on the right */}
              <div className="shift-simple-header" style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', width: '100%' }}>
              <div className="header-actions" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <button 
                  className="toolbar-btn add-btn" 
                  onClick={() => { setShowForm(true); resetForm(); }}
                  style={{
                    background: '#fff',
                    color: '#232323',
                    border: '2px solid #e0e0e0',
                    fontWeight: 700,
                    padding: '12px',
                    borderRadius: '8px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '48px',
                    height: '48px',
                    boxShadow: '0 2px 8px rgba(60,72,88,0.10)',
                    cursor: 'pointer',
                    transition: 'all 0.3s ease'
                  }}
                  title="Add New Shift"
                >
                  <Plus size={24} style={{ color: '#232323' }} />
                </button>
                {shifts.length > 0 && (
                  <button 
                    className="btn-delete-selected" 
                    onClick={handleDeleteAll}
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
                      boxShadow: '0 2px 8px rgba(60,72,88,0.10)',
                    }}
                    title="Delete All Shifts"
                  >
                    <Trash2 size={18} />
                  </button>
                )}
                {selectedShifts.size > 0 && (
                  <button 
                    className="btn-delete-selected" 
                    onClick={handleDeleteSelected}
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
                      boxShadow: '0 2px 8px rgba(60,72,88,0.10)',
                    }}
                  >
                    <i className="fas fa-trash" style={{ color: '#d32f2f', fontSize: '1.2rem' }}></i>
                  </button>
                )}
              </div>
              </div>

              {fetchError && (
                <div className="alert alert-error">
                  <span className="alert-icon">⚠️</span>
                  {fetchError}
                </div>
              )}
              {success && (
                <div className="alert alert-success">
                  <span className="alert-icon">✅</span>
                  {success}
                </div>
              )}

              <div className="shifts-grid">
                {fetchState === 'loading' ? (
                  <div className="loading-container">
                    <div className="loading-spinner"></div>
                    <p className="loading-text">Loading shifts...</p>
                  </div>
                ) : fetchState === 'error' ? (
                  <div className="error-container">
                    <div className="error-icon">❌</div>
                    <p className="error-text">{fetchError}</p>
                  </div>
                ) : (
                  <>
                    {shifts.length > 0 ? (
                      shifts.map((shift, idx) => (
                        <div key={shift.id || idx} className="shift-card">
                          <div className="card-header">
                            <div className="card-checkbox">
                              <input
                                type="checkbox"
                                id={`shift-${shift.id}`}
                                checked={selectedShifts.has(shift.id)}
                                onChange={() => toggleShiftSelection(shift.id)}
                                className="custom-checkbox"
                              />
                              <label htmlFor={`shift-${shift.id}`} className="checkbox-label"></label>
                            </div>
                          <div className="card-actions">
                            <button type="button" className="btn-edit" onClick={() => handleEdit(shift)} title="Edit Shift">
                              <Pencil size={18} />
                            </button>
                            {!selectedShifts.has(shift.id) && (
                              <button type="button" className="btn-delete" onClick={() => handleDelete(shift.id)} title="Delete Shift">
                                <Trash2 size={18} />
                              </button>
                            )}
                          </div>
                          </div>
                          <div className="card-content">
                            <div className="shift-name">
                              <span className="shift-icon"><Clock size={20} /></span>
                              <h3>{shift.shiftName || 'Unnamed Shift'}</h3>
                            </div>
                            <div className="shift-time">
                              <div className="time-block">
                                <span className="time-label">FROM</span>
                                <span className="time-value">{shift.from || '--:--'}</span>
                              </div>
                              <span className="time-arrow"><ArrowRight size={18} /></span>
                              <div className="time-block">
                                <span className="time-label">TO</span>
                                <span className="time-value">{shift.to || '--:--'}</span>
                              </div>
                            </div>
                            <div className="shift-id">
                              <span className="id-label">ID:</span>
                              <span className="id-value">{shift.id || 'N/A'}</span>
                            </div>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="empty-state">
                        <div className="empty-icon">📋</div>
                        <h3>No shifts found</h3>
                        <p>Create your first shift to get started</p>
                        <button className="btn-create-first" onClick={() => { setShowForm(true); resetForm(); }}>
                          Create First Shift
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </main>
        </div>
      </div>
    </>
  );
}

export default Shift;
