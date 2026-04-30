import './App.css';
import './helper.css';
import './compoff.css';
import './employeeManagement.css';
import axios from 'axios';
import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import { Link } from 'react-router-dom';
import HeaderBranding from './HeaderBranding';
import { getSidebarModulesForUser, resolveSidebarUserEmail } from './modulesConfig';
import Button from './Button';
import {
  Users, Calendar, FileText, AlertTriangle, FolderOpen,
  ClipboardList, Building, Handshake, Landmark, Clock,
  Map, BarChart3, User, TrendingUp, TrendingDown,
  Activity, Plus, CheckCircle, Bell, Settings, LayoutDashboard, Home as HomeIcon,
  Shield, AlertOctagon, CreditCard, FileSignature, Search, Clock3, CalendarDays, Database,
  FileInput, FileOutput, RefreshCw, Trash2
} from 'lucide-react';

// Helper function to convert Excel serial date to YYYY-MM-DD format (for database storage)
// Uses UTC to avoid timezone shifts
function excelSerialToDateYYYYMMDD(serial) {
  // Excel serial date: number of days since January 1, 1900
  // Excel serial 1 = January 1, 1900
  // Excel incorrectly treats 1900 as a leap year
  
  // Standard Excel serial date conversion formula:
  // The offset from Unix epoch (1970-01-01) to Excel epoch (1900-01-01) is -25569 days
  // Accounting for Excel's leap year bug, we use -25569 for dates after Feb 28, 1900
  // Formula: date = new Date((serial - 25569) * 86400000)
  
  // Round the serial number to handle any fractional parts (time components)
  const serialRounded = Math.round(serial);
  
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

// Helper function to convert Excel serial date to DD-MM-YYYY format (for display/export)
function excelSerialToDateDDMMYYYY(serial) {
  const yyyymmdd = excelSerialToDateYYYYMMDD(serial);
  const [year, month, day] = yyyymmdd.split('-');
  return `${day}-${month}-${year}`;
}

// Helper function to convert YYYY-MM-DD to DD-MM-YYYY
function convertToDDMMYYYY(dateStr) {
  if (!dateStr) return '-';
  const str = String(dateStr).slice(0, 10);
  // Check if already in YYYY-MM-DD format
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    const [year, month, day] = str.split('-');
    return `${day}-${month}-${year}`;
  }
  // If already in DD-MM-YYYY, return as is
  if (/^\d{2}-\d{2}-\d{4}$/.test(str)) {
    return str;
  }
  return str;
}

// Helper function to convert DD-MM-YYYY to YYYY-MM-DD (for database storage)
function convertToYYYYMMDD(dateStr) {
  if (!dateStr) return '';
  const str = String(dateStr).trim();
  // Check if already in YYYY-MM-DD format
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return str.slice(0, 10);
  }
  // Check if in DD-MM-YYYY format
  if (/^\d{2}-\d{2}-\d{4}$/.test(str)) {
    const [day, month, year] = str.split('-');
    return `${year}-${month}-${day}`;
  }
  // Try to parse as date and convert
  try {
    const date = new Date(str);
    if (!isNaN(date.getTime())) {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
  } catch (e) {
    // If parsing fails, return as is
  }
  return str;
}

// Helper function to format date for display (DD-MM-YYYY)
function formatDate(dateStr) {
  if (!dateStr) return '-';
  return convertToDDMMYYYY(dateStr);
}

// CompOff Row Component
function CompOffRow({ compoff, index, removeCompOff, editCompOff, isSelected, onSelect, selectedCompOffs }) {
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const deleteCompOff = useCallback((e) => {
    e.stopPropagation();
    setDeleting(true);
    setDeleteError('');
    axios
      .delete(`/server/comboff_function/comboff/${compoff.id}`, { timeout: 5000 })
      .then(() => {
        removeCompOff(compoff.id);
      })
      .catch((err) => {
        const errorMessage = err.response?.data?.message || `Failed to delete comp off record (ID: ${compoff.id}).`;
        setDeleteError(errorMessage);
        console.error('Delete comp off error:', err);
      })
      .finally(() => setDeleting(false));
  }, [compoff.id, removeCompOff]);

  const handleRowClick = useCallback(() => {
    editCompOff(compoff);
  }, [editCompOff, compoff]);

  const handleCheckboxClick = useCallback((e) => {
    e.stopPropagation();
    onSelect(compoff.id);
  }, [onSelect, compoff.id]);

  const handleEditButtonClick = useCallback((e) => {
    e.stopPropagation();
    editCompOff(compoff);
  }, [editCompOff, compoff]);

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
      {selectedCompOffs.length > 0 && (
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
      <td>{compoff.employeeCode || '-'}</td>
      <td>{compoff.employeeName || '-'}</td>
      <td>{compoff.workedOn ? formatDate(compoff.workedOn) : '-'}</td>
      <td>{compoff.taken ? formatDate(compoff.taken) : '-'}</td>
      <td>{compoff.compoffStatus || '-'}</td>
      <td>{compoff.otStatus || '-'}</td>
    </tr>
  );
}

function CompOff({ userRole = 'App Administrator', userEmail = null }) {
  const [compoffs, setCompOffs] = useState([]);
  const [filteredCompOffs, setFilteredCompOffs] = useState([]);
  const [fetchState, setFetchState] = useState('idle');
  const [fetchError, setFetchError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editingCompOffId, setEditingCompOffId] = useState(null);
  const [form, setForm] = useState({
    employeeCode: '',
    employeeName: '',
    workedOn: '',
    taken: '',
    compoffStatus: '',
    otStatus: '',
  });
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [selectedCompOffs, setSelectedCompOffs] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCompOffs, setTotalCompOffs] = useState(0);
  const [showAll, setShowAll] = useState(false);
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

  const allSelected = selectedCompOffs.length > 0 && selectedCompOffs.length === filteredCompOffs.length;
  const someSelected = selectedCompOffs.length > 0 && selectedCompOffs.length < filteredCompOffs.length;

  // Fetch comp offs with pagination
  const fetchCompOffs = useCallback(() => {
    setFetchState('loading');
    setFetchError('');
   
    const params = showAll ? {} : { page, perPage };
   
    if (userRole && userEmail) {
      params.userRole = userRole;
      params.userEmail = userEmail;
    }
   
    axios
      .get('/server/comboff_function/comboff', { params, timeout: 5000 })
      .then((response) => {
        if (!response?.data?.data?.compoffs) {
          throw new Error('Unexpected API response structure');
        }
        let fetchedCompOffs = response.data.data.compoffs || [];
        if (!Array.isArray(fetchedCompOffs)) {
          throw new Error('CompOff data is not an array');
        }

        setCompOffs(fetchedCompOffs);
        setFilteredCompOffs(fetchedCompOffs);

        const codesNeedingName = [...new Set(
          fetchedCompOffs
            .filter((c) => (c.employeeCode || '').toString().trim() && !(c.employeeName || '').toString().trim())
            .map((c) => (c.employeeCode || '').toString().trim())
        )];
        if (codesNeedingName.length > 0) {
          const applyEnrichment = (codeToName) => {
            const enriched = fetchedCompOffs.map((c) => {
              const code = (c.employeeCode || '').toString().trim();
              const name = (c.employeeName || '').toString().trim();
              if (code && !name && codeToName[code]) {
                return { ...c, employeeName: codeToName[code] };
              }
              return c;
            });
            setCompOffs(enriched);
            setFilteredCompOffs(enriched);
          };
          axios
            .get('/server/comboff_function/comboff/employee-names', {
              params: { codes: codesNeedingName.join(',') },
              timeout: 10000,
            })
            .then((nameRes) => {
              const data = nameRes?.data?.data;
              if (data && typeof data === 'object' && Object.keys(data).length > 0) {
                applyEnrichment(data);
                return;
              }
              throw new Error('No names from comboff');
            })
            .catch(() => {
              const params = { returnAll: true };
              if (userRole && userEmail) {
                params.userRole = userRole;
                params.userEmail = userEmail;
              }
              return axios.get('/server/cms_function/employees', { params, timeout: 15000 }).then((empRes) => {
                const employees = empRes?.data?.data?.employees || [];
                const codeToName = {};
                employees.forEach((emp) => {
                  const code = (emp.employeeCode || '').toString().trim();
                  if (code) codeToName[code] = (emp.employeeName || '').toString().trim();
                });
                applyEnrichment(codeToName);
              });
            })
            .catch(() => {});
        }

        const hasMore = response.data.data.hasMore;
        const total = response.data.data.total || 0;
        setTotalCompOffs(total);
        if (total && perPage && !showAll) {
          setTotalPages(Math.ceil(total / perPage));
        } else {
          setTotalPages(hasMore ? page + 1 : page);
        }
        setFetchState('fetched');
      })
      .catch((err) => {
        const errorMessage = err.response?.data?.message || 'Failed to fetch comp off records. Please try again later.';
        setFetchError(errorMessage);
        setFetchState('error');
        console.error('Fetch comp off error:', err);
      });
  }, [page, perPage, showAll, userRole, userEmail]);

  useEffect(() => {
    fetchCompOffs();
  }, [fetchCompOffs]);

  // Filter comp offs based on search term
  useEffect(() => {
    if (!searchTerm.trim()) {
      setFilteredCompOffs(compoffs);
      return;
    }

    const term = searchTerm.toLowerCase();
    const filtered = compoffs.filter(compoff => 
      (compoff.employeeCode && compoff.employeeCode.toLowerCase().includes(term)) ||
      (compoff.employeeName && compoff.employeeName.toLowerCase().includes(term)) ||
      (compoff.workedOn && compoff.workedOn.toLowerCase().includes(term)) ||
      (compoff.taken && compoff.taken.toLowerCase().includes(term)) ||
      (compoff.compoffStatus && compoff.compoffStatus.toLowerCase().includes(term)) ||
      (compoff.otStatus && compoff.otStatus.toLowerCase().includes(term))
    );
    setFilteredCompOffs(filtered);
  }, [searchTerm, compoffs]);

  // Fetch employees for lookup when add form is opened (same source as import/table)
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
        console.error('Comp Off: fetch employees for lookup failed', err);
        setEmployeeLookupList([]);
      })
      .finally(() => setEmployeeLookupLoading(false));
  }, [userRole, userEmail]);

  useEffect(() => {
    if (showForm && employeeLookupList.length === 0 && !employeeLookupLoading) {
      fetchEmployeesForLookup();
    }
  }, [showForm, fetchEmployeesForLookup, employeeLookupList.length, employeeLookupLoading]);

  // Look up employee name by code and update form (like import auto-fetches name)
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

  const columns = [
    { label: 'Select', field: null },
    { label: 'Edit', field: null },
    { label: '#', field: null },
    { label: 'Employee Code', field: 'employeeCode' },
    { label: 'Employee Name', field: 'employeeName' },
    { label: 'Worked On', field: 'workedOn' },
    { label: 'Taken', field: 'taken' },
    { label: 'Comboff Status', field: 'compoffStatus' },
    { label: 'OT Status', field: 'otStatus' },
  ];

  // Validate comp off data (similar to validateForm but for imports)
  const validateImportedCompOff = useCallback((compoff, rowIndex) => {
    const errors = [];
    if (!compoff.employeeCode) errors.push('Employee Code is required.');
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

        // Log duplicate codes summary (for information only - duplicates are allowed in compoff)
        if (duplicateCodes.size > 0) {
          console.warn(`Found ${duplicateCodes.size} duplicate Employee Code(s) in file (allowing all records):`, Array.from(duplicateCodes));
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
            const formatCode = cell.z.toLowerCase();
            const isDateFormat = formatCode.includes('d') || formatCode.includes('m') || formatCode.includes('y') ||
                                 formatCode.includes('dd') || formatCode.includes('mm') || formatCode.includes('yyyy');
            
            if (isDateFormat) {
              try {
                if (typeof XLSX.SSF !== 'undefined' && XLSX.SSF && typeof XLSX.SSF.format === 'function') {
                  const formatted = XLSX.SSF.format(cell.z, cell.v);
                  if (formatted && formatted !== cell.v.toString() && !/^\d+\.?\d*$/.test(formatted.trim())) {
                    return formatted;
                  }
                }
              } catch (e) {
                // Fall through
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

        // Find column indices for date columns and employee columns
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
        const findColumnIndices = (headerName) => {
          const indices = [];
          const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
          for (let col = range.s.c; col <= range.e.c; col++) {
            const cellAddress = XLSX.utils.encode_cell({ r: 0, c: col });
            const cell = worksheet[cellAddress];
            const val = cell && (cell.w != null ? cell.w : cell.v);
            if (val != null && String(val).trim() === String(headerName).trim()) {
              indices.push(col);
            }
          }
          return indices;
        };
        const getCellValueByCol = (r, c) => {
          if (c < 0) return undefined;
          const cellAddress = XLSX.utils.encode_cell({ r: r + 1, c });
          const cell = worksheet[cellAddress];
          if (!cell) return undefined;
          if (cell.v !== undefined && cell.v !== null) return cell.v;
          if (cell.w !== undefined && cell.w !== null) return cell.w;
          return undefined;
        };

        const employeeCodeCol = findColumnIndex('Employee Code') >= 0 ? findColumnIndex('Employee Code') : findColumnIndices('Employee')[0];
        const employeeNameCol = findColumnIndex('Employee Name') >= 0 ? findColumnIndex('Employee Name') : findColumnIndices('Employee')[1];
        const workedOnColIndex = findColumnIndex('Worked On');
        const takenColIndex = findColumnIndex('Taken');

        const newCompOffs = jsonData.map((row, index) => {
          // Get corresponding text row for date values
          const textRow = jsonDataText[index] || {};
          
          // Try to get cell text values directly for date columns
          let workedOnText = textRow['Worked On'];
          let workedOnRaw = row['Worked On'];
          if (workedOnColIndex >= 0) {
            const cellAddress = XLSX.utils.encode_cell({ r: index + 1, c: workedOnColIndex });
            const cell = worksheet[cellAddress];
            const directCellText = getCellText(cellAddress);
            if (directCellText) {
              workedOnText = directCellText;
            } else if (cell && typeof cell.v === 'number') {
              workedOnRaw = cell.v;
            }
          }
          
          let takenText = textRow['Taken'];
          let takenRaw = row['Taken'];
          if (takenColIndex >= 0) {
            const cellAddress = XLSX.utils.encode_cell({ r: index + 1, c: takenColIndex });
            const cell = worksheet[cellAddress];
            const directCellText = getCellText(cellAddress);
            if (directCellText) {
              takenText = directCellText;
            } else if (cell && typeof cell.v === 'number') {
              takenRaw = cell.v;
            }
          }
          
          const safeToString = (value) => {
            if (value == null || value === '') return '';
            return String(value).trim();
          };

          // Helper function to convert date value to YYYY-MM-DD format (for database storage)
          // Accepts DD-MM-YYYY, YYYY-MM-DD, Date objects, Excel serial dates, etc.
          const convertDateValue = (value, textValue = null) => {
            if (value == null || value === '') return '';
            
            // ALWAYS prioritize text value first to preserve original format from Excel
            if (textValue != null && textValue !== '') {
              const textStr = String(textValue).trim();
              
              // Check if text value is a pure number (Excel serial date as string)
              const textAsNumber = Number(textStr);
              if (!isNaN(textAsNumber) && textAsNumber > 0 && textAsNumber < 1000000 && /^\d+$/.test(textStr)) {
                // This is an Excel serial date stored as a string
                try {
                  return excelSerialToDateYYYYMMDD(textAsNumber);
                } catch (e) {
                  console.error(`Error converting serial date from text "${textStr}":`, e);
                }
              }
              
              // Check if it's in DD-MM-YYYY format
              const dmy = textStr.match(/^(\d{2})[-\/.](\d{2})[-\/.](\d{4})$/);
              if (dmy) {
                const [, day, month, year] = dmy;
                return `${year}-${month}-${day}`;
              }
              
              // Check for DD/MM/YYYY format
              const dmySlash = textStr.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
              if (dmySlash) {
                const [, day, month, year] = dmySlash;
                return `${year}-${month}-${day}`;
              }
              
              // If it's already in YYYY-MM-DD format, return it
              if (/^\d{4}-\d{2}-\d{2}/.test(textStr)) {
                return textStr.slice(0, 10);
              }
              
              // Try to parse Excel formatted date strings
              const excelDateMatch = textStr.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})$/);
              if (excelDateMatch) {
                const [, day, month, year] = excelDateMatch;
                return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
              }
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
            
            // Check if it's an Excel serial date (numeric)
            const numValue = Number(value);
            if (!isNaN(numValue) && numValue > 0 && numValue < 1000000) {
              try {
                return excelSerialToDateYYYYMMDD(numValue);
              } catch (e) {
                console.error(`Error converting Excel serial date ${numValue}:`, e);
                return strValue;
              }
            }
            
            // If it's a Date object (shouldn't happen with cellDates: false, but handle it)
            if (value instanceof Date) {
              const year = value.getUTCFullYear();
              const month = String(value.getUTCMonth() + 1).padStart(2, '0');
              const day = String(value.getUTCDate()).padStart(2, '0');
              return `${year}-${month}-${day}`;
            }
            
            // Last resort: return as string
            return strValue;
          };

          // Ensure we have raw values to convert (prefer numeric if available)
          const workedOnValue = (typeof workedOnRaw === 'number') ? workedOnRaw : (row['Worked On'] !== undefined ? row['Worked On'] : null);
          const workedOnTextValue = workedOnText || textRow['Worked On'] || null;
          
          const takenValue = (typeof takenRaw === 'number') ? takenRaw : (row['Taken'] !== undefined ? row['Taken'] : null);
          const takenTextValue = takenText || textRow['Taken'] || null;
          
          const rawEmployeeCode = row['Employee Code'] ?? (employeeCodeCol != null && employeeCodeCol >= 0 ? getCellValueByCol(index, employeeCodeCol) : undefined) ?? row['Employee'];
          const rawEmployeeName = row['Employee Name'] ?? (employeeNameCol != null && employeeNameCol >= 0 ? getCellValueByCol(index, employeeNameCol) : undefined) ?? row['Employee'];
          const compoff = {
            employeeCode: safeToString(rawEmployeeCode),
            employeeName: safeToString(rawEmployeeName),
            workedOn: convertDateValue(workedOnValue, workedOnTextValue),
            taken: convertDateValue(takenValue, takenTextValue),
            compoffStatus: safeToString(row['Comboff Status'] || row['ComboffStatus']),
            otStatus: safeToString(row['OT Status'] || row['OTStatus']),
          };

          // Note: Duplicate employee codes are allowed in compoff imports - all records will be imported

          const validationError = validateImportedCompOff(compoff, index + 2);
          if (validationError) {
            console.error(`Row ${index + 2} validation error:`, validationError);
            throw new Error(validationError);
          }

          return compoff;
        });

        // Always fetch correct employee names from system for every row that has Employee Code
        // (overwrites Excel value so the correct name from master is used whether Excel had name empty or typed)
        const allCodes = [...new Set(
          newCompOffs
            .map((c) => (c.employeeCode || '').toString().trim())
            .filter(Boolean)
        )];
        if (allCodes.length > 0) {
          try {
            let codeToName = {};
            const nameRes = await axios.get('/server/comboff_function/comboff/employee-names', {
              params: { codes: allCodes.join(',') },
              timeout: 10000,
            }).catch(() => null);
            if (nameRes?.data?.data && typeof nameRes.data.data === 'object') {
              codeToName = nameRes.data.data;
            }
            if (Object.keys(codeToName).length === 0) {
              const params = { returnAll: true };
              if (userRole && userEmail) {
                params.userRole = userRole;
                params.userEmail = userEmail;
              }
              const empRes = await axios.get('/server/cms_function/employees', { params, timeout: 15000 });
              const employees = empRes?.data?.data?.employees || [];
              employees.forEach((emp) => {
                const code = (emp.employeeCode || '').toString().trim();
                if (code) codeToName[code] = (emp.employeeName || '').toString().trim();
              });
            }
            newCompOffs.forEach((compoff) => {
              const code = (compoff.employeeCode || '').toString().trim();
              if (code && codeToName[code]) {
                compoff.employeeName = codeToName[code];
              }
            });
          } catch (err) {
            console.warn('Could not fetch employee names during import:', err);
          }
        }

        // Check for existing records in database (optional - you can skip this if you want to allow duplicates)
        console.log('Importing comp off records...');

        Promise.all(
          newCompOffs.map((compoff, index) =>
            axios.post('/server/comboff_function/comboff', compoff, { timeout: 60000 })
              .then(response => {
                if (!response?.data?.data?.compoff) {
                  throw new Error(`Unexpected API response structure for row ${index + 2}`);
                }
                return response.data.data.compoff;
              })
              .catch(err => {
                const errorMessage = err.response?.data?.message || err.message || `Failed to import row ${index + 2}`;
                console.error(`Import error for comp off record at row ${index + 2}:`, compoff, err);
                return { error: errorMessage, row: index + 2, compoff: compoff };
              })
          )
        )
          .then(results => {
            const successfulImports = results.filter(result => !result?.error);
            const failedImports = results.filter(result => result?.error);
            console.log('Import results summary:', {
              total: newCompOffs.length,
              successful: successfulImports.length,
              failed: failedImports.length,
              failedDetails: failedImports
            });

            if (successfulImports.length === 0) {
              setImportError('Failed to import any records. See errors below.');
            } else {
              fetchCompOffs(); // Refetch comp offs after import
              if (failedImports.length > 0) {
                // Show first few errors in detail, then summarize the rest
                const firstFewErrors = failedImports.slice(0, 5).map(f => `Row ${f.row}: ${f.error}`);
                const remainingCount = failedImports.length - 5;
                const errorSummary = remainingCount > 0
                  ? `${firstFewErrors.join('; ')}; ... and ${remainingCount} more rows failed`
                  : firstFewErrors.join('; ');
               
                setImportError(
                  `Imported ${successfulImports.length} out of ${newCompOffs.length} records. Failed rows: ${errorSummary}`
                );
              } else {
                setImportError(`Successfully imported ${successfulImports.length} record(s).`);
                setTimeout(() => setImportError(''), 3000);
              }
            }
          })
          .catch(err => {
            setImportError(err.message || 'An error occurred while importing records.');
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
  }, [validateImportedCompOff, fetchCompOffs, userRole, userEmail]);

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

  const handleSelectCompOff = useCallback((id) => {
    setSelectedCompOffs((prev) =>
      prev.includes(id) ? prev.filter((compoffId) => compoffId !== id) : [...prev, id]
    );
  }, []);

  const handleSelectAll = useCallback(() => {
    if (allSelected) {
      setSelectedCompOffs([]);
    } else {
      const allIds = filteredCompOffs.map(compoff => compoff.id);
      setSelectedCompOffs(allIds);
    }
  }, [allSelected, filteredCompOffs]);

  const handleMassDelete = useCallback(() => {
    if (selectedCompOffs.length === 0) {
      setMassDeleteError('Please select at least one record to delete.');
      return;
    }

    if (!window.confirm(`Are you sure you want to delete ${selectedCompOffs.length} record(s)?`)) {
      return;
    }

    setDeletingMultiple(true);
    setMassDeleteError('');

    Promise.all(
      selectedCompOffs.map((id) =>
        axios.delete(`/server/comboff_function/comboff/${id}`, { timeout: 5000 }).catch((err) => {
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
        fetchCompOffs();
        setSelectedCompOffs([]);
      })
      .catch((err) => {
        setMassDeleteError('An unexpected error occurred while deleting records.');
        console.error('Mass delete error:', err);
      })
      .finally(() => setDeletingMultiple(false));
  }, [selectedCompOffs, fetchCompOffs]);

  const validateForm = useCallback(() => {
    const errors = [];
    if (!form.employeeCode.trim()) errors.push('Employee Code is required.');
    if (errors.length > 0) {
      setFormError(errors.join(' '));
      return false;
    }
    return true;
  }, [form]);

  const saveCompOff = useCallback(
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
        ? axios.put(`/server/comboff_function/comboff/${editingCompOffId}`, cleanedForm, { timeout: 5000 })
        : axios.post('/server/comboff_function/comboff', cleanedForm, { timeout: 5000 });

      request
        .then((response) => {
          if (!response?.data?.data?.compoff) {
            throw new Error('Unexpected API response structure');
          }
          const updatedCompOff = response.data.data.compoff;
          
          if (isEditing) {
            setCompOffs((prev) =>
              prev.map((compoff) =>
                compoff.id === updatedCompOff.id ? updatedCompOff : compoff
              )
            );
            setFilteredCompOffs((prev) =>
              prev.map((compoff) =>
                compoff.id === updatedCompOff.id ? updatedCompOff : compoff
              )
            );
          } else {
            setCompOffs((prev) => [updatedCompOff, ...prev]);
            setFilteredCompOffs((prev) => [updatedCompOff, ...prev]);
          }
          
          fetchCompOffs();
          
          setForm({
            employeeCode: '',
            employeeName: '',
            workedOn: '',
            taken: '',
            compoffStatus: '',
            otStatus: '',
          });
          setShowForm(false);
          setIsEditing(false);
          setEditingCompOffId(null);
        })
        .catch((err) => {
          console.error('Save comp off error:', err);
          const serverError = err.response?.data?.message || (isEditing ? 'Failed to update record.' : 'Failed to add record.');
          setFormError(serverError);
        })
        .finally(() => setSubmitting(false));
    },
    [form, isEditing, editingCompOffId, validateForm, fetchCompOffs]
  );

  const removeCompOff = useCallback((id) => {
    setCompOffs((prev) => prev.filter((compoff) => compoff.id !== id));
    setFilteredCompOffs((prev) => prev.filter((compoff) => compoff.id !== id));
    setSelectedCompOffs((prev) => prev.filter((compoffId) => compoffId !== id));
  }, []);

  const editCompOff = useCallback(async (compoff) => {
    try {
      const { data } = await axios.get(`/server/comboff_function/comboff/${compoff.id}`, { timeout: 5000 });
      const freshCompOff = data?.data?.compoff;
      if (!freshCompOff) {
        throw new Error('Failed to fetch comp off details');
      }
      const sanitize = (value) => value || '';
     
      setForm({
        employeeCode: sanitize(freshCompOff.employeeCode),
        employeeName: sanitize(freshCompOff.employeeName),
        workedOn: sanitize(freshCompOff.workedOn),
        taken: sanitize(freshCompOff.taken),
        compoffStatus: sanitize(freshCompOff.compoffStatus),
        otStatus: sanitize(freshCompOff.otStatus),
      });
      setIsEditing(true);
      setEditingCompOffId(freshCompOff.id);
      setShowForm(true);
    } catch (error) {
      console.error('Failed to fetch fresh comp off data:', error);
      const sanitize = (value) => value || '';
      setForm({
        employeeCode: sanitize(compoff.employeeCode),
        employeeName: sanitize(compoff.employeeName),
        workedOn: sanitize(compoff.workedOn),
        taken: sanitize(compoff.taken),
        compoffStatus: sanitize(compoff.compoffStatus),
        otStatus: sanitize(compoff.otStatus),
      });
      setIsEditing(true);
      setEditingCompOffId(compoff.id);
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
      workedOn: '',
      taken: '',
      compoffStatus: '',
      otStatus: '',
    });
    setIsEditing(false);
    setEditingCompOffId(null);
  }, [showForm]);

  // Export to Excel
  const handleExport = useCallback(() => {
    if (filteredCompOffs.length === 0) {
      setExportError('No data to export.');
      return;
    }

    setExporting(true);
    setExportError('');

    try {
      const exportData = filteredCompOffs.map(compoff => ({
        'Employee Code': compoff.employeeCode || '',
        'Employee Name': compoff.employeeName || '',
        'Worked On': compoff.workedOn ? formatDate(compoff.workedOn) : '',
        'Taken': compoff.taken ? formatDate(compoff.taken) : '',
        'Comboff Status': compoff.compoffStatus || '',
        'OT Status': compoff.otStatus || '',
      }));

      const worksheet = XLSX.utils.json_to_sheet(exportData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'CompOff');

      XLSX.writeFile(workbook, 'compoff_export.xlsx');
    } catch (err) {
      const errorMessage = err.message || 'Failed to export data to Excel. Please try again.';
      setExportError(errorMessage);
      console.error('Export error:', err);
    } finally {
      setExporting(false);
    }
  }, [filteredCompOffs]);

  const modulesToShow = useMemo(
    () => getSidebarModulesForUser(resolveSidebarUserEmail(userEmail), userRole),
    [userEmail, userRole]
  );

  const dynamicColumns = useMemo(() => {
    if (selectedCompOffs.length === 0) {
      return columns.filter(col => col.label !== 'Edit');
    }
    return columns;
  }, [selectedCompOffs.length]);

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
    { icon: '👥', title: 'New Comp Off Added', description: 'A new comp off record has been added', time: '2 minutes ago' },
    { icon: '📝', title: 'Comp Off Updated', description: 'A comp off record has been updated', time: '5 minutes ago' },
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
            <div className="compoff-card-container">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
                <div className="compoff-header-actions">
                  <div className="compoff-title-section">
                    <h2 className="compoff-title">
                      <Clock size={28} />
                      Comp Off Management
                    </h2>
                    <p className="compoff-subtitle">
                      Manage comp off records efficiently
                    </p>
                  </div>
                </div>
                <div className="compoff-toolbar">
                  <button
                    className="compoff-toolbar-btn compoff-toolbar-import"
                    onClick={() => fileInputRef.current.click()}
                    disabled={importing}
                    title="Import comp off records from Excel"
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
                    className="compoff-toolbar-btn compoff-toolbar-export"
                    onClick={handleExport}
                    disabled={exporting}
                    title="Export filtered records to Excel"
                    type="button"
                  >
                    <FileOutput size={22} />
                  </button>
                  <button
                    className="compoff-toolbar-btn compoff-toolbar-refresh"
                    onClick={() => {
                      setPage(1);
                      setShowAll(false);
                      fetchCompOffs();
                    }}
                    disabled={fetchState === 'loading'}
                    title="Refresh data"
                    type="button"
                  >
                    <RefreshCw size={22} />
                  </button>
                  <button
                    className="compoff-toolbar-btn compoff-toolbar-add"
                    onClick={toggleForm}
                    type="button"
                    title="Add new comp off record"
                  >
                    <Plus size={24} />
                  </button>
                  {selectedCompOffs.length > 0 && (
                    <button
                      className="compoff-toolbar-btn compoff-toolbar-delete"
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

              {/* Search Bar */}
              {!showForm && (
                <div style={{ marginBottom: '20px' }}>
                  <input
                    type="text"
                    placeholder="Search by Employee Code, Name, Worked On, or Taken..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '12px',
                      borderRadius: '8px',
                      border: '1px solid #ddd',
                      fontSize: '1rem'
                    }}
                  />
                </div>
              )}

              {showForm && (
                <div className="compoff-form-page">
                  <div className="compoff-form-container">
                    <div className="compoff-form-header">
                      <h1 style={{ paddingLeft: '20px' }}>
                        {isEditing ? 'Edit Comp Off Record' : 'Add New Comp Off Record'}
                      </h1>
                      <button
                        className="close-btn"
                        onClick={toggleForm}
                        title="Close form"
                      >
                        <i className="fas fa-times"></i>
                      </button>
                    </div>
                    <div className="compoff-form-content">
                      <div className="compoff-form-card">
                        <div className="form-section-card compoff-info">
                          <h2 className="section-title">Comp Off Information</h2>
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
                              <label>Employee Name</label>
                              <input className="input" type="text" name="employeeName" value={form.employeeName} readOnly placeholder="Fills automatically when you enter employee code" tabIndex={-1} />
                            </div>
                            <div className="form-group">
                              <label>Worked On</label>
                              <input className="input" type="date" name="workedOn" value={form.workedOn} onChange={onChange} />
                            </div>
                            <div className="form-group">
                              <label>Taken</label>
                              <input className="input" type="date" name="taken" value={form.taken} onChange={onChange} />
                            </div>
                            <div className="form-group">
                              <label>Comboff Status</label>
                              <select className="input" name="compoffStatus" value={form.compoffStatus} onChange={onChange}>
                                <option value="">Select status</option>
                                <option value="Yes">Yes</option>
                                <option value="No">No</option>
                              </select>
                            </div>
                            <div className="form-group">
                              <label>OT Status</label>
                              <select className="input" name="otStatus" value={form.otStatus} onChange={onChange}>
                                <option value="">Select status</option>
                                <option value="Yes">Yes</option>
                                <option value="No">No</option>
                              </select>
                            </div>
                          </div>
                        </div>
                        <div className="form-actions">
                          <button type="submit" className="btn btn-primary" disabled={submitting} onClick={saveCompOff}>
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
                  <div className="compoff-table-container" style={{ marginTop: 32 }}>
                    {(fetchState === 'loading') ? (
                      <div className="dF aI-center jC-center h-inh">
                        <div className="loader-lg"></div>
                      </div>
                    ) : fetchState === 'error' ? (
                      <div className="error-message">{fetchError}</div>
                    ) : (
                      <table className={`compoff-table ${selectedCompOffs.length === 0 ? 'edit-column-hidden' : ''}`} style={{ background: '#fff', boxShadow: '0 2px 4px rgba(0,0,0,0.06)' }}>
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
                          {filteredCompOffs.length ? (
                            filteredCompOffs.map((compoff, index) => (
                              <CompOffRow
                                key={compoff.id}
                                compoff={compoff}
                                index={index}
                                removeCompOff={removeCompOff}
                                editCompOff={editCompOff}
                                isSelected={selectedCompOffs.includes(compoff.id)}
                                onSelect={handleSelectCompOff}
                                selectedCompOffs={selectedCompOffs}
                              />
                            ))
                          ) : (
                            <tr>
                              <td colSpan={dynamicColumns.length} className="text-center">
                                No comp off records found. Adjust your search or add a new record.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    )}
                  </div>

                  {/* Pagination Controls */}
                  <div className="compoff-pagination" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '24px 0' }}>
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
                      Showing {compoffs.length} of {totalCompOffs || '?'} records
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

export default CompOff;
