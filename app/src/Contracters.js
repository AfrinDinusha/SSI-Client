import './App.css';
import './helper.css';
import './Contracters.css';
import axios from 'axios';
import { useCallback, useEffect, useState, useRef, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { Link } from 'react-router-dom';
import Button from './Button';
import {
  Users, Calendar, FileText, AlertTriangle, FolderOpen,
  ClipboardList, Building, Handshake, Landmark, Clock,
  Map, BarChart3, User, TrendingUp, TrendingDown,
  Activity, Plus, CheckCircle, Bell, Settings, LayoutDashboard, Home as HomeIcon,
  Search, Edit, Trash2, X, Download, Upload, RefreshCw, Menu, Shield, AlertOctagon, CreditCard, FileSignature, Clock3, CalendarDays, Database,
  FileInput, FileOutput, Filter
} from 'lucide-react';
import HeaderBranding from './HeaderBranding';
import { getSidebarModulesForUser, resolveSidebarUserEmail } from './modulesConfig';

// Allowed fields for backend (update as per your DataStore schema)
const allowedFields = [
  'Organization', 'ContractorName', 'PrimaryEmail', 'PrimaryMobileNo', 'EstablishmentCode', 'EstablishmentName',
  'EstablishmentShortName', 'LicenseNo', 'Natureofwork', 'NumberOfEmployeesasperRC', 'NameoftheDirector',
  'ContractStartDate', 'ContractEndDate', 'ContractvalidFrom', 'ContractValidTo', 'Website', 'Landlinenumber',
  'SecondaryEmail', 'SecondaryMobileNumber', 'ContractorStatus', 'ApprovalStatus',
  // Address
  'RegisterAddressLine1', 'RegisterAddressLine2', 'RegisterCity', 'RegisterState', 'RegisterPostalCode', 'RegisterCountry',
  'OfficeAddressLine1', 'OfficeAddressLine2', 'OfficeCity', 'OfficeState', 'OfficePostalCode', 'OfficeCountry',
  'CommunicationAddressLine1', 'CommunicationAddressLine2', 'CommunicationCity', 'CommunicationState', 'CommunicationPostalCode', 'CommunicationCountry',
  // Documents
  'OrganizationPANNo', 'OrganizationGSTINNumber', 'OrganizationPFEstablishmentCode', 'OrganizationESIEstablishmentCode',
  'ContractorPANNo', 'ContractorAadharNo',
  // Contact Persons
  'NameoftheSiteManager', 'SiteManagerMobile', 'SiteManagerEmail', 'NameofSiteIncharge', 'SiteInchargeMobile', 'SiteInchargeEmail',
  'ContractorContactName', 'ContractContactMobile', 'ContractorContactEmail',
  // File-related fields - FileId and FileName columns for database storage
  'OrganizationPANFileId', 'OrganizationPANFileName',
  'GSTRegistartionCertificateFileId', 'GSTRegistartionCertificateFileName',
  'PFRegistrationCertificateFileId', 'PFRegistrationCertificateFileName',
  'ESIRegistrationcertificateFileId', 'ESIRegistrationcertificateFileName',
  'ContractorPANFileId', 'ContractorPANFileName',
  'ContractorAadharFileId', 'ContractorAadharFileName'
];

const initialForm = Object.fromEntries(allowedFields.map(f => [f, '']));

// Add file upload fields to the form
const fileFields = [
  'OrganizationPANFileId',
  'GSTRegistrationCertificateFileId',
  'PFRegistrationCertificateFileId',
  'ESIRegistrationCertificateFileId',
  'ContractorPANFileId',
  'ContractorAadharFileId'
];

// Organization options will be fetched dynamically
const initialOrganizationOptions = [
  { value: '', label: '-Select-' },
];
const countryOptions = [
  { value: '', label: '-Select-' },
  { value: 'IN', label: 'India' },
  { value: 'US', label: 'United States' },
];
const statusOptions = [
  { value: '', label: '-Select-' },
  { value: 'Active', label: 'Active' },
  { value: 'Inactive', label: 'Inactive' },
];

const filterFieldMap = [
  { label: "Approval Status", key: "ApprovalStatus" },
  { label: "Contractor Name", key: "ContractorName" },
  { label: "Number Of Employees as per RC", key: "NumberOfEmployeesasperRC" },
  { label: "License No", key: "LicenseNo" },
  { label: "Contractor Status", key: "ContractorStatus" },
  { label: "Primary Email", key: "PrimaryEmail" },
  { label: "Primary Mobile No.", key: "PrimaryMobileNo" },
  { label: "ESI Registration Certificate", key: "ESIRegistrationCertificateFileId" },
  { label: "Name of the Site Manager", key: "NameoftheSiteManager" },
  { label: "Establishment Name", key: "EstablishmentName" },
  { label: "PF Establishment Code", key: "OrganizationPFEstablishmentCode" },
  { label: "ESI Establishment Code", key: "OrganizationESIEstablishmentCode" },
  { label: "GST Number", key: "OrganizationGSTINNumber" },
  { label: "Contract Start Date", key: "ContractStartDate" },
  { label: "Contract End Date", key: "ContractEndDate" },
  { label: "Landline number", key: "Landlinenumber" },
  { label: "Site Manager Email", key: "SiteManagerEmail" },
  { label: "Site Manager Mobile", key: "SiteManagerMobile" },
  { label: "Contractor Contact Name", key: "ContractorContactName" },
  { label: "Site Incharge Email", key: "SiteInchargeEmail" },
  { label: "Contract Contact Mobile", key: "ContractContactMobile" },
  { label: "Establishment Code", key: "EstablishmentCode" },
  { label: "Secondary Mobile No", key: "SecondaryMobileNumber" },
  { label: "Secondary Email", key: "SecondaryEmail" },
  { label: "PF Registration Certificate", key: "PFRegistrationCertificateFileId" },
  { label: "GST Registration Certificate", key: "GSTRegistrationCertificateFileId" },
  { label: "Contract valid From", key: "ContractvalidFrom" },
  { label: "Contract Valid To", key: "ContractValidTo" },
  { label: "Communication Address", key: "CommunicationAddressLine1" },
  { label: "Name of Site Incharge", key: "NameofSiteIncharge" },
  { label: "Contractor Contact Email", key: "ContractorContactEmail" },
  { label: "Website", key: "Website" },
  { label: "Office Address", key: "OfficeAddressLine1" },
  { label: "Site Incharge Mobile", key: "SiteInchargeMobile" },
  { label: "Work name", key: "Natureofwork" },
  { label: "Name of the Partner", key: "NameoftheDirector" },
  { label: "Nature of work", key: "Natureofwork" },
  { label: "Registered Address", key: "RegisterAddressLine1" },
  { label: "PAN No.", key: "OrganizationPANNo" },
  { label: "Contractor ID", key: "id" },
  { label: "Establishment Short Name", key: "EstablishmentShortName" },
  { label: "Aadhar No.", key: "ContractorAadharNo" },
  { label: "PAN", key: "ContractorPANNo" },
  { label: "Aadhar", key: "ContractorAadharNo" },
  { label: "Organization", key: "Organization" },
  // Additional fields from screenshots:
  { label: "Registered Address Line 1", key: "RegisterAddressLine1" },
  { label: "Registered Address Line 2", key: "RegisterAddressLine2" },
  { label: "Register City", key: "RegisterCity" },
  { label: "Register State", key: "RegisterState" },
  { label: "Register Postal Code", key: "RegisterPostalCode" },
  { label: "Register Country", key: "RegisterCountry" },
  { label: "Office Address Line 1", key: "OfficeAddressLine1" },
  { label: "Office Address Line 2", key: "OfficeAddressLine2" },
  { label: "Office City", key: "OfficeCity" },
  { label: "Office State", key: "OfficeState" },
  { label: "Office Postal Code", key: "OfficePostalCode" },
  { label: "Office Country", key: "OfficeCountry" },
  { label: "Communication Address Line 1", key: "CommunicationAddressLine1" },
  { label: "Communication Address Line 2", key: "CommunicationAddressLine2" },
  { label: "Communication City", key: "CommunicationCity" },
  { label: "Communication State", key: "CommunicationState" },
  { label: "Communication Postal Code", key: "CommunicationPostalCode" },
  { label: "Communication Country", key: "CommunicationCountry" },
  { label: "Organization PAN No", key: "OrganizationPANNo" },
  { label: "Organization GST Number", key: "OrganizationGSTINNumber" },
  { label: "Organization PF Establishment Code", key: "OrganizationPFEstablishmentCode" },
  { label: "Organization ESI Establishment Code", key: "OrganizationESIEstablishmentCode" },
  { label: "Contractor PAN No", key: "ContractorPANNo" },
  { label: "Contractor Aadhar No", key: "ContractorAadharNo" },
];

function mapFormToApi(form) {
  return Object.fromEntries(
    Object.entries(form).filter(([key]) => allowedFields.includes(key))
  );
}

function ContractorRow({ contractor, index, editContractor, removeContractor, isSelected, onCheckboxChange, selectedContractors }) {
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const deleteContractor = useCallback((e) => {
    e.stopPropagation(); // Prevent row click when clicking delete
   
    if (!window.confirm(`Are you sure you want to delete contractor "${contractor.ContractorName || contractor.id}"?`)) {
      return;
    }
   
    setDeleting(true);
    setDeleteError('');
   
    console.log(`Attempting to delete contractor with ID: ${contractor.id}`);
   
    axios
      .delete(`/server/contracters_function/contractors/${contractor.id}`, {
        timeout: 10000
      })
      .then((response) => {
        console.log('Delete response:', response);
        removeContractor(contractor.id);
        setDeleteError('');
      })
      .catch((err) => {
        console.error('Delete error:', err);
        console.error('Error details:', {
          status: err.response?.status,
          statusText: err.response?.statusText,
          data: err.response?.data,
          message: err.message
        });
       
        let errorMessage = 'Failed to delete contractor.';
        if (err.response?.status === 404) {
          errorMessage = 'Contractor not found. It may have already been deleted.';
        } else if (err.response?.status === 403) {
          errorMessage = 'You do not have permission to delete this contractor.';
        } else if (err.response?.status === 500) {
          errorMessage = 'Server error. Please try again later.';
        } else if (err.response?.data?.message) {
          errorMessage = err.response.data.message;
        } else if (err.message) {
          errorMessage = err.message;
        }
       
        setDeleteError(errorMessage);
      })
      .finally(() => setDeleting(false));
  }, [contractor.id, contractor.ContractorName, removeContractor]);

  const handleRowClick = useCallback(() => {
    editContractor(contractor);
  }, [editContractor, contractor]);

  const handleCheckboxClick = useCallback((e) => {
    e.stopPropagation(); // Prevent row click when clicking checkbox
    onCheckboxChange(contractor.id, e.target.checked);
  }, [onCheckboxChange, contractor.id]);

  const handleEditButtonClick = useCallback((e) => {
    e.stopPropagation(); // Prevent row click when clicking edit button
    editContractor(contractor);
  }, [editContractor, contractor]);

  const handleApproveRejectClick = useCallback((e) => {
    e.stopPropagation(); // Prevent row click when clicking approve/reject button
    editContractor(contractor);
  }, [editContractor, contractor]);

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
            width: '18px',
            height: '18px',
            cursor: 'pointer',
            accentColor: '#dc3545',
          }}
          title="Select for deletion"
        />
      </td>
      <td style={{ paddingRight: '20px' }}>{index + 1}</td>
      {selectedContractors.length > 0 && (
        <td onClick={handleEditButtonClick}>
          {isSelected && (
            <button
              className="btn btn-icon"
              onClick={handleEditButtonClick}
              title="Edit"
              style={{
                background: 'transparent',
                border: 'none',
                color: '#232323',
                padding: '6px 8px',
                minWidth: '32px',
                height: '32px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
            >
              <i className="fas fa-edit"></i>
            </button>
          )}
        </td>
      )}
      <td onClick={handleApproveRejectClick}>
        <button
          className="btn btn-outline-primary"
          onClick={handleApproveRejectClick}
        >
          Approve/Reject
        </button>
      </td>
      <td
        onClick={handleRowClick}
        style={{ cursor: 'pointer' }}
      >
        <span
          className="contractor-status-badge"
          data-status={contractor.ApprovalStatus}
        >
          {contractor.ApprovalStatus || '-'}
        </span>
      </td>
      <td>{contractor.Organization || '-'}</td>
      <td>{contractor.EstablishmentCode || '-'}</td>
      <td>{contractor.LicenseNo || '-'}</td>
      <td>{contractor.ContractorName || '-'}</td>
      <td>{contractor.EstablishmentName || '-'}</td>
      <td>{contractor.PrimaryEmail || '-'}</td>
      <td>{contractor.ContractStartDate || '-'}</td>
      <td>{contractor.EstablishmentShortName || '-'}</td>
      <td>{contractor.ContractEndDate || '-'}</td>
      <td>{contractor.PrimaryMobileNo || '-'}</td>
      <td>{contractor.NumberOfEmployeesasperRC || '-'}</td>
      <td>{contractor.ContractvalidFrom || '-'}</td>
      <td>{contractor.SecondaryEmail || '-'}</td>
      <td>{contractor.Natureofwork || '-'}</td>
      <td>{contractor.ContractValidTo || '-'}</td>
      <td>{contractor.SecondaryMobileNumber || '-'}</td>
      <td>{contractor.NameoftheDirector || '-'}</td>
      <td>{contractor.Website || '-'}</td>
      <td>{contractor.Landlinenumber || '-'}</td>
      <td>{contractor.RegisterAddressLine1 || '-'}</td>
      <td>{contractor.RegisterAddressLine2 || '-'}</td>
      <td>{contractor.RegisterCity || '-'}</td>
      <td>{contractor.RegisterState || '-'}</td>
      <td>{contractor.RegisterPostalCode || '-'}</td>
      <td>{contractor.RegisterCountry || '-'}</td>
      <td>{contractor.OfficeAddressLine1 || '-'}</td>
      <td>{contractor.OfficeAddressLine2 || '-'}</td>
      <td>{contractor.OfficeCity || '-'}</td>
      <td>{contractor.OfficeState || '-'}</td>
      <td>{contractor.OfficePostalCode || '-'}</td>
      <td>{contractor.OfficeCountry || '-'}</td>
      <td>{contractor.OrganizationPANNo || '-'}</td>
      <td>{contractor.OrganizationGSTINNumber || '-'}</td>
      <td>{contractor.OrganizationPFEstablishmentCode || '-'}</td>
      <td>{contractor.OrganizationESIEstablishmentCode || '-'}</td>
      <td>{contractor.ContractorPANNo || '-'}</td>
      <td>{contractor.ContractorAadharNo || '-'}</td>
      <td>{contractor.NameoftheSiteManager || '-'}</td>
      <td>{contractor.NameofSiteIncharge || '-'}</td>
      <td>{contractor.SiteManagerMobile || '-'}</td>
      <td>{contractor.SiteInchargeMobile || '-'}</td>
      <td>{contractor.ContractorContactName || '-'}</td>
      <td>{contractor.ContractContactMobile || '-'}</td>
      <td>{contractor.SiteManagerEmail || '-'}</td>
      <td>{contractor.SiteInchargeEmail || '-'}</td>
      <td>{contractor.ContractorContactEmail || '-'}</td>
      <td>{contractor.ContractorStatus || '-'}</td>
      <td>{contractor.CommunicationAddressLine1 || '-'}</td>
      <td>{contractor.CommunicationAddressLine2 || '-'}</td>
      <td>{contractor.CommunicationCity || '-'}</td>
      <td>{contractor.CommunicationState || '-'}</td>
      <td>{contractor.CommunicationPostalCode || '-'}</td>
      <td>{contractor.CommunicationCountry || '-'}</td>
      <td>
        {contractor.OrganizationPANFileName && contractor.OrganizationPANFileId ? (
          <span
            style={{ cursor: 'pointer', color: '#3182ce', textDecoration: 'underline', fontWeight: 500 }}
            onClick={() => window.open(`/server/contracters_function/file/OrganizationPAN/${contractor.OrganizationPANFileId}`)}
            title={`Click to download: ${contractor.OrganizationPANFileName}`}
          >
            <i className="fas fa-file" style={{ marginRight: 4, color: '#666' }}></i>
            {contractor.OrganizationPANFileName}
          </span>
        ) : (contractor.OrganizationPAN || '-')}
      </td>
      <td>
        {contractor.GSTRegistartionCertificateFileName && contractor.GSTRegistartionCertificateFileId ? (
          <span
            style={{ cursor: 'pointer', color: '#3182ce', textDecoration: 'underline', fontWeight: 500 }}
            onClick={() => window.open(`/server/contracters_function/file/GSTRegistrationCertificate/${contractor.GSTRegistartionCertificateFileId}`)}
            title={`Click to download: ${contractor.GSTRegistartionCertificateFileName}`}
          >
            <i className="fas fa-file" style={{ marginRight: 4, color: '#666' }}></i>
            {contractor.GSTRegistartionCertificateFileName}
          </span>
        ) : (contractor.GSTRegistartionCertificate || '-')}
      </td>
      <td>
        {contractor.PFRegistrationCertificateFileName && contractor.PFRegistrationCertificateFileId ? (
          <span
            style={{ cursor: 'pointer', color: '#3182ce', textDecoration: 'underline', fontWeight: 500 }}
            onClick={() => window.open(`/server/contracters_function/file/PFRegistrationCertificate/${contractor.PFRegistrationCertificateFileId}`)}
            title={`Click to download: ${contractor.PFRegistrationCertificateFileName}`}
          >
            <i className="fas fa-file" style={{ marginRight: 4, color: '#666' }}></i>
            {contractor.PFRegistrationCertificateFileName}
          </span>
        ) : (contractor.PFRegistrationCertificate || '-')}
      </td>
      <td>
        {contractor.ESIRegistrationcertificateFileName && contractor.ESIRegistrationcertificateFileId ? (
          <span
            style={{ cursor: 'pointer', color: '#3182ce', textDecoration: 'underline', fontWeight: 500 }}
            onClick={() => window.open(`/server/contracters_function/file/ESIRegistrationCertificate/${contractor.ESIRegistrationcertificateFileId}`)}
            title={`Click to download: ${contractor.ESIRegistrationcertificateFileName}`}
          >
            <i className="fas fa-file" style={{ marginRight: 4, color: '#666' }}></i>
            {contractor.ESIRegistrationcertificateFileName}
          </span>
        ) : (contractor.ESIRegistrationcertificate || '-')}
      </td>
      <td>
        {contractor.ContractorPANFileName && contractor.ContractorPANFileId ? (
          <span
            style={{ cursor: 'pointer', color: '#3182ce', textDecoration: 'underline', fontWeight: 500 }}
            onClick={() => window.open(`/server/contracters_function/file/ContractorPAN/${contractor.ContractorPANFileId}`)}
            title={`Click to download: ${contractor.ContractorPANFileName}`}
          >
            <i className="fas fa-file" style={{ marginRight: 4, color: '#666' }}></i>
            {contractor.ContractorPANFileName}
          </span>
        ) : (contractor.ContractorPAN || '-')}
      </td>
      <td>
        {contractor.ContractorAadharFileName && contractor.ContractorAadharFileId ? (
          <span
            style={{ cursor: 'pointer', color: '#3182ce', textDecoration: 'underline', fontWeight: 500 }}
            onClick={() => window.open(`/server/contracters_function/file/ContractorAadhar/${contractor.ContractorAadharFileId}`)}
            title={`Click to download: ${contractor.ContractorAadharFileName}`}
          >
            <i className="fas fa-file" style={{ marginRight: 4, color: '#666' }}></i>
            {contractor.ContractorAadharFileName}
          </span>
        ) : (contractor.ContractorAadhar || '-')}
      </td>
      {deleteError && (
        <td colSpan="100%" style={{ backgroundColor: '#f8d7da', color: '#721c24', padding: '8px', border: '1px solid #f5c6cb' }}>
          <strong>Delete Error:</strong> {deleteError}
          <button
            onClick={() => setDeleteError('')}
            style={{
              background: 'none',
              border: 'none',
              color: '#721c24',
              cursor: 'pointer',
              marginLeft: '8px',
              fontSize: '12px'
            }}
            title="Dismiss error"
          >
            ✕
          </button>
        </td>
      )}
    </tr>
  );
}

function Contracters({ userRole = 'App Administrator', setUserRole }) {
  const userEmail = localStorage.getItem('userEmail') || null;
  const [contractors, setContractors] = useState([]);
  const [fetchError, setFetchError] = useState('');
  const [form, setForm] = useState(initialForm);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [pendingFiles, setPendingFiles] = useState({});
  const [uploadErrors, setUploadErrors] = useState({});
  const [uploading, setUploading] = useState(false);

  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importError, setImportError] = useState('');
  const [exportError, setExportError] = useState('');
  const fileInputRef = useRef(null);

  const [showSearchDropdown, setShowSearchDropdown] = useState(false);
  const initialSearchFields = Object.fromEntries(
    filterFieldMap.map(f => [f.key, { enabled: false, mode: 'is', value: '' }])
  );
  const [searchFields, setSearchFields] = useState(initialSearchFields);
  const dropdownRef = useRef(null);

  const [selectedContractors, setSelectedContractors] = useState([]);
  const [filteredContractors, setFilteredContractors] = useState([]);
 
  // Calculate if all contractors are selected
  const allSelected = filteredContractors.length > 0 && selectedContractors.length === filteredContractors.length;
  const someSelected = selectedContractors.length > 0 && selectedContractors.length < filteredContractors.length;

  // Contractor name dropdown states
  const [contractorNames, setContractorNames] = useState([]);
  const [contractorNameSearch, setContractorNameSearch] = useState('');
  const [isContractorNameDropdownOpen, setIsContractorNameDropdownOpen] = useState(false);
  const [loadingContractorNames, setLoadingContractorNames] = useState(false);

  // Organization dropdown states
  const [organizationNames, setOrganizationNames] = useState([]);
  const [organizationNameSearch, setOrganizationNameSearch] = useState('');
  const [isOrganizationNameDropdownOpen, setIsOrganizationNameDropdownOpen] = useState(false);
  const [loadingOrganizationNames, setLoadingOrganizationNames] = useState(false);

  // Filter contractor names based on search
  const filteredContractorNames = contractorNames.filter(name =>
    name.toLowerCase().includes(contractorNameSearch.toLowerCase())
  );

  // Filter organization names based on search
  const filteredOrganizationNames = organizationNames.filter(name =>
    name.toLowerCase().includes(organizationNameSearch.toLowerCase())
  );

  // Handle contractor name selection
  const handleContractorNameSelect = useCallback((selectedName) => {
    setSearchFields(prev => ({
      ...prev,
      ContractorName: {
        ...prev.ContractorName,
        selectedContractorName: selectedName,
        enabled: true
      }
    }));
    setContractorNameSearch('');
    setIsContractorNameDropdownOpen(false);
  }, []);

  // Handle organization name selection
  const handleOrganizationNameSelect = useCallback((selectedName) => {
    setSearchFields(prev => ({
      ...prev,
      Organization: {
        ...prev.Organization,
        selectedOrganizationName: selectedName,
        enabled: true
      }
    }));
    setOrganizationNameSearch('');
    setIsOrganizationNameDropdownOpen(false);
  }, []);

  const [updatingId, setUpdatingId] = useState(null);
  const [pendingStatus, setPendingStatus] = useState({});
  const [showContractorCount, setShowContractorCount] = useState(false);

  // Sidebar and navigation states
  const [showNotifications, setShowNotifications] = useState(false);
  const [showSidebarMenu, setShowSidebarMenu] = useState(false);
  const [expandedMenus, setExpandedMenus] = useState({});


  // Organization options management
  const [organizationOptions, setOrganizationOptions] = useState(initialOrganizationOptions);
  const [loadingOrganizations, setLoadingOrganizations] = useState(false);
  const [organizationError, setOrganizationError] = useState('');

  const modulesToShow = useMemo(
    () => getSidebarModulesForUser(resolveSidebarUserEmail(), userRole),
    [userRole]
  );

  // Toggle expandable menus
  const toggleMenu = (index) => {
    setExpandedMenus(prev => ({
      ...prev,
      [index]: !prev[index]
    }));
  };

  // Fetch contractors
  const fetchContractors = useCallback(() => {
    setFetchError('');
    axios
      .get('/server/contracters_function/contractors', { params: { page: 1, perPage: 50 }, timeout: 5000 })
      .then((response) => {
        if (!response?.data?.data?.contractors) throw new Error('Unexpected API response structure');
        setContractors(response.data.data.contractors);
      })
      .catch((err) => {
        setFetchError(err.response?.data?.message || 'Failed to fetch contractors.');
      });
  }, []);

  // Fetch organizations
  const fetchOrganizations = useCallback(() => {
    setLoadingOrganizations(true);
    setOrganizationError('');
    axios
      .get('/server/contracters_function/organizations', { params: { page: 1, perPage: 100 }, timeout: 5000 })
      .then((response) => {
        if (!response?.data?.data?.organizations) throw new Error('Unexpected API response structure');
        const organizations = response.data.data.organizations || [];
        const orgOptions = [
          { value: '', label: '-Select-' },
          ...organizations.map(org => ({
            value: org.OrganizationName || org.organizationName || org.id,
            label: org.OrganizationName || org.organizationName || `Organization ${org.id}`
          }))
        ];
        setOrganizationOptions(orgOptions);
      })
      .catch((err) => {
        setOrganizationError(err.response?.data?.message || 'Failed to fetch organizations.');
        console.error('Fetch organizations error:', err);
      })
      .finally(() => {
        setLoadingOrganizations(false);
      });
  }, []);

  // Fetch all contractor names for dropdown
  const fetchAllContractorNames = useCallback(async () => {
    setLoadingContractorNames(true);
    try {
      const response = await axios.get('/server/contracters_function/contractors', {
        params: { page: 1, perPage: 1000 },
        timeout: 10000
      });
     
      if (response?.data?.data?.contractors) {
        const allContractors = response.data.data.contractors;
        const uniqueNames = [...new Set(allContractors
          .map(contractor => contractor.ContractorName)
          .filter(name => name && name.trim() !== '')
        )].sort();
        setContractorNames(uniqueNames);
      }
    } catch (error) {
      console.error('Failed to fetch contractor names:', error);
    } finally {
      setLoadingContractorNames(false);
    }
  }, []);

  // Fetch all organization names for dropdown
  const fetchAllOrganizationNames = useCallback(async () => {
    setLoadingOrganizationNames(true);
    try {
      const response = await axios.get('/server/contracters_function/contractors', {
        params: { page: 1, perPage: 1000 },
        timeout: 10000
      });
     
      if (response?.data?.data?.contractors) {
        const allContractors = response.data.data.contractors;
        const uniqueNames = [...new Set(allContractors
          .map(contractor => contractor.Organization)
          .filter(name => name && name.trim() !== '')
        )].sort();
        setOrganizationNames(uniqueNames);
      }
    } catch (error) {
      console.error('Failed to fetch organization names:', error);
    } finally {
      setLoadingOrganizationNames(false);
    }
  }, []);

  useEffect(() => {
    fetchContractors();
  }, [fetchContractors]);

  useEffect(() => {
    setFilteredContractors(contractors);
  }, [contractors]);

  // Handle click outside to close search modal
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowSearchDropdown(false);
      }
    };

    if (showSearchDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showSearchDropdown]);

  // Handle click outside to close contractor name dropdown
  useEffect(() => {
    const handleClickOutside = (event) => {
      const dropdown = document.querySelector('[data-dropdown="ContractorName"]');
      if (dropdown && !dropdown.contains(event.target)) {
        setIsContractorNameDropdownOpen(false);
      }
    };

    if (isContractorNameDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isContractorNameDropdownOpen]);

  // Handle click outside to close organization name dropdown
  useEffect(() => {
    const handleClickOutside = (event) => {
      const dropdown = document.querySelector('[data-dropdown="Organization"]');
      if (dropdown && !dropdown.contains(event.target)) {
        setIsOrganizationNameDropdownOpen(false);
      }
    };

    if (isOrganizationNameDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOrganizationNameDropdownOpen]);

  // Helper function to update form and clear errors
  const updateForm = useCallback((field, value) => {
    setForm(prev => ({ ...prev, [field]: value }));
    setFormError(''); // Clear errors when user starts typing
  }, []);

  // Copy address functions
  const copyRegisteredToOffice = useCallback(() => {
    setForm(prev => ({
      ...prev,
      OfficeAddressLine1: prev.RegisterAddressLine1,
      OfficeAddressLine2: prev.RegisterAddressLine2,
      OfficeCity: prev.RegisterCity,
      OfficeState: prev.RegisterState,
      OfficePostalCode: prev.RegisterPostalCode,
      OfficeCountry: prev.RegisterCountry,
    }));
  }, []);

  const copyRegisteredToCommunication = useCallback(() => {
    setForm(prev => ({
      ...prev,
      CommunicationAddressLine1: prev.RegisterAddressLine1,
      CommunicationAddressLine2: prev.RegisterAddressLine2,
      CommunicationCity: prev.RegisterCity,
      CommunicationState: prev.RegisterState,
      CommunicationPostalCode: prev.RegisterPostalCode,
      CommunicationCountry: prev.RegisterCountry,
    }));
  }, []);

  const copyOfficeToCommunication = useCallback(() => {
    setForm(prev => ({
      ...prev,
      CommunicationAddressLine1: prev.OfficeAddressLine1,
      CommunicationAddressLine2: prev.OfficeAddressLine2,
      CommunicationCity: prev.OfficeCity,
      CommunicationState: prev.OfficeState,
      CommunicationPostalCode: prev.OfficePostalCode,
      CommunicationCountry: prev.OfficeCountry,
    }));
  }, []);

  const validateForm = useCallback(() => {
    const errors = [];
    if (!form.Organization) errors.push('Organization is required.');
    if (!form.ContractorName?.trim()) errors.push('Contractor Name is required.');
    if (!form.PrimaryEmail?.trim()) errors.push('Primary Email is required.');
    if (!form.PrimaryMobileNo?.trim()) errors.push('Primary Mobile No. is required.');
    if (form.PrimaryMobileNo && !/^[0-9]{10}$/.test(form.PrimaryMobileNo)) {
      errors.push('Primary Mobile No. must be exactly 10 digits.');
    }
    if (form.SecondaryMobileNumber && !/^[0-9]{10}$/.test(form.SecondaryMobileNumber)) {
      errors.push('Secondary Mobile No must be exactly 10 digits.');
    }
    if (form.ContractorAadharNo && !/^[0-9]{12}$/.test(form.ContractorAadharNo)) {
      errors.push('Aadhar No. must be exactly 12 digits.');
    }
    if (form.ContractorPANNo && !/^[A-Z]{3}P[A-Z][0-9]{4}[A-Z]$/.test(form.ContractorPANNo)) {
      errors.push('PAN No. must be 10 characters: first 5 uppercase letters (4th must be P), next 4 digits, last letter. Example: ABCPA1234D');
    }
    if (form.OrganizationGSTINNumber && !/^[0-9]{2}[A-Z]{3}P[A-Z][0-9]{4}[A-Z][A-Z0-9]{3}$/.test(form.OrganizationGSTINNumber)) {
      errors.push('GSTIN must be 15 characters: 2 digits (state code), 10-character PAN (4th letter P), and 3 alphanumeric characters. Example: 22ABCPA1234D1Z5');
    }
    if (errors.length > 0) {
      setFormError(errors.join(' '));
      return false;
    }
    return true;
  }, [form]);

  const saveContractor = useCallback(
    async (e) => {
      e.preventDefault();
      if (!validateForm()) return;
      setSubmitting(true);
      setUploading(true);

      try {
        // Upload pending files if any
        const pendingFilesToUpload = pendingFiles || {};
        console.log('Form state before upload:', form);
        console.log('Pending files to upload:', pendingFilesToUpload);
        console.log('Pending files keys:', Object.keys(pendingFilesToUpload));
       
        const uploadErrors = {};
        const uploadedFileInfo = {};
       
        for (const key of Object.keys(pendingFilesToUpload)) {
          const file = pendingFilesToUpload[key];
          console.log('Processing file upload for key:', key, 'file:', file);
          if (!file) {
            console.log('No file found for key:', key);
            continue;
          }
         
          const formData = new FormData();
          formData.append('file', file);
          console.log('FormData created for key:', key, 'file name:', file.name, 'file size:', file.size);
         
          const uploadUrl = isEditing
            ? `/server/contracters_function/contractors/${editingId}/upload/${key}`
            : `/server/contracters_function/contractors/new-upload/${key}`;
          console.log('Upload URL:', uploadUrl);
         
          try {
            console.log('Starting upload request for key:', key);
            const resp = await axios.post(uploadUrl, formData, {
              headers: { 'Content-Type': 'multipart/form-data' },
              timeout: 20000,
            });
            console.log('Upload response for key:', key, 'response:', resp.data);
            console.log('Response status:', resp.status);
            console.log('Response headers:', resp.headers);
            console.log('Full response object:', resp);
           
            // Check if the response has the expected structure
            if (resp.data && resp.data.status === 'success' && resp.data.fileId) {
              uploadedFileInfo[`${key}FileId`] = resp.data.fileId;
              uploadedFileInfo[`${key}FileName`] = resp.data.fileName || file.name;
              console.log('File uploaded successfully for key:', key, 'fileId:', resp.data.fileId, 'fileName:', resp.data.fileName || file.name);
            } else if (resp.data && resp.data.fileId) {
              // Fallback: if status is missing but fileId exists
              uploadedFileInfo[`${key}FileId`] = resp.data.fileId;
              uploadedFileInfo[`${key}FileName`] = resp.data.fileName || file.name;
              console.log('File uploaded successfully for key:', key, 'fileId:', resp.data.fileId, 'fileName:', resp.data.fileName || file.name);
            } else if (resp.data && resp.data.data && resp.data.data.fileId) {
              // Fallback: if response is wrapped in a data object
              uploadedFileInfo[`${key}FileId`] = resp.data.data.fileId;
              uploadedFileInfo[`${key}FileName`] = resp.data.data.fileName || file.name;
              console.log('File uploaded successfully for key:', key, 'fileId:', resp.data.data.fileId, 'fileName:', resp.data.data.fileName || file.name);
            } else if (resp.data && resp.data.success && resp.data.fileId) {
              // Fallback: if status is 'success' instead of 'success'
              uploadedFileInfo[`${key}FileId`] = resp.data.fileId;
              uploadedFileInfo[`${key}FileName`] = resp.data.fileName || file.name;
              console.log('File uploaded successfully for key:', key, 'fileId:', resp.data.fileId, 'fileName:', resp.data.fileName || file.name);
            } else {
              console.error('Upload response missing fileId for key:', key, 'response:', resp.data);
              console.error('Response data type:', typeof resp.data);
              console.error('Response data keys:', Object.keys(resp.data || {}));
              uploadErrors[key] = 'Upload response missing file ID. Please try again.';
            }
          } catch (err) {
            console.error('Upload error for key:', key, 'error:', err);
            console.error('Error response:', err.response?.data);
            console.error('Error status:', err.response?.status);
           
            // Provide more specific error messages
            let errorMessage = 'Upload failed.';
            if (err.response?.status === 413) {
              errorMessage = 'File too large. Maximum size is 5MB.';
            } else if (err.response?.status === 400) {
              errorMessage = err.response?.data?.message || 'Invalid file type. Only PDF, JPG, JPEG, and PNG files are allowed.';
            } else if (err.response?.status === 500) {
              errorMessage = 'Server error during upload. Please try again.';
            } else if (err.code === 'ECONNABORTED') {
              errorMessage = 'Upload timeout. Please try again.';
            } else if (err.response?.data?.message) {
              errorMessage = err.response.data.message;
            }
           
            uploadErrors[key] = errorMessage;
          }
        }
       
        if (Object.keys(uploadErrors).length > 0) {
          console.error('Upload errors found:', uploadErrors);
          setUploadErrors(uploadErrors);
          setSubmitting(false);
          setUploading(false);
          return;
        }
       
        console.log('All files uploaded successfully. Uploaded file info:', uploadedFileInfo);

        // Clean the form data like in EmployeeManagement.js
        const requiredFields = ['Organization', 'ContractorName', 'PrimaryEmail', 'PrimaryMobileNo'];
        const cleanedForm = Object.fromEntries(
          Object.entries(form).map(([key, value]) => {
            let cleanedValue = value;
           
            // Handle string values
            if (typeof value === 'string') {
              cleanedValue = value.trim();
              // Convert empty strings to null for non-required fields
              if (cleanedValue === '' && !requiredFields.includes(key)) {
                cleanedValue = null;
              }
            }
           
            // Handle numeric fields - ensure they are numbers or null
            const numericFields = ['NumberOfEmployeesasperRC'];
            if (numericFields.includes(key) && cleanedValue !== null && cleanedValue !== '') {
              const numValue = Number(cleanedValue);
              cleanedValue = isNaN(numValue) ? null : numValue;
            }
           
            // Handle date fields - ensure they are valid dates or null
            const dateFields = ['ContractStartDate', 'ContractEndDate', 'ContractvalidFrom', 'ContractValidTo'];
            if (dateFields.includes(key) && cleanedValue !== null && cleanedValue !== '') {
              const dateValue = new Date(cleanedValue);
              cleanedValue = isNaN(dateValue.getTime()) ? null : cleanedValue;
            }
           
            return [key, cleanedValue];
          })
        );

        // Merge uploaded file info directly into cleanedForm with correct database column names
        Object.entries(uploadedFileInfo).forEach(([key, value]) => {
          if (key.endsWith('FileId') && value !== null && value !== undefined) {
            // Direct mapping to FileId columns in database
            const fileIdMapping = {
              'OrganizationPANFileId': 'OrganizationPANFileId',
              'GSTRegistrationCertificateFileId': 'GSTRegistartionCertificateFileId',
              'PFRegistrationCertificateFileId': 'PFRegistrationCertificateFileId',
              'ESIRegistrationCertificateFileId': 'ESIRegistrationcertificateFileId',
              'ContractorPANFileId': 'ContractorPANFileId',
              'ContractorAadharFileId': 'ContractorAadharFileId'
            };
           
            const dbColumnName = fileIdMapping[key];
            if (dbColumnName) {
              cleanedForm[dbColumnName] = String(value);
              console.log(`Mapped ${key} (${value}) to database column ${dbColumnName}`);
            } else {
              console.warn(`No mapping found for file key: ${key}`);
            }
          } else if (key.endsWith('FileName')) {
            // Direct mapping to FileName columns in database
            const fileNameMapping = {
              'OrganizationPANFileName': 'OrganizationPANFileName',
              'GSTRegistrationCertificateFileName': 'GSTRegistartionCertificateFileName',
              'PFRegistrationCertificateFileName': 'PFRegistrationCertificateFileName',
              'ESIRegistrationCertificateFileName': 'ESIRegistrationcertificateFileName',
              'ContractorPANFileName': 'ContractorPANFileName',
              'ContractorAadharFileName': 'ContractorAadharFileName'
            };
            const dbNameCol = fileNameMapping[key];
            if (dbNameCol) {
              cleanedForm[dbNameCol] = String(value);
              console.log(`Mapped ${key} (${value}) to database column ${dbNameCol}`);
            } else {
              console.log(`Skipping file name (no mapping): ${key}`);
            }
          } else {
            cleanedForm[key] = value;
          }
        });
       
        const apiPayload = mapFormToApi(cleanedForm);
       
        console.log('Original form:', form);
        console.log('Uploaded file info:', uploadedFileInfo);
        console.log('Cleaned form:', cleanedForm);
        console.log('API payload being sent:', apiPayload);
        console.log('Payload keys:', Object.keys(apiPayload));
       
        // Log each field being sent to help debug the "Invalid input value for column name" error
        console.log('Detailed payload analysis:');
        Object.entries(apiPayload).forEach(([key, value]) => {
          console.log(`${key}: ${value} (type: ${typeof value})`);
        });
       
        // Check if required fields are present
        const missingFields = requiredFields.filter(field => !apiPayload[field] || (typeof apiPayload[field] === 'string' && apiPayload[field].trim() === ''));
        if (missingFields.length > 0) {
          console.error('Missing required fields:', missingFields);
          setFormError(`Missing required fields: ${missingFields.join(', ')}`);
          setSubmitting(false);
          setUploading(false);
          return;
        }
       
        // Final validation - ensure no undefined or invalid values
        const invalidFields = Object.entries(apiPayload).filter(([key, value]) => {
          if (value === undefined) return true;
          if (typeof value === 'string' && value.includes('\x00')) return true; // Check for null bytes
          return false;
        });
       
        if (invalidFields.length > 0) {
          console.error('Invalid fields found:', invalidFields);
          setFormError(`Invalid data in fields: ${invalidFields.map(([key]) => key).join(', ')}`);
          setSubmitting(false);
          setUploading(false);
          return;
        }
       
        const request = isEditing
          ? axios.put(`/server/contracters_function/contractors/${editingId}`, apiPayload, { timeout: 5000 })
          : axios.post('/server/contracters_function/contractors', apiPayload, { timeout: 5000 });

        console.log('Making request to:', isEditing ? `PUT /server/contracters_function/contractors/${editingId}` : 'POST /server/contracters_function/contractors');
       


        const response = await request;
        console.log('Save contractor response:', response);
       
        fetchContractors();
        setForm(initialForm);
        setShowForm(false);
        setIsEditing(false);
        setEditingId(null);
        setPendingFiles({});
        setUploadErrors({});
       
      } catch (err) {
        console.error('Save contractor error:', err);
        console.error('Error response:', err.response?.data);
        console.error('Error status:', err.response?.status);
        console.error('Error message:', err.message);
        console.error('Error details:', {
          message: err.message,
          stack: err.stack,
          name: err.name
        });
       
        let errorMessage = err.response?.data?.message || (isEditing ? 'Failed to update contractor.' : 'Failed to add contractor.');
       
        // Provide more specific error messages
        if (err.response?.status === 400) {
          errorMessage = err.response?.data?.message || 'Invalid form data. Please check all required fields.';
        } else if (err.response?.status === 500) {
          errorMessage = 'Server error. Please try again.';
        } else if (err.code === 'ECONNABORTED') {
          errorMessage = 'Request timeout. Please try again.';
        } else if (err.message) {
          errorMessage = err.message;
        }
       
        setFormError(errorMessage);
      } finally {
        setSubmitting(false);
        setUploading(false);
      }
    },
    [form, isEditing, editingId, validateForm, fetchContractors, pendingFiles]
  );

  const removeContractor = useCallback((id) => {
    setContractors((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const editContractor = useCallback((contractor) => {
    setForm({ ...initialForm, ...contractor });
    setIsEditing(true);
    setEditingId(contractor.id);
    setShowForm(true);
    setFormError('');
    setPendingFiles({});
    setUploadErrors({});
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const toggleForm = useCallback(() => {
    setShowForm((prev) => !prev);
    setFormError('');
    setForm(initialForm);
    setIsEditing(false);
    setEditingId(null);
    setPendingFiles({});
    setUploadErrors({});
    if (!showForm) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [showForm]);

  // Clear all upload errors
  const clearAllUploadErrors = useCallback(() => {
    setUploadErrors({});
  }, []);

  const toggleSearchDropdown = useCallback(() => {
    setShowSearchDropdown((prev) => !prev);
  }, []);

  const resetSearch = useCallback(() => {
    setSearchFields(initialSearchFields);
    setFilteredContractors(contractors);
  }, [contractors]);

  const applyFilter = useCallback(() => {
    let filtered = contractors;
    Object.entries(searchFields).forEach(([field, config]) => {
      if (config.enabled) {
        // Handle contractor name dropdown selection
        if (field === 'ContractorName' && config.selectedContractorName) {
          filtered = filtered.filter(c =>
            c.ContractorName === config.selectedContractorName
          );
        } else if (field === 'Organization' && config.selectedOrganizationName) {
          filtered = filtered.filter(c =>
            c.Organization === config.selectedOrganizationName
          );
        } else if (config.value && config.value.trim() !== '') {
          const val = config.value.toLowerCase();
          filtered = filtered.filter(c => {
            const fieldVal = (c[field] || '').toString().toLowerCase();
           
            // For simple input fields (no mode selector), use "contains" by default
            const simpleInputFields = ['NumberOfEmployeesasperRC', 'LicenseNo', 'ContractorStatus', 'PrimaryEmail', 'PrimaryMobileNo', 'ESIRegistrationCertificateFileId', 'NameoftheSiteManager', 'EstablishmentName', 'OrganizationPFEstablishmentCode', 'OrganizationESIEstablishmentCode', 'OrganizationGSTINNumber', 'ContractStartDate', 'ContractEndDate', 'Landlinenumber', 'SiteManagerEmail', 'SiteManagerMobile', 'ContractorContactName', 'SiteInchargeEmail', 'ContractContactMobile', 'EstablishmentCode', 'SecondaryMobileNumber', 'SecondaryEmail', 'PFRegistrationCertificateFileId', 'GSTRegistrationCertificateFileId', 'ContractvalidFrom', 'ContractValidTo', 'CommunicationAddressLine1', 'NameofSiteIncharge', 'ContractorContactEmail', 'Website', 'OfficeAddressLine1', 'SiteInchargeMobile', 'Natureofwork', 'NameoftheDirector', 'RegisterAddressLine1', 'RegisterAddressLine2', 'RegisterCity', 'RegisterState', 'RegisterPostalCode', 'RegisterCountry', 'OfficeAddressLine1', 'OfficeAddressLine2', 'OfficeCity', 'OfficeState', 'OfficePostalCode', 'OfficeCountry', 'CommunicationAddressLine1', 'CommunicationAddressLine2', 'CommunicationCity', 'CommunicationState', 'CommunicationPostalCode', 'CommunicationCountry', 'OrganizationPANNo', 'OrganizationGSTINNumber', 'OrganizationPFEstablishmentCode', 'OrganizationESIEstablishmentCode', 'ContractorPANNo', 'ContractorAadharNo', 'id', 'EstablishmentShortName', 'ApprovalStatus'];
           
            if (simpleInputFields.includes(field)) {
              // Use "contains" search for simple input fields
              return fieldVal.includes(val);
            } else {
              // Use mode selector for other fields
              switch (config.mode) {
                case 'is':
                  return fieldVal === val;
                case 'contains':
                  return fieldVal.includes(val);
                case 'startsWith':
                  return fieldVal.startsWith(val);
                case 'endsWith':
                  return fieldVal.endsWith(val);
                default:
                  return true;
              }
            }
          });
        }
      }
    });
    setFilteredContractors(filtered);
    // Removed setShowSearchDropdown(false) to keep the filter sidebar open
  }, [contractors, searchFields]);

  const handleImport = useCallback((e) => {
    setImporting(true);
    setImportError('');
    const file = e.target.files[0];
    if (!file) {
      setImporting(false);
      return;
    }
    const reader = new FileReader();
    reader.onload = async (evt) => {
      let successCount = 0;
      let failCount = 0;
      let failRows = [];
      try {
        const data = new Uint8Array(evt.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const json = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

        if (!json.length) {
          setImportError('No data found in the file.');
          setImporting(false);
          return;
        }

        // Check for required columns
        const missingColumns = allowedFields.filter(f => !(f in json[0]));
        if (missingColumns.length) {
          setImportError('Missing columns: ' + missingColumns.join(', '));
          setImporting(false);
          return;
        }

        for (const [i, row] of json.entries()) {
          // Only send allowed fields
          const payload = Object.fromEntries(
            allowedFields.map(f => [f, row[f] || ''])
          );
          // Skip empty rows
          if (Object.values(payload).every(val => !val)) continue;
          try {
            await axios.post('/server/contracters_function/contractors', payload, { timeout: 5000 });
            successCount++;
          } catch (err) {
            failCount++;
            failRows.push(i + 2); // Excel rows are 1-indexed, +1 for header
          }
        }
        fetchContractors();
        if (failCount === 0) {
          alert(`Import successful! Imported ${successCount} records.`);
        } else {
          setImportError(`Imported ${successCount} records. Failed to import ${failCount} rows (Excel rows: ${failRows.join(', ')}).`);
        }
      } catch (err) {
        setImportError('Failed to import data. Please check your file format.');
      }
      setImporting(false);
      e.target.value = ''; // Reset file input
    };
    reader.readAsArrayBuffer(file);
  }, [fetchContractors]);

  const handleExport = useCallback(() => {
    setExporting(true);
    try {
      // Use filteredContractors for export
      const dataToExport = filteredContractors.length ? filteredContractors : contractors;
      if (!dataToExport.length) {
        alert('No data to export.');
        setExporting(false);
        return;
      }
      // Only export allowed fields
      const exportData = dataToExport.map(row =>
        Object.fromEntries(
          allowedFields.map(f => [f, row[f] || ''])
        )
      );
      const ws = XLSX.utils.json_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Contractors');
      XLSX.writeFile(wb, 'contractors_export.xlsx');
    } catch (err) {
      setExportError('Failed to export data.');
    }
    setExporting(false);
  }, [filteredContractors, contractors]);



  const handleDeleteSelected = async () => {
    if (!window.confirm(`Delete ${selectedContractors.length} contractors?`)) return;
    setSubmitting(true);
   
    let successCount = 0;
    let failCount = 0;
    const failedIds = [];
   
    try {
      // Delete contractors one by one to get better error handling
      for (const id of selectedContractors) {
        try {
          console.log(`Attempting to delete contractor with ID: ${id}`);
          await axios.delete(`/server/contracters_function/contractors/${id}`, {
            timeout: 10000
          });
          successCount++;
          console.log(`Successfully deleted contractor with ID: ${id}`);
        } catch (error) {
          failCount++;
          failedIds.push(id);
          console.error(`Failed to delete contractor with ID: ${id}`, error);
          console.error('Error details:', {
            status: error.response?.status,
            statusText: error.response?.statusText,
            data: error.response?.data,
            message: error.message
          });
        }
      }
     
      // Update the contractors list by removing successfully deleted ones
      if (successCount > 0) {
        setContractors(prev => prev.filter(c => !selectedContractors.includes(c.id)));
        setFilteredContractors(prev => prev.filter(c => !selectedContractors.includes(c.id)));
        setSelectedContractors([]);
      }
     
      // Show results
      if (failCount === 0) {
        alert(`Successfully deleted ${successCount} contractors.`);
      } else if (successCount > 0) {
        alert(`Deleted ${successCount} contractors successfully. Failed to delete ${failCount} contractors.`);
      } else {
        alert(`Failed to delete all ${failCount} contractors. Please check the console for details.`);
      }
     
    } catch (err) {
      console.error('Unexpected error during bulk delete:', err);
      alert('An unexpected error occurred during deletion. Please check the console for details.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSelectAll = useCallback(() => {
    if (allSelected) {
      // If all are selected, deselect all
      setSelectedContractors([]);
    } else {
      // If not all are selected, select all
      const allIds = filteredContractors.map(contractor => contractor.id);
      setSelectedContractors(allIds);
    }
  }, [allSelected, filteredContractors]);

  const handleApproval = (contractor, status) => {
    axios
      .put(`/server/contracters_function/contractors/${contractor.id}`, {
        ...contractor,
        ApprovalStatus: status,
      })
      .then(() => {
        fetchContractors(); // Refresh the list
      })
      .catch((err) => {
        alert("Failed to update approval status.");
      });
  };

  const handleRefresh = () => {
    window.location.reload(); // Triggers a full page reload
  };

  // Create dropdown UI function (similar to EmployeeManagement)
  const createDropdownUI = (field, label, data, searchValue, setSearchValue, isOpen, setIsOpen, onSelect, loading, filteredData) => {
    const getSelectedValue = () => {
      const fieldData = searchFields[field];
      if (field === 'ContractorName') return fieldData.selectedContractorName;
      if (field === 'Organization') return fieldData.selectedOrganizationName;
      return '';
    };

    const selectedValue = getSelectedValue();

    return (
      <div style={{ position: 'relative' }} data-dropdown={field}>
        <div
          onClick={() => setIsOpen(prev => {
            if (!prev && data.length === 0) {
              console.log(`Opening ${field} dropdown, data length:`, data.length);
              if (field === 'ContractorName') fetchAllContractorNames();
              else if (field === 'Organization') fetchAllOrganizationNames();
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
          <div
            style={{
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
            }}
          >
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
           
            {loading ? (
              <div style={{ padding: '8px', textAlign: 'center', color: '#6b7280' }}>
                Loading...
              </div>
            ) : filteredData.length === 0 ? (
              <div style={{ padding: '8px', textAlign: 'center', color: '#6b7280' }}>
                No {label.toLowerCase()} found
              </div>
            ) : (
              filteredData.map((item, index) => (
                <div
                  key={index}
                  onClick={() => onSelect(item)}
                  style={{
                    padding: '8px 12px',
                    cursor: 'pointer',
                    borderBottom: index < filteredData.length - 1 ? '1px solid #f0f0f0' : 'none',
                    backgroundColor: selectedValue === item ? '#f0f9ff' : 'transparent',
                    color: selectedValue === item ? '#1d4ed8' : '#000'
                  }}
                  onMouseEnter={(e) => {
                    if (selectedValue !== item) {
                      e.target.style.backgroundColor = '#f8fafc';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (selectedValue !== item) {
                      e.target.style.backgroundColor = 'transparent';
                    }
                  }}
                >
                  {item}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    );
  };


  // Handle organization dropdown click to fetch organizations
  const handleOrganizationDropdownClick = useCallback(() => {
    if (organizationOptions.length === 1) { // Only has "-Select-" option
      fetchOrganizations();
    }
  }, [organizationOptions.length, fetchOrganizations]);

  const totalContractors = contractors.filter(c => c.ContractorName && c.ContractorName.trim()).length;

  // User info
  const userAvatar = "https://images.pexels.com/photos/2379004/pexels-photo-2379004.jpeg?auto=compress&cs=tinysrgb&w=150";
  const userName = userRole === 'App Administrator' ? 'Admin User' : 'App User';

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
          {/* Enhanced Header (same as Home) */}
          <header className="cms-header">
            <div className="cms-header-title">
              <div className="cms-header-text">
                <h1>{(userEmail === 'afrindinu14@gmail.com' || userEmail === 'vaishnavi.a@buildhr.co.in') ? 'Yashaswi Academy for Skills' : 'Payroll Management System'}</h1>
              </div>
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
          {/* Dashboard Content */}
          <div className="cms-dashboard-content">
            {/* Contractor Management Section */}
            <div className="contractor-management-section">
              {/* Header Actions */}
              <div className="contractor-header-actions">
                <div className="contractor-title-section">
                  <h2 className="contractor-title">
                    <Handshake size={28} />
                    Contractor Directory
                  </h2>
                  <p className="contractor-subtitle">
                    Manage your contractor details efficiently
                  </p>
                </div>
               
                <div className="contractor-actions" style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'nowrap' }}>
          <button
                    className="toolbar-btn import-btn"
            onClick={() => fileInputRef.current.click()}
            disabled={importing}
                    title="Import contractors from Excel"
                    type="button"
                    style={{ background: '#fff', color: '#2563eb', border: 'none', fontWeight: 600, padding: '8px', borderRadius: '8px', width: '48px', height: '48px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}
                  >
                    {importing ? (
                      <div className="btn-loader">
                        <div className="cms-spinner"></div>
                      </div>
                    ) : (
                      <FileInput size={22} style={{ color: '#2563eb' }} />
                    )}
          </button>
                 
          <button
                    className="toolbar-btn export-btn"
            onClick={handleExport}
            disabled={exporting}
                    title="Export filtered contractors to Excel"
                    type="button"
                    style={{ background: '#fff', color: '#22c55e', border: 'none', fontWeight: 600, padding: '8px', borderRadius: '8px', width: '48px', height: '48px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}
                  >
                    {exporting ? (
                      <div className="btn-loader">
                        <div className="cms-spinner"></div>
                      </div>
                    ) : (
                      <FileOutput size={22} style={{ color: '#22c55e' }} />
                    )}
          </button>
                 
          <button
                    className="toolbar-btn filter-btn"
            onClick={toggleSearchDropdown}
                    aria-expanded={showSearchDropdown}
                    aria-controls="search-dropdown"
                    type="button"
                    title={showSearchDropdown ? "Hide filter options" : "Show filter options"}
                    style={{
                      background: showSearchDropdown ? '#f97316' : '#fff',
                      color: showSearchDropdown ? '#fff' : '#f97316',
                      border: 'none',
                      fontWeight: 600,
                      padding: '8px',
                      borderRadius: '8px',
                      width: '48px',
                      height: '48px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'all 0.2s ease',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.08)'
                    }}
                  >
                    <Filter size={22} style={{ color: showSearchDropdown ? '#fff' : '#f97316' }} />
          </button>
                 
          <button
                    className="toolbar-btn"
            onClick={handleRefresh}
                    disabled={submitting}
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
                    title="Add new contractor"
                    style={{ background: '#fff', color: '#14b8a6', border: 'none', fontWeight: 700, fontSize: '1.2rem', borderRadius: '8px', width: '48px', height: '48px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(60,72,88,0.10)' }}
                  >
                    <Plus size={24} style={{ color: '#14b8a6' }} />
            </button>
            {/* Delete button for selected contractors - moved after + button */}
            {selectedContractors.length > 0 && (
              <button
                className="toolbar-btn"
                onClick={handleDeleteSelected}
                disabled={submitting}
                title="Delete selected contractors"
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

              {/* Messages */}
              {formError && (
                <div className="cms-message cms-message-error">
                  <AlertTriangle size={20} />
                  {formError}
                </div>
              )}
             
              {Object.keys(uploadErrors).length > 0 && (
                <div className="cms-message cms-message-warning">
                  <AlertTriangle size={20} />
                  <div>
                    <strong>File Upload Issues:</strong>
                    <ul style={{ margin: '8px 0 0 20px', padding: 0 }}>
                      {Object.entries(uploadErrors).map(([key, error]) => (
                        <li key={key} style={{ marginBottom: '4px' }}>
                          <strong>{key}:</strong> {error}
                        </li>
                      ))}
                    </ul>
                    <button
                      type="button"
                      onClick={clearAllUploadErrors}
                      style={{
                        background: 'none',
                        border: '1px solid #856404',
                        color: '#856404',
                        padding: '4px 8px',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        marginTop: '8px',
                        fontSize: '12px'
                      }}
                    >
                      Clear All Errors
                    </button>
                  </div>
                </div>
              )}
             
              {importError && (
                <div className="cms-message cms-message-error">
                  <AlertTriangle size={20} />
                  {importError}
                </div>
              )}
             
              {exportError && (
                <div className="cms-message cms-message-error">
                  <AlertTriangle size={20} />
                  {exportError}
                </div>
              )}

              {/* Content */}
              <div className="contractor-content">
                {showForm ? (
                  <div className="contractor-form-page">
                    <div className="contractor-form-container">
                      <div className="contractor-form-header">
                        <h2>{isEditing ? 'Edit Contractor' : 'Add Contractor'}</h2>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                          {Object.keys(uploadErrors).length > 0 && (
                            <button
                              type="button"
                              className="btn btn-outline-warning"
                              onClick={clearAllUploadErrors}
                              title="Clear all upload errors"
                              style={{ fontSize: 12, padding: '6px 12px' }}
                            >
                              <i className="fas fa-exclamation-triangle" style={{ marginRight: 4 }}></i>
                              Clear Errors
                            </button>
                          )}
                          <button
                            className="contractor-form-close-btn"
                            onClick={toggleForm}
                            aria-label="Close form"
                          >
                            <X size={20} />
                          </button>
                        </div>
                      </div>

                      <div className="contractor-form-content">
            {submitting && (
                          <div className="form-loader">
                            <div className="cms-spinner"></div>
              </div>
            )}
                       
            <form className="contractor-form" onSubmit={saveContractor}>
                          <div className="form-sections">
              {/* Contractor's Details */}
                            <div className="form-section">
                <h3>Contractor's Details</h3>
                              <div className="form-grid">
                                <div className="form-group">
                                  <label className="required">Organization</label>
                    <select
                      name="Organization"
                      value={form.Organization || ''}
                      onChange={(e) => updateForm('Organization', e.target.value)}
                      onClick={handleOrganizationDropdownClick}
                      required
                      className="form-input"
                      disabled={loadingOrganizations}
                    >
                      {loadingOrganizations ? (
                        <option value="">
                          <i className="fas fa-spinner fa-spin"></i> Loading organizations...
                        </option>
                      ) : (
                        organizationOptions.map((opt) => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))
                      )}
                    </select>
                    {organizationError && (
                      <div style={{ color: '#dc3545', fontSize: '12px', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <i className="fas fa-exclamation-triangle" style={{ fontSize: '10px' }}></i>
                        <span>{organizationError}</span>
                        <button
                          type="button"
                          onClick={fetchOrganizations}
                          style={{
                            background: 'none',
                            border: '1px solid #dc3545',
                            color: '#dc3545',
                            padding: '2px 6px',
                            borderRadius: '3px',
                            cursor: 'pointer',
                            fontSize: '10px'
                          }}
                          title="Retry loading organizations"
                        >
                          Retry
                        </button>
                      </div>
                    )}
                  </div>
                                <div className="form-group">
                                  <label className="required">Contractor Name</label>
                    <input
                      type="text"
                      name="ContractorName"
                      value={form.ContractorName || ''}
                      onChange={(e) => updateForm('ContractorName', e.target.value)}
                      required
                      className="form-input"
                    />
                  </div>
                                <div className="form-group">
                    <label>Establishment Code</label>
                    <input
                      type="text"
                      name="EstablishmentCode"
                      value={form.EstablishmentCode || ''}
                      onChange={(e) => updateForm('EstablishmentCode', e.target.value)}
                      className="form-input"
                    />
                  </div>
                                <div className="form-group">
                    <label>License No</label>
                    <input
                      type="text"
                      name="LicenseNo"
                      value={form.LicenseNo || ''}
                      onChange={(e) => updateForm('LicenseNo', e.target.value)}
                      className="form-input"
                    />
                  </div>
                                <div className="form-group">
                                  <label>Establishment Name</label>
                    <input
                      type="text"
                      name="EstablishmentName"
                      value={form.EstablishmentName || ''}
                      onChange={(e) => updateForm('EstablishmentName', e.target.value)}
                      className="form-input"
                    />
                  </div>
                                <div className="form-group">
                                  <label>Establishment Short Name</label>
                    <input
                      type="text"
                      name="EstablishmentShortName"
                      value={form.EstablishmentShortName || ''}
                      onChange={(e) => updateForm('EstablishmentShortName', e.target.value)}
                      className="form-input"
                    />
                  </div>
                                <div className="form-group">
                    <label>Number Of Employees as per RC</label>
                    <input
                      type="text"
                      name="NumberOfEmployeesasperRC"
                      value={form.NumberOfEmployeesasperRC || ''}
                      onChange={(e) => updateForm('NumberOfEmployeesasperRC', e.target.value)}
                      className="form-input"
                    />
                  </div>
                                <div className="form-group">
                    <label>Nature of work</label>
                    <input
                      type="text"
                      name="Natureofwork"
                      value={form.Natureofwork || ''}
                      onChange={(e) => updateForm('Natureofwork', e.target.value)}
                      className="form-input"
                      placeholder="Enter nature of work"
                    />
                  </div>
                                <div className="form-group">
                    <label>Name of the Partner</label>
                    <input
                      type="text"
                      name="NameoftheDirector"
                      value={form.NameoftheDirector || ''}
                      onChange={(e) => updateForm('NameoftheDirector', e.target.value)}
                      className="form-input"
                    />
                  </div>
                                <div className="form-group">
                                  <label className="required">Primary Email</label>
                    <input
                      type="email"
                      name="PrimaryEmail"
                      value={form.PrimaryEmail || ''}
                      onChange={(e) => updateForm('PrimaryEmail', e.target.value)}
                      required
                      className="form-input"
                    />
                  </div>
                                <div className="form-group">
                                  <label className="required">Primary Mobile No.</label>
                    <input
                      type="text"
                      name="PrimaryMobileNo"
                      value={form.PrimaryMobileNo || ''}
                      onChange={(e) => updateForm('PrimaryMobileNo', e.target.value)}
                      required
                      maxLength={10}
                      pattern="[0-9]{10}"
                      inputMode="numeric"
                      placeholder="10 digit mobile number"
                      className="form-input"
                    />
                  </div>
                                <div className="form-group">
                    <label>Secondary Email</label>
                    <input
                      type="email"
                      name="SecondaryEmail"
                      value={form.SecondaryEmail || ''}
                      onChange={(e) => updateForm('SecondaryEmail', e.target.value)}
                      className="form-input"
                    />
                  </div>
                                <div className="form-group">
                    <label>Secondary Mobile No</label>
                    <input
                      type="text"
                      name="SecondaryMobileNumber"
                      value={form.SecondaryMobileNumber || ''}
                      onChange={(e) => updateForm('SecondaryMobileNumber', e.target.value)}
                      maxLength={10}
                      pattern="[0-9]{10}"
                      inputMode="numeric"
                      placeholder="10 digit mobile number"
                      className="form-input"
                    />
                  </div>
                                <div className="form-group">
                    <label>Landline number</label>
                    <input
                      type="text"
                      name="Landlinenumber"
                      value={form.Landlinenumber || ''}
                      onChange={(e) => updateForm('Landlinenumber', e.target.value)}
                      className="form-input"
                    />
                  </div>
                                <div className="form-group">
                    <label>Website</label>
                    <input
                      type="url"
                      name="Website"
                      value={form.Website || ''}
                      onChange={(e) => updateForm('Website', e.target.value)}
                      className="form-input"
                    />
                  </div>
                                <div className="form-group">
                    <label>Contract Start Date</label>
                    <input
                      type="date"
                      name="ContractStartDate"
                      value={form.ContractStartDate || ''}
                      onChange={(e) => updateForm('ContractStartDate', e.target.value)}
                      className="form-input"
                    />
                  </div>
                                <div className="form-group">
                    <label>Contract End Date</label>
                    <input
                      type="date"
                      name="ContractEndDate"
                      value={form.ContractEndDate || ''}
                      onChange={(e) => updateForm('ContractEndDate', e.target.value)}
                      className="form-input"
                    />
                  </div>
                                <div className="form-group">
                    <label>Contract valid From</label>
                    <input
                      type="date"
                      name="ContractvalidFrom"
                      value={form.ContractvalidFrom || ''}
                      onChange={(e) => updateForm('ContractvalidFrom', e.target.value)}
                      className="form-input"
                    />
                  </div>
                                <div className="form-group">
                    <label>Contract Valid To</label>
                    <input
                      type="date"
                      name="ContractValidTo"
                      value={form.ContractValidTo || ''}
                      onChange={(e) => updateForm('ContractValidTo', e.target.value)}
                      className="form-input"
                    />
                  </div>
                </div>
              </div>

              {/* Address Details */}
                            <div className="form-section">
                <h3>Address Details</h3>
                <h4>Registered Address</h4>
                              <div className="form-grid">
                                <div className="form-group">
                    <label>Address Line 1</label>
                    <input
                      type="text"
                      name="RegisterAddressLine1"
                      value={form.RegisterAddressLine1 || ''}
                      onChange={(e) => updateForm('RegisterAddressLine1', e.target.value)}
                      className="form-input"
                    />
                  </div>
                                <div className="form-group">
                    <label>Address Line 2</label>
                    <input
                      type="text"
                      name="RegisterAddressLine2"
                      value={form.RegisterAddressLine2 || ''}
                      onChange={(e) => updateForm('RegisterAddressLine2', e.target.value)}
                      className="form-input"
                    />
                  </div>
                                <div className="form-group">
                    <label>City / District</label>
                    <input
                      type="text"
                      name="RegisterCity"
                      value={form.RegisterCity || ''}
                      onChange={(e) => updateForm('RegisterCity', e.target.value)}
                      className="form-input"
                    />
                  </div>
                                <div className="form-group">
                    <label>State / Province</label>
                    <input
                      type="text"
                      name="RegisterState"
                      value={form.RegisterState || ''}
                      onChange={(e) => updateForm('RegisterState', e.target.value)}
                      className="form-input"
                    />
                  </div>
                                <div className="form-group">
                    <label>Postal Code</label>
                    <input
                      type="text"
                      name="RegisterPostalCode"
                      value={form.RegisterPostalCode || ''}
                      onChange={(e) => updateForm('RegisterPostalCode', e.target.value)}
                      className="form-input"
                    />
                  </div>
                                <div className="form-group">
                    <label>Country</label>
                    <select
                      name="RegisterCountry"
                      value={form.RegisterCountry || ''}
                      onChange={(e) => updateForm('RegisterCountry', e.target.value)}
                      className="form-input"
                    >
                      {countryOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
               
                {/* Copy Address Options */}
                <div style={{
                  display: 'flex',
                  gap: '12px',
                  marginBottom: '20px',
                  padding: '12px',
                  backgroundColor: '#f8f9fa',
                  borderRadius: '8px',
                  border: '1px solid #e9ecef'
                }}>
                  <button
                    type="button"
                    onClick={copyRegisteredToOffice}
                    style={{
                      padding: '8px 16px',
                      backgroundColor: '#007bff',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '14px',
                      fontWeight: '500',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px'
                    }}
                    title="Copy Registered Address to Office Address"
                  >
                    <i className="fas fa-copy" style={{ fontSize: '12px' }}></i>
                    Copy to Office Address
                  </button>
                  <button
                    type="button"
                    onClick={copyRegisteredToCommunication}
                    style={{
                      padding: '8px 16px',
                      backgroundColor: '#28a745',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '14px',
                      fontWeight: '500',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px'
                    }}
                    title="Copy Registered Address to Communication Address"
                  >
                    <i className="fas fa-copy" style={{ fontSize: '12px' }}></i>
                    Copy to Communication Address
                  </button>
                </div>
                             
                <h4>Office Address</h4>
                              <div className="form-grid">
                                <div className="form-group">
                    <label>Address Line 1</label>
                    <input
                      type="text"
                      name="OfficeAddressLine1"
                      value={form.OfficeAddressLine1 || ''}
                      onChange={(e) => updateForm('OfficeAddressLine1', e.target.value)}
                      className="form-input"
                    />
                  </div>
                                <div className="form-group">
                    <label>Address Line 2</label>
                    <input
                      type="text"
                      name="OfficeAddressLine2"
                      value={form.OfficeAddressLine2 || ''}
                      onChange={(e) => updateForm('OfficeAddressLine2', e.target.value)}
                      className="form-input"
                    />
                  </div>
                                <div className="form-group">
                    <label>City / District</label>
                    <input
                      type="text"
                      name="OfficeCity"
                      value={form.OfficeCity || ''}
                      onChange={(e) => updateForm('OfficeCity', e.target.value)}
                      className="form-input"
                    />
                  </div>
                                <div className="form-group">
                    <label>State / Province</label>
                    <input
                      type="text"
                      name="OfficeState"
                      value={form.OfficeState || ''}
                      onChange={(e) => updateForm('OfficeState', e.target.value)}
                      className="form-input"
                    />
                  </div>
                                <div className="form-group">
                    <label>Postal Code</label>
                    <input
                      type="text"
                      name="OfficePostalCode"
                      value={form.OfficePostalCode || ''}
                      onChange={(e) => updateForm('OfficePostalCode', e.target.value)}
                      className="form-input"
                    />
                  </div>
                                <div className="form-group">
                    <label>Country</label>
                    <select
                      name="OfficeCountry"
                      value={form.OfficeCountry || ''}
                      onChange={(e) => updateForm('OfficeCountry', e.target.value)}
                      className="form-input"
                    >
                      {countryOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
               
                {/* Copy Office to Communication Address Option */}
                <div style={{
                  display: 'flex',
                  gap: '12px',
                  marginBottom: '20px',
                  padding: '12px',
                  backgroundColor: '#f8f9fa',
                  borderRadius: '8px',
                  border: '1px solid #e9ecef'
                }}>
                  <button
                    type="button"
                    onClick={copyOfficeToCommunication}
                    style={{
                      padding: '8px 16px',
                      backgroundColor: '#6f42c1',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '14px',
                      fontWeight: '500',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px'
                    }}
                    title="Copy Office Address to Communication Address"
                  >
                    <i className="fas fa-copy" style={{ fontSize: '12px' }}></i>
                    Copy Office to Communication Address
                  </button>
                </div>
                             
                <h4>Communication Address</h4>
                              <div className="form-grid">
                                <div className="form-group">
                    <label>Address Line 1</label>
                    <input
                      type="text"
                      name="CommunicationAddressLine1"
                      value={form.CommunicationAddressLine1 || ''}
                      onChange={(e) => updateForm('CommunicationAddressLine1', e.target.value)}
                      className="form-input"
                    />
                  </div>
                                <div className="form-group">
                    <label>Address Line 2</label>
                    <input
                      type="text"
                      name="CommunicationAddressLine2"
                      value={form.CommunicationAddressLine2 || ''}
                      onChange={(e) => updateForm('CommunicationAddressLine2', e.target.value)}
                      className="form-input"
                    />
                  </div>
                                <div className="form-group">
                    <label>City / District</label>
                    <input
                      type="text"
                      name="CommunicationCity"
                      value={form.CommunicationCity || ''}
                      onChange={(e) => updateForm('CommunicationCity', e.target.value)}
                      className="form-input"
                    />
                  </div>
                                <div className="form-group">
                    <label>State / Province</label>
                    <input
                      type="text"
                      name="CommunicationState"
                      value={form.CommunicationState || ''}
                      onChange={(e) => updateForm('CommunicationState', e.target.value)}
                      className="form-input"
                    />
                  </div>
                                <div className="form-group">
                    <label>Postal Code</label>
                    <input
                      type="text"
                      name="CommunicationPostalCode"
                      value={form.CommunicationPostalCode || ''}
                      onChange={(e) => updateForm('CommunicationPostalCode', e.target.value)}
                      className="form-input"
                    />
                  </div>
                                <div className="form-group">
                    <label>Country</label>
                    <select
                      name="CommunicationCountry"
                      value={form.CommunicationCountry || ''}
                      onChange={(e) => updateForm('CommunicationCountry', e.target.value)}
                      className="form-input"
                    >
                      {countryOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Organization - Documents */}
                            <div className="form-section">
                <h3>Organization - Documents</h3>
                              <div className="form-grid">
                                <div className="form-group">
                    <label>PAN No.</label>
                    <input
                      type="text"
                      name="OrganizationPANNo"
                      value={form.OrganizationPANNo || ''}
                      onChange={(e) => updateForm('OrganizationPANNo', e.target.value.toUpperCase())}
                      maxLength={10}
                      pattern="[A-Z]{3}P[A-Z][0-9]{4}[A-Z]"
                      placeholder="e.g., ABCPA1234D"
                      className="form-input"
                    />
                  </div>
                                <div className="form-group">
                    <label>GST Number</label>
                    <input
                      type="text"
                      name="OrganizationGSTINNumber"
                      value={form.OrganizationGSTINNumber || ''}
                      onChange={(e) => updateForm('OrganizationGSTINNumber', e.target.value)}
                      maxLength={15}
                      pattern="[0-9]{2}[A-Z]{3}P[A-Z][0-9]{4}[A-Z][A-Z0-9]{3}"
                      placeholder="e.g., 22ABCPA1234D1Z5"
                      className="form-input"
                    />
                  </div>
                                <div className="form-group">
                    <label>PF Establishment Code</label>
                    <input
                      type="text"
                      name="OrganizationPFEstablishmentCode"
                      value={form.OrganizationPFEstablishmentCode || ''}
                      onChange={(e) => updateForm('OrganizationPFEstablishmentCode', e.target.value)}
                      className="form-input"
                    />
                  </div>
                                <div className="form-group">
                    <label>ESI Establishment Code</label>
                    <input
                      type="text"
                      name="OrganizationESIEstablishmentCode"
                      value={form.OrganizationESIEstablishmentCode || ''}
                      onChange={(e) => updateForm('OrganizationESIEstablishmentCode', e.target.value)}
                      className="form-input"
                    />
                  </div>
                </div>
              </div>

              {/* File Upload Section */}
              <div className="form-section document-uploads-section">
                <h3>Document Uploads</h3>
                <ContractorFilesSection
                  contractorId={isEditing ? editingId : null}
                  contractor={form}
                  pendingFiles={pendingFiles}
                  setPendingFiles={setPendingFiles}
                  uploadErrors={uploadErrors}
                  setUploadErrors={setUploadErrors}
                  uploading={uploading}
                  isNewContractor={!isEditing}
                />
              </div>

              {/* Contractor - Documents */}
                            <div className="form-section">
                <h3>Contractor - Documents</h3>
                              <div className="form-grid">
                                <div className="form-group">
                    <label>PAN No.</label>
                    <input
                      type="text"
                      name="ContractorPANNo"
                      value={form.ContractorPANNo || ''}
                      onChange={(e) => updateForm('ContractorPANNo', e.target.value.toUpperCase())}
                      maxLength={10}
                      pattern="[A-Z]{3}P[A-Z][0-9]{4}[A-Z]"
                      placeholder="e.g., ABCPA1234D"
                      className="form-input"
                    />
                  </div>
                                <div className="form-group">
                    <label>Aadhar No.</label>
                    <input
                      type="text"
                      name="ContractorAadharNo"
                      value={form.ContractorAadharNo || ''}
                      onChange={(e) => updateForm('ContractorAadharNo', e.target.value)}
                      maxLength={12}
                      pattern="\d{12}"
                      className="form-input"
                    />
                  </div>

                </div>
              </div>

              {/* Contact Details */}
                            <div className="form-section">
                <h3>Contact Details</h3>
                              <div className="form-grid">
                                <div className="form-group">
                    <label>Name of the Site Manager</label>
                    <input
                      type="text"
                      name="NameoftheSiteManager"
                      value={form.NameoftheSiteManager || ''}
                      onChange={(e) => updateForm('NameoftheSiteManager', e.target.value)}
                      className="form-input"
                    />
                  </div>
                                <div className="form-group">
                    <label>Site Manager Mobile</label>
                    <input
                      type="text"
                      name="SiteManagerMobile"
                      value={form.SiteManagerMobile || ''}
                      onChange={(e) => updateForm('SiteManagerMobile', e.target.value)}
                      className="form-input"
                    />
                  </div>
                                <div className="form-group">
                    <label>Site Manager Email</label>
                    <input
                      type="email"
                      name="SiteManagerEmail"
                      value={form.SiteManagerEmail || ''}
                      onChange={(e) => updateForm('SiteManagerEmail', e.target.value)}
                      className="form-input"
                    />
                  </div>
                                <div className="form-group">
                    <label>Name of Site Incharge</label>
                    <input
                      type="text"
                      name="NameofSiteIncharge"
                      value={form.NameofSiteIncharge || ''}
                      onChange={(e) => updateForm('NameofSiteIncharge', e.target.value)}
                      className="form-input"
                    />
                  </div>
                                <div className="form-group">
                    <label>Site Incharge Mobile</label>
                    <input
                      type="text"
                      name="SiteInchargeMobile"
                      value={form.SiteInchargeMobile || ''}
                      onChange={(e) => updateForm('SiteInchargeMobile', e.target.value)}
                      className="form-input"
                    />
                  </div>
                                <div className="form-group">
                    <label>Site Incharge Email</label>
                    <input
                      type="email"
                      name="SiteInchargeEmail"
                      value={form.SiteInchargeEmail || ''}
                      onChange={(e) => updateForm('SiteInchargeEmail', e.target.value)}
                      className="form-input"
                    />
                  </div>
                                <div className="form-group">
                    <label>Contractor Contact Name</label>
                    <input
                      type="text"
                      name="ContractorContactName"
                      value={form.ContractorContactName || ''}
                      onChange={(e) => updateForm('ContractorContactName', e.target.value)}
                      className="form-input"
                    />
                  </div>
                                <div className="form-group">
                    <label>Contract Contact Mobile</label>
                    <input
                      type="text"
                      name="ContractContactMobile"
                      value={form.ContractContactMobile || ''}
                      onChange={(e) => updateForm('ContractContactMobile', e.target.value)}
                      className="form-input"
                    />
                  </div>
                                <div className="form-group">
                    <label>Contractor Contact Email</label>
                    <input
                      type="email"
                      name="ContractorContactEmail"
                      value={form.ContractorContactEmail || ''}
                      onChange={(e) => updateForm('ContractorContactEmail', e.target.value)}
                      className="form-input"
                    />
                  </div>
                </div>
              </div>

              {/* Status Tracking */}
                            <div className="form-section">
                <h3>Status Tracking</h3>
                              <div className="form-grid">
                                <div className="form-group">
                    <label>Contractor Status</label>
                    <select
                      name="ContractorStatus"
                      value={form.ContractorStatus || ''}
                      onChange={(e) => updateForm('ContractorStatus', e.target.value)}
                      className="form-input"
                    >
                      {statusOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                                <div className="form-group">
                    <label>Approval Status</label>
                                  <div className="radio-group">
                                    <label className="radio-label">
                                      <input
                                        type="radio"
                                        name="ApprovalStatus"
                                        value="Approved"
                                        checked={form.ApprovalStatus === 'Approved'}
                                        onChange={(e) => updateForm('ApprovalStatus', e.target.value)}
                                      />
                                      <span className="radio-text">Approved</span>
                      </label>
                                    <label className="radio-label">
                                      <input
                                        type="radio"
                                        name="ApprovalStatus"
                                        value="Rejected"
                                        checked={form.ApprovalStatus === 'Rejected'}
                                        onChange={(e) => updateForm('ApprovalStatus', e.target.value)}
                                      />
                                      <span className="radio-text">Rejected</span>
                      </label>
                    </div>
                  </div>
                </div>
              </div>
                          </div>

                          <div className="form-actions">
                            <div className="form-actions-container">
                              <button type="submit" className="cms-btn cms-btn-primary" disabled={submitting}>
                                {submitting ? (
                                  <div className="btn-loader">
                                    <div className="cms-spinner"></div>
                                    {isEditing ? 'Updating...' : 'Submitting...'}
                                  </div>
                                ) : (
                                  isEditing ? 'Update Contractor' : 'Submit'
                                )}
                              </button>
                              <button type="button" className="cms-btn cms-btn-danger" onClick={toggleForm}>
                                Cancel
                              </button>
                             

                            </div>
                          </div>
            </form>
          </div>
                    </div>
                  </div>
                ) : (
                  <>

                    {/* Contractors Table */}
                    <div className="contractor-table-container">
                      <table className={`contractor-table ${selectedContractors.length === 0 ? 'edit-column-hidden' : ''}`}>
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
                            {selectedContractors.length > 0 ? (
                              <>
                                <th>#</th>
                                <th>Edit</th>
                                <th>Approve/Reject</th>
                                <th>Status</th>
                                <th>Organization</th>
                                <th>Establishment Code</th>
                                <th>License No</th>
                                <th>Contractor Name</th>
                                <th>Establishment Name</th>
                                <th>Primary Email</th>
                                <th>Contract Start Date</th>
                                <th>Establishment Short Name</th>
                                <th>Contract End Date</th>
                                <th>Primary Mobile No</th>
                                <th>Number Of Employees as per RC</th>
                                <th>Contract valid From</th>
                                <th>Secondary Email</th>
                                <th>Nature of work</th>
                                <th>Contract Valid To</th>
                                <th>Secondary Mobile No</th>
                                <th>Name of the Partner</th>
                                <th>Website</th>
                                <th>Landline number</th>
                                <th>Registered Address Line 1</th>
                                <th>Registered Address Line 2</th>
                                <th>Register City</th>
                                <th>Register State</th>
                                <th>Register Postal Code</th>
                                <th>Register Country</th>
                                <th>Office Address Line 1</th>
                                <th>Office Address Line 2</th>
                                <th>Office City</th>
                                <th>Office State</th>
                                <th>Office Postal Code</th>
                                <th>Office Country</th>
                                <th>Organization PAN No</th>
                                <th>Organization GST Number</th>
                                <th>Organization PF Establishment Code</th>
                                <th>Organization ESI Establishment Code</th>
                                <th>Contractor PAN No</th>
                                <th>Contractor Aadhar No</th>
                                <th>Name of the Site Manager</th>
                                <th>Name of Site Incharge</th>
                                <th>Site Manager Mobile</th>
                                <th>Site Incharge Mobile</th>
                                <th>Contractor Contact Name</th>
                                <th>Contract Contact Mobile</th>
                                <th>Site Manager Email</th>
                                <th>Site Incharge Email</th>
                                <th>Contractor Contact Email</th>
                                <th>Contractor Status</th>
                                <th>Communication Address Line 1</th>
                                <th>Communication Address Line 2</th>
                                <th>Communication City</th>
                                <th>Communication State</th>
                                <th>Communication Postal Code</th>
                                <th>Communication Country</th>
                                <th>PAN</th>
                                <th>GST Reg. Certificate</th>
                                <th>PF Reg. Certificate</th>
                                <th>ESI Reg. Certificate</th>
                                <th>Contractor PAN File</th>
                                <th>Contractor Aadhar</th>
                              </>
                            ) : (
                              <>
                                <th>#</th>
                                <th>Approve/Reject</th>
                                <th>Status</th>
                                <th>Organization</th>
                                <th>Establishment Code</th>
                                <th>License No</th>
                                <th>Contractor Name</th>
                                <th>Establishment Name</th>
                                <th>Primary Email</th>
                                <th>Contract Start Date</th>
                                <th>Establishment Short Name</th>
                                <th>Contract End Date</th>
                                <th>Primary Mobile No</th>
                                <th>Number Of Employees as per RC</th>
                                <th>Contract valid From</th>
                                <th>Secondary Email</th>
                                <th>Nature of work</th>
                                <th>Contract Valid To</th>
                                <th>Secondary Mobile No</th>
                                <th>Name of the Partner</th>
                                <th>Website</th>
                                <th>Landline number</th>
                                <th>Registered Address Line 1</th>
                                <th>Registered Address Line 2</th>
                                <th>Register City</th>
                                <th>Register State</th>
                                <th>Register Postal Code</th>
                                <th>Register Country</th>
                                <th>Office Address Line 1</th>
                                <th>Office Address Line 2</th>
                                <th>Office City</th>
                                <th>Office State</th>
                                <th>Office Postal Code</th>
                                <th>Office Country</th>
                                <th>Organization PAN No</th>
                                <th>Organization GST Number</th>
                                <th>Organization PF Establishment Code</th>
                                <th>Organization ESI Establishment Code</th>
                                <th>Contractor PAN No</th>
                                <th>Contractor Aadhar No</th>
                                <th>Name of the Site Manager</th>
                                <th>Name of Site Incharge</th>
                                <th>Site Manager Mobile</th>
                                <th>Site Incharge Mobile</th>
                                <th>Contractor Contact Name</th>
                                <th>Contract Contact Mobile</th>
                                <th>Site Manager Email</th>
                                <th>Site Incharge Email</th>
                                <th>Contractor Contact Email</th>
                                <th>Contractor Status</th>
                                <th>Communication Address Line 1</th>
                                <th>Communication Address Line 2</th>
                                <th>Communication City</th>
                                <th>Communication State</th>
                                <th>Communication Postal Code</th>
                                <th>Communication Country</th>
                                <th>PAN</th>
                                <th>GST Reg. Certificate</th>
                                <th>PF Reg. Certificate</th>
                                <th>ESI Reg. Certificate</th>
                                <th>Contractor PAN File</th>
                                <th>Contractor Aadhar</th>
                              </>
                            )}
                          </tr>
                        </thead>
                        <tbody>
                          {filteredContractors.length ? (
                            filteredContractors.map((contractor, idx) => (
                              <ContractorRow
                                key={contractor.id}
                                contractor={contractor}
                                index={idx}
                                editContractor={editContractor}
                                removeContractor={removeContractor}
                                isSelected={selectedContractors.includes(contractor.id)}
                                onCheckboxChange={(id, checked) => {
                                  if (checked) {
                                    setSelectedContractors(prev => [...prev, id]);
                                  } else {
                                    setSelectedContractors(prev => prev.filter(selectedId => selectedId !== id));
                                  }
                                }}
                                selectedContractors={selectedContractors}
                              />
                            ))
                          ) : (
                            <tr>
                              <td colSpan={selectedContractors.length > 0 ? 54 : 53} className="text-center">
                                No contractors found. Adjust your search or add a new contractor.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>

                    {/* Contractors count toggle at the bottom */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', marginTop: '32px', marginLeft: '24px' }}>
                      <button
                        onClick={() => setShowContractorCount(prev => !prev)}
                        style={{ fontWeight: 'bold', fontSize: '1.1rem', margin: '8px 0' }}
                      >
                        Contractors
                      </button>
                      {showContractorCount && (
                        <div style={{ fontWeight: 'bold', margin: '8px 0', fontSize: '1.1rem' }}>
                          Total Contractors: {filteredContractors.length}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Hidden file input for import */}
      <input
        type="file"
        ref={fileInputRef}
        accept=".xlsx"
        onChange={handleImport}
        style={{ display: 'none' }}
      />


      {/* Search Modal */}
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
          }} onClick={(e) => e.stopPropagation()} ref={dropdownRef}>
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
              {filterFieldMap.map(({ label, key }) => (
                <div key={key} style={{
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
                      checked={searchFields[key]?.enabled || false}
                      onChange={e =>
                        setSearchFields(prev => ({
                          ...prev,
                          [key]: { ...prev[key], enabled: e.target.checked }
                        }))
                      }
                      style={{ width: '16px', height: '16px' }}
                    />
                    {label}
                  </label>
                  {searchFields[key]?.enabled && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginLeft: '24px' }}>
                      {key === 'ContractorName' ? (
                        createDropdownUI(
                          'ContractorName', 'Contractor Name', contractorNames,
                          contractorNameSearch, setContractorNameSearch,
                          isContractorNameDropdownOpen, setIsContractorNameDropdownOpen,
                          handleContractorNameSelect, loadingContractorNames, filteredContractorNames
                        )
                      ) : key === 'Organization' ? (
                        createDropdownUI(
                          'Organization', 'Organization', organizationNames,
                          organizationNameSearch, setOrganizationNameSearch,
                          isOrganizationNameDropdownOpen, setIsOrganizationNameDropdownOpen,
                          handleOrganizationNameSelect, loadingOrganizationNames, filteredOrganizationNames
                        )
                      ) : (
                        <>
                          {/* Fields that need mode selector */}
                          {!['NumberOfEmployeesasperRC', 'LicenseNo', 'ContractorStatus', 'PrimaryEmail', 'PrimaryMobileNo', 'ESIRegistrationCertificateFileId', 'NameoftheSiteManager', 'EstablishmentName', 'OrganizationPFEstablishmentCode', 'OrganizationESIEstablishmentCode', 'OrganizationGSTINNumber', 'ContractStartDate', 'ContractEndDate', 'Landlinenumber', 'SiteManagerEmail', 'SiteManagerMobile', 'ContractorContactName', 'SiteInchargeEmail', 'ContractContactMobile', 'EstablishmentCode', 'SecondaryMobileNumber', 'SecondaryEmail', 'PFRegistrationCertificateFileId', 'GSTRegistrationCertificateFileId', 'ContractvalidFrom', 'ContractValidTo', 'CommunicationAddressLine1', 'NameofSiteIncharge', 'ContractorContactEmail', 'Website', 'OfficeAddressLine1', 'SiteInchargeMobile', 'Natureofwork', 'NameoftheDirector', 'RegisterAddressLine1', 'RegisterAddressLine2', 'RegisterCity', 'RegisterState', 'RegisterPostalCode', 'RegisterCountry', 'OfficeAddressLine1', 'OfficeAddressLine2', 'OfficeCity', 'OfficeState', 'OfficePostalCode', 'OfficeCountry', 'CommunicationAddressLine1', 'CommunicationAddressLine2', 'CommunicationCity', 'CommunicationState', 'CommunicationPostalCode', 'CommunicationCountry', 'OrganizationPANNo', 'OrganizationGSTINNumber', 'OrganizationPFEstablishmentCode', 'OrganizationESIEstablishmentCode', 'ContractorPANNo', 'ContractorAadharNo', 'id', 'EstablishmentShortName', 'ApprovalStatus'].includes(key) && (
                            <select
                              value={searchFields[key].mode}
                              onChange={e =>
                                setSearchFields(prev => ({
                                  ...prev,
                                  [key]: { ...prev[key], mode: e.target.value }
                                }))
                              }
                              style={{
                                padding: '6px 8px',
                                border: '1px solid #d1d5db',
                                borderRadius: '4px',
                                fontSize: '14px',
                                backgroundColor: 'white'
                              }}
                            >
                              <option value="is">is</option>
                              <option value="contains">contains</option>
                              <option value="startsWith">starts with</option>
                              <option value="endsWith">ends with</option>
                            </select>
                          )}
                          <input
                            type="text"
                            value={searchFields[key]?.value || ''}
                            onChange={e =>
                              setSearchFields(prev => ({
                                ...prev,
                                [key]: { ...prev[key], value: e.target.value }
                              }))
                            }
                            placeholder={`Enter value for ${label}`}
                            style={{
                              padding: '6px 8px',
                              border: '1px solid #d1d5db',
                              borderRadius: '4px',
                              fontSize: '14px',
                              backgroundColor: 'white'
                            }}
                          />
                        </>
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
    </>
  );
}

// ContractorFilesSection component for handling file uploads
function ContractorFilesSection({ contractorId, contractor, pendingFiles, setPendingFiles, uploadErrors, setUploadErrors, uploading, isNewContractor }) {
  const [downloadingFiles, setDownloadingFiles] = useState({});
  const [downloadErrors, setDownloadErrors] = useState({});

  // Document types and their display names and accepted types
  const docTypes = [
    { key: 'OrganizationPAN', fieldKey: 'OrganizationPAN', label: 'Organization PAN File', accept: '.pdf,.jpg,.jpeg,.png', hint: 'PDF/JPG/PNG, max 5MB' },
    { key: 'GSTRegistrationCertificate', fieldKey: 'GSTRegistartionCertificate', label: 'GST Registration Certificate', accept: '.pdf,.jpg,.jpeg,.png', hint: 'PDF/JPG/PNG, max 5MB' },
    { key: 'PFRegistrationCertificate', fieldKey: 'PFRegistrationCertificate', label: 'PF Registration Certificate', accept: '.pdf,.jpg,.jpeg,.png', hint: 'PDF/JPG/PNG, max 5MB' },
    { key: 'ESIRegistrationCertificate', fieldKey: 'ESIRegistrationcertificate', label: 'ESI Registration Certificate', accept: '.pdf,.jpg,.jpeg,.png', hint: 'PDF/JPG/PNG, max 5MB' },
    { key: 'ContractorPAN', fieldKey: 'ContractorPAN', label: 'Contractor PAN File', accept: '.pdf,.jpg,.jpeg,.png', hint: 'PDF/JPG/PNG, max 5MB' },
    { key: 'ContractorAadhar', fieldKey: 'ContractorAadhar', label: 'Contractor Aadhar File', accept: '.pdf,.jpg,.jpeg,.png', hint: 'PDF/JPG/PNG, max 5MB' },
  ];

  // Remove a pending file
  const removePendingFile = (key) => {
    setPendingFiles({ ...pendingFiles, [key]: undefined });
    setUploadErrors({ ...uploadErrors, [key]: undefined });
  };

  // Select a new file
  const handleFileSelect = (key, file) => {
    console.log('File selected:', { key, file, fileName: file.name, fileSize: file.size, fileType: file.type });
   
    // Validate file size (5MB = 5 * 1024 * 1024 bytes)
    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      setUploadErrors(prev => ({
        ...prev,
        [key]: `File size exceeds 5MB limit. Current size: ${(file.size / (1024 * 1024)).toFixed(2)}MB`
      }));
      return;
    }
   
    // Validate file type
    const allowedTypes = ['.pdf', '.jpg', '.jpeg', '.png'];
    const fileExtension = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));
    if (!allowedTypes.includes(fileExtension)) {
      setUploadErrors(prev => ({
        ...prev,
        [key]: `Invalid file type. Only PDF, JPG, JPEG, and PNG files are allowed.`
      }));
      return;
    }
   
    console.log('Current pending files before update:', pendingFiles);
    const newPendingFiles = { ...pendingFiles, [key]: file };
    console.log('New pending files after update:', newPendingFiles);
    setPendingFiles(newPendingFiles);
    setUploadErrors(prev => ({ ...prev, [key]: undefined }));
  };

  // Handle file download with loading state and error handling
  const handleFileDownload = async (key, fileId) => {
    try {
      setDownloadingFiles(prev => ({ ...prev, [key]: true }));
      setDownloadErrors(prev => ({ ...prev, [key]: undefined }));
     
      const downloadUrl = `/server/contracters_function/file/${key}/${fileId}`;
     
      // Create a temporary link element for download
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = ''; // This will use the filename from the server response
      link.style.display = 'none';
     
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
     
      // Add a small delay to show the loading state
      await new Promise(resolve => setTimeout(resolve, 500));
     
    } catch (error) {
      console.error('Download error:', error);
      setDownloadErrors(prev => ({ ...prev, [key]: 'Download failed. Please try again.' }));
    } finally {
      setDownloadingFiles(prev => ({ ...prev, [key]: false }));
    }
  };

  // Clear download error
  const clearDownloadError = (key) => {
    setDownloadErrors(prev => ({ ...prev, [key]: undefined }));
  };

  return (
    <div className="employee-files-table-container">
      <table className="employee-files-table">
        <thead>
          <tr>
            <th>Document</th>
            <th>File</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {docTypes.map(({ key, fieldKey, label, accept, hint }) => {
            const fileId = contractor[fieldKey];
            // Since we don't store file names in the database, we'll use a generic name
            const fileName = fileId ? `${label} (File ID: ${fileId})` : null;
            const pendingFile = pendingFiles?.[key];
            const error = uploadErrors?.[key];
            const isDownloading = downloadingFiles[key];
            const downloadError = downloadErrors[key];

            return (
              <tr key={key}>
                <td>
                  <div>
                    <strong>{label}</strong>
                    <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>{hint}</div>
                  </div>
                </td>
                <td>
                  {pendingFile ? (
                    <div className="dF aI-center">
                      <span style={{ marginRight: 8, flex: 1 }}>{pendingFile.name}</span>
                      <button
                        type="button"
                        className="btn btn-icon btn-danger-icon"
                        title="Remove selected file"
                        onClick={() => removePendingFile(key)}
                        disabled={uploading}
                      >
                        <i className="fas fa-times"></i>
                      </button>
                    </div>
                  ) : fileId && contractorId ? (
                    <div className="dF aI-center">
                      <button
                        type="button"
                        className="btn btn-link"
                        title={`Click to download: ${fileName}`}
                        onClick={() => handleFileDownload(key, fileId)}
                        disabled={uploading || isDownloading}
                        style={{
                          flex: 1,
                          textAlign: 'left',
                          padding: 0,
                          margin: 0,
                          border: 'none',
                          background: 'none',
                          color: '#3182ce',
                          textDecoration: 'underline',
                          cursor: isDownloading ? 'wait' : 'pointer',
                          fontSize: 'inherit',
                          opacity: isDownloading ? 0.7 : 1
                        }}
                      >
                        {isDownloading ? (
                          <>
                            <i className="fas fa-spinner fa-spin" style={{ marginRight: 8, color: '#666' }}></i>
                            Downloading...
                          </>
                        ) : (
                          <>
                            <i className="fas fa-file" style={{ marginRight: 8, color: '#666' }}></i>
                            {fileName}
                          </>
                        )}
                      </button>
                    </div>
                  ) : (
                    <span style={{ color: '#aaa' }}>No file uploaded</span>
                  )}
                  {error && (
                    <div style={{ color: 'red', fontSize: 12, marginTop: 4, display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <i className="fas fa-exclamation-triangle" style={{ fontSize: 10 }}></i>
                      <span>{error}</span>
                      <button
                        type="button"
                        onClick={() => setUploadErrors(prev => ({ ...prev, [key]: undefined }))}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'red',
                          cursor: 'pointer',
                          fontSize: 10,
                          padding: '2px 4px',
                          borderRadius: '2px'
                        }}
                        title="Clear error"
                      >
                        ✕
                      </button>
                    </div>
                  )}
                  {downloadError && (
                    <div style={{ color: 'red', fontSize: 12, marginTop: 4 }}>
                      {downloadError}
                      <button
                        type="button"
                        onClick={() => clearDownloadError(key)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'red',
                          cursor: 'pointer',
                          marginLeft: 8,
                          fontSize: 10
                        }}
                        title="Clear error"
                      >
                        ✕
                      </button>
                    </div>
                  )}
                  {uploading && pendingFile && (
                    <div style={{ color: '#666', fontSize: 12, marginTop: 4, display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <i className="fas fa-spinner fa-spin" style={{ fontSize: 10 }}></i>
                      <span>Uploading...</span>
                    </div>
                  )}
                  {!uploading && !error && pendingFile && (
                    <div style={{ color: '#28a745', fontSize: 12, marginTop: 4, display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <i className="fas fa-check-circle" style={{ fontSize: 10 }}></i>
                      <span>File ready for submission</span>
                    </div>
                  )}
                </td>
                <td>
                  {pendingFile ? (
                    <button
                      type="button"
                      className="btn btn-danger"
                      title="Remove selected file"
                      onClick={() => removePendingFile(key)}
                      disabled={uploading}
                      style={{ fontSize: 12, padding: '6px 12px' }}
                    >
                      Remove
                    </button>
                  ) : fileId && fileName && contractorId ? (
                    <div className="dF" style={{ gap: '8px' }}>
                      <button
                        type="button"
                        className="btn btn-icon"
                        title="Download"
                        onClick={() => handleFileDownload(key, fileId)}
                        disabled={uploading || isDownloading}
                      >
                        {isDownloading ? (
                          <i className="fas fa-spinner fa-spin"></i>
                        ) : (
                          <i className="fas fa-download"></i>
                        )}
                      </button>
                      <label className="btn btn-icon" title="Replace file">
                        <i className="fas fa-exchange-alt"></i>
                        <input
                          type="file"
                          accept={accept}
                          style={{ display: 'none' }}
                          disabled={uploading}
                          onChange={e => {
                            if (e.target.files && e.target.files[0]) {
                              handleFileSelect(key, e.target.files[0]);
                              e.target.value = '';
                            }
                          }}
                        />
                      </label>
                    </div>
                  ) : (
                    <label className="btn btn-primary" title="Upload file" style={{ fontSize: 12, padding: '6px 12px' }}>
                      <i className="fas fa-cloud-upload-alt" style={{ marginRight: 4 }}></i>
                      {uploading ? 'Uploading...' : 'Upload'}
                      <input
                        type="file"
                        accept={accept}
                        style={{ display: 'none' }}
                        disabled={uploading}
                        onChange={e => {
                          if (e.target.files && e.target.files[0]) {
                            handleFileSelect(key, e.target.files[0]);
                            e.target.value = '';
                          }
                        }}
                      />
                    </label>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default Contracters;