import './App.css';
import './helper.css';
import './StatutoryRegisters.css';
import axios from 'axios';
import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import { Link, useLocation } from 'react-router-dom';
import cmsLogo from './assets/cms new logo fixed.png';
import HeaderBranding from './HeaderBranding';
import { getSidebarModulesForUser, resolveSidebarUserEmail } from './modulesConfig';
import sspowerLogo from './assets/SSPowerLogo.png';
import Button from './Button';
import {
  Users, Calendar, FileText, AlertTriangle, FolderOpen,
  ClipboardList, Building, Handshake, Landmark, Clock,
  Map, BarChart3, User, TrendingUp, TrendingDown,
  Activity, Plus, CheckCircle, Bell, Settings, LayoutDashboard, Home as HomeIcon,
  Shield, AlertOctagon, CreditCard, Search, FileSignature, Clock3, CalendarDays, Database,
  FileInput, FileOutput, Filter, RefreshCw, Trash2
} from 'lucide-react';

// Add a helper function at the top (after imports):
function formatDate(dateStr) {
  if (!dateStr) return '-';
  return String(dateStr).slice(0, 10);
}

// Helper function to get file status message
function getFileStatusMessage(fileId, fileName, isEditing) {
  if (!fileId) return null;
 
  if (fileName) {
    return `File: ${fileName}`;
  } else if (isEditing) {
    return `File: ${fileId}`;
  } else {
    return 'File uploaded successfully';
  }
}

// Helper function to get user-friendly file names
function getFileDisplayName(docType) {
  const displayNames = {
    'CopyofLicensefortheyear': 'Copy of License',
    'CompletionStatus': 'Completion Status',
    'BankStatement': 'Bank Statement',
    'FormCBonusRegisterFileUpload': 'Form C Bonus Register',
    'ProofDocument': 'Proof Document',
    'FormDBonusRegister': 'Form D Bonus Register',
    'CopyofESIElectronicChallancumReturn': 'ESI Electronic Challan',
    'AdvancesDeductionsforDamagesLossFines': 'Advances Deductions',
    'EPFContributionRemittanceChallanFileUpload': 'EPF Contribution Challan',
    'ESIContributionRemittanceChallanFileUpload': 'ESI Contribution Challan',
    'WageslipFileUpload': 'Wageslip',
    'RegisterofwagesFileUpload': 'Register of Wages',
    'HalfyearlyreturnsFileUpload': 'Half Yearly Returns',
    'RegisterOfEmployeement': 'Register of Employment',
    'remittanceofLabourWelfareFundFileUpload': 'Labour Welfare Fund',
    'remittanceofProfessionTaxFileUpload': 'Profession Tax File',
    'EPFElectronicChallanFileUpload': 'EPF Electronic Challan'
  };
  return displayNames[docType] || docType;
}

// Helper function to get fallback filename for file display
function getFallbackFileName(docType) {
  const fallbackNames = {
    'CopyofLicensefortheyear': 'Copy of License',
    'CompletionStatus': 'Completion Status',
    'BankStatement': 'Bank Statement',
    'FormCBonusRegister': 'Form C Bonus Register',
    'ProofDocument': 'Proof Document',
    'FormDBonusRegister': 'Form D Bonus Register',
    'CopyofESIElectronicChallancumReturn': 'ESI Electronic Challan',
    'AdvancesDeductionsforDamagesLossFines': 'Advances Deductions',
    'EPFContributionRemittanceChallan': 'EPF Contribution Challan',
    'ESIContributionRemittanceChallan': 'ESI Contribution Challan',
    'Wageslip': 'Wageslip',
    'Registerofwages': 'Register of Wages',
    'Halfyearlyreturns': 'Half Yearly Returns',
    'RegisterOfEmployeement': 'Register of Employment',
    'remittanceofLabourWelfareFund': 'Labour Welfare Fund',
    'remittanceofProfessionTaxFile': 'Profession Tax File',
    'EPFElectronicChallan': 'EPF Electronic Challan'
  };
  return fallbackNames[docType] || docType;
}

// Helper function to get display filename (actual filename or fallback)
function getDisplayFileName(actualFileName, docType) {
  // If we have the actual filename, use it
  if (actualFileName && actualFileName.trim() !== '') {
    return actualFileName;
  }
  // Otherwise, use fallback
  return getFallbackFileName(docType);
}

// Helper function to check if a record has filename stored
function hasFileNameStored(actualFileName) {
  return actualFileName && actualFileName.trim() !== '';
}

// Helper function to get the correct register ID
function getRegisterId(register) {
  const registerId = register.ROWID || register.id || register.ID || register.ROW_ID || register._id;
  if (!registerId) {
    console.error('No valid ID found in register object:', register);
  }
  return registerId;
}

// StatutoryFileUploadSection Component
function StatutoryFileUploadSection({
  docType,
  label,
  registerId,
  register,
  pendingFile,
  setPendingFile,
  uploadError,
  setUploadError,
  uploading,
  isEditing,
  form,
  setForm,
  onFileUpload
}) {
  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (file) {
      setPendingFile(file);
      setUploadError(null);
      onFileUpload(e, docType);
    }
  };

  const removePendingFile = () => {
    setPendingFile(null);
    setUploadError(null);
  };

  // Get file columns for this docType
  const getFileColumns = (docType) => {
    const fileColumns = {
      'CopyofLicensefortheyear': ['CopyofLicensefortheyearFileId', 'CopyofLicensefortheyearFileName'],
      'CompletionStatus': ['CompletionStatusFileId', 'CompletionStatusFileName'],
      'BankStatement': ['BankStatementFileId', 'BankStatementFileName'],
      'FormCBonusRegisterFileUpload': ['FormCBonusRegisterFileId', 'FormCBonusRegisterFileName'],
      'ProofDocument': ['ProofDocumentFileId', 'ProofDocumentFileName'],
      'FormDBonusRegister': ['FormDBonusRegisterFileId', 'FormDBonusRegisterFileName'],
      'CopyofESIElectronicChallancumReturn': ['CopyofESIElectronicChallancumReturnFileId', 'CopyofESIElectronicChallancumReturnFileName'],
      'AdvancesDeductionsforDamagesLossFines': ['AdvancesDeductionsforDamagesLossFinesFileId', 'AdvancesDeductionsforDamagesLossFinesFileName'],
      'EPFContributionRemittanceChallanFileUpload': ['EPFContributionRemittanceChallanFileId', 'EPFContributionRemittanceChallanFileName'],
      'ESIContributionRemittanceChallanFileUpload': ['ESIContributionRemittanceChallanFileId', 'ESIContributionRemittanceChallanFileName'],
      'WageslipFileUpload': ['WageslipFileId', 'WageslipFileName'],
      'RegisterofwagesFileUpload': ['RegisterofwagesFileId', 'RegisterofwagesFileName'],
      'HalfyearlyreturnsFileUpload': ['HalfyearlyreturnsFileId', 'HalfyearlyreturnsFileName'],
      'RegisterOfEmployeement': ['RegisterOfEmployeement', 'RegisterOfEmployeementFileName'],
      'remittanceofLabourWelfareFundFileUpload': ['remittanceofLabourWelfareFundFileId', 'remittanceofLabourWelfareFundFileName'],
      'remittanceofProfessionTaxFileUpload': ['remittanceofProfessionTaxFileFileId', 'remittanceofProfessionTaxFileFileName'],
      'EPFElectronicChallanFileUpload': ['EPFElectronicChallanFileId', 'EPFElectronicChallanFileName']
    };
    return fileColumns[docType] || [];
  };

  const fileColumns = getFileColumns(docType);
  const fileIdField = fileColumns[0];
  const fileNameField = fileColumns[1];
 
  // Get current file info from form
  const currentFileId = form[fileIdField];
  const currentFileName = form[fileNameField];
 
  console.log(`=== FILE UPLOAD SECTION DEBUG (${docType}) ===`);
  console.log('File columns:', fileColumns);
  console.log('File ID field:', fileIdField);
  console.log('File name field:', fileNameField);
  console.log('Current file ID:', currentFileId);
  console.log('Current file name:', currentFileName);
  console.log('Form data:', form);

  return (
    <div className="form-group">
      <label>{label}</label>
      <div className="statutory-file-section">
        {pendingFile ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div className="statutory-file-icon">
              <i className="fas fa-file"></i>
            </div>
            <div className="statutory-file-info">
              <div className="statutory-file-name">{pendingFile.name}</div>
              <div className="statutory-file-size">
                {(pendingFile.size / 1024).toFixed(1)} KB
              </div>
            </div>
            <div className="statutory-file-actions">
              <button
                type="button"
                className="statutory-file-remove-btn"
                onClick={removePendingFile}
                disabled={uploading}
                title="Remove file"
              >
                <i className="fas fa-times"></i>
              </button>
            </div>
          </div>
        ) : currentFileId ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div className="statutory-file-icon">
              <i className="fas fa-file"></i>
            </div>
            <div className="statutory-file-info">
              <div className="statutory-file-name">
                {currentFileName || getDisplayFileName(currentFileName, docType)}
              </div>
              <div className="statutory-file-size" style={{ color: '#28a745', fontSize: '12px' }}>
                ✓ File uploaded
              </div>
            </div>
            <div className="statutory-file-actions">
              <button
                type="button"
                className="statutory-file-remove-btn"
                onClick={() => {
                  // Clear the file from form
                  setForm(prev => ({
                    ...prev,
                    [fileIdField]: '',
                    [fileNameField]: ''
                  }));
                }}
                disabled={uploading}
                title="Remove file"
              >
                <i className="fas fa-times"></i>
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div className="statutory-file-placeholder">
              <i className="fas fa-cloud-upload-alt"></i>
            </div>
            <div className="statutory-file-info">
              <input
                type="file"
                accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                onChange={handleFileSelect}
                className="input"
                disabled={uploading}
                style={{ display: 'none' }}
                id={`file-${docType}`}
              />
              <label
                htmlFor={`file-${docType}`}
                style={{
                  cursor: uploading ? 'not-allowed' : 'pointer',
                  color: uploading ? '#999' : '#1976d2',
                  textDecoration: 'underline'
                }}
              >
                {uploading ? 'Uploading...' : 'Choose file to upload'}
              </label>
            </div>
          </div>
        )}
       
        {uploadError && (
          <div className="statutory-file-error">
            {uploadError}
          </div>
        )}
      </div>
    </div>
  );
}


// Statutory Register Row Component
function StatutoryRegisterRow({ register, index, removeRegister, editRegister, isSelected, onSelect, selectedRegisters, onRegisterClick, onExport }) {
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  // Function to download file
  const downloadFile = useCallback(async (registerId, docType, fileName, event) => {
    const originalText = event?.target?.textContent;
   
    try {
      const downloadUrl = `/server/StatutoryRegisters_function/registers/${registerId}/file/${docType}`;
      console.log('=== DOWNLOAD DEBUG START ===');
      console.log('Downloading file:', { downloadUrl, fileName, registerId, docType });
      console.log('Full download URL:', downloadUrl);
     
      if (event?.target) {
        event.target.textContent = 'Downloading...';
        event.target.style.pointerEvents = 'none';
      }
     
      try {
        console.log('Making fetch request to:', downloadUrl);
        const response = await fetch(downloadUrl, {
          method: 'GET',
          headers: {
            'Accept': '*/*',
            'Cache-Control': 'no-cache'
          }
        });
       
        console.log('Fetch response received:', {
          status: response.status,
          statusText: response.statusText,
          ok: response.ok,
          headers: Object.fromEntries(response.headers.entries())
        });
       
        if (!response.ok) {
          let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
          try {
            const errorData = await response.json();
            console.error('Error response data:', errorData);
            errorMessage = errorData.message || errorData.error || errorMessage;
          } catch (jsonError) {
            try {
              const errorText = await response.text();
              console.error('Error response text:', errorText);
              errorMessage = errorText || errorMessage;
            } catch (textError) {
              console.error('Could not parse error response:', textError);
            }
          }
          throw new Error(errorMessage);
        }
       
        console.log('Response is OK, creating blob...');
        const blob = await response.blob();
        console.log('Blob created:', {
          size: blob.size,
          type: blob.type,
          fileName: fileName
        });
       
        if (blob.size === 0) {
          throw new Error('Downloaded file is empty (0 bytes)');
        }
       
        // Check if the response is actually a file or an error message
        if (blob.type === 'application/json') {
          const text = await blob.text();
          const errorData = JSON.parse(text);
          throw new Error(errorData.message || 'Server returned error response');
        }
       
        console.log('Creating download link...');
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName || `${docType}_file`;
        link.style.display = 'none';
       
        document.body.appendChild(link);
        link.click();
       
        // Clean up after a short delay
        setTimeout(() => {
          if (document.body.contains(link)) {
            document.body.removeChild(link);
          }
          window.URL.revokeObjectURL(url);
        }, 100);
       
        console.log('Download completed successfully for:', fileName);
       
      } catch (fetchError) {
        console.error('Fetch/download error:', fetchError);
       
        // Try direct link as fallback
        console.log('Trying direct link fallback...');
        try {
          const link = document.createElement('a');
          link.href = downloadUrl;
          link.download = fileName || `${docType}_file`;
          link.target = '_blank';
          link.style.display = 'none';
         
          document.body.appendChild(link);
          link.click();
         
          setTimeout(() => {
            if (document.body.contains(link)) {
              document.body.removeChild(link);
            }
          }, 100);
         
          console.log('Direct link download initiated for:', fileName);
        } catch (directLinkError) {
          console.error('Direct link also failed:', directLinkError);
          throw fetchError; // Re-throw the original error
        }
      }
     
      if (event?.target) {
        event.target.textContent = originalText;
        event.target.style.pointerEvents = 'auto';
      }
     
    } catch (error) {
      console.error('=== DOWNLOAD ERROR ===');
      console.error('Download error:', error);
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
      console.error('Request details:', { registerId, docType, fileName });
      console.error('=== DOWNLOAD ERROR END ===');
     
      alert(`Download failed: ${error.message}\n\nPlease check the console for more details.`);
     
      if (event?.target) {
        event.target.textContent = originalText;
        event.target.style.pointerEvents = 'auto';
      }
    }
    console.log('=== DOWNLOAD DEBUG END ===');
  }, []);

  const downloadLinkStyle = {
    cursor: 'pointer',
    color: '#1976d2',
    textDecoration: 'underline',
    fontWeight: 500,
    transition: 'color 0.2s ease',
    userSelect: 'none',
    display: 'inline-block',
    padding: '2px 4px',
    borderRadius: '3px',
    backgroundColor: 'rgba(25, 118, 210, 0.1)',
    position: 'relative',
    zIndex: 10,
    pointerEvents: 'auto'
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

  const deleteRegister = useCallback((e) => {
    e.stopPropagation();
   
    // Show confirmation popup
    if (!window.confirm(`Are you sure you want to delete this statutory register? This action cannot be undone.`)) {
      return;
    }
   
    const registerId = getRegisterId(register);
    console.log('=== DELETE REGISTER DEBUG START ===');
    console.log('Deleting register with ID:', registerId);
    console.log('Full register object:', register);
   
    setDeleting(true);
    setDeleteError('');
   
    axios
      .delete(`/server/StatutoryRegisters_function/registers/${registerId}`, {
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json'
        }
      })
      .then((response) => {
        console.log('Delete response:', response);
        console.log('Delete successful, removing from UI...');
        console.log('Register ID to remove:', registerId);
        console.log('Register object being removed:', register);
        removeRegister(registerId);
        console.log('Register removed from UI successfully');
       
        // Data is already updated through removeRegister function
        console.log('Register deleted successfully');
      })
      .catch((err) => {
        console.error('=== DELETE REGISTER ERROR ===');
        console.error('Delete request failed:', err);
        console.error('Error response:', err.response);
        console.error('Error status:', err.response?.status);
        console.error('Error data:', err.response?.data);
        console.error('Error message:', err.message);
       
        const errorMessage = err.response?.data?.message || `Failed to delete register (ID: ${registerId}). Server responded with status ${err.response?.status || 'unknown'}.`;
        setDeleteError(errorMessage);
       
        // Show error to user
        alert(`Delete failed: ${errorMessage}`);
      })
      .finally(() => {
        setDeleting(false);
        console.log('=== DELETE REGISTER DEBUG END ===');
      });
  }, [getRegisterId(register), removeRegister, register]);

  const handleRowClick = useCallback(() => {
    onRegisterClick(register);
  }, [onRegisterClick, register]);

  const handleCheckboxChange = useCallback((e) => {
    e.stopPropagation();
    const registerId = getRegisterId(register);
    console.log('Checkbox changed for register:', register);
    console.log('Register ID:', registerId);
    console.log('Checkbox checked state:', e.target.checked);
    onSelect(registerId);
  }, [onSelect, register]);

  const handleEditButtonClick = useCallback((e) => {
    e.stopPropagation();
    editRegister(register);
  }, [editRegister, register]);

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
      <td onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={isSelected}
          onChange={handleCheckboxChange}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Select register ${register.Contractor || index + 1}`}
        />
      </td>
      {selectedRegisters.length > 0 && (
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
      {selectedRegisters.length > 0 && (
        <td onClick={(e) => e.stopPropagation()}>
          {isSelected && (
            <button
              className="btn btn-icon"
              onClick={(e) => {
                e.stopPropagation();
                const registerId = getRegisterId(register);
                onExport(registerId);
              }}
              title="Export this register"
              style={{
                background: 'transparent',
                border: 'none',
                color: '#1976d2',
                cursor: 'pointer',
                padding: '4px 8px',
                fontSize: '10px'
              }}
            >
              <i className="fas fa-file-pdf"></i>
            </button>
          )}
        </td>
      )}
      <td
        style={{ paddingRight: '20px' }}
      >
        {index + 1}
      </td>
      <td
        onClick={handleRowClick}
        style={{ cursor: 'pointer' }}
      >
        {register.Contractor || '-'}
      </td>
      <td
        onClick={handleRowClick}
        style={{ cursor: 'pointer' }}
      >
        {register.Year || '-'}
      </td>
      <td
        onClick={handleRowClick}
        style={{ cursor: 'pointer' }}
      >
        {register.Month_fliter || '-'}
      </td>
      <td
        onClick={handleRowClick}
        style={{ cursor: 'pointer' }}
      >
        {register.ApprovalStatus || '-'}
      </td>
      <td
        onClick={handleRowClick}
        style={{ cursor: 'pointer' }}
      >
        {register.LicenceNumber || '-'}
      </td>
      <td
        onClick={handleRowClick}
        style={{ cursor: 'pointer' }}
      >
        {register.RegisterofEmploymentNumberofpersons || '-'}
      </td>
      <td
        onClick={handleRowClick}
        style={{ cursor: 'pointer' }}
      >
        {register.WagesSlipNumberofpersons || '-'}
      </td>
      <td
        onClick={handleRowClick}
        style={{ cursor: 'pointer' }}
      >
        {register.ESIContributionRemittanceChallanNumber || '-'}
      </td>
      <td
        onClick={handleRowClick}
        style={{ cursor: 'pointer' }}
      >
        {formatDate(register.ESIRemittanceDate)}
      </td>
      <td
        onClick={handleRowClick}
        style={{ cursor: 'pointer' }}
      >
        {register.ESIIPNumberofpersonsengaged || '-'}
      </td>
      <td
        onClick={handleRowClick}
        style={{ cursor: 'pointer' }}
      >
        {register.EPFContributionRemittanceChallanNumber || '-'}
      </td>
      <td
        onClick={handleRowClick}
        style={{ cursor: 'pointer' }}
      >
        {formatDate(register.EPFRemittanceDate)}
      </td>
      <td
        onClick={handleRowClick}
        style={{ cursor: 'pointer' }}
      >
        {register.EPFUANofpersonsengaged || '-'}
      </td>
      <td
        onClick={handleRowClick}
        style={{ cursor: 'pointer' }}
      >
        {register.PolicyNumber || '-'}
      </td>
      <td
        onClick={handleRowClick}
        style={{ cursor: 'pointer' }}
      >
        {register.ProofofremittanceofProfessionTaxAmount || '-'}
      </td>
      <td
        onClick={handleRowClick}
        style={{ cursor: 'pointer' }}
      >
        {register.ProofofremittanceofLabourWelfareFundAmount || '-'}
      </td>
      <td
        onClick={handleRowClick}
        style={{ cursor: 'pointer' }}
      >
        {formatDate(register.DateofPayment)}
      </td>
      <td
        onClick={handleRowClick}
        style={{ cursor: 'pointer' }}
      >
        {formatDate(register.FromDate)}
      </td>
      <td
        onClick={handleRowClick}
        style={{ cursor: 'pointer' }}
      >
        {formatDate(register.ToDate)}
      </td>
      <td
        onClick={handleRowClick}
        style={{ cursor: 'pointer' }}
      >
        {formatDate(register.PolicyFromDate)}
      </td>
      <td
        onClick={handleRowClick}
        style={{ cursor: 'pointer' }}
      >
        {formatDate(register.PolicyToDate)}
      </td>
      <td
        onClick={handleRowClick}
        style={{ cursor: 'pointer' }}
      >
        {formatDate(register.HalfYearlyReturnsSubmissionDate)}
      </td>
      <td
        onClick={handleRowClick}
        style={{ cursor: 'pointer' }}
      >
        {formatDate(register.ProofofremittanceofProfessionTaxPaymentDate)}
      </td>
      <td
        onClick={handleRowClick}
        style={{ cursor: 'pointer' }}
      >
        {register.ProofofremittanceofLabourWelfareFundReceiptNumber || '-'}
      </td>
      <td
        onClick={handleRowClick}
        style={{ cursor: 'pointer' }}
      >
        {formatDate(register.FormDBonusRegisterSubmissionDate)}
      </td>
      {/* File columns */}
      <td>
        {register.CopyofLicensefortheyearFileId ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span
              style={downloadLinkStyle}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (e.stopImmediatePropagation) {
                  e.stopImmediatePropagation();
                }
                console.log('=== FILENAME CLICKED ===');
                console.log('Full register object:', register);
                console.log('Register ID (register.id):', register.id);
                console.log('Register ROWID (register.ROWID):', register.ROWID);
                console.log('Register ID (register.ID):', register.ID);
                console.log('File ID:', register.CopyofLicensefortheyearFileId);
                console.log('File Name:', register.CopyofLicensefortheyearFileName);
                console.log('Display Name:', getDisplayFileName(register.CopyofLicensefortheyearFileName, 'CopyofLicensefortheyear'));
               
                // Get the correct register ID
                const registerId = getRegisterId(register);
                console.log('Using register ID:', registerId);
               
                if (!registerId) {
                  console.error('No valid ID found in register object!');
                  alert('Error: No valid register ID found');
                  return;
                }
               
                // Test different URL patterns
                const testUrl1 = `/server/StatutoryRegisters_function/registers/${registerId}/file/CopyofLicensefortheyear`;
                const testUrl2 = `/server/Statutory_function/registers/${registerId}/file/CopyofLicensefortheyear`;
                const testUrl3 = `/server/StatutoryRegisters_function/download/${registerId}/CopyofLicensefortheyear`;
                const testUrl4 = `/server/StatutoryRegisters_function/registers/${registerId}/download/CopyofLicensefortheyear`;
               
                console.log('Test URL 1 (StatutoryRegisters_function/file):', testUrl1);
                console.log('Test URL 2 (Statutory_function/file):', testUrl2);
                console.log('Test URL 3 (StatutoryRegisters_function/download):', testUrl3);
                console.log('Test URL 4 (StatutoryRegisters_function/registers/download):', testUrl4);
                console.log('Opening all URLs in new tabs for testing...');
               
                // Open all test URLs
                window.open(testUrl1, '_blank');
                setTimeout(() => window.open(testUrl2, '_blank'), 500);
                setTimeout(() => window.open(testUrl3, '_blank'), 1000);
                setTimeout(() => window.open(testUrl4, '_blank'), 1500);
               
                downloadFile(registerId, 'CopyofLicensefortheyear', getDisplayFileName(register.CopyofLicensefortheyearFileName, 'CopyofLicensefortheyear'), e);
              }}
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onMouseEnter={(e) => handleLinkHover(e, true)}
              onMouseLeave={(e) => handleLinkHover(e, false)}
              title="Click to download file"
            >
              {getDisplayFileName(register.CopyofLicensefortheyearFileName, 'CopyofLicensefortheyear')}
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
                downloadFile(getRegisterId(register), 'CopyofLicensefortheyear', getDisplayFileName(register.CopyofLicensefortheyearFileName, 'CopyofLicensefortheyear'), e);
              }}
              title="Download file"
            ></i>
          </div>
        ) : (
          <span style={{ color: '#aaa' }}>No file</span>
        )}
        {/* Debug info */}
        <div style={{ fontSize: '10px', color: '#666', marginTop: '2px' }}>
          ID: {register.CopyofLicensefortheyearFileId || 'none'} |
          Name: {register.CopyofLicensefortheyearFileName || 'No filename stored'} |
          Display: {getDisplayFileName(register.CopyofLicensefortheyearFileName, 'CopyofLicensefortheyear')} |
          {hasFileNameStored(register.CopyofLicensefortheyearFileName) ? '✅ Has filename' : '⚠️ Old record - no filename stored'}
        </div>
      </td>
      <td>
        {register.CompletionStatusFileId ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span
              style={downloadLinkStyle}
              onClick={(e) => {
                e.stopPropagation();
                downloadFile(getRegisterId(register), 'CompletionStatus', getDisplayFileName(register.CompletionStatusFileName, 'CompletionStatus'), e);
              }}
              onMouseEnter={(e) => handleLinkHover(e, true)}
              onMouseLeave={(e) => handleLinkHover(e, false)}
              title="Click to download file"
            >
              {getDisplayFileName(register.CompletionStatusFileName, 'CompletionStatus')}
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
                downloadFile(getRegisterId(register), 'CompletionStatus', getDisplayFileName(register.CompletionStatusFileName, 'CompletionStatus'), e);
              }}
              title="Download file"
            ></i>
          </div>
        ) : (
          <span style={{ color: '#aaa' }}>No file</span>
        )}
        {/* Debug info */}
        <div style={{ fontSize: '10px', color: '#666', marginTop: '2px' }}>
          ID: {register.CompletionStatusFileId || 'none'} | Name: {register.CompletionStatusFileName || 'No filename stored'}
        </div>
      </td>
      <td>
        {register.BankStatementFileId ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span
              style={downloadLinkStyle}
              onClick={(e) => {
                e.stopPropagation();
                downloadFile(getRegisterId(register), 'BankStatement', getDisplayFileName(register.BankStatementFileName, 'BankStatement'), e);
              }}
              onMouseEnter={(e) => handleLinkHover(e, true)}
              onMouseLeave={(e) => handleLinkHover(e, false)}
              title="Click to download file"
            >
              {getDisplayFileName(register.BankStatementFileName, 'BankStatement')}
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
                downloadFile(getRegisterId(register), 'BankStatement', getDisplayFileName(register.BankStatementFileName, 'BankStatement'), e);
              }}
              title="Download file"
            ></i>
          </div>
        ) : (
          <span style={{ color: '#aaa' }}>No file</span>
        )}
        {/* Debug info */}
        <div style={{ fontSize: '10px', color: '#666', marginTop: '2px' }}>
          ID: {register.BankStatementFileId || 'none'} | Name: {register.BankStatementFileName || 'No filename stored'}
        </div>
      </td>
      <td>
        {register.FormCBonusRegisterFileId ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span
              style={downloadLinkStyle}
              onClick={(e) => {
                e.stopPropagation();
                downloadFile(getRegisterId(register), 'FormCBonusRegisterFileUpload', register.FormCBonusRegisterFileName, e);
              }}
              onMouseEnter={(e) => handleLinkHover(e, true)}
              onMouseLeave={(e) => handleLinkHover(e, false)}
              title="Click to download file"
            >
              {register.FormCBonusRegisterFileName}
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
                downloadFile(getRegisterId(register), 'FormCBonusRegisterFileUpload', register.FormCBonusRegisterFileName, e);
              }}
              title="Download file"
            ></i>
          </div>
        ) : (
          <span style={{ color: '#aaa' }}>No file</span>
        )}
        {/* Debug info */}
        <div style={{ fontSize: '10px', color: '#666', marginTop: '2px' }}>
          ID: {register.FormCBonusRegisterFileId || 'none'} | Name: {register.FormCBonusRegisterFileName || 'none'}
        </div>
      </td>
      <td>
        {register.ProofDocumentFileId ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span
              style={downloadLinkStyle}
              onClick={(e) => {
                e.stopPropagation();
                downloadFile(getRegisterId(register), 'ProofDocument', register.ProofDocumentFileName, e);
              }}
              onMouseEnter={(e) => handleLinkHover(e, true)}
              onMouseLeave={(e) => handleLinkHover(e, false)}
              title="Click to download file"
            >
              {register.ProofDocumentFileName}
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
                downloadFile(getRegisterId(register), 'ProofDocument', register.ProofDocumentFileName, e);
              }}
              title="Download file"
            ></i>
          </div>
        ) : (
          <span style={{ color: '#aaa' }}>No file</span>
        )}
        {/* Debug info */}
        <div style={{ fontSize: '10px', color: '#666', marginTop: '2px' }}>
          ID: {register.ProofDocumentFileId || 'none'} | Name: {register.ProofDocumentFileName || 'none'}
        </div>
      </td>
      <td>
        {register.FormDBonusRegisterFileId ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span
              style={downloadLinkStyle}
              onClick={(e) => {
                e.stopPropagation();
                downloadFile(getRegisterId(register), 'FormDBonusRegister', register.FormDBonusRegisterFileName, e);
              }}
              onMouseEnter={(e) => handleLinkHover(e, true)}
              onMouseLeave={(e) => handleLinkHover(e, false)}
              title="Click to download file"
            >
              {register.FormDBonusRegisterFileName}
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
                downloadFile(getRegisterId(register), 'FormDBonusRegister', register.FormDBonusRegisterFileName, e);
              }}
              title="Download file"
            ></i>
          </div>
        ) : (
          <span style={{ color: '#aaa' }}>No file</span>
        )}
        {/* Debug info */}
        <div style={{ fontSize: '10px', color: '#666', marginTop: '2px' }}>
          ID: {register.FormDBonusRegisterFileId || 'none'} | Name: {register.FormDBonusRegisterFileName || 'none'}
        </div>
      </td>
      <td>
        {register.CopyofESIElectronicChallancumReturnFileId ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span
              style={downloadLinkStyle}
              onClick={(e) => {
                e.stopPropagation();
                downloadFile(getRegisterId(register), 'CopyofESIElectronicChallancumReturn', register.CopyofESIElectronicChallancumReturnFileName, e);
              }}
              onMouseEnter={(e) => handleLinkHover(e, true)}
              onMouseLeave={(e) => handleLinkHover(e, false)}
              title="Click to download file"
            >
              {register.CopyofESIElectronicChallancumReturnFileName}
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
                downloadFile(getRegisterId(register), 'CopyofESIElectronicChallancumReturn', register.CopyofESIElectronicChallancumReturnFileName, e);
              }}
              title="Download file"
            ></i>
          </div>
        ) : (
          <span style={{ color: '#aaa' }}>No file</span>
        )}
        {/* Debug info */}
        <div style={{ fontSize: '10px', color: '#666', marginTop: '2px' }}>
          ID: {register.CopyofESIElectronicChallancumReturnFileId || 'none'} | Name: {register.CopyofESIElectronicChallancumReturnFileName || 'none'}
        </div>
      </td>
      <td>
        {register.AdvancesDeductionsforDamagesLossFinesFileId ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span
              style={downloadLinkStyle}
              onClick={(e) => {
                e.stopPropagation();
                downloadFile(getRegisterId(register), 'AdvancesDeductionsforDamagesLossFines', register.AdvancesDeductionsforDamagesLossFinesFileName, e);
              }}
              onMouseEnter={(e) => handleLinkHover(e, true)}
              onMouseLeave={(e) => handleLinkHover(e, false)}
              title="Click to download file"
            >
              {register.AdvancesDeductionsforDamagesLossFinesFileName}
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
                downloadFile(getRegisterId(register), 'AdvancesDeductionsforDamagesLossFines', register.AdvancesDeductionsforDamagesLossFinesFileName, e);
              }}
              title="Download file"
            ></i>
          </div>
        ) : (
          <span style={{ color: '#aaa' }}>No file</span>
        )}
        {/* Debug info */}
        <div style={{ fontSize: '10px', color: '#666', marginTop: '2px' }}>
          ID: {register.AdvancesDeductionsforDamagesLossFinesFileId || 'none'} | Name: {register.AdvancesDeductionsforDamagesLossFinesFileName || 'none'}
        </div>
      </td>
      <td>
        {register.EPFContributionRemittanceChallanFileId ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span
              style={downloadLinkStyle}
              onClick={(e) => {
                e.stopPropagation();
                downloadFile(getRegisterId(register), 'EPFContributionRemittanceChallanFileUpload', register.EPFContributionRemittanceChallanFileName, e);
              }}
              onMouseEnter={(e) => handleLinkHover(e, true)}
              onMouseLeave={(e) => handleLinkHover(e, false)}
              title="Click to download file"
            >
              {register.EPFContributionRemittanceChallanFileName}
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
                downloadFile(getRegisterId(register), 'EPFContributionRemittanceChallanFileUpload', register.EPFContributionRemittanceChallanFileName, e);
              }}
              title="Download file"
            ></i>
          </div>
        ) : (
          <span style={{ color: '#aaa' }}>No file</span>
        )}
        {/* Debug info */}
        <div style={{ fontSize: '10px', color: '#666', marginTop: '2px' }}>
          ID: {register.EPFContributionRemittanceChallanFileId || 'none'} | Name: {register.EPFContributionRemittanceChallanFileName || 'none'}
        </div>
      </td>
      <td>
        {register.ESIContributionRemittanceChallanFileId ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span
              style={downloadLinkStyle}
              onClick={(e) => {
                e.stopPropagation();
                downloadFile(getRegisterId(register), 'ESIContributionRemittanceChallanFileUpload', register.ESIContributionRemittanceChallanFileName, e);
              }}
              onMouseEnter={(e) => handleLinkHover(e, true)}
              onMouseLeave={(e) => handleLinkHover(e, false)}
              title="Click to download file"
            >
              {register.ESIContributionRemittanceChallanFileName}
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
                downloadFile(getRegisterId(register), 'ESIContributionRemittanceChallanFileUpload', register.ESIContributionRemittanceChallanFileName, e);
              }}
              title="Download file"
            ></i>
          </div>
        ) : (
          <span style={{ color: '#aaa' }}>No file</span>
        )}
        {/* Debug info */}
        <div style={{ fontSize: '10px', color: '#666', marginTop: '2px' }}>
          ID: {register.ESIContributionRemittanceChallanFileId || 'none'} | Name: {register.ESIContributionRemittanceChallanFileName || 'none'}
        </div>
      </td>
      <td>
        {register.WageslipFileId ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span
              style={downloadLinkStyle}
              onClick={(e) => {
                e.stopPropagation();
                downloadFile(getRegisterId(register), 'WageslipFileUpload', register.WageslipFileName, e);
              }}
              onMouseEnter={(e) => handleLinkHover(e, true)}
              onMouseLeave={(e) => handleLinkHover(e, false)}
              title="Click to download file"
            >
              {register.WageslipFileName}
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
                downloadFile(getRegisterId(register), 'WageslipFileUpload', register.WageslipFileName, e);
              }}
              title="Download file"
            ></i>
          </div>
        ) : (
          <span style={{ color: '#aaa' }}>No file</span>
        )}
        {/* Debug info */}
        <div style={{ fontSize: '10px', color: '#666', marginTop: '2px' }}>
          ID: {register.WageslipFileId || 'none'} | Name: {register.WageslipFileName || 'none'}
        </div>
      </td>
      <td>
        {register.RegisterofwagesFileId ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span
              style={downloadLinkStyle}
              onClick={(e) => {
                e.stopPropagation();
                downloadFile(getRegisterId(register), 'RegisterofwagesFileUpload', register.RegisterofwagesFileName, e);
              }}
              onMouseEnter={(e) => handleLinkHover(e, true)}
              onMouseLeave={(e) => handleLinkHover(e, false)}
              title="Click to download file"
            >
              {register.RegisterofwagesFileName}
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
                downloadFile(getRegisterId(register), 'RegisterofwagesFileUpload', register.RegisterofwagesFileName, e);
              }}
              title="Download file"
            ></i>
          </div>
        ) : (
          <span style={{ color: '#aaa' }}>No file</span>
        )}
        {/* Debug info */}
        <div style={{ fontSize: '10px', color: '#666', marginTop: '2px' }}>
          ID: {register.RegisterofwagesFileId || 'none'} | Name: {register.RegisterofwagesFileName || 'none'}
        </div>
      </td>
      <td>
        {register.HalfyearlyreturnsFileId ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span
              style={downloadLinkStyle}
              onClick={(e) => {
                e.stopPropagation();
                downloadFile(getRegisterId(register), 'HalfyearlyreturnsFileUpload', register.HalfyearlyreturnsFileName, e);
              }}
              onMouseEnter={(e) => handleLinkHover(e, true)}
              onMouseLeave={(e) => handleLinkHover(e, false)}
              title="Click to download file"
            >
              {register.HalfyearlyreturnsFileName}
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
                downloadFile(getRegisterId(register), 'HalfyearlyreturnsFileUpload', register.HalfyearlyreturnsFileName, e);
              }}
              title="Download file"
            ></i>
          </div>
        ) : (
          <span style={{ color: '#aaa' }}>No file</span>
        )}
        {/* Debug info */}
        <div style={{ fontSize: '10px', color: '#666', marginTop: '2px' }}>
          ID: {register.HalfyearlyreturnsFileId || 'none'} | Name: {register.HalfyearlyreturnsFileName || 'none'}
        </div>
      </td>
      <td>
        {register.RegisterOfEmployeement ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span
              style={downloadLinkStyle}
              onClick={(e) => {
                e.stopPropagation();
                downloadFile(getRegisterId(register), 'RegisterOfEmployeement', 'Register of Employment', e);
              }}
              onMouseEnter={(e) => handleLinkHover(e, true)}
              onMouseLeave={(e) => handleLinkHover(e, false)}
              title="Click to download file"
            >
              {register.RegisterOfEmployeementFileName}
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
                downloadFile(getRegisterId(register), 'RegisterOfEmployeement', 'Register of Employment', e);
              }}
              title="Download file"
            ></i>
          </div>
        ) : (
          <span style={{ color: '#aaa' }}>No file</span>
        )}
        {/* Debug info */}
        <div style={{ fontSize: '10px', color: '#666', marginTop: '2px' }}>
          ID: {register.RegisterOfEmployeement || 'none'}
        </div>
      </td>
      <td>
        {register.remittanceofLabourWelfareFundFileId ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span
              style={downloadLinkStyle}
              onClick={(e) => {
                e.stopPropagation();
                downloadFile(getRegisterId(register), 'remittanceofLabourWelfareFundFileUpload', register.remittanceofLabourWelfareFundFileName, e);
              }}
              onMouseEnter={(e) => handleLinkHover(e, true)}
              onMouseLeave={(e) => handleLinkHover(e, false)}
              title="Click to download file"
            >
              {register.remittanceofLabourWelfareFundFileName}
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
                downloadFile(getRegisterId(register), 'remittanceofLabourWelfareFundFileUpload', register.remittanceofLabourWelfareFundFileName, e);
              }}
              title="Download file"
            ></i>
          </div>
        ) : (
          <span style={{ color: '#aaa' }}>No file</span>
        )}
        {/* Debug info */}
        <div style={{ fontSize: '10px', color: '#666', marginTop: '2px' }}>
          ID: {register.remittanceofLabourWelfareFundFileId || 'none'} | Name: {register.remittanceofLabourWelfareFundFileName || 'none'}
        </div>
      </td>
      <td>
        {register.EPFElectronicChallanFileId ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span
              style={downloadLinkStyle}
              onClick={(e) => {
                e.stopPropagation();
                downloadFile(getRegisterId(register), 'EPFElectronicChallanFileUpload', register.EPFElectronicChallanFileName, e);
              }}
              onMouseEnter={(e) => handleLinkHover(e, true)}
              onMouseLeave={(e) => handleLinkHover(e, false)}
              title="Click to download file"
            >
              {register.EPFElectronicChallanFileName}
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
                downloadFile(getRegisterId(register), 'EPFElectronicChallanFileUpload', register.EPFElectronicChallanFileName, e);
              }}
              title="Download file"
            ></i>
          </div>
        ) : (
          <span style={{ color: '#aaa' }}>No file</span>
        )}
        {/* Debug info */}
        <div style={{ fontSize: '10px', color: '#666', marginTop: '2px' }}>
          ID: {register.EPFElectronicChallanFileId || 'none'} | Name: {register.EPFElectronicChallanFileName || 'none'}
        </div>
      </td>
    </tr>
  );
}

// Main StatutoryRegisters Component
function StatutoryRegisters({ userRole = 'App Administrator', userEmail = null }) {
  const [registers, setRegisters] = useState([]);
  const [filteredRegisters, setFilteredRegisters] = useState([]);
  const [fetchState, setFetchState] = useState('init');
  const [fetchError, setFetchError] = useState('');
  const [selectedRegisters, setSelectedRegisters] = useState([]);
 
  // Sidebar state management
  const [expandedMenus, setExpandedMenus] = useState({});
  const [showNotifications, setShowNotifications] = useState(false);
  const [showSidebarMenu, setShowSidebarMenu] = useState(false);
  const location = useLocation();
  const forcedContractor = useMemo(() => {
    const map = {
      'afrindinusha@gmail.com': 'R.P.D Facility Management Services',
      'afrindinusha29@gmail.com': 'Sriram enterprises', // DB spelling
      'afrinatlin@gmail.com': 'Samuel Enterprise',
      'afrindinu14@gmail.com': 'Yashaswi Academy for Skills',
      'vaishnavi.a@buildhr.co.in': 'Yashaswi Academy for Skills',
    };
    return map[(userEmail || '').toLowerCase()] || null;
  }, [userEmail]);

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

  // User info
  const userAvatar = "https://images.pexels.com/photos/2379004/pexels-photo-2379004.jpeg?auto=compress&cs=tinysrgb&w=150";
  const userName = userRole === 'App Administrator' ? 'Admin User' : 'App User';

  // Sample activity data with Lucide icons
  const recentActivities = [
    { icon: <User size={20} />, title: 'New Employee Added', description: 'John Doe joined the development team', time: '2 hours ago' },
    { icon: <BarChart3 size={20} />, title: 'Monthly Report Generated', description: 'Contractor performance report is ready', time: '4 hours ago' },
    { icon: <CheckCircle size={20} />, title: 'Contract Approved', description: 'ABC Construction contract approved', time: '6 hours ago' },
    { icon: <Bell size={20} />, title: 'System Update', description: 'Payroll Management System updated to version 2.1', time: '1 day ago' },
    { icon: <Plus size={20} />, title: 'New Application', description: 'Candidate applied for senior position', time: '2 days ago' }
  ];
  const [deletingMultiple, setDeletingMultiple] = useState(false);
  const [massDeleteError, setMassDeleteError] = useState('');
  const [selectedRegisterDetails, setSelectedRegisterDetails] = useState(null);
 
  // Calculate if all registers are selected
  const allSelected = filteredRegisters.length > 0 && selectedRegisters.length === filteredRegisters.length;
  const someSelected = selectedRegisters.length > 0 && selectedRegisters.length < filteredRegisters.length;
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importError, setImportError] = useState('');
  const [exportError, setExportError] = useState('');
  const fileInputRef = useRef(null);
  const [searchFields, setSearchFields] = useState({
    // Basic Information
    contractor: { enabled: false, value: '' },
    year: { enabled: false, value: '' },
    monthFilter: { enabled: false, value: '' },
    approvalStatus: { enabled: false, value: '' },
    licenceNumber: { enabled: false, value: '' },
    registerofEmploymentNumberofpersons: { enabled: false, value: '' },
    wagesSlipNumberofpersons: { enabled: false, value: '' },
    esiContributionRemittanceChallanNumber: { enabled: false, value: '' },
    esiRemittanceDate: { enabled: false, value: '' },
    esiIPNumberofpersonsengaged: { enabled: false, value: '' },
    epfContributionRemittanceChallanNumber: { enabled: false, value: '' },
    epfRemittanceDate: { enabled: false, value: '' },
    epfUANofpersonsengaged: { enabled: false, value: '' },
    policyNumber: { enabled: false, value: '' },
    proofofremittanceofProfessionTaxAmount: { enabled: false, value: '' },
    proofofremittanceofLabourWelfareFundAmount: { enabled: false, value: '' },
    dateofPayment: { enabled: false, value: '' },
    fromDate: { enabled: false, value: '' },
    toDate: { enabled: false, value: '' },
    policyFromDate: { enabled: false, value: '' },
    policyToDate: { enabled: false, value: '' },
    halfYearlyReturnsSubmissionDate: { enabled: false, value: '' },
    proofofremittanceofProfessionTaxPaymentDate: { enabled: false, value: '' },
    proofofremittanceofLabourWelfareFundReceiptNumber: { enabled: false, value: '' },
    proofofremittanceofLabourWelfareFundRegNumber: { enabled: false, value: '' },
    formDBonusRegisterSubmissionDate: { enabled: false, value: '' },
  });
  const dropdownRef = useRef(null);
  const contractorDropdownRef = useRef(null);

  // Contractor fetch functionality
  const [contractors, setContractors] = useState([]);
  const [showContractorDropdown, setShowContractorDropdown] = useState(false);
  const [contractorSearchTerm, setContractorSearchTerm] = useState('');
  const [fetchingContractors, setFetchingContractors] = useState(false);

  // Function to fetch contractors from contracters_function
  const fetchContractors = useCallback(async () => {
    // If contractor is forced, set only that contractor and skip API
    if (forcedContractor) {
      setContractors([{ ContractorName: forcedContractor }]);
      return;
    }
    try {
      setFetchingContractors(true);
      console.log('Fetching contractors from contracters_function...');
      const response = await axios.get('/server/contracters_function/contractors', {
        params: { page: 1, perPage: 100 },
        timeout: 10000
      });
     
      if (response?.data?.data?.contractors) {
        setContractors(response.data.data.contractors);
        console.log('Contractors fetched:', response.data.data.contractors.length);
      } else {
        console.error('Unexpected API response structure:', response.data);
        setContractors([]);
      }
    } catch (error) {
      console.error('Error fetching contractors:', error);
      setContractors([]);
    } finally {
      setFetchingContractors(false);
    }
  }, [forcedContractor]);

  // Handle contractor field click
  const handleContractorFieldClick = useCallback(() => {
    if (forcedContractor) {
      // No dropdown when forced
      return;
    }
    if (contractors.length === 0 && !fetchingContractors) {
      fetchContractors();
    }
    setShowContractorDropdown(true);
  }, [contractors.length, fetchingContractors, fetchContractors, forcedContractor]);

  // Handle contractor selection
  const handleContractorSelect = useCallback((contractor) => {
    setForm(prev => ({ ...prev, Contractor: contractor.ContractorName || contractor.EstablishmentName }));
    setShowContractorDropdown(false);
    setContractorSearchTerm('');
  }, []);

  // Filter contractors based on search term
  const filteredContractors = useMemo(() => {
    if (forcedContractor) return [{ ContractorName: forcedContractor }];
    if (!contractorSearchTerm) return contractors;
    return contractors.filter(contractor =>
      contractor.ContractorName?.toLowerCase().includes(contractorSearchTerm.toLowerCase()) ||
      contractor.EstablishmentName?.toLowerCase().includes(contractorSearchTerm.toLowerCase())
    );
  }, [contractors, contractorSearchTerm, forcedContractor]);

  // Define searchable fields for filtering
  const searchableFields = [
    // Basic Information
    { label: 'Contractor', field: 'contractor' },
    { label: 'Year', field: 'year' },
    { label: 'Month Filter', field: 'monthFilter' },
    { label: 'Approval Status', field: 'approvalStatus' },
    { label: 'Licence Number', field: 'licenceNumber' },
    { label: 'Register of Employment Number of Persons', field: 'registerofEmploymentNumberofpersons' },
    { label: 'Wages Slip Number of Persons', field: 'wagesSlipNumberofpersons' },
    { label: 'ESI Contribution Remittance Challan Number', field: 'esiContributionRemittanceChallanNumber' },
    { label: 'ESI Remittance Date', field: 'esiRemittanceDate' },
    { label: 'ESI IP Number of Persons Engaged', field: 'esiIPNumberofpersonsengaged' },
    { label: 'EPF Contribution Remittance Challan Number', field: 'epfContributionRemittanceChallanNumber' },
    { label: 'EPF Remittance Date', field: 'epfRemittanceDate' },
    { label: 'EPF UAN Number of Persons Engaged', field: 'epfUANofpersonsengaged' },
    { label: 'Policy Number', field: 'policyNumber' },
    { label: 'Proof of Remittance of Profession Tax Amount', field: 'proofofremittanceofProfessionTaxAmount' },
    { label: 'Proof of Remittance of Labour Welfare Fund Amount', field: 'proofofremittanceofLabourWelfareFundAmount' },
    { label: 'Date of Payment', field: 'dateofPayment' },
    { label: 'From Date', field: 'fromDate' },
    { label: 'To Date', field: 'toDate' },
    { label: 'Policy From Date', field: 'policyFromDate' },
    { label: 'Policy To Date', field: 'policyToDate' },
    { label: 'Half Yearly Returns Submission Date', field: 'halfYearlyReturnsSubmissionDate' },
    { label: 'Proof of Remittance of Profession Tax Payment Date', field: 'proofofremittanceofProfessionTaxPaymentDate' },
    { label: 'Proof of Remittance of Labour Welfare Fund Receipt Number', field: 'proofofremittanceofLabourWelfareFundReceiptNumber' },
    { label: 'Proof of Remittance of Labour Welfare Fund Registration Number', field: 'proofofremittanceofLabourWelfareFundRegNumber' },
    { label: 'Form D Bonus Register Submission Date', field: 'formDBonusRegisterSubmissionDate' },
  ];

  // Define filtering modes - removed complex modes, only using text search
  const filterModes = [];

  // Apply search filter based on selected fields and modes
  const filteredData = useMemo(() => {
    const hasActiveFilters = Object.values(searchFields).some(
      field => field.enabled
    );

    if (!hasActiveFilters) {
      return registers;
    }

    return registers.filter((register) => {
      if (!register || typeof register !== 'object') return false;
      return searchableFields.every(({ field }) => {
        const { enabled, value } = searchFields[field];
        if (!enabled) return true;

        const registerValue = register[field] != null ? String(register[field]).toLowerCase() : '';
        const lowerSearchValue = value.toLowerCase();

        // Simple text-based search - only search if value is provided
        if (value.trim() === '') {
          return true;
        }
       
        return registerValue.includes(lowerSearchValue);
      });
    });
  }, [registers, searchFields]);

  useEffect(() => {
    setFilteredRegisters(filteredData);
  }, [filteredData]);

  // Pagination state
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(50);
  const [totalPages, setTotalPages] = useState(1);
  const [totalRegisters, setTotalRegisters] = useState(0);
  const [showAll, setShowAll] = useState(false);

  const [form, setForm] = useState({
    LicenceNumber: '',
    RegisterofEmploymentNumberofpersons: '',
    WagesSlipNumberofpersons: '',
    ESIContributionRemittanceChallanNumber: '',
    ESIRemittanceDate: '',
    ESIIPNumberofpersonsengaged: '',
    EPFContributionRemittanceChallanNumber: '',
    EPFRemittanceDate: '',
    EPFUANofpersonsengaged: '',
    PolicyNumber: '',
    ProofofremittanceofProfessionTaxAmount: '',
    ProofofremittanceofLabourWelfareFundAmount: '',
    DateofPayment: '',
    Month_fliter: '',
    Year: '',
  Contractor: forcedContractor || '',
    ApprovalStatus: '',
    FromDate: '',
    ToDate: '',
    PolicyFromDate: '',
    PolicyToDate: '',
    HalfYearlyReturnsSubmissionDate: '',
    ProofofremittanceofProfessionTaxPaymentDate: '',
    ProofofremittanceofLabourWelfareFundReceiptNumber: '',
    ProofofremittanceofLabourWelfareFundRegNumber: '',
    FormDBonusRegisterSubmissionDate: '',
    // File fields - both FileId and FileName for proper display
    CopyofLicensefortheyearFileId: '',
    CopyofLicensefortheyearFileName: '',
    CompletionStatusFileId: '',
    CompletionStatusFileName: '',
    BankStatementFileId: '',
    BankStatementFileName: '',
    FormCBonusRegisterFileId: '',
    FormCBonusRegisterFileName: '',
    ProofDocumentFileId: '',
    ProofDocumentFileName: '',
    FormDBonusRegisterFileId: '',
    FormDBonusRegisterFileName: '',
    CopyofESIElectronicChallancumReturnFileId: '',
    CopyofESIElectronicChallancumReturnFileName: '',
    AdvancesDeductionsforDamagesLossFinesFileId: '',
    AdvancesDeductionsforDamagesLossFinesFileName: '',
    EPFContributionRemittanceChallanFileId: '',
    EPFContributionRemittanceChallanFileName: '',
    ESIContributionRemittanceChallanFileId: '',
    ESIContributionRemittanceChallanFileName: '',
    WageslipFileId: '',
    WageslipFileName: '',
    RegisterofwagesFileId: '',
    RegisterofwagesFileName: '',
    HalfyearlyreturnsFileId: '',
    HalfyearlyreturnsFileName: '',
    RegisterOfEmployeement: '',
    RegisterOfEmployeementFileName: '',
    remittanceofLabourWelfareFundFileId: '',
    remittanceofLabourWelfareFundFileName: '',
    remittanceofProfessionTaxFileFileId: '',
    remittanceofProfessionTaxFileFileName: '',
    EPFElectronicChallanFileId: '',
    EPFElectronicChallanFileName: '',
  });
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editingRegisterId, setEditingRegisterId] = useState(null);
 
  // File upload states for each document type
  const [pendingFiles, setPendingFiles] = useState({});
  const [uploadErrors, setUploadErrors] = useState({});
  const [uploading, setUploading] = useState({});

  // Helper functions for file upload state management
  const setPendingFile = useCallback((docType, file) => {
    setPendingFiles(prev => ({ ...prev, [docType]: file }));
  }, []);

  const setUploadError = useCallback((docType, error) => {
    setUploadErrors(prev => ({ ...prev, [docType]: error }));
  }, []);

  const setUploadingState = useCallback((docType, state) => {
    setUploading(prev => ({ ...prev, [docType]: state }));
  }, []);

  const clearFileState = useCallback((docType) => {
    setPendingFiles(prev => {
      const newState = { ...prev };
      delete newState[docType];
      return newState;
    });
    setUploadErrors(prev => {
      const newState = { ...prev };
      delete newState[docType];
      return newState;
    });
    setUploading(prev => {
      const newState = { ...prev };
      delete newState[docType];
      return newState;
    });
  }, []);

  // Fetch registers with pagination
  const fetchRegisters = useCallback(() => {
    setFetchState('loading');
    setFetchError('');
   
    const params = showAll ? {} : { page, perPage };
   
    if (userRole && userEmail) {
      params.userRole = userRole;
      params.userEmail = userEmail;
      console.log('Filtering registers for:', { userRole, userEmail });
    }
   
    axios
      .get('/server/StatutoryRegisters_function/registers', { params, timeout: 5000 })
      .then((response) => {
        if (!response?.data?.data?.registers) {
          throw new Error('Unexpected API response structure');
        }
        const fetchedRegisters = response.data.data.registers || [];
        if (!Array.isArray(fetchedRegisters)) {
          throw new Error('Registers data is not an array');
        }
        setRegisters(fetchedRegisters);
        setFilteredRegisters(fetchedRegisters);
        const hasMore = response.data.data.hasMore;
        const total = response.data.data.total || 0;
        setTotalRegisters(total);
        setTotalPages(Math.ceil(total / perPage));
        setFetchState('success');
       
        // Debug: Log sample register data to see what fields are available
        if (fetchedRegisters.length > 0) {
          console.log('Sample register data from API:', JSON.stringify(fetchedRegisters[0], null, 2));
          console.log('Available fields in register:', Object.keys(fetchedRegisters[0]));
         
          // Specifically check file fields
          const sampleRegister = fetchedRegisters[0];
          console.log('=== FILE FIELDS DEBUG ===');
          console.log('CopyofLicensefortheyearFileId:', sampleRegister.CopyofLicensefortheyearFileId);
          console.log('CopyofLicensefortheyearFileName:', sampleRegister.CopyofLicensefortheyearFileName);
          console.log('CompletionStatusFileId:', sampleRegister.CompletionStatusFileId);
          console.log('CompletionStatusFileName:', sampleRegister.CompletionStatusFileName);
          console.log('BankStatementFileId:', sampleRegister.BankStatementFileId);
          console.log('BankStatementFileName:', sampleRegister.BankStatementFileName);
         
          // Check all file fields
          const fileFields = Object.keys(sampleRegister).filter(key =>
            key.includes('FileId') || key.includes('FileName')
          );
          console.log('All file fields in register:', fileFields);
          console.log('File field values:', fileFields.map(key => ({ [key]: sampleRegister[key] })));
          console.log('=== END FILE FIELDS DEBUG ===');
        }
      })
      .catch((err) => {
        console.error('Fetch registers error:', err);
        const errorMessage = err.response?.data?.message || 'Failed to fetch registers.';
        setFetchError(errorMessage);
        setFetchState('error');
      });
  }, [page, perPage, showAll, userRole, userEmail]);

  useEffect(() => {
    fetchRegisters();
  }, [fetchRegisters]);

  // Load contractors on component mount
  useEffect(() => {
    console.log('Loading contractors on component mount...');
    fetchContractors();
  }, [fetchContractors]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowSearchDropdown(false);
      }
      if (contractorDropdownRef.current && !contractorDropdownRef.current.contains(event.target)) {
        setShowContractorDropdown(false);
      }
    };

    if (showSearchDropdown || showContractorDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showSearchDropdown, showContractorDropdown]);

  // Handle form submission
  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    console.log('=== FORM SUBMIT START ===');
    console.log('Form submission triggered');
    setFormError('');
    setSubmitting(true);

    try {
      // Send all fields including file information
      const registerData = {
        LicenceNumber: form.LicenceNumber,
        RegisterofEmploymentNumberofpersons: form.RegisterofEmploymentNumberofpersons,
        WagesSlipNumberofpersons: form.WagesSlipNumberofpersons,
        ESIContributionRemittanceChallanNumber: form.ESIContributionRemittanceChallanNumber,
        ESIRemittanceDate: form.ESIRemittanceDate,
        ESIIPNumberofpersonsengaged: form.ESIIPNumberofpersonsengaged,
        EPFContributionRemittanceChallanNumber: form.EPFContributionRemittanceChallanNumber,
        EPFRemittanceDate: form.EPFRemittanceDate,
        EPFUANofpersonsengaged: form.EPFUANofpersonsengaged,
        PolicyNumber: form.PolicyNumber,
        ProofofremittanceofProfessionTaxAmount: form.ProofofremittanceofProfessionTaxAmount,
        ProofofremittanceofLabourWelfareFundAmount: form.ProofofremittanceofLabourWelfareFundAmount,
        DateofPayment: form.DateofPayment,
        Month_fliter: form.Month_fliter,
        Year: form.Year,
        Contractor: form.Contractor,
        ApprovalStatus: form.ApprovalStatus,
        FromDate: form.FromDate,
        ToDate: form.ToDate,
        PolicyFromDate: form.PolicyFromDate,
        PolicyToDate: form.PolicyToDate,
        HalfYearlyReturnsSubmissionDate: form.HalfYearlyReturnsSubmissionDate,
        ProofofremittanceofProfessionTaxPaymentDate: form.ProofofremittanceofProfessionTaxPaymentDate,
        ProofofremittanceofLabourWelfareFundReceiptNumber: form.ProofofremittanceofLabourWelfareFundReceiptNumber,
        ProofofremittanceofLabourWelfareFundRegNumber: form.ProofofremittanceofLabourWelfareFundRegNumber,
        FormDBonusRegisterSubmissionDate: form.FormDBonusRegisterSubmissionDate,
        // Include file information if available - both FileId and FileName
        CopyofLicensefortheyearFileId: form.CopyofLicensefortheyearFileId,
        CopyofLicensefortheyearFileName: form.CopyofLicensefortheyearFileName,
        CompletionStatusFileId: form.CompletionStatusFileId,
        CompletionStatusFileName: form.CompletionStatusFileName,
        BankStatementFileId: form.BankStatementFileId,
        BankStatementFileName: form.BankStatementFileName,
        FormCBonusRegisterFileId: form.FormCBonusRegisterFileId,
        FormCBonusRegisterFileName: form.FormCBonusRegisterFileName,
        ProofDocumentFileId: form.ProofDocumentFileId,
        ProofDocumentFileName: form.ProofDocumentFileName,
        FormDBonusRegisterFileId: form.FormDBonusRegisterFileId,
        FormDBonusRegisterFileName: form.FormDBonusRegisterFileName,
        CopyofESIElectronicChallancumReturnFileId: form.CopyofESIElectronicChallancumReturnFileId,
        CopyofESIElectronicChallancumReturnFileName: form.CopyofESIElectronicChallancumReturnFileName,
        AdvancesDeductionsforDamagesLossFinesFileId: form.AdvancesDeductionsforDamagesLossFinesFileId,
        AdvancesDeductionsforDamagesLossFinesFileName: form.AdvancesDeductionsforDamagesLossFinesFileName,
        EPFContributionRemittanceChallanFileId: form.EPFContributionRemittanceChallanFileId,
        EPFContributionRemittanceChallanFileName: form.EPFContributionRemittanceChallanFileName,
        ESIContributionRemittanceChallanFileId: form.ESIContributionRemittanceChallanFileId,
        ESIContributionRemittanceChallanFileName: form.ESIContributionRemittanceChallanFileName,
        WageslipFileId: form.WageslipFileId,
        WageslipFileName: form.WageslipFileName,
        RegisterofwagesFileId: form.RegisterofwagesFileId,
        RegisterofwagesFileName: form.RegisterofwagesFileName,
        HalfyearlyreturnsFileId: form.HalfyearlyreturnsFileId,
        HalfyearlyreturnsFileName: form.HalfyearlyreturnsFileName,
        RegisterOfEmployeement: form.RegisterOfEmployeement,
        RegisterOfEmployeementFileName: form.RegisterOfEmployeementFileName,
        remittanceofLabourWelfareFundFileId: form.remittanceofLabourWelfareFundFileId,
        remittanceofLabourWelfareFundFileName: form.remittanceofLabourWelfareFundFileName,
        remittanceofProfessionTaxFileFileId: form.remittanceofProfessionTaxFileFileId,
        remittanceofProfessionTaxFileFileName: form.remittanceofProfessionTaxFileFileName,
        EPFElectronicChallanFileId: form.EPFElectronicChallanFileId,
        EPFElectronicChallanFileName: form.EPFElectronicChallanFileName
      };
     
      // Debug: Log the data being sent
      console.log('=== FORM SUBMISSION DEBUG ===');
      console.log('Form submission data:', JSON.stringify(registerData, null, 2));
      console.log('File fields in form:', {
        CopyofLicensefortheyearFileId: form.CopyofLicensefortheyearFileId,
        CopyofLicensefortheyearFileName: form.CopyofLicensefortheyearFileName,
        CompletionStatusFileId: form.CompletionStatusFileId,
        CompletionStatusFileName: form.CompletionStatusFileName
      });
     
      // Check all file fields being sent
      const fileFieldsInSubmission = Object.keys(registerData).filter(key =>
        key.includes('FileId') || key.includes('FileName')
      );
      console.log('File fields being sent to backend:', fileFieldsInSubmission);
      console.log('File field values being sent:', fileFieldsInSubmission.map(key => ({ [key]: registerData[key] })));
      console.log('=== END FORM SUBMISSION DEBUG ===');
     
      // Check if any file fields have values
      const fileFieldsWithValues = Object.keys(registerData).filter(key =>
        key.includes('FileId') || key.includes('FileName')
      ).filter(key => registerData[key] && registerData[key].trim() !== '');
     
      console.log('File fields with values:', fileFieldsWithValues);
      console.log('File field values:', fileFieldsWithValues.map(key => ({ [key]: registerData[key] })));
     
      console.log('About to submit to backend...');
      if (isEditing && editingRegisterId) {
        console.log('Updating existing register:', editingRegisterId);
        await axios.put(`/server/StatutoryRegisters_function/registers/${editingRegisterId}`, registerData, { timeout: 10000 });
        console.log('Update successful');
      } else {
        console.log('Creating new register');
        await axios.post('/server/StatutoryRegisters_function/registers', registerData, { timeout: 10000 });
        console.log('Create successful');
      }
     
      console.log('Form submission successful, closing form...');
      setShowForm(false);
      setIsEditing(false);
      setEditingRegisterId(null);
      setForm({
        LicenceNumber: '',
        RegisterofEmploymentNumberofpersons: '',
        WagesSlipNumberofpersons: '',
        ESIContributionRemittanceChallanNumber: '',
        ESIRemittanceDate: '',
        ESIIPNumberofpersonsengaged: '',
        EPFContributionRemittanceChallanNumber: '',
        EPFRemittanceDate: '',
        EPFUANofpersonsengaged: '',
        PolicyNumber: '',
        ProofofremittanceofProfessionTaxAmount: '',
        ProofofremittanceofLabourWelfareFundAmount: '',
        DateofPayment: '',
        Month_fliter: '',
        Year: '',
        Contractor: forcedContractor || '',
        ApprovalStatus: '',
        FromDate: '',
        ToDate: '',
        PolicyFromDate: '',
        PolicyToDate: '',
        HalfYearlyReturnsSubmissionDate: '',
        ProofofremittanceofProfessionTaxPaymentDate: '',
        ProofofremittanceofLabourWelfareFundReceiptNumber: '',
        ProofofremittanceofLabourWelfareFundRegNumber: '',
        FormDBonusRegisterSubmissionDate: '',
        CopyofLicensefortheyearFileId: '',
        CopyofLicensefortheyearFileName: '',
        CompletionStatusFileId: '',
        CompletionStatusFileName: '',
        BankStatementFileId: '',
        BankStatementFileName: '',
        FormCBonusRegisterFileId: '',
        FormCBonusRegisterFileName: '',
        ProofDocumentFileId: '',
        ProofDocumentFileName: '',
        FormDBonusRegisterFileId: '',
        FormDBonusRegisterFileName: '',
        CopyofESIElectronicChallancumReturnFileId: '',
        CopyofESIElectronicChallancumReturnFileName: '',
        AdvancesDeductionsforDamagesLossFinesFileId: '',
        AdvancesDeductionsforDamagesLossFinesFileName: '',
        EPFContributionRemittanceChallanFileId: '',
        EPFContributionRemittanceChallanFileName: '',
        ESIContributionRemittanceChallanFileId: '',
        ESIContributionRemittanceChallanFileName: '',
        WageslipFileId: '',
        WageslipFileName: '',
        RegisterofwagesFileId: '',
        RegisterofwagesFileName: '',
        HalfyearlyreturnsFileId: '',
        HalfyearlyreturnsFileName: '',
        RegisterOfEmployeement: '',
        RegisterOfEmployeementFileName: '',
        remittanceofLabourWelfareFundFileId: '',
        remittanceofLabourWelfareFundFileName: '',
        remittanceofProfessionTaxFileFileId: '',
        remittanceofProfessionTaxFileFileName: '',
        EPFElectronicChallanFileId: '',
        EPFElectronicChallanFileName: '',
      });
      fetchRegisters();
    } catch (err) {
      console.error('=== FORM SUBMIT ERROR ===');
      console.error('Submit error:', err);
      console.error('Error response:', err.response?.data);
      console.error('Error status:', err.response?.status);
      const errorMessage = err.response?.data?.message || 'Failed to save register.';
      setFormError(errorMessage);
    } finally {
      console.log('Form submission completed, setting submitting to false');
      setSubmitting(false);
    }
  }, [form, isEditing, editingRegisterId, fetchRegisters]);

  // Handle form input changes
  const handleInputChange = useCallback((e) => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
  }, []);

  // Handle file upload
  const handleFileUpload = useCallback(async (e, docType) => {
    const file = e.target.files[0];
    if (!file) return;

    console.log('=== FILE UPLOAD DEBUG START ===');
    console.log('File selected:', file.name, file.size, file.type);
    console.log('DocType:', docType);
    console.log('Is editing:', isEditing);
    console.log('Editing register ID:', editingRegisterId);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const registerId = isEditing ? editingRegisterId : 'temp';
      const uploadUrl = `/server/StatutoryRegisters_function/registers/${registerId}/file/${docType}`;
     
      console.log('Uploading file:', { docType, registerId, uploadUrl });
     
      const response = await axios.post(uploadUrl, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 30000
      });

      console.log('Upload response:', response.data);
      console.log('Uploaded file name:', file.name);
      console.log('Response fileId:', response.data.fileId);
      console.log('Response fileName:', response.data.fileName);

      if (response.data.status === 'success' && response.data.fileId) {
        const fileColumns = getFileColumns(docType);
        console.log('File columns for docType:', docType, 'are:', fileColumns);
        console.log('Upload response data:', response.data);
       
        if (fileColumns.length >= 1) {
          const updateData = {
            [fileColumns[0]]: response.data.fileId
          };
         
          // If we have a fileName column, add it too
          if (fileColumns.length >= 2 && response.data.fileName) {
            updateData[fileColumns[1]] = response.data.fileName;
          }
         
          console.log('Updating form with:', updateData);
          console.log('Current form state before update:', form);
         
          setForm(prev => {
            const newForm = {
            ...prev,
            ...updateData
            };
            console.log('New form state after update:', newForm);
            return newForm;
          });
         
          // Clear any pending file state for this docType
          clearFileState(docType);
        } else {
          console.error('No file columns found for docType:', docType);
        }
      } else {
        throw new Error(response.data.message || 'Upload failed');
      }
    } catch (error) {
      console.error('File upload error:', error);
      alert(`File upload failed: ${error.response?.data?.message || error.message}`);
    }
    console.log('=== FILE UPLOAD DEBUG END ===');
  }, [isEditing, editingRegisterId]);

  // Helper function to get file columns (both FileId and FileName)
  const getFileColumns = (docType) => {
    const fileColumns = {
      'CopyofLicensefortheyear': ['CopyofLicensefortheyearFileId', 'CopyofLicensefortheyearFileName'],
      'CompletionStatus': ['CompletionStatusFileId', 'CompletionStatusFileName'],
      'BankStatement': ['BankStatementFileId', 'BankStatementFileName'],
      'FormCBonusRegisterFileUpload': ['FormCBonusRegisterFileId', 'FormCBonusRegisterFileName'],
      'ProofDocument': ['ProofDocumentFileId', 'ProofDocumentFileName'],
      'FormDBonusRegister': ['FormDBonusRegisterFileId', 'FormDBonusRegisterFileName'],
      'CopyofESIElectronicChallancumReturn': ['CopyofESIElectronicChallancumReturnFileId', 'CopyofESIElectronicChallancumReturnFileName'],
      'AdvancesDeductionsforDamagesLossFines': ['AdvancesDeductionsforDamagesLossFinesFileId', 'AdvancesDeductionsforDamagesLossFinesFileName'],
      'EPFContributionRemittanceChallanFileUpload': ['EPFContributionRemittanceChallanFileId', 'EPFContributionRemittanceChallanFileName'],
      'ESIContributionRemittanceChallanFileUpload': ['ESIContributionRemittanceChallanFileId', 'ESIContributionRemittanceChallanFileName'],
      'WageslipFileUpload': ['WageslipFileId', 'WageslipFileName'],
      'RegisterofwagesFileUpload': ['RegisterofwagesFileId', 'RegisterofwagesFileName'],
      'HalfyearlyreturnsFileUpload': ['HalfyearlyreturnsFileId', 'HalfyearlyreturnsFileName'],
      'RegisterOfEmployeement': ['RegisterOfEmployeement', 'RegisterOfEmployeementFileName'],
      'remittanceofLabourWelfareFundFileUpload': ['remittanceofLabourWelfareFundFileId', 'remittanceofLabourWelfareFundFileName'],
      'remittanceofProfessionTaxFileUpload': ['remittanceofProfessionTaxFileFileId', 'remittanceofProfessionTaxFileFileName'],
      'EPFElectronicChallanFileUpload': ['EPFElectronicChallanFileId', 'EPFElectronicChallanFileName']
    };
    return fileColumns[docType] || [];
  };

  // Handle register selection
  const handleRegisterSelect = useCallback((registerId) => {
    console.log('handleRegisterSelect called with registerId:', registerId);
    setSelectedRegisters(prev => {
      const newSelection = prev.includes(registerId)
        ? prev.filter(id => id !== registerId)
        : [...prev, registerId];
      console.log('Selected registers updated:', newSelection, 'Length:', newSelection.length);
      console.log('Previous selection:', prev);
      console.log('Register ID being toggled:', registerId);
      return newSelection;
    });
  }, []);

  // Handle register details view
  const handleRegisterClick = useCallback((register) => {
    setSelectedRegisterDetails(register);
  }, []);

  // Close register details
  const closeRegisterDetails = useCallback(() => {
    setSelectedRegisterDetails(null);
  }, []);

  // Function to download file (for details view)
  const downloadFile = useCallback(async (registerId, docType, fileName, event) => {
    const originalText = event?.target?.textContent;
   
    try {
      const downloadUrl = `/server/StatutoryRegisters_function/registers/${registerId}/file/${docType}`;
      console.log('=== DOWNLOAD DEBUG START (Details View) ===');
      console.log('Downloading file:', { downloadUrl, fileName, registerId, docType });
     
      if (event?.target) {
        event.target.textContent = 'Downloading...';
        event.target.style.pointerEvents = 'none';
      }
     
      try {
        console.log('Making fetch request to:', downloadUrl);
        const response = await fetch(downloadUrl, {
          method: 'GET',
          headers: {
            'Accept': '*/*',
            'Cache-Control': 'no-cache'
          }
        });
       
        console.log('Fetch response received:', {
          status: response.status,
          statusText: response.statusText,
          ok: response.ok,
          headers: Object.fromEntries(response.headers.entries())
        });
       
        if (!response.ok) {
          let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
          try {
            const errorData = await response.json();
            console.error('Error response data:', errorData);
            errorMessage = errorData.message || errorData.error || errorMessage;
          } catch (jsonError) {
            try {
              const errorText = await response.text();
              console.error('Error response text:', errorText);
              errorMessage = errorText || errorMessage;
            } catch (textError) {
              console.error('Could not parse error response:', textError);
            }
          }
          throw new Error(errorMessage);
        }
       
        console.log('Response is OK, creating blob...');
        const blob = await response.blob();
        console.log('Blob created:', {
          size: blob.size,
          type: blob.type,
          fileName: fileName
        });
       
        if (blob.size === 0) {
          throw new Error('Downloaded file is empty (0 bytes)');
        }
       
        // Check if the response is actually a file or an error message
        if (blob.type === 'application/json') {
          const text = await blob.text();
          const errorData = JSON.parse(text);
          throw new Error(errorData.message || 'Server returned error response');
        }
       
        console.log('Creating download link...');
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName || `${docType}_file`;
        link.style.display = 'none';
       
        document.body.appendChild(link);
        link.click();
       
        // Clean up after a short delay
        setTimeout(() => {
          if (document.body.contains(link)) {
            document.body.removeChild(link);
          }
          window.URL.revokeObjectURL(url);
        }, 100);
       
        console.log('Download completed successfully for:', fileName);
       
      } catch (fetchError) {
        console.error('Fetch/download error:', fetchError);
       
        // Try direct link as fallback
        console.log('Trying direct link fallback...');
        try {
          const link = document.createElement('a');
          link.href = downloadUrl;
          link.download = fileName || `${docType}_file`;
          link.target = '_blank';
          link.style.display = 'none';
         
          document.body.appendChild(link);
          link.click();
         
          setTimeout(() => {
            if (document.body.contains(link)) {
              document.body.removeChild(link);
            }
          }, 100);
         
          console.log('Direct link download initiated for:', fileName);
        } catch (directLinkError) {
          console.error('Direct link also failed:', directLinkError);
          throw fetchError; // Re-throw the original error
        }
      }
     
      if (event?.target) {
        event.target.textContent = originalText;
        event.target.style.pointerEvents = 'auto';
      }
     
    } catch (error) {
      console.error('=== DOWNLOAD ERROR (Details View) ===');
      console.error('Download error:', error);
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
      console.error('Request details:', { registerId, docType, fileName });
      console.error('=== DOWNLOAD ERROR END ===');
     
      alert(`Download failed: ${error.message}\n\nPlease check the console for more details.`);
     
      if (event?.target) {
        event.target.textContent = originalText;
        event.target.style.pointerEvents = 'auto';
      }
    }
    console.log('=== DOWNLOAD DEBUG END (Details View) ===');
  }, []);

  // Handle select all
  const handleSelectAll = useCallback(() => {
    if (allSelected) {
      setSelectedRegisters([]);
    } else {
      setSelectedRegisters(filteredRegisters.map(register => getRegisterId(register)));
    }
  }, [allSelected, filteredRegisters]);

  // Handle register removal
  const removeRegister = useCallback((registerId) => {
    console.log('=== REMOVE REGISTER DEBUG START ===');
    console.log('Removing register with ID:', registerId);
    console.log('Current registers before removal:', registers.length);
    console.log('Current filtered registers before removal:', filteredRegisters.length);
   
    // Update registers state
    setRegisters(prev => {
      const filtered = prev.filter(register => {
        const registerIdToCheck = getRegisterId(register);
        const shouldKeep = registerIdToCheck !== registerId;
        console.log(`Register ID: ${registerIdToCheck}, Target ID: ${registerId}, Keep: ${shouldKeep}`);
        return shouldKeep;
      });
      console.log('Registers after filtering:', filtered.length);
      return filtered;
    });
   
    // Update filtered registers state
    setFilteredRegisters(prev => {
      const filtered = prev.filter(register => {
        const registerIdToCheck = getRegisterId(register);
        return registerIdToCheck !== registerId;
      });
      console.log('Filtered registers after filtering:', filtered.length);
      return filtered;
    });
   
    // Update selected registers state
    setSelectedRegisters(prev => prev.filter(id => id !== registerId));
   
    // Force a re-render by updating a dummy state
    setFetchState(prev => prev === 'loading' ? 'success' : 'loading');
   
    console.log('=== REMOVE REGISTER DEBUG END ===');
  }, [registers, filteredRegisters]);

  // Handle register editing
  const editRegister = useCallback((register) => {
    console.log('=== EDIT REGISTER DEBUG ===');
    console.log('Register data:', register);
    console.log('CopyofLicensefortheyearFileId:', register.CopyofLicensefortheyearFileId);
    console.log('CopyofLicensefortheyearFileName:', register.CopyofLicensefortheyearFileName);
    console.log('CompletionStatusFileId:', register.CompletionStatusFileId);
    console.log('CompletionStatusFileName:', register.CompletionStatusFileName);
   
    // Clear any existing file upload states
    setPendingFiles({});
    setUploadErrors({});
    setUploading({});
   
    // Map the register data to form fields (following EmployeeManagement pattern)
    setForm({
      LicenceNumber: register.LicenceNumber || '',
      RegisterofEmploymentNumberofpersons: register.RegisterofEmploymentNumberofpersons || '',
      WagesSlipNumberofpersons: register.WagesSlipNumberofpersons || '',
      ESIContributionRemittanceChallanNumber: register.ESIContributionRemittanceChallanNumber || '',
      ESIRemittanceDate: register.ESIRemittanceDate || '',
      ESIIPNumberofpersonsengaged: register.ESIIPNumberofpersonsengaged || '',
      EPFContributionRemittanceChallanNumber: register.EPFContributionRemittanceChallanNumber || '',
      EPFRemittanceDate: register.EPFRemittanceDate || '',
      EPFUANofpersonsengaged: register.EPFUANofpersonsengaged || '',
      PolicyNumber: register.PolicyNumber || '',
      ProofofremittanceofProfessionTaxAmount: register.ProofofremittanceofProfessionTaxAmount || '',
      ProofofremittanceofLabourWelfareFundAmount: register.ProofofremittanceofLabourWelfareFundAmount || '',
      DateofPayment: register.DateofPayment || '',
      Month_fliter: register.Month_fliter || '',
      Year: register.Year || '',
      Contractor: forcedContractor || register.Contractor || '',
      ApprovalStatus: register.ApprovalStatus || '',
      FromDate: register.FromDate || '',
      ToDate: register.ToDate || '',
      PolicyFromDate: register.PolicyFromDate || '',
      PolicyToDate: register.PolicyToDate || '',
      HalfYearlyReturnsSubmissionDate: register.HalfYearlyReturnsSubmissionDate || '',
      ProofofremittanceofProfessionTaxPaymentDate: register.ProofofremittanceofProfessionTaxPaymentDate || '',
      ProofofremittanceofLabourWelfareFundReceiptNumber: register.ProofofremittanceofLabourWelfareFundReceiptNumber || '',
      ProofofremittanceofLabourWelfareFundRegNumber: register.ProofofremittanceofLabourWelfareFundRegNumber || '',
      FormDBonusRegisterSubmissionDate: register.FormDBonusRegisterSubmissionDate || '',
      // File fields - both FileId and FileName for proper display
      CopyofLicensefortheyearFileId: register.CopyofLicensefortheyearFileId || '',
      CopyofLicensefortheyearFileName: register.CopyofLicensefortheyearFileName || '',
      CompletionStatusFileId: register.CompletionStatusFileId || '',
      CompletionStatusFileName: register.CompletionStatusFileName || '',
      BankStatementFileId: register.BankStatementFileId || '',
      BankStatementFileName: register.BankStatementFileName || '',
      FormCBonusRegisterFileId: register.FormCBonusRegisterFileId || '',
      FormCBonusRegisterFileName: register.FormCBonusRegisterFileName || '',
      ProofDocumentFileId: register.ProofDocumentFileId || '',
      ProofDocumentFileName: register.ProofDocumentFileName || '',
      FormDBonusRegisterFileId: register.FormDBonusRegisterFileId || '',
      FormDBonusRegisterFileName: register.FormDBonusRegisterFileName || '',
      CopyofESIElectronicChallancumReturnFileId: register.CopyofESIElectronicChallancumReturnFileId || '',
      CopyofESIElectronicChallancumReturnFileName: register.CopyofESIElectronicChallancumReturnFileName || '',
      AdvancesDeductionsforDamagesLossFinesFileId: register.AdvancesDeductionsforDamagesLossFinesFileId || '',
      AdvancesDeductionsforDamagesLossFinesFileName: register.AdvancesDeductionsforDamagesLossFinesFileName || '',
      EPFContributionRemittanceChallanFileId: register.EPFContributionRemittanceChallanFileId || '',
      EPFContributionRemittanceChallanFileName: register.EPFContributionRemittanceChallanFileName || '',
      ESIContributionRemittanceChallanFileId: register.ESIContributionRemittanceChallanFileId || '',
      ESIContributionRemittanceChallanFileName: register.ESIContributionRemittanceChallanFileName || '',
      WageslipFileId: register.WageslipFileId || '',
      WageslipFileName: register.WageslipFileName || '',
      RegisterofwagesFileId: register.RegisterofwagesFileId || '',
      RegisterofwagesFileName: register.RegisterofwagesFileName || '',
      HalfyearlyreturnsFileId: register.HalfyearlyreturnsFileId || '',
      HalfyearlyreturnsFileName: register.HalfyearlyreturnsFileName || '',
      RegisterOfEmployeement: register.RegisterOfEmployeement || '',
      RegisterOfEmployeementFileName: register.RegisterOfEmployeementFileName || '',
      remittanceofLabourWelfareFundFileId: register.remittanceofLabourWelfareFundFileId || '',
      remittanceofLabourWelfareFundFileName: register.remittanceofLabourWelfareFundFileName || '',
      remittanceofProfessionTaxFileFileId: register.remittanceofProfessionTaxFileFileId || '',
      remittanceofProfessionTaxFileFileName: register.remittanceofProfessionTaxFileFileName || '',
      EPFElectronicChallanFileId: register.EPFElectronicChallanFileId || '',
      EPFElectronicChallanFileName: register.EPFElectronicChallanFileName || '',
    });
    setIsEditing(true);
    setEditingRegisterId(getRegisterId(register));
    setShowForm(true);
  }, []);

  // Handle mass delete
  const handleMassDelete = useCallback(async () => {
    if (selectedRegisters.length === 0) return;
   
    // Show confirmation popup
    if (!window.confirm(`Are you sure you want to delete ${selectedRegisters.length} statutory register(s)? This action cannot be undone.`)) {
      return;
    }
   
    console.log('=== MASS DELETE DEBUG START ===');
    console.log('Deleting registers with IDs:', selectedRegisters);
   
    setDeletingMultiple(true);
    setMassDeleteError('');
   
    try {
      const response = await axios.delete('/server/StatutoryRegisters_function/registers', {
        data: { ids: selectedRegisters },
        timeout: 15000,
        headers: {
          'Content-Type': 'application/json'
        }
      });
     
      console.log('Mass delete response:', response);
      console.log('Mass delete successful, updating UI...');
     
      setRegisters(prev => prev.filter(register => !selectedRegisters.includes(getRegisterId(register))));
      setFilteredRegisters(prev => prev.filter(register => !selectedRegisters.includes(getRegisterId(register))));
      setSelectedRegisters([]);
     
      console.log('UI updated successfully');
    } catch (err) {
      console.error('=== MASS DELETE ERROR ===');
      console.error('Mass delete request failed:', err);
      console.error('Error response:', err.response);
      console.error('Error status:', err.response?.status);
      console.error('Error data:', err.response?.data);
      console.error('Error message:', err.message);
     
      const errorMessage = err.response?.data?.message || 'Failed to delete selected registers.';
      setMassDeleteError(errorMessage);
     
      // Show error to user
      alert(`Mass delete failed: ${errorMessage}`);
    } finally {
      setDeletingMultiple(false);
      console.log('=== MASS DELETE DEBUG END ===');
    }
  }, [selectedRegisters]);

  // Handle export
  const handleExport = useCallback(async (registerId = null) => {
    setExporting(true);
    setExportError('');
   
    try {
      // Helper: lazy-load jsPDF from CDN if not already present
      const loadJsPDF = async () => {
        if (window.jspdf && window.jspdf.jsPDF) return window.jspdf.jsPDF;
        await new Promise((resolve, reject) => {
          const existing = document.querySelector('script[data-lib="jspdf"]');
          if (existing) {
            existing.addEventListener('load', () => resolve());
            existing.addEventListener('error', reject);
            return;
          }
          const script = document.createElement('script');
          script.src = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js';
          script.async = true;
          script.defer = true;
          script.setAttribute('data-lib', 'jspdf');
          script.onload = () => resolve();
          script.onerror = reject;
          document.body.appendChild(script);
        });
        return window.jspdf.jsPDF;
      };

      // Helper: load jsPDF-AutoTable
      const loadAutoTable = async () => {
        if (window.jspdfAutotableLoaded) return true;
        await new Promise((resolve, reject) => {
          const existing = document.querySelector('script[data-lib="jspdf-autotable"]');
          if (existing) {
            existing.addEventListener('load', () => resolve());
            existing.addEventListener('error', reject);
            return;
          }
          const script = document.createElement('script');
          script.src = 'https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js';
          script.async = true;
          script.defer = true;
          script.setAttribute('data-lib', 'jspdf-autotable');
          script.onload = () => { window.jspdfAutotableLoaded = true; resolve(); };
          script.onerror = reject;
          document.body.appendChild(script);
        });
        return true;
      };

      // Helper: turn an image URL into a data URL for jsPDF
      const getImageDataUrl = async (url) => {
        const res = await fetch(url);
        const blob = await res.blob();
        return await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.readAsDataURL(blob);
        });
      };

      // Create a header drawer that will render on every page
      const createHeaderDrawer = (doc, cmsLogoDataUrl, sspowerLogoDataUrl, title) => {
        const pageWidth = doc.internal.pageSize.getWidth();
        return (data) => {
          // Clear any accidental overlap
          doc.setFillColor(255, 255, 255);
          // Draw CMS logo on the left
          const logoY = 40;
          const logoHeight = 40;
          try {
            doc.addImage(cmsLogoDataUrl, 'PNG', 40, logoY, 120, logoHeight);
          } catch (e) {
            // ignore image draw errors
          }
          // Draw SSPower logo on the right
          try {
            const sspowerLogoWidth = 100;
            const sspowerLogoHeight = logoHeight;
            const sspowerLogoX = pageWidth - 40 - sspowerLogoWidth;
            doc.addImage(sspowerLogoDataUrl, 'PNG', sspowerLogoX, logoY, sspowerLogoWidth, sspowerLogoHeight);
          } catch (e) {
            // ignore image draw errors
          }
          // Title centered on the same line as logos
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(20);
          const titleText = String(title || '');
          // Center the text on the page - when using align: 'center', x should be the center point
          const titleX = pageWidth / 2;
          // Align title vertically with logos (center of logo height)
          const titleY = logoY + (logoHeight / 2) + 7; // +7 to account for text baseline
          doc.text(titleText, titleX, titleY, { align: 'center' });
          // Divider below logos and title
          doc.setLineWidth(1);
          doc.setDrawColor(220);
          doc.line(40, logoY + logoHeight + 20, pageWidth - 40, logoY + logoHeight + 20);
        };
      };

      // Helper: create a PDF for a single register row
      const exportRowToPdf = async (row) => {
        const jsPDFCtor = await loadJsPDF();
        await loadAutoTable();
        const doc = new jsPDFCtor('p', 'pt', 'a4');
        const pageWidth = doc.internal.pageSize.getWidth();
        const headerTopMargin = 120; // space reserved under header (logo at 40, height 40, divider at 100, +20 margin)
        const cmsLogoDataUrl = await getImageDataUrl(cmsLogo);
        const sspowerLogoDataUrl = await getImageDataUrl(sspowerLogo);
        const drawHeader = createHeaderDrawer(doc, cmsLogoDataUrl, sspowerLogoDataUrl, 'Statutory Report');
        let y = headerTopMargin;
        doc.setFontSize(11);
        doc.setFont('helvetica', 'normal');

        // Sectioned layout mirroring the form containers
        const fmt = (raw, type) => type === 'date' ? formatDate(raw) : (raw != null && raw !== '' ? String(raw) : '-');

        const SECTIONS = [
          {
            title: 'Contractor Details',
            fields: [
              { label: 'Contractor', key: 'Contractor' },
              { label: 'Year', key: 'Year' },
              { label: 'Month Filter', key: 'Month_fliter' }
            ]
          },
          {
            title: 'Copy of License for the Year (If Applicable)',
            fields: [
              { label: 'Licence Number', key: 'LicenceNumber' },
              { label: 'From Date', key: 'FromDate', type: 'date' },
              { label: 'To Date', key: 'ToDate', type: 'date' }
            ]
          },
          {
            title: 'Form XXVII - Register of Wages',
            fields: [
              { label: 'Register of Wages Number of Persons', key: 'RegisterofWagesNumberofpersons' }
            ]
          },
          {
            title: 'Form XXIV - Half Yearly Returns',
            fields: [
              { label: 'Half Yearly Returns Submission Date', key: 'HalfYearlyReturnsSubmissionDate', type: 'date' }
            ]
          },
          {
            title: 'Form XXVI - Register of Employment',
            fields: [
              { label: 'Register of Employment Number of Persons', key: 'RegisterofEmploymentNumberofpersons' }
            ]
          },
          {
            title: 'Form XXVIII - Wages Slip',
            fields: [
              { label: 'Wages Slip Number of Persons', key: 'WagesSlipNumberofpersons' }
            ]
          },
          {
            title: 'Form XXIX - Advances, Deductions for Damages & Loss & Fines',
            fields: []
          },
          {
            title: 'ESI Contribution Remittance Challan',
            fields: [
              { label: 'ESI Contribution Remittance Challan Number', key: 'ESIContributionRemittanceChallanNumber' },
              { label: 'ESI Remittance Date', key: 'ESIRemittanceDate', type: 'date' },
              { label: 'ESI IP Number of Persons Engaged', key: 'ESIIPNumberofpersonsengaged' }
            ]
          },
          {
            title: 'EPF Contribution Remittance Challan',
            fields: [
              { label: 'EPF Contribution Remittance Challan Number', key: 'EPFContributionRemittanceChallanNumber' },
              { label: 'EPF Remittance Date', key: 'EPFRemittanceDate', type: 'date' },
              { label: 'EPF UAN Number of Persons Engaged', key: 'EPFUANofpersonsengaged' }
            ]
          },
          {
            title: 'Policy Document',
            fields: [
              { label: 'Policy Number', key: 'PolicyNumber' },
              { label: 'Policy From Date', key: 'PolicyFromDate', type: 'date' },
              { label: 'Policy To Date', key: 'PolicyToDate', type: 'date' }
            ]
          },
          {
            title: 'Proof of Remittance of Profession Tax',
            fields: [
              { label: 'Profession Tax Amount', key: 'ProofofremittanceofProfessionTaxAmount' },
              { label: 'Profession Tax Payment Date', key: 'ProofofremittanceofProfessionTaxPaymentDate', type: 'date' }
            ]
          },
          {
            title: 'Proof of Remittance of Labour Welfare Fund with Annexure A',
            fields: [
              { label: 'Labour Welfare Fund Amount', key: 'ProofofremittanceofLabourWelfareFundAmount' },
              { label: 'Labour Welfare Fund Receipt Number', key: 'ProofofremittanceofLabourWelfareFundReceiptNumber' },
              { label: 'Labour Welfare Fund Registration Number', key: 'ProofofremittanceofLabourWelfareFundRegNumber' }
            ]
          },
          {
            title: 'Date of Payment',
            fields: [
              { label: 'Date of Payment', key: 'DateofPayment', type: 'date' }
            ]
          },
          {
            title: 'Approval',
            fields: [
              { label: 'Approval Status', key: 'ApprovalStatus' }
            ]
          }
        ];

        const renderSection = (title, fields) => {
          if (!fields || fields.length === 0) return;
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(13);
          doc.text(title, 40, y);
          y += 8;
          doc.setLineWidth(0.5);
          doc.setDrawColor(200);
          doc.line(40, y, pageWidth - 40, y);
          y += 6;

          const data = fields.map(({ label, key, type }) => [label, fmt(row[key], type)]);
          // eslint-disable-next-line no-undef
          doc.autoTable({
            startY: y,
            head: [['Field', 'Value']],
            body: data,
            styles: { font: 'helvetica', fontSize: 10, cellPadding: 6 },
            headStyles: { fillColor: [25, 118, 210], textColor: 255 },
            theme: 'grid',
            tableWidth: pageWidth - 80,
            margin: { top: headerTopMargin, left: 40, right: 40, bottom: 40 },
            didDrawPage: drawHeader
          });
          y = doc.lastAutoTable.finalY + 12;
        };

        SECTIONS.forEach(s => renderSection(s.title, s.fields));

        // Uploaded Files section (last) with clickable links
        const FILE_DOC_TYPES = [
          'CopyofLicensefortheyear',
          'CompletionStatus',
          'BankStatement',
          'FormCBonusRegisterFileUpload',
          'ProofDocument',
          'FormDBonusRegister',
          'CopyofESIElectronicChallancumReturn',
          'AdvancesDeductionsforDamagesLossFines',
          'EPFContributionRemittanceChallanFileUpload',
          'ESIContributionRemittanceChallanFileUpload',
          'WageslipFileUpload',
          'RegisterofwagesFileUpload',
          'HalfyearlyreturnsFileUpload',
          'RegisterOfEmployeement',
          'remittanceofLabourWelfareFundFileUpload',
          'remittanceofProfessionTaxFileUpload',
          'EPFElectronicChallanFileUpload'
        ];
        const FILE_LABELS = {
          CopyofLicensefortheyear: 'Copy of License',
          CompletionStatus: 'Completion Status',
          BankStatement: 'Bank Statement',
          FormCBonusRegisterFileUpload: 'Form C Bonus Register',
          ProofDocument: 'Proof Document',
          FormDBonusRegister: 'Form D Bonus Register',
          CopyofESIElectronicChallancumReturn: 'ESI Electronic Challan',
          AdvancesDeductionsforDamagesLossFines: 'Advances Deductions',
          EPFContributionRemittanceChallanFileUpload: 'EPF Contribution Challan',
          ESIContributionRemittanceChallanFileUpload: 'ESI Contribution Challan',
          WageslipFileUpload: 'Wageslip',
          RegisterofwagesFileUpload: 'Register of Wages',
          HalfyearlyreturnsFileUpload: 'Half Yearly Returns',
          RegisterOfEmployeement: 'Register of Employment',
          remittanceofLabourWelfareFundFileUpload: 'Labour Welfare Fund',
          remittanceofProfessionTaxFileUpload: 'Profession Tax File',
          EPFElectronicChallanFileUpload: 'EPF Electronic Challan'
        };

        const origin = (typeof window !== 'undefined' && window.location && window.location.origin) ? window.location.origin : '';
        const regId = getRegisterId(row);
        const uploaded = FILE_DOC_TYPES.map((dt) => {
          const cols = getFileColumns(dt);
          const idField = cols[0];
          const nameField = cols[1];
          const has = idField && row[idField];
          const displayName = getDisplayFileName(row[nameField], dt);
          const url = has ? `${origin}/server/StatutoryRegisters_function/registers/${regId}/file/${dt}` : null;
          return has ? { label: FILE_LABELS[dt] || dt, name: displayName, url } : null;
        }).filter(Boolean);

        if (uploaded.length > 0) {
          doc.addPage();
          y = headerTopMargin;
          doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
          doc.text('Uploaded Files', 40, y - 10);
          // eslint-disable-next-line no-undef
          doc.autoTable({
            startY: y,
            head: [['Document', 'File']],
            body: uploaded.map(item => [item.label, item.name]),
            styles: { font: 'helvetica', fontSize: 10, cellPadding: 6 },
            headStyles: { fillColor: [25, 118, 210], textColor: 255 },
            theme: 'grid',
            tableWidth: pageWidth - 80,
            margin: { top: headerTopMargin, left: 40, right: 40, bottom: 40 },
            didDrawPage: drawHeader,
            didParseCell: (data) => {
              if (data.section === 'body' && data.column.index === 1) {
                data.cell.text = [''];
              }
            },
            didDrawCell: (data) => {
              if (data.section === 'body' && data.column.index === 1) {
                const idx = data.row.index;
                const item = uploaded[idx];
                if (item && item.url) {
                  doc.setTextColor(25, 118, 210);
                  const textY = data.cell.y + data.cell.height / 2 + 3;
                  doc.textWithLink(item.name, data.cell.x + 4, textY, { url: item.url });
                  doc.setTextColor(0, 0, 0);
                } else if (item) {
                  doc.text(item.name, data.cell.x + 4, data.cell.y + data.cell.height / 2 + 3);
                }
              }
            }
          });
        }

        const safeContractor = (row.Contractor || 'register').toString().replace(/[^a-z0-9_-]+/gi, '_');
        const id = getRegisterId(row);
        const fileName = `statutory_${safeContractor}_${id}.pdf`;
        doc.save(fileName);
      };

      // If no specific id is provided and there are selected registers, export each selected one
      if (!registerId && selectedRegisters && selectedRegisters.length > 0) {
        for (const id of selectedRegisters) {
          const row = registers.find(r => getRegisterId(r) === id) || filteredRegisters.find(r => getRegisterId(r) === id);
          if (row) await exportRowToPdf(row);
        }
        return;
      }
     
      // Single specified id -> export that row to PDF
      if (registerId) {
        const row = registers.find(r => getRegisterId(r) === registerId) || filteredRegisters.find(r => getRegisterId(r) === registerId);
        if (row) await exportRowToPdf(row);
        return;
      }

      // No selection and no specific id: export all filtered rows into one multi-page PDF
      const allRows = filteredRegisters.length > 0 ? filteredRegisters : registers;
      if (allRows.length > 0) {
        // Export one consolidated PDF with form-model tables per row
        const jsPDFCtor = await loadJsPDF();
        await loadAutoTable();
        const doc = new jsPDFCtor('p', 'pt', 'a4');
        const pageWidth = doc.internal.pageSize.getWidth();
        const headerTopMargin = 120; // space reserved under header (logo at 40, height 40, divider at 100, +20 margin)
        const cmsLogoDataUrl = await getImageDataUrl(cmsLogo);
        const sspowerLogoDataUrl = await getImageDataUrl(sspowerLogo);
        const drawHeader = createHeaderDrawer(doc, cmsLogoDataUrl, sspowerLogoDataUrl, 'Statutory Report');
        let y = headerTopMargin;
        const renderRow = (row, idx) => {
          if (idx > 0) { doc.addPage(); y = headerTopMargin; }
          doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
          doc.text(`#${idx + 1} - ${row.Contractor || '-'}`, 40, y - 8);
          doc.setDrawColor(200); doc.line(40, y - 4, pageWidth - 40, y - 4); y += 2;
          const fmt = (raw, type) => type === 'date' ? formatDate(raw) : (raw != null && raw !== '' ? String(raw) : '-');
          const SECTIONS = [
            { title: 'Contractor Details', fields: [
              { label: 'Contractor', key: 'Contractor' },
              { label: 'Year', key: 'Year' },
              { label: 'Month Filter', key: 'Month_fliter' }
            ]},
            { title: 'Copy of License for the Year (If Applicable)', fields: [
              { label: 'Licence Number', key: 'LicenceNumber' },
              { label: 'From Date', key: 'FromDate', type: 'date' },
              { label: 'To Date', key: 'ToDate', type: 'date' }
            ]},
            { title: 'Form XXVII - Register of Wages', fields: [
              { label: 'Register of Wages Number of Persons', key: 'RegisterofWagesNumberofpersons' }
            ]},
            { title: 'Form XXIV - Half Yearly Returns', fields: [
              { label: 'Half Yearly Returns Submission Date', key: 'HalfYearlyReturnsSubmissionDate', type: 'date' }
            ]},
            { title: 'Form XXVI - Register of Employment', fields: [
              { label: 'Register of Employment Number of Persons', key: 'RegisterofEmploymentNumberofpersons' }
            ]},
            { title: 'Form XXVIII - Wages Slip', fields: [
              { label: 'Wages Slip Number of Persons', key: 'WagesSlipNumberofpersons' }
            ]},
            { title: 'ESI Contribution Remittance Challan', fields: [
              { label: 'ESI Contribution Remittance Challan Number', key: 'ESIContributionRemittanceChallanNumber' },
              { label: 'ESI Remittance Date', key: 'ESIRemittanceDate', type: 'date' },
              { label: 'ESI IP Number of Persons Engaged', key: 'ESIIPNumberofpersonsengaged' }
            ]},
            { title: 'EPF Contribution Remittance Challan', fields: [
              { label: 'EPF Contribution Remittance Challan Number', key: 'EPFContributionRemittanceChallanNumber' },
              { label: 'EPF Remittance Date', key: 'EPFRemittanceDate', type: 'date' },
              { label: 'EPF UAN Number of Persons Engaged', key: 'EPFUANofpersonsengaged' }
            ]},
            { title: 'Policy Document', fields: [
              { label: 'Policy Number', key: 'PolicyNumber' },
              { label: 'Policy From Date', key: 'PolicyFromDate', type: 'date' },
              { label: 'Policy To Date', key: 'PolicyToDate', type: 'date' }
            ]},
            { title: 'Proof of Remittance of Profession Tax', fields: [
              { label: 'Profession Tax Amount', key: 'ProofofremittanceofProfessionTaxAmount' },
              { label: 'Profession Tax Payment Date', key: 'ProofofremittanceofProfessionTaxPaymentDate', type: 'date' }
            ]},
            { title: 'Proof of Remittance of Labour Welfare Fund with Annexure A', fields: [
              { label: 'Labour Welfare Fund Amount', key: 'ProofofremittanceofLabourWelfareFundAmount' },
              { label: 'Labour Welfare Fund Receipt Number', key: 'ProofofremittanceofLabourWelfareFundReceiptNumber' },
              { label: 'Labour Welfare Fund Registration Number', key: 'ProofofremittanceofLabourWelfareFundRegNumber' }
            ]},
            { title: 'Date of Payment', fields: [
              { label: 'Date of Payment', key: 'DateofPayment', type: 'date' }
            ]},
            { title: 'Approval', fields: [
              { label: 'Approval Status', key: 'ApprovalStatus' }
            ]}
          ];

          const renderSection = (title, fields) => {
            if (!fields || fields.length === 0) return;
            doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
            doc.text(title, 40, y);
            y += 8; doc.setDrawColor(200); doc.line(40, y, pageWidth - 40, y); y += 6;
            const data = fields.map(({ label, key, type }) => [label, fmt(row[key], type)]);
            // eslint-disable-next-line no-undef
            doc.autoTable({
              startY: y,
              head: [['Field', 'Value']],
              body: data,
              styles: { font: 'helvetica', fontSize: 10, cellPadding: 6 },
              headStyles: { fillColor: [25, 118, 210], textColor: 255 },
              theme: 'grid',
              tableWidth: pageWidth - 80,
              margin: { top: headerTopMargin, left: 40, right: 40, bottom: 40 },
              didDrawPage: drawHeader
            });
            y = doc.lastAutoTable.finalY + 12;
          };

          SECTIONS.forEach(s => renderSection(s.title, s.fields));

          // Uploaded Files section per row
          const FILE_DOC_TYPES = [
            'CopyofLicensefortheyear',
            'CompletionStatus',
            'BankStatement',
            'FormCBonusRegisterFileUpload',
            'ProofDocument',
            'FormDBonusRegister',
            'CopyofESIElectronicChallancumReturn',
            'AdvancesDeductionsforDamagesLossFines',
            'EPFContributionRemittanceChallanFileUpload',
            'ESIContributionRemittanceChallanFileUpload',
            'WageslipFileUpload',
            'RegisterofwagesFileUpload',
            'HalfyearlyreturnsFileUpload',
            'RegisterOfEmployeement',
            'remittanceofLabourWelfareFundFileUpload',
            'remittanceofProfessionTaxFileUpload',
            'EPFElectronicChallanFileUpload'
          ];
          const FILE_LABELS = {
            CopyofLicensefortheyear: 'Copy of License',
            CompletionStatus: 'Completion Status',
            BankStatement: 'Bank Statement',
            FormCBonusRegisterFileUpload: 'Form C Bonus Register',
            ProofDocument: 'Proof Document',
            FormDBonusRegister: 'Form D Bonus Register',
            CopyofESIElectronicChallancumReturn: 'ESI Electronic Challan',
            AdvancesDeductionsforDamagesLossFines: 'Advances Deductions',
            EPFContributionRemittanceChallanFileUpload: 'EPF Contribution Challan',
            ESIContributionRemittanceChallanFileUpload: 'ESI Contribution Challan',
            WageslipFileUpload: 'Wageslip',
            RegisterofwagesFileUpload: 'Register of Wages',
            HalfyearlyreturnsFileUpload: 'Half Yearly Returns',
            RegisterOfEmployeement: 'Register of Employment',
            remittanceofLabourWelfareFundFileUpload: 'Labour Welfare Fund',
            remittanceofProfessionTaxFileUpload: 'Profession Tax File',
            EPFElectronicChallanFileUpload: 'EPF Electronic Challan'
          };
          const origin = (typeof window !== 'undefined' && window.location && window.location.origin) ? window.location.origin : '';
          const regId = getRegisterId(row);
          const uploaded = FILE_DOC_TYPES.map((dt) => {
            const cols = getFileColumns(dt);
            const idField = cols[0];
            const nameField = cols[1];
            const has = idField && row[idField];
            const displayName = getDisplayFileName(row[nameField], dt);
            const url = has ? `${origin}/server/StatutoryRegisters_function/registers/${regId}/file/${dt}` : null;
            return has ? { label: FILE_LABELS[dt] || dt, name: displayName, url } : null;
          }).filter(Boolean);
          if (uploaded.length > 0) {
            doc.addPage();
            doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
            doc.text('Uploaded Files', 40, y - 10);
            // eslint-disable-next-line no-undef
            doc.autoTable({
              startY: y,
              head: [['Document', 'File']],
              body: uploaded.map(item => [item.label, item.name]),
              styles: { font: 'helvetica', fontSize: 10, cellPadding: 6 },
              headStyles: { fillColor: [25, 118, 210], textColor: 255 },
              theme: 'grid',
              tableWidth: pageWidth - 80,
              margin: { top: headerTopMargin, left: 40, right: 40, bottom: 40 },
              didDrawPage: drawHeader,
              didParseCell: (data) => {
                if (data.section === 'body' && data.column.index === 1) {
                  data.cell.text = [''];
                }
              },
              didDrawCell: (data) => {
                if (data.section === 'body' && data.column.index === 1) {
                  const idx = data.row.index;
                  const item = uploaded[idx];
                  if (item && item.url) {
                    doc.setTextColor(25, 118, 210);
                    const textY = data.cell.y + data.cell.height / 2 + 3;
                    doc.textWithLink(item.name, data.cell.x + 4, textY, { url: item.url });
                    doc.setTextColor(0, 0, 0);
                  } else if (item) {
                    doc.text(item.name, data.cell.x + 4, data.cell.y + data.cell.height / 2 + 3);
                  }
                }
              }
            });
          }
        };
        allRows.forEach((row, idx) => renderRow(row, idx));
        doc.save('statutory_registers.pdf');
      }
    } catch (err) {
      console.error('Export error:', err);
      const errorMessage = err.response?.data?.message || 'Failed to export registers as PDF.';
      setExportError(errorMessage);
    } finally {
      setExporting(false);
    }
  }, [selectedRegisters, registers, filteredRegisters]);

  // Export the CURRENT FORM (modal) as PDF without saving
  const handleExportCurrentForm = useCallback(async () => {
    try {
      // Lazy-load jsPDF
      const loadJsPDF = async () => {
        if (window.jspdf && window.jspdf.jsPDF) return window.jspdf.jsPDF;
        await new Promise((resolve, reject) => {
          const existing = document.querySelector('script[data-lib="jspdf"]');
          if (existing) {
            existing.addEventListener('load', () => resolve());
            existing.addEventListener('error', reject);
            return;
          }
          const script = document.createElement('script');
          script.src = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js';
          script.async = true;
          script.defer = true;
          script.setAttribute('data-lib', 'jspdf');
          script.onload = () => resolve();
          script.onerror = reject;
          document.body.appendChild(script);
        });
        return window.jspdf.jsPDF;
      };

      // Lazy-load autotable
      const loadAutoTable = async () => {
        if (window.jspdfAutotableLoaded) return true;
        await new Promise((resolve, reject) => {
          const existing = document.querySelector('script[data-lib="jspdf-autotable"]');
          if (existing) {
            existing.addEventListener('load', () => resolve());
            existing.addEventListener('error', reject);
            return;
          }
          const script = document.createElement('script');
          script.src = 'https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js';
          script.async = true;
          script.defer = true;
          script.setAttribute('data-lib', 'jspdf-autotable');
          script.onload = () => { window.jspdfAutotableLoaded = true; resolve(); };
          script.onerror = reject;
          document.body.appendChild(script);
        });
        return true;
      };

      const getImageDataUrl = async (url) => {
        const res = await fetch(url);
        const blob = await res.blob();
        return await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.readAsDataURL(blob);
        });
      };

      const jsPDFCtor = await loadJsPDF();
      await loadAutoTable();
      const doc = new jsPDFCtor('p', 'pt', 'a4');
      const pageWidth = doc.internal.pageSize.getWidth();
      const headerTopMargin = 150;
      const cmsLogoDataUrl = await getImageDataUrl(cmsLogo);
      const sspowerLogoDataUrl = await getImageDataUrl(sspowerLogo);

      const drawHeader = (title) => (data) => {
        doc.setFillColor(255, 255, 255);
        // Draw CMS logo on the left
        const logoY = 40;
        const logoHeight = 40;
        try { doc.addImage(cmsLogoDataUrl, 'PNG', 40, logoY, 120, logoHeight); } catch (e) {}
        // Draw SSPower logo on the right
        try {
          const sspowerLogoWidth = 100;
          const sspowerLogoHeight = logoHeight;
          const sspowerLogoX = pageWidth - 40 - sspowerLogoWidth;
          doc.addImage(sspowerLogoDataUrl, 'PNG', sspowerLogoX, logoY, sspowerLogoWidth, sspowerLogoHeight);
        } catch (e) {}
        // Title centered on the same line as logos
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(20);
        const titleText = String(title || 'Statutory Report');
        // Center the text on the page - when using align: 'center', x should be the center point
        const titleX = pageWidth / 2;
        // Align title vertically with logos (center of logo height)
        const titleY = logoY + (logoHeight / 2) + 7; // +7 to account for text baseline
        doc.text(titleText, titleX, titleY, { align: 'center' });
        doc.setLineWidth(1);
        doc.setDrawColor(220);
        // Divider below logos and title
        doc.line(40, logoY + logoHeight + 20, pageWidth - 40, logoY + logoHeight + 20);
      };

      const fmt = (raw, type) => type === 'date' ? formatDate(raw) : (raw != null && raw !== '' ? String(raw) : '-');
      let y = headerTopMargin;

      const SECTIONS = [
        { title: 'Contractor Details', fields: [
          { label: 'Contractor', key: 'Contractor' },
          { label: 'Year', key: 'Year' },
          { label: 'Month Filter', key: 'Month_fliter' }
        ]},
        { title: 'Copy of License for the Year (If Applicable)', fields: [
          { label: 'Licence Number', key: 'LicenceNumber' },
          { label: 'From Date', key: 'FromDate', type: 'date' },
          { label: 'To Date', key: 'ToDate', type: 'date' }
        ]},
        { title: 'Form XXVII - Register of Wages', fields: [
          { label: 'Register of Wages Number of Persons', key: 'RegisterofWagesNumberofpersons' }
        ]},
        { title: 'Form XXIV - Half Yearly Returns', fields: [
          { label: 'Half Yearly Returns Submission Date', key: 'HalfYearlyReturnsSubmissionDate', type: 'date' }
        ]},
        { title: 'Form XXVI - Register of Employment', fields: [
          { label: 'Register of Employment Number of Persons', key: 'RegisterofEmploymentNumberofpersons' }
        ]},
        { title: 'Form XXVIII - Wages Slip', fields: [
          { label: 'Wages Slip Number of Persons', key: 'WagesSlipNumberofpersons' }
        ]},
        { title: 'ESI Contribution Remittance Challan', fields: [
          { label: 'ESI Contribution Remittance Challan Number', key: 'ESIContributionRemittanceChallanNumber' },
          { label: 'ESI Remittance Date', key: 'ESIRemittanceDate', type: 'date' },
          { label: 'ESI IP Number of Persons Engaged', key: 'ESIIPNumberofpersonsengaged' }
        ]},
        { title: 'EPF Contribution Remittance Challan', fields: [
          { label: 'EPF Contribution Remittance Challan Number', key: 'EPFContributionRemittanceChallanNumber' },
          { label: 'EPF Remittance Date', key: 'EPFRemittanceDate', type: 'date' },
          { label: 'EPF UAN Number of Persons Engaged', key: 'EPFUANofpersonsengaged' }
        ]},
        { title: 'Policy Document', fields: [
          { label: 'Policy Number', key: 'PolicyNumber' },
          { label: 'Policy From Date', key: 'PolicyFromDate', type: 'date' },
          { label: 'Policy To Date', key: 'PolicyToDate', type: 'date' }
        ]},
        { title: 'Proof of Remittance of Profession Tax', fields: [
          { label: 'Profession Tax Amount', key: 'ProofofremittanceofProfessionTaxAmount' },
          { label: 'Profession Tax Payment Date', key: 'ProofofremittanceofProfessionTaxPaymentDate', type: 'date' }
        ]},
        { title: 'Proof of Remittance of Labour Welfare Fund with Annexure A', fields: [
          { label: 'Labour Welfare Fund Amount', key: 'ProofofremittanceofLabourWelfareFundAmount' },
          { label: 'Labour Welfare Fund Receipt Number', key: 'ProofofremittanceofLabourWelfareFundReceiptNumber' },
          { label: 'Labour Welfare Fund Registration Number', key: 'ProofofremittanceofLabourWelfareFundRegNumber' }
        ]},
        { title: 'Date of Payment', fields: [
          { label: 'Date of Payment', key: 'DateofPayment', type: 'date' }
        ]},
        { title: 'Approval', fields: [
          { label: 'Approval Status', key: 'ApprovalStatus' }
        ]}
      ];

      const drawHeaderFn = drawHeader('Statutory Register - Form Preview');

      const renderSection = (title, fields) => {
        if (!fields || fields.length === 0) return;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(13);
        doc.text(title, 40, y);
        y += 8;
        doc.setLineWidth(0.5);
        doc.setDrawColor(200);
        doc.line(40, y, pageWidth - 40, y);
        y += 6;
        const data = fields.map(({ label, key, type }) => [label, fmt(form[key], type)]);
        // eslint-disable-next-line no-undef
        doc.autoTable({
          startY: y,
          head: [['Field', 'Value']],
          body: data,
          styles: { font: 'helvetica', fontSize: 10, cellPadding: 6 },
          headStyles: { fillColor: [25, 118, 210], textColor: 255 },
          theme: 'grid',
          tableWidth: pageWidth - 80,
          margin: { top: headerTopMargin, left: 40, right: 40, bottom: 40 },
          didDrawPage: drawHeaderFn
        });
        y = doc.lastAutoTable.finalY + 12;
      };

      SECTIONS.forEach(s => renderSection(s.title, s.fields));

      // Append last page: Uploaded Files with clickable links (when editing has an ID)
      const FILE_DOC_TYPES = [
        'CopyofLicensefortheyear',
        'CompletionStatus',
        'BankStatement',
        'FormCBonusRegisterFileUpload',
        'ProofDocument',
        'FormDBonusRegister',
        'CopyofESIElectronicChallancumReturn',
        'AdvancesDeductionsforDamagesLossFines',
        'EPFContributionRemittanceChallanFileUpload',
        'ESIContributionRemittanceChallanFileUpload',
        'WageslipFileUpload',
        'RegisterofwagesFileUpload',
        'HalfyearlyreturnsFileUpload',
        'RegisterOfEmployeement',
        'remittanceofLabourWelfareFundFileUpload',
        'remittanceofProfessionTaxFileUpload',
        'EPFElectronicChallanFileUpload'
      ];

      const FILE_LABELS = {
        CopyofLicensefortheyear: 'Copy of License',
        CompletionStatus: 'Completion Status',
        BankStatement: 'Bank Statement',
        FormCBonusRegisterFileUpload: 'Form C Bonus Register',
        ProofDocument: 'Proof Document',
        FormDBonusRegister: 'Form D Bonus Register',
        CopyofESIElectronicChallancumReturn: 'ESI Electronic Challan',
        AdvancesDeductionsforDamagesLossFines: 'Advances Deductions',
        EPFContributionRemittanceChallanFileUpload: 'EPF Contribution Challan',
        ESIContributionRemittanceChallanFileUpload: 'ESI Contribution Challan',
        WageslipFileUpload: 'Wageslip',
        RegisterofwagesFileUpload: 'Register of Wages',
        HalfyearlyreturnsFileUpload: 'Half Yearly Returns',
        RegisterOfEmployeement: 'Register of Employment',
        remittanceofLabourWelfareFundFileUpload: 'Labour Welfare Fund',
        remittanceofProfessionTaxFileUpload: 'Profession Tax File',
        EPFElectronicChallanFileUpload: 'EPF Electronic Challan'
      };

      const origin = (typeof window !== 'undefined' && window.location && window.location.origin) ? window.location.origin : '';
      const uploaded = FILE_DOC_TYPES.map((dt) => {
        const cols = getFileColumns(dt);
        const idField = cols[0];
        const nameField = cols[1];
        const has = idField && form[idField];
        const displayName = getDisplayFileName(form[nameField], dt);
        const url = (isEditing && editingRegisterId && has)
          ? `${origin}/server/StatutoryRegisters_function/registers/${editingRegisterId}/file/${dt}`
          : null;
        return has ? { label: FILE_LABELS[dt] || dt, name: displayName, url } : null;
      }).filter(Boolean);

      if (uploaded.length > 0) {
        doc.addPage();
        y = headerTopMargin;
        const drawHeaderFiles = drawHeader('Uploaded Files');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(13);
        doc.text('Uploaded Files', 40, y - 10);
        // eslint-disable-next-line no-undef
        doc.autoTable({
          startY: y,
          head: [['Document', 'File']],
          body: uploaded.map(item => [item.label, item.name]),
          styles: { font: 'helvetica', fontSize: 10, cellPadding: 6 },
          headStyles: { fillColor: [25, 118, 210], textColor: 255 },
          theme: 'grid',
          tableWidth: pageWidth - 80,
          margin: { top: headerTopMargin, left: 40, right: 40, bottom: 40 },
          didDrawPage: drawHeaderFiles,
          didParseCell: (data) => {
            if (data.section === 'body' && data.column.index === 1) {
              // prevent default text so we can draw link ourselves later
              data.cell.text = [''];
            }
          },
          didDrawCell: (data) => {
            if (data.section === 'body' && data.column.index === 1) {
              const idx = data.row.index;
              const item = uploaded[idx];
              if (item && item.url) {
                doc.setTextColor(25, 118, 210);
                const textY = data.cell.y + data.cell.height / 2 + 3; // vertically center-ish
                doc.textWithLink(item.name, data.cell.x + 4, textY, { url: item.url });
                doc.setTextColor(0, 0, 0);
              } else if (item) {
                doc.text(item.name, data.cell.x + 4, data.cell.y + data.cell.height / 2 + 3);
              }
            }
          }
        });
      }

      const safeContractor = (form.Contractor || 'register').toString().replace(/[^a-z0-9_-]+/gi, '_');
      const idPart = isEditing && editingRegisterId ? `_${editingRegisterId}` : '';
      const fileName = `statutory_${safeContractor}${idPart}_form.pdf`;
      doc.save(fileName);
    } catch (err) {
      console.error('Export form error:', err);
      alert('Failed to export form as PDF.');
    }
  }, [form, isEditing, editingRegisterId]);

  // Handle import
  const handleImport = useCallback(async (e) => {
    const file = e.target.files[0];
    if (!file) return;
   
    setImporting(true);
    setImportError('');
   
    try {
      const formData = new FormData();
      formData.append('file', file);
     
      await axios.post('/server/StatutoryRegisters_function/registers/import', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 30000
      });
     
      fetchRegisters();
      setImporting(false);
    } catch (err) {
      console.error('Import error:', err);
      const errorMessage = err.response?.data?.message || 'Failed to import registers.';
      setImportError(errorMessage);
      setImporting(false);
    }
  }, [fetchRegisters]);

  // Handle search
  const handleSearch = useCallback((e) => {
    const query = e.target.value.toLowerCase();
    if (!query) {
      setFilteredRegisters(registers);
      return;
    }
   
    const filtered = registers.filter(register =>
      Object.values(register).some(value =>
        String(value).toLowerCase().includes(query)
      )
    );
    setFilteredRegisters(filtered);
  }, [registers]);

  // Handle pagination
  const handlePageChange = useCallback((newPage) => {
    setPage(newPage);
  }, []);

  const handlePerPageChange = useCallback((newPerPage) => {
    setPerPage(newPerPage);
    setPage(1);
  }, []);

  const handleShowAllToggle = useCallback(() => {
    setShowAll(prev => !prev);
    setPage(1);
  }, []);

  // Handle form close
  const handleFormClose = useCallback(() => {
    setShowForm(false);
    setIsEditing(false);
    setEditingRegisterId(null);
   
    // Clear file upload states
    setPendingFiles({});
    setUploadErrors({});
    setUploading({});
   
    setForm({
      LicenceNumber: '',
      RegisterofEmploymentNumberofpersons: '',
      WagesSlipNumberofpersons: '',
      ESIContributionRemittanceChallanNumber: '',
      ESIRemittanceDate: '',
      ESIIPNumberofpersonsengaged: '',
      EPFContributionRemittanceChallanNumber: '',
      EPFRemittanceDate: '',
      EPFUANofpersonsengaged: '',
      PolicyNumber: '',
      ProofofremittanceofProfessionTaxAmount: '',
      ProofofremittanceofLabourWelfareFundAmount: '',
      DateofPayment: '',
      Month_fliter: '',
      Year: '',
      Contractor: forcedContractor || '',
      ApprovalStatus: '',
      FromDate: '',
      ToDate: '',
      PolicyFromDate: '',
      PolicyToDate: '',
      HalfYearlyReturnsSubmissionDate: '',
      ProofofremittanceofProfessionTaxPaymentDate: '',
      ProofofremittanceofLabourWelfareFundReceiptNumber: '',
      FormDBonusRegisterSubmissionDate: '',
      CopyofLicensefortheyearFileId: '',
      CopyofLicensefortheyearFileName: '',
      CompletionStatusFileId: '',
      CompletionStatusFileName: '',
      BankStatementFileId: '',
      BankStatementFileName: '',
      FormCBonusRegisterFileId: '',
      FormCBonusRegisterFileName: '',
      ProofDocumentFileId: '',
      ProofDocumentFileName: '',
      FormDBonusRegisterFileId: '',
      FormDBonusRegisterFileName: '',
      CopyofESIElectronicChallancumReturnFileId: '',
      CopyofESIElectronicChallancumReturnFileName: '',
      AdvancesDeductionsforDamagesLossFinesFileId: '',
      AdvancesDeductionsforDamagesLossFinesFileName: '',
      EPFContributionRemittanceChallanFileId: '',
      EPFContributionRemittanceChallanFileName: '',
      ESIContributionRemittanceChallanFileId: '',
      ESIContributionRemittanceChallanFileName: '',
      WageslipFileId: '',
      WageslipFileName: '',
      RegisterofwagesFileId: '',
      RegisterofwagesFileName: '',
      HalfyearlyreturnsFileId: '',
      HalfyearlyreturnsFileName: '',
      RegisterOfEmployeement: '',
      RegisterOfEmployeementFileName: '',
      remittanceofLabourWelfareFundFileId: '',
      remittanceofLabourWelfareFundFileName: '',
      remittanceofProfessionTaxFileFileId: '',
      remittanceofProfessionTaxFileFileName: '',
      EPFElectronicChallanFileId: '',
      EPFElectronicChallanFileName: '',
    });
  }, []);

  // Filter functionality
  const resetSearch = useCallback(() => {
    setSearchFields({
      // Basic Information
      contractor: { enabled: false, mode: 'is', value: '' },
      year: { enabled: false, mode: 'is', value: '' },
      monthFilter: { enabled: false, mode: 'is', value: '' },
      approvalStatus: { enabled: false, mode: 'is', value: '' },
      licenceNumber: { enabled: false, mode: 'is', value: '' },
      registerofEmploymentNumberofpersons: { enabled: false, mode: 'is', value: '' },
      wagesSlipNumberofpersons: { enabled: false, mode: 'is', value: '' },
      esiContributionRemittanceChallanNumber: { enabled: false, mode: 'is', value: '' },
      esiRemittanceDate: { enabled: false, mode: 'is', value: '' },
      esiIPNumberofpersonsengaged: { enabled: false, mode: 'is', value: '' },
      epfContributionRemittanceChallanNumber: { enabled: false, mode: 'is', value: '' },
      epfRemittanceDate: { enabled: false, mode: 'is', value: '' },
      epfUANofpersonsengaged: { enabled: false, mode: 'is', value: '' },
      policyNumber: { enabled: false, mode: 'is', value: '' },
      proofofremittanceofProfessionTaxAmount: { enabled: false, mode: 'is', value: '' },
      proofofremittanceofLabourWelfareFundAmount: { enabled: false, mode: 'is', value: '' },
      dateofPayment: { enabled: false, mode: 'is', value: '' },
      fromDate: { enabled: false, mode: 'is', value: '' },
      toDate: { enabled: false, mode: 'is', value: '' },
      policyFromDate: { enabled: false, mode: 'is', value: '' },
      policyToDate: { enabled: false, mode: 'is', value: '' },
      halfYearlyReturnsSubmissionDate: { enabled: false, mode: 'is', value: '' },
      proofofremittanceofProfessionTaxPaymentDate: { enabled: false, mode: 'is', value: '' },
      proofofremittanceofLabourWelfareFundReceiptNumber: { enabled: false, mode: 'is', value: '' },
      proofofremittanceofLabourWelfareFundRegNumber: { enabled: false, mode: 'is', value: '' },
      formDBonusRegisterSubmissionDate: { enabled: false, mode: 'is', value: '' },
    });
    setPage(1);
    setShowAll(false);
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


  const handleSearchValueChange = useCallback((field, value) => {
    setSearchFields((prev) => ({
      ...prev,
      [field]: {
        ...prev[field],
        value,
      },
    }));
  }, []);

  // Handle add new register
  const handleAddNew = useCallback(() => {
    console.log('handleAddNew called - opening form');
    setShowForm(true);
    setIsEditing(false);
    setEditingRegisterId(null);
    console.log('Form state set to show');
  }, []);

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

          {/* Statutory Registers Content */}
          <div className="cms-main-content">
      {showForm ? (
        <div className="employee-form-page">
          {console.log('Form is being rendered - showForm is true')}
          <div className="employee-form-container">
            <div className="employee-form-header">
              <h1>{isEditing ? 'Edit Statutory Register' : 'Add New Statutory Register'}</h1>
              <button className="close-btn" onClick={handleFormClose}>
                <i className="fas fa-times"></i>
              </button>
            </div>
           
            <div className="employee-form-content">
              <form onSubmit={handleSubmit} className="statutory-register-form">
                {formError && (
                  <div className="error-message" style={{ marginBottom: '20px', padding: '10px', background: '#fee', color: '#c33', borderRadius: '4px' }}>
                    {formError}
                  </div>
                )}
               
                {/* Contractor Details Section */}
                <div className="form-section-card contractor-details">
                  <h2 className="section-title">Contractor Details</h2>
                  <div className="form-grid">
                    <div className="form-group">
                      <label>Contractor</label>
                      <div style={{ position: 'relative' }} ref={contractorDropdownRef}>
                        <div
                          onClick={handleContractorFieldClick}
                          style={{
                            padding: '8px 12px',
                            border: '1px solid #ddd',
                            borderRadius: '4px',
                            backgroundColor: 'white',
                            cursor: 'pointer',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            minHeight: '40px'
                          }}
                        >
                          <span style={{ color: form.Contractor ? '#000' : '#6b7280' }}>
                            {form.Contractor || 'Select Contractor'}
                          </span>
                          <span style={{ color: '#6b7280', fontSize: '12px' }}>
                            {showContractorDropdown ? '▲' : '▼'}
                          </span>
                        </div>
                       
                        {showContractorDropdown && (
                          <div
                            style={{
                              position: 'absolute',
                              top: '100%',
                              left: 0,
                              right: 0,
                              backgroundColor: 'white',
                              border: '1px solid #ddd',
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
                                placeholder="Search contractors..."
                                value={contractorSearchTerm}
                                onChange={(e) => setContractorSearchTerm(e.target.value)}
                                style={{
                                  width: '100%',
                                  padding: '6px 8px',
                                  border: '1px solid #d1d5db',
                                  borderRadius: '4px',
                                  fontSize: '14px',
                                  marginBottom: '8px'
                                }}
                              />
                            </div>
                           
                            {fetchingContractors ? (
                              <div style={{ padding: '8px', textAlign: 'center', color: '#6b7280' }}>
                                Loading contractors...
                              </div>
                            ) : filteredContractors.length > 0 ? (
                              filteredContractors.map((contractor, index) => (
                                <div
                                  key={contractor.id || index}
                                  onClick={() => handleContractorSelect(contractor)}
                                  style={{
                                    padding: '8px 12px',
                                    cursor: 'pointer',
                                    borderBottom: index < filteredContractors.length - 1 ? '1px solid #f3f4f6' : 'none'
                                  }}
                                  onMouseEnter={(e) => {
                                    e.target.style.backgroundColor = '#f3f4f6';
                                  }}
                                  onMouseLeave={(e) => {
                                    e.target.style.backgroundColor = 'white';
                                  }}
                                >
                                  <div style={{ fontWeight: '500', color: '#1f2937' }}>
                                    {contractor.ContractorName || contractor.EstablishmentName || 'Unnamed Contractor'}
                                  </div>
                                  {contractor.EstablishmentName && contractor.ContractorName && (
                                    <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '2px' }}>
                                      {contractor.EstablishmentName}
                                    </div>
                                  )}
                                </div>
                              ))
                            ) : (
                              <div style={{ padding: '8px', textAlign: 'center', color: '#6b7280' }}>
                                No contractors found
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                   
                    <div className="form-group">
                      <label>Year</label>
                      <input
                        type="number"
                        name="Year"
                        value={form.Year}
                        onChange={handleInputChange}
                        className="input"
                        placeholder="Enter year"
                      />
                    </div>
                   
                    <div className="form-group">
                      <label>Month Filter</label>
                      <select
                        name="Month_fliter"
                        value={form.Month_fliter}
                        onChange={handleInputChange}
                        className="input"
                        style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ddd' }}
                      >
                        <option value="">Select Month</option>
                        <option value="January">January</option>
                        <option value="February">February</option>
                        <option value="March">March</option>
                        <option value="April">April</option>
                        <option value="May">May</option>
                        <option value="June">June</option>
                        <option value="July">July</option>
                        <option value="August">August</option>
                        <option value="September">September</option>
                        <option value="October">October</option>
                        <option value="November">November</option>
                        <option value="December">December</option>
                      </select>
                    </div>
                  </div>
                </div>
               
                {/* Copy of License for the Year Section */}
                <div className="form-section-card work-info">
                  <h2 className="section-title">Copy of License for the Year (If Applicable)</h2>
                  <div className="form-grid">
                    <div className="form-group">
                      <label>Licence Number</label>
                      <input
                        type="text"
                        name="LicenceNumber"
                        value={form.LicenceNumber}
                        onChange={handleInputChange}
                        className="input"
                        placeholder="Enter licence number"
                      />
                    </div>
                   
                    <div className="form-group">
                      <label>From Date</label>
                      <input
                        type="date"
                        name="FromDate"
                        value={form.FromDate}
                        onChange={handleInputChange}
                        className="input"
                      />
                    </div>
                   
                    <div className="form-group">
                      <label>To Date</label>
                      <input
                        type="date"
                        name="ToDate"
                        value={form.ToDate}
                        onChange={handleInputChange}
                        className="input"
                      />
                    </div>
                  </div>
                 
                  {/* File Upload within the same section */}
                  <div style={{ marginTop: '20px', padding: '20px', border: '1px solid #e0e0e0', borderRadius: '8px', background: '#f9f9f9' }}>
                    <StatutoryFileUploadSection
                      docType="CopyofLicensefortheyear"
                      label="Copy of License for the Year"
                      registerId={editingRegisterId}
                      register={isEditing ? registers.find(r => r.id === editingRegisterId) : null}
                      pendingFile={pendingFiles.CopyofLicensefortheyear}
                      setPendingFile={(file) => setPendingFile('CopyofLicensefortheyear', file)}
                      uploadError={uploadErrors.CopyofLicensefortheyear}
                      setUploadError={(error) => setUploadError('CopyofLicensefortheyear', error)}
                      uploading={uploading.CopyofLicensefortheyear}
                      isEditing={isEditing}
                      form={form}
                      setForm={setForm}
                      onFileUpload={handleFileUpload}
                    />
                  </div>
                </div>
               
                {/* Form XXVII - Register of Wages Section */}
                <div className="form-section-card identity-info">
                  <h2 className="section-title">Form XXVII - Register of Wages</h2>
                  <div className="form-grid">
                    <div className="form-group">
                      <label>Register of Wages Number of Persons</label>
                      <input
                        type="number"
                        name="RegisterofWagesNumberofpersons"
                        value={form.RegisterofWagesNumberofpersons}
                        onChange={handleInputChange}
                        className="input"
                        placeholder="Enter number of persons"
                      />
                    </div>
                  </div>
                 
                  {/* File Upload within the same section */}
                  <div style={{ marginTop: '20px', padding: '20px', border: '1px solid #e0e0e0', borderRadius: '8px', background: '#f9f9f9' }}>
                    <StatutoryFileUploadSection
                      docType="RegisterofwagesFileUpload"
                      label="Register of Wages File Upload"
                      registerId={editingRegisterId}
                      register={isEditing ? registers.find(r => r.id === editingRegisterId) : null}
                      pendingFile={pendingFiles.RegisterofwagesFileUpload}
                      setPendingFile={(file) => setPendingFile('RegisterofwagesFileUpload', file)}
                      uploadError={uploadErrors.RegisterofwagesFileUpload}
                      setUploadError={(error) => setUploadError('RegisterofwagesFileUpload', error)}
                      uploading={uploading.RegisterofwagesFileUpload}
                      isEditing={isEditing}
                      form={form}
                      setForm={setForm}
                      onFileUpload={handleFileUpload}
                    />
                  </div>
                </div>
               
                {/* Form XXIV - Half Yearly Returns Section */}
                <div className="form-section-card address-details">
                  <h2 className="section-title">Form XXIV - Half Yearly Returns</h2>
                  <div className="form-grid">
                    <div className="form-group">
                      <label>Half Yearly Returns Submission Date</label>
                      <input
                        type="date"
                        name="HalfYearlyReturnsSubmissionDate"
                        value={form.HalfYearlyReturnsSubmissionDate}
                        onChange={handleInputChange}
                        className="input"
                      />
                    </div>
                  </div>
                 
                  {/* File Upload within the same section */}
                  <div style={{ marginTop: '20px', padding: '20px', border: '1px solid #e0e0e0', borderRadius: '8px', background: '#f9f9f9' }}>
                    <StatutoryFileUploadSection
                      docType="HalfyearlyreturnsFileUpload"
                      label="Half Yearly Returns File Upload"
                      registerId={editingRegisterId}
                      register={isEditing ? registers.find(r => r.id === editingRegisterId) : null}
                      pendingFile={pendingFiles.HalfyearlyreturnsFileUpload}
                      setPendingFile={(file) => setPendingFile('HalfyearlyreturnsFileUpload', file)}
                      uploadError={uploadErrors.HalfyearlyreturnsFileUpload}
                      setUploadError={(error) => setUploadError('HalfyearlyreturnsFileUpload', error)}
                      uploading={uploading.HalfyearlyreturnsFileUpload}
                      isEditing={isEditing}
                      form={form}
                      setForm={setForm}
                      onFileUpload={handleFileUpload}
                    />
                  </div>
                </div>
               
                {/* Form XXVI - Register of Employment Section */}
                <div className="form-section-card education-details">
                  <h2 className="section-title">Form XXVI - Register of Employment</h2>
                  <div className="form-grid">
                    <div className="form-group">
                      <label>Register of Employment Number of Persons</label>
                      <input
                        type="number"
                        name="RegisterofEmploymentNumberofpersons"
                        value={form.RegisterofEmploymentNumberofpersons}
                        onChange={handleInputChange}
                        className="input"
                        placeholder="Enter number of persons"
                      />
                    </div>
                    </div>
                   
                  {/* File Upload within the same section */}
                  <div style={{ marginTop: '20px', padding: '20px', border: '1px solid #e0e0e0', borderRadius: '8px', background: '#f9f9f9' }}>
                    <StatutoryFileUploadSection
                      docType="RegisterOfEmployeement"
                      label="Register of Employment"
                      registerId={editingRegisterId}
                      register={isEditing ? registers.find(r => r.id === editingRegisterId) : null}
                      pendingFile={pendingFiles.RegisterOfEmployeement}
                      setPendingFile={(file) => setPendingFile('RegisterOfEmployeement', file)}
                      uploadError={uploadErrors.RegisterOfEmployeement}
                      setUploadError={(error) => setUploadError('RegisterOfEmployeement', error)}
                      uploading={uploading.RegisterOfEmployeement}
                      isEditing={isEditing}
                      form={form}
                      setForm={setForm}
                      onFileUpload={handleFileUpload}
                    />
                  </div>
                </div>
               
                {/* Form XXVIII - Wages Slip Section */}
                <div className="form-section-card salary-info">
                  <h2 className="section-title">Form XXVIII - Wages Slip</h2>
                  <div className="form-grid">
                    <div className="form-group">
                      <label>Wages Slip Number of Persons</label>
                      <input
                        type="number"
                        name="WagesSlipNumberofpersons"
                        value={form.WagesSlipNumberofpersons}
                        onChange={handleInputChange}
                        className="input"
                        placeholder="Enter number of persons"
                      />
                    </div>
                    </div>
                   
                  {/* File Upload within the same section */}
                  <div style={{ marginTop: '20px', padding: '20px', border: '1px solid #e0e0e0', borderRadius: '8px', background: '#f9f9f9' }}>
                    <StatutoryFileUploadSection
                      docType="WageslipFileUpload"
                      label="Wageslip File Upload"
                      registerId={editingRegisterId}
                      register={isEditing ? registers.find(r => r.id === editingRegisterId) : null}
                      pendingFile={pendingFiles.WageslipFileUpload}
                      setPendingFile={(file) => setPendingFile('WageslipFileUpload', file)}
                      uploadError={uploadErrors.WageslipFileUpload}
                      setUploadError={(error) => setUploadError('WageslipFileUpload', error)}
                      uploading={uploading.WageslipFileUpload}
                      isEditing={isEditing}
                      form={form}
                      setForm={setForm}
                      onFileUpload={handleFileUpload}
                    />
                  </div>
                </div>
               
                {/* Form XXIX - Advances, Deductions for Damages & Loss & Fines Section */}
                <div className="form-section-card separation-info">
                  <h2 className="section-title">Form XXIX - Advances, Deductions for Damages & Loss & Fines</h2>
                  <div className="form-grid">
                    {/* File Upload within the same section */}
                    <div style={{ marginTop: '20px', padding: '20px', border: '1px solid #e0e0e0', borderRadius: '8px', background: '#f9f9f9' }}>
                      <StatutoryFileUploadSection
                        docType="AdvancesDeductionsforDamagesLossFines"
                        label="Advances Deductions for Damages Loss Fines"
                        registerId={editingRegisterId}
                        register={isEditing ? registers.find(r => r.id === editingRegisterId) : null}
                        pendingFile={pendingFiles.AdvancesDeductionsforDamagesLossFines}
                        setPendingFile={(file) => setPendingFile('AdvancesDeductionsforDamagesLossFines', file)}
                        uploadError={uploadErrors.AdvancesDeductionsforDamagesLossFines}
                        setUploadError={(error) => setUploadError('AdvancesDeductionsforDamagesLossFines', error)}
                        uploading={uploading.AdvancesDeductionsforDamagesLossFines}
                        isEditing={isEditing}
                        form={form}
                        setForm={setForm}
                        onFileUpload={handleFileUpload}
                      />
                    </div>
                  </div>
                </div>
               
                {/* ESI Contribution Section */}
                <div className="form-section-card work-info">
                  <h2 className="section-title">ESI Contribution Remittance Challan Number</h2>
                  <div className="form-grid">
                    <div className="form-group">
                      <label>ESI Contribution Remittance Challan Number</label>
                      <input
                        type="text"
                        name="ESIContributionRemittanceChallanNumber"
                        value={form.ESIContributionRemittanceChallanNumber}
                        onChange={handleInputChange}
                        className="input"
                        placeholder="Enter ESI challan number"
                      />
                    </div>
                   
                    <div className="form-group">
                      <label>ESI Remittance Date</label>
                      <input
                        type="date"
                        name="ESIRemittanceDate"
                        value={form.ESIRemittanceDate}
                        onChange={handleInputChange}
                        className="input"
                      />
                    </div>
                   
                    <div className="form-group">
                      <label>ESI IP Number of Persons Engaged</label>
                      <input
                        type="number"
                        name="ESIIPNumberofpersonsengaged"
                        value={form.ESIIPNumberofpersonsengaged}
                        onChange={handleInputChange}
                        className="input"
                        placeholder="Enter number of persons"
                      />
                    </div>
                  </div>
                 
                  {/* File Uploads within the same section */}
                  <div style={{ marginTop: '20px', padding: '20px', border: '1px solid #e0e0e0', borderRadius: '8px', background: '#f9f9f9' }}>
                   
                    <div style={{ marginBottom: '20px' }}>
                      <StatutoryFileUploadSection
                        docType="ESIContributionRemittanceChallanFileUpload"
                        label="ESI Contribution Remittance Challan"
                        registerId={editingRegisterId}
                        register={isEditing ? registers.find(r => r.id === editingRegisterId) : null}
                        pendingFile={pendingFiles.ESIContributionRemittanceChallanFileUpload}
                        setPendingFile={(file) => setPendingFile('ESIContributionRemittanceChallanFileUpload', file)}
                        uploadError={uploadErrors.ESIContributionRemittanceChallanFileUpload}
                        setUploadError={(error) => setUploadError('ESIContributionRemittanceChallanFileUpload', error)}
                        uploading={uploading.ESIContributionRemittanceChallanFileUpload}
                        isEditing={isEditing}
                        form={form}
                        setForm={setForm}
                        onFileUpload={handleFileUpload}
                      />
                    </div>
                   
                    <div>
                      <StatutoryFileUploadSection
                        docType="CopyofESIElectronicChallancumReturn"
                        label="Copy of ESI Electronic Challan cum Return"
                        registerId={editingRegisterId}
                        register={isEditing ? registers.find(r => r.id === editingRegisterId) : null}
                        pendingFile={pendingFiles.CopyofESIElectronicChallancumReturn}
                        setPendingFile={(file) => setPendingFile('CopyofESIElectronicChallancumReturn', file)}
                        uploadError={uploadErrors.CopyofESIElectronicChallancumReturn}
                        setUploadError={(error) => setUploadError('CopyofESIElectronicChallancumReturn', error)}
                        uploading={uploading.CopyofESIElectronicChallancumReturn}
                        isEditing={isEditing}
                        form={form}
                        setForm={setForm}
                        onFileUpload={handleFileUpload}
                      />
                    </div>
                  </div>
                </div>
               
                {/* EPF Contribution Section */}
                <div className="form-section-card personal-info">
                  <h2 className="section-title">EPF Contribution Remittance Challan Number</h2>
                  <div className="form-grid">
                    <div className="form-group">
                      <label>EPF Contribution Remittance Challan Number</label>
                      <input
                        type="text"
                        name="EPFContributionRemittanceChallanNumber"
                        value={form.EPFContributionRemittanceChallanNumber}
                        onChange={handleInputChange}
                        className="input"
                        placeholder="Enter EPF challan number"
                      />
                    </div>
                   
                    <div className="form-group">
                      <label>EPF Remittance Date</label>
                      <input
                        type="date"
                        name="EPFRemittanceDate"
                        value={form.EPFRemittanceDate}
                        onChange={handleInputChange}
                        className="input"
                      />
                    </div>
                   
                    <div className="form-group">
                      <label>EPF UAN Number of Persons Engaged</label>
                      <input
                        type="number"
                        name="EPFUANofpersonsengaged"
                        value={form.EPFUANofpersonsengaged}
                        onChange={handleInputChange}
                        className="input"
                        placeholder="Enter number of persons"
                      />
                    </div>
                  </div>
                 
                  {/* File Uploads within the same section */}
                  <div style={{ marginTop: '20px', padding: '20px', border: '1px solid #e0e0e0', borderRadius: '8px', background: '#f9f9f9' }}>
                   
                    <div style={{ marginBottom: '20px' }}>
                      <StatutoryFileUploadSection
                        docType="EPFElectronicChallanFileUpload"
                        label="EPF Electronic Challan File Upload"
                        registerId={editingRegisterId}
                        register={isEditing ? registers.find(r => r.id === editingRegisterId) : null}
                        pendingFile={pendingFiles.EPFElectronicChallanFileUpload}
                        setPendingFile={(file) => setPendingFile('EPFElectronicChallanFileUpload', file)}
                        uploadError={uploadErrors.EPFElectronicChallanFileUpload}
                        setUploadError={(error) => setUploadError('EPFElectronicChallanFileUpload', error)}
                        uploading={uploading.EPFElectronicChallanFileUpload}
                        isEditing={isEditing}
                        form={form}
                        setForm={setForm}
                        onFileUpload={handleFileUpload}
                      />
                    </div>
                   
                    <div>
                      <StatutoryFileUploadSection
                        docType="EPFContributionRemittanceChallanFileUpload"
                        label="EPF Contribution Remittance Challan"
                        registerId={editingRegisterId}
                        register={isEditing ? registers.find(r => r.id === editingRegisterId) : null}
                        pendingFile={pendingFiles.EPFContributionRemittanceChallanFileUpload}
                        setPendingFile={(file) => setPendingFile('EPFContributionRemittanceChallanFileUpload', file)}
                        uploadError={uploadErrors.EPFContributionRemittanceChallanFileUpload}
                        setUploadError={(error) => setUploadError('EPFContributionRemittanceChallanFileUpload', error)}
                        uploading={uploading.EPFContributionRemittanceChallanFileUpload}
                        isEditing={isEditing}
                        form={form}
                        setForm={setForm}
                        onFileUpload={handleFileUpload}
                      />
                    </div>
                  </div>
                </div>
               
                {/* Policy Document Section */}
                <div className="form-section-card address-details">
                  <h2 className="section-title">Policy Document</h2>
                  <div className="form-grid">
                    <div className="form-group">
                      <label>Policy Number</label>
                      <input
                        type="text"
                        name="PolicyNumber"
                        value={form.PolicyNumber}
                        onChange={handleInputChange}
                        className="input"
                        placeholder="Enter policy number"
                      />
                    </div>
                   
                    <div className="form-group">
                      <label>Policy From Date</label>
                      <input
                        type="date"
                        name="PolicyFromDate"
                        value={form.PolicyFromDate}
                        onChange={handleInputChange}
                        className="input"
                      />
                    </div>
                   
                    <div className="form-group">
                      <label>Policy To Date</label>
                      <input
                        type="date"
                        name="PolicyToDate"
                        value={form.PolicyToDate}
                        onChange={handleInputChange}
                        className="input"
                      />
                    </div>
                  </div>
                 
                  {/* File Upload within the same section */}
                  <div style={{ marginTop: '20px', padding: '20px', border: '1px solid #e0e0e0', borderRadius: '8px', background: '#f9f9f9' }}>
                    <StatutoryFileUploadSection
                      docType="ProofDocument"
                      label="Proof Document File"
                      registerId={editingRegisterId}
                      register={isEditing ? registers.find(r => r.id === editingRegisterId) : null}
                      pendingFile={pendingFiles.ProofDocument}
                      setPendingFile={(file) => setPendingFile('ProofDocument', file)}
                      uploadError={uploadErrors.ProofDocument}
                      setUploadError={(error) => setUploadError('ProofDocument', error)}
                      uploading={uploading.ProofDocument}
                      isEditing={isEditing}
                      form={form}
                      setForm={setForm}
                      onFileUpload={handleFileUpload}
                    />
                  </div>
                </div>
               
                {/* Proof of remittance of Profession Tax Section */}
                <div className="form-section-card education-details">
                  <h2 className="section-title">Proof of remittance of Profession Tax</h2>
                  <div className="form-grid">
                    <div className="form-group">
                      <label>Proof of Remittance of Profession Tax Amount</label>
                      <input
                        type="number"
                        name="ProofofremittanceofProfessionTaxAmount"
                        value={form.ProofofremittanceofProfessionTaxAmount}
                        onChange={handleInputChange}
                        className="input"
                        placeholder="Enter amount"
                      />
                    </div>
                   
                    <div className="form-group">
                      <label>Proof of Remittance of Profession Tax Payment Date</label>
                      <input
                        type="date"
                        name="ProofofremittanceofProfessionTaxPaymentDate"
                        value={form.ProofofremittanceofProfessionTaxPaymentDate}
                        onChange={handleInputChange}
                        className="input"
                      />
                    </div>
                  </div>
                 
                  {/* File Upload within the same section */}
                  <div style={{ marginTop: '20px', padding: '20px', border: '1px solid #e0e0e0', borderRadius: '8px', background: '#f9f9f9' }}>
                    <StatutoryFileUploadSection
                      docType="remittanceofProfessionTaxFileUpload"
                      label="Remittance of Profession Tax File"
                      registerId={editingRegisterId}
                      register={isEditing ? registers.find(r => r.id === editingRegisterId) : null}
                      pendingFile={pendingFiles.remittanceofProfessionTaxFileUpload}
                      setPendingFile={(file) => setPendingFile('remittanceofProfessionTaxFileUpload', file)}
                      uploadError={uploadErrors.remittanceofProfessionTaxFileUpload}
                      setUploadError={(error) => setUploadError('remittanceofProfessionTaxFileUpload', error)}
                      uploading={uploading.remittanceofProfessionTaxFileUpload}
                      isEditing={isEditing}
                      form={form}
                      setForm={setForm}
                      onFileUpload={handleFileUpload}
                    />
                  </div>
                </div>
               
                {/* Proof of remittance of Labour Welfare Fund with Annexure A Section */}
                <div className="form-section-card salary-info">
                  <h2 className="section-title">Proof of remittance of Labour Welfare Fund with Annexure A</h2>
                  <div className="form-grid">
                    <div className="form-group">
                      <label>Proof of Remittance of Labour Welfare Fund Amount</label>
                      <input
                        type="number"
                        name="ProofofremittanceofLabourWelfareFundAmount"
                        value={form.ProofofremittanceofLabourWelfareFundAmount}
                        onChange={handleInputChange}
                        className="input"
                        placeholder="Enter amount"
                      />
                    </div>
                   
                    <div className="form-group">
                      <label>Proof of Remittance of Labour Welfare Fund Receipt Number</label>
                      <input
                        type="text"
                        name="ProofofremittanceofLabourWelfareFundReceiptNumber"
                        value={form.ProofofremittanceofLabourWelfareFundReceiptNumber}
                        onChange={handleInputChange}
                        className="input"
                        placeholder="Enter receipt number"
                      />
                    </div>
                   
                    <div className="form-group">
                      <label>Proof of Remittance of Profession Tax Payment Date</label>
                      <input
                        type="date"
                        name="ProofofremittanceofProfessionTaxPaymentDate"
                        value={form.ProofofremittanceofProfessionTaxPaymentDate}
                        onChange={handleInputChange}
                        className="input"
                      />
                    </div>
                   
                    <div className="form-group">
                      <label>Proof of Remittance of Labour Welfare Fund Registration Number</label>
                      <input
                        type="text"
                        name="ProofofremittanceofLabourWelfareFundRegNumber"
                        value={form.ProofofremittanceofLabourWelfareFundRegNumber}
                        onChange={handleInputChange}
                        className="input"
                        placeholder="Enter registration number"
                      />
                    </div>
                  </div>
                 
                  {/* File Upload within the same section */}
                  <div style={{ marginTop: '20px', padding: '20px', border: '1px solid #e0e0e0', borderRadius: '8px', background: '#f9f9f9' }}>
                    <StatutoryFileUploadSection
                      docType="RemittanceofLabourWelfareFundFileUpload"
                      label="Remittance of Labour Welfare Fund File"
                      registerId={editingRegisterId}
                      register={isEditing ? registers.find(r => r.id === editingRegisterId) : null}
                      pendingFile={pendingFiles.RemittanceofLabourWelfareFundFileUpload}
                      setPendingFile={(file) => setPendingFile('RemittanceofLabourWelfareFundFileUpload', file)}
                      uploadError={uploadErrors.RemittanceofLabourWelfareFundFileUpload}
                      setUploadError={(error) => setUploadError('RemittanceofLabourWelfareFundFileUpload', error)}
                      uploading={uploading.RemittanceofLabourWelfareFundFileUpload}
                      isEditing={isEditing}
                      form={form}
                      setForm={setForm}
                      onFileUpload={handleFileUpload}
                    />
                  </div>
                </div>
               
                {/* Form C - Bonus Register Section */}
                <div className="form-section-card separation-info">
                  <h2 className="section-title">Form C - Bonus Register</h2>
                 
                  {/* File Upload within the same section */}
                  <div style={{ marginTop: '20px', padding: '20px', border: '1px solid #e0e0e0', borderRadius: '8px', background: '#f9f9f9' }}>
                    <StatutoryFileUploadSection
                      docType="FormCBonusRegister"
                      label="Form C Bonus Register File"
                      registerId={editingRegisterId}
                      register={isEditing ? registers.find(r => r.id === editingRegisterId) : null}
                      pendingFile={pendingFiles.FormCBonusRegister}
                      setPendingFile={(file) => setPendingFile('FormCBonusRegister', file)}
                      uploadError={uploadErrors.FormCBonusRegister}
                      setUploadError={(error) => setUploadError('FormCBonusRegister', error)}
                      uploading={uploading.FormCBonusRegister}
                      isEditing={isEditing}
                      form={form}
                      setForm={setForm}
                      onFileUpload={handleFileUpload}
                    />
                  </div>
                </div>
               
                {/* Form D - Bonus Register Section */}
                <div className="form-section-card address-details">
                  <h2 className="section-title">Form D - Bonus Register</h2>
                  <div className="form-grid">
                    <div className="form-group">
                      <label>Form D Bonus Register Submission Date</label>
                      <input
                        type="date"
                        name="FormDBonusRegisterSubmissionDate"
                        value={form.FormDBonusRegisterSubmissionDate}
                        onChange={handleInputChange}
                        className="input"
                      />
                    </div>
                  </div>
                 
                  {/* File Upload within the same section */}
                  <div style={{ marginTop: '20px', padding: '20px', border: '1px solid #e0e0e0', borderRadius: '8px', background: '#f9f9f9' }}>
                    <StatutoryFileUploadSection
                      docType="FormDBonusRegister"
                      label="Form D Bonus Register File"
                      registerId={editingRegisterId}
                      register={isEditing ? registers.find(r => r.id === editingRegisterId) : null}
                      pendingFile={pendingFiles.FormDBonusRegister}
                      setPendingFile={(file) => setPendingFile('FormDBonusRegister', file)}
                      uploadError={uploadErrors.FormDBonusRegister}
                      setUploadError={(error) => setUploadError('FormDBonusRegister', error)}
                      uploading={uploading.FormDBonusRegister}
                      isEditing={isEditing}
                      form={form}
                      setForm={setForm}
                      onFileUpload={handleFileUpload}
                    />
                  </div>
                </div>
               
                {/* Date of Payment Section */}
                <div className="form-section-card education-details">
                  <h2 className="section-title">Date of Payment</h2>
                  <div className="form-grid">
                    <div className="form-group">
                      <label>Date of Payment</label>
                      <input
                        type="date"
                        name="DateofPayment"
                        value={form.DateofPayment}
                        onChange={handleInputChange}
                        className="input"
                      />
                    </div>
                  </div>
                </div>
               
                {/* Bank Statement Section */}
                <div className="form-section-card personal-info">
                  <h2 className="section-title">Bank Statement</h2>
                 
                  {/* File Upload within the same section */}
                  <div style={{ marginTop: '20px', padding: '20px', border: '1px solid #e0e0e0', borderRadius: '8px', background: '#f9f9f9' }}>
                    <StatutoryFileUploadSection
                      docType="BankStatement"
                      label="Bank Statement File"
                      registerId={editingRegisterId}
                      register={isEditing ? registers.find(r => r.id === editingRegisterId) : null}
                      pendingFile={pendingFiles.BankStatement}
                      setPendingFile={(file) => setPendingFile('BankStatement', file)}
                      uploadError={uploadErrors.BankStatement}
                      setUploadError={(error) => setUploadError('BankStatement', error)}
                      uploading={uploading.BankStatement}
                      isEditing={isEditing}
                      form={form}
                      setForm={setForm}
                      onFileUpload={handleFileUpload}
                    />
                  </div>
                </div>
               
                {/* Completion Status Section */}
                <div className="form-section-card identity-info">
                  <h2 className="section-title">Completion Status</h2>
                 
                  {/* File Upload within the same section */}
                  <div style={{ marginTop: '20px', padding: '20px', border: '1px solid #e0e0e0', borderRadius: '8px', background: '#f9f9f9' }}>
                    <StatutoryFileUploadSection
                      docType="CompletionStatus"
                      label="Completion Status File"
                      registerId={editingRegisterId}
                      register={isEditing ? registers.find(r => r.id === editingRegisterId) : null}
                      pendingFile={pendingFiles.CompletionStatus}
                      setPendingFile={(file) => setPendingFile('CompletionStatus', file)}
                      uploadError={uploadErrors.CompletionStatus}
                      setUploadError={(error) => setUploadError('CompletionStatus', error)}
                      uploading={uploading.CompletionStatus}
                      isEditing={isEditing}
                      form={form}
                      setForm={setForm}
                      onFileUpload={handleFileUpload}
                    />
                  </div>
                </div>
               
                {/* Approval Section */}
                <div className="form-section-card work-info">
                  <h2 className="section-title">Approval</h2>
                  <div className="form-grid">
                    <div className="form-group">
                      <label>Approval Status</label>
                      <select
                        name="ApprovalStatus"
                        value={form.ApprovalStatus}
                        onChange={handleInputChange}
                        className="input"
                      >
                        <option value="">Select Status</option>
                        <option value="Approved">Approved</option>
                        <option value="Pending">Pending</option>
                        <option value="Rejected">Rejected</option>
                      </select>
                    </div>
                  </div>
                </div>
               
               
               
               
               
                <div className="form-actions">
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={handleFormClose}
                    disabled={submitting}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={handleExportCurrentForm}
                    disabled={submitting}
                    title="Download this form as PDF"
                  >
                    Export PDF
                  </button>
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={submitting}
                    onClick={() => console.log('Submit button clicked')}
                  >
                    {submitting ? (
                      <div className="loader-xs"></div>
                    ) : (
                      isEditing ? 'Update Register' : 'Submit'
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      ) : (
        <div className="employee-card-container">
          {console.log('Main view is being rendered - showForm is false')}
          <div className="employee-section-title">
            <h1>Statutory Registers</h1>
            <p className="employee-section-subtitle">Manage statutory compliance records</p>
          </div>
         
          {/* Toolbar with action buttons */}
          <div className="employee-toolbar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '12px', flexWrap: 'nowrap', marginBottom: '20px' }}>
            <button
              className="toolbar-btn import-btn"
              onClick={() => fileInputRef.current.click()}
              disabled={importing}
              title="Import registers from Excel"
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
              title="Export filtered registers to Excel"
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
              title={showSearchDropdown ? "Hide filter options" : "Show filter options"}
              type="button"
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
              onClick={fetchRegisters}
              title="Refresh data"
              type="button"
              style={{ background: '#fff', color: '#7c3aed', border: 'none', fontWeight: 600, padding: '8px', borderRadius: '8px', width: '48px', height: '48px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}
            >
              <RefreshCw size={22} style={{ color: '#7c3aed' }} />
            </button>
            <button
              className="toolbar-btn add-btn"
              onClick={handleAddNew}
              title="Add new register"
              type="button"
              style={{ background: '#fff', color: '#14b8a6', border: 'none', fontWeight: 700, padding: '8px', borderRadius: '8px', width: '48px', height: '48px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(60,72,88,0.10)' }}
            >
              <Plus size={24} style={{ color: '#14b8a6' }} />
            </button>
            {selectedRegisters.length > 0 && (
              <button
                className="toolbar-btn delete-btn"
                onClick={handleMassDelete}
                disabled={deletingMultiple}
                title={`Delete ${selectedRegisters.length} selected register(s)`}
                type="button"
                style={{ background: '#fff', color: '#d32f2f', border: '2px solid #ffcdd2', fontWeight: 700, padding: '8px', borderRadius: '8px', width: '48px', height: '48px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(211,47,47,0.15)' }}
              >
                <Trash2 size={22} style={{ color: '#d32f2f' }} />
              </button>
            )}
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
                          {field === 'contractor' ? (
                            // Special dropdown for contractor field
                            <div style={{ position: 'relative' }}>
                              <div
                                onClick={() => {
                                  if (contractors.length === 0 && !fetchingContractors) {
                                    fetchContractors();
                                  }
                                  setShowContractorDropdown(true);
                                }}
                                style={{
                                  padding: '6px 8px',
                                  border: '1px solid #d1d5db',
                                  borderRadius: '4px',
                                  backgroundColor: 'white',
                                  cursor: 'pointer',
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'center',
                                  minHeight: '32px'
                                }}
                              >
                                <span style={{ color: searchFields[field].value ? '#000' : '#6b7280' }}>
                                  {searchFields[field].value || 'Select Contractor'}
                                </span>
                                <span style={{ color: '#6b7280', fontSize: '12px' }}>
                                  {showContractorDropdown ? '▲' : '▼'}
                                </span>
                              </div>
                             
                              {showContractorDropdown && (
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
                                      placeholder="Search contractors..."
                                      value={contractorSearchTerm}
                                      onChange={(e) => setContractorSearchTerm(e.target.value)}
                                      style={{
                                        width: '100%',
                                        padding: '6px 8px',
                                        border: '1px solid #d1d5db',
                                        borderRadius: '4px',
                                        fontSize: '14px',
                                        marginBottom: '8px'
                                      }}
                                    />
                                  </div>
                                 
                                  {fetchingContractors ? (
                                    <div style={{ padding: '8px', textAlign: 'center', color: '#6b7280' }}>
                                      Loading contractors...
                                    </div>
                                  ) : filteredContractors.length > 0 ? (
                                    filteredContractors.map((contractor, index) => (
                                      <div
                                        key={contractor.id || index}
                                        onClick={() => {
                                          handleSearchValueChange(field, contractor.ContractorName || contractor.EstablishmentName);
                                          setShowContractorDropdown(false);
                                          setContractorSearchTerm('');
                                        }}
                                        style={{
                                          padding: '8px 12px',
                                          cursor: 'pointer',
                                          borderBottom: index < filteredContractors.length - 1 ? '1px solid #f3f4f6' : 'none'
                                        }}
                                        onMouseEnter={(e) => {
                                          e.target.style.backgroundColor = '#f3f4f6';
                                        }}
                                        onMouseLeave={(e) => {
                                          e.target.style.backgroundColor = 'white';
                                        }}
                                      >
                                        <div style={{ fontWeight: '500', color: '#1f2937' }}>
                                          {contractor.ContractorName || contractor.EstablishmentName || 'Unnamed Contractor'}
                                        </div>
                                        {contractor.EstablishmentName && contractor.ContractorName && (
                                          <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '2px' }}>
                                            {contractor.EstablishmentName}
                                          </div>
                                        )}
                                      </div>
                                    ))
                                  ) : (
                                    <div style={{ padding: '8px', textAlign: 'center', color: '#6b7280' }}>
                                      No contractors found
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          ) : (
                            // Regular text input for other fields
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
                      backgroundColor: '#1976d2',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '14px'
                    }}
                  >
                    Apply Filters
                  </button>
                </div>
              </div>
            </div>
          )}
         
          <div className="statutory-register-table-container">
            <table className="statutory-register-table">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      checked={allSelected}
                      ref={checkbox => {
                        if (checkbox) checkbox.indeterminate = someSelected;
                      }}
                      onChange={handleSelectAll}
                    />
                  </th>
                  {selectedRegisters.length > 0 && <th>Edit</th>}
                  {selectedRegisters.length > 0 && <th>Export</th>}
                  <th>#</th>
                  <th>Contractor</th>
                  <th>Year</th>
                  <th>Month Filter</th>
                  <th>Approval Status</th>
                  <th>Licence Number</th>
                  <th>Register of Employment</th>
                  <th>Wages Slip</th>
                  <th>ESI Contribution</th>
                  <th>ESI Remittance Date</th>
                  <th>ESI IP Persons</th>
                  <th>EPF Contribution</th>
                  <th>EPF Remittance Date</th>
                  <th>EPF UAN Persons</th>
                  <th>Policy Number</th>
                  <th>Profession Tax Amount</th>
                  <th>Labour Welfare Amount</th>
                  <th>Date of Payment</th>
                  <th>From Date</th>
                  <th>To Date</th>
                  <th>Policy From Date</th>
                  <th>Policy To Date</th>
                  <th>Half Yearly Returns</th>
                  <th>Profession Tax Payment Date</th>
                  <th>Labour Welfare Receipt</th>
                  <th>Form D Bonus Register</th>
                  <th>Copy of License</th>
                  <th>Completion Status</th>
                  <th>Bank Statement</th>
                  <th>Form C Bonus Register</th>
                  <th>Proof Document</th>
                  <th>Form D Bonus Register</th>
                  <th>ESI Electronic Challan</th>
                  <th>Advances Deductions</th>
                  <th>EPF Contribution Challan</th>
                  <th>ESI Contribution Challan</th>
                  <th>Wageslip</th>
                  <th>Register of Wages</th>
                  <th>Half Yearly Returns</th>
                  <th>Register of Employment</th>
                  <th>Labour Welfare Fund</th>
                  <th>EPF Electronic Challan</th>
                </tr>
              </thead>
              <tbody>
                {filteredRegisters.map((register, index) => (
                  <StatutoryRegisterRow
                    key={getRegisterId(register) || `register-${index}`}
                    register={register}
                    index={index}
                    removeRegister={removeRegister}
                    editRegister={editRegister}
                    isSelected={selectedRegisters.includes(getRegisterId(register))}
                    onSelect={handleRegisterSelect}
                    selectedRegisters={selectedRegisters}
                    onRegisterClick={handleRegisterClick}
                    onExport={handleExport}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {/* Register Details Card */}
          {selectedRegisterDetails && (
            <div className="register-details-card">
              <div className="details-header">
                <h3>Statutory Register Details</h3>
                <button
                  className="details-close-btn"
                  onClick={closeRegisterDetails}
                  aria-label="Close details"
                >
                  <i className="fas fa-times"></i>
                </button>
              </div>
             
              <div className="details-content">
                <div className="details-section">
                  <h4>Basic Information</h4>
                  <div className="details-grid">
                    <div className="detail-item">
                      <label>Licence Number:</label>
                      <span>{selectedRegisterDetails.LicenceNumber || 'N/A'}</span>
                    </div>
                    <div className="detail-item">
                      <label>Register of Employment Number of Persons:</label>
                      <span>{selectedRegisterDetails.RegisterofEmploymentNumberofpersons || 'N/A'}</span>
                    </div>
                    <div className="detail-item">
                      <label>Wages Slip Number of Persons:</label>
                      <span>{selectedRegisterDetails.WagesSlipNumberofpersons || 'N/A'}</span>
                    </div>
                    <div className="detail-item">
                      <label>Contractor:</label>
                      <span>{selectedRegisterDetails.Contractor || 'N/A'}</span>
                    </div>
                    <div className="detail-item">
                      <label>Approval Status:</label>
                      <span>{selectedRegisterDetails.ApprovalStatus || 'N/A'}</span>
                    </div>
                    <div className="detail-item">
                      <label>Month Filter:</label>
                      <span>{selectedRegisterDetails.Month_fliter || 'N/A'}</span>
                    </div>
                    <div className="detail-item">
                      <label>Year:</label>
                      <span>{selectedRegisterDetails.Year || 'N/A'}</span>
                    </div>
                  </div>
                </div>

                <div className="details-section">
                  <h4>ESI Information</h4>
                  <div className="details-grid">
                    <div className="detail-item">
                      <label>ESI Contribution Remittance Challan Number:</label>
                      <span>{selectedRegisterDetails.ESIContributionRemittanceChallanNumber || 'N/A'}</span>
                    </div>
                    <div className="detail-item">
                      <label>ESI Remittance Date:</label>
                      <span>{formatDate(selectedRegisterDetails.ESIRemittanceDate) || 'N/A'}</span>
                    </div>
                    <div className="detail-item">
                      <label>ESI IP Number of Persons Engaged:</label>
                      <span>{selectedRegisterDetails.ESIIPNumberofpersonsengaged || 'N/A'}</span>
                    </div>
                  </div>
                </div>

                <div className="details-section">
                  <h4>EPF Information</h4>
                  <div className="details-grid">
                    <div className="detail-item">
                      <label>EPF Contribution Remittance Challan Number:</label>
                      <span>{selectedRegisterDetails.EPFContributionRemittanceChallanNumber || 'N/A'}</span>
                    </div>
                    <div className="detail-item">
                      <label>EPF Remittance Date:</label>
                      <span>{formatDate(selectedRegisterDetails.EPFRemittanceDate) || 'N/A'}</span>
                    </div>
                    <div className="detail-item">
                      <label>EPF UAN Number of Persons Engaged:</label>
                      <span>{selectedRegisterDetails.EPFUANofpersonsengaged || 'N/A'}</span>
                    </div>
                  </div>
                </div>

                <div className="details-section">
                  <h4>Payment Information</h4>
                  <div className="details-grid">
                    <div className="detail-item">
                      <label>Proof of Remittance of Profession Tax Amount:</label>
                      <span>{selectedRegisterDetails.ProofofremittanceofProfessionTaxAmount || 'N/A'}</span>
                    </div>
                    <div className="detail-item">
                      <label>Proof of Remittance of Labour Welfare Fund Amount:</label>
                      <span>{selectedRegisterDetails.ProofofremittanceofLabourWelfareFundAmount || 'N/A'}</span>
                    </div>
                    <div className="detail-item">
                      <label>Date of Payment:</label>
                      <span>{formatDate(selectedRegisterDetails.DateofPayment) || 'N/A'}</span>
                    </div>
                    <div className="detail-item">
                      <label>Policy Number:</label>
                      <span>{selectedRegisterDetails.PolicyNumber || 'N/A'}</span>
                    </div>
                  </div>
                </div>

                <div className="details-section">
                  <h4>Date Information</h4>
                  <div className="details-grid">
                    <div className="detail-item">
                      <label>From Date:</label>
                      <span>{formatDate(selectedRegisterDetails.FromDate) || 'N/A'}</span>
                    </div>
                    <div className="detail-item">
                      <label>To Date:</label>
                      <span>{formatDate(selectedRegisterDetails.ToDate) || 'N/A'}</span>
                    </div>
                    <div className="detail-item">
                      <label>Policy From Date:</label>
                      <span>{formatDate(selectedRegisterDetails.PolicyFromDate) || 'N/A'}</span>
                    </div>
                    <div className="detail-item">
                      <label>Policy To Date:</label>
                      <span>{formatDate(selectedRegisterDetails.PolicyToDate) || 'N/A'}</span>
                    </div>
                    <div className="detail-item">
                      <label>Half Yearly Returns Submission Date:</label>
                      <span>{formatDate(selectedRegisterDetails.HalfYearlyReturnsSubmissionDate) || 'N/A'}</span>
                    </div>
                    <div className="detail-item">
                      <label>Proof of Remittance of Profession Tax Payment Date:</label>
                      <span>{formatDate(selectedRegisterDetails.ProofofremittanceofProfessionTaxPaymentDate) || 'N/A'}</span>
                    </div>
                    <div className="detail-item">
                      <label>Form D Bonus Register Submission Date:</label>
                      <span>{formatDate(selectedRegisterDetails.FormDBonusRegisterSubmissionDate) || 'N/A'}</span>
                    </div>
                  </div>
                </div>

                <div className="details-section">
                  <h4>Additional Information</h4>
                  <div className="details-grid">
                    <div className="detail-item">
                      <label>Proof of Remittance of Labour Welfare Fund Receipt Number:</label>
                      <span>{selectedRegisterDetails.ProofofremittanceofLabourWelfareFundReceiptNumber || 'N/A'}</span>
                    </div>
                  </div>
                </div>

                <div className="details-section">
                  <h4>Document Files</h4>
                  <div className="details-grid">
                    <div className="detail-item">
                      <label>Copy of License:</label>
                      <span>
                        {selectedRegisterDetails.CopyofLicensefortheyearFileId && selectedRegisterDetails.CopyofLicensefortheyearFileName ? (
                          <span style={{ color: '#1976d2', cursor: 'pointer' }} onClick={() => downloadFile(selectedRegisterDetails.id, 'CopyofLicensefortheyear', selectedRegisterDetails.CopyofLicensefortheyearFileName)}>
                            {selectedRegisterDetails.CopyofLicensefortheyearFileName}
                          </span>
                        ) : 'No file'}
                      </span>
                    </div>
                    <div className="detail-item">
                      <label>Completion Status:</label>
                      <span>
                        {selectedRegisterDetails.CompletionStatusFileId && selectedRegisterDetails.CompletionStatusFileName ? (
                          <span style={{ color: '#1976d2', cursor: 'pointer' }} onClick={() => downloadFile(selectedRegisterDetails.id, 'CompletionStatus', selectedRegisterDetails.CompletionStatusFileName)}>
                            {selectedRegisterDetails.CompletionStatusFileName}
                          </span>
                        ) : 'No file'}
                      </span>
                    </div>
                    <div className="detail-item">
                      <label>Bank Statement:</label>
                      <span>
                        {selectedRegisterDetails.BankStatementFileId && selectedRegisterDetails.BankStatementFileName ? (
                          <span style={{ color: '#1976d2', cursor: 'pointer' }} onClick={() => downloadFile(selectedRegisterDetails.id, 'BankStatement', selectedRegisterDetails.BankStatementFileName)}>
                            {selectedRegisterDetails.BankStatementFileName}
                          </span>
                        ) : 'No file'}
                      </span>
                    </div>
                    <div className="detail-item">
                      <label>Form C Bonus Register:</label>
                      <span>
                        {selectedRegisterDetails.FormCBonusRegisterFileId && selectedRegisterDetails.FormCBonusRegisterFileName ? (
                          <span style={{ color: '#1976d2', cursor: 'pointer' }} onClick={() => downloadFile(selectedRegisterDetails.id, 'FormCBonusRegisterFileUpload', selectedRegisterDetails.FormCBonusRegisterFileName)}>
                            {selectedRegisterDetails.FormCBonusRegisterFileName}
                          </span>
                        ) : 'No file'}
                      </span>
                    </div>
                    <div className="detail-item">
                      <label>Proof Document:</label>
                      <span>
                        {selectedRegisterDetails.ProofDocumentFileId && selectedRegisterDetails.ProofDocumentFileName ? (
                          <span style={{ color: '#1976d2', cursor: 'pointer' }} onClick={() => downloadFile(selectedRegisterDetails.id, 'ProofDocument', selectedRegisterDetails.ProofDocumentFileName)}>
                            {selectedRegisterDetails.ProofDocumentFileName}
                          </span>
                        ) : 'No file'}
                      </span>
                    </div>
                    <div className="detail-item">
                      <label>Form D Bonus Register:</label>
                      <span>
                        {selectedRegisterDetails.FormDBonusRegisterFileId && selectedRegisterDetails.FormDBonusRegisterFileName ? (
                          <span style={{ color: '#1976d2', cursor: 'pointer' }} onClick={() => downloadFile(selectedRegisterDetails.id, 'FormDBonusRegister', selectedRegisterDetails.FormDBonusRegisterFileName)}>
                            {selectedRegisterDetails.FormDBonusRegisterFileName}
                          </span>
                        ) : 'No file'}
                      </span>
                    </div>
                    <div className="detail-item">
                      <label>ESI Electronic Challan:</label>
                      <span>
                        {selectedRegisterDetails.CopyofESIElectronicChallancumReturnFileId && selectedRegisterDetails.CopyofESIElectronicChallancumReturnFileName ? (
                          <span style={{ color: '#1976d2', cursor: 'pointer' }} onClick={() => downloadFile(selectedRegisterDetails.id, 'CopyofESIElectronicChallancumReturn', selectedRegisterDetails.CopyofESIElectronicChallancumReturnFileName)}>
                            {selectedRegisterDetails.CopyofESIElectronicChallancumReturnFileName}
                          </span>
                        ) : 'No file'}
                      </span>
                    </div>
                    <div className="detail-item">
                      <label>Advances Deductions:</label>
                      <span>
                        {selectedRegisterDetails.AdvancesDeductionsforDamagesLossFinesFileId && selectedRegisterDetails.AdvancesDeductionsforDamagesLossFinesFileName ? (
                          <span style={{ color: '#1976d2', cursor: 'pointer' }} onClick={() => downloadFile(selectedRegisterDetails.id, 'AdvancesDeductionsforDamagesLossFines', selectedRegisterDetails.AdvancesDeductionsforDamagesLossFinesFileName)}>
                            {selectedRegisterDetails.AdvancesDeductionsforDamagesLossFinesFileName}
                          </span>
                        ) : 'No file'}
                      </span>
                    </div>
                    <div className="detail-item">
                      <label>EPF Contribution Challan:</label>
                      <span>
                        {selectedRegisterDetails.EPFContributionRemittanceChallanFileId && selectedRegisterDetails.EPFContributionRemittanceChallanFileName ? (
                          <span style={{ color: '#1976d2', cursor: 'pointer' }} onClick={() => downloadFile(selectedRegisterDetails.id, 'EPFContributionRemittanceChallanFileUpload', selectedRegisterDetails.EPFContributionRemittanceChallanFileName)}>
                            {selectedRegisterDetails.EPFContributionRemittanceChallanFileName}
                          </span>
                        ) : 'No file'}
                      </span>
                    </div>
                    <div className="detail-item">
                      <label>ESI Contribution Challan:</label>
                      <span>
                        {selectedRegisterDetails.ESIContributionRemittanceChallanFileId && selectedRegisterDetails.ESIContributionRemittanceChallanFileName ? (
                          <span style={{ color: '#1976d2', cursor: 'pointer' }} onClick={() => downloadFile(selectedRegisterDetails.id, 'ESIContributionRemittanceChallanFileUpload', selectedRegisterDetails.ESIContributionRemittanceChallanFileName)}>
                            {selectedRegisterDetails.ESIContributionRemittanceChallanFileName}
                          </span>
                        ) : 'No file'}
                      </span>
                    </div>
                    <div className="detail-item">
                      <label>Wageslip:</label>
                      <span>
                        {selectedRegisterDetails.WageslipFileId && selectedRegisterDetails.WageslipFileName ? (
                          <span style={{ color: '#1976d2', cursor: 'pointer' }} onClick={() => downloadFile(selectedRegisterDetails.id, 'WageslipFileUpload', selectedRegisterDetails.WageslipFileName)}>
                            {selectedRegisterDetails.WageslipFileName}
                          </span>
                        ) : 'No file'}
                      </span>
                    </div>
                    <div className="detail-item">
                      <label>Register of Wages:</label>
                      <span>
                        {selectedRegisterDetails.RegisterofwagesFileId && selectedRegisterDetails.RegisterofwagesFileName ? (
                          <span style={{ color: '#1976d2', cursor: 'pointer' }} onClick={() => downloadFile(selectedRegisterDetails.id, 'RegisterofwagesFileUpload', selectedRegisterDetails.RegisterofwagesFileName)}>
                            {selectedRegisterDetails.RegisterofwagesFileName}
                          </span>
                        ) : 'No file'}
                      </span>
                    </div>
                    <div className="detail-item">
                      <label>Half Yearly Returns:</label>
                      <span>
                        {selectedRegisterDetails.HalfyearlyreturnsFileId && selectedRegisterDetails.HalfyearlyreturnsFileName ? (
                          <span style={{ color: '#1976d2', cursor: 'pointer' }} onClick={() => downloadFile(selectedRegisterDetails.id, 'HalfyearlyreturnsFileUpload', selectedRegisterDetails.HalfyearlyreturnsFileName)}>
                            {selectedRegisterDetails.HalfyearlyreturnsFileName}
                          </span>
                        ) : 'No file'}
                      </span>
                    </div>
                    <div className="detail-item">
                      <label>Register of Employment:</label>
                      <span>
                        {selectedRegisterDetails.RegisterOfEmployeement && selectedRegisterDetails.RegisterOfEmployeementFileName ? (
                          <span style={{ color: '#1976d2', cursor: 'pointer' }} onClick={() => downloadFile(selectedRegisterDetails.id, 'RegisterOfEmployeement', selectedRegisterDetails.RegisterOfEmployeementFileName)}>
                            {selectedRegisterDetails.RegisterOfEmployeementFileName}
                          </span>
                        ) : 'No file'}
                      </span>
                    </div>
                    <div className="detail-item">
                      <label>Labour Welfare Fund:</label>
                      <span>
                        {selectedRegisterDetails.remittanceofLabourWelfareFundFileId && selectedRegisterDetails.remittanceofLabourWelfareFundFileName ? (
                          <span style={{ color: '#1976d2', cursor: 'pointer' }} onClick={() => downloadFile(selectedRegisterDetails.id, 'remittanceofLabourWelfareFundFileUpload', selectedRegisterDetails.remittanceofLabourWelfareFundFileName)}>
                            {selectedRegisterDetails.remittanceofLabourWelfareFundFileName}
                          </span>
                        ) : 'No file'}
                      </span>
                    </div>
                    <div className="detail-item">
                      <label>EPF Electronic Challan:</label>
                      <span>
                        {selectedRegisterDetails.EPFElectronicChallanFileId && selectedRegisterDetails.EPFElectronicChallanFileName ? (
                          <span style={{ color: '#1976d2', cursor: 'pointer' }} onClick={() => downloadFile(selectedRegisterDetails.id, 'EPFElectronicChallanFileUpload', selectedRegisterDetails.EPFElectronicChallanFileName)}>
                            {selectedRegisterDetails.EPFElectronicChallanFileName}
                          </span>
                        ) : 'No file'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
          </div>
        </div>
      </div>
    </>
  );
}

export default StatutoryRegisters;
