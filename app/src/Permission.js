import './App.css';
import './helper.css';
import './permission.css';
import axios from 'axios';
import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import HeaderBranding from './HeaderBranding';
import Button from './Button';
import { getSidebarModulesForUser, resolveSidebarUserEmail } from './modulesConfig';
import {
  FileSignature, Plus, RefreshCw, Trash2, Bell, Clock, CalendarDays,
  Home as HomeIcon, LayoutDashboard, Landmark, Handshake, Users, Database,
  FileText, FolderOpen, ClipboardList, Building, Shield, AlertOctagon, AlertTriangle,
  BarChart3, Clock3, Calendar, Download, Upload, Pencil,
} from 'lucide-react';

function formatDate(dateStr) {
  if (!dateStr) return '-';
  const str = String(dateStr).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 10);
  try {
    const d = new Date(str);
    if (!isNaN(d.getTime())) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    }
  } catch (e) {}
  return str;
}

function PermissionRow({ permission, index, editPermission, isSelected, onSelect, selectedPermissions }) {
  return (
    <tr
      className="clickable-row"
      onClick={() => editPermission(permission)}
      style={{ cursor: 'pointer', transition: 'background-color 0.2s ease' }}
      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#f8f9fa'; }}
      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = ''; }}
    >
      <td onClick={(e) => { e.stopPropagation(); onSelect(permission.id); }}>
        <input type="checkbox" className="permission-table-checkbox" checked={isSelected} onChange={() => onSelect(permission.id)} />
      </td>
      {selectedPermissions.length > 0 && (
        <td onClick={(e) => { e.stopPropagation(); editPermission(permission); }}>
          {isSelected && (
            <button type="button" className="btn btn-icon permission-edit-btn" onClick={(e) => { e.stopPropagation(); editPermission(permission); }} title="Edit">
              <Pencil size={24} style={{ color: '#2563eb' }} />
            </button>
          )}
        </td>
      )}
      <td className="permission-sno-cell" onClick={(e) => { e.stopPropagation(); editPermission(permission); }} title="Click to edit">
        {index + 1}
      </td>
      <td>{permission.employeeCode || '-'}</td>
      <td>{permission.employeeName || '-'}</td>
      <td>{permission.permissionApplicableTo || '-'}</td>
      <td>{permission.permissionTime || '-'}</td>
      <td>{permission.permissionEndTime || '-'}</td>
      <td>{permission.permissionDate ? formatDate(permission.permissionDate) : '-'}</td>
      <td>{permission.createdTime ? String(permission.createdTime).replace('T', ' ').slice(0, 19) : '-'}</td>
      <td>{permission.modifiedTime ? String(permission.modifiedTime).replace('T', ' ').slice(0, 19) : '-'}</td>
    </tr>
  );
}

export default function PermissionManagement({ userRole = 'App Administrator', userEmail = null }) {
  const [permissions, setPermissions] = useState([]);
  const [filteredPermissions, setFilteredPermissions] = useState([]);
  const [fetchState, setFetchState] = useState('init');
  const [fetchError, setFetchError] = useState('');
  const [selectedPermissions, setSelectedPermissions] = useState([]);
  const [deletingMultiple, setDeletingMultiple] = useState(false);
  const [massDeleteError, setMassDeleteError] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(50);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [showAll, setShowAll] = useState(false);

  const [form, setForm] = useState({
    employeeCode: '',
    employeeName: '',
    permissionApplicableTo: '',
    permissionTime: '',
    permissionEndTime: '',
    permissionDate: '',
  });
  const [designationLohApplicableTo, setDesignationLohApplicableTo] = useState('');
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editingId, setEditingId] = useState(null);

  const [employeeLookupList, setEmployeeLookupList] = useState([]);
  const [employeeLookupLoading, setEmployeeLookupLoading] = useState(false);
  const lookupTimerRef = useRef(null);

  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const [importSuccess, setImportSuccess] = useState('');
  const importInputRef = useRef(null);

  const fetchPermissions = useCallback(() => {
    setFetchState('loading');
    setFetchError('');
    const params = showAll ? {} : { page, perPage };
    if (userRole && userEmail) {
      params.userRole = userRole;
      params.userEmail = userEmail;
    }
    axios
      .get('/server/permission_function/permission', { params, timeout: 5000 })
      .then((response) => {
        const list = response?.data?.data?.permissions || [];
        const total = response?.data?.data?.total || 0;
        const hasMore = response?.data?.data?.hasMore;
        setPermissions(Array.isArray(list) ? list : []);
        setFilteredPermissions(Array.isArray(list) ? list : []);
        setTotalCount(total);
        if (total && perPage && !showAll) {
          setTotalPages(Math.ceil(total / perPage));
        } else {
          setTotalPages(hasMore ? page + 1 : page);
        }
        setFetchState('fetched');
      })
      .catch((err) => {
        setFetchError(err.response?.data?.message || 'Failed to fetch permission records.');
        setFetchState('error');
        console.error('Fetch permission error:', err);
      });
  }, [page, perPage, showAll, userRole, userEmail]);

  useEffect(() => {
    fetchPermissions();
  }, [fetchPermissions]);

  const columns = [
    { label: 'Select', field: null },
    { label: 'Edit', field: null },
    { label: 'S.No', field: null },
    { label: 'Employee Code', field: 'employeeCode' },
    { label: 'Employee Name', field: 'employeeName' },
    { label: 'Permission Applicable To', field: 'permissionApplicableTo' },
    { label: 'Permission Time', field: 'permissionTime' },
    { label: 'Permission End Time', field: 'permissionEndTime' },
    { label: 'Permission Date', field: 'permissionDate' },
    { label: 'Created Time', field: 'createdTime' },
    { label: 'Modified Time', field: 'modifiedTime' },
  ];

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
      .catch(() => setEmployeeLookupList([]))
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
    const found = employeeLookupList.find((emp) => (String(emp.employeeCode || '').trim().toLowerCase() === trimmed.toLowerCase()));
    return found ? (found.employeeName || '') : null;
  }, [employeeLookupList]);

  const applyEmployeeCodeLookup = useCallback(() => {
    setForm((prev) => {
      const name = lookupEmployeeNameByCode(prev.employeeCode);
      if (name !== null) return { ...prev, employeeName: name };
      return prev;
    });
  }, [lookupEmployeeNameByCode]);

  const onChange = useCallback((e) => {
    const { name, value } = e.target;
    setForm((prev) => {
      const next = { ...prev, [name]: value };
      if (name === 'employeeCode') {
        if (lookupTimerRef.current) clearTimeout(lookupTimerRef.current);
        lookupTimerRef.current = setTimeout(() => {
          lookupTimerRef.current = null;
          setForm((prevForm) => {
            const nameFromLookup = lookupEmployeeNameByCode(prevForm.employeeCode);
            if (nameFromLookup !== null) return { ...prevForm, employeeName: nameFromLookup };
            return prevForm;
          });
        }, 400);
      }
      return next;
    });
    setFormError('');
  }, [lookupEmployeeNameByCode]);

  const handleSelectPermission = useCallback((id) => {
    setSelectedPermissions((prev) =>
      prev.includes(id) ? prev.filter((pid) => pid !== id) : [...prev, id]
    );
  }, []);

  const allSelected = filteredPermissions.length > 0 && selectedPermissions.length === filteredPermissions.length;
  const someSelected = selectedPermissions.length > 0 && selectedPermissions.length < filteredPermissions.length;

  const handleSelectAll = useCallback(() => {
    if (allSelected) {
      setSelectedPermissions([]);
    } else {
      setSelectedPermissions(filteredPermissions.map((p) => p.id));
    }
  }, [allSelected, filteredPermissions]);

  const handleMassDelete = useCallback(() => {
    if (selectedPermissions.length === 0) {
      setMassDeleteError('Please select at least one record to delete.');
      return;
    }
    if (!window.confirm(`Are you sure you want to delete ${selectedPermissions.length} record(s)?`)) return;
    setDeletingMultiple(true);
    setMassDeleteError('');
    Promise.all(
      selectedPermissions.map((id) =>
        axios.delete(`/server/permission_function/permission/${id}`, { timeout: 5000 }).catch((err) => ({
          error: err.response?.data?.message || `Failed to delete ID ${id}`,
          id,
        }))
      )
    )
      .then((results) => {
        const failed = results.filter((r) => r?.error);
        if (failed.length > 0) {
          setMassDeleteError('Failed to delete some records: ' + failed.map((f) => `ID ${f.id}: ${f.error}`).join('; '));
        }
        fetchPermissions();
        setSelectedPermissions([]);
      })
      .finally(() => setDeletingMultiple(false));
  }, [selectedPermissions, fetchPermissions]);

  function escapeCsvCell(value) {
    const s = String(value ?? '').trim();
    if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }

  const exportToCsv = useCallback(() => {
    if (!filteredPermissions.length) {
      setImportError('No data to export.');
      setTimeout(() => setImportError(''), 3000);
      return;
    }
    const headers = ['Employee Code', 'Employee Name', 'Designation LOH Applicable To', 'Permission Time', 'Permission End Time', 'Permission Date', 'Created Time', 'Modified Time'];
    const rows = filteredPermissions.map((p) => [
      escapeCsvCell(p.employeeCode),
      escapeCsvCell(p.employeeName),
      escapeCsvCell(p.permissionApplicableTo),
      escapeCsvCell(p.permissionTime),
      escapeCsvCell(p.permissionEndTime),
      escapeCsvCell(p.permissionDate ? formatDate(p.permissionDate) : ''),
      escapeCsvCell(p.createdTime ? String(p.createdTime).replace('T', ' ').slice(0, 19) : ''),
      escapeCsvCell(p.modifiedTime ? String(p.modifiedTime).replace('T', ' ').slice(0, 19) : ''),
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `permission_export_${new Date().toISOString().slice(0, 10)}.csv`;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
    setImportSuccess('Export completed.');
    setTimeout(() => setImportSuccess(''), 3000);
  }, [filteredPermissions]);

  const downloadTemplate = useCallback(() => {
    const headers = ['Employee Code', 'Employee Name', 'Designation LOH Applicable To', 'Permission Time', 'Permission End Time', 'Permission Date'];
    const sample = ['30170', 'Afrin', 'OPERATORS, INSPECTORS', '10:00', '12:00', '2026-03-12'];
    const csv = [headers.join(','), sample.join(',')].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'permission_import_template.csv';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
    setImportSuccess('Template downloaded.');
    setTimeout(() => setImportSuccess(''), 3000);
  }, []);

  function parseCsvLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if ((c === ',' && !inQuotes) || c === '\r') {
        result.push(current.trim());
        current = '';
        if (c === '\r') break;
      } else if (c !== '\n' || inQuotes) {
        current += c;
      }
    }
    result.push(current.trim());
    return result;
  }

  const handleImport = useCallback(
    (e) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      if (!/\.csv$/i.test(file.name)) {
        setImportError('Please upload a CSV file (.csv).');
        setTimeout(() => setImportError(''), 5000);
        return;
      }
      const maxSize = 5 * 1024 * 1024;
      if (file.size > maxSize) {
        setImportError('File size exceeds 5MB limit.');
        setTimeout(() => setImportError(''), 5000);
        return;
      }
      setImporting(true);
      setImportError('');
      setImportSuccess('');
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const text = (ev.target?.result || '').toString();
          const lines = text.split(/\r?\n/).filter((l) => l.trim());
          if (lines.length < 2) {
            setImportError('CSV must have a header row and at least one data row.');
            setImporting(false);
            return;
          }
          const headerRow = parseCsvLine(lines[0]);
          const findCol = (names) => {
            const lower = headerRow.map((h) => String(h).trim().toLowerCase());
            for (const n of names) {
              const idx = lower.indexOf(n.toLowerCase());
              if (idx >= 0) return idx;
            }
            for (const n of names) {
              const idx = lower.findIndex((h) => h.includes(n.toLowerCase()));
              if (idx >= 0) return idx;
            }
            return -1;
          };
          const codeIdx = findCol(['employee code', 'employeecode', 'code']);
          const nameIdx = findCol(['employee name', 'employeename', 'name']);
          const applicableIdx = findCol(['designation loh applicable to', 'permission applicable to', 'applicable']);
          const timeIdx = findCol(['permission time', 'time']);
          const endTimeIdx = findCol(['permission end time', 'end time', 'endtime']);
          const dateIdx = findCol(['permission date', 'date']);
          const codeCol = codeIdx >= 0 ? codeIdx : 0;
          const nameCol = nameIdx >= 0 ? nameIdx : 1;
          const applicableCol = applicableIdx >= 0 ? applicableIdx : 2;
          const timeCol = timeIdx >= 0 ? timeIdx : 3;
          const endTimeCol = endTimeIdx >= 0 ? endTimeIdx : 4;
          const dateCol = dateIdx >= 0 ? dateIdx : 5;
          let successCount = 0;
          let failCount = 0;
          const run = async () => {
            for (let i = 1; i < lines.length; i++) {
              const cells = parseCsvLine(lines[i]);
              const employeeCode = (cells[codeCol] ?? '').toString().trim();
              const employeeName = (cells[nameCol] ?? '').toString().trim();
              const permissionApplicableTo = (cells[applicableCol] ?? '').toString().trim();
              const permissionTime = (cells[timeCol] ?? '').toString().trim();
              const permissionEndTime = (cells[endTimeCol] ?? '').toString().trim();
              const permissionDate = (cells[dateCol] ?? '').toString().trim();
              if (!employeeCode) continue;
              const payload = {
                employeeCode,
                employeeName: employeeName || employeeCode,
                permissionApplicableTo: permissionApplicableTo || (designationLohApplicableTo || '').trim(),
                permissionTime,
                permissionEndTime,
                permissionDate: permissionDate || formatDate(new Date()),
              };
              try {
                await axios.post('/server/permission_function/permission', payload, { timeout: 5000 });
                successCount++;
              } catch (err) {
                failCount++;
                console.warn('Import row failed:', i + 1, err?.response?.data?.message || err.message);
              }
            }
            setImporting(false);
            fetchPermissions();
            if (failCount === 0) {
              setImportSuccess(`Imported ${successCount} record(s) successfully.`);
            } else {
              setImportSuccess(`Imported ${successCount} record(s). ${failCount} failed.`);
            }
            setTimeout(() => { setImportSuccess(''); setImportError(''); }, 5000);
          };
          run();
        } catch (err) {
          setImportError(err?.message || 'Failed to parse CSV.');
          setImporting(false);
          setTimeout(() => setImportError(''), 5000);
        }
      };
      reader.onerror = () => {
        setImportError('Failed to read file.');
        setImporting(false);
      };
      reader.readAsText(file, 'UTF-8');
    },
    [designationLohApplicableTo, fetchPermissions]
  );

  const validateForm = useCallback(() => {
    if (!(form.employeeCode && String(form.employeeCode).trim())) {
      setFormError('Employee Code is required.');
      return false;
    }
    return true;
  }, [form]);

  const savePermission = useCallback(
    (e) => {
      e.preventDefault();
      if (!validateForm()) return;
      setSubmitting(true);
      const payload = {
        employeeCode: (form.employeeCode || '').trim(),
        employeeName: (form.employeeName || '').trim(),
        permissionApplicableTo: (form.permissionApplicableTo || '').trim(),
        permissionTime: (form.permissionTime || '').trim(),
        permissionEndTime: (form.permissionEndTime || '').trim(),
        permissionDate: (form.permissionDate || '').trim(),
      };
      const request = isEditing
        ? axios.put(`/server/permission_function/permission/${editingId}`, payload, { timeout: 5000 })
        : axios.post('/server/permission_function/permission', payload, { timeout: 5000 });

      request
        .then((response) => {
          const perm = response?.data?.data?.permission;
          if (!perm) throw new Error('Unexpected response');
          if (isEditing) {
            setPermissions((prev) => prev.map((p) => (p.id === perm.id ? perm : p)));
            setFilteredPermissions((prev) => prev.map((p) => (p.id === perm.id ? perm : p)));
          } else {
            setPermissions((prev) => [perm, ...prev]);
            setFilteredPermissions((prev) => [perm, ...prev]);
          }
          fetchPermissions();
          setForm({ employeeCode: '', employeeName: '', permissionApplicableTo: '', permissionTime: '', permissionEndTime: '', permissionDate: '' });
          setShowForm(false);
          setIsEditing(false);
          setEditingId(null);
        })
        .catch((err) => {
          setFormError(err.response?.data?.message || (isEditing ? 'Failed to update record.' : 'Failed to add record.'));
          console.error('Save permission error:', err);
        })
        .finally(() => setSubmitting(false));
    },
    [form, isEditing, editingId, validateForm, fetchPermissions]
  );

  const removePermission = useCallback((id) => {
    setPermissions((prev) => prev.filter((p) => p.id !== id));
    setFilteredPermissions((prev) => prev.filter((p) => p.id !== id));
    setSelectedPermissions((prev) => prev.filter((pid) => pid !== id));
  }, []);

  const editPermission = useCallback((permission) => {
    let startTime = (permission.permissionTime || '').trim();
    let endTime = (permission.permissionEndTime || '').trim();
    if (startTime && startTime.includes(' - ')) {
      const parts = startTime.split(/\s*-\s*/);
      if (parts.length >= 2) {
        startTime = parts[0].trim();
        if (!endTime) endTime = parts[1].trim();
      }
    }
    setForm({
      employeeCode: permission.employeeCode || '',
      employeeName: permission.employeeName || '',
      permissionApplicableTo: permission.permissionApplicableTo || '',
      permissionTime: startTime,
      permissionEndTime: endTime,
      permissionDate: permission.permissionDate ? formatDate(permission.permissionDate) : '',
    });
    setIsEditing(true);
    setEditingId(permission.id);
    setShowForm(true);
  }, []);

  const toggleForm = useCallback(() => {
    setShowForm((prev) => !prev);
    setFormError('');
    if (!showForm) {
      setForm({ employeeCode: '', employeeName: '', permissionApplicableTo: '', permissionTime: '', permissionEndTime: '', permissionDate: '' });
      setIsEditing(false);
      setEditingId(null);
    }
  }, [showForm]);

  const dynamicColumns = useMemo(() => {
    if (selectedPermissions.length === 0) return columns.filter((c) => c.label !== 'Edit');
    return columns;
  }, [selectedPermissions.length]);

  const [expandedMenus, setExpandedMenus] = useState({});

  const toggleMenu = (index) => {
    setExpandedMenus((prev) => ({ ...prev, [index]: !prev[index] }));
  };

  // Same sidebar order on all pages (from modulesConfig)
  const modulesToShow = useMemo(
    () => getSidebarModulesForUser(resolveSidebarUserEmail(userEmail), userRole),
    [userEmail, userRole]
  );
  const userAvatar = 'https://images.pexels.com/photos/2379004/pexels-photo-2379004.jpeg?auto=compress&cs=tinysrgb&w=150';
  const userName = userRole === 'App Administrator' ? 'Admin User' : 'App User';
  const [showNotifications, setShowNotifications] = useState(false);
  const recentActivities = [
    { icon: '👥', title: 'Permission Added', description: 'A new permission record has been added', time: '2 minutes ago' },
    { icon: '📝', title: 'Permission Updated', description: 'A permission record has been updated', time: '5 minutes ago' },
  ];

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
                        className={`cms-nav-child ${['/loh-report', '/onduty', '/permission', '/grace', '/compoff', '/calendar'].includes(child.path) ? 'clock-color-icon' : ''}`}
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
                  className={`cms-nav-item ${['/loh-report', '/onduty', '/permission', '/grace', '/compoff', '/calendar'].includes(item.path) ? 'clock-color-icon' : ''}`}
                  data-nav-path={item.path}
                  key={item.label}
                >
                  <span className="cms-nav-icon">{item.icon}</span>
                  <span className="cms-nav-label">{item.label}</span>
                </Link>
              )
            ))}
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

          {showNotifications && (
            <div className="cms-notification-overlay" onClick={() => setShowNotifications(false)}>
              <div className="cms-notification-popup" onClick={(e) => e.stopPropagation()}>
                <div className="cms-notification-header">
                  <h3>Recent Activity</h3>
                  <button className="cms-close-btn" onClick={() => setShowNotifications(false)}>×</button>
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

          <main className="cms-dashboard-content">
            <div className="permission-card-container">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
                <div className="permission-header-actions">
                  <div className="permission-title-section">
                    <h2 className="permission-title">
                      <FileSignature size={28} />
                      Permission Management
                    </h2>
                    <p className="permission-subtitle">Manage permission records</p>
                  </div>
                </div>
                <div className="permission-toolbar">
                  <button type="button" className="permission-toolbar-btn permission-toolbar-refresh" onClick={() => { setPage(1); setShowAll(false); fetchPermissions(); }} disabled={fetchState === 'loading'} title="Refresh">
                    <RefreshCw size={28} />
                  </button>
                  <button type="button" className="permission-toolbar-btn permission-toolbar-export" onClick={exportToCsv} disabled={fetchState === 'loading' || !filteredPermissions.length} title="Export to CSV">
                    <Download size={26} />
                    <span className="permission-toolbar-btn-label">Export</span>
                  </button>
                  <button type="button" className="permission-toolbar-btn permission-toolbar-template" onClick={downloadTemplate} title="Download import template">
                    <FileText size={26} />
                    <span className="permission-toolbar-btn-label">Template</span>
                  </button>
                  <input type="file" ref={importInputRef} accept=".csv" onChange={handleImport} style={{ display: 'none' }} />
                  <button type="button" className="permission-toolbar-btn permission-toolbar-import" onClick={() => importInputRef.current?.click()} disabled={importing} title="Import from CSV">
                    <Upload size={26} />
                    <span className="permission-toolbar-btn-label">{importing ? 'Importing…' : 'Import'}</span>
                  </button>
                  <button type="button" className="permission-toolbar-btn permission-toolbar-add" onClick={toggleForm} title="Add new">
                    <Plus size={28} />
                  </button>
                  {selectedPermissions.length > 0 && (
                    <button type="button" className="permission-toolbar-btn permission-toolbar-delete" onClick={handleMassDelete} disabled={deletingMultiple} title="Delete selected">
                      <Trash2 size={26} />
                    </button>
                  )}
                </div>
              </div>

              {importSuccess && <div className="permission-import-success" style={{ margin: '10px 0', color: '#0d9488' }}>{importSuccess}</div>}
              {importError && <div className="error-message" style={{ margin: '10px 0', color: 'red' }}>{importError}</div>}
              {massDeleteError && <div className="error-message" style={{ margin: '10px 0', color: 'red' }}>{massDeleteError}</div>}

              {showForm && (
                <div className="permission-form-page">
                  <div className="permission-form-container">
                    <div className="permission-form-header">
                      <h1 style={{ paddingLeft: '20px' }}>{isEditing ? 'Edit Permission' : 'Add New Permission'}</h1>
                      <button type="button" className="close-btn" onClick={toggleForm} title="Close">×</button>
                    </div>
                    <div className="permission-form-content">
                      <div className="permission-form-card">
                        <div className="form-section-card permission-info">
                          <h2 className="section-title">Permission Information</h2>
                          <div className="form-grid">
                            <div className="form-group">
                              <label>Employee Code *</label>
                              <input className="input" type="text" name="employeeCode" value={form.employeeCode} onChange={onChange} onBlur={applyEmployeeCodeLookup} placeholder="Enter code" />
                              {employeeLookupLoading && <span className="text-muted" style={{ fontSize: '0.85rem', marginTop: 4 }}>Loading employees…</span>}
                            </div>
                            <div className="form-group">
                              <label>Employee Name</label>
                              <input className="input" type="text" name="employeeName" value={form.employeeName} readOnly placeholder="Auto-filled from code" tabIndex={-1} />
                            </div>
                            <div className="form-group">
                              <label>Permission Applicable To</label>
                              <input className="input" type="text" name="permissionApplicableTo" value={form.permissionApplicableTo} onChange={onChange} placeholder="e.g. Leave, Gate pass" />
                            </div>
                            <div className="form-group">
                              <label>Permission Time (Start)</label>
                              <input className="input" type="time" name="permissionTime" value={form.permissionTime} onChange={onChange} />
                            </div>
                            <div className="form-group">
                              <label>Permission End Time</label>
                              <input className="input" type="time" name="permissionEndTime" value={form.permissionEndTime} onChange={onChange} />
                            </div>
                            <div className="form-group">
                              <label>Permission Date</label>
                              <input className="input" type="date" name="permissionDate" value={form.permissionDate} onChange={onChange} />
                            </div>
                          </div>
                        </div>
                        <div className="form-actions">
                          <button type="submit" className="btn btn-primary" disabled={submitting} onClick={savePermission}>
                            {isEditing ? 'Update' : 'Submit'}
                            {submitting && <span className="btn-primary__loader ml-5"></span>}
                          </button>
                          <button type="button" className="btn btn-danger" onClick={toggleForm}>Cancel</button>
                        </div>
                        {formError && <div className="error-message">{formError}</div>}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {!showForm && (
                <>
                  <div className="permission-table-container" style={{ marginTop: 32 }}>
                    {fetchState === 'loading' && (
                      <div className="dF aI-center jC-center h-inh">
                        <div className="loader-lg"></div>
                      </div>
                    )}
                    {fetchState === 'error' && <div className="error-message">{fetchError}</div>}
                    {fetchState === 'fetched' && (
                      <table className={`permission-table ${selectedPermissions.length === 0 ? 'edit-column-hidden' : ''}`}>
                        <thead>
                          <tr>
                            {dynamicColumns.map((col, idx) => (
                              <th key={idx}>
                                {col.label === 'Select' ? (
                                  <input type="checkbox" className="permission-table-checkbox permission-select-all-checkbox" checked={allSelected} ref={(el) => { if (el) el.indeterminate = someSelected; }} onChange={handleSelectAll} style={{ cursor: 'pointer', accentColor: '#dc3545' }} />
                                ) : (
                                  col.label
                                )}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {filteredPermissions.length ? (
                            filteredPermissions.map((perm, idx) => (
                              <PermissionRow
                                key={perm.id}
                                permission={perm}
                                index={idx}
                                editPermission={editPermission}
                                isSelected={selectedPermissions.includes(perm.id)}
                                onSelect={handleSelectPermission}
                                selectedPermissions={selectedPermissions}
                              />
                            ))
                          ) : (
                            <tr>
                              <td colSpan={dynamicColumns.length} className="text-center">No permission records. Add a new record.</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    )}
                  </div>
                </>
              )}
            </div>
          </main>
        </div>
      </div>
    </>
  );
}
