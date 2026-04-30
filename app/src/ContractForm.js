import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import './ContractForm.css';
import { 
  Users, Calendar, FileText, AlertTriangle, FolderOpen, 
  ClipboardList, Building, Handshake, Landmark, Clock, 
  Map, BarChart3, User, TrendingUp, TrendingDown, CalendarDays,
  Activity, Plus, CheckCircle, Bell, Settings, LayoutDashboard, Home as HomeIcon, AlertOctagon, CreditCard, Shield, Trophy, Medal, Award, Star, FileSignature, Save, Edit, Trash2, Eye, Search, Filter, Download, Upload, Clock3
} from 'lucide-react';
import HeaderBranding from './HeaderBranding';
import { getSidebarModulesForUser, resolveSidebarUserEmail } from './modulesConfig';

// Contract Row Component
function ContractRow({ contract, index, removeContract, editContract, isSelected, onSelect, selectedContracts }) {
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const deleteContract = useCallback((e) => {
    e.stopPropagation(); // Prevent row click when clicking delete
    setDeleting(true);
    setDeleteError('');
    axios
      .delete(`/server/contract_function/contracts/${contract.id}`, { timeout: 5000 })
      .then(() => {
        removeContract(contract.id);
      })
      .catch((err) => {
        const errorMessage = err.response?.data?.message || `Failed to delete contract (ID: ${contract.id}).`;
        setDeleteError(errorMessage);
        console.error('Delete contract error:', err);
      })
      .finally(() => setDeleting(false));
  }, [contract.id, removeContract]);

  const handleRowClick = useCallback(() => {
    editContract(contract);
  }, [editContract, contract]);

  const handleCheckboxClick = useCallback((e) => {
    e.stopPropagation(); // Prevent row click when clicking checkbox
    onSelect(contract.id);
  }, [onSelect, contract.id]);

  const handleEditButtonClick = useCallback((e) => {
    e.stopPropagation(); // Prevent row click when clicking edit button
    editContract(contract);
  }, [editContract, contract]);

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
      <td style={{ textAlign: 'center' }} onClick={handleCheckboxClick}>
        <input
          type="checkbox"
          checked={isSelected}
          onChange={handleCheckboxClick}
        />
      </td>
      {selectedContracts.length > 0 && (
        <td style={{ textAlign: 'center' }} onClick={handleEditButtonClick}>
          {isSelected && (
            <button
              className="btn btn-icon"
              onClick={handleEditButtonClick}
              title="Edit"
              disabled={deleting}
            >
              <i className="fas fa-edit"></i>
            </button>
          )}
        </td>
      )}
      <td style={{ textAlign: 'center' }}>{index + 1}</td>
      <td 
        style={{ textAlign: 'center', cursor: 'pointer' }}
        onClick={handleRowClick}
      >
        {contract.organizationName || '-'}
      </td>
      <td style={{ textAlign: 'center' }}>{contract.contractor || '-'}</td>
      <td style={{ textAlign: 'center' }}>{contract.natureOfContract || '-'}</td>
      <td style={{ textAlign: 'center' }}>
        {(() => {
          const status = contract.status || '-';
          let className = '';
          let style = {
            display: 'inline-block',
            padding: '4px 18px',
            borderRadius: '8px',
            fontWeight: 600,
            border: '2px solid',
            fontSize: '1rem',
            background: 'transparent',
            margin: '2px 0',
            minWidth: '90px',
            textAlign: 'center',
          };
          if (status === 'Active') {
            style = { ...style, color: '#388e3c', borderColor: '#a5d6a7', background: '#e8f5e9' };
          } else if (status === 'Completed') {
            style = { ...style, color: '#1976d2', borderColor: '#bbdefb', background: '#e3f2fd' };
          } else if (status === 'Suspended') {
            style = { ...style, color: '#f57c00', borderColor: '#ffe0b2', background: '#fff3e0' };
          } else if (status === 'Others') {
            style = { ...style, color: '#6d4c41', borderColor: '#d7ccc8', background: '#efebe9' };
          } else {
            style = { ...style, color: '#757575', borderColor: '#e0e0e0', background: '#fafafa' };
          }
          return <span style={style}>{status}</span>;
        })()}
      </td>
      <td style={{ textAlign: 'center' }}>{contract.registerDate || '-'}</td>
    </tr>
  );
}

function ContractForm({ userRole = 'App Administrator', setUserRole }) {
  const [expandedMenus, setExpandedMenus] = useState({});
  const [showSidebarMenu, setShowSidebarMenu] = useState(() => {
    // Load sidebar state from localStorage, default to true
    const saved = localStorage.getItem('contractForm_sidebar_visible');
    return saved !== null ? JSON.parse(saved) : true;
  });
  const [showNotifications, setShowNotifications] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [contracts, setContracts] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [showForm, setShowForm] = useState(false);
  const [editingContract, setEditingContract] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [fetchError, setFetchError] = useState('');
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);
  const [page, setPage] = useState(1);
  const [showAll, setShowAll] = useState(false);
  const [selectedContracts, setSelectedContracts] = useState([]);
  const [deletingMultiple, setDeletingMultiple] = useState(false);
  const [contractors, setContractors] = useState([]);

  // Form state
  const [formData, setFormData] = useState({
    organizationName: '',
    contractor: '',
    numberOfEmployees: '',
    natureOfContract: '',
    natureOfWork: '',
    registerDate: '',
    dateOfCompletion: '',
    siteManager: '',
    siteSupervisor: '',
    siteHR: '',
    siteSafety: '',
    description: '',
    contractPeriodFrom: '',
    contractPeriodTo: '',
    dateOfCommencement: '',
    expectedDateOfCompletion: '',
    status: 'Active'
  });

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

  // Fetch contractors from API
  const fetchContractors = useCallback(async () => {
    try {
      const response = await axios.get('/server/contracters_function/contractors', { 
        params: { page: 1, perPage: 100 }, 
        timeout: 10000 
      });
      
      if (response.data.status === 'success' && response.data.data.contractors) {
        const contractorsData = response.data.data.contractors.map(contractor => ({
          id: contractor.id,
          name: contractor.ContractorName || '',
          organization: contractor.Organization || ''
        }));
        setContractors(contractorsData);
      }
    } catch (err) {
      console.error('Error fetching contractors:', err);
      // Don't show error to user as this is not critical for the main functionality
    }
  }, []);

  // Fetch contracts from API
  const fetchContracts = useCallback(async () => {
    try {
      setIsLoading(true);
      setFetchError('');
      const response = await axios.get('/server/contract_function/contracts', { timeout: 10000 });
      
      if (response.data.status === 'success') {
        const contractsData = response.data.data.contracts.map(contract => ({
          id: contract.id,
          organizationName: contract.Organizationname || '',
          contractor: contract.contractor || '',
          numberOfEmployees: contract.Numberofemployees || '',
          natureOfContract: contract.Natureofcontract || '',
          natureOfWork: contract.natureOfWork || '',
          registerDate: contract.RegisterDate || '',
          dateOfCompletion: contract.completedDate || '',
          siteManager: contract.siteManager || '',
          siteSupervisor: contract.siteSupervisor || '',
          siteHR: contract.siteHR || '',
          siteSafety: contract.siteSafety || '',
          description: contract.description || '',
          contractPeriodFrom: contract.contractPeriodFrom || '',
          contractPeriodTo: contract.contractPeriodTo || '',
          dateOfCommencement: contract.dateOfCommencement || '',
          expectedDateOfCompletion: contract.expectedDateOfCompletion || '',
          status: contract.status || 'Active'
        }));
        setContracts(contractsData);
      } else {
        throw new Error(response.data.message || 'Failed to fetch contracts');
      }
    } catch (err) {
      console.error('Error fetching contracts:', err);
      setFetchError(err.response?.data?.message || 'Failed to fetch contracts');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchContracts();
    fetchContractors();
  }, [fetchContracts, fetchContractors]);

  // Save sidebar state to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem('contractForm_sidebar_visible', JSON.stringify(showSidebarMenu));
  }, [showSidebarMenu]);

  // File input ref for import functionality
  const fileInputRef = React.useRef(null);

  // Toggle search dropdown
  const toggleSearchDropdown = () => {
    setShowSearchDropdown(!showSearchDropdown);
  };

  // Handle import functionality
  const handleImport = (event) => {
    const file = event.target.files[0];
    if (file) {
      setImporting(true);
      // TODO: Implement import logic
      console.log('Import file:', file.name);
      setTimeout(() => {
        setImporting(false);
        alert('Import functionality will be implemented soon!');
      }, 1000);
    }
  };

  // Handle export functionality
  const handleExport = () => {
    setExporting(true);
    // TODO: Implement export logic
    console.log('Exporting contracts...');
    setTimeout(() => {
      setExporting(false);
      alert('Export functionality will be implemented soon!');
    }, 1000);
  };

  // Handle contract selection
  const handleSelectContract = (contractId) => {
    setSelectedContracts(prev => 
      prev.includes(contractId) 
        ? prev.filter(id => id !== contractId)
        : [...prev, contractId]
    );
  };

  // Handle mass delete
  const handleMassDelete = async () => {
    if (selectedContracts.length === 0) return;
    
    const confirmed = window.confirm(`Are you sure you want to delete ${selectedContracts.length} contract(s)?`);
    if (!confirmed) return;

    setDeletingMultiple(true);
    try {
      // Delete contracts one by one
      for (const contractId of selectedContracts) {
        await axios.delete(`/server/contract_function/contracts/${contractId}`, { timeout: 5000 });
      }
      
      // Refresh the list and clear selection
      await fetchContracts();
      setSelectedContracts([]);
    } catch (err) {
      console.error('Error deleting contracts:', err);
      alert('Failed to delete some contracts. Please try again.');
    } finally {
      setDeletingMultiple(false);
    }
  };

  // Remove contract from list
  const removeContract = useCallback((contractId) => {
    setContracts(prev => prev.filter(contract => contract.id !== contractId));
  }, []);

  // Edit contract
  const editContract = useCallback((contract) => {
    setEditingContract(contract);
    setFormData({
      organizationName: contract.organizationName || '',
      contractor: contract.contractor || '',
      numberOfEmployees: contract.numberOfEmployees || '',
      natureOfContract: contract.natureOfContract || '',
      natureOfWork: contract.natureOfWork || '',
      registerDate: contract.registerDate || '',
      dateOfCompletion: contract.dateOfCompletion || '',
      siteManager: contract.siteManager || '',
      siteSupervisor: contract.siteSupervisor || '',
      siteHR: contract.siteHR || '',
      siteSafety: contract.siteSafety || '',
      description: contract.description || '',
      contractPeriodFrom: contract.contractPeriodFrom || '',
      contractPeriodTo: contract.contractPeriodTo || '',
      dateOfCommencement: contract.dateOfCommencement || '',
      expectedDateOfCompletion: contract.expectedDateOfCompletion || '',
      status: contract.status || 'Active'
    });
    setShowForm(true);
  }, []);

  // Define table columns
  const columns = [
    { label: 'Select', field: null },
    { label: 'Edit', field: null },
    { label: '#', field: null },
    { label: 'Organization Name', field: 'organizationName' },
    { label: 'Contractor', field: 'contractor' },
    { label: 'Nature of Contract', field: 'natureOfContract' },
    { label: 'Status', field: 'status' },
    { label: 'Register Date', field: 'registerDate' }
  ];

  // Create dynamic columns array based on selection state
  const dynamicColumns = useMemo(() => {
    if (selectedContracts.length === 0) {
      // When no contracts are selected, exclude the Edit column
      return columns.filter(col => col.label !== 'Edit');
    }
    return columns;
  }, [selectedContracts.length]);

  // Filter contracts based on search and status
  const filteredContracts = contracts.filter(contract => {
    const matchesSearch = contract.organizationName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         contract.contractor.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         contract.natureOfContract.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = filterStatus === 'all' || contract.status.toLowerCase() === filterStatus.toLowerCase();
    return matchesSearch && matchesStatus;
  });

  // Handle form submission
  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setFormError('');

    try {
      // Validate required fields
      if (!formData.organizationName || !formData.contractor || !formData.natureOfContract || !formData.registerDate) {
        setFormError('Please fill in all required fields.');
        setSubmitting(false);
        return;
      }

      const data = {
        organizationName: formData.organizationName,
        contractor: formData.contractor,
        numberOfEmployees: formData.numberOfEmployees,
        natureOfContract: formData.natureOfContract,
        natureOfWork: formData.natureOfWork,
        registerDate: formData.registerDate,
        dateOfCompletion: formData.dateOfCompletion,
        siteManager: formData.siteManager,
        siteSupervisor: formData.siteSupervisor,
        siteHR: formData.siteHR,
        siteSafety: formData.siteSafety,
        description: formData.description,
        contractPeriodFrom: formData.contractPeriodFrom,
        contractPeriodTo: formData.contractPeriodTo,
        dateOfCommencement: formData.dateOfCommencement,
        expectedDateOfCompletion: formData.expectedDateOfCompletion,
        status: formData.status
      };

      const url = editingContract 
        ? `/server/contract_function/contracts/${editingContract.id}`
        : '/server/contract_function/contracts';
      
      const method = editingContract ? 'put' : 'post';
      
      console.log('Submitting contract:', { url, method, data, editingContract });
      
      const response = await axios[method](url, data, {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      });

      if (response.data.status === 'success') {
        console.log('Contract saved successfully:', response.data);
        await fetchContracts(); // Refresh the list
        setShowForm(false);
        setEditingContract(null);
        resetForm();
      } else {
        throw new Error(response.data.message || 'Failed to save contract');
      }
    } catch (err) {
      console.error('Error saving contract:', err);
      console.error('Error response:', err.response?.data);
      console.error('Error status:', err.response?.status);
      
      let errorMessage = 'Failed to save contract. Please try again.';
      
      if (err.response?.data?.message) {
        errorMessage = err.response.data.message;
      } else if (err.response?.status === 400) {
        errorMessage = 'Please check all required fields and try again.';
      } else if (err.response?.status === 500) {
        errorMessage = 'Server error. Please try again later.';
      } else if (err.code === 'ECONNABORTED') {
        errorMessage = 'Request timeout. Please try again.';
      }
      
      setFormError(errorMessage);
    } finally {
      setSubmitting(false);
    }
  }, [formData, editingContract, fetchContracts]);

  // Reset form
  const resetForm = () => {
    setFormData({
      organizationName: '',
      contractor: '',
      numberOfEmployees: '',
      natureOfContract: '',
      natureOfWork: '',
      registerDate: '',
      dateOfCompletion: '',
      siteManager: '',
      siteSupervisor: '',
      siteHR: '',
      siteSafety: '',
      description: '',
      contractPeriodFrom: '',
      contractPeriodTo: '',
      dateOfCommencement: '',
      expectedDateOfCompletion: '',
      status: 'Active'
    });
  };

  // Handle edit
  const handleEdit = (contract) => {
    setEditingContract(contract);
    setFormData(contract);
    setShowForm(true);
  };

  // Handle delete
  const handleDelete = useCallback(async (contractId) => {
    if (window.confirm('Are you sure you want to delete this contract?')) {
      try {
        const response = await axios.delete(`/server/contract_function/contracts/${contractId}`, { timeout: 10000 });
        
        if (response.data.status === 'success') {
          console.log('Contract deleted successfully');
          await fetchContracts(); // Refresh the list
        } else {
          throw new Error(response.data.message || 'Failed to delete contract');
        }
      } catch (err) {
        console.error('Error deleting contract:', err);
        alert(err.response?.data?.message || 'Failed to delete contract. Please try again.');
      }
    }
  }, [fetchContracts]);

  // User info
  const userAvatar = "https://images.pexels.com/photos/2379004/pexels-photo-2379004.jpeg?auto=compress&cs=tinysrgb&w=150";
  const userName = userRole === 'App Administrator' ? 'Admin User' : 'App User';

  // Sample activity data
  const recentActivities = [
    { icon: <FileSignature size={20} />, title: 'New Contract Added', description: 'Construction Services Agreement created', time: '2 hours ago' },
    { icon: <Edit size={20} />, title: 'Contract Updated', description: 'Security Services Contract modified', time: '4 hours ago' },
    { icon: <CheckCircle size={20} />, title: 'Contract Renewed', description: 'Cleaning Services Agreement renewed', time: '6 hours ago' },
    { icon: <Bell size={20} />, title: 'Contract Expiring', description: 'Maintenance contract expires in 30 days', time: '1 day ago' },
    { icon: <Plus size={20} />, title: 'New Application', description: 'New contractor application received', time: '2 days ago' }
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
        {/* Sidebar Overlay for mobile */}
        {showSidebarMenu && (
          <div 
            className="cms-sidebar-overlay" 
            onClick={() => setShowSidebarMenu(false)}
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(0, 0, 0, 0.5)',
              zIndex: 999,
              display: window.innerWidth <= 768 ? 'block' : 'none'
            }}
          />
        )}
        
        {/* Enhanced Sidebar */}
        <nav className={`cms-sidebar ${showSidebarMenu ? 'show' : ''}`}>
          {/* Water Bubbles */}
          <div className="water-bubble"></div>
          <div className="water-bubble"></div>
          <div className="water-bubble"></div>
          <div className="water-bubble"></div>
          <div className="water-bubble"></div>
          <div className="water-bubble"></div>
          <div className="water-bubble"></div>
          <div className="water-bubble"></div>
          <div className="water-bubble"></div>
          <div className="water-bubble"></div>
          <div className="water-bubble"></div>
          <div className="water-bubble"></div>
          <div className="water-bubble"></div>
          <div className="water-bubble"></div>
          <div className="water-bubble"></div>
          <div className="water-bubble"></div>
          
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
                  className={`cms-nav-item ${item.path === '/contract-form' ? 'active' : ''}`}
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
            {/* Water Bubbles */}
            <div className="water-bubble"></div>
            <div className="water-bubble"></div>
            <div className="water-bubble"></div>
            <div className="water-bubble"></div>
            <div className="water-bubble"></div>
            <div className="water-bubble"></div>
            <div className="water-bubble"></div>
            <div className="water-bubble"></div>
            <div className="water-bubble"></div>
            <div className="water-bubble"></div>
            <div className="water-bubble"></div>
            <div className="water-bubble"></div>
            <div className="water-bubble"></div>
            <div className="water-bubble"></div>
            <div className="water-bubble"></div>
            <div className="water-bubble"></div>
            
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

          {/* Main Content */}
          <main className="contract-form-content">
            {/* Card Container */}
            <div className="contract-card-container">
               {/* Header with Title and Toolbar */}
               <div className="contract-header">
                 <div className="contract-title-section">
                   <h1 className="contract-section-title">Contract Management</h1>
                   <p className="contract-section-subtitle">Manage and track all contract agreements</p>
                   {/* Delete selected contracts button - appears when contracts are selected */}
                   {selectedContracts.length > 0 && (
                     <div className="selected-contracts-info">
                       <span className="selected-count">{selectedContracts.length} contract(s) selected</span>
                       <button
                         className="btn btn-danger"
                         onClick={handleMassDelete}
                         disabled={deletingMultiple}
                         title="Delete selected contracts"
                       >
                         <i className="fas fa-trash"></i>
                         Delete Selected
                       </button>
                     </div>
                   )}
                 </div>
                {/* Toolbar Buttons - In same row as title */}
                <div className="contract-toolbar" style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'nowrap' }}>
                  <button
                    className="toolbar-btn import-btn"
                    onClick={() => fileInputRef.current.click()}
                    disabled={importing}
                    title="Import contracts from Excel"
                    type="button"
                    style={{ background: '#fff', color: '#232323', border: 'none', fontWeight: 600, padding: '8px', borderRadius: '8px', width: '48px', height: '48px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    <i className="fas fa-file-import" style={{ color: '#232323' }}></i>
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
                    title="Export filtered contracts to Excel"
                    type="button"
                    style={{ background: '#fff', color: '#232323', border: 'none', fontWeight: 600, padding: '8px', borderRadius: '8px', width: '48px', height: '48px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    <i className="fas fa-file-export" style={{ color: '#232323' }}></i>
                  </button>
                  <button
                    className="toolbar-btn filter-btn"
                    onClick={toggleSearchDropdown}
                    aria-expanded={showSearchDropdown}
                    aria-controls="search-dropdown"
                    type="button"
                    title="Show filter options"
                    style={{ background: '#fff', color: '#232323', border: 'none', fontWeight: 600, padding: '8px', borderRadius: '8px', width: '48px', height: '48px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    <i className="fas fa-filter" style={{ color: '#232323' }}></i>
                  </button>
                  <button
                    className="toolbar-btn"
                    onClick={() => {
                      setPage(1);
                      setShowAll(false);
                      fetchContracts();
                    }}
                    disabled={isLoading}
                    title="Refresh data"
                    type="button"
                    style={{ background: '#fff', color: '#232323', border: 'none', fontWeight: 600, padding: '8px', borderRadius: '8px', width: '48px', height: '48px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    <i className="fas fa-sync-alt" style={{ color: '#232323' }}></i>
                  </button>
                  <button
                    className="toolbar-btn"
                    onClick={() => setShowForm(true)}
                    type="button"
                    title="Add new contract"
                    style={{ background: '#fff', color: '#232323', border: 'none', fontWeight: 700, fontSize: '1.2rem', borderRadius: '8px', width: '48px', height: '48px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(60,72,88,0.10)' }}
                  >
                    <i className="fas fa-plus" style={{ color: '#232323', fontSize: '1.5rem' }}></i>
                  </button>
                </div>
              </div>

            {/* Error Display */}
            {fetchError && (
              <div className="error-message">
                <p>Error: {fetchError}</p>
                <button onClick={fetchContracts} className="toolbar-btn">Retry</button>
              </div>
            )}

            {/* Loading State */}
            {isLoading && (
              <div className="loading-state">
                <div className="loading-spinner"></div>
                <div className="loading-text">Loading contracts...</div>
              </div>
            )}

              {/* Contracts Table */}
              {!isLoading && (
                <div className="contracts-table-container">
                  <table className="contracts-table">
                    <thead>
                      <tr>
                        {dynamicColumns.map((column, index) => (
                          <th key={index}>{column.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredContracts.length === 0 ? (
                        <tr>
                          <td colSpan={dynamicColumns.length} className="empty-state">
                            <FileSignature size={64} />
                            <h3>No contracts found</h3>
                            <p>Start by adding your first contract</p>
                          </td>
                        </tr>
                      ) : (
                        filteredContracts.map((contract, index) => (
                          <ContractRow
                            key={contract.id}
                            contract={contract}
                            index={index}
                            removeContract={removeContract}
                            editContract={editContract}
                            isSelected={selectedContracts.includes(contract.id)}
                            onSelect={handleSelectContract}
                            selectedContracts={selectedContracts}
                          />
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Contract Form Modal */}
            {showForm && (
              <div className="modal-overlay" onClick={() => setShowForm(false)}>
                <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                  <div className="modal-header">
                    <h2>{editingContract ? 'Edit Contract' : 'Add New Contract'}</h2>
                    <button 
                      className="modal-close"
                      onClick={() => setShowForm(false)}
                    >
                      ×
                    </button>
                  </div>
                  <form onSubmit={handleSubmit} className="contract-form">
                    {formError && (
                      <div className="form-error">
                        <p>{formError}</p>
                      </div>
                    )}
                    <div className="form-grid">
                      <div className="form-group">
                        <label>Organization Name *</label>
                        <input
                          type="text"
                          value={formData.organizationName}
                          onChange={(e) => setFormData({...formData, organizationName: e.target.value})}
                          required
                        />
                      </div>
                      <div className="form-group">
                        <label>Contractor *</label>
                        <select
                          value={formData.contractor}
                          onChange={(e) => setFormData({...formData, contractor: e.target.value})}
                          required
                        >
                          <option value="">Select Contractor</option>
                          {contractors.map((contractor) => (
                            <option key={contractor.id} value={contractor.name}>
                              {contractor.name} {contractor.organization ? `(${contractor.organization})` : ''}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="form-group">
                        <label>Number Of Employees as per RC</label>
                        <input
                          type="number"
                          value={formData.numberOfEmployees}
                          onChange={(e) => setFormData({...formData, numberOfEmployees: e.target.value})}
                          placeholder="Enter number of employees"
                        />
                      </div>
                      <div className="form-group">
                        <label>Nature of Contract *</label>
                        <select
                          value={formData.natureOfContract}
                          onChange={(e) => setFormData({...formData, natureOfContract: e.target.value})}
                          required
                        >
                          <option value="">Select Nature of Contract</option>
                          <option value="Construction">Construction</option>
                          <option value="Security">Security</option>
                          <option value="Maintenance">Maintenance</option>
                          <option value="Cleaning">Cleaning</option>
                          <option value="IT Services">IT Services</option>
                          <option value="Other">Other</option>
                        </select>
                      </div>
                      <div className="form-group">
                        <label>Nature of work</label>
                        <input
                          type="text"
                          value={formData.natureOfWork}
                          onChange={(e) => setFormData({...formData, natureOfWork: e.target.value})}
                          placeholder="Describe the nature of work"
                        />
                      </div>
                      <div className="form-group">
                        <label>Register Date * (dd-MMM-yyyy)</label>
                        <input
                          type="text"
                          value={formData.registerDate}
                          onChange={(e) => setFormData({...formData, registerDate: e.target.value})}
                          placeholder="e.g., 01-Jan-2024"
                          required
                        />
                      </div>
                      <div className="form-group">
                        <label>Date of Completion (dd-MMM-yyyy)</label>
                        <input
                          type="text"
                          value={formData.dateOfCompletion}
                          onChange={(e) => setFormData({...formData, dateOfCompletion: e.target.value})}
                          placeholder="e.g., 31-Dec-2024"
                        />
                      </div>
                      <div className="form-group">
                        <label>Site Manager</label>
                        <input
                          type="text"
                          value={formData.siteManager}
                          onChange={(e) => setFormData({...formData, siteManager: e.target.value})}
                          placeholder="Enter site manager name"
                        />
                      </div>
                      <div className="form-group">
                        <label>Site Supervisor</label>
                        <input
                          type="text"
                          value={formData.siteSupervisor}
                          onChange={(e) => setFormData({...formData, siteSupervisor: e.target.value})}
                          placeholder="Enter site supervisor name"
                        />
                      </div>
                      <div className="form-group">
                        <label>Site HR</label>
                        <input
                          type="text"
                          value={formData.siteHR}
                          onChange={(e) => setFormData({...formData, siteHR: e.target.value})}
                          placeholder="Enter site HR name"
                        />
                      </div>
                      <div className="form-group">
                        <label>Site Safety</label>
                        <input
                          type="text"
                          value={formData.siteSafety}
                          onChange={(e) => setFormData({...formData, siteSafety: e.target.value})}
                          placeholder="Enter site safety officer name"
                        />
                      </div>
                      <div className="form-group">
                        <label>Description</label>
                        <textarea
                          value={formData.description}
                          onChange={(e) => setFormData({...formData, description: e.target.value})}
                          rows="3"
                          placeholder="Contract description..."
                        />
                      </div>
                      <div className="form-group">
                        <label>Contract Period From (dd-MMM-yyyy)</label>
                        <input
                          type="text"
                          value={formData.contractPeriodFrom}
                          onChange={(e) => setFormData({...formData, contractPeriodFrom: e.target.value})}
                          placeholder="e.g., 01-Jan-2024"
                        />
                      </div>
                      <div className="form-group">
                        <label>Contract Period To (dd-MMM-yyyy)</label>
                        <input
                          type="text"
                          value={formData.contractPeriodTo}
                          onChange={(e) => setFormData({...formData, contractPeriodTo: e.target.value})}
                          placeholder="e.g., 31-Dec-2024"
                        />
                      </div>
                      <div className="form-group">
                        <label>Date of Commencement of Work (dd-MMM-yyyy)</label>
                        <input
                          type="text"
                          value={formData.dateOfCommencement}
                          onChange={(e) => setFormData({...formData, dateOfCommencement: e.target.value})}
                          placeholder="e.g., 01-Jan-2024"
                        />
                      </div>
                      <div className="form-group">
                        <label>Expected Date of Completion of Work (dd-MMM-yyyy)</label>
                        <input
                          type="text"
                          value={formData.expectedDateOfCompletion}
                          onChange={(e) => setFormData({...formData, expectedDateOfCompletion: e.target.value})}
                          placeholder="e.g., 31-Dec-2024"
                        />
                      </div>
                      <div className="form-group">
                        <label>Status</label>
                        <select
                          value={formData.status}
                          onChange={(e) => setFormData({...formData, status: e.target.value})}
                        >
                          <option value="Active">Active</option>
                          <option value="Completed">Completed</option>
                          <option value="Others">Others</option>
                          <option value="Suspended">Suspended</option>
                        </select>
                      </div>
                    </div>
                    <div className="form-actions">
                      <button 
                        type="button" 
                        className="toolbar-btn"
                        onClick={() => setShowForm(false)}
                      >
                        Cancel
                      </button>
                      <button type="submit" className="toolbar-btn" disabled={submitting}>
                        <Save size={20} />
                        {submitting ? 'Saving...' : (editingContract ? 'Update Contract' : 'Create Contract')}
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}
          </main>
        </div>
      </div>
    </>
  );
}

export default ContractForm;
