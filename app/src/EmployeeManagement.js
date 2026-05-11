import './App.css';
import './helper.css';
import './employeeManagement.css';
import axios from 'axios';
import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import * as XLSX from 'xlsx'; // Import the xlsx library for Excel operations
import { Link, useLocation } from 'react-router-dom';
import HeaderBranding from './HeaderBranding';
import { getSidebarModulesForUser } from './modulesConfig';
import Button from './Button';

import {
  Users, Calendar, FileText, AlertTriangle, FolderOpen,
  ClipboardList, Building, Handshake, Landmark, Clock,
  BarChart3, User, TrendingUp, TrendingDown,
  Activity, Plus, CheckCircle, Bell, Settings, LayoutDashboard, Home as HomeIcon,
  Shield, AlertOctagon, CreditCard, FileSignature, Search, Clock3, Database, CalendarDays,
  FileInput, FileOutput, Filter, RefreshCw, Trash2, X
} from 'lucide-react';
// import DOMPurify from 'dompurify'; // Uncomment if you install DOMPurify for XSS sanitization

// Add a helper function at the top (after imports):
function formatDate(dateStr) {
  if (!dateStr) return '-';
  return String(dateStr).slice(0, 10);
}

// Helper: robust download via axios (handles auth cookies and blobs)
async function downloadBlobWithAxios(downloadUrl, fallbackName) {
  try {
    const response = await axios.get(downloadUrl, {
      responseType: 'blob',
      withCredentials: true,
      headers: { Accept: '*/*' }
    });

    // Try to extract filename from Content-Disposition
    let fileName = fallbackName || 'download';
    const disposition = response.headers && (response.headers['content-disposition'] || response.headers['Content-Disposition']);
    if (disposition) {
      const match = /filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i.exec(disposition);
      if (match) {
        fileName = decodeURIComponent(match[1] || match[2] || fileName);
      }
    }

    const blob = new Blob([response.data]);
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
    return true;
  } catch (err) {
    console.error('downloadBlobWithAxios error:', err);
    return false;
  }
}

/**
 * Directory / table: show Actual Total Salary from stored `totalSalary` when present; otherwise the same
 * sum as the employee form (Actual Basic + Actual HRA + Actual DA + Actual Special Allowance).
 */
function getActualTotalSalaryDisplay(employee) {
  if (!employee) return '-';
  const stored = employee.totalSalary ?? employee.TotalSalary;
  if (stored != null && stored !== '' && String(stored).trim() !== '') {
    const n = Number(stored);
    return Number.isFinite(n) ? String(n) : String(stored);
  }
  const parseComp = (v) => {
    if (v == null || v === '') return null;
    const x = parseFloat(v);
    return Number.isFinite(x) ? x : null;
  };
  const basic = parseComp(employee.actualBasic ?? employee.ActualBasic) ?? 0;
  const hra = parseComp(employee.actualHRA ?? employee.ActualHRA) ?? 0;
  const da = parseComp(employee.actualDA ?? employee.ActualDA) ?? 0;
  const special = parseComp(employee.actualSpecialAllowance ?? employee.ActualSpecialAllowance) ?? 0;
  const hasAnyComponent = [
    employee.actualBasic,
    employee.actualHRA,
    employee.actualDA,
    employee.actualSpecialAllowance,
    employee.ActualBasic,
    employee.ActualHRA,
    employee.ActualDA,
    employee.ActualSpecialAllowance
  ].some((v) => v != null && v !== '' && String(v).trim() !== '');
  const sum = Math.round((basic + hra + da + special) * 100) / 100;
  if (!hasAnyComponent && sum === 0) return '-';
  return String(sum);
}

// Employee Row Component
function EmployeeRow({ employee, index, removeEmployee, editEmployee, isSelected, onSelect }) {
  // Debug: Log emergency contact fields for first few rows
  if (index < 3) {
    console.log(`Employee ${index} emergency fields:`, {
      emergencyContactName: employee.emergencyContactName,
      emergencyContactAddress: employee.emergencyContactAddress,
      emergencyCity: employee.emergencyCity,
      emergencyState: employee.emergencyState,
      emergencyPostalCode: employee.emergencyPostalCode,
      employeeCode: employee.employeeCode,
      allKeys: Object.keys(employee).filter(k => k.includes('emergency') || k.includes('Emergency') || k === 'spouse')
    });
  }
 
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  // Function to download file
  const downloadFile = useCallback(async (employeeId, docType, fileName, event) => {
    // Store original text outside try block so it's accessible in catch
    const originalText = event?.target?.textContent;
   
    try {
      const downloadUrl = `/server/cms_function/employees/${employeeId}/file/${docType}`;
      console.log('Downloading file:', { downloadUrl, fileName, employeeId, docType });
     
      // Show loading indicator
      if (event?.target) {
        event.target.textContent = 'Downloading...';
        event.target.style.pointerEvents = 'none';
      }
     
      // Try axios blob approach (handles cookies and content-disposition)
      const axiosOk = await downloadBlobWithAxios(downloadUrl, fileName);
      if (!axiosOk) {
        console.log('Axios blob download failed, trying direct link.');
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = fileName || 'download';
        link.target = '_blank';
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        setTimeout(() => {
          if (document.body.contains(link)) document.body.removeChild(link);
        }, 100);
      }
     
      // Restore original text after a short delay
      setTimeout(() => {
        if (event?.target) {
          event.target.textContent = originalText;
          event.target.style.pointerEvents = 'auto';
        }
      }, 1000);
     
    } catch (error) {
      console.error('Download error:', error);
      alert(`Download failed: ${error.message}`);
     
      // Restore original text on error
      if (event?.target) {
        event.target.textContent = originalText;
        event.target.style.pointerEvents = 'auto';
      }
    }
  }, []);

  // Style for download links
  const downloadLinkStyle = {
    cursor: 'pointer',
    color: '#1976d2',
    textDecoration: 'underline',
    fontWeight: 500,
    transition: 'color 0.2s ease'
  };

  const handleLinkHover = (e, isEntering) => {
    if (isEntering) {
      e.target.style.color = '#0d47a1';
      e.target.style.textDecoration = 'underline';
    } else {
      e.target.style.color = '#1976d2';
      e.target.style.textDecoration = 'underline';
    }
  };

  const deleteEmployee = useCallback((e) => {
    e.stopPropagation(); // Prevent row click when clicking delete
    setDeleting(true);
    setDeleteError('');
    axios
      .delete(`/server/cms_function/employees/${employee.id}`, { timeout: 5000 })
      .then(() => {
        removeEmployee(employee.id);
      })
      .catch((err) => {
        const errorMessage = err.response?.data?.message || `Failed to delete employee (ID: ${employee.id}).`;
        setDeleteError(errorMessage);
        console.error('Delete employee error:', err);
      })
      .finally(() => setDeleting(false));
  }, [employee.id, removeEmployee]);

  const handleRowClick = useCallback(() => {
    editEmployee(employee);
  }, [editEmployee, employee]);

  const handleCheckboxClick = useCallback((e) => {
    e.stopPropagation(); // Prevent row click when clicking checkbox
    onSelect(employee.id);
  }, [onSelect, employee.id]);

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
      <td style={{ paddingRight: '20px', cursor: 'pointer', textAlign: 'center' }}>{index + 1}</td>
      <td
        className="col-employee-status"
        onClick={handleRowClick}
        style={{ cursor: 'pointer', paddingRight: '56px', minWidth: '160px', boxSizing: 'border-box' }}
      >
        {(() => {
          const status = employee.employeeStatus || '-';
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
            cursor: 'pointer',
            transition: 'transform 0.2s ease, box-shadow 0.2s ease'
          };
          if (status === 'Active') {
            style = { ...style, color: '#388e3c', borderColor: '#a5d6a7', background: '#e8f5e9' };
          } else if (status === 'Absconding') {
            style = { ...style, color: '#f57c00', borderColor: '#ffe0b2', background: '#fff3e0' };
          } else if (status === 'Resigned') {
            style = { ...style, color: '#1976d2', borderColor: '#bbdefb', background: '#e3f2fd' };
          } else if (status === 'Terminated') {
            style = { ...style, color: '#d32f2f', borderColor: '#ffcdd2', background: '#ffebee' };
          } else if (status === 'Deceased') {
            style = { ...style, color: '#6d4c41', borderColor: '#d7ccc8', background: '#efebe9' };
          } else {
            style = { ...style, color: '#757575', borderColor: '#e0e0e0', background: '#fafafa' };
          }
          return <span style={style}>{status}</span>;
        })()}
      </td>
      <td className="col-photo-file" style={{ paddingLeft: '56px', minWidth: '120px', boxSizing: 'border-box' }}>
        {employee.photoFileId && employee.photoFileName ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%' }}>
            <img
              src={`/server/cms_function/employees/${employee.id}/file/Photo`}
              alt="Employee Photo"
              style={{
                width: '60px',
                height: '60px',
                objectFit: 'cover',
                borderRadius: '8px',
                border: '2px solid #e0e0e0',
                boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                cursor: 'pointer',
                transition: 'transform 0.2s ease, box-shadow 0.2s ease'
              }}
              onError={(e) => {
                e.target.style.display = 'none';
                e.target.nextSibling.style.display = 'inline';
              }}
              onMouseEnter={(e) => {
                e.target.style.transform = 'scale(1.05)';
                e.target.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
              }}
              onMouseLeave={(e) => {
                e.target.style.transform = 'scale(1)';
                e.target.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)';
              }}
              onClick={() => {
                // Open photo in a larger view
                const newWindow = window.open(`/server/cms_function/employees/${employee.id}/file/Photo`, '_blank');
                if (newWindow) {
                  newWindow.focus();
                }
              }}
              title="Click to view larger image"
            />
            <span style={{ display: 'none', fontSize: '12px', color: '#666' }}>
              {employee.photoFileName}
            </span>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%' }}>
            <span style={{ color: '#aaa', fontSize: '12px' }}>No photo</span>
          </div>
        )}
      </td>
      <td>{employee.employeeCode || '-'}</td>
      <td>{employee.employeeName || '-'}</td>
      <td>{employee.personalEmail || '-'}</td>
      <td>{employee.phone || '-'}</td>
      <td>{employee.employmentType || '-'}</td>
      <td>{formatDate(employee.dateOfJoining)}</td>
      <td>{formatDate(employee.dateOfExit)}</td>
      <td>{employee.overallExperience || '-'}</td>
      <td>{employee.relevantExperience || '-'}</td>
      <td>{employee.sourceOfHire || '-'}</td>
      <td>{employee.department || '-'}</td>
      <td>{employee.designation || '-'}</td>
      <td>{employee.category || '-'}</td>
      <td>{employee.pfNo || '-'}</td>
      <td>{employee.esicNo || '-'}</td>
      <td>{employee.pfStatus || '-'}</td>
      <td>{employee.esiStatus || '-'}</td>
      <td>{employee.location || '-'}</td>
      <td>{employee.gradeLevel || '-'}</td>
      <td>{employee.uanNo || '-'}</td>
      <td>{employee.aadhaarNumber || '-'}</td>
      <td>{employee.panNumber || '-'}</td>
      <td>{employee.actualBasic != null && employee.actualBasic !== '' ? employee.actualBasic : '-'}</td>
      <td>{employee.actualHRA != null && employee.actualHRA !== '' ? employee.actualHRA : '-'}</td>
      <td>{employee.actualSpecialAllowance != null && employee.actualSpecialAllowance !== '' ? employee.actualSpecialAllowance : '-'}</td>
      <td>{employee.actualDA != null && employee.actualDA !== '' ? employee.actualDA : '-'}</td>
      <td>{employee.attendanceAllowance != null && employee.attendanceAllowance !== '' ? employee.attendanceAllowance : '-'}</td>
      <td>{employee.otherAllowance != null && employee.otherAllowance !== '' ? employee.otherAllowance : '-'}</td>
      <td>{employee.travelChargers != null && employee.travelChargers !== '' ? employee.travelChargers : '-'}</td>
      <td>{employee.foodAllowance != null && employee.foodAllowance !== '' ? employee.foodAllowance : '-'}</td>
      <td>{employee.uniformAllowance != null && employee.uniformAllowance !== '' ? employee.uniformAllowance : '-'}</td>
      <td>{getActualTotalSalaryDisplay(employee)}</td>
      <td>{formatDate(employee.dateOfBirth)}</td>
      <td>{employee.fathersName || '-'}</td>
      <td>{employee.age || '-'}</td>
      <td>{employee.emergencyContactNumber || '-'}</td>
      <td>{employee.emergencyContactName || '-'}</td>
      <td>{employee.emergencyContactAddress || '-'}</td>
      <td>{employee.emergencyCity || '-'}</td>
      <td>{employee.emergencyState || '-'}</td>
      <td>{employee.emergencyPostalCode || '-'}</td>
      <td>{employee.spouse || '-'}</td>
      <td>{employee.gender || '-'}</td>
      <td>{employee.bloodGroup || '-'}</td>
      <td>{employee.maritalStatus || '-'}</td>
      <td>{employee.presentAddressLine1 || '-'}</td>
      <td>{employee.presentAddressLine2 || '-'}</td>
      <td>{employee.presentCity || '-'}</td>
      <td>{employee.presentState || '-'}</td>
      <td>{employee.presentPostalCode || '-'}</td>
      <td>{employee.presentCountry || '-'}</td>
      <td>{employee.permanentAddressLine1 || '-'}</td>
      <td>{employee.permanentAddressLine2 || '-'}</td>
      <td>{employee.permanentCity || '-'}</td>
      <td>{employee.permanentState || '-'}</td>
      <td>{employee.permanentPostalCode || '-'}</td>
      <td>{employee.permanentCountry || '-'}</td>
      <td>{employee.bankHolderName || '-'}</td>
      <td>{employee.bankName || '-'}</td>
      <td>{employee.accountNumber || '-'}</td>
      <td>{employee.ifscCode || '-'}</td>
      <td>{employee.bankBranch || '-'}</td>
      <td>
        {(() => {
          const eduDetails = employee.educationDetails && Array.isArray(employee.educationDetails) && employee.educationDetails.length > 0
            ? employee.educationDetails
            : (employee.qualification || employee.institutionName || employee.fieldOfStudy || employee.yearOfCompletion || employee.percentageMarks
              ? [{ qualification: employee.qualification, institutionName: employee.institutionName, fieldOfStudy: employee.fieldOfStudy, yearOfCompletion: employee.yearOfCompletion, percentageMarks: employee.percentageMarks }]
              : []);
          return eduDetails.length > 0 ? (
            <div style={{ maxWidth: '200px' }}>
              {eduDetails.map((edu, idx) => (
                <div key={idx} style={{ marginBottom: idx < eduDetails.length - 1 ? '4px' : '0', fontSize: '12px' }}>
                  {edu.qualification || '-'}
                </div>
              ))}
            </div>
          ) : '-';
        })()}
      </td>
      <td>
        {(() => {
          const eduDetails = employee.educationDetails && Array.isArray(employee.educationDetails) && employee.educationDetails.length > 0
            ? employee.educationDetails
            : (employee.qualification || employee.institutionName || employee.fieldOfStudy || employee.yearOfCompletion || employee.percentageMarks
              ? [{ qualification: employee.qualification, institutionName: employee.institutionName, fieldOfStudy: employee.fieldOfStudy, yearOfCompletion: employee.yearOfCompletion, percentageMarks: employee.percentageMarks }]
              : []);
          return eduDetails.length > 0 ? (
            <div style={{ maxWidth: '200px' }}>
              {eduDetails.map((edu, idx) => (
                <div key={idx} style={{ marginBottom: idx < eduDetails.length - 1 ? '4px' : '0', fontSize: '12px' }}>
                  {edu.institutionName || '-'}
                </div>
              ))}
            </div>
          ) : '-';
        })()}
      </td>
      <td>
        {(() => {
          const eduDetails = employee.educationDetails && Array.isArray(employee.educationDetails) && employee.educationDetails.length > 0
            ? employee.educationDetails
            : (employee.qualification || employee.institutionName || employee.fieldOfStudy || employee.yearOfCompletion || employee.percentageMarks
              ? [{ qualification: employee.qualification, institutionName: employee.institutionName, fieldOfStudy: employee.fieldOfStudy, yearOfCompletion: employee.yearOfCompletion, percentageMarks: employee.percentageMarks }]
              : []);
          return eduDetails.length > 0 ? (
            <div style={{ maxWidth: '200px' }}>
              {eduDetails.map((edu, idx) => (
                <div key={idx} style={{ marginBottom: idx < eduDetails.length - 1 ? '4px' : '0', fontSize: '12px' }}>
                  {edu.fieldOfStudy || '-'}
                </div>
              ))}
            </div>
          ) : '-';
        })()}
      </td>
      <td>
        {(() => {
          const eduDetails = employee.educationDetails && Array.isArray(employee.educationDetails) && employee.educationDetails.length > 0
            ? employee.educationDetails
            : (employee.qualification || employee.institutionName || employee.fieldOfStudy || employee.yearOfCompletion || employee.percentageMarks
              ? [{ qualification: employee.qualification, institutionName: employee.institutionName, fieldOfStudy: employee.fieldOfStudy, yearOfCompletion: employee.yearOfCompletion, percentageMarks: employee.percentageMarks }]
              : []);
          return eduDetails.length > 0 ? (
            <div style={{ maxWidth: '200px' }}>
              {eduDetails.map((edu, idx) => (
                <div key={idx} style={{ marginBottom: idx < eduDetails.length - 1 ? '4px' : '0', fontSize: '12px' }}>
                  {edu.yearOfCompletion || '-'}
                </div>
              ))}
            </div>
          ) : '-';
        })()}
      </td>
      <td>
        {(() => {
          const eduDetails = employee.educationDetails && Array.isArray(employee.educationDetails) && employee.educationDetails.length > 0
            ? employee.educationDetails
            : (employee.qualification || employee.institutionName || employee.fieldOfStudy || employee.yearOfCompletion || employee.percentageMarks
              ? [{ qualification: employee.qualification, institutionName: employee.institutionName, fieldOfStudy: employee.fieldOfStudy, yearOfCompletion: employee.yearOfCompletion, percentageMarks: employee.percentageMarks }]
              : []);
          return eduDetails.length > 0 ? (
            <div style={{ maxWidth: '200px' }}>
              {eduDetails.map((edu, idx) => (
                <div key={idx} style={{ marginBottom: idx < eduDetails.length - 1 ? '4px' : '0', fontSize: '12px' }}>
                  {edu.percentageMarks || '-'}
                </div>
              ))}
            </div>
          ) : '-';
        })()}
      </td>
      <td>{employee.addedUser || '-'}</td>
      <td>{employee.modifiedUser || '-'}</td>
      <td>{employee.addedTime ? String(employee.addedTime).replace('T', ' ').slice(0, 19) : '-'}</td>
      <td>{employee.modifiedTime ? String(employee.modifiedTime).replace('T', ' ').slice(0, 19) : '-'}</td>
      <td>
        {employee.aadharCopyFileId && employee.aadharCopyFileName ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span
              style={downloadLinkStyle}
              onClick={(e) => {
                e.stopPropagation();
                downloadFile(employee.id, 'AadharCopy', employee.aadharCopyFileName, e);
              }}
              onMouseEnter={(e) => handleLinkHover(e, true)}
              onMouseLeave={(e) => handleLinkHover(e, false)}
              title="Click to download file"
            >
              {employee.aadharCopyFileName}
            </span>
            <i
              className="fas fa-download"
              style={{
                color: '#1976d2',
                cursor: 'pointer',
                fontSize: '12px',
                opacity: 0.7
              }}
              onClick={(e) => {
                e.stopPropagation();
                downloadFile(employee.id, 'AadharCopy', employee.aadharCopyFileName, e);
              }}
              title="Download file"
            ></i>
          </div>
        ) : (
          <span style={{ color: '#aaa' }}>No file</span>
        )}
      </td>
      <td>
        {employee.educationalCertificatesFileId && employee.educationalCertificatesFileName ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span
              style={downloadLinkStyle}
              onClick={(e) => {
                e.stopPropagation();
                downloadFile(employee.id, 'EducationalCertificates', employee.educationalCertificatesFileName, e);
              }}
              onMouseEnter={(e) => handleLinkHover(e, true)}
              onMouseLeave={(e) => handleLinkHover(e, false)}
              title="Click to download file"
            >
              {employee.educationalCertificatesFileName}
            </span>
            <i
              className="fas fa-download"
              style={{
                color: '#1976d2',
                cursor: 'pointer',
                fontSize: '12px',
                opacity: 0.7
              }}
              onClick={(e) => {
                e.stopPropagation();
                downloadFile(employee.id, 'EducationalCertificates', employee.educationalCertificatesFileName, e);
              }}
              title="Download file"
            ></i>
          </div>
        ) : (
          <span style={{ color: '#aaa' }}>No file</span>
        )}
      </td>
      <td>
        {employee.bankPassbookFileId && employee.bankPassbookFileName ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span
              style={downloadLinkStyle}
              onClick={(e) => {
                e.stopPropagation();
                downloadFile(employee.id, 'BankPassbook', employee.bankPassbookFileName, e);
              }}
              onMouseEnter={(e) => handleLinkHover(e, true)}
              onMouseLeave={(e) => handleLinkHover(e, false)}
              title="Click to download file"
            >
              {employee.bankPassbookFileName}
            </span>
            <i
              className="fas fa-download"
              style={{
                color: '#1976d2',
                cursor: 'pointer',
                fontSize: '12px',
                opacity: 0.7
              }}
              onClick={(e) => {
                e.stopPropagation();
                downloadFile(employee.id, 'BankPassbook', employee.bankPassbookFileName, e);
              }}
              title="Download file"
            ></i>
          </div>
        ) : (
          <span style={{ color: '#aaa' }}>No file</span>
        )}
      </td>
      <td>
        {employee.experienceCertificateFileId && employee.experienceCertificateFileName ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span
              style={downloadLinkStyle}
              onClick={(e) => {
                e.stopPropagation();
                downloadFile(employee.id, 'ExperienceCertificate', employee.experienceCertificateFileName, e);
              }}
              onMouseEnter={(e) => handleLinkHover(e, true)}
              onMouseLeave={(e) => handleLinkHover(e, false)}
              title="Click to download file"
            >
              {employee.experienceCertificateFileName}
            </span>
            <i
              className="fas fa-download"
              style={{
                color: '#1976d2',
                cursor: 'pointer',
                fontSize: '12px',
                opacity: 0.7
              }}
              onClick={(e) => {
                e.stopPropagation();
                downloadFile(employee.id, 'ExperienceCertificate', employee.experienceCertificateFileName, e);
              }}
              title="Download file"
            ></i>
          </div>
        ) : (
          <span style={{ color: '#aaa' }}>No file</span>
        )}
      </td>
      <td>
        {employee.pANCardFileId && employee.pANCardFileName ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span
              style={downloadLinkStyle}
              onClick={(e) => {
                e.stopPropagation();
                downloadFile(employee.id, 'PANCard', employee.pANCardFileName, e);
              }}
              onMouseEnter={(e) => handleLinkHover(e, true)}
              onMouseLeave={(e) => handleLinkHover(e, false)}
              title="Click to download file"
            >
              {employee.pANCardFileName}
            </span>
            <i
              className="fas fa-download"
              style={{
                color: '#1976d2',
                cursor: 'pointer',
                fontSize: '12px',
                opacity: 0.7
              }}
              onClick={(e) => {
                e.stopPropagation();
                downloadFile(employee.id, 'PANCard', employee.pANCardFileName, e);
              }}
              title="Download file"
            ></i>
          </div>
        ) : (
          <span style={{ color: '#aaa' }}>No file</span>
        )}
      </td>
      <td>
        {employee.resumeFileId && employee.resumeFileName ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span
              style={downloadLinkStyle}
              onClick={(e) => {
                e.stopPropagation();
                downloadFile(employee.id, 'Resume', employee.resumeFileName, e);
              }}
              onMouseEnter={(e) => handleLinkHover(e, true)}
              onMouseLeave={(e) => handleLinkHover(e, false)}
              title="Click to download file"
            >
              {employee.resumeFileName}
            </span>
            <i
              className="fas fa-download"
              style={{
                color: '#1976d2',
                cursor: 'pointer',
                fontSize: '12px',
                opacity: 0.7
              }}
              onClick={(e) => {
                e.stopPropagation();
                downloadFile(employee.id, 'Resume', employee.resumeFileName, e);
              }}
              title="Download file"
            ></i>
          </div>
        ) : (
          <span style={{ color: '#aaa' }}>No file</span>
        )}
      </td>
    </tr>
  );
}

// Employee Management Component
function EmployeeManagement({ userRole = 'App Administrator', userEmail = null }) {
  const [employees, setEmployees] = useState([]);
  const [filteredEmployees, setFilteredEmployees] = useState([]);
  const [fetchState, setFetchState] = useState('init');
  const [fetchError, setFetchError] = useState('');
  const [selectedEmployees, setSelectedEmployees] = useState([]);
  const [deletingMultiple, setDeletingMultiple] = useState(false);
  const [massDeleteError, setMassDeleteError] = useState('');
 
  // Calculate if all employees are selected
  const allSelected = filteredEmployees.length > 0 && selectedEmployees.length === filteredEmployees.length;
  const someSelected = selectedEmployees.length > 0 && selectedEmployees.length < filteredEmployees.length;
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importError, setImportError] = useState('');
  const [exportError, setExportError] = useState('');
  const fileInputRef = useRef(null);
  const [employeeCodes, setEmployeeCodes] = useState([]);
  const [employeeCodeSearch, setEmployeeCodeSearch] = useState('');
  const [isEmployeeCodeDropdownOpen, setIsEmployeeCodeDropdownOpen] = useState(false);
  const [loadingEmployeeCodes, setLoadingEmployeeCodes] = useState(false);
 
  // Dropdown states for other fields
  const [employeeNames, setEmployeeNames] = useState([]);
  const [employeeNameSearch, setEmployeeNameSearch] = useState('');
  const [isEmployeeNameDropdownOpen, setIsEmployeeNameDropdownOpen] = useState(false);
  const [loadingEmployeeNames, setLoadingEmployeeNames] = useState(false);
 
  const [contractors, setContractors] = useState([]);
  const [contractorSearch, setContractorSearch] = useState('');
  const [isContractorDropdownOpen, setIsContractorDropdownOpen] = useState(false);
  const [loadingContractors, setLoadingContractors] = useState(false);
 
 
 
  const [employmentTypes, setEmploymentTypes] = useState([]);
  const [employmentTypeSearch, setEmploymentTypeSearch] = useState('');
  const [isEmploymentTypeDropdownOpen, setIsEmploymentTypeDropdownOpen] = useState(false);
  const [loadingEmploymentTypes, setLoadingEmploymentTypes] = useState(false);
 
  const [exitDates, setExitDates] = useState([]);
  const [exitDateSearch, setExitDateSearch] = useState('');
  const [isExitDateDropdownOpen, setIsExitDateDropdownOpen] = useState(false);
  const [loadingExitDates, setLoadingExitDates] = useState(false);
 
  const [genders, setGenders] = useState([]);
  const [genderSearch, setGenderSearch] = useState('');
  const [isGenderDropdownOpen, setIsGenderDropdownOpen] = useState(false);
  const [loadingGenders, setLoadingGenders] = useState(false);
  const location = useLocation();

  // Force contractor for specific user emails
  const forcedContractor = useMemo(() => {
    const map = {
      'afrindinusha@gmail.com': 'R.P.D Facility Management Services',
      'rpdmanpowerservice@gmail.com': 'R.P.D Facility Management Services',
      'ramachandran23488@gmail.com': 'R.P.D Facility Management Services',
      'afrindinusha29@gmail.com': 'Sriram enterprises', // DB spelling
      'sriramenterprises50@yahoo.com': 'Sriram enterprises', // DB spelling
      'afrinatlin@gmail.com': 'Samuel Enterprise',
      'samuelenterprisesms@gmail.com': 'Samuel Enterprise',
      'afrindinu14@gmail.com': 'Yashaswi Academy for Skills',
      'vaishnavi.a@buildhr.co.in': 'Yashaswi Academy for Skills',
    };
    return map[(userEmail || '').toLowerCase()] || null;
  }, [userEmail]);
  const [searchFields, setSearchFields] = useState({
    // Basic Information
    employeeCode: { enabled: false, selectedCode: '' },
    employeeName: { enabled: false, selectedName: '' },
    personalEmail: { enabled: false, value: '' },
    phone: { enabled: false, value: '' },
    dateOfJoining: { enabled: false, value: '' },
    dateOfExit: { enabled: false, selectedExitDate: '' },
    employmentType: { enabled: false, selectedEmploymentType: '' },
    department: { enabled: false, value: '' },
    designation: { enabled: false, value: '' },
    location: { enabled: false, value: '' },
    gradeLevel: { enabled: false, value: '' },
    reportingTo: { enabled: false, value: '' },
   
    // Personal Information
    dateOfBirth: { enabled: false, value: '' },
    age: { enabled: false, value: '' },
    gender: { enabled: false, selectedGender: '' },
    bloodGroup: { enabled: false, value: '' },
    maritalStatus: { enabled: false, mode: 'is', value: '' },
    fathersName: { enabled: false, value: '' },
   
    // Contact Information
    secondaryContactNumber: { enabled: false, value: '' },
    emergencyContactNumber: { enabled: false, value: '' },
    emergencyContactName: { enabled: false, value: '' },
    emergencyContactAddress: { enabled: false, value: '' },
    emergencyCity: { enabled: false, value: '' },
    emergencyState: { enabled: false, value: '' },
    emergencyPostalCode: { enabled: false, value: '' },
    spouse: { enabled: false, value: '' },
   
    // Address Information - Present
    presentAddressLine1: { enabled: false, value: '' },
    presentAddressLine2: { enabled: false, value: '' },
    presentCity: { enabled: false, value: '' },
    presentState: { enabled: false, value: '' },
    presentPostalCode: { enabled: false, value: '' },
    presentCountry: { enabled: false, value: '' },
   
    // Address Information - Permanent
    permanentAddressLine1: { enabled: false, value: '' },
    permanentAddressLine2: { enabled: false, value: '' },
    permanentCity: { enabled: false, value: '' },
    permanentState: { enabled: false, value: '' },
    permanentPostalCode: { enabled: false, value: '' },
    permanentCountry: { enabled: false, value: '' },
   
    // Government IDs
    aadhaarNumber: { enabled: false, value: '' },
    panNumber: { enabled: false, value: '' },
    uanNo: { enabled: false, value: '' },
    pfNo: { enabled: false, value: '' },
    esicNo: { enabled: false, value: '' },
    drivingLicenseNumber: { enabled: false, value: '' },
    drivingLicenseExpiryDate: { enabled: false, value: '' },
    bankHolderName: { enabled: false, value: '' },
    bankName: { enabled: false, value: '' },
    ifscCode: { enabled: false, value: '' },
    bankBranch: { enabled: false, value: '' },
   
    // Professional Information
    overallExperience: { enabled: false, value: '' },
    relevantExperience: { enabled: false, value: '' },
    sourceOfHire: { enabled: false, value: '' },
  });
  const dropdownRef = useRef(null);

  // Pagination state
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(50);
  const [totalPages, setTotalPages] = useState(1);
  const [totalEmployees, setTotalEmployees] = useState(0);
  const [showAll, setShowAll] = useState(false); // Add state for showing all records

  // Add missing state variables for departments and designations
  const [departments, setDepartments] = useState([]);
  const [designations, setDesignations] = useState([]);

  const [form, setForm] = useState({
    employeeCode: '',
    employeeName: '',
    personalEmail: '',
    phone: '',
    contractor: '',
    dateOfJoining: '',
    dateOfExit: '',
    employmentType: '',
    overallExperience: '',
    relevantExperience: '',
    sourceOfHire: '',
    department: '',
    designation: '',
    pfNo: '',
    esicNo: '',
    pfStatus: '',
    esiStatus: '',
    location: '',
    gradeLevel: '',
    uanNo: '',
    reportingTo: '',
    hrPartner: '',
    nationalHead: '',
    dateOfBirth: '',
    fathersName: '',
    age: '',
    emergencyContactNumber: '',
    emergencyContactName: '',
    emergencyContactAddress: '',
    emergencyCity: '',
    emergencyState: '',
    emergencyPostalCode: '',
    spouse: '',
    gender: '',
    bloodGroup: '',
    maritalStatus: '',
    presentAddressLine1: '',
    presentAddressLine2: '',
    presentCity: '',
    presentState: '',
    presentPostalCode: '',
    presentCountry: '',
    permanentAddressLine1: '',
    permanentAddressLine2: '',
    permanentCity: '',
    permanentState: '',
    permanentPostalCode: '',
    permanentCountry: '',
    // Add fileId and fileName fields for all document types to form state
    photoFileId: '',
    photoFileName: '',
    aadharCopyFileId: '',
    aadharCopyFileName: '',
    educationalCertificatesFileId: '',
    educationalCertificatesFileName: '',
    bankPassbookFileId: '',
    bankPassbookFileName: '',
    experienceCertificateFileId: '',
    experienceCertificateFileName: '',
    pANCardFileId: '',
    pANCardFileName: '',
    resumeFileId: '',
    resumeFileName: '',
    // Salary Info fields
    actualBasic: '',
    actualHRA: '',
    actualSpecialAllowance: '',
    actualDA: '',
    attendanceAllowance: '',
    otherAllowance: '',
    travelChargers: '',
    foodAllowance: '',
    uniformAllowance: '',
    totalSalary: '',
    // Salary Revised Details fields
    revisedActualBasic: '',
    revisedActualHRA: '',
    revisedActualDA: '',
    revisedOtherAllowance: '',
    monthData: '',
    dateData: '',
    revisedTotalSalary: '',
    aadhaarNumber: '',
    panNumber: '',
    employeeStatus: '',
    category: '',
    secondaryContactNumber: '',
    drivingLicenseNumber: '',
    drivingLicenseExpiryDate: '',
    bankHolderName: '',
    bankName: '',
    accountNumber: '',
    ifscCode: '',
    bankBranch: '',
    educationDetails: [
      { qualification: '', institutionName: '', fieldOfStudy: '', yearOfCompletion: '', percentageMarks: '' }
    ],
  });
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editingEmployeeId, setEditingEmployeeId] = useState(null);

  // Add refs for dropdowns at the top of EmployeeManagement

  // Add state for Same as Present Address
  const [sameAsPresent, setSameAsPresent] = useState(false);

  // Add handler for checkbox
  const handleSameAsPresentChange = (e) => {
    const checked = e.target.checked;
    setSameAsPresent(checked);
    if (checked) {
      setForm((prev) => ({
        ...prev,
        permanentAddressLine1: prev.presentAddressLine1,
        permanentAddressLine2: prev.presentAddressLine2,
        permanentCity: prev.presentCity,
        permanentState: prev.presentState,
        permanentPostalCode: prev.presentPostalCode,
        permanentCountry: prev.presentCountry,
      }));
    }
  };

  // Sync Permanent Address if sameAsPresent is checked and Present Address changes
  useEffect(() => {
    if (sameAsPresent) {
      setForm((prev) => ({
        ...prev,
        permanentAddressLine1: prev.presentAddressLine1,
        permanentAddressLine2: prev.presentAddressLine2,
        permanentCity: prev.presentCity,
        permanentState: prev.presentState,
        permanentPostalCode: prev.presentPostalCode,
        permanentCountry: prev.presentCountry,
      }));
    }
  }, [sameAsPresent, form.presentAddressLine1, form.presentAddressLine2, form.presentCity, form.presentState, form.presentPostalCode, form.presentCountry]);

  // Fetch employees with pagination
  const fetchEmployees = useCallback(() => {
    setFetchState('loading');
    setFetchError('');
   
    // If showAll is true, fetch all records without pagination
    const params = showAll ? {} : { page, perPage };
   
    // Add user role and email for contractor filtering
    if (userRole && userEmail) {
      params.userRole = userRole;
      params.userEmail = userEmail;
    }
   
    console.log('EmployeeManagement API call params:', params);
    console.log('Full API URL:', `/server/cms_function/employees?${new URLSearchParams(params).toString()}`);
   
    axios
      .get('/server/cms_function/employees', { params, timeout: 30000 })
      .then((response) => {
        console.log('EmployeeManagement API response:', response.data);
        if (!response?.data) {
          throw new Error('No response data received from server');
        }
        if (response.data.status === 'failure') {
          throw new Error(response.data.message || 'API returned failure status');
        }
        if (!response?.data?.data?.employees) {
          throw new Error('Unexpected API response structure - employees array not found');
        }
        const fetchedEmployees = response.data.data.employees || [];
        console.log('Fetched employees count:', fetchedEmployees.length);
        console.log('Sample employee:', fetchedEmployees[0]);
        // Debug: Check education details in first employee
        if (fetchedEmployees.length > 0) {
          console.log('Education details in first employee:', JSON.stringify(fetchedEmployees[0].educationDetails));
          console.log('Has educationDetails:', !!fetchedEmployees[0].educationDetails);
          console.log('Education details type:', typeof fetchedEmployees[0].educationDetails);
          console.log('Education details is array:', Array.isArray(fetchedEmployees[0].educationDetails));
        }
        // Debug: Check emergency contact fields
        if (fetchedEmployees.length > 0) {
          console.log('Emergency contact fields in first employee:', {
            emergencyContactName: fetchedEmployees[0].emergencyContactName,
            emergencyContactAddress: fetchedEmployees[0].emergencyContactAddress,
            emergencyCity: fetchedEmployees[0].emergencyCity,
            emergencyState: fetchedEmployees[0].emergencyState,
            emergencyPostalCode: fetchedEmployees[0].emergencyPostalCode,
            allKeys: Object.keys(fetchedEmployees[0])
          });
        }
        if (!Array.isArray(fetchedEmployees)) {
          throw new Error('Employees data is not an array');
        }
        // Restrict view to specific contractor employees for specific user emails
        const shouldRestrictToYashaswi = (userEmail || '').toLowerCase() === 'afrindinu14@gmail.com' || (userEmail || '').toLowerCase() === 'vaishnavi.a@buildhr.co.in';
        const shouldRestrictToSriBalaji = (userEmail || '').toLowerCase() === 'dinushaafrin@gmail.com' || (userEmail || '').toLowerCase() === 'vijaybalaji701@gmail.com';
        const shouldRestrictToSamuel = (userEmail || '').toLowerCase() === 'afrinatlin@gmail.com' || (userEmail || '').toLowerCase() === 'samuelenterprisesms@gmail.com';
        const shouldRestrictToRPD = (userEmail || '').toLowerCase() === 'afrindinusha@gmail.com' || (userEmail || '').toLowerCase() === 'rpdmanpowerservice@gmail.com' || (userEmail || '').toLowerCase() === 'ramachandran23488@gmail.com';
        const shouldRestrictToSriram = (userEmail || '').toLowerCase() === 'afrindinusha29@gmail.com' || (userEmail || '').toLowerCase() === 'sriramenterprises50@yahoo.com';
       
        // Debug logging for contractor filtering
        console.log('=== EMPLOYEE FILTERING DEBUG ===');
        console.log('User email:', userEmail);
        console.log('Should restrict to Yashaswi:', shouldRestrictToYashaswi);
        console.log('Should restrict to Sri Balaji:', shouldRestrictToSriBalaji);
        console.log('Should restrict to Samuel:', shouldRestrictToSamuel);
        console.log('Should restrict to R.P.D:', shouldRestrictToRPD);
        console.log('Should restrict to Sriram:', shouldRestrictToSriram);
        console.log('Total fetched employees:', fetchedEmployees.length);
       
        // Log first few contractor names for debugging
        const contractorNames = fetchedEmployees.slice(0, 5).map(emp => ({
          employeeCode: emp.employeeCode,
          contractor: emp.contractor,
          contractorName: emp.contractorName
        }));
        console.log('Sample contractor names:', contractorNames);
       
        let filteredEmployees = fetchedEmployees;
       
        if (shouldRestrictToYashaswi) {
          filteredEmployees = fetchedEmployees.filter(emp => {
            const contractorName = ((emp && (emp.contractor || emp.contractorName)) || '')
              .toString()
              .toLowerCase()
              .replace(/\s+/g, ' ')
              .trim();
            const matches = contractorName === 'yashaswi academy for skills';
            console.log(`Yashaswi filter - Employee ${emp.employeeCode}: contractor="${contractorName}", matches=${matches}`);
            return matches;
          });
        }
       
        if (shouldRestrictToSriBalaji) {
          filteredEmployees = fetchedEmployees.filter(emp => {
            const rawContractor = ((emp && (emp.contractor || emp.contractorName)) || '').toString().toLowerCase();
            // Normalize: collapse multiple spaces, remove dots, trim
            const contractorName = rawContractor.replace(/\.+/g, '').replace(/\s+/g, ' ').trim();
            // Match broadly for any variation like 'Sri Balaji', 'Sri  Balaji', etc.
            const matches = contractorName.includes('sri balaji');
            console.log(`Sri Balaji filter - Employee ${emp.employeeCode}: contractor="${rawContractor}" => normalized="${contractorName}", matches=${matches}`);
            return matches;
          });
        }
       
        if (shouldRestrictToSamuel) {
          filteredEmployees = fetchedEmployees.filter(emp => {
            const rawContractor = ((emp && (emp.contractor || emp.contractorName)) || '').toString().toLowerCase();
            // Normalize: collapse multiple spaces, remove dots, trim
            const contractorName = rawContractor.replace(/\.+/g, '').replace(/\s+/g, ' ').trim();
            // Match broadly for any variation like 'Samuel Enterprise', 'Samuel  Enterprise', etc.
            const matches = contractorName.includes('samuel enterprise');
            console.log(`Samuel filter - Employee ${emp.employeeCode}: contractor="${rawContractor}" => normalized="${contractorName}", matches=${matches}`);
            return matches;
          });
        }
       
        if (shouldRestrictToRPD) {
          filteredEmployees = fetchedEmployees.filter(emp => {
            const rawContractor = ((emp && (emp.contractor || emp.contractorName)) || '').toString().toLowerCase();
            // Normalize: collapse multiple spaces, trim
            const contractorName = rawContractor.replace(/\s+/g, ' ').trim();
            // Match R.P.D Facility Management Services - check for both "r.p.d" and "facility" or exact match
            const matches = contractorName.includes('r.p.d') && contractorName.includes('facility');
            console.log(`R.P.D filter - Employee ${emp.employeeCode}: contractor="${rawContractor}" => normalized="${contractorName}", matches=${matches}`);
            return matches;
          });
        }
       
        if (shouldRestrictToSriram) {
          filteredEmployees = fetchedEmployees.filter(emp => {
            const rawContractor = ((emp && (emp.contractor || emp.contractorName)) || '').toString().toLowerCase();
            // Normalize: collapse multiple spaces, trim
            const contractorName = rawContractor.replace(/\s+/g, ' ').trim();
            // Match Sriram Enterprises - can be "Sriram enterprises" or "Sriram Enterprises"
            const matches = contractorName.includes('sriram');
            console.log(`Sriram filter - Employee ${emp.employeeCode}: contractor="${rawContractor}" => normalized="${contractorName}", matches=${matches}`);
            return matches;
          });
        }
       
        console.log('Filtered employees count:', filteredEmployees.length);
        console.log('=== END FILTERING DEBUG ===');

        // Remove DOB proof file fields if present in API response
        const stripDobProofFields = (emp) => {
          if (!emp || typeof emp !== 'object') return emp;
          // Support both camelCase and raw DB-style names
          const { dobProofFileId, dobProofFileName, DOBProofFileId, DOBProofFileName, ...rest } = emp;
          return rest;
        };
        const sanitizedEmployees = filteredEmployees.map(stripDobProofFields);
        
        // Debug: Verify emergency contact fields are preserved
        if (sanitizedEmployees.length > 0) {
          console.log('Before setting state - First employee emergency fields:', {
            emergencyContactName: sanitizedEmployees[0].emergencyContactName,
            emergencyContactAddress: sanitizedEmployees[0].emergencyContactAddress,
            emergencyCity: sanitizedEmployees[0].emergencyCity,
            emergencyState: sanitizedEmployees[0].emergencyState,
            emergencyPostalCode: sanitizedEmployees[0].emergencyPostalCode,
            rawEmployee: sanitizedEmployees[0]
          });
        }

        setEmployees(sanitizedEmployees);
        setFilteredEmployees(sanitizedEmployees);
        // Pagination info
        const hasMore = response.data.data.hasMore;
        const total = response.data.data.total || 0;
        setTotalEmployees(total);
        // Calculate total pages based on total count and perPage
        if (total && perPage && !showAll) {
          setTotalPages(Math.ceil(total / perPage));
        } else {
          // Fallback: if no total available, use hasMore to estimate
          setTotalPages(hasMore ? page + 1 : page);
        }
        setFetchState('fetched');
      })
      .catch((err) => {
        console.error('Fetch employees error:', err);
        console.error('Error response:', err.response);
        console.error('Error message:', err.message);
       
        let errorMessage = 'Failed to fetch employees. Please try again later.';
       
        if (err.code === 'ECONNABORTED' || err.message?.includes('timeout')) {
          errorMessage = 'Request timed out. Please try again.';
        } else if (err.response?.data?.message) {
          errorMessage = err.response.data.message;
        } else if (err.message) {
          errorMessage = err.message;
        }
       
        setFetchError(errorMessage);
        setFetchState('error');
      });
  }, [page, perPage, showAll, userRole, userEmail]);

  useEffect(() => {
    fetchEmployees();
  }, [fetchEmployees]);

  // Automatically show all employees (no pagination) for admin/app users and Gmail users
  useEffect(() => {
    const emailsWithoutPagination = [
      'afrindinusha29@gmail.com',
      'sriramenterprises50@yahoo.com',
      'afrinatlin@gmail.com',
      'samuelenterprisesms@gmail.com',
      'ssindus@gmail.com',
      'kyrarebagame@gmail.com'
    ];
    const isAdminOrAppUser = userRole === 'App Administrator' || userRole === 'App User';
    const isGmailUser = userEmail && (userEmail || '').toLowerCase().includes('@gmail.com');
    const isInPaginationList = userEmail && emailsWithoutPagination.includes((userEmail || '').toLowerCase());
   
    if (isAdminOrAppUser || isGmailUser || isInPaginationList) {
      setShowAll(true);
      setPage(1);
    }
  }, [userEmail, userRole]);

  // Auto-calculate Revised Total Salary when revised salary components change (for loaded/imported data)
  useEffect(() => {
    const revisedActualBasic = parseFloat(form.revisedActualBasic) || 0;
    const revisedActualHRA = parseFloat(form.revisedActualHRA) || 0;
    const revisedActualDA = parseFloat(form.revisedActualDA) || 0;
    const revisedOtherAllowance = parseFloat(form.revisedOtherAllowance) || 0;
    const calculatedTotal = revisedActualBasic + revisedActualHRA + revisedActualDA + revisedOtherAllowance;
    
    // Only update if there's a difference and at least one component has value
    if (calculatedTotal > 0) {
      const currentTotal = parseFloat(form.revisedTotalSalary) || 0;
      if (Math.abs(calculatedTotal - currentTotal) > 0.01) {
        setForm(prev => ({
          ...prev,
          revisedTotalSalary: calculatedTotal.toString()
        }));
      }
    }
  }, [form.revisedActualBasic, form.revisedActualHRA, form.revisedActualDA, form.revisedOtherAllowance]);

  const columns = [
    { label: 'Select', field: null },
    { label: 'Edit', field: null },
    { label: '#', field: null },
    { label: 'Employee Status', field: 'employeeStatus' },
    { label: 'Photo File', field: 'photoFileName' },
    { label: 'Employee Code', field: 'employeeCode' },
    { label: 'Name', field: 'employeeName' },
    { label: 'Email', field: 'personalEmail' },
    { label: 'Phone', field: 'phone' },
    { label: 'Employment Type', field: 'employmentType' },
    { label: 'Date of Joining', field: 'dateOfJoining' },
    { label: 'Date of Exit', field: 'dateOfExit' },
    { label: 'Overall Experience', field: 'overallExperience' },
    { label: 'Unit', field: 'relevantExperience' },
    { label: 'Source of Hire', field: 'sourceOfHire' },
    { label: 'Department', field: 'department' },
    { label: 'Designation', field: 'designation' },
    { label: 'Category', field: 'category' },
    { label: 'PF No', field: 'pfNo' },
    { label: 'ESIC No', field: 'esicNo' },
    { label: 'PF Status', field: 'pfStatus' },
    { label: 'ESI Status', field: 'esiStatus' },
    { label: 'Location', field: 'location' },
    { label: 'Grade Level', field: 'gradeLevel' },
    { label: 'UAN No', field: 'uanNo' },
    { label: 'Aadhaar Number', field: 'aadhaarNumber' },
    { label: 'PAN Number', field: 'panNumber' },
    { label: 'Actual Basic', field: 'actualBasic' },
    { label: 'Actual HRA', field: 'actualHRA' },
    { label: 'Actual Special Allowance', field: 'actualSpecialAllowance' },
    { label: 'Actual DA', field: 'actualDA' },
    { label: 'Attendance Allowance', field: 'attendanceAllowance' },
    { label: 'Other Allowance', field: 'otherAllowance' },
    { label: 'TravelChargers', field: 'travelChargers' },
    { label: 'Food Allowance', field: 'foodAllowance' },
    { label: 'Uniform Allowance', field: 'uniformAllowance' },
    { label: 'Actual Total Salary', field: 'totalSalary' },
    { label: 'Date of Birth', field: 'dateOfBirth' },
    { label: "FatherName", field: 'fathersName' },
    { label: 'Age', field: 'age' },
    { label: 'Emergency Contact', field: 'emergencyContactNumber' },
    { label: 'Emergency Contact Name', field: 'emergencyContactName' },
    { label: 'Emergency Contact Address', field: 'emergencyContactAddress' },
    { label: 'Emergency City', field: 'emergencyCity' },
    { label: 'Emergency State', field: 'emergencyState' },
    { label: 'Emergency Postal Code', field: 'emergencyPostalCode' },
    { label: 'Spouse', field: 'spouse' },
    { label: 'Gender', field: 'gender' },
    { label: 'Blood Group', field: 'bloodGroup' },
    { label: 'Marital Status', field: 'maritalStatus' },
    { label: 'Present Address Line 1', field: 'presentAddressLine1' },
    { label: 'Present Address Line 2', field: 'presentAddressLine2' },
    { label: 'Present City', field: 'presentCity' },
    { label: 'Present State', field: 'presentState' },
    { label: 'Present Postal Code', field: 'presentPostalCode' },
    { label: 'Present Country', field: 'presentCountry' },
    { label: 'Permanent Address Line 1', field: 'permanentAddressLine1' },
    { label: 'Permanent Address Line 2', field: 'permanentAddressLine2' },
    { label: 'Permanent City', field: 'permanentCity' },
    { label: 'Permanent State', field: 'permanentState' },
    { label: 'Permanent Postal Code', field: 'permanentPostalCode' },
    { label: 'Permanent Country', field: 'permanentCountry' },
    { label: 'Bank Holder Name', field: 'bankHolderName' },
    { label: 'Bank Name', field: 'bankName' },
    { label: 'Account Number', field: 'accountNumber' },
    { label: 'IFSC Code', field: 'ifscCode' },
    { label: 'Bank Branch', field: 'bankBranch' },
    { label: 'Qualification', field: 'qualification' },
    { label: 'Institution Name', field: 'institutionName' },
    { label: 'Field of Study', field: 'fieldOfStudy' },
    { label: 'Year of Completion', field: 'yearOfCompletion' },
    { label: 'Percentage/Marks', field: 'percentageMarks' },
    { label: 'Added User', field: 'addedUser' },
    { label: 'Modified User', field: 'modifiedUser' },
    { label: 'Added Time', field: 'addedTime' },
    { label: 'Modified Time', field: 'modifiedTime' },
    { label: 'Aadhaar file', field: 'aadharCopyFileName' },
    { label: 'Educational Certificates File', field: 'educationalCertificatesFileName' },
    { label: 'Bank Passbook File', field: 'bankPassbookFileName' },
    { label: 'Experience Certificate File', field: 'experienceCertificateFileName' },
    { label: 'PAN Card File', field: 'pANCardFileName' },
    { label: 'Resume File', field: 'resumeFileName' },
  ];

  // Define fields for the search dropdown
  const searchableFields = [
    // Basic Information
    { label: 'Employee Code', field: 'employeeCode' },
    { label: 'Name', field: 'employeeName' },
    { label: 'Email', field: 'personalEmail' },
    { label: 'Phone', field: 'phone' },
    { label: 'Date of Joining', field: 'dateOfJoining' },
    { label: 'Date of Exit', field: 'dateOfExit' },
    { label: 'Employment Type', field: 'employmentType' },
    { label: 'Department', field: 'department' },
    { label: 'Designation', field: 'designation' },
    { label: 'Location', field: 'location' },
    { label: 'Grade Level', field: 'gradeLevel' },
    { label: 'Reporting To', field: 'reportingTo' },
   
    // Personal Information
    { label: 'Date of Birth', field: 'dateOfBirth' },
    { label: 'Age', field: 'age' },
    { label: 'Gender', field: 'gender' },
    { label: 'Blood Group', field: 'bloodGroup' },
    { label: 'Marital Status', field: 'maritalStatus' },
    { label: 'FatherName', field: 'fathersName' },
   
    // Contact Information
    { label: 'Secondary Contact', field: 'secondaryContactNumber' },
    { label: 'Emergency Contact', field: 'emergencyContactNumber' },
    { label: 'Emergency Contact Name', field: 'emergencyContactName' },
    { label: 'Emergency Contact Address', field: 'emergencyContactAddress' },
    { label: 'Emergency City', field: 'emergencyCity' },
    { label: 'Emergency State', field: 'emergencyState' },
    { label: 'Emergency Postal Code', field: 'emergencyPostalCode' },
    { label: 'Spouse', field: 'spouse' },
   
    // Address Information - Present
    { label: 'Present Address Line 1', field: 'presentAddressLine1' },
    { label: 'Present Address Line 2', field: 'presentAddressLine2' },
    { label: 'Present City', field: 'presentCity' },
    { label: 'Present State', field: 'presentState' },
    { label: 'Present Postal Code', field: 'presentPostalCode' },
    { label: 'Present Country', field: 'presentCountry' },
   
    // Address Information - Permanent
    { label: 'Permanent Address Line 1', field: 'permanentAddressLine1' },
    { label: 'Permanent Address Line 2', field: 'permanentAddressLine2' },
    { label: 'Permanent City', field: 'permanentCity' },
    { label: 'Permanent State', field: 'permanentState' },
    { label: 'Permanent Postal Code', field: 'permanentPostalCode' },
    { label: 'Permanent Country', field: 'permanentCountry' },
   
    // Government IDs
    { label: 'Aadhaar Number', field: 'aadhaarNumber' },
    { label: 'PAN Number', field: 'panNumber' },
    { label: 'UAN Number', field: 'uanNo' },
    { label: 'PF Number', field: 'pfNo' },
    { label: 'ESIC Number', field: 'esicNo' },
    { label: 'Driving License', field: 'drivingLicenseNumber' },
    { label: 'Driving License Expiry', field: 'drivingLicenseExpiryDate' },
    { label: 'Bank Holder Name', field: 'bankHolderName' },
    { label: 'Bank Name', field: 'bankName' },
    { label: 'Account Number', field: 'accountNumber' },
    { label: 'IFSC Code', field: 'ifscCode' },
    { label: 'Bank Branch', field: 'bankBranch' },
   
    // Professional Information
    { label: 'Overall Experience', field: 'overallExperience' },
    { label: 'Unit', field: 'relevantExperience' },
    { label: 'Source of Hire', field: 'sourceOfHire' },
  ];

  // Define filtering modes
  const filterModes = [
    { value: 'is', label: 'is' },
    { value: 'is not', label: 'is not' },
    { value: 'is empty', label: 'is empty' },
    { value: 'is not empty', label: 'is not empty' },
  ];

  // Apply search filter based on selected fields and modes
  const filteredData = useMemo(() => {
    const hasActiveFilters = Object.values(searchFields).some(
      field => field.enabled
    );

    if (!hasActiveFilters) {
      return employees;
    }

    return employees.filter((employee) => {
      if (!employee || typeof employee !== 'object') return false;
      return searchableFields.every(({ field }) => {
        const fieldData = searchFields[field];
        if (!fieldData.enabled) return true;

        // Special handling for dropdown fields
        if (field === 'employeeCode') {
          const { selectedCode } = fieldData;
          if (!selectedCode) return true;
          const matches = employee[field] === selectedCode;
          console.log(`Filtering employee ${employee.employeeName} (${employee.employeeCode}) by code ${selectedCode}:`, matches);
          return matches;
        } else if (field === 'employeeName') {
          const { selectedName } = fieldData;
          if (!selectedName) return true;
          return employee[field] === selectedName;
        } else if (field === 'employmentType') {
          const { selectedEmploymentType } = fieldData;
          if (!selectedEmploymentType) return true;
          return employee[field] === selectedEmploymentType;
        } else if (field === 'dateOfExit') {
          const { selectedExitDate } = fieldData;
          if (!selectedExitDate) return true;
          return employee[field] === selectedExitDate;
        } else if (field === 'gender') {
          const { selectedGender } = fieldData;
          if (!selectedGender) return true;
          return employee[field] === selectedGender;
        } else if (fieldData.value !== undefined && fieldData.checkbox === undefined) {
          // Input field filtering - search for text matches
          const { value } = fieldData;
          if (!value || value.trim() === '') return true;
          const employeeValue = employee[field];
          if (employeeValue == null || employeeValue === '') return false;
          return String(employeeValue).toLowerCase().includes(value.toLowerCase());
        } else if (fieldData.checkbox !== undefined) {
          // Checkbox filtering - show only employees with non-empty values for this field
          const { checkbox } = fieldData;
          if (!checkbox) return true;
          const employeeValue = employee[field];
          return employeeValue != null && employeeValue !== '' && String(employeeValue).trim() !== '';
        }

        // Check if this is one of the simplified fields that only shows email input
        const simplifiedFields = ['personalEmail', 'phone', 'dateOfJoining', 'dateOfBirth', 'department', 'designation', 'location', 'gradeLevel', 'reportingTo', 'age', 'bloodGroup', 'maritalStatus', 'fathersName', 'secondaryContactNumber', 'emergencyContactNumber', 'emergencyContactName', 'emergencyContactAddress', 'emergencyCity', 'emergencyState', 'emergencyPostalCode', 'spouse', 'presentAddressLine1', 'presentAddressLine2', 'presentCity', 'presentState', 'presentPostalCode', 'presentCountry', 'permanentAddressLine1', 'permanentAddressLine2', 'permanentCity', 'permanentState', 'permanentPostalCode', 'permanentCountry', 'aadhaarNumber', 'panNumber', 'uanNo', 'pfNo', 'esicNo', 'pfStatus', 'esiStatus', 'drivingLicenseNumber', 'drivingLicenseExpiryDate', 'bankHolderName', 'bankName', 'accountNumber', 'ifscCode', 'bankBranch', 'overallExperience', 'relevantExperience', 'sourceOfHire'];
       
        if (simplifiedFields.includes(field)) {
          // Simplified filtering for specified fields - just text search
          const { value } = fieldData;
          if (!value || value.trim() === '') return true;
          const employeeValue = employee[field];
          if (employeeValue == null || employeeValue === '') return false;
          return String(employeeValue).toLowerCase().includes(value.toLowerCase());
        }

        // Regular filtering for other fields
        const { mode, value } = fieldData;
        const employeeValue = employee[field] != null ? String(employee[field]).toLowerCase() : '';
        const isEmpty = !employeeValue;
        const lowerSearchValue = value.toLowerCase();

        if (mode === 'is') {
          return employeeValue.includes(lowerSearchValue);
        } else if (mode === 'is not') {
          return !employeeValue.includes(lowerSearchValue);
        } else if (mode === 'is empty') {
          return isEmpty;
        } else if (mode === 'is not empty') {
          return !isEmpty;
        }
        return true;
      });
    });
  }, [employees, searchFields]);

  useEffect(() => {
    // Debug: Check if emergency contact fields are preserved in filteredData
    if (filteredData.length > 0) {
      console.log('In useEffect - First employee in filteredData emergency fields:', {
        emergencyContactName: filteredData[0].emergencyContactName,
        emergencyContactAddress: filteredData[0].emergencyContactAddress,
        emergencyCity: filteredData[0].emergencyCity,
        emergencyState: filteredData[0].emergencyState,
        emergencyPostalCode: filteredData[0].emergencyPostalCode
      });
    }
    setFilteredEmployees(filteredData);
  }, [filteredData]);

  // Fetch all employee codes for dropdown
  const fetchAllEmployeeCodes = useCallback(async () => {
    setLoadingEmployeeCodes(true);
    try {
      const params = { showAll: true }; // Fetch all employees without pagination
     
      // Add user role and email for contractor filtering
      if (userRole && userEmail) {
        params.userRole = userRole;
        params.userEmail = userEmail;
      }
     
      const response = await axios.get('/server/cms_function/employees', {
        params,
        timeout: 10000
      });
     
      if (response?.data?.data?.employees) {
        const allEmployees = response.data.data.employees;
        const uniqueCodes = [...new Set(allEmployees
          .map(emp => emp.employeeCode)
          .filter(code => code && code.trim() !== '')
        )].sort();
        setEmployeeCodes(uniqueCodes);
        console.log('Fetched all employee codes:', uniqueCodes.length);
      }
    } catch (error) {
      console.error('Failed to fetch all employee codes:', error);
      // Fallback to current employees if available
      if (employees && employees.length > 0) {
        const uniqueCodes = [...new Set(employees
          .map(emp => emp.employeeCode)
          .filter(code => code && code.trim() !== '')
        )].sort();
        setEmployeeCodes(uniqueCodes);
      }
    } finally {
      setLoadingEmployeeCodes(false);
    }
  }, [userRole, userEmail, employees]);

  // Fetch all employee names for dropdown
  const fetchAllEmployeeNames = useCallback(async () => {
    setLoadingEmployeeNames(true);
    try {
      const params = { showAll: true };
      if (userRole && userEmail) {
        params.userRole = userRole;
        params.userEmail = userEmail;
      }
     
      const response = await axios.get('/server/cms_function/employees', {
        params,
        timeout: 10000
      });
     
      if (response?.data?.data?.employees) {
        const allEmployees = response.data.data.employees;
        const uniqueNames = [...new Set(allEmployees
          .map(emp => emp.employeeName)
          .filter(name => name && name.trim() !== '')
        )].sort();
        setEmployeeNames(uniqueNames);
      }
    } catch (error) {
      console.error('Failed to fetch employee names:', error);
    } finally {
      setLoadingEmployeeNames(false);
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
     
      const response = await axios.get('/server/cms_function/employees', {
        params,
        timeout: 10000
      });
     
      if (response?.data?.data?.employees) {
        const allEmployees = response.data.data.employees;
        const uniqueContractors = [...new Set(allEmployees
          .map(emp => emp.contractor)
          .filter(contractor => contractor && contractor.trim() !== '')
        )].sort();
        setContractors(uniqueContractors);
      }
    } catch (error) {
      console.error('Failed to fetch contractors:', error);
    } finally {
      setLoadingContractors(false);
    }
  }, [userRole, userEmail]);



  // Fetch all employment types for dropdown
  const fetchAllEmploymentTypes = useCallback(async () => {
    console.log('Fetching employment types...');
    setLoadingEmploymentTypes(true);
    try {
      // Use the existing employee data if available, otherwise fetch all employees
      if (employees && employees.length > 0) {
        const uniqueEmploymentTypes = [...new Set(employees
          .map(emp => emp.employmentType)
          .filter(type => type && type.trim() !== '')
        )].sort();
        console.log('Unique employment types from existing data:', uniqueEmploymentTypes);
        setEmploymentTypes(uniqueEmploymentTypes);
        setLoadingEmploymentTypes(false);
        return;
      }

      const params = { showAll: true };
      if (userRole && userEmail) {
        params.userRole = userRole;
        params.userEmail = userEmail;
      }
     
      const response = await axios.get('/server/cms_function/employees', {
        params,
        timeout: 10000
      });
     
      console.log('Employment types response:', response.data);
     
      if (response?.data?.data?.employees) {
        const allEmployees = response.data.data.employees;
        const uniqueEmploymentTypes = [...new Set(allEmployees
          .map(emp => emp.employmentType)
          .filter(type => type && type.trim() !== '')
        )].sort();
        console.log('Unique employment types:', uniqueEmploymentTypes);
        setEmploymentTypes(uniqueEmploymentTypes);
      } else {
        console.log('No employees data found for employment types');
      }
    } catch (error) {
      console.error('Failed to fetch employment types:', error);
    } finally {
      setLoadingEmploymentTypes(false);
    }
  }, [userRole, userEmail, employees]);

  // Fetch all exit dates for dropdown
  const fetchAllExitDates = useCallback(async () => {
    console.log('Fetching exit dates...');
    setLoadingExitDates(true);
    try {
      // Use the existing employee data if available, otherwise fetch all employees
      if (employees && employees.length > 0) {
        const uniqueExitDates = [...new Set(employees
          .map(emp => emp.dateOfExit)
          .filter(date => date && date.trim() !== '')
        )].sort();
        console.log('Unique exit dates from existing data:', uniqueExitDates);
        setExitDates(uniqueExitDates);
        setLoadingExitDates(false);
        return;
      }

      const params = { showAll: true };
      if (userRole && userEmail) {
        params.userRole = userRole;
        params.userEmail = userEmail;
      }
     
      const response = await axios.get('/server/cms_function/employees', {
        params,
        timeout: 10000
      });
     
      console.log('Exit dates response:', response.data);
     
      if (response?.data?.data?.employees) {
        const allEmployees = response.data.data.employees;
        const uniqueExitDates = [...new Set(allEmployees
          .map(emp => emp.dateOfExit)
          .filter(date => date && date.trim() !== '')
        )].sort();
        console.log('Unique exit dates:', uniqueExitDates);
        setExitDates(uniqueExitDates);
      } else {
        console.log('No employees data found for exit dates');
      }
    } catch (error) {
      console.error('Failed to fetch exit dates:', error);
    } finally {
      setLoadingExitDates(false);
    }
  }, [userRole, userEmail, employees]);

  // Fetch all genders for dropdown
  const fetchAllGenders = useCallback(async () => {
    console.log('Fetching genders...');
    setLoadingGenders(true);
    try {
      // Use the existing employee data if available, otherwise fetch all employees
      if (employees && employees.length > 0) {
        const uniqueGenders = [...new Set(employees
          .map(emp => emp.gender)
          .filter(gender => gender && gender.trim() !== '')
        )].sort();
        console.log('Unique genders from existing data:', uniqueGenders);
        setGenders(uniqueGenders);
        setLoadingGenders(false);
        return;
      }

      const params = { showAll: true };
      if (userRole && userEmail) {
        params.userRole = userRole;
        params.userEmail = userEmail;
      }
     
      const response = await axios.get('/server/cms_function/employees', {
        params,
        timeout: 10000
      });
     
      console.log('Genders response:', response.data);
     
      if (response?.data?.data?.employees) {
        const allEmployees = response.data.data.employees;
        const uniqueGenders = [...new Set(allEmployees
          .map(emp => emp.gender)
          .filter(gender => gender && gender.trim() !== '')
        )].sort();
        console.log('Unique genders:', uniqueGenders);
        setGenders(uniqueGenders);
      } else {
        console.log('No employees data found for genders');
      }
    } catch (error) {
      console.error('Failed to fetch genders:', error);
    } finally {
      setLoadingGenders(false);
    }
  }, [userRole, userEmail, employees]);

  // Populate employee codes when employees are loaded (fallback)
  useEffect(() => {
    if (employees && employees.length > 0 && employeeCodes.length === 0) {
      const uniqueCodes = [...new Set(employees
        .map(emp => emp.employeeCode)
        .filter(code => code && code.trim() !== '')
      )].sort();
      setEmployeeCodes(uniqueCodes);
    }
  }, [employees, employeeCodes.length]);

  // Filter employee codes based on search input
  const filteredEmployeeCodes = useMemo(() => {
    if (!employeeCodeSearch.trim()) {
      return employeeCodes;
    }
    return employeeCodes.filter(code =>
      code.toLowerCase().includes(employeeCodeSearch.toLowerCase())
    );
  }, [employeeCodes, employeeCodeSearch]);

  // Filter employee names based on search input
  const filteredEmployeeNames = useMemo(() => {
    if (!employeeNameSearch.trim()) {
      return employeeNames;
    }
    return employeeNames.filter(name =>
      name.toLowerCase().includes(employeeNameSearch.toLowerCase())
    );
  }, [employeeNames, employeeNameSearch]);

  // Filter contractors based on search input
  const filteredContractors = useMemo(() => {
    if (!contractorSearch.trim()) {
      return contractors;
    }
    return contractors.filter(contractor =>
      contractor.toLowerCase().includes(contractorSearch.toLowerCase())
    );
  }, [contractors, contractorSearch]);



  // Filter employment types based on search input
  const filteredEmploymentTypes = useMemo(() => {
    if (!employmentTypeSearch.trim()) {
      return employmentTypes;
    }
    return employmentTypes.filter(type =>
      type.toLowerCase().includes(employmentTypeSearch.toLowerCase())
    );
  }, [employmentTypes, employmentTypeSearch]);

  // Filter exit dates based on search input
  const filteredExitDates = useMemo(() => {
    if (!exitDateSearch.trim()) {
      return exitDates;
    }
    return exitDates.filter(date =>
      date.toLowerCase().includes(exitDateSearch.toLowerCase())
    );
  }, [exitDates, exitDateSearch]);

  // Filter genders based on search input
  const filteredGenders = useMemo(() => {
    if (!genderSearch.trim()) {
      return genders;
    }
    return genders.filter(gender =>
      gender.toLowerCase().includes(genderSearch.toLowerCase())
    );
  }, [genders, genderSearch]);

  const resetSearch = useCallback(() => {
    setEmployeeCodeSearch('');
    setIsEmployeeCodeDropdownOpen(false);
    setEmployeeNameSearch('');
    setIsEmployeeNameDropdownOpen(false);
    setContractorSearch('');
    setIsContractorDropdownOpen(false);
    setEmploymentTypeSearch('');
    setIsEmploymentTypeDropdownOpen(false);
    setExitDateSearch('');
    setIsExitDateDropdownOpen(false);
    setGenderSearch('');
    setIsGenderDropdownOpen(false);
    setSearchFields({
    // Basic Information
    employeeCode: { enabled: false, selectedCode: '' },
    employeeName: { enabled: false, selectedName: '' },
    personalEmail: { enabled: false, value: '' },
    phone: { enabled: false, value: '' },
    dateOfJoining: { enabled: false, value: '' },
      dateOfExit: { enabled: false, selectedExitDate: '' },
      employmentType: { enabled: false, selectedEmploymentType: '' },
      location: { enabled: false, value: '' },
      gradeLevel: { enabled: false, value: '' },
      reportingTo: { enabled: false, value: '' },
     
    // Personal Information
      dateOfBirth: { enabled: false, value: '' },
      age: { enabled: false, value: '' },
      gender: { enabled: false, selectedGender: '' },
      bloodGroup: { enabled: false, value: '' },
      maritalStatus: { enabled: false, mode: 'is', value: '' },
      fathersName: { enabled: false, value: '' },
     
      // Contact Information
      secondaryContactNumber: { enabled: false, value: '' },
      emergencyContactNumber: { enabled: false, value: '' },
     
      // Address Information - Present
      presentAddressLine1: { enabled: false, value: '' },
      presentAddressLine2: { enabled: false, value: '' },
      presentCity: { enabled: false, value: '' },
      presentState: { enabled: false, value: '' },
      presentPostalCode: { enabled: false, value: '' },
      presentCountry: { enabled: false, value: '' },
     
      // Address Information - Permanent
      permanentAddressLine1: { enabled: false, value: '' },
      permanentAddressLine2: { enabled: false, value: '' },
      permanentCity: { enabled: false, value: '' },
      permanentState: { enabled: false, value: '' },
      permanentPostalCode: { enabled: false, value: '' },
      permanentCountry: { enabled: false, value: '' },
     
      // Government IDs
      aadhaarNumber: { enabled: false, value: '' },
      panNumber: { enabled: false, value: '' },
      uanNo: { enabled: false, value: '' },
      pfNo: { enabled: false, value: '' },
      esicNo: { enabled: false, value: '' },
      drivingLicenseNumber: { enabled: false, value: '' },
      drivingLicenseExpiryDate: { enabled: false, value: '' },
     
      // Professional Information
      overallExperience: { enabled: false, value: '' },
      relevantExperience: { enabled: false, value: '' },
      sourceOfHire: { enabled: false, value: '' },
    });
    setPage(1);
    setShowAll(false);
  }, []);

  const toggleSearchDropdown = useCallback(() => {
    setShowSearchDropdown((prev) => !prev);
  }, []);

  const handleFieldToggle = useCallback((field) => {
    setSearchFields((prev) => {
      const currentField = prev[field] || { enabled: false, value: '' };
      return {
        ...prev,
        [field]: {
          ...currentField,
          enabled: !currentField.enabled,
          value: !currentField.enabled ? (currentField.value || '') : '',
        },
      };
    });
  }, []);

  const handleModeChange = useCallback((field, mode) => {
    setSearchFields((prev) => ({
      ...prev,
      [field]: {
        ...prev[field],
        mode,
        value: mode === 'is' || mode === 'is not' ? prev[field].value : '',
      },
    }));
  }, []);

  const handleSearchValueChange = useCallback((field, value) => {
    setSearchFields((prev) => ({
      ...prev,
      [field]: {
        ...prev[field],
        value,
      },
    }));
  }, []);

  const handleEmployeeCodeChange = useCallback((selectedCode) => {
    setSearchFields((prev) => ({
      ...prev,
      employeeCode: {
        ...prev.employeeCode,
        selectedCode,
      },
    }));
  }, []);

  const handleEmployeeCodeSearchChange = useCallback((searchValue) => {
    setEmployeeCodeSearch(searchValue);
  }, []);

  const handleEmployeeCodeDropdownToggle = useCallback(() => {
    setIsEmployeeCodeDropdownOpen(prev => {
      if (!prev) {
        // When opening dropdown, refresh employee codes
        fetchAllEmployeeCodes();
      }
      return !prev;
    });
  }, [fetchAllEmployeeCodes]);

  const handleEmployeeCodeSelect = useCallback((selectedCode) => {
    console.log('Employee Code selected:', selectedCode);
    setSearchFields((prev) => ({
      ...prev,
      employeeCode: {
        ...prev.employeeCode,
        selectedCode,
      },
    }));
    setIsEmployeeCodeDropdownOpen(false);
    setEmployeeCodeSearch('');
  }, []);

  // Employee Name handlers
  const handleEmployeeNameDropdownToggle = useCallback(() => {
    setIsEmployeeNameDropdownOpen(prev => {
      if (!prev) {
        fetchAllEmployeeNames();
      }
      return !prev;
    });
  }, [fetchAllEmployeeNames]);

  const handleEmployeeNameSelect = useCallback((selectedName) => {
    setSearchFields((prev) => ({
      ...prev,
      employeeName: {
        ...prev.employeeName,
        selectedName,
      },
    }));
    setIsEmployeeNameDropdownOpen(false);
    setEmployeeNameSearch('');
  }, []);

  // Contractor handlers
  const handleContractorDropdownToggle = useCallback(() => {
    setIsContractorDropdownOpen(prev => {
      if (!prev) {
        fetchAllContractors();
      }
      return !prev;
    });
  }, [fetchAllContractors]);

  const handleContractorSelect = useCallback((selectedContractor) => {
    setSearchFields((prev) => ({
      ...prev,
      contractor: {
        ...prev.contractor,
        selectedContractor,
      },
    }));
    setIsContractorDropdownOpen(false);
    setContractorSearch('');
  }, []);





  // Employment Type handlers
  const handleEmploymentTypeDropdownToggle = useCallback(() => {
    setIsEmploymentTypeDropdownOpen(prev => {
      if (!prev) {
        fetchAllEmploymentTypes();
      }
      return !prev;
    });
  }, [fetchAllEmploymentTypes]);

  const handleEmploymentTypeSelect = useCallback((selectedEmploymentType) => {
    setSearchFields((prev) => ({
      ...prev,
      employmentType: {
        ...prev.employmentType,
        selectedEmploymentType,
      },
    }));
    setIsEmploymentTypeDropdownOpen(false);
    setEmploymentTypeSearch('');
  }, []);

  // Exit Date handlers
  const handleExitDateDropdownToggle = useCallback(() => {
    setIsExitDateDropdownOpen(prev => {
      if (!prev) {
        fetchAllExitDates();
      }
      return !prev;
    });
  }, [fetchAllExitDates]);

  const handleExitDateSelect = useCallback((selectedExitDate) => {
    setSearchFields((prev) => ({
      ...prev,
      dateOfExit: {
        ...prev.dateOfExit,
        selectedExitDate,
      },
    }));
    setIsExitDateDropdownOpen(false);
    setExitDateSearch('');
  }, []);

  // Gender handlers
  const handleGenderDropdownToggle = useCallback(() => {
    setIsGenderDropdownOpen(prev => {
      if (!prev) {
        fetchAllGenders();
      }
      return !prev;
    });
  }, [fetchAllGenders]);

  const handleGenderSelect = useCallback((selectedGender) => {
    setSearchFields((prev) => ({
      ...prev,
      gender: {
        ...prev.gender,
        selectedGender,
      },
    }));
    setIsGenderDropdownOpen(false);
    setGenderSearch('');
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (isEmployeeCodeDropdownOpen && !event.target.closest('[data-dropdown="employeeCode"]')) {
        setIsEmployeeCodeDropdownOpen(false);
        setEmployeeCodeSearch('');
      }
      if (isEmployeeNameDropdownOpen && !event.target.closest('[data-dropdown="employeeName"]')) {
        setIsEmployeeNameDropdownOpen(false);
        setEmployeeNameSearch('');
      }
      if (isContractorDropdownOpen && !event.target.closest('[data-dropdown="contractor"]')) {
        setIsContractorDropdownOpen(false);
        setContractorSearch('');
      }
      if (isEmploymentTypeDropdownOpen && !event.target.closest('[data-dropdown="employmentType"]')) {
        setIsEmploymentTypeDropdownOpen(false);
        setEmploymentTypeSearch('');
      }
      if (isExitDateDropdownOpen && !event.target.closest('[data-dropdown="dateOfExit"]')) {
        setIsExitDateDropdownOpen(false);
        setExitDateSearch('');
      }
      if (isGenderDropdownOpen && !event.target.closest('[data-dropdown="gender"]')) {
        setIsGenderDropdownOpen(false);
        setGenderSearch('');
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isEmployeeCodeDropdownOpen, isEmployeeNameDropdownOpen, isContractorDropdownOpen, isEmploymentTypeDropdownOpen, isExitDateDropdownOpen, isGenderDropdownOpen]);

  // Helper function to create dropdown UI
  const createDropdownUI = (field, label, data, searchValue, setSearchValue, isOpen, setIsOpen, onSelect, loading, filteredData) => {
    // Get the correct selected value based on field type
    const getSelectedValue = () => {
      const fieldData = searchFields[field];
      if (field === 'employeeCode') return fieldData.selectedCode;
      if (field === 'employeeName') return fieldData.selectedName;
      if (field === 'employmentType') return fieldData.selectedEmploymentType;
      if (field === 'dateOfExit') return fieldData.selectedExitDate;
      if (field === 'gender') return fieldData.selectedGender;
      return '';
    };

    const selectedValue = getSelectedValue();

    return (
      <div className="dropdown-container" style={{ position: 'relative' }} data-dropdown={field}>
        <div
          onClick={() => setIsOpen(prev => {
            if (!prev && data.length === 0) {
              console.log(`Opening ${field} dropdown, data length:`, data.length);
              // Fetch data when opening if not loaded
              if (field === 'employeeName') fetchAllEmployeeNames();
              else if (field === 'employmentType') {
                console.log('Calling fetchAllEmploymentTypes...');
                fetchAllEmploymentTypes();
              }
              else if (field === 'dateOfExit') {
                console.log('Calling fetchAllExitDates...');
                fetchAllExitDates();
              }
              else if (field === 'gender') {
                console.log('Calling fetchAllGenders...');
                fetchAllGenders();
              }
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
            zIndex: 9999,
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

  // Validate employee data (similar to validateForm but for imports)
  const validateImportedEmployee = useCallback((emp, rowIndex) => {
    const errors = [];
    if (!emp.employeeCode) errors.push('Employee Code is required.');
    if (!emp.employeeName) errors.push('Employee Name is required.');
    if (emp.personalEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emp.personalEmail)) {
      errors.push('Invalid email format.');
    }
    if (emp.phone != null && !/^\d{10}$/.test(String(emp.phone))) {
      errors.push('Phone must be a 10-digit number if provided.');
    }
    if (emp.dateOfJoining && !/^\d{4}-\d{2}-\d{2}$/.test(emp.dateOfJoining)) {
      errors.push('Date of Joining must be in YYYY-MM-DD format.');
    }
    if (emp.dateOfBirth && !/^\d{4}-\d{2}-\d{2}$/.test(emp.dateOfBirth)) {
      errors.push('Date of Birth must be in YYYY-MM-DD format.');
    }
    if (emp.emergencyContactNumber != null && !/^\d{10}$/.test(String(emp.emergencyContactNumber))) {
      errors.push('Emergency Contact Number must be a 10-digit number if provided.');
    }
    // Age validation - must be 18 or above
    if (emp.age != null) {
      const ageNum = parseInt(emp.age);
      if (isNaN(ageNum) || ageNum < 1) {
        errors.push('Age must be a valid positive number.');
      } else if (ageNum < 18) {
        errors.push('Employee must be 18 years or older.');
      }
    }
    if (emp.esicNo != null && !/^[A-Za-z0-9]{10}$/.test(String(emp.esicNo))) {
      errors.push('ESIC No must be 10 digits (alphanumeric).');
    }
    if (emp.uanNo != null && !/^\d+$/.test(String(emp.uanNo))) {
      errors.push('UAN No must be a number if provided.');
    }
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

        const numericFields = ['phone', 'pfNo', 'esicNo', 'uanNo', 'age', 'emergencyContactNumber'];
        // Track employee codes to detect duplicates
        const employeeCodes = new Set();
        const duplicateCodes = new Set();

        // Helper function to convert date values to YYYY-MM-DD format.
        // Accepts: 01/11/2012 (DD/MM/YYYY), 01-11-2012, 01.11.2012, yyyy-mm-dd, Excel serial, Date object
        const convertDateValue = (value) => {
          if (value == null || value === '') return '';
         
          // If it's already a Date object (from XLSX with cellDates: true)
          if (value instanceof Date) {
            const year = value.getFullYear();
            const month = String(value.getMonth() + 1).padStart(2, '0');
            const day = String(value.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
          }
         
          const strValue = String(value).trim();
         
          // If it's already in YYYY-MM-DD format, return it
          if (/^\d{4}-\d{2}-\d{2}$/.test(strValue)) {
            return strValue;
          }
         
          // DD/MM/YYYY or D/M/YYYY (e.g. 01/11/2012, 1/11/2012) - primary format for import
          const dmySlash = strValue.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
          if (dmySlash) {
            const d = dmySlash[1].padStart(2, '0');
            const m = dmySlash[2].padStart(2, '0');
            const y = dmySlash[3];
            const day = parseInt(d, 10);
            const month = parseInt(m, 10);
            if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return `${y}-${m}-${d}`;
          }
         
          // DD-MM-YYYY or D-M-YYYY (e.g. 01-11-2012)
          const dmyDash = strValue.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
          if (dmyDash) {
            const d = dmyDash[1].padStart(2, '0');
            const m = dmyDash[2].padStart(2, '0');
            const y = dmyDash[3];
            const day = parseInt(d, 10);
            const month = parseInt(m, 10);
            if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return `${y}-${m}-${d}`;
          }
         
          // DD.MM.YYYY or D.M.YYYY (e.g. 01.11.2012)
          const dmyDot = strValue.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
          if (dmyDot) {
            const d = dmyDot[1].padStart(2, '0');
            const m = dmyDot[2].padStart(2, '0');
            const y = dmyDot[3];
            const day = parseInt(d, 10);
            const month = parseInt(m, 10);
            if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return `${y}-${m}-${d}`;
          }
         
          // Check if it's an Excel serial date (numeric)
          const numValue = Number(value);
          if (!isNaN(numValue) && numValue > 0 && numValue < 1000000) {
            try {
              if (XLSX.SSF && typeof XLSX.SSF.parse_date_code === 'function') {
                const date = XLSX.SSF.parse_date_code(numValue);
                if (date) {
                  const y = date.y.toString().padStart(4, '0');
                  const m = date.m.toString().padStart(2, '0');
                  const d = date.d.toString().padStart(2, '0');
                  return `${y}-${m}-${d}`;
                }
              }
              const excelEpoch = new Date(1899, 11, 30);
              const date = new Date(excelEpoch.getTime() + numValue * 86400 * 1000);
              if (!isNaN(date.getTime())) {
                const year = date.getFullYear();
                const month = String(date.getMonth() + 1).padStart(2, '0');
                const day = String(date.getDate()).padStart(2, '0');
                return `${year}-${month}-${day}`;
              }
            } catch (e) {
              console.warn('Error converting Excel serial date:', e);
            }
          }
         
          // Try to parse as a date string (e.g. locale or ISO)
          try {
            const date = new Date(strValue);
            if (!isNaN(date.getTime())) {
              const year = date.getFullYear();
              const month = String(date.getMonth() + 1).padStart(2, '0');
              const day = String(date.getDate()).padStart(2, '0');
              return `${year}-${month}-${day}`;
            }
          } catch (e) {}
         
          return strValue;
        };

        const newEmployees = jsonData.map((row, index) => {
          const safeToString = (value, isNumeric = false) => {
            if (value == null || value === '') return isNumeric ? null : '';
            if (isNumeric) {
              const num = Number(value);
              return isNaN(num) ? null : num;
            }
            return String(value);
          };

          // Check for duplicate employee codes (normalize by trimming)
          const rawEmployeeCode = safeToString(row['Employee Code']);
          const employeeCode = rawEmployeeCode ? rawEmployeeCode.trim() : '';
         
          // Skip empty employee codes in duplicate check (they will be caught by validation)
          if (employeeCode && employeeCode.length > 0) {
            if (employeeCodes.has(employeeCode)) {
              duplicateCodes.add(employeeCode);
              console.warn(`Duplicate Employee Code found: "${employeeCode}" at row ${index + 2}`);
            } else {
              employeeCodes.add(employeeCode);
            }
          }

          // Calculate age from date of birth if provided
          const dateOfBirth = convertDateValue(row['Date of Birth']);
          let calculatedAge = safeToString(row['Age'], true);
         
          // If date of birth is provided but age is not, calculate age
          if (dateOfBirth && !calculatedAge) {
            const today = new Date();
            const birthDate = new Date(dateOfBirth);
           
            if (!isNaN(birthDate.getTime())) {
              let age = today.getFullYear() - birthDate.getFullYear();
              const monthDiff = today.getMonth() - birthDate.getMonth();
             
              // Adjust age if birthday hasn't occurred this year
              if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
                age--;
              }
             
              calculatedAge = age > 0 ? age : null;
            }
          }

           const emp = {
             employeeCode: safeToString(row['Employee Code']).trim(),
             employeeName: safeToString(row['Name']),
             personalEmail: safeToString(row['Email']) || null,
             phone: safeToString(row['Phone'], true),
             dateOfJoining: convertDateValue(row['Date of Joining']),
             dateOfExit: convertDateValue(row['Date of Exit']),
             overallExperience: safeToString(row['Overall Experience']),
             relevantExperience: safeToString(row['Unit'] ?? row['SSPSE Experience']),
             sourceOfHire: safeToString(row['Source of Hire']),
             department: (safeToString(row['Department']) || '').trim() ? (safeToString(row['Department']) || '').trim().toUpperCase() : safeToString(row['Department']),
             designation: (safeToString(row['Designation']) || '').trim() ? (safeToString(row['Designation']) || '').trim().toUpperCase() : safeToString(row['Designation']),
             category: (() => { const c = safeToString(row['Category']) || ''; const t = c.trim(); return t ? t.toLowerCase().replace(/\b\w/g, x => x.toUpperCase()) : c; })(),
             pfNo: safeToString(row['PF No']),
             esicNo: safeToString(row['ESIC No'], true),
             pfStatus: safeToString(row['PF Status']) || '',
             esiStatus: safeToString(row['ESI Status']) || '',
             location: safeToString(row['Location']),
             gradeLevel: safeToString(row['Grade Level']),
             uanNo: safeToString(row['UAN No'], true),
             dateOfBirth: dateOfBirth,
             fathersName: safeToString(row["FatherName"]),
             age: calculatedAge,
             emergencyContactNumber: safeToString(row['Emergency Contact'], true),
             emergencyContactName: safeToString(row['Emergency Contact Name']),
             emergencyContactAddress: safeToString(row['Emergency Contact Address']),
             emergencyCity: safeToString(row['Emergency City']),
             emergencyState: safeToString(row['Emergency State']),
             emergencyPostalCode: safeToString(row['Emergency Postal Code']),
             spouse: safeToString(row['Spouse']),
             gender: safeToString(row['Gender']),
             bloodGroup: safeToString(row['Blood Group']),
             maritalStatus: safeToString(row['Marital Status']),
             presentAddressLine1: safeToString(row['Present Address Line 1']),
             presentAddressLine2: safeToString(row['Present Address Line 2']),
             presentCity: safeToString(row['Present City']),
             presentState: safeToString(row['Present State']),
             presentPostalCode: safeToString(row['Present Postal Code']),
             presentCountry: safeToString(row['Present Country']),
             // Employee Status: use Excel value if provided, otherwise default to Active for imports
             employeeStatus: (() => {
               const fromExcel = safeToString(row['Employee Status']).trim();
               return fromExcel || 'Active';
             })(),
             permanentAddressLine1: safeToString(row['Permanent Address Line 1']),
             permanentAddressLine2: safeToString(row['Permanent Address Line 2']),
             permanentCity: safeToString(row['Permanent City']),
             permanentState: safeToString(row['Permanent State']),
             permanentPostalCode: safeToString(row['Permanent Postal Code']),
             permanentCountry: safeToString(row['Permanent Country']),
             aadhaarNumber: safeToString(row['Aadhaar Number']),
             panNumber: safeToString(row['PAN Number']),
             actualBasic: safeToString(row['Actual Basic'], true),
             actualHRA: safeToString(row['Actual HRA'], true),
             actualSpecialAllowance: safeToString(row['Actual Special Allowance'], true),
             actualDA: safeToString(row['Actual DA'], true),
             attendanceAllowance: safeToString(row['Attendance Allowance'], true),
             otherAllowance: safeToString(row['Other Allowance'], true),
             travelChargers: safeToString(row['TravelChargers'], true),
             foodAllowance: safeToString(row['Food Allowance'], true),
             uniformAllowance: safeToString(row['Uniform Allowance'], true),
             totalSalary: safeToString(row['Total Salary'], true),
             revisedActualBasic: safeToString(row['Revised Actual Basic'], true),
             revisedActualHRA: safeToString(row['Revised Actual HRA'], true),
             revisedActualDA: safeToString(row['Revised Actual DA'], true),
             revisedOtherAllowance: safeToString(row['Revised Other Allowance'], true),
             monthData: safeToString(row['Month Data']),
             dateData: convertDateValue(row['Date Data']),
             revisedTotalSalary: safeToString(row['Revised Total Salary'], true),
             bankHolderName: safeToString(row['Bank Holder Name']),
             bankName: safeToString(row['Bank Name']),
             accountNumber: safeToString(row['Account Number']),
             ifscCode: safeToString(row['IFSC Code']),
             bankBranch: safeToString(row['Bank Branch']),
             // Build educationDetails from import columns (matches export: Education - Qualification, Education - Institution, etc.; up to 7 entries)
             educationDetails: (() => {
               const maxEducationEntries = 7;
               const list = [];
               for (let i = 0; i < maxEducationEntries; i++) {
                 const suffix = i === 0 ? '' : ` ${i + 1}`;
                 const keyQual = `Education${suffix} - Qualification`;
                 const keyInst = `Education${suffix} - Institution`;
                 const keyField = `Education${suffix} - Field of Study`;
                 const keyYear = `Education${suffix} - Year of Completion`;
                 const keyPct = `Education${suffix} - Percentage/Marks`;
                 const qualification = row[keyQual] != null && row[keyQual] !== '' ? String(row[keyQual]).trim() : '';
                 const institutionName = row[keyInst] != null && row[keyInst] !== '' ? String(row[keyInst]).trim() : '';
                 const fieldOfStudy = row[keyField] != null && row[keyField] !== '' ? String(row[keyField]).trim() : '';
                 const yearOfCompletion = row[keyYear] != null && row[keyYear] !== '' ? String(row[keyYear]).trim() : '';
                 const percentageMarks = row[keyPct] != null && row[keyPct] !== '' ? String(row[keyPct]).trim() : '';
                 if (qualification || institutionName || fieldOfStudy || yearOfCompletion || percentageMarks) {
                   list.push({
                     qualification,
                     institutionName,
                     fieldOfStudy,
                     yearOfCompletion,
                     percentageMarks,
                   });
                 }
               }
               return list;
             })(),
           };

          // Check for duplicate employee codes
          if (duplicateCodes.has(emp.employeeCode)) {
            const error = `Row ${index + 2}: Duplicate Employee Code '${emp.employeeCode}' found. Each employee must have a unique code.`;
            console.error(error);
            throw new Error(error);
          }

          // Debug: Log employee data for failed rows (rows 33+)
          if (index + 2 >= 33) {
            console.log(`Row ${index + 2} employee data:`, emp);
          }

          const validationError = validateImportedEmployee(emp, index + 2);
          if (validationError) {
            console.error(`Row ${index + 2} validation error:`, validationError);
            throw new Error(validationError);
          }

          return emp;
        });

        // Log duplicate codes summary
        if (duplicateCodes.size > 0) {
          console.warn(`Found ${duplicateCodes.size} duplicate Employee Codes:`, Array.from(duplicateCodes));
        }

        // Map Employee Code -> ROWID so re-import updates the same record instead of creating a duplicate.
        // Do NOT pass page/perPage: CMS GET /employees returns the full list only when both are omitted (see returnAll).
        const registerImportCodeKeys = (map, code, rowId) => {
          if (rowId == null || code == null || code === '') return;
          const s = String(code).trim();
          if (!s) return;
          map.set(s, rowId);
          if (/^\d+$/.test(s)) {
            map.set(String(parseInt(s, 10)), rowId);
          }
        };
        const getImportRowId = (map, code) => {
          if (!map || code == null || code === '') return undefined;
          const s = String(code).trim();
          if (!s) return undefined;
          if (map.has(s)) return map.get(s);
          if (/^\d+$/.test(s)) {
            const n = parseInt(s, 10);
            if (map.has(String(n))) return map.get(String(n));
          }
          return undefined;
        };

        const employeeCodeToRowId = new Map();
        try {
          const existingListParams = {};
          if (userRole && userEmail) {
            existingListParams.userRole = userRole;
            existingListParams.userEmail = userEmail;
          }
          const existingCodesResponse = await axios.get('/server/cms_function/employees', { params: existingListParams });
          const existingEmployees = existingCodesResponse.data.data.employees || [];
          existingEmployees.forEach(e => {
            const code = e && e.employeeCode != null ? String(e.employeeCode).trim() : '';
            if (code && e.id) {
              registerImportCodeKeys(employeeCodeToRowId, code, e.id);
            }
          });
          console.log(`Import upsert: ${existingEmployees.length} employee row(s) loaded, ${employeeCodeToRowId.size} code key(s) mapped to ROWIDs`);
        } catch (error) {
          console.warn('Could not load existing employees for import upsert; backend will still upsert on duplicate code:', error);
        }

        const employeesToImport = newEmployees;
        const updateCount = employeesToImport.filter(emp => getImportRowId(employeeCodeToRowId, emp.employeeCode)).length;
        const createCount = employeesToImport.length - updateCount;
        console.log(
          `Importing ${employeesToImport.length} row(s): ~${createCount} create(s), ~${updateCount} update(s) where Employee Code already exists`
        );

        if (employeesToImport.length === 0) {
          setImportError(
            'No valid employees found in the file. Ensure the Excel has a header row and columns: Employee Code, Name (and other columns as needed).'
          );
          setImporting(false);
          fileInputRef.current.value = '';
          return;
        }

        // Debug: Log first employee to see what's being sent
        if (employeesToImport.length > 0) {
          console.log('First employee being imported:', employeesToImport[0]);
          console.log('actualBasic value:', employeesToImport[0].actualBasic, 'type:', typeof employeesToImport[0].actualBasic);
          console.log('actualHRA value:', employeesToImport[0].actualHRA, 'type:', typeof employeesToImport[0].actualHRA);
        }

        const importRequestConfig = { timeout: 60000, params: {} };
        if (userRole) {
          importRequestConfig.params.userRole = userRole;
        }

        Promise.all(
          employeesToImport.map((emp, index) => {
            const existingRowId = getImportRowId(employeeCodeToRowId, emp.employeeCode);
            const request = existingRowId
              ? axios.put(`/server/cms_function/employees/${existingRowId}`, emp, importRequestConfig)
              : axios.post('/server/cms_function/employees', emp, importRequestConfig);
            return request
              .then(response => {
                if (!response?.data?.data?.employee) {
                  throw new Error(`Unexpected API response structure for row ${index + 2}`);
                }
                return response.data.data.employee;
              })
              .catch(err => {
                const errorMessage = err.response?.data?.message || err.message || `Failed to import row ${index + 2}`;
                console.error(`Import error for employee at row ${index + 2}:`, emp, err);
                console.error(`Full error details for row ${index + 2}:`, {
                  error: err,
                  response: err.response?.data,
                  employee: emp
                });
                return { error: errorMessage, row: index + 2, employee: emp };
              });
          })
        )
          .then(results => {
            const successfulImports = results.filter(result => !result?.error);
            const failedImports = results.filter(result => result?.error);
            console.log('Import results summary:', {
              total: newEmployees.length,
              successful: successfulImports.length,
              failed: failedImports.length,
              failedDetails: failedImports
            });

            if (successfulImports.length === 0) {
              const firstFewErrors = failedImports.slice(0, 10).map(f => `Row ${f.row}: ${f.error}`);
              const remainingCount = failedImports.length - 10;
              const errorDetail = remainingCount > 0
                ? `${firstFewErrors.join('; ')}; ... and ${remainingCount} more failed`
                : firstFewErrors.join('; ');
              setImportError(`Failed to import any employees. ${errorDetail || 'Check browser console for details.'}`);
            } else {
              fetchEmployees(); // Refetch employees after import
              if (failedImports.length > 0) {
                // Show first few errors in detail, then summarize the rest
                const firstFewErrors = failedImports.slice(0, 5).map(f => `Row ${f.row}: ${f.error}`);
                const remainingCount = failedImports.length - 5;
                const errorSummary = remainingCount > 0
                  ? `${firstFewErrors.join('; ')}; ... and ${remainingCount} more rows failed`
                  : firstFewErrors.join('; ');
               
                setImportError(
                  `Imported ${successfulImports.length} out of ${newEmployees.length} employees. Failed rows: ${errorSummary}`
                );
              }
            }
          })
          .catch(err => {
            setImportError(err.message || 'An error occurred while importing employees.');
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
  }, [validateImportedEmployee, fetchEmployees, userRole, userEmail]);

  // Export to Excel with all stored data
  const handleExport = useCallback(() => {
    if (filteredEmployees.length === 0) {
      setExportError('No data to export.');
      return;
    }

    setExporting(true);
    setExportError('');

    try {
      // Filter out inactive employees before export
      const activeEmployees = filteredEmployees.filter(emp => {
        const status = (emp.employeeStatus || '').toLowerCase().trim();
        return status !== 'inactive';
      });

      if (activeEmployees.length === 0) {
        setExportError('No active employees to export.');
        return;
      }

      const requiredFields = ['employeeCode', 'employeeName'];
      const invalidEmployees = activeEmployees.filter(emp =>
        !emp || typeof emp !== 'object' || requiredFields.some(field => emp[field] == null)
      );
      if (invalidEmployees.length > 0) {
        console.warn('Some employees have missing required fields:', invalidEmployees);
        setExportError('Some employees have missing required fields. Export may be incomplete.');
      }

      const exportData = activeEmployees.map(emp => {
        // Format education details - create separate columns for each education entry (support up to 7 entries)
        const maxEducationEntries = 7; // Increased to support 2 more education details
        const educationColumns = {};
        const educationCount = emp.educationDetails && Array.isArray(emp.educationDetails) ? emp.educationDetails.length : 0;
       
        // Process existing education entries
        if (educationCount > 0) {
          for (let i = 0; i < Math.min(educationCount, maxEducationEntries); i++) {
            const edu = emp.educationDetails[i];
            const suffix = i === 0 ? '' : ` ${i + 1}`;
            educationColumns[`Education${suffix} - Qualification`] = edu.qualification || '';
            educationColumns[`Education${suffix} - Institution`] = edu.institutionName || '';
            educationColumns[`Education${suffix} - Field of Study`] = edu.fieldOfStudy || '';
            educationColumns[`Education${suffix} - Year of Completion`] = edu.yearOfCompletion || '';
            educationColumns[`Education${suffix} - Percentage/Marks`] = edu.percentageMarks || '';
          }
        }
       
        // Fill empty columns for remaining education entries if needed
        for (let i = educationCount; i < maxEducationEntries; i++) {
          const suffix = i === 0 ? '' : ` ${i + 1}`;
          educationColumns[`Education${suffix} - Qualification`] = '';
          educationColumns[`Education${suffix} - Institution`] = '';
          educationColumns[`Education${suffix} - Field of Study`] = '';
          educationColumns[`Education${suffix} - Year of Completion`] = '';
          educationColumns[`Education${suffix} - Percentage/Marks`] = '';
        }

        return {
          'Employee Code': emp.employeeCode || '',
          'Name': emp.employeeName || '',
          'Email': emp.personalEmail || '',
          'Phone': emp.phone || '',
          'Secondary Contact Number': emp.secondaryContactNumber || '',
          'Date of Joining': emp.dateOfJoining || '',
          'Date of Exit': emp.dateOfExit || '',
          'Employment Type': emp.employmentType || '',
          'Employee Status': emp.employeeStatus || '',
          'Overall Experience': emp.overallExperience || '',
          'Unit': emp.relevantExperience || '',
          'Source of Hire': emp.sourceOfHire || '',
          'Department': emp.department || '',
          'Designation': emp.designation || '',
          'Category': emp.category || '',
          'PF No': emp.pfNo || '',
          'ESIC No': emp.esicNo || '',
          'PF Status': emp.pfStatus || '',
          'ESI Status': emp.esiStatus || '',
          'Location': emp.location || '',
          'Grade Level': emp.gradeLevel || '',
          'UAN No': emp.uanNo || '',
          'Reporting To': emp.reportingTo || '',
          'HR Partner': emp.hrPartner || '',
          'National Head': emp.nationalHead || '',
          'Aadhaar Number': emp.aadhaarNumber || '',
          'PAN Number': emp.panNumber || '',
          'Date of Birth': emp.dateOfBirth || '',
          "FatherName": emp.fathersName || '',
          'Age': emp.age || '',
          'Emergency Contact': emp.emergencyContactNumber || '',
          'Emergency Contact Name': emp.emergencyContactName || '',
          'Emergency Contact Address': emp.emergencyContactAddress || '',
          'Emergency City': emp.emergencyCity || '',
          'Emergency State': emp.emergencyState || '',
          'Emergency Postal Code': emp.emergencyPostalCode || '',
          'Spouse': emp.spouse || '',
          'Gender': emp.gender || '',
          'Blood Group': emp.bloodGroup || '',
          'Marital Status': emp.maritalStatus || '',
          'Present Address Line 1': emp.presentAddressLine1 || '',
          'Present Address Line 2': emp.presentAddressLine2 || '',
          'Present City': emp.presentCity || '',
          'Present State': emp.presentState || '',
          'Present Postal Code': emp.presentPostalCode || '',
          'Present Country': emp.presentCountry || '',
          'Permanent Address Line 1': emp.permanentAddressLine1 || '',
          'Permanent Address Line 2': emp.permanentAddressLine2 || '',
          'Permanent City': emp.permanentCity || '',
          'Permanent State': emp.permanentState || '',
          'Permanent Postal Code': emp.permanentPostalCode || '',
          'Permanent Country': emp.permanentCountry || '',
          'Actual Basic': emp.actualBasic || '',
          'Actual HRA': emp.actualHRA || '',
          'Actual Special Allowance': emp.actualSpecialAllowance || '',
          'Actual DA': emp.actualDA || '',
          'Attendance Allowance': emp.attendanceAllowance || '',
          'Other Allowance': emp.otherAllowance || '',
          'TravelChargers': emp.travelChargers || '',
          'Food Allowance': emp.foodAllowance || '',
          'Uniform Allowance': emp.uniformAllowance || '',
          // Match directory column "Actual Total Salary": stored totalSalary, else sum of salary components (same as getActualTotalSalaryDisplay).
          'Total Salary': (() => {
            const v = getActualTotalSalaryDisplay(emp);
            return v === '-' ? '' : v;
          })(),
          'Revised Actual Basic': emp.revisedActualBasic || '',
          'Revised Actual HRA': emp.revisedActualHRA || '',
          'Revised Actual DA': emp.revisedActualDA || '',
          'Revised Other Allowance': emp.revisedOtherAllowance || '',
          'Month Data': emp.monthData || '',
          'Date Data': emp.dateData || '',
          'Revised Total Salary': emp.revisedTotalSalary || '',
          'Driving License Number': emp.drivingLicenseNumber || '',
          'Driving License Expiry Date': emp.drivingLicenseExpiryDate || '',
          'Bank Holder Name': emp.bankHolderName || '',
          'Bank Name': emp.bankName || '',
          'Account Number': emp.accountNumber || '',
          'IFSC Code': emp.ifscCode || '',
          'Bank Branch': emp.bankBranch || '',
          ...educationColumns,
        };
      });

      const worksheet = XLSX.utils.json_to_sheet(exportData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Employees');

      XLSX.writeFile(workbook, 'employees_export.xlsx');
    } catch (err) {
      const errorMessage = err.message || 'Failed to export data to Excel. Please try again.';
      setExportError(errorMessage);
      console.error('Export error:', err);
    } finally {
      setExporting(false);
    }
  }, [filteredEmployees]);





  // Close dropdown when clicking outside
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

  // Options for select fields in the form
  const employmentTypeOptions = [
    { value: '', label: '-Select-' },
    { value: 'Permanent', label: 'Permanent' },
    { value: 'Temporary', label: 'Temporary' },
  ];

  const [departmentOptions, setDepartmentOptions] = useState([{ value: '', label: '-Select-' }]);

  // Fetch departments from API (Department_function)
  const fetchDepartments = useCallback(() => {
    axios
      .get('/server/Department_function/departments')
      .then((res) => {
        const departmentsData = res.data.data.departments || [];
        const options = [{ value: '', label: '-Select-' }].concat(
          departmentsData.map((d) => ({
            value: d.departmentName,
            label: d.departmentName,
          }))
        );
        setDepartmentOptions(options);
        // Also update the departments array for dropdown filtering
        setDepartments(departmentsData.map(d => d.departmentName));
      })
      .catch((err) => {
        console.error('Failed to fetch departments:', err);
        setDepartmentOptions([{ value: '', label: '-Select-' }]);
        setDepartments([]);
      });
  }, []);

  useEffect(() => {
    fetchDepartments();
  }, [fetchDepartments]);

  const [designationOptions, setDesignationOptions] = useState([{ value: '', label: '-Select-' }]);

  // Fetch designations from API (designation_function)
  const fetchDesignations = useCallback(() => {
    axios
      .get('/server/Designation_function/designations')
      .then((res) => {
        const designationsData = res.data.data.designations || [];
        const options = [{ value: '', label: '-Select-' }].concat(
          designationsData.map((d) => ({
            value: d.designationName,
            label: d.designationName,
          }))
        );
        setDesignationOptions(options);
        // Also update the designations array for dropdown filtering
        setDesignations(designationsData.map(d => d.designationName));
      })
      .catch((err) => {
        console.error('Failed to fetch designations:', err);
        setDesignationOptions([{ value: '', label: '-Select-' }]);
        setDesignations([]);
      });
  }, []);

  useEffect(() => {
    fetchDesignations();
  }, [fetchDesignations]);

  // Include current form department/designation in options so imported or differently-cased values (e.g. PRODUCTION) show when editing
  const departmentOptionsForSelect = useMemo(() => {
    const current = (form.department || '').trim();
    if (!current) return departmentOptions;
    const hasMatch = departmentOptions.some((opt) => opt.value === current);
    if (hasMatch) return departmentOptions;
    return [{ value: '', label: '-Select-' }, { value: current, label: current }, ...departmentOptions.filter((o) => o.value !== '')];
  }, [departmentOptions, form.department]);

  const designationOptionsForSelect = useMemo(() => {
    const current = (form.designation || '').trim();
    if (!current) return designationOptions;
    const hasMatch = designationOptions.some((opt) => opt.value === current);
    if (hasMatch) return designationOptions;
    return [{ value: '', label: '-Select-' }, { value: current, label: current }, ...designationOptions.filter((o) => o.value !== '')];
  }, [designationOptions, form.designation]);

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

  const countryOptions = [
    { value: '', label: '-Select-' },
    { value: 'India', label: 'India' },
    { value: 'USA', label: 'USA' },
    { value: 'UK', label: 'UK' },
    { value: 'Canada', label: 'Canada' },
    { value: 'Australia', label: 'Australia' },
  ];


  const [ageAutoCalculated, setAgeAutoCalculated] = useState(false);
  const [showSalaryRevisedDetails, setShowSalaryRevisedDetails] = useState(false);
  const [ageValid, setAgeValid] = useState(false);
  const [originalSalaryValues, setOriginalSalaryValues] = useState({
    actualBasic: '',
    actualHRA: '',
    actualSpecialAllowance: '',
    actualDA: ''
  });

  // Refs to store values on focus for revised logic
  const actualBasicRef = useRef('');
  const actualHRARef = useRef('');
  const actualDARef = useRef('');
  const otherAllowanceRef = useRef('');

  // Function to calculate age from date of birth
  const calculateAge = useCallback((dateOfBirth) => {
    if (!dateOfBirth) return '';
   
    const today = new Date();
    const birthDate = new Date(dateOfBirth);
   
    // Check if the date is valid
    if (isNaN(birthDate.getTime())) return '';
   
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
   
    // Adjust age if birthday hasn't occurred this year
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
   
    return age > 0 ? age.toString() : '';
  }, []);

  // Function to validate age (must be 18 or above)
  const validateAge = useCallback((age) => {
    if (!age) return { isValid: true, message: '' };
   
    const ageNum = parseInt(age);
    if (isNaN(ageNum) || ageNum < 1) {
      return { isValid: false, message: 'Age must be a valid positive number.' };
    }
   
    if (ageNum < 18) {
      return { isValid: false, message: 'Employee must be 18 years or older.' };
    }
   
    return { isValid: true, message: '' };
  }, []);

  // Actual Total Salary = Actual Basic + Actual HRA + Actual DA + Actual Special Allowance (read-only total).
  useEffect(() => {
    const basicRaw = String(form.actualBasic ?? '').trim();
    const hraRaw = String(form.actualHRA ?? '').trim();
    const daRaw = String(form.actualDA ?? '').trim();
    const specialRaw = String(form.actualSpecialAllowance ?? '').trim();
    const allEmpty = basicRaw === '' && hraRaw === '' && daRaw === '' && specialRaw === '';
    const basic = parseFloat(basicRaw) || 0;
    const hra = parseFloat(hraRaw) || 0;
    const da = parseFloat(daRaw) || 0;
    const special = parseFloat(specialRaw) || 0;
    const sum = Math.round((basic + hra + da + special) * 100) / 100;
    const totalStr = allEmpty ? '' : String(sum);
    setForm((prev) => {
      if (String(prev.totalSalary ?? '') === totalStr) return prev;
      return { ...prev, totalSalary: totalStr };
    });
  }, [form.actualBasic, form.actualHRA, form.actualDA, form.actualSpecialAllowance]);

  const onChange = useCallback((e) => {
    const { name, value } = e.target;
    console.log(`Field changed: ${name}=${value}`);
   
    // If date of birth is changed, automatically calculate age
    if (name === 'dateOfBirth') {
      const calculatedAge = calculateAge(value);
      setForm((prev) => ({
        ...prev,
        [name]: value,
        age: calculatedAge
      }));
     
      // Set flag to indicate age was auto-calculated
      setAgeAutoCalculated(!!calculatedAge);
     
      // Validate the calculated age
      if (calculatedAge) {
        const ageValidation = validateAge(calculatedAge);
        if (!ageValidation.isValid) {
          setFormError(ageValidation.message);
          setAgeValid(false);
        } else {
          setFormError('');
          setAgeValid(true);
        }
      } else {
        setFormError('');
        setAgeValid(false);
      }
    }
    // If age is manually changed, validate it
    else if (name === 'age') {
      setForm((prev) => ({ ...prev, [name]: value }));
     
      // Clear auto-calculated flag when manually changed
      setAgeAutoCalculated(false);
     
      if (value) {
        const ageValidation = validateAge(value);
        if (!ageValidation.isValid) {
          setFormError(ageValidation.message);
          setAgeValid(false);
        } else {
          setFormError('');
          setAgeValid(true);
        }
      } else {
        setFormError('');
        setAgeValid(false);
      }
    }
    else if (
      name === 'actualBasic' ||
      name === 'actualHRA' ||
      name === 'actualDA' ||
      name === 'actualSpecialAllowance' ||
      name === 'attendanceAllowance' ||
      name === 'otherAllowance' ||
      name === 'travelChargers'
    ) {
      // Get current date in YYYY-MM-DD format
      const today = new Date();
      const currentDate = today.toISOString().split('T')[0];

      setForm((prev) => ({
        ...prev,
        [name]: value,
        dateData: currentDate
      }));
      setFormError('');
    }
    // Auto-calculate Revised Total Salary when revised salary components change
    else if (name === 'revisedActualBasic' || name === 'revisedActualHRA' || name === 'revisedActualDA' || name === 'revisedOtherAllowance') {
      setForm((prev) => {
        const updatedForm = { ...prev, [name]: value };
       
        // Calculate RevisedTotalSalary = RevisedActualBasic + RevisedActualHRA + RevisedActualDA + RevisedOtherAllowance
        const revisedActualBasic = name === 'revisedActualBasic' ? parseFloat(value) || 0 : parseFloat(prev.revisedActualBasic) || 0;
        const revisedActualHRA = name === 'revisedActualHRA' ? parseFloat(value) || 0 : parseFloat(prev.revisedActualHRA) || 0;
        const revisedActualDA = name === 'revisedActualDA' ? parseFloat(value) || 0 : parseFloat(prev.revisedActualDA) || 0;
        const revisedOtherAllowance = name === 'revisedOtherAllowance' ? parseFloat(value) || 0 : parseFloat(prev.revisedOtherAllowance) || 0;
        const revisedTotalSalary = revisedActualBasic + revisedActualHRA + revisedActualDA + revisedOtherAllowance;
       
        return {
          ...updatedForm,
          revisedTotalSalary: revisedTotalSalary > 0 ? revisedTotalSalary.toString() : ''
        };
      });
      setFormError('');
    }
    // Handle employeeStatus change - clear dateOfExit only when status does not require it (Active or empty)
    else if (name === 'employeeStatus') {
      setForm((prev) => {
        const statusesWithExitDate = ['inactive', 'resigned', 'terminated', 'absconding', 'deceased'];
        const requiresExitDate = value && statusesWithExitDate.includes(value.toLowerCase().trim());
        return {
          ...prev,
          [name]: value,
          dateOfExit: requiresExitDate ? prev.dateOfExit : ''
        };
      });
      setFormError('');
    }
    // For all other fields
    else {
      setForm((prev) => ({ ...prev, [name]: value }));
      setFormError('');
    }
  }, [calculateAge, validateAge]);

  const handleSelectEmployee = useCallback((id) => {
    setSelectedEmployees((prev) => {
      const isAlreadySelected = prev.some((empId) => String(empId) === String(id));
      return isAlreadySelected ? prev.filter((empId) => String(empId) !== String(id)) : [...prev, id];
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    if (allSelected) {
      // If all are selected, deselect all
      setSelectedEmployees([]);
    } else {
      // If not all are selected, select all
      const allIds = filteredEmployees.map(employee => employee.id);
      setSelectedEmployees(allIds);
    }
  }, [allSelected, filteredEmployees]);

  const handleMassDelete = useCallback(() => {
    if (selectedEmployees.length === 0) {
      setMassDeleteError('Please select at least one employee to delete.');
      return;
    }

    if (!window.confirm(`Are you sure you want to delete ${selectedEmployees.length} employee(s)?`)) {
      return;
    }

    setDeletingMultiple(true);
    setMassDeleteError('');

    Promise.all(
      selectedEmployees.map((id) =>
        axios.delete(`/server/cms_function/employees/${id}`, { timeout: 5000 }).catch((err) => {
          const errorMessage = err.response?.data?.message || `Failed to delete employee (ID: ${id})`;
          console.error(`Mass delete error for ID ${id}:`, err);
          return { error: errorMessage, id };
        })
      )
    )
      .then((results) => {
        const failedDeletions = results.filter((result) => result?.error);
        if (failedDeletions.length > 0) {
          setMassDeleteError(
            'Failed to delete some employees: ' +
            failedDeletions.map((f) => `ID ${f.id}: ${f.error}`).join('; ')
          );
        }
        fetchEmployees(); // Refetch employees after mass delete
        setSelectedEmployees([]);
      })
      .catch((err) => {
        setMassDeleteError('An unexpected error occurred while deleting employees.');
        console.error('Mass delete error:', err);
      })
      .finally(() => setDeletingMultiple(false));
  }, [selectedEmployees, fetchEmployees]);

  const validateForm = useCallback(() => {
    const errors = [];
    if (!form.employeeCode.trim()) errors.push('Employee Code is required.');
    if (!form.employeeName.trim()) errors.push('Employee Name is required.');
    // Email is optional; validate only if provided
    if (form.personalEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.personalEmail)) {
      errors.push('Invalid email format.');
    }
    if (form.phone && form.phone.trim() && !/^\d{10}$/.test(form.phone)) {
      errors.push('Phone must be a 10-digit number.');
    }
    // Date of Joining is optional; validate format only if provided
    if (form.dateOfJoining && form.dateOfJoining.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(form.dateOfJoining)) {
      errors.push('Date of Joining must be in YYYY-MM-DD format.');
    }
   
    if (form.dateOfBirth && form.dateOfBirth.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(form.dateOfBirth)) {
      errors.push('Date of Birth must be in YYYY-MM-DD format.');
    }
    if (form.emergencyContactNumber && form.emergencyContactNumber.trim() && !/^\d{10}$/.test(form.emergencyContactNumber)) {
      errors.push('Emergency Contact Number must be a 10-digit number if provided.');
    }
    // Age validation - must be 18 or above
    if (form.age && form.age.trim()) {
      const ageNum = parseInt(form.age);
      if (isNaN(ageNum) || ageNum < 1) {
        errors.push('Age must be a valid positive number.');
      } else if (ageNum < 18) {
        errors.push('Employee must be 18 years or older.');
      }
    }
    if (form.esicNo && form.esicNo.trim() && !/^[A-Za-z0-9]{10}$/.test(form.esicNo)) {
      errors.push('ESIC No must be 10 digits (alphanumeric).');
    }
    if (form.uanNo && form.uanNo.trim() && !/^\d{12}$/.test(form.uanNo)) {
      errors.push('UAN No must be a 12-digit number if provided.');
    }
    if (form.aadhaarNumber && form.aadhaarNumber.trim() && !/^\d{12}$/.test(form.aadhaarNumber)) {
      errors.push('Aadhaar Number must be a 12-digit number.');
    }
    if (form.drivingLicenseNumber && form.drivingLicenseNumber.trim() && !/^\d{16}$/.test(form.drivingLicenseNumber)) {
      errors.push('Driving License Number must be a 16-digit number if provided.');
    }
    // PAN is optional; validate only if provided
    if (form.panNumber && form.panNumber.trim()) {
      if (!/^.{10}$/.test(form.panNumber)) {
        errors.push('PAN Number must be exactly 10 characters.');
      } else if (form.panNumber[3].toUpperCase() !== 'P') {
        errors.push('PAN Number: The fourth character must be "P".');
      }
    }
    if (errors.length > 0) {
      setFormError(errors.join(' '));
      return false;
    }
    return true;
  }, [form]);

  const saveEmployee = useCallback(
    async (e) => {
      console.log('Save employee function called');
      e.preventDefault();
      console.log('Form validation result:', validateForm());
      if (!validateForm()) return;
      console.log('Starting employee save process');
      setSubmitting(true);

      const requiredFields = ['employeeCode', 'employeeName', 'phone', 'department'];
      const cleanedForm = Object.fromEntries(
        Object.entries(form).map(([key, value]) => {
          // Preserve arrays (like educationDetails) and clean their string values
          if (Array.isArray(value)) {
            if (key === 'educationDetails') {
              // Clean education details array - trim strings and remove empty entries
              return [key, value.map(edu => ({
                qualification: edu.qualification && typeof edu.qualification === 'string' ? edu.qualification.trim() : (edu.qualification || ''),
                institutionName: edu.institutionName && typeof edu.institutionName === 'string' ? edu.institutionName.trim() : (edu.institutionName || ''),
                fieldOfStudy: edu.fieldOfStudy && typeof edu.fieldOfStudy === 'string' ? edu.fieldOfStudy.trim() : (edu.fieldOfStudy || ''),
                yearOfCompletion: edu.yearOfCompletion && typeof edu.yearOfCompletion === 'string' ? edu.yearOfCompletion.trim() : (edu.yearOfCompletion || ''),
                percentageMarks: edu.percentageMarks && typeof edu.percentageMarks === 'string' ? edu.percentageMarks.trim() : (edu.percentageMarks || '')
              })).filter(edu =>
                // Keep entries that have at least one non-empty field
                edu.qualification || edu.institutionName || edu.fieldOfStudy || edu.yearOfCompletion || edu.percentageMarks
              )];
            }
            return [key, value];
          }
          // Trim strings but preserve non-empty strings
          if (value && typeof value === 'string' && value.trim() === '' && !requiredFields.includes(key)) {
            return [key, null];
          }
          if (typeof value === 'string') {
            return [key, value.trim()];
          }
          return [key, value];
        })
      );

      // Store department, designation in uppercase; category in title case (e.g. WORKER → Worker)
      const toUpper = (v) => (v != null && String(v).trim() !== '' ? String(v).trim().toUpperCase() : v);
      const toTitleCase = (v) => (v != null && String(v).trim() !== '' ? String(v).trim().toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) : v);
      cleanedForm.department = toUpper(cleanedForm.department);
      cleanedForm.designation = toUpper(cleanedForm.designation);
      cleanedForm.category = toTitleCase(cleanedForm.category);
     
      // Debug: Log education details being sent
      console.log('Education details being sent:', cleanedForm.educationDetails);
      console.log('Form state before cleaning - education details:', form.educationDetails);
     
      // Debug: Log form state before cleaning
      console.log('Form state before cleaning - emergency fields:', {
        emergencyContactName: form.emergencyContactName,
        emergencyContactAddress: form.emergencyContactAddress,
        emergencyCity: form.emergencyCity,
        emergencyState: form.emergencyState,
        emergencyPostalCode: form.emergencyPostalCode,
        spouse: form.spouse
      });
     
      // Debug: Log cleaned form emergency fields
      console.log('Cleaned form - emergency fields:', {
        emergencyContactName: cleanedForm.emergencyContactName,
        emergencyContactAddress: cleanedForm.emergencyContactAddress,
        emergencyCity: cleanedForm.emergencyCity,
        emergencyState: cleanedForm.emergencyState,
        emergencyPostalCode: cleanedForm.emergencyPostalCode,
        spouse: cleanedForm.spouse
      });

      // Upload pending files if any
      const pendingFiles = form._pendingFiles || {};
      console.log('Form state before upload:', form);
      console.log('Form keys:', Object.keys(form));
      console.log('Pending files to upload:', pendingFiles);
      console.log('Pending files keys:', Object.keys(pendingFiles));
      const uploadErrors = {};
      const uploadedFileInfo = {};
      for (const key of Object.keys(pendingFiles)) {
        const file = pendingFiles[key];
        console.log('Processing file upload for key:', key, 'file:', file);
        if (!file) {
          console.log('No file found for key:', key);
          continue;
        }
        const formData = new FormData();
        formData.append('file', file);
        console.log('FormData created for key:', key, 'file name:', file.name, 'file size:', file.size);
       
        const uploadUrl = isEditing
          ? `/server/cms_function/employees/${editingEmployeeId}/upload/${key}`
          : `/server/cms_function/employees/upload/${key}`;
        console.log('Upload URL:', uploadUrl);
       
        try {
          console.log('Starting upload request for key:', key);
          const resp = await axios.post(uploadUrl, formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
            timeout: 20000,
          });
          console.log('Upload response for key:', key, 'response:', resp.data);
          console.log('Upload response structure:', {
            hasData: !!resp.data,
            hasFileId: !!(resp.data && resp.data.fileId),
            hasFileName: !!(resp.data && resp.data.fileName),
            fileId: resp.data?.fileId,
            fileName: resp.data?.fileName,
            fullResponse: resp.data
          });
         
          if (resp.data && resp.data.fileId) {
            // Normalize the field names to match the form structure
            const normalizedKey = key.charAt(0).toLowerCase() + key.slice(1); // Convert 'Photo' to 'photo'
            uploadedFileInfo[`${normalizedKey}FileId`] = resp.data.fileId;
            uploadedFileInfo[`${normalizedKey}FileName`] = resp.data.fileName;
            console.log('File uploaded successfully for key:', key, 'normalizedKey:', normalizedKey, 'fileId:', resp.data.fileId, 'fileName:', resp.data.fileName);
          } else {
            console.error('Upload response missing fileId for key:', key, 'response:', resp.data);
            // Try alternative response structures
            if (resp.data && resp.data.id) {
              const normalizedKey = key.charAt(0).toLowerCase() + key.slice(1);
              uploadedFileInfo[`${normalizedKey}FileId`] = resp.data.id;
              uploadedFileInfo[`${normalizedKey}FileName`] = resp.data.name || resp.data.fileName || 'Unknown';
              console.log('Using alternative response structure for key:', key, 'normalizedKey:', normalizedKey, 'fileId:', resp.data.id, 'fileName:', resp.data.name || resp.data.fileName);
            }
          }
        } catch (err) {
          console.error('Upload error for key:', key, 'error:', err);
          console.error('Error response:', err.response?.data);
          console.error('Error status:', err.response?.status);
          uploadErrors[key] = err.response?.data?.message || 'Upload failed.';
        }
      }
      if (Object.keys(uploadErrors).length > 0) {
        console.error('Upload errors found:', uploadErrors);
        setForm(f => ({ ...f, _uploadErrors: uploadErrors }));
        setSubmitting(false);
        return;
      }
     
      console.log('All files uploaded successfully. Uploaded file info:', uploadedFileInfo);

      // Merge uploaded file info into cleanedForm
      Object.assign(cleanedForm, uploadedFileInfo);

      // Ensure DOB proof fields are never sent to backend
      delete cleanedForm.dobProofFileId;
      delete cleanedForm.dobProofFileName;
      delete cleanedForm.DOBProofFileId;
      delete cleanedForm.DOBProofFileName;

      // Debug log for update
      if (isEditing) {
        console.log('Updating employee:', editingEmployeeId, cleanedForm);
        console.log('Emergency contact fields being sent (PUT):', {
          emergencyContactName: cleanedForm.emergencyContactName,
          emergencyContactAddress: cleanedForm.emergencyContactAddress,
          emergencyCity: cleanedForm.emergencyCity,
          emergencyState: cleanedForm.emergencyState,
          emergencyPostalCode: cleanedForm.emergencyPostalCode,
          spouse: cleanedForm.spouse,
          type: typeof cleanedForm.emergencyContactName,
          isEmpty: !cleanedForm.emergencyContactName || cleanedForm.emergencyContactName.trim() === ''
        });
        console.log('Full cleanedForm keys:', Object.keys(cleanedForm));
        console.log('Full cleanedForm emergency fields:', JSON.stringify({
          emergencyContactName: cleanedForm.emergencyContactName,
          emergencyContactAddress: cleanedForm.emergencyContactAddress,
          emergencyCity: cleanedForm.emergencyCity,
          emergencyState: cleanedForm.emergencyState,
          emergencyPostalCode: cleanedForm.emergencyPostalCode,
          spouse: cleanedForm.spouse
        }));
      } else {
        console.log('Creating new employee:', cleanedForm);
        console.log('Emergency contact fields being sent (POST):', {
          emergencyContactName: cleanedForm.emergencyContactName,
          emergencyContactAddress: cleanedForm.emergencyContactAddress,
          emergencyCity: cleanedForm.emergencyCity,
          emergencyState: cleanedForm.emergencyState,
          emergencyPostalCode: cleanedForm.emergencyPostalCode,
          spouse: cleanedForm.spouse,
          type: typeof cleanedForm.emergencyContactName,
          isEmpty: !cleanedForm.emergencyContactName || cleanedForm.emergencyContactName.trim() === ''
        });
        console.log('Full cleanedForm keys:', Object.keys(cleanedForm));
        console.log('Full cleanedForm emergency fields (JSON):', JSON.stringify({
          emergencyContactName: cleanedForm.emergencyContactName,
          emergencyContactAddress: cleanedForm.emergencyContactAddress,
          emergencyCity: cleanedForm.emergencyCity,
          emergencyState: cleanedForm.emergencyState,
          emergencyPostalCode: cleanedForm.emergencyPostalCode,
          spouse: cleanedForm.spouse
        }));
      }

      // Prepare request config with userRole as query parameter
      const requestConfig = {
        timeout: 5000,
        params: {}
      };
      if (userRole) {
        requestConfig.params.userRole = userRole;
      }

      const request = isEditing
        ? axios.put(`/server/cms_function/employees/${editingEmployeeId}`, cleanedForm, requestConfig)
        : axios.post('/server/cms_function/employees', cleanedForm, requestConfig);

      request
        .then((response) => {
          console.log('Save employee response:', response);
          if (!response?.data?.data?.employee) {
            throw new Error('Unexpected API response structure');
          }
         
          // For new employees, update the form with the uploaded file information before resetting
          if (!isEditing && Object.keys(uploadedFileInfo).length > 0) {
            // Get the newly created employee ID from the response
            const newEmployeeId = response.data.data.employee.id;
           
            // Update the form state to show the uploaded files
            console.log('Updating form state with uploaded file info:', uploadedFileInfo);
            console.log('Previous form state before update:', form);
           
            // Update the form state with uploaded file information
            setForm(prevForm => {
              const newFormState = {
                ...prevForm,
                ...uploadedFileInfo,
                _pendingFiles: {},
                _uploadErrors: {}
              };
              console.log('New form state after update:', newFormState);
              console.log('Form state keys that contain FileId:', Object.keys(newFormState).filter(key => key.includes('FileId')));
              console.log('Form state keys that contain FileName:', Object.keys(newFormState).filter(key => key.includes('FileName')));
              return newFormState;
            });
           
            // Show a brief success message with file info
            const fileNames = Object.keys(uploadedFileInfo)
              .filter(key => key.endsWith('FileName'))
              .map(key => uploadedFileInfo[key])
              .filter(Boolean);
           
            if (fileNames.length > 0) {
              setFormError(`Employee created successfully! Uploaded files: ${fileNames.join(', ')}`);
              // Clear the success message after 3 seconds
              setTimeout(() => setFormError(''), 3000);
            }
           
            // Don't close the form immediately - let user see the uploaded files
            // User can manually close the form or it will auto-close after 5 seconds
            setTimeout(() => {
              setShowForm(false);
              setIsEditing(false);
              setEditingEmployeeId(null);
              setShowSalaryRevisedDetails(false);
              setOriginalSalaryValues({
                actualBasic: '',
                actualHRA: '',
                actualSpecialAllowance: '',
                actualDA: ''
              });
              fetchEmployees(); // Refetch employees after saving
            }, 5000);
          } else {
            // For editing, proceed as before
            fetchEmployees(); // Refetch employees after saving
            setForm({
              employeeCode: '',
              employeeName: '',
              personalEmail: '',
              phone: '',
              contractor: '',
              dateOfJoining: '',
              dateOfExit: '',
              employmentType: '',
              overallExperience: '',
              relevantExperience: '',
              sourceOfHire: '',
              department: '',
              designation: '',
              pfNo: '',
              esicNo: '',
              location: '',
              gradeLevel: '',
              uanNo: '',
              reportingTo: '',
              hrPartner: '',
              nationalHead: '',
              dateOfBirth: '',
              fathersName: '',
              age: '',
              emergencyContactNumber: '',
              emergencyContactName: '',
              emergencyContactAddress: '',
              emergencyCity: '',
              emergencyState: '',
              emergencyPostalCode: '',
              spouse: '',
              gender: '',
              bloodGroup: '',
              maritalStatus: '',
              presentAddressLine1: '',
              presentAddressLine2: '',
              presentCity: '',
              presentState: '',
              presentPostalCode: '',
              presentCountry: '',
              permanentAddressLine1: '',
              permanentAddressLine2: '',
              permanentCity: '',
              permanentState: '',
              permanentPostalCode: '',
              permanentCountry: '',
              // Clear all file-related fields
              photoFileId: '',
              photoFileName: '',
              aadharCopyFileId: '',
              aadharCopyFileName: '',
              educationalCertificatesFileId: '',
              educationalCertificatesFileName: '',
              bankPassbookFileId: '',
              bankPassbookFileName: '',
              experienceCertificateFileId: '',
              experienceCertificateFileName: '',
              pANCardFileId: '',
              pANCardFileName: '',
              resumeFileId: '',
              resumeFileName: '',
              // Salary Info fields
              actualBasic: '',
              actualHRA: '',
              actualSpecialAllowance: '',
              actualDA: '',
              attendanceAllowance: '',
              otherAllowance: '',
              travelChargers: '',
              foodAllowance: '',
              uniformAllowance: '',
              totalSalary: '',
              aadhaarNumber: '',
              panNumber: '',
              employeeStatus: '',
              category: '',
              secondaryContactNumber: '',
              drivingLicenseNumber: '',
              drivingLicenseExpiryDate: '',
              qualification: '',
              institutionName: '',
              fieldOfStudy: '',
              yearOfCompletion: '',
              percentageMarks: '',
              _pendingFiles: {},
              _uploadErrors: {},
            });
            setShowForm(false);
            setIsEditing(false);
            setEditingEmployeeId(null);
            setShowSalaryRevisedDetails(false);
            setOriginalSalaryValues({
              actualBasic: '',
              actualHRA: '',
              actualSpecialAllowance: '',
              actualDA: ''
            });
          }
        })
        .catch((err) => {
          console.error('Save employee error:', err);
          const serverError = err.response?.data?.message || (isEditing ? 'Failed to update employee.' : 'Failed to add employee.');
          setFormError(serverError);
        })
        .finally(() => setSubmitting(false));
    },
    [form, isEditing, editingEmployeeId, validateForm, fetchEmployees, userRole]
  );

  const removeEmployee = useCallback((id) => {
    setEmployees((prev) => prev.filter((emp) => String(emp.id) !== String(id)));
    setFilteredEmployees((prev) => prev.filter((emp) => String(emp.id) !== String(id)));
    setSelectedEmployees((prev) => prev.filter((empId) => String(empId) !== String(id)));
  }, []);

  const editEmployee = useCallback(async (employee) => {
    try {
      const { data } = await axios.get(`/server/cms_function/employees/${employee.id}`, { timeout: 5000 });
      const freshEmployee = data?.data?.employee;
      if (!freshEmployee) {
        throw new Error('Failed to fetch employee details');
      }
      const sanitize = (value) => value || ''; // Placeholder if not using DOMPurify
     
      // Helper function to convert date to YYYY-MM-DD format for HTML date inputs
      const formatDateForInput = (dateValue) => {
        if (!dateValue) return '';
        const strValue = String(dateValue).trim();
        if (!strValue) return '';
       
        // If already in YYYY-MM-DD format, return it
        if (/^\d{4}-\d{2}-\d{2}/.test(strValue)) {
          return strValue.slice(0, 10);
        }
       
        // Try to parse as a date
        try {
          const date = new Date(dateValue);
          if (!isNaN(date.getTime())) {
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
          }
        } catch (e) {
          // If parsing fails, return as is
        }
       
        return strValue.slice(0, 10);
      };
     
      // Check if age was calculated from date of birth
      const hasDateOfBirth = freshEmployee.dateOfBirth;
      const hasAge = freshEmployee.age;
      const shouldShowAutoCalculated = hasDateOfBirth && hasAge;
     
      setAgeAutoCalculated(shouldShowAutoCalculated);
      setAgeValid(shouldShowAutoCalculated);
      setForm({
        employeeCode: sanitize(freshEmployee.employeeCode),
        employeeName: sanitize(freshEmployee.employeeName),
        personalEmail: sanitize(freshEmployee.personalEmail),
        phone: sanitize(freshEmployee.phone),
        contractor: sanitize(freshEmployee.contractor),
        dateOfJoining: formatDateForInput(freshEmployee.dateOfJoining),
        dateOfExit: formatDateForInput(freshEmployee.dateOfExit),
        employmentType: sanitize(freshEmployee.employmentType),
        overallExperience: sanitize(freshEmployee.overallExperience),
        relevantExperience: sanitize(freshEmployee.relevantExperience),
        sourceOfHire: sanitize(freshEmployee.sourceOfHire),
        department: sanitize(freshEmployee.department),
        designation: sanitize(freshEmployee.designation),
        pfNo: sanitize(freshEmployee.pfNo),
        esicNo: sanitize(freshEmployee.esicNo),
        pfStatus: sanitize(freshEmployee.pfStatus),
        esiStatus: sanitize(freshEmployee.esiStatus),
        location: sanitize(freshEmployee.location),
        gradeLevel: sanitize(freshEmployee.gradeLevel),
        uanNo: sanitize(freshEmployee.uanNo),
        reportingTo: sanitize(freshEmployee.reportingTo),
        hrPartner: sanitize(freshEmployee.hrPartner),
        nationalHead: sanitize(freshEmployee.nationalHead),
        dateOfBirth: formatDateForInput(freshEmployee.dateOfBirth),
        fathersName: sanitize(freshEmployee.fathersName),
        age: sanitize(freshEmployee.age),
        emergencyContactNumber: sanitize(freshEmployee.emergencyContactNumber),
        emergencyContactName: sanitize(freshEmployee.emergencyContactName),
        emergencyContactAddress: sanitize(freshEmployee.emergencyContactAddress),
        emergencyCity: sanitize(freshEmployee.emergencyCity),
        emergencyState: sanitize(freshEmployee.emergencyState),
        emergencyPostalCode: sanitize(freshEmployee.emergencyPostalCode),
        spouse: sanitize(freshEmployee.spouse),
        gender: sanitize(freshEmployee.gender),
        bloodGroup: sanitize(freshEmployee.bloodGroup),
        maritalStatus: sanitize(freshEmployee.maritalStatus),
        presentAddressLine1: sanitize(freshEmployee.presentAddressLine1),
        presentAddressLine2: sanitize(freshEmployee.presentAddressLine2),
        presentCity: sanitize(freshEmployee.presentCity),
        presentState: sanitize(freshEmployee.presentState),
        presentPostalCode: sanitize(freshEmployee.presentPostalCode),
        presentCountry: sanitize(freshEmployee.presentCountry),
        permanentAddressLine1: sanitize(freshEmployee.permanentAddressLine1),
        permanentAddressLine2: sanitize(freshEmployee.permanentAddressLine2),
        permanentCity: sanitize(freshEmployee.permanentCity),
        permanentState: sanitize(freshEmployee.permanentState),
        permanentPostalCode: sanitize(freshEmployee.permanentPostalCode),
        permanentCountry: sanitize(freshEmployee.permanentCountry),
        // Add fileId and fileName fields for all document types to form state
        photoFileId: sanitize(freshEmployee.photoFileId),
        photoFileName: sanitize(freshEmployee.photoFileName),
        aadharCopyFileId: sanitize(freshEmployee.aadharCopyFileId),
        aadharCopyFileName: sanitize(freshEmployee.aadharCopyFileName),
        educationalCertificatesFileId: sanitize(freshEmployee.educationalCertificatesFileId),
        educationalCertificatesFileName: sanitize(freshEmployee.educationalCertificatesFileName),
        bankPassbookFileId: sanitize(freshEmployee.bankPassbookFileId),
        bankPassbookFileName: sanitize(freshEmployee.bankPassbookFileName),
        experienceCertificateFileId: sanitize(freshEmployee.experienceCertificateFileId),
        experienceCertificateFileName: sanitize(freshEmployee.experienceCertificateFileName),
        pANCardFileId: sanitize(freshEmployee.pANCardFileId),
        pANCardFileName: sanitize(freshEmployee.pANCardFileName),
        resumeFileId: sanitize(freshEmployee.resumeFileId),
        resumeFileName: sanitize(freshEmployee.resumeFileName),
        // Salary Info fields
        actualBasic: sanitize(freshEmployee.actualBasic),
        actualHRA: sanitize(freshEmployee.actualHRA),
        actualSpecialAllowance: sanitize(freshEmployee.actualSpecialAllowance),
        actualDA: sanitize(freshEmployee.actualDA),
        attendanceAllowance: sanitize(freshEmployee.attendanceAllowance),
        otherAllowance: sanitize(freshEmployee.otherAllowance),
        travelChargers: sanitize(freshEmployee.travelChargers),
        foodAllowance: sanitize(freshEmployee.foodAllowance),
        uniformAllowance: sanitize(freshEmployee.uniformAllowance),
        totalSalary: sanitize(freshEmployee.totalSalary),
        // Salary Revised Details fields - populate with existing values
        revisedActualBasic: sanitize(freshEmployee.revisedActualBasic),
        revisedActualHRA: sanitize(freshEmployee.revisedActualHRA),
        revisedActualDA: sanitize(freshEmployee.revisedActualDA),
        revisedOtherAllowance: sanitize(freshEmployee.revisedOtherAllowance),
        monthData: sanitize(freshEmployee.monthData),
        dateData: formatDateForInput(freshEmployee.dateData),
        revisedTotalSalary: sanitize(freshEmployee.revisedTotalSalary),
        aadhaarNumber: sanitize(freshEmployee.aadhaarNumber),
        panNumber: sanitize(freshEmployee.panNumber),
        employeeStatus: sanitize(freshEmployee.employeeStatus),
        category: sanitize(freshEmployee.category),
        secondaryContactNumber: sanitize(freshEmployee.secondaryContactNumber),
        drivingLicenseNumber: sanitize(freshEmployee.drivingLicenseNumber),
        drivingLicenseExpiryDate: sanitize(freshEmployee.drivingLicenseExpiryDate),
        bankHolderName: sanitize(freshEmployee.bankHolderName),
        bankName: sanitize(freshEmployee.bankName),
        accountNumber: sanitize(freshEmployee.accountNumber),
        ifscCode: sanitize(freshEmployee.ifscCode),
        bankBranch: sanitize(freshEmployee.bankBranch),
        educationDetails: (() => {
          // Debug: Log what we received
          console.log('Edit employee - educationDetails received:', freshEmployee.educationDetails);
          console.log('Edit employee - educationDetails type:', typeof freshEmployee.educationDetails);
          console.log('Edit employee - educationDetails is array:', Array.isArray(freshEmployee.educationDetails));
         
          // Check if educationDetails exists and is an array with entries
          if (freshEmployee.educationDetails && Array.isArray(freshEmployee.educationDetails) && freshEmployee.educationDetails.length > 0) {
            const mapped = freshEmployee.educationDetails.map(edu => ({
              qualification: sanitize(edu.qualification),
              institutionName: sanitize(edu.institutionName),
              fieldOfStudy: sanitize(edu.fieldOfStudy),
              yearOfCompletion: sanitize(edu.yearOfCompletion),
              percentageMarks: sanitize(edu.percentageMarks)
            }));
            console.log('Edit employee - Mapped education details:', mapped);
            return mapped;
          }
         
          // Fallback: Check individual fields (for backward compatibility)
          if (freshEmployee.qualification || freshEmployee.institutionName || freshEmployee.fieldOfStudy ||
              freshEmployee.yearOfCompletion || freshEmployee.percentageMarks) {
            console.log('Edit employee - Using individual education fields as fallback');
            return [{
              qualification: sanitize(freshEmployee.qualification),
              institutionName: sanitize(freshEmployee.institutionName),
              fieldOfStudy: sanitize(freshEmployee.fieldOfStudy),
              yearOfCompletion: sanitize(freshEmployee.yearOfCompletion),
              percentageMarks: sanitize(freshEmployee.percentageMarks)
            }];
          }
         
          // Default: empty education entry
          console.log('Edit employee - No education details found, using empty entry');
          return [
            { qualification: '', institutionName: '', fieldOfStudy: '', yearOfCompletion: '', percentageMarks: '' }
          ];
        })(),
      });
     
      // Store original salary values for comparison
      setOriginalSalaryValues({
        actualBasic: sanitize(freshEmployee.actualBasic),
        actualHRA: sanitize(freshEmployee.actualHRA),
        actualSpecialAllowance: sanitize(freshEmployee.actualSpecialAllowance),
        actualDA: sanitize(freshEmployee.actualDA)
      });
     
      // Show Salary Revised Details container when editing
      setShowSalaryRevisedDetails(true);
     
      setIsEditing(true);
      setEditingEmployeeId(freshEmployee.id);
      setShowForm(true);
      // Debug log for edit
      console.log('Editing employee:', freshEmployee.id, freshEmployee);
    } catch (error) {
      console.error('Failed to fetch fresh employee data:', error);
      // Fallback to previous behavior
      const sanitize = (value) => value || '';
      const formatDateForInput = (dateValue) => {
        if (!dateValue) return '';
        const strValue = String(dateValue).trim();
        if (!strValue) return '';
       
        // If already in YYYY-MM-DD format, return it
        if (/^\d{4}-\d{2}-\d{2}/.test(strValue)) {
          return strValue.slice(0, 10);
        }
       
        // Try to parse as a date
        try {
          const date = new Date(dateValue);
          if (!isNaN(date.getTime())) {
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
          }
        } catch (e) {
          // If parsing fails, return as is
        }
       
        return strValue.slice(0, 10);
      };
      setForm({
        employeeCode: sanitize(employee.employeeCode),
        employeeName: sanitize(employee.employeeName),
        personalEmail: sanitize(employee.personalEmail),
        phone: sanitize(employee.phone),
        contractor: forcedContractor || sanitize(employee.contractor),
        dateOfJoining: formatDateForInput(employee.dateOfJoining),
        dateOfExit: formatDateForInput(employee.dateOfExit),
        employmentType: sanitize(employee.employmentType),
        overallExperience: sanitize(employee.overallExperience),
        relevantExperience: sanitize(employee.relevantExperience),
        sourceOfHire: sanitize(employee.sourceOfHire),
        department: sanitize(employee.department),
        designation: sanitize(employee.designation),
        pfNo: sanitize(employee.pfNo),
        esicNo: sanitize(employee.esicNo),
        pfStatus: sanitize(employee.pfStatus),
        esiStatus: sanitize(employee.esiStatus),
        location: sanitize(employee.location),
        gradeLevel: sanitize(employee.gradeLevel),
        uanNo: sanitize(employee.uanNo),
        reportingTo: sanitize(employee.reportingTo),
        hrPartner: sanitize(employee.hrPartner),
        nationalHead: sanitize(employee.nationalHead),
        dateOfBirth: formatDateForInput(employee.dateOfBirth),
        fathersName: sanitize(employee.fathersName),
        age: sanitize(employee.age),
        emergencyContactNumber: sanitize(employee.emergencyContactNumber),
        emergencyContactName: sanitize(employee.emergencyContactName),
        emergencyContactAddress: sanitize(employee.emergencyContactAddress),
        emergencyCity: sanitize(employee.emergencyCity),
        emergencyState: sanitize(employee.emergencyState),
        emergencyPostalCode: sanitize(employee.emergencyPostalCode),
        spouse: sanitize(employee.spouse),
        gender: sanitize(employee.gender),
        bloodGroup: sanitize(employee.bloodGroup),
        maritalStatus: sanitize(employee.maritalStatus),
        presentAddressLine1: sanitize(employee.presentAddressLine1),
        presentAddressLine2: sanitize(employee.presentAddressLine2),
        presentCity: sanitize(employee.presentCity),
        presentState: sanitize(employee.presentState),
        presentPostalCode: sanitize(employee.presentPostalCode),
        presentCountry: sanitize(employee.presentCountry),
        permanentAddressLine1: sanitize(employee.permanentAddressLine1),
        permanentAddressLine2: sanitize(employee.permanentAddressLine2),
        permanentCity: sanitize(employee.permanentCity),
        permanentState: sanitize(employee.permanentState),
        permanentPostalCode: sanitize(employee.permanentPostalCode),
        permanentCountry: sanitize(employee.permanentCountry),
        photoFileId: sanitize(employee.photoFileId),
        photoFileName: sanitize(employee.photoFileName),
        aadharCopyFileId: sanitize(employee.aadharCopyFileId),
        aadharCopyFileName: sanitize(employee.aadharCopyFileName),
        educationalCertificatesFileId: sanitize(employee.educationalCertificatesFileId),
        educationalCertificatesFileName: sanitize(employee.educationalCertificatesFileName),
        bankPassbookFileId: sanitize(employee.bankPassbookFileId),
        bankPassbookFileName: sanitize(employee.bankPassbookFileName),
        experienceCertificateFileId: sanitize(employee.experienceCertificateFileId),
        experienceCertificateFileName: sanitize(employee.experienceCertificateFileName),
        pANCardFileId: sanitize(employee.pANCardFileId),
        pANCardFileName: sanitize(employee.pANCardFileName),
        resumeFileId: sanitize(employee.resumeFileId),
        resumeFileName: sanitize(employee.resumeFileName),
        aadhaarNumber: sanitize(employee.aadhaarNumber),
        panNumber: sanitize(employee.panNumber),
        employeeStatus: sanitize(employee.employeeStatus),
        category: sanitize(employee.category),
        secondaryContactNumber: sanitize(employee.secondaryContactNumber),
        drivingLicenseNumber: sanitize(employee.drivingLicenseNumber),
        drivingLicenseExpiryDate: sanitize(employee.drivingLicenseExpiryDate),
        bankHolderName: sanitize(employee.bankHolderName),
        bankName: sanitize(employee.bankName),
        accountNumber: sanitize(employee.accountNumber),
        ifscCode: sanitize(employee.ifscCode),
        bankBranch: sanitize(employee.bankBranch),
        // Salary Info fields
        actualBasic: sanitize(employee.actualBasic),
        actualHRA: sanitize(employee.actualHRA),
        actualSpecialAllowance: sanitize(employee.actualSpecialAllowance),
        actualDA: sanitize(employee.actualDA),
        attendanceAllowance: sanitize(employee.attendanceAllowance),
        otherAllowance: sanitize(employee.otherAllowance),
        travelChargers: sanitize(employee.travelChargers),
        totalSalary: sanitize(employee.totalSalary),
        // Salary Revised Details fields - populate with existing values
        revisedActualBasic: sanitize(employee.revisedActualBasic),
        revisedActualHRA: sanitize(employee.revisedActualHRA),
        revisedActualDA: sanitize(employee.revisedActualDA),
        revisedOtherAllowance: sanitize(employee.revisedOtherAllowance),
        monthData: sanitize(employee.monthData),
        dateData: formatDateForInput(employee.dateData),
        revisedTotalSalary: sanitize(employee.revisedTotalSalary),
        educationDetails: employee.educationDetails && employee.educationDetails.length > 0
          ? employee.educationDetails.map(edu => ({
              qualification: sanitize(edu.qualification),
              institutionName: sanitize(edu.institutionName),
              fieldOfStudy: sanitize(edu.fieldOfStudy),
              yearOfCompletion: sanitize(edu.yearOfCompletion),
              percentageMarks: sanitize(edu.percentageMarks)
            }))
          : [
              { qualification: '', institutionName: '', fieldOfStudy: '', yearOfCompletion: '', percentageMarks: '' }
            ],
      });
     
      // Store original salary values for comparison
      setOriginalSalaryValues({
        actualBasic: sanitize(employee.actualBasic),
        actualHRA: sanitize(employee.actualHRA),
        actualSpecialAllowance: sanitize(employee.actualSpecialAllowance),
        actualDA: sanitize(employee.actualDA)
      });
     
      // Show Salary Revised Details container when editing
      setShowSalaryRevisedDetails(true);
     
      setIsEditing(true);
      setEditingEmployeeId(employee.id);
      setShowForm(true);
      // Debug log for edit (fallback)
      console.log('Editing employee (fallback):', employee.id, employee);
    }
  }, []);

  const toggleForm = useCallback(() => {
    setShowForm((prev) => !prev);
    setFormError('');
    setAgeAutoCalculated(false);
    setAgeValid(false);
    setShowSalaryRevisedDetails(true);
    setOriginalSalaryValues({
      actualBasic: '',
      actualHRA: '',
      actualSpecialAllowance: '',
      actualDA: ''
    });
   
    // Scroll to top when opening form
    if (!showForm) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    setForm({
      employeeCode: '',
      employeeName: '',
      personalEmail: '',
      phone: '',
      contractor: forcedContractor || '',
      dateOfJoining: '',
      dateOfExit: '',
      employmentType: '',
      overallExperience: '',
      relevantExperience: '',
      sourceOfHire: '',
      department: '',
      designation: '',
      pfNo: '',
      esicNo: '',
      location: '',
      gradeLevel: '',
      uanNo: '',
      reportingTo: '',
      hrPartner: '',
      nationalHead: '',
      dateOfBirth: '',
      fathersName: '',
      age: '',
      emergencyContactNumber: '',
      emergencyContactName: '',
      emergencyContactAddress: '',
      emergencyCity: '',
      emergencyState: '',
      emergencyPostalCode: '',
      spouse: '',
      gender: '',
      bloodGroup: '',
      maritalStatus: '',
      presentAddressLine1: '',
      presentAddressLine2: '',
      presentCity: '',
      presentState: '',
      presentPostalCode: '',
      presentCountry: '',
      permanentAddressLine1: '',
      permanentAddressLine2: '',
      permanentCity: '',
      permanentState: '',
      permanentPostalCode: '',
      permanentCountry: '',
      // Clear all file-related fields
      photoFileId: '',
      photoFileName: '',
      aadharCopyFileId: '',
      aadharCopyFileName: '',
      educationalCertificatesFileId: '',
      educationalCertificatesFileName: '',
      bankPassbookFileId: '',
      bankPassbookFileName: '',
      experienceCertificateFileId: '',
      experienceCertificateFileName: '',
      pANCardFileId: '',
      pANCardFileName: '',
      resumeFileId: '',
      resumeFileName: '',
      // Clear search fields
      aadhaarNumber: '',
      panNumber: '',
      employeeStatus: '',
      category: '',
      secondaryContactNumber: '',
      drivingLicenseNumber: '',
      drivingLicenseExpiryDate: '',
      bankHolderName: '',
      bankName: '',
      accountNumber: '',
      ifscCode: '',
      bankBranch: '',
      // Salary fields
      actualBasic: '',
      actualHRA: '',
      actualSpecialAllowance: '',
      actualDA: '',
      attendanceAllowance: '',
      otherAllowance: '',
      travelChargers: '',
      foodAllowance: '',
      uniformAllowance: '',
      totalSalary: '',
    // Salary Revised Details fields
      revisedActualBasic: '',
      revisedActualHRA: '',
      revisedActualDA: '',
      revisedOtherAllowance: '',
      monthData: '',
      dateData: '',
      revisedTotalSalary: '',
      pfStatus: '',
      esiStatus: '',
      educationDetails: [
        { qualification: '', institutionName: '', fieldOfStudy: '', yearOfCompletion: '', percentageMarks: '' }
      ],
    });
    setIsEditing(false);
    setEditingEmployeeId(null);
  }, [userRole, forcedContractor, showForm]);

  // Add this near other options
  const [contractorOptions, setContractorOptions] = useState([{ value: '', label: '-Select-' }]);


  // Fetch contractors from API
  useEffect(() => {
    // If user is restricted, skip fetch and set only the forced contractor
    if (forcedContractor) {
      setContractorOptions([{ value: forcedContractor, label: forcedContractor }]);
      // Also set form contractor when opening a new form
      setForm((prev) => ({ ...prev, contractor: forcedContractor }));
      return;
    }
    axios
      .get('/server/Contracters_function/contractors')
      .then((res) => {
        const contractors = res.data.data.contractors || [];
        const options = [{ value: '', label: '-Select-' }].concat(
          contractors.map((c) => ({
            value: c.ContractorName,
            label: c.ContractorName,
          }))
        );
        // If restricted, override with forced contractor
        if (forcedContractor) {
          setContractorOptions([{ value: forcedContractor, label: forcedContractor }]);
          setForm((prev) => ({ ...prev, contractor: forcedContractor }));
        } else {
          setContractorOptions(options);
        }
      })
      .catch((err) => {
        console.error('Failed to fetch contractors:', err);
        if (forcedContractor) {
          setContractorOptions([{ value: forcedContractor, label: forcedContractor }]);
          setForm((prev) => ({ ...prev, contractor: forcedContractor }));
        } else {
          setContractorOptions([{ value: '', label: '-Select-' }]);
        }
      });
  }, [forcedContractor, setForm]);


  // Debug useEffect to monitor form state changes
  useEffect(() => {
    if (showForm && !isEditing) {
      console.log('Form state changed:', form);
      console.log('Form file fields:', {
        photoFileId: form.photoFileId,
        photoFileName: form.photoFileName,
        aadharCopyFileId: form.aadharCopyFileId,
        aadharCopyFileName: form.aadharCopyFileName,
        // Add other file fields as needed
      });
    }
  }, [form, showForm, isEditing]);

  // Education functions
  const handleEducationChange = (index, field, value) => {
    setForm(prev => ({
      ...prev,
      educationDetails: prev.educationDetails.map((edu, idx) =>
        idx === index ? { ...edu, [field]: value } : edu
      )
    }));
  };

  const handleAddEducation = () => {
    setForm(prev => ({
      ...prev,
      educationDetails: [...prev.educationDetails, {
        qualification: '',
        institutionName: '',
        fieldOfStudy: '',
        yearOfCompletion: '',
        percentageMarks: ''
      }]
    }));
  };

  const handleRemoveEducation = (index) => {
    setForm(prev => ({
      ...prev,
      educationDetails: prev.educationDetails.filter((_, idx) => idx !== index)
    }));
  };

  const modulesToShow = useMemo(() => getSidebarModulesForUser(userEmail, userRole), [userEmail, userRole]);

  // Edit column not shown in table; columns without Edit
  const dynamicColumns = useMemo(() => columns.filter(col => col.label !== 'Edit'), []);

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
    { icon: '👥', title: 'New Employee Added', description: 'John Doe has been added to the system', time: '2 minutes ago' },
    { icon: '📝', title: 'Employee Updated', description: 'Jane Smith\'s information has been updated', time: '5 minutes ago' },
    { icon: '🗑️', title: 'Employee Removed', description: 'Mike Johnson has been removed from the system', time: '10 minutes ago' },
    { icon: '📊', title: 'Report Generated', description: 'Monthly employee report has been generated', time: '1 hour ago' }
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

          {/* Employee Management Content */}
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
            <div className="employee-header-actions">
              <div className="employee-title-section">
                <h2 className="employee-title">
                  <Users size={28} />
                  Employee Directory
                </h2>
                <p className="employee-subtitle">
                  Manage your employee's details efficiently
                </p>
              </div>
            </div>
            {/* Toolbar Buttons */}
            <div className="employee-toolbar" style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'nowrap' }}>
              <button
                className="toolbar-btn import-btn"
                onClick={() => fileInputRef.current.click()}
                disabled={importing}
                title="Import employees from Excel"
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
                title="Export filtered employees to Excel"
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
                onClick={() => {
                  setPage(1);
                  setShowAll(false);
                  fetchEmployees();
                }}
                disabled={fetchState === 'loading'}
                title="Refresh data"
                type="button"
                style={{ background: '#fff', color: '#7c3aed', border: 'none', fontWeight: 600, padding: '8px', borderRadius: '8px', width: '48px', height: '48px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}
              >
                <RefreshCw size={22} style={{ color: '#7c3aed' }} />
              </button>
              <button
                className="toolbar-btn toolbar-btn-add-employee"
                onClick={toggleForm}
                type="button"
                title="Add new employee"
                style={{
                  background: '#fff',
                  color: '#14b8a6',
                  border: '2px solid rgba(20, 184, 166, 0.35)',
                  fontWeight: 700,
                  borderRadius: '12px',
                  width: '60px',
                  height: '60px',
                  minWidth: '60px',
                  minHeight: '60px',
                  padding: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 4px 14px rgba(20, 184, 166, 0.22)',
                  flexShrink: 0,
                }}
              >
                <Plus size={34} strokeWidth={2.5} style={{ color: '#14b8a6' }} aria-hidden />
              </button>
              {/* Delete button for selected employees */}
              {selectedEmployees.length > 0 && (
                <button
                  className="toolbar-btn"
                  onClick={handleMassDelete}
                  disabled={deletingMultiple}
                  title="Delete selected employees"
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

          {/* Filter Sidebar */}
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
              <div
                ref={dropdownRef}
                style={{
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
                          checked={searchFields[field]?.enabled || false}
                          onChange={() => handleFieldToggle(field)}
                          style={{ width: '16px', height: '16px' }}
                        />
                        {label}
                      </label>
                      {searchFields[field]?.enabled && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginLeft: '24px' }}>
                          {field === 'employeeCode' ? (
                            createDropdownUI(
                              'employeeCode', 'Employee Code', employeeCodes,
                              employeeCodeSearch, setEmployeeCodeSearch,
                              isEmployeeCodeDropdownOpen, setIsEmployeeCodeDropdownOpen,
                              handleEmployeeCodeSelect, loadingEmployeeCodes, filteredEmployeeCodes
                            )
                          ) : field === 'employeeName' ? (
                            createDropdownUI(
                              'employeeName', 'Employee Name', employeeNames,
                              employeeNameSearch, setEmployeeNameSearch,
                              isEmployeeNameDropdownOpen, setIsEmployeeNameDropdownOpen,
                              handleEmployeeNameSelect, loadingEmployeeNames, filteredEmployeeNames
                            )
                          ) : field === 'employmentType' ? (
                            createDropdownUI(
                              'employmentType', 'Employment Type', employmentTypes,
                              employmentTypeSearch, setEmploymentTypeSearch,
                              isEmploymentTypeDropdownOpen, setIsEmploymentTypeDropdownOpen,
                              handleEmploymentTypeSelect, loadingEmploymentTypes, filteredEmploymentTypes
                            )
                          ) : field === 'dateOfExit' ? (
                            createDropdownUI(
                              'dateOfExit', 'Exit Date', exitDates,
                              exitDateSearch, setExitDateSearch,
                              isExitDateDropdownOpen, setIsExitDateDropdownOpen,
                              handleExitDateSelect, loadingExitDates, filteredExitDates
                            )
                          ) : field === 'gender' ? (
                            createDropdownUI(
                              'gender', 'Gender', genders,
                              genderSearch, setGenderSearch,
                              isGenderDropdownOpen, setIsGenderDropdownOpen,
                              handleGenderSelect, loadingGenders, filteredGenders
                            )
                          ) : searchFields[field]?.checkbox !== undefined ? (
                            <input
                              type="text"
                              value={searchFields[field]?.value || ''}
                              onChange={(e) => setSearchFields(prev => ({
                                ...prev,
                                [field]: { ...prev[field], value: e.target.value }
                              }))}
                              placeholder={`Search ${field.replace(/([A-Z])/g, ' $1').toLowerCase()}`}
                              style={{
                                width: '100%',
                                padding: '8px 12px',
                                border: '1px solid #ddd',
                                borderRadius: '4px',
                                fontSize: '14px'
                              }}
                            />
                          ) : ['personalEmail', 'phone', 'dateOfJoining', 'dateOfBirth', 'department', 'designation', 'location', 'gradeLevel', 'reportingTo', 'age', 'bloodGroup', 'maritalStatus', 'fathersName', 'secondaryContactNumber', 'emergencyContactNumber', 'emergencyContactName', 'emergencyContactAddress', 'emergencyCity', 'emergencyState', 'emergencyPostalCode', 'spouse', 'presentAddressLine1', 'presentAddressLine2', 'presentCity', 'presentState', 'presentPostalCode', 'presentCountry', 'permanentAddressLine1', 'permanentAddressLine2', 'permanentCity', 'permanentState', 'permanentPostalCode', 'permanentCountry', 'aadhaarNumber', 'panNumber', 'uanNo', 'pfNo', 'esicNo', 'pfStatus', 'esiStatus', 'drivingLicenseNumber', 'drivingLicenseExpiryDate', 'overallExperience', 'relevantExperience', 'sourceOfHire'].includes(field) ? (
                            <input
                              type="text"
                              value={searchFields[field]?.value || ''}
                              onChange={(e) => handleSearchValueChange(field, e.target.value)}
                              placeholder={`Enter ${label.toLowerCase()}`}
                              style={{
                                width: '100%',
                                padding: '6px 8px',
                                border: '1px solid #d1d5db',
                                borderRadius: '4px',
                                fontSize: '14px',
                                backgroundColor: 'white'
                              }}
                            />
                          ) : (
                            <>
                              <select
                                value={searchFields[field].mode}
                                onChange={(e) => handleModeChange(field, e.target.value)}
                                style={{
                                  padding: '6px 8px',
                                  border: '1px solid #d1d5db',
                                  borderRadius: '4px',
                                  fontSize: '14px',
                                  backgroundColor: 'white'
                                }}
                              >
                                {filterModes.map((mode) => (
                                  <option key={mode.value} value={mode.value}>{mode.label}</option>
                                ))}
                              </select>
                              <input
                                type="text"
                                value={searchFields[field].value}
                                onChange={(e) => handleSearchValueChange(field, e.target.value)}
                                placeholder={`Enter ${label.toLowerCase()}`}
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

          {importError && (
            <div className="error-message" style={{ margin: '10px 0', color: 'red' }}>
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

          {Object.values(searchFields).some(field => field.enabled) && (
            <div className="filter-summary" style={{ margin: '10px 0', fontSize: '14px', color: '#555' }}>
              <strong>Active Filters: </strong>
              {searchableFields
                .filter(({ field }) => searchFields[field].enabled)
                .map(({ label, field }) => (
                  <span key={field} style={{ marginRight: '10px' }}>
                    {field === 'employeeCode' ? (
                      `${label}: ${searchFields[field].selectedCode}`
                    ) : field === 'employeeName' ? (
                      `${label}: ${searchFields[field].selectedName}`
                    ) : field === 'employmentType' ? (
                      `${label}: ${searchFields[field].selectedEmploymentType}`
                    ) : field === 'dateOfExit' ? (
                      `${label}: ${searchFields[field].selectedExitDate}`
                    ) : field === 'gender' ? (
                      `${label}: ${searchFields[field].selectedGender}`
                    ) : ['personalEmail', 'phone', 'dateOfJoining', 'dateOfBirth', 'department', 'designation', 'location', 'gradeLevel', 'reportingTo', 'age', 'bloodGroup', 'maritalStatus', 'fathersName', 'secondaryContactNumber', 'emergencyContactNumber', 'emergencyContactName', 'emergencyContactAddress', 'emergencyCity', 'emergencyState', 'emergencyPostalCode', 'spouse', 'presentAddressLine1', 'presentAddressLine2', 'presentCity', 'presentState', 'presentPostalCode', 'presentCountry', 'permanentAddressLine1', 'permanentAddressLine2', 'permanentCity', 'permanentState', 'permanentPostalCode', 'permanentCountry', 'aadhaarNumber', 'panNumber', 'uanNo', 'pfNo', 'esicNo', 'drivingLicenseNumber', 'drivingLicenseExpiryDate', 'overallExperience', 'relevantExperience', 'sourceOfHire'].includes(field) ? (
                      `${label}: "${searchFields[field].value}"`
                    ) : searchFields[field].value !== undefined && searchFields[field].checkbox === undefined ? (
                      `${label}: "${searchFields[field].value}"`
                    ) : searchFields[field].checkbox !== undefined ? (
                      `${label}: Has Data`
                    ) : (
                      <>
                        {label} {searchFields[field].mode}
                        {searchFields[field].mode === 'is' || searchFields[field].mode === 'is not' ? ` "${searchFields[field].value}"` : ''}
                      </>
                    )}
                  </span>
                ))}
            </div>
          )}

          {/* Employee Form - Display above table when open */}
          {showForm && (
            <div className="employee-form-page">
              <div className="employee-form-container">
                <div className="employee-form-header">
                  <h1 style={{ paddingLeft: '20px' }}>
                    {isEditing ? 'Edit Employee' : 'Add New Employee'}
                  </h1>
            <button
                    type="button"
                    className="close-btn"
                    onClick={toggleForm}
                    title="Close form"
                    aria-label="Close form"
                  >
                    <X size={32} strokeWidth={2.5} aria-hidden />
            </button>
          </div>
          <div className="employee-form-content">
              <div className="employee-form-card">
                {/* Employee Info Card */}
                <div className="form-section-card employee-info">
                  <h2 className="section-title">Employee Info </h2>
                  <div className="form-grid">
                    <div className="form-group">
                      <label>Employee Code *</label>
                      <input className="input" type="text" name="employeeCode" value={form.employeeCode} onChange={onChange} />
                    </div>
                    <div className="form-group">
                      <label>Employee Name</label>
                      <input className="input" type="text" name="employeeName" value={form.employeeName} onChange={onChange} />
                    </div>
                  </div>
                </div>
               
                {/* Work Info Card */}
                <div className="form-section-card work-info">
                  <h2 className="section-title">Work Info</h2>
                  <div className="form-grid">
                    <div className="form-group">
                      <label>Date of Joining *</label>
                      <input className="input" type="date" name="dateOfJoining" value={form.dateOfJoining} onChange={onChange} />
                    </div>
                    <div className="form-group">
                      <label>Employment Type</label>
                      <input className="input" type="text" name="employmentType" value={form.employmentType} onChange={onChange} placeholder="Enter employment type" />
                    </div>
                    <div className="form-group">
                      <label htmlFor="department">Department</label>
                      <select
                        className="input"
                        id="department"
                        name="department"
                        value={form.department}
                        onChange={onChange}
                      >
                        {departmentOptionsForSelect.map((opt) => (
                          <option key={opt.value || 'empty'} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </div>
                    <div className="form-group">
                      <label htmlFor="designation">Designation</label>
                      <select
                        className="input"
                        id="designation"
                        name="designation"
                        value={form.designation}
                        onChange={onChange}
                      >
                        {designationOptionsForSelect.map((opt) => (
                          <option key={opt.value || 'empty'} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </div>
                    </div>
                  </div>
                 
                  {/* Personal Info Card */}
                  <div className="form-section-card personal-info">
                    <h2 className="section-title">Personal Info</h2>
                    <div className="form-grid">
                      <div className="form-group">
                        <label>Date of Birth</label>
                        <input className="input" type="date" name="dateOfBirth" value={form.dateOfBirth} onChange={onChange} />
                      </div>
                      <div className="form-group">
                        <label>Age</label>
                        <input className="input" name="age" value={form.age} onChange={onChange} readOnly={ageAutoCalculated} />
                      </div>
                      <div className="form-group">
                        <label>Gender</label>
                        <select className="input" name="gender" value={form.gender} onChange={onChange}>
                          <option value="">-Select-</option>
                          <option value="Male">Male</option>
                          <option value="Female">Female</option>
                          <option value="Other">Other</option>
                        </select>
                      </div>
                      <div className="form-group">
                        <label>Blood Group</label>
                        <select className="input" name="bloodGroup" value={form.bloodGroup} onChange={onChange}>
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
                      </div>
                      <div className="form-group">
                        <label>Marital Status</label>
                        <select className="input" name="maritalStatus" value={form.maritalStatus} onChange={onChange}>
                          <option value="">-Select-</option>
                          <option value="Single">Single</option>
                          <option value="Married">Married</option>
                          <option value="Divorced">Divorced</option>
                          <option value="Widowed">Widowed</option>
                        </select>
                      </div>
                      <div className="form-group">
                        <label>FatherName</label>
                        <input className="input" name="fathersName" value={form.fathersName} onChange={onChange} />
                      </div>
                      <div className="form-group">
                        <label>Spouse</label>
                        <input className="input" name="spouse" value={form.spouse} onChange={onChange} />
                      </div>
                    </div>
                  </div>
                 
                  {/* Contact Info Card */}
                  <div className="form-section-card contact-info">
                    <h2 className="section-title">Contact Info</h2>
                    <div className="form-grid">
                  <div className="form-group">
                        <label>Email</label>
                        <input className="input" type="email" name="personalEmail" value={form.personalEmail} onChange={onChange} />
                  </div>
                  <div className="form-group">
                        <label>Phone</label>
                        <input className="input" name="phone" value={form.phone} onChange={onChange} />
                  </div>
                      <div className="form-group">
                        <label>Secondary Contact Number</label>
                        <input className="input" name="secondaryContactNumber" value={form.secondaryContactNumber} onChange={onChange} />
                      </div>
                      <div className="form-group">
                        <label>Emergency Contact Number</label>
                        <input className="input" name="emergencyContactNumber" value={form.emergencyContactNumber} onChange={onChange} />
                      </div>
                      <div className="form-group">
                        <label>Emergency Contact Name</label>
                        <input className="input" name="emergencyContactName" value={form.emergencyContactName} onChange={onChange} />
                      </div>
                      <div className="form-group">
                        <label>Emergency Contact Address</label>
                        <input className="input" name="emergencyContactAddress" value={form.emergencyContactAddress} onChange={onChange} />
                      </div>
                      <div className="form-group">
                        <label>Emergency City</label>
                        <input className="input" name="emergencyCity" value={form.emergencyCity} onChange={onChange} />
                      </div>
                      <div className="form-group">
                        <label>Emergency State</label>
                        <input className="input" name="emergencyState" value={form.emergencyState} onChange={onChange} />
                      </div>
                      <div className="form-group">
                        <label>Emergency Postal Code</label>
                        <input className="input" name="emergencyPostalCode" value={form.emergencyPostalCode} onChange={onChange} />
                      </div>
                </div>
                </div>
               
                  {/* Address Details Card */}
                  <div className="form-section-card address-details">
                    <h2 className="section-title">Address Details</h2>
                   
                    {/* Present Address */}
                    <div className="address-block">
                      <h4>Present Address</h4>
                  <div className="form-grid">
                  <div className="form-group">
                          <label>Address Line 1</label>
                          <input className="input" name="presentAddressLine1" value={form.presentAddressLine1} onChange={onChange} />
                  </div>
                  <div className="form-group">
                          <label>Address Line 2</label>
                          <input className="input" name="presentAddressLine2" value={form.presentAddressLine2} onChange={onChange} />
                  </div>
                  <div className="form-group">
                          <label>City</label>
                          <input className="input" name="presentCity" value={form.presentCity} onChange={onChange} />
                        </div>
                        <div className="form-group">
                          <label>State</label>
                          <input className="input" name="presentState" value={form.presentState} onChange={onChange} />
                        </div>
                        <div className="form-group">
                          <label>Postal Code</label>
                          <input className="input" name="presentPostalCode" value={form.presentPostalCode} onChange={onChange} />
                        </div>
                        <div className="form-group">
                          <label>Country</label>
                          <input className="input" name="presentCountry" value={form.presentCountry} onChange={onChange} />
                        </div>
                      </div>
                    </div>
                   
                    {/* Permanent Address */}
                    <div className="address-block">
                      <h4>Permanent Address</h4>
                      <div className="checkbox-group">
                    <input
                          type="checkbox"
                          id="sameAsPresent"
                          checked={sameAsPresent}
                          onChange={handleSameAsPresentChange}
                        />
                        <label htmlFor="sameAsPresent">Same as Present Address</label>
                  </div>
                      <div className="form-grid">
                  <div className="form-group">
                          <label>Address Line 1</label>
                          <input className="input" name="permanentAddressLine1" value={form.permanentAddressLine1} onChange={onChange} />
                  </div>
                  <div className="form-group">
                          <label>Address Line 2</label>
                          <input className="input" name="permanentAddressLine2" value={form.permanentAddressLine2} onChange={onChange} />
                  </div>
                  <div className="form-group">
                          <label>City</label>
                          <input className="input" name="permanentCity" value={form.permanentCity} onChange={onChange} />
                  </div>
                  <div className="form-group">
                          <label>State</label>
                          <input className="input" name="permanentState" value={form.permanentState} onChange={onChange} />
                  </div>
                  <div className="form-group">
                          <label>Postal Code</label>
                          <input className="input" name="permanentPostalCode" value={form.permanentPostalCode} onChange={onChange} />
                  </div>
                  <div className="form-group">
                          <label>Country</label>
                          <input className="input" name="permanentCountry" value={form.permanentCountry} onChange={onChange} />
                  </div>
                  </div>
                </div>
                </div>
               
                {/* Identity Info Card */}

                <div className="form-section-card identity-info">
                  <h2 className="section-title">Identity Info</h2>
                  <div className="form-grid">
                    <div className="form-group">
                      <label>Aadhaar Number</label>
                      <input className="input" name="aadhaarNumber" value={form.aadhaarNumber} onChange={onChange} />
                    </div>
                    <div className="form-group">
                      <label>PAN Number</label>
                      <input className="input" name="panNumber" value={form.panNumber} onChange={onChange} />
                    </div>
                    <div className="form-group">
                      <label>UAN Number</label>
                      <input className="input" name="uanNo" value={form.uanNo} onChange={onChange} />
                    </div>
                    <div className="form-group">
                      <label>PF Number</label>
                      <input className="input" name="pfNo" value={form.pfNo} onChange={onChange} />
                    </div>
                    <div className="form-group">
                      <label>ESIC Number</label>
                      <input className="input" name="esicNo" value={form.esicNo} onChange={onChange} />
                    </div>
                    <div className="form-group">
                      <label>PF Status</label>
                      <select className="input" name="pfStatus" value={form.pfStatus} onChange={onChange}>
                        <option value="">-Select-</option>
                        <option value="Yes">Yes</option>
                        <option value="No">No</option>
                      </select>
                    </div>
                    <div className="form-group">
                      <label>ESI Status</label>
                      <select className="input" name="esiStatus" value={form.esiStatus} onChange={onChange}>
                        <option value="">-Select-</option>
                        <option value="Yes">Yes</option>
                        <option value="No">No</option>
                      </select>
                    </div>
                    <div className="form-group">
                      <label>Driving License Number</label>
                      <input className="input" name="drivingLicenseNumber" value={form.drivingLicenseNumber} onChange={onChange} />
                    </div>
                    <div className="form-group">
                      <label>Driving License Expiry Date</label>
                      <input className="input" type="date" name="drivingLicenseExpiryDate" value={form.drivingLicenseExpiryDate} onChange={onChange} />
                    </div>
                  </div>
                </div>
               
                {/* Bank Details Card */}
                <div className="form-section-card bank-details">
                  <h2 className="section-title">Bank Details</h2>
                  <div className="form-grid">
                    <div className="form-group">
                      <label>Bank Holder Name</label>
                      <input className="input" name="bankHolderName" value={form.bankHolderName} onChange={onChange} />
                    </div>
                    <div className="form-group">
                      <label>Bank Name</label>
                      <input className="input" name="bankName" value={form.bankName} onChange={onChange} />
                    </div>
                    <div className="form-group">
                      <label>Account Number</label>
                      <input className="input" name="accountNumber" value={form.accountNumber} onChange={onChange} />
                    </div>
                    <div className="form-group">
                      <label>IFSC Code</label>
                      <input className="input" name="ifscCode" value={form.ifscCode} onChange={onChange} />
                    </div>
                    <div className="form-group">
                      <label>Bank Branch</label>
                      <input className="input" name="bankBranch" value={form.bankBranch} onChange={onChange} />
                    </div>
                  </div>
                </div>
               
                {/* Education Details Card */}
                <div className="form-section-card education-details">
                  <h2 className="section-title">Education Details</h2>
                  {form.educationDetails && form.educationDetails.length > 0 && form.educationDetails.map((edu, idx) => (
                    <div className="form-grid" key={idx} style={{ border: '1px solid #e0e0e0', borderRadius: 8, marginBottom: 16, padding: 16, position: 'relative' }}>
                      <div className="form-group">
                        <label>Qualification</label>
                        <input className="input" name={`qualification-${idx}`} value={edu.qualification} onChange={e => handleEducationChange(idx, 'qualification', e.target.value)} />
                      </div>
                      <div className="form-group">
                        <label>Institution Name</label>
                        <input className="input" name={`institutionName-${idx}`} value={edu.institutionName} onChange={e => handleEducationChange(idx, 'institutionName', e.target.value)} />
                      </div>
                      <div className="form-group">
                        <label>Field of Study</label>
                        <input className="input" name={`fieldOfStudy-${idx}`} value={edu.fieldOfStudy} onChange={e => handleEducationChange(idx, 'fieldOfStudy', e.target.value)} />
                      </div>
                      <div className="form-group">
                        <label>Year of Completion</label>
                        <input className="input" name={`yearOfCompletion-${idx}`} value={edu.yearOfCompletion} onChange={e => handleEducationChange(idx, 'yearOfCompletion', e.target.value)} />
                      </div>
                      <div className="form-group">
                        <label>Percentage/Marks</label>
                        <input className="input" name={`percentageMarks-${idx}`} value={edu.percentageMarks} onChange={e => handleEducationChange(idx, 'percentageMarks', e.target.value)} />
                      </div>
                      {form.educationDetails.length > 1 && (
                        <button type="button" className="btn btn-danger" style={{ position: 'absolute', top: 8, right: 8 }} onClick={() => handleRemoveEducation(idx)}>
                          Remove
                        </button>
                      )}
                    </div>
                  ))}
                  <button type="button" className="btn btn-secondary" onClick={handleAddEducation} style={{ marginTop: 8 }}>
                    + Add Qualification
                  </button>
                </div>
               
                {/* Salary Info Card */}
                <div className="form-section-card salary-info">
                  <h2 className="section-title">Salary Info</h2>
                  <div className="form-grid">
                      <div className="form-group">
                        <label>Actual Basic</label>
                        <input className="input input-no-spinner" type="number" name="actualBasic" value={form.actualBasic} onChange={onChange} placeholder="0.00" step="0.01" onFocus={() => { actualBasicRef.current = form.actualBasic; }} onBlur={() => { if (form.actualBasic !== actualBasicRef.current) setForm(prev => ({ ...prev, revisedActualBasic: actualBasicRef.current })); }} />
                      </div>
                      <div className="form-group">
                        <label>Actual HRA</label>
                        <input className="input input-no-spinner" type="number" name="actualHRA" value={form.actualHRA} onChange={onChange} placeholder="0.00" step="0.01" onFocus={() => { actualHRARef.current = form.actualHRA; }} onBlur={() => { if (form.actualHRA !== actualHRARef.current) setForm(prev => ({ ...prev, revisedActualHRA: actualHRARef.current })); }} />
                      </div>
                      <div className="form-group">
                        <label>Actual DA</label>
                        <input className="input input-no-spinner" type="number" name="actualDA" value={form.actualDA} onChange={onChange} placeholder="0.00" step="0.01" onFocus={() => actualDARef.current = form.actualDA} onBlur={() => { if (form.actualDA !== actualDARef.current) setForm(prev => ({ ...prev, revisedActualDA: actualDARef.current })); }} />
                      </div>
                      <div className="form-group">
                        <label>Actual Special Allowance</label>
                        <input className="input input-no-spinner" type="number" name="actualSpecialAllowance" value={form.actualSpecialAllowance} onChange={onChange} placeholder="0.00" step="0.01" />
                      </div>
                      <div className="form-group">
                        <label>Actual Total Salary (Basic + HRA + DA + Special Allowance)</label>
                        <input className="input input-no-spinner" type="number" name="totalSalary" value={form.totalSalary} readOnly style={{ backgroundColor: '#f5f5f5', cursor: 'not-allowed' }} placeholder="0.00" step="0.01" tabIndex={-1} aria-readonly="true" />
                      </div>
                      <div className="form-group">
                        <label>Attendance Allowance</label>
                        <input className="input" name="attendanceAllowance" value={form.attendanceAllowance} onChange={onChange} />
                      </div>
                      <div className="form-group">
                        <label>Other Allowance</label>
                        <input className="input" name="otherAllowance" value={form.otherAllowance} onChange={onChange} onFocus={() => otherAllowanceRef.current = form.otherAllowance} onBlur={() => { if (form.otherAllowance !== otherAllowanceRef.current) setForm(prev => ({ ...prev, revisedOtherAllowance: otherAllowanceRef.current })); }} />
                      </div>
                      <div className="form-group">
                        <label>TravelChargers</label>
                        <input className="input" name="travelChargers" value={form.travelChargers} onChange={onChange} />
                      </div>
                      <div className="form-group">
                        <label>Food Allowance</label>
                        <input className="input" name="foodAllowance" value={form.foodAllowance} onChange={onChange} />
                      </div>
                      <div className="form-group">
                        <label>Uniform Allowance</label>
                        <input className="input" name="uniformAllowance" value={form.uniformAllowance} onChange={onChange} />
                      </div>
                      <div className="form-group">
                        <label>Unit</label>
                        <input className="input" name="relevantExperience" value={form.relevantExperience} onChange={onChange} />
                      </div>
                      <div className="form-group">
                        <label>Source of Hire</label>
                        <input className="input" name="sourceOfHire" value={form.sourceOfHire} onChange={onChange} />
                      </div>
                  </div>
                </div>

                {/* Salary Revised Details Card */}
                {showSalaryRevisedDetails && (
                  <div className="form-section-card salary-revised-info">
                    <h2 className="section-title">Salary Revised Details</h2>
                    <div className="form-grid">
                        <div className="form-group">
                          <label>Revised Actual Basic</label>
                          <input className="input" name="revisedActualBasic" value={form.revisedActualBasic} readOnly style={{ backgroundColor: '#f5f5f5', cursor: 'not-allowed' }} />
                        </div>
                        <div className="form-group">
                          <label>Revised Actual HRA</label>
                          <input className="input" name="revisedActualHRA" value={form.revisedActualHRA} readOnly style={{ backgroundColor: '#f5f5f5', cursor: 'not-allowed' }} />
                        </div>
                        <div className="form-group">
                          <label>Revised Actual DA</label>
                          <input className="input" name="revisedActualDA" value={form.revisedActualDA} readOnly style={{ backgroundColor: '#f5f5f5', cursor: 'not-allowed' }} />
                        </div>
                        <div className="form-group">
                          <label>Revised Other Allowance</label>
                          <input className="input" name="revisedOtherAllowance" value={form.revisedOtherAllowance} readOnly style={{ backgroundColor: '#f5f5f5', cursor: 'not-allowed' }} />
                        </div>
                        <div className="form-group">
                          <label>Month Data</label>
                          <input className="input" type="month" name="monthData" value={form.monthData} onChange={onChange} placeholder="YYYY-MM" />
                        </div>
                        <div className="form-group">
                          <label>Date Data</label>
                          <input className="input" type="date" name="dateData" value={form.dateData} onChange={onChange} />
                        </div>
                        <div className="form-group">
                          <label>Revised Total Salary (Auto-calculated)</label>
                          <input className="input input-no-spinner" type="number" name="revisedTotalSalary" value={form.revisedTotalSalary} readOnly style={{ backgroundColor: '#f5f5f5', cursor: 'not-allowed' }} placeholder="0.00" step="0.01" />
                        </div>
                    </div>
                  </div>
                )}

                {/* Additional Info Card */}
                <div className="form-section-card">
                  <div className="form-grid">
                  <div className="form-group">
                        <label>Overall Experience</label>
                        <input className="input" name="overallExperience" value={form.overallExperience} onChange={onChange} />
                  </div>
                </div>
                </div>
               
                  {/* Additional Info Card */}
                  <div className="form-section-card additional-info">
                    <h2 className="section-title">Additional Info</h2>
                  <div className="form-grid">
                      <div className="form-group">
                        <label>Location</label>
                        <input className="input" name="location" value={form.location} onChange={onChange} />
                      </div>
                      <div className="form-group">
                        <label>Grade Level</label>
                        <input className="input" name="gradeLevel" value={form.gradeLevel} onChange={onChange} />
                      </div>
                      <div className="form-group">
                        <label>Reporting To</label>
                        <input className="input" name="reportingTo" value={form.reportingTo} onChange={onChange} />
                      </div>
                      {/* Removed HR Partner and National Head fields as requested */}
                      <div className="form-group">
                        <label>Category</label>
                        <input className="input" name="category" value={form.category} onChange={onChange} />
                      </div>
                  <div className="form-group">
                    <label>Employee Status</label>
                    <select className="input" name="employeeStatus" value={form.employeeStatus} onChange={onChange}>
                      <option value="">-Select-</option>
                      <option value="Active">Active</option>
                          <option value="Inactive">Inactive</option>
                      <option value="Resigned">Resigned</option>
                      <option value="Terminated">Terminated</option>
                          <option value="Absconding">Absconding</option>
                          <option value="Deceased">Deceased</option>
                    </select>
                  </div>
                  {(() => {
                    const statusesWithExitDate = ['inactive', 'resigned', 'terminated', 'absconding', 'deceased'];
                    const showDateOfExit = (form.employeeStatus && statusesWithExitDate.includes(form.employeeStatus.toLowerCase().trim())) || form.dateOfExit;
                    return showDateOfExit ? (
                      <div className="form-group">
                        <label>Date of Exit</label>
                        <input className="input" type="date" name="dateOfExit" value={form.dateOfExit} onChange={onChange} />
                      </div>
                    ) : null;
                  })()}
                </div>
                </div>
               
                {/* Employee Files */}
                {console.log('Rendering EmployeeFilesSection with form:', form)}
                <EmployeeFilesSection
                  employeeId={isEditing ? editingEmployeeId : null}
                  employee={form}
                  pendingFiles={form._pendingFiles || {}}
                  setPendingFiles={pendingFiles => setForm(f => ({ ...f, _pendingFiles: pendingFiles }))}
                  uploadErrors={form._uploadErrors || {}}
                  setUploadErrors={uploadErrors => setForm(f => ({ ...f, _uploadErrors: uploadErrors }))}
                  uploading={submitting}
                  isNewEmployee={!isEditing}
                />
                <div className="form-actions">
                  <button type="submit" className="btn btn-primary" disabled={submitting} onClick={saveEmployee}>
                    {isEditing ? 'Update Employee' : 'Submit'}
                    {submitting && <span className="btn-primary__loader ml-5"></span>}
                  </button>
                  <button type="button" className="btn btn-danger" onClick={toggleForm}>
                    Cancel
                  </button>
                  {/* Show Close Form button when employee is successfully created */}
                  {!isEditing && Object.keys(form).some(key => key.endsWith('FileId') && form[key]) && (
                    <button
                      type="button"
                      className="btn btn-success"
                      onClick={() => {
                        setShowForm(false);
                        setIsEditing(false);
                        setEditingEmployeeId(null);
                        fetchEmployees();
                      }}
                      style={{ marginLeft: '10px' }}
                    >
                      Close Form
                    </button>
                  )}
                </div>
                {formError && <div className="error-message">{formError}</div>}
                  </div>
              </div>
            </div>
          </div>
        )}

          {/* Table Container - Only show when form is closed */}
          {!showForm && (
            <>
              <div className="employee-table-container" style={{ marginTop: 32 }}>
                {(fetchState === 'loading' || importing) ? (
                  <div className="dF aI-center jC-center h-inh">
                    <div className="loader-lg"></div>
                  </div>
                ) : fetchState === 'error' ? (
                  <div className="error-message">{fetchError}</div>
                ) : (
                  <table className="employee-table" style={{ background: '#fff', boxShadow: '0 2px 4px rgba(0,0,0,0.06)' }}>
                    <colgroup>
                      <col style={{ width: '60px' }} />
                      <col style={{ width: '50px' }} />
                      <col style={{ minWidth: '160px', width: '160px' }} />
                      <col style={{ minWidth: '120px', width: '120px' }} />
                    </colgroup>
                    <thead style={{ background: '#f5f5f5' }}>
                      <tr>
                        {dynamicColumns.map((column, index) => {
                          const isEmployeeStatus = column.label === 'Employee Status';
                          const isPhotoFile = column.label === 'Photo File';
                          const headerStyle = {
                            color: '#232323',
                            fontWeight: 700,
                            fontSize: '1rem',
                            borderBottom: '2px solid #e3e8ee',
                            background: '#f5f5f5',
                            ...(isEmployeeStatus && { paddingRight: '56px', minWidth: '160px', boxSizing: 'border-box' }),
                            ...(isPhotoFile && { paddingLeft: '56px', minWidth: '120px', boxSizing: 'border-box' })
                          };
                          return (
                            <th key={index} className={isEmployeeStatus ? 'col-employee-status' : isPhotoFile ? 'col-photo-file' : undefined} style={headerStyle}>
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
                      {filteredEmployees.length ? (
                        filteredEmployees.map((employee, index) => (
                          <EmployeeRow
                            key={employee.id}
                            employee={employee}
                            index={index}
                            removeEmployee={removeEmployee}
                            editEmployee={editEmployee}
                            isSelected={selectedEmployees.some((id) => String(id) === String(employee.id))}
                            onSelect={handleSelectEmployee}
                          />
                        ))
                      ) : (
                        <tr>
                          <td colSpan={dynamicColumns.length} className="text-center">
                            No employees found. Adjust your search or add a new employee.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Pagination Controls */}
              {(() => {
                const emailsWithoutPagination = [
                  'afrindinusha29@gmail.com',
                  'sriramenterprises50@yahoo.com',
                  'afrinatlin@gmail.com',
                  'samuelenterprisesms@gmail.com',
                  'ssindus@gmail.com',
                  'kyrarebagame@gmail.com'
                ];
                const isAdminOrAppUser = userRole === 'App Administrator' || userRole === 'App User';
                const isGmailUser = userEmail && (userEmail || '').toLowerCase().includes('@gmail.com');
                const isInPaginationList = userEmail && emailsWithoutPagination.includes((userEmail || '').toLowerCase());
                const isNoPaginationUser = isAdminOrAppUser || isGmailUser || isInPaginationList;
               
                return (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '24px 0' }}>
                    {!isNoPaginationUser && (
                      <>
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
                      </>
                    )}
                    <span style={{ marginLeft: isNoPaginationUser ? 0 : 20, fontSize: 14, color: '#555' }}>
                      {isNoPaginationUser ? `Showing all ${employees.length} employees` : `Showing ${employees.length} of ${totalEmployees || '?'} employees`}
                    </span>
                  </div>
                );
              })()}
                      </>
                    )}
                  </div>
        </main>
       
      </div>
    </div>
  </>
  );
}

// Refactored EmployeeFilesSection with improved UI and deferred upload logic
function EmployeeFilesSection({ employeeId, employee, pendingFiles, setPendingFiles, uploadErrors, setUploadErrors, uploading, isNewEmployee }) {
  // Document types and their display names and accepted types
  const docTypes = [
    { key: 'Photo', fieldKey: 'photo', label: 'Photo', accept: '.jpg,.jpeg,.png', hint: 'JPG/PNG, max 5MB' },
    { key: 'AadharCopy', fieldKey: 'aadharCopy', label: 'Aadhaar file', accept: '.pdf,.jpg,.jpeg,.png', hint: 'PDF/JPG/PNG, max 5MB' },
    { key: 'EducationalCertificates', fieldKey: 'educationalCertificates', label: 'Educational Certificates', accept: '.pdf', hint: 'PDF, max 5MB' },
    { key: 'BankPassbook', fieldKey: 'bankPassbook', label: 'Bank Passbook', accept: '.pdf,.jpg,.jpeg,.png', hint: 'PDF/JPG/PNG, max 5MB' },
    { key: 'ExperienceCertificate', fieldKey: 'experienceCertificate', label: 'Experience Certificate', accept: '.pdf,.doc,.docx', hint: 'PDF/DOC/DOCX, max 5MB' },
    { key: 'PANCard', fieldKey: 'pANCard', label: 'PAN Card', accept: '.pdf,.jpg,.jpeg,.png', hint: 'PDF/JPG/PNG, max 5MB' },
    { key: 'Resume', fieldKey: 'resume', label: 'Resume', accept: '.pdf,.doc,.docx', hint: 'PDF/DOC/DOCX, max 5MB' },
  ];

  // Remove a pending file
  const removePendingFile = (key) => {
    setPendingFiles({ ...pendingFiles, [key]: undefined });
    setUploadErrors({ ...uploadErrors, [key]: undefined });
  };

  // Select a new file
  const handleFileSelect = (key, file) => {
    console.log('File selected:', { key, file, fileName: file.name, fileSize: file.size, fileType: file.type });
    console.log('Current pending files before update:', pendingFiles);
    const newPendingFiles = { ...pendingFiles, [key]: file };
    console.log('New pending files after update:', newPendingFiles);
    setPendingFiles(newPendingFiles);
    setUploadErrors({ ...uploadErrors, [key]: undefined });
  };

  // Reliable blob-based download (mirrors table downloader behavior)
  const downloadEmployeeFile = async (docKey, fileName, event) => {
    if (!employeeId) {
      console.warn('Download requested without employeeId');
      return;
    }
    const originalText = event?.target?.textContent;
    try {
      const downloadUrl = `/server/cms_function/employees/${employeeId}/file/${docKey}`;

      if (event?.target) {
        event.target.textContent = 'Downloading...';
        event.target.style.pointerEvents = 'none';
      }

      const axiosOk = await downloadBlobWithAxios(downloadUrl, fileName);
      if (!axiosOk) {
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = fileName || 'download';
        link.target = '_blank';
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        setTimeout(() => {
          if (document.body.contains(link)) document.body.removeChild(link);
        }, 100);
      }
    } catch (error) {
      console.error('Download error:', error);
      alert(`Download failed: ${error.message}`);
    } finally {
      if (event?.target) {
        event.target.textContent = originalText;
        event.target.style.pointerEvents = 'auto';
      }
    }
  };

  return (
    <table className="employee-files-table" style={{ width: '100%', marginTop: 10 }}>
      <thead>
        <tr>
          <th style={{ textAlign: 'left' }}>Document</th>
          <th style={{ textAlign: 'left' }}>File</th>
          <th>Action</th>
        </tr>
      </thead>
      <tbody>
        {docTypes.map(({ key, fieldKey, label, accept, hint }) => {
          // Check form state directly for file information
          // Normalize the key to match the form structure (e.g., 'Photo' -> 'photo')
          const normalizedKey = key.charAt(0).toLowerCase() + key.slice(1);
         
          // Get file info from form state using normalized key
          const fileId = employee[`${normalizedKey}FileId`];
          const fileName = employee[`${normalizedKey}FileName`];
          const pendingFile = pendingFiles?.[key];
          const error = uploadErrors?.[key];

          // Debug logging for file display
          if (key === 'Photo') {
            console.log(`File display debug for ${key}:`, {
              key,
              fieldKey,
              normalizedKey,
              fileId,
              fileName,
              pendingFile,
              error,
              employeeId,
              isNewEmployee,
              formStateKeys: Object.keys(employee).filter(key => key.includes('FileId') || key.includes('FileName'))
            });
          }

          // For Photo, display image preview if fileName exists and no pending file
          const isPhoto = key === 'Photo';
          const photoUrl = isPhoto && fileId && employeeId ? `/server/cms_function/employees/${employeeId}/file/${key}` : null;

          return (
            <tr key={key}>
              <td>
                <span title={hint}>{label}</span>
                <div style={{ fontSize: 11, color: '#888' }}>{hint}</div>
              </td>
              <td>
                {pendingFile ? (
                  <div className="dF aI-center">
                    <span style={{ marginRight: 8 }}>{pendingFile.name}</span>
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
                ) : (fileId && fileName) ? (
                  <div className="dF aI-center" style={{ alignItems: 'center' }}>
                    {isPhoto && photoUrl ? (
                      <img
                        src={photoUrl}
                        alt="Uploaded Photo"
                        style={{ width: 50, height: 50, objectFit: 'cover', marginRight: 8, borderRadius: '4px', border: '1px solid #ccc' }}
                      />
                    ) : null}
                    <span style={{ color: '#333', fontWeight: '500' }}>{fileName}</span>
                    <div style={{ fontSize: '11px', color: '#666', marginTop: '2px' }}>
                      {isNewEmployee ? 'File uploaded successfully!' : 'File available'}
                    </div>
                  </div>
                ) : (
                  <span style={{ color: '#aaa' }}>No file uploaded</span>
                )}
                {/* Debug info */}
                {key === 'Photo' && (
                  <div style={{ fontSize: '10px', color: '#999', marginTop: '4px' }}>
                    Debug: pendingFile={!!pendingFile}, fileId={!!fileId}, fileName={!!fileName},
                    fileIdValue={fileId}, fileNameValue={fileName}
                  </div>
                )}
                {error && <div style={{ color: 'red', fontSize: 12 }}>{error}</div>}
              </td>
              <td>
                {pendingFile ? null : fileId && fileName && employeeId ? (
                  <>
                    <button
                      type="button"
                      className="btn btn-icon"
                      title="Download"
                      onClick={(e) => downloadEmployeeFile(key, fileName, e)}
                      style={{ marginRight: 8 }}
                      disabled={uploading}
                    >
                      <i className="fas fa-download"></i>
                    </button>
                    <label className="btn btn-icon" title="Replace file" style={{ marginRight: 8 }}>
                      <i className="fas fa-exchange-alt"></i>
                      <input
                        type="file"
                        accept={isPhoto ? '.jpg,.jpeg,.png' : accept}
                        style={{ display: 'none' }}
                        disabled={uploading}
                        onChange={e => {
                          console.log('File input change event for key:', key, 'files:', e.target.files, 'event:', e);
                          if (e.target.files && e.target.files[0]) {
                            console.log('File selected in input for key:', key, 'file:', e.target.files[0]);
                            handleFileSelect(key, e.target.files[0]);
                            e.target.value = '';
                          } else {
                            console.log('No file selected for key:', key);
                          }
                        }}
                        onClick={e => {
                          console.log('File input clicked for key:', key);
                        }}
                        onFocus={e => {
                          console.log('File input focused for key:', key);
                        }}
                      />
                    </label>
                  </>
                ) : (
                                      <label className="btn btn-icon" title="Upload file">
                      <i className="fas fa-cloud-upload-alt"></i>
                      <input
                        type="file"
                        accept={isPhoto ? '.jpg,.jpeg,.png' : accept}
                        style={{ display: 'none' }}
                        disabled={uploading}
                        onChange={e => {
                          console.log('File input change event for new upload key:', key, 'files:', e.target.files, 'event:', e);
                          if (e.target.files && e.target.files[0]) {
                            console.log('File selected in input for new upload key:', key, 'file:', e.target.files[0]);
                            handleFileSelect(key, e.target.files[0]);
                            e.target.value = '';
                          } else {
                            console.log('No file selected for new upload key:', key);
                          }
                        }}
                        onClick={e => {
                          console.log('File input clicked for new upload key:', key);
                        }}
                        onFocus={e => {
                          console.log('File input focused for new upload key:', key);
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
  );
}

export default EmployeeManagement;
