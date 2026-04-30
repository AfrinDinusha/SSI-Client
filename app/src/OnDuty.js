import './App.css';
import './helper.css';
import './onduty.css';
import axios from 'axios';
import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import { Link } from 'react-router-dom';
import HeaderBranding from './HeaderBranding';

import Button from './Button';
import { getSidebarModulesForUser, resolveSidebarUserEmail } from './modulesConfig';
import {
  Users, Calendar, FileText, AlertTriangle, FolderOpen,
  ClipboardList, Building, Handshake, Landmark, Clock,
  Map, BarChart3, User, TrendingUp, TrendingDown,
  Activity, Plus, CheckCircle, Bell, Settings, LayoutDashboard, Home as HomeIcon,
  Shield, AlertOctagon, CreditCard, FileSignature, Search, Clock3, CalendarDays, Database,
  FileInput, FileOutput, RefreshCw, Trash2
} from 'lucide-react';

// Helper function to convert Excel serial date to YYYY-MM-DD format
// Uses UTC to avoid timezone shifts
function excelSerialToDate(serial) {
  // Excel serial date: number of days since January 1, 1900
  // Excel serial 1 = January 1, 1900
  // Excel incorrectly treats 1900 as a leap year
 
  // Round the serial number to handle any fractional parts (time components)
  const serialRounded = Math.round(serial);
 
  // Standard Excel serial date conversion formula:
  // Offset from Unix epoch (1970-01-01) to Excel epoch accounting for bug = -25569
  // Formula: date = new Date((serial - 25569) * 86400000)
  const millisecondsPerDay = 24 * 60 * 60 * 1000;
 
  // Use the standard formula
  const dateMs = (serialRounded - 25569) * millisecondsPerDay;
  const date = new Date(dateMs);
 
  // Extract date components at UTC to avoid timezone shifts
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
 
  // Format as YYYY-MM-DD
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// Helper function to convert YYYY-MM-DD to DD-MM-YYYY
function formatDateToDDMMYYYY(dateStr) {
  if (!dateStr) return '';
  // If already in DD-MM-YYYY format, return as is
  if (/^\d{2}-\d{2}-\d{4}$/.test(dateStr)) return dateStr;
  // If in YYYY-MM-DD format, convert to DD-MM-YYYY
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    const [year, month, day] = dateStr.split('-');
    return `${day}-${month}-${year}`;
  }
  // Try to parse and convert
  try {
    const date = new Date(dateStr);
    if (!isNaN(date.getTime())) {
      const day = String(date.getDate()).padStart(2, '0');
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const year = date.getFullYear();
      return `${day}-${month}-${year}`;
    }
  } catch (e) {
    // If parsing fails, return as is
  }
  return dateStr;
}

// Helper function to convert DD-MM-YYYY to YYYY-MM-DD
function convertDDMMYYYYToYYYYMMDD(dateStr) {
  if (!dateStr) return '';
  // If already in YYYY-MM-DD format, return as is
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  // If in DD-MM-YYYY format, convert to YYYY-MM-DD
  const dmy = dateStr.match(/^(\d{2})[-\/.](\d{2})[-\/.](\d{4})$/);
  if (dmy) {
    const [, day, month, year] = dmy;
    return `${year}-${month}-${day}`;
  }
  return dateStr;
}

// Helper function to format date
function formatDate(dateStr) {
  if (!dateStr) return '-';
 
  // Check if it's an Excel serial date (numeric string or number)
  const numValue = Number(dateStr);
  if (!isNaN(numValue) && numValue > 0 && numValue < 1000000) {
    // Likely an Excel serial date
    try {
      return excelSerialToDate(numValue);
    } catch (e) {
      console.error('Error converting Excel serial date:', e);
      return String(dateStr);
    }
  }
 
  // If it's already a date string in YYYY-MM-DD format, return it
  if (typeof dateStr === 'string' && /^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
    return dateStr.slice(0, 10);
  }
 
  // Try to parse as a date
  try {
    const date = new Date(dateStr);
    if (!isNaN(date.getTime())) {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
  } catch (e) {
    // If parsing fails, return as is
  }
 
  return String(dateStr).slice(0, 10);
}

// Helper function to extract time from datetime string (HH:mm format)
function formatTime(datetimeStr) {
  if (!datetimeStr) return '-';
  const str = String(datetimeStr).trim();
 
  // If it's already just time (HH:mm or HH:mm:ss), return it
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(str)) {
    return str.slice(0, 5); // Return HH:mm
  }
 
  // If it's a datetime string (YYYY-MM-DD HH:mm:ss), extract time part
  const datetimeMatch = str.match(/^\d{4}-\d{2}-\d{2}\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (datetimeMatch) {
    const hours = datetimeMatch[1].padStart(2, '0');
    const minutes = datetimeMatch[2];
    return `${hours}:${minutes}`;
  }
 
  // Try to parse as Date and extract time
  try {
    const date = new Date(str);
    if (!isNaN(date.getTime())) {
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      return `${hours}:${minutes}`;
    }
  } catch (e) {
    // If parsing fails, return as is
  }
 
  return str;
}

// OnDuty Row Component
function OnDutyRow({ onduty, index, removeOnDuty, editOnDuty, isSelected, onSelect, selectedOnDuties }) {
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const deleteOnDuty = useCallback((e) => {
    e.stopPropagation();
    setDeleting(true);
    setDeleteError('');
    axios
      .delete(`/server/onduty_function/onduty/${onduty.id}`, { timeout: 5000 })
      .then(() => {
        removeOnDuty(onduty.id);
      })
      .catch((err) => {
        const errorMessage = err.response?.data?.message || `Failed to delete on duty record (ID: ${onduty.id}).`;
        setDeleteError(errorMessage);
        console.error('Delete on duty error:', err);
      })
      .finally(() => setDeleting(false));
  }, [onduty.id, removeOnDuty]);

  const handleRowClick = useCallback(() => {
    editOnDuty(onduty);
  }, [editOnDuty, onduty]);

  const handleCheckboxClick = useCallback((e) => {
    e.stopPropagation();
    onSelect(onduty.id);
  }, [onSelect, onduty.id]);

  const handleEditButtonClick = useCallback((e) => {
    e.stopPropagation();
    editOnDuty(onduty);
  }, [editOnDuty, onduty]);

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
      {selectedOnDuties.length > 0 && (
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
      <td>{onduty.employeeCode || '-'}</td>
      <td>{onduty.employeeName || '-'}</td>
      <td>{onduty.noofHours || '-'}</td>
      <td>{onduty.reason || '-'}</td>
      <td>{onduty.onDutyDate ? formatDate(onduty.onDutyDate) : '-'}</td>
      <td>{formatTime(onduty.firstIn)}</td>
      <td>{formatTime(onduty.lastOut)}</td>
      <td>{onduty.addedUser || '-'}</td>
      <td>{onduty.modifiedUser || '-'}</td>
      <td>{onduty.addedTime ? String(onduty.addedTime).replace('T', ' ').slice(0, 19) : '-'}</td>
      <td>{onduty.modifiedTime ? String(onduty.modifiedTime).replace('T', ' ').slice(0, 19) : '-'}</td>
    </tr>
  );
}

// OnDuty Management Component
function OnDutyManagement({ userRole = 'App Administrator', userEmail = null }) {
  const [onduties, setOnDuties] = useState([]);
  const [filteredOnDuties, setFilteredOnDuties] = useState([]);
  const [fetchState, setFetchState] = useState('init');
  const [fetchError, setFetchError] = useState('');
  const [selectedOnDuties, setSelectedOnDuties] = useState([]);
  const [deletingMultiple, setDeletingMultiple] = useState(false);
  const [massDeleteError, setMassDeleteError] = useState('');
 
  const allSelected = filteredOnDuties.length > 0 && selectedOnDuties.length === filteredOnDuties.length;
  const someSelected = selectedOnDuties.length > 0 && selectedOnDuties.length < filteredOnDuties.length;
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importError, setImportError] = useState('');
  const [exportError, setExportError] = useState('');
  const fileInputRef = useRef(null);
  const [employeeLookupList, setEmployeeLookupList] = useState([]);
  const [employeeLookupLoading, setEmployeeLookupLoading] = useState(false);
  const employeeCodeLookupTimerRef = useRef(null);
 
  // Pagination state
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(50);
  const [totalPages, setTotalPages] = useState(1);
  const [totalOnDuties, setTotalOnDuties] = useState(0);
  const [showAll, setShowAll] = useState(false);

  const [form, setForm] = useState({
    employeeCode: '',
    employeeName: '',
    noofHours: '',
    reason: '',
    onDutyDate: '',
    firstIn: '',
    lastOut: '',
  });
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editingOnDutyId, setEditingOnDutyId] = useState(null);

  // Fetch on duties with pagination
  const fetchOnDuties = useCallback(() => {
    setFetchState('loading');
    setFetchError('');
   
    const params = showAll ? {} : { page, perPage };
   
    if (userRole && userEmail) {
      params.userRole = userRole;
      params.userEmail = userEmail;
    }
   
    axios
      .get('/server/onduty_function/onduty', { params, timeout: 5000 })
      .then((response) => {
        if (!response?.data?.data?.onduties) {
          throw new Error('Unexpected API response structure');
        }
        let fetchedOnDuties = response.data.data.onduties || [];
        if (!Array.isArray(fetchedOnDuties)) {
          throw new Error('OnDuty data is not an array');
        }

        setOnDuties(fetchedOnDuties);
        setFilteredOnDuties(fetchedOnDuties);

        const codesNeedingName = [...new Set(
          fetchedOnDuties
            .filter((c) => (c.employeeCode || '').toString().trim() && !(c.employeeName || '').toString().trim())
            .map((c) => (c.employeeCode || '').toString().trim())
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
              const enriched = fetchedOnDuties.map((c) => {
                const code = (c.employeeCode || '').toString().trim();
                const name = (c.employeeName || '').toString().trim();
                if (code && !name && codeToName[code]) {
                  return { ...c, employeeName: codeToName[code] };
                }
                return c;
              });
              setOnDuties(enriched);
              setFilteredOnDuties(enriched);
            })
            .catch(() => {});
        }

        const hasMore = response.data.data.hasMore;
        const total = response.data.data.total || 0;
        setTotalOnDuties(total);
        if (total && perPage && !showAll) {
          setTotalPages(Math.ceil(total / perPage));
        } else {
          setTotalPages(hasMore ? page + 1 : page);
        }
        setFetchState('fetched');
      })
      .catch((err) => {
        const errorMessage = err.response?.data?.message || 'Failed to fetch on duty records. Please try again later.';
        setFetchError(errorMessage);
        setFetchState('error');
        console.error('Fetch on duty error:', err);
      });
  }, [page, perPage, showAll, userRole, userEmail]);

  useEffect(() => {
    fetchOnDuties();
  }, [fetchOnDuties]);

  const columns = [
    { label: 'Select', field: null },
    { label: 'Edit', field: null },
    { label: '#', field: null },
    { label: 'Employee Code', field: 'employeeCode' },
    { label: 'Employee Name', field: 'employeeName' },
    { label: 'No of Hours', field: 'noofHours' },
    { label: 'Reason', field: 'reason' },
    { label: 'On Duty Date', field: 'onDutyDate' },
    { label: 'First In', field: 'firstIn' },
    { label: 'Last Out', field: 'lastOut' },
    { label: 'Added User', field: 'addedUser' },
    { label: 'Modified User', field: 'modifiedUser' },
    { label: 'Added Time', field: 'addedTime' },
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
      .catch((err) => {
        console.error('On Duty: fetch employees for lookup failed', err);
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

  // Validate on duty data (similar to validateForm but for imports)
  // Employee Name is optional for imports
  const validateImportedOnDuty = useCallback((onduty, rowIndex) => {
    const errors = [];
    if (!onduty.employeeCode) errors.push('Employee Code is required.');
    // Employee Name is optional for imports - removed validation
    if (errors.length > 0) {
      return `Row ${rowIndex}: ${errors.join(', ')}`;
    }
    return null;
  }, []);

  // Import Excel file
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
    const maxSize = 5 * 1024 * 1024; // 5MB
    if (file.size > maxSize) {
      setImportError('File size exceeds 5MB limit.');
      return;
    }

    setImporting(true);
    setImportError('');

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        // Read with cellText enabled to get formatted display values
        // Don't use cellDates to avoid timezone issues - we'll handle dates manually
        const workbook = XLSX.read(data, { type: 'array', cellDates: false, cellNF: true, cellText: true });
        const sheetName = workbook.SheetNames[0];
        if (!sheetName) {
          throw new Error('No sheets found in the Excel file.');
        }
        const worksheet = workbook.Sheets[sheetName];
        // Get text values first to preserve original date formats (formatted display values)
        const jsonDataText = XLSX.utils.sheet_to_json(worksheet, { raw: false, defval: '' });
        // Also get raw values for Excel serial dates
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { raw: true, defval: '' });

        if (!jsonData || jsonData.length === 0) {
          throw new Error('No data found in the Excel file.');
        }

        // Track employee codes to detect duplicates within the file
        const employeeCodes = new Set();
        const duplicateCodes = new Set();

        // First pass: identify duplicates
        jsonData.forEach((row, index) => {
          const employeeCode = row['Employee Code'] ? String(row['Employee Code']).trim() : '';
          if (employeeCode) {
            if (employeeCodes.has(employeeCode)) {
              duplicateCodes.add(employeeCode);
            } else {
              employeeCodes.add(employeeCode);
            }
          }
        });

        // Log duplicate codes summary
        if (duplicateCodes.size > 0) {
          console.warn(`Found ${duplicateCodes.size} duplicate Employee Code(s) in file:`, Array.from(duplicateCodes));
        }

        // Helper function to get cell text value directly from worksheet
        const getCellText = (cellAddress) => {
          if (!cellAddress) return null;
          const cell = worksheet[cellAddress];
          if (!cell) return null;
         
          // Priority: formatted text (w) - this is what Excel displays
          if (cell.w && typeof cell.w === 'string') {
            // Check if it's already a formatted date string (not a serial number string)
            const isSerialNumberString = /^\d+\.?\d*$/.test(cell.w.trim());
            if (!isSerialNumberString) {
              return cell.w;
            }
            // If it's a serial number string, we'll format it below
          }
         
          // If cell has a format code and it's a date format, try to format it using SSF
          if (cell.z && typeof cell.v === 'number') {
            // Check if format code suggests it's a date (contains d, m, y, or common date formats)
            const formatCode = cell.z.toLowerCase();
            const isDateFormat = formatCode.includes('d') || formatCode.includes('m') || formatCode.includes('y') ||
                                 formatCode.includes('dd') || formatCode.includes('mm') || formatCode.includes('yyyy') ||
                                 formatCode.includes('mm/dd') || formatCode.includes('dd/mm');
           
            if (isDateFormat) {
              try {
                // Use XLSX's SSF (Spreadsheet Format) to format the date
                // SSF is available in XLSX library
                if (typeof XLSX.SSF !== 'undefined' && XLSX.SSF && typeof XLSX.SSF.format === 'function') {
                  const formatted = XLSX.SSF.format(cell.z, cell.v);
                  if (formatted && formatted !== cell.v.toString() && !/^\d+\.?\d*$/.test(formatted.trim())) {
                    console.log(`[Cell ${cellAddress}] Formatted date using SSF: "${cell.v}" (${cell.z}) -> "${formatted}"`);
                    return formatted;
                  }
                }
              } catch (e) {
                console.warn(`[Cell ${cellAddress}] Error formatting with SSF:`, e);
              }
            }
          }
         
          // If raw value is a number (Excel serial date), return null so we can convert it
          if (typeof cell.v === 'number') {
            return null;
          }
         
          // Return string value
          if (cell.v !== undefined && cell.v !== null) {
            return String(cell.v);
          }
         
          return null;
        };

        // Find the column index for "On Duty Date"
        const findColumnIndex = (headerName) => {
          const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
          for (let col = range.s.c; col <= range.e.c; col++) {
            const cellAddress = XLSX.utils.encode_cell({ r: 0, c: col });
            const cell = worksheet[cellAddress];
            if (cell && (cell.v === headerName || cell.w === headerName)) {
              return col;
            }
          }
          return -1;
        };

        const onDutyDateColIndex = findColumnIndex('On Duty Date');

        const newOnDuties = jsonData.map((row, index) => {
          // Get corresponding text row for date values
          const textRow = jsonDataText[index] || {};
         
          // Try to get the cell's text value directly for "On Duty Date"
          let onDutyDateText = textRow['On Duty Date'];
          let onDutyDateRaw = row['On Duty Date'];
         
          if (onDutyDateColIndex >= 0) {
            const cellAddress = XLSX.utils.encode_cell({ r: index + 1, c: onDutyDateColIndex });
            const cell = worksheet[cellAddress];
            const directCellText = getCellText(cellAddress);
           
            if (directCellText) {
              console.log(`[Import Row ${index + 2}] On Duty Date - Direct cell text: "${directCellText}", Text row value: "${onDutyDateText}", Raw value: "${onDutyDateRaw}"`);
              onDutyDateText = directCellText;
            } else {
              // If getCellText returns null, check if cell has a numeric value (Excel serial date)
              if (cell && typeof cell.v === 'number') {
                onDutyDateRaw = cell.v;
                console.log(`[Import Row ${index + 2}] On Duty Date - Cell has numeric value (serial date): ${onDutyDateRaw}, Text row: "${onDutyDateText}"`);
              } else {
                console.log(`[Import Row ${index + 2}] On Duty Date - No direct cell text, using text row: "${onDutyDateText}", Raw value: "${onDutyDateRaw}"`);
              }
            }
          }
         
          const safeToString = (value) => {
            if (value == null || value === '') return '';
            return String(value).trim();
          };

          // Helper function to convert date value to YYYY-MM-DD format
          // Accepts DD-MM-YYYY, YYYY-MM-DD, Excel serial dates, and Date objects
          const convertDateValue = (value, textValue = null) => {
            if (value == null || value === '') return '';
           
            // ALWAYS prioritize text value first to preserve original format from Excel
            if (textValue != null && textValue !== '') {
              const textStr = String(textValue).trim();
             
              // Check if text value is a pure number (Excel serial date as string)
              // If it's a number between 1 and 1000000, it's likely an Excel serial date
              const textAsNumber = Number(textStr);
              if (!isNaN(textAsNumber) && textAsNumber > 0 && textAsNumber < 1000000 && /^\d+$/.test(textStr)) {
                // This is an Excel serial date stored as a string
                try {
                  const result = excelSerialToDate(textAsNumber);
                  console.log(`[Import Row ${index + 2}] Converted Excel serial date from text "${textStr}" -> "${result}"`);
                  return result;
                } catch (e) {
                  console.error(`[Import Row ${index + 2}] Error converting serial date from text "${textStr}":`, e);
                  // Fall through to try other methods
                }
              }
             
              // Check if it's in DD-MM-YYYY format (for OnDuty import) - this is the most common case
              const dmy = textStr.match(/^(\d{2})[-\/.](\d{2})[-\/.](\d{4})$/);
              if (dmy) {
                const [, day, month, year] = dmy;
                const result = `${year}-${month}-${day}`;
                console.log(`[Import Row ${index + 2}] Parsed date from text "${textStr}" -> "${result}"`);
                return result;
              }
             
              // Check for DD/MM/YYYY format
              const dmySlash = textStr.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
              if (dmySlash) {
                const [, day, month, year] = dmySlash;
                const result = `${year}-${month}-${day}`;
                console.log(`[Import Row ${index + 2}] Parsed date from text "${textStr}" -> "${result}"`);
                return result;
              }
             
              // If it's already in YYYY-MM-DD format, return it
              if (/^\d{4}-\d{2}-\d{2}/.test(textStr)) {
                const result = textStr.slice(0, 10);
                console.log(`[Import Row ${index + 2}] Date already in YYYY-MM-DD format: "${result}"`);
                return result;
              }
             
              // Try to parse Excel formatted date strings (e.g., "14-Dec-2025", "14/12/2025")
              // Excel might format dates differently, so try common patterns
              const excelDateMatch = textStr.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})$/);
              if (excelDateMatch) {
                const [, day, month, year] = excelDateMatch;
                const result = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                console.log(`[Import Row ${index + 2}] Parsed Excel date from text "${textStr}" -> "${result}"`);
                return result;
              }
             
              console.log(`[Import Row ${index + 2}] Text value "${textStr}" didn't match date patterns, trying raw value`);
            }
           
            // If no text value or text value didn't match, check the raw value
            const strValue = String(value).trim();
           
            // If it's already in YYYY-MM-DD format, return it
            if (/^\d{4}-\d{2}-\d{2}/.test(strValue)) {
              return strValue.slice(0, 10);
            }
           
            // Check if it's in DD-MM-YYYY format
            const dmy = strValue.match(/^(\d{2})[-\/.](\d{2})[-\/.](\d{4})$/);
            if (dmy) {
              const [, day, month, year] = dmy;
              return `${year}-${month}-${day}`;
            }
           
            // Check if it's an Excel serial date (numeric) - this happens when Excel stores dates as numbers
            const numValue = Number(value);
            if (!isNaN(numValue) && numValue > 0 && numValue < 1000000) {
              try {
                // Use our Excel serial date converter
                const result = excelSerialToDate(numValue);
                console.log(`[Import Row ${index + 2}] Converted Excel serial date ${numValue} -> "${result}"`);
                return result;
              } catch (e) {
                console.error(`[Import Row ${index + 2}] Error converting Excel serial date ${numValue}:`, e);
                return strValue;
              }
            }
           
            // If it's a Date object (shouldn't happen with cellDates: false, but handle it)
            if (value instanceof Date) {
              // Use local date components to avoid timezone issues
              const year = value.getFullYear();
              const month = String(value.getMonth() + 1).padStart(2, '0');
              const day = String(value.getDate()).padStart(2, '0');
              return `${year}-${month}-${day}`;
            }
           
            // Last resort: return as string
            return strValue;
          };

          // Helper function to convert Excel time values to HH:mm format
          const convertTimeValue = (value) => {
            if (value == null || value === '') return '';
           
            // If it's already a string in HH:mm or HH:mm:ss format, return just HH:mm
            if (typeof value === 'string') {
              const str = value.trim();
              // Match HH:mm or HH:mm:ss format
              const timeMatch = str.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
              if (timeMatch) {
                return `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}`;
              }
            }
           
            // If it's a Date object (from Excel datetime)
            if (value instanceof Date) {
              const hours = String(value.getHours()).padStart(2, '0');
              const minutes = String(value.getMinutes()).padStart(2, '0');
              return `${hours}:${minutes}`;
            }
           
            // If it's a number (Excel serial time - fractional day)
            const numValue = Number(value);
            if (!isNaN(numValue) && numValue >= 0 && numValue < 1) {
              // Excel time is a fractional day (0.0 to 0.999...)
              const totalSeconds = Math.round(numValue * 24 * 60 * 60);
              const hours = Math.floor(totalSeconds / 3600);
              const minutes = Math.floor((totalSeconds % 3600) / 60);
              return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
            }
           
            // Try to parse as a date string and extract time
            try {
              const date = new Date(value);
              if (!isNaN(date.getTime())) {
                const hours = String(date.getHours()).padStart(2, '0');
                const minutes = String(date.getMinutes()).padStart(2, '0');
                return `${hours}:${minutes}`;
              }
            } catch (e) {
              // If parsing fails, continue
            }
           
            // Fallback: return as string, but try to extract time if it looks like a datetime string
            const str = String(value).trim();
            const datetimeMatch = str.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
            if (datetimeMatch) {
              return `${datetimeMatch[1].padStart(2, '0')}:${datetimeMatch[2]}`;
            }
           
            return str;
          };

          // Ensure we have a raw value to convert (prefer numeric if available)
          const onDutyDateValue = (typeof onDutyDateRaw === 'number') ? onDutyDateRaw : (row['On Duty Date'] !== undefined ? row['On Duty Date'] : null);
          const onDutyDateTextValue = onDutyDateText || textRow['On Duty Date'] || null;
         
          const onduty = {
            employeeCode: safeToString(row['Employee Code']),
            employeeName: safeToString(row['Employee Name']),
            noofHours: safeToString(row['No of Hours']),
            reason: safeToString(row['Reason']),
            onDutyDate: convertDateValue(onDutyDateValue, onDutyDateTextValue),
            firstIn: convertTimeValue(row['First In']),
            lastOut: convertTimeValue(row['Last Out']),
          };

          // Note: Duplicate employee codes are allowed - all records will be imported
          // Log duplicate codes for informational purposes only
          if (onduty.employeeCode && duplicateCodes.has(onduty.employeeCode)) {
            console.log(`Row ${index + 2}: Duplicate Employee Code '${onduty.employeeCode}' found in file. Record will still be imported.`);
          }

          const validationError = validateImportedOnDuty(onduty, index + 2);
          if (validationError) {
            console.error(`Row ${index + 2} validation error:`, validationError);
            throw new Error(validationError);
          }

          return onduty;
        });

        // Fetch correct employee names from system for every row that has Employee Code (same as Comp Off)
        const allCodes = [...new Set(
          newOnDuties
            .map((c) => (c.employeeCode || '').toString().trim())
            .filter(Boolean)
        )];
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
            newOnDuties.forEach((onduty) => {
              const code = (onduty.employeeCode || '').toString().trim();
              if (code && codeToName[code]) {
                onduty.employeeName = codeToName[code];
              }
            });
          } catch (err) {
            console.warn('Could not fetch employee names during on duty import:', err);
          }
        }

        // Check for existing records in database (optional - you can skip this if you want to allow duplicates)
        console.log('Importing on duty records...');

        // Batch size for inserting records
        const BATCH_SIZE = 100;
        const totalRecords = newOnDuties.length;
        const totalBatches = Math.ceil(totalRecords / BATCH_SIZE);
       
        const results = [];
        let successfulImports = 0;
        let failedImports = 0;
       
        // Process batches sequentially
        for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
          const startIndex = batchIndex * BATCH_SIZE;
          const endIndex = Math.min(startIndex + BATCH_SIZE, totalRecords);
          const batch = newOnDuties.slice(startIndex, endIndex);
         
          console.log(`Processing batch ${batchIndex + 1} of ${totalBatches} (records ${startIndex + 1} to ${endIndex})...`);
         
          // Update import status message
          setImportError(`Importing batch ${batchIndex + 1} of ${totalBatches} (${startIndex + 1}-${endIndex} of ${totalRecords})...`);
         
          // Process current batch in parallel
          const batchResults = await Promise.all(
            batch.map((onduty, batchItemIndex) => {
              const globalIndex = startIndex + batchItemIndex;
              return axios.post('/server/onduty_function/onduty', onduty, { timeout: 60000 })
                .then(response => {
                  if (!response?.data?.data?.onduty) {
                    throw new Error(`Unexpected API response structure for row ${globalIndex + 2}`);
                  }
                  return response.data.data.onduty;
                })
                .catch(err => {
                  const errorMessage = err.response?.data?.message || err.message || `Failed to import row ${globalIndex + 2}`;
                  console.error(`Import error for on duty record at row ${globalIndex + 2}:`, onduty, err);
                  return { error: errorMessage, row: globalIndex + 2, onduty: onduty };
                });
            })
          );
         
          results.push(...batchResults);
         
          // Count successes and failures in this batch
          const batchSuccessful = batchResults.filter(result => !result?.error).length;
          const batchFailed = batchResults.filter(result => result?.error).length;
          successfulImports += batchSuccessful;
          failedImports += batchFailed;
         
          console.log(`Batch ${batchIndex + 1} completed: ${batchSuccessful} successful, ${batchFailed} failed`);
        }
       
        // Final summary
        const successfulResults = results.filter(result => !result?.error);
        const failedResults = results.filter(result => result?.error);
       
        console.log('Import results summary:', {
          total: totalRecords,
          successful: successfulImports,
          failed: failedImports,
          failedDetails: failedResults
        });

        if (successfulImports === 0) {
          setImportError('Failed to import any records. See errors below.');
        } else {
          fetchOnDuties(); // Refetch on duties after import
          if (failedImports > 0) {
            // Show first few errors in detail, then summarize the rest
            const firstFewErrors = failedResults.slice(0, 5).map(f => `Row ${f.row}: ${f.error}`);
            const remainingCount = failedImports - 5;
            const errorSummary = remainingCount > 0
              ? `${firstFewErrors.join('; ')}; ... and ${remainingCount} more rows failed`
              : firstFewErrors.join('; ');
           
            setImportError(
              `Imported ${successfulImports} out of ${totalRecords} records. Failed rows: ${errorSummary}`
            );
          } else {
            setImportError(`Successfully imported ${successfulImports} record(s).`);
            setTimeout(() => setImportError(''), 3000);
          }
        }
       
        setImporting(false);
        fileInputRef.current.value = '';
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
  }, [validateImportedOnDuty, fetchOnDuties, userRole, userEmail]);

  // Export to Excel
  const handleExport = useCallback(() => {
    if (filteredOnDuties.length === 0) {
      setExportError('No data to export.');
      return;
    }

    setExporting(true);
    setExportError('');

    try {
      const exportData = filteredOnDuties.map(onduty => {
        const firstInTime = formatTime(onduty.firstIn);
        const lastOutTime = formatTime(onduty.lastOut);
        return {
          'Employee Code': onduty.employeeCode || '',
          'Employee Name': onduty.employeeName || '',
          'No of Hours': onduty.noofHours || '',
          'Reason': onduty.reason || '',
          'On Duty Date': formatDateToDDMMYYYY(onduty.onDutyDate || ''),
          'First In': firstInTime === '-' ? '' : firstInTime,
          'Last Out': lastOutTime === '-' ? '' : lastOutTime,
        };
      });

      const worksheet = XLSX.utils.json_to_sheet(exportData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'OnDuty');

      XLSX.writeFile(workbook, 'onduty_export.xlsx');
    } catch (err) {
      const errorMessage = err.message || 'Failed to export data to Excel. Please try again.';
      setExportError(errorMessage);
      console.error('Export error:', err);
    } finally {
      setExporting(false);
    }
  }, [filteredOnDuties]);

  const onChange = useCallback((e) => {
    const { name, value } = e.target;
    setForm((prev) => {
      const next = { ...prev, [name]: value };
      if (name === 'employeeCode') {
        if (employeeCodeLookupTimerRef.current) clearTimeout(employeeCodeLookupTimerRef.current);
        employeeCodeLookupTimerRef.current = setTimeout(() => {
          employeeCodeLookupTimerRef.current = null;
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

  const handleSelectOnDuty = useCallback((id) => {
    setSelectedOnDuties((prev) =>
      prev.includes(id) ? prev.filter((ondutyId) => ondutyId !== id) : [...prev, id]
    );
  }, []);

  const handleSelectAll = useCallback(() => {
    if (allSelected) {
      setSelectedOnDuties([]);
    } else {
      const allIds = filteredOnDuties.map(onduty => onduty.id);
      setSelectedOnDuties(allIds);
    }
  }, [allSelected, filteredOnDuties]);

  const handleMassDelete = useCallback(() => {
    if (selectedOnDuties.length === 0) {
      setMassDeleteError('Please select at least one record to delete.');
      return;
    }

    if (!window.confirm(`Are you sure you want to delete ${selectedOnDuties.length} record(s)?`)) {
      return;
    }

    setDeletingMultiple(true);
    setMassDeleteError('');

    Promise.all(
      selectedOnDuties.map((id) =>
        axios.delete(`/server/onduty_function/onduty/${id}`, { timeout: 5000 }).catch((err) => {
          const errorMessage = err.response?.data?.message || `Failed to delete record (ID: ${id})`;
          console.error(`Mass delete error for ID ${id}:`, err);
          return { error: errorMessage, id };
        })
      )
    )
      .then((results) => {
        const failedDeletions = results.filter((result) => result?.error);
        if (failedDeletions.length > 0) {
          setMassDeleteError(
            'Failed to delete some records: ' +
            failedDeletions.map((f) => `ID ${f.id}: ${f.error}`).join('; ')
          );
        }
        fetchOnDuties();
        setSelectedOnDuties([]);
      })
      .catch((err) => {
        setMassDeleteError('An unexpected error occurred while deleting records.');
        console.error('Mass delete error:', err);
      })
      .finally(() => setDeletingMultiple(false));
  }, [selectedOnDuties, fetchOnDuties]);

  const validateForm = useCallback(() => {
    const errors = [];
    if (!form.employeeCode.trim()) errors.push('Employee Code is required.');
    if (!form.employeeName.trim()) errors.push('Employee Name is required.');
    if (errors.length > 0) {
      setFormError(errors.join(' '));
      return false;
    }
    return true;
  }, [form]);

  const saveOnDuty = useCallback(
    async (e) => {
      e.preventDefault();
      if (!validateForm()) return;
      setSubmitting(true);

      const cleanedForm = Object.fromEntries(
        Object.entries(form).map(([key, value]) => [
          key,
          value && typeof value === 'string' && value.trim() === '' ? null : (typeof value === 'string' ? value.trim() : value)
        ])
      );

      const request = isEditing
        ? axios.put(`/server/onduty_function/onduty/${editingOnDutyId}`, cleanedForm, { timeout: 5000 })
        : axios.post('/server/onduty_function/onduty', cleanedForm, { timeout: 5000 });

      request
        .then((response) => {
          if (!response?.data?.data?.onduty) {
            throw new Error('Unexpected API response structure');
          }
          const updatedOnDuty = response.data.data.onduty;
         
          // Update local state immediately for instant UI update
          if (isEditing) {
            setOnDuties((prev) =>
              prev.map((onduty) =>
                onduty.id === updatedOnDuty.id ? updatedOnDuty : onduty
              )
            );
            setFilteredOnDuties((prev) =>
              prev.map((onduty) =>
                onduty.id === updatedOnDuty.id ? updatedOnDuty : onduty
              )
            );
          } else {
            // For new records, add to the beginning of the list
            setOnDuties((prev) => [updatedOnDuty, ...prev]);
            setFilteredOnDuties((prev) => [updatedOnDuty, ...prev]);
          }
         
          // Also refresh from server to ensure consistency
          fetchOnDuties();
         
          setForm({
            employeeCode: '',
            employeeName: '',
            noofHours: '',
            reason: '',
            onDutyDate: '',
            firstIn: '',
            lastOut: '',
          });
          setShowForm(false);
          setIsEditing(false);
          setEditingOnDutyId(null);
        })
        .catch((err) => {
          console.error('Save on duty error:', err);
          const serverError = err.response?.data?.message || (isEditing ? 'Failed to update record.' : 'Failed to add record.');
          setFormError(serverError);
        })
        .finally(() => setSubmitting(false));
    },
    [form, isEditing, editingOnDutyId, validateForm, fetchOnDuties]
  );

  const removeOnDuty = useCallback((id) => {
    setOnDuties((prev) => prev.filter((onduty) => onduty.id !== id));
    setFilteredOnDuties((prev) => prev.filter((onduty) => onduty.id !== id));
    setSelectedOnDuties((prev) => prev.filter((ondutyId) => ondutyId !== id));
  }, []);

  const editOnDuty = useCallback(async (onduty) => {
    try {
      const { data } = await axios.get(`/server/onduty_function/onduty/${onduty.id}`, { timeout: 5000 });
      const freshOnDuty = data?.data?.onduty;
      if (!freshOnDuty) {
        throw new Error('Failed to fetch on duty details');
      }
      const sanitize = (value) => value || '';
     
      // Helper to extract time from datetime string for time input
      const extractTimeForInput = (datetimeStr) => {
        if (!datetimeStr) return '';
        const str = String(datetimeStr).trim();
        // If it's already just time (HH:mm or HH:mm:ss), return it
        if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(str)) {
          return str.slice(0, 5); // Return HH:mm
        }
        // If it's a datetime string, extract time part
        const datetimeMatch = str.match(/^\d{4}-\d{2}-\d{2}\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
        if (datetimeMatch) {
          const hours = datetimeMatch[1].padStart(2, '0');
          const minutes = datetimeMatch[2];
          return `${hours}:${minutes}`;
        }
        return str;
      };
     
      setForm({
        employeeCode: sanitize(freshOnDuty.employeeCode),
        employeeName: sanitize(freshOnDuty.employeeName),
        noofHours: sanitize(freshOnDuty.noofHours),
        reason: sanitize(freshOnDuty.reason),
        onDutyDate: sanitize(freshOnDuty.onDutyDate),
        firstIn: extractTimeForInput(freshOnDuty.firstIn),
        lastOut: extractTimeForInput(freshOnDuty.lastOut),
      });
      setIsEditing(true);
      setEditingOnDutyId(freshOnDuty.id);
      setShowForm(true);
    } catch (error) {
      console.error('Failed to fetch fresh on duty data:', error);
      const sanitize = (value) => value || '';
     
      // Helper to extract time from datetime string for time input
      const extractTimeForInput = (datetimeStr) => {
        if (!datetimeStr) return '';
        const str = String(datetimeStr).trim();
        // If it's already just time (HH:mm or HH:mm:ss), return it
        if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(str)) {
          return str.slice(0, 5); // Return HH:mm
        }
        // If it's a datetime string, extract time part
        const datetimeMatch = str.match(/^\d{4}-\d{2}-\d{2}\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
        if (datetimeMatch) {
          const hours = datetimeMatch[1].padStart(2, '0');
          const minutes = datetimeMatch[2];
          return `${hours}:${minutes}`;
        }
        return str;
      };
     
      setForm({
        employeeCode: sanitize(onduty.employeeCode),
        employeeName: sanitize(onduty.employeeName),
        noofHours: sanitize(onduty.noofHours),
        reason: sanitize(onduty.reason),
        onDutyDate: sanitize(onduty.onDutyDate),
        firstIn: extractTimeForInput(onduty.firstIn),
        lastOut: extractTimeForInput(onduty.lastOut),
      });
      setIsEditing(true);
      setEditingOnDutyId(onduty.id);
      setShowForm(true);
    }
  }, []);

  const toggleForm = useCallback(() => {
    setShowForm((prev) => !prev);
    setFormError('');
    if (!showForm) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    setForm({
      employeeCode: '',
      employeeName: '',
      noofHours: '',
      reason: '',
      onDutyDate: '',
      firstIn: '',
      lastOut: '',
    });
    setIsEditing(false);
    setEditingOnDutyId(null);
  }, []);

  const modulesToShow = useMemo(
    () => getSidebarModulesForUser(resolveSidebarUserEmail(userEmail), userRole),
    [userEmail, userRole]
  );

  const dynamicColumns = useMemo(() => {
    if (selectedOnDuties.length === 0) {
      return columns.filter(col => col.label !== 'Edit');
    }
    return columns;
  }, [selectedOnDuties.length]);

  const [expandedMenus, setExpandedMenus] = useState({});

  const toggleMenu = (index) => {
    setExpandedMenus(prev => ({
      ...prev,
      [index]: !prev[index]
    }));
  };

  const userAvatar = "https://images.pexels.com/photos/2379004/pexels-photo-2379004.jpeg?auto=compress&cs=tinysrgb&w=150";
  const userName = userRole === 'App Administrator' ? 'Admin User' : 'App User';

  const [showNotifications, setShowNotifications] = useState(false);
  const recentActivities = [
    { icon: '👥', title: 'New On Duty Added', description: 'A new on duty record has been added', time: '2 minutes ago' },
    { icon: '📝', title: 'On Duty Updated', description: 'An on duty record has been updated', time: '5 minutes ago' },
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

          <main className="cms-dashboard-content">
            <div
              className="onduty-card-container"
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
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
                <div className="onduty-header-actions">
                  <div className="onduty-title-section">
                    <h2 className="onduty-title">
                      <Clock size={28} />
                      On Duty Management
                    </h2>
                    <p className="onduty-subtitle">
                      Manage on duty records efficiently
                    </p>
                  </div>
                </div>
                <div className="onduty-toolbar">
                  <button
                    className="onduty-toolbar-btn onduty-toolbar-export"
                    onClick={handleExport}
                    disabled={exporting}
                    title="Export filtered records to Excel"
                    type="button"
                  >
                    <FileOutput size={22} />
                  </button>
                  <button
                    className="onduty-toolbar-btn onduty-toolbar-import"
                    onClick={() => fileInputRef.current.click()}
                    disabled={importing}
                    title="Import on duty records from Excel"
                    type="button"
                  >
                    <FileInput size={22} />
                  </button>
                  <input
                    type="file"
                    ref={fileInputRef}
                    style={{ display: 'none' }}
                    accept=".xlsx, .xls"
                    onChange={handleImport}
                  />
                  <button
                    className="onduty-toolbar-btn onduty-toolbar-refresh"
                    onClick={() => {
                      setPage(1);
                      setShowAll(false);
                      fetchOnDuties();
                    }}
                    disabled={fetchState === 'loading'}
                    title="Refresh data"
                    type="button"
                  >
                    <RefreshCw size={22} />
                  </button>
                  <button
                    className="onduty-toolbar-btn onduty-toolbar-add"
                    onClick={toggleForm}
                    type="button"
                    title="Add new on duty record"
                  >
                    <Plus size={24} />
                  </button>
                  {selectedOnDuties.length > 0 && (
                    <button
                      className="onduty-toolbar-btn onduty-toolbar-delete"
                      onClick={handleMassDelete}
                      disabled={deletingMultiple}
                      title="Delete selected records"
                      type="button"
                    >
                      <Trash2 size={20} />
                    </button>
                  )}
                </div>
              </div>

              {importError && (
                <div className="error-message" style={{ margin: '10px 0', color: importError.includes('Successfully') ? 'green' : 'red' }}>
                  {importError}
                </div>
              )}
              {exportError && (
                <div className="error-message" style={{ margin: '10px 0', color: 'red' }}>
                  {exportError}
                </div>
              )}
              {massDeleteError && (
                <div className="error-message" style={{ margin: '10px 0', color: 'red' }}>
                  {massDeleteError}
                </div>
              )}

              {showForm && (
                <div className="onduty-form-page">
                  <div className="onduty-form-container">
                    <div className="onduty-form-header">
                      <h1 style={{ paddingLeft: '20px' }}>
                        {isEditing ? 'Edit On Duty Record' : 'Add New On Duty Record'}
                      </h1>
                      <button
                        className="close-btn"
                        onClick={toggleForm}
                        title="Close form"
                      >
                        <i className="fas fa-times"></i>
                      </button>
                    </div>
                    <div className="onduty-form-content">
                      <div className="onduty-form-card">
                        <div className="form-section-card onduty-info">
                          <h2 className="section-title">On Duty Information</h2>
                          <div className="form-grid">
                            <div className="form-group">
                              <label>Employee Code *</label>
                              <input
                                className="input"
                                type="text"
                                name="employeeCode"
                                value={form.employeeCode}
                                onChange={onChange}
                                onBlur={() => {
                                  if (employeeCodeLookupTimerRef.current) {
                                    clearTimeout(employeeCodeLookupTimerRef.current);
                                    employeeCodeLookupTimerRef.current = null;
                                  }
                                  applyEmployeeCodeLookup();
                                }}
                                placeholder="Enter code to auto-fill name"
                              />
                              {employeeLookupLoading && (
                                <span className="text-muted" style={{ fontSize: '0.85rem', marginTop: 4 }}>Loading employee list…</span>
                              )}
                            </div>
                            <div className="form-group">
                              <label>Employee Name *</label>
                              <input className="input" type="text" name="employeeName" value={form.employeeName} readOnly placeholder="Fills automatically when you enter employee code" tabIndex={-1} />
                            </div>
                            <div className="form-group">
                              <label>No of Hours</label>
                              <select className="input" name="noofHours" value={form.noofHours} onChange={onChange}>
                                <option value="">Select...</option>
                                <option value="Full Day">Full Day</option>
                                <option value="Half Day">Half Day</option>
                              </select>
                            </div>
                            <div className="form-group">
                              <label>Reason</label>
                              <input className="input" type="text" name="reason" value={form.reason} onChange={onChange} />
                            </div>
                            <div className="form-group">
                              <label>On Duty Date</label>
                              <input className="input" type="date" name="onDutyDate" value={form.onDutyDate} onChange={onChange} />
                            </div>
                            <div className="form-group">
                              <label>First In (24-hour format)</label>
                              <input className="input" type="time" name="firstIn" value={form.firstIn} onChange={onChange} step="60" pattern="[0-9]{2}:[0-9]{2}" placeholder="13:00" />
                            </div>
                            <div className="form-group">
                              <label>Last Out (24-hour format)</label>
                              <input className="input" type="time" name="lastOut" value={form.lastOut} onChange={onChange} step="60" pattern="[0-9]{2}:[0-9]{2}" placeholder="18:00" />
                            </div>
                          </div>
                        </div>
                        <div className="form-actions">
                          <button type="submit" className="btn btn-primary" disabled={submitting} onClick={saveOnDuty}>
                            {isEditing ? 'Update Record' : 'Submit'}
                            {submitting && <span className="btn-primary__loader ml-5"></span>}
                          </button>
                          <button type="button" className="btn btn-danger" onClick={toggleForm}>
                            Cancel
                          </button>
                        </div>
                        {formError && <div className="error-message">{formError}</div>}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {!showForm && (
                <>
                  <div className="onduty-table-container" style={{ marginTop: 32 }}>
                    {(fetchState === 'loading') ? (
                      <div className="dF aI-center jC-center h-inh">
                        <div className="loader-lg"></div>
                      </div>
                    ) : fetchState === 'error' ? (
                      <div className="error-message">{fetchError}</div>
                    ) : (
                      <table className={`onduty-table ${selectedOnDuties.length === 0 ? 'edit-column-hidden' : ''}`} style={{ background: '#fff', boxShadow: '0 2px 4px rgba(0,0,0,0.06)' }}>
                        <thead style={{ background: '#f5f5f5' }}>
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
                          {filteredOnDuties.length ? (
                            filteredOnDuties.map((onduty, index) => (
                              <OnDutyRow
                                key={onduty.id}
                                onduty={onduty}
                                index={index}
                                removeOnDuty={removeOnDuty}
                                editOnDuty={editOnDuty}
                                isSelected={selectedOnDuties.includes(onduty.id)}
                                onSelect={handleSelectOnDuty}
                                selectedOnDuties={selectedOnDuties}
                              />
                            ))
                          ) : (
                            <tr>
                              <td colSpan={dynamicColumns.length} className="text-center">
                                No on duty records found. Add a new record.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    )}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '24px 0' }}>
                    <button
                      className="toolbar-btn mr-2"
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page === 1 || showAll}
                    >
                      Previous
                    </button>
                    <span style={{ margin: '0 10px' }}>
                      {showAll ? 'Showing All Records' : `Page ${page} of ${totalPages}`}
                    </span>
                    <button
                      className="toolbar-btn"
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      disabled={page === totalPages || showAll}
                    >
                      Next
                    </button>
                    <button
                      className="toolbar-btn ml-2"
                      onClick={() => {
                        setShowAll(!showAll);
                        setPage(1);
                      }}
                      style={{ backgroundColor: showAll ? '#28a745' : '#6c757d', color: 'white' }}
                    >
                      {showAll ? 'Show Paginated' : 'Show All'}
                    </button>
                    {!showAll && (
                      <select
                        value={perPage}
                        onChange={(e) => {
                          setPerPage(parseInt(e.target.value));
                          setPage(1);
                        }}
                        style={{ marginLeft: 10, padding: '5px', borderRadius: '4px', border: '1px solid #ccc' }}
                      >
                        <option value={10}>10 per page</option>
                        <option value={25}>25 per page</option>
                        <option value={50}>50 per page</option>
                        <option value={100}>100 per page</option>
                        <option value={200}>200 per page</option>
                      </select>
                    )}
                    <span style={{ marginLeft: 20, fontSize: 14, color: '#555' }}>
                      Showing {onduties.length} of {totalOnDuties || '?'} records
                    </span>
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

export default OnDutyManagement;
