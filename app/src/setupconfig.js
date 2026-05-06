import { useEffect, useState, useMemo } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import Button from './Button';
import HeaderBranding from './HeaderBranding';
import './setupconfig.css';
import { getSidebarModulesForUser, resolveSidebarUserEmail } from './modulesConfig';
import {
  Users,
  Calendar as CalendarIcon,
  FileText,
  AlertTriangle,
  FolderOpen,
  ClipboardList,
  Building,
  Handshake,
  Landmark,
  Clock,
  BarChart3,
  Plus,
  Bell,
  LayoutDashboard,
  Home as HomeIcon,
  AlertOctagon,
  Shield,
  Clock3,
  Database,
  CalendarDays,
  Settings,
  GripVertical,
  Trash2,
  Pencil
} from 'lucide-react';

const PAYROLL_AUTOMATIC_MODE_OPTIONS = ['Automatic', 'Manual'];
const FORMULA_CONDITION_OPTIONS = ['<', '<=', '>', '>=', 'if', 'else if', 'else', 'min', 'max'];

function SetupConfig({ userRole, userEmail }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [expandedMenus, setExpandedMenus] = useState({});
  const [showNotifications, setShowNotifications] = useState(false);
  const [activePillar, setActivePillar] = useState('payroll'); // 'payroll' | 'loh' | 'ot'
  const [activeSubModule, setActiveSubModule] = useState('components');

  const [componentInput, setComponentInput] = useState('');
  const [componentCategory, setComponentCategory] = useState('AllFields');
  const [stagedComponents, setStagedComponents] = useState([]);
  const [savedComponentsAllFields, setSavedComponentsAllFields] = useState([]);
  const [savedComponentsDeduction, setSavedComponentsDeduction] = useState([]);
  const [savedFormulae, setSavedFormulae] = useState([]);
  const [variableName, setVariableName] = useState('');
  const [selectedComponent, setSelectedComponent] = useState('');
  const [selectedOperator, setSelectedOperator] = useState('+');
  const [selectedCondition, setSelectedCondition] = useState('');
  const [formulaExpression, setFormulaExpression] = useState('');
  const [editingFormulaId, setEditingFormulaId] = useState(null);
  const [message, setMessage] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [savedDrag, setSavedDrag] = useState(null); // { listKey: 'AllFields' | 'Deduction', index: number }
  const [automaticMonth, setAutomaticMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [automaticSelections, setAutomaticSelections] = useState(() => new Set());
  const [automaticLoading, setAutomaticLoading] = useState(false);
  const [savingAutomaticSelection, setSavingAutomaticSelection] = useState(false);
  const [automaticError, setAutomaticError] = useState('');

  // LOH pillar: Category LOH Applicable To & Grace (same as LOH Report)
  const [designationLohApplicableTo, setDesignationLohApplicableTo] = useState(['All']);
  const [grace, setGrace] = useState('');
  const [designationLohModalOpen, setDesignationLohModalOpen] = useState(false);
  const [designationLohDraft, setDesignationLohDraft] = useState([]);
  const [savingDesignationLoh, setSavingDesignationLoh] = useState(false);
  const [categoriesFromEmployees, setCategoriesFromEmployees] = useState(['All']);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [lohError, setLohError] = useState('');

  // OT pillar: Category OT Applicable To (same as Monthly OT report)
  const [categoryOtApplicableTo, setCategoryOtApplicableTo] = useState(['All']);
  const [otModalOpen, setOtModalOpen] = useState(false);
  const [otDraft, setOtDraft] = useState([]);
  const [savingOt, setSavingOt] = useState(false);
  const [otError, setOtError] = useState('');

  const userAvatar = 'https://images.pexels.com/photos/2379004/pexels-photo-2379004.jpeg?auto=compress&cs=tinysrgb&w=150';
  const userName = userRole === 'App Administrator' ? 'Admin User' : 'App User';

  const toPositionNumber = (value) => {
    const n = Number.parseInt(String(value ?? '').trim(), 10);
    return Number.isFinite(n) ? n : null;
  };

  const sortByPositionThenName = (a, b) => {
    const ap = toPositionNumber(a?.position);
    const bp = toPositionNumber(b?.position);
    if (ap == null && bp == null) {
      const an = String(a?.allFields || a?.name || '').toLowerCase();
      const bn = String(b?.allFields || b?.name || '').toLowerCase();
      return an.localeCompare(bn);
    }
    if (ap == null) return 1;
    if (bp == null) return -1;
    return ap - bp;
  };

  const modulesToShow = useMemo(
    () => getSidebarModulesForUser(resolveSidebarUserEmail(userEmail), userRole),
    [userEmail, userRole]
  );

  const toggleMenu = (index) => {
    setExpandedMenus((prev) => ({ ...prev, [index]: !prev[index] }));
  };

  const setFlash = (text) => {
    setMessage(text);
    setTimeout(() => setMessage(''), 2200);
  };

  const api = async (url, options = {}) => {
    const response = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      ...options
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.status === 'failure') {
      throw new Error(body.message || 'Request failed');
    }
    return body;
  };

  const loadSaved = async () => {
    try {
      const [componentsRes, formulaeRes] = await Promise.all([
        api('/server/setupconfig/payroll/components'),
        api(`/server/setupconfig/payroll/formulae?_=${Date.now()}`)
      ]);
      // Separate components by Deduction column (or other truthy flags)
      const allFields = [];
      const deduction = [];
      (componentsRes.data?.components || []).forEach((comp, idx) => {
        const row = typeof comp === 'string'
          ? { id: `legacy_${idx}`, allFields: comp, deduction: '' }
          : (comp || {});
        const d = String(row.deduction || row.Deduction || '').trim().toLowerCase();
        const isDeduction = d === '1' || d === 'true' || d === 'yes' || d === 'y' || d === 'deduction' || d === 'deduct';
        const normalized = {
          ...row,
          allFields: row.allFields || row.AllFields || row.name || '',
          position: row.position || row.Position || '',
          category: isDeduction ? 'Deduction' : 'AllFields',
        };
        if (isDeduction) deduction.push(normalized);
        else allFields.push(normalized);
      });
      setSavedComponentsAllFields(allFields.sort(sortByPositionThenName));
      setSavedComponentsDeduction(deduction.sort(sortByPositionThenName));
      setSavedFormulae(formulaeRes.data?.formulae || []);
    } catch (error) {
      setFlash('Unable to load setup data');
    }
  };

  useEffect(() => {
    loadSaved();
  }, []);

  useEffect(() => {
    if (activeSubModule !== 'formulae') {
      setEditingFormulaId(null);
    }
  }, [activeSubModule]);

  const selectionsFromAutomaticDatastoreRow = (row) => {
    const next = new Set();
    if (!row || typeof row !== 'object') return next;
    const isYes = (v) => {
      const s = String(v ?? '').trim().toLowerCase();
      return s === 'yes' || s === 'true' || s === '1' || s === 'y';
    };
    if (isYes(row.Automatic) || row.automatic === true) next.add('Automatic');
    if (isYes(row.Manual) || row.manual === true) next.add('Manual');
    return next;
  };

  useEffect(() => {
    if (activePillar !== 'payroll' || activeSubModule !== 'automatic' || !automaticMonth) return;
    let cancelled = false;
    setAutomaticLoading(true);
    setAutomaticError('');
    (async () => {
      try {
        const res = await fetch(
          `/server/payroll_function/automatic-selection/latest?month=${encodeURIComponent(automaticMonth)}&_t=${Date.now()}`
        );
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          throw new Error(data.error || `Could not load payroll mode (${res.status}).`);
        }
        if (data.status === 'success') {
          const next = new Set();
          if (data.automatic) next.add('Automatic');
          if (data.manual) next.add('Manual');
          setAutomaticSelections(next);
        } else {
          setAutomaticSelections(new Set());
        }
      } catch (err) {
        if (!cancelled) {
          setAutomaticSelections(new Set());
          setAutomaticError(err.message || 'Could not load payroll mode.');
        }
      } finally {
        if (!cancelled) setAutomaticLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activePillar, activeSubModule, automaticMonth]);

  const toggleAutomaticModeOption = (label) => {
    setAutomaticSelections((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  const saveAutomaticSelection = async () => {
    const list = Array.from(automaticSelections);
    if (list.length === 0) {
      setAutomaticError('Select at least one option: Automatic or Manual.');
      return;
    }
    setSavingAutomaticSelection(true);
    setAutomaticError('');
    try {
      const response = await fetch('/server/payroll_function/automatic-selection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selections: list, month: automaticMonth })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result.error || `Save failed (${response.status})`);
      }
      if (result.data) {
        setAutomaticSelections(selectionsFromAutomaticDatastoreRow(result.data));
      }
      setFlash(`Saved payroll mode for ${automaticMonth}: ${list.join(', ')}.`);
    } catch (err) {
      setAutomaticError(err.message || 'Failed to save payroll mode.');
    } finally {
      setSavingAutomaticSelection(false);
    }
  };

  // LOH pillar: load saved Category LOH Applicable To & Grace
  useEffect(() => {
    if (activePillar !== 'loh') return;
    setLohError('');
    fetch('/server/reports_function/loh-designation-applicable')
      .then((res) => res.json())
      .then((data) => {
        const savedDesignations = data?.data?.designations || [];
        if (Array.isArray(savedDesignations) && savedDesignations.length > 0) {
          setDesignationLohApplicableTo(savedDesignations);
        } else {
          setDesignationLohApplicableTo(['All']);
        }
        const savedGrace = data?.data?.grace;
        if (savedGrace !== undefined && savedGrace !== null && String(savedGrace).trim() !== '') {
          setGrace(String(savedGrace).trim());
        } else {
          setGrace('');
        }
      })
      .catch(() => setDesignationLohApplicableTo(['All']));
  }, [activePillar]);

  // LOH & OT pillars: load category data from cms_function (distinct Category from Employee table)
  useEffect(() => {
    if (activePillar !== 'loh' && activePillar !== 'ot') return;
    setCategoriesLoading(true);
    const params = new URLSearchParams();
    if (userRole) params.set('userRole', userRole);
    if (userEmail) params.set('userEmail', userEmail);
    fetch(`/server/cms_function/employees/categories?${params.toString()}`)
      .then((res) => res.json())
      .then((data) => {
        const categories = data?.data?.categories || [];
        setCategoriesFromEmployees(['All', ...categories]);
      })
      .catch(() => setCategoriesFromEmployees(['All']))
      .finally(() => setCategoriesLoading(false));
  }, [activePillar, userRole, userEmail]);

  // OT pillar: load saved Category OT Applicable To (designation-applicable = Monthly OT)
  useEffect(() => {
    if (activePillar !== 'ot') return;
    setOtError('');
    fetch('/server/reports_function/designation-applicable')
      .then((res) => res.json())
      .then((data) => {
        const saved = data?.data?.designations || data?.data?.departments || [];
        if (Array.isArray(saved) && saved.length > 0) {
          setCategoryOtApplicableTo(saved);
        } else {
          setCategoryOtApplicableTo(['All']);
        }
      })
      .catch(() => setCategoryOtApplicableTo(['All']));
  }, [activePillar]);

  const openDesignationLohModal = () => {
    const current = Array.isArray(designationLohApplicableTo)
      ? designationLohApplicableTo.filter((v) => v && v !== 'All')
      : [];
    setDesignationLohDraft(current);
    setDesignationLohModalOpen(true);
  };

  const toggleDesignationLohDraft = (designation) => {
    setDesignationLohDraft((prev) => {
      if (prev.includes(designation)) return prev.filter((d) => d !== designation);
      return [...prev, designation];
    });
  };

  const saveDesignationLohApplicable = async () => {
    const finalDesignations = designationLohDraft.filter(Boolean);
    setSavingDesignationLoh(true);
    setLohError('');
    try {
      const designationsToSave = finalDesignations.length > 0 ? finalDesignations : ['All'];
      const params = new URLSearchParams({
        designations: designationsToSave.join(','),
        grace: grace === '' ? '' : String(grace),
        startDate: '',
        endDate: '',
        department: 'All',
        employeeCode: 'All'
      });
      const res = await fetch(`/server/reports_function/loh-designation-applicable/save?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to save Category LOH Applicable To');
      setDesignationLohApplicableTo(designationsToSave);
      setDesignationLohModalOpen(false);
      setFlash('Category LOH Applicable To saved');
    } catch (err) {
      setLohError(err.message || 'Failed to save Category LOH Applicable To');
    } finally {
      setSavingDesignationLoh(false);
    }
  };

  const saveGraceValue = async () => {
    const graceMinutes = String(grace || '').trim();
    if (graceMinutes !== '' && !/^\d+$/.test(graceMinutes)) {
      setLohError('Grace must be entered as minutes (whole number).');
      return;
    }
    setLohError('');
    try {
      const params = new URLSearchParams({
        grace: graceMinutes,
        startDate: '',
        endDate: '',
        department: 'All',
        employeeCode: 'All'
      });
      const res = await fetch(`/server/reports_function/loh-grace/save?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to save Grace');
      setFlash('Grace saved');
    } catch (err) {
      setLohError(err.message || 'Failed to save Grace');
    }
  };

  const openOtModal = () => {
    const current = Array.isArray(categoryOtApplicableTo)
      ? categoryOtApplicableTo.filter((v) => v && v !== 'All')
      : [];
    setOtDraft(current);
    setOtModalOpen(true);
  };

  const toggleOtDraft = (cat) => {
    setOtDraft((prev) => {
      if (prev.includes(cat)) return prev.filter((d) => d !== cat);
      return [...prev, cat];
    });
  };

  const saveOtApplicable = async () => {
    const final = otDraft.filter(Boolean);
    setSavingOt(true);
    setOtError('');
    try {
      const toSave = final.length > 0 ? final : ['All'];
      const params = new URLSearchParams({
        designations: toSave.join(','),
        startDate: '',
        endDate: '',
        department: 'All',
        employeeCode: 'All'
      });
      const res = await fetch(`/server/reports_function/designation-applicable/save?${params.toString()}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error || body.message || 'Failed to save Category OT Applicable To');
      }
      setCategoryOtApplicableTo(toSave);
      setOtModalOpen(false);
      setFlash('Category OT Applicable To saved');
    } catch (err) {
      setOtError(err.message || 'Failed to save Category OT Applicable To');
    } finally {
      setSavingOt(false);
    }
  };

  const addComponentToStaging = () => {
    const value = componentInput.trim();
    if (!value) return;
    const isDeduction = componentCategory === 'Deduction';
    setStagedComponents((prev) => [
      ...prev,
      { name: value, category: componentCategory, deduction: isDeduction }
    ]);
    setComponentInput('');
  };

  const reorderArray = (arr, fromIndex, toIndex) => {
    if (fromIndex === toIndex) return arr;
    if (fromIndex < 0 || toIndex < 0) return arr;
    if (fromIndex >= arr.length || toIndex >= arr.length) return arr;
    const next = [...arr];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    return next;
  };

  const saveBackendOrder = async (listKey, orderedIds) => {
    await api('/server/setupconfig/payroll/components/reorder', {
      method: 'POST',
      body: JSON.stringify({ listKey, orderedIds })
    });
  };

  const deleteSavedComponent = async (rowId) => {
    if (!rowId) return;
    const ok = window.confirm('Delete this component?');
    if (!ok) return;
    try {
      await api('/server/setupconfig/payroll/components/delete', {
        method: 'POST',
        body: JSON.stringify({ rowId })
      });
      await loadSaved();
      setFlash('Component deleted');
    } catch (error) {
      setFlash(error.message || 'Unable to delete component');
    }
  };

  const onSavedDragStart = (listKey, index) => {
    setSavedDrag({ listKey, index });
  };

  const onSavedDrop = (listKey, dropIndex) => {
    if (!savedDrag || savedDrag.listKey !== listKey) {
      setSavedDrag(null);
      return;
    }
    const fromIndex = savedDrag.index;
    if (fromIndex === dropIndex) {
      setSavedDrag(null);
      return;
    }

    if (listKey === 'AllFields') {
      const next = reorderArray(savedComponentsAllFields, fromIndex, dropIndex);
      setSavedComponentsAllFields(next);
      const orderedIds = next.map((x) => x.id).filter(Boolean);
      saveBackendOrder('AllFields', orderedIds)
        .then(() => setFlash('Order saved'))
        .catch(() => {
          setFlash('Unable to save order');
          loadSaved();
        });
    } else {
      const next = reorderArray(savedComponentsDeduction, fromIndex, dropIndex);
      setSavedComponentsDeduction(next);
      const orderedIds = next.map((x) => x.id).filter(Boolean);
      saveBackendOrder('Deduction', orderedIds)
        .then(() => setFlash('Order saved'))
        .catch(() => {
          setFlash('Unable to save order');
          loadSaved();
        });
    }

    setSavedDrag(null);
  };

  const cancelComponents = () => {
    setStagedComponents([]);
    setComponentInput('');
  };

  const saveAll = async () => {
    if (stagedComponents.length === 0) {
      setFlash('Add at least one component before saving');
      return;
    }
    try {
      setIsSaving(true);
      await api('/server/setupconfig/payroll/components/save-all', {
        method: 'POST',
        body: JSON.stringify({ components: stagedComponents })
      });
      setStagedComponents([]);
      await loadSaved();
      setFlash('Components saved successfully');
    } catch (error) {
      setFlash(error.message || 'Save failed');
    } finally {
      setIsSaving(false);
    }
  };

  const insertVariable = () => {
    const v = variableName.trim();
    if (!v) return;
    const part = `${v} =`;
    setFormulaExpression((prev) => `${prev}${prev ? ' ' : ''}${part}`.trim());
  };

  const insertComponent = () => {
    const c = selectedComponent.trim();
    if (!c) return;
    setFormulaExpression((prev) => `${prev}${prev ? ' ' : ''}${c}`.trim());
  };

  const insertOperator = () => {
    const op = selectedOperator.trim();
    if (!op) return;
    const part = op === '(' || op === ')' ? op : ` ${op} `;
    setFormulaExpression((prev) => `${prev}${prev ? ' ' : ''}${part}`.trim());
  };

  const insertCondition = () => {
    const condition = selectedCondition.trim();
    if (!condition) return;
    setFormulaExpression((prev) => `${prev}${prev ? ' ' : ''}${condition}`.trim());
  };

  const beginEditFormula = (row) => {
    const full = String(row?.expression || '').trim();
    const eqIdx = full.indexOf('=');
    if (eqIdx > 0) {
      setVariableName(full.slice(0, eqIdx).trim());
      setFormulaExpression(full.slice(eqIdx + 1).trim());
    } else {
      setVariableName('');
      setFormulaExpression(full);
    }
    setEditingFormulaId(row?.id ?? null);
    setFlash('Editing formula — save to apply changes or cancel');
  };

  const cancelFormulaEdit = () => {
    setEditingFormulaId(null);
    setVariableName('');
    setFormulaExpression('');
    setSelectedComponent('');
    setSelectedOperator('+');
    setSelectedCondition('');
  };

  /** Same rules as setupconfig function buildFinalFormulaExpression (variable + RHS). */
  const buildDisplayFormula = (variable, expression) => {
    const v = String(variable || '').trim();
    const e = String(expression || '').trim();
    if (!e) return '';
    return v && e.includes('=') ? e : (v ? `${v} = ${e}` : e);
  };

  const saveFormula = async () => {
    const finalExpr = formulaExpression.trim();
    if (!finalExpr) {
      setFlash('Enter formula expression');
      return;
    }
    const editRowId = editingFormulaId;
    try {
      setIsSaving(true);
      const payload = {
        variable: variableName.trim(),
        expression: finalExpr
      };
      if (editRowId != null) {
        const updateRes = await api('/server/setupconfig/payroll/formulae/update', {
          method: 'POST',
          body: JSON.stringify({ ...payload, rowId: editRowId })
        });
        const updatedExpr =
          updateRes.data?.formula?.expression || buildDisplayFormula(payload.variable, payload.expression);
        setSavedFormulae((prev) =>
          prev.map((r) => (String(r.id) === String(editRowId) ? { ...r, expression: updatedExpr } : r))
        );
        setFlash('Formula updated successfully');
      } else {
        await api('/server/setupconfig/payroll/formulae/save', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        setFlash('Formula saved successfully');
      }
      setFormulaExpression('');
      setVariableName('');
      setEditingFormulaId(null);
      await loadSaved();
    } catch (error) {
      setFlash(error.message || 'Formula save failed');
    } finally {
      setIsSaving(false);
    }
  };

  const deleteFormula = async (rowId) => {
    if (!rowId) return;
    if (!window.confirm('Delete this formula?')) return;
    try {
      await api('/server/setupconfig/payroll/formulae/delete', {
        method: 'POST',
        body: JSON.stringify({ id: rowId })
      });
      if (String(editingFormulaId) === String(rowId)) {
        cancelFormulaEdit();
      }
      await loadSaved();
      setFlash('Formula deleted');
    } catch (error) {
      setFlash(error.message || 'Unable to delete formula');
    }
  };

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
                    <span className="cms-expand-icon">
                      <Plus size={16} className={`expand-icon ${expandedMenus[idx] ? 'rotated' : ''}`} />
                    </span>
                  </div>
                  <div className="cms-nav-children">
                    {item.children.map((child) => (
                      <Link to={child.path} key={child.label} className="cms-nav-child">
                        <span className="cms-nav-icon">{child.icon}</span>
                        <span className="cms-nav-label">{child.label}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              ) : (
                <Link
                  to={item.path}
                  key={item.label}
                  data-nav-path={item.path}
                  className={`cms-nav-item ${location.pathname === item.path ? 'active' : ''}`}
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
              <h1>
                {(userEmail === 'afrindinu14@gmail.com' || userEmail === 'vaishnavi.a@buildhr.co.in')
                  ? 'Yashaswi Academy for Skills'
                  : 'Payroll Management System'}
              </h1>
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
            <div className="setup-white-card">
              <h2>Setup Configuration</h2>

              <div className="setup-pillars">
                <button type="button" className={activePillar === 'payroll' ? 'active' : ''} onClick={() => setActivePillar('payroll')}>
                  Payroll
                </button>
                <button type="button" className={activePillar === 'loh' ? 'active' : ''} onClick={() => setActivePillar('loh')}>
                  LOH
                </button>
                <button type="button" className={activePillar === 'ot' ? 'active' : ''} onClick={() => setActivePillar('ot')}>
                  OT
                </button>
              </div>

              {activePillar === 'payroll' && (
                <>
                  <div className="setup-tabs">
                    <button type="button" className={activeSubModule === 'components' ? 'active' : ''} onClick={() => setActiveSubModule('components')}>
                      Components
                    </button>
                    <button type="button" className={activeSubModule === 'formulae' ? 'active' : ''} onClick={() => setActiveSubModule('formulae')}>
                      Formulae
                    </button>
                    <button type="button" className={activeSubModule === 'automatic' ? 'active' : ''} onClick={() => setActiveSubModule('automatic')}>
                      Automatic
                    </button>
                    <button type="button" className={activeSubModule === 'payslipTemplate' ? 'active' : ''} onClick={() => setActiveSubModule('payslipTemplate')}>
                      Payslip Template Creation
                    </button>
                  </div>

                  {message && <div className="setup-msg">{message}</div>}

                  {activeSubModule === 'components' && (
                <>
                  <div className="setup-input-row">
                    <input
                      value={componentInput}
                      onChange={(e) => setComponentInput(e.target.value)}
                      placeholder="Enter component name"
                    />
                    <select value={componentCategory} onChange={e => setComponentCategory(e.target.value)}>
                      <option value="AllFields">AllFields</option>
                      <option value="Deduction">Deduction</option>
                    </select>
                    <button type="button" className="add-component-btn" onClick={addComponentToStaging}>Add Component</button>
                  </div>

                  <table className="setup-table">
                    <thead>
                      <tr>
                        <th>Pending Components</th>
                        <th>Category</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stagedComponents.map((item, idx) => (
                        <tr key={`${item.name}-${idx}`}>
                          <td>{item.name}</td>
                          <td>{item.category}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <div className="setup-save-wrap">
                    <button type="button" onClick={saveAll} disabled={isSaving}>
                      {isSaving ? 'Saving...' : 'Save'}
                    </button>
                    <button type="button" className="cancel-btn" onClick={cancelComponents}>
                      Cancel
                    </button>
                  </div>

                  <div className="setup-saved-two-col">
                    <div className="setup-saved-block">
                      <h3>Saved Components (AllFields)</h3>
                      <table className="setup-table">
                        <thead>
                          <tr>
                            <th>AllFields</th>
                            <th className="setup-reorder-col">Reorder</th>
                            <th className="setup-delete-col" aria-label="Delete"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {savedComponentsAllFields.map((row, idx) => (
                            <tr
                              key={row.id || idx}
                              onDragOver={(e) => e.preventDefault()}
                              onDrop={() => onSavedDrop('AllFields', idx)}
                            >
                              <td>{row.allFields || row.name || JSON.stringify(row)}</td>
                              <td className="setup-reorder-col">
                                <span
                                  className="setup-drag-handle"
                                  title="Drag to reorder"
                                  draggable
                                  onDragStart={(e) => {
                                    e.dataTransfer?.setData('text/plain', '');
                                    onSavedDragStart('AllFields', idx);
                                  }}
                                  onDragEnd={() => setSavedDrag(null)}
                                >
                                  <GripVertical size={18} />
                                </span>
                              </td>
                              <td className="setup-delete-col">
                                <button
                                  type="button"
                                  className="setup-delete-btn"
                                  onClick={() => deleteSavedComponent(row.id)}
                                  title="Delete"
                                  aria-label="Delete"
                                >
                                  <Trash2 size={18} />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="setup-saved-block">
                      <h3>Saved Components (Deduction)</h3>
                      <table className="setup-table">
                        <thead>
                          <tr>
                            <th>Deduction</th>
                            <th className="setup-reorder-col">Reorder</th>
                            <th className="setup-delete-col">Delete</th>
                          </tr>
                        </thead>
                        <tbody>
                          {savedComponentsDeduction.map((row, idx) => (
                            <tr
                              key={row.id || idx}
                              onDragOver={(e) => e.preventDefault()}
                              onDrop={() => onSavedDrop('Deduction', idx)}
                            >
                              <td>{row.allFields || row.name || JSON.stringify(row)}</td>
                              <td className="setup-reorder-col">
                                <span
                                  className="setup-drag-handle"
                                  title="Drag to reorder"
                                  draggable
                                  onDragStart={(e) => {
                                    e.dataTransfer?.setData('text/plain', '');
                                    onSavedDragStart('Deduction', idx);
                                  }}
                                  onDragEnd={() => setSavedDrag(null)}
                                >
                                  <GripVertical size={18} />
                                </span>
                              </td>
                              <td className="setup-delete-col">
                                <button
                                  type="button"
                                  className="setup-delete-btn"
                                  onClick={() => deleteSavedComponent(row.id)}
                                  title="Delete"
                                  aria-label="Delete"
                                >
                                  <Trash2 size={18} />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}

              {activeSubModule === 'formulae' && (
                <>
                  <div className="formula-builder">
                    <div className="formula-row">
                      <div className="formula-field">
                        <label>Variable</label>
                        <input
                          value={variableName}
                          onChange={(e) => setVariableName(e.target.value)}
                          placeholder="Example: Gross"
                        />
                      </div>
                      <div className="formula-field">
                        <label>Select Component</label>
                        <select value={selectedComponent} onChange={(e) => setSelectedComponent(e.target.value)}>
                          <option value="">Select Component</option>
                          {[...savedComponentsAllFields, ...savedComponentsDeduction].map((item) => (
                            <option key={item.id} value={item.allFields}>{item.allFields}</option>
                          ))}
                          {stagedComponents.map((item, idx) => (
                            <option key={`staged-${idx}`} value={item.name}>{item.name}</option>
                          ))}
                        </select>
                      </div>
                      <div className="formula-field">
                        <label>Select Operator</label>
                        <select value={selectedOperator} onChange={(e) => setSelectedOperator(e.target.value)}>
                          <option value="+">+ Add</option>
                          <option value="-">- Subtract</option>
                          <option value="*">* Multiply</option>
                          <option value="/">/ Divide</option>
                          <option value="%">% Remainder</option>
                          <option value="(">( Parenthesis</option>
                          <option value=")">) Parenthesis</option>
                        </select>
                      </div>
                      <div className="formula-field">
                        <label>Select Condition Fields</label>
                        <select value={selectedCondition} onChange={(e) => setSelectedCondition(e.target.value)}>
                          <option value="">Select Condition Fields</option>
                          {FORMULA_CONDITION_OPTIONS.map((condition) => (
                            <option key={condition} value={condition}>{condition}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="insert-wrap">
                      <button type="button" onClick={insertVariable}>Insert Variable</button>
                      <button type="button" onClick={insertComponent}>Insert Component</button>
                      <button type="button" onClick={insertOperator}>Insert Operator</button>
                      <button type="button" onClick={insertCondition}>Insert Condition</button>
                    </div>

                    <div className="formula-expression-wrap">
                      <label>Formula Expression</label>
                      <textarea
                        value={formulaExpression}
                        onChange={(e) => setFormulaExpression(e.target.value)}
                        placeholder="Example: Basic + HRA - PF"
                      />
                    </div>

                    <div className="setup-save-wrap">
                      <button type="button" onClick={saveFormula} disabled={isSaving}>
                        {isSaving ? 'Saving...' : (editingFormulaId != null ? 'Update' : 'Save')}
                      </button>
                      {editingFormulaId != null ? (
                        <button type="button" className="cancel-btn" onClick={cancelFormulaEdit} disabled={isSaving}>
                          Cancel edit
                        </button>
                      ) : null}
                    </div>
                  </div>

                  <h3>Saved Formulae</h3>
                  <table className="setup-table setup-saved-formulae-table">
                    <colgroup>
                      <col />
                      <col style={{ width: 56 }} />
                      <col style={{ width: 100 }} />
                    </colgroup>
                    <thead>
                      <tr>
                        <th>Formula Expression</th>
                        <th className="setup-edit-col">Edit</th>
                        <th className="setup-delete-col" aria-label="Delete">Delete</th>
                      </tr>
                    </thead>
                    <tbody>
                      {savedFormulae.map((row) => (
                        <tr
                          key={row.id}
                          className={editingFormulaId != null && String(editingFormulaId) === String(row.id) ? 'setup-formula-row-editing' : ''}
                        >
                          <td>{row.expression}</td>
                          <td className="setup-edit-col">
                            <button
                              type="button"
                              className="setup-edit-btn"
                              onClick={() => beginEditFormula(row)}
                              disabled={isSaving}
                              title="Edit formula"
                              aria-label="Edit formula"
                            >
                              <Pencil size={16} strokeWidth={2} className="setup-edit-icon" aria-hidden />
                            </button>
                          </td>
                          <td className="setup-delete-col">
                            <button
                              type="button"
                              className="setup-delete-btn"
                              onClick={() => deleteFormula(row.id)}
                              title="Delete formula"
                              aria-label="Delete formula"
                            >
                              <Trash2 size={18} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}

              {activeSubModule === 'automatic' && (
                <div className="setup-pillar-content">
                  <h3 className="setup-pillar-title">Payroll Mode</h3>
                  <p className="setup-placeholder-desc">
                    Manage the Automatic and Manual payroll mode here. These settings are saved month-wise.
                  </p>
                  {automaticError ? <div className="setup-msg setup-msg-error">{automaticError}</div> : null}
                  <div className="setup-automatic-panel">
                    <div className="setup-automatic-field">
                      <label htmlFor="automatic-month">Month</label>
                      <input
                        id="automatic-month"
                        type="month"
                        value={automaticMonth}
                        onChange={(e) => setAutomaticMonth(e.target.value)}
                        disabled={automaticLoading || savingAutomaticSelection}
                      />
                    </div>
                    <div className="setup-automatic-field">
                      <label>Payroll Mode</label>
                      <div className="setup-automatic-options">
                        {PAYROLL_AUTOMATIC_MODE_OPTIONS.map((label) => (
                          <label key={label} className="setup-automatic-option">
                            <input
                              type="checkbox"
                              checked={automaticSelections.has(label)}
                              onChange={() => toggleAutomaticModeOption(label)}
                              disabled={automaticLoading || savingAutomaticSelection}
                            />
                            <span>{label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                  <p className="setup-placeholder-desc">
                    If Manual is saved for a month, Excel import writes rows to the SamplePayroll table for that month.
                  </p>
                  <div className="setup-save-wrap">
                    <button
                      type="button"
                      onClick={saveAutomaticSelection}
                      disabled={automaticLoading || savingAutomaticSelection}
                    >
                      {savingAutomaticSelection ? 'Saving...' : (automaticLoading ? 'Loading...' : 'Save')}
                    </button>
                  </div>
                </div>
              )}

              {activeSubModule === 'payslipTemplate' && (
                <div className="setup-pillar-content">
                  <h3 className="setup-pillar-title">Payslip Template Creation</h3>
                  <div className="setup-save-wrap">
                    <button type="button" onClick={() => navigate('/payslip-template')}>
                      Open Payslip Template Creation
                    </button>
                  </div>
                </div>
              )}
                </>
              )}

              {activePillar === 'loh' && (
                <div className="setup-pillar-content">
                  <h3 className="setup-pillar-title">LOH Setup</h3>
                  {lohError && <div className="setup-msg setup-msg-error">{lohError}</div>}
                  <div className="setup-loh-fields">
                    <div className="setup-loh-field">
                      <label>Category LOH Applicable To:</label>
                      <button
                        type="button"
                        className="setup-loh-category-btn"
                        onClick={openDesignationLohModal}
                      >
                        {(() => {
                          const categorySet = new Set(categoriesFromEmployees.filter((c) => c && c !== 'All'));
                          const onlyCategories = Array.isArray(designationLohApplicableTo)
                            ? designationLohApplicableTo.filter((v) => v && v !== 'All' && categorySet.has(v))
                            : [];
                          return onlyCategories.length > 0 ? onlyCategories.join(', ') : 'All';
                        })()}
                      </button>
                    </div>
                    <div className="setup-loh-field">
                      <label>Grace:</label>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        className="setup-loh-grace-input"
                        value={grace}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === '' || /^\d+$/.test(val)) setGrace(val);
                        }}
                        onBlur={() => { if (grace !== '') saveGraceValue(); }}
                        onKeyDown={(e) => { if (e.key === 'Enter' && grace !== '') saveGraceValue(); }}
                        placeholder="Enter grace (minutes)"
                      />
                    </div>
                  </div>
                  {designationLohModalOpen && (
                    <div
                      className="cms-notification-overlay"
                      onClick={() => setDesignationLohModalOpen(false)}
                    >
                      <div
                        className="cms-notification-popup setup-loh-modal"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="cms-notification-header">
                          <h3>Category LOH Applicable To</h3>
                          <button
                            type="button"
                            className="cms-close-btn"
                            onClick={() => setDesignationLohModalOpen(false)}
                            aria-label="Close"
                          >
                            ×
                          </button>
                        </div>
                        <div className="cms-notification-content setup-loh-modal-content">
                          {categoriesLoading ? (
                            <p className="setup-categories-loading">Loading categories from CMS...</p>
                          ) : categoriesFromEmployees.filter((d) => d !== 'All').length === 0 ? (
                            <p className="setup-categories-empty">No categories found. Categories come from the Category field on employees (Employee management).</p>
                          ) : (
                            categoriesFromEmployees.filter((d) => d !== 'All').map((d) => (
                              <label key={`loh-check-${d}`} className="setup-loh-checkbox-label">
                                <input
                                  type="checkbox"
                                  checked={designationLohDraft.includes(d)}
                                  onChange={() => toggleDesignationLohDraft(d)}
                                />
                                <span>{d}</span>
                              </label>
                            ))
                          )}
                        </div>
                        <div className="setup-loh-modal-footer">
                          <button type="button" onClick={() => setDesignationLohModalOpen(false)}>Cancel</button>
                          <button type="button" onClick={saveDesignationLohApplicable} disabled={savingDesignationLoh}>
                            {savingDesignationLoh ? 'Saving...' : 'Save'}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {activePillar === 'ot' && (
                <div className="setup-pillar-content">
                  <h3 className="setup-pillar-title">OT Setup</h3>
                  {otError && <div className="setup-msg setup-msg-error">{otError}</div>}
                  <div className="setup-loh-fields">
                    <div className="setup-loh-field">
                      <label>Category OT Applicable To:</label>
                      <button
                        type="button"
                        className="setup-loh-category-btn"
                        onClick={openOtModal}
                      >
                        {(() => {
                          const categorySet = new Set(categoriesFromEmployees.filter((c) => c && c !== 'All'));
                          const onlyCategories = Array.isArray(categoryOtApplicableTo)
                            ? categoryOtApplicableTo.filter((v) => v && v !== 'All' && categorySet.has(v))
                            : [];
                          return onlyCategories.length > 0 ? onlyCategories.join(', ') : 'All';
                        })()}
                      </button>
                    </div>
                  </div>
                  {otModalOpen && (
                    <div
                      className="cms-notification-overlay"
                      onClick={() => setOtModalOpen(false)}
                    >
                      <div
                        className="cms-notification-popup setup-loh-modal"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="cms-notification-header">
                          <h3>Category OT Applicable To</h3>
                          <button
                            type="button"
                            className="cms-close-btn"
                            onClick={() => setOtModalOpen(false)}
                            aria-label="Close"
                          >
                            ×
                          </button>
                        </div>
                        <div className="cms-notification-content setup-loh-modal-content">
                          {categoriesLoading ? (
                            <p className="setup-categories-loading">Loading categories from CMS...</p>
                          ) : categoriesFromEmployees.filter((d) => d !== 'All').length === 0 ? (
                            <p className="setup-categories-empty">No categories found. Categories come from the Category field on employees (Employee management).</p>
                          ) : (
                            categoriesFromEmployees.filter((d) => d !== 'All').map((d) => (
                              <label key={`ot-check-${d}`} className="setup-loh-checkbox-label">
                                <input
                                  type="checkbox"
                                  checked={otDraft.includes(d)}
                                  onChange={() => toggleOtDraft(d)}
                                />
                                <span>{d}</span>
                              </label>
                            ))
                          )}
                        </div>
                        <div className="setup-loh-modal-footer">
                          <button type="button" onClick={() => setOtModalOpen(false)}>Cancel</button>
                          <button type="button" onClick={saveOtApplicable} disabled={savingOt}>
                            {savingOt ? 'Saving...' : 'Save'}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </main>
        </div>
      </div>
    </>
  );
}

export default SetupConfig;
