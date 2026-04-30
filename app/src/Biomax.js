import './App.css';
import './helper.css';
import './BioMax.css';
import axios from 'axios';
import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import { Link } from 'react-router-dom';
import HeaderBranding from './HeaderBranding';
import { isHideDashboardAndSetupUser } from './modulesConfig';
import Button from './Button';
import {
  Users, Calendar, FileText, AlertTriangle, FolderOpen,
  ClipboardList, Building, Handshake, Landmark, Clock,
  Map, BarChart3, User, TrendingUp, TrendingDown,
  Activity, Plus, CheckCircle, Bell, Settings, LayoutDashboard, Home as HomeIcon,
  Shield, AlertOctagon, CreditCard, FileSignature, Search, Clock3, Database,
  FileInput, FileOutput, CalendarDays
} from 'lucide-react';

// Helper function to format date (date only)
function formatDate(dateStr) {
  if (!dateStr) return '-';
  return String(dateStr).slice(0, 10);
}

// Helper function to format datetime (date + time)
function formatDateTime(dateStr) {
  if (!dateStr) return '-';
  const dateString = String(dateStr);
  // If it contains 'T', replace it with space and show first 19 chars (YYYY-MM-DD HH:MM:SS)
  if (dateString.includes('T')) {
    return dateString.replace('T', ' ').slice(0, 19);
  }
  // If it already has space, show first 19 chars
  if (dateString.includes(' ')) {
    return dateString.slice(0, 19);
  }
  // If it's just date, return as is
  return dateString.slice(0, 10);
}

// Helper function to format datetime for Excel export (DD-MM-YYYY HH:MM format)
function formatDateTimeForExport(dateStr) {
  if (!dateStr) return '';
  const dateString = String(dateStr).trim();
 
  let date;
  let time = '';
 
  // Parse the date string
  if (dateString.includes('T')) {
    // ISO format: YYYY-MM-DDTHH:MM:SS
    const parts = dateString.split('T');
    date = parts[0];
    time = parts[1] ? parts[1].slice(0, 5) : '00:00'; // Get HH:MM part
  } else if (dateString.includes(' ')) {
    // Format: YYYY-MM-DD HH:MM:SS or YYYY-MM-DD HH:MM
    const parts = dateString.split(' ');
    date = parts[0];
    time = parts[1] ? parts[1].slice(0, 5) : '00:00'; // Get HH:MM part
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    // Just date: YYYY-MM-DD
    date = dateString;
    time = '00:00';
  } else {
    // Try to parse as Date object
    try {
      const dateObj = new Date(dateString);
      if (!isNaN(dateObj.getTime())) {
        const year = dateObj.getFullYear();
        const month = String(dateObj.getMonth() + 1).padStart(2, '0');
        const day = String(dateObj.getDate()).padStart(2, '0');
        const hours = String(dateObj.getHours()).padStart(2, '0');
        const minutes = String(dateObj.getMinutes()).padStart(2, '0');
        // Return in DD-MM-YYYY HH:MM format
        return `${day}-${month}-${year} ${hours}:${minutes}`;
      }
    } catch (err) {
      console.error('Error formatting date for export:', err);
      return dateString; // Return as is if parsing fails
    }
    return dateString; // Return as is if we can't parse
  }
 
  // Convert YYYY-MM-DD to DD-MM-YYYY
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const [year, month, day] = date.split('-');
    return `${day}-${month}-${year} ${time}`;
  }
 
  return dateString; // Return as is if format doesn't match
}

// Helper function to convert database datetime format to datetime-local input format
function formatForDateTimeLocal(dateStr) {
  if (!dateStr) return '';
  const dateString = String(dateStr).trim();
 
  // If it's already in datetime-local format (YYYY-MM-DDTHH:mm), return as is
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(dateString)) {
    return dateString.slice(0, 16); // Return YYYY-MM-DDTHH:mm
  }
 
  // If it's in format YYYY-MM-DD HH:MM:SS
  if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}/.test(dateString)) {
    return dateString.replace(' ', 'T').slice(0, 16); // Convert space to T and return YYYY-MM-DDTHH:mm
  }
 
  // If it's in format YYYY-MM-DD HH:MM
  if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/.test(dateString)) {
    return dateString.replace(' ', 'T').slice(0, 16); // Convert space to T and return YYYY-MM-DDTHH:mm
  }
 
  // If it's ISO format with T
  if (dateString.includes('T')) {
    return dateString.slice(0, 16); // Return YYYY-MM-DDTHH:mm
  }
 
  // If it's just a date (YYYY-MM-DD), add default time 00:00
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    return dateString + 'T00:00';
  }
 
  // Try to parse as Date object
  try {
    const date = new Date(dateString);
    if (!isNaN(date.getTime())) {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      return `${year}-${month}-${day}T${hours}:${minutes}`;
    }
  } catch (err) {
    console.error('Error formatting date for datetime-local:', err);
  }
 
  return '';
}

// Helper function to convert datetime-local format to database format (YYYY-MM-DD HH:MM:SS)
function formatForDatabase(dateTimeLocal) {
  if (!dateTimeLocal) return '';
  const dateTimeString = String(dateTimeLocal).trim();
 
  // If it's in datetime-local format (YYYY-MM-DDTHH:mm), convert to database format
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(dateTimeString)) {
    const [datePart, timePart] = dateTimeString.split('T');
    const timeWithSeconds = timePart.length === 5 ? timePart + ':00' : timePart; // Add seconds if missing
    return `${datePart} ${timeWithSeconds}`;
  }
 
  // If already in database format, return as is
  if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/.test(dateTimeString)) {
    return dateTimeString.slice(0, 19); // Return YYYY-MM-DD HH:MM:SS
  }
 
  return dateTimeString;
}

// BioMax Row Component
function BioMaxRow({ biomax, index, removeBioMax, editBioMax, isSelected, onSelect, selectedBioMax }) {
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const deleteBioMax = useCallback((e) => {
    e.stopPropagation();
    setDeleting(true);
    setDeleteError('');
    axios
      .delete(`/server/biomax_function/biomax/${biomax.id}`, { timeout: 5000 })
      .then(() => {
        removeBioMax(biomax.id);
      })
      .catch((err) => {
        const errorMessage = err.response?.data?.message || `Failed to delete BioMax record (ID: ${biomax.id}).`;
        setDeleteError(errorMessage);
        console.error('Delete BioMax error:', err);
      })
      .finally(() => setDeleting(false));
  }, [biomax.id, removeBioMax]);

  const handleRowClick = useCallback(() => {
    editBioMax(biomax);
  }, [editBioMax, biomax]);

  const handleCheckboxClick = useCallback((e) => {
    e.stopPropagation();
    onSelect(biomax.id);
  }, [onSelect, biomax.id]);

  const handleEditButtonClick = useCallback((e) => {
    e.stopPropagation();
    editBioMax(biomax);
  }, [editBioMax, biomax]);

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
        />
      </td>
      {selectedBioMax.length > 0 && (
        <td onClick={handleEditButtonClick}>
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
      <td style={{ paddingRight: '20px' }}>{index + 1}</td>
      <td>{biomax.employeeCode || '-'}</td>
      <td>{biomax.employeeName || '-'}</td>
      <td>{formatDateTime(biomax.logDate)}</td>
      <td>{biomax.createdTime ? String(biomax.createdTime).replace('T', ' ').slice(0, 19) : '-'}</td>
      <td>{biomax.modifiedTime ? String(biomax.modifiedTime).replace('T', ' ').slice(0, 19) : '-'}</td>
    </tr>
  );
}

// BioMax Management Component
function BioMax({ userRole = 'App Administrator', userEmail = null }) {
  const [biomaxData, setBioMaxData] = useState([]);
  const [filteredBioMax, setFilteredBioMax] = useState([]);
  const [fetchState, setFetchState] = useState('init');
  const [fetchError, setFetchError] = useState('');
  const [selectedBioMax, setSelectedBioMax] = useState([]);
  const [deletingMultiple, setDeletingMultiple] = useState(false);
  const [massDeleteError, setMassDeleteError] = useState('');
 
  const allSelected = filteredBioMax.length > 0 && selectedBioMax.length === filteredBioMax.length;
  const someSelected = selectedBioMax.length > 0 && selectedBioMax.length < filteredBioMax.length;
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importError, setImportError] = useState('');
  const [exportError, setExportError] = useState('');
  const [importSuccess, setImportSuccess] = useState('');
  const fileInputRef = useRef(null);

  // Pagination state - show all data by default
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(50);
  const [totalPages, setTotalPages] = useState(1);
  const [totalBioMax, setTotalBioMax] = useState(0);
  const [showAll, setShowAll] = useState(true); // Set to true to show all data by default

  const [form, setForm] = useState({
    employeeCode: '',
    employeeName: '',
    logDate: ''
  });
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editingBioMaxId, setEditingBioMaxId] = useState(null);

  // Columns definition
  const columns = [
    { label: 'Select', field: null },
    { label: 'Edit', field: null },
    { label: '#', field: null },
    { label: 'Employee Code', field: 'employeeCode' },
    { label: 'Employee Name', field: 'employeeName' },
    { label: 'Log Date', field: 'logDate' },
    { label: 'Created Time', field: 'createdTime' },
    { label: 'Modified Time', field: 'modifiedTime' }
  ];

  // Fetch BioMax data with pagination
  const fetchBioMax = useCallback(() => {
    setFetchState('loading');
    setFetchError('');
   
    const params = showAll ? {} : { page, perPage };
   
    if (userRole && userEmail) {
      params.userRole = userRole;
      params.userEmail = userEmail;
    }
   
    axios
      .get('/server/biomax_function/biomax', { params, timeout: 5000 })
      .then((response) => {
        if (!response?.data?.data?.biomax) {
          throw new Error('Unexpected API response structure');
        }
        const fetchedBioMax = response.data.data.biomax || [];
        setBioMaxData(fetchedBioMax);
        setFilteredBioMax(fetchedBioMax);
        setTotalBioMax(response.data.data.total || fetchedBioMax.length);
        setTotalPages(response.data.data.totalPages || 1);
        setFetchState('success');
      })
      .catch((err) => {
        console.error('Fetch BioMax error:', err);
        const errorMessage = err.response?.data?.message || 'Failed to fetch BioMax data.';
        setFetchError(errorMessage);
        setFetchState('error');
      });
  }, [page, perPage, showAll, userRole, userEmail]);

  useEffect(() => {
    fetchBioMax();
  }, [fetchBioMax]);

  // Remove BioMax record
  const removeBioMax = useCallback((id) => {
    setBioMaxData(prev => prev.filter(b => b.id !== id));
    setFilteredBioMax(prev => prev.filter(b => b.id !== id));
    setSelectedBioMax(prev => prev.filter(selectedId => selectedId !== id));
  }, []);

  // Edit BioMax record
  const editBioMax = useCallback((biomax) => {
    // Format logDate for datetime-local input (YYYY-MM-DDTHH:mm)
    const formattedDate = formatForDateTimeLocal(biomax.logDate);
   
    setForm({
      employeeCode: biomax.employeeCode || '',
      employeeName: biomax.employeeName || '',
      logDate: formattedDate
    });
    setIsEditing(true);
    setEditingBioMaxId(biomax.id);
    setShowForm(true);
  }, []);

  // Handle form submission
  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    setFormError('');
    setSubmitting(true);

    try {
      // Validate form data
      if (!form.employeeCode || !form.employeeName || !form.logDate) {
        setFormError('Please fill in all required fields.');
        setSubmitting(false);
        return;
      }

      // Convert datetime-local format to database format
      const submitData = {
        ...form,
        logDate: formatForDatabase(form.logDate)
      };

      const url = isEditing
        ? `/server/biomax_function/biomax/${editingBioMaxId}`
        : '/server/biomax_function/biomax';
     
      const method = isEditing ? 'put' : 'post';
     
      console.log('Submitting BioMax form:', { url, method, submitData });
     
      const response = await axios[method](url, submitData, {
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json'
        }
      });
     
      console.log('BioMax submit response:', response.data);
     
      if (response.data && response.data.status === 'success') {
        fetchBioMax();
        resetForm();
        setShowForm(false);
      } else {
        const errorMsg = response.data?.message || 'Operation failed';
        setFormError(errorMsg);
        console.error('BioMax submit failed:', errorMsg);
      }
    } catch (err) {
      console.error('Submit error:', err);
      console.error('Error response:', err.response?.data);
      const errorMessage = err.response?.data?.message || err.message || 'Failed to save BioMax record. Please try again.';
      setFormError(errorMessage);
    } finally {
      setSubmitting(false);
    }
  }, [form, isEditing, editingBioMaxId, fetchBioMax]);

  // Reset form
  const resetForm = useCallback(() => {
    setForm({
      employeeCode: '',
      employeeName: '',
      logDate: ''
    });
    setIsEditing(false);
    setEditingBioMaxId(null);
  }, []);

  // Handle select all
  const handleSelectAll = useCallback((e) => {
    if (e.target.checked) {
      setSelectedBioMax(filteredBioMax.map(b => b.id));
    } else {
      setSelectedBioMax([]);
    }
  }, [filteredBioMax]);

  // Handle individual select
  const handleSelect = useCallback((id) => {
    setSelectedBioMax(prev => {
      if (prev.includes(id)) {
        return prev.filter(selectedId => selectedId !== id);
      } else {
        return [...prev, id];
      }
    });
  }, []);

  // Handle delete multiple (bulk delete)
  const handleDeleteMultiple = useCallback(async () => {
    if (selectedBioMax.length === 0) return;
   
    if (!window.confirm(`Are you sure you want to delete ${selectedBioMax.length} record(s)? This action cannot be undone.`)) {
      return;
    }

    setDeletingMultiple(true);
    setMassDeleteError('');

    try {
      console.log('Bulk deleting BioMax records:', selectedBioMax);
      const response = await axios.delete('/server/biomax_function/biomax/bulk', {
        data: { ids: selectedBioMax },
        timeout: 30000,
        headers: {
          'Content-Type': 'application/json'
        }
      });
     
      console.log('Bulk delete response:', response.data);
     
      if (response.data && response.data.status === 'success') {
        // All records deleted successfully
        fetchBioMax();
        setSelectedBioMax([]);
        setMassDeleteError('');
      } else if (response.data && response.data.status === 'partial') {
        // Some records deleted, some failed
        const message = response.data.message || 'Some records could not be deleted.';
        setMassDeleteError(message);
        fetchBioMax(); // Refresh to show updated data
        setSelectedBioMax([]);
      } else {
        setMassDeleteError(response.data?.message || 'Failed to delete records.');
      }
    } catch (err) {
      console.error('Bulk delete error:', err);
      const errorMessage = err.response?.data?.message || err.message || 'Failed to delete records.';
      setMassDeleteError(errorMessage);
    } finally {
      setDeletingMultiple(false);
    }
  }, [selectedBioMax, fetchBioMax]);

  // Handle import
  const handleImport = useCallback(async (event) => {
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
    const maxSize = 20 * 1024 * 1024; // 20MB (increased to support 1000+ records)
    if (file.size > maxSize) {
      setImportError('File size exceeds 20MB limit.');
      return;
    }

    setImporting(true);
    setImportError('');
    setImportSuccess('');

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        // Read Excel file - get formatted cell values to preserve date/time format exactly as shown in Excel
        const workbook = XLSX.read(data, { type: 'array', cellDates: false, cellNF: false });
        const sheetName = workbook.SheetNames[0];
        if (!sheetName) {
          throw new Error('No sheets found in the Excel file.');
        }
        const worksheet = workbook.Sheets[sheetName];
        // Read as JSON with formatted values (raw: false) to get dates as formatted strings
        // This preserves the exact format shown in Excel (e.g., "28-10-2025 08:28")
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { raw: false, defval: null });

        if (!jsonData || jsonData.length === 0) {
          throw new Error('No data found in the Excel file.');
        }

        // Helper function to parse date from format "27-Oct-2025 08:19" or "28-10-2025 08:28"
        const parseLogDate = (dateStr) => {
          if (!dateStr) return null;
         
          // If it's already a Date object (from XLSX), extract components directly
          // Be careful: Date objects from Excel might have timezone issues
          if (dateStr instanceof Date) {
            if (!isNaN(dateStr.getTime())) {
              // For Date objects, we'll extract components directly
              // However, Excel dates might already be in UTC or local time
              // Try to preserve the exact time as stored
              const yearStr = dateStr.getFullYear();
              const monthStr = String(dateStr.getMonth() + 1).padStart(2, '0');
              const dayStr = String(dateStr.getDate()).padStart(2, '0');
              const hourStr = String(dateStr.getHours()).padStart(2, '0');
              const minuteStr = String(dateStr.getMinutes()).padStart(2, '0');
              const secondStr = String(dateStr.getSeconds()).padStart(2, '0');
              return `${yearStr}-${monthStr}-${dayStr} ${hourStr}:${minuteStr}:${secondStr}`;
            }
          }
         
          const dateString = String(dateStr).trim();
         
          // Try to parse the format "DD-MM-YYYY HH:mm" or "DD-MM-YYYY HH:mm:ss"
          const dmyPattern = /^(\d{2})-(\d{2})-(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/;
          const dmyMatch = dateString.match(dmyPattern);
         
          if (dmyMatch) {
            const day = parseInt(dmyMatch[1], 10);
            const month = parseInt(dmyMatch[2], 10) - 1; // JavaScript months are 0-indexed
            const year = parseInt(dmyMatch[3], 10);
            const hour = parseInt(dmyMatch[4], 10);
            const minute = parseInt(dmyMatch[5], 10);
            const second = dmyMatch[6] ? parseInt(dmyMatch[6], 10) : 0;
           
            if (month >= 0 && month <= 11 && day >= 1 && day <= 31 && year >= 1900 && year <= 2100) {
              // Use UTC to avoid timezone issues - create date in local timezone
              const date = new Date(year, month, day, hour, minute, second);
              // Validate the date
              if (date.getFullYear() === year && date.getMonth() === month && date.getDate() === day) {
                // Format as YYYY-MM-DD HH:MM:SS for database (using local time values)
                const yearStr = date.getFullYear();
                const monthStr = String(date.getMonth() + 1).padStart(2, '0');
                const dayStr = String(date.getDate()).padStart(2, '0');
                const hourStr = String(hour).padStart(2, '0');
                const minuteStr = String(minute).padStart(2, '0');
                const secondStr = String(second).padStart(2, '0');
                return `${yearStr}-${monthStr}-${dayStr} ${hourStr}:${minuteStr}:${secondStr}`;
              }
            }
          }
         
          // Try to parse the format "27-Oct-2025 08:19" or "27-Oct-2025 08:19:00"
          const datePattern = /(\d{1,2})-([A-Za-z]{3})-(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/i;
          const match = dateString.match(datePattern);
         
          if (match) {
            const day = parseInt(match[1], 10);
            const monthName = match[2].charAt(0).toUpperCase() + match[2].slice(1).toLowerCase();
            const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            const month = monthNames.indexOf(monthName);
            const year = parseInt(match[3], 10);
            const hour = parseInt(match[4], 10);
            const minute = parseInt(match[5], 10);
            const second = match[6] ? parseInt(match[6], 10) : 0;
           
            if (month !== -1 && day >= 1 && day <= 31 && year >= 1900 && year <= 2100) {
              const date = new Date(year, month, day, hour, minute, second);
              // Validate the date
              if (date.getFullYear() === year && date.getMonth() === month && date.getDate() === day) {
                // Format as YYYY-MM-DD HH:MM:SS for database
                const yearStr = date.getFullYear();
                const monthStr = String(date.getMonth() + 1).padStart(2, '0');
                const dayStr = String(date.getDate()).padStart(2, '0');
                const hourStr = String(hour).padStart(2, '0');
                const minuteStr = String(minute).padStart(2, '0');
                const secondStr = String(second).padStart(2, '0');
                return `${yearStr}-${monthStr}-${dayStr} ${hourStr}:${minuteStr}:${secondStr}`;
              }
            }
          }
         
          // Fallback: try to parse as standard date (Excel date serial number or ISO format)
          try {
            let date;
            // Check if it's an Excel serial number (numeric value without date separators)
            const numericValue = typeof dateStr === 'number' ? dateStr : (!isNaN(dateString) && parseFloat(dateString) > 0 && !dateString.includes(':') && !dateString.includes('-') ? parseFloat(dateString) : null);
           
            if (numericValue !== null && numericValue > 0) {
              // Excel date serial number conversion - precise conversion without timezone shifts
              // Use XLSX library's date parser if available, otherwise manual conversion
              const excelSerial = numericValue;
             
              let year, month, day, hours, minutes, seconds;
             
              // Try using XLSX's built-in date parser (most accurate)
              if (XLSX.SSF && typeof XLSX.SSF.parse_date_code === 'function') {
                try {
                  const parsed = XLSX.SSF.parse_date_code(excelSerial);
                  if (parsed) {
                    year = parsed.y;
                    month = parsed.m;
                    day = parsed.d;
                    // Time components from fractional part
                    const fractionalDay = excelSerial - Math.floor(excelSerial);
                    const totalSeconds = Math.round(fractionalDay * 24 * 60 * 60);
                    hours = Math.floor(totalSeconds / 3600);
                    minutes = Math.floor((totalSeconds % 3600) / 60);
                    seconds = Math.floor(totalSeconds % 60);
                  }
                } catch (e) {
                  console.warn('XLSX date parser failed, using manual conversion:', e);
                }
              }
             
              // Manual conversion if XLSX parser not available or failed
              if (!year) {
                // Excel epoch: December 30, 1899 (Excel serial 1 = January 1, 1900)
                // Separate days and fractional day (time)
                const days = Math.floor(excelSerial);
                const fractionalDay = excelSerial - days;
               
                // Calculate date: start from Dec 30, 1899, add (days - 1)
                // Use UTC to avoid timezone issues
                const excelEpochUTC = Date.UTC(1899, 11, 30, 0, 0, 0, 0); // Dec 30, 1899 00:00:00 UTC
                const totalMs = excelEpochUTC + (days - 1) * 24 * 60 * 60 * 1000;
                const dateObj = new Date(totalMs);
               
                // Extract UTC components to avoid timezone conversion
                year = dateObj.getUTCFullYear();
                month = dateObj.getUTCMonth() + 1; // 1-based
                day = dateObj.getUTCDate();
               
                // Calculate time from fractional day (most precise, no timezone issues)
                const totalSecondsInDay = Math.round(fractionalDay * 24 * 60 * 60);
                hours = Math.floor(totalSecondsInDay / 3600);
                minutes = Math.floor((totalSecondsInDay % 3600) / 60);
                seconds = Math.floor(totalSecondsInDay % 60);
              }
             
              // Format the result
              const yearStr = String(year);
              const monthStr = String(month).padStart(2, '0');
              const dayStr = String(day).padStart(2, '0');
              const hourStr = String(hours).padStart(2, '0');
              const minuteStr = String(minutes).padStart(2, '0');
              const secondStr = String(seconds).padStart(2, '0');
             
              return `${yearStr}-${monthStr}-${dayStr} ${hourStr}:${minuteStr}:${secondStr}`;
            } else {
              // Try as regular date string - be careful with timezone
              date = new Date(dateString);
             
              if (!isNaN(date.getTime())) {
                // Use local time values (not UTC) to preserve the original time
                const yearStr = date.getFullYear();
                const monthStr = String(date.getMonth() + 1).padStart(2, '0');
                const dayStr = String(date.getDate()).padStart(2, '0');
                const hourStr = String(date.getHours()).padStart(2, '0');
                const minuteStr = String(date.getMinutes()).padStart(2, '0');
                const secondStr = String(date.getSeconds()).padStart(2, '0');
                return `${yearStr}-${monthStr}-${dayStr} ${hourStr}:${minuteStr}:${secondStr}`;
              }
            }
          } catch (err) {
            console.error('Date parsing error:', err, 'for value:', dateStr);
          }
         
          return null;
        };

        // Helper function to get formatted cell value directly from worksheet
        const getFormattedCellValue = (cellAddress) => {
          const cell = worksheet[cellAddress];
          if (!cell) return null;
          // If cell has formatted text (w property), use it - this preserves Excel's displayed format
          if (cell.w !== undefined) {
            return cell.w;
          }
          // Otherwise use the raw value (v property)
          return cell.v !== undefined ? cell.v : null;
        };

        // Map Excel columns to BioMax fields
        // Expected columns: Employee Code, Employee Name, LogDate
        const biomaxRecords = jsonData.map((row, index) => {
          // Handle different possible column names
          const employeeCode = row['Employee Code'] || row['EmployeeCode'] || row['employeeCode'] || row['EMPLOYEE CODE'] || '';
          const employeeName = row['Employee Name'] || row['EmployeeName'] || row['employeeName'] || row['EMPLOYEE NAME'] || '';
          let logDate = row['LogDate'] || row['Log Date'] || row['logDate'] || row['LOGDATE'] || row['LOG DATE'] || '';
         
          if (!employeeCode || !employeeName || !logDate) {
            throw new Error(`Row ${index + 2}: Missing required fields. Required: Employee Code, Employee Name, LogDate`);
          }

          // If logDate is a number (Excel serial number), try to get formatted text from cell
          // This preserves the exact format shown in Excel (e.g., "28-10-2025 08:28")
          if (typeof logDate === 'number') {
            try {
              // Find LogDate column by checking header row
              const headerRow = XLSX.utils.sheet_to_json(worksheet, { header: 1, range: 0 })[0] || [];
              const logDateColIndex = headerRow.findIndex(h =>
                h && (String(h).toLowerCase().includes('logdate') || String(h).toLowerCase().includes('log date'))
              );
             
              if (logDateColIndex >= 0) {
                const logDateColumn = XLSX.utils.encode_col(logDateColIndex);
                // Excel rows: row 1 = header, row 2+ = data (1-indexed in Excel)
                const cellAddress = logDateColumn + (index + 2);
                const formattedValue = getFormattedCellValue(cellAddress);
               
                // Use formatted text if available and it's a string (preserves Excel's displayed format)
                if (formattedValue && typeof formattedValue === 'string' && formattedValue.trim()) {
                  logDate = formattedValue;
                  // Log when we use formatted value
                  if (index < 3) {
                    console.log(`Row ${index + 2} - Using formatted cell value: "${formattedValue}"`);
                  }
                }
              }
            } catch (err) {
              console.warn(`Could not get formatted cell value for row ${index + 2}, using serial number parsing:`, err.message);
            }
          }

          // Log the raw value type for debugging (only first few rows)
          if (index < 3) {
            console.log(`Row ${index + 2} - LogDate raw value:`, logDate, 'Type:', typeof logDate, 'Is Date:', logDate instanceof Date);
          }
         
          const parsedDate = parseLogDate(logDate);
          if (!parsedDate) {
            throw new Error(`Row ${index + 2}: Invalid date format for LogDate: "${logDate}". Expected format: "28-10-2025 08:28" or "27-Oct-2025 08:19"`);
          }
         
          // Log parsed result for debugging (only first few rows)
          if (index < 3) {
            console.log(`Row ${index + 2} - Parsed date:`, parsedDate);
          }

          return {
            employeeCode: String(employeeCode).trim(),
            employeeName: String(employeeName).trim(),
            logDate: parsedDate
          };
        });

        if (biomaxRecords.length === 0) {
          throw new Error('No valid records found in the Excel file.');
        }

        console.log(`Preparing to import ${biomaxRecords.length} BioMax records...`);

        // Get initial count before import to calculate actual imported count
        let initialCount = 0;
        try {
          const initialCountResponse = await axios.get('/server/biomax_function/biomax?perPage=1&page=1');
          initialCount = initialCountResponse.data?.data?.total || 0;
          console.log(`Initial BioMax count: ${initialCount}`);
        } catch (err) {
          console.warn('Could not fetch initial count:', err);
        }

        // Import records in smaller batches to avoid timeout
        // Process in batches of 100 records to ensure each request completes
        const maxBatchSize = 100;
        let totalSuccessCount = 0;
        let totalErrorCount = 0;
        const allErrors = [];
        let hasTimeout = false;

        // Process in batches of 100
        for (let batchStart = 0; batchStart < biomaxRecords.length; batchStart += maxBatchSize) {
          const batch = biomaxRecords.slice(batchStart, batchStart + maxBatchSize);
          const batchNumber = Math.floor(batchStart / maxBatchSize) + 1;
          const totalBatches = Math.ceil(biomaxRecords.length / maxBatchSize);
         
          console.log(`Processing batch ${batchNumber}/${totalBatches} (${batch.length} records)...`);

          try {
            const response = await axios.post('/server/biomax_function/biomax/bulk', {
              records: batch
            }, {
              timeout: 120000, // 2 minutes timeout per batch
              headers: {
                'Content-Type': 'application/json'
              }
            });

            console.log(`Batch ${batchNumber} response:`, response.data);

            if (response.data && response.data.results) {
              const batchResults = response.data.results;
              totalSuccessCount += batchResults.successful || 0;
              totalErrorCount += batchResults.failed || 0;
             
              if (batchResults.errors && batchResults.errors.length > 0) {
                batchResults.errors.forEach(error => {
                  allErrors.push(`Row ${error.row}: ${error.error}`);
                });
              }
            } else if (response.data && response.data.status === 'success') {
              totalSuccessCount += batch.length;
            }
          } catch (err) {
            console.error(`Batch ${batchNumber} import error:`, err);
            const errorMessage = err.response?.data?.message || err.message || 'Unknown error';
            const isTimeout = err.code === 'ECONNABORTED' || err.response?.status === 408;
           
            if (isTimeout) {
              hasTimeout = true;
              // Request timed out, but records may have been imported
              console.log(`Batch ${batchNumber} timed out - records may still be importing in background`);
              allErrors.push(`Batch ${batchNumber}: Request timed out (records may have been imported)`);
              // Don't count all as failed since some may have been imported
            } else {
              totalErrorCount += batch.length;
              allErrors.push(`Batch ${batchNumber}: ${errorMessage}`);
            }
          }
        }
       
        // If we had timeouts, wait and fetch actual count from database
        if (hasTimeout) {
          try {
            console.log('Request had timeouts - waiting for background processing and checking actual count...');
            // Wait longer for any pending inserts to complete
            await new Promise(resolve => setTimeout(resolve, 5000));
           
            // Fetch current count to see actual imported records
            const finalCountResponse = await axios.get('/server/biomax_function/biomax?perPage=1&page=1');
            const finalCount = finalCountResponse.data?.data?.total || 0;
            const actuallyImported = finalCount - initialCount;
           
            console.log(`Final BioMax count: ${finalCount}, Actually imported: ${actuallyImported}`);
           
            // Show actual imported count
            if (actuallyImported > 0) {
              setImportSuccess(`Import completed! ${actuallyImported} record(s) were successfully imported (some requests timed out but data was imported).`);
            } else {
              setImportError(`Import had timeouts. Please check the database manually. Initial count: ${initialCount}, Current count: ${finalCount}`);
            }
           
            // Refresh to show imported data
            fetchBioMax();
            if (fileInputRef.current) {
              fileInputRef.current.value = '';
            }
            setImporting(false);
            return;
          } catch (countErr) {
            console.error('Error fetching final count:', countErr);
            setImportError(`Import completed with timeouts. Some records may have been imported - please check the database.`);
            fetchBioMax();
            if (fileInputRef.current) {
              fileInputRef.current.value = '';
            }
            setImporting(false);
            return;
          }
        }

        // Show results
        if (totalErrorCount > 0) {
          const errorPreview = allErrors.slice(0, 10).join('; ');
          const moreErrors = allErrors.length > 10 ? ` (and ${allErrors.length - 10} more errors)` : '';
          setImportError(`Imported ${totalSuccessCount} record(s) successfully, but ${totalErrorCount} record(s) failed. ${errorPreview}${moreErrors}`);
        } else {
          setImportSuccess(`Successfully imported ${totalSuccessCount} record(s).`);
        }

        // Refresh the data
        fetchBioMax();
       
        // Reset file input
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      } catch (err) {
        console.error('Import error:', err);
        setImportError(err.message || 'Failed to import BioMax data. Please check the file format.');
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      } finally {
        setImporting(false);
      }
    };

    reader.onerror = () => {
      setImportError('Failed to read the file.');
      setImporting(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    };

    reader.readAsArrayBuffer(file);
  }, [fetchBioMax]);

  // Handle export
  const handleExport = useCallback(() => {
    setExporting(true);
    setExportError('');
   
    try {
      const dataToExport = filteredBioMax.map(b => ({
        'Employee Code': b.employeeCode || '',
        'Employee Name': b.employeeName || '',
        'LogDate': b.logDate ? formatDateTimeForExport(b.logDate) : ''
      }));

      const ws = XLSX.utils.json_to_sheet(dataToExport);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'BioMax Data');
      XLSX.writeFile(wb, `biomax_export_${new Date().toISOString().slice(0, 10)}.xlsx`);
      setExporting(false);
    } catch (err) {
      console.error('Export error:', err);
      setExportError('Failed to export data.');
      setExporting(false);
    }
  }, [filteredBioMax]);

  // Define modules for App User
  const modulesForUser = [
    { icon: <Users size={22} />, label: 'Employees', path: '/employees' },
    { icon: <Clock3 size={22} />, label: 'Regularization', path: '/regularization' },
    { icon: <Database size={22} />, label: 'BioMax', path: '/biomax' },
    {
      icon: <FolderOpen size={22} />,
      label: 'Category',
      children: [
        { icon: <Calendar size={20} />, label: 'Attendance', path: '/attendance' },
        { icon: <Building size={20} />, label: 'Department', path: '/time' },
        { icon: <ClipboardList size={20} />, label: 'Designation', path: '/tasks' },
      ]
    },
    {
      icon: <FileText size={22} />,
      label: 'Candidate On-Boarding',
      children: [
        { icon: <FileText size={20} />, label: 'Candidate', path: '/candidate' },
        { icon: <AlertTriangle size={20} />, label: 'EHS', path: '/EHS' },
      ]
    },
    {
      icon: <Shield size={22} />,
      label: 'EHS Management',
      children: [
        { icon: <Shield size={20} />, label: 'EHS Violation', path: '/EHSViolation' },
        { icon: <AlertOctagon size={20} />, label: 'Critical Incidents', path: '/criticalincident' },
      ]
    },
    { icon: <ClipboardList size={22} />, label: 'Statutory Registers', path: '/statutoryregisters' },
    {
      icon: <BarChart3 size={22} />,
      label: 'Reports',
      children: [
        { icon: <BarChart3 size={20} />, label: 'Monthly OT', path: '/reports' },
        { icon: <FolderOpen size={20} />, label: 'Attendance Muster', path: '/attendancemuster' },
        { icon: <AlertTriangle size={20} />, label: 'Deviation', path: '/deviationrecords' },
        { icon: <AlertTriangle size={20} />, label: 'Shiftmap Deviation', path: '/shiftmapdeviation' },
      ]
    },
    { icon: <Clock3 size={22} />, label: 'LOH', path: '/loh-report' },
    {
      icon: <CalendarDays size={22} />,
      label: 'Leave',
      children: [
        { icon: <Clock size={20} />, label: 'On Duty', path: '/onduty' },
        { icon: <Clock3 size={20} />, label: 'Grace', path: '/grace' },
        { icon: <Clock size={20} />, label: 'Comp Off', path: '/compoff' },
        { icon: <Calendar size={20} />, label: 'Calendar', path: '/calendar' },
      ]
    },
  ];

  // Define all modules for App Administrator
  const allModules = [
    { icon: <HomeIcon size={22} />, label: 'Home', path: '/' },
    { icon: <LayoutDashboard size={22} />, label: 'Dashboard', path: '/dashboard' },
    { icon: <Landmark size={22} />, label: 'Organization', path: '/organization' },
    { icon: <Handshake size={22} />, label: 'Contractors', path: '/contracters' },
    { icon: <Users size={22} />, label: 'Employees', path: '/employees' },
    { icon: <Clock3 size={22} />, label: 'Regularization', path: '/regularization' },
    { icon: <Database size={22} />, label: 'BioMax', path: '/biomax' },
    {
      icon: <FileText size={22} />,
      label: 'Candidate Onboarding & Induction',
      children: [
        { icon: <FileText size={20} />, label: 'Candidate', path: '/candidate' },
        { icon: <AlertTriangle size={20} />, label: 'EHS', path: '/EHS' },
      ]
    },
    {
      icon: <FolderOpen size={22} />,
      label: 'Category',
      children: [
        { icon: <Calendar size={20} />, label: 'Attendance', path: '/attendance' },
        { icon: <Building size={20} />, label: 'Department', path: '/time' },
        { icon: <ClipboardList size={20} />, label: 'Designation', path: '/tasks' },
      ]
    },
    {
      icon: <Shield size={22} />,
      label: 'EHS Management',
      children: [
        { icon: <Shield size={20} />, label: 'EHS Violation', path: '/EHSViolation' },
        { icon: <AlertOctagon size={20} />, label: 'Critical Incidents', path: '/criticalincident' },
      ]
    },
    { icon: <ClipboardList size={22} />, label: 'Statutory Registers', path: '/statutoryregisters' },
    { icon: <BarChart3 size={22} />, label: 'Payroll', path: '/payroll' },
    {
      icon: <Clock size={22} />,
      label: 'Shift',
      children: [
        { icon: <Clock size={20} />, label: 'Shift', path: '/shift' },
        { icon: <CalendarDays size={20} />, label: 'Shift Roaster', path: '/newshiftmap' },
      ]
    },
    { icon: <Clock3 size={22} />, label: 'LOH', path: '/loh-report' },
    {
      icon: <CalendarDays size={22} />,
      label: 'Leave',
      children: [
        { icon: <Clock size={20} />, label: 'On Duty', path: '/onduty' },
        { icon: <Clock3 size={20} />, label: 'Grace', path: '/grace' },
        { icon: <Clock size={20} />, label: 'Comp Off', path: '/compoff' },
        { icon: <Calendar size={20} />, label: 'Calendar', path: '/calendar' },
      ]
    },
    {
      icon: <BarChart3 size={22} />,
      label: 'Reports',
      children: [
        { icon: <BarChart3 size={20} />, label: 'Monthly OT', path: '/reports' },
        { icon: <FolderOpen size={20} />, label: 'Attendance Muster', path: '/attendancemuster' },
        { icon: <AlertTriangle size={20} />, label: 'Deviation', path: '/deviationrecords' },
        { icon: <AlertTriangle size={20} />, label: 'Shiftmap Deviation', path: '/shiftmapdeviation' },
      ]
    },
  ];

  const modulesToShow = useMemo(() => {
    if (userRole !== 'App Administrator') return modulesForUser;
    if (!isHideDashboardAndSetupUser(userEmail)) return allModules;
    return allModules.filter((m) => m.path !== '/dashboard' && m.label !== 'Dashboard');
  }, [userRole, userEmail]);

  // Create dynamic columns array
  const dynamicColumns = useMemo(() => {
    if (selectedBioMax.length === 0) {
      return columns.filter(col => col.label !== 'Edit');
    }
    return columns;
  }, [selectedBioMax.length]);

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
  const recentActivities = [
    { icon: '📊', title: 'New BioMax Record', description: 'A new BioMax record has been added', time: '2 minutes ago' },
    { icon: '📝', title: 'BioMax Updated', description: 'BioMax record has been updated', time: '5 minutes ago' },
  ];

  return (
    <>
      <style>
        {`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}
      </style>
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

          {/* BioMax Management Content */}
          <main className="cms-dashboard-content">
            <div className="biomax-card-container">
              {/* Header and Toolbar */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
                <div className="biomax-header-actions">
                  <div className="biomax-title-section">
                    <h2 className="biomax-title">
                      <Database size={28} />
                      BioMax Data Store
                    </h2>
                    <p className="biomax-subtitle">
                      Manage BioMax records efficiently
                    </p>
                  </div>
                </div>
                {/* Toolbar Buttons */}
                <div className="biomax-toolbar" style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'nowrap' }}>
                  <button
                    className="toolbar-btn export-btn"
                    onClick={handleExport}
                    disabled={exporting}
                    title="Export BioMax data to Excel"
                    type="button"
                    style={{ background: '#fff', color: '#22c55e', border: 'none', fontWeight: 600, padding: '8px', borderRadius: '8px', width: '48px', height: '48px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}
                  >
                    <FileOutput size={22} style={{ color: '#22c55e' }} />
                  </button>
                  <button
                    className="toolbar-btn import-btn"
                    onClick={() => fileInputRef.current.click()}
                    disabled={importing}
                    title="Import BioMax data from Excel"
                    type="button"
                    style={{ background: '#fff', color: '#2563eb', border: 'none', fontWeight: 600, padding: '8px', borderRadius: '8px', width: '48px', height: '48px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}
                  >
                    {importing ? (
                      <div className="loader-xs" style={{ margin: '0 auto' }}></div>
                    ) : (
                      <FileInput size={22} style={{ color: '#2563eb' }} />
                    )}
                  </button>
                  <input
                    type="file"
                    ref={fileInputRef}
                    style={{ display: 'none' }}
                    accept=".xlsx, .xls"
                    onChange={handleImport}
                  />
                  <button
                    className="biomax-fab"
                    onClick={() => {
                      resetForm();
                      setShowForm(true);
                    }}
                    title="Add new BioMax record"
                    style={{ background: '#2563eb', color: '#fff', border: 'none', fontWeight: 600, padding: '8px', borderRadius: '8px', width: '48px', height: '48px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(37,99,235,0.3)' }}
                  >
                    <Plus size={24} style={{ color: '#fff' }} />
                  </button>
                </div>
              </div>

              {/* Error Messages */}
              {fetchError && (
                <div style={{ padding: '12px', background: '#ffebee', color: '#c62828', borderRadius: '8px', marginBottom: '16px' }}>
                  {fetchError}
                </div>
              )}
              {importError && (
                <div style={{ padding: '12px', background: '#ffebee', color: '#c62828', borderRadius: '8px', marginBottom: '16px' }}>
                  {importError}
                </div>
              )}
              {importSuccess && (
                <div style={{ padding: '12px', background: '#e8f5e9', color: '#2e7d32', borderRadius: '8px', marginBottom: '16px' }}>
                  {importSuccess}
                </div>
              )}
              {massDeleteError && (
                <div style={{ padding: '12px', background: '#ffebee', color: '#c62828', borderRadius: '8px', marginBottom: '16px' }}>
                  {massDeleteError}
                </div>
              )}

              {/* Bulk Actions */}
              {selectedBioMax.length > 0 && !showForm && (
                <div style={{ marginBottom: '16px', padding: '12px', background: '#e3f2fd', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span>{selectedBioMax.length} record(s) selected</span>
                  <button
                    onClick={handleDeleteMultiple}
                    disabled={deletingMultiple}
                    style={{ padding: '8px 16px', background: '#f44336', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
                  >
                    {deletingMultiple ? 'Deleting...' : 'Delete Selected'}
                  </button>
                </div>
              )}

              {/* BioMax Form - Display above table when open */}
              {showForm && (
                <div className="employee-form-page">
                  <div className="employee-form-container">
                    <div className="employee-form-header">
                      <h1 style={{ paddingLeft: '20px' }}>
                        {isEditing ? 'Edit BioMax Record' : 'Add New BioMax Record'}
                      </h1>
                      <button
                        className="close-btn"
                        onClick={() => {
                          setShowForm(false);
                          resetForm();
                        }}
                        title="Close form"
                      >
                        <i className="fas fa-times"></i>
                      </button>
                    </div>
                    <div className="employee-form-content">
                      <form onSubmit={handleSubmit} className="biomax-form">
                        {/* Error Messages */}
                        {formError && (
                          <div style={{ padding: '12px', background: '#ffebee', color: '#c62828', borderRadius: '8px', marginBottom: '16px' }}>
                            {formError}
                          </div>
                        )}
                       
                        <div className="employee-form-card">
                          {/* BioMax Info Card */}
                          <div className="form-section-card employee-info">
                            <h2 className="section-title">BioMax Info</h2>
                            <div className="form-grid">
                              <div className="form-group">
                                <label>Employee Code *</label>
                                <input
                                  className="input"
                                  type="text"
                                  name="employeeCode"
                                  value={form.employeeCode}
                                  onChange={(e) => setForm(prev => ({ ...prev, employeeCode: e.target.value }))}
                                  required
                                />
                              </div>
                              <div className="form-group">
                                <label>Employee Name *</label>
                                <input
                                  className="input"
                                  type="text"
                                  name="employeeName"
                                  value={form.employeeName}
                                  onChange={(e) => setForm(prev => ({ ...prev, employeeName: e.target.value }))}
                                  required
                                />
                              </div>
                              <div className="form-group">
                                <label>Log Date & Time *</label>
                                <input
                                  className="input"
                                  type="datetime-local"
                                  name="logDate"
                                  value={form.logDate}
                                  onChange={(e) => setForm(prev => ({ ...prev, logDate: e.target.value }))}
                                  required
                                  placeholder="YYYY-MM-DD HH:MM"
                                />
                                <small style={{ color: '#666', fontSize: '12px', display: 'block', marginTop: '4px' }}>
                                  Format: YYYY-MM-DD HH:MM (e.g., 2025-10-28 08:28)
                                </small>
                              </div>
                            </div>
                          </div>
                        </div>
                       
                        {/* Form Actions */}
                        <div className="form-actions">
                          <button
                            type="button"
                            onClick={() => {
                              setShowForm(false);
                              resetForm();
                            }}
                            className="btn btn-danger"
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            disabled={submitting}
                            className="btn btn-primary"
                          >
                            {submitting ? 'Saving...' : (isEditing ? 'Update' : 'Save')}
                          </button>
                        </div>
                      </form>
                    </div>
                  </div>
                </div>
              )}

              {/* Table - Only show when form is closed */}
              {!showForm && (
              <>
              {/* Table */}
              <div className="biomax-table-container">
                {fetchState === 'loading' && (
                  <div style={{ textAlign: 'center', padding: '40px' }}>
                    <div className="loader-lg" style={{ margin: '0 auto' }}></div>
                    <p>Loading BioMax data...</p>
                  </div>
                )}
                {fetchState === 'error' && (
                  <div style={{ textAlign: 'center', padding: '40px', color: '#c62828' }}>
                    <p>Failed to load BioMax data. Please try again.</p>
                  </div>
                )}
                {fetchState === 'success' && (
                  <table className={`biomax-table ${selectedBioMax.length === 0 ? 'edit-column-hidden' : ''}`}>
                    <thead>
                      <tr>
                        {dynamicColumns.map((col, idx) => (
                          <th key={idx}>{col.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredBioMax.length === 0 ? (
                        <tr>
                          <td colSpan={dynamicColumns.length} style={{ textAlign: 'center', padding: '40px' }}>
                            No BioMax records found.
                          </td>
                        </tr>
                      ) : (
                        filteredBioMax.map((biomax, index) => (
                          <BioMaxRow
                            key={biomax.id}
                            biomax={biomax}
                            index={index}
                            removeBioMax={removeBioMax}
                            editBioMax={editBioMax}
                            isSelected={selectedBioMax.includes(biomax.id)}
                            onSelect={handleSelect}
                            selectedBioMax={selectedBioMax}
                          />
                        ))
                      )}
                    </tbody>
                  </table>
                )}
              </div>
              </>
              )}

              {/* Pagination - Hidden when showing all data */}
              {!showAll && totalPages > 1 && !showForm && (
                <div style={{ marginTop: '24px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '12px' }}>
                  <button
                    onClick={() => setPage(prev => Math.max(1, prev - 1))}
                    disabled={page === 1}
                    style={{ padding: '8px 16px', background: '#2196f3', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
                  >
                    Previous
                  </button>
                  <span>Page {page} of {totalPages}</span>
                  <button
                    onClick={() => setPage(prev => Math.min(totalPages, prev + 1))}
                    disabled={page === totalPages}
                    style={{ padding: '8px 16px', background: '#2196f3', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
                  >
                    Next
                  </button>
                </div>
              )}
             
              {/* Show total count when displaying all data */}
              {showAll && totalBioMax > 0 && !showForm && (
                <div style={{ marginTop: '24px', textAlign: 'center', color: '#666', fontSize: '14px' }}>
                  Showing all {totalBioMax} record(s)
                </div>
              )}
            </div>
          </main>
        </div>
      </div>
    </>
  );
}

export default BioMax;
