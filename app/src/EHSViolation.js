import './App.css';
import './helper.css';
import './EHSViolation.css';
import './employeeManagement.css';
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import axios from 'axios';
import { useNavigate, useParams, useLocation, Link } from 'react-router-dom';
import Button from './Button';
import HeaderBranding from './HeaderBranding';
import { getSidebarModulesForUser, resolveSidebarUserEmail } from './modulesConfig';
import {
  Shield,
  AlertOctagon,
  Home,
  ArrowLeft,
  Plus,
  FileText,
  Users,
  BarChart3,
  Settings,
  Bell,
  CheckCircle,
  LayoutDashboard,
  Calendar,
  FolderOpen,
  AlertTriangle,
  CreditCard,
  HomeIcon,
  Landmark,
  ClipboardList,
  Building,
  Handshake,
  Clock,
  Map,
  User,
  FileSignature,
  Search,
  Clock3,
  Database,
  FileInput,
  FileOutput,
  Filter,
  RefreshCw,
  Trash2,
  CalendarDays
} from 'lucide-react';

// Add styles object for inline styles
const styles = {
  formContainer: {
    maxWidth: '1400px',
    margin: '40px auto',
    padding: '32px 24px 40px 24px',
    fontFamily: "'Segoe UI', 'Roboto', Arial, sans-serif",
    background: '#fff',
    borderRadius: '12px',
    boxShadow: '0 4px 24px rgba(0,0,0,0.07)',
  },
  h2: {
    textAlign: 'center',
    color: '#333',
    marginBottom: '32px',
  },
  feedbackMessage: {
    padding: '12px 16px',
    borderRadius: '6px',
    marginBottom: '20px',
    textAlign: 'center',
  },
  errorMessage: {
    backgroundColor: '#f8d7da',
    color: '#721c24',
    border: '1px solid #f5c6cb',
  },
  violationsTableContainer: {
    overflowX: 'auto',
    marginTop: '24px',
    border: 'none',
    borderRadius: '18px',
    boxShadow: '0 6px 24px rgba(0,0,0,0.08), 0 1.5px 4px rgba(0,0,0,0.04)',
    background: 'linear-gradient(120deg, #f8fafc 0%, #f4f6f8 100%)',
    padding: '0 0 12px 0',
  },
  violationsTable: {
    width: '100%',
    borderCollapse: 'separate',
    borderSpacing: 0,
    background: '#fff',
    borderRadius: '18px',
    overflow: 'hidden',
    fontFamily: "'Segoe UI', 'Arial', sans-serif",
  },
  violationsTableTh: {
    background: 'linear-gradient(90deg, #c7d2fe 0%, #e0e7ff 100%)',
    fontWeight: 700,
    color: '#1e293b',
    padding: '16px 12px',
    textAlign: 'left',
    borderBottom: '2px solid #e2e8f0',
    position: 'sticky',
    top: 0,
    zIndex: 10,
  },
  violationsTableTd: {
    padding: '12px',
    borderBottom: '1px solid #e2e8f0',
    verticalAlign: 'top',
  },
  violationsTableTr: {
    transition: 'background-color 0.2s',
  },
  violationsTableTrHover: {
    backgroundColor: '#f8fafc',
  },
  toolbar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '20px',
    flexWrap: 'wrap',
    gap: '12px',
  },
  toolbarBtn: {
    backgroundColor: '#3f51b5',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    padding: '10px 16px',
    fontSize: '14px',
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'background 0.2s',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  toolbarBtnHover: {
    backgroundColor: '#303f9f',
  },
  toolbarBtnSecondary: {
    backgroundColor: '#6c757d',
  },
  toolbarBtnSecondaryHover: {
    backgroundColor: '#5a6268',
  },
  iconButton: {
    backgroundColor: '#f8f9fa',
    border: '1px solid #dee2e6',
    borderRadius: '8px',
    padding: '8px',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
  },
  formGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
    gap: '20px',
  },
  formGroup: {
    display: 'flex',
    flexDirection: 'column',
  },
  label: {
    marginBottom: '5px',
    fontWeight: 'bold',
    color: '#333',
  },
  required: {
    color: '#dc3545',
    marginLeft: '4px',
  },
  input: {
    padding: '12px',
    border: '1px solid #ddd',
    borderRadius: '6px',
    fontSize: '14px',
    transition: 'border-color 0.2s, box-shadow 0.2s',
  },
  inputFocus: {
    borderColor: '#3f51b5',
    boxShadow: '0 0 0 2px rgba(63, 81, 181, 0.1)',
  },
  select: {
    padding: '12px',
    border: '1px solid #ddd',
    borderRadius: '6px',
    fontSize: '14px',
    backgroundColor: '#fff',
    transition: 'border-color 0.2s, box-shadow 0.2s',
    maxHeight: '200px',
    overflowY: 'auto',
  },
  textarea: {
    padding: '12px',
    border: '1px solid #ddd',
    borderRadius: '6px',
    fontSize: '14px',
    minHeight: '120px',
    resize: 'vertical',
    fontFamily: 'inherit',
    transition: 'border-color 0.2s, box-shadow 0.2s',
  },
  radioGroup: {
    display: 'flex',
    gap: '20px',
    marginTop: '8px',
  },
  radioLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    cursor: 'pointer',
  },
  radioInput: {
    margin: 0,
    cursor: 'pointer',
  },
  buttonPrimary: {
    backgroundColor: '#3f51b5',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    padding: '12px 24px',
    fontSize: '15px',
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'background 0.2s',
    marginRight: '12px',
  },
  buttonSecondary: {
    backgroundColor: '#6c757d',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    padding: '12px 24px',
    fontSize: '15px',
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'background 0.2s',
  },
  formActions: {
    display: 'flex',
    justifyContent: 'center',
    marginTop: '32px',
    gap: '12px',
  },
  headerActions: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '20px',
  },
  backButton: {
    backgroundColor: '#6c757d',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    padding: '10px 16px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'background 0.2s',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  fileUploadContainer: {
    border: '2px dashed #ddd',
    borderRadius: '6px',
    padding: '20px',
    textAlign: 'center',
    backgroundColor: '#f8f9fa',
    transition: 'border-color 0.2s, background-color 0.2s',
    cursor: 'pointer',
  },
  fileUploadContainerHover: {
    borderColor: '#3f51b5',
    backgroundColor: '#f0f2ff',
  },
  fileUploadInput: {
    display: 'none',
  },
  fileUploadIcon: {
    fontSize: '24px',
    color: '#6c757d',
    marginBottom: '8px',
  },
  fileUploadText: {
    color: '#6c757d',
    fontSize: '14px',
    marginBottom: '4px',
  },
  fileUploadHint: {
    color: '#aaa',
    fontSize: '12px',
  },
  filePreview: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px',
    backgroundColor: '#e9ecef',
    borderRadius: '4px',
    marginTop: '8px',
  },
  filePreviewName: {
    flex: 1,
    fontSize: '14px',
  },
  filePreviewRemove: {
    backgroundColor: '#dc3545',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    padding: '4px 8px',
    cursor: 'pointer',
    fontSize: '12px',
  },
  fileError: {
    color: '#dc3545',
    fontSize: '12px',
    marginTop: '4px',
  },
};

// ... (previous imports and styles remain unchanged)

// EHSViolationRow with clickable functionality
function EHSViolationRow({ violation, index, editViolation, isSelected, onCheckboxChange, selectedViolations }) {
  const handleRowClick = () => {
    editViolation(violation);
  };

  const handleCheckboxClick = (e) => {
    e.stopPropagation(); // Prevent row click when clicking checkbox
    onCheckboxChange(violation.id, e.target.checked);
  };

  const handleEditButtonClick = (e) => {
    e.stopPropagation(); // Prevent row click when clicking edit button
    editViolation(violation);
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
            cursor: 'pointer',
            accentColor: '#dc3545',
          }}
          title="Select for deletion"
        />
      </td>
      {selectedViolations.size > 0 && (
        <td onClick={handleEditButtonClick}>
          {isSelected && (
            <button
              onClick={handleEditButtonClick}
              className="btn-icon"
              title="Edit"
              onMouseEnter={(e) => {
                e.target.style.transform = 'scale(1.1)';
              }}
              onMouseLeave={(e) => {
                e.target.style.transform = 'scale(1)';
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
        {violation.Contractor || '-'}
      </td>
      <td>{violation.ContractEmployeeID || '-'}</td>
      <td>{violation.DateofViolation || '-'}</td>
      <td>{violation.TypeofViolation || '-'}</td>
      <td>{violation.Safetyviolationchallannumber || '-'}</td>
      <td>
        {violation.Stage1 ? (
          <div style={{ maxWidth: '200px', wordBreak: 'break-word' }}>
            {violation.Stage1}
          </div>
        ) : '-'}
      </td>
      <td>
        {violation.Stage2 ? (
          <div style={{ maxWidth: '200px', wordBreak: 'break-word' }}>
            {violation.Stage2}
          </div>
        ) : '-'}
      </td>
      <td>
        {violation.Stage3 ? (
          <div style={{ maxWidth: '200px', wordBreak: 'break-word' }}>
            {violation.Stage3}
          </div>
        ) : '-'}
      </td>
      <td>
        {(() => {
          let fileUploadId = null;
          let fileUploadName = null;
          let fileFieldName = null;

          const rawJson = violation.FileUpload || violation.EHSFileName;
          if (rawJson) {
            try {
              const fileInfo = JSON.parse(rawJson);
              fileUploadId = fileInfo.fileId;
              fileUploadName = fileInfo.fileName;
              fileFieldName = violation.FileUpload ? 'FileUpload' : 'EHSFileName';
            } catch (err) {
              console.error('Error parsing file JSON:', err);
            }
          }

          return fileUploadId && fileUploadName ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <i className="fas fa-file" style={{ color: '#28a745', fontSize: '14px' }}></i>
              <button
                onClick={() => {
                  window.open(`/server/EHSViolation_function/violations/${violation.id}/file/${fileFieldName}`);
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: '#007bff',
                  fontSize: '12px',
                  textDecoration: 'underline',
                  padding: '0',
                }}
                title="Download file"
              >
                {fileUploadName}
              </button>
            </div>
          ) : (
            <span style={{ color: '#aaa', fontSize: '12px' }}>No file</span>
          );
        })()}
      </td>
    </tr>
  );
}

function EHSViolation({ userRole = 'App User', userEmail = null }) {
  const navigate = useNavigate();
  const location = useLocation();
  // Remove useParams since we don't need id-based editing
  // const { id } = useParams();

  // Sidebar state - expand EHS Management menu by default when on EHSViolation page
  const [expandedMenus, setExpandedMenus] = useState({ 3: true }); // Index 3 is EHS Management
  const [showSidebarMenu, setShowSidebarMenu] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
 
  const modulesToShow = useMemo(
    () => getSidebarModulesForUser(resolveSidebarUserEmail(userEmail), userRole),
    [userEmail, userRole]
  );

  // Resolve user email and forced contractor (avoid hook ordering issues)
  const resolvedUserEmail =
    userEmail ||
    localStorage.getItem('userEmail') ||
    sessionStorage.getItem('userEmail') ||
    '';
  const forcedContractorMap = {
    'afrindinusha@gmail.com': 'R.P.D Facility Management Services',
    'afrindinusha29@gmail.com': 'Sriram enterprises', // DB spelling
    'afrinatlin@gmail.com': 'Samuel Enterprise',
    'afrindinu14@gmail.com': 'Yashaswi Academy for Skills',
    'vaishnavi.a@buildhr.co.in': 'Yashaswi Academy for Skills',
  };
  const forcedContractor = forcedContractorMap[resolvedUserEmail.toLowerCase()] || null;

  // Toggle expandable menus
  const toggleMenu = (index) => {
    setExpandedMenus(prev => ({
      ...prev,
      [index]: !prev[index]
    }));
  };

  // Header notification state
  const recentActivities = [
    { icon: '🛡️', title: 'New EHS Violation Added', description: 'Safety violation recorded for ABC Contractors', time: '2 minutes ago' },
    { icon: '📝', title: 'Violation Updated', description: 'Stage 2 completed for XYZ Company violation', time: '5 minutes ago' },
    { icon: '🗑️', title: 'Violation Removed', description: 'Outdated violation record has been removed', time: '10 minutes ago' },
    { icon: '📊', title: 'Violation Report Generated', description: 'Monthly EHS violation report has been generated', time: '1 hour ago' }
  ];

  // User avatar for header
  const userAvatar = "https://images.pexels.com/photos/2379004/pexels-photo-2379004.jpeg?auto=compress&cs=tinysrgb&w=150";

  // Table states
  const [violations, setViolations] = useState([]);
  const [filteredViolations, setFilteredViolations] = useState([]);
  const [fetchState, setFetchState] = useState('init');
  const [fetchError, setFetchError] = useState('');
  const [selectedViolations, setSelectedViolations] = useState(new Set());
 
  // Calculate if all violations are selected
  const allSelected = filteredViolations.length > 0 && selectedViolations.size === filteredViolations.length;
  const someSelected = selectedViolations.size > 0 && selectedViolations.size < filteredViolations.length;

  // Search/filter state - simplified without mode
  const [searchFields, setSearchFields] = useState({
    ContractEmployeeID: { enabled: false, value: '' },
    DateofViolation: { enabled: false, value: '' },
    TypeofViolation: { enabled: false, value: '' },
    Stage1: { enabled: false, value: '' },
    Stage2: { enabled: false, value: '' },
    Stage3: { enabled: false, value: '' },
    Safetyviolationchallannumber: { enabled: false, value: '' },
    Contractor: { enabled: false, value: '' },
    FileUpload: { enabled: false, value: '' },
  });
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);
  const dropdownRef = useRef(null);

  const searchableFields = [
    { label: 'Contract Employee ID', field: 'ContractEmployeeID' },
    { label: 'Date of Violation', field: 'DateofViolation' },
    { label: 'Type of Violation', field: 'TypeofViolation' },
    { label: 'Stage 1', field: 'Stage1' },
    { label: 'Stage 2', field: 'Stage2' },
    { label: 'Stage 3', field: 'Stage3' },
    { label: 'Safety Violation Challan Number', field: 'Safetyviolationchallannumber' },
    { label: 'Contractor', field: 'Contractor' },
    { label: 'File Upload', field: 'FileUpload' },
  ];

  // Removed filterModes as we're using simple text/date inputs only

  // Simplified filter logic - only text/date matching
  const filteredData = useCallback(() => {
    const hasActiveFilters = Object.values(searchFields).some(field => field.enabled);
    if (!hasActiveFilters) return violations;

    return violations.filter((violation) => {
      if (!violation || typeof violation !== 'object') return false;
      return searchableFields.every(({ field }) => {
        const { enabled, value } = searchFields[field];
        if (!enabled || !value.trim()) return true;

        const violationValue = violation[field] != null ? String(violation[field]).toLowerCase() : '';
        const lowerSearchValue = value.toLowerCase();

        // For date fields, do exact date matching
        if (field === 'DateofViolation') {
          return violationValue === lowerSearchValue;
        }
       
        // For all other fields, do contains matching
        return violationValue.includes(lowerSearchValue);
      });
    });
  }, [violations, searchFields]);

  useEffect(() => {
    setFilteredViolations(filteredData());
  }, [filteredData]);

  // Handle search field toggle, mode change, and value change
  const handleFieldToggle = useCallback((field) => {
    setSearchFields((prev) => ({
      ...prev,
      [field]: { ...prev[field], enabled: !prev[field].enabled, value: !prev[field].enabled ? prev[field].value : '' },
    }));
  }, []);

  // Removed handleModeChange as we no longer use mode selection

  const handleSearchValueChange = useCallback((field, value) => {
    setSearchFields((prev) => ({
      ...prev,
      [field]: { ...prev[field], value },
    }));
  }, []);

  // Handle click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowSearchDropdown(false);
      }
    };
    if (showSearchDropdown) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showSearchDropdown]);

  // When forced contractor changes, set contractors list and form contractor
  useEffect(() => {
    if (!forcedContractor) return;
    // Ensure contractors list contains only the forced contractor
    setContractors([{ ContractorName: forcedContractor }]);
    // Ensure form is set to forced contractor
    setForm((prev) => ({ ...prev, Contractor: forcedContractor }));
  }, [forcedContractor]);

  // Form states
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingEmployees, setLoadingEmployees] = useState(false);
  const [loadingContractors, setLoadingContractors] = useState(false);

  // Searchable dropdown states for filter
  const [isEmployeeFilterDropdownOpen, setIsEmployeeFilterDropdownOpen] = useState(false);
  const [employeeFilterSearch, setEmployeeFilterSearch] = useState('');
  const [filteredEmployeesForFilter, setFilteredEmployeesForFilter] = useState([]);
  const [form, setForm] = useState({
    Contractor: forcedContractor || '',
    ContractEmployeeID: '',
    DateofViolation: '',
    TypeofViolation: '',
    Safetyviolationchallannumber: '',
    Stage1: '',
    Stage2: '',
    Stage3: '',
    _pendingFiles: {},
    _uploadErrors: {},
  });
  const [contractors, setContractors] = useState([]);
  const [employees, setEmployees] = useState([]);

  // Add state for existing violation check
  const [existingViolation, setExistingViolation] = useState(null);
  const [showExistingViolationMessage, setShowExistingViolationMessage] = useState(false);
  const [isStage2Mode, setIsStage2Mode] = useState(false);
  const [isStage3Mode, setIsStage3Mode] = useState(false);

  // Edit states
  const [isEditing, setIsEditing] = useState(false);
  const [editingViolationId, setEditingViolationId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const isFormView = isEditing || showForm;

  console.log('Component state - isEditing:', isEditing, 'editingViolationId:', editingViolationId, 'isFormView:', isFormView);

  // Remove useEffect for id-based editing
  /*
  useEffect(() => {
    if (id) {
      setIsEditing(true);
      setEditingViolationId(id);
      setShowForm(true);
    } else {
      setIsEditing(false);
      setEditingViolationId(null);
    }
  }, [id]);
  */

  // Filter employees based on selected contractor
  const getFilteredEmployees = () => {
    if (!form.Contractor) {
      return employees;
    }
 
    return employees.filter(employee => {
      const employeeContractor = employee.contractor ||
                                employee.Contractor ||
                                employee.contractorName ||
                                employee.ContractorName;
   
      return employeeContractor === form.Contractor;
    });
  };

  // Check for existing violations
  const checkExistingViolation = useCallback(async (employeeId) => {
    if (!employeeId) {
      setExistingViolation(null);
      setShowExistingViolationMessage(false);
      setIsStage2Mode(false);
      setIsStage3Mode(false);
      return;
    }

    try {
      const response = await axios.get(`/server/EHSViolation_function/violations?employeeId=${employeeId}`, { timeout: 5000 });
      if (response?.data?.data?.violations && response.data.data.violations.length > 0) {
        const existing = response.data.data.violations[0];
        setExistingViolation(existing);
        setShowExistingViolationMessage(true);
        setIsStage2Mode(!!existing.Stage1);
        setIsStage3Mode(!!existing.Stage2);
      } else {
        setExistingViolation(null);
        setShowExistingViolationMessage(false);
        setIsStage2Mode(false);
        setIsStage3Mode(false);
      }
    } catch (err) {
      console.error('Error checking existing violation:', err);
      setExistingViolation(null);
      setShowExistingViolationMessage(false);
      setIsStage2Mode(false);
      setIsStage3Mode(false);
    }
  }, []);

  // Handle "Click Here" button
  const handleClickHere = () => {
    console.log('Click Here clicked, existingViolation:', existingViolation);
    // Check if all 3 stages are completed
    const allStagesCompleted = existingViolation &&
                               existingViolation.Stage1 &&
                               existingViolation.Stage2 &&
                               existingViolation.Stage3;
                             
    if (allStagesCompleted) {
      // Show popup message for completed violation
      alert('The person violation successfully completed');
      return;
    }
   
    if (existingViolation) {
      console.log('Setting form data for editing...');
      setForm({
        Contractor: forcedContractor || existingViolation.Contractor || '',
        ContractEmployeeID: existingViolation.ContractEmployeeID || '',
        DateofViolation: existingViolation.DateofViolation || '',
        TypeofViolation: existingViolation.TypeofViolation || '',
        Safetyviolationchallannumber: existingViolation.Safetyviolationchallannumber || '',
        Stage1: existingViolation.Stage1 || '',
        Stage2: existingViolation.Stage2 || '',
        Stage3: existingViolation.Stage3 || '',
        _pendingFiles: {},
        _uploadErrors: {},
      });
      setExistingViolation(null);
      setShowExistingViolationMessage(false);
      setIsStage2Mode(!!existingViolation.Stage1);
      setIsStage3Mode(!!existingViolation.Stage2);
      setIsEditing(true);
      setEditingViolationId(existingViolation.id);
      setShowForm(true);
      console.log('Form data set, edit mode activated');
    } else {
      console.error('No existing violation found to edit');
    }
  };

  // Handle new violation submission
  const handleNewViolationSubmit = async (e) => {
    e.preventDefault();
 
    if (!form.ContractEmployeeID.trim()) {
      setFormError('Contract Employee ID is required');
      return;
    }
    if (!form.Stage1.trim()) {
      setFormError('Stage 1 is required');
      return;
    }

    setSubmitting(true);
    setFormError('');

    try {
      const data = {
        Contractor: form.Contractor,
        ContractEmployeeID: form.ContractEmployeeID,
        DateofViolation: form.DateofViolation,
        TypeofViolation: form.TypeofViolation,
        Safetyviolationchallannumber: form.Safetyviolationchallannumber,
        Stage1: form.Stage1,
      };

      const response = await axios.post('/server/EHSViolation_function/violations', data, {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      });

      if (response?.data?.data?.violation) {
        const violationId = response.data.data.violation.id;
        const pendingFiles = form._pendingFiles || {};
        const uploadErrors = {};
     
        for (const key of Object.keys(pendingFiles)) {
          const file = pendingFiles[key];
          if (!file) continue;
       
          const formData = new FormData();
          formData.append('file', file);
       
          try {
            const uploadResp = await axios.post(`/server/EHSViolation_function/violations/${violationId}/upload/${key}`, formData, {
              headers: { 'Content-Type': 'multipart/form-data' },
              timeout: 20000,
            });
            console.log(`File uploaded successfully: ${file.name}`);
            // Optimistically update the local table so the file shows immediately
            const uploadedField = uploadResp?.data?.data?.field || key;
            const uploadedInfo = uploadResp?.data?.data?.fileInfo;
            if (uploadedInfo && uploadedField) {
              const jsonString = JSON.stringify(uploadedInfo);
              setViolations(prev => prev.map(v => v.id === violationId ? { ...v, [uploadedField]: jsonString } : v));
              setFilteredViolations(prev => prev.map(v => v.id === violationId ? { ...v, [uploadedField]: jsonString } : v));
            }
          } catch (err) {
            uploadErrors[key] = err.response?.data?.message || 'Upload failed.';
          }
        }
     
        if (Object.keys(uploadErrors).length > 0) {
          // Preserve upload errors but do not block saving the violation record
          setForm(prev => ({ ...prev, _uploadErrors: uploadErrors }));
        }

        setShowForm(false);
        fetchViolations();
      }
    } catch (err) {
      const errorMessage = err.response?.data?.message || 'Failed to submit violation.';
      setFormError(errorMessage);
      console.error('Submit violation error:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const fetchContractors = useCallback(() => {
    setLoadingContractors(true);
    // If restricted, skip API and set only the forced contractor
    if (forcedContractor) {
      setContractors([{ ContractorName: forcedContractor }]);
      setLoadingContractors(false);
      return;
    }
    axios
      .get('/server/Contracters_function/contractors', { timeout: 5000 })
      .then((response) => {
        if (response?.data?.data?.contractors) {
          setContractors(response.data.data.contractors);
        }
        setLoadingContractors(false);
      })
      .catch((err) => {
        console.error('Fetch contractors error:', err);
        setLoadingContractors(false);
      });
  }, [forcedContractor]);

  const fetchEmployees = useCallback(() => {
    console.log('Starting employee fetch...');
    setLoadingEmployees(true);
   
    // Build params for contractor filtering
    const params = {};
    if (userRole && userEmail) {
      params.userRole = userRole;
      params.userEmail = userEmail;
      // If contractor is forced, include as hint
      if (forcedContractor) params.contractor = forcedContractor;
    }
   
    Promise.all([
      axios.get('/server/candidate_function/candidates', { timeout: 10000 }),
      axios.get('/server/cms_function/employees', { params, timeout: 10000 }),
      axios.get('/server/cms_function/employees', { params, timeout: 10000 }).catch(() => null),
      axios.get('/server/cms_function/employees', { params, timeout: 10000 }).catch(() => null)
    ])
      .then(([candidatesResponse, employeesResponse, employeesResponse2, employeesResponse3]) => {
        const candidates = candidatesResponse?.data?.data?.candidates || [];
        const employees = employeesResponse?.data?.data?.employees || [];
        const employees2 = employeesResponse2?.data?.data?.employees || [];
        const employees3 = employeesResponse3?.data?.data?.employees || [];
        const fetchedEmployees = [...employees, ...employees2, ...employees3];
     
        console.log('Fetched employees from all sources:', fetchedEmployees.length);
        console.log('Fetched candidates:', candidates.length);
     
        const allEmployees = [
          ...fetchedEmployees.map(emp => ({
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
     
        console.log('Combined employees:', uniqueEmployees);
        console.log('Total employee codes found:', uniqueEmployees.length);
        setEmployees(uniqueEmployees);
        setLoadingEmployees(false);
      })
      .catch((err) => {
        console.error('Fetch employees error:', err);
        Promise.all([
          axios.get('/server/candidate_function/candidates', { timeout: 5000 }),
          axios.get('/server/cms_function/employees', { timeout: 5000 }).catch(() => null),
          axios.get('/server/cms_function/employees', { timeout: 5000 }).catch(() => null)
        ])
          .then(([candidatesResponse, employeesResponse1, employeesResponse2]) => {
            const candidates = candidatesResponse?.data?.data?.candidates || [];
            const employees1 = employeesResponse1?.data?.data?.employees || [];
            const employees2 = employeesResponse2?.data?.data?.employees || [];
            const allEmployees = [...employees1, ...employees2];
         
            console.log('Fallback employees found:', allEmployees.length);
            console.log('Fallback candidates found:', candidates.length);
         
            const combined = [
              ...allEmployees.map(emp => ({
                ...emp,
                type: 'employee',
                contractEmployeeID: emp.employeeCode || emp.EmployeeCode || emp.id,
                employeeCode: emp.employeeCode || emp.EmployeeCode || emp.id
              })),
              ...candidates.map(cand => ({
                ...cand,
                type: 'candidate',
                contractEmployeeID: cand.ContractEmployeeID || cand.id
              }))
            ];
         
            const uniqueCombined = combined.filter((emp, index, self) => {
              const employeeCode = emp.employeeCode || emp.contractEmployeeID || emp.ContractEmployeeID || emp.id;
              return self.findIndex(e => (e.employeeCode || e.contractEmployeeID || e.ContractEmployeeID || e.id) === employeeCode) === index;
            });
         
            console.log('Total fallback employee codes:', uniqueCombined.length);
            setEmployees(uniqueCombined);
            setLoadingEmployees(false);
          })
          .catch((fallbackErr) => {
            console.error('All employee fetch attempts failed:', fallbackErr);
            axios.get('/server/candidate_function/candidates', { timeout: 5000 })
              .then((response) => {
                if (response?.data?.data?.candidates) {
                  const candidates = response.data.data.candidates.map(cand => ({
                    ...cand,
                    type: 'candidate',
                    contractEmployeeID: cand.ContractEmployeeID || cand.id
                  }));
                  console.log('Final fallback - candidates only:', candidates.length);
                  setEmployees(candidates);
                  setLoadingEmployees(false);
                }
              })
              .catch((candErr) => {
                console.error('Fetch candidates error:', candErr);
              });
          });
      });
  }, [userRole, userEmail]);

  // Remove fetchViolation since we don't need to fetch by id
  /*
  const fetchViolation = useCallback(() => {
    ...
  }, [id]);
  */

  const fetchViolations = useCallback(() => {
    setFetchState('loading');
    setFetchError('');
    axios
      .get('/server/EHSViolation_function/violations', { timeout: 5000 })
      .then((response) => {
        if (!response?.data?.data?.violations) {
          throw new Error('Unexpected API response structure');
        }
        const fetchedViolations = response.data.data.violations || [];
        if (!Array.isArray(fetchedViolations)) {
          throw new Error('Violations data is not an array');
        }
     
        setViolations(fetchedViolations);
        setFilteredViolations(fetchedViolations);
        setFetchState('fetched');
      })
      .catch((err) => {
        console.error('Fetch violations error:', err);
        let errorMessage = 'Failed to fetch violations. Please try again later.';
     
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
    console.log('useEffect triggered - isFormView:', isFormView, 'isEditing:', isEditing);
    if (isFormView) {
      console.log('Loading form data...');
      fetchContractors();
      fetchEmployees();
      // Remove fetchViolation call since we're not using id-based editing
    } else {
      console.log('Loading violations list...');
      fetchViolations();
    }
  }, [fetchContractors, fetchEmployees, fetchViolations, isFormView, isEditing]);

  // Fetch employees and contractors when filter dropdown is opened
  useEffect(() => {
    if (showSearchDropdown) {
      if (employees.length === 0) {
        fetchEmployees();
      }
      if (contractors.length === 0) {
        fetchContractors();
      }
    }
  }, [showSearchDropdown, employees.length, contractors.length, fetchEmployees, fetchContractors]);

  // Filter employees based on search for filter dropdown
  useEffect(() => {
    if (employeeFilterSearch.trim() === '') {
      setFilteredEmployeesForFilter(employees);
    } else {
      const filtered = employees.filter(employee => {
        const employeeCode = employee.employeeCode ||
                           employee.EmployeeCode ||
                           employee.contractEmployeeID ||
                           employee.ContractEmployeeID ||
                           employee.id;
       
        const employeeName = employee.employeeName ||
                           employee.EmployeeName ||
                           employee.name ||
                           employee.displayName ||
                           'Unknown';
       
        const searchTerm = employeeFilterSearch.toLowerCase();
        return employeeCode.toLowerCase().includes(searchTerm) ||
               employeeName.toLowerCase().includes(searchTerm);
      });
      setFilteredEmployeesForFilter(filtered);
    }
  }, [employeeFilterSearch, employees]);

  // Handle click outside to close employee filter dropdown
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (!event.target.closest('[data-employee-filter-dropdown]')) {
        setIsEmployeeFilterDropdownOpen(false);
      }
    };
    if (isEmployeeFilterDropdownOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isEmployeeFilterDropdownOpen]);

  // Handle employee selection from searchable dropdown
  const handleEmployeeFilterSelect = (employeeCode) => {
    setEmployeeFilterSearch('');
    setIsEmployeeFilterDropdownOpen(false);
    handleSearchValueChange('ContractEmployeeID', employeeCode);
  };

  // Form handlers
  const handleInputChange = (e) => {
    const { name, value, type, files } = e.target;
    setForm(prev => ({
      ...prev,
      [name]: type === 'file' ? files[0] : value
    }));
 
    if (name === 'Contractor') {
      setForm(prev => ({
        ...prev,
        ContractEmployeeID: ''
      }));
    }
  };

  const handleEmployeeChange = (e) => {
    const { value } = e.target;
    console.log('Selected value:', value);
    console.log('Available employees:', employees);
 
    const selectedEmployee = employees.find(emp =>
      emp.id === value ||
      emp.contractEmployeeID === value ||
      emp.employeeCode === value ||
      emp.EmployeeCode === value
    );
 
    console.log('Selected employee:', selectedEmployee);
 
    if (selectedEmployee) {
      const employeeCode = selectedEmployee.employeeCode ||
                          selectedEmployee.EmployeeCode ||
                          selectedEmployee.contractEmployeeID ||
                          selectedEmployee.ContractEmployeeID ||
                          selectedEmployee.id;
   
      console.log('Setting ContractEmployeeID to:', employeeCode);
   
      setForm(prev => ({
        ...prev,
        ContractEmployeeID: employeeCode
      }));
   
      checkExistingViolation(employeeCode);
    } else {
      setForm(prev => ({
        ...prev,
        ContractEmployeeID: value
      }));
   
      checkExistingViolation(value);
    }
  };

  const handleFileSelect = (file) => {
    if (file.size > 5 * 1024 * 1024) {
      setForm(prev => ({
        ...prev,
        _uploadErrors: { ...prev._uploadErrors, EHSFileName: 'File size must be less than 5MB' }
      }));
      return;
    }
 
    const allowedTypes = ['.pdf', '.jpg', '.jpeg', '.png', '.doc', '.docx'];
    const fileExtension = '.' + file.name.split('.').pop().toLowerCase();
    if (!allowedTypes.includes(fileExtension)) {
      setForm(prev => ({
        ...prev,
        _uploadErrors: { ...prev._uploadErrors, EHSFileName: 'Invalid file type. Allowed: PDF, JPG, PNG, DOC, DOCX' }
      }));
      return;
    }
 
    setForm(prev => ({
      ...prev,
      _pendingFiles: { ...prev._pendingFiles, EHSFileName: file },
      _uploadErrors: { ...prev._uploadErrors, EHSFileName: undefined },
      FileFieldName: 'EHSFileName'
    }));
  };

  const removePendingFile = () => {
    setForm(prev => ({
      ...prev,
      _pendingFiles: { ...prev._pendingFiles, EHSFileName: undefined },
      _uploadErrors: { ...prev._uploadErrors, EHSFileName: undefined },
      FileFieldName: undefined,
      FileUploadId: undefined,
      FileUploadName: undefined
    }));
  };

  const validateForm = () => {
    if (!form.ContractEmployeeID.trim()) {
      return 'Contract Employee ID is required';
    }
    if (!form.Stage1.trim()) {
      return 'Stage 1 is required';
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

    try {
      const data = {
        Contractor: form.Contractor,
        ContractEmployeeID: form.ContractEmployeeID,
        DateofViolation: form.DateofViolation,
        TypeofViolation: form.TypeofViolation,
        Safetyviolationchallannumber: form.Safetyviolationchallannumber,
        Stage1: form.Stage1,
        Stage2: form.Stage2,
        Stage3: form.Stage3,
      };

      const url = isEditing && editingViolationId
        ? `/server/EHSViolation_function/violations/${editingViolationId}`
        : '/server/EHSViolation_function/violations';
   
      const method = isEditing && editingViolationId ? 'put' : 'post';
   
      console.log('Submitting violation:', { url, method, data, editingViolationId });
   
      const response = await axios[method](url, data, {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      });

      if (response?.data?.data?.violation) {
        const violationId = response.data.data.violation.id;
        const pendingFiles = form._pendingFiles || {};
        const uploadErrors = {};
     
        for (const key of Object.keys(pendingFiles)) {
          const file = pendingFiles[key];
          if (!file) continue;
       
          const formData = new FormData();
          formData.append('file', file);
       
          try {
            const uploadResp = await axios.post(`/server/EHSViolation_function/violations/${violationId}/upload/${key}`, formData, {
              headers: { 'Content-Type': 'multipart/form-data' },
              timeout: 20000,
            });
            console.log(`File uploaded successfully: ${file.name}`);
            // Optimistically update the local table so the file shows immediately
            const uploadedField = uploadResp?.data?.data?.field || key;
            const uploadedInfo = uploadResp?.data?.data?.fileInfo;
            if (uploadedInfo && uploadedField) {
              const jsonString = JSON.stringify(uploadedInfo);
              setViolations(prev => prev.map(v => v.id === violationId ? { ...v, [uploadedField]: jsonString } : v));
              setFilteredViolations(prev => prev.map(v => v.id === violationId ? { ...v, [uploadedField]: jsonString } : v));
            }
          } catch (err) {
            uploadErrors[key] = err.response?.data?.message || 'Upload failed.';
          }
        }
     
        if (Object.keys(uploadErrors).length > 0) {
          // Preserve upload errors but continue closing the form; record is saved
          setForm(prev => ({ ...prev, _uploadErrors: uploadErrors }));
        }

        setShowForm(false);
        setIsStage2Mode(false);
        setIsStage3Mode(false);
        if (isEditing) {
          setIsEditing(false);
          setEditingViolationId(null);
        }
        fetchViolations();
      }
    } catch (err) {
      const errorMessage = err.response?.data?.message ||
        (isEditing && editingViolationId ? 'Failed to update violation.' : 'Failed to submit violation.');
      setFormError(errorMessage);
      console.error('Submit violation error:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleReset = () => {
    setForm({
      Contractor: forcedContractor || '',
      ContractEmployeeID: '',
      DateofViolation: '',
      TypeofViolation: '',
      Safetyviolationchallannumber: '',
      Stage1: '',
      Stage2: '',
      Stage3: '',
      _pendingFiles: {},
      _uploadErrors: {},
    });
    setFormError('');
    setExistingViolation(null);
    setShowExistingViolationMessage(false);
    setIsStage2Mode(false);
    setIsStage3Mode(false);
    if (isEditing) {
      setIsEditing(false);
      setEditingViolationId(null);
      navigate('/EHSViolation');
    }
    if (!isEditing) {
      setShowForm(false);
    }
  };

  const handleBack = () => {
    if (isEditing || isStage2Mode || isStage3Mode) {
      navigate('/EHSViolation');
      setIsEditing(false);
      setEditingViolationId(null);
      setShowForm(false);
    } else {
      setShowForm(false);
    }
  };

  const toggleForm = () => {
    setShowForm(prev => !prev);
    if (!showForm) {
      // Opening form - reset for new violation
      setFormError('');
      setExistingViolation(null);
      setShowExistingViolationMessage(false);
      setIsStage2Mode(false);
      setIsStage3Mode(false);
      setIsEditing(false);
      setEditingViolationId(null);
      setForm({
        Contractor: '',
        ContractEmployeeID: '',
        DateofViolation: '',
        TypeofViolation: '',
        Safetyviolationchallannumber: '',
        Stage1: '',
        Stage2: '',
        Stage3: '',
        _pendingFiles: {},
        _uploadErrors: {},
      });
    } else {
      // Closing form
      setIsEditing(false);
      setEditingViolationId(null);
    }
  };

  const removeViolation = async (id) => {
    try {
      await axios.delete(`/server/EHSViolation_function/violations/${id}`, { timeout: 5000 });
      fetchViolations();
      if (editingViolationId === id) {
        setIsEditing(false);
        setEditingViolationId(null);
        navigate('/EHSViolation');
      }
    } catch (err) {
      const errorMessage = err.response?.data?.message || 'Failed to delete violation.';
      console.error('Delete violation error:', err);
    }
  };

  // Modified editViolation function
  const editViolation = (violation) => {
    console.log('Editing violation:', violation);
    setIsEditing(true);
    setEditingViolationId(violation.id);
    setShowForm(true);
   
    // Directly populate the form with the violation data
    let fileUploadId = null;
    let fileUploadName = null;
    let fileFieldName = null;
    const rawJson = violation.FileUpload || violation.EHSFileName;
    if (rawJson) {
      try {
        const fileInfo = JSON.parse(rawJson);
        fileUploadId = fileInfo.fileId;
        fileUploadName = fileInfo.fileName;
        fileFieldName = violation.FileUpload ? 'FileUpload' : 'EHSFileName';
      } catch (err) {
        console.error('Error parsing file JSON:', err);
      }
    }
   
    setForm({
      Contractor: violation.Contractor || '',
      ContractEmployeeID: violation.ContractEmployeeID || '',
      DateofViolation: violation.DateofViolation || '',
      TypeofViolation: violation.TypeofViolation || '',
      Safetyviolationchallannumber: violation.Safetyviolationchallannumber || '',
      Stage1: violation.Stage1 || '',
      Stage2: violation.Stage2 || '',
      Stage3: violation.Stage3 || '',
      FileUploadId: fileUploadId,
      FileUploadName: fileUploadName,
      FileFieldName: fileFieldName,
      _pendingFiles: {},
      _uploadErrors: {},
    });
   
    setIsStage2Mode(!!violation.Stage1);
    setIsStage3Mode(!!violation.Stage2);
    console.log('Form populated for editing, isEditing:', true, 'editingViolationId:', violation.id);
  };

  const handleCheckboxChange = (violationId, isChecked) => {
    setSelectedViolations(prev => {
      const newSelected = new Set(prev);
      if (isChecked) {
        newSelected.add(violationId);
      } else {
        newSelected.delete(violationId);
      }
      return newSelected;
    });
  };

  const handleSelectAll = useCallback(() => {
    if (allSelected) {
      // If all are selected, deselect all
      setSelectedViolations(new Set());
    } else {
      // If not all are selected, select all
      const allIds = filteredViolations.map(violation => violation.id);
      setSelectedViolations(new Set(allIds));
    }
  }, [allSelected, filteredViolations]);

  const handleDeleteSelected = async () => {
    if (selectedViolations.size === 0) return;
 
    const confirmed = window.confirm(`Are you sure you want to delete ${selectedViolations.size} selected violation(s)?`);
    if (!confirmed) return;

    try {
      const deletePromises = Array.from(selectedViolations).map(id =>
        axios.delete(`/server/EHSViolation_function/violations/${id}`, { timeout: 5000 })
      );
   
      await Promise.all(deletePromises);
      if (selectedViolations.has(editingViolationId)) {
        setIsEditing(false);
        setEditingViolationId(null);
        navigate('/EHSViolation');
      }
      setSelectedViolations(new Set());
      fetchViolations();
    } catch (err) {
      console.error('Delete violations error:', err);
      setTimeout(() => {
      }, 3000);
    }
  };

  const columns = [
    { label: 'Select', field: null },
    { label: 'Edit', field: null },
    { label: '#', field: null },
    { label: 'Contractor', field: 'Contractor' },
    { label: 'Contract Employee ID', field: 'ContractEmployeeID' },
    { label: 'Date of Violation', field: 'DateofViolation' },
    { label: 'Type of Violation', field: 'TypeofViolation' },
    { label: 'Safety Violation Challan Number', field: 'Safetyviolationchallannumber' },
    { label: 'Stage 1', field: 'Stage1' },
    { label: 'Stage 2', field: 'Stage2' },
    { label: 'Stage 3', field: 'Stage3' },
    { label: 'Files', field: null },
  ];

 

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

          {/* EHS Violation Content */}
          <main className="cms-dashboard-content">
            {isFormView ? (
              <div className="employee-form-page">
                <div className="employee-form-container">
                  <div className="employee-form-header">
                    <h1>
                      <i className="fas fa-shield-alt"></i>
            {isEditing || isStage2Mode || isStage3Mode || (existingViolation && !showExistingViolationMessage)
              ? (isStage3Mode ? 'Add Stage 3 to EHS Violation' : 'Add Stage 2 to EHS Violation')
              : 'Add New EHS Violation (Stage 1)'}
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

        <form onSubmit={isEditing || isStage2Mode || isStage3Mode || (existingViolation && !showExistingViolationMessage) ? handleSubmit : handleNewViolationSubmit}>
                        {/* Basic Info Card */}
                        <div className="form-section-card employee-info">
                          <h2 className="section-title">Basic Information</h2>
                          <div className="form-grid">
                            <div className="form-group">
                              <label>Contractor</label>
              <select
                name="Contractor"
                value={form.Contractor || forcedContractor || ''}
                onChange={handleInputChange}
                                className="input"
                disabled={!!forcedContractor}
              >
                {!forcedContractor && <option value="">-Select-</option>}
                {(forcedContractor ? [{ ContractorName: forcedContractor }] : contractors).map((contractor, index) => (
                  <option key={index} value={contractor.ContractorName}>
                    {contractor.ContractorName}
                  </option>
                ))}
              </select>
            </div>

                            <div className="form-group">
                              <label>Contract Employee ID<span className="required">*</span></label>
              <select
                id="employee-dropdown"
                name="ContractEmployeeID"
                value={form.ContractEmployeeID}
                onChange={handleEmployeeChange}
                                className="input"
                required
                disabled={loadingEmployees}
              >
                <option value="">
                  {loadingEmployees ? 'Loading employees...' : '-Select Employee Code-'}
                </option>
                {getFilteredEmployees().map((employee, index) => {
                  const employeeCode = employee.employeeCode ||
                                     employee.EmployeeCode ||
                                     employee.contractEmployeeID ||
                                     employee.ContractEmployeeID ||
                                     employee.id;
                 
                  const employeeName = employee.employeeName ||
                                      employee.EmployeeName ||
                                      employee.name ||
                                      employee.displayName ||
                                      'Unknown';
             
                  return (
                    <option key={employeeCode} value={employeeCode}>
                      {employeeCode} - {employeeName}
                    </option>
                  );
                })}
              </select>
              {loadingEmployees ? (
                <div style={{ marginTop: '8px', padding: '8px', backgroundColor: '#e3f2fd', borderRadius: '4px', fontSize: '12px', color: '#1976d2' }}>
                  <i className="fas fa-spinner fa-spin" style={{ marginRight: '8px' }}></i>
                  Loading employees...
                </div>
              ) : getFilteredEmployees().length > 0 ? (
                <div style={{ marginTop: '8px', padding: '8px', backgroundColor: '#f8f9fa', borderRadius: '4px', fontSize: '12px' }}>
                  {form.Contractor ? `Found ${getFilteredEmployees().length} employee(s) for ${form.Contractor}` : 'Select a contractor to see employees'}
                </div>
              ) : null}
              {form.Contractor && getFilteredEmployees().length === 0 && (
                <div style={{ marginTop: '8px', padding: '8px', backgroundColor: '#fff3cd', border: '1px solid #ffeaa7', borderRadius: '4px', fontSize: '12px', color: '#856404' }}>
                  No employees found for {form.Contractor}
                </div>
              )}
           
              {showExistingViolationMessage && existingViolation && !isEditing && (
                <div style={{
                  marginTop: '8px',
                  padding: '8px 12px',
                  backgroundColor: '#fff3cd',
                  border: '1px solid #ffeaa7',
                  borderRadius: '4px',
                  fontSize: '12px',
                  color: '#856404',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between'
                }}>
                  <span>
                    {existingViolation.Stage1 && existingViolation.Stage2 && existingViolation.Stage3
                      ? 'This Workmen ID Already have a completed violation.'
                      : `This Workmen ID Already have a violation. Click here to add ${existingViolation.Stage2 ? 'Stage 3' : 'Stage 2'}.`}
                  </span>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      type="button"
                      onClick={handleClickHere}
                      style={{
                        backgroundColor: '#ff6b35',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        padding: '4px 8px',
                        fontSize: '11px',
                        cursor: 'pointer',
                        fontWeight: '600'
                      }}
                      onMouseEnter={(e) => {
                        e.target.style.backgroundColor = '#e55a2b';
                      }}
                      onMouseLeave={(e) => {
                        e.target.style.backgroundColor = '#ff6b35';
                      }}
                    >
                      Click Here
                    </button>
                  </div>
                </div>
              )}
            </div>

                            <div className="form-group">
                              <label>Date of Violation</label>
              <input
                type="date"
                name="DateofViolation"
                value={form.DateofViolation}
                onChange={handleInputChange}
                                className="input"
                placeholder="dd-MMM-yyyy"
              />
            </div>

                            <div className="form-group">
                              <label>Type of Violation</label>
                              <div className="radio-group">
                                <label className="radio-label">
                  <input
                    type="radio"
                    name="TypeofViolation"
                    value="Minor"
                    checked={form.TypeofViolation === 'Minor'}
                    onChange={handleInputChange}
                                    className="radio-input"
                  />
                  Minor
                </label>
                                <label className="radio-label">
                  <input
                    type="radio"
                    name="TypeofViolation"
                    value="Major"
                    checked={form.TypeofViolation === 'Major'}
                    onChange={handleInputChange}
                                    className="radio-input"
                  />
                  Major
                </label>
              </div>
            </div>

                            <div className="form-group">
                              <label>Safety violation challan number</label>
              <input
                type="text"
                name="Safetyviolationchallannumber"
                value={form.Safetyviolationchallannumber}
                onChange={handleInputChange}
                                className="input"
                placeholder="#######"
              />
                            </div>
            </div>
          </div>

                        {/* Stage 1 Card */}
                        <div className="form-section-card work-info">
                          <h2 className="section-title">Stage 1<span className="required">*</span></h2>
                          <div className="form-grid">
                            <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                              <label>Stage 1 Details</label>
            <textarea
              name="Stage1"
              value={form.Stage1}
              onChange={handleInputChange}
                                className="input"
              placeholder="Enter detailed information about the violation..."
              required
                                style={{ minHeight: '120px', resize: 'vertical' }}
            />
                            </div>
                          </div>
          </div>

                        {/* Stage 2 Card - Only show when editing or in stage 2 mode */}
          {(isEditing || isStage2Mode || (existingViolation && !showExistingViolationMessage)) && (
                          <div className="form-section-card personal-info">
                            <h2 className="section-title">Stage 2</h2>
                            <div className="form-grid">
                              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                                <label>Stage 2 Details</label>
              <textarea
                name="Stage2"
                value={form.Stage2}
                onChange={handleInputChange}
                                  className="input"
                placeholder="Enter Stage 2 information about the violation..."
                                  style={{ minHeight: '120px', resize: 'vertical' }}
              />
                              </div>
                            </div>
            </div>
          )}

                        {/* Stage 3 Card - Only show when in stage 3 mode */}
          {isStage3Mode && (
                          <div className="form-section-card identity-info">
                            <h2 className="section-title">Stage 3</h2>
                            <div className="form-grid">
                              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                                <label>Stage 3 Details</label>
              <textarea
                name="Stage3"
                value={form.Stage3}
                onChange={handleInputChange}
                                  className="input"
                placeholder="Enter Stage 3 information about the violation..."
                                  style={{ minHeight: '120px', resize: 'vertical' }}
              />
                              </div>
                            </div>
            </div>
          )}

                        {/* Documents Card */}
                        <div className="form-section-card address-details">
                          <h2 className="section-title">Documents</h2>
                          <div className="form-grid">
                            <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                              <label>Upload Documents</label>
          {form._pendingFiles?.EHSFileName ? (
                                <div className="file-preview">
              <span className="file-preview-name">{form._pendingFiles.EHSFileName.name}</span>
              <button
                type="button"
                onClick={removePendingFile}
                                    className="file-preview-remove"
                disabled={submitting}
              >
                Remove
              </button>
            </div>
          ) : form.FileUploadId && form.FileUploadName && isEditing ? (
                                <div className="file-preview">
                                  <span className="file-preview-name">{form.FileUploadName}</span>
              <button
                type="button"
                onClick={() => {
                  window.open(`/server/EHSViolation_function/violations/${editingViolationId}/file/${form.FileFieldName || 'EHSFileName'}`);
                }}
                                    className="file-download-btn"
                disabled={submitting}
              >
                Download
              </button>
              <button
                type="button"
                onClick={removePendingFile}
                                    className="file-preview-remove"
                disabled={submitting}
              >
                Remove
              </button>
            </div>
          ) : (
                                <label className="file-upload-container">
              <input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                                    className="file-upload-input"
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) {
                    handleFileSelect(e.target.files[0]);
                    e.target.value = '';
                  }
                }}
                disabled={submitting}
              />
                                  <div className="file-upload-icon">
                <i className="fas fa-cloud-upload-alt"></i>
              </div>
                                  <div className="file-upload-text">Click to upload or drag and drop</div>
                                  <div className="file-upload-hint">PDF, JPG, PNG, DOC, DOCX (max 5MB)</div>
            </label>
          )}
          {form._uploadErrors?.EHSFileName && (
                                <div className="file-error">{form._uploadErrors.EHSFileName}</div>
          )}
                            </div>
                          </div>
          </div>

                        <div className="form-actions">
            <button
              type="submit"
              disabled={submitting}
                            className="btn btn-primary"
            >
              {submitting ? 'Submitting...' : (isStage3Mode ? 'Update with Stage 3' : isStage2Mode ? 'Update with Stage 2' : 'Submit Stage 1')}
            </button>
            <button
              type="button"
              onClick={handleReset}
                            className="btn btn-secondary"
            >
              Reset
            </button>
            <button
              type="button"
              onClick={handleBack}
                            className="btn btn-secondary"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
      </div>
                  </div>
                </div>
              ) : (
            <div
              className="ehs-card-container"
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
                <div className="ehs-header-actions">
                  <div className="ehs-title-section">
                    <h2 className="ehs-title">
                      <Shield size={28} />
                      EHS Violation Directory
                    </h2>
                    <p className="ehs-subtitle">
                      Manage your organization's EHS violations efficiently
                    </p>
          </div>
            </div>
                {/* Toolbar Buttons */}
                <div className="ehs-toolbar" style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'nowrap' }}>
          {fetchState === 'error' && (
            <button
              onClick={fetchViolations}
              className="toolbar-btn toolbar-btn-secondary"
              title="Retry"
              type="button"
              style={{ background: '#fff', color: '#7c3aed', border: 'none', fontWeight: 600, padding: '8px', borderRadius: '8px', width: '48px', height: '48px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}
            >
              <RefreshCw size={22} style={{ color: '#7c3aed' }} />
            </button>
          )}
          <button
            className="toolbar-btn upload-btn"
            title="Upload violations"
            onClick={() => { console.log('Upload clicked'); }}
            type="button"
            style={{ background: '#fff', color: '#22c55e', border: 'none', fontWeight: 600, padding: '8px', borderRadius: '8px', width: '48px', height: '48px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}
          >
            <FileInput size={22} style={{ color: '#22c55e' }} />
          </button>
          <button
            className="toolbar-btn download-btn"
            title="Download violations"
            onClick={() => { console.log('Download clicked'); }}
            type="button"
            style={{ background: '#fff', color: '#2563eb', border: 'none', fontWeight: 600, padding: '8px', borderRadius: '8px', width: '48px', height: '48px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}
          >
            <FileOutput size={22} style={{ color: '#2563eb' }} />
          </button>
          <button
            className="toolbar-btn refresh-btn"
            title="Refresh data"
            onClick={fetchViolations}
            type="button"
            style={{ background: '#fff', color: '#7c3aed', border: 'none', fontWeight: 600, padding: '8px', borderRadius: '8px', width: '48px', height: '48px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}
          >
            <RefreshCw size={22} style={{ color: '#7c3aed' }} />
          </button>
          <button
            className="toolbar-btn filter-btn"
            title="Filter violations"
            onClick={() => setShowSearchDropdown(!showSearchDropdown)}
            type="button"
            style={{ background: '#fff', color: '#f97316', border: 'none', fontWeight: 600, padding: '8px', borderRadius: '8px', width: '48px', height: '48px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}
          >
            <Filter size={22} style={{ color: '#f97316' }} />
          </button>
          <button
            className="toolbar-btn add-btn"
            title="Add new violation"
            onClick={toggleForm}
            type="button"
            style={{ background: '#fff', color: '#14b8a6', border: 'none', fontWeight: 700, fontSize: '1.2rem', borderRadius: '8px', width: '48px', height: '48px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(60,72,88,0.10)' }}
          >
            <Plus size={24} style={{ color: '#14b8a6' }} />
          </button>
          {selectedViolations.size > 0 && (
            <button
              className="toolbar-btn delete-btn"
              title={`Delete ${selectedViolations.size} selected violation(s)`}
              onClick={handleDeleteSelected}
              type="button"
              style={{ background: '#fff', color: '#d32f2f', border: '2px solid #ffcdd2', fontWeight: 700, padding: '8px', borderRadius: '8px', width: '48px', height: '48px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(211,47,47,0.15)' }}
            >
              <Trash2 size={22} style={{ color: '#d32f2f' }} />
            </button>
          )}
        </div>
      </div>



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
                  backgroundColor: '#fafafa',
                  alignItems: 'flex-start'
                }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: '500', width: '100%' }}>
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
                      {field === 'DateofViolation' ? (
                        <input
                          type="date"
                          value={searchFields[field].value}
                          onChange={(e) => handleSearchValueChange(field, e.target.value)}
                          placeholder={`Enter ${label}`}
                          style={{
                            padding: '6px 8px',
                            border: '1px solid #d1d5db',
                            borderRadius: '4px',
                            fontSize: '14px',
                            backgroundColor: 'white',
                            width: '100%'
                          }}
                        />
                      ) : field === 'ContractEmployeeID' ? (
                        <div style={{ position: 'relative', width: '100%' }} data-employee-filter-dropdown>
                          <div style={{ position: 'relative' }}>
                            <input
                              type="text"
                              value={searchFields[field].value ?
                                (() => {
                                  const selectedEmployee = employees.find(emp => {
                                    const empCode = emp.employeeCode || emp.EmployeeCode || emp.contractEmployeeID || emp.ContractEmployeeID || emp.id;
                                    return empCode === searchFields[field].value;
                                  });
                                  if (selectedEmployee) {
                                    const empCode = selectedEmployee.employeeCode || selectedEmployee.EmployeeCode || selectedEmployee.contractEmployeeID || selectedEmployee.ContractEmployeeID || selectedEmployee.id;
                                    const empName = selectedEmployee.employeeName || selectedEmployee.EmployeeName || selectedEmployee.name || selectedEmployee.displayName || 'Unknown';
                                    return `${empCode} - ${empName}`;
                                  }
                                  return searchFields[field].value;
                                })()
                                : employeeFilterSearch}
                              onChange={(e) => {
                                setEmployeeFilterSearch(e.target.value);
                                setIsEmployeeFilterDropdownOpen(true);
                                // Clear the selected value when user starts typing
                                if (searchFields[field].value) {
                                  handleSearchValueChange(field, '');
                                }
                              }}
                              onFocus={() => setIsEmployeeFilterDropdownOpen(true)}
                              placeholder={loadingEmployees ? 'Loading employees...' : (searchFields[field].value ? searchFields[field].value : 'Search employee code...')}
                              disabled={loadingEmployees}
                              style={{
                                padding: '6px 30px 6px 8px',
                                border: '1px solid #d1d5db',
                                borderRadius: '4px',
                                fontSize: '14px',
                                backgroundColor: searchFields[field].value ? '#f0f8ff' : 'white',
                                width: '100%',
                                fontWeight: searchFields[field].value ? '600' : 'normal'
                              }}
                            />
                            {(employeeFilterSearch || searchFields[field].value) && (
                              <button
                                type="button"
                                onClick={() => {
                                  setEmployeeFilterSearch('');
                                  setIsEmployeeFilterDropdownOpen(false);
                                  handleSearchValueChange(field, '');
                                }}
                                style={{
                                  position: 'absolute',
                                  right: '8px',
                                  top: '50%',
                                  transform: 'translateY(-50%)',
                                  background: 'none',
                                  border: 'none',
                                  cursor: 'pointer',
                                  fontSize: '16px',
                                  color: '#6c757d'
                                }}
                                title="Clear search"
                              >
                                ×
                              </button>
                            )}
                          </div>
                          {isEmployeeFilterDropdownOpen && (
                            <div style={{
                              position: 'absolute',
                              top: '100%',
                              left: 0,
                              right: 0,
                              backgroundColor: 'white',
                              border: '1px solid #d1d5db',
                              borderRadius: '4px',
                              boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                              maxHeight: '200px',
                              overflowY: 'auto',
                              zIndex: 1000
                            }}>
                              {filteredEmployeesForFilter.length > 0 ? (
                                filteredEmployeesForFilter.map((employee, index) => {
                                  const employeeCode = employee.employeeCode ||
                                                     employee.EmployeeCode ||
                                                     employee.contractEmployeeID ||
                                                     employee.ContractEmployeeID ||
                                                     employee.id;
                                   
                                  const employeeName = employee.employeeName ||
                                                      employee.EmployeeName ||
                                                      employee.name ||
                                                      employee.displayName ||
                                                      'Unknown';
                                   
                                  return (
                                    <div
                                      key={employeeCode}
                                      onClick={() => handleEmployeeFilterSelect(employeeCode)}
                                      style={{
                                        padding: '8px 12px',
                                        cursor: 'pointer',
                                        borderBottom: '1px solid #f0f0f0',
                                        fontSize: '14px'
                                      }}
                                      onMouseEnter={(e) => {
                                        e.target.style.backgroundColor = '#f8f9fa';
                                      }}
                                      onMouseLeave={(e) => {
                                        e.target.style.backgroundColor = 'white';
                                      }}
                                    >
                                      <strong>{employeeCode}</strong> - {employeeName}
                                    </div>
                                  );
                                })
                              ) : (
                                <div style={{
                                  padding: '8px 12px',
                                  color: '#6c757d',
                                  fontSize: '14px',
                                  textAlign: 'center'
                                }}>
                                  {loadingEmployees ? 'Loading...' : 'No employees found'}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ) : field === 'Contractor' ? (
                        <select
                          value={searchFields[field].value}
                          onChange={(e) => handleSearchValueChange(field, e.target.value)}
                          disabled={loadingContractors}
                          style={{
                            padding: '6px 8px',
                            border: '1px solid #d1d5db',
                            borderRadius: '4px',
                            fontSize: '14px',
                            backgroundColor: 'white',
                            width: '100%'
                          }}
                        >
                          <option value="">
                            {loadingContractors ? 'Loading contractors...' : '-Select Contractor-'}
                          </option>
                          {contractors.map((contractor, index) => (
                            <option key={index} value={contractor.ContractorName}>
                              {contractor.ContractorName}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          value={searchFields[field].value}
                          onChange={(e) => handleSearchValueChange(field, e.target.value)}
                          placeholder={`Enter ${label}`}
                          style={{
                            padding: '6px 8px',
                            border: '1px solid #d1d5db',
                            borderRadius: '4px',
                            fontSize: '14px',
                            backgroundColor: 'white',
                            width: '100%'
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
                    ContractEmployeeID: { enabled: false, value: '' },
                    DateofViolation: { enabled: false, value: '' },
                    TypeofViolation: { enabled: false, value: '' },
                    Stage1: { enabled: false, value: '' },
                    Stage2: { enabled: false, value: '' },
                    Stage3: { enabled: false, value: '' },
                    Safetyviolationchallannumber: { enabled: false, value: '' },
                    Contractor: { enabled: false, value: '' },
                    FileUpload: { enabled: false, value: '' },
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

      {fetchState === 'loading' && (
        <div style={{ textAlign: 'center', padding: '40px' }}>
          Loading violations...
        </div>
      )}

      {fetchState === 'error' && (
        <div style={{ textAlign: 'center', padding: '40px', color: '#dc3545' }}>
          {fetchError}
        </div>
      )}

      {fetchState === 'fetched' && filteredViolations.length > 0 && (
        <div className="violations-table-container">
          <table className={`violations-table ${selectedViolations.size === 0 ? 'edit-column-hidden' : ''}`}>
            <thead>
              <tr>
                {selectedViolations.size > 0 ? (
                  <>
                    <th>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <input
                          type="checkbox"
                          checked={allSelected}
                          ref={(input) => {
                            if (input) input.indeterminate = someSelected;
                          }}
                          onChange={handleSelectAll}
                          style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                        />
                      </div>
                    </th>
                    <th>Edit</th>
                    <th>#</th>
                    <th>Contractor</th>
                    <th>Contract Employee ID</th>
                    <th>Date of Violation</th>
                    <th>Type of Violation</th>
                    <th>Safety Violation Challan Number</th>
                    <th>Stage 1</th>
                    <th>Stage 2</th>
                    <th>Stage 3</th>
                    <th>Files</th>
                  </>
                ) : (
                  <>
                    <th>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <input
                          type="checkbox"
                          checked={allSelected}
                          ref={(input) => {
                            if (input) input.indeterminate = someSelected;
                          }}
                          onChange={handleSelectAll}
                          style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                        />
                      </div>
                    </th>
                    <th>#</th>
                    <th>Contractor</th>
                    <th>Contract Employee ID</th>
                    <th>Date of Violation</th>
                    <th>Type of Violation</th>
                    <th>Safety Violation Challan Number</th>
                    <th>Stage 1</th>
                    <th>Stage 2</th>
                    <th>Stage 3</th>
                    <th>Files</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {filteredViolations.map((violation, index) => (
                <EHSViolationRow
                  key={violation.id || index}
                  violation={violation}
                  index={index}
                  editViolation={editViolation}
                  isSelected={selectedViolations.has(violation.id)}
                  onCheckboxChange={handleCheckboxChange}
                  selectedViolations={selectedViolations}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {fetchState === 'fetched' && filteredViolations.length === 0 && (
        <div style={{ textAlign: 'center', padding: '40px', color: '#6c757d' }}>
          No violations found.
        </div>
      )}
            </div>
            )}
          </main>
        </div>
      </div>
    </>
  );
}

export default EHSViolation;
