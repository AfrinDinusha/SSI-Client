import './App.css';
import './helper.css';
import './regularization.css';
import './employeeManagement.css';
import axios from 'axios';
import { useCallback, useEffect, useState, useRef, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { Link, useLocation } from 'react-router-dom';
import HeaderBranding from './HeaderBranding';
import Button from './Button';
import { getSidebarModulesForUser, resolveSidebarUserEmail } from './modulesConfig';
import {
  Users, Calendar, FileText, AlertTriangle, FolderOpen,
  ClipboardList, Building, Handshake, Landmark, Clock,
  Map, BarChart3, User, TrendingUp, TrendingDown,
  Activity, Plus, CheckCircle, Bell, Settings, LayoutDashboard, Home as HomeIcon,
  Shield, AlertOctagon, CreditCard, FileSignature, Search, Clock3, CalendarDays, Database,
  FileInput, FileOutput, RefreshCw, Trash2, X
} from 'lucide-react';

function formatDate(dateStr) {
  if (!dateStr) return '-';
  return String(dateStr).slice(0, 10);
}

function formatDateTime(dateStr) {
  if (!dateStr) return '-';
  const s = String(dateStr).trim();
  if (s.length >= 19) return s.slice(0, 19).replace('T', ' ');
  if (s.length >= 10) return s.slice(0, 10);
  return s || '-';
}

/** Normalize stored time strings to HH:MM for <input type="time" />. */
function normalizeTimeForInput(value) {
  if (value == null || value === '') return '';
  const t = String(value).trim();
  if (!t) return '';
  const withSpace = t.includes(' ') ? t.split(/\s+/).pop() : t;
  const m = withSpace.match(/^(\d{1,2}):(\d{2})(?::\d{2})?/);
  if (!m) return '';
  const h = m[1].padStart(2, '0');
  const min = m[2].padStart(2, '0');
  return `${h}:${min}`;
}

function openNativeTimePicker(inputRef) {
  const el = inputRef.current;
  if (!el) return;
  if (typeof el.showPicker === 'function') {
    try {
      el.showPicker();
      return;
    } catch (_) {
      /* not allowed or unsupported */
    }
  }
  el.focus();
}

// Regularization Row Component
function RegularizationRow({ record, index, removeRegularization, editRegularization, isSelected, onSelect, selectedRegularizations }) {
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const deleteRecord = useCallback((e) => {
    e.stopPropagation();
    setDeleting(true);
    setDeleteError('');
    axios
      .delete(`/server/regularization_function/regularization/${record.id}`, { timeout: 5000 })
      .then(() => {
        removeRegularization(record.id);
      })
      .catch((err) => {
        const errorMessage = err.response?.data?.message || `Failed to delete record (ID: ${record.id}).`;
        setDeleteError(errorMessage);
        console.error('Delete regularization error:', err);
      })
      .finally(() => setDeleting(false));
  }, [record.id, removeRegularization]);

  const handleRowClick = useCallback(() => {
    editRegularization(record);
  }, [editRegularization, record]);

  const handleCheckboxClick = useCallback((e) => {
    e.stopPropagation();
    onSelect(record.id);
  }, [onSelect, record.id]);

  const handleEditButtonClick = useCallback((e) => {
    e.stopPropagation();
    editRegularization(record);
  }, [editRegularization, record]);

  return (
    <tr
      className="clickable-row"
      onClick={handleRowClick}
      style={{ cursor: 'pointer', transition: 'background-color 0.2s ease' }}
      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#f8f9fa'; }}
      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = ''; }}
    >
      <td onClick={handleCheckboxClick}>
        <input type="checkbox" checked={isSelected} onChange={handleCheckboxClick} />
      </td>
      {selectedRegularizations.length > 0 && (
        <td onClick={handleEditButtonClick}>
          {isSelected && (
            <button className="btn btn-icon" onClick={handleEditButtonClick} title="Edit" disabled={deleting}>
              <i className="fas fa-edit"></i>
            </button>
          )}
        </td>
      )}
      <td className="regularization-col-index">{index + 1}</td>
      <td>{record.employeeCode || '-'}</td>
      <td>{record.employeeName || '-'}</td>
      <td>{record.logDate ? formatDate(record.logDate) : '-'}</td>
      <td>{record.firstIn || '-'}</td>
      <td>{record.lastOut || '-'}</td>
      <td>{formatDateTime(record.createdTime)}</td>
      <td>{formatDateTime(record.modifiedTime)}</td>
      <td onClick={(e) => e.stopPropagation()}>
        <button
          className="btn btn-icon btn-delete"
          onClick={deleteRecord}
          title="Delete"
          disabled={deleting}
        >
          {deleting ? '...' : <i className="fas fa-trash"></i>}
        </button>
        {deleteError && <span className="text-danger" style={{ fontSize: '12px', marginLeft: '4px' }}>{deleteError}</span>}
      </td>
    </tr>
  );
}

const Regularization = ({ userRole, userEmail }) => {
  const location = useLocation();
  const [regularizations, setRegularizations] = useState([]);
  const [filteredRegularizations, setFilteredRegularizations] = useState([]);
  const [fetchState, setFetchState] = useState('loading');
  const [fetchError, setFetchError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({
    employeeCode: '',
    employeeName: '',
    logDate: '',
    firstIn: '',
    lastOut: '',
  });
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [selectedRegularizations, setSelectedRegularizations] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [deletingMultiple, setDeletingMultiple] = useState(false);
  const [massDeleteError, setMassDeleteError] = useState('');
  const fileInputRef = useRef(null);
  const [employeeLookupList, setEmployeeLookupList] = useState([]);
  const [employeeLookupLoading, setEmployeeLookupLoading] = useState(false);
  const employeeCodeLookupTimerRef = useRef(null);
  const firstInTimeInputRef = useRef(null);
  const lastOutTimeInputRef = useRef(null);

  const [expandedMenus, setExpandedMenus] = useState({});
  const [showNotifications, setShowNotifications] = useState(false);
  const [showSidebarMenu, setShowSidebarMenu] = useState(false);
  const userAvatar = "https://images.pexels.com/photos/2379004/pexels-photo-2379004.jpeg?auto=compress&cs=tinysrgb&w=150";
  const userName = 'Admin User';

  const allSelected = selectedRegularizations.length > 0 && selectedRegularizations.length === filteredRegularizations.length;
  const someSelected = selectedRegularizations.length > 0 && selectedRegularizations.length < filteredRegularizations.length;
  const tableColSpan = selectedRegularizations.length > 0 ? 11 : 10;
  const tableHasEditColumn = selectedRegularizations.length > 0;

  const fetchRegularizations = useCallback(() => {
    setFetchState('loading');
    setFetchError('');
    axios
      .get('/server/regularization_function/regularization', { timeout: 30000 })
      .then((response) => {
        if (!response?.data?.data?.regularization) {
          throw new Error('Unexpected API response structure');
        }
        let records = response.data.data.regularization || [];
        if (!Array.isArray(records)) {
          throw new Error('Regularization data is not an array');
        }
        setRegularizations(records);
        setFilteredRegularizations(records);

        const codesNeedingName = [...new Set(
          records
            .filter((r) => (r.employeeCode || '').toString().trim() && !(r.employeeName || '').toString().trim())
            .map((r) => (r.employeeCode || '').toString().trim())
        )];
        if (codesNeedingName.length > 0) {
          const params = { returnAll: true };
          if (userRole && userEmail) {
            params.userRole = userRole;
            params.userEmail = userEmail;
          }
          axios
            .get('/server/cms_function/employees', { params, timeout: 15000 })
            .then((empRes) => {
              const employees = empRes?.data?.data?.employees || [];
              const codeToName = {};
              employees.forEach((emp) => {
                const code = (emp.employeeCode || '').toString().trim();
                if (code) codeToName[code] = (emp.employeeName || '').toString().trim();
              });
              const enriched = records.map((r) => {
                const code = (r.employeeCode || '').toString().trim();
                const name = (r.employeeName || '').toString().trim();
                if (code && !name && codeToName[code]) {
                  return { ...r, employeeName: codeToName[code] };
                }
                return r;
              });
              setRegularizations(enriched);
              setFilteredRegularizations(enriched);
            })
            .catch(() => {});
        }

        setFetchState('fetched');
      })
      .catch((err) => {
        const errorMessage = err.response?.data?.message || 'Failed to fetch regularization records. Please try again later.';
        setFetchError(errorMessage);
        setFetchState('error');
        console.error('Fetch regularization error:', err);
      });
  }, [userRole, userEmail]);

  useEffect(() => {
    fetchRegularizations();
  }, [fetchRegularizations]);

  useEffect(() => {
    if (!searchTerm.trim()) {
      setFilteredRegularizations(regularizations);
      return;
    }
    const term = searchTerm.toLowerCase();
    const filtered = regularizations.filter(
      (r) =>
        (r.employeeCode && r.employeeCode.toLowerCase().includes(term)) ||
        (r.employeeName && r.employeeName.toLowerCase().includes(term)) ||
        (r.logDate && String(r.logDate).toLowerCase().includes(term)) ||
        (r.firstIn && String(r.firstIn).toLowerCase().includes(term)) ||
        (r.lastOut && String(r.lastOut).toLowerCase().includes(term))
    );
    setFilteredRegularizations(filtered);
  }, [searchTerm, regularizations]);

  const fetchEmployeesForLookup = useCallback(() => {
    setEmployeeLookupLoading(true);
    const params = { returnAll: true };
    if (userRole && userEmail) {
      params.userRole = userRole;
      params.userEmail = userEmail;
    }
    axios
      .get('/server/cms_function/employees', { params, timeout: 15000 })
      .then((response) => {
        const list = response?.data?.data?.employees;
        setEmployeeLookupList(Array.isArray(list) ? list : []);
      })
      .catch((err) => {
        console.error('Regularization: fetch employees for lookup failed', err);
        setEmployeeLookupList([]);
      })
      .finally(() => setEmployeeLookupLoading(false));
  }, [userRole, userEmail]);

  useEffect(() => {
    if (showForm && employeeLookupList.length === 0 && !employeeLookupLoading) {
      fetchEmployeesForLookup();
    }
  }, [showForm, fetchEmployeesForLookup, employeeLookupList.length, employeeLookupLoading]);

  const lookupEmployeeNameByCode = useCallback((code) => {
    const trimmed = (code || '').toString().trim();
    if (!trimmed || employeeLookupList.length === 0) return null;
    const normalized = trimmed.toLowerCase();
    const found = employeeLookupList.find(
      (emp) => (String(emp.employeeCode || '').trim().toLowerCase() === normalized)
    );
    return found ? (found.employeeName || '') : null;
  }, [employeeLookupList]);

  const applyEmployeeCodeLookup = useCallback(() => {
    setForm((prev) => {
      const name = lookupEmployeeNameByCode(prev.employeeCode);
      if (name !== null) return { ...prev, employeeName: name };
      return prev;
    });
  }, [lookupEmployeeNameByCode]);

  const validateForm = useCallback(() => {
    if (!form.employeeCode.trim()) {
      setFormError('Employee Code is required.');
      return false;
    }
    if (!form.logDate.trim()) {
      setFormError('Log Date is required.');
      return false;
    }
    setFormError('');
    return true;
  }, [form]);

  const saveRegularization = useCallback(
    async (e) => {
      e.preventDefault();
      if (!validateForm()) return;
      setSubmitting(true);
      const payload = {
        employeeCode: form.employeeCode.trim(),
        employeeName: form.employeeName.trim() || null,
        logDate: form.logDate.trim(),
        firstIn: form.firstIn.trim() || null,
        lastOut: form.lastOut.trim() || null,
      };

      const request = isEditing
        ? axios.put(`/server/regularization_function/regularization/${editingId}`, payload, { timeout: 5000 })
        : axios.post('/server/regularization_function/regularization', payload, { timeout: 5000 });

      request
        .then((response) => {
          if (!response?.data?.data?.regularization) {
            throw new Error('Unexpected API response structure');
          }
          const updated = response.data.data.regularization;
          const wasMerged = response.data.data.merged === true;
          const updateInList = (prev) => prev.map((r) => (r.id === updated.id ? updated : r));
          const addOrUpdate = (prev) => (prev.some((r) => r.id === updated.id) ? updateInList(prev) : [updated, ...prev]);
          if (isEditing) {
            setRegularizations(updateInList);
            setFilteredRegularizations(updateInList);
          } else if (wasMerged) {
            setRegularizations(addOrUpdate);
            setFilteredRegularizations(addOrUpdate);
          } else {
            setRegularizations((prev) => [updated, ...prev]);
            setFilteredRegularizations((prev) => [updated, ...prev]);
          }
          setForm({ employeeCode: '', employeeName: '', logDate: '', firstIn: '', lastOut: '' });
          setShowForm(false);
          setIsEditing(false);
          setEditingId(null);
        })
        .catch((err) => {
          const serverError = err.response?.data?.message || (isEditing ? 'Failed to update record.' : 'Failed to add record.');
          setFormError(serverError);
        })
        .finally(() => setSubmitting(false));
    },
    [form, isEditing, editingId, validateForm]
  );

  const removeRegularization = useCallback((id) => {
    setRegularizations((prev) => prev.filter((r) => r.id !== id));
    setFilteredRegularizations((prev) => prev.filter((r) => r.id !== id));
    setSelectedRegularizations((prev) => prev.filter((rid) => rid !== id));
  }, []);

  const editRegularization = useCallback((record) => {
    setForm({
      employeeCode: record.employeeCode || '',
      employeeName: record.employeeName || '',
      logDate: record.logDate ? formatDate(record.logDate) : '',
      firstIn: normalizeTimeForInput(record.firstIn),
      lastOut: normalizeTimeForInput(record.lastOut),
    });
    setIsEditing(true);
    setEditingId(record.id);
    setShowForm(true);
  }, []);

  const toggleForm = useCallback(() => {
    setShowForm((prev) => !prev);
    setFormError('');
    setForm({ employeeCode: '', employeeName: '', logDate: '', firstIn: '', lastOut: '' });
    setIsEditing(false);
    setEditingId(null);
  }, []);

  const handleSelectRegularization = useCallback((id) => {
    setSelectedRegularizations((prev) =>
      prev.includes(id) ? prev.filter((rid) => rid !== id) : [...prev, id]
    );
  }, []);

  const handleSelectAll = useCallback(() => {
    if (allSelected) {
      setSelectedRegularizations([]);
    } else {
      setSelectedRegularizations(filteredRegularizations.map((r) => r.id));
    }
  }, [allSelected, filteredRegularizations]);

  const handleMassDelete = useCallback(() => {
    if (selectedRegularizations.length === 0) {
      setMassDeleteError('Please select at least one record to delete.');
      return;
    }
    if (!window.confirm(`Are you sure you want to delete ${selectedRegularizations.length} record(s)?`)) {
      return;
    }
    setDeletingMultiple(true);
    setMassDeleteError('');
    axios
      .delete('/server/regularization_function/regularization/bulk', {
        data: { ids: selectedRegularizations },
        timeout: 15000,
      })
      .then(() => {
        fetchRegularizations();
        setSelectedRegularizations([]);
      })
      .catch((err) => {
        setMassDeleteError(err.response?.data?.message || 'Failed to delete selected records.');
      })
      .finally(() => setDeletingMultiple(false));
  }, [selectedRegularizations, fetchRegularizations]);

  const validateImportedRecord = useCallback((record, rowIndex) => {
    if (!record.employeeCode) return `Row ${rowIndex}: Employee Code is required.`;
    if (!record.logDate) return `Row ${rowIndex}: Log Date is required.`;
    return null;
  }, []);

  const handleImport = useCallback(
    (event) => {
      const file = event.target.files[0];
      if (!file) {
        setImportError('No file selected.');
        return;
      }
      const validTypes = ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'];
      if (!validTypes.includes(file.type)) {
        setImportError('Invalid file type. Please upload an Excel file (.xlsx or .xls).');
        return;
      }
      setImporting(true);
      setImportError('');
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const data = new Uint8Array(e.target.result);
          const workbook = XLSX.read(data, { type: 'array', raw: true, defval: '' });
          const sheetName = workbook.SheetNames[0];
          if (!sheetName) throw new Error('No sheets found in the Excel file.');
          const worksheet = workbook.Sheets[sheetName];
          const jsonData = XLSX.utils.sheet_to_json(worksheet, { raw: true, defval: '' });
          if (!jsonData || jsonData.length === 0) throw new Error('No data found in the Excel file.');

          const toYYYYMMDD = (val) => {
            if (!val) return '';
            const s = String(val).trim();
            if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
            const dmy = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})$/);
            if (dmy) {
              const [, d, m, y] = dmy;
              return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
            }
            const num = Number(val);
            if (!isNaN(num) && num > 0 && num < 1000000) {
              const date = new Date((num - 25569) * 86400000);
              return date.toISOString().slice(0, 10);
            }
            return s;
          };

          const records = jsonData.map((row, i) => {
            const logDate = toYYYYMMDD(row['Log Date'] ?? row['logDate'] ?? row['LogDate']);
            const rec = {
              employeeCode: String(row['Employee Code'] ?? row['employeeCode'] ?? '').trim(),
              employeeName: String(row['Employee Name'] ?? row['employeeName'] ?? '').trim() || null,
              logDate,
              firstIn: row['First In'] ?? row['firstIn'] ?? row['FirstIn'] ?? null,
              lastOut: row['Last Out'] ?? row['lastOut'] ?? row['LastOut'] ?? null,
            };
            if (rec.firstIn != null) rec.firstIn = String(rec.firstIn).trim() || null;
            if (rec.lastOut != null) rec.lastOut = String(rec.lastOut).trim() || null;
            const err = validateImportedRecord(rec, i + 2);
            if (err) throw new Error(err);
            return rec;
          });

          const allCodes = [...new Set(records.map((r) => (r.employeeCode || '').toString().trim()).filter(Boolean))];
          if (allCodes.length > 0) {
            try {
              const params = { returnAll: true };
              if (userRole && userEmail) {
                params.userRole = userRole;
                params.userEmail = userEmail;
              }
              const empRes = await axios.get('/server/cms_function/employees', { params, timeout: 15000 });
              const employees = empRes?.data?.data?.employees || [];
              const codeToName = {};
              employees.forEach((emp) => {
                const code = (emp.employeeCode || '').toString().trim();
                if (code) codeToName[code] = (emp.employeeName || '').toString().trim();
              });
              records.forEach((r) => {
                const code = (r.employeeCode || '').toString().trim();
                if (code && codeToName[code]) r.employeeName = codeToName[code];
              });
            } catch (err) {
              console.warn('Could not fetch employee names during regularization import:', err);
            }
          }

          axios
            .post('/server/regularization_function/regularization/bulk', { records }, { timeout: 120000 })
            .then((res) => {
              const status = res.data?.status;
              const results = res.data?.results;
              if (status === 'success' || status === 'partial' || (results && results.successful > 0)) {
                fetchRegularizations();
                const msg = results
                  ? `Imported ${results.successful} record(s).` + (results.merged ? ` ${results.merged} merged with existing.` : '') + (results.failed ? ` ${results.failed} failed.` : '')
                  : 'Import completed.';
                setImportError(msg);
                setTimeout(() => setImportError(''), 4000);
              } else {
                setImportError(res.data?.message || 'Import failed.');
              }
            })
            .catch((err) => {
              setImportError(err.response?.data?.message || err.message || 'Import failed.');
            })
            .finally(() => {
              setImporting(false);
              if (fileInputRef.current) fileInputRef.current.value = '';
            });
        } catch (err) {
          setImportError(err.message || 'Failed to parse Excel file.');
          setImporting(false);
          if (fileInputRef.current) fileInputRef.current.value = '';
        }
      };
      reader.onerror = () => {
        setImportError('Failed to read the Excel file.');
        setImporting(false);
      };
      reader.readAsArrayBuffer(file);
    },
    [validateImportedRecord, fetchRegularizations, userRole, userEmail]
  );

  const handleExport = useCallback(() => {
    if (filteredRegularizations.length === 0) {
      setExportError('No data to export.');
      return;
    }
    setExporting(true);
    setExportError('');
    try {
      const exportData = filteredRegularizations.map((r) => ({
        'Employee Code': r.employeeCode || '',
        'Employee Name': r.employeeName || '',
        'Log Date': r.logDate ? formatDate(r.logDate) : '',
        'First In': r.firstIn || '',
        'Last Out': r.lastOut || '',
      }));
      const worksheet = XLSX.utils.json_to_sheet(exportData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Regularization');
      XLSX.writeFile(workbook, 'regularization_export.xlsx');
    } catch (err) {
      setExportError(err.message || 'Failed to export.');
    } finally {
      setExporting(false);
    }
  }, [filteredRegularizations]);

  const toggleMenu = (index) => {
    setExpandedMenus((prev) => ({ ...prev, [index]: !prev[index] }));
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
                <div className="cms-menu-toggle" onClick={() => setShowSidebarMenu(!showSidebarMenu)}>
                  <div className="cms-three-dots">
                    <span></span><span></span><span></span>
                  </div>
                </div>
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
                    <span className="cms-expand-icon">
                      <Plus size={16} className={`expand-icon ${expandedMenus[idx] ? 'rotated' : ''}`} />
                    </span>
                  </div>
                  <div className="cms-nav-children">
                    {item.children.map((child) => (
                      <Link
                        to={child.path}
                        key={child.label}
                        className={`cms-nav-child ${['/loh-report', '/onduty', '/grace', '/compoff', '/calendar', '/regularization'].includes(child.path) ? 'clock-color-icon' : ''}`}
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
                  className={`cms-nav-item ${['/regularization'].includes(item.path) ? 'clock-color-icon' : ''} ${location.pathname === item.path ? 'active' : ''}`}
                  data-nav-path={item.path}
                  key={item.label}
                >
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

          {!showForm && (
          <main className="cms-dashboard-content">
            <div
              className="employee-card-container regularization-list-layout"
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px', gap: '16px', flexWrap: 'wrap' }}>
              <div className="employee-header-actions">
                <div className="employee-title-section">
                  <h2 className="employee-title">
                    <Clock3 size={28} />
                    Regularization Directory
                  </h2>
                  <p className="employee-subtitle">
                    Manage your regularization records efficiently
                  </p>
                </div>
              </div>
              <div className="employee-toolbar" style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'nowrap' }}>
                <input
                  type="text"
                  placeholder="Search..."
                  className="regularization-search-input"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
                <input
                  type="file"
                  ref={fileInputRef}
                  accept=".xlsx,.xls"
                  style={{ display: 'none' }}
                  onChange={handleImport}
                />
                <button
                  className="toolbar-btn import-btn"
                  type="button"
                  onClick={() => fileInputRef.current && fileInputRef.current.click()}
                  disabled={importing}
                  title={importing ? 'Importing...' : 'Import Excel'}
                  style={{ background: '#fff', color: '#22c55e', border: 'none', fontWeight: 600, padding: '8px', borderRadius: '8px', width: '48px', height: '48px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}
                >
                  <FileInput size={22} style={{ color: '#22c55e' }} />
                </button>
                <button
                  className="toolbar-btn export-btn"
                  type="button"
                  onClick={handleExport}
                  disabled={exporting || filteredRegularizations.length === 0}
                  title={exporting ? 'Exporting...' : 'Export Excel'}
                  style={{ background: '#fff', color: '#2563eb', border: 'none', fontWeight: 600, padding: '8px', borderRadius: '8px', width: '48px', height: '48px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}
                >
                  <FileOutput size={22} style={{ color: '#2563eb' }} />
                </button>
                <button
                  className="toolbar-btn"
                  type="button"
                  onClick={fetchRegularizations}
                  disabled={fetchState === 'loading'}
                  title="Refresh data"
                  style={{ background: '#fff', color: '#7c3aed', border: 'none', fontWeight: 600, padding: '8px', borderRadius: '8px', width: '48px', height: '48px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}
                >
                  <RefreshCw size={22} style={{ color: '#7c3aed' }} />
                </button>
                <button
                  className="toolbar-btn toolbar-btn-add-employee"
                  type="button"
                  onClick={toggleForm}
                  title="Add Regularization"
                  style={{
                    background: '#fff',
                    color: '#14b8a6',
                    border: '2px solid rgba(20, 184, 166, 0.35)',
                    fontWeight: 700,
                    borderRadius: '12px',
                    width: '60px',
                    height: '60px',
                    minWidth: '60px',
                    minHeight: '60px',
                    padding: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: '0 4px 14px rgba(20, 184, 166, 0.22)',
                    flexShrink: 0,
                  }}
                >
                  <Plus size={34} strokeWidth={2.5} style={{ color: '#14b8a6' }} aria-hidden />
                </button>
                {selectedRegularizations.length > 0 && (
                  <button
                    className="toolbar-btn"
                    type="button"
                    onClick={handleMassDelete}
                    disabled={deletingMultiple}
                    title={deletingMultiple ? 'Deleting...' : `Delete selected (${selectedRegularizations.length})`}
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

            <form className="regularization-data-form" onSubmit={(e) => e.preventDefault()}>
              <div className="regularization-data-container">

                {fetchError && (
                  <div className="alert alert-error" style={{ marginBottom: '16px' }}>
                    {fetchError}
                  </div>
                )}
                {importError && (
                  <div className={`alert ${importError.indexOf('Imported') === 0 ? 'alert-success' : 'alert-error'}`} style={{ marginBottom: '16px' }}>
                    {importError}
                  </div>
                )}
                {exportError && (
                  <div className="alert alert-error" style={{ marginBottom: '16px' }}>
                    {exportError}
                  </div>
                )}
                {massDeleteError && (
                  <div className="alert alert-error" style={{ marginBottom: '16px' }}>
                    {massDeleteError}
                  </div>
                )}

                <div className="regularization-table-wrapper regularization-table-wrapper-inline">
                  <table className={`regularization-table ${tableHasEditColumn ? 'regularization-table-has-edit' : ''}`}>
                    <colgroup>
                      <col className="reg-col-check" />
                      {tableHasEditColumn && <col className="reg-col-edit" />}
                      <col className="reg-col-index" />
                      <col className="reg-col-code" />
                      <col className="reg-col-name" />
                      <col className="reg-col-date" />
                      <col className="reg-col-time" />
                      <col className="reg-col-time" />
                      <col className="reg-col-datetime" />
                      <col className="reg-col-datetime" />
                      <col className="reg-col-actions" />
                    </colgroup>
                    <thead>
                      <tr>
                        <th
                          onClick={() => {
                            if (fetchState === 'fetched') handleSelectAll();
                          }}
                          style={{ cursor: fetchState === 'fetched' ? 'pointer' : 'default' }}
                        >
                          <input type="checkbox" checked={allSelected} ref={(el) => el && (el.indeterminate = someSelected)} readOnly disabled={fetchState !== 'fetched'} />
                        </th>
                        {selectedRegularizations.length > 0 && <th>Edit</th>}
                        <th>#</th>
                        <th>Employee Code</th>
                        <th>Employee Name</th>
                        <th>Log Date</th>
                        <th>First In</th>
                        <th>Last Out</th>
                        <th>Created Time</th>
                        <th>Modified Time</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(fetchState === 'loading' || fetchState === 'idle') && (
                        <tr>
                          <td colSpan={tableColSpan} className="regularization-loading-cell">
                            <span className="regularization-loading-inline">Loading…</span>
                          </td>
                        </tr>
                      )}
                      {fetchState === 'error' && (
                        <tr>
                          <td colSpan={tableColSpan} style={{ textAlign: 'center', padding: '24px', color: '#666' }}>
                            Could not load records. Check the message above or click refresh to try again.
                          </td>
                        </tr>
                      )}
                      {fetchState === 'fetched' && filteredRegularizations.length === 0 && (
                        <tr>
                          <td colSpan={tableColSpan} style={{ textAlign: 'center', padding: '24px', color: '#666' }}>
                            No regularization records found.
                          </td>
                        </tr>
                      )}
                      {fetchState === 'fetched' &&
                        filteredRegularizations.length > 0 &&
                        filteredRegularizations.map((record, index) => (
                          <RegularizationRow
                            key={record.id}
                            record={record}
                            index={index}
                            removeRegularization={removeRegularization}
                            editRegularization={editRegularization}
                            isSelected={selectedRegularizations.includes(record.id)}
                            onSelect={handleSelectRegularization}
                            selectedRegularizations={selectedRegularizations}
                          />
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </form>
            </div>
          </main>
          )}

          {showForm && (
            <div className="employee-form-page">
              <div className="employee-form-container">
                <div className="employee-form-header">
                  <h1 style={{ paddingLeft: '20px' }}>
                    {isEditing ? 'Edit Regularization' : 'Add Regularization'}
                  </h1>
                  <button
                    type="button"
                    className="close-btn"
                    onClick={toggleForm}
                    title="Close form"
                    aria-label="Close form"
                  >
                    <X size={32} strokeWidth={2.5} aria-hidden />
                  </button>
                </div>
                <div className="employee-form-content">
                  <div className="employee-form-card">
                    <form onSubmit={saveRegularization} className="employee-form">
                      {formError && (
                        <div className="alert alert-error" style={{ marginBottom: '12px' }}>
                          {formError}
                        </div>
                      )}
                      <div className="form-section-card employee-info">
                        <h2 className="section-title">Employee</h2>
                        <div className="form-grid">
                          <div className="form-group">
                            <label htmlFor="reg-employee-code">Employee Code *</label>
                            <input
                              id="reg-employee-code"
                              className="input"
                              type="text"
                              value={form.employeeCode}
                              onChange={(e) => {
                                const v = e.target.value;
                                setForm((prev) => {
                                  const next = { ...prev, employeeCode: v };
                                  if (employeeCodeLookupTimerRef.current) clearTimeout(employeeCodeLookupTimerRef.current);
                                  employeeCodeLookupTimerRef.current = setTimeout(() => {
                                    employeeCodeLookupTimerRef.current = null;
                                    setForm((prevForm) => {
                                      const nameFromLookup = lookupEmployeeNameByCode(prevForm.employeeCode);
                                      if (nameFromLookup !== null) return { ...prevForm, employeeName: nameFromLookup };
                                      return prevForm;
                                    });
                                  }, 400);
                                  return next;
                                });
                              }}
                              onBlur={() => {
                                if (employeeCodeLookupTimerRef.current) {
                                  clearTimeout(employeeCodeLookupTimerRef.current);
                                  employeeCodeLookupTimerRef.current = null;
                                }
                                applyEmployeeCodeLookup();
                              }}
                              placeholder="Enter code to auto-fill name"
                              required
                            />
                            {employeeLookupLoading && (
                              <span className="text-muted" style={{ fontSize: '0.85rem', marginTop: 4 }}>Loading employee list…</span>
                            )}
                          </div>
                          <div className="form-group">
                            <label htmlFor="reg-employee-name">Employee Name</label>
                            <input
                              id="reg-employee-name"
                              className="input"
                              type="text"
                              value={form.employeeName}
                              readOnly
                              placeholder="Fills automatically when you enter employee code"
                              tabIndex={-1}
                            />
                          </div>
                        </div>
                      </div>
                      <div className="form-section-card work-info">
                        <h2 className="section-title">Attendance log</h2>
                        <div className="form-grid">
                          <div className="form-group">
                            <label htmlFor="reg-log-date">Log Date *</label>
                            <input
                              id="reg-log-date"
                              className="input"
                              type="date"
                              value={form.logDate}
                              onChange={(e) => setForm((prev) => ({ ...prev, logDate: e.target.value }))}
                              required
                            />
                          </div>
                          <div className="form-group">
                            <label htmlFor="reg-first-in">First In</label>
                            <div className="regularization-time-input-wrap regularization-time-in-employee-form">
                              <input
                                id="reg-first-in"
                                ref={firstInTimeInputRef}
                                className="input"
                                type="time"
                                step={60}
                                value={form.firstIn}
                                onChange={(e) => setForm((prev) => ({ ...prev, firstIn: e.target.value }))}
                                aria-label="First in time"
                              />
                              <button
                                type="button"
                                className="regularization-time-clock-btn"
                                onClick={() => openNativeTimePicker(firstInTimeInputRef)}
                                aria-label="Open time picker for First In"
                                title="Select time"
                              >
                                <Clock size={18} strokeWidth={2} />
                              </button>
                            </div>
                          </div>
                          <div className="form-group">
                            <label htmlFor="reg-last-out">Last Out</label>
                            <div className="regularization-time-input-wrap regularization-time-in-employee-form">
                              <input
                                id="reg-last-out"
                                ref={lastOutTimeInputRef}
                                className="input"
                                type="time"
                                step={60}
                                value={form.lastOut}
                                onChange={(e) => setForm((prev) => ({ ...prev, lastOut: e.target.value }))}
                                aria-label="Last out time"
                              />
                              <button
                                type="button"
                                className="regularization-time-clock-btn"
                                onClick={() => openNativeTimePicker(lastOutTimeInputRef)}
                                aria-label="Open time picker for Last Out"
                                title="Select time"
                              >
                                <Clock size={18} strokeWidth={2} />
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="form-actions">
                        <button type="button" className="btn btn-secondary" onClick={toggleForm}>
                          Cancel
                        </button>
                        <button type="submit" className="btn btn-primary" disabled={submitting}>
                          {submitting ? 'Saving...' : isEditing ? 'Update' : 'Add'}
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default Regularization;
