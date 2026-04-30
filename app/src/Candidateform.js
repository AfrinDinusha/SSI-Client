import './App.css';
import './Candidateform.css';
//import './helper.css';
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import axios from 'axios';
import * as XLSX from 'xlsx';
import PhoneInput from 'react-phone-input-2';
import 'react-phone-input-2/lib/style.css';
import { Link, useLocation } from 'react-router-dom';
import HeaderBranding from './HeaderBranding';
import { getSidebarModulesForUser, resolveSidebarUserEmail } from './modulesConfig';
import Button from './Button';
import {
  Users, Calendar, FileText, AlertTriangle, FolderOpen,
  ClipboardList, Building, Handshake, Landmark, Clock,
  Map, BarChart3, User, TrendingUp, TrendingDown,
  Activity, Plus, CheckCircle, Bell, Settings, LayoutDashboard, Home as HomeIcon,
  Shield, AlertOctagon, CreditCard, FileSignature, Search, Clock3, CalendarDays, Database,
  FileInput, FileOutput, Filter, RefreshCw, Trash2
} from 'lucide-react';

// Helper component for displaying field errors
const FieldError = ({ error }) => {
  if (!error) return null;
  return (
    <div style={{
      color: '#d32f2f',
      fontSize: '12px',
      marginTop: '4px',
      fontWeight: '500'
    }}>
      {error}
    </div>
  );
};

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
  },
  h3: {
    textAlign: 'center',
    color: '#333',
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
  },
  input: {
    padding: '8px',
    border: '1px solid #ccc',
    borderRadius: '4px',
    fontSize: '14px',
  },
  select: {
    padding: '8px',
    border: '1px solid #ccc',
    borderRadius: '4px',
    fontSize: '14px',
  },
  buttonPrimary: {
    backgroundColor: '#3f51b5',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    padding: '10px 18px',
    fontSize: '15px',
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'background 0.2s',
  },
  buttonSecondary: {
    backgroundColor: '#6c757d',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    padding: '10px 18px',
    fontSize: '15px',
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'background 0.2s',
  },
  candidateTableContainer: {
    overflowX: 'auto',
    marginTop: '24px',
    border: 'none',
    borderRadius: '18px',
    boxShadow: '0 6px 24px rgba(0,0,0,0.08), 0 1.5px 4px rgba(0,0,0,0.04)',
    background: 'linear-gradient(120deg, #f8fafc 0%, #f4f6f8 100%)',
    padding: '0 0 12px 0',
  },
  candidateTable: {
    width: '100%',
    borderCollapse: 'separate',
    borderSpacing: 0,
    background: '#fff',
    borderRadius: '18px',
    overflow: 'hidden',
    fontFamily: "'Segoe UI', 'Arial', sans-serif",
  },
  candidateTableTh: {
    background: 'linear-gradient(90deg, #c7d2fe 0%, #e0e7ff 100%)',
    fontWeight: 700,
    color: '#1e293b',
    whiteSpace: 'nowrap',
    minWidth: '80px',
    fontSize: '16px',
    position: 'sticky',
    top: 0,
    zIndex: 2,
    borderBottom: '3px solid #6366f1',
    letterSpacing: '0.02em',
    padding: '14px 12px',
    borderRight: '1px solid #e5e7eb',
  },
  candidateTableTd: {
    padding: '14px 12px',
    borderRight: '1px solid #e5e7eb',
    borderBottom: '1.5px solid #e5e7eb',
    textAlign: 'left',
    whiteSpace: 'nowrap',
    fontSize: '15px',
    color: '#23272f',
    background: '#fff',
  },
  // ...continue for all other classes you use
};

function CandidateRow({ candidate, index, removeCandidate, editCandidate, isSelected, onSelect, selectedCandidates }) {
  return (
    <tr>
      <td>
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => onSelect(candidate.id)}
        />
      </td>
      {selectedCandidates.length > 0 && (
        <td>
          {isSelected && (
            <button
              className="btn btn-icon"
              onClick={() => editCandidate(candidate)}
              title="Edit"
            >
              <i className="fas fa-edit"></i>
            </button>
          )}
        </td>
      )}
      <td style={{ paddingRight: '20px' }}>{index + 1}</td>
      <td>
        <button
          className="btn btn-outline-primary"
          onClick={() => editCandidate(candidate)}
          title="Approval/Reject"
        >
          Approval/Reject
        </button>
      </td>
      <td title={candidate.approvalStatus || 'Pending'}>
        <span className="candidate-status-badge" data-status={candidate.approvalStatus}>
          {candidate.approvalStatus ?? 'Pending'}
        </span>
      </td>
      <td>{candidate.candidateName}</td>
      <td>{candidate.contractorName}</td>
      <td>{candidate.contractorSupervisor}</td>
      <td>{candidate.email}</td>
      <td>{candidate.gender}</td>
      <td>{candidate.bloodGroup}</td>
      <td>{candidate.maritalStatus}</td>
      <td>{candidate.emergencyContactNumber}</td>
      <td>{candidate.fathersName}</td>
      <td>{candidate.aadhaarNumber}</td>
      <td>{candidate.dob}</td>
      <td>{candidate.panNumber}</td>
      <td>
        {console.log('Photo data for candidate:', candidate.id, 'photoFileId:', candidate.photoFileId, 'photo:', candidate.photo)}
        {(candidate.photoFileId || candidate.photo || candidate.Photo || candidate.PhotoFileId) ? (
          <div style={{ position: 'relative' }}>
            <img
              src={`/server/candidate_function/candidates/${candidate.id}/file/photo`}
              alt="Candidate"
              style={{
                width: '40px',
                height: '40px',
                objectFit: 'cover',
                borderRadius: '4px',
                border: '1px solid #ccc'
              }}
              onError={(e) => {
                console.error('Failed to load photo for candidate:', candidate.id, 'photoFileId:', candidate.photoFileId);
                e.target.style.display = 'none';
                e.target.nextSibling.style.display = 'inline';
              }}
              onLoad={() => {
                console.log('Photo loaded successfully for candidate:', candidate.id);
              }}
            />
            <span style={{ display: 'none', color: '#aaa', fontSize: '12px' }}>Photo failed to load</span>
          </div>
        ) : (
          <span style={{ color: '#aaa' }}>No photo</span>
        )}
      </td>
      <td>{candidate.designation}</td>
      <td>{candidate.phone}</td>
      <td>{candidate.department}</td>
      <td>{candidate.skills}</td>
      <td>{candidate.dateOfEngagement}</td>
      <td>{candidate.drivingLicenseNumber}</td>
      <td>{candidate.driverLicenseExpiryDate}</td>
      <td>{candidate.presentAddressLine1}</td>
      <td>{candidate.presentCity}</td>
      <td>{candidate.presentState}</td>
      <td>{candidate.presentPostalCode}</td>
      <td>{candidate.presentCountry}</td>
      <td>{candidate.permanentAddressLine1}</td>
      <td>{candidate.permanentCity}</td>
      <td>{candidate.permanentState}</td>
      <td>{candidate.permanentPostalCode}</td>
      <td>{candidate.permanentCountry}</td>
      <td>{candidate.qualification}</td>
      <td>{candidate.institution}</td>
      <td>{candidate.fieldOfStudy}</td>
      <td>{candidate.yearOfCompletion}</td>
      <td>{candidate.percent}</td>
      <td>{candidate.addedUser || '-'}</td>
      <td>{candidate.modifiedUser || '-'}</td>
      <td>{candidate.addedTime ? String(candidate.addedTime).replace('T', ' ').slice(0, 19) : '-'}</td>
      <td>{candidate.modifiedTime ? String(candidate.modifiedTime).replace('T', ' ').slice(0, 19) : '-'}</td>
    </tr>
  );
}

function CandidateManagement({ userRole = 'App Administrator', userEmail = null }) {
  const [candidates, setCandidates] = useState([]);
  const [filteredCandidates, setFilteredCandidates] = useState([]);
  const [fetchState, setFetchState] = useState('init');
  const [fetchError, setFetchError] = useState('');
  const [selectedCandidates, setSelectedCandidates] = useState([]);
  const [deletingMultiple, setDeletingMultiple] = useState(false);
  const [massDeleteError, setMassDeleteError] = useState('');
 
  // Calculate if all candidates are selected
  const allSelected = filteredCandidates.length > 0 && selectedCandidates.length === filteredCandidates.length;
  const someSelected = selectedCandidates.length > 0 && selectedCandidates.length < filteredCandidates.length;
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importError, setImportError] = useState('');
  const [exportError, setExportError] = useState('');
  const fileInputRef = useRef(null);
  const [searchFields, setSearchFields] = useState({
    // Dropdown fields
    candidateName: { enabled: false, selectedName: '' },
    contractorName: { enabled: false, selectedContractor: '' },
    gender: { enabled: false, selectedGender: '' },
    department: { enabled: false, selectedDepartment: '' },
    designation: { enabled: false, selectedDesignation: '' },
    skills: { enabled: false, selectedSkill: '' },
    dateOfEngagement: { enabled: false, selectedDate: '' },
    // Input fields (no dropdown)
    email: { enabled: false, value: '' },
    phone: { enabled: false, value: '' },
    maritalStatus: { enabled: false, value: '' },
    dob: { enabled: false, value: '' },
    aadhaarNumber: { enabled: false, value: '' },
    approvalStatus: { enabled: false, value: '' },
    bloodGroup: { enabled: false, value: '' },
    photo: { enabled: false, value: '' },
    fathersName: { enabled: false, value: '' },
    emergencyContactNumber: { enabled: false, value: '' },
    panNumber: { enabled: false, value: '' },
    drivingLicenseNumber: { enabled: false, value: '' },
    emergencyContactNumber2: { enabled: false, value: '' },
    driverLicenseExpiryDate: { enabled: false, value: '' },
    ehsComments: { enabled: false, value: '' },
    contractorSupervisor: { enabled: false, value: '' },
    induction: { enabled: false, value: '' },
    educationDetails: { enabled: false, value: '' },
    // ...add any other fields you want
  });

  const dropdownRef = useRef(null);

  // Pagination state
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(50);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCandidates, setTotalCandidates] = useState(0);

  const [form, setForm] = useState({
    contractorName: '',
    candidateName: '',
    contractorSupervisor: '',
    email: '',
    gender: '',
    bloodGroup: '',
    maritalStatus: '',
    emergencyContactNumber: '',
    fathersName: '',
    aadhaarNumber: '',
    dob: '',
    panNumber: '',
    photo: null,
    photoFileId: null,
    designation: '',
    phone: '',
    department: '',
    skills: '',
    dateOfEngagement: '',
    status: '',
    drivingLicenseNumber: '',
    driverLicenseExpiryDate: '',
    presentAddress: '',
    permanentAddress: '',
    approvalStatus: '',
    comments: '',
    presentAddressLine1: '',
    presentCity: '',
    presentState: '',
    presentPostalCode: '',
    presentCountry: '',
    permanentAddressLine1: '',
    permanentCity: '',
    permanentState: '',
    permanentPostalCode: '',
    permanentCountry: '',
    phoneCountryCode: "+91",
    emergencyCountryCode: "+91",
  });
  const [formError, setFormError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editingCandidateId, setEditingCandidateId] = useState(null);
  const [copyAddress, setCopyAddress] = useState(false);
  const [induction, setInduction] = useState(false);
  const [ehsComments, setEhsComments] = useState('');
 
  // Add missing state variables for departments and designations
  const [departments, setDepartments] = useState([]);
  const [designations, setDesignations] = useState([]);
  const [educationDetails, setEducationDetails] = useState([{
    qualification: '',
    institution: '',
    fieldOfStudy: '',
    yearOfCompletion: '',
    percent: ''
  }]);
  const [showTotalModal, setShowTotalModal] = useState(false);
 
  // Photo upload state
  const [pendingPhoto, setPendingPhoto] = useState(null);
  const [photoUploadError, setPhotoUploadError] = useState(null);
  const [showTotalCount, setShowTotalCount] = useState(false);
  const [skillsOptions, setSkillsOptions] = useState([
   
  ]);
  const [showAddSkillModal, setShowAddSkillModal] = useState(false);
  const [newSkillName, setNewSkillName] = useState('');
  const [showAddContractorSupervisorModal, setShowAddContractorSupervisorModal] = useState(false);
  const [newContractorSupervisorName, setNewContractorSupervisorName] = useState('');
  const [showRemoveContractorSupervisorModal, setShowRemoveContractorSupervisorModal] = useState(false);
  const [showRemoveSkillModal, setShowRemoveSkillModal] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

  // Dropdown data states
  const [candidateNames, setCandidateNames] = useState([]);
  const [contractors, setContractors] = useState([]);
  const [genders, setGenders] = useState([]);
  const [filterDepartments, setFilterDepartments] = useState([]);
  const [filterDesignations, setFilterDesignations] = useState([]);
  const [filterSkills, setFilterSkills] = useState([]);
  const [engagementDates, setEngagementDates] = useState([]);

  // Loading states for dropdowns
  const [loadingCandidateNames, setLoadingCandidateNames] = useState(false);
  const [loadingContractors, setLoadingContractors] = useState(false);
  const [loadingGenders, setLoadingGenders] = useState(false);
  const [loadingDepartments, setLoadingDepartments] = useState(false);
  const [loadingDesignations, setLoadingDesignations] = useState(false);
  const [loadingSkills, setLoadingSkills] = useState(false);
  const [loadingEngagementDates, setLoadingEngagementDates] = useState(false);

  // Dropdown open states
  const [isCandidateNameDropdownOpen, setIsCandidateNameDropdownOpen] = useState(false);
  const [isContractorDropdownOpen, setIsContractorDropdownOpen] = useState(false);
  const [isGenderDropdownOpen, setIsGenderDropdownOpen] = useState(false);
  const [isDepartmentDropdownOpen, setIsDepartmentDropdownOpen] = useState(false);
  const [isDesignationDropdownOpen, setIsDesignationDropdownOpen] = useState(false);
  const [isSkillDropdownOpen, setIsSkillDropdownOpen] = useState(false);
  const [isEngagementDateDropdownOpen, setIsEngagementDateDropdownOpen] = useState(false);

  // Search values for dropdowns
  const [candidateNameSearch, setCandidateNameSearch] = useState('');
  const [contractorSearch, setContractorSearch] = useState('');
  const [genderSearch, setGenderSearch] = useState('');
  const [departmentSearch, setDepartmentSearch] = useState('');
  const [designationSearch, setDesignationSearch] = useState('');
  const [skillSearch, setSkillSearch] = useState('');
  const [engagementDateSearch, setEngagementDateSearch] = useState('');

  // Education details functions
  const addEducationDetail = useCallback(() => {
    setEducationDetails(prev => [
      ...prev,
      { qualification: '', institution: '', fieldOfStudy: '', yearOfCompletion: '', percent: '' }
    ]);
  }, []);

  const removeEducationDetail = useCallback((index) => {
    setEducationDetails(prev => prev.filter((_, i) => i !== index));
  }, []);

  const updateEducationDetail = useCallback((index, field, value) => {
    setEducationDetails(prev => {
      const newDetails = [...prev];
      newDetails[index] = { ...newDetails[index], [field]: value };
      return newDetails;
    });
  }, []);

  const modulesToShow = useMemo(
    () => getSidebarModulesForUser(resolveSidebarUserEmail(userEmail), userRole),
    [userEmail, userRole]
  );

  // State for expandable menus
  const [expandedMenus, setExpandedMenus] = useState({});

  // Toggle expandable menus
  const toggleMenu = (index) => {
    setExpandedMenus(prev => ({
      ...prev,
      [index]: !prev[index]
    }));
  };

  // User info
  const userAvatar = "https://images.pexels.com/photos/2379004/pexels-photo-2379004.jpeg?auto=compress&cs=tinysrgb&w=150";
  const userName = userRole === 'App Administrator' ? 'Admin User' : 'App User';

  // Header notification state
  const [showNotifications, setShowNotifications] = useState(false);
  const [recentActivities, setRecentActivities] = useState([]);
  const [candidateAddedCount, setCandidateAddedCount] = useState(0);

  const fetchCandidates = useCallback(() => {
    setFetchState('loading');
    setFetchError('');
   
    // Build params object
    const params = { page, perPage };
   
    // Add user role and email for contractor filtering
    // Always send userRole, but only send userEmail if it exists
    if (userRole) {
      params.userRole = userRole;
      if (userEmail) {
        params.userEmail = userEmail;
      }
      console.log('Filtering candidates for:', { userRole, userEmail });
      console.log('Request params:', params);
    }
   
    axios
      .get('/server/candidate_function/candidates', { params, timeout: 10000 })
      .then((response) => {
        console.log('Full API response:', response.data);
        console.log('Response status:', response.status);
        console.log('Response headers:', response.headers);
       
        if (!response?.data?.data) {
          console.error('Missing data field in response:', response.data);
          throw new Error('Unexpected API response structure - missing data field');
        }
       
        const fetchedCandidates = response.data.data.candidates || [];
        if (!Array.isArray(fetchedCandidates)) {
          console.error('Candidates data is not an array:', fetchedCandidates);
          throw new Error('Candidates data is not an array');
        }

        // Normalize approval status key (support both 'approvalStatus' and 'ApprovalStatus')
        const normalizedCandidates = fetchedCandidates.map(c => ({
          ...c,
          approvalStatus: c.approvalStatus ?? c.ApprovalStatus ?? c.Approvalstatus ?? (typeof c.Approval === 'string' ? c.Approval : c.approvalStatus)
        }));
       
        console.log('Fetched candidates count:', normalizedCandidates.length);
        console.log('Fetched candidates:', normalizedCandidates);
       
        if (normalizedCandidates.length === 0) {
          console.log('No candidates found - checking if this is expected');
        }
       
        // Log candidate data for debugging (including normalized approvalStatus)
        normalizedCandidates.forEach((candidate, index) => {
          console.log(`Candidate ${index}:`, {
            id: candidate.id,
            candidateName: candidate.candidateName,
            email: candidate.email,
            gender: candidate.gender,
            bloodGroup: candidate.bloodGroup,
            maritalStatus: candidate.maritalStatus,
            emergencyContactNumber: candidate.emergencyContactNumber,
            fathersName: candidate.fathersName,
            aadhaarNumber: candidate.aadhaarNumber,
            dob: candidate.dob,
            panNumber: candidate.panNumber,
            photoFileId: candidate.photoFileId,
            photo: candidate.photo,
            approvalStatus: candidate.approvalStatus
          });
        });
       
        setCandidates(normalizedCandidates);
        setFilteredCandidates(normalizedCandidates);
       
        // Pagination info
        const hasMore = response.data.data.hasMore;
        const total = response.data.data.total || 0;
        console.log('Setting total candidates:', total);
        setTotalCandidates(total);
       
        // Calculate total pages
        if (total && perPage) {
          setTotalPages(Math.ceil(total / perPage));
        } else if (hasMore) {
          setTotalPages(page + 1); // fallback
        } else {
          setTotalPages(Math.max(1, page));
        }
       
        setFetchState('fetched');
        console.log('Candidates fetch completed successfully');
      })
      .catch((err) => {
        const errorMessage = err.response?.data?.message || 'Failed to fetch candidates. Please try again later.';
        setFetchError(errorMessage);
        setFetchState('error');
        console.error('Fetch candidates error:', err);
        console.error('Error response:', err.response?.data);
      });
  }, [page, perPage, userRole, userEmail]);

  const fetchPendingCandidates = useCallback(() => {
    if (userRole !== 'App Administrator') {
      setRecentActivities([]);
      setCandidateAddedCount(0);
      return;
    }
   
    // Fetch a larger batch to find pending candidates for notifications
    const params = {
      userRole,
      page: 1,
      perPage: 100 // Fetch up to 100 candidates to check for pending ones
    };
   
    axios.get('/server/candidate_function/candidates', { params })
      .then((response) => {
         const allCandidates = response.data?.data?.candidates || [];
         
         // Normalize and filter for pending
         const pending = allCandidates.filter(c => {
             const status = c.approvalStatus ?? c.ApprovalStatus ?? c.Approvalstatus ?? (typeof c.Approval === 'string' ? c.Approval : c.approvalStatus);
             return status === 'Pending';
         });
         
         const activities = pending.map(c => ({
            icon: <User size={20} />,
            title: 'New Candidate Added',
            description: c.candidateName,
            time: c.addedTime ? new Date(c.addedTime).toLocaleDateString() : 'Recently'
         }));
         
         setRecentActivities(activities);
         setCandidateAddedCount(activities.length);
      })
      .catch(err => console.error('Error fetching pending candidates:', err));
  }, [userRole]);

  useEffect(() => {
    fetchCandidates();
  }, [fetchCandidates]);

  // Update notifications when candidates list changes (e.g. after approval)
  useEffect(() => {
    fetchPendingCandidates();
  }, [candidates, fetchPendingCandidates]);

  // Update notifications based on pending candidates
  useEffect(() => {
    if (userRole === 'App Administrator') {
      const pendingCandidates = candidates.filter(
        c => c.approvalStatus === 'Pending'
      );
     
      const activities = pendingCandidates.map(c => ({
        icon: <User size={20} />,
        title: 'New Candidate Added',
        description: c.candidateName,
        time: c.addedTime ? new Date(c.addedTime).toLocaleDateString() : 'Recently'
      }));
     
      setRecentActivities(activities);
      setCandidateAddedCount(activities.length);
    } else {
      setRecentActivities([]);
      setCandidateAddedCount(0);
    }
  }, [candidates, userRole]);

  const columns = [
    { label: 'Select', field: null },
    { label: 'Edit', field: null },
    { label: '#', field: null },
    { label: 'Approval/Reject', field: null },
    { label: 'Approval Status', field: 'approvalStatus' },
    { label: 'Candidate Name', field: 'candidateName' },
    { label: 'Contractor Name', field: 'contractorName' },

    { label: 'Contractor Supervisor', field: 'contractorSupervisor' },
    { label: 'Email', field: 'email' },
    { label: 'Gender', field: 'gender' },
    { label: 'Blood Group', field: 'bloodGroup' },
    { label: 'Marital Status', field: 'maritalStatus' },
    { label: 'Emergency Contact', field: 'emergencyContactNumber' },
    { label: "Father Name/Spouse Name", field: 'fathersName' },
    { label: 'Aadhaar Number', field: 'aadhaarNumber' },
    { label: 'DOB', field: 'dob' },
    { label: 'PAN Number', field: 'panNumber' },
    { label: 'Photo', field: 'photo' },
    { label: 'Designation', field: 'designation' },
    { label: 'Phone', field: 'phone' },
    { label: 'Department', field: 'department' },
    { label: 'Skills', field: 'skills' },
    { label: 'Date of Engagged', field: 'dateOfEngagement' },
    { label: 'Driving License', field: 'drivingLicenseNumber' },
    { label: 'License Expiry', field: 'driverLicenseExpiryDate' },
    { label: 'Present Address Line 1', field: 'presentAddressLine1' },
    { label: 'Present City', field: 'presentCity' },
    { label: 'Present State', field: 'presentState' },
    { label: 'Present Postal Code', field: 'presentPostalCode' },
    { label: 'Present Country', field: 'presentCountry' },
    { label: 'Permanent Address Line 1', field: 'permanentAddressLine1' },
    { label: 'Permanent City', field: 'permanentCity' },
    { label: 'Permanent State', field: 'permanentState' },
    { label: 'Permanent Postal Code', field: 'permanentPostalCode' },
    { label: 'Permanent Country', field: 'permanentCountry' },
    { label: 'Qualification', field: 'qualification' },
    { label: 'Institution Name', field: 'institution' },
    { label: 'Field of Study', field: 'fieldOfStudy' },
    { label: 'Year of Completion', field: 'yearOfCompletion' },
    { label: 'Percent', field: 'percent' },
    { label: 'Added User', field: 'addedUser' },
    { label: 'Modified User', field: 'modifiedUser' },
    { label: 'Added Time', field: 'addedTime' },
    { label: 'Modified Time', field: 'modifiedTime' },
  ];

  // Create dynamic columns array based on selection state
  const dynamicColumns = useMemo(() => {
    if (selectedCandidates.length === 0) {
      // When no candidates are selected, exclude the Edit column
      const filteredColumns = columns.filter(col => col.label !== 'Edit');
      console.log('Dynamic columns (no selection):', filteredColumns.map(col => col.label));
      return filteredColumns;
    }
    console.log('Dynamic columns (with selection):', columns.map(col => col.label));
    return columns;
  }, [selectedCandidates.length]);

  const searchableFields = [
    { label: 'Candidate Name', field: 'candidateName' },
    { label: 'Email', field: 'email' },
    { label: 'Phone', field: 'phone' },
    { label: 'Date of Engagged', field: 'dateOfEngagement' },
    { label: 'Gender', field: 'gender' },
    { label: 'Marital Status', field: 'maritalStatus' },
    { label: 'Contractor Name', field: 'contractorName' },
    { label: 'DOB', field: 'dob' },
    { label: 'Aadhaar Number', field: 'aadhaarNumber' },
    { label: 'Department', field: 'department' },
    { label: 'Designation', field: 'designation' },
    { label: 'Approval Status', field: 'approvalStatus' },
    { label: 'Skills', field: 'skills' },
    { label: 'Blood Group', field: 'bloodGroup' },
    { label: 'Photo', field: 'photo' },
    { label: "Father Name/Spouse Name", field: 'fathersName' },
    { label: 'Emergency Contact Number', field: 'emergencyContactNumber' },
    { label: 'PAN Number', field: 'panNumber' },
    { label: 'Driving License Number', field: 'drivingLicenseNumber' },
    { label: 'Driver License Expiry Date', field: 'driverLicenseExpiryDate' },
    { label: 'EHS Comments', field: 'ehsComments' },
    { label: 'Contractor Supervisor', field: 'contractorSupervisor' },
    { label: 'Induction', field: 'induction' },
    { label: 'Education Details', field: 'educationDetails' },
    // ...add any other fields you want to be searchable
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

  const filteredData = useMemo(() => {
    const hasActiveFilters = Object.values(searchFields).some(
      field => field.enabled
    );

    if (!hasActiveFilters) {
      return candidates;
    }

    return candidates.filter((candidate) => {
      if (!candidate || typeof candidate !== 'object') return false;
      return searchableFields.every(({ field }) => {
        const fieldData = searchFields[field];
        if (!fieldData.enabled) return true;

        // Handle dropdown fields
        if (field === 'candidateName') {
          const { selectedName } = fieldData;
          if (!selectedName) return true;
          return candidate.candidateName === selectedName;
        } else if (field === 'contractorName') {
          const { selectedContractor } = fieldData;
          if (!selectedContractor) return true;
          return candidate.contractorName === selectedContractor;
        } else if (field === 'gender') {
          const { selectedGender } = fieldData;
          if (!selectedGender) return true;
          return candidate.gender === selectedGender;
        } else if (field === 'department') {
          const { selectedDepartment } = fieldData;
          if (!selectedDepartment) return true;
          return candidate.department === selectedDepartment;
        } else if (field === 'designation') {
          const { selectedDesignation } = fieldData;
          if (!selectedDesignation) return true;
          return candidate.designation === selectedDesignation;
        } else if (field === 'skills') {
          const { selectedSkill } = fieldData;
          if (!selectedSkill) return true;
          if (Array.isArray(candidate.skills)) {
            return candidate.skills.includes(selectedSkill);
          } else if (typeof candidate.skills === 'string') {
            return candidate.skills.includes(selectedSkill);
          }
          return false;
        } else if (field === 'dateOfEngagement') {
          const { selectedDate } = fieldData;
          if (!selectedDate) return true;
          return candidate.dateOfEngagement === selectedDate;
        } else {
          // Handle input fields
          const { value } = fieldData;
          if (!value) return true;
         
          const candidateValue = candidate[field] != null ? String(candidate[field]).toLowerCase() : '';
          const lowerSearchValue = value.toLowerCase();
          return candidateValue.includes(lowerSearchValue);
        }
      });
    });
  }, [candidates, searchFields]);

  useEffect(() => {
    setFilteredCandidates(filteredData);
  }, [filteredData]);

  const resetSearch = useCallback(() => {
    setSearchFields({
      // Dropdown fields
      candidateName: { enabled: false, selectedName: '' },
      contractorName: { enabled: false, selectedContractor: '' },
      gender: { enabled: false, selectedGender: '' },
      department: { enabled: false, selectedDepartment: '' },
      designation: { enabled: false, selectedDesignation: '' },
      skills: { enabled: false, selectedSkill: '' },
      dateOfEngagement: { enabled: false, selectedDate: '' },
      // Input fields (no dropdown)
      email: { enabled: false, value: '' },
      phone: { enabled: false, value: '' },
      maritalStatus: { enabled: false, value: '' },
      dob: { enabled: false, value: '' },
      aadhaarNumber: { enabled: false, value: '' },
      approvalStatus: { enabled: false, value: '' },
      bloodGroup: { enabled: false, value: '' },
      photo: { enabled: false, value: '' },
      fathersName: { enabled: false, value: '' },
      emergencyContactNumber: { enabled: false, value: '' },
      panNumber: { enabled: false, value: '' },
      drivingLicenseNumber: { enabled: false, value: '' },
      emergencyContactNumber2: { enabled: false, value: '' },
      driverLicenseExpiryDate: { enabled: false, value: '' },
      ehsComments: { enabled: false, value: '' },
      contractorSupervisor: { enabled: false, value: '' },
      induction: { enabled: false, value: '' },
      educationDetails: { enabled: false, value: '' },
      // ...add any other fields you want
    });
  }, []);

  const toggleSearchDropdown = useCallback(() => {
    setShowSearchDropdown((prev) => !prev);
  }, []);

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


  const validateImportedCandidate = useCallback((cand, rowIndex) => {
    const errors = [];
    if (!cand.candidateName) errors.push('Candidate Name is required.');
    if (!cand.email) errors.push('Email is required.');
    if (cand.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cand.email)) {
      errors.push('Invalid email format.');
    }
    if (cand.phone && !/^\d{10}$/.test(String(cand.phone))) {
      errors.push('Phone must be a 10-digit number if provided.');
    }
    if (cand.emergencyContactNumber && !/^\d{10}$/.test(String(cand.emergencyContactNumber))) {
      errors.push('Emergency Contact Number must be a 10-digit number if provided.');
    }
    if (cand.aadhaarNumber && !/^\d{12}$/.test(String(cand.aadhaarNumber))) {
      errors.push('Aadhaar Number must be a 12-digit number if provided.');
    }
    // PAN Number validation is now optional - only validate format if provided
    if (cand.panNumber && cand.panNumber.trim() && !/[A-Z]{5}[0-9]{4}[A-Z]{1}/.test(cand.panNumber)) {
      errors.push('PAN Number must be in format ABCDE1234F if provided.');
    }
    if (errors.length > 0) {
      return `Row ${rowIndex}: ${errors.join(', ')}`;
    }
    return null;
  }, []);

  const handleImport = useCallback((event) => {
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
    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      setImportError('File size exceeds 5MB limit.');
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
        if (!sheetName) {
          throw new Error('No sheets found in the Excel file.');
        }
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet);

        if (!jsonData || jsonData.length === 0) {
          throw new Error('No data found in the Excel file.');
        }

        const numericFields = ['phone', 'emergencyContactNumber', 'aadhaarNumber'];
        const newCandidates = jsonData.map((row, index) => {
          const safeToString = (value, isNumeric = false) => {
            if (value == null || value === '') return isNumeric ? null : '';
            if (isNumeric) {
              const num = Number(value);
              return isNaN(num) ? null : num;
            }
            return String(value);
          };

          const cand = {
            contractorName: safeToString(row['ContractorName']),
            candidateName: safeToString(row['CandidateName']),
            contractorSupervisor: safeToString(row['ContractorSupervisor']),
            email: safeToString(row['Email']),
            gender: safeToString(row['Gender']),
            bloodGroup: safeToString(row['BloodGroup']),
            maritalStatus: safeToString(row['MaritalStatus']),
            emergencyContactNumber: safeToString(row['EmergencyContactNumber'], true),
            fathersName: safeToString(row["FathersName"]),
            aadhaarNumber: safeToString(row['AadhaarNumber'], true),
            dob: safeToString(row['DOB']),
            panNumber: safeToString(row['PANNumber']),
            photo: safeToString(row['Photo']),
            designation: safeToString(row['Designation']),
            phone: safeToString(row['Phone'], true),
            department: safeToString(row['Department']),
            skills: safeToString(row['Skills']),
            dateOfEngagement: safeToString(row['DateofEngagement']),
            status: safeToString(row['Status']),
            drivingLicenseNumber: safeToString(row['DrivingLicenseNumber']),
            driverLicenseExpiryDate: safeToString(row['DriverLicenseExpiryDate']),
            presentAddress: safeToString(row['PresentAddress']),
            permanentAddress: safeToString(row['PermanentAddress']),
            approvalStatus: safeToString(row['ApprovalStatus']),
            comments: safeToString(row['Comments'])
          };

          const validationError = validateImportedCandidate(cand, index + 2);
          if (validationError) {
            throw new Error(validationError);
          }

          return cand;
        });

        Promise.all(
          newCandidates.map((cand, index) => {
            // Convert to capitalized field names for API
            const apiData = {
              ContractorName: cand.contractorName,
              CandidateName: cand.candidateName,
              ContractorSupervisor: cand.contractorSupervisor,
              Email: cand.email,
              Gender: cand.gender,
              BloodGroup: cand.bloodGroup,
              MaritalStatus: cand.maritalStatus,
              EmergencyContactNumber: cand.emergencyContactNumber,
              Fathersname: cand.fathersName || null,
              AadhaarNumber: cand.aadhaarNumber,
              DOB: cand.dob,
              PANNumber: cand.panNumber,
              Photo: cand.photo,
              Designation: cand.designation,
              Phone: cand.phone,
              Department: cand.department,
              Skills: cand.skills,
              DateOfEngagement: cand.dateOfEngagement,
              Status: cand.status,
              DrivingLicenseNumber: cand.drivingLicenseNumber,
              DriverLicenseExpiryDate: cand.driverLicenseExpiryDate,
              PresentAddress: cand.presentAddress,
              PermanentAddress: cand.permanentAddress,
              ApprovalStatus: cand.approvalStatus,
              Comments: cand.comments
            };
           
            return axios.post('/server/candidate_function/candidates', apiData, { timeout: 5000 })
              .then(response => {
                if (!response?.data?.data?.candidate) {
                  throw new Error(`Unexpected API response structure for row ${index + 2}`);
                }
                return response.data.data.candidate;
              })
              .catch(err => {
                let errorMessage = `Failed to import row ${index + 2}`;
               
                if (err.response?.status === 409) {
                  // Conflict - duplicate email or PAN
                  const serverMessage = err.response?.data?.message || '';
                  if (serverMessage.includes('email')) {
                    errorMessage = `Row ${index + 2}: Email '${cand.email}' already exists`;
                  } else if (serverMessage.includes('PAN')) {
                    errorMessage = `Row ${index + 2}: PAN number '${cand.panNumber}' already exists`;
                  } else {
                    errorMessage = `Row ${index + 2}: ${serverMessage}`;
                  }
                } else if (err.response?.status === 400) {
                  // Bad request - validation error
                  const serverMessage = err.response?.data?.message || '';
                  errorMessage = `Row ${index + 2}: ${serverMessage}`;
                } else {
                  // Other errors
                  errorMessage = `Row ${index + 2}: ${err.response?.data?.message || err.message || 'Unknown error'}`;
                }
               
                console.error(`Import error for candidate at row ${index + 2}:`, apiData, err);
                return { error: errorMessage, row: index + 2, data: apiData };
              });
          })
        )
          .then(results => {
            const successfulImports = results.filter(result => !result?.error);
            const failedImports = results.filter(result => result?.error);
           
            if (successfulImports.length === 0) {
              setImportError('Failed to import any candidates. Please check the data and try again.');
            } else {
              fetchCandidates(); // Refresh the candidate list
             
              let message = `✅ Successfully imported ${successfulImports.length} out of ${newCandidates.length} candidates.`;
              if (failedImports.length > 0) {
                message += `\n\n❌ Failed imports:\n${failedImports.map(f => f.error).join('\n')}`;
              }
              setImportError(message);
             
              // Auto-clear success messages after 8 seconds (only if no failures)
              if (failedImports.length === 0) {
                setTimeout(() => {
                  setImportError('');
                }, 8000);
              }
            }
          })
          .catch(err => {
            setImportError(`❌ Import failed: ${err.message || 'An unexpected error occurred while importing candidates.'}`);
            console.error('Import error:', err);
          })
          .finally(() => {
            setImporting(false);
            fileInputRef.current.value = '';
          });
      } catch (err) {
        setImportError(err.message || 'Failed to parse Excel file.');
        console.error('Excel parse error:', err);
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
  }, [validateImportedCandidate, fetchCandidates]);

  const handleExport = useCallback(() => {
    if (filteredCandidates.length === 0) {
      setExportError('No data to export.');
      return;
    }

    setExporting(true);
    setExportError('');

    try {
      const requiredFields = ['candidateName', 'email'];
      const invalidCandidates = filteredCandidates.filter(cand =>
        !cand || typeof cand !== 'object' || requiredFields.some(field => cand[field] == null)
      );
      if (invalidCandidates.length > 0) {
        console.warn('Some candidates have missing required fields:', invalidCandidates);
        setExportError('Some candidates have missing required fields. Export may be incomplete.');
      }

      const exportData = filteredCandidates.map(cand => ({
        'ContractorName': cand.contractorName || '',
        'CandidateName': cand.candidateName || '',
        'ContractorSupervisor': cand.contractorSupervisor || '',
        'Email': cand.email || '',
        'Gender': cand.gender || '',
        'BloodGroup': cand.bloodGroup || '',
        'MaritalStatus': cand.maritalStatus || '',
        'EmergencyContactNumber': cand.emergencyContactNumber || '',
        "FathersName": cand.fathersName || '',
        'AadhaarNumber': cand.aadhaarNumber || '',
        'DOB': cand.dob || '',
        'PANNumber': cand.panNumber || '',
        'Photo': cand.photo || '',
        'Designation': cand.designation || '',
        'Phone': cand.phone || '',
        'Department': cand.department || '',
        'Skills': cand.skills || '',
        'DateofEngagement': cand.dateOfEngagement || '',
        'Status': cand.status || '',
        'DrivingLicenseNumber': cand.drivingLicenseNumber || '',
        'DriverLicenseExpiryDate': cand.driverLicenseExpiryDate || '',
        'PresentAddress': cand.presentAddress || '',
        'PermanentAddress': cand.permanentAddress || '',
        'ApprovalStatus': cand.approvalStatus || '',
        'Comments': cand.comments || ''
      }));

      const worksheet = XLSX.utils.json_to_sheet(exportData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Candidates');

      XLSX.writeFile(workbook, 'candidates_export.xlsx');
    } catch (err) {
      const errorMessage = err.message || 'Failed to export data to Excel. Please try again.';
      setExportError(errorMessage);
      console.error('Export error:', err);
    } finally {
      setExporting(false);
    }
  }, [filteredCandidates]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowSearchDropdown(false);
      }
     
      // Close all dropdowns when clicking outside
      if (!event.target.closest('[data-dropdown]')) {
        setIsCandidateNameDropdownOpen(false);
        setIsContractorDropdownOpen(false);
        setIsGenderDropdownOpen(false);
        setIsDepartmentDropdownOpen(false);
        setIsDesignationDropdownOpen(false);
        setIsSkillDropdownOpen(false);
        setIsEngagementDateDropdownOpen(false);
      }
    };

    const handleEscapeKey = (event) => {
      if (event.key === 'Escape' && showSearchDropdown) {
        setShowSearchDropdown(false);
      }
    };

    if (showSearchDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEscapeKey);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscapeKey);
    };
  }, [showSearchDropdown]);

  const employmentTypeOptions = [
    { value: '', label: '-Select-' },
    { value: 'Full-Time', label: 'Full-Time' },
    { value: 'Part-Time', label: 'Part-Time' },
    { value: 'Contractor', label: 'Contractor' },
  ];

  const [departmentOptions, setDepartmentOptions] = useState([{ value: '', label: '-Select-' }]);
  const [designationOptions, setDesignationOptions] = useState([{ value: '', label: '-Select-' }]);
  const [showDepartmentDropdown, setShowDepartmentDropdown] = useState(false);
  const [showDesignationDropdown, setShowDesignationDropdown] = useState(false);

  // Fetch departments from API
  const fetchDepartments = useCallback(() => {
    axios
      .get('/server/department_function/departments')
      .then((res) => {
        const departments = res.data.data.departments || [];
        const options = [{ value: '', label: '-Select-' }].concat(
          departments.map((d) => ({
            value: d.departmentName,
            label: d.departmentName,
          }))
        );
        setDepartmentOptions(options);
      })
      .catch((err) => {
        console.error('Failed to fetch departments:', err);
        setDepartmentOptions([{ value: '', label: '-Select-' }]);
      });
  }, []);

  // Fetch designations from API
  const fetchDesignations = useCallback(() => {
    axios
      .get('/server/Designation_function/designations')
      .then((res) => {
        const designations = res.data.data.designations || [];
        const options = [{ value: '', label: '-Select-' }].concat(
          designations.map((d) => ({
            value: d.designationName,
            label: d.designationName,
          }))
        );
        setDesignationOptions(options);
      })
      .catch((err) => {
        console.error('Failed to fetch designations:', err);
        setDesignationOptions([{ value: '', label: '-Select-' }]);
      });
  }, []);

  useEffect(() => {
    fetchDepartments();
    fetchDesignations();
  }, [fetchDepartments, fetchDesignations]);

  // Fetch all candidate names for dropdown
  const fetchAllCandidateNames = useCallback(async () => {
    setLoadingCandidateNames(true);
    try {
      const params = { showAll: true };
      if (userRole && userEmail) {
        params.userRole = userRole;
        params.userEmail = userEmail;
      }
     
      const response = await axios.get('/server/candidate_function/candidates', {
        params,
        timeout: 10000
      });
     
      if (response?.data?.data?.candidates) {
        const allCandidates = response.data.data.candidates;
        const uniqueNames = [...new Set(allCandidates
          .map(c => c.candidateName)
          .filter(name => name && name.trim() !== '')
        )].sort();
        setCandidateNames(uniqueNames);
      }
    } catch (err) {
      console.error('Failed to fetch candidate names:', err);
    } finally {
      setLoadingCandidateNames(false);
    }
  }, [userRole, userEmail]);

  // Fetch all contractors for dropdown
  const fetchAllContractors = useCallback(async () => {
    setLoadingContractors(true);
    try {
      const params = { showAll: true };
      if (userRole && userEmail) {
        params.userRole = userRole;
        params.userEmail = userEmail;
      }
     
      const response = await axios.get('/server/candidate_function/candidates', {
        params,
        timeout: 10000
      });
     
      if (response?.data?.data?.candidates) {
        const allCandidates = response.data.data.candidates;
        const uniqueContractors = [...new Set(allCandidates
          .map(c => c.contractorName)
          .filter(name => name && name.trim() !== '')
        )].sort();
        setContractors(uniqueContractors);
      }
    } catch (err) {
      console.error('Failed to fetch contractors:', err);
    } finally {
      setLoadingContractors(false);
    }
  }, [userRole, userEmail]);

  // Fetch all genders for dropdown
  const fetchAllGenders = useCallback(async () => {
    setLoadingGenders(true);
    try {
      const params = { showAll: true };
      if (userRole && userEmail) {
        params.userRole = userRole;
        params.userEmail = userEmail;
      }
     
      const response = await axios.get('/server/candidate_function/candidates', {
        params,
        timeout: 10000
      });
     
      if (response?.data?.data?.candidates) {
        const allCandidates = response.data.data.candidates;
        const uniqueGenders = [...new Set(allCandidates
          .map(c => c.gender)
          .filter(gender => gender && gender.trim() !== '')
        )].sort();
        setGenders(uniqueGenders);
      }
    } catch (err) {
      console.error('Failed to fetch genders:', err);
    } finally {
      setLoadingGenders(false);
    }
  }, [userRole, userEmail]);

  // Fetch all departments for dropdown (reuse existing function)
  const fetchAllDepartmentsForFilter = useCallback(async () => {
    setLoadingDepartments(true);
    try {
      const response = await axios.get('/server/department_function/departments', {
        timeout: 10000
      });
     
      if (response?.data?.data?.departments) {
        const departmentsData = response.data.data.departments;
        const uniqueDepartments = [...new Set(departmentsData
          .map(d => d.departmentName)
          .filter(name => name && name.trim() !== '')
        )].sort();
        setFilterDepartments(uniqueDepartments);
      }
    } catch (err) {
      console.error('Failed to fetch departments:', err);
    } finally {
      setLoadingDepartments(false);
    }
  }, []);

  // Fetch all designations for dropdown (reuse existing function)
  const fetchAllDesignationsForFilter = useCallback(async () => {
    setLoadingDesignations(true);
    try {
      const response = await axios.get('/server/Designation_function/designations', {
        timeout: 10000
      });
     
      if (response?.data?.data?.designations) {
        const designationsData = response.data.data.designations;
        const uniqueDesignations = [...new Set(designationsData
          .map(d => d.designationName)
          .filter(name => name && name.trim() !== '')
        )].sort();
        setFilterDesignations(uniqueDesignations);
      }
    } catch (err) {
      console.error('Failed to fetch designations:', err);
    } finally {
      setLoadingDesignations(false);
    }
  }, []);

  // Fetch all skills for dropdown
  const fetchAllSkills = useCallback(async () => {
    setLoadingSkills(true);
    try {
      const params = { showAll: true };
      if (userRole && userEmail) {
        params.userRole = userRole;
        params.userEmail = userEmail;
      }
     
      const response = await axios.get('/server/candidate_function/candidates', {
        params,
        timeout: 10000
      });
     
      if (response?.data?.data?.candidates) {
        const allCandidates = response.data.data.candidates;
        const allSkills = [];
        allCandidates.forEach(candidate => {
          if (candidate.skills) {
            if (Array.isArray(candidate.skills)) {
              allSkills.push(...candidate.skills);
            } else if (typeof candidate.skills === 'string' && candidate.skills.trim() !== '') {
              const skillsArray = candidate.skills.split(',').map(skill => skill.trim()).filter(skill => skill !== '');
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
  }, [userRole, userEmail]);

  // Fetch all engagement dates for dropdown
  const fetchAllEngagementDates = useCallback(async () => {
    setLoadingEngagementDates(true);
    try {
      const params = { showAll: true };
      if (userRole && userEmail) {
        params.userRole = userRole;
        params.userEmail = userEmail;
      }
     
      const response = await axios.get('/server/candidate_function/candidates', {
        params,
        timeout: 10000
      });
     
      if (response?.data?.data?.candidates) {
        const allCandidates = response.data.data.candidates;
        const uniqueDates = [...new Set(allCandidates
          .map(c => c.dateOfEngagement)
          .filter(date => date && date.trim() !== '')
        )].sort();
        setEngagementDates(uniqueDates);
      }
    } catch (err) {
      console.error('Failed to fetch engagement dates:', err);
    } finally {
      setLoadingEngagementDates(false);
    }
  }, [userRole, userEmail]);

  // Selection handlers for dropdowns
  const handleCandidateNameSelect = useCallback((name) => {
    setSearchFields(prev => ({
      ...prev,
      candidateName: { ...prev.candidateName, selectedName: name }
    }));
    setIsCandidateNameDropdownOpen(false);
    setCandidateNameSearch('');
  }, []);

  const handleContractorSelect = useCallback((contractor) => {
    setSearchFields(prev => ({
      ...prev,
      contractorName: { ...prev.contractorName, selectedContractor: contractor }
    }));
    setIsContractorDropdownOpen(false);
    setContractorSearch('');
  }, []);

  const handleGenderSelect = useCallback((gender) => {
    setSearchFields(prev => ({
      ...prev,
      gender: { ...prev.gender, selectedGender: gender }
    }));
    setIsGenderDropdownOpen(false);
    setGenderSearch('');
  }, []);

  const handleDepartmentSelect = useCallback((department) => {
    setSearchFields(prev => ({
      ...prev,
      department: { ...prev.department, selectedDepartment: department }
    }));
    setIsDepartmentDropdownOpen(false);
    setDepartmentSearch('');
  }, []);

  const handleDesignationSelect = useCallback((designation) => {
    setSearchFields(prev => ({
      ...prev,
      designation: { ...prev.designation, selectedDesignation: designation }
    }));
    setIsDesignationDropdownOpen(false);
    setDesignationSearch('');
  }, []);

  const handleSkillSelect = useCallback((skill) => {
    setSearchFields(prev => ({
      ...prev,
      skills: { ...prev.skills, selectedSkill: skill }
    }));
    setIsSkillDropdownOpen(false);
    setSkillSearch('');
  }, []);

  const handleEngagementDateSelect = useCallback((date) => {
    setSearchFields(prev => ({
      ...prev,
      dateOfEngagement: { ...prev.dateOfEngagement, selectedDate: date }
    }));
    setIsEngagementDateDropdownOpen(false);
    setEngagementDateSearch('');
  }, []);

  // Helper function to create dropdown UI
  const createDropdownUI = (field, label, data, searchValue, setSearchValue, isOpen, setIsOpen, onSelect, loading, filteredData) => {
    const getSelectedValue = () => {
      const fieldData = searchFields[field];
      if (field === 'candidateName') return fieldData.selectedName;
      if (field === 'contractorName') return fieldData.selectedContractor;
      if (field === 'gender') return fieldData.selectedGender;
      if (field === 'department') return fieldData.selectedDepartment;
      if (field === 'designation') return fieldData.selectedDesignation;
      if (field === 'skills') return fieldData.selectedSkill;
      if (field === 'dateOfEngagement') return fieldData.selectedDate;
      return '';
    };

    const selectedValue = getSelectedValue();

    return (
      <div style={{ position: 'relative' }} data-dropdown={field}>
        <div
          onClick={() => setIsOpen(prev => {
            if (!prev && data.length === 0) {
              console.log(`Opening ${field} dropdown, data length:`, data.length);
              if (field === 'candidateName') fetchAllCandidateNames();
              else if (field === 'contractorName') fetchAllContractors();
              else if (field === 'gender') fetchAllGenders();
              else if (field === 'department') fetchAllDepartmentsForFilter();
              else if (field === 'designation') fetchAllDesignationsForFilter();
              else if (field === 'skills') fetchAllSkills();
              else if (field === 'dateOfEngagement') fetchAllEngagementDates();
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
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              placeholder={selectedValue ? selectedValue : `Search ${label.toLowerCase()}...`}
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
                  Loading {label.toLowerCase()}...
                </div>
              ) : filteredData.length > 0 ? (
                filteredData.map((item) => (
                  <div
                    key={item}
                    onClick={() => onSelect(item)}
                    style={{
                      padding: '8px 12px',
                      cursor: 'pointer',
                      fontSize: '14px',
                      borderBottom: '1px solid #f3f4f6',
                      backgroundColor: selectedValue === item ? '#e3f2fd' : 'white'
                    }}
                    onMouseEnter={(e) => {
                      if (selectedValue !== item) {
                        e.target.style.backgroundColor = '#f9fafb';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (selectedValue !== item) {
                        e.target.style.backgroundColor = 'white';
                      }
                    }}
                  >
                    {item}
                  </div>
                ))
              ) : (
                <div style={{
                  padding: '8px 12px',
                  fontSize: '14px',
                  color: '#6b7280',
                  textAlign: 'center'
                }}>
                  No {label.toLowerCase()} found
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  // Filtered data for dropdowns
  const filteredCandidateNames = candidateNames.filter(name =>
    name.toLowerCase().includes(candidateNameSearch.toLowerCase())
  );
  const filteredContractors = contractors.filter(contractor =>
    contractor.toLowerCase().includes(contractorSearch.toLowerCase())
  );
  const filteredGenders = genders.filter(gender =>
    gender.toLowerCase().includes(genderSearch.toLowerCase())
  );
  const filteredDepartments = filterDepartments.filter(department =>
    department.toLowerCase().includes(departmentSearch.toLowerCase())
  );
  const filteredDesignations = filterDesignations.filter(designation =>
    designation.toLowerCase().includes(designationSearch.toLowerCase())
  );
  const filteredSkills = filterSkills.filter(skill =>
    skill.toLowerCase().includes(skillSearch.toLowerCase())
  );
  const filteredEngagementDates = engagementDates.filter(date =>
    date.toLowerCase().includes(engagementDateSearch.toLowerCase())
  );

  const gradeLevelOptions = [
    { value: '', label: '-Select-' },
    { value: 'Junior', label: 'Junior' },
    { value: 'Mid-Level', label: 'Mid-Level' },
    { value: 'Senior', label: 'Senior' },
    { value: 'Lead', label: 'Lead' },
  ];

  const reportingToOptions = [
    { value: '', label: '-Select-' },
    { value: 'Manager A', label: 'Manager A' },
    { value: 'Manager B', label: 'Manager B' },
    { value: 'Manager C', label: 'Manager C' },
  ];

  const hrPartnerOptions = [
    { value: '', label: '-Select-' },
    { value: 'HR A', label: 'HR A' },
    { value: 'HR B', label: 'HR B' },
    { value: 'HR C', label: 'HR C' },
  ];

  const nationalHeadOptions = [
    { value: '', label: '-Select-' },
    { value: 'Head A', label: 'Head A' },
    { value: 'Head B', label: 'Head B' },
    { value: 'Head C', label: 'Head C' },
  ];

  const genderOptions = [
    { value: '', label: '-Select-' },
    { value: 'Male', label: 'Male' },
    { value: 'Female', label: 'Female' },
    { value: 'Other', label: 'Other' },
  ];

  const bloodGroupOptions = [
    { value: '', label: '-Select-' },
    { value: 'A+', label: 'A+' },
    { value: 'A-', label: 'A-' },
    { value: 'B+', label: 'B+' },
    { value: 'B-', label: 'B-' },
    { value: 'AB+', label: 'AB+' },
    { value: 'AB-', label: 'AB-' },
    { value: 'O+', label: 'O+' },
    { value: 'O-', label: 'O-' },
  ];

  const maritalStatusOptions = [
    { value: '', label: '-Select-' },
    { value: 'Single', label: 'Single' },
    { value: 'Married', label: 'Married' },
    { value: 'Divorced', label: 'Divorced' },
    { value: 'Widowed', label: 'Widowed' },
  ];

  const countryList = [
    "Afghanistan", "Albania", "Algeria", "Andorra", "Angola", "Antigua and Barbuda", "Argentina", "Armenia", "Australia", "Austria",
    "Azerbaijan", "Bahamas", "Bahrain", "Bangladesh", "Barbados", "Belarus", "Belgium", "Belize", "Benin", "Bhutan", "Bolivia",
    "Bosnia and Herzegovina", "Botswana", "Brazil", "Brunei", "Bulgaria", "Burkina Faso", "Burundi", "Cabo Verde", "Cambodia", "Cameroon",
    "Canada", "Central African Republic", "Chad", "Chile", "China", "Colombia", "Comoros", "Congo (Congo-Brazzaville)", "Costa Rica", "Croatia",
    "Cuba", "Cyprus", "Czechia (Czech Republic)", "Democratic Republic of the Congo", "Denmark", "Djibouti", "Dominica", "Dominican Republic", "Ecuador", "Egypt",
    "El Salvador", "Equatorial Guinea", "Eritrea", "Estonia", "Eswatini (fmr. \"Swaziland\")", "Ethiopia", "Fiji", "Finland", "France", "Gabon",
    "Gambia", "Georgia", "Germany", "Ghana", "Greece", "Grenada", "Guatemala", "Guinea", "Guinea-Bissau", "Guyana",
    "Haiti", "Holy See", "Honduras", "Hungary", "Iceland", "India", "Indonesia", "Iran", "Iraq", "Ireland",
    "Israel", "Italy", "Jamaica", "Japan", "Jordan", "Kazakhstan", "Kenya", "Kiribati", "Kuwait", "Kyrgyzstan",
    "Laos", "Latvia", "Lebanon", "Lesotho", "Liberia", "Libya", "Liechtenstein", "Lithuania", "Luxembourg", "Madagascar",
    "Malawi", "Malaysia", "Maldives", "Mali", "Malta", "Marshall Islands", "Mauritania", "Mauritius", "Mexico", "Micronesia",
    "Moldova", "Monaco", "Mongolia", "Montenegro", "Morocco", "Mozambique", "Myanmar (formerly Burma)", "Namibia", "Nauru", "Nepal",
    "Netherlands", "New Zealand", "Nicaragua", "Niger", "Nigeria", "North Korea", "North Macedonia", "Norway", "Oman", "Pakistan",
    "Palau", "Palestine State", "Panama", "Papua New Guinea", "Paraguay", "Peru", "Philippines", "Poland", "Portugal", "Qatar",
    "Romania", "Russia", "Rwanda", "Saint Kitts and Nevis", "Saint Lucia", "Saint Vincent and the Grenadines", "Samoa", "San Marino", "Sao Tome and Principe", "Saudi Arabia",
    "Senegal", "Serbia", "Seychelles", "Sierra Leone", "Singapore", "Slovakia", "Slovenia", "Solomon Islands", "Somalia", "South Africa",
    "South Korea", "South Sudan", "Spain", "Sri Lanka", "Sudan", "Suriname", "Sweden", "Switzerland", "Syria", "Tajikistan",
    "Tanzania", "Thailand", "Timor-Leste", "Togo", "Tonga", "Trinidad and Tobago", "Tunisia", "Turkey", "Turkmenistan", "Tuvalu",
    "Uganda", "Ukraine", "United Arab Emirates", "United Kingdom", "United States of America", "Uruguay", "Uzbekistan", "Vanuatu", "Venezuela", "Vietnam",
    "Yemen", "Zambia", "Zimbabwe"
  ];

  const countryOptions = countryList.map((country) => ({
    value: country,
    label: country,
  }));

  const onChange = useCallback((e) => {
    const { name, value } = e.target;
    console.log(`Field changed: ${name}=${value}`);
    setForm((prev) => ({ ...prev, [name]: value }));
    setFormError('');
  }, []);

  const handleSelectCandidate = useCallback((id) => {
    setSelectedCandidates((prev) =>
      prev.includes(id) ? prev.filter((candId) => candId !== id) : [...prev, id]
    );
  }, []);

  const handleSelectAll = useCallback(() => {
    if (allSelected) {
      // If all are selected, deselect all
      setSelectedCandidates([]);
    } else {
      // If not all are selected, select all
      const allIds = filteredCandidates.map(candidate => candidate.id);
      setSelectedCandidates(allIds);
    }
  }, [allSelected, filteredCandidates]);

  const handleMassDelete = useCallback(() => {
    if (selectedCandidates.length === 0) {
      setMassDeleteError('Please select at least one candidate to delete.');
      return;
    }

    if (!window.confirm(`Are you sure you want to delete ${selectedCandidates.length} candidate(s)?`)) {
      return;
    }

    setDeletingMultiple(true);
    setMassDeleteError('');

    Promise.all(
      selectedCandidates.map((id) =>
        axios.delete(`/server/candidate_function/candidates/${id}`, { timeout: 5000 }).catch((err) => {
          const errorMessage = err.response?.data?.message || `Failed to delete candidate (ID: ${id})`;
          console.error(`Mass delete error for ID ${id}:`, err);
          return { error: errorMessage, id };
        })
      )
    )
      .then((results) => {
        const failedDeletions = results.filter((result) => result?.error);
        if (failedDeletions.length > 0) {
          setMassDeleteError(
            'Failed to delete some candidates: ' +
            failedDeletions.map((f) => `ID ${f.id}: ${f.error}`).join('; ')
          );
        }
        fetchCandidates();
        setSelectedCandidates([]);
      })
      .catch((err) => {
        setMassDeleteError('An unexpected error occurred while deleting candidates.');
        console.error('Mass delete error:', err);
      })
      .finally(() => setDeletingMultiple(false));
  }, [selectedCandidates, fetchCandidates]);

  const validateForm = useCallback(() => {
    const errors = {};
    console.log('Validating form with data:', form);
   
    // Contractor Name validation (MANDATORY)
    if (!form.contractorName || !form.contractorName.trim()) {
      errors.contractorName = 'Contractor Name is required.';
      console.log('Validation failed: Contractor Name is required');
    }
   
    // Candidate Name validation (MANDATORY)
    if (!form.candidateName.trim()) {
      errors.candidateName = 'Candidate Name is required.';
      console.log('Validation failed: Candidate Name is required');
    }

    // Contractor Supervisor validation (Optional)
    if (form.contractorSupervisor && form.contractorSupervisor.trim()) {
      // Optional now
    }
   
    // Email validation (MANDATORY)
    if (!form.email.trim()) {
      errors.email = 'Email is required.';
      console.log('Validation failed: Email is required');
    } else {
      if (form.email !== form.email.toLowerCase()) {
        errors.email = 'Email must be in lowercase.';
        console.log('Validation failed: Email must be in lowercase');
      } else if (!form.email.includes('@')) {
        errors.email = 'Email must contain "@" symbol.';
        console.log('Validation failed: Email must contain @ symbol');
      } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
        errors.email = 'Invalid email format.';
        console.log('Validation failed: Invalid email format');
      }
    }

    // Gender validation (MANDATORY)
    if (!form.gender || !form.gender.trim()) {
      errors.gender = 'Gender is required.';
      console.log('Validation failed: Gender is required');
    }

    // Blood Group validation (Optional)
    if (form.bloodGroup && form.bloodGroup.trim()) {
      // Optional now
    }

    // Photo validation (Optional)
    if (!isEditing && !pendingPhoto && !form.photoFileId && !form.photo) {
      // Photo is optional
    }

    // Phone validation (Optional)
    if (form.phone && form.phone.trim()) {
      const phone = form.phone.replace(/\D/g, '');
      if (phone.length !== 10) {
        errors.phone = 'Phone must be a 10-digit number.';
        console.log('Validation failed: Phone must be 10 digits');
      }
    }

    // Address validation (Optional) - Present Address
    if (form.presentAddressLine1 && form.presentAddressLine1.trim()) {
      // Optional
    }
    if (form.presentCity && form.presentCity.trim()) {
      // Optional
    }
    if (form.presentState && form.presentState.trim()) {
      // Optional
    }
    if (form.presentCountry && form.presentCountry.trim()) {
      // Optional
    }
   
    // Aadhaar Number validation (Optional)
    if (form.aadhaarNumber && form.aadhaarNumber.trim()) {
      if (!/^\d{12}$/.test(String(form.aadhaarNumber).trim())) {
         errors.aadhaarNumber = 'Aadhaar Number must be a 12-digit number.';
         console.log('Validation failed: Aadhaar Number must be 12 digits');
      }
    }
   
    // Date of Birth validation (MANDATORY)
    if (!form.dob || !form.dob.trim()) {
      errors.dob = 'Date of Birth is required.';
      console.log('Validation failed: Date of Birth is required');
    } else {
      // Check if age is at least 18
      const dobDate = new Date(form.dob);
      const today = new Date();
      let age = today.getFullYear() - dobDate.getFullYear();
      const m = today.getMonth() - dobDate.getMonth();
      if (m < 0 || (m === 0 && today.getDate() < dobDate.getDate())) {
        age--;
      }
      if (isNaN(dobDate.getTime())) {
        errors.dob = 'Invalid Date of Birth.';
      } else if (age < 18) {
        errors.dob = 'Candidate must be at least 18 years old.';
      }
    }

    // Emergency Contact validation (Optional)
    if (form.emergencyContactNumber && form.emergencyContactNumber.trim()) {
      const emergencyContactNumber = form.emergencyContactNumber.replace(/\D/g, '');
      if (emergencyContactNumber.length !== 10) {
        errors.emergencyContactNumber = 'Emergency Contact Number must be a 10-digit number.';
      }
    }

    // Department validation (Optional)
    if (form.department && form.department.trim()) {
      // Department is optional now
    }

    // Driving License validation (Optional)
    if (form.drivingLicenseNumber && form.drivingLicenseNumber.trim()) {
      const dl = form.drivingLicenseNumber.replace(/[\s-]/g, '').toUpperCase();
      if (!/^[A-Z]{2}[0-9]{2}[0-9]{4}[0-9]{7}$/.test(dl)) {
        errors.drivingLicenseNumber = 'Driving License Number must be in the format: SS-00-YYYY-0000000 (e.g., MH12 20110001234)';
      }
    }

    // PAN Number validation (Optional)
    if (form.panNumber && form.panNumber.trim()) {
      if (form.panNumber.length >= 4 && form.panNumber[3].toUpperCase() !== 'P') {
        errors.panNumber = 'PAN Number: 4th character must be "P".';
      }
    }

    // Approval Status validation (MANDATORY for Admins only)
    if (userRole === 'App Administrator') {
      if (!form.approvalStatus || !form.approvalStatus.trim()) {
        errors.approvalStatus = 'Approval Status is required.';
        console.log('Validation failed: Approval Status is required');
      }
    }

    setFieldErrors(errors);
   
    if (Object.keys(errors).length > 0) {
      console.log('Validation failed with errors:', errors);
      setFieldErrors(errors);
      setFormError('Please fix the errors below.');
      return false;
    }
   
    console.log('All validations passed successfully');
    setFieldErrors({});
    setFormError('');
    return true;
  }, [form, pendingPhoto]);

  const saveCandidate = useCallback(
    (e) => {
      e.preventDefault();
      console.log('Form validation starting...');
      console.log('Current form data:', form);
      console.log('Is editing:', isEditing);
      console.log('Pending photo:', pendingPhoto);
     
      if (!validateForm()) {
        console.log('Form validation failed - check required fields');
        return;
      }
      console.log('Form validation passed - proceeding with submission');
      setSubmitting(true);

      const cleanedForm = {
        ContractorName: form.contractorName || null,
        CandidateName: form.candidateName || null,
        ContractorSupervisor: form.contractorSupervisor || null,
        Email: form.email || null,
        Gender: form.gender || null,
        BloodGroup: form.bloodGroup || null,
        MaritalStatus: form.maritalStatus || null,
        EmergencyContactNumber: form.emergencyContactNumber || null,
        Fathersname: form.fathersName || null,
        AadhaarNumber: form.aadhaarNumber || null,
        DOB: form.dob || null,
        PANNumber: form.panNumber || null,
        photo: form.photo || null,
        photoFileId: form.photoFileId || null,
        Designation: form.designation || null,
        Phone: form.phone || null,
        Department: form.department || null,
        Skills: form.skills || null,
        DateOfEngagement: form.dateOfEngagement || null,
        Status: form.status || null,
        DrivingLicenseNumber: form.drivingLicenseNumber || null,
        DriverLicenseExpiryDate: form.driverLicenseExpiryDate || null,
        PresentAddressLine1: form.presentAddressLine1 || null,
        PresentCity: form.presentCity || null,
        PresentState: form.presentState || null,
        PresentPostalCode: form.presentPostalCode || null,
        PresentCountry: form.presentCountry || null,
        PermanentAddressLine1: form.permanentAddressLine1 || null,
        PermanentCity: form.permanentCity || null,
        PermanentState: form.permanentState || null,
        PermanentPostalCode: form.permanentPostalCode || null,
        PermanentCountry: form.permanentCountry || null,
        ApprovalStatus: form.approvalStatus || null,
        Comments: form.comments || null,
        phoneCountryCode: form.phoneCountryCode,
        emergencyCountryCode: form.emergencyCountryCode,
        educationDetails: educationDetails || [],
        // Flatten first education detail for backend columns
        Qualification: (educationDetails && educationDetails[0] && educationDetails[0].qualification) || null,
        InstitutionName: (educationDetails && educationDetails[0] && educationDetails[0].institution) || null,
        FieldofStudy: (educationDetails && educationDetails[0] && educationDetails[0].fieldOfStudy) || null,
        YearofCompletion: (educationDetails && educationDetails[0] && educationDetails[0].yearOfCompletion) || null,
        Percent: (educationDetails && educationDetails[0] && educationDetails[0].percent) || null,

      };
     
      const formData = new FormData();
      formData.append('data', JSON.stringify(cleanedForm));
      if (pendingPhoto && pendingPhoto instanceof File) {
        console.log('Adding photo to form data:', pendingPhoto.name, pendingPhoto.size, pendingPhoto.type);
        formData.append('photo', pendingPhoto);
      } else {
        console.log('No pending photo to upload');
        if (isEditing) {
          console.log('Editing mode - preserving existing photo if available');
        }
      }

      console.log('Submitting candidate cleanedForm:', cleanedForm);
      console.log('Pending photo:', pendingPhoto);
      console.log('Is editing:', isEditing, 'Editing ID:', editingCandidateId);
      console.log('Form data entries:');
      for (let [key, value] of formData.entries()) {
        if (key === 'photo') {
          console.log(key, ':', value instanceof File ? `File: ${value.name} (${value.size} bytes, ${value.type})` : value);
        } else {
          console.log(key, ':', value);
        }
      }
      const request = isEditing
        ? axios.put(`/server/candidate_function/candidates/${editingCandidateId}`, formData, { timeout: 15000 })
        : axios.post('/server/candidate_function/candidates', formData, { timeout: 15000 });

    request
      .then((response) => {
        console.log('Candidate saved successfully:', response.data);
        console.log('Response candidate data:', response.data?.data?.candidate);
        console.log('Photo data in response:', {
          photo: response.data?.data?.candidate?.photo,
          photoFileId: response.data?.data?.candidate?.photoFileId
        });
       
        if (!response?.data?.data?.candidate) {
          throw new Error('Unexpected API response structure');
        }

        // Show success message
        setFormError('');
        let successMsg = isEditing ? 'Candidate updated successfully!' : 'Candidate added successfully!';
       
        // Check if employee was created from approved candidate
        if (isEditing && response.data?.data?.employeeCreated) {
          const employeeDetails = response.data?.data?.employeeCreatedDetails;
          if (employeeDetails?.newEmp) {
            successMsg += ' Employee record has been automatically created.';
          } else if (employeeDetails?.reason === 'employee_exists') {
            successMsg += ' Note: Employee record already exists for this candidate.';
          }
        }
       
        setSuccessMessage(successMsg);

        // Increment candidate added count and update notifications for specific emails
        if (!isEditing && (userEmail === 'afrindinu29@gmail.com' || userEmail === 'sneha@sspower.com')) {
          setCandidateAddedCount(prev => prev + 1);
          setRecentActivities(prev => [{
            icon: '👥',
            title: cleanedForm.CandidateName,
            description: `${cleanedForm.CandidateName} has been added to the system`,
            time: 'Just now'
          }, ...prev.slice(0, 3)]); // Keep only latest 4 activities
        }

        // Clear success message after 3 seconds
        setTimeout(() => {
          setSuccessMessage('');
        }, 3000);
       
        // Reset form immediately
        setForm({
          contractorName: '',
          candidateName: '',
          contractorSupervisor: '',
          email: '',
          gender: '',
          bloodGroup: '',
          maritalStatus: '',
          emergencyContactNumber: '',
          fathersName: '',
          aadhaarNumber: '',
          dob: '',
          panNumber: '',
          photo: null,
          photoFileId: null,
          designation: '',
          phone: '',
          department: '',
          skills: '',
          dateOfEngagement: '',
          status: '',
          drivingLicenseNumber: '',
          driverLicenseExpiryDate: '',
          presentAddress: '',
          permanentAddress: '',
          approvalStatus: '',
          comments: '',
          presentAddressLine1: '',
          presentCity: '',
          presentState: '',
          presentPostalCode: '',
          presentCountry: '',
          permanentAddressLine1: '',
          permanentCity: '',
          permanentState: '',
          permanentPostalCode: '',
          permanentCountry: '',
          phoneCountryCode: "+91",
          emergencyCountryCode: "+91",
        });
       
        // Reset education details
        setEducationDetails([{
          qualification: '',
          institution: '',
          fieldOfStudy: '',
          yearOfCompletion: '',
          percent: ''
        }]);
       
        // Close form
        setShowForm(false);
        setIsEditing(false);
        setEditingCandidateId(null);
        setPendingPhoto(null);
        setPhotoUploadError(null);
        setFieldErrors({});
       
        // Reset page to 1 and refresh candidates list
        // Use a small delay to ensure backend has processed the new candidate
        console.log('Refreshing candidates list after adding candidate...');
       
        // First reset page to 1 - this will trigger useEffect to fetch with page=1
        setPage(1);
       
        // Also explicitly fetch after a delay to ensure backend has processed
        // This handles cases where the useEffect might not trigger immediately
        setTimeout(() => {
          fetchCandidates();
        }, 500);
       
        // Force refresh of any cached images by adding timestamp
        if (isEditing) {
          console.log('Forcing image cache refresh for edited candidate');
          // This will help ensure the updated photo is displayed
          setTimeout(() => {
            const images = document.querySelectorAll(`img[src*="/server/candidate_function/candidates/${editingCandidateId}/file/photo"]`);
            images.forEach(img => {
              const originalSrc = img.src;
              img.src = originalSrc + '?t=' + Date.now();
            });
          }, 1000);
        }
      })
      .catch((err) => {
        const serverError = err.response?.data?.message || (isEditing ? 'Failed to update candidate.' : 'Failed to add candidate.');
        setFormError(serverError);
        console.error('Save candidate error:', err);
      })
      .finally(() => setSubmitting(false));
  },
  [form, isEditing, editingCandidateId, validateForm, fetchCandidates, educationDetails, pendingPhoto]
);

  const removeCandidate = useCallback((id) => {
    setCandidates((prev) => prev.filter((cand) => cand.id !== id));
    setFilteredCandidates((prev) => prev.filter((cand) => cand.id !== id));
    setSelectedCandidates((prev) => prev.filter((candId) => candId !== id));
  }, []);

  const editCandidate = useCallback((candidate) => {
    setForm({
      contractorName: candidate.contractorName,
      candidateName: candidate.candidateName,
      contractorSupervisor: candidate.contractorSupervisor,
      email: candidate.email,
      gender: candidate.gender,
      bloodGroup: candidate.bloodGroup,
      maritalStatus: candidate.maritalStatus,
      emergencyContactNumber: candidate.emergencyContactNumber,
      fathersName: candidate.fathersName,
      aadhaarNumber: candidate.aadhaarNumber,
      dob: candidate.dob,
      panNumber: candidate.panNumber,
      photo: candidate.photo,
      photoFileId: candidate.photoFileId,
      designation: candidate.designation,
      phone: candidate.phone,
      department: candidate.department,
      skills: candidate.skills,
      dateOfEngagement: candidate.dateOfEngagement,
      status: candidate.status,
      drivingLicenseNumber: candidate.drivingLicenseNumber,
      driverLicenseExpiryDate: candidate.driverLicenseExpiryDate,
      approvalStatus: candidate.approvalStatus,
      comments: candidate.comments,
      presentAddressLine1: candidate.presentAddressLine1,
      presentCity: candidate.presentCity,
      presentState: candidate.presentState,
      presentPostalCode: candidate.presentPostalCode,
      presentCountry: candidate.presentCountry,
      permanentAddressLine1: candidate.permanentAddressLine1,
      permanentCity: candidate.permanentCity,
      permanentState: candidate.permanentState,
      permanentPostalCode: candidate.permanentPostalCode,
      permanentCountry: candidate.permanentCountry,
      phoneCountryCode: candidate.phoneCountryCode,
      emergencyCountryCode: candidate.emergencyCountryCode,
    });
    // Prefill education details from flat fields if present
    setEducationDetails([
      {
        qualification: candidate.qualification || '',
        institution: candidate.institution || '',
        fieldOfStudy: candidate.fieldOfStudy || '',
        yearOfCompletion: candidate.yearOfCompletion || '',
        percent: candidate.percent || ''
      }
    ]);
    setIsEditing(true);
    setEditingCandidateId(candidate.id);
    setShowForm(true);
    // Reset pendingPhoto when editing to ensure clean state
    setPendingPhoto(null);
    setPhotoUploadError(null);
    setFieldErrors({});
    setFormError('');
  }, []);

  const toggleForm = useCallback(() => {
    setShowForm((prev) => !prev);
    setFormError('');
    setFieldErrors({});
    setSuccessMessage('');

    // Scroll to top when opening form
    if (!showForm) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    setForm({
      contractorName: '',
      candidateName: '',
      contractorSupervisor: '',
      email: '',
      gender: '',
      bloodGroup: '',
      maritalStatus: '',
      emergencyContactNumber: '',
      fathersName: '',
      aadhaarNumber: '',
      dob: '',
      panNumber: '',
      photo: null,
      photoFileId: null,
      designation: '',
      phone: '',
      department: '',
      skills: '',
      dateOfEngagement: '',
      status: '',
      drivingLicenseNumber: '',
      driverLicenseExpiryDate: '',
      presentAddress: '',
      permanentAddress: '',
      approvalStatus: '',
      comments: '',
      presentAddressLine1: '',
      presentCity: '',
      presentState: '',
      presentPostalCode: '',
      presentCountry: '',
      permanentAddressLine1: '',
      permanentCity: '',
      permanentState: '',
      permanentPostalCode: '',
      permanentCountry: '',
      phoneCountryCode: "+91",
      emergencyCountryCode: "+91",
    });
    // Reset education details to initial state
    setEducationDetails([{
      qualification: '',
      institution: '',
      fieldOfStudy: '',
      yearOfCompletion: '',
      percent: ''
    }]);
    setIsEditing(false);
    setEditingCandidateId(null);
    setPendingPhoto(null);
    setPhotoUploadError(null);
  }, []);

  // Add contractorOptions state
  const [contractorOptions, setContractorOptions] = useState([{ value: '', label: '-Select-' }]);
 
  // Add contractorSupervisorOptions state (separate from contractor names)
  const [contractorSupervisorOptions, setContractorSupervisorOptions] = useState([
    { value: '', label: '-Select-' }
  ]);

  // Helper function to get contractor name for App User
  const getContractorNameForUser = useCallback((email) => {
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
    } else if (email === "afrindinusha@gmail.com" || email === "rpdmanpowerservice@gmail.com" || email === "ramachandran23488@gmail.com") {
      return "R.P.D Facility Management Services";
    } else if (email === "afrinatlin@gmail.com" || email === "samuelenterprisesms@gmail.com") {
      // For Samuel, we'll need to query the database, but for now return a common variation
      // The backend will handle finding the exact match
      return "Samuel Enterprise"; // Common variation, backend will match similar
    } else if (email === "dinushaafrin@gmail.com" || email === "vijaybalaji701@gmail.com") {
      return "Sri Balaji Enterprises";
    } else if (email === "afrindinu14@gmail.com" || email === "vaishnavi.a@buildhr.co.in") {
      return "Yashaswi Academy for Skills";
    }
   
    return null;
  }, []);

  // Normalize whitespace in contractor and user names (collapse multiple spaces)
  const normalizeName = (s) => (s || '').replace(/\s+/g, ' ').trim();

  // Fetch contractors on mount
  useEffect(() => {
    axios
      .get('/server/Contracters_function/contractors')
      .then((res) => {
        const contractors = res.data.data.contractors || [];
        let filteredContractors = contractors;
       
        // If user is App User, filter to show only their contractor
        if (userRole === 'App User' && userEmail) {
          const userContractorName = getContractorNameForUser(userEmail);
         
          if (userContractorName) {
            // Filter contractors to match the user's contractor (normalize whitespace and compare case-insensitively)
            filteredContractors = contractors.filter((c) => {
              const contractorNameRaw = c.ContractorName || '';
              const contractorName = normalizeName(contractorNameRaw);
              const contractorNameLower = contractorName.toLowerCase();
              const userContractorNameNormalized = normalizeName(userContractorName);
              const userContractorNameLower = userContractorNameNormalized.toLowerCase();
             
              // Try exact match first (normalized)
              if (contractorName === userContractorNameNormalized) return true;
              // Try case-insensitive match
              if (contractorNameLower === userContractorNameLower) return true;
              // Try partial match for common variations (e.g., suffixes/plurals)
              if (userContractorNameLower.includes('samuel') && contractorNameLower.includes('samuel')) return true;
              if (userContractorNameLower.includes('balaji') && contractorNameLower.includes('balaji')) return true;
              // Try if contractor name contains the user's contractor name or vice versa
              if (contractorNameLower.includes(userContractorNameLower) || userContractorNameLower.includes(contractorNameLower)) return true;
              return false;
            });
           
            console.log(`Filtering contractors for App User ${userEmail}:`, {
              userContractorName: normalizeName(userContractorName),
              totalContractors: contractors.length,
              filteredCount: filteredContractors.length,
              filteredContractors: filteredContractors.map(c => normalizeName(c.ContractorName))
            });
           
            // If no contractors matched, log a warning but still show empty list (better than showing all)
            if (filteredContractors.length === 0) {
              console.warn(`No contractors found matching "${normalizeName(userContractorName)}" for user ${userEmail}. Available contractors:`, contractors.map(c => normalizeName(c.ContractorName)));
            }
          } else {
            // If no mapping found, try to find contractor by PrimaryEmail
            filteredContractors = contractors.filter((c) => {
              const primaryEmail = c.PrimaryEmail || '';
              return primaryEmail.toLowerCase() === userEmail.toLowerCase();
            });
           
            console.log(`No hardcoded mapping for ${userEmail}, filtering by PrimaryEmail:`, {
              totalContractors: contractors.length,
              filteredCount: filteredContractors.length
            });
           
            // If still no match, show empty list (App Users should only see their own contractor)
            if (filteredContractors.length === 0) {
              console.warn(`No contractor found for ${userEmail} by PrimaryEmail. Showing empty contractor list for App User.`);
            }
          }
        }
       
        const options = [{ value: '', label: '-Select-' }].concat(
          filteredContractors.map((c) => ({
            value: c.ContractorName,
            label: c.ContractorName,
          }))
        );
        setContractorOptions(options);
      })
      .catch((err) => {
        console.error('Failed to fetch contractors:', err);
        setContractorOptions([{ value: '', label: '-Select-' }]);
      });
  }, [userRole, userEmail, getContractorNameForUser]);

  // Add showContractorDropdown state
  const [showContractorDropdown, setShowContractorDropdown] = useState(false);

  const countryCodes = [
    { code: "+1", label: "USA/Canada (+1)" },
    { code: "+91", label: "India (+91)" },
    { code: "+44", label: "UK (+44)" },
    { code: "+61", label: "Australia (+61)" },
    { code: "+81", label: "Japan (+81)" },
    { code: "+49", label: "Germany (+49)" },
    // ...add more as needed
  ];

  // Helper to get last 10 digits
  const getLast10Digits = (num) => {
    if (!num) return '';
    // Remove all non-digits
    const digits = String(num).replace(/\D/g, '');
    // Return last 10 digits
    return digits.slice(-10);
  };

  // When editing a candidate:
  useEffect(() => {
    if (isEditing && form.candidateName) {
      axios.get('/server/EHS_function/esh')
        .then(res => {
          const ehsRecords = res.data.data.esh || [];
          console.log('EHS Records:', ehsRecords);
          if (ehsRecords.length > 0) {
            console.log('First EHS Record:', ehsRecords[0]);
          }
          console.log('Candidate Name:', form.candidateName);

          const inducted = ehsRecords.some(ehs => {
            if (ehs.status && ehs.status.toLowerCase() === 'approved') {
              const inductedList = (ehs.inductedCandidates || "")
                .split(",")
                .map(s => s.trim().toLowerCase());
              console.log('Inducted List:', inductedList);
              console.log('Candidate Name:', form.candidateName.trim().toLowerCase());
              return inductedList.includes(form.candidateName.trim().toLowerCase());
            }
            return false;
          });
          console.log('Induction result:', inducted);
          setInduction(inducted);
        });
    }
  }, [isEditing, form.candidateName]);



  // Handler for modal submit
  const handleAddSkillSubmit = (e) => {
    e.preventDefault();
    if (newSkillName.trim()) {
      const newOption = { value: newSkillName, label: newSkillName };
      setSkillsOptions(prev => [...prev, newOption]);
      setForm(prev => ({ ...prev, skills: newSkillName }));
      setShowAddSkillModal(false);
    }
  };

  // Handler for contractor supervisor modal submit
  const handleAddContractorSupervisorSubmit = (e) => {
    e.preventDefault();
    if (newContractorSupervisorName.trim()) {
      const newOption = { value: newContractorSupervisorName, label: newContractorSupervisorName };
      setContractorSupervisorOptions(prev => [...prev, newOption]);
      setForm(prev => ({ ...prev, contractorSupervisor: newContractorSupervisorName }));
      setShowAddContractorSupervisorModal(false);
      setNewContractorSupervisorName('');
    }
  };

  // Handler for removing contractor supervisor option
  const handleRemoveContractorSupervisor = (optionToRemove) => {
    if (window.confirm(`Are you sure you want to remove "${optionToRemove}" from the contractor supervisor list?`)) {
      setContractorSupervisorOptions(prev => prev.filter(opt => opt.value !== optionToRemove));
      // Clear the form field if it matches the removed option
      if (form.contractorSupervisor === optionToRemove) {
        setForm(prev => ({ ...prev, contractorSupervisor: '' }));
      }
      setShowRemoveContractorSupervisorModal(false);
    }
  };

  // Handler for removing skill option
  const handleRemoveSkill = (optionToRemove) => {
    if (window.confirm(`Are you sure you want to remove "${optionToRemove}" from the skills list?`)) {
      setSkillsOptions(prev => prev.filter(opt => opt.value !== optionToRemove));
      // Clear the form field if it matches the removed option
      if (form.skills === optionToRemove) {
        setForm(prev => ({ ...prev, skills: '' }));
      }
      setShowRemoveSkillModal(false);
    }
  };



// Candidate Photo Section Component
function CandidatePhotoSection({ candidateId, candidate, pendingPhoto, setPendingPhoto, uploadError, setUploadError, uploading, isNewCandidate, form }) {
    const uploadFileInputRef = useRef(null);
    const replaceFileInputRef = useRef(null);
   
    // Remove a pending photo
    const removePendingPhoto = () => {
      setPendingPhoto(null);
      setUploadError(null);
    };

    // Select a new photo
    const handlePhotoSelect = (file) => {
      // Validate file type
      const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png'];
      if (!allowedTypes.includes(file.type)) {
        setUploadError('Please select a valid image file (JPG, JPEG, or PNG)');
        return;
      }
     
      // Validate file size (5MB limit)
      const maxSize = 5 * 1024 * 1024; // 5MB in bytes
      if (file.size > maxSize) {
        setUploadError('File size must be less than 5MB');
        return;
      }
     
      setPendingPhoto(file);
      setUploadError(null);
    };

    // Handle file input click
    const handleUploadClick = () => {
      console.log('Upload button clicked');
      if (uploadFileInputRef.current) {
        console.log('Triggering file input click');
        uploadFileInputRef.current.click();
      } else {
        console.log('File input ref not found');
      }
    };

    const handleReplaceClick = () => {
      console.log('Replace button clicked');
      if (replaceFileInputRef.current) {
        console.log('Triggering file input click');
        replaceFileInputRef.current.click();
      } else {
        console.log('File input ref not found');
      }
    };

    const photoFileId = candidate?.photoFileId || (isNewCandidate ? null : form?.photoFileId);
    const photoFileName = candidate?.photo || (isNewCandidate ? null : form?.photo);
    const photoUrl = photoFileId && candidateId ? `/server/candidate_function/candidates/${candidateId}/file/photo` : null;
   
    console.log('CandidatePhotoSection - candidateId:', candidateId);
    console.log('CandidatePhotoSection - candidate:', candidate);
    console.log('CandidatePhotoSection - photoFileId:', photoFileId);
    console.log('CandidatePhotoSection - photoFileName:', photoFileName);
    console.log('CandidatePhotoSection - photoUrl:', photoUrl);
    console.log('CandidatePhotoSection - pendingPhoto:', pendingPhoto);

      return (
    <div className="form-group" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <label htmlFor="photo" style={{ marginBottom: '8px', fontWeight: '600', color: '#333', fontSize: '14px' }}>Photo</label>
      <div className="candidate-photo-section" style={{
        border: '2px dashed #d1d5db',
        borderRadius: '8px',
        padding: '16px',
        backgroundColor: '#f9fafb',
        minHeight: '120px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'all 0.3s ease',
        cursor: 'pointer'
      }}>
        {pendingPhoto ? (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '12px',
            width: '100%'
          }}>
            <img
              src={URL.createObjectURL(pendingPhoto)}
              alt="Selected Photo"
              style={{
                width: '80px',
                height: '80px',
                objectFit: 'cover',
                borderRadius: '8px',
                border: '2px solid #10b981',
                boxShadow: '0 4px 12px rgba(16, 185, 129, 0.2)'
              }}
            />
            <div style={{ textAlign: 'center' }}>
              <div style={{
                fontSize: '14px',
                fontWeight: '600',
                color: '#10b981',
                marginBottom: '4px'
              }}>
                {pendingPhoto.name}
              </div>
              <div style={{
                fontSize: '12px',
                color: '#6b7280'
              }}>
                {(pendingPhoto.size / 1024 / 1024).toFixed(2)} MB
              </div>
            </div>
            <button
              type="button"
              onClick={removePendingPhoto}
              disabled={uploading}
              style={{
                background: '#ef4444',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                padding: '6px 12px',
                fontSize: '12px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                transition: 'background 0.2s'
              }}
              onMouseOver={(e) => e.target.style.background = '#dc2626'}
              onMouseOut={(e) => e.target.style.background = '#ef4444'}
            >
              <i className="fas fa-times"></i>
              Remove
            </button>
          </div>
        ) : photoFileId && photoFileName && candidateId ? (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '12px',
            width: '100%'
          }}>
            <div style={{
              width: '80px',
              height: '80px',
              backgroundColor: '#e5e7eb',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: '2px solid #d1d5db'
            }}>
              <i className="fas fa-image" style={{ fontSize: '24px', color: '#6b7280' }}></i>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{
                fontSize: '14px',
                fontWeight: '600',
                color: '#333',
                marginBottom: '4px'
              }}>
                📷 {photoFileName}
              </div>
              <div style={{
                fontSize: '12px',
                color: '#6b7280'
              }}>
                Photo uploaded
              </div>
            </div>
            <button
              type="button"
              onClick={handleReplaceClick}
              disabled={uploading}
              style={{
                background: '#3b82f6',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                padding: '6px 12px',
                fontSize: '12px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                transition: 'background 0.2s'
              }}
              onMouseOver={(e) => e.target.style.background = '#2563eb'}
              onMouseOut={(e) => e.target.style.background = '#3b82f6'}
            >
              <i className="fas fa-exchange-alt"></i>
              Replace
            </button>
            <input
              ref={replaceFileInputRef}
              type="file"
              accept=".jpg,.jpeg,.png"
              style={{ display: 'none' }}
              disabled={uploading}
              onChange={e => {
                console.log('File input change event triggered', e.target.files);
                if (e.target.files && e.target.files[0]) {
                  console.log('File selected:', e.target.files[0]);
                  handlePhotoSelect(e.target.files[0]);
                  e.target.value = '';
                }
              }}
            />
          </div>
        ) : (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '12px',
            width: '100%',
            textAlign: 'center'
          }} onClick={handleUploadClick}>
            <div style={{
              width: '80px',
              height: '80px',
              backgroundColor: '#f3f4f6',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: '2px dashed #d1d5db',
              transition: 'all 0.3s ease'
            }}>
              <i className="fas fa-cloud-upload-alt" style={{ fontSize: '32px', color: '#9ca3af' }}></i>
            </div>
            <div>
              <div style={{
                fontSize: '14px',
                fontWeight: '600',
                color: '#374151',
                marginBottom: '4px'
              }}>
                Upload Photo
              </div>
              <div style={{
                fontSize: '12px',
                color: '#6b7280'
              }}>
                JPG/PNG, max 5MB
              </div>
            </div>
            <input
              ref={uploadFileInputRef}
              type="file"
              accept=".jpg,.jpeg,.png"
              style={{ display: 'none' }}
              disabled={uploading}
              onChange={e => {
                console.log('File input change event triggered', e.target.files);
                if (e.target.files && e.target.files[0]) {
                  console.log('File selected:', e.target.files[0]);
                  handlePhotoSelect(e.target.files[0]);
                  e.target.value = '';
                }
              }}
            />
          </div>
        )}
      </div>
      {uploadError && (
        <div style={{
          color: '#ef4444',
          fontSize: '12px',
          marginTop: '8px',
          padding: '8px 12px',
          backgroundColor: '#fef2f2',
          border: '1px solid #fecaca',
          borderRadius: '6px'
        }}>
          {uploadError}
        </div>
      )}
    </div>
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
              <h1>Payroll Management System</h1>
            </div>
            <div className="cms-header-right">
              <HeaderBranding />
              <div className="cms-header-user">
                <div className="cms-notification-icon" onClick={() => setShowNotifications(!showNotifications)} style={{ position: 'relative' }}>
                  <Bell size={24} />
                  {candidateAddedCount > 0 && (
                    <span style={{
                      position: 'absolute',
                      top: '-8px',
                      right: '-8px',
                      backgroundColor: '#ef4444',
                      color: 'white',
                      borderRadius: '50%',
                      width: '20px',
                      height: '20px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '12px',
                      fontWeight: 'bold',
                      border: '2px solid white'
                    }}>
                      {candidateAddedCount}
                    </span>
                  )}
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

          {/* Candidate Management Content */}
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
                <div className="candidate-header-actions">
                  <div className="candidate-title-section">
                    <h2 className="candidate-title">
                      <FileText size={28} />
                      Candidate Directory
                    </h2>
                    <p className="candidate-subtitle">
                      Manage your organization's candidates efficiently
                    </p>
                  </div>
                  {/* Contractor Filter Indicator */}
                  {userRole === 'App User' && userEmail && (
                    <div style={{
                      marginTop: '8px',
                      padding: '8px 12px',
                      backgroundColor: '#e3f2fd',
                      borderRadius: '6px',
                      border: '1px solid #2196f3',
                      fontSize: '14px',
                      color: '#1976d2'
                    }}>
                      <Filter size={16} style={{ marginRight: '6px', color: '#f97316' }} />
                      Showing candidates for contractor: <strong>{userEmail}</strong>
                    </div>
                  )}
                </div>
                <div className="candidate-toolbar" style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'nowrap', marginLeft: '-20px' }}>
                  <button
                    className="toolbar-btn import-btn"
                    onClick={() => fileInputRef.current.click()}
                    disabled={importing}
                    title="Import candidates from Excel"
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
                  <button
                    className="toolbar-btn export-btn"
                    onClick={handleExport}
                    disabled={exporting}
                    title="Export filtered candidates to Excel"
                    type="button"
                    style={{ background: '#fff', color: '#2563eb', border: 'none', fontWeight: 600, padding: '8px', borderRadius: '8px', width: '48px', height: '48px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}
                  >
                    <FileOutput size={22} style={{ color: '#2563eb' }} />
                  </button>
                  <button
                    className="toolbar-btn filter-btn"
                    onClick={toggleSearchDropdown}
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
                    onClick={fetchCandidates}
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
                    title="Add new candidate"
                    style={{ background: '#fff', color: '#14b8a6', border: 'none', fontWeight: 700, fontSize: '1.2rem', borderRadius: '8px', width: '48px', height: '48px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(60,72,88,0.10)' }}
                  >
                    <Plus size={24} style={{ color: '#14b8a6' }} />
                  </button>
                  {/* Delete button for selected candidates */}
                  {selectedCandidates.length > 0 && (
                    <button
                      className="toolbar-btn"
                      onClick={handleMassDelete}
                      disabled={deletingMultiple}
                      title="Delete selected candidates"
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

        {/* Filter Sidebar (Drawer) */}
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
                        {/* Dropdown fields */}
                        {field === 'candidateName' ? (
                          createDropdownUI(
                            'candidateName', 'Candidate Name', candidateNames,
                            candidateNameSearch, setCandidateNameSearch,
                            isCandidateNameDropdownOpen, setIsCandidateNameDropdownOpen,
                            handleCandidateNameSelect, loadingCandidateNames, filteredCandidateNames
                          )
                        ) : field === 'contractorName' ? (
                          createDropdownUI(
                            'contractorName', 'Contractor Name', contractors,
                            contractorSearch, setContractorSearch,
                            isContractorDropdownOpen, setIsContractorDropdownOpen,
                            handleContractorSelect, loadingContractors, filteredContractors
                          )
                        ) : field === 'gender' ? (
                          createDropdownUI(
                            'gender', 'Gender', genders,
                            genderSearch, setGenderSearch,
                            isGenderDropdownOpen, setIsGenderDropdownOpen,
                            handleGenderSelect, loadingGenders, filteredGenders
                          )
                        ) : field === 'department' ? (
                          createDropdownUI(
                            'department', 'Department', filterDepartments,
                            departmentSearch, setDepartmentSearch,
                            isDepartmentDropdownOpen, setIsDepartmentDropdownOpen,
                            handleDepartmentSelect, loadingDepartments, filteredDepartments
                          )
                        ) : field === 'designation' ? (
                          createDropdownUI(
                            'designation', 'Designation', filterDesignations,
                            designationSearch, setDesignationSearch,
                            isDesignationDropdownOpen, setIsDesignationDropdownOpen,
                            handleDesignationSelect, loadingDesignations, filteredDesignations
                          )
                        ) : field === 'skills' ? (
                          createDropdownUI(
                            'skills', 'Skills', filterSkills,
                            skillSearch, setSkillSearch,
                            isSkillDropdownOpen, setIsSkillDropdownOpen,
                            handleSkillSelect, loadingSkills, filteredSkills
                          )
                        ) : field === 'dateOfEngagement' ? (
                          createDropdownUI(
                            'dateOfEngagement', 'Date of Engagged', engagementDates,
                            engagementDateSearch, setEngagementDateSearch,
                            isEngagementDateDropdownOpen, setIsEngagementDateDropdownOpen,
                            handleEngagementDateSelect, loadingEngagementDates, filteredEngagementDates
                          )
                        ) : (
                          /* Input fields for remaining fields */
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
                  onClick={resetSearch}
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

      {/* Feedback/Errors */}
      <div className="candidate-feedback">
      {successMessage && (
          <div className="success-message">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>{successMessage}</span>
              <button
                onClick={() => setSuccessMessage('')}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '18px',
                  cursor: 'pointer',
                  padding: '0 8px',
                  marginLeft: '12px',
                  color: 'inherit',
                  opacity: 0.7
                }}
                title="Clear message"
              >
                ×
              </button>
            </div>
        </div>
      )}
      {importError && (
          <div className={`feedback-message ${importError.includes('✅') ? 'success-message' : 'error-message'}`}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                {importError.split('\n').map((line, index) => (
                  <div key={index} style={{ marginBottom: index < importError.split('\n').length - 1 ? '8px' : '0' }}>
                    {line}
                  </div>
                ))}
              </div>
              <button
                onClick={() => setImportError('')}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '18px',
                  cursor: 'pointer',
                  padding: '0 8px',
                  marginLeft: '12px',
                  color: 'inherit',
                  opacity: 0.7
                }}
                title="Clear message"
              >
                ×
              </button>
            </div>
        </div>
      )}
      {exportError && (
          <div className="error-message">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>{exportError}</span>
              <button
                onClick={() => setExportError('')}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '18px',
                  cursor: 'pointer',
                  padding: '0 8px',
                  marginLeft: '12px',
                  color: 'inherit',
                  opacity: 0.7
                }}
                title="Clear message"
              >
                ×
              </button>
            </div>
        </div>
      )}
      {massDeleteError && (
          <div className="error-message">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>{massDeleteError}</span>
              <button
                onClick={() => setMassDeleteError('')}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '18px',
                  cursor: 'pointer',
                  padding: '0 8px',
                  marginLeft: '12px',
                  color: 'inherit',
                  opacity: 0.7
                }}
                title="Clear message"
              >
                ×
              </button>
            </div>
        </div>
      )}
      </div>

      {/* Table Container - Only show when form is closed */}
      {!showForm && (
        <>
          <div className="candidate-table-container employee-table-container">
        {(fetchState === 'loading' || importing) ? (
          <div className="dF aI-center jC-center h-inh"><div className="loader-lg"></div></div>
        ) : fetchState === 'error' ? (
          <div className="error-message">{fetchError}</div>
        ) : (
          <table className={`candidate-table employee-table ${selectedCandidates.length === 0 ? 'edit-column-hidden' : ''}`} style={{ minWidth: '3000px' }}>
            <thead>
              <tr>
                {dynamicColumns.map((column, index) => {
                  return (
                    <th key={index} style={{ color: '#232323', fontWeight: 700, fontSize: '1rem', borderBottom: '2px solid #e3e8ee', background: '#f5f5f5' }}>
                      {column.label === 'Select' ? (
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
                      ) : (
                        column.label
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {filteredCandidates.length ? filteredCandidates.map((candidate, index) => (
                  <CandidateRow
                    key={candidate.id}
                    candidate={candidate}
                    index={index}
                    removeCandidate={removeCandidate}
                    editCandidate={editCandidate}
                    isSelected={selectedCandidates.includes(candidate.id)}
                    onSelect={handleSelectCandidate}
                    selectedCandidates={selectedCandidates}
                  />
              )) : (
                <tr>
                  <td colSpan={dynamicColumns.length} className="text-center">No candidates found. Adjust your search or add a new candidate.</td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination Controls */}
      <div className="candidate-pagination">
        <div className="candidate-pagination-controls">
          <button className="btn btn-primary mr-2" onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</button>
          <span>Page {page} of {totalPages}</span>
          <button className="btn btn-primary ml-2" onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Next</button>
        </div>
        <div className="candidate-pagination-info">
          Showing {filteredCandidates.length} of {totalCandidates || '?'} candidates
        </div>
      </div>
     
      {/* Total Candidates Button - Below Table */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '16px 24px', justifyContent: 'flex-start' }}>
        <button
          className="candidate-total-button"
          type="button"
          title="Total Candidates"
          onClick={() => setShowTotalCount((prev) => !prev)}
        >
          Total Candidates
        </button>
        {showTotalCount && (
          <span className="candidate-total-count">
            Total Candidates: <span style={{fontWeight: 700}}>{totalCandidates || filteredCandidates.length}</span>
          </span>
        )}
      </div>
        </>
      )}



      {/* Inline Form - Only show when form is open */}
      {showForm && (
        <div className="candidate-form-page">
          <div className="candidate-form-container">
            <div className="candidate-form-header">
              <h1>
                <i className="fas fa-user-plus"></i>
                {isEditing ? 'Edit Candidate' : 'Add New Candidate'}
              </h1>
              <button
                className="close-btn"
                onClick={toggleForm}
                title="Close form"
              >
                <i className="fas fa-times"></i>
              </button>
            </div>
            <div className="candidate-form-content">
              <form className="candidate-form" onSubmit={saveCandidate}>
              {/* Candidate Info Card */}
              <div className="form-section-card candidate-info">
                <h2 className="section-title">Candidate Info</h2>
                <div className="form-grid">
                  <div className="form-group">
                    <label htmlFor="contractorName">Contractor Name <span style={{color: 'red'}}>*</span></label>
                    <select className="input" name="contractorName" value={form.contractorName} onChange={onChange}>
                      <option value="">-Select-</option>
                      {contractorOptions.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                    <FieldError error={fieldErrors.contractorName} />
                  </div>
                  <div className="form-group">
                    <label htmlFor="candidateName">Candidate Name <span style={{color: 'red'}}>*</span></label>
                    <input type="text" id="candidateName" name="candidateName" value={form.candidateName} onChange={onChange} className="input" />
                    <FieldError error={fieldErrors.candidateName} />
                  </div>
                  <div className="form-group">
                    <label htmlFor="contractorSupervisor">Contractor Supervisor</label>
<select id="contractorSupervisor" name="contractorSupervisor" value={form.contractorSupervisor} onChange={e => {
  if (e.target.value === '__add_new__') {
    setShowAddContractorSupervisorModal(true);
  } else if (e.target.value === '__remove__') {
    setShowRemoveContractorSupervisorModal(true);
  } else {
    onChange(e);
  }
}} className="input">
  <option value="">-Select-</option>
  {contractorSupervisorOptions.filter(opt => opt.value !== '').map(opt => (
    <option key={opt.value} value={opt.value}>{opt.label}</option>
  ))}
  <option value="__add_new__">+ Add New</option>
  {contractorSupervisorOptions.filter(opt => opt.value !== '').length > 0 && (
    <option value="__remove__">- Remove Option</option>
  )}
</select>
                    <FieldError error={fieldErrors.contractorSupervisor} />
                  </div>
                  <CandidatePhotoSection
                    candidateId={editingCandidateId}
                    candidate={isEditing ? candidates.find(c => c.id === editingCandidateId) : null}
                    pendingPhoto={pendingPhoto}
                    setPendingPhoto={setPendingPhoto}
                    uploadError={photoUploadError}
                    setUploadError={setPhotoUploadError}
                    uploading={submitting}
                    isNewCandidate={!isEditing}
                    form={form}
                  />
                </div>
              </div>

             

              {/* Personal Info Card */}
              <div className="form-section-card personal-info">
                <h2 className="section-title">Personal Info</h2>
               
                <div className="form-grid">
                  <div className="form-group">
                    <label htmlFor="gender">Gender <span style={{color: 'red'}}>*</span></label>
                    <select id="gender" name="gender" value={form.gender} onChange={onChange} className="input">
                      <option value="">-Select-</option>
                      <option value="Female">Female</option>
                      <option value="Male">Male</option>
                    </select>
                    <FieldError error={fieldErrors.gender} />
                  </div>
                  <div className="form-group">
                    <label htmlFor="bloodGroup">Blood Group</label>
                    <select id="bloodGroup" name="bloodGroup" value={form.bloodGroup} onChange={onChange} className="input">
                      <option value="">-Select-</option>
                      <option value="A+">A+</option>
                      <option value="A-">A-</option>
                      <option value="B+">B+</option>
                      <option value="B-">B-</option>
                      <option value="AB+">AB+</option>
                      <option value="AB-">AB-</option>
                      <option value="O+">O+</option>
                      <option value="O-">O-</option>
                    </select>
                    <FieldError error={fieldErrors.bloodGroup} />
                  </div>
                </div>
                <div className="form-grid">
                  <div className="form-group">
                    <label htmlFor="email">Email <span style={{color: 'red'}}>*</span></label>
                    <input
                      type="email"
                      id="email"
                      name="email"
                      value={form.email}
                      onChange={e => setForm(prev => ({ ...prev, email: e.target.value.toLowerCase() }))}
                      className="input"
                    />
                    <FieldError error={fieldErrors.email} />
                  </div>
                  <div className="form-group">
                    <label htmlFor="maritalStatus">Marital Status</label>
                    <select id="maritalStatus" name="maritalStatus" value={form.maritalStatus} onChange={onChange} className="input">
                      <option value="">-Select-</option>
                      <option value="Single">Single</option>
                      <option value="Married">Married</option>
                    </select>
                  </div>
                </div>
                <div className="form-grid">
                  <div className="form-group">
                    <label htmlFor="emergencyContactNumber">Emergency Contact Number</label>
                    <input
                      type="text"
                      id="emergencyContactNumber"
                      name="emergencyContactNumber"
                      value={form.emergencyContactNumber}
                      onChange={e => {
                        const digits = e.target.value.replace(/\D/g, '');
                        setForm(prev => ({ ...prev, emergencyContactNumber: digits }));
                      }}
                      className="input"
                      placeholder="Enter 10-digit number only"
                    />
                    <small style={{ color: '#666', fontSize: '12px' }}>
                      Only 10 digits allowed. Do not use spaces or dashes.
                    </small>
                    <FieldError error={fieldErrors.emergencyContactNumber} />
                  </div>
                  <div className="form-group">
                    <label htmlFor="fathersName">Father Name/Spouse Name</label>
                    <input type="text" id="fathersName" name="fathersName" value={form.fathersName} onChange={onChange} className="input" />
                  </div>
                </div>
                <div className="form-grid">
                  <div className="form-group">
                    <label htmlFor="aadhaarNumber">Aadhaar Number</label>
                    <input type="text" id="aadhaarNumber" name="aadhaarNumber" value={form.aadhaarNumber} onChange={onChange} className="input" placeholder="12-digit number" />
                    <FieldError error={fieldErrors.aadhaarNumber} />
                  </div>
                  <div className="form-group">
                    <label htmlFor="dob">DOB <span style={{color: 'red'}}>*</span></label>
                    <input
                      type="date"
                      id="dob"
                      name="dob"
                      value={form.dob}
                      onChange={onChange}
                      className="input"
                      max={new Date().toISOString().split('T')[0]}
                    />
                    <FieldError error={fieldErrors.dob} />
                  </div>
                </div>
                <div className="form-grid">
                  <div className="form-group">
                    <label htmlFor="panNumber">PAN Number (Optional)</label>
                    <input
                      type="text"
                      id="panNumber"
                      name="panNumber"
                      value={form.panNumber}
                      onChange={e => {
                        let value = e.target.value.toUpperCase();
                        // If 4th character is not P, force it to P
                        if (value.length === 4 && value[3] !== 'P') {
                          value = value.slice(0, 3) + 'P' + value.slice(4);
                        }
                        setForm(prev => ({ ...prev, panNumber: value }));
                      }}
                      className="input"
                      placeholder="e.g., ABCDP1234F (4th must be P)"
                    />
                    <small style={{ color: '#666', fontSize: '12px' }}>
                      PAN Number must be unique. Leave empty if not available or if you're unsure.
                    </small>
                    <FieldError error={fieldErrors.panNumber} />
                  </div>
                  <div className="form-group">
                    <label htmlFor="phone">Phone</label>
                    <input
                      type="text"
                      id="phone"
                      name="phone"
                      value={form.phone || ''}
                      onChange={e => {
                        // Only allow up to 10 digits
                        const digits = e.target.value.replace(/\D/g, '').slice(0, 10);
                        setForm(prev => ({ ...prev, phone: digits }));
                      }}
                      className="input"
                      placeholder="Enter 10-digit number only"
                    />
                    <small style={{ color: '#666', fontSize: '12px' }}>
                      Only 10 digits allowed. Do not use spaces or dashes.
                    </small>
                    <FieldError error={fieldErrors.phone} />
                  </div>
                </div>
                <div className="form-grid">
                  <div className="form-group">
                    <label htmlFor="drivingLicenseNumber">Driving License Number</label>
                    <input
                      type="text"
                      id="drivingLicenseNumber"
                      name="drivingLicenseNumber"
                      value={form.drivingLicenseNumber}
                      onChange={e => {
                        // Auto uppercase and remove extra spaces
                        let value = e.target.value.toUpperCase().replace(/[^A-Z0-9 -]/g, '');
                        setForm(prev => ({ ...prev, drivingLicenseNumber: value }));
                      }}
                      className="input"
                      placeholder="e.g., MH12 20110001234"
                    />
                    <small style={{ color: '#666', fontSize: '12px' }}>
                      Format: SS-00-YYYY-0000000 (e.g., MH12 20110001234)
                    </small>
                    <FieldError error={fieldErrors.drivingLicenseNumber} />
                  </div>
                  <div className="form-group">
                    <label htmlFor="driverLicenseExpiryDate">Driver License Expiry Date</label>
                    <input
                      type="date"
                      id="driverLicenseExpiryDate"
                      name="driverLicenseExpiryDate"
                      value={form.driverLicenseExpiryDate}
                      onChange={onChange}
                      className="input"
                    />
                  </div>
                </div>
              </div>
              {/* Work Info Card */}
              <div className="form-section-card work-info">
                <h2 className="section-title">Work Info</h2>
                <div className="form-grid">
                  <div className="form-group">
                    <label htmlFor="department">Department</label>
                    <select className="input" name="department" value={form.department} onChange={onChange}>
                      <option value="">-Select-</option>
                      {departmentOptions.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                    <FieldError error={fieldErrors.department} />
                  </div>
                  <div className="form-group">
                    <label htmlFor="designation">Designation</label>
                    <select className="input" name="designation" value={form.designation} onChange={onChange}>
                      <option value="">-Select-</option>
                      {designationOptions.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="form-grid">
                  <div className="form-group">
                    <label htmlFor="skills">Skills</label>
                    <select
                      className="input"
                      name="skills"
                      value={form.skills}
                      onChange={e => {
                        if (e.target.value === '__add_new__') {
                          setShowAddSkillModal(true);
                        } else if (e.target.value === '__remove__') {
                          setShowRemoveSkillModal(true);
                        } else {
                          onChange(e);
                        }
                      }}
                    >
                      <option value="">-Select-</option>
                      {skillsOptions.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                      <option value="__add_new__">+ Add New</option>
                      {skillsOptions.length > 0 && (
                        <option value="__remove__">- Remove Option</option>
                      )}
                    </select>
                  </div>
                  <div className="form-group">
                    <label htmlFor="dateOfEngagement">Date of Engagged</label>
                    <input type="date" id="dateOfEngagement" name="dateOfEngagement" value={form.dateOfEngagement} onChange={onChange} className="input" />
                  </div>
                </div>
              </div>
              {/* Address Details Card */}
              <div className="form-section-card address-details">
                <h2 className="section-title">Address Details</h2>
                <div style={{ display: 'flex', gap: '32px', marginBottom: '8px' }}>
                  {/* Present Address Block */}
                  <div className="address-block" style={{ flex: 1 }}>
                    <h4>Present Address</h4>
                    <div>
                      <input className="input" name="presentAddressLine1" placeholder="Address Line 1" value={form.presentAddressLine1} onChange={onChange} />
                      <FieldError error={fieldErrors.presentAddressLine1} />
                    </div>
                    <div>
                      <input className="input" name="presentCity" placeholder="City / District" value={form.presentCity} onChange={onChange} />
                      <FieldError error={fieldErrors.presentCity} />
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <div style={{ flex: 1 }}>
                        <input className="input" name="presentState" placeholder="State / Province" value={form.presentState} onChange={onChange} />
                        <FieldError error={fieldErrors.presentState} />
                      </div>
                      <div style={{ flex: 1 }}>
                        <input className="input" name="presentPostalCode" placeholder="Postal Code" value={form.presentPostalCode} onChange={onChange} />
                      </div>
                    </div>
                    <div>
                      <select className="input" name="presentCountry" value={form.presentCountry} onChange={onChange}>
                        <option value="">-Select Country-</option>
                        {countryOptions.map(opt => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                      <FieldError error={fieldErrors.presentCountry} />
                    </div>
                  </div>
                  {/* Permanent Address Block */}
                  <div className="address-block" style={{ flex: 1 }}>
                    <h4>Permanent Address</h4>
                    <input className="input" name="permanentAddressLine1" placeholder="Address Line 1" value={form.permanentAddressLine1} onChange={onChange} disabled={copyAddress} />
                    <input className="input" name="permanentCity" placeholder="City / District" value={form.permanentCity} onChange={onChange} disabled={copyAddress} />
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input className="input" name="permanentState" placeholder="State / Province" value={form.permanentState} onChange={onChange} disabled={copyAddress} />
                      <input className="input" name="permanentPostalCode" placeholder="Postal Code" value={form.permanentPostalCode} onChange={onChange} disabled={copyAddress} />
                    </div>
                    <select className="input" name="permanentCountry" value={form.permanentCountry} onChange={onChange} disabled={copyAddress}>
                      <option value="">-Select Country-</option>
                      {countryOptions.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="checkbox-group">
                  <input
                    type="checkbox"
                    id="copyAddress"
                    checked={copyAddress}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setCopyAddress(checked);
                      if (checked) {
                        setForm((prev) => ({
                          ...prev,
                          permanentAddressLine1: prev.presentAddressLine1,
                          permanentCity: prev.presentCity,
                          permanentState: prev.presentState,
                          permanentPostalCode: prev.presentPostalCode,
                          permanentCountry: prev.presentCountry,
                        }));
                      } else {
                        setForm((prev) => ({
                          ...prev,
                          permanentAddressLine1: "",
                          permanentCity: "",
                          permanentState: "",
                          permanentPostalCode: "",
                          permanentCountry: "",
                        }));
                      }
                    }}
                  />
                  <label htmlFor="copyAddress">
                    Copy present address as permanent address
                  </label>
                </div>
              </div>

              {/* Section Card */}
              <div className="form-section-card section-info">
                <h2 className="section-title">Section</h2>
                <div style={{ display: 'flex', alignItems: 'center', gap: '32px', marginBottom: '16px' }}>
                  {/* Induction */}
                  <div style={{ display: 'flex', alignItems: 'center', minWidth: 150 }}>
                    <input
                      type="checkbox"
                      checked={induction}
                      readOnly
                    />
                    <label htmlFor="induction" style={{ marginLeft: 8, minWidth: 120, fontWeight: 600, marginBottom: 0 }}>
                      Induction
                    </label>
                    {induction && (
                      <button
                        type="button"
                        onClick={() => setInduction(false)}
                        style={{
                          marginLeft: 8,
                          color: '#ef4444',
                          background: 'none',
                          border: 'none',
                          fontSize: 18,
                          cursor: 'pointer',
                          verticalAlign: 'middle'
                        }}
                        title="Clear Induction"
                      >
                        ×
                      </button>
                    )}
                  </div>
                  {/* EHS Comments */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flex: 1 }}>
                    <label htmlFor="ehsComments" style={{ minWidth: 120, fontWeight: 600, marginBottom: 0 }}>
                      EHS Comments
                    </label>
                    <textarea
                      id="ehsComments"
                      value={ehsComments}
                      onChange={e => setEhsComments(e.target.value)}
                      className="ehs-comments-textarea"
                    />
                  </div>
                </div>
              </div>

              {/* Education Details Card */}
              <div className="form-section-card education-details">
                <h2 className="section-title">Education Details</h2>
                {educationDetails.map((detail, index) => (
                  <div key={index} className="form-grid">
                    <div className="form-group">
                      <label>Qualification</label>
                      <input
                        className="input"
                        value={detail.qualification}
                        onChange={(e) => updateEducationDetail(index, 'qualification', e.target.value)}
                      />
                    </div>
                    <div className="form-group">
                      <label>Institution Name</label>
                      <input
                        className="input"
                        value={detail.institution}
                        onChange={(e) => updateEducationDetail(index, 'institution', e.target.value)}
                      />
                    </div>
                    <div className="form-group">
                      <label>Field of Study</label>
                      <input
                        className="input"
                        value={detail.fieldOfStudy}
                        onChange={(e) => updateEducationDetail(index, 'fieldOfStudy', e.target.value)}
                      />
                    </div>
                    <div className="form-group">
                      <label>Year of Completion</label>
                      <input
                        className="input"
                        value={detail.yearOfCompletion}
                        onChange={(e) => updateEducationDetail(index, 'yearOfCompletion', e.target.value)}
                      />
                    </div>
                    <div className="form-group">
                      <label>Percentage Marks</label>
                      <input
                        className="input"
                        value={detail.percent}
                        onChange={(e) => updateEducationDetail(index, 'percent', e.target.value)}
                      />
                    </div>
                    <button type="button" onClick={() => removeEducationDetail(index)} style={{
                      background: '#ef4444',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      padding: '8px 12px',
                      fontSize: '14px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      minWidth: '40px',
                      height: '40px',
                      transition: 'background 0.2s'
                    }} onMouseOver={(e) => e.target.style.background = '#dc2626'} onMouseOut={(e) => e.target.style.background = '#ef4444'}>
                      <i className="fas fa-times"></i>
                    </button>
                  </div>
                ))}
                <button type="button" onClick={addEducationDetail}>Add New Education</button>
              </div>

              {/* Approval Status Card - visible only to App Administrators */}
              {userRole === 'App Administrator' && (
                <div className="form-section-card approval-status">
                  <h2 className="section-title">Approval Status</h2>
                  <div className="form-grid">
                    <div className="form-group">
                      <label htmlFor="approvalStatus">Approval Status <span style={{color: 'red'}}>*</span></label>
                      <select className="input" name="approvalStatus" value={form.approvalStatus} onChange={onChange}>
                        <option value="">-Select-</option>
                        <option value="Approved">Approved</option>
                        <option value="Rejected">Rejected</option>
                        <option value="Pending">Pending</option>
                        <option value="Rejoined">Rejoined</option>
                        <option value="Application Submitted">Application Submitted</option>
                      </select>
                      <FieldError error={fieldErrors.approvalStatus} />
                    </div>
                    <div className="form-group">
                      <label htmlFor="comments">Comments</label>
                      <textarea
                        id="comments"
                        name="comments"
                        value={form.comments}
                        onChange={e => setForm(prev => ({ ...prev, comments: e.target.value }))}
                        className="input"
                        rows={3}
                        placeholder="Enter comments (optional)"
                      />
                    </div>
                  </div>
                </div>
              )}

              <div className="form-actions">
                <button type="submit" className="btn btn-primary" disabled={submitting}>
                  {isEditing ? 'Update Candidate' : 'Submit'}
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
      )}
      {showAddSkillModal && (
        <div className="modal add-skill-modal" role="dialog" aria-labelledby="add-skill-title">
          <div className="add-skill-modal-content">
            <div className="add-skill-modal-header">
              <h2 id="add-skill-title">Add Skills</h2>
              <button
                className="add-skill-modal-close"
                onClick={() => setShowAddSkillModal(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <form
              className="add-skill-form"
              onSubmit={handleAddSkillSubmit}
              style={{ marginTop: 16 }}
            >
              <div className="form-group">
                <label htmlFor="newSkillName">
                  Skill <span style={{ color: 'red' }}>*</span>
                </label>
                <input
                  id="newSkillName"
                  type="text"
                  value={newSkillName}
                  onChange={e => setNewSkillName(e.target.value)}
                  autoFocus
                  required
                  className="input"
                  style={{ width: '100%', marginTop: 6 }}
                />
              </div>
              <div style={{ display: 'flex', gap: 12, marginTop: 24, justifyContent: 'center' }}>
                <button type="submit" className="btn btn-primary">Add</button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setNewSkillName('')}
                >
                  Reset
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {showRemoveSkillModal && (
        <div className="modal remove-skill-modal" role="dialog" aria-labelledby="remove-skill-title">
          <div className="remove-skill-modal-content">
            <div className="remove-skill-modal-header">
              <h2 id="remove-skill-title">Remove Skill</h2>
              <button
                className="remove-skill-modal-close"
                onClick={() => setShowRemoveSkillModal(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div style={{ marginTop: 16 }}>
              <div className="form-group">
                <label>Select Skill to Remove:</label>
                <div style={{ marginTop: 8, maxHeight: '200px', overflowY: 'auto', border: '1px solid #ddd', borderRadius: '4px' }}>
                  {skillsOptions.map(opt => (
                    <div
                      key={opt.value}
                      style={{
                        padding: '8px 12px',
                        borderBottom: '1px solid #eee',
                        cursor: 'pointer',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                      }}
                      onClick={() => handleRemoveSkill(opt.value)}
                      onMouseOver={(e) => e.target.style.backgroundColor = '#f5f5f5'}
                      onMouseOut={(e) => e.target.style.backgroundColor = 'transparent'}
                    >
                      <span>{opt.label}</span>
                      <i className="fas fa-trash" style={{ color: '#ef4444', fontSize: '14px' }}></i>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 12, marginTop: 24, justifyContent: 'center' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowRemoveSkillModal(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {showAddContractorSupervisorModal && (
        <div className="modal add-contractor-supervisor-modal" role="dialog" aria-labelledby="add-contractor-supervisor-title">
          <div className="add-contractor-supervisor-modal-content">
            <div className="add-contractor-supervisor-modal-header">
              <h2 id="add-contractor-supervisor-title">Add Contractor Supervisor</h2>
              <button
                className="add-contractor-supervisor-modal-close"
                onClick={() => setShowAddContractorSupervisorModal(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <form
              className="add-contractor-supervisor-form"
              onSubmit={handleAddContractorSupervisorSubmit}
              style={{ marginTop: 16 }}
            >
              <div className="form-group">
                <label htmlFor="newContractorSupervisorName">
                  Contractor Supervisor <span style={{ color: 'red' }}>*</span>
                </label>
                <input
                  id="newContractorSupervisorName"
                  type="text"
                  value={newContractorSupervisorName}
                  onChange={e => setNewContractorSupervisorName(e.target.value)}
                  autoFocus
                  required
                  className="input"
                  style={{ width: '100%', marginTop: 6 }}
                  placeholder="Enter contractor supervisor name"
                />
              </div>
              <div style={{ display: 'flex', gap: 12, marginTop: 24, justifyContent: 'center' }}>
                <button type="submit" className="btn btn-primary">Add</button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    setNewContractorSupervisorName('');
                    setShowAddContractorSupervisorModal(false);
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {showRemoveContractorSupervisorModal && (
        <div className="modal remove-contractor-supervisor-modal" role="dialog" aria-labelledby="remove-contractor-supervisor-title">
          <div className="remove-contractor-supervisor-modal-content">
            <div className="remove-contractor-supervisor-modal-header">
              <h2 id="remove-contractor-supervisor-title">Remove Contractor Supervisor</h2>
              <button
                className="remove-contractor-supervisor-modal-close"
                onClick={() => setShowRemoveContractorSupervisorModal(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div style={{ marginTop: 16 }}>
              <div className="form-group">
                <label>Select Contractor Supervisor to Remove:</label>
                <div style={{ marginTop: 8, maxHeight: '200px', overflowY: 'auto', border: '1px solid #ddd', borderRadius: '4px' }}>
                  {contractorSupervisorOptions.filter(opt => opt.value !== '').map(opt => (
                    <div
                      key={opt.value}
                      style={{
                        padding: '8px 12px',
                        borderBottom: '1px solid #eee',
                        cursor: 'pointer',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                      }}
                      onClick={() => handleRemoveContractorSupervisor(opt.value)}
                      onMouseOver={(e) => e.target.style.backgroundColor = '#f5f5f5'}
                      onMouseOut={(e) => e.target.style.backgroundColor = 'transparent'}
                    >
                      <span>{opt.label}</span>
                      <i className="fas fa-trash" style={{ color: '#ef4444', fontSize: '14px' }}></i>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 12, marginTop: 24, justifyContent: 'center' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowRemoveContractorSupervisorModal(false)}
                >
                  Cancel
                </button>
              </div>
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

export default CandidateManagement;