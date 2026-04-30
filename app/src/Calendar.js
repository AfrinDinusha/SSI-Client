import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import './App.css';
import './helper.css';
import './employeeManagement.css';
import './Calendar.css';
import HeaderBranding from './HeaderBranding';
import Button from './Button';
import { getSidebarModulesForUser, resolveSidebarUserEmail } from './modulesConfig';
import {
  LayoutDashboard, Home as HomeIcon, Landmark, Handshake, Users, Clock3, FileText, AlertTriangle,
  FolderOpen, Building, Shield, ClipboardList, BarChart3, CreditCard, Clock, Map, CalendarDays,
  Plus, ChevronLeft, ChevronRight, Trash2, Bell, Calendar as CalendarIcon
} from 'lucide-react';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAY_LABELS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

function formatDateDisplay(dateStr) {
  if (!dateStr) return '';
  const s = String(dateStr).trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split('-');
    return `${d}-${m}-${y}`;
  }
  if (/^\d{2}-\d{2}-\d{4}$/.test(s)) return s;
  return s;
}

function toYYYYMMDD(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const API_BASE = '/server/calendar_function/calendar';

function Calendar({ userRole = 'App Administrator', userEmail = null }) {
  const [holidays, setHolidays] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [viewDate, setViewDate] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addFestival, setAddFestival] = useState('');
  const [addDate, setAddDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [expandedMenus, setExpandedMenus] = useState({});
  const [showNotifications, setShowNotifications] = useState(false);
  const userAvatar = 'https://images.pexels.com/photos/2379004/pexels-photo-2379004.jpeg?auto=compress&cs=tinysrgb&w=150';
  const userName = userRole === 'App Administrator' ? 'Admin User' : 'App User';

  const fetchHolidays = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}?_t=${Date.now()}`);
      const text = await res.text();
      let json;
      try {
        json = text ? JSON.parse(text) : {};
      } catch (parseErr) {
        setError('Server returned an invalid response. Please try again.');
        setHolidays([]);
        return;
      }
      if (!res.ok) throw new Error(json.message || 'Failed to fetch holidays');
      const list = (json.data && json.data.holidays) ? json.data.holidays : [];
      setHolidays(Array.isArray(list) ? list : []);
    } catch (err) {
      setError(err.message || 'Failed to load holidays');
      setHolidays([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHolidays();
  }, [fetchHolidays]);

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const monthName = MONTHS[month];

  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startOffset = firstDay.getDay();
  const daysInMonth = lastDay.getDate();

  const calendarDays = [];
  for (let i = 0; i < startOffset; i++) calendarDays.push(null);
  for (let d = 1; d <= daysInMonth; d++) calendarDays.push(new Date(year, month, d));
  const totalCells = 42;
  while (calendarDays.length < totalCells) calendarDays.push(null);

  const isSelected = (d) => {
    if (!selectedDate || !d) return false;
    return d.getFullYear() === selectedDate.getFullYear() &&
           d.getMonth() === selectedDate.getMonth() &&
           d.getDate() === selectedDate.getDate();
  };

  const isToday = (d) => {
    if (!d) return false;
    const t = new Date();
    return d.getFullYear() === t.getFullYear() && d.getMonth() === t.getMonth() && d.getDate() === t.getDate();
  };

  const isHoliday = (d) => {
    if (!d) return false;
    const key = toYYYYMMDD(d);
    return holidays.some(h => (h.date || '').slice(0, 10) === key);
  };

  const goPrevMonth = () => setViewDate(new Date(year, month - 1, 1));
  const goNextMonth = () => setViewDate(new Date(year, month + 1, 1));

  const goToday = () => {
    const t = new Date();
    setViewDate(new Date(t.getFullYear(), t.getMonth(), 1));
    setSelectedDate(t);
  };

  const openAddModal = () => {
    setAddDate('');
    setAddFestival('');
    setShowAddModal(true);
  };

  const handleAddHoliday = async (e) => {
    e.preventDefault();
    const name = (addFestival || '').trim();
    if (!name) return;
    const dateStr = (addDate || '').trim().slice(0, 10);
    if (!dateStr) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(API_BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ festival: name, date: dateStr }),
      });
      const text = await res.text();
      let json = {};
      try { json = text ? JSON.parse(text) : {}; } catch (_) {}
      if (!res.ok) throw new Error(json.message || 'Failed to add holiday');
      await fetchHolidays();
      setShowAddModal(false);
      setAddFestival('');
      setAddDate('');
    } catch (err) {
      setError(err.message || 'Failed to add holiday');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!id) return;
    setDeletingId(id);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/${id}`, { method: 'DELETE' });
      const text = await res.text();
      let json = {};
      try { json = text ? JSON.parse(text) : {}; } catch (_) {}
      if (!res.ok) throw new Error(json.message || 'Failed to delete holiday');
      await fetchHolidays();
    } catch (err) {
      setError(err.message || 'Failed to delete holiday');
    } finally {
      setDeletingId(null);
    }
  };

  const toggleMenu = (idx) => {
    setExpandedMenus(prev => ({ ...prev, [idx]: !prev[idx] }));
  };

  const modulesToShow = useMemo(
    () => getSidebarModulesForUser(resolveSidebarUserEmail(userEmail), userRole),
    [userEmail, userRole]
  );

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
          <div className="cms-sidebar-header">
            <div className="cms-header-content">
              <div className="cms-logo-section">
              </div>
            </div>
          </div>

          <div className="cms-nav">
            {modulesToShow.map((item, idx) =>
              item.children ? (
                <div key={item.label} className={`cms-nav-expandable ${expandedMenus[idx] ? 'expanded' : ''}`}>
                  <div className="cms-nav-item" onClick={() => toggleMenu(idx)}>
                    <span className="cms-nav-icon">{item.icon}</span>
                    <span className="cms-nav-label">{item.label}</span>
                    <span className="cms-expand-icon"><Plus size={16} className={`expand-icon ${expandedMenus[idx] ? 'rotated' : ''}`} /></span>
                  </div>
                  <div className="cms-nav-children">
                    {item.children.map(child => (
                      <Link to={child.path} key={child.label} className={`cms-nav-child ${['/loh-report', '/onduty', '/grace', '/compoff', '/calendar'].includes(child.path) ? 'clock-color-icon' : ''}`}>
                        <span className="cms-nav-icon">{child.icon}</span>
                        <span className="cms-nav-label">{child.label}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              ) : (
                <Link to={item.path} className={`cms-nav-item ${['/loh-report', '/onduty', '/grace', '/compoff', '/calendar'].includes(item.path) ? 'clock-color-icon' : ''}`} data-nav-path={item.path} key={item.label}>
                  <span className="cms-nav-icon">{item.icon}</span>
                  <span className="cms-nav-label">{item.label}</span>
                </Link>
              )
            )}
          </div>

          <div className="cms-user-info">
            <img src={userAvatar} alt="User" className="cms-user-avatar" />
            <div className="cms-user-details">
              <h4>{userName}</h4>
              <p>{userRole || 'User'}</p>
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
                <img src={userAvatar} alt="User" className="cms-user-avatar" />
                <div className="cms-logout-icon">
                  <Button title="" className="cms-logout-btn" />
                </div>
              </div>
            </div>
          </header>

          <main className="cms-dashboard-content">
            <div className="calendar-page-wrapper">
              <div className="calendar-page-header">
                <CalendarIcon size={28} className="calendar-page-header-icon" />
                <div className="calendar-page-header-text">
                  <h1 className="calendar-page-title">Calendar</h1>
                  <p className="calendar-page-subtitle">Select a date from the calendar</p>
                </div>
              </div>

              {error && (
                <div className="calendar-error-banner">
                  {error}
                </div>
              )}

              <div className="calendar-layout">
            {/* Left: Calendar card */}
            <div className="calendar-card">
              <div className="calendar-header">
                <button type="button" className="calendar-nav-btn" onClick={goPrevMonth} aria-label="Previous month">
                  <ChevronLeft size={24} />
                </button>
                <div className="calendar-header-title">
                  <span className="calendar-month">{monthName}</span>
                  <span className="calendar-year">{year}</span>
                </div>
                <button type="button" className="calendar-nav-btn" onClick={goNextMonth} aria-label="Next month">
                  <ChevronRight size={24} />
                </button>
              </div>

              <div className="calendar-dow">
                {DAY_LABELS.map(label => (
                  <span key={label} className="calendar-dow-cell">{label}</span>
                ))}
              </div>

              <div className="calendar-grid">
                {calendarDays.map((d, i) => (
                  <div key={i} className="calendar-cell-wrapper">
                    {d ? (
                      <button
                        type="button"
                        className={`calendar-cell ${isSelected(d) ? 'selected' : ''} ${isToday(d) ? 'today' : ''} ${isHoliday(d) ? 'is-holiday' : ''}`}
                        onClick={() => setSelectedDate(d)}
                      >
                        <span className="calendar-cell-num">{d.getDate()}</span>
                        {isHoliday(d) && <span className="calendar-cell-dot" aria-hidden />}
                      </button>
                    ) : (
                      <span className="calendar-cell empty" />
                    )}
                  </div>
                ))}
              </div>

              <div className="calendar-today-wrap">
                <button type="button" className="calendar-today-btn" onClick={goToday}>
                  Today
                </button>
              </div>
            </div>

            {/* Right: Added Holidays */}
            <div className="holidays-panel">
              <button type="button" className="holidays-add-btn" onClick={openAddModal}>
                <Plus size={20} />
                <span>+ Add Holiday</span>
              </button>

              <div className="holidays-list-card">
                <h3 className="holidays-list-title">Added Holidays</h3>
                <div className="holidays-list-scroll">
                  {loading ? (
                    <div className="holidays-loading">Loading...</div>
                  ) : holidays.length === 0 ? (
                    <div className="holidays-empty">No holidays added yet.</div>
                  ) : (
                    <ul className="holidays-list">
                      {holidays.map(h => (
                        <li key={h.id} className="holiday-item">
                          <div className="holiday-item-content">
                            <span className="holiday-name">{h.festival || 'Unnamed'}</span>
                            <span className="holiday-date">{formatDateDisplay(h.date)}</span>
                          </div>
                          <button
                            type="button"
                            className="holiday-delete-btn"
                            onClick={() => handleDelete(h.id)}
                            disabled={deletingId === h.id}
                            aria-label="Delete"
                          >
                            <Trash2 size={18} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
              </div>
            </div>
          </main>
        </div>
      </div>

      {/* Add Holiday Modal */}
      {showAddModal && (
        <div className="calendar-modal-overlay" onClick={() => !saving && setShowAddModal(false)}>
          <div className="calendar-modal" onClick={e => e.stopPropagation()}>
            <h3 className="calendar-modal-title">Add New Holiday</h3>
            <form onSubmit={handleAddHoliday} className="calendar-modal-form">
              <div className="calendar-form-group">
                <label>Festival <span className="calendar-required">**</span></label>
                <input
                  type="text"
                  value={addFestival}
                  onChange={e => setAddFestival(e.target.value)}
                  placeholder="Enter festival name"
                  required
                  autoFocus
                  aria-label="Festival"
                />
              </div>
              <div className="calendar-form-group">
                <label>Date <span className="calendar-required">**</span></label>
                <div className="calendar-date-input-wrap">
                  <input
                    type="date"
                    id="calendar-add-date"
                    value={addDate}
                    onChange={e => setAddDate(e.target.value)}
                    required
                    aria-label="CalendarDate"
                  />
                </div>
              </div>
              <div className="calendar-modal-actions">
                <button type="button" className="calendar-modal-cancel" onClick={() => !saving && setShowAddModal(false)} disabled={saving}>
                  Cancel
                </button>
                <button type="submit" className="calendar-modal-submit" disabled={saving}>
                  {saving ? 'Saving...' : 'Add Holiday'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

export default Calendar;
