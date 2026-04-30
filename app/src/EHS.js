import './App.css';
import './helper.css';
import './EHS.css';
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Select from 'react-select';
import axios from 'axios';
import * as XLSX from 'xlsx';
import { Link, useNavigate, useLocation } from 'react-router-dom';
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
  CalendarDays,
  Database,
  FileInput,
  FileOutput,
  Filter,
  Trash2
} from 'lucide-react';

// Helper to get candidate names from IDs
const getCandidateNames = (ids, candidates) => {
  if (!ids) return '';
  if (Array.isArray(ids)) {
    return ids.map(id => {
      const c = candidates.find(c => String(c.id) === String(id));
      return c ? c.candidateName : id;
    }).join(', ');
  }
  return ids
    .split(',')
    .map(id => {
      const c = candidates.find(c => String(c.id) === String(id));
      return c ? c.candidateName : id;
    })
    .join(', ');
};

function getStatusColor(status) {
  if (!status) return '';
  const s = status.toLowerCase();
  if (s === 'approved') return 'ehs-status-approved';
  if (s === 'rejected') return 'ehs-status-rejected';
  if (s === 'in progress') return 'ehs-status-inprogress';
  return '';
}

function EHSRow({ ehs, index, editEHS, isSelected, onSelect, candidates, onClickContractor, selectedEHS }) {
  const handleRowClick = () => {
    editEHS(ehs);
  };

  const handleCheckboxClick = (e) => {
    e.stopPropagation(); // Prevent row click when clicking checkbox
    onSelect(ehs.id);
  };

  const handleEditButtonClick = (e) => {
    e.stopPropagation(); // Prevent row click when clicking edit button
    editEHS(ehs);
  };

  const handleContractorClick = (e) => {
    e.stopPropagation(); // Prevent row click when clicking contractor button
    onClickContractor(ehs.id, ehs.contractor);
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
        <input type="checkbox" checked={isSelected} onChange={handleCheckboxClick} />
      </td>
      {selectedEHS.length > 0 && (
        <td onClick={handleEditButtonClick}>
          {isSelected && (
            <button
              className="btn btn-icon"
              onClick={handleEditButtonClick}
              title="Edit"
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
        {ehs.status ? (
          <span className={`ehs-status-box ${getStatusColor(ehs.status)}`}>
            {ehs.status}
          </span>
        ) : ''}
      </td>
      <td onClick={handleContractorClick}>
        <button
          onClick={handleContractorClick}
          className="contractor-link-btn"
          title="Click to show inducted candidates"
        >
          {ehs.contractor}
        </button>
      </td>
      <td>{ehs.inductionDate}</td>
      <td>{ehs.skills}</td>
      <td>{getCandidateNames(ehs.attendedCandidates, candidates)}</td>
      <td>{getCandidateNames(ehs.inductedCandidates, candidates)}</td>
      <td>{ehs.createdTime}</td>
      <td>{ehs.modifiedTime}</td>
    </tr>
  );
}

// Helper function to get contractor name for App User (defined outside component to avoid initialization issues)
const getContractorNameForUser = (email) => {
  if (!email) return null;
 
  // First, try to get contractor info from localStorage (set by authorized_portal_function)
  try {
    const stored = localStorage.getItem('contractorInfo');
    if (stored) {
      const contractorInfo = JSON.parse(stored);
      if (contractorInfo && contractorInfo.contractorName) {
        console.log(`Found contractor name from localStorage for ${email}:`, contractorInfo.contractorName);
        return contractorInfo.contractorName;
      }
    }
  } catch (err) {
    console.error('Error reading contractorInfo from storage:', err);
  }
 
  // Check hardcoded mappings (same as backend logic)
  if (email === "afrindinusha29@gmail.com" || email === "sriramenterprises50@yahoo.com") {
    return "Sriram Enterprises";
  } else if (email === "afrindinusha@gmail.com" || email === "rpdmanpowerservice@gmail.com") {
    return "R.P.D Facility Management Services";
  } else if (email === "afrinatlin@gmail.com" || email === "samuelenterprisesms@gmail.com") {
    // For Samuel, we'll need to query the database, but for now return a common variation
    // The backend will handle finding the exact match
    return "Samuel Enterprise"; // Common variation, backend will match similar
  } else if (email === "dinushaafrin@gmail.com" || email === "vijaybalaji701@gmail.com") {
    return "Sri Balaji Enterprises";
  } else if (email === "afrindinu14@gmail.com") {
    return "NAPS";
  }
 
  return null;
};

function EHSManagement({ userRole: propUserRole = 'App Administrator' }) {
  const userRole = localStorage.getItem('userRole') || propUserRole;
  const userEmail = localStorage.getItem('userEmail') || null;
  const navigate = useNavigate();
  const location = useLocation();
 
  // Sidebar state
  const [expandedMenus, setExpandedMenus] = useState({});
  const [showSidebarMenu, setShowSidebarMenu] = useState(false);
  // Header notification state
  const [showNotifications, setShowNotifications] = useState(false);
  const recentActivities = [
    { icon: '🛡️', title: 'New EHS Record Added', description: 'Safety induction completed for ABC Contractors', time: '2 minutes ago' },
    { icon: '📝', title: 'EHS Record Updated', description: 'XYZ Company EHS status updated to Approved', time: '5 minutes ago' },
    { icon: '🗑️', title: 'EHS Record Removed', description: 'Outdated EHS record has been removed', time: '10 minutes ago' },
    { icon: '📊', title: 'EHS Report Generated', description: 'Monthly EHS compliance report has been generated', time: '1 hour ago' }
  ];

  // User avatar for header
  const userAvatar = "https://images.pexels.com/photos/2379004/pexels-photo-2379004.jpeg?auto=compress&cs=tinysrgb&w=150";

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

  const [ehsList, setEHSList] = useState([]);
  const [filteredEHS, setFilteredEHS] = useState([]);
  const [fetchState, setFetchState] = useState('init');
  const [fetchError, setFetchError] = useState('');
  const [selectedEHS, setSelectedEHS] = useState([]);
  const [showForm, setShowForm] = useState(false);
 
  // Calculate if all EHS records are selected
  const allSelected = filteredEHS.length > 0 && selectedEHS.length === filteredEHS.length;
  const someSelected = selectedEHS.length > 0 && selectedEHS.length < filteredEHS.length;
  const [isEditing, setIsEditing] = useState(false);
  const [editingEHSId, setEditingEHSId] = useState(null);
  const [form, setForm] = useState({
    contractor: '',
    inductionDate: '',
    skills: '',
    attendedCandidates: [],
    inductedCandidates: [],
    status: '', // Add status field
  });
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importError, setImportError] = useState('');
  const [exportError, setExportError] = useState('');
  const fileInputRef = useRef(null);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(50);
  const [totalPages, setTotalPages] = useState(1);
  const [totalEHS, setTotalEHS] = useState(0);
  const [candidates, setCandidates] = useState([]);
  const [filteredCandidates, setFilteredCandidates] = useState([]); // New state for filtered candidates
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [candidatesError, setCandidatesError] = useState('');
  const [contractors, setContractors] = useState([]);
  const [showFilterSidebar, setShowFilterSidebar] = useState(false);
  const [showInductedCount, setShowInductedCount] = useState(false);
  const [selectedContractor, setSelectedContractor] = useState(null);
 
  // Filter state management similar to Candidate form
  const [searchFields, setSearchFields] = useState({
    contractor: { enabled: false, selectedContractor: '' },
    skills: { enabled: false, selectedSkill: '' },
    status: { enabled: false, value: '' },
    inductionDate: { enabled: false, value: '' },
    attendedCandidates: { enabled: false, value: '' },
    inductedCandidates: { enabled: false, value: '' },
    createdTime: { enabled: false, value: '' },
    modifiedTime: { enabled: false, value: '' },
  });

  // Contractor dropdown states
  const [filterContractors, setFilterContractors] = useState([]);
  const [loadingContractors, setLoadingContractors] = useState(false);
  const [contractorSearch, setContractorSearch] = useState('');
  const [isContractorDropdownOpen, setIsContractorDropdownOpen] = useState(false);

  // Skills dropdown states
  const [filterSkills, setFilterSkills] = useState([]);
  const [loadingSkills, setLoadingSkills] = useState(false);
  const [skillSearch, setSkillSearch] = useState('');
  const [isSkillDropdownOpen, setIsSkillDropdownOpen] = useState(false);

  // Function to handle contractor click
  const onClickContractor = useCallback((id, contractor) => {
    setSelectedContractor({ id, name: contractor });
    setShowInductedCount(true);
  }, []);

  // Searchable fields for EHS data
  const searchableFields = [
    { label: 'Contractor', field: 'contractor' },
    { label: 'Skills', field: 'skills' },
    { label: 'Status', field: 'status' },
    { label: 'Induction Date', field: 'inductionDate' },
    { label: 'Attended Candidates', field: 'attendedCandidates' },
    { label: 'Inducted Candidates', field: 'inductedCandidates' },
    { label: 'Created Time', field: 'createdTime' },
    { label: 'Modified Time', field: 'modifiedTime' },
  ];

  const filterModes = [
    { value: 'is', label: 'is' },
    { value: 'is not', label: 'is not' },
    { value: 'is empty', label: 'is empty' },
    { value: 'is not empty', label: 'is not empty' },
    { value: 'contains', label: 'contains' },
    { value: 'starts with', label: 'starts with' },
    { value: 'ends with', label: 'ends with' },
  ];

  // Filter toggle functionality
  const handleFieldToggle = useCallback((field) => {
    setSearchFields((prev) => ({
      ...prev,
      [field]: {
        ...prev[field],
        enabled: !prev[field].enabled,
        value: !prev[field].enabled ? prev[field].value : '',
      },
    }));
  }, []);

  // Helper function to create dropdown UI (similar to Candidate form)
  const createDropdownUI = (field, label, data, searchValue, setSearchValue, isOpen, setIsOpen, onSelect, loading, filteredData) => {
    const getSelectedValue = () => {
      const fieldData = searchFields[field];
      if (field === 'contractor') return fieldData.selectedContractor;
      if (field === 'skills') return fieldData.selectedSkill;
      return '';
    };

    const selectedValue = getSelectedValue();

    return (
      <div style={{ position: 'relative' }} data-dropdown={field}>
        <div
          onClick={() => setIsOpen(prev => {
            if (!prev && data.length === 0) {
              console.log(`Opening ${field} dropdown, data length:`, data.length);
              if (field === 'contractor') fetchAllContractors();
              else if (field === 'skills') fetchAllSkills();
            }
            return !prev;
          })}
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
          <span style={{ color: selectedValue ? '#000' : '#6b7280' }}>
            {selectedValue || `Select ${label}`}
          </span>
          <span style={{ color: '#6b7280', fontSize: '12px' }}>
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
            boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
            zIndex: 1000,
            maxHeight: '200px',
            overflowY: 'auto'
          }}>
            <div style={{ padding: '8px' }}>
              <input
                type="text"
                value={searchValue}
                onChange={(e) => setSearchValue(e.target.value)}
                placeholder={`Search ${label.toLowerCase()}...`}
                style={{
                  width: '100%',
                  padding: '6px 8px',
                  border: '1px solid #d1d5db',
                  borderRadius: '4px',
                  fontSize: '14px',
                  marginBottom: '8px'
                }}
                onClick={(e) => e.stopPropagation()}
              />
            </div>
            <div style={{ maxHeight: '150px', overflowY: 'auto' }}>
              {loading ? (
                <div style={{ padding: '8px', textAlign: 'center', color: '#6b7280' }}>
                  Loading...
                </div>
              ) : filteredData.length > 0 ? (
                filteredData.map((item, index) => (
                  <div
                    key={index}
                    onClick={() => onSelect(item)}
                    style={{
                      padding: '8px 12px',
                      cursor: 'pointer',
                      borderBottom: '1px solid #f0f0f0',
                      fontSize: '14px',
                      ':hover': { backgroundColor: '#f8f9fa' }
                    }}
                    onMouseEnter={(e) => e.target.style.backgroundColor = '#f8f9fa'}
                    onMouseLeave={(e) => e.target.style.backgroundColor = 'white'}
                  >
                    {item}
                  </div>
                ))
              ) : (
                <div style={{ padding: '8px', textAlign: 'center', color: '#6b7280' }}>
                  No {label.toLowerCase()} found
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  // Filter logic using useMemo like Candidate form
  const filteredEHSData = useMemo(() => {
    const hasActiveFilters = Object.values(searchFields).some(
      field => field.enabled
    );

    if (!hasActiveFilters) {
      return ehsList;
    }

    return ehsList.filter((ehs) => {
      if (!ehs || typeof ehs !== 'object') return false;
      return searchableFields.every(({ field }) => {
        const fieldData = searchFields[field];
        if (!fieldData.enabled) return true;

        // Handle contractor dropdown selection
        if (field === 'contractor') {
          const selectedContractor = fieldData.selectedContractor;
          if (!selectedContractor) return true;
          return ehs.contractor && ehs.contractor.toLowerCase().includes(selectedContractor.toLowerCase());
        }

        // Handle skills dropdown selection
        if (field === 'skills') {
          const selectedSkill = fieldData.selectedSkill;
          if (!selectedSkill) return true;
          return ehs.skills && ehs.skills.toLowerCase().includes(selectedSkill.toLowerCase());
        }

        // Handle other fields with text input
        const candidateValue = (ehs[field] || '').toString().toLowerCase();
        const searchValue = (fieldData.value || '').toString().toLowerCase();

        if (!searchValue) return true;

        return candidateValue.includes(searchValue);
      });
    });
  }, [ehsList, searchFields]);

  // Update filteredEHS when filteredEHSData changes
  useEffect(() => {
    setFilteredEHS(filteredEHSData);
  }, [filteredEHSData]);

  // Filter contractors based on search
  const filteredContractors = filterContractors.filter(contractor =>
    contractor.toLowerCase().includes(contractorSearch.toLowerCase())
  );

  // Filter skills based on search
  const filteredSkills = filterSkills.filter(skill =>
    skill.toLowerCase().includes(skillSearch.toLowerCase())
  );

  // Fetch all contractors for dropdown
  const fetchAllContractors = useCallback(async () => {
    setLoadingContractors(true);
    try {
      const response = await axios.get('/server/contracters_function/contractors', {
        params: { page: 1, perPage: 1000 },
        timeout: 10000
      });
     
      if (response?.data?.data?.contractors) {
        let filteredContractors = response.data.data.contractors;
       
        // If user is App User, filter to show only their contractor
        if (userRole === 'App User' && userEmail) {
          const userContractorName = getContractorNameForUser(userEmail);
         
          if (userContractorName) {
            // Filter contractors to match the user's contractor (case-insensitive)
            filteredContractors = response.data.data.contractors.filter((c) => {
              const contractorName = c.ContractorName || '';
              const contractorNameLower = contractorName.toLowerCase();
              const userContractorNameLower = userContractorName.toLowerCase();
             
              // Try exact match first
              if (contractorName === userContractorName) return true;
              // Try case-insensitive match
              if (contractorNameLower === userContractorNameLower) return true;
              // Try partial match for cases like "Samuel Enterprise" vs "Samuel Enterprises"
              if (userContractorNameLower.includes('samuel') && contractorNameLower.includes('samuel')) return true;
              if (userContractorNameLower.includes('balaji') && contractorNameLower.includes('balaji')) return true;
              // Try if contractor name contains the user's contractor name or vice versa
              if (contractorNameLower.includes(userContractorNameLower) || userContractorNameLower.includes(contractorNameLower)) return true;
              return false;
            });
           
            console.log(`Filtering contractors for filter dropdown (App User ${userEmail}):`, {
              userContractorName,
              totalContractors: response.data.data.contractors.length,
              filteredCount: filteredContractors.length
            });
          } else {
            // If no mapping found, try to find contractor by PrimaryEmail
            filteredContractors = response.data.data.contractors.filter((c) => {
              const primaryEmail = c.PrimaryEmail || '';
              return primaryEmail.toLowerCase() === userEmail.toLowerCase();
            });
           
            console.log(`No hardcoded mapping for ${userEmail} in filter dropdown, filtering by PrimaryEmail:`, {
              totalContractors: response.data.data.contractors.length,
              filteredCount: filteredContractors.length
            });
          }
        }
       
        const contractorNames = filteredContractors.map(contractor => contractor.ContractorName);
        setFilterContractors(contractorNames);
      }
    } catch (err) {
      console.error('Failed to fetch contractors:', err);
    } finally {
      setLoadingContractors(false);
    }
    }, [userRole, userEmail]);

  // Fetch all skills for dropdown from EHS records
  const fetchAllSkills = useCallback(async () => {
    setLoadingSkills(true);
    try {
      const response = await axios.get('/server/EHS_function/esh', {
        params: { page: 1, perPage: 1000 },
        timeout: 10000
      });
     
      if (response?.data?.data?.esh) {
        const allEHSRecords = response.data.data.esh;
        const allSkills = [];
        allEHSRecords.forEach(ehs => {
          if (ehs.skills) {
            if (Array.isArray(ehs.skills)) {
              allSkills.push(...ehs.skills);
            } else if (typeof ehs.skills === 'string' && ehs.skills.trim() !== '') {
              const skillsArray = ehs.skills.split(',').map(skill => skill.trim()).filter(skill => skill !== '');
              allSkills.push(...skillsArray);
            }
          }
        });
        const uniqueSkills = [...new Set(allSkills)].sort();
        setFilterSkills(uniqueSkills);
      }
    } catch (err) {
      console.error('Failed to fetch skills:', err);
    } finally {
      setLoadingSkills(false);
    }
  }, []);

  // Contractor selection handler
  const handleContractorSelect = useCallback((contractor) => {
    setSearchFields(prev => ({
      ...prev,
      contractor: { ...prev.contractor, selectedContractor: contractor }
    }));
    setIsContractorDropdownOpen(false);
    setContractorSearch('');
  }, []);

  // Skills selection handler
  const handleSkillSelect = useCallback((skill) => {
    setSearchFields(prev => ({
      ...prev,
      skills: { ...prev.skills, selectedSkill: skill }
    }));
    setIsSkillDropdownOpen(false);
    setSkillSearch('');
  }, []);

  // Clear all filters
  const clearAllFilters = useCallback(() => {
    setSearchFields({
      contractor: { enabled: false, selectedContractor: '' },
      skills: { enabled: false, selectedSkill: '' },
      status: { enabled: false, value: '' },
      inductionDate: { enabled: false, value: '' },
      attendedCandidates: { enabled: false, value: '' },
      inductedCandidates: { enabled: false, value: '' },
      createdTime: { enabled: false, value: '' },
      modifiedTime: { enabled: false, value: '' },
    });
  }, []);

  const fetchEHS = useCallback(() => {
    setFetchState('loading');
    setFetchError('');
    axios
      .get('/server/EHS_function/esh', { params: { page, perPage }, timeout: 5000 })
      .then((response) => {
        const fetched = response.data.data.esh || [];
        setEHSList(fetched);
        setFilteredEHS(fetched);
        const total = response.data.data.total || 0;
        setTotalEHS(total);
        setTotalPages(total && perPage ? Math.ceil(total / perPage) : 1);
        setFetchState('fetched');
      })
      .catch((err) => {
        setFetchError('Failed to fetch EHS records.');
        setFetchState('error');
      });
  }, [page, perPage]);

  useEffect(() => {
    fetchEHS();
  }, [fetchEHS]);


  useEffect(() => {
    setCandidatesLoading(true);
    axios.get('/server/candidate_function/candidates', { params: { perPage: 300 } })
      .then(res => {
        setCandidates(res.data.data.candidates || []);
        setCandidatesError('');
      })
      .catch(() => setCandidatesError('Failed to fetch candidates.'))
      .finally(() => setCandidatesLoading(false));
  }, []);

  useEffect(() => {
    axios
      .get('/server/contracters_function/contractors', { params: { page: 1, perPage: 100 } })
      .then(res => {
        if (res.data && res.data.data && res.data.data.contractors) {
          let filteredContractors = res.data.data.contractors;
         
          // If user is App User, filter to show only their contractor
          if (userRole === 'App User' && userEmail) {
            const userContractorName = getContractorNameForUser(userEmail);
           
            if (userContractorName) {
              // Filter contractors to match the user's contractor (case-insensitive)
              filteredContractors = res.data.data.contractors.filter((c) => {
                const contractorName = c.ContractorName || '';
                const contractorNameLower = contractorName.toLowerCase();
                const userContractorNameLower = userContractorName.toLowerCase();
               
                // Try exact match first
                if (contractorName === userContractorName) return true;
                // Try case-insensitive match
                if (contractorNameLower === userContractorNameLower) return true;
                // Try partial match for cases like "Samuel Enterprise" vs "Samuel Enterprises"
                if (userContractorNameLower.includes('samuel') && contractorNameLower.includes('samuel')) return true;
                if (userContractorNameLower.includes('balaji') && contractorNameLower.includes('balaji')) return true;
                // Try if contractor name contains the user's contractor name or vice versa
                if (contractorNameLower.includes(userContractorNameLower) || userContractorNameLower.includes(contractorNameLower)) return true;
                return false;
              });
             
              console.log(`Filtering contractors for App User ${userEmail} in EHS:`, {
                userContractorName,
                totalContractors: res.data.data.contractors.length,
                filteredCount: filteredContractors.length,
                filteredContractors: filteredContractors.map(c => c.ContractorName)
              });
             
              // If no contractors matched, log a warning but still show empty list (better than showing all)
              if (filteredContractors.length === 0) {
                console.warn(`No contractors found matching "${userContractorName}" for user ${userEmail} in EHS. Available contractors:`, res.data.data.contractors.map(c => c.ContractorName));
              }
            } else {
              // If no mapping found, try to find contractor by PrimaryEmail
              filteredContractors = res.data.data.contractors.filter((c) => {
                const primaryEmail = c.PrimaryEmail || '';
                return primaryEmail.toLowerCase() === userEmail.toLowerCase();
              });
             
              console.log(`No hardcoded mapping for ${userEmail} in EHS, filtering by PrimaryEmail:`, {
                totalContractors: res.data.data.contractors.length,
                filteredCount: filteredContractors.length
              });
             
              // If still no match, show empty list (App Users should only see their own contractor)
              if (filteredContractors.length === 0) {
                console.warn(`No contractor found for ${userEmail} by PrimaryEmail in EHS. Showing empty contractor list for App User.`);
              }
            }
          }
         
          setContractors(filteredContractors);
        }
      })
      .catch(err => {
        setContractors([]);
      });
  }, [userRole, userEmail]);

  const handleSelectEHS = useCallback((id) => {
    setSelectedEHS((prev) =>
      prev.includes(id) ? prev.filter((ehsId) => ehsId !== id) : [...prev, id]
    );
  }, []);

  const handleSelectAll = useCallback(() => {
    if (allSelected) {
      // If all are selected, deselect all
      setSelectedEHS([]);
    } else {
      // If not all are selected, select all
      const allIds = filteredEHS.map(ehs => ehs.id);
      setSelectedEHS(allIds);
    }
  }, [allSelected, filteredEHS]);

  const handleDeleteSelected = () => {
    if (selectedEHS.length === 0) return;
    if (!window.confirm(`Delete ${selectedEHS.length} selected records?`)) return;
    Promise.all(
      selectedEHS.map(id =>
        axios.delete(`/server/EHS_function/esh/${id}`)
      )
    )
      .then(() => {
        setEHSList(prev => prev.filter(e => !selectedEHS.includes(e.id)));
        setFilteredEHS(prev => prev.filter(e => !selectedEHS.includes(e.id)));
        setSelectedEHS([]);
      })
      .catch(() => {
        alert('Failed to delete some records.');
      });
  };

  const validateForm = useCallback(() => {
    const errors = [];
    const errorsAttended = [];
    if (!form.contractor.trim()) errors.push('Contractor is required.');
    if (!form.inductionDate.trim()) errors.push('Induction Date is required.');
    if (form.attendedCandidates.length === 0) errorsAttended.push('At least one Attended Candidate is required.');
    if (errors.length > 0 || errorsAttended.length > 0) {
      setFormError([...errors, ...errorsAttended].join(', '));
      return false;
    }
    return true;
  }, [form]);

  const saveEHS = useCallback(
    (e) => {
      e.preventDefault();
      if (!validateForm()) return;
      setSubmitting(true);
      const data = {
        Contractor: form.contractor,
        InductionDate: form.inductionDate,
        Skills: form.skills,
        AttendedCandidates: Array.isArray(form.attendedCandidates) ? form.attendedCandidates.join(',') : form.attendedCandidates,
        InductedCandidates: Array.isArray(form.inductedCandidates) ? form.inductedCandidates.join(',') : form.inductedCandidates,
        Status: form.status, // Add status
      };
      const request = isEditing
        ? axios.put(`/server/EHS_function/esh/${editingEHSId}`, data, { timeout: 5000 })
        : axios.post('/server/EHS_function/esh', data, { timeout: 5000 });
      request
        .then(() => {
          fetchEHS();
          setShowForm(false);
          setIsEditing(false);
          setEditingEHSId(null);
          setForm({ contractor: '', inductionDate: '', skills: '', attendedCandidates: [], inductedCandidates: [], status: '' });
        })
        .catch((err) => {
          setFormError('Failed to save EHS record.');
        })
        .finally(() => setSubmitting(false));
    },
    [form, isEditing, editingEHSId, validateForm, fetchEHS]
  );

  const editEHS = useCallback((ehs) => {
    // Find candidates for the contractor
    let filtered = [];
    if (ehs.contractor) {
      const selectedContractor = ehs.contractor.trim().toLowerCase();
      filtered = candidates.filter(cand =>
        cand.contractorName && cand.contractorName.trim().toLowerCase() === selectedContractor
      );
    }
   
    // Merge filtered candidates with attended and inducted candidates from record to ensure options include selected candidates
    const attendedCandidateNames = ehs.attendedCandidates ? ehs.attendedCandidates.split(',').map(name => name.trim()) : [];
    const inductedCandidateNames = ehs.inductedCandidates ? ehs.inductedCandidates.split(',').map(name => name.trim()) : [];
    const selectedCandidateNames = Array.from(new Set([...attendedCandidateNames, ...inductedCandidateNames]));
    const mergedCandidates = [...filtered];
    selectedCandidateNames.forEach(name => {
      if (!mergedCandidates.find(c => c.candidateName === name)) {
        mergedCandidates.push({ candidateName: name, contractorName: ehs.contractor });
      }
    });
   
    setFilteredCandidates(mergedCandidates);
    setForm({
      contractor: ehs.contractor,
      inductionDate: ehs.inductionDate,
      skills: ehs.skills,
      attendedCandidates: attendedCandidateNames,
      inductedCandidates: inductedCandidateNames,
      status: ehs.status,
    });
    setIsEditing(true);
    setEditingEHSId(ehs.id);
    setShowForm(true);
    setShowFilterSidebar(false); // Hide filter sidebar when editing
    setFormError(''); // Clear form errors when editing
  }, [candidates]);

  const toggleForm = useCallback(() => {
    setShowForm((prev) => !prev);
    setFormError('');
    setForm({ contractor: '', inductionDate: '', skills: '', attendedCandidates: [], inductedCandidates: [], status: '' });
    setIsEditing(false);
    setEditingEHSId(null);
    setShowFilterSidebar(false); // Hide filter sidebar when opening form
  }, []);

  const handleImport = useCallback((event) => {
    const file = event.target.files[0];
    if (!file) {
      setImportError('No file selected.');
      return;
    }
    setImporting(true);
    setImportError('');
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet);
        if (!jsonData || jsonData.length === 0) throw new Error('No data found in the Excel file.');
        Promise.all(
          jsonData.map((row) =>
            axios.post('/server/EHS_function/esh', {
              Contractor: row['Contractor'],
              InductionDate: row['InductionDate'],
              Skills: row['Skills'],
              AttendedCandidates: row['AttendedCandidates'],
              InductedCandidates: row['InductedCandidates'],
              Status: row['Status'], // Add status to import
            })
          )
        )
          .then(() => {
            fetchEHS();
            setImportError('✅ Successfully imported records.');
          })
          .catch(() => {
            setImportError('❌ Import failed for some records.');
          })
          .finally(() => {
            setImporting(false);
            fileInputRef.current.value = '';
          });
      } catch (err) {
        setImportError('Failed to parse Excel file.');
        setImporting(false);
        fileInputRef.current.value = '';
      }
    };
    reader.onerror = () => {
      setImportError('Failed to read the Excel file.');
      setImporting(false);
      fileInputRef.current.value = '';
    };
    reader.readAsArrayBuffer(file);
  }, [fetchEHS]);

  const handleExport = useCallback(() => {
    if (filteredEHS.length === 0) {
      setExportError('No data to export.');
      return;
    }
    setExporting(true);
    setExportError('');
    try {
      const exportData = filteredEHS.map((ehs) => ({
        Contractor: ehs.contractor || '',
        InductionDate: ehs.inductionDate || '',
        Skills: ehs.skills || '',
        AttendedCandidates: ehs.attendedCandidates || '',
        InductedCandidates: ehs.inductedCandidates || '',
        Status: ehs.status || '', // Add status to export
        CreatedTime: ehs.createdTime || '',
        ModifiedTime: ehs.modifiedTime || '',
      }));
      const worksheet = XLSX.utils.json_to_sheet(exportData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'EHS');
      XLSX.writeFile(workbook, 'ehs_export.xlsx');
    } catch (err) {
      setExportError('Failed to export data to Excel.');
    } finally {
      setExporting(false);
    }
  }, [filteredEHS]);

  // Effect to sync inducted candidates with attended candidates
  useEffect(() => {
    // Filter out any inducted candidates that are not in the attended candidates list
    const validInductedCandidates = form.inductedCandidates.filter(candidateName =>
      form.attendedCandidates.includes(candidateName)
    );
   
    // Update form state if needed
    if (validInductedCandidates.length !== form.inductedCandidates.length) {
      setForm(prevForm => ({
        ...prevForm,
        inductedCandidates: validInductedCandidates
      }));
    }
  }, [form.attendedCandidates, form.inductedCandidates]);

  const handleChange = (e) => {
    const { name, value, options } = e.target;
    if (name === 'attendedCandidates' || name === 'inductedCandidates') {
      const selectedValues = Array.from(options)
        .filter(option => option.selected)
        .map(option => option.value);
      setForm({ ...form, [name]: selectedValues });
    } else {
      // When contractor changes, clear attended and inducted candidates
      if (name === 'contractor') {
        setForm({ ...form, [name]: value, attendedCandidates: [], inductedCandidates: [] });
      } else {
        setForm({ ...form, [name]: value });
      }
    }
  };

  const totalInductedEmployees = filteredEHS.reduce((sum, ehs) => {
    if (!ehs.inductedCandidates) return sum;
    if (Array.isArray(ehs.inductedCandidates)) {
      return sum + ehs.inductedCandidates.length;
    } else if (typeof ehs.inductedCandidates === 'string') {
      return sum + (ehs.inductedCandidates.trim() ? ehs.inductedCandidates.split(',').filter(Boolean).length : 0);
    }
    return sum;
  }, 0);

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
              <h4>{userRole === 'App Administrator' ? 'Admin User' : 'App User'}</h4>
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

          {/* EHS Content */}
          <main className="cms-dashboard-content">
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
                      EHS Directory
                    </h2>
                    <p className="ehs-subtitle">
                      Manage your organization's EHS records efficiently
                    </p>
                  </div>
                </div>

                {/* Toolbar Buttons */}
                <div className="ehs-toolbar" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
{userRole !== 'App User' && (
                    <>
                      <button
                        className="toolbar-btn import-btn"
                        onClick={() => fileInputRef.current.click()}
                        disabled={importing}
                        title="Import EHS records from Excel"
                        type="button"
                        style={{ background: '#fff', color: '#22c55e', border: 'none', fontWeight: 600, padding: '8px', borderRadius: '8px', width: '48px', height: '48px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}
                      >
                        <FileInput size={22} style={{ color: '#22c55e' }} />
                      </button>
                      <input
                        type="file"
                        ref={fileInputRef}
                        style={{ display: 'none' }}
                        accept=".xlsx, .xls"
                        onChange={handleImport}
                      />
                    </>
                  )}
                  <button
                    className="toolbar-btn export-btn"
                    onClick={handleExport}
                    disabled={exporting}
                    title="Export EHS records to Excel"
                    type="button"
                    style={{ background: '#fff', color: '#2563eb', border: 'none', fontWeight: 600, padding: '8px', borderRadius: '8px', width: '48px', height: '48px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}
                  >
                    <FileOutput size={22} style={{ color: '#2563eb' }} />
                  </button>
                  <button
                    className="toolbar-btn filter-btn"
                    onClick={() => setShowFilterSidebar(true)}
                    type="button"
                    title="Advanced filters for EHS records"
                    style={{ background: '#fff', color: '#f97316', border: 'none', fontWeight: 600, padding: '8px', borderRadius: '8px', width: '48px', height: '48px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}
                  >
                    <Filter size={22} style={{ color: '#f97316' }} />
                  </button>
{userRole !== 'App User' && (
                    <button
                      className="toolbar-btn add-btn"
                      onClick={toggleForm}
                      type="button"
                      title="Add new EHS record"
                      style={{ background: '#fff', color: '#14b8a6', border: 'none', fontWeight: 700, fontSize: '1.2rem', borderRadius: '8px', width: '48px', height: '48px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(60,72,88,0.10)' }}
                    >
                      <Plus size={24} style={{ color: '#14b8a6' }} />
                    </button>
                  )}
                  {/* Delete button for selected EHS records - positioned after + button */}
                  {selectedEHS.length > 0 && (
                    <button
                      className="toolbar-btn delete-btn"
                      disabled={selectedEHS.length === 0}
                      onClick={handleDeleteSelected}
                      title={`Delete ${selectedEHS.length} selected EHS record(s)`}
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
      {importError && <div className="ehs-feedback error-message">{importError}</div>}
      {exportError && <div className="ehs-feedback error-message">{exportError}</div>}
      {/* EHS Form - Show when form is open */}
      {showForm && (
        <div className="ehs-form-page">
          <div className="ehs-form-container">
            <div className="ehs-form-header">
              <h1>
                <i className="fas fa-shield-alt"></i>
                {isEditing ? 'Edit EHS Record' : 'Add EHS Record'}
              </h1>
              <button
                className="close-btn"
                onClick={() => setShowForm(false)}
                title="Close form"
              >
                <i className="fas fa-times"></i>
              </button>
            </div>
            <div className="ehs-form-content">
              <form className="ehs-form" onSubmit={saveEHS}>
                {submitting && <div className="ehs-modal-loader">Saving...</div>}
               
                {/* EHS Info Card */}
                <div className="form-section-card ehs-info">
                  <h2 className="section-title">EHS Information</h2>
                  <div className="form-grid">
                    <div className="form-group">
                      <label>Name of the Contractor</label>
                      <select
                        name="contractor"
                        value={form.contractor}
                        onChange={handleChange}
                        className="input"
                        required
                      >
                        <option value="">-- Select Contractor --</option>
                        {contractors.map(c => (
                          <option key={c.id} value={c.ContractorName}>
                            {c.ContractorName}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="form-group">
                      <label>Induction Date</label>
                      <input
                        type="date"
                        name="inductionDate"
                        value={form.inductionDate}
                        onChange={(e) => setForm({ ...form, inductionDate: e.target.value })}
                        className="input"
                      />
                    </div>
                    <div className="form-group">
                      <label>Skills</label>
                      <input
                        type="text"
                        name="skills"
                        value={form.skills}
                        onChange={(e) => setForm({ ...form, skills: e.target.value })}
                        className="input"
                      />
                    </div>
                    <div className="form-group">
                      <label>Status</label>
                      <select
                        name="status"
                        value={form.status}
                        onChange={handleChange}
                        className="input"
                        required
                      >
                        <option value="">-- Select Status --</option>
                        <option value="Approved">Approved</option>
                        <option value="Rejected">Rejected</option>
                        <option value="In Progress">In Progress</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* Candidates Card */}
                <div className="form-section-card candidates-info">
                  <h2 className="section-title">Candidates Information</h2>
                  <div className="form-grid">
                    <div className="form-group">
                      <label>Attended Candidates</label>
                      <Select
                        isMulti
                        isSearchable
                        name="attendedCandidates"
                        options={form.contractor ? candidates
                          .filter(c => c.contractorName === form.contractor)
                          .map(c => ({ value: c.candidateName, label: c.candidateName })) : []}
                        value={form.attendedCandidates.map(name => ({ value: name, label: name }))}
                        onChange={(selectedOptions) => {
                          const selectedValues = selectedOptions ? selectedOptions.map(option => option.value) : [];
                          setForm(prevForm => ({
                            ...prevForm,
                            attendedCandidates: selectedValues
                          }));
                        }}
                        className="basic-multi-select"
                        classNamePrefix="select"
                        placeholder=""
                        noOptionsMessage={() => "No candidates found"}
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label>Inducted Candidates</label>
                      <Select
                        isMulti
                        isSearchable
                        name="inductedCandidates"
                        options={(() => {
                          if (!form.contractor) return [];
                          const contractorCandidates = candidates.filter(c => c.contractorName === form.contractor);
                          const attendedSet = new Set(form.attendedCandidates);
                          // Include all contractor candidates plus any attended candidates not in contractor list
                          const combined = [...contractorCandidates];
                          form.attendedCandidates.forEach(name => {
                            if (!contractorCandidates.find(c => c.candidateName === name)) {
                              combined.push({ candidateName: name, contractorName: form.contractor });
                            }
                          });
                          return combined.map(c => ({ value: c.candidateName, label: c.candidateName }));
                        })()}
                        value={form.inductedCandidates.map(name => ({ value: name, label: name }))}
                        onChange={(selectedOptions) => {
                          const selectedValues = selectedOptions ? selectedOptions.map(option => option.value) : [];
                          setForm(prevForm => ({
                            ...prevForm,
                            inductedCandidates: selectedValues
                          }));
                        }}
                        className="basic-multi-select"
                        classNamePrefix="select"
                        placeholder=""
                        noOptionsMessage={() => "No candidates found"}
                        required
                      />
                    </div>
                  </div>
                </div>

                {/* Form Actions */}
                <div className="form-actions">
                  <button type="submit" className="btn-primary" disabled={submitting}>
                    {submitting ? 'Saving...' : (isEditing ? 'Update EHS Record' : 'Add EHS Record')}
                  </button>
                  <button type="button" className="btn-danger" onClick={() => setShowForm(false)}>
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Table Container - Only show when form is closed */}
      {!showForm && (
        <>
          <div className="ehs-table-container">
            {fetchState === 'loading' ? (
              <div className="ehs-loader">Loading...</div>
            ) : fetchState === 'error' ? (
              <div className="error-message">{fetchError}</div>
            ) : (
              <table className={`ehs-table ${selectedEHS.length === 0 ? 'edit-column-hidden' : ''}`}>
                <thead>
                  <tr>
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
                    {selectedEHS.length > 0 && <th>Edit</th>}
                    <th>#</th>
                    <th>Status</th>
                    <th>Contractor</th>
                    <th>Induction Date</th>
                    <th>Skills</th>
                    <th>Attended Candidates</th>
                    <th>Inducted Candidates</th>
                    <th>Created Time</th>
                    <th>Modified Time</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEHS.length ? filteredEHS.map((ehs, index) => (
                    <EHSRow
                      key={ehs.id}
                      ehs={ehs}
                      index={index}
                      editEHS={editEHS}
                      isSelected={selectedEHS.includes(ehs.id)}
                      onSelect={handleSelectEHS}
                      candidates={candidates}
                      onClickContractor={onClickContractor}
                      selectedEHS={selectedEHS}
                    />
                  )) : (
                    <tr>
                      <td colSpan={selectedEHS.length > 0 ? 11 : 10} className="text-center">No EHS records found.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
          <div className="ehs-pagination">
            <button className="ehs-btn" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>Previous</button>
            <span>Page {page} of {totalPages}</span>
            <button className="ehs-btn" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}>Next</button>
          </div>
        </>
      )}
      {showFilterSidebar && (
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
        }} onClick={() => setShowFilterSidebar(false)}>
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
                onClick={() => setShowFilterSidebar(false)}
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
              {searchableFields.map(({ field, label }) => (
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
                      {field === 'contractor' ? (
                        createDropdownUI(
                          'contractor', 'Contractor', filterContractors,
                          contractorSearch, setContractorSearch,
                          isContractorDropdownOpen, setIsContractorDropdownOpen,
                          handleContractorSelect, loadingContractors, filteredContractors
                        )
                      ) : field === 'skills' ? (
                        createDropdownUI(
                          'skills', 'Skills', filterSkills,
                          skillSearch, setSkillSearch,
                          isSkillDropdownOpen, setIsSkillDropdownOpen,
                          handleSkillSelect, loadingSkills, filteredSkills
                        )
                      ) : (
                        <input
                          type="text"
                          value={searchFields[field].value || ''}
                          onChange={(e) => setSearchFields(prev => ({
                            ...prev,
                            [field]: { ...prev[field], value: e.target.value }
                          }))}
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
                onClick={clearAllFilters}
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
                Clear All
              </button>
              <button
                onClick={() => setShowFilterSidebar(false)}
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
            </div>
          </main>
        </div>
      </div>
    </>
  );
}
export default EHSManagement;
