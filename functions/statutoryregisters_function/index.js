const express = require('express');
const catalystSDK = require('zcatalyst-sdk-node');
const app = express();
const fileUpload = require('express-fileupload');
const fs = require('fs');
const os = require('os');
const path = require('path');
const XLSX = require('xlsx');

app.use(express.json());
app.use(fileUpload());
app.use((req, res, next) => {
    const catalyst = catalystSDK.initialize(req);
    res.locals.catalyst = catalyst;
    next();
});

// Test endpoint to check table structure
app.get('/test-table', async (req, res) => {
  try {
    const { catalyst } = res.locals;
    const zcql = catalyst.zcql();
    
    console.log('Testing table access...');
    
    // Try to get table structure by attempting to insert a test record
    const testData = {
      LicenceNumber: 'TEST123',
      createdTime: new Date().toISOString(),
      modifiedTime: new Date().toISOString()
    };
    
    console.log('Attempting test insert with:', JSON.stringify(testData, null, 2));
    
    try {
      const table = catalyst.datastore().table('Statutory');
      const result = await table.insertRow(testData);
      console.log('Test insert successful:', JSON.stringify(result, null, 2));
      
      res.json({
        message: 'Table exists and test insert successful',
        testData: testData,
        result: result
      });
    } catch (insertError) {
      console.error('Test insert failed:', insertError);
      res.json({
        message: 'Table exists but insert failed',
        error: insertError.message,
        errorCode: insertError.code,
        errorStatusCode: insertError.statusCode
      });
    }
  } catch (error) {
    console.error('Table test error:', error);
    res.status(500).json({
      message: 'Table test failed',
      error: error.message
    });
  }
});

// Test endpoint to check if we can insert data
app.post('/test-insert', async (req, res) => {
  try {
    const { catalyst } = res.locals;
    const table = catalyst.datastore().table('Statutory');
    
    const testData = {
      LicenceNumber: 'TEST123',
      createdTime: new Date().toISOString(),
      modifiedTime: new Date().toISOString()
    };
    
    console.log('Testing insert with data:', JSON.stringify(testData, null, 2));
    
    const result = await table.insertRow(testData);
    
    console.log('Test insert result:', JSON.stringify(result, null, 2));
    
    res.json({
      message: 'Test insert successful',
      result: result
    });
  } catch (error) {
    console.error('Test insert failed:', error);
    res.status(500).json({
      message: 'Test insert failed',
      error: error.message
    });
  }
});

// Test endpoint to check table structure and field names
app.get('/test-table-structure', async (req, res) => {
  try {
    const { catalyst } = res.locals;
    const zcql = catalyst.zcql();
    
    console.log('Testing table structure...');
    
    // Try to get a sample row to see the structure
    const query = `SELECT * FROM Statutory LIMIT 1`;
    console.log('Executing query:', query);
    
    try {
      const result = await zcql.executeZCQLQuery(query);
      console.log('Query result:', JSON.stringify(result, null, 2));
      
      if (result && result.length > 0) {
        const sampleRow = result[0].Statutory;
        console.log('Sample row structure:', Object.keys(sampleRow));
        
        // Check specifically for file fields
        const fileFields = [
          'CopyofLicensefortheyearFileId', 'CopyofLicensefortheyearFileName',
          'CompletionStatusFileId', 'CompletionStatusFileName',
          'BankStatementFileId', 'BankStatementFileName'
        ];
        
        const fileFieldStatus = {};
        fileFields.forEach(field => {
          fileFieldStatus[field] = {
            exists: field in sampleRow,
            value: sampleRow[field],
            type: typeof sampleRow[field]
          };
        });
        
        res.json({
          message: 'Table structure retrieved successfully',
          sampleRow: sampleRow,
          fieldNames: Object.keys(sampleRow),
          fileFieldStatus: fileFieldStatus
        });
      } else {
        res.json({
          message: 'Table exists but no data found',
          fieldNames: []
        });
      }
    } catch (queryError) {
      console.error('Query failed:', queryError);
      res.json({
        message: 'Query failed',
        error: queryError.message,
        errorCode: queryError.code
      });
    }
  } catch (error) {
    console.error('Table structure test error:', error);
    res.status(500).json({
      message: 'Table structure test failed',
      error: error.message
    });
  }
});

// Test endpoint to manually insert file data
app.post('/test-insert-file', async (req, res) => {
  try {
    const { catalyst } = res.locals;
    const table = catalyst.datastore().table('Statutory');
    
    const testData = {
      LicenceNumber: 'TEST_FILE_' + Date.now(),
      CopyofLicensefortheyearFileId: 'test_file_id_123',
      CopyofLicensefortheyearFileName: 'test_file_name.jpg',
      CompletionStatusFileId: 'test_completion_id_456',
      CompletionStatusFileName: 'test_completion_name.pdf',
      CREATEDTIME: new Date().toISOString(),
      MODIFIEDTIME: new Date().toISOString()
    };
    
    console.log('Testing file insert with data:', JSON.stringify(testData, null, 2));
    
    const { ROWID: id } = await table.insertRow(testData);
    
    res.json({
      message: 'Test file insert successful',
      id: id,
      data: testData
    });
  } catch (error) {
    console.error('Test file insert error:', error);
    res.status(500).json({
      message: 'Test file insert failed',
      error: error.message
    });
  }
});

// Statutory Register fields - including file fields for proper editing
const STATUTORY_REGISTER_FIELDS = [
  'LicenceNumber',
  'RegisterofEmploymentNumberofpersons',
  'WagesSlipNumberofpersons',
  'ESIContributionRemittanceChallanNumber',
  'ESIRemittanceDate',
  'ESIIPNumberofpersonsengaged',
  'EPFContributionRemittanceChallanNumber',
  'EPFRemittanceDate',
  'EPFUANofpersonsengaged',
  'PolicyNumber',
  'ProofofremittanceofProfessionTaxAmount',
  'ProofofremittanceofLabourWelfareFundAmount',
  'DateofPayment',
  'Month_fliter',
  'Year',
  'Contractor',
  'ApprovalStatus',
  'FromDate',
  'ToDate',
  'PolicyFromDate',
  'PolicyToDate',
  'HalfYearlyReturnsSubmissionDate',
  'ProofofremittanceofProfessionTaxPaymentDate',
  'ProofofremittanceofLabourWelfareFundReceiptNumber',
  'ProofofremittanceofLabourWelfareFundRegNumber',
  'FormDBonusRegisterSubmissionDate',
  // File fields for editing - both FileId and FileName
  'CopyofLicensefortheyearFileId',
  'CopyofLicensefortheyearFileName',
  'CompletionStatusFileId',
  'CompletionStatusFileName',
  'BankStatementFileId',
  'BankStatementFileName',
  'FormCBonusRegisterFileId',
  'FormCBonusRegisterFileName',
  'ProofDocumentFileId',
  'ProofDocumentFileName',
  'FormDBonusRegisterFileId',
  'FormDBonusRegisterFileName',
  'CopyofESIElectronicChallancumReturnFileId',
  'CopyofESIElectronicChallancumReturnFileName',
  'AdvancesDeductionsforDamagesLossFinesFileId',
  'AdvancesDeductionsforDamagesLossFinesFileName',
  'EPFContributionRemittanceChallanFileId',
  'EPFContributionRemittanceChallanFileName',
  'ESIContributionRemittanceChallanFileId',
  'ESIContributionRemittanceChallanFileName',
  'WageslipFileId',
  'WageslipFileName',
  'RegisterofwagesFileId',
  'RegisterofwagesFileName',
  'HalfyearlyreturnsFileId',
  'HalfyearlyreturnsFileName',
  'RegisterOfEmployeement',
  'RegisterOfEmployeementFileName',
  'remittanceofLabourWelfareFundFileId',
  'remittanceofLabourWelfareFundFileName',
  'remittanceofProfessionTaxFileFileId',
  'remittanceofProfessionTaxFileFileName',
  'EPFElectronicChallanFileId',
  'EPFElectronicChallanFileName'
];

// File upload types
const FILE_UPLOAD_TYPES = [
  'CopyofLicensefortheyear',
  'CompletionStatus',
  'BankStatement',
  'FormCBonusRegister',
  'ProofDocument',
  'FormDBonusRegister',
  'CopyofESIElectronicChallancumReturn',
  'AdvancesDeductionsforDamagesLossFines',
  'EPFContributionRemittanceChallan',
  'ESIContributionRemittanceChallan',
  'Wageslip',
  'Registerofwages',
  'Halfyearlyreturns',
  'RegisterOfEmployeement',
  'remittanceofLabourWelfareFund',
  'EPFElectronicChallan'
];

// Mapping of document types to Catalyst File Store folder IDs (matching your file store)
const DOC_TYPE_TO_FOLDER_ID = {
  'CopyofLicensefortheyear': '21320000000053992',
  'CompletionStatus': '21320000000053964', 
  'BankStatement': '21320000000053945',
  'FormCBonusRegisterFileUpload': '21320000000053917',
  'ProofDocument': '21320000000053898',
  'FormDBonusRegister': '21320000000053870',
  'CopyofESIElectronicChallancumReturn': '21320000000053851',
  'AdvancesDeductionsforDamagesLossFines': '21320000000053823',
  'EPFContributionRemittanceChallanFileUpload': '21320000000053804',
  'ESIContributionRemittanceChallanFileUpload': '21320000000053776',
  'WageslipFileUpload': '21320000000053739',
  'RegisterofwagesFileUpload': '21320000000053720',
  'HalfyearlyreturnsFileUpload': '21320000000053692',
  'RegisterOfEmployeement': '21320000000053673',
  'remittanceofLabourWelfareFundFileUpload': '21320000000053645',
  'remittanceofProfessionTaxFileUpload': '21320000000053626',
  'EPFElectronicChallanFileUpload': '21320000000053598'
};

// Helper function to get file columns for a docType (both FileId and FileName)
function getFileColumns(docType) {
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
  
  console.log('getFileColumns called with docType:', docType);
  console.log('Available docTypes:', Object.keys(fileColumns));
  const result = fileColumns[docType] || [];
  console.log('getFileColumns result:', result);
  return result;
}

// Helper function to get content type
const getContentType = (filename) => {
  const ext = path.extname(filename).toLowerCase();
  const contentTypes = {
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.txt': 'text/plain'
  };
  return contentTypes[ext] || 'application/octet-stream';
};

// Helper function to parse numeric values
const parseNumeric = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const num = parseFloat(value);
  return isNaN(num) ? null : num;
};

// Helper function to parse date values
const parseDate = (value) => {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return value.toISOString().split('T')[0];
  if (typeof value === 'string') {
    const date = new Date(value);
    return isNaN(date.getTime()) ? null : date.toISOString().split('T')[0];
  }
  return null;
};

// Helper function to sanitize string values
const sanitizeString = (value) => {
  if (value === null || value === undefined) return '';
  return String(value).trim();
};

// Helper function to check if register belongs to contractor
function registerBelongsToContractor(register, allowedContractor) {
  if (!allowedContractor || !register.Contractor) {
    return true; // If no contractor filter or no contractor in register, allow access
  }
  
  const registerContractor = (register.Contractor || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const normalizedAllowedContractor = allowedContractor.replace(/\s+/g, ' ').trim().toLowerCase();
  const contractorWords = normalizedAllowedContractor.split(' ').filter(w => w.length > 2);
  
  // Try exact match first
  if (registerContractor === normalizedAllowedContractor) return true;
  
  // Try matching key words (handles variations)
  if (contractorWords.length > 0) {
    const allKeyWordsMatch = contractorWords.every(word => registerContractor.includes(word));
    if (allKeyWordsMatch) {
      const firstWord = contractorWords[0];
      const registerFirstWord = registerContractor.split(' ')[0];
      if (registerFirstWord && (registerFirstWord.startsWith(firstWord) || firstWord.startsWith(registerFirstWord))) {
        return true;
      }
    }
  }
  
  // Check if contractor name includes or is included in allowed contractor
  return registerContractor.includes(normalizedAllowedContractor) || normalizedAllowedContractor.includes(registerContractor);
}

// Helper function to get contractor from userEmail
function getContractorFromEmail(userEmail) {
  if (userEmail === "afrindinusha29@gmail.com" || userEmail === "sriramenterprises50@yahoo.com") {
    return "Sriram Enterprises";
  } else if (userEmail === "afrindinusha@gmail.com" || userEmail === "rpdmanpowerservice@gmail.com" || userEmail === "ramachandran23488@gmail.com") {
    return "R.P.D Facility Management Services";
  } else if (userEmail === "afrinatlin@gmail.com" || userEmail === "samuelenterprisesms@gmail.com") {
    return "Samuel Enterprise";
  } else if (userEmail === "dinushaafrin@gmail.com" || userEmail === "vijaybalaji701@gmail.com") {
    return "Sri Balaji Enterprises";
  } else if (userEmail === "afrindinu14@gmail.com" || userEmail === "vaishnavi.a@buildhr.co.in") {
    return "Yashaswi Academy for Skills";
  }
  return null;
}

// GET /registers - Fetch all statutory registers
app.get('/registers', async (req, res) => {
  try {
    const { catalyst } = res.locals;
    const zcql = catalyst.zcql();
    
    const { page = 1, perPage = 50, userRole, userEmail } = req.query;
    const limit = parseInt(perPage);
    const offset = (parseInt(page) - 1) * limit;
    
    // Build WHERE clause for contractor filtering
    let whereClause = '';
    let countWhereClause = '';
    
    // Determine contractor for App Users
    let allowedContractor = null;
    if (userRole === 'App User' && userEmail) {
      allowedContractor = getContractorFromEmail(userEmail);
      console.log('App User contractor filter:', allowedContractor);
    }
    
    // If user is Contractor, filter by contractor email
    if (userRole === 'Contractor' && userEmail) {
      whereClause = `WHERE contractor = '${userEmail}'`;
      countWhereClause = `WHERE contractor = '${userEmail}'`;
    }
    
    // Check if we should return all records (no pagination)
    const returnAll = !req.query.page && !req.query.perPage;
    
    // Build LIMIT clause
    const limitClause = returnAll ? '' : `LIMIT ${(page - 1) * perPage + 1},${perPage}`;
    
    // Fetch registers (for App Users, fetch all first to filter by contractor)
    const query = `SELECT * FROM Statutory ${whereClause} ORDER BY ROWID DESC ${returnAll ? '' : ''}`;
    console.log('Data query:', query);
    const result = await zcql.executeZCQLQuery(query);
    let registers = result.map(row => row.Statutory) || [];
    
    // Filter by contractor for App Users (after fetching)
    if (userRole === 'App User' && allowedContractor) {
      const originalCount = registers.length;
      registers = registers.filter(register => registerBelongsToContractor(register, allowedContractor));
      console.log(`Filtered registers for contractor ${allowedContractor}: ${registers.length} out of ${originalCount}`);
    }
    
    // Apply pagination after filtering (for App Users)
    if (!returnAll && (userRole === 'App User' && allowedContractor)) {
      const startIndex = (page - 1) * perPage;
      const endIndex = startIndex + perPage;
      registers = registers.slice(startIndex, endIndex);
    } else if (!returnAll) {
      // For other roles, pagination is already applied in SQL
      // No need to slice again
    }
    
    // Get total count for pagination
    let total = 0;
    if (userRole === 'App User' && allowedContractor) {
      // For App Users, total is the filtered count
      const allResult = await zcql.executeZCQLQuery(`SELECT * FROM Statutory ORDER BY ROWID DESC`);
      const allRegisters = allResult.map(row => row.Statutory) || [];
      const filteredCount = allRegisters.filter(register => registerBelongsToContractor(register, allowedContractor)).length;
      total = filteredCount;
    } else {
      const countQuery = `SELECT COUNT(ROWID) as count FROM Statutory ${countWhereClause}`;
      console.log('Count query:', countQuery);
      const countRows = await zcql.executeZCQLQuery(countQuery);
      console.log('Count query result:', JSON.stringify(countRows, null, 2));
      
      if (countRows && countRows.length > 0) {
        // Try different possible structures for the count result
        if (countRows[0].Statutory && countRows[0].Statutory.count) {
          total = parseInt(countRows[0].Statutory.count);
        } else if (countRows[0].count) {
          total = parseInt(countRows[0].count);
        } else if (countRows[0].COUNT) {
          total = parseInt(countRows[0].COUNT);
        } else {
          console.error('Invalid count result structure:', countRows[0]);
          total = registers.length;
        }
      } else {
        console.error('No count result:', countRows);
        total = registers.length;
      }
    }
    
    console.log('Total count:', total);
    
    console.log('GET /registers - Query result count:', result.length);
    console.log('GET /registers - Mapped registers count:', registers.length);
    console.log('GET /registers - Total count:', total);
    
    // Debug: Log sample register data to see what fields are available
    if (registers.length > 0) {
      console.log('Sample register data:', JSON.stringify(registers[0], null, 2));
      console.log('Available fields in register:', Object.keys(registers[0]));
      
      // Specifically check file fields
      const sampleRegister = registers[0];
      console.log('File field values in sample register from database:');
      console.log('CopyofLicensefortheyearFileId:', sampleRegister.CopyofLicensefortheyearFileId);
      console.log('CopyofLicensefortheyearFileName:', sampleRegister.CopyofLicensefortheyearFileName);
      console.log('CompletionStatusFileId:', sampleRegister.CompletionStatusFileId);
      console.log('CompletionStatusFileName:', sampleRegister.CompletionStatusFileName);
    }
    
    const hasMore = returnAll ? false : page * perPage < total;
    
    res.json({
      data: {
        registers,
        total,
        hasMore,
        page: parseInt(page),
        perPage: limit
      }
    });
  } catch (error) {
    console.error('Error fetching registers:', error);
    res.status(500).json({
      message: 'Failed to fetch statutory registers',
      error: error.message
    });
  }
});

// POST /registers - Create new statutory register
app.post('/registers', async (req, res) => {
  try {
    const { catalyst } = res.locals;
    const table = catalyst.datastore().table('Statutory');
    
    // Extract fields from request body (including file fields)
    const {
      LicenceNumber,
      RegisterofEmploymentNumberofpersons,
      WagesSlipNumberofpersons,
      ESIContributionRemittanceChallanNumber,
      ESIRemittanceDate,
      ESIIPNumberofpersonsengaged,
      EPFContributionRemittanceChallanNumber,
      EPFRemittanceDate,
      EPFUANofpersonsengaged,
      PolicyNumber,
      ProofofremittanceofProfessionTaxAmount,
      ProofofremittanceofLabourWelfareFundAmount,
      DateofPayment,
      Month_fliter,
      Year,
      Contractor,
      ApprovalStatus,
      FromDate,
      ToDate,
      PolicyFromDate,
      PolicyToDate,
      HalfYearlyReturnsSubmissionDate,
      ProofofremittanceofProfessionTaxPaymentDate,
      ProofofremittanceofLabourWelfareFundReceiptNumber,
      FormDBonusRegisterSubmissionDate,
      // File fields
      CopyofLicensefortheyearFileId,
      CopyofLicensefortheyearFileName,
      CompletionStatusFileId,
      CompletionStatusFileName,
      BankStatementFileId,
      BankStatementFileName,
      FormCBonusRegisterFileId,
      FormCBonusRegisterFileName,
      ProofDocumentFileId,
      ProofDocumentFileName,
      FormDBonusRegisterFileId,
      FormDBonusRegisterFileName,
      CopyofESIElectronicChallancumReturnFileId,
      CopyofESIElectronicChallancumReturnFileName,
      AdvancesDeductionsforDamagesLossFinesFileId,
      AdvancesDeductionsforDamagesLossFinesFileName,
      EPFContributionRemittanceChallanFileId,
      EPFContributionRemittanceChallanFileName,
      ESIContributionRemittanceChallanFileId,
      ESIContributionRemittanceChallanFileName,
      WageslipFileId,
      WageslipFileName,
      RegisterofwagesFileId,
      RegisterofwagesFileName,
      HalfyearlyreturnsFileId,
      HalfyearlyreturnsFileName,
      RegisterOfEmployeement,
      RegisterOfEmployeementFileName,
      remittanceofLabourWelfareFundFileId,
      remittanceofLabourWelfareFundFileName,
      remittanceofProfessionTaxFileFileId,
      remittanceofProfessionTaxFileFileName,
      EPFElectronicChallanFileId,
      EPFElectronicChallanFileName
    } = req.body;

    // Helper function to parse numeric fields (same as EmployeeManagement)
    const parseNumeric = (value) => {
      if (value == null) return null;
      if (typeof value === 'number') return value;
      if (typeof value === 'string') {
        if (value.trim() === '') return null;
        const parsed = parseInt(value.trim(), 10);
        return isNaN(parsed) ? null : parsed;
      }
      const strValue = String(value).trim();
      if (strValue === '') return null;
      const parsed = parseInt(strValue, 10);
      return isNaN(parsed) ? null : parsed;
    };

    // Insert new statutory register row (start with basic fields only)
    const insertData = {
      LicenceNumber: LicenceNumber || null,
      RegisterofEmploymentNumberofpersons: parseNumeric(RegisterofEmploymentNumberofpersons),
      WagesSlipNumberofpersons: parseNumeric(WagesSlipNumberofpersons),
      ESIContributionRemittanceChallanNumber: ESIContributionRemittanceChallanNumber || null,
      ESIRemittanceDate: ESIRemittanceDate || null,
      ESIIPNumberofpersonsengaged: parseNumeric(ESIIPNumberofpersonsengaged),
      EPFContributionRemittanceChallanNumber: EPFContributionRemittanceChallanNumber || null,
      EPFRemittanceDate: EPFRemittanceDate || null,
      EPFUANofpersonsengaged: parseNumeric(EPFUANofpersonsengaged),
      PolicyNumber: PolicyNumber || null,
      ProofofremittanceofProfessionTaxAmount: parseNumeric(ProofofremittanceofProfessionTaxAmount),
      ProofofremittanceofLabourWelfareFundAmount: parseNumeric(ProofofremittanceofLabourWelfareFundAmount),
      DateofPayment: DateofPayment || null,
      Month_fliter: Month_fliter || null,
      Year: parseNumeric(Year),
      Contractor: Contractor || null,
      ApprovalStatus: ApprovalStatus || null,
      FromDate: FromDate || null,
      ToDate: ToDate || null,
      PolicyFromDate: PolicyFromDate || null,
      PolicyToDate: PolicyToDate || null,
      HalfYearlyReturnsSubmissionDate: HalfYearlyReturnsSubmissionDate || null,
      ProofofremittanceofProfessionTaxPaymentDate: ProofofremittanceofProfessionTaxPaymentDate || null,
      ProofofremittanceofLabourWelfareFundReceiptNumber: ProofofremittanceofLabourWelfareFundReceiptNumber || null,
      FormDBonusRegisterSubmissionDate: FormDBonusRegisterSubmissionDate || null,
      CREATEDTIME: new Date().toISOString(),
      MODIFIEDTIME: new Date().toISOString()
    };

    // Add file fields only if they exist and have values
    const fileFields = [
      'CopyofLicensefortheyearFileId',
      'CopyofLicensefortheyearFileName',
      'CompletionStatusFileId',
      'CompletionStatusFileName',
      'BankStatementFileId',
      'BankStatementFileName',
      'FormCBonusRegisterFileId',
      'FormCBonusRegisterFileName',
      'ProofDocumentFileId',
      'ProofDocumentFileName',
      'FormDBonusRegisterFileId',
      'FormDBonusRegisterFileName',
      'CopyofESIElectronicChallancumReturnFileId',
      'CopyofESIElectronicChallancumReturnFileName',
      'AdvancesDeductionsforDamagesLossFinesFileId',
      'AdvancesDeductionsforDamagesLossFinesFileName',
      'EPFContributionRemittanceChallanFileId',
      'EPFContributionRemittanceChallanFileName',
      'ESIContributionRemittanceChallanFileId',
      'ESIContributionRemittanceChallanFileName',
      'WageslipFileId',
      'WageslipFileName',
      'RegisterofwagesFileId',
      'RegisterofwagesFileName',
      'HalfyearlyreturnsFileId',
      'HalfyearlyreturnsFileName',
      'RegisterOfEmployeement',
      'RegisterOfEmployeementFileName',
      'remittanceofLabourWelfareFundFileId',
      'remittanceofLabourWelfareFundFileName',
      'remittanceofProfessionTaxFileFileId',
      'remittanceofProfessionTaxFileFileName',
      'EPFElectronicChallanFileId',
      'EPFElectronicChallanFileName'
    ];

    // Only add file fields that have values
    fileFields.forEach(field => {
      if (req.body[field] && req.body[field].trim() !== '') {
        insertData[field] = req.body[field];
        console.log(`Adding file field ${field}: ${req.body[field]}`);
      } else {
        console.log(`Skipping file field ${field}: ${req.body[field]} (empty or undefined)`);
      }
    });

    console.log('Inserting data:', JSON.stringify(insertData, null, 2));
    
    // Debug: Check file fields specifically
    const fileFieldsInData = Object.keys(insertData).filter(key => 
      key.includes('FileId') || key.includes('FileName')
    );
    console.log('File fields in insert data:', fileFieldsInData);
    console.log('File field values:', fileFieldsInData.map(key => ({ [key]: insertData[key] })));
    
    const { ROWID: id } = await table.insertRow(insertData);
    
    res.json({
      data: { ROWID: id },
      message: 'Statutory register created successfully'
    });
  } catch (error) {
    console.error('Error creating register:', error);
    res.status(500).json({
      message: 'Failed to create statutory register',
      error: error.message
    });
  }
});

// PUT /registers/:id - Update statutory register
app.put('/registers/:id', async (req, res) => {
  try {
    const { catalyst } = res.locals;
    const table = catalyst.datastore().table('Statutory');
    const userEmail = req.query.userEmail;
    const userRole = req.query.userRole;
    
    const registerId = req.params.id;
    const registerData = {};
    
    // Check contractor access for App Users
    if (userRole === 'App User' && userEmail) {
      const allowedContractor = getContractorFromEmail(userEmail);
      if (allowedContractor) {
        // Get existing register to check contractor
        const zcql = catalyst.zcql();
        const existingResult = await zcql.executeZCQLQuery(
          `SELECT ROWID, Contractor FROM Statutory WHERE ROWID = ${registerId}`
        );
        
        if (existingResult.length === 0) {
          return res.status(404).json({
            message: 'Statutory register not found'
          });
        }
        
        const existingRegister = existingResult[0].Statutory;
        const hasAccess = registerBelongsToContractor(existingRegister, allowedContractor);
        if (!hasAccess) {
          return res.status(403).json({
            message: 'You do not have access to update this statutory register.'
          });
        }
      }
    }
    
    console.log('=== UPDATE REGISTER DEBUG START ===');
    console.log('Updating register ID:', registerId);
    console.log('Request body keys:', Object.keys(req.body));
    console.log('Request body:', JSON.stringify(req.body, null, 2));
    
    // Process all fields
    STATUTORY_REGISTER_FIELDS.forEach(field => {
      if (req.body[field] !== undefined) {
        if (field.includes('Date') || field.includes('date')) {
          registerData[field] = parseDate(req.body[field]);
        } else if (field.includes('Amount') || (field.includes('Number') && !field.includes('RegNumber')) || field.includes('persons')) {
          registerData[field] = parseNumeric(req.body[field]);
        } else {
          registerData[field] = sanitizeString(req.body[field]);
        }
        console.log(`Processing field ${field}:`, req.body[field], '->', registerData[field]);
      }
    });
    
    // Check specifically for file fields
    const fileFields = Object.keys(req.body).filter(key => 
      key.includes('FileId') || key.includes('FileName')
    );
    console.log('File fields in request:', fileFields);
    console.log('File field values:', fileFields.map(key => ({ [key]: req.body[key] })));
    
    // Add modified timestamp
    registerData.modifiedTime = new Date().toISOString();
    
    console.log('Final register data to update:', registerData);
    
    const result = await table.updateRow({
      ROWID: registerId,
      ...registerData
    });
    
    console.log('Update result:', result);
    console.log('=== UPDATE REGISTER DEBUG END ===');
    
    res.json({
      data: result,
      message: 'Statutory register updated successfully'
    });
  } catch (error) {
    console.error('=== UPDATE REGISTER ERROR ===');
    console.error('Error updating register:', error);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    console.error('Register ID:', registerId);
    console.error('Register data that failed:', registerData);
    res.status(500).json({
      message: 'Failed to update statutory register',
      error: error.message,
      details: error.stack
    });
  }
});

// DELETE /registers/:id - Delete statutory register
app.delete('/registers/:id', async (req, res) => {
  try {
    const { catalyst } = res.locals;
    const table = catalyst.datastore().table('Statutory');
    const userEmail = req.query.userEmail;
    const userRole = req.query.userRole;
    
    const registerId = req.params.id;
    console.log('=== DELETE REGISTER REQUEST START ===');
    console.log('Deleting register with ID:', registerId);
    console.log('Request params:', req.params);
    console.log('Request body:', req.body);
    
    // First, check if the register exists and check contractor access for App Users
    try {
      const zcql = catalyst.zcql();
      const existingResult = await zcql.executeZCQLQuery(
        `SELECT ROWID, Contractor FROM Statutory WHERE ROWID = ${registerId}`
      );
      
      if (existingResult.length === 0) {
        return res.status(404).json({
          message: `Register with ID ${registerId} not found`
        });
      }
      
      const existingRegister = existingResult[0].Statutory;
      console.log('Register exists, proceeding with deletion:', existingRegister);
      
      // Check contractor access for App Users
      if (userRole === 'App User' && userEmail) {
        const allowedContractor = getContractorFromEmail(userEmail);
        if (allowedContractor) {
          const hasAccess = registerBelongsToContractor(existingRegister, allowedContractor);
          if (!hasAccess) {
            return res.status(403).json({
              message: 'You do not have access to delete this statutory register.'
            });
          }
        }
      }
    } catch (getRowError) {
      console.error('Register not found or error getting register:', getRowError);
      return res.status(404).json({
        message: `Register with ID ${registerId} not found`,
        error: getRowError.message
      });
    }
    
    // Delete the register
    console.log('Attempting to delete register...');
    const deleteResult = await table.deleteRow(registerId);
    console.log('Delete result:', deleteResult);
    
    console.log('=== DELETE REGISTER REQUEST END ===');
    res.json({
      message: 'Statutory register deleted successfully',
      deletedId: registerId
    });
  } catch (error) {
    console.error('=== DELETE REGISTER ERROR ===');
    console.error('Error deleting register:', error);
    console.error('Error message:', error.message);
    console.error('Error code:', error.code);
    console.error('Error statusCode:', error.statusCode);
    console.error('Register ID that failed to delete:', req.params.id);
    console.error('=== DELETE REGISTER ERROR END ===');
    
    res.status(500).json({
      message: 'Failed to delete statutory register',
      error: error.message,
      registerId: req.params.id
    });
  }
});

// DELETE /registers - Delete multiple statutory registers
app.delete('/registers', async (req, res) => {
  try {
    const { catalyst } = res.locals;
    const table = catalyst.datastore().table('Statutory');
    
    const { ids } = req.body;
    console.log('=== MASS DELETE REQUEST START ===');
    console.log('Deleting registers with IDs:', ids);
    console.log('Request body:', req.body);
    
    if (!ids || !Array.isArray(ids)) {
      console.error('Invalid request: IDs array is required');
      return res.status(400).json({
        message: 'Invalid request. IDs array is required.'
      });
    }
    
    if (ids.length === 0) {
      console.error('Invalid request: Empty IDs array');
      return res.status(400).json({
        message: 'Invalid request. At least one ID is required.'
      });
    }
    
    console.log('Attempting to delete multiple registers...');
    
    // Delete multiple registers
    const deletePromises = ids.map(async (id) => {
      try {
        console.log(`Deleting register with ID: ${id}`);
        const result = await table.deleteRow(id);
        console.log(`Successfully deleted register ${id}:`, result);
        return { id, success: true, result };
      } catch (deleteError) {
        console.error(`Failed to delete register ${id}:`, deleteError);
        return { id, success: false, error: deleteError.message };
      }
    });
    
    const results = await Promise.all(deletePromises);
    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);
    
    console.log('Delete results:', { successful: successful.length, failed: failed.length });
    console.log('Successful deletions:', successful.map(r => r.id));
    console.log('Failed deletions:', failed.map(r => ({ id: r.id, error: r.error })));
    
    if (failed.length > 0) {
      console.error('Some deletions failed:', failed);
      return res.status(207).json({
        message: `${successful.length} registers deleted successfully, ${failed.length} failed`,
        successful: successful.map(r => r.id),
        failed: failed.map(r => ({ id: r.id, error: r.error }))
      });
    }
    
    console.log('=== MASS DELETE REQUEST END ===');
    res.json({
      message: `${ids.length} statutory registers deleted successfully`,
      deletedIds: ids
    });
  } catch (error) {
    console.error('=== MASS DELETE ERROR ===');
    console.error('Error deleting registers:', error);
    console.error('Error message:', error.message);
    console.error('Request body:', req.body);
    console.error('=== MASS DELETE ERROR END ===');
    
    res.status(500).json({
      message: 'Failed to delete statutory registers',
      error: error.message
    });
  }
});

// Download file for register and docType
app.get('/registers/:id/file/:docType', async (req, res) => {
  try {
    const { id, docType } = req.params;
    console.log('=== DOWNLOAD REQUEST START ===');
    console.log('Download request:', { id, docType });
    console.log('Available docTypes:', Object.keys(DOC_TYPE_TO_FOLDER_ID));
    
    const { catalyst } = res.locals;
    const folderId = DOC_TYPE_TO_FOLDER_ID[docType];
    console.log('Folder ID for docType:', docType, 'is:', folderId);
    
    if (!folderId) {
      console.error('Invalid document type:', docType);
      console.error('Available docTypes:', Object.keys(DOC_TYPE_TO_FOLDER_ID));
      return res.status(400).json({ 
        status: 'failure', 
        message: `Invalid document type: ${docType}. Available types: ${Object.keys(DOC_TYPE_TO_FOLDER_ID).join(', ')}` 
      });
    }
    
    console.log('Getting register from database...');
    const table = catalyst.datastore().table('Statutory');
    const register = await table.getRow(id);
    console.log('Register found:', register);
    
    const fileColumns = getFileColumns(docType);
    console.log('File columns for docType:', docType, 'are:', fileColumns);
    
    if (!fileColumns || fileColumns.length === 0) {
      console.error('No file columns found for docType:', docType);
      return res.status(400).json({ 
        status: 'failure', 
        message: `Invalid document type: ${docType}. No file columns found.` 
      });
    }
    
    const fileId = register[fileColumns[0]];
    const fileName = register[fileColumns[1]] || `${docType}_file`; // Use stored filename or default
    
    console.log('File info:', { fileId, fileName, fileColumns });
    if (!fileId) {
      console.error('No file ID found for register:', id, 'docType:', docType);
      return res.status(404).json({ 
        status: 'failure', 
        message: `File not found for this register. FileId: ${fileId}, FileName: ${fileName}` 
      });
    }
    
    console.log('Downloading file from Catalyst File Store...');
    const fileBuffer = await catalyst.filestore().folder(folderId).downloadFile(fileId);
    console.log('File downloaded successfully, size:', fileBuffer.length);
    
    // Determine content type based on file extension
    const getContentType = (filename) => {
      const ext = filename.toLowerCase().split('.').pop();
      const contentTypes = {
        'pdf': 'application/pdf',
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'png': 'image/png',
        'doc': 'application/msword',
        'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'txt': 'text/plain',
        'xls': 'application/vnd.ms-excel',
        'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      };
      return contentTypes[ext] || 'application/octet-stream';
    };
    
    const contentType = getContentType(fileName);
    
    console.log('Sending file response:', { fileName, contentType, fileSize: fileBuffer.length });
    
    // Set headers
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', fileBuffer.length);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Pragma', 'no-cache');
    
    // Send the file
    res.send(fileBuffer);
    console.log('File download completed successfully for:', fileName);
    console.log('=== DOWNLOAD REQUEST END ===');
  } catch (err) {
    console.error('=== DOWNLOAD ERROR ===');
    console.error('Download error:', err);
    console.error('Error message:', err.message);
    console.error('Error stack:', err.stack);
    console.error('Request params:', req.params);
    console.error('=== DOWNLOAD ERROR END ===');
    
    res.status(500).json({ 
      status: 'failure', 
      message: err.message || 'File download failed.',
      error: err.toString()
    });
  }
});

// Upload file for new register (before creation)
app.post('/registers/upload/:docType', async (req, res) => {
  try {
    const { docType } = req.params;
    console.log('New register file upload request for docType:', docType);
    const { catalyst } = res.locals;
    const folderId = DOC_TYPE_TO_FOLDER_ID[docType];
    console.log('Folder ID for docType:', docType, 'is:', folderId);
    
    if (!folderId) {
      console.error('Invalid document type:', docType);
      return res.status(400).send({ status: 'failure', message: 'Invalid document type.' });
    }
    
    if (!req.files || !req.files.file) {
      console.error('No file uploaded for docType:', docType);
      return res.status(400).send({ status: 'failure', message: 'No file uploaded.' });
    }
    
    const file = req.files.file;
    const tempDir = os.tmpdir();
    const tempPath = path.join(tempDir, file.name);
    
    try {
      await file.mv(tempPath);
      const uploadResp = await catalyst.filestore().folder(folderId).uploadFile({
        code: fs.createReadStream(tempPath),
        name: file.name
      });

      // Clean up temporary file
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }

      // Handle different possible response structures
      let fileId, fileName;
      if (Array.isArray(uploadResp) && uploadResp[0]?.id) {
        fileId = uploadResp[0].id;
        fileName = file.name;
      } else if (uploadResp && uploadResp.id) {
        fileId = uploadResp.id;
        fileName = file.name;
      } else if (uploadResp && uploadResp.file_details && uploadResp.file_details[0]?.id) {
        fileId = uploadResp.file_details[0].id;
        fileName = file.name;
      } else {
        console.error('Unexpected upload response (new register):', uploadResp);
        return res.status(500).send({ status: 'failure', message: 'File upload failed or invalid response from Catalyst.' });
      }

      res.status(200).send({ status: 'success', fileId, fileName });
    } catch (uploadErr) {
      // Clean up temporary file in case of error
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
      throw uploadErr;
    }
  } catch (err) {
    console.log('Upload error (new register):', err);
    res.status(500).send({ status: 'failure', message: err.message || 'File upload failed.' });
  }
});

// Upload file for existing register and docType
app.post('/registers/:id/file/:docType', async (req, res) => {
  try {
    const { id, docType } = req.params;
    console.log('Register file upload request for id:', id, 'docType:', docType);
    console.log('Available docTypes:', Object.keys(DOC_TYPE_TO_FOLDER_ID));
    const { catalyst } = res.locals;
    const folderId = DOC_TYPE_TO_FOLDER_ID[docType];
    console.log('Folder ID for docType:', docType, 'is:', folderId);
    
    if (!folderId) {
      console.error('Invalid document type:', docType);
      console.error('Available docTypes:', Object.keys(DOC_TYPE_TO_FOLDER_ID));
      return res.status(400).send({ status: 'failure', message: `Invalid document type: ${docType}. Available types: ${Object.keys(DOC_TYPE_TO_FOLDER_ID).join(', ')}` });
    }
    
    if (!req.files || !req.files.file) {
      console.error('No file uploaded for register id:', id, 'docType:', docType);
      return res.status(400).send({ status: 'failure', message: 'No file uploaded.' });
    }
    
    const file = req.files.file;
    const tempDir = os.tmpdir();
    const tempPath = path.join(tempDir, file.name);
    
    try {
      console.log('Moving file to temp path:', tempPath);
      await file.mv(tempPath);
      console.log('File moved successfully, uploading to Catalyst...');
      
      const uploadResp = await catalyst.filestore().folder(folderId).uploadFile({
        code: fs.createReadStream(tempPath),
        name: file.name
      });

      console.log('Catalyst upload response:', JSON.stringify(uploadResp, null, 2));

      // Clean up temporary file
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
        console.log('Temporary file cleaned up');
      }

      // Handle different possible response structures
      let fileId, fileName;
      if (Array.isArray(uploadResp) && uploadResp[0]?.id) {
        fileId = uploadResp[0].id;
        fileName = file.name;
        console.log('Using array response structure');
      } else if (uploadResp && uploadResp.id) {
        fileId = uploadResp.id;
        fileName = file.name;
        console.log('Using direct response structure');
      } else if (uploadResp && uploadResp.file_details && uploadResp.file_details[0]?.id) {
        fileId = uploadResp.file_details[0].id;
        fileName = file.name;
        console.log('Using file_details response structure');
      } else {
        console.error('Unexpected upload response structure:', uploadResp);
        return res.status(500).send({ status: 'failure', message: 'File upload failed or invalid response from Catalyst.' });
      }
      
      console.log('Extracted file info:', { fileId, fileName });
      console.log('Original file name from upload:', file.name);
      console.log('File name being stored:', fileName);

      // If id is 'temp', just return the file info without updating database
      if (id === 'temp') {
        console.log('Returning file info for temp upload:', { fileId, fileName });
        res.status(200).send({ status: 'success', fileId, fileName });
        return;
      }

      // For existing registers, update the database
      const fileColumns = getFileColumns(docType);
      console.log('File columns for docType:', docType, 'are:', fileColumns);
      
      if (fileColumns.length >= 1) {
        const table = catalyst.datastore().table('Statutory');
        
        // First, try to get the existing row to verify it exists
        try {
          const existingRow = await table.getRow(id);
          console.log('Existing row found:', existingRow);
        } catch (getRowError) {
          console.error('Failed to get existing row:', getRowError);
          return res.status(404).send({ status: 'failure', message: `Register with ID ${id} not found.` });
        }
        
        const updateData = {
          ROWID: id, // Keep ROWID as string (as used in other functions)
          [fileColumns[0]]: fileId  // FileId
        };
        
        // If we have a fileName column, add it too
        if (fileColumns.length >= 2) {
          updateData[fileColumns[1]] = fileName;
        }
        console.log('Updating database with:', updateData);
        console.log('ROWID type:', typeof updateData.ROWID, 'value:', updateData.ROWID);
        
        try {
          await table.updateRow(updateData);
          console.log('Database update successful');
        } catch (updateError) {
          console.error('Database update failed:', updateError);
          console.error('Update data that failed:', updateData);
          console.error('Error details:', {
            message: updateError.message,
            code: updateError.code,
            statusCode: updateError.statusCode
          });
          throw updateError;
        }
      } else {
        console.error('No file columns found for docType:', docType);
        return res.status(400).send({ status: 'failure', message: 'Invalid document type for file upload.' });
      }
      
      res.status(200).send({ status: 'success', fileId, fileName });
    } catch (uploadErr) {
      // Clean up temporary file in case of error
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
      throw uploadErr;
    }
  } catch (err) {
    console.log('Upload error:', err);
    res.status(500).send({ status: 'failure', message: err.message || 'File upload failed.' });
  }
});

// GET /registers/export - Export registers to Excel
app.get('/registers/export', async (req, res) => {
  try {
    const { catalyst } = res.locals;
    const zcql = catalyst.zcql();
    
    const { userRole, userEmail } = req.query;
    
    // Build WHERE clause for contractor filtering
    let whereClause = '';
    if (userRole === 'Contractor' && userEmail) {
      whereClause = `WHERE contractor = '${userEmail}'`;
    }
    
    const query = `SELECT * FROM Statutory ${whereClause} ORDER BY ROWID DESC`;
    const result = await zcql.executeZCQLQuery(query);
    const registers = result.map(row => row.Statutory) || [];
    
    // Create Excel workbook
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(registers);
    
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Statutory Registers');
    
    // Generate Excel file
    const excelBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="statutory_registers.xlsx"');
    res.send(excelBuffer);
  } catch (error) {
    console.error('Error exporting registers:', error);
    res.status(500).json({
      message: 'Failed to export registers',
      error: error.message
    });
  }
});

// POST /registers/import - Import registers from Excel
app.post('/registers/import', async (req, res) => {
  try {
    const { catalyst } = res.locals;
    const table = catalyst.datastore().table('Statutory');
    
    if (!req.files || !req.files.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }
    
    const file = req.files.file;
    const tempDir = os.tmpdir();
    const tempPath = path.join(tempDir, file.name);
    
    try {
      await file.mv(tempPath);
      
      // Parse Excel file
      const workbook = XLSX.readFile(tempPath);
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json(worksheet);
      
      // Clean up temporary file
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    
    // Process and insert data
    const insertPromises = data.map(row => {
      const registerData = {};
      
      STATUTORY_REGISTER_FIELDS.forEach(field => {
        if (row[field] !== undefined) {
          if (field.includes('Date') || field.includes('date')) {
            registerData[field] = parseDate(row[field]);
          } else if (field.includes('Amount') || (field.includes('Number') && !field.includes('RegNumber')) || field.includes('persons')) {
            registerData[field] = parseNumeric(row[field]);
          } else {
            registerData[field] = sanitizeString(row[field]);
          }
        }
      });
      
      registerData.createdTime = new Date().toISOString();
      registerData.modifiedTime = new Date().toISOString();
      
      return table.insertRow(registerData);
    });
    
    await Promise.all(insertPromises);
    
      res.json({
        message: `${data.length} registers imported successfully`
      });
    } catch (importErr) {
      // Clean up temporary file in case of error
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
      throw importErr;
    }
  } catch (error) {
    console.error('Error importing registers:', error);
    res.status(500).json({
      message: 'Failed to import registers',
      error: error.message
    });
  }
});

module.exports = app;
